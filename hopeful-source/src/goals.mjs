import {planView,repairTasks} from './execution.mjs';
import {same} from './policy.mjs';
import {challengeContinuation} from './continuation.mjs';
import {available} from './availability.mjs';
const dist=(a,b)=>a&&b?Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y)):Infinity;
const skill=(p,s)=>(p.skills||[]).some(k=>k===s||k.startsWith(s+'('));
const unreliable=p=>['boneHead','reallyStupid','unchannelledFury','animalSavagery','takeRoot','bloodlust'].some(s=>skill(p,s));
const remaining=(o,p)=>Math.max(0,p.ma-(o.activation?.playerId===p.id?(o.activation.maUsed||0):p.stance==='prone'?3:0));
// A different unused actor can implicitly close the current activation. Native
// source validation/enumeration still accounts for that closure and its risks.
const eligible=(o,p)=>p.team===o.team&&available(o,p);
/** Roles allocate discovery only. Actual engine paths, probabilities, and the
 * unchanged common-horizon evaluator decide whether any role should act. */
export function goalDiscovery(o,drive,priorPlan=null,review=null){
 const available=o.players.filter(p=>eligible(o,p)),carrier=o.ball?.kind==='held'?o.players.find(p=>p.id===o.ball.playerId):null;
 const prior=planView(priorPlan),task=prior?.activeTask;
 const sameDrive=priorPlan?.scope?.team===o.team&&priorPlan.scope.half===o.half&&priorPlan.scope.drive===o.drive&&
  same(priorPlan.scope.turn,o.turn)&&priorPlan.scope.format===o.format;
 if(sameDrive&&review?.status==='invalidated'&&review.reason==='unretained-or-changed-public-outcome'&&
  task?.action==='move'&&task.destination&&o.activation?.playerId===task.actor&&!o.activation.over&&
  available.some(p=>p.id===task.actor&&!same(p.pos,task.destination))&&
  (task.purpose!=='recover-ball'||o.ball?.kind==='ground')&&
  (task.purpose!=='advance-or-protect-carrier'||carrier?.id===task.actor)){
  return {id:task.goal?.id||prior.id,kind:'repair-activation-route',actorIds:[task.actor],families:['move'],
   region:{within:[task.destination]},target:task.destination,repair:true,
   assumptions:'same activation, live goal still unfinished, new route must be freshly legal and fairly valued'};
 }
 const base={id:`goal:${o.team}:${o.half}:${o.drive}:${o.turn?.[o.team]}:${o.ball?.kind}:${carrier?.id||''}`,
  repair:false,assumptions:'current public possession and eligibility; roles only reserve discovery'};
 if(!available.length)return null;
 const reliability=(a,b)=>Number(unreliable(a))-Number(unreliable(b));
 const mobile=(a,b)=>reliability(a,b)||remaining(o,b)-remaining(o,a)||a.ag-b.ag||a.id.localeCompare(b.id);
 if(o.ball?.kind==='ground'&&!drive?.emergency){
  const players=available.filter(p=>!skill(p,'noBall')&&dist(p.pos,o.ball.pos)<=remaining(o,p)+2)
   .sort((a,b)=>reliability(a,b)||Number(skill(b,'sureHands'))-Number(skill(a,'sureHands'))||a.ag-b.ag||
    dist(a.pos,o.ball.pos)-dist(b.pos,o.ball.pos)||remaining(o,b)-remaining(o,a)||a.id.localeCompare(b.id));
  return players.length?{...base,kind:'recover-ball',actorIds:players.map(p=>p.id),
   families:['move','secure'],region:{within:[o.ball.pos]},target:o.ball.pos}:null;
 }
 if(carrier?.team===o.team&&drive?.driveUrgency==='convert now'&&available.some(p=>p.id===carrier.id))
  return {...base,kind:'score-current-window',actorIds:[carrier.id],families:['move','handoff','pass'],sort:'goalDistance',target:carrier.id};
 const anchor=carrier?.pos||o.ball?.pos;if(!anchor)return null;
 const defending=carrier?.team!==o.team,foe=o.team==='A'?'B':'A';
 const targetTeam=defending?foe:o.team,end=o.pitch?.endZone?.[targetTeam];
 if(!Number.isFinite(end))return null;
 const direction=Math.sign(end-anchor.x)||1,cells=[];
 for(const dx of [1,2])for(const dy of [-2,-1,0,1,2]){
  const at={x:anchor.x+direction*dx,y:anchor.y+dy};
  if(at.x>=0&&at.x<o.pitch.width&&at.y>=0&&at.y<o.pitch.height&&
   !o.players.some(p=>p.location==='pitch'&&same(p.pos,at)))cells.push(at);
 }
 const players=available.filter(p=>p.id!==carrier?.id&&cells.some(at=>dist(p.pos,at)<=remaining(o,p)))
  .sort((a,b)=>reliability(a,b)||Math.min(...cells.map(at=>dist(a.pos,at)))-Math.min(...cells.map(at=>dist(b.pos,at)))||mobile(a,b));
 return cells.length&&players.length?{...base,kind:defending?'deny-scoring-lane':'stabilize-possession',
  actorIds:players.map(p=>p.id),families:['move'],region:{within:cells},target:carrier?.id||anchor}:null;
}
/** Goal-aware discovery is optional work after the protected original tactics.
 * It cannot earn a role bonus or reuse a stale guard/probability. It repairs one
 * current activation goal, or proposes missed tasks against any normal selection. */
export async function challengeGoalTasks(o,snapshot,drive,priorPlan,review,services,inspect,deadline){
 const result={attempted:false,selected:null,reason:'no-unexamined-goal-task',discovery:null,queries:[],candidates:[]};
 if(snapshot?.mode!=='normal'||!snapshot.selected?.ex)return result;
 const goal=goalDiscovery(o,drive,priorPlan,review);
 if(!goal)return result;
 result.discovery=goal;
 const coverage={actorIds:[...goal.actorIds],attemptedActorIds:[],queriedActorIds:[],unexaminedActorIds:[...goal.actorIds],
  incompleteActorIds:[],actors:goal.actorIds.map(actorId=>({actorId,status:'unexamined',reason:null})),complete:false,stopReason:null,
  scope:'native candidate pages for this public goal; complete discovery does not mean complete opportunity comparison'};
 result.discoveryCoverage=coverage;
 if(deadline-Date.now()<3600){coverage.stopReason='goal-discovery-slot-budget-unavailable';
  for(const row of coverage.actors)row.reason=coverage.stopReason;
  return {...result,reason:coverage.stopReason};}
 const until=Math.min(deadline,Date.now()+9000),left=()=>until-Date.now();result.attempted=true;
 // These proposals add no dependencies. Input deduplication preserves the
 // already examined first action; future dependency variants need policyIdentity.
 const seen=new Set((snapshot.lines||[]).map(c=>JSON.stringify(c.input))),options=[];
 for(const row of coverage.actors){
  const actor=row.actorId;
  if(left()<2800){coverage.stopReason='goal-discovery-slot-budget-unavailable';break;}
  const query={from:'root',team:o.team,players:[actor],families:goal.families,...(goal.region?{region:goal.region}:{}),
   sort:goal.sort||'steps',maxRushes:0,precision:'none',limit:12,maxMs:Math.min(450,left()-2500)};
  result.queries.push(query);
  coverage.attemptedActorIds.push(actor);
  let r;try{r=await services.candidates(query);}catch(e){row.status='query-exception';row.reason=String(e).slice(0,160);continue;}
  if(r?.ok!==true||!Array.isArray(r.candidates)||r.position?.key!=='root'){
   const local=['coach-producer-budget','coach-resource-budget','coach-deadline'].includes(r?.code);
   row.status=local?'local-refusal':'query-unverified';row.code=r?.code??null;row.reason=r?.message??r?.code??'goal-discovery-source-unverified';
   if(local){coverage.stopReason=row.reason;break;}continue;
  }
  coverage.queriedActorIds.push(actor);
  const truncated=Array.isArray(r.truncated)?r.truncated.length>0:!!r.truncated;
  row.complete=(r.complete===true||r.hasMore===false)&&r.complete!==false&&r.hasMore!==true&&!truncated;
  row.status=row.complete?'queried-complete':'queried-incomplete';row.returnedCandidates=r.candidates.length;
  row.reason=row.complete?null:r.hasMore===true||r.complete===false||truncated?'candidate-page-incomplete':'candidate-completeness-unobserved';
  if(!row.complete)coverage.incompleteActorIds.push(actor);
  for(const raw of r?.candidates||[]){const c=inspect.canonical(raw,o);if(!c||seen.has(JSON.stringify(c.input)))continue;
   seen.add(JSON.stringify(c.input));options.push(c);}
 }
 coverage.unexaminedActorIds=goal.actorIds.filter(actor=>!coverage.queriedActorIds.includes(actor));
 for(const row of coverage.actors)if(row.status==='unexamined')row.reason=coverage.stopReason;
 coverage.complete=coverage.unexaminedActorIds.length===0&&coverage.incompleteActorIds.length===0;
 const rootValue=inspect.boardValue(o,o.team);
 options.sort((a,b)=>inspect.cheapScore(o,b,o.team,rootValue)-inspect.cheapScore(o,a,o.team,rootValue));
 // One best newly discovered task gets a full fair comparison; other possible
 // actors and goals remain explicitly unexamined, never zero opportunity cost.
 for(const c of options.slice(0,1)){
  if(left()<3000)break;
  let legal;try{legal=await services.validate(c.input,{from:'root',team:o.team});}
  catch(e){result.candidates.push({input:c.input,reason:'goal-root-validation-failed',error:String(e).slice(0,160)});continue;}
  if(legal?.ok!==true||legal.position!=='root'||legal.legal!==true){
   result.candidates.push({input:c.input,reason:legal?.ok!==true?'goal-root-legality-unverified':legal.position!=='root'?'goal-root-source-unverified':'goal-input-not-legal-at-root',
    validation:{ok:legal?.ok??null,legal:legal?.legal??null,position:legal?.position??null,code:legal?.code??null}});continue;
  }
  const compared=await challengeContinuation(o,snapshot,{input:c.input,validated:true},services,inspect,until);
  const taskGoal={id:goal.id,kind:goal.kind,target:goal.target};
  // Public task provenance reserves discovery even when the local comparison
  // did not select this proposal. It changes no source evidence or policy identity.
  (result.policyTrees??=[]).push(...(compared.policyTrees||[]).map(tree=>({...tree,goal:taskGoal})));
  result.candidates.push({input:c.input,reason:compared.reason,evidence:compared.evidence});
  if(compared.selected)return {...result,selected:{...compared.selected,goal:taskGoal},
   reason:goal.repair?'fresh-goal-repair-clears-common-margin':'goal-task-clears-current-selection-on-common-evidence',evidence:compared.evidence};
 }
 return {...result,reason:options.length?'goal-task-not-better-on-current-common-evidence':
  coverage.complete?'no-new-legal-goal-route':'goal-discovery-incomplete; no-new-goal-route-certified'};
}

/** Rebuild only a bounded set of surviving semantic obligations from the live
 * root. Every alternative is newly validated/explored by continuation policy
 * binding; the old graph contributes a target, never a certificate or value. */
export async function challengeRepairTasks(o,snapshot,priorPlan,review,identity,services,inspect,deadline){
 const templates=repairTasks(priorPlan,o,review,identity);
 const result={attempted:templates.length>0,selected:null,reason:'no-surviving-repair-task',templates,policyTrees:[],checks:[]};
 for(const task of templates.slice(0,2)){
  if(deadline-Date.now()<3000){result.checks.push({taskIndex:task.taskIndex,reason:'repair-slot-budget-unavailable'});continue;}
  let input=task.input,v=await services.validate(input,{});
  if(v?.ok!==true){result.checks.push({taskIndex:task.taskIndex,reason:'repair-legality-unverified'});continue;}
  if(!v.legal&&input.action==='move'&&task.destination){
   const q=await services.candidates({players:[input.playerId],families:['move'],region:{within:[task.destination]},precision:'none',sort:'steps',maxRushes:2,limit:12,maxMs:350});
   input=q?.candidates?.find(c=>c.legal!==false&&c.input?.playerId===input.playerId&&same(c.input.path?.at(-1)?.to,task.destination))?.input;
   if(input)v=await services.validate(input,{});
  }
  if(!input||v?.ok!==true||v.legal!==true){result.checks.push({taskIndex:task.taskIndex,reason:'repair-live-resources-or-route-invalid'});continue;}
  const r=await challengeContinuation(o,snapshot,{input,validated:true},services,inspect,deadline);
  const trees=[...(r.policyTrees||[]),...(r.selected?[r.selected]:[])];
  result.policyTrees.push(...trees.map(t=>({...t,goal:task.goal??t.goal,repairTask:task.taskIndex})));
  result.checks.push({taskIndex:task.taskIndex,input,reason:r.reason,ownTrees:trees.length});
 }
 return {...result,reason:result.policyTrees.length?'fresh-repair-proposals-require-common-comparison':templates.length?'surviving-tasks-not-yet-rebound':'no-surviving-repair-task'};
}
