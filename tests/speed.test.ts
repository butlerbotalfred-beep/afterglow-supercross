import test from 'node:test';
import assert from 'node:assert/strict';
import {Track} from '../src/track.ts';
import {makeRider, stepRider, idleControl} from '../src/physics.ts';

// A level straight isolates engine output from ramp, corner and landing losses.
function straight() {
  const track = new Track(),
    point = track.at(0);
  track.height = () => 0;
  track.at = (s: number, lateral = 0) => ({
    ...point,
    x: lateral,
    z: s,
    s,
    lateral,
    tx: 0,
    tz: 1,
    distance: Math.abs(lateral),
  });
  track.project = (x: number, z: number) => track.at(z, x);
  return track;
}
test('full throttle delivers the additional 25% acceleration increase and reaches the 182.25 km/h ceiling', () => {
  const track = straight(),
    r = makeRider(track, 0, true, 0xffffff),
    dt = 1 / 120;
  Object.assign(r, {x: 0, z: 0, y: 0, heading: 0, surface: track.at(0)});
  const throttle = {...idleControl(), throttle: 1};
  stepRider(r, throttle, track, dt, [r]);
  assert.ok(Math.abs(r.speed / dt - 23.4375) < 1e-8, 'launch acceleration is 23.4375 m/s²');
  for (let i = 1; i < 8 / dt; i++) stepRider(r, throttle, track, dt, [r]);
  assert.equal(r.speed, 50.625, 'sustained throttle reaches and holds 182.25 km/h');
  assert.ok(r.z > 300, 'the bike covers the expected faster straight-line distance');
  for (let i = 0; i < 2 / dt; i++) stepRider(r, {...idleControl(), brake: 1}, track, dt, [r]);
  assert.equal(r.speed, 0, 'brakes still stop the faster bike');
});

test('a jump entered at the new maximum carries momentum through a finite, recoverable landing', () => {
  const track = new Track(),
    r = makeRider(track, 0, true, 0xffffff),
    p = track.at(8),
    dt = 1 / 120;
  Object.assign(r, {x: p.x, z: p.z, y: track.height(8), surface: p, heading: Math.atan2(p.tx, p.tz), speed: 50.625});
  let launched = false,
    landed = false,
    maxAir = 0;
  for (let frame = 0; frame < 5 / dt; frame++) {
    stepRider(r, {...idleControl(), throttle: 1, pitch: r.grounded ? 0 : -0.3}, track, dt, [r]);
    assert.ok([r.x, r.y, r.z, r.speed, r.pitch, r.vy].every(Number.isFinite));
    assert.ok(r.speed <= 50.625);
    if (!r.grounded) {
      launched = true;
      maxAir = Math.max(maxAir, r.y - track.height(r.surface.s, r.surface.lateral));
    }
    if (launched && r.lastLanding > 0) {
      landed = true;
      break;
    }
  }
  assert.ok(launched && landed, 'launch and landing both occur at the increased entry speed');
  assert.ok(maxAir > 0.2);
  assert.equal(r.recovery, 0, 'the faster jump does not trigger an automatic reset');
  assert.ok(r.speed > 10, 'the bike retains useful momentum on landing');
});
