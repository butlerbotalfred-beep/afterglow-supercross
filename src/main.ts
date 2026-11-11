import {MenuPad,MenuFocus,type MenuEvent} from './menu-controller';
import {loadSlideAggression,normalizeSlideAggression,SLIDE_AGGRESSION_KEY} from './handling-settings';
import {obstacleMarker} from './track-markers';
import {obstacleLength,obstacleType} from './track-layout';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow/700.css';
import '@fontsource/barlow/800.css';
import '@fontsource/barlow-condensed/800-italic.css';
import '@fontsource/barlow-condensed/900-italic.css';
import '@fontsource/barlow-condensed/700.css';
import * as THREE from 'three';
import './style.css';
import {Track} from './track';
import {TrackEditor} from './track-editor';
import {layoutFromTrack,loadLayout,saveLayout,type TrackLayout} from './track-layout';
import {COURSES,courseById} from './courses';
import {disposeWorld} from './scenery';
import {createWorld,focusRaceShadows} from './world';
import {createBike} from './bike-model';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {RaceEffects} from './race-effects';
import {ChaseCamera} from './camera';
import {GameAudio} from './audio';
import {Dust} from './dust';
import {TouchControls} from './touch-controls';
import type {TouchDirection} from './touch-input';
import {startNativeController,stopNativeController,nativeControllerStatus} from './native-controller';
import {InputManager,type GamepadLike,type Device,type Control,uniqueDevices,readBrowserGamepads,readGamepadStatus,controllerJoinSlot} from './input';
import {makeRider,stepRider,collide,npcControl,idleControl,type Rider} from './physics';
import {progressDistance} from './race';
import {TUNING,COLORS,CSS_COLORS,clamp} from './config';
import {blendPose,capturePose,pacingStats,type Pose} from './render-interp';

const reviewEnabled=import.meta.env.DEV&&new URLSearchParams(location.search).has('review');
let reviewDrive=false,reviewFrozen=false,reviewCrashTest='';
type Phase='setup'|'countdown'|'racing'|'results';
const app=document.querySelector<HTMLDivElement>('#app')!;
function directionSettings(prefix = '') {
  return `<div id="${prefix}touch-directions" class="touch-directions hidden"><div class="options-grid"><label>TOUCH STEERING<select id="${prefix}touch-steering"><option value="regular">Regular</option><option value="inverted">Inverted</option></select></label><label>AIR PITCH<select id="${prefix}touch-pitch"><option value="regular">Regular</option><option value="inverted">Inverted</option></select></label></div><p class="touch-direction-hint">Left turns left. Drag up to lift the nose.</p></div>`;
}
function slideSettings(prefix=''){
  return `<div class="slide-setting"><label for="${prefix}slide-aggression">Power-slide aggression <output id="${prefix}slide-value" for="${prefix}slide-aggression">100%</output></label><input id="${prefix}slide-aggression" type="range" min="0" max="200" step="10" value="100" aria-describedby="${prefix}slide-help"><p id="${prefix}slide-help">0% off · 100% standard · 200% aggressive<br>Adjusts throttle and brake slides. Applies immediately.</p></div>`;
}
app.innerHTML=`<canvas id="game" aria-label="Supercross game"></canvas>
<div id="setup" class="screen"><header><a class="wordmark" href="#">A<span>FTERGLOW</span><i>®</i></a><div class="header-meta">STADIUM SERIES <span><span id="header-course">01 / DUSK VALLEY</span></span></div><span id="build-stamp" class="build-stamp" title="Commit this build was made from">BUILD ${__BUILD_STAMP__}</span><button id="sound" class="icon-button" title="Toggle sound">SOUND ON</button></header>
<div class="setup-content"><section class="hero"><div class="eyebrow"><span class="live-dot"></span> LOCAL MULTIPLAYER / 1–4 RIDERS</div><h1>CHASE THE<br><em>AFTERGLOW.</em></h1><p>Gate drops. Lights rise. Find your rhythm.</p><div class="track-meta"><span><b>05</b> TRACKS</span><span><b id="track-sectors">—</b> SECTIONS</span><span><b id="track-length">—</b> METRES</span></div></section>
<section class="setup-card"><div class="card-heading"><span class="eyebrow">YOUR NEXT RIDE</span><span class="tag">LOCAL SESSION</span></div><div class="mode-tabs"><button id="race-mode" class="active">RACE NIGHT</button><button id="practice-mode">FREE PRACTICE</button></div>
<label class="course-label">CIRCUIT<select id="course">${COURSES.map(c=>`<option value="${c.id}">${c.name}</option>`).join('')}</select></label><p id="course-description" class="course-description"></p><div class="layout-actions"><label>TRACK LAYOUT<select id="track-layout"><option value="original">Original circuit</option><option value="custom">My saved layout</option></select></label><button id="open-editor" type="button">EDIT TRACK ↗</button></div><label class="play-device-label">PLAY ON<select id="play-device"><option value="desktop">Mac / Keyboard & gamepads</option><option value="iphone">iPhone / Touch controls</option></select></label><p id="touch-setup-hint" class="touch-setup-hint hidden">One rider + optional NPCs. Use landscape. Left thumb steers and adjusts air pitch; right thumb controls gas and brake. Hold NOSE DOWN over a jump to match the landing.</p>${directionSettings()}<div class="options-grid"><label>HUMAN RIDERS<select id="humans"><option value="1">01 / Solo</option><option value="2">02 / Split screen</option><option value="3">03 / Three riders</option><option value="4">04 / Full grid view</option></select></label><label>NPC RIDERS<select id="npcs"></select></label><label>RACE LENGTH<select id="laps"><option value="1">1 lap / Sprint</option><option value="3" selected>3 laps / Standard</option><option value="5">5 laps / Endurance</option></select></label><label>NPC PACE<select id="difficulty"><option value="relaxed">Relaxed</option><option selected value="club">Club</option><option value="expert">Expert</option></select></label></div>
<div class="riders-label"><span>RIDERS & DEVICES</span><span>GAMEPAD A / × TO USE / READY</span></div><div id="slots"></div><div id="controller-connection"><button type="button" id="connect-controller">USE CONTROLLER</button><span id="controller-status" role="status"></span></div><p id="setup-status" class="status-text"></p><button id="start" class="primary">DROP THE GATE <span>↗</span></button>
<details><summary>CONTROLS & RIDE SETTINGS <span>+</span></summary><div class="controls"><div><b>KEYBOARD</b><span>W / ↑ Throttle · S / ↓ Brake<br>A D / ← → Steer · Q / Space Nose down · E Nose up<br>R Recover · Esc / P Pause · M Mute</span></div><div><b>GAMEPAD</b><span>RT Throttle · LT Brake · Left stick Steer<br>In air: left stick ↑ Nose down · ↓ Nose up<br>On dirt: roll left/right toward ↓ + RT to power slide<br>Steer + LT for a stronger brake slide<br>B Recover<br>Menu Pause · A Join / Ready</span></div></div><p class="ride-tip">Match the rhythm pace before a jump, then dip the nose to meet the landing. Crashes remount at the wreck. Short track exits are forgiven; gaining over 30 m outside returns you to where you left.</p>${slideSettings()}<div class="settings"><label>Chase distance <input id="camera-distance" type="range" min="2.5" max="6" step=".1" value="3.2"></label><label>Camera shake <input id="camera-shake" type="range" min="0" max="1" step=".05" value=".15"></label><label>Render scale<select id="render-scale"><option value="1">100%</option><option value="0.75">75%</option><option value="0.5">50%</option></select></label></div></details></section></div><footer><span>PURE DIRT. SHARED SCREEN.</span><span>PROCEDURAL CIRCUIT <i>✦</i> NO TWO LAPS ALIKE</span><span>BUILD 01.0</span></footer></div>
<div id="hud" class="hidden"></div><div id="race-bar" class="hidden"><span id="session-label">DUSK VALLEY / RACE NIGHT</span><span id="race-time">00:00.0</span><button id="pause-button">Ⅱ PAUSE</button><button id="race-mute">♪ SOUND ON</button></div><div id="countdown" class="hidden"></div>
<div id="pause" class="modal hidden"><div class="modal-card"><div class="eyebrow">EVERY RIDER. ONE RACE.</div><h2>TAKE A BREATHER.</h2><p id="pause-message">The shared race is paused.</p><button id="resume" class="primary">BACK TO THE DIRT <span>↗</span></button><div class="button-row"><button id="restart-pause">RESTART RACE</button><button id="setup-pause">RACE SETUP</button></div><button id="pause-editor">EDIT THIS TRACK</button>${directionSettings('pause-')}${slideSettings('pause-')}<label class="pause-setting">Chase distance <input id="pause-distance" type="range" min="2.5" max="6" step=".1" value="3.2"></label><label class="pause-setting">Camera shake <input id="pause-shake" type="range" min="0" max="1" step=".05" value=".15"></label></div></div>
<div id="results" class="modal hidden"><div class="modal-card results-card"><div class="eyebrow">DUSK VALLEY / OFFICIAL CLASSIFICATION</div><h2>THAT’S A WRAP.</h2><p id="results-subtitle"></p><div id="results-table"></div><button id="restart-results" class="primary">ONE MORE RIDE <span>↗</span></button><button id="setup-results" class="text-button">RETURN TO SETUP</button></div></div>`;
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const renderer=new THREE.WebGLRenderer({canvas:el<HTMLCanvasElement>('game'),antialias:true,powerPreference:'high-performance'});
renderer.shadowMap.enabled=true;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.type=THREE.PCFShadowMap;renderer.setClearColor('#716d8e');renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;
const environmentScene=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer);
const environment=pmrem.fromScene(environmentScene,.06);environmentScene.dispose();pmrem.dispose();renderer.autoClear=false;
function lightWorld(world:THREE.Scene){world.environment=environment.texture;world.environmentIntensity=.45;return world;}
let track=new Track(),scene=lightWorld(createWorld(track));
let reviewPad:GamepadLike|null=null;
const menuGamepads=()=>reviewPad?[reviewPad]:readBrowserGamepads();
const input=new InputManager(undefined,menuGamepads,()=>touchControls.input.read()),audio=new GameAudio();
el('track-length').textContent=String(Math.round(track.length));
el('track-sectors').textContent=String(track.sections.filter(s=>!s.name.startsWith('BERM')).length);
const touchControls=new TouchControls(app,()=>togglePause());
let dust=new Dust(scene);
const effects=new RaceEffects(renderer);
let sceneDrawCalls=0;
const preview=new THREE.PerspectiveCamera(58,1,.1,1800);
let iphoneMode=false;
let phase:Phase='setup',paused=false,practice=false,humanCount=1,npcCount=5,lapCount=3,difficulty='club';
let slideAggression=1;try{slideAggression=loadSlideAggression(localStorage);}catch{}
let raceTime=0,countdown=3.8,firstFinish:number|null=null,cameraDistance:number=TUNING.cameraDistance,cameraShake:number=TUNING.cameraShake,renderScale=1;
let assignments:(Device|null)[]=[{kind:'keyboard'},null,null,null],ready=[true,false,false,false];
let riders:Rider[]=[],models:ReturnType<typeof createBike>[]=[],cameras:ChaseCamera[]=[];
let viewHud:HTMLElement[]=[],fpsFrames:number[]=[],lastHud=0,globalTime=0,lastTickSound=4,accumulator=0;
let prevPoses:Pose[]=[],stepCounts:number[]=[];
let lastPadSignature='',padButtons=new Map<number,boolean>(),override=new Map<number,Control>();
let frameCount=0;
let activeLayout:TrackLayout|null=null;
let testMarkers=new THREE.Group();scene.add(testMarkers);
const editor=new TrackEditor((layout,ride)=>{
  saveLayout(layout,localStorage); // Throw before changing the race if browser storage fails.
  activeLayout=layout;el<HTMLSelectElement>('track-layout').value='custom';
  rebuildTrack(new Track(courseById(layout.courseId),layout));
  setVisible('setup',true);
  if(ride){setMode(true);startRace();}
},()=>setVisible('setup',true));
function openEditor(){
  reviewDrive=false;reviewFrozen=false;reviewCrashTest='';toSetup();
  setVisible('setup',false);editor.open(activeLayout||layoutFromTrack(track));
}
function rebuildTrack(next:Track){
  touchControls.clear();override.clear();disposeWorld(scene);models=[];
  track=next;scene=lightWorld(createWorld(track));dust=new Dust(scene);
  testMarkers=new THREE.Group();track.obstacles.forEach((j,i)=>{if(j.highlight)testMarkers.add(obstacleMarker(track,i,true));});testMarkers.visible=false;scene.add(testMarkers);
  describeCourse();buildGrid();renderer.renderLists.dispose();
}
function layoutChoice(){
  const stored=loadLayout(track.course.id,localStorage);
  el<HTMLOptionElement>('track-layout').querySelector<HTMLOptionElement>('option[value="custom"]')!.disabled=!stored;
  el<HTMLSelectElement>('track-layout').value=activeLayout?'custom':'original';
}

function sameDevice(a:Device|null,b:Device|null){return a&&b&&a.kind===b.kind&&(a.kind!=='gamepad'||b.kind==='gamepad'&&a.index===b.index);}
function deviceValue(d:Device|null){return !d?'':d.kind!=='gamepad'?d.kind:`pad-${d.index}`;}
function deviceLabel(d:Device|null){return !d?'Unassigned':d.kind==='keyboard'?'KEYBOARD':d.kind==='touch'?'IPHONE / TOUCH':`GAMEPAD ${d.index>=1000?d.index-999:d.index+1}`;}
function setVisible(id:string,show:boolean){el(id).classList.toggle('hidden',!show);}
function refreshNpcOptions(){const s=el<HTMLSelectElement>('npcs');npcCount=practice?0:Math.min(npcCount,8-humanCount);s.innerHTML=Array.from({length:9-humanCount},(_,i)=>`<option value="${i}">${i===0?'None / Humans only':String(i).padStart(2,'0')+' opponents'}</option>`).join('');s.value=String(npcCount);s.disabled=practice;}
function refreshSlots(){
  const pads=input.connectedGamepads();
  el('slots').innerHTML=Array.from({length:humanCount},(_,i)=>`<div class="player-slot" style="--player:${CSS_COLORS[i]}"><span class="player-badge">P${i+1}</span><select aria-label="Player ${i+1} input device" data-device="${i}"><option value="">Connect a controller</option><option value="keyboard">Keyboard / WASD</option>${iphoneMode?'<option value="touch">iPhone / Touch controls</option>':''}${pads.map(p=>`<option value="pad-${p.index}">Gamepad ${p.index>=1000?p.index-999:p.index+1} / ${p.id.replace(/[<>&"]/g,'').slice(0,24)}</option>`).join('')}</select><button class="ready ${ready[i]?'is-ready':''}" data-ready="${i}">${ready[i]?'✓ READY':'READY?'}</button></div>`).join('');
  el('slots').querySelectorAll<HTMLSelectElement>('[data-device]').forEach(s=>{const i=Number(s.dataset.device);s.value=deviceValue(assignments[i]);s.disabled=iphoneMode;s.onchange=()=>{const value=s.value;const d:Device|null=value==='keyboard'?{kind:'keyboard'}:value==='touch'?{kind:'touch'}:value?{kind:'gamepad',index:Number(value.split('-')[1])}:null;for(let j=0;j<4;j++)if(j!==i&&sameDevice(assignments[j],d)){assignments[j]=null;ready[j]=false;}assignments[i]=d;ready[i]=false;refreshSlots();};});
  el('slots').querySelectorAll<HTMLButtonElement>('[data-ready]').forEach(b=>b.onclick=()=>{const i=Number(b.dataset.ready);if(assignments[i])ready[i]=!ready[i];refreshSlots();});
  const valid=uniqueDevices(assignments.slice(0,humanCount).filter(Boolean) as Device[]).length===humanCount&&assignments.slice(0,humanCount).every((d,i)=>d&&ready[i]&&(d.kind!=='gamepad'||pads.some(p=>p.index===d.index)));
  el<HTMLButtonElement>('start').disabled=!valid;
  el('setup-status').textContent=valid?'All riders ready. See you at the gate.':'Assign a unique device and ready each rider. Press a gamepad button to connect.';
}
function buildGrid(){
  for(const m of models){scene.remove(m.root);m.root.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();(Array.isArray(o.material)?o.material:[o.material]).forEach(mat=>{for(const v of Object.values(mat))if(v instanceof THREE.Texture&&!v.userData.persistent)v.dispose();mat.dispose();});}});}
  riders=Array.from({length:humanCount+(practice?0:npcCount)},(_,i)=>makeRider(track,i,i<humanCount,COLORS[i],i<humanCount?assignments[i]||undefined:undefined));
  const names=['S. MORA','J. REYES','K. NOVA','A. RIVERS','T. FOX','R. VALE','M. PARK'];
  riders.forEach((r,i)=>{if(!r.human)r.name=names[(i-humanCount)%names.length];});
  models=riders.map(r=>{const m=createBike(r.color,r.id+1);scene.add(m.root);return m;});cameras=Array.from({length:humanCount},()=>new ChaseCamera());syncModels(0);
}
function views(){
  if(humanCount===1)return[{x:0,y:0,w:1,h:1}];
  if(humanCount===2)return[{x:0,y:0,w:1,h:.5},{x:0,y:.5,w:1,h:.5}];
  return[{x:0,y:0,w:.5,h:.5},{x:.5,y:0,w:.5,h:.5},{x:0,y:.5,w:.5,h:.5},{x:.5,y:.5,w:.5,h:.5}].slice(0,humanCount);
}
function buildHud(){
  el('hud').innerHTML=views().map((v,i)=>`<section class="viewport-hud ${humanCount>1?'compact':'solo'}" style="left:${v.x*100}%;top:${v.y*100}%;width:${v.w*100}%;height:${v.h*100}%;--player:${CSS_COLORS[i]}"><div class="hud-top"><div class="position"><small>POS</small><strong>01<span>/ ${riders.length}</span></strong></div><span class="identity">P${i+1}<small>${deviceLabel(assignments[i])}</small></span><div class="lap">LAP <b>1</b><small>/ ${practice?'∞':lapCount}</small></div></div><div class="rider-notice"></div><div class="test-target"></div><div class="hud-bottom"><div class="mini-map"><canvas width="150" height="130"></canvas><span class="sector">FINISH STRAIGHT</span></div><div class="speed"><strong>00</strong><small>KM/H</small><div class="speed-track"><i></i></div></div></div></section>`).join('')+(humanCount===3?'<section class="race-info"><div class="eyebrow">LIVE / RACE NIGHT</div><h2>RACE NIGHT.</h2><div id="live-standings"></div><small>R / B to recover · Esc / Menu to pause</small></section>':'');
  viewHud=[...el('hud').querySelectorAll<HTMLElement>('.viewport-hud')];
}
function startRace(){
  humanCount=Number(el<HTMLSelectElement>('humans').value);npcCount=Number(el<HTMLSelectElement>('npcs').value);lapCount=Number(el<HTMLSelectElement>('laps').value);difficulty=el<HTMLSelectElement>('difficulty').value;
  if(!assignments.slice(0,humanCount).every(Boolean)||uniqueDevices(assignments.slice(0,humanCount) as Device[]).length!==humanCount)return;
  testMarkers.visible=practice;
  touchControls.clear();document.body.classList.toggle('iphone-session',iphoneMode);buildGrid();buildHud();raceTime=0;countdown=3.8;firstFinish=null;paused=false;phase='countdown';lastTickSound=4;accumulator=0;prevPoses=[];override.clear();
  setVisible('setup',false);setVisible('results',false);setVisible('pause',false);setVisible('hud',true);setVisible('race-bar',true);setVisible('countdown',true);touchControls.show(iphoneMode);audio.start();
  el('session-label').textContent=`${(track.customName||track.course.name).toUpperCase()} / ${practice?'FREE PRACTICE':'RACE NIGHT'}`;el('countdown').innerHTML='<small>FIND YOUR LINE</small><strong>3</strong>';updateHud();
}
function toSetup(){testMarkers.visible=false;reviewCrashTest='';touchControls.show(false);document.body.classList.remove('iphone-session');phase='setup';paused=false;audio.update(0,0,false);['hud','pause','results','countdown','race-bar'].forEach(id=>setVisible(id,false));setVisible('setup',true);refreshSlots();}
function missingController(){if(reviewDrive)return;const pads=input.connectedGamepads();return riders.find(r=>r.human&&r.device?.kind==='gamepad'&&!pads.some(p=>r.device?.kind==='gamepad'&&p.index===r.device.index));}
function togglePause(){if(phase==='setup'||phase==='results')return;const missing=missingController();if(paused&&missing)return;paused=!paused;touchControls.show(iphoneMode&&!paused);setVisible('pause',paused);el('pause-message').textContent=missing?`Player ${missing.id+1}'s controller disconnected. Reconnect it to resume, or return to setup.`:'The shared race is paused for every rider.';audio.update(0,0,false);}
function ranking(){return [...riders].sort((a,b)=>a.finished!==null&&b.finished!==null?a.finished-b.finished:a.finished!==null?-1:b.finished!==null?1:progressDistance(b.progress,track.length)-progressDistance(a.progress,track.length));}
function formatTime(t:number){return `${Math.floor(t/60).toString().padStart(2,'0')}:${(t%60).toFixed(1).padStart(4,'0')}`;}
function endRace(){touchControls.show(false);phase='results';riders.forEach(r=>r.dnf=r.finished===null);setVisible('results',true);setVisible('countdown',false);audio.update(0,0,false);el('results').querySelector('.eyebrow')!.textContent=track.course.name.toUpperCase()+' / OFFICIAL CLASSIFICATION';const ordered=ranking();el('results-subtitle').textContent=`${lapCount} ${lapCount===1?'lap':'laps'} · ${riders.length} riders · ${formatTime(raceTime)} session`;el('results-table').innerHTML=ordered.map((r,i)=>`<div class="result-row"><b>${String(i+1).padStart(2,'0')}</b><span style="color:${CSS_COLORS[r.id]}">●</span><strong>${r.name}<small>${r.human?'HUMAN':'NPC'}</small></strong><span>${r.finished===null?'DNF':formatTime(r.finished)}</span></div>`).join('');}
function step(dt:number){
  if(phase==='setup'||phase==='results'||paused||reviewFrozen)return;
  if(phase==='countdown'){
    for(const r of riders.filter(r=>r.human))if(input.sample(r.device!).pause){togglePause();return;}
    countdown-=dt;const n=Math.ceil(countdown);if(n!==lastTickSound&&n>0&&n<=3){audio.cue(600,.13);lastTickSound=n;}
    el('countdown').innerHTML=`<small>FIND YOUR LINE</small><strong>${Math.max(1,n)}</strong>`;
    if(countdown<=0){phase='racing';audio.cue(1100,.35);setVisible('countdown',false);}return;
  }
  raceTime+=dt;
  for(const r of riders){
    const humanControl=r.human?(reviewDrive?npcControl(r,track,riders,'club'):(override.get(r.id)||input.sample(r.device!))):null;
    if(reviewCrashTest==='Crash landing'&&r.id===0&&humanControl&&!r.grounded)humanControl.pitch=1;
    const c=r.finished!==null?npcControl(r,track,riders,'relaxed'):humanControl||npcControl(r,track,riders,difficulty);
    if(humanControl?.pause){togglePause();return;}
    if(reviewCrashTest==='Rider contact')Object.assign(c,idleControl());
    stepRider(r,c,track,dt,riders,r.human?slideAggression:1);
    if(r.lastLanding>3&&r.human)audio.landing(r.lastLanding);
    if(!practice&&r.finished===null&&r.progress.lap>=lapCount){r.finished=raceTime;if(r.human&&firstFinish===null)firstFinish=raceTime;audio.cue(900,.25);}
  }
  collide(riders,track);
  if(!practice&&(riders.filter(r=>r.human).every(r=>r.finished!==null)||(firstFinish!==null&&raceTime-firstFinish>TUNING.finishTimeout)))endRace();
}
// Rider pose to draw: between the last two physics steps, so frames that run an uneven number of steps don't jump.
function drawPose(r:Rider,i:number):Pose{return paused||reviewFrozen||phase==='setup'?capturePose(r):blendPose(prevPoses[i],r,accumulator/TUNING.step);}
function syncModels(dt:number){riders.forEach((r,i)=>{const m=models[i],pose=drawPose(r,i);m.root.position.set(pose.x,pose.y,pose.z);m.root.rotation.y=pose.heading;m.root.visible=r.recovery<=0||Math.floor(globalTime*8)%2===0;m.animate({speed:r.speed,steer:r.steer,lean:r.lean,pitch:r.pitch,compression:r.compression,powerSlide:r.powerSlide,slipAngle:r.slipAngle,time:globalTime,throttle:r.throttle,brake:r.brake,groundDistance:Math.max(0,r.y-track.height(r.surface.s,r.surface.lateral)),crashed:r.crashTime>0,crashAge:r.crashAge,crashSide:r.crashSide},dt);});}
function drawMap(canvas:HTMLCanvasElement,r:Rider){const c=canvas.getContext('2d')!;c.clearRect(0,0,150,130);const b=track.bounds,scale=Math.min(136/(b.maxX-b.minX),116/(b.maxZ-b.minZ));const x=(x:number)=>75+(x-(b.minX+b.maxX)/2)*scale,z=(z:number)=>65+(z-(b.minZ+b.maxZ)/2)*scale;c.lineJoin='round';c.beginPath();track.samples.filter((_,i)=>i%8===0).forEach((p,i)=>i?c.lineTo(x(p.x),z(p.z)):c.moveTo(x(p.x),z(p.z)));c.closePath();c.strokeStyle='#fff5';c.lineWidth=3;c.stroke();c.strokeStyle='#151927';c.lineWidth=1.3;c.stroke();if(practice)for(const j of track.obstacles){if(!j.highlight)continue;const p=track.at(j.start);c.fillStyle='#ffdc69';c.fillRect(x(p.x)-3,z(p.z)-3,6,6);}for(const o of riders){c.fillStyle=CSS_COLORS[o.id];c.beginPath();c.arc(x(o.x),z(o.z),o===r?4:2.3,0,Math.PI*2);c.fill();}c.fillStyle='#fff';const p=track.at(0);c.fillRect(x(p.x)-3,z(p.z)-1,6,2);}
function updateHud(){
  const ordered=ranking();viewHud.forEach((h,i)=>{const r=riders[i];h.querySelector('.position strong')!.innerHTML=`${String(ordered.indexOf(r)+1).padStart(2,'0')}<span>/ ${riders.length}</span>`;h.querySelector('.lap b')!.textContent=String(practice?r.progress.lap+1:Math.min(lapCount,r.progress.lap+1));h.querySelector('.speed strong')!.textContent=String(Math.round(r.speed*3.6)).padStart(2,'0');(h.querySelector('.speed-track i')as HTMLElement).style.width=`${r.speed/TUNING.maxSpeed*100}%`;h.querySelector('.sector')!.textContent=track.sector(r.surface.s);
  const approach=track.rhythms.find(section=>(section.start-r.surface.s+track.length)%track.length<55);
  const pace=approach?approach.pace*3.6:0;
  const paceNotice=approach&&phase==='racing'?`<b class="pace-label">RHYTHM ${Math.round(pace-5)}–${Math.round(pace+5)} KM/H</b><small>${r.speed*3.6>pace+5?'EASE OFF':r.speed*3.6<pace-5?'BUILD SPEED':'HOLD YOUR PACE'}</small>`:'';
  h.querySelector('.rider-notice')!.innerHTML=r.finished!==null?`<b>FINISHED / ${formatTime(r.finished)}</b><small>${firstFinish===null?'':Math.ceil(Math.max(0,TUNING.finishTimeout-(raceTime-firstFinish)))+'s for remaining riders'}</small>`:r.crashTime>0?`<b class="crash-label">CRASH / ${r.crashReason}</b><small>REMOUNT IN ${(r.crashTime+TUNING.recoveryDelay).toFixed(1)}s · GETTING BACK UP</small>`:r.recovery>0?`<b>RECOVERING ${r.recovery.toFixed(1)}</b><small>${r.recoveryReason}</small>`:r.progress.routeBroken?`<b>RETURN TO TRACK EXIT</b><small>${iphoneMode?'TAP ↺ RECOVER':'R / B TO RECOVER'}</small>`:r.progress.wrongWay?'<b>WRONG WAY</b>':!r.grounded&&r.airTime>.2?`<b class="air-label">${r.pitch<-.18?'NOSE DOWN':'AIR TIME'}</b><small>${iphoneMode?'HOLD NOSE DOWN TO MATCH THE LANDING':r.device?.kind==='gamepad'?'LEFT STICK UP · DIP NOSE':'Q / SPACE · DIP NOSE'}</small>`:r.powerSlide>.18?`<b class="pace-label">${r.brake>.1?'BRAKE SLIDE':'POWER SLIDE'}</b><small>CENTER THE STICK TO REGAIN GRIP</small>`:paceNotice;
  const targets=practice?track.obstacles.map((j,index)=>({j,index,distance:(j.start-r.surface.s+track.length)%track.length,inside:(r.surface.s-j.start+track.length)%track.length<=obstacleLength(j)})).filter(t=>t.j.highlight).sort((a,b)=>Number(b.inside)-Number(a.inside)||a.distance-b.distance):[];
  const target=targets[0];h.querySelector('.test-target')!.textContent=target?`★ O${target.index+1} · ${obstacleType(target.j).toUpperCase()} · ${target.inside?'ON OBSTACLE':Math.round(target.distance)+' m ahead'}`:'';
  drawMap(h.querySelector('canvas')!,r);});
  el('race-time').textContent=formatTime(raceTime)+(firstFinish!==null?` · ${Math.ceil(Math.max(0,60-(raceTime-firstFinish)))}s TO CLOSE`:'');
  if(humanCount===3)el('live-standings').innerHTML=ordered.slice(0,5).map((r,i)=>`<div><b>${i+1}</b><span style="color:${CSS_COLORS[r.id]}">${r.name}</span><small>${r.finished!==null?'FINISHED':'LAP '+Math.min(lapCount,r.progress.lap+1)}</small></div>`).join('');
}
function resize(){renderer.setPixelRatio(Math.min(devicePixelRatio,1.5)*renderScale);renderer.setSize(innerWidth,innerHeight,false);preview.aspect=innerWidth/innerHeight;preview.updateProjectionMatrix();}
function render(dt:number){
  focusRaceShadows(scene,phase==='setup'?riders.slice(0,1):riders.slice(0,humanCount));
  renderer.shadowMap.needsUpdate=true;
  effects.begin(phase==='setup'?1:humanCount,phase==='setup');const w=innerWidth,h=innerHeight;
  renderer.setScissorTest(false);renderer.setViewport(0,0,w,h);renderer.clear();
  if(phase==='setup'){
    const p=track.at(14),v=track.at(30);preview.position.set(p.x-17+Math.sin(globalTime*.07)*2,track.height(14)+9,p.z-16);preview.lookAt(v.x,track.height(30)+2,v.z);renderer.render(scene,preview);
  }else{
    renderer.setScissorTest(true);views().forEach((v,i)=>{const cam=cameras[i];cam.update({...riders[i],...drawPose(riders[i],i)},track,dt,cameraDistance,cameraShake,globalTime);cam.camera.aspect=(w*v.w)/(h*v.h);cam.camera.updateProjectionMatrix();effects.viewport(v.x*w,(1-v.y-v.h)*h,v.w*w,v.h*h);models.forEach((m,j)=>{if(j!==i&&m.root.position.distanceTo(cam.camera.position)<3.1)m.root.visible=false;});renderer.render(scene,cam.camera);models.forEach((m,j)=>m.root.visible=riders[j].recovery<=0||Math.floor(globalTime*8)%2===0);});renderer.setScissorTest(false);
  }
  sceneDrawCalls=renderer.info.render.calls;effects.finish();
}
const menuPad=new MenuPad(),menuFocus=new MenuFocus();
const controllerHint=document.createElement('div');controllerHint.id='controller-menu-hint';controllerHint.hidden=true;
controllerHint.textContent='↑/↓ Navigate · ←/→ Adjust · A Select · B Back · Menu Start / Resume';document.body.append(controllerHint);
function menuRoot(){return editor.isOpen?el('track-editor'):paused?el('pause'):phase==='setup'?el('setup'):phase==='results'?el('results'):null;}
function menuAction(event:MenuEvent){
  const root=menuRoot();if(!root)return;
  const {action,scale}=event;
  if(editor.isOpen){
    if(['previous','next','kind','highlight','moveLeft','moveRight','moveUp','moveDown'].includes(action)){
      editor.controller(action,scale);menuFocus.focus(el('editor-object'));return;
    }
    if(action==='back'){menuFocus.focus(root.querySelector('[data-action="close"]'));return;}
    if(action==='start'){menuFocus.focus(root.querySelector('[data-action="ride"]'));return;}
    // Place tools get a useful controller-only insertion point; the right stick
    // and inspector then position the new object precisely, without mouse input.
    if(action==='accept'){
      const target=document.activeElement as HTMLElement|null;
      if(target?.dataset.mode==='jump'||target?.dataset.mode==='turn'){
        root.querySelector<HTMLButtonElement>(`[data-action="add-${target.dataset.mode}"]`)?.click();menuFocus.focus(el('editor-object'));return;
      }
    }
  }else if(action==='back'||action==='start'){
    if(paused)togglePause();
    else if(phase==='setup'&&action==='start')el<HTMLButtonElement>('start').click();
    else if(phase==='results')el(action==='start'?'restart-results':'setup-results').click();
    else {const details=document.activeElement?.closest('details');if(details){details.open=false;menuFocus.focus(details.querySelector('summary'));}}
    return;
  }
  menuFocus.handle(root,action);
}
function pollMenus(now:number,consumed:Set<number>){
  const root=menuRoot(),pads=menuGamepads();
  if(document.hidden){menuPad.update(pads,now);return;}
  controllerHint.hidden=!root||editor.isOpen||!Array.from(pads).some(p=>p&&p.connected!==false);
  // Consume riding button edges while in menus, so B/Menu cannot reset or pause
  // the bike as the menu closes. Keyboard pause continues to work here too.
  if(root)for(const r of riders.filter(r=>r.human&&r.device)){
    const c=input.sample(r.device!);if(paused&&r.device?.kind==='keyboard'&&c.pause)togglePause();
  }
  for(const event of menuPad.update(pads,now))if(root&&!(event.action==='accept'&&consumed.has(event.index)))menuAction(event);
  if(root&&!menuRoot()){for(const r of riders.filter(r=>r.human&&r.device))input.sample(r.device!);menuFocus.clear();}
}
let waitingForController=false;
function controllerStatus(){
  const status=readGamepadStatus(),pads=Array.from(status.pads).filter(p=>p&&p.connected!==false);
  const message=iphoneMode?'Touch controls selected. Choose Mac above to use a controller.':status.state!=='ready'?status.message:pads.length?`${pads.length} controller${pads.length===1?'':'s'} detected: ${pads.map(p=>p!.id).join(', ')}. Press A / × to use it.`:nativeControllerStatus()==='connecting'?'Connecting to the Mac’s controller…':nativeControllerStatus()==='unavailable'?'Mac controller connection unavailable. Reopen the local game server and try Use controller again.':'No controller visible yet. Click Use controller to connect through this Mac, then press A / ×.';
  if(el('controller-status').textContent!==message)el('controller-status').textContent=message;
}
function pollJoins(){
  const consumed=new Set<number>();
  const pads=input.connectedGamepads(),signature=pads.map(p=>p.index+':'+p.id).join('|');
  if(signature!==lastPadSignature){lastPadSignature=signature;if(phase==='setup')refreshSlots();else if(missingController()&&!paused)togglePause();}
  for(const index of padButtons.keys())if(!pads.some(p=>p.index===index))padButtons.delete(index);
  if(phase==='setup')controllerStatus();
  for(const p of Array.from(menuGamepads())){
    if(!p||p.connected===false)continue;
    const pressed=!!p.buttons[0]?.pressed||(p.buttons[0]?.value||0)>.5;
    const join=pressed&&!padButtons.get(p.index);padButtons.set(p.index,pressed);
    if(phase!=='setup'||iphoneMode||editor.isOpen)continue;
    const assigned=assignments.findIndex(d=>d?.kind==='gamepad'&&d.index===p.index);
    if(join&&(assigned<0||!ready[assigned])||(waitingForController&&(pressed||p.index>=1000))){
      const slot=controllerJoinSlot(assignments.slice(0,humanCount),p.index,practice);
      if(slot>=0){
        if(slot===humanCount){humanCount++;el<HTMLSelectElement>('humans').value=String(humanCount);refreshNpcOptions();}
        for(let j=0;j<4;j++)if(j!==slot&&assignments[j]?.kind==='gamepad'&&(assignments[j] as {index:number}).index===p.index){assignments[j]=null;ready[j]=false;}
        assignments[slot]={kind:'gamepad',index:p.index};ready[slot]=true;waitingForController=false;refreshSlots();consumed.add(p.index);menuFocus.focus(el('start'));
      }
    }
  }
  return consumed;
}
el('connect-controller').onclick=()=>{
  if(iphoneMode){el<HTMLSelectElement>('play-device').value='desktop';el('play-device').dispatchEvent(new Event('change'));}
  waitingForController=true;if(!input.connectedGamepads().length)startNativeController();padButtons.clear();window.focus();el('connect-controller').blur();
  el('controller-status').textContent='Press A / × on the controller to assign it to your rider.';
};
let last=performance.now();
function frame(now:number){
  const raw=(now-last)/1000,dt=Math.min(TUNING.maxFrame,raw);last=now;globalTime+=dt;frameCount++;
  if(raw>0&&raw<.5){fpsFrames.push(raw);if(fpsFrames.length>600)fpsFrames.shift();}
  pollMenus(now,pollJoins());
  let steps=0;
  if(!paused){accumulator+=dt;while(accumulator>=TUNING.step){prevPoses=riders.map(capturePose);step(TUNING.step);accumulator-=TUNING.step;steps++;}}
  if(raw>0&&raw<.5){stepCounts.push(steps);if(stepCounts.length>600)stepCounts.shift();}
  if(editor.isOpen){audio.update(0,0,false);requestAnimationFrame(frame);return;}
  syncModels(paused||reviewFrozen?0:dt);dust.update(riders,paused||reviewFrozen||phase!=='racing'?0:dt);render(dt);if(now-lastHud>100&&phase!=='setup'){updateHud();lastHud=now;}
  const player=riders[0];audio.update(player?.speed||0,player?.throttle||0,phase==='racing'&&!paused);requestAnimationFrame(frame);
}
function setMode(isPractice:boolean){practice=isPractice;el('practice-mode').classList.toggle('active',practice);el('race-mode').classList.toggle('active',!practice);if(practice){humanCount=1;el<HTMLSelectElement>('humans').value='1';}el<HTMLSelectElement>('humans').disabled=practice||iphoneMode;el<HTMLSelectElement>('laps').disabled=practice;el<HTMLSelectElement>('difficulty').disabled=practice;refreshNpcOptions();refreshSlots();}
el<HTMLSelectElement>('play-device').onchange=e=>{
  iphoneMode=(e.target as HTMLSelectElement).value==='iphone';
  if(iphoneMode)stopNativeController();else startNativeController();
  touchControls.show(false);
  humanCount=1;el<HTMLSelectElement>('humans').value='1';
  el<HTMLSelectElement>('humans').disabled=practice||iphoneMode;
  assignments=[{kind:iphoneMode?'touch':'keyboard'},null,null,null];ready=[true,false,false,false];
  setVisible('touch-setup-hint',iphoneMode);setVisible('touch-directions',iphoneMode);setVisible('pause-touch-directions',iphoneMode);document.body.classList.toggle('iphone-selected',iphoneMode);
  refreshNpcOptions();refreshSlots();
};
for (const prefix of ['', 'pause-']) {
  const updateDirections = () => {
    const steering = el<HTMLSelectElement>(`${prefix}touch-steering`).value as TouchDirection;
    const pitch = el<HTMLSelectElement>(`${prefix}touch-pitch`).value as TouchDirection;
    touchControls.setDirections(steering, pitch);
    for (const other of ['', 'pause-']) {
      el<HTMLSelectElement>(`${other}touch-steering`).value = steering;
      el<HTMLSelectElement>(`${other}touch-pitch`).value = pitch;
      el(`${other}touch-directions`).querySelector('.touch-direction-hint')!.textContent =
        `Left turns ${steering === 'regular' ? 'left' : 'right'}. Drag up to ${pitch === 'regular' ? 'lift' : 'lower'} the nose.`;
    }
  };
  el<HTMLSelectElement>(`${prefix}touch-steering`).onchange = updateDirections;
  el<HTMLSelectElement>(`${prefix}touch-pitch`).onchange = updateDirections;
}
el('race-mode').onclick=()=>setMode(false);el('practice-mode').onclick=()=>setMode(true);
el<HTMLSelectElement>('humans').onchange=e=>{humanCount=Number((e.target as HTMLSelectElement).value);refreshNpcOptions();refreshSlots();};
el<HTMLSelectElement>('npcs').onchange=e=>npcCount=Number((e.target as HTMLSelectElement).value);
el('start').onclick=startRace;el('pause-button').onclick=togglePause;el('resume').onclick=togglePause;
for(const id of ['restart-pause','restart-results'])el(id).onclick=startRace;
for(const id of ['setup-pause','setup-results'])el(id).onclick=toSetup;
function toggleMute(){audio.muted=!audio.muted;el('sound').textContent=audio.muted?'SOUND OFF':'SOUND ON';el('race-mute').textContent=audio.muted?'♪ MUTED':'♪ SOUND ON';}
el('sound').onclick=toggleMute;el('race-mute').onclick=toggleMute;
for(const id of ['camera-distance','pause-distance'])el<HTMLInputElement>(id).oninput=e=>{cameraDistance=Number((e.target as HTMLInputElement).value);el<HTMLInputElement>('camera-distance').value=String(cameraDistance);el<HTMLInputElement>('pause-distance').value=String(cameraDistance);};
for(const id of ['camera-shake','pause-shake'])el<HTMLInputElement>(id).oninput=e=>{cameraShake=Number((e.target as HTMLInputElement).value);el<HTMLInputElement>('camera-shake').value=String(cameraShake);el<HTMLInputElement>('pause-shake').value=String(cameraShake);};
function syncSlideSetting(){
  for(const prefix of ['','pause-']){el<HTMLInputElement>(`${prefix}slide-aggression`).value=String(Math.round(slideAggression*100));el(`${prefix}slide-value`).textContent=slideAggression===0?'Off':`${Math.round(slideAggression*100)}%`;}
}
for(const prefix of ['','pause-'])el<HTMLInputElement>(`${prefix}slide-aggression`).oninput=e=>{
  slideAggression=normalizeSlideAggression(Number((e.target as HTMLInputElement).value)/100);syncSlideSetting();
  try{localStorage.setItem(SLIDE_AGGRESSION_KEY,String(slideAggression));}catch{}
};
syncSlideSetting();
el<HTMLSelectElement>('render-scale').onchange=e=>{renderScale=Number((e.target as HTMLSelectElement).value);resize();};
addEventListener('keydown',e=>{if(!editor.isOpen&&e.code==='KeyM'&&!e.repeat&&!(e.target instanceof HTMLInputElement))toggleMute();});
addEventListener('blur',()=>{if((phase==='racing'||phase==='countdown')&&!paused)togglePause();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&(phase==='racing'||phase==='countdown')&&!paused)togglePause();});
function describeCourse(){
  el('track-length').textContent=String(Math.round(track.length));
  el('track-sectors').textContent=String(track.sections.filter(s=>!s.name.startsWith('BERM')).length);
  el('header-course').textContent=`${String(COURSES.indexOf(track.course)+1).padStart(2,'0')} / ${track.course.name.toUpperCase()}`;
  layoutChoice();
  el('course-description').textContent=`${track.customName?'Saved layout: '+track.customName:track.course.description} · ${(track.length/1000).toFixed(2)} km · ${Math.round(track.elevationRange)} m terrain relief`;
}
el<HTMLSelectElement>('course').onchange=()=>{
  if(phase!=='setup')return;
  activeLayout=null;rebuildTrack(new Track(courseById(el<HTMLSelectElement>('course').value)));
};
el<HTMLSelectElement>('track-layout').onchange=()=>{
  activeLayout=el<HTMLSelectElement>('track-layout').value==='custom'?loadLayout(track.course.id,localStorage):null;
  rebuildTrack(new Track(track.course,activeLayout||undefined));
};
el('open-editor').onclick=openEditor;el('pause-editor').onclick=openEditor;

describeCourse();
if(['localhost','127.0.0.1','[::1]'].includes(location.hostname))startNativeController();
addEventListener('resize',resize);refreshNpcOptions();refreshSlots();buildGrid();resize();requestAnimationFrame(frame);
// Development-only deterministic controls and telemetry for repeatable local verification.
if(import.meta.env.DEV){
  (window as any).__game={get track(){return track;},riders:()=>riders,snapshot:()=>({course:track.course.id,phase,paused,practice,raceTime,humanCount,npcCount,fps:fpsFrames.length/fpsFrames.reduce((a,b)=>a+b,0),frameCount,resolution:[innerWidth,innerHeight],renderScale,riders:riders.map(r=>({id:r.id,human:r.human,s:r.surface.s,speed:r.speed,lap:r.progress.lap,next:r.progress.nextCheckpoint,broken:r.progress.routeBroken,grounded:r.grounded,air:r.bestAir,finished:r.finished,recovery:r.recovery,x:r.x,y:r.y,z:r.z}))}),setControl:(id:number,c:Partial<Control>|null)=>{if(c)override.set(id,{...idleControl(),...c});else override.delete(id);},drive:(id:number)=>{const r=riders[id];override.set(id,npcControl(r,track,riders,'club'));},clearPerf:()=>{fpsFrames=[];stepCounts=[];},step:(seconds:number)=>{for(let t=0;t<seconds;t+=TUNING.step)step(TUNING.step);syncModels(0);updateHud();},renderer:()=>renderer.info};
}

if(reviewEnabled){
  import('./visual-review').then(({mountVisualReview})=>mountVisualReview({
    shot(kind){
      reviewDrive=true;reviewFrozen=false;paused=false;practice=false;iphoneMode=false;
      reviewCrashTest=kind==='Crash landing'||kind==='Rider contact'?kind:'';
      humanCount=kind==='Four views'?4:1;npcCount=kind==='Rider contact'?1:8-humanCount;
      assignments=[{kind:'keyboard'},{kind:'gamepad',index:2001},{kind:'gamepad',index:2002},{kind:'gamepad',index:2003}];
      el<HTMLSelectElement>('humans').value=String(humanCount);refreshNpcOptions();el<HTMLSelectElement>('npcs').value=String(npcCount);
      startRace();audio.muted=true;
      if(kind==='Rider contact')for(const [i,side]of [[0,-1],[1,1]]){
        const r=riders[i],p=track.at(2,side*1.4);Object.assign(r,{x:p.x,z:p.z,prevX:p.x,prevZ:p.z,y:track.height(2,p.lateral),surface:p,heading:Math.atan2(p.tx,p.tz)-side*Math.PI/2,speed:16});
      }
      const target=kind==='Grid'?0:kind==='Berm'?168:kind==='Rhythm'?track.rhythms[1].start+26:track.jumps[0].start+track.jumps[0].rise+6;
      for(let i=0;i<120*90;i++){
        step(TUNING.step);dust.update(riders,TUNING.step);
        if(phase==='racing'&&(reviewCrashTest?(riders[0].crashTime>0&&riders[0].crashAge>.45):(target===0||(raceTime>1&&riders[0].surface.s>=target&&riders[0].surface.s<target+8))))break;
      }
      reviewFrozen=true;syncModels(0);updateHud();cameras.forEach(c=>c.initialized=false);fpsFrames=[];
    },
    run(){reviewFrozen=!reviewFrozen;paused=false;setVisible('pause',false);fpsFrames=[];stepCounts=[];},
    stats(){return `${track.course.name} · ${humanCount} view(s) · ${innerWidth} × ${innerHeight} CSS · ${(fpsFrames.length/fpsFrames.reduce((a,b)=>a+b,0)||0).toFixed(1)} fps · ${(()=>{const p=pacingStats(fpsFrames,stepCounts);return `slowest 1% ${p.p99Ms.toFixed(1)} ms · ${p.unevenPct.toFixed(1)}% uneven frames`;})()} · ${sceneDrawCalls} draws/view · ${renderer.info.memory.geometries} geometries · ${renderer.info.memory.textures} textures`;}
  }));
}

if(import.meta.env.DEV&&new URLSearchParams(location.search).has('controller-review')){
  import('./controller-review').then(({mountControllerReview})=>mountControllerReview(pad=>{reviewPad=pad;}));
}
