import test from 'node:test';
import assert from 'node:assert/strict';
import {auditCommonBoundary} from '../src/common-boundary.mjs';
import {createCandidateLedger} from '../src/candidate-ledger.mjs';
import {requestServices,guardLiveExplore} from '../src/services.mjs';

const branch=(key,active='A',p=1,value=120)=>({key,p,active,completed:true,observation:{active,phase:'play',value}});
const ex=outcomes=>({ok:true,outcomes,pTurnover:0,pTouchdown:0,unresolvedMass:0,rest:{p:0}});
const line=(id='p',outcomes=[branch('own:'+id)])=>({input:{kind:'playerAction',playerId:id,action:'move',path:[]},family:'move',baseValue:120,ex:ex(outcomes)});
const observation={requestId:47,team:'A',players:[{id:'enemy',team:'B'}],ball:{kind:'ground',pos:{x:0,y:0}}};
const partialReply={unknown:true,essentialComplete:false,failed:false,criticalAdjustment:-5,positionAdjustment:-2};
const inspectFor=replyAssessment=>({CFG:{optionalRush:0,turnover:0,carrierTurnover:0,unresolved:120},boardValue:()=>0,
 outcomeValue:e=>({value:e.outcomes.reduce((s,b)=>s+b.p*b.observation.value,0),unknown:e.unresolvedMass}),replyAssessment});
const audit=(rows,services,inspect,ledger)=>auditCommonBoundary(observation,{mode:'normal',selected:rows[0],lines:rows},rows[0],services,inspect,10000,[],{ledger});
const events=costs=>costs.events.map(([phaseId,method,status,reason,count,elapsedMs])=>({phaseId,method:costs.methods[method],status:costs.statuses[status],reason:costs.reasons[reason],count,elapsedMs}));

test('shadow own and each actual reply branch own their adapter costs without changing bounded options',async t=>{
 let now=0;t.mock.method(Date,'now',()=>now);const rawCalls=[],ledger=createCandidateLedger(47);
 const raw={
  candidates:async q=>{rawCalls.push(['candidates',q]);now+=3;return {ok:true,candidates:[]};},
  validate:async(i,q)=>{rawCalls.push(['validate',i,q]);now+=2;return {ok:true,legal:true,position:q.from};},
  explore:async(i,q)=>{
   rawCalls.push(['explore',i,q]);now+=i.kind==='endTurn'?7:5;
   return i.kind==='endTurn'?ex([branch('reply:major','B',.6),branch('reply:minor','B',.4,110)]):ex([branch('reply-result','A')]);
  }
 };
 const adapter=requestServices(raw,{cache:false}),guard=guardLiveExplore(adapter.services,'A',observation.players);
 const inspect=inspectFor(async(b,services,call,budget,team,left,shadow)=>{
  assert.equal(team,'A');assert.equal(shadow,true);assert.ok(left()>900);assert.equal(budget(),500);
  await call(()=>services.candidates({from:b.key,maxMs:budget()}));
  await call(()=>services.explore({kind:'playerAction',playerId:'enemy',action:'block',path:[],blockTarget:'p'},
   {from:b.key,team:'B',perspective:team,maxMs:budget(),maxLeaves:333,maxOutcomes:16,maxKeep:16,threshold:.000001,observations:true,decisions:'builtin'}));
  return partialReply;
 });
 const report=await audit([line()],guard.services,inspect,ledger),phases=ledger.snapshot().phases;
 assert.equal(phases.length,3);const [own,...replies]=phases;
 assert.equal(own.phase,'shadow-own');assert.equal(own.status,'completed');assert.equal(own.elapsedMs,7);assert.equal(own.allocatedSlotMs,3200);assert.equal(own.localDeadline,3200);
 assert.deepEqual(replies.map(p=>[p.from,p.probability,p.elapsedMs,p.allocatedSlotMs]),[['reply:major',.6,10,3193],['reply:minor',.4,10,3183]]);
 for(const phase of phases){assert.equal(phase.serviceCostsObserved,true);assert.equal(phase.candidateId,report.pool[0].candidateId);assert.equal(phase.poolRunId,report.poolRunId);assert.equal(phase.localDeadline,3200);}
 const dispatched=events(adapter.snapshot().candidateServiceCosts).filter(e=>e.status==='raw-dispatched');
 assert.deepEqual(dispatched.filter(e=>e.phaseId===own.phaseId).map(e=>[e.method,e.count]),[['explore',1]]);
 for(const reply of replies)assert.deepEqual(dispatched.filter(e=>e.phaseId===reply.phaseId).map(e=>[e.method,e.count]),[['candidates',1],['validate',1],['explore',1]]);
 assert.equal(dispatched.some(e=>e.phaseId===null),false);assert.equal(rawCalls.length,7);assert.equal(adapter.stats.rpcCalls,7);
 const explores=rawCalls.filter(c=>c[0]==='explore');
 assert.deepEqual(explores[0][2],{from:'own:p',observations:true,perspective:'A',decisions:'builtin',maxOutcomes:16,maxKeep:16,maxLeaves:400,threshold:.000001,maxMs:650});
 for(const [,input,q] of explores.slice(1)){assert.equal(input.action,'block');assert.equal(q.maxLeaves,64);assert.equal(q.maxMs,500);assert.equal(q.maxOutcomes,16);assert.equal(q.maxKeep,16);assert.equal(Object.hasOwn(q,'coachEnumerationDeadline'),false);assert.equal(Object.hasOwn(q,'phaseId'),false);}
 assert.equal(report.pool[0].reply_unknown,1);assert.equal(report.pool[0].critical_reply,-5);assert.equal(report.pool[0].position_reply,-2);
});

test('plain mocks remain unobserved and phase diagnostics preserve calls, ordering, values and probability',async t=>{
 t.mock.method(Date,'now',()=>0);
 const run=async ledger=>{
  const calls=[],services={explore:async(i,q)=>{calls.push([i,q]);return ex([branch('closed:'+q.from,'B')]);}};
  const inspect=inspectFor(async(b,scoped)=>{await scoped.explore({kind:'endTurn'},{from:b.key,maxLeaves:999,maxMs:500});return partialReply;});
  return {report:await audit([line('p'),line('q')],services,inspect,ledger),calls};
 };
 const plain=await run(),ledger=createCandidateLedger(47),observed=await run(ledger);
 const withoutIds=x=>Array.isArray(x)?x.map(withoutIds):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).filter(([k])=>!['candidateId','inputId','poolRunId'].includes(k)).map(([k,v])=>[k,withoutIds(v)])):x;
 assert.deepEqual(observed.calls,plain.calls);assert.deepEqual(withoutIds(observed.report),withoutIds(plain.report));
 assert.equal(ledger.snapshot().phases.length,4);for(const phase of ledger.snapshot().phases){assert.equal(phase.serviceCostsObserved,false);assert.equal(phase.elapsedMs,0);assert.notEqual(phase.status,'entered');}
});

test('every candidate-level own early exit finishes its phase with the actual reason and deadline',async t=>{
 let clock=()=>0;t.mock.method(Date,'now',()=>clock());
 for(const kind of ['slot','dependency','non-unit']){
  let reads=0;clock=kind==='slot'?()=>reads++<2?0:3000:()=>0;
  const ledger=createCandidateLedger(47),candidate=line(),calls=[];
  if(kind==='dependency')candidate.preparedBranches=new Map([['missing',{plan:{input:{kind:'endTurn'}}}]]);
  const services={explore:async(i,q)=>{calls.push([i,q]);return ex([branch('too-much','B',1.1)]);}};
  const report=await audit([candidate],services,inspectFor(async()=>partialReply),ledger),[phase]=ledger.snapshot().phases;
  assert.equal(ledger.snapshot().phases.length,1);assert.equal(phase.phase,'shadow-own');assert.equal(phase.localDeadline,3200);assert.equal(phase.serviceCostsObserved,false);
  assert.equal(phase.status,kind==='slot'?'skipped':'rejected');assert.equal(phase.elapsedMs,kind==='slot'?3000:0);
  assert.equal(phase.reason,kind==='slot'?'POLICY_SLOT_BUDGET_UNAVAILABLE':kind==='dependency'?'OWN_DEPENDENCY:dangling-priced-branch':'OWN_END_NON_UNIT_MASS');
  assert.equal(calls.length,kind==='non-unit'?1:0);assert.ok(report.pool[0].rejections.includes(phase.reason));
 }
});

test('reply branch skip phases retain source, probability, actual remaining slot and reason',async t=>{
 let now=0;t.mock.method(Date,'now',()=>now);
 for(const kind of ['key','active','slot']){
  now=0;const ledger=createCandidateLedger(47);let replies=0;
  const b=kind==='slot'?branch('needs-closure'):branch(kind==='key'?null:'mismatched-active','B');
  if(kind==='active')b.observation.active='A';
  const services={explore:async()=>{now=2400;return ex([branch('closed','B')]);}};
  const report=await audit([line('p',[b])],services,inspectFor(async()=>{replies++;return partialReply;}),ledger);
  const phases=ledger.snapshot().phases,reply=phases[1];assert.equal(phases.length,2);assert.equal(replies,0);assert.equal(reply.phase,'shadow-reply');assert.equal(reply.status,'skipped');assert.equal(reply.probability,1);
  assert.equal(reply.from,kind==='key'?null:kind==='slot'?'closed':'mismatched-active');assert.equal(reply.localDeadline,3200);assert.equal(reply.allocatedSlotMs,kind==='slot'?800:3200);
  assert.equal(reply.reason,kind==='key'?'REPLY_SOURCE_KEY_MISSING':kind==='active'?'REPLY_SOURCE_STILL_OWN_ACTIVE':'REPLY_SLOT_EXHAUSTED');assert.equal(reply.serviceCostsObserved,false);assert.ok(report.pool[0].rejections.includes(reply.reason));assert.equal(report.pool[0].reply_unknown,1);
 }
});

test('terminal reply is recorded as not needed rather than measured zero service cost',async t=>{
 t.mock.method(Date,'now',()=>0);const ledger=createCandidateLedger(47),terminal=branch('full-time');terminal.observation.phase='fullTime';
 let calls=0;const report=await audit([line('p',[terminal])],{explore:async()=>{calls++;}},inspectFor(async()=>{calls++;}),ledger);
 const phases=ledger.snapshot().phases;assert.equal(calls,0);assert.equal(phases.length,2);assert.equal(phases[1].phase,'shadow-reply');assert.equal(phases[1].status,'not-needed');assert.equal(phases[1].reason,'not-needed-terminal');assert.equal(phases[1].serviceCostsObserved,false);assert.equal(phases[1].allocatedSlotMs,0);assert.equal(Object.hasOwn(phases[1],'rpcCalls'),false);assert.equal(Object.hasOwn(phases[1],'risk'),false);
 assert.equal(report.pool[0].terminal_mass,1);assert.equal(report.pool[0].reply_unknown,0);
});

test('unexpected own or reply exceptions retain their original propagation and finish phase elapsed time',async t=>{
 let now=0;t.mock.method(Date,'now',()=>now);
 for(const stage of ['own','reply']){
  now=0;const ledger=createCandidateLedger(47),inspect=inspectFor(async()=>{now=17;throw Error('reply exploded');});
  if(stage==='own')inspect.boardValue=()=>{now=11;throw Error('own exploded');};
  await assert.rejects(audit([line('p',[branch('opponent','B')])],{},inspect,ledger),new RegExp(stage+' exploded'));
  const phases=ledger.snapshot().phases,last=phases.at(-1);assert.equal(last.phase,'shadow-'+stage);assert.equal(last.status,'failed');assert.equal(last.reason,'phase-interrupted');assert.equal(last.elapsedMs,stage==='own'?11:17);assert.equal(last.serviceCostsObserved,false);assert.equal(phases.some(p=>p.status==='entered'),false);
 }
});
