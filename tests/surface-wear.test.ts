import test from 'node:test';
import assert from 'node:assert/strict';
import {createProgress} from '../src/race.ts';
import {TUNING} from '../src/config.ts';
import {COURSES} from '../src/courses.ts';
import {idleControl, makeRider, npcControl, stepRider} from '../src/physics.ts';
import {SaveStore} from '../src/save.ts';
import {SURFACE_REDRAW_MS, SurfaceMesh} from '../src/surface-mesh.ts';
import {BUMP_AMPLITUDE, RUT_TURN_BONUS, SurfaceWear, surfaceFor} from '../src/surface-wear.ts';
import {Track} from '../src/track.ts';
import {RaceSession} from '../src/game/race-session.ts';

const STEP = TUNING.step;
const quiet = {countdown() {}, racing() {}, cue() {}, landing() {}, pause() {}, results() {}};
const course = (id: string) => COURSES.find(c => c.id === id)!;
const dusk = new Track(course('dusk'));

/** Eight computer riders (or one in Time Trial) raced for `seconds`, with wear physics as asked. */
function race(track: Track, wearPhysics: boolean, seconds: number, trial = false, seed = 7) {
  const session: RaceSession = new RaceSession(
    {sample: () => npcControl(session.riders[0], track, [], 'club'), connectedGamepads: () => []},
    quiet,
  );
  session.grid({
    track,
    npcCount: 8,
    humanCount: trial ? 1 : 0,
    practice: false,
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
  for (let s = 0; s < track.length; s += 3)
    for (const speed of [8, 16, 28])
      for (const steer of [-1, 1]) {
        const turned = (t: Track) => {
          const r = makeRider(t, 0, true, 0);
          const p = t.at(s, 0);
          Object.assign(r, {x: p.x, z: p.z, y: t.height(s, 0), heading: Math.atan2(p.tx, p.tz), speed, surface: p});
          const before = r.heading;
          stepRider(r, {...idleControl(), steer, throttle: 0.5}, t, STEP, [r], 0);
          return Math.abs(r.heading - before);
        };
        const ratio = turned(track) / turned(built);
        most = Math.max(most, ratio);
        if (ratio > 1.0001) turns++;
        assert.ok(ratio >= 1 - 1e-9 && ratio <= 1 + RUT_TURN_BONUS + 1e-9, `${ratio} at ${s} m`);
      }
  // The full bonus is reached, and only steering into a turn gets any.
  assert.ok(most > 1.079, `most ${most}`);
  assert.ok(turns > 50);
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

test('the track mesh is redrawn for the worn stretch only, at most once a second', () => {
  const track = new Track(course('dusk'));
  const surface = surfaceFor(track);
  const geometry = track.geometry();
  const mesh = new SurfaceMesh(track, geometry);
  assert.equal(SURFACE_REDRAW_MS, 1000);
  assert.equal(mesh.refresh(0), false, 'nothing worn, nothing redrawn');
  const brake = (s: number) =>
    surface.ride({id: 0, speed: 20, grounded: true, crashTime: 0, brake: 1, surface: {s, lateral: 0}});
  // A minute at 60 frames a second with a bike braking somewhere new every frame.
  const sent: number[] = [];
  let flatAt = 0;
  for (let frame = 0; frame < 3600; frame++) {
    brake((flatAt = 300 + (frame % 200) * 0.3));
    const now = 10000 + (frame * 1000) / 60;
    if (mesh.refresh(now)) sent.push(now);
  }
  assert.ok(sent.length >= 2 && sent.length <= 60, `${sent.length} redraws in a minute`);
  for (let i = 1; i < sent.length; i++) assert.ok(sent[i] - sent[i - 1] >= SURFACE_REDRAW_MS);
  // Only the rows near the braking are redrawn, not the whole lap.
  const rows = Math.ceil(track.length / 0.5);
  assert.ok(mesh.rows > 0 && mesh.rows < rows / 4, `${mesh.rows} of ${rows} rows`);
  // Cleared, the mesh goes back to the track as built.
  mesh.refresh(80000);
  surface.clear();
  assert.equal(mesh.refresh(90000), true);
  const fresh = track.geometry().getAttribute('position'),
    position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i += 7) assert.ok(Math.abs(position.getY(i) - fresh.getY(i)) < 1e-6);
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

test('with wear off a race is the race it was, and with wear on it is a different one', () => {
  // Wear physics left out and switched off are the same race.
  const off = race(new Track(course('dusk')), false, 110);
  const track = new Track(course('dusk'));
  const session: RaceSession = new RaceSession(
    {sample: () => npcControl(session.riders[0], track, [], 'club'), connectedGamepads: () => []},
    quiet,
  );
  session.grid({track, npcCount: 8, humanCount: 0, practice: false, assignments: []});
  session.start({lapCount: 9, difficulty: 'club', seed: 7});
  const trace: number[] = [];
  for (let i = 0; session.raceTime < 110; i++) {
    session.step(STEP);
    if (i % 30 === 0) for (const r of session.riders) trace.push(r.x, r.y, r.z, r.speed, r.heading, r.progress.lap);
  }
  assert.deepEqual(trace, off.trace);
  assert.equal(off.session.track.surface, null);
  // A track that had a worn surface and has it no longer rides as built: nothing lingers on the riders.
  const on = race(new Track(course('dusk')), true, 110);
  assert.notDeepEqual(on.trace, off.trace);
  assert.ok(on.session.riders.some(r => r.rut > 0 || r.bump !== 0));
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
    held = 0;
  for (let i = 0; i < 120 * 3; i++) {
    const out = i > 6 && shook === 0 ? 0.6 : 0;
    stepRider(r, {...idleControl(), steer: -Math.sign(track.curvature(s)) * out, throttle: 0.4}, track, STEP, [r], 0);
    held = Math.max(held, r.rut);
    if (i % 20 === 0)
      console.log(
        i,
        r.rut.toFixed(2),
        r.grounded,
        r.crashTime,
        r.surface.s.toFixed(1),
        r.surface.lateral.toFixed(2),
        r.speed.toFixed(1),
        r.rutShake,
      );
    if (r.rutShake > 0) shook++;
    else if (shook) settled = true;
  }
  assert.ok(held >= 0.5, `rut ${held}`);
  assert.ok(shook > 30 && shook < 60, `shook for ${shook} steps`);
  assert.ok(settled);
  assert.equal(r.crashes, 0);
});
