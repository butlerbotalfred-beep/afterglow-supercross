import test from 'node:test';
import assert from 'node:assert/strict';
import type {IncomingMessage} from 'node:http';
import {isLocalControllerRequest} from '../scripts/controller-plugin';
import {routeControls} from '../src/input';

function request(address: string, host: string, origin?: string, site?: string) {
  return {socket: {remoteAddress: address}, headers: {host, origin, 'sec-fetch-site': site}} as Pick<
    IncomingMessage,
    'headers' | 'socket'
  >;
}
test('native controller feed accepts only loopback requests for a local host', () => {
  for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1'])
    assert.equal(
      isLocalControllerRequest(request(address, 'localhost:5173', 'http://localhost:5173', 'same-origin')),
      true,
    );
  for (const address of ['192.168.1.21', '100.96.154.105', '10.0.0.1'])
    assert.equal(isLocalControllerRequest(request(address, 'localhost:5173')), false);
});
test('native controller feed rejects foreign origins, hostnames and cross-site requests', () => {
  assert.equal(isLocalControllerRequest(request('127.0.0.1', 'attacker.example:5173')), false);
  assert.equal(isLocalControllerRequest(request('127.0.0.1', 'localhost:5173', 'https://attacker.example')), false);
  assert.equal(isLocalControllerRequest(request('127.0.0.1', 'localhost:5173', 'http://localhost:8000')), false);
  assert.equal(isLocalControllerRequest(request('127.0.0.1', 'localhost:5173', undefined, 'cross-site')), false);
});
test('native controller standard mapping drives assigned rider and releases missing input', () => {
  const buttons = Array.from({length: 16}, () => ({value: 0}));
  buttons[7].value = 1;
  const pad = {index: 1000, id: 'Xbox / macOS', axes: [1, -1, 0, 1], buttons, connected: true};
  const devices = [{kind: 'gamepad' as const, index: 1000}, {kind: 'keyboard' as const}];
  const [rider, keyboard] = routeControls(devices, new Set(), [pad]);
  assert.equal(rider.throttle, 1);
  assert.equal(rider.steer, -1);
  assert.equal(rider.pitch, -1);
  assert.equal(keyboard.throttle, 0);
  assert.equal(routeControls(devices, new Set(), [])[0].throttle, 0);
});
