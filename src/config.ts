/** Metres, seconds, radians. See README for handling/camera tuning. */
export const TUNING = {
  step: 1 / 120, maxFrame: .1, acceleration: 23.4375, braking: 36,
  drag: .34, maxSpeed: 50.625, turnRate: 1.48, gravity: 22,
  trackHalfWidth: 4.8, recoveryDelay: 1.6, finishTimeout: 60,
  contactCrashSpeed: 9, landingCrashImpact: 21, landingCrashAngle: .95,
  crashDuration: 2.1,
  brakeSlideBoost: .65, brakeNoseDip: .065, slideYawBoost: .85, slideSlipAngle: .65, slideNoseDip: .12, slideDrag: 4,
  cameraDistance: 3.2, cameraHeight: 1.9, cameraShake: .15,
};
export const COLORS = [0xff703e, 0x41b9ec, 0xb5df55, 0xe589dc, 0xffcf61, 0xa19aff, 0xe9ede4, 0xe44f63];
export const CSS_COLORS = COLORS.map(c => `#${c.toString(16).padStart(6, '0')}`);
export const clamp = (v:number, min:number, max:number) => Math.max(min, Math.min(max,v));
export const wrap = (v:number, length:number) => ((v % length) + length) % length;
export const angleDelta = (a:number,b:number) => Math.atan2(Math.sin(a-b),Math.cos(a-b));
