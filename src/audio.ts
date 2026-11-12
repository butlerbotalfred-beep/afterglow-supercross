export class GameAudio {
  context: AudioContext | null = null;
  engine: OscillatorNode | null = null;
  gain: GainNode | null = null;
  muted = false;
  start() {
    if (!this.context) {
      this.context = new AudioContext();
      this.engine = this.context.createOscillator();
      this.engine.type = 'sawtooth';
      const filter = this.context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 350;
      this.gain = this.context.createGain();
      this.gain.gain.value = 0;
      this.engine.connect(filter).connect(this.gain).connect(this.context.destination);
      this.engine.start();
    }
    void this.context.resume();
  }
  update(speed: number, throttle: number, active: boolean) {
    if (!this.context || !this.engine || !this.gain) return;
    this.engine.frequency.setTargetAtTime(43 + speed * 3.5 + throttle * 14, this.context.currentTime, 0.08);
    this.gain.gain.setTargetAtTime(this.muted || !active ? 0 : 0.014 + throttle * 0.012, this.context.currentTime, 0.1);
  }
  cue(hz = 700, duration = 0.1, volume = 0.06) {
    if (!this.context || this.muted) return;
    const o = this.context.createOscillator(),
      g = this.context.createGain(),
      t = this.context.currentTime;
    o.type = 'sine';
    o.frequency.value = hz;
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    o.connect(g).connect(this.context.destination);
    o.start();
    o.stop(t + duration);
  }
  landing(impact: number) {
    this.cue(65, 0.12, Math.min(0.065, impact * 0.004));
  }
}
