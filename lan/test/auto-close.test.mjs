import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.mjs';
import { memoryStore } from '../store.mjs';
import { Room } from '../room.mjs';
import { E, CLIENT, makeMatch } from './helpers.mjs';
// A terminal transition isolates lifecycle timing from match tactics; all journal/HTTP paths are real.
const terminalEngine = { ...E, execute: state => ({ status: 'ok', state: { ...state, phase: 'fullTime' }, events: [] }) };
const CODE = 'AUTOCLOSE22';
const wait = async pred => {
  const start = Date.now();
  while (!pred()) { if (Date.now() - start > 2000) throw Error('Lifecycle timeout'); await new Promise(r => setTimeout(r, 5)); }
};
async function boot({ store = memoryStore(), grace = 60000, now } = {}) {
  let clock = now ?? Date.now();
  const srv = await createServer({ engine: terminalEngine, code: CODE, store, completedGraceMs: grace, completedPollMs: 5, now: () => clock });
  const port = await srv.listen();
  const post = async (path, body) => { const r = await fetch(`http://127.0.0.1:${port}${path}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }); return { status:r.status, body:await r.json() }; };
  const join = async seat => { const r = await post('/api/join', {code:CODE, seat, name:seat, client:CLIENT}); assert.equal(r.status,200); return r.body.token; };
  const a = await join('A'), b = await join('B');
  return { srv, store, post, join, a, b, advance: t => { clock=t; }, finish: async () => {
    assert.equal((await post('/api/start',{token:a,state:makeMatch()})).status,200);
    assert.equal((await post('/api/command',{token:a,commandId:'finish-001',baseRev:0,kind:'action',input:{kind:'endTurn'}})).status,200);
  } };
}
test('normal full time keeps seats through 59,999 ms then archives every byte and invalidates both tokens',async()=>{
 const s=await boot();try {
  await s.finish(); const before=s.store.load(), ended=s.srv.room.completedAt;
  assert.equal(s.srv.reopenAt,ended+60000);
  const messages=[];s.srv.room.subscribe(s.a,m=>messages.push(m));
  s.advance(ended+59999);await new Promise(r=>setTimeout(r,25));assert.equal(s.store.archives.length,0);assert.equal(s.srv.room.seatOf(s.a),'A');
  s.advance(ended+60000);await wait(()=>s.store.archives.length===1);
  assert.deepEqual(s.store.archives[0],before);assert.equal(s.srv.room.started,false);assert.equal(s.srv.room.seats.A,null);assert.equal(s.srv.room.seats.B,null);
  assert.equal(s.srv.room.seatOf(s.a),null);assert.equal(s.srv.room.seatOf(s.b),null);
  assert.ok(messages.some(m=>m.code==='room_reset'&&m.automatic===true));
  assert.equal((await s.post('/api/join',{code:CODE,seat:'A',client:CLIENT})).status,200);
 } finally {await s.srv.close();}
});
test('no clients connected: finished seats still close, but lobby and unfinished match do not expire',async()=>{
 const s=await boot();try {
  s.advance(Date.now()+999999);await new Promise(r=>setTimeout(r,25));assert.equal(s.store.archives.length,0);
  await s.post('/api/start',{token:s.a,state:makeMatch()});await new Promise(r=>setTimeout(r,25));assert.equal(s.store.archives.length,0);assert.equal(s.srv.room.seatOf(s.a),'A');
  await s.post('/api/command',{token:s.a,commandId:'finish-002',baseRev:0,kind:'action',input:{kind:'endTurn'}});
  await wait(()=>s.store.archives.length===1);assert.equal(s.srv.room.started,false);
 } finally {await s.srv.close();}
});
test('restart replays the original completion timestamp rather than starting another minute',async()=>{
 const s=await boot();await s.finish();const ended=s.srv.room.completedAt,lines=s.store.load();await s.srv.close();
 const replay=Room.resume({engine:terminalEngine,code:CODE,lines});assert.equal(replay.completedAt,ended);assert.deepEqual(replay.cmds.map(c=>c.at),lines.map(l=>JSON.parse(l)).filter(l=>l.k==='cmd').map(l=>l.at));
 const srv=await createServer({engine:terminalEngine,code:CODE,store:s.store,now:()=>ended+60000,completedPollMs:5});
 try {await wait(()=>s.store.archives.length===1);assert.equal(srv.room.started,false);assert.deepEqual(s.store.archives[0],lines);}finally{await srv.close();}
});
test('storage failure retains finished seats and exact journal, then retries safely',async()=>{
 const s=await boot();try{
  await s.finish();const before=s.store.load();let fail=true;const replace=s.store.replaceJournal.bind(s.store);
  s.store.replaceJournal=lines=>{if(fail)throw Error('offline');return replace(lines);};
  s.advance(s.srv.reopenAt);await new Promise(r=>setTimeout(r,30));assert.deepEqual(s.store.load(),before);assert.equal(s.srv.room.seatOf(s.a),'A');assert.equal(s.store.archives.length,0);
  fail=false;await wait(()=>s.store.archives.length===1);assert.deepEqual(s.store.archives[0],before);
 }finally{await s.srv.close();}
});
test('lost archive response freezes writes without repeating the archival',async()=>{
 const s=await boot();try {
  await s.finish();const replace=s.store.replaceJournal.bind(s.store);s.store.replaceJournal=lines=>{replace(lines);throw Error('response lost');};
  s.advance(s.srv.reopenAt);await wait(()=>s.store.archives.length===1);await new Promise(r=>setTimeout(r,25));
  assert.equal(s.store.archives.length,1);assert.equal((await s.post('/api/join',{code:CODE,seat:'A',client:CLIENT})).status,503);
 }finally{await s.srv.close();}
});
test('manual reopen cancels the old deadline; fresh seats are not expired',async()=>{
 const s=await boot();try{
  await s.finish();const oldDue=s.srv.reopenAt;assert.equal((await s.post('/api/reset',{token:s.a})).status,200);const next=await s.join('A');
  s.advance(oldDue+1000);await new Promise(r=>setTimeout(r,30));assert.equal(s.store.archives.length,1);assert.equal(s.srv.room.seatOf(next),'A');assert.equal(s.srv.reopenAt,null);
 }finally{await s.srv.close();}
});
test('failed terminal command creates no completed deadline',async()=>{
 const s=await boot();try {
  await s.post('/api/start',{token:s.a,state:makeMatch()});s.store.failNext=1;
  assert.equal((await s.post('/api/command',{token:s.a,commandId:'finish-003',baseRev:0,kind:'action',input:{kind:'endTurn'}})).status,503);
  assert.equal(s.srv.reopenAt,null);s.advance(Date.now()+999999);await new Promise(r=>setTimeout(r,25));assert.equal(s.store.archives.length,0);
 }finally{await s.srv.close();}
});
