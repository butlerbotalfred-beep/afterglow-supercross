import test from 'node:test';
import assert from 'node:assert/strict';
import { InputManager, mapKeyboard, mapGamepad, routeControls, uniqueDevices, controllerJoinSlot, type GamepadLike } from '../src/input.ts';

const pad = (index: number, throttle = 0): GamepadLike => ({
  index, id: `Pad ${index}`, connected: true, axes: [0, 0, 0, 0],
  buttons: Array.from({ length: 16 }, (_, button) => ({ value: button === 7 ? throttle : 0 })),
});
const keyEvent = (type: string, code: string) => Object.assign(new Event(type, { cancelable: true }), { code });

test('keyboard aliases and opposing controls map consistently', () => {
  assert.deepEqual(mapKeyboard(new Set(['KeyW', 'ArrowLeft', 'KeyE'])), {
    throttle: 1, brake: 0, steer: 1, pitch: 1, reset: false, pause: false,
  });
  assert.equal(mapKeyboard(new Set(['KeyA', 'ArrowRight'])).steer, 0);
});

test('physical pad indices remain distinct with sparse/reordered gamepad lists', () => {
  const controls = routeControls([{ kind: 'gamepad', index: 3 }, { kind: 'gamepad', index: 1 }, { kind: 'keyboard' }],
    new Set(['KeyW']), [pad(1, 0.3), null, pad(3, 0.9)]);
  assert.deepEqual(controls.map(control => control.throttle), [0.9, 0.3, 1]);
  assert.equal(routeControls([{ kind: 'gamepad', index: 2 }], new Set(), [pad(1, 1)])[0].throttle, 0);
});

test('gamepad sticks use a deadzone and standard triggers/buttons', () => {
  const physical = pad(0, 0.8);
  physical.axes = [0.1, -1, 0, 0];
  physical.buttons = physical.buttons.map((button, index) => ({ value: [1, 6, 9].includes(index) ? 1 : button.value }));
  assert.deepEqual(mapGamepad(physical), { throttle: 0.8, brake: 1, steer: 0, pitch: -1, reset: true, pause: true });
  assert.equal(mapGamepad({ ...physical, connected: false }).throttle, 0);
});

test('duplicate assignments are removed without mixing keyboard and controllers', () => {
  assert.deepEqual(uniqueDevices([{ kind: 'keyboard' }, { kind: 'gamepad', index: 1 }, { kind: 'keyboard' },
    { kind: 'gamepad', index: 1 }, { kind: 'gamepad', index: 3 }]),
  [{ kind: 'keyboard' }, { kind: 'gamepad', index: 1 }, { kind: 'gamepad', index: 3 }]);
});

test('reset and pause edges are independently consumed per device', () => {
  const target = new EventTarget();
  const first = pad(0);
  const second = pad(2);
  const hold = (physical: GamepadLike, value: number) => {
    physical.buttons = physical.buttons.map((button, index) => ({ value: index === 1 || index === 9 ? value : button.value }));
  };
  hold(first, 1); hold(second, 1);
  const input = new InputManager(target, () => [first, null, second]);
  target.dispatchEvent(keyEvent('keydown', 'KeyR'));
  assert.equal(input.sample({ kind: 'gamepad', index: 0 }).reset, true);
  assert.equal(input.sample({ kind: 'gamepad', index: 0 }).reset, false);
  assert.equal(input.sample({ kind: 'gamepad', index: 2 }).pause, true);
  assert.equal(input.sample({ kind: 'keyboard' }).reset, true);
  assert.equal(input.sample({ kind: 'keyboard' }).reset, false);
  hold(first, 0);
  input.sample({ kind: 'gamepad', index: 0 });
  hold(first, 1);
  assert.equal(input.sample({ kind: 'gamepad', index: 0 }).pause, true);
  assert.deepEqual(input.connectedGamepads(), [{ index: 0, id: 'Pad 0' }, { index: 2, id: 'Pad 2' }]);
  input.dispose();
});

test('blur and dispose release keyboard input', () => {
  const target = new EventTarget();
  const input = new InputManager(target, () => []);
  target.dispatchEvent(keyEvent('keydown', 'ArrowUp'));
  assert.equal(input.sample({ kind: 'keyboard' }).throttle, 1);
  target.dispatchEvent(new Event('blur'));
  assert.equal(input.sample({ kind: 'keyboard' }).throttle, 0);
  input.dispose();
  target.dispatchEvent(keyEvent('keydown', 'ArrowUp'));
  assert.equal(input.sample({ kind: 'keyboard' }).throttle, 0);
});

test('left stick steers and pitches simultaneously; other stick and LB do not affect pitch',()=>{
  const physical=pad(0,1);physical.axes=[1,-1,-1,1];
  assert.deepEqual(mapGamepad(physical),{throttle:1,brake:0,steer:-1,pitch:-1,reset:false,pause:false});
  physical.axes=[-1,1,1,-1];
  assert.equal(mapGamepad(physical).steer,1);assert.equal(mapGamepad(physical).pitch,1);
  physical.axes=[.1,-.1,1,-1];physical.buttons=physical.buttons.map((b,i)=>i===4?{value:1}:b);
  assert.equal(mapGamepad(physical).steer,0);assert.equal(mapGamepad(physical).pitch,0);
  physical.axes=[0,.58,0,-1];assert.ok(Math.abs(mapGamepad(physical).pitch-.5)<1e-8,'pitch remains analog');
  physical.axes=[0];assert.equal(mapGamepad(physical).pitch,0);
});

test('A assigns a solo controller to Player 1 in race and practice, then joins only distinct multiplayer slots',()=>{
 for(const practice of [false,true])assert.equal(controllerJoinSlot([{kind:'keyboard'}],2,practice),0);
 assert.equal(controllerJoinSlot([null],2,true),0);
 assert.equal(controllerJoinSlot([{kind:'gamepad',index:2}],2,false),0);
 assert.equal(controllerJoinSlot([{kind:'gamepad',index:2}],3,false),1);
 assert.equal(controllerJoinSlot([{kind:'gamepad',index:2}],3,true),-1);
 assert.equal(controllerJoinSlot([{kind:'keyboard'},null],3,false),1);
 assert.equal(controllerJoinSlot([0,1,2,3].map(index=>({kind:'gamepad' as const,index})),4,false),-1);
});
