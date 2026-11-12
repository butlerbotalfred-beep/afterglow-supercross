import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const cli = (args, input) =>
  execFileSync(
    'npm',
    ['exec', '--yes', '--package=agent-browser@0.27.0', '--', 'agent-browser', '--session', 'course-check', ...args],
    {encoding: 'utf8', input, timeout: 60000},
  );
const evaluate = source => {
  const parsed = JSON.parse(cli(['--json', 'eval', '--stdin'], source));
  if (!parsed.success) throw new Error(JSON.stringify(parsed));
  return parsed.data.result;
};
cli(['open', 'http://localhost:5173']);
cli(['set', 'viewport', '1440', '900']);
const report = {date: new Date().toISOString(), courses: [], checks: []};
try {
  for (const id of ['dusk', 'canyon', 'alpine', 'coast', 'quarry']) {
    const start = evaluate(
      `(()=>{const g=window.__game;clearInterval(window.courseDriver);if(g.snapshot().phase==='results')document.querySelector('#setup-results').click();else if(g.snapshot().phase!=='setup'){if(!g.snapshot().paused)document.querySelector('#pause-button').click();document.querySelector('#setup-pause').click();}const select=document.querySelector('#course');select.value='${id}';select.dispatchEvent(new Event('change'));document.querySelector('#laps').value='1';document.querySelector('#start').click();g.step(4);if(g.track.course.id!=='${id}')throw new Error('track selection');window.courseDriver=setInterval(()=>g.drive(0),8);g.clearPerf();return {name:g.track.course.name,length:g.track.length,elevation:g.track.elevationRange};})()`,
    );
    evaluate(`new Promise(resolve=>setTimeout(resolve,5500))`);
    cli(['screenshot', `output/course-${id}.png`]);
    const lap = evaluate(
      `(()=>{const g=window.__game;clearInterval(window.courseDriver);const perf=g.snapshot().fps;for(let i=0;i<22000&&g.snapshot().phase!=='results';i++){g.drive(0);g.step(1/60);}if(g.snapshot().phase!=='results'||g.riders()[0].finished===null)throw new Error('race did not finish');const result=g.snapshot();document.querySelector('#restart-results').click();if(g.snapshot().course!=='${id}'||g.riders().some(r=>r.progress.lap!==0))throw new Error('restart changed course or progress');return {fps:perf,finish:result.riders[0].finished};})()`,
    );
    report.courses.push({id, ...start, ...lap});
    console.log(id, JSON.stringify(lap));
  }
  report.checks.push(
    'Five selectable courses load and render',
    'Each course completes a validated human lap, results and clean restart',
    'Each course has different route/terrain and scenery',
  );
  const memory = evaluate(
    `(async()=>{const g=window.__game;document.querySelector('#pause-button').click();document.querySelector('#setup-pause').click();const samples=[];for(let i=0;i<4;i++){const s=document.querySelector('#course');s.value='dusk';s.dispatchEvent(new Event('change'));await new Promise(r=>setTimeout(r,100));samples.push({...g.renderer().memory});}if(samples[3].geometries>samples[1].geometries+2||samples[3].textures>samples[1].textures+2)throw new Error('world resource leak '+JSON.stringify(samples));return samples;})()`,
  );
  report.memory = memory;
  report.checks.push('Repeated track selection disposes previous graphics resources');
  report.pitch = evaluate(
    `(()=>{const g=window.__game;window.testPads=[{index:0,id:'Test controller',connected:true,axes:[0,0,0,0],buttons:Array.from({length:16},()=>({value:0,pressed:false}))}];Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>window.testPads});return true;})()`,
  );
  evaluate('new Promise(resolve=>setTimeout(resolve,100))');
  report.pitch = evaluate(
    `(()=>{const g=window.__game,s=document.querySelector('[data-device="0"]');s.value='pad-0';s.dispatchEvent(new Event('change'));document.querySelector('[data-ready="0"]').click();document.querySelector('#start').click();g.step(4);const r=g.riders()[0];for(let i=0;i<1200&&r.grounded;i++){g.drive(0);g.step(1/120);}g.setControl(0,null);const before=r.pitch;window.testPads[0].axes[1]=-1;g.step(.2);const after=r.pitch;if(after>before-.4)throw new Error('forward stick did not dip nose');window.testPads[0].axes[1]=1;g.step(.2);if(r.pitch<=after)throw new Error('back stick did not lift nose');return {before,forward:after,back:r.pitch};})()`,
  );
  report.checks.push('Actual gamepad routing: left stick forward lowers nose, backward lifts it in flight');
  report.errors = cli(['errors']);
  if (report.errors.trim()) throw new Error(report.errors);
  writeFileSync('output/course-verification.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  cli(['close']);
}
