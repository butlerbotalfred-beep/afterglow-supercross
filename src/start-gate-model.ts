// The start gate as the riders see it: one bar across the front wheel of every bike on the grid.
import * as THREE from 'three';
import type {Track} from './track';

/** How far in front of a grid row its gate stands, in metres. */
const AHEAD = 1.25;

/**
 * Builds the gate for a grid of `riderCount` bikes, laid out as makeRider lays them out: rows of four, 1.9 m
 * apart, the first row 3 m behind the line and each row 2.8 m behind the one in front.
 * `set(1)` lays every bar flat on the ground towards its rider, as a real gate falls; `set(0)` stands it up.
 */
export function createGateBars(track: Track, riderCount: number) {
  const group = new THREE.Group();
  group.name = 'Start gate';
  const metal = new THREE.MeshStandardMaterial({color: 0xdfe3ea, metalness: 0.75, roughness: 0.32});
  const bar = new THREE.BoxGeometry(1.62, 0.07, 0.07),
    arm = new THREE.BoxGeometry(0.06, 0.52, 0.06),
    foot = new THREE.BoxGeometry(1.8, 0.05, 0.3);
  const base = new THREE.MeshStandardMaterial({color: 0x2a2d36, roughness: 0.9});
  const flaps: THREE.Group[] = [];
  for (let id = 0; id < riderCount; id++) {
    const s = -3 - Math.floor(id / 4) * 2.8 + AHEAD,
      lateral = ((id % 4) - 1.5) * 1.9,
      p = track.at(s, lateral);
    const stand = new THREE.Group();
    stand.position.set(p.x, track.height(s, lateral) + 0.02, p.z);
    stand.rotation.y = Math.atan2(p.tx, p.tz);
    stand.add(new THREE.Mesh(foot, base));
    const flap = new THREE.Group();
    const top = new THREE.Mesh(bar, metal);
    top.position.y = 0.52;
    flap.add(top);
    for (const side of [-0.78, 0.78]) {
      const upright = new THREE.Mesh(arm, metal);
      upright.position.set(side, 0.26, 0);
      flap.add(upright);
    }
    flap.traverse(o => (o.castShadow = true));
    stand.add(flap);
    group.add(stand);
    flaps.push(flap);
  }
  return {
    group,
    /** 0 is standing, 1 is flat on the ground. */
    set(open: number) {
      for (const flap of flaps) flap.rotation.x = (-Math.PI / 2) * 0.97 * Math.min(1, Math.max(0, open));
    },
    dispose() {
      for (const geometry of [bar, arm, foot]) geometry.dispose();
      metal.dispose();
      base.dispose();
    },
  };
}
export type GateBars = ReturnType<typeof createGateBars>;
