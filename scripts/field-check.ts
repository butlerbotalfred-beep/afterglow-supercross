// Field check: all-AI races at every difficulty with 4, 5, 6 and 8 riders on every circuit. The pace gate only
// runs four riders at club and expert; this catches crashes that only traffic or the relaxed pace bring out.
//   npx tsx scripts/field-check.ts            print any race with a crash, a recovery or a non-finisher
//   npx tsx scripts/field-check.ts --check    also fail if there is one
import {aiRace, COURSES} from './sim';

const bad: string[] = [];
let races = 0;
for (const riders of [4, 5, 6, 8])
  for (const difficulty of ['relaxed', 'club', 'expert'])
    for (const course of COURSES) {
      const r = aiRace(course, difficulty, riders);
      races++;
      if (r.crashes || r.recoveries || r.finishers < riders)
        bad.push(
          `${riders} riders, ${difficulty}, ${course.id}: ${r.crashes} crashes, ${r.recoveries} recoveries, ${r.finishers} finished`,
        );
    }
// The same fields with the computer riders allowed to misjudge jumps, as they are in the game. They crash now and
// then, but nobody may get stuck, a race may not turn into a pile-up, and a crash may not cost the race.
const SEEDS = [11, 222];
const fallen: Record<string, number> = {relaxed: 0, club: 0, expert: 0};
for (const difficulty of ['relaxed', 'club', 'expert'])
  for (const course of COURSES) {
    const perfect = aiRace(course, difficulty, 6);
    for (const seed of SEEDS) {
      const r = aiRace(course, difficulty, 6, 650, seed);
      races++;
      fallen[difficulty] += r.crashes;
      const slower = r.last - perfect.last;
      if (r.finishers < 6 || r.crashes > 6 || slower > 12)
        bad.push(
          `fallible, seed ${seed}, ${difficulty}, ${course.id}: ${r.crashes} crashes, ${r.finishers} finished, ` +
            `last rider ${slower.toFixed(1)} s later`,
        );
    }
  }
for (const [difficulty, crashes] of Object.entries(fallen)) {
  const perRace = crashes / (COURSES.length * SEEDS.length);
  console.log(`field-check: fallible ${difficulty} riders crash ${perRace.toFixed(1)} times a race`);
  if (perRace < 0.2 || perRace > 3)
    bad.push(`fallible ${difficulty}: ${perRace.toFixed(1)} crashes a race, outside 0.2 to 3`);
}
console.log(`field-check: ${races - bad.length}/${races} races clean${bad.length ? '\n  ' + bad.join('\n  ') : ''}`);
if (bad.length && process.argv.includes('--check')) process.exit(1);
