import test from 'node:test';
import assert from 'node:assert/strict';
import {TUNING} from '../src/config.ts';
import {COURSES} from '../src/courses.ts';
import {npcControl, type Rider} from '../src/physics.ts';
import {Rng} from '../src/rng.ts';
import {SAVE_KEY, SaveStore} from '../src/save.ts';
import {
  HEAT_SECONDS,
  MAIN_POINTS,
  MAIN_SECONDS,
  POINTS,
  SEASON_ROUNDS,
  aiSeason,
  asSeason,
  mainPoints,
  newSeason,
  nextRace,
  raceTitle,
  recordRace,
  seasonComplete,
  seasonUnfinished,
  standings,
  startNewSeason,
  type Season,
} from '../src/season.ts';
import {Track} from '../src/track.ts';
import {RaceSession, TIMED_CLOSE_SECONDS} from '../src/game/race-session.ts';
import {runRound, seasonGrid, seasonOrder, seasonStart} from '../src/game/season-run.ts';
import {ranking} from '../src/ui/results-screen.ts';

const STEP = TUNING.step;
const coast = new Track(COURSES.find(c => c.id === 'coast')!);
const quiet = {countdown() {}, racing() {}, cue() {}, landing() {}, pause() {}, results() {}};
function memory() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, v: string) => void values.set(key, v),
  };
}
/** A seeded shuffle of the eight entrant ids. */
function order(seed: number) {
  const rng = new Rng(seed);
  const ids = [0, 1, 2, 3, 4, 5, 6, 7];
  for (let i = 7; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}
/** A season with these mains run, each after a heat in entry order. */
function seasonWith(mains: number[][]) {
  let season = newSeason(1, 'club', 7);
  for (const main of mains) season = recordRace(recordRace(season, [0, 1, 2, 3, 4, 5, 6, 7]), main);
  return season;
}
const names = (season: Season) => standings(season).map(row => row.entrant.id);

test('a season is five rounds, one on each circuit, each a timed heat and a timed main', () => {
  let season = newSeason(2, 'club', 11);
  assert.equal(season.entrants.length, 8);
  assert.deepEqual(
    season.entrants.map(e => e.human),
    [true, true, false, false, false, false, false, false],
  );
  assert.equal(new Set(season.entrants.map(e => e.number)).size, 8, 'no two entrants share a number');
  const seen: string[] = [];
  for (let n = 0; n < SEASON_ROUNDS * 2; n++) {
    const race = nextRace(season)!;
    seen.push(`${race.course.id} ${race.stage} ${race.seconds}`);
    assert.deepEqual([...race.slots].sort(), [0, 1, 2, 3, 4, 5, 6, 7], 'everybody has a gate of their own');
    assert.match(raceTitle(race), /^ROUND [1-5] OF 5 · [A-Z ]+ · (HEAT|MAIN)$/);
    season = recordRace(season, order(n + 1));
  }
  assert.deepEqual(
    seen,
    COURSES.flatMap(c => [`${c.id} heat ${HEAT_SECONDS}`, `${c.id} main ${MAIN_SECONDS}`]),
  );
  assert.equal(HEAT_SECONDS, 180);
  assert.equal(MAIN_SECONDS, 360);
  assert.ok(seasonComplete(season));
  assert.throws(() => recordRace(season, order(1)), /complete/);
  assert.throws(() => recordRace(newSeason(1, 'club', 1), [0, 1, 2, 3, 4, 5, 6, 6]), /all eight/);
});

test('every 8-rider main awards exactly 147 points, and heats award none', () => {
  assert.deepEqual(POINTS, [25, 22, 20, 18, 17, 16, 15, 14]);
  assert.equal(MAIN_POINTS, 147);
  for (let seed = 1; seed <= 200; seed++) {
    const points = mainPoints(order(seed));
    assert.equal(
      points.reduce((a, b) => a + b, 0),
      147,
    );
    assert.equal(points.filter(p => p > 0).length, 8, 'all eight score');
  }
  let season = newSeason(1, 'club', 3);
  const total = () => standings(season).reduce((n, row) => n + row.points, 0);
  for (let round = 0; round < SEASON_ROUNDS; round++) {
    season = recordRace(season, order(round * 2 + 1));
    assert.equal(total(), 147 * round, 'a heat scores nothing');
    season = recordRace(season, order(round * 2 + 2));
    assert.equal(total(), 147 * (round + 1));
  }
});

test('a real round: the heat result is the gate order for the main, and the main awards 147 points', () => {
  const season = aiSeason('club', 2026);
  const {round, seconds} = runRound(season, 3);
  const heat = round.heat!,
    main = round.main!;
  // Round 4 is Saltwind Coast. With the heat run, the round's next race is the main on the heat's order.
  const rounds = season.rounds.map((r, i) => (i < 3 ? {heat, main} : i === 3 ? {heat, main: null} : r));
  const race = nextRace({...season, rounds})!;
  assert.equal(`${race.course.id} ${race.stage}`, 'coast main');
  heat.forEach((id, place) => assert.equal(race.slots[id], place, 'the heat winner has the first gate, and so on'));
  const session = new RaceSession(
    {sample: () => npcControl(session.riders[0], coast, [], 'club'), connectedGamepads: () => []},
    quiet,
  );
  session.grid(seasonGrid(season, race, coast, []));
  // On the grid: the first row is gates 0 to 3 across the track, the second row 2.8 m behind.
  for (const r of session.riders) {
    assert.equal(r.slot, heat.indexOf(r.id));
    assert.ok(Math.abs(r.surface.lateral - ((r.slot! % 4) - 1.5) * 1.9) < 1e-6);
    assert.ok(Math.abs(r.progress.lastS - (-3 - Math.floor(r.slot! / 4) * 2.8)) < 1e-6);
    assert.equal(r.name, season.entrants[r.id].name);
  }
  assert.equal(
    mainPoints(main).reduce((a, b) => a + b, 0),
    147,
  );
  assert.deepEqual([...main].sort(), [0, 1, 2, 3, 4, 5, 6, 7]);
  // The round is about 12 minutes of racing.
  const minutes = (seconds.heat + seconds.main) / 60;
  assert.ok(minutes >= 10 && minutes <= 14, `${minutes.toFixed(1)} minutes`);
});

test('both tiebreaks give the correct order', () => {
  // Most wins: riders 0 and 1 have 61 points each after three mains, 25 + 18 + 18 against 22 + 22 + 17.
  const wins = seasonWith([
    [0, 1, 2, 3, 4, 5, 6, 7],
    [2, 1, 3, 0, 4, 5, 6, 7],
    [2, 3, 4, 0, 1, 5, 6, 7],
  ]);
  const [a, b] = [0, 1].map(id => standings(wins).find(row => row.entrant.id === id)!);
  assert.equal(a.points, 61);
  assert.equal(b.points, 61);
  assert.ok(a.wins === 1 && b.wins === 0);
  assert.ok(a.position < b.position, 'level on points: the rider with a win is ahead');
  // The same points and the same wins: the better result in the latest round decides, either way round.
  const latest = seasonWith([
    [2, 0, 1, 3, 4, 5, 6, 7],
    [2, 1, 0, 3, 4, 5, 6, 7],
  ]);
  const rows = standings(latest);
  const [c, d] = [0, 1].map(id => rows.find(row => row.entrant.id === id)!);
  assert.ok(c.points === 42 && d.points === 42 && c.wins === 0 && d.wins === 0);
  assert.ok(d.position < c.position, 'rider 1 was second in the latest round, rider 0 third');
  const swapped = seasonWith([
    [2, 1, 0, 3, 4, 5, 6, 7],
    [2, 0, 1, 3, 4, 5, 6, 7],
  ]);
  assert.deepEqual(names(swapped).slice(0, 3), [2, 0, 1]);
  assert.deepEqual(names(latest).slice(0, 3), [2, 1, 0]);
  // Wins come before the latest round: rider 0 has the win, rider 1 the better latest result.
  const both = seasonWith([
    [0, 1, 2, 3, 4, 5, 6, 7],
    [2, 1, 3, 0, 4, 5, 6, 7],
    [2, 3, 4, 0, 1, 5, 6, 7],
    [4, 5, 6, 7, 2, 3, 1, 0],
    [4, 5, 6, 7, 3, 2, 0, 1],
  ]);
  const [e, f] = [0, 1].map(id => standings(both).find(row => row.entrant.id === id)!);
  assert.equal(e.points, f.points);
  assert.ok(e.position < f.position);
  // Positions are 1 to 8 with nobody level, and the table never changes for the same season.
  assert.deepEqual(
    standings(both).map(row => row.position),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  assert.deepEqual(standings(both), standings(both));
});

/** A timed race on Saltwind Coast with one human on the autopilot at a share of full throttle. */
function timed(seconds: number, human = 1) {
  const season = newSeason(1, 'club', 5);
  const race = {...nextRace(season)!, seconds};
  const session: RaceSession = new RaceSession(
    {
      sample: () => {
        const c = npcControl(session.riders[0], coast, session.riders, 'club');
        return {...c, throttle: c.throttle * human};
      },
      connectedGamepads: () => [],
    },
    quiet,
  );
  session.grid(seasonGrid(season, race, coast, [{kind: 'keyboard'}]));
  session.start(seasonStart(season, race));
  while (session.phase === 'countdown') session.step(STEP);
  return session;
}

test('a timed race ends by the rule: time expires, then one more lap', () => {
  const session = timed(70, 0.5);
  const crossings: {id: number; laps: number; time: number}[] = [];
  let atExpiry: number[] | null = null;
  while (session.phase !== 'results') {
    const before = session.riders.map(r => r.progress.lap);
    if (atExpiry === null && session.raceTime >= 70) atExpiry = before;
    session.step(STEP);
    session.riders.forEach((r, i) => {
      if (r.progress.lap > before[i]) crossings.push({id: r.id, laps: r.progress.lap, time: session.raceTime});
    });
    if (session.raceTime < 70) {
      assert.ok(
        session.riders.every(r => r.finished === null),
        'nobody finishes while the clock runs',
      );
      assert.equal(session.flagLap, null);
    }
    assert.ok(session.raceTime < 400, 'the race ends');
  }
  // The first crossing after time was up, by the leader, started the last lap.
  const late = crossings.filter(c => c.time >= 70);
  const leaderLaps = Math.max(...atExpiry!);
  assert.equal(late[0].laps, leaderLaps + 1, 'the leader finishes the lap it was on');
  assert.equal(session.flagLap, leaderLaps + 2, 'then there is one more lap');
  const order = ranking(session.riders, coast);
  const winner = order[0];
  assert.equal(winner.finishedLaps, session.flagLap);
  assert.equal(winner.finished, crossings.find(c => c.laps === session.flagLap)!.time, 'the first to complete it wins');
  // Everybody else finishes the next time they cross the line after the winner, whatever lap they are on.
  for (const r of session.riders) {
    if (r === winner || r.finished === null) continue;
    const next = crossings.find(c => c.id === r.id && c.time > winner.finished!)!;
    assert.equal(r.finished, next.time, r.name);
    assert.equal(r.finishedLaps, next.laps);
    assert.ok(r.finishedLaps! <= session.flagLap!);
  }
  // The human dawdled and was lapped or left behind; the race still closed, and nobody is a retirement.
  assert.ok(session.raceTime <= winner.finished! + TIMED_CLOSE_SECONDS + STEP);
  assert.ok(session.riders.every(r => !r.dnf));
  assert.deepEqual([...seasonOrder(session)].sort(), [0, 1, 2, 3, 4, 5, 6, 7]);
  // A longer clock gives a longer race: the rule follows the time, not a lap count.
  const short = timed(20);
  while (short.phase !== 'results') short.step(STEP);
  assert.ok(short.flagLap! < session.flagLap!);
  assert.equal(short.lapCount, Infinity);
});

test('time running out between the leader and a rider behind on the same lap does not cost the race a lap', () => {
  // Eight computer riders, the same race three times. First with a clock that never runs out, to find when the
  // leader and the last rider complete their third lap.
  const season = aiSeason('club', 31);
  const run = (seconds: number) => {
    const race = {...nextRace(season)!, seconds};
    const session = new RaceSession(
      {sample: () => npcControl(session.riders[0], coast, [], 'club'), connectedGamepads: () => []},
      quiet,
    );
    session.grid(seasonGrid(season, race, coast, []));
    session.start(seasonStart(season, race));
    return session;
  };
  const open = run(1e9);
  const third: number[] = [];
  while (third.length < 8) {
    const before = open.riders.map(r => r.progress.lap);
    open.step(STEP);
    open.riders.forEach((r, i) => r.progress.lap === 3 && before[i] === 2 && third.push(open.raceTime));
  }
  const [leaderAt, lastAt] = [third[0], third[7]];
  assert.ok(lastAt - leaderAt > 1, 'the field is spread out');
  // Time up just after the leader has started lap 4, with riders still to complete lap 3: their crossings are
  // not the leader's. The leader completes lap 4, and lap 5 is the last.
  const between = run(leaderAt + 0.5);
  while (between.phase !== 'results') between.step(STEP);
  assert.equal(between.flagLap, 5);
  assert.equal(ranking(between.riders, coast)[0].finishedLaps, 5);
  // Time up just before the leader gets there: lap 3 is the lap in hand, and lap 4 is the last.
  const before = run(leaderAt - 0.5);
  while (before.phase !== 'results') before.step(STEP);
  assert.equal(before.flagLap, 4);
  // Either way all eight are classified, on the winner's lap or behind it.
  for (const session of [between, before]) {
    assert.ok(session.riders.every(r => r.finished !== null && r.finishedLaps! <= session.flagLap!));
    assert.deepEqual([...seasonOrder(session)].sort(), [0, 1, 2, 3, 4, 5, 6, 7]);
  }
});

test('riders on different laps are classified by laps, then time, with riders still out placed where they are', () => {
  const rider = (id: number, finished: number | null, finishedLaps: number | undefined, lap: number, s: number) =>
    ({
      id,
      finished,
      finishedLaps,
      progress: {lap, nextCheckpoint: 1, lastS: s, distanceSinceCheckpoint: s},
    }) as unknown as Rider;
  const riders = [
    rider(0, 400, 7, 7, 10), // the winner
    rider(1, 402, 6, 6, 10), // a lap down, across the line two seconds after the winner
    rider(2, null, undefined, 6, 900), // on the lead lap, 20 seconds from the line when the race closed
    rider(3, 430, 5, 5, 10), // two laps down
    rider(4, 405, 7, 7, 10), // second
    rider(5, null, undefined, 5, 300), // a lap down and still out
  ];
  assert.deepEqual(
    ranking(riders, coast).map(r => r.id),
    [0, 4, 2, 1, 5, 3],
  );
});

test('closing and reopening resumes at the next race', () => {
  const storage = memory();
  let save = new SaveStore(storage);
  assert.equal(save.season, null);
  const answer = startNewSeason(save.season, 2, 'expert', 99);
  assert.ok('started' in answer);
  assert.equal(save.setSeason(answer.started), true);
  // Closed before the first race: it is still round 1's heat, on the same grid.
  save = new SaveStore(storage);
  const first = nextRace(save.season!)!;
  assert.equal(`${first.round} ${first.stage}`, '0 heat');
  assert.deepEqual(first, nextRace(answer.started));
  // A race left half way through is not recorded, so the same race is waiting.
  save = new SaveStore(storage);
  assert.deepEqual(nextRace(save.season!), first);
  // After every race the season is saved, and a new visit carries on from the next one.
  const expected = ['0 main', '1 heat', '1 main', '2 heat', '2 main', '3 heat', '3 main', '4 heat', '4 main'];
  for (const [n, want] of expected.entries()) {
    const result = order(n + 40);
    save.setSeason(recordRace(save.season!, result));
    save = new SaveStore(storage);
    const race = nextRace(save.season!)!;
    assert.equal(`${race.round} ${race.stage}`, want);
    if (race.stage === 'main') result.forEach((id, place) => assert.equal(race.slots[id], place));
    assert.equal(save.season!.entrants.filter(e => e.human).length, 2, 'both players are still in it');
    assert.equal(save.season!.difficulty, 'expert');
  }
  save.setSeason(recordRace(save.season!, order(77)));
  save = new SaveStore(storage);
  assert.ok(seasonComplete(save.season!));
  assert.equal(
    standings(save.season!).reduce((n, row) => n + row.points, 0),
    147 * 5,
  );
  // The rest of the save is untouched by a season, and the season by the rest.
  save.setSlideAggression(1.4);
  save.write();
  assert.ok(seasonComplete(new SaveStore(storage).season!));
  assert.equal(JSON.parse(storage.values.get(SAVE_KEY)!).settings.slideAggression, 1.4);
  // Blocked storage: the season still runs for the visit, and the game is told it was not kept.
  const blocked = new SaveStore(null);
  assert.equal(blocked.setSeason(newSeason(1, 'club', 1)), false);
  assert.ok(blocked.season);
  // The same when the browser refuses the write (storage full): not kept, and nothing there on reopening.
  const full = {getItem: () => null, setItem: () => assert.fail('storage is full')};
  const refused = new SaveStore(full);
  assert.equal(refused.setSeason(newSeason(1, 'club', 1)), false);
  assert.ok(refused.season);
  assert.equal(new SaveStore(full).season, null);
});

test('a stored season that is damaged is not resumed', () => {
  const good = recordRace(newSeason(1, 'club', 4), order(1));
  assert.deepEqual(asSeason(JSON.parse(JSON.stringify(good))), good);
  const broken = (change: (s: any) => void) => {
    const copy = JSON.parse(JSON.stringify(good));
    change(copy);
    return asSeason(copy);
  };
  assert.equal(asSeason(null), null);
  assert.equal(asSeason('season'), null);
  assert.equal(
    broken(s => (s.version = 2)),
    null,
  );
  assert.equal(
    broken(s => s.entrants.pop()),
    null,
  );
  assert.equal(
    broken(s => (s.rounds[0].heat = [0, 0, 1, 2, 3, 4, 5, 6])),
    null,
  );
  assert.equal(
    broken(s => (s.rounds[2].heat = order(3))),
    null,
    'a race after one still to run',
  );
  assert.equal(
    broken(s => (s.rounds[1].main = order(3))),
    null,
    'a main without its heat',
  );
  assert.equal(
    broken(s => (s.entrants[5].number = 999)),
    null,
    'a rider who is not in the roster',
  );
  assert.equal(
    broken(s => (s.difficulty = 'turbo')),
    null,
  );
  assert.equal(
    broken(s => (s.entrants[6].number = s.entrants[5].number)),
    null,
    'the same rider twice',
  );
  assert.equal(
    broken(s => (s.difficulty = 'expert')),
    null,
    'riders who are not the ones that pace picks',
  );
  // Names and colours are not taken from storage: they come from the roster and the player slots.
  const renamed = broken(s => {
    s.entrants[0].name = '<img src=x>';
    s.entrants[5].name = '<b>X</b>';
    s.entrants[5].color = 1;
  });
  assert.deepEqual(renamed, good);
  // A season with nobody playing in it (an automated one) is not offered to a player.
  const storage = memory();
  const save = new SaveStore(storage);
  save.setSeason(aiSeason('club', 1));
  assert.equal(new SaveStore(storage).season, null);
  assert.ok(asSeason(JSON.parse(JSON.stringify(aiSeason('club', 1)))));
});

test('starting a new season over an unfinished one asks for confirmation', () => {
  // Nothing yet, or a season nobody has raced in: no question.
  assert.ok('started' in startNewSeason(null, 1, 'club', 1));
  const fresh = newSeason(1, 'club', 1);
  assert.equal(seasonUnfinished(fresh), false);
  assert.ok('started' in startNewSeason(fresh, 1, 'club', 2));
  // One race in, and at every point until the last main: it asks, and changes nothing until confirmed.
  let season = fresh;
  for (let n = 0; n < SEASON_ROUNDS * 2 - 1; n++) {
    season = recordRace(season, order(n + 1));
    assert.equal(seasonUnfinished(season), true);
    const answer = startNewSeason(season, 3, 'relaxed', 8);
    assert.ok('needsConfirmation' in answer && answer.unfinished === season, `after race ${n + 1}`);
    const confirmed = startNewSeason(season, 3, 'relaxed', 8, true);
    assert.ok('started' in confirmed);
    assert.equal(confirmed.started.entrants.filter(e => e.human).length, 3);
    assert.equal(confirmed.started.rounds[0].heat, null);
  }
  // A finished season is history: a new one starts without asking.
  season = recordRace(season, order(50));
  assert.equal(seasonUnfinished(season), false);
  assert.ok('started' in startNewSeason(season, 1, 'club', 9));
});
