// The sound samples, worked out as plain numbers when sound first starts. Nothing is downloaded and nothing
// here needs a browser. Every one-shot begins and ends at silence, so playing it can never click.
import {Rng} from '../rng';

const samples = (seconds: number, rate: number) => new Float32Array(Math.max(1, Math.round(seconds * rate)));

/** Blends the end of a loop into its start so it repeats without a step. */
function seamless(data: Float32Array, rate: number, seconds = 0.05) {
  const n = Math.min(Math.round(seconds * rate), data.length >> 1);
  for (let i = 0; i < n; i++) {
    const mix = i / n,
      tail = data.length - n + i;
    data[i] = data[i] * mix + data[tail] * (1 - mix);
  }
  return data.subarray(0, data.length - n);
}
/** Hiss, for engine breath and dirt spray. Loops. */
export function hiss(rate: number, seconds = 2, seed = 11) {
  const out = samples(seconds, rate),
    rng = new Rng(seed);
  for (let i = 0; i < out.length; i++) out[i] = rng.next() * 2 - 1;
  return out;
}
/** A far-off crowd: low rumbling noise that rises and falls slowly. Loops. */
export function crowd(rate: number, seconds = 4, seed = 23) {
  const out = samples(seconds, rate),
    rng = new Rng(seed);
  let low = 0,
    band = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / out.length,
      white = rng.next() * 2 - 1;
    low += (white - low) * 0.09;
    band += (low - band) * 0.02;
    // Whole numbers of slow waves across the loop, so the rise and fall also repeats without a step.
    const breath = 0.72 + 0.18 * Math.sin(2 * Math.PI * 3 * t) + 0.1 * Math.sin(2 * Math.PI * 7 * t + 1.3);
    out[i] = (low - band) * 3.2 * breath;
  }
  return seamless(out, rate, 0.2);
}
/** Pops and bangs from the exhaust with the throttle shut. Loops. */
export function crackle(rate: number, seconds = 1.6, seed = 37) {
  const out = samples(seconds, rate),
    rng = new Rng(seed);
  let at = 0;
  while (at < out.length - rate * 0.03) {
    const length = Math.round(rate * rng.range(0.006, 0.02)),
      loud = rng.range(0.35, 1);
    let low = 0;
    for (let i = 0; i < length; i++) {
      low += (rng.next() * 2 - 1 - low) * 0.35;
      out[at + i] += low * loud * Math.sin((Math.PI * i) / length) * Math.exp((-4 * i) / length);
    }
    at += length + Math.round(rate * rng.range(0.02, 0.11));
  }
  return out;
}
/** A landing: a low thump with a little grit on top. */
export function thud(rate: number, seed = 41) {
  const out = samples(0.26, rate),
    rng = new Rng(seed);
  let phase = 0,
    low = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate,
      fade = Math.min(1, t * 600, (out.length - i) / (0.02 * rate));
    phase += (2 * Math.PI * (48 + 60 * Math.exp(-t * 26))) / rate;
    low += (rng.next() * 2 - 1 - low) * 0.12;
    out[i] = (Math.sin(phase) * Math.exp(-t * 15) + low * 0.6 * Math.exp(-t * 34) * Math.min(1, t * 400)) * fade;
  }
  return out;
}
/** A crash: a crunch of plastic and dirt with a couple of metal rings. */
export function crash(rate: number, seed = 53) {
  const out = samples(0.7, rate),
    rng = new Rng(seed);
  const rings = [rng.range(700, 1100), rng.range(1500, 2300)];
  let low = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate,
      fade = Math.min(1, t * 300, (out.length - i) / (0.03 * rate));
    low += (rng.next() * 2 - 1 - low) * 0.3;
    const scrape = low * (Math.exp(-t * 9) + 0.5 * Math.exp(-((t - 0.16) ** 2) * 900));
    const ring = rings.reduce((sum, hz, n) => sum + Math.sin(2 * Math.PI * hz * t) * Math.exp(-t * (14 + 6 * n)), 0);
    out[i] = (scrape + ring * 0.12) * fade;
  }
  return out;
}
/** The start gate hitting the ground: a hard metal clang with a rattle after it. */
export function clang(rate: number, seed = 71) {
  const out = samples(0.55, rate),
    rng = new Rng(seed);
  const partials = [523, 1187, 1710, 2630, 3940].map((hz, n) => ({hz: hz * rng.range(0.98, 1.02), decay: 9 + n * 5}));
  let low = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate,
      fade = Math.min(1, t * 900, (out.length - i) / (0.03 * rate));
    low += (rng.next() * 2 - 1 - low) * 0.5;
    const ring = partials.reduce(
      (sum, p, n) => sum + (Math.sin(2 * Math.PI * p.hz * t) * Math.exp(-t * p.decay)) / (n + 1),
      0,
    );
    // The bar bounces once: a second, softer hit a moment later.
    const bounce = t > 0.09 ? Math.sin(2 * Math.PI * 1187 * (t - 0.09)) * Math.exp(-(t - 0.09) * 22) * 0.35 : 0;
    out[i] = (ring * 0.5 + bounce + low * 0.8 * Math.exp(-t * 60)) * fade * 0.8;
  }
  return out;
}
/** One or more notes played in a row, each `seconds` long. Used for the countdown, lap and finish. */
export function tones(rate: number, hz: number[], seconds: number, ring = 6) {
  const each = Math.round(seconds * rate),
    out = new Float32Array(each * hz.length);
  hz.forEach((note, n) => {
    for (let i = 0; i < each; i++) {
      const t = i / rate,
        fade = Math.min(1, t * 250, (each - i) / (0.01 * rate));
      const wave = Math.sin(2 * Math.PI * note * t) + 0.3 * Math.sin(4 * Math.PI * note * t);
      out[n * each + i] = wave * Math.exp((-ring * i) / each) * fade * 0.7;
    }
  });
  return out;
}
