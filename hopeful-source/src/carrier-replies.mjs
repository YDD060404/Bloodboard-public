const EPS=1e-8;
const other=t=>t==='A'?'B':'A';
const prob=p=>Number.isFinite(p)&&p>=0&&p<=1;
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const key=x=>JSON.stringify(stable(x));
const dist=(a,b)=>Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));
const standing=p=>p?.location==='pitch'&&p.pos&&p.stance==='standing'&&!p.distracted;
const held=o=>o?.ball?.kind==='held'?o.players?.find(p=>p.id===o.ball.playerId):null;
const contact=(i,id)=>i?.kind==='playerAction'&&['block','blitz'].includes(i.action)&&typeof i.playerId==='string'&&Array.isArray(i.path)&&(i.blitzTarget||i.blockTarget)===id;
const ordinary=i=>i?.kind==='playerAction'&&i.action==='move'&&typeof i.playerId==='string'&&Array.isArray(i.path)&&i.path.length&&i.path.every(s=>['step','rush'].includes(s.kind)&&Number.isInteger(s.to?.x)&&Number.isInteger(s.to?.y));

/** Last contact only: no continuation needs the omitted state keys. The API
 * extrapolates TD by k=1+unOK/exOK, so its reported scalar is not exact when
 * unresolved>0. Recover conservative scalar intervals in the same raw mass
 * units; still unknown whether non-TD omitted states retain our ball. */
export function contactRestBounds(e,own,from,down,score){
 const opp=other(own);
 if(e?.ok!==true||e.position?.key!==from||e.perspective!==own||e.activeTeam!==opp||
  e.outcomeIdentity!=='complete-state-v1'||e.decisionPolicy?.mode!=='builtin'||
  e.decisionPolicy.own!=='builtin'||e.decisionPolicy.opponent!=='builtin'||typeof e.exact!=='boolean'||
  ![e.rest?.p,e.unresolvedMass,e.enumerated,e.pTurnover,e.pTouchdown,e.pOpponentTouchdown].every(prob)||
  !(e.enumerated>0)||e.unresolvedMass>=1||!Array.isArray(e.outcomes)||
  !Number.isFinite(down)||down<0||!Number.isFinite(score)||score<0)return null;
 const r=e.rest.p,u=e.enumerated*e.unresolvedMass/(1-e.unresolvedMass);
 if(Math.abs(e.enumerated+u-1)>EPS||e.unresolvedMass>r+EPS||
  e.exact!==(e.unresolvedMass<1e-9)||e.outcomes.some(b=>!prob(b?.p))||
  Math.abs(e.outcomes.reduce((s,b)=>s+b.p,0)+r-1)>EPS)return null;
 const listedOwn=e.outcomes.reduce((s,b)=>s+(b.touchdown===own?b.p:0),0);
 const listedOpp=e.outcomes.reduce((s,b)=>s+(b.touchdown===opp?b.p:0),0);
 const exOKLower=e.enumerated-e.pTurnover;
 const kMax=exOKLower>1e-12?1+u/exOKLower:Infinity;
 const interval=(q,listed)=>{
  if(q+EPS<listed)return null;
  const lower=Math.max(0,(u===0?q:q/kMax)-listed);
  const upper=Math.min(r,Math.max(0,q+u-listed));
  return lower<=upper+EPS&&lower<=r+EPS?{lower:Math.min(r,lower),upper}:null;
 };
 const our=interval(e.pTouchdown,listedOwn),enemy=interval(e.pOpponentTouchdown,listedOpp);
 if(!our||!enemy||our.lower+enemy.lower>r+EPS)return null;
 const enemyUpper=Math.min(enemy.upper,Math.max(0,r-our.lower));
 const lossUpper=Math.max(0,r-our.lower);
 return {lossLower:enemy.lower,lossUpper,opponentTDLower:enemy.lower,opponentTDUpper:enemyUpper,
  harmLower:score*enemy.lower,harmUpper:down*lossUpper+(score-down)*(score>=down?enemyUpper:enemy.lower),
  unknown:Math.max(0,r-our.lower-enemy.lower)};
}

/** Finite shared carrier-contact policies, with adaptive continuations after
 * observed preparation outcomes. This does not bound a complete enemy Turn.
 * Metric maxima are separate envelopes; harm is priced per actual terminal
 * before taking max, never as a sum of mutually exclusive loss/TD maxima. */
export async function compareCarrierReplies(o,policies,services,inspect,deadline){
 const own=o.team,opp=other(own),start=Date.now(),until=Math.min(deadline,start+4000),left=()=>until-Date.now();
 const down=inspect?.CFG?.carrierDown,score=inspect?.CFG?.opponentScore;
 const result={attempted:true,selected:null,reason:'carrier-reply-domain-unavailable',
  scope:'shared finite null/direct carrier Block or Blitz/one guard-marking Move or clearance Block then actual-child carrier contact; adaptive after observed own and preparation outcomes; fixed builtin in-action decisions; other enemy policies and live Block-rule agreement remain unverified',
  domain:[],calls:0,discoveryIncomplete:false,discoveryIssues:[],contactPages:{queries:0,pages:0,completed:0,uniqueInputs:0},terminalKeys:{requests:0,listedOutcomes:0,keylessObservedOutcomes:0,retainedKeys:0},terminalAggregate:{used:0,rejected:0,sumOmittedMassAcrossEvaluations:0},policies:[]};
 if(!Number.isFinite(down)||down<0||!Number.isFinite(score)||score<0)return {...result,reason:'carrier-reply-costs-invalid'};
 const issues=new Map();
 const issue=(reason,details={},widen=true)=>{
  if(widen)result.discoveryIncomplete=true;
  let row=issues.get(reason);if(!row){row={reason,count:0,examples:[]};issues.set(reason,row);result.discoveryIssues.push(row);}
  row.count++;if(row.examples.length<2)row.examples.push(details);
 };
 const maxHarm=Math.max(down,score);
 const unknown=()=>({lossLower:0,lossUpper:1,opponentTDLower:0,opponentTDUpper:1,harmLower:0,harmUpper:maxHarm,unknown:1});
 const zero=()=>({lossLower:0,lossUpper:0,opponentTDLower:0,opponentTDUpper:0,harmLower:0,harmUpper:0,unknown:0});
 const fields=Object.keys(zero());
 const add=(a,b,p)=>{for(const f of fields)a[f]+=p*b[f];};
 const envelope=(a,b)=>{for(const f of fields)a[f]=Math.max(a[f],b[f]);};
 const source=b=>b&&typeof b.key==='string'&&b.key&&b.observation&&b.active===opp&&b.observation.active===opp;
 const endpoint=p=>Array.isArray(p?.endpoints)&&p.endpoints.length&&p.endpoints.every(b=>b&&(b.touchdown===own||source(b))&&prob(b.p))&&Math.abs(p.endpoints.reduce((v,b)=>v+b.p,0)-1)<=EPS;
 if(!Array.isArray(policies)||!policies.length||policies.some(p=>!endpoint(p))){
  result.discoveryIncomplete=true;
  for(const p of Array.isArray(policies)?policies:[])for(const b of p?.endpoints||[]){
   if(b.touchdown===own)continue;
   if(b.observation&&b.active===opp&&b.observation.active===opp&&!(typeof b.key==='string'&&b.key))
    result.discoveryIssues.push({reason:'own-end-reply-key-unavailable',input:p.input,p:b.p});
  }
  return {...result,reason:'own-phase-endpoints-incomplete'};
 }
 const work=policies.map(p=>({...p,endpoints:p.endpoints.map(b=>({...b,ownTurnover:!!b.ownTurnover||!!b.turnover,turnover:false}))}));
 const endpointQueues=work.map(p=>[...p.endpoints].sort((a,b)=>b.p-a.p||key([a.key,a.touchdown]).localeCompare(key([b.key,b.touchdown]))));
 const policyOrder=work.map((p,i)=>({i,identity:key([p.input,p.endpoints.map(b=>[b.key,b.p,b.touchdown])])})).sort((a,b)=>a.identity.localeCompare(b.identity));
 const tasks=[];for(let round=0;round<Math.max(...endpointQueues.map(q=>q.length));round++)for(const {i} of policyOrder)if(endpointQueues[i][round])tasks.push({i,at:endpointQueues[i][round],round});
 const parents=tasks.map(t=>t.at),preparedEvidence=new Map(),cache=new Map(),contacts=new Map(),markers=new Map(),localMarkers=new Map(),contactDiscovery=new Map(),directEvidence=new Map();
 result.budget={parentRemainingMs:Math.max(0,deadline-start),allottedMs:Math.max(0,until-start),warmupMs:0,preparationWarmupMs:0,discoveryMs:0,assessmentMs:0,elapsedMs:0,remainingMs:0,
  scheduling:'direct major endpoint per policy; preparation jobs and actual children interleaved before broad discovery; canonical source/input identity, no incumbent role priority',
  policies:work.map(p=>({input:p.input,endpointCount:p.endpoints.length,warmAttempts:0,warmAttemptedMass:0,newTerminalQueries:0,newListedTerminalOutcomes:0,preparedJobs:0,preparedChildAttempts:0,preparedNewTerminalOutcomes:0,aggregatedEndpoints:0,aggregatedMass:0}))};
 const call=async(name,args,signature)=>{
  const k=key([name,signature]);if(cache.has(k))return cache.get(k);
  if(typeof services?.[name]!=='function'||left()<80){issue(typeof services?.[name]!=='function'?'reply-service-unavailable':'reply-call-budget-exhausted',{method:name,from:args[0]?.from??args[1]?.from});return null;}
  result.calls++;let r=null;try{r=await services[name](...args);}catch{issue('reply-service-exception',{method:name});}
  cache.set(k,r);return r;
 };
 const query=async(at,q,paged=false)=>{
  const found=new Map();let offset=0,total=null,last=null;
  if(paged)result.contactPages.queries++;
  while(true){
   const args={from:at.key,team:opp,precision:'none',sort:'steps',limit:paged?Math.min(16,64-offset):16,maxRushes:0,maxMs:Math.max(40,Math.min(400,left()-40)),...q,offset};
   const r=await call('candidates',[args],[at.key,opp,q,offset]);
   if(r?.ok!==true||r.position?.key!==at.key||!Array.isArray(r.candidates)){
    issue('reply-candidate-source-unverified',{from:at.key,families:q.families,offset,code:r?.code??null});break;
   }
   last=r;if(paged)result.contactPages.pages++;
   const cuts=r.truncated,otherCut=cuts!==undefined&&cuts!==false&&(!Array.isArray(cuts)||cuts.some(c=>c?.reason!=='page'));
   for(const c of r.candidates)if(c?.input)found.set(key(c.input),c);
   if(!paged){
    if(r.hasMore===true||r.complete===false||otherCut||Array.isArray(cuts)&&cuts.length)issue('reply-candidate-domain-truncated',{from:at.key,families:q.families,offset,hasMore:r.hasMore===true,declaredComplete:r.complete,truncated:cuts});
    break;
   }
   // `complete` describes generation, not whether all pages were returned.
   // Every later page must retain this source, filter, total and cursor unit.
   const cursor=Number.isInteger(r.offset)&&r.offset===offset&&Number.isInteger(r.total)&&r.total>=0&&
    r.returned===r.candidates.length&&r.offset+r.returned<=r.total&&typeof r.hasMore==='boolean'&&
    r.hasMore===(r.offset+r.returned<r.total)&&(total===null||total===r.total);
   if(!cursor||r.complete!==true||otherCut){
    issue('reply-contact-page-unverified',{from:at.key,offset,total:r.total,previousTotal:total,returned:r.returned,hasMore:r.hasMore,declaredComplete:r.complete,truncated:cuts});break;
   }
   total=r.total;
   if(!r.hasMore){result.contactPages.completed++;break;}
   if(!Number.isInteger(r.nextOffset)||r.nextOffset!==offset+r.returned||r.nextOffset<=offset){
    issue('reply-contact-cursor-unverified',{from:at.key,offset,nextOffset:r.nextOffset,returned:r.returned});break;
   }
   // Use the existing 64-input shared domain ceiling as the collection bound.
   // Exhaustion remains unknown; page size, local retained contacts and budgets
   // are unchanged. No claimed completeness for discarded alternatives.
   if(r.nextOffset>=64){issue('reply-contact-page-domain-limit',{from:at.key,returned:found.size,total,retainedCursor:r.nextOffset});break;}
   if(left()<80){issue('reply-contact-page-budget-exhausted',{from:at.key,offset,nextOffset:r.nextOffset,total});break;}
   offset=r.nextOffset;
  }
  if(paged)result.contactPages.uniqueInputs+=found.size;
  return last?{...last,candidates:[...found.values()]}:null;
 };
 const validExplore=(e,from)=>e?.ok===true&&e.outcomeIdentity==='complete-state-v1'&&e.position?.key===from&&e.perspective===own&&e.activeTeam===opp&&e.decisionPolicy?.mode==='builtin'&&e.decisionPolicy.own==='builtin'&&e.decisionPolicy.opponent==='builtin'&&prob(e.rest?.p)&&prob(e.unresolvedMass)&&e.unresolvedMass<=e.rest.p+EPS&&Array.isArray(e.outcomes)&&e.outcomes.every(b=>prob(b?.p)&&typeof b.turnover==='boolean'&&(b.touchdown==null||['A','B'].includes(b.touchdown))&&(b.active==null||['A','B'].includes(b.active))&&(!b.observation||b.active==null||b.observation.active===b.active))&&Math.abs(e.outcomes.reduce((v,b)=>v+b.p,0)+e.rest.p-1)<=EPS&&new Set(e.outcomes.map(b=>b.key).filter(Boolean)).size===e.outcomes.filter(b=>b.key).length;
 const step=async(at,input,continuation=true)=>{
  const signature=[at.key,opp,input,continuation],k=key(['step',signature]);if(cache.has(k))return cache.get(k);
  let r={known:[],rest:1};
  const complex=input?.kind==='playerAction'&&['block','blitz'].includes(input.action);
  const slotAvailable=stage=>{
   if(!complex||left()>=1240)return true;
   issue('reply-complex-enumeration-budget-unavailable',{from:at.key,action:input.action,stage,remainingMs:Math.max(0,left()),requiredMs:1240});return false;
  };
  if(source(at)){
   // A nominal 1200ms contact enumeration must fit inside the original 4s
   // frame. Refusal leaves the entire chance mass unknown; it is not safety.
   if(!slotAvailable('before-validation')){cache.set(k,r);return r;}
   const v=await call('validate',[input,{from:at.key,team:opp}],signature);
   if(v?.ok===true&&v.position===at.key&&v.legal===false)r={illegal:true,known:[],rest:0};
   else if(v?.ok===true&&v.position===at.key&&v.legal===true){
    if(!slotAvailable('after-validation')){cache.set(k,r);return r;}
    // maxKeep retains the actual observation as well as the engine state. Keep
    // it unchanged; only last-contact evaluation can omit successor handles.
    const opts={from:at.key,team:opp,perspective:own,observations:true,decisions:'builtin',maxOutcomes:128,maxKeep:256,maxLeaves:512,threshold:.000001,maxMs:complex?1200:Math.max(40,Math.min(1200,left()-40)),...complex&&services.exploreLegalityValidation===true?{coachEnumerationDeadline:until}:{},...!continuation?{noKeys:true}:{}};
    if(!continuation)result.terminalKeys.requests++;
    const e=await call('explore',[input,opts],signature);
    if(validExplore(e,at.key)){r={known:e.outcomes,rest:e.rest.p,summary:e};
     if(!continuation){result.terminalKeys.listedOutcomes+=e.outcomes.length;result.terminalKeys.keylessObservedOutcomes+=e.outcomes.filter(b=>!b.key&&b.observation).length;result.terminalKeys.retainedKeys+=e.outcomes.filter(b=>b.key).length;}
     if(e.unresolvedMass>EPS)issue('reply-explore-unexpanded-mass',{from:at.key,p:e.unresolvedMass},false);
     if(e.rest.p>e.unresolvedMass+EPS)issue('reply-explore-unlisted-enumerated-mass',{from:at.key,p:e.rest.p-e.unresolvedMass},false);}
    else if(e?.code==='coach-live-explore-refused'&&e.reason==='complex-enumeration-budget-unavailable')issue('reply-complex-enumeration-budget-unavailable',{from:at.key,action:input.action,stage:'service-admission',code:e.code});
    else issue('reply-explore-evidence-unverified',{from:at.key,code:e?.code??null},false);
   }else issue('reply-validation-source-unverified',{from:at.key,code:v?.code??null},false);
  }
  cache.set(k,r);return r;
 };
 const price=b=>{
  if(b?.touchdown){const enemy=b.touchdown===opp,v=enemy?1:0,h=enemy?score:0;return {lossLower:v,lossUpper:v,opponentTDLower:v,opponentTDUpper:v,harmLower:h,harmUpper:h,unknown:0};}
  if(!b?.key||!b.observation||!['A','B'].includes(b.active)||b.observation.active!==b.active)return unknown();
  const h=held(b.observation),loss=h?.team===own?0:1;
  return {lossLower:loss,lossUpper:loss,opponentTDLower:0,opponentTDUpper:0,harmLower:loss*down,harmUpper:loss*down,unknown:0};
 };
 const absorbing=b=>!!b.touchdown||!!b.turnover||b.active===own;
 const discoverContacts=async(at,afterPreparation=false)=>{
  if(absorbing(at)||!source(at))return [];
  const h=held(at.observation);if(h?.team!==own)return [];
  const identity=key([at.key,h.id,afterPreparation]);if(contactDiscovery.has(identity))return contactDiscovery.get(identity);
  const q=await query(at,{families:afterPreparation?['blitz']:['block','blitz'],targets:[h.id]},!afterPreparation);
  const rows=(q?.candidates||[]).map(c=>c.input).filter(i=>contact(i,h.id)&&(!afterPreparation||i.action==='blitz')).sort((a,b)=>a.path.length-b.path.length||key(a).localeCompare(key(b)));
  if(rows.length>2)issue('local-contact-limit',{from:at.key,proposed:rows.length,retained:2});
  const selected=rows.slice(0,2);for(const i of selected)contacts.set(key(i),i);contactDiscovery.set(identity,selected);return selected;
 };
 const afterContact=async(at,input)=>{
  const h=held(at.observation);if(h?.team!==own||!contact(input,h.id))return null;
  const e=await step(at,input,false);if(e.illegal)return null;
  const value=zero(),aggregate=contactRestBounds(e.summary,own,at.key,down,score);
  if(aggregate){for(const f of fields)value[f]+=aggregate[f];result.terminalAggregate.used++;result.terminalAggregate.sumOmittedMassAcrossEvaluations+=e.rest;}
  else{add(value,unknown(),e.rest);result.terminalAggregate.rejected++;}
  for(const b of e.known){
   // Keys are required for a later action, not for an already observed last
   // contact's ball state. Preparation-child sources still use strict price().
   const h=held(b.observation),ball=b.observation?.ball;
   const terminalKnown=!b.touchdown&&b.observation&&['A','B'].includes(b.active)&&b.observation.active===b.active&&
    (ball?.kind==='ground'||ball?.kind==='held'&&['A','B'].includes(h?.team));
   const loss=h?.team===own?0:1;
   add(value,terminalKnown?{lossLower:loss,lossUpper:loss,opponentTDLower:0,opponentTDUpper:0,
    harmLower:loss*down,harmUpper:loss*down,unknown:0}:price(b),b.p);
  }
  return value;
 };
 const choose=async(at,inputs)=>{
  const best=price(at);if(absorbing(at)||!source(at)||held(at.observation)?.team!==own)return best;
  if(left()<80){issue('reply-assessment-budget-exhausted',{from:at.key});envelope(best,unknown());return best;}
  let applicable=false;
  for(const i of inputs){if(left()<80){issue('reply-discovery-budget-exhausted');break;}const v=await afterContact(at,i);if(v){applicable=true;envelope(best,v);}}
  // An illegal union input is inapplicable, not an observed safe reply. A
  // source with no priced carrier contact keeps its undiscovered threat open.
  if(!applicable&&held(at.observation)?.team===own){issue('no-applicable-priced-contact',{from:at.key});envelope(best,unknown());}
  return best;
 };
 const discoverPreparations=async at=>{
  if(localMarkers.has(at.key))return localMarkers.get(at.key);
  if(absorbing(at)||!source(at)||held(at.observation)?.team!==own){localMarkers.set(at.key,[]);return [];}
  const h=held(at.observation),chosen=new Map();if(h?.team!==own||absorbing(at)){localMarkers.set(at.key,[]);return [];}
  const guards=at.observation.players.filter(p=>p.team===own&&p.id!==h.id&&standing(p)&&p.tackleZone!==false&&dist(p.pos,h.pos)<=1).sort((a,b)=>a.id.localeCompare(b.id));
  if(guards.length>2)issue('local-protector-limit',{from:at.key,proposed:guards.length,retained:2});
  for(const g of guards.slice(0,2)){
   if(left()<80){issue('reply-discovery-budget-exhausted');break;}
   const cells=[];for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){const x=g.pos.x+dx,y=g.pos.y+dy;if((dx||dy)&&x>=0&&y>=0&&x<at.observation.pitch.width&&y<at.observation.pitch.height)cells.push({x,y});}
   const moves=await query(at,{families:['move'],region:{within:cells}}),blocks=await query(at,{families:['block'],targets:[g.id]});
   const proposals=[...(moves?.candidates||[]).map(c=>c.input).filter(i=>ordinary(i)&&cells.some(p=>key(p)===key(i.path.at(-1).to))),...(blocks?.candidates||[]).map(c=>c.input).filter(i=>contact(i,g.id)&&i.action==='block')].sort((a,b)=>a.path.length-b.path.length||key(a).localeCompare(key(b)));
   for(const i of proposals)chosen.set(key(i),i);
  }
  if(chosen.size>2)issue('local-preparation-limit',{from:at.key,proposed:chosen.size,retained:2});
  const selected=[...chosen.values()].slice(0,2);localMarkers.set(at.key,selected);for(const i of selected)markers.set(key(i),i);
  return selected;
 };
 // Preserve genuine early observations before expensive adaptive discovery.
 // This is incomplete warm evidence, never a certificate for the final union.
 const warmStart=Date.now();
 for(const {i,at} of tasks.filter(t=>t.round===0)){
  if(absorbing(at)||!source(at)||held(at.observation)?.team!==own)continue;
  if(left()<80){issue('reply-breadth-budget-exhausted',{policy:i,from:at.key});break;}
  const beforeQueries=result.terminalKeys.requests,beforeOutcomes=result.terminalKeys.listedOutcomes;
  const inputs=await discoverContacts(at),v=inputs.length?await choose(at,inputs):null;
  result.budget.policies[i].newTerminalQueries+=result.terminalKeys.requests-beforeQueries;result.budget.policies[i].newListedTerminalOutcomes+=result.terminalKeys.listedOutcomes-beforeOutcomes;
  if(v){directEvidence.set(at.key,v);result.budget.policies[i].warmAttempts++;result.budget.policies[i].warmAttemptedMass+=at.p;}
 }
 result.budget.warmupMs=Date.now()-warmStart;
 // Discover preparation on each major source before enumerating other chance
 // roots. Price actual observed children across jobs, not one whole source at
 // a time. A partial job keeps every unvisited probability unit unknown.
 const preparedStart=Date.now(),major=tasks.filter(t=>t.round===0),jobs=[];
 result.preparationWork={started:0,childAttempts:0,newTerminalQueries:0,newListedTerminalOutcomes:0,examples:[]};
 for(const {at} of major){
  if(absorbing(at)||!source(at)||held(at.observation)?.team!==own){localMarkers.set(at.key,[]);continue;}
  if(left()<80){issue('preparation-discovery-budget-exhausted');break;}await discoverPreparations(at);
 }
 const bound=job=>{const value={...job.value};add(value,unknown(),job.e.rest+Math.max(0,job.queue.slice(job.next).reduce((p,b)=>p+b.p,0)));return value;};
 const childrenRound=async()=>{
  let pending=false;
  for(const job of jobs){
   if(job.next>=job.queue.length)continue;pending=true;
   if(left()<80){issue('preparation-assessment-budget-exhausted',{from:job.at.key});break;}
   const b=job.queue[job.next++],beforeQueries=result.terminalKeys.requests,beforeOutcomes=result.terminalKeys.listedOutcomes;
   const inputs=await discoverContacts(b,true),value=await choose(b,inputs);
   add(job.value,value,b.p);job.assessedMass+=b.p;
   result.preparationWork.childAttempts++;result.budget.policies[job.i].preparedChildAttempts++;
   result.preparationWork.newTerminalQueries+=result.terminalKeys.requests-beforeQueries;
   const outcomes=result.terminalKeys.listedOutcomes-beforeOutcomes;
   result.preparationWork.newListedTerminalOutcomes+=outcomes;result.budget.policies[job.i].preparedNewTerminalOutcomes+=outcomes;
   if(result.preparationWork.examples.length<2)result.preparationWork.examples.push({from:job.at.key,preparation:job.input,child:b.key,p:b.p,newListedTerminalOutcomes:outcomes});
  }
  return pending;
 };
 for(let round=0;round<2;round++){
  for(const {i,at} of major){
   const input=localMarkers.get(at.key)?.[round];if(!input)continue;
   if(left()<80){issue('preparation-initialization-budget-exhausted',{from:at.key,policy:i});break;}
   const e=await step(at,input);if(e.illegal)continue;
   const job={i,at,input,e,value:zero(),queue:[],next:0,assessedMass:0};
   for(const b of e.known){
    if(absorbing(b)||held(b.observation)?.team!==own){add(job.value,price(b),b.p);continue;}
    if(!source(b)){issue('preparation-child-source-unverified',{from:at.key,key:b.key});add(job.value,unknown(),b.p);continue;}
    job.queue.push(b);
   }
   job.queue.sort((a,b)=>b.p-a.p||key(a.key).localeCompare(key(b.key)));jobs.push(job);
   result.preparationWork.started++;result.budget.policies[i].preparedJobs++;
  }
  await childrenRound();
 }
 while(left()>=80&&await childrenRound()){}
 for(const job of jobs){
  const value=bound(job);let evidence=preparedEvidence.get(job.at.key);
  if(!evidence){evidence=zero();preparedEvidence.set(job.at.key,evidence);}envelope(evidence,value);
 }
 result.budget.preparationWarmupMs=Date.now()-preparedStart;
 const discoveryStart=Date.now();
 // Discovery proposes one common union; probability always comes from the
 // actual source-bound validation/exploration during assessment.
 for(const at of parents){
  if(absorbing(at)||held(at.observation)?.team!==own){localMarkers.set(at.key,[]);continue;}
  if(left()<80){issue('reply-discovery-budget-exhausted');break;}
  await discoverContacts(at);await discoverPreparations(at);
 }
 for(const at of parents)for(const i of localMarkers.get(at.key)||[]){
  if(left()<80){issue('reply-discovery-budget-exhausted');break;}
  const e=await step(at,i);if(e.illegal)continue;
  for(const b of e.known){if(left()<80){issue('reply-discovery-budget-exhausted');break;}if(absorbing(b))continue;if(!source(b)){issue('preparation-child-source-unverified',{from:at.key,key:b.key});continue;}await discoverContacts(b,true);}
 }
 const direct=[...contacts.values()],preps=[...markers.values()];
 if(!direct.length&&parents.some(at=>!absorbing(at)&&held(at.observation)?.team===own))issue('no-priced-carrier-contact');
 result.domain.push({preparation:null,contact:null});
 for(const i of direct)result.domain.push({preparation:null,contact:i});
 for(const p of preps){result.domain.push({preparation:p,contact:null});for(const c of direct.filter(i=>i.action==='blitz'))result.domain.push({preparation:p,contact:c});}
 if(result.domain.length>64){issue('shared-domain-limit',{proposed:result.domain.length,retained:64});result.domain=result.domain.slice(0,64);}
 result.budget.discoveryMs=Date.now()-discoveryStart;
 const assess=async at=>{
  const best=await choose(at,result.domain.filter(d=>!d.preparation&&d.contact).map(d=>d.contact));
  const warm=directEvidence.get(at.key);if(warm)envelope(best,warm);
  const prepared=preparedEvidence.get(at.key);if(prepared)envelope(best,prepared);
  if(absorbing(at)||!source(at)||held(at.observation)?.team!==own)return best;
  for(const p of preps){
   if(left()<80){issue('reply-discovery-budget-exhausted');break;}
   const rows=result.domain.filter(d=>d.preparation&&key(d.preparation)===key(p));if(!rows.length)continue;
   const e=await step(at,p);if(e.illegal)continue;
   const value=zero();add(value,unknown(),e.rest);
   for(const b of e.known){const child=await choose(b,rows.filter(d=>d.contact).map(d=>d.contact));add(value,child,b.p);}
   envelope(best,value);
  }
  return best;
 };
 const widen=(p,value)=>{
  const cap=zero();
  for(const at of p.endpoints)add(cap,!absorbing(at)&&held(at.observation)?.team===own?unknown():price(at),at.p);
  for(const f of ['lossUpper','opponentTDUpper','harmUpper','unknown'])value[f]=Math.max(value[f],cap[f]);
 };
 // Max at each observed own endpoint and preparation child, then weight chance.
 const assessmentStart=Date.now();
 for(const [i,p] of work.entries()){const value=zero();for(const at of p.endpoints){add(value,await assess(at),at.p);result.budget.policies[i].aggregatedEndpoints++;result.budget.policies[i].aggregatedMass+=at.p;}
  if(result.discoveryIncomplete)widen(p,value);
  for(const f of fields)value[f]=Math.max(0,Math.min(f.startsWith('harm')?maxHarm:1,value[f]));
  result.policies.push({input:p.input,...value});
 }
 // A later competitor can exhaust discovery too: widen every policy equally.
 if(result.discoveryIncomplete)for(let i=0;i<work.length;i++)widen(work[i],result.policies[i]);
 for(const value of result.policies)for(const f of fields)value[f]=Math.max(0,Math.min(f.startsWith('harm')?maxHarm:1,value[f]));
 result.budget.assessmentMs=Date.now()-assessmentStart;result.budget.elapsedMs=Date.now()-start;result.budget.remainingMs=Math.max(0,left());
 return {...result,reason:result.discoveryIncomplete?'carrier-reply-discovery-incomplete':'common-finite-carrier-reply-bounds'};
}
