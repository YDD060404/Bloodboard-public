import {boundedReplyServices} from './bounded-reply.mjs';
import {periodEnd} from './period-boundary.mjs';
import {same,policyFrom,weightedPolicyValue,completeAction,policyIdentity} from './policy.mjs';
import {certifiedOwnEndPolicy} from './protection.mjs';
import {withServiceOwner,recordServiceObservation} from './services.mjs';
const n=(x,d=0)=>Number.isFinite(x)?x:d;
const sorted=x=>Array.isArray(x)?x.map(sorted):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sorted(x[k])])):x;
const inputKey=x=>JSON.stringify(sorted(x));

/** Preserve actual priced dependencies. This pool is diagnostic: a learned
 * first-input preference does not certify a complete multi-player policy. */
export function commonPool(o,snapshot,selected,limit=8,extras=[],{ledger=null,run='common',extraOrigins=[]}={}){
 const audit=ledger?.pool(run,limit),lines=snapshot?.lines||[];
 const origins=[...lines.map((line,index)=>ledger?.occurrence(line,{source:'champion',role:'observed-line',index})),
  ...extras.map((line,index)=>extraOrigins[index]??ledger?.occurrence(line,{source:'extra',role:'unattributed-output',index}))];
 const all=[...lines,...extras],eligible=all.flatMap((c,index)=>{
  audit?.filter(origins[index],!c?.input?'missing-input':!c.ex?.ok?'explore-not-ok':'eligible');return c?.input&&c.ex?.ok?[{line:c,origin:origins[index]}]:[];
 }),rows=eligible.map(r=>r.line),pool=[];
 const add=(line,source,seenOrigins=[])=>{
  const visit=(status,detail)=>{for(const origin of new Map(seenOrigins.filter(Boolean).map(r=>[r.occurrenceId,r])).values())audit?.visit(origin,source,status,detail);};
  if(!line?.input){visit('missing-input');return;}
  if(pool.length>=limit){visit('slot-limit');return;}
  const identity=policyIdentity(line);
  const duplicate=identity===null?null:pool.find(c=>policyIdentity(c.line)===identity);
  if(duplicate){visit('duplicate',{duplicateOf:ledger?.candidate(duplicate.line)?.candidateId??null});return;}
  const c=ledger?.candidate(line);visit('admitted',{poolIndex:pool.length});
  pool.push({line,source,...(c?{candidateId:c.candidateId,inputId:c.inputId}: {})});return true;
 };
 const holder=o.ball?.kind==='held'?o.players.find(p=>p.id===o.ball.playerId):null;
 add(snapshot?.selected,'champion',[ledger?.occurrence(snapshot?.selected,{source:'champion',role:'selected'})]);
 add(selected,'final-selected-policy',[ledger?.occurrence(selected,{source:'selection',role:'current-policy'})]);
 // The caller reserves the first extra for the early learned proposal when
 // present. Later producer output cannot fill every slot ahead of it.
 add(extras[0],'source-bound-primary-proposal',[origins[lines.length]]);
 const end=eligible.find(r=>r.line.input.kind==='endTurn');
 add(end?.line,'end-turn',[end?.origin]);
 const stableGoalId=holder?.team===o.team&&typeof holder.id==='string'&&holder.id?
  `goal:${o.team}:${o.half}:${o.drive}:${o.turn?.[o.team]}:${o.ball?.kind}:${holder.id}`:null;
 const stabilizePossession=c=>stableGoalId!==null&&c?.goal?.kind==='stabilize-possession'&&
  c.goal.id===stableGoalId&&c.goal.target===holder.id;
 for(const [source,filter] of [
  ['observed-score',c=>n(c.ex.pTouchdown)>0||n(c.preparedScore)>0],
  ['ball-change',c=>['pickup','secure','pass','handoff'].includes(c.kind)||['secure','pass','handoff'].includes(c.family)||c.targetId===holder?.id&&holder?.team!==o.team],
  ['prevent-score',c=>c.goal?.kind==='deny-scoring-lane'||c.goal?.kind==='receiver-defense'],
  ['priced-dependency',c=>c.preparedBranches?.size>0],
  ['carrier-advance',c=>c.input.playerId===holder?.id&&c.family==='move'&&c.input.path?.length>0],
  ['stabilize-possession',stabilizePossession],
  ['ordinary',()=>true]
 ])for(const {line,origin} of eligible.filter(r=>filter(r.line)).sort((a,b)=>n(b.line.baseValue,-Infinity)-n(a.line.baseValue,-Infinity))){
  if(add(line,source,[origin])&&source!=='ordinary')break;
 }
 for(const [index,line] of extras.entries())add(line,'source-bound-joint-policy',[origins[lines.length+index]]);
 pool.omitted=rows.filter(c=>!pool.some(r=>policyIdentity(r.line)===policyIdentity(c))).map(c=>({input:c.input,policyVariant:c.policyVariant??'retained',reason:'common-pool-slot-limit'}));
 audit?.finish(pool.map(c=>c.candidateId));
 if(audit)pool.poolRunId=audit.poolRunId;
 return pool;
}

/** Both identities reach the same actual own-End boundary before the same
 * bounded reply procedure. Missing keys, mass or budget remain visible. This
 * returns a shadow ordering, never an executable selection or safe-value claim. */
export async function auditCommonBoundary(o,snapshot,selected,services,inspect,deadline,extras=[],diagnostics={}){
 const start=Date.now(),end=Math.min(deadline,start+30000),pool=commonPool(o,snapshot,selected,8,extras,{...diagnostics,run:'shadow'});
 const report={mode:'shadow',override:false,action_executed:false,horizon:'actual-own-End/opponent-start/v1',
  policy_limit:8,reply_branch_limit:2,closure_branch_limit:16,reply_leaf_limit:64,candidateInputs:pool.map(c=>c.line.input),
  pool:[],ranked:[],reason:null,...(pool.poolRunId?{poolRunId:pool.poolRunId}:{}),scope:'fixed old endpoint units and equal per-policy bounded replies; not complete opponent-Turn EV or trained policy selection'};
 if(snapshot?.mode!=='normal')return {...report,reason:'SPECIAL_CHAMPION_MODE_PRESERVED',elapsed_ms:Date.now()-start};
 const slotMs=Math.min(3200,Math.max(0,Math.floor((end-start-300)/Math.max(1,pool.length))));
 report.per_policy_budget_ms=slotMs;
 if(slotMs<500)return {...report,reason:'COMMON_COMPARISON_BUDGET_UNAVAILABLE',elapsed_ms:Date.now()-start};
 const phaseScope=(phase,details)=>{
  const record=diagnostics.ledger?.phase({poolRunId:pool.poolRunId??null,phase,...details});
  const owned=record?withServiceOwner(services,record.owner):services;
  const serviceCostsObserved=record?recordServiceObservation(owned,{method:'phase',status:'phase-enter'}):false;
  return {services:owned,finish:details=>record?.finish({...details,serviceCostsObserved})};
 };
 for(const {line,source,candidateId,inputId} of pool){
  const localStart=Date.now(),localEnd=Math.min(end,localStart+slotMs),left=()=>localEnd-Date.now();
  const row={candidateId:candidateId??'shadow/'+String(o.requestId??'unavailable')+'/'+report.pool.length,...(inputId?{inputId}:{}),input:line.input,source,policy_variant:line.policyVariant??'retained',label:line.label??line.input.kind,rejections:[],closed_own_mass:0,
   own_unknown:1,observed_reply_mass:0,checked_reply_mass:0,terminal_mass:0,
   critical_reply:0,position_reply:0,reply_unknown:1,reply:[],comparison_ready:false,execution_end_appended:false};
  report.pool.push(row);
  const ownPhase=phaseScope('shadow-own',{candidateId:row.candidateId,allocatedSlotMs:Math.max(0,localEnd-localStart),localDeadline:localEnd,startedAt:localStart});
  let ownStatus='failed',ownReason='phase-interrupted',policy,certificate,outcomes;
  try{
  if(left()<500){row.rejections.push('POLICY_SLOT_BUDGET_UNAVAILABLE');ownStatus='skipped';ownReason='POLICY_SLOT_BUDGET_UNAVAILABLE';continue;}
  policy=policyFrom(line,line.preparedBranches,o.team,inspect);
  row.observed_own_touchdown=n(policy.ex.pTouchdown);row.observed_own_turnover=n(policy.ex.pTurnover);
  if(policy.issues.length){row.rejections.push(...policy.issues.map(x=>'OWN_DEPENDENCY:'+x.reason));ownStatus='rejected';ownReason=row.rejections[0];continue;}
  certificate=certifiedOwnEndPolicy(line,o,inspect);
  row.certified_own_end_reused=!!certificate;
  outcomes=certificate?certificate.endpoints.map(b=>({...b,turnover:!!b.ownTurnover||!!b.turnover})):[];
  let attempts=0,closureUnknown=0;
  for(const branch of certificate?[]:policy.ex.outcomes){
   if(!(branch.p>0))continue;
   const active=branch.active??branch.observation?.active;
   // A turnover flag does not prove the active side has already advanced.
   // Some engine failure endpoints still require their actual End transition.
   const absorbing=periodEnd(branch)||active!==undefined&&active!==o.team;
   if(absorbing){outcomes.push(branch);continue;}
   if(!branch.observation){row.rejections.push('OWN_END_SOURCE_OBSERVATION_MISSING');continue;}
   if(active===undefined){row.rejections.push('OWN_END_SOURCE_ACTIVE_MISSING');continue;}
   if(!branch.key){row.rejections.push('OWN_END_SOURCE_KEY_MISSING');continue;}
   if(attempts>=16){row.rejections.push('OWN_END_BRANCH_LIMIT');continue;}
   if(left()<250){row.rejections.push('OWN_END_SLOT_EXHAUSTED');continue;}
   attempts++;
   let closure;
   try{closure=await ownPhase.services.explore({kind:'endTurn'},{from:branch.key,observations:true,
    perspective:o.team,decisions:'builtin',maxOutcomes:16,maxKeep:16,maxLeaves:400,threshold:.000001,
    maxMs:Math.min(650,Math.max(50,left()-120))});}
   catch{row.rejections.push('OWN_END_SERVICE_EXCEPTION');continue;}
   if(!closure?.ok){row.rejections.push('OWN_END_SERVICE:'+String(closure?.code||'NO_RESPONSE'));continue;}
   if(!completeAction(closure,o.team))row.rejections.push('OWN_END_OUTCOME_MASS_INCOMPLETE');
   closureUnknown+=branch.p*Math.max(n(closure.unresolvedMass),n(closure.rest?.p),
    1-(closure.outcomes||[]).filter(b=>b.observation).reduce((sum,b)=>sum+n(b.p),0),0);
   for(const next of closure.outcomes||[]){
    if(!next.observation||!(next.p>0))continue;
    if(next.active===o.team&&!periodEnd(next)){
     row.rejections.push('OWN_END_DID_NOT_REACH_SHARED_BOUNDARY');continue;
    }
    outcomes.push({...next,p:branch.p*next.p,turnover:!!branch.turnover||!!next.turnover});
   }
  }
  const known=outcomes.filter(b=>b.observation).reduce((sum,b)=>sum+n(b.p),0);
  row.closed_own_mass=known;row.own_unknown=Math.min(1,Math.max(policy.unknown+closureUnknown,1-known,0));
  if(known>1+1e-8){row.rejections.push('OWN_END_NON_UNIT_MASS');ownStatus='rejected';ownReason='OWN_END_NON_UNIT_MASS';continue;}
  const ex={ok:true,outcomes,pTurnover:outcomes.reduce((sum,b)=>sum+(b.turnover?n(b.p):0),0),
   pTouchdown:outcomes.reduce((sum,b)=>sum+(b.touchdown===o.team?n(b.p):0),0),
   unresolvedMass:row.own_unknown,rest:{p:row.own_unknown}};
  row.own_turnover=ex.pTurnover;row.own_touchdown=ex.pTouchdown;
  row.endpoint_value=certificate?certificate.baseValue:weightedPolicyValue({...policy,ex,unknown:row.own_unknown},o,inspect);
  row.terminal_mass=outcomes.filter(periodEnd).reduce((sum,b)=>sum+n(b.p),0);
  ownStatus='completed';ownReason=row.own_unknown>1e-8?'OWN_BOUNDARY_UNOBSERVED_MASS':'own-boundary-observed';
  }finally{ownPhase.finish({status:ownStatus,reason:ownReason,elapsedMs:Math.max(0,Date.now()-localStart)});}
  const replyBranches=outcomes.filter(b=>!periodEnd(b))
   .sort((a,b)=>b.p-a.p).slice(0,2);
  if(!replyBranches.length&&row.terminal_mass>=1-1e-8){
   const startedAt=Date.now(),terminalPhase=phaseScope('shadow-reply',{candidateId:row.candidateId,allocatedSlotMs:0,localDeadline:localEnd,startedAt});
   terminalPhase.finish({status:'not-needed',reason:'not-needed-terminal',elapsedMs:Math.max(0,Date.now()-startedAt)});
  }
  for(const b of replyBranches){
   const replyStart=Date.now(),replyPhase=phaseScope('shadow-reply',{candidateId:row.candidateId,from:b.key??null,probability:b.p,allocatedSlotMs:Math.max(0,localEnd-replyStart),localDeadline:localEnd,startedAt:replyStart});
   let replyStatus='failed',replyReason='phase-interrupted';
   try{
   if(!b.key){row.rejections.push('REPLY_SOURCE_KEY_MISSING');replyStatus='skipped';replyReason='REPLY_SOURCE_KEY_MISSING';continue;}
   if(b.active===o.team||b.observation?.active===o.team){row.rejections.push('REPLY_SOURCE_STILL_OWN_ACTIVE');replyStatus='skipped';replyReason='REPLY_SOURCE_STILL_OWN_ACTIVE';continue;}
   if(left()<900){row.rejections.push('REPLY_SLOT_EXHAUSTED');replyStatus='skipped';replyReason='REPLY_SLOT_EXHAUSTED';continue;}
   const call=async fn=>{if(left()<150)return null;try{return await fn();}catch{return null;}};
   const reply=await inspect.replyAssessment(b,boundedReplyServices(replyPhase.services,localEnd),call,()=>Math.min(500,Math.max(50,left()-120)),o.team,left,true);
   if(reply.failed)row.rejections.push('REPLY_SERVICE_FAILED');
   else row.observed_reply_mass+=b.p;
   if(!reply.unknown&&reply.essentialComplete&&!reply.failed)row.checked_reply_mass+=b.p;
   row.critical_reply+=b.p*Math.min(0,n(reply.criticalAdjustment));
   row.position_reply+=b.p*Math.min(0,n(reply.positionAdjustment));
   row.reply.push({p:b.p,unknown:!!reply.unknown,essentialComplete:!!reply.essentialComplete,failed:!!reply.failed,
    directScore:reply.directScore,carrierThreat:reply.carrierThreat,
    criticalAdjustment:reply.criticalAdjustment,positionAdjustment:reply.positionAdjustment});
   replyStatus=reply.failed?'failed':'completed';replyReason=reply.failed?'REPLY_SERVICE_FAILED':reply.unknown||!reply.essentialComplete?'BOUNDED_REPLY_INCOMPLETE':'bounded-reply-observed';
   }finally{replyPhase.finish({status:replyStatus,reason:replyReason,elapsedMs:Math.max(0,Date.now()-replyStart)});}
  }
  row.reply_unknown=Math.max(0,1-row.terminal_mass-row.checked_reply_mass);
  // Same old coverage charge for every identity. Partial observed harm is
  // retained, never erased or renamed a complete reply certificate.
  row.shadow_score=row.endpoint_value+row.critical_reply+row.position_reply-row.reply_unknown*18;
  row.comparison_ready=row.own_unknown<=1e-8&&Number.isFinite(row.shadow_score);
  if(row.own_unknown>1e-8)row.rejections.push('OWN_BOUNDARY_UNOBSERVED_MASS');
  if(row.reply_unknown>1e-8)row.rejections.push('BOUNDED_REPLY_INCOMPLETE');
  row.rejections=[...new Set(row.rejections)];
  row.elapsed_ms=slotMs-left();
 }
 const eligible=report.pool.filter(r=>r.comparison_ready);
 report.ranked=eligible.sort((a,b)=>b.shadow_score-a.shadow_score||inputKey(a.input).localeCompare(inputKey(b.input)))
  .map(r=>({candidateId:r.candidateId,policy_index:report.pool.indexOf(r),policy_variant:r.policy_variant,input:r.input,shadow_score:r.shadow_score,reply_unknown:r.reply_unknown,source:r.source}));
 report.reason=report.ranked.length>=2?'SHARED_BOUNDARY_SHADOW_ORDERING':'FEWER_THAN_TWO_COMPLETE_OWN_BOUNDARIES';
 report.elapsed_ms=Date.now()-start;return report;
}
