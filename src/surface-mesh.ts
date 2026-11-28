import type * as THREE from 'three';
import type {Track} from './track';
import {surfaceFor} from './surface-wear';

/** The drawn track is brought up to the worn surface at most this often, in milliseconds. */
export const SURFACE_REDRAW_MS = 1000;
/** Keeps a track mesh in step with the braking bumps worn into its track, a stretch at a time. */
export class SurfaceMesh {
  private drawn = -Infinity;
  /** How many times the mesh has been redrawn, and how many rows the last time, for the checks. */
  redraws = 0;
  rows = 0;
  constructor(
    private readonly track: Track,
    private readonly geometry: THREE.BufferGeometry,
  ) {}
  /** Redraws the stretch that has changed, if any has and the last redraw was long enough ago. `now` is in milliseconds. */
  refresh(now: number) {
    if (now - this.drawn < SURFACE_REDRAW_MS) return false;
    const surface = surfaceFor(this.track),
      changed = surface.takeChanged();
    if (!changed) return false;
    this.drawn = now;
    this.rows = this.track.redraw(this.geometry, changed.from, changed.to, surface);
    this.redraws++;
    return true;
  }
}
