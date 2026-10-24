import * as THREE from 'three';
import type {Track} from './track';
import {obstacleLength,obstacleType} from './track-layout';
export function markerSign(text:string,color:string):THREE.Sprite {
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=96;
  const c=canvas.getContext('2d')!;c.fillStyle='#111827';c.fillRect(0,0,512,96);c.strokeStyle=color;c.lineWidth=8;c.strokeRect(4,4,504,88);c.fillStyle=color;c.font='bold 38px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(text,256,48,480);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const sign=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false,transparent:true}));sign.scale.set(18,3.4,1);sign.renderOrder=10;return sign;
}
/** Surface ribbon follows the very same height field used by the rider physics. */
export function surfaceMarker(track:Track,start:number,length:number,color:number){
  const vertices:number[]=[],indices:number[]=[],steps=Math.max(12,Math.ceil(length)),lanes=8;
  for(let n=0;n<=steps;n++)for(let lane=0;lane<=lanes;lane++){const lateral=(lane/lanes*2-1)*track.halfWidth*.92,s=start+n/steps*length,p=track.at(s,lateral);vertices.push(p.x,track.height(s,lateral)+.22,p.z);}
  for(let n=0;n<steps;n++)for(let lane=0;lane<lanes;lane++){const i=n*(lanes+1)+lane,b=i+lanes+1;indices.push(i,i+1,b,i+1,b+1,b);}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setIndex(indices);
  return new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color,transparent:true,opacity:.5,side:THREE.DoubleSide,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2}));
}
export function obstacleMarker(track:Track,index:number,ride=false){
  const j=track.obstacles[index],group=new THREE.Group();if(!j)return group;
  group.add(surfaceMarker(track,j.start,obstacleLength(j),0x37e6bd));
  const outline:THREE.Vector3[]=[];
  for(const lateral of [-track.halfWidth*.92,track.halfWidth*.92])for(let n=0;n<80;n++)for(const k of [n,n+1]){const s=j.start+k/80*obstacleLength(j),p=track.at(s,lateral);outline.push(new THREE.Vector3(p.x,track.height(s,lateral)+.28,p.z));}
  group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(outline),new THREE.LineBasicMaterial({color:0xffdf69})));
  const p=track.at(j.start,track.halfWidth+2),y=track.height(j.start,track.halfWidth);
  const post=new THREE.Mesh(new THREE.CylinderGeometry(.18,.18,ride?4:8,6),new THREE.MeshBasicMaterial({color:0xffd65a}));post.position.set(p.x,y+(ride?2:4),p.z);group.add(post);
  const sign=markerSign(`O${index+1} · ${obstacleType(j).toUpperCase()}`,'#ffdc69');if(ride){sign.scale.set(8,1.5,1);sign.material.depthTest=true;}sign.position.set(p.x,y+(ride?5:9),p.z);group.add(sign);return group;
}
export function startMarker(track:Track){
  const group=new THREE.Group(),p=track.at(0),sign=markerSign('START / FINISH →','#a3f6d4');sign.position.set(p.x,track.height(0)+8,p.z);group.add(sign,surfaceMarker(track,0,2,0xa3f6d4));return group;
}
export function disposeMarkers(group:THREE.Group){
  group.traverse(object=>{const mesh=object as THREE.Mesh;if(mesh.geometry)mesh.geometry.dispose();if(mesh.material){for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]){const map=(material as THREE.SpriteMaterial).map;map?.dispose();material.dispose();}}});group.clear();
}
