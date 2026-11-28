// Roster check: the named computer riders racing as they do in the game (gate start, seeded mistakes).
//   npx tsx scripts/roster-check.ts                 50 seeded 8-rider Club races on Dusk Valley, the fastest
//                                                   Club rider on every circuit, and the roster baselines
//   npx tsx scripts/roster-check.ts --check         also fail if a target is missed
//   npx tsx scripts/roster-check.ts --write         record baselines/roster.json (needs sign-off, like pace.json)
//   npx tsx scripts/roster-check.ts --mistakes [n]  every rider alone for n laps (500): mistakes made against rating
//   npx tsx scripts/roster-check.ts --costs [n]     one rider alone for n laps (150) on every circuit: what each
//                                                   kind of mistake costs against a clean lap (--name "K. NOVA")
import {readFileSync, writeFileSync} from 'node:fs';
import {makeRider, npcControl, stepRider} from '../src/physics';
import {ROSTER, mistakeRate} from '../src/riders';
import {Track} from '../src/track';
import {COURSES, STEP, rosterRace} from './sim';

const args = process.argv.slice(2);
const check = args.includes('--check');
const file = new URL('../baselines/roster.json', import.meta.url);
const problems: string[] = [];

if (args.includes('--costs')) {
  // What a mistake costs: one rider alone, the lap with the mistake and the lap after it against two clean laps.
  const laps = Number(args[args.indexOf('--costs') + 1]) || 150;
  const profile = ROSTER.find(p => p.name === (args.includes('--name') ? args[args.indexOf('--name') + 1] : 'T. FOX'))!;
  for (const course of COURSES) {
    const ride = (seed: number, count: number) => {
      const track = new Track(course);
      const r = Object.assign(makeRider(track, 0, false, profile.plate), {profile, name: profile.name});
      const times: number[] = [];
      const kinds: (string | null)[] = [];
      let last = 0;
      for (let t = STEP; r.progress.lap < count && t < count * 400; t += STEP) {
        const lap = r.progress.lap;
        stepRider(r, npcControl(r, track, [r], 'club', seed), track, STEP, [r]);
        if (r.progress.lap > lap) {
          times.push(t - last);
          kinds.push(r.slipLap === lap ? r.slipKind! : null);
          last = t;
        }
      }
      return {times, kinds, crashes: r.crashes};
    };
    const clean = ride(0, 4).times[2];
    const {times, kinds, crashes} = ride(20261128, laps);
    const cost: Record<string, number[]> = {late: [], flat: [], wide: []};
    for (let lap = 2; lap + 1 < times.length; lap++)
      if (kinds[lap] && !kinds[lap + 1] && !kinds[lap - 1])
        cost[kinds[lap]!].push(times[lap] + times[lap + 1] - 2 * clean);
    for (const [kind, list] of Object.entries(cost)) {
      const least = Math.min(...list);
      const ok = list.length > 0 && least >= 0.1;
      if (!ok) problems.push(`${course.id}: a ${kind} mistake cost ${least.toFixed(3)} s at least`);
      console.log(
        `roster-check: ${ok ? 'ok  ' : 'FAIL'} ${course.id.padEnd(6)} ${kind.padEnd(4)} ${list.length} mistakes by ${profile.name}: ` +
          `cost ${least.toFixed(2)} to ${Math.max(...list).toFixed(2)} s, ` +
          `average ${(list.reduce((a, b) => a + b, 0) / Math.max(1, list.length)).toFixed(2)} s`,
      );
    }
    console.log(
      `roster-check:      ${course.id.padEnd(6)} clean lap ${clean.toFixed(3)} s, ${crashes} crashes in ${times.length} laps`,
    );
  }
} else if (args.includes('--mistakes')) {
  const laps = Number(args[args.indexOf('--mistakes') + 1]) || 500;
  // The shortest circuit: a mistake is one corner or jump of a lap wherever the lap is.
  const course = COURSES.find(c => c.id === 'coast')!;
  const only = args.includes('--rider') ? Number(args[args.indexOf('--rider') + 1]) : -1;
  for (const [index, profile] of ROSTER.entries()) {
    if (only >= 0 && index !== only) continue;
    const track = new Track(course);
    const r = Object.assign(makeRider(track, 0, false, profile.plate), {profile, name: profile.name});
    let seconds = 0;
    for (; r.progress.lap < laps && seconds < laps * 400; seconds += STEP)
      stepRider(r, npcControl(r, track, [r], 'club', 20261127), track, STEP, [r]);
    const made = (r.slips ?? 0) / r.progress.lap;
    const rated = mistakeRate(profile);
    const off = (made / rated - 1) * 100;
    const ok = r.progress.lap >= laps && Math.abs(off) <= 20;
    if (!ok) problems.push(`${profile.name}: ${made.toFixed(4)} mistakes a lap against ${rated.toFixed(4)}`);
    console.log(
      `roster-check: ${ok ? 'ok  ' : 'FAIL'} #${profile.number} ${profile.name.padEnd(10)} consistency ${profile.consistency}: ` +
        `${r.slips ?? 0} mistakes in ${r.progress.lap} laps, ${made.toFixed(4)} a lap against ${rated.toFixed(4)} rated ` +
        `(${off >= 0 ? '+' : ''}${off.toFixed(1)}%), ${r.crashes} crashes, average lap ${(seconds / r.progress.lap).toFixed(2)} s`,
    );
  }
} else {
  // C2 to C4: 50 seeded races, 8 riders, 3 laps, Dusk Valley, Club.
  const dusk = COURSES.find(c => c.id === 'dusk')!;
  const RACES = 50;
  const wins: Record<string, number> = {};
  let inRange = 0,
    dnfs = 0,
    longestStop = 0,
    crashes = 0,
    slips = 0,
    smallest = Infinity,
    largest = 0;
  for (let seed = 1; seed <= RACES; seed++) {
    const race = rosterRace(dusk, 'club', 8, seed);
    if (race.order.length) wins[race.order[0].name] = (wins[race.order[0].name] ?? 0) + 1;
    if (race.gap >= 5 && race.gap <= 25) inRange++;
    smallest = Math.min(smallest, race.gap);
    largest = Math.max(largest, race.gap);
    dnfs += race.dnfs;
    crashes += race.crashes;
    slips += race.slips;
    longestStop = Math.max(longestStop, race.longestStop);
  }
  const winners = Object.entries(wins).sort((a, b) => b[1] - a[1]);
  console.log(
    `roster-check: ${RACES} Club races of 8 on Dusk Valley: first to last ${smallest.toFixed(1)} to ${largest.toFixed(1)} s, ` +
      `${inRange} of ${RACES} between 5 and 25 s`,
  );
  console.log(`roster-check: ${winners.length} different winners: ${winners.map(([n, w]) => `${n} ${w}`).join(', ')}`);
  console.log(
    `roster-check: ${dnfs} riders did not finish, longest stop ${longestStop.toFixed(2)} s, ` +
      `${crashes} crashes and ${slips} mistakes in all`,
  );
  if (inRange < 45) problems.push(`only ${inRange} of ${RACES} races had 5 to 25 s from first to last`);
  if (winners.length < 4) problems.push(`only ${winners.length} different winners`);
  if (dnfs) problems.push(`${dnfs} riders did not finish`);
  if (longestStop > 5) problems.push(`a rider stood still for ${longestStop.toFixed(2)} s`);

  // C8 and the baselines: one fixed race for every circuit and pace setting.
  const club: {course: string; winner: number}[] = JSON.parse(
    readFileSync(new URL('../baselines/pace.json', import.meta.url), 'utf8'),
  ).races.filter((r: {difficulty: string}) => r.difficulty === 'club');
  const SEED = 2026;
  const races = [];
  for (const difficulty of ['relaxed', 'club', 'expert'])
    for (const course of COURSES) {
      const race = rosterRace(course, difficulty, 8, SEED);
      races.push({
        course: course.id,
        difficulty,
        winner: race.order[0]?.time ?? 0,
        last: race.order.at(-1)?.time ?? 0,
        order: race.order.map(o => o.name),
        crashes: race.crashes,
      });
      if (race.dnfs) problems.push(`${course.id} ${difficulty}: ${race.dnfs} riders did not finish`);
      if (difficulty !== 'club') continue;
      const before = club.find(c => c.course === course.id)!.winner;
      const diff = (race.order[0].time / before - 1) * 100;
      const ok = Math.abs(diff) <= 3;
      if (!ok) problems.push(`${course.id}: fastest Club rider ${diff.toFixed(2)}% from the M1.2 Club time`);
      console.log(
        `roster-check: ${ok ? 'ok  ' : 'FAIL'} ${course.id.padEnd(6)} fastest Club rider ${race.order[0].name} ` +
          `${race.order[0].time} s against ${before} s at M1.2 (${diff >= 0 ? '+' : ''}${diff.toFixed(2)}%)`,
      );
    }
  if (args.includes('--write')) {
    const note =
      'Roster races as the game runs them: 8 named riders, gate start, seed 2026, 3 laps, 120 Hz, physics version 5. ' +
      'Regenerate only with sign-off. pace.json (riders without ratings) is unchanged and still checked.';
    writeFileSync(file, JSON.stringify({note, seed: SEED, races}, null, 2) + '\n');
    console.log('Wrote baselines/roster.json');
  } else {
    let recorded: typeof races = [];
    try {
      recorded = JSON.parse(readFileSync(file, 'utf8')).races;
    } catch {
      problems.push('baselines/roster.json is missing');
    }
    const same = recorded.length === races.length && JSON.stringify(recorded) === JSON.stringify(races);
    for (const [i, b] of recorded.entries())
      if (JSON.stringify(b) !== JSON.stringify(races[i]))
        problems.push(
          `${b.course} ${b.difficulty}: winner ${races[i]?.winner} s, last ${races[i]?.last} s; baseline ${b.winner} s, ${b.last} s`,
        );
    console.log(
      `roster-check: ${races.length} baseline races ${same ? 'match' : 'DO NOT match'} baselines/roster.json exactly`,
    );
  }
}
console.log(
  problems.length
    ? `roster-check: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`
    : 'roster-check: all clear',
);
if (problems.length && check) process.exit(1);
