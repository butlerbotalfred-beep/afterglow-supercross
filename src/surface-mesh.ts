import type * as THREE from 'three';
import type {Track} from './track';
import {surfaceFor} from './surface-wear';

/** The drawn track is brought up to the worn surface at most this often, in milliseconds. */
export const SURFACE_REDRAW_MS = 1000;
/** At most this many bump cells (2 m of track each) are redrawn at a time, so a redraw never holds up a frame for long. */
export const SURFACE_REDRAW_CELLS = 16;
/** Keeps a track mesh in step with the braking bumps worn into its track, a few stretches at a time. */
export class SurfaceMesh {
  private drawn = -Infinity;
  /** The normals each redrawn row had as built, kept so that ground with no bumps is lit as it always was. */
  private readonly built = new Map<number, Float32Array>();
  /** How many times the mesh has been redrawn, and how many rows the last time, for the checks. */
  redraws = 0;
  rows = 0;
  constructor(
    private readonly track: Track,
    private readonly geometry: THREE.BufferGeometry,
  ) {}
  /**
   * Redraws some of what has changed, if anything has and the last redraw was long enough ago: up to
   * `SURFACE_REDRAW_CELLS` cells, or everything when the surface has been cleared. `now` is in milliseconds.
   */
  refresh(now: number) {
    if (now - this.drawn < SURFACE_REDRAW_MS) return false;
    const surface = surfaceFor(this.track),
      changed = surface.takeChanged(SURFACE_REDRAW_CELLS);
    if (!changed.length) return false;
    this.drawn = now;
    this.rows = this.track.redraw(this.geometry, changed, surface, this.built);
    this.redraws++;
    return true;
  }
}
