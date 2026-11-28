// The rider editor in a real browser: setting a name, number, colours and helmet, what is refused, names
// shown as plain text everywhere, settings kept through a reload, what is locked, and the number on the bike.
// Needs the dev server (it uses the development hooks) and Playwright:
//   AFTERGLOW_URL=http://localhost:5173 NODE_PATH=$(npm root -g) node scripts/rider-smoke.mjs [folder for screenshots]
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
/** The name typed for player 1: markup that would add an element if it were ever read as HTML. */
const NASTY = '<img src=x>';
const SHOWN = '#7 <IMG SRC=X>';

/** Runs in the page: what the setup screen, the editor, the HUD and the results window show. */
const screen = () => {
  const text = id => document.querySelector(id)?.textContent ?? '';
  const shown = id => !!document.querySelector(id) && !document.querySelector(id).classList.contains('hidden');
  const stored = JSON.parse(localStorage.getItem('afterglow.save') || 'null');
  const swatches = [...document.querySelectorAll('#color-bike .swatch')];
  return {
    buttons: [...document.querySelectorAll('#slots [data-rider]')].map(b => b.textContent),
    editor: shown('#rider-editor'),
    title: text('#rider-editor-title'),
    name: document.querySelector('#rider-name').value,
    number: document.querySelector('#rider-number').value,
    errors: text('#rider-errors'),
    locks: text('#rider-locks'),
    swatches: swatches.length,
    locked: swatches.filter(b => b.disabled).length,
    chosen: ['bike', 'kit', 'helmet'].map(
      part => document.querySelector(`#color-${part} [aria-checked="true"]`)?.dataset.color ?? null,
    ),
    design: document.querySelector('#rider-design').value,
    pro: document.querySelector('#difficulty option[value="pro"]').disabled,
    pace: document.querySelector('#difficulty').value,
    identity: [...document.querySelectorAll('#hud .identity-name')].map(e => e.textContent),
    hudColor: [...document.querySelectorAll('#hud .viewport-hud')].map(e => e.style.getPropertyValue('--player')),
    rows: [...document.querySelectorAll('#results-table .result-row strong')].map(row => row.textContent),
    standing: [...document.querySelectorAll('#season-table .result-row strong')].map(row => row.textContent),
    unlock: shown('#results-unlock') ? text('#results-unlock') : '',
    // Anything a name could have added if it had been read as markup.
    injected: document.querySelectorAll('#slots img, #hud img, #results img, #season-table img, #rider-editor img')
      .length,
    saved: stored?.settings?.riders ?? null,
  };
};
/** Runs in the page: fills the editor that is open and presses SAVE. */
const fill = ({name, number, colors, design}) => {
  const set = (id, value) => {
    const node = document.querySelector(id);
    node.value = value;
    node.dispatchEvent(new Event('input', {bubbles: true}));
  };
  if (name !== undefined) set('#rider-name', name);
  if (number !== undefined) set('#rider-number', number);
  for (const [part, color] of Object.entries(colors || {}))
    document.querySelector(`#color-${part} [data-color="${color}"]`).click();
  if (design) document.querySelector('#rider-design').value = design;
  document.querySelector('#rider-save').click();
};
/** Runs in the page: simulated gamepads, so more than one player can be given a device. */
const pads = async humans => {
  const select = (selector, value) => {
    const node = document.querySelector(selector);
    node.value = value;
    node.dispatchEvent(new Event('change', {bubbles: true}));
  };
  window.__pads = Array.from({length: 4}, (_, index) => ({
    index,
    id: `Simulated pad ${index + 1}`,
    connected: true,
    mapping: 'standard',
    axes: [0, 0, 0, 0],
    buttons: Array.from({length: 17}, () => ({pressed: false, value: 0})),
  }));
  Object.defineProperty(navigator, 'getGamepads', {configurable: true, value: () => window.__pads});
  await new Promise(r => setTimeout(r, 80));
  select('#humans', String(humans));
  for (let i = 1; i < humans; i++) select(`[data-device="${i}"]`, `pad-${i - 1}`);
  for (const b of document.querySelectorAll('[data-ready]')) if (!b.classList.contains('is-ready')) b.click();
};
/** Runs in the page: the race on screen, ridden on autopilot to its results. */
const ride = seconds => {
  const g = window.__game;
  g.toRacing();
  if (seconds) g.timeLimit(seconds);
  for (let i = 0; i < 60 * 600 && g.snapshot().phase === 'racing'; i++) {
    g.riders().forEach(r => r.human && g.drive(r.id));
    g.step(1 / 60);
  }
  return g.snapshot();
};
const ready = page =>
  page.waitForFunction(() => window.__game && !document.querySelector('#loading:not(.hidden)'), null, {timeout: 60000});

const browser = await chromium.launch();
const page = await browser.newPage({viewport: {width: 1280, height: 720}});
// Clicked in the page: a pointer click waits for the page to stop drawing, which a game never does.
const click = selector => page.evaluate(id => document.querySelector(id).click(), selector);
const select = (selector, value) =>
  page.evaluate(
    ([id, v]) => {
      const node = document.querySelector(id);
      node.value = v;
      node.dispatchEvent(new Event('change', {bubbles: true}));
    },
    [selector, value],
  );
/** A picture for the record. The software renderer of a test machine can be too slow for one; that is not a failure. */
const shot = (name, options = {}) =>
  page.screenshot({path: `${folder}/${name}.png`, timeout: 60000, ...options}).then(
    () => true,
    () => false,
  );
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
page.on(
  'console',
  message => message.type() === 'error' && !message.text().includes('404') && errors.push(message.text()),
);
try {
  await page.goto(url, {waitUntil: 'commit'});
  await ready(page);

  // A new save: player 1 is PLAYER 1 with number 1, and nothing is unlocked.
  let seen = await page.evaluate(screen);
  check(
    seen.buttons.length === 1 && seen.buttons[0].includes('#1 PLAYER 1'),
    'the setup row shows the rider',
    seen.buttons[0],
  );
  check(seen.pro && seen.pace === 'club', 'Pro pace is listed but cannot be chosen');
  await click('#slots [data-rider="0"]');
  seen = await page.evaluate(screen);
  check(seen.editor && seen.title === 'PLAYER 1 / YOUR RIDER', 'the button opens that player’s editor', seen.title);
  check(seen.name === 'PLAYER 1' && seen.number === '1', 'filled with what they have now');
  check(seen.swatches === 23 && seen.locked === 15, 'eight colours to choose, fifteen locked', `${seen.locked} locked`);
  check(seen.locks.startsWith('0 of 5'), 'and the editor says how to unlock them', seen.locks);
  await shot('rider-editor');

  // Refused: an empty name, a number out of range, a locked colour. The editor stays open and says why.
  await page.evaluate(fill, {name: '   '});
  seen = await page.evaluate(screen);
  check(seen.editor && seen.errors.includes('Enter a name'), 'an empty name is refused', seen.errors);
  await page.evaluate(fill, {name: 'THIRTEEN CHARS'});
  seen = await page.evaluate(screen);
  check(seen.editor && seen.errors.includes('up to 12'), 'a name over 12 characters is refused', seen.errors);
  for (const number of ['0', '1000', '4.5', 'abc', ''])
    await page.evaluate(fill, {name: 'MIKE', number}).then(async () => {
      seen = await page.evaluate(screen);
      check(seen.editor && seen.errors.includes('1 to 999'), `number "${number}" is refused`, seen.errors);
    });
  const forced = await page.evaluate(() => {
    // A locked colour made clickable by hand is still refused when saved.
    const locked = document.querySelector('#color-kit .swatch.locked');
    locked.disabled = false;
    locked.click();
    document.querySelector('#rider-number').value = '7';
    document.querySelector('#rider-save').click();
    return document.querySelector('#rider-errors').textContent;
  });
  seen = await page.evaluate(screen);
  check(seen.editor && forced.includes('still locked'), 'a locked colour is refused', forced);
  check(seen.saved === null || seen.saved[0].name === 'PLAYER 1', 'and nothing was saved by any of that');

  // Accepted: markup as a name, a number, three colours and a helmet design.
  await click('#rider-cancel');
  await click('#slots [data-rider="0"]');
  await page.evaluate(fill, {
    name: NASTY,
    number: '7',
    colors: {bike: 0xe589dc, kit: 0x41b9ec, helmet: 0xffcf61},
    design: 'checker',
  });
  seen = await page.evaluate(screen);
  check(!seen.editor && seen.errors === '', 'a valid rider is saved and the editor closes');
  check(seen.buttons[0].includes(SHOWN), 'the row shows the name exactly as typed, in capitals', seen.buttons[0]);
  check(seen.injected === 0, 'and the markup in it made no element');
  check(
    seen.saved[0].number === 7 &&
      seen.saved[0].bike === 0xe589dc &&
      seen.saved[0].kit === 0x41b9ec &&
      seen.saved[0].helmet === 0xffcf61 &&
      seen.saved[0].design === 'checker',
    'number, three colours and helmet are stored',
  );

  // A second player cannot take the same number.
  await page.evaluate(pads, 2);
  seen = await page.evaluate(screen);
  check(seen.buttons.length === 2 && seen.buttons[1].includes('#2 PLAYER 2'), 'a second player has their own row');
  await click('#slots [data-rider="1"]');
  await page.evaluate(fill, {name: 'Sarah', number: '7'});
  seen = await page.evaluate(screen);
  check(seen.editor && seen.errors === 'Player 1 already has number 7.', 'player 2 cannot take number 7', seen.errors);
  await page.evaluate(fill, {number: '007'});
  seen = await page.evaluate(screen);
  check(seen.editor && seen.errors.includes('already has number 7'), 'nor as 007', seen.errors);
  await page.evaluate(fill, {number: '33'});
  seen = await page.evaluate(screen);
  check(!seen.editor && seen.buttons[1].includes('#33 SARAH'), 'a free number is accepted', seen.buttons[1]);

  // Closing and reopening keeps both riders.
  await page.reload({waitUntil: 'commit'});
  await ready(page);
  await page.evaluate(pads, 2);
  seen = await page.evaluate(screen);
  check(
    seen.buttons[0].includes(SHOWN) && seen.buttons[1].includes('#33 SARAH'),
    'after a reload both riders are as they were set',
    seen.buttons.join(' / '),
  );
  await click('#slots [data-rider="0"]');
  seen = await page.evaluate(screen);
  check(
    seen.chosen.join() === [0xe589dc, 0x41b9ec, 0xffcf61].join() && seen.design === 'checker',
    'and the editor opens on the saved colours and helmet',
    seen.chosen.join(),
  );
  await click('#rider-cancel');

  // A race: the HUD and the results use the names and numbers.
  await select('#npcs', '2');
  await select('#laps', '1');
  await select('#render-scale', '0.5');
  await click('#start');
  let state = await page.evaluate(() => (window.__game.step(0.05), window.__game.snapshot()));
  seen = await page.evaluate(screen);
  check(
    seen.identity.join(' / ') === `${SHOWN} / #33 SARAH`,
    'each view of the HUD names its rider',
    seen.identity.join(' / '),
  );
  check(seen.hudColor[0] === '#e589dc', 'in the colour they chose', seen.hudColor[0]);
  check(seen.injected === 0, 'the HUD shows the markup as text');
  await shot('rider-hud');
  state = await page.evaluate(ride, 0);
  seen = await page.evaluate(screen);
  check(state.phase === 'results', 'the race runs to its results');
  check(
    seen.rows.some(row => row.startsWith(SHOWN)) && seen.rows.some(row => row.startsWith('#33 SARAH')),
    'the results list both players by number and name',
    seen.rows.join(' / '),
  );
  check(seen.injected === 0, 'the results show the markup as text');
  await shot('rider-results');
  await click('#setup-results');

  // The championship standings.
  await page.evaluate(pads, 1);
  await click('#season-mode');
  await click('#start');
  await page.evaluate(ride, 15);
  await click('#restart-results');
  await page.evaluate(ride, 15);
  seen = await page.evaluate(screen);
  check(
    seen.rows.some(row => row.startsWith(SHOWN)),
    'a championship main lists the player the same way',
  );
  await click('#restart-results');
  const table = await page.evaluate(() =>
    [...document.querySelectorAll('#results-table .result-row strong')].map(row => row.textContent),
  );
  check(table.length === 8 && table.some(row => row.startsWith(SHOWN)), 'and so do the standings', table.join(' / '));
  await click('#setup-results');
  seen = await page.evaluate(screen);
  check(seen.standing.some(row => row.startsWith(SHOWN)) && seen.injected === 0, 'on the setup screen too, as text');

  // Unlocks: with a colour set and Pro pace unlocked in the save, they can be chosen; the rest stay locked.
  await page.evaluate(() => {
    const save = JSON.parse(localStorage.getItem('afterglow.save'));
    save.career = {unlocks: ['colors-neon', 'pace-pro'], awards: ['1:0']};
    localStorage.setItem('afterglow.save', JSON.stringify(save));
  });
  await page.reload({waitUntil: 'commit'});
  await ready(page);
  await click('#race-mode');
  await click('#slots [data-rider="0"]');
  seen = await page.evaluate(screen);
  check(
    seen.locked === 12 && seen.locks.startsWith('1 of 5'),
    'an unlocked colour set can be chosen',
    `${seen.locked} locked`,
  );
  check(!seen.pro, 'and Pro pace can be chosen once it is unlocked');
  await page.evaluate(fill, {colors: {kit: 0x39ff88}});
  seen = await page.evaluate(screen);
  check(!seen.editor && seen.saved[0].kit === 0x39ff88, 'the unlocked colour is saved');

  // The number on the bike at one, two and three digits: from the chase camera, the side and the front.
  await select('#npcs', '0');
  await select('#render-scale', '1');
  for (const number of ['7', '42', '999']) {
    await click('#slots [data-rider="0"]');
    await page.evaluate(fill, {name: 'MIKE', number});
    await click('#practice-mode');
    await click('#start');
    // Past the countdown, which is drawn over the rider.
    state = await page.evaluate(() => (window.__game.toRacing(), window.__game.step(0.05), window.__game.snapshot()));
    check(state.riders[0].number === Number(number), `the bike carries number ${number}`, `${state.riders[0].number}`);
    for (const [view, angle] of [
      ['chase', 0],
      ['side', Math.PI / 2],
      ['front', Math.PI],
    ]) {
      await page.evaluate(a => window.__game.orbit(a), angle);
      await page.waitForTimeout(2500);
      const taken = await shot(`plate-${number}-${view}`, {clip: {x: 340, y: 150, width: 600, height: 450}});
      if (view === 'chase') check(taken, `number ${number} photographed from the chase camera`);
    }
    await page.evaluate(() => window.__game.orbit(0));
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.querySelector('#setup-pause')?.click());
    await page.waitForFunction(() => window.__game.snapshot().phase === 'setup', null, {timeout: 10000});
  }
  check(errors.length === 0, 'no page errors', errors.join(' | '));
} catch (error) {
  check(false, 'the check ran to the end', String(error));
} finally {
  await browser.close();
}
const failed = checks.filter(c => !c.ok).length;
console.log(`rider-smoke: ${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
