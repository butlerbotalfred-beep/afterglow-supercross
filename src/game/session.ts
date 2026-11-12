// The game session: race state, the fixed-step loop, setup/pause/results flow, menus and controller joins.
import * as THREE from 'three';
import {MenuPad, MenuFocus, type MenuEvent} from '../menu-controller';
import {loadSlideAggression, normalizeSlideAggression, SLIDE_AGGRESSION_KEY} from '../handling-settings';
import {obstacleMarker} from '../track-markers';
import {Track} from '../track';
import {TrackEditor} from '../track-editor';
import {layoutFromTrack, loadLayout, saveLayout, type TrackLayout} from '../track-layout';
import {COURSES, courseById} from '../courses';
import {disposeWorld} from '../scenery';
import {createWorld} from '../world';
import {createBike} from '../bike-model';
import {RaceEffects} from '../race-effects';
import {ChaseCamera} from '../camera';
import {GameAudio} from '../audio';
import {Dust} from '../dust';
import {TouchControls} from '../touch-controls';
import type {TouchDirection} from '../touch-input';
import {startNativeController, stopNativeController} from '../native-controller';
import {
  InputManager,
  type GamepadLike,
  type Device,
  type Control,
  uniqueDevices,
  readBrowserGamepads,
  controllerJoinSlot,
} from '../input';
import {makeRider, stepRider, collide, npcControl, idleControl, type Rider} from '../physics';
import {TUNING, COLORS} from '../config';
import {blendPose, capturePose, pacingStats, type Pose} from '../render-interp';
import {createRenderer, renderViews, resizeRenderer, type RenderContext} from '../render/renderer';
import {el, setVisible} from '../ui/dom';
import {hudHtml, updateHud, type HudContext} from '../ui/hud';
import {pauseMessage} from '../ui/pause-menu';
import {showResultsTable} from '../ui/results-screen';
import {
  appShellHtml,
  controllerStatusMessage,
  courseDescriptionText,
  deviceValue,
  npcOptionsHtml,
  sameDevice,
  slotsHtml,
} from '../ui/setup-screen';

const reviewEnabled = import.meta.env.DEV && new URLSearchParams(location.search).has('review');
let reviewDrive = false,
  reviewFrozen = false,
  reviewCrashTest = '';
type Phase = 'setup' | 'countdown' | 'racing' | 'results';
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = appShellHtml();
const {renderer, lightWorld} = createRenderer(el<HTMLCanvasElement>('game'));
let track = new Track(),
  scene = lightWorld(createWorld(track));
let reviewPad: GamepadLike | null = null;
const menuGamepads = () => (reviewPad ? [reviewPad] : readBrowserGamepads());
const input = new InputManager(undefined, menuGamepads, () => touchControls.input.read()),
  audio = new GameAudio();
el('track-length').textContent = String(Math.round(track.length));
el('track-sectors').textContent = String(track.sections.filter(s => !s.name.startsWith('BERM')).length);
const touchControls = new TouchControls(app, () => togglePause());
let dust = new Dust(scene);
const effects = new RaceEffects(renderer);
let sceneDrawCalls = 0;
const preview = new THREE.PerspectiveCamera(58, 1, 0.1, 1800);
let iphoneMode = false;
let phase: Phase = 'setup',
  paused = false,
  practice = false,
  humanCount = 1,
  npcCount = 5,
  lapCount = 3,
  difficulty = 'club';
let slideAggression = 1;
try {
  slideAggression = loadSlideAggression(localStorage);
} catch {}
let raceTime = 0,
  countdown = 3.8,
  firstFinish: number | null = null,
  cameraDistance: number = TUNING.cameraDistance,
  cameraShake: number = TUNING.cameraShake,
  renderScale = 1;
let assignments: (Device | null)[] = [{kind: 'keyboard'}, null, null, null],
  ready = [true, false, false, false];
let riders: Rider[] = [],
  models: ReturnType<typeof createBike>[] = [],
  cameras: ChaseCamera[] = [];
let viewHud: HTMLElement[] = [],
  fpsFrames: number[] = [],
  lastHud = 0,
  globalTime = 0,
  lastTickSound = 4,
  accumulator = 0;
let prevPoses: Pose[] = [],
  stepCounts: number[] = [];
let lastPadSignature = '',
  padButtons = new Map<number, boolean>(),
  override = new Map<number, Control>();
let frameCount = 0;
let activeLayout: TrackLayout | null = null;
let testMarkers = new THREE.Group();
scene.add(testMarkers);
const editor = new TrackEditor(
  (layout, ride) => {
    saveLayout(layout, localStorage); // Throw before changing the race if browser storage fails.
    activeLayout = layout;
    el<HTMLSelectElement>('track-layout').value = 'custom';
    rebuildTrack(new Track(courseById(layout.courseId), layout));
    setVisible('setup', true);
    if (ride) {
      setMode(true);
      startRace();
    }
  },
  () => setVisible('setup', true),
);
function openEditor() {
  reviewDrive = false;
  reviewFrozen = false;
  reviewCrashTest = '';
  toSetup();
  setVisible('setup', false);
  editor.open(activeLayout || layoutFromTrack(track));
}
function rebuildTrack(next: Track) {
  touchControls.clear();
  override.clear();
  disposeWorld(scene);
  models = [];
  track = next;
  scene = lightWorld(createWorld(track));
  dust = new Dust(scene);
  testMarkers = new THREE.Group();
  track.obstacles.forEach((j, i) => {
    if (j.highlight) testMarkers.add(obstacleMarker(track, i, true));
  });
  testMarkers.visible = false;
  scene.add(testMarkers);
  describeCourse();
  buildGrid();
  renderer.renderLists.dispose();
}
function layoutChoice() {
  const stored = loadLayout(track.course.id, localStorage);
  el<HTMLOptionElement>('track-layout').querySelector<HTMLOptionElement>('option[value="custom"]')!.disabled = !stored;
  el<HTMLSelectElement>('track-layout').value = activeLayout ? 'custom' : 'original';
}

function refreshNpcOptions() {
  const s = el<HTMLSelectElement>('npcs');
  npcCount = practice ? 0 : Math.min(npcCount, 8 - humanCount);
  s.innerHTML = npcOptionsHtml(humanCount);
  s.value = String(npcCount);
  s.disabled = practice;
}
function refreshSlots() {
  const pads = input.connectedGamepads();
  el('slots').innerHTML = slotsHtml(humanCount, ready, iphoneMode, pads);
  el('slots')
    .querySelectorAll<HTMLSelectElement>('[data-device]')
    .forEach(s => {
      const i = Number(s.dataset.device);
      s.value = deviceValue(assignments[i]);
      s.disabled = iphoneMode;
      s.onchange = () => {
        const value = s.value;
        const d: Device | null =
          value === 'keyboard'
            ? {kind: 'keyboard'}
            : value === 'touch'
              ? {kind: 'touch'}
              : value
                ? {kind: 'gamepad', index: Number(value.split('-')[1])}
                : null;
        for (let j = 0; j < 4; j++)
          if (j !== i && sameDevice(assignments[j], d)) {
            assignments[j] = null;
            ready[j] = false;
          }
        assignments[i] = d;
        ready[i] = false;
        refreshSlots();
      };
    });
  el('slots')
    .querySelectorAll<HTMLButtonElement>('[data-ready]')
    .forEach(
      b =>
        (b.onclick = () => {
          const i = Number(b.dataset.ready);
          if (assignments[i]) ready[i] = !ready[i];
          refreshSlots();
        }),
    );
  const valid =
    uniqueDevices(assignments.slice(0, humanCount).filter(Boolean) as Device[]).length === humanCount &&
    assignments
      .slice(0, humanCount)
      .every((d, i) => d && ready[i] && (d.kind !== 'gamepad' || pads.some(p => p.index === d.index)));
  el<HTMLButtonElement>('start').disabled = !valid;
  el('setup-status').textContent = valid
    ? 'All riders ready. See you at the gate.'
    : 'Assign a unique device and ready each rider. Press a gamepad button to connect.';
}
function buildGrid() {
  for (const m of models) {
    scene.remove(m.root);
    m.root.traverse(o => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach(mat => {
          for (const v of Object.values(mat)) if (v instanceof THREE.Texture && !v.userData.persistent) v.dispose();
          mat.dispose();
        });
      }
    });
  }
  riders = Array.from({length: humanCount + (practice ? 0 : npcCount)}, (_, i) =>
    makeRider(track, i, i < humanCount, COLORS[i], i < humanCount ? assignments[i] || undefined : undefined),
  );
  const names = ['S. MORA', 'J. REYES', 'K. NOVA', 'A. RIVERS', 'T. FOX', 'R. VALE', 'M. PARK'];
  riders.forEach((r, i) => {
    if (!r.human) r.name = names[(i - humanCount) % names.length];
  });
  models = riders.map(r => {
    const m = createBike(r.color, r.id + 1);
    scene.add(m.root);
    return m;
  });
  cameras = Array.from({length: humanCount}, () => new ChaseCamera());
  syncModels(0);
}
function buildHud() {
  el('hud').innerHTML = hudHtml(humanCount, riders, assignments, practice, lapCount);
  viewHud = [...el('hud').querySelectorAll<HTMLElement>('.viewport-hud')];
}
function startRace() {
  humanCount = Number(el<HTMLSelectElement>('humans').value);
  npcCount = Number(el<HTMLSelectElement>('npcs').value);
  lapCount = Number(el<HTMLSelectElement>('laps').value);
  difficulty = el<HTMLSelectElement>('difficulty').value;
  if (
    !assignments.slice(0, humanCount).every(Boolean) ||
    uniqueDevices(assignments.slice(0, humanCount) as Device[]).length !== humanCount
  )
    return;
  testMarkers.visible = practice;
  touchControls.clear();
  document.body.classList.toggle('iphone-session', iphoneMode);
  buildGrid();
  buildHud();
  raceTime = 0;
  countdown = 3.8;
  firstFinish = null;
  paused = false;
  phase = 'countdown';
  lastTickSound = 4;
  accumulator = 0;
  prevPoses = [];
  override.clear();
  setVisible('setup', false);
  setVisible('results', false);
  setVisible('pause', false);
  setVisible('hud', true);
  setVisible('race-bar', true);
  setVisible('countdown', true);
  touchControls.show(iphoneMode);
  audio.start();
  el('session-label').textContent =
    `${(track.customName || track.course.name).toUpperCase()} / ${practice ? 'FREE PRACTICE' : 'RACE NIGHT'}`;
  el('countdown').innerHTML = '<small>FIND YOUR LINE</small><strong>3</strong>';
  updateHud(hudContext());
}
function toSetup() {
  testMarkers.visible = false;
  reviewCrashTest = '';
  touchControls.show(false);
  document.body.classList.remove('iphone-session');
  phase = 'setup';
  paused = false;
  audio.update(0, 0, false);
  ['hud', 'pause', 'results', 'countdown', 'race-bar'].forEach(id => setVisible(id, false));
  setVisible('setup', true);
  refreshSlots();
}
function missingController() {
  if (reviewDrive) return;
  const pads = input.connectedGamepads();
  return riders.find(
    r =>
      r.human &&
      r.device?.kind === 'gamepad' &&
      !pads.some(p => r.device?.kind === 'gamepad' && p.index === r.device.index),
  );
}
function togglePause() {
  if (phase === 'setup' || phase === 'results') return;
  const missing = missingController();
  if (paused && missing) return;
  paused = !paused;
  touchControls.show(iphoneMode && !paused);
  setVisible('pause', paused);
  el('pause-message').textContent = pauseMessage(missing);
  audio.update(0, 0, false);
}
function endRace() {
  touchControls.show(false);
  phase = 'results';
  riders.forEach(r => (r.dnf = r.finished === null));
  setVisible('results', true);
  setVisible('countdown', false);
  audio.update(0, 0, false);
  showResultsTable(track, riders, lapCount, raceTime);
}
function step(dt: number) {
  if (phase === 'setup' || phase === 'results' || paused || reviewFrozen) return;
  if (phase === 'countdown') {
    for (const r of riders.filter(r => r.human))
      if (input.sample(r.device!).pause) {
        togglePause();
        return;
      }
    countdown -= dt;
    const n = Math.ceil(countdown);
    if (n !== lastTickSound && n > 0 && n <= 3) {
      audio.cue(600, 0.13);
      lastTickSound = n;
    }
    el('countdown').innerHTML = `<small>FIND YOUR LINE</small><strong>${Math.max(1, n)}</strong>`;
    if (countdown <= 0) {
      phase = 'racing';
      audio.cue(1100, 0.35);
      setVisible('countdown', false);
    }
    return;
  }
  raceTime += dt;
  for (const r of riders) {
    const humanControl = r.human
      ? reviewDrive
        ? npcControl(r, track, riders, 'club')
        : override.get(r.id) || input.sample(r.device!)
      : null;
    if (reviewCrashTest === 'Crash landing' && r.id === 0 && humanControl && !r.grounded) humanControl.pitch = 1;
    const c =
      r.finished !== null
        ? npcControl(r, track, riders, 'relaxed')
        : humanControl || npcControl(r, track, riders, difficulty);
    if (humanControl?.pause) {
      togglePause();
      return;
    }
    if (reviewCrashTest === 'Rider contact') Object.assign(c, idleControl());
    stepRider(r, c, track, dt, riders, r.human ? slideAggression : 1);
    if (r.lastLanding > 3 && r.human) audio.landing(r.lastLanding);
    if (!practice && r.finished === null && r.progress.lap >= lapCount) {
      r.finished = raceTime;
      if (r.human && firstFinish === null) firstFinish = raceTime;
      audio.cue(900, 0.25);
    }
  }
  collide(riders, track);
  if (
    !practice &&
    (riders.filter(r => r.human).every(r => r.finished !== null) ||
      (firstFinish !== null && raceTime - firstFinish > TUNING.finishTimeout))
  )
    endRace();
}
// Rider pose to draw: between the last two physics steps, so frames that run an uneven number of steps don't jump.
function drawPose(r: Rider, i: number): Pose {
  return paused || reviewFrozen || phase === 'setup'
    ? capturePose(r)
    : blendPose(prevPoses[i], r, accumulator / TUNING.step);
}
function syncModels(dt: number) {
  riders.forEach((r, i) => {
    const m = models[i],
      pose = drawPose(r, i);
    m.root.position.set(pose.x, pose.y, pose.z);
    m.root.rotation.y = pose.heading;
    m.root.visible = r.recovery <= 0 || Math.floor(globalTime * 8) % 2 === 0;
    m.animate(
      {
        speed: r.speed,
        steer: r.steer,
        lean: r.lean,
        pitch: r.pitch,
        compression: r.compression,
        powerSlide: r.powerSlide,
        slipAngle: r.slipAngle,
        time: globalTime,
        throttle: r.throttle,
        brake: r.brake,
        groundDistance: Math.max(0, r.y - track.height(r.surface.s, r.surface.lateral)),
        crashed: r.crashTime > 0,
        crashAge: r.crashAge,
        crashSide: r.crashSide,
      },
      dt,
    );
  });
}
function hudContext(): HudContext {
  return {track, riders, viewHud, phase, practice, lapCount, humanCount, raceTime, firstFinish, iphoneMode};
}
function renderContext(): RenderContext {
  return {
    renderer,
    effects,
    scene,
    preview,
    track,
    riders,
    models,
    cameras,
    phase,
    humanCount,
    globalTime,
    cameraDistance,
    cameraShake,
    drawPose,
  };
}
function resize() {
  resizeRenderer(renderer, preview, renderScale);
}
const menuPad = new MenuPad(),
  menuFocus = new MenuFocus();
const controllerHint = document.createElement('div');
controllerHint.id = 'controller-menu-hint';
controllerHint.hidden = true;
controllerHint.textContent = '↑/↓ Navigate · ←/→ Adjust · A Select · B Back · Menu Start / Resume';
document.body.append(controllerHint);
function menuRoot() {
  return editor.isOpen
    ? el('track-editor')
    : paused
      ? el('pause')
      : phase === 'setup'
        ? el('setup')
        : phase === 'results'
          ? el('results')
          : null;
}
function menuAction(event: MenuEvent) {
  const root = menuRoot();
  if (!root) return;
  const {action, scale} = event;
  if (editor.isOpen) {
    if (['previous', 'next', 'kind', 'highlight', 'moveLeft', 'moveRight', 'moveUp', 'moveDown'].includes(action)) {
      editor.controller(action, scale);
      menuFocus.focus(el('editor-object'));
      return;
    }
    if (action === 'back') {
      menuFocus.focus(root.querySelector('[data-action="close"]'));
      return;
    }
    if (action === 'start') {
      menuFocus.focus(root.querySelector('[data-action="ride"]'));
      return;
    }
    // Place tools get a useful controller-only insertion point; the right stick
    // and inspector then position the new object precisely, without mouse input.
    if (action === 'accept') {
      const target = document.activeElement as HTMLElement | null;
      if (target?.dataset.mode === 'jump' || target?.dataset.mode === 'turn') {
        root.querySelector<HTMLButtonElement>(`[data-action="add-${target.dataset.mode}"]`)?.click();
        menuFocus.focus(el('editor-object'));
        return;
      }
    }
  } else if (action === 'back' || action === 'start') {
    if (paused) togglePause();
    else if (phase === 'setup' && action === 'start') el<HTMLButtonElement>('start').click();
    else if (phase === 'results') el(action === 'start' ? 'restart-results' : 'setup-results').click();
    else {
      const details = document.activeElement?.closest('details');
      if (details) {
        details.open = false;
        menuFocus.focus(details.querySelector('summary'));
      }
    }
    return;
  }
  menuFocus.handle(root, action);
}
function pollMenus(now: number, consumed: Set<number>) {
  const root = menuRoot(),
    pads = menuGamepads();
  if (document.hidden) {
    menuPad.update(pads, now);
    return;
  }
  controllerHint.hidden = !root || editor.isOpen || !Array.from(pads).some(p => p && p.connected !== false);
  // Consume riding button edges while in menus, so B/Menu cannot reset or pause
  // the bike as the menu closes. Keyboard pause continues to work here too.
  if (root)
    for (const r of riders.filter(r => r.human && r.device)) {
      const c = input.sample(r.device!);
      if (paused && r.device?.kind === 'keyboard' && c.pause) togglePause();
    }
  for (const event of menuPad.update(pads, now))
    if (root && !(event.action === 'accept' && consumed.has(event.index))) menuAction(event);
  if (root && !menuRoot()) {
    for (const r of riders.filter(r => r.human && r.device)) input.sample(r.device!);
    menuFocus.clear();
  }
}
let waitingForController = false;
function controllerStatus() {
  const message = controllerStatusMessage(iphoneMode);
  if (el('controller-status').textContent !== message) el('controller-status').textContent = message;
}
function pollJoins() {
  const consumed = new Set<number>();
  const pads = input.connectedGamepads(),
    signature = pads.map(p => p.index + ':' + p.id).join('|');
  if (signature !== lastPadSignature) {
    lastPadSignature = signature;
    if (phase === 'setup') refreshSlots();
    else if (missingController() && !paused) togglePause();
  }
  for (const index of padButtons.keys()) if (!pads.some(p => p.index === index)) padButtons.delete(index);
  if (phase === 'setup') controllerStatus();
  for (const p of Array.from(menuGamepads())) {
    if (!p || p.connected === false) continue;
    const pressed = !!p.buttons[0]?.pressed || (p.buttons[0]?.value || 0) > 0.5;
    const join = pressed && !padButtons.get(p.index);
    padButtons.set(p.index, pressed);
    if (phase !== 'setup' || iphoneMode || editor.isOpen) continue;
    const assigned = assignments.findIndex(d => d?.kind === 'gamepad' && d.index === p.index);
    if ((join && (assigned < 0 || !ready[assigned])) || (waitingForController && (pressed || p.index >= 1000))) {
      const slot = controllerJoinSlot(assignments.slice(0, humanCount), p.index, practice);
      if (slot >= 0) {
        if (slot === humanCount) {
          humanCount++;
          el<HTMLSelectElement>('humans').value = String(humanCount);
          refreshNpcOptions();
        }
        for (let j = 0; j < 4; j++)
          if (
            j !== slot &&
            assignments[j]?.kind === 'gamepad' &&
            (assignments[j] as {index: number}).index === p.index
          ) {
            assignments[j] = null;
            ready[j] = false;
          }
        assignments[slot] = {kind: 'gamepad', index: p.index};
        ready[slot] = true;
        waitingForController = false;
        refreshSlots();
        consumed.add(p.index);
        menuFocus.focus(el('start'));
      }
    }
  }
  return consumed;
}
el('connect-controller').onclick = () => {
  if (iphoneMode) {
    el<HTMLSelectElement>('play-device').value = 'desktop';
    el('play-device').dispatchEvent(new Event('change'));
  }
  waitingForController = true;
  if (!input.connectedGamepads().length) startNativeController();
  padButtons.clear();
  window.focus();
  el('connect-controller').blur();
  el('controller-status').textContent = 'Press A / × on the controller to assign it to your rider.';
};
let last = performance.now();
function frame(now: number) {
  const raw = (now - last) / 1000,
    dt = Math.min(TUNING.maxFrame, raw);
  last = now;
  globalTime += dt;
  frameCount++;
  if (raw > 0 && raw < 0.5) {
    fpsFrames.push(raw);
    if (fpsFrames.length > 600) fpsFrames.shift();
  }
  pollMenus(now, pollJoins());
  let steps = 0;
  if (!paused) {
    accumulator += dt;
    while (accumulator >= TUNING.step) {
      prevPoses = riders.map(capturePose);
      step(TUNING.step);
      accumulator -= TUNING.step;
      steps++;
    }
  }
  if (raw > 0 && raw < 0.5) {
    stepCounts.push(steps);
    if (stepCounts.length > 600) stepCounts.shift();
  }
  if (editor.isOpen) {
    audio.update(0, 0, false);
    requestAnimationFrame(frame);
    return;
  }
  syncModels(paused || reviewFrozen ? 0 : dt);
  dust.update(riders, paused || reviewFrozen || phase !== 'racing' ? 0 : dt);
  sceneDrawCalls = renderViews(renderContext(), dt);
  if (now - lastHud > 100 && phase !== 'setup') {
    updateHud(hudContext());
    lastHud = now;
  }
  const player = riders[0];
  audio.update(player?.speed || 0, player?.throttle || 0, phase === 'racing' && !paused);
  requestAnimationFrame(frame);
}
function setMode(isPractice: boolean) {
  practice = isPractice;
  el('practice-mode').classList.toggle('active', practice);
  el('race-mode').classList.toggle('active', !practice);
  if (practice) {
    humanCount = 1;
    el<HTMLSelectElement>('humans').value = '1';
  }
  el<HTMLSelectElement>('humans').disabled = practice || iphoneMode;
  el<HTMLSelectElement>('laps').disabled = practice;
  el<HTMLSelectElement>('difficulty').disabled = practice;
  refreshNpcOptions();
  refreshSlots();
}
el<HTMLSelectElement>('play-device').onchange = e => {
  iphoneMode = (e.target as HTMLSelectElement).value === 'iphone';
  if (iphoneMode) stopNativeController();
  else startNativeController();
  touchControls.show(false);
  humanCount = 1;
  el<HTMLSelectElement>('humans').value = '1';
  el<HTMLSelectElement>('humans').disabled = practice || iphoneMode;
  assignments = [{kind: iphoneMode ? 'touch' : 'keyboard'}, null, null, null];
  ready = [true, false, false, false];
  setVisible('touch-setup-hint', iphoneMode);
  setVisible('touch-directions', iphoneMode);
  setVisible('pause-touch-directions', iphoneMode);
  document.body.classList.toggle('iphone-selected', iphoneMode);
  refreshNpcOptions();
  refreshSlots();
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
el('race-mode').onclick = () => setMode(false);
el('practice-mode').onclick = () => setMode(true);
el<HTMLSelectElement>('humans').onchange = e => {
  humanCount = Number((e.target as HTMLSelectElement).value);
  refreshNpcOptions();
  refreshSlots();
};
el<HTMLSelectElement>('npcs').onchange = e => (npcCount = Number((e.target as HTMLSelectElement).value));
el('start').onclick = startRace;
el('pause-button').onclick = togglePause;
el('resume').onclick = togglePause;
for (const id of ['restart-pause', 'restart-results']) el(id).onclick = startRace;
for (const id of ['setup-pause', 'setup-results']) el(id).onclick = toSetup;
function toggleMute() {
  audio.muted = !audio.muted;
  el('sound').textContent = audio.muted ? 'SOUND OFF' : 'SOUND ON';
  el('race-mute').textContent = audio.muted ? '♪ MUTED' : '♪ SOUND ON';
}
el('sound').onclick = toggleMute;
el('race-mute').onclick = toggleMute;
for (const id of ['camera-distance', 'pause-distance'])
  el<HTMLInputElement>(id).oninput = e => {
    cameraDistance = Number((e.target as HTMLInputElement).value);
    el<HTMLInputElement>('camera-distance').value = String(cameraDistance);
    el<HTMLInputElement>('pause-distance').value = String(cameraDistance);
  };
for (const id of ['camera-shake', 'pause-shake'])
  el<HTMLInputElement>(id).oninput = e => {
    cameraShake = Number((e.target as HTMLInputElement).value);
    el<HTMLInputElement>('camera-shake').value = String(cameraShake);
    el<HTMLInputElement>('pause-shake').value = String(cameraShake);
  };
function syncSlideSetting() {
  for (const prefix of ['', 'pause-']) {
    el<HTMLInputElement>(`${prefix}slide-aggression`).value = String(Math.round(slideAggression * 100));
    el(`${prefix}slide-value`).textContent = slideAggression === 0 ? 'Off' : `${Math.round(slideAggression * 100)}%`;
  }
}
for (const prefix of ['', 'pause-'])
  el<HTMLInputElement>(`${prefix}slide-aggression`).oninput = e => {
    slideAggression = normalizeSlideAggression(Number((e.target as HTMLInputElement).value) / 100);
    syncSlideSetting();
    try {
      localStorage.setItem(SLIDE_AGGRESSION_KEY, String(slideAggression));
    } catch {}
  };
syncSlideSetting();
el<HTMLSelectElement>('render-scale').onchange = e => {
  renderScale = Number((e.target as HTMLSelectElement).value);
  resize();
};
addEventListener('keydown', e => {
  if (!editor.isOpen && e.code === 'KeyM' && !e.repeat && !(e.target instanceof HTMLInputElement)) toggleMute();
});
addEventListener('blur', () => {
  if ((phase === 'racing' || phase === 'countdown') && !paused) togglePause();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (phase === 'racing' || phase === 'countdown') && !paused) togglePause();
});
function describeCourse() {
  el('track-length').textContent = String(Math.round(track.length));
  el('track-sectors').textContent = String(track.sections.filter(s => !s.name.startsWith('BERM')).length);
  el('header-course').textContent =
    `${String(COURSES.indexOf(track.course) + 1).padStart(2, '0')} / ${track.course.name.toUpperCase()}`;
  layoutChoice();
  el('course-description').textContent = courseDescriptionText(track);
}
el<HTMLSelectElement>('course').onchange = () => {
  if (phase !== 'setup') return;
  activeLayout = null;
  rebuildTrack(new Track(courseById(el<HTMLSelectElement>('course').value)));
};
el<HTMLSelectElement>('track-layout').onchange = () => {
  activeLayout =
    el<HTMLSelectElement>('track-layout').value === 'custom' ? loadLayout(track.course.id, localStorage) : null;
  rebuildTrack(new Track(track.course, activeLayout || undefined));
};
el('open-editor').onclick = openEditor;
el('pause-editor').onclick = openEditor;

describeCourse();
if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) startNativeController();
addEventListener('resize', resize);
refreshNpcOptions();
refreshSlots();
buildGrid();
resize();
requestAnimationFrame(frame);
// Development-only deterministic controls and telemetry for repeatable local verification.
if (import.meta.env.DEV) {
  (window as any).__game = {
    get track() {
      return track;
    },
    riders: () => riders,
    snapshot: () => ({
      course: track.course.id,
      phase,
      paused,
      practice,
      raceTime,
      humanCount,
      npcCount,
      fps: fpsFrames.length / fpsFrames.reduce((a, b) => a + b, 0),
      frameCount,
      resolution: [innerWidth, innerHeight],
      renderScale,
      riders: riders.map(r => ({
        id: r.id,
        human: r.human,
        s: r.surface.s,
        speed: r.speed,
        lap: r.progress.lap,
        next: r.progress.nextCheckpoint,
        broken: r.progress.routeBroken,
        grounded: r.grounded,
        air: r.bestAir,
        finished: r.finished,
        recovery: r.recovery,
        x: r.x,
        y: r.y,
        z: r.z,
      })),
    }),
    setControl: (id: number, c: Partial<Control> | null) => {
      if (c) override.set(id, {...idleControl(), ...c});
      else override.delete(id);
    },
    drive: (id: number) => {
      const r = riders[id];
      override.set(id, npcControl(r, track, riders, 'club'));
    },
    clearPerf: () => {
      fpsFrames = [];
      stepCounts = [];
    },
    step: (seconds: number) => {
      for (let t = 0; t < seconds; t += TUNING.step) step(TUNING.step);
      syncModels(0);
      updateHud(hudContext());
    },
    renderer: () => renderer.info,
  };
}

if (reviewEnabled) {
  import('../visual-review').then(({mountVisualReview}) =>
    mountVisualReview({
      shot(kind) {
        reviewDrive = true;
        reviewFrozen = false;
        paused = false;
        practice = false;
        iphoneMode = false;
        reviewCrashTest = kind === 'Crash landing' || kind === 'Rider contact' ? kind : '';
        humanCount = kind === 'Four views' ? 4 : 1;
        npcCount = kind === 'Rider contact' ? 1 : 8 - humanCount;
        assignments = [
          {kind: 'keyboard'},
          {kind: 'gamepad', index: 2001},
          {kind: 'gamepad', index: 2002},
          {kind: 'gamepad', index: 2003},
        ];
        el<HTMLSelectElement>('humans').value = String(humanCount);
        refreshNpcOptions();
        el<HTMLSelectElement>('npcs').value = String(npcCount);
        startRace();
        audio.muted = true;
        if (kind === 'Rider contact')
          for (const [i, side] of [
            [0, -1],
            [1, 1],
          ]) {
            const r = riders[i],
              p = track.at(2, side * 1.4);
            Object.assign(r, {
              x: p.x,
              z: p.z,
              prevX: p.x,
              prevZ: p.z,
              y: track.height(2, p.lateral),
              surface: p,
              heading: Math.atan2(p.tx, p.tz) - (side * Math.PI) / 2,
              speed: 16,
            });
          }
        const target =
          kind === 'Grid'
            ? 0
            : kind === 'Berm'
              ? 168
              : kind === 'Rhythm'
                ? track.rhythms[1].start + 26
                : track.jumps[0].start + track.jumps[0].rise + 6;
        for (let i = 0; i < 120 * 90; i++) {
          step(TUNING.step);
          dust.update(riders, TUNING.step);
          if (
            phase === 'racing' &&
            (reviewCrashTest
              ? riders[0].crashTime > 0 && riders[0].crashAge > 0.45
              : target === 0 || (raceTime > 1 && riders[0].surface.s >= target && riders[0].surface.s < target + 8))
          )
            break;
        }
        reviewFrozen = true;
        syncModels(0);
        updateHud(hudContext());
        cameras.forEach(c => (c.initialized = false));
        fpsFrames = [];
      },
      run() {
        reviewFrozen = !reviewFrozen;
        paused = false;
        setVisible('pause', false);
        fpsFrames = [];
        stepCounts = [];
      },
      stats() {
        return (
          `${track.course.name} · ${humanCount} view(s) · ${innerWidth} × ${innerHeight} CSS · ` +
          `${(fpsFrames.length / fpsFrames.reduce((a, b) => a + b, 0) || 0).toFixed(1)} fps · ` +
          `${(() => {
            const p = pacingStats(fpsFrames, stepCounts);
            return `slowest 1% ${p.p99Ms.toFixed(1)} ms · ${p.unevenPct.toFixed(1)}% uneven frames`;
          })()}` +
          ` · ${sceneDrawCalls} draws/view · ${renderer.info.memory.geometries} geometries · ` +
          `${renderer.info.memory.textures} textures`
        );
      },
    }),
  );
}

if (import.meta.env.DEV && new URLSearchParams(location.search).has('controller-review')) {
  import('../controller-review').then(({mountControllerReview}) =>
    mountControllerReview(pad => {
      reviewPad = pad;
    }),
  );
}
