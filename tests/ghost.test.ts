import test from 'node:test';
import assert from 'node:assert/strict';
import {PHYSICS_VERSION, TUNING} from '../src/config.ts';
import {COURSES} from '../src/courses.ts';
import {
  GHOST_ACCURACY,
  GhostPlayback,
  GhostRecorder,
  GhostStore,
  ghostKey,
  type Ghost,
  type GhostBackend,
  type GhostPose,
} from '../src/ghost.ts';
import {crash, makeRider, npcControl, stepRider} from '../src/physics.ts';
import {Track} from '../src/track.ts';

/** Rides one flying lap with the computer's hands and records it. `spill` throws the rider off once on the way. */
function recordLap(courseId: string, spill = false) {
  const track = new Track(COURSES.find(c => c.id === courseId)!);
  const r = makeRider(track, 0, true, 0xffffff);
  const recorder = new GhostRecorder();
  const ride: GhostPose[] = [];
  let lapStart = -1;
  let spilled = !spill;
  for (let step = 0; step < 400 / TUNING.step; step++) {
    const lap = r.progress.lap;
    stepRider(r, npcControl(r, track, [r], 'expert'), track, TUNING.step, [r]);
    if (lapStart >= 0 && !spilled && step - lapStart > 20 / TUNING.step && r.grounded) {
      crash(r, 'TEST', 1);
      spilled = true;
    }
    if (r.progress.lap > lap) {
      if (lapStart >= 0) {
        const time = (step - lapStart) * TUNING.step;
        return {ghost: recorder.finish(time)!, ride, time};
      }
      lapStart = step;
      recorder.begin(0);
    }
    if (lapStart >= 0) {
      const pose = {x: r.x, y: r.y, z: r.z, heading: r.heading, pitch: r.pitch, lean: r.lean};
      recorder.push(pose);
      ride.push(pose);
    }
  }
  throw new Error('no lap');
}
const worstMiss = (ghost: Ghost, ride: GhostPose[]) => {
  const playback = new GhostPlayback(ghost);
  let worst = 0;
  ride.forEach((p, step) => {
    const g = playback.at(step * TUNING.step);
    worst = Math.max(worst, Math.hypot(g.x - p.x, g.y - p.y, g.z - p.z));
  });
  return worst;
};
const memoryBackend = () => {
  const held = new Map<string, Ghost>();
  const backend: GhostBackend = {
    get: async key => held.get(key) ?? null,
    put: async (key, ghost) => void held.set(key, ghost),
  };
  return {held, backend};
};
const dusk = recordLap('dusk');

test('ghost playback is within 0.10 m of the recorded run at every moment', () => {
  assert.equal(GHOST_ACCURACY, 0.1);
  for (const id of COURSES.map(c => c.id)) {
    const {ghost, ride} = id === 'dusk' ? dusk : recordLap(id);
    const miss = worstMiss(ghost, ride);
    assert.ok(miss <= 0.1, `${id}: worst miss ${miss.toFixed(3)} m over ${ride.length} steps`);
  }
  const fallen = recordLap('coast', true);
  const miss = worstMiss(fallen.ghost, fallen.ride);
  assert.ok(miss <= 0.1, `a lap with a crash in it: worst miss ${miss.toFixed(3)} m`);
  // Between physics steps playback glides: halfway between two steps it sits between them.
  const playback = new GhostPlayback(dusk.ghost);
  const a = playback.at(10),
    b = {...playback.at(10 + TUNING.step / 2)},
    c = playback.at(10 + TUNING.step);
  assert.ok(Math.hypot(b.x - a.x, b.z - a.z) <= Math.hypot(c.x - a.x, c.z - a.z) + 1e-6);
});

test('headings, pitch and lean survive packing and the turn through north', () => {
  const recorder = new GhostRecorder();
  recorder.begin(0.004);
  for (let i = 0; i < 40; i++)
    recorder.push({
      x: i * 0.3,
      y: 1,
      z: -i * 0.3,
      heading: Math.PI - 0.2 + i * 0.01,
      pitch: -0.4 + i * 0.01,
      lean: 0.3,
    });
  const playback = new GhostPlayback(recorder.finish(1)!);
  for (const i of [0, 8, 20, 39]) {
    const g = playback.at(0.004 + i * TUNING.step);
    const turned = Math.atan2(
      Math.sin(g.heading - (Math.PI - 0.2 + i * 0.01)),
      Math.cos(g.heading - (Math.PI - 0.2 + i * 0.01)),
    );
    assert.ok(Math.abs(turned) < 0.002, `heading at step ${i} off by ${turned}`);
    assert.ok(Math.abs(g.pitch - (-0.4 + i * 0.01)) < 0.002);
    assert.ok(Math.abs(g.lean - 0.3) < 0.002);
  }
  assert.ok(Math.abs(playback.at(-5).x) < 0.01, 'held at the first sample before the lap');
  assert.ok(Math.abs(playback.at(99).x - 39 * 0.3) < 0.01, 'held at the last sample after it');
});

test('a stored Dusk Valley ghost is 40 KB or smaller', () => {
  const bytes = dusk.ghost.data.byteLength;
  assert.ok(bytes <= 40 * 1024, `${bytes} bytes`);
  assert.ok(new GhostPlayback(dusk.ghost).samples >= Math.floor(dusk.time * 15), 'at least 15 samples a second');
  assert.equal(dusk.ghost.physics, PHYSICS_VERSION);
});

test('a ghost is replaced only by a faster valid lap', async () => {
  const {held, backend} = memoryBackend();
  const store = new GhostStore(backend);
  const key = ghostKey('dusk');
  const lap = (time: number): Ghost => ({...dusk.ghost, time});
  assert.equal(await store.load(key), null);
  assert.equal(await store.submit(key, lap(100), true), true, 'the first valid lap becomes the ghost');
  assert.equal(await store.submit(key, lap(101), true), false, 'a slower lap does not');
  assert.equal(await store.submit(key, lap(100), true), false, 'nor an equal one');
  assert.equal(await store.submit(key, lap(90), false), false, 'nor a faster lap that cut the track');
  assert.equal(await store.submit(key, null, true), false, 'nor a lap too long to record');
  assert.equal((await store.load(key))!.time, 100);
  assert.equal(await store.submit(key, lap(99.5), true), true, 'a faster valid lap does');
  assert.equal(held.get(key)!.time, 99.5, 'and it is what the browser keeps');
  assert.equal((await new GhostStore(backend).load(key))!.time, 99.5, 'so it is there after a reload');
  assert.equal(
    await new GhostStore(backend).load(ghostKey('dusk', 'my-layout')),
    null,
    'each layout has its own ghost',
  );
  assert.equal(store.sessionOnly, false);
});

test('a ghost from an older PHYSICS_VERSION is not loaded', async () => {
  const {held, backend} = memoryBackend();
  const key = ghostKey('dusk');
  await new GhostStore(backend, PHYSICS_VERSION - 1).submit(key, {...dusk.ghost, physics: PHYSICS_VERSION - 1}, true);
  assert.equal(held.get(key)!.physics, PHYSICS_VERSION - 1);
  const store = new GhostStore(backend);
  assert.equal(await store.load(key), null);
  assert.equal(
    await store.submit(key, {...dusk.ghost, time: 500}, true),
    true,
    'any valid lap on this version replaces it',
  );
  assert.equal(held.get(key)!.physics, PHYSICS_VERSION);
  held.set(key, {physics: PHYSICS_VERSION, time: 50, data: new ArrayBuffer(12)});
  assert.equal(await new GhostStore(backend).load(key), null, 'damaged data is not loaded either');
});

test('if IndexedDB is unavailable, the ghost works for the session with a notice', async () => {
  const key = ghostKey('dusk');
  const none = new GhostStore(null);
  assert.equal(none.sessionOnly, true, 'no IndexedDB at all');
  assert.equal(await none.submit(key, dusk.ghost, true), true);
  assert.equal((await none.load(key))!.time, dusk.ghost.time, 'the ghost is there for the session');
  const broken: GhostBackend = {
    get: async () => {
      throw new Error('blocked');
    },
    put: async () => {
      throw new Error('quota');
    },
  };
  const failing = new GhostStore(broken);
  assert.equal(failing.sessionOnly, false);
  assert.equal(await failing.load(key), null);
  assert.equal(failing.sessionOnly, true, 'a failed read turns the notice on');
  assert.equal(await failing.submit(key, dusk.ghost, true), true);
  assert.equal((await failing.load(key))!.time, dusk.ghost.time);
  const {backend} = memoryBackend();
  const writeFails = new GhostStore({get: backend.get, put: broken.put});
  assert.equal(await writeFails.submit(key, dusk.ghost, true), true, 'a failed write still keeps the ghost');
  assert.equal(writeFails.sessionOnly, true);
  assert.equal((await writeFails.load(key))!.time, dusk.ghost.time);
});
