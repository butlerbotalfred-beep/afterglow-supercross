import test from 'node:test';
import assert from 'node:assert/strict';
import {blendPose,pacingStats,SNAP_DISTANCE} from '../src/render-interp';

test('blendPose moves linearly between the two physics poses',()=>{
  const p=blendPose({x:0,y:0,z:0,heading:0},{x:1,y:2,z:-4,heading:.4},.25);
  assert.deepEqual(p,{x:.25,y:.5,z:-1,heading:.1});
});

test('blendPose takes the short way round when heading wraps',()=>{
  const p=blendPose({x:0,y:0,z:0,heading:Math.PI-.1},{x:0,y:0,z:0,heading:-Math.PI+.1},.5);
  assert.ok(Math.abs(Math.abs(p.heading)-Math.PI)<1e-9);
});

test('blendPose snaps after a teleport and with no previous pose',()=>{
  const curr={x:SNAP_DISTANCE+1,y:0,z:0,heading:1};
  assert.deepEqual(blendPose({x:0,y:0,z:0,heading:0},curr,.5),curr);
  assert.deepEqual(blendPose(undefined,curr,.5),curr);
});

test('blendPose clamps alpha',()=>{
  assert.equal(blendPose({x:0,y:0,z:0,heading:0},{x:1,y:0,z:0,heading:0},1.7).x,1);
});

test('pacingStats reports the slowest 1% and uneven step counts',()=>{
  const frames=Array.from({length:100},(_,i)=>i===99?.05:1/60);
  const steps=Array.from({length:100},(_,i)=>i%25===0?3:2);
  const s=pacingStats(frames,steps);
  assert.equal(Math.round(s.p99Ms),50);
  assert.equal(s.usualSteps,2);
  assert.equal(s.unevenPct,4);
});
