import {protectionReady} from './availability.mjs';
import {boundedReplyServices} from './bounded-reply.mjs';
import {periodEnd} from './period-boundary.mjs';
import {same,completeAction,policyFrom,weightedPolicyValue,policyIdentity} from './policy.mjs';
import {auditBuiltinRules} from './rules.mjs';
import {compareCarrierReplies} from './carrier-replies.mjs';
import {auditReplyServices} from './reply-audit.mjs';
const n=(x,d=0)=>Number.isFinite(x)?x:d;
const dist=(a,b)=>a&&b?Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y)):Infinity;
const held=o=>o.ball?.kind==='held'?o.players?.find(p=>p.id===o.ball.playerId):null;
const source=(ex,from,team)=>ex?.ok===true&&ex.position?.key===from&&ex.perspective===team&&ex.activeTeam===team&&
 ex.outcomeIdentity==='complete-state-v1'&&ex.decisionPolicy?.mode==='builtin'&&ex.decisionPolicy.own==='builtin'&&ex.decisionPolicy.opponent==='builtin';
const clean=input=>['endTurn','endActivation'].includes(input?.kind)||input?.kind==='playerAction'&&typeof input.playerId==='string'&&Array.isArray(input.path)&&
 ['move','block','blitz','handoff','pass','secure'].includes(input.action);
const certifiedEnds=new WeakMap();
const ownEvidence=(tree,depth=0)=>!tree?.input||depth>4?null:{input:tree.input,ex:tree.ex,ruleMap:tree.ruleMap,
 requireRuleMaps:tree.requireRuleMaps,dependencies:tree.preparedBranches instanceof Map?[...tree.preparedBranches].map(([key,d])=>
  [key,ownEvidence({...d?.plan,ex:d?.ex,ruleMap:d?.ruleMap,preparedBranches:d?.preparedBranches},depth+1)]):[]};

/** Request-local only. A copied/context-restored line has no certificate;
 * root, actual input graph, probabilities, observations and rule maps must
 * still match the source-bound evidence that produced these End endpoints. */
export function certifiedOwnEndPolicy(line,o,inspect){
 const cert=line&&certifiedEnds.get(line);
 if(!cert||cert.inspect!==inspect||cert.costs!==JSON.stringify(inspect.CFG)||
  cert.root!==JSON.stringify(o)||cert.graph!==JSON.stringify(ownEvidence(line))||
  cert.endpointEvidence!==JSON.stringify(cert.endpoints)||!Number.isFinite(cert.baseValue))return null;
 return cert;
}

/** Carry a private certificate across a metadata-only final selection. A
 * different input, outcome graph, rule map or dependency never inherits it. */
export function certifiedOwnEndSelection(tree,metadata,o,inspect){
 const selected={...tree,...metadata},cert=certifiedOwnEndPolicy(tree,o,inspect);
 if(cert&&JSON.stringify(ownEvidence(selected))===cert.graph)certifiedEnds.set(selected,cert);
 return selected;
}

/** A scope-closing root has no successor task to persist. Only its private,
 * source-bound certificate with zero own offers/dependencies can discharge
 * persistence; copied graphs, pending choices and ordinary actions cannot. */
export function certifiedScopeClosure(line,o,inspect){
 if(!['endTurn','endActivation'].includes(line?.input?.kind)||o.pending)return false;
 const cert=certifiedOwnEndPolicy(line,o,inspect);
 return !!cert&&line.requireRuleMaps===true&&line.ruleMap?.offers?.length===0&&
  (!line.preparedBranches||line.preparedBranches.size===0);
}

/** Root discovery only; candidates earn no value or rule certificate here. */
export async function discoverProtectionMove(o,services,inspect,deadline){
 const car=held(o),result={attempted:false,reason:'no-ready-protector',candidates:0,selected:null};
 if(car?.team!==o.team||o.pending||o.active!==o.team||deadline-Date.now()<350)return result;
 const guards=o.players.filter(p=>p.team===o.team&&p.id!==car.id&&protectionReady(o,p)&&dist(p.pos,car.pos)>1)
  .sort((a,b)=>dist(a.pos,car.pos)-dist(b.pos,car.pos)).slice(0,3);
 const cells=[];
 for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)if(dx||dy){const to={x:car.pos.x+dx,y:car.pos.y+dy};
  if(to.x>=0&&to.x<o.pitch.width&&to.y>=0&&to.y<o.pitch.height&&!o.players.some(p=>p.pos&&same(p.pos,to)))cells.push(to);
 }
 if(!guards.length||!cells.length)return result;
 result.attempted=true;
 let found;
 try{found=await services.candidates({from:'root',team:o.team,players:guards.map(p=>p.id),families:['move'],
  region:{within:cells},maxRushes:0,precision:'none',sort:'steps',limit:24,maxMs:250});}
 catch{return {...result,reason:'protector-discovery-service-failed'};}
 if(found?.ok!==true||found.position?.key!=='root'||!Array.isArray(found.candidates))
  return {...result,reason:'protector-discovery-source-unverified'};
 const rows=found.candidates.filter(c=>c?.legal!==false&&clean(c.input)&&c.input.action==='move'&&c.input.path.length&&
  guards.some(p=>p.id===c.input.playerId)&&cells.some(to=>same(to,c.input.path.at(-1).to)))
  .map(c=>inspect.canonical(c,o)).filter(Boolean);
 result.candidates=rows.length;
 const base=inspect.boardValue(o,o.team);
 rows.sort((a,b)=>inspect.cheapScore(o,b,o.team,base)-inspect.cheapScore(o,a,o.team,base)||a.input.path.length-b.input.path.length);
 return {...result,reason:rows.length?'public-protector-proposal':'no-public-protector-route',selected:rows[0]??null};
}

/** Actual conditional own dependencies, followed by one common End boundary.
 * The candidate remains unendorsed unless every priced participant has source
 * identity, complete probability mass and an executable builtin rule map. */
export async function buildProtectionPolicy(o,first,services,inspect,deadline,{extend=false,refineIncomplete=false}={}){
 const until=Math.min(deadline,Date.now()+4200),left=()=>until-Date.now(),team=o.team,opp=team==='A'?'B':'A';
 let calls=0,reason=null,rootEvidence=null,ruleAudit=null;const auditCache=new Map(),refinements=[];
 const call=async(fn)=>{if(left()<100){reason='own-policy-budget';return null;}calls++;try{const r=await fn();if(r?.ok===false)reason='own-policy-service:'+String(r.code||'failed');return r;}catch{reason='own-policy-service-exception';return null;}};
 const explore=(input,from)=>call(()=>services.explore(input,{from,team,perspective:team,observations:true,decisions:'builtin',
  coachEnumerationDeadline:until,maxOutcomes:128,maxKeep:256,maxLeaves:4000,threshold:1e-6,maxMs:Math.max(50,Math.min(1500,left()-80))}));
 const ruleMap=async(ob,input,from)=>{
  const key=JSON.stringify([from,input]);if(!auditCache.has(key))auditCache.set(key,await auditBuiltinRules(ob,input,services,until,{from}));return auditCache.get(key);
 };
 const discover=async(ob,from,rootActor,participants)=>{
  const car=held(ob);if(car?.team!==team)return null;
  const carrierNext=rootActor!==car.id&&!participants.has(car.id)&&protectionReady(ob,car);
  const guards=ob.players.filter(p=>p.team===team&&p.id!==car.id&&protectionReady(ob,p)&&!participants.has(p.id))
   .sort((a,b)=>dist(a.pos,car.pos)-dist(b.pos,car.pos));
  const actor=carrierNext?car:guards.find(p=>dist(p.pos,car.pos)>1);if(!actor)return null;
  const cells=[];if(!carrierNext)for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)if(dx||dy){
   const to={x:car.pos.x+dx,y:car.pos.y+dy};if(to.x>=0&&to.x<ob.pitch.width&&to.y>=0&&to.y<ob.pitch.height&&!ob.players.some(p=>p.pos&&same(p.pos,to)))cells.push(to);
  }
  const query={from,team,players:[actor.id],families:['move'],maxRushes:0,precision:'none',limit:24,
   ...(carrierNext?{sort:'goalDistance'}:{region:{within:cells},sort:'steps'}),maxMs:Math.max(50,Math.min(250,left()-80))};
  const found=await call(()=>services.candidates(query));
  if(found?.ok!==true||found.position?.key!==from||!Array.isArray(found.candidates)){reason='own-continuation-discovery-unverified';return null;}
  const rows=found.candidates.filter(c=>c?.legal!==false&&clean(c.input)&&c.input.action==='move'&&c.input.playerId===actor.id&&c.input.path.length&&
   (carrierNext||cells.some(to=>same(to,c.input.path.at(-1).to))))
   .map(c=>inspect.canonical(c,ob)).filter(Boolean);
  rows.sort((a,b)=>inspect.cheapScore(ob,b,team,inspect.boardValue(ob,team))-inspect.cheapScore(ob,a,team,inspect.boardValue(ob,team)));
  return rows[0]??null;
 };
 const bind=async(node,from,ob,depth,participants,rootActor)=>{
  if(depth>4||!clean(node.input)||left()<150)return null;
  const valid=await call(()=>services.validate(node.input,{from}));if(valid?.ok!==true||valid.legal!==true||valid.position!==from){reason='own-input-source-not-legal';return null;}
  let ex=source(node.executionEx??node.ex,from,team)?node.executionEx??node.ex:await explore(node.input,from);
  if(!source(ex,from,team)){reason=reason||'own-source-unverified';return null;}
  if(refineIncomplete&&!completeAction(ex,team)){
   const prior=node.preparedBranches instanceof Map?node.preparedBranches:new Map();
   const mass=e=>(e.outcomes||[]).reduce((v,b)=>v+n(b.p),0);
   const validPartial=Array.isArray(ex.outcomes)&&ex.outcomes.every(b=>b&&Number.isFinite(b.p)&&b.p>=0&&b.p<=1)&&
    mass(ex)<=1+1e-8&&[ex.unresolvedMass,ex.rest?.p].every(p=>p===undefined||Number.isFinite(p)&&p>=0&&p<=1);
   const row={from,input:node.input,before:{listed:mass(ex),rest:ex.rest?.p,unresolved:ex.unresolvedMass},attempted:false};refinements.push(row);
   if(prior.size)row.reason='retained-dependencies-require-original-successor-sources';
   else if(!validPartial)row.reason='malformed-source-mass-is-not-a-refinement-candidate';
   else if(left()<750)row.reason='same-source-refinement-budget-unavailable';
   else{
    row.attempted=true;const fresh=await explore(node.input,from);
    row.after=fresh?{listed:mass(fresh),rest:fresh.rest?.p,unresolved:fresh.unresolvedMass}:null;
    row.reason=source(fresh,from,team)&&completeAction(fresh,team)?'same-source-complete-evidence-replaces-coarse-cache':'same-source-refinement-not-complete';
    if(row.reason==='same-source-complete-evidence-replaces-coarse-cache')ex=fresh;
   }
  }
  if(depth===0)rootEvidence={...node,ex,executionEx:ex};
  if(!completeAction(ex,team)){reason='own-outcome-mass-incomplete';return null;}
  if(o.ruleset?.rulesEdition==='faq2026'&&(ex.exact!==true||ex.outcomes.some(b=>b.observation&&b.observation.rulesEdition!=='faq2026'))){reason=ex.exact!==true?'own-FAQ-native-chance-not-exact':'own-FAQ-successor-edition-unverified';return null;}
  const audit=await ruleMap(ob,node.input,from);
  if(!audit?.complete){reason='own-rule-map-incomplete';ruleAudit={reason:audit?.reason??'missing-rule-audit',unknown:audit?.unknown,terminalMass:audit?.terminalMass,calls:audit?.calls,rejections:audit?.rejections};return null;}
  const tree={...node,ex,executionEx:ex,ruleMap:{input:node.input,offers:audit.offers},requireRuleMaps:true,preparedBranches:new Map()};
  const prior=node.preparedBranches instanceof Map?node.preparedBranches:new Map();
  if([...prior.keys()].some(key=>!ex.outcomes.some(b=>b.key===key))){reason='own-dangling-dependency';return null;}
  const nextParticipants=new Set([...participants,node.input.playerId]);
  for(const b of ex.outcomes){
   const dependency=prior.get(b.key);
   if(b.turnover||periodEnd(b)||b.active!==team){if(dependency){reason='priced-dependency-after-own-terminal';return null;}continue;}
   if(!b.key||!b.observation){reason='own-success-key-missing';return null;}
   let child=dependency?{...dependency.plan,ex:dependency.ex,preparedBranches:dependency.preparedBranches,ruleMap:dependency.ruleMap}:null;
   if(!child&&extend&&depth<2&&left()>1100)child=await discover(b.observation,b.key,rootActor,nextParticipants);
   if(!child)continue; // This actual conditional policy stops after this leaf.
   const bound=await bind(child,b.key,b.observation,depth+1,nextParticipants,rootActor);
   if(!bound){if(dependency)return null;continue;} // A proposed extension earns no credit if unbound.
   tree.preparedBranches.set(b.key,{plan:{input:bound.input,label:bound.label,ruleMap:bound.ruleMap,goal:bound.goal??node.goal},ex:bound.ex,ruleMap:bound.ruleMap,preparedBranches:bound.preparedBranches});
  }
  return tree;
 };
 const bound=await bind(first,'root',o,0,new Set(),first.input?.playerId);
 if(!bound)return {complete:false,reason:reason||'own-policy-not-bound',calls,rootEvidence,ruleAudit,refinements};
 const policy=policyFrom(bound,bound.preparedBranches,team,inspect);
 if(!policy.complete||!policy.structuralComplete)return {complete:false,reason:'own-policy-fold-incomplete',calls};
 const endpoints=[];
 for(const b of policy.ex.outcomes){
  if(periodEnd(b)){endpoints.push({...b,ownTurnover:!!b.turnover,turnover:false});continue;}
  if(b.active===opp&&b.observation?.active===opp){endpoints.push({...b,ownTurnover:!!b.turnover,turnover:false});continue;}
  if(!b.key||!b.observation)return {complete:false,reason:'own-terminal-key-missing',calls};
  if(b.active!==team)return {complete:false,reason:'own-closure-active-team-unverified',calls};
  const close=await explore({kind:'endTurn'},b.key);
  if(!source(close,b.key,team)||!completeAction(close,team))return {complete:false,reason:'own-End-closure-incomplete',calls};
  if(o.ruleset?.rulesEdition==='faq2026'&&(close.exact!==true||close.outcomes.some(c=>c.observation&&c.observation.rulesEdition!=='faq2026')))return {complete:false,reason:'own-FAQ-End-native-evidence-unverified',calls};
  for(const c of close.outcomes){
   // The source-bound End response already supplies this terminal's real state
   // and probability. A successor key is needed for replies, not own value.
   if(!periodEnd(c)&&(!c.observation||c.active!==opp||c.observation.active!==opp))return {complete:false,reason:'own-End-not-opponent-boundary',calls};
   endpoints.push({...c,p:b.p*c.p,ownTurnover:!!(b.turnover||c.turnover),turnover:false});
  }
 }
 if(Math.abs(endpoints.reduce((sum,b)=>sum+b.p,0)-1)>1e-8)return {complete:false,reason:'own-closure-non-unit-mass',calls};
 const endpointEx={...policy.ex,outcomes:endpoints.map(b=>({...b,turnover:!!b.ownTurnover||!!b.turnover}))};
 const baseValue=weightedPolicyValue({...policy,ex:endpointEx},o,inspect);
 certifiedEnds.set(bound,Object.freeze({root:JSON.stringify(o),graph:JSON.stringify(ownEvidence(bound)),inspect,costs:JSON.stringify(inspect.CFG),
  endpoints,endpointEvidence:JSON.stringify(endpoints),baseValue}));
 return {complete:true,tree:bound,policy,endpoints,calls,refinements,ruleCalls:[...auditCache.values()].reduce((sum,a)=>sum+a.calls,0),baseValue};
}

export function strictJointWinner(bounds,margin=.5){
 if(!Array.isArray(bounds)||bounds.length<2||!Number.isFinite(margin)||margin<0||
  bounds.some(v=>!Number.isFinite(v.lower)||!Number.isFinite(v.upper)||v.lower>v.upper))return -1;
 return bounds.findIndex((v,i)=>v.lower>Math.max(...bounds.filter((_,j)=>j!==i).map(x=>x.upper))+margin);
}

export async function measureProtectionReplies(o,policy,services,inspect,deadline,{diagnostics=false}={}){
 const result={horizon:'actual-own-End/opponent-start/v1',complete:false,observedMass:0,checkedMass:0,
  unknownMass:1,criticalAdjustment:0,positionAdjustment:0,reasons:[]};
 const left=()=>deadline-Date.now();
 for(const b of policy.endpoints){
  if(periodEnd(b)){result.observedMass+=b.p;result.checkedMass+=b.p;continue;}
  if(!b.key||!b.observation){result.reasons.push('reply-source-unavailable');continue;}
  if(b.active===o.team||b.observation.active===o.team){result.reasons.push('reply-source-still-own-active');continue;}
  if(left()<900){result.reasons.push('reply-policy-slot-exhausted');continue;}
  const call=async fn=>{if(left()<150)return null;try{return await fn();}catch{return null;}};
  const bounded=boundedReplyServices(services,deadline),audit=diagnostics?auditReplyServices(bounded):null;let r;
  try{r=await inspect.replyAssessment(b,audit?.services??bounded,call,()=>Math.max(50,Math.min(500,left()-120)),o.team,left,true);}
  catch{result.reasons.push('reply-measurement-exception');continue;}
  if(audit)(result.endpointAudits??=[]).push({from:b.key,p:b.p,...audit.snapshot(r)});
  if(!r.failed)result.observedMass+=b.p;
  if(!r.failed&&!r.unknown&&r.essentialComplete)result.checkedMass+=b.p;
  result.criticalAdjustment+=b.p*Math.min(0,n(r.criticalAdjustment));
  result.positionAdjustment+=b.p*Math.min(0,n(r.positionAdjustment));
  if(r.failed)result.reasons.push('reply-service-failed');
  if(r.unknown||!r.essentialComplete)result.reasons.push('bounded-reply-coverage-incomplete');
 }
 result.unknownMass=Math.max(0,1-result.checkedMass);result.complete=result.unknownMass<=1e-8;
 result.reasons=[...new Set(result.reasons)];return result;
}

export async function challengeProtection(o,snapshot,native,services,inspect,deadline){
 const result={attempted:false,selected:null,reason:'outside-joint-protection-window',policies:[]};
 const car=held(o),current=snapshot?.selected;
 if(snapshot?.mode!=='normal'||car?.team!==o.team||o.pending||o.active!==o.team||
  n(o.turn?.[o.team])>=n(o.turnsPerHalf)||!current?.input||deadline-Date.now()<4300)return result;
 if(n(current.terminalScoreMass)>0||n(current.ex?.pTouchdown)>0)return {...result,reason:'current-own-score-protected'};
 const protectionStart=Date.now(),until=Math.min(deadline-400,protectionStart+10500),proposals=[];
 result.budget={globalRemainingMs:Math.max(0,deadline-protectionStart),protectionAllottedMs:Math.max(0,until-protectionStart),proposalMs:0,ownMs:0,replyMs:0,measurementMs:0,elapsedMs:0};
 const add=(input,line={})=>{if(clean(input)&&!same(input,current.input)&&!proposals.some(c=>same(c.input,input)))proposals.push({...line,input,label:line.label||'Joint carrier advance and actual protection'});};
 if(current.input.kind==='endTurn'){
  const guards=[...(snapshot.lines||[]),...(native||[])].filter(c=>c.input?.action==='move'&&c.input.playerId!==car.id&&
   protectionReady(o,o.players.find(p=>p.id===c.input.playerId))&&c.input.path?.length&&dist(c.input.path.at(-1).to,car.pos)<=2)
   .sort((a,b)=>n(b.value,n(b.baseValue,-Infinity))-n(a.value,n(a.baseValue,-Infinity)));
  if(guards.length)add(guards[0].input,guards[0]);
  else{const discovery=await discoverProtectionMove(o,services,inspect,until-2400);
   result.discovery={attempted:discovery.attempted,reason:discovery.reason,candidates:discovery.candidates};
   if(discovery.selected)add(discovery.selected.input,discovery.selected);
  }
  const rows=[...(snapshot.lines||[]),...(native||[])].filter(c=>c?.input?.action==='move'&&c.input.path?.length&&c.input.playerId===car.id)
   .sort((a,b)=>n(b.value,n(b.baseValue,-Infinity))-n(a.value,n(a.baseValue,-Infinity)));
  if(rows.length)add(rows[0].input,rows[0]);
  else try{const q=await services.candidates({from:'root',team:o.team,players:[car.id],families:['move'],maxRushes:0,precision:'none',sort:'goalDistance',limit:8,maxMs:250});
   if(q?.ok===true&&q.position?.key==='root')for(const c of (q.candidates||[]).slice(0,1))add(c.input,c);
  }catch{}
 }
 // Public prefixes retain the real movement declarations and risk. No fixture
 // IDs, donated protection positions, future dice, or coordinate recipes.
 if(current.input.playerId===car.id&&current.input.action==='move'&&current.input.path.length>2){
  add({...current.input,path:current.input.path.slice(0,-2)});
 }
 if(current.input.playerId===car.id&&current.input.action==='block'){
  const target=current.input.blockTarget;
  for(const c of [...(snapshot.lines||[]),...(native||[])])if(c.input?.action==='block'&&c.input.playerId!==car.id&&c.input.blockTarget===target)add(c.input);
  if(!proposals.length)try{
   const q=await services.candidates({from:'root',team:o.team,families:['block'],targets:[target],precision:'none',limit:12,maxMs:250});
   if(q?.ok===true&&q.position?.key==='root')for(const c of q.candidates||[])if(c.input?.playerId!==car.id)add(c.input);
  }catch{}
 }
 if(current.input.playerId!==car.id&&current.input.action==='move'){
  const actor=o.players.find(p=>p.id===current.input.playerId),cells=[];
  if(protectionReady(o,actor))for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)if(dx||dy){const p={x:car.pos.x+dx,y:car.pos.y+dy};
   if(p.x>=0&&p.x<o.pitch.width&&p.y>=0&&p.y<o.pitch.height&&!o.players.some(q=>q.pos&&same(q.pos,p)))cells.push(p);}
  if(cells.length)try{const q=await services.candidates({from:'root',team:o.team,players:[actor.id],families:['move'],region:{within:cells},maxRushes:0,precision:'none',sort:'steps',limit:8,maxMs:250});
   if(q?.ok===true&&q.position?.key==='root')for(const c of q.candidates||[])add(c.input);
  }catch{}
 }
 if(!proposals.length){result.budget.proposalMs=Date.now()-protectionStart;result.budget.elapsedMs=Date.now()-protectionStart;return {...result,reason:'no-public-joint-protection-proposal'};}
 // A discovered dependency is an alternative policy, not a mandatory suffix.
 // Keep the actual stop-at-End policy beside the extended policy so a greedy
 // continuation cannot silently replace a safe first input's evidence.
 result.budget.proposalMs=Date.now()-protectionStart;
 const ownStart=Date.now(),roots=proposals.slice(0,2);
 result.attempted=true;let choices=[{line:current,extend:true,variant:'current'},
  ...roots.map(line=>({line:{input:line.input,label:line.label,kind:line.kind,family:line.family,
   ex:line.ex,executionEx:line.executionEx},extend:false,variant:'stop-after-root'})),
  ...roots.filter(line=>line.preparedBranches?.size>0).map(line=>({line,extend:false,variant:'retained-dependencies'})),
  ...roots.map(line=>({line,extend:true,variant:'conditional-extension'}))],own=[];
 for(let i=0;i<choices.length;i++){
  const cap=Math.min(until-2400,Date.now()+Math.max(100,(until-Date.now()-2400)/(choices.length-i)));
  const policy=await buildProtectionPolicy(o,choices[i].line,services,inspect,cap,{extend:choices[i].extend});own.push(policy);
  if(policy.tree)policy.tree.policyVariant=choices[i].variant;
  result.policies.push({input:choices[i].line.input,variant:choices[i].variant,complete:policy.complete,reason:policy.reason,calls:policy.calls,ruleCalls:policy.ruleCalls,
   baseValue:policy.baseValue,pTurnover:policy.policy?.ex.pTurnover,dependencyDepth:policy.policy?.maxDepth});
 }
 // Identical actual strategies cannot block a strict winner by competing with
 // their own duplicate. Failed/incomparable strategies retain their refusal.
 const keys=new Map(),keep=[];result.duplicatePolicies=[];
 for(let i=0;i<own.length;i++){
  const key=own[i].complete?policyIdentity(own[i].tree):null;
  if(key!==null&&keys.has(key)){result.duplicatePolicies.push({input:choices[i].line.input,variant:choices[i].variant,
   retainedVariant:choices[keys.get(key)].variant,reason:'identical-source-bound-policy'});continue;}
  if(key!==null)keys.set(key,i);keep.push(i);
 }
 choices=keep.map(i=>choices[i]);own=keep.map(i=>own[i]);result.policies=keep.map(i=>result.policies[i]);
 result.budget.ownMs=Date.now()-ownStart;result.budget.elapsedMs=Date.now()-protectionStart;
 result.policyTrees=own.filter(p=>p.complete).map(p=>p.tree);
 if(own.some(p=>!p.complete))return {...result,reason:'joint-own-policy-or-rule-map-incomplete'};
 const replyStart=Date.now(),replies=await compareCarrierReplies(o,own.map((p,i)=>({input:choices[i].line.input,endpoints:p.endpoints})),services,inspect,until);
 result.budget.replyMs=Date.now()-replyStart;
 result.policyScope=replies.scope;result.replyDomain={reason:replies.reason,discoveryIncomplete:replies.discoveryIncomplete,count:replies.domain?.length,calls:replies.calls,issues:replies.discoveryIssues,contactPages:replies.contactPages,terminalKeys:replies.terminalKeys,terminalAggregate:replies.terminalAggregate,preparationWork:replies.preparationWork,budget:replies.budget};
 if(!Array.isArray(replies.policies)||replies.policies.length!==own.length)return {...result,reason:'joint-opponent-domain-unavailable'};
 result.policies=result.policies.map((p,i)=>({...p,finiteCarrierReply:{lossLower:replies.policies[i].lossLower,lossUpper:replies.policies[i].lossUpper,
  opponentTDLower:replies.policies[i].opponentTDLower,opponentTDUpper:replies.policies[i].opponentTDUpper,
  harmLower:replies.policies[i].harmLower,harmUpper:replies.policies[i].harmUpper,unknown:replies.policies[i].unknown}}));
 const domainIncomplete=replies.policies.some((p,i)=>!same(p.input,choices[i].line.input)||p.unknown>1e-8);
 if(domainIncomplete){
  result.budget.measurementSkipped='finite-carrier-domain-incomplete';result.budget.elapsedMs=Date.now()-protectionStart;
  result.replyMeasurements=[];return {...result,reason:'joint-opponent-domain-incomplete'};
 }
 const measurementStart=Date.now(),measured=[];
 for(let i=0;i<own.length;i++){
  const slot=Math.min(until,Date.now()+Math.max(0,(until-Date.now())/(own.length-i)));
  measured.push(await measureProtectionReplies(o,own[i],services,inspect,slot));
 }
 result.budget.measurementMs=Date.now()-measurementStart;result.budget.elapsedMs=Date.now()-protectionStart;
 result.replyMeasurements=measured;
 if(measured.some(r=>!r.complete))return {...result,reason:'joint-shared-boundary-replies-incomplete'};
 const valued=own.map((p,i)=>{const reply=replies.policies[i],measurement=measured[i];
  return {lower:p.baseValue-Math.max(n(reply.harmUpper,Infinity),-measurement.criticalAdjustment)+measurement.positionAdjustment,
   upper:p.baseValue-Math.max(n(reply.harmLower),-measurement.criticalAdjustment)+measurement.positionAdjustment,reply};});
 const margin=.5,best=strictJointWinner(valued,margin);
 result.policies=result.policies.map((p,i)=>({...p,valueLower:valued[i].lower,valueUpper:valued[i].upper,
  lossLower:valued[i].reply.lossLower,lossUpper:valued[i].reply.lossUpper,harmLower:valued[i].reply.harmLower,harmUpper:valued[i].reply.harmUpper,unknown:valued[i].reply.unknown}));
 result.evidence={scope:replies.scope,strictSameUnitMargin:margin,unknownOutsideDomain:true,selected:best>=0,replyDomain:result.replyDomain};
 if(best<0)return {...result,reason:'no-strict-common-joint-policy-winner'};
 if(best===0)return {...result,reason:'current-policy-is-strict-common-bound-winner'};
 const p=own[best],reply=valued[best].reply;
 return {...result,reason:'strict-source-bound-joint-protection-improvement',selected:{...p.tree,
  baseValue:p.baseValue,preparationGain:0,value:valued[best].lower,unknown:p.policy.unknown,
  terminalScoreMass:n(p.policy.ex.pTouchdown),replyAttempted:true,observedReplyMass:1,
  checkedReplyMass:reply.unknown?0:1,boundedReplyMass:reply.unknown?0:1,
  criticalReplyAdjustment:-Math.max(reply.harmUpper,-measured[best].criticalAdjustment),positionReplyAdjustment:measured[best].positionAdjustment,
  goal:{id:'joint-protection:'+o.team+':'+o.half+':'+o.drive,kind:'actual-carrier-and-protector-policy'}}};
}
