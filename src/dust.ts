import * as THREE from 'three';
import type {Rider} from './physics';
/** Soft, short-lived roost rendered once per camera without opaque polygon puffs. */
export class Dust {
  mesh: THREE.Points;
  particles: {x: number; y: number; z: number; vx: number; vz: number; vy: number; life: number; size: number}[] = [];
  cursor = 0;
  clock = 0;
  private positions = new Float32Array(256 * 3);
  private sizes = new Float32Array(256);
  private opacity = new Float32Array(256);
  constructor(scene: THREE.Scene) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));
    geometry.setAttribute('alpha', new THREE.BufferAttribute(this.opacity, 1));
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {viewportHeight: {value: 720}, color: {value: new THREE.Color('#b58d64')}},
      vertexShader: `attribute float size;attribute float alpha;varying float opacity;uniform float viewportHeight;void main(){vec4 p=modelViewMatrix*vec4(position,1.);opacity=alpha;gl_Position=projectionMatrix*p;gl_PointSize=min(180.,size*viewportHeight/-p.z);}`,
      fragmentShader:
        `uniform vec3 color;varying float opacity;void main(){float d=length(gl_PointCoord-.5)*2.;float a=pow(max(0.,1.-d),2.)*opacity;gl_FragColor=vec4(color,a);#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}`.replace(
          ';#include',
          ';\n#include',
        ),
    });
    this.mesh = new THREE.Points(geometry, material);
    this.mesh.frustumCulled = false;
    const viewport = new THREE.Vector4();
    this.mesh.onBeforeRender = renderer => {
      renderer.getCurrentViewport(viewport);
      material.uniforms.viewportHeight.value = viewport.w;
    };
    scene.add(this.mesh);
    for (let i = 0; i < 256; i++) this.particles.push({x: 0, y: -10, z: 0, vx: 0, vz: 0, vy: 0, life: 0, size: 0});
  }
  update(riders: Rider[], dt: number) {
    this.clock += dt;
    if (this.clock > 0.045) {
      this.clock = 0;
      for (const r of riders)
        if (r.grounded && r.speed > 5 && r.recovery <= 0) {
          const p = this.particles[this.cursor++ % 256];
          p.x = r.x - Math.sin(r.heading) * 1.05;
          p.z = r.z - Math.cos(r.heading) * 1.05;
          p.y = r.y + 0.2;
          const scatter = Math.sin(this.cursor * 13.37),
            roost = 1.5 + r.speed * 0.08 + r.powerSlide * 4;
          p.vx = -Math.sin(r.heading) * roost + Math.cos(r.heading) * scatter * (0.7 + r.powerSlide * 2.5);
          p.vz = -Math.cos(r.heading) * roost - Math.sin(r.heading) * scatter * (0.7 + r.powerSlide * 2.5);
          p.vy = 0.55 + r.speed * 0.025 + r.powerSlide * 0.7;
          p.life = 1.2;
          p.size = 0.3;
        }
    }
    this.particles.forEach((p, i) => {
      p.life = Math.max(0, p.life - dt);
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.y += dt * p.vy;
      p.vy = Math.max(0.25, p.vy - dt * 0.7);
      p.size += dt * 1.3;
      this.positions.set([p.x, p.y, p.z], i * 3);
      this.sizes[i] = p.life > 0 ? p.size : 0;
      this.opacity[i] = p.life * 0.42;
    });
    for (const name of ['position', 'size', 'alpha']) this.mesh.geometry.attributes[name].needsUpdate = true;
  }
}
