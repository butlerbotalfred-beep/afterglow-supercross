// Results screen markup, race ranking and the classification table.
import {CSS_COLORS} from '../config';
import type {Rider} from '../physics';
import {progressDistance} from '../race';
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
export function showResultsTable(track: Track, riders: Rider[], lapCount: number, raceTime: number) {
  el('results').querySelector('.eyebrow')!.textContent = track.course.name.toUpperCase() + ' / OFFICIAL CLASSIFICATION';
  const ordered = ranking(riders, track);
  el('results-subtitle').textContent =
    `${lapCount} ${lapCount === 1 ? 'lap' : 'laps'} · ${riders.length} riders · ${formatTime(raceTime)} session`;
  el('results-table').innerHTML = ordered
    .map(
      (r, i) =>
        `<div class="result-row"><b>${String(i + 1).padStart(2, '0')}</b>` +
        `<span style="color:${CSS_COLORS[r.id]}">●</span>` +
        `<strong>${r.name}<small>${r.human ? 'HUMAN' : 'NPC'}</small></strong>` +
        `<span>${r.finished === null ? 'DNF' : formatTime(r.finished)}</span></div>`,
    )
    .join('');
}
