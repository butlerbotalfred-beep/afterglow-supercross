import * as THREE from 'three';
import {gearMaterials, jerseyGeometry, contactShadow, helmetMaterial, bootMaterial} from './rider-gear';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

export interface BikeAnimationState {
  speed: number;
  steer: number;
  lean: number;
  pitch: number;
  compression: number;
  time: number;
  throttle: number;
  brake?: number;
  powerSlide?: number;
  slipAngle?: number;
  groundDistance?: number;
  crashAge?: number;
  crashSide?: number;
  crashed?: boolean;
}

/** Metres; +Z is forward. The outer root belongs to the vehicle simulation. */
export function createBike(
  color: number,
  number: number,
): {
  root: THREE.Group;
  animate: (state: BikeAnimationState, dt: number) => void;
} {
  const root = new THREE.Group();
  const shadow = typeof document !== 'undefined' ? contactShadow() : null;
  if (shadow) root.add(shadow);
  root.name = `Motocross rider ${number}`;
  const motion = new THREE.Group();
  root.add(motion);
  const body = new THREE.Group();
  motion.add(body);

  const paint = new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.36,
    metalness: 0.02,
    clearcoat: 0.65,
    clearcoatRoughness: 0.3,
  });
  const gear = typeof document !== 'undefined' ? gearMaterials(color) : null;
  const darkPaint = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color).multiplyScalar(0.43),
    roughness: 0.65,
  });
  const tread = new THREE.MeshStandardMaterial({color: 0x373638, roughness: 0.95});
  const rubber = new THREE.MeshStandardMaterial({color: 0x302c2b, roughness: 0.95});
  const black = new THREE.MeshStandardMaterial({color: 0x202737, roughness: 0.67, metalness: 0.22});
  const steel = new THREE.MeshStandardMaterial({color: 0xadb9c8, metalness: 0.78, roughness: 0.29});
  const engine = new THREE.MeshStandardMaterial({color: 0x667282, metalness: 0.66, roughness: 0.47});
  const white = new THREE.MeshStandardMaterial({color: 0xf1f5fa, roughness: 0.48});
  const gold = new THREE.MeshStandardMaterial({color: 0xe7af43, roughness: 0.34, metalness: 0.65});
  const visor = new THREE.MeshStandardMaterial({color: 0x233959, metalness: 0.75, roughness: 0.16});

  // Static parts are merged by material, including every tread block and spoke.
  class Batch {
    parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
    add(
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      pos: number[] = [0, 0, 0],
      rot: number[] = [0, 0, 0],
      scale: number[] = [1, 1, 1],
    ) {
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(...(pos as [number, number, number])),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rot as [number, number, number]))),
        new THREE.Vector3(...(scale as [number, number, number])),
      );
      const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
      g.applyMatrix4(matrix);
      geometry.dispose();
      const entries = this.parts.get(material) ?? [];
      entries.push(g);
      this.parts.set(material, entries);
    }
    box(material: THREE.Material, size: number[], pos: number[], rot = [0, 0, 0]) {
      this.add(new RoundedBoxGeometry(size[0], size[1], size[2], 2, Math.min(...size) * 0.28), material, pos, rot);
    }
    bar(material: THREE.Material, a: number[], b: number[], radius: number, radiusEnd = radius, sides = 8) {
      const av = new THREE.Vector3(...(a as [number, number, number]));
      const bv = new THREE.Vector3(...(b as [number, number, number]));
      const difference = bv.clone().sub(av);
      const rotation = new THREE.Euler().setFromQuaternion(
        new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), difference.clone().normalize()),
      );
      this.add(
        new THREE.CylinderGeometry(radiusEnd, radius, difference.length(), sides),
        material,
        av.add(bv).multiplyScalar(0.5).toArray(),
        [rotation.x, rotation.y, rotation.z],
      );
    }
    finish(parent: THREE.Group) {
      for (const [material, geometries] of this.parts) {
        const merged = mergeGeometries(geometries, false)!;
        const mesh = new THREE.Mesh(merged, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        parent.add(mesh);
        geometries.forEach(g => g.dispose());
      }
    }
  }

  const chassis = new Batch();
  // Frame triangle, aluminum skid plate, swingarm, and a finned single-cylinder.
  for (const x of [-0.115, 0.115]) {
    chassis.bar(steel, [x, 0.52, -0.36], [x, 1.03, 0.36], 0.032);
    chassis.bar(steel, [x, 1.03, 0.36], [x, 0.56, 0.13], 0.032);
    chassis.bar(steel, [x, 0.56, 0.13], [x, 0.52, -0.36], 0.028);
    chassis.bar(black, [x, 0.77, -0.04], [x, 1.01, -0.59], 0.026);
    chassis.bar(steel, [x, 0.62, -0.15], [x, 0.37, -0.72], 0.038);
  }
  chassis.box(steel, [0.32, 0.065, 0.4], [0, 0.47, -0.04]);
  chassis.add(new THREE.CylinderGeometry(0.16, 0.16, 0.28, 12), engine, [0, 0.63, -0.1], [0, 0, Math.PI / 2]);
  chassis.add(new THREE.CylinderGeometry(0.1, 0.1, 0.305, 12), black, [0, 0.63, -0.1], [0, 0, Math.PI / 2]);
  chassis.box(engine, [0.23, 0.22, 0.2], [0, 0.79, 0.06], [-0.22, 0, 0]);
  for (let i = 0; i < 5; i++) chassis.box(steel, [0.25, 0.016, 0.22], [0, 0.71 + i * 0.035, 0.065], [-0.22, 0, 0]);
  chassis.bar(gold, [0, 0.55, -0.35], [0, 0.9, -0.15], 0.045);
  for (let i = 0; i < 7; i++)
    chassis.add(
      new THREE.TorusGeometry(0.06, 0.012, 5, 10),
      gold,
      [0, 0.61 + i * 0.034, -0.31 + i * 0.019],
      [Math.PI / 2 + 0.5, 0, 0],
    );
  // Thick upholstered seat and tapered, raised mudguards.
  chassis.box(black, [0.285, 0.105, 0.65], [0, 1.0, -0.23], [-0.06, 0, 0]);
  const rearShape = new THREE.Shape();
  rearShape.moveTo(-0.13, 0.24);
  rearShape.lineTo(0.13, 0.24);
  rearShape.lineTo(0.105, -0.23);
  rearShape.quadraticCurveTo(0, -0.3, -0.105, -0.23);
  rearShape.closePath();
  chassis.add(
    new THREE.ExtrudeGeometry(rearShape, {
      depth: 0.032,
      bevelEnabled: true,
      bevelSize: 0.012,
      bevelThickness: 0.01,
      bevelSegments: 2,
      steps: 1,
    }),
    paint,
    [0, 1.025, -0.67],
    [Math.PI / 2 - 0.17, 0, 0],
  );
  for (const side of [-1, 1])
    chassis.box(white, [0.022, 0.012, 0.28], [side * 0.085, 1.047, -0.7], [-0.17, 0, side * 0.08]);
  for (let i = 0; i < 9; i++) chassis.box(black, [0.29, 0.012, 0.014], [0, 1.055, -0.45 + i * 0.047], [-0.06, 0, 0]);
  const frontShape = new THREE.Shape();
  frontShape.moveTo(-0.11, -0.25);
  frontShape.lineTo(0.11, -0.25);
  frontShape.lineTo(0.145, 0.15);
  frontShape.quadraticCurveTo(0.1, 0.32, 0, 0.33);
  frontShape.quadraticCurveTo(-0.1, 0.32, -0.145, 0.15);
  frontShape.closePath();
  chassis.add(
    new THREE.ExtrudeGeometry(frontShape, {
      depth: 0.02,
      bevelEnabled: true,
      bevelSize: 0.008,
      bevelThickness: 0.007,
      bevelSegments: 2,
      steps: 1,
    }),
    paint,
    [0, 0.985, 0.75],
    [Math.PI / 2 + 0.12, 0, 0],
  );
  chassis.box(darkPaint, [0.045, 0.013, 0.38], [0, 1.01, 0.72], [0.12, 0, 0]);
  chassis.box(paint, [0.245, 0.17, 0.31], [0, 0.955, 0.14], [-0.23, 0, 0]);
  for (const side of [-1, 1]) {
    const shroud = new THREE.Shape();
    shroud.moveTo(-0.19, -0.07);
    shroud.lineTo(-0.12, -0.14);
    shroud.lineTo(0.14, -0.12);
    shroud.lineTo(0.23, 0.09);
    shroud.lineTo(0.12, 0.16);
    shroud.lineTo(-0.12, 0.12);
    shroud.closePath();
    chassis.add(
      new THREE.ExtrudeGeometry(shroud, {
        depth: 0.028,
        bevelEnabled: true,
        bevelSize: 0.012,
        bevelThickness: 0.009,
        bevelSegments: 2,
        steps: 1,
      }),
      paint,
      [side * 0.16, 0.86, 0.13],
      [0, (side * Math.PI) / 2, side * 0.1],
    );
    const sidePanel = new THREE.Shape();
    sidePanel.moveTo(-0.18, 0.1);
    sidePanel.lineTo(0.13, 0.11);
    sidePanel.lineTo(0.19, 0.04);
    sidePanel.lineTo(0.1, -0.12);
    sidePanel.lineTo(-0.16, -0.08);
    sidePanel.closePath();
    chassis.add(
      new THREE.ExtrudeGeometry(sidePanel, {
        depth: 0.02,
        bevelEnabled: true,
        bevelSize: 0.009,
        bevelThickness: 0.008,
        bevelSegments: 2,
        steps: 1,
      }),
      white,
      [side * 0.16, 0.85, -0.4],
      [0, (side * Math.PI) / 2, 0],
    );
    chassis.box(darkPaint, [0.018, 0.085, 0.26], [side * 0.2, 0.91, 0.15], [-0.28, 0, 0]);
    chassis.bar(steel, [side * 0.12, 0.56, -0.19], [side * 0.28, 0.56, -0.19], 0.025);
    chassis.box(black, [0.15, 0.04, 0.09], [side * 0.24, 0.55, -0.19]);
  }
  // Exhaust header and high-mounted polished silencer.
  chassis.bar(engine, [0.12, 0.78, 0.13], [0.2, 0.67, 0.3], 0.035);
  chassis.bar(engine, [0.2, 0.67, 0.3], [0.2, 0.56, 0.17], 0.035);
  chassis.bar(engine, [0.2, 0.56, 0.17], [0.2, 0.84, -0.4], 0.035);
  chassis.bar(steel, [0.205, 0.85, -0.39], [0.205, 0.95, -0.79], 0.064, 0.055, 16);
  for (const z of [-0.48, -0.72])
    chassis.box(black, [0.13, 0.025, 0.035], [0.205, 0.88 + (Math.abs(z) - 0.48) * 0.25, z], [-0.24, 0, 0]);
  chassis.add(new THREE.TorusGeometry(0.055, 0.008, 8, 20), steel, [0.205, 0.96, -0.82], [-0.24, 0, 0]);
  chassis.bar(black, [0.205, 0.947, -0.77], [0.205, 0.96, -0.83], 0.04);
  // Chain on the left hand side.
  chassis.bar(black, [-0.16, 0.44, -0.7], [-0.16, 0.59, -0.13], 0.012);
  chassis.bar(black, [-0.16, 0.3, -0.7], [-0.16, 0.54, -0.13], 0.012);
  chassis.finish(body);

  function makeWheel() {
    const group = new THREE.Group();
    const batch = new Batch();
    batch.add(new THREE.TorusGeometry(0.268, 0.074, 12, 40), rubber, [0, 0, 0], [0, Math.PI / 2, 0]);
    batch.add(new THREE.TorusGeometry(0.229, 0.017, 6, 28), steel, [0, 0, 0], [0, Math.PI / 2, 0]);
    batch.bar(gold, [-0.075, 0, 0], [0.075, 0, 0], 0.052, 0.052, 12);
    batch.add(new THREE.RingGeometry(0.048, 0.11, 24), steel, [-0.078, 0, 0], [0, -Math.PI / 2, 0]);
    batch.add(new THREE.TorusGeometry(0.105, 0.009, 6, 24), steel, [-0.079, 0, 0], [0, Math.PI / 2, 0]);
    for (let j = 0; j < 12; j++) {
      const a = (j * Math.PI) / 6;
      batch.add(
        new THREE.CircleGeometry(0.009, 6),
        black,
        [-0.08, Math.sin(a) * 0.084, Math.cos(a) * 0.084],
        [0, -Math.PI / 2, 0],
      );
    }
    for (let i = 0; i < 18; i++) {
      const angle = (i * Math.PI * 2) / 18;
      const start = angle + 0.21;
      for (const side of [-1, 1])
        batch.bar(
          steel,
          [side * 0.036, Math.cos(start) * 0.043, Math.sin(start) * 0.043],
          [side * 0.013, Math.cos(angle) * 0.222, Math.sin(angle) * 0.222],
          0.006,
          0.006,
          4,
        );
    }
    for (let i = 0; i < 28; i++) {
      const angle = (i * Math.PI * 2) / 28;
      for (const side of [-1, 0, 1])
        batch.box(
          tread,
          [0.047, 0.035, 0.059],
          [
            side * 0.048,
            Math.cos(angle + (i % 2 ? side : -side) * 0.055) * 0.334,
            Math.sin(angle + (i % 2 ? side : -side) * 0.055) * 0.334,
          ],
          [angle, 0, side * 0.2],
        );
    }
    batch.finish(group);
    return group;
  }
  const rearWheel = makeWheel();
  rearWheel.position.set(0, 0.35, -0.72);
  rearWheel.scale.x = 1.2;
  motion.add(rearWheel);
  const steering = new THREE.Group();
  steering.position.set(0, 0.35, 0.72);
  motion.add(steering);
  const frontWheel = makeWheel();
  steering.add(frontWheel);
  const fork = new THREE.Group();
  steering.add(fork);
  const frontParts = new Batch();
  for (const side of [-1, 1]) {
    frontParts.bar(steel, [side * 0.105, 0, 0], [side * 0.105, 0.39, -0.12], 0.023);
    frontParts.bar(gold, [side * 0.105, 0.29, -0.09], [side * 0.105, 0.7, -0.235], 0.033);
    frontParts.box(white, [0.05, 0.24, 0.065], [side * 0.108, 0.14, -0.025], [-0.28, 0, 0]);
  }
  frontParts.bar(steel, [-0.14, 0.58, -0.195], [0.14, 0.58, -0.195], 0.036);
  frontParts.bar(steel, [-0.14, 0.7, -0.235], [0.14, 0.7, -0.235], 0.032);
  frontParts.box(white, [0.265, 0.255, 0.048], [0, 0.68, -0.167], [-0.29, 0, 0]);
  frontParts.bar(steel, [0, 0.71, -0.23], [0, 0.86, -0.24], 0.027);
  frontParts.bar(steel, [-0.18, 0.85, -0.22], [0.18, 0.85, -0.22], 0.02);
  for (const side of [-1, 1]) {
    frontParts.bar(steel, [side * 0.16, 0.85, -0.22], [side * 0.28, 0.87, -0.15], 0.02);
    frontParts.bar(black, [side * 0.27, 0.87, -0.15], [side * 0.39, 0.87, -0.15], 0.027);
    frontParts.bar(steel, [side * 0.32, 0.88, -0.1], [side * 0.4, 0.88, -0.075], 0.01);
  }
  for (const side of [-1, 1]) {
    const cable = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.3, 0.87, -0.12),
      new THREE.Vector3(side * 0.18, 0.73, 0.07),
      new THREE.Vector3(side * 0.13, 0.45, -0.06),
      new THREE.Vector3(side * 0.105, 0.12, -0.02),
    ]);
    frontParts.add(new THREE.TubeGeometry(cable, 18, 0.007, 5, false), black);
  }
  frontParts.finish(fork);

  // Bold readable race numbers, generated locally on a shared canvas texture.
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 192;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#f1f5fa';
      ctx.fillRect(0, 0, 256, 192);
      ctx.fillStyle = '#172033';
      ctx.font = 'italic 900 138px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(number), 122, 108, 228);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.MeshStandardMaterial({map: texture, roughness: 0.58});
      for (const side of [-1, 1]) {
        const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.245, 0.15), material);
        plate.position.set(side * 0.194, 0.85, -0.4);
        plate.rotation.set(0, (side * Math.PI) / 2, 0);
        body.add(plate);
      }
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.225, 0.175), material);
      plate.position.set(0, 0.68, -0.136);
      plate.rotation.x = -0.29;
      fork.add(plate);
    }
  }

  const rider = new THREE.Group();
  body.add(rider);
  const torso = new THREE.Group();
  rider.add(torso);
  const jersey = new Batch();
  jersey.add(jerseyGeometry(), gear?.jersey || paint);
  jersey.add(new THREE.SphereGeometry(0.15, 16, 12), gear?.dark || black, [0, 1.07, -0.14], [0, 0, 0], [1.48, 0.78, 1]);
  jersey.finish(torso);

  const head = new THREE.Group();
  head.position.set(0, 1.68, 0.1);
  rider.add(head);
  const helmet = new Batch();
  helmet.bar(black, [0, -0.17, -0.02], [0, -0.08, 0], 0.062);
  helmet.add(
    new THREE.SphereGeometry(0.175, 40, 28),
    typeof document !== 'undefined' ? helmetMaterial(color) : paint,
    [0, 0.02, 0],
    [0, 0, 0],
    [1, 1.16, 1.07],
  );
  for (const side of [-1, 1]) helmet.box(paint, [0.017, 0.1, 0.19], [side * 0.163, 0.025, -0.015], [0, 0, side * 0.08]);
  helmet.box(black, [0.288, 0.098, 0.056], [0, 0.026, 0.147], [-0.08, 0, 0]);
  helmet.box(visor, [0.248, 0.063, 0.02], [0, 0.035, 0.181], [-0.08, 0, 0]);
  helmet.box(paint, [0.28, 0.026, 0.24], [0, 0.124, 0.16], [-0.12, 0, 0]);
  helmet.box(white, [0.21, 0.076, 0.15], [0, -0.078, 0.14], [-0.3, 0, 0]);
  helmet.box(black, [0.125, 0.026, 0.026], [0, -0.075, 0.22], [-0.3, 0, 0]);
  helmet.add(new THREE.TorusGeometry(0.12, 0.014, 8, 32), black, [0, -0.14, 0], [Math.PI / 2, 0, 0], [1, 1.05, 1]);
  for (const side of [-1, 1]) {
    helmet.box(black, [0.055, 0.014, 0.04], [side * 0.08, 0.11, -0.14], [-0.48, 0, side * 0.16]);
    helmet.box(white, [0.065, 0.012, 0.047], [side * 0.08, 0.12, -0.14], [-0.48, 0, side * 0.16]);
  }
  helmet.finish(head);

  function limb(material: THREE.Material, radiusA: number, radiusB: number) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusB, radiusA, 1, 16, 12), material);
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i),
        bulge = 1 + 0.14 * Math.cos(y * 5) + 0.075 * Math.sin(y * 49 + pos.getX(i) * 30) * Math.cos(y * 3.1);
      pos.setX(i, pos.getX(i) * bulge);
      pos.setZ(i, pos.getZ(i) * bulge);
    }
    mesh.geometry.computeVertexNormals();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    rider.add(mesh);
    return mesh;
  }
  function poseSegment(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) {
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    const delta = b.clone().sub(a);
    mesh.scale.y = delta.length();
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  }
  const arms = [-1, 1].map(side => ({
    side,
    upper: limb(gear?.colored || paint, 0.093, 0.078),
    lower: limb(gear?.white || white, 0.08, 0.051),
    glove: new THREE.Group(),
  }));
  const legs = [-1, 1].map(side => ({
    side,
    thigh: limb(gear?.pants || paint, 0.134, 0.105),
    shin: limb(gear?.dark || darkPaint, 0.082, 0.064),
    boot: new THREE.Group(),
  }));
  for (const arm of arms) {
    const detail = new Batch();
    detail.box(black, [0.085, 0.07, 0.095], [0, 0, 0]);
    detail.box(paint, [0.087, 0.018, 0.065], [0, 0.039, 0]);
    detail.finish(arm.glove);
    rider.add(arm.glove);
  }
  for (const leg of legs) {
    const detail = new Batch();
    detail.add(new THREE.CapsuleGeometry(0.071, 0.205, 6, 16), white, [0, 0.055, 0], [-0.1, 0, 0], [1, 1, 0.95]);
    // Calf armor is visible in the chase camera, with relief instead of a blank tube.
    detail.add(
      new THREE.PlaneGeometry(0.125, 0.26),
      typeof document !== 'undefined' ? bootMaterial() : white,
      [0, 0.07, -0.068],
      [0, Math.PI, 0],
    );
    for (const side of [-1, 1])
      detail.add(
        new THREE.CylinderGeometry(0.027, 0.027, 0.014, 12),
        steel,
        [side * 0.072, -0.025, 0],
        [0, 0, Math.PI / 2],
      );
    detail.box(black, [0.11, 0.035, 0.025], [0, -0.065, -0.07], [-0.1, 0, 0]);
    detail.box(black, [0.04, 0.16, 0.012], [0, 0.06, 0.061], [-0.1, 0, 0]);
    detail.box(white, [0.12, 0.085, 0.22], [0, -0.057, 0.039]);
    detail.box(black, [0.125, 0.025, 0.225], [0, -0.1, 0.039]);
    for (const side of [-1, 1]) {
      detail.box(black, [0.012, 0.14, 0.055], [side * 0.058, 0.045, 0.003], [0.12, 0, side * 0.15]);
      detail.box(white, [0.014, 0.09, 0.036], [side * 0.065, 0.06, 0.003], [0.12, 0, side * -0.25]);
    }
    for (let i = 0; i < 3; i++) detail.box(black, [0.116, 0.018, 0.016], [0, 0.01 + i * 0.051, 0.059]);
    detail.finish(leg.boot);
    rider.add(leg.boot);
  }

  let wheelAngle = 0,
    rearWheelAngle = 0;
  function animate(state: BikeAnimationState, dt: number) {
    if (shadow) {
      const altitude = Math.max(0, state.groundDistance || 0);
      shadow.position.y = -altitude + 0.025;
      shadow.scale.setScalar(1 + altitude * 0.16);
      shadow.material.opacity = Math.max(0.1, 0.74 - altitude * 0.17);
    }
    const tumble = state.crashed ? 1 - Math.exp(-(state.crashAge || 0) * 5) : 0,
      crashSide = state.crashSide || 1;
    motion.position.y = tumble * 0.3;
    rider.position.set(crashSide * tumble * 0.62, tumble * 0.08, -tumble * 0.25);
    rider.rotation.set(tumble * -0.32, 0, crashSide * tumble * 0.7);
    const slide = state.powerSlide || 0;
    const groundBrake =
      (state.brake || 0) *
      THREE.MathUtils.clamp(state.speed / 5, 0, 1) *
      (1 - THREE.MathUtils.smoothstep(state.groundDistance || 0, 0.05, 0.3));
    const suspension = THREE.MathUtils.clamp(state.compression, -0.2, 1);
    const travel = suspension * 0.1;
    motion.rotation.z = -state.lean * (1 - tumble) + crashSide * tumble * 1.42;
    motion.rotation.x = -state.pitch * (1 - tumble) - tumble * 0.14;
    body.position.y = -travel;
    fork.position.y = -travel * 0.6 - groundBrake * 0.085;
    steering.rotation.y = state.steer * 0.52 * (1 - slide) - (state.slipAngle || 0) * 0.9;
    wheelAngle += (state.speed * Math.max(0, dt)) / 0.345;
    rearWheelAngle +=
      ((state.speed / 0.345) * (1 - groundBrake * slide * 0.85) + slide * 14 * (1 - groundBrake)) * Math.max(0, dt);
    rearWheel.rotation.x = rearWheelAngle;
    frontWheel.rotation.x = wheelAngle;
    const vibration = Math.sin(state.time * 13) * Math.min(Math.abs(state.speed) / 35, 1) * 0.015;
    // Stand slightly on the pegs in flight and absorb the landing through knees/elbows.
    const airborne = THREE.MathUtils.smoothstep(state.groundDistance || 0, 0.15, 1.1);
    const crouch = travel * 1.1 + Math.max(0, state.throttle) * 0.025 - airborne * 0.085;
    torso.position.set(
      state.lean * 0.12,
      vibration - crouch,
      0.035 * state.throttle - 0.045 * (state.brake || 0) + slide * 0.14,
    );
    head.position.set(
      state.lean * 0.1,
      1.65 + vibration - crouch,
      0.18 + 0.05 * state.throttle - 0.035 * (state.brake || 0) + slide * 0.16,
    );
    head.rotation.set(state.pitch * 0.3, state.steer * 0.22, state.lean * 0.28);
    for (const arm of arms) {
      const side = arm.side;
      const shoulder = new THREE.Vector3(side * 0.225 + torso.position.x, 1.48 + vibration - crouch, 0.055);
      const elbow = new THREE.Vector3(side * 0.44, 1.31 - crouch, 0.24);
      const hand = new THREE.Vector3(
        side * (0.33 + tumble * 0.28),
        1.22 + travel * 0.4 - tumble * 0.4,
        0.57 - tumble * 0.4,
      );
      hand.applyAxisAngle(new THREE.Vector3(0, 1, 0), state.steer * 0.16);
      poseSegment(arm.upper, shoulder, elbow);
      poseSegment(arm.lower, elbow, hand);
      arm.glove.position.copy(hand);
    }
    for (const leg of legs) {
      const side = leg.side;
      const hip = new THREE.Vector3(side * 0.17 + torso.position.x, 1.12 + vibration - crouch, -0.16);
      const knee = new THREE.Vector3(side * (0.27 + tumble * 0.2), 0.85 - crouch * 0.3, 0.14 - tumble * 0.2);
      const ankle = new THREE.Vector3(side * 0.275, 0.65, -0.18);
      poseSegment(leg.thigh, hip, knee);
      poseSegment(leg.shin, knee, ankle);
      leg.boot.position.copy(ankle);
      leg.boot.rotation.x = -0.12;
    }
  }
  animate({speed: 0, steer: 0, lean: 0, pitch: 0, compression: 0, time: 0, throttle: 0}, 0);
  return {root, animate};
}
