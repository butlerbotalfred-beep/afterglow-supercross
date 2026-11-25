import test from 'node:test';
import assert from 'node:assert/strict';
import {TUNING} from '../src/config.ts';
import {COURSES} from '../src/courses.ts';
import {mapGamepad, mapKeyboard, neutralControl, routeControls, type Control} from '../src/input.ts';
import {makeRider, npcControl, stepRider, type Rider} from '../src/physics.ts';
import {createProgress} from '../src/race.ts';
import {jumpCall} from '../src/takeoff.ts';
import {TouchInput} from '../src/touch-input.ts';
import {Track} from '../src/track.ts';

const dusk = new Track(COURSES.find(c => c.id === 'dusk')!);
/** The reference tabletop, as in the preload tests: Dusk Valley's first jump at the takeoff meter's sweet spot. */
const reference = jumpCall(dusk, 12, 90)!;
const crest = 12 + reference.distance;
class FlatTrack extends Track {
  override height(_s: number, _lateral = 0) {
    return 0;
  }
}
const flat = new FlatTrack();
const tuning = TUNING as unknown as Record<string, number>;

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
type Stick = {steer?: number; pitch?: number};
/**
 * One pass over a jump. On the ground the AI steers and the throttle holds `speed`; in the air `stick(airTime)`
 * gives the stick. Heights are measured from where an untouched bike leaves the face, as in the preload tests.
 */
function jump(
  stick: (airTime: number) => Stick,
  opts: {track?: Track; lip?: number; speed?: number; human?: boolean} = {},
) {
  const track = opts.track ?? dusk,
    lip = opts.lip ?? crest,
    speed = opts.speed ?? reference.sweet;
  const r = place(track, lip - 40, speed, opts.human ?? true);
  const path: number[][] = [];
  let apex = 0,
    leftY = NaN,
    air = 0,
    scrubbed = false,
    maxLean = 0,
    landedAt = NaN;
  for (let i = 0; i < 8 / TUNING.step && r.crashes === 0; i++) {
    const c = npcControl(r, track, [r], 'club');
    c.throttle = Math.max(0, Math.min(1, (speed - r.speed) * 0.55));
    c.brake = 0;
    c.steer = Math.max(-0.3, Math.min(0.3, c.steer));
    c.pitch = 0;
    if (!r.grounded) Object.assign(c, {steer: 0, pitch: 0}, stick(r.airTime));
    const was = r.grounded;
    stepRider(r, c, track, TUNING.step, [r]);
    if (was && !r.grounded) leftY = r.y;
    if (!r.grounded && r.airTime > 0.1) {
      apex = Math.max(apex, r.y);
      air = r.airTime;
    }
    scrubbed ||= r.scrub;
    maxLean = Math.max(maxLean, Math.abs(r.airLean));
    path.push([r.x, r.y, r.z, r.speed, r.heading, r.pitch, r.vy]);
    if (!was && r.grounded && apex > 0) {
      landedAt = r.surface.s - lip;
      break;
    }
  }
  return {apex, leftY, air, scrubbed, maxLean, landedAt, path, r, crashed: r.crashes > 0, reason: r.crashReason};
}
const none = jump(() => ({}));
const height = (j: {apex: number}) => j.apex - none.leftY;
/** The scrub gesture from takeoff, let go after `hold` seconds. */
const scrub = (hold: number, steer = 1) => jump(t => (t < hold ? {steer, pitch: -1} : {}));

test('a full scrub lowers peak height 20 to 25 percent and shortens air time', () => {
  for (const side of [1, -1]) {
    const s = scrub(0.3, side);
    const loss = 1 - height(s) / height(none);
    assert.ok(s.scrubbed && !s.crashed, `scrub ${side}: ${s.reason}`);
    assert.ok(loss >= 0.2 && loss <= 0.25, `${(loss * 100).toFixed(1)}%`);
    assert.ok(s.air < none.air - 0.05, `air ${s.air} s, not ${none.air} s`);
    assert.ok(s.landedAt < none.landedAt - 1, `lands ${s.landedAt} m past the crest, not ${none.landedAt}`);
    assert.ok(s.maxLean > 0.6, `the bike lays over: ${s.maxLean}`);
  }
});

test('a scrub must start within 0.25 s of takeoff, and a part-sideways stick scrubs less', () => {
  assert.equal(TUNING.scrubWindow, 0.25);
  const late = jump(t => (t > 0.26 && t < 0.5 ? {steer: 1, pitch: -1} : {}));
  assert.equal(late.scrubbed, false, 'a gesture after the window is only a whip');
  assert.ok(late.maxLean <= TUNING.airLeanLimit + 1e-9 && !late.crashed);
  const edge = jump(t => (t > 0.2 && t < 0.4 ? {steer: 1, pitch: -1} : {}));
  assert.equal(edge.scrubbed, true, 'a gesture at 0.2 s still counts');
  const part = jump(t => (t < 0.3 ? {steer: 0.8, pitch: -0.5} : {}));
  const full = scrub(0.3);
  assert.ok(part.scrubbed && height(part) > height(full) + 0.05 && height(part) < height(none) - 0.05);
  for (const stick of [
    {steer: 0.79, pitch: -1},
    {steer: 1, pitch: -0.49},
  ])
    assert.equal(jump(t => (t < 0.3 ? stick : {})).scrubbed, false, JSON.stringify(stick));
});

test('landing with air lean above 0.35 crashes; at or below 0.35 lands', () => {
  assert.equal(TUNING.airLeanLimit, 0.35);
  // A scrubbing bike one step above flat ground, with the lean frozen so the limit is tested exactly.
  const touchDown = (airLean: number) => {
    const r = place(flat, 100, 20);
    Object.assign(r, {grounded: false, y: 0.001, vy: -1, airTime: 0.6, scrub: true, airLean});
    const rates = [tuning.airLeanRate, tuning.airLeanRecover];
    tuning.airLeanRate = tuning.airLeanRecover = 0;
    try {
      stepRider(r, neutralControl(), flat, TUNING.step, [r]);
    } finally {
      [tuning.airLeanRate, tuning.airLeanRecover] = rates;
    }
    return r;
  };
  for (const lean of [0.35, -0.35, 0.2, 0]) {
    const r = touchDown(lean);
    assert.ok(r.grounded && r.crashes === 0 && !r.scrub, `lean ${lean} lands`);
  }
  for (const lean of [0.351, -0.351, 0.6, -0.9]) {
    const r = touchDown(lean);
    assert.equal(r.crashes, 1, `lean ${lean} crashes`);
    assert.equal(r.crashReason, 'SCRUB NOT RECOVERED');
  }
  // In a real flight: holding the scrub all the way down crashes, centring the stick in time lands.
  const held = scrub(9);
  assert.ok(held.crashed && held.reason === 'SCRUB NOT RECOVERED', held.reason);
  const recovered = scrub(0.3);
  assert.ok(!recovered.crashed && Math.abs(recovered.r.airLean) <= TUNING.airLeanLimit);
});

test('a whip leaves path, speed and landing identical to the same jump without it', () => {
  for (const flick of [
    (t: number) => (t > 0.1 && t < 0.6 ? {steer: 1} : {}),
    () => ({steer: -1}),
    () => ({steer: 1, pitch: 0.6}),
  ]) {
    const whipped = jump(flick);
    // The same jump and stick with the whip switched off: the bike never lays over.
    const rate = tuning.airLeanRate;
    tuning.airLeanRate = 0;
    let plain;
    try {
      plain = jump(flick);
    } finally {
      tuning.airLeanRate = rate;
    }
    assert.equal(plain.maxLean, 0);
    assert.ok(
      Math.abs(whipped.maxLean - TUNING.airLeanLimit) < 1e-9,
      `whip reaches the cap and no further: ${whipped.maxLean}`,
    );
    assert.equal(whipped.scrubbed, false);
    assert.deepEqual(whipped.path, plain.path, 'every step of position, speed, heading, pitch and vertical speed');
    assert.equal(whipped.landedAt, plain.landedAt);
    assert.equal(whipped.r.landingCue, plain.r.landingCue);
    assert.equal(whipped.r.speed, plain.r.speed);
    assert.ok(!whipped.crashed, 'a whip held to the ground never crashes');
  }
});

test('full sideways stick without forward stick never starts a scrub on any jump of any circuit', () => {
  let jumps = 0;
  for (const course of COURSES) {
    const track = new Track(course);
    const lips = new Map<number, number>();
    for (let s = 0; s < track.length; s += 2) {
      const call = jumpCall(track, s, 90);
      if (call && call.distance > 0) lips.set(Math.round(s + call.distance), call.sweet);
    }
    for (const [lip, speed] of lips)
      for (const stick of [{steer: 1}, {steer: -1}, {steer: 1, pitch: -0.49}, {steer: -1, pitch: 1}]) {
        const j = jump(() => stick, {track, lip, speed});
        assert.equal(j.scrubbed, false, `${course.id} ${lip} ${JSON.stringify(stick)}`);
        assert.ok(j.maxLean <= TUNING.airLeanLimit + 1e-9);
        assert.notEqual(j.reason, 'SCRUB NOT RECOVERED');
        jumps++;
      }
  }
  assert.ok(jumps >= 100, `${jumps} jump passes`);
});

/** A rider just off a lip, given one device's control for one step. */
function gesture(control: Control, human = true): Rider {
  const r = place(flat, 100, 25, human);
  Object.assign(r, {grounded: false, y: 2, vy: 6, airTime: 0.05});
  stepRider(r, control, flat, TUNING.step, [r]);
  return r;
}
const padWith = (index: number, id: string, x: number, y: number) => ({
  index,
  id,
  connected: true,
  axes: [x, y, 0, 0],
  buttons: Array.from({length: 17}, (_, i) => ({value: i === 7 ? 1 : 0})),
});

test('keyboard: A or D with Q scrubs', () => {
  assert.ok(gesture(mapKeyboard(new Set(['KeyW', 'KeyA', 'KeyQ']))).scrub);
  assert.ok(gesture(mapKeyboard(new Set(['KeyW', 'KeyD', 'KeyQ']))).scrub);
  assert.ok(gesture(mapKeyboard(new Set(['ArrowLeft', 'Space']))).scrub);
  assert.equal(gesture(mapKeyboard(new Set(['KeyW', 'KeyA']))).scrub, false, 'A alone is a whip');
  assert.equal(gesture(mapKeyboard(new Set(['KeyW', 'KeyQ']))).scrub, false, 'Q alone is nose down');
});

test('browser gamepad: stick forward and to the side scrubs', () => {
  const id = 'Xbox Wireless Controller (STANDARD GAMEPAD)';
  assert.ok(gesture(mapGamepad(padWith(0, id, 1, -1))).scrub);
  assert.ok(gesture(mapGamepad(padWith(0, id, -1, -0.7))).scrub);
  assert.equal(gesture(mapGamepad(padWith(0, id, 1, 0))).scrub, false);
  assert.equal(gesture(mapGamepad(padWith(0, id, 0.5, -1))).scrub, false);
});

test('Mac Xbox bridge: the native controller feed scrubs the rider it is assigned to', () => {
  const devices = [{kind: 'gamepad' as const, index: 1000}, {kind: 'keyboard' as const}];
  const [rider, keyboard] = routeControls(devices, new Set(), [padWith(1000, 'Xbox / macOS', -1, -1)]);
  assert.ok(gesture(rider).scrub);
  assert.equal(gesture(keyboard).scrub, false);
});

test('touch stick: sideways with the stick forward, or with NOSE DOWN held, scrubs', () => {
  const touch = new TouchInput();
  touch.setEnabled(true);
  touch.start(1, 'stick');
  touch.move(1, 1, 1);
  const forward = touch.read().pitch < 0 ? 1 : -1;
  touch.move(1, 1, forward);
  assert.ok(gesture(routeControls([{kind: 'touch'}], new Set(), [], touch.read())[0]).scrub);
  touch.move(1, -1, 0);
  assert.equal(gesture(routeControls([{kind: 'touch'}], new Set(), [], touch.read())[0]).scrub, false);
  touch.start(2, 'noseDown');
  assert.ok(gesture(routeControls([{kind: 'touch'}], new Set(), [], touch.read())[0]).scrub);
});

test('AI riders never scrub or whip', () => {
  const ai = gesture({...neutralControl(), steer: 1, pitch: -1}, false);
  assert.equal(ai.scrub, false);
  assert.equal(ai.airLean, 0);
  const flight = jump(t => (t < 0.3 ? {steer: 1, pitch: -1} : {}), {human: false});
  assert.equal(flight.scrubbed, false);
  assert.equal(flight.maxLean, 0);
});

test('a scrub does not steer the bike, and landing or crashing clears it', () => {
  const s = scrub(0.3);
  const headingAtTakeoff = none.path.find((p, i) => s.path[i] && p[1] > none.leftY - 1e-9 && p[6] > 0)![4];
  const inAir = s.path.filter(p => p[1] > dusk.height(crest) + 0.3);
  assert.ok(inAir.length > 20);
  for (const p of inAir) assert.ok(Math.abs(p[4] - inAir[0][4]) < 1e-9, 'heading holds through the scrub');
  assert.ok(Number.isFinite(headingAtTakeoff));
  assert.equal(s.r.scrub, false);
  const after = s.r;
  for (let i = 0; i < 60; i++) stepRider(after, {...neutralControl(), throttle: 1}, dusk, TUNING.step, [after]);
  assert.ok(Math.abs(after.airLean) < 0.01, 'the bike is upright again on the ground');
  const fallen = scrub(9).r;
  assert.deepEqual([fallen.airLean, fallen.scrub], [0, false]);
});
