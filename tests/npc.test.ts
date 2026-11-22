import test from 'node:test';
import assert from 'node:assert/strict';
import {COURSES} from '../src/courses.ts';
import {makeRider, npcControl, stepRider} from '../src/physics.ts';
import {Track} from '../src/track.ts';

const alpine = () => new Track(COURSES.find(c => c.id === 'alpine')!);

test('an AI rider who has lost the rhythm rolls the lane instead of accelerating into it', () => {
  const track = alpine();
  const lane = track.rhythms.find(r => r.start > 50 && r.start < 120)!;
  const s = lane.start + 30;
  const at = (speed: number) => {
    const r = makeRider(track, 0, false, 0xffffff),
      p = track.at(s);
    Object.assign(r, {x: p.x, z: p.z, y: track.height(s), heading: Math.atan2(p.tx, p.tz), surface: p, speed});
    return npcControl(r, track, [r], 'club');
  };
  assert.equal(at(lane.pace * 0.9).throttle, 1, 'a rider near the lane pace still drives up to it');
  const lost = at(lane.pace * 0.69);
  assert.ok(lost.throttle < 0.5, `just under the roll speed the throttle is nearly shut, got ${lost.throttle}`);
  assert.equal(at(lane.pace * 0.5).throttle, 1, 'a much slower rider drives up to the roll speed');
  const fast = at(lane.pace * 0.75);
  assert.equal(fast.throttle, 1, 'above 70% of the pace the rider is still on the rhythm');
});

test('the back row finishes the first Pine Summit rhythm lane without a crash', () => {
  for (const difficulty of ['club', 'expert']) {
    const track = alpine();
    const riders = Array.from({length: 4}, (_, id) => makeRider(track, id, false, 0xffffff));
    for (let f = 0; f < 120 * 15; f++)
      for (const r of riders) stepRider(r, npcControl(r, track, riders, difficulty), track, 1 / 120, riders);
    assert.deepEqual(
      riders.map(r => r.crashes),
      [0, 0, 0, 0],
      `${difficulty}: the extra acceleration used to throw riders 2 and 3 into the third face`,
    );
  }
});
