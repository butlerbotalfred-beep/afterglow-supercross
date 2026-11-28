// Track wear in a real browser: fresh dirt at the start, a darker racing line after a 3-lap race of eight,
// the picture sent to the graphics card at most four times a second, and fresh dirt again for the next race.
//   AFTERGLOW_URL=http://localhost:5173 NODE_PATH=$(npm root -g) node scripts/wear-smoke.mjs [folder for screenshots]
// Needs the dev server (the checks use its development hooks).
import {createRequire} from 'node:module';
import {mkdirSync} from 'node:fs';

const {chromium} = createRequire(import.meta.url)('playwright');
const url = process.env.AFTERGLOW_URL || 'http://localhost:5173';
const folder = process.argv[2] || 'output/wear-smoke';
mkdirSync(folder, {recursive: true});
let passed = 0,
  failed = 0;
const check = (ok, what, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` (${detail})` : ''}`);
  ok ? passed++ : failed++;
};
const browser = await chromium.launch();
const page = await browser.newPage({viewport: {width: 1280, height: 720}});
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
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
page.on(
  'console',
  message => message.type() === 'error' && !message.text().includes('404') && errors.push(message.text()),
);
/** Runs in the page: a place above the track to look along it from, as far round as `share` of a lap. */
const viewpoint = share => {
  const t = window.__game.track,
    s = t.length * share,
    from = t.at(s - 9, 0),
    to = t.at(s + 9, 0);
  return [
    [from.x, t.height(s - 9, 0) + 7.5, from.z],
    [to.x, t.height(s + 9, 0), to.z],
  ];
};
/** Runs in the page: the share (%) of the lower middle of the picture that is clearly darker in the second screenshot. */
const darker = async ([first, second]) => {
  const pixels = async data => {
    const image = new Image();
    image.src = data;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const c = canvas.getContext('2d');
    c.drawImage(image, 0, 0);
    return c.getImageData(image.width * 0.2, image.height * 0.45, image.width * 0.6, image.height * 0.5).data;
  };
  const a = await pixels(first),
    b = await pixels(second);
  const light = (px, i) => 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
  let count = 0;
  for (let i = 0; i < a.length; i += 4) if (light(a, i) - light(b, i) > 14) count++;
  return (count / (a.length / 4)) * 100;
};
const VIEWS = [0.12, 0.33, 0.58, 0.8];
/** Photographs each view with only the game drawn, and returns the pictures as data URLs. */
async function photograph(name) {
  const seen = [];
  for (const share of VIEWS) {
    await page.evaluate(([from, to]) => window.__game.view(from, to), await page.evaluate(viewpoint, share));
    // The picture of the wear is sent at most four times a second; let it arrive and a frame be drawn.
    await page.waitForTimeout(1500);
    const path = `${folder}/${name}-${Math.round(share * 100)}.png`;
    const shot = await page.screenshot({path, timeout: 120000}).catch(() => null);
    seen.push(shot ? `data:image/png;base64,${shot.toString('base64')}` : null);
  }
  await page.evaluate(() => window.__game.view());
  return seen;
}
try {
  await page.goto(url, {waitUntil: 'commit'});
  await page.waitForFunction(() => window.__game && !document.querySelector('#loading:not(.hidden)'), null, {
    timeout: 60000,
  });
  await page.addStyleTag({content: 'body *{visibility:hidden!important}#game{visibility:visible!important}'});
  await select('#npcs', '7');
  await select('#laps', '3');
  await click('#start');
  // Paused on the countdown, so the bikes stand on the grid while the fresh dirt is photographed.
  await page.keyboard.press('Escape');
  const paused = await page.evaluate(() => window.__game.snapshot().paused);
  let wear = await page.evaluate(() => window.__game.wear());
  const course = await page.evaluate(() => window.__game.snapshot().course);
  check(paused && wear.sum === 0, 'the grid is empty at the start of the race', `sum ${wear.sum}`);
  check(
    course !== 'dusk' || wear.bytes <= 500000,
    'the wear grid is 0.5 MB or smaller',
    `${course}: ${wear.bytes} bytes`,
  );
  const riders = await page.evaluate(() => window.__game.riders().length);
  check(riders === 8, 'eight riders on the grid', `${riders}`);
  const before = await photograph('before');
  await page.keyboard.press('Escape');
  wear = await page.evaluate(() => (window.__game.toRacing(), window.__game.wear()));
  check(wear.sum === 0, 'and still empty when the gate drops', `sum ${wear.sum}`);

  // The picture is sent at most four times a second while the bikes are wearing the track.
  const first = (await page.evaluate(() => window.__game.wear())).uploads;
  const started = Date.now();
  await page.evaluate(async () => {
    const g = window.__game,
      until = performance.now() + 3000;
    while (performance.now() < until) {
      g.riders().forEach(r => r.human && g.drive(r.id));
      g.step(1 / 30);
      await new Promise(r => requestAnimationFrame(r));
    }
  });
  const seconds = (Date.now() - started) / 1000;
  const sent = (await page.evaluate(() => window.__game.wear())).uploads - first;
  check(
    sent >= 2 && sent <= Math.ceil(seconds * 4) + 1,
    'the wear picture is refreshed, at most 4 times a second',
    `${sent} in ${seconds.toFixed(1)} s`,
  );

  // The race, on autopilot, to its results.
  const state = await page.evaluate(() => {
    const g = window.__game;
    for (let i = 0; i < 60 * 900 && g.snapshot().phase === 'racing'; i++) {
      g.riders().forEach(r => r.human && g.drive(r.id));
      g.step(1 / 60);
    }
    return g.snapshot();
  });
  check(state.phase === 'results', 'the 3-lap race of eight is run', state.phase);
  wear = await page.evaluate(() => window.__game.wear());
  check(wear.worn > 5000, 'the race has worn the track', `${wear.worn} cells of ${wear.cols * wear.rows}`);
  // Wear physics is on by default: the race has cut ruts and braking bumps, and the mesh has followed.
  const worn = await page.evaluate(() => window.__game.surface());
  const raced = (Date.now() - started) / 1000;
  check(
    worn.on && worn.rut >= 0.5 && worn.rough > 0.1,
    'wear physics is on in a race, with ruts and braking bumps after 3 laps',
    `deepest rut ${worn.rut.toFixed(2)}, roughest bumps ${worn.rough.toFixed(2)}`,
  );
  check(
    worn.bump > 0.003 && worn.bump <= 0.0301,
    'the bumps are real height, 3 cm at most',
    `${(worn.bump * 100).toFixed(1)} cm`,
  );
  check(
    worn.redraws >= 1 && worn.redraws <= Math.ceil(raced) + 1,
    'the track mesh is redrawn, at most once a second',
    `${worn.redraws} in ${raced.toFixed(1)} s, ${worn.rows} rows the last time`,
  );
  const after = await photograph('after');
  const shares = [];
  for (let i = 0; i < VIEWS.length; i++)
    shares.push(before[i] && after[i] ? await page.evaluate(darker, [before[i], after[i]]) : null);
  check(
    shares.every(d => d !== null),
    'before and after photographed from the same four places',
  );
  check(
    shares.filter(d => d !== null && d >= 3).length >= 3,
    'the racing line is visibly darker after the race',
    'clearly darker: ' +
      shares.map(d => (d === null ? 'none' : `${d.toFixed(1)}%`)).join(', ') +
      ' of the track in view',
  );

  // The next race starts on fresh dirt.
  await page.evaluate(() => document.querySelector('#restart-results')?.click());
  await page
    .waitForFunction(() => window.__game.snapshot().phase !== 'results', null, {timeout: 10000})
    .catch(() => {});
  let next = await page.evaluate(() => window.__game.snapshot().phase);
  if (next === 'setup') {
    await click('#start');
    next = await page.evaluate(() => window.__game.snapshot().phase);
  }
  wear = await page.evaluate(() => window.__game.wear());
  check(next === 'countdown' && wear.sum === 0, 'the next race starts on fresh dirt', `${next}, sum ${wear.sum}`);
  const fresh = await page.evaluate(() => window.__game.surface());
  check(
    fresh.on && fresh.rut === 0 && fresh.rough === 0,
    'and with no ruts or bumps',
    `rut ${fresh.rut}, bumps ${fresh.rough}`,
  );

  // The setting: off for a race when unticked, remembered, and never on in a Time Trial.
  const toSetup = async () => {
    await page.keyboard.press('Escape');
    await click('#setup-pause');
    if ((await page.evaluate(() => window.__game.snapshot().phase)) === 'results') await click('#setup-results');
  };
  await toSetup();
  const ticked = await page.evaluate(() => document.querySelector('#wear-physics').checked);
  await click('#wear-physics');
  await click('#start');
  let off = await page.evaluate(() => (window.__game.toRacing(), window.__game.surface()));
  check(ticked && !off.on, 'unticking the setting turns wear physics off for the race');
  await page.reload({waitUntil: 'commit'});
  await page.waitForFunction(() => window.__game && !document.querySelector('#loading:not(.hidden)'), null, {
    timeout: 60000,
  });
  const kept = await page.evaluate(() => document.querySelector('#wear-physics').checked);
  check(kept === false, 'the setting is remembered after a reload');
  await click('#wear-physics');
  await click('#trial-mode');
  await click('#start');
  off = await page.evaluate(() => (window.__game.toRacing(), window.__game.surface()));
  const trial = await page.evaluate(() => window.__game.snapshot().trial);
  check(trial && !off.on, 'wear physics is off in a Time Trial, with the setting ticked');
  check(errors.length === 0, 'no page errors', errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}
console.log(`wear-smoke: ${passed}/${passed + failed} checks passed`);
process.exit(failed ? 1 : 0);
