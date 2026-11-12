import test from 'node:test';
import assert from 'node:assert/strict';
import {Track} from '../src/track';
import {COURSES} from '../src/courses';
import {layoutFromTrack} from '../src/track-layout';

test('the live-preview mesh samples the race height surface with a smaller vertex budget', () => {
  for (const course of COURSES) {
    const track = new Track(course),
      geometry = track.geometry(1.5, 12),
      positions = geometry.getAttribute('position'),
      normals = geometry.getAttribute('normal');
    const count = Math.ceil(track.length / 1.5);
    assert.equal(positions.count, (count + 1) * 13);
    assert.ok(positions.count < ((track.count + 1) * 41) / 4);
    for (let row = 0; row <= count; row += 17) {
      const i = row * 13 + 6,
        s = (row / count) * track.length,
        p = track.at(s);
      assert.ok(Math.abs(positions.getX(i) - p.x) < 0.001);
      assert.ok(Math.abs(positions.getZ(i) - p.z) < 0.001);
      assert.ok(Math.abs(positions.getY(i) - track.height(s)) < 0.08);
      assert.ok(Number.isFinite(normals.getY(i)));
    }
    geometry.dispose();
  }
});
test('preview geometry changes for both jump dimensions and moved turns without saving the layout', () => {
  const original = new Track(),
    draft = layoutFromTrack(original);
  draft.jumps[0].height = 7;
  draft.jumps[0].position = 0.045;
  draft.points[0][0] += 15;
  const track = new Track(original.course, draft),
    geometry = track.geometry(1.5, 12),
    pos = geometry.getAttribute('position');
  assert.ok(Math.abs(pos.getX(6) - draft.points[0][0]) < 0.001);
  const jump = track.jumps[0],
    s = jump.start + jump.rise + jump.flat / 2,
    count = Math.ceil(track.length / 1.5),
    row = Math.round((s / track.length) * count);
  assert.ok(pos.getY(row * 13 + 6) > 6.8, 'the moved, taller tabletop appears in the mesh');
  assert.equal(original.jumps[0].height, 3.2, 'previewing does not mutate the original circuit');
  geometry.dispose();
});
