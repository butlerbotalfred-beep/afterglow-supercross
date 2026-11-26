// Fails if sound code could change a level in one step, which is heard as a click.
// Every level change must go through ramp() or a Glide in src/audio/ramp.ts, and sound nodes may only be made
// inside src/audio/.
//   node scripts/check-audio-ramps.mjs
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';

const root = new URL('../src/', import.meta.url).pathname;
const SCHEDULING =
  /\b(setValueAtTime|setTargetAtTime|linearRampToValueAtTime|exponentialRampToValueAtTime|setValueCurveAtTime|cancelScheduledValues|cancelAndHoldAtTime)\b/;
const DIRECT = /\.value\s*([-+*/]|\?\?|\|\||&&)?=(?!=)|\[\s*['"`]value['"`]\s*\]|\{\s*value\b/;
const NODES =
  /\bnew\s+(webkit)?(Offline)?AudioContext\b|\bnew\s+\w+Node\b|\bcreate(Gain|Oscillator|BufferSource|StereoPanner|Panner|BiquadFilter|ConstantSource|DynamicsCompressor|WaveShaper|Delay|Convolver)\b/;
// Outside src/audio/ the sound graph may not be reached into at all.
const REACH = /\baudio\.context\b/;
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
        if (REACH.test(code)) offenders.push(`${at} reaches into the sound graph from outside src/audio/`);
        return;
      }
      // preset() is for nodes that are not wired in yet. One-step sets on live nodes are caught by the test
      // "no level is ever set in one step on a node that is wired in", which runs a race against stand-in hardware.
      if (/\bnew\s+\w+Node\b/.test(code))
        offenders.push(`${at} makes a node with new; use the context's create method`);
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
