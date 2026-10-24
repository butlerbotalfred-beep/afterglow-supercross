import * as THREE from 'three';
import {Track} from './track';
import {TUNING} from './config';
import type {Rider} from './physics';
export class ChaseCamera {
  camera=new THREE.PerspectiveCamera(66,1,.08,1800);
  initialized=false;
  yaw=0;
  update(r:Rider,track:Track,dt:number,distance:number,shake:number,time:number){
    if(!this.initialized)this.yaw=r.heading;
    const delta=Math.atan2(Math.sin(r.heading-this.yaw),Math.cos(r.heading-this.yaw));this.yaw+=delta*(1-Math.exp(-dt*8));
    const f=new THREE.Vector3(Math.sin(this.yaw),0,Math.cos(this.yaw));
    const base=new THREE.Vector3(r.x,r.y,r.z);
    const framingDistance=distance+Math.max(0,Math.min(.7,r.pitch))*.8;
    const target=base.clone().addScaledVector(f,-framingDistance);target.y+=TUNING.cameraHeight;
    const p=track.project(target.x,target.z);target.y=Math.max(target.y,track.height(p.s,p.lateral)+.55);
    if(!this.initialized){this.camera.position.copy(target);this.initialized=true;}else this.camera.position.lerp(target,1-Math.exp(-dt*11));
    // Look along travel direction, with a stable horizon and room to read landing faces.
    const look=base.clone().addScaledVector(f,5);look.y+=.65;
    const future=track.at(r.surface.s+8,r.surface.lateral);look.y+=THREE.MathUtils.clamp(track.height(future.s,future.lateral)-r.y,0,1.8)*.12;
    look.y+=Math.sin(time*43)*shake*Math.min(1,r.speed/20)*.04;
    this.camera.lookAt(look);this.camera.fov=63+Math.min(5,r.speed*.14);this.camera.updateProjectionMatrix();
  }
}
