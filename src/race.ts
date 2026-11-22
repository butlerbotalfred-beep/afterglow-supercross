/** Sixteen ordered timing planes make track progress independent of raw position. */
export const CHECKPOINT_COUNT = 16;
export const OFF_TRACK_FORWARD_LIMIT = 30;
interface Excursion {
  s: number;
  lateral: number;
  distance: number;
  forward: number;
}

/**
 * A timing plane credited in one physics step, and when it was crossed as a fraction of that step. 0 to 1 is
 * inside the step. It is negative when the plane was crossed in an earlier step and only credited now: while the
 * rider was briefly off the track, or sliding after a crash.
 */
export interface GateCrossing {
  gate: number;
  fraction: number;
}
/**
 * Movement whose plane credit is being held back (an off-track excursion or a crash slide), followed step by
 * step so each plane can still be timed at the moment it was really crossed.
 */
interface Deferred {
  /** The last position seen. */
  s: number;
  /** Metres forward since credit was last given. */
  forward: number;
  /** Seconds since credit was last given. */
  elapsed: number;
  /** Metres from where credit was last given to the next plane. */
  planeDistance: number;
  /** `elapsed` when each plane ahead was first reached, nearest plane first. */
  times: number[];
}

export interface Progress {
  /** Planes credited since lap timing last read them. Timing empties the list; nothing else depends on it. */
  crossings: GateCrossing[];
  /** How many times the rider has been off the route for long enough to be sent back (a shortcut attempt). */
  shortcuts: number;
  lap: number;
  nextCheckpoint: number;
  lastS: number;
  distanceSinceCheckpoint: number;
  routeBroken: boolean;
  offTrack: boolean;
  wrongWay: boolean;
  lastLateral: number;
  excursion: Excursion | null;
  /** Set while plane credit is held back. Only lap timing depends on it. */
  deferred: Deferred | null;
}

const wrap = (value: number, length: number) => ((value % length) + length) % length;
const shortestDelta = (from: number, to: number, length: number) => wrap(to - from + length / 2, length) - length / 2;

/** initialS may be negative for riders staged just behind the start line. */
export function createProgress(initialS = 0): Progress {
  return {
    crossings: [],
    shortcuts: 0,
    lap: 0,
    nextCheckpoint: 1,
    lastS: initialS,
    distanceSinceCheckpoint: initialS,
    routeBroken: false,
    offTrack: false,
    wrongWay: false,
    lastLateral: 0,
    excursion: null,
    deferred: null,
  };
}
/**
 * Follows movement whose plane credit is held back, noting when each plane ahead is first reached. Physics
 * calls this on each step of a crash slide; updateProgress calls it during an off-track excursion. It changes
 * nothing that decides progress, only the times later given to lap timing.
 */
export function trackDeferred(progress: Progress, s: number, trackLength: number, dt: number) {
  if (![s, trackLength, dt].every(Number.isFinite) || trackLength <= 0 || dt <= 0) return;
  const spacing = trackLength / CHECKPOINT_COUNT;
  const currentS = wrap(s, trackLength);
  if (!progress.deferred) {
    const from = wrap(progress.lastS, trackLength);
    const planeDistance = wrap(progress.nextCheckpoint * spacing - from, trackLength);
    progress.deferred = {
      s: from,
      forward: 0,
      elapsed: 0,
      planeDistance: planeDistance < 1e-7 ? trackLength : planeDistance,
      times: [],
    };
  }
  const d = progress.deferred;
  const delta = shortestDelta(d.s, currentS, trackLength);
  const after = d.forward + delta;
  while (delta > 0 && d.times.length < CHECKPOINT_COUNT) {
    const target = d.planeDistance + d.times.length * spacing;
    if (after < target) break;
    d.times.push(d.elapsed + Math.max(0, Math.min(1, (target - d.forward) / delta)) * dt);
  }
  d.s = currentS;
  d.forward = after;
  d.elapsed += dt;
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
  // Held-back movement is followed from the last credited position, which is where lastS still was.
  if (progress.deferred || progress.offTrack || teleport) {
    progress.lastS = previousS;
    trackDeferred(progress, currentS, trackLength, dt);
    progress.lastS = currentS;
  }
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
    if ((teleport || exit.forward > OFF_TRACK_FORWARD_LIMIT) && !progress.routeBroken) {
      progress.routeBroken = true;
      progress.shortcuts += 1;
    }
    if (progress.routeBroken) {
      // Returning to the departure point under your own power is also valid.
      if (!progress.offTrack && Math.abs(shortestDelta(exit.s, currentS, trackLength)) < 1) {
        exit.forward = shortestDelta(exit.s, currentS, trackLength);
        progress.distanceSinceCheckpoint = exit.distance;
        progress.routeBroken = false;
        // Back at the departure point: anything reached while away does not count.
        progress.deferred = null;
      } else return false;
    }
    if (progress.offTrack) return false;
    creditDelta = exit.forward;
    creditStart = exit.s;
    progress.excursion = null;
  }

  const deferred = progress.deferred;
  progress.deferred = null;
  progress.distanceSinceCheckpoint += creditDelta;
  if (creditDelta <= 0) return false;
  let completedLap = false;
  let crossed = 0;
  // A forgiven excursion may cross more than one timing plane on short tracks.
  let distanceToPlane = wrap(progress.nextCheckpoint * spacing - creditStart, trackLength);
  if (distanceToPlane < 1e-7) distanceToPlane = trackLength;
  while (distanceToPlane <= creditDelta + 1e-7 && progress.distanceSinceCheckpoint >= spacing - 1e-5) {
    progress.distanceSinceCheckpoint -= spacing;
    // When the plane was crossed. Held-back movement was followed step by step, so a plane passed while off
    // the track or sliding is timed when it was passed, not when the credit arrives.
    const reached = deferred?.times[crossed];
    const intoStep = distanceToPlane - (creditDelta - delta);
    const fraction =
      deferred && reached !== undefined
        ? 1 - (deferred.elapsed - reached) / dt
        : delta > 0
          ? Math.max(0, Math.min(1, intoStep / delta))
          : 0;
    crossed += 1;
    // Tools that step riders without reading lap times must not let the list grow for ever.
    if (progress.crossings.length >= CHECKPOINT_COUNT * 2) progress.crossings.shift();
    progress.crossings.push({gate: progress.nextCheckpoint, fraction});
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
  progress.deferred = null;
  progress.routeBroken = false;
  progress.offTrack = false;
  progress.wrongWay = false;
  return {s: exit.s, lateral: exit.lateral};
}
