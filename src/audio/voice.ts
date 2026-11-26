// One bike's engine: three oscillators and filtered hiss, driven by the rev model, with an exhaust crackle
// when the throttle is shut and a stutter on the rev limiter.
import {gearFor, gearRevs, nextGear, onLimiter, revsToHz} from './revs';
import {Glide, preset} from './ramp';

/** Oscillators in one engine voice. Eight voices is the most that ever run, so 24 oscillators. */
export const VOICE_OSCILLATORS = 3;
/** How the three oscillators sit against the firing note: the note, the thump an octave under it, and a bright edge. */
const PARTS: {type: OscillatorType; ratio: number; level: number}[] = [
  {type: 'sawtooth', ratio: 1, level: 0.5},
  {type: 'square', ratio: 0.5, level: 0.32},
  {type: 'sawtooth', ratio: 2.007, level: 0.2},
];
/** What a voice needs to know about its bike. */
export interface EngineInput {
  speed: number;
  throttle: number;
  grounded: boolean;
}
export class EngineVoice {
  /** Index of the rider this voice is following, or -1 when it is free. */
  rider = -1;
  gear = 0;
  revs = 0;
  /** How much exhaust crackle there is, 0 to 1. */
  decel = 0;
  private oscillators: OscillatorNode[] = [];
  private sources: AudioBufferSourceNode[] = [];
  private pitch: Glide[] = [];
  private tone: Glide;
  private level: Glide;
  private breath: Glide;
  private breathTone: Glide;
  private pops: Glide;
  private pan: Glide;
  private panner: StereoPannerNode;

  /** `tune` shifts the note a little so no two bikes sound the same. */
  constructor(
    private context: AudioContext,
    out: AudioNode,
    hiss: AudioBuffer,
    crackle: AudioBuffer,
    private tune = 1,
  ) {
    const now = context.currentTime;
    this.panner = context.createStereoPanner();
    this.pan = new Glide(this.panner.pan, 0.05);
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    preset(filter.Q, 1.2);
    this.tone = new Glide(filter.frequency, 0.04, 400);
    const body = context.createGain();
    this.level = new Glide(body.gain, 0.03);
    for (const part of PARTS) {
      const osc = context.createOscillator(),
        mix = context.createGain();
      osc.type = part.type;
      preset(mix.gain, part.level);
      this.pitch.push(new Glide(osc.frequency, 0.035, revsToHz(0.16) * part.ratio * tune));
      osc.connect(mix).connect(filter);
      osc.start(now);
      this.oscillators.push(osc);
    }
    filter.connect(body).connect(this.panner);
    const air = this.loop(hiss, 0.9 + 0.2 * (tune % 1)),
      airFilter = context.createBiquadFilter(),
      airLevel = context.createGain();
    airFilter.type = 'bandpass';
    preset(airFilter.Q, 0.8);
    this.breathTone = new Glide(airFilter.frequency, 0.05, 900);
    this.breath = new Glide(airLevel.gain, 0.04);
    air.connect(airFilter).connect(airLevel).connect(this.panner);
    const pop = this.loop(crackle, 0.85 + 0.3 * ((tune * 7) % 1)),
      popLevel = context.createGain();
    this.pops = new Glide(popLevel.gain, 0.04);
    pop.connect(popLevel).connect(this.panner);
    this.panner.connect(out);
  }
  private loop(buffer: AudioBuffer, rate: number) {
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    preset(source.playbackRate, rate);
    source.start(this.context.currentTime, (rate * 0.37) % buffer.duration);
    this.sources.push(source);
    return source;
  }
  /** Points the voice at a rider. A new rider starts in the right gear with the revs already there. */
  follow(rider: number, bike: EngineInput) {
    if (rider === this.rider) return;
    this.rider = rider;
    this.gear = gearFor(bike.speed);
    this.revs = gearRevs(this.gear, bike.speed, bike.throttle);
    this.decel = 0;
  }
  /** Moves the engine on by `dt` seconds and sends the new sound to the speakers at loudness `gain`. */
  drive(bike: EngineInput, dt: number, gain: number, pan: number) {
    const now = this.context.currentTime,
      throttle = Math.min(1, Math.max(0, bike.throttle));
    this.gear = nextGear(this.gear, bike.speed);
    // In the air the rear wheel has nothing to push against, so an open throttle spins the engine up.
    const wanted = Math.min(1, gearRevs(this.gear, bike.speed, throttle) + (bike.grounded ? 0 : 0.2 * throttle));
    this.revs += (wanted - this.revs) * (1 - Math.exp(-dt * 16));
    const shut = throttle < 0.08 ? Math.min(1, Math.max(0, (this.revs - 0.4) * 2.2)) : 0;
    this.decel += (shut - this.decel) * (1 - Math.exp(-dt * (shut > this.decel ? 12 : 3)));
    const hz = revsToHz(this.revs) * this.tune;
    PARTS.forEach((part, i) => this.pitch[i].to(hz * part.ratio, now));
    this.tone.to(240 + 1500 * this.revs + 1900 * throttle * this.revs, now);
    // The limiter cuts the spark about 26 times a second.
    const limited = onLimiter(this.revs) && throttle > 0.5 && Math.floor(now * 52) % 2 === 1;
    this.level.to(gain * (0.2 + 0.5 * throttle + 0.3 * this.revs) * (limited ? 0.4 : 1), now, limited ? 0.006 : 0.02);
    this.breathTone.to(700 + 2600 * this.revs, now);
    this.breath.to(gain * (0.02 + 0.16 * throttle * this.revs), now);
    this.pops.to(gain * this.decel * 0.55, now);
    this.pan.to(pan, now);
  }
  /** The loudness the engine body is gliding to, for tests. */
  get loudness() {
    return this.level.target;
  }
  get balance() {
    return this.pan.target;
  }
  get note() {
    return this.pitch[0].target;
  }
  /** Fades the voice out and frees its oscillators. Returns false, so a list can drop it in the same breath. */
  stop() {
    const now = this.context.currentTime;
    for (const level of [this.level, this.breath, this.pops]) level.to(0, now, 0.03);
    for (const node of [...this.oscillators, ...this.sources]) node.stop(now + 0.3);
    setTimeout(() => this.panner.disconnect(), 400);
    this.rider = -1;
    return false;
  }
}
