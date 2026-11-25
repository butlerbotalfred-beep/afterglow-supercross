import test from 'node:test';
import assert from 'node:assert/strict';
import {PHYSICS_VERSION, TUNING} from '../src/config.ts';
import {COURSES} from '../src/courses.ts';
import {idleControl, makeRider, stepRider} from '../src/physics.ts';
import {SAVE_KEY, SaveStore} from '../src/save.ts';
import {Track} from '../src/track.ts';
import {landingNotice} from '../src/ui/hud.ts';

const KMH = 3.6;
/** A straight track whose ground falls away at `gradient` (0 is level, 0.3 drops 0.3 m per metre). */
function ramp(gradient = 0) {
  const t = new Track(),
    p = t.at(0);
  t.height = s => -gradient * s;
  t.at = (s, lateral = 0) => ({...p, s, x: lateral, z: s, tx: 0, tz: 1, lateral, distance: Math.abs(lateral)});
  t.project = (x, z) => t.at(z, x);
  return t;
}
/** One landing: the bike touches down this step, `offBy` radians away from the slope of the ground. */
function land(offBy: number, {gradient = 0, speed = 30, airTime = 1, lean = 0, sink = 2} = {}) {
  const t = ramp(gradient),
    r = makeRider(t, 0, true, 0xffffff);
  const pitch = Math.atan(-gradient) + offBy;
  // Falling at the slope's own rate plus a gentle sink, so the impact stays far below the hard-landing limit.
  const vy = -gradient * speed - sink;
  Object.assign(r, {x: 0, z: 1, y: t.height(1) + 0.005, surface: t.at(1), grounded: false, pitch, vy, speed, lean});
  Object.assign(r, {heading: 0, airTime});
  stepRider(r, idleControl(), t, TUNING.step, [r]);
  return {r, kept: r.speed / speed};
}

test('the misaligned-landing penalty starts at 0.10 radians and is steeper than before', () => {
  assert.equal(TUNING.landingPenaltyStart, 0.1);
  assert.ok(TUNING.landingPenaltySlope > 0.4, 'steeper than the old 0.4 per radian');
  const inside = land(0.09).kept;
  assert.ok(inside > 0.999, `0.09 rad off costs nothing, kept ${inside}`);
  const off = land(0.2).kept;
  assert.ok(Math.abs(off - (1 - 0.1 * TUNING.landingPenaltySlope)) < 0.005, `0.20 rad off kept ${off}`);
  assert.ok(off < 0.95, 'a landing the old rule let through for free now costs speed');
  assert.ok(land(0.3).kept < off, 'further off costs more');
  const worst = land(0.9, {sink: 1}).kept;
  assert.ok(worst >= 1 - TUNING.landingPenaltyMax - 0.005, `the loss levels off, kept ${worst}`);
  assert.ok(worst <= 1 - (0.9 - 0.3) * 0.4 + 0.005, 'and is never less than the old rule charged');
});

test('a clean downslope landing adds speed, never more than 3 km/h', () => {
  assert.ok(Math.abs(TUNING.landingBonusMax * KMH - 3) < 1e-9);
  for (const gradient of [0.05, 0.15, 0.3, 0.6, 1.2]) {
    for (const speed of [12, 30, 40]) {
      const {r} = land(0, {gradient, speed});
      assert.equal(r.crashes, 0);
      const gained = (r.speed - speed) * KMH;
      assert.ok(gained > 0, `gradient ${gradient} at ${speed} m/s gains speed`);
      assert.ok(gained <= 3 + 1e-9, `gradient ${gradient} at ${speed} m/s gained ${gained} km/h`);
      assert.ok(r.landingBonus * KMH <= 3 + 1e-9);
    }
  }
  assert.equal(land(0, {gradient: 0.3, speed: TUNING.maxSpeed}).r.speed, TUNING.maxSpeed, 'never past the top speed');
  assert.equal(land(0, {gradient: 0}).r.landingBonus, 0, 'level ground earns nothing');
  assert.equal(land(0.25, {gradient: 0.3}).r.landingBonus, 0, 'a misaligned landing earns nothing');
  assert.equal(land(0, {gradient: 0.3, airTime: 0.1}).r.landingBonus, 0, 'a bump is not a landing');
});

test('landings are called CLEAN or FLAT on the HUD', () => {
  const clean = land(0.02, {gradient: 0.3}).r;
  assert.equal(clean.landingCue, 'clean');
  assert.equal(clean.landingCueAge, 0);
  assert.match(landingNotice(clean), /CLEAN LANDING.*\+\d KM\/H/);
  assert.match(landingNotice(land(0.05).r), /CLEAN LANDING.*SPEED KEPT/);
  const flat = land(0.3).r;
  assert.equal(flat.landingCue, 'flat');
  assert.match(landingNotice(flat), /FLAT LANDING/);
  assert.equal(land(0.3, {airTime: 0.1}).r.landingCue, '', 'a bump is not announced');
});

test('the old lean check is gone: lean alone never crashes a landing', () => {
  // The removed rule needed lean above 0.95 with an impact above 7. Lean cannot pass 0.64 in play, so it never
  // fired. Here lean is forced high enough to still be past 0.95 at touchdown, with an impact of about 9.
  const {r} = land(0, {lean: 1.3, sink: 9});
  assert.ok(Math.abs(r.lean) > 0.95, `lean at touchdown ${r.lean}`);
  assert.ok(r.lastLanding > 7, `impact ${r.lastLanding}`);
  assert.equal(r.crashes, 0);
});

test('a rebound is charged far less than the landing that caused it', () => {
  const landing = land(0.3).kept;
  const rebound = land(0.3, {airTime: 0.02}).kept;
  assert.ok(1 - landing > 0.15, `the landing itself costs ${1 - landing}`);
  assert.ok(1 - rebound <= TUNING.bumpPenaltyMax + 0.005, `the bounce after it costs ${1 - rebound}`);
  assert.ok(land(0.9, {sink: 1}).kept <= land(0.9, {sink: 1, airTime: 0.02}).kept);
});

test('the bonus stays inside the top speed, on the track, and is not paid for a heavy hit', () => {
  const fast = land(0, {gradient: 0.3, speed: TUNING.maxSpeed}).r;
  assert.ok(fast.speed <= TUNING.maxSpeed, `speed ${fast.speed}`);
  assert.ok(fast.landingBonus < 0.1, `at top speed there is no room for a bonus, got ${fast.landingBonus}`);
  const t = ramp(0.3),
    wide = makeRider(t, 0, true, 0xffffff);
  const at = t.at(1, t.halfWidth + 1);
  Object.assign(wide, {x: at.x, z: 1, y: t.height(1) + 0.005, surface: at, grounded: false, heading: 0});
  Object.assign(wide, {pitch: Math.atan(-0.3), vy: -0.3 * 30 - 2, speed: 30, airTime: 1});
  stepRider(wide, idleControl(), t, TUNING.step, [wide]);
  assert.equal(wide.grounded, true);
  assert.equal(wide.landingBonus, 0, 'no bonus off the track');
  const heavy = land(0, {sink: 16}).r;
  assert.ok(heavy.lastLanding > 12 && heavy.crashes === 0, `impact ${heavy.lastLanding}`);
  assert.equal(heavy.landingCue, '', 'a landing that scrubbed speed on impact is not called clean');
});

test('PHYSICS_VERSION is 5 and best laps from earlier versions are archived', () => {
  assert.equal(PHYSICS_VERSION, 5);
  const values = new Map<string, string>();
  const storage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => void values.set(k, v),
  };
  new SaveStore(storage, 1).submitLap('coast', {time: 52.5, sectors: [13, 13, 13, 13.5]});
  const now = new SaveStore(storage);
  assert.equal(now.bestLap('coast'), null, 'a version 1 lap is not the time to beat');
  assert.equal(now.submitLap('coast', {time: 55, sectors: [14, 14, 14, 13]}), true, 'a slower lap is the new best');
  const stored = JSON.parse(values.get(SAVE_KEY)!).records;
  assert.equal(stored.archived['physics-1'].coast.time, 52.5, 'the old lap is kept in the archive');
  assert.equal(stored.bestLaps.coast.physics, PHYSICS_VERSION);
});

test('a clean landing never leaves a mid-band rider more than 2 km/h above the rhythm band', () => {
  // In every rhythm section of every circuit: a rider at the section's pace, the middle of the band the HUD
  // shows (pace ± 5 km/h), lands cleanly on the steepest downslope in the section.
  let sections = 0;
  for (const course of COURSES) {
    const track = new Track(course);
    for (const section of track.rhythms) {
      let steepest = {s: section.start, gradient: 0};
      for (let s = section.start; s < section.end; s += 0.25) {
        const gradient = (track.height(s + 0.42, 0) - track.height(s, 0)) / 0.42;
        if (gradient < steepest.gradient) steepest = {s, gradient};
      }
      assert.ok(steepest.gradient < -0.05, `${course.id} ${section.name} has a downslope to land on`);
      const r = makeRider(track, 0, true, 0xffffff),
        p = track.at(steepest.s, 0);
      Object.assign(r, {x: p.x, z: p.z, y: track.height(steepest.s, 0) + 0.005, surface: p, grounded: false});
      Object.assign(r, {heading: Math.atan2(p.tx, p.tz), pitch: Math.atan(steepest.gradient), airTime: 1});
      Object.assign(r, {speed: section.pace, vy: steepest.gradient * section.pace - 2});
      stepRider(r, idleControl(), track, TUNING.step, [r]);
      const name = `${course.id} ${section.name}`;
      assert.equal(r.grounded, true, `${name}: landed`);
      assert.equal(r.landingCue, 'clean', `${name}: the landing was clean`);
      assert.ok(r.landingBonus > 0, `${name}: the downslope paid a bonus`);
      const limit = section.pace * KMH + 5 + 2;
      assert.ok(r.speed * KMH <= limit, `${name}: ${(r.speed * KMH).toFixed(1)} km/h, limit ${limit.toFixed(1)}`);
      sections++;
    }
  }
  assert.equal(sections, 25, 'every rhythm section of the five circuits');
});
