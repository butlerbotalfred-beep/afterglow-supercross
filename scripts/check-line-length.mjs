// Fails if any line in src/ is longer than the limit (default 140 characters).
//   node scripts/check-line-length.mjs [--max 140]
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';

const i = process.argv.indexOf('--max');
const max = i >= 0 ? Number(process.argv[i + 1]) : 140;
const root = new URL('../src/', import.meta.url).pathname;
const offenders = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p);
      continue;
    }
    if (!/\.(ts|css|mjs|js)$/.test(name)) continue;
    readFileSync(p, 'utf8')
      .split('\n')
      .forEach((line, n) => {
        if (line.length > max) offenders.push(`${p.slice(root.length)}:${n + 1} (${line.length})`);
      });
  }
})(root);
if (offenders.length) {
  console.error(`${offenders.length} line(s) in src/ exceed ${max} characters:\n` + offenders.slice(0, 50).join('\n'));
  process.exit(1);
}
console.log(`line-length: every line in src/ is ${max} characters or fewer`);
