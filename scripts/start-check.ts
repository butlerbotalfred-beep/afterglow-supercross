// Start check: 100 seeded 8-rider starts on every circuit, all roster riders, from the gate to the holeshot
// line. Nobody may crash, be sent back to the track or fail to reach the line.
//   npx tsx scripts/start-check.ts            print the result for each circuit
//   npx tsx scripts/start-check.ts --check    also fail if any start has a crash
import {StartGate, pastHoleshot} from '../src/gate';
import {collide, makeRider, npcControl, stepRider} from '../src/physics';
import {gridFor, shuffled} from '../src/riders';
import {Track} from '../src/track';
import {COURSES, STEP} from './sim';

const STARTS = 100;
const RIDERS = 8;
const LEVELS = ['relaxed', 'club', 'expert'];
let bad = 0;
for (const course of COURSES) {
  const track = new Track(course);
  let crashes = 0,
    recoveries = 0,
    late = 0,
    slowest = 0;
  const winners = new Set<number>();
  for (let seed = 1; seed <= STARTS; seed++) {
    const difficulty = LEVELS[seed % LEVELS.length];
    // The riders the game puts on the grid for the pace setting, in the game's seeded order.
    const riders = shuffled(gridFor(difficulty, RIDERS), seed).map((profile, id) =>
      Object.assign(makeRider(track, id, false, profile.plate), {profile, name: profile.name}),
    );
    const gate = new StartGate(seed, riders, difficulty);
    while (!gate.wait(STEP, () => null).dropped);
    let first = -1,
      seconds = 0;
    const through = new Set<number>();
    // As the race runs it: riders are held for their reaction, and nobody is made to misjudge a jump before the line.
    for (; through.size < RIDERS && seconds < 90; seconds += STEP) {
      riders.forEach((r, index) => {
        if (!gate.release(index, r)) return;
        const before = r.recovery;
        const line = pastHoleshot(r.progress, track);
        stepRider(r, npcControl(r, track, riders, difficulty, line ? seed : 0), track, STEP, riders);
        if (through.has(r.id)) return;
        if (!before && r.recovery > 0) recoveries++;
        if (pastHoleshot(r.progress, track)) {
          through.add(r.id);
          crashes += r.crashes;
          if (first < 0) first = r.id;
        }
      });
      collide(riders, track);
    }
    for (const r of riders) if (!through.has(r.id)) crashes += r.crashes;
    late += RIDERS - through.size;
    slowest = Math.max(slowest, seconds);
    winners.add(first);
  }
  const ok = !crashes && !recoveries && !late;
  if (!ok) bad++;
  console.log(
    `start-check: ${ok ? 'ok  ' : 'FAIL'} ${course.id.padEnd(6)} ${STARTS} starts of ${RIDERS}, line at ${track.holeshot} m: ` +
      `${crashes} crashes, ${recoveries} recoveries, ${late} riders never reached the line, ` +
      `${winners.size} different riders took the holeshot, slowest field through in ${slowest.toFixed(1)} s`,
  );
}
console.log(
  bad ? `start-check: ${bad} circuit(s) with trouble before the holeshot line` : 'start-check: all starts clean',
);
if (bad && process.argv.includes('--check')) process.exit(1);
