import test from 'node:test';
import assert from 'node:assert/strict';
import {TUNING} from '../src/config.ts';
import {COURSES} from '../src/courses.ts';
import {makeRider, npcControl, stepRider} from '../src/physics.ts';
import {hardestLanding, lipDistance, safeTakeoffSpeed} from '../src/takeoff.ts';
import {Track} from '../src/track.ts';

const course = (id: string) => new Track(COURSES.find(c => c.id === id)!);
const place = (track: Track, id: number, s: number, speed: number) => {
  const r = makeRider(track, id, false, 0xffffff),
    p = track.at(s);
  return Object.assign(r, {x: p.x, z: p.z, y: track.height(s), heading: Math.atan2(p.tx, p.tz), surface: p, speed});
};

test('a rhythm jump has a band of takeoff speeds that ends on the next face', () => {
  const track = course('alpine');
  const jump = track.jumps.find(j => j.start > 90 && j.start < 100)!;
  assert.ok(hardestLanding(track, jump, 15) < TUNING.landingCrashImpact * 0.6, 'rolling it is gentle');
  assert.ok(hardestLanding(track, jump, 28) > TUNING.landingCrashImpact, '28 m/s comes up short and crashes');
  assert.ok(hardestLanding(track, jump, 35) < TUNING.landingCrashImpact, 'the lane pace clears it');
});

test('the advised takeoff speed is never a crashing one, on any jump of any circuit', () => {
  for (const c of COURSES) {
    const track = new Track(c);
    for (const jump of track.jumps) {
      const s = jump.start - 5;
      for (let fastest = 8; fastest <= TUNING.maxSpeed; fastest += 1.5) {
        const advised = safeTakeoffSpeed(track, s, 45, Math.max(0, fastest - 6), fastest);
        assert.ok(advised !== null, `${c.id} jump at ${jump.start}: some speed is always safe`);
        const impact = hardestLanding(track, jump, advised);
        assert.ok(
          impact < TUNING.landingCrashImpact,
          `${c.id} jump at ${jump.start}: ${advised} m/s lands at ${impact}`,
        );
      }
    }
  }
  const track = course('alpine');
  assert.equal(lipDistance(track, 400, 45), null, 'no jump within reach on the long straight');
  assert.equal(safeTakeoffSpeed(track, 400, 45, 0, 40), null);
});

test('an AI rider short of the lane pace picks a takeoff speed that lands safely', () => {
  const track = course('alpine');
  const jump = track.jumps.find(j => j.start > 90 && j.start < 100)!;
  // Each of these entries accelerated into the crashing band and ended on the next face before the rule.
  for (const [back, speed] of [
    [4, 18],
    [4, 22],
    [8, 14],
    [8, 18],
  ]) {
    const r = place(track, 0, jump.start - back, speed);
    for (let f = 0; f < 4 / TUNING.step && r.crashes === 0; f++)
      stepRider(r, npcControl(r, track, [r], 'club'), track, TUNING.step, [r]);
    assert.equal(r.crashes, 0, `${back} m before the jump at ${speed} m/s`);
  }
});

test('an AI rider does not close fast on a much slower rider in its line', () => {
  const track = course('alpine');
  const r = place(track, 0, 300, 30);
  const far = place(track, 1, 420, 12);
  assert.equal(npcControl(r, track, [r, far], 'club').brake, 0, 'nothing to brake for with a clear track');
  const near = place(track, 1, 312, 12);
  const c = npcControl(r, track, [r, near], 'club');
  assert.equal(c.throttle, 0);
  assert.ok(c.brake > 0.3, `brakes for the slow rider, got ${c.brake}`);
});
