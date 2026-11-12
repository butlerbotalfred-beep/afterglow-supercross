import test from 'node:test';
import assert from 'node:assert/strict';
import {MenuPad} from '../src/menu-controller';
import type {GamepadLike} from '../src/input';
const pad = (index = 1000): GamepadLike => ({
  index,
  id: 'Xbox / macOS',
  connected: true,
  axes: [0, 0, 0, 0],
  buttons: Array.from({length: 16}, () => ({value: 0})),
});
const press = (p: GamepadLike, ...buttons: number[]) => ({
  ...p,
  buttons: p.buttons.map((_, i) => ({value: buttons.includes(i) ? 1 : 0})),
});
test('Xbox native/browser standard buttons navigate every menu action', () => {
  for (const [button, action] of [
    [0, 'accept'],
    [1, 'back'],
    [2, 'kind'],
    [3, 'highlight'],
    [4, 'previous'],
    [5, 'next'],
    [9, 'start'],
    [12, 'up'],
    [13, 'down'],
    [14, 'left'],
    [15, 'right'],
  ] as const) {
    assert.deepEqual(new MenuPad().update([null, press(pad(), button)], 0), [{index: 1000, action, scale: 1}]);
  }
});
test('confirm/back/start fire once per press; held directions repeat at a usable pace', () => {
  const nav = new MenuPad(),
    p = press(pad(), 0, 1, 9, 13);
  assert.equal(nav.update([p], 0).length, 4);
  assert.deepEqual(nav.update([p], 100), []);
  assert.deepEqual(
    nav.update([p], 350).map(e => e.action),
    ['down'],
  );
  assert.deepEqual(nav.update([p], 400), []);
  assert.deepEqual(
    nav.update([p], 500).map(e => e.action),
    ['down'],
  );
  nav.update([pad()], 510);
  assert.equal(nav.update([p], 520).length, 4);
});
test('left stick has menu deadzone and dominant-axis navigation; right stick edits independently', () => {
  const nav = new MenuPad(),
    p = pad();
  assert.deepEqual(nav.update([{...p, axes: [0.3, -0.2, 0, 0]}], 0), []);
  assert.deepEqual(
    nav.update([{...p, axes: [0.7, -0.9, 0, 0]}], 1).map(e => e.action),
    ['up'],
  );
  nav.update([p], 2);
  assert.deepEqual(
    nav.update([{...p, axes: [-0.9, 0.7, 1, 0]}], 3).map(e => e.action),
    ['left', 'moveRight'],
  );
});
test('trigger modifiers fine/fast edit; sparse pads and disconnects clear held state', () => {
  const nav = new MenuPad(),
    p = pad(1002);
  assert.equal(nav.update([{...press(p, 6), axes: [0, 0, 0, -1]}], 0)[0].scale, 0.1);
  nav.update([], 1);
  assert.equal(nav.update([{...press(p, 7), axes: [0, 0, 0, -1]}], 2)[0].scale, 5);
  assert.deepEqual(nav.update([{...p, connected: false}], 3), []);
  assert.equal(nav.update([null, press(p, 0)], 4)[0].index, 1002);
});
test('tracking inputs during racing prevents a held Menu or A from activating the next screen', () => {
  const nav = new MenuPad(),
    p = press(pad(), 9, 0);
  nav.update([p], 0); // race frame opens a menu through the riding pause handler
  assert.deepEqual(nav.update([p], 16), []);
  assert.deepEqual(nav.update([p], 1000), []);
  nav.update([pad()], 1016);
  assert.equal(nav.update([p], 1032).length, 2);
});
