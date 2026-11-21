// Runs the production build and measures it. Writes baselines/build.json with --write.
//   node scripts/build-report.mjs            build, then print the sizes
//   node scripts/build-report.mjs --check    build, print the sizes, and fail if a budget below is broken
//   node scripts/build-report.mjs --write    build, then record them as the baseline
// JavaScript sizes are the ones Vite's own build report prints (KB = 1000 bytes), so they
// match the numbers in the build log. dist/ and art totals are measured from disk.
import {execFileSync} from 'node:child_process';
import {readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {join, relative} from 'node:path';

const log = execFileSync(
  process.execPath,
  [new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname, 'build'],
  {encoding: 'utf8', env: {...process.env, NO_COLOR: '1'}},
);
const js = [...log.matchAll(/dist\/(\S+\.js)\s+([\d.,]+) kB\s+│ gzip:\s+([\d.,]+) kB/g)].map(m => ({
  file: m[1],
  kb: Number(m[2].replace(',', '')),
  gzipKb: Number(m[3].replace(',', '')),
}));
if (!js.length) {
  console.error('Could not read JavaScript sizes from the Vite build log:\n' + log);
  process.exit(1);
}

const dist = new URL('../dist/', import.meta.url).pathname;
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    statSync(p).isDirectory() ? walk(p) : files.push(p);
  }
})(dist);

const total = files.reduce((n, f) => n + statSync(f).size, 0);
const art = files.filter(f => relative(dist, f).startsWith('art/')).reduce((n, f) => n + statSync(f).size, 0);
// JavaScript the page needs before the setup screen can show: every script index.html names, plus what those
// import directly. Files fetched later (the track editor) are left out.
const named = new Set();
const follow = file => {
  if (named.has(file)) return;
  named.add(file);
  const code = readFileSync(join(dist, 'assets', file), 'utf8');
  for (const m of code.matchAll(/(?:from|import)\s*["']\.\/([\w.-]+\.js)["']/g)) follow(m[1]);
};
const page = readFileSync(join(dist, 'index.html'), 'utf8');
for (const m of page.matchAll(/(?:src|href)="[^"]*assets\/([\w.-]+\.js)"/g)) follow(m[1]);
const startup = js.filter(f => named.has(f.file.replace('assets/', '')));

const report = {
  startupJavascriptGzipKb: Math.round(startup.reduce((n, f) => n + f.gzipKb, 0) * 100) / 100,
  startupJavascriptFiles: startup.map(f => f.file),
  javascriptKb: Math.round(js.reduce((n, f) => n + f.kb, 0) * 100) / 100,
  javascriptGzipKb: Math.round(js.reduce((n, f) => n + f.gzipKb, 0) * 100) / 100,
  javascriptFiles: js,
  artMb: Math.round(art / 1e4) / 100,
  distMb: Math.round(total / 1e4) / 100,
  distBytes: total,
};
if (process.argv.includes('--write')) {
  const commit = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {encoding: 'utf8'}).trim();
  writeFileSync(
    new URL('../baselines/build.json', import.meta.url),
    JSON.stringify(
      {
        note: `Production build sizes at commit ${commit}. Later size budgets are judged against this. Regenerate only with sign-off.`,
        ...report,
        commit,
      },
      null,
      2,
    ) + '\n',
  );
  console.log('Wrote baselines/build.json');
}
console.log(JSON.stringify(report, null, 2));

if (process.argv.includes('--check')) {
  // Budgets from build plan v2 (M0.4). The JavaScript budget holds for the rest of the project.
  const src = new URL('../src/', import.meta.url).pathname;
  const sources = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      statSync(p).isDirectory() ? walk(p) : sources.push(p);
    }
  })(src);
  const mentions = pattern =>
    sources.filter(f => pattern.test(readFileSync(f, 'utf8'))).map(f => relative(join(src, '..'), f));
  const absoluteArt = mentions(/["'`]\/art\//);
  const pngInSource = mentions(/\.png\b/);
  const pngShipped = files.filter(f => f.endsWith('.png')).map(f => relative(dist, f));
  const budgets = [
    ['Shipped art is 2.0 MB or less', report.artMb <= 2.0, `${report.artMb} MB`],
    ['dist is 4.0 MB or less', report.distMb <= 4.0, `${report.distMb} MB`],
    [
      'JavaScript to reach the setup screen is 260 KB gzipped or less',
      startup.length > 0 && report.startupJavascriptGzipKb <= 260,
      `${report.startupJavascriptGzipKb} KB in ${startup.length} files`,
    ],
    ['No absolute /art/ path in src', !absoluteArt.length, absoluteArt.join(', ') || 'none'],
    ['No .png named in src', !pngInSource.length, pngInSource.join(', ') || 'none'],
    ['No .png in the build', !pngShipped.length, pngShipped.join(', ') || 'none'],
    [
      'The track editor is not part of the startup JavaScript',
      js.some(f => /track-editor/.test(f.file)) && !startup.some(f => /track-editor/.test(f.file)),
      js
        .filter(f => /track-editor/.test(f.file))
        .map(f => f.file)
        .join(', ') || 'no separate editor file',
    ],
  ];
  for (const [name, ok, measured] of budgets) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${measured}`);
  if (budgets.some(([, ok]) => !ok)) process.exit(1);
}
