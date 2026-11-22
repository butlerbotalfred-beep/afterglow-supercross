import test from 'node:test';
import assert from 'node:assert/strict';
import {TUNING} from '../src/config.ts';
import {npcControl} from '../src/physics.ts';
import {CHECKPOINT_COUNT, createProgress, restoreDeparture, trackDeferred, updateProgress} from '../src/race.ts';
import {lapCountsForRecord, recordKey, SAVE_KEY, SaveStore} from '../src/save.ts';
import {createTiming, formatDelta, formatLap, recordStep, SECTOR_COUNT, type LapTime} from '../src/timing.ts';
import {courseById} from '../src/courses.ts';
import {Track} from '../src/track.ts';
import {layoutFromTrack} from '../src/track-layout.ts';
import {RaceSession} from '../src/game/race-session.ts';

const STEP = TUNING.step;
const LENGTH = 1600;
const SPACING = LENGTH / CHECKPOINT_COUNT;

/** Rides the centre line at a constant speed from `startS`, timing every step. Returns the laps completed. */
function ride(speed: number, startS: number, seconds: number, reference: LapTime | null = null) {
  const progress = createProgress(startS);
  const timing = createTiming();
  const laps: LapTime[] = [];
  let time = 0;
  for (let i = 1; i <= Math.round(seconds / STEP); i++) {
    updateProgress(progress, (((startS + speed * i * STEP) % LENGTH) + LENGTH) % LENGTH, 0, LENGTH, 5, STEP);
    const lap = recordStep(timing, progress, time, STEP, reference);
    if (lap) laps.push(lap);
    time += STEP;
  }
  return {laps, timing, progress};
}

test('a mid-step gate crossing at 30 m/s is timed within 0.001 s', () => {
  // Start 7.3 m before the line so no physics step lands exactly on a timing plane.
  const {laps, timing} = ride(30, -7.3, 60);
  const exactFirstLap = (LENGTH + 7.3) / 30;
  assert.ok(Math.abs(laps[0].time - exactFirstLap) < 0.001, `lap 1 ${laps[0].time} vs ${exactFirstLap}`);
  assert.ok(Math.abs(laps[0].time - exactFirstLap) < 1e-9, 'in fact exact at a steady speed');
  // Each later sector is a quarter of the lap: 400 m at 30 m/s.
  assert.ok(Math.abs(laps[0].sectors[1] - 400 / 30) < 0.001);
  assert.equal(timing.laps.length, 1);
  // Without interpolation the error would be up to a whole step (0.0083 s), so the test can tell the difference.
  assert.ok(STEP > 0.001);
});

test('four sector times add up to the lap time within 0.001 s', () => {
  for (const speed of [11.7, 30, 48.9]) {
    const {laps} = ride(speed, -3.1, (LENGTH * 3.2) / speed);
    assert.equal(laps.length, 3, `three laps at ${speed} m/s`);
    for (const lap of laps) {
      assert.equal(lap.sectors.length, SECTOR_COUNT);
      const sum = lap.sectors.reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(sum - lap.time) < 0.001, `sectors ${sum} vs lap ${lap.time}`);
      assert.ok(Math.abs(sum - lap.time) < 1e-9);
    }
  }
});

test('laps are timed correctly across the start/finish seam', () => {
  const {laps, progress} = ride(30, -7.3, 170);
  assert.equal(progress.lap, 3);
  // Lap 1 runs from the start of the race; laps 2 and 3 run line to line, with no time lost or gained at the seam.
  for (const lap of laps.slice(1)) assert.ok(Math.abs(lap.time - LENGTH / 30) < 1e-9, String(lap.time));
  const total = laps.reduce((sum, lap) => sum + lap.time, 0);
  assert.ok(Math.abs(total - (LENGTH * 3 + 7.3) / 30) < 1e-9, 'lap times add up to the time the third lap ended');
  // A step that ends exactly on the line still counts once.
  const exact = ride(SPACING * 120 * 0.01, 0, 400);
  assert.ok(exact.laps.length >= 1);
  for (const lap of exact.laps.slice(1)) assert.ok(Math.abs(lap.time - LENGTH / (SPACING * 1.2)) < 1e-6);
});

test('sector times are compared with the reference lap, and a faster lap becomes the session best', () => {
  const reference: LapTime = {time: 60, sectors: [15, 15, 15, 15], valid: true};
  const {timing, laps} = ride(30, 0, 110, reference);
  assert.ok(timing.split);
  assert.ok(Math.abs(timing.split.delta! - (400 / 30 - 15)) < 1e-9, 'faster than the reference shows as negative');
  assert.equal(timing.best, laps[0].time <= laps[1].time ? laps[0] : laps[1]);
  assert.equal(ride(30, 0, 20).timing.split!.delta, null, 'no reference, no comparison');
});

test('a lap that included a shortcut return is marked and cannot become the best', () => {
  const progress = createProgress(0);
  const timing = createTiming();
  let time = 0;
  const laps: LapTime[] = [];
  const step = (s: number, lateral = 0) => {
    updateProgress(progress, s, lateral, LENGTH, 5, STEP);
    const lap = recordStep(timing, progress, time, STEP, null);
    if (lap) laps.push(lap);
    time += STEP;
  };
  let s = 0;
  for (; s < 300; s += 0.25) step(s);
  // Leave the track and cut ahead by more than is forgiven; the game sends the rider back to where they left.
  for (let cut = 0; cut < 40; cut += 0.25) step(s + cut, 9);
  assert.equal(progress.routeBroken, true);
  assert.equal(progress.shortcuts, 1);
  s = restoreDeparture(progress)!.s;
  for (; s < LENGTH * 2 + 5; s += 0.25) step(s % LENGTH);
  assert.equal(laps.length, 2);
  assert.equal(laps[0].valid, false, 'the lap with the shortcut');
  assert.equal(laps[1].valid, true, 'the next lap is clean again');
  assert.equal(timing.best, laps[1]);
});

test('a whole race: every rider gets lap and sector times that add up', () => {
  const track = new Track(courseById('coast'));
  const lapsSeen: string[] = [];
  const session: RaceSession = new RaceSession(
    {
      sample: device =>
        npcControl(
          session.riders.find(r => r.device === device)!,
          track,
          session.riders,
          'expert',
        ),
      connectedGamepads: () => [],
    },
    {
      countdown() {},
      racing() {},
      cue() {},
      landing() {},
      pause() {},
      results() {},
      lap: (rider, lap) => lapsSeen.push(`${rider.id}:${lap.time.toFixed(3)}`),
    },
  );
  session.grid({track, humanCount: 1, npcCount: 2, practice: false, assignments: [{kind: 'keyboard'}]});
  session.start({lapCount: 2, difficulty: 'expert'});
  for (let i = 0; i < 400 / STEP && session.phase !== 'results'; i++) session.step(STEP);
  assert.equal(session.phase, 'results');
  const human = session.timing[0];
  assert.equal(human.laps.length, 2);
  for (const lap of human.laps)
    assert.ok(Math.abs(lap.sectors.reduce((a, b) => a + b, 0) - lap.time) < 0.001, 'sectors add up to the lap');
  const total = human.laps[0].time + human.laps[1].time;
  // The finishing time is stamped at the end of the physics step, so it can be up to one step later.
  assert.ok(session.riders[0].finished! - total >= -1e-9 && session.riders[0].finished! - total <= STEP + 1e-9);
  assert.ok(lapsSeen.filter(l => l.startsWith('0:')).length === 2, 'the screen is told about each lap');
  assert.ok(
    session.timing.every(t => t.laps.length >= 1),
    'NPC riders are timed too',
  );
});

/** A stand-in for the browser's localStorage. */
function memory(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}
const lap = (time: number) => ({time, sectors: [time / 4, time / 4, time / 4, time / 4]});

test('a record is only replaced by a faster lap and survives a reload', () => {
  const storage = memory();
  const save = new SaveStore(storage);
  assert.equal(save.bestLap('coast'), null);
  assert.equal(save.submitLap('coast', lap(54.2), '2026-11-22T00:00:00.000Z'), true);
  assert.equal(save.submitLap('coast', lap(55.0)), false, 'a slower lap does not replace it');
  assert.equal(save.submitLap('coast', lap(54.2)), false, 'an equal lap does not replace it');
  assert.equal(save.bestLap('coast')!.time, 54.2);
  assert.equal(save.submitLap('coast', lap(53.9)), true);
  assert.equal(save.submitLap('coast', lap(NaN)), false);
  const reloaded = new SaveStore(storage);
  assert.equal(reloaded.bestLap('coast')!.time, 53.9);
  assert.deepEqual(reloaded.bestLap('coast')!.sectors, lap(53.9).sectors);
  assert.equal(reloaded.bestLap('dusk'), null, 'each circuit has its own record');
  // Another tab's faster lap is not overwritten by a slower one from this tab.
  const tabA = new SaveStore(storage),
    tabB = new SaveStore(storage);
  assert.equal(tabB.submitLap('coast', lap(50)), true);
  assert.equal(tabA.submitLap('coast', lap(52)), false);
  assert.equal(new SaveStore(storage).bestLap('coast')!.time, 50);
  // With storage blocked a best lap still counts for the visit.
  const blocked = new SaveStore(null);
  assert.equal(blocked.submitLap('coast', lap(60)), true);
  assert.equal(blocked.submitLap('coast', lap(61)), false);
  assert.equal(blocked.bestLap('coast')!.time, 60);
});

test('editing a custom layout starts a fresh record for it', () => {
  const original = layoutFromTrack(new Track());
  const edited = {...original, jumps: original.jumps.map((j, i) => (i === 0 ? {...j, height: j.height + 0.5} : j))};
  const renamed = {...original, name: 'Another name'};
  assert.notEqual(recordKey('dusk', original), 'dusk', 'a custom layout does not share the original circuit record');
  assert.notEqual(recordKey('dusk', edited), recordKey('dusk', original), 'changing a jump changes the key');
  assert.equal(recordKey('dusk', renamed), recordKey('dusk', original), 'renaming alone does not');
  const save = new SaveStore(memory());
  save.submitLap(recordKey('dusk', original), lap(95));
  assert.equal(save.bestLap(recordKey('dusk', original))!.time, 95);
  assert.equal(save.bestLap(recordKey('dusk', edited)), null, 'the edited layout has no record yet');
  assert.equal(save.bestLap('dusk'), null);
  // Going back to the earlier shape finds its record again.
  assert.equal(save.bestLap(recordKey('dusk', {...edited, jumps: original.jumps}))!.time, 95);
});

test('changing PHYSICS_VERSION archives old records', () => {
  const storage = memory();
  const before = new SaveStore(storage, 1);
  before.submitLap('coast', lap(54));
  before.submitLap('dusk', lap(96));
  const after = new SaveStore(storage, 2);
  assert.equal(after.bestLap('coast'), null, 'a lap from the old physics is not the time to beat');
  assert.deepEqual(Object.keys((after.data.records.archived as any)['physics-1']).sort(), ['coast', 'dusk']);
  assert.equal(after.submitLap('coast', lap(58)), true, 'a slower lap on the new physics is a new record');
  const stored = JSON.parse(storage.values.get(SAVE_KEY)!);
  assert.equal(stored.records.bestLaps.coast.time, 58);
  assert.equal(stored.records.bestLaps.coast.physics, 2);
  assert.equal(stored.records.bestLaps.dusk, undefined);
  assert.equal(stored.records.archived['physics-1'].coast.time, 54, 'the old lap is kept in the archive');
  assert.equal(stored.records.archived['physics-1'].dusk.time, 96);
  // A build still on the old physics does not take the new lap as its own.
  assert.equal(new SaveStore(storage, 1).bestLap('coast'), null);
});

test('lap times and differences are written to a thousandth of a second', () => {
  assert.equal(formatLap(32.4149), '0:32.415');
  assert.equal(formatLap(92.0004), '1:32.000');
  assert.equal(formatLap(59.9996), '1:00.000');
  assert.equal(formatDelta(-0.0871), '−0.087');
  assert.equal(formatDelta(0.214), '+0.214');
});

test('a line crossed while briefly off the track is timed when it was crossed, not on the way back in', () => {
  // Steady 30 m/s, so every lap after the first takes exactly 1600 / 30 s. On lap 2 the rider runs wide 10 m
  // before the line and rejoins 15 m after it: allowed, but the line was passed long before the rejoin.
  const speed = 30;
  const progress = createProgress(-7.3);
  const timing = createTiming();
  const laps: LapTime[] = [];
  let time = 0;
  for (let i = 1; laps.length < 3; i++) {
    const distance = -7.3 + speed * i * STEP;
    const wide = distance > LENGTH * 2 - 10 && distance < LENGTH * 2 + 15;
    updateProgress(progress, ((distance % LENGTH) + LENGTH) % LENGTH, wide ? 9 : 0, LENGTH, 5, STEP);
    const lap = recordStep(timing, progress, time, STEP, null);
    if (lap) laps.push(lap);
    time += STEP;
  }
  assert.equal(progress.shortcuts, 0, 'the excursion was short enough to be forgiven');
  for (const lap of laps.slice(1)) {
    assert.ok(Math.abs(lap.time - LENGTH / speed) < 0.001, `lap ${lap.time} vs ${LENGTH / speed}`);
    assert.equal(lap.valid, true);
  }
});

test('a line crossed during a crash slide is timed when it was crossed, not when the slide ends', () => {
  // The bike crosses the line 3 m into a 1.5 s slide. Physics follows the slide step by step and gives the
  // credit only when it ends, so the lap must still end at the moment of crossing.
  const progress = createProgress(-7.3);
  const timing = createTiming();
  const laps: LapTime[] = [];
  let time = 0;
  let s = -7.3;
  const timed = () => {
    const lap = recordStep(timing, progress, time, STEP, null);
    if (lap) laps.push(lap);
    time += STEP;
  };
  while (s + 30 * STEP < LENGTH - 3) {
    s += 30 * STEP;
    updateProgress(progress, s, 0, LENGTH, 5, STEP);
    timed();
  }
  const slideStart = time;
  const startS = s;
  let speed = 30;
  let crossedAt = -1;
  const steps = Math.round(1.5 / STEP);
  for (let i = 1; i <= steps; i++) {
    const before = s;
    speed = Math.max(0, speed - 18 * STEP);
    s += speed * STEP;
    if (crossedAt < 0 && s >= LENGTH) crossedAt = time + ((LENGTH - before) / (s - before)) * STEP;
    if (i < steps) trackDeferred(progress, s % LENGTH, LENGTH, STEP);
    else updateProgress(progress, s % LENGTH, 0, LENGTH, 5, STEP);
    timed();
  }
  assert.ok(s - startS > 10 && crossedAt > slideStart);
  assert.equal(laps.length, 1);
  assert.ok(Math.abs(laps[0].time - crossedAt) < 0.001, `lap ${laps[0].time} vs crossing at ${crossedAt}`);
  assert.ok(time - crossedAt > 1, 'the credit arrived more than a second after the crossing');
});

test('only a person riding a clean lap unaided can set the saved best', () => {
  const clean = {valid: true};
  assert.equal(lapCountsForRecord(clean, {human: true}, false), true);
  assert.equal(lapCountsForRecord({valid: false}, {human: true}, false), false, 'a shortcut lap');
  assert.equal(lapCountsForRecord(clean, {human: false}, false), false, 'a computer rider');
  assert.equal(lapCountsForRecord(clean, {human: true}, true), false, 'autopilot or test overrides');
});

test('a custom layout keeps its record when only its name, highlights or file wording change', () => {
  const layout = {...layoutFromTrack(new Track(courseById('coast'))), name: 'Coast Custom'};
  const key = recordKey('coast', layout);
  const jumps = layout.jumps.map(j => ({...j}));
  assert.equal(recordKey('coast', {...layout, name: 'Renamed'}), key);
  assert.equal(recordKey('coast', {...layout, jumps: jumps.map(j => ({...j, highlight: true}))}), key);
  assert.equal(recordKey('coast', {...layout, jumps: jumps.map(j => ({...j, highlight: false}))}), key);
  // The same jump written with its properties in another order, as an imported file might have them.
  const reordered = jumps.map(j => Object.fromEntries(Object.entries(j).reverse()) as typeof j);
  assert.equal(recordKey('coast', {...layout, jumps: reordered}), key);
  const {bermHeights: _berms, ...plain} = layout;
  const allAutomatic = {...plain, bermHeights: layout.points.map(() => null)};
  assert.equal(recordKey('coast', allAutomatic), recordKey('coast', plain), 'automatic berms written out or not');
  const taller = jumps.map((j, i) => (i === 0 ? {...j, height: j.height + 0.5} : j));
  assert.notEqual(recordKey('coast', {...layout, jumps: taller}), key, 'a real change still starts a fresh record');
});

test('an old tab cannot put away a record from a newer physics version', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => void values.set(k, v),
  };
  const newer = new SaveStore(storage, 2);
  assert.equal(newer.submitLap('coast', {time: 50, sectors: [12, 13, 12, 13]}), true);
  const stale = new SaveStore(storage, 1);
  assert.equal(stale.bestLap('coast'), null, 'the old build does not compare against the newer lap');
  stale.submitLap('coast', {time: 40, sectors: [10, 10, 10, 10]});
  assert.equal(new SaveStore(storage, 2).bestLap('coast')?.time, 50, 'the newer build still finds its record');
});

test('a best lap the browser refuses to store still counts for this visit, and only once', () => {
  const values = new Map<string, string>();
  let full = false;
  const storage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (full) throw new Error('QuotaExceededError');
      values.set(k, v);
    },
  };
  const save = new SaveStore(storage);
  assert.equal(save.submitLap('coast', {time: 60, sectors: [15, 15, 15, 15]}), true);
  full = true;
  assert.equal(save.submitLap('coast', {time: 50, sectors: [12, 13, 12, 13]}), true);
  assert.equal(save.bestLap('coast')?.time, 50);
  assert.equal(save.submitLap('coast', {time: 55, sectors: [14, 14, 14, 13]}), false, '55 does not beat 50');
});

test('saving everything from a stale tab keeps a faster lap another tab stored', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => void values.set(k, v),
  };
  const first = new SaveStore(storage);
  first.submitLap('coast', {time: 60, sectors: [15, 15, 15, 15]});
  const second = new SaveStore(storage);
  second.submitLap('coast', {time: 50, sectors: [12, 13, 12, 13]});
  first.write();
  assert.equal(new SaveStore(storage).bestLap('coast')?.time, 50);
});
