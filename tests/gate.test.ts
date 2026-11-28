import test from 'node:test';
import assert from 'node:assert/strict';
import {TUNING} from '../src/config.ts';
import {GATE, GATE_SECONDS_MAX, StartGate, gateDelay, inBand, npcReaction} from '../src/gate.ts';
import {mapGamepad, mapKeyboard, neutralControl, routeControls, type Control} from '../src/input.ts';
import {startSharpness} from '../src/riders.ts';
import {idleControl, npcControl, type Rider} from '../src/physics.ts';
import {TouchInput} from '../src/touch-input.ts';
import {Track} from '../src/track.ts';
import {RaceSession} from '../src/game/race-session.ts';

const track = new Track();
const STEP = TUNING.step;

type Mode = 'race' | 'practice' | 'trial';
/**
 * One keyboard rider and `npcs` computer riders. `throttle` says what the rider's right hand does before the
 * drop, given the seconds since the start button; after the drop the rider holds `after`.
 */
function harness(options: {
  seed?: number;
  npcs?: number;
  mode?: Mode;
  throttle?: (elapsed: number, gate: StartGate) => number;
  after?: (rider: Rider) => Control;
  laps?: number;
}) {
  const log: string[] = [];
  const session: RaceSession = new RaceSession(
    {
      sample: () => {
        const r = session.riders[0];
        if (session.phase === 'racing') return options.after ? options.after(r) : {...neutralControl(), throttle: 1};
        const gate = session.gate;
        return {...neutralControl(), throttle: gate && options.throttle ? options.throttle(gate.elapsed, gate) : 0};
      },
      connectedGamepads: () => [],
    },
    {
      countdown: n => log.at(-1) !== `board ${n}` && log.push(`board ${n}`),
      racing: () => log.push('racing'),
      cue: frequency => log.push(`cue ${frequency}`),
      landing: () => {},
      pause: () => {},
      results: () => log.push('results'),
      gateDropped: () => log.push('drop'),
      jumpedGate: rider => log.push(`jumped ${rider.id}`),
      holeshot: rider => log.push(`holeshot ${rider.id}`),
    },
  );
  const mode = options.mode ?? 'race';
  session.grid({
    track,
    humanCount: 1,
    npcCount: options.npcs ?? 0,
    practice: mode === 'practice',
    trial: mode === 'trial',
    assignments: [{kind: 'keyboard'}],
  });
  session.start({lapCount: options.laps ?? 1, difficulty: 'club', seed: options.seed ?? 11});
  let waited = 0;
  const toDrop = () => {
    while (session.phase === 'countdown') {
      session.step(STEP);
      waited += STEP;
      assert.ok(waited < 10, 'the gate drops');
    }
    return waited;
  };
  const run = (steps: number) => {
    for (let i = 0; i < steps; i++) session.step(STEP);
  };
  return {session, log, toDrop, run};
}
/** Holds the revs in the middle of the band, as a trigger held part of the way does. */
const inTheBand = () => 0.68;
/** Seconds after the drop at which the rider is `metres` from the grid. */
function timeTo(metres: number, h: ReturnType<typeof harness>) {
  const r = h.session.riders[0];
  const from = {x: r.x, z: r.z};
  h.toDrop();
  for (let step = 1; step < 5 / STEP; step++) {
    h.session.step(STEP);
    if (Math.hypot(r.x - from.x, r.z - from.z) >= metres) return step * STEP;
  }
  throw new Error(`never reached ${metres} m`);
}

test('the same seed gives the same gate delay, and every delay is 1.0 to 3.0 s across 1,000 seeds', () => {
  let low = Infinity,
    high = -Infinity;
  const seen = new Set<number>();
  for (let seed = 1; seed <= 1000; seed++) {
    const delay = gateDelay(seed);
    assert.equal(gateDelay(seed), delay, `seed ${seed} repeats`);
    assert.ok(delay >= 1 && delay <= 3, `seed ${seed}: ${delay}`);
    low = Math.min(low, delay);
    high = Math.max(high, delay);
    seen.add(Math.round(delay * 100));
  }
  assert.ok(low < 1.05 && high > 2.95, `the whole range is used: ${low.toFixed(3)} to ${high.toFixed(3)}`);
  assert.ok(seen.size > 150, 'delays are spread, not a handful of values');
  for (const seed of [0, 2 ** 32 - 1, 123456789]) assert.ok(gateDelay(seed) >= 1 && gateDelay(seed) <= 3);
  // The race uses that delay: two starts on one seed drop on the same step, another seed on a different one.
  const a = harness({seed: 77}).toDrop(),
    b = harness({seed: 77}).toDrop(),
    c = harness({seed: 78}).toDrop();
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.ok(Math.abs(a - (GATE.board + gateDelay(77))) <= STEP, `${a} s against ${GATE.board + gateDelay(77)}`);
});

test('from pressing Drop the gate to the drop takes 9 s or less', () => {
  assert.ok(GATE_SECONDS_MAX <= 9, `${GATE_SECONDS_MAX} s at most by the rules`);
  let longest = 0;
  for (let seed = 1; seed <= 1000; seed++) longest = Math.max(longest, new StartGate(seed, [], 'club').dropAt);
  assert.ok(longest <= 9, `${longest.toFixed(3)} s`);
  // And as the race runs it, counting every step from the start button to the drop.
  for (const seed of [3, 500, 999]) {
    const h = harness({seed});
    const waited = h.toDrop();
    assert.ok(waited <= 9, `seed ${seed}: ${waited.toFixed(3)} s`);
    assert.ok(waited >= GATE.board + 1 - STEP);
    assert.deepEqual(
      h.log.filter(l => l.startsWith('board') || l === 'drop' || l === 'racing'),
      ['board 5', 'board 4', 'board 3', 'board 2', 'board 1', 'board 0', 'drop', 'racing'],
    );
    assert.equal(h.session.raceTime, 0, 'the race clock starts at the drop');
    assert.equal(h.session.riders[0].speed, 0, 'nobody moves before it');
  }
});

test('moving before the drop costs exactly 0.5 s', () => {
  const clean = harness({throttle: inTheBand});
  // The same rider, except that with the gate live the throttle is pinned and the bike creeps into the gate.
  const early = harness({throttle: (elapsed, gate) => (gate.live ? 1 : 0.68)});
  clean.toDrop();
  early.toDrop();
  assert.deepEqual(
    early.log.filter(l => l.startsWith('jumped')),
    ['jumped 0'],
    'told once',
  );
  assert.equal(clean.session.gate!.launches[0].result, 'good');
  assert.equal(early.session.gate!.launches[0].result, 'jumped');
  const lost = Math.round(GATE.penalty / STEP);
  assert.equal(lost * STEP, 0.5);
  early.run(lost);
  assert.equal(early.session.riders[0].speed, 0, 'held against the gate for the whole half second');
  const path = (r: Rider) => [r.x, r.y, r.z, r.speed, r.heading];
  for (let step = 0; step < 2.5 / STEP; step++) {
    clean.session.step(STEP);
    early.session.step(STEP);
    // After the hold the early rider does exactly what the clean one did half a second before: no other cost.
    assert.deepEqual(path(early.session.riders[0]), path(clean.session.riders[0]), `step ${step}`);
  }
  assert.ok(clean.session.riders[0].speed > 20);
  // Pinning the throttle while the board is still up is free: only the live gate punishes it.
  const eager = harness({throttle: (elapsed, gate) => (gate.live ? 0.68 : 1)});
  eager.toDrop();
  assert.equal(eager.session.gate!.launches[0].jumped, false);
});

test('a launch in the green band reaches 20 m at least 0.15 s sooner than one outside it', () => {
  const good = timeTo(20, harness({throttle: inTheBand}));
  const cases: [string, number][] = [
    ['no revs', 0],
    ['just under the band', GATE.bandLow - 0.02],
    ['just over the band', GATE.bandHigh + 0.02],
    ['nearly creeping', GATE.creep - 0.02],
  ];
  for (const [name, revs] of cases) {
    const h = harness({throttle: () => revs});
    const poor = timeTo(20, h);
    assert.equal(h.session.gate!.launches[0].result, 'poor', name);
    assert.ok(poor - good >= 0.15, `${name}: ${poor.toFixed(3)} s against ${good.toFixed(3)} s`);
  }
  for (const revs of [GATE.bandLow, 0.6, 0.7, GATE.bandHigh]) {
    assert.ok(inBand(revs));
    assert.equal(timeTo(20, harness({throttle: () => revs})), good, `anywhere in the band is the same: ${revs}`);
  }
  // The band is the bike's normal drive: a good launch is what Free Practice has always had off the line.
  const practice = harness({mode: 'practice'});
  assert.equal(timeTo(20, practice), good);
});

test('exactly one rider is awarded the holeshot in every race, and none in Free Practice or Time Trial', () => {
  const drive = (r: Rider) => npcControl(r, track, [r], 'expert');
  for (const seed of [5, 6, 7]) {
    const h = harness({seed, npcs: 7, throttle: inTheBand, after: drive});
    h.toDrop();
    h.run(Math.round(4 / STEP));
    assert.equal(h.session.holeshot, null, 'not before anyone reaches the line');
    while (h.session.phase === 'racing') h.session.step(STEP);
    const awards = h.log.filter(l => l.startsWith('holeshot'));
    assert.equal(awards.length, 1, `seed ${seed}: ${awards.join(', ')}`);
    assert.equal(awards[0], `holeshot ${h.session.holeshot}`);
    assert.ok(h.session.riders.some(r => r.id === h.session.holeshot));
    assert.ok(h.log.includes('results'));
  }
  // A rider alone still takes it, once.
  const alone = harness({throttle: inTheBand, after: drive, laps: 2});
  alone.toDrop();
  while (alone.session.phase === 'racing') alone.session.step(STEP);
  assert.deepEqual(
    alone.log.filter(l => l.startsWith('holeshot')),
    ['holeshot 0'],
  );
  for (const mode of ['practice', 'trial'] as Mode[]) {
    const h = harness({mode, after: drive});
    h.toDrop();
    assert.equal(h.session.gate, null, `${mode} has no gate`);
    assert.ok(!h.log.includes('drop'));
    while (h.session.riders[0].progress.lap < 1) h.session.step(STEP);
    assert.equal(h.session.holeshot, null);
    assert.equal(h.log.filter(l => l.startsWith('holeshot')).length, 0, mode);
  }
});

test('computer riders react to the drop after a seeded moment and always launch in the band', () => {
  const reactions: number[] = [];
  for (let seed = 1; seed <= 200; seed++)
    for (let rider = 1; rider < 8; rider++) {
      const reaction = npcReaction(seed, rider, 'club');
      assert.equal(npcReaction(seed, rider, 'club'), reaction);
      assert.ok(reaction >= GATE.minReaction && reaction <= GATE.maxReaction, `${reaction}`);
      reactions.push(reaction);
    }
  assert.ok(new Set(reactions.map(r => Math.round(r * 1000))).size > 100, 'riders differ');
  assert.ok(npcReaction(9, 3, 'expert') < npcReaction(9, 3, 'club'), 'expert riders are sharper');
  const h = harness({seed: 31, npcs: 7, throttle: inTheBand});
  h.toDrop();
  const gate = h.session.gate!;
  const helds = gate.launches.map(launch => launch.held);
  h.session.riders.forEach((r, i) => {
    assert.equal(gate.launches[i].result, 'good', `rider ${i}`);
    // A roster rider's starts rating sets how sharp it is.
    const own = Math.round(npcReaction(31, r.id, 'club', r.profile && startSharpness(r.profile)) / STEP);
    if (r.human) return;
    // The front row goes on its own reaction; the second row never before the bike ahead of it.
    if (i < 4) assert.equal(helds[i], own);
    else assert.equal(helds[i], Math.max(own, helds[i - 4] + Math.round(0.03 / STEP)), `rider ${i}`);
  });
  assert.equal(gate.launches[0].held, 0, 'a human is never held back by a reaction time');
  h.run(Math.round(GATE.maxReaction / STEP) + 8);
  assert.ok(
    h.session.riders.every(r => r.speed > 0),
    'everybody is away',
  );
  const again = harness({seed: 31, npcs: 7, throttle: inTheBand});
  again.toDrop();
  again.run(Math.round(GATE.maxReaction / STEP) + 8);
  assert.deepEqual(
    again.session.riders.map(r => [r.x, r.z]),
    h.session.riders.map(r => [r.x, r.z]),
    'the same seed gives the same start',
  );
});

/**
 * Feeds a device's control to the gate. `held(elapsed, dropAt)` says whether the throttle is being pressed.
 * Returns how the launch went and how far the bike is one second after the drop.
 */
function launchWith(control: (pressed: boolean) => Control, held: (elapsed: number, dropAt: number) => boolean) {
  const h = harness({});
  const gate = h.session.gate!;
  h.session.override.clear();
  const sampled: Control[] = [];
  // The harness's own input is replaced by the device under test.
  (h.session as unknown as {input: {sample: () => Control}}).input.sample = () => {
    const c = h.session.phase === 'racing' ? control(true) : control(held(gate.elapsed, gate.dropAt));
    sampled.push(c);
    return c;
  };
  const r = h.session.riders[0];
  const from = {x: r.x, z: r.z};
  h.toDrop();
  h.run(Math.round(1 / STEP));
  return {result: gate.launches[0].result, metres: Math.hypot(r.x - from.x, r.z - from.z), sampled};
}
/** A key or a button is on or off: pressing it a little over a second before the drop lands in the band. */
const lateSqueeze = (elapsed: number, dropAt: number) => elapsed >= dropAt - 1.13;
const padWith = (index: number, id: string, trigger: number) => ({
  index,
  id,
  connected: true,
  axes: [0, 0, 0, 0],
  buttons: Array.from({length: 17}, (_, i) => ({value: i === 7 ? trigger : 0})),
});

test('keyboard: W sets the revs and launches the bike', () => {
  const good = launchWith(pressed => mapKeyboard(new Set(pressed ? ['KeyW'] : [])), lateSqueeze);
  assert.equal(good.result, 'good');
  assert.ok(good.metres > 10, `${good.metres.toFixed(1)} m in the first second`);
  const pinned = launchWith(
    pressed => mapKeyboard(new Set(pressed ? ['KeyW'] : [])),
    () => true,
  );
  assert.equal(pinned.result, 'jumped', 'the key held down all the way through creeps into the gate');
  const idle = launchWith(
    pressed => mapKeyboard(new Set(pressed ? ['KeyW'] : [])),
    () => false,
  );
  assert.equal(idle.result, 'poor');
  assert.ok(idle.metres < good.metres - 2);
});

test('browser gamepad: the right trigger sets the revs and launches the bike', () => {
  const id = 'Xbox Wireless Controller (STANDARD GAMEPAD)';
  const good = launchWith(
    pressed => mapGamepad(padWith(0, id, pressed ? 1 : 0.7)),
    () => false,
  );
  assert.equal(good.result, 'good', 'the trigger held at 70% sits in the band');
  assert.ok(good.metres > 10);
  assert.equal(
    launchWith(
      () => mapGamepad(padWith(0, id, 1)),
      () => true,
    ).result,
    'jumped',
  );
  assert.equal(
    launchWith(
      pressed => mapGamepad(padWith(0, id, pressed ? 1 : 0.2)),
      () => false,
    ).result,
    'poor',
  );
});

test('Mac Xbox bridge: the native controller feed sets the revs and launches the bike', () => {
  const devices = [{kind: 'gamepad' as const, index: 1000}, {kind: 'keyboard' as const}];
  const feed = (trigger: number) => routeControls(devices, new Set(), [padWith(1000, 'Xbox / macOS', trigger)]);
  const good = launchWith(
    pressed => feed(pressed ? 1 : 0.7)[0],
    () => false,
  );
  assert.equal(good.result, 'good');
  assert.ok(good.metres > 10);
  assert.equal(feed(0.7)[1].throttle, 0, 'the keyboard rider beside it is not revved');
});

test('touch: the throttle button sets the revs and launches the bike', () => {
  const touch = new TouchInput();
  touch.setEnabled(true);
  const read = (pressed: boolean) => {
    if (pressed) touch.start(2, 'throttle');
    else touch.end(2);
    return routeControls([{kind: 'touch'}], new Set(), [], touch.read())[0];
  };
  const good = launchWith(read, lateSqueeze);
  assert.equal(good.result, 'good');
  assert.ok(good.metres > 10);
  assert.equal(launchWith(read, () => true).result, 'jumped');
});

test('a paused gate waits, and the autopilot holds the band', () => {
  const h = harness({seed: 4, throttle: inTheBand});
  for (let i = 0; i < 200; i++) h.session.step(STEP);
  const elapsed = h.session.gate!.elapsed;
  h.session.togglePause();
  for (let i = 0; i < 500; i++) h.session.step(STEP);
  assert.equal(h.session.gate!.elapsed, elapsed, 'the board does not run while paused');
  h.session.togglePause();
  h.toDrop();
  assert.equal(h.session.gate!.launches[0].result, 'good');
  const auto = harness({seed: 4, throttle: () => 1});
  auto.session.reviewDrive = true;
  auto.toDrop();
  assert.equal(auto.session.gate!.launches[0].result, 'good', 'the review autopilot is not caught by the gate');
  void idleControl;
});

test('a key or a touch button can hold the band by watching the needle, without knowing when the gate drops', () => {
  // The rider presses while the needle they saw a fifth of a second ago was under the middle of the band.
  const reaction = Math.round(0.2 / STEP);
  for (let seed = 1; seed <= 100; seed++) {
    const seen: number[] = [];
    const h = harness({
      seed,
      throttle: (elapsed, gate) => {
        seen.push(gate.launches[0].revs);
        return seen[Math.max(0, seen.length - 1 - reaction)] < (GATE.bandLow + GATE.bandHigh) / 2 ? 1 : 0;
      },
    });
    h.toDrop();
    assert.equal(h.session.gate!.launches[0].result, 'good', `seed ${seed}`);
  }
});

test('a jumped gate costs more than a poor launch, and a poor launch more than a good one, all the way down the straight', () => {
  for (const metres of [20, 40, 60, 80]) {
    const good = timeTo(metres, harness({throttle: inTheBand}));
    const poor = timeTo(metres, harness({throttle: () => 0}));
    const jumped = timeTo(metres, harness({throttle: (elapsed, gate) => (gate.live ? 1 : 0.68)}));
    assert.ok(poor - good >= 0.15, `${metres} m: poor ${poor.toFixed(3)} s, good ${good.toFixed(3)} s`);
    assert.ok(jumped - poor >= 0.1, `${metres} m: jumped ${jumped.toFixed(3)} s, poor ${poor.toFixed(3)} s`);
  }
});
