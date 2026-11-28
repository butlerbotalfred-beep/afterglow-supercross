import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {TUNING} from '../src/config.ts';
import {COURSES} from '../src/courses.ts';
import {npcControl} from '../src/physics.ts';
import {Track} from '../src/track.ts';
import {RaceSession} from '../src/game/race-session.ts';
import {WEAR_REFRESH_MS, WearLayer} from '../src/track-material.ts';
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
  // The same race of eight three ways: as it is, with no grid at all, and with the dirt worn through
  // everywhere before every step. Every rider is in the same place at the same speed all the way.
  const ride = (mode: 'normal' | 'none' | 'worn') => {
    const track = new Track(dusk.course);
    const session: RaceSession = new RaceSession(
      {sample: () => npcControl(session.riders[0], track, [], 'club'), connectedGamepads: () => []},
      quiet,
    );
    session.grid({track, npcCount: 8, humanCount: 0, practice: false, assignments: [], difficulty: 'club', seed: 9});
    session.start({lapCount: 1, difficulty: 'club', seed: 9});
    if (mode === 'none') session.wear = null;
    const trace: number[] = [];
    for (let i = 0; session.phase !== 'results' && i < 120 * 50; i++) {
      if (mode === 'worn') session.wear!.cells.fill(WEAR_FULL);
      session.step(STEP);
      if (i % 60 === 0) for (const r of session.riders) trace.push(r.x, r.y, r.z, r.speed, r.heading, r.progress.lap);
    }
    return trace;
  };
  const normal = ride('normal');
  assert.ok(normal.length > 8 * 6 * 80);
  assert.deepEqual(ride('none'), normal);
  assert.deepEqual(ride('worn'), normal);
  // Only the race session (which wears it) and the world and its material (which draw it) import the grid.
  const importers = (readdirSync('src', {recursive: true}) as string[])
    .filter(file => file.endsWith('.ts'))
    .filter(file => /from '(\.\.?\/)+wear'/.test(readFileSync(`src/${file}`, 'utf8')))
    .map(file => file.replaceAll('\\', '/'))
    .sort();
  assert.deepEqual(importers, ['game/race-session.ts', 'track-material.ts', 'world.ts']);
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
  // Going back to the setup screen clears it, so the last race's line is not shown behind the menus.
  const back = race(dusk, 1, 3, 20);
  assert.ok(sum(back.wear!.cells) > 0);
  back.toSetup();
  assert.equal(sum(back.wear!.cells), 0);
  // Lining up a new grid clears it too.
  race(dusk, 1, 3, 20).grid({track: dusk, npcCount: 0, humanCount: 0, practice: true, assignments: []});
  assert.equal(sum(wearFor(dusk).cells), 0);
  // The track editor's preview: a wear layer reaches the dirt only as the third thing handed to
  // dirtMaterial, and neither the preview nor the editor has anything to do with wear. Checked by reading.
  const material = readFileSync('src/track-material.ts', 'utf8');
  assert.equal(material.match(/shader\.uniforms\.wearMap/g)?.length, 1);
  for (const file of ['track-preview', 'track-editor'])
    assert.doesNotMatch(readFileSync(`src/${file}.ts`, 'utf8'), /wear/i, file);
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

test('a pass leaves the same wear whichever way it runs across the cells', () => {
  const big = {bounds: {minX: 0, maxX: 60, minZ: 0, maxZ: 60}, halfWidth: 4.8};
  const pass = (dx: number, dz: number) => {
    const grid = new WearGrid(big);
    for (let d = 0; d < 40; d += 20 * STEP) grid.ride(rider({x: 10 + dx * d, z: 10.2 + dz * d}));
    return sum(grid.cells);
  };
  const straight = pass(1, 0);
  for (const [dx, dz] of [
    [0, 1],
    [Math.SQRT1_2, Math.SQRT1_2],
    [0.9, 0.436],
  ])
    assert.ok(Math.abs(pass(dx, dz) / straight - 1) < 0.1, `${dx}, ${dz}: ${pass(dx, dz)} against ${straight}`);
});

test('the wear picture is sent at most 4 times a second, and only when the grid has changed', () => {
  const grid = new WearGrid(flat);
  const layer = new WearLayer(grid);
  assert.equal(layer.texture.image.data, grid.cells);
  assert.equal(WEAR_REFRESH_MS, 250);
  const first = layer.uploads;
  // Twenty seconds at 60 frames a second with a bike wearing the track on every frame.
  const sent: number[] = [];
  for (let frame = 0; frame < 1200; frame++) {
    const now = 5000 + (frame * 1000) / 60;
    grid.ride(rider({x: 0.2 + (frame % 30) * 0.6}));
    if (layer.refresh(now)) sent.push(now);
  }
  assert.equal(layer.uploads - first, sent.length);
  assert.ok(sent.length >= 70 && sent.length <= 80, `${sent.length} in 20 s`);
  for (let i = 1; i < sent.length; i++) assert.ok(sent[i] - sent[i - 1] >= WEAR_REFRESH_MS);
  for (let i = 4; i < sent.length; i++) assert.ok(sent[i] - sent[i - 4] >= 1000, 'five within a second');
  // Nothing changes: nothing is sent. Cleared: sent again, so the old line does not stay on screen.
  layer.refresh(29000);
  for (let now = 30000; now < 32000; now += 16) assert.equal(layer.refresh(now), false);
  grid.clear();
  assert.equal(layer.refresh(32000), true);
});
