// Headless simulation helpers shared by the pace gate and the landing harness.
// They mirror the game loop at a fixed 120 Hz step, so results are exactly repeatable.
import {Track} from '../src/track';
import {COURSES, type Course} from '../src/courses';
import {makeRider, stepRider, npcControl, collide} from '../src/physics';
import {StartGate, pastHoleshot} from '../src/gate';
import {gridFor, shuffled} from '../src/riders';

export const STEP = 1 / 120;
export const LAPS = 3;

export interface RaceResult {
  course: string;
  difficulty: string;
  winner: number;
  /** The last finisher's time in seconds. */
  last: number;
  crashes: number;
  recoveries: number;
  finishers: number;
  /** The largest speed any single landing added in the race, in km/h. */
  maxBonusKmh?: number;
}

/** Four NPC riders race three laps; returns the winning time in seconds. A `seed` lets them make mistakes. */
export function aiRace(course: Course, difficulty: string, riderCount = 4, maxSeconds = 650, seed = 0): RaceResult {
  const track = new Track(course);
  const riders = Array.from({length: riderCount}, (_, id) => makeRider(track, id, false, 0xffffff));
  const times = new Map<number, number>();
  let recoveries = 0;
  let maxBonus = 0;
  for (let f = 0; f < maxSeconds / STEP && times.size < riderCount; f++) {
    for (const r of riders) {
      const before = r.recovery;
      stepRider(r, npcControl(r, track, riders, difficulty, seed), track, STEP, riders);
      if (!before && r.recovery > 0) recoveries++;
      maxBonus = Math.max(maxBonus, r.landingBonus);
      if (r.progress.lap >= LAPS && !times.has(r.id)) times.set(r.id, (f + 1) * STEP);
    }
    collide(riders, track);
  }
  return {
    course: course.id,
    difficulty,
    winner: round(Math.min(...times.values())),
    last: round(Math.max(...times.values())),
    crashes: riders.reduce((n, r) => n + r.crashes, 0),
    recoveries,
    finishers: times.size,
    maxBonusKmh: round(maxBonus * 3.6),
  };
}

/** One NPC rider alone for three laps. `nopitch` forces air pitch input to zero. */
export function soloLaps(course: Course, mode: 'match' | 'nopitch', difficulty = 'club', maxSeconds = 900) {
  const track = new Track(course);
  const r = makeRider(track, 0, false, 0xffffff);
  const riders = [r];
  let f = 0;
  for (; f < maxSeconds / STEP && r.progress.lap < LAPS; f++) {
    const c = npcControl(r, track, riders, difficulty);
    if (mode === 'nopitch') c.pitch = 0;
    stepRider(r, c, track, STEP, riders);
  }
  return {seconds: f * STEP, crashes: r.crashes, finished: r.progress.lap >= LAPS};
}

export interface RosterResult {
  /** Finishers in order: the rider's roster name and time in seconds. */
  order: {name: string; time: number}[];
  gap: number;
  dnfs: number;
  crashes: number;
  recoveries: number;
  /** The longest any rider stood still after leaving the gate, in seconds. */
  longestStop: number;
  slips: number;
}
/**
 * A race as the game runs it with no humans: roster riders for the pace setting, a gate start, mistakes from
 * the seed after the holeshot line. `fallible` false gives the riders no mistakes.
 */
export function rosterRace(course: Course, difficulty: string, riderCount: number, seed: number, fallible = true) {
  const track = new Track(course);
  const profiles = shuffled(gridFor(difficulty, riderCount), seed);
  const riders = profiles.map((profile, id) =>
    Object.assign(makeRider(track, id, false, profile.plate), {profile, name: profile.name}),
  );
  const gate = new StartGate(seed, riders, difficulty);
  while (!gate.wait(STEP, () => null).dropped);
  const times = new Map<number, number>();
  const still = riders.map(() => 0);
  let recoveries = 0,
    longestStop = 0;
  for (let f = 0; f < 900 / STEP && times.size < riders.length; f++) {
    riders.forEach((r, index) => {
      if (times.has(r.id) || !gate.release(index, r)) return;
      const before = r.recovery;
      const line = pastHoleshot(r.progress, track);
      stepRider(r, npcControl(r, track, riders, difficulty, fallible && line ? seed : 0), track, STEP, riders);
      if (!before && r.recovery > 0) recoveries++;
      still[index] = r.speed < 0.5 ? still[index] + STEP : 0;
      longestStop = Math.max(longestStop, still[index]);
      if (r.progress.lap >= LAPS) times.set(r.id, (f + 1) * STEP);
    });
    collide(riders, track);
  }
  const order = [...times]
    .sort((a, b) => a[1] - b[1])
    .map(([id, time]) => ({name: riders[id].name, time: round(time)}));
  const result: RosterResult = {
    order,
    gap: order.length ? round(order.at(-1)!.time - order[0].time) : 0,
    dnfs: riders.length - order.length,
    crashes: riders.reduce((n, r) => n + r.crashes, 0),
    recoveries,
    longestStop: round(longestStop),
    slips: riders.reduce((n, r) => n + (r.slips ?? 0), 0),
  };
  return result;
}

export const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
export {COURSES};
