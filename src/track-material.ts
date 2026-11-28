import * as THREE from 'three';
import {loadTexture} from './assets';
import {WEAR_CELL, type WearGrid} from './wear';
/** The wear picture is sent to the graphics card again at most this often, in milliseconds. */
export const WEAR_REFRESH_MS = 250;
/** No wear picture for a track wider than this many cells: older phones cannot hold a bigger texture. */
const WEAR_MAX_SIDE = 4096;
/** The wear grid as a picture the track material darkens the dirt with. */
export class WearLayer {
  readonly texture: THREE.DataTexture;
  /** Where the grid lies in the world: corner X and Z, then one over its width and depth. */
  readonly rect: THREE.Vector4;
  private seen = -1;
  private sent = -Infinity;
  /** How many times the picture has been sent, for the checks. */
  uploads = 0;
  constructor(readonly grid: WearGrid) {
    this.texture = new THREE.DataTexture(grid.cells, grid.cols, grid.rows, THREE.RedFormat, THREE.UnsignedByteType);
    // One byte a cell, and rows of any length.
    this.texture.unpackAlignment = 1;
    this.texture.magFilter = this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.rect = new THREE.Vector4(grid.originX, grid.originZ, 1 / (grid.cols * WEAR_CELL), 1 / (grid.rows * WEAR_CELL));
    this.refresh(0);
  }
  static fits(grid: WearGrid) {
    return grid.cols <= WEAR_MAX_SIDE && grid.rows <= WEAR_MAX_SIDE;
  }
  /** Sends the picture if the grid has changed and the last send was long enough ago. `now` is in milliseconds. */
  refresh(now: number) {
    if (this.grid.version === this.seen || now - this.sent < WEAR_REFRESH_MS) return false;
    this.seen = this.grid.version;
    this.sent = now;
    this.texture.needsUpdate = true;
    this.uploads++;
    return true;
  }
  dispose() {
    this.texture.dispose();
  }
}
/**
 * Locally served original texture; shallow shader grooves follow the course UVs. Given a wear layer, the dirt
 * is darkened where it has been ridden; the track editor's preview gives none.
 */
export function dirtMaterial(ground = false, onLoad?: () => void, wear?: WearLayer) {
  const dirt = loadTexture('dirt-clay-v2.webp', onLoad);
  dirt.colorSpace = THREE.SRGBColorSpace;
  dirt.wrapS = dirt.wrapT = THREE.RepeatWrapping;
  dirt.anisotropy = 8;
  if (ground) dirt.repeat.set(450, 450);
  const material = new THREE.MeshStandardMaterial({
    map: dirt,
    bumpMap: dirt,
    bumpScale: ground ? 0.075 : 0.18,
    roughness: 0.98,
    vertexColors: !ground,
  });
  if (!ground) {
    material.onBeforeCompile = shader => {
      if (wear) {
        shader.uniforms.wearMap = {value: wear.texture};
        shader.uniforms.wearRect = {value: wear.rect};
        // The track mesh is built in world coordinates, so a vertex's position is where it is in the world.
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform vec4 wearRect;\nvarying vec2 vWearUv;')
          .replace(
            '#include <begin_vertex>',
            '#include <begin_vertex>\nvWearUv=(position.xz-wearRect.xy)*wearRect.zw;',
          );
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform sampler2D wearMap;\nvarying vec2 vWearUv;')
          .replace(
            '#include <map_fragment>',
            `#include <map_fragment>
        // Ridden dirt is packed down and damp: darker and a little redder, patchy with the grain of the clay.
        float worn=smoothstep(.02,.7,texture2D(wearMap,vWearUv).r);
        float grain=texture2D(map,vMapUv*2.7).g;
        float pack=worn*(.34+.3*grain);
        diffuseColor.rgb*=vec3(1.-pack,1.-pack*1.08,1.-pack*1.2);`,
          );
      }
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        // Fine racing ruts curve slightly along travel; broad shoulders stay granular.
        float line=vMapUv.x*19.0+sin(vMapUv.y*.48)*.18+sin(vMapUv.y*1.7)*.04;
        float rut=pow(.5+.5*cos(line*6.283185),18.);
        float cut=pow(.5+.5*cos((line+.15)*6.283185),9.);
        diffuseColor.rgb*=1.-rut*.23+cut*.075;
      `,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        // Ruts catch the key light rather than being painted dark stripes alone.
        float grooveHeight=-rut*.045+cut*.012;
        normal=perturbNormalArb(-vViewPosition,normal,vec2(dFdx(grooveHeight),dFdy(grooveHeight)),faceDirection);
      `,
      );
    };
    material.customProgramCacheKey = () => (wear ? 'clay-ruts-v3-wear' : 'clay-ruts-v3');
  }
  return material;
}
export function barrierTexture(color: string, chevrons: boolean) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const c = canvas.getContext('2d')!;
  c.fillStyle = color;
  c.fillRect(0, 0, 512, 128);
  // Padded vinyl has stitched edges, folds, scuffs and lighter upper piping.
  for (let i = 0; i < 14; i++) {
    const x = (i * 71.17) % 512,
      bend = Math.sin(i * 3.2) * 28;
    c.strokeStyle = '#05091622';
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(x, 0);
    c.bezierCurveTo(x + bend, 39, x - bend * 0.4, 82, x + bend * 0.6, 128);
    c.stroke();
    c.strokeStyle = '#ffffff13';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(x - 3, 0);
    c.bezierCurveTo(x + bend - 3, 39, x - bend * 0.4 - 3, 82, x + bend * 0.6 - 3, 128);
    c.stroke();
  }
  c.strokeStyle = '#ffffff44';
  c.lineWidth = 2;
  c.strokeRect(4, 5, 504, 118);
  c.strokeStyle = '#0b102c66';
  c.strokeRect(7, 8, 498, 113);
  if (chevrons) {
    c.fillStyle = '#f1bd39';
    for (const x of [160, 213, 330, 383]) {
      c.beginPath();
      c.moveTo(x, 28);
      c.lineTo(x + 23, 28);
      c.lineTo(x + 48, 64);
      c.lineTo(x + 23, 100);
      c.lineTo(x, 100);
      c.lineTo(x + 25, 64);
      c.closePath();
      c.fill();
    }
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
