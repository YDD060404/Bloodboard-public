import test from 'node:test';
import assert from 'node:assert/strict';
import {guardLiveExplore,requestServices,boundedProducerServices} from '../src/services.mjs';
import {E,Session,callService} from './deps/archived-v6-host.mjs';
const input={kind:'playerAction',playerId:'p',action:'move',path:[{kind:'step',to:{x:8,y:7}}]};
test('actual occupied-square validation refuses frozen search before chance RPC',async()=>{
 const state=E.buildScenario({teams:{A:'human',B:'human'},players:[{id:'p',team:'A',roster:'human',position:'lineman',at:[7,7],number:1},{id:'q',team:'A',roster:'human',position:'lineman',at:[8,7],number:2}]},7);
 const session=new Session(state,'A',1,60000);let explored=0;
 const g=guardLiveExplore({validate:async(...args)=>callService(session,'validate',args),explore:async()=>{explored++;throw Error('illegal chance must not be requested');}},'A');
 const r=await g.services.explore(input,{observations:true});assert.equal(explored,0);assert.equal(r.code,'coach-live-explore-refused');assert.equal(r.reason,'input-illegal');assert.equal(r.outcomes,undefined);assert.equal(g.snapshot().illegal,1);assert.match(g.snapshot().samples[0].errors[0],/occupied/);
});
test('retained source and opponent team are checked and original options survive',async()=>{
 const opts={from:'9.3',team:'B',perspective:'A',maxLeaves:512};let seen;
 const expected={ok:true,exact:false,unresolvedMass:1};
 const g=guardLiveExplore({validate:async(i,o)=>{assert.equal(i,input);assert.deepEqual(o,{from:'9.3',team:'B'});return {ok:true,position:'9.3',legal:true};},explore:async(i,o)=>{seen=o;return expected;}},'A',[{id:'p',team:'B'}]);
 assert.equal(await g.services.explore(input,opts),expected);assert.equal(seen,opts);assert.equal(g.snapshot().checked,1);
});
test('foreign source, missing legality, missing validator and RPC failure never fabricate a law',async()=>{
 for(const v of [{ok:true,position:'root',legal:true},{ok:true,position:'9.3'},{ok:false,code:'call-cap'}]){
  const g=guardLiveExplore({validate:async()=>v,explore:async()=>{throw Error('must not explore');}},'A');const r=await g.services.explore(input,{from:'9.3'});assert.equal(r.reason,'source-legality-unverified');assert.equal(r.outcomes,undefined);assert.equal(g.snapshot().unverified,1);
 }
 const g=guardLiveExplore({explore:async()=>{throw Error('must not explore');}},'A');assert.equal((await g.services.explore(input)).reason,'validator-unavailable');
 const throwing=guardLiveExplore({validate:async()=>{throw Error('transport failed');}},'A');await assert.rejects(throwing.services.explore(input),/transport failed/);
});

test('native validate ignores team: explicit team must match the public actor before explore',async()=>{
 let validates=0,explores=0;const g=guardLiveExplore({validate:async()=>{validates++;return {ok:true,position:'root',legal:true};},explore:async()=>{explores++;}},'A',[{id:'p',team:'A'}]);
 assert.equal((await g.services.explore(input,{team:'B'})).reason,'explicit-team-mismatch');
 assert.equal((await g.services.explore({...input,playerId:'unknown'},{team:'A'})).reason,'actor-team-unverified');
 assert.equal(validates,0);assert.equal(explores,0);
});

test('producer charges validation and explore together while final validation keeps its reserve',async()=>{
 let calls=0;const raw={capabilities:async()=>({limits:{maxServiceCalls:5,maxPositions:100,maxOutcomesPerCall:40}}),diagnostics:async()=>({ok:true,usage:{totalCalls:calls,positions:0}}),validate:async()=>{calls++;return {ok:true,position:'root',legal:true};},explore:async()=>{calls++;return {ok:true};}};
 const adapter=requestServices(raw,{resourceBudget:true,callReserve:1,positionReserve:0,cache:false});await adapter.initialize();
 const g=guardLiveExplore(adapter.services,'A',[{id:'p',team:'A'}]);const producer=boundedProducerServices(g.services,{calls:3});
 assert.equal((await producer.services.explore(input,{maxMs:200,noKeys:true})).ok,true);assert.equal(calls,2);assert.equal(producer.report.calls,2);assert.equal(producer.report.logicalCalls,1);
 assert.equal((await producer.services.explore(input,{maxMs:200,noKeys:true})).code,'coach-producer-budget');assert.equal(calls,2);
 await adapter.services.validate(input);await adapter.services.validate(input);assert.equal((await adapter.services.validate(input)).code,'coach-resource-budget');
 assert.equal((await adapter.finalServices.validate(input)).ok,true);assert.equal(calls,5);assert.equal(adapter.stats.rpcCalls,5);
});

test('Pass gets time headroom while original leaf/mass response and non-Pass options remain unchanged',async()=>{
 const pass={...input,action:'pass',passTarget:{x:5,y:7}},opts={maxMs:1300,maxLeaves:3500,maxOutcomes:40,observations:true};let seen;const actual={ok:true,exact:false,unresolvedMass:.18,rest:{p:.32}};
 const g=guardLiveExplore({validate:async()=>({ok:true,position:'root',legal:true}),explore:async(i,o)=>{seen=o;return actual;}},'A',[{id:'p',team:'A'}],{deadline:Date.now()+120000});
 assert.equal(await g.services.explore(pass,opts),actual);assert.equal(seen.maxMs,5200);assert.equal(seen.maxLeaves,3500);assert.equal(opts.maxMs,1300);assert.equal(g.snapshot().passTimeExtended,1);
 await g.services.explore(input,opts);assert.equal(seen,opts);
});
test('Pass refuses insufficient common/producer slots without explore or fabricated chance',async()=>{
 const pass={...input,action:'pass'};for(const extra of [{deadline:Date.now()+20000},{deadline:Date.now()+120000,slot:Date.now()+1000}]){
  let explored=0;const g=guardLiveExplore({validate:async()=>({ok:true,position:'root',legal:true}),explore:async()=>{explored++;}},'A',[{id:'p',team:'A'}],{deadline:extra.deadline});
  const r=await g.services.explore(pass,{maxMs:1300,maxLeaves:3500,...(extra.slot?{coachEnumerationDeadline:extra.slot}:{})});assert.equal(r.reason,'pass-enumeration-budget-unavailable');assert.equal(r.outcomes,undefined);assert.equal(explored,0);assert.equal(g.snapshot().passBudgetRefusals,1);
 }
});
test('scoped deadline is stripped before native RPC and sufficient Pass slot retains its enumeration scale',async()=>{
 let native;const g=guardLiveExplore({validate:async()=>({ok:true,position:'root',legal:true}),explore:async(i,o)=>{native=o;return {ok:true};}},'A',[{id:'p',team:'A'}],{deadline:Date.now()+120000});
 await g.services.explore({...input,action:'pass'},{maxMs:1300,maxLeaves:3500,coachEnumerationDeadline:Date.now()+6000});assert.equal('coachEnumerationDeadline' in native,false);assert.equal(native.maxMs,5200);assert.equal(native.maxLeaves,3500);
});

test('Pass extension stays inside a real policy slot and never borrows peer time',async()=>{
 let native;const slot=Date.now()+2100;const g=guardLiveExplore({validate:async()=>({ok:true,position:'root',legal:true}),explore:async(i,o)=>{native=o;return {ok:true};}},'A',[{id:'p',team:'A'}],{deadline:Date.now()+120000});
 const r=await g.services.explore({...input,action:'pass'},{maxMs:1500,maxLeaves:4000,coachEnumerationDeadline:slot});
 assert.equal(r.ok,true);assert.ok(native.maxMs>=1500&&native.maxMs<=2060);assert.ok(Date.now()+native.maxMs<=slot);assert.equal(native.maxLeaves,4000);assert.equal('coachEnumerationDeadline' in native,false);assert.equal(g.snapshot().passTimeSlotCapped,1);
});
test('producer preserves the earlier nested policy deadline',async()=>{
 let seen;const slot=Date.now()+2000;const producer=boundedProducerServices({exploreLegalityValidation:true,explore:async(i,o)=>{seen=o;return {ok:true};}},{deadline:Date.now()+9000});
 await producer.services.explore({...input,action:'pass'},{maxMs:1500,coachEnumerationDeadline:slot});assert.equal(seen.coachEnumerationDeadline,slot);
});

test('A7 Blitz at 230.1461 refuses a 113ms local slot for the original 1200ms request',async t=>{
 t.mock.method(Date,'now',()=>10000);let validates=0,nativeExplores=0;
 const blitz={kind:'playerAction',playerId:'A7',action:'blitz',path:[],blitzTarget:'B4'};
 const g=guardLiveExplore({validate:async()=>{validates++;return {ok:true,position:'230.1461',legal:true};},explore:async()=>{nativeExplores++;return {ok:true};}},'B',[{id:'A7',team:'A'}]);
 const r=await g.services.explore(blitz,{from:'230.1461',team:'A',perspective:'B',maxMs:1200,maxLeaves:512,maxOutcomes:128,maxKeep:256,threshold:.000001,observations:true,coachEnumerationDeadline:10113});
 assert.equal(r.reason,'complex-enumeration-budget-unavailable');assert.deepEqual(r.position,{key:'230.1461'});assert.equal(r.code,'coach-live-explore-refused');
 assert.equal(r.outcomes,undefined);assert.equal(r.chance,undefined);assert.equal(validates,0);assert.equal(nativeExplores,0);
 assert.equal(g.snapshot().complexBudgetRefusals,1);assert.equal(g.snapshot().illegal,0);assert.equal(g.snapshot().unverified,0);assert.equal(g.snapshot().passBudgetRefusals,0);
});

test('Block and Blitz recheck the local window consumed by their existing validate for both roles',async t=>{
 let now=10000;t.mock.method(Date,'now',()=>now);
 for(const action of ['block','blitz'])for(const team of ['A','B']){
  now=10000;let validates=0,nativeExplores=0;const perspective=team==='A'?'B':'A',from='230.1461';
  const g=guardLiveExplore({validate:async(i,o)=>{validates++;assert.deepEqual(o,{from,team});now+=61;return {ok:true,position:from,legal:true};},explore:async()=>{nativeExplores++;}},perspective,[{id:'p',team}]);
  const r=await g.services.explore({...input,action},{from,team,perspective,maxMs:1200,coachEnumerationDeadline:11300});
  assert.equal(r.reason,'complex-enumeration-budget-unavailable');assert.deepEqual(r.position,{key:from});assert.equal(r.outcomes,undefined);
  assert.equal(validates,1);assert.equal(nativeExplores,0);assert.equal(g.snapshot().complexBudgetRefusals,1);assert.equal(g.snapshot().illegal,0);assert.equal(g.snapshot().unverified,0);
 }
});

test('sufficient complex slots admit unchanged enumeration scale and strip the internal deadline for both roles',async t=>{
 let now=10000;t.mock.method(Date,'now',()=>now);
 for(const action of ['block','blitz'])for(const team of ['A','B']){
  now=10000;let validates=0,nativeExplores=0;const perspective=team==='A'?'B':'A',from='230.1461';
  const expected={ok:true,exact:false,unresolvedMass:.4,rest:{p:.4},outcomes:[{p:.6,key:'230.1462'}]};
  const original={from,team,perspective,maxMs:1200,maxLeaves:512,maxOutcomes:128,maxKeep:256,threshold:.000001,observations:true,decisions:'builtin',noKeys:true,coachEnumerationDeadline:11300};
  const {coachEnumerationDeadline,...nativeOptions}=original;
  const g=guardLiveExplore({validate:async(i,o)=>{validates++;assert.deepEqual(o,{from,team});now+=60;return {ok:true,position:from,legal:true};},explore:async(i,o)=>{nativeExplores++;assert.deepEqual(o,nativeOptions);assert.equal(Object.hasOwn(o,'coachEnumerationDeadline'),false);return expected;}},perspective,[{id:'p',team}],{deadline:10000});
  assert.equal(await g.services.explore({...input,action},original),expected);assert.equal(original.coachEnumerationDeadline,11300);
  assert.equal(validates,1);assert.equal(nativeExplores,1);assert.equal(g.snapshot().complexBudgetRefusals,0);
 }
});

test('complex local admission honors the 50ms host minimum without shrinking the request',async t=>{
 t.mock.method(Date,'now',()=>10000);
 for(const action of ['block','blitz'])for(const slot of [89,90]){
  let nativeExplores=0;const g=guardLiveExplore({validate:async()=>({ok:true,position:'root',legal:true}),explore:async(i,o)=>{nativeExplores++;assert.equal(o.maxMs,40);return {ok:true};}},'A');
  const r=await g.services.explore({...input,action},{maxMs:40,coachEnumerationDeadline:10000+slot});
  assert.equal(nativeExplores,slot===90?1:0);assert.equal(r.reason,slot===90?undefined:'complex-enumeration-budget-unavailable');
 }
});

test('complex budget recheck preserves source legality errors and transport failures',async t=>{
 let now=10000;t.mock.method(Date,'now',()=>now);
 for(const validation of [{ok:true,position:'230.1461',legal:false},{ok:true,position:'wrong',legal:true},{ok:false,code:'call-cap'}]){
  now=10000;const g=guardLiveExplore({validate:async()=>{now+=100;return validation;},explore:async()=>{throw Error('must not explore');}},'A');
  const r=await g.services.explore({...input,action:'blitz'},{from:'230.1461',maxMs:1200,coachEnumerationDeadline:11300});
  assert.equal(r.reason,validation.legal===false?'input-illegal':'source-legality-unverified');assert.equal(g.snapshot().complexBudgetRefusals,0);
 }
 now=10000;const throwing=guardLiveExplore({validate:async()=>{now+=100;throw Error('transport failed');}},'A');
 await assert.rejects(throwing.services.explore({...input,action:'block'},{maxMs:1200,coachEnumerationDeadline:11300}),/transport failed/);assert.equal(throwing.snapshot().complexBudgetRefusals,0);
});

test('complex actions without finite local deadline or maxMs and ordinary actions retain previous admission',async t=>{
 t.mock.method(Date,'now',()=>10000);
 const cases=[...['block','blitz'].flatMap(action=>[{action,options:{maxMs:1200}},{action,options:{maxMs:1200,coachEnumerationDeadline:Infinity}},{action,options:{coachEnumerationDeadline:10001}},{action,options:{maxMs:Infinity,coachEnumerationDeadline:10001}}]),{action:'move',options:{maxMs:1200,coachEnumerationDeadline:10001}}];
 for(const {action,options} of cases){
  let nativeExplores=0;const {coachEnumerationDeadline,...nativeOptions}=options;
  const g=guardLiveExplore({validate:async()=>({ok:true,position:'root',legal:true}),explore:async(i,o)=>{nativeExplores++;assert.deepEqual(o,nativeOptions);return {ok:true};}},'A',[],{deadline:10000});
  assert.equal((await g.services.explore({...input,action},options)).ok,true);assert.equal(nativeExplores,1);assert.equal(g.snapshot().complexBudgetRefusals,0);
 }
});
