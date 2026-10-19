import {same,policyIdentity,stableDataKey} from './policy.mjs';
import {timeoutWitness} from './timeout-evidence.mjs';
import {endpointUtilityRange,endpointUtilityPoint,minimumUtilityBounds} from './endpoint-utility.mjs';
import {withServiceOwner,recordServiceObservation} from './services.mjs';
import {changedZoneReplyPlans,reserveChangedZoneReplies} from './changed-zone-replies.mjs';
const EPS=1e-8,prob=x=>Number.isFinite(x)&&x>=0&&x<=1+EPS;
const terminal=(b,team)=>b?.touchdown||['fullTime','halfOver','touchdown'].includes(b?.observation?.phase)||b?.active===team;
const noActor=(b,opp)=>b?.active===opp&&b.observation?.active===opp&&b.observation.phase==='play'&&
 !b.observation.pending&&!b.observation.activation&&Array.isArray(b.observation.players)&&
 b.observation.players.filter(p=>p.team===opp).every(p=>p.canBeActivated===false);
/** Complete own policies are evaluated at real opponent End/TD boundaries.
 * A finite one-action-plus-End reply union gives upper witnesses for the
 * opponent's minimum utility. Unsearched opposing policies retain the global
 * utility lower bound; they are never labeled zero-risk or complete coverage. */
export async function compareOpponentEndValues(root,own,services,inspect,deadline,{valueMode='bounded-terminal',comparisonScope='global',ledger=null,diagnosticOwners=[]}={}){
 const range=endpointUtilityRange(root,inspect,valueMode),team=root.team,opp=team==='A'?'B':'A',rootEdition=root.ruleset?.rulesEdition??root.rulesEdition;
 const result={valid:false,reason:range.reason??'common-endpoint-frame-unavailable',valueMode,
  horizon:'actual-own-End/first-TD-or-actual-opponent-End/v1',bounds:[],policies:[],calls:0,domain:[],
  comparisonScope,replyClosureBranchLimit:comparisonScope==='finite-common'?64:null,scope:'full chance mass inside source-bound policies; minimum over legal observed replies plus an explicit bound for unsearched opposing policies; next-own board is a heuristic, not future dice or full match value'};
 if(!range.valid)return result;
 if(!Array.isArray(own)||own.length<2||own.some(p=>!p.complete||!p.tree?.input||!p.policy||
  !Array.isArray(p.endpoints)||!p.endpoints.length||p.endpoints.some(b=>!prob(b?.p))||
  Math.abs(p.endpoints.reduce((s,b)=>s+b.p,0)-1)>EPS))return {...result,reason:'common-own-endpoint-mass-invalid'};
 let contractBroken=null;let stoppedRPC=null;let domainDiscoveryComplete=true;
 const left=()=>deadline-Date.now(),cache=new Map(),domain=new Map();
 const call=async(name,args,scoped)=>{if(stoppedRPC||left()<100||typeof scoped[name]!=='function'){
   recordServiceObservation(scoped,{method:name,status:'helper-skipped',reason:stoppedRPC?'frame-already-stopped':typeof scoped[name]!=='function'?'service-unavailable':'helper-deadline'});return null;}
  const key=stableDataKey([name,args]);if(cache.has(key)){recordServiceObservation(scoped,{method:name,status:'helper-cache-hit'});return cache.get(key);}result.calls++;
  let r;try{r=await scoped[name](...args);}catch{r=null;stoppedRPC={method:name,code:'service-exception'};}if(r?.ok===false)stoppedRPC={method:name,code:r.code??'service-failure',from:args[1]?.from??args[0]?.from??null};
  if(stoppedRPC)recordServiceObservation(scoped,{method:name,status:'helper-first-stop',reason:stoppedRPC.code});cache.set(key,r);return r;};
 const law=(e,input,from)=>{
  if(e?.ok===false){const w=timeoutWitness(e,input,{from,team:opp,perspective:team},root.requestId??null);
   return w.usable?{outcomes:w.evidence.outcomes,ownTD:w.evidence.observed.touchdown,oppTD:w.evidence.observed.opponentTouchdown,
    failed:true}:null;}
  if(e?.ok!==true||e.outcomeIdentity!=='complete-state-v1'||e.position?.key!==from||
   e.perspective!==team||e.activeTeam!==opp||e.decisionPolicy?.mode!=='builtin'||
   e.decisionPolicy.own!=='builtin'||e.decisionPolicy.opponent!=='builtin'||
   !Array.isArray(e.outcomes)||!prob(e.rest?.p)||!prob(e.unresolvedMass)||e.unresolvedMass>=1||!prob(e.enumerated)||
   Math.abs(e.enumerated/(1-e.unresolvedMass)-1)>1e-6||
   e.outcomes.some(b=>!prob(b?.p)||typeof b.turnover!=='boolean'||
    ![null,undefined,'A','B'].includes(b.touchdown)||b.observation&&(b.active!==b.observation.active||rootEdition!==undefined&&(b.observation.ruleset?.rulesEdition??b.observation.rulesEdition)!==rootEdition))||
   Math.abs(e.outcomes.reduce((s,b)=>s+b.p,0)+e.rest.p-1)>EPS)return null;
  // Builtin scalar TD can include extrapolation. Only q-unresolved is a lower
  // witness; retained TD states have their original unconditional mass.
  return {outcomes:e.outcomes,ownTD:prob(e.pTouchdown)?Math.max(0,e.pTouchdown-e.unresolvedMass):0,
   oppTD:prob(e.pOpponentTouchdown)?Math.max(0,e.pOpponentTouchdown-e.unresolvedMass):0,failed:false};
 };
 const explore=async(at,input,keys,scoped)=>{
  const v=await call('validate',[input,{from:at.key,team:opp}],scoped);
  if(v?.ok!==true||v.position!==at.key||typeof v.legal!=='boolean')return {unknown:true,reason:'reply-legality-unverified'};
  if(!v.legal)return {illegal:true,reason:'reply-input-not-legal-at-source'};
  const e=await call('explore',[input,{from:at.key,team:opp,perspective:team,observations:true,
   // A bounded leaf batch returns residual mass before the RPC deadline.
   // The same cap applies to every policy; residual mass is never safety.
   coachEnumerationDeadline:deadline,noKeys:!keys,decisions:'builtin',maxOutcomes:comparisonScope==='finite-common'?128:40,maxKeep:256,maxLeaves:comparisonScope==='finite-common'?512:64,threshold:1e-6,
   maxMs:Math.max(50,Math.min(comparisonScope==='finite-common'?1200:450,left()-80))}],scoped);
  const l=law(e,input,at.key);return l?{law:l}: {unknown:true,reason:'reply-chance-law-unverified'};
 };
 const point=b=>endpointUtilityPoint(b,root,inspect,valueMode);
 const sum=rows=>({lower:rows.some(r=>r.lower===null)?null:rows.reduce((v,r)=>v+r.p*r.lower,0),
  upper:rows.some(r=>r.upper===null)?null:rows.reduce((v,r)=>v+r.p*r.upper,0)});
 const fold=async(l,close,scoped)=>{
  const rows=[],reasons=[];let closures=0,priced=0,knownStateMass=0,listedOwnTD=0,listedOppTD=0,nestedOwnTD=0,nestedOppTD=0;
  for(const b of l.outcomes.slice().sort((a,b)=>b.p-a.p)){
   if(b.touchdown===team)listedOwnTD+=b.p;else if(b.touchdown===opp)listedOppTD+=b.p;
   if(terminal(b,team)){
    const p=point(b);if(p.valid){rows.push({p:b.p,lower:p.value,upper:p.value});priced+=b.p;knownStateMass+=b.p;}
    else {reasons.push(p.reason);if(['endpoint-value-outside-first-TD-horizon','endpoint-value-score-marker-mismatch','endpoint-value-active-state-mismatch'].includes(p.reason))contractBroken=p.reason;}
   }else if(close&&b.key&&b.observation&&b.active===opp){
    if(comparisonScope==='finite-common'&&closures>=result.replyClosureBranchLimit){reasons.push('reply-End-closure-branch-limit; mass-remains-unknown');continue;}
    closures++;const r=await reply(b,{kind:'endTurn'},false,scoped);
    if(r.valid){rows.push({p:b.p,...r.bounds});priced+=b.p;knownStateMass+=b.p*r.pricedChanceMass;reasons.push(...r.reasons);nestedOwnTD+=b.p*r.witnessedTD.own;nestedOppTD+=b.p*r.witnessedTD.opponent;}
    else reasons.push(r.reason);
   }else reasons.push('reply-End-source-or-budget-unavailable');
  }
  let remaining=Math.max(0,1-priced);
  // Preserve even observed TD mass omitted from the retained state list.
  // Its roster/position value is unknown within the declared utility range.
  const extras=[[Math.max(0,l.ownTD-listedOwnTD),1],[Math.max(0,l.oppTD-listedOppTD),-1]];
  if(extras.reduce((s,x)=>s+x[0],0)>remaining+EPS)return {valid:false,reason:'reply-observed-TD-mass-inconsistent'};
  for(const [mass,direction] of extras)if(mass>EPS){
   rows.push({p:mass,lower:valueMode!=='legacy-point'?range.score+direction*range.touchdown-range.positionScale:null,
    upper:valueMode!=='legacy-point'?range.score+direction*range.touchdown+range.positionScale:null});remaining-=mass;
  }
  if(remaining>EPS){rows.push({p:remaining,lower:range.lower,upper:range.upper});reasons.push('reply-unpriced-chance-mass');}
  return {valid:true,bounds:sum(rows),pricedChanceMass:knownStateMass,unknownChanceMass:Math.max(0,1-knownStateMass),reasons:[...new Set(reasons)],
   witnessedTD:{own:Math.min(1,Math.max(listedOwnTD,l.ownTD)+nestedOwnTD),opponent:Math.min(1,Math.max(listedOppTD,l.oppTD)+nestedOppTD)},failedRPC:l.failed};
 };
 const reply=async(at,input,close=true,scoped)=>{
  if(stoppedRPC)return {valid:false,reason:'reply-search-stopped-after-RPC-failure'};
  if(left()<100)return {valid:false,reason:'reply-End-budget-unavailable'};
  const r=await explore(at,input,close&&input.kind!=='endTurn',scoped);
  if(!r.law)return {valid:false,...r};
  return fold(r.law,close&&input.kind!=='endTurn',scoped);
 };
 const frameStarted=ledger?Date.now():null;
 const work=own.map((p,i)=>{
  const phase=ledger?.phase({...diagnosticOwners[i],phase:'formal-reply',allocatedSlotMs:null,localDeadline:deadline,sharedFrame:true}),scoped=phase?withServiceOwner(services,phase.owner):services;
  phase?.finish({serviceCostsObserved:recordServiceObservation(scoped,{method:'phase',status:'phase-enter'})});
  return {p,i,phase,services:scoped,nodes:p.endpoints.map(b=>({at:b,bounds:{lower:range.lower,upper:range.upper},
   endChecked:false,knownEnds:0,unknownChanceMass:1,reasons:[],outsidePoliciesUnverified:true,finiteReplies:[],domainChecked:0,domainUnknown:0,alternatives:0,observedOpponentTD:0,observedOwnTD:0}))};
 });
 if(ledger)result.phaseIds=work.map(w=>w.phase.phaseId);
 let frameOutcome=null;const returned=value=>{frameOutcome=value;return value;};
 try{
 const order=work.slice().sort((a,b)=>String(policyIdentity(a.p.tree)).localeCompare(String(policyIdentity(b.p.tree))));
 const queues=order.map(w=>w.nodes.slice().sort((a,b)=>b.at.p-a.at.p||String(a.at.key).localeCompare(String(b.at.key))));
 const tasks=[];for(let n=0;n<Math.max(...queues.map(q=>q.length));n++)for(let i=0;i<order.length;i++)if(queues[i][n])tasks.push({w:order[i],node:queues[i][n]});
 // Every real End witness is measured before spending remaining time on a
 // reply proposal. Canonical round robin depends on policies, not incumbency.
 for(const {w,node} of tasks){const at=node.at;
  if(terminal(at,team)){const p=point(at);if(p.valid){node.bounds={lower:p.value,upper:p.value};node.finiteReplies.push({bounds:node.bounds,unknownChanceMass:0});node.endChecked=true;node.knownEnds=1;node.unknownChanceMass=0;node.outsidePoliciesUnverified=false;node.observedOwnTD=Number(at.touchdown===team);node.observedOpponentTD=Number(at.touchdown===opp);}
   else {node.reasons.push(p.reason);if(['endpoint-value-outside-first-TD-horizon','endpoint-value-score-marker-mismatch','endpoint-value-active-state-mismatch'].includes(p.reason))contractBroken=p.reason;}continue;}
  if(!at.key||!at.observation||at.active!==opp||at.observation.active!==opp){node.reasons.push('opponent-End-source-incomparable');continue;}
  const r=await reply(at,{kind:'endTurn'},false,w.services);
  if(r.valid){node.endChecked=true;node.knownEnds=r.pricedChanceMass;node.unknownChanceMass=r.unknownChanceMass;node.alternatives++;node.observedOwnTD=Math.max(node.observedOwnTD,r.witnessedTD.own);node.observedOpponentTD=Math.max(node.observedOpponentTD,r.witnessedTD.opponent);
   node.finiteReplies.push(r);const sole=noActor(at,opp);node.outsidePoliciesUnverified=!sole;
   node.bounds=sole?r.bounds:minimumUtilityBounds([node.bounds,r.bounds]);node.reasons.push(...r.reasons);
  }else node.reasons.push(r.reason??'opponent-End-unavailable');
 }
 // At most one discovery source per policy. All peers receive the same
 // planned pages: the original main round first, then bounded contact rounds.
 // A successful page is not exhaustive discovery; hasMore stays observable.
 const plans=[{id:'main',families:['move','secure','block','blitz','handoff','pass'],sort:'goalDistance',limit:12}];
 if(comparisonScope==='finite-common')plans.push({id:'block',families:['block'],sort:'steps',limit:4},{id:'blitz',families:['blitz'],sort:'steps',limit:4});
 const discovery={schema:'reply-domain-discovery/1',scope:'planned bounded pages; not all native inputs or all source endpoints',
  plans,pages:[],unionSources:[]};
 result.domainDiscovery=discovery;
 const sources=queues.map(q=>q.find(n=>n.outsidePoliciesUnverified&&n.at.key&&n.at.observation&&n.at.active===opp));
 const mainTasks=order.flatMap((w,i)=>sources[i]?[{w,node:sources[i]}]:[]);
 const zoneTasks=tasks.filter(({node})=>node.outsidePoliciesUnverified&&node.at.key&&node.at.observation&&node.at.active===opp);
 if(comparisonScope==='finite-common'){
  const zone=changedZoneReplyPlans(zoneTasks.map(({node})=>node.at.observation),team);
  discovery.changedZone={...zone,sourceCount:zoneTasks.length,scope:'changed tackle zones across every observed nonterminal own-End source; bounded moving replies, not all paths or unobserved sources'};
  if(!zone.valid)domainDiscoveryComplete=false;
  for(const q of zone.plans)plans.push({id:'changed-zone:'+q.players[0],families:['blitz'],sort:'steps',limit:4,...q,zoneActor:q.players[0]});
 }
 for(const plan of plans)for(const {w,node} of plan.zoneActor?zoneTasks:mainTasks){
  const page={pageId:'p'+(discovery.pages.length+1),plan:plan.id,families:plan.families,...(plan.zoneActor?{zoneActor:plan.zoneActor,players:plan.players,targets:plan.targets}:{}),ownIndex:w.i,from:node.at.key,sourceMass:node.at.p,
   status:'planned',reason:null,responseOk:null,responseFrom:null,responseCode:null,offset:null,limit:null,returned:null,total:null,hasMore:null,complete:null,nextOffset:null,pool:null,truncated:[],
   proposalCount:0,uniqueAdded:0,unionInputIds:[]};
  discovery.pages.push(page);
  if(stoppedRPC||left()<500){domainDiscoveryComplete=false;page.status='skipped';page.reason=stoppedRPC?'frame-already-stopped':'reply-domain-discovery-deadline';node.reasons.push(page.reason);continue;}
  const q=await call('candidates',[{from:node.at.key,team:opp,families:plan.families,
   ...(plan.zoneActor?{players:plan.players,targets:plan.targets}:{}),precision:'none',sort:plan.sort,limit:plan.limit,maxRushes:comparisonScope==='finite-common'?2:0,maxMs:200}],w.services);
  page.status='unverified';page.reason='reply-domain-source-unverified';
  if(q){
   page.responseOk=typeof q.ok==='boolean'?q.ok:null;page.responseFrom=q.position?.key??null;page.responseCode=q.code??null;
   page.offset=Number.isInteger(q.offset)&&q.offset>=0?q.offset:null;page.limit=Number.isInteger(q.limit)&&q.limit>=0?q.limit:null;
   page.pool=q.pool?Object.fromEntries(['generated','afterFilters','afterLimits','droppedByFilters'].map(k=>[k,Number.isInteger(q.pool[k])&&q.pool[k]>=0?q.pool[k]:null])):null;
   page.returned=Number.isInteger(q.returned)&&q.returned>=0?q.returned:null;
   page.total=Number.isInteger(q.total)&&q.total>=0?q.total:null;
   page.hasMore=typeof q.hasMore==='boolean'?q.hasMore:null;page.complete=typeof q.complete==='boolean'?q.complete:null;
   page.nextOffset=Number.isInteger(q.nextOffset)&&q.nextOffset>=0?q.nextOffset:null;
   page.truncated=Array.isArray(q.truncated)?q.truncated.map(t=>Object.fromEntries(['reason','dropped','evaluated','pool','limit','max','nextOffset'].filter(k=>Object.hasOwn(t??{},k)).map(k=>[k,t[k]]))):[];
  }
  if(q?.ok!==true||q.position?.key!==node.at.key||!Array.isArray(q.candidates)){
   domainDiscoveryComplete=false;node.reasons.push(page.reason);continue;
  }
  // The actual native page contract supplies counts even for an empty page.
  // Missing metadata cannot be interpreted as a successful empty discovery.
  if(comparisonScope==='finite-common'&&(!Number.isInteger(q.offset)||q.offset!==0||
   !Number.isInteger(q.limit)||q.limit<1||q.limit>plan.limit||!Number.isInteger(q.total)||q.total<0||
   q.returned!==q.candidates.length||q.returned>q.limit||q.total<q.offset+q.returned||
   typeof q.complete!=='boolean'||typeof q.hasMore!=='boolean'||q.hasMore!==(q.offset+q.returned<q.total)||
   q.nextOffset!==(q.hasMore?q.offset+q.returned:null)||!Array.isArray(q.truncated)||
   q.truncated.some(t=>!t||typeof t.reason!=='string')||!page.pool||Object.values(page.pool).some(v=>v===null)||
   q.pool.generated<q.pool.afterFilters||q.pool.afterFilters<q.pool.afterLimits||q.total!==q.pool.afterLimits||
   q.pool.droppedByFilters!==q.pool.generated-q.pool.afterFilters)){
   domainDiscoveryComplete=false;page.reason='reply-domain-page-metadata-unverified';node.reasons.push(page.reason);continue;
  }
  page.status='observed';page.reason=null;
  if(comparisonScope==='finite-common'&&q.complete===false){
   page.status='incomplete';page.reason='reply-domain-page-incomplete';domainDiscoveryComplete=false;node.reasons.push(page.reason);
  }
  if(plan.zoneActor&&q.candidates.some(c=>c?.legal!==false&&(!c.input||c.input.kind!=='playerAction'||c.input.action!=='blitz'||c.input.playerId!==plan.zoneActor||
   !plan.targets.includes(c.input.blitzTarget)||c.input.blockTarget!==c.input.blitzTarget||!Array.isArray(c.input.path)||!c.input.path.length))){
   page.status='unverified';page.reason='changed-zone-proposal-source-mismatch';domainDiscoveryComplete=false;node.reasons.push(page.reason);continue;
  }
  page.candidateCount=q.candidates.length;
  for(const [rank,c] of q.candidates.entries())if(c?.legal!==false&&c.input?.kind==='playerAction'){
   page.proposalCount++;
   const k=stableDataKey(c.input),priority=c.kind==='score'?0:['pickup','secure'].includes(c.kind)?1:c.input.action==='blitz'?2:3;
   if(!domain.has(k)){domain.set(k,{input:JSON.parse(k),priority,kind:c.kind,inputId:'d'+(domain.size+1),pageIds:[]});page.uniqueAdded++;}
   const row=domain.get(k);if(!row.pageIds.includes(page.pageId))row.pageIds.push(page.pageId);
   if(plan.zoneActor)row.zoneRank=Math.min(row.zoneRank??Infinity,rank);
   if(!page.unionInputIds.includes(row.inputId))page.unionInputIds.push(row.inputId);
  }
 }
 // One representative per actor/action/target/task category prevents eight
 // variants of the same scoring route from crowding out other reply families.
 // This prunes a finite diagnostic domain, never proves route equivalence.
 const ranked=[...domain.values()].sort((a,b)=>a.priority-b.priority||
  (a.input.path?.length||0)-(b.input.path?.length||0)||stableDataKey(a.input).localeCompare(stableDataKey(b.input)));
 const buckets=new Set(),representatives=[];
 for(const row of ranked){
  const i=row.input,bucket=stableDataKey([i.playerId,i.action,i.blockTarget??i.blitzTarget??null,i.handoffTarget??(i.passTarget?[i.passTarget.x,i.passTarget.y]:i.targetPlayerId??null),row.kind]);
  if(comparisonScope==='finite-common'&&buckets.has(bucket))continue;buckets.add(bucket);representatives.push(row);
 }
 const reservation=comparisonScope==='finite-common'?reserveChangedZoneReplies(ranked,representatives,8):{complete:true,rows:representatives.slice(0,8),omittedActors:[]};
 if(!reservation.complete)domainDiscoveryComplete=false;
 discovery.changedZoneReservation={complete:reservation.complete,omittedActors:reservation.omittedActors};
 const inputs=reservation.rows.map(x=>x.input);
 result.domainPruning={mode:'one-shortest-source-proposal-per-actor-action-target-task; reserve changed-zone moving actors',unrepresentedVariants:domain.size-representatives.length,
  cappedRepresentatives:Math.max(0,representatives.length-8),equivalenceClaimed:false};
 result.domain=inputs;result.domainId=JSON.stringify(inputs);result.omittedDomainInputs=Math.max(0,domain.size-inputs.length);
 const selectedInputs=new Map(inputs.map((input,i)=>[stableDataKey(input),i]));
 discovery.unionSources=[...domain.entries()].map(([key,row])=>({inputId:row.inputId,inputIdentity:key,domainIndex:selectedInputs.get(key)??null,
  playerId:row.input.playerId,action:row.input.action,task:row.kind??null,pathSteps:row.input.path?.length??0,
  blockTarget:row.input.blockTarget??row.input.blitzTarget??null,handoffTarget:row.input.handoffTarget??null,
  passTarget:row.input.passTarget??null,sourcePageIds:row.pageIds}));
 discovery.plannedPages=discovery.pages.length;discovery.observedPages=discovery.pages.filter(p=>p.status==='observed').length;
 discovery.complete=domainDiscoveryComplete;discovery.hasUnsearchedPages=discovery.pages.some(p=>p.hasMore===true);

 for(const input of inputs)for(const {w,node} of tasks){if(stoppedRPC||!node.outsidePoliciesUnverified||left()<100)continue;
  const r=await reply(node.at,input,true,w.services);if(r.valid){node.finiteReplies.push(r);node.domainChecked++;node.alternatives++;node.observedOwnTD=Math.max(node.observedOwnTD,r.witnessedTD.own);node.observedOpponentTD=Math.max(node.observedOpponentTD,r.witnessedTD.opponent);node.bounds=minimumUtilityBounds([node.bounds,r.bounds]);node.reasons.push(...r.reasons);}
  else if(r.illegal)node.domainChecked++;else {node.domainUnknown++;node.reasons.push(r.reason??'reply-policy-unavailable');}
 }
 if(contractBroken)return returned({...result,reason:'common-endpoint-horizon-contract-failed:'+contractBroken});
 for(const w of work){
  const globalRows=w.nodes.map(n=>({p:n.at.p,...n.bounds}));
  const finiteRows=w.nodes.map(n=>({p:n.at.p,...(n.finiteReplies.length?minimumUtilityBounds(n.finiteReplies.map(r=>r.bounds)): {lower:range.lower,upper:range.upper})}));
  const finiteUnknown=w.nodes.reduce((s,n)=>s+n.at.p*(n.finiteReplies.length?Math.max(...n.finiteReplies.map(r=>r.unknownChanceMass)):1),0);
  const comparable=w.nodes.every(n=>n.endChecked&&(!n.outsidePoliciesUnverified||n.finiteReplies.length&&n.domainChecked===inputs.length&&n.domainUnknown===0))&&
   (inputs.length>0||w.nodes.every(n=>!n.outsidePoliciesUnverified));
  const rows=comparisonScope==='finite-common'?finiteRows:globalRows;
  const policy=w.p.policy,actors=root.players.filter(p=>p.team===team&&p.location==='pitch'&&p.stance!=='stunned'&&!p.activated),
   carrier=root.ball?.kind==='held'?root.players.find(p=>p.id===root.ball.playerId):null;
  const risk=(carrier?.team===team?inspect.CFG.carrierTurnover:inspect.CFG.turnover)+Math.min(30,actors.length*2);
  const ownTO=w.p.endpoints.reduce((s,b)=>s+(b.ownTurnover||b.turnover?b.p:0),0),ownTD=w.p.endpoints.reduce((s,b)=>s+(b.touchdown===team?b.p:0),0);
  const cost=ownTO*risk+(ownTD?0:(policy.input.path?.length||0)*.6+
   (policy.input.path||[]).filter(s=>s.kind==='rush').length*inspect.CFG.optionalRush+policy.secondCost);
  if(!Number.isFinite(cost)||cost<0)return returned({...result,reason:'common-own-action-cost-unavailable'});
  const b=sum(rows);if(b.lower!==null)b.lower-=cost;if(b.upper!==null)b.upper-=cost;
  const gb=sum(globalRows);if(gb.lower!==null)gb.lower-=cost;if(gb.upper!==null)gb.upper-=cost;
  result.bounds.push(b);(result.globalBounds??=[]).push(gb);result.policies.push({input:w.p.tree.input,cost,finiteDomainComparable:comparable,finiteUnknownChanceMass:finiteUnknown,domainChecked:w.nodes.map(n=>({p:n.at.p,endChecked:n.endChecked,checked:n.domainChecked,unknown:n.domainUnknown})),knownEndMass:w.nodes.reduce((s,n)=>s+n.at.p*n.knownEnds,0),
   unknownChanceMass:w.nodes.reduce((s,n)=>s+n.at.p*n.unknownChanceMass,0),
   outsidePoliciesUnverified:w.nodes.some(n=>n.outsidePoliciesUnverified),
   observedOpponentTDLower:w.nodes.reduce((s,n)=>s+n.at.p*n.observedOpponentTD,0),
   observedOwnTDLower:w.nodes.reduce((s,n)=>s+n.at.p*n.observedOwnTD,0),
   alternatives:w.nodes.reduce((s,n)=>s+n.alternatives,0),reasons:[...new Set(w.nodes.flatMap(n=>n.reasons))],
   samples:w.nodes.slice(0,2).map(n=>({from:n.at.key,p:n.at.p,bounds:n.bounds,knownEnds:n.knownEnds,outsidePoliciesUnverified:n.outsidePoliciesUnverified})),omittedSamples:Math.max(0,w.nodes.length-2)});
 }
 result.domainDiscoveryComplete=domainDiscoveryComplete;result.finiteDomainComparable=domainDiscoveryComplete&&result.policies.every(p=>p.finiteDomainComparable);
 if(comparisonScope==='finite-common')result.scope='minimum over the same finite legal reply input union, first-TD or actual opponent-End; unknown chance retains utility bounds; global unsearched policies remain separately unverified in globalBounds; not full opponent-Turn safety';
 return returned({...result,valid:true,reason:'common-source-bound-endpoint-intervals',stoppedRPC,utilityRange:range});
 }finally{
  for(const w of work)w.phase?.finish({status:stoppedRPC?'stopped':frameOutcome?.valid?'frame-returned':'incomplete',reason:stoppedRPC?.code??frameOutcome?.reason??'reply-phase-exception',sharedFrameElapsedMs:Date.now()-frameStarted,
   endWitnessSources:w.nodes.map(n=>({from:n.at.key??null,p:n.at.p,endChecked:n.endChecked,domainChecked:n.domainChecked,domainUnknown:n.domainUnknown,reasons:n.reasons}))});
 }
}
