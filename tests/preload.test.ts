import test from 'node:test';
import assert from 'node:assert/strict';
import {TUNING} from '../src/config.ts';
import {COURSES} from '../src/courses.ts';
import {mapGamepad, mapKeyboard, neutralControl, routeControls, type Control} from '../src/input.ts';
import {crash, idleControl, makeRider, npcControl, stepRider} from '../src/physics.ts';
import {createProgress} from '../src/race.ts';
import {jumpCall} from '../src/takeoff.ts';
import {TouchInput} from '../src/touch-input.ts';
import {Track} from '../src/track.ts';
import {preloadMeter} from '../src/ui/hud.ts';

const dusk = new Track(COURSES.find(c => c.id === 'dusk')!);
/** The reference tabletop: the first jump of Dusk Valley, ridden at the speed the takeoff meter calls perfect. */
const reference = jumpCall(dusk, 12, 90)!;
const crest = 12 + reference.distance;
class FlatTrack extends Track {
  override height(_s: number, _lateral = 0) {
    return 0;
  }
}
const flat = new FlatTrack();

function place(track: Track, from: number, speed: number, human = true) {
  const r = makeRider(track, 0, human, 0xffffff),
    p = track.at(from);
  const progress = {...createProgress(from), lastLateral: p.lateral};
  Object.assign(r, {
    x: p.x,
    z: p.z,
    y: track.height(from),
    heading: Math.atan2(p.tx, p.tz),
    surface: p,
    speed,
    progress,
  });
  return r;
}
/**
 * One pass over the reference tabletop. `stick(metres to the crest)` is the stick position on the way in.
 * Heights are measured from where an untouched bike leaves the face, so the three jumps share one datum.
 */
function jump(stick: (toCrest: number, grounded: boolean) => number, speed = reference.sweet, human = true) {
  const r = place(dusk, crest - 40, speed, human);
  let apex = 0,
    left = NaN,
    leftY = NaN,
    landed = NaN,
    launch = '';
  for (let i = 0; i < 8 / TUNING.step && r.crashes === 0; i++) {
    const c = npcControl(r, dusk, [r], 'club');
    c.throttle = Math.max(0, Math.min(1, (speed - r.speed) * 0.55));
    c.brake = 0;
    c.steer = Math.max(-0.3, Math.min(0.3, c.steer));
    c.pitch = stick(crest - r.surface.s, r.grounded);
    const was = r.grounded;
    stepRider(r, c, dusk, TUNING.step, [r]);
    if (was && !r.grounded) {
      left = crest - r.surface.s;
      leftY = r.y;
    }
    if (!r.grounded && r.airTime > 0.1) {
      apex = Math.max(apex, r.y);
      launch = r.launch;
    }
    if (!was && r.grounded && apex > 0) {
      landed = r.surface.s - crest;
      break;
    }
  }
  return {apex, left, leftY, landed, launch, crashed: r.crashes > 0, pitch: r.pitch};
}
const none = jump(() => 0);
const height = (j: {apex: number}) => j.apex - none.leftY;
/** Hold the stick back from 25 m out and let go `release` metres before the bike leaves the face. */
const timed = (release: number, speed?: number) =>
  jump(toCrest => (toCrest < 25 && toCrest > none.left + release ? 1 : 0), speed);
const held = (speed?: number) => jump(toCrest => (toCrest < 25 ? 1 : 0), speed);

test('the reference jump is a tabletop the bike really flies', () => {
  assert.equal(reference.kind, 'TABLETOP');
  assert.ok(height(none) > 1.5 && none.landed > 10 && !none.crashed, `rise ${height(none)}, lands ${none.landed}`);
  assert.equal(none.launch, '', 'no input is a plain jump');
});

test('a timed release raises peak height 12 to 18 percent over no input', () => {
  for (const release of [0.1, 0.5, 2, 4, 5.5]) {
    const pop = timed(release);
    const gain = height(pop) / height(none) - 1;
    assert.equal(pop.launch, 'pop', `released ${release} m before takeoff`);
    assert.ok(gain >= 0.12 && gain <= 0.18, `released ${release} m before takeoff: ${(gain * 100).toFixed(1)}%`);
    assert.ok(pop.landed > none.landed && !pop.crashed, 'it also carries further');
  }
});

test('the release only counts within the last 6 m before the bike leaves the face', () => {
  for (const release of [6.5, 9, 14]) {
    const early = timed(release);
    assert.equal(early.launch, '', `released ${release} m early`);
    assert.ok(Math.abs(height(early) / height(none) - 1) < 0.005, `released ${release} m early changes nothing`);
  }
  assert.equal(TUNING.preloadReleaseDistance, 6);
});

test('holding the preload through the lip absorbs it: peak height drops 25 to 35 percent', () => {
  const absorb = held();
  const loss = 1 - height(absorb) / height(none);
  assert.equal(absorb.launch, 'absorb');
  assert.ok(loss >= 0.25 && loss <= 0.35, `${(loss * 100).toFixed(1)}%`);
  assert.ok(
    absorb.landed < none.landed - 3 && !absorb.crashed,
    `lands ${absorb.landed} m past the crest, not ${none.landed}`,
  );
  assert.ok(Math.abs(absorb.pitch) < 0.5, 'the held stick does not loop the bike out after an absorb');
});

test('pop and absorb keep their size across takeoff speeds', () => {
  for (const speed of [28, 31, 36, 40]) {
    const plain = jump(() => 0, speed);
    const rise = (j: {apex: number}) => (j.apex - plain.leftY) / (plain.apex - plain.leftY);
    const pop = jump(toCrest => (toCrest < 25 && toCrest > plain.left + 2 ? 1 : 0), speed);
    const absorb = held(speed);
    assert.ok(rise(pop) > 1.12 && rise(pop) < 1.19, `${speed} m/s pop ${rise(pop)}`);
    assert.ok(rise(absorb) > 0.68 && rise(absorb) < 0.75, `${speed} m/s absorb ${rise(absorb)}`);
    assert.ok(!pop.crashed && !absorb.crashed);
  }
});

test('the preload charges over 0.4 s and a part charge gives a part effect', () => {
  const r = place(flat, 100, 16);
  const back: Control = {...neutralControl(), throttle: 1, pitch: 1};
  for (let i = 0; i < 0.2 / TUNING.step; i++) stepRider(r, back, flat, TUNING.step, [r]);
  assert.ok(Math.abs(r.preload - 0.5) < 0.02, `half way after 0.2 s: ${r.preload}`);
  for (let i = 0; i < 0.2 / TUNING.step + 1; i++) stepRider(r, back, flat, TUNING.step, [r]);
  assert.equal(r.preload, 1);
  assert.ok(r.compression >= 0.5, 'the bike visibly squats');
  // Held only for the last 0.2 s before takeoff, a release lifts about half as much.
  const brief = jump(toCrest => (toCrest < none.left + 1 + reference.sweet * 0.2 && toCrest > none.left + 1 ? 1 : 0));
  const gain = height(brief) / height(none) - 1;
  assert.ok(gain > 0.04 && gain < 0.11, `${gain}`);
});

test('preload never engages with 35 percent or more sideways stick, and never changes ground handling', () => {
  for (const steer of [0.35, -0.35, 0.5, -0.8, 1]) {
    const r = place(flat, 100, 16);
    for (let i = 0; i < 120; i++)
      stepRider(r, {...neutralControl(), throttle: 1, pitch: 1, steer}, flat, TUNING.step, [r]);
    assert.equal(r.preload, 0, `steer ${steer}`);
    assert.equal(r.preloadReleased, 0, `steer ${steer}`);
  }
  // Rolling the stick sideways into a slide drops a load instead of releasing it.
  const r = place(flat, 100, 16);
  for (let i = 0; i < 60; i++) stepRider(r, {...neutralControl(), throttle: 1, pitch: 1}, flat, TUNING.step, [r]);
  assert.equal(r.preload, 1);
  stepRider(r, {...neutralControl(), throttle: 1, pitch: 1, steer: 0.6}, flat, TUNING.step, [r]);
  assert.equal(r.preload, 0);
  assert.equal(r.preloadReleased, 0);
  // Straight back on flat ground moves the bike exactly as no stick does.
  for (const steer of [0, 0.2, -0.3]) {
    const a = place(flat, 100, 16),
      b = place(flat, 100, 16);
    for (let i = 0; i < 240; i++) {
      stepRider(a, {...neutralControl(), throttle: 1, steer, pitch: 1}, flat, TUNING.step, [a]);
      stepRider(b, {...neutralControl(), throttle: 1, steer}, flat, TUNING.step, [b]);
    }
    assert.deepEqual([a.x, a.z, a.speed, a.heading, a.powerSlide], [b.x, b.z, b.speed, b.heading, b.powerSlide]);
  }
});

/** Feeds one device's control to a rider for half a second. */
function charge(control: Control) {
  const r = place(flat, 100, 16);
  for (let i = 0; i < 60; i++) stepRider(r, control, flat, TUNING.step, [r]);
  return r.preload;
}
const padWith = (index: number, id: string, y: number) => ({
  index,
  id,
  connected: true,
  axes: [0, y, 0, 0],
  buttons: Array.from({length: 17}, (_, i) => ({value: i === 7 ? 1 : 0})),
});

test('keyboard: holding E preloads', () => {
  assert.equal(charge(mapKeyboard(new Set(['KeyW', 'KeyE']))), 1);
  assert.equal(charge(mapKeyboard(new Set(['KeyW']))), 0);
  assert.equal(
    charge(mapKeyboard(new Set(['KeyW', 'KeyE', 'KeyA']))),
    0,
    'E with steering is the slide, not a preload',
  );
});

test('browser gamepad: left stick straight back preloads', () => {
  assert.equal(charge(mapGamepad(padWith(0, 'Xbox Wireless Controller (STANDARD GAMEPAD)', 1))), 1);
  assert.equal(
    charge(mapGamepad(padWith(0, 'Xbox Wireless Controller (STANDARD GAMEPAD)', 0.5))),
    0,
    'half back is not enough',
  );
  assert.equal(
    charge(mapGamepad(padWith(0, 'Xbox Wireless Controller (STANDARD GAMEPAD)', -1))),
    0,
    'forward does nothing',
  );
});

test('Mac Xbox bridge: the native controller feed preloads the rider it is assigned to', () => {
  const devices = [{kind: 'gamepad' as const, index: 1000}, {kind: 'keyboard' as const}];
  const [rider, keyboard] = routeControls(devices, new Set(), [padWith(1000, 'Xbox / macOS', 1)]);
  assert.equal(charge(rider), 1);
  assert.equal(charge(keyboard), 0);
});

test('touch stick: pulling the stick to nose-up preloads', () => {
  const touch = new TouchInput();
  touch.setEnabled(true);
  touch.start(1, 'stick');
  touch.start(2, 'throttle');
  touch.move(1, 0, 1);
  const y = touch.read().pitch > 0 ? 1 : -1;
  touch.move(1, 0, y);
  assert.equal(touch.read().pitch, 1);
  assert.equal(charge(routeControls([{kind: 'touch'}], new Set(), [], touch.read())[0]), 1);
  touch.move(1, 0.6, y);
  assert.equal(
    charge(routeControls([{kind: 'touch'}], new Set(), [], touch.read())[0]),
    0,
    'a diagonal does not preload',
  );
});

test('AI riders never preload, pop or absorb', () => {
  const r = place(flat, 100, 16, false);
  for (let i = 0; i < 120; i++) stepRider(r, {...neutralControl(), throttle: 1, pitch: 1}, flat, TUNING.step, [r]);
  assert.equal(r.preload, 0);
  const ai = jump(toCrest => (toCrest < 25 ? 1 : 0), reference.sweet, false);
  const aiPlain = jump(() => 0, reference.sweet, false);
  assert.equal(ai.launch, '');
  assert.equal(ai.left, aiPlain.left, 'the stick held back does not change where an AI bike takes off');
  assert.equal(
    npcControl(place(dusk, crest - 30, 30, false), dusk, [], 'club').pitch,
    0,
    'and the AI never asks for it',
  );
});

test('crashes and recoveries clear the preload', () => {
  const r = place(flat, 100, 16);
  for (let i = 0; i < 60; i++) stepRider(r, {...neutralControl(), throttle: 1, pitch: 1}, flat, TUNING.step, [r]);
  stepRider(r, {...idleControl(), reset: true}, flat, TUNING.step, [r]);
  assert.equal(r.preload, 0);
  const fallen = place(flat, 100, 16);
  Object.assign(fallen, {preload: 1, preloadReleased: 0.7, pitchHold: true, launch: 'absorb', grounded: false});
  crash(fallen, 'HARD LANDING', 1);
  assert.deepEqual([fallen.preload, fallen.preloadReleased, fallen.pitchHold, fallen.launch], [0, 0, false, '']);
  assert.equal(preloadMeter(fallen).share, 0, 'the meter does not keep showing the last jump through a crash');
});

test('a quick nose-up press just before the lip is not an absorb', () => {
  // E pressed 0.1 s before takeoff and held into the air: the jump keeps its height and the nose comes up.
  const late = jump(toCrest => (toCrest < none.left + reference.sweet * 0.1 ? 1 : 0));
  assert.equal(late.launch, '');
  assert.ok(Math.abs(height(late) / height(none) - 1) < 0.01, `${height(late) / height(none)}`);
  assert.ok(late.pitch > 0.6 || late.crashed, `the held stick lifts the nose: ${late.pitch}`);
});

test('the preload meter fills, holds a live release, and names the result in the air', () => {
  const base = {grounded: true, preload: 0, preloadReleased: 0, launch: '' as const};
  assert.deepEqual(preloadMeter(base), {share: 0, state: '', label: 'PRELOAD'});
  assert.deepEqual(preloadMeter({...base, preload: 0.5}), {share: 0.5, state: 'charging', label: 'PRELOAD'});
  assert.deepEqual(preloadMeter({...base, preload: 1}), {share: 1, state: 'full', label: 'PRELOAD'});
  assert.deepEqual(preloadMeter({...base, preloadReleased: 0.8}), {share: 0.8, state: 'released', label: 'RELEASED'});
  assert.deepEqual(preloadMeter({...base, grounded: false, launch: 'pop'}), {share: 1, state: 'pop', label: 'POP'});
  assert.deepEqual(preloadMeter({...base, grounded: false, launch: 'absorb'}), {
    share: 1,
    state: 'absorb',
    label: 'ABSORB',
  });
  assert.deepEqual(preloadMeter({...base, grounded: false}), {share: 0, state: '', label: 'PRELOAD'});
});
