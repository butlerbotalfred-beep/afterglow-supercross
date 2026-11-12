// In-race HUD: race chrome markup, split-screen viewports, per-rider panels and the mini map.
import {CSS_COLORS, TUNING} from '../config';
import type {Device} from '../input';
import type {Rider} from '../physics';
import type {Track} from '../track';
import {obstacleLength, obstacleType} from '../track-layout';
import {el} from './dom';
import {formatTime, ranking} from './results-screen';

export type HudContext = {
  track: Track;
  riders: Rider[];
  viewHud: HTMLElement[];
  phase: string;
  practice: boolean;
  lapCount: number;
  humanCount: number;
  raceTime: number;
  firstFinish: number | null;
  iphoneMode: boolean;
};

export function raceChromeHtml() {
  return (
    `<div id="hud" class="hidden"></div><div id="race-bar" class="hidden">` +
    `<span id="session-label">DUSK VALLEY / RACE NIGHT</span>` +
    `<span id="race-time">00:00.0</span><button id="pause-button">Ⅱ PAUSE</button>` +
    `<button id="race-mute">♪ SOUND ON</button></div><div id="countdown" class="hidden"></div>`
  );
}
export function views(humanCount: number) {
  if (humanCount === 1) return [{x: 0, y: 0, w: 1, h: 1}];
  if (humanCount === 2)
    return [
      {x: 0, y: 0, w: 1, h: 0.5},
      {x: 0, y: 0.5, w: 1, h: 0.5},
    ];
  return [
    {x: 0, y: 0, w: 0.5, h: 0.5},
    {x: 0.5, y: 0, w: 0.5, h: 0.5},
    {x: 0, y: 0.5, w: 0.5, h: 0.5},
    {x: 0.5, y: 0.5, w: 0.5, h: 0.5},
  ].slice(0, humanCount);
}
export function deviceLabel(d: Device | null) {
  return !d
    ? 'Unassigned'
    : d.kind === 'keyboard'
      ? 'KEYBOARD'
      : d.kind === 'touch'
        ? 'IPHONE / TOUCH'
        : `GAMEPAD ${d.index >= 1000 ? d.index - 999 : d.index + 1}`;
}
export function hudHtml(
  humanCount: number,
  riders: Rider[],
  assignments: (Device | null)[],
  practice: boolean,
  lapCount: number,
) {
  return (
    views(humanCount)
      .map(
        (v, i) =>
          `<section class="viewport-hud ${humanCount > 1 ? 'compact' : 'solo'}" ` +
          `style="left:${v.x * 100}%;top:${v.y * 100}%;width:${v.w * 100}%;height:${v.h * 100}%;` +
          `--player:${CSS_COLORS[i]}"><div class="hud-top"><div class="position"><small>POS</small>` +
          `<strong>01<span>/ ${riders.length}</span></strong></div>` +
          `<span class="identity">P${i + 1}<small>${deviceLabel(assignments[i])}</small></span>` +
          `<div class="lap">LAP <b>1</b><small>/ ${practice ? '∞' : lapCount}</small></div></div>` +
          `<div class="rider-notice"></div><div class="test-target"></div><div class="hud-bottom">` +
          `<div class="mini-map"><canvas width="150" height="130"></canvas>` +
          `<span class="sector">FINISH STRAIGHT</span></div><div class="speed"><strong>00</strong>` +
          `<small>KM/H</small><div class="speed-track"><i></i></div></div></div></section>`,
      )
      .join('') +
    (humanCount === 3
      ? '<section class="race-info"><div class="eyebrow">LIVE / RACE NIGHT</div>' +
        '<h2>RACE NIGHT.</h2><div id="live-standings"></div>' +
        '<small>R / B to recover · Esc / Menu to pause</small></section>'
      : '')
  );
}
export function drawMap(canvas: HTMLCanvasElement, r: Rider, track: Track, riders: Rider[], practice: boolean) {
  const c = canvas.getContext('2d')!;
  c.clearRect(0, 0, 150, 130);
  const b = track.bounds,
    scale = Math.min(136 / (b.maxX - b.minX), 116 / (b.maxZ - b.minZ));
  const x = (x: number) => 75 + (x - (b.minX + b.maxX) / 2) * scale,
    z = (z: number) => 65 + (z - (b.minZ + b.maxZ) / 2) * scale;
  c.lineJoin = 'round';
  c.beginPath();
  track.samples
    .filter((_, i) => i % 8 === 0)
    .forEach((p, i) => (i ? c.lineTo(x(p.x), z(p.z)) : c.moveTo(x(p.x), z(p.z))));
  c.closePath();
  c.strokeStyle = '#fff5';
  c.lineWidth = 3;
  c.stroke();
  c.strokeStyle = '#151927';
  c.lineWidth = 1.3;
  c.stroke();
  if (practice)
    for (const j of track.obstacles) {
      if (!j.highlight) continue;
      const p = track.at(j.start);
      c.fillStyle = '#ffdc69';
      c.fillRect(x(p.x) - 3, z(p.z) - 3, 6, 6);
    }
  for (const o of riders) {
    c.fillStyle = CSS_COLORS[o.id];
    c.beginPath();
    c.arc(x(o.x), z(o.z), o === r ? 4 : 2.3, 0, Math.PI * 2);
    c.fill();
  }
  c.fillStyle = '#fff';
  const p = track.at(0);
  c.fillRect(x(p.x) - 3, z(p.z) - 1, 6, 2);
}
export function updateHud(ctx: HudContext) {
  const {track, riders, viewHud, phase, practice, lapCount, humanCount, raceTime, firstFinish, iphoneMode} = ctx;
  const ordered = ranking(riders, track);
  viewHud.forEach((h, i) => {
    const r = riders[i];
    h.querySelector('.position strong')!.innerHTML =
      `${String(ordered.indexOf(r) + 1).padStart(2, '0')}<span>/ ${riders.length}</span>`;
    h.querySelector('.lap b')!.textContent = String(
      practice ? r.progress.lap + 1 : Math.min(lapCount, r.progress.lap + 1),
    );
    h.querySelector('.speed strong')!.textContent = String(Math.round(r.speed * 3.6)).padStart(2, '0');
    (h.querySelector('.speed-track i') as HTMLElement).style.width = `${(r.speed / TUNING.maxSpeed) * 100}%`;
    h.querySelector('.sector')!.textContent = track.sector(r.surface.s);
    const approach = track.rhythms.find(section => (section.start - r.surface.s + track.length) % track.length < 55);
    const pace = approach ? approach.pace * 3.6 : 0;
    const paceNotice =
      approach && phase === 'racing'
        ? `<b class="pace-label">RHYTHM ${Math.round(pace - 5)}–${Math.round(pace + 5)} KM/H</b>` +
          `<small>${r.speed * 3.6 > pace + 5 ? 'EASE OFF' : r.speed * 3.6 < pace - 5 ? 'BUILD SPEED' : 'HOLD YOUR PACE'}` +
          `</small>`
        : '';
    const remaining =
      firstFinish === null
        ? ''
        : Math.ceil(Math.max(0, TUNING.finishTimeout - (raceTime - firstFinish))) + 's for remaining riders';
    const airHint = iphoneMode
      ? 'HOLD NOSE DOWN TO MATCH THE LANDING'
      : r.device?.kind === 'gamepad'
        ? 'LEFT STICK UP · DIP NOSE'
        : 'Q / SPACE · DIP NOSE';
    h.querySelector('.rider-notice')!.innerHTML =
      r.finished !== null
        ? `<b>FINISHED / ${formatTime(r.finished)}</b>` + `<small>${remaining}` + `</small>`
        : r.crashTime > 0
          ? `<b class="crash-label">CRASH / ${r.crashReason}</b>` +
            `<small>REMOUNT IN ${(r.crashTime + TUNING.recoveryDelay).toFixed(1)}s · GETTING BACK ` +
            `UP</small>`
          : r.recovery > 0
            ? `<b>RECOVERING ${r.recovery.toFixed(1)}</b><small>${r.recoveryReason}</small>`
            : r.progress.routeBroken
              ? `<b>RETURN TO TRACK EXIT</b><small>${iphoneMode ? 'TAP ↺ RECOVER' : 'R / B TO RECOVER'}</small>`
              : r.progress.wrongWay
                ? '<b>WRONG WAY</b>'
                : !r.grounded && r.airTime > 0.2
                  ? `<b class="air-label">${r.pitch < -0.18 ? 'NOSE DOWN' : 'AIR TIME'}</b>` +
                    `<small>${airHint}` +
                    `</small>`
                  : r.powerSlide > 0.18
                    ? `<b class="pace-label">${r.brake > 0.1 ? 'BRAKE SLIDE' : 'POWER SLIDE'}</b>` +
                      `<small>CENTER THE STICK TO REGAIN GRIP</small>`
                    : paceNotice;
    const targets = practice
      ? track.obstacles
          .map((j, index) => ({
            j,
            index,
            distance: (j.start - r.surface.s + track.length) % track.length,
            inside: (r.surface.s - j.start + track.length) % track.length <= obstacleLength(j),
          }))
          .filter(t => t.j.highlight)
          .sort((a, b) => Number(b.inside) - Number(a.inside) || a.distance - b.distance)
      : [];
    const target = targets[0];
    h.querySelector('.test-target')!.textContent = target
      ? `★ O${target.index + 1} · ${obstacleType(target.j).toUpperCase()} · ` +
        `${target.inside ? 'ON OBSTACLE' : Math.round(target.distance) + ' m ahead'}`
      : '';
    drawMap(h.querySelector('canvas')!, r, track, riders, practice);
  });
  el('race-time').textContent =
    formatTime(raceTime) +
    (firstFinish !== null ? ` · ${Math.ceil(Math.max(0, 60 - (raceTime - firstFinish)))}s TO CLOSE` : '');
  if (humanCount === 3)
    el('live-standings').innerHTML = ordered
      .slice(0, 5)
      .map(
        (r, i) =>
          `<div><b>${i + 1}</b><span style="color:${CSS_COLORS[r.id]}">${r.name}</span>` +
          `<small>${r.finished !== null ? 'FINISHED' : 'LAP ' + Math.min(lapCount, r.progress.lap + 1)}` +
          `</small></div>`,
      )
      .join('');
}
