import test from 'node:test';
import assert from 'node:assert/strict';
import {COURSES} from '../src/courses.ts';
import {Track} from '../src/track.ts';
import {makeRider,stepRider,npcControl,collide} from '../src/physics.ts';
for(const course of COURSES.slice(1))test(`${course.name}: distinct terrain, separated lanes and four riders complete two laps`,context=>{
  const track=new Track(course);
  assert.ok(Math.abs(track.length-course.length)<.01);
  assert.ok(track.elevationRange>10&&track.jumps.length>=5);
  assert.ok(Math.abs(track.height(0)-track.height(track.length))<1e-8,'terrain is continuous at the lap seam');
  for(let i=0;i<track.count;i+=25)for(let j=i+50;j<track.count;j+=25){
    if(Math.min(j-i,track.count-(j-i))*track.length/track.count<25)continue;
    assert.ok(track.samples[i].distanceTo(track.samples[j])>16,'separate track corridors cannot overlap');
  }
  for(let s=0;s<track.length;s+=13){const p=track.at(s),q=track.project(p.x,p.z);const d=Math.abs(q.s-s);assert.ok(Math.min(d,track.length-d)<.01);assert.ok(Number.isFinite(track.height(s)));}
  const riders=Array.from({length:4},(_,i)=>makeRider(track,i,false,0xffffff));let recoveries=0,seconds=0;
  for(let frame=0;frame<120*500&&!riders.every(r=>r.progress.lap>=2);frame++){
    for(const r of riders){const previous=r.recovery;stepRider(r,npcControl(r,track,riders,'club'),track,1/120,riders);if(previous===0&&r.recovery>0)recoveries++;assert.ok([r.x,r.y,r.z,r.pitch,r.speed].every(Number.isFinite));}
    collide(riders,track);seconds=frame/120;
  }
  assert.ok(riders.every(r=>r.progress.lap>=2&&!r.progress.routeBroken),'all riders finish two validated laps');
  assert.equal(recoveries,0,'terrain is rideable without automatic recovery');
  context.diagnostic(`${seconds.toFixed(2)} seconds, ${track.jumps.length} jumps, ${track.elevationRange.toFixed(1)}m relief`);
});
