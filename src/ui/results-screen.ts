// Results screen markup, race ranking and the classification table.
import {cssColor} from '../config';
import {riderLabel} from '../riders';
import type {Rider} from '../physics';
import {progressDistance} from '../race';
import {formatLap, type RiderTiming} from '../timing';
import type {Track} from '../track';
import {el} from './dom';

export function resultsScreenHtml() {
  return (
    `<div id="results" class="modal hidden"><div class="modal-card results-card">` +
    `<div class="eyebrow">DUSK VALLEY / OFFICIAL CLASSIFICATION</div><h2>THAT’S A WRAP.</h2>` +
    `<p id="results-subtitle"></p><div id="results-table"></div>` +
    `<button id="restart-results" class="primary">ONE MORE RIDE <span>↗</span></button>` +
    `<button id="setup-results" class="text-button">RETURN TO SETUP</button></div></div>`
  );
}
export function ranking(riders: Rider[], track: Track) {
  return [...riders].sort((a, b) =>
    a.finished !== null && b.finished !== null
      ? a.finished - b.finished
      : a.finished !== null
        ? -1
        : b.finished !== null
          ? 1
          : progressDistance(b.progress, track.length) - progressDistance(a.progress, track.length),
  );
}
export function formatTime(t: number) {
  return `${Math.floor(t / 60)
    .toString()
    .padStart(2, '0')}:${(t % 60).toFixed(1).padStart(4, '0')}`;
}
export function showResultsTable(
  track: Track,
  riders: Rider[],
  lapCount: number,
  raceTime: number,
  timing: RiderTiming[] = [],
  trial = false,
  holeshot: number | null = null,
) {
  el('results').querySelector('.eyebrow')!.textContent = track.course.name.toUpperCase() + ' / OFFICIAL CLASSIFICATION';
  const ordered = ranking(riders, track);
  if (trial) el('results').querySelector('.eyebrow')!.textContent = track.course.name.toUpperCase() + ' / TIME TRIAL';
  const ridden = timing[0]?.laps.length ?? 0;
  el('results-subtitle').textContent = trial
    ? `${ridden} ${ridden === 1 ? 'lap' : 'laps'} · ${formatTime(raceTime)} session`
    : `${lapCount} ${lapCount === 1 ? 'lap' : 'laps'} · ${riders.length} riders · ${formatTime(raceTime)} session`;
  const winner = ordered[0]?.finished ?? null;
  // The fastest lap of the race, by anyone, is marked as well as each rider's own best.
  const fastest = Math.min(...timing.flatMap(t => t.laps.filter(lap => lap.valid).map(lap => lap.time)));
  el('results-table').innerHTML = ordered
    .map((r, i) => {
      const laps = timing[riders.indexOf(r)]?.laps || [];
      const best = Math.min(...laps.filter(lap => lap.valid).map(lap => lap.time));
      const gap = trial
        ? Number.isFinite(best)
          ? `BEST ${formatLap(best)}`
          : 'NO LAP SET'
        : r.finished === null
          ? 'DNF'
          : i === 0 || winner === null
            ? formatTime(r.finished)
            : `+${(r.finished - winner).toFixed(3)}`;
      const lapList = laps
        .map(
          (lap, n) =>
            `<span class="${lap.time === best ? 'best-lap' : ''}${lap.time === fastest ? ' fastest-lap' : ''}">` +
            `<small>L${n + 1}</small>${formatLap(lap.time)}</span>`,
        )
        .join('');
      return (
        `<div class="result-row"><b>${String(i + 1).padStart(2, '0')}</b>` +
        `<span style="color:${cssColor(r.color)}">●</span>` +
        `<strong>${riderLabel(r)}<small>${r.human ? 'HUMAN' : 'NPC'}` +
        `${r.id === holeshot ? ' · <i class="holeshot-tag">HOLESHOT</i>' : ''}</small></strong>` +
        `<span class="result-time">${gap}</span>` +
        (lapList ? `<div class="result-laps">${lapList}</div>` : '') +
        `</div>`
      );
    })
    .join('');
}
