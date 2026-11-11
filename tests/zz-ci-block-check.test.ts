import test from 'node:test';
import assert from 'node:assert';
// Temporary: proves a failing test blocks the merge. This PR is closed without merging.
test('deliberately failing',()=>assert.equal(1,2));
