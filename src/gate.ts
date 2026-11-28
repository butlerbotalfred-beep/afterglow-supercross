// The start gate: the board, the seeded drop, the launch off the line and the holeshot. No browser in here.
import {progressDistance} from './race';
import {startSharpness, type RiderProfile} from './riders';
import {Rng} from './rng';

export const GATE = {
  /** Seconds the board is shown before the gate goes live. */
  board: 5,
  /** Once live, the gate drops after a delay between these two, in seconds. */
  minDelay: 1,
  maxDelay: 3,
  /** Seconds a rider who moved before the drop is held against the gate after it falls. */
  penalty: 0.5,
  /** Revs, 0 to 1, between which a launch gets the best drive. */
  bandLow: 0.55,
  bandHigh: 0.8,
  /** Revs at which a waiting bike creeps forward into the gate. */
  creep: 0.93,
  /** Seconds after the board goes during which nobody is caught, so a rider can still come off the throttle. */
  grace: 0.3,
  /** How fast the revs follow the throttle, in full scales a second. */
  revRise: 0.6,
  revFall: 0.5,
  /** The share of full drive a launch outside the band gets, and for how many metres. */
  poorDrive: 0.7,
  launchDistance: 14,
  /** A computer rider's reaction to the drop is between these two, in seconds. */
  minReaction: 0.06,
  maxReaction: 0.3,
} as const;

const mix = (seed: number, salt: number) => {
  const rng = new Rng((seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0);
  rng.next();
  return rng;
};
/** Seconds from the gate going live to the drop. The same seed always gives the same delay. */
export function gateDelay(seed: number) {
  return mix(seed, 0x6a7e).range(GATE.minDelay, GATE.maxDelay);
}
/** Seconds a computer rider takes to react to the drop. Quicker riders are a little sharper. */
export function npcReaction(seed: number, rider: number, difficulty: string, sharpness?: number) {
  // A roster rider's starts rating sets how sharp it is; without one the pace setting does.
  const sharp = sharpness ?? (difficulty === 'expert' ? 0.75 : difficulty === 'relaxed' ? 1.15 : 1);
  return Math.min(GATE.maxReaction, mix(seed, 0x51ed + rider * 7).range(GATE.minReaction, GATE.maxReaction) * sharp);
}
export const inBand = (revs: number) => revs >= GATE.bandLow && revs <= GATE.bandHigh;

export type LaunchResult = '' | 'good' | 'poor' | 'jumped';
/** One rider at the gate. */
export interface Launch {
  /** Engine revs while waiting, 0 to 1. */
  revs: number;
  /** The rider crept into the gate before it dropped. */
  jumped: boolean;
  /** Physics steps the rider is still held for after the drop. */
  held: number;
  /** The share of full drive off the line: 1 for a launch in the band, less outside it. */
  drive: number;
  /** How the launch went, once the gate has dropped. */
  result: LaunchResult;
  /** Where the rider started from. */
  x: number;
  z: number;
}
interface Starter {
  id: number;
  human: boolean;
  x: number;
  z: number;
  surface: {lateral: number};
  startLane?: number;
  profile?: RiderProfile;
}
/** Riders in a grid row, and the seconds a second-row computer rider waits after the bike ahead moves. */
const GRID_ROW = 4;
const ROW_GAP = 0.03;
/** The share of its grid offset a computer rider keeps as its lane to the holeshot line. */
const START_LANE = 0.85;
/**
 * The gate for one race start. Before the drop, `wait` is called once a physics step with every rider's
 * throttle; after it, `release` says whether each rider may move and how much drive they have.
 */
export class StartGate {
  /** Seconds since the start button. */
  elapsed = 0;
  dropped = false;
  /** Seconds from the start button to the drop. */
  readonly dropAt: number;
  readonly launches: Launch[];
  private readonly reactions: number[];
  private readonly human: boolean[];

  constructor(seed: number, riders: Starter[], difficulty: string) {
    this.dropAt = GATE.board + gateDelay(seed);
    this.launches = riders.map(r => ({revs: 0, jumped: false, held: 0, drive: 1, result: '', x: r.x, z: r.z}));
    this.human = riders.map(r => r.human);
    this.reactions = riders.map(r =>
      r.human ? 0 : npcReaction(seed, r.id, difficulty, r.profile ? startSharpness(r.profile) : undefined),
    );
    for (const r of riders) if (!r.human) r.startLane = r.surface.lateral * START_LANE;
  }
  /** True once the board has gone and the gate may drop at any moment: from here creeping is punished. */
  get live() {
    return this.elapsed >= GATE.board && !this.dropped;
  }
  /** Whole seconds left on the board, 5 down to 1, or 0 once the gate is live. */
  get board() {
    return Math.max(0, Math.ceil(GATE.board - this.elapsed - 1e-9));
  }
  /**
   * One step of waiting. `throttle` gives a rider's throttle, 0 to 1; a computer rider (null) holds the middle
   * of the band. Returns what happened in the step: riders who crept into the gate, and whether it dropped.
   */
  wait(dt: number, throttle: (index: number) => number | null) {
    const jumped: number[] = [];
    if (this.dropped) return {jumped, dropped: false};
    this.elapsed += dt;
    const steps = (seconds: number) => Math.round(seconds / dt);
    this.launches.forEach((launch, index) => {
      const asked = throttle(index);
      const target = asked === null ? (GATE.bandLow + GATE.bandHigh) / 2 : Math.min(1, Math.max(0, asked));
      const change = target - launch.revs;
      launch.revs += Math.sign(change) * Math.min(Math.abs(change), (change > 0 ? GATE.revRise : GATE.revFall) * dt);
      // Revs still falling from the board do not count: the rider has to be holding them up there.
      const pinned = launch.revs >= GATE.creep && target >= GATE.creep;
      if (this.elapsed >= GATE.board + GATE.grace && !launch.jumped && pinned) {
        launch.jumped = true;
        jumped.push(index);
      }
    });
    if (this.elapsed < this.dropAt - 1e-9) return {jumped, dropped: false};
    this.dropped = true;
    this.launches.forEach((launch, index) => {
      // A rider who hit the gate is held, then leaves cleanly: the hold is the whole cost.
      launch.result = launch.jumped ? 'jumped' : inBand(launch.revs) ? 'good' : 'poor';
      launch.drive = launch.result === 'poor' ? GATE.poorDrive : 1;
      launch.held = launch.jumped ? steps(GATE.penalty) : steps(this.reactions[index]);
    });
    // The grid is rows of four. Nobody in the second row can go before the bike in front of them has.
    this.launches.forEach((launch, index) => {
      const front = this.launches[index - GRID_ROW];
      if (front && !this.human[index]) launch.held = Math.max(launch.held, front.held + steps(ROW_GAP));
    });
    return {jumped, dropped: true};
  }
  /**
   * After the drop, once a step for each rider: 0 while the rider is still held, otherwise the share of the
   * throttle that reaches the ground (less than 1 for a launch outside the band until the bike is clear).
   */
  release(index: number, rider: {x: number; z: number}) {
    const launch = this.launches[index];
    if (launch.held > 0) {
      launch.held--;
      return 0;
    }
    if (launch.drive < 1 && Math.hypot(rider.x - launch.x, rider.z - launch.z) >= GATE.launchDistance) launch.drive = 1;
    return launch.drive;
  }
}
/** True once a rider on the first lap has passed the holeshot line. */
export function pastHoleshot(
  progress: Parameters<typeof progressDistance>[0],
  track: {length: number; holeshot: number},
) {
  return progressDistance(progress, track.length) >= track.holeshot;
}
export const GATE_SECONDS_MAX = GATE.board + GATE.maxDelay;
