import test from 'node:test';
import assert from 'node:assert/strict';
import {completeRootEvidence,refineRootCandidates} from '../src/root-refinement.mjs';
import {requestServices} from '../src/services.mjs';

const caps={maxServiceCalls:6000,maxPositions:4000,maxOutcomesPerCall:80,maxLeavesPerCall:20000,
 maxLeavesPerRequest:2000000,maxCallMs:15000,serviceTimeShare:.9};
const initialOptions={observations:true,maxOutcomes:16,maxKeep:256,threshold:.0001,maxLeaves:100,
 maxMs:200,decisions:'builtin',perspective:'A'};
const input={kind:'playerAction',playerId:'A1',action:'move',path:[]};
const candidate=(label,value=1)=>({label,input:{...input},ex:{position:{key:'root',depth:0},
 applied:{maxOutcomes:16,maxLeaves:100,threshold:.0001,maxMs:200,horizon:'root'},
 outcomes:[{key:'7.1'}]},unknown:.03,value,baseValue:value,terminalScoreMass:0,strategicDelta:0});
const resourceService=()=>({verified:true,limits:{...caps},remaining:{calls:100,positions:3000,leaves:100000,
 serviceMs:30000}});
function completeResult(options,key='7.2'){
 return {ok:true,exact:true,outcomeIdentity:'complete-state-v1',position:{key:'root',depth:0},
  activeTeam:'A',perspective:'A',decisionPolicy:{mode:'builtin',own:'builtin',opponent:'builtin'},
  applied:{maxOutcomes:options.maxOutcomes,maxLeaves:options.maxLeaves,maxMs:options.maxMs,
   threshold:options.threshold,horizon:options.horizon},leaves:12,pTurnover:0,pTouchdown:0,pOpponentTouchdown:0,
  unresolvedMass:0,rest:{p:0},outcomes:[{key,p:1,active:'B',observation:{active:'B',phase:'play'},
   completed:true,turnover:false,touchdown:null}]};
}
function services({budget=resourceService(),respond=options=>completeResult(options)}={}){
 const calls=[];return {calls,service:{rootRefinementBudget:async()=>budget,
  explore:async(i,options)=>{calls.push({input:i,options});return respond(options,calls.length);}}};
}
const rescore=(c,ex)=>({ex,value:9,baseValue:9,unknown:0,terminalScoreMass:0,strategicDelta:0});

test('before preparation, one same-root complete result changes semantic request options and atomically rescales its candidate',async()=>{
 const c=candidate('high',10),originalInput=c.input,{calls,service}=services();let returned;
 service.explore=async(i,options)=>{calls.push({input:i,options});returned=completeResult(options);return returned;};
 const report=await refineRootCandidates({candidates:[candidate('low'),c],services:service,
  initialOptions,team:'A',remainingMs:()=>45000,reserveAfterMs:3500,maxRefinements:1,rescore});
 assert.equal(report.attempted,1);assert.equal(report.committed,1);assert.equal(report.samples[0].label,'high');
 assert.equal(calls.length,1);assert.equal(calls[0].input,originalInput);
 assert.ok(calls[0].options.maxOutcomes>16);assert.ok(calls[0].options.maxLeaves>100);
 assert.ok(calls[0].options.threshold<initialOptions.threshold);assert.ok(calls[0].options.maxMs>200);
 assert.equal(calls[0].options.from,'root');assert.equal(calls[0].options.team,'A');
 assert.equal(calls[0].options.perspective,'A');assert.equal(calls[0].options.decisions,'builtin');
 assert.equal(calls[0].options.horizon,'root');assert.equal(c.input,originalInput);
 assert.equal(c.ex.position.key,'root');assert.equal(c.ex,returned);
 assert.equal(c.value,9);assert.equal(c.unknown,0);assert.deepEqual(c.rootRefinement.outcomeKeys,['7.2']);
});

test('partial or unclosed responses keep the original candidate and unknown unchanged',async()=>{
 const c=candidate('partial'),prepared=new Map([['old','retained']]);c.preparedBranches=prepared;
 const old={ex:c.ex,value:c.value,unknown:c.unknown,baseValue:c.baseValue};
 const {service}=services({respond:o=>({...completeResult(o),exact:false,unresolvedMass:.03,rest:{p:.03}})});
 const report=await refineRootCandidates({candidates:[c],services:service,initialOptions,team:'A',
  remainingMs:()=>45000,reserveAfterMs:3500,maxRefinements:1,rescore});
 assert.equal(report.attempted,1);assert.equal(report.committed,0);assert.equal(report.refused,1);
 assert.equal(report.samples[0].reason,'root-not-exact');
 assert.equal(c.ex,old.ex);assert.equal(c.value,old.value);assert.equal(c.unknown,old.unknown);
 assert.equal(c.baseValue,old.baseValue);assert.equal(c.rootRefinement,undefined);assert.equal(c.preparedBranches,prepared);
});

test('only actual positive truncation at the host outcome cap is typed as cap-insufficient',async()=>{
 const c=candidate('cap');
 const {service}=services({respond:o=>{const r=completeResult(o,'7.2');
  r.rest={p:.2};r.outcomes=Array.from({length:o.maxOutcomes},(_,i)=>({...r.outcomes[0],key:`7.${i+2}`,p:.8/o.maxOutcomes}));
  return r;}});
 const report=await refineRootCandidates({candidates:[c],services:service,initialOptions,team:'A',
  remainingMs:()=>45000,reserveAfterMs:3500,maxRefinements:1,rescore});
 assert.equal(report.samples[0].reason,'actual-max-outcomes-cap-insufficient');
 assert.equal(c.unknown,.03);assert.equal(c.rootRefinement,undefined);
});

test('exact complete graph can commit when the existing guarded caller applies more than its raw maxMs request',async()=>{
 const c=candidate('guarded'),budget=resourceService();budget.remaining.serviceMs=6112;
 const {calls,service}=services({budget,respond:o=>{const r=completeResult(o);r.applied.maxMs=6000;return r;}});
 const report=await refineRootCandidates({candidates:[c],services:service,initialOptions,team:'A',
  remainingMs:()=>15900,reserveAfterMs:3500,maxRefinements:1,rescore});
 assert.equal(calls.length,1);assert.equal(calls[0].options.maxMs,5500);
 assert.equal(calls[0].options.coachEnumerationDeadlineSource,'s4-15-root-refinement-reserve');
 assert.ok(calls[0].options.coachEnumerationDeadline>0);
 assert.equal(report.committed,1);assert.equal(report.samples[0].requested.maxMs,5500);
 assert.equal(report.samples[0].actualApplied.maxMs,6000);
});

test('semantic enumeration refinement still runs when the safe maxMs allocation cannot grow',async()=>{
 const c=candidate('same-time'),budget=resourceService();budget.remaining.serviceMs=223;
 const {calls,service}=services({budget,respond:o=>({...completeResult(o),exact:false,
  unresolvedMass:.01,rest:{p:.01}})});
 const report=await refineRootCandidates({candidates:[c],services:service,initialOptions,team:'A',
  remainingMs:()=>45000,reserveAfterMs:3500,maxRefinements:1,rescore});
 assert.equal(calls.length,1);assert.equal(calls[0].options.maxMs,200);
 assert.ok(calls[0].options.threshold<initialOptions.threshold);
 assert.ok(calls[0].options.maxLeaves>100);assert.equal(report.attempted,1);
 assert.equal(report.committed,0);assert.equal(c.unknown,.03);assert.equal(c.rootRefinement,undefined);
});

test('a caller-window-limited request leaves guard validation and dispatch headroom without borrowing the reserved tail',async()=>{
 const c=candidate('window-limited'),{calls,service}=services();
 const report=await refineRootCandidates({candidates:[c],services:service,initialOptions,team:'A',
  remainingMs:()=>9100,reserveAfterMs:3500,maxRefinements:1,rescore});
 const request=calls[0].options,requested=report.samples[0].requested;
 assert.equal(request.maxMs,5200);assert.equal(requested.callerWindowMs,5600);
 assert.equal(requested.callerDeadline,request.coachEnumerationDeadline);
 assert.ok(request.maxMs+400<=requested.callerWindowMs);
 assert.equal(report.committed,1);
});

test('a 40-outcome partial response with unresolved mass equal to rest is not mislabeled as cap exhaustion',async()=>{
 const c=candidate('real-cap'),cap40={...caps,maxOutcomesPerCall:40};
 const options40={...initialOptions,maxOutcomes:40};c.ex.applied.maxOutcomes=40;
 const budget=resourceService();budget.limits=cap40;
 const {calls,service}=services({budget,respond:o=>{const r=completeResult(o);
  r.exact=false;r.unresolvedMass=.0035722450845907684;r.rest={p:.0035722450845903087};
  r.outcomes=[{...r.outcomes[0],p:1-r.rest.p,key:'7.2'}];return r;}});
 const report=await refineRootCandidates({candidates:[c],services:service,initialOptions:options40,team:'A',
  remainingMs:()=>45000,reserveAfterMs:3500,maxRefinements:1,rescore});
 assert.equal(calls.length,1);assert.equal(calls[0].options.maxOutcomes,40);
 assert.equal(report.samples[0].reason,'root-not-exact');
 assert.notEqual(report.samples[0].reason,'actual-max-outcomes-cap-insufficient');
 assert.equal(c.unknown,.03);assert.equal(c.rootRefinement,undefined);
 const complete=candidate('full-at-40');complete.ex.applied.maxOutcomes=40;
 const full=services({budget,respond:o=>completeResult(o)});
 const accepted=await refineRootCandidates({candidates:[complete],services:full.service,initialOptions:options40,team:'A',
  remainingMs:()=>45000,reserveAfterMs:3500,maxRefinements:1,rescore});
 assert.equal(full.calls.length,1);assert.equal(accepted.committed,1);assert.equal(complete.unknown,0);
});

test('complete source evidence requires exact builtin same-root identity, bounded applied options and closed mass',()=>{
 const options={...initialOptions,from:'root',team:'A',horizon:'root',maxOutcomes:40,maxLeaves:200,
  maxMs:5000,threshold:.00001};
 const result=completeResult(options);
 assert.equal(completeRootEvidence(result,'7',caps,{team:'A',perspective:'A',horizon:'root',
  requestOptions:options,maxAllowedAppliedMs:15000}),null);
 assert.equal(completeRootEvidence(result,'8',caps,{team:'A',perspective:'A',horizon:'root',
  requestOptions:options,maxAllowedAppliedMs:15000}),'root-outcome-source-or-flags-unverified');
 for(const [edit,reason] of [
  [r=>{r.position.key='stale';},'root-source-mismatch'],
  [r=>{r.exact=false;},'root-not-exact'],
  [r=>{r.activeTeam='B';},'root-policy-or-team-mismatch'],
  [r=>{r.outcomeIdentity='grouped';},'root-outcome-identity-unverified'],
  [r=>{r.outcomes[0].key='7.text';},'root-outcome-source-or-flags-unverified'],
  [r=>{r.applied.threshold=1e-9;},'root-applied-limits-unverified'],
  [r=>{r.unresolvedMass=.01;},'root-unresolved-mass'],
  [r=>{r.outcomes[0].p=.9;},'root-outcome-mass-does-not-close'],
  [r=>{r.applied.maxLeaves=201;},'root-applied-limits-unverified']]){
   const bad=structuredClone(result);edit(bad);
   assert.equal(completeRootEvidence(bad,'7',caps,{team:'A',perspective:'A',horizon:'root',
    requestOptions:options,maxAllowedAppliedMs:15000}),reason);
  }
 assert.equal(completeRootEvidence(result,'7',caps,{team:'A',perspective:'A',horizon:'root',
  requestOptions:options,maxAllowedAppliedMs:1000}),'root-applied-limits-unverified');
});

test('unverified resources, no same-root identity or unavailable own time refuse without a service call',async()=>{
 for(const mutate of [
  x=>{x.verified=false;},x=>{delete x.limits.maxOutcomesPerCall;},x=>{x.remaining.positions=0;},
  x=>{x.remaining.leaves=0;},x=>{x.remaining.serviceMs=0;}]){
  const budget=resourceService();mutate(budget);const c=candidate('refused'),{calls,service}=services({budget});
  const report=await refineRootCandidates({candidates:[c],services:service,initialOptions,team:'A',
   remainingMs:()=>45000,reserveAfterMs:3500,maxRefinements:1,rescore});
  assert.equal(report.attempted,0);assert.equal(calls.length,0);assert.equal(c.unknown,.03);
 }
 const c=candidate('time'),{calls,service}=services();
 const report=await refineRootCandidates({candidates:[c],services:service,initialOptions,team:'A',
  remainingMs:()=>300,reserveAfterMs:350,maxRefinements:1,rescore});
 assert.equal(report.attempted,0);assert.equal(calls.length,0);assert.equal(c.unknown,.03);
 const noKey=candidate('no-key');noKey.ex.outcomes[0].key=null;const unkeyed=services();
 const noIdentity=await refineRootCandidates({candidates:[noKey],services:unkeyed.service,initialOptions,team:'A',
  remainingMs:()=>45000,reserveAfterMs:3500,maxRefinements:1,rescore});
 assert.equal(noIdentity.samples[0].reason,'root-request-identity-unobserved');assert.equal(unkeyed.calls.length,0);
});

test('resource view uses the same initialized host limits and current diagnostics, and rejects explicit capability failure',async()=>{
 const limits={...caps,maxOutcomesPerCall:37,maxLeavesPerCall:9100,maxLeavesPerRequest:50000,maxCallMs:5100};
 let usage={totalCalls:13,positions:700},left={leaves:3400,serviceMs:4200};
 const raw={capabilities:async()=>({limits:{...limits}}),diagnostics:async()=>({ok:true,usage:{...usage},limitsLeft:{...left}})};
 const adapter=requestServices(raw,{resourceBudget:true,callReserve:5,positionReserve:11});
 await adapter.initialize();
 const view=await adapter.services.rootRefinementBudget();
 assert.equal(view.verified,true);assert.equal(view.limits.maxOutcomesPerCall,37);
 assert.equal(view.limits.maxLeavesPerCall,9100);assert.equal(view.limits.maxCallMs,5100);
 assert.equal(view.remaining.calls,6000-13-5);assert.equal(view.remaining.positions,4000-700-11);
 assert.equal(view.remaining.leaves,3400);assert.equal(view.remaining.serviceMs,4200);
 usage={totalCalls:17,positions:800};left={leaves:1200,serviceMs:900};
 const refreshed=await adapter.services.rootRefinementBudget();
 assert.equal(refreshed.remaining.calls,6000-17-5);assert.equal(refreshed.remaining.positions,4000-800-11);
 assert.equal(refreshed.remaining.leaves,1200);assert.equal(refreshed.remaining.serviceMs,900);
 const failed=requestServices({capabilities:async()=>({ok:false,limits:{...limits}}),
  diagnostics:async()=>({ok:true,usage:{totalCalls:0,positions:0},limitsLeft:{leaves:10,serviceMs:10}})},
  {resourceBudget:true});
 await failed.initialize();assert.equal(await failed.services.rootRefinementBudget(),null);
});
