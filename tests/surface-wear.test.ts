import test from 'node:test';
import assert from 'node:assert/strict';
import {createProgress} from '../src/race.ts';
import {TUNING} from '../src/config.ts';
import {COURSES} from '../src/courses.ts';
import {idleControl, makeRider, npcControl, stepRider} from '../src/physics.ts';
import {SaveStore} from '../src/save.ts';
import {SURFACE_REDRAW_CELLS, SURFACE_REDRAW_MS, SurfaceMesh} from '../src/surface-mesh.ts';
import {BUMP_AMPLITUDE, RUT_TURN_BONUS, SurfaceWear, surfaceFor} from '../src/surface-wear.ts';
import {Track} from '../src/track.ts';
import {RaceSession} from '../src/game/race-session.ts';

const STEP = TUNING.step;
const quiet = {countdown() {}, racing() {}, cue() {}, landing() {}, pause() {}, results() {}};
const course = (id: string) => COURSES.find(c => c.id === id)!;
const dusk = new Track(course('dusk'));

/** Eight computer riders (or one in Time Trial) raced for `seconds`, with wear physics as asked. */
function race(track: Track, wearPhysics: boolean, seconds: number, trial = false, seed = 7, practice = false) {
  const session: RaceSession = new RaceSession(
    {sample: () => npcControl(session.riders[0], track, [], 'club'), connectedGamepads: () => []},
    quiet,
  );
  session.grid({
    track,
    npcCount: 8,
    humanCount: trial || practice ? 1 : 0,
    practice,
    trial,
    assignments: [{kind: 'keyboard'}],
  });
  session.start({lapCount: 9, difficulty: 'club', seed, wearPhysics});
  const trace: number[] = [];
  for (let i = 0; session.raceTime < seconds && i < 120 * (seconds + 10); i++) {
    session.step(STEP);
    if (i % 30 === 0) for (const r of session.riders) trace.push(r.x, r.y, r.z, r.speed, r.heading, r.progress.lap);
  }
  return {session, trace};
}
/** A track worn through everywhere. */
function wornThrough(id = 'dusk') {
  const track = new Track(course(id));
  const surface = new SurfaceWear(track);
  surface.wearThrough();
  track.surface = surface;
  return {track, surface};
}

test('height never steps more than 1 cm between points 0.1 m apart at maximum wear', () => {
  for (const {id} of COURSES) {
    const {track, surface} = wornThrough(id);
    let worst = 0,
      highest = 0;
    // Every 0.1 m round the lap, across the whole width, to the points 0.1 m away along, across and both diagonals.
    for (let s = 0; s < track.length; s += 0.1)
      for (let l = -track.halfWidth - 1; l <= track.halfWidth + 1; l += 0.35) {
        const here = surface.bump(s, l);
        highest = Math.max(highest, Math.abs(here));
        for (const [ds, dl] of [
          [0.1, 0],
          [0, 0.1],
          [0.0707, 0.0707],
          [0.0707, -0.0707],
        ])
          worst = Math.max(worst, Math.abs(surface.bump(s + ds, l + dl) - here));
      }
    assert.ok(worst <= 0.01, `${id}: ${(worst * 100).toFixed(2)} cm in 0.1 m`);
    // The bumps are there, up to 6 cm from top to bottom and no more.
    assert.ok(highest > 0.029 && highest <= BUMP_AMPLITUDE, `${id}: ${highest}`);
    // The height a bike stands on is the track as built plus the bumps, and nothing else.
    for (let s = 3; s < track.length; s += 37)
      assert.equal(track.surfaceHeight(s, 0.6), track.height(s, 0.6) + surface.bump(s, 0.6));
  }
});

test('the rut turning bonus never exceeds 8%', () => {
  assert.equal(RUT_TURN_BONUS, 0.08);
  const {track} = wornThrough();
  const built = new Track(course('dusk'));
  let most = 0,
    turns = 0;
  // A bike at full lock, with and without the deepest rut under it, all round the lap at three speeds.
  let away = 0;
  for (let s = 0; s < track.length; s += 3)
    for (const speed of [8, 16, 28])
      for (const steer of [-1, 1]) {
        const turned = (t: Track) => {
          const r = makeRider(t, 0, true, 0);
          const p = t.at(s, 0);
          Object.assign(r, {x: p.x, z: p.z, y: t.height(s, 0), heading: Math.atan2(p.tx, p.tz), speed, surface: p});
          r.progress = {...createProgress(s), lastLateral: 0};
          const before = r.heading;
          stepRider(r, {...idleControl(), steer, throttle: 0.5}, t, STEP, [r], 0);
          // The bike was ridden, not picked up and put back on the track.
          assert.equal(r.recovery, 0, `recovered at ${s} m`);
          return Math.abs(r.heading - before);
        };
        const ratio = turned(track) / turned(built);
        most = Math.max(most, ratio);
        if (ratio > 1.0001) turns++;
        assert.ok(ratio >= 1 - 1e-9 && ratio <= 1 + RUT_TURN_BONUS + 1e-9, `${ratio} at ${s} m`);
        // Only steering into a turn gets any: against it, or on a straight, the rut gives nothing.
        if (steer * track.curvature(s) <= 0) {
          assert.ok(Math.abs(ratio - 1) < 1e-9, `${ratio} steering away at ${s} m`);
          away++;
        }
      }
  // The full bonus is reached, in many places.
  assert.ok(most > 1.079, `most ${most}`);
  assert.ok(turns > 300 && away > 1000, `${turns} with a bonus, ${away} without`);
  const straight = wornThrough().surface;
  for (let s = 0; s < dusk.length; s += 11) assert.ok(straight.rut(s, 0) <= 1);
});

test('the drawn surface is within 2 cm of the physics height at bumps', () => {
  // Bumps at their highest everywhere they can form, then drawn.
  const track = new Track(course('dusk'));
  const surface = surfaceFor(track);
  surface.wearThrough();
  track.surface = surface;
  const geometry = track.geometry();
  const mesh = new SurfaceMesh(track, geometry);
  assert.equal(mesh.refresh(5000), true);
  const position = geometry.getAttribute('position');
  const count = Math.ceil(track.length / 0.5),
    lanes = 40;
  let checked = 0,
    worst = 0;
  for (let i = 0; i < count; i++)
    for (let j = 1; j < lanes; j++) {
      const s = (i / count) * track.length,
        l = ((j / lanes) * 2 - 1) * (track.halfWidth + 2.8);
      // At bumps: where they stand a centimetre or more.
      if (surface.rough(s, l) * BUMP_AMPLITUDE < 0.01) continue;
      checked++;
      const y = position.getY(i * (lanes + 1) + j);
      worst = Math.max(worst, Math.abs(y - track.surfaceHeight(s, l)));
      // And half way to the next row, where the mesh is a straight line between the two.
      const next = position.getY((i + 1) * (lanes + 1) + j);
      const half = ((i + 0.5) / count) * track.length;
      worst = Math.max(worst, Math.abs((y + next) / 2 - track.surfaceHeight(half, l)));
    }
  assert.ok(checked > 500, `${checked} points at bumps`);
  assert.ok(worst <= 0.02, `${(worst * 100).toFixed(2)} cm`);
  // Before the redraw the mesh did not have them: the bumps are really drawn.
  const fresh = track.geometry().getAttribute('position');
  let moved = 0;
  for (let i = 0; i < position.count; i++) moved = Math.max(moved, Math.abs(position.getY(i) - fresh.getY(i)));
  assert.ok(moved > 0.015, `moved ${moved}`);
});

test('the track mesh is redrawn a few stretches at a time, at most once a second', () => {
  const track = new Track(course('dusk'));
  const surface = surfaceFor(track);
  const geometry = track.geometry();
  const built = Float32Array.from(geometry.getAttribute('normal').array);
  const mesh = new SurfaceMesh(track, geometry);
  assert.equal(SURFACE_REDRAW_MS, 1000);
  assert.equal(mesh.refresh(0), false, 'nothing worn, nothing redrawn');
  const brake = (s: number) =>
    surface.ride({id: 0, speed: 20, grounded: true, crashTime: 0, brake: 1, surface: {s, lateral: 0}});
  // A minute at 60 frames a second with bikes braking somewhere new every frame: in one place, at the far
  // side of the lap, and across the start line.
  const rows = Math.ceil(track.length / 0.5);
  // Four rows a cell, and a row or two more at the ends of each stretch.
  const most = SURFACE_REDRAW_CELLS * 4 + 12;
  const sent: number[] = [];
  let largest = 0;
  for (let frame = 0; frame < 3600; frame++) {
    brake(300 + (frame % 200) * 0.3);
    brake(1500 + (frame % 150) * 0.3);
    brake(track.length - 12 + (frame % 80) * 0.3);
    const now = 10000 + (frame * 1000) / 60;
    if (mesh.refresh(now)) {
      sent.push(now);
      largest = Math.max(largest, mesh.rows);
    }
  }
  assert.ok(sent.length >= 2 && sent.length <= 60, `${sent.length} redraws in a minute`);
  for (let i = 1; i < sent.length; i++) assert.ok(sent[i] - sent[i - 1] >= SURFACE_REDRAW_MS);
  // Never the whole lap, however far apart the braking: a fixed few metres of track at a time.
  assert.ok(largest > 0 && largest <= most && most < rows / 20, `${largest} of ${rows} rows at most (limit ${most})`);
  // Once the braking stops the mesh catches up, and is then the surface the bikes ride.
  let later = 80000;
  while (mesh.refresh((later += SURFACE_REDRAW_MS)));
  const position = geometry.getAttribute('position'),
    normal = geometry.getAttribute('normal');
  let bumped = 0;
  for (let i = 0; i <= rows; i++)
    for (let j = 1; j < 40; j += 3) {
      const at = (i / rows) * track.length,
        l = ((j / 40) * 2 - 1) * (track.halfWidth + 2.8);
      assert.ok(Math.abs(position.getY(i * 41 + j) - track.drawnHeight(at, l, false, surface)) < 1e-6, `row ${i}`);
      if (surface.rough(at, l) > 0) bumped++;
      // Ground with no bumps is lit exactly as it was built.
      else for (let k = 0; k < 3; k++) assert.equal(normal.array[(i * 41 + j) * 3 + k], built[(i * 41 + j) * 3 + k]);
    }
  assert.ok(bumped > 50, `${bumped} points with bumps`);
  // Cleared, the mesh goes back to the track as built in one redraw: heights and lighting.
  surface.clear();
  assert.equal(mesh.refresh((later += SURFACE_REDRAW_MS)), true);
  assert.equal(mesh.refresh((later += SURFACE_REDRAW_MS)), false);
  assert.ok(mesh.rows < rows / 2, `${mesh.rows} rows to take the bumps back`);
  const fresh = track.geometry().getAttribute('position');
  for (let i = 0; i < position.count; i++) assert.ok(Math.abs(position.getY(i) - fresh.getY(i)) < 1e-6);
  assert.deepEqual(Float32Array.from(normal.array), built);
});

test('wear physics is off in Time Trial', () => {
  const on = race(new Track(course('dusk')), true, 60, true);
  assert.equal(on.session.trial, true);
  assert.equal(on.session.track.surface, null);
  assert.equal(on.session.riders.length, 1);
  // Asked for or not, the Time Trial lap is the same lap.
  const off = race(new Track(course('dusk')), false, 60, true);
  assert.deepEqual(on.trace, off.trace);
  for (const r of on.session.riders) assert.deepEqual([r.bump, r.rut, r.rutShake], [0, 0, 0]);
  // Free Practice is ridden on the track as built too, so its laps still count for a best lap.
  const practice = race(new Track(course('dusk')), true, 20, false, 7, true);
  assert.equal(practice.session.practice, true);
  assert.equal(practice.session.track.surface, null);
  // A race asked for with wear has it, and going back to setup takes it away again.
  const raced = race(new Track(course('dusk')), true, 30);
  assert.ok(raced.session.track.surface);
  raced.session.toSetup();
  assert.equal(raced.session.track.surface, null);
  // The setting: on unless switched off, and kept.
  const values = new Map<string, string>();
  const storage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => void values.set(k, v),
  };
  const save = new SaveStore(storage);
  assert.equal(save.wearPhysics, true);
  save.setWearPhysics(false);
  assert.equal(new SaveStore(storage).wearPhysics, false);
});

test('a wear-off race leaves no trace of wear, also straight after a wear-on race', () => {
  // (That wear off is the riding it was before this milestone is the baselines' job: pace-gate and the rest.)
  const off = race(new Track(course('dusk')), false, 110);
  assert.equal(off.session.track.surface, null);
  for (const r of off.session.riders) assert.deepEqual([r.bump, r.rut, r.rutShake, r.rutHeld], [0, 0, 0, false]);
  // With wear on it is a different race, and the riders carry ruts and bumps.
  const track = new Track(course('dusk'));
  const on = race(track, true, 110);
  assert.notDeepEqual(on.trace, off.trace);
  assert.ok(on.session.riders.some(r => r.rut > 0 || r.bump !== 0));
  // The same track, raced again with wear off: the race it would have been on a track never worn.
  const after = race(track, false, 110);
  assert.equal(track.surface, null);
  assert.deepEqual(after.trace, off.trace);
  for (const r of after.session.riders) assert.deepEqual([r.bump, r.rut, r.rutShake, r.rutHeld], [0, 0, 0, false]);
});

test('identical inputs give an identical race with wear on', () => {
  const first = race(new Track(course('dusk')), true, 200);
  const again = race(new Track(course('dusk')), true, 200);
  assert.deepEqual(again.trace, first.trace);
  const a = first.session.track.surface!,
    b = again.session.track.surface!;
  // The same ground, too, and there is something on it.
  let ruts = 0,
    bumps = 0;
  for (let s = 0; s < dusk.length; s += 1.7)
    for (let l = -4; l <= 4; l += 0.8) {
      assert.equal(a.rut(s, l), b.rut(s, l));
      assert.equal(a.bump(s, l), b.bump(s, l));
      ruts = Math.max(ruts, a.rut(s, l));
      bumps = Math.max(bumps, Math.abs(a.bump(s, l)));
    }
  assert.ok(ruts > 0.3 && bumps > 0.005, `ruts ${ruts}, bumps ${bumps}`);
  // Another seed is another race.
  assert.notDeepEqual(race(new Track(course('dusk')), true, 200, false, 8).trace, first.trace);
});

test('crossing out of a rut sets the bike wobbling, and it settles', () => {
  const {track, surface} = wornThrough();
  // A turn, with the rut kept only in a strip down the middle.
  let s = 0;
  while (Math.abs(track.curvature(s)) < 0.03) s += 1;
  const strip = new SurfaceWear(track);
  for (let i = 0; i < 1600; i++)
    for (const lateral of [-0.2, 0.2])
      strip.ride({id: i, speed: 20, grounded: true, crashTime: 0, brake: 0, surface: {s: s - 10 + (i % 40), lateral}});
  track.surface = strip;
  assert.ok(strip.rut(s, 0) > 0.6 && strip.rut(s, 3) === 0, `${strip.rut(s, 0)} and ${strip.rut(s, 3)}`);
  assert.ok(surface.rut(s, 0) === 1);
  const r = makeRider(track, 0, true, 0);
  const p = track.at(s, 0);
  // Riding in the rut for a moment, then steering out of it across the track.
  Object.assign(r, {x: p.x, z: p.z, y: track.height(p.s, 0), heading: Math.atan2(p.tx, p.tz), speed: 14, surface: p});
  r.progress = {...createProgress(s), lastLateral: 0};
  let shook = 0,
    settled = false,
    held = 0,
    started = 0;
  for (let i = 0; i < 120 * 3; i++) {
    const out = i > 6 && shook === 0 ? 0.6 : 0;
    stepRider(r, {...idleControl(), steer: -Math.sign(track.curvature(s)) * out, throttle: 0.4}, track, STEP, [r], 0);
    held = Math.max(held, r.rut);
    if (r.rutShake > 0) {
      if (!shook) started = i;
      shook++;
    } else if (shook) settled = true;
  }
  assert.ok(held >= 0.5, `rut ${held}`);
  assert.ok(shook > 30 && shook < 60, `shook for ${shook} steps`);
  assert.ok(settled && started > 6);
  assert.equal(r.crashes, 0);

  // A wobble leaves the bike pointing where it would have pointed: the swing dies away to nothing.
  const coast = (shake: boolean) => {
    const b = makeRider(track, 0, true, 0);
    const q = track.at(s + 3, 4);
    Object.assign(b, {x: q.x, z: q.z, y: track.height(q.s, 4), heading: Math.atan2(q.tx, q.tz), speed: 12, surface: q});
    b.progress = {...createProgress(q.s), lastLateral: 4};
    if (shake) Object.assign(b, {rutShake: 0.4, rutSide: 1});
    let swung = 0;
    const plain = b.heading;
    stepRider(b, idleControl(), track, STEP, [b], 0);
    swung = Math.abs(b.heading - plain);
    for (let i = 0; i < 59; i++) stepRider(b, idleControl(), track, STEP, [b], 0);
    return {heading: b.heading, swung, shaking: b.rutShake};
  };
  const shaken = coast(true),
    steady = coast(false);
  assert.ok(shaken.swung > steady.swung, 'the wobble swings the bike');
  assert.equal(shaken.shaking, 0);
  assert.ok(Math.abs(shaken.heading - steady.heading) < 0.002, `left ${shaken.heading - steady.heading} rad off`);

  // A rut that simply ends ahead of the bike does not wobble it: riding straight down the strip and off its end.
  const along = makeRider(track, 0, true, 0);
  Object.assign(along, {
    x: p.x,
    z: p.z,
    y: track.height(p.s, 0),
    heading: Math.atan2(p.tx, p.tz),
    speed: 14,
    surface: p,
  });
  along.progress = {...createProgress(s), lastLateral: 0};
  let inRut = 0,
    ended = false;
  for (let i = 0; i < 120 * 6 && !ended; i++) {
    // Steered to hold the middle of the track, where the strip is.
    const steer = Math.max(-1, Math.min(1, -along.surface.lateral * 0.8 + track.curvature(along.surface.s) * 14));
    stepRider(along, {...idleControl(), steer, throttle: 0.3}, track, STEP, [along], 0);
    inRut = Math.max(inRut, along.rut);
    assert.equal(
      along.rutShake,
      0,
      `wobbled at ${along.surface.s.toFixed(1)} m, ${along.surface.lateral.toFixed(2)} across`,
    );
    ended = inRut >= 0.5 && along.rut === 0 && strip.rut(along.surface.s, 0) === 0;
  }
  assert.ok(ended, `rode off the end of the rut (deepest ${inRut}, lateral ${along.surface.lateral})`);
});
