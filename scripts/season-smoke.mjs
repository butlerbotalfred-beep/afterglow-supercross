// The championship in a real browser: starting a season, a timed heat and main, the standings, closing and
// reopening, the confirmation before a season is given up, and Race Night left as it was.
// Needs the dev server (it uses the development hooks) and Playwright:
//   AFTERGLOW_URL=http://localhost:5173 NODE_PATH=$(npm root -g) node scripts/season-smoke.mjs [folder for screenshots]
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
/** Runs in the page: what the setup screen and the results window say. */
const screen = () => {
  const text = id => document.querySelector(id)?.textContent ?? '';
  const shown = id => !!document.querySelector(id) && !document.querySelector(id).classList.contains('hidden');
  const stored = JSON.parse(localStorage.getItem('afterglow.save') || 'null');
  return {
    start: text('#start'),
    status: text('#season-status'),
    panel: shown('#season-panel'),
    tableRows: document.querySelectorAll('#season-table .result-row').length,
    newSeason: shown('#new-season'),
    confirm: shown('#season-confirm'),
    confirmText: text('#season-confirm-text'),
    seasonTab: document.querySelector('#season-mode').classList.contains('active'),
    courseLocked: document.querySelector('#course').disabled,
    lapsLocked: document.querySelector('#laps').disabled,
    humansLocked: document.querySelector('#humans').disabled,
    label: text('#session-label'),
    clock: text('#race-time'),
    lap: text('.lap'),
    results: shown('#results'),
    eyebrow: text('#results .eyebrow'),
    heading: text('#results-heading'),
    subtitle: text('#results-subtitle'),
    rows: [...document.querySelectorAll('#results-table .result-row')].map(row => row.textContent),
    next: text('#restart-results'),
    leave: text('#setup-results'),
    saved: stored?.career?.season ?? null,
  };
};
/** Runs in the page: the timed race on screen with `seconds` on the clock, ridden to its results. */
const ride = seconds => {
  const g = window.__game;
  g.toRacing();
  g.timeLimit(seconds);
  let sawLeft = '',
    sawFinal = '';
  for (let i = 0; i < 60 * 600 && g.snapshot().phase === 'racing'; i++) {
    g.drive(0);
    g.step(1 / 60);
    if (i % 30) continue;
    const clock = document.querySelector('#race-time').textContent;
    if (clock.includes('LEFT')) sawLeft = clock;
    if (clock.includes('FINAL LAP')) sawFinal = document.querySelector('.lap').textContent;
  }
  return {state: g.snapshot(), sawLeft, sawFinal};
};
const ready = page =>
  page.waitForFunction(() => window.__game && !document.querySelector('#loading:not(.hidden)'), null, {timeout: 60000});

const browser = await chromium.launch();
const page = await browser.newPage({viewport: {width: 1280, height: 720}});
// Clicked in the page: a pointer click waits for the page to stop drawing, which a game never does.
const click = selector => page.evaluate(id => document.querySelector(id).click(), selector);
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
page.on(
  'console',
  message => message.type() === 'error' && !message.text().includes('404') && errors.push(message.text()),
);
try {
  await page.goto(url, {waitUntil: 'commit'});
  await ready(page);

  // Championship mode with no season yet.
  await click('#season-mode');
  let seen = await page.evaluate(screen);
  check(seen.panel && seen.seasonTab, 'Championship is a mode on the setup screen');
  check(seen.start.includes('START A NEW SEASON'), 'with no season the button starts one', seen.start);
  check(seen.courseLocked && seen.lapsLocked && !seen.humansLocked, 'the circuit and length are the season’s to set');
  check(!seen.newSeason && seen.saved === null, 'nothing is saved until a season starts');
  await page.screenshot({path: `${folder}/season-setup.png`});

  // Round 1 heat.
  await click('#start');
  let state = await page.evaluate(() => (window.__game.step(0.05), window.__game.snapshot()));
  seen = await page.evaluate(screen);
  check(state.phase === 'countdown' && state.gate, 'the heat starts behind the gate');
  check(state.riders.length === 8 && state.course === 'dusk', 'eight riders on Dusk Valley', `${state.riders.length}`);
  check(seen.label === 'ROUND 1 OF 5 · DUSK VALLEY · HEAT', 'the race bar names the race', seen.label);
  check(state.timed.limit === 180, 'the heat is three minutes on the clock', `${state.timed.limit} s`);
  check(seen.saved && seen.saved.rounds.length === 5 && seen.saved.rounds[0].heat === null, 'the new season is saved');
  let ridden = await page.evaluate(ride, 20);
  state = ridden.state;
  seen = await page.evaluate(screen);
  check(ridden.sawLeft.includes('LEFT'), 'the clock counts down', ridden.sawLeft);
  check(/\/ \d/.test(ridden.sawFinal), 'the last lap is called and numbered', ridden.sawFinal);
  check(state.phase === 'results' && seen.results, 'the heat ends on its own');
  check(seen.eyebrow === 'ROUND 1 OF 5 · DUSK VALLEY · HEAT', 'the results name the race', seen.eyebrow);
  check(
    seen.rows.length === 8 && !seen.rows.some(row => row.includes('PTS')),
    'eight classified, no points for a heat',
  );
  check(!seen.rows.some(row => row.includes('DNF')), 'nobody is shown as a retirement');
  check(seen.next.includes('LINE UP FOR THE MAIN'), 'the next step is the main', seen.next);
  check(seen.leave.includes('SEASON SAVED'), 'and the screen says the season is saved', seen.leave);
  const heat = seen.saved.rounds[0].heat;
  check(Array.isArray(heat) && heat.length === 8 && seen.saved.rounds[0].main === null, 'the heat result is stored');
  await page.screenshot({path: `${folder}/season-heat-results.png`});

  // Closing and reopening: the game comes back in Championship mode, waiting for the main.
  await page.reload({waitUntil: 'commit'});
  await ready(page);
  seen = await page.evaluate(screen);
  check(seen.seasonTab && seen.panel, 'after a reload the game opens on the season');
  check(seen.start.includes('START ROUND 1 MAIN'), 'and it is waiting for the main', seen.start);
  check(seen.status.includes('ROUND 1 OF 5 · DUSK VALLEY · MAIN'), 'the panel says what is next', seen.status);
  check(seen.humansLocked && seen.newSeason, 'the riders are fixed and a new season can be asked for');

  // Asking for a new season over this one needs a second answer.
  await click('#new-season');
  seen = await page.evaluate(screen);
  check(seen.confirm && seen.confirmText.includes('round 1 of 5'), 'a new season asks first', seen.confirmText);
  check(seen.saved.rounds[0].heat !== null, 'and nothing has changed yet');
  await click('#season-confirm-no');
  seen = await page.evaluate(screen);
  check(!seen.confirm && seen.newSeason && seen.saved.rounds[0].heat !== null, 'keeping the season keeps it');

  // The main: gates in heat order, points, standings.
  await click('#start');
  state = await page.evaluate(() => (window.__game.step(0.05), window.__game.snapshot()));
  check(state.season.race.stage === 'main' && state.timed.limit === 360, 'the main is six minutes on the clock');
  check(
    heat.every((id, place) => state.season.race.slots[id] === place),
    'the heat result is the gate order',
    heat.join(' '),
  );
  await page.screenshot({path: `${folder}/season-main-grid.png`});
  ridden = await page.evaluate(ride, 20);
  seen = await page.evaluate(screen);
  check(ridden.state.phase === 'results', 'the main ends on its own');
  check(
    seen.rows[0].includes('+25 PTS') && seen.rows[7].includes('+14 PTS'),
    'the main shows its points',
    seen.rows[0],
  );
  check(seen.next.includes('STANDINGS'), 'the next step is the standings', seen.next);
  await click('#restart-results');
  seen = await page.evaluate(screen);
  check(seen.eyebrow === 'CHAMPIONSHIP / AFTER ROUND 1 OF 5', 'the standings follow the main', seen.eyebrow);
  check(
    seen.rows.length === 8 && seen.rows[0].includes('25 PTS') && seen.rows[0].includes('P1'),
    'with the table',
    seen.rows[0],
  );
  check(seen.next.includes('ROUND 2 HEAT'), 'and then round 2', seen.next);
  await page.screenshot({path: `${folder}/season-standings.png`});

  // Round 2 moves to the next circuit. Leaving a race half way does not record it.
  await click('#restart-results');
  state = await page.evaluate(() => (window.__game.step(0.05), window.__game.snapshot()));
  seen = await page.evaluate(screen);
  check(
    state.course === 'canyon' && seen.label === 'ROUND 2 OF 5 · RED MESA · HEAT',
    'round 2 is on Red Mesa',
    seen.label,
  );
  await page.evaluate(() => {
    window.__game.toRacing();
    window.__game.step(2);
    document.querySelector('#pause-button').click();
    document.querySelector('#setup-pause').click();
  });
  seen = await page.evaluate(screen);
  check(
    seen.start.includes('START ROUND 2 HEAT') && seen.saved.rounds[1].heat === null,
    'a race left early is still to run',
  );
  check(seen.tableRows === 8, 'the setup screen shows the table so far', `${seen.tableRows} rows`);
  await page.screenshot({path: `${folder}/season-resume.png`});

  // Giving the season up, with the second answer.
  await click('#new-season');
  await click('#season-confirm-yes');
  seen = await page.evaluate(screen);
  check(seen.saved === null && seen.start.includes('START A NEW SEASON'), 'confirming ends the season', seen.start);
  check(!seen.humansLocked, 'and the riders can be chosen again');

  // Race Night is as it was.
  await click('#race-mode');
  seen = await page.evaluate(screen);
  check(
    !seen.panel && seen.start.includes('DROP THE GATE') && !seen.courseLocked && !seen.lapsLocked,
    'Race Night is unchanged',
  );
  state = await page.evaluate(() => {
    document.querySelector('#start').click();
    window.__game.step(0.05);
    return window.__game.snapshot();
  });
  seen = await page.evaluate(screen);
  check(
    state.timed.limit === 0 && seen.label.includes('RACE NIGHT') && /\/ 3/.test(seen.lap),
    'and still runs over laps',
    seen.lap,
  );
  check(errors.length === 0, 'no page errors', errors.join(' | '));
} catch (error) {
  check(false, 'the check ran to the end', String(error));
} finally {
  await browser.close();
}
const failed = checks.filter(c => !c.ok).length;
console.log(`season-smoke: ${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
