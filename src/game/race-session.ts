// The race flow with no browser in it: setup, countdown, racing, results, pause and the fixed-step clock.
// Input and screen are passed in, so tests can run whole races in Node.
import {COLORS, TUNING} from '../config';
import {uniqueDevices, type Control, type Device} from '../input';
import {collide, idleControl, makeRider, npcControl, stepRider, type Rider} from '../physics';
import type {Track} from '../track';

export type Phase = 'setup' | 'countdown' | 'racing' | 'results';

/** Where rider controls come from. */
export interface SessionInput {
  sample(device: Device): Control;
  connectedGamepads(): {index: number}[];
}
/** What the session tells the screen and speakers. Every method is a notification; none returns a value. */
export interface SessionScreen {
  /** The countdown number to show. It starts at 4 for the first 0.8 s, then 3, 2, 1. */
  countdown(n: number): void;
  /** The gate has dropped: racing has begun. */
  racing(): void;
  /** A short beep. */
  cue(frequency: number, seconds: number): void;
  /** A human rider landed hard. */
  landing(impact: number): void;
  /** The shared pause was switched on or off. `missing` is a human whose controller has gone. */
  pause(paused: boolean, missing: Rider | undefined): void;
  /** The race is over and riders are classified. */
  results(): void;
}
export interface GridConfig {
  track: Track;
  humanCount: number;
  npcCount: number;
  practice: boolean;
  assignments: (Device | null)[];
}
export interface RaceConfig {
  lapCount: number;
  difficulty: string;
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
  lapCount = 3;
  difficulty = 'club';
  raceTime = 0;
  countdown = COUNTDOWN_SECONDS;
  firstFinish: number | null = null;
  riders: Rider[] = [];
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

  constructor(
    private input: SessionInput,
    private screen: SessionScreen,
  ) {}

  /** Lines riders up on the start grid. Humans come first, then NPCs (none in practice). */
  grid({track, humanCount, npcCount, practice, assignments}: GridConfig) {
    this.track = track;
    this.practice = practice;
    this.riders = Array.from({length: humanCount + (practice ? 0 : npcCount)}, (_, i) =>
      makeRider(track, i, i < humanCount, COLORS[i], i < humanCount ? assignments[i] || undefined : undefined),
    );
    this.riders.forEach((r, i) => {
      if (!r.human) r.name = NPC_NAMES[(i - humanCount) % NPC_NAMES.length];
    });
  }
  /** Starts the countdown for the riders already on the grid. */
  start({lapCount, difficulty}: RaceConfig) {
    this.lapCount = lapCount;
    this.difficulty = difficulty;
    this.raceTime = 0;
    this.countdown = COUNTDOWN_SECONDS;
    this.firstFinish = null;
    this.paused = false;
    this.phase = 'countdown';
    this.lastTickSound = 4;
    this.accumulator = 0;
    this.override.clear();
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
      for (const r of riders.filter(r => r.human))
        if (input.sample(r.device!).pause) {
          this.togglePause();
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
    for (const r of riders) {
      const humanControl = r.human
        ? this.reviewDrive
          ? npcControl(r, track, riders, 'club')
          : this.override.get(r.id) || input.sample(r.device!)
        : null;
      if (this.reviewCrashTest === 'Crash landing' && r.id === 0 && humanControl && !r.grounded) humanControl.pitch = 1;
      const c =
        r.finished !== null
          ? npcControl(r, track, riders, 'relaxed')
          : humanControl || npcControl(r, track, riders, this.difficulty);
      if (humanControl?.pause) {
        this.togglePause();
        return;
      }
      if (this.reviewCrashTest === 'Rider contact') Object.assign(c, idleControl());
      stepRider(r, c, track, dt, riders, r.human ? this.slideAggression : 1);
      if (r.lastLanding > 3 && r.human) screen.landing(r.lastLanding);
      if (!this.practice && r.finished === null && r.progress.lap >= this.lapCount) {
        r.finished = this.raceTime;
        if (r.human && this.firstFinish === null) this.firstFinish = this.raceTime;
        screen.cue(900, 0.25);
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
