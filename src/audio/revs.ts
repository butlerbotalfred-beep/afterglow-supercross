// Engine revs from road speed: a five-gear box with no browser in it, so tests can sweep it.
import {TUNING} from '../config';

/** Top speed of each gear as a share of the bike's top speed. The last gear runs to the limiter. */
export const GEAR_TOPS = [0.2, 0.36, 0.54, 0.76, 1];
/** Revs at a standstill, as a share of the red line. */
export const IDLE_REVS = 0.16;
/** A downshift waits until the speed is this far under the shift speed, so the box does not hunt. */
const DOWNSHIFT = 0.88;

/** The speed, in m/s, at which a gear (0 to 4) runs out of revs and the next one is taken. */
export const shiftSpeed = (gear: number, maxSpeed: number = TUNING.maxSpeed) => GEAR_TOPS[gear] * maxSpeed;

/** The gear for a speed with nothing remembered: the lowest gear that has not run out of revs. */
export function gearFor(speed: number, maxSpeed: number = TUNING.maxSpeed) {
  const gear = GEAR_TOPS.findIndex(top => speed <= top * maxSpeed);
  return gear < 0 ? GEAR_TOPS.length - 1 : gear;
}
/** The gear to be in now, given the gear held a moment ago. Shifts up at the shift speed and down a little below it. */
export function nextGear(gear: number, speed: number, maxSpeed: number = TUNING.maxSpeed) {
  let g = Math.min(GEAR_TOPS.length - 1, Math.max(0, gear));
  while (g < GEAR_TOPS.length - 1 && speed > shiftSpeed(g, maxSpeed)) g++;
  while (g > 0 && speed < shiftSpeed(g - 1, maxSpeed) * DOWNSHIFT) g--;
  return g;
}
/**
 * Revs in a gear at a road speed, 0 to 1 where 1 is the red line. They rise in a straight line with speed and
 * fall back when the next gear is taken. In first gear the clutch slips, so an open throttle lifts the revs
 * before the bike is moving.
 */
export function gearRevs(gear: number, speed: number, throttle = 0, maxSpeed: number = TUNING.maxSpeed) {
  const road = Math.max(0, speed) / shiftSpeed(gear, maxSpeed);
  const clutch = gear === 0 ? IDLE_REVS + 0.3 * Math.min(1, Math.max(0, throttle)) : IDLE_REVS;
  return Math.min(1, Math.max(clutch, road));
}
/** True when the engine is against the red line and the limiter is cutting in. */
export const onLimiter = (revs: number) => revs >= 0.985;
/** The engine's firing note in hertz for a share of the red line. */
export const revsToHz = (revs: number) => 42 + 150 * revs;
