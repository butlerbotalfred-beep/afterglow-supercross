import test from 'node:test';
import assert from 'node:assert/strict';
import {Track} from '../src/track';
import {TUNING} from '../src/config';
import {makeRider, stepRider, collide, crash, idleControl} from '../src/physics';
import {progressDistance, createProgress, updateProgress} from '../src/race';
function flat() {
  const t = new Track(),
    p = t.at(0);
  t.height = () => 0;
  t.at = (s, lateral = 0) => ({...p, s, x: lateral, z: s, tx: 0, tz: 1, lateral, distance: Math.abs(lateral)});
  t.project = (x, z) => t.at(z, x);
  return t;
}
function landing(pitch: number, vy: number, speed = 18) {
  const t = flat(),
    r = makeRider(t, 0, true, 0xffffff);
  Object.assign(r, {x: 0, z: 1, y: 0.025, surface: t.at(1), grounded: false, pitch, vy, speed, heading: 0});
  stepRider(r, idleControl(), t, 1 / 120, [r]);
  return r;
}
test('aligned landings stay rideable; awkward or excessive normal impacts crash', () => {
  assert.equal(landing(0, -10).crashes, 0);
  const awkward = landing(1.08, -10);
  assert.equal(awkward.crashReason, 'AWKWARD LANDING');
  assert.ok(awkward.crashTime > 0);
  const hard = landing(0, -25);
  assert.equal(hard.crashReason, 'HARD LANDING');
  assert.equal(landing(1.08, -2, 2).crashes, 0, 'low-energy tip does not trigger a punitive crash');
});
test('contact uses closing impact velocity, allowing gentle same-direction rubbing', () => {
  const t = flat(),
    a = makeRider(t, 0, true, 1),
    b = makeRider(t, 1, true, 2);
  Object.assign(a, {x: 0, z: 0, y: 0, heading: Math.PI / 2, speed: 14});
  Object.assign(b, {x: 0.6, z: 0, y: 0, heading: -Math.PI / 2, speed: 14});
  collide([a, b], t);
  assert.equal(a.crashReason, 'RIDER CONTACT');
  assert.equal(b.crashes, 1);
  const c = makeRider(t, 2, true, 1),
    d = makeRider(t, 3, true, 2);
  Object.assign(c, {x: 0, z: 0, y: 0, heading: 0, speed: 45});
  Object.assign(d, {x: 0.6, z: 0, y: 0, heading: 0, speed: 45});
  collide([c, d], t);
  assert.equal(c.crashes + d.crashes, 0);
  assert.ok(Math.hypot(c.x - d.x, c.z - d.z) >= 0.849);
});
test('swept high-speed crossings crash even when the final positions do not overlap', () => {
  const t = flat(),
    a = makeRider(t, 0, true, 1),
    b = makeRider(t, 1, true, 2);
  Object.assign(a, {x: 0.46, z: 0, prevX: -0.46, prevZ: 0, y: 0, heading: Math.PI / 2, speed: 50});
  Object.assign(b, {x: -0.46, z: 0, prevX: 0.46, prevZ: 0, y: 0, heading: -Math.PI / 2, speed: 50});
  collide([a, b], t);
  assert.equal(a.crashes, 1);
  assert.equal(b.crashes, 1);
});
test('crash slides cannot earn checkpoints or bypass the timed recovery with reset', () => {
  const t = flat(),
    r = makeRider(t, 0, true, 1);
  r.speed = 40;
  const credit = progressDistance(r.progress, t.length);
  crash(r, 'RIDER CONTACT');
  stepRider(r, {...idleControl(), reset: true, throttle: 1}, t, 0.1, [r]);
  assert.ok(r.crashTime > 0);
  assert.equal(progressDistance(r.progress, t.length), credit);
  for (let i = 0; i < Math.ceil(TUNING.crashDuration * 120); i++) stepRider(r, idleControl(), t, 1 / 120, [r]);
  assert.equal(r.crashTime, 0);
  assert.ok(r.recovery > 0);
  assert.equal(r.speed, 0);
  assert.equal(r.progress.lap, 0);
  assert.equal(r.progress.nextCheckpoint, 1);
});

function place(t: Track, r: ReturnType<typeof makeRider>, s: number, lateral = 0) {
  const p = t.at(s, lateral);
  Object.assign(r, {x: p.x, z: p.z, y: 0, surface: p, heading: 0, speed: 0});
}
function atHundred() {
  const t = flat(),
    r = makeRider(t, 0, true, 1);
  r.progress = createProgress();
  for (let s = 1; s <= 100; s++) updateProgress(r.progress, s, 0, t.length, t.halfWidth, 1 / 120);
  place(t, r, 100);
  return {t, r};
}
test('a wreck gets up where the slide stops, preserving progress instead of returning to a gate', () => {
  const {t, r} = atHundred();
  r.speed = 30;
  crash(r, 'RIDER CONTACT');
  for (let i = 0; i < 300 && r.crashTime > 0; i++) stepRider(r, idleControl(), t, 1 / 120, [r]);
  assert.ok(r.surface.s > 100 && r.surface.s < 107, 'remount at settled wreck');
  assert.equal(r.crashTime, 0);
  assert.ok(r.recovery > 0);
  assert.equal(r.speed, 0);
  assert.ok(Math.abs(progressDistance(r.progress, t.length) - r.surface.s) < 1e-6);
  assert.equal(r.recoveryReason, 'REMOUNTING AT WRECK');
});
test('brief off-track exit and return does not force recovery or lose race progress', () => {
  const {t, r} = atHundred();
  for (let s = 101; s <= 112; s++) {
    place(t, r, s, 7);
    stepRider(r, idleControl(), t, 1 / 120, [r]);
    assert.equal(r.recovery, 0);
  }
  assert.equal(progressDistance(r.progress, t.length), 100);
  place(t, r, 113);
  stepRider(r, idleControl(), t, 1 / 120, [r]);
  assert.equal(r.recovery, 0);
  assert.equal(r.progress.routeBroken, false);
  assert.ok(Math.abs(progressDistance(r.progress, t.length) - 113) < 1e-6);
});
test('advancing too far outside automatically returns to the original exit, including re-entry ahead', () => {
  for (const reenter of [false, true]) {
    const {t, r} = atHundred();
    for (let s = 101; s <= 130; s++) {
      place(t, r, s, 7);
      stepRider(r, idleControl(), t, 1 / 120, [r]);
      assert.equal(r.recovery, 0);
    }
    place(t, r, 131, reenter ? 0 : 7);
    stepRider(r, idleControl(), t, 1 / 120, [r]);
    assert.equal(r.surface.s, 100);
    assert.ok(r.recovery > 0);
    assert.equal(progressDistance(r.progress, t.length), 100);
    assert.equal(r.recoveryReason, 'SHORTCUT / BACK TO TRACK EXIT');
    assert.equal(r.progress.excursion, null);
  }
});
test('a crash cannot erase an off-track departure or launder a shortcut', () => {
  const {t, r} = atHundred();
  for (let s = 101; s <= 129; s++) {
    place(t, r, s, 7);
    stepRider(r, idleControl(), t, 1 / 120, [r]);
  }
  r.speed = 30;
  crash(r, 'RIDER CONTACT');
  for (let i = 0; i < 300 && r.crashTime > 0; i++) stepRider(r, idleControl(), t, 1 / 120, [r]);
  assert.equal(r.surface.s, 100);
  assert.equal(progressDistance(r.progress, t.length), 100);
  assert.equal(r.recoveryReason, 'SHORTCUT / BACK TO TRACK EXIT');
});
test('a minor off-track crash remounts alongside the wreck instead of returning to the departure', () => {
  const {t, r} = atHundred();
  place(t, r, 105, 6);
  stepRider(r, idleControl(), t, 1 / 120, [r]);
  crash(r, 'RIDER CONTACT');
  for (let i = 0; i < 300 && r.crashTime > 0; i++) stepRider(r, idleControl(), t, 1 / 120, [r]);
  assert.equal(r.surface.s, 105);
  assert.equal(r.surface.lateral, t.halfWidth);
  assert.equal(progressDistance(r.progress, t.length), 105);
  assert.equal(r.recoveryReason, 'REMOUNTING AT WRECK');
});
