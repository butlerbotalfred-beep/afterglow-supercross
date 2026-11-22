// Brings this Mac's copy of the game up to date with main and restarts the login service.
// Run it after every merge:   npm run mac:update
// It stops without changing anything if this copy has uncommitted edits or is not on main.
import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
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
const ahead = git('rev-list', '--count', 'origin/main..HEAD');
if (ahead !== '0')
  console.log(
    `Note: this copy has ${ahead} commit(s) that are not on GitHub, so its build stamp will not match the hosted link.`,
  );
// Packages are reinstalled only when the lock file changed (or nothing is installed yet): npm ci removes
// node_modules first, which takes the running game down until it finishes.
const lockChanged = git('diff', '--name-only', before, 'HEAD', '--', 'package-lock.json') !== '';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
// Also reinstall when what is installed does not match the lock file, as happens when someone ran git pull
// by hand before this command (first seen on the Mac Studio, 22 November 2026).
const installedMatches = () =>
  spawnSync(npm, ['ls', '--depth=0'], {cwd: root, stdio: 'ignore', shell: process.platform === 'win32'}).status === 0;
if (lockChanged || !existsSync(join(root, 'node_modules')) || !installedMatches()) {
  console.log('\n2/3 Installing packages');
  const install = spawnSync(npm, ['ci'], {cwd: root, stdio: 'inherit', shell: process.platform === 'win32'});
  if (install.status !== 0) {
    console.error(
      'mac:update stopped: installing packages failed, and the game will not run until it succeeds.\n' +
        'Check the network and run it again:  npm ci && npm run server:restart',
    );
    process.exit(install.status || 1);
  }
} else console.log('\n2/3 Packages already match, nothing to install.');
if (process.platform === 'darwin') {
  console.log('\n3/3 Restarting the game service');
  const restart = spawnSync(process.execPath, ['scripts/server-service.mjs', 'restart'], {cwd: root, stdio: 'pipe'});
  if (restart.status !== 0) {
    console.error(
      'mac:update stopped: the game service could not be restarted. If it was never installed, run:\n' +
        '  npm run server:install',
    );
    process.exit(restart.status || 1);
  }
  console.log('Service restarted.');
} else console.log('\n3/3 Not a Mac, so there is no service to restart.');
const after = git('rev-parse', '--short=7', 'HEAD');
console.log(
  `\nDone. ${before === after ? `Already up to date at ${after}` : `Updated ${before} to ${after}`}.` +
    `\nThe setup screen here and on the hosted link should both show BUILD ${after}.`,
);
