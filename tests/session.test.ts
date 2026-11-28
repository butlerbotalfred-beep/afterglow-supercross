import test from 'node:test';
import assert from 'node:assert/strict';
import {TUNING} from '../src/config.ts';
import type {Control, Device} from '../src/input.ts';
import {idleControl, npcControl} from '../src/physics.ts';
import {Track} from '../src/track.ts';
import {gridFor} from '../src/riders.ts';
import {COUNTDOWN_SECONDS, devicesReady, RaceSession} from '../src/game/race-session.ts';

const track = new Track();
const STEP = TUNING.step;
const key = (d: Device) => (d.kind === 'gamepad' ? `pad-${d.index}` : d.kind);
const pad = (index: number): Device => ({kind: 'gamepad', index});

/** A session with a fake input and a screen that records what it was told. */
function harness() {
  const log: string[] = [];
  const pads = new Set<number>();
  /** Riders on autopilot, by device. Everyone else holds still. */
  const autopilot = new Set<string>();
  const held = new Map<string, Partial<Control>>();
  const session: RaceSession = new RaceSession(
    {
      sample(device) {
        const rider = session.riders.find(r => r.device && key(r.device) === key(device))!;
        const base = autopilot.has(key(device)) ? npcControl(rider, track, session.riders, 'expert') : idleControl();
        return {...base, ...held.get(key(device))};
      },
      connectedGamepads: () => [...pads].map(index => ({index})),
    },
    {
      countdown: n => log.push(`count ${n}`),
      racing: () => log.push('racing'),
      cue: frequency => log.push(`cue ${frequency}`),
      landing: () => {},
      pause: (paused, missing) => log.push(`pause ${paused}${missing ? ` missing ${missing.id}` : ''}`),
      results: () => log.push('results'),
    },
  );
  const begin = (options: {humans?: Device[]; npcs?: number; practice?: boolean; laps?: number} = {}) => {
    const humans = options.humans || [{kind: 'keyboard'}];
    for (const d of humans) if (d.kind === 'gamepad') pads.add(d.index);
    session.grid({
      track,
      humanCount: humans.length,
      npcCount: options.npcs ?? 0,
      practice: options.practice ?? false,
      assignments: humans,
    });
    session.start({lapCount: options.laps ?? 1, difficulty: 'club'});
  };
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds / STEP); i++) session.step(STEP);
  };
  /** Steps until the check passes; fails the test if it never does. */
  const runUntil = (check: () => boolean, limitSeconds = 240) => {
    for (let i = 0; i < limitSeconds / STEP; i++) {
      if (check()) return;
      session.step(STEP);
    }
    assert.fail(`condition not reached within ${limitSeconds} s of race time`);
  };
  const toRacing = () => runUntil(() => session.phase === 'racing', 9);
  return {session, log, pads, autopilot, held, begin, run, runUntil, toRacing};
}

test('a new session waits in setup and stepping it does nothing', () => {
  const {session, log, run} = harness();
  assert.equal(session.phase, 'setup');
  run(1);
  assert.equal(session.phase, 'setup');
  assert.equal(session.raceTime, 0);
  assert.deepEqual(log, []);
});

test('the grid puts humans first, then named NPCs, and practice has no NPCs', () => {
  const {session} = harness();
  session.grid({track, humanCount: 2, npcCount: 3, practice: false, assignments: [{kind: 'keyboard'}, pad(0)]});
  assert.deepEqual(
    session.riders.map(r => r.human),
    [true, true, false, false, false],
  );
  assert.deepEqual(session.riders[1].device, pad(0));
  assert.deepEqual(
    session.riders
      .slice(2)
      .map(r => r.name)
      .sort(),
    gridFor('club', 3)
      .map(p => p.name)
      .sort(),
  );
  session.grid({track, humanCount: 1, npcCount: 5, practice: true, assignments: [{kind: 'keyboard'}]});
  assert.equal(session.riders.length, 1);
  assert.equal(session.practice, true);
});

test('a race needs one device per human and no device shared', () => {
  assert.equal(devicesReady([{kind: 'keyboard'}, null, null, null], 1), true);
  assert.equal(devicesReady([{kind: 'keyboard'}, null, null, null], 2), false);
  assert.equal(devicesReady([pad(1), pad(1), null, null], 2), false);
  assert.equal(devicesReady([pad(1), pad(2), null, null], 2), true);
  // A device left in a hidden slot does not count.
  assert.equal(devicesReady([{kind: 'keyboard'}, {kind: 'keyboard'}, null, null], 1), true);
});

test('Free Practice counts down 3.8 seconds, beeps on 3, 2 and 1, then starts', () => {
  const {session, log, begin, run} = harness();
  begin({practice: true});
  assert.equal(session.phase, 'countdown');
  run(COUNTDOWN_SECONDS - 0.05);
  assert.equal(session.phase, 'countdown');
  assert.equal(session.raceTime, 0, 'the race clock does not run during the countdown');
  assert.equal(session.riders[0].speed, 0, 'riders hold still until the gate drops');
  run(0.1);
  assert.equal(session.phase, 'racing');
  assert.deepEqual([...new Set(log.filter(l => l.startsWith('count')))], ['count 4', 'count 3', 'count 2', 'count 1']);
  assert.deepEqual(
    log.filter(l => !l.startsWith('count')),
    ['cue 600', 'cue 600', 'cue 600', 'cue 1100', 'racing'],
  );
});

test('a race runs from setup through countdown and racing to results', () => {
  const {session, log, autopilot, begin, run, runUntil} = harness();
  autopilot.add('keyboard');
  begin({npcs: 2, laps: 1});
  runUntil(() => session.phase === 'results');
  const human = session.riders[0];
  assert.equal(human.progress.lap, 1);
  assert.equal(human.finished, session.raceTime);
  assert.equal(human.dnf, false);
  assert.equal(log.filter(l => l === 'results').length, 1);
  assert.ok(log.indexOf('racing') < log.indexOf('results'));
  // Results are final: more time changes nothing.
  const time = session.raceTime;
  run(2);
  assert.equal(session.raceTime, time);
  assert.equal(log.filter(l => l === 'results').length, 1);
});

test('the race ends when the humans finish; NPCs still out are classified as not finished', () => {
  const {session, autopilot, begin, runUntil} = harness();
  autopilot.add('keyboard');
  begin({npcs: 1, laps: 1});
  runUntil(() => session.phase === 'racing');
  // Hold the NPC back so the human is certain to finish first.
  const npc = session.riders[1];
  runUntil(() => {
    npc.speed = 0;
    return session.phase === 'results';
  });
  assert.equal(npc.finished, null);
  assert.equal(npc.dnf, true);
  assert.equal(session.riders[0].dnf, false);
});

test('pause freezes the race and resume carries on from the same moment', () => {
  const {session, log, autopilot, begin, run, toRacing} = harness();
  autopilot.add('keyboard');
  begin();
  toRacing();
  run(2);
  session.togglePause();
  assert.equal(session.paused, true);
  const frozen = {time: session.raceTime, x: session.riders[0].x, z: session.riders[0].z};
  run(3);
  assert.equal(session.advance(0.5), 0, 'the frame clock runs no steps while paused');
  assert.deepEqual({time: session.raceTime, x: session.riders[0].x, z: session.riders[0].z}, frozen);
  session.togglePause();
  assert.equal(session.paused, false);
  run(1);
  assert.ok(session.raceTime > frozen.time);
  assert.deepEqual(
    log.filter(l => l.startsWith('pause')),
    ['pause true', 'pause false'],
  );
});

test("a rider's pause button pauses in the countdown and in the race", () => {
  const {session, held, begin, run, toRacing} = harness();
  begin();
  run(1);
  held.set('keyboard', {pause: true});
  run(STEP);
  assert.equal(session.paused, true);
  assert.equal(session.phase, 'countdown');
  const left = session.countdown;
  run(1);
  assert.equal(session.countdown, left, 'the countdown waits while paused');
  held.clear();
  session.togglePause();
  toRacing();
  held.set('keyboard', {pause: true});
  run(STEP);
  assert.equal(session.paused, true);
  assert.equal(session.phase, 'racing');
});

test('pause does nothing in setup or on the results screen', () => {
  const {session, log, autopilot, begin, runUntil} = harness();
  session.togglePause();
  assert.equal(session.paused, false);
  autopilot.add('keyboard');
  begin();
  runUntil(() => session.phase === 'results');
  session.togglePause();
  assert.equal(session.paused, false);
  assert.deepEqual(
    log.filter(l => l.startsWith('pause')),
    [],
  );
});

test('restart puts everyone back on the grid with a fresh countdown, even from pause', () => {
  const {session, autopilot, begin, run, toRacing} = harness();
  autopilot.add('keyboard');
  begin({npcs: 3});
  const grid = session.riders.map(r => [r.x, r.z]);
  toRacing();
  run(5);
  session.togglePause();
  begin({npcs: 3});
  assert.equal(session.phase, 'countdown');
  assert.equal(session.paused, false);
  assert.equal(session.raceTime, 0);
  assert.equal(session.countdown, COUNTDOWN_SECONDS);
  assert.equal(session.firstFinish, null);
  assert.deepEqual(
    session.riders.map(r => [r.x, r.z]),
    grid,
  );
  assert.ok(session.riders.every(r => r.speed === 0 && r.progress.lap === 0 && r.finished === null));
});

test('back to setup leaves the race and clears the pause', () => {
  const {session, begin, run, toRacing} = harness();
  begin();
  toRacing();
  session.togglePause();
  session.toSetup();
  assert.equal(session.phase, 'setup');
  assert.equal(session.paused, false);
  const time = session.raceTime;
  run(1);
  assert.equal(session.raceTime, time);
});

test('a controller that disconnects pauses the race until it is back', () => {
  const {session, log, pads, begin, run, toRacing} = harness();
  begin({humans: [{kind: 'keyboard'}, pad(4)]});
  toRacing();
  session.checkControllers();
  assert.equal(session.paused, false, 'no pause while every controller is connected');
  pads.delete(4);
  assert.equal(session.missingController(), session.riders[1]);
  session.checkControllers();
  assert.equal(session.paused, true);
  assert.equal(log.at(-1), 'pause true missing 1');
  session.checkControllers();
  assert.equal(log.filter(l => l.startsWith('pause')).length, 1, 'a second check does not toggle the pause again');
  const time = session.raceTime;
  session.togglePause();
  assert.equal(session.paused, true, 'cannot resume while the controller is missing');
  run(1);
  assert.equal(session.raceTime, time);
  pads.add(4);
  session.togglePause();
  assert.equal(session.paused, false);
  assert.equal(log.at(-1), 'pause false');
});

test('a disconnect also pauses the countdown, and keyboard or touch riders are never missing', () => {
  const {session, pads, begin, run} = harness();
  begin({humans: [{kind: 'keyboard'}]});
  session.checkControllers();
  assert.equal(session.missingController(), undefined);
  assert.equal(session.paused, false);
  begin({humans: [{kind: 'touch'}, pad(2)]});
  run(1);
  pads.clear();
  session.checkControllers();
  assert.equal(session.phase, 'countdown');
  assert.equal(session.paused, true);
  assert.equal(session.missingController()?.id, 1);
});

test('after the first human finishes, the rest get 60 seconds before the race is called', () => {
  const {session, autopilot, begin, run, runUntil} = harness();
  autopilot.add('keyboard');
  begin({humans: [{kind: 'keyboard'}, pad(0)], laps: 1});
  runUntil(() => session.firstFinish !== null);
  assert.equal(session.riders[0].finished, session.firstFinish);
  assert.equal(session.phase, 'racing', 'the race stays open for the second human');
  run(TUNING.finishTimeout - 0.5);
  assert.equal(session.phase, 'racing');
  run(1);
  assert.equal(session.phase, 'results');
  assert.ok(Math.abs(session.raceTime - session.firstFinish! - TUNING.finishTimeout) < 0.02);
  assert.equal(session.riders[1].finished, null);
  assert.equal(session.riders[1].dnf, true);
  assert.equal(session.riders[0].dnf, false);
});

test('practice never ends, however many laps are ridden', () => {
  const {session, log, autopilot, begin, runUntil} = harness();
  autopilot.add('keyboard');
  begin({practice: true, laps: 1, npcs: 4});
  assert.equal(session.riders.length, 1);
  runUntil(() => session.riders[0].progress.lap >= 2);
  assert.equal(session.phase, 'racing');
  assert.equal(session.riders[0].finished, null);
  assert.equal(session.firstFinish, null);
  assert.ok(!log.includes('results'));
});

test('the frame clock runs fixed 120 Hz steps and carries the remainder forward', () => {
  const {session, begin} = harness();
  begin({practice: true});
  let before = 0;
  const count = () => before++;
  assert.equal(session.advance(1 / 60 + 0.001, count), 2);
  assert.equal(before, 2, 'the callback runs before every step');
  assert.ok(Math.abs(session.accumulator - 0.001) < 1e-9);
  assert.equal(session.advance(0.004, count), 0);
  assert.equal(session.advance(0.004, count), 1);
  assert.ok(Math.abs(session.countdown - (COUNTDOWN_SECONDS - 3 * STEP)) < 1e-9);
  session.start({lapCount: 1, difficulty: 'club'});
  assert.equal(session.accumulator, 0, 'a restart drops leftover frame time');
});

test('the same inputs give exactly the same race', () => {
  const race = () => {
    const {session, autopilot, begin, run} = harness();
    autopilot.add('keyboard');
    begin({npcs: 3, laps: 1});
    run(20);
    return session.riders.map(r => [r.x, r.y, r.z, r.speed, r.heading, r.progress.lap]);
  };
  assert.deepEqual(race(), race());
});
