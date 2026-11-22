import test from 'node:test';
import assert from 'node:assert/strict';
import {TUNING} from '../src/config.ts';
import {COURSES} from '../src/courses.ts';
import {hardestLanding, jumpCall} from '../src/takeoff.ts';
import {Track} from '../src/track.ts';
import {jumpNotice, takeoffVerdict} from '../src/ui/hud.ts';

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

test('the ideal band lands every jump of its lane without a crash, on every circuit', () => {
  for (const c of COURSES) {
    const track = new Track(c);
    for (const jump of track.jumps) {
      const call = jumpCall(track, jump.start - 3, 90)!;
      assert.ok(call.ideal[0] <= call.ideal[1] && call.ideal[1] <= TUNING.maxSpeed);
      for (const speed of call.ideal) {
        const impact = hardestLanding(track, jump, speed);
        assert.ok(
          impact < TUNING.landingCrashImpact,
          `${c.id} jump at ${jump.start} at ${speed} m/s lands at ${impact}`,
        );
      }
    }
  }
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
