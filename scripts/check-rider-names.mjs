// Fails if the game could show a computer rider as "RIDER 3" again. Every computer rider has a name and a
// number from src/riders.ts, so nothing in src/ or index.html may build a name out of the word RIDER and a number.
//   node scripts/check-rider-names.mjs
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';

const root = new URL('../', import.meta.url).pathname;
// "RIDER 3", "RIDER ${id + 1}", "RIDER-3", 'RIDER ' + n, and the same in lower or mixed case.
const NAME = /\bRIDER[\s#-]*(\d|\$\{)|\bRIDER[\s#-]*['"`]\s*\+/i;
const offenders = [];
let files = 0;
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(ts|html|css)$/.test(name)) check(path);
  }
})(join(root, 'src'));
check(join(root, 'index.html'));
function check(path) {
  files++;
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      // The 3D model's scene-graph label ("Motocross rider 3") is never shown to a player.
      if (NAME.test(line) && !line.includes('root.name ='))
        offenders.push(`${path.slice(root.length)}:${i + 1}: ${line.trim()}`);
    });
}
if (offenders.length) {
  console.error(
    `rider-names: ${offenders.length} place(s) could show a rider as RIDER plus a number\n  ${offenders.join('\n  ')}`,
  );
  process.exit(1);
}
console.log(`rider-names: no RIDER-plus-number text in ${files} files`);
