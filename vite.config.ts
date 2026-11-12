import {execSync} from 'node:child_process';
import {defineConfig} from 'vite';
import {macControllerPlugin} from './scripts/controller-plugin.ts';

// Short commit hash shown on the setup screen so it is always clear which build is running.
function buildStamp():string {
  const fromEnv=process.env.VERCEL_GIT_COMMIT_SHA;
  if(fromEnv)return fromEnv.slice(0,7);
  try {
    const hash=execSync('git rev-parse --short=7 HEAD',{stdio:['ignore','pipe','ignore']}).toString().trim();
    const dirty=execSync('git status --porcelain --untracked-files=no',{stdio:['ignore','pipe','ignore']}).toString().trim();
    return dirty?`${hash}+`:hash;
  } catch {return 'dev';}
}

export default defineConfig({plugins:[macControllerPlugin()],define:{__BUILD_STAMP__:JSON.stringify(buildStamp())}});
