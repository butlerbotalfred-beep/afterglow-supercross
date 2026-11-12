/** Sixteen ordered timing planes make track progress independent of raw position. */
export const CHECKPOINT_COUNT = 16;
export const OFF_TRACK_FORWARD_LIMIT = 30;
interface Excursion {
  s: number;
  lateral: number;
  distance: number;
  forward: number;
}

export interface Progress {
  lap: number;
  nextCheckpoint: number;
  lastS: number;
  distanceSinceCheckpoint: number;
  routeBroken: boolean;
  offTrack: boolean;
  wrongWay: boolean;
  lastLateral: number;
  excursion: Excursion | null;
}

const wrap = (value: number, length: number) => ((value % length) + length) % length;
const shortestDelta = (from: number, to: number, length: number) => wrap(to - from + length / 2, length) - length / 2;

/** initialS may be negative for riders staged just behind the start line. */
export function createProgress(initialS = 0): Progress {
  return {
    lap: 0,
    nextCheckpoint: 1,
    lastS: initialS,
    distanceSinceCheckpoint: initialS,
    routeBroken: false,
    offTrack: false,
    wrongWay: false,
    lastLateral: 0,
    excursion: null,
  };
}

/** Returns true only on a newly completed lap, after all sixteen planes. */
export function updateProgress(
  progress: Progress,
  s: number,
  lateral: number,
  trackLength: number,
  halfWidth: number,
  dt: number,
): boolean {
  if (![s, lateral, trackLength, halfWidth, dt].every(Number.isFinite) || trackLength <= 0 || halfWidth <= 0 || dt <= 0)
    return false;

  const spacing = trackLength / CHECKPOINT_COUNT;
  const previousS = wrap(progress.lastS, trackLength);
  const currentS = wrap(s, trackLength);
  const delta = shortestDelta(previousS, currentS, trackLength);
  const previousLateral = progress.lastLateral;
  progress.lastS = currentS;
  progress.lastLateral = lateral;
  progress.offTrack = Math.abs(lateral) > halfWidth;
  progress.wrongWay = delta < -0.05;

  // Freeze gate credit while outside. A short excursion is credited only on
  // re-entry; a shortcut always retains the original departure point.
  const teleport = Math.abs(delta) > spacing + 1e-7;
  if (!progress.excursion && (progress.offTrack || teleport)) {
    progress.excursion = {
      s: previousS,
      lateral: previousLateral,
      distance: progress.distanceSinceCheckpoint,
      forward: 0,
    };
  }
  let creditDelta = delta;
  let creditStart = previousS;
  const exit = progress.excursion;
  if (exit) {
    exit.forward += delta;
    if (teleport || exit.forward > OFF_TRACK_FORWARD_LIMIT) progress.routeBroken = true;
    if (progress.routeBroken) {
      // Returning to the departure point under your own power is also valid.
      if (!progress.offTrack && Math.abs(shortestDelta(exit.s, currentS, trackLength)) < 1) {
        exit.forward = shortestDelta(exit.s, currentS, trackLength);
        progress.distanceSinceCheckpoint = exit.distance;
        progress.routeBroken = false;
      } else return false;
    }
    if (progress.offTrack) return false;
    creditDelta = exit.forward;
    creditStart = exit.s;
    progress.excursion = null;
  }

  progress.distanceSinceCheckpoint += creditDelta;
  if (creditDelta <= 0) return false;
  let completedLap = false;
  // A forgiven excursion may cross more than one timing plane on short tracks.
  let distanceToPlane = wrap(progress.nextCheckpoint * spacing - creditStart, trackLength);
  if (distanceToPlane < 1e-7) distanceToPlane = trackLength;
  while (distanceToPlane <= creditDelta + 1e-7 && progress.distanceSinceCheckpoint >= spacing - 1e-5) {
    progress.distanceSinceCheckpoint -= spacing;
    if (progress.nextCheckpoint === 0) {
      progress.lap += 1;
      progress.nextCheckpoint = 1;
      completedLap = true;
    } else progress.nextCheckpoint = (progress.nextCheckpoint + 1) % CHECKPOINT_COUNT;
    distanceToPlane += spacing;
  }
  return completedLap;
}

/** Monotonic gate credit plus only the currently validated segment of the course. */
export function progressDistance(progress: Progress, trackLength: number): number {
  const spacing = trackLength / CHECKPOINT_COUNT;
  const previousCheckpoint = (progress.nextCheckpoint + CHECKPOINT_COUNT - 1) % CHECKPOINT_COUNT;
  return (
    progress.lap * trackLength +
    previousCheckpoint * spacing +
    Math.max(0, Math.min(spacing, progress.distanceSinceCheckpoint))
  );
}

/** Undo only the off-track excursion, preserving every previously earned metre. */
export function restoreDeparture(progress: Progress): {s: number; lateral: number} | null {
  const exit = progress.excursion;
  if (!exit) return null;
  progress.lastS = exit.s;
  progress.lastLateral = exit.lateral;
  progress.distanceSinceCheckpoint = exit.distance;
  progress.excursion = null;
  progress.routeBroken = false;
  progress.offTrack = false;
  progress.wrongWay = false;
  return {s: exit.s, lateral: exit.lateral};
}
