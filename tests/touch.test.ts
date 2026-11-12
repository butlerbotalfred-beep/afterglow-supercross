import test from 'node:test';
import assert from 'node:assert/strict';
import {TouchInput} from '../src/touch-input.ts';
import {InputManager, neutralControl, readBrowserGamepads, routeControls, uniqueDevices} from '../src/input.ts';

test('touch must be explicitly enabled; inactive controls cannot move a rider', () => {
  const touch = new TouchInput();
  assert.equal(touch.start(1, 'throttle'), false);
  assert.deepEqual(touch.read(), neutralControl());
  touch.setEnabled(true);
  touch.start(1, 'throttle');
  assert.equal(touch.read().throttle, 1);
  touch.setEnabled(false);
  assert.deepEqual(touch.read(), neutralControl());
  touch.setEnabled(true);
  assert.equal(touch.read().throttle, 0);
});

test('independent fingers steer/pitch and accelerate; cancellation releases only its owner', () => {
  const touch = new TouchInput();
  touch.setEnabled(true);
  touch.start(10, 'stick');
  touch.move(10, 0.7, -1);
  touch.start(11, 'throttle');
  assert.ok(touch.read().steer < -0.6);
  assert.equal(touch.read().pitch, 1);
  assert.equal(touch.read().throttle, 1);
  assert.equal(touch.start(12, 'stick'), false);
  touch.move(12, -1, 1);
  assert.equal(touch.read().pitch, 1);
  touch.end(10);
  assert.equal(touch.read().steer, 0);
  assert.equal(touch.read().throttle, 1);
  touch.start(13, 'throttle');
  touch.end(11);
  assert.equal(touch.read().throttle, 1);
  touch.end(13);
  assert.deepEqual(touch.read(), neutralControl());
});

test('pause/rotation cleanup clears every held control, including reset', () => {
  const touch = new TouchInput();
  touch.setEnabled(true);
  touch.start(1, 'throttle');
  touch.start(2, 'brake');
  touch.start(3, 'reset');
  touch.start(4, 'stick');
  touch.move(4, 10, -10);
  assert.equal(touch.read().steer, -1);
  touch.clear();
  assert.deepEqual(touch.read(), neutralControl());
});

test('touch routing remains isolated from keyboard and gamepads; reset is edge triggered', () => {
  const touch = new TouchInput();
  touch.setEnabled(true);
  touch.start(1, 'brake');
  touch.start(2, 'reset');
  const routed = routeControls(
    [{kind: 'keyboard'}, {kind: 'touch'}, {kind: 'gamepad', index: 0}],
    new Set(['KeyW']),
    [],
    touch.read(),
  );
  assert.deepEqual(
    routed.map(c => [c.throttle, c.brake]),
    [
      [1, 0],
      [0, 1],
      [0, 0],
    ],
  );
  assert.equal(uniqueDevices([{kind: 'touch'}, {kind: 'keyboard'}, {kind: 'touch'}]).length, 2);
  const input = new InputManager(
    null,
    () => [],
    () => touch.read(),
  );
  assert.equal(input.sample({kind: 'touch'}).reset, true);
  assert.equal(input.sample({kind: 'touch'}).reset, false);
  touch.end(2);
  input.sample({kind: 'touch'});
  touch.start(2, 'reset');
  assert.equal(input.sample({kind: 'touch'}).reset, true);
});

test('unavailable or blocked Gamepad API does not prevent touch play', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  try {
    Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {}});
    assert.deepEqual(readBrowserGamepads(), []);
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        getGamepads() {
          throw new Error('blocked');
        },
      },
    });
    assert.deepEqual(readBrowserGamepads(), []);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
});
