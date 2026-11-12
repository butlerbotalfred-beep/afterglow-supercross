// Landing harness: one NPC rider per circuit, three laps, run once normally (matching the
// landing slope with air pitch) and once with pitch input forced to zero. The gap shows
// how much the game rewards pitching to match the landing.
//   npx tsx scripts/landing-harness.ts            print the table
//   npx tsx scripts/landing-harness.ts --check    fail if any gap differs from baselines/landing.json
//   npx tsx scripts/landing-harness.ts --write    record the current gaps as the baseline
import {readFileSync, writeFileSync} from 'node:fs';
import {soloLaps, COURSES, round} from './sim';

const rows = COURSES.map(course => {
  const match = soloLaps(course, 'match'),
    nopitch = soloLaps(course, 'nopitch');
  return {
    course: course.id,
    matchS: round(match.seconds, 2),
    nopitchS: round(nopitch.seconds, 2),
    gapPct: round((nopitch.seconds / match.seconds - 1) * 100, 2),
    crashes: match.crashes + nopitch.crashes,
  };
});
console.table(rows);
const file = new URL('../baselines/landing.json', import.meta.url);
if (process.argv.includes('--write')) {
  writeFileSync(
    file,
    JSON.stringify(
      {
        note: 'Time lost over 3 laps by a rider who never uses air pitch. M1.2 is expected to raise these on purpose.',
        circuits: rows,
      },
      null,
      2,
    ) + '\n',
  );
  console.log('Wrote baselines/landing.json');
} else if (process.argv.includes('--check')) {
  const base: typeof rows = JSON.parse(readFileSync(file, 'utf8')).circuits;
  const bad = rows.filter(r => {
    const b = base.find(x => x.course === r.course);
    return !b || r.crashes !== 0 || r.gapPct !== b.gapPct || r.matchS !== b.matchS || r.nopitchS !== b.nopitchS;
  });
  const ok = !bad.length && base.length === rows.length;
  console.log(
    ok
      ? `landing-harness: all ${rows.length} circuits match baseline with 0 crashes`
      : `landing-harness: mismatch (baseline has ${base.length} of ${rows.length} circuits; differing: ${bad.map(r => r.course).join(', ') || 'none'})`,
  );
  process.exit(ok ? 0 : 1);
}
