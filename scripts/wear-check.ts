// Wear check: 5-lap races of eight computer riders on every circuit with wear physics on.
// Nobody may fail to finish, and the field's fifth lap must be within 3% of its first flying lap (lap 2:
// lap 1 has the standing start in it, and is printed too).
//   npx tsx scripts/wear-check.ts            one race on each circuit, the pace setting changing from one to the next
//   npx tsx scripts/wear-check.ts --all      every circuit at every pace setting (15 races)
//   npx tsx scripts/wear-check.ts --check    also fail if a target is missed (CI)
//   npx tsx scripts/wear-check.ts --off      the same races with wear physics off, to compare
import {npcControl} from '../src/physics';
import {surfaceFor} from '../src/surface-wear';
import {Track} from '../src/track';
import {RaceSession} from '../src/game/race-session';
import {COURSES, STEP} from './sim';

const args = process.argv.slice(2);
const LAPS = 5;
const LEVELS = ['club', 'expert', 'relaxed'];
const quiet = {countdown() {}, racing() {}, cue() {}, landing() {}, pause() {}, results() {}};
const only = args.includes('--course') ? args[args.indexOf('--course') + 1] : '';
let bad = 0;
for (const [at, course] of COURSES.entries()) {
  if (only && course.id !== only) continue;
  for (const [n, difficulty] of LEVELS.entries()) {
    if (!args.includes('--all') && n !== at % LEVELS.length) continue;
    const track = new Track(course);
    const seed = 40 + n;
    const session: RaceSession = new RaceSession(
      {sample: () => npcControl(session.riders[0], track, [], difficulty), connectedGamepads: () => []},
      quiet,
    );
    session.grid({track, npcCount: 8, humanCount: 0, practice: false, assignments: [], difficulty, seed});
    session.start({lapCount: LAPS, difficulty, seed, wearPhysics: !args.includes('--off')});
    for (let i = 0; session.phase !== 'results' && i < 120 * 900; i++) session.step(STEP);
    const dnf = session.riders.filter(r => r.dnf || r.finished === null).length;
    const crashes = session.riders.reduce((k, r) => k + r.crashes, 0);
    // The field's lap: the mean over the riders who did all five. Lap 1 has the standing start in it.
    const full = session.timing.filter(t => t.laps.length >= LAPS);
    const mean = (lap: number) => full.reduce((a, t) => a + t.laps[lap].time, 0) / Math.max(1, full.length);
    const laps = Array.from({length: LAPS}, (_, lap) => mean(lap));
    const change = (laps[4] / laps[0] - 1) * 100,
      flying = (laps[4] / laps[1] - 1) * 100;
    const signed = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
    const surface = surfaceFor(track);
    let ruts = 0,
      bumps = 0,
      points = 0;
    for (let s = 0; s < track.length; s += 2)
      for (let l = -track.halfWidth; l <= track.halfWidth; l += 0.4) {
        ruts = Math.max(ruts, surface.rut(s, l));
        bumps = Math.max(bumps, surface.rough(s, l));
        points++;
      }
    const ok = dnf === 0 && Math.abs(flying) <= 3;
    if (!ok) bad++;
    console.log(
      `wear-check: ${ok ? 'ok  ' : 'FAIL'} ${course.id.padEnd(7)} ${difficulty.padEnd(7)} ${dnf} DNF, ${crashes} crashes, laps ` +
        laps.map(t => t.toFixed(2)).join(' ') +
        `, lap 5 ${signed(flying)} on lap 2 and ${signed(change)} on lap 1, deepest rut ${ruts.toFixed(2)}, roughest bumps ${bumps.toFixed(2)}`,
    );
  }
}
console.log(bad ? `wear-check: ${bad} race(s) missed a target` : 'wear-check: all clear');
if (args.includes('--check') && bad) process.exit(1);
