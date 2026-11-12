import test from 'node:test';
import assert from 'node:assert/strict';
import {Track} from '../src/track';
import {layoutFromTrack, validateLayout, saveLayout, loadLayout} from '../src/track-layout';
const draft = () => {
  const layout = layoutFromTrack(new Track());
  layout.jumps = [];
  layout.bermHeights = layout.points.map(() => null);
  return layout;
};
test('individual turn height raises the outside edge and flat removes the berm without raising the center', () => {
  const layout = draft(),
    base = new Track(undefined, layout),
    index = 4,
    p = layout.points[index],
    s = base.project(...p).s;
  const outside = -Math.sign(base.curvature(s)) * base.halfWidth;
  for (const height of [0, 0.75, 1.5, 3, 5]) {
    layout.bermHeights![index] = height;
    const track = new Track(undefined, layout);
    assert.ok(Math.abs(track.height(s, outside) - track.height(s) - height) < 0.015, `height ${height}`);
    assert.ok(Math.abs(track.height(s) - base.height(s)) < 1e-8, 'centerline unchanged');
    assert.ok(Math.abs(track.height(s, -outside) - track.height(s)) < 0.015, 'inside stays flat');
    const remote = base.project(...layout.points[14]).s;
    assert.ok(
      Math.abs(track.height(remote, outside) - base.height(remote, outside)) < 1e-8,
      'other turns retain original banking',
    );
  }
});
test('berms have smooth entry/exit and remain continuous across the lap seam', () => {
  const layout = draft();
  layout.bermHeights![0] = 4;
  layout.bermHeights![4] = 5;
  const track = new Track(undefined, layout);
  for (const lateral of [-track.halfWidth, track.halfWidth]) {
    assert.ok(Math.abs(track.height(-0.001, lateral) - track.height(0.001, lateral)) < 0.01);
    const s = track.project(...layout.points[4]).s;
    for (let d = -30; d < 30; d += 0.2)
      assert.ok(
        Math.abs(track.height(s + d + 0.001, lateral) - track.height(s + d, lateral)) < 0.01,
        'no abrupt berm steps',
      );
  }
  const geometry = track.geometry(1.5, 12),
    position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i += 19) assert.ok(Number.isFinite(position.getY(i)));
  geometry.dispose();
});
test('berm settings round-trip through layouts and storage; malformed heights are rejected', () => {
  const layout = draft();
  layout.bermHeights![4] = 3.25;
  layout.bermHeights![9] = 0;
  const rebuilt = layoutFromTrack(new Track(undefined, layout));
  assert.deepEqual(rebuilt.bermHeights, layout.bermHeights);
  let raw = '';
  const storage = {
    getItem: () => raw,
    setItem: (_k: string, v: string) => {
      raw = v;
    },
  };
  saveLayout(layout, storage);
  assert.deepEqual(loadLayout('dusk', storage), layout);
  for (const value of [-1, 5.1, NaN, '3', undefined]) {
    const bad = structuredClone(layout);
    bad.bermHeights![4] = value as number;
    assert.throws(() => validateLayout(bad));
  }
  assert.throws(() => validateLayout({...layout, bermHeights: [1]}));
  const legacy = layoutFromTrack(new Track());
  assert.equal(legacy.bermHeights, undefined);
  assert.doesNotThrow(() => validateLayout(legacy));
});
