import type {CourseId} from './courses';
import type {Track} from './track';
export const OBSTACLE_TYPES=['single','tabletop','roller','double','triple','whoops'] as const;
export type ObstacleType=typeof OBSTACLE_TYPES[number];
export interface LayoutJump {position:number;height:number;rise:number;flat:number;fall:number;type?:ObstacleType;gap?:number;highlight?:boolean;}
export const obstacleType=(j:LayoutJump):ObstacleType=>j.type||(j.flat>0?'tabletop':'single');
export const obstacleCount=(j:LayoutJump)=>({single:1,tabletop:1,roller:1,double:2,triple:3,whoops:6}[obstacleType(j)]);
export const obstacleLength=(j:LayoutJump)=>(j.rise+j.flat+j.fall)*obstacleCount(j)+(j.gap||0)*(obstacleCount(j)-1);
export function replaceObstacle(j:LayoutJump,type:ObstacleType):LayoutJump {
  const shapes={single:[3.2,12,0,20,0],tabletop:[3.2,14,12,24,0],roller:[1.2,7,0,9,0],double:[3.2,11,0,19,4],triple:[3.2,11,0,19,4],whoops:[1,5,0,7,0]};
  const [height,rise,flat,fall,gap]=shapes[type];return {...j,type,height,rise,flat,fall,gap};
}
const modulo=(n:number,length:number)=>(n%length+length)%length;
/** Clear ground between complete obstacles, including across the start/finish seam. */
export function obstacleSpacing(jumps:LayoutJump[],index:number,length:number){
  if(jumps.length<2)return null;
  const order=jumps.map((j,i)=>({i,s:j.position*length})).sort((a,b)=>a.s-b.s||a.i-b.i),at=order.findIndex(j=>j.i===index);
  const previous=order[(at+order.length-1)%order.length],next=order[(at+1)%order.length],current=order[at];
  return {previous:previous.i,next:next.i,before:modulo(current.s-previous.s,length)-obstacleLength(jumps[previous.i]),after:modulo(next.s-current.s,length)-obstacleLength(jumps[index])};
}
export function moveObstacleToGap(jumps:LayoutJump[],index:number,length:number,side:'before'|'after',gap:number){
  const spacing=obstacleSpacing(jumps,index,length);if(!spacing||!Number.isFinite(gap)||gap<0)throw new Error('Enter a non-negative gap with at least two obstacles.');
  const available=spacing.before+spacing.after;
  if(gap>available+.001)throw new Error(`Only ${Math.max(0,available).toFixed(1)} m of clear ground is available between these neighbours. Shorten or move an obstacle first.`);
  const start=side==='before'?jumps[spacing.previous].position*length+obstacleLength(jumps[spacing.previous])+gap:jumps[spacing.next].position*length-obstacleLength(jumps[index])-gap;
  return Math.min(.999999,modulo(start,length)/length);
}
export interface TrackLayout {version:1;courseId:CourseId;name:string;points:[number,number][];jumps:LayoutJump[];bermHeights?:(number|null)[];}
export const LAYOUT_KEY='afterglow.track-layouts.v1';
const ids=['dusk','canyon','alpine','coast','quarry'];
const bounded=(n:unknown,min:number,max:number)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
export function validateLayout(value:unknown):TrackLayout {
  const v=value as TrackLayout;
  if(!v||v.version!==1||!ids.includes(v.courseId)||typeof v.name!=='string'||!v.name.trim()||v.name.length>48)throw new Error('Choose a layout with a valid name and circuit.');
  if(!Array.isArray(v.points)||v.points.length<4||v.points.length>120)throw new Error('A circuit needs 4–120 turn points.');
  for(let i=0;i<v.points.length;i++){
    const p=v.points[i],q=v.points[(i+1)%v.points.length];
    if(!Array.isArray(p)||p.length!==2||!p.every(n=>bounded(n,-1000,1000)))throw new Error('Turn coordinates must be within −1000 and 1000 metres.');
    if(!Array.isArray(q)||Math.hypot(p[0]-q[0],p[1]-q[1])<8)throw new Error('Leave at least 8 metres between neighbouring turn points.');
  }
  if(v.bermHeights!==undefined&&(!Array.isArray(v.bermHeights)||v.bermHeights.length!==v.points.length||v.bermHeights.some(h=>h!==null&&!bounded(h,0,5))))throw new Error('Each turn berm must be automatic (null) or a height from 0 to 5 metres.');
  if(!Array.isArray(v.jumps)||v.jumps.length>120)throw new Error('Use at most 120 jumps.');
  for(const j of v.jumps)if(!j||!bounded(j.position,0,.999999)||!bounded(j.height,.3,8)||!bounded(j.rise,4,40)||!bounded(j.flat,0,40)||!bounded(j.fall,6,60))throw new Error('Jump dimensions are outside the editor limits.');
  for(const j of v.jumps){
    if(j.type!==undefined&&!OBSTACLE_TYPES.includes(j.type))throw new Error('Unknown obstacle type.');
    if(j.gap!==undefined&&!bounded(j.gap,0,60))throw new Error('Internal mound gaps must be 0–60 metres.');
    if(j.highlight!==undefined&&typeof j.highlight!=='boolean')throw new Error('Test highlights must be on or off.');
  }
  if(v.jumps.reduce((n,j)=>n+obstacleCount(j),0)>240)throw new Error('Use at most 240 individual mounds.');
  return {version:1,courseId:v.courseId,name:v.name.trim(),points:v.points.map(p=>[...p]),jumps:v.jumps.map(j=>({...j})),...(v.bermHeights?{bermHeights:[...v.bermHeights]}:{})};
}
export function layoutFromTrack(track:Track):TrackLayout {
  return {version:1,courseId:track.course.id,name:`${track.course.name} Custom`,points:track.controlPoints.map(p=>[...p]),jumps:track.obstacles.map(({start:_,...j})=>({...j})),...(track.bermHeights?{bermHeights:[...track.bermHeights]}:{})};
}
export function layoutWarnings(track:Track):string[]{
  const issues:string[]=[];
  const sorted=[...track.jumps].sort((a,b)=>a.start-b.start);
  if(sorted.some((j,i)=>j.start+j.rise+j.flat+j.fall>(sorted[(i+1)%sorted.length]?.start??0)+(i===sorted.length-1?track.length:0)+.05))issues.push('Some jumps overlap. Move them apart or shorten their ramps.');
  if(sorted.some(j=>Math.abs(track.curvature(j.start+j.rise))>.012))issues.push('A jump sits on a tight turn. Test the approach carefully.');
  if(track.length<200||track.length>10000)issues.push('Keep circuit length between 200 m and 10 km.');
  const p=track.controlPoints;
  const cross=(a:number[],b:number[],c:number[])=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  for(let i=0;i<p.length;i++)for(let j=i+2;j<p.length;j++){
    if(i===0&&j===p.length-1)continue;
    const a=p[i],b=p[(i+1)%p.length],c=p[j],d=p[(j+1)%p.length];
    if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0){issues.push('The route crosses itself. Separate the turns; this editor does not create bridges.');return issues;}
  }
  return issues;
}
type StorageLike=Pick<Storage,'getItem'|'setItem'>;
export function loadLayout(id:CourseId,storage:StorageLike):TrackLayout|null {
  try{const all=JSON.parse(storage.getItem(LAYOUT_KEY)||'{}');const v=validateLayout(all[id]);return v.courseId===id?v:null;}catch{return null;}
}
export function saveLayout(layout:TrackLayout,storage:StorageLike){
  const valid=validateLayout(layout);let all:Record<string,TrackLayout>={};
  try{const parsed=JSON.parse(storage.getItem(LAYOUT_KEY)||'{}');for(const id of ids){try{const entry=validateLayout(parsed[id]);if(entry.courseId===id)all[id]=entry;}catch{}}}catch{}
  all[valid.courseId]=valid;storage.setItem(LAYOUT_KEY,JSON.stringify(all));
}
