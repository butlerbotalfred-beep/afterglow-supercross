import test from 'node:test';
import assert from 'node:assert/strict';
import {TUNING} from '../src/config.ts';
import {COURSES} from '../src/courses.ts';
import {makeRider, npcControl, stepRider} from '../src/physics.ts';
import {createProgress} from '../src/race.ts';
import {jumpCall} from '../src/takeoff.ts';
import {Track} from '../src/track.ts';
import {callOutranksLanding, jumpNotice, meterColor, SWEET_TOLERANCE, takeoffVerdict} from '../src/ui/hud.ts';

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
  // The rider's progress starts here too: without it the route check sends the rider back to the start line.
  const progress = {...createProgress(from), lastLateral: p.lateral};
  Object.assign(r, {
    x: p.x,
    z: p.z,
    y: track.height(from),
    heading: Math.atan2(p.tx, p.tz),
    surface: p,
    speed,
    progress,
  });
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

test('a real rider at the sweet spot, or anywhere the meter calls perfect, gets through the lane on every circuit', () => {
  for (const c of COURSES) {
    const track = new Track(c);
    for (const [lip, call] of laneStarts(track)) {
      assert.ok(
        call.sweet >= 20 && call.sweet <= TUNING.maxSpeed,
        `${c.id} ${call.kind} at ${lip}: the sweet spot ${call.sweet} is a jumping speed`,
      );
      // To the end of this lane and a little beyond, but not into the next one.
      const metres = call.kind === 'TABLETOP' || call.kind === 'SINGLE' ? 110 : 200;
      const perfect = [
        call.sweet - SWEET_TOLERANCE,
        call.sweet,
        Math.min(TUNING.maxSpeed, call.sweet + SWEET_TOLERANCE),
      ];
      for (const speed of perfect)
        assert.equal(
          rideLane(track, lip - 40, metres, speed).crashed,
          false,
          `${c.id} ${call.kind} at ${lip}, ${speed} m/s`,
        );
    }
  }
});

/** Where a real rider holding `speed` comes down after the first lip: the share of the way down a landing slope. */
function landing(track: Track, lip: number, speed: number) {
  const from = lip - 40,
    r = makeRider(track, 0, false, 0xffffff),
    p = track.at(from);
  const progress = {...createProgress(from), lastLateral: p.lateral};
  Object.assign(r, {
    x: p.x,
    z: p.z,
    y: track.height(from),
    heading: Math.atan2(p.tx, p.tz),
    surface: p,
    speed,
    progress,
  });
  const past = (s: number, mark: number) => (((s - mark) % track.length) + track.length) % track.length;
  let air = 0;
  for (let steps = 0; steps < 8 / TUNING.step && r.crashes === 0; steps++) {
    const c = npcControl(r, track, [r], 'club');
    c.throttle = Math.max(0, Math.min(1, (speed - r.speed) * 0.55));
    c.brake = 0;
    const was = r.grounded;
    stepRider(r, c, track, TUNING.step, [r]);
    if (!r.grounded) air += TUNING.step;
    else if (!was) {
      // The first real flight that ends beyond the lip is the jump; hops on the face are not.
      if (air > 0.3 && past(r.surface.s, lip) < 200) {
        for (const j of track.jumps) {
          const down = past(r.surface.s, j.start + j.rise + j.flat);
          if (down <= j.fall) return {slope: 'down', share: down / j.fall, crashed: r.crashes > 0};
        }
        return {slope: 'other', share: NaN, crashed: r.crashes > 0};
      }
      air = 0;
    }
  }
  return {slope: 'none', share: NaN, crashed: r.crashes > 0};
}

test('a real rider at the sweet spot lands on the down slope, not short of it and not past it', () => {
  for (const c of COURSES) {
    const track = new Track(c);
    for (const [lip, call] of laneStarts(track)) {
      if (call.kind === 'WHOOPS') continue;
      const at = `${c.id} ${call.kind} at ${lip}, sweet spot ${call.sweet.toFixed(1)} m/s`;
      const sweet = landing(track, lip, call.sweet);
      assert.equal(sweet.slope, 'down', at);
      assert.ok(sweet.share > 0.25 && sweet.share < 0.55, `${at}: lands ${sweet.share.toFixed(2)} of the way down`);
      // Anywhere the meter calls perfect still comes down on the slope.
      for (const speed of [call.sweet - SWEET_TOLERANCE, call.sweet + SWEET_TOLERANCE]) {
        const edge = landing(track, lip, speed);
        assert.equal(edge.slope, 'down', `${at}, at ${speed.toFixed(1)}`);
        assert.ok(edge.share > 0.03 && edge.share < 0.85, `${at}, at ${speed.toFixed(1)}: ${edge.share.toFixed(2)}`);
        assert.equal(edge.crashed, false, `${at}, at ${speed.toFixed(1)}`);
      }
    }
  }
});

test('a tabletop is not called flat out: top speed flies past its landing', () => {
  const table = lanes(dusk).find(c => c.kind === 'TABLETOP')!;
  assert.ok(table.sweet * 3.6 > 110 && table.sweet * 3.6 < 135, `tabletop sweet spot ${table.sweet} m/s`);
  assert.equal(takeoffVerdict(table, TUNING.maxSpeed), 'EASE OFF');
  assert.notEqual(landing(dusk, 26, TUNING.maxSpeed).slope, 'down');
});

test('the sweet spot is quicker through the lane than rolling it, and too slow really comes up short', () => {
  const call = laneStarts(dusk).find(([, c]) => c.kind === 'DOUBLE')!;
  const [lip, double] = call;
  const ideal = rideLane(dusk, lip - 40, 160, double.sweet);
  const rolling = rideLane(dusk, lip - 40, 160, 20);
  assert.ok(!rolling.crashed && ideal.seconds < rolling.seconds - 1, `${ideal.seconds} s against ${rolling.seconds} s`);
  const short = double.from + (double.zones.indexOf('crash') + 1) * double.step;
  assert.equal(rideLane(dusk, lip - 40, 160, short).crashed, true, `${short} m/s is red on the meter and crashes`);
});

test('a double asks for race pace, above the band that comes up short', () => {
  const call = lanes(dusk).find(c => c.kind === 'DOUBLE')!;
  const short = call.zones.indexOf('crash');
  assert.ok(short >= 0, 'a double has takeoff speeds that crash');
  assert.ok(call.sweet - SWEET_TOLERANCE > call.from + short * call.step, 'the sweet spot is above them');
  assert.equal(takeoffVerdict(call, 15), 'BUILD SPEED');
  assert.equal(takeoffVerdict(call, call.from + short * call.step), 'TOO SLOW · COMES UP SHORT');
  assert.ok(call.sweet * 3.6 > 100 && call.sweet * 3.6 < 140, `sweet spot ${call.sweet} m/s`);
  assert.equal(takeoffVerdict(call, call.sweet), 'PERFECT');
  assert.equal(takeoffVerdict(call, call.sweet + SWEET_TOLERANCE - 0.01), 'PERFECT');
  assert.notEqual(takeoffVerdict(call, call.sweet - SWEET_TOLERANCE - 0.1), 'PERFECT');
  assert.match(takeoffVerdict(call, TUNING.maxSpeed), /^(EASE OFF|TOO FAST · OVERSHOOTS)$/);
});

test('the sweet spot never sits above a band of crashing speeds when a safe racing speed lies below it', () => {
  for (const c of COURSES) {
    const track = new Track(c);
    for (const [lip, call] of laneStarts(track)) {
      const at = (speed: number) => call.zones[Math.round((speed - call.from) / call.step)];
      for (let v = Math.ceil(call.sweet - SWEET_TOLERANCE); v <= call.sweet + SWEET_TOLERANCE; v++)
        if (v <= TUNING.maxSpeed)
          assert.notEqual(at(v), 'crash', `${c.id} ${call.kind} at ${lip}: ${v} m/s is perfect`);
      let band = -1;
      for (let v = Math.floor(call.sweet) - 1; v >= 28 && band < 0; v--) if (at(v) === 'crash') band = v;
      if (band < 0) continue;
      while (at(band - 1) === 'crash') band--;
      let safeBelow = false;
      for (let v = band - 3; v >= 28; v--) safeBelow ||= [-2, -1, 0, 1, 2].every(off => at(v + off) !== 'crash');
      assert.equal(safeBelow, false, `${c.id} ${call.kind} at ${lip}: sweet ${call.sweet} is above a crash band`);
    }
  }
  const canyon = new Track(COURSES.find(c => c.id === 'canyon')!);
  const triple = lanes(canyon).find(c => c.kind === 'TRIPLE')!;
  assert.ok(triple.sweet < 38, `the canyon triple is called at ${triple.sweet} m/s, below the speeds that overshoot`);
  assert.equal(takeoffVerdict(triple, 40), 'TOO FAST · OVERSHOOTS');
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
  assert.equal(between.sweet, before.sweet);
});

test('the notice shows the jump, the distance, the meter and the verdict', () => {
  const call = lanes(dusk).find(c => c.kind === 'DOUBLE')!;
  const html = jumpNotice({...call, distance: 52}, 15);
  assert.match(html, /DOUBLE · 50 M/);
  assert.match(html, /takeoff-meter off-pace/);
  assert.match(html, /BUILD SPEED · \d+ KM\/H/);
  assert.match(html, /linear-gradient/);
  assert.match(
    jumpNotice({...call, distance: 0}, call.sweet),
    /<b class="pace-label">DOUBLE<\/b>.*takeoff-meter perfect.*left:50\.0%.*takeoff-perfect">PERFECT/,
  );
  const slow = /left:([\d.]+)%/.exec(jumpNotice(call, 15))![1],
    fast = /left:([\d.]+)%/.exec(jumpNotice(call, 40))![1];
  assert.ok(Number(fast) > Number(slow), 'the marker moves right with speed');
});

test('the meter fades from a narrow green at the sweet spot through yellow and orange to red, the same both ways', () => {
  assert.equal(meterColor(0), 'rgb(57,227,107)');
  assert.equal(meterColor(9), 'rgb(229,72,77)');
  assert.equal(meterColor(-20), meterColor(20));
  assert.equal(meterColor(-3), meterColor(3));
  assert.notEqual(meterColor(SWEET_TOLERANCE + 1), meterColor(0), 'green is only at the sweet spot');
  const call = lanes(dusk).find(c => c.kind === 'DOUBLE')!;
  const paint = /background:(linear-gradient\([^"]+\))"/.exec(jumpNotice(call, 15))![1];
  assert.deepEqual(
    paint.match(/rgb\([\d,]+\)/g),
    [9, 5.5, 2.5, 1.25, 1.25, 2.5, 5.5, 9].map(meterColor),
    'red, orange, yellow, green, green, yellow, orange, red',
  );
  // The marker line glows in the colour it is over, and has no colour of its own to add when it is perfect.
  assert.match(jumpNotice(call, call.sweet - 5), new RegExp(`--glow:${meterColor(5).replace(/[()]/g, '\\$&')}`));
  assert.doesNotMatch(jumpNotice(call, call.sweet), /--glow/);
});

test('the landing cue gets its moment unless a new lane is nearly here', () => {
  const call = lanes(dusk).find(c => c.kind === 'DOUBLE')!;
  assert.equal(callOutranksLanding(null), false);
  assert.equal(callOutranksLanding({...call, distance: 0}), false, 'between the jumps of a lane the landing shows');
  assert.equal(callOutranksLanding({...call, distance: 80}), false, 'a lane still far off waits');
  assert.equal(callOutranksLanding({...call, distance: 30}), true, 'a lane 30 m away comes first');
});
