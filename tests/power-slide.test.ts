import test from 'node:test';
import assert from 'node:assert/strict';
import {Track} from '../src/track';
import {makeRider,stepRider,idleControl,crash,recover} from '../src/physics';
import {mapGamepad,type Control} from '../src/input';
import {angleDelta} from '../src/config';
// A flat surface isolates grip and yaw from jump takeoffs and bank changes.
class FlatTrack extends Track {override height(_s:number,_lateral=0){return 0;}}
const track=new FlatTrack(),dt=1/120;
function rider(){const r=makeRider(track,0,true,0xffffff),p=track.at(100);Object.assign(r,{x:p.x,z:p.z,y:0,surface:p,heading:Math.atan2(p.tx,p.tz),speed:16});return r;}
function stick(x:number,y:number,throttle=1,brake=0){return mapGamepad({index:0,id:'Xbox',axes:[x,y,0,0],buttons:Array.from({length:10},(_,i)=>({value:i===7?throttle:i===6?brake:0}))});}
function run(r:ReturnType<typeof rider>,control:Control,frames=40){for(let n=0;n<frames;n++)stepRider(r,control,track,dt,[r]);}
test('lower-left and lower-right diagonals dip the nose and pivot with real sideways rear slip',()=>{
 const outcomes=[];
 for(const side of [-1,1]){
  const slide=rider(),grip=rider(),heading=slide.heading,control=stick(side*.75,.65),normal=stick(side*.75,0);
  run(slide,control);run(grip,normal);
  assert.ok(slide.powerSlide>.35);assert.ok(slide.pitch<grip.pitch-.025,'visible forward load');
  assert.ok(Math.abs(angleDelta(slide.heading,heading))>Math.abs(angleDelta(grip.heading,heading))+.04,'tighter pivot');
  assert.ok(slide.slipAngle*control.steer>0&&Math.abs(slide.slipAngle)>.1,'rear steps opposite the turn');
  const travel=Math.atan2(slide.x-slide.prevX,slide.z-slide.prevZ);
  assert.ok(Math.abs(angleDelta(slide.heading,travel)-slide.slipAngle)<1e-8,'travel and bike headings diverge');
  assert.ok(slide.grounded&&slide.speed>10&&slide.crashTime===0);
  outcomes.push(Math.abs(slide.slipAngle));
 }
 assert.ok(Math.abs(outcomes[0]-outcomes[1])<1e-8,'left/right slide response is symmetric');
});
test('normal steering, forward diagonals, back-only and no throttle do not start a power slide',()=>{
 for(const c of [stick(.75,0),stick(.75,-.65),stick(0,1),stick(.2,.8),stick(.75,.65,0)]){
  const r=rider();run(r,c,20);assert.equal(r.powerSlide,0);assert.equal(r.slipAngle,0);
 }
 const stationary=rider();stationary.speed=0;run(stationary,stick(.75,.65),1);assert.equal(stationary.powerSlide,0);
});
test('releasing the gesture smoothly regains grip and recovery/crashes clear slide state',()=>{
 const r=rider();run(r,stick(.75,.65));const before=r.slipAngle;
 run(r,idleControl(),1);assert.ok(Math.abs(r.slipAngle)<Math.abs(before)&&Math.abs(r.slipAngle)>0);
 run(r,idleControl(),70);assert.ok(r.powerSlide<.001&&Math.abs(r.slipAngle)<.005);
 r.powerSlide=.8;r.slipAngle=.3;crash(r,'TEST');assert.equal(r.powerSlide,0);assert.equal(r.slipAngle,0);
 r.powerSlide=.8;r.slipAngle=.3;recover(r,track,[r]);assert.equal(r.powerSlide,0);assert.equal(r.slipAngle,0);
});
test('the same lower diagonal still lifts the nose in flight with no slide or boosted airborne yaw',()=>{
 const r=rider(),neutral=rider();for(const p of [r,neutral]){p.grounded=false;p.y=12;p.vy=0;}
 r.powerSlide=.7;r.slipAngle=.3;
 run(r,stick(.75,.65),24);run(neutral,stick(.75,0),24);
 assert.equal(r.powerSlide,0);assert.equal(r.slipAngle,0);assert.ok(r.pitch>neutral.pitch+.2);
 assert.ok(Math.abs(r.heading-neutral.heading)<1e-8);
});
test('aggression progressively scales rear slip and pivot; zero disables the slide',()=>{
 const outcomes=[];
 for(const aggression of [0,.5,1,1.5,2]){
  const r=rider(),heading=r.heading,c=stick(.75,.65);
  for(let n=0;n<40;n++)stepRider(r,c,track,dt,[r],aggression);
  outcomes.push({slip:Math.abs(r.slipAngle),yaw:Math.abs(angleDelta(r.heading,heading))});
  assert.ok(Number.isFinite(r.x)&&r.grounded&&r.crashTime===0);
  if(aggression===0){assert.equal(r.powerSlide,0);assert.equal(r.slipAngle,0);}
 }
 for(let n=1;n<outcomes.length;n++){assert.ok(outcomes[n].slip>outcomes[n-1].slip);assert.ok(outcomes[n].yaw>outcomes[n-1].yaw);}
});
test('changing aggression mid-slide adjusts grip without resetting the rider; air handling is unaffected',()=>{
 const r=rider();run(r,stick(.75,.65));const before=r.slipAngle;
 stepRider(r,stick(.75,.65),track,dt,[r],0);
 assert.ok(Math.abs(r.slipAngle)<Math.abs(before));assert.equal(r.recovery,0);
 const air=[];
 for(const aggression of [0,1,2]){const a=rider();a.grounded=false;a.y=12;a.vy=0;for(let n=0;n<24;n++)stepRider(a,stick(.75,.65),track,dt,[a],aggression);air.push([a.pitch,a.heading]);}
 assert.deepEqual(air[0],air[1]);assert.deepEqual(air[1],air[2]);
});

test('braking into either turn produces stronger rear slip and pivot than the throttle slide',()=>{
 for(const side of [-1,1]){
  const braking=rider(),power=rider();braking.speed=power.speed=24;
  const heading=braking.heading;
  run(braking,stick(side*.75,0,0,1),24);run(power,stick(side*.75,.65),24);
  assert.ok(Math.abs(braking.slipAngle)>Math.abs(power.slipAngle)*1.5,'stronger rear step-out without throttle');
  assert.ok(Math.abs(angleDelta(braking.heading,heading))>Math.abs(angleDelta(power.heading,heading)), 'stronger turn pivot');
  assert.ok(braking.pitch<power.pitch-.025,'front loads under braking');
  assert.ok(braking.speed<power.speed&&braking.grounded&&braking.crashes===0);
 }
});
test('brake slides respond progressively to trigger pressure and the aggression setting',()=>{
 for(const parameter of ['brake','aggression']){
  const slips=[];
  for(const value of [0,.5,1]){
   const r=rider();r.speed=24;
   const c=stick(.75,0,0,parameter==='brake'?value:1);
   for(let i=0;i<24;i++)stepRider(r,c,track,dt,[r],parameter==='aggression'?value*2:1);
   slips.push(Math.abs(r.slipAngle));
  }
  assert.equal(slips[0],0);assert.ok(slips[1]>0&&slips[2]>slips[1]);
 }
 const straight=rider();run(straight,stick(0,0,0,1),24);assert.equal(straight.slipAngle,0);
 const stopped=rider();run(stopped,stick(.75,0,0,1),240);
 assert.equal(stopped.speed,0);assert.ok(stopped.powerSlide<.001&&Math.abs(stopped.slipAngle)<.001);
});
test('stronger ground braking shortens the stop while preserving airborne horizontal speed',()=>{
 const r=rider();r.speed=30;let distance=0,oldSpeed=30,oldDistance=0;
 for(let i=0;i<180;i++){
  stepRider(r,stick(0,0,0,1),track,dt,[r]);distance+=Math.hypot(r.x-r.prevX,r.z-r.prevZ);
  oldSpeed=Math.max(0,oldSpeed-(24+.34*oldSpeed)*dt);oldDistance+=oldSpeed*dt;
 }
 assert.equal(r.speed,0);assert.ok(distance<oldDistance*.75,`new ${distance}m vs old ${oldDistance}m`);
 assert.equal(r.crashes,0);assert.equal(r.recovery,0);
 const brake=rider(),coast=rider();for(const a of [brake,coast]){a.grounded=false;a.y=12;}
 run(brake,stick(.75,0,0,1),24);run(coast,stick(.75,0,0,0),24);
 assert.equal(brake.speed,coast.speed);assert.equal(brake.heading,coast.heading);assert.equal(brake.slipAngle,0);
 assert.ok(brake.pitch<coast.pitch,'air brake retains nose-down torque');
});
