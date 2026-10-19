import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {timeoutWitness} from '../src/timeout-evidence.mjs';import {requestServices,reusableExplore} from '../src/services.mjs';import {completeAction} from '../src/policy.mjs';
const fixtureBytes=readFileSync(new URL('./fixtures/LONG_ROUTE_RESULT.json',import.meta.url));
assert.equal(createHash('sha256').update(fixtureBytes).digest('hex'),'c81bcb7fdb6a886cdad1653b2ba4ee57e819a5368ad18c8472b8e23ba766cc1f','original real LONG_ROUTE witness bytes');
const fixture=JSON.parse(fixtureBytes);
const response=fixture.result,input=fixture.input,e=response.partialEvidence;
const opts={from:e.position.key,team:e.activeTeam,perspective:e.perspective,maxMs:50};
test('real scoring witness is diagnostic only and never an action/cache certificate',()=>{
 const w=timeoutWitness(response,input,opts,e.requestId);assert.equal(w.usable,true);assert.equal(w.diagnosticOnly,true);
 assert.ok(w.evidence.observed.touchdown>0);assert.ok(w.evidence.observed.turnover>0);
 assert.equal(response.ok,false);assert.equal(w.evidence.value,null);assert.equal(completeAction(response,e.activeTeam),false);assert.equal(reusableExplore(response),false);
});
test('same action, source, request, team and perspective are required',()=>{
 for(const [i,o,id] of [[{...input,playerId:'other'},opts,e.requestId],[input,{...opts,from:'other'},e.requestId],
  [input,opts,e.requestId+1],[input,{...opts,team:e.activeTeam==='A'?'B':'A'},e.requestId],
  [input,{...opts,perspective:e.perspective==='A'?'B':'A'},e.requestId],[input,{...opts,perspective:'self'},e.requestId]])
  assert.equal(timeoutWitness(response,i,o,id).usable,false);
});
test('unexpanded or omitted mass cannot be normalized away or confused',()=>{
 for(const change of [x=>x.unknownMass=0,x=>x.enumerated=1,x=>x.unlistedEnumeratedMass=1,
  x=>x.listedMass=0,x=>x.outcomes[0].p=NaN,x=>x.outcomes.push(x.outcomes[0])]){
  const r=structuredClone(response);change(r.partialEvidence);assert.equal(timeoutWitness(r,input,opts,e.requestId).usable,false);
 }
});
test('observed TD/TO and their unknown tails cannot be suppressed or fabricated',()=>{
 for(const change of [x=>x.observed.touchdown=0,x=>x.probabilityBounds.turnover.upper=0,
  x=>x.observed.turnover=1,x=>x.probabilityBounds.touchdown.lower=1,x=>x.decisionPolicy.mode='solved',
  x=>x.value=100,x=>x.outcomes[0].key='unverified-key']){
  const r=structuredClone(response);change(r.partialEvidence);assert.equal(timeoutWitness(r,input,opts,e.requestId).usable,false);
 }
});
test('adapter returns failures unchanged, does not cache them or manufacture positions',async()=>{
 let calls=0;const a=requestServices({explore:async()=>{calls++;return response;}},{requestId:e.requestId});
 assert.equal(await a.services.explore(input,opts),response);assert.equal(await a.services.explore(input,opts),response);
 const s=a.snapshot();assert.equal(calls,2);assert.equal(s.serviceFailures.byCode.timeout,2);assert.equal(s.timeoutWitnesses.usable,2);
 assert.equal(s.timeoutWitnesses.observedTDCalls,2);assert.equal(s.timeoutWitnesses.observedTurnoverCalls,2);
 assert.equal(s.retainedEntries,0);assert.equal(s.keyHandles.observedUnique,0);assert.equal(s.hits,0);
 s.timeoutWitnesses.samples[0].observed.touchdown=0;assert.ok(a.snapshot().timeoutWitnesses.samples[0].observed.touchdown>0);
});
test('all failures count but absent/malformed witnesses remain explicit and sample memory is bounded',async()=>{
 const a=requestServices({explore:async()=>response},{requestId:e.requestId});
 for(let i=0;i<10;i++)await a.services.explore(input,opts);
 assert.equal(a.snapshot().timeoutWitnesses.samples.length,8);assert.equal(a.snapshot().timeoutWitnesses.omittedSamples,2);
 const old=requestServices({explore:async()=>({ok:false,code:'timeout'})},{requestId:e.requestId});
 await old.services.explore(input,opts);assert.equal(old.snapshot().timeoutWitnesses.rejected,1);
 assert.equal(old.snapshot().timeoutWitnesses.byReason['witness-unavailable:host-did-not-retain-witness'],1);
});
