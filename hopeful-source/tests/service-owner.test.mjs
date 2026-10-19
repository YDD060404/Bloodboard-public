import test from 'node:test';
import assert from 'node:assert/strict';
import {requestServices,guardLiveExplore,boundedProducerServices,reserveFutureKeyCapacity,withServiceOwner,recordServiceObservation} from '../src/services.mjs';
const move=(id='p',action='move')=>({kind:'playerAction',playerId:id,action,path:[]});
const end={kind:'endTurn'};
const exact=(key='42.1')=>({ok:true,exact:true,outcomeIdentity:'complete-state-v1',position:{key:'root'},perspective:'A',activeTeam:'A',
 unresolvedMass:0,rest:{p:0},outcomes:[{key,p:1,active:'B',observation:{active:'B',phase:'play'},completed:true,turnover:false}]});
const costs=a=>a.snapshot().candidateServiceCosts;
const eventRows=a=>{const s=costs(a);return s.events.map(r=>Object.fromEntries(s.eventColumns.map((k,i)=>[k,k==='method'?s.methods[r[i]]:k==='status'?s.statuses[r[i]]:k==='reason'?s.reasons[r[i]]:r[i]])));};
const count=(a,phaseId,method,status,reason)=>eventRows(a).filter(r=>r.phaseId===phaseId&&r.method===method&&r.status===status&&(reason===undefined||r.reason===reason)).reduce((n,r)=>n+r.count,0);
const parameters=a=>{const s=costs(a);return s.parameters.map(r=>Object.fromEntries(s.parameterColumns.map((k,i)=>[k,k==='method'?s.methods[r[i]]:k==='parameter'?s.parameterNames[r[i]]:r[i]])));};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

test('interleaved owners keep attribution and share the completed cache, never the in-flight work',async()=>{
 const first=deferred(),second=deferred(),calls=[];
 const adapter=requestServices({explore:(i,q)=>{calls.push([i,q]);return calls.length===1?first.promise:second.promise;}});
 const owner={phaseId:'a'},a=withServiceOwner(adapter.services,owner),b=withServiceOwner(adapter.services,{phaseId:'b'});
 owner.phaseId='mutated';
 const options={from:'root',maxMs:400,maxLeaves:20,maxOutcomes:5,maxKeep:5},before=JSON.stringify(options),one=a.explore(end,options),two=b.explore(end,options);
 assert.equal(calls.length,2);second.resolve(exact());await two;first.resolve(exact());await one;
 assert.equal(count(adapter,'a','explore','raw-dispatched'),1);assert.equal(count(adapter,'b','explore','raw-dispatched'),1);
 assert.equal(count(adapter,'a','explore','response'),1);assert.equal(count(adapter,'b','explore','response'),1);
 assert.deepEqual(await b.explore(end,{...options,maxMs:900}),exact());assert.equal(calls.length,2);
 assert.equal(count(adapter,'b','explore','cache-hit'),1);assert.equal(count(adapter,'mutated','explore','adapter-attempt'),0);
 assert.equal(JSON.stringify(options),before);assert.ok(calls.every(([,q])=>!Object.hasOwn(q,'phaseId')&&!Object.hasOwn(q,'owner')));
 assert.equal(recordServiceObservation(b,{method:'reply-cache',status:'helper-cache-hit'}),true);
 assert.equal(count(adapter,'b','reply-cache','helper-cache-hit'),1);
});

test('guard pre/post validation refusals share stats and attribute the validation to the same owner',async()=>{
 const realNow=Date.now,base=realNow();let now=base,validations=0,explores=0;
 Date.now=()=>now;
 try{
  const adapter=requestServices({validate:async()=>{validations++;now+=300;return {ok:true,legal:true,position:'root'};},explore:async()=>{explores++;return exact();}});
  const guard=guardLiveExplore(adapter.services,'A',[{id:'p',team:'A'}]);
  const pre=withServiceOwner(guard.services,{phaseId:'pre'}),post=withServiceOwner(guard.services,{phaseId:'post'});
  assert.equal((await pre.explore(move('p','block'),{maxMs:1000,coachEnumerationDeadline:base+500})).reason,'complex-enumeration-budget-unavailable');
  assert.equal(validations,0);
  assert.equal((await post.explore(move('p','block'),{maxMs:1000,coachEnumerationDeadline:base+1200})).reason,'complex-enumeration-budget-unavailable');
  assert.equal(validations,1);assert.equal(explores,0);
  assert.equal(count(adapter,'pre','explore','local-refusal'),1);assert.equal(count(adapter,'post','explore','local-refusal'),1);
  assert.equal(count(adapter,'pre','validate','raw-dispatched'),0);assert.equal(count(adapter,'post','validate','raw-dispatched'),1);
  assert.equal(guard.snapshot().complexBudgetRefusals,2);assert.equal(guard.snapshot().checked,2);
  assert.equal(adapter.snapshot().serviceFailures.count,0);
 }finally{Date.now=realNow;}
});

test('owner views cannot reset or bypass producer admission, guard state or leaf caps',async()=>{
 const rawCalls=[],adapter=requestServices({validate:async(i,q)=>{rawCalls.push(['validate',i,q]);return {ok:true,legal:true,position:q.from};},explore:async(i,q)=>{rawCalls.push(['explore',i,q]);return exact();}});
 const guard=guardLiveExplore(adapter.services,'A',[{id:'p',team:'A'}]);
 const producer=boundedProducerServices(guard.services,{calls:2,deadline:Date.now()+10000});
 const a=withServiceOwner(producer.services,{phaseId:'a'}),b=withServiceOwner(producer.services,{phaseId:'b'});
 assert.equal((await a.explore(move(),{maxMs:300,maxLeaves:3500})).ok,true);
 assert.equal((await b.explore(move(),{maxMs:300,maxLeaves:3500})).code,'coach-producer-budget');
 assert.equal(producer.report.calls,2);assert.equal(producer.report.logicalCalls,1);assert.equal(producer.report.refusals,1);
 assert.equal(rawCalls.length,2);assert.equal(rawCalls[1][2].maxLeaves,64);assert.equal(guard.snapshot().checked,1);
 assert.equal(count(adapter,'a','validate','raw-dispatched'),1);assert.equal(count(adapter,'a','explore','raw-dispatched'),1);
 assert.equal(count(adapter,'b','explore','local-refusal','producer-call-slot-exhausted'),1);
 assert.equal(count(adapter,'b','explore','adapter-attempt'),0);
 const c=withServiceOwner(a,{phaseId:'c'});assert.equal((await c.validate(move())).code,'coach-producer-budget');
 assert.equal(producer.report.calls,2);assert.equal(adapter.snapshot().serviceFailures.count,0);
});

test('key-reservation views preserve their shared ceiling and native noKeys behavior',async()=>{
 let positions=10;const calls=[];
 const adapter=requestServices({capabilities:async()=>({limits:{maxServiceCalls:1000,maxPositions:30}}),diagnostics:async()=>({ok:true,usage:{totalCalls:0,positions}}),explore:async(i,q)=>{calls.push(q);return exact();}},{resourceBudget:true,callReserve:0,positionReserve:0});await adapter.initialize();
 const reservation=reserveFutureKeyCapacity(adapter.services,adapter.keyStock,{limit:30,outcomesPerCall:6});
 await withServiceOwner(reservation.services,{phaseId:'a'}).explore(move('a'),{from:'42.8',maxOutcomes:6});
 positions=18;await withServiceOwner(reservation.services,{phaseId:'b'}).explore(move('b'),{from:'42.8',maxOutcomes:6});
 assert.equal(calls[0].noKeys,undefined);assert.equal(calls[1].noKeys,true);
 assert.equal(reservation.report.initialPositionsUsed,10);assert.equal(reservation.report.speculativeCeiling,20);assert.equal(reservation.report.keylessCalls,1);
 assert.equal(count(adapter,'a','explore','raw-dispatched'),1);assert.equal(count(adapter,'b','explore','raw-dispatched'),1);
});

test('effective dispatch parameters include wrapper adjustments and auxiliary refresh belongs to its triggering owner',async()=>{
 const calls=[];let hostCalls=0;
 const raw={capabilities:async()=>({limits:{maxServiceCalls:100,maxPositions:200,maxOutcomesPerCall:40}}),
  diagnostics:async()=>({ok:true,usage:{totalCalls:hostCalls,positions:0}}),
  validate:async(i,q)=>{hostCalls++;return {ok:true,legal:true,position:q.from};},
  explore:async(i,q)=>{hostCalls++;calls.push(['explore',q]);return exact();},
  candidates:async q=>{hostCalls++;calls.push(['candidates',q]);return {ok:true,candidates:[]};}};
 const deadline=Date.now()+5000,adapter=requestServices(raw,{resourceBudget:true,callReserve:0,positionReserve:0,deadline});await adapter.initialize();
 const guard=guardLiveExplore(adapter.services,'A',[{id:'p',team:'A'}],{deadline,commonReserveMs:0,passMinMs:400,passMaxMs:800,passTimeScale:4});
 const producer=boundedProducerServices(guard.services,{calls:10,deadline:Date.now()+700});
 await withServiceOwner(producer.services,{phaseId:'a'}).explore(move('p','pass'),{maxMs:200,maxLeaves:3500,maxOutcomes:12,maxKeep:9});
 await withServiceOwner(adapter.services,{phaseId:'b'}).candidates({maxMs:100000});
 const native=calls.find(r=>r[0]==='explore')[1];assert.ok(native.maxMs>200&&native.maxMs<800);assert.equal(native.maxLeaves,64);assert.equal(native.coachEnumerationDeadline,undefined);
 for(const [key,value] of Object.entries({maxMs:native.maxMs,maxLeaves:64,maxOutcomes:12,maxKeep:9})){
  const row=parameters(adapter).find(r=>r.phaseId==='a'&&r.method==='explore'&&r.parameter===key);
  assert.equal(row.count,1);assert.equal(row.min,value);assert.equal(row.max,value);
 }
 const candidateParams=calls.find(r=>r[0]==='candidates')[1],row=parameters(adapter).find(r=>r.phaseId==='b'&&r.method==='candidates'&&r.parameter==='maxMs');
 assert.ok(candidateParams.maxMs<5000);assert.equal(row.max,candidateParams.maxMs);
 assert.equal(count(adapter,null,'capabilities','auxiliary-dispatched'),1);assert.equal(count(adapter,null,'capabilities','auxiliary-response'),1);
 assert.equal(count(adapter,null,'diagnostics','auxiliary-dispatched'),1);assert.equal(count(adapter,'a','diagnostics','auxiliary-dispatched'),1);assert.equal(count(adapter,'a','diagnostics','auxiliary-response'),1);
 assert.equal(adapter.snapshot().rpcCalls,3);assert.equal(adapter.snapshot().resourceBudget.snapshotRPCs,2);
});

test('auxiliary exceptions remain distinct from an explore dispatch and preserve the original budget refusal',async()=>{
 let diagnostics=0,explores=0;
 const adapter=requestServices({capabilities:async()=>({limits:{maxServiceCalls:10,maxPositions:200}}),diagnostics:async()=>{if(++diagnostics>1)throw Error('diagnostic failed');return {ok:true,usage:{totalCalls:0,positions:0}};},explore:async()=>{explores++;return exact();}},{resourceBudget:true,callReserve:0,positionReserve:0});
 await adapter.initialize();const r=await withServiceOwner(adapter.services,{phaseId:'a'}).explore(end,{maxOutcomes:5});
 assert.equal(r.code,'coach-resource-budget');assert.equal(r.message,'public-budget-state-unverified');assert.equal(explores,0);
 assert.equal(count(adapter,'a','diagnostics','auxiliary-dispatched'),1);assert.equal(count(adapter,'a','diagnostics','exception'),1);
 assert.equal(count(adapter,'a','explore','local-refusal','public-budget-state-unverified'),1);assert.equal(count(adapter,'a','explore','raw-dispatched'),0);
});

test('exceptions preserve rejection identity and adapter deadlines do not invent a raw response or host completion',async()=>{
 const error=Error('raw failed'),adapter=requestServices({validate:()=>{throw error;}});
 await assert.rejects(withServiceOwner(adapter.services,{phaseId:'exception'}).validate(end),e=>e===error);
 assert.equal(count(adapter,'exception','validate','raw-dispatched'),1);assert.equal(count(adapter,'exception','validate','exception'),1);assert.equal(count(adapter,'exception','validate','response'),0);
 const pending=deferred(),timed=requestServices({explore:()=>pending.promise,validate:async()=>({ok:true})},{deadline:Date.now()+180});
 const result=await withServiceOwner(timed.services,{phaseId:'timeout'}).explore(end,{maxMs:1000});assert.equal(result.code,'coach-deadline');
 assert.equal(count(timed,'timeout','explore','raw-dispatched'),1);assert.equal(count(timed,'timeout','explore','adapter-deadline'),1);assert.equal(count(timed,'timeout','explore','response'),0);
 pending.resolve(exact());await Promise.resolve();await Promise.resolve();
 assert.equal(count(timed,'timeout','explore','response'),0);assert.equal(timed.snapshot().stored,0);
 assert.equal((await withServiceOwner(timed.services,{phaseId:'after'}).validate(end)).code,'coach-deadline');
 assert.equal(count(timed,'after','validate','local-refusal'),1);assert.equal(count(timed,'after','validate','raw-dispatched'),0);
});

test('final-validation owner view retains the original exception to the call reserve',async()=>{
 let validations=0;const adapter=requestServices({capabilities:async()=>({limits:{maxServiceCalls:2,maxPositions:200}}),diagnostics:async()=>({ok:true,usage:{totalCalls:0,positions:0}}),validate:async()=>{validations++;return {ok:true};}},{resourceBudget:true,callReserve:1,positionReserve:0});
 await adapter.initialize();const normal=withServiceOwner(adapter.services,{phaseId:'normal'});
 assert.equal((await normal.validate(end)).ok,true);assert.equal((await normal.validate(end)).code,'coach-resource-budget');
 assert.equal((await withServiceOwner(adapter.finalServices,{phaseId:'final'}).validate(end)).ok,true);assert.equal(validations,2);
 assert.equal(count(adapter,'final','validate','raw-dispatched'),1);
});

test('native failure responses and later shared-budget refusals retain different statuses and owners',async()=>{
 let explores=0;const adapter=requestServices({capabilities:async()=>({limits:{maxServiceCalls:10,maxPositions:200}}),diagnostics:async()=>({ok:true,usage:{totalCalls:0,positions:0}}),explore:async()=>{explores++;return {ok:false,code:'time-budget',message:'native stopped'};}},{resourceBudget:true,callReserve:0,positionReserve:0});
 await adapter.initialize();const failed=await withServiceOwner(adapter.services,{phaseId:'first'}).explore(end,{maxOutcomes:5});
 assert.deepEqual(failed,{ok:false,code:'time-budget',message:'native stopped'});
 assert.equal((await withServiceOwner(adapter.services,{phaseId:'later'}).explore(end,{maxOutcomes:5})).code,'coach-resource-budget');
 assert.equal(count(adapter,'first','explore','response','time-budget'),1);assert.equal(count(adapter,'first','explore','local-refusal'),0);
 assert.equal(count(adapter,'later','explore','local-refusal','host-time-budget'),1);assert.equal(count(adapter,'later','explore','raw-dispatched'),0);
 assert.equal(explores,1);assert.equal(adapter.snapshot().serviceFailures.count,1);
});

test('terminal-position and response-contract refusals cannot be confused with undispatched host failures',async()=>{
 const adapter=requestServices({explore:async()=>{const r=exact();r.outcomes[0].observation.phase='fullTime';return r;}},{requestId:42});
 await withServiceOwner(adapter.services,{phaseId:'terminal'}).explore(end,{});
 assert.equal((await withServiceOwner(adapter.services,{phaseId:'continuation'}).explore(end,{from:'42.1'})).code,'coach-terminal-position');
 assert.equal(count(adapter,'continuation','explore','local-refusal','coach-terminal-position'),1);assert.equal(count(adapter,'continuation','explore','raw-dispatched'),0);
 assert.equal(adapter.snapshot().serviceFailures.count,0);
 const unsupported=requestServices({explore:async()=>({ok:true,outcomeIdentity:'grouped'})},{requireOutcomeIdentity:true});
 assert.equal((await withServiceOwner(unsupported.services,{phaseId:'first'}).explore(end,{})).code,'unsupported-outcome-identity');
 assert.equal((await withServiceOwner(unsupported.services,{phaseId:'later'}).explore(end,{})).code,'unsupported-outcome-identity');
 assert.equal(count(unsupported,'first','explore','raw-dispatched'),1);assert.equal(count(unsupported,'first','explore','response'),1);assert.equal(count(unsupported,'first','explore','adapter-rejection','unsupported-outcome-identity'),1);
 assert.equal(count(unsupported,'later','explore','raw-dispatched'),0);assert.equal(count(unsupported,'later','explore','local-refusal','unsupported-outcome-identity'),1);
});

test('unknown mocks remain unobserved and aggregates grow by grouping rather than by call count',async()=>{
 const mock={validate:async()=>({ok:true})};assert.equal(withServiceOwner(mock,{phaseId:'unknown'}),mock);assert.equal(recordServiceObservation(mock,{method:'phase',status:'phase-enter'}),false);
 const unknownGuard=guardLiveExplore(mock,'A').services;assert.equal(withServiceOwner(unknownGuard,{phaseId:'unknown'}),unknownGuard);assert.equal(recordServiceObservation(unknownGuard,{method:'phase',status:'phase-enter'}),false);
 const adapter=requestServices(mock),owned=withServiceOwner(adapter.services,{phaseId:'a'});
 assert.equal(recordServiceObservation(owned,{method:'phase',status:'phase-enter'}),true);
 for(let i=0;i<250;i++)await owned.validate(end);
 assert.equal(costs(adapter).events.length,4);assert.equal(count(adapter,'a','validate','raw-dispatched'),250);
 const snapshot=costs(adapter);snapshot.events[0][4]=999;assert.equal(count(adapter,'a','phase','phase-enter'),1);
 assert.ok(costs(adapter).scope.includes('not a per-call log'));
});
