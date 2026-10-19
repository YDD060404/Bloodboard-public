import {timeoutWitness} from './timeout-evidence.mjs';
import {periodPhase} from './period-boundary.mjs';
const serviceViews=new WeakMap();
const enumerationAdmissions=new WeakMap();
const retainedDirectWindows=new WeakMap();
const speculativePositionReservations=new WeakMap();
/** Private provenance from the real guarded callee. Never a native/cache field. */
export function markRetainedDirectOptions(options,proof){
 retainedDirectWindows.set(options,Object.freeze({...proof}));return options;
}
export function copyRetainedDirectOptions(original,copy){
 const proof=retainedDirectWindows.get(original);
 if(proof){
  const explicit=original.coachEnumerationDeadline;
  const hard=Number.isFinite(explicit)&&(original.coachEnumerationDeadlineSource!=='champion-held-reply-deadline'||explicit<proof.heldSoftDeadline);
  retainedDirectWindows.set(copy,hard?Object.freeze({...proof,hardDeadline:Math.min(proof.hardDeadline,explicit)}):proof);
 }
 return copy;
}
const parameterNames=['maxMs','maxLeaves','maxOutcomes','maxKeep'];

/** Owner views share the original adapter and every admission wrapper. Nothing
 * is added to transport arguments or cache keys; unobserved mocks stay intact. */
export function withServiceOwner(services,owner){
 const meta=serviceViews.get(services);
 if(!meta)return services;
 const pinned=Object.freeze({phaseId:typeof owner?.phaseId==='string'?owner.phaseId:null});
 if(meta.owner?.phaseId===pinned.phaseId)return services;
 return meta.bind(pinned);
}
export function recordServiceObservation(services,event){
 const meta=serviceViews.get(services);
 if(!meta)return false;
 meta.record(meta.owner,event);return true;
}
function inheritServiceView(view,source,bind){
 const meta=serviceViews.get(source);
 if(meta)serviceViews.set(view,{owner:meta.owner,record:meta.record,bind});
 return view;
}
/** Mirror the frozen search allocation at its call boundary, without resetting
 * it when a later explore arrives. The earlier wrapper start is conservative. */
export function legacySearchWindow({started,timeLimitMs,searchShare,maxSearchMs,deadline}){
 const budgetMs=Math.max(300,Math.min(maxSearchMs,timeLimitMs*searchShare));
 const until=Math.min(deadline,started+budgetMs);
 return Object.freeze({started,budgetMs,allocatedMs:Math.max(0,until-started),deadline:until,source:'legacy-own-search-CFG'});
}
/** A phase can supply its fixed window only to publicly verified own actors.
 * Opponent reply helpers may have hidden shorter windows inside the champion.
 * Explicit tighter local windows win; metadata never enters the native key. */
export function withEnumerationDeadline(services,{deadline,source='legacy-own-search-CFG',ownTeam,ownPlayerIds=[]}){
 const caller=Object.freeze({deadline,source,ownTeam,ownPlayerIds:Object.freeze([...ownPlayerIds])});
 const ownActors=new Set(caller.ownPlayerIds);
 const build=base=>{
  const explore=(input,options={})=>{
   if(!Number.isFinite(caller.deadline)||input?.kind!=='playerAction'||!ownActors.has(input.playerId)||
    (options.team!==undefined&&options.team!==null&&options.team!==''&&options.team!==caller.ownTeam))return base.explore(input,options);
   const explicit=Number.isFinite(options.coachEnumerationDeadline),local=explicit?options.coachEnumerationDeadline:Infinity;
   const selected=Math.min(caller.deadline,local);
   return base.explore(input,{...options,coachEnumerationDeadline:selected,
    coachEnumerationDeadlineSource:explicit&&local<=caller.deadline?'explicit-caller':caller.source});
  };
  return inheritServiceView({...base,explore},base,owner=>build(withServiceOwner(services,owner)));
 };
 return build(services);
}
function serviceCostObserver(){
 const methods=[],statuses=[],reasons=[],events=new Map(),parameters=new Map();
 const methodIds=new Map(),statusIds=new Map(),reasonIds=new Map();
 const id=(list,map,value)=>{if(!map.has(value)){map.set(value,list.length);list.push(value);}return map.get(value);};
 const observe=(owner,event={})=>{
  if(typeof event.method!=='string'||typeof event.status!=='string')return;
  const phaseId=owner?.phaseId??null,method=id(methods,methodIds,event.method),status=id(statuses,statusIds,event.status),
   reason=id(reasons,reasonIds,typeof event.reason==='string'?event.reason:null),key=JSON.stringify([phaseId,method,status,reason]);
  let row=events.get(key);if(!row){row=[phaseId,method,status,reason,0,0];events.set(key,row);}row[4]++;
  if(Number.isFinite(event.elapsedMs)&&event.elapsedMs>=0)row[5]+=event.elapsedMs;
  // Parameters are observed only at the actual underlying-service dispatch.
  if(event.status==='raw-dispatched')for(const [parameter,name] of parameterNames.entries()){
   const value=event.effectiveParams?.[name];if(!Number.isFinite(value))continue;
   const k=JSON.stringify([phaseId,method,parameter]);let p=parameters.get(k);
   if(!p){p=[phaseId,method,parameter,0,value,value];parameters.set(k,p);}p[3]++;p[4]=Math.min(p[4],value);p[5]=Math.max(p[5],value);
  }
 };
 const record=(owner,event)=>{try{observe(owner,event);}catch{/* Diagnostics cannot change a service result or exception. */}};
 return {record,snapshot:()=>({schema:'candidate-service-costs/1',methods:[...methods],statuses:[...statuses],reasons:[...reasons],
  eventColumns:['phaseId','method','status','reason','count','elapsedMs'],events:[...events.values()].map(r=>[...r]),
  parameterNames:[...parameterNames],parameterColumns:['phaseId','method','parameter','count','min','max'],parameters:[...parameters.values()].map(r=>[...r]),
  scope:'request-local aggregate events, not a per-call log; raw-dispatched counts underlying service invocation attempts, not successful actions; response excludes locally synthesized deadline replies; no execution or post-timeout host-completion claim; elapsedMs is observed wait, not host CPU; absent parameters are not inferred; null phaseId is unowned; adapter-wrapped methods and existing initialize/refresh auxiliaries only'})};
}
/** Plain transport-data copy with explicit type tags for identity. Unlike
 * JSON round-tripping, undefined observation fields retain their semantics. */
function transport(value){
 const seen=new Set();
 const visit=x=>{
  if(x===undefined)return {value:undefined,tag:['undefined']};
  if(x===null)return {value:null,tag:['null']};
  if(['string','boolean'].includes(typeof x))return {value:x,tag:[typeof x,x]};
  if(typeof x==='number'&&Number.isFinite(x))return {value:x,tag:['number',Object.is(x,-0)?'-0':x]};
  if(!x||typeof x!=='object'||seen.has(x)||Object.getOwnPropertySymbols(x).length)throw Error('not plain transport data');
  if(!Array.isArray(x)&&Object.getPrototypeOf(x)!==null&&Object.getPrototypeOf(Object.getPrototypeOf(x))!==null)throw Error('not plain object');
  seen.add(x);let result;
  if(Array.isArray(x)){
   const descriptors=Object.getOwnPropertyDescriptors(x);
   if(Object.keys(x).length!==x.length||Object.keys(x).some(k=>!/^\d+$/.test(k)||Number(k)>=x.length))throw Error('nonstandard transport array');
   const items=Array.from({length:x.length},(_,i)=>{if(!Object.hasOwn(descriptors[i]||{},'value'))throw Error('sparse or accessor transport array');return visit(descriptors[i].value);});
   result={value:items.map(p=>p.value),tag:['array',items.map(p=>p.tag)]};
  }else{
   const descriptors=Object.getOwnPropertyDescriptors(x),keys=Object.keys(x).sort();
   const items=keys.map(k=>{if(!Object.hasOwn(descriptors[k],'value'))throw Error('accessor transport value');return [k,visit(descriptors[k].value)];});
   result={value:Object.fromEntries(items.map(([k,v])=>[k,v.value])),tag:['object',items.map(([k,v])=>[k,v.tag])]};
  }
  seen.delete(x);return result;
 };
 const data=visit(value);return {value:data.value,key:JSON.stringify(data.tag)};
}
const copy=x=>transport(x).value;
const json=x=>{try{return transport(x).key;}catch{return null;}};
const finite=x=>typeof x==='number'&&Number.isFinite(x);
/** A completed, fully retained explore is independent of how much extra wall
 * time a later identical request offered it. All semantic and enumeration
 * options remain in the key. No in-flight, partial or cross-request reuse. */
export function reusableExplore(r){
 return r?.ok===true&&r.exact===true&&finite(r.unresolvedMass)&&r.unresolvedMass<=1e-8&&r.unresolvedMass>=0&&
  finite(r.rest?.p)&&r.rest.p<=1e-8&&r.rest.p>=0&&Array.isArray(r.outcomes)&&r.outcomes.length>0&&
  r.outcomes.every(b=>finite(b.p)&&b.p>0&&b.p<=1&&typeof b.key==='string'&&b.key&&b.observation&&
   typeof b.completed==='boolean'&&typeof b.turnover==='boolean'&&(b.completed||b.turnover||b.touchdown))&&
  Math.abs(r.outcomes.reduce((s,b)=>s+b.p,0)-1)<=1e-8;
}
export function requestServices(raw,{cache=true,maxEntries=128,maxBytes=4000000,deadline=Infinity,requireOutcomeIdentity=false,requestId=null,resourceBudget=false,callReserve=32,positionReserve=40}={}){
 const costs=serviceCostObserver();
 const entries=new Map(),stats={attempts:0,rpcCalls:0,hits:0,stored:0,evicted:0,deadlineRefusals:0,deadlineTimeouts:0,incompatibleOutcomeResponses:0,outcomeIdentityVerified:false,avoidedServiceMs:0,rpcMs:0,byMethod:{}};
 const failures={count:0,byCode:{}},witnesses={received:0,usable:0,rejected:0,byReason:{},observedTDCalls:0,observedOpponentTDCalls:0,observedTurnoverCalls:0,samples:[],omittedSamples:0,scope:'per failed RPC; event masses are never added across calls or used as a policy certificate'};
 const terminalPositions=new Map(),lifecycle={refusals:0,byPhase:{},byMethod:{},samples:[],omittedSamples:0,
  scope:'request-local verified retained period-end states; local illegal-continuation refusals, not successful actions or host RPC failures'};
 const noteTerminals=(r,args)=>{
  const from=args[1]?.from??'root';
  if(r?.ok!==true||r.outcomeIdentity!=='complete-state-v1'||r.position?.key!==from||!Array.isArray(r.outcomes))return;
  for(const b of r.outcomes)if(typeof b?.key==='string'&&b.key!=='root'&&
   (requestId===null||b.key.startsWith(String(requestId)+'.'))&&finite(b.p)&&b.p>0&&b.p<=1&&
   ['A','B'].includes(b.active)&&b.observation?.active===b.active&&periodPhase(b.observation.phase))
   terminalPositions.set(b.key,b.observation.phase);
 };
 let retainedBytes=0,expired=false,reservedPositions=0,replyMaxCallMs=null,positionRevision=0;
 const budget={enabled:resourceBudget,verified:false,reason:'not-enabled',maxServiceCalls:null,maxPositions:null,maxOutcomesPerCall:40,
  rootRefinementLimits:null,lastUsage:null,callReserve,positionReserve,callsUsed:0,positionsUsed:0,snapshotRPCs:0,refusals:0,stopped:null};
 const refreshBudget=async(owner=null)=>{
  if(typeof raw?.diagnostics!=='function')return false;
  budget.snapshotRPCs++;const start=Date.now();costs.record(owner,{method:'diagnostics',status:'auxiliary-dispatched'});
  let r;try{r=await raw.diagnostics();costs.record(owner,{method:'diagnostics',status:'auxiliary-response',reason:r?.ok===false?String(r.code||'service-failed'):null,elapsedMs:Date.now()-start});}
  catch{costs.record(owner,{method:'diagnostics',status:'exception',reason:'service-exception',elapsedMs:Date.now()-start});return false;}
  if(r?.ok!==true||!Number.isSafeInteger(r.usage?.totalCalls)||r.usage.totalCalls<0||
   !Number.isSafeInteger(r.usage?.positions)||r.usage.positions<0)return false;
  budget.callsUsed=Math.max(budget.callsUsed,r.usage.totalCalls);budget.positionsUsed=Math.max(budget.positionsUsed,r.usage.positions);
  if(Number.isSafeInteger(r.limitsLeft?.leaves)&&r.limitsLeft.leaves>=0&&
   Number.isFinite(r.limitsLeft?.serviceMs)&&r.limitsLeft.serviceMs>=0)
   budget.lastUsage={totalCalls:r.usage.totalCalls,positions:r.usage.positions,
    leavesLeft:r.limitsLeft.leaves,serviceMsLeft:r.limitsLeft.serviceMs};
  else budget.lastUsage=null;
  return true;
 };
 const rootRefinementBudget=async(owner=null)=>{
  if(!budget.verified||!budget.rootRefinementLimits||!await refreshBudget(owner)||!budget.lastUsage)return null;
  const u=budget.lastUsage,l=budget.rootRefinementLimits;
  return {verified:true,limits:copy(l),remaining:{
   calls:Math.max(0,l.maxServiceCalls-u.totalCalls-budget.callReserve),
   positions:Math.max(0,l.maxPositions-u.positions-reservedPositions-budget.positionReserve),
   leaves:Math.min(l.maxLeavesPerRequest,u.leavesLeft),
   serviceMs:Math.min(l.maxCallMs,u.serviceMsLeft)}};
 };
 const initialize=async()=>{
  if(!resourceBudget)return;
  if(typeof raw?.capabilities!=='function'||typeof raw?.diagnostics!=='function'){
   budget.enabled=false;budget.reason='public-budget-interface-unavailable';return;
  }
  const start=Date.now();costs.record(null,{method:'capabilities',status:'auxiliary-dispatched'});
  let caps;try{caps=await raw.capabilities();costs.record(null,{method:'capabilities',status:'auxiliary-response',reason:caps?.ok===false?String(caps.code||'service-failed'):null,elapsedMs:Date.now()-start});}
  catch{costs.record(null,{method:'capabilities',status:'exception',reason:'service-exception',elapsedMs:Date.now()-start});caps=null;}
  if(caps?.ok===false)caps=null;
  const limits=caps?.limits;
  if(!Number.isSafeInteger(limits?.maxServiceCalls)||limits.maxServiceCalls<=0||
   !Number.isSafeInteger(limits?.maxPositions)||limits.maxPositions<=0||!await refreshBudget()){
   budget.stopped='public-budget-state-unverified';budget.reason=budget.stopped;return;
  }
  budget.verified=true;budget.maxServiceCalls=limits.maxServiceCalls;budget.maxPositions=limits.maxPositions;
  if(Number.isSafeInteger(limits.maxCallMs)&&limits.maxCallMs>0)replyMaxCallMs=limits.maxCallMs;
  if(Number.isSafeInteger(limits.maxOutcomesPerCall)&&limits.maxOutcomesPerCall>0)budget.maxOutcomesPerCall=limits.maxOutcomesPerCall;
  const rootLimits={maxServiceCalls:limits.maxServiceCalls,maxPositions:limits.maxPositions,
   maxOutcomesPerCall:limits.maxOutcomesPerCall,maxLeavesPerCall:limits.maxLeavesPerCall,
   maxLeavesPerRequest:limits.maxLeavesPerRequest,maxCallMs:limits.maxCallMs,serviceTimeShare:limits.serviceTimeShare};
  if(Number.isSafeInteger(rootLimits.maxOutcomesPerCall)&&rootLimits.maxOutcomesPerCall>0&&
   Number.isSafeInteger(rootLimits.maxLeavesPerCall)&&rootLimits.maxLeavesPerCall>0&&
   Number.isSafeInteger(rootLimits.maxLeavesPerRequest)&&rootLimits.maxLeavesPerRequest>0&&
   Number.isSafeInteger(rootLimits.maxCallMs)&&rootLimits.maxCallMs>0&&
   Number.isFinite(rootLimits.serviceTimeShare)&&rootLimits.serviceTimeShare>0&&rootLimits.serviceTimeShare<=1)
   budget.rootRefinementLimits=rootLimits;
  budget.callReserve=Math.min(Math.max(0,Math.floor(callReserve)),limits.maxServiceCalls);
  budget.positionReserve=Math.min(Math.max(0,Math.floor(positionReserve)),limits.maxPositions);
  budget.reason='actual-host-limits-and-usage; no limit raised';
 };
 const canSearch=()=>!budget.enabled||budget.verified&&!budget.stopped&&
  budget.callsUsed<budget.maxServiceCalls-budget.callReserve;
 const refuse=(reason,name,owner)=>{budget.refusals++;costs.record(owner,{method:name,status:'local-refusal',reason});return {ok:false,code:'coach-resource-budget',message:reason};};
 const allocations=(name,args)=>name==='explore'?(args[1]?.noKeys?0:Math.max(0,Math.min(budget.maxOutcomesPerCall,Number.isFinite(args[1]?.maxOutcomes)?args[1].maxOutcomes:40,Number.isFinite(args[1]?.maxKeep)?args[1].maxKeep:64))):
  name==='sequence'?Math.max(0,Math.min(40,Number.isFinite(args[0]?.maxFinal)?args[0].maxFinal:8)):
  name==='fork.open'||name==='fork.step'?1:0;
 const free=new Set(['progress','capabilities','schema','diagnostics']);
 const handles=new Set(),stock={prefix:null,watermark:0,observedUnique:0,mixedRequests:false};
 const observeHandles=r=>{
  const keys=[typeof r.position==='string'?r.position:r.position?.key,
   ...(Array.isArray(r.outcomes)?r.outcomes:[]).map(b=>b?.key),...(Array.isArray(r.finals)?r.finals:[]).map(b=>b?.key)];
  for(const key of keys){const m=typeof key==='string'&&/^(\d+)\.(\d+)$/.exec(key);if(!m)continue;
   const n=Number(m[2]);if(!Number.isSafeInteger(n)||n<1)continue;
   if(stock.prefix!==null&&stock.prefix!==m[1]){stock.mixedRequests=true;continue;}
   stock.prefix=m[1];stock.watermark=Math.max(stock.watermark,n);if(handles.size<4000)handles.add(key);
  }
  stock.observedUnique=handles.size;
 };
 const enabled=()=>!expired&&cache&&maxEntries>0&&maxBytes>0&&Date.now()<deadline;
 const count=name=>stats.byMethod[name]??(stats.byMethod[name]={attempts:0,rpcCalls:0,hits:0,rpcMs:0});
 const invoke=async(name,fn,receiver,args,finalValidation=false,owner=null)=>{
  const speculation=name==='explore'&&speculativePositionReservations.get(args[1]);
  if(speculation&&!budget.verified){
   speculation.report.reason='public-position-budget-unverified';speculation.report.keylessCalls++;
   args=[args[0],{...args[1],noKeys:true}];
  }
  stats.attempts++;const group=count(name);group.attempts++;
  costs.record(owner,{method:name,status:'adapter-attempt'});
  const from=name==='explore'?args[1]?.from:args[0]?.from,phase=terminalPositions.get(from);
  if(phase&&['explore','candidates','sequence','threats.blitz','threats.scoring'].includes(name)){
   lifecycle.refusals++;lifecycle.byPhase[phase]=(lifecycle.byPhase[phase]||0)+1;
   lifecycle.byMethod[name]=(lifecycle.byMethod[name]||0)+1;
   if(lifecycle.samples.length<8)lifecycle.samples.push({method:name,from,phase});else lifecycle.omittedSamples++;
   costs.record(owner,{method:name,status:'local-refusal',reason:'coach-terminal-position'});
   return {ok:false,code:'coach-terminal-position',message:'Observed '+phase+' source cannot accept a continuation query.',position:from,phase};
  }
  if(requireOutcomeIdentity&&stats.incompatibleOutcomeResponses&&name!=='progress'&&name!=='fork.close'){
   costs.record(owner,{method:name,status:'local-refusal',reason:'unsupported-outcome-identity'});
   return {ok:false,code:'unsupported-outcome-identity',message:'Hopeful requires explore outcomeIdentity complete-state-v1; this host cannot certify distinct continuation states.'};
  }
  let remaining=deadline-Date.now();
  const deadlineRefusal=()=>{stats.deadlineRefusals++;costs.record(owner,{method:name,status:'local-refusal',reason:'coach-deadline'});return {ok:false,code:'coach-deadline',message:'Shared coach deadline reached; retain verified incumbent.'};};
  if(expired||remaining<80)return deadlineRefusal();
  const optionsIndex=name==='explore'?1:['candidates','sequence','legalChoices','legalTargets','threats.blitz','threats.scoring'].includes(name)?0:-1;
  const enumerationAdmission=name==='explore'&&args[1]&&enumerationAdmissions.get(args[1]);
  if(optionsIndex>=0&&args[optionsIndex]&&Number.isFinite(args[optionsIndex].maxMs)&&args[optionsIndex].maxMs>remaining-40){
   args=args.slice();args[optionsIndex]={...args[optionsIndex],maxMs:Math.max(40,remaining-40)};
  }
  let key=null;
  if(enabled()&&name==='explore'){
   try{const [input,opts={}]=args,{maxMs,...options}=opts;
    key=json([input,options]);const record=key&&entries.get(key);
    if(record){stats.hits++;group.hits++;stats.avoidedServiceMs+=record.elapsedMs;costs.record(owner,{method:name,status:'cache-hit'});return copy(record.result);}
   }catch{key=null;}
  }
  let reserved=0;
  if(budget.enabled&&!free.has(name)){
   const limit=budget.maxServiceCalls-(finalValidation?0:budget.callReserve);
   if(!budget.verified||!finalValidation&&budget.stopped||budget.callsUsed>=limit)return refuse(budget.stopped??'call-reserve-reached',name,owner);
   reserved=allocations(name,args);
   if(reserved){
    // A completed concurrent allocation can make an in-flight diagnostic stale.
    // Refresh until no allocation admission/completion changed during that RPC.
    let revision;
    do{
     revision=positionRevision;
     if(!await refreshBudget(owner)){budget.stopped='public-budget-state-unverified';return refuse(budget.stopped,name,owner);}
    }while(revision!==positionRevision&&Date.now()<deadline-80);
    if(revision!==positionRevision)return deadlineRefusal();
    if(speculation){
     const report=speculation.report,occupied=budget.positionsUsed+reservedPositions;
     if(!report.initialized){
      report.initialized=true;report.initialPositionsUsed=occupied;
      const capacity=Math.min(speculation.limit,budget.maxPositions-budget.positionReserve);
      report.reservedForComparison=Math.floor(Math.max(0,capacity-occupied)/2);
      report.speculativeCeiling=capacity-report.reservedForComparison;
      report.reason='verified-position-capacity-split-between-speculation-and-common-comparison';
     }
     if(occupied+reserved>report.speculativeCeiling){
      report.keylessCalls++;args=[args[0],{...args[1],noKeys:true}];reserved=0;key=null;
     }
    }
    if(budget.positionsUsed+reservedPositions+reserved>budget.maxPositions-budget.positionReserve){
     budget.stopped='position-reserve-reached';return refuse(budget.stopped,name,owner);
    }
   }
   // Count admission before awaiting the RPC, including concurrent misses.
   if(budget.callsUsed>=limit)return refuse('call-reserve-reached',name,owner);
  }
  // Existing diagnostics may have spent time after the guard's validation.
  // Recheck only the extension's private window at actual dispatch admission;
  // it never enters host arguments/cache identity or creates another RPC.
  remaining=deadline-Date.now();
  if(expired||remaining<80)return deadlineRefusal();
  if(enumerationAdmission){
   const available=Math.floor(Math.min(enumerationAdmission.deadline,deadline)-Date.now()-40);
   const serviceAvailable=enumerationAdmission.reserveServiceMs===undefined?Infinity:
    budget.verified&&budget.lastUsage?Math.floor(budget.lastUsage.serviceMsLeft-enumerationAdmission.reserveServiceMs):-Infinity;
   const callAvailable=enumerationAdmission.minimumMs>0?
    budget.verified&&Number.isSafeInteger(replyMaxCallMs)&&replyMaxCallMs>0?replyMaxCallMs:-Infinity:Infinity;
   const target=Math.min(args[1].maxMs,available,serviceAvailable,callAvailable);
   if(target<Math.max(50,enumerationAdmission.requestedMs,enumerationAdmission.minimumMs??0))return enumerationAdmission.refuse();
   if(target<args[1].maxMs){args=args.slice();args[1]={...args[1],maxMs:target};}
   enumerationAdmission.onDispatch?.(target);
  }
  if(budget.enabled&&!free.has(name)){budget.callsUsed++;reservedPositions+=reserved;if(reserved)positionRevision++;}
  const start=Date.now();stats.rpcCalls++;group.rpcCalls++;
  costs.record(owner,{method:name,status:'raw-dispatched',effectiveParams:optionsIndex>=0?args[optionsIndex]:null});
  try{
   let result,adapterTimedOut=false;
   if(Number.isFinite(deadline)&&typeof setTimeout==='function'&&typeof clearTimeout==='function'){
    result=await new Promise((resolve,reject)=>{
     let settled=false;
     const timer=setTimeout(()=>{if(settled)return;settled=true;expired=true;stats.deadlineTimeouts++;
      adapterTimedOut=true;costs.record(owner,{method:name,status:'adapter-deadline',reason:'coach-deadline',elapsedMs:Date.now()-start});
      resolve({ok:false,code:'coach-deadline',message:'Service reply exceeded the shared deadline; retain verified incumbent.'});
     },Math.max(1,deadline-Date.now()-40));
     // Consume both late resolution and late rejection. Neither may populate
     // this request's cache or extend the budget after the caller has timed out.
     let work;try{work=fn.apply(receiver,args);}catch(error){settled=true;clearTimeout(timer);reject(error);return;}
     Promise.resolve(work).then(value=>{
      if(settled)return;settled=true;clearTimeout(timer);resolve(value);
     },error=>{if(settled)return;settled=true;clearTimeout(timer);reject(error);});
    });
   }else result=await fn.apply(receiver,args);
   if(!adapterTimedOut)costs.record(owner,{method:name,status:'response',reason:result?.ok===false?String(result.code||'service-failed'):null,elapsedMs:Date.now()-start});
   if(result?.ok===false){
    failures.count++;const code=String(result.code||'service-failed');
    // S4.34: a call that stopped at its OWN maxMs (host explore fails with limit:'maxMs', platform explore.ts:289;
    // candidates and sequence never fail on maxMs, they return ok:true with a truncation note) is a local, harmless
    // truncation: the next call is unaffected. Only request-wide limits (the host's moduleMs timeout carries no
    // limit:'maxMs', and the call/time/leaf/position/memory caps) end this request's search. Before S4.34 one explore
    // overrunning its 1.3 s maxMs by 0.7 s refused every later call (B1 home step 231: 2 of 686 root lines explored,
    // planner never ran, 31.7 s of the champion's 48 s unused; 97 batch-H decisions truncated this way).
    const perCallLimit=code==='timeout'&&result.limit==='maxMs';
    if(perCallLimit)failures.perCallTimeouts=(failures.perCallTimeouts||0)+1;
    if(budget.enabled&&!perCallLimit&&['timeout','call-cap','time-budget','leaf-budget','position-cap','memory-cap','coach-deadline'].includes(code))budget.stopped='host-'+code;failures.byCode[code]=(failures.byCode[code]||0)+1;
    if(name==='explore'&&code==='timeout'){
     witnesses.received++;const w=timeoutWitness(result,args[0],args[1],requestId);
     witnesses.byReason[w.reason]=(witnesses.byReason[w.reason]||0)+1;
     if(w.usable){witnesses.usable++;const e=w.evidence;
      witnesses.observedTDCalls+=Number(e.observed.touchdown>0);
      witnesses.observedOpponentTDCalls+=Number(e.observed.opponentTouchdown>0);
      witnesses.observedTurnoverCalls+=Number(e.observed.turnover>0);
      if(witnesses.samples.length<8)witnesses.samples.push({from:e.position.key,input:e.input,
       enumerated:e.enumerated,unknown:e.unknownMass,observed:e.observed,bounds:e.probabilityBounds,
       diagnosticOnly:true});else witnesses.omittedSamples++;
     }else witnesses.rejected++;
    }
   }
   if(name==='explore'&&result?.ok===true&&requireOutcomeIdentity){
    if(result.outcomeIdentity!=='complete-state-v1'){stats.incompatibleOutcomeResponses++;
     costs.record(owner,{method:name,status:'adapter-rejection',reason:'unsupported-outcome-identity'});
     return {ok:false,code:'unsupported-outcome-identity',message:'The host returned unverified grouped continuation states. Install the repaired complete-state-v1 outcome interface.'};}
    stats.outcomeIdentityVerified=true;
   }
   if(result?.ok===true)try{observeHandles(result);}catch{stock.mixedRequests=true;}
   if(name==='explore')noteTerminals(result,args);
   if(key&&enabled())try{if(reusableExplore(result)){
    const encoded=transport(result),bytes=new TextEncoder().encode(encoded.key).length+key.length*2;
    if(bytes<=maxBytes){
     if(entries.has(key)){retainedBytes-=entries.get(key).bytes;entries.delete(key);}
     while(entries.size&&(entries.size>=maxEntries||retainedBytes+bytes>maxBytes)){
      const oldest=entries.keys().next().value;retainedBytes-=entries.get(oldest).bytes;entries.delete(oldest);stats.evicted++;
     }
     entries.set(key,{result:encoded.value,bytes,elapsedMs:Math.max(0,Date.now()-start)});retainedBytes+=bytes;stats.stored++;
    }
   }}catch{/* Optional reuse must not invalidate the real service answer. */}
   return result;
  }catch(error){costs.record(owner,{method:name,status:'exception',reason:'service-exception',elapsedMs:Date.now()-start});throw error;}
  finally{reservedPositions=Math.max(0,reservedPositions-reserved);if(reserved)positionRevision++;const elapsed=Date.now()-start;stats.rpcMs+=elapsed;group.rpcMs+=elapsed;}
 };
 const buildView=(owner=null,finalValidation=false)=>{
 const services={...raw};
 services.rootRefinementBudget=()=>rootRefinementBudget(owner);
 services.replyTimeBudget=async()=>{
  if(!budget.verified||!replyMaxCallMs||!await refreshBudget(owner)||!budget.lastUsage)return null;
  return {verified:true,serviceMsLeft:budget.lastUsage.serviceMsLeft,maxCallMs:replyMaxCallMs};
 };
 if(raw?.fork){services.fork={...raw.fork};for(const name of ['open','step','close'])if(typeof raw.fork[name]==='function')
  services.fork[name]=(...args)=>invoke('fork.'+name,raw.fork[name],raw.fork,args,false,owner);}
 for(const name of ['candidates','explore','sequence','validate','legalChoices','legalTargets','progress'])if(typeof raw?.[name]==='function')
  services[name]=(...args)=>invoke(name,raw[name],raw,args,finalValidation&&name==='validate',owner);
 if(raw?.threats){services.threats={...raw.threats};for(const name of ['blitz','scoring'])if(typeof raw.threats[name]==='function')
  services.threats[name]=(...args)=>invoke('threats.'+name,raw.threats[name],raw.threats,args,false,owner);}
 serviceViews.set(services,{owner,record:costs.record,bind:next=>buildView(next,finalValidation)});return services;
 };
 const services=buildView(),finalServices={...services};
 if(typeof raw?.validate==='function')finalServices.validate=(...args)=>invoke('validate',raw.validate,raw,args,true);
 serviceViews.set(finalServices,{owner:null,record:costs.record,bind:owner=>buildView(owner,true)});
 // S4.34 watchdog: refuse every later call of this request (coach-deadline). A call still pending is not cut here; it
 // resolves as coach-deadline at the shared deadline timer, which for the host's 120 s limit fires before the watchdog.
 const abort=reason=>{if(!expired){expired=true;stats.aborted=String(reason||'aborted');}};
 return {services,finalServices,initialize,canSearch,deadline,stats,abort,keyStock:()=>({...stock,positionBudgetVerified:budget.verified}),snapshot:()=>({...copy(stats),candidateServiceCosts:costs.snapshot(),serviceFailures:copy(failures),timeoutWitnesses:copy(witnesses),positionLifecycle:{...copy(lifecycle),knownTerminalPositions:terminalPositions.size},resourceBudget:copy(budget),keyHandles:{...stock},retainedEntries:entries.size,retainedBytes,
  deadlineTimerAvailable:typeof setTimeout==='function'&&typeof clearTimeout==='function',
  scope:'one immutable request; complete retained explore only; avoidedServiceMs is prior cost, not wall-clock speedup'})};
}

/** Split verified retained-position capacity at actual adapter admission, not
 * sparse worker handle ids. In-flight allocations count conservatively; later
 * common comparison keeps half the initial available capacity. Only optional
 * registration stops: observations, probability and enumeration stay native.
 * Root actions and actual comparison use the original services. */
export function reserveFutureKeyCapacity(services,keyStock,{limit=4000}={}){
 // keyStock remains a diagnostic input for callers using the existing interface;
 // numeric worker ids are sparse allocation ordinals, never position occupancy.
 const report={enabled:true,initialized:false,keylessCalls:0,reason:'awaiting-speculative-nonroot-explore'};
 const build=base=>{
 const explore=async(input,options={})=>{
  if(!options.from||options.from==='root'||options.noKeys===true)return base.explore(input,options);
  const scoped=copyRetainedDirectOptions(options,{...options});
  if(keyStock?.()?.positionBudgetVerified!==true){
   report.reason='public-position-budget-unverified';report.keylessCalls++;
   scoped.noKeys=true;return base.explore(input,scoped);
  }
  speculativePositionReservations.set(scoped,{report,limit});
  return base.explore(input,scoped);
 };
 return inheritServiceView({...base,explore},base,owner=>build(withServiceOwner(services,owner)));
 };
 return {services:build(services),report};
}

/** Producer-local admission only; the shared adapter still enforces actual
 * host limits. Refusals preserve unknown and cannot consume the next source's
 * slot. Cleanup is always allowed; no probability or legality is altered. */
export function boundedProducerServices(services,{calls=500,deadline=Infinity,budgetState=null,reservePositions=0}={}){
 const report={callLimit:Math.max(0,Math.floor(calls)),calls:0,logicalCalls:0,accounting:'conservative RPC admission units including pre-explore validation; cache hits and local refusals may use fewer actual RPCs',refusals:0,leafCappedCalls:0,deadline,reason:null};
 const build=base=>{
 const wrap=(object,prefix='')=>Object.fromEntries(Object.entries(object).map(([name,value])=>{
  const method=prefix+name;
  if(typeof value==='function')return [name,async(...args)=>{
   const free=['progress','diagnostics','capabilities','schema','fork.close'].includes(method);
   const budget=budgetState?.(),options=args[1]??{},cost=method==='explore'&&args[0]?.kind==='playerAction'&&base.exploreLegalityValidation===true?2:1;
   if(method==='explore'&&Number.isFinite(options.maxMs)&&options.maxMs<150){
    report.refusals++;report.reason='producer-enumeration-time-insufficient';recordServiceObservation(base,{method,status:'local-refusal',reason:report.reason});return {ok:false,code:'coach-producer-budget',message:report.reason};
   }
   const allocation=method==='explore'&&!options.noKeys?Math.min(budget?.maxOutcomesPerCall??40,options.maxOutcomes??40,options.maxKeep??64):['fork.open','fork.step'].includes(method)?1:0;
   if(allocation&&budget?.verified&&budget.positionsUsed+allocation>budget.maxPositions-reservePositions){
    report.refusals++;report.reason='producer-position-reserved-for-common';recordServiceObservation(base,{method,status:'local-refusal',reason:report.reason});return {ok:false,code:'coach-producer-budget',message:report.reason};
   }
   if(!free&&(report.calls+cost>report.callLimit||Date.now()>=deadline)){
    report.refusals++;report.reason=report.calls+cost>report.callLimit?'producer-call-slot-exhausted':'producer-time-slot-exhausted';
    recordServiceObservation(base,{method,status:'local-refusal',reason:report.reason});
    return {ok:false,code:'coach-producer-budget',message:report.reason};
   }
   if(!free){report.calls+=cost;report.logicalCalls++;}
   if(method==='explore'){
    const cap=Number.isFinite(options.maxMs)&&options.maxMs<500?64:512;
    const leaves=Math.min(cap,Number.isFinite(options.maxLeaves)?options.maxLeaves:cap);
    if(leaves!==options.maxLeaves)report.leafCappedCalls++;
    args=[args[0],{...options,maxLeaves:leaves,...(base.exploreLegalityValidation===true&&Number.isFinite(deadline)?{coachEnumerationDeadline:Math.min(deadline,Number.isFinite(options.coachEnumerationDeadline)?options.coachEnumerationDeadline:Infinity)}:{})},...args.slice(2)];
   }
   return value.apply(object,args);
  }];
  return [name,prefix===''&&['fork','threats'].includes(name)&&value&&typeof value==='object'?wrap(value,method+'.'):value];
 }));
 return inheritServiceView(wrap(base),base,owner=>build(withServiceOwner(services,owner)));
 };
 return {services:build(services),report};
}

/** A search producer may propose a route through an occupied square. Validate at
 * that exact retained source before requesting chance, keeping rejected inputs
 * distinct from actual RPC failures and never supplying invented outcomes. */
export function guardLiveExplore(services,team,players=[],{deadline=Infinity,passTimeScale=4,passMinMs=3000,passMaxMs=6000,commonReserveMs=15000,
 complexTimeExtension=false,complexTimeScale=4,complexMinMs=3000,complexMaxMs=6000,complexMinDispatchMs=0,foreignMoveTimeExtension=false,ownRootPassTimeExtension=false,heldDirectTimeExtension=false}={}){
 const complexDispatchFloor=Number.isFinite(complexMinDispatchMs)&&complexMinDispatchMs>0?Math.ceil(complexMinDispatchMs):0;
 const foreignMoveDispatchFloor=3000,ownRootPassDispatchFloor=3000;
 const actorTeams=new Map(players.filter(p=>typeof p?.id==='string'&&['A','B'].includes(p.team)).map(p=>[p.id,p.team]));
 const stats={checked:0,illegal:0,unverified:0,complexBudgetRefusals:0,passBudgetRefusals:0,passTimeExtended:0,passTimeSlotCapped:0,
  complexTimeExtended:0,complexTimeSlotCapped:0,complexUnscopedCalls:0,complexMinDispatchMs:complexDispatchFloor,complexTimeSamples:[],omittedComplexTimeSamples:0,
  complexRequestedMs:{count:0,min:null,max:null},complexAllocatedMs:{count:0,min:null,max:null},
  foreignMoveTimeExtension:!!foreignMoveTimeExtension,foreignMoveMinDispatchMs:foreignMoveDispatchFloor,foreignMoveCallerQualifiedCalls:0,foreignMoveSourceValidatedCalls:0,
  foreignMoveBudgetRefusals:0,foreignMoveTimeExtended:0,foreignMoveTimeSlotCapped:0,foreignMoveTimeSamples:[],omittedForeignMoveTimeSamples:0,
  foreignMoveRequestedMs:{count:0,min:null,max:null},foreignMoveAllocatedMs:{count:0,min:null,max:null},
  ownRootPassTimeExtension:!!ownRootPassTimeExtension,ownRootPassCallerQualifiedCalls:0,ownRootPassSourceValidatedCalls:0,ownRootPassBudgetRefusals:0,
  ownRootPassTimeExtended:0,ownRootPassTimeSlotCapped:0,ownRootPassTimeSamples:[],omittedOwnRootPassTimeSamples:0,
  ownRootPassRequestedMs:{count:0,min:null,max:null},ownRootPassAllocatedMs:{count:0,min:null,max:null},samples:[],omittedSamples:0};
 const range=(r,value)=>{r.count++;r.min=r.min===null?value:Math.min(r.min,value);r.max=r.max===null?value:Math.max(r.max,value);};
 const reject=(base,input,from,reason,validation)=>{
  stats[reason==='input-illegal'?'illegal':reason.startsWith('foreign-move-')?'foreignMoveBudgetRefusals':reason.startsWith('own-root-pass-')?'ownRootPassBudgetRefusals':reason.startsWith('complex-')?'complexBudgetRefusals':reason==='pass-enumeration-budget-unavailable'?'passBudgetRefusals':'unverified']++;
  if(stats.samples.length<8)stats.samples.push({input,from,reason,errors:validation?.errors??null,validation:validation?{ok:validation.ok??null,legal:validation.legal??null,position:validation.position??null,code:validation.code??null,message:validation.message??null}:null});else stats.omittedSamples++;
  recordServiceObservation(base,{method:'explore',status:'local-refusal',reason});
  return {ok:false,code:'coach-live-explore-refused',reason,position:{key:from},scope:'local source legality or enumeration budget refusal; no chance law, value or host explore RPC'};
 };
 const build=base=>{
 const guarded={...base,exploreLegalityValidation:true,retainedDirectTimeExtension:heldDirectTimeExtension,explore:async(input,options={})=>{
  const heldProof=heldDirectTimeExtension?retainedDirectWindows.get(options):null;
  const speculation=speculativePositionReservations.get(options);
  const coachEnumerationDeadline=options.coachEnumerationDeadline;
  let dispatchAdmission=null,heldRecord=null;
  const deadlineSource=Number.isFinite(coachEnumerationDeadline)?options.coachEnumerationDeadlineSource??'explicit-caller':'unobserved';
  if(Object.hasOwn(options,'coachEnumerationDeadline')||Object.hasOwn(options,'coachEnumerationDeadlineSource')){
   const {coachEnumerationDeadline:localDeadline,coachEnumerationDeadlineSource:localSource,...nativeOptions}=options;options=nativeOptions;
  }
  if(input?.kind==='playerAction'){
   const from=options.from??'root';stats.checked++;
   if(options.team!==undefined&&options.team!==null&&options.team!==''){
    const actorTeam=actorTeams.get(input.playerId);
    if(!actorTeam)return reject(base,input,from,'actor-team-unverified');
    if(options.team!==actorTeam)return reject(base,input,from,'explicit-team-mismatch');
   }
   if(typeof base.validate!=='function')return reject(base,input,from,'validator-unavailable');
   let heldDeadline=null;
   const heldRefuse=(reason,validation)=>{
    stats.heldDirectRefusals=(stats.heldDirectRefusals??0)+1;
    if(heldRecord){heldRecord.reason=reason;heldRecord.status='local-refusal';}
    return reject(base,input,from,reason,validation);
   };
   if(heldProof){
    const explicitHard=Number.isFinite(coachEnumerationDeadline)&&
     (deadlineSource!=='champion-held-reply-deadline'||coachEnumerationDeadline<heldProof.heldSoftDeadline)?coachEnumerationDeadline:Infinity;
    heldDeadline=Math.min(heldProof.outerDeadline,heldProof.hardDeadline,explicitHard,deadline-commonReserveMs);
    heldRecord={...heldProof,requestedMs:options.maxMs,desiredMs:1500,allocatedMs:null,
     callerDeadline:Number.isFinite(heldDeadline)?heldDeadline:null,softWindowOverride:true,calleeClockObserved:true,
     status:'admission',reason:null,scope:'explicit retainedDirectScore research time allocation; held soft window may be exceeded; source validation and actual adapter service headroom required; actual native applied/completion separate'};
    stats.heldDirectCalls=(stats.heldDirectCalls??0)+1;
    stats.heldDirectSamples??=[];
    if(stats.heldDirectSamples.length<8)stats.heldDirectSamples.push(heldRecord);else stats.omittedHeldDirectSamples=(stats.omittedHeldDirectSamples??0)+1;
    const keys=['from','team','perspective','observations','decisions','maxOutcomes','maxKeep','maxLeaves','threshold','maxMs'];
    const signature=Reflect.ownKeys(options).length===keys.length&&keys.every(k=>Object.hasOwn(options,k))&&
     ['move','blitz'].includes(input.action)&&options.observations===true&&options.decisions==='builtin'&&
     options.maxOutcomes===20&&options.maxKeep===256&&options.maxLeaves===1800&&options.threshold===0.0001&&
     Number.isFinite(options.maxMs)&&options.maxMs>0&&options.maxMs<=550;
    if(heldProof.valid!==true||!signature||heldProof.sourceKey!==from||heldProof.actorId!==input.playerId||
     heldProof.team!==options.team||heldProof.perspective!==team||options.perspective!==team||
     actorTeams.get(input.playerId)!==options.team||options.team===team)
     return heldRefuse('held-direct-source-or-signature-unverified');
    if(!Number.isFinite(heldProof.outerDeadline)||!Number.isFinite(heldProof.hardDeadline)||
     !Number.isFinite(heldProof.heldSoftDeadline)||heldDeadline-Date.now()-40<Math.max(50,options.maxMs))
     return heldRefuse('held-direct-enumeration-budget-unavailable');
   }
   const complex=['block','blitz'].includes(input.action),ownActor=actorTeams.get(input.playerId)===team;
   // No whole-phase fallback for foreign/unknown actors. Their original path
   // remains uncovered unless its caller supplies a real local window.
   const complexExtend=!heldProof&&complexTimeExtension&&complex&&(ownActor||Number.isFinite(coachEnumerationDeadline));
   // Time-only opt-in for a real foreign retained Move caller. The native
   // validator must still verify this request's source and legality below.
   // Geometry/leaf counts are not a cost proof; original law parameters survive.
   const moveExtend=!heldProof&&foreignMoveTimeExtension&&input.action==='move'&&
    typeof from==='string'&&/^[0-9]+\.[1-9][0-9]*$/.test(from)&&!Object.hasOwn(options,'pos')&&
    actorTeams.get(input.playerId)===options.team&&options.team!==team&&['A','B'].includes(options.team)&&
    options.perspective===team&&Number.isFinite(coachEnumerationDeadline)&&options.observations===true&&options.decisions==='builtin';
   // A root-only own Pass uses its actual caller; foreign/retained sources keep
   // the existing Pass path. No geometry or chance-law limit is a cost proof.
   const passScope=!heldProof&&ownRootPassTimeExtension&&input.action==='pass'&&from==='root'&&
    !Object.hasOwn(options,'pos')&&ownActor&&options.team===team&&options.perspective===team&&
    options.observations===true&&options.decisions==='builtin';
   if(passScope&&!Number.isFinite(coachEnumerationDeadline))return reject(base,input,from,'own-root-pass-caller-deadline-unobserved');
   const passExtend=passScope&&Number.isFinite(coachEnumerationDeadline);
   const observedPrefix=passExtend?'ownRootPass':moveExtend?'foreignMove':null;
   const extend=complexExtend||moveExtend||passExtend,dispatchFloor=passExtend?ownRootPassDispatchFloor:moveExtend?foreignMoveDispatchFloor:complexDispatchFloor;
   const family=passExtend?'own-root-pass':moveExtend?'foreign-retained-move':'block-blitz',prefix=passExtend?'own-root-pass':moveExtend?'foreign-move':'complex';
   if(observedPrefix)stats[observedPrefix+'CallerQualifiedCalls']++;
   if(complexTimeExtension&&complex&&!complexExtend&&!heldProof)stats.complexUnscopedCalls++;
   let allocation=null,observedSample=null;
   const allocate=stage=>{
    const requested=options.maxMs,desired=passExtend?Math.max(requested,Math.min(passMaxMs,Math.max(passMinMs,requested*passTimeScale))):
     Math.max(requested,moveExtend?foreignMoveDispatchFloor:0,Math.min(complexMaxMs,Math.max(complexMinMs,requested*complexTimeScale)));
    allocation={input,from,stage,requestedMs:Number.isFinite(requested)?requested:null,desiredMs:Number.isFinite(desired)?desired:null,
     allocatedMs:null,minimumDispatchMs:dispatchFloor,callerDeadline:Number.isFinite(coachEnumerationDeadline)?coachEnumerationDeadline:null,deadlineSource,
     ...(observedPrefix?{family,dispatchStatus:'unobserved',dispatchedMs:null,scope:'caller/source-qualified time admission only; actual native applied/chance/completion separately observed'}:{}),
     callerRemainingMs:null,globalRemainingMs:null};
    if(!Number.isFinite(coachEnumerationDeadline))return prefix+'-caller-deadline-unobserved';
    if(!Number.isFinite(requested)||requested<=0)return prefix+'-request-window-unverified';
    const finish=actual=>{
     if(dispatchFloor>0){
      if(actual?.verified!==true||!Number.isFinite(actual.serviceMsLeft)||actual.serviceMsLeft<0||!Number.isSafeInteger(actual.maxCallMs)||actual.maxCallMs<1)
       return prefix+'-service-budget-unverified';
      allocation.serviceMsLeft=actual.serviceMsLeft;allocation.maxCallMs=actual.maxCallMs;allocation.serviceReserveMs=commonReserveMs;
     }
     // The real budget query may have spent time. Recompute both clocks after it.
     const now=Date.now(),globalAvailable=deadline-now-commonReserveMs-40,localAvailable=coachEnumerationDeadline-now-40;
     allocation.callerRemainingMs=Math.max(0,localAvailable);allocation.globalRemainingMs=Math.max(0,globalAvailable);
     const target=Math.floor(Math.min(desired,globalAvailable,localAvailable,
      dispatchFloor>0?actual.maxCallMs:Infinity,dispatchFloor>0?actual.serviceMsLeft-commonReserveMs:Infinity));
     if(target<Math.max(50,requested,dispatchFloor))return prefix+'-enumeration-budget-unavailable';
     allocation.allocatedMs=target;return null;
    };
    if(dispatchFloor<=0)return finish(null);
    return (async()=>{let actual=null;try{actual=await base.replyTimeBudget?.();}catch{}return finish(actual);})();
   };
   const noteAllocation=reason=>{
    if(observedPrefix){
     if(Number.isFinite(allocation.requestedMs))range(stats[observedPrefix+'RequestedMs'],allocation.requestedMs);
     if(Number.isFinite(allocation.allocatedMs))range(stats[observedPrefix+'AllocatedMs'],allocation.allocatedMs);
     if(stats[observedPrefix+'TimeSamples'].length<8){observedSample={...allocation,reason,dispatchStatus:reason?'local-refusal':'unobserved'};stats[observedPrefix+'TimeSamples'].push(observedSample);}else stats['omitted'+observedPrefix[0].toUpperCase()+observedPrefix.slice(1)+'TimeSamples']++;
     return;
    }
    if(Number.isFinite(allocation.requestedMs))range(stats.complexRequestedMs,allocation.requestedMs);
    if(Number.isFinite(allocation.allocatedMs))range(stats.complexAllocatedMs,allocation.allocatedMs);
    if(stats.complexTimeSamples.length<8)stats.complexTimeSamples.push({...allocation,reason});else stats.omittedComplexTimeSamples++;
   };
   if(extend){const pending=allocate('before-validation'),reason=dispatchFloor>0?await pending:pending;if(reason){noteAllocation(reason);return reject(base,input,from,reason);}}
   // Admission keeps the original enumeration scale; validate can consume the
   // local window, so check it again before handing the request to explore.
   const complexBudgetUnavailable=()=>['block','blitz'].includes(input.action)&&Number.isFinite(coachEnumerationDeadline)&&Number.isFinite(options.maxMs)&&coachEnumerationDeadline-Date.now()-40<Math.max(50,options.maxMs);
   if(!heldProof&&!extend&&complexBudgetUnavailable())return reject(base,input,from,'complex-enumeration-budget-unavailable');
   const v=await base.validate(input,{from,team:options.team??team});
   if(v?.ok!==true||v.position!==from||typeof v.legal!=='boolean'){
    if(observedPrefix)noteAllocation('source-legality-unverified');
    return heldProof?heldRefuse('source-legality-unverified',v):reject(base,input,from,'source-legality-unverified',v);
   }
   if(!v.legal){if(observedPrefix)noteAllocation('input-illegal');return heldProof?heldRefuse('input-illegal',v):reject(base,input,from,'input-illegal',v);}
   if(observedPrefix)stats[observedPrefix+'SourceValidatedCalls']++;
   if(heldProof){
    let actual=null;try{actual=await base.replyTimeBudget?.();}catch{}
    if(actual?.verified!==true||!Number.isFinite(actual.serviceMsLeft)||actual.serviceMsLeft<0||!Number.isSafeInteger(actual.maxCallMs)||actual.maxCallMs<1)
     return heldRefuse('held-direct-service-budget-unverified',v);
    heldRecord.serviceMsLeft=actual.serviceMsLeft;heldRecord.serviceReserveMs=commonReserveMs;heldRecord.maxCallMs=actual.maxCallMs;
    const target=Math.floor(Math.min(1500,actual.maxCallMs,heldDeadline-Date.now()-40,actual.serviceMsLeft-commonReserveMs));
    if(target<Math.max(50,options.maxMs))return heldRefuse('held-direct-enumeration-budget-unavailable',v);
    heldRecord.allocatedMs=target;heldRecord.status='allocated';heldRecord.sourceValidation={position:v.position,legal:v.legal};
    if(target>options.maxMs)stats.heldDirectExtended=(stats.heldDirectExtended??0)+1;
    options={...options,maxMs:target};
    dispatchAdmission=Object.freeze({deadline:heldDeadline,requestedMs:heldRecord.requestedMs,reserveServiceMs:commonReserveMs,onDispatch:ms=>{heldRecord.dispatchedMs=ms;},
     refuse:()=>heldRefuse('held-direct-enumeration-budget-unavailable',v)});
   }
   if(!heldProof&&!extend&&complexBudgetUnavailable())return reject(base,input,from,'complex-enumeration-budget-unavailable');
   if(extend){
    const pending=allocate('after-validation'),reason=dispatchFloor>0?await pending:pending;noteAllocation(reason);
    if(reason)return reject(base,input,from,reason,v);
    if(allocation.allocatedMs<allocation.desiredMs)stats[observedPrefix?observedPrefix+'TimeSlotCapped':'complexTimeSlotCapped']++;
    if(allocation.allocatedMs>options.maxMs){stats[observedPrefix?observedPrefix+'TimeExtended':'complexTimeExtended']++;options={...options,maxMs:allocation.allocatedMs};}
    dispatchAdmission=Object.freeze({deadline:Math.min(coachEnumerationDeadline,deadline-commonReserveMs),requestedMs:allocation.requestedMs,minimumMs:dispatchFloor,
     ...(dispatchFloor>0?{reserveServiceMs:commonReserveMs}:{}),
     ...(observedPrefix?{onDispatch:ms=>{if(observedSample){observedSample.dispatchStatus='adapter-raw-admission';observedSample.dispatchedMs=ms;}}}:{}),
     refuse:()=>{if(observedSample){observedSample.reason=prefix+'-enumeration-budget-unavailable';observedSample.dispatchStatus='local-refusal';}return reject(base,input,from,prefix+'-enumeration-budget-unavailable',v);}});
   }
  }
  if(input?.kind==='playerAction'&&input.action==='pass'&&!dispatchAdmission){
   const requested=Number.isFinite(options.maxMs)?Math.max(50,options.maxMs):3000;
   const desired=Math.max(requested,Math.min(passMaxMs,Math.max(passMinMs,requested*passTimeScale)));
   // Keep host service-time headroom; local peer slots may cap extension,
   // but never borrow from another policy or shrink the original request.
   const now=Date.now(),globalAvailable=deadline-now-commonReserveMs;
   const localAvailable=Number.isFinite(coachEnumerationDeadline)?Math.floor(coachEnumerationDeadline-now-40):Infinity;
   const target=Math.min(desired,localAvailable);
   if(globalAvailable<desired||target<requested)return reject(base,input,options.from??'root','pass-enumeration-budget-unavailable');
   if(target<desired)stats.passTimeSlotCapped++;
   if(target>requested){stats.passTimeExtended++;options={...options,maxMs:target};}
  }
  if(dispatchAdmission)enumerationAdmissions.set(options,dispatchAdmission);
  if(speculation)speculativePositionReservations.set(options,speculation);
  if(!heldRecord)return base.explore(input,options);
  const result=await base.explore(input,options);
  heldRecord.responseApplied=result?.applied??null;
  heldRecord.responseAppliedScope='parameters carried by actual native response, including possible cache reuse; not inferred from allocation or completion';
  return result;
 }};
 return inheritServiceView(guarded,base,owner=>build(withServiceOwner(services,owner)));
 };
 return {services:build(services),snapshot:()=>({...stats,...(stats.heldDirectSamples?{heldDirectSamples:stats.heldDirectSamples.map(x=>({...x})),heldDirectTimePolicy:{id:'explicit-retained-direct-service1500-v1',desiredMs:1500,softWindowOverride:true,outerAndExternalHardWindowPreserved:true,actualServiceReserveMs:commonReserveMs,scope:'qualified real callee only; allocation/dispatch/response-carried applied separate; no completeness or native success inferred'}}:{}),complexRequestedMs:{...stats.complexRequestedMs},complexAllocatedMs:{...stats.complexAllocatedMs},
  complexTimeSamples:stats.complexTimeSamples.map(x=>({...x})),samples:stats.samples.map(x=>({...x})),
  foreignMoveRequestedMs:{...stats.foreignMoveRequestedMs},foreignMoveAllocatedMs:{...stats.foreignMoveAllocatedMs},
  foreignMoveTimeSamples:stats.foreignMoveTimeSamples.map(x=>({...x})),
  ownRootPassRequestedMs:{...stats.ownRootPassRequestedMs},ownRootPassAllocatedMs:{...stats.ownRootPassAllocatedMs},
  ownRootPassTimeSamples:stats.ownRootPassTimeSamples.map(x=>({...x})),
  ownRootPassTimePolicy:{enabled:!!ownRootPassTimeExtension,minimumDispatchMs:ownRootPassDispatchFloor,commonReserveMs,
   scope:'own explicit actor/team/perspective, root source without pos override, finite actual caller, source validation and real public call/service budget; original law retained; foreign Pass unchanged; not enumeration completion'},
  foreignMoveTimePolicy:{enabled:!!foreignMoveTimeExtension,minimumDispatchMs:foreignMoveDispatchFloor,commonReserveMs,
   scope:'foreign explicit actor/team, retained native source, own perspective and real finite caller only; no pos override; source legality required; original law parameters retained; admission is not native applied/completion'},
  complexTimePolicy:{enabled:complexTimeExtension,timeScale:complexTimeScale,minMs:complexMinMs,maxMs:complexMaxMs,commonReserveMs,
   scope:'own actors require a caller window; foreign/unknown actors without an explicit caller window keep original time and are uncovered; allocation is not actual dispatch, enumeration completion or execution'},
  scope:'all-producer source legality, local Block/Blitz budget admission and opt-in bounded time allocation, separate opt-in foreign retained Move time admission, and bounded Pass time allocation; global reserve is host service-time headroom, not spendable common time; original leaves/outcomes/keep/threshold retained, true unknown preserved; refusals are not probability, execution or RPC failures'})};
}
