// Setup screen markup and the pure helpers it uses: device slots, NPC options and controller status text.
import {COURSES} from '../courses';
import {CSS_COLORS} from '../config';
import {readGamepadStatus, type Device} from '../input';
import {nativeControllerStatus} from '../native-controller';
import type {Track} from '../track';
import {directionSettings, slideSettings} from './ride-settings';
import {raceChromeHtml} from './hud';
import {pauseMenuHtml} from './pause-menu';
import {resultsScreenHtml} from './results-screen';

export function setupScreenHtml() {
  return (
    `<div id="setup" class="screen"><header><a class="wordmark" href="#">A<span>FTERGLOW</span>` +
    `<i>®</i></a><div class="header-meta">STADIUM SERIES <span>` +
    `<span id="header-course">01 / DUSK VALLEY</span></span></div>` +
    `<span id="build-stamp" class="build-stamp" title="Commit this build was made from">BUILD ` +
    `${__BUILD_STAMP__}</span><button id="sound" class="icon-button" title="Toggle ` +
    `sound">SOUND ON</button></header>
<div class="setup-content"><section class="hero">` +
    `<div class="eyebrow"><span class="live-dot"></span> LOCAL MULTIPLAYER / 1–4 RIDERS</div>` +
    `<h1>CHASE THE<br><em>AFTERGLOW.</em></h1><p>Gate drops. Lights rise. Find your rhythm.</p>` +
    `<div class="track-meta"><span><b>05</b> TRACKS</span><span>` +
    `<b id="track-sectors">—</b> SECTIONS</span><span><b id="track-length">—</b> METRES</span>` +
    `</div></section>
<section class="setup-card"><div class="card-heading">` +
    `<span class="eyebrow">YOUR NEXT RIDE</span><span class="tag">LOCAL SESSION</span></div>` +
    `<div class="mode-tabs"><button id="race-mode" class="active">RACE NIGHT</button>` +
    `<button id="practice-mode">FREE PRACTICE</button>` +
    `</div>
<label class="course-label">CIRCUIT<select ` +
    `id="course">${COURSES.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</se` +
    `lect></label><p id="course-description" class="course-description"></p>` +
    `<div class="layout-actions"><label>TRACK LAYOUT<select id="track-layout">` +
    `<option value="original">Original circuit</option>` +
    `<option value="custom">My saved layout</option></select></label>` +
    `<button id="open-editor" type="button">EDIT TRACK ↗</button></div>` +
    `<label class="play-device-label">PLAY ON<select id="play-device">` +
    `<option value="desktop">Mac / Keyboard & gamepads</option>` +
    `<option value="iphone">iPhone / Touch controls</option></select></label>` +
    `<p id="touch-setup-hint" class="touch-setup-hint hidden">One rider + optional NPCs. Use ` +
    `landscape. Left thumb steers and adjusts air pitch;` +
    ` right thumb controls gas and brake. Hold NOSE DOWN over a jump to match the ` +
    `landing.</p>${directionSettings()}<div class="options-grid">` +
    `<label>HUMAN RIDERS<select id="humans"><option value="1">01 / Solo</option>` +
    `<option value="2">02 / Split screen</option><option value="3">03 / Three riders</option>` +
    `<option value="4">04 / Full grid view</option></select></label>` +
    `<label>NPC RIDERS<select id="npcs"></select></label><label>RACE LENGTH<select id="laps">` +
    `<option value="1">1 lap / Sprint</option>` +
    `<option value="3" selected>3 laps / Standard</option>` +
    `<option value="5">5 laps / Endurance</option></select></label>` +
    `<label>NPC PACE<select id="difficulty"><option value="relaxed">Relaxed</option>` +
    `<option selected value="club">Club</option><option value="expert">Expert</option></select>` +
    `</label></div>
<div class="riders-label"><span>RIDERS & DEVICES</span>` +
    `<span>GAMEPAD A / × TO USE / READY</span></div><div id="slots"></div>` +
    `<div id="controller-connection">` +
    `<button type="button" id="connect-controller">USE CONTROLLER</button>` +
    `<span id="controller-status" role="status"></span></div>` +
    `<p id="setup-status" class="status-text"></p>` +
    `<button id="start" class="primary">DROP THE GATE <span>↗</span></button>
<details>` +
    `<summary>CONTROLS & RIDE SETTINGS <span>+</span></summary><div class="controls"><div>` +
    `<b>KEYBOARD</b><span>W / ↑ Throttle · S / ↓ Brake<br>A D / ← → Steer · Q / Space Nose ` +
    `down · E Nose up<br>R Recover · Esc / P Pause · M Mute</span></div><div><b>GAMEPAD</b>` +
    `<span>RT Throttle · LT Brake · Left stick Steer<br>In air: left stick ↑ Nose down · ↓ ` +
    `Nose up<br>On dirt: roll left/right toward ↓ + RT to power slide<br>Steer + LT for a ` +
    `stronger brake slide<br>B Recover<br>Menu Pause · A Join / Ready</span></div></div>` +
    `<p class="ride-tip">Match the rhythm pace before a jump,` +
    ` then dip the nose to meet the landing. Crashes remount at the wreck. Short track exits ` +
    `are forgiven; gaining over 30 m outside returns you to where you ` +
    `left.</p>${slideSettings()}<div class="settings">` +
    `<label>Chase distance <input id="camera-distance" type="range" min="2.5" max="6" ` +
    `step=".1" value="3.2"></label>` +
    `<label>Camera shake <input id="camera-shake" type="range" min="0" max="1" step=".05" ` +
    `value=".15"></label><label>Render scale<select id="render-scale">` +
    `<option value="1">100%</option><option value="0.75">75%</option>` +
    `<option value="0.5">50%</option></select></label></div></details></section></div><footer>` +
    `<span>PURE DIRT. SHARED SCREEN.</span>` +
    `<span>PROCEDURAL CIRCUIT <i>✦</i> NO TWO LAPS ALIKE</span><span>BUILD 01.0</span></footer>` +
    `</div>`
  );
}
// The whole page: game canvas, setup screen, race chrome, pause menu and results.
export function appShellHtml() {
  return `<canvas id="game" aria-label="Supercross game"></canvas>
${setupScreenHtml()}
${raceChromeHtml()}
${pauseMenuHtml()}
${resultsScreenHtml()}`;
}
export function sameDevice(a: Device | null, b: Device | null) {
  return a && b && a.kind === b.kind && (a.kind !== 'gamepad' || (b.kind === 'gamepad' && a.index === b.index));
}
export function deviceValue(d: Device | null) {
  return !d ? '' : d.kind !== 'gamepad' ? d.kind : `pad-${d.index}`;
}
export function npcOptionsHtml(humanCount: number) {
  return Array.from(
    {length: 9 - humanCount},
    (_, i) =>
      `<option value="${i}">${i === 0 ? 'None / Humans only' : String(i).padStart(2, '0') + ' opponents'}</option>`,
  ).join('');
}
export function slotsHtml(
  humanCount: number,
  ready: boolean[],
  iphoneMode: boolean,
  pads: {index: number; id: string}[],
) {
  const padOptions = pads
    .map(
      p =>
        `<option value="pad-${p.index}">Gamepad ${p.index >= 1000 ? p.index - 999 : p.index + 1} / ` +
        `${p.id.replace(/[<>&"]/g, '').slice(0, 24)}</option>`,
    )
    .join('');
  return Array.from(
    {length: humanCount},
    (_, i) =>
      `<div class="player-slot" style="--player:${CSS_COLORS[i]}">` +
      `<span class="player-badge">P${i + 1}</span>` +
      `<select aria-label="Player ${i + 1} input device" data-device="${i}">` +
      `<option value="">Connect a controller</option>` +
      `<option value="keyboard">Keyboard / ` +
      `WASD</option>${iphoneMode ? '<option value="touch">iPhone / Touch controls</option>' : ''}` +
      `${padOptions}` +
      `</select><button class="ready ${ready[i] ? 'is-ready' : ''}" ` +
      `data-ready="${i}">${ready[i] ? '✓ READY' : 'READY?'}</button></div>`,
  ).join('');
}
export function controllerStatusMessage(iphoneMode: boolean) {
  const status = readGamepadStatus(),
    pads = Array.from(status.pads).filter(p => p && p.connected !== false);
  const message = iphoneMode
    ? 'Touch controls selected. Choose Mac above to use a controller.'
    : status.state !== 'ready'
      ? status.message
      : pads.length
        ? `${pads.length} controller${pads.length === 1 ? '' : 's'} detected: ${pads.map(p => p!.id).join(', ')}. Press A / × to use it.`
        : nativeControllerStatus() === 'connecting'
          ? 'Connecting to the Mac’s controller…'
          : nativeControllerStatus() === 'unavailable'
            ? 'Mac controller connection unavailable. Reopen the local game server and try Use controller again.'
            : 'No controller visible yet. Click Use controller to connect through this Mac, then press A / ×.';
  return message;
}
export function courseDescriptionText(track: Track) {
  return (
    `${track.customName ? 'Saved layout: ' + track.customName : track.course.description} · ` +
    `${(track.length / 1000).toFixed(2)} km · ${Math.round(track.elevationRange)} m terrain ` +
    `relief`
  );
}
