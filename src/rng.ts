// Seeded random numbers. The same seed always gives the same sequence, on every device, so anything random in a
// race (starts, weather, rival mistakes) can be replayed and tested. Never use Math.random in race code.

/** Turns text such as a course name into a seed. */
export function seedFromText(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export class Rng {
  private state: number;

  /** Seeds are whole numbers from 0 to 2^32 - 1. Anything else is cut down to one (fractions dropped). */
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  /** A number from 0 up to, but not including, 1 (mulberry32). */
  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** A number from `min` up to, but not including, `max`. */
  range(min: number, max: number) {
    return min + (max - min) * this.next();
  }
  /** A whole number from `min` to `max`, both included. */
  int(min: number, max: number) {
    if (!Number.isInteger(min) || !Number.isInteger(max) || min > max)
      throw new Error('int needs whole numbers with min no greater than max.');
    // The clamp guards against rounding with very large bounds.
    return Math.min(max, min + Math.floor(this.next() * (max - min + 1)));
  }
  /** True with the given probability (0 never, 1 always). */
  chance(probability: number) {
    return this.next() < probability;
  }
  pick<T>(items: readonly T[]): T {
    if (!items.length) throw new Error('Cannot pick from an empty list.');
    return items[Math.floor(this.next() * items.length)];
  }
  /** A new generator whose sequence is independent of how much this one is used afterwards. */
  fork() {
    return new Rng(Math.floor(this.next() * 4294967296));
  }
}
