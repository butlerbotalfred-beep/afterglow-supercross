// Fails if sound code could change a level in one step, which is heard as a click.
// Every level change must go through ramp() or a Glide in src/audio/ramp.ts, and sound nodes may only be made
// inside src/audio/.
//   node scripts/check-audio-ramps.mjs
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';

const root = new URL('../src/', import.meta.url).pathname;
const SCHEDULING =
  /\b(setValueAtTime|setTargetAtTime|linearRampToValueAtTime|exponentialRampToValueAtTime|setValueCurveAtTime)\b/;
const DIRECT = /\.value\s*[-+*/]?=(?!=)/;
const NODES = /\bnew\s+(webkit)?AudioContext\b|\bcreate(Gain|Oscillator|BufferSource|StereoPanner|BiquadFilter)\b/;
const offenders = [];
let audioFiles = 0;
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      walk(path);
      continue;
    }
    if (!name.endsWith('.ts')) continue;
    const file = path.slice(root.length),
      inAudio = file.startsWith('audio/'),
      lines = readFileSync(path, 'utf8').split('\n');
    if (inAudio) audioFiles++;
    let helper = '';
    lines.forEach((line, n) => {
      const code = line.replace(/\/\/.*$/, '');
      const at = `${file}:${n + 1}`;
      if (!inAudio) {
        if (NODES.test(code)) offenders.push(`${at} makes a sound node outside src/audio/`);
        return;
      }
      if (file !== 'audio/ramp.ts') {
        if (SCHEDULING.test(code)) offenders.push(`${at} schedules a value directly; use ramp() or a Glide`);
        if (DIRECT.test(code)) offenders.push(`${at} sets .value directly; use preset() before connecting, or ramp()`);
        return;
      }
      // Inside ramp.ts, a one-step set is allowed only in preset(), and only setTargetAtTime may be scheduled.
      const started = /^export (?:function|class) (\w+)/.exec(code);
      if (started) helper = started[1];
      if (DIRECT.test(code) && helper !== 'preset') offenders.push(`${at} sets .value outside preset()`);
      if (SCHEDULING.test(code) && !/\bsetTargetAtTime\b/.test(code))
        offenders.push(`${at} uses a scheduling call other than setTargetAtTime`);
    });
  }
})(root);
if (!audioFiles) offenders.push('src/audio/ has no files to check');
if (offenders.length) {
  console.error(`audio-ramps: ${offenders.length} problem(s):\n` + offenders.join('\n'));
  process.exit(1);
}
console.log(`audio-ramps: every level change in ${audioFiles} sound files is ramped`);
