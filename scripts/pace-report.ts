import {Track} from '../src/track';
import {COURSES} from '../src/courses';
import {makeRider, stepRider, npcControl, collide} from '../src/physics';
const all = process.argv.includes('--all');
const reports = [];
for (const course of all ? COURSES : [COURSES[0]])
  for (const difficulty of ['relaxed', 'standard', 'expert']) {
    const track = new Track(course),
      riders = Array.from({length: 4}, (_, id) => makeRider(track, id, false, 0xffffff));
    let launches = 0,
      landings = 0,
      rough = 0,
      recoveries = 0,
      frames = 0,
      speed = 0,
      maxSpeed = 0,
      impactSum = 0;
    const times = new Map<number, number>();
    for (; frames < 120 * 650 && times.size < 4; frames++) {
      for (const r of riders) {
        const before = r.grounded,
          rec = r.recovery;
        stepRider(r, npcControl(r, track, riders, difficulty), track, 1 / 120, riders);
        if (before && !r.grounded) launches++;
        if (r.lastLanding > 0) {
          landings++;
          impactSum += r.lastLanding;
          if (r.lastLanding > 12) rough++;
        }
        if (!rec && r.recovery > 0) recoveries++;
        speed += r.speed;
        maxSpeed = Math.max(maxSpeed, r.speed);
        if (r.progress.lap >= 3 && !times.has(r.id)) times.set(r.id, (frames + 1) / 120);
      }
      collide(riders, track);
    }
    reports.push({
      course: course.id,
      difficulty,
      jumps: track.jumps.length,
      maxJump: Math.max(...track.jumps.map(j => j.height)),
      finishTimes: [...times.values()],
      meanKmh: (speed / (frames * 4)) * 3.6,
      maxKmh: maxSpeed * 3.6,
      launches,
      landings,
      rough,
      meanImpact: impactSum / landings,
      recoveries,
      crashes: riders.reduce((n, r) => n + ((r as any).crashes || 0), 0),
    });
  }
console.log(JSON.stringify(reports, null, 2));
