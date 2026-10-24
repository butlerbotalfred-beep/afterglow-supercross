import * as THREE from 'three';
/** Locally served original texture; shallow shader grooves follow the course UVs. */
export function dirtMaterial(ground=false,onLoad?:()=>void){
  const dirt=new THREE.TextureLoader().load('/art/dirt-clay-v2.png',onLoad);dirt.colorSpace=THREE.SRGBColorSpace;dirt.wrapS=dirt.wrapT=THREE.RepeatWrapping;dirt.anisotropy=8;
  if(ground)dirt.repeat.set(450,450);
  const material=new THREE.MeshStandardMaterial({map:dirt,bumpMap:dirt,bumpScale:ground?.075:.18,roughness:.98,vertexColors:!ground});
  if(!ground){
    material.onBeforeCompile=shader=>{
      shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
        // Fine racing ruts curve slightly along travel; broad shoulders stay granular.
        float line=vMapUv.x*19.0+sin(vMapUv.y*.48)*.18+sin(vMapUv.y*1.7)*.04;
        float rut=pow(.5+.5*cos(line*6.283185),18.);
        float cut=pow(.5+.5*cos((line+.15)*6.283185),9.);
        diffuseColor.rgb*=1.-rut*.23+cut*.075;
      `);
      shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
        // Ruts catch the key light rather than being painted dark stripes alone.
        float grooveHeight=-rut*.045+cut*.012;
        normal=perturbNormalArb(-vViewPosition,normal,vec2(dFdx(grooveHeight),dFdy(grooveHeight)),faceDirection);
      `);
    };
    material.customProgramCacheKey=()=> 'clay-ruts-v3';
  }
  return material;
}
export function barrierTexture(color:string,chevrons:boolean){
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;const c=canvas.getContext('2d')!;
  c.fillStyle=color;c.fillRect(0,0,512,128);
  // Padded vinyl has stitched edges, folds, scuffs and lighter upper piping.
  for(let i=0;i<14;i++){
    const x=(i*71.17)%512,bend=Math.sin(i*3.2)*28;
    c.strokeStyle='#05091622';c.lineWidth=4;c.beginPath();c.moveTo(x,0);c.bezierCurveTo(x+bend,39,x-bend*.4,82,x+bend*.6,128);c.stroke();
    c.strokeStyle='#ffffff13';c.lineWidth=2;c.beginPath();c.moveTo(x-3,0);c.bezierCurveTo(x+bend-3,39,x-bend*.4-3,82,x+bend*.6-3,128);c.stroke();
  }
  c.strokeStyle='#ffffff44';c.lineWidth=2;c.strokeRect(4,5,504,118);c.strokeStyle='#0b102c66';c.strokeRect(7,8,498,113);
  if(chevrons){c.fillStyle='#f1bd39';for(const x of [160,213,330,383]){c.beginPath();c.moveTo(x,28);c.lineTo(x+23,28);c.lineTo(x+48,64);c.lineTo(x+23,100);c.lineTo(x,100);c.lineTo(x+25,64);c.closePath();c.fill();}}
  const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;return t;
}
