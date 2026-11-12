import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {Track} from './track';
import {obstacleLength, obstacleType} from './track-layout';
import {obstacleMarker, surfaceMarker, markerSign, startMarker, disposeMarkers} from './track-markers';
import {dirtMaterial} from './track-material';
export type PreviewSelection = {kind: 'jump' | 'turn'; index: number};
/** A lightweight, on-demand scene sharing the actual race surface and materials. */
function bermLabel(height: number | null | undefined) {
  return height === undefined || height === null ? 'Automatic berm' : height === 0 ? 'Flat turn' : height + ' m berm';
}
export class TrackPreview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(48, 1, 0.1, 6000);
  private controls: OrbitControls;
  private surface: THREE.Mesh;
  private ground: THREE.Mesh;
  private edges = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({color: 0xd7bc89}));
  private highlight = new THREE.Group();
  private start = new THREE.Group();
  private observer: ResizeObserver;
  private frame = 0;
  private disposed = false;
  private track?: Track;
  private selection: PreviewSelection = {kind: 'jump', index: 0};
  private selectedKey = '';
  private whole = false;
  private anchor = new THREE.Vector3();
  private side = false;
  constructor(
    private canvas: HTMLCanvasElement,
    private label: HTMLElement,
  ) {
    this.renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: false, powerPreference: 'low-power'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.scene.background = new THREE.Color('#29384b');
    this.scene.add(new THREE.HemisphereLight(0xd9e8ff, 0x785132, 2.1));
    const sun = new THREE.DirectionalLight(0xffe4b6, 3.2);
    sun.position.set(-90, 180, 80);
    this.scene.add(sun);
    this.surface = new THREE.Mesh(
      new THREE.BufferGeometry(),
      dirtMaterial(false, () => this.requestRender()),
    );
    this.ground = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({color: 0x655b4b, roughness: 1, side: THREE.DoubleSide}),
    );
    this.scene.add(this.ground, this.surface, this.edges, this.highlight, this.start);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = false;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 3000;
    this.controls.addEventListener('change', this.requestRender);
    this.observer = new ResizeObserver(() => this.requestRender());
    this.observer.observe(canvas);
    canvas.addEventListener('webglcontextlost', this.contextLost);
  }
  private contextLost = (event: Event) => {
    event.preventDefault();
    this.label.textContent = '3D preview paused. Close and reopen the editor to restore it.';
  };
  updateTrack(track: Track) {
    if (this.disposed) return;
    this.track = track;
    disposeMarkers(this.start);
    this.start.add(startMarker(track));
    const geometry = track.geometry(1.5, 12);
    this.surface.geometry.dispose();
    this.surface.geometry = geometry;
    const b = track.bounds,
      w = b.maxX - b.minX + 100,
      h = b.maxZ - b.minZ + 100;
    // Base terrain follows the same elevation function as the race, without stadium clutter.
    const ground = new THREE.PlaneGeometry(w, h, 48, 48);
    ground.rotateX(-Math.PI / 2);
    ground.translate((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
    const pos = ground.getAttribute('position');
    for (let i = 0; i < pos.count; i++) pos.setY(i, track.baseHeight(pos.getX(i), pos.getZ(i)) - 0.12);
    ground.computeVertexNormals();
    this.ground.geometry.dispose();
    this.ground.geometry = ground;
    (this.ground.material as THREE.MeshStandardMaterial).color.set(track.course.ground).multiplyScalar(0.65);
    const points: THREE.Vector3[] = [];
    for (let s = 0; s < track.length; s += 3)
      for (const lateral of [-track.halfWidth, track.halfWidth])
        for (const at of [s, Math.min(s + 3, track.length)]) {
          const p = track.at(at, lateral);
          points.push(new THREE.Vector3(p.x, track.height(at, lateral) + 0.06, p.z));
        }
    this.edges.geometry.dispose();
    this.edges.geometry = new THREE.BufferGeometry().setFromPoints(points);
    this.requestRender();
  }
  select(selection: PreviewSelection, valid = true) {
    if (!this.track) return;
    this.selection = selection;
    const obstacle = this.track.obstacles[selection.index];
    const key = `${selection.kind}:${selection.index}:${selection.kind === 'jump' && obstacle ? obstacleType(obstacle) : ''}`,
      changed = key !== this.selectedKey;
    this.selectedKey = key;
    this.clearHighlight();
    const track = this.track,
      jump = selection.kind === 'jump' ? track.obstacles[selection.index] : undefined;
    let target: THREE.Vector3;
    if (jump) {
      const total = obstacleLength(jump),
        mid = jump.start + total / 2,
        p = track.at(mid);
      target = new THREE.Vector3(p.x, track.height(mid) + 0.4, p.z);
      this.highlight.add(obstacleMarker(track, selection.index));
      this.label.textContent =
        `O${selection.index + 1} · ${obstacleType(jump)} · ${jump.height.toFixed(1)} m high · ` +
        `${total.toFixed(1)} m long`;
    } else {
      const point = track.controlPoints[selection.index] || track.controlPoints[0],
        p = track.project(point[0], point[1]);
      target = new THREE.Vector3(point[0], track.height(p.s) + 0.4, point[1]);
      const marker = new THREE.Mesh(
        new THREE.ConeGeometry(1.6, 4, 16),
        new THREE.MeshStandardMaterial({color: 0x64ddff, emissive: 0x164c66, roughness: 0.4}),
      );
      marker.rotation.z = Math.PI;
      marker.position.copy(target).add(new THREE.Vector3(0, 4, 0));
      this.highlight.add(marker);
      if (selection.kind === 'turn') {
        this.highlight.add(surfaceMarker(track, p.s - 12, 24, 0x64ddff));
        const sign = markerSign(`T${selection.index + 1} · TURN`, '#8ce6ff');
        sign.position.copy(target).add(new THREE.Vector3(0, 9, 0));
        this.highlight.add(sign);
      }
      this.label.textContent =
        selection.kind === 'turn'
          ? `T${selection.index + 1} · ${bermLabel(track.bermHeights?.[selection.index])}`
          : 'Live · No jumps placed';
    }
    if (!valid) this.label.textContent = 'Showing last valid shape · fix the highlighted layout issue';
    if (changed) {
      this.whole = false;
      this.focusTarget(target);
    } else if (!this.whole) {
      const shift = target.clone().sub(this.anchor);
      this.controls.target.add(shift);
      this.camera.position.add(shift);
      this.controls.update();
    }
    this.anchor.copy(target);
    this.requestRender();
  }
  focus() {
    if (!this.track) return;
    this.side = false;
    this.whole = false;
    this.focusTarget(this.anchor);
  }
  overview() {
    if (!this.track) return;
    this.whole = true;
    const b = this.track.bounds,
      x = (b.minX + b.maxX) / 2,
      z = (b.minZ + b.maxZ) / 2,
      span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
    this.controls.target.set(x, this.track.baseHeight(x, z), z);
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3(span * 0.65, span * 0.95, span * 0.75));
    this.controls.update();
    this.requestRender();
  }
  sideView() {
    if (!this.track) return;
    this.side = true;
    this.whole = false;
    this.focusTarget(this.anchor);
  }
  zoom(factor: number) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.setLength(THREE.MathUtils.clamp(offset.length() * factor, 8, 3000));
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
    this.requestRender();
  }
  private focusTarget(target: THREE.Vector3) {
    const t = this.track!,
      j = this.selection.kind === 'jump' ? t.obstacles[this.selection.index] : undefined,
      p = t.project(target.x, target.z);
    const distance = j ? Math.max(32, obstacleLength(j) * 1.25) : 85;
    this.controls.target.copy(target);
    this.camera.position
      .copy(target)
      .add(
        new THREE.Vector3(
          p.tz * distance - p.tx * distance * 0.3,
          distance * (this.side ? 0.2 : 0.65),
          -p.tx * distance - p.tz * distance * 0.3,
        ),
      );
    this.controls.update();
    this.requestRender();
  }
  private clearHighlight() {
    disposeMarkers(this.highlight);
  }
  private requestRender = () => {
    if (this.disposed || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.disposed) return;
      const w = this.canvas.clientWidth,
        h = this.canvas.clientHeight;
      if (!w || !h) return;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.render(this.scene, this.camera);
    });
  };
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.controls.dispose();
    this.canvas.removeEventListener('webglcontextlost', this.contextLost);
    this.clearHighlight();
    disposeMarkers(this.start);
    for (const mesh of [this.surface, this.ground, this.edges]) {
      mesh.geometry.dispose();
      const material = mesh.material as THREE.Material;
      const textures = new Set<THREE.Texture>();
      for (const v of Object.values(material)) if (v instanceof THREE.Texture) textures.add(v);
      textures.forEach(t => t.dispose());
      material.dispose();
    }
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
