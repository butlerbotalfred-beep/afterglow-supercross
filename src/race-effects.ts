import * as THREE from 'three';

/** Shared HDR resolve: one scene buffer for every split-screen viewport. */
export class RaceEffects {
  readonly target: THREE.WebGLRenderTarget;
  private glowA: THREE.WebGLRenderTarget;
  private glowB: THREE.WebGLRenderTarget;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private blur: THREE.ShaderMaterial;
  private composite: THREE.ShaderMaterial;
  private size = new THREE.Vector2();
  constructor(private renderer: THREE.WebGLRenderer) {
    const hdr = renderer.extensions.has('EXT_color_buffer_float');
    const type = hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.target = new THREE.WebGLRenderTarget(1, 1, {type, depthBuffer: true, samples: 2});
    this.target.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    this.glowA = new THREE.WebGLRenderTarget(1, 1, {type, depthBuffer: false});
    this.glowB = this.glowA.clone();
    const vertexShader = 'varying vec2 uvScreen;void main(){uvScreen=uv;gl_Position=vec4(position.xy,0.,1.);}';
    const clampView =
      `uniform float views;vec2 viewUV(vec2 p,` +
      `vec2 origin){vec2 grid=views>2.5?vec2(2.):views>1.5?vec2(1.,2.):vec2(1.);` +
      `vec2 lo=floor(origin*grid)/grid;return clamp(p,lo+pixel*.6,lo+1./grid-pixel*.6);}`;
    this.blur = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        source: {value: this.target.texture},
        direction: {value: new THREE.Vector2()},
        pixel: {value: new THREE.Vector2()},
        extract: {value: 1},
        threshold: {value: hdr ? 1.15 : 0.82},
        views: {value: 1},
      },
      vertexShader,
      fragmentShader:
        `
      varying vec2 uvScreen;uniform sampler2D source;uniform vec2 direction,pixel;uniform float extract,threshold;
      ${clampView}
      vec3 readGlow(vec2 uv){vec3 c=texture2D(source,viewUV(uv,uvScreen)).rgb;` +
        `return extract>.5?c*smoothstep(threshold,threshold+.65,max(c.r,max(c.g,c.b))):c;}
      void main(){vec3 c=readGlow(uvScreen)*.227027;
        c+=(readGlow(uvScreen+direction*1.384615)+readGlow(uvScreen-direction*1.384615))*.316216;
        c+=(readGlow(uvScreen+direction*3.230769)+readGlow(uvScreen-direction*3.230769))*.070270;
        gl_FragColor=vec4(c,1.);
      }`,
    });
    this.composite = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        source: {value: this.target.texture},
        bloom: {value: this.glowB.texture},
        depth: {value: this.target.depthTexture},
        pixel: {value: new THREE.Vector2()},
        views: {value: 1},
        nearPlane: {value: 0.08},
      },
      vertexShader,
      fragmentShader:
        `
      varying vec2 uvScreen;uniform sampler2D source,bloom,depth;uniform vec2 pixel;uniform float nearPlane;
      ${clampView}
      float viewDepth(vec2 uv){float d=texture2D(depth,uv).x;return nearPlane*1800./(1800.-d*(1800.-nearPlane));}
      void main(){
        vec3 color=texture2D(source,uvScreen).rgb;float z=viewDepth(uvScreen),occlusion=0.;
        float radius=clamp(70./max(z,1.),1.5,12.);
        for(int i=0;i<8;i++){float a=float(i)*.785398;vec2 offset=vec2(cos(a),sin(a))*pixel*radius;` +
        `float delta=z-viewDepth(viewUV(uvScreen+offset,uvScreen));occlusion+=smoothstep(.04,.3,delta)*(1.-smoothstep(.45,1.7,delta));}
        color*=1.-occlusion*.035*(1.-smoothstep(35.,80.,z));
        color+=texture2D(bloom,uvScreen).rgb*.22;
        vec2 grid=views>2.5?vec2(2.):views>1.5?vec2(1.,2.):vec2(1.);vec2 centered=fract(uvScreen*grid)-.5;
        color*=1.-dot(centered,centered)*.14;
        gl_FragColor=vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blur);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }
  begin(views: number, setup: boolean) {
    this.renderer.getDrawingBufferSize(this.size);
    const {x: w, y: h} = this.size;
    if (this.target.width !== w || this.target.height !== h) {
      this.target.setSize(w, h);
      this.glowA.setSize(Math.max(1, Math.round(w / 4)), Math.max(1, Math.round(h / 4)));
      this.glowB.setSize(this.glowA.width, this.glowA.height);
    }
    for (const material of [this.blur, this.composite]) {
      material.uniforms.pixel.value.set(1 / w, 1 / h);
      material.uniforms.views.value = views;
    }
    this.composite.uniforms.nearPlane.value = setup ? 0.1 : 0.08;
    this.target.viewport.set(0, 0, w, h);
    this.target.scissor.set(0, 0, w, h);
    this.target.scissorTest = false;
    this.renderer.setRenderTarget(this.target);
    return this.size;
  }
  viewport(x: number, y: number, w: number, h: number) {
    const ratio = this.renderer.getPixelRatio();
    this.target.viewport.set(x * ratio, y * ratio, w * ratio, h * ratio);
    this.target.scissor.copy(this.target.viewport);
    this.target.scissorTest = true;
    this.renderer.setViewport(x, y, w, h);
    this.renderer.setScissor(x, y, w, h);
    this.renderer.setScissorTest(true);
  }
  finish() {
    const r = this.renderer;
    r.setScissorTest(false);
    this.quad.material = this.blur;
    this.blur.uniforms.source.value = this.target.texture;
    this.blur.uniforms.extract.value = 1;
    this.blur.uniforms.direction.value.set(2 / this.glowA.width, 0);
    r.setRenderTarget(this.glowA);
    r.render(this.scene, this.camera);
    this.blur.uniforms.source.value = this.glowA.texture;
    this.blur.uniforms.extract.value = 0;
    this.blur.uniforms.direction.value.set(0, 2 / this.glowA.height);
    r.setRenderTarget(this.glowB);
    r.render(this.scene, this.camera);
    this.quad.material = this.composite;
    r.setRenderTarget(null);
    r.setViewport(0, 0, innerWidth, innerHeight);
    r.render(this.scene, this.camera);
  }
}
