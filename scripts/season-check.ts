// Season check: a whole championship with eight computer riders and nobody at the controls.
//   npx tsx scripts/season-check.ts               one Club season: every round's length and the final table
//   npx tsx scripts/season-check.ts --check       also fail if a target is missed (CI)
//   npx tsx scripts/season-check.ts --all         Relaxed and Expert seasons as well
// The five rounds do not depend on each other, so each is run in its own process and the season is put
// together from them: the same season as running them one after another, in a fraction of the time.
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runRound} from '../src/game/season-run';
import {
  MAIN_POINTS,
  SEASON_COURSES,
  SEASON_ROUNDS,
  aiSeason,
  asSeason,
  nextRace,
  recordRace,
  standings,
} from '../src/season';

const args = process.argv.slice(2);
const SEED = 2026;
const value = (flag: string) => args[args.indexOf(flag) + 1];

if (args.includes('--round')) {
  // A worker: one round, printed as JSON for the parent.
  const season = aiSeason(value('--level'), SEED);
  console.log(JSON.stringify(runRound(season, Number(value('--round')))));
} else {
  const started = Date.now();
  const problems: string[] = [];
  const self = fileURLToPath(import.meta.url);
  const worker = (level: string, round: number) =>
    new Promise<ReturnType<typeof runRound>>((resolve, reject) =>
      execFile(
        process.execPath,
        [...process.execArgv, self, '--round', String(round), '--level', level],
        {maxBuffer: 1 << 20},
        (error, stdout) => (error ? reject(error) : resolve(JSON.parse(stdout))),
      ),
    );
  for (const level of args.includes('--all') ? ['club', 'relaxed', 'expert'] : ['club']) {
    const began = Date.now();
    const rounds = await Promise.all(Array.from({length: SEASON_ROUNDS}, (_, round) => worker(level, round)));
    let season = aiSeason(level, SEED);
    for (const r of rounds) {
      season = recordRace(season, r.round.heat!);
      season = recordRace(season, r.round.main!);
    }
    const wall = (Date.now() - began) / 1000;
    rounds.forEach((r, i) => {
      const minutes = (r.seconds.heat + r.seconds.main) / 60;
      const ok = minutes >= 10 && minutes <= 14;
      if (!ok) problems.push(`${level} ${SEASON_COURSES[i].id}: a round is ${minutes.toFixed(1)} minutes of racing`);
      console.log(
        `season-check: ${ok ? 'ok  ' : 'FAIL'} ${level.padEnd(7)} round ${i + 1} ${SEASON_COURSES[i].id.padEnd(6)} ` +
          `heat ${r.seconds.heat.toFixed(1)} s + main ${r.seconds.main.toFixed(1)} s = ${minutes.toFixed(1)} min, ` +
          `winner home after ${((r.won.heat + r.won.main) / 60).toFixed(1)} min, ${r.crashes} crashes`,
      );
    });
    // Valid standings: the season is complete and reads back as stored, every rider has five results, the
    // points add up, and the table is in order.
    const table = standings(season);
    const total = table.reduce((n, row) => n + row.points, 0);
    if (nextRace(season)) problems.push(`${level}: the season is not complete`);
    if (!asSeason(JSON.parse(JSON.stringify(season)))) problems.push(`${level}: the season does not read back`);
    if (total !== MAIN_POINTS * SEASON_ROUNDS) problems.push(`${level}: ${total} points awarded`);
    if (table.some(row => row.results.length !== SEASON_ROUNDS)) problems.push(`${level}: a rider is missing a result`);
    if (table.some((row, i) => i > 0 && row.points > table[i - 1].points))
      problems.push(`${level}: table out of order`);
    console.log(
      `season-check: ${level} season in ${wall.toFixed(1)} s, ${total} points: ` +
        table.map(row => `${row.position} ${row.entrant.name} ${row.points}`).join(', '),
    );
    if (level === 'club' && wall >= 60) problems.push(`the Club season took ${wall.toFixed(1)} s`);
  }
  console.log(`season-check: ${((Date.now() - started) / 1000).toFixed(1)} s in all`);
  if (problems.length) {
    console.log(`season-check: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`);
    if (args.includes('--check')) process.exit(1);
  } else console.log('season-check: all clear');
}
