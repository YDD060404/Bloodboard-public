import test from 'node:test';
import assert from 'node:assert/strict';
import {requestServices,reusableExplore,boundedProducerServices} from '../src/services.mjs';
const result=()=>({ok:true,exact:true,unresolvedMass:0,rest:{p:0},outcomes:[{p:1,key:'42.1',observation:{players:[],score:{A:0,B:0}},completed:true,turnover:false,touchdown:null}]});
const input={kind:'endTurn'};
const opts={from:'root',team:'A',perspective:'A',decisions:'builtin',observations:true,maxLeaves:100,maxOutcomes:20,maxKeep:64,threshold:1e-6,maxMs:50};
function fixture(){let calls=0;const raw={tag:'correct this',explore:async function(){assert.equal(this.tag,'correct this');calls++;return result();}};const wrapper=requestServices(raw);return {...wrapper,get calls(){return calls;}};}
test('complete maxMs-only hit is detached from first result and earlier hits',async()=>{const f=fixture();const a=await f.services.explore(input,opts);a.outcomes[0].observation.score.A=10;const b=await f.services.explore(input,{...opts,maxMs:100});assert.equal(f.calls,1);assert.equal(b.outcomes[0].observation.score.A,0);b.outcomes[0].observation.score.B=5;const c=await f.services.explore(input,opts);assert.equal(c.outcomes[0].observation.score.B,0);assert.notEqual(a,b);assert.notEqual(b,c);});
test('all semantic options and input fields distinguish keys',async()=>{const changes=[{from:'42.2'},{team:'B'},{perspective:'B'},{decisions:'optimistic'},{observations:false},{features:true},{horizon:'position'},{maxLeaves:101},{maxOutcomes:21},{maxKeep:65},{threshold:1e-5},{unknownFutureOption:true}];for(const change of changes){const f=fixture();await f.services.explore(input,opts);await f.services.explore(input,{...opts,...change});assert.equal(f.calls,2,JSON.stringify(change));}const f=fixture();await f.services.explore(input,opts);await f.services.explore({...input,other:'value'},opts);assert.equal(f.calls,2);});
test('nested option ordering is stable while arrays preserve order',async()=>{const f=fixture();await f.services.explore(input,{...opts,decisions:{own:'builtin',opponent:'adversarial',branchTypes:['x','y']}});await f.services.explore(input,{...opts,decisions:{branchTypes:['x','y'],opponent:'adversarial',own:'builtin'}});assert.equal(f.calls,1);await f.services.explore(input,{...opts,decisions:{own:'builtin',opponent:'adversarial',branchTypes:['y','x']}});assert.equal(f.calls,2);});
test('uncertainty, nonfinite mass and missing retention do not enter cache',async()=>{const variants=[r=>{r.ok=false;},r=>{r.exact=false;},r=>{delete r.exact;},r=>{delete r.rest;},r=>{delete r.unresolvedMass;},r=>{r.unresolvedMass=.1;},r=>{r.rest.p=.1;},r=>{r.outcomes[0].p=.9;},r=>{r.outcomes[0].p=NaN;},r=>{r.outcomes[0].p=Infinity;},r=>{r.outcomes[0].p=-1;},r=>{r.outcomes[0].key=null;},r=>{delete r.outcomes[0].observation;},r=>{r.outcomes=[];}];for(const change of variants){const r=result();change(r);assert.equal(reusableExplore(r),false);let count=0;const f=requestServices({explore:async()=>{count++;return count===1?r:result();}});await f.services.explore(input,opts);await f.services.explore(input,{...opts,maxMs:100});assert.equal(count,2);}});
test('exception is not cached and later complete result is reusable',async()=>{let n=0;const f=requestServices({explore:async()=>{n++;if(n===1)throw Error('transient');return result();}});await assert.rejects(f.services.explore(input,opts),/transient/);await f.services.explore(input,opts);await f.services.explore(input,opts);assert.equal(n,2);});
test('request wrappers never share hypothetical keys',async()=>{const a=fixture(),b=fixture();await a.services.explore(input,opts);await b.services.explore(input,opts);assert.equal(a.calls,1);assert.equal(b.calls,1);});
test('concurrent exact-key misses preserve bounded accounting',async()=>{let releases=[];const f=requestServices({explore:()=>new Promise(resolve=>releases.push(()=>resolve(result())))});const a=f.services.explore(input,opts),b=f.services.explore(input,opts);assert.equal(releases.length,2,'No incomplete coalescing');releases[0]();await a;const size=f.snapshot().retainedBytes;releases[1]();await b;assert.equal(f.snapshot().retainedEntries,1);assert.equal(f.snapshot().retainedBytes,size,'Replacing same key must subtract previous bytes');});
test('zero-entry cache is disabled',async()=>{const f=requestServices({explore:async()=>result()},{maxEntries:0});await f.services.explore(input,opts);assert.equal(f.snapshot().retainedEntries,0);});
test('non-JSON keys fail open to original service, without collapsed collisions',async()=>{let n=0;const f=requestServices({explore:async()=>{n++;return result();}});const cycle={};cycle.self=cycle;await f.services.explore(input,{...opts,unknown:cycle});await f.services.explore(input,{...opts,unknown:10n});await f.services.explore(input,{...opts,unknown:Infinity});await f.services.explore(input,{...opts,unknown:null});await f.services.explore(input,{...opts,unknown:NaN});assert.equal(n,5);});
test('unserializable successful service result stays a successful original response',async()=>{const r=result();r.note=10n;const f=requestServices({explore:async()=>r});assert.equal(await f.services.explore(input,opts),r);assert.equal(f.snapshot().retainedEntries,0);});
test('shared deadline refuses new work and late storage without manufacturing success',async()=>{const NativeDate=Date;let now=1000;class Clock extends NativeDate{static now(){return now;}}try{globalThis.Date=Clock;let n=0;const f=requestServices({explore:async()=>{n++;return result();}},{deadline:2000});await f.services.explore(input,opts);now=2000;const denied=await f.services.explore(input,opts);assert.equal(n,1);assert.equal(denied.ok,false);assert.equal(denied.code,'coach-deadline');assert.equal(f.snapshot().deadlineRefusals,1);assert.equal(f.snapshot().hits,0);let release;now=1000;const late=requestServices({explore:()=>new Promise(resolve=>release=resolve)},{deadline:2000});const pending=late.services.explore(input,opts);now=2001;const r=result();release(r);assert.equal(await pending,r);assert.equal(late.snapshot().retainedEntries,0);}finally{globalThis.Date=NativeDate;}});
test('queued never-resolving RPC is bounded by the shared deadline',async()=>{
 const start=Date.now(),f=requestServices({explore:()=>new Promise(()=>{})},{deadline:start+120});
 const r=await f.services.explore(input,opts);assert.equal(r.ok,false);assert.equal(r.code,'coach-deadline');
 assert.ok(Date.now()-start<600);assert.equal(f.snapshot().deadlineTimeouts,1);assert.equal(f.snapshot().retainedEntries,0);
});
test('late successful or rejected RPCs are consumed and cannot populate cache after deadline',async()=>{
 for(const rejectLate of [false,true]){
  let release;const f=requestServices({explore:()=>new Promise((resolve,reject)=>{release=()=>rejectLate?reject(Error('late failure')):resolve(result());})},{deadline:Date.now()+120});
  const r=await f.services.explore(input,opts);assert.equal(r.code,'coach-deadline');release();await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(f.snapshot().retainedEntries,0);assert.equal((await f.services.explore(input,opts)).code,'coach-deadline');
 }
});

test('production identity gate rejects the old misleading exact result and permits only the repaired interface',async()=>{
 let calls=0;const legacy=requestServices({explore:async()=>{calls++;return {ok:true,exact:true,outcomes:[]};}},{requireOutcomeIdentity:true});
 assert.equal((await legacy.services.explore({kind:'endTurn'},{})).code,'unsupported-outcome-identity');
 assert.equal((await legacy.services.explore({kind:'endTurn'},{})).code,'unsupported-outcome-identity');
 assert.equal(calls,1);assert.equal(legacy.snapshot().incompatibleOutcomeResponses,1);assert.equal(legacy.snapshot().hits,0);
 const repaired=requestServices({explore:async()=>({ok:true,outcomeIdentity:'complete-state-v1',exact:true,outcomes:[]})},{requireOutcomeIdentity:true});
 assert.equal((await repaired.services.explore({kind:'endTurn'},{})).ok,true);assert.equal(repaired.snapshot().outcomeIdentityVerified,true);
});
test('a terminal noKeys request cannot alias executable retention in the request cache',async()=>{
 let calls=0;const f=requestServices({explore:async(i,q)=>{calls++;const r=result();if(q.noKeys)r.outcomes[0].key=null;return r;}});
 const executable=await f.services.explore(input,opts);assert.ok(executable.outcomes[0].key);
 const terminal=await f.services.explore(input,{...opts,noKeys:true});assert.equal(terminal.outcomes[0].key,null);
 const executableAgain=await f.services.explore(input,{...opts,maxMs:100});assert.ok(executableAgain.outcomes[0].key);
 assert.equal(calls,2);assert.equal(f.snapshot().hits,1);
 await f.services.explore(input,{...opts,noKeys:true,maxMs:100});assert.equal(calls,3,'Keyless replies never become executable cached sources');
});

test('one producer budget cannot spend another source slot or prevent cleanup',async()=>{
 let rpc=0,closed=0;const shared={validate:async()=>{rpc++;return {ok:true,legal:true};},fork:{close:async()=>{closed++;return {ok:true};}}};
 const a=boundedProducerServices(shared,{calls:1}),b=boundedProducerServices(shared,{calls:1});
 assert.equal((await a.services.validate(input,{})).ok,true);assert.equal((await a.services.validate(input,{})).code,'coach-producer-budget');
 assert.equal((await b.services.validate(input,{})).ok,true);assert.equal((await a.services.fork.close({})).ok,true);
 assert.equal(rpc,2);assert.equal(closed,1);assert.equal(a.report.refusals,1);
});
test('producer handle reservation stops optional discovery while common services remain usable',async()=>{
 let rpc=0;const shared={explore:async()=>{rpc++;return result();}};
 const a=boundedProducerServices(shared,{calls:5,reservePositions:2200,budgetState:()=>({verified:true,positionsUsed:1780,maxPositions:4000})});
 assert.equal((await a.services.explore(input,{maxOutcomes:40})).code,'coach-producer-budget');
 assert.equal((await a.services.explore(input,{noKeys:true})).ok,true);
 assert.equal((await shared.explore(input,{})).ok,true);assert.equal(rpc,2);
});

test('producer wrapper preserves transport metadata and dependency Maps unchanged',()=>{
 const map=new Map([['key',{plan:{input}}]]),metadata={selected:{preparedBranches:map}};
 const scoped=boundedProducerServices({metadata});
 assert.equal(scoped.services.metadata,metadata);assert.equal(scoped.services.metadata.selected.preparedBranches,map);
});

test('a late producer cannot start a full chance enumeration in an insufficient time slot',async()=>{
 let rpc=0;const scoped=boundedProducerServices({explore:async()=>{rpc++;return result();}});
 const r=await scoped.services.explore(input,{maxMs:124,maxLeaves:8000});
 assert.equal(r.code,'coach-producer-budget');assert.equal(scoped.report.reason,'producer-enumeration-time-insufficient');assert.equal(rpc,0);
 assert.equal((await scoped.services.explore(input,{maxMs:450,maxLeaves:8000})).ok,true);assert.equal(rpc,1);
});

test('short producer chance searches stop by leaf budget and retain native residual unchanged',async()=>{
 let options;const partial={...result(),exact:false,unresolvedMass:.25,rest:{p:.25}};
 const scoped=boundedProducerServices({explore:async(i,q)=>{options=q;return partial;}});
 const r=await scoped.services.explore(input,{maxMs:242,maxLeaves:8000,observations:true});
 assert.equal(options.maxLeaves,64);assert.equal(options.observations,true);assert.equal(r,partial);assert.equal(r.rest.p,.25);
 assert.equal(scoped.report.leafCappedCalls,1);
});
