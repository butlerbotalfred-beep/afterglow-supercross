import test from 'node:test';
import assert from 'node:assert/strict';
import {Track} from '../src/track.ts';
import {makeRider, stepRider, idleControl} from '../src/physics.ts';
import {mapKeyboard, mapGamepad} from '../src/input.ts';
import {createProgress, updateProgress} from '../src/race.ts';
import {TouchInput} from '../src/touch-input.ts';

const track = new Track(),
  dt = 1 / 120;
test('expanded course is nine times the original length and nearby lanes remain separate', () => {
  assert.ok(Math.abs(track.length - 285.3680274792382 * 9) < 0.001);
  assert.ok(track.jumps.length >= 20 && Math.max(...track.jumps.map(j => j.height)) >= 4);
  for (let i = 0; i < track.count; i += 15) {
    const a = track.samples[i];
    for (let j = i + 1; j < track.count; j += 15) {
      const separation = (Math.min(j - i, track.count - (j - i)) * track.length) / track.count;
      if (separation < 25) continue;
      assert.ok(a.distanceTo(track.samples[j]) > 16, 'non-adjacent track corridors must not intersect');
    }
  }
});
test('spatial projection follows every section, both edges and the finish seam', () => {
  for (let s = 0; s < track.length; s += 3.7)
    for (const l of [-4.5, 0, 4.5]) {
      const point = track.at(s, l),
        actual = track.project(point.x, point.z);
      assert.ok(Math.abs(actual.lateral - l) < 0.015);
      const d = Math.abs(actual.s - s);
      assert.ok(Math.min(d, track.length - d) < 0.15);
    }
  const far = track.project(1000, 1000);
  assert.ok(Number.isFinite(far.s) && far.distance > 500);
});
test('nose-down controls are independent of throttle and touch inversion', () => {
  assert.equal(mapKeyboard(new Set(['Space', 'KeyW'])).pitch, -1);
  assert.equal(mapKeyboard(new Set(['KeyQ'])).pitch, -1);
  const pad = {
    index: 0,
    id: 'pad',
    axes: [0, -1, 0, 0],
    buttons: Array.from({length: 8}, (_, i) => ({value: i === 7 ? 1 : 0})),
  };
  assert.equal(mapGamepad(pad).pitch, -1);
  assert.equal(mapGamepad(pad).throttle, 1);
  const touch = new TouchInput();
  touch.setEnabled(true);
  touch.setDirections('regular', 'inverted');
  touch.start(1, 'throttle');
  touch.start(2, 'noseDown');
  touch.start(3, 'stick');
  touch.move(3, 0.5, 1);
  assert.equal(touch.read().pitch, -1);
  assert.equal(touch.read().throttle, 1);
  assert.ok(touch.read().steer < 0);
  touch.end(2);
  assert.equal(touch.read().pitch, 1);
  assert.equal(touch.read().throttle, 1);
  touch.clear();
  assert.equal(touch.read().pitch, 0);
  assert.equal(touch.read().throttle, 0);
});
for (const name of ['DOUBLE ALLEY', 'TRIPLE CROWN'])
  test(`${name}: real takeoff can be pitched down while preserving flight momentum`, () => {
    const section = track.sections.find(s => s.name === name)!;
    const jump = track.jumps.find(j => j.start >= section.start)!;
    const rider = makeRider(track, 0, true, 0xffffff),
      p = track.at(jump.start - 2);
    Object.assign(rider, {
      x: p.x,
      z: p.z,
      y: track.height(p.s),
      surface: p,
      heading: Math.atan2(p.tx, p.tz),
      speed: 24,
    });
    // This fixture starts mid-course: seed its legitimate route history instead
    // of teleporting a start-grid progress record to the jump.
    rider.progress = createProgress();
    for (let s = 1; s < p.s; s++) updateProgress(rider.progress, s, 0, track.length, track.halfWidth, dt);
    updateProgress(rider.progress, p.s, 0, track.length, track.halfWidth, dt);
    for (let i = 0; i < 240 && rider.grounded; i++)
      stepRider(rider, {...idleControl(), throttle: 1}, track, dt, [rider]);
    assert.equal(rider.grounded, false, 'ramp must produce takeoff');
    const down = structuredClone(rider),
      neutral = structuredClone(rider),
      airBrake = structuredClone(rider);
    for (let i = 0; i < 24; i++) {
      stepRider(
        down,
        mapGamepad({
          index: 0,
          id: 'left-stick pad',
          axes: [0, -1, 0, 1],
          buttons: Array.from({length: 8}, (_, i) => ({value: i === 7 ? 1 : 0})),
        }),
        track,
        dt,
        [down],
      );
      stepRider(neutral, idleControl(), track, dt, [neutral]);
      stepRider(airBrake, {...idleControl(), brake: 1}, track, dt, [airBrake]);
    }
    assert.equal(down.grounded, false);
    assert.ok(down.pitch < neutral.pitch - 0.4, 'nose dip must be clearly visible within 200 ms');
    assert.ok(airBrake.pitch < neutral.pitch - 0.15, 'air brake also dips the nose');
    assert.ok(Math.abs(airBrake.speed - neutral.speed) < 0.001, 'air brake should not stop horizontal flight');
    let landed = false;
    for (let i = 0; i < 240 && !landed; i++) {
      stepRider(down, idleControl(), track, dt, [down]);
      landed = down.lastLanding > 0;
    }
    assert.ok(landed && down.speed > 10, 'release dip and land with usable speed');
  });
