// The race flow with no browser in it: setup, countdown, racing, results, pause and the fixed-step clock.
// Input and screen are passed in, so tests can run whole races in Node.
import {COLORS, TUNING} from '../config';
import {uniqueDevices, type Control, type Device} from '../input';
import {StartGate, pastHoleshot} from '../gate';
import {GhostRecorder, type Ghost, type GhostPose} from '../ghost';
import {collide, idleControl, makeRider, npcControl, stepRider, type Rider} from '../physics';
import {createTiming, fasterLap, recordStep, type LapTime, type RiderTiming} from '../timing';
import type {Track} from '../track';

export type Phase = 'setup' | 'countdown' | 'racing' | 'results';

/** Where rider controls come from. */
export interface SessionInput {
  sample(device: Device): Control;
  connectedGamepads(): {index: number}[];
}
/** What the session tells the screen and speakers. Every method is a notification; none returns a value. */
export interface SessionScreen {
  /**
   * The number to show before the start. Free Practice and Time Trial count 3, 2, 1 (4 for the first 0.8 s).
   * A race shows the board, 5 down to 1, then 0 while the gate is live and may drop at any moment.
   */
  countdown(n: number): void;
  /** Racing has begun: the countdown ended or the gate dropped. */
  racing(): void;
  /** A race's gate fell. */
  gateDropped?(): void;
  /** A rider crept into the gate before it dropped and will be held when it falls. */
  jumpedGate?(rider: Rider): void;
  /** The first rider of the race crossed the holeshot line. */
  holeshot?(rider: Rider): void;
  /** A short beep. */
  cue(frequency: number, seconds: number): void;
  /** A human rider landed hard. */
  landing(impact: number): void;
  /** The shared pause was switched on or off. `missing` is a human whose controller has gone. */
  pause(paused: boolean, missing: Rider | undefined): void;
  /** A rider finished a lap. Optional, so simple screens can ignore it. */
  lap?(rider: Rider, lap: LapTime): void;
  /** The race is over and riders are classified. */
  results(): void;
  /** Time Trial: the rider finished a lap, recorded as `ghost` (null when the lap was too long to record). */
  ghostLap?(rider: Rider, lap: LapTime, ghost: Ghost | null): void;
  /** Time Trial: the rider was put back on the start line, so nothing drawn should blend from the old place. */
  restarted?(): void;
}
export interface GridConfig {
  track: Track;
  humanCount: number;
  npcCount: number;
  practice: boolean;
  /** Time Trial: one rider alone against the clock, lap after lap, with a ghost of the best lap. */
  trial?: boolean;
  assignments: (Device | null)[];
}
export interface RaceConfig {
  lapCount: number;
  difficulty: string;
  /** Makes the computer riders fallible, the same way every time for the same seed. Left out or 0, they are perfect. */
  seed?: number;
}
export const NPC_NAMES = ['S. MORA', 'J. REYES', 'K. NOVA', 'A. RIVERS', 'T. FOX', 'R. VALE', 'M. PARK'];
export const COUNTDOWN_SECONDS = 3.8;

/** True when every human slot has its own device. */
export function devicesReady(assignments: (Device | null)[], humanCount: number) {
  const used = assignments.slice(0, humanCount);
  return used.every(Boolean) && uniqueDevices(used as Device[]).length === humanCount;
}

export class RaceSession {
  phase: Phase = 'setup';
  paused = false;
  practice = false;
  /** Time Trial. It is run like practice (no computer riders, no finish) with a ghost recorded each lap. */
  trial = false;
  lapCount = 3;
  difficulty = 'club';
  /** The seed for the computer riders' mistakes in this race; 0 means they make none. */
  seed = 0;
  raceTime = 0;
  countdown = COUNTDOWN_SECONDS;
  firstFinish: number | null = null;
  /** The start gate of the race being run. Free Practice and Time Trial have none. */
  gate: StartGate | null = null;
  /** The id of the rider who took the holeshot in this race, once somebody has. */
  holeshot: number | null = null;
  riders: Rider[] = [];
  /** Lap and sector timing, one entry per rider in the same order as `riders`. */
  timing: RiderTiming[] = [];
  /** The saved best lap for this track, which human riders' sector times are compared with. */
  personalBest: LapTime | null = null;
  /** Seconds of frame time not yet turned into physics steps. */
  accumulator = 0;
  /** Power-slide aggression for human riders; can change while paused. */
  slideAggression = 1;
  /** Per-rider control overrides, used by the development hooks. */
  override = new Map<number, Control>();
  // Development review switches.
  reviewDrive = false;
  reviewFrozen = false;
  reviewCrashTest = '';
  track!: Track;
  private lastTickSound = 4;
  private recorder = new GhostRecorder();
  /** The race time of the first pose the recorder was given for the lap being ridden. */
  private ghostFrom = 0;
  /** Where the Time Trial rider was before the step being worked on. */
  private poseBefore: GhostPose = {x: 0, y: 0, z: 0, heading: 0, pitch: 0, lean: 0};

  constructor(
    private input: SessionInput,
    private screen: SessionScreen,
  ) {}

  /** Lines riders up on the start grid. Humans come first, then NPCs (none in practice). */
  grid({track, humanCount, npcCount, practice, trial = false, assignments}: GridConfig) {
    this.track = track;
    this.trial = trial;
    this.practice = practice || trial;
    if (trial) humanCount = 1;
    this.riders = Array.from({length: humanCount + (this.practice ? 0 : npcCount)}, (_, i) =>
      makeRider(track, i, i < humanCount, COLORS[i], i < humanCount ? assignments[i] || undefined : undefined),
    );
    this.riders.forEach((r, i) => {
      if (!r.human) r.name = NPC_NAMES[(i - humanCount) % NPC_NAMES.length];
    });
    this.timing = this.riders.map(() => createTiming());
    this.beginGhost(0);
  }
  /**
   * Starts recording a lap that began `since` seconds ago, from where the rider is now. A lap that starts as
   * the rider crosses the line also gets `before`, where the rider was one step earlier, so the ghost is
   * already moving at the very start of its lap.
   */
  private beginGhost(since: number, before?: GhostPose) {
    if (!this.trial) return;
    const lead = before ? TUNING.step : 0;
    this.recorder.begin(since - lead);
    this.ghostFrom = this.raceTime - lead;
    if (before) this.recorder.push(before, 0);
    this.pushGhost();
  }
  /** Records where the Time Trial rider is now, at the step the lap clock says it is. */
  private pushGhost() {
    this.recorder.push(this.riders[0], Math.round((this.raceTime - this.ghostFrom) / TUNING.step));
  }
  /**
   * Time Trial: puts the rider back on the start line at a standstill and starts the lap again. The laps
   * already ridden and the best of them are kept.
   */
  restartLap() {
    if (!this.trial || this.phase !== 'racing' || this.paused) return false;
    const [r] = this.riders,
      [timing] = this.timing;
    const {name, crashes} = r;
    Object.assign(r, makeRider(this.track, r.id, true, r.color, r.device), {name, crashes});
    Object.assign(timing, createTiming(this.raceTime), {laps: timing.laps, best: timing.best});
    this.beginGhost(0);
    this.override.clear();
    this.screen.restarted?.();
    return true;
  }
  /** Time Trial: the player is done. Shows the laps of the session. */
  leaveTrial() {
    if (!this.trial || (this.phase !== 'racing' && this.phase !== 'countdown')) return false;
    this.paused = false;
    this.phase = 'results';
    this.screen.results();
    return true;
  }
  /** Starts the countdown for the riders already on the grid. */
  start({lapCount, difficulty, seed = 0}: RaceConfig) {
    this.lapCount = lapCount;
    this.difficulty = difficulty;
    this.seed = seed >>> 0;
    this.raceTime = 0;
    this.countdown = COUNTDOWN_SECONDS;
    this.firstFinish = null;
    this.paused = false;
    this.phase = 'countdown';
    this.lastTickSound = 4;
    this.accumulator = 0;
    this.override.clear();
    this.timing = this.riders.map(() => createTiming());
    this.beginGhost(0);
    this.holeshot = null;
    this.gate = this.practice ? null : new StartGate(this.seed, this.riders, difficulty);
  }
  /** The lap a rider's sector times are compared with: the saved best (humans only) or their best this session. */
  referenceLap(index: number) {
    return fasterLap(this.riders[index].human ? this.personalBest : null, this.timing[index].best);
  }
  toSetup() {
    this.reviewCrashTest = '';
    this.phase = 'setup';
    this.paused = false;
  }
  /** A human rider whose gamepad is no longer connected, if any. */
  missingController() {
    if (this.reviewDrive) return;
    const pads = this.input.connectedGamepads();
    return this.riders.find(
      r =>
        r.human &&
        r.device?.kind === 'gamepad' &&
        !pads.some(p => r.device?.kind === 'gamepad' && p.index === r.device.index),
    );
  }
  /** Pauses the race if a human rider's controller has disconnected. */
  checkControllers() {
    if (this.missingController() && !this.paused) this.togglePause();
  }
  togglePause() {
    if (this.phase === 'setup' || this.phase === 'results') return;
    const missing = this.missingController();
    if (this.paused && missing) return;
    this.paused = !this.paused;
    this.screen.pause(this.paused, missing);
  }
  private endRace() {
    this.phase = 'results';
    this.riders.forEach(r => (r.dnf = r.finished === null));
    this.screen.results();
  }
  /** Turns frame time into fixed physics steps. Returns how many steps ran. */
  advance(dt: number, beforeStep?: () => void) {
    let steps = 0;
    if (!this.paused) {
      this.accumulator += dt;
      while (this.accumulator >= TUNING.step) {
        beforeStep?.();
        this.step(TUNING.step);
        this.accumulator -= TUNING.step;
        steps++;
      }
    }
    return steps;
  }
  step(dt: number) {
    const {riders, track, input, screen} = this;
    if (this.phase === 'setup' || this.phase === 'results' || this.paused || this.reviewFrozen) return;
    if (this.phase === 'countdown') {
      const controls = riders.map(r => (r.human ? this.override.get(r.id) || input.sample(r.device!) : null));
      if (controls.some(c => c?.pause)) {
        this.togglePause();
        return;
      }
      const gate = this.gate;
      if (gate) {
        const board = gate.board;
        // A computer rider, or the autopilot, holds the revs in the band (null).
        const {jumped, dropped} = gate.wait(dt, i =>
          this.reviewDrive || this.override.has(riders[i].id) ? null : (controls[i]?.throttle ?? null),
        );
        // The engine is heard and the bike shakes at the revs being held.
        riders.forEach((r, i) => (r.throttle = gate.launches[i].revs));
        for (const i of jumped) screen.jumpedGate?.(riders[i]);
        if (gate.board !== board && gate.board > 0) screen.cue(600, 0.13);
        screen.countdown(gate.board);
        if (dropped) {
          this.phase = 'racing';
          screen.gateDropped?.();
          screen.racing();
        }
        return;
      }
      this.countdown -= dt;
      const n = Math.ceil(this.countdown);
      if (n !== this.lastTickSound && n > 0 && n <= 3) {
        screen.cue(600, 0.13);
        this.lastTickSound = n;
      }
      screen.countdown(Math.max(1, n));
      if (this.countdown <= 0) {
        this.phase = 'racing';
        screen.cue(1100, 0.35);
        screen.racing();
      }
      return;
    }
    this.raceTime += dt;
    for (const [index, r] of riders.entries()) {
      const humanControl = r.human
        ? this.reviewDrive
          ? npcControl(r, track, riders, 'club')
          : this.override.get(r.id) || input.sample(r.device!)
        : null;
      if (this.reviewCrashTest === 'Crash landing' && r.id === 0 && humanControl && !r.grounded) humanControl.pitch = 1;
      const c =
        r.finished !== null
          ? npcControl(r, track, riders, 'relaxed')
          : // No computer rider is made to make a mistake in the pack before the holeshot line.
            humanControl ||
            npcControl(
              r,
              track,
              riders,
              this.difficulty,
              this.gate && !pastHoleshot(r.progress, track) ? 0 : this.seed,
            );
      if (humanControl?.pause) {
        // The lap clock has already moved on by this step, so the ghost records the rider standing still for it.
        if (this.trial) this.pushGhost();
        this.togglePause();
        return;
      }
      if (this.reviewCrashTest === 'Rider contact') Object.assign(c, idleControl());
      // Off the gate a rider may be held (a reaction time, or the penalty) or short of drive (a poor launch).
      const drive = this.gate ? this.gate.release(index, r) : 1;
      if (drive === 0) continue;
      if (this.trial && index === 0) {
        const p = this.poseBefore;
        [p.x, p.y, p.z, p.heading, p.pitch, p.lean] = [r.x, r.y, r.z, r.heading, r.pitch, r.lean];
      }
      stepRider(
        r,
        drive < 1 ? {...c, throttle: c.throttle * drive} : c,
        track,
        dt,
        riders,
        r.human ? this.slideAggression : 1,
      );
      if (this.gate && this.holeshot === null && pastHoleshot(r.progress, track)) {
        this.holeshot = r.id;
        screen.holeshot?.(r);
      }
      // Laps are timed until the rider takes the flag; the cool-down lap after it is not.
      if (r.finished === null || this.practice) {
        const lap = recordStep(this.timing[index], r.progress, this.raceTime - dt, dt, this.referenceLap(index));
        if (this.trial && index === 0) this.pushGhost();
        if (lap) {
          screen.lap?.(r, lap);
          if (this.trial && index === 0) {
            screen.ghostLap?.(r, lap, this.recorder.finish(lap.time));
            // The next lap began at the line, part of the way through this step.
            this.beginGhost(this.raceTime - this.timing[index].lapStart, this.poseBefore);
          }
        }
      } else r.progress.crossings.length = 0;
      if (r.lastLanding > 3 && r.human) screen.landing(r.lastLanding);
      if (!this.practice && r.finished === null && r.progress.lap >= this.lapCount) {
        r.finished = this.raceTime;
        if (r.human && this.firstFinish === null) this.firstFinish = this.raceTime;
      }
    }
    collide(riders, track);
    if (
      !this.practice &&
      (riders.filter(r => r.human).every(r => r.finished !== null) ||
        (this.firstFinish !== null && this.raceTime - this.firstFinish > TUNING.finishTimeout))
    )
      this.endRace();
  }
}
