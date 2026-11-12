import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3} from 'three';
import {mapKeyboard, mapGamepad, neutralControl, type Control} from '../src/input.ts';
import {TouchInput} from '../src/touch-input.ts';
import {Track} from '../src/track.ts';
import {ChaseCamera} from '../src/camera.ts';
import {makeRider, stepRider} from '../src/physics.ts';

function displacementOnScreen(control: Control) {
  const track = new Track();
  const rider = makeRider(track, 0, true, 0xffffff);
  rider.speed = 8;
  const chase = new ChaseCamera();
  chase.update(rider, track, 1 / 60, 3.4, 0, 0);
  chase.camera.updateMatrixWorld();
  const before = new Vector3(rider.x, rider.y + 1, rider.z).project(chase.camera).x;
  for (let step = 0; step < 24; step++) stepRider(rider, control, track, 1 / 120, [rider]);
  return new Vector3(rider.x, rider.y + 1, rider.z).project(chase.camera).x - before;
}

test('regular keyboard, gamepad and touch right input move right in the actual rear camera', () => {
  const touch = new TouchInput();
  touch.setEnabled(true);
  touch.start(1, 'stick');
  touch.move(1, 1, 0);
  const gamepad = mapGamepad({index: 0, id: 'test', axes: [1, 0, 0, 0], buttons: []});
  for (const control of [mapKeyboard(new Set(['KeyD'])), gamepad, touch.read()]) {
    assert.ok(displacementOnScreen(control) > 0.01, 'right must increase screen X');
    assert.ok(displacementOnScreen({...control, steer: -control.steer}) < -0.01, 'left must decrease screen X');
  }
});

test('steering and air pitch invert independently; changing preference clears held controls', () => {
  const touch = new TouchInput();
  touch.setEnabled(true);
  const move = () => {
    touch.start(1, 'stick');
    touch.move(1, 1, -1);
    touch.start(2, 'throttle');
  };
  move();
  assert.equal(touch.read().pitch, 1);
  assert.ok(displacementOnScreen(touch.read()) > 0);
  touch.setDirections('inverted', 'regular');
  assert.deepEqual(touch.read(), neutralControl());
  move();
  assert.equal(touch.read().pitch, 1);
  assert.ok(displacementOnScreen(touch.read()) < 0);
  touch.setDirections('regular', 'inverted');
  move();
  assert.equal(touch.read().pitch, -1);
  assert.ok(displacementOnScreen(touch.read()) > 0);
  touch.setEnabled(false);
  touch.setEnabled(true);
  move();
  assert.equal(touch.read().pitch, -1);
});
