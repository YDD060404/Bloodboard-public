import test from 'node:test';
import assert from 'node:assert/strict';
import {requestServices,guardLiveExplore,withServiceOwner,withEnumerationDeadline,legacySearchWindow,boundedProducerServices,reserveFutureKeyCapacity} from '../src/services.mjs';

const players=[{id:'A6',team:'A'},{id:'B6',team:'B'}];
const input=(playerId='A6')=>({kind:'playerAction',playerId,action:'blitz',path:[{to:{x:12,y:2},kind:'step'}],blitzTarget:'B6',blockTarget:'B6'});
const options=()=>({from:'202.31',observations:true,maxMs:900,maxLeaves:3500,maxOutcomes:40,maxKeep:256,threshold:.0001,decisions:'builtin',perspective:'A'});
const exact=q=>({ok:true,exact:true,outcomeIdentity:'complete-state-v1',position:{key:q.from??'root'},perspective:'A',activeTeam:'A',
 unresolvedMass:0,rest:{p:0},outcomes:[{key:'202.50',p:1,active:'B',observation:{active:'B',phase:'play'},completed:true,turnover:false}]});
const clock=async run=>{const original=Date.now;let now=1000;Date.now=()=>now;try{await run({now:()=>now,advance:ms=>now+=ms});}finally{Date.now=original;}};
const events=adapter=>{const s=adapter.snapshot().candidateServiceCosts;return s.events.map(r=>Object.fromEntries(s.eventColumns.map((k,i)=>[k,k==='method'?s.methods[r[i]]:k==='status'?s.statuses[r[i]]:k==='reason'?s.reasons[r[i]]:r[i]])));};
const count=(a,phase,method,status)=>events(a).filter(e=>e.phaseId===phase&&e.method===method&&e.status===status).reduce((n,e)=>n+e.count,0);
const params=adapter=>{const s=adapter.snapshot().candidateServiceCosts;return s.parameters.map(r=>Object.fromEntries(s.parameterColumns.map((k,i)=>[k,k==='method'?s.methods[r[i]]:k==='parameter'?s.parameterNames[r[i]]:r[i]])));};
const phaseView=services=>withEnumerationDeadline(services,{deadline:10000,ownTeam:'A',ownPlayerIds:['A6'],source:'legacy-own-search-CFG'});
function fixture({advance=()=>{},validationMs=0,deadline=10000,commonReserveMs=0,extension=true,rawExplore}={}){
 const seen=[];
 const adapter=requestServices({validate:async(i,q)=>{seen.push(['validate',i,q]);advance(validationMs);return {ok:true,legal:true,position:q.from};},
  explore:async(i,q)=>{seen.push(['explore',i,q]);return rawExplore?rawExplore(i,q):exact(q);}},{deadline});
 const guard=guardLiveExplore(adapter.services,'A',players,{deadline,commonReserveMs,complexTimeExtension:extension});
 return {adapter,guard,seen};
}

test('default guard retains old time; opt-in own 900/3500 dispatches 3600 with full original enumeration options',async()=>clock(async()=>{
 const old=fixture({extension:false}),oldOptions=options();await old.guard.services.explore(input(),oldOptions);
 assert.equal(old.seen[1][2],oldOptions);assert.equal(old.guard.snapshot().complexTimeExtended,0);
 const f=fixture(),q=Object.freeze(options()),i=Object.freeze(input());const result=await phaseView(f.guard.services).explore(i,q);
 assert.equal(result.ok,true);assert.equal(f.seen.length,2);assert.equal(f.seen[0][0],'validate');assert.equal(f.seen[1][0],'explore');
 assert.equal(f.seen[1][1],i);assert.deepEqual(f.seen[1][2],{...q,maxMs:3600});assert.equal(q.maxMs,900);
 const s=f.guard.snapshot();assert.equal(s.complexTimeExtended,1);assert.deepEqual(s.complexRequestedMs,{count:1,min:900,max:900});
 assert.deepEqual(s.complexAllocatedMs,{count:1,min:3600,max:3600});assert.equal(s.complexTimeSamples[0].deadlineSource,'legacy-own-search-CFG');
 assert.equal(s.complexTimeSamples[0].stage,'after-validation');assert.equal(s.complexTimeSamples[0].callerDeadline,10000);
 assert.deepEqual(params(f.adapter).filter(p=>p.method==='explore'&&p.parameter==='maxMs'),[{phaseId:null,method:'explore',parameter:'maxMs',count:1,min:3600,max:3600}]);
}));

test('explicit narrower peer window beats immutable whole-phase metadata and validation spends that window',async()=>clock(async({advance})=>{
 const f=fixture({advance,validationMs:100}),caller={deadline:10000,ownTeam:'A',ownPlayerIds:['A6'],source:'legacy-own-search-CFG'};
 const view=withEnumerationDeadline(f.guard.services,caller);caller.deadline=999999;caller.ownPlayerIds.push('B6');caller.source='mutated';
 await view.explore(input(),{...options(),coachEnumerationDeadline:2900});
 assert.equal(f.seen[1][2].maxMs,1760);assert.equal(Object.hasOwn(f.seen[1][2],'coachEnumerationDeadline'),false);
 assert.equal(Object.hasOwn(f.seen[1][2],'coachEnumerationDeadlineSource'),false);
 const s=f.guard.snapshot();assert.equal(s.complexTimeSlotCapped,1);assert.equal(s.complexTimeSamples[0].callerDeadline,2900);
 assert.equal(s.complexTimeSamples[0].deadlineSource,'explicit-caller');
 await view.explore(input('B6'),{...options(),team:'B'});assert.equal(f.seen.at(-1)[2].maxMs,900);
}));

test('missing own caller deadline and a window below the original request refuse before validation without chance mass',async()=>clock(async()=>{
 const f=fixture(),view=withServiceOwner(f.guard.services,{phaseId:'missing'});
 const missing=await view.explore(input(),options());assert.equal(missing.reason,'complex-caller-deadline-unobserved');
 assert.equal(missing.ok,false);assert.equal(missing.outcomes,undefined);assert.equal(missing.rest,undefined);
 const short=await view.explore(input(),{...options(),coachEnumerationDeadline:1939});assert.equal(short.reason,'complex-enumeration-budget-unavailable');
 assert.equal(f.seen.length,0);assert.equal(f.guard.snapshot().complexBudgetRefusals,2);assert.equal(f.adapter.snapshot().serviceFailures.count,0);
 assert.equal(count(f.adapter,'missing','explore','local-refusal'),2);assert.equal(count(f.adapter,'missing','explore','raw-dispatched'),0);
 assert.equal(params(f.adapter).length,0);
}));

test('time profile has a 3000ms floor and 6000ms extension ceiling without shrinking a larger original request',async()=>clock(async()=>{
 for(const [requested,target] of [[600,3000],[2000,6000],[8000,8000]]){
  const f=fixture();await phaseView(f.guard.services).explore(input(),{...options(),maxMs:requested});
  assert.equal(f.seen[1][2].maxMs,target);assert.equal(f.seen[1][2].maxLeaves,3500);
 }
 const f=fixture();const r=await f.guard.services.explore(input(),{...options(),maxMs:undefined,coachEnumerationDeadline:10000});
 assert.equal(r.reason,'complex-request-window-unverified');assert.equal(f.seen.length,0);
}));

test('post-validation exhaustion refuses rather than shrinking the original 900ms request',async()=>clock(async({advance})=>{
 const f=fixture({advance,validationMs:250});const r=await f.guard.services.explore(input(),{...options(),coachEnumerationDeadline:2100});
 assert.equal(r.reason,'complex-enumeration-budget-unavailable');assert.equal(f.seen.length,1);assert.equal(f.seen[0][0],'validate');
 assert.equal(f.guard.snapshot().complexTimeSamples[0].stage,'after-validation');assert.equal(f.guard.snapshot().complexAllocatedMs.count,0);
 assert.equal(params(f.adapter).filter(p=>p.method==='explore').length,0);
}));

test('global reserved headroom caps only added time and cannot be borrowed to fit the original request',async()=>clock(async({advance})=>{
 const capped=fixture({advance,validationMs:100,deadline:5000,commonReserveMs:2000});await phaseView(capped.guard.services).explore(input(),options());
 assert.equal(capped.seen[1][2].maxMs,1860);assert.equal(capped.guard.snapshot().complexTimeSlotCapped,1);
 const refused=fixture({deadline:5000,commonReserveMs:3000});const r=await phaseView(refused.guard.services).explore(input(),options());
 assert.equal(r.reason,'complex-enumeration-budget-unavailable');assert.equal(refused.seen.length,0);
}));

test('opponent actor never borrows own whole deadline; its explicit local window remains authoritative',async()=>clock(async()=>{
 const f=fixture(),view=phaseView(f.guard.services);
 await view.explore(input('B6'),{...options(),team:'B'});assert.equal(f.seen[1][2].maxMs,900);
 assert.equal(f.guard.snapshot().complexUnscopedCalls,1);assert.equal(f.guard.snapshot().complexTimeSamples.length,0);
 await view.explore(input('B6'),{...options(),team:'B',coachEnumerationDeadline:2500});
 // The previous complete cache can answer this exact semantic request, but no
 // synthetic actual-parameter row is added for that hit.
 assert.equal(f.seen.filter(([m])=>m==='explore').length,1);assert.equal(f.adapter.snapshot().hits,1);
 const fresh=fixture();await phaseView(fresh.guard.services).explore(input('B6'),{...options(),team:'B',coachEnumerationDeadline:2500});
 assert.equal(fresh.seen[1][2].maxMs,1460);assert.equal(fresh.guard.snapshot().complexTimeSamples[0].deadlineSource,'explicit-caller');
}));

test('owned deadline views share completed cache and guard stats; allocation is not fake raw-dispatch parameters',async()=>clock(async()=>{
 const f=fixture(),caller=phaseView(f.guard.services),owner={phaseId:'a'},a=withServiceOwner(caller,owner),b=withServiceOwner(caller,{phaseId:'b'});
 owner.phaseId='mutated';await a.explore(input(),options());await b.explore(input(),options());
 assert.equal(f.seen.filter(([m])=>m==='explore').length,1);assert.equal(f.guard.snapshot().complexTimeExtended,2);
 assert.equal(count(f.adapter,'a','explore','raw-dispatched'),1);assert.equal(count(f.adapter,'b','explore','raw-dispatched'),0);
 assert.equal(count(f.adapter,'b','explore','cache-hit'),1);assert.equal(count(f.adapter,'b','validate','raw-dispatched'),1);
 assert.equal(params(f.adapter).filter(p=>p.method==='explore').length,4);assert.ok(params(f.adapter).filter(p=>p.method==='explore').every(p=>p.phaseId==='a'));
 assert.ok(f.seen.every(([, ,q])=>!Object.hasOwn(q,'phaseId')&&!Object.hasOwn(q,'coachEnumerationDeadlineSource')));
}));

test('owner/deadline views preserve producer limits and future-key reservation, with no budget reset',async()=>clock(async()=>{
 const f=fixture(),producer=boundedProducerServices(f.guard.services,{calls:2,deadline:6000});
 const reservation=reserveFutureKeyCapacity(producer.services,()=>({prefix:'202',watermark:60,mixedRequests:false}),{limit:100,outcomesPerCall:40});
 const scoped=phaseView(reservation.services),a=withServiceOwner(scoped,{phaseId:'a'}),b=withServiceOwner(scoped,{phaseId:'b'});
 await a.explore(input(),{...options(),maxLeaves:512});const denied=await b.explore(input(),{...options(),maxLeaves:512});
 assert.equal(denied.code,'coach-producer-budget');assert.equal(producer.report.calls,2);assert.equal(producer.report.logicalCalls,1);
 assert.equal(reservation.report.keylessCalls,2);assert.equal(f.seen[1][2].noKeys,true);assert.equal(f.seen[1][2].maxMs,3600);
 assert.equal(f.seen[1][2].maxLeaves,512);assert.equal(f.seen.length,2);assert.equal(count(f.adapter,'b','explore','local-refusal'),1);
}));

test('existing budget diagnostics cannot consume a caller window and then dispatch into the next phase',async()=>clock(async({advance})=>{
 for(const spent of [1000,3500]){
  const calls=[];let diagnostics=0;
  const adapter=requestServices({capabilities:async()=>({limits:{maxServiceCalls:20,maxPositions:1000}}),
   diagnostics:async()=>{if(++diagnostics>1)advance(spent);return {ok:true,usage:{totalCalls:0,positions:0}};},
   validate:async(i,q)=>({ok:true,legal:true,position:q.from}),explore:async(i,q)=>{calls.push(q);return exact(q);}},
   {deadline:Date.now()+10000,resourceBudget:true,callReserve:0,positionReserve:0});
  await adapter.initialize();const guard=guardLiveExplore(adapter.services,'A',players,{deadline:Date.now()+10000,commonReserveMs:0,complexTimeExtension:true});
  const result=await withServiceOwner(guard.services,{phaseId:'own'}).explore(input(),{...options(),coachEnumerationDeadline:Date.now()+4000});
  assert.equal(diagnostics,2);assert.equal(count(adapter,'own','diagnostics','auxiliary-dispatched'),1);
  if(spent===1000){assert.equal(result.ok,true);assert.equal(calls[0].maxMs,2960);assert.equal(params(adapter).find(p=>p.parameter==='maxMs').min,2960);}
  else{assert.equal(result.reason,'complex-enumeration-budget-unavailable');assert.equal(calls.length,0);assert.equal(adapter.snapshot().resourceBudget.callsUsed,1);
   assert.equal(count(adapter,'own','explore','local-refusal'),1);assert.equal(guard.snapshot().complexBudgetRefusals,1);assert.equal(params(adapter).length,0);}
 }
}));

test('native failure and thrown exception retain original identity rather than becoming admission refusals',async()=>clock(async()=>{
 const failed={ok:false,code:'timeout',message:'native timeout',partialEvidence:null},f=fixture({rawExplore:()=>failed});
 assert.equal(await phaseView(f.guard.services).explore(input(),options()),failed);assert.equal(f.adapter.snapshot().serviceFailures.count,1);
 assert.equal(f.guard.snapshot().complexBudgetRefusals,0);assert.equal(count(f.adapter,null,'explore','response'),1);
 const error=Error('native threw'),throwing=fixture({rawExplore:()=>{throw error;}});
 await assert.rejects(phaseView(throwing.guard.services).explore(input(),options()),e=>e===error);
 assert.equal(count(throwing.adapter,null,'explore','exception'),1);assert.equal(throwing.guard.snapshot().complexBudgetRefusals,0);
}));

test('adapter timer uses actual post-diagnostics deadline and an exhausted shared window consumes no dispatch admission',async()=>clock(async({advance})=>{
 const realSet=setTimeout,realClear=clearTimeout,timers=new Map();let id=0,resolve,diagnostics=0;
 globalThis.setTimeout=(fn,delay)=>{timers.set(++id,{fn,delay});return id;};globalThis.clearTimeout=key=>timers.delete(key);
 try{
  const adapter=requestServices({capabilities:async()=>({limits:{maxServiceCalls:20,maxPositions:1000}}),
   diagnostics:async()=>{if(++diagnostics>1)advance(4000);return {ok:true,usage:{totalCalls:0,positions:0}};},
   explore:()=>new Promise(r=>{resolve=r;})},{deadline:10000,resourceBudget:true,callReserve:0,positionReserve:0});
  await adapter.initialize();const owned=withServiceOwner(adapter.services,{phaseId:'own'}),pending=owned.explore(input(),options());
  for(let n=0;n<8;n++)await Promise.resolve();
  assert.equal(typeof resolve,'function');assert.equal(timers.size,1);const timer=[...timers.values()][0];assert.equal(timer.delay,4960);
  advance(timer.delay);timer.fn();assert.equal((await pending).code,'coach-deadline');
  assert.equal(count(adapter,'own','explore','adapter-deadline'),1);assert.equal(count(adapter,'own','explore','local-refusal'),0);
  resolve(exact(options()));await Promise.resolve();await Promise.resolve();assert.equal(adapter.snapshot().stored,0);
  let dispatched=0,refreshes=0;const deadline=Date.now()+1000;
  const exhausted=requestServices({capabilities:async()=>({limits:{maxServiceCalls:20,maxPositions:1000}}),
   diagnostics:async()=>{if(++refreshes>1)advance(950);return {ok:true,usage:{totalCalls:0,positions:0}};},
   explore:()=>{dispatched++;return exact(options());}},{deadline,resourceBudget:true,callReserve:0,positionReserve:0});
  await exhausted.initialize();const refused=await withServiceOwner(exhausted.services,{phaseId:'late'}).explore(input(),options());
  assert.equal(refused.code,'coach-deadline');assert.equal(dispatched,0);assert.equal(exhausted.snapshot().resourceBudget.callsUsed,0);
  assert.equal(exhausted.snapshot().rpcCalls,0);assert.equal(count(exhausted,'late','explore','local-refusal'),1);assert.equal(params(exhausted).length,0);
 }finally{globalThis.setTimeout=realSet;globalThis.clearTimeout=realClear;}
}));

test('adapter deadline stays shared and late raw completion cannot populate the cache',async()=>clock(async({advance})=>{
 const realSet=setTimeout,realClear=clearTimeout,timers=new Map();let id=0,resolve;
 globalThis.setTimeout=fn=>{timers.set(++id,fn);return id;};globalThis.clearTimeout=key=>timers.delete(key);
 try{
  const f=fixture({rawExplore:()=>new Promise(r=>{resolve=r;})}),owned=withServiceOwner(phaseView(f.guard.services),{phaseId:'own'});
  const pending=owned.explore(input(),options());await Promise.resolve();await Promise.resolve();await Promise.resolve();await Promise.resolve();
  assert.equal(typeof resolve,'function');assert.equal(timers.size,1);advance(9000);[...timers.values()][0]();
  assert.equal((await pending).code,'coach-deadline');assert.equal(count(f.adapter,'own','explore','adapter-deadline'),1);
  assert.equal(count(f.adapter,'own','explore','response'),0);resolve(exact(options()));await Promise.resolve();await Promise.resolve();
  assert.equal(f.adapter.snapshot().stored,0);assert.equal((await owned.explore(input(),options())).ok,false);
  assert.equal(f.seen.filter(([m])=>m==='explore').length,1);
 }finally{globalThis.setTimeout=realSet;globalThis.clearTimeout=realClear;}
}));

test('legacy window mirrors actual frozen CFG allocation, clamps to host, and never rolls forward per explore',async()=>clock(async({advance})=>{
 for(const [timeLimitMs,budgetMs] of [[60000,48000],[55000,44000],[400,320]]){
  const window=legacySearchWindow({started:1000,timeLimitMs,searchShare:.8,maxSearchMs:48000,deadline:100000});
  assert.equal(window.budgetMs,budgetMs);assert.equal(window.deadline,1000+budgetMs);assert.equal(Object.isFrozen(window),true);
  assert.equal(window.allocatedMs,budgetMs);
 }
 const window=legacySearchWindow({started:1000,timeLimitMs:60000,searchShare:.8,maxSearchMs:48000,deadline:46000});
 assert.equal(window.deadline,46000);assert.equal(window.allocatedMs,45000);const f=fixture({deadline:100000}),view=withEnumerationDeadline(f.guard.services,{...window,ownTeam:'A',ownPlayerIds:['A6']});
 advance(44500);const r=await view.explore(input(),options());assert.equal(r.reason,'complex-enumeration-budget-unavailable');assert.equal(f.seen.length,0);
 assert.equal(window.deadline,46000);assert.equal(f.guard.snapshot().complexTimeSamples[0].callerDeadline,46000);
}));
