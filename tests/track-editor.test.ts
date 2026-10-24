import test from 'node:test';
import assert from 'node:assert/strict';
import {Track} from '../src/track';
import {COURSES} from '../src/courses';
import {layoutFromTrack,validateLayout,layoutWarnings,loadLayout,saveLayout,LAYOUT_KEY} from '../src/track-layout';
import {makeRider,stepRider,npcControl} from '../src/physics';

test('every original circuit round-trips through editable world coordinates without rescaling or losing jumps',()=>{
  for(const c of COURSES){const original=new Track(c),layout=layoutFromTrack(original),edited=new Track(c,JSON.parse(JSON.stringify(layout)));
    assert.ok(Math.abs(edited.length-original.length)<.01,c.id);
    assert.equal(edited.jumps.length,original.jumps.length);
    for(const s of [0,35,330,original.length-5]){const a=original.at(s),b=edited.at(s);assert.ok(Math.hypot(a.x-b.x,a.z-b.z)<.02);assert.ok(Math.abs(original.height(s)-edited.height(s))<.02);}
    assert.deepEqual(layoutWarnings(edited),[]);
  }
});
test('moving turn points changes the route while jumps retain their relative lap position and physical ramp dimensions',()=>{
  const original=new Track(),layout=layoutFromTrack(original);layout.points[6][0]+=8;layout.jumps.push({position:.95,height:4,rise:18,flat:8,fall:30});const edited=new Track(original.course,layout);
  assert.notEqual(edited.length,original.length);assert.equal(edited.controlPoints[6][0],layout.points[6][0]);
  const jump=edited.jumps.at(-1)!;assert.equal(jump.start/edited.length,.95);assert.equal(jump.rise,18);assert.equal(jump.height,4);
  const noJump={...layout,jumps:layout.jumps.slice(0,-1)},ground=new Track(original.course,noJump);assert.ok(edited.height(jump.start+22)-ground.height(jump.start+22)>3.9);
});
test('layout import rejects malformed, huge, non-finite and degenerate geometry',()=>{
  const layout=layoutFromTrack(new Track());
  for(const mutate of [(l:any)=>l.version=2,(l:any)=>l.points=[],(l:any)=>l.points[1]=l.points[0],(l:any)=>l.points[1][0]=Infinity,(l:any)=>l.jumps[0].height=50,(l:any)=>l.jumps[0].position=-1,(l:any)=>l.jumps=Array(121).fill(l.jumps[0])]){const bad=structuredClone(layout);mutate(bad);assert.throws(()=>validateLayout(bad));}
  assert.throws(()=>new Track(COURSES[1],layout));
});
test('jump overlap including the finish seam is reported and an empty jump list is valid',()=>{
 const base=new Track(),layout=layoutFromTrack(base);layout.jumps=[{position:.99,height:3,rise:20,flat:0,fall:40},{position:.001,height:3,rise:10,flat:0,fall:20}];
 assert.match(layoutWarnings(new Track(base.course,layout)).join(' '),/overlap/);
 layout.jumps=[];assert.equal(new Track(base.course,layout).jumps.length,0);
});
test('saved layouts survive reload independently per course and corrupt storage is recoverable',()=>{
 let raw='broken';const store={getItem:()=>raw,setItem:(key:string,value:string)=>{assert.equal(key,LAYOUT_KEY);raw=value;}};
 assert.equal(loadLayout('dusk',store),null);
 const a=layoutFromTrack(new Track()),b=layoutFromTrack(new Track(COURSES[1]));saveLayout(a,store);saveLayout(b,store);
 assert.deepEqual(loadLayout('dusk',store),a);assert.deepEqual(loadLayout('canyon',store),b);assert.equal(loadLayout('alpine',store),null);
 const before=raw;assert.throws(()=>saveLayout({...a,name:''},store));assert.equal(raw,before);
 assert.throws(()=>saveLayout(a,{getItem:()=>raw,setItem:()=>{throw new Error('quota');}}),/quota/);
});
test('a reshaped saved circuit can complete a validated lap using ordinary riding physics',()=>{
 const original=new Track(),layout=layoutFromTrack(original);layout.points[6][0]+=3;const track=new Track(original.course,layout),rider=makeRider(track,0,false,0xffffff);
 for(let i=0;i<120*150&&rider.progress.lap<1;i++)stepRider(rider,npcControl(rider,track,[rider],'club'),track,1/120,[rider]);
 assert.equal(rider.progress.lap,1);assert.ok(Number.isFinite(rider.y));
});
