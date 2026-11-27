import test from 'node:test';
import assert from 'node:assert/strict';
import {TUNING} from '../src/config.ts';
import {GhostPlayback, type Ghost, type GhostPose} from '../src/ghost.ts';
import {idleControl, npcControl} from '../src/physics.ts';
import {currentLapTime, type LapTime} from '../src/timing.ts';
import {Track} from '../src/track.ts';
import {RaceSession} from '../src/game/race-session.ts';

const track = new Track();
const STEP = TUNING.step;

/** One rider on the keyboard, ridden by the computer's hands unless `idle`. */
function harness(mode: 'trial' | 'practice' | 'race') {
  const log: string[] = [];
  const ghosts: {lap: LapTime; ghost: Ghost | null}[] = [];
  let idle = false;
  let pausing = false;
  const session: RaceSession = new RaceSession(
    {
      sample: () => {
        const control = idle ? idleControl() : npcControl(session.riders[0], track, session.riders, 'expert');
        if (pausing) control.pause = true;
        pausing = false;
        return control;
      },
      connectedGamepads: () => [],
    },
    {
      countdown: () => {},
      racing: () => log.push('racing'),
      cue: () => {},
      landing: () => {},
      pause: paused => log.push(`pause ${paused}`),
      results: () => log.push('results'),
      ghostLap: (_rider, lap, ghost) => ghosts.push({lap, ghost}),
      restarted: () => log.push('restarted'),
    },
  );
  session.grid({
    track,
    humanCount: mode === 'trial' ? 3 : 1,
    npcCount: 5,
    practice: mode === 'practice',
    trial: mode === 'trial',
    assignments: [{kind: 'keyboard'}, {kind: 'gamepad', index: 0}, {kind: 'gamepad', index: 1}],
  });
  session.start({lapCount: 1, difficulty: 'club', seed: 7});
  const runUntil = (check: () => boolean, each?: () => void, limitSeconds = 320) => {
    for (let i = 0; i < limitSeconds / STEP; i++) {
      if (check()) return;
      session.step(STEP);
      each?.();
    }
    assert.fail('condition not reached');
  };
  runUntil(() => session.phase === 'racing');
  /** Presses the pause button for one step, as Esc, P or Start does, then resumes. */
  const pauseAndResume = () => {
    pausing = true;
    session.step(STEP);
    assert.equal(session.paused, true);
    for (let i = 0; i < 30; i++) session.step(STEP);
    session.togglePause();
    assert.equal(session.paused, false);
  };
  return {session, log, ghosts, runUntil, pauseAndResume, setIdle: (value: boolean) => (idle = value)};
}
const pose = (r: GhostPose) => [r.x, r.y, r.z, r.heading, r.pitch, r.lean];

test('Time Trial has no AI riders and no results screen until the player leaves', () => {
  const {session, log, ghosts, runUntil} = harness('trial');
  assert.equal(session.riders.length, 1, 'one rider, whatever the setup screen asked for');
  assert.equal(session.riders[0].human, true);
  assert.equal(session.trial, true);
  runUntil(() => session.riders[0].progress.lap >= 2);
  assert.equal(session.phase, 'racing', 'laps are unlimited');
  assert.equal(session.riders[0].finished, null);
  assert.ok(!log.includes('results'));
  assert.equal(ghosts.length, 2, 'every lap is offered as a ghost');
  assert.equal(session.timing[0].laps.length, 2);
  assert.equal(session.leaveTrial(), true);
  assert.equal(session.phase, 'results');
  assert.equal(log.filter(entry => entry === 'results').length, 1);
  assert.equal(session.leaveTrial(), false, 'only once');
  const race = harness('race');
  assert.equal(race.session.riders.length, 6);
  assert.equal(race.session.leaveTrial(), false, 'a race cannot be left this way');
  assert.equal(race.session.restartLap(), false, 'and has no lap restart');
  assert.equal(race.ghosts.length, 0);
});

test("the rider's path is identical with the ghost on and off", () => {
  // Free Practice records and plays nothing. Time Trial records every lap and, from the second lap, plays the
  // first one back each step the way the game draws it. The ride must not differ by a single bit.
  const off = harness('practice');
  const on = harness('trial');
  let playback: GhostPlayback | null = null;
  let played = 0;
  for (let step = 0; step < 215 / STEP; step++) {
    off.session.step(STEP);
    on.session.step(STEP);
    if (!playback && on.ghosts[0]?.ghost) playback = new GhostPlayback(on.ghosts[0].ghost);
    if (playback) {
      playback.at(currentLapTime(on.session.timing[0], on.session.raceTime));
      played++;
    }
    assert.deepEqual(pose(on.session.riders[0]), pose(off.session.riders[0]), `step ${step}`);
    assert.equal(on.session.riders[0].speed, off.session.riders[0].speed);
  }
  assert.ok(played > 60 / STEP, 'the ghost was playing for most of a lap');
  assert.ok(on.session.riders[0].progress.lap >= 2);
  assert.deepEqual(
    on.session.timing[0].laps.map(lap => lap.time),
    off.session.timing[0].laps.map(lap => lap.time),
  );
  assert.equal(off.ghosts.length, 0, 'practice records no ghost');
});

test('each Time Trial lap comes back as a ghost of exactly that lap', () => {
  const {session, ghosts, runUntil} = harness('trial');
  const ride: {lapTime: number; x: number; y: number; z: number}[][] = [[], []];
  runUntil(
    () => ghosts.length >= 2,
    () => {
      const lap = session.timing[0].laps.length;
      // The step that crosses the line belongs to the lap it finishes; ghosts[lap] is set after it.
      const r = session.riders[0];
      if (lap < 2)
        ride[lap].push({lapTime: currentLapTime(session.timing[0], session.raceTime), x: r.x, y: r.y, z: r.z});
    },
  );
  ghosts.forEach(({lap, ghost}, n) => {
    assert.ok(ghost, `lap ${n + 1} was recorded`);
    assert.equal(ghost!.time, lap.time);
    assert.ok(ghost!.data.byteLength <= 40 * 1024, `${ghost!.data.byteLength} bytes`);
    const playback = new GhostPlayback(ghost!);
    let worst = 0;
    for (const at of ride[n]) {
      const g = playback.at(at.lapTime);
      worst = Math.max(worst, Math.hypot(g.x - at.x, g.y - at.y, g.z - at.z));
    }
    assert.ok(ride[n].length > 60 / STEP);
    assert.ok(worst <= 0.1, `lap ${n + 1}: the ghost is ${worst.toFixed(3)} m from the ride at worst`);
  });
  assert.ok(ghosts[1].lap.time < ghosts[0].lap.time, 'the flying lap beats the standing start');
});

test('restart lap puts the rider back on the line and starts the clock again', () => {
  const {session, log, ghosts, runUntil, setIdle} = harness('trial');
  const start = pose(session.riders[0]);
  runUntil(() => session.riders[0].progress.lap >= 1);
  const firstLap = session.timing[0].laps[0];
  runUntil(() => currentLapTime(session.timing[0], session.raceTime) > 20);
  session.riders[0].crashes = 3;
  session.togglePause();
  assert.equal(session.restartLap(), false, 'not while paused');
  session.togglePause();
  setIdle(true);
  assert.equal(session.restartLap(), true);
  assert.ok(log.includes('restarted'));
  const r = session.riders[0];
  assert.deepEqual(pose(r), start, 'back on the start line');
  assert.equal(r.speed, 0);
  assert.equal(r.progress.lap, 0);
  assert.equal(r.crashes, 3, 'the crash count is kept');
  assert.equal(r.device!.kind, 'keyboard');
  assert.equal(currentLapTime(session.timing[0], session.raceTime), 0);
  assert.deepEqual(session.timing[0].laps, [firstLap], 'laps already ridden are kept');
  assert.equal(session.timing[0].best, firstLap);
  assert.equal(session.phase, 'racing', 'no countdown');
  setIdle(false);
  const restartedAt = session.raceTime;
  runUntil(() => session.timing[0].laps.length >= 2);
  const lap = session.timing[0].laps[1];
  assert.ok(Math.abs(lap.time - (session.raceTime - restartedAt)) < STEP + 1e-9, 'timed from the restart');
  assert.equal(lap.valid, true);
  assert.ok(
    Math.abs(lap.time - firstLap.time) < 0.5,
    `a standing-start lap like the first: ${lap.time} against ${firstLap.time}`,
  );
  assert.equal(ghosts.at(-1)!.ghost!.time, lap.time, 'and its ghost starts at the restart too');
  const playback = new GhostPlayback(ghosts.at(-1)!.ghost!);
  const first = playback.at(0);
  assert.ok(Math.hypot(first.x - start[0], first.z - start[2]) < 0.05, 'the ghost begins on the start line');
});

test('pausing in the middle of a lap does not move the ghost off the ride', () => {
  const {session, ghosts, runUntil, pauseAndResume} = harness('trial');
  const ride: {lapTime: number; x: number; y: number; z: number}[] = [];
  const note = () => {
    const r = session.riders[0];
    if (session.timing[0].laps.length === 1)
      ride.push({lapTime: currentLapTime(session.timing[0], session.raceTime), x: r.x, y: r.y, z: r.z});
  };
  runUntil(() => session.timing[0].laps.length === 1);
  for (const seconds of [8, 30, 31]) {
    runUntil(() => currentLapTime(session.timing[0], session.raceTime) > seconds, note);
    assert.ok(session.riders[0].speed > 5, 'paused while moving');
    pauseAndResume();
    note();
  }
  runUntil(() => ghosts.length >= 2, note);
  const {lap, ghost} = ghosts[1];
  assert.ok(ghost);
  assert.equal(ghost!.time, lap.time);
  const playback = new GhostPlayback(ghost!);
  let worst = 0;
  for (const at of ride) {
    const g = playback.at(at.lapTime);
    worst = Math.max(worst, Math.hypot(g.x - at.x, g.y - at.y, g.z - at.z));
  }
  assert.ok(worst <= 0.1, `the ghost is ${worst.toFixed(3)} m from the ride at worst after three pauses`);
});

test("a flying lap's ghost is already moving at the start of its lap", () => {
  const {ghosts, runUntil} = harness('trial');
  runUntil(() => ghosts.length >= 2);
  const playback = new GhostPlayback(ghosts[1].ghost!);
  const a = {...playback.at(0)},
    b = {...playback.at(STEP / 4)},
    c = {...playback.at(STEP)};
  const moved = (p: GhostPose, q: GhostPose) => Math.hypot(q.x - p.x, q.z - p.z);
  assert.ok(moved(a, b) > 0.02, `it moves ${moved(a, b).toFixed(3)} m in the first quarter step`);
  assert.ok(Math.abs(moved(a, c) / STEP - moved(a, b) / (STEP / 4)) < 3, 'at a steady speed across the line');
});
