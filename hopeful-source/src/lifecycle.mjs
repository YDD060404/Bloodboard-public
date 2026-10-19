import {planView} from './execution.mjs';
/** Replanning is tied to an actual conditional graph reconciliation. In
 * particular, a retained pickup/handoff branch may change the carrier without
 * destroying its already verified successor. No simulated key is persisted. */
export function lifecycleReview(o,review,previousDrive){
 const r=review||{},paths=r.differencePaths||[];
 const matched=r.status==='candidate-ready';
 let level='turn',event='new-plan';
 if(matched){level='activation';event='expected-branch-progress';}
 else if(r.status==='awaiting-rule'){level='rule';event='awaiting-authoritative-rule-result';}
 else if(r.status==='completed'){level='turn';event='task-complete';}
 else if(r.reason==='scope-changed'){level='turn';event='new-turn-or-control-scope';}
 else if(r.reason==='identity-or-context-reset'){level='drive';event=r.reason;}
 else if(r.status==='invalidated'){
  event=paths.some(p=>/^ball(?:\.|$)/.test(p))?'unexpected-ball-transition':
   paths.some(p=>/^(teams|resources|rerolls|used)(?:\.|$)/.test(p))?'resource-change':
   paths.some(p=>/^players(?:\.|$)/.test(p))?'participant-or-board-change':r.reason;
 }
 const driveChanged=previousDrive&&(previousDrive.team!==o.team||previousDrive.half!==o.half||
  previousDrive.drive!==o.drive||previousDrive.format!==o.format);
 if(driveChanged){level='drive';event='new-drive-scope';}
 return {level,event,expectedProgress:matched&&!driveChanged,reason:r.reason||'no-conditional-plan',
  inputConfirmed:!!r.inputConfirmed,sourceConfirmed:!!r.sourceConfirmed,
  differencePaths:paths,task:matched?planView(r.plan)?.activeTask:null};
}
/** Existing drivePlan is the strategic layer: it already changes champion
 * window/lane valuation and controlled-delay decisions. This view connects it
 * to the executable dependency graph without pretending to add another planner. */
export function planningEvidence(drive,plan,review,chosen,source){
 const graph=planView(plan);
 return {driveIntent:drive?{objective:drive.driveUrgency,possession:drive.possession,
  primaryCarrier:drive.primaryCarrier,scoringWindow:drive.targetScoringWindow,
  defensiveObjective:drive.defensiveObjective,revisionReason:drive.revisionReason,windowRevision:drive.windowRevision??null,
  basis:'existing causal champion DriveIntent'}:null,
  turnPlan:graph?{id:graph.id,cursor:graph.cursor,status:graph.status,nodes:graph.tasks,
   edges:graph.edges,conditional:true,frontier:graph.frontier,guard:'exact public state, real validate, fresh common-horizon comparison'}:null,
  activationContract:graph?.activeTask??{actor:chosen?.playerId??null,action:chosen?.action??chosen?.kind,
   destination:chosen?.path?.at(-1)?.to??null,source,conditionalSuccessor:false},
  replan:review};
}

/** The frozen strategic builder may compute a later feasible target. Preserve
 * its actual value/target choice, but never describe a missed prior deadline as
 * an unchanged plan. This lifecycle record does not invent a score probability
 * or alter the protected champion's weights/search. */
export function reviewDriveIntent(o,current,previous){
 if(!current)return current;
 const sameScope=previous?.schema==='hopeful-drive/1'&&current.schema==='hopeful-drive/1'&&previous.team===current.team&&previous.half===current.half&&
  previous.drive===current.drive&&previous.format===current.format;
 const before=previous?.targetScoringWindow,after=current.targetScoringWindow;
 if(!sameScope||!before||!after)return current;
 const oldTarget=before.target,newTarget=after.target,earliest=after.earliest,carryEarliest=after.carryEarliest;
 if(![oldTarget,newTarget,earliest].every(Number.isFinite))return current;
 if(after.carryWithinHalf===false||Number.isFinite(carryEarliest)&&carryEarliest>after.latest){
  return {...current,revisionReason:'ordinary carry window no longer fits this half; scoring alternatives require fresh verification',
   windowRevision:{type:'ordinary-carry-window-closed',previousTarget:oldTarget,currentEarliest:earliest,unclampedCarryEarliest:carryEarliest,newTarget,
    observedTurn:o.turn?.[o.team]??null,originalReason:current.revisionReason,ordinaryCarryFeasible:false,
    reason:'clamped turn label does not create a feasible ordinary carry route',basis:'carry feasibility only; Pass/Handoff/other scoring routes remain unverified'}};
 }
 if(before.carryWithinHalf===false&&after.carryWithinHalf===true)return {...current,revisionReason:'ordinary carry window reopened by actual progress',
  windowRevision:{type:'ordinary-carry-window-reopened',previousTarget:oldTarget,currentEarliest:earliest,newTarget,observedTurn:o.turn?.[o.team]??null}};
 if(earliest>oldTarget||Number.isFinite(carryEarliest)&&carryEarliest>oldTarget){
  return {...current,revisionReason:'previous scoring window is no longer feasible; window explicitly revised',
   windowRevision:{type:'missed-scoring-window',previousTarget:oldTarget,currentEarliest:earliest,unclampedCarryEarliest:carryEarliest,newTarget,
    observedTurn:o.turn?.[o.team]??null,originalReason:current.revisionReason,
    reason:'current remaining movement and turns cannot reach the previous target',
    basis:'ordinary-movement feasibility estimate; not a future TD probability'}};
 }
 if(newTarget!==oldTarget)return {...current,windowRevision:{type:'strategic-window-revision',previousTarget:oldTarget,
  currentEarliest:earliest,newTarget,observedTurn:o.turn?.[o.team]??null,reason:current.revisionReason}};
 return previous.windowRevision?{...current,windowRevision:previous.windowRevision}:current;
}
export function reviewedChampionContext(o,current,previous){
 return current?.drivePlan?{...current,drivePlan:reviewDriveIntent(o,current.drivePlan,previous?.drivePlan)}:current;
}
