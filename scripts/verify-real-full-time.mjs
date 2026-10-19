import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createServer } from '../lan/server.mjs';
import { memoryStore } from '../lan/store.mjs';
import { E, CLIENT, makeMatch, aiIntent } from '../lan/test/helpers.mjs';
const store=memoryStore(),srv=await createServer({engine:E,code:'REALFINISH22',store,seed:()=>812});
const port=await srv.listen(),url=`http://127.0.0.1:${port}`;
const post=async(path,body)=>{const r=await fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json();assert.equal(r.status,200,j.message);return j;};
try{
 const a=(await post('/api/join',{code:'REALFINISH22',seat:'A',client:CLIENT})).token,b=(await post('/api/join',{code:'REALFINISH22',seat:'B',client:CLIENT})).token;
 await post('/api/start',{token:a,state:makeMatch()});let commands=0;
 while(srv.room.state.phase!=='fullTime'){
  assert.ok(commands<1000,'game must reach full time');const state=srv.room.state,seat=E.waitingFor(state)??'A';
  const intent=!state.pending&&state.phase==='play'?{kind:'action',input:{kind:'endTurn'}}:aiIntent(state,seat);
  assert.ok(intent,'legal setup/phase command available');await post('/api/command',{token:seat==='B'?b:a,commandId:`real-finish-${commands++}`,baseRev:srv.room.rev,...intent});
 }
 const ended=srv.room.completedAt,old=store.load();assert.equal(srv.reopenAt,ended+60000);
 const response=await fetch(url+'/api/history?token='+encodeURIComponent(a));assert.equal(response.status,200);const history=await response.text();assert.ok(history.length>100);
 while(Date.now()<ended+59000)await new Promise(r=>setTimeout(r,500));
 assert.equal(store.archives.length,0);assert.equal(srv.room.seatOf(a),'A');assert.equal(srv.room.seatOf(b),'B');
 const until=ended+65000;while(!store.archives.length&&Date.now()<until)await new Promise(r=>setTimeout(r,100));
 assert.equal(store.archives.length,1);assert.deepEqual(store.archives[0],old);assert.equal(srv.room.started,false);assert.equal(srv.room.seats.A,null);assert.equal(srv.room.seats.B,null);
 const elapsed=Date.now()-ended;assert.ok(elapsed>=60000&&elapsed<65000);
 const report={version:E.BUILD_FINGERPRINT.version,realEngine:true,terminalTransitionMocked:false,clockMocked:false,graceMs:60000,observedCloseMs:elapsed,commands,archivedRecords:old.length,historyDownloadBeforeClose:true,oldJournalPreserved:true,seatsReleased:true,scope:'Real Sevens game with end-turn-only play over actual HTTP, local server; no production room touched.'};
 writeFileSync(new URL('../verification/real-full-time-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await srv.close();}
