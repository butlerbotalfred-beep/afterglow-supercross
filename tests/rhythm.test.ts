import test from 'node:test';import assert from 'node:assert/strict';
import {Track} from '../src/track';import {COURSES} from '../src/courses';
import {makeRider,stepRider,npcControl,collide} from '../src/physics';

test('larger jumps fit inside the straight corridors with complete, nonoverlapping landings',()=>{
 for(const c of COURSES){const t=new Track(c),jumps=[...t.jumps].sort((a,b)=>a.start-b.start);
  assert.ok(Math.max(...jumps.map(j=>j.height))>=3.2);
  for(let i=0;i<jumps.length;i++){const j=jumps[i],end=j.start+j.rise+j.flat+j.fall;
   if(i+1<jumps.length)assert.ok(end<=jumps[i+1].start+.01,`${c.id}: a landing overlaps the next takeoff`);
   assert.ok(j.rise>=5&&j.fall>=7,'big jumps have long transitions');
   assert.ok(Math.abs(t.curvature(end+12))<.012,`${c.id}: landing exits into a turn too soon`);
  }
 }
 const dusk=new Track(),triple=dusk.rhythms.find(r=>r.name==='TRIPLE CROWN')!;
 assert.ok(triple);assert.equal(dusk.jumps.filter(j=>j.start>=triple.start&&j.start<triple.end).length,3,'Triple Crown contains three actual jumps');
});

test('eight Club riders complete the rebuilt stadium faster than the prior 352.45-second benchmark without crashes',context=>{
 const t=new Track(),riders=Array.from({length:8},(_,i)=>makeRider(t,i,false,0xffffff)),finish=new Map<number,number>();
 let recoveries=0,landings=0,f=0;
 for(;f<120*325&&finish.size<8;f++){
  for(const r of riders){const old=r.recovery;stepRider(r,npcControl(r,t,riders,'standard'),t,1/120,riders);if(!old&&r.recovery>0)recoveries++;if(r.lastLanding>0)landings++;if(r.progress.lap>=3&&!finish.has(r.id))finish.set(r.id,(f+1)/120);}
  collide(riders,t);
 }
 assert.equal(finish.size,8);assert.ok(Math.max(...finish.values())<325);assert.equal(recoveries,0);assert.equal(riders.reduce((sum,r)=>sum+r.crashes,0),0);assert.ok(landings>100);
 context.diagnostic(`8 riders: ${Math.max(...finish.values()).toFixed(2)} seconds, ${landings} landings, no crashes or recoveries`);
});
