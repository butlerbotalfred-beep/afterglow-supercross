// Takeoff advice: for every jump on a track, what happens when it is taken at each speed. The AI uses it to
// avoid the speeds that end on the face of the next jump. Flights are worked out along the centre line with the
// same step and the same takeoff and landing rules as physics.ts.
import {TUNING} from './config';
import type {Track} from './track';

/** Speeds are tabulated from SPEED_MIN in steps of SPEED_STEP up to the top speed. */
const SPEED_MIN = 6;
const SPEED_STEP = 1;
/** A predicted impact above this share of the crash limit counts as a crash. */
export const SAFE_IMPACT_SHARE = 1;
/** How many tabulated speeds either side of a crashing speed are also avoided. */
const SPEED_MARGIN = 2;
/** Jumps whose lips are no further apart than this are ridden as one lane. */
const LANE_SPACING = 40;

type Jump = Track['jumps'][number];
interface Advice {
  /** Where the takeoff ramp ends. */
  lip: number;
  /** The hardest landing after taking the jump at each tabulated speed, in m/s into the ground. */
  impact: number[];
}
const tables = new WeakMap<Track, Advice[]>();

/** The hardest landing a rider meets between the foot of `jump` and the ground beyond it, entering at `speed`. */
export function hardestLanding(track: Track, jump: Jump, speed: number) {
  const dt = TUNING.step,
    end = jump.start + jump.rise + jump.flat + jump.fall;
  let s = jump.start - 1,
    y = track.height(s),
    vy = 0,
    v = speed,
    grounded = true,
    hardest = 0;
  for (let step = 0; step < 6 / dt; step++) {
    const prevY = y;
    s += v * dt;
    const floor = track.height(s);
    if (grounded) {
      const ballistic = prevY + vy * dt - TUNING.gravity * dt * dt * 0.5;
      if (ballistic > floor + 0.00035 && v > 5) {
        grounded = false;
        y = ballistic;
        vy -= TUNING.gravity * dt;
      } else {
        if (s > end) break;
        y = floor;
        vy = Math.max(-20, Math.min(20, (floor - prevY) / dt));
      }
    } else {
      v -= 0.08 * v * dt;
      vy -= TUNING.gravity * dt;
      y += vy * dt;
      if (y <= floor) {
        const slope = (track.height(s + 0.42) - floor) / 0.42;
        hardest = Math.max(hardest, Math.abs(vy - v * slope) / Math.sqrt(1 + slope * slope));
        grounded = true;
        y = floor;
        vy = 0;
      }
    }
  }
  return hardest;
}
function table(track: Track) {
  let advice = tables.get(track);
  if (!advice) {
    advice = track.jumps
      .map(jump => {
        const impact: number[] = [];
        for (let v = SPEED_MIN; v <= TUNING.maxSpeed + 1e-9; v += SPEED_STEP)
          impact.push(hardestLanding(track, jump, v));
        return {lip: jump.start + jump.rise, impact};
      })
      .sort((a, b) => a.lip - b.lip);
    // A rider lands from one jump of a rhythm lane with no room to change speed before the next, so a speed is
    // only as safe as the rest of the lane lets it be.
    for (let i = advice.length - 2; i >= 0; i--)
      if (advice[i + 1].lip - advice[i].lip <= LANE_SPACING)
        advice[i].impact = advice[i].impact.map((impact, v) => Math.max(impact, advice![i + 1].impact[v]));
    tables.set(track, advice);
  }
  return advice;
}
/**
 * The speed to take the next jump at: the highest safe speed between `slowest` and `fastest`, the range the
 * rider can still reach before the lip. Returns null when no lip lies within `reach` metres ahead of `s`, and
 * the nearest safe speed outside the range when nothing inside it is safe.
 */
export function safeTakeoffSpeed(track: Track, s: number, reach: number, slowest: number, fastest: number) {
  let next: Advice | null = null,
    distance = reach;
  for (const a of table(track)) {
    const d = (((a.lip - s) % track.length) + track.length) % track.length;
    if (d <= distance) {
      distance = d;
      next = a;
    }
  }
  if (!next) return null;
  const limit = TUNING.landingCrashImpact * SAFE_IMPACT_SHARE;
  // Safe means clear of the crash limit at this speed and at every speed within SPEED_MARGIN of it.
  const safe = (i: number) => {
    for (let k = Math.max(0, i - SPEED_MARGIN); k <= Math.min(next!.impact.length - 1, i + SPEED_MARGIN); k++)
      if (next!.impact[k] > limit) return false;
    return true;
  };
  const speed = (i: number) => SPEED_MIN + i * SPEED_STEP;
  const top = Math.min(next.impact.length - 1, Math.floor((fastest - SPEED_MIN) / SPEED_STEP));
  const bottom = Math.max(0, Math.ceil((slowest - SPEED_MIN) / SPEED_STEP));
  for (let i = top; i >= bottom; i--) if (safe(i)) return Math.min(fastest, speed(i));
  for (let off = 1; off < next.impact.length; off++) {
    if (bottom - off >= 0 && safe(bottom - off)) return speed(bottom - off);
    if (top + off < next.impact.length && safe(top + off)) return speed(top + off);
  }
  return null;
}
export const lipDistance = (track: Track, s: number, reach: number) => {
  let distance: number | null = null;
  for (const a of table(track)) {
    const d = (((a.lip - s) % track.length) + track.length) % track.length;
    if (d <= (distance ?? reach)) distance = d;
  }
  return distance;
};
/** Builds a track's takeoff advice ahead of time (about half a second on the longest circuit), so the first AI step does not stall. */
export const prepareTakeoffAdvice = (track: Track) => void table(track);
