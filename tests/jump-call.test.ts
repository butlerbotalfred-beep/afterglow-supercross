import test from 'node:test';
import assert from 'node:assert/strict';
import {TUNING} from '../src/config.ts';
import {COURSES} from '../src/courses.ts';
import {makeRider, npcControl, stepRider} from '../src/physics.ts';
import {jumpCall} from '../src/takeoff.ts';
import {Track} from '../src/track.ts';
import {callOutranksLanding, jumpNotice, takeoffVerdict} from '../src/ui/hud.ts';

const dusk = new Track(COURSES.find(c => c.id === 'dusk')!);
const lanes = (track: Track) => {
  const seen = new Map<string, NonNullable<ReturnType<typeof jumpCall>>>();
  for (let s = 0; s < track.length; s += 2) {
    const call = jumpCall(track, s, 90);
    if (call && call.distance > 0 && !seen.has(`${Math.round(s + call.distance)}`))
      seen.set(`${Math.round(s + call.distance)}`, call);
  }
  return [...seen.values()];
};

test('the callout names what is coming: tabletop, double, triple, whoops', () => {
  const kinds = new Set(lanes(dusk).map(c => c.kind));
  for (const kind of ['TABLETOP', 'DOUBLE', 'TRIPLE', 'WHOOPS'])
    assert.ok(kinds.has(kind), `Dusk Valley has a ${kind}`);
  assert.equal(jumpCall(dusk, 12, 90)!.kind, 'TABLETOP', 'the opening tabletop');
  const alpine = new Track(COURSES.find(c => c.id === 'alpine')!);
  assert.ok(
    lanes(alpine).some(c => c.kind === 'RHYTHM ×4'),
    'Pine Summit has a four-jump rhythm lane',
  );
  assert.equal(jumpCall(alpine, 400, 90), null, 'nothing is called on a long straight');
});

/** A real rider through a lane: the AI steers and pitches, the throttle holds `speed`. */
function rideLane(track: Track, from: number, metres: number, speed: number) {
  const r = makeRider(track, 0, false, 0xffffff),
    p = track.at(from);
  Object.assign(r, {x: p.x, z: p.z, y: track.height(from), heading: Math.atan2(p.tx, p.tz), surface: p, speed});
  let steps = 0;
  for (; steps < 20 / TUNING.step && r.crashes === 0; steps++) {
    const travelled = (r.surface.s - from + track.length) % track.length;
    if (travelled > metres && travelled < track.length / 2) break;
    const c = npcControl(r, track, [r], 'club');
    c.throttle = Math.max(0, Math.min(1, (speed - r.speed) * 0.55));
    c.brake = 0;
    stepRider(r, c, track, TUNING.step, [r]);
  }
  return {crashed: r.crashes > 0, seconds: steps * TUNING.step};
}
const laneStarts = (track: Track) => {
  const starts = new Map<number, NonNullable<ReturnType<typeof jumpCall>>>();
  for (let s = 0; s < track.length; s += 2) {
    const call = jumpCall(track, s, 90);
    if (call && call.distance > 0) starts.set(Math.round(s + call.distance), call);
  }
  return [...starts];
};

test('a real rider holding any speed in the ideal band gets through the lane, on every circuit', () => {
  for (const c of COURSES) {
    const track = new Track(c);
    for (const [lip, call] of laneStarts(track)) {
      assert.ok(call.ideal[0] >= 20, `${c.id} ${call.kind} at ${lip}: the ideal band is racing pace, not rolling`);
      assert.ok(call.ideal[0] <= call.ideal[1] && call.ideal[1] <= TUNING.maxSpeed);
      // To the end of this lane and a little beyond, but not into the next one.
      const metres = call.kind === 'TABLETOP' || call.kind === 'SINGLE' ? 110 : 200;
      for (const speed of [call.ideal[0], (call.ideal[0] + call.ideal[1]) / 2, call.ideal[1]])
        assert.equal(
          rideLane(track, lip - 40, metres, speed).crashed,
          false,
          `${c.id} ${call.kind} at ${lip}, ${speed} m/s`,
        );
    }
  }
});

test('the ideal band is quicker through the lane than rolling it, and red below it really comes up short', () => {
  const call = laneStarts(dusk).find(([, c]) => c.kind === 'DOUBLE')!;
  const [lip, double] = call;
  const ideal = rideLane(dusk, lip - 40, 160, double.ideal[1]);
  const rolling = rideLane(dusk, lip - 40, 160, 20);
  assert.ok(!rolling.crashed && ideal.seconds < rolling.seconds - 1, `${ideal.seconds} s against ${rolling.seconds} s`);
  const short = double.from + (double.zones.indexOf('crash') + 1) * double.step;
  assert.equal(rideLane(dusk, lip - 40, 160, short).crashed, true, `${short} m/s is red on the meter and crashes`);
});

test('a double asks for race pace, above the band that comes up short', () => {
  const call = lanes(dusk).find(c => c.kind === 'DOUBLE')!;
  const short = call.zones.indexOf('crash');
  assert.ok(short >= 0, 'a double has takeoff speeds that crash');
  assert.ok(call.ideal[0] > call.from + short * call.step, 'the ideal band is above them');
  assert.ok(call.ideal[0] * 3.6 > 100 && call.ideal[1] * 3.6 < 140, `ideal ${call.ideal} m/s`);
  assert.equal(takeoffVerdict(call, 15), 'BUILD SPEED');
  assert.equal(takeoffVerdict(call, call.from + short * call.step), 'TOO SLOW · COMES UP SHORT');
  assert.equal(takeoffVerdict(call, (call.ideal[0] + call.ideal[1]) / 2), 'ON PACE');
  assert.match(takeoffVerdict(call, TUNING.maxSpeed), /^(EASE OFF|TOO FAST · OVERSHOOTS)$/);
});

test('the advice does not change between the jumps of a lane', () => {
  const triple = dusk.jumps.filter(j => j.start > 1990 && j.start < 2080);
  assert.equal(triple.length, 3);
  const before = jumpCall(dusk, triple[0].start - 40, 90)!;
  const between = jumpCall(dusk, triple[1].start - 2, 90)!;
  assert.equal(before.kind, 'TRIPLE');
  assert.ok(before.distance > 0);
  assert.equal(between.kind, 'TRIPLE');
  assert.equal(between.distance, 0, 'inside the lane there is no distance to show');
  assert.deepEqual(between.ideal, before.ideal);
});

test('the notice shows the jump, the distance, the meter and the verdict', () => {
  const call = lanes(dusk).find(c => c.kind === 'DOUBLE')!;
  const html = jumpNotice({...call, distance: 52}, 15);
  assert.match(html, /DOUBLE · 50 M/);
  assert.match(html, /takeoff-meter off-pace/);
  assert.match(html, /BUILD SPEED · \d+–\d+ KM\/H/);
  assert.match(html, /linear-gradient/);
  assert.match(
    jumpNotice({...call, distance: 0}, call.ideal[0]),
    /<b class="pace-label">DOUBLE<\/b>.*takeoff-on-pace">ON PACE/,
  );
  const slow = /left:([\d.]+)%/.exec(jumpNotice(call, 15))![1],
    fast = /left:([\d.]+)%/.exec(jumpNotice(call, 40))![1];
  assert.ok(Number(fast) > Number(slow), 'the marker moves right with speed');
});

test('the landing cue gets its moment unless a new lane is nearly here', () => {
  const call = lanes(dusk).find(c => c.kind === 'DOUBLE')!;
  assert.equal(callOutranksLanding(null), false);
  assert.equal(callOutranksLanding({...call, distance: 0}), false, 'between the jumps of a lane the landing shows');
  assert.equal(callOutranksLanding({...call, distance: 80}), false, 'a lane still far off waits');
  assert.equal(callOutranksLanding({...call, distance: 30}), true, 'a lane 30 m away comes first');
});
