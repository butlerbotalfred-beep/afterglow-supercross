import test from 'node:test';
import assert from 'node:assert/strict';
import {TUNING} from '../src/config.ts';
import {COURSES} from '../src/courses.ts';
import {neutralControl} from '../src/input.ts';
import {ASSIST_EASE_MIN, ASSIST_GAIN_MAX, makeRider, npcControl, stepRider, type Rider} from '../src/physics.ts';
import {
  ROSTER,
  catchUpEase,
  cornerPace,
  gridFor,
  mistakeRate,
  overall,
  riderLabel,
  rhythmPace,
  slipFor,
  startSharpness,
} from '../src/riders.ts';
import {Track} from '../src/track.ts';
import {RaceSession} from '../src/game/race-session.ts';

const STEP = TUNING.step;
const coast = new Track(COURSES.find(c => c.id === 'coast')!);

/** A race with one human, who rides on the autopilot so that the inputs are the same every time. */
function race(options: {
  seed: number;
  npcs?: number;
  humans?: number;
  catchUp?: boolean;
  laps?: number;
  human?: number;
}) {
  const humans = options.humans ?? 1;
  const session: RaceSession = new RaceSession(
    {
      sample: device => {
        const r = session.riders.find(x => x.device === device)!;
        if (session.phase !== 'racing') return {...neutralControl(), throttle: 0.68};
        const c = npcControl(r, coast, session.riders, 'club');
        return {...c, throttle: c.throttle * (options.human ?? 1)};
      },
      connectedGamepads: () => [],
    },
    {countdown: () => {}, racing: () => {}, cue: () => {}, landing: () => {}, pause: () => {}, results: () => {}},
  );
  session.grid({
    track: coast,
    humanCount: humans,
    npcCount: options.npcs ?? 7,
    practice: false,
    assignments: [
      {kind: 'keyboard'},
      {kind: 'gamepad', index: 0},
      {kind: 'gamepad', index: 1},
      {kind: 'gamepad', index: 2},
    ],
    difficulty: 'club',
    seed: options.seed,
  });
  session.start({lapCount: options.laps ?? 1, difficulty: 'club', seed: options.seed, catchUp: options.catchUp});
  return session;
}
const finish = (session: RaceSession, limit = 400) => {
  for (let t = 0; t < limit && session.phase !== 'results'; t += STEP) session.step(STEP);
  return session.riders.map(r => [r.name, r.finished] as const).sort((a, b) => (a[1] ?? 1e9) - (b[1] ?? 1e9));
};

test('the roster is twelve different riders with five ratings each', () => {
  assert.equal(ROSTER.length, 12);
  assert.equal(new Set(ROSTER.map(p => p.name)).size, 12);
  assert.equal(new Set(ROSTER.map(p => p.number)).size, 12);
  assert.equal(new Set(ROSTER.map(p => p.plate)).size, 12);
  for (const p of ROSTER) {
    for (const rating of [p.corner, p.rhythm, p.starts, p.aggression, p.consistency])
      assert.ok(Number.isInteger(rating) && rating >= 0 && rating <= 100, `${p.name}: ${rating}`);
    assert.match(riderLabel({name: p.name, profile: p}), /^#\d{1,2} [A-Z]\. [A-Z]+$/);
  }
  assert.deepEqual(
    ROSTER.map(overall),
    ROSTER.map(overall).sort((a, b) => b - a),
    'fastest first',
  );
});

test('each rating changes how the rider rides', () => {
  const by = (key: 'corner' | 'rhythm' | 'starts' | 'consistency') => [...ROSTER].sort((a, b) => a[key] - b[key]);
  const rising = (values: number[]) => values.every((v, i) => i === 0 || v >= values[i - 1]);
  assert.ok(rising(by('corner').map(cornerPace)), 'more corner speed, more pace');
  assert.ok(rising(by('rhythm').map(rhythmPace)), 'more rhythm skill, more rhythm pace');
  assert.ok(rising(by('starts').map(p => -startSharpness(p))), 'better starts, sharper off the gate');
  assert.ok(rising(by('consistency').map(p => -mistakeRate(p))), 'more consistency, fewer mistakes');
  // The old single multipliers are still where the roster is anchored.
  assert.ok(Math.abs(cornerPace({...ROSTER[0], corner: 84}) - 0.92) < 1e-9);
  assert.ok(Math.abs(cornerPace({...ROSTER[0], corner: 96}) - 1.04) < 1e-9);
  for (const p of ROSTER) assert.ok(rhythmPace(p) >= 0.98 && rhythmPace(p) <= 1.02, `${p.name} rhythm pace`);
});

test('the pace setting chooses which riders are on the grid', () => {
  for (const count of [1, 3, 4, 7, 8]) {
    const grids = ['relaxed', 'club', 'expert'].map(d => gridFor(d, count));
    for (const grid of grids) {
      assert.equal(grid.length, count);
      assert.equal(new Set(grid).size, count, 'nobody twice');
    }
    const pace = (grid: typeof ROSTER) => grid.reduce((n, p) => n + overall(p), 0) / grid.length;
    assert.ok(pace(grids[0]) < pace(grids[1]) && pace(grids[1]) < pace(grids[2]), `${count} riders`);
    assert.equal(grids[2][0], ROSTER[0], 'Expert has the fastest rider');
    assert.equal(grids[0].at(-1), ROSTER.at(-1), 'Relaxed has the slowest');
  }
  // In the game: every computer rider on the grid is one of them, whatever the split of humans.
  for (const humans of [1, 2, 4]) {
    const session = race({seed: 5, humans, npcs: 8 - humans});
    for (const r of session.riders) {
      if (r.human) assert.equal(r.profile, undefined);
      else {
        assert.ok(gridFor('club', 8 - humans).includes(r.profile!), r.name);
        assert.equal(r.name, r.profile!.name);
        assert.equal(r.color, r.profile!.plate);
      }
      assert.doesNotMatch(riderLabel(r), /RIDER\s*\d/);
    }
  }
  // Riders made without a session (the pace checks) are named from the roster too, never "RIDER 3".
  for (let id = 0; id < 8; id++) assert.doesNotMatch(makeRider(coast, id, false, 0).name, /RIDER/);
});

test('the same seed and inputs give an identical finishing order and times, run twice', () => {
  // The human rides slowly enough to come last, so the race runs until every rider has finished.
  const a = finish(race({seed: 77, human: 0.5})),
    b = finish(race({seed: 77, human: 0.5})),
    c = finish(race({seed: 78, human: 0.5}));
  assert.equal(a.length, 8);
  assert.ok(
    a.every(([, time]) => time !== null),
    'everybody finishes',
  );
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c, 'another seed is another race');
});

test('mistakes come at the rate of the consistency rating, the same every time for a seed', () => {
  for (const p of ROSTER)
    for (const seed of [1, 2026, 4000000000]) {
      let made = 0;
      const kinds = new Set<string>();
      for (let lap = 0; lap < 500; lap++) {
        const slip = slipFor(seed, p, lap);
        assert.deepEqual(slipFor(seed, p, lap), slip);
        if (!slip) continue;
        made++;
        kinds.add(slip.kind);
        assert.ok(slip.where >= 0 && slip.where < 1);
      }
      const rated = mistakeRate(p) * 500;
      assert.ok(Math.abs(made - rated) <= 1, `${p.name}: ${made} in 500 laps against ${rated}`);
      assert.equal(kinds.size, 3, 'braking late, landing flat and running wide all happen');
    }
  // On the track: each scheduled mistake is made once, and none when the riders are told to be perfect.
  const p = ROSTER.find(x => x.name === 'T. FOX')!;
  const ride = (seed: number) => {
    const r: Rider = Object.assign(makeRider(coast, 0, false, p.plate), {profile: p});
    while (r.progress.lap < 12) stepRider(r, npcControl(r, coast, [r], 'club', seed), coast, STEP, [r]);
    return r;
  };
  const fallible = ride(9);
  let scheduled = 0;
  for (let lap = 0; lap < 12; lap++) if (slipFor(9, p, lap)) scheduled++;
  assert.ok(scheduled >= 2);
  assert.equal(fallible.slips, scheduled);
  assert.equal(ride(0).slips, undefined);
});

test('catch-up off is identical to no assist code; on never exceeds the speed cap or +3% pace', () => {
  // Off: the assist is never consulted, and a share of exactly 1 is the same control as not passing one.
  const off = race({seed: 12, npcs: 3});
  (off as unknown as {ease: () => number}).ease = () => assert.fail('the assist was consulted while switched off');
  const plain = race({seed: 12, npcs: 3});
  for (let t = 0; t < 30; t += STEP) {
    off.step(STEP);
    plain.step(STEP);
    for (const r of plain.riders.filter(x => !x.human))
      assert.deepEqual(
        npcControl(r, coast, plain.riders, 'club', 12, 1),
        npcControl(r, coast, plain.riders, 'club', 12),
      );
  }
  assert.deepEqual(
    off.riders.map(r => [r.x, r.z, r.speed]),
    plain.riders.map(r => [r.x, r.z, r.speed]),
  );
  // The share itself: 1 near the human, never under 0.95 or over 1.03 however far away.
  for (let gap = -6000; gap <= 6000; gap += 7) {
    const ease = catchUpEase(gap);
    assert.ok(ease >= ASSIST_EASE_MIN && ease <= ASSIST_GAIN_MAX, `${gap} m: ${ease}`);
    if (Math.abs(gap) <= 40) assert.equal(ease, 1);
    if (gap > 40) assert.ok(ease < 1);
    if (gap < -40) assert.ok(ease > 1);
  }
  assert.equal(catchUpEase(9999), ASSIST_EASE_MIN);
  assert.equal(catchUpEase(-9999), ASSIST_GAIN_MAX);
  // On the track: a rider given the full gain is never past the speed cap, and its lap is at most 3% quicker.
  const lap = (ease: number) => {
    const p = ROSTER[4];
    const r: Rider = Object.assign(makeRider(coast, 0, false, p.plate), {profile: p});
    let seconds = 0,
      top = 0;
    for (; r.progress.lap < 2; seconds += STEP) {
      stepRider(r, npcControl(r, coast, [r], 'club', 0, ease), coast, STEP, [r]);
      top = Math.max(top, r.speed);
    }
    return {seconds, top};
  };
  const base = lap(1),
    gain = lap(ASSIST_GAIN_MAX),
    eased = lap(ASSIST_EASE_MIN);
  assert.ok(gain.top <= TUNING.maxSpeed + TUNING.landingBonusMax + 1e-9, `top speed ${gain.top}`);
  assert.ok(
    gain.seconds < base.seconds && gain.seconds >= base.seconds * 0.97,
    `${gain.seconds} against ${base.seconds}`,
  );
  assert.ok(
    eased.seconds > base.seconds && eased.seconds <= base.seconds * 1.05,
    `${eased.seconds} against ${base.seconds}`,
  );
  // A share outside the limits is cut back to them.
  assert.deepEqual(lap(5), gain);
  assert.deepEqual(lap(0.1), eased);
  // In a race: with a human dawdling at the back, the computer riders ahead finish later with the assist on.
  const total = (catchUp: boolean) => {
    const session = race({seed: 3, npcs: 3, catchUp, human: 0.5, laps: 2});
    finish(session);
    return session.riders.filter(r => !r.human).reduce((n, r) => n + (r.finished ?? 1e6), 0);
  };
  const on = total(true),
    without = total(false);
  assert.ok(on > without + 1 && on < without * 1.05, `the riders ahead eased off: ${on} s against ${without} s`);
});

test('the best rhythm riders preload the face of rhythm jumps, and nobody else does', () => {
  const loads = (name: string) => {
    const p = ROSTER.find(x => x.name === name)!;
    const r: Rider = Object.assign(makeRider(coast, 0, false, p.plate), {profile: p});
    let pops = 0,
      loaded = false;
    while (r.progress.lap < 2) {
      const c = npcControl(r, coast, [r], 'club');
      const inRhythm = coast.rhythms.some(x => r.surface.s >= x.start && r.surface.s < x.end);
      if (r.grounded && c.pitch >= TUNING.preloadStick) assert.ok(inRhythm, 'only in a rhythm section');
      stepRider(r, c, coast, STEP, [r]);
      if (!r.grounded && !loaded && r.launch === 'absorb') pops++;
      loaded = !r.grounded;
    }
    return {pops, crashes: r.crashes};
  };
  const nova = loads('K. NOVA'),
    quill = loads('B. QUILL');
  assert.ok(nova.pops >= 2, `K. NOVA preloaded ${nova.pops} takeoffs in two laps`);
  assert.equal(nova.crashes, 0);
  assert.equal(quill.pops, 0);
});
