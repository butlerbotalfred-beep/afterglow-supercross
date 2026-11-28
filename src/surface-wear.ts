// Wear that changes the riding: ruts that form in turns and braking bumps that form where riders brake.
// Kept along the track (distance round the lap by distance across it), apart from the picture of wear in
// wear.ts, and only read by the physics when a race is run with wear physics on. Nothing here touches the browser.

/** A rut at full depth turns the bike this much tighter. */
export const RUT_TURN_BONUS = 0.08;
/** Braking bumps at full wear stand this far above and below the ground, in metres: 6 cm from top to bottom. */
export const BUMP_AMPLITUDE = 0.03;
/** The length of one braking bump, in metres, before it is fitted to a whole number round the lap. */
const BUMP_LENGTH = 2.6;
/** Bumps at full wear take this share of the brakes away: the wheels spend part of each bump unloaded. */
export const BUMP_BRAKE_LOSS = 0.2;

/** Ruts: cells 1 m along the track and 0.4 m across. */
const RUT_ALONG = 1;
const RUT_ACROSS = 0.4;
/** Bumps: cells 2 m along and 1.2 m across, so the height of the bumps changes gently from place to place. */
const BUMP_ALONG = 2;
const BUMP_ACROSS = 1.2;
/** Cells run this far beyond the edge of the track. */
const MARGIN = 1.2;
const FULL = 255;
/** The ground bends sharply where its middle is this far, in metres, off the straight line between points 0.5 m apart. */
const SHARP = 0.006;
/** A turn is where the track bends at least this much, in radians a metre: a 40 m radius. */
const TURN = 0.025;
/** What one pass leaves in a rut cell (of 255), and in the cells either side across the track. */
const RUT_PASS = 9;
const RUT_BESIDE = 4;
/** What a pass on full brakes leaves in a bump cell. */
const BUMP_PASS = 14;
/** Braking counts from this much lever and this speed (m/s). */
const BRAKE_FROM = 0.3;
const BRAKE_SPEED = 8;

/** What the surface needs to know of the track it lies on. */
export interface SurfaceTrack {
  length: number;
  halfWidth: number;
  curvature(s: number): number;
  height(s: number, lateral: number): number;
  jumps: readonly {start: number; rise: number; flat: number; fall: number}[];
}
/** What it needs to know of a rider. */
export interface SurfaceRider {
  id: number;
  speed: number;
  grounded: boolean;
  crashTime: number;
  brake: number;
  surface: {s: number; lateral: number};
}

const wrap = (v: number, n: number) => ((v % n) + n) % n;
const smooth = (t: number) => t * t * (3 - 2 * t);

/** A sheet of cells along and across the track, read smoothly between cell middles and round the lap. */
class Sheet {
  readonly along: number;
  readonly across: number;
  readonly cells: Uint8Array;
  private readonly stepAlong: number;
  constructor(
    length: number,
    private readonly reach: number,
    along: number,
    private readonly stepAcross: number,
  ) {
    this.along = Math.max(1, Math.round(length / along));
    this.stepAlong = length / this.along;
    this.across = Math.ceil((2 * reach) / stepAcross);
    this.cells = new Uint8Array(this.along * this.across);
  }
  /** The cell a point is in, or -1 beyond the sides. */
  index(s: number, lateral: number) {
    const j = Math.floor((lateral + this.reach) / this.stepAcross);
    if (j < 0 || j >= this.across) return -1;
    return (Math.floor(wrap(s, this.along * this.stepAlong) / this.stepAlong) % this.along) * this.across + j;
  }
  add(index: number, amount: number) {
    this.cells[index] = Math.min(FULL, this.cells[index] + amount);
  }
  /** 0 to 1 at a point, blended between the four nearest cell middles with no steps or creases. */
  at(s: number, lateral: number) {
    const a = wrap(s, this.along * this.stepAlong) / this.stepAlong - 0.5,
      b = (lateral + this.reach) / this.stepAcross - 0.5;
    const i0 = Math.floor(a),
      j0 = Math.floor(b),
      u = smooth(a - i0),
      v = smooth(b - j0);
    const cell = (i: number, j: number) =>
      j < 0 || j >= this.across ? 0 : this.cells[wrap(i, this.along) * this.across + j];
    const blend =
      (cell(i0, j0) * (1 - u) + cell(i0 + 1, j0) * u) * (1 - v) +
      (cell(i0, j0 + 1) * (1 - u) + cell(i0 + 1, j0 + 1) * u) * v;
    return Math.min(1, blend / FULL);
  }
}

export class SurfaceWear {
  private readonly ruts: Sheet;
  private readonly bumps: Sheet;
  /** Whether the ground at each bump cell is flat enough for bumps: not on a jump or just before one. */
  private readonly flat: Uint8Array;
  /** For each bump cell: 0 not yet looked at, 1 no sharp bend, 2 a sharp bend. */
  private readonly sharp: Uint8Array;
  private readonly wave: number;
  /** The cells each rider last wore, by rider id, so a cell is worn once a pass. */
  private last = new Map<number, {rut: number; bump: number}>();
  /** Goes up whenever the height of the ground changes, so the drawn track knows to catch up. */
  version = 0;
  /** The stretch of the lap whose height has changed since `takeChanged` was last called, or null. */
  private changed: {from: number; to: number} | null = null;

  constructor(private readonly track: SurfaceTrack) {
    const reach = track.halfWidth + MARGIN;
    this.ruts = new Sheet(track.length, reach, RUT_ALONG, RUT_ACROSS);
    this.bumps = new Sheet(track.length, reach, BUMP_ALONG, BUMP_ACROSS);
    // A whole number of bumps round the lap, so there is no step where the lap closes.
    this.wave = (2 * Math.PI * Math.max(1, Math.round(track.length / BUMP_LENGTH))) / track.length;
    const step = track.length / this.bumps.along;
    this.flat = new Uint8Array(this.bumps.along);
    this.sharp = new Uint8Array(this.bumps.along);
    for (let i = 0; i < this.bumps.along; i++) {
      const from = i * step - 2,
        to = (i + 1) * step + 6;
      // Clear of every jump, from 2 m after its landing to 6 m before its takeoff.
      this.flat[i] = track.jumps.every(j => {
        const span = j.rise + j.flat + j.fall;
        // Neither end of the stretch is on the jump, and the jump does not lie inside the stretch.
        return (
          wrap(from - j.start, track.length) >= span &&
          wrap(to - j.start, track.length) >= span &&
          wrap(j.start - from, track.length) > to - from
        );
      })
        ? 1
        : 0;
    }
  }
  /**
   * Whether the ground as built bends sharply along the track somewhere in a bump cell (the ends of a berm):
   * a drawn track of straight pieces half a metre long is already off there, and bumps would be drawn off
   * with it. Worked out the first time it is asked, a cell at a time, and remembered.
   */
  private bends(i: number) {
    const cell = wrap(i, this.bumps.along);
    if (this.sharp[cell]) return this.sharp[cell] === 2;
    const step = this.track.length / this.bumps.along,
      reach = this.track.halfWidth + MARGIN;
    let bends = false;
    for (let s = cell * step; s < (cell + 1) * step && !bends; s += 0.125)
      for (let lateral = -reach; lateral <= reach && !bends; lateral += 0.6) {
        const middle = (this.track.height(s, lateral) + this.track.height(s + 0.5, lateral)) / 2;
        bends = Math.abs(this.track.height(s + 0.25, lateral) - middle) > SHARP;
      }
    this.sharp[cell] = bends ? 2 : 1;
    return bends;
  }
  /** Whether braking bumps may form in a bump cell: flat ground, with no sharp bend in it or within two cells. */
  private bumpable(i: number) {
    if (!this.flat[i]) return false;
    for (let near = -2; near <= 2; near++) if (this.bends(i + near)) return false;
    return true;
  }
  /** The memory the surface holds, in bytes. */
  get bytes() {
    return this.ruts.cells.byteLength + this.bumps.cells.byteLength + this.flat.byteLength + this.sharp.byteLength;
  }
  /** Fresh ground everywhere. */
  clear() {
    this.last.clear();
    const dirty = this.bumps.cells.some(v => v > 0);
    this.ruts.cells.fill(0);
    this.bumps.cells.fill(0);
    if (dirty) {
      this.version++;
      this.changed = {from: 0, to: this.track.length};
    }
  }
  /** How deep the rut is at a point, 0 to 1. */
  rut(s: number, lateral: number) {
    return this.ruts.at(s, lateral);
  }
  /** How rough the braking bumps are at a point, 0 to 1. */
  rough(s: number, lateral: number) {
    return this.bumps.at(s, lateral);
  }
  /** What the braking bumps add to the height of the ground at a point, in metres: within ±BUMP_AMPLITUDE. */
  bump(s: number, lateral: number) {
    const rough = this.bumps.at(s, lateral);
    return rough === 0 ? 0 : BUMP_AMPLITUDE * rough * Math.sin(s * this.wave);
  }
  /** One physics step of one rider: a turn ridden wears a rut, braking on flat ground wears bumps. */
  ride(r: SurfaceRider) {
    if (!r.grounded || r.crashTime > 0 || r.speed < 3) {
      this.last.delete(r.id);
      return;
    }
    const {s, lateral} = r.surface;
    let last = this.last.get(r.id);
    if (!last) this.last.set(r.id, (last = {rut: -1, bump: -1}));
    const rut = this.ruts.index(s, lateral);
    if (rut !== last.rut) {
      last.rut = rut;
      if (rut >= 0 && Math.abs(this.track.curvature(s)) >= TURN) {
        const j = rut % this.ruts.across;
        this.ruts.add(rut, RUT_PASS);
        if (j > 0) this.ruts.add(rut - 1, RUT_BESIDE);
        if (j < this.ruts.across - 1) this.ruts.add(rut + 1, RUT_BESIDE);
      }
    }
    const bump = this.bumps.index(s, lateral);
    if (bump !== last.bump) {
      last.bump = bump;
      const along = bump < 0 ? -1 : (bump - (bump % this.bumps.across)) / this.bumps.across;
      if (along >= 0 && r.brake >= BRAKE_FROM && r.speed >= BRAKE_SPEED && this.bumpable(along)) {
        this.bumps.add(bump, Math.round(BUMP_PASS * Math.min(1, r.brake)));
        this.version++;
        // The height changes as far as the blend reaches: a cell and a half either way.
        const step = this.track.length / this.bumps.along;
        const from = (along - 1.5) * step,
          to = (along + 2.5) * step;
        this.changed = this.changed
          ? {from: Math.min(this.changed.from, from), to: Math.max(this.changed.to, to)}
          : {from, to};
      }
    }
  }
  /**
   * The stretch of the lap, in metres from the line, whose height has changed since this was last asked; it
   * may start before 0 or end past the lap's length where it runs over the line. Null when nothing has.
   */
  takeChanged() {
    const changed = this.changed;
    this.changed = null;
    return changed;
  }
  /** For checks: every rut and bump cell worn through. */
  wearThrough() {
    this.ruts.cells.fill(FULL);
    for (let i = 0; i < this.bumps.along; i++)
      if (this.bumpable(i)) this.bumps.cells.fill(FULL, i * this.bumps.across, (i + 1) * this.bumps.across);
    this.version++;
    this.changed = {from: 0, to: this.track.length};
  }
}

const surfaces = new WeakMap<object, SurfaceWear>();
/** The one worn surface of a track: the race wears it, the physics rides it and the world draws it. */
export function surfaceFor(track: SurfaceTrack) {
  let surface = surfaces.get(track);
  if (!surface) surfaces.set(track, (surface = new SurfaceWear(track)));
  return surface;
}
