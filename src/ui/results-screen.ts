// Results screen markup, race ranking and the classification table.
import {cssColor} from '../config';
import {riderLabel} from '../riders';
import {POINTS, SEASON_ROUNDS, standings, type Season} from '../season';
import type {Rider} from '../physics';
import {progressDistance} from '../race';
import {formatLap, type RiderTiming} from '../timing';
import type {Track} from '../track';
import {el} from './dom';

export function resultsScreenHtml() {
  return (
    `<div id="results" class="modal hidden"><div class="modal-card results-card">` +
    `<div class="eyebrow">DUSK VALLEY / OFFICIAL CLASSIFICATION</div><h2 id="results-heading">THAT’S A WRAP.</h2>` +
    `<p id="results-subtitle"></p><div id="results-table"></div>` +
    `<button id="restart-results" class="primary">ONE MORE RIDE <span>↗</span></button>` +
    `<button id="setup-results" class="text-button">RETURN TO SETUP</button></div></div>`
  );
}
/**
 * Race order. A rider who has taken the flag counts the laps it finished with; one still riding counts the lap
 * it is on, since it will complete that lap at the line. More laps is ahead; on the same laps a finisher is
 * ahead of a rider still out, finishers go by time and riders still out by distance covered. In a race over a
 * set number of laps this is simply finishers by time, then the rest by distance.
 */
export function ranking(riders: Rider[], track: Track) {
  const laps = (r: Rider) => (r.finished !== null ? (r.finishedLaps ?? Infinity) : r.progress.lap + 1);
  return [...riders].sort((a, b) =>
    a.finished !== null && b.finished !== null
      ? laps(b) - laps(a) || a.finished - b.finished
      : a.finished === null && b.finished === null
        ? progressDistance(b.progress, track.length) - progressDistance(a.progress, track.length)
        : laps(b) - laps(a) || (a.finished !== null ? -1 : 1),
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
  /** A championship race: its title, its length in seconds, and whether it scores (a main). */
  season: {title: string; seconds: number; scores: boolean} | null = null,
) {
  el('results-heading').textContent = 'THAT’S A WRAP.';
  el('results').querySelector('.eyebrow')!.textContent = season
    ? season.title
    : track.course.name.toUpperCase() + ' / OFFICIAL CLASSIFICATION';
  const ordered = ranking(riders, track);
  if (trial) el('results').querySelector('.eyebrow')!.textContent = track.course.name.toUpperCase() + ' / TIME TRIAL';
  const ridden = timing[0]?.laps.length ?? 0;
  el('results-subtitle').textContent = trial
    ? `${ridden} ${ridden === 1 ? 'lap' : 'laps'} · ${formatTime(raceTime)} session`
    : season
      ? `${season.seconds / 60} minutes plus a lap · ${riders.length} riders · ` +
        (season.scores ? 'points for this race' : 'this result sets the gates for the main')
      : `${lapCount} ${lapCount === 1 ? 'lap' : 'laps'} · ${riders.length} riders · ${formatTime(raceTime)} session`;
  const winner = ordered[0]?.finished ?? null;
  const winnerLaps = ordered[0]?.finishedLaps ?? 0;
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
        : season
          ? timedGap(r, i, winner, winnerLaps)
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
        `${r.id === holeshot ? ' · <i class="holeshot-tag">HOLESHOT</i>' : ''}` +
        `${season?.scores ? ` · <i class="points-tag">+${POINTS[i] ?? 0} PTS</i>` : ''}</small></strong>` +
        `<span class="result-time">${gap}</span>` +
        (lapList ? `<div class="result-laps">${lapList}</div>` : '') +
        `</div>`
      );
    })
    .join('');
}

/** A timed race's results column: the winner's time, a gap on the same lap, or the laps a rider was down. */
function timedGap(r: Rider, place: number, winner: number | null, winnerLaps: number) {
  if (winner === null) return r.finished === null ? '—' : formatTime(r.finished);
  if (place === 0) return formatTime(winner);
  const down = winnerLaps - (r.finished !== null ? (r.finishedLaps ?? winnerLaps) : r.progress.lap + 1);
  if (down > 0) return `+${down} ${down === 1 ? 'LAP' : 'LAPS'}`;
  return r.finished !== null ? `+${(r.finished - winner).toFixed(3)}` : 'ON THE LEAD LAP';
}
/** One line for each rider in the championship: place, name, the result in every main so far and points. */
export function standingsRowsHtml(season: Season) {
  return standings(season)
    .map(
      row =>
        `<div class="result-row standing-row${row.position <= 3 ? ' podium-' + row.position : ''}">` +
        `<b>${String(row.position).padStart(2, '0')}</b>` +
        `<span style="color:${cssColor(row.entrant.color)}">●</span>` +
        `<strong>${entrantLabel(row.entrant)}<small>${row.entrant.human ? 'HUMAN' : 'NPC'}` +
        `${row.results.length ? ' · ' + row.results.map(place => 'P' + place).join(' ') : ''}</small></strong>` +
        `<span class="result-time">${row.points} PTS</span></div>`,
    )
    .join('');
}
const entrantLabel = (e: {human: boolean; name: string; number: number}) =>
  e.human ? e.name : `#${e.number} ${e.name}`;
/** Shows the championship table in the results window, after a main. */
export function showStandingsTable(season: Season) {
  const done = season.rounds.filter(r => r.main).length;
  const complete = done === SEASON_ROUNDS;
  const leader = standings(season)[0];
  el('results').querySelector('.eyebrow')!.textContent = complete
    ? 'CHAMPIONSHIP / FINAL STANDINGS'
    : `CHAMPIONSHIP / AFTER ROUND ${done} OF ${SEASON_ROUNDS}`;
  el('results-heading').textContent = complete ? `CHAMPION: ${entrantLabel(leader.entrant)}` : 'THE STANDINGS.';
  el('results-subtitle').textContent = complete
    ? `${leader.points} points and ${leader.wins} ${leader.wins === 1 ? 'win' : 'wins'} from ${SEASON_ROUNDS} rounds`
    : 'Points come from the mains. Level on points: most wins, then the better result in the latest round.';
  el('results-table').innerHTML = standingsRowsHtml(season);
}
