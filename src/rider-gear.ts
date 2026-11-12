import * as THREE from 'three';
let fabricHeight: THREE.Texture | undefined;
/** Sculpted elliptical torso with fabric folds; UV design wraps around the back instead of floating plates. */
export function jerseyGeometry() {
  const vertices: number[] = [],
    uvs: number[] = [],
    indices: number[] = [],
    sides = 48,
    rows = 24;
  for (let j = 0; j <= rows; j++) {
    const t = j / rows,
      y = 1.13 + t * 0.46,
      width = 0.17 + Math.sin(t * Math.PI * 0.75) * 0.075,
      depth = 0.116 + Math.sin(t * Math.PI) * 0.034;
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2,
        fold = Math.sin(t * 23 + Math.cos(a * 3) * 2) * 0.014 * Math.pow(1 - t, 0.6) + Math.sin(a * 11 + t * 6) * 0.005;
      vertices.push(
        Math.sin(a) * (width + fold),
        y + Math.cos(a * 2) * 0.008,
        Math.cos(a) * (depth + fold) - 0.16 + t * 0.27,
      );
      uvs.push(i / sides, t);
      if (j < rows && i < sides) {
        const n = j * (sides + 1) + i;
        indices.push(n, n + 1, n + sides + 1, n + 1, n + sides + 2, n + sides + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}
export function gearMaterials(color: number) {
  if (!fabricHeight) {
    fabricHeight = new THREE.TextureLoader().load('/art/jersey-height-v1.png');
    fabricHeight.wrapS = fabricHeight.wrapT = THREE.RepeatWrapping;
    fabricHeight.anisotropy = 8;
    fabricHeight.userData.persistent = true;
  }
  const weave = fabricHeight;
  const colored = new THREE.MeshStandardMaterial({color, roughness: 0.93, bumpMap: weave, bumpScale: 0.035});
  const white = new THREE.MeshStandardMaterial({color: '#eee9e2', roughness: 0.9, bumpMap: weave, bumpScale: 0.032});
  const dark = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color).multiplyScalar(0.36),
    roughness: 0.95,
    bumpMap: weave,
    bumpScale: 0.035,
  });
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#' + color.toString(16).padStart(6, '0');
  c.fillRect(0, 0, 1024, 512);
  const polygon = (fill: string, points: number[][]) => {
    c.fillStyle = fill;
    c.beginPath();
    points.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
    c.fill();
  };
  polygon('#f1ede5', [
    [335, 18],
    [685, 18],
    [650, 180],
    [685, 390],
    [580, 442],
    [440, 442],
    [335, 390],
    [374, 180],
  ]);
  polygon('#' + color.toString(16).padStart(6, '0'), [
    [395, 26],
    [512, 145],
    [630, 26],
    [574, 18],
    [512, 72],
    [451, 18],
  ]);
  polygon('#272b36', [
    [280, 0],
    [335, 0],
    [378, 175],
    [337, 240],
    [320, 375],
    [281, 405],
  ]);
  polygon('#272b36', [
    [744, 0],
    [689, 0],
    [647, 175],
    [687, 240],
    [704, 375],
    [744, 405],
  ]);
  c.fillStyle = '#272b36';
  c.fillRect(0, 472, 1024, 40);
  c.fillStyle = '#ece8dd';
  c.font = 'italic 900 22px Arial';
  c.textAlign = 'center';
  c.fillText('AFTERGLOW', 512, 495);
  // Stitching and lower-back creases are subtle enough to remain material detail.
  for (let i = 0; i < 8; i++) {
    const y = 185 + i * 30,
      x = 330 + (i % 3) * 33,
      len = 115 + (i % 4) * 42;
    const shade = c.createLinearGradient(x, y - 9, x, y + 12);
    shade.addColorStop(0, '#ffffff00');
    shade.addColorStop(0.4, '#ffffff15');
    shade.addColorStop(0.53, '#161d3518');
    shade.addColorStop(1, '#161d3500');
    c.strokeStyle = shade;
    c.lineWidth = 16;
    c.beginPath();
    c.moveTo(x, y);
    c.bezierCurveTo(x + len * 0.3, y + 11, x + len * 0.6, y - 7, x + len, y + (i % 2 ? 14 : -12));
    c.stroke();
  }
  c.strokeStyle = '#ffffff70';
  c.lineWidth = 2;
  c.setLineDash([3, 3]);
  for (const x of [352, 672]) {
    c.beginPath();
    c.moveTo(x, 50);
    c.quadraticCurveTo(x + (x < 512 ? 16 : -16), 240, x, 397);
    c.stroke();
  }
  c.setLineDash([]);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const jersey = new THREE.MeshStandardMaterial({
    map: texture,
    bumpMap: weave,
    bumpScale: 0.055,
    roughness: 0.93,
    side: THREE.DoubleSide,
  });
  const pantsCanvas = document.createElement('canvas');
  pantsCanvas.width = 512;
  pantsCanvas.height = 512;
  const pc = pantsCanvas.getContext('2d')!;
  pc.fillStyle = '#' + color.toString(16).padStart(6, '0');
  pc.fillRect(0, 0, 512, 512);
  pc.fillStyle = '#282c37';
  pc.beginPath();
  pc.moveTo(155, 0);
  pc.lineTo(357, 0);
  pc.lineTo(335, 255);
  pc.lineTo(290, 455);
  pc.lineTo(222, 455);
  pc.lineTo(177, 255);
  pc.closePath();
  pc.fill();
  pc.fillStyle = '#eee9df';
  for (const x of [35, 415]) {
    pc.beginPath();
    pc.moveTo(x, 20);
    pc.lineTo(x + 62, 20);
    pc.lineTo(x + 38, 190);
    pc.lineTo(x + 60, 280);
    pc.lineTo(x + 16, 380);
    pc.lineTo(x + 6, 240);
    pc.closePath();
    pc.fill();
  }
  pc.strokeStyle = '#ffffff66';
  pc.lineWidth = 3;
  pc.setLineDash([4, 3]);
  pc.strokeRect(8, 12, 496, 488);
  pc.setLineDash([]);
  pc.fillStyle = '#282c37';
  for (let y = 380; y < 470; y += 15) pc.fillRect(125, y, 262, 4);
  const pantsMap = new THREE.CanvasTexture(pantsCanvas);
  pantsMap.colorSpace = THREE.SRGBColorSpace;
  pantsMap.anisotropy = 8;
  const pants = new THREE.MeshStandardMaterial({map: pantsMap, bumpMap: weave, bumpScale: 0.022, roughness: 0.9});
  return {colored, white, dark, jersey, pants};
}
export function contactShadow() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const c = canvas.getContext('2d')!;
  const g = c.createRadialGradient(64, 128, 4, 64, 128, 115);
  g.addColorStop(0, '#090c1888');
  g.addColorStop(0.45, '#090c1844');
  g.addColorStop(1, '#090c1800');
  c.fillStyle = g;
  c.fillRect(0, 0, 128, 256);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 2.9), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 1;
  return mesh;
}

export function helmetMaterial(color: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#' + color.toString(16).padStart(6, '0');
  c.fillRect(0, 0, 1024, 512);
  for (const [offset, width, paint] of [
    [0, 60, '#242838'],
    [8, 37, '#f2f0e6'],
  ] as const) {
    c.strokeStyle = paint;
    c.lineWidth = width;
    c.beginPath();
    for (let x = 0; x <= 1024; x += 8) {
      const y = 185 + Math.sin((x / 1024) * Math.PI * 4) * 22 + offset;
      x ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    c.stroke();
  }
  c.fillStyle = '#252838';
  c.fillRect(0, 365, 1024, 55);
  c.fillStyle = '#f2f0e6';
  c.fillRect(0, 358, 1024, 7);
  c.font = 'italic 900 29px Arial';
  c.textAlign = 'center';
  c.fillText('AFTERGLOW', 765, 308);
  c.fillStyle = '#f3eee5';
  for (const x of [669, 846]) {
    c.beginPath();
    c.moveTo(x, 130);
    c.lineTo(x + 21, 133);
    c.lineTo(x + 46, 339);
    c.lineTo(x + 12, 330);
    c.closePath();
    c.fill();
  }
  c.strokeStyle = '#242838';
  c.lineWidth = 12;
  c.beginPath();
  c.moveTo(720, 335);
  c.quadraticCurveTo(765, 351, 810, 335);
  c.stroke();
  // Rear ventilation and a fine contrasting crown stripe are printed onto the curved shell.
  for (const x of [710, 750, 790, 830]) {
    c.fillStyle = '#252838';
    c.fillRect(x, 240, 20, 18);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return new THREE.MeshPhysicalMaterial({
    map: texture,
    roughness: 0.3,
    metalness: 0.02,
    clearcoat: 0.85,
    clearcoatRoughness: 0.22,
  });
}

/** Molded protection with calf vents, stitched panels and articulated ankle hardware. */
export function bootMaterial() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#e6e4de';
  c.fillRect(0, 0, 256, 512);
  c.fillStyle = '#242a36';
  c.beginPath();
  c.moveTo(35, 15);
  c.lineTo(110, 85);
  c.lineTo(80, 230);
  c.lineTo(28, 170);
  c.closePath();
  c.fill();
  c.beginPath();
  c.moveTo(221, 15);
  c.lineTo(146, 85);
  c.lineTo(176, 230);
  c.lineTo(228, 170);
  c.closePath();
  c.fill();
  for (let y = 280; y < 440; y += 52) {
    c.fillStyle = '#444b55';
    c.beginPath();
    c.moveTo(28, y);
    c.lineTo(128, y + 18);
    c.lineTo(228, y);
    c.lineTo(210, y + 23);
    c.lineTo(128, y + 33);
    c.lineTo(46, y + 23);
    c.fill();
  }
  c.strokeStyle = '#999c9f';
  c.lineWidth = 3;
  c.strokeRect(8, 8, 240, 496);
  c.fillStyle = '#353a45';
  c.font = 'italic 900 46px Arial';
  c.textAlign = 'center';
  c.fillText('SX', 128, 135);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return new THREE.MeshStandardMaterial({map, roughness: 0.68});
}
