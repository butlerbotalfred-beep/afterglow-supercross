// Checks that the lap timing panel does not overlap any other HUD element, in the four layouts the plan names:
// 1, 2 and 4 riders at 1280 x 720, and one rider on an 844 x 390 phone screen with touch controls.
// Needs the dev server (it uses the development hooks) and Playwright:
//   AFTERGLOW_URL=http://localhost:5173 NODE_PATH=$(npm root -g) node scripts/hud-layout-check.mjs [folder for screenshots]
import {createRequire} from 'node:module';
import {mkdirSync} from 'node:fs';

const {chromium} = createRequire(import.meta.url)('playwright');
const url = process.env.AFTERGLOW_URL || 'http://localhost:5173';
const folder = process.argv[2] || 'output';
mkdirSync(folder, {recursive: true});
const LAYOUTS = [
  {name: '1-rider', width: 1280, height: 720, humans: 1},
  {name: '2-riders', width: 1280, height: 720, humans: 2},
  {name: '4-riders', width: 1280, height: 720, humans: 4},
  {name: 'phone', width: 844, height: 390, humans: 1, phone: true},
];
/** Runs in the page: starts a race in the wanted layout and rides until a sector time is on screen. */
const setUp = async ({humans, phone}) => {
  const g = window.__game;
  const select = (selector, value) => {
    const node = document.querySelector(selector);
    node.value = value;
    node.dispatchEvent(new Event('change', {bubbles: true}));
  };
  if (phone) select('#play-device', 'iphone');
  else {
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
  }
  select('#course', 'coast');
  select('#npcs', '3');
  document.querySelector('#start').click();
  g.step(3.9);
  // Ride on autopilot until rider 1 has just finished a lap, so the panel is showing its longest text.
  for (let i = 0; i < 4000 && g.timing()[0].laps.length < 1; i++) {
    g.riders().forEach(r => r.human && g.drive(r.id));
    g.step(0.1);
  }
  g.step(0.05);
  return {laps: g.timing()[0].laps.length, phase: g.snapshot().phase};
};
/** Runs in the page: every visible HUD element's box, by viewport. */
const measure = worst => {
  if (worst) {
    // The widest and busiest the HUD gets, written in just before measuring (the game redraws it next frame):
    // times of ten minutes or more, a lap result with its difference, a crash notice and a practice target.
    for (const view of document.querySelectorAll('.viewport-hud')) {
      view.querySelector('.lap-now').textContent = '12:34.5';
      view.querySelector('.lap-last').textContent = '12:34.567';
      view.querySelector('.lap-best').textContent = '12:34.567';
      const split = view.querySelector('.lap-split');
      split.textContent = 'LAP 12:34.567  −12.345';
      split.className = 'lap-split faster';
      view.querySelector('.rider-notice').innerHTML =
        '<b class="crash-label">CRASH / AWKWARD LANDING</b><small>REMOUNT IN 2.1s · GETTING BACK UP</small>';
      view.querySelector('.test-target').textContent = '★ O12 · TABLETOP · 188 m ahead';
    }
  }
  const box = node => {
    const r = node.getBoundingClientRect();
    return {x: r.left, y: r.top, right: r.right, bottom: r.bottom};
  };
  const shown = node => {
    const style = getComputedStyle(node);
    const r = node.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  };
  const shared = [
    '#race-bar',
    '#pause-button',
    '#race-mute',
    '.race-info',
    '.touch-steering',
    '.touch-actions',
    '.touch-button',
  ]
    .flatMap(s => [...document.querySelectorAll(s)].map(node => ({name: s, node})))
    .filter(e => shown(e.node))
    .map(e => ({name: e.name, ...box(e.node)}));
  return [...document.querySelectorAll('.viewport-hud')].map((view, index) => ({
    index,
    view: box(view),
    timing: box(view.querySelector('.timing')),
    text: view.querySelector('.timing').innerText.replace(/\s+/g, ' '),
    others: [
      ...[
        '.position',
        '.identity',
        '.lap',
        '.rider-notice b',
        '.rider-notice small',
        '.test-target',
        '.mini-map',
        '.speed',
      ]
        .flatMap(s => [...view.querySelectorAll(s)].map(node => ({name: s, node})))
        .filter(e => shown(e.node) && (e.node.textContent.trim() || e.node.querySelector('canvas')))
        .map(e => ({name: e.name, ...box(e.node)})),
      ...shared,
    ],
  }));
};
const overlaps = (a, b) => a.x < b.right - 0.5 && b.x < a.right - 0.5 && a.y < b.bottom - 0.5 && b.y < a.bottom - 0.5;

let failures = 0;
const browser = await chromium.launch();
try {
  for (const layout of LAYOUTS) {
    const page = await browser.newPage({
      viewport: {width: layout.width, height: layout.height},
      hasTouch: !!layout.phone,
      isMobile: !!layout.phone,
    });
    page.setDefaultTimeout(0);
    await page.goto(url, {waitUntil: 'commit'});
    await page.waitForFunction(() => window.__game && !document.getElementById('loading'), null, {timeout: 0});
    const state = await page.evaluate(setUp, layout);
    const views = await page.evaluate(measure, false);
    const busiest = await page.evaluate(measure, true);
    const problems = [];
    for (const v of [...views, ...busiest.map(b => ({...b, worst: true}))]) {
      const where = `rider ${v.index + 1}${v.worst ? ' (busiest HUD)' : ''}`;
      if (
        v.timing.x < v.view.x - 0.5 ||
        v.timing.right > v.view.right + 0.5 ||
        v.timing.y < v.view.y - 0.5 ||
        v.timing.bottom > v.view.bottom + 0.5
      )
        problems.push(`${where}: timing panel leaves its view`);
      for (const other of v.others) if (overlaps(v.timing, other)) problems.push(`${where}: overlaps ${other.name}`);
    }
    if (state.laps < 1) problems.push('no lap was completed, so the panel was not showing a lap time');
    failures += problems.length;
    console.log(
      `${problems.length ? 'FAIL' : 'ok  '} ${layout.name} ${layout.width} x ${layout.height}: ${views.length} view(s), ` +
        `${[...views, ...busiest].reduce((n, v) => n + v.others.length, 0)} comparisons, panel reads "${views[0].text}"` +
        (problems.length ? `\n     ${problems.join('\n     ')}` : ''),
    );
    await page.screenshot({path: `${folder}/hud-${layout.name}.png`, timeout: 0});
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(
  failures ? `hud-layout-check: ${failures} problem(s)` : 'hud-layout-check: timing panel is clear in all 4 layouts',
);
process.exit(failures ? 1 : 0);
