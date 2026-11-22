/**
 * Bump this whenever a change alters how a bike moves for the same inputs. Saved times and replays carry the
 * number, so results from different physics are never compared.
 */
export const PHYSICS_VERSION = 2;
/** Metres, seconds, radians. See README for handling/camera tuning. */
export const TUNING = {
  step: 1 / 120,
  maxFrame: 0.1,
  acceleration: 23.4375,
  braking: 36,
  drag: 0.34,
  /** 169.2 km/h. It was 182 until M1.2; no circuit lets even the Expert AI pass 164 km/h. */
  maxSpeed: 47,
  turnRate: 1.48,
  gravity: 22,
  trackHalfWidth: 4.8,
  recoveryDelay: 1.6,
  finishTimeout: 60,
  contactCrashSpeed: 9,
  landingCrashImpact: 21,
  landingCrashAngle: 0.95,
  /** Radians between the bike's pitch and the landing slope before a landing starts to cost speed. */
  landingPenaltyStart: 0.1,
  /** Share of speed lost per radian beyond landingPenaltyStart. */
  landingPenaltySlope: 1,
  /**
   * Where the steep penalty levels off, as a share of speed. Past it a landing costs what it did before M1.2
   * (legacyPenaltyStart and legacyPenaltySlope), so a landing is never cheaper than it used to be.
   */
  landingPenaltyMax: 0.26,
  /**
   * A touchdown after less than this many seconds in the air is a rebound or a bump, too quick to pitch for.
   * The steep penalty levels off much sooner for it (bumpPenaltyMax), so a bad landing that bounces is not
   * charged in full a second time.
   */
  landingBumpAir: 0.1,
  bumpPenaltyMax: 0.05,
  legacyPenaltyStart: 0.3,
  legacyPenaltySlope: 0.4,
  /** Most speed a clean downslope landing can add, in m/s (3 km/h). */
  landingBonusMax: 3 / 3.6,
  /** Downslope gradient at which a clean landing earns the whole bonus. */
  landingBonusSlope: 0.3,
  /**
   * Seconds in the air before a landing earns the bonus and a HUD cue. A shorter hop is a bump: it is not
   * announced, but a nose-high bike still loses a little speed on it.
   */
  landingJudgeAir: 0.3,
  crashDuration: 2.1,
  brakeSlideBoost: 0.65,
  brakeNoseDip: 0.065,
  slideYawBoost: 0.85,
  slideSlipAngle: 0.65,
  slideNoseDip: 0.12,
  slideDrag: 4,
  cameraDistance: 3.2,
  cameraHeight: 1.9,
  cameraShake: 0.15,
};
export const COLORS = [0xff703e, 0x41b9ec, 0xb5df55, 0xe589dc, 0xffcf61, 0xa19aff, 0xe9ede4, 0xe44f63];
export const CSS_COLORS = COLORS.map(c => `#${c.toString(16).padStart(6, '0')}`);
export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
export const wrap = (v: number, length: number) => ((v % length) + length) % length;
export const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
