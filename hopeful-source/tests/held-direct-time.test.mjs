import test from 'node:test';
import assert from 'node:assert/strict';
import {requestServices,guardLiveExplore,withServiceOwner} from '../src/services.mjs';
import {sampleReplyWindow,fixedReplyWindow,retainedDirectOptions} from '../src/reply-window.mjs';
const clone=x=>JSON.parse(JSON.stringify(x));
const limits={maxServiceCalls:12000,maxPositions:8000,maxOutcomesPerCall:40,maxCallMs:15000};
function clock(t){let now=1000;t.mock.method(Date,'now',()=>now);return {now:()=>now,advance:n=>now+=n};}
const opposite=me=>me==='A'?'B':'A';
function fixture(me='A',action='move'){
 const opp=opposite(me),actor=opp+'10',input={kind:'playerAction',playerId:actor,action,path:[{kind:'step',to:{x:0,y:2}}]};
 const out={key:'25.2624',p:1,active:opp,completed:true,turnover:false,touchdown:null,observation:{requestId:25,team:me,active:opp,phase:'play',pending:null,
  ball:{kind:'held',playerId:actor},players:[{id:actor,team:opp,location:'pitch',stance:'standing',rooted:false,pos:{x:1,y:3}}]}};
 const options={from:out.key,team:opp,perspective:me,observations:true,decisions:'builtin',maxOutcomes:20,maxKeep:256,maxLeaves:1800,threshold:0.0001,maxMs:550};
 return {me,opp,actor,input,out,options,players:[{id:me+'1',team:me},{id:actor,team:opp}]};
}
async function setup(t,{me='A',action='move',enabled=true,serviceMs=50000,maxCallMs=15000,outer=9000,soft=1700,hard=null,validateAdvance=0,diagnosticAdvance=()=>0,validation=null,result=null}={}){
 const c=clock(t),f=fixture(me,action),seen=[];let diagnostics=0,validations=0;
 const raw={capabilities:async()=>({limits:{...limits,maxCallMs}}),diagnostics:async()=>{c.advance(diagnosticAdvance(++diagnostics));return {ok:true,usage:{totalCalls:0,positions:0},limitsLeft:{leaves:2000000,serviceMs}};},
  validate:async(i,q)=>{validations++;c.advance(validateAdvance);return validation??{ok:true,legal:true,position:q.from};},
  explore:async(i,q)=>{seen.push({input:i,options:q});return result??{ok:true,exact:false,outcomeIdentity:'complete-state-v1',position:{key:q.from},applied:{maxMs:q.maxMs},unresolvedMass:.1,rest:{p:.2},outcomes:[]};}};
 const adapter=requestServices(raw,{deadline:100000,resourceBudget:true,callReserve:0,positionReserve:0});await adapter.initialize();
 const guard=guardLiveExplore(adapter.services,me,f.players,{deadline:100000,heldDirectTimeExtension:enabled,complexTimeExtension:true});
 let view=sampleReplyWindow(withServiceOwner(guard.services,{phaseId:'held'}),()=>outer-c.now());
 if(hard!==null)view=fixedReplyWindow(view,hard,'real-peer');
 view=fixedReplyWindow(view,soft,'champion-held-reply-deadline');
 const call=(out=f.out,options=f.options,input=f.input)=>view.explore(input,retainedDirectOptions(view,out,input,options,me));
 return {c,f,seen,adapter,guard,view,call,validations:()=>validations,diagnostics:()=>diagnostics};
}
for(const me of ['A','B'])for(const action of ['move','blitz'])test('qualified '+me+' foreign '+action+' uses1500 and preserves actual soft/outer/probability options',async t=>{
 const f=await setup(t,{me,action});const before=clone(f.f),r=await f.call();
 assert.equal(f.seen.length,1);assert.deepEqual(f.f,before);assert.deepEqual(f.seen[0].options,{...f.f.options,maxMs:1500});
 assert.equal(r.exact,false);assert.equal(r.unresolvedMass,.1);assert.equal(r.rest.p,.2);
 const sample=f.guard.snapshot().heldDirectSamples[0];assert.equal(sample.requestedMs,550);assert.equal(sample.desiredMs,1500);assert.equal(sample.allocatedMs,1500);
 assert.equal(sample.heldSoftDeadline,1700);assert.equal(sample.outerDeadline,9000);assert.equal(sample.softWindowOverride,true);assert.equal(sample.calleeClockObserved,true);
 assert.equal(sample.sourceValidation.position,f.f.out.key);assert.equal(sample.responseApplied.maxMs,1500);
 assert.equal(f.adapter.snapshot().serviceFailures.count,0);
});
test('no opt-in retains Move550 and emits no held diagnostic fields',async t=>{
 const f=await setup(t,{enabled:false});await f.call();assert.equal(f.seen[0].options.maxMs,550);
 assert.equal(Object.hasOwn(f.guard.snapshot(),'heldDirectSamples'),false);
 assert.equal(retainedDirectOptions(f.view,f.f.out,f.f.input,f.f.options,'A'),f.f.options);
});
test('unguarded callee preserves original options identity without sampling or metadata',()=>{
 const f=fixture(),raw={explore(){}};assert.equal(sampleReplyWindow(raw,()=>{throw Error('must not sample');}),raw);
 assert.equal(retainedDirectOptions(raw,f.out,f.input,f.options,'A'),f.options);
});
test('unmarked ordinary or foreign Move stays550 despite enabled profile',async t=>{
 const f=await setup(t);await f.view.explore(f.f.input,f.f.options);assert.equal(f.seen[0].options.maxMs,550);assert.equal(f.guard.snapshot().heldDirectCalls,undefined);
});
test('tighter hard peer and explicit external input window outrank held soft override',async t=>{
 const f=await setup(t,{hard:1800,soft:1300});await f.call();assert.equal(f.seen[0].options.maxMs,760);assert.equal(f.guard.snapshot().heldDirectSamples[0].hardDeadline,1800);
 await f.call(f.f.out,{...f.f.options,coachEnumerationDeadline:1650,coachEnumerationDeadlineSource:'explicit-peer'});
 assert.equal(f.seen[1].options.maxMs,610);
});
test('expired hard window refuses before validate; missing proof never dispatches',async t=>{
 const f=await setup(t,{hard:1550});let r=await f.call();assert.equal(r.reason,'held-direct-enumeration-budget-unavailable');assert.equal(f.validations(),0);assert.equal(f.seen.length,0);
 assert.equal(r.outcomes,undefined);assert.equal(r.rest,undefined);assert.equal(f.adapter.snapshot().serviceFailures.count,0);
});
test('real validation consumes outer window and cannot roll it forward',async t=>{
 const f=await setup(t,{outer:2000,validateAdvance:450});const r=await f.call();
 assert.equal(f.validations(),1);assert.equal(f.seen.length,0);assert.equal(r.reason,'held-direct-enumeration-budget-unavailable');assert.equal(f.guard.snapshot().heldDirectSamples[0].outerDeadline,2000);
});
test('adapter refresh after guard admission performs final hard-window gate',async t=>{
 // init diagnostics#1, guard service budget#2, dispatch position refresh#3.
 const f=await setup(t,{outer:2000,diagnosticAdvance:n=>n===3?450:0});const r=await f.call();
 assert.equal(f.seen.length,0);assert.equal(r.reason,'held-direct-enumeration-budget-unavailable');assert.equal(f.adapter.snapshot().serviceFailures.count,0);
});
test('real service reserve caps or refuses without invented chance',async t=>{
 const f=await setup(t,{serviceMs:15600});await f.call();assert.equal(f.seen[0].options.maxMs,600);
});
test('service reserve below original raw request remains unknown local refusal',async t=>{
 const f=await setup(t,{serviceMs:15549});const r=await f.call();assert.equal(r.reason,'held-direct-enumeration-budget-unavailable');assert.equal(f.seen.length,0);assert.equal(r.outcomes,undefined);
});
for(const change of ['holder','request','phase','pending','active','actor','source','probability'])test('public source '+change+' mismatch cannot use time policy',async t=>{
 const f=await setup(t),out=clone(f.f.out);
 if(change==='holder')out.observation.ball.playerId='B2';if(change==='request')out.observation.requestId=26;
 if(change==='phase')out.observation.phase='halfOver';if(change==='pending')out.observation.pending={type:'choice'};
 if(change==='active')out.active='A';if(change==='actor')out.observation.players[0].team='A';
 if(change==='source')out.key='25.999';if(change==='probability')out.p=NaN;
 const r=await f.call(out);assert.equal(r.reason,'held-direct-source-or-signature-unverified');assert.equal(f.seen.length,0);
});
for(const patch of [{maxOutcomes:24},{maxKeep:128},{maxLeaves:1400},{threshold:.00001},{maxMs:551},{extra:true}])test('exact signature mismatch '+JSON.stringify(patch)+' refuses',async t=>{
 const f=await setup(t);const r=await f.call(f.f.out,{...f.f.options,...patch});assert.equal(r.reason,'held-direct-source-or-signature-unverified');assert.equal(f.seen.length,0);
});
test('illegal or unverified actual source is not native explored',async t=>{
 const f=await setup(t,{validation:{ok:true,legal:false,position:'25.2624',errors:['occupied']}});const r=await f.call();assert.equal(r.reason,'input-illegal');assert.equal(f.seen.length,0);assert.equal(f.guard.snapshot().illegal,1);
});
test('original native failure object and adapter failure accounting stay intact',async t=>{
 const failure={ok:false,code:'timeout',message:'actual mock failure',errors:['actual mock failure']},f=await setup(t,{result:failure});
 assert.equal(await f.call(),failure);assert.equal(f.adapter.snapshot().serviceFailures.count,1);assert.equal(f.guard.snapshot().heldDirectSamples[0].responseApplied,null);
});
test('owner views share original cache without private metadata in host options or cache identity',async t=>{
 const result={ok:true,exact:true,outcomeIdentity:'complete-state-v1',position:{key:'25.2624'},applied:{maxMs:1500},unresolvedMass:0,rest:{p:0},outcomes:[{key:'25.2625',p:1,active:'B',observation:{requestId:25,phase:'play',active:'B'},completed:true,turnover:false,touchdown:null}]};
 const f=await setup(t,{result});await f.call();await f.call();assert.equal(f.seen.length,1);assert.equal(f.adapter.snapshot().hits,1);
 assert.deepEqual(Object.keys(f.seen[0].options).sort(),Object.keys(f.f.options).sort());
 const costs=f.adapter.snapshot().candidateServiceCosts;assert.ok(costs.events.some(e=>e[0]==='held'&&costs.statuses[e[2]]==='raw-dispatched'));
});

test('dispatch refresh rechecks actual service reserve and does not increase raw budget',async t=>{
 const c=clock(t),f=fixture();let diag=0,seen=0;
 const adapter=requestServices({capabilities:async()=>({limits}),diagnostics:async()=>({ok:true,usage:{totalCalls:0,positions:0},limitsLeft:{leaves:2000000,serviceMs:++diag<3?50000:15549}}),
  validate:async(i,q)=>({ok:true,legal:true,position:q.from}),explore:async()=>{seen++;throw Error('must not dispatch');}},
  {deadline:100000,resourceBudget:true,callReserve:0,positionReserve:0});await adapter.initialize();
 const guard=guardLiveExplore(adapter.services,'A',f.players,{deadline:100000,heldDirectTimeExtension:true});
 const view=fixedReplyWindow(sampleReplyWindow(guard.services,()=>9000-c.now()),1300,'champion-held-reply-deadline');
 const r=await view.explore(f.input,retainedDirectOptions(view,f.out,f.input,f.options,'A'));
 assert.equal(r.reason,'held-direct-enumeration-budget-unavailable');assert.equal(seen,0);assert.equal(adapter.snapshot().rpcCalls,1);
 assert.equal(adapter.snapshot().serviceFailures.count,0);
});
test('mismatched actual validate source fails closed',async t=>{
 const f=await setup(t,{validation:{ok:true,legal:true,position:'25.999'}});const r=await f.call();assert.equal(r.reason,'source-legality-unverified');assert.equal(f.seen.length,0);
});

test('unknown real service headroom is a local refusal and not successful zero-risk evidence',async t=>{
 const c=clock(t),f=fixture();let dispatched=0;
 const raw={validate:async(i,q)=>({ok:true,legal:true,position:q.from}),explore:async()=>{dispatched++;},replyTimeBudget:async()=>null};
 const guard=guardLiveExplore(raw,'A',f.players,{deadline:100000,heldDirectTimeExtension:true});
 const view=fixedReplyWindow(sampleReplyWindow(guard.services,()=>9000-c.now()),1700,'champion-held-reply-deadline');
 const r=await view.explore(f.input,retainedDirectOptions(view,f.out,f.input,f.options,'A'));
 assert.equal(r.reason,'held-direct-service-budget-unverified');assert.equal(dispatched,0);assert.equal(r.outcomes,undefined);assert.equal(r.rest,undefined);
});
test('an unobserved outer window never borrows the whole adapter deadline',async t=>{
 clock(t);const f=fixture();let dispatched=0;
 const guard=guardLiveExplore({validate:async(i,q)=>({ok:true,legal:true,position:q.from}),explore:async()=>{dispatched++;},replyTimeBudget:async()=>({verified:true,serviceMsLeft:50000,maxCallMs:15000})},'A',f.players,{deadline:100000,heldDirectTimeExtension:true});
 const view=fixedReplyWindow(guard.services,1700,'champion-held-reply-deadline');
 const r=await view.explore(f.input,retainedDirectOptions(view,f.out,f.input,f.options,'A'));
 assert.equal(r.reason,'held-direct-source-or-signature-unverified');assert.equal(dispatched,0);
});

for(const maxCallMs of [550,549])test('actual host maxCallMs '+maxCallMs+' is binding',async t=>{
 const f=await setup(t,{maxCallMs}),r=await f.call();
 if(maxCallMs===550){assert.equal(f.seen[0].options.maxMs,550);assert.equal(f.guard.snapshot().heldDirectExtended,undefined);}
 else{assert.equal(r.reason,'held-direct-enumeration-budget-unavailable');assert.equal(f.seen.length,0);}
});
