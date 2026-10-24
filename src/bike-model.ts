import * as THREE from 'three';
import {gearMaterials,jerseyGeometry,contactShadow,helmetMaterial,bootMaterial} from './rider-gear';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface BikeAnimationState {
  speed: number;
  steer: number;
  lean: number;
  pitch: number;
  compression: number;
  time: number;
  throttle: number;
  brake?:number;
  powerSlide?:number;slipAngle?:number;
  groundDistance?:number;
  crashAge?:number;crashSide?:number;crashed?:boolean;
}

/** Metres; +Z is forward. The outer root belongs to the vehicle simulation. */
export function createBike(color: number, number: number): {
  root: THREE.Group;
  animate: (state: BikeAnimationState, dt: number) => void;
} {
  const root = new THREE.Group();
  const shadow=typeof document!=='undefined'?contactShadow():null;if(shadow)root.add(shadow);
  root.name = `Motocross rider ${number}`;
  const motion = new THREE.Group();
  root.add(motion);
  const body = new THREE.Group();
  motion.add(body);

  const paint = new THREE.MeshPhysicalMaterial({ color, roughness: .36, metalness: .02,clearcoat:.65,clearcoatRoughness:.3 });
  const gear=typeof document!=='undefined'?gearMaterials(color):null;
  const darkPaint = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(.43), roughness: .65 });
  const tread=new THREE.MeshStandardMaterial({color:0x373638,roughness:.95});
  const rubber = new THREE.MeshStandardMaterial({ color: 0x302c2b, roughness: .95 });
  const black = new THREE.MeshStandardMaterial({ color: 0x202737, roughness: .67, metalness: .22 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xadb9c8, metalness: .78, roughness: .29 });
  const engine = new THREE.MeshStandardMaterial({ color: 0x667282, metalness: .66, roughness: .47 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf1f5fa, roughness: .48 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xe7af43, roughness: .34, metalness: .65 });
  const visor = new THREE.MeshStandardMaterial({ color: 0x233959, metalness: .75, roughness: .16 });

  // Static parts are merged by material, including every tread block and spoke.
  class Batch {
    parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
    add(geometry: THREE.BufferGeometry, material: THREE.Material, pos: number[] = [0, 0, 0], rot: number[] = [0, 0, 0], scale: number[] = [1, 1, 1]) {
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(...pos as [number, number, number]),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot as [number, number, number])),
        new THREE.Vector3(...scale as [number, number, number]),
      );
      const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
      g.applyMatrix4(matrix);
      geometry.dispose();
      const entries = this.parts.get(material) ?? [];
      entries.push(g);
      this.parts.set(material, entries);
    }
    box(material: THREE.Material, size: number[], pos: number[], rot = [0, 0, 0]) {
      this.add(new RoundedBoxGeometry(size[0],size[1],size[2],2,Math.min(...size)*.28), material, pos, rot);
    }
    bar(material: THREE.Material, a: number[], b: number[], radius: number, radiusEnd = radius, sides = 8) {
      const av = new THREE.Vector3(...a as [number, number, number]);
      const bv = new THREE.Vector3(...b as [number, number, number]);
      const difference = bv.clone().sub(av);
      const rotation = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), difference.clone().normalize()));
      this.add(new THREE.CylinderGeometry(radiusEnd, radius, difference.length(), sides), material, av.add(bv).multiplyScalar(.5).toArray(), [rotation.x, rotation.y, rotation.z]);
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
  for (const x of [-.115, .115]) {
    chassis.bar(steel, [x, .52, -.36], [x, 1.03, .36], .032);
    chassis.bar(steel, [x, 1.03, .36], [x, .56, .13], .032);
    chassis.bar(steel, [x, .56, .13], [x, .52, -.36], .028);
    chassis.bar(black, [x, .77, -.04], [x, 1.01, -.59], .026);
    chassis.bar(steel, [x, .62, -.15], [x, .37, -.72], .038);
  }
  chassis.box(steel, [.32, .065, .40], [0, .47, -.04]);
  chassis.add(new THREE.CylinderGeometry(.16, .16, .28, 12), engine, [0, .63, -.10], [0, 0, Math.PI / 2]);
  chassis.add(new THREE.CylinderGeometry(.10, .10, .305, 12), black, [0, .63, -.10], [0, 0, Math.PI / 2]);
  chassis.box(engine, [.23, .22, .20], [0, .79, .06], [-.22, 0, 0]);
  for (let i = 0; i < 5; i++) chassis.box(steel, [.25, .016, .22], [0, .71 + i * .035, .065], [-.22, 0, 0]);
  chassis.bar(gold, [0, .55, -.35], [0, .90, -.15], .045);
  for (let i = 0; i < 7; i++) chassis.add(new THREE.TorusGeometry(.06, .012, 5, 10), gold, [0, .61 + i * .034, -.31 + i * .019], [Math.PI / 2 + .5, 0, 0]);
  // Thick upholstered seat and tapered, raised mudguards.
  chassis.box(black, [.285, .105, .65], [0, 1.00, -.23], [-.06, 0, 0]);
  const rearShape=new THREE.Shape();rearShape.moveTo(-.13,.24);rearShape.lineTo(.13,.24);rearShape.lineTo(.105,-.23);rearShape.quadraticCurveTo(0,-.30,-.105,-.23);rearShape.closePath();
  chassis.add(new THREE.ExtrudeGeometry(rearShape,{depth:.032,bevelEnabled:true,bevelSize:.012,bevelThickness:.01,bevelSegments:2,steps:1}),paint,[0,1.025,-.67],[Math.PI/2-.17,0,0]);
  for(const side of [-1,1])chassis.box(white,[.022,.012,.28],[side*.085,1.047,-.7],[-.17,0,side*.08]);
  for(let i=0;i<9;i++)chassis.box(black,[.29,.012,.014],[0,1.055,-.45+i*.047],[-.06,0,0]);
  const frontShape=new THREE.Shape();frontShape.moveTo(-.11,-.25);frontShape.lineTo(.11,-.25);frontShape.lineTo(.145,.15);frontShape.quadraticCurveTo(.10,.32,0,.33);frontShape.quadraticCurveTo(-.10,.32,-.145,.15);frontShape.closePath();
  chassis.add(new THREE.ExtrudeGeometry(frontShape,{depth:.02,bevelEnabled:true,bevelSize:.008,bevelThickness:.007,bevelSegments:2,steps:1}),paint,[0,.985,.75],[Math.PI/2+.12,0,0]);
  chassis.box(darkPaint,[.045,.013,.38],[0,1.01,.72],[.12,0,0]);
  chassis.box(paint, [.245, .17, .31], [0, .955, .14], [-.23, 0, 0]);
  for (const side of [-1, 1]) {
    const shroud=new THREE.Shape();shroud.moveTo(-.19,-.07);shroud.lineTo(-.12,-.14);shroud.lineTo(.14,-.12);shroud.lineTo(.23,.09);shroud.lineTo(.12,.16);shroud.lineTo(-.12,.12);shroud.closePath();
    chassis.add(new THREE.ExtrudeGeometry(shroud,{depth:.028,bevelEnabled:true,bevelSize:.012,bevelThickness:.009,bevelSegments:2,steps:1}),paint,[side*.16,.86,.13],[0,side*Math.PI/2,side*.1]);
    const sidePanel=new THREE.Shape();sidePanel.moveTo(-.18,.1);sidePanel.lineTo(.13,.11);sidePanel.lineTo(.19,.04);sidePanel.lineTo(.1,-.12);sidePanel.lineTo(-.16,-.08);sidePanel.closePath();
    chassis.add(new THREE.ExtrudeGeometry(sidePanel,{depth:.02,bevelEnabled:true,bevelSize:.009,bevelThickness:.008,bevelSegments:2,steps:1}),white,[side*.16,.85,-.40],[0,side*Math.PI/2,0]);
    chassis.box(darkPaint, [.018, .085, .26], [side * .20, .91, .15], [-.28, 0, 0]);
    chassis.bar(steel, [side * .12, .56, -.19], [side * .28, .56, -.19], .025);
    chassis.box(black, [.15, .04, .09], [side * .24, .55, -.19]);
  }
  // Exhaust header and high-mounted polished silencer.
  chassis.bar(engine, [.12, .78, .13], [.20, .67, .30], .035);
  chassis.bar(engine, [.20, .67, .30], [.20, .56, .17], .035);
  chassis.bar(engine, [.20, .56, .17], [.20, .84, -.40], .035);
  chassis.bar(steel, [.205, .85, -.39], [.205, .95, -.79], .064, .055, 16);
  for(const z of [-.48,-.72])chassis.box(black,[.13,.025,.035],[.205,.88+(Math.abs(z)-.48)*.25,z],[-.24,0,0]);
  chassis.add(new THREE.TorusGeometry(.055,.008,8,20),steel,[.205,.96,-.82],[-.24,0,0]);
  chassis.bar(black, [.205, .947, -.77], [.205, .96, -.83], .04);
  // Chain on the left hand side.
  chassis.bar(black, [-.16, .44, -.70], [-.16, .59, -.13], .012);
  chassis.bar(black, [-.16, .30, -.70], [-.16, .54, -.13], .012);
  chassis.finish(body);

  function makeWheel() {
    const group = new THREE.Group();
    const batch = new Batch();
    batch.add(new THREE.TorusGeometry(.268, .074, 12, 40), rubber, [0, 0, 0], [0, Math.PI / 2, 0]);
    batch.add(new THREE.TorusGeometry(.229, .017, 6, 28), steel, [0, 0, 0], [0, Math.PI / 2, 0]);
    batch.bar(gold, [-.075, 0, 0], [.075, 0, 0], .052, .052, 12);
    batch.add(new THREE.RingGeometry(.048,.11,24),steel,[-.078,0,0],[0,-Math.PI/2,0]);
    batch.add(new THREE.TorusGeometry(.105, .009, 6, 24), steel, [-.079, 0, 0], [0, Math.PI / 2, 0]);
    for(let j=0;j<12;j++){const a=j*Math.PI/6;batch.add(new THREE.CircleGeometry(.009,6),black,[-.080,Math.sin(a)*.084,Math.cos(a)*.084],[0,-Math.PI/2,0]);}
    for (let i = 0; i < 18; i++) {
      const angle = i * Math.PI * 2 / 18;
      const start = angle + .21;
      for (const side of [-1, 1]) batch.bar(steel, [side * .036, Math.cos(start) * .043, Math.sin(start) * .043], [side * .013, Math.cos(angle) * .222, Math.sin(angle) * .222], .006, .006, 4);
    }
    for (let i = 0; i < 28; i++) {
      const angle = i * Math.PI * 2 / 28;
      for (const side of [-1, 0, 1]) batch.box(tread, [.047, .035, .059], [side * .048, Math.cos(angle+(i%2?side:-side)*.055) * .334, Math.sin(angle+(i%2?side:-side)*.055) * .334], [angle, 0, side * .20]);
    }
    batch.finish(group);
    return group;
  }
  const rearWheel = makeWheel();
  rearWheel.position.set(0, .35, -.72);rearWheel.scale.x=1.2;
  motion.add(rearWheel);
  const steering = new THREE.Group();
  steering.position.set(0, .35, .72);
  motion.add(steering);
  const frontWheel = makeWheel();
  steering.add(frontWheel);
  const fork = new THREE.Group();
  steering.add(fork);
  const frontParts = new Batch();
  for (const side of [-1, 1]) {
    frontParts.bar(steel, [side * .105, 0, 0], [side * .105, .39, -.12], .023);
    frontParts.bar(gold, [side * .105, .29, -.09], [side * .105, .70, -.235], .033);
    frontParts.box(white, [.05, .24, .065], [side * .108, .14, -.025], [-.28, 0, 0]);
  }
  frontParts.bar(steel, [-.14, .58, -.195], [.14, .58, -.195], .036);
  frontParts.bar(steel, [-.14, .70, -.235], [.14, .70, -.235], .032);
  frontParts.box(white, [.265, .255, .048], [0, .68, -.167], [-.29, 0, 0]);
  frontParts.bar(steel, [0, .71, -.23], [0, .86, -.24], .027);
  frontParts.bar(steel, [-.18, .85, -.22], [.18, .85, -.22], .02);
  for (const side of [-1, 1]) {
    frontParts.bar(steel, [side * .16, .85, -.22], [side * .28, .87, -.15], .02);
    frontParts.bar(black, [side * .27, .87, -.15], [side * .39, .87, -.15], .027);
    frontParts.bar(steel, [side * .32, .88, -.10], [side * .40, .88, -.075], .01);
  }
  for(const side of [-1,1]){
    const cable=new THREE.CatmullRomCurve3([new THREE.Vector3(side*.3,.87,-.12),new THREE.Vector3(side*.18,.73,.07),new THREE.Vector3(side*.13,.45,-.06),new THREE.Vector3(side*.105,.12,-.02)]);
    frontParts.add(new THREE.TubeGeometry(cable,18,.007,5,false),black);
  }
  frontParts.finish(fork);

  // Bold readable race numbers, generated locally on a shared canvas texture.
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 192;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#f1f5fa'; ctx.fillRect(0, 0, 256, 192);
      ctx.fillStyle = '#172033'; ctx.font = 'italic 900 138px Arial';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(number), 122, 108, 228);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.MeshStandardMaterial({ map: texture, roughness: .58 });
      for (const side of [-1, 1]) {
        const plate = new THREE.Mesh(new THREE.PlaneGeometry(.245, .15), material);
        plate.position.set(side * .194, .85, -.4);
        plate.rotation.set(0, side * Math.PI / 2, 0);
        body.add(plate);
      }
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(.225, .175), material);
      plate.position.set(0, .68, -.136); plate.rotation.x = -.29;
      fork.add(plate);
    }
  }

  const rider = new THREE.Group();
  body.add(rider);
  const torso = new THREE.Group();
  rider.add(torso);
  const jersey = new Batch();
  jersey.add(jerseyGeometry(),gear?.jersey||paint);
  jersey.add(new THREE.SphereGeometry(.15, 16, 12), gear?.dark||black, [0, 1.07, -.14], [0, 0, 0], [1.48, .78, 1]);
  jersey.finish(torso);

  const head = new THREE.Group();
  head.position.set(0, 1.68, .10);
  rider.add(head);
  const helmet = new Batch();
  helmet.bar(black, [0, -.17, -.02], [0, -.08, 0], .062);
  helmet.add(new THREE.SphereGeometry(.175, 40, 28), typeof document!=='undefined'?helmetMaterial(color):paint, [0, .02, 0], [0, 0, 0], [1, 1.16, 1.07]);
  for (const side of [-1, 1]) helmet.box(paint, [.017, .10, .19], [side * .163, .025, -.015], [0, 0, side * .08]);
  helmet.box(black, [.288, .098, .056], [0, .026, .147], [-.08, 0, 0]);
  helmet.box(visor, [.248, .063, .020], [0, .035, .181], [-.08, 0, 0]);
  helmet.box(paint, [.28, .026, .24], [0, .124, .16], [-.12, 0, 0]);
  helmet.box(white, [.21, .076, .15], [0, -.078, .14], [-.30, 0, 0]);
  helmet.box(black, [.125, .026, .026], [0, -.075, .220], [-.30, 0, 0]);
  helmet.add(new THREE.TorusGeometry(.12,.014,8,32),black,[0,-.14,0],[Math.PI/2,0,0],[1,1.05,1]);
  for(const side of [-1,1]){
    helmet.box(black,[.055,.014,.04],[side*.08,.11,-.14],[-.48,0,side*.16]);
    helmet.box(white,[.065,.012,.047],[side*.08,.12,-.14],[-.48,0,side*.16]);
  }
  helmet.finish(head);

  function limb(material: THREE.Material, radiusA: number, radiusB: number) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusB, radiusA, 1, 16,12), material);
    const pos=mesh.geometry.attributes.position;
    for(let i=0;i<pos.count;i++){const y=pos.getY(i),bulge=1+.14*Math.cos(y*5)+.075*Math.sin(y*49+pos.getX(i)*30)*Math.cos(y*3.1);pos.setX(i,pos.getX(i)*bulge);pos.setZ(i,pos.getZ(i)*bulge);}mesh.geometry.computeVertexNormals();
    mesh.castShadow = true;mesh.receiveShadow=true;
    rider.add(mesh);
    return mesh;
  }
  function poseSegment(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) {
    mesh.position.copy(a).add(b).multiplyScalar(.5);
    const delta = b.clone().sub(a);
    mesh.scale.y = delta.length();
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  }
  const arms = [-1, 1].map(side => ({ side, upper: limb(gear?.colored||paint, .093, .078), lower: limb(gear?.white||white, .080, .051), glove: new THREE.Group() }));
  const legs = [-1, 1].map(side => ({ side, thigh: limb(gear?.pants||paint, .134, .105), shin: limb(gear?.dark||darkPaint, .082, .064), boot: new THREE.Group() }));
  for (const arm of arms) {
    const detail = new Batch();
    detail.box(black, [.085, .07, .095], [0, 0, 0]);
    detail.box(paint, [.087, .018, .065], [0, .039, 0]);
    detail.finish(arm.glove); rider.add(arm.glove);
  }
  for (const leg of legs) {
    const detail = new Batch();
    detail.add(new THREE.CapsuleGeometry(.071,.205,6,16),white,[0,.055,0],[-.10,0,0],[1,1,.95]);
    // Calf armor is visible in the chase camera, with relief instead of a blank tube.
    detail.add(new THREE.PlaneGeometry(.125,.26),typeof document!=='undefined'?bootMaterial():white,[0,.07,-.068],[0,Math.PI,0]);
    for(const side of [-1,1])detail.add(new THREE.CylinderGeometry(.027,.027,.014,12),steel,[side*.072,-.025,0],[0,0,Math.PI/2]);
    detail.box(black,[.11,.035,.025],[0,-.065,-.07],[-.1,0,0]);
    detail.box(black,[.04,.16,.012],[0,.06,.061],[-.10,0,0]);
    detail.box(white, [.12, .085, .22], [0, -.057, .039]);
    detail.box(black, [.125, .025, .225], [0, -.1, .039]);
    for(const side of [-1,1]){detail.box(black,[.012,.14,.055],[side*.058,.045,.003],[.12,0,side*.15]);detail.box(white,[.014,.09,.036],[side*.065,.06,.003],[.12,0,side*-.25]);}
    for (let i = 0; i < 3; i++) detail.box(black, [.116, .018, .016], [0, .01 + i * .051, .059]);
    detail.finish(leg.boot); rider.add(leg.boot);
  }

  let wheelAngle = 0,rearWheelAngle=0;
  function animate(state: BikeAnimationState, dt: number) {
    if(shadow){const altitude=Math.max(0,state.groundDistance||0);shadow.position.y=-altitude+.025;shadow.scale.setScalar(1+altitude*.16);shadow.material.opacity=Math.max(.10,.74-altitude*.17);}
    const tumble=state.crashed?1-Math.exp(-(state.crashAge||0)*5):0,crashSide=state.crashSide||1;
    motion.position.y=tumble*.3;
    rider.position.set(crashSide*tumble*.62,tumble*.08,-tumble*.25);
    rider.rotation.set(tumble*-.32,0,crashSide*tumble*.7);
    const slide=state.powerSlide||0;
    const groundBrake=(state.brake||0)*THREE.MathUtils.clamp(state.speed/5,0,1)*(1-THREE.MathUtils.smoothstep(state.groundDistance||0,.05,.3));
    const suspension = THREE.MathUtils.clamp(state.compression, -.2, 1);
    const travel = suspension * .10;
    motion.rotation.z = -state.lean*(1-tumble)+crashSide*tumble*1.42;
    motion.rotation.x = -state.pitch*(1-tumble)-tumble*.14;
    body.position.y = -travel;
    fork.position.y = -travel * .6-groundBrake*.085;
    steering.rotation.y = state.steer*.52*(1-slide)-(state.slipAngle||0)*.9;
    wheelAngle += state.speed * Math.max(0, dt) / .345;
    rearWheelAngle+=(state.speed/.345*(1-groundBrake*slide*.85)+slide*14*(1-groundBrake))*Math.max(0,dt);
    rearWheel.rotation.x = rearWheelAngle;
    frontWheel.rotation.x = wheelAngle;
    const vibration = Math.sin(state.time * 13) * Math.min(Math.abs(state.speed) / 35, 1) * .015;
    // Stand slightly on the pegs in flight and absorb the landing through knees/elbows.
    const airborne=THREE.MathUtils.smoothstep(state.groundDistance||0,.15,1.1);
    const crouch=travel*1.1+Math.max(0,state.throttle)*.025-airborne*.085;
    torso.position.set(state.lean * .12, vibration - crouch, .035 * state.throttle-.045*(state.brake||0)+slide*.14);
    head.position.set(state.lean * .10, 1.65 + vibration - crouch, .18 + .05 * state.throttle-.035*(state.brake||0)+slide*.16);
    head.rotation.set(state.pitch * .3, state.steer * .22, state.lean * .28);
    for (const arm of arms) {
      const side = arm.side;
      const shoulder = new THREE.Vector3(side * .225 + torso.position.x, 1.48 + vibration - crouch, .055);
      const elbow = new THREE.Vector3(side * .44, 1.31 - crouch, .24);
      const hand = new THREE.Vector3(side*(.33+tumble*.28),1.22+travel*.4-tumble*.4,.57-tumble*.4);
      hand.applyAxisAngle(new THREE.Vector3(0, 1, 0), state.steer * .16);
      poseSegment(arm.upper, shoulder, elbow); poseSegment(arm.lower, elbow, hand);
      arm.glove.position.copy(hand);
    }
    for (const leg of legs) {
      const side = leg.side;
      const hip = new THREE.Vector3(side * .17 + torso.position.x, 1.12 + vibration - crouch, -.16);
      const knee = new THREE.Vector3(side * (.27+tumble*.2), .85 - crouch * .3, .14-tumble*.2);
      const ankle = new THREE.Vector3(side * .275, .65, -.18);
      poseSegment(leg.thigh, hip, knee); poseSegment(leg.shin, knee, ankle);
      leg.boot.position.copy(ankle);
      leg.boot.rotation.x = -.12;
    }
  }
  animate({ speed: 0, steer: 0, lean: 0, pitch: 0, compression: 0, time: 0, throttle: 0 }, 0);
  return { root, animate };
}
