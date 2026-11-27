// Time Trial in a real browser: the third mode, the restart-lap button, a ghost saved to IndexedDB, the same
// ghost after a reload, the toggle and leaving through the results screen.
// Needs the dev server (it uses the development hooks) and Playwright:
//   AFTERGLOW_URL=http://localhost:5173 NODE_PATH=$(npm root -g) node scripts/trial-smoke.mjs [folder for screenshots]
import {createRequire} from 'node:module';
import {mkdirSync} from 'node:fs';

const {chromium} = createRequire(import.meta.url)('playwright');
const url = process.env.AFTERGLOW_URL || 'http://localhost:5173';
const folder = process.argv[2] || 'output';
mkdirSync(folder, {recursive: true});
const checks = [];
const check = (ok, name, detail = '') => {
  checks.push({ok: !!ok, name, detail});
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`);
};
/** Runs in the page: starts a Time Trial on Saltwind Coast. */
const startTrial = () => {
  const g = window.__game;
  const course = document.querySelector('#course');
  course.value = 'coast';
  course.dispatchEvent(new Event('change', {bubbles: true}));
  document.querySelector('#trial-mode').click();
  document.querySelector('#start').click();
  g.step(4);
  return g.snapshot();
};
/** Runs in the page: the autopilot rides until `laps` laps are timed. Returns the lap times. */
const rideLaps = laps => {
  const g = window.__game;
  for (let i = 0; i < 40000 && g.timing()[0].laps.length < laps; i++) {
    g.drive(0);
    g.step(1 / 60);
  }
  g.setControl(0, null);
  return g.timing()[0].laps.map(lap => lap.time);
};
const ready = () => window.__game && !document.getElementById('loading');
/** Clicks through the page's own code: a real pointer click can stall on a slow software renderer. */
const click = (page, selector) => page.evaluate(sel => document.querySelector(sel).click(), selector);
/** Waits for the game to reach a state: saving a ghost and drawing a frame both take a moment. */
const settle = (page, reached = () => true) =>
  page
    .waitForFunction(reached, null, {timeout: 120000, polling: 200})
    .then(() => page.waitForTimeout(300))
    .catch(() => {});

const browser = await chromium.launch();
const page = await browser.newPage({viewport: {width: 1280, height: 720}});
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
// The controller bridge is not served by every test setup; its 404 is not the game's fault.
page.on(
  'console',
  message => message.type() === 'error' && !message.text().includes('404') && errors.push(message.text()),
);
try {
  await page.goto(url, {waitUntil: 'commit'});
  await page.waitForFunction(() => window.__game && !document.querySelector('#loading:not(.hidden)'), null, {
    timeout: 60000,
  });
  await page.evaluate(() => indexedDB.deleteDatabase('afterglow-ghosts'));
  await page.reload();
  await page.waitForFunction(ready, null, {timeout: 0});

  let state = await page.evaluate(startTrial);
  check(
    state.trial && state.riders.length === 1 && state.phase === 'racing',
    'Time Trial starts with one rider and no AI',
  );
  check(await page.isVisible('#restart-lap'), 'the restart-lap button is on screen');
  check((await page.textContent('#session-label')).includes('TIME TRIAL'), 'the session is labelled TIME TRIAL');
  await settle(page);
  state = await page.evaluate(() => window.__game.snapshot());
  check(!state.ghost.loaded && !state.ghost.shown, 'no ghost before a lap is set');
  check(!state.ghost.sessionOnly && !(await page.isVisible('#ghost-notice')), 'IndexedDB works, so no notice');

  await page.evaluate(() => window.__game.ghostFromAutopilot(true));
  let laps = await page.evaluate(rideLaps, 1);
  await settle(page, () => window.__game.snapshot().ghost.loaded);
  state = await page.evaluate(() => window.__game.snapshot());
  check(
    state.ghost.loaded && Math.abs(state.ghost.time - laps[0]) < 1e-6,
    'the first lap becomes the ghost',
    `${laps[0].toFixed(3)} s`,
  );
  check(state.phase === 'racing', 'no results screen after a lap');

  laps = await page.evaluate(rideLaps, 2);
  await settle(page, () => window.__game.snapshot().ghost.time === window.__game.timing()[0].laps[1].time);
  state = await page.evaluate(() => window.__game.snapshot());
  check(
    laps[1] < laps[0] && Math.abs(state.ghost.time - laps[1]) < 1e-6,
    'a faster lap replaces it',
    `${laps[1].toFixed(3)} s`,
  );
  await page.evaluate(() => {
    for (let i = 0; i < 600; i++) {
      window.__game.drive(0);
      window.__game.step(1 / 60);
    }
  });
  await settle(page, () => window.__game.snapshot().ghost.shown);
  state = await page.evaluate(() => window.__game.snapshot());
  const rider = state.riders[0];
  check(state.ghost.shown, 'the ghost is drawn while riding');
  check(
    Math.hypot(state.ghost.x - rider.x, state.ghost.z - rider.z) < 60,
    'and rides close to an equally quick rider',
    `${Math.hypot(state.ghost.x - rider.x, state.ghost.z - rider.z).toFixed(1)} m apart`,
  );
  await page.screenshot({path: `${folder}/time-trial-ghost.png`});

  await click(page, '#pause-button');
  check(await page.isVisible('#pause-show-ghost'), 'the pause menu has the ghost switch');
  await click(page, '#pause-show-ghost');
  await click(page, '#resume');
  await settle(page, () => !window.__game.snapshot().ghost.shown);
  check(!(await page.evaluate(() => window.__game.snapshot().ghost.shown)), 'the toggle hides the ghost');
  await click(page, '#pause-button');
  await click(page, '#pause-show-ghost');
  await click(page, '#resume');
  await settle(page, () => window.__game.snapshot().ghost.shown);
  check(await page.evaluate(() => window.__game.snapshot().ghost.shown), 'and shows it again');

  await page.evaluate(() => window.__game.setControl(0, null));
  await click(page, '#restart-lap');
  state = await page.evaluate(() => window.__game.snapshot());
  check(
    state.riders[0].speed === 0 && state.riders[0].lap === 0 && state.phase === 'racing',
    'restart lap puts the rider on the line',
  );
  check((await page.evaluate(() => window.__game.timing()[0].laps.length)) === 2, 'and keeps the laps already ridden');

  const best = laps[1];
  await page.reload();
  await page.waitForFunction(ready, null, {timeout: 0});
  state = await page.evaluate(startTrial);
  await settle(page, () => window.__game.snapshot().ghost.loaded);
  state = await page.evaluate(() => window.__game.snapshot());
  check(
    state.ghost.loaded && Math.abs(state.ghost.time - best) < 1e-6,
    'the ghost is still there after a reload',
    `${state.ghost.time?.toFixed(3)} s`,
  );

  await click(page, '#pause-button');
  await click(page, '#setup-pause');
  state = await page.evaluate(() => window.__game.snapshot());
  check(state.phase === 'results' && (await page.isVisible('#results')), 'leaving shows the results screen');
  await click(page, '#setup-results');
  await click(page, '#race-mode');
  await page.evaluate(() => (document.querySelector('#npcs').value = '5'));
  await click(page, '#start');
  state = await page.evaluate(() => (window.__game.step(4), window.__game.snapshot()));
  check(
    !state.trial && state.riders.length > 1 && !(await page.isVisible('#restart-lap')),
    'Race Night is unchanged afterwards',
  );
  await settle(page);
  check(!(await page.evaluate(() => window.__game.snapshot().ghost.shown)), 'and shows no ghost');
  check(errors.length === 0, 'no page errors', errors.join(' | '));
} finally {
  await browser.close();
}
const failed = checks.filter(c => !c.ok);
console.log(`trial-smoke: ${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) process.exit(1);
