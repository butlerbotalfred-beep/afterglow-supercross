import test from 'node:test';
import assert from 'node:assert/strict';
import {Track} from '../src/track.ts';
import {TUNING} from '../src/config.ts';
import {makeRider, stepRider, npcControl, collide, idleControl, type Rider} from '../src/physics.ts';
import {createProgress, progressDistance} from '../src/race.ts';

const dt = 1 / 120;
const finiteRider = (rider: Rider) =>
  [rider.x, rider.y, rider.z, rider.speed, rider.heading, rider.pitch, rider.vy].every(Number.isFinite);

function runRace(difficulty: string, count: number) {
  const track = new Track();
  const riders = Array.from({length: count}, (_, id) => makeRider(track, id, false, 0xffffff));
  const finishTimes = new Map<number, number>();
  let launches = 0;
  let landings = 0;
  let recoveries = 0;
  for (let frame = 0; frame < 700 / dt; frame++) {
    for (const rider of riders) {
      const wasGrounded = rider.grounded;
      const wasRecovering = rider.recovery > 0;
      stepRider(rider, npcControl(rider, track, riders, difficulty), track, dt, riders);
      if (wasGrounded && !rider.grounded) launches++;
      if (rider.lastLanding > 0) landings++;
      if (!wasRecovering && rider.recovery > 0) recoveries++;
      assert.ok(finiteRider(rider), `${difficulty}: rider ${rider.id} became non-finite at frame ${frame}`);
      assert.ok(rider.speed >= 0 && rider.speed <= TUNING.maxSpeed, 'speed remains within physical limits');
      if (rider.progress.lap >= 3 && !finishTimes.has(rider.id)) finishTimes.set(rider.id, (frame + 1) * dt);
    }
    collide(riders, track);
    if (finishTimes.size === count) break;
  }
  return {track, riders, finishTimes, launches, landings, recoveries};
}

for (const [difficulty, count] of [
  ['standard', 8],
  ['relaxed', 2],
  ['expert', 2],
] as const) {
  test(`${count} ${difficulty} NPC riders complete three validated laps with collisions`, context => {
    const result = runRace(difficulty, count);
    const report = result.riders.map(rider => ({
      id: rider.id,
      lap: rider.progress.lap,
      gate: rider.progress.nextCheckpoint,
      routeBroken: rider.progress.routeBroken,
      distance: Math.round(progressDistance(rider.progress, result.track.length)),
      finishedAt: result.finishTimes.get(rider.id),
    }));
    assert.equal(
      result.finishTimes.size,
      count,
      `Unfinished race: ${JSON.stringify({recoveries: result.recoveries, report})}`,
    );
    context.diagnostic(
      `${difficulty}: all ${count} finished by ${Math.max(...result.finishTimes.values()).toFixed(2)}s; ${result.launches} launches, ${result.landings} landings, ${result.recoveries} recoveries`,
    );
    assert.ok(result.launches > count * 3, 'riders traverse the jumps on successive laps');
    assert.ok(result.landings > count * 3, 'riders land and continue racing');
    for (const rider of result.riders) {
      assert.ok(progressDistance(rider.progress, result.track.length) >= 3 * result.track.length);
      assert.ok(rider.bestAir > 0.1, `rider ${rider.id} must experience visible air time`);
    }
  });
}

test('grounded bike collisions separate riders and reduce speed; vertically separated bikes pass clear', () => {
  const track = new Track();
  const first = makeRider(track, 0, true, 0xffffff);
  const second = makeRider(track, 1, true, 0xffffff);
  Object.assign(first, {x: 0, z: 0, y: 0.08, speed: 16});
  Object.assign(second, {x: 0.4, z: 0, y: 0.08, speed: 16});
  collide([first, second], track);
  assert.ok(Math.abs(Math.hypot(first.x - second.x, first.z - second.z) - 0.85) < 1e-8);
  assert.ok(Math.abs((first.x + second.x) / 2 - 0.2) < 1e-8, 'collision preserves the pair midpoint');
  assert.ok(first.speed < 16 && second.speed < 16);
  Object.assign(first, {x: 0, z: 0, y: 2, speed: 16});
  Object.assign(second, {x: 0.4, z: 0, y: 0.08, speed: 16});
  collide([first, second], track);
  assert.equal(first.x, 0);
  assert.equal(second.x, 0.4);
  assert.equal(first.speed, 16);
  assert.equal(second.speed, 16);
});

test('tabletop momentum produces horizontal airborne travel, then a grounded landing', () => {
  const track = new Track();
  const rider = makeRider(track, 0, true, 0xffffff);
  const start = track.at(8);
  Object.assign(rider, {
    x: start.x,
    z: start.z,
    y: track.height(8),
    surface: start,
    heading: Math.atan2(start.tx, start.tz),
    speed: 24,
    progress: createProgress(),
  });
  let launch: {x: number; z: number} | null = null;
  let airborneFrames = 0;
  let maxClearance = 0;
  let landed = false;
  for (let frame = 0; frame < 8 / dt; frame++) {
    stepRider(rider, npcControl(rider, track, [rider], 'expert'), track, dt, [rider]);
    assert.ok(finiteRider(rider));
    if (!rider.grounded) {
      launch ??= {x: rider.x, z: rider.z};
      airborneFrames++;
      maxClearance = Math.max(maxClearance, rider.y - track.height(rider.surface.s, rider.surface.lateral));
    }
    if (launch && rider.lastLanding > 0) {
      landed = true;
      break;
    }
  }
  assert.ok(launch, 'the rising ramp should launch the bike');
  assert.ok(airborneFrames * dt > 0.15, 'air time persists across multiple simulation steps');
  assert.ok(maxClearance > 0.2, 'the bike visibly clears the track surface');
  assert.ok(landed && rider.grounded, 'gravity returns the rider to the track');
  assert.ok(Math.hypot(rider.x - launch.x, rider.z - launch.z) > 3, 'forward momentum continues in flight');
  assert.ok(rider.compression > 0 && rider.lastLanding > 0, 'landing produces suspension compression');
  assert.ok(rider.speed > 0, 'rider can continue after landing');
  assert.ok(Math.abs(rider.y - track.height(rider.surface.s, rider.surface.lateral)) < 1e-8);
});

test('recovery remounts locally, avoids an occupied lane, and preserves earned progress', () => {
  const track = new Track();
  const rider = makeRider(track, 0, true, 0xffffff);
  for (let frame = 0; frame < 18 / dt; frame++)
    stepRider(rider, npcControl(rider, track, [rider], 'standard'), track, dt, [rider]);
  assert.ok(rider.progress.nextCheckpoint > 1, 'rider has earned checkpoint credit before recovery');
  const oldLap = rider.progress.lap;
  const oldNext = rider.progress.nextCheckpoint;
  const safeS = rider.surface.s;
  const credit = progressDistance(rider.progress, track.length);
  const blocker = makeRider(track, 1, false, 0xffffff);
  const occupied = track.at(safeS, rider.surface.lateral);
  Object.assign(blocker, {x: occupied.x, z: occupied.z, y: track.height(safeS), surface: occupied});
  stepRider(rider, {...idleControl(), reset: true}, track, dt, [rider, blocker]);
  assert.equal(rider.progress.lap, oldLap);
  assert.equal(rider.progress.nextCheckpoint, oldNext);
  assert.equal(rider.progress.routeBroken, false);
  assert.ok(Math.abs(progressDistance(rider.progress, track.length) - credit) < 1e-6);
  assert.ok(Math.abs(rider.surface.s - safeS) < 1e-8);
  assert.ok(
    Math.hypot(rider.x - blocker.x, rider.z - blocker.z) >= 1.65,
    'recovery chooses an unoccupied lateral slot',
  );
  assert.equal(rider.speed, 0);
  assert.equal(rider.vy, 0);
  assert.equal(rider.grounded, true);
  assert.ok(rider.recovery > 0);
  const position = [rider.x, rider.y, rider.z];
  stepRider(rider, {...idleControl(), throttle: 1}, track, dt, [rider, blocker]);
  assert.deepEqual([rider.x, rider.y, rider.z], position, 'recovery delay cannot award free movement');
  for (let frame = 0; frame < 4 / dt; frame++)
    stepRider(rider, npcControl(rider, track, [rider], 'standard'), track, dt, [rider]);
  assert.ok(finiteRider(rider));
  assert.ok(
    progressDistance(rider.progress, track.length) > oldLap * track.length + safeS,
    'rider resumes earning validated progress',
  );
});
