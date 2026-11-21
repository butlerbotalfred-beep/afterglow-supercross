// Browser test of the production build's loading behaviour. Needs `npm run build` first and Playwright.
//   NODE_PATH=$(npm root -g) node scripts/load-smoke.mjs
// It serves dist/ from a sub-folder address (to prove no path depends on the site root) and checks:
//   1. the loading screen stays up until every texture has arrived, on a deliberately held-back network
//   2. no PNG is requested, nothing fails to load and the console has no errors
//   3. the track editor's code is not downloaded until Edit track is pressed
import {createRequire} from 'node:module';
import {serveDist} from './serve-dist.mjs';

// require() rather than import, so a globally installed Playwright is found through NODE_PATH.
const {chromium} = createRequire(import.meta.url)('playwright');
const server = await serveDist('/games/afterglow/');
const url = server.url;

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};
const browser = await chromium.launch();
try {
  // A small window keeps software rendering quick, so the test stays well inside the 30-second stall allowance.
  const page = await browser.newPage({viewport: {width: 480, height: 270}});
  const requested = [],
    failed = [],
    errors = [];
  page.on('request', r => requested.push(r.url()));
  page.on('requestfailed', r => failed.push(r.url()));
  page.on('response', r => r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`));
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));

  // Hold every texture back until released, like a slow connection.
  const held = [];
  await page.route('**/art/**', route => held.push(route));
  // Software rendering makes this page slow, so lift the game's 30-second limit on a stalled texture here.
  await page.addInitScript(() => (globalThis.AFTERGLOW_STALL_SECONDS = 3600));
  await page.goto(url, {waitUntil: 'commit'});
  await page.waitForFunction(() => /Loading textures/.test(document.getElementById('loading-text')?.textContent || ''));
  const waitForHeld = async () => {
    for (let i = 0; i < 100 && !held.length; i++) await page.waitForTimeout(50);
  };
  const loadingState = () =>
    page.evaluate(() => {
      const root = document.getElementById('loading');
      const box = root?.getBoundingClientRect();
      return {
        shown:
          !!root && box.width >= innerWidth && box.height >= innerHeight && getComputedStyle(root).display !== 'none',
        text: document.getElementById('loading-text')?.textContent || '',
        bar: document.getElementById('loading-bar')?.style.width || '',
      };
    });
  // Wait until every texture request is being held (none new for a second).
  for (let quiet = 0, seen = 0; quiet < 20; quiet = held.length === seen ? quiet + 1 : 0, seen = held.length)
    await page.waitForTimeout(50);
  let last = await loadingState();
  check('loading screen covers the page while textures are held back', last.shown, `${last.text}, bar ${last.bar}`);
  check('the page behind it cannot be used yet', await page.evaluate(() => document.getElementById('app').inert));
  const finishedCount = text => Number(/(\d+) of/.exec(text)?.[1] ?? -1);
  const widths = [parseInt(last.bar) || 0],
    steps = [last.text];
  const total = held.length;
  let shownAfterEachRelease = true;
  // Release all but one texture, one at a time. After each, wait for the page to count it, then the loading
  // screen must still be up.
  while (held.length > 1) {
    const before = finishedCount(last.text);
    await held.shift().continue();
    await page.waitForFunction(
      n => Number(/(\d+) of/.exec(document.getElementById('loading-text')?.textContent || '')?.[1] ?? 1e9) > n,
      before,
      {timeout: 30000},
    );
    last = await loadingState();
    shownAfterEachRelease &&= last.shown;
    widths.push(parseInt(last.bar) || 0);
    steps.push(last.text);
  }
  check(
    `loading screen was still up after each of the first ${total - 1} of ${total} textures arrived`,
    total >= 4 && shownAfterEachRelease,
    steps.map(t => t.replace('Loading textures ', '')).join(' → '),
  );
  check(
    'the bar only moves forward',
    widths.every((w, i) => i === 0 || w > widths[i - 1]),
    widths.map(w => `${w}%`).join(' → '),
  );
  await held.shift().continue();
  await page.waitForFunction(() => !document.getElementById('loading'), null, {timeout: 20000});
  check('loading screen is removed once every texture is ready', true);
  check(
    'setup screen is showing and usable',
    (await page.isVisible('#setup')) && !(await page.evaluate(() => document.getElementById('app').inert)),
  );
  const art = requested.filter(u => u.includes('/art/'));
  check(
    'textures come from the page folder as WebP',
    art.length >= 4 && art.every(u => u.startsWith(url) && u.endsWith('.webp')),
  );
  check('no PNG requested', !requested.some(u => /\.png(\?|$)/.test(u)));
  await page.unroute('**/art/**');

  // The editor's code must not arrive until it is asked for.
  const editorFile = u => /track-editor[\w.-]*\.js/.test(u);
  check('track editor code not downloaded before Edit track', !requested.some(editorFile));
  // Clicked from inside the page: a simulated mouse click can stall on a slow software renderer.
  await page.evaluate(() => document.getElementById('open-editor').click());
  await page.waitForSelector('#track-editor:not(.hidden)', {timeout: 20000});
  check('track editor code downloaded after Edit track, and the editor opens', requested.some(editorFile));
  await page.waitForLoadState('networkidle');
  check('nothing failed to load', !failed.length, failed.join(', '));
  check('no console errors', !errors.length, errors.join(' | '));
  check(
    'every request stayed inside the page folder',
    requested.every(u => u.startsWith(url)),
  );

  // A texture that never arrives must not hold the loading screen for ever.
  const stalledPage = await browser.newPage({viewport: {width: 480, height: 270}});
  await stalledPage.addInitScript(() => (globalThis.AFTERGLOW_STALL_SECONDS = 2));
  await stalledPage.route('**/art/**', () => {});
  await stalledPage.goto(url, {waitUntil: 'commit'});
  const gaveUp = await stalledPage
    .waitForFunction(() => !!document.getElementById('setup') && !document.getElementById('loading'), null, {
      timeout: 60000,
    })
    .then(
      () => true,
      () => false,
    );
  check('with every texture stalled, the loading screen gives up after its limit and the game is usable', gaveUp);

  // If a script fails to download, the loading screen must say so, not sit on "Loading".
  const brokenPage = await browser.newPage({viewport: {width: 480, height: 270}});
  await brokenPage.route('**/assets/three-*.js', route => route.abort());
  await brokenPage.goto(url, {waitUntil: 'commit'});
  const said = await brokenPage
    .waitForFunction(() => /could not start/i.test(document.getElementById('loading-text')?.textContent || ''), null, {
      timeout: 30000,
    })
    .then(
      () => true,
      () => false,
    );
  check('a failed script download shows "could not start" on the loading screen', said);
} finally {
  await browser.close();
  server.close();
}
const passed = checks.filter(Boolean).length;
console.log(`load-smoke: ${passed}/${checks.length} checks passed`);
process.exit(passed === checks.length ? 0 : 1);
