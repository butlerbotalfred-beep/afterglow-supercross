// WebGL renderer setup, resizing and drawing each rider's viewport (or the setup preview).
import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import type {createBike} from '../bike-model';
import type {ChaseCamera} from '../camera';
import type {Rider} from '../physics';
import type {RaceEffects} from '../race-effects';
import type {Pose} from '../render-interp';
import type {Track} from '../track';
import {views} from '../ui/hud';
import {focusRaceShadows} from '../world';

export type RenderContext = {
  renderer: THREE.WebGLRenderer;
  effects: RaceEffects;
  scene: THREE.Scene;
  preview: THREE.PerspectiveCamera;
  track: Track;
  riders: Rider[];
  models: ReturnType<typeof createBike>[];
  cameras: ChaseCamera[];
  phase: string;
  humanCount: number;
  globalTime: number;
  cameraDistance: number;
  cameraShake: number;
  drawPose: (r: Rider, i: number) => Pose;
};

export function createRenderer(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor('#716d8e');
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  const environmentScene = new RoomEnvironment(),
    pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(environmentScene, 0.06);
  environmentScene.dispose();
  pmrem.dispose();
  renderer.autoClear = false;
  function lightWorld(world: THREE.Scene) {
    world.environment = environment.texture;
    world.environmentIntensity = 0.45;
    return world;
  }
  return {renderer, lightWorld};
}
export function resizeRenderer(renderer: THREE.WebGLRenderer, preview: THREE.PerspectiveCamera, renderScale: number) {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5) * renderScale);
  renderer.setSize(innerWidth, innerHeight, false);
  preview.aspect = innerWidth / innerHeight;
  preview.updateProjectionMatrix();
}
// Draws one frame and returns the scene's draw calls (before post-processing).
export function renderViews(ctx: RenderContext, dt: number) {
  const {renderer, effects, scene, preview, track, riders, models, cameras, phase, humanCount, globalTime} = ctx;
  const {cameraDistance, cameraShake, drawPose} = ctx;
  focusRaceShadows(scene, phase === 'setup' ? riders.slice(0, 1) : riders.slice(0, humanCount));
  renderer.shadowMap.needsUpdate = true;
  effects.begin(phase === 'setup' ? 1 : humanCount, phase === 'setup');
  const w = innerWidth,
    h = innerHeight;
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, w, h);
  renderer.clear();
  if (phase === 'setup') {
    const p = track.at(14),
      v = track.at(30);
    preview.position.set(p.x - 17 + Math.sin(globalTime * 0.07) * 2, track.height(14) + 9, p.z - 16);
    preview.lookAt(v.x, track.height(30) + 2, v.z);
    renderer.render(scene, preview);
  } else {
    renderer.setScissorTest(true);
    views(humanCount).forEach((v, i) => {
      const cam = cameras[i];
      cam.update({...riders[i], ...drawPose(riders[i], i)}, track, dt, cameraDistance, cameraShake, globalTime);
      cam.camera.aspect = (w * v.w) / (h * v.h);
      cam.camera.updateProjectionMatrix();
      effects.viewport(v.x * w, (1 - v.y - v.h) * h, v.w * w, v.h * h);
      models.forEach((m, j) => {
        if (j !== i && m.root.position.distanceTo(cam.camera.position) < 3.1) m.root.visible = false;
      });
      renderer.render(scene, cam.camera);
      models.forEach((m, j) => (m.root.visible = riders[j].recovery <= 0 || Math.floor(globalTime * 8) % 2 === 0));
    });
    renderer.setScissorTest(false);
  }
  const sceneDrawCalls = renderer.info.render.calls;
  effects.finish();
  return sceneDrawCalls;
}
