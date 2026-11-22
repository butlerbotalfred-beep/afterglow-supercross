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
console.log(`field-check: ${races - bad.length}/${races} races clean${bad.length ? '\n  ' + bad.join('\n  ') : ''}`);
if (bad.length && process.argv.includes('--check')) process.exit(1);
