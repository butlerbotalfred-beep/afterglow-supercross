import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {TUNING} from '../src/config.ts';
import {COURSES} from '../src/courses.ts';
import {npcControl, stepRider, makeRider} from '../src/physics.ts';
import {Track} from '../src/track.ts';
import {RaceSession} from '../src/game/race-session.ts';
import {WEAR_CELL, WEAR_FULL, WearGrid, wearFor} from '../src/wear.ts';

const STEP = TUNING.step;
const quiet = {countdown() {}, racing() {}, cue() {}, landing() {}, pause() {}, results() {}};
const dusk = new Track(COURSES.find(c => c.id === 'dusk')!);

/** Eight computer riders on a track, raced for a number of laps or until `seconds` of racing have passed. */
function race(track: Track, laps: number, seed: number, seconds = Infinity) {
  const session: RaceSession = new RaceSession(
    {sample: () => npcControl(session.riders[0], track, [], 'club'), connectedGamepads: () => []},
    quiet,
  );
  session.grid({track, npcCount: 8, humanCount: 0, practice: false, assignments: [], difficulty: 'club', seed});
  session.start({lapCount: laps, difficulty: 'club', seed});
  while (session.phase !== 'results' && session.raceTime < seconds) session.step(STEP);
  return session;
}
const sum = (cells: Uint8Array) => cells.reduce((a, b) => a + b, 0);
const rider = (change: object = {}) => ({
  id: 0,
  x: 0.2,
  z: 0.2,
  speed: 20,
  grounded: true,
  powerSlide: 0,
  slipAngle: 0,
  crashTime: 0,
  ...change,
});
const flat = {bounds: {minX: 0, maxX: 20, minZ: 0, maxZ: 10}, halfWidth: 4.8};

test('the same race gives the same wear grid', () => {
  const first = race(dusk, 1, 11);
  const copy = first.wear!.cells.slice();
  assert.ok(sum(copy) > 0);
  // The same race again, on a track built afresh so nothing is shared.
  const again = race(new Track(dusk.course), 1, 11);
  assert.notEqual(again.wear, first.wear);
  assert.deepEqual(again.wear!.cells, copy);
  // And a different race gives a different one.
  assert.notDeepEqual(race(new Track(dusk.course), 1, 12).wear!.cells, copy);
});

test('the Dusk Valley wear grid is 0.5 MB or smaller', () => {
  const grid = new WearGrid(dusk);
  assert.equal(grid.bytes, grid.cols * grid.rows);
  assert.ok(grid.bytes <= 500_000, `${grid.bytes} bytes`);
  assert.equal(WEAR_CELL, 0.5);
  // It reaches every point a bike can ride: the whole width of the track all the way round.
  for (let s = 0; s < dusk.length; s += 0.5)
    for (const lateral of [-dusk.halfWidth - 2.8, 0, dusk.halfWidth + 2.8]) {
      const p = dusk.at(s, lateral);
      assert.ok(grid.cellAt(p.x, p.z) >= 0, `off the grid at ${s} m, ${lateral} m across`);
    }
});

test('wear does not change the riding', () => {
  // A rider's lap is step for step the same whatever has been worn: the physics never reads the grid.
  const lap = (worn: boolean) => {
    const track = new Track(dusk.course);
    if (worn) wearFor(track).cells.fill(WEAR_FULL);
    const r = makeRider(track, 0, false, 0);
    const trace: number[] = [];
    for (let i = 0; i < 120 * 40; i++) {
      stepRider(r, npcControl(r, track, [], 'club'), track, STEP, [r], 1);
      if (worn) wearFor(track).ride(r);
      if (i % 120 === 0) trace.push(r.x, r.z, r.speed);
    }
    return trace;
  };
  assert.deepEqual(lap(true), lap(false));
  // Nothing that rides or decides imports the grid.
  for (const file of ['physics', 'track', 'takeoff', 'gate', 'riders', 'timing', 'season'])
    assert.doesNotMatch(readFileSync(`src/${file}.ts`, 'utf8'), /['"]\.\/wear['"]/, `src/${file}.ts`);
});

test('the racing line is worn after a 3-lap 8-rider race, most where the riders agree', () => {
  const session = race(dusk, 3, 5);
  const grid = session.wear!;
  // Along the track: the most worn cell across the width is well worn, the edges of the track hardly at all.
  let line = 0,
    edge = 0,
    samples = 0;
  for (let s = 0; s < dusk.length; s += 5) {
    let most = 0;
    for (let l = -dusk.halfWidth; l <= dusk.halfWidth; l += 0.25) {
      const p = dusk.at(s, l);
      most = Math.max(most, grid.at(p.x, p.z));
    }
    const a = dusk.at(s, -dusk.halfWidth - 2),
      b = dusk.at(s, dusk.halfWidth + 2);
    line += most;
    edge += (grid.at(a.x, a.z) + grid.at(b.x, b.z)) / 2;
    samples++;
  }
  assert.ok(line / samples > 0.35, `line ${(line / samples).toFixed(2)}`);
  assert.ok(edge / samples < 0.05, `edge ${(edge / samples).toFixed(2)}`);
  // Most of the grid is untouched: a line, not a wash.
  const worn = grid.cells.reduce((n, v) => n + (v ? 1 : 0), 0);
  assert.ok(worn / grid.cells.length < 0.2, `${((worn / grid.cells.length) * 100).toFixed(1)}% of cells worn`);
});

test('the grid is empty at race start and in the editor preview', () => {
  const session = race(dusk, 1, 3, 20);
  assert.ok(sum(session.wear!.cells) > 0);
  // The next race on the same track starts on fresh dirt, through the countdown and until a bike moves.
  session.start({lapCount: 1, difficulty: 'club', seed: 3});
  assert.equal(sum(session.wear!.cells), 0);
  while (session.phase === 'countdown') session.step(STEP);
  assert.equal(sum(session.wear!.cells), 0);
  // Lining up a new grid clears it too, so the setup screen never shows the last race's line.
  race(dusk, 1, 3, 20).grid({track: dusk, npcCount: 0, humanCount: 0, practice: true, assignments: []});
  assert.equal(sum(wearFor(dusk).cells), 0);
  // The track editor's preview asks for the dirt without a wear layer, and never touches the grid.
  const preview = readFileSync('src/track-preview.ts', 'utf8');
  assert.match(preview, /dirtMaterial\(false, \(\) => this\.requestRender\(\)\)/);
  assert.doesNotMatch(preview, /wear/i);
  assert.doesNotMatch(readFileSync('src/track-editor.ts', 'utf8'), /wear/i);
});

test('wear is weighted by speed and slide, once a pass, and only from a bike on its wheels', () => {
  const left = (r: object) => {
    const grid = new WearGrid(flat);
    grid.ride(rider(r));
    return grid.at(0.2, 0.2) * WEAR_FULL;
  };
  assert.ok(left({speed: 30}) > left({speed: 10}));
  assert.ok(left({powerSlide: 1}) > left({}) + 6);
  assert.ok(left({slipAngle: -0.6}) > left({}) + 6);
  for (const none of [{grounded: false}, {crashTime: 0.4}, {speed: 0.5}]) assert.equal(left(none), 0);
  // A slow crossing of one cell wears it once; coming back to it wears it again.
  const grid = new WearGrid(flat);
  for (let i = 0; i < 50; i++) grid.ride(rider({x: 0.2 + i * 0.004}));
  const once = grid.at(0.2, 0.2);
  assert.equal(once * WEAR_FULL, left({}));
  grid.ride(rider({x: 0.7}));
  grid.ride(rider());
  assert.ok(grid.at(0.2, 0.2) > once);
  // The cells beside it get a share; a cell never goes past full; off the grid is ignored.
  assert.ok(grid.at(1.2, 0.2) > 0 && grid.at(1.2, 0.2) < grid.at(0.7, 0.2));
  for (let i = 0; i < 400; i++) grid.ride(rider({x: i % 2 ? 0.2 : 0.7}));
  assert.equal(grid.at(0.2, 0.2), 1);
  const before = grid.version;
  grid.ride(rider({x: -500}));
  assert.equal(grid.version, before);
  grid.clear();
  assert.equal(sum(grid.cells), 0);
});
