// Lap and sector timing with no browser in it. The sixteen timing planes in race.ts are grouped into four
// sectors; a crossing is timed to where inside the physics step it happened, so times are exact to well under
// a thousandth of a second even though physics runs in steps of 1/120 s.
import {CHECKPOINT_COUNT, type Progress} from './race';

export const SECTOR_COUNT = 4;
const GATES_PER_SECTOR = CHECKPOINT_COUNT / SECTOR_COUNT;

export interface LapTime {
  /** Seconds from crossing the line (or the start of the race, for lap 1) to crossing it again. */
  time: number;
  /** The four sector times. They add up to `time`. */
  sectors: number[];
  /** False when the rider was sent back from a shortcut during the lap. Such a lap cannot set a record. */
  valid: boolean;
}
/** The newest finished sector, kept for the on-screen flash. */
export interface SectorSplit {
  /** 0 to 3. */
  sector: number;
  time: number;
  /** Seconds against the same sector of the reference lap: negative is faster. Null with no reference. */
  delta: number | null;
  /** Race time when the sector ended. */
  at: number;
  /** Set when the sector ended a lap: the lap against the reference lap, or null with no reference. */
  lapDelta?: number | null;
}
export interface RiderTiming {
  lapStart: number;
  sectorStart: number;
  /** Sector times of the lap in progress. */
  sectors: number[];
  valid: boolean;
  /** The rider's shortcut count when this lap began. */
  shortcutsAtStart: number;
  laps: LapTime[];
  /** Fastest valid lap of this session. */
  best: LapTime | null;
  split: SectorSplit | null;
}

export function createTiming(startTime = 0): RiderTiming {
  return {
    lapStart: startTime,
    sectorStart: startTime,
    sectors: [],
    valid: true,
    shortcutsAtStart: 0,
    laps: [],
    best: null,
    split: null,
  };
}
/** The faster of two laps, ignoring missing ones. */
export function fasterLap(a: LapTime | null, b: LapTime | null) {
  return !a ? b : !b ? a : b.time < a.time ? b : a;
}
/**
 * Reads the timing planes a rider crossed in the physics step that began at `stepStart` and lasted `dt`, and
 * updates the rider's timing. `reference` is the lap sector times are compared with. Returns a lap when one was
 * completed in this step.
 */
export function recordStep(
  timing: RiderTiming,
  progress: Progress,
  stepStart: number,
  dt: number,
  reference: LapTime | null,
): LapTime | null {
  if (progress.shortcuts > timing.shortcutsAtStart) timing.valid = false;
  let completed: LapTime | null = null;
  for (const {gate, fraction} of progress.crossings) {
    if (gate % GATES_PER_SECTOR !== 0) continue;
    const at = stepStart + fraction * dt;
    const sector = timing.sectors.length;
    const time = at - timing.sectorStart;
    timing.sectors.push(time);
    timing.sectorStart = at;
    const against = reference?.sectors[sector];
    timing.split = {sector, time, delta: against === undefined ? null : time - against, at};
    // Plane 0 is the start/finish line. Reaching it always closes the lap, whatever was missed before it.
    if (gate === 0) {
      const lap = {
        time: at - timing.lapStart,
        sectors: timing.sectors,
        valid: timing.valid && sector === SECTOR_COUNT - 1,
      };
      timing.laps.push(lap);
      timing.split.lapDelta = reference ? lap.time - reference.time : null;
      if (lap.valid) timing.best = fasterLap(timing.best, lap);
      timing.lapStart = at;
      timing.sectors = [];
      timing.valid = true;
      timing.shortcutsAtStart = progress.shortcuts;
      completed = lap;
    }
  }
  progress.crossings.length = 0;
  return completed;
}
/** Seconds into the lap in progress. */
export const currentLapTime = (timing: RiderTiming, raceTime: number) => Math.max(0, raceTime - timing.lapStart);

/** 0:32.415 style. Minutes are dropped below one minute only when `short` is set. */
export function formatLap(seconds: number) {
  if (!Number.isFinite(seconds)) return '-:--.---';
  const ms = Math.round(Math.max(0, seconds) * 1000);
  const minutes = Math.floor(ms / 60000);
  return `${minutes}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}
/** +0.214 / -0.087 style. */
export function formatDelta(seconds: number) {
  const ms = Math.round(seconds * 1000);
  return `${ms < 0 ? '−' : '+'}${(Math.abs(ms) / 1000).toFixed(3)}`;
}
