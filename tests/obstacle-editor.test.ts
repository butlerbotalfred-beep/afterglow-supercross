import test from 'node:test';
import assert from 'node:assert/strict';
import {Track} from '../src/track';
import {layoutFromTrack,replaceObstacle,obstacleLength,obstacleSpacing,moveObstacleToGap,validateLayout,saveLayout,loadLayout} from '../src/track-layout';
const jump=(position:number)=>({position,height:3,rise:10,flat:0,fall:20});
test('spacing is measured edge-to-edge around the finish seam and moves only the selected obstacle',()=>{
 const jumps=[jump(.05),jump(.3),jump(.9)],before=structuredClone(jumps);
 assert.deepEqual(obstacleSpacing(jumps,0,1000),{previous:2,next:1,before:120,after:220});
 jumps[0].position=moveObstacleToGap(jumps,0,1000,'before',20);
 assert.equal(jumps[0].position,.95);assert.equal(obstacleSpacing(jumps,0,1000)!.before,20);
 assert.deepEqual(jumps.slice(1),before.slice(1));
 jumps[0].position=moveObstacleToGap(jumps,0,1000,'after',40);
 assert.equal(obstacleSpacing(jumps,0,1000)!.after,40);
 assert.throws(()=>moveObstacleToGap(jumps,0,1000,'after',900),/available/);
 assert.equal(obstacleSpacing([jump(.1)],0,1000),null);
});
test('double, triple and whoops replacements produce real grouped mounds and preserve marked location',()=>{
 const original=new Track(),layout=layoutFromTrack(original);const ground=new Track(original.course,{...layout,jumps:[]});layout.jumps=[{...jump(.1),highlight:true}];
 for(const [type,count] of [['double',2],['triple',3],['whoops',6]] as const){
  const j=replaceObstacle(layout.jumps[0],type);layout.jumps=[j];const track=new Track(original.course,layout);
  assert.equal(track.obstacles.length,1);assert.equal(track.jumps.length,count);assert.equal(j.position,.1);assert.equal(j.highlight,true);
  for(const mound of track.jumps)assert.ok(Math.abs(track.height(mound.start+mound.rise)-ground.height(mound.start+mound.rise)-j.height)<.02);
  assert.equal(obstacleLength(j),count*(j.rise+j.flat+j.fall)+(count-1)*(j.gap||0));
  assert.deepEqual(layoutFromTrack(track).jumps,layout.jumps);
 }
});
test('grouped obstacle across finish seam retains all of its physical ramps',()=>{
 const base=new Track(),layout=layoutFromTrack(base);layout.jumps=[replaceObstacle({...jump(.99)},'triple')];const track=new Track(base.course,layout);
 assert.equal(track.jumps.length,3);assert.ok(track.jumps[1].start<track.jumps[0].start);
 for(const j of track.jumps)assert.ok(track.height(j.start+j.rise)>3);
});
test('marked replacements persist, old layouts load, and malformed group settings are rejected',()=>{
 const layout=layoutFromTrack(new Track());assert.doesNotThrow(()=>validateLayout(layout));
 layout.jumps[0]=replaceObstacle({...layout.jumps[0],highlight:true},'double');let raw='';const storage={getItem:()=>raw,setItem:(_k:string,v:string)=>{raw=v;}};saveLayout(layout,storage);assert.deepEqual(loadLayout('dusk',storage),layout);
 for(const mutation of [{type:'unknown'},{gap:-1},{gap:Infinity},{highlight:'yes'}]){const bad=structuredClone(layout);Object.assign(bad.jumps[0],mutation);assert.throws(()=>validateLayout(bad));}
 const bad=structuredClone(layout);bad.jumps=Array(41).fill(replaceObstacle(jump(.1),'whoops'));assert.throws(()=>validateLayout(bad),/240/);
});
