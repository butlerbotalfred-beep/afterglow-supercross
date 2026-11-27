import {normalizeSlideAggression} from './handling-settings';
import {Track, type TrackPoint} from './track';
import {TUNING, clamp, angleDelta} from './config';
import {createProgress, updateProgress, restoreDeparture, trackDeferred, type Progress} from './race';
import type {Control, Device} from './input';
import {lipAhead, lipDistance, safeTakeoffSpeed} from './takeoff';
import {Rng} from './rng';
export interface Rider {
  id: number;
  human: boolean;
  device?: Device;
  name: string;
  color: number;
  x: number;
  z: number;
  y: number;
  heading: number;
  speed: number;
  vy: number;
  grounded: boolean;
  powerSlide: number;
  slipAngle: number;
  pitch: number;
  pitchRate: number;
  lean: number;
  compression: number;
  steer: number;
  throttle: number;
  brake: number;
  airTime: number;
  progress: Progress;
  surface: TrackPoint;
  recovery: number;
  stuck: number;
  finished: number | null;
  dnf: boolean;
  lastLanding: number;
  /** How the last judged landing went, for the HUD: matched to the slope, or flat enough to cost speed. */
  landingCue: '' | 'clean' | 'flat';
  /** Seconds since landingCue was set. */
  landingCueAge: number;
  /** Speed the last landing added, in m/s. Never more than TUNING.landingBonusMax. */
  landingBonus: number;
  bestAir: number;
  prevX: number;
  prevZ: number;
  crashTime: number;
  crashAge: number;
  crashSide: number;
  crashReason: string;
  crashes: number;
  recoveryReason: string;
  /** How loaded the suspension is from holding the stick straight back on the ground, 0 to 1. */
  preload: number;
  /** The load that was let go, kept until the bike leaves the ground or preloadRun passes the release distance. */
  preloadReleased: number;
  /** Metres ridden since the preload was let go. */
  preloadRun: number;
  /** What the preload did to the last takeoff, for the HUD: a timed release, or held through the lip. */
  launch: '' | 'pop' | 'absorb';
  /** After absorbing a lip the stick is still back; it does not pitch the nose up until it has been let go. */
  pitchHold: boolean;
  /** The load that was held through the lip, which sets how hard the absorb pulls. */
  absorbed: number;
  /** Sideways lay-over in the air from a scrub or a whip, radians, signed like steer. Separate from cornering lean. */
  airLean: number;
  /** A scrub was started on this flight. */
  scrub: boolean;
  /** The stick has been off the side since takeoff, so a sideways flick now counts as a scrub. */
  scrubArmed: boolean;
  /**
   * Set at a gated race start: the lane a computer rider holds from the grid to the holeshot line, so the pack
   * runs the first corner side by side instead of crossing over each other.
   */
  startLane?: number;
}
export const idleControl = (): Control => ({throttle: 0, brake: 0, steer: 0, pitch: 0, reset: false, pause: false});
export function makeRider(track: Track, id: number, human: boolean, color: number, device?: Device): Rider {
  const s = -3 - Math.floor(id / 4) * 2.8,
    p = track.at(s, ((id % 4) - 1.5) * 1.9);
  return {
    id,
    human,
    device,
    name: human ? `PLAYER ${id + 1}` : ['', '', '', '', ''][id] || `RIDER ${id + 1}`,
    color,
    x: p.x,
    z: p.z,
    y: track.height(s, p.lateral),
    heading: Math.atan2(p.tx, p.tz),
    speed: 0,
    vy: 0,
    grounded: true,
    powerSlide: 0,
    slipAngle: 0,
    pitch: 0,
    pitchRate: 0,
    lean: 0,
    compression: 0,
    steer: 0,
    throttle: 0,
    brake: 0,
    airTime: 0,
    progress: {...createProgress(s), lastLateral: p.lateral},
    surface: p,
    recovery: 0,
    stuck: 0,
    finished: null,
    dnf: false,
    lastLanding: 0,
    landingCue: '',
    landingCueAge: 0,
    landingBonus: 0,
    bestAir: 0,
    prevX: p.x,
    prevZ: p.z,
    crashTime: 0,
    crashAge: 0,
    crashSide: 1,
    crashReason: '',
    crashes: 0,
    recoveryReason: '',
    preload: 0,
    preloadReleased: 0,
    preloadRun: 0,
    launch: '',
    pitchHold: false,
    absorbed: 0,
    airLean: 0,
    scrub: false,
    scrubArmed: false,
  };
}
export function recover(r: Rider, track: Track, others: Rider[]) {
  if (!r.progress.routeBroken)
    updateProgress(
      r.progress,
      r.surface.s,
      clamp(r.surface.lateral, -track.halfWidth, track.halfWidth),
      track.length,
      track.halfWidth + 0.45,
      TUNING.step,
    );
  const departure = r.progress.routeBroken ? restoreDeparture(r.progress) : null;
  const s = departure?.s ?? r.surface.s;
  const lane = clamp(departure?.lateral ?? r.surface.lateral, -track.halfWidth, track.halfWidth);
  let p = track.at(s, lane),
    back = 0;
  // Remount at the wreck, or at the original departure point after a shortcut.
  // Move only sideways/backward if another rider occupies the remount position.
  search: for (const behind of [0, 2, 4, 6, 8])
    for (const offset of [0, -2, 2, -4, 4]) {
      p = track.at(s - behind, clamp(lane + offset, -track.halfWidth, track.halfWidth));
      back = behind;
      if (!others.some(o => o !== r && Math.hypot(o.x - p.x, o.z - p.z) < 1.65)) break search;
    }
  r.progress.lastS = p.s;
  r.progress.lastLateral = p.lateral;
  r.progress.distanceSinceCheckpoint -= back;
  r.progress.offTrack = false;
  r.progress.wrongWay = false;
  r.recoveryReason = departure ? 'SHORTCUT / BACK TO TRACK EXIT' : 'REMOUNTING AT WRECK';
  r.x = p.x;
  r.z = p.z;
  r.y = track.height(p.s, p.lateral);
  r.heading = Math.atan2(p.tx, p.tz);
  r.surface = p;
  r.crashTime = 0;
  r.crashAge = 0;
  r.prevX = p.x;
  r.prevZ = p.z;
  r.powerSlide = 0;
  r.slipAngle = 0;
  r.speed = 0;
  r.vy = 0;
  r.pitch = 0;
  r.pitchRate = 0;
  r.lean = 0;
  r.grounded = true;
  r.recovery = TUNING.recoveryDelay;
  r.stuck = 0;
  clearPreload(r);
}
function clearPreload(r: Rider) {
  r.preload = 0;
  r.preloadReleased = 0;
  r.preloadRun = 0;
  r.pitchHold = false;
  r.launch = '';
  r.airLean = 0;
  r.scrub = false;
  r.scrubArmed = false;
}
export function crash(r: Rider, reason: string, side = 1) {
  if (r.crashTime > 0 || r.recovery > 0) return;
  r.crashTime = TUNING.crashDuration;
  r.crashAge = 0;
  r.crashReason = reason;
  r.crashSide = side < 0 ? -1 : 1;
  r.crashes++;
  r.powerSlide = 0;
  r.slipAngle = 0;
  r.speed *= 0.48;
  r.throttle = 0;
  r.steer = 0;
  r.pitchRate = 0;
  clearPreload(r);
}

export function stepRider(r: Rider, c: Control, track: Track, dt: number, others: Rider[], slideAggression = 1) {
  r.lastLanding = 0;
  r.landingCueAge += dt;
  r.compression *= Math.exp(-dt * 9);
  r.prevX = r.x;
  r.prevZ = r.z;
  if (r.crashTime > 0) {
    r.crashTime = Math.max(0, r.crashTime - dt);
    r.crashAge += dt;
    r.speed = Math.max(0, r.speed - 18 * dt);
    r.x += Math.sin(r.heading) * r.speed * dt;
    r.z += Math.cos(r.heading) * r.speed * dt;
    r.surface = track.project(r.x, r.z);
    const floor = track.height(r.surface.s, r.surface.lateral);
    r.vy -= TUNING.gravity * dt;
    r.y = Math.max(floor, r.y + r.vy * dt);
    if (r.y === floor) r.vy = 0;
    // Defer slide movement until the wreck settles, then validate the same route
    // rules as riding. Crashing cannot erase an existing off-track departure.
    if (r.crashTime === 0) {
      updateProgress(r.progress, r.surface.s, r.surface.lateral, track.length, track.halfWidth + 0.45, dt);
      recover(r, track, others);
    } else trackDeferred(r.progress, r.surface.s, track.length, dt);
    return;
  }
  if (c.reset) recover(r, track, others);
  if (r.recovery > 0) {
    r.recovery = Math.max(0, r.recovery - dt);
    return;
  }
  r.throttle = c.throttle;
  r.brake = c.brake;
  r.steer = c.steer;
  // Throttle slides use the lower stick quadrants; braking while steering loads
  // the front and breaks rear grip without requiring throttle or a pitch gesture.
  // NPCs retain their planned grip path rather than initiating this rider gesture.
  const aggression = normalizeSlideAggression(slideAggression);
  const brake = clamp(c.brake, 0, 1);
  const slideSpeed = clamp((r.speed - 5) / 7, 0, 1);
  const turnDemand = clamp((Math.abs(c.steer) - 0.35) / 0.45, 0, 1);
  const powerDemand = clamp((c.pitch - 0.12) / 0.5, 0, 1) * clamp(c.throttle, 0, 1) * (1 - brake);
  const brakeDemand = r.human ? brake : 0;
  const slideDemand = r.grounded && aggression > 0 ? turnDemand * Math.max(powerDemand, brakeDemand) * slideSpeed : 0;
  const slideBoost = 1 + TUNING.brakeSlideBoost * brakeDemand;
  if (r.grounded)
    r.powerSlide += (slideDemand - r.powerSlide) * (1 - Math.exp(-dt * (slideDemand > r.powerSlide ? 9 : 13)));
  else {
    r.powerSlide = 0;
    r.slipAngle = 0;
  }
  // Preload: the stick straight back loads the suspension. AI riders do not use it.
  if (c.pitch < 0.2) r.pitchHold = false;
  if (r.human && r.grounded) {
    const back = c.pitch >= TUNING.preloadStick;
    if (back && Math.abs(c.steer) < TUNING.preloadSteerLimit) {
      r.preload = Math.min(1, r.preload + dt / TUNING.preloadCharge);
      r.preloadReleased = 0;
    } else if (r.preload > 0) {
      // Letting the stick go starts the release; steering into a slide instead just drops the load.
      r.preloadReleased = back ? 0 : r.preload;
      r.preloadRun = 0;
      r.preload = 0;
    } else if (r.preloadReleased > 0) {
      r.preloadRun += r.speed * dt;
      if (r.preloadRun > TUNING.preloadReleaseDistance) r.preloadReleased = 0;
    }
    if (r.preload > 0) r.compression = Math.max(r.compression, 0.5 * r.preload);
  }
  const targetSlip = c.steer * TUNING.slideSlipAngle * r.powerSlide * aggression * slideBoost;
  r.slipAngle += (targetSlip - r.slipAngle) * (1 - Math.exp(-dt * 10));
  const off = Math.abs(r.surface.lateral) > track.halfWidth;
  const accel = r.grounded
    ? TUNING.acceleration * c.throttle -
      TUNING.braking * c.brake -
      TUNING.drag * r.speed -
      TUNING.slideDrag * r.powerSlide -
      (off ? 6 : 0)
    : -0.08 * r.speed;
  r.speed = clamp(r.speed + accel * dt, 0, TUNING.maxSpeed);
  const steerPower = TUNING.turnRate * (0.18 + 0.82 * clamp(r.speed / 6, 0, 1)) * (r.grounded ? 1 : 0.36);
  // In a scrub the sideways stick lays the bike over instead of steering it.
  if (!r.scrub)
    r.heading += c.steer * steerPower * (1 + TUNING.slideYawBoost * r.powerSlide * aggression * slideBoost) * dt;
  r.lean += (c.steer * clamp(r.speed / 22, 0, 1) * (0.52 + 0.12 * r.powerSlide) - r.lean) * Math.min(1, dt * 9);
  const prevY = r.y;
  const travelHeading = r.heading - r.slipAngle;
  r.x += Math.sin(travelHeading) * r.speed * dt;
  r.z += Math.cos(travelHeading) * r.speed * dt;
  r.surface = track.project(r.x, r.z);
  const floor = track.height(r.surface.s, r.surface.lateral);
  const look = track.project(r.x + Math.sin(r.heading) * 0.42, r.z + Math.cos(r.heading) * 0.42);
  const slope = (track.height(look.s, look.lateral) - floor) / 0.42;
  if (r.grounded) {
    // A load still held soaks the lip up: the rider pulls the bike down through the lip and the climb after it,
    // so it flies lower. A load let go just before the lip springs the bike up instead.
    // A stick pulled back only an instant before the lip is a nose-up input, not an absorb.
    const launch =
      r.vy <= 0 ? '' : r.preload >= TUNING.preloadAbsorbMin ? 'absorb' : r.preloadReleased > 0 ? 'pop' : '';
    const pull = TUNING.gravity * (1 + (launch === 'absorb' ? TUNING.preloadAbsorb * r.preload : 0));
    const ballistic = prevY + r.vy * dt - pull * dt * dt * 0.5;
    if (ballistic > floor + 0.00035 && r.speed > 5) {
      r.grounded = false;
      r.y = ballistic;
      if (launch === 'pop') r.vy *= 1 + TUNING.preloadPop * r.preloadReleased;
      r.launch = launch;
      if (launch === 'absorb') {
        r.pitchHold = true;
        r.absorbed = r.preload;
      }
      r.vy -= pull * dt;
      r.airTime = dt;
      r.scrubArmed = Math.abs(c.steer) < TUNING.scrubSteer;
      r.pitchRate = 0;
      r.powerSlide = 0;
      r.slipAngle = 0;
    } else {
      r.y = floor;
      r.airLean *= Math.exp(-dt * 14);
      r.vy = clamp((floor - prevY) / dt, -20, 20);
      r.pitch +=
        (Math.atan(slope) - TUNING.slideNoseDip * r.powerSlide - TUNING.brakeNoseDip * brake * slideSpeed - r.pitch) *
        Math.min(1, dt * 14);
    }
  } else {
    // Absorbing lasts while the stick stays back and the bike is still climbing.
    const absorbing = r.launch === 'absorb' && r.pitchHold && r.vy > 0;
    // A scrub keeps the bike low the same way: extra pull for the rest of the climb.
    const pull = (absorbing ? TUNING.preloadAbsorb * r.absorbed : 0) + (r.scrub && r.vy > 0 ? TUNING.scrubPull : 0);
    r.vy -= TUNING.gravity * (1 + pull) * dt;
    r.y += r.vy * dt;
    r.airTime += dt;
    // The load is spent once the bike is really flying; a one-frame skip up the face keeps it.
    if (r.airTime > TUNING.preloadSkip) {
      r.preload = 0;
      r.preloadReleased = 0;
    }
    // Body position rotates the bike; an air-brake tap adds nose-down torque.
    const stick = r.pitchHold ? Math.min(c.pitch, 0) : c.pitch;
    const targetRate = clamp(stick * 3.6 - c.brake * 1.5, -4, 3.6) - r.pitch * 0.5;
    r.pitchRate += (targetRate - r.pitchRate) * Math.min(1, dt * 12);
    r.pitch = clamp(r.pitch + r.pitchRate * dt, -1.1, 1.1);
    r.bestAir = Math.max(r.bestAir, r.y - floor);
    if (r.human) {
      // Scrub and whip. AI riders do neither.
      const side = Math.abs(c.steer) >= TUNING.scrubSteer ? Math.sign(c.steer) : 0;
      const forward = c.pitch <= -TUNING.scrubForward;
      // The flick has to arrive in the air: a stick already hard over from steering through the lip is not one.
      if (!side) r.scrubArmed = true;
      // A hop over a bump or a kerb is not a jump: nothing starts until the bike is really flying upward.
      const flying = r.airTime >= TUNING.preloadSkip;
      if (
        !r.scrub &&
        r.scrubArmed &&
        side &&
        forward &&
        flying &&
        r.airTime <= TUNING.scrubWindow &&
        r.vy >= TUNING.scrubMinRise
      ) {
        r.scrub = true;
      }
      // A whip is the same lay-over without the scrub: for show only, and never past the landing limit.
      // A scrub stays laid over only while the stick is still forward and sideways.
      const target = flying ? side * (r.scrub && forward ? TUNING.scrubLean : TUNING.airLeanLimit) : 0;
      const rate = Math.abs(target) > Math.abs(r.airLean) ? TUNING.airLeanRate : TUNING.airLeanRecover;
      r.airLean += clamp(target - r.airLean, -rate * dt, rate * dt);
    }
    if (r.y <= floor) {
      const impact = Math.abs(r.vy - r.speed * slope) / Math.sqrt(1 + slope * slope),
        alignment = Math.abs(angleDelta(r.pitch, Math.atan(slope)));
      r.lastLanding = impact;
      r.compression = clamp(impact * 0.035, 0.04, 1);
      // A scrub has to be brought back upright before the wheels touch.
      const laidOver = r.scrub && Math.abs(r.airLean) > TUNING.airLeanLimit;
      const badLanding =
        impact > TUNING.landingCrashImpact || (alignment > TUNING.landingCrashAngle && impact > 5 && r.speed > 7);
      if (laidOver || badLanding) {
        r.y = floor;
        r.vy = 0;
        r.grounded = true;
        updateProgress(r.progress, r.surface.s, r.surface.lateral, track.length, track.halfWidth + 0.45, dt);
        const side = laidOver ? -r.airLean : r.lean || r.steer || (r.id % 2) * 2 - 1;
        // A scrub still laid over is named first: holding it also dives the nose, which would read as awkward.
        const reason = laidOver
          ? 'SCRUB NOT RECOVERED'
          : impact > TUNING.landingCrashImpact
            ? 'HARD LANDING'
            : 'AWKWARD LANDING';
        crash(r, reason, side);
        return;
      }
      // Matching the bike's pitch to the landing slope keeps speed; a flat or nose-high landing scrubs it.
      const judged = r.airTime >= TUNING.landingJudgeAir;
      const legacy = Math.max(0, alignment - TUNING.legacyPenaltyStart) * TUNING.legacyPenaltySlope;
      const steep = Math.max(0, alignment - TUNING.landingPenaltyStart) * TUNING.landingPenaltySlope;
      const steepMax = r.airTime < TUNING.landingBumpAir ? TUNING.bumpPenaltyMax : TUNING.landingPenaltyMax;
      const misaligned = Math.max(legacy, Math.min(steepMax, steep));
      const hardHit = Math.max(0, impact - 12) * 0.015;
      r.speed *= clamp(1 - misaligned - hardHit, 0.55, 1);
      r.landingBonus = 0;
      if (judged) {
        const clean = alignment <= TUNING.landingPenaltyStart;
        // A clean landing on a downslope carries a little extra speed out: never more than landingBonusMax,
        // never past the top speed, and only on the track.
        if (clean && slope < 0 && Math.abs(r.surface.lateral) <= track.halfWidth) {
          const before = r.speed;
          const bonus = TUNING.landingBonusMax * clamp(-slope / TUNING.landingBonusSlope, 0, 1);
          r.speed = Math.min(Math.max(before, TUNING.maxSpeed), before + bonus);
          // What the landing really added, which is what the pace gate holds to the cap.
          r.landingBonus = r.speed - before;
        }
        // Clean means the speed was kept, so a landing hard enough to scrub speed is not called clean.
        r.landingCue = clean ? (hardHit > 0 ? '' : 'clean') : misaligned >= 0.02 ? 'flat' : '';
        r.landingCueAge = 0;
      }
      r.y = floor;
      r.grounded = true;
      r.scrub = false;
      r.vy = r.speed * slope;
      r.airTime = 0;
      r.pitchRate = 0;
    }
  }
  if (Math.abs(r.surface.lateral) > track.halfWidth + 2) {
    r.speed = Math.min(r.speed, 8);
  }
  updateProgress(r.progress, r.surface.s, r.surface.lateral, track.length, track.halfWidth + 0.45, dt);
  if (r.progress.routeBroken || r.y < floor - 8) recover(r, track, others);
  r.stuck = r.speed < 1 ? r.stuck + dt : 0;
  if (!r.human && r.stuck > 3) recover(r, track, others);
}
export function collide(riders: Rider[], track: Track) {
  for (let i = 0; i < riders.length; i++)
    for (let j = i + 1; j < riders.length; j++) {
      const a = riders[i],
        b = riders[j];
      if (a.recovery > 0 || b.recovery > 0 || a.crashTime > 0 || b.crashTime > 0 || Math.abs(a.y - b.y) > 1.3) continue;
      let dx = b.x - a.x,
        dz = b.z - a.z,
        d = Math.hypot(dx, dz);
      // Swept pair contact catches fast crossings between fixed physics steps.
      const ax = a.x - a.prevX,
        az = a.z - a.prevZ,
        bx = b.x - b.prevX,
        bz = b.z - b.prevZ;
      const px = b.prevX - a.prevX,
        pz = b.prevZ - a.prevZ,
        vx = bx - ax,
        vz = bz - az,
        v2 = vx * vx + vz * vz;
      if (d >= 0.85 && v2 > 1e-8 && Math.hypot(ax, az) < 1 && Math.hypot(bx, bz) < 1) {
        const t = clamp(-(px * vx + pz * vz) / v2, 0, 1),
          sx = px + vx * t,
          sz = pz + vz * t;
        if (Math.hypot(sx, sz) < 0.85) {
          dx = px;
          dz = pz;
          d = Math.hypot(dx, dz);
        } else continue;
      } else if (d >= 0.85) continue;
      if (d < 0.001) {
        dx = Math.sin(a.heading);
        dz = Math.cos(a.heading);
        d = 1;
      }
      const nx = dx / d,
        nz = dz / d;
      const closing =
        (Math.sin(a.heading - a.slipAngle) * a.speed - Math.sin(b.heading - b.slipAngle) * b.speed) * nx +
        (Math.cos(a.heading - a.slipAngle) * a.speed - Math.cos(b.heading - b.slipAngle) * b.speed) * nz;
      if (closing > TUNING.contactCrashSpeed) {
        crash(a, 'RIDER CONTACT', -1);
        crash(b, 'RIDER CONTACT', 1);
        continue;
      }
      const push = Math.max(0, (0.85 - Math.hypot(b.x - a.x, b.z - a.z)) * 0.5);
      a.x -= nx * push;
      a.z -= nz * push;
      b.x += nx * push;
      b.z += nz * push;
      // Rubbing costs momentum through the tyres. A rider in the air keeps theirs: losing it mid-flight would
      // drop them short of the landing with nothing they could do about it.
      if (a.grounded) a.speed *= 0.992;
      if (b.grounded) b.speed *= 0.992;
    }
}

/** Predict the downslope under the ballistic path, so NPCs prepare before touchdown. */
function landingPitch(r: Rider, track: Track) {
  for (let t = 0.08; t < 2.8; t += 0.08) {
    const s = r.surface.s + r.speed * t,
      y = r.y + r.vy * t - 0.5 * TUNING.gravity * t * t;
    if (y <= track.height(s, r.surface.lateral))
      return Math.atan(track.height(s + 0.5, r.surface.lateral) - track.height(s - 0.5, r.surface.lateral));
  }
  return 0;
}
/** Metres after the holeshot line over which a computer rider leaves its start lane for the racing line. */
const NPC_START_MERGE = 80;
/** How far ahead of a takeoff the AI starts picking a speed for it. */
const NPC_TAKEOFF_REACH = 45;
/** The AI will not close on a rider ahead in its line faster than this, in m/s, inside NPC_FOLLOW_REACH metres. */
const NPC_CLOSING_MAX = 5;
const NPC_FOLLOW_REACH = 25;
/** How often a computer rider misjudges a jump, as a share of the jumps it takes. */
export const NPC_MISTAKE_RATE: Record<string, number> = {relaxed: 0.03, club: 0.015, expert: 0.007};
/** A misjudged jump is taken this much too fast, from the least to the most. */
const NPC_MISTAKE_HOT = [0.1, 0.3];
/** How far ahead a rider commits to its speed for a jump: beyond the rhythm braking look, so it never brakes late. */
const NPC_MISTAKE_REACH = 120;
/**
 * How much too fast this rider will take this jump on this lap: 0 almost always. It depends only on the race
 * seed, the rider, the lap and the jump, so a race replays exactly.
 */
export function npcMistake(seed: number, rider: number, lap: number, jump: number, difficulty: string) {
  const rng = new Rng(
    (seed ^ Math.imul(rider + 1, 0x9e3779b1) ^ Math.imul(lap + 1, 0x85ebca6b) ^ Math.imul(jump + 1, 0xc2b2ae35)) >>> 0,
  );
  rng.next();
  if (!rng.chance(NPC_MISTAKE_RATE[difficulty] ?? 0)) return 0;
  return rng.range(NPC_MISTAKE_HOT[0], NPC_MISTAKE_HOT[1]);
}
/**
 * `mistakes` is the race seed that makes computer riders fallible; 0 keeps them perfect, as the pace checks need.
 */
export function npcControl(r: Rider, track: Track, others: Rider[], difficulty: string, mistakes = 0): Control {
  const committed = mistakes ? lipAhead(track, r.surface.s, NPC_MISTAKE_REACH) : null;
  const hot = committed ? npcMistake(mistakes, r.id, r.progress.lap, committed.index, difficulty) : 0;
  const pace = difficulty === 'relaxed' ? 0.78 : difficulty === 'expert' ? 1.04 : 0.91;
  const ahead = 4 + r.speed * 0.32;
  let lane = Math.sin(r.surface.s * 0.043 + r.id * 2) * 0.65 + ((r.id % 3) - 1) * 0.55;
  // Off a gate the pack keeps its grid lanes to the holeshot line, then drifts onto the racing line.
  let hold = 0;
  if (r.startLane !== undefined && r.progress.lap === 0) {
    const run = r.surface.s > track.length - 20 ? 0 : r.surface.s;
    hold = clamp((track.holeshot + NPC_START_MERGE - run) / NPC_START_MERGE, 0, 1);
    lane += (r.startLane - lane) * hold;
  }
  for (const o of others) {
    if (o === r || Math.hypot(o.x - r.x, o.z - r.z) >= 4 || o.speed >= r.speed + 2) continue;
    // In its start lane a rider gives way only to a slower bike in front of it, not to the bikes alongside.
    const gap = (o.surface.s - r.surface.s + track.length) % track.length;
    const blocked = gap < 4 && o.speed < r.speed - 1 && Math.abs(o.surface.lateral - r.surface.lateral) < 1.2;
    lane += (o.surface.lateral > r.surface.lateral ? -1 : 1) * (blocked ? 1 : 1 - hold);
  }
  lane = clamp(lane, -2.5, 2.5);
  const target = track.at(r.surface.s + ahead, lane);
  const desired = Math.atan2(target.x - r.x, target.z - r.z);
  const err = angleDelta(desired, r.heading);
  // Look through the braking distance before using the faster straight-line pace.
  const brakingLook = 13 + (r.speed * r.speed) / (2 * TUNING.braking);
  let curvature = 0;
  for (let distance = 5; distance <= brakingLook; distance += 6)
    curvature = Math.max(curvature, Math.abs(track.curvature(r.surface.s + distance)));
  // A rider misjudging a jump is also carrying more speed down the straight towards it than its pace allows.
  let targetSpeed = clamp(46.875 - curvature * 460, 11.8, 45) * pace * (curvature < 0.004 ? 1 + hot : 1);
  for (const rhythm of track.rhythms) {
    const inLane = hot > 0 && committed!.lip >= rhythm.start - 1 && committed!.lip < rhythm.end;
    const entrySpeed =
      rhythm.pace * (difficulty === 'relaxed' ? 0.98 : difficulty === 'expert' ? 1.02 : 1) * (inLane ? 1 + hot : 1);
    if (r.surface.s >= rhythm.start && r.surface.s < rhythm.end) targetSpeed = Math.min(targetSpeed, entrySpeed);
    else {
      const distance = (rhythm.start - r.surface.s + track.length) % track.length;
      if (distance < 90)
        targetSpeed = Math.min(targetSpeed, Math.sqrt(entrySpeed * entrySpeed + 2 * TUNING.braking * 0.65 * distance));
    }
  }
  if (Math.abs(err) > 0.6) targetSpeed = Math.min(targetSpeed, 10);
  // Closing on a much slower rider in the same line is a contact crash: slow to a safe closing speed instead.
  for (const o of others) {
    // A fallen rider is no obstacle: riders pass through them, as collide() does.
    if (o === r || o.crashTime > 0 || o.recovery > 0 || o.speed > r.speed - NPC_CLOSING_MAX) continue;
    const gap = (o.surface.s - r.surface.s + track.length) % track.length;
    if (gap > 0 && gap < NPC_FOLLOW_REACH && Math.abs(o.surface.lateral - r.surface.lateral) < 1.6)
      targetSpeed = Math.min(targetSpeed, o.speed + NPC_CLOSING_MAX);
  }
  if (r.grounded) {
    // Some takeoff speeds end on the face of the next jump. Aim for the fastest safe one still within reach.
    const lip = lipDistance(track, r.surface.s, NPC_TAKEOFF_REACH);
    if (lip !== null) {
      const drive = Math.max(0, TUNING.acceleration - TUNING.drag * r.speed);
      const fastest = Math.min(targetSpeed, Math.sqrt(r.speed * r.speed + 2 * drive * lip));
      const slowest = Math.sqrt(Math.max(0, r.speed * r.speed - 2 * TUNING.braking * 0.7 * lip));
      const safe = safeTakeoffSpeed(track, r.surface.s, NPC_TAKEOFF_REACH, slowest, fastest);
      if (safe !== null) targetSpeed = Math.min(targetSpeed, safe * (1 + hot));
    }
  }
  return {
    throttle: clamp((targetSpeed - r.speed) * 0.55, 0, 1),
    brake: clamp((r.speed - targetSpeed - 1) * 0.28, 0, 0.7),
    steer: clamp(err * 2.4, -1, 1),
    pitch: r.grounded
      ? 0
      : clamp(((landingPitch(r, track) - r.pitch) * 6 - r.pitchRate * 0.7 + r.pitch * 0.5) / 3.6, -0.85, 0.85),
    reset: false,
    pause: false,
  };
}
