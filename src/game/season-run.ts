// Runs championship races through the race session: the grid for a season race, and its result.
import type {Device} from '../input';
import type {RiderProfile} from '../riders';
import {profileOf, type Season, type SeasonRace} from '../season';
import {ranking} from '../ui/results-screen';
import {neutralControl} from '../input';
import {roundRace, type SeasonRound} from '../season';
import {Track} from '../track';
import {TUNING} from '../config';
import {RaceSession, type GridConfig, type RaceConfig} from './race-session';

/** The grid for a season race: every entrant, in the places the race gives them. */
export function seasonGrid(season: Season, race: SeasonRace, track: Track, assignments: (Device | null)[]): GridConfig {
  const humanCount = season.entrants.filter(e => e.human).length;
  const profiles = season.entrants.filter(e => !e.human).map(e => profileOf(e) as RiderProfile);
  return {
    track,
    humanCount,
    npcCount: profiles.length,
    practice: false,
    assignments,
    difficulty: season.difficulty,
    seed: race.seed,
    humans: season.entrants.filter(e => e.human),
    lineup: {profiles, slots: race.slots},
  };
}
export function seasonStart(season: Season, race: SeasonRace, catchUp = false): RaceConfig {
  return {lapCount: 0, difficulty: season.difficulty, seed: race.seed, catchUp, timeLimit: race.seconds};
}
/** The finishing order of a season race that has ended, as entrant ids. A rider's id is its entrant's id. */
export function seasonOrder(session: RaceSession) {
  return ranking(session.riders, session.track).map(r => r.id);
}

/** One round of an automated season, heat then main, with nobody at the controls. */
export function runRound(season: Season, round: number) {
  const quiet = {countdown() {}, racing() {}, cue() {}, landing() {}, pause() {}, results() {}};
  const result: SeasonRound = {heat: null, main: null};
  const seconds = {heat: 0, main: 0};
  /** When the winner took the flag: the race then stays open for the riders still out. */
  const won = {heat: 0, main: 0};
  let crashes = 0;
  const track = new Track(roundRace(season, round).course);
  for (const stage of ['heat', 'main'] as const) {
    const rounds = season.rounds.map((r, i) => (i === round ? result : r));
    const race = roundRace({...season, rounds}, round);
    const session = new RaceSession({sample: () => neutralControl(), connectedGamepads: () => []}, quiet);
    session.grid(seasonGrid(season, race, track, []));
    session.start(seasonStart(season, race));
    while (session.phase !== 'results' && session.raceTime < race.seconds + 1200) session.step(TUNING.step);
    if (session.phase !== 'results') throw new Error(`Round ${round + 1} ${stage} did not finish.`);
    result[stage] = seasonOrder(session);
    seconds[stage] = session.raceTime;
    won[stage] = session.firstFinish ?? session.raceTime;
    crashes += session.riders.reduce((n, r) => n + r.crashes, 0);
  }
  return {round: result, seconds, won, crashes};
}
