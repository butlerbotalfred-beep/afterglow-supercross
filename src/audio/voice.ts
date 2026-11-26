// One bike's engine: three oscillators and filtered hiss, driven by the rev model, with an exhaust crackle
// when the throttle is shut and a stutter on the rev limiter.
import {gearFor, gearRevs, nextGear, onLimiter, revsToHz} from './revs';
import {Glide, preset} from './ramp';

/** Oscillators in one engine voice. Eight voices is the most that ever run, so 24 oscillators. */
export const VOICE_OSCILLATORS = 3;
/**
 * How the three oscillators sit against the firing note: the note, a second a shade off it so the two beat
 * into a buzz, and a bright edge an octave up. There is no low thump: the sound is a two-stroke's rasp.
 */
const PARTS: {type: OscillatorType; ratio: number; level: number}[] = [
  {type: 'sawtooth', ratio: 1, level: 0.5},
  {type: 'square', ratio: 1.012, level: 0.3},
  {type: 'sawtooth', ratio: 2.007, level: 0.34},
];
/** How hard the mixed oscillators are driven into the clipper that gives the engine its chainsaw bite. */
const BITE = 2.4;
/** The clipper's curve: a soft squash that adds harsh upper harmonics. Lopsided, as an exhaust pulse is. */
const BITE_CURVE = Float32Array.from({length: 1025}, (_, i) => {
  const x = (i / 512 - 1) * BITE;
  return Math.tanh(x + 0.12 * x * x) * 0.75;
});
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
  /** Seconds since the voice was handed a different bike. It is silent while the note moves over, then fades in. */
  private since = 1;
  private oscillators: OscillatorNode[] = [];
  private sources: AudioBufferSourceNode[] = [];
  private pitch: Glide[] = [];
  private tone: Glide;
  private ring: Glide;
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
    this.tone = new Glide(filter.frequency, 0.04, 900);
    const bite = context.createWaveShaper();
    bite.curve = BITE_CURVE;
    bite.oversample = '2x';
    // The exhaust pipe rings at a pitch of its own, which is the "ring-ding" of a two-stroke.
    const pipe = context.createBiquadFilter();
    pipe.type = 'peaking';
    preset(pipe.Q, 1.6);
    preset(pipe.gain, 7);
    this.ring = new Glide(pipe.frequency, 0.05, 1800);
    const body = context.createGain();
    this.level = new Glide(body.gain, 0.03);
    for (const part of PARTS) {
      const osc = context.createOscillator(),
        mix = context.createGain();
      osc.type = part.type;
      preset(mix.gain, part.level);
      this.pitch.push(new Glide(osc.frequency, 0.035, revsToHz(0.16) * part.ratio * tune));
      osc.connect(mix).connect(bite);
      osc.start(now);
      this.oscillators.push(osc);
    }
    bite.connect(pipe).connect(filter).connect(body).connect(this.panner);
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
    this.since = this.rider < 0 ? 1 : 0;
    this.rider = rider;
    this.gear = gearFor(bike.speed);
    this.revs = gearRevs(this.gear, bike.speed, bike.throttle);
    this.decel = 0;
  }
  /** Moves the engine on by `dt` seconds and sends the new sound to the speakers at loudness `gain`. */
  drive(bike: EngineInput, dt: number, loudness: number, pan: number) {
    this.since += dt;
    const gain = loudness * Math.min(1, Math.max(0, (this.since - 0.07) / 0.12));
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
    this.tone.to(800 + 2200 * this.revs + 3000 * throttle * this.revs, now);
    this.ring.to(1500 + 1500 * this.revs, now);
    // On the limiter the spark is cut: the engine loses its edge and the exhaust bangs. The banging comes from
    // the crackle sample, so it sounds the same at any frame rate.
    const limited = onLimiter(this.revs) && throttle > 0.5;
    this.level.to(gain * (0.2 + 0.5 * throttle + 0.3 * this.revs) * (limited ? 0.6 : 1), now, 0.02);
    this.breathTone.to(1400 + 3200 * this.revs, now);
    this.breath.to(gain * (0.03 + 0.2 * throttle * this.revs), now);
    this.pops.to(gain * Math.max(this.decel * 0.55, limited ? 0.6 : 0), now);
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
