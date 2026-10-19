import test from 'node:test';
import assert from 'node:assert/strict';
import {createCandidateLedger} from '../src/candidate-ledger.mjs';
import {commonPool} from '../src/common-boundary.mjs';
import {learningTraceForHost,expandLearningTrace} from '../src/trace-size.mjs';
const input=id=>({kind:'playerAction',playerId:id,action:'move',path:[]});
const line=id=>({input:input(id),ex:{ok:true},baseValue:10});
const o={requestId:42,team:'A',players:[],ball:{kind:'ground'}};

test('producer output distinguishes unreported fields from explicit zero and preserves iterable collection',()=>{
 const ledger=createCandidateLedger(42);
 ledger.producerOutput('unreported',{});
 ledger.producerOutput('explicit',{attempted:false,policyTrees:[]});
 const policy=line('p'),collected=ledger.producerOutput('iterable',{attempted:true,policyTrees:new Set([policy]),selected:policy});
 const [missing,empty,iterable]=ledger.snapshot().producers;
 assert.equal(missing.invoked,true);assert.equal(missing.reportedAttempted,null);assert.equal(missing.policyTreeCount,null);assert.equal(missing.collectedPolicyTreeCount,0);
 assert.equal(empty.reportedAttempted,false);assert.equal(empty.policyTreeCount,0);assert.equal(empty.collectedPolicyTreeCount,0);
 assert.equal(iterable.reportedAttempted,true);assert.equal(iterable.policyTreeCount,null);assert.equal(iterable.collectedPolicyTreeCount,1);
 assert.equal(collected.trees[0],policy);assert.equal(collected.origins[0].candidateId,collected.selectedOrigin.candidateId);
 assert.throws(()=>ledger.producerOutput('malformed',{policyTrees:{}}),TypeError);
});

test('source occurrences share a policy ID while distinct dependencies retain distinct IDs',()=>{
 const ledger=createCandidateLedger(42),plain=line('p'),a={...plain,preparedBranches:new Map([['source',{plan:{input:input('a')}}]])},b={...plain,preparedBranches:new Map([['source',{plan:{input:input('b')}}]])};
 const relay=ledger.occurrence(a,{source:'relay',role:'policyTrees',index:0}),mechanisms=ledger.occurrence(a,{source:'mechanisms',role:'selected'});
 assert.notEqual(relay.occurrenceId,mechanisms.occurrenceId);assert.equal(relay.candidateId,mechanisms.candidateId);
 assert.notEqual(ledger.candidate(a).candidateId,ledger.candidate(b).candidateId);
 assert.equal(ledger.candidate(a).inputId,ledger.candidate(b).inputId);
 assert.equal(ledger.snapshot().inputs.length,1);assert.equal(a.preparedBranches.get('source').plan.input.playerId,'a');
 assert.ok(!JSON.stringify(ledger.snapshot()).includes('dependencies'));
});

test('unverified dependency identities never merge by first input',()=>{
 const ledger=createCandidateLedger(),a={...line('p'),preparedBranches:new Map([['missing',{plan:{}}]])},b={...a};
 assert.equal(ledger.candidate(a).policyIdentityStatus,'unverified');
 assert.equal(ledger.candidate(a).candidateId,ledger.candidate(a).candidateId);
 assert.notEqual(ledger.candidate(a).candidateId,ledger.candidate(b).candidateId);
});

test('common pool records actual filters and slot-before-duplicate visits without changing membership',()=>{
 const ledger=createCandidateLedger(42),current={input:{kind:'endTurn'},ex:{ok:true}},proposal=line('p'),repeat={...proposal},bad=line('bad');bad.ex.ok=false;
 const missing={ex:{ok:true}},extras=[proposal,repeat],origins=extras.map((c,index)=>ledger.occurrence(c,{source:index?'mechanisms':'relay',role:'policyTrees',index:0}));
 const snapshot={selected:current,lines:[current,bad,missing,proposal]},before=JSON.stringify([snapshot,extras]);
 const baseline=commonPool(o,snapshot,current,2,extras),pool=commonPool(o,snapshot,current,2,extras,{ledger,run:'formal',extraOrigins:origins});
 assert.deepEqual(pool.map(r=>[r.line,r.source]),baseline.map(r=>[r.line,r.source]));assert.deepEqual(pool.omitted,baseline.omitted);
 assert.equal(JSON.stringify([snapshot,extras]),before);
 const trace=ledger.snapshot(),run=trace.pools[0];
 const badOrigin=trace.occurrences.find(r=>r.source==='champion'&&r.role==='observed-line'&&r.index===1);
 const missingOrigin=trace.occurrences.find(r=>r.source==='champion'&&r.role==='observed-line'&&r.index===2);
 assert.equal(run.occurrences.find(r=>r.occurrenceId===badOrigin.occurrenceId).filter,'explore-not-ok');
 assert.equal(run.occurrences.find(r=>r.occurrenceId===missingOrigin.occurrenceId).filter,'missing-input');
 const repeatVisits=run.occurrences.find(r=>r.occurrenceId===origins[1].occurrenceId).visits;
 assert.ok(repeatVisits.length>0);assert.ok(repeatVisits.every(v=>v.status==='slot-limit'));
 const currentOrigin=trace.occurrences.find(r=>r.source==='selection'&&r.role==='current-policy');
 const duplicate=run.occurrences.find(r=>r.occurrenceId===currentOrigin.occurrenceId).visits[0];
 assert.equal(duplicate.status,'duplicate');assert.equal(duplicate.duplicateOf,ledger.candidate(current).candidateId);
 assert.equal(trace.occurrences.find(r=>r.occurrenceId===origins[0].occurrenceId).source,'relay');
 assert.ok(run.occurrences.find(r=>r.occurrenceId===origins[0].occurrenceId).visits.some(v=>v.category==='source-bound-primary-proposal'&&v.status==='admitted'));
});

test('comparison winner and actual returned policy remain separate after a fallback',()=>{
 const ledger=createCandidateLedger(42),winner=line('helper'),current={input:{kind:'endTurn'},ex:{ok:true}},winnerId=ledger.candidate(winner).candidateId;
 ledger.returned(current.input,current,{commonWinnerCandidateId:winnerId,reason:'required-plan-does-not-fit-final-context'});
 const record=ledger.snapshot().returned;
 assert.equal(record.candidateId,ledger.candidate(current).candidateId);assert.notEqual(record.candidateId,record.commonWinnerCandidateId);
 assert.equal(record.reason,'required-plan-does-not-fit-final-context');assert.equal(record.executionReceipt.status,'unobserved');
 assert.equal(ledger.snapshot().coverage.championInternalPruning,null);
 assert.equal(ledger.snapshot().coverage.formalReplyRPC,'unobserved');assert.equal(ledger.snapshot().coverage.modelGenerationAndFiltering,'unobserved');
 ledger.returned(input('unknown'),null);assert.equal(ledger.snapshot().returned.candidateId,null);
 assert.equal(ledger.snapshot().returned.commonSelectedCandidateId,null);assert.equal(ledger.snapshot().returned.commonSelectionBasis,null);
});

test('a certified improvement and final persistence fallback do not become an all-peer winner',()=>{
 const ledger=createCandidateLedger(43),improvement=line('helper'),current={input:{kind:'endTurn'},ex:{ok:true}},selectedId=ledger.candidate(improvement).candidateId;
 ledger.returned(improvement.input,improvement,{commonSelectedCandidateId:selectedId,commonSelectionBasis:'strict-protected-current-improvement'});
 let returned=ledger.snapshot().returned;
 assert.equal(returned.candidateId,selectedId);assert.equal(returned.commonSelectedCandidateId,selectedId);assert.equal(returned.commonWinnerCandidateId,null);
 ledger.returned(current.input,current,{commonSelectedCandidateId:selectedId,commonSelectionBasis:'strict-protected-current-improvement',reason:'required-plan-does-not-fit-final-context'});
 returned=ledger.snapshot().returned;assert.notEqual(returned.candidateId,selectedId);assert.equal(returned.commonSelectedCandidateId,selectedId);
 assert.equal(returned.commonWinnerCandidateId,null);assert.equal(returned.commonSelectionBasis,'strict-protected-current-improvement');assert.equal(returned.executionReceipt.status,'unobserved');
});

test('row filter evidence does not add a new ex.ok gate to direct extra admission',()=>{
 const ledger=createCandidateLedger(),current={input:{kind:'endTurn'},ex:{ok:true}},extra=line('p');extra.ex.ok=false;
 const origin=ledger.occurrence(extra,{source:'relay',role:'selected'});
 const pool=commonPool(o,{selected:current,lines:[current]},current,2,[extra],{ledger,extraOrigins:[origin]});
 assert.equal(pool[1].line,extra);
 const record=ledger.snapshot().pools[0].occurrences.find(r=>r.occurrenceId===origin.occurrenceId);
 assert.equal(record.filter,'explore-not-ok');assert.ok(record.visits.some(v=>v.status==='admitted'));
 assert.equal(extra.ex.ok,false);
});

test('request ledger restores exact identities, provenance and refusal events through trace packing',()=>{
 const ledger=createCandidateLedger(42),current={input:{kind:'endTurn'},ex:{ok:true}},extras=Array.from({length:20},(_,i)=>line('p'+i));
 const origins=extras.map((c,index)=>ledger.occurrence(c,{source:'relay',role:'policyTrees',index}));
 commonPool(o,{selected:current,lines:[current]},current,3,extras,{ledger,run:'formal',extraOrigins:origins});
 ledger.returned(current.input,current,{reason:'comparison-unavailable'});
 const source={candidateLedger:ledger.snapshot()},before=JSON.stringify(source),wire=learningTraceForHost(source),restored=expandLearningTrace(structuredClone(wire));delete restored.traceCompaction;
 assert.deepEqual(restored,source);assert.equal(JSON.stringify(source),before);
 assert.equal(restored.candidateLedger.returned.executionReceipt.status,'unobserved');
 assert.ok(restored.candidateLedger.pools[0].occurrences.some(r=>r.visits.some(v=>v.status==='slot-limit')));
});
