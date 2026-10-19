import {decisionAgreement} from './decision-agreement.mjs';
import {createCandidateLedger} from './candidate-ledger.mjs';
import {EXPERIMENT_MODE,experimentSettings} from './experiment-config.mjs';
import {discoverContactCoordination} from './contact-coordination.mjs';
import {challengeProtection,certifiedScopeClosure} from './protection.mjs';
import {createReceiverDefenseReservation,challengeReceiverDefense} from './receiver-defense.mjs';
import {createClearanceDiscovery,challengeFinalClearance,auditOrdinaryMoves} from './clearance.mjs';
import {createChampion} from './champion.mjs';
import {fairInspector} from './fair-inspector.mjs';
import {correctSetupBallRoles} from './setup.mjs';
import {createScoringDiscovery,challengeFinalScoring} from './scoring.mjs';
import {continuationCandidate,createPlan,armStep,planView,dependencyCoverage} from './execution.mjs';
import {saveChampionPlan,armAuditedContinuation} from './plans.mjs';
import {same,endorseContinuation,evidenceSummary,policyIdentity} from './policy.mjs';
import {protectBeforePickup} from './preparation.mjs';
import {challengeDefense,reserveDefenseTerminals,captureDefenseTerminal} from './defense.mjs';
import {challengeRelay} from './relay.mjs';
import {challengeEnd} from './endguard.mjs';
import {challengeContinuation,challengeCompletedActivation} from './continuation.mjs';
import {requestServices,reserveFutureKeyCapacity,boundedProducerServices,guardLiveExplore,withServiceOwner,recordServiceObservation,withEnumerationDeadline,legacySearchWindow} from './services.mjs';
import {lifecycleReview,planningEvidence,reviewedChampionContext} from './lifecycle.mjs';
import {challengeGoalTasks,challengeRepairTasks} from './goals.mjs';
import {auditSharedRule,certifiedRuleChoice,commitClearanceRule,clearanceRuleChoice,builtinRuleChoice} from './rules.mjs';
import {bindRecoveryObligations} from './recoveries.mjs';
import {challengeMechanisms} from './mechanisms.mjs';
import {challengeStrategicWindow,matchIntent} from './strategy.mjs';
import {learnedChoiceShadow} from './learned-choice.mjs';
import {tacticalShadow} from './tactical-shadow.mjs';
import {prepareLearnedProposal,compareLearnedProposal,bindLearnedForCommonPool} from './learned-proposal.mjs';
import {compareCommonTurnPool} from './common-turn-pool.mjs';
import {auditCommonBoundary} from './common-boundary.mjs';
import {learningTraceForHost} from './trace-size.mjs';
import {protectFirst} from './protect-first.mjs';
import {planTurn,plannerGate,lateConsultDue} from './turn-planner.mjs';
const EXPERIMENT=experimentSettings();
const IDENTITY={coachId:'hopeful-2-5-s4-37u-c-unified',version:'2.5.0-test.s4.37u.c',contextSchema:'hopeful-context/2.5-s4.37u.c'};
const bytes=x=>new TextEncoder().encode(JSON.stringify(x)).length;
const champion=createChampion(),inspect=EXPERIMENT.fairExternal?fairInspector(champion.inspector):champion.inspector;
const previous=o=>o.coachContext?.schema===IDENTITY.contextSchema?o.coachContext:
 o.coachContext?.drivePlan?{champion:o.coachContext,plan:null}:null;
const championObservation=(o,old)=>({...o,coachContext:old?.champion??null});
const label=x=>String(x||'Engine-validated choice').replace(/^Hopeful [^:]+:\s*/, '');
function envelope(championContext,plan,stats){
 const payload={schema:IDENTITY.contextSchema,champion:championContext??null,plan,stats};
 if(bytes(payload)>8192)payload.plan=null;
 if(bytes(payload)>8192){delete payload.stats;if(bytes(payload)>8192)return championContext;}
 return payload;
}
// S4.37 visible admission: which accepted runtime engine (runtime-engines.mjs) admitted the learned/teacher path, or why not.
function learnedDomainAdmission(report){
 const d=report?.learning?.learning_domain;
 return d?{domain:{admitted:d.admitted===true,reason:d.reason??null,runtimeEngine:d.runtime_engine??null,relation:d.runtime_engine_relation??null},domainSkipped:null}:
  {domain:null,domainSkipped:report?.reason??'learned-domain-unevaluated'};
}
async function chooseBaseAction(o,native,adapter,watch={}){
 if(o.phase!=='play'||o.pending||o.active!==o.team)return null;
 const start=Date.now(),deadline=adapter.deadline,ledger=createCandidateLedger(o.requestId??null);
 const liveExploreAdmission=guardLiveExplore(adapter.services,o.team,o.players,{deadline,complexTimeExtension:true,complexMinDispatchMs:3000,foreignMoveTimeExtension:true,ownRootPassTimeExtension:true,heldDirectTimeExtension:true}),services=liveExploreAdmission.services;
 const stages={},old=previous(o);let snapshot=null;
 let learnedProposal;const learnedAt=Date.now();
 try{learnedProposal=await prepareLearnedProposal(o,native,services,inspect,deadline-6000);}
 catch(e){learnedProposal={report:{attempted:false,generated:false,reason:'learned-early-service-failed',error:String(e).slice(0,160)},line:null};}
 stages.learnedPreparationMs=Date.now()-learnedAt;
 if(learnedProposal.line)ledger.occurrence(learnedProposal.line,{source:'learned',role:'early-policy',index:0});
 let priorExecution=null;
 if(old?.plan){const at=Date.now();priorExecution=await continuationCandidate(old.plan,o,services,{identity:IDENTITY});stages.reconcileMs=Date.now()-at;}
 const replan=lifecycleReview(o,priorExecution,old?.champion?.drivePlan);
 let defenseReservation=null;
 try{defenseReservation=await reserveDefenseTerminals(o,native,services,inspect,deadline);}catch{}
 const receiverReservation=createReceiverDefenseReservation(o,services,deadline);
 const legacyPhase=ledger.phase({phase:'legacy-search',candidateId:null,localDeadline:null,
  scope:'whole frozen search; default enumeration deadline applies only to verified own actors; individual legacy candidates and foreign reply local windows remain unobserved'});
 const liveChampionServices=withServiceOwner(services,legacyPhase.owner);
 const championServices=defenseReservation?.attempted||defenseReservation?.ownClosureEnabled||receiverReservation.enabled?{...liveChampionServices,explore:async(input,options)=>{
  const ex=await liveChampionServices.explore(input,options);
  try{await captureDefenseTerminal(defenseReservation,o,input,options,ex,services,inspect,deadline);}catch{}
  try{await receiverReservation.capture(input,options,ex);}catch{}
  return ex;
 }}:liveChampionServices;
 // Keep the observer within this request, including overlapping host calls.
 const actionChampion=createChampion({onSelected:e=>{snapshot=e;}});
 // Frozen search logic is retained; reservations share this request's budgets.
 const scoringDiscovery=createScoringDiscovery(o,native),clearanceDiscovery=createClearanceDiscovery(o,native);
 const scoringServices=scoringDiscovery.enabled||clearanceDiscovery.enabled?{...championServices,candidates:async(query)=>{const response=await championServices.candidates(query);try{scoringDiscovery.observe(query,response);clearanceDiscovery.observe(query,response);}catch{}return response;}}:championServices;
 const keyReservation=learnedProposal.report.ownComplete?reserveFutureKeyCapacity(scoringServices,adapter.keyStock):null;
 const championAt=Date.now(),championTimeLimitMs=Math.max(400,Math.min(o.timeLimitMs||120000,(deadline-championAt)/inspect.CFG.searchShare));
 const legacyEnumerationWindow=legacySearchWindow({started:championAt,timeLimitMs:championTimeLimitMs,
  searchShare:inspect.CFG.searchShare,maxSearchMs:inspect.CFG.maxSearchMs,deadline});
 legacyPhase.finish({allocatedSlotMs:legacyEnumerationWindow.allocatedMs,frozenBudgetMs:legacyEnumerationWindow.budgetMs,localDeadline:legacyEnumerationWindow.deadline,
  deadlineSource:legacyEnumerationWindow.source,timeLimitMs:championTimeLimitMs,searchShare:inspect.CFG.searchShare,maxSearchMs:inspect.CFG.maxSearchMs,
  serviceCostsObserved:recordServiceObservation(liveChampionServices,{method:'phase',status:'phase-enter'})});
 const enumerationServices=withEnumerationDeadline(keyReservation?.services??scoringServices,{...legacyEnumerationWindow,ownTeam:o.team,
  ownPlayerIds:o.players.filter(p=>p.team===o.team).map(p=>p.id)});
 let answer;
 try{answer=await actionChampion.chooseAction({...championObservation(o,old),timeLimitMs:championTimeLimitMs},native,enumerationServices);}
 finally{legacyPhase.finish({status:answer?.input?'completed':'unreturned',elapsedMs:Date.now()-championAt});}
 stages.championMs=Date.now()-championAt;
 if(answer?.input)watch.champion={answer,context:answer.coachContext??old?.champion??null,stats:old?.stats??{}};
 if(snapshot?.selected)ledger.occurrence(snapshot.selected,{source:'champion',role:'selected'});
 for(const [index,line] of (snapshot?.lines||[]).entries())ledger.occurrence(line,{source:'champion',role:'observed-line',index});
 if(adapter.stats.incompatibleOutcomeResponses){
  if(answer?.input)ledger.returned(answer.input,snapshot?.selected,{reason:'unsupported-host; incumbent-returned'});
  return answer?.input?{...answer,coachContext:envelope(answer.coachContext??old?.champion,null,old?.stats??{}),
   why:'Hopeful 2.5-GPT — S3 Turn Plan Test: this host lacks complete-state-v1 outcome identity; only the engine-native incumbent is retained, without tactical or continuation certification.',
   trace:{...answer.trace,candidateLedger:ledger.snapshot(),hostCompatibility:{supported:false,required:'complete-state-v1',reason:'unsupported-outcome-identity'},
    execution:{persisted:false,status:'unsupported-host',reason:'outcome-identity-not-certified'},search:{...answer.trace?.search,services:adapter.snapshot()}}}:null;
 }
 if(!answer?.input)return answer;
 const championContext=reviewedChampionContext(o,answer.coachContext,old?.champion);
 const championSnapshot=snapshot,championInput=answer.input;
 // S4.26: the champion ranks single root actions, so a risky ground-ball pickup always beats a dice-free screen.
 // Protect first: return one engine-certified dice-free guard move; the champion re-decides from the real successor.
 let protectFirstReport=null,plannerReport=null;
 // S4.27 prototype: bounded whole-Turn plan search on engine-forked states; first action only, re-planned every decision.
 let guardHint=null;
 if(adapter.canSearch()&&championSnapshot?.selected&&o.ball?.kind==='ground'){
  try{const g=await protectFirst(o,championSnapshot.selected,services,Math.min(deadline-2000,Date.now()+6000));guardHint=g;}catch{}
 }
 // A validated saved conditional task (multi-Turn drive plan) is continued by the existing machinery, not re-planned.
 const savedContinuation=!!(old?.plan&&priorExecution?.candidate);
 const plannerAccess=plannerGate({savedContinuation,championInput,continuationInput:priorExecution?.candidate?.input});
 stages.plannerGate=plannerAccess.reason;
 const plannerBudget=Math.min(20000,deadline-Date.now()-40000);   // never let the planner push the decision to the deadline (S4.34 T1: reserve 48 → 40 s with the 96 s finish, budget unchanged)
 // The planner's own answer (first action of its plan), shared by the normal consult and the S4.34 late consult.
 // report carries the late marker for the late consult; kept = the plan's first action is the champion's own input
 // (possible on the late path, whose baseline is End Turn, and after the order checks), which is not an override.
 // planningChecks is referenced only on the late path (it is declared after the early consult).
 const plannerAnswer=(planned,report=planned.report)=>{
   const chosenPlan=planned.best.input,current=championContext??old?.champion??null,kept=same(chosenPlan,championInput);
   const ctx=current?{...current,movementMemory:inspect.rememberMovement(o,old?.champion?.movementMemory,chosenPlan)}:current;
   const stats={reused:old?.stats?.reused||0,decisions:(old?.stats?.decisions||0)+1,overrides:(old?.stats?.overrides||0)+(kept?0:1)};
   ledger.returned(chosenPlan,null,{reason:report.late?'late-turn-planner':'turn-planner'});
   return {...answer,input:chosenPlan,coachContext:envelope(ctx,null,stats),
    why:`Hopeful 2.5-GPT — S4.37 turn plan: ${planned.best.plan.labels.join(' → ')} (value ${planned.best.plan.adjusted ?? 'order check, '+report.reason} vs ${report.late?'End Turn':'champion-first'} ${report.championPlan?.adjusted ?? 'n/a'}); first action only, re-planned after it.`,
    trace:{...answer.trace,candidateLedger:ledger.snapshot(),coach:'Hopeful 2.5-GPT — S4.37 turn planner',
     champion:{id:'hopeful-1-5-9-gpt',input:championInput,preserved:kept},turnPlanner:report,protectFirst:guardHint,reused:false,
     execution:{status:'turn-planner-selected',reason:report.reason,persisted:false,planId:null,
      previousPlan:old?.plan&&priorExecution?{status:priorExecution.status,reason:priorExecution.reason,inputConfirmed:!!priorExecution.inputConfirmed,sourceConfirmed:!!priorExecution.sourceConfirmed}:null},
     planning:{replan,checks:report.late?{...planningChecks,turnPlanner:{reason:report.reason,elapsedMs:report.elapsedMs,late:report.late}}:
      {turnPlanner:{reason:report.reason,elapsedMs:report.elapsedMs}}},
     selection21:{override:!kept,challenger:{selected:chosenPlan,reason:report.reason}},
     search:{...answer.trace?.search,stages,services:adapter.snapshot()}}};
 };
 if(adapter.canSearch()&&championSnapshot?.selected&&plannerAccess.run&&plannerBudget>=8000){
  const at=Date.now();let planned;
  try{planned=await planTurn(o,services,inspect,Date.now()+plannerBudget,{championInput,championLine:championSnapshot.selected,championLines:championSnapshot.lines,extraRoot:guardHint?.selected?[{input:guardHint.selected.input,label:guardHint.selected.label}]:[]});}
  catch(e){planned={best:null,report:{attempted:true,reason:'planner-failed',error:String(e).slice(0,160)}};}
  stages.plannerMs=Date.now()-at;plannerReport=planned.report;
  if(planned.best)return plannerAnswer(planned);
 }
 if(adapter.canSearch()&&championSnapshot?.selected&&o.ball?.kind==='ground'){
  const at=Date.now();let guard=guardHint;
  if(!guard)guard={attempted:false,selected:null,reason:'protect-first-not-run'};
  stages.protectFirstMs=Date.now()-at;
  if(guard.selected){
   const chosenGuard=guard.selected.input,current=championContext??old?.champion??null;
   const ctx=current?{...current,movementMemory:inspect.rememberMovement(o,old?.champion?.movementMemory,chosenGuard)}:current;
   const stats={reused:old?.stats?.reused||0,decisions:(old?.stats?.decisions||0)+1,overrides:(old?.stats?.overrides||0)+1};
   ledger.returned(chosenGuard,null,{reason:'protect-first'});
   return {...answer,input:chosenGuard,coachContext:envelope(ctx,null,stats),
    why:`Hopeful 2.5-GPT — S4.26 protect before pickup: ${guard.selected.label} first (ball exposure ${guard.exposureBefore} -> ${guard.selected.exposureAfter}); the pickup (${Math.round(guard.pickupTurnover*100)}% turnover) waits until dice-free guards are placed.`,
    trace:{...answer.trace,candidateLedger:ledger.snapshot(),coach:'Hopeful 2.5-GPT — S4.26 protect-first',
     champion:{id:'hopeful-1-5-9-gpt',input:championInput,preserved:false},protectFirst:guard,
     selection21:{override:true,challenger:{selected:chosenGuard,reason:guard.reason}},
     search:{...answer.trace?.search,stages,services:adapter.snapshot()}}};
  }
  stages.protectFirst=guard.reason;
  protectFirstReport={...guard,threats:guard.threats?.slice(0,6)};
 }
 let selected=championSnapshot?.selected,chosen=championInput,plan=null,reused=false;
 let execution={status:'champion-selected',reason:'no-eligible-persistent-plan'};
 let previousPlanReview=null;
 let gate={eligible:false,reason:'no-continuation-candidate'};
 if(old?.plan){
  execution=priorExecution;
  // Keep the actual reconciliation outcome before recording a new plan below.
  // A fresh plan must not erase why a prior plan was retired after state changes.
  previousPlanReview={status:execution.status,reason:execution.reason,
   differenceCount:execution.differenceCount??null,differencePaths:execution.differencePaths??[],
   inputConfirmed:!!execution.inputConfirmed,sourceConfirmed:!!execution.sourceConfirmed};
  if(execution.candidate){
   const c=championSnapshot?.lines?.find(c=>same(c.input,execution.candidate.input));
   gate=same(championInput,execution.candidate.input)?{eligible:true,equivalent:true,reason:'fresh-champion-identical-input'}:
    endorseContinuation(c,selected,inspect,championSnapshot?.mode);
   if(gate.eligible){const armed=await armAuditedContinuation(execution.plan,o,c||selected,IDENTITY,services,deadline-150);
    gate={...gate,rearmReason:armed.reason};
    if(armed.plan){plan=armed.plan;chosen=execution.candidate.input;selected=armed.selected;reused=true;}}
  }
 }
 let challenger={attempted:false,reason:'no-extra-reordering-needed'};
 const planningChecks={learnedPreparation:learnedProposal.report,keyReservation:keyReservation?.report??{enabled:false,reason:'no-complete-early-learned-policy'}},commonCandidates=[],commonCandidateOrigins=[];
 const producerResults=new Map();
 const observeProducer=(name,result)=>ledger.producerOutput(name,result);
 const collectProducer=(name,result)=>{producerResults.set(name,result);const observed=observeProducer(name,result);
  commonCandidates.push(...observed.trees);commonCandidateOrigins.push(...observed.origins);
  if(result.selected){commonCandidates.push(result.selected);commonCandidateOrigins.push(observed.selectedOrigin);if(!EXPERIMENT.commonSelection&&!challenger.selected){challenger=result;selected=result.selected;chosen=selected.input;plan=null;reused=false;}}return result;};
 if(learnedProposal.line){commonCandidates.push(learnedProposal.line);commonCandidateOrigins.push(ledger.occurrence(learnedProposal.line,{source:'learned',role:'early-policy',index:0}));}
 const recordCheck=r=>({attempted:!!r.attempted,reason:r.reason,selected:r.selected?.input??null,
   priorComparison:r.priorComparison??null,scope:r.policyScope??null,evidence:r.evidence?.policies?
   {scope:r.evidence.scope,elapsedMs:r.evidence.elapsedMs,eligible:!!r.selected,gate:r.evidence.policies.find(p=>r.selected&&same(p.input,r.selected.input))?.gate,ownUncertainty:r.evidence.ownUncertainty?.slice(0,4),receiverWindow:r.evidence.receiverWindow?{reason:r.evidence.receiverWindow.reason,scope:r.evidence.receiverWindow.scope,discoveryIncomplete:r.evidence.receiverWindow.discoveryIncomplete,domainCount:r.evidence.receiverWindow.domain.length,calls:r.evidence.receiverWindow.calls,nextOwnOpportunity:r.evidence.receiverWindow.nextOwnOpportunity,policies:r.evidence.receiverWindow.policies.map(p=>({input:p.input,lower:p.lower,upper:p.upper}))}:undefined}:r.evidence??null,
  sharedInputValidation:r.evidence?.sharedInputValidation?{
   checked:r.evidence.sharedInputValidation.length,
   legal:r.evidence.sharedInputValidation.filter(x=>x.verified&&x.legal).length,
   refusals:r.evidence.sharedInputValidation.filter(x=>!x.verified||!x.legal).map(x=>({...x,
    reason:x.verified?'shared-input-illegal-at-source':'shared-input-validation-unverified'}))}:undefined,
  generatedPolicyCount:Array.isArray(r.policyTrees)?r.policyTrees.length:null,
  ...(r.discoveryCoverage!==undefined?{discoveryCoverage:r.discoveryCoverage}:{}),
  ...(r.queries!==undefined?{queries:r.queries}:{}),...(r.discovery!==undefined?{discovery:r.discovery}:{}),
  policies:(r.policies||[]).map(p=>({input:p.input,reason:p.reason??null,reasons:p.reasons??(p.reason?[p.reason]:[]),primaryReason:p.reason??null,complete:p.complete??p.ownPolicyComplete??null,policyVariant:p.policyVariant??p.variant??null,dependencyDepth:p.dependencyDepth??p.ownPolicyDepth??null,goal:p.goal??null,baseValue:p.baseValue,pTurnover:p.pTurnover,
   unknown:p.unknown,observedReplyMass:p.observedReplyMass,checkedReplyMass:p.checkedReplyMass,
   criticalReplyAdjustment:p.criticalReplyAdjustment,positionReplyAdjustment:p.positionReplyAdjustment})),error:r.error});
 if(adapter.canSearch()&&!reused&&!challenger.selected&&championSnapshot?.mode==='final-turn'&&Date.now()<deadline-2800){
  const scoringAt=Date.now();
  try{const scoring=await challengeFinalScoring(o,championSnapshot,scoringDiscovery,services,inspect,deadline-500);
   observeProducer('finalScoring',scoring);
   planningChecks.finalScoring={...recordCheck(scoring),discovery:scoring.discovery,ruleScope:scoring.ruleScope,current:scoring.current,policies:scoring.policies};
   if(scoring.selected){challenger=scoring;chosen=scoring.selected.input;selected=scoring.selected;plan=null;}
  }catch(e){planningChecks.finalScoring={attempted:true,reason:'scoring-gap-query-failed; protected original score retained',error:String(e).slice(0,160)};}
  stages.finalScoringMs=Date.now()-scoringAt;
 }
 if(adapter.canSearch()&&!reused&&!challenger.selected&&clearanceDiscovery.enabled&&Date.now()<deadline-3500){
  const at=Date.now();
  try{const clearance=await challengeFinalClearance(o,championSnapshot,clearanceDiscovery,services,inspect,deadline-500);
   observeProducer('finalClearance',clearance);
   planningChecks.finalClearance={...recordCheck(clearance),discovery:clearance.discovery,ruleScope:clearance.ruleScope,current:clearance.current,policies:clearance.policies};
   if(clearance.selected){challenger=clearance;chosen=clearance.selected.input;selected=clearance.selected;plan=null;}
  }catch(e){planningChecks.finalClearance={attempted:true,reason:'clearance-query-failed; original retained',error:String(e).slice(0,160)};}
  stages.finalClearanceMs=Date.now()-at;
 }
 // Every normal-mode source receives one bounded discovery slot against the
 // immutable champion. Saved/local winners are proposals, not scheduling gates.
 if(adapter.canSearch()&&championSnapshot?.mode==='normal'&&selected){
  const learnedLine=await bindLearnedForCommonPool(o,championSnapshot,learnedProposal,services,inspect,deadline-16500);
  if(learnedLine&&!commonCandidates.includes(learnedLine)){commonCandidates.unshift(learnedLine);commonCandidateOrigins.unshift(ledger.occurrence(learnedLine,{source:'learned',role:'common-bound-policy',index:0}));}
  const base={...championSnapshot,selected:championSnapshot.selected};
  const producers=[
   ['protection',4300,(d,s)=>challengeProtection(o,base,native,s,inspect,d)],
   ['ball-order',2200,(d,s)=>o.ball?.kind==='ground'?protectBeforePickup(o,base.selected,s,inspect,d):challengeEnd(o,base,native,s,inspect,d)],
   ['contactCoordination',3000,(d,s)=>discoverContactCoordination(o,base,native,s,inspect,d)],
   ['relay',3000,(d,s)=>challengeRelay(o,base,s,inspect,d)],
   ['defense',3000,(d,s)=>challengeDefense(o,base,native,s,inspect,d,defenseReservation)],
   ['repair',3000,(d,s)=>challengeRepairTasks(o,base,old?.plan,priorExecution,IDENTITY,s,inspect,d)],
   ['goals',3600,(d,s)=>challengeGoalTasks(o,base,championContext?.drivePlan,old?.plan,priorExecution,s,inspect,d)],
   ['mechanisms',4000,(d,s)=>challengeMechanisms(o,base,s,inspect,d)],
   ['strategy',6500,(d,s)=>challengeStrategicWindow(o,base,championContext?.drivePlan,s,inspect,d)],
   ...(receiverReservation.enabled?[['receiverDefense',4500,(d,s)=>challengeReceiverDefense(o,base,receiverReservation,s,inspect,d)]]:[]),
  ... (priorExecution?.candidate?[['continuation',3000,async(d,s)=>{const r=await challengeContinuation(o,base,priorExecution.candidate,s,inspect,d,gate);if(!r.selected)return r;const a=await armAuditedContinuation(priorExecution.plan,o,r.selected,IDENTITY,s,d-150);return {...r,selected:a.plan?a.selected:null,rearmReason:a.reason};}]]:[]),
  ... (priorExecution?.status==='completed'&&priorExecution.reason==='planned-final-public-outcome'?[['activationCompletion',3000,(d,s)=>challengeCompletedActivation(o,base,planView(old?.plan)?.activeTask,s,inspect,d)]]:[])
  ].filter(([name])=>!producerResults.has(name));
  planningChecks.lateProducers=[];
  for(let i=0;i<producers.length&&adapter.canSearch();i++){
   const [name,minimum,run]=producers[i],slot=Math.min(9000,Math.max(0,Math.floor((deadline-Date.now()-16000)/(producers.length-i))));
   if(slot<minimum){planningChecks.lateProducers.push({source:name,attempted:false,reason:'shared-producer-slot-budget-unavailable',slotMs:slot});ledger.producer({source:name,invoked:false,reason:'shared-producer-slot-budget-unavailable'});continue;}
   const budget=adapter.snapshot().resourceBudget;
   const calls=Math.min(500,Math.max(0,Math.floor(((budget.maxServiceCalls??6000)-(budget.callsUsed??0)-2200)/(producers.length-i))));
   const scoped=boundedProducerServices(services,{calls,budgetState:()=>adapter.snapshot().resourceBudget,reservePositions:2200,deadline:Math.min(deadline-16000,Date.now()+slot)});
   try{const r=collectProducer(name,await run(scoped.report.deadline,scoped.services));
    planningChecks.lateProducers.push({source:name,...recordCheck(r),slotMs:slot,discoveryBudget:scoped.report});
   }catch(e){planningChecks.lateProducers.push({source:name,attempted:true,reason:'common-producer-service-failed',error:String(e).slice(0,160)});ledger.producer({source:name,invoked:true,reason:'common-producer-service-failed'});}
  }
  for(const [name] of producers)if(!planningChecks.lateProducers.some(r=>r.source===name))ledger.producer({source:name,invoked:false,reason:'request-search-unavailable'});
  const at=Date.now();
  try{const common=await compareCommonTurnPool(o,base,selected,commonCandidates,services,inspect,deadline-500,{learnedLine,valueMode:EXPERIMENT.valueMode,comparisonScope:'finite-common',ledger,extraOrigins:commonCandidateOrigins});
   planningChecks.commonTurnPool=common;
   if(EXPERIMENT.commonSelection&&common.selected){challenger=common;selected=common.selected;chosen=selected.input;plan=null;reused=false;
    if(priorExecution?.candidate&&same(chosen,priorExecution.candidate.input)){
     const armed=await armAuditedContinuation(priorExecution.plan,o,selected,IDENTITY,services,deadline-150);
     planningChecks.commonContinuation={reason:armed.reason};
     if(armed.plan){plan=armed.plan;selected=armed.selected;reused=true;execution=priorExecution;}
    }
   }
  }catch(e){planningChecks.commonTurnPool={attempted:true,selected:null,reason:'common-turn-comparison-failed; fallback-is-not-a-winner',error:String(e).slice(0,160)};}
  stages.commonTurnPoolMs=Date.now()-at;
 }
 if(adapter.canSearch()&&selected&&!planningChecks.commonTurnPool?.attempted){
  const at=Date.now();
  try{const learned=await compareLearnedProposal(o,{...championSnapshot,selected},learnedProposal,services,inspect,deadline-500);
   if(learnedProposal.line&&!commonCandidates.includes(learnedProposal.line)){commonCandidates.push(learnedProposal.line);commonCandidateOrigins.push(ledger.occurrence(learnedProposal.line,{source:'learned',role:'comparison-bound-policy',index:0}));}
   planningChecks.learnedComparison={...recordCheck(learned),currentOwn:learned.currentOwn,bounds:learned.bounds,replyDomain:learned.replyDomain,replyMeasurements:learned.replyMeasurements,scoringIntervals:learned.scoringIntervals};
   if(learned.selected){challenger=learned;chosen=learned.selected.input;selected=learned.selected;plan=null;reused=false;}
  }catch(e){planningChecks.learnedComparison={attempted:true,reason:'learned-comparison-service-failed',error:String(e).slice(0,160)};}
  stages.learnedComparisonMs=Date.now()-at;
 }
 if(planningChecks.commonTurnPool?.attempted){
  const common=planningChecks.commonTurnPool;
  planningChecks.learnedComparison={attempted:common.rows?.some(r=>r.learnedProposal)===true,
   selected:common.selectedLearnedProposal?common.selected.input:null,reason:'learned-proposal-in-common-turn-pool',commonReason:common.reason};
 }
 if(adapter.canSearch()&&!reused&&selected&&Date.now()<deadline-500){
  const recoveryAt=Date.now();
  try{const recovery=await bindRecoveryObligations(o,selected,services,deadline-200);selected=recovery.selected;
   planningChecks.recoveryObligations={attempted:recovery.attempted,bound:recovery.bound,unbound:recovery.unbound,reason:recovery.reason};
  }catch{planningChecks.recoveryObligations={attempted:true,reason:'recovery-binding-failed; no new certainty'};}
  stages.recoveryBindingMs=Date.now()-recoveryAt;
 }
 const contextFor=()=>{
  const current=championContext??old?.champion??null;
  return !same(chosen,championInput)&&current?
   {...current,movementMemory:inspect.rememberMovement(o,old?.champion?.movementMemory,chosen)}:current;
 };
 const statsFor=()=>({reused:(old?.stats?.reused||0)+(reused?1:0),decisions:(old?.stats?.decisions||0)+1,
  overrides:(old?.stats?.overrides||0)+(same(chosen,championInput)?0:1)});
 const save=()=>{
  const reserve=Math.min(7500,8192-bytes({schema:IDENTITY.contextSchema,champion:contextFor(),plan:null,stats:statsFor()}));
  if(reserve<512)return {plan:null,reason:'context-reservation-exceeded',nodes:0};
  return saveChampionPlan(o,selected,IDENTITY,reserve);
 };
 if(!plan){const saved=save();plan=saved.plan;execution={status:'selected-plan-recorded',reason:saved.reason,nodes:saved.nodes,representation:saved.representation};}
 const requiredDependency=!!selected?.preparedBranches?.size||selected?.requireRuleMaps===true;
 const scopeClosureCertified=certifiedScopeClosure(selected,o,inspect);
 const hasDependency=scopeClosureCertified||dependencyCoverage(plan,o,selected).complete&&(!selected?.requireRuleMaps||!!plan?.ruleMaps);
 if((requiredDependency&&!hasDependency)||plan&&bytes({schema:IDENTITY.contextSchema,champion:contextFor(),plan,stats:statsFor()})>8192){
  if(requiredDependency||reused&&!same(chosen,championInput)){
   chosen=championInput;selected=championSnapshot?.selected;reused=false;
   challenger={...challenger,selected:null,reason:'required-plan-does-not-fit-final-context'};
  }
  plan=null;const saved=save();plan=saved.plan;execution={status:'selected-plan-recorded',reason:saved.reason,nodes:saved.nodes,representation:saved.representation};
 }
 let adjusted=contextFor(),stats=statsFor();
 // A recognized clearance successor gets a fresh audit of the ACTUAL final
 // selection, including a newly protected TD route. No root handle is reused.
 const clearanceFirst=challenger.selected&&challenger.reason==='strict-bounded-two-Move-TD-improvement';
 const clearanceNext=priorExecution?.status==='candidate-ready'&&old?.plan?.rulePolicy?.scope==='final-clearance-Move/1'&&
  selected?.input?.action==='move'&&selected.input.playerId===priorExecution.candidate.input.playerId;
 let clearanceAudit=clearanceFirst?challenger.evidence?.alternative?.policyAudit:null;
 if(adapter.canSearch()&&clearanceNext&&Date.now()<deadline-800){
  try{clearanceAudit=await auditOrdinaryMoves(o,chosen,services,deadline-300);}catch{}
  planningChecks.clearanceSuccessor={attempted:true,actualInput:chosen,policyAudit:clearanceAudit,
   reason:clearanceAudit?.tdLower>0?'actual-selected-carrier-TD-policy-audited':'successor-policy-unverified'};
  if(clearanceAudit?.tdLower>0&&!plan){
   const maxBytes=Math.min(7500,8192-bytes({schema:IDENTITY.contextSchema,champion:adjusted,plan:null,stats}));
   const made=createPlan(o,{id:`${IDENTITY.coachId}:clearance-terminal:${o.revision}`,identity:IDENTITY,
    nodes:[{input:chosen,branches:[],goal:{id:'clearance-terminal',kind:'audited-clearance-carrier-score'}}],maxBytes});
   if(made.plan){plan=armStep(made.plan,o,chosen).plan;if(plan)execution={status:'selected-plan-recorded',reason:'audited-terminal-clearance-rule-action',nodes:1,representation:'retained-exact-graph'};}
  }
 }
 if((clearanceFirst||clearanceNext)&&clearanceAudit?.tdLower>0&&plan){
  const committed=commitClearanceRule(o,plan,chosen,IDENTITY);
  if(committed&&bytes(committed)<=committed.maxBytes&&bytes({schema:IDENTITY.contextSchema,champion:adjusted,plan:committed,stats})<=8192)plan=committed;
  else if(clearanceFirst){
   // The helper is justified only together with its admitted policy contract.
   chosen=championInput;selected=championSnapshot.selected;reused=false;plan=null;
   challenger={...challenger,selected:null,reason:'clearance-rule-commitment-does-not-fit'};adjusted=contextFor();stats=statsFor();
  }
 }

 let ruleAudit=null;
 if(adapter.canSearch()&&plan&&!plan.rulePolicy&&!plan.ruleMaps&&Date.now()<deadline-500){
  try{ruleAudit=await auditSharedRule(o,chosen,services,deadline-150);
   if(ruleAudit.agreement){const certificate={policy:ruleAudit.policy,agreement:true,actor:chosen.playerId,action:chosen.action};
    const certified={...plan,rulePolicy:certificate};
    if(bytes({schema:IDENTITY.contextSchema,champion:adjusted,plan:certified,stats})<=8192&&bytes(certified)<=certified.maxBytes)plan=certified;
   }
  }catch{ruleAudit={attempted:true,agreement:false,reason:'shared-rule-audit-failed'};}
 }
 // S4.34 late planner consult (H3). The planner is skipped while a validated saved continuation exists (S4.28); when
 // that continuation then loses and End Turn is the final choice, nothing has checked whether ending the Turn forfeits
 // useful actions. Real case: B1 away turn 40, decision 8 — End Turn played with the planner's own guard moves to the
 // carrier's open squares (#6 S9, #10 Q9, #11 S10) pending; the opponent blitzed the carrier from S9 and scored.
 // The planner compares End Turn with its plans (replies measured) and overrides only by its margin. Review fix: it runs
 // whenever a saved continuation existed and the planner has not already used End Turn as its baseline — also when the
 // continuation itself ends the Turn and the early consult was skipped for budget, or valued only the champion's move.
 if(lateConsultDue({chosen,savedContinuation,plannerRan:!!plannerReport,championInput,mode:championSnapshot?.mode??'normal',msLeft:deadline-Date.now()})&&
  adapter.canSearch()&&championSnapshot?.selected){
  const at=Date.now();let planned;
  try{planned=await planTurn(o,services,inspect,Date.now()+Math.min(20000,deadline-Date.now()-4000),
   {championInput:chosen,championLine:same(championInput,chosen)?championSnapshot.selected:null,championLines:championSnapshot.lines});}
  catch(e){planned={best:null,report:{attempted:true,reason:'planner-failed',error:String(e).slice(0,160)}};}
  stages.latePlannerMs=Date.now()-at;plannerReport={...planned.report,late:'end-turn-after-saved-continuation',...(plannerReport?{early:plannerReport}:{})};
  if(planned.best)return plannerAnswer(planned,plannerReport);
 }
 const context=envelope(adjusted,plan,stats);
 plan=context?.schema===IDENTITY.contextSchema?context.plan:null;
 const hierarchy=planningEvidence(adjusted?.drivePlan,plan,replan,chosen,reused?'validated-conditional-task':'fresh-selection');
 let commonComparison;
 try{commonComparison=adapter.canSearch()?await auditCommonBoundary(o,championSnapshot,selected,services,inspect,deadline-500,commonCandidates,{ledger,extraOrigins:commonCandidateOrigins}):{mode:'shadow',override:false,action_executed:false,reason:'REQUEST_RESOURCE_BUDGET_STOPPED'};}
 catch(e){commonComparison={mode:'shadow',override:false,action_executed:false,reason:'COMMON_BOUNDARY_AUDIT_FAILED',error:String(e).slice(0,160)};}
 const learnedAccepted=planningChecks.learnedComparison?.selected,
  learnedReturned=!!learnedAccepted&&same(chosen,learnedAccepted),learnedPlanPersisted=learnedReturned&&!!plan;
 const learnedAdmission={modelInvoked:learnedProposal.report.learning?.model_invoked===true,ranked:learnedProposal.report.ranked===true,generated:learnedProposal.report.generated===true,ownComplete:learnedProposal.report.ownComplete===true,inCommonPool:planningChecks.commonTurnPool?.rows?.some(r=>r.learnedProposal)===true,scopeClosureCertified:learnedReturned&&scopeClosureCertified,compared:!!planningChecks.learnedComparison?.attempted,selectedInComparison:!!learnedAccepted,
  committedToReturnedInput:learnedReturned,rulePlanPersisted:learnedPlanPersisted,
  reason:learnedReturned?'learned-common-winner-admitted':learnedAccepted?'learned-execution-admission-reverted':'no-learned-common-winner',
  // S4.37: the early learned proposal's engine/rules domain verdict, kept in the one trace field that is never compacted.
  // null (with domainSkipped) when the early shadow did not run (budget or service failure).
  ...learnedDomainAdmission(learnedProposal.report)};
 ledger.returned(chosen,selected,{commonWinnerCandidateId:planningChecks.commonTurnPool?.winnerCandidateId??null,commonSelectedCandidateId:planningChecks.commonTurnPool?.selectedCandidateId??null,commonSelectionBasis:planningChecks.commonTurnPool?.selectionBasis??null,reason:challenger.reason??execution.reason});
 const finalPolicyId=policyIdentity(selected),championPolicyId=policyIdentity(championSnapshot?.selected);
 const policyPreserved=finalPolicyId!==null&&championPolicyId!==null?finalPolicyId===championPolicyId:null;
 const trace={...answer.trace,candidateLedger:ledger.snapshot(),learnedAdmission,currentSourceExploreAdmission:liveExploreAdmission.snapshot(),legacyEnumerationWindow,hostCompatibility:{supported:adapter.stats.outcomeIdentityVerified,required:'complete-state-v1'},chosen:same(chosen,championInput)?answer.trace?.chosen:selected?.label||chosen.kind,
  coach:'Hopeful 2.5-GPT — S4.37 Turn Planner (watchdog, per-call timeouts local, dice-free-before-risky order check, reply-neutral opportunity model, two-branch reply charge, 104 s finish, last-action pickup, loose-ball order check) + S4.26 Protect-First',experiment:EXPERIMENT,champion:{id:'hopeful-1-5-9-gpt',sha256:inspect.metadata.sourceSha,
  mode:championSnapshot?.mode??null,input:championInput,evidence:evidenceSummary(championSnapshot?.selected),preserved:same(chosen,championInput),preservedScope:'first input only',policyPreserved},
  selection21:{override:!same(chosen,championInput),policyChanged:policyPreserved===null?null:!policyPreserved,gate,challenger:{attempted:challenger.attempted,
   selected:challenger.selected?.input??null,reason:challenger.reason,evidence:challenger.evidence?.policies?{eligible:!!challenger.selected,scope:challenger.evidence.scope,gate:challenger.selected?challenger.evidence.policies.find(c=>same(c.input,chosen))?.gate:null,elapsedMs:challenger.evidence.elapsedMs}:challenger.evidence,error:challenger.error,scope:challenger.policyScope}},
  execution:{status:execution.status,reason:execution.reason,planId:plan?.id??null,cursor:plan?.cursor??null,
   previousPlan:previousPlanReview,
   persisted:!!plan,inputConfirmed:!!execution.inputConfirmed,sourceConfirmed:!!execution.sourceConfirmed,
   representation:planView(plan)?.frontier?'rolling-exact-frontier':plan?'retained-exact-graph':null,
   dependencyAdmission:dependencyCoverage(plan,o,selected),
   comparison:'fresh actual champion; identical input or same-unit evidence gate'},
  planning:{...hierarchy,matchIntent:matchIntent(o,adjusted?.drivePlan),checks:planningChecks,rulePolicy:ruleAudit},protectFirst:protectFirstReport,turnPlanner:plannerReport,commonComparison,reused,defenseReservation:defenseReservation?.attempted?{reason:defenseReservation.reason,elapsedMs:defenseReservation.elapsedMs,
   records:defenseReservation.records?.length,complete:defenseReservation.records?.filter(r=>r.complete).length}:null,
  search:{...answer.trace?.search,coachElapsedMs:Date.now()-start,
   championElapsedMs:answer.trace?.search?.elapsedMs??null,stages,services:adapter.snapshot(),
   scope:'frozen champion search then bounded legal relay/screen/End comparison in common units; no Alpha ranking'}};
 const diagnosticChampionTrace=answer.trace;
 if(bytes(trace)>35000&&trace.lines)trace.lines=trace.lines.map(c=>({label:c.label,firstAction:c.firstAction,preparationGain:c.preparationGain,criticalReplyAdjustment:c.criticalReplyAdjustment,positionReplyAdjustment:c.positionReplyAdjustment,checkedReplyMass:c.checkedReplyMass,observedReplyMass:c.observedReplyMass,value:c.value}));
 return {...answer,repairDiagnostics:{championTrace:diagnosticChampionTrace,candidates:challenger.candidates,policies:challenger.policies,evidence:challenger.evidence,scope:challenger.policyScope},input:chosen,coachContext:context,
  why:`Hopeful 2.5-GPT — S3 Turn Plan Test: ${reused?'current evidence endorses the saved conditional task; ':''}${
   same(chosen,championInput)?label(answer.why):selected?.label||challenger.reason}`,trace};
}
// S4.33 decision-time reliability: the late stages (common turn pool, producers, audits) run up to this deadline. With
// 116 s, heavy positions finished at 105–111 s on slower hardware against Match Lab's 120 s module limit (R1 step 364).
// 104 s keeps a 16 s margin; the champion's own search is capped at 48 s and the planner's budget is unchanged (its
// reserve for the later stages drops from 60 s to 48 s with the deadline), so only late-stage search is trimmed.
// S4.34 T1: gate v11 failed C7 (max 112.8 s total at R1:364: coach 104.0 s at this finish + 8.8 s host turn-start
// pre-pass, which the coach cannot see). 96 s with the planner reserve cut by the same 8 s keeps the planner's budget;
// only late stages that are still running after ~80 s lose time (7 of 271 gate decisions exceeded 96 s).
const FINISH_MS=96000;
// S4.34 watchdog: a hard bound on the coach's OWN time inside the host's module window (the host's timer starts
// when the module worker is spawned, so a margin covers spawn, code load and trace serialisation). The pipeline's
// deadline normally ends work by FINISH_MS; the watchdog only matters when a stage overruns it (an engine call that
// cannot be interrupted, an un-timed await). It returns the champion's answer if one exists, else the host's listed
// built-in move, labelled as a watchdog answer — never presented as a normal search result. It cannot bound the
// host's own built-in pre-pass, which runs before this module starts (platform host.ts:364-381). It needs this
// module's event loop: a synchronous stretch of coach code delays it, and a host that computes a service call on its
// own thread (no engine pool) reads the answer only after that call returns.
const WATCHDOG_MS=112000,WATCHDOG_MARGIN=8000,WATCHDOG=Symbol('watchdog');
// Pipeline deadline and watchdog offsets for a host time limit. Review fix: the watchdog is never before the pipeline's
// own deadline (+1 s), so on a host granting < 112 s (e.g. 60 s) it still only catches overruns; at 120 s: 96 s / 112 s.
export function decisionWindows(limitMs=120000){
 const finishMs=Math.min(FINISH_MS,Math.max(1000,limitMs-3000));
 return {finishMs,watchdogMs:Math.min(WATCHDOG_MS,Math.max(finishMs+1000,limitMs-WATCHDOG_MARGIN))};
}
function watchdogAnswer(o,native,watch,t0,adapter){
 const old=previous(o),c=watch.champion;
 const timing={coachMs:Date.now()-t0,watchdog:{fired:true,source:c?'champion-answer':'host-built-in-incumbent'}};
 if(c?.answer?.input)return {input:c.answer.input,coachContext:envelope(c.context,null,c.stats),
  why:`Hopeful 2.5-GPT — S4.37 watchdog: the coach's own time limit was reached; the champion's engine-validated answer is returned without the later checks.`,
  trace:learningTraceForHost({coach:'Hopeful 2.5-GPT — S4.37 watchdog',timing,search:{services:adapter.snapshot()}})};
 const input=o.builtInChoice?.endTurn?{kind:'endTurn'}:(native||[]).find(x=>x&&(x.id??x.candidateId)===o.builtInChoice?.candidateId)?.input;
 if(!input)return null;
 return {input,coachContext:envelope(old?.champion??null,null,old?.stats??{}),
  why:'Hopeful 2.5-GPT — S4.37 watchdog: the coach\'s own time limit was reached before its search returned; the host-listed built-in move is returned.',
  trace:learningTraceForHost({coach:'Hopeful 2.5-GPT — S4.37 watchdog',timing,search:{services:adapter.snapshot()}})};
}
export async function chooseAction(o,native,rawServices){
 const t0=Date.now();
 const windows=decisionWindows(o.timeLimitMs||120000);
 const deadline=t0+windows.finishMs;
 const adapter=requestServices(rawServices,{deadline,requireOutcomeIdentity:true,requestId:o.requestId,resourceBudget:true});
 const watch={},hardAt=t0+windows.watchdogMs;
 let timer=null;
 const alarm=typeof setTimeout==='function'?new Promise(resolve=>{timer=setTimeout(()=>resolve(WATCHDOG),Math.max(1,hardAt-Date.now()));}):null;
 const raced=async work=>{if(!alarm)return work;const r=await Promise.race([work,alarm]);return r;};
 let answer;
 try{
  if(await raced(adapter.initialize().then(()=>null))===WATCHDOG){adapter.abort('watchdog');return watchdogAnswer(o,native,watch,t0,adapter);}
  answer=await raced(chooseBaseAction(o,native,adapter,watch));
  if(answer===WATCHDOG){adapter.abort('watchdog');return watchdogAnswer(o,native,watch,t0,adapter);}
 }finally{if(timer!==null&&typeof clearTimeout==='function')clearTimeout(timer);}
 if(!answer?.input)return answer;
 let learning;
 try{learning=await tacticalShadow(o,[answer.input,...(answer.trace?.commonComparison?.candidateInputs||[]),...(native||[]).map(c=>c.input),...(answer.repairDiagnostics?.candidates||[]).map(c=>c.input)],
  adapter.finalServices,{deadline:Math.min(deadline,Date.now()+250),selectedInput:answer.input});}
 catch(e){learning={mode:'shadow',override:false,ranked:false,reason:'TACTICAL_SHADOW_FAILED',error:String(e).slice(0,160)};}
 return {...answer,trace:learningTraceForHost({...answer.trace,tacticalLearning:learning,decisionAgreement:decisionAgreement(o,native,answer.input,answer.trace?.champion?.input),search:{...answer.trace?.search,services:adapter.snapshot()},
  timing:{coachMs:Date.now()-t0,watchdog:{fired:false}}})};
}
export async function chooseDecision(o,request,services){
 const old=previous(o),answer=await champion.chooseDecision(championObservation(o,old),request,services);
 const decisionContext=typeof answer==='object'?reviewedChampionContext(o,answer?.coachContext??old?.champion,old?.champion):old?.champion;
 const shared=builtinRuleChoice(o,request,old?.plan,IDENTITY)||clearanceRuleChoice(o,request,old?.plan,IDENTITY)||certifiedRuleChoice(o,request,old?.plan);
 const incumbent=shared?.optionId??(typeof answer==='string'?answer:answer?.optionId);
 let learning=null;
 if(request?.type==='blockDie'){
  try{learning=o.ruleset?.rulesEdition==='legacy'?learnedChoiceShadow(o,request,incumbent,!!shared):{mode:'shadow',attempted:false,override:false,reason:o.ruleset?.rulesEdition===undefined?'PUBLIC_RULES_EDITION_UNOBSERVED':'RULES_EDITION_OUTSIDE_ADMITTED_TRAINING_DOMAIN'};}
  catch{learning={mode:'shadow',attempted:false,override:false,reason:'learning-adapter-failed-incumbent-preserved'};}
 }
 if(shared)return {optionId:shared.optionId,why:'Hopeful 2.5-GPT — S3 Turn Plan Test: '+shared.reason,
  coachContext:envelope(decisionContext,old?.plan,old?.stats??{}),
  trace:{rulePolicy:{policy:shared.policy,certified:true,option:shared.optionId},...(learning?{learning}: {})}};
 // Preserve factual decision context. API2 transport compatibility must be
 // proven by the actual host; never silently discard state to obtain a pass.
 return typeof answer==='string'?answer:answer?{...answer,...(learning?{trace:{...answer.trace,learning}}:{}),
  coachContext:envelope(decisionContext,old?.plan??null,old?.stats??{})}:null;
}
export function chooseSetup(o,request){
 const setupObservation=championObservation(o,previous(o));
 const baseline=champion.chooseSetup(setupObservation,request);
 const answer=correctSetupBallRoles(setupObservation,request,baseline,inspect);
 return answer?{...answer,coachContext:envelope(answer.coachContext,null,{}),
  why:`Hopeful 2.5-GPT — S3 Turn Plan Test: ${label(answer.why)}`}:answer;
}
bloodboard.register({id:IDENTITY.coachId,name:'Hopeful S4.37U',version:IDENTITY.version,apiVersion:2,apiMinor:0,
 contextSchema:IDENTITY.contextSchema,timeLimitMs:120000,
 requires:['candidates','explore','sequence','threats.blitz','threats.scoring','progress','validate'],
 description:'Frozen engine-search-teacher V3 normal first-input preference proposals on the verified FAQ2026 public API (teacher training domain 7.0.1; runtime closed list retains three historical identities and adds unified 0.2.0 exact three-hash fingerprint; rules-repair-compatible; Glotl continuation corrected; no bit-exact equivalence claimed; any other runtime fingerprint keeps the learned path off), with the reviewed S4.19 complex dispatch floor for eligible own scoped calls. Old Handoff and blockDie references retain their separate original scope. Caller/source-qualified foreign retained Move time admission preserves original law parameters and refuses insufficient local or host headroom as unknown. Actual native chance, own-End, rule and common comparison certificates remain mandatory. Frozen champion and special scoring exits retained; experimental, no strength claim.',
 chooseAction,chooseDecision,chooseSetup});
