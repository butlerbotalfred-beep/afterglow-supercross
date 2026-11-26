// The game's sound: an engine for every human rider and the four nearest rivals, a crowd, dirt spray,
// landings, crashes and the lap and finish stings, mixed through four volume sliders.
import {TUNING} from '../config';
import {soundEvents, see, type RiderSound, type Seen} from './events';
import {place, voicedRiders, OTHER_VOICES, type Listener} from './placement';
import {Glide, preset, ramp} from './ramp';
import * as synth from './synth';
import {EngineVoice, VOICE_OSCILLATORS, type EngineInput} from './voice';

export type {Listener} from './placement';
export interface Volumes {
  master: number;
  engine: number;
  effects: number;
  crowd: number;
}
export const VOLUME_KEYS = ['master', 'engine', 'effects', 'crowd'] as const;
export const DEFAULT_VOLUMES: Volumes = {master: 0.8, engine: 0.8, effects: 0.8, crowd: 0.6};
/** A stored slider value made safe: a number from 0 to 1 in steps of 0.01, or the default. */
export function normalizeVolumes(v: unknown): Volumes {
  const given = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  const out = {...DEFAULT_VOLUMES};
  for (const key of VOLUME_KEYS) {
    const value = given[key];
    if (typeof value === 'number' && Number.isFinite(value))
      out[key] = Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
  }
  return out;
}
/** The rider facts the sound follows. */
export type SoundRider = RiderSound & EngineInput & {x: number; z: number; powerSlide: number; slipAngle: number};
/** Everything the sound needs to know about one frame. */
export interface SoundFrame {
  phase: 'setup' | 'countdown' | 'racing' | 'results';
  paused: boolean;
  /** True in Free Practice, where there is no race to pass anyone in. */
  practice: boolean;
  riders: SoundRider[];
  /** Each rider's race position, 1 for the leader, in the same order as `riders`. */
  positions: number[];
  /** One per human camera. */
  ears: Listener[];
  /** Seconds since the last frame. */
  dt: number;
}
/**
 * Seconds the finish sting and the crowd may ring on after the flag. The last rider's flag and the results
 * screen arrive in the same moment, so without this the finish would never be heard. Everything else stops
 * at once, and nothing new can start.
 */
export const FINISH_TAIL = 1.2;
/** Seconds of silence after which the sound hardware is put to sleep. */
const SLEEP_AFTER = 1;
const LAP_NOTES = [880, 1175],
  FINISH_NOTES = [784, 988, 1319];

export class GameAudio {
  context: AudioContext | null = null;
  volumes: Volumes = {...DEFAULT_VOLUMES};
  /** Engine voices by the rider they follow. Humans keep theirs; the others move to whoever is nearest. */
  voices: EngineVoice[] = [];
  /** One-shot sounds started so far, for tests. */
  played = 0;
  private isMuted = false;
  private master!: Glide;
  /** Open while a race is being ridden; shut in setup, on pause and on results. */
  private gate!: Glide;
  private engineBus!: Glide;
  private effectsBus!: Glide;
  private crowdBus!: Glide;
  private engineOut!: AudioNode;
  private effectsOut!: AudioNode;
  private crowdLevel!: Glide;
  private sprayLevel!: Glide;
  private buffers: Record<string, AudioBuffer> = {};
  private field: unknown = null;
  private seen: Seen[] = [];
  private swell = 0;
  private tail = 0;
  private quiet = 0;
  private asked = 0;
  private wasRacing = false;

  /** `create` makes the browser's sound context; tests pass a stand-in. */
  constructor(private create: () => AudioContext = () => new AudioContext()) {}

  get muted() {
    return this.isMuted;
  }
  set muted(muted: boolean) {
    this.isMuted = muted;
    this.applyVolumes();
  }
  setVolumes(volumes: Volumes) {
    this.volumes = normalizeVolumes(volumes);
    this.applyVolumes();
  }
  private applyVolumes() {
    if (!this.context) return;
    const now = this.context.currentTime;
    this.master.to(this.isMuted ? 0 : this.volumes.master, now);
    this.engineBus.to(this.volumes.engine, now);
    this.effectsBus.to(this.volumes.effects, now);
    this.crowdBus.to(this.volumes.crowd, now);
  }
  /** Oscillators running now. */
  get oscillators() {
    return this.voices.length * VOICE_OSCILLATORS;
  }
  /** True while the race gate is open, so sound can be heard (unless muted). */
  get open() {
    return !!this.context && this.gate.target > 0;
  }
  /** Builds the sound graph the first time, and wakes the hardware. Call from a tap, click or key press. */
  start() {
    if (!this.context) this.build();
    void this.context!.resume();
  }
  private build() {
    const context = (this.context = this.create()),
      rate = context.sampleRate;
    const bus = (to: AudioNode, level: number) => {
      const node = context.createGain(),
        glide = new Glide(node.gain, 0.04, level);
      node.connect(to);
      return {node, glide};
    };
    // Loud moments from eight bikes at once are squeezed rather than allowed to distort.
    const squeeze = context.createDynamicsCompressor();
    squeeze.connect(context.destination);
    const master = bus(squeeze, this.isMuted ? 0 : this.volumes.master),
      gate = bus(master.node, 0),
      engine = bus(gate.node, this.volumes.engine),
      effects = bus(gate.node, this.volumes.effects),
      crowd = bus(gate.node, this.volumes.crowd);
    [this.master, this.gate] = [master.glide, gate.glide];
    [this.engineBus, this.effectsBus, this.crowdBus] = [engine.glide, effects.glide, crowd.glide];
    [this.engineOut, this.effectsOut] = [engine.node, effects.node];
    const buffer = (name: string, data: Float32Array) => {
      const made = context.createBuffer(1, data.length, rate);
      made.getChannelData(0).set(data);
      return (this.buffers[name] = made);
    };
    const loop = (made: AudioBuffer, to: AudioNode, filter: BiquadFilterType, hz: number) => {
      const source = context.createBufferSource(),
        shape = context.createBiquadFilter(),
        level = context.createGain(),
        glide = new Glide(level.gain, 0.12);
      source.buffer = made;
      source.loop = true;
      shape.type = filter;
      preset(shape.frequency, hz);
      source.connect(shape).connect(level).connect(to);
      source.start(context.currentTime);
      return glide;
    };
    buffer('hiss', synth.hiss(rate));
    buffer('crackle', synth.crackle(rate));
    buffer('thud', synth.thud(rate));
    buffer('crash', synth.crash(rate));
    buffer('lap', synth.tones(rate, LAP_NOTES, 0.11));
    buffer('finish', synth.tones(rate, FINISH_NOTES, 0.16, 3));
    this.crowdLevel = loop(buffer('crowd', synth.crowd(rate)), crowd.node, 'bandpass', 900);
    this.sprayLevel = loop(this.buffers.hiss, effects.node, 'highpass', 1800);
  }
  /** Plays a sample once. Nothing starts while the gate is shut or the sound is muted. */
  private play(name: string, volume: number, pan = 0) {
    const context = this.context;
    if (!context || !this.open || this.isMuted || volume <= 0.002) return;
    const now = context.currentTime,
      source = context.createBufferSource(),
      level = context.createGain(),
      panner = context.createStereoPanner();
    source.buffer = this.buffers[name];
    preset(level.gain, 0);
    preset(panner.pan, pan);
    source.connect(level).connect(panner).connect(this.effectsOut);
    ramp(level.gain, Math.min(1, volume), now, 0.003);
    source.onended = () => panner.disconnect();
    source.start(now);
    this.played++;
  }
  /** A short note, such as a countdown beep. */
  cue(hz = 700, seconds = 0.1, volume = 0.3) {
    if (!this.context) return;
    const name = `tone-${hz}-${seconds}`;
    if (!this.buffers[name]) {
      const data = synth.tones(this.context.sampleRate, [hz], seconds);
      this.buffers[name] = this.context.createBuffer(1, data.length, this.context.sampleRate);
      this.buffers[name].getChannelData(0).set(data);
    }
    this.play(name, volume);
  }
  /** A human rider's landing. `impact` is the speed into the ground in m/s. */
  landing(impact: number) {
    this.play('thud', Math.min(1, impact / TUNING.landingCrashImpact) ** 1.5);
  }
  /** Wakes the hardware if a race is being heard. Call from any tap or key press. */
  wake() {
    if (this.context && this.quiet === 0 && this.context.state !== 'running') void this.context.resume();
  }
  /** Shuts the race gate now: for the pause menu, the results screen and the way back to setup. */
  hush() {
    if (this.context) this.gate.to(0, this.context.currentTime, 0.03);
  }
  /** Follows one frame of the game. */
  frame(f: SoundFrame) {
    const context = this.context;
    if (!context) return;
    const now = context.currentTime,
      riding = (f.phase === 'countdown' || f.phase === 'racing') && !f.paused;
    // The moment the last rider takes the flag the results appear; let the finish ring out, then stop.
    const flag = f.phase === 'results' && this.wasRacing;
    if (flag) this.tail = FINISH_TAIL;
    if (f.phase !== 'results') this.tail = 0;
    this.wasRacing = f.phase === 'racing' && !f.paused;
    this.tail = Math.max(0, this.tail - f.dt);
    const audible = riding || this.tail > 0;
    this.gate.to(audible ? 1 : 0, now, 0.03);
    if (!audible) {
      // Asleep the hardware costs nothing, which matters on a phone sitting on the setup screen.
      this.quiet += f.dt;
      if (this.quiet > SLEEP_AFTER && context.state === 'running') void context.suspend();
      return;
    }
    // A browser may refuse to wake the hardware until the player touches something, so keep asking now and then.
    this.asked += f.dt;
    if (context.state !== 'running' && (this.quiet > 0 || this.asked > 1)) {
      this.asked = 0;
      void context.resume();
    }
    this.quiet = 0;
    if (f.riders !== this.field) {
      // A new grid: every voice is handed out again, and the crowd settles.
      for (const voice of this.voices) voice.rider = -1;
      this.field = f.riders;
      this.seen = [];
      this.swell = 0;
    }
    this.engines(f, riding);
    // The last rider's flag falls in the same frame as the results, so that frame is still listened to.
    if ((riding && f.phase === 'racing') || flag) this.events(f);
    this.swell *= Math.exp(-f.dt / 1.4);
    this.crowdLevel.to(0.22 + 0.78 * Math.min(1, this.swell), now, 0.15);
    let spray = 0;
    if (riding && f.phase === 'racing')
      for (const r of f.riders)
        if (r.human && r.grounded)
          spray = Math.max(
            spray,
            Math.max(r.powerSlide, Math.min(1, Math.abs(r.slipAngle) * 3)) * Math.min(1, r.speed / 14),
          );
    this.sprayLevel.to(spray * 0.5, now, 0.06);
  }
  /** Gives every human and the four nearest other bikes a voice, and drives each from its rider. */
  private engines(f: SoundFrame, riding: boolean) {
    const context = this.context!,
      {humans, others} = voicedRiders(f.riders, f.ears),
      wanted = [...humans, ...others];
    // Voices whose bike is still wanted keep it; the rest are handed to the bikes that have none.
    const free = this.voices.filter(v => !wanted.includes(v.rider));
    for (const rider of wanted) {
      if (this.voices.some(v => v.rider === rider)) continue;
      let voice = free.pop();
      if (!voice) {
        if (this.voices.length >= 4 + OTHER_VOICES) continue;
        const tune = 0.94 + 0.12 * ((this.voices.length * 0.618) % 1);
        voice = new EngineVoice(context, this.engineOut, this.buffers.hiss, this.buffers.crackle, tune);
        this.voices.push(voice);
      }
      voice.follow(rider, f.riders[rider]);
    }
    // A smaller grid than last time needs fewer voices.
    this.voices = this.voices.filter(voice => wanted.includes(voice.rider) || voice.stop());
    for (const voice of this.voices) {
      const bike = f.riders[voice.rider];
      const where = place(bike, f.ears);
      // On results only the finish is heard, so the engines fade under it.
      voice.drive(bike, f.dt, riding ? where.gain * (bike.human ? 0.5 : 0.42) : 0, where.pan);
    }
  }
  private events(f: SoundFrame) {
    const racing = !f.practice;
    if (this.seen.length === f.riders.length)
      for (const event of soundEvents(this.seen, f.riders, f.positions, racing)) {
        if (event.type === 'crash') {
          const where = place(f.riders[event.rider], f.ears);
          this.play('crash', where.gain * 0.9, where.pan);
        } else if (event.type === 'bigAir') this.cheer(0.35 + Math.min(0.45, (event.seconds - 0.9) * 0.6));
        else if (event.type === 'pass') this.cheer(0.3);
        else if (event.type === 'lap') this.play('lap', 0.3);
        else {
          this.play('finish', 0.4);
          this.cheer(1);
        }
      }
    this.seen = f.riders.map((r, i) => see(r, f.positions[i]));
  }
  /** Lifts the crowd. It settles back by itself. */
  private cheer(amount: number) {
    this.swell = Math.max(this.swell, amount);
  }
  /** How lifted the crowd is, 0 to 1, for tests. */
  get crowdSwell() {
    return this.swell;
  }
}
