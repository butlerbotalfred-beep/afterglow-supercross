import {homedir} from 'node:os';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const label='local.afterglow.supercross';
const domain=`gui/${process.getuid()}`;
const plist=resolve(homedir(),'Library/LaunchAgents',`${label}.plist`);
const logs=resolve(homedir(),'Library/Logs/Afterglow');
const run=(args)=>spawnSync('/bin/launchctl',args,{encoding:'utf8'});
const action=process.argv[2]||'status';
if(process.platform!=='darwin')throw new Error('This service installer is for macOS.');
if(action==='install'){
  mkdirSync(resolve(homedir(),'Library/LaunchAgents'),{recursive:true});mkdirSync(logs,{recursive:true});
  const xml=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const args=[process.execPath,resolve(root,'node_modules/vite/bin/vite.js'),'--host','0.0.0.0','--port','5173','--strictPort'];
  const body=`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${args.map(a=>`<string>${xml(a)}</string>`).join('')}</array><key>WorkingDirectory</key><string>${xml(root)}</string><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>5</integer><key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(resolve(process.execPath,'..'))}:/usr/bin:/bin:/usr/sbin:/sbin</string></dict><key>StandardOutPath</key><string>${xml(logs)}/server.log</string><key>StandardErrorPath</key><string>${xml(logs)}/server-error.log</string></dict></plist>\n`;
  if(existsSync(plist))run(['bootout',`${domain}/${label}`]);
  writeFileSync(plist,body);
  const result=run(['bootstrap',domain,plist]);
  if(result.status!==0)throw new Error(result.stderr||result.stdout);
  console.log(`Installed login service: ${plist}\nLogs: ${logs}`);
}else if(action==='stop'){
  const result=run(['bootout',`${domain}/${label}`]);console.log(result.stderr||'Service stopped. Run install to enable again.');
}else if(action==='restart'){
  const result=run(['kickstart','-k',`${domain}/${label}`]);if(result.status)throw new Error(result.stderr);console.log('Service restarted.');
}else if(action==='status'){
  const result=run(['print',`${domain}/${label}`]);console.log(result.stdout||result.stderr);process.exitCode=result.status||0;
}else throw new Error('Use install, status, restart or stop.');
