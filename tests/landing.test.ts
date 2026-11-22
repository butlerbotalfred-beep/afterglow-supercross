import test from 'node:test';
import assert from 'node:assert/strict';
import {PHYSICS_VERSION, TUNING} from '../src/config.ts';
import {COURSES} from '../src/courses.ts';
import {idleControl, makeRider, npcControl, stepRider} from '../src/physics.ts';
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
  assert.ok(worst >= 1 - TUNING.landingPenaltyMax - 0.005, `the loss is capped, kept ${worst}`);
});

test('a clean downslope landing adds speed, never more than 3 km/h', () => {
  assert.ok(Math.abs(TUNING.landingBonusMax * KMH - 3) < 1e-9);
  for (const gradient of [0.05, 0.15, 0.3, 0.6, 1.2]) {
    for (const speed of [12, 30, 45]) {
      const {r} = land(0, {gradient, speed});
      assert.equal(r.crashes, 0);
      const gained = (r.speed - speed) * KMH;
      assert.ok(gained > 0, `gradient ${gradient} at ${speed} m/s gains speed`);
      assert.ok(gained <= 3 + 1e-9, `gradient ${gradient} at ${speed} m/s gained ${gained} km/h`);
      assert.ok(r.landingBonus * KMH <= 3 + 1e-9);
    }
  }
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
  // fired; here it is forced, with an impact of about 9, and the rider stays up.
  const {r} = land(0, {lean: 0.99, sink: 9});
  assert.ok(r.lastLanding > 7, `impact ${r.lastLanding}`);
  assert.equal(r.crashes, 0);
});

test('PHYSICS_VERSION is 2 and best laps from version 1 are archived', () => {
  assert.equal(PHYSICS_VERSION, 2);
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
  assert.equal(stored.bestLaps.coast.physics, 2);
});

test('a clean landing never leaves a mid-band rider more than 2 km/h above the rhythm band', () => {
  // The Club rider holds each section's pace, the middle of the band shown on the HUD (pace ± 5 km/h), and
  // matches every landing. Two laps on every circuit, every rhythm section.
  let landings = 0;
  for (const course of COURSES) {
    const track = new Track(course),
      r = makeRider(track, 0, false, 0xffffff);
    const seen = new Set<number>();
    for (let f = 0; f < 120 * 400 && r.progress.lap < 2; f++) {
      const before = r.speed;
      stepRider(r, npcControl(r, track, [r], 'club'), track, TUNING.step, [r]);
      if (r.landingCue !== 'clean' || r.landingCueAge !== 0) continue;
      track.rhythms.forEach((section, index) => {
        if (r.surface.s < section.start || r.surface.s >= section.end) return;
        seen.add(index);
        landings++;
        const limit = section.pace * KMH + 5 + 2;
        assert.ok(
          r.speed * KMH <= limit,
          `${course.id} ${section.name}: ${(r.speed * KMH).toFixed(1)} km/h after a clean landing, limit ${limit}`,
        );
        assert.ok(r.speed - before <= TUNING.landingBonusMax + 1e-9);
      });
    }
    assert.equal(r.crashes, 0, `${course.id}: no crashes`);
    assert.ok(seen.size >= track.rhythms.length - 1, `${course.id}: clean landings in ${seen.size} sections`);
  }
  assert.ok(landings >= 25, `${landings} clean landings checked`);
});
