// Runs the production build and measures it. Writes baselines/build.json with --write.
// It reports sizes only; size budgets that fail CI arrive in M0.4.
//   node scripts/build-report.mjs            build, then print the sizes
//   node scripts/build-report.mjs --write    build, then record them as the baseline
// JavaScript sizes are the ones Vite's own build report prints (KB = 1000 bytes), so they
// match the numbers in the build log. dist/ and art totals are measured from disk.
import {execFileSync} from 'node:child_process';
import {readdirSync,statSync,writeFileSync} from 'node:fs';
import {join,relative} from 'node:path';

const log=execFileSync(process.execPath,[new URL('../node_modules/vite/bin/vite.js',import.meta.url).pathname,'build'],{encoding:'utf8',env:{...process.env,NO_COLOR:'1'}});
const js=[...log.matchAll(/dist\/(\S+\.js)\s+([\d.,]+) kB\s+│ gzip:\s+([\d.,]+) kB/g)]
  .map(m=>({file:m[1],kb:Number(m[2].replace(',','')),gzipKb:Number(m[3].replace(',',''))}));
if(!js.length){console.error('Could not read JavaScript sizes from the Vite build log:\n'+log);process.exit(1);}

const dist=new URL('../dist/',import.meta.url).pathname;
const files=[];
(function walk(dir){for(const name of readdirSync(dir)){const p=join(dir,name);statSync(p).isDirectory()?walk(p):files.push(p);}})(dist);

const total=files.reduce((n,f)=>n+statSync(f).size,0);
const art=files.filter(f=>relative(dist,f).startsWith('art/')).reduce((n,f)=>n+statSync(f).size,0);
const report={
  javascriptKb:Math.round(js.reduce((n,f)=>n+f.kb,0)*100)/100,
  javascriptGzipKb:Math.round(js.reduce((n,f)=>n+f.gzipKb,0)*100)/100,
  javascriptFiles:js,
  artMb:Math.round(art/1e4)/100,
  distMb:Math.round(total/1e4)/100,
  distBytes:total,
};
if(process.argv.includes('--write')){
  const commit=execFileSync('git',['rev-parse','--short=7','HEAD'],{encoding:'utf8'}).trim();
  writeFileSync(new URL('../baselines/build.json',import.meta.url),JSON.stringify({note:`Production build sizes at commit ${commit}. Later size budgets are judged against this. Regenerate only with sign-off.`,...report,commit},null,2)+'\n');
  console.log('Wrote baselines/build.json');
}
console.log(JSON.stringify(report,null,2));
