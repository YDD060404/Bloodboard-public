import test from 'node:test';
import assert from 'node:assert/strict';
import {auditReplyServices} from '../src/reply-audit.mjs';
import {measureProtectionReplies} from '../src/protection.mjs';
import {learningTraceForHost,expandLearningTrace} from '../src/trace-size.mjs';
test('reply observation preserves original services, receiver, args and exact successful response identity',async()=>{
 const answer={ok:true,complete:false,hasMore:true,returned:16,total:45,truncated:[{reason:'page'}]},options={from:'real'};
 const raw={tag:1,candidates:async function(q){assert.equal(this,raw);assert.equal(q,options);return answer;}};
 const a=auditReplyServices(raw);assert.equal(await a.services.candidates(options),answer);
 assert.equal(raw.candidates!==a.services.candidates,true);assert.equal(answer.complete,false);
 const s=a.snapshot({unknown:true,essentialComplete:false,criticalAdjustment:-250});
 assert.equal(s.calls,1);assert.equal(s.criticalAdjustment,-250);
 assert.ok(s.serviceFacts.some(x=>x.reason==='reply-candidate-page-not-fully-returned'&&x.example.total===45));
 assert.ok(s.serviceFacts.some(x=>x.reason==='reply-candidate-generation-incomplete'));
});
test('exceptions, actual service failures and chance gaps remain visible and are never repaired by diagnostics',async()=>{
 const error=new Error('transport'),failed={ok:false,code:'timeout'},gap={ok:true,exact:false,unresolvedMass:.1,rest:{p:.2},outcomes:[{p:.8,key:null}]};
 const a=auditReplyServices({explore:async()=>gap,validate:async()=>failed,threats:{scoring:async()=>{throw error;}}});
 assert.equal(await a.services.explore({}, {from:'child'}),gap);assert.equal(await a.services.validate({},{}),failed);
 await assert.rejects(a.services.threats.scoring({from:'child'}),e=>e===error);
 const reasons=a.snapshot({}).serviceFacts.map(x=>x.reason);
 for(const r of ['reply-rpc-exception','reply-rpc-service-not-successful','reply-service-inexact','reply-explore-unexpanded-probability','reply-explore-unlisted-probability','reply-successor-key-unavailable'])assert.ok(reasons.includes(r),r);
});
test('incomplete transfer/contact reports expose observed limits without turning proxy adjustment into certified probability',()=>{
 const report={unknown:true,essentialComplete:false,criticalAdjustment:-300,directScore:.5,
  transferContinuation:{incomplete:true,lowerBound:.4,unresolved:.6,lines:[{},{}]},heldReplySkipped:2};
 const a=auditReplyServices({}),s=a.snapshot(report);
 assert.equal(s.flags.essentialComplete,false);assert.equal(s.components[0].unresolved,.6);
 assert.equal(s.components[0].retainedLines,2);assert.equal(s.components[1].count,2);
 assert.equal(report.criticalAdjustment,-300);assert.ok(s.scope.includes('not themselves a new safety'));
});
test('diagnostic-enabled own-End measurement preserves numeric value, source call sequence, unknown and original result flags',async()=>{
 const o={team:'A'},p={endpoints:[{key:'end',p:1,active:'B',observation:{active:'B'}}]};
 async function run(diagnostics){
  const requests=[],services={candidates:async(q)=>{requests.push(q.from);return {ok:true,position:{key:q.from},hasMore:true,complete:true};}};
  const inspect={replyAssessment:async(b,sv)=>{await sv.candidates({from:b.key});return {unknown:true,essentialComplete:false,failed:false,criticalAdjustment:-270,positionAdjustment:-4};}};
  return {r:await measureProtectionReplies(o,p,services,inspect,Date.now()+10000,{diagnostics}),requests};
 }
 const a=await run(false),b=await run(true);const {endpointAudits,...plain}=b.r;
 assert.deepEqual(plain,a.r);assert.deepEqual(b.requests,a.requests);assert.equal(endpointAudits[0].from,'end');
 assert.equal(endpointAudits[0].serviceFacts[0].reason,'reply-candidate-page-not-fully-returned');
});
test('large audit traces reuse exact bounded codec, retaining every endpoint, null, probability and source refusal',()=>{
 const endpointAudits=Array.from({length:20},(_,i)=>({from:'request.'+i,p:1/20,flags:{unknown:true,essentialComplete:false},
  serviceFacts:[{reason:'reply-candidate-page-not-fully-returned',count:1,example:{from:'request.'+i,total:2783,returned:45}}],
  components:[{reason:'reply-transfer-continuation-incomplete',lowerBound:.563532511393229,unresolved:.2893578743131121,nullFact:null}],
  scope:'observed service/component conditions; exact frozen guard provenance is not exposed, so facts are not themselves a new safety or probability certificate'}));
 const trace={planning:{checks:{learnedComparison:{replyMeasurements:[{endpointAudits}]}}}},packed=learningTraceForHost(trace);
 assert.ok(JSON.stringify(packed).length<JSON.stringify(trace).length);
 assert.deepEqual(expandLearningTrace(packed).planning,trace.planning);
 const encoded=packed.planning.checks.learnedComparison.replyMeasurements;
 const field=encoded.traceData?encoded:encoded[0].endpointAudits;
 assert.equal(field.traceData,'bounded-dictionary-lz/v1');
 if(field.data.codec){field.data.checksum^=1;assert.throws(()=>expandLearningTrace(packed));}
});
