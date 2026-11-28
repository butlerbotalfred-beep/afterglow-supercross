import {Rng} from './rng';

/**
 * The twelve computer riders. They are made up: no name, number or colour is meant to be anybody's. Ratings run
 * from 0 to 100 and each one changes how the rider rides (see the functions below and `npcControl`).
 */
export interface RiderProfile {
  name: string;
  number: number;
  /** Number plate and bike colour. */
  plate: number;
  /** How fast the rider goes through corners. */
  corner: number;
  /** Pace through rhythm sections and how well landings are matched. */
  rhythm: number;
  /** Reaction to the gate. */
  starts: number;
  /** How readily the rider dives for the inside of a slower bike. */
  aggression: number;
  /** How rarely the rider makes a mistake. */
  consistency: number;
}
const rider = (
  name: string,
  number: number,
  plate: number,
  corner: number,
  rhythm: number,
  starts: number,
  aggression: number,
  consistency: number,
): RiderProfile => ({name, number, plate, corner, rhythm, starts, aggression, consistency});

/** One number for ordering the roster: mostly corner speed, then rhythm. */
export const overall = (p: RiderProfile) => p.corner * 0.6 + p.rhythm * 0.4;
/** Fastest first, by `overall`. */
export const ROSTER: RiderProfile[] = [
  rider('S. MORA', 7, 0xe44f63, 96, 92, 80, 70, 90),
  rider('K. NOVA', 12, 0x2f7fd6, 92, 97, 62, 55, 78),
  rider('J. REYES', 27, 0xffcf61, 84, 80, 95, 88, 66),
  rider('A. RIVERS', 14, 0x3fae6a, 82, 86, 70, 40, 94),
  rider('T. FOX', 51, 0xb04fc0, 83, 76, 85, 96, 52),
  rider('R. VALE', 38, 0xa19aff, 81, 84, 58, 62, 82),
  rider('M. PARK', 9, 0xe9ede4, 80, 72, 90, 74, 70),
  rider('D. OKORO', 63, 0x5fd6b0, 74, 79, 66, 50, 88),
  rider('L. HARTE', 72, 0x9c6b3f, 73, 66, 76, 84, 58),
  rider('E. SOLBERG', 19, 0x7fa6ff, 66, 70, 54, 45, 80),
  rider('C. IBARRA', 85, 0xd9c36a, 62, 58, 72, 66, 62),
  rider('B. QUILL', 44, 0xc48ad9, 55, 52, 60, 35, 72),
].sort((a, b) => overall(b) - overall(a));

/**
 * The computer riders on the grid for a pace setting, fastest first: a run of `count` neighbours in the roster,
 * so the field is close. Expert is the fastest of the roster, Relaxed the slowest, and Club starts with the
 * third fastest. The pace setting picks who races; it is not a speed multiplier.
 */
export function gridFor(difficulty: string, count: number): RiderProfile[] {
  const n = Math.min(count, ROSTER.length);
  const top =
    difficulty === 'expert' ? 0 : difficulty === 'relaxed' ? ROSTER.length - n : Math.min(2, ROSTER.length - n);
  return ROSTER.slice(top, top + n);
}

/**
 * Share of straight-line and cornering pace: what the single pace multiplier used to be. A corner rating of 84
 * is the old Club pace (0.92), 96 the old Expert pace (1.04) and 55 about the old Relaxed pace (0.80).
 */
export const cornerPace = (p: RiderProfile) => 0.92 + (p.corner - 84) * (p.corner > 84 ? 0.01 : 0.004);
/**
 * Pace on Relaxed. Relaxed has the slowest riders of the roster, but the middle of the roster is close together,
 * so on their own pace the Relaxed winner would be within 2% of the Club winner. Instead the roster's range of
 * corner pace is squeezed into 0.762 to 0.79: the fastest Relaxed rider is about where every Relaxed rider used
 * to be (0.78), and nobody is slow enough to come up short on the first jumps (the start check fails below 0.76).
 */
export const relaxedPace = (p: RiderProfile) => 0.762 + (cornerPace(p) - 0.804) * 0.25;
/** Entry pace through a rhythm section, as a share of the section's own pace. */
export const rhythmPace = (p: RiderProfile) => 0.975 + p.rhythm * 0.00045;
/** Radians a rider's landing pitch is out by: none for the best, a little nose-high for the rest. */
export const landingError = (p: RiderProfile) => Math.max(0, 85 - p.rhythm) * 0.0016;
/**
 * A rider's share of the seeded reaction time off the gate: a starts rating of 60 is 1, the old Club reaction;
 * 93 is 0.75, the old Expert one; 40 is 1.15, the old Relaxed one.
 */
export const startSharpness = (p: RiderProfile) => 1.45 - p.starts * 0.0075;
/** Riders who preload the face of a jump in a rhythm section. */
export const preloads = (p: RiderProfile) => p.rhythm >= 84;
/** Mistakes a lap: a consistency of 100 would never make one. */
export const mistakeRate = (p: RiderProfile) => (100 - p.consistency) * 0.006;

export type SlipKind = 'late' | 'flat' | 'wide';
export const SLIP_KINDS: SlipKind[] = ['late', 'flat', 'wide'];
const mix = (seed: number, a: number, b: number) => {
  const rng = new Rng((seed ^ Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca6b)) >>> 0);
  rng.next();
  return rng;
};
/**
 * The mistake a rider makes on a lap, or null: which kind, and `where` from 0 to 1 to pick the corner or jump.
 * Mistakes are spread evenly through a rider's laps at their rate, starting from a point that depends on the
 * race seed, so over many laps the count matches the rating and a race replays exactly.
 */
export function slipFor(seed: number, p: RiderProfile, lap: number): {kind: SlipKind; where: number} | null {
  const rate = mistakeRate(p);
  const phase = mix(seed, p.number, 0x51).next();
  if (Math.floor((lap + 1) * rate + phase) === Math.floor(lap * rate + phase)) return null;
  const rng = mix(seed, p.number, 0x1000 + lap);
  return {kind: SLIP_KINDS[Math.floor(rng.next() * SLIP_KINDS.length) % SLIP_KINDS.length], where: rng.next()};
}

/** The seeded order roster riders line up in on the grid. */
export function shuffled<T>(list: T[], seed: number) {
  const rng = new Rng((seed ^ 0x9e3779b1) >>> 0);
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
/** "#27 J. REYES" for a roster rider, the plain name for anybody else. */
export const riderLabel = (r: {name: string; profile?: RiderProfile}) =>
  r.profile ? `#${r.profile.number} ${r.name}` : r.name;

/** The catch-up assist leaves riders within this many metres of the last human alone, and is at full strength this far beyond. */
const ASSIST_NEAR = 40;
const ASSIST_FULL = 200;
/**
 * The catch-up assist's share of pace for a computer rider `gap` metres ahead of the last human (behind if
 * negative): down to 0.95 far ahead, up to 1.03 far behind, exactly 1 close by.
 */
export function catchUpEase(gap: number) {
  const far = Math.min(1, Math.max(0, (Math.abs(gap) - ASSIST_NEAR) / (ASSIST_FULL - ASSIST_NEAR)));
  return gap > 0 ? 1 - 0.05 * far : 1 + 0.03 * far;
}
