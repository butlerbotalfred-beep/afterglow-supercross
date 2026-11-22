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
/** The most jumps counted as one lane. */
const LANE_JUMPS = 12;

type Jump = Track['jumps'][number];
interface Advice {
  jump: Jump;
  /** Where the takeoff ramp ends. */
  lip: number;
  /** The hardest landing after taking this jump alone at each tabulated speed, in m/s into the ground. */
  own: number[] | null;
  /** The same over this jump and the rest of its rhythm lane. */
  impact: number[] | null;
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
/** The lips of a track in order, with each jump's own landings worked out only when first needed. */
function table(track: Track) {
  let advice = tables.get(track);
  if (!advice) {
    advice = track.jumps
      .map(jump => ({jump, lip: (jump.start + jump.rise) % track.length, own: null, impact: null}))
      .sort((a, b) => a.lip - b.lip);
    tables.set(track, advice);
  }
  return advice;
}
function ownImpact(track: Track, a: Advice) {
  if (!a.own) {
    a.own = [];
    for (let v = SPEED_MIN; v <= TUNING.maxSpeed + 1e-9; v += SPEED_STEP) a.own.push(hardestLanding(track, a.jump, v));
  }
  return a.own;
}
/**
 * The hardest landing at each speed over this jump and the rest of its rhythm lane. A rider lands from one jump
 * of a lane with no room to change speed before the next, so a speed is only as safe as the rest of the lane
 * lets it be. The lane may run across the finish line.
 */
function laneImpact(track: Track, advice: Advice[], index: number) {
  const first = advice[index];
  if (!first.impact) {
    let impact = ownImpact(track, first);
    for (let k = 1, at = index; k < Math.min(advice.length, LANE_JUMPS); k++) {
      const following = (at + 1) % advice.length;
      const gap = (((advice[following].lip - advice[at].lip) % track.length) + track.length) % track.length;
      if (gap > LANE_SPACING) break;
      const own = ownImpact(track, advice[following]);
      impact = impact.map((hardest, v) => Math.max(hardest, own[v]));
      at = following;
    }
    first.impact = impact;
  }
  return first.impact;
}
/**
 * Works ahead on a track's takeoff advice for up to `budgetMs`, and returns true once all of it is ready. Advice
 * is otherwise worked out as each lane is first approached; calling this between frames avoids that hitch.
 */
export function prepareTakeoffAdvice(track: Track, budgetMs = Infinity) {
  const advice = table(track),
    started = performance.now();
  let worked = false;
  for (let i = 0; i < advice.length; i++) {
    if (advice[i].impact) continue;
    // Always one lane per call, so even a zero budget finishes in the end.
    if (worked && performance.now() - started >= budgetMs) return false;
    laneImpact(track, advice, i);
    worked = true;
  }
  return true;
}
/** The nearest lip within `reach` metres ahead of `s`, as an index into the table and a distance. */
function nextLip(track: Track, s: number, reach: number) {
  const advice = table(track);
  let index = -1,
    distance = reach;
  for (let i = 0; i < advice.length; i++) {
    const d = (((advice[i].lip - s) % track.length) + track.length) % track.length;
    if (d <= distance) {
      distance = d;
      index = i;
    }
  }
  return index < 0 ? null : {index, distance};
}
/**
 * The speed to take the next jump at: the highest safe speed between `slowest` and `fastest`, the range the
 * rider can still reach before the lip. Returns null when no lip lies within `reach` metres ahead of `s`, and
 * the nearest safe speed outside the range when nothing inside it is safe.
 */
export function safeTakeoffSpeed(track: Track, s: number, reach: number, slowest: number, fastest: number) {
  const lip = nextLip(track, s, reach);
  // Below the slowest tabulated speed the bike cannot leave the ground far enough to matter.
  if (!lip || fastest < SPEED_MIN) return null;
  const impact = laneImpact(track, table(track), lip.index);
  const limit = TUNING.landingCrashImpact * SAFE_IMPACT_SHARE;
  // Safe means clear of the crash limit at this speed and at every speed within SPEED_MARGIN of it.
  const safe = (i: number) => {
    for (let k = Math.max(0, i - SPEED_MARGIN); k <= Math.min(impact.length - 1, i + SPEED_MARGIN); k++)
      if (impact[k] > limit) return false;
    return true;
  };
  const speed = (i: number) => SPEED_MIN + i * SPEED_STEP;
  const top = Math.min(impact.length - 1, Math.floor((fastest - SPEED_MIN) / SPEED_STEP));
  const bottom = Math.max(0, Math.ceil((slowest - SPEED_MIN) / SPEED_STEP));
  for (let i = top; i >= bottom; i--) if (safe(i)) return Math.min(fastest, speed(i));
  for (let off = 1; off < impact.length; off++) {
    if (bottom - off >= 0 && safe(bottom - off)) return speed(bottom - off);
    if (top + off < impact.length && safe(top + off)) return speed(top + off);
  }
  return null;
}
export const lipDistance = (track: Track, s: number, reach: number) => nextLip(track, s, reach)?.distance ?? null;

/** What the HUD tells a rider about the jumps coming up. Speeds are in m/s. */
export interface JumpCall {
  /** TABLETOP, SINGLE, DOUBLE, TRIPLE, RHYTHM ×N or WHOOPS. */
  kind: string;
  /** Metres to the first lip of the lane, 0 once the rider is in it. */
  distance: number;
  /** The takeoff speeds that land the whole lane most smoothly. */
  ideal: [number, number];
  /** The first tabulated speed and the step between them, for drawing `zones`. */
  from: number;
  step: number;
  /** One entry per tabulated speed: lands hard enough to crash, lands roughly, or lands well. */
  zones: ('crash' | 'rough' | 'good')[];
}
/** Below this a rider is rolling the jumps, which is never the speed to aim for. */
const ROLLING_SPEED = 20;
const calls = new WeakMap<Advice, Omit<JumpCall, 'distance'>>();

function describeLane(track: Track, advice: Advice[], first: number) {
  const cached = calls.get(advice[first]);
  if (cached) return cached;
  let count = 1;
  for (let at = first; count < Math.min(advice.length, LANE_JUMPS); count++) {
    const following = (at + 1) % advice.length;
    const gap = (((advice[following].lip - advice[at].lip) % track.length) + track.length) % track.length;
    if (gap > LANE_SPACING) break;
    at = following;
  }
  const jump = advice[first].jump;
  const kind =
    jump.flat >= 6
      ? 'TABLETOP'
      : jump.rise <= 6 && count >= 3
        ? 'WHOOPS'
        : count === 1
          ? 'SINGLE'
          : count === 2
            ? 'DOUBLE'
            : count === 3
              ? 'TRIPLE'
              : `RHYTHM ×${count}`;
  const impact = laneImpact(track, advice, first);
  const limit = TUNING.landingCrashImpact * SAFE_IMPACT_SHARE;
  const speed = (i: number) => SPEED_MIN + i * SPEED_STEP;
  const crash = (i: number) => i >= 0 && i < impact.length && impact[i] > limit;
  const clear = (i: number) => ![i - 2, i - 1, i, i + 1, i + 2].some(crash);
  const score = (i: number) => (impact[i - 1] + impact[i] + impact[i + 1]) / 3;
  let best = -1,
    bestScore = Infinity;
  // Most lanes have a band of speeds that comes up short. The speed to race at is above it: the smoothest three
  // neighbouring speeds there that are not next to a crashing speed.
  const short = impact.findIndex((_, i) => crash(i));
  if (short >= 0) {
    let cleared = short;
    while (crash(cleared + 1)) cleared++;
    for (let i = cleared + 2; i <= impact.length - 2; i++)
      if (clear(i) && score(i) < bestScore) {
        best = i;
        bestScore = score(i);
      }
  }
  // Otherwise (a tabletop, or nothing safe above the short band): the fastest three that land without scrubbing
  // speed and are not rolling pace, or failing that the smoothest three.
  if (best < 0)
    for (let i = impact.length - 2; i >= 1 && speed(i - 1) >= ROLLING_SPEED; i--) {
      if (!clear(i)) continue;
      if (score(i) < bestScore) {
        best = i;
        bestScore = score(i);
      }
      if (score(i) <= ROUGH_IMPACT) break;
    }
  // No such window (a very awkward custom jump): fall back to the gentlest single speed.
  if (best < 0) best = impact.indexOf(Math.min(...impact));
  let low = best,
    high = best;
  const smooth = (i: number) => i >= 0 && i < impact.length && !crash(i) && impact[i] <= bestScore + 2;
  while (high - low < IDEAL_WIDTH && smooth(high + 1) && !crash(high + 2)) high++;
  while (high - low < IDEAL_WIDTH && smooth(low - 1) && !crash(low - 2)) low--;
  const call = {
    kind,
    ideal: [speed(low), speed(high)] as [number, number],
    from: SPEED_MIN,
    step: SPEED_STEP,
    zones: impact.map(hit => (hit > limit ? 'crash' : hit > ROUGH_IMPACT ? 'rough' : 'good')) as JumpCall['zones'],
  };
  calls.set(advice[first], call);
  return call;
}
/** The widest ideal band, in tabulated steps. */
const IDEAL_WIDTH = 5;
/** A landing harder than this, in m/s into the ground, starts to scrub speed. */
const ROUGH_IMPACT = 12;

/**
 * The lane of jumps the rider is in or coming up to within `reach` metres, or null. A rider between two jumps
 * of a lane still gets the call for the whole lane, so the advice does not change halfway through it.
 */
export function jumpCall(track: Track, s: number, reach: number): JumpCall | null {
  const advice = table(track);
  const lip = nextLip(track, s, reach);
  if (!lip) return null;
  // Walk back to the first jump of the lane this lip belongs to.
  let first = lip.index,
    inside = false;
  for (let k = 1; k < Math.min(advice.length, LANE_JUMPS); k++) {
    const before = (first - 1 + advice.length) % advice.length;
    const gap = (((advice[first].lip - advice[before].lip) % track.length) + track.length) % track.length;
    if (gap > LANE_SPACING) break;
    first = before;
    inside = true;
  }
  // "Inside" only if the rider is really past the lane's first lip, not just nearer a later one.
  const toFirst = (((advice[first].lip - s) % track.length) + track.length) % track.length;
  inside = inside && toFirst > lip.distance && toFirst > track.length / 2;
  return {...describeLane(track, advice, first), distance: inside ? 0 : toFirst};
}
