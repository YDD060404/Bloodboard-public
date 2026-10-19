import test from 'node:test';
import assert from 'node:assert/strict';
import {requestServices,guardLiveExplore,markRetainedDirectOptions} from '../src/services.mjs';
const players=[{id:'A8',team:'A'},{id:'B2',team:'B'}];
const input={kind:'playerAction',playerId:'B2',action:'blitz',path:[],blitzTarget:'A8',blockTarget:'A8'};
const options=(deadline=10000)=>({from:'104.4576',team:'B',perspective:'A',observations:true,noKeys:false,decisions:'builtin',maxOutcomes:128,maxKeep:256,maxLeaves:512,threshold:1e-6,maxMs:191,coachEnumerationDeadline:deadline});
const clock=async fn=>{const original=Date.now;Date.now=()=>1000;try{await fn();}finally{Date.now=original;}};
async function setup({cap=15000,serviceMs=108000,missingService=false,floor=3000,held=false}={}){
 let diagnostics=0,validations=0;const calls=[];
 const raw={capabilities:async()=>({limits:{maxServiceCalls:12000,maxPositions:8000,...(cap===null?{}:{maxCallMs:cap})}}),
  diagnostics:async()=>{const n=++diagnostics;return {ok:true,usage:{totalCalls:0,positions:0},...(missingService?{}:{limitsLeft:{leaves:2000000,serviceMs:typeof serviceMs==='function'?serviceMs(n):serviceMs}})};},
  validate:async(i,q)=>{validations++;return {ok:true,legal:true,position:q.from};},
  explore:async(i,q)=>{calls.push(q);return {ok:true,exact:false,rest:{p:.2},unresolvedMass:.1,position:{key:q.from},outcomes:[],applied:{maxMs:q.maxMs}};}};
 const adapter=requestServices(raw,{deadline:100000,resourceBudget:true,callReserve:0,positionReserve:0});await adapter.initialize();
 const guard=guardLiveExplore(adapter.services,'A',players,{deadline:100000,commonReserveMs:15000,complexTimeExtension:true,complexMinDispatchMs:floor,heldDirectTimeExtension:held});
 return {adapter,guard,calls,diagnostics:()=>diagnostics,validations:()=>validations};
}
const refused=(f,r,reason='complex-enumeration-budget-unavailable')=>{assert.equal(r.ok,false);assert.equal(r.code,'coach-live-explore-refused');assert.equal(r.reason,reason);assert.equal(f.calls.length,0);assert.equal(f.adapter.snapshot().serviceFailures.count,0);assert.equal('outcomes' in r,false);assert.equal('rest' in r,false);};

test('actual service allowance2000 above reserve refuses before validation rather than accepting raw191',async()=>clock(async()=>{
 const f=await setup({serviceMs:17000});refused(f,await f.guard.services.explore(input,options()));assert.equal(f.validations(),0);
 assert.equal(f.guard.snapshot().complexTimeSamples[0].serviceMsLeft,17000);
}));

test('actual native maxCall2500 refuses despite sufficient caller/service window',async()=>clock(async()=>{
 const f=await setup({cap:2500});refused(f,await f.guard.services.explore(input,options()));assert.equal(f.validations(),0);assert.equal(f.guard.snapshot().complexTimeSamples[0].maxCallMs,2500);
}));

for(const settings of [{cap:null},{missingService:true}])test('missing public native budget rejects unknown '+JSON.stringify(settings),async()=>clock(async()=>{
 const f=await setup(settings);refused(f,await f.guard.services.explore(input,options()),'complex-service-budget-unverified');assert.equal(f.validations(),0);
}));

test('after-validation actual service reduction rejects independently of initial allocation',async()=>clock(async()=>{
 const f=await setup({serviceMs:n=>n>=3?17000:24000});refused(f,await f.guard.services.explore(input,options()));assert.equal(f.validations(),1);assert.equal(f.diagnostics(),3);assert.equal(f.guard.snapshot().complexTimeSamples[0].stage,'after-validation');
}));

test('actual adapter refresh can reduce service headroom below3000 and must not dispatch or reserve handles',async()=>clock(async()=>{
 const f=await setup({serviceMs:n=>n>=4?17000:24000});refused(f,await f.guard.services.explore(input,options()));assert.equal(f.validations(),1);assert.equal(f.diagnostics(),4);assert.equal(f.adapter.snapshot().resourceBudget.callsUsed,1);
 const s=f.adapter.snapshot().candidateServiceCosts;assert.equal(s.parameters.filter(r=>s.methods[r[1]]==='explore').length,0);
}));

test('exact host cap3000 and service18000 with reserve15000 dispatch3000 preserving residual evidence',async()=>clock(async()=>{
 const f=await setup({cap:3000,serviceMs:18000});const r=await f.guard.services.explore(input,options());assert.equal(f.calls.length,1);assert.equal(f.calls[0].maxMs,3000);assert.equal(f.diagnostics(),4);assert.equal(r.rest.p,.2);assert.equal(r.unresolvedMass,.1);assert.equal(r.exact,false);
 assert.equal('minimumMs' in f.calls[0],false);assert.equal('reserveServiceMs' in f.calls[0],false);
}));

test('floor default0 retains native191 path without extra guard budget queries',async()=>clock(async()=>{
 const f=await setup({floor:0,cap:2500,serviceMs:2000});await f.guard.services.explore(input,options(1231));assert.equal(f.calls[0].maxMs,191);assert.equal(f.diagnostics(),2);assert.equal(f.guard.snapshot().complexTimeSamples[0].serviceMsLeft,undefined);
}));

test('heldDirect1500 remains its independent private-provenance path despite complex floor3000',async()=>clock(async()=>{
 const f=await setup({held:true,cap:15000,serviceMs:50000});const o={from:'104.4576',team:'B',perspective:'A',observations:true,decisions:'builtin',maxOutcomes:20,maxKeep:256,maxLeaves:1800,threshold:.0001,maxMs:550};
 markRetainedDirectOptions(o,{valid:true,source:'champion-retainedDirectScore',sourceKey:o.from,actorId:'B2',holderId:'B2',team:'B',perspective:'A',requestId:104,retainedP:1,outerDeadline:9000,hardDeadline:9000,heldSoftDeadline:1700});
 const r=await f.guard.services.explore(input,o);assert.equal(f.calls[0].maxMs,1500);assert.equal(f.diagnostics(),3);assert.equal(f.guard.snapshot().complexTimeSamples.length,0);assert.equal(f.guard.snapshot().heldDirectExtended,1);assert.equal(r.rest.p,.2);
}));
