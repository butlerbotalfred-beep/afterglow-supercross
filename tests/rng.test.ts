import test from 'node:test';
import assert from 'node:assert/strict';
import {Rng, seedFromText} from '../src/rng.ts';

const take = (rng: Rng, n: number) => Array.from({length: n}, () => rng.next());

test('the same seed gives the same sequence every time', () => {
  assert.deepEqual(take(new Rng(12345), 200), take(new Rng(12345), 200));
  // Pinned values: these must never change, or saved seeds would replay differently.
  assert.deepEqual(
    take(new Rng(1), 3).map(n => Math.floor(n * 1e9)),
    [627073940, 2735721, 527447039],
  );
});

test('different seeds give different sequences', () => {
  const a = take(new Rng(1), 50),
    b = take(new Rng(2), 50);
  assert.equal(a.filter((n, i) => n === b[i]).length, 0);
  assert.notDeepEqual(take(new Rng(seedFromText('dusk')), 5), take(new Rng(seedFromText('canyon')), 5));
  assert.equal(seedFromText('dusk'), seedFromText('dusk'));
});

test('values stay in range and are spread evenly', () => {
  const rng = new Rng(99);
  const buckets = new Array(10).fill(0);
  for (let i = 0; i < 20000; i++) {
    const n = rng.next();
    assert.ok(n >= 0 && n < 1);
    buckets[Math.floor(n * 10)]++;
  }
  for (const count of buckets) assert.ok(count > 1800 && count < 2200, `bucket of ${count} is far from 2000`);
});

test('range, int, chance and pick respect their limits and follow the seed', () => {
  const rng = new Rng(7);
  const seen = new Set<number>();
  for (let i = 0; i < 2000; i++) {
    const r = rng.range(-2, 3);
    assert.ok(r >= -2 && r < 3);
    const n = rng.int(1, 6);
    assert.ok(Number.isInteger(n) && n >= 1 && n <= 6);
    seen.add(n);
  }
  assert.deepEqual([...seen].sort(), [1, 2, 3, 4, 5, 6]);
  assert.equal(new Rng(3).chance(0), false);
  assert.equal(new Rng(3).chance(1), true);
  const names = ['a', 'b', 'c'];
  const picker = new Rng(5),
    picked = new Set<string>();
  for (let i = 0; i < 200; i++) picked.add(picker.pick(names));
  assert.deepEqual([...picked].sort(), names, 'every item can be picked and nothing else');
  assert.equal(new Rng(5).pick(names), new Rng(5).pick(names));
  const coin = new Rng(11);
  const heads = Array.from({length: 4000}, () => coin.chance(0.25)).filter(Boolean).length;
  assert.ok(heads > 850 && heads < 1150, `${heads} of 4000 at 25%`);
  assert.throws(() => new Rng(1).int(6, 1));
  assert.throws(() => new Rng(1).int(0.5, 3));
  // Very large bounds must not round past the top.
  const big = new Rng(3);
  for (let i = 0; i < 2000; i++) assert.ok(big.int(16777216, 16777221) <= 16777221);
  assert.throws(() => new Rng(5).pick([]));
});

test('a fork is repeatable and does not depend on later use of its parent', () => {
  const a = new Rng(42),
    b = new Rng(42);
  const forkA = a.fork(),
    forkB = b.fork();
  take(a, 10);
  assert.deepEqual(take(forkA, 20), take(forkB, 20));
  assert.notDeepEqual(take(new Rng(42), 20), take(new Rng(42).fork(), 20));
});
