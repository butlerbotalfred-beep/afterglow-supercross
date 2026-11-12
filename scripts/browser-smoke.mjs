import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
// Game URL to test; set AFTERGLOW_URL when the dev server isn't on localhost:5173.
const BASE_URL = process.env.AFTERGLOW_URL || 'http://localhost:5173';
const cli = (args, input) =>
  execFileSync(
    'npm',
    [
      'exec',
      '--yes',
      '--package=agent-browser@0.27.0',
      '--',
      'agent-browser',
      '--session',
      'afterglow-verify',
      ...args,
    ],
    {encoding: 'utf8', input, timeout: 60000},
  );
const evaluate = source => {
  const out = cli(['--json', 'eval', '--stdin'], source);
  const parsed = JSON.parse(out);
  if (!parsed.success) throw new Error(out);
  return parsed.data.result;
};
const results = {date: new Date().toISOString(), checks: [], performance: []};
console.log(cli(['open', BASE_URL]));
cli(['set', 'viewport', '1440', '900']);
const stage1 = await evaluate(`(async()=>{
 const wait=ms=>new Promise(r=>setTimeout(r,ms)),g=window.__game;
 const assert=(v,m)=>{if(!v)throw new Error(m);};
 document.querySelector('#practice-mode').click();document.querySelector('#start').click();g.step(3.9);
 assert(g.snapshot().practice&&g.riders().length===1,'solo practice has no opponents');
 window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW'}));await wait(1100);window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyW'}));
 const speed=g.riders()[0].speed;assert(speed>8,'keyboard throttle');
 window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyS'}));await wait(450);window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyS'}));assert(g.riders()[0].speed<speed*.6,'keyboard brake');
 const heading=g.riders()[0].heading;window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyD'}));await wait(250);window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyD'}));assert(g.riders()[0].heading<heading,'keyboard steering');
 window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyR'}));await wait(50);window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyR'}));assert(g.riders()[0].recovery>1,'visible reset delay');
 const before=g.snapshot().raceTime;window.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape'}));await wait(100);window.dispatchEvent(new KeyboardEvent('keyup',{code:'Escape'}));assert(g.snapshot().paused,'keyboard pause');await wait(100);assert(g.snapshot().raceTime<before+.05,'shared pause freezes simulation');
 document.querySelector('#setup-pause').click();document.querySelector('#race-mode').click();document.querySelector('#laps').value='1';document.querySelector('#npcs').value='5';document.querySelector('#start').click();g.step(3.9);
 window.__driver=setInterval(()=>g.drive(0),8);g.clearPerf();await wait(10000);
 assert(!g.snapshot().riders[0].broken,'steering inputs follow validated course');assert(g.snapshot().riders[0].air>.4,'terrain jump');
 return {checks:['solo practice','keyboard throttle / brake / steering','checkpoint reset delay','keyboard shared pause','jump'],performance:g.snapshot(),environment:{userAgent:navigator.userAgent,dpr:devicePixelRatio,gpu:(()=>{const gl=document.querySelector('canvas').getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);})()}};
})()`);
results.checks.push(...stage1.checks);
results.performance.push(stage1.performance);
results.environment = stage1.environment;
cli(['screenshot', 'output/one-player.png']);
const stage2 = evaluate(`(async()=>{
 const wait=ms=>new Promise(r=>setTimeout(r,ms)),g=window.__game;const assert=(v,m)=>{if(!v)throw new Error(m);};clearInterval(window.__driver);
 for(let i=0;i<42000&&g.snapshot().phase!=='results';i++){g.drive(0);g.step(1/60);}
 assert(g.snapshot().phase==='results'&&g.riders()[0].finished!==null,'valid human finish and results');
 const finish=g.snapshot();document.querySelector('#restart-results').click();assert(g.riders().every(r=>r.progress.lap===0&&r.finished===null)&&g.snapshot().raceTime===0,'restart clean state');
 window.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape'}));await wait(80);window.dispatchEvent(new KeyboardEvent('keyup',{code:'Escape'}));assert(g.snapshot().paused,'countdown pause');
 document.querySelector('#setup-pause').click();
 window.__pads=Array.from({length:4},(_,i)=>({index:i,id:'Simulated pad '+(i+1),connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))}));Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>window.__pads});await wait(50);
 const select=(id,value)=>{const s=document.querySelector(id);s.value=value;s.dispatchEvent(new Event('change'));};
 for(const count of [2,3,4]){
   select('#humans',String(count));select('#npcs','0');
   for(let i=1;i<count;i++){select('[data-device="'+i+'"]','pad-'+(i-1));document.querySelector('[data-ready="'+i+'"]').click();}
   // Prior slots may already be ready; explicitly set all displayed slots to ready.
   for(const b of document.querySelectorAll('[data-ready]'))if(!b.classList.contains('is-ready'))b.click();
   document.querySelector('#start').click();g.step(3.9);await wait(80);
   assert(document.querySelectorAll('.viewport-hud').length===count,'viewport count '+count);
   if(count===2)assert(document.querySelectorAll('.viewport-hud')[1].style.top==='50%','two stacked viewports');
   if(count===3)assert(!!document.querySelector('#live-standings'),'three player info quadrant');
   assert(g.riders().length===count,'zero NPC grid '+count);
   if(count<4){document.querySelector('#pause-button').click();document.querySelector('#setup-pause').click();}
 }
 // Input one pad; no other rider may receive its throttle.
 window.__pads[0].buttons[7]={pressed:true,value:1};await wait(500);assert(g.riders()[1].speed>3&&g.riders()[0].speed===0&&g.riders()[2].speed===0,'one pad one rider');window.__pads[0].buttons[7]={pressed:false,value:0};
 window.__pads[1]=null;await wait(80);assert(g.snapshot().paused&&document.querySelector('#pause-message').textContent.includes('disconnected'),'disconnect pauses all riders');document.querySelector('#resume').click();assert(g.snapshot().paused,'cannot resume missing device');
 window.__pads[1]={index:1,id:'Simulated pad 2',connected:true,axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};await wait(80);document.querySelector('#resume').click();assert(!g.snapshot().paused,'reconnect resume');
 document.querySelector('#pause-button').click();document.querySelector('#setup-pause').click();select('#npcs','4');document.querySelector('#laps').value='3';document.querySelector('#start').click();g.step(3.9);
 window.__driver=setInterval(()=>{for(let i=0;i<4;i++)g.drive(i);},8);g.clearPerf();await wait(10000);
 return {checks:['human finishes validated race / results','clean restart','countdown pause','2 stacked views','3 views plus standings','4 view grid','zero NPCs at 2/3/4 players','independent simulated pad routing','controller disconnect / reconnect'],finish,performance:g.snapshot()};
})()`);
results.checks.push(...stage2.checks);
results.performance.push(stage2.performance);
results.finish = stage2.finish;
cli(['screenshot', 'output/four-player.png']);
const stage3 = evaluate(
  `(async()=>{const g=window.__game;clearInterval(window.__driver);for(let i=0;i<42000&&g.snapshot().phase!=='results';i++){for(let j=0;j<4;j++)g.drive(j);g.step(1/60);}if(g.snapshot().phase!=='results'||g.riders().filter(r=>r.human).some(r=>r.finished===null))throw new Error('all human finish');return g.snapshot();})()`,
);
results.checks.push('all four humans finish three validated laps');
results.fourFinish = stage3;
cli(['screenshot', 'output/results.png']);
const stage4 = evaluate(`(async()=>{
 const wait=ms=>new Promise(r=>setTimeout(r,ms)),g=window.__game;const assert=(v,m)=>{if(!v)throw new Error(m);};
 document.querySelector('#setup-results').click();
 const select=(id,value)=>{const s=document.querySelector(id);s.value=value;s.dispatchEvent(new Event('change'));};
 select('#humans','1');select('#npcs','0');select('[data-device="0"]','pad-0');document.querySelector('[data-ready="0"]').click();
 // Join three more distinct controllers through the actual setup polling path.
 for(let i=1;i<4;i++){window.__pads[i].buttons[0]={pressed:true,value:1};await wait(40);window.__pads[i].buttons[0]={pressed:false,value:0};await wait(40);}
 assert(document.querySelector('#humans').value==='4','gamepad join reaches four humans');
 document.querySelector('#laps').value='1';document.querySelector('#start').click();g.step(3.9);
 window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW'}));g.step(.5);window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyW'}));assert(g.riders().every(r=>r.speed===0),'unassigned keyboard controls no rider');
 window.__pads[2].buttons[7]={pressed:true,value:1};g.step(.5);window.__pads[2].buttons[7]={pressed:false,value:0};assert(g.riders()[2].speed>3&&g.riders()[0].speed===0,'four physical-index pad assignments');
 for(let i=0;i<21000&&g.snapshot().phase!=='results';i++){g.drive(0);g.step(1/60);}
 const state=g.snapshot();assert(state.phase==='results'&&g.riders()[0].finished!==null,'first human finishes');assert(g.riders().slice(1).every(r=>r.dnf),'timeout marks unfinished humans DNF');assert(state.raceTime-g.riders()[0].finished>=60,'finish timeout lasts sixty seconds');
 return {checks:['gamepad A join / ready','four simulated gamepads without keyboard','unassigned keyboard has no cross-control','60 second finish timeout / DNF'],snapshot:state};
})()`);
results.checks.push(...stage4.checks);
results.timeout = stage4.snapshot;
results.errors = cli(['errors']);
results.console = cli(['console']);
writeFileSync('output/browser-verification.json', JSON.stringify(results, null, 2));
console.log(
  JSON.stringify(
    {
      checks: results.checks,
      performance: results.performance.map(p => ({
        fps: p.fps,
        humans: p.humanCount,
        npcs: p.npcCount,
        resolution: p.resolution,
      })),
      errors: results.errors,
    },
    null,
    2,
  ),
);
cli(['close']);
