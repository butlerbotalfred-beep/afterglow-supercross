// The championship: five rounds, one on each circuit, each a timed heat and a timed main. Only mains score.
// Nothing here touches the browser, so a whole season can be run and checked in Node.
import {COLORS} from './config';
import {COURSES, type Course} from './courses';
import {ROSTER, gridFor, shuffled, type RiderProfile} from './riders';

export const SEASON_VERSION = 1;
/** Every race has this many riders, so every main awards the same points. */
export const SEASON_RIDERS = 8;
/** Seconds on the clock; each race then runs one more lap. */
export const HEAT_SECONDS = 180;
export const MAIN_SECONDS = 360;
/** Points for a main, winner first: the top eight of the Supercross scale used since 2024. */
export const POINTS = [25, 22, 20, 18, 17, 16, 15, 14];
export const MAIN_POINTS = POINTS.reduce((a, b) => a + b, 0);
/** One round on each circuit, in the order of the circuit list. */
export const SEASON_COURSES: Course[] = COURSES;
export const SEASON_ROUNDS = SEASON_COURSES.length;

export type Stage = 'heat' | 'main';
export interface SeasonEntrant {
  /** 0 to 7. Humans come first, so a human's id is also their player slot. */
  id: number;
  human: boolean;
  name: string;
  number: number;
  color: number;
}
export interface SeasonRound {
  /** Entrant ids in finishing order, winner first; null until the race has been run. */
  heat: number[] | null;
  main: number[] | null;
}
export interface Season {
  version: number;
  /** Sets the heat grids and the computer riders' mistakes, so a season replays exactly from its seed. */
  seed: number;
  /** The pace setting the season was started on, which picked its computer riders. */
  difficulty: string;
  entrants: SeasonEntrant[];
  rounds: SeasonRound[];
}
export interface SeasonRace {
  round: number;
  stage: Stage;
  course: Course;
  seconds: number;
  /** For the race session: computer riders' mistakes and gate reactions. */
  seed: number;
  /** Each entrant's place on the grid, by entrant id. */
  slots: number[];
}

const DIFFICULTIES = ['relaxed', 'club', 'expert'];
const isOrder = (v: unknown): v is number[] =>
  Array.isArray(v) && v.length === SEASON_RIDERS && [...v].sort((a, b) => a - b).every((id, i) => id === i);

/** A new season: the humans, then the computer riders the pace setting picks, fastest first. */
export function newSeason(humanCount: number, difficulty: string, seed: number): Season {
  const humans = Math.max(1, Math.min(4, Math.floor(humanCount)));
  const level = DIFFICULTIES.includes(difficulty) ? difficulty : 'club';
  const entrants: SeasonEntrant[] = [];
  for (let id = 0; id < humans; id++)
    entrants.push({id, human: true, name: `PLAYER ${id + 1}`, number: id + 1, color: COLORS[id]});
  for (const p of gridFor(level, SEASON_RIDERS - humans))
    entrants.push({id: entrants.length, human: false, name: p.name, number: p.number, color: p.plate});
  return {
    version: SEASON_VERSION,
    seed: seed >>> 0 || 1,
    difficulty: level,
    entrants,
    rounds: Array.from({length: SEASON_ROUNDS}, () => ({heat: null, main: null})),
  };
}
/** An automated season: eight computer riders and nobody at the controls. */
export function aiSeason(difficulty: string, seed: number): Season {
  const season = newSeason(1, difficulty, seed);
  season.entrants = gridFor(season.difficulty, SEASON_RIDERS).map((p, id) => ({
    id,
    human: false,
    name: p.name,
    number: p.number,
    color: p.plate,
  }));
  return season;
}
/** The roster rider behind a computer entrant. */
export function profileOf(entrant: SeasonEntrant): RiderProfile | undefined {
  return entrant.human ? undefined : ROSTER.find(p => p.number === entrant.number);
}
/** Reads a stored season, or null if it is not one this build can carry on with. */
export function asSeason(v: unknown): Season | null {
  if (!v || typeof v !== 'object') return null;
  const s = v as Partial<Season>;
  if (s.version !== SEASON_VERSION || typeof s.seed !== 'number' || !DIFFICULTIES.includes(s.difficulty as string))
    return null;
  if (!Array.isArray(s.entrants) || s.entrants.length !== SEASON_RIDERS) return null;
  const entrants: SeasonEntrant[] = [];
  for (const [id, e] of s.entrants.entries()) {
    if (!e || typeof e !== 'object' || e.id !== id || typeof e.human !== 'boolean') return null;
    if (typeof e.name !== 'string' || typeof e.number !== 'number' || typeof e.color !== 'number') return null;
    // Humans first, and every computer rider still in the roster.
    if (e.human && id > 0 && !entrants[id - 1].human) return null;
    const entrant = {id, human: e.human, name: e.name, number: e.number, color: e.color};
    if (!e.human && !profileOf(entrant)) return null;
    entrants.push(entrant);
  }
  if (entrants.filter(e => e.human).length > 4) return null;
  if (!Array.isArray(s.rounds) || s.rounds.length !== SEASON_ROUNDS) return null;
  const rounds: SeasonRound[] = [];
  let open = false;
  for (const r of s.rounds) {
    if (!r || typeof r !== 'object') return null;
    const heat = r.heat ?? null,
      main = r.main ?? null;
    if ((heat !== null && !isOrder(heat)) || (main !== null && !isOrder(main))) return null;
    // Races are run in order: nothing after the first race still to run, and no main without its heat.
    if ((open && heat) || (!heat && main)) return null;
    if (!heat || !main) open = true;
    rounds.push({heat, main});
  }
  return {version: SEASON_VERSION, seed: s.seed >>> 0 || 1, difficulty: s.difficulty as string, entrants, rounds};
}

const raceSeed = (season: Season, round: number, stage: Stage) =>
  ((Math.imul(season.seed ^ 0x5eed, 0x9e3779b1) ^ Math.imul(round * 2 + (stage === 'main' ? 1 : 0) + 1, 0x85ebca6b)) >>>
    0) +
  1;
/**
 * The race the season is waiting for, or null when all five rounds are done. A heat's grid is drawn from the
 * season seed. For the main the heat result is the gate-pick order: the heat winner has the first gate, and
 * so on down the order.
 */
export function nextRace(season: Season): SeasonRace | null {
  const round = season.rounds.findIndex(r => !r.heat || !r.main);
  return round < 0 ? null : roundRace(season, round);
}
/** The race a round is waiting for: its heat, or its main once the heat has been run. */
export function roundRace(season: Season, round: number): SeasonRace {
  const {heat} = season.rounds[round];
  const stage: Stage = heat ? 'main' : 'heat';
  const seed = raceSeed(season, round, stage);
  const order =
    heat ??
    shuffled(
      season.entrants.map(e => e.id),
      seed,
    );
  const slots = season.entrants.map(e => order.indexOf(e.id));
  return {
    round,
    stage,
    course: SEASON_COURSES[round],
    seconds: stage === 'heat' ? HEAT_SECONDS : MAIN_SECONDS,
    seed,
    slots,
  };
}
export const seasonComplete = (season: Season) => nextRace(season) === null;
/** True when at least one race has been run and at least one is still to run. */
export const seasonUnfinished = (season: Season | null) =>
  !!season && !seasonComplete(season) && season.rounds[0].heat !== null;

/**
 * Records the result of the race the season was waiting for: entrant ids in finishing order. Returns the
 * season to save; the one passed in is not changed. Throws if the order is not all eight entrants once each,
 * or if the season is already complete.
 */
export function recordRace(season: Season, order: number[]): Season {
  const race = nextRace(season);
  if (!race) throw new Error('The season is complete.');
  if (!isOrder(order)) throw new Error('A race result must list all eight riders once each.');
  const rounds = season.rounds.map((r, i) => (i === race.round ? {...r, [race.stage]: [...order]} : r));
  return {...season, rounds};
}

export interface Standing {
  entrant: SeasonEntrant;
  points: number;
  wins: number;
  /** Finishing position in each main run so far, 1 to 8. */
  results: number[];
  position: number;
}
/** Points a main gives each entrant id, from its finishing order. */
export function mainPoints(order: number[]) {
  const points: number[] = [];
  order.forEach((id, place) => (points[id] = POINTS[place] ?? 0));
  return points;
}
/**
 * The championship table after the mains run so far. Ties on points go to the rider with more main wins,
 * then to the rider who did better in the latest round. Before any main, riders are in entry order.
 */
export function standings(season: Season): Standing[] {
  const mains = season.rounds.map(r => r.main).filter((m): m is number[] => !!m);
  const table = season.entrants.map(entrant => {
    const results = mains.map(m => m.indexOf(entrant.id) + 1);
    return {
      entrant,
      points: results.reduce((n, place) => n + (POINTS[place - 1] ?? 0), 0),
      wins: results.filter(place => place === 1).length,
      results,
      position: 0,
    };
  });
  table.sort(
    (a, b) =>
      b.points - a.points ||
      b.wins - a.wins ||
      (a.results.at(-1) ?? 0) - (b.results.at(-1) ?? 0) ||
      a.entrant.id - b.entrant.id,
  );
  table.forEach((row, i) => (row.position = i + 1));
  return table;
}

/** What starting a new season would do to the one in hand. */
export type NewSeasonAnswer = {started: Season} | {needsConfirmation: true; unfinished: Season};
/**
 * Starts a new season, unless one is in progress and the player has not confirmed giving it up. A season
 * nobody has raced in yet, or a complete one, is replaced without asking.
 */
export function startNewSeason(
  current: Season | null,
  humanCount: number,
  difficulty: string,
  seed: number,
  confirmed = false,
): NewSeasonAnswer {
  if (current && seasonUnfinished(current) && !confirmed) return {needsConfirmation: true, unfinished: current};
  return {started: newSeason(humanCount, difficulty, seed)};
}
/** "ROUND 2 OF 5 · RED MESA · HEAT" */
export function raceTitle(race: SeasonRace) {
  return `ROUND ${race.round + 1} OF ${SEASON_ROUNDS} · ${race.course.name.toUpperCase()} · ${race.stage.toUpperCase()}`;
}
