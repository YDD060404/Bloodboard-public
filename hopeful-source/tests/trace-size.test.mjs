import {test} from 'node:test';
import assert from 'node:assert/strict';
import {learningTraceForHost,expandLearningTrace} from '../src/trace-size.mjs';
test('long action inputs shared across selection and learned diagnostics restore exactly',()=>{
 const input={kind:'playerAction',playerId:'carrier',action:'move',path:Array.from({length:8},(_,i)=>({kind:'step',to:{x:i,y:7}}))};
 const source={lines:[{input}],champion:{input},planning:{checks:{learnedPreparation:{input,ownMass:{unresolved:.17}},learnedComparison:{selected:input,reason:'learned-shared-reply-domain-incomplete',policies:[{input}]}}}};
 const before=JSON.stringify(source),wire=learningTraceForHost(source);
 assert.ok(wire.traceCompaction.shared_objects>=3);
 assert.ok(JSON.stringify(wire).length<before.length);
 const restored=expandLearningTrace(JSON.parse(JSON.stringify(wire)));delete restored.traceCompaction;
 assert.deepEqual(restored,source);assert.equal(JSON.stringify(source),before);
});
test('trace compaction preserves unknown, critical costs, refusal reasons and input identity without mutation',()=>{
 const input={kind:'endTurn'},trace={selection:{challengers:[{reason:'missing-key',replyBasis:{criticalDelta:-40,interpretation:'repeated explanation'}}]},
  commonComparison:{candidateInputs:[input],pool:[{input,rejections:['OWN_END_SOURCE_KEY_MISSING'],own_unknown:.2,
   critical_reply:-80,reply:[{unknown:true,failed:false,carrierThreat:{pTargetDown:.5,exact:false,unresolved:.2}}]}],
   ranked:[{input,shadow_score:-10,reply_unknown:1}]},tacticalLearning:{ranked:false,reason:'PUBLIC_RULES_EDITION_UNOBSERVED'}};
 const before=JSON.stringify(trace),out=learningTraceForHost(trace);
 assert.equal(JSON.stringify(trace),before);assert.equal(out.selection.challengers[0].replyBasis.criticalDelta,-40);
 assert.equal(out.commonComparison.pool[0].own_unknown,.2);assert.equal(out.commonComparison.pool[0].critical_reply,-80);
 assert.deepEqual(out.commonComparison.pool[0].rejections,['OWN_END_SOURCE_KEY_MISSING']);
 assert.equal(out.commonComparison.pool[0].reply[0].carrierThreat.unresolved,.2);
 assert.equal(out.commonComparison.ranked[0].policy_index,0);assert.equal(out.commonComparison.ranked[0].reply_unknown,1);
 assert.equal(out.tacticalLearning.reason,'PUBLIC_RULES_EDITION_UNOBSERVED');
});
test('identical repeated reply evidence resolves exactly, with per-candidate reasons retained',()=>{
 const replyBasis={delta:-52.155,bounded:false,mode:'critical-only-unmatched',scope:'conditional-follow-up',challengerCritical:-52.155,incumbentCritical:-6.053,criticalDelta:-52.155,positionDelta:0};
 const source={selection:{challengers:[{reason:'missing-key',replyBasis},{reason:'champion-not-beaten',replyBasis}]}};
 const wire=learningTraceForHost(source);
 assert.equal(wire.traceCompaction.shared_objects,1);
 assert.deepEqual(wire.selection.challengers[1].replyBasis,{traceRef:'/selection/challengers/0/replyBasis'});
 const expanded=expandLearningTrace(wire);delete expanded.traceCompaction;
 assert.deepEqual(expanded,source);assert.equal(source.selection.challengers[1].replyBasis.criticalDelta,-52.155);
});

test('diagnostic row table preserves null, absent reasons, exact numbers and references into earlier rows',()=>{
 const basis={delta:-52.155,bounded:false,mode:'critical-only-unmatched',scope:'conditional-follow-up',challengerCritical:-52.155,incumbentCritical:-6.053,criticalDelta:-52.155,positionDelta:0};
 const rows=Array.from({length:8},(_,i)=>({label:'policy'+i,replyBasis:basis,firstGain:13.777699999999868,replyDelta:-52.155,gain:-38.3773,margin:.5,terminalScoreMass:0,uncertaintyReserve:0,effectiveGain:-38.3773,uncertaintyTreatment:'normal gate',eligible:false,...(i%2?{reason:null}:{})}));
 const source={selection:{challengers:rows}},wire=learningTraceForHost(source);
 assert.equal(wire.selection.challengers.traceTable,'object-rows/v1');
 const restored=expandLearningTrace(JSON.parse(JSON.stringify(wire)));delete restored.traceCompaction;
 assert.deepEqual(restored,source);assert.equal(restored.selection.challengers[1].reason,null);
 assert.ok(!('reason' in restored.selection.challengers[0]));
 assert.ok(JSON.stringify(wire).length<JSON.stringify(source).length);
});
test('large common pool restores cross-field references and all evidence within the host limit',()=>{
 const input={kind:'playerAction',playerId:'carrier',action:'move',path:Array.from({length:8},(_,i)=>({kind:'step',to:{x:i,y:7}}))};
 const source={search:{diagnostic:'x'.repeat(30000)},commonComparison:{pool:Array.from({length:20},(_,i)=>({input,reason:'source-bound-reply-incomplete',own_unknown:.170123456789,critical_reply:-73.29499999999993,
  evidence:Array.from({length:12},(_,j)=>({index:j,probability:1/27,unknown:true,reason:'reply-key-unavailable',category:'preparation'}))})),ranked:[]},planning:{checks:{learnedPreparation:{input}}}};
 const wire=learningTraceForHost(source);
 const restored=expandLearningTrace(JSON.parse(JSON.stringify(wire)));delete restored.traceCompaction;
 assert.deepEqual(restored,source);assert.ok(JSON.stringify(wire).length<36000);
});

test('large learned planning evidence crosses host transport without deleting unknown or actual refusals',()=>{
 const rows=Array.from({length:160},(_,i)=>({index:i,input:{kind:'playerAction',playerId:'actor',action:'move',path:[{kind:'step',to:{x:3,y:7}}]},unknown:.177777777777771,refused:'same-source-endpoint-unverified; no incumbent winner',scope:'native FAQ transfer proposal, never action success probability',ownComplete:false}));
 const source={planning:{cases:rows},learnedAdmission:{modelInvoked:true,committedToReturnedInput:false},search:{services:{serviceFailures:{count:1,byCode:{timeout:1}}}}},before=JSON.stringify(source),wire=learningTraceForHost(source);
 assert.ok(before.length>40000);assert.ok(JSON.stringify(wire).length<36000);const restored=expandLearningTrace(JSON.parse(JSON.stringify(wire)));delete restored.traceCompaction;assert.deepEqual(restored,source);assert.equal(JSON.stringify(source),before);
});
test('structured-clone diagnostics restore sparse defaults without a JSON workaround',()=>{
 for(const count of [24,160]){
  const source={planning:{checks:{commonTurnPool:{rows:Array.from({length:count},(_,i)=>({index:i,input:{kind:'endTurn'},unknown:null,reason:i%2?'missing-proof':undefined,
   complete:false,details:undefined,fields:[undefined,null,false],note:'repeated exact diagnostic payload; unknown is not safe'}))}}}};
  const before=JSON.stringify(source),wire=learningTraceForHost(source),restored=expandLearningTrace(structuredClone(wire));delete restored.traceCompaction;
  assert.deepEqual(restored,JSON.parse(before));assert.equal(JSON.stringify(source),before);assert.equal(restored.planning.checks.commonTurnPool.rows[0].unknown,null);
  assert.ok(!Object.hasOwn(restored.planning.checks.commonTurnPool.rows[0],'reason'));
 }
});
test('nonfinite diagnostic scalars remain explicit invalid evidence across raw transport',()=>{
 const source={planning:{checks:{commonTurnPool:{rows:Array.from({length:30},(_,i)=>({index:i,lower:Infinity,upper:-Infinity,probability:NaN,reason:'invalid-value-remains-unusable',unknown:null}))}}}};
 const wire=learningTraceForHost(source),out=expandLearningTrace(structuredClone(wire));
 for(const [key,label] of [['lower','Infinity'],['upper','-Infinity'],['probability','NaN']])assert.deepEqual(out.planning.checks.commonTurnPool.rows[0][key],{traceNonFiniteScalar:label,usableAsNumber:false});
 assert.equal(out.planning.checks.commonTurnPool.rows[0].unknown,null);assert.equal(source.planning.checks.commonTurnPool.rows[0].lower,Infinity);
});

test('same first input cannot merge distinct dependency policies in shadow ranking',()=>{
 const input={kind:'playerAction',playerId:'p',action:'move',path:[]};
 const pool=[{input,candidateId:'shadow/1/0',source:'champion',policy_variant:'retained'},{input,candidateId:'shadow/1/1',source:'relay',policy_variant:'follow-up'}];
 const ranked=[{input,candidateId:'shadow/1/1',source:'relay',policy_variant:'follow-up',policy_index:1,shadow_score:9,reply_unknown:.2},{input,candidateId:'shadow/1/0',source:'champion',policy_variant:'retained',policy_index:0,shadow_score:8,reply_unknown:.3}];
 const source={commonComparison:{pool,ranked}},before=JSON.stringify(source),restored=expandLearningTrace(learningTraceForHost(source));
 assert.deepEqual(restored.commonComparison.ranked.map(r=>r.policy_index),[1,0]);assert.deepEqual(restored.commonComparison.ranked.map(r=>r.candidateId),['shadow/1/1','shadow/1/0']);assert.deepEqual(restored.commonComparison.ranked.map(r=>r.source),['relay','champion']);assert.equal(JSON.stringify(source),before);
});
test('legacy ambiguous ranking input is retained with missing identity instead of borrowing first policy',()=>{
 const input={kind:'endTurn'},out=expandLearningTrace(learningTraceForHost({commonComparison:{pool:[{input,policy_variant:'a'},{input,policy_variant:'b'}],ranked:[{input,shadow_score:1}]}}));
 const r=out.commonComparison.ranked[0];assert.equal(r.policy_index,null);assert.equal(r.identityStatus,'ambiguous-policy-identity');assert.deepEqual(r.matching_policy_indices,[0,1]);assert.deepEqual(r.input,input);
});

test('phase and service-cost transport restores source mass, refusals and distinct candidate identities',()=>{
 const witnesses=Array.from({length:30},(_,i)=>({from:`42.${i}`,p:1/27,endChecked:false,domainChecked:0,
  domainUnknown:null,reasons:['reply-End-budget-unavailable','unknown is retained; no safe reply witness']}));
 const costs={schema:'candidate-service-costs/1',methods:['validate','explore'],statuses:['raw-dispatched','cache-hit','local-refusal'],reasons:['complex-slot-unavailable'],
  eventColumns:['phaseId','method','status','reason','count','elapsedMs'],events:Array.from({length:40},(_,i)=>['f'+i,i%2,i%3,i%3===2?0:null,i+1,i/7]),
  parameterNames:['maxMs','maxLeaves'],parameterColumns:['phaseId','method','parameter','count','min','max'],parameters:[['f0',1,0,1,1200,1200],['f0',1,1,1,512,512]]};
 const source={candidateLedger:{schema:'hopeful-candidate-ledger/1',phases:Array.from({length:16},(_,i)=>({phaseId:'f'+i,candidateId:'c'+i,
   phase:i%2?'formal-reply':'shadow-reply',status:'stopped',serviceCostsObserved:i%3!==0,reportedCalls:i%3?2:null,
   reason:'unknown-source-endpoint-incomplete',endWitnessSources:witnesses}))},search:{services:{candidateServiceCosts:costs}},
  planning:{checks:{witnessesAgain:witnesses}},criticalUnknown:.170123456789,selectedWinner:null};
 const before=JSON.stringify(source),wire=learningTraceForHost(source),out=expandLearningTrace(structuredClone(wire));delete out.traceCompaction;
 assert.ok(before.length>40000);assert.ok(JSON.stringify(wire).length<40000);assert.deepEqual(out,source);assert.equal(JSON.stringify(source),before);
 assert.deepEqual(out.candidateLedger.phases.map(p=>p.candidateId),Array.from({length:16},(_,i)=>'c'+i));
 assert.equal(out.candidateLedger.phases[0].reportedCalls,null);assert.equal(out.candidateLedger.phases[0].endWitnessSources[0].domainUnknown,null);
});

test('raw JSON within byte limit cannot admit a frame beyond the decoder node or depth budget',()=>{
 let deep={value:'unknown must remain explicit'};for(let i=0;i<70;i++)deep={child:deep};
 for(const planning of [Array(12001).fill(0),deep]){
  const source={planning,search:{note:'x'.repeat(15000)},unknown:.2,refusal:'decoder-bound-is-not-zero-risk'},before=JSON.stringify(source);
  assert.ok(before.length<65536);
  const wire=learningTraceForHost(source),out=expandLearningTrace(structuredClone(wire));delete out.traceCompaction;
  assert.deepEqual(out,source);assert.equal(JSON.stringify(source),before);
 }
});

test('repacking an expanded trace preserves verified ranking identity after duplicate input omission',()=>{
 const input={kind:'endTurn'},source={commonComparison:{pool:[{candidateId:'s0',input,source:'champion',policy_variant:'retained'},{candidateId:'s1',input,source:'relay',policy_variant:'follow-up'}],
  ranked:[{candidateId:'s1',input,source:'relay',policy_variant:'follow-up',policy_index:1,shadow_score:9}]}};
 const once=expandLearningTrace(learningTraceForHost(source)),twice=expandLearningTrace(learningTraceForHost(once));
 delete once.traceCompaction;delete twice.traceCompaction;assert.deepEqual(twice,once);assert.equal(twice.commonComparison.ranked[0].policy_index,1);
 assert.ok(!Object.hasOwn(twice.commonComparison.ranked[0],'input'));
 const duplicate={commonComparison:{pool:[{candidateId:'same',input},{candidateId:'same',input}],ranked:[{candidateId:'same',policy_index:1}]}};
 const out=expandLearningTrace(learningTraceForHost(duplicate));assert.equal(out.commonComparison.ranked[0].policy_index,null);
 const wrong={commonComparison:{pool:source.commonComparison.pool,ranked:[{candidateId:'s1',policy_index:0,source:'relay',policy_variant:'follow-up'}]}};
 assert.equal(expandLearningTrace(learningTraceForHost(wrong)).commonComparison.ranked[0].policy_index,null);
});
