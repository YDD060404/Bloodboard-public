import test from 'node:test';import assert from 'node:assert/strict';
import {compareCommonTurnPool} from '../src/common-turn-pool.mjs';
import {endpointUtilityRange,endpointUtilityPoint,minimumUtilityBounds} from '../src/endpoint-utility.mjs';
import {createCandidateLedger} from '../src/candidate-ledger.mjs';
import {requestServices} from '../src/services.mjs';
const move=(id,n=1)=>({kind:'playerAction',playerId:id,action:'move',path:Array.from({length:n},(_,i)=>({kind:'step',to:{x:3+i,y:3}}))});
const page=(q,rows)=>{if(q.families.length===1)rows=[];return {ok:true,position:{key:q.from},offset:0,limit:q.limit,total:rows.length,returned:rows.length,
 complete:true,hasMore:false,nextOffset:null,truncated:[],pool:{generated:rows.length,afterFilters:rows.length,afterLimits:rows.length,droppedByFilters:0},candidates:rows};};
// Synthetic policy graph, never supervision or a reconstruction of a user replay.
function fixture({ready=false,scoreReply=false,partialReply=false,foreign=false,boundedReply=false,replyRefusal=null,nestedPartial=false,directEndInvalid=false}={}){
 const o={requestId:42,team:'A',active:'A',phase:'play',half:1,drive:1,score:{A:0,B:0},turn:{A:1,B:1},turnsPerHalf:8,pitch:{width:26,height:15},
  ball:{kind:'ground',pos:{x:3,y:3}},players:[{id:'enemy',team:'B',location:'pitch',stance:'stunned',pos:{x:20,y:3},ma:6,st:3,ag:3,skills:[],activated:!ready,canBeActivated:ready}]};
 const values={current:20,later:70,third:30},states=new Map(),calls=[];let seq=0;
 const inspect={CFG:{touchdown:1500,possession:160,carrierTurnover:95,turnover:62,unresolved:120,optionalRush:12,carrierDown:110,opponentScore:480},canonical:x=>x,
  boardValue:ob=>ob.value??0,outcomeValue:e=>({value:e.outcomes.reduce((s,b)=>s+b.p*(b.observation.value??0),0)}),
  replyAssessment:async()=>({failed:false,unknown:true,essentialComplete:false,criticalAdjustment:0,positionAdjustment:0})};
 const make=(from,team,ob,{touchdown=null,turnover=false}={})=>{
  const key='state'+(++seq);states.set(key,ob);
  return {ok:true,position:{key:from},perspective:'A',activeTeam:team,outcomeIdentity:'complete-state-v1',decisionPolicy:{mode:'builtin',own:'builtin',opponent:'builtin'},
   exact:true,enumerated:1,leaves:1,unresolvedMass:0,rest:{p:0},pTurnover:Number(turnover),pTouchdown:Number(touchdown==='A'),pOpponentTouchdown:Number(touchdown==='B'),
   outcomes:[{key,p:1,active:ob.active,observation:ob,turnover,touchdown,completed:true}]};
 };
 const line=(id,n=1)=>({input:move(id,n),ex:make('root','A',{...o,active:'B',actor:id,value:values[id]})});
 const services={validate:async(i,q={})=>({ok:true,legal:true,position:q.from??'root'}),
  explore:async(i,q)=>{calls.push({i,q});
   if(q.team==='A')return make(q.from,'A',{...o,active:'B',actor:i.playerId,value:values[i.playerId]});
   const ob=states.get(q.from);assert.ok(ob);
   if(directEndInvalid&&i.kind==='endTurn'&&!ob.afterAction)return {...make(q.from,'B',{...ob,active:'A'}),outcomeIdentity:'invalid'};
   if((nestedPartial||directEndInvalid)&&i.kind!=='endTurn')return make(q.from,'B',{...ob,active:'B',afterAction:true});
   if(nestedPartial&&i.kind==='endTurn'&&ob.afterAction){
    const r=make(q.from,'B',{...ob,active:'A'});r.enumerated=.75;r.unresolvedMass=.25;r.rest={p:.25};r.outcomes[0].p=.75;return r;
   }
   if(i.kind!=='endTurn'&&replyRefusal)return {ok:false,code:replyRefusal};
   if(i.kind!=='endTurn'&&boundedReply){
    const r=make(q.from,'B',{...ob,active:'A',phase:'fullTime',score:{A:0,B:1}},{touchdown:'B'});
    r.exact=false;r.enumerated=.75;r.unresolvedMass=.25;r.rest={p:.25};r.outcomes[0].p=.75;
    r.pOpponentTouchdown=1; // Host extrapolation: only q-unresolved is observed.
    return r;
   }
   if(i.kind!=='endTurn'&&partialReply){
    const v={schema:'explore-timeout-witness/1',outcomeIdentity:'complete-state-v1',requestId:42,input:i,position:{key:foreign?'foreign':q.from},perspective:'A',activeTeam:'B',
     massUnit:'unconditional-chance',admissibility:'evidence-only-no-execution-certificate',enumerationComplete:false,value:null,
     decisionPolicy:{mode:'builtin',own:'builtin',opponent:'builtin'},enumerated:.75,unknownMass:.25,listedMass:0,unlistedEnumeratedMass:.75,leaves:10,outcomes:[],
     observed:{turnover:0,touchdown:0,opponentTouchdown:.75,completed:.75},probabilityBounds:{turnover:{lower:0,upper:.25},touchdown:{lower:0,upper:.25},opponentTouchdown:{lower:.75,upper:1},completed:{lower:.75,upper:1}}};
    return {ok:false,code:'timeout',partialEvidence:v};
   }
   if(i.kind!=='endTurn'&&scoreReply)return make(q.from,'B',{...ob,active:'A',phase:'fullTime',score:{A:0,B:1}},{touchdown:'B'});
   return make(q.from,'B',{...ob,active:'A',activation:null});
  },candidates:async q=>page(q,scoreReply||partialReply||boundedReply||replyRefusal?[{legal:true,kind:'score',input:move('enemy')}]:[]),
  fork:{open:async q=>({ok:true,revisionBound:true,from:q.from,fork:'f',node:'terminal',position:'terminal',completed:true,turnover:false}),close:async()=>({ok:true}),step:async()=>null}};
 const run=(current,extras,options={})=>compareCommonTurnPool(o,{mode:'normal',selected:current,lines:[current]},current,extras,services,inspect,Date.now()+30000,options);
 return {o,inspect,services,line,run,calls,values};
}
const costEvents=adapter=>{const c=adapter.snapshot().candidateServiceCosts;return c.events.map(r=>({phaseId:r[0],method:c.methods[r[1]],status:c.statuses[r[2]],reason:c.reasons[r[3]],count:r[4]}));};
const counted=(events,phaseId,method,status)=>events.filter(r=>r.phaseId===phaseId&&r.method===method&&r.status===status).reduce((n,r)=>n+r.count,0);
function observed(f){
 const rawCalls=[],raw={...f.services};
 for(const name of ['validate','explore','candidates'])raw[name]=(...args)=>{rawCalls.push({name,args});return f.services[name](...args);};
 raw.fork=Object.fromEntries(Object.entries(f.services.fork).map(([name,fn])=>[name,(...args)=>{rawCalls.push({name:'fork.'+name,args});return fn(...args);} ]));
 const adapter=requestServices(raw),ledger=createCandidateLedger(42);
 return {adapter,ledger,rawCalls,run:(c,extras,options={})=>compareCommonTurnPool(f.o,{mode:'normal',selected:c,lines:[c]},c,extras,adapter.services,f.inspect,Date.now()+30000,{...options,ledger})};
}
test('formal phase costs link real underlying calls without changing selection, bounds or native arguments',async t=>{
 t.mock.method(Date,'now',()=>0);
 const baseline=fixture(),b=await baseline.run(baseline.line('current'),[baseline.line('later')]);
 const f=fixture(),x=observed(f),r=await x.run(f.line('current'),[f.line('later')]);
 assert.deepEqual(r.selected,b.selected);assert.deepEqual(r.bounds,b.bounds);assert.equal(r.reason,b.reason);assert.deepEqual(f.calls,baseline.calls);
 const phases=x.ledger.snapshot().phases,events=costEvents(x.adapter);
 assert.equal(phases.filter(p=>p.phase==='formal-own').length,2);assert.equal(phases.filter(p=>p.phase==='formal-reply').length,2);assert.ok(phases.every(p=>p.serviceCostsObserved&&p.status!=='entered'));
 for(const row of r.rows){
  const own=phases.find(p=>p.phaseId===row.ownPhaseId),reply=phases.find(p=>p.phaseId===row.replyPhaseId);
  assert.equal(own.candidateId,row.candidateId);assert.equal(reply.candidateId,row.candidateId);assert.equal(reply.poolRunId,r.poolRunId);assert.equal(reply.localDeadline,24000);assert.equal(reply.allocatedSlotMs,null);assert.equal(reply.sharedFrame,true);
  assert.equal(counted(events,reply.phaseId,'explore','raw-dispatched'),1);assert.equal(counted(events,reply.phaseId,'validate','raw-dispatched'),1);assert.equal(reply.endWitnessSources[0].endChecked,true);
 }
 assert.equal(events.filter(e=>e.status==='raw-dispatched').reduce((n,e)=>n+e.count,0),x.rawCalls.length);
 assert.match(x.ledger.snapshot().coverage.formalReplyRPC,/aggregate/);
 assert.ok(x.rawCalls.every(c=>c.args.every(a=>!a||!Object.hasOwn(a,'phaseId')&&!Object.hasOwn(a,'owner'))));
});
test('formal helper-local reuse credits the second candidate with cache evidence and no borrowed RPC cost',async t=>{
 t.mock.method(Date,'now',()=>0);const f=fixture(),x=observed(f),current=f.line('current'),later=f.line('later');later.ex={...later.ex,outcomes:current.ex.outcomes};
 const r=await x.run(current,[later]),events=costEvents(x.adapter),replyPhases=x.ledger.snapshot().phases.filter(p=>p.phase==='formal-reply');
 assert.equal(r.selected,null);assert.equal(replyPhases.length,2);
 const dispatches=replyPhases.map(p=>counted(events,p.phaseId,'explore','raw-dispatched'));assert.deepEqual(dispatches.slice().sort(),[0,1]);
 const reused=replyPhases.find(p=>counted(events,p.phaseId,'explore','helper-cache-hit')===1);
 assert.ok(reused);assert.equal(counted(events,reused.phaseId,'validate','helper-cache-hit'),1);assert.equal(counted(events,reused.phaseId,'validate','raw-dispatched'),0);
 assert.equal(x.rawCalls.filter(c=>c.name==='explore').length,1);assert.equal(x.rawCalls.filter(c=>c.name==='validate'&&c.args[1]?.team==='B').length,1);
});
test('formal first refusal owner remains visible while every unsearched chance bound is preserved',async t=>{
 t.mock.method(Date,'now',()=>0);const f=fixture({ready:true,replyRefusal:'timeout'}),x=observed(f),r=await x.run(f.line('current'),[f.line('later')]);
 assert.equal(r.selected,null);assert.equal(r.endpointFrame.stoppedRPC.code,'timeout');assert.ok(r.bounds.every(b=>b.lower<=-1660));
 const events=costEvents(x.adapter),stops=events.filter(e=>e.status==='helper-first-stop');assert.equal(stops.length,1);assert.equal(stops[0].count,1);assert.equal(stops[0].reason,'timeout');
 assert.equal(counted(events,stops[0].phaseId,'explore','raw-dispatched'),2);assert.equal(x.adapter.snapshot().serviceFailures.count,1);
 assert.ok(x.ledger.snapshot().phases.filter(p=>p.phase==='formal-reply').every(p=>p.status==='stopped'&&p.reason==='timeout'));
 assert.equal(x.rawCalls.filter(c=>c.name==='explore'&&c.args[0].kind!=='endTurn').length,1);
});
test('unobserved formal services and exhausted own slots keep missing calls explicit rather than zero',async t=>{
 t.mock.method(Date,'now',()=>0);const f=fixture(),ledger=createCandidateLedger(42),c=f.line('current');
 const r=await compareCommonTurnPool(f.o,{mode:'normal',selected:c,lines:[c]},c,[f.line('later')],f.services,f.inspect,100,{ledger});
 assert.equal(r.selected,null);assert.equal(f.calls.length,0);const phases=ledger.snapshot().phases;assert.equal(phases.length,2);
 assert.ok(phases.every(p=>!p.serviceCostsObserved&&p.status==='incomplete'&&p.reason==='common-own-slot-budget-unavailable'&&p.reportedCalls===null&&p.localDeadline===null));
 assert.equal(ledger.snapshot().coverage.formalReplyRPC,'unobserved');
});
test('bounded utility has an explicit range and preserves positional ordering, with exact terminal score',()=>{
 const f=fixture(),range=endpointUtilityRange(f.o,f.inspect);assert.equal(range.lower,-1660);assert.equal(range.upper,1660);
 for(const v of [-1e9,-40,0,50,1e9]){
  const p=endpointUtilityPoint({active:'A',observation:{...f.o,active:'A',value:v}},f.o,f.inspect);
  assert.ok(p.valid);assert.ok(p.value>=-160&&p.value<=160);
 }
 const low=endpointUtilityPoint({active:'A',observation:{...f.o,value:20}},f.o,f.inspect),high=endpointUtilityPoint({active:'A',observation:{...f.o,value:70}},f.o,f.inspect);assert.ok(high.value>low.value);
 const end=endpointUtilityPoint({active:'B',observation:{...f.o,active:'B',phase:'fullTime',value:1e9}},f.o,f.inspect);assert.equal(end.value,0);
 assert.equal(endpointUtilityRange(f.o,f.inspect,'legacy-point').lower,null);
 assert.deepEqual(minimumUtilityBounds([{lower:null,upper:null},{lower:10,upper:20}]),{lower:null,upper:20});
});
test('actual sole End witnesses can admit a stronger peer despite the old reply completeness flag',async()=>{
 const f=fixture(),c=f.line('current'),r=await f.run(c,[f.line('later'),f.line('third')]);
 assert.equal(r.selected?.input.playerId,'later',r.reason);assert.equal(r.endpointFrame.policies.length,3);
 assert.ok(r.endpointFrame.policies.every(p=>!p.outsidePoliciesUnverified&&p.knownEndMass===1));
 assert.equal(r.selected.valueScope,'value/baseValue retain legacy own-End bookkeeping; selection uses separately named endpointComparison utility');
 assert.ok(r.selected.endpointComparison.lower>r.bounds[0].upper+.5);
});
test('current identity and producer order cannot change the common endpoint winner',async()=>{
 for(const current of ['current','third','later']){
  const f=fixture(),r=await f.run(f.line(current),['later','third','current'].filter(id=>id!==current).map(id=>f.line(id)));
  assert.equal(r.selected?.input.playerId,'later',r.reason);
 }
});
test('an opponent that can still act is never certified safe by an observed End alone',async()=>{
 const f=fixture({ready:true}),r=await f.run(f.line('current'),[f.line('later')]);
 assert.equal(r.selected,null);assert.match(r.reason,/common-strict-peer-gate-not-met/);assert.ok(r.bounds.every(b=>Number.isFinite(b.lower)&&Number.isFinite(b.upper)));
 assert.ok(r.endpointFrame.policies.every(p=>p.outsidePoliciesUnverified));
 assert.ok(r.bounds.every(b=>b.lower<=-1660));assert.ok(r.endpointFrame.policies.every(p=>p.unknownChanceMass===0));
});
test('known opponent TD remains an upper witness even when unsearched policies stay unknown',async()=>{
 const f=fixture({ready:true,scoreReply:true}),r=await f.run(f.line('current'),[f.line('later')]);
 assert.equal(r.selected,null);assert.ok(r.bounds.every(b=>b.upper<=-1500));
 assert.ok(r.endpointFrame.policies.every(p=>p.observedOpponentTDLower===1&&p.outsidePoliciesUnverified));
});
test('unlisted observed TD from a timeout contributes its own bounded utility without normalization',async()=>{
 const f=fixture({ready:true,partialReply:true}),r=await f.run(f.line('current'),[f.line('later')]);
 assert.equal(r.selected,null);assert.match(r.reason,/RPC-failure-stopped/);
 assert.ok(r.bounds.some(b=>b.upper<-500));
 assert.equal(r.endpointFrame.policies.filter(p=>p.observedOpponentTDLower===.75).length,1);
 assert.equal(f.calls.filter(c=>c.q.team==='B'&&c.i.kind!=='endTurn').length,1,'first failed reply must stop further RPC exploration');
 assert.equal(r.endpointFrame.stoppedRPC.code,'timeout');
});
test('foreign timeout evidence cannot contribute a TD witness or a winning certificate',async()=>{
 const f=fixture({ready:true,partialReply:true,foreign:true}),r=await f.run(f.line('current'),[f.line('later')]);
 assert.equal(r.selected,null);assert.ok(r.bounds.every(b=>b.upper>0));
 assert.ok(r.endpointFrame.policies.every(p=>p.observedOpponentTDLower===0));
});
test('extra own movement resources are charged in the same frame for every role',async()=>{
 const f=fixture();f.values.later=22;
 const r=await f.run(f.line('later',12),[f.line('current',1)]);
 assert.equal(r.selected?.input.playerId,'current',r.reason);
 assert.equal(r.endpointFrame.policies[0].cost,7.199999999999999);assert.equal(r.endpointFrame.policies[1].cost,.6);
});
test('legacy point and old completeness remain explicit ablations, never implicit value mixing',async()=>{
 const f=fixture(),a=await f.run(f.line('current'),[f.line('later')],{valueMode:'legacy-point'});
 assert.equal(a.selected?.input.playerId,'later');assert.equal(a.valueMode,'legacy-point');
 const g=fixture({ready:true}),b=await g.run(g.line('current'),[g.line('later')],{valueMode:'legacy-point'});
 assert.equal(b.selected,null);assert.ok(b.bounds.every(b=>b.lower===null));
 const h=fixture(),c=await h.run(h.line('current'),[h.line('later')],{valueMode:'legacy-completeness'});
 assert.equal(c.selected,null);assert.match(c.reason,/incomplete/);
});

test('bounded successful enumeration keeps residual chance and observed TD without an incumbent privilege',async()=>{
 for(const current of ['current','later']){
  const f=fixture({ready:true,boundedReply:true});
  const r=await f.run(f.line(current),[f.line(current==='current'?'later':'current')]);
  assert.equal(r.selected,null);assert.equal(r.endpointFrame.stoppedRPC,null);
  assert.ok(r.endpointFrame.policies.every(p=>p.observedOpponentTDLower===.75&&p.outsidePoliciesUnverified));
  assert.ok(r.bounds.every(b=>b.lower<=-1660&&b.upper<-500));
  assert.ok(f.calls.filter(c=>c.q.team==='B').every(c=>c.q.maxLeaves===64&&c.q.maxMs<=450));
 }
});
test('all peers, source End and continuation closures share the bounded reply cap',async()=>{
 const f=fixture({ready:true,scoreReply:true});await f.run(f.line('current'),[f.line('later'),f.line('third')]);
 const replies=f.calls.filter(c=>c.q.team==='B');assert.ok(replies.length>=3);
 assert.ok(replies.every(c=>c.q.maxLeaves===64&&c.q.maxKeep===256&&c.q.threshold===1e-6));
});

test('local resource refusal is reported separately from a real failed host RPC',async()=>{
 const f=fixture({ready:true,replyRefusal:'coach-resource-budget'}),r=await f.run(f.line('current'),[f.line('later')]);
 assert.equal(r.selected,null);assert.match(r.reason,/resource-budget-stopped/);assert.equal(r.endpointFrame.stoppedRPC.code,'coach-resource-budget');
 const g=fixture({ready:true,replyRefusal:'timeout'}),t=await g.run(g.line('current'),[g.line('later')]);
 assert.match(t.reason,/RPC-failure-stopped/);
});

test('finite common domain compares exact legal reply witnesses symmetrically while retaining global uncertainty',async()=>{
 for(const current of ['current','later','third']){
  const f=fixture({ready:true});
  f.services.candidates=async q=>page(q,[{legal:true,kind:'move',input:move('enemy')}]);
  const r=await f.run(f.line(current),['current','later','third'].filter(id=>id!==current).map(id=>f.line(id)),{comparisonScope:'finite-common',valueMode:'legacy-point'});
  assert.equal(r.selected?.input.playerId,'later',r.reason);
  assert.ok(r.endpointFrame.finiteDomainComparable);assert.equal(r.endpointFrame.domain.length,1);
  assert.ok(r.endpointFrame.policies.every(p=>p.outsidePoliciesUnverified&&p.finiteUnknownChanceMass===0));
  assert.ok(r.endpointFrame.globalBounds.every(b=>b.lower===null));
  assert.equal(r.selected.endpointComparison.comparisonScope,'finite-common');
 }
});
test('an End-only finite domain never grants a winner while opponents can act',async()=>{
 const f=fixture({ready:true});const r=await f.run(f.line('current'),[f.line('later')],{comparisonScope:'finite-common'});
 assert.equal(r.selected,null);assert.match(r.reason,/shared-finite-reply-domain-incomplete/);
});
test('separated finite intervals below the preserved margin report a failed strict gate, not overlap',async()=>{
 const f=fixture({ready:true});f.values.later=f.values.current+.25;
 f.services.candidates=async q=>page(q,[{legal:true,kind:'move',input:move('enemy')}]);
 const r=await f.run(f.line('current'),[f.line('later')],{comparisonScope:'finite-common',valueMode:'legacy-point'});
 assert.ok(r.endpointFrame.valid&&r.endpointFrame.finiteDomainComparable);
 assert.equal(r.selected,null);assert.equal(r.winnerIndex,-1);
 assert.equal(r.reason,'common-strict-peer-gate-not-met; fallback-is-not-a-winner');assert.doesNotMatch(r.reason,/overlap/);
 assert.ok(r.bounds[1].lower>r.bounds[0].upper);
 const gate=r.rows.find(row=>row.input.playerId==='later').comparisonGate;
 assert.equal(gate.passed,false);assert.equal(gate.primaryReason,'legacy-evidence-margin-not-met');
 assert.equal(gate.peers[0].intervalsIntersect,false);assert.equal(gate.peers[0].requiredMargin,.5);
 assert.ok(gate.peers[0].gap>0&&gate.peers[0].gap<.5);
});
test('finite-domain unknown chance is kept in intervals rather than renormalized to success',async()=>{
 const f=fixture({ready:true,boundedReply:true});const r=await f.run(f.line('current'),[f.line('later')],{comparisonScope:'finite-common'});
 assert.equal(r.selected,null);assert.ok(r.endpointFrame.policies.every(p=>p.finiteUnknownChanceMass===.25));
 assert.ok(r.bounds.every(b=>b.upper-b.lower>100));assert.ok(r.endpointFrame.globalBounds.every(b=>b.lower<=-1660));
 assert.ok(r.endpointFrame.valid&&r.endpointFrame.finiteDomainComparable);assert.equal(r.winnerIndex,-1);
 assert.equal(r.reason,'common-strict-peer-gate-not-met; fallback-is-not-a-winner');assert.doesNotMatch(r.reason,/overlap/);
 assert.ok(r.comparisonEvidence.rows.every(row=>!row.passed&&row.peers.every(peer=>peer.intervalsIntersect)));
});

test('nested action End propagates unknown state mass without double-charging its bounds',async()=>{
 const f=fixture({ready:true,nestedPartial:true});
 f.services.candidates=async q=>page(q,[{legal:true,kind:'move',input:move('enemy')}]);
 const r=await f.run(f.line('current'),[f.line('later')],{comparisonScope:'finite-common'});
 assert.ok(r.endpointFrame.finiteDomainComparable);
 assert.ok(r.endpointFrame.policies.every(p=>p.finiteUnknownChanceMass===.25));
 assert.equal(r.selected,null);assert.ok(r.bounds.every(b=>b.upper-b.lower>100));
});
test('an unverified direct End cannot be masked by a successful action End reply',async()=>{
 const f=fixture({ready:true,directEndInvalid:true});
 f.services.candidates=async q=>page(q,[{legal:true,kind:'move',input:move('enemy')}]);
 const r=await f.run(f.line('current'),[f.line('later')],{comparisonScope:'finite-common',valueMode:'legacy-point'});
 assert.equal(r.selected,null);assert.equal(r.endpointFrame.finiteDomainComparable,false);
 assert.ok(r.endpointFrame.policies.every(p=>p.domainChecked.every(n=>!n.endChecked&&n.checked===1)));
 assert.match(r.reason,/shared-finite-reply-domain-incomplete/);
});
test('finite reply pruning prevents many scorer-route variants from excluding a different contact family',async()=>{
 const f=fixture({ready:true});
 const rows=[...Array.from({length:10},(_,i)=>({legal:true,kind:'score',input:move('enemy',i+1)})),
 {legal:true,kind:'block',input:{kind:'playerAction',playerId:'other',action:'block',blockTarget:'current'}}];
 f.services.candidates=async q=>page(q,rows);
 const r=await f.run(f.line('current'),[f.line('later')],{comparisonScope:'finite-common',valueMode:'legacy-point'});
 assert.equal(r.endpointFrame.domain.length,2);assert.ok(r.endpointFrame.domain.some(i=>i.action==='block'));
 assert.equal(r.endpointFrame.domainPruning.unrepresentedVariants,9);assert.equal(r.endpointFrame.domainPruning.equivalenceClaimed,false);
 assert.ok(r.endpointFrame.finiteDomainComparable);assert.equal(r.selected?.input.playerId,'later');
 rows.reverse();const s=await f.run(f.line('current'),[f.line('later')],{comparisonScope:'finite-common',valueMode:'legacy-point'});
 assert.deepEqual(s.endpointFrame.domain,r.endpointFrame.domain);
});
test('finite reply category retains different Handoff recipients and Pass squares, pruning only same-target variants',async()=>{
 const f=fixture({ready:true}),h=(target,n=0)=>({kind:'playerAction',playerId:'enemy',action:'handoff',handoffTarget:target,path:move('enemy',n).path}),p=x=>({kind:'playerAction',playerId:'enemy',action:'pass',passTarget:{x,y:7},path:[]});
 const rows=[{kind:'handoff',input:h('r1')},{kind:'handoff',input:h('r1',1)},{kind:'handoff',input:h('r2')},{kind:'pass',input:p(5)},{kind:'pass',input:p(6)}];
 f.services.candidates=async q=>page(q,rows);
 const r=await f.run(f.line('current'),[f.line('later')],{comparisonScope:'finite-common'});assert.equal(r.endpointFrame.domain.length,4);
 assert.deepEqual(new Set(r.endpointFrame.domain.filter(i=>i.action==='handoff').map(i=>i.handoffTarget)),new Set(['r1','r2']));
 assert.equal(r.endpointFrame.domainPruning.unrepresentedVariants,1);rows.reverse();
 const s=await f.run(f.line('later'),[f.line('current')],{comparisonScope:'finite-common'});assert.equal(s.endpointFrame.domainId,r.endpointFrame.domainId);
});
test('a source-matched opponent reply with a different rules edition stays unpriced',async()=>{
 const {compareOpponentEndValues}=await import('../src/opponent-end-values.mjs');
 for(const successor of ['faq2026','legacy',undefined]){
  const f=fixture({ready:true});f.o.rulesEdition='faq2026';f.o.ruleset={rulesEdition:'faq2026'};
  f.services.candidates=async q=>page(q,[{kind:'move',input:move('enemy')}]);
  const original=f.services.explore;
  f.services.explore=async(i,q)=>{const e=await original(i,q);for(const b of e.outcomes)if(b.observation){b.observation.rulesEdition=successor;b.observation.ruleset={rulesEdition:successor};}return e;};
  const own=['current','later'].map(id=>{const tree=f.line(id);return {complete:true,tree,policy:{input:tree.input,secondCost:0},endpoints:tree.ex.outcomes};});
  const r=await compareOpponentEndValues(f.o,own,f.services,f.inspect,Date.now()+10000,{comparisonScope:'finite-common'});
  assert.equal(r.finiteDomainComparable,successor==='faq2026');
  if(successor!=='faq2026'){assert.ok(r.policies.every(p=>p.knownEndMass===0));assert.ok(r.policies.every(p=>p.reasons.includes('reply-chance-law-unverified')));}
 }
});
test('semantic reply identities ignore outer and nested JSON key order without duplicate queries',async()=>{
 const f=fixture({ready:true});
 const pass={kind:'playerAction',playerId:'enemy',action:'pass',path:[],passTarget:{x:16,y:7}},samePass={passTarget:{y:7,x:16},path:[],action:'pass',playerId:'enemy',kind:'playerAction'};
 const handoff={kind:'playerAction',playerId:'enemy',action:'handoff',path:[],handoffTarget:'receiver'},sameHandoff={handoffTarget:'receiver',path:[],action:'handoff',playerId:'enemy',kind:'playerAction'};
 let rows=[{kind:'pass',input:pass},{kind:'pass',input:samePass},{kind:'handoff',input:handoff},{kind:'handoff',input:sameHandoff}];
 f.services.candidates=async q=>page(q,rows);
 const a=await f.run(f.line('current'),[f.line('later')],{comparisonScope:'finite-common'});assert.equal(a.endpointFrame.domain.length,2);assert.equal(a.endpointFrame.omittedDomainInputs,0);
 for(const action of ['pass','handoff'])assert.equal(f.calls.filter(c=>c.q.team==='B'&&c.i.action===action).length,2,'one reply per own-policy endpoint');
 rows.reverse();const b=await f.run(f.line('later'),[f.line('current')],{comparisonScope:'finite-common'});assert.equal(b.endpointFrame.domainId,a.endpointFrame.domainId);
});

// Each policy has a distinct source and 65 equal, nonterminal reply outcomes.
// Keep the existing fixture's probability contract and actual End transition.
function closureFixture(onClosure=()=>{}){
 const f=fixture({ready:true}),original=f.services.explore,sources=new Map(),closures=[],dispatches=[];
 f.services.candidates=async q=>page(q,[{kind:'move',input:move('enemy')}]);
 f.services.explore=async(i,q)=>{
  dispatches.push({i,q});
  const source=sources.get(q.from);
  if(source){
   closures.push({actor:source.actor,from:q.from});onClosure();
   const e=await original(i,{...q,from:source.key});return {...e,position:{key:q.from}};
  }
  const e=await original(i,q);
  if(i.kind==='endTurn')return e;
  const b=e.outcomes[0];
  return {...e,outcomes:Array.from({length:65},(_,index)=>{
   const key=b.key+':closure:'+index;sources.set(key,{key:b.key,actor:b.observation.actor});
   return {...b,key,p:1/65,active:'B',observation:{...b.observation,active:'B'}};
  })};
 };
 const own=ids=>ids.map(id=>{const tree=f.line(id);return {complete:true,tree,policy:{input:tree.input,secondCost:0},endpoints:tree.ex.outcomes};});
 return {...f,own,closures,dispatches};
}
test('finite reply closes at most 64 of 65 successors per peer and preserves the remaining chance bounds',async t=>{
 t.mock.method(Date,'now',()=>0);
 const {compareOpponentEndValues}=await import('../src/opponent-end-values.mjs');
 for(const ids of [['current','later'],['later','current']]){
  const f=closureFixture(),r=await compareOpponentEndValues(f.o,f.own(ids),f.services,f.inspect,10000,{comparisonScope:'finite-common'});
  assert.equal(r.replyClosureBranchLimit,64);assert.ok(r.valid&&r.finiteDomainComparable);assert.equal(r.stoppedRPC,null);
  for(const id of ids)assert.equal(f.closures.filter(c=>c.actor===id).length,64);
  assert.equal(new Set(f.closures.map(c=>c.from)).size,128);
  for(const p of r.policies){
   assert.ok(Math.abs(p.finiteUnknownChanceMass-1/65)<1e-8);
   assert.ok(p.reasons.includes('reply-End-closure-branch-limit; mass-remains-unknown'));
   assert.ok(p.reasons.includes('reply-unpriced-chance-mass'));assert.equal(p.outsidePoliciesUnverified,true);
  }
  assert.ok(r.bounds.every(b=>b.lower<b.upper));
  assert.ok(f.dispatches.every(({q})=>q.maxOutcomes===128&&q.maxKeep===256&&q.maxLeaves===512&&q.threshold===1e-6&&q.maxMs===1200&&q.decisions==='builtin'));
 }
});
test('the larger finite closure cap still stops at the shared deadline and retains unsearched probability',async t=>{
 let now=0;t.mock.method(Date,'now',()=>now);
 const {compareOpponentEndValues}=await import('../src/opponent-end-values.mjs'),f=closureFixture(()=>{now+=250;});
 const r=await compareOpponentEndValues(f.o,f.own(['current','later']),f.services,f.inspect,900,{comparisonScope:'finite-common'});
 assert.equal(r.replyClosureBranchLimit,64);assert.ok(r.valid);assert.equal(r.finiteDomainComparable,false);assert.equal(r.stoppedRPC,null);
 assert.equal(f.closures.length,4);assert.ok(r.policies.some(p=>p.finiteUnknownChanceMass>1/65));
 assert.ok(r.policies.some(p=>p.domainChecked.some(n=>n.checked<r.domain.length)));
 assert.ok(r.policies.some(p=>p.reasons.includes('reply-End-budget-unavailable')));
 // A peer with only its exact End witness may keep a point interval; the
 // unqueried shared reply domain still makes the entire frame incomparable.
 assert.ok(r.bounds.some(b=>b.lower<b.upper));
});
test('the closure experiment leaves global comparison uncapped and its external-policy uncertainty explicit',async t=>{
 t.mock.method(Date,'now',()=>0);
 const {compareOpponentEndValues}=await import('../src/opponent-end-values.mjs'),f=closureFixture();
 const r=await compareOpponentEndValues(f.o,f.own(['current','later']),f.services,f.inspect,10000);
 assert.equal(r.replyClosureBranchLimit,null);assert.equal(f.closures.length,130);
 assert.ok(r.policies.every(p=>p.finiteUnknownChanceMass<1e-8&&p.outsidePoliciesUnverified));
 assert.ok(r.globalBounds.every(b=>b.lower<=-1660));
 assert.ok(f.dispatches.every(({q})=>q.maxOutcomes===40&&q.maxLeaves===64&&q.maxMs===450));
});
