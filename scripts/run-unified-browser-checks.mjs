// Run existing focused browser checks serially on the final built assets.
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
const waitPid=Number(process.argv[2]||0);
if(waitPid)while(true){try{process.kill(waitPid,0);}catch{break;}await delay(10000);}
const scripts=['repairs','online','auto-close','language','orientation','sideline','operations','keyboard','published-ai'];
const records=[];
for(const name of scripts){
 const t=Date.now();const r=spawnSync(process.execPath,['scripts/ui-flow-'+name+'.mjs'],{encoding:'utf8',maxBuffer:8*1024*1024,timeout:360000});
 writeFileSync('verification/browser-'+name+'.log',(r.stdout||'')+(r.stderr||''));
 const row={name,exitCode:r.status,error:r.error?.message??null,elapsedMs:Date.now()-t};records.push(row);
 writeFileSync('verification/browser-suite.json',JSON.stringify({version:JSON.parse(readFileSync('package.json')).version,records},null,2)+'\n');
 console.log(JSON.stringify(row));if(r.status!==0)process.exit(1);
}
