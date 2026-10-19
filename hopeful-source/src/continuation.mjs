import {withExploreDeadline} from './bounded-reply.mjs';
import {completeAction,policyFrom,weightedPolicyValue,endorseContinuation,same} from './policy.mjs';
const n=(x,d=0)=>Number.isFinite(x)?x:d;
/** A guard-matched, freshly legal task must not disappear solely because it is
 * absent from the new cheap shortlist. Re-evaluate that one task and incumbent
 * to the same own-turn closure and bounded reply; no saved probability is used. */
export async function challengeContinuation(o,snapshot,pending,services,inspect,deadline,priorGate=null){
 const start=Date.now(),until=Math.min(deadline,start+12000),left=()=>until-Date.now(),opp=o.team==='A'?'B':'A';
 const result={attempted:false,selected:null,reason:'no-current-conditional-task',policies:[],
  policyScope:'fresh exact saved input versus fresh incumbent; each actual own policy then End Turn and bounded reply'};
 if(!pending?.validated||snapshot?.mode!=='normal'||!snapshot.selected?.ex||
  same(pending.input,snapshot.selected.input)||left()<3000)return result;
 // Existing current shortlist evidence remains authoritative when it already
 // contains this input. This rescue covers omission, not a second voting path.
 if(snapshot.lines?.some(c=>same(c.input,pending.input))&&!['unmatched-own-horizon','unmatched-reply-coverage'].includes(priorGate?.reason))
  return {...result,reason:'conditional-task-already-examined'};
 result.attempted=true;result.priorComparison=priorGate?.reason||'missing-from-shortlist';
 const ex=async(input,from='root')=>{
  if(typeof from!=='string'||!from||left()<200)return null;
  try{return await services.explore(input,{coachEnumerationDeadline:until,from,team:o.team,perspective:o.team,observations:true,decisions:'builtin',
   threshold:.00001,maxOutcomes:40,maxKeep:256,maxLeaves:3500,maxMs:Math.max(50,Math.min(900,left()-100))});}catch{return null;}
 };
 const work=[];
 const assess=async(first)=>{
  if(!completeAction(first.ex,o.team))return null;
  const policy=policyFrom(first,first.preparedBranches,o.team,inspect);
  if(!completeAction(policy.ex,o.team))return null;
  const line={...first,ex:policy.ex,executionEx:first.ex,baseValue:weightedPolicyValue(policy,o,inspect),unknown:policy.unknown,
   preparationGain:0,terminalScoreMass:inspect.observedTerminalScore(policy.ex,o.team,o),
   replyAttempted:true,reply:[],observedReplyMass:0,checkedReplyMass:0,boundedReplyMass:0,
   criticalReplyAdjustment:0,positionReplyAdjustment:0};
  const states=[];
  for(const b of policy.ex.outcomes){
   if(b.touchdown)continue;
   if(!b.key||!b.observation)return null;
   if(b.active===opp){states.push({...b});continue;}
   if(b.active!==o.team)return null;
   const closed=await ex({kind:'endTurn'},b.key);
   if(!completeAction(closed,o.team)||closed.outcomes.some(s=>!s.key||!s.observation||s.active!==opp))return null;
   for(const s of closed.outcomes)states.push({...s,p:b.p*s.p});
  }
  work.push({line,first,policy,states:states.sort((a,b)=>b.p-a.p),cursor:0});
  return line;
 };
 const fresh=await ex(pending.input);
 if(!completeAction(fresh,o.team))return {...result,reason:'current-task-exploration-incomplete'};
 result.policyTrees=[{...inspect.canonical({input:pending.input},o),input:pending.input,ex:fresh}];
 const incumbent=await assess(snapshot.selected);
 if(!incumbent)return {...result,reason:'incumbent-common-closure-incomplete'};
 const proposal=await assess({...inspect.canonical({input:pending.input},o),ex:fresh,
  label:'Continue the verified conditional task after current common-horizon comparison'});
 if(!proposal)return {...result,reason:'conditional-task-common-closure-incomplete'};
 // Interleave policy branches. Serially exhausting the incumbent first can
 // leave an otherwise decisive legal stop with zero measured reply coverage.
 // The same shared deadline, branch ordering and service caps apply to both.
 const scheduling=[];
 while(left()>=700&&work.some(w=>w.cursor<w.states.length)){
  for(const w of work){
   if(left()<700)break;if(w.cursor>=w.states.length)continue;
   const unstarted=work.filter(p=>p.cursor===0&&p.states.length).length;
   const replyDeadline=Math.min(until,Date.now()+Math.max(150,left()/Math.max(1,unstarted)));
   const replyLeft=()=>Math.max(0,Math.min(left(),replyDeadline-Date.now()));
   const at=w.states[w.cursor++],line=w.line;let failed=false;
   scheduling.push({policy:work.indexOf(w),mass:at.p,firstPolicyBudgetMs:Math.round(replyLeft())});
   const call=async(fn)=>{if(replyLeft()<150)return null;try{return await fn();}catch{failed=true;return null;}};
   const reply=await inspect.replyAssessment(at,withExploreDeadline(services,replyDeadline),call,()=>Math.max(50,Math.min(650,replyLeft()-100)),o.team,replyLeft,true);
   if(failed||!reply||reply.failed)continue;
   line.observedReplyMass+=at.p;
   if(!reply.unknown)line.checkedReplyMass+=at.p;
   if(reply.essentialComplete)line.boundedReplyMass+=at.p;
   line.criticalReplyAdjustment+=at.p*Math.min(0,n(reply.criticalAdjustment));
   line.positionReplyAdjustment+=at.p*Math.min(0,n(reply.positionAdjustment));
   line.reply.push({p:at.p,stage:'after examined follow-up',...reply});
  }
 }
 for(const {line,first,policy} of work){
  line.replyAdjustment=line.criticalReplyAdjustment+line.positionReplyAdjustment;
  result.policies.push({input:first.input,baseValue:line.baseValue,pTurnover:policy.ex.pTurnover,
   pTouchdown:policy.ex.pTouchdown,unknown:policy.unknown,transitions:policy.transitions,
   observedReplyMass:line.observedReplyMass,checkedReplyMass:line.checkedReplyMass,
   criticalReplyAdjustment:line.criticalReplyAdjustment,positionReplyAdjustment:line.positionReplyAdjustment,reply:line.reply});
 }
 result.budget={allocation:'round-robin-current-policy-branches',scheduled:scheduling,limitMs:until-start};
 const evidence=endorseContinuation(proposal,incumbent,inspect,'normal');
 const matched=incumbent.observedReplyMass>=.95&&proposal.observedReplyMass>=.95&&
  Math.abs(incumbent.observedReplyMass-proposal.observedReplyMass)<=1e-6;
 result.evidence={...evidence,matchedReplyMass:matched,elapsedMs:Date.now()-start};
 if(!matched||!evidence.eligible)return {...result,reason:'conditional-task-not-better-on-common-evidence'};
 return {...result,selected:{...proposal,ex:fresh},reason:'retained-task-clears-fresh-common-horizon-margin'};
}

/** Reaching an activation goal is not permission to spend remaining MA on a
 * new destination. If the actual final branch completed and the fresh chooser
 * proposes more movement by that same player, compare stopping on the same
 * closed-turn horizon. A proved gain is still required; no stickiness bonus. */
export async function challengeCompletedActivation(o,snapshot,completedTask,services,inspect,deadline){
 const result={attempted:false,selected:null,reason:'no-completed-activation-to-review'};
 const selected=snapshot?.selected,a=o.activation;
 if(snapshot?.mode!=='normal'||!completedTask||!a||a.over||a.playerId!==completedTask.actor||
  selected?.input?.kind!=='playerAction'||selected.input.action!=='move'||
  selected.input.playerId!==completedTask.actor||!selected.input.path?.length||
  deadline-Date.now()<3000)return result;
 const input={kind:'endActivation'};let legal;
 try{legal=await services.validate(input,{});}catch{return {...result,reason:'completed-activation-stop-validation-failed'};}
 if(legal?.ok!==true||legal.legal!==true)return {...result,reason:'completed-activation-stop-not-legal'};
 // EndActivation may already appear under a different first-action horizon.
 // Re-evaluate it here with the actual final selected policy on BOTH sides.
 const compared=await challengeContinuation(o,{...snapshot,lines:[]},{input,validated:true},services,inspect,deadline);
 return {...compared,trigger:{actor:completedTask.actor,completedDestination:completedTask.destination,
  proposedDestination:selected.input.path.at(-1).to},
  reason:compared.selected?'completed-activation-stop-clears-common-margin':compared.attempted?'continued-movement-not-beaten-on-common-evidence':compared.reason,
  selected:compared.selected?{...compared.selected,label:'Complete the activation goal; further movement loses the current common-horizon comparison'}:null};
}
