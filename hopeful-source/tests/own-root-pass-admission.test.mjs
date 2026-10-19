import test from 'node:test';
import assert from 'node:assert/strict';
import {guardLiveExplore,requestServices,withServiceOwner} from '../src/services.mjs';
// Pure mocks only: source preparation cannot prove native chance completion.
const players=[{id:'A10',team:'A'},{id:'B10',team:'B'}];
const pass={kind:'playerAction',playerId:'A10',action:'pass',path:[],target:{x:12,y:7}};
const options=(deadline=10000)=>({from:'root',team:'A',perspective:'A',observations:true,decisions:'builtin',
 maxOutcomes:128,maxKeep:256,maxLeaves:4000,threshold:1e-6,maxMs:1500,
 ...(deadline===null?{}:{coachEnumerationDeadline:deadline})});
const nativeOptions=o=>{const {coachEnumerationDeadline,coachEnumerationDeadlineSource,...q}=o;return q;};
const clock=async fn=>{const original=Date.now;let now=1000;Date.now=()=>now;try{await fn({advance:ms=>now+=ms});}finally{Date.now=original;}};
async function fixture({advance=()=>{},validateMs=0,diagnosticsMs=0,diagnosticsAt=4,cap=15000,serviceMs=108000,
 missingService=false,enabled=true,globalDeadline=100000,validation=null,native=null}={}){
 let diagnostics=0;const explores=[],validations=[];
 const raw={capabilities:async()=>({limits:{maxServiceCalls:12000,maxPositions:8000,...(cap===null?{}:{maxCallMs:cap})}}),
 diagnostics:async()=>{const n=++diagnostics;if(n===diagnosticsAt)advance(diagnosticsMs);
  return {ok:true,usage:{totalCalls:0,positions:0},...(missingService?{}:{limitsLeft:{leaves:2000000,serviceMs:typeof serviceMs==='function'?serviceMs(n):serviceMs}})};},
 validate:async(i,q)=>{validations.push({i,q});advance(validateMs);return validation??{ok:true,legal:true,position:q.from};},
 explore:async(i,q)=>{explores.push({i,q});return native??{ok:true,exact:true,unresolvedMass:0,rest:{p:0},
  outcomes:[{p:1,key:'243.1',active:'A',observation:{phase:'play',active:'A'},completed:true,turnover:false}]};}};
 const adapter=requestServices(raw,{deadline:globalDeadline,resourceBudget:true,callReserve:0,positionReserve:0});await adapter.initialize();
 const guard=guardLiveExplore(adapter.services,'A',players,{deadline:globalDeadline,ownRootPassTimeExtension:enabled});
 return {adapter,guard,explores,validations,diagnostics:()=>diagnostics};
}
function refusal(f,r,reason='own-root-pass-enumeration-budget-unavailable',serviceFailures=0){
 assert.equal(r.ok,false);assert.equal(r.code,'coach-live-explore-refused');assert.equal(r.reason,reason);
 assert.equal(f.explores.length,0);assert.equal('outcomes' in r,false);assert.equal('rest' in r,false);
 assert.equal(f.adapter.snapshot().serviceFailures.count,serviceFailures);
}

test('qualified root own Pass uses existing desired6000 and retains every law parameter',async()=>clock(async()=>{
 const f=await fixture(),o=Object.freeze(options()),r=await f.guard.services.explore(pass,o);
 assert.equal(r.ok,true);assert.equal(r.exact,true);assert.equal(r.rest.p,0);assert.equal(r.unresolvedMass,0);
 assert.deepEqual(f.explores[0],{i:pass,q:{...nativeOptions(o),maxMs:6000}});assert.equal(o.maxMs,1500);
 const a=f.guard.snapshot();assert.equal(a.ownRootPassCallerQualifiedCalls,1);assert.equal(a.ownRootPassSourceValidatedCalls,1);
 assert.equal(a.ownRootPassTimeExtended,1);assert.equal(a.passTimeExtended,0);assert.equal(a.complexTimeExtended,0);
 assert.equal(a.ownRootPassTimeSamples[0].dispatchedMs,6000);assert.equal(f.diagnostics(),4);
 assert.equal('minimumMs' in f.explores[0].q,false);assert.equal('coachEnumerationDeadline' in f.explores[0].q,false);
}));

test('observed1952-size caller or common2000 slot refuses unknown before validate',async()=>clock(async()=>{
 for(const remaining of [1952,2000,2999]){const f=await fixture();refusal(f,await f.guard.services.explore(pass,options(1000+40+remaining)));
  assert.equal(f.validations.length,0);assert.equal(f.guard.snapshot().ownRootPassSourceValidatedCalls,0);}
}));

test('exact3000 dispatch floor admits after40 margin; original larger requested time is never shrunk',async()=>clock(async()=>{
 const f=await fixture({cap:3000,serviceMs:18000});await f.guard.services.explore(pass,options(4040));assert.equal(f.explores[0].q.maxMs,3000);
 const low=await fixture();refusal(low,await low.guard.services.explore(pass,{...options(4040),maxMs:3100}));
}));

test('finite caller absent or Infinity rejects scoped root Pass without borrowing global phase',async()=>clock(async()=>{
 for(const deadline of [null,Infinity]){const f=await fixture();refusal(f,await f.guard.services.explore(pass,options(deadline)),'own-root-pass-caller-deadline-unobserved');
  assert.equal(f.validations.length,0);assert.equal(f.guard.snapshot().ownRootPassCallerQualifiedCalls,0);}
}));

test('validation time makes postvalidate floor unavailable',async()=>clock(async({advance})=>{
 const f=await fixture({advance,validateMs:961});refusal(f,await f.guard.services.explore(pass,options(5000)));
 assert.equal(f.validations.length,1);assert.equal(f.guard.snapshot().ownRootPassSourceValidatedCalls,1);
 assert.equal(f.guard.snapshot().ownRootPassTimeSamples[0].stage,'after-validation');
}));

test('final adapter diagnostics time cannot roll the real caller deadline',async()=>clock(async({advance})=>{
 const f=await fixture({advance,diagnosticsMs:961});refusal(f,await f.guard.services.explore(pass,options(5000)));
 assert.equal(f.diagnostics(),4);assert.equal(f.validations.length,1);assert.equal(f.adapter.snapshot().resourceBudget.callsUsed,1);
 assert.equal(f.guard.snapshot().ownRootPassTimeSamples[0].dispatchStatus,'local-refusal');
 const costs=f.adapter.snapshot().candidateServiceCosts;assert.equal(costs.parameters.filter(r=>costs.methods[r[1]]==='explore').length,0);
 // A refused admission must not leak its reserved positions into a later call.
 assert.equal((await f.guard.services.explore(pass,options(Date.now()+7000))).ok,true);assert.equal(f.explores.length,1);
}));

for(const at of [2,3])test('real budget refresh stage '+at+' consumes caller time before allocation',async()=>clock(async({advance})=>{
 const f=await fixture({advance,diagnosticsAt:at,diagnosticsMs:961});refusal(f,await f.guard.services.explore(pass,options(5000)));
 assert.equal(f.diagnostics(),at);assert.equal(f.validations.length,at===2?0:1);
}));

for(const cfg of [{cap:2999},{serviceMs:17999},{cap:null},{missingService:true}])test('actual cap/service/verified floor '+JSON.stringify(cfg),async()=>clock(async()=>{
 const f=await fixture(cfg);refusal(f,await f.guard.services.explore(pass,options()),cfg.cap===null||cfg.missingService?'own-root-pass-service-budget-unverified':'own-root-pass-enumeration-budget-unavailable');
 assert.equal(f.validations.length,0);
}));

test('postvalidate and finaldiagnostics service headroom independently enforce reserve15000',async()=>clock(async()=>{
 for(const at of [3,4]){const f=await fixture({serviceMs:n=>n>=at?17999:24000});refusal(f,await f.guard.services.explore(pass,options()));
  assert.equal(f.diagnostics(),at);assert.equal(f.validations.length,1);}
 const global=await fixture({globalDeadline:19039});refusal(global,await global.guard.services.explore(pass,options(100000)));
}));

test('same-source native legality is required; actual native negative validation stays counted',async()=>clock(async()=>{
 for(const v of [{ok:true,position:'other',legal:true},{ok:true,position:'root',legal:false},{ok:false,code:'illegal'}]){
  const f=await fixture({validation:v});refusal(f,await f.guard.services.explore(pass,options()),v.legal===false?'input-illegal':'source-legality-unverified',v.ok===false?1:0);
  assert.equal(f.guard.snapshot().ownRootPassSourceValidatedCalls,0);}
}));

test('default opt-out and foreign/retained/pos/perspective variants preserve prior Pass time behavior',async()=>clock(async()=>{
 const cases=[{enabled:false},{input:{...pass,playerId:'B10'},patch:{team:'B'}},{patch:{from:'243.2'}},
  {patch:{pos:undefined}},{patch:{observations:false}},{patch:{decisions:'solve'}},{patch:{perspective:'B'}}];
 for(const c of cases){const f=await fixture({enabled:c.enabled??true}),o={...options(1000+40+1952),...c.patch};
  assert.equal((await f.guard.services.explore(c.input??pass,o)).ok,true);assert.deepEqual(f.explores[0].q,{...nativeOptions(o),maxMs:1952});
  assert.equal(f.guard.snapshot().ownRootPassCallerQualifiedCalls,0);assert.equal(f.guard.snapshot().passTimeSlotCapped,1);assert.equal(f.diagnostics(),2);}
}));

test('no fixed path/leaf/outcome/threshold signature; original uncommon law parameters survive',async()=>clock(async()=>{
 for(const [out,leaves,threshold] of [[16,64,.001],[128,4000,1e-6],[40,12000,0]]){
  const f=await fixture(),o={...options(),maxOutcomes:out,maxLeaves:leaves,threshold,maxKeep:128};
  const i={...pass,path:[{kind:'step',to:{x:11,y:7}}]};await f.guard.services.explore(i,o);
  assert.deepEqual(f.explores[0].q,{...nativeOptions(o),maxMs:6000});assert.equal(f.explores[0].i,i);}
}));

test('owner views share cache; completed cache hit is not a second native dispatch',async()=>clock(async()=>{
 const f=await fixture(),a=withServiceOwner(f.guard.services,{phaseId:'a'}),b=withServiceOwner(f.guard.services,{phaseId:'b'});
 await a.explore(pass,options());await b.explore(pass,options());assert.equal(f.explores.length,1);assert.equal(f.adapter.snapshot().hits,1);
 assert.equal(f.guard.snapshot().ownRootPassTimeSamples[1].dispatchStatus,'unobserved');
 const c=f.adapter.snapshot().candidateServiceCosts;const id=c.statuses.indexOf('cache-hit');assert.ok(c.events.some(r=>r[0]==='b'&&r[2]===id&&r[4]===1));
}));

test('actual timeout negative identity and unknown chance law are preserved',async()=>clock(async()=>{
 const negative={ok:false,code:'timeout',message:'actual native timeout',partialEvidence:null},f=await fixture({native:negative});
 assert.equal(await f.guard.services.explore(pass,options()),negative);assert.equal(f.adapter.snapshot().serviceFailures.count,1);
 const unknown={ok:true,exact:false,unresolvedMass:1,rest:{p:1},outcomes:[]},u=await fixture({native:unknown});
 assert.equal(await u.guard.services.explore(pass,options()),unknown);assert.equal(u.adapter.snapshot().serviceFailures.count,0);
}));
