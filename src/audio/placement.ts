// Which bikes are heard, and where. A browser has one pair of ears and split screen has up to four cameras, so
// each bike is placed by the human camera nearest to it. No browser in here, so tests can check it.

/** A camera's place on the ground and the way it looks (radians, 0 looks along +z, as rider headings do). */
export interface Listener {
  x: number;
  z: number;
  yaw: number;
}
export interface Placement {
  /** Left/right balance: -1 is fully left, 1 fully right. */
  pan: number;
  /** Loudness from distance alone, 0 to 1. */
  gain: number;
  /** Metres from the nearest camera. */
  distance: number;
}
interface Bike {
  x: number;
  z: number;
  human: boolean;
}
/** How many bikes besides the human riders' own are given an engine voice. */
export const OTHER_VOICES = 4;
/** Distance at which a bike is at half loudness, in metres. */
const HALF_DISTANCE = 9;
/** A bike this close sits in the middle of the picture, so its balance is eased towards centre. */
const NEAR = 2.5;
const SILENT: Placement = {pan: 0, gain: 0, distance: Infinity};

/** Where one bike sits for one camera. */
export function placeFor(bike: {x: number; z: number}, ear: Listener): Placement {
  const dx = bike.x - ear.x,
    dz = bike.z - ear.z,
    distance = Math.hypot(dx, dz);
  // The camera's right-hand side on the ground, for a camera looking along (sin yaw, cos yaw).
  const side = distance > 0 ? (dx * -Math.cos(ear.yaw) + dz * Math.sin(ear.yaw)) / distance : 0;
  const pan = Math.max(-1, Math.min(1, side * (distance / (distance + NEAR))));
  return {pan, gain: 1 / (1 + (distance / HALF_DISTANCE) ** 2), distance};
}
/** Where a bike is heard: as the nearest camera hears it. Silent when there is no camera. */
export function place(bike: {x: number; z: number}, ears: Listener[]): Placement {
  let best = SILENT;
  for (const ear of ears) {
    const p = placeFor(bike, ear);
    if (p.distance < best.distance) best = p;
  }
  return best;
}
/**
 * The riders that get an engine voice, as indexes into `riders`: every human, then the four other bikes
 * nearest to any camera.
 */
export function voicedRiders(riders: Bike[], ears: Listener[]) {
  const humans: number[] = [],
    others: {index: number; distance: number}[] = [];
  riders.forEach((r, index) => {
    if (r.human) humans.push(index);
    else others.push({index, distance: place(r, ears).distance});
  });
  others.sort((a, b) => a.distance - b.distance || a.index - b.index);
  return {humans, others: others.slice(0, OTHER_VOICES).map(o => o.index)};
}
/** Left and right speaker levels for a balance, at equal power (what the browser's stereo panner does). */
export function channelGains(pan: number) {
  const angle = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;
  return {left: Math.cos(angle), right: Math.sin(angle)};
}
