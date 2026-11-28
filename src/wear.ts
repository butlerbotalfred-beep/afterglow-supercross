// Track wear: how much each patch of dirt has been ridden over in the race being run. It is only looked at;
// nothing in the riding reads it. Nothing here touches the browser.
import type {Track} from './track';

/** The side of a cell, in metres. */
export const WEAR_CELL = 0.5;
/** Ground kept beyond the outermost point of the centre line: the track's half width and its shoulders. */
const MARGIN = 3;
/** A cell is worn through at this value: one byte a cell. */
export const WEAR_FULL = 255;
/** What one bike leaves in a cell it rides into: this much, more with speed, more again when it slides. */
const BASE = 2;
const PER_SPEED = 0.1;
const SPEED_CAP = 35;
const SLIDE = 9;
/**
 * The share of that left in the cells around it, by how many cells away (0 to 2, corners left out): a line
 * comes out about two metres wide and soft at the edges, as a pack of bikes leaves it.
 */
const SHARES = [
  [0, 0, 1],
  [1, 0, 0.6],
  [1, 1, 0.45],
  [2, 0, 0.25],
  [2, 1, 0.15],
];
/** Every cell of that stamp, as columns and rows from the middle and its share: 21 of them. */
const STAMP: [number, number, number][] = [];
for (const [a, b, share] of SHARES)
  for (const [dc, dr] of [
    [a, b],
    [b, a],
  ])
    for (const sc of [1, -1])
      for (const sr of [1, -1])
        if (!STAMP.some(([c, r]) => c === dc * sc && r === dr * sr)) STAMP.push([dc * sc, dr * sr, share]);

/** What the grid needs to know of a rider. */
export interface WearSource {
  id: number;
  x: number;
  z: number;
  speed: number;
  grounded: boolean;
  powerSlide: number;
  slipAngle: number;
  crashTime: number;
}

export class WearGrid {
  readonly cols: number;
  readonly rows: number;
  /** The world position of the corner of cell (0, 0). */
  readonly originX: number;
  readonly originZ: number;
  /** One byte a cell, row by row along Z; 0 is untouched dirt. */
  readonly cells: Uint8Array;
  /** Goes up whenever a cell changes, so a picture of the grid knows when it is out of date. */
  version = 0;
  /**
   * Where each rider last left wear, by rider id: the cell, so a cell is worn once a pass however slowly it
   * is crossed, and the place, so a pass leaves the same whichever way it runs across the cells.
   */
  private last = new Map<number, {cell: number; x: number; z: number}>();

  constructor(track: Pick<Track, 'bounds' | 'halfWidth'>) {
    const pad = track.halfWidth + MARGIN;
    this.originX = Math.floor((track.bounds.minX - pad) / WEAR_CELL) * WEAR_CELL;
    this.originZ = Math.floor((track.bounds.minZ - pad) / WEAR_CELL) * WEAR_CELL;
    this.cols = Math.ceil((track.bounds.maxX + pad - this.originX) / WEAR_CELL);
    this.rows = Math.ceil((track.bounds.maxZ + pad - this.originZ) / WEAR_CELL);
    this.cells = new Uint8Array(this.cols * this.rows);
  }
  /** The memory the grid holds, in bytes. */
  get bytes() {
    return this.cells.byteLength;
  }
  /** Fresh dirt everywhere. */
  clear() {
    this.last.clear();
    this.cells.fill(0);
    this.version++;
  }
  /** The cell a point is in, or -1 off the grid. */
  cellAt(x: number, z: number) {
    const col = Math.floor((x - this.originX) / WEAR_CELL),
      row = Math.floor((z - this.originZ) / WEAR_CELL);
    return col < 0 || row < 0 || col >= this.cols || row >= this.rows ? -1 : row * this.cols + col;
  }
  /** Wear at a point, 0 to 1. */
  at(x: number, z: number) {
    const cell = this.cellAt(x, z);
    return cell < 0 ? 0 : this.cells[cell] / WEAR_FULL;
  }
  private add(cell: number, amount: number) {
    this.cells[cell] = Math.min(WEAR_FULL, this.cells[cell] + amount);
  }
  /**
   * One physics step of one rider. A bike on its wheels wears the cell it rides into; in the air, on its
   * side or standing still it leaves nothing.
   */
  ride(r: WearSource) {
    if (!r.grounded || r.crashTime > 0 || r.speed < 1) {
      this.last.delete(r.id);
      return;
    }
    const cell = this.cellAt(r.x, r.z);
    const before = this.last.get(r.id);
    if (cell === before?.cell) return;
    // Wear by the metre: a line cutting the corners of cells enters more of them, and leaves less in each.
    const travelled = before ? Math.hypot(r.x - before.x, r.z - before.z) / WEAR_CELL : 1;
    this.last.set(r.id, {cell, x: r.x, z: r.z});
    if (cell < 0) return;
    const slide = Math.min(1, Math.max(r.powerSlide, Math.abs(r.slipAngle) / 0.6));
    const amount = (BASE + PER_SPEED * Math.min(SPEED_CAP, r.speed) + SLIDE * slide) * Math.min(1.5, travelled);
    const col = cell % this.cols,
      row = (cell - col) / this.cols;
    for (const [dc, dr, share] of STAMP) {
      const c = col + dc,
        at = row + dr;
      if (c >= 0 && at >= 0 && c < this.cols && at < this.rows)
        this.add(at * this.cols + c, Math.round(amount * share));
    }
    this.version++;
  }
}

const grids = new WeakMap<object, WearGrid>();
/** The one wear grid of a track: the race wears it and the world draws it. */
export function wearFor(track: Pick<Track, 'bounds' | 'halfWidth'>) {
  let grid = grids.get(track);
  if (!grid) grids.set(track, (grid = new WearGrid(track)));
  return grid;
}
