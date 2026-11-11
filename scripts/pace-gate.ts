// Pace gate: runs the ten baseline AI races (5 circuits x club/expert) and compares them
// with baselines/pace.json.
//   npx tsx scripts/pace-gate.ts [--tolerance <percent>] [--write]
// --tolerance defaults to 0 (exact match). --write regenerates the baseline file.
import {readFileSync,writeFileSync} from 'node:fs';
import {aiRace,COURSES,type RaceResult} from './sim';

const args=process.argv.slice(2);
const tolArg=args.indexOf('--tolerance');
const tolerance=tolArg>=0?Number(args[tolArg+1]):0;
if(!Number.isFinite(tolerance)||tolerance<0){console.error('--tolerance must be a non-negative percent');process.exit(2);}
const file=new URL('../baselines/pace.json',import.meta.url);

const results:RaceResult[]=[];
for(const difficulty of ['club','expert'])for(const course of COURSES)results.push(aiRace(course,difficulty));

if(args.includes('--write')){
  writeFileSync(file,JSON.stringify({note:'AI race winner times, 3 laps, 4 NPC riders, 120 Hz. Regenerate only with sign-off.',races:results},null,2)+'\n');
  console.table(results);console.log('Wrote baselines/pace.json');process.exit(0);
}

const baseline:RaceResult[]=JSON.parse(readFileSync(file,'utf8')).races;
let failed=0;const rows=[];
for(const b of baseline){
  const r=results.find(x=>x.course===b.course&&x.difficulty===b.difficulty);
  if(!r){failed++;rows.push({...b,status:'MISSING'});continue;}
  const diffPct=(r.winner/b.winner-1)*100;
  const ok=Math.abs(diffPct)<=tolerance+1e-9&&r.crashes===0&&r.recoveries===0&&r.finishers===b.finishers;
  if(!ok)failed++;
  rows.push({course:b.course,difficulty:b.difficulty,baseline:b.winner,now:r.winner,diffPct:diffPct.toFixed(3),
    crashes:r.crashes,recoveries:r.recoveries,status:ok?'ok':'FAIL'});
}
if(baseline.length!==results.length){failed++;console.error(`pace-gate: baseline has ${baseline.length} races, expected ${results.length}`);}
console.table(rows);
console.log(`pace-gate: ${rows.length-failed}/${rows.length} races within ${tolerance}% with 0 crashes and 0 recoveries`);
process.exit(failed?1:0);
