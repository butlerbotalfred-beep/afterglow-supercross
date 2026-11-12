// Headless simulation helpers shared by the pace gate and the landing harness.
// They mirror the game loop at a fixed 120 Hz step, so results are exactly repeatable.
import {Track} from '../src/track';
import {COURSES, type Course} from '../src/courses';
import {makeRider, stepRider, npcControl, collide} from '../src/physics';

export const STEP = 1 / 120;
export const LAPS = 3;

export interface RaceResult {
  course: string;
  difficulty: string;
  winner: number;
  crashes: number;
  recoveries: number;
  finishers: number;
}

/** Four NPC riders race three laps; returns the winning time in seconds. */
export function aiRace(course: Course, difficulty: string, riderCount = 4, maxSeconds = 650): RaceResult {
  const track = new Track(course);
  const riders = Array.from({length: riderCount}, (_, id) => makeRider(track, id, false, 0xffffff));
  const times = new Map<number, number>();
  let recoveries = 0;
  for (let f = 0; f < maxSeconds / STEP && times.size < riderCount; f++) {
    for (const r of riders) {
      const before = r.recovery;
      stepRider(r, npcControl(r, track, riders, difficulty), track, STEP, riders);
      if (!before && r.recovery > 0) recoveries++;
      if (r.progress.lap >= LAPS && !times.has(r.id)) times.set(r.id, (f + 1) * STEP);
    }
    collide(riders, track);
  }
  return {
    course: course.id,
    difficulty,
    winner: round(Math.min(...times.values())),
    crashes: riders.reduce((n, r) => n + r.crashes, 0),
    recoveries,
    finishers: times.size,
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

export const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
export {COURSES};
