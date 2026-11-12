import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProgress,
  updateProgress,
  progressDistance,
  restoreDeparture,
  OFF_TRACK_FORWARD_LIMIT,
} from '../src/race.ts';

const length = 160;
const advance = (progress: ReturnType<typeof createProgress>, from: number, to: number, step = 1) => {
  let laps = 0;
  for (let s = from + step; step > 0 ? s <= to : s >= to; s += step) {
    laps += +updateProgress(progress, s, 0, length, 5, 1 / 60);
  }
  return laps;
};

test('ordered forward crossings award one lap at the finish, including riders behind the start', () => {
  const progress = createProgress(-3);
  assert.equal(advance(progress, -3, 159), 0);
  assert.equal(progress.nextCheckpoint, 0);
  assert.equal(advance(progress, 159, 160), 1);
  assert.equal(progress.lap, 1);
  assert.equal(progress.nextCheckpoint, 1);
  assert.equal(progressDistance(progress, length), length);
  assert.equal(advance(progress, 160, 320), 1);
  assert.equal(progress.lap, 2);
});

test('crossing the finish in reverse, or completing a reverse circuit, awards no laps', () => {
  const progress = createProgress();
  assert.equal(advance(progress, 0, -320, -1), 0);
  assert.equal(progress.lap, 0);
  assert.equal(progress.nextCheckpoint, 1);
  assert.equal(progress.wrongWay, true);
});

test('a large forward teleport cannot skip gates or restore credit by continuing forward', () => {
  const progress = createProgress();
  updateProgress(progress, 45, 0, length, 5, 1 / 60);
  assert.equal(progress.routeBroken, true);
  advance(progress, 45, 155);
  assert.equal(progress.nextCheckpoint, 1);
  assert.equal(progress.lap, 0);
  assert.equal(progressDistance(progress, length), 0);
});

test('short off-track excursions are forgiven, including timing-plane crossings', () => {
  const progress = createProgress();
  advance(progress, 0, 9);
  updateProgress(progress, 11, 8, length, 5, 1 / 60);
  assert.equal(progress.nextCheckpoint, 1, 'no gates earned while outside');
  assert.equal(progressDistance(progress, length), 9, 'ranking holds at departure');
  updateProgress(progress, 12, 0, length, 5, 1 / 60);
  assert.equal(progress.nextCheckpoint, 2);
  assert.equal(progress.routeBroken, false);
  assert.equal(progressDistance(progress, length), 12);
  assert.equal(advance(progress, 12, 160), 1);
});

test('excess forward progress outside returns to the original departure, not a checkpoint', () => {
  const p = createProgress();
  advance(p, 0, 7);
  for (let s = 8; s <= 7 + OFF_TRACK_FORWARD_LIMIT + 1; s++) updateProgress(p, s, 8, length, 5, 1 / 60);
  assert.equal(p.routeBroken, true);
  assert.equal(p.nextCheckpoint, 1);
  assert.equal(progressDistance(p, length), 7);
  updateProgress(p, 39, 0, length, 5, 1 / 60);
  assert.equal(p.routeBroken, true, 're-entering ahead cannot erase the penalty');
  assert.deepEqual(restoreDeparture(p), {s: 7, lateral: 0});
  assert.equal(progressDistance(p, length), 7);
  assert.equal(p.routeBroken, false);
  assert.equal(advance(p, 7, 160), 1);
});

test('forgiven excursions across several gates and the finish count exactly once', () => {
  const p = createProgress();
  advance(p, 0, 149);
  for (let s = 150; s <= 169; s++) updateProgress(p, s, 8, length, 5, 1 / 60);
  assert.equal(p.lap, 0);
  assert.equal(updateProgress(p, 170, 0, length, 5, 1 / 60), true);
  assert.equal(p.lap, 1);
  assert.equal(p.nextCheckpoint, 2);
  assert.equal(progressDistance(p, length), 170);
  updateProgress(p, 170, 0, length, 5, 1 / 60);
  assert.equal(p.lap, 1);
});

test('backtracking outside earns no shortcut penalty or free gate credit', () => {
  const p = createProgress();
  advance(p, 0, 8);
  for (let s = 7; s >= -15; s--) updateProgress(p, s, 8, length, 5, 1 / 60);
  updateProgress(p, -16, 0, length, 5, 1 / 60);
  assert.equal(p.routeBroken, false);
  assert.equal(p.lap, 0);
  assert.equal(p.nextCheckpoint, 1);
  assert.equal(advance(p, -16, 160), 1);
});

test('departure recovery does nothing when no excursion is pending', () => {
  const p = createProgress();
  advance(p, 0, 47);
  const before = structuredClone(p);
  assert.equal(restoreDeparture(p), null);
  assert.deepEqual(p, before);
});

test('backtracking across a checkpoint cannot count it twice', () => {
  const progress = createProgress();
  advance(progress, 0, 12);
  advance(progress, 12, 8, -1);
  advance(progress, 8, 12);
  assert.equal(progress.nextCheckpoint, 2);
  assert.equal(progressDistance(progress, length), 12);
  advance(progress, 12, 20);
  assert.equal(progress.nextCheckpoint, 3);
});

test('invalid measurements and paused frames cannot corrupt progress', () => {
  const progress = createProgress();
  const before = {...progress};
  updateProgress(progress, NaN, 0, length, 5, 1 / 60);
  updateProgress(progress, 10, 0, length, 5, 0);
  assert.deepEqual(progress, before);
});
