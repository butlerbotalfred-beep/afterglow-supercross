import test from 'node:test';
import assert from 'node:assert/strict';
import {TUNING} from '../src/config.ts';
import {npcControl} from '../src/physics.ts';
import {CHECKPOINT_COUNT, createProgress, restoreDeparture, updateProgress} from '../src/race.ts';
import {recordKey, SAVE_KEY, SaveStore} from '../src/save.ts';
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
