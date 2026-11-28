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
import type {WearLayer} from '../track-material';
import type {SurfaceMesh} from '../surface-mesh';
import {createBike} from '../bike-model';
import {riderLabel} from '../riders';
import {PRO_PACE, allowedPace} from '../rider-settings';
import {chooseSwatch, readRiderEditor, showRiderEditor} from '../ui/rider-editor';
import {createGateBars, type GateBars} from '../start-gate-model';
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
import {GhostPlayback, GhostStore, indexedDbGhosts, type Ghost, type GhostPose} from '../ghost';
import {currentLapTime} from '../timing';
import {browserStorage, lapCountsForRecord, recordKey, SaveStore} from '../save';
import {
  SEASON_ROUNDS,
  nextRace,
  raceTitle,
  recordRace,
  seasonComplete,
  seasonUnfinished,
  seasonAwards,
  seasonWithRiders,
  startNewSeason,
  type Season,
  type SeasonRace,
} from '../season';
import {seasonGrid, seasonOrder, seasonStart} from './season-run';
import {devicesReady, RaceSession} from './race-session';
import {blendPose, capturePose, pacingStats, type Pose} from '../render-interp';
import {createRenderer, renderViews, resizeRenderer, type RenderContext} from '../render/renderer';
import {el, setVisible} from '../ui/dom';
import {isLoading, watchLoading} from '../ui/loading';
import {hudHtml, updateHud, type HudContext} from '../ui/hud';
import {pauseMessage} from '../ui/pause-menu';
import {ranking, showResultsTable, showStandingsTable, standingsRowsHtml} from '../ui/results-screen';
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
/** Championship mode, the season in hand, and the season race on the grid or being run (null otherwise). */
let seasonMode = false,
  season: Season | null = save.season,
  seasonRace: SeasonRace | null = null;
/** The season race whose result is on screen, and whether the window is showing the standings after it. */
let racedInSeason: SeasonRace | null = null,
  showingStandings = false,
  seasonKept = true;
// Race flow and rules live in RaceSession; this file is the browser around it.
const session = new RaceSession(input, {
  countdown: n => (el('countdown').innerHTML = countdownHtml(n)),
  racing: () => setVisible('countdown', false),
  gateDropped: () => audio.clang(),
  jumpedGate: () => audio.cue(180, 0.25),
  holeshot: rider => (holeshot = {name: riderLabel(rider), id: rider.id, time: session.raceTime}),
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
    // A lap ridden on ruts and bumps is not comparable with one ridden on the track as built: no record.
    if (!track.surface && save.submitLap(recordKey(track.course.id, activeLayout), lap)) session.personalBest = lap;
    else loadPersonalBest();
  },
  ghostLap(rider, lap, lapGhost) {
    const key = recordKey(track.course.id, activeLayout);
    // Autopilot laps never become a ghost, except when a development check asks for one.
    const assisted = !ghost.fromAutopilot && (session.reviewDrive || session.override.size > 0);
    // Nor does a lap ridden on ruts and bumps: its ghost would be chased on a track without them.
    const counts = !track.surface && lapCountsForRecord(lap, rider, assisted);
    // The player may have left for another track while the browser was saving: showGhostFor checks.
    void ghosts.submit(key, lapGhost, counts).then(became => showGhostFor(key, became ? lapGhost : null));
  },
  restarted: () => (prevPoses = []),
  results() {
    touchControls.show(false);
    setVisible('results', true);
    setVisible('countdown', false);
    // A season race is recorded and saved the moment it ends, so closing the game now loses nothing.
    racedInSeason = seasonRace;
    showingStandings = false;
    if (season && seasonRace) {
      const order = seasonOrder(session);
      season = recordRace(season, order);
      seasonKept = save.setSeason(season);
      unlockNotice = seasonUnlocks(season, seasonRace, order);
      seasonRace = null;
    } else unlockNotice = '';
    el('results-unlock').textContent = unlockNotice;
    setVisible('results-unlock', !!unlockNotice);
    showResultsTable(
      track,
      session.riders,
      session.lapCount,
      session.raceTime,
      session.timing,
      session.trial,
      session.holeshot,
      racedInSeason && {
        title: raceTitle(racedInSeason),
        seconds: racedInSeason.seconds,
        scores: racedInSeason.stage === 'main',
      },
    );
    labelResultsButtons();
  },
});
session.slideAggression = save.slideAggression;
/** What the race just run unlocked, for the results window. */
let unlockNotice = '';
/**
 * A championship main has been recorded: a human who won it unlocks the next colour set, and a human who has
 * won the championship unlocks Pro pace. Each is given once. Returns what to tell the players.
 */
function seasonUnlocks(after: Season, race: SeasonRace, order: number[]) {
  const earned = seasonAwards(after, race, order);
  const notices: string[] = [];
  if (earned.roundWin) {
    const set = save.awardRoundWin(after, race.round);
    if (set) notices.push(`ROUND WIN: THE ${set.name} COLOURS ARE UNLOCKED FOR EVERY RIDER.`);
  }
  if (earned.champion && save.awardSeasonWin()) notices.push('CHAMPION: PRO PACE IS UNLOCKED.');
  if (notices.length) refreshUnlocks();
  return notices.join(' ');
}
/** Pro pace can be chosen only once it is unlocked. */
function refreshUnlocks() {
  const select = el<HTMLSelectElement>('difficulty');
  const pro = select.querySelector<HTMLOptionElement>('option[value="pro"]')!;
  const open = save.unlocks.includes(PRO_PACE);
  pro.disabled = !open;
  pro.textContent = open ? 'Pro' : 'Pro / win a championship to unlock';
  if (!open && select.value === 'pro') select.value = 'expert';
}
/** The pace setting chosen, never a locked one. */
const chosenPace = () => allowedPace(el<HTMLSelectElement>('difficulty').value, save.unlocks);
/** The season with its players under the names, numbers and colours they have now. */
const dressed = (s: Season) => seasonWithRiders(s, save.riders);
/** Who took the holeshot in the race being run, for the banner. */
let holeshot: HudContext['holeshot'] = null;
/** The big text before a start: the board and then the wait for a race's gate, or 3-2-1 without a gate. */
function countdownHtml(n: number) {
  // With a gate the number sits high and small, so the bars and the rev meter stay in view.
  el('countdown').classList.toggle('at-gate', !!session.gate);
  if (!session.gate) return `<small>FIND YOUR LINE</small><strong>${n}</strong>`;
  return n > 0
    ? `<small>THE GATE DROPS AFTER THE BOARD</small><strong>${n}</strong>`
    : `<small>WATCH THE GATE</small><strong class="gate-live">READY</strong>`;
}
/** The gate bars on the grid of a race, and how far they have fallen (0 standing, 1 flat). */
let gateBars: GateBars | null = null,
  gateOpen = 0;
function syncGate(dt: number) {
  if (!gateBars) return;
  const waiting = session.phase === 'countdown' || session.phase === 'setup';
  gateOpen = waiting ? 0 : Math.min(1, gateOpen + dt / 0.14);
  gateBars.set(gateOpen);
}
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
  void ghosts.load(key).then(stored => showGhostFor(key, stored));
}
/** Makes a ghost the one being drawn, if the player is still in Time Trial on the track it belongs to. */
function showGhostFor(key: string, found: Ghost | null) {
  if (found && session.trial && key === recordKey(track.course.id, activeLayout))
    ghost.playback = new GhostPlayback(found);
  setVisible('ghost-notice', session.trial && ghosts.sessionOnly);
}
// The browser's storage can answer after the game stopped waiting for it.
ghosts.onLate = showGhostFor;
/** Puts the ghost where the best lap was at this moment of the lap. It is drawn only; physics never sees it. */
function syncGhost(dt: number) {
  const {playback, model, pose} = ghost;
  const riding = session.trial && (session.phase === 'racing' || session.phase === 'countdown');
  // Riders are drawn part of the way from their last physics step to the next; the ghost is drawn at the same
  // moment, which is one step behind the lap clock plus that part.
  const drawnAt =
    session.raceTime + (session.paused || session.phase !== 'racing' ? 0 : session.accumulator - TUNING.step);
  const lapTime = riding ? Math.max(0, currentLapTime(session.timing[0], drawnAt)) : 0;
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
  const under = track.project(pose.x, pose.z);
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
      groundDistance: Math.max(0, pose.y - track.height(under.s, under.lateral)),
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
/** The seed of the race on the grid: roster order and mistakes. 0 until the first race is started. */
let gridSeed = 0;
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
  // The ghost belongs to no track: it is taken out before the old world is thrown away and put into the new one.
  scene.remove(ghost.model.root);
  disposeWorld(scene);
  models = [];
  // The old world took the gate with it; the next grid builds a new one.
  gateBars = null;
  track = next;
  warmTakeoffAdvice(track);
  scene = lightWorld(createWorld(track));
  scene.add(ghost.model.root);
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

/** The player whose rider is being edited, or null. */
let editingRider: number | null = null;
const riderEditorOpen = () => editingRider !== null;
function openRiderEditor(player: number) {
  if (session.phase !== 'setup' || !save.riders[player]) return;
  editingRider = player;
  showRiderEditor(player, save.riders[player], save.unlocks);
}
function closeRiderEditor() {
  editingRider = null;
  setVisible('rider-editor', false);
}
el('rider-editor').addEventListener('click', e => {
  const swatch = (e.target as HTMLElement).closest<HTMLButtonElement>('.swatch');
  if (swatch && !swatch.disabled) chooseSwatch(swatch);
});
el<HTMLFormElement>('rider-form').onsubmit = e => {
  e.preventDefault();
  if (editingRider === null) return;
  // Refused with the reasons shown, and nothing changed, if a name or number is invalid or taken.
  const result = save.setRider(editingRider, readRiderEditor());
  if (!result.ok) {
    el('rider-errors').textContent = result.errors.join(' ');
    return;
  }
  closeRiderEditor();
  refreshSlots();
  refreshSeason();
};
el('rider-cancel').onclick = closeRiderEditor;
el('rider-editor').addEventListener('keydown', e => {
  if (e.key === 'Escape') closeRiderEditor();
});
function refreshNpcOptions() {
  const s = el<HTMLSelectElement>('npcs');
  npcCount = practice || trial ? 0 : Math.min(npcCount, 8 - humanCount);
  s.innerHTML = npcOptionsHtml(humanCount);
  s.value = String(npcCount);
  s.disabled = practice || trial || seasonMode;
}
function refreshSlots() {
  const pads = input.connectedGamepads();
  el('slots').innerHTML = slotsHtml(humanCount, ready, iphoneMode, pads, save.riders);
  el('slots')
    .querySelectorAll<HTMLButtonElement>('[data-rider]')
    .forEach(b => (b.onclick = () => openRiderEditor(Number(b.dataset.rider))));
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
  const riders = seasonRunning() ? season!.entrants.filter(e => e.human).length : 1;
  el('setup-status').textContent = valid
    ? 'All riders ready. See you at the gate.'
    : iphoneMode && riders > 1
      ? `This season has ${riders} riders. Choose Mac / Keyboard & gamepads above to carry on with it.`
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
  const difficulty = chosenPace();
  const humans = save.riders.map(r => ({name: r.name, number: r.number, color: r.bike}));
  session.grid(
    season && seasonRace
      ? seasonGrid(dressed(season), seasonRace, track, assignments)
      : {track, humanCount, npcCount, practice, trial, assignments, difficulty, seed: gridSeed, humans},
  );
  if (gateBars) {
    scene.remove(gateBars.group);
    gateBars.dispose();
    gateBars = null;
  }
  if (!practice && !trial) {
    gateBars = createGateBars(track, session.riders.length);
    scene.add(gateBars.group);
    gateOpen = 0;
    gateBars.set(0);
  }
  models = session.riders.map(r => {
    const mine = r.human ? save.riders[r.id] : undefined;
    const m = createBike(
      r.color,
      r.profile?.number ?? r.number ?? r.id + 1,
      mine && {kit: mine.kit, helmet: mine.helmet, design: mine.design},
    );
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
  el('hud').innerHTML = hudHtml(
    humanCount,
    session.riders,
    assignments,
    practice || trial,
    lapCount,
    seasonRace ? 'CHAMPIONSHIP' : undefined,
  );
  viewHud = [...el('hud').querySelectorAll<HTMLElement>('.viewport-hud')];
}
/** True in Championship mode while the season in hand has races still to run. */
const seasonRunning = () => seasonMode && !!season && !seasonComplete(season);
/** What the two buttons under the results do next: another ride, the next season race, or the standings. */
function labelResultsButtons() {
  const next = season && racedInSeason ? nextRace(season) : null;
  const label = !racedInSeason
    ? 'ONE MORE RIDE'
    : racedInSeason.stage === 'main' && !showingStandings
      ? 'STANDINGS'
      : next
        ? next.stage === 'main'
          ? 'LINE UP FOR THE MAIN'
          : `ROUND ${next.round + 1} HEAT`
        : 'RETURN TO SETUP';
  el('restart-results').innerHTML = `${label} <span>↗</span>`;
  el('setup-results').textContent = !racedInSeason
    ? 'RETURN TO SETUP'
    : seasonKept
      ? 'SEASON SAVED · RETURN TO SETUP'
      : 'RETURN TO SETUP · THIS BROWSER IS NOT KEEPING THE SEASON';
  setVisible('setup-results', !racedInSeason || !!next || !showingStandings);
}
/** The main button under the results. */
function afterResults() {
  if (!racedInSeason || !season) return startRace();
  if (racedInSeason.stage === 'main' && !showingStandings) {
    showingStandings = true;
    showStandingsTable(dressed(season));
    labelResultsButtons();
    return;
  }
  if (seasonComplete(season)) toSetup();
  else startRace();
}
/** Championship: the race to run now, starting a new season first if there is none to carry on with. */
function seasonRaceToRun() {
  if (!season || seasonComplete(season)) {
    // Another tab may have started a season since this page loaded. Show it instead of starting over it.
    const stored = new SaveStore(browserStorage()).season;
    if (stored && seasonUnfinished(stored)) {
      season = stored;
      refreshSeason();
      refreshSlots();
      return null;
    }
    const humans = Number(el<HTMLSelectElement>('humans').value);
    const answer = startNewSeason(season, humans, chosenPace(), (Date.now() % 4294967295) + 1);
    if (!('started' in answer)) return null;
    season = answer.started;
    seasonKept = save.setSeason(season);
  }
  return nextRace(season);
}
function startRace() {
  closeRiderEditor();
  if (seasonMode) {
    const humans = season && !seasonComplete(season) ? season.entrants.filter(e => e.human).length : humanCount;
    // Nothing changes if the race cannot start: a season race already running stays the one being run.
    if (!devicesReady(assignments, humans)) return;
    seasonRace = seasonRaceToRun();
    if (!seasonRace || !season) return;
    humanCount = season.entrants.filter(e => e.human).length;
    npcCount = season.entrants.length - humanCount;
    // Season rounds are run on the original circuits.
    if (track.course.id !== seasonRace.course.id || activeLayout) {
      activeLayout = null;
      el<HTMLSelectElement>('course').value = seasonRace.course.id;
      rebuildTrack(new Track(seasonRace.course));
    }
  } else {
    if (!devicesReady(assignments, Number(el<HTMLSelectElement>('humans').value))) return;
    seasonRace = null;
    humanCount = Number(el<HTMLSelectElement>('humans').value);
    npcCount = Number(el<HTMLSelectElement>('npcs').value);
  }
  racedInSeason = null;
  const lapCount = seasonRace ? 0 : Number(el<HTMLSelectElement>('laps').value);
  const difficulty = season && seasonRace ? season.difficulty : chosenPace();
  if (!devicesReady(assignments, humanCount)) return;
  testMarkers.visible = practice;
  touchControls.clear();
  document.body.classList.toggle('iphone-session', iphoneMode);
  // A new seed every race: the roster riders line up in a different order and make different mistakes.
  gridSeed = (Date.now() % 4294967295) + 1;
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
  session.start(
    season && seasonRace
      ? {...seasonStart(season, seasonRace, save.catchUp), wearPhysics: save.wearPhysics}
      : {lapCount, difficulty, seed: gridSeed, catchUp: save.catchUp, wearPhysics: save.wearPhysics},
  );
  holeshot = null;
  prevPoses = [];
  setVisible('setup', false);
  setVisible('results', false);
  setVisible('pause', false);
  setVisible('hud', true);
  setVisible('race-bar', true);
  setVisible('countdown', true);
  touchControls.show(iphoneMode);
  audio.start();
  el('session-label').textContent = seasonRace
    ? raceTitle(seasonRace)
    : `${(track.customName || track.course.name).toUpperCase()} / ${trial ? 'TIME TRIAL' : practice ? 'FREE PRACTICE' : 'RACE NIGHT'}`;
  el('countdown').innerHTML = countdownHtml(session.gate ? session.gate.board : 3);
  updateHud(hudContext());
}
function toSetup() {
  testMarkers.visible = false;
  touchControls.show(false);
  document.body.classList.remove('iphone-session');
  session.toSetup();
  // A season race left before its end is not recorded: the season is still waiting for it.
  seasonRace = null;
  racedInSeason = null;
  audio.hush();
  ['hud', 'pause', 'results', 'countdown', 'race-bar'].forEach(id => setVisible(id, false));
  setVisible('setup', true);
  refreshSeason();
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
        groundDistance: Math.max(0, r.y - track.surfaceHeight(r.surface.s, r.surface.lateral)),
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
    gate: session.gate,
    holeshot,
    timed: session.timeLimit ? {limit: session.timeLimit, flagLap: session.flagLap, flagOut: session.flagOut} : null,
    closeAfter: session.closeAfter,
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
    : riderEditorOpen()
      ? el('rider-editor')
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
    if (riderEditorOpen()) {
      if (action === 'back') closeRiderEditor();
    } else if (session.paused) session.togglePause();
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
    if (session.phase !== 'setup' || iphoneMode || editorOpen() || riderEditorOpen()) continue;
    // Only visible slots count: a pad left in a hidden slot (after lowering the rider count) can still join.
    const assigned = assignments.slice(0, humanCount).findIndex(d => d?.kind === 'gamepad' && d.index === p.index);
    if ((join && (assigned < 0 || !ready[assigned])) || (waitingForController && (pressed || p.index >= 1000))) {
      const slot = controllerJoinSlot(assignments.slice(0, humanCount), p.index, practice);
      // A season in progress has its riders: a new controller can take a free place but not add one.
      if (slot >= 0 && !(slot === humanCount && seasonRunning())) {
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
  (scene.userData.wear as WearLayer | undefined)?.refresh(now);
  track.surface?.warm(2);
  (scene.userData.surface as SurfaceMesh | undefined)?.refresh(now);
  syncGhost(session.paused || session.reviewFrozen ? 0 : dt);
  syncGate(session.paused || session.reviewFrozen ? 0 : dt);
  dust.update(session.riders, session.paused || session.reviewFrozen || session.phase !== 'racing' ? 0 : dt);
  sceneDrawCalls = renderViews(renderContext(), dt);
  // The rev meter has to follow the throttle closely; the rest of the HUD is happy with ten updates a second.
  if (now - lastHud > (session.phase === 'countdown' && session.gate ? 30 : 100) && session.phase !== 'setup') {
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
/**
 * Championship mode's part of the setup screen: what the season is waiting for, the table so far, and which
 * settings can still be changed (the riders and the pace are fixed once a season has started).
 */
function refreshSeason() {
  setVisible('season-panel', seasonMode);
  const solo = practice || trial;
  const running = seasonMode && !!season && !seasonComplete(season);
  const next = running && season ? nextRace(season) : null;
  for (const id of ['course', 'track-layout', 'laps', 'npcs'])
    el<HTMLSelectElement>(id).disabled = seasonMode || (solo && id !== 'course' && id !== 'track-layout');
  el<HTMLButtonElement>('open-editor').disabled = seasonMode;
  el<HTMLSelectElement>('humans').disabled = solo || iphoneMode || running;
  el<HTMLSelectElement>('difficulty').disabled = solo || running;
  el('start').innerHTML = !seasonMode
    ? 'DROP THE GATE <span>↗</span>'
    : next
      ? `START ROUND ${next.round + 1} ${next.stage.toUpperCase()} <span>↗</span>`
      : 'START A NEW SEASON <span>↗</span>';
  if (!seasonMode) return;
  setVisible('season-confirm', false);
  setVisible('new-season', running);
  if (running && season && next) {
    const humans = season.entrants.filter(e => e.human).length;
    humanCount = humans;
    el<HTMLSelectElement>('humans').value = String(humans);
    el<HTMLSelectElement>('difficulty').value = season.difficulty;
    // Show the circuit the season is at.
    if (session.phase === 'setup' && (track.course.id !== next.course.id || activeLayout)) {
      activeLayout = null;
      el<HTMLSelectElement>('course').value = next.course.id;
      rebuildTrack(new Track(next.course));
    }
  }
  el('season-status').textContent = next
    ? `${raceTitle(next)} IS NEXT. ${next.seconds / 60} minutes plus a lap` +
      (next.stage === 'heat' ? '; the result sets the gates for the main.' : '; this one scores.')
    : (season ? 'That season is finished. ' : '') +
      `A season is ${SEASON_ROUNDS} rounds, one on each circuit. Each round is a 3-minute heat that sets the ` +
      `gates and a 6-minute main for points, each plus a lap. Eight riders. Choose the riders and the pace below.`;
  el('season-table').innerHTML = season && season.rounds[0].main ? standingsRowsHtml(dressed(season)) : '';
}
function setMode(mode: 'race' | 'practice' | 'trial' | 'season') {
  practice = mode === 'practice';
  trial = mode === 'trial';
  seasonMode = mode === 'season';
  const solo = practice || trial;
  el('practice-mode').classList.toggle('active', practice);
  el('trial-mode').classList.toggle('active', trial);
  el('season-mode').classList.toggle('active', seasonMode);
  el('race-mode').classList.toggle('active', !solo && !seasonMode);
  if (solo) {
    humanCount = 1;
    el<HTMLSelectElement>('humans').value = '1';
  }
  setVisible('ghost-setting', trial);
  refreshNpcOptions();
  refreshSeason();
  refreshSlots();
}
el<HTMLSelectElement>('play-device').onchange = e => {
  iphoneMode = (e.target as HTMLSelectElement).value === 'iphone';
  if (iphoneMode) stopNativeController();
  else startNativeController();
  touchControls.show(false);
  humanCount = 1;
  el<HTMLSelectElement>('humans').value = '1';
  assignments = [{kind: iphoneMode ? 'touch' : 'keyboard'}, null, null, null];
  ready = [true, false, false, false];
  setVisible('touch-setup-hint', iphoneMode);
  setVisible('touch-directions', iphoneMode);
  setVisible('pause-touch-directions', iphoneMode);
  document.body.classList.toggle('iphone-selected', iphoneMode);
  refreshNpcOptions();
  refreshSeason();
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
el('season-mode').onclick = () => setMode('season');
// Giving up a season that has races in it needs a second, explicit answer.
el('new-season').onclick = () => {
  if (!season) return;
  if (!seasonUnfinished(season)) return forgetSeason();
  const next = nextRace(season)!;
  el('season-confirm-text').textContent =
    `This ends the season in progress at round ${next.round + 1} of ${SEASON_ROUNDS}. Its results and points are lost.`;
  setVisible('season-confirm', true);
  setVisible('new-season', false);
  el('season-confirm-no').focus();
};
el('season-confirm-yes').onclick = forgetSeason;
el('season-confirm-no').onclick = () => {
  refreshSeason();
  refreshSlots();
};
function forgetSeason() {
  season = null;
  seasonKept = save.setSeason(null);
  refreshSeason();
  refreshSlots();
}
el('restart-lap').onclick = () => {
  session.restartLap();
  el('restart-lap').blur();
};
// The same from the pause menu, where a controller can reach it.
el('restart-lap-pause').onclick = () => {
  session.togglePause();
  session.restartLap();
};
{
  const box = el<HTMLInputElement>('catch-up');
  box.checked = save.catchUp;
  box.onchange = () => save.setCatchUp(box.checked);
  const wear = el<HTMLInputElement>('wear-physics');
  wear.checked = save.wearPhysics;
  wear.onchange = () => save.setWearPhysics(wear.checked);
}
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
el('restart-pause').onclick = startRace;
el('restart-results').onclick = afterResults;
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
// A season with races still to run is where the game opens.
if (seasonUnfinished(season)) setMode('season');
refreshUnlocks();
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
    /** The wear grid of the race being run, summed up, and how often its picture has been sent. */
    wear: () => {
      const grid = session.wear,
        layer = scene.userData.wear as WearLayer | undefined;
      let sum = 0,
        worn = 0;
      for (const v of grid?.cells ?? []) {
        sum += v;
        if (v) worn++;
      }
      return {cols: grid?.cols, rows: grid?.rows, bytes: grid?.bytes, sum, worn, uploads: layer?.uploads ?? 0};
    },
    /** Wear physics in the race being run: whether it is on, the deepest rut, the roughest bumps, the mesh redraws. */
    surface: () => {
      const surface = track.surface,
        mesh = scene.userData.surface as SurfaceMesh | undefined;
      let rut = 0,
        rough = 0,
        bump = 0;
      if (surface)
        for (let s = 0; s < track.length; s += 1)
          for (let l = -track.halfWidth; l <= track.halfWidth; l += 0.4) {
            rut = Math.max(rut, surface.rut(s, l));
            rough = Math.max(rough, surface.rough(s, l));
            bump = Math.max(bump, Math.abs(surface.bump(s, l)));
          }
      return {on: !!surface, rut, rough, bump, redraws: mesh?.redraws ?? 0, rows: mesh?.rows ?? 0};
    },
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
        inScene: ghost.model.root.parent === scene,
        sessionOnly: ghosts.sessionOnly,
        x: ghost.pose.x,
        y: ghost.pose.y,
        z: ghost.pose.z,
      },
      gate: session.gate && {
        elapsed: session.gate.elapsed,
        dropAt: session.gate.dropAt,
        live: session.gate.live,
        dropped: session.gate.dropped,
        launches: session.gate.launches.map(({revs, jumped, result, held}) => ({revs, jumped, result, held})),
        bars: gateBars
          ? {inScene: gateBars.group.parent === scene, count: gateBars.group.children.length, open: gateOpen}
          : null,
      },
      holeshot: session.holeshot,
      season: {mode: seasonMode, season, race: seasonRace, raced: racedInSeason, standings: showingStandings},
      timed: {limit: session.timeLimit, flagLap: session.flagLap, flagOut: session.flagOut},
      holeshotLine: track.holeshot,
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
        name: r.name,
        number: r.profile?.number ?? r.number,
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
    /** Swings every chase camera round its rider, in radians from straight behind, for screenshots. */
    orbit: (angle: number) => cameras.forEach(c => (c.orbit = angle)),
    /** Fixes every camera at a place, looking at another, for before and after screenshots; no arguments lets go. */
    view: (from?: number[], to?: number[]) => cameras.forEach(c => (c.fixed = from && to ? {from, to} : null)),
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
    /** Runs the countdown or the gate sequence to its end, so a check can begin with the bikes moving. */
    toRacing: () => {
      for (let t = 0; t < 12 && session.phase === 'countdown'; t += TUNING.step) session.step(TUNING.step);
      syncModels(0);
      updateHud(hudContext());
      return session.phase;
    },
    /** Shortens the clock of the timed race being run, so a check need not ride for six minutes. */
    timeLimit: (seconds: number) => (session.timeLimit = seconds),
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
