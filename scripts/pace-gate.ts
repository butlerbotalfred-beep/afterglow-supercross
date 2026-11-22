// Pace gate: runs the ten baseline AI races (5 circuits x club/expert) and compares them
// with baselines/pace.json.
//   npx tsx scripts/pace-gate.ts [--tolerance <percent>] [--baseline <file>] [--write]
// --tolerance defaults to 0 (exact match). --write regenerates the baseline file.
// --baseline compares with another file, such as baselines/pace-v1.json (the times before M1.2).
// Whatever the baseline, no landing in any race may add more than the bonus cap.
import {readFileSync, writeFileSync} from 'node:fs';
import {TUNING} from '../src/config';
import {aiRace, COURSES, type RaceResult} from './sim';

const args = process.argv.slice(2);
const tolArg = args.indexOf('--tolerance');
const tolerance = tolArg >= 0 ? Number(args[tolArg + 1]) : 0;
if (!Number.isFinite(tolerance) || tolerance < 0) {
  console.error('--tolerance must be a non-negative percent');
  process.exit(2);
}
const baseArg = args.indexOf('--baseline');
if (baseArg >= 0 && (!args[baseArg + 1] || args.includes('--write'))) {
  console.error('--baseline needs a file, and cannot be combined with --write');
  process.exit(2);
}
const file = baseArg >= 0 ? args[baseArg + 1] : new URL('../baselines/pace.json', import.meta.url);
const bonusCapKmh = TUNING.landingBonusMax * 3.6;

const results: RaceResult[] = [];
for (const difficulty of ['club', 'expert']) for (const course of COURSES) results.push(aiRace(course, difficulty));

if (args.includes('--write')) {
  writeFileSync(
    file,
    JSON.stringify(
      {
        note:
          'AI race winner times, 3 laps, 4 NPC riders, 120 Hz, physics version 2. Regenerate only with sign-off. ' +
          'pace-v1.json holds the times before M1.2.',
        races: results,
      },
      null,
      2,
    ) + '\n',
  );
  console.table(results);
  console.log('Wrote baselines/pace.json');
  process.exit(0);
}

const baseline: RaceResult[] = JSON.parse(readFileSync(file, 'utf8')).races;
let failed = 0;
const rows = [];
for (const b of baseline) {
  const r = results.find(x => x.course === b.course && x.difficulty === b.difficulty);
  if (!r) {
    failed++;
    rows.push({...b, status: 'MISSING'});
    continue;
  }
  const diffPct = (r.winner / b.winner - 1) * 100;
  const ok =
    Math.abs(diffPct) <= tolerance + 1e-9 &&
    r.crashes === 0 &&
    r.recoveries === 0 &&
    r.finishers === b.finishers &&
    (r.maxBonusKmh ?? 0) <= bonusCapKmh + 1e-9;
  if (!ok) failed++;
  rows.push({
    course: b.course,
    difficulty: b.difficulty,
    baseline: b.winner,
    now: r.winner,
    diffPct: diffPct.toFixed(3),
    crashes: r.crashes,
    recoveries: r.recoveries,
    maxBonusKmh: r.maxBonusKmh,
    status: ok ? 'ok' : 'FAIL',
  });
}
if (baseline.length !== results.length) {
  failed++;
  console.error(`pace-gate: baseline has ${baseline.length} races, expected ${results.length}`);
}
console.table(rows);
console.log(
  `pace-gate: ${rows.length - failed}/${rows.length} races within ${tolerance}% with 0 crashes and 0 recoveries, ` +
    `largest landing bonus ${Math.max(...results.map(r => r.maxBonusKmh ?? 0))} km/h (cap ${bonusCapKmh})`,
);
process.exit(failed ? 1 : 0);
