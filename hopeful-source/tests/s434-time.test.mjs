import test from 'node:test';
import assert from 'node:assert/strict';
import {requestServices} from '../src/services.mjs';
globalThis.bloodboard??={register(){}};
const {chooseAction,decisionWindows}=await import('../src/index.mjs');
import {expandLearningTrace} from '../src/trace-size.mjs';

// S4.34 regressions for decision-time reliability (real case: batch H, B1 home replay 231, evaluation/probes/b1-stop/).
const budgetHost=(exploreReply)=>{
 const calls=[];
 return {calls,raw:{capabilities:async()=>({limits:{maxServiceCalls:12000,maxPositions:8000,maxCallMs:15000}}),
  diagnostics:async()=>({ok:true,usage:{totalCalls:calls.length,positions:0},limitsLeft:{leaves:2000000,serviceMs:100000}}),
  validate:async(i,q)=>{calls.push('validate');return {ok:true,legal:true,position:q?.from};},
  explore:async(i,q)=>{calls.push('explore');return exploreReply(q);}}};
};
const input={kind:'playerAction',playerId:'A1',action:'move',path:[{kind:'step',to:{x:5,y:5}}]};

test('S4.34 a call that stopped at its own maxMs does not end the request search; a request-wide timeout still does',async()=>{
 // Host explore.ts:289 marks its per-call stop limit:'maxMs'; dispatch.ts:344 (request time limit) does not.
 const h=budgetHost(q=>({ok:false,code:'timeout',message:'Stopped after 1300 ms (maxMs)',timedOut:true,limit:'maxMs',max:q.maxMs}));
 const a=requestServices(h.raw,{deadline:Date.now()+20000,resourceBudget:true,callReserve:0,positionReserve:0});await a.initialize();
 const r=await a.services.explore(input,{from:'1.1',maxMs:1300,noKeys:true});
 assert.equal(r.code,'timeout');
 assert.equal(a.canSearch(),true,'per-call maxMs stop keeps the request searchable');
 const v=await a.services.validate(input,{from:'1.1'});
 assert.equal(v.ok,true,'later calls are still dispatched (before S4.34 they were refused as host-timeout)');
 assert.equal(a.snapshot().serviceFailures.perCallTimeouts,1);
 const h2=budgetHost(()=>({ok:false,code:'timeout',message:'explore did not finish before the request\'s time limit.',timedOut:true}));
 const b=requestServices(h2.raw,{deadline:Date.now()+20000,resourceBudget:true,callReserve:0,positionReserve:0});await b.initialize();
 await b.services.explore(input,{from:'1.1',maxMs:1300,noKeys:true});
 assert.equal(b.canSearch(),false,'the host request-wide timeout still stops the search');
 assert.equal((await b.services.validate(input,{from:'1.1'})).ok,false);
});

test('S4.34 abort() refuses every later call of the request',async()=>{
 const h=budgetHost(()=>({ok:true,outcomes:[]}));
 const a=requestServices(h.raw,{deadline:Date.now()+20000,resourceBudget:true,callReserve:0,positionReserve:0});await a.initialize();
 a.abort('watchdog');
 const r=await a.services.validate(input,{from:'1.1'});
 assert.equal(r.ok,false);assert.equal(r.code,'coach-deadline');assert.equal(a.stats.aborted,'watchdog');
 assert.equal(h.calls.length,0);
});

test('S4.34 watchdog: an un-timed host call that never answers cannot hold the decision past the coach limit',async()=>{
 // capabilities/diagnostics are awaited without a timer in initialize(); a host that never answers them used to stall
 // the module until the host's own timer (a recorded fallback). With timeLimitMs 4000 the pipeline deadline is 1 s and
 // the watchdog fires at 2 s (never before the deadline).
 const never=()=>new Promise(()=>{});
 const raw={capabilities:never,diagnostics:never,validate:never,explore:never,candidates:never};
 const o={phase:'play',pending:null,team:'A',active:'A',timeLimitMs:4000,requestId:7,turn:{A:2,B:2},turnsPerHalf:8,
  ball:{kind:'held',playerId:'A1'},players:[{id:'A1',team:'A',location:'pitch',stance:'standing',pos:{x:4,y:5}}],builtInChoice:{candidateId:2}};
 const native=[{id:1,input:{kind:'endTurn'}},{id:2,input}];
 const t=Date.now();const answer=await chooseAction(o,native,raw);const ms=Date.now()-t;
 assert.ok(ms>=1900&&ms<3500,`returned at the watchdog (${ms} ms)`);
 assert.deepEqual(answer.input,input,'the host-listed built-in move');
 assert.match(answer.why,/S4\.37 watchdog/);
 const tr=expandLearningTrace(answer.trace);
 assert.equal(tr.timing.watchdog.fired,true);assert.equal(tr.timing.watchdog.source,'host-built-in-incumbent');
});

test('S4.34 review: the watchdog never fires before the pipeline deadline, whatever the host limit',()=>{
 assert.deepEqual(decisionWindows(120000),{finishMs:96000,watchdogMs:112000},'production 120 s limit: 96 s finish (T1), 112 s watchdog');
 for(const limit of [60000,90000,110000,112000,115000,4000,1000]){
  const w=decisionWindows(limit);
  assert.ok(w.watchdogMs>=w.finishMs+1000,`limit ${limit}: watchdog ${w.watchdogMs} after deadline ${w.finishMs}`);
 }
 assert.deepEqual(decisionWindows(60000),{finishMs:57000,watchdogMs:58000},'60 s host: 57 s deadline, 58 s watchdog (was 52 s)');
});
