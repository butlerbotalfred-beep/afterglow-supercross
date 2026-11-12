import * as THREE from 'three';
import {TUNING, clamp, wrap} from './config';
import {COURSES, type Course} from './courses';
import {validateLayout, obstacleCount, obstacleLength, type LayoutJump, type TrackLayout} from './track-layout';
export interface TrackPoint {
  x: number;
  z: number;
  tx: number;
  tz: number;
  s: number;
  lateral: number;
  distance: number;
}
export class Track {
  readonly halfWidth = TUNING.trackHalfWidth;
  readonly controlPoints: [number, number][];
  readonly customName?: string;
  readonly bermHeights?: (number | null)[];
  private berms: {s: number; before: number; after: number; height: number; side: number}[] = [];
  readonly samples: THREE.Vector3[];
  readonly length: number;
  readonly count: number;
  readonly bounds: {minX: number; maxX: number; minZ: number; maxZ: number};
  readonly obstacles: (LayoutJump & {start: number})[] = [];
  readonly jumps: {start: number; rise: number; flat: number; fall: number; height: number}[] = [];
  readonly sections: {start: number; name: string}[] = [];
  readonly rhythms: {start: number; end: number; pace: number; name: string}[] = [];
  private readonly cells = new Map<string, number[]>();
  private readonly cellSize = 20;
  constructor(
    readonly course: Course = COURSES[0],
    layout?: TrackLayout,
  ) {
    if (layout) {
      layout = validateLayout(layout);
      if (layout.courseId !== course.id) throw new Error('Layout belongs to another circuit.');
      this.customName = layout.name;
    }
    const original = [
      [-28, 0],
      [-28, 32],
      [-21, 47],
      [0, 51],
      [23, 46],
      [30, 30],
      [30, 0],
      [30, -31],
      [22, -47],
      [0, -52],
      [-22, -46],
      [-28, -30],
    ];
    const makeCurve = (coords: number[][]) =>
      new THREE.CatmullRomCurve3(
        coords.map(([x, z]) => new THREE.Vector3(x, 0, z)),
        true,
        'centripetal',
      );
    const old = makeCurve(original);
    old.arcLengthDivisions = 2400;
    // Eight alternating lanes, banked hairpins, then a broad outer return loop.
    const coords = [
      [-140, -100],
      [-140, 30],
      [-140, 100],
      [-140, 120],
      [-120, 140],
      [-100, 120],
      [-100, 90],
      [-100, -70],
      [-100, -100],
      [-80, -120],
      [-60, -100],
      [-60, -70],
      [-60, 90],
      [-60, 120],
      [-40, 140],
      [-20, 120],
      [-20, 80],
      [-25, 25],
      [-15, -30],
      [-20, -70],
      [-20, -100],
      [0, -120],
      [20, -100],
      [20, -70],
      [20, 90],
      [20, 120],
      [40, 140],
      [60, 120],
      [60, 90],
      [60, -70],
      [60, -100],
      [80, -120],
      [100, -100],
      [100, -70],
      [100, 90],
      [100, 120],
      [120, 140],
      [140, 120],
      [140, 80],
      [140, -100],
      [160, -145],
      [180, -150],
      [195, -120],
      [195, 150],
      [165, 190],
      [-165, 190],
      [-195, 160],
      [-195, -140],
      [-165, -175],
      [-145, -150],
    ];
    const curve = makeCurve(layout?.points || course.coordinates || coords);
    curve.arcLengthDivisions = 16000;
    const scale = layout ? 1 : (course.id === 'dusk' ? old.getLength() * 9 : course.length) / curve.getLength();
    curve.points.forEach(p => p.multiplyScalar(scale));
    curve.updateArcLengths();
    this.controlPoints = curve.points.map(p => [p.x, p.z]);
    this.length = curve.getLength();
    this.count = Math.ceil(this.length / 0.5);
    this.samples = curve.getSpacedPoints(this.count);
    this.bounds = {
      minX: Math.min(...this.samples.map(p => p.x)),
      maxX: Math.max(...this.samples.map(p => p.x)),
      minZ: Math.min(...this.samples.map(p => p.z)),
      maxZ: Math.max(...this.samples.map(p => p.z)),
    };
    // Spatial lookup keeps the longer course from multiplying every physics step's cost.
    for (let i = 0; i < this.count; i++) {
      const a = this.samples[i],
        b = this.samples[i + 1],
        size = this.cellSize;
      for (let x = Math.floor(Math.min(a.x, b.x) / size); x <= Math.floor(Math.max(a.x, b.x) / size); x++)
        for (let z = Math.floor(Math.min(a.z, b.z) / size); z <= Math.floor(Math.max(a.z, b.z) / size); z++) {
          const key = `${x},${z}`;
          if (!this.cells.has(key)) this.cells.set(key, []);
          this.cells.get(key)!.push(i);
        }
    }
    if (layout?.bermHeights) {
      this.bermHeights = [...layout.bermHeights];
      const lengths = curve.getLengths(),
        stations = this.controlPoints.map((_, i) => {
          const u = (i / this.controlPoints.length) * (lengths.length - 1),
            n = Math.floor(u),
            f = u - n;
          return lengths[n] * (1 - f) + lengths[Math.min(n + 1, lengths.length - 1)] * f;
        });
      this.bermHeights.forEach((height, i) => {
        if (height === null) return;
        const s = stations[i],
          before = wrap(s - stations[(i + stations.length - 1) % stations.length], this.length) / 2,
          after = wrap(stations[(i + 1) % stations.length] - s, this.length) / 2;
        // Curvature determines the outside of this turn. A straight point stays flat.
        const side = Math.sign(this.curvature(s));
        this.berms.push({s, before, after, height, side});
      });
    }
    if (layout) {
      if (this.length < 200 || this.length > 10000) throw new Error('Keep circuit length between 200 m and 10 km.');
      this.sections.push({start: 0, name: 'CUSTOM / START & FINISH'});
      layout.jumps.forEach((j, i) => {
        const start = j.position * this.length,
          total = obstacleLength(j);
        if (total >= this.length) throw new Error('An obstacle must be shorter than the lap.');
        this.obstacles.push({...j, start});
        for (let n = 0; n < obstacleCount(j); n++)
          this.jumps.push({
            start: (start + n * (j.rise + j.flat + j.fall + (j.gap || 0))) % this.length,
            height: j.height,
            rise: j.rise,
            flat: j.flat,
            fall: j.fall,
          });
        const end = start + total;
        this.rhythms.push({
          start: Math.max(0, start - 12),
          end,
          pace: clamp(34 - (j.height / j.rise - 0.25) * 25, 20, 38),
          name: `JUMP ${i + 1}`,
        });
        this.sections.push({start, name: `CUSTOM / JUMP ${i + 1}`});
      });
      this.sections.sort((a, b) => a.start - b.start);
      return;
    }
    this.sections.push({start: 0, name: 'GATE / OPENING TABLETOP'});
    this.jumps.push({start: 10, rise: 16, flat: 10, fall: 30, height: 3.2});
    this.rhythms.push({start: 0, end: 66, pace: 34, name: 'OPENING TABLETOP'});
    const names = [
      'DOUBLE ALLEY',
      'TRIPLE CROWN',
      'RHYTHM FIVE',
      'DRAGON BACK',
      'SPLIT DOUBLES',
      'DEEP WHOOPS',
      'STEP-UP TABLES',
      'OUTER RHYTHM',
    ];
    // Longer transitions suit 28–40 m/s approaches. Every complete combination fits
    // inside a straight corridor; the final landing leaves a 30 m braking approach.
    let run = 82,
      section = 0,
      triplePlaced = false;
    const add = (start: number, rise: number, flat: number, fall: number, height: number) =>
      this.jumps.push({start, rise, flat, fall, height});
    for (let s = 82; s <= this.length - 40; s += 2) {
      if (Math.abs(this.curvature(s)) < 0.004 && s < this.length - 42) continue;
      const from = run + 14,
        to = s - 30;
      run = s + 2;
      if (to - from < 64) continue;
      const kind = section++ % names.length;
      const makeTriple = !triplePlaced && to - from >= 98 && kind !== 5 && kind !== 6;
      const sectionName = makeTriple
        ? 'TRIPLE CROWN'
        : kind === 1
          ? 'SPLIT DOUBLES'
          : kind === 2
            ? 'RHYTHM RUN'
            : names[kind];
      if (makeTriple) triplePlaced = true;
      this.sections.push({start: from - 8, name: sectionName});
      let base = from;
      while (base + 64 <= to) {
        const available = to - base;
        if (kind === 5) {
          const count = Math.min(8, Math.floor(available / 12));
          for (let j = 0; j < count; j++) add(base + j * 12, 5, 0, 7, 1.05);
          this.rhythms.push({start: base - 10, end: base + count * 12, pace: 34, name: sectionName});
          base += count * 12 + 20;
        } else if (kind === 6 && available >= 66) {
          add(base, 18, 16, 32, 4.2);
          this.rhythms.push({start: base - 12, end: base + 66, pace: 35, name: sectionName});
          base += 88;
        } else {
          const wanted = makeTriple ? 3 : kind === 1 ? 2 : kind === 2 || kind === 7 ? 5 : kind === 3 ? 4 : 2;
          const count = Math.min(wanted, Math.floor((available + 4) / 34));
          for (let j = 0; j < count; j++)
            add(base + j * 34, 11, 0, 19, kind === 3 ? 3.3 + j * 0.15 : 3.1 + (j === 0 ? 0.3 : 0));
          this.rhythms.push({start: base - 12, end: base + (count - 1) * 34 + 30, pace: 36, name: sectionName});
          base += count * 34 + 18;
        }
      }
      this.sections.push({start: to, name: 'BERM / SET UP YOUR EXIT'});
    }
    // Quarry's last climb changes the effective launch angle: longer takeoffs
    // keep the rhythm clean without shrinking it back to the old low rollers.
    if (course.id === 'quarry') {
      const climb = this.rhythms.at(-1)!;
      for (const j of this.jumps)
        if (j.start >= climb.start && j.start < climb.end) {
          j.rise = 16;
          j.fall = 18;
          j.height = 3.0;
        }
    }
    this.obstacles.push(...this.jumps.map(j => ({...j, position: j.start / this.length})));
    this.sections.push({start: this.length - 35, name: 'FINISH STRAIGHT'});
    this.sections.sort((a, b) => a.start - b.start);
  }
  at(s: number, lateral = 0): TrackPoint {
    const u = (wrap(s, this.length) / this.length) * this.count;
    const i = Math.floor(u),
      f = u - i,
      a = this.samples[i],
      b = this.samples[(i + 1) % this.count];
    const dx = b.x - a.x,
      dz = b.z - a.z;
    const before = this.samples[(i - 1 + this.count) % this.count],
      after = this.samples[(i + 2) % this.count];
    const vx = (b.x - before.x) * (1 - f) + (after.x - a.x) * f,
      vz = (b.z - before.z) * (1 - f) + (after.z - a.z) * f,
      d = Math.hypot(vx, vz),
      tx = vx / d,
      tz = vz / d;
    return {
      x: a.x + dx * f + tz * lateral,
      z: a.z + dz * f - tx * lateral,
      tx,
      tz,
      s: wrap(s, this.length),
      lateral,
      distance: Math.abs(lateral),
    };
  }
  project(x: number, z: number): TrackPoint {
    let best = Infinity,
      s = 0,
      lateral = 0;
    const visit = (i: number) => {
      const a = this.samples[i],
        b = this.samples[i + 1],
        dx = b.x - a.x,
        dz = b.z - a.z;
      const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
      const ex = x - a.x - dx * t,
        ez = z - a.z - dz * t,
        dist = ex * ex + ez * ez;
      if (dist < best) {
        best = dist;
        s = ((i + t) * this.length) / this.count;
        lateral = (ex * dz - ez * dx) / Math.hypot(dx, dz);
      }
    };
    const cx = Math.floor(x / this.cellSize),
      cz = Math.floor(z / this.cellSize);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) for (const i of this.cells.get(`${cx + dx},${cz + dz}`) || []) visit(i);
    if (best > this.cellSize * this.cellSize) for (let i = 0; i < this.count; i++) visit(i);
    return {...this.at(s, lateral), distance: Math.sqrt(best)};
  }
  curvature(s: number) {
    const a = this.at(s - 2),
      b = this.at(s + 2);
    return (
      Math.atan2(
        Math.sin(Math.atan2(b.tx, b.tz) - Math.atan2(a.tx, a.tz)),
        Math.cos(Math.atan2(b.tx, b.tz) - Math.atan2(a.tx, a.tz)),
      ) / 4
    );
  }
  /** Continuous world-space terrain: both the course and surrounding ground use this surface. */
  baseHeight(x: number, z: number) {
    const e = this.course.elevation;
    if (!e) return 0;
    if (this.course.id === 'canyon')
      return e * (1 + 0.48 * Math.sin(z * 0.012) + 0.3 * Math.sin(x * 0.017 + z * 0.004));
    if (this.course.id === 'alpine') return e * (1 + 0.58 * Math.sin(z * 0.009) + 0.28 * Math.cos(x * 0.014));
    if (this.course.id === 'coast')
      return e * (1 + 0.42 * Math.sin(x * 0.014 + z * 0.006) + 0.23 * Math.cos(z * 0.023));
    return e * (1 + 0.45 * Math.tanh(Math.sin(z * 0.014) * 1.7) + 0.22 * Math.sin(x * 0.018));
  }
  get elevationRange() {
    const heights = this.samples.map(p => this.baseHeight(p.x, p.z));
    return Math.max(...heights) - Math.min(...heights);
  }
  height(s: number, lateral = 0) {
    let h = 0.08;
    // Flat-topped jump with rounded lips; same analytic surface drives rendering and physics.
    const ramp = (start: number, rise: number, flat: number, fall: number, height: number) => {
      const d = wrap(s - start, this.length);
      if (d < rise) return height * (0.5 - 0.5 * Math.cos((Math.PI * d) / rise));
      if (d < rise + flat) return height;
      if (d < rise + flat + fall) return height * (0.5 + 0.5 * Math.cos((Math.PI * (d - rise - flat)) / fall));
      return 0;
    };
    for (const jump of this.jumps) h += ramp(jump.start, jump.rise, jump.flat, jump.fall, jump.height);
    let bank = clamp(this.curvature(s) * 18, -0.8, 0.8) * 1.9;
    for (const berm of this.berms) {
      const offset = wrap(s - berm.s + this.length / 2, this.length) - this.length / 2,
        span = offset < 0 ? berm.before : berm.after;
      if (Math.abs(offset) >= span) continue;
      const blend = 0.5 + 0.5 * Math.cos((Math.PI * offset) / span);
      bank = bank * (1 - blend) + berm.height * berm.side * blend;
    }
    const edge = clamp((-lateral * Math.sign(bank)) / this.halfWidth, 0, 1.45);
    h += Math.abs(bank) * edge * edge;
    if (Math.abs(lateral) > this.halfWidth + 1) h *= clamp((this.halfWidth + 3 - Math.abs(lateral)) / 2, 0, 1);
    const p = this.at(s, lateral);
    return h + this.baseHeight(p.x, p.z);
  }
  sector(s: number) {
    const distance = wrap(s, this.length);
    for (let i = this.sections.length - 1; i >= 0; i--)
      if (this.sections[i].start <= distance) return this.sections[i].name;
    return 'FINISH STRAIGHT';
  }
  geometry(step = 0.5, lanes = 40) {
    const positions: number[] = [],
      uvs: number[] = [],
      colors: number[] = [],
      indices: number[] = [];
    const count = Math.ceil(this.length / step),
      color = new THREE.Color(),
      reference = new THREE.Color('#ab6538');
    for (let i = 0; i <= count; i++)
      for (let j = 0; j <= lanes; j++) {
        const s = (i / count) * this.length,
          l = ((j / lanes) * 2 - 1) * (this.halfWidth + 2.8),
          p = this.at(s, l);
        const ripple =
          Math.sin(s * 4.7 + l * 11) *
          Math.sin(s * 2.13 - l * 7) *
          (0.016 + Math.pow(Math.abs(l) / this.halfWidth, 3) * 0.035);
        positions.push(
          p.x,
          this.height(s, l) +
            ripple -
            0.025 * Math.pow(0.5 + 0.5 * Math.sin(l * 9 + Math.sin(s * 0.06) * 0.5), 4) -
            (j === 0 || j === lanes ? 0.4 : 0),
          p.z,
        );
        uvs.push(l * 0.32, s * 0.32);
        const edge = Math.abs(l) / this.halfWidth;
        const lane = Math.cos(l * 4) * 0.025;
        color.set(edge > 1 ? this.course.shoulder : this.course.dirt);
        color.setRGB(color.r / reference.r, color.g / reference.g, color.b / reference.b);
        color.multiplyScalar(0.97 + Math.sin(i * 0.031 + j * 0.9) * 0.025 + lane);
        colors.push(color.r, color.g, color.b);
        if (i < count && j < lanes) {
          const a = i * (lanes + 1) + j,
            b = a + lanes + 1;
          indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }
}
