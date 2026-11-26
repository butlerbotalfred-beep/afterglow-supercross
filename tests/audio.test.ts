import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {TUNING} from '../src/config';
import {
  DEFAULT_VOLUMES,
  FINISH_TAIL,
  GameAudio,
  normalizeVolumes,
  type SoundFrame,
  type SoundRider,
} from '../src/audio';
import {BIG_AIR, see, soundEvents} from '../src/audio/events';
import {channelGains, place, placeFor, voicedRiders, type Listener} from '../src/audio/placement';
import {GEAR_TOPS, gearFor, gearRevs, nextGear, onLimiter, revsToHz, shiftSpeed} from '../src/audio/revs';
import * as synth from '../src/audio/synth';
import {SaveStore, SAVE_KEY} from '../src/save';
import {FakeAudioContext} from './fake-audio';

const rider = (over: Partial<SoundRider> = {}): SoundRider => ({
  human: false,
  x: 0,
  z: 0,
  speed: 20,
  throttle: 0.6,
  grounded: true,
  airTime: 0,
  crashes: 0,
  finished: null,
  progress: {lap: 0},
  powerSlide: 0,
  slipAngle: 0,
  ...over,
});
/** A camera 4 m behind a bike at the origin, looking along +z. */
const EAR: Listener = {x: 0, z: -4, yaw: 0};
function frame(riders: SoundRider[], over: Partial<SoundFrame> = {}): SoundFrame {
  return {
    phase: 'racing',
    paused: false,
    practice: false,
    riders,
    positions: riders.map((_, i) => i + 1),
    ears: [EAR],
    dt: 1 / 60,
    ...over,
  };
}
function started() {
  const context = new FakeAudioContext(),
    audio = new GameAudio(() => context as unknown as AudioContext);
  audio.start();
  return {audio, context};
}
/** Runs frames, moving the stand-in clock on with them. */
function run(audio: GameAudio, context: FakeAudioContext, f: SoundFrame, seconds: number) {
  for (let t = 0; t < seconds; t += f.dt) {
    context.currentTime += f.dt;
    audio.frame(f);
  }
}
const voiceOf = (audio: GameAudio, index: number) => audio.voices.find(v => v.rider === index)!;

// C1
test('revs rise steadily within a gear and drop at each shift speed', () => {
  let gear = 0,
    last = gearRevs(0, 0, 1),
    shifts = 0;
  for (let speed = 0; speed <= TUNING.maxSpeed; speed += 0.01) {
    const next = nextGear(gear, speed),
      revs = gearRevs(next, speed, 1);
    if (next !== gear) {
      // The shift happens at the gear's shift speed, from the red line, and the revs fall.
      assert.ok(Math.abs(speed - shiftSpeed(gear)) < 0.02, `gear ${gear + 1} shifts at ${speed}`);
      assert.ok(last > 0.99, 'the gear was run to the red line');
      assert.ok(revs < last - 0.15, `revs drop at the shift into gear ${next + 1}: ${last} to ${revs}`);
      assert.equal(next, gear + 1);
      shifts++;
    } else assert.ok(revs >= last - 1e-9, `revs never fall within gear ${gear + 1}`);
    gear = next;
    last = revs;
  }
  assert.equal(shifts, 4, 'five gears means four shifts');
  assert.equal(gear, GEAR_TOPS.length - 1);
  assert.ok(onLimiter(gearRevs(4, TUNING.maxSpeed, 1)), 'top speed is on the limiter');
});
test('within a gear the revs rise in a straight line, and the note rises with them', () => {
  for (let gear = 1; gear < 5; gear++) {
    const low = shiftSpeed(gear - 1) + 0.01,
      high = shiftSpeed(gear),
      mid = (low + high) / 2;
    const [a, b, c] = [low, mid, high].map(speed => gearRevs(gear, speed));
    assert.ok(Math.abs(b - (a + c) / 2) < 1e-9, `gear ${gear + 1} is a straight line`);
    assert.ok(revsToHz(c) > revsToHz(a));
  }
});
test('the gearbox does not hunt at a shift speed, and slowing shifts back down', () => {
  const at = shiftSpeed(1);
  let gear = nextGear(1, at + 0.2);
  assert.equal(gear, 2);
  for (const wobble of [-0.3, 0.3, -0.5, 0.1]) gear = nextGear(gear, at + wobble);
  assert.equal(gear, 2, 'small changes around the shift speed hold the gear');
  assert.equal(nextGear(gear, at * 0.8), 1);
  assert.equal(nextGear(4, 0), 0, 'a stopped bike is back in first');
  assert.equal(gearFor(0), 0);
  assert.equal(gearFor(TUNING.maxSpeed + 5), 4);
});
test('an open throttle lifts the revs off idle before the bike moves', () => {
  assert.ok(gearRevs(0, 0, 1) > gearRevs(0, 0, 0) + 0.2);
  assert.equal(gearRevs(2, 0, 1), gearRevs(2, 0, 0), 'only first gear slips the clutch');
});

// C4
test('a bike to the left of the camera is louder in the left channel, and the reverse', () => {
  for (const yaw of [0, 0.7, Math.PI / 2, Math.PI, -2.1]) {
    const ear: Listener = {x: 10, z: -5, yaw},
      ahead = {x: Math.sin(yaw), z: Math.cos(yaw)},
      // The camera's right, for a camera looking along `ahead` with the sky above.
      right = {x: -Math.cos(yaw), z: Math.sin(yaw)};
    const at = (side: number) => ({x: ear.x + ahead.x * 8 + right.x * side, z: ear.z + ahead.z * 8 + right.z * side});
    const left = channelGains(placeFor(at(-6), ear).pan),
      onRight = channelGains(placeFor(at(6), ear).pan),
      centre = placeFor(at(0), ear);
    assert.ok(left.left > left.right * 1.3, `left of a camera turned ${yaw} is louder on the left`);
    assert.ok(onRight.right > onRight.left * 1.3, `right of a camera turned ${yaw} is louder on the right`);
    assert.ok(Math.abs(centre.pan) < 1e-9, 'straight ahead is in the middle');
  }
});
test('the camera right matches the picture: a camera looking along -z has +x on its right', () => {
  // three.js cameras look along -z with +x to the right, which is a yaw of pi here.
  assert.ok(placeFor({x: 5, z: -10}, {x: 0, z: 0, yaw: Math.PI}).pan > 0.3);
  assert.ok(placeFor({x: -5, z: -10}, {x: 0, z: 0, yaw: Math.PI}).pan < -0.3);
});
test('the engine voice of a bike on the left is balanced to the left, and farther bikes are quieter', () => {
  const {audio, context} = started();
  // With the camera looking along +z, its right is -x.
  const riders = [rider({human: true}), rider({x: 6, z: 4}), rider({x: -6, z: 4}), rider({x: 0, z: 40})];
  run(audio, context, frame(riders), 0.5);
  assert.ok(voiceOf(audio, 1).balance < -0.3, 'a bike at +x is on the left');
  assert.ok(voiceOf(audio, 2).balance > 0.3, 'a bike at -x is on the right');
  assert.ok(Math.abs(voiceOf(audio, 0).balance) < 0.01, "the rider's own bike is in the middle");
  assert.ok(voiceOf(audio, 3).loudness < voiceOf(audio, 1).loudness / 4, 'a bike 44 m away is much quieter');
});
test('each bike is heard from the camera nearest to it', () => {
  const ears: Listener[] = [
    {x: 0, z: 0, yaw: 0},
    {x: 100, z: 0, yaw: 0},
  ];
  // Left of the far camera, which is the nearer one.
  const heard = place({x: 104, z: 6}, ears);
  assert.ok(heard.distance < 8);
  assert.ok(heard.pan < -0.2);
  assert.equal(place({x: 0, z: 0}, []).gain, 0, 'no camera means silence');
});

// C2
test('with 8 riders the four nearest non-human bikes are voiced, on no more than 24 oscillators', () => {
  const {audio, context} = started();
  const distances = [0, 30, 6, 50, 12, 9, 80, 20];
  const riders = distances.map((z, i) => rider({human: i === 0, z, x: i === 0 ? 0 : 2}));
  run(audio, context, frame(riders), 0.3);
  assert.deepEqual(audio.voices.map(v => v.rider).sort(), [0, 2, 4, 5, 7]);
  assert.equal(audio.oscillators, 15);
  assert.equal(context.oscillators, 15);
  // The pack reshuffles: the voices move to whoever is nearest now, and none are added.
  riders[6].z = 3;
  riders[2].z = 90;
  run(audio, context, frame(riders), 0.3);
  assert.deepEqual(audio.voices.map(v => v.rider).sort(), [0, 4, 5, 6, 7]);
  assert.equal(context.oscillators, 15);
  assert.deepEqual(voicedRiders(riders, [EAR]).others.sort(), [4, 5, 6, 7]);
});
test('four humans and four others use exactly 24 oscillators, also across a new race and a smaller grid', () => {
  const {audio, context} = started();
  let peak = 0;
  const go = (riders: SoundRider[], seconds: number, over: Partial<SoundFrame> = {}) => {
    const f = frame(riders, {
      ears: riders.filter(r => r.human).map((r, i) => ({x: r.x, z: r.z - 4 - i, yaw: 0})),
      ...over,
    });
    for (let t = 0; t < seconds; t += f.dt) {
      context.currentTime += f.dt;
      audio.frame(f);
      peak = Math.max(peak, context.oscillators);
    }
  };
  const grid = () => Array.from({length: 8}, (_, i) => rider({human: i < 4, x: i * 3, z: i * 5}));
  go(grid(), 0.5);
  assert.equal(audio.oscillators, 24);
  go(grid(), 0.1, {phase: 'results'});
  go(grid(), 0.5, {phase: 'countdown'});
  go(grid(), 0.5);
  assert.equal(peak, 24, 'a new race reuses the voices instead of adding more');
  // One human and two others next: the spare voices are stopped.
  go([rider({human: true}), rider({z: 5}), rider({z: 9})], 1);
  assert.equal(audio.oscillators, 9);
  assert.equal(context.oscillators, 9);
  assert.equal(peak, 24);
});

test('two bikes at about the same distance do not trade a voice back and forth', () => {
  const {audio, context} = started();
  // Five rivals; the fourth and fifth nearest are level, and one of them wobbles by a few centimetres.
  const riders = [
    rider({human: true}),
    rider({z: 5}),
    rider({z: 7}),
    rider({z: 9}),
    rider({x: 8, z: 12}),
    rider({x: -8, z: 12}),
  ];
  run(audio, context, frame(riders), 0.2);
  const first = audio.voices.map(v => v.rider).join();
  let swaps = 0;
  for (let i = 0; i < 120; i++) {
    riders[5].z = 12 + (i % 2 ? -0.02 : 0.02);
    run(audio, context, frame(riders), 1 / 60);
    if (audio.voices.map(v => v.rider).join() !== first) swaps++;
  }
  assert.equal(swaps, 0, 'the voice stays with the bike that has it');
  // A bike that comes clearly nearer does take the voice, which is silent while it moves over and then fades in.
  riders[5].z = 6;
  run(audio, context, frame(riders), 1 / 60);
  const moved = voiceOf(audio, 5);
  assert.ok(moved, 'the nearer bike is voiced');
  assert.equal(moved.loudness, 0, 'silent at the moment of the swap');
  run(audio, context, frame(riders), 0.5);
  assert.ok(moved.loudness > 0.05, 'and back up to level');
  assert.deepEqual(voicedRiders(riders, [EAR], [4]).others.includes(4), false, 'holding on is not for ever');
});
test("a rider's own bike is the same loudness wherever the chase camera sits", () => {
  const loudness = (back: number) => {
    const {audio, context} = started();
    run(audio, context, frame([rider({human: true})], {ears: [{x: 0, z: -back, yaw: 0}]}), 0.5);
    return [voiceOf(audio, 0).loudness, voiceOf(audio, 0).balance];
  };
  assert.deepEqual(loudness(2.5), loudness(9));
});
test('on the limiter the engine loses its edge and bangs, the same at any frame rate', () => {
  const at = (fps: number) => {
    const {audio, context} = started();
    const riders = [rider({human: true, speed: TUNING.maxSpeed, throttle: 1})];
    run(audio, context, frame(riders, {dt: 1 / fps}), 1);
    const flat = voiceOf(audio, 0).loudness;
    riders[0].speed = TUNING.maxSpeed * 0.9;
    run(audio, context, frame(riders, {dt: 1 / fps}), 1);
    return [flat, voiceOf(audio, 0).loudness];
  };
  const [limited, below] = at(60);
  assert.ok(limited < below * 0.75, 'quieter on the limiter than just under it');
  assert.ok(Math.abs(at(30)[0] - limited) < 1e-6 && Math.abs(at(120)[0] - limited) < 1e-6);
});

// C3
test("in split screen, Player 2's throttle changes only Player 2's engine voice", () => {
  const sound = (throttle: number) => {
    const {audio, context} = started();
    const riders = [
      rider({human: true, x: 0, z: 0}),
      rider({human: true, x: 30, z: 0, throttle}),
      rider({x: 3, z: 6}),
      rider({x: 33, z: 6}),
    ];
    const ears: Listener[] = [
      {x: 0, z: -4, yaw: 0},
      {x: 30, z: -4, yaw: 0},
    ];
    run(audio, context, frame(riders, {ears}), 1);
    return riders.map((_, i) => ({...pick(voiceOf(audio, i))}));
  };
  const pick = (v: {note: number; loudness: number; balance: number; revs: number; decel: number}) => ({
    note: v.note,
    loudness: v.loudness,
    balance: v.balance,
    revs: v.revs,
    decel: v.decel,
  });
  const shut = sound(0),
    open = sound(1);
  assert.ok(open[1].loudness > shut[1].loudness * 1.5, "Player 2's engine is louder on the throttle");
  for (const other of [0, 2, 3]) assert.deepEqual(open[other], shut[other], `rider ${other + 1} sounds the same`);
});
test('every human hears their own bike at the same loudness', () => {
  const {audio, context} = started();
  const riders = [rider({human: true, x: 0}), rider({human: true, x: 200})];
  const ears: Listener[] = [
    {x: 0, z: -4, yaw: 0},
    {x: 200, z: -4, yaw: 0},
  ];
  run(audio, context, frame(riders, {ears}), 1);
  assert.ok(voiceOf(audio, 0).loudness > 0.05);
  assert.ok(Math.abs(voiceOf(audio, 0).loudness - voiceOf(audio, 1).loudness) < 1e-9);
});
test('revs follow the throttle in the air, and shutting it at high revs brings the crackle', () => {
  const {audio, context} = started();
  const riders = [rider({human: true, speed: 30, throttle: 1})];
  run(audio, context, frame(riders), 1);
  const onDirt = voiceOf(audio, 0).revs;
  riders[0].grounded = false;
  run(audio, context, frame(riders), 1);
  assert.ok(voiceOf(audio, 0).revs > onDirt + 0.1, 'the engine spins up with the wheel in the air');
  assert.ok(voiceOf(audio, 0).decel < 0.01);
  riders[0].grounded = true;
  riders[0].throttle = 0;
  run(audio, context, frame(riders), 0.5);
  assert.ok(voiceOf(audio, 0).decel > 0.5, 'throttle shut at high revs crackles');
  riders[0].speed = 2;
  run(audio, context, frame(riders), 3);
  assert.ok(voiceOf(audio, 0).decel < 0.05, 'and it dies away at idle');
});

// C5
test('no sound plays in setup, while paused, on the results screen or when muted', () => {
  const {audio, context} = started();
  const riders = [rider({human: true}), rider({z: 8})];
  const silentIn = (over: Partial<SoundFrame>, label: string) => {
    run(audio, context, frame(riders, over), FINISH_TAIL + 0.5);
    assert.equal(audio.open, false, `the gate is shut ${label}`);
    const before = [audio.played, context.sources];
    audio.cue(600, 0.13);
    audio.landing(12);
    riders[1].crashes++;
    run(audio, context, frame(riders, over), 0.2);
    assert.deepEqual([audio.played, context.sources], before, `nothing starts ${label}`);
  };
  run(audio, context, frame(riders), 0.5);
  assert.equal(audio.open, true, 'sound is on while racing');
  audio.landing(12);
  assert.equal(audio.played, 1);
  silentIn({paused: true}, 'while paused');
  run(audio, context, frame(riders), 0.5);
  assert.equal(audio.open, true, 'and back on when the race resumes');
  silentIn({phase: 'results'}, 'on the results screen');
  silentIn({phase: 'setup', riders: [], positions: [], ears: []}, 'in setup');
  assert.equal(context.state, 'suspended', 'the hardware sleeps once it has been silent for a second');
  run(audio, context, frame(riders, {phase: 'countdown'}), 0.2);
  assert.equal(context.state, 'running', 'and wakes for the next race');
  assert.equal(audio.open, true);
  // Muted: the master level glides to nothing and no one-shot is started.
  const master = context.nodes.find(n => n.outputs.some(o => o.kind === 'compressor'))!;
  assert.equal(master.gain.value, DEFAULT_VOLUMES.master);
  audio.muted = true;
  assert.equal(master.gain.value, 0);
  const before = audio.played;
  audio.cue(600, 0.13);
  audio.landing(12);
  assert.equal(audio.played, before);
  audio.muted = false;
  assert.equal(master.gain.value, DEFAULT_VOLUMES.master);
});
test('a finish rings out for a moment on the results screen, and then there is silence', () => {
  const {audio, context} = started();
  const riders = [rider({human: true}), rider({z: 8})];
  run(audio, context, frame(riders), 0.5);
  riders[0].finished = 61.2;
  const results = frame(riders, {phase: 'results'});
  run(audio, context, results, 0.1);
  assert.equal(audio.played, 1, 'the finish sting');
  assert.ok(audio.crowdSwell > 0.8, 'the crowd lifts for the flag');
  assert.equal(voiceOf(audio, 0).loudness, 0, 'the engines stop at the flag');
  assert.equal(audio.open, true);
  run(audio, context, results, FINISH_TAIL);
  assert.equal(audio.open, false, 'silence once the finish has rung out');
  // A tab switched away during the ring is silenced at once.
  audio.hush();
  // Coming back to results from somewhere else never reopens it.
  run(audio, context, frame(riders, {phase: 'setup'}), 0.1);
  run(audio, context, results, 0.1);
  assert.equal(audio.open, false);
});

test('a finish is still heard when the race was paused a moment before the flag', () => {
  const {audio, context} = started();
  const riders = [rider({human: true}), rider({z: 8})];
  run(audio, context, frame(riders), 0.5);
  run(audio, context, frame(riders, {paused: true}), 0.3);
  riders[0].finished = 61.2;
  run(audio, context, frame(riders, {phase: 'results'}), 0.1);
  assert.equal(audio.played, 1);
  assert.ok(audio.crowdSwell > 0.8);
});
test('two riders trading places are cheered once, not held up as one long cheer', () => {
  const {audio, context} = started();
  const riders = [rider({human: true}), rider({z: 2})];
  run(audio, context, frame(riders), 0.2);
  for (let i = 0; i < 180; i++) run(audio, context, frame(riders, {positions: i % 2 ? [1, 2] : [2, 1]}), 1 / 60);
  assert.ok(audio.crowdSwell < 0.05, `the cheer has settled: ${audio.crowdSwell}`);
  run(audio, context, frame(riders, {positions: [2, 1]}), 3.2);
  run(audio, context, frame(riders, {positions: [1, 2]}), 1 / 60);
  assert.ok(audio.crowdSwell > 0.25, 'a pass after a quiet spell is cheered again');
});
test('a bad number from the game is ignored rather than sent to the sound hardware', () => {
  const {audio, context} = started();
  const riders = [rider({human: true, speed: NaN, throttle: NaN}), rider({x: NaN})];
  run(audio, context, frame(riders), 0.2);
  const sent = context.nodes.flatMap(n => [n.gain, n.frequency, n.pan].flatMap(p => p.ops));
  assert.ok(sent.every(op => Number.isFinite(op.value)));
});

// C6
test('no level is ever set in one step on a node that is wired in', () => {
  const {audio, context} = started();
  const riders = Array.from({length: 8}, (_, i) => rider({human: i < 2, x: i * 2, z: i * 4}));
  run(audio, context, frame(riders, {phase: 'countdown'}), 0.3);
  audio.cue(600, 0.13);
  for (let i = 0; i < 120; i++) {
    riders.forEach((r, n) => {
      r.speed = (i * 0.4 + n * 3) % TUNING.maxSpeed;
      r.throttle = i % 20 < 12 ? 1 : 0;
      r.z += 0.3;
      r.powerSlide = n === 0 && i % 30 < 10 ? 1 : 0;
    });
    if (i === 40) riders[3].crashes++;
    if (i === 60) audio.landing(15);
    if (i === 80) riders[0].progress = {lap: 1};
    run(audio, context, frame(riders), 1 / 60);
  }
  audio.setVolumes({master: 0.3, engine: 1, effects: 0, crowd: 0.5});
  audio.muted = true;
  audio.muted = false;
  run(audio, context, frame(riders, {paused: true}), 0.2);
  run(audio, context, frame(riders, {phase: 'results'}), 0.2);
  assert.ok(audio.played >= 4, 'the run played one-shots');
  assert.deepEqual(context.steps, []);
  const levels = context.nodes.filter(n => n.kind === 'gain').flatMap(n => n.gain.ops.slice(1));
  assert.ok(levels.length > 100, 'levels were changed many times');
  assert.ok(
    levels.every(op => op.type === 'target'),
    'and every change after the first was a glide',
  );
});
test('the ramp check passes on the sound code', () => {
  const out = execFileSync(process.execPath, ['scripts/check-audio-ramps.mjs'], {encoding: 'utf8'});
  assert.match(out, /every level change in \d+ sound files is ramped/);
});

// C7
test('the four sliders persist across a reload', () => {
  const stored = new Map<string, string>();
  const storage = {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => void stored.set(k, v),
  };
  const first = new SaveStore(storage);
  assert.deepEqual(first.volumes, DEFAULT_VOLUMES);
  first.setVolumes({master: 0.35, engine: 0.6, effects: 1, crowd: 0});
  first.setSlideAggression(1.5);
  const reloaded = new SaveStore(storage);
  assert.deepEqual(reloaded.volumes, {master: 0.35, engine: 0.6, effects: 1, crowd: 0});
  assert.equal(reloaded.slideAggression, 1.5, 'other settings are untouched');
  // One slider at a time, as the page does it.
  reloaded.setVolumes({...reloaded.volumes, crowd: 0.45});
  assert.deepEqual(new SaveStore(storage).volumes, {master: 0.35, engine: 0.6, effects: 1, crowd: 0.45});
  assert.deepEqual(JSON.parse(stored.get(SAVE_KEY)!).settings.volumes, {
    master: 0.35,
    engine: 0.6,
    effects: 1,
    crowd: 0.45,
  });
});
test('a save from before the sliders, or a damaged one, gives the default volumes', () => {
  const stored = new Map<string, string>([[SAVE_KEY, JSON.stringify({version: 1, settings: {slideAggression: 0.5}})]]);
  const storage = {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => void stored.set(k, v),
  };
  assert.deepEqual(new SaveStore(storage).volumes, DEFAULT_VOLUMES);
  assert.deepEqual(normalizeVolumes({master: 7, engine: -1, effects: 'loud', crowd: 0.333}), {
    master: 1,
    engine: 0,
    effects: DEFAULT_VOLUMES.effects,
    crowd: 0.33,
  });
  assert.deepEqual(normalizeVolumes(null), DEFAULT_VOLUMES);
  assert.deepEqual(new SaveStore(null).setVolumes({master: 0.2, engine: 0.2, effects: 0.2, crowd: 0.2}).master, 0.2);
});
test('the sliders set the four mix levels', () => {
  const {audio, context} = started();
  audio.setVolumes({master: 0.1, engine: 0.2, effects: 0.3, crowd: 0.4});
  const master = context.nodes.find(n => n.outputs.some(o => o.kind === 'compressor'))!,
    gate = context.nodes.find(n => n.outputs.includes(master))!,
    buses = context.nodes.filter(n => n.kind === 'gain' && n.outputs.includes(gate));
  assert.equal(master.gain.value, 0.1);
  assert.deepEqual(buses.map(b => b.gain.value).sort(), [0.2, 0.3, 0.4]);
});

// Effects
test('crashes, big air, passes, laps and the finish are picked out of the riders', () => {
  const human = rider({human: true}),
    other = rider();
  const before = [see(human, 2), see(other, 1)];
  assert.deepEqual(soundEvents(before, [human, other], [2, 1], true), []);
  assert.deepEqual(soundEvents(before, [human, {...other, crashes: 1}], [2, 1], true), [{type: 'crash', rider: 1}]);
  assert.deepEqual(soundEvents(before, [human, other], [1, 2], true), [{type: 'pass', rider: 0}]);
  assert.deepEqual(soundEvents(before, [human, other], [1, 2], false), [], 'no passes in practice');
  assert.deepEqual(
    soundEvents([see(other, 2), see(human, 1)], [other, human], [1, 2], true),
    [],
    'rivals passing is not cheered',
  );
  assert.deepEqual(soundEvents(before, [{...human, progress: {lap: 1}}, other], [2, 1], true), [
    {type: 'lap', rider: 0},
  ]);
  assert.deepEqual(soundEvents(before, [{...human, progress: {lap: 1}, finished: 60}, other], [2, 1], true), [
    {type: 'finish', rider: 0},
  ]);
  const flying = [see({...human, grounded: false, airTime: BIG_AIR + 0.4}, 2), see(other, 1)];
  assert.deepEqual(soundEvents(flying, [human, other], [2, 1], true), [
    {type: 'bigAir', rider: 0, seconds: BIG_AIR + 0.4},
  ]);
  const hop = [see({...human, grounded: false, airTime: 0.3}, 2), see(other, 1)];
  assert.deepEqual(soundEvents(hop, [human, other], [2, 1], true), [], 'a small hop is not cheered');
  assert.deepEqual(soundEvents(flying, [{...human, crashes: 1}, other], [2, 1], true), [{type: 'crash', rider: 0}]);
});
test('the crowd lifts for a big jump and settles, and a slide brings the dirt spray', () => {
  const {audio, context} = started();
  const riders = [rider({human: true}), rider({z: 8})];
  run(audio, context, frame(riders), 0.2);
  assert.equal(audio.crowdSwell, 0);
  Object.assign(riders[0], {grounded: false, airTime: 1.4});
  run(audio, context, frame(riders), 0.1);
  Object.assign(riders[0], {grounded: true, airTime: 0});
  run(audio, context, frame(riders), 0.05);
  const lifted = audio.crowdSwell;
  assert.ok(lifted > 0.5, `crowd lifted to ${lifted}`);
  run(audio, context, frame(riders), 4);
  assert.ok(audio.crowdSwell < lifted / 8, 'and settles');
  const spray = context.nodes.find(n => n.kind === 'filter' && n.type === 'highpass')!.outputs[0];
  assert.ok(spray.gain.value < 1e-6);
  riders[0].powerSlide = 1;
  run(audio, context, frame(riders), 0.2);
  assert.ok(spray.gain.value > 0.3, 'a power slide sprays dirt');
  riders[0].grounded = false;
  run(audio, context, frame(riders), 0.2);
  assert.ok(spray.gain.value < 1e-6, 'not in the air');
});
test('a harder landing is louder, and every sample starts and ends at silence', () => {
  const {audio, context} = started();
  run(audio, context, frame([rider({human: true})]), 0.2);
  const level = () => context.nodes.filter(n => n.kind === 'gain').at(-1)!.gain.value;
  audio.landing(5);
  const soft = level();
  audio.landing(18);
  assert.ok(level() > soft * 3);
  const rate = 8000;
  for (const [name, data] of Object.entries({
    thud: synth.thud(rate),
    crash: synth.crash(rate),
    lap: synth.tones(rate, [880, 1175], 0.11),
    cue: synth.tones(rate, [600], 0.13),
  })) {
    assert.ok(Math.abs(data[0]) < 0.02 && Math.abs(data.at(-1)!) < 0.02, `${name} starts and ends at silence`);
    assert.ok(data.every(Number.isFinite));
    assert.ok(Math.max(...data.map(Math.abs)) > 0.2, `${name} is not silent`);
    assert.ok(Math.max(...data.map(Math.abs)) <= 1.5, `${name} is not wildly loud`);
  }
  for (const [name, data] of Object.entries({
    hiss: synth.hiss(rate),
    crowd: synth.crowd(rate),
    crackle: synth.crackle(rate),
  })) {
    assert.ok(data.every(Number.isFinite), name);
    assert.ok(
      Math.max(...data.map(Math.abs)) > 0.1 && Math.max(...data.map(Math.abs)) <= 1.5,
      `${name} has a sensible level`,
    );
  }
  assert.deepEqual(synth.hiss(rate, 0.1), synth.hiss(rate, 0.1), 'samples are the same every time');
});
