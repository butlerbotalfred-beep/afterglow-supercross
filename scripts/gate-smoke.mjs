// The start gate in a real browser: the board, the gate bars, the rev meter, a good launch, a jumped gate, the
// holeshot banner and its entry in the results, and no gate in Free Practice.
// Needs the dev server (it uses the development hooks) and Playwright:
//   AFTERGLOW_URL=http://localhost:5173 NODE_PATH=$(npm root -g) node scripts/gate-smoke.mjs [folder for screenshots]
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
/** Runs in the page: back to setup from wherever the game is, then starts on Saltwind Coast in `mode`. */
const begin = mode => {
  const g = window.__game;
  const phase = g.snapshot().phase;
  if (phase === 'results') document.querySelector('#setup-results').click();
  else if (phase !== 'setup') {
    if (!g.snapshot().paused) document.querySelector('#pause-button').click();
    document.querySelector('#setup-pause').click();
  }
  g.setControl(0, null);
  const select = (selector, value) => {
    const node = document.querySelector(selector);
    node.value = value;
    node.dispatchEvent(new Event('change', {bubbles: true}));
  };
  select('#course', 'coast');
  document.querySelector(mode === 'practice' ? '#practice-mode' : '#race-mode').click();
  if (mode !== 'practice') select('#npcs', '5');
  select('#laps', '1');
  document.querySelector('#start').click();
  g.step(0.05);
  return g.snapshot();
};
/** Runs in the page: presses or releases the keyboard throttle. */
const throttle = down => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', {code: 'KeyW'}));
const hud = () => ({
  board: document.querySelector('#countdown').textContent,
  boardShown: !document.querySelector('#countdown').classList.contains('hidden'),
  meter: document.querySelector('.launch').className,
  label: document.querySelector('.launch em').textContent,
  needle: document.querySelector('.launch-track i').style.left,
  notice: document.querySelector('.rider-notice').textContent,
});
/** Lets the page draw: the bars and the meter are moved by the frame loop, not by the stepped clock. */
const settle = (page, reached = () => true) =>
  page
    .waitForFunction(reached, null, {timeout: 120000, polling: 200})
    .then(() => page.waitForTimeout(300))
    .catch(() => {});

const browser = await chromium.launch();
const page = await browser.newPage({viewport: {width: 1280, height: 720}});
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
page.on(
  'console',
  message => message.type() === 'error' && !message.text().includes('404') && errors.push(message.text()),
);
try {
  await page.goto(url, {waitUntil: 'commit'});
  await page.waitForFunction(() => window.__game && !document.querySelector('#loading:not(.hidden)'), null, {
    timeout: 60000,
  });

  // A race: the board, the bars and the meter.
  let state = await page.evaluate(begin, 'race');
  let seen = await page.evaluate(hud);
  check(state.phase === 'countdown' && state.gate && !state.gate.dropped, 'a race starts behind a gate');
  check(
    state.gate.bars?.inScene && state.gate.bars.count === state.riders.length && state.gate.bars.open === 0,
    'a gate bar stands in front of every bike',
    `${state.gate.bars?.count} bars for ${state.riders.length} riders`,
  );
  check(seen.boardShown && seen.board.includes('5'), 'the board starts at 5', seen.board);
  check(seen.meter.includes('launch') && !seen.meter.includes('hidden'), 'the rev meter is on screen', seen.label);
  check(
    state.gate.dropAt >= 6 && state.gate.dropAt <= 8,
    'the drop is 6 to 8 s away',
    `${state.gate.dropAt.toFixed(2)} s`,
  );

  // The keyboard throttle moves the needle while the board is up, and costs nothing yet.
  state = await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyW'}));
    window.__game.step(1.8);
    return window.__game.snapshot();
  });
  seen = await page.evaluate(hud);
  check(state.gate.launches[0].revs > 0.9 && !state.gate.launches[0].jumped, 'holding W revs the engine', seen.needle);
  check(seen.meter.includes('creep'), 'the meter shows the revs are too high');
  await page.screenshot({path: `${folder}/gate-board.png`});
  // Off the throttle in time, then a squeeze just before the drop: a good launch.
  state = await page.evaluate(() => {
    const g = window.__game;
    window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyW'}));
    const gate = () => g.snapshot().gate;
    while (gate().elapsed < gate().dropAt - 1.13) g.step(1 / 120);
    window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyW'}));
    g.toRacing();
    g.step(0.5);
    return g.snapshot();
  });
  await settle(page, () => window.__game.snapshot().gate.bars.open === 1);
  seen = await page.evaluate(hud);
  check(state.phase === 'racing' && state.gate.dropped, 'the gate drops and the race is on');
  check(state.gate.launches[0].result === 'good', 'a squeeze timed to the drop is a good launch', seen.label);
  check(seen.label === 'GOOD LAUNCH' && !seen.boardShown, 'the meter says so and the board is gone');
  check((await page.evaluate(() => window.__game.snapshot().gate.bars.open)) === 1, 'the bars are flat on the ground');
  check(state.riders[0].speed > 5, 'the bike is away', `${(state.riders[0].speed * 3.6).toFixed(0)} km/h after 0.5 s`);
  check(
    state.gate.launches.slice(1).every(l => l.result === 'good'),
    'every computer rider launched in the band',
  );
  await page.screenshot({path: `${folder}/gate-dropped.png`});

  // The holeshot: the autopilot rides to the line.
  state = await page.evaluate(() => {
    const g = window.__game;
    window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyW'}));
    for (let i = 0; i < 4000 && g.snapshot().holeshot === null; i++) {
      g.drive(0);
      g.step(1 / 60);
    }
    g.step(0.2);
    return g.snapshot();
  });
  seen = await page.evaluate(hud);
  check(
    state.holeshot !== null,
    'somebody takes the holeshot',
    `rider ${state.holeshot} at ${state.raceTime.toFixed(1)} s`,
  );
  check(seen.notice.includes('HOLESHOT'), 'the banner says so', seen.notice);
  await settle(page);
  await page.screenshot({path: `${folder}/gate-holeshot.png`});
  const winner = state.holeshot;
  state = await page.evaluate(() => {
    const g = window.__game;
    for (let i = 0; i < 40000 && g.snapshot().phase === 'racing'; i++) {
      g.drive(0);
      g.step(1 / 60);
    }
    return g.snapshot();
  });
  const tags = await page.evaluate(() =>
    [...document.querySelectorAll('.result-row')]
      .filter(row => row.querySelector('.holeshot-tag'))
      .map(row => row.querySelector('strong').firstChild.textContent),
  );
  check(state.phase === 'results' && state.holeshot === winner, 'the holeshot is not handed on during the race');
  check(tags.length === 1, 'the results name one holeshot', tags.join(', '));

  // Jumping the gate.
  state = await page.evaluate(begin, 'race');
  state = await page.evaluate(() => {
    const g = window.__game;
    const gate = () => g.snapshot().gate;
    // The needle takes over a second and a half to reach the red, so the key goes down a second before the gate is live.
    while (gate().elapsed < 4) g.step(1 / 120);
    window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyW'}));
    g.step(1.95);
    return g.snapshot();
  });
  seen = await page.evaluate(hud);
  check(state.gate.launches[0].jumped, 'W held with the gate live creeps into it', seen.label);
  state = await page.evaluate(() => {
    const g = window.__game;
    g.toRacing();
    g.step(0.45);
    const held = g.snapshot().riders[0].speed;
    g.step(0.3);
    return {held, after: g.snapshot().riders[0].speed, result: g.snapshot().gate.launches[0].result};
  });
  seen = await page.evaluate(hud);
  check(
    state.result === 'jumped' && state.held === 0 && state.after > 0,
    'the rider is held half a second, then goes',
    seen.label,
  );
  await page.evaluate(throttle, false);

  // Free Practice has no gate.
  state = await page.evaluate(begin, 'practice');
  seen = await page.evaluate(hud);
  check(state.gate === null && seen.meter.includes('hidden'), 'Free Practice has no gate and no meter');
  check(seen.board.includes('FIND YOUR LINE'), 'and keeps its 3-2-1', seen.board);
  state = await page.evaluate(() => {
    const g = window.__game;
    g.toRacing();
    for (let i = 0; i < 3000 && g.riders()[0].surface.s < g.snapshot().holeshotLine + 30; i++) {
      g.drive(0);
      g.step(1 / 60);
    }
    return g.snapshot();
  });
  check(state.holeshot === null, 'and awards no holeshot');
  check(errors.length === 0, 'no page errors', errors.join(' | '));
} finally {
  await browser.close();
}
const failed = checks.filter(c => !c.ok);
console.log(`gate-smoke: ${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) process.exit(1);
