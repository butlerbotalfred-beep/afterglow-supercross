// Brings this Mac's copy of the game up to date with main and restarts the login service.
// Run it after every merge:   npm run mac:update
// It stops without changing anything if this copy has uncommitted edits or is not on main.
import {execFileSync, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();
const step = (label, command, args) => {
  console.log(`\n${label}`);
  const result = spawnSync(command, args, {cwd: root, stdio: 'inherit'});
  if (result.status !== 0) {
    console.error(`mac:update stopped: "${[command, ...args].join(' ')}" failed.`);
    process.exit(result.status || 1);
  }
};

const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (branch !== 'main') {
  console.error(`mac:update stopped: this copy is on "${branch}", not main. Switch with: git checkout main`);
  process.exit(1);
}
const edits = git('status', '--porcelain', '--untracked-files=no');
if (edits) {
  console.error('mac:update stopped: this copy has uncommitted edits, which an update could overwrite:\n' + edits);
  process.exit(1);
}
const before = git('rev-parse', '--short=7', 'HEAD');
step('1/3 Getting the latest main', 'git', ['pull', '--ff-only', 'origin', 'main']);
step('2/3 Installing packages', 'npm', ['ci']);
if (process.platform === 'darwin')
  step('3/3 Restarting the game service', process.execPath, ['scripts/server-service.mjs', 'restart']);
else console.log('\n3/3 Not a Mac, so there is no service to restart.');
const after = git('rev-parse', '--short=7', 'HEAD');
console.log(
  `\nDone. ${before === after ? `Already up to date at ${after}` : `Updated ${before} to ${after}`}.` +
    `\nThe setup screen here and on the hosted link should both show BUILD ${after}.`,
);
