// Smooth drawing between fixed physics steps.
// Physics runs at a fixed 1/120 s step. The display refresh never lines up exactly, so some
// frames run one step more or fewer than the others. Drawing the raw physics state makes
// bikes and the camera jump. Instead we draw each rider between its previous and current
// physics pose, by how far the clock has moved into the next step. Physics is untouched.

export interface Pose {x:number;y:number;z:number;heading:number}

/** Riders that jump further than this in one step (recovery, restart) are drawn snapped. */
export const SNAP_DISTANCE=5;

export function capturePose(r:Pose):Pose {return {x:r.x,y:r.y,z:r.z,heading:r.heading};}

/** Pose between `prev` and `curr`, with alpha 0 = prev and 1 = curr. */
export function blendPose(prev:Pose|undefined,curr:Pose,alpha:number):Pose {
  if(!prev)return capturePose(curr);
  const dx=curr.x-prev.x,dy=curr.y-prev.y,dz=curr.z-prev.z;
  if(dx*dx+dy*dy+dz*dz>SNAP_DISTANCE*SNAP_DISTANCE)return capturePose(curr);
  const a=Math.min(1,Math.max(0,alpha));
  const turn=Math.atan2(Math.sin(curr.heading-prev.heading),Math.cos(curr.heading-prev.heading));
  return {x:prev.x+dx*a,y:prev.y+dy*a,z:prev.z+dz*a,heading:prev.heading+turn*a};
}

/** Frame pacing summary for the review panel: slowest 1% of frames and uneven step counts. */
export function pacingStats(frameSeconds:number[],stepsPerFrame:number[]){
  const sorted=[...frameSeconds].sort((a,b)=>a-b);
  const p99=sorted.length?sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.99))]*1000:0;
  const counts=new Map<number,number>();for(const n of stepsPerFrame)counts.set(n,(counts.get(n)||0)+1);
  let usual=0,best=-1;for(const [n,c] of counts)if(c>best){best=c;usual=n;}
  const uneven=stepsPerFrame.filter(n=>n!==usual).length;
  return {p99Ms:p99,unevenPct:stepsPerFrame.length?uneven/stepsPerFrame.length*100:0,usualSteps:usual};
}
