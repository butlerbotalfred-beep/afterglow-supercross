// In-race HUD: race chrome markup, split-screen viewports, per-rider panels and the mini map.
import {CSS_COLORS, TUNING} from '../config';
import type {Device} from '../input';
import type {Rider} from '../physics';
import {jumpCall, type JumpCall} from '../takeoff';
import {currentLapTime, formatDelta, formatLap, type LapTime, type RiderTiming} from '../timing';
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
  /** Lap timing per rider, in the same order as `riders`. */
  timing: RiderTiming[];
  /** The lap each rider's times are compared with (their saved or session best), or null. */
  referenceLap: (index: number) => LapTime | null;
};
/** How long a finished sector or lap stays on screen, in seconds of race time. */
const SPLIT_SECONDS = 4;

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
          `<div class="timing"><b class="lap-now">0:00.0</b>` +
          `<span>LAST <b class="lap-last">–</b></span><span>BEST <b class="lap-best">–</b></span>` +
          `<i class="lap-split"></i></div>` +
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
/** Fills one rider's lap timing panel: the running lap, last and best laps, and the newest sector or lap result. */
function updateTiming(
  h: HTMLElement,
  t: RiderTiming | undefined,
  best: LapTime | null,
  raceTime: number,
  done: boolean,
) {
  if (!t) return;
  const last = t.laps[t.laps.length - 1];
  // The running clock shows tenths: thousandths change too fast to read. It stops when the rider has finished.
  h.querySelector('.lap-now')!.textContent =
    done && last ? formatLap(last.time) : formatLap(currentLapTime(t, raceTime)).slice(0, -2);
  h.querySelector('.lap-last')!.textContent = last ? formatLap(last.time) : '–';
  h.querySelector('.lap-best')!.textContent = best ? formatLap(best.time) : '–';
  const split = h.querySelector<HTMLElement>('.lap-split')!;
  const s = t.split;
  if (!s || raceTime - s.at > SPLIT_SECONDS) {
    split.textContent = '';
    split.className = 'lap-split';
    return;
  }
  // A sector that ended the lap shows the whole lap; any other shows the sector.
  const lapEnded = s.lapDelta !== undefined && last;
  const delta = lapEnded ? (s.lapDelta ?? null) : s.delta;
  const label = lapEnded ? `LAP ${formatLap(last.time)}` : `S${s.sector + 1} ${s.time.toFixed(3)}`;
  split.textContent = delta === null ? label : `${label}  ${formatDelta(delta)}`;
  split.className = `lap-split ${delta === null ? '' : delta < 0 ? 'faster' : 'slower'}`;
}
/** How far ahead of a lane of jumps the callout appears, in metres. */
const JUMP_CALL_REACH = 90;
/** The takeoff meter is centred on the sweet spot and shows this many m/s either side of it. */
const METER_SPAN = 10;
/** Within this many m/s of the sweet spot the takeoff is perfect: the marker turns bright green. */
export const SWEET_TOLERANCE = 1.25;
/** The fade away from the sweet spot: [m/s off it, red, green, blue]. A narrow green, then yellow, orange, red. */
const METER_FADE = [
  [0, 57, 227, 107],
  [SWEET_TOLERANCE, 57, 227, 107],
  [2.5, 242, 209, 60],
  [5.5, 240, 138, 60],
  [9, 229, 72, 77],
];
const meterShare = (call: JumpCall, speed: number) =>
  Math.max(0, Math.min(1, 0.5 + (speed - call.sweet) / (2 * METER_SPAN))) * 100;
/** The meter's colour this many m/s away from the sweet spot. */
export function meterColor(off: number) {
  const d = Math.abs(off);
  let k = 1;
  while (k < METER_FADE.length - 1 && METER_FADE[k][0] < d) k++;
  const [a, b] = [METER_FADE[k - 1], METER_FADE[k]];
  const t = Math.max(0, Math.min(1, (d - a[0]) / (b[0] - a[0])));
  return `rgb(${[1, 2, 3].map(c => Math.round(a[c] + (b[c] - a[c]) * t)).join(',')})`;
}
/** The same fade as a background: red, orange, yellow, a narrow green in the middle, and back out to red. */
const METER_PAINT = `linear-gradient(90deg,${[
  ...METER_FADE.slice(1)
    .reverse()
    .map(f => -f[0]),
  ...METER_FADE.slice(1).map(f => f[0]),
]
  .map(off => `${meterColor(off)} ${(50 + (off / METER_SPAN) * 50).toFixed(1)}%`)
  .join(',')})`;
/** Inside this many metres of a new lane's first lip, the callout matters more than the landing just made. */
const CALL_OVER_LANDING = 45;
/** The landing cue gets its moment, also between the jumps of a lane, unless a new lane is nearly here. */
export const callOutranksLanding = (call: JumpCall | null) =>
  !!call && call.distance > 0 && call.distance < CALL_OVER_LANDING;
/** What the rider should do about their speed for the jumps coming up. */
export function takeoffVerdict(call: JumpCall, speed: number) {
  if (Math.abs(speed - call.sweet) <= SWEET_TOLERANCE) return 'PERFECT';
  const zone = call.zones[Math.max(0, Math.min(call.zones.length - 1, Math.round((speed - call.from) / call.step)))];
  if (speed < call.sweet) return zone === 'crash' ? 'TOO SLOW · COMES UP SHORT' : 'BUILD SPEED';
  return zone === 'crash' ? 'TOO FAST · OVERSHOOTS' : 'EASE OFF';
}
/** The notice for the jumps coming up: what they are, how far, and a meter of takeoff speed around the sweet spot. */
export function jumpNotice(call: JumpCall, speed: number) {
  const verdict = takeoffVerdict(call, speed);
  const state = verdict === 'PERFECT' ? 'perfect' : verdict.startsWith('TOO') ? 'danger' : 'off-pace';
  const where = call.distance > 0 ? ` · ${Math.round(call.distance / 5) * 5} M` : '';
  // The marker line glows in the colour of the part of the meter it is on.
  const glow = state === 'perfect' ? '' : `;--glow:${meterColor(speed - call.sweet)}`;
  return (
    `<b class="pace-label">${call.kind}${where}</b>` +
    `<span class="takeoff-meter ${state}" style="background:${METER_PAINT}">` +
    `<u style="left:${meterShare(call, speed).toFixed(1)}%${glow}"></u></span>` +
    `<small class="takeoff-${state}">${verdict} · ${Math.round(call.sweet * 3.6)} KM/H</small>`
  );
}
/** How long CLEAN LANDING or FLAT LANDING stays up. */
const LANDING_CUE_SECONDS = 1.4;
/** The notice shown just after a judged landing. */
export function landingNotice(r: Pick<Rider, 'landingCue' | 'landingBonus'>) {
  if (r.landingCue === 'clean') {
    const gained = Math.round(r.landingBonus * 3.6);
    return (
      '<b class="clean-landing">CLEAN LANDING</b>' + `<small>${gained > 0 ? `+${gained} KM/H` : 'SPEED KEPT'}</small>`
    );
  }
  return '<b class="flat-landing">FLAT LANDING</b><small>MATCH THE SLOPE TO KEEP SPEED</small>';
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
    updateTiming(h, ctx.timing[i], ctx.referenceLap(i), raceTime, r.finished !== null && !practice);
    h.querySelector('.speed strong')!.textContent = String(Math.round(r.speed * 3.6)).padStart(2, '0');
    (h.querySelector('.speed-track i') as HTMLElement).style.width = `${(r.speed / TUNING.maxSpeed) * 100}%`;
    h.querySelector('.sector')!.textContent = track.sector(r.surface.s);
    const call = phase === 'racing' ? jumpCall(track, r.surface.s, JUMP_CALL_REACH) : null;
    const paceNotice = call ? jumpNotice(call, r.speed) : '';
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
                    : r.landingCue && r.landingCueAge < LANDING_CUE_SECONDS && !callOutranksLanding(call)
                      ? landingNotice(r)
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
