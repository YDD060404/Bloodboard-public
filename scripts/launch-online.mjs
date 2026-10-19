import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../lan/server.mjs';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = [join(root,'dist/web'),join(root,'web')].find(p=>existsSync(join(p,'index.html')));
if (!web) throw new Error('Build first: npm run build');
const srv = await createServer({ webDir:web, journalDir:join(root,'lan/rooms'), host:'127.0.0.1' });
let port;
try { port=await srv.listen(8790,'127.0.0.1'); }
catch(e) { if(e.code!=='EADDRINUSE')throw e; port=await srv.listen(0,'127.0.0.1'); }
const url='http://127.0.0.1:'+port+'/';
mkdirSync(join(root,'lan/rooms'),{recursive:true});
writeFileSync(join(root,'lan/rooms/preview-status.json'),JSON.stringify({application:'Broadboard Online',version:srv.room.fingerprint.version,url,pid:process.pid},null,2)+'\n');
console.log('Broadboard Online local preview\n'+url+'\nPrivate local room code: '+srv.code+'\nLeave this Terminal open. Ctrl-C stops the preview; old journals are kept in lan/rooms.\nThis preview does not replace the deployed Bloodboard website.');
if(process.platform==='darwin'&&!process.argv.includes('--no-open'))execFileSync('/usr/bin/open',[url]);
const stop=()=>void srv.close().then(()=>process.exit(0));process.on('SIGINT',stop);process.on('SIGTERM',stop);
