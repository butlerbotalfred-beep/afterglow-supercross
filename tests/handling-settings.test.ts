import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSlideAggression,normalizeSlideAggression,SLIDE_AGGRESSION_KEY} from '../src/handling-settings';
test('slide preference loads saved zero and percentages, with safe defaults for missing/corrupt/blocked storage',()=>{
 for(const [raw,expected] of [[null,1],['0',0],['.5',.5],['1.7',1.7],['2',2],['bad',1],['Infinity',1],['',1],['-2',0],['10',2]] as const){assert.equal(loadSlideAggression({getItem:key=>{assert.equal(key,SLIDE_AGGRESSION_KEY);return raw;}}),expected);}
 assert.equal(loadSlideAggression({getItem:()=>{throw new Error('blocked');}}),1);
 assert.equal(normalizeSlideAggression(NaN),1);
});
