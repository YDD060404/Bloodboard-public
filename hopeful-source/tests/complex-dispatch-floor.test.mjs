import test from 'node:test';
import assert from 'node:assert/strict';
import {requestServices,guardLiveExplore,withServiceOwner} from '../src/services.mjs';

// Fresh fake clock and pure service mocks only; never a runtime/worker import.
const players=[{id:'A8',team:'A'},{id:'B2',team:'B'}];
const input=(action='blitz')=>({kind:'playerAction',playerId:'B2',action,path:[],blitzTarget:'A8',blockTarget:'A8'});
const opts=(deadline)=>({from:'104.4576',team:'B',perspective:'A',observations:true,noKeys:false,decisions:'builtin',maxOutcomes:128,maxKeep:256,maxLeaves:512,threshold:1e-6,maxMs:191,...(deadline===null?{}:{coachEnumerationDeadline:deadline})});
const clock=async run=>{const original=Date.now;let now=1000;Date.now=()=>now;try{await run({now:()=>now,advance:ms=>now+=ms});}finally{Date.now=original;}};
const eventRows=adapter=>{const s=adapter.snapshot().candidateServiceCosts;return s.events.map(r=>({phase:r[0],method:s.methods[r[1]],status:s.statuses[r[2]],reason:s.reasons[r[3]],count:r[4]}));};
async function fixture({advance=()=>{},validateMs=0,diagnosticsMs=0,floor=3000,globalDeadline=100000,reserveMs=0,negative=null}={}){
 const calls=[],validations=[];let diagnostics=0;
 const raw={capabilities:async()=>({limits:{maxServiceCalls:12000,maxPositions:8000,maxCallMs:15000}}),
  diagnostics:async()=>{if(++diagnostics===4)advance(diagnosticsMs);return {ok:true,usage:{totalCalls:0,positions:0},limitsLeft:{leaves:2000000,serviceMs:108000}};},
  validate:async(i,q)=>{validations.push({i,q});advance(validateMs);return {ok:true,legal:true,position:q.from};},
  explore:async(i,q)=>{calls.push({i,q});return negative??{ok:true,exact:true,outcomeIdentity:'complete-state-v1',position:{key:q.from},perspective:'A',activeTeam:'B',unresolvedMass:0,rest:{p:0},outcomes:[{p:1,key:'104.5000',observation:{active:'A',phase:'play'},completed:true,turnover:false}]};}};
 const adapter=requestServices(raw,{deadline:globalDeadline,resourceBudget:true,callReserve:0,positionReserve:0});await adapter.initialize();
 const guard=guardLiveExplore(adapter.services,'A',players,{deadline:globalDeadline,commonReserveMs:reserveMs,complexTimeExtension:true,...(floor===null?{}:{complexMinDispatchMs:floor})});
 return {calls,validations,adapter,guard};
}
const refused=(f,r)=>{assert.equal(r.ok,false);assert.equal(r.code,'coach-live-explore-refused');assert.equal(r.reason,'complex-enumeration-budget-unavailable');assert.equal(r.scope,'local source legality or enumeration budget refusal; no chance law, value or host explore RPC');assert.equal(f.calls.length,0);assert.equal(f.adapter.snapshot().serviceFailures.count,0);assert.ok(eventRows(f.adapter).some(r=>r.method==='explore'&&r.status==='local-refusal'));assert.equal(eventRows(f.adapter).filter(r=>r.method==='explore'&&r.status==='raw-dispatched').length,0);};

test('qualified finite reply raw191 dispatches3000 with all other original native parameters',async()=>clock(async()=>{
 const f=await fixture(),o=Object.freeze(opts(10000));const r=await f.guard.services.explore(input(),o);
 assert.equal(r.ok,true);assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].q,{...opts(null),maxMs:3000});assert.equal(o.maxMs,191);
 assert.equal(f.guard.snapshot().complexMinDispatchMs,3000);assert.equal(f.guard.snapshot().complexTimeSamples[0].minimumDispatchMs,3000);
 assert.equal('minimumMs' in f.calls[0].q,false);assert.equal('coachEnumerationDeadline' in f.calls[0].q,false);
}));

test('default0 retains the old qualified191 tail allocation',async()=>clock(async()=>{
 const f=await fixture({floor:null});const r=await f.guard.services.explore(input(),opts(1231));
 assert.equal(r.ok,true);assert.equal(f.calls[0].q.maxMs,191);assert.equal(f.guard.snapshot().complexMinDispatchMs,0);
}));

test('2999 caller budget rejects before native validate/explore without manufacturing chance',async()=>clock(async()=>{
 const f=await fixture();const r=await f.guard.services.explore(input(),opts(4039));refused(f,r);assert.equal(f.validations.length,0);assert.equal('rest' in r,false);assert.equal('outcomes' in r,false);
}));

test('post-validate2999 caller budget refuses; initial allocation does not certify dispatch',async()=>clock(async({advance})=>{
 const f=await fixture({advance,validateMs:961});const r=await f.guard.services.explore(input(),opts(5000));refused(f,r);assert.equal(f.validations.length,1);assert.equal(f.guard.snapshot().complexTimeSamples[0].stage,'after-validation');
}));

test('post-diagnostics2999 budget refuses before admission and does not leak reserved handles',async()=>clock(async({advance})=>{
 const f=await fixture({advance,diagnosticsMs:961});const r=await withServiceOwner(f.guard.services,{phaseId:'formal'}).explore(input(),opts(5000));refused(f,r);
 assert.equal(f.adapter.snapshot().resourceBudget.callsUsed,1);assert.equal(f.adapter.snapshot().candidateServiceCosts.parameters.some(r=>r[1]===f.adapter.snapshot().candidateServiceCosts.methods.indexOf('explore')),false);
 // A fresh valid window on the same adapter must still dispatch once.
 const next=await f.guard.services.explore(input(),opts(Date.now()+5000));assert.equal(next.ok,true);assert.equal(f.calls.length,1);
}));

for(const validationMs of [0,1])test('exact3000 post-validation boundary permits original full enumeration '+validationMs,async()=>clock(async({advance})=>{
 const f=await fixture({advance,validateMs:validationMs});const r=await f.guard.services.explore(input(),opts(4040+validationMs));assert.equal(r.ok,true);assert.equal(f.calls[0].q.maxMs,3000);
}));

test('global reserved window below3000 cannot be borrowed from caller or other peers',async()=>clock(async()=>{
 const f=await fixture({globalDeadline:19039,reserveMs:15000});const r=await f.guard.services.explore(input(),opts(100000));refused(f,r);assert.equal(f.validations.length,0);
}));

test('foreign unscoped complex and noncomplex paths are unchanged',async()=>clock(async()=>{
 const f=await fixture();await f.guard.services.explore(input(),opts(null));assert.equal(f.calls[0].q.maxMs,191);assert.equal(f.guard.snapshot().complexUnscopedCalls,1);
 await f.guard.services.explore(input('move'),opts(1231));assert.equal(f.calls[1].q.maxMs,191);
}));

test('original request above3000 is never shrunk to the floor',async()=>clock(async()=>{
 const f=await fixture();refused(f,await f.guard.services.explore(input(),{...opts(4040),maxMs:3100}));
}));

test('same adapter owner views share completed cache; minimum metadata never becomes cache/native options',async()=>clock(async()=>{
 const f=await fixture();const a=withServiceOwner(f.guard.services,{phaseId:'a'}),b=withServiceOwner(f.guard.services,{phaseId:'b'});
 await a.explore(input(),opts(10000));await b.explore(input(),opts(10000));assert.equal(f.calls.length,1);assert.equal(f.adapter.snapshot().hits,1);assert.ok(eventRows(f.adapter).some(r=>r.phase==='b'&&r.status==='cache-hit'));assert.equal(f.guard.snapshot().complexTimeExtended,2);
}));

test('true native negative is returned unchanged and remains an adapter failure',async()=>clock(async()=>{
 const negative={ok:false,code:'timeout',message:'real native timeout',errors:['real native timeout'],partialEvidence:null};const f=await fixture({negative});
 assert.equal(await f.guard.services.explore(input(),opts(10000)),negative);assert.equal(f.calls[0].q.maxMs,3000);assert.equal(f.adapter.snapshot().serviceFailures.count,1);assert.equal(f.guard.snapshot().complexBudgetRefusals,0);
}));
