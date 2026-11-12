import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const cli = (...args) =>
  execFileSync(
    'npm',
    ['exec', '--yes', '--package=agent-browser@0.27.0', '--', 'agent-browser', '--session', 'iphone-check', ...args],
    {encoding: 'utf8', timeout: 30000},
  ).trim();
cli('open', 'http://localhost:5173');
const socket = new WebSocket(cli('get', 'cdp-url'));
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});
let seq = 0;
const pending = new Map();
socket.onmessage = ({data}) => {
  const m = JSON.parse(data);
  if (!m.id) return;
  const p = pending.get(m.id);
  if (p) {
    pending.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
  }
};
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, {resolve, reject});
    socket.send(JSON.stringify({id, method, params, sessionId}));
  });
const targets = await send('Target.getTargets');
const target = targets.targetInfos.find(t => t.type === 'page' && t.url.startsWith('http://localhost:5173'));
const {sessionId} = await send('Target.attachToTarget', {targetId: target.targetId, flatten: true});
const cdp = (method, params) => send(method, params, sessionId);
const evaluate = async expression => {
  const r = await cdp('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const viewport = async (w, h) => {
  await cdp('Emulation.setDeviceMetricsOverride', {
    width: w,
    height: h,
    deviceScaleFactor: 2,
    mobile: true,
    screenOrientation: {type: w > h ? 'landscapePrimary' : 'portraitPrimary', angle: w > h ? 90 : 0},
  });
  await wait(150);
};
const touch = (type, points) =>
  cdp('Input.dispatchTouchEvent', {type, touchPoints: points.map(p => ({...p, radiusX: 8, radiusY: 8, force: 1}))});
const center = selector =>
  evaluate(
    `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
  );
const capture = async path => {
  const {data} = await cdp('Page.captureScreenshot', {format: 'png'});
  writeFileSync(path, Buffer.from(data, 'base64'));
};
const checks = [];
try {
  await cdp('Emulation.setTouchEmulationEnabled', {enabled: true, maxTouchPoints: 5});
  await viewport(844, 390);
  assert.equal(await evaluate('document.querySelector("#play-device").value'), 'desktop');
  assert.equal(await evaluate('getComputedStyle(document.querySelector("#touch-controls")).display'), 'none');
  // Desktop race remains free of touch overlays even in a phone-sized browser.
  await evaluate('document.querySelector("#start").click();window.__game.step(4);');
  assert.equal(await evaluate('getComputedStyle(document.querySelector("#touch-controls")).display'), 'none');
  checks.push('Desktop default and desktop race have no touch overlay');
  await evaluate(
    'document.querySelector("#pause-button").click();document.querySelector("#setup-pause").click();Object.defineProperty(navigator,"getGamepads",{configurable:true,value:undefined});var s=document.querySelector("#play-device");s.value="iphone";s.dispatchEvent(new Event("change"));document.querySelector("#npcs").value="0";',
  );
  assert.equal(await evaluate('document.querySelector("#humans").disabled'), true);
  assert.equal(await evaluate('document.querySelector("#touch-steering").value'), 'regular');
  assert.equal(await evaluate('document.querySelector("#touch-pitch").value'), 'regular');
  assert.equal(await evaluate('getComputedStyle(document.querySelector("#touch-controls")).display'), 'none');
  await capture('output/iphone-setup.png');
  await evaluate('document.querySelector("#start").click();window.__game.step(4);');
  await wait(150);
  assert.notEqual(await evaluate('getComputedStyle(document.querySelector("#touch-controls")).display'), 'none');
  checks.push('Explicit iPhone selection enables one touch rider only after starting');
  await evaluate(
    'window.dispatchEvent(new KeyboardEvent("keydown",{code:"KeyW"}));window.__game.step(.2);window.dispatchEvent(new KeyboardEvent("keyup",{code:"KeyW"}));',
  );
  assert.equal(await evaluate('window.__game.riders()[0].speed'), 0);
  checks.push('Keyboard does not cross-control touch rider; unavailable Gamepad API does not crash');
  const stick = await center('.touch-stick'),
    gas = await center('.touch-throttle'),
    brake = await center('.touch-brake');
  const heading = await evaluate('window.__game.riders()[0].heading');
  await touch('touchStart', [
    {id: 1, ...stick},
    {id: 2, ...gas},
  ]);
  await touch('touchMove', [
    {id: 1, x: stick.x + 26, y: stick.y - 18},
    {id: 2, ...gas},
  ]);
  await wait(650);
  const riding = await evaluate(
    '({speed:window.__game.riders()[0].speed,heading:window.__game.riders()[0].heading,steer:window.__game.riders()[0].steer})',
  );
  assert.ok(riding.speed > 5 && riding.heading < heading && riding.steer < -0.4);
  checks.push('Real browser multi-touch steers while accelerating');
  await capture('output/iphone-touch.png');
  await touch('touchCancel', []);
  await wait(80);
  assert.equal(await evaluate('window.__game.riders()[0].throttle'), 0);
  assert.equal(await evaluate('window.__game.riders()[0].steer'), 0);
  checks.push('Pointer cancellation releases steering and throttle');
  const preBrake = await evaluate('window.__game.riders()[0].speed');
  await touch('touchStart', [{id: 3, ...brake}]);
  await wait(300);
  await touch('touchEnd', []);
  assert.ok((await evaluate('window.__game.riders()[0].speed')) < preBrake * 0.6);
  checks.push('Touch brake reduces speed');
  const reset = await center('[data-touch="reset"]');
  await touch('touchStart', [{id: 4, ...reset}]);
  await wait(50);
  await touch('touchEnd', []);
  assert.ok((await evaluate('window.__game.riders()[0].recovery')) > 1);
  checks.push('Touch recover uses checkpoint and recovery delay');
  await touch('touchStart', [{id: 5, ...gas}]);
  await evaluate('document.querySelector(".touch-pause").click()');
  await touch('touchEnd', []);
  assert.equal(await evaluate('window.__game.snapshot().paused'), true);
  assert.equal(await evaluate('getComputedStyle(document.querySelector("#touch-controls")).display'), 'none');
  await evaluate('document.querySelector("#resume").click();window.__game.step(2);');
  assert.equal(await evaluate('window.__game.riders()[0].throttle'), 0);
  checks.push('Pause hides controls and resume has no stuck throttle');
  await touch('touchStart', [{id: 6, ...gas}]);
  await viewport(390, 844);
  await touch('touchEnd', []);
  await wait(80);
  assert.equal(await evaluate('window.__game.riders()[0].throttle'), 0);
  assert.equal(await evaluate('document.querySelector("#game").getBoundingClientRect().width'), 390);
  assert.equal(await evaluate('document.querySelector("#touch-controls").getBoundingClientRect().width'), 390);
  await capture('output/iphone-portrait.png');
  checks.push('Rotation clears touches; portrait layout remains usable');
  await evaluate('document.querySelector("#pause-button").click();document.querySelector("#restart-pause").click();');
  assert.notEqual(await evaluate('getComputedStyle(document.querySelector("#touch-controls")).display'), 'none');
  checks.push('Restart retains explicitly selected iPhone mode');
  await evaluate(
    'document.querySelector("#pause-button").click();document.querySelector("#setup-pause").click();var s=document.querySelector("#play-device");s.value="desktop";s.dispatchEvent(new Event("change"));document.querySelector("#start").click();window.__game.step(4);',
  );
  assert.equal(await evaluate('getComputedStyle(document.querySelector("#touch-controls")).display'), 'none');
  checks.push('Switching back to Mac removes touch controls');
  // Configure both directions while paused, then restart and drive with real contacts.
  await viewport(844, 390);
  await evaluate(
    'document.querySelector("#pause-button").click();document.querySelector("#setup-pause").click();var s=document.querySelector("#play-device");s.value="iphone";s.dispatchEvent(new Event("change"));document.querySelector("#start").click();document.querySelector("#pause-button").click();for(var id of ["pause-touch-steering","pause-touch-pitch"]){var field=document.getElementById(id);field.value="inverted";field.dispatchEvent(new Event("change"));}',
  );
  assert.equal(await evaluate('document.querySelector("#touch-steering").value'), 'inverted');
  assert.equal(await evaluate('document.querySelector("#touch-pitch").value'), 'inverted');
  await evaluate('document.querySelector("#restart-pause").click();window.__game.step(4);');
  await wait(100);
  const reverseHeading = await evaluate('window.__game.riders()[0].heading'),
    reverseStick = await center('.touch-stick'),
    reverseGas = await center('.touch-throttle');
  await touch('touchStart', [
    {id: 8, ...reverseStick},
    {id: 9, ...reverseGas},
  ]);
  await touch('touchMove', [
    {id: 8, x: reverseStick.x + 26, y: reverseStick.y - 18},
    {id: 9, ...reverseGas},
  ]);
  await wait(500);
  assert.ok((await evaluate('window.__game.riders()[0].heading')) > reverseHeading);
  await touch('touchEnd', []);
  checks.push('Regular and Inverted steer in opposite directions; setup/pause settings sync and survive restart');
  await evaluate(
    'document.querySelector("#pause-button").click();document.querySelector("#restart-pause").click();window.__game.step(4);',
  );
  const nose = await center('.touch-nose'),
    noseGas = await center('.touch-throttle'),
    noseStick = await center('.touch-stick');
  assert.equal(
    await evaluate(`document.elementFromPoint(${nose.x},${nose.y}).closest('[data-touch]')?.dataset.touch`),
    'noseDown',
  );
  await touch('touchStart', [
    {id: 11, ...nose},
    {id: 12, ...noseGas},
    {id: 13, ...noseStick},
  ]);
  const dip = await evaluate(
    `(()=>{const g=window.__game,r=g.riders()[0];for(let i=0;i<1200&&r.grounded;i++){g.drive(0);g.step(1/120);}const before=r.pitch;g.setControl(0,null);g.step(.2);return {before,after:r.pitch,throttle:r.throttle,air:!r.grounded};})()`,
  );
  assert.ok(dip.air && dip.after < dip.before - 0.4 && dip.throttle === 1, JSON.stringify(dip));
  await capture('output/iphone-nose-down.png');
  await touch('touchCancel', []);
  await evaluate('window.__game.step(.02)');
  assert.equal(await evaluate('window.__game.riders()[0].throttle'), 0);
  checks.push(
    'Dedicated nose-down button works during real takeoff with simultaneous gas/stick and inverted pitch; cancel releases contacts',
  );
  await evaluate(
    'document.querySelector("#pause-button").click();document.querySelector("#pause-touch-directions").scrollIntoView({block:"center"});',
  );
  await capture('output/iphone-direction-options.png');
  const errors = cli('errors');
  assert.equal(errors, '');
  writeFileSync(
    'output/touch-verification.json',
    JSON.stringify(
      {checks, errors, scope: 'Chromium mobile emulation, real multi-touch via CDP; no physical iPhone tested', riding},
      null,
      2,
    ),
  );
  console.log(JSON.stringify({checks, errors}, null, 2));
} finally {
  socket.close();
  cli('close');
}
