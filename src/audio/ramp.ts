// The only file that may set a sound level in one step. Everything that can be heard changing goes through
// `ramp`, so a level never jumps and never clicks. scripts/check-audio-ramps.mjs enforces that in CI.

/** Sets a value on a node that is not connected to the speakers yet, so nothing can be heard changing. */
export function preset(param: AudioParam, value: number) {
  param.value = value;
}
/** Glides a value to a new one. `seconds` is the time to cover about two thirds of the way. */
export function ramp(param: AudioParam, value: number, now: number, seconds = 0.03) {
  param.setTargetAtTime(value, now, seconds);
}
/** A value that is glided, and only told about changes big enough to matter, to keep the per-frame cost low. */
export class Glide {
  private last: number;
  constructor(
    private param: AudioParam,
    private seconds = 0.03,
    start = 0,
  ) {
    preset(param, start);
    this.last = start;
  }
  /** The value being glided to. */
  get target() {
    return this.last;
  }
  to(value: number, now: number, seconds = this.seconds) {
    if (Math.abs(value - this.last) <= 0.004 * Math.abs(this.last) + 1e-5) return;
    this.last = value;
    ramp(this.param, value, now, seconds);
  }
}
