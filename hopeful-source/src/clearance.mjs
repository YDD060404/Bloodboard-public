import {sharedRuleChoice} from './rules.mjs';
import {same,policyFrom,weightedPolicyValue} from './policy.mjs';
import {scoringPolicyBounds} from './scoring.mjs';
const EPS=1e-8,clone=x=>JSON.parse(JSON.stringify(x)),other=t=>t==='A'?'B':'A';
const has=(p,s)=>p?.skills?.includes(s),on=p=>p?.location==='pitch'&&p.pos;
const available=(o,p)=>on(p)&&p.stance!=='stunned'&&(o.activation?.playerId===p.id&&!o.activation.over||!p.activated&&p.canBeActivated!==false);
const held=o=>o.ball?.kind==='held'?o.players?.find(p=>p.id===o.ball.playerId):null;
const pos=p=>p.x+','+p.y,ordinary=i=>i?.kind==='playerAction'&&i.action==='move'&&typeof i.playerId==='string'&&Array.isArray(i.path)&&i.path.length>0&&i.path.every(s=>s?.kind==='step'&&Number.isInteger(s.to?.x)&&Number.isInteger(s.to?.y))&&Object.keys(i).every(k=>['kind','action','playerId','path'].includes(k));
const moveKey=i=>JSON.stringify([i.kind,i.playerId,i.action,i.path.map(s=>[s.kind,s.to.x,s.to.y])]);
const moveOrder=(a,b)=>a.input.path.length-b.input.path.length||moveKey(a.input).localeCompare(moveKey(b.input));
const rushMax=p=>has(p,'sprint')?3:2;
function movementUpper(o,p){
 if(!p||!Number.isInteger(p.ma)||p.ma<0||!available(o,p)||p.rooted)return 0;
 const a=o.activation?.playerId===p.id?o.activation:null;
 if(a){if(a.action!=='move'||a.over||![a.maUsed,a.rushesUsed].every(x=>Number.isInteger(x)&&x>=0))return null;
  return Math.max(0,p.ma-a.maUsed)+Math.max(0,rushMax(p)-a.rushesUsed);}
 // Not subtracting stand-up cost is deliberately optimistic for impossibility.
 return p.ma+rushMax(p);
}
/** Geometry is only a finite-clock discovery hint. No probability or legality
 * is inferred from deleting an occupant in this temporary copy. */
export function shortestMoveDistance(o,carrier,ignoreId=null,replacement=null){
 const w=o.pitch?.width,h=o.pitch?.height,g=o.pitch?.endZone?.[o.team];
 if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w*h>600||!Number.isInteger(g)||!carrier?.pos)return null;
 const blocked=new Set(o.players.filter(p=>on(p)&&p.id!==carrier.id&&p.id!==ignoreId).map(p=>pos(p.pos)));
 if(replacement)blocked.add(pos(replacement));
 const q=[{...carrier.pos,d:0}],seen=new Set([pos(carrier.pos)]);
 for(let at=0;at<q.length;at++){const p=q[at];if(p.x===g)return p.d;
  for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){if(!dx&&!dy)continue;const n={x:p.x+dx,y:p.y+dy,d:p.d+1},k=pos(n);
   if(n.x<0||n.y<0||n.x>=w||n.y>=h||blocked.has(k)||seen.has(k))continue;seen.add(k);q.push(n);}}
 return Infinity;
}
export function createClearanceDiscovery(o,native=[]){
 const car=held(o),limit=car?movementUpper(o,car):null;
 const enabled=o.phase==='play'&&!o.pending&&o.active===o.team&&o.turn?.[o.team]===o.turnsPerHalf&&o.score?.[o.team]<=o.score?.[other(o.team)]&&car?.team===o.team&&car.stance==='standing'&&!car.rooted&&limit>0;
 const before=enabled?shortestMoveDistance(o,car):null;
 const gates=enabled&&before!==null&&before>limit?o.players.filter(p=>p.team===o.team&&p.id!==car.id&&available(o,p)&&p.stance==='standing'&&!p.rooted&&shortestMoveDistance(o,car,p.id)<=limit).map(p=>p.id).sort():[];
 const byActor=new Map(gates.map(id=>[id,new Map()]));let queries=0;
 const add=c=>{const i=c?.input,m=byActor.get(i?.playerId);if(!m||c.legal===false||!ordinary(i)||i.path.some(s=>s.kind==='rush'))return;
  const k=moveKey(i);if(m.has(k))return;m.set(k,clone(c));
  if(m.size>32){const last=[...m.entries()].sort((a,b)=>moveOrder(a[1],b[1])).at(-1);m.delete(last[0]);}};
 for(const c of native||[])add(c);
 return {enabled:enabled&&gates.length>0,observe(q,r){if(!gates.length||q?.from&&q.from!=='root'||q?.team&&q.team!==o.team||r?.ok!==true||r.position?.key!=='root'||!Array.isArray(r.candidates))return;queries++;for(const c of r.candidates)add(c);},
  proposals(inspect){const rows=[];for(const [id,items]of byActor){const viable=[...items.values()].filter(c=>shortestMoveDistance(o,car,id,c.input.path.at(-1).to)<=limit).sort(moveOrder);
   for(const c of viable.slice(0,2)){const x=inspect.canonical(c,o);if(x)rows.push({...x,clearance:{carrier:car.id,before,after:shortestMoveDistance(o,car,id,c.input.path.at(-1).to),movementUpper:limit}});}}
   return rows.slice(0,4);},report(){return {enabled:enabled&&gates.length>0,gates,rootShortest:before,carrierMovementUpper:limit,queries,retainedInputs:[...byActor.values()].reduce((n,m)=>n+m.size,0),scope:'deterministic shortest32 already-returned root ordinary-Move inputs per friendly gate; at most2 proposals per gate/4 total; geometry is discovery only'};}};
}
/** Action-scoped ordinary-Move eligibility filter, never a rule-policy certificate.
 * Hidden resources and effects can still intervene; only actual public-fork
 * paths following the shared live choice contribute verified policy mass. */
export function ordinaryMoveRuleScope(o){
 const t=o.teams?.[o.team];
 if(!t||o.rerolls?.[o.team]!==0||t.rerolls!==0||t.leaderReroll!==false||t.bonusRerolls!==0||t.mascotReroll!==false||t.apothecary!=='none')return {eligible:false,reason:'own-discretionary-resources-outside-Move-domain'};
 const safe=new Set(['block','wrestle','dodge','stunty','rightStuff','jumpUp','myBall','sidestep','noBall','catch','pass','sureFeet','sureHands','sprint','guard','standFirm','fend','tackle']);
 for(const team of ['A','B'])if(!Array.isArray(o.teams?.[team]?.specialRules)||o.teams[team].specialRules.length)return {eligible:false,reason:'special-team-rule-outside-Move-domain'};
 for(const p of o.players||[])if(on(p)&&(p.star||!Array.isArray(p.skills)||p.skills.some(s=>!safe.has(s)&&!(p.team!==o.team&&s==='safePairOfHands'))))return {eligible:false,reason:'unreviewed-Move-rule-mechanism'};
 return {eligible:true,certified:false,requires:'authoritative-fork-policy-evidence',policy:'ordinary-Move-free-skill/1',scope:'ordinary step/Rush Move inputs only; own free skill retries and no discretionary own resources; no Block/transfer/special policy certificate'};
}
/** No second ordinary Move by ANY player can score this held ball: its holder
 * cannot cover the optimistic distance even ignoring all occupants, while a
 * teammate Move neither transfers a held ball nor displaces its holder.
 * This says nothing about later actions, transfers, contacts or chain pushes. */
export function noSecondMoveScore(o,team){
 if(!o||o.phase!=='play'||o.pending||o.active!==team)return {certified:false,reason:'missing-live-own-state'};
 const car=held(o),goal=o.pitch?.endZone?.[team];
 if(!car||car.team!==team||!Number.isInteger(goal)||!Number.isInteger(car.pos?.x)||car.pos.x===goal)return {certified:false,reason:'held-ball-domain-not-proved'};
 const scope=ordinaryMoveRuleScope(o);if(!scope.eligible)return {certified:false,reason:scope.reason};
 if(o.players.some(p=>p.team===team&&p.id!==car.id&&on(p)&&p.stance==='standing'&&!p.distracted&&!has(p,'noBall')&&p.pos.x===goal))return {certified:false,reason:'endzone-receiver-may-score-from-failed-Move-ball'};
 const options=o.players.filter(p=>p.team===team&&available(o,p)).map(p=>({actor:p.id,holder:p.id===car.id,movementUpper:movementUpper(o,p)}));
 const upper=movementUpper(o,car),distance=Math.abs(goal-car.pos.x);
 if(upper===null||distance<=upper)return {certified:false,reason:'holder-second-Move-may-score',distance,movementUpper:upper};
 return {certified:true,reason:'every-second-ordinary-Move-cannot-score-held-ball',holder:car.id,distance,movementUpper:upper,
  eligibleOrdinaryMoveActors:options,eligibleActorCount:options.length,
  otherActors:'ordinary teammate movement does not transfer held ball; starting it ends prior actor activation',widerTurn:'unknown; contacts/transfers/additional inputs not closed'};
}
export function twoMoveIncumbentBounds(o,line,inspect){
 const whole=scoringPolicyBounds(line,o.team,inspect);
 if(!whole.valid||!ordinary(line?.input)||line.preparedBranches?.size||line.preparation||line.preparationPlans?.length||line.preparationGain>EPS||line.preparedScore>EPS||whole.maxDepth!==0)
  return {valid:false,reason:'incumbent-not-an-unbound-one-Move-policy',wholeTurn:whole};
 let lower=0,knownFailure=0;const closures=[];
 for(const b of line.ex.outcomes){
  if(b.touchdown===o.team)lower+=b.p;
  else if(b.touchdown||b.turnover||b.active===other(o.team))knownFailure+=b.p;
  else if(b.active===o.team&&typeof b.key==='string'&&b.key&&b.observation){const proof=noSecondMoveScore(b.observation,o.team);closures.push({key:b.key,mass:b.p,...proof});if(proof.certified)knownFailure+=b.p;}
 }
 return {valid:true,lower,upper:Math.max(lower,Math.min(1,1-knownFailure)),closures,wholeTurn:whole,
  scope:'shared at-most-two ordinary-Move inputs; every unclosed/omitted mass is upper-bound success; wider Turn remains unknown'};
}
/** Public forks certify only actually traversed policy paths. No hidden
 * effect is inferred absent from the observation. Unknown offers, caps and
 * pruned Turnover branches retain their entire unverified mass. */
export async function auditOrdinaryMoves(o,input,services,deadline,{from='root',followInput=null,maxCalls=256,maxDepth=48}={}){
 const result={attempted:false,tdLower:0,terminalMass:0,unknown:1,calls:0,closeCalls:0,unsupported:[],decisions:[]};
 if(!ordinary(input)||followInput&&!ordinary(followInput)||!services.fork?.open||!services.fork?.step||!services.fork?.close)return result;
 result.attempted=true;const open=new Set();
 const track=n=>{if(typeof n?.fork==='string')open.add(n.fork);return n;};
 const invoke=async(method,args)=>{if(deadline-Date.now()<70||result.calls>=maxCalls)return null;result.calls++;try{return track(await services.fork[method](args));}catch{return null;}};
 const close=async key=>{if(!open.delete(key))return;result.closeCalls++;try{await services.fork.close({fork:key});}catch{}};
 const walk=async(node,mass,depth,stage)=>{
  if(!node?.ok||node.revisionBound!==true||typeof node.fork!=='string'||!node.fork||!Number.isFinite(mass)||mass<=0)return;
  try{
   if(node.node==='terminal'){
    if(typeof node.position!=='string'||!node.position||typeof node.turnover!=='boolean'||typeof node.completed!=='boolean'||node.touchdown!==null&&node.touchdown!==undefined&&!['A','B'].includes(node.touchdown))return;
    if(node.touchdown===o.team){result.tdLower+=mass;result.terminalMass+=mass;return;}
    if(node.touchdown||node.turnover){result.terminalMass+=mass;return;}
    if(stage===0&&followInput&&node.completed){const next=await invoke('open',{input:followInput,from:node.position,controlTeam:o.team,controlAll:true});if(next?.from===node.position)await walk(next,mass,depth+1,1);return;}
    result.terminalMass+=mass;return;
   }
   if(depth>=maxDepth||deadline-Date.now()<70||result.calls>=maxCalls)return;
   if(node.events?.some(e=>e.type==='turnover'))return;
   if(node.node==='decision'){
    const choice=sharedRuleChoice(node,o.team),branches=node.branches;
    const i=choice&&Array.isArray(branches)?branches.findIndex(b=>b.id===choice.optionId):-1;
    if(i<0||branches[node.defaultBranch]?.id!==choice.optionId){result.unsupported.push({mass,type:node.type,team:node.decisionOf});return;}
    result.decisions.push({type:node.type,team:node.decisionOf,option:choice.optionId,mass});
    await walk(await invoke('step',{fork:node.fork,branch:i}),mass,depth+1,stage);return;
   }
   if(node.node!=='chance'||!Array.isArray(node.branches)||!Number.isFinite(node.unresolvedMass)||node.unresolvedMass<0||node.unresolvedMass>1)return;
   const total=node.branches.reduce((n,b)=>n+(Number.isFinite(b.p)&&b.p>=0&&b.p<=1?b.p:NaN),0);
   if(!Number.isFinite(total)||total>1+EPS||Math.abs(total+node.unresolvedMass-1)>EPS)return;
   // Success-looking labels only order work; probabilities and terminal facts
   // remain authoritative. Any branch not visited is still unknown.
   const order=node.branches.map((b,i)=>({b,i})).sort((a,b)=>Number(/"o":"S"/.test(b.b.label||''))-Number(/"o":"S"/.test(a.b.label||''))||b.b.p-a.b.p);
   for(const {b,i}of order){if(b.p<=0)continue;if(deadline-Date.now()<70||result.calls>=maxCalls)break;
    await walk(await invoke('step',{fork:node.fork,branch:i,copy:true}),mass*b.p,depth+1,stage);}
  }finally{await close(node.fork);}
 };
 try{const first=await invoke('open',{input,from,controlTeam:o.team,controlAll:true});if(first?.from===from)await walk(first,1,0,0);}finally{for(const key of [...open])await close(key);}
 if(result.terminalMass>1+EPS||result.tdLower>result.terminalMass+EPS)return {...result,tdLower:0,terminalMass:0,unknown:1,reason:'invalid-fork-mass'};
 result.unknown=Math.max(0,1-result.terminalMass);return result;
}
export async function challengeFinalClearance(o,snapshot,discovery,services,inspect,deadline){
 const ruleScope=ordinaryMoveRuleScope(o),result={attempted:false,selected:null,reason:'outside-bounded-clearance-domain',ruleScope,discovery:discovery?.report(),policies:[]};
 if(!discovery?.enabled||snapshot?.mode!=='normal'||!ruleScope.eligible||deadline-Date.now()<3500)return result;
 if((snapshot.lines||[]).some(c=>(c.ex?.pTouchdown||0)>EPS||(c.preparedScore||0)>EPS))return {...result,reason:'existing-known-TD-outlet-protected'};
 const current=twoMoveIncumbentBounds(o,snapshot.selected,inspect);result.current=current;
 if(!current.valid||current.upper>=1-EPS)return {...result,reason:'incumbent-two-Move-upper-not-closed'};
 const incumbentPolicy=await auditOrdinaryMoves(o,snapshot.selected.input,services,Math.min(deadline-2300,Date.now()+2000));
 current.builtinTwoMoveUpper=current.upper;current.policyAudit=incumbentPolicy;current.upper=Math.min(1,current.upper+incumbentPolicy.unknown);
 if(current.upper>=1-EPS)return {...result,reason:'incumbent-rule-policy-unverified'};
 const proposals=discovery.proposals(inspect).filter(c=>!same(c.input,snapshot.selected.input));
 if(!proposals.length)return {...result,reason:'no-existing-legal-clearance-route'};
 result.attempted=true;const until=Math.min(deadline,Date.now()+12000);
 for(let ci=0;ci<proposals.length;ci++){
  const c=proposals[ci],stop=Math.min(until,Date.now()+(until-Date.now())/(proposals.length-ci)),left=()=>stop-Date.now();if(left()<2400)break;
  const record={input:c.input,clearance:c.clearance,followups:[]};result.policies.push(record);
  const call=async f=>{if(left()<100)return null;try{return await f();}catch{return null;}};
  const legal=await call(()=>services.validate(c.input,{}));if(legal?.ok!==true||legal.legal!==true){record.reason='helper-not-legal';continue;}
  const explore=(input,from)=>call(()=>services.explore(input,{coachEnumerationDeadline:stop,...(from?{from}:{}),observations:true,decisions:'builtin',perspective:o.team,maxOutcomes:40,maxLeaves:3500,threshold:.0001,maxMs:Math.max(50,Math.min(1500,left()-100))}));
  const ex=await explore(c.input),line={...c,ex,preparedBranches:new Map()};
  if(!scoringPolicyBounds(line,o.team,inspect).valid){record.reason='helper-evidence-invalid';continue;}
  for(const b of ex.outcomes.filter(b=>!b.touchdown&&!b.turnover&&b.active===o.team&&b.key&&b.observation?.ball?.playerId===c.clearance.carrier).sort((a,b)=>b.p-a.p)){
   if(left()<1000)break;const scope=ordinaryMoveRuleScope(b.observation);if(!scope.eligible)continue;
   const q=await call(()=>services.threats.scoring({from:b.key,team:o.team,players:[c.clearance.carrier],maxMs:Math.max(100,Math.min(700,left()-650))}));
   if(q?.ok!==true||!Array.isArray(q.threats)||q.threats.some(x=>!ordinary(x?.input)||x.input.playerId!==c.clearance.carrier||!Number.isFinite(x.pTouchdown)||x.pTouchdown<0||x.pTouchdown>1))continue;
   const route=q.threats.slice().sort((a,b)=>b.pTouchdown-a.pTouchdown)[0];if(!route)continue;
   const valid=await call(()=>services.validate(route.input,{from:b.key,team:o.team}));if(valid?.ok!==true||valid.legal!==true)continue;
   const follow=await explore(route.input,b.key);line.preparedBranches.set(b.key,{plan:{input:route.input,label:'carrier scores through the real vacated route'},ex:follow});
   if(!scoringPolicyBounds(line,o.team,inspect).valid){line.preparedBranches.delete(b.key);continue;}
   record.followups.push({from:b.key,mass:b.p,input:route.input});
  }
  const bounds=scoringPolicyBounds(line,o.team,inspect);record.bounds=bounds;
  if(!bounds.valid||!line.preparedBranches.size){record.reason='no-certified-conditional-scoring-policy';continue;}
  const followInputs=[...line.preparedBranches.values()].map(f=>f.plan.input);
  if(followInputs.some(i=>!same(i,followInputs[0]))){record.reason='nonuniform-followup-not-certified';continue;}
  const certified=await auditOrdinaryMoves(o,c.input,services,Math.min(stop,Date.now()+2200),{followInput:followInputs[0]});
  const uncovered=ex.rest.p+ex.outcomes.filter(b=>!b.turnover&&!b.touchdown&&!line.preparedBranches.has(b.key)).reduce((n,b)=>n+b.p,0);
  const executableLower=Math.max(0,certified.tdLower-uncovered);record.policyAudit=certified;record.uncoveredFirstMass=uncovered;record.executableLower=executableLower;
  const improvement=executableLower-current.upper;record.lowerAboveCurrentUpper=improvement;
  if(improvement<=EPS){record.reason='bounded-two-Move-score-not-better';continue;}
  const policy=policyFrom(line,line.preparedBranches,o.team,inspect);
  line.baseValue=weightedPolicyValue(policy,o,inspect);line.preparationGain=0;line.preparedScore=executableLower;line.unknown=bounds.unknown;
  line.label='clear a real scoring gate before the final carrier Move';line.goal={id:`clearance:${o.team}:${o.half}:${o.drive}:${o.turn[o.team]}`,kind:'two-Move-scoring-opportunity',target:c.clearance.carrier};
  return {...result,selected:line,reason:'strict-bounded-two-Move-TD-improvement',evidence:{current,alternative:{...bounds,executableLower,policyAudit:certified,uncoveredFirstMass:uncovered},lowerAboveCurrentUpper:improvement,
   scope:'at most two ordinary-Move inputs, not full-Turn/match dominance; all known dependencies retained',ordinaryValueNotUsed:true,wholeTurnUnknownPreserved:true,ruleScope}};
 }
 return {...result,reason:'no-certified-bounded-clearance-improvement'};
}
