// Browser test of the production build's loading behaviour. Needs `npm run build` first and Playwright.
//   NODE_PATH=$(npm root -g) node scripts/load-smoke.mjs
// It serves dist/ from a sub-folder address (to prove no path depends on the site root) and checks:
//   1. the loading screen stays up until every texture has arrived, on a deliberately held-back network
//   2. no PNG is requested, nothing fails to load and the console has no errors
//   3. the track editor's code is not downloaded until Edit track is pressed
import {createServer} from 'node:http';
import {existsSync, readFileSync, statSync} from 'node:fs';
import {extname, join, normalize} from 'node:path';
import {createRequire} from 'node:module';

// require() rather than import, so a globally installed Playwright is found through NODE_PATH.
const {chromium} = createRequire(import.meta.url)('playwright');
const dist = new URL('../dist/', import.meta.url).pathname;
if (!existsSync(join(dist, 'index.html'))) {
  console.error('load-smoke: dist/ is missing. Run npm run build first.');
  process.exit(1);
}
const FOLDER = '/games/afterglow/';
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
};
const server = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://x').pathname);
  const inside = path.startsWith(FOLDER) ? normalize(path.slice(FOLDER.length) || 'index.html') : null;
  const file = inside && !inside.startsWith('..') ? join(dist, inside) : null;
  if (!file || !existsSync(file) || statSync(file).isDirectory()) {
    response.writeHead(404).end('not found');
    return;
  }
  response.writeHead(200, {'content-type': TYPES[extname(file)] || 'application/octet-stream'});
  response.end(readFileSync(file));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}${FOLDER}`;

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};
const browser = await chromium.launch();
try {
  const page = await browser.newPage({viewport: {width: 1280, height: 720}});
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
  await waitForHeld();
  let released = 0,
    alwaysShown = true,
    last = await loadingState();
  check('loading screen covers the page while textures are held back', last.shown, `${last.text}, bar ${last.bar}`);
  const widths = [parseInt(last.bar) || 0];
  // Release textures one at a time. Before each release the loading screen must still be up.
  for (;;) {
    await waitForHeld();
    if (!held.length) break;
    last = await loadingState();
    alwaysShown &&= last.shown;
    widths.push(parseInt(last.bar) || 0);
    await held.shift().continue();
    released++;
    await page.waitForTimeout(400);
  }
  check('loading screen stayed up until the last texture was released', alwaysShown, `${released} textures`);
  check(
    'the bar only moves forward',
    widths.every((w, i) => i === 0 || w >= widths[i - 1]) && widths.at(-1) > widths[0],
    widths.map(w => `${w}%`).join(' → '),
  );
  await page.waitForFunction(() => !document.getElementById('loading'), null, {timeout: 20000});
  check('loading screen is removed once every texture is ready', true);
  check('setup screen is showing', await page.isVisible('#setup'));
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
} finally {
  await browser.close();
  server.close();
}
const passed = checks.filter(Boolean).length;
console.log(`load-smoke: ${passed}/${checks.length} checks passed`);
process.exit(passed === checks.length ? 0 : 1);
