// The game session: race state, the fixed-step loop, setup/pause/results flow, menus and controller joins.
import * as THREE from 'three';
import {MenuPad, MenuFocus, type MenuEvent} from '../menu-controller';
import {obstacleMarker} from '../track-markers';
import {Track} from '../track';
import type {TrackEditor} from '../track-editor';
import {layoutFromTrack, type TrackLayout} from '../track-layout';
import {COURSES, courseById} from '../courses';
import {disposeWorld} from '../scenery';
import {createWorld} from '../world';
import {createBike} from '../bike-model';
import {RaceEffects} from '../race-effects';
import {ChaseCamera} from '../camera';
import {GameAudio, normalizeVolumes, VOLUME_KEYS, type SoundFrame} from '../audio';
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
import {npcControl, idleControl, type Rider} from '../physics';
import {prepareTakeoffAdvice} from '../takeoff';
import {TUNING} from '../config';
import {GhostPlayback, GhostStore, indexedDbGhosts, type GhostPose} from '../ghost';
import {currentLapTime} from '../timing';
import {browserStorage, lapCountsForRecord, recordKey, SaveStore} from '../save';
import {devicesReady, RaceSession} from './race-session';
import {blendPose, capturePose, pacingStats, type Pose} from '../render-interp';
import {createRenderer, renderViews, resizeRenderer, type RenderContext} from '../render/renderer';
import {el, setVisible} from '../ui/dom';
import {isLoading, watchLoading} from '../ui/loading';
import {hudHtml, updateHud, type HudContext} from '../ui/hud';
import {pauseMessage} from '../ui/pause-menu';
import {ranking, showResultsTable} from '../ui/results-screen';
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
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = appShellHtml();
const {renderer, lightWorld} = createRenderer(el<HTMLCanvasElement>('game'));
let track = new Track(),
  scene = lightWorld(createWorld(track));
/** Works out the AI's takeoff advice a few milliseconds at a time, so a long custom layout never stalls a frame. */
function warmTakeoffAdvice(t: Track) {
  if (t === track && !prepareTakeoffAdvice(t, 6)) setTimeout(() => warmTakeoffAdvice(t), 0);
}
warmTakeoffAdvice(track);
let reviewPad: GamepadLike | null = null;
const menuGamepads = () => (reviewPad ? [reviewPad] : readBrowserGamepads());
const input = new InputManager(undefined, menuGamepads, () => touchControls.input.read()),
  audio = new GameAudio();
el('track-length').textContent = String(Math.round(track.length));
el('track-sectors').textContent = String(track.sections.filter(s => !s.name.startsWith('BERM')).length);
const touchControls = new TouchControls(app, () => session.togglePause());
let dust = new Dust(scene);
const effects = new RaceEffects(renderer);
let sceneDrawCalls = 0;
const preview = new THREE.PerspectiveCamera(58, 1, 0.1, 1800);
let iphoneMode = false;
let practice = false,
  trial = false,
  humanCount = 1,
  npcCount = 5;
const save = new SaveStore(browserStorage());
// Race flow and rules live in RaceSession; this file is the browser around it.
const session = new RaceSession(input, {
  countdown: n => (el('countdown').innerHTML = `<small>FIND YOUR LINE</small><strong>${n}</strong>`),
  racing: () => setVisible('countdown', false),
  cue: (frequency, seconds) => audio.cue(frequency, seconds),
  landing: impact => audio.landing(impact),
  pause(nowPaused, missing) {
    touchControls.show(iphoneMode && !nowPaused);
    setVisible('pause', nowPaused);
    el('pause-message').textContent = pauseMessage(missing);
    // Resuming is a tap or a key press, which is when a phone lets the sound hardware wake.
    if (nowPaused) audio.hush();
    else audio.start();
  },
  lap(rider, lap) {
    if (!lapCountsForRecord(lap, rider, session.reviewDrive || session.override.size > 0)) return;
    // When another tab already holds a faster lap, show that one as the time to beat.
    if (save.submitLap(recordKey(track.course.id, activeLayout), lap)) session.personalBest = lap;
    else loadPersonalBest();
  },
  ghostLap(rider, lap, lapGhost) {
    const key = recordKey(track.course.id, activeLayout);
    // Autopilot laps never become a ghost, except when a development check asks for one.
    const assisted = !ghost.fromAutopilot && (session.reviewDrive || session.override.size > 0);
    const counts = lapCountsForRecord(lap, rider, assisted);
    void ghosts.submit(key, lapGhost, counts).then(became => {
      // The player may have left for another track while the browser was saving.
      if (became && lapGhost && session.trial && key === recordKey(track.course.id, activeLayout))
        ghost.playback = new GhostPlayback(lapGhost);
      setVisible('ghost-notice', session.trial && ghosts.sessionOnly);
    });
  },
  restarted: () => (prevPoses = []),
  results() {
    touchControls.show(false);
    setVisible('results', true);
    setVisible('countdown', false);
    showResultsTable(track, session.riders, session.lapCount, session.raceTime, session.timing, session.trial);
  },
});
session.slideAggression = save.slideAggression;
// The best lap of the track being ridden in Time Trial, drawn as a translucent bike nobody can touch.
const ghosts = new GhostStore(indexedDbGhosts());
const ghost = {
  playback: null as GhostPlayback | null,
  model: createBike(0xcfe9ff, 0),
  pose: {x: 0, y: 0, z: 0, heading: 0, pitch: 0, lean: 0} as GhostPose,
  last: {x: 0, z: 0},
  shown: false,
  /** Development checks only: lets a lap ridden by the autopilot become the ghost. */
  fromAutopilot: false,
};
ghost.model.root.name = 'Ghost of the best lap';
ghost.model.root.visible = false;
ghost.model.root.traverse(o => {
  if (!(o instanceof THREE.Mesh)) return;
  o.castShadow = false;
  const seeThrough = (m: THREE.Material) => {
    const see = m.clone();
    see.transparent = true;
    see.opacity = 0.32;
    see.depthWrite = false;
    return see;
  };
  o.material = Array.isArray(o.material) ? o.material.map(seeThrough) : seeThrough(o.material);
});
scene.add(ghost.model.root);
/** Fetches the stored ghost for the track about to be ridden. */
function loadGhost() {
  ghost.playback = null;
  const key = recordKey(track.course.id, activeLayout);
  void ghosts.load(key).then(stored => {
    if (stored && session.trial && key === recordKey(track.course.id, activeLayout))
      ghost.playback = new GhostPlayback(stored);
    setVisible('ghost-notice', session.trial && ghosts.sessionOnly);
  });
}
/** Puts the ghost where the best lap was at this moment of the lap. It is drawn only; physics never sees it. */
function syncGhost(dt: number) {
  const {playback, model, pose} = ghost;
  const riding = session.trial && (session.phase === 'racing' || session.phase === 'countdown');
  const lapTime = riding
    ? currentLapTime(session.timing[0], session.raceTime + (session.paused ? 0 : session.accumulator))
    : 0;
  // The ghost stops being drawn a moment after it finishes its lap, so it does not park on the line.
  ghost.shown = !!playback && riding && save.showGhost && lapTime <= playback.time + 0.25;
  model.root.visible = ghost.shown;
  if (!ghost.shown || !playback) return;
  playback.at(lapTime, pose);
  const speed = dt > 0 ? Math.hypot(pose.x - ghost.last.x, pose.z - ghost.last.z) / dt : 0;
  ghost.last.x = pose.x;
  ghost.last.z = pose.z;
  model.root.position.set(pose.x, pose.y, pose.z);
  model.root.rotation.y = pose.heading;
  model.animate(
    {
      speed: Math.min(TUNING.maxSpeed, speed),
      steer: 0,
      lean: pose.lean,
      pitch: pose.pitch,
      compression: 0.1,
      powerSlide: 0,
      slipAngle: 0,
      time: globalTime,
      throttle: 1,
      brake: 0,
      groundDistance: Math.max(
        0,
        pose.y - track.height(track.project(pose.x, pose.z).s, track.project(pose.x, pose.z).lateral),
      ),
      crashed: false,
      crashAge: 0,
      airLean: 0,
      crashSide: 1,
    },
    dt,
  );
}
let cameraDistance: number = TUNING.cameraDistance,
  cameraShake: number = TUNING.cameraShake,
  renderScale = 1;
let assignments: (Device | null)[] = [{kind: 'keyboard'}, null, null, null],
  ready = [true, false, false, false];
let models: ReturnType<typeof createBike>[] = [],
  cameras: ChaseCamera[] = [];
let viewHud: HTMLElement[] = [],
  fpsFrames: number[] = [],
  lastHud = 0,
  globalTime = 0;
let prevPoses: Pose[] = [],
  stepCounts: number[] = [];
let lastPadSignature = '',
  padButtons = new Map<number, boolean>();
let frameCount = 0;
let activeLayout: TrackLayout | null = null;
let testMarkers = new THREE.Group();
scene.add(testMarkers);
// The track editor is downloaded the first time it is opened, so it adds nothing to the first load.
let editor: TrackEditor | null = null,
  editorLoading: Promise<TrackEditor> | null = null;
const editorOpen = () => !!editor?.isOpen;
function loadEditor() {
  editorLoading ||= import('../track-editor').then(
    ({TrackEditor}) =>
      (editor = new TrackEditor(
        (layout, ride) => {
          save.saveLayout(layout); // Throw before changing the race if browser storage fails.
          activeLayout = layout;
          el<HTMLSelectElement>('track-layout').value = 'custom';
          rebuildTrack(new Track(courseById(layout.courseId), layout));
          setVisible('setup', true);
          if (ride) {
            setMode('practice');
            startRace();
          }
        },
        () => setVisible('setup', true),
      )),
  );
  // A failed download (offline, say) must not block the next try.
  editorLoading.catch(() => (editorLoading = null));
  return editorLoading;
}
async function openEditor() {
  // Download first and only then leave the race, so a failed download costs nothing.
  const from = {phase: session.phase, paused: session.paused};
  const buttons = [el<HTMLButtonElement>('open-editor'), el<HTMLButtonElement>('pause-editor')];
  let loaded: TrackEditor;
  buttons.forEach(b => (b.disabled = true));
  try {
    loaded = await loadEditor();
  } catch {
    const message = 'The track editor could not be downloaded. Check the connection and try again.';
    el('setup-status').textContent = message;
    el('pause-message').textContent = message;
    return;
  } finally {
    buttons.forEach(b => (b.disabled = false));
  }
  // If the player moved on while it downloaded (started a race, resumed), leave them where they are.
  if (loaded.isOpen || session.phase !== from.phase || session.paused !== from.paused) return;
  session.reviewDrive = false;
  session.reviewFrozen = false;
  session.reviewCrashTest = '';
  toSetup();
  setVisible('setup', false);
  loaded.open(activeLayout || layoutFromTrack(track));
}
function rebuildTrack(next: Track) {
  touchControls.clear();
  session.override.clear();
  disposeWorld(scene);
  models = [];
  track = next;
  warmTakeoffAdvice(track);
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
  const stored = save.layout(track.course.id);
  el<HTMLOptionElement>('track-layout').querySelector<HTMLOptionElement>('option[value="custom"]')!.disabled = !stored;
  el<HTMLSelectElement>('track-layout').value = activeLayout ? 'custom' : 'original';
}

function refreshNpcOptions() {
  const s = el<HTMLSelectElement>('npcs');
  npcCount = practice || trial ? 0 : Math.min(npcCount, 8 - humanCount);
  s.innerHTML = npcOptionsHtml(humanCount);
  s.value = String(npcCount);
  s.disabled = practice || trial;
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
  session.grid({track, humanCount, npcCount, practice, trial, assignments});
  models = session.riders.map(r => {
    const m = createBike(r.color, r.id + 1);
    scene.add(m.root);
    return m;
  });
  cameras = Array.from({length: humanCount}, () => new ChaseCamera());
  syncModels(0);
}
/** Loads the saved best lap for the track about to be ridden, for the HUD to compare against. */
function loadPersonalBest() {
  const record = save.bestLap(recordKey(track.course.id, activeLayout));
  session.personalBest = record ? {time: record.time, sectors: record.sectors, valid: true} : null;
}
function buildHud(lapCount: number) {
  loadPersonalBest();
  el('hud').innerHTML = hudHtml(humanCount, session.riders, assignments, practice || trial, lapCount);
  viewHud = [...el('hud').querySelectorAll<HTMLElement>('.viewport-hud')];
}
function startRace() {
  humanCount = Number(el<HTMLSelectElement>('humans').value);
  npcCount = Number(el<HTMLSelectElement>('npcs').value);
  const lapCount = Number(el<HTMLSelectElement>('laps').value);
  const difficulty = el<HTMLSelectElement>('difficulty').value;
  if (!devicesReady(assignments, humanCount)) return;
  testMarkers.visible = practice;
  touchControls.clear();
  document.body.classList.toggle('iphone-session', iphoneMode);
  buildGrid();
  buildHud(lapCount);
  if (trial) loadGhost();
  else ghost.playback = null;
  setVisible('restart-lap', trial);
  setVisible('restart-lap-pause', trial);
  setVisible('ghost-notice', trial && ghosts.sessionOnly);
  for (const prefix of ['', 'pause-']) setVisible(`${prefix}ghost-setting`, trial || prefix === '');
  el('restart-pause').textContent = trial ? 'RESTART TIME TRIAL' : 'RESTART RACE';
  el('setup-pause').textContent = trial ? 'END TIME TRIAL' : 'RACE SETUP';
  // A new seed every race: the computer riders' mistakes fall on different jumps each time.
  session.start({lapCount, difficulty, seed: (Date.now() % 4294967295) + 1});
  prevPoses = [];
  setVisible('setup', false);
  setVisible('results', false);
  setVisible('pause', false);
  setVisible('hud', true);
  setVisible('race-bar', true);
  setVisible('countdown', true);
  touchControls.show(iphoneMode);
  audio.start();
  el('session-label').textContent =
    `${(track.customName || track.course.name).toUpperCase()} / ${trial ? 'TIME TRIAL' : practice ? 'FREE PRACTICE' : 'RACE NIGHT'}`;
  el('countdown').innerHTML = '<small>FIND YOUR LINE</small><strong>3</strong>';
  updateHud(hudContext());
}
function toSetup() {
  testMarkers.visible = false;
  touchControls.show(false);
  document.body.classList.remove('iphone-session');
  session.toSetup();
  audio.hush();
  ['hud', 'pause', 'results', 'countdown', 'race-bar'].forEach(id => setVisible(id, false));
  setVisible('setup', true);
  refreshSlots();
}
// Rider pose to draw: between the last two physics steps, so frames that run an uneven number of steps don't jump.
function drawPose(r: Rider, i: number): Pose {
  return session.paused || session.reviewFrozen || session.phase === 'setup'
    ? capturePose(r)
    : blendPose(prevPoses[i], r, session.accumulator / TUNING.step);
}
function syncModels(dt: number) {
  session.riders.forEach((r, i) => {
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
        airLean: r.airLean,
        crashSide: r.crashSide,
      },
      dt,
    );
  });
}
function hudContext(): HudContext {
  const {riders, phase, lapCount, raceTime, firstFinish} = session;
  return {
    track,
    riders,
    viewHud,
    phase,
    practice: practice || trial,
    lapCount,
    humanCount,
    raceTime,
    firstFinish,
    iphoneMode,
    timing: session.timing,
    referenceLap: index => session.referenceLap(index),
  };
}
const audioCost: number[] = [];
let audioFault: unknown = null;
/** What the sound follows this frame: the riders, their race positions and where each human camera is. */
function soundFrame(dt: number): SoundFrame {
  const riders = session.riders,
    listening = session.phase !== 'setup',
    order = listening ? ranking(riders, track) : [];
  return {
    phase: session.phase,
    paused: session.paused || session.reviewFrozen,
    practice: practice || trial,
    riders,
    positions: riders.map(r => order.indexOf(r) + 1),
    ears: listening
      ? cameras.slice(0, humanCount).map(c => ({x: c.camera.position.x, z: c.camera.position.z, yaw: c.yaw}))
      : [],
    dt,
  };
}
function renderContext(): RenderContext {
  return {
    renderer,
    effects,
    scene,
    preview,
    track,
    riders: session.riders,
    models,
    cameras,
    phase: session.phase,
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
  return editorOpen()
    ? el('track-editor')
    : session.paused
      ? el('pause')
      : session.phase === 'setup'
        ? el('setup')
        : session.phase === 'results'
          ? el('results')
          : null;
}
function menuAction(event: MenuEvent) {
  const root = menuRoot();
  if (!root) return;
  const {action, scale} = event;
  if (editorOpen()) {
    if (['previous', 'next', 'kind', 'highlight', 'moveLeft', 'moveRight', 'moveUp', 'moveDown'].includes(action)) {
      editor?.controller(action, scale);
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
    if (session.paused) session.togglePause();
    else if (session.phase === 'setup' && action === 'start') el<HTMLButtonElement>('start').click();
    else if (session.phase === 'results') el(action === 'start' ? 'restart-results' : 'setup-results').click();
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
  controllerHint.hidden = !root || editorOpen() || !Array.from(pads).some(p => p && p.connected !== false);
  // Consume riding button edges while in menus, so B/Menu cannot reset or pause
  // the bike as the menu closes. Keyboard pause continues to work here too.
  if (root)
    for (const r of session.riders.filter(r => r.human && r.device)) {
      const c = input.sample(r.device!);
      if (session.paused && r.device?.kind === 'keyboard' && c.pause) session.togglePause();
    }
  for (const event of menuPad.update(pads, now))
    if (root && !(event.action === 'accept' && consumed.has(event.index))) menuAction(event);
  if (root && !menuRoot()) {
    for (const r of session.riders.filter(r => r.human && r.device)) input.sample(r.device!);
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
    if (session.phase === 'setup') refreshSlots();
    else session.checkControllers();
  }
  for (const index of padButtons.keys()) if (!pads.some(p => p.index === index)) padButtons.delete(index);
  if (session.phase === 'setup') controllerStatus();
  for (const p of Array.from(menuGamepads())) {
    if (!p || p.connected === false) continue;
    const pressed = !!p.buttons[0]?.pressed || (p.buttons[0]?.value || 0) > 0.5;
    const join = pressed && !padButtons.get(p.index);
    padButtons.set(p.index, pressed);
    if (session.phase !== 'setup' || iphoneMode || editorOpen()) continue;
    // Only visible slots count: a pad left in a hidden slot (after lowering the rider count) can still join.
    const assigned = assignments.slice(0, humanCount).findIndex(d => d?.kind === 'gamepad' && d.index === p.index);
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
  // Controllers do nothing until the loading screen has gone, so a race cannot start unseen.
  if (!isLoading()) pollMenus(now, pollJoins());
  const steps = session.advance(dt, () => (prevPoses = session.riders.map(capturePose)));
  if (raw > 0 && raw < 0.5) {
    stepCounts.push(steps);
    if (stepCounts.length > 600) stepCounts.shift();
  }
  if (editorOpen()) {
    // The editor is silent, like a pause.
    audio.frame({...soundFrame(dt), paused: true});
    requestAnimationFrame(frame);
    return;
  }
  syncModels(session.paused || session.reviewFrozen ? 0 : dt);
  syncGhost(session.paused || session.reviewFrozen ? 0 : dt);
  dust.update(session.riders, session.paused || session.reviewFrozen || session.phase !== 'racing' ? 0 : dt);
  sceneDrawCalls = renderViews(renderContext(), dt);
  if (now - lastHud > 100 && session.phase !== 'setup') {
    updateHud(hudContext());
    lastHud = now;
  }
  const audioStart = performance.now();
  // Sound must never stop the race: a fault here is reported once and the frame carries on.
  try {
    audio.frame(soundFrame(dt));
  } catch (error) {
    if (!audioFault) console.error((audioFault = error));
  }
  audioCost.push(performance.now() - audioStart);
  if (audioCost.length > 600) audioCost.shift();
  requestAnimationFrame(frame);
}
function setMode(mode: 'race' | 'practice' | 'trial') {
  practice = mode === 'practice';
  trial = mode === 'trial';
  const solo = practice || trial;
  el('practice-mode').classList.toggle('active', practice);
  el('trial-mode').classList.toggle('active', trial);
  el('race-mode').classList.toggle('active', !solo);
  if (solo) {
    humanCount = 1;
    el<HTMLSelectElement>('humans').value = '1';
  }
  setVisible('ghost-setting', trial);
  el<HTMLSelectElement>('humans').disabled = solo || iphoneMode;
  el<HTMLSelectElement>('laps').disabled = solo;
  el<HTMLSelectElement>('difficulty').disabled = solo;
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
  el<HTMLSelectElement>('humans').disabled = practice || trial || iphoneMode;
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
el('race-mode').onclick = () => setMode('race');
el('practice-mode').onclick = () => setMode('practice');
el('trial-mode').onclick = () => setMode('trial');
el('restart-lap').onclick = () => {
  session.restartLap();
  el('restart-lap').blur();
};
// The same from the pause menu, where a controller can reach it.
el('restart-lap-pause').onclick = () => {
  session.togglePause();
  session.restartLap();
};
for (const prefix of ['', 'pause-']) {
  const box = el<HTMLInputElement>(`${prefix}show-ghost`);
  box.checked = save.showGhost;
  box.onchange = () => {
    save.setShowGhost(box.checked);
    for (const other of ['', 'pause-']) el<HTMLInputElement>(`${other}show-ghost`).checked = box.checked;
  };
}
el<HTMLSelectElement>('humans').onchange = e => {
  humanCount = Number((e.target as HTMLSelectElement).value);
  refreshNpcOptions();
  refreshSlots();
};
el<HTMLSelectElement>('npcs').onchange = e => (npcCount = Number((e.target as HTMLSelectElement).value));
el('start').onclick = startRace;
el('pause-button').onclick = () => session.togglePause();
el('resume').onclick = () => session.togglePause();
for (const id of ['restart-pause', 'restart-results']) el(id).onclick = startRace;
// Leaving a Time Trial from the pause menu shows the laps of the session first.
el('setup-pause').onclick = () => {
  if (session.trial) {
    setVisible('pause', false);
    session.leaveTrial();
  } else toSetup();
};
el('setup-results').onclick = toSetup;
function toggleMute() {
  audio.muted = !audio.muted;
  el('sound').textContent = audio.muted ? 'SOUND OFF' : 'SOUND ON';
  el('race-mute').textContent = audio.muted ? '♪ MUTED' : '♪ SOUND ON';
}
function syncVolumes() {
  audio.setVolumes(save.volumes);
  for (const prefix of ['', 'pause-'])
    for (const key of VOLUME_KEYS) {
      const percent = Math.round(save.volumes[key] * 100);
      el<HTMLInputElement>(`${prefix}vol-${key}`).value = String(percent);
      el(`${prefix}vol-${key}-value`).textContent = percent ? `${percent}%` : 'Off';
    }
}
for (const prefix of ['', 'pause-'])
  for (const key of VOLUME_KEYS) {
    const slider = el<HTMLInputElement>(`${prefix}vol-${key}`);
    // Heard while dragging; written to the save once, when the slider is let go.
    slider.oninput = () => {
      save.data.settings.volumes = normalizeVolumes({...save.volumes, [key]: Number(slider.value) / 100});
      syncVolumes();
    };
    slider.onchange = () => save.setVolumes(save.volumes);
  }
syncVolumes();
// A tab switched away in the moment after the flag would otherwise leave the crowd ringing.
document.addEventListener('visibilitychange', () => document.hidden && audio.hush());
// A race started from a controller is not a tap, so the browser may hold the sound back until the first touch or key.
for (const type of ['pointerdown', 'keydown', 'touchend']) addEventListener(type, () => audio.wake(), {passive: true});
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
    el<HTMLInputElement>(`${prefix}slide-aggression`).value = String(Math.round(session.slideAggression * 100));
    el(`${prefix}slide-value`).textContent =
      session.slideAggression === 0 ? 'Off' : `${Math.round(session.slideAggression * 100)}%`;
  }
}
for (const prefix of ['', 'pause-'])
  el<HTMLInputElement>(`${prefix}slide-aggression`).oninput = e => {
    session.slideAggression = save.setSlideAggression(Number((e.target as HTMLInputElement).value) / 100);
    syncSlideSetting();
  };
syncSlideSetting();
el<HTMLSelectElement>('render-scale').onchange = e => {
  renderScale = Number((e.target as HTMLSelectElement).value);
  resize();
};
addEventListener('keydown', e => {
  if (!editorOpen() && e.code === 'KeyM' && !e.repeat && !(e.target instanceof HTMLInputElement)) toggleMute();
  if (!editorOpen() && e.code === 'Backspace' && !e.repeat && !(e.target instanceof HTMLInputElement))
    session.restartLap();
});
addEventListener('blur', () => {
  if ((session.phase === 'racing' || session.phase === 'countdown') && !session.paused) session.togglePause();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (session.phase === 'racing' || session.phase === 'countdown') && !session.paused)
    session.togglePause();
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
  if (session.phase !== 'setup') return;
  activeLayout = null;
  rebuildTrack(new Track(courseById(el<HTMLSelectElement>('course').value)));
};
el<HTMLSelectElement>('track-layout').onchange = () => {
  activeLayout = el<HTMLSelectElement>('track-layout').value === 'custom' ? save.layout(track.course.id) : null;
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
watchLoading();
// Development-only deterministic controls and telemetry for repeatable local verification.
if (import.meta.env.DEV) {
  (window as any).__game = {
    get track() {
      return track;
    },
    riders: () => session.riders,
    timing: () => session.timing,
    snapshot: () => ({
      course: track.course.id,
      phase: session.phase,
      paused: session.paused,
      practice,
      trial: session.trial,
      ghost: {
        loaded: !!ghost.playback,
        time: ghost.playback?.time ?? null,
        shown: ghost.shown,
        sessionOnly: ghosts.sessionOnly,
        x: ghost.pose.x,
        y: ghost.pose.y,
        z: ghost.pose.z,
      },
      raceTime: session.raceTime,
      humanCount,
      npcCount,
      fps: fpsFrames.length / fpsFrames.reduce((a, b) => a + b, 0),
      seed: session.seed,
      audioMs: audioCost.reduce((a, b) => a + b, 0) / Math.max(1, audioCost.length),
      audio: {open: audio.open, muted: audio.muted, oscillators: audio.oscillators, played: audio.played},
      frameCount,
      resolution: [innerWidth, innerHeight],
      renderScale,
      riders: session.riders.map(r => ({
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
      if (c) session.override.set(id, {...idleControl(), ...c});
      else session.override.delete(id);
    },
    drive: (id: number) => {
      const r = session.riders[id];
      session.override.set(id, npcControl(r, track, session.riders, 'club'));
    },
    restartLap: () => session.restartLap(),
    ghostFromAutopilot: (on: boolean) => (ghost.fromAutopilot = on),
    clearPerf: () => {
      fpsFrames = [];
      stepCounts = [];
    },
    step: (seconds: number) => {
      for (let t = 0; t < seconds; t += TUNING.step) session.step(TUNING.step);
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
        session.reviewDrive = true;
        session.reviewFrozen = false;
        session.paused = false;
        practice = false;
        trial = false;
        iphoneMode = false;
        session.reviewCrashTest = kind === 'Crash landing' || kind === 'Rider contact' ? kind : '';
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
            const r = session.riders[i],
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
          session.step(TUNING.step);
          dust.update(session.riders, TUNING.step);
          if (
            session.phase === 'racing' &&
            (session.reviewCrashTest
              ? session.riders[0].crashTime > 0 && session.riders[0].crashAge > 0.45
              : target === 0 ||
                (session.raceTime > 1 &&
                  session.riders[0].surface.s >= target &&
                  session.riders[0].surface.s < target + 8))
          )
            break;
        }
        // The Scrub shot is the Jump shot with the lead rider laid over as a full scrub leaves the bike.
        if (kind === 'Scrub') Object.assign(session.riders[0], {scrub: true, airLean: TUNING.scrubLean});
        session.reviewFrozen = true;
        syncModels(0);
        updateHud(hudContext());
        cameras.forEach(c => (c.initialized = false));
        fpsFrames = [];
      },
      run() {
        session.reviewFrozen = !session.reviewFrozen;
        session.paused = false;
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
