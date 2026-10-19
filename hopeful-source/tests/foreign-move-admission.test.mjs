import test from 'node:test';
import assert from 'node:assert/strict';
import {guardLiveExplore,requestServices,markRetainedDirectOptions,withServiceOwner} from '../src/services.mjs';

// SOURCE-only preparation: pure service/clock mocks, no runtime or worker imports.
// These fixtures cannot certify native applied time, chance completion or strength.
const players=[{id:'A8',team:'A'},{id:'B8',team:'B'}];
const move={kind:'playerAction',playerId:'B8',action:'move',path:Array.from({length:9},(_,i)=>({kind:'step',to:{x:8-i,y:0}}))};
const options=(deadline=10000)=>({from:'278.7492',team:'B',perspective:'A',observations:true,decisions:'builtin',
 maxOutcomes:20,maxKeep:256,maxLeaves:64,threshold:1e-4,maxMs:500,...(deadline===null?{}:{coachEnumerationDeadline:deadline})});
const clock=async fn=>{const original=Date.now;let now=1000;Date.now=()=>now;try{await fn({advance:ms=>now+=ms,now:()=>now});}finally{Date.now=original;}};
async function fixture({advance=()=>{},validateMs=0,diagnosticsMs=0,diagnosticsAt=4,cap=15000,serviceMs=108000,missingService=false,
 enabled=true,globalDeadline=100000,validation=null,native=null,held=false}={}){
 let diagnostics=0;const explores=[],validations=[];
 const raw={capabilities:async()=>({limits:{maxServiceCalls:12000,maxPositions:8000,...(cap===null?{}:{maxCallMs:cap})}}),
  diagnostics:async()=>{const n=++diagnostics;if(n===diagnosticsAt)advance(diagnosticsMs);
   return {ok:true,usage:{totalCalls:0,positions:0},...(missingService?{}:{limitsLeft:{leaves:2000000,serviceMs:typeof serviceMs==='function'?serviceMs(n):serviceMs}})};},
  validate:async(i,q)=>{validations.push({i,q});advance(validateMs);if(validation instanceof Error)throw validation;
   return validation??{ok:true,legal:true,position:q.from};},
  explore:async(i,q)=>{explores.push({i,q});if(native instanceof Error)throw native;
   return native??{ok:true,exact:false,unresolvedMass:.4,rest:{p:.4},outcomes:[{p:.6,key:'278.7500',active:'A',observation:{active:'A',phase:'play'}}]};}};
 const adapter=requestServices(raw,{deadline:globalDeadline,resourceBudget:true,callReserve:0,positionReserve:0});await adapter.initialize();
 const guard=guardLiveExplore(adapter.services,'A',players,{deadline:globalDeadline,foreignMoveTimeExtension:enabled,heldDirectTimeExtension:held});
 return {adapter,guard,explores,validations,diagnostics:()=>diagnostics};
}
const refusal=(f,r,reason='foreign-move-enumeration-budget-unavailable',expectedServiceFailures=0)=>{
 assert.equal(r.ok,false);assert.equal(r.code,'coach-live-explore-refused');assert.equal(r.reason,reason);
 assert.deepEqual(r.position,{key:'278.7492'});assert.equal('outcomes' in r,false);assert.equal('rest' in r,false);
 assert.equal(f.explores.length,0);assert.equal(f.adapter.snapshot().serviceFailures.count,expectedServiceFailures);
 assert.equal(f.guard.snapshot().complexBudgetRefusals,0);
};
const nativeOptions=o=>{const {coachEnumerationDeadline,coachEnumerationDeadlineSource,...rest}=o;return rest;};

test('actual failed B8 Move9 original500 gets3000 with original law parameters and no invented partial',async()=>clock(async()=>{
 const f=await fixture(),o=Object.freeze(options()),r=await f.guard.services.explore(move,o);
 assert.equal(r.ok,true);assert.equal(f.explores.length,1);assert.equal(f.explores[0].i,move);
 assert.deepEqual(f.explores[0].q,{...nativeOptions(o),maxMs:3000});assert.equal(o.maxMs,500);
 assert.equal(r.exact,false);assert.equal(r.unresolvedMass,.4);assert.equal(r.rest.p,.4);assert.equal('partialEvidence' in r,false);
 const s=f.guard.snapshot();assert.equal(s.foreignMoveCallerQualifiedCalls,1);assert.equal(s.foreignMoveSourceValidatedCalls,1);assert.equal(s.foreignMoveTimeExtended,1);
 assert.equal(s.complexTimeExtended,0);assert.equal(s.foreignMoveTimeSamples[0].family,'foreign-retained-move');
 assert.equal(s.foreignMoveTimeSamples[0].minimumDispatchMs,3000);assert.equal(s.foreignMoveTimeSamples[0].dispatchedMs,3000);
 assert.equal(s.foreignMoveTimeSamples[0].dispatchStatus,'adapter-raw-admission');assert.equal(f.diagnostics(),4);
 assert.equal('minimumMs' in f.explores[0].q,false);assert.equal('reserveServiceMs' in f.explores[0].q,false);
 s.foreignMoveTimeSamples[0].reason='mutated';assert.equal(f.guard.snapshot().foreignMoveTimeSamples[0].reason,null);
}));

test('held caller2600 or original500 window refuses unknown without validation or explore',async()=>clock(async()=>{
 for(const remaining of [500,2600]){const f=await fixture(),r=await f.guard.services.explore(move,options(1000+remaining));
  refusal(f,r);assert.equal(f.validations.length,0);assert.equal(f.guard.snapshot().foreignMoveBudgetRefusals,1);
  assert.equal(f.guard.snapshot().foreignMoveTimeSamples[0].reason,'foreign-move-enumeration-budget-unavailable');}
}));

test('exact caller3000 after40 margin admits while2999 refuses; original larger request is not shrunk',async()=>clock(async()=>{
 const f=await fixture();assert.equal((await f.guard.services.explore(move,options(4040))).ok,true);assert.equal(f.explores[0].q.maxMs,3000);
 const low=await fixture();refusal(low,await low.guard.services.explore(move,options(4039)));
 const larger=await fixture();refusal(larger,await larger.guard.services.explore(move,{...options(4040),maxMs:3100}));
}));

test('validation consumes the real caller window and cannot borrow a peer reserve',async()=>clock(async({advance})=>{
 const f=await fixture({advance,validateMs:961});refusal(f,await f.guard.services.explore(move,options(5000)));
 assert.equal(f.validations.length,1);assert.equal(f.guard.snapshot().foreignMoveTimeSamples[0].stage,'after-validation');
}));

test('budget diagnostics after validation can consume the window before adapter admission',async()=>clock(async({advance})=>{
 const f=await fixture({advance,diagnosticsMs:961});refusal(f,await withServiceOwner(f.guard.services,{phaseId:'move-reply'}).explore(move,options(5000)));
 assert.equal(f.diagnostics(),4);assert.equal(f.validations.length,1);assert.equal(f.adapter.snapshot().resourceBudget.callsUsed,1);
 assert.equal(f.guard.snapshot().foreignMoveTimeSamples[0].dispatchStatus,'local-refusal');
 const next=await f.guard.services.explore(move,options(Date.now()+5000));assert.equal(next.ok,true);assert.equal(f.explores.length,1);
}));

test('actual budget refresh before or after validation recomputes clocks instead of using stale headroom',async()=>clock(async({advance})=>{
 for(const at of [2,3]){const f=await fixture({advance,diagnosticsAt:at,diagnosticsMs:961});
  refusal(f,await f.guard.services.explore(move,options(Date.now()+4000)));assert.equal(f.diagnostics(),at);
  assert.equal(f.validations.length,at===2?0:1);assert.equal(f.guard.snapshot().foreignMoveTimeSamples[0].stage,at===2?'before-validation':'after-validation');
 }
}));

test('actual cap and service reserve insufficient or unverified refuse before validation',async()=>clock(async()=>{
 for(const settings of [{cap:2999},{serviceMs:17999},{cap:null},{missingService:true}]){
  const f=await fixture(settings),unknown=settings.cap===null||settings.missingService;
  refusal(f,await f.guard.services.explore(move,options()),unknown?'foreign-move-service-budget-unverified':'foreign-move-enumeration-budget-unavailable');
  assert.equal(f.validations.length,0);
 }
}));

test('post-validation service headroom and final adapter refreshed headroom independently refuse',async()=>clock(async()=>{
 for(const at of [3,4]){const f=await fixture({serviceMs:n=>n>=at?17999:24000});refusal(f,await f.guard.services.explore(move,options()));
  assert.equal(f.validations.length,1);assert.equal(f.diagnostics(),at);assert.equal(f.explores.length,0);
  if(at===4){assert.equal(f.adapter.snapshot().resourceBudget.callsUsed,1);assert.equal(f.guard.snapshot().foreignMoveTimeSamples[0].dispatchStatus,'local-refusal');}
 }
}));

test('global15000 reserve remains binding and exact cap3000/service18000 admits original residual',async()=>clock(async()=>{
 const short=await fixture({globalDeadline:19039});refusal(short,await short.guard.services.explore(move,options(100000)));
 const f=await fixture({cap:3000,serviceMs:18000}),r=await f.guard.services.explore(move,options());
 assert.equal(f.explores[0].q.maxMs,3000);assert.equal(r.rest.p,.4);assert.equal(r.unresolvedMass,.4);
}));

test('native same-source true legality is mandatory and transport exceptions remain exceptions',async()=>clock(async()=>{
 for(const v of [{ok:true,position:'root',legal:true},{ok:true,position:'278.7492'},{ok:false,code:'native-cap'},
  {ok:true,position:'278.7492',legal:false}]){const f=await fixture({validation:v});
  refusal(f,await f.guard.services.explore(move,options()),v.legal===false?'input-illegal':'source-legality-unverified',v.ok===false?1:0);assert.equal(f.validations.length,1);
 }
 const error=Error('actual validate transport failure'),f=await fixture({validation:error});
 await assert.rejects(f.guard.services.explore(move,options()),e=>e===error);assert.equal(f.explores.length,0);
}));

test('default disabled and ineligible root/own/unscoped/perspective/pos calls preserve original native parameters',async()=>clock(async()=>{
 const cases=[{enabled:false},{patch:{from:'root'}},{input:{...move,playerId:'A8'},patch:{team:'A'}},
  {patch:{coachEnumerationDeadline:undefined}},{patch:{coachEnumerationDeadline:Infinity}},{patch:{perspective:undefined}},
  {patch:{perspective:'B'}},{patch:{team:undefined}},{patch:{pos:{override:true}}},{patch:{pos:undefined}},
  {patch:{from:'foreign-invalid-key'}},{patch:{observations:false}},{patch:{decisions:'solve'}}];
 for(const c of cases){const f=await fixture({enabled:c.enabled??true}),o={...options(1500),...c.patch};
  assert.equal((await f.guard.services.explore(c.input??move,o)).ok,true);assert.deepEqual(f.explores[0].q,nativeOptions(o));
  assert.equal(f.guard.snapshot().foreignMoveCallerQualifiedCalls,0);assert.equal(f.guard.snapshot().foreignMoveTimeExtended,0);
  assert.equal(f.diagnostics(),2);
 }
}));

test('wrong explicit public team retains prior refusal and never becomes qualified Move',async()=>clock(async()=>{
 const f=await fixture(),r=await f.guard.services.explore(move,{...options(),team:'A'});
 assert.equal(r.reason,'explicit-team-mismatch');assert.equal(f.validations.length,0);assert.equal(f.explores.length,0);
 assert.equal(f.guard.snapshot().foreignMoveCallerQualifiedCalls,0);
}));

test('formal out40/128 and varying leaf/threshold parameters survive without hardcoded Move9 signature',async()=>clock(async()=>{
 for(const [out,leaves,threshold,noKeys=false] of [[40,64,1e-6],[128,512,1e-6],[8,3500,.001],[128,512,1e-6,true]]){
  const f=await fixture(),o={...options(),maxOutcomes:out,maxLeaves:leaves,threshold,maxMs:1200,noKeys};
  const shortMove={...move,path:move.path.slice(0,2)};await f.guard.services.explore(shortMove,o);
  assert.deepEqual(f.explores[0].q,{...nativeOptions(o),maxMs:4800});assert.equal(f.explores[0].i,shortMove);
 }
}));

test('true native timeout/null partial and unknown law preserve actual response identity and failure accounting',async()=>clock(async()=>{
 const negative={ok:false,code:'timeout',message:'actual native timeout',timedOut:true,partialEvidence:null},f=await fixture({native:negative});
 assert.equal(await f.guard.services.explore(move,options()),negative);assert.equal(f.adapter.snapshot().serviceFailures.count,1);
 assert.equal(f.guard.snapshot().foreignMoveBudgetRefusals,0);assert.equal(f.explores[0].q.maxLeaves,64);
 const unknown={ok:true,exact:false,unresolvedMass:1,rest:{p:1},outcomes:[]},u=await fixture({native:unknown});
 assert.equal(await u.guard.services.explore(move,options()),unknown);assert.equal(u.adapter.snapshot().serviceFailures.count,0);
 const error=Error('actual explore transport failure'),e=await fixture({native:error});await assert.rejects(e.guard.services.explore(move,options()),x=>x===error);
}));

test('existing heldDirect1800/1500 profile is separate and is never raised by Move admission',async()=>clock(async()=>{
 const f=await fixture({held:true}),o=markRetainedDirectOptions({from:'278.7492',team:'B',perspective:'A',observations:true,
  decisions:'builtin',maxOutcomes:20,maxKeep:256,maxLeaves:1800,threshold:1e-4,maxMs:550,
  coachEnumerationDeadline:10000,coachEnumerationDeadlineSource:'champion-held-reply-deadline'},
  {valid:true,sourceKey:'278.7492',actorId:'B8',team:'B',perspective:'A',outerDeadline:100000,hardDeadline:100000,heldSoftDeadline:10000});
 await f.guard.services.explore(move,o);assert.equal(f.explores[0].q.maxMs,1500);assert.equal(f.explores[0].q.maxLeaves,1800);
 assert.equal(f.guard.snapshot().foreignMoveCallerQualifiedCalls,0);assert.equal(f.guard.snapshot().foreignMoveTimeExtended,0);
 assert.equal(f.guard.snapshot().heldDirectExtended,1);
}));

test('same adapter owner cache remains shared; timing provenance is absent from cache and native options',async()=>clock(async()=>{
 const f=await fixture({native:{ok:true,exact:true,unresolvedMass:0,rest:{p:0},outcomes:[{p:1,key:'278.7500',active:'A',observation:{active:'A',phase:'play'},completed:true,turnover:false}]}});
 const a=withServiceOwner(f.guard.services,{phaseId:'a'}),b=withServiceOwner(f.guard.services,{phaseId:'b'});
 await a.explore(move,options());await b.explore(move,options());assert.equal(f.explores.length,1);assert.equal(f.adapter.snapshot().hits,1);
 assert.equal(f.guard.snapshot().foreignMoveTimeSamples[1].dispatchStatus,'unobserved');
 assert.equal('family' in f.explores[0].q,false);assert.equal('coachEnumerationDeadline' in f.explores[0].q,false);
}));
