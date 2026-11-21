// Browser test of a production build, local or hosted. Needs Playwright.
//   NODE_PATH=$(npm root -g) node scripts/prod-smoke.mjs                          the local dist/ (npm run build first)
//   NODE_PATH=$(npm root -g) node scripts/prod-smoke.mjs https://example.app/     a hosted build
//   ... --expect-stamp abc1234       also require the setup screen to show BUILD abc1234
//   ... --layout-from <address>      export a layout at that address and import and ride it at the tested one
// It checks that the page loads cleanly, that a simulated gamepad can join and start a race, and (with
// --layout-from) that a layout exported at one address imports and rides at another.
import {createRequire} from 'node:module';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {serveDist} from './serve-dist.mjs';

// require() rather than import, so a globally installed Playwright is found through NODE_PATH.
const {chromium} = createRequire(import.meta.url)('playwright');
const args = process.argv.slice(2);
const option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const expectStamp = option('--expect-stamp');
const layoutFrom = option('--layout-from');
const given = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const local = given ? null : await serveDist('/');
const url = given || local.url;
// A second local copy at a different address stands in for "the other address" when asked for `local`.
const other = layoutFrom === 'local' ? await serveDist('/other-address/') : null;
const layoutUrl = other?.url || layoutFrom;

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};
// A stand-in controller. The page sees it through the normal browser gamepad call.
const fakeGamepad = () => {
  const pad = {
    index: 0,
    id: 'Smoke Test Controller (STANDARD GAMEPAD)',
    connected: true,
    mapping: 'standard',
    timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({length: 17}, () => ({pressed: false, touched: false, value: 0})),
  };
  window.__pad = {
    plugged: false,
    set(button, value) {
      pad.buttons[button] = {pressed: value > 0.5, touched: value > 0, value};
    },
  };
  navigator.getGamepads = () => (window.__pad.plugged ? [pad, null, null, null] : [null, null, null, null]);
};
const ready = page =>
  page.waitForFunction(() => !!document.getElementById('setup') && !document.getElementById('loading'), null, {
    timeout: 180000,
  });
// Clicks run inside the page: a simulated mouse click can stall on a slow software renderer.
const click = (page, selector) => page.evaluate(s => document.querySelector(s).click(), selector);

const browser = await chromium.launch();
try {
  const context = await browser.newContext({viewport: {width: 640, height: 360}, acceptDownloads: true});
  const page = await context.newPage();
  const requested = [],
    failed = [],
    errors = [];
  page.on('request', r => requested.push(r.url()));
  page.on('requestfailed', r => failed.push(`${r.failure()?.errorText} ${r.url()}`));
  page.on('response', r => r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`));
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  await page.addInitScript(fakeGamepad);
  await page.goto(url, {waitUntil: 'commit'});
  await ready(page);
  const origin = new URL(page.url()).origin;
  if (given) check('served over HTTPS', page.url().startsWith('https://'), page.url());
  check('loads to the setup screen with the loading screen gone', true);
  const stamp = (await page.textContent('#build-stamp')).replace('BUILD', '').trim();
  check('setup screen shows a build stamp', /^[0-9a-f]{7}\+?$/.test(stamp), `BUILD ${stamp}`);
  if (expectStamp) check(`build stamp is ${expectStamp}`, stamp === expectStamp, `BUILD ${stamp}`);

  // Simulated gamepad: plug in, press A to join, press Menu to start, hold the right trigger to ride.
  const press = async (button, ms = 200) => {
    await page.evaluate(b => window.__pad.set(b, 1), button);
    await page.waitForTimeout(ms);
    await page.evaluate(b => window.__pad.set(b, 0), button);
    await page.waitForTimeout(ms);
  };
  await page.evaluate(() => (window.__pad.plugged = true));
  await page.waitForTimeout(500);
  await press(0, 400);
  const joined = await page
    .waitForFunction(
      () => {
        const slot = document.querySelector('#slots [data-device="0"]');
        return slot && slot.value.startsWith('pad-') && !document.getElementById('start').disabled;
      },
      null,
      {timeout: 20000},
    )
    .then(
      () => true,
      () => false,
    );
  const slotText = await page.evaluate(() => {
    const select = document.querySelector('#slots [data-device="0"]');
    return `${select?.selectedOptions[0]?.textContent}, ${document.querySelector('#slots [data-ready="0"]')?.textContent}`;
  });
  check('simulated gamepad joins as rider 1 with the A button', joined, slotText);
  await press(9, 400);
  const started = await page
    .waitForFunction(
      () =>
        document.getElementById('setup').classList.contains('hidden') &&
        !document.getElementById('hud').classList.contains('hidden'),
      null,
      {timeout: 20000},
    )
    .then(
      () => true,
      () => false,
    );
  check('the Menu button starts the race', started);
  const gateDropped = await page
    .waitForFunction(() => document.getElementById('countdown').classList.contains('hidden'), null, {timeout: 240000})
    .then(
      () => true,
      () => false,
    );
  check(
    'the countdown runs and the gate drops',
    gateDropped,
    await page.evaluate(
      () =>
        `countdown ${document.getElementById('countdown').textContent}, pause menu ` +
        (document.getElementById('pause').classList.contains('hidden') ? 'hidden' : 'showing'),
    ),
  );
  await page.evaluate(() => window.__pad.set(7, 1));
  const moving = await page
    .waitForFunction(() => Number(document.querySelector('.speed strong')?.textContent) >= 20, null, {timeout: 120000})
    .then(
      () => true,
      () => false,
    );
  const speed = await page.textContent('.speed strong');
  check('holding the right trigger rides the bike', moving, `${speed} km/h`);
  await page.evaluate(() => window.__pad.set(7, 0));
  check(
    'the pause menu is not showing (no stray pause from the Menu press)',
    await page.evaluate(() => document.getElementById('pause').classList.contains('hidden')),
  );
  await page.waitForLoadState('networkidle');
  check('0 failed requests', !failed.length, failed.join(', '));
  check('0 console errors', !errors.length, errors.join(' | '));
  check(
    'every request stayed on the game address',
    requested.every(u => new URL(u).origin === origin),
    requested.filter(u => new URL(u).origin !== origin).join(', '),
  );

  if (layoutUrl) {
    // Export a layout at one address, then import and ride it at the tested address.
    // The race page is closed first so it does not compete for the graphics card.
    await page.close();
    const source = await context.newPage();
    await source.goto(layoutUrl, {waitUntil: 'commit'});
    await ready(source);
    await click(source, '#open-editor');
    await source.waitForSelector('#track-editor:not(.hidden) [data-action="export"]', {timeout: 60000});
    // Give the layout a name of its own, so its arrival at the other address can be recognised.
    const layoutName = `Smoke ${Date.now() % 1e6}`;
    await source.evaluate(name => {
      const input = document.getElementById('layout-name');
      input.value = name;
      input.dispatchEvent(new Event('input', {bubbles: true}));
    }, layoutName);
    const [download] = await Promise.all([
      source.waitForEvent('download', {timeout: 60000}),
      click(source, '#track-editor [data-action="export"]'),
    ]);
    const file = join(mkdtempSync(join(tmpdir(), 'afterglow-layout-')), download.suggestedFilename());
    await download.saveAs(file);
    check(
      'layout exported at the other address',
      true,
      `${download.suggestedFilename()} from ${new URL(layoutUrl).host}`,
    );
    await source.close();

    const target = await context.newPage();
    const targetErrors = [];
    target.on('pageerror', e => targetErrors.push(String(e)));
    await target.goto(url, {waitUntil: 'commit'});
    await ready(target);
    await click(target, '#open-editor');
    await target.waitForSelector('#track-editor:not(.hidden) #layout-import', {state: 'attached', timeout: 60000});
    await target.setInputFiles('#layout-import', file);
    const imported = await target
      .waitForFunction(name => document.getElementById('layout-name')?.value === name, layoutName, {timeout: 30000})
      .then(
        () => true,
        () => false,
      );
    check(
      'layout imported at the tested address',
      imported,
      `"${await target.inputValue('#layout-name')}" ${await target.textContent('#editor-status')}`,
    );
    await click(target, '#track-editor [data-action="ride"]');
    const riding = await target
      .waitForFunction(
        () =>
          !document.getElementById('hud').classList.contains('hidden') &&
          /FREE PRACTICE/.test(document.getElementById('session-label').textContent),
        null,
        {timeout: 60000},
      )
      .then(
        () => true,
        () => false,
      );
    check('the imported layout starts a test ride', riding, await target.textContent('#session-label'));
    check(
      'the imported layout is saved at the tested address',
      await target.evaluate(
        name =>
          Object.values(JSON.parse(localStorage.getItem('afterglow.save') || '{}').layouts || {}).some(
            l => l.name === name,
          ),
        layoutName,
      ),
    );
    check('no errors while importing and riding', !targetErrors.length, targetErrors.join(' | '));
  }
} finally {
  await browser.close();
  local?.close();
  other?.close();
}
const passed = checks.filter(Boolean).length;
console.log(`prod-smoke: ${passed}/${checks.length} checks passed at ${url}`);
process.exit(passed === checks.length ? 0 : 1);
