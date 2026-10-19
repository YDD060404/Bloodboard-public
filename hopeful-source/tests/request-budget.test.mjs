import test from 'node:test';import assert from 'node:assert/strict';
import {requestServices} from '../src/services.mjs';
function fixture({calls=0,positions=0,maxCalls=10,maxPositions=100,fail=null}={}){
 const state={calls,positions,rawCalls:0};
 const raw={capabilities:async()=>({limits:{maxServiceCalls:maxCalls,maxPositions}}),
  diagnostics:async()=>({ok:true,usage:{totalCalls:state.calls,positions:state.positions}}),
  validate:async()=>{state.calls++;state.rawCalls++;return {ok:true,legal:true,position:'root'};},
  threats:{scoring:async()=>{state.calls++;state.rawCalls++;return {ok:true};}},
  explore:async(i,q={})=>{state.calls++;state.rawCalls++;if(fail)return {ok:false,code:fail};
   if(!q.noKeys)state.positions++;
   return {ok:true,exact:true,unresolvedMass:0,rest:{p:0},outcomes:[{p:1,key:q.noKeys?null:'42.'+state.positions,observation:{players:[],score:{A:0,B:0}},completed:true,turnover:false,touchdown:null}]};}};
 const adapter=requestServices(raw,{resourceBudget:true,callReserve:2,positionReserve:2});return {state,adapter};
}
test('actual host usage, including work outside this adapter, reserves final validation calls',async()=>{
 const {adapter:a,state:s}=fixture({calls:7});await a.initialize();
 assert.equal((await a.services.validate({kind:'endTurn'})).ok,true);assert.equal(s.calls,8);
 assert.equal((await a.services.threats.scoring({})).code,'coach-resource-budget');assert.equal(s.calls,8);
 assert.equal((await a.finalServices.validate({kind:'endTurn'})).legal,true);assert.equal(s.calls,9);
 assert.equal((await a.finalServices.validate({kind:'endTurn'})).legal,true);assert.equal(s.calls,10);
 assert.equal((await a.finalServices.validate({kind:'endTurn'})).ok,false);assert.equal(s.calls,10);
});
test('concurrent admissions cannot consume each others reserved call',async()=>{
 const {adapter:a,state:s}=fixture({calls:7});await a.initialize();
 const results=await Promise.all([a.services.validate({}),a.services.validate({})]);
 assert.equal(results.filter(r=>r.ok).length,1);assert.equal(s.calls,8);
});
test('allocation uses actual host position count rather than gaps in position key numbering',async()=>{
 const {adapter:a,state:s}=fixture({positions:3,maxPositions:5});await a.initialize();
 const r=await a.services.explore({kind:'endTurn'},{maxOutcomes:1,maxKeep:1});
 assert.equal(r.code,'coach-resource-budget');assert.equal(s.rawCalls,0);assert.equal(a.snapshot().resourceBudget.stopped,'position-reserve-reached');
});
test('keyless terminal exploration never consumes a position reservation',async()=>{
 const {adapter:a,state:s}=fixture({positions:3,maxPositions:5});await a.initialize();
 assert.equal((await a.services.explore({kind:'endTurn'},{noKeys:true})).ok,true);assert.equal(s.positions,3);
});
test('a real timeout stops subsequent uncached work across namespaces and retains original failure',async()=>{
 const {adapter:a,state:s}=fixture({fail:'timeout'});await a.initialize();
 assert.equal((await a.services.explore({kind:'endTurn'},{})).code,'timeout');
 assert.equal((await a.services.threats.scoring({})).code,'coach-resource-budget');assert.equal(s.rawCalls,1);
 assert.equal(a.snapshot().serviceFailures.count,1);assert.equal(a.snapshot().resourceBudget.stopped,'host-timeout');
 assert.equal((await a.finalServices.validate({kind:'endTurn'})).legal,true);
});
test('already complete cached evidence remains usable without spending more host calls',async()=>{
 const {adapter:a,state:s}=fixture({maxCalls:3});await a.initialize();const input={kind:'endTurn'},q={maxOutcomes:1,maxKeep:1};
 assert.equal((await a.services.explore(input,q)).ok,true);assert.equal(s.calls,1);
 assert.equal((await a.services.explore(input,q)).ok,true);assert.equal(s.calls,1);
 assert.equal((await a.services.validate({})).code,'coach-resource-budget');
});
test('unverifiable public budget values stop speculative work rather than manufacture a larger allowance',async()=>{
 const a=requestServices({capabilities:async()=>({limits:{maxServiceCalls:Infinity,maxPositions:4000}}),diagnostics:async()=>({ok:true,usage:{totalCalls:0,positions:0}}),validate:async()=>{throw Error('must not send');}},{resourceBudget:true});
 await a.initialize();assert.equal((await a.services.validate({})).code,'coach-resource-budget');assert.equal(a.snapshot().resourceBudget.verified,false);
});
