import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {Track} from './track';
import {addScenery} from './scenery';
import {addStadium} from './stadium';
import {dirtMaterial, barrierTexture} from './track-material';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
export function textTexture(text: string, fg = '#fff5dc', bg = '#232737', w = 1024, h = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext('2d')!;
  c.fillStyle = bg;
  c.fillRect(0, 0, w, h);
  c.fillStyle = fg;
  c.font = `900 italic ${h * 0.53}px Arial`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, w / 2, h * 0.53, w * 0.9);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export function createWorld(track: Track) {
  const b = track.bounds,
    standX = Math.max(Math.abs(b.minX), Math.abs(b.maxX)) + 20,
    centerZ = (b.minZ + b.maxZ) / 2,
    spanZ = b.maxZ - b.minZ + 40;
  const scene = new THREE.Scene();
  const theme = track.course;
  scene.background = new THREE.Color(theme.fog);
  scene.fog = new THREE.FogExp2(theme.fog, 0.0022);
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1200, 32, 20),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {top: {value: new THREE.Color(theme.skyTop)}, horizon: {value: new THREE.Color(theme.skyHorizon)}},
      vertexShader: `varying vec3 v;void main(){v=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `
    varying vec3 v;uniform vec3 top;uniform vec3 horizon;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
    float fbm(vec2 p){return noise(p)*.55+noise(p*2.03)*.26+noise(p*4.07)*.13+noise(p*8.11)*.06;}
    void main(){vec3 d=normalize(v);float h=d.y;vec3 c=mix(horizon,top,smoothstep(-.04,.28,h));
      vec2 p=d.xz/(max(.12,h+.18))*3.;float n=fbm(p*vec2(1.1,2.4));
      float cloud=smoothstep(.42,.69,n)*smoothstep(.015,.12,h)*(1.-smoothstep(.68,.9,h));
      vec3 shadow=mix(top*.65,horizon*.75,(1.-smoothstep(0.,.7,h)));
      vec3 light=mix(horizon*.8,top*1.6,smoothstep(.08,.6,h));
      c=mix(c,mix(shadow,light,smoothstep(.53,.77,n)),cloud*.85);gl_FragColor=vec4(c,1.);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`,
    }),
  );
  scene.add(sky);
  if (theme.id === 'dusk') {
    const panorama = new THREE.TextureLoader().load('/art/dusk-sky-v3.png');
    panorama.colorSpace = THREE.SRGBColorSpace;
    const dome = new THREE.SphereGeometry(1190, 48, 32),
      uv = dome.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, THREE.MathUtils.clamp(0.5 + (uv.getY(i) - 0.5) * 1.9, 0, 1));
    const paintedSky = new THREE.Mesh(
      dome,
      new THREE.MeshBasicMaterial({
        map: panorama,
        color: '#e3e6ff',
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      }),
    );
    scene.add(paintedSky);
    sky.visible = false;
  }
  scene.add(new THREE.HemisphereLight('#b6c4ff', '#7b5135', 1.0));
  const sun = new THREE.DirectionalLight('#ffe0bb', 2.6);
  sun.name = 'race-key-light';
  scene.add(sun.target);
  sun.position.set(-140, 190, -160);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {left: -260, right: 260, top: 260, bottom: -260, near: 1, far: 900});
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.025;
  scene.add(sun);
  const fill = new THREE.DirectionalLight('#b9ceff', 1.2);
  fill.position.set(100, 90, 60);
  scene.add(fill);
  const rim = new THREE.DirectionalLight('#c7d3ff', 0.8);
  rim.position.set(0, 60, -100);
  scene.add(rim);
  const disk = new THREE.Mesh(
    new THREE.SphereGeometry(15, 24, 12),
    new THREE.MeshBasicMaterial({color: '#ffd5a0', fog: false}),
  );
  disk.position.set(-150, 33, -330);
  scene.add(disk);
  const groundMaterial = dirtMaterial(true),
    groundTint = new THREE.Color(theme.id === 'dusk' ? '#a4744e' : theme.ground),
    clayAverage = new THREE.Color('#b57743');
  groundMaterial.color.setRGB(groundTint.r / clayAverage.r, groundTint.g / clayAverage.g, groundTint.b / clayAverage.b);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1800, 1800, 160, 160), groundMaterial);
  ground.geometry.rotateX(-Math.PI / 2);
  const gp = ground.geometry.attributes.position;
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i),
      z = gp.getZ(i);
    let y = track.baseHeight(x, z) - 0.35;
    if (theme.id === 'coast' && x > b.maxX + 15) y -= Math.min(40, (x - b.maxX - 15) * 0.6);
    gp.setY(i, y);
  }
  ground.geometry.computeVertexNormals();
  ground.receiveShadow = true;
  scene.add(ground);
  let seed = theme.seed;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const terrain = new THREE.Mesh(track.geometry(), dirtMaterial());
  terrain.receiveShadow = true;
  scene.add(terrain);
  const mats = {
    navy: new THREE.MeshStandardMaterial({color: '#292e42', roughness: 0.8}),
    metal: new THREE.MeshStandardMaterial({color: '#555e71', metalness: 0.5, roughness: 0.55}),
    light: new THREE.MeshBasicMaterial({color: new THREE.Color(3.4, 3.2, 2.9), toneMapped: false, fog: false}),
    orange: new THREE.MeshStandardMaterial({color: '#ed7444'}),
  };
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  function box(x: number, y: number, z: number, w: number, h: number, d: number, mat: THREE.Material, angle = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.rotateY(angle);
    g.translate(x, y, z);
    if (!batches.has(mat)) batches.set(mat, []);
    batches.get(mat)!.push(g);
  }
  // Safety blocks follow the whole route and visibly mark the rideable edge.
  const barrierGeometry = new RoundedBoxGeometry(0.72, 0.72, 2.7, 3, 0.12);
  const bp = barrierGeometry.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const x = bp.getX(i),
      y = bp.getY(i),
      z = bp.getZ(i),
      wrinkle = Math.sin(z * 12 + y * 9) * Math.sin(y * 15 - z * 3) * 0.004;
    bp.setX(i, x + Math.sign(x) * wrinkle);
    bp.setY(i, y + Math.sin(z * 9 + x * 12) * 0.012);
  }
  const barrierUvs = barrierGeometry.attributes.uv,
    barrierNormals = barrierGeometry.attributes.normal;
  for (let i = 0; i < barrierUvs.count; i++)
    if (Math.abs(barrierNormals.getX(i)) < 0.6) barrierUvs.setXY(i, 0.025, 0.5);
  const barriers = ['#303342', '#375dac', '#d5a62e'].map(
    (color, i) =>
      new THREE.InstancedMesh(
        barrierGeometry,
        new THREE.MeshStandardMaterial({map: barrierTexture(color, i === 0), roughness: 0.72, metalness: 0.02}),
        Math.ceil(track.length / 3.15) * 2,
      ),
  );
  const block = new THREE.Object3D(),
    counts = [0, 0, 0];
  for (let s = 1; s < track.length; s += 3.15)
    for (const side of [-1, 1]) {
      const p = track.at(s, side * (track.halfWidth + 0.52)),
        group = Math.floor(s / 20) % 8 === 0 ? 1 : Math.floor(s / 20) % 11 === 0 ? 2 : 0;
      block.position.set(p.x, track.height(s, p.lateral) + 0.36, p.z);
      block.rotation.set(0, Math.atan2(p.tx, p.tz), 0);
      block.updateMatrix();
      barriers[group].setMatrixAt(counts[group]++, block.matrix);
    }
  barriers.forEach((m, i) => {
    m.count = counts[i];
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  });
  // Starting stripe and eight gate positions.
  const start = track.at(0);
  for (let i = 0; i < 16; i++)
    for (let j = 0; j < 2; j++) {
      const p = track.at(j * 0.45, (i / 16 - 0.5) * track.halfWidth * 2);
      box(
        p.x,
        track.height(p.s, p.lateral) + 0.021,
        p.z,
        track.halfWidth / 8,
        0.015,
        0.45,
        (i + j) % 2 ? mats.navy : mats.light,
        Math.atan2(p.tx, p.tz),
      );
    }
  for (const lateral of [-6.2, 6.2]) {
    const p = track.at(0, lateral);
    box(p.x, track.height(0, lateral) + 3.5, p.z, 0.4, 7, 0.4, mats.metal);
  }
  const arch = new THREE.Mesh(
    new THREE.BoxGeometry(13, 1.35, 0.42),
    new THREE.MeshStandardMaterial({map: textTexture('AFTERGLOW  /  SX', '#fff4db', '#252b3e'), roughness: 0.8}),
  );
  arch.position.set(start.x, track.height(0) + 7, start.z);
  arch.rotation.y = Math.atan2(start.tx, start.tz);
  arch.castShadow = true;
  scene.add(arch);
  addStadium(scene, track);
  // Floodlights with visible trusses and additive halos, without per-lamp shadow maps.
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = 64;
  glowCanvas.height = 64;
  const gc = glowCanvas.getContext('2d')!,
    gradient = gc.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.06, 'rgba(246,244,255,.85)');
  gradient.addColorStop(0.2, 'rgba(213,220,255,.30)');
  gradient.addColorStop(1, 'rgba(255,235,209,0)');
  gc.fillStyle = gradient;
  gc.fillRect(0, 0, 64, 64);
  const glowMap = new THREE.CanvasTexture(glowCanvas);
  const lightPositions: {x: number; z: number; local?: boolean}[] = [-standX + 5, standX - 5].flatMap(x =>
    [b.minZ, centerZ, b.maxZ].map(z => ({x, z})),
  );
  if (theme.id === 'dusk')
    for (const s of [50, 116, 475, 1320])
      for (const side of [-1, 1]) {
        const p = track.at(s, side * 20);
        if (track.project(p.x, p.z).distance > 8) lightPositions.push({...p, local: true});
      }
  for (const {x, z, local} of lightPositions) {
    const base = track.baseHeight(x, z),
      height = local ? 16 : theme.id === 'dusk' ? 24 : 23;
    for (const o of [-0.8, 0.8]) box(x + o, base + height / 2, z, 0.2, height, 0.2, mats.metal);
    for (let y = 1; y < height; y += 2) {
      box(x, base + y, z, 1.8, 0.12, 0.15, mats.metal);
      const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 2.65, 4), mats.metal);
      brace.position.set(x, base + y + 1, z);
      brace.rotation.z = 0.68;
      scene.add(brace);
    }
    box(x, base + height + 0.3, z, 6, 3.4, 0.4, mats.navy);
    for (const face of [-1, 1])
      for (let i = 0; i < 6; i++)
        for (let j = 0; j < 4; j++)
          box(x - 2.25 + i * 0.9, base + height - 0.8 + j * 0.7, z + face * 0.26, 0.6, 0.5, 0.12, mats.light);
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowMap,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        opacity: 0.25,
        color: new THREE.Color(1.2, 1.2, 1.4),
        toneMapped: false,
      }),
    );
    glow.position.set(x, base + height, z);
    glow.scale.set(9, 7, 1);
    const lampCenter = glow.position.clone(),
      toCamera = new THREE.Vector3();
    glow.onBeforeRender = (_renderer, _scene, camera) => {
      camera.getWorldPosition(toCamera);
      glow.position.copy(lampCenter).addScaledVector(toCamera.sub(lampCenter).normalize(), 0.8);
      glow.updateMatrixWorld();
    };
    scene.add(glow);
  }
  if (theme.id === 'dusk') {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#161d35';
    c.fillRect(0, 0, 1024, 512);
    c.fillStyle = '#344d9c';
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(370, 0);
    c.lineTo(700, 512);
    c.lineTo(330, 512);
    c.fill();
    c.fillStyle = '#4e68bd';
    c.beginPath();
    c.moveTo(800, 0);
    c.lineTo(1024, 0);
    c.lineTo(700, 512);
    c.lineTo(470, 512);
    c.fill();
    c.fillStyle = '#f2e9d8';
    c.font = 'italic 900 82px Arial';
    c.textAlign = 'center';
    c.fillText('AFTERGLOW', 512, 234);
    c.font = '600 25px Arial';
    c.fillText('S T A D I U M   S E R I E S', 512, 288);
    c.fillStyle = '#0d112644';
    for (let y = 0; y < 512; y += 4) c.fillRect(0, y, 1024, 1);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const screenMaterial = new THREE.MeshBasicMaterial({map: texture, side: THREE.DoubleSide, toneMapped: false});
    for (const s of [133, 610, 1550])
      for (const side of [-1, 1]) {
        const p = track.at(s, side * 26);
        if (track.project(p.x, p.z).distance < 10) continue;
        const angle = Math.atan2(p.tx, p.tz) + Math.PI / 2,
          base = track.baseHeight(p.x, p.z);
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(16, 8), screenMaterial);
        screen.position.set(p.x, base + 16, p.z);
        screen.rotation.y = angle;
        scene.add(screen);
        for (const offset of [-8.7, 8.7]) {
          const x = p.x + Math.cos(angle) * offset,
            z = p.z - Math.sin(angle) * offset;
          for (const dx of [-0.4, 0.4])
            box(x + Math.cos(angle) * dx, base + 10, z - Math.sin(angle) * dx, 0.14, 20, 0.14, mats.metal, angle);
          for (let y = 1; y < 21; y += 1.5) box(x, base + y, z, 0.9, 0.12, 0.18, mats.metal, angle);
          box(x, base + 20.6, z, 0.35, 0.24, 0.35, mats.light);
        }
        for (const y of [11.8, 20.2]) box(p.x, base + y, p.z, 17.5, 0.24, 0.4, mats.metal, angle);
      }
  }
  // Mountains frame the warm horizon.
  if (theme.id === 'dusk') {
    for (let layer = 0; layer < 2; layer++) {
      const points: number[] = [],
        indices: number[] = [],
        count = 360,
        radius = 510 + layer * 90;
      for (let i = 0; i <= count; i++) {
        const a = (i / count) * Math.PI * 2,
          h =
            36 +
            layer * 13 +
            16 * Math.sin(a * 3 + layer) +
            11 * Math.sin(a * 7 + 2) +
            7 * Math.sin(a * 17) +
            3 * Math.sin(a * 43);
        const x = Math.cos(a) * radius,
          z = Math.sin(a) * radius;
        points.push(x, -4, z, x, h, z);
        if (i < count) {
          const n = i * 2;
          indices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
      g.setIndex(indices);
      scene.add(
        new THREE.Mesh(g, new THREE.MeshBasicMaterial({color: layer ? '#77738f' : '#555777', side: THREE.DoubleSide})),
      );
    }
  }
  for (let i = 0; theme.id !== 'dusk' && i < 30; i++) {
    const angle = (i / 30) * Math.PI * 2,
      r = 520 + rand() * 55,
      h = 35 + rand() * 65;
    const width = 110 + rand() * 90,
      g = new THREE.PlaneGeometry(width, width, 16, 16);
    g.rotateX(-Math.PI / 2);
    const mp = g.attributes.position;
    for (let j = 0; j < mp.count; j++) {
      const x = mp.getX(j),
        z = mp.getZ(j),
        r2 = (x * x + z * z) / (width * width * 0.075);
      mp.setY(j, Math.exp(-r2) * h * (0.8 + 0.22 * Math.sin(x * 0.15 + i) + 0.15 * Math.cos(z * 0.19 - i)));
    }
    g.computeVertexNormals();
    const m = new THREE.Mesh(
      g,
      new THREE.MeshStandardMaterial({
        color:
          theme.id === 'alpine'
            ? i % 2
              ? '#596b7a'
              : '#c6d0d3'
            : theme.id === 'canyon'
              ? i % 2
                ? '#9d6956'
                : '#bc855d'
              : i % 2
                ? '#5f607e'
                : '#72738b',
        flatShading: true,
      }),
    );
    m.position.set(Math.cos(angle) * r, -3, Math.sin(angle) * r);
    scene.add(m);
  }
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(18, 8, 0.8),
    new THREE.MeshStandardMaterial({map: textTexture(theme.name.toUpperCase(), '#f5e7cf', '#37334d', 1024, 512)}),
  );
  board.position.set(0, track.baseHeight(0, b.maxZ + 22) + 12, b.maxZ + 22);
  scene.add(board);
  box(-6, 4, b.maxZ + 22, 0.5, 8, 0.5, mats.metal);
  box(6, 4, b.maxZ + 22, 0.5, 8, 0.5, mats.metal);
  for (const [mat, geometries] of batches) {
    const mesh = new THREE.Mesh(mergeGeometries(geometries), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    geometries.forEach(g => g.dispose());
  }
  addScenery(scene, track, rand);
  return scene;
}

/** Spend shadow resolution around the active riders instead of the entire 2.57 km course. */
export function focusRaceShadows(scene: THREE.Scene, riders: readonly {x: number; y: number; z: number}[]) {
  const sun = scene.getObjectByName('race-key-light') as THREE.DirectionalLight;
  if (!sun || !riders.length) return;
  const center = new THREE.Vector3(),
    min = new THREE.Vector3(Infinity, Infinity, Infinity),
    max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const r of riders) {
    const v = new THREE.Vector3(r.x, r.y, r.z);
    center.add(v);
    min.min(v);
    max.max(v);
  }
  center.multiplyScalar(1 / riders.length);
  const extent = Math.max(34, min.distanceTo(max) * 0.6 + 26),
    texel = (extent * 2) / 2048;
  center.x = Math.round(center.x / texel) * texel;
  center.z = Math.round(center.z / texel) * texel;
  sun.target.position.copy(center);
  sun.position.copy(center).add(new THREE.Vector3(-140, 190, -160));
  Object.assign(sun.shadow.camera, {left: -extent, right: extent, top: extent, bottom: -extent});
  sun.shadow.camera.updateProjectionMatrix();
}
