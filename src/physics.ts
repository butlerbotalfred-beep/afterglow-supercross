import {normalizeSlideAggression} from './handling-settings';
import {Track, type TrackPoint} from './track';
import {TUNING, clamp, angleDelta} from './config';
import {createProgress, updateProgress, restoreDeparture, type Progress} from './race';
import type {Control,Device} from './input';
export interface Rider {
  id:number; human:boolean; device?:Device; name:string; color:number;
  x:number;z:number;y:number;heading:number;speed:number;vy:number;grounded:boolean;
  powerSlide:number;slipAngle:number;
  pitch:number;pitchRate:number;lean:number;compression:number;steer:number;throttle:number;brake:number;airTime:number;
  progress:Progress; surface:TrackPoint; recovery:number; stuck:number; finished:number|null;dnf:boolean;
  lastLanding:number; bestAir:number;
  prevX:number;prevZ:number;crashTime:number;crashAge:number;crashSide:number;crashReason:string;crashes:number;recoveryReason:string;
}
export const idleControl=():Control=>({throttle:0,brake:0,steer:0,pitch:0,reset:false,pause:false});
export function makeRider(track:Track,id:number,human:boolean,color:number,device?:Device):Rider {
  const s=-3-Math.floor(id/4)*2.8,p=track.at(s,((id%4)-1.5)*1.9);
  return {id,human,device,name:human?`PLAYER ${id+1}`:['','','','',''][id]||`RIDER ${id+1}`,color,x:p.x,z:p.z,y:track.height(s,p.lateral),heading:Math.atan2(p.tx,p.tz),speed:0,vy:0,grounded:true,powerSlide:0,slipAngle:0,pitch:0,pitchRate:0,lean:0,compression:0,steer:0,throttle:0,brake:0,airTime:0,progress:{...createProgress(s),lastLateral:p.lateral},surface:p,recovery:0,stuck:0,finished:null,dnf:false,lastLanding:0,bestAir:0,prevX:p.x,prevZ:p.z,crashTime:0,crashAge:0,crashSide:1,crashReason:"",crashes:0,recoveryReason:""};
}
export function recover(r:Rider,track:Track,others:Rider[]) {
  if(!r.progress.routeBroken)updateProgress(r.progress,r.surface.s,clamp(r.surface.lateral,-track.halfWidth,track.halfWidth),track.length,track.halfWidth+.45,TUNING.step);
  const departure=r.progress.routeBroken?restoreDeparture(r.progress):null;
  const s=departure?.s??r.surface.s;
  const lane=clamp(departure?.lateral??r.surface.lateral,-track.halfWidth,track.halfWidth);
  let p=track.at(s,lane),back=0;
  // Remount at the wreck, or at the original departure point after a shortcut.
  // Move only sideways/backward if another rider occupies the remount position.
  search: for(const behind of [0,2,4,6,8])for(const offset of [0,-2,2,-4,4]){
    p=track.at(s-behind,clamp(lane+offset,-track.halfWidth,track.halfWidth));back=behind;
    if(!others.some(o=>o!==r&&Math.hypot(o.x-p.x,o.z-p.z)<1.65))break search;
  }
  r.progress.lastS=p.s;r.progress.lastLateral=p.lateral;
  r.progress.distanceSinceCheckpoint-=back;
  r.progress.offTrack=false;r.progress.wrongWay=false;
  r.recoveryReason=departure?'SHORTCUT / BACK TO TRACK EXIT':'REMOUNTING AT WRECK';
  r.x=p.x;r.z=p.z;r.y=track.height(p.s,p.lateral);r.heading=Math.atan2(p.tx,p.tz);r.surface=p;
  r.crashTime=0;r.crashAge=0;r.prevX=p.x;r.prevZ=p.z;
  r.powerSlide=0;r.slipAngle=0;r.speed=0;r.vy=0;r.pitch=0;r.pitchRate=0;r.lean=0;r.grounded=true;r.recovery=TUNING.recoveryDelay;r.stuck=0;
}
export function crash(r:Rider,reason:string,side=1){
  if(r.crashTime>0||r.recovery>0)return;
  r.crashTime=TUNING.crashDuration;r.crashAge=0;r.crashReason=reason;r.crashSide=side<0?-1:1;r.crashes++;
  r.powerSlide=0;r.slipAngle=0;r.speed*=.48;r.throttle=0;r.steer=0;r.pitchRate=0;
}

export function stepRider(r:Rider,c:Control,track:Track,dt:number,others:Rider[],slideAggression=1) {
  r.lastLanding=0;r.compression*=Math.exp(-dt*9);
  r.prevX=r.x;r.prevZ=r.z;
  if(r.crashTime>0){
    r.crashTime=Math.max(0,r.crashTime-dt);r.crashAge+=dt;
    r.speed=Math.max(0,r.speed-18*dt);r.x+=Math.sin(r.heading)*r.speed*dt;r.z+=Math.cos(r.heading)*r.speed*dt;
    r.surface=track.project(r.x,r.z);const floor=track.height(r.surface.s,r.surface.lateral);
    r.vy-=TUNING.gravity*dt;r.y=Math.max(floor,r.y+r.vy*dt);if(r.y===floor)r.vy=0;
    // Defer slide movement until the wreck settles, then validate the same route
    // rules as riding. Crashing cannot erase an existing off-track departure.
    if(r.crashTime===0){
      updateProgress(r.progress,r.surface.s,r.surface.lateral,track.length,track.halfWidth+.45,dt);
      recover(r,track,others);
    }
    return;
  }
  if(c.reset)recover(r,track,others);
  if(r.recovery>0){r.recovery=Math.max(0,r.recovery-dt);return;}
  r.throttle=c.throttle;r.brake=c.brake;r.steer=c.steer;
  // Throttle slides use the lower stick quadrants; braking while steering loads
  // the front and breaks rear grip without requiring throttle or a pitch gesture.
  // NPCs retain their planned grip path rather than initiating this rider gesture.
  const aggression=normalizeSlideAggression(slideAggression);
  const brake=clamp(c.brake,0,1);
  const slideSpeed=clamp((r.speed-5)/7,0,1);
  const turnDemand=clamp((Math.abs(c.steer)-.35)/.45,0,1);
  const powerDemand=clamp((c.pitch-.12)/.5,0,1)*clamp(c.throttle,0,1)*(1-brake);
  const brakeDemand=r.human?brake:0;
  const slideDemand=r.grounded&&aggression>0?turnDemand*Math.max(powerDemand,brakeDemand)*slideSpeed:0;
  const slideBoost=1+TUNING.brakeSlideBoost*brakeDemand;
  if(r.grounded)r.powerSlide+=(slideDemand-r.powerSlide)*(1-Math.exp(-dt*(slideDemand>r.powerSlide?9:13)));
  else {r.powerSlide=0;r.slipAngle=0;}
  const targetSlip=c.steer*TUNING.slideSlipAngle*r.powerSlide*aggression*slideBoost;
  r.slipAngle+=(targetSlip-r.slipAngle)*(1-Math.exp(-dt*10));
  const off=Math.abs(r.surface.lateral)>track.halfWidth;
  const accel=r.grounded?TUNING.acceleration*c.throttle-TUNING.braking*c.brake-TUNING.drag*r.speed-TUNING.slideDrag*r.powerSlide-(off?6:0):-.08*r.speed;
  r.speed=clamp(r.speed+accel*dt,0,TUNING.maxSpeed);
  const steerPower=TUNING.turnRate*(.18+.82*clamp(r.speed/6,0,1))*(r.grounded?1:.36);
  r.heading+=c.steer*steerPower*(1+TUNING.slideYawBoost*r.powerSlide*aggression*slideBoost)*dt;
  r.lean+=(c.steer*clamp(r.speed/22,0,1)*(.52+.12*r.powerSlide)-r.lean)*Math.min(1,dt*9);
  const prevY=r.y;
  const travelHeading=r.heading-r.slipAngle;
  r.x+=Math.sin(travelHeading)*r.speed*dt;r.z+=Math.cos(travelHeading)*r.speed*dt;
  r.surface=track.project(r.x,r.z);
  const floor=track.height(r.surface.s,r.surface.lateral);
  const look=track.project(r.x+Math.sin(r.heading)*.42,r.z+Math.cos(r.heading)*.42);
  const slope=(track.height(look.s,look.lateral)-floor)/.42;
  if(r.grounded){
    const ballistic=prevY+r.vy*dt-TUNING.gravity*dt*dt*.5;
    if(ballistic>floor+.00035&&r.speed>5){r.grounded=false;r.y=ballistic;r.vy-=TUNING.gravity*dt;r.airTime=dt;r.pitchRate=0;r.powerSlide=0;r.slipAngle=0;}
    else {r.y=floor;r.vy=clamp((floor-prevY)/dt,-20,20);r.pitch+=(Math.atan(slope)-TUNING.slideNoseDip*r.powerSlide-TUNING.brakeNoseDip*brake*slideSpeed-r.pitch)*Math.min(1,dt*14);}
  }else{
    r.vy-=TUNING.gravity*dt;r.y+=r.vy*dt;r.airTime+=dt;
    // Body position rotates the bike; an air-brake tap adds nose-down torque.
    const targetRate=clamp(c.pitch*3.6-c.brake*1.5,-4,3.6)-r.pitch*.5;
    r.pitchRate+=(targetRate-r.pitchRate)*Math.min(1,dt*12);
    r.pitch=clamp(r.pitch+r.pitchRate*dt,-1.1,1.1);
    r.bestAir=Math.max(r.bestAir,r.y-floor);
    if(r.y<=floor){
      const impact=Math.abs(r.vy-r.speed*slope)/Math.sqrt(1+slope*slope),alignment=Math.abs(angleDelta(r.pitch,Math.atan(slope)));
      r.lastLanding=impact;r.compression=clamp(impact*.035,.04,1);
      if(impact>TUNING.landingCrashImpact||(alignment>TUNING.landingCrashAngle&&impact>5&&r.speed>7)||(Math.abs(r.lean)>.95&&impact>7)){
        r.y=floor;r.vy=0;r.grounded=true;
        updateProgress(r.progress,r.surface.s,r.surface.lateral,track.length,track.halfWidth+.45,dt);
        crash(r,impact>TUNING.landingCrashImpact?'HARD LANDING':'AWKWARD LANDING',r.lean||r.steer||((r.id%2)*2-1));return;
      }
      r.speed*=clamp(1-Math.max(0,alignment-.3)*.4-Math.max(0,impact-12)*.015,.55,1);
      r.y=floor;r.grounded=true;r.vy=r.speed*slope;r.airTime=0;r.pitchRate=0;
    }
  }
  if(Math.abs(r.surface.lateral)>track.halfWidth+2){r.speed=Math.min(r.speed,8);}
  updateProgress(r.progress,r.surface.s,r.surface.lateral,track.length,track.halfWidth+.45,dt);
  if(r.progress.routeBroken||r.y<floor-8)recover(r,track,others);
  r.stuck=r.speed<1?r.stuck+dt:0;
  if(!r.human&&r.stuck>3)recover(r,track,others);
}
export function collide(riders:Rider[],track:Track) {
  for(let i=0;i<riders.length;i++)for(let j=i+1;j<riders.length;j++){
    const a=riders[i],b=riders[j];if(a.recovery>0||b.recovery>0||a.crashTime>0||b.crashTime>0||Math.abs(a.y-b.y)>1.3)continue;
    let dx=b.x-a.x,dz=b.z-a.z,d=Math.hypot(dx,dz);
    // Swept pair contact catches fast crossings between fixed physics steps.
    const ax=a.x-a.prevX,az=a.z-a.prevZ,bx=b.x-b.prevX,bz=b.z-b.prevZ;
    const px=b.prevX-a.prevX,pz=b.prevZ-a.prevZ,vx=bx-ax,vz=bz-az,v2=vx*vx+vz*vz;
    if(d>=.85&&v2>1e-8&&Math.hypot(ax,az)<1&&Math.hypot(bx,bz)<1){
      const t=clamp(-(px*vx+pz*vz)/v2,0,1),sx=px+vx*t,sz=pz+vz*t;
      if(Math.hypot(sx,sz)<.85){dx=px;dz=pz;d=Math.hypot(dx,dz);}
      else continue;
    }else if(d>=.85)continue;
    if(d<.001){dx=Math.sin(a.heading);dz=Math.cos(a.heading);d=1;}
    const nx=dx/d,nz=dz/d;
    const closing=(Math.sin(a.heading-a.slipAngle)*a.speed-Math.sin(b.heading-b.slipAngle)*b.speed)*nx+(Math.cos(a.heading-a.slipAngle)*a.speed-Math.cos(b.heading-b.slipAngle)*b.speed)*nz;
    if(closing>TUNING.contactCrashSpeed){crash(a,'RIDER CONTACT',-1);crash(b,'RIDER CONTACT',1);continue;}
    const push=Math.max(0,(.85-Math.hypot(b.x-a.x,b.z-a.z))*.5);
    a.x-=nx*push;a.z-=nz*push;b.x+=nx*push;b.z+=nz*push;
    a.speed*=.992;b.speed*=.992;
  }
}

/** Predict the downslope under the ballistic path, so NPCs prepare before touchdown. */
function landingPitch(r:Rider,track:Track){
  for(let t=.08;t<2.8;t+=.08){
    const s=r.surface.s+r.speed*t,y=r.y+r.vy*t-.5*TUNING.gravity*t*t;
    if(y<=track.height(s,r.surface.lateral))return Math.atan((track.height(s+.5,r.surface.lateral)-track.height(s-.5,r.surface.lateral)));
  }
  return 0;
}
export function npcControl(r:Rider,track:Track,others:Rider[],difficulty:string):Control {
  const pace=difficulty==='relaxed'?.78:difficulty==='expert'?1.04:.91;
  const ahead=4+r.speed*.32;
  let lane=Math.sin(r.surface.s*.043+r.id*2)*.65+(r.id%3-1)*.55;
  for(const o of others)if(o!==r&&Math.hypot(o.x-r.x,o.z-r.z)<4&&o.speed<r.speed+2)lane+=o.surface.lateral>r.surface.lateral?-1:1;
  lane=clamp(lane,-2.5,2.5);
  const target=track.at(r.surface.s+ahead,lane);
  const desired=Math.atan2(target.x-r.x,target.z-r.z);
  const err=angleDelta(desired,r.heading);
  // Look through the braking distance before using the faster straight-line pace.
  const brakingLook=13+r.speed*r.speed/(2*TUNING.braking);
  let curvature=0;
  for(let distance=5;distance<=brakingLook;distance+=6)curvature=Math.max(curvature,Math.abs(track.curvature(r.surface.s+distance)));
  let targetSpeed=clamp(46.875-curvature*460,11.8,45)*pace;
  for(const rhythm of track.rhythms){
    const entrySpeed=rhythm.pace*(difficulty==='relaxed'?.98:difficulty==='expert'?1.02:1);
    if(r.surface.s>=rhythm.start&&r.surface.s<rhythm.end)targetSpeed=Math.min(targetSpeed,entrySpeed);
    else{
      const distance=(rhythm.start-r.surface.s+track.length)%track.length;
      if(distance<90)targetSpeed=Math.min(targetSpeed,Math.sqrt(entrySpeed*entrySpeed+2*TUNING.braking*.65*distance));
    }
  }
  if(Math.abs(err)>.6)targetSpeed=Math.min(targetSpeed,10);
  return {throttle:clamp((targetSpeed-r.speed)*.55,0,1),brake:clamp((r.speed-targetSpeed-1)*.28,0,.7),steer:clamp(err*2.4,-1,1),pitch:r.grounded?0:clamp(((landingPitch(r,track)-r.pitch)*6-r.pitchRate*.7+r.pitch*.5)/3.6,-.85,.85),reset:false,pause:false};
}
