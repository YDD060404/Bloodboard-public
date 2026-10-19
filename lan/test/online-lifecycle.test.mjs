import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server.mjs';
import { Room } from '../room.mjs';
import { memoryStore, fileStore, sealedStore, upstashStore, deriveKey, storeFromEnv } from '../store.mjs';
import { fakeUpstash } from './fake-upstash.mjs';
import { E, CLIENT, makeMatch } from './helpers.mjs';
const CODE='ONLINE22';
async function boot(store=memoryStore()) {
  const srv=await createServer({engine:E,code:CODE,store,seed:()=>811,ratePerMinute:100000,joinsPerMinute:100000});
  const port=await srv.listen(0,'127.0.0.1');
  const post=async(path,body)=>{const r=await fetch('http://127.0.0.1:'+port+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,json:await r.json()};};
  const seat=async(s)=>{const r=await post('/api/join',{code:CODE,seat:s,name:s,client:CLIENT});assert.equal(r.status,200);return r.json.token;};
  return {srv,post,seat,store};
}
test('release is durable, token becomes invalid, another coach can take the lobby seat',async()=>{
 const s=await boot();try{
  const a=await s.seat('A'),b=await s.seat('B');
  assert.equal((await s.post('/api/leave',{token:'not-a-token'})).status,401);
  assert.equal((await s.post('/api/leave',{token:b})).status,200);
  assert.equal(s.srv.room.seatOf(b),null);
  const resumed=Room.resume({engine:E,code:CODE,lines:s.store.load()});assert.equal(resumed.seats.B,null);assert.equal(resumed.seatOf(a),'A');
  await s.seat('B');
 }finally{await s.srv.close();}
});
test('live seat cannot be surrendered silently; host abandonment archives every record and fresh seats survive restart',async()=>{
 const s=await boot();try{
  const a=await s.seat('A'),b=await s.seat('B');assert.equal((await s.post('/api/start',{token:a,state:makeMatch(17)})).status,200);
  assert.equal((await s.post('/api/leave',{token:b})).status,409);
  assert.equal((await s.post('/api/reset',{token:b,abandon:true})).status,403);
  assert.equal((await s.post('/api/reset',{token:a})).status,409);
  const before=s.store.load();assert.equal((await s.post('/api/reset',{token:a,abandon:true})).status,200);
  assert.deepEqual(s.store.archives[0],before);assert.equal(s.srv.room.started,false);assert.equal(s.srv.room.seats.A,null);assert.equal(s.srv.room.seats.B,null);
  const next=await s.seat('A');assert.equal(Room.resume({engine:E,code:CODE,lines:s.store.load()}).seatOf(next),'A');
 }finally{await s.srv.close();}
});
test('failed release and failed reset retain credentials, seats and the old journal',async()=>{
 const s=await boot();try{
  const a=await s.seat('A'),b=await s.seat('B');const before=s.store.load();s.store.failNext=1;
  assert.equal((await s.post('/api/leave',{token:b})).status,503);assert.equal(s.srv.room.seatOf(b),'B');assert.deepEqual(s.store.load(),before);
  s.store.failNext=1;assert.equal((await s.post('/api/reset',{token:a})).status,503);assert.deepEqual(s.store.load(),before);assert.equal(s.srv.room.seatOf(a),'A');
  assert.equal((await s.post('/api/reset',{token:a})).status,200);
 }finally{await s.srv.close();}
});
test('concurrent resets cannot reset a fresh room using an old host token',async()=>{
 const s=await boot();try{const a=await s.seat('A');const before=s.store.load();
 const rr=await Promise.all([s.post('/api/reset',{token:a}),s.post('/api/reset',{token:a})]);assert.deepEqual(rr.map(x=>x.status).sort(),[200,403]);assert.equal(s.store.archives.length,1);assert.deepEqual(s.store.archives[0],before);
 }finally{await s.srv.close();}
});
test('file journal replacement retains the exact old journal',()=>{
 const d=mkdtempSync(join(tmpdir(),'broadboard-reset-')),path=join(d,'room.jsonl'),s=fileStore(path);s.append(['old-1','old-2']);const before=readFileSync(path);s.replaceJournal(['fresh']);
 const old=readdirSync(d).find(n=>n.includes('.archived-'));assert.ok(old);assert.deepEqual(readFileSync(join(d,old)),before);assert.deepEqual(s.load(),['fresh']);
});
test('sealed Upstash adapter replacement archives sealed lines and writes one fresh header (mock transport)',async()=>{
 const fu=await fakeUpstash();try{
 const raw=upstashStore({url:fu.url,token:'tok-test',prefix:'broadboard-online:test',retries:0});const s=sealedStore(raw,deriveKey(CODE));await s.append(['old']);await s.replaceJournal(['fresh']);
 assert.deepEqual(await s.load(),['fresh']);const arch=[...fu.db.keys()].find(k=>k.includes(':archive:reset-'));assert.ok(arch);assert.ok(fu.db.get(arch)[0].startsWith('e1.'));assert.ok(!fu.log.includes('DEL'));assert.ok(!fu.log.includes('EXPIRE'));
 }finally{await fu.close();}
});
test('a spectator can release their own stream without closing a different spectator',()=>{
 const r=new Room({engine:E,code:CODE});r.open();const a=r.join({code:CODE,seat:'S',client:CLIENT}),b=r.join({code:CODE,seat:'S',client:CLIENT});const msgs=[];r.subscribe(a.token,m=>msgs.push(m));r.subscribe(b.token,()=>{});assert.equal(r.release({token:a.token}).ok,true);assert.equal(r.subs.size,1);assert.ok(msgs.some(m=>m.code==='seat_released'));
});
test('ambiguous reset confirmation freezes writes instead of appending to a newly replaced journal',async()=>{
 const s=await boot();try{
 const a=await s.seat('A');const replace=s.store.replaceJournal.bind(s.store);s.store.replaceJournal=(lines)=>{replace(lines);throw Error('response lost after commit');};
 assert.equal((await s.post('/api/reset',{token:a})).status,503);
 assert.equal((await s.post('/api/join',{code:CODE,seat:'B',client:CLIENT})).status,503);
 assert.equal(s.store.archives.length,1);assert.equal(s.store.load().length,1);
 const recovered=Room.resume({engine:E,code:CODE,lines:s.store.load()});assert.equal(recovered.started,false);assert.equal(recovered.seats.A,null);
 }finally{await s.srv.close();}
});

async function bootUpgradedLobby() {
 const store=memoryStore();
 const oldEngine={...E,BUILD_FINGERPRINT:{...E.BUILD_FINGERPRINT,version:'0.1.8'}};
 const old=new Room({engine:oldEngine,code:CODE,store});old.open();
 const host=old.join({code:CODE,seat:'A',name:'retained host',client:CLIENT});assert.equal(host.ok,true);
 const before=store.load();assert.equal(JSON.parse(before[0]).engine,'0.1.8');
 const s=await boot(store);assert.notEqual(s.srv.room.fingerprint.version,'0.1.8');
 return {...s,host:host.token,before};
}
test('upgraded old-version lobby: precommit reset failure preserves journal and permits retry',async()=>{
 const s=await bootUpgradedLobby();try{
  s.store.failNext=1;
  assert.equal((await s.post('/api/reset',{token:s.host})).status,503);
  const ping=(await s.post('/api/ping',{})).json;
  assert.equal(ping.recoveryRequired,false);
  assert.deepEqual(s.store.load(),s.before);assert.equal(s.store.archives.length,0);assert.equal(s.srv.room.seatOf(s.host),'A');
  assert.equal((await s.post('/api/reset',{token:s.host})).status,200);
  assert.deepEqual(s.store.archives[0],s.before);
 }finally{await s.srv.close();}
});
test('upgraded old-version lobby: committed reset with lost response still freezes writes',async()=>{
 const s=await bootUpgradedLobby();try{
  const replace=s.store.replaceJournal.bind(s.store);s.store.replaceJournal=lines=>{replace(lines);throw Error('response lost after commit');};
  assert.equal((await s.post('/api/reset',{token:s.host})).status,503);
  assert.equal((await s.post('/api/join',{code:CODE,seat:'B',client:CLIENT})).status,503);
  assert.deepEqual(s.store.archives[0],s.before);
  const recovered=Room.resume({engine:E,code:CODE,lines:s.store.load()});assert.equal(recovered.seats.A,null);assert.equal(recovered.started,false);
 }finally{await s.srv.close();}
});
test('upgraded old-version lobby: unreadable reset confirmation still freezes writes',async()=>{
 const s=await bootUpgradedLobby();try{
  const load=s.store.load.bind(s.store);let reads=0;s.store.load=()=>{if(++reads===2)throw Error('confirmation unavailable');return load();};
  s.store.failNext=1;
  assert.equal((await s.post('/api/reset',{token:s.host})).status,503);
  assert.equal((await s.post('/api/join',{code:CODE,seat:'B',client:CLIENT})).status,503);
  assert.deepEqual(load(),s.before);assert.equal(s.store.archives.length,0);
 }finally{await s.srv.close();}
});

test('failed reset freezes when durable commands changed under the same room header',async()=>{
 const s=await boot();try{
  const a=await s.seat('A');const header=s.store.load()[0];
  s.store.replaceJournal=()=>{s.store.lines.push(JSON.stringify({k:'release',seat:'A',at:new Date().toISOString()}));throw Error('durable state changed');};
  assert.equal((await s.post('/api/reset',{token:a})).status,503);
  assert.equal(s.store.load()[0],header);assert.equal(s.store.archives.length,0);
  assert.equal((await s.post('/api/join',{code:CODE,seat:'B',client:CLIENT})).status,503);
 }finally{await s.srv.close();}
});
