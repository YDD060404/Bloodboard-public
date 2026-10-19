import {commonPool} from './common-boundary.mjs';
import {policyFrom,same,policyIdentity} from './policy.mjs';
import {buildProtectionPolicy,certifiedOwnEndPolicy,certifiedOwnEndSelection,strictJointWinner} from './protection.mjs';
import {compareLegacyCommonTurnPool} from './common-legacy.mjs';
import {compareOpponentEndValues} from './opponent-end-values.mjs';
import {withServiceOwner,recordServiceObservation} from './services.mjs';

/** Real endpoints in one explicit utility frame. Source labels and imitation
 * logits have no value or incumbent margin. Unknown replies widen intervals
 * on both sides instead of vetoing every partially searched comparison. */
export async function compareCommonTurnPool(o,snapshot,current,extras,services,inspect,deadline,{learnedLine=null,valueMode='bounded-terminal',comparisonScope='global',ledger=null,extraOrigins=[]}={}){
 if(valueMode==='legacy-completeness')return compareLegacyCommonTurnPool(o,snapshot,current,extras,services,inspect,deadline,{learnedLine});
 const started=Date.now(),until=Math.min(deadline,started+24000);
 const result={attempted:false,selected:null,reason:'common-turn-pool-unavailable',rows:[],bounds:[],
  horizon:'actual-own-End/opponent-start/v1',scope:'common conditional own policies and shared bounded replies in frozen units; complete opposing-Turn value and next-own opportunity still unverified',winnerIndex:-1,selectedIndex:-1,selectedCandidateId:null,selectionBasis:null};
 if(snapshot?.mode!=='normal'||!current?.input)return {...result,reason:'special-current-mode-preserved'};
 const pool=commonPool(o,snapshot,current,8,extras,{ledger,extraOrigins,run:'formal'}),own=[],currentId=policyIdentity(current);
 result.attempted=true;result.candidateCount=pool.length;result.pruned=pool.omitted;
 if(pool.poolRunId)result.poolRunId=pool.poolRunId;
 // Fixed peer slots share the same deadline. No role receives privileged
 // missing-state acceptance; already certified evidence costs no extra slot.
 const slot=Math.min(4200,Math.max(0,Math.floor((until-started-8000)/Math.max(1,pool.length))));
 result.ownSlotMs=slot;
 for(const {line,source,candidateId,inputId} of pool){
  const row={candidateId:candidateId??'formal/'+String(o.requestId??'unavailable')+'/'+result.rows.length,...(inputId?{inputId}:{}),input:line.input,source,learnedProposal:line===learnedLine,currentFallback:currentId!==null&&policyIdentity(line)===currentId,policyVariant:line.policyVariant??'retained',ownComplete:false,reason:null};result.rows.push(row);
  const phase=ledger?.phase({poolRunId:result.poolRunId??null,candidateId:row.candidateId,phase:'formal-own',allocatedSlotMs:slot,localDeadline:null}),phaseStarted=phase?Date.now():null;
  const scoped=phase?withServiceOwner(services,phase.owner):services;
  if(phase){row.ownPhaseId=phase.phaseId;phase.finish({serviceCostsObserved:recordServiceObservation(scoped,{method:'phase',status:'phase-enter'})});}
  try{
  const cert=certifiedOwnEndPolicy(line,o,inspect);let p;
  if(cert){p={complete:true,tree:line,endpoints:cert.endpoints,baseValue:cert.baseValue,policy:policyFrom(line,line.preparedBranches,o.team,inspect),calls:0};row.reusedOwnEnd=true;}
  else if(slot<500||until-Date.now()<8500){row.reason='common-own-slot-budget-unavailable';continue;}
  else {const localDeadline=Math.min(until-8000,Date.now()+slot);phase?.finish({localDeadline});p=await buildProtectionPolicy(o,line,scoped,inspect,localDeadline,{extend:false,refineIncomplete:true});}
  row.ownComplete=p.complete;row.reason=p.complete?'own-End-certified':p.reason;row.calls=p.calls;row.refinements=p.refinements;
  if(p.complete){row.baseValue=p.baseValue;row.ownIndex=own.length;own.push(p);}
  }finally{phase?.finish({status:row.ownComplete?'certified':row.reason?'incomplete':'exception',reason:row.reason??'own-phase-exception',elapsedMs:Date.now()-phaseStarted,reusedCertificate:row.reusedOwnEnd===true,reportedCalls:row.calls??null,reportedRefinements:row.refinements??null});}
 }
 if(!result.rows.some(r=>r.currentFallback&&r.ownComplete))return {...result,reason:'current-own-boundary-incomparable; fallback-is-not-a-winner',elapsedMs:Date.now()-started};
 if(own.length<2)return {...result,reason:'fewer-than-two-source-bound-own-policies',elapsedMs:Date.now()-started};
 const diagnosticOwners=own.map((p,i)=>({poolRunId:result.poolRunId??null,candidateId:result.rows.find(r=>r.ownIndex===i)?.candidateId??null}));
 const frame=await compareOpponentEndValues(o,own,services,inspect,until,{valueMode,comparisonScope,ledger,diagnosticOwners});
 result.endpointFrame=frame;result.bounds=frame.bounds;result.valueMode=valueMode;
 result.horizon=frame.horizon;result.scope=frame.scope;
 for(const row of result.rows)if(row.ownIndex!==undefined){const p=frame.policies[row.ownIndex];
  row.endpointInterval=frame.bounds[row.ownIndex];row.replyUnknown=p?.unknownChanceMass;
  row.outsidePoliciesUnverified=p?.outsidePoliciesUnverified;row.replyReasons=p?.reasons;
  if(frame.phaseIds)row.replyPhaseId=frame.phaseIds[row.ownIndex];
  row.reason=frame.valid?'common-endpoint-interval-ready':'common-endpoint-frame-unavailable';
 }
 if(frame.stoppedRPC)return {...result,reason:frame.stoppedRPC.code==='coach-resource-budget'?'common-reply-resource-budget-stopped; fallback-is-not-a-winner':'common-reply-RPC-failure-stopped; fallback-is-not-a-winner',elapsedMs:Date.now()-started};
 if(!frame.valid)return {...result,reason:frame.reason,elapsedMs:Date.now()-started};
 if(comparisonScope==='finite-common'&&!frame.finiteDomainComparable)return {...result,reason:'shared-finite-reply-domain-incomplete; fallback-is-not-a-winner',elapsedMs:Date.now()-started};
 result.winnerIndex=comparisonScope==='finite-common'?finiteDomainWinner(result.bounds,own,frame.policies):strictJointWinner(result.bounds,.5);
 if(comparisonScope==='finite-common'){
  result.comparisonEvidence=finiteDomainEvidence(result.bounds,own,frame.policies);
  for(const row of result.rows)if(row.ownIndex!==undefined)row.comparisonGate=result.comparisonEvidence.rows[row.ownIndex];
 }
 let i=result.winnerIndex;
 if(i<0&&comparisonScope==='finite-common'){
  const gate=certifiedCurrentImprovement(frame,own,[current,snapshot.selected]);
  result.protectedCurrentGate=gate;result.protectedAnchorIndices=gate.protectedAnchorIndices;
  if(gate.selectedIndex>=0){i=gate.selectedIndex;result.selectionBasis='strict-protected-current-improvement';}
 }
 if(i<0)return {...result,reason:'common-strict-peer-gate-not-met; fallback-is-not-a-winner',elapsedMs:Date.now()-started};
 result.selectedIndex=i;result.selectedCandidateId=result.rows.find(row=>row.ownIndex===i)?.candidateId??null;
 if(result.winnerIndex>=0)result.selectionBasis='strict-all-peer-winner';
 const p=own[i],m=frame.policies[i];
 return {...result,reason:result.winnerIndex<0?'strict-protected-current-improvement; not-all-peer-unique-winner; outside-policies-unverified':comparisonScope==='finite-common'?'strict-shared-finite-domain-winner; outside-policies-unverified':'strict-common-endpoint-utility-winner',elapsedMs:Date.now()-started,
  ...(result.winnerIndex>=0?{winnerCandidateId:result.selectedCandidateId}:{}),
  selectedLearnedProposal:result.rows.some(row=>row.ownIndex===i&&row.learnedProposal),
  selected:certifiedOwnEndSelection(p.tree,{baseValue:p.baseValue,value:p.baseValue,unknown:p.policy.unknown,preparationGain:0,
   terminalScoreMass:p.policy.ex.pTouchdown,replyAttempted:true,observedReplyMass:m.knownEndMass,
   checkedReplyMass:m.outsidePoliciesUnverified?0:m.knownEndMass,boundedReplyMass:m.outsidePoliciesUnverified?0:1,
   endpointComparison:{valueMode,lower:result.bounds[i].lower,upper:result.bounds[i].upper,
    comparisonScope,selectionBasis:result.selectionBasis,domainId:frame.domainId,globalBounds:frame.globalBounds?.[i],finiteUnknownChanceMass:m.finiteUnknownChanceMass,horizon:frame.horizon,cost:m.cost,outsidePoliciesUnverified:m.outsidePoliciesUnverified},
   valueScope:'value/baseValue retain legacy own-End bookkeeping; selection uses separately named endpointComparison utility'},o,inspect)};
}

/** A shared finite frame can prove improvement over both protected policies
 * without establishing an order between overlapping alternatives. All peer
 * uncertainty stays in the frame; only the original strict margin is reused. */
export function certifiedCurrentImprovement(frame,own,anchors){
 const result={valid:false,selectedIndex:-1,protectedAnchorIndices:[],rows:[],reason:'protected-current-frame-unverified',scope:'strict improvement over actual current and original champion in the shared finite domain; not an all-peer unique winner; outside policies unverified'};
 if(frame?.comparisonScope!=='finite-common'||frame.valid!==true||frame.finiteDomainComparable!==true||frame.domainDiscoveryComplete!==true||frame.stoppedRPC)return result;
 const evidence=finiteDomainEvidence(frame.bounds,own,frame.policies);
 if(!evidence.valid||own.some(p=>p.complete!==true||!same(p.policy.input,p.tree?.input)||p.policy.ex.pTurnover<0||p.policy.ex.pTurnover>1+1e-8)||frame.policies.some((m,i)=>m.finiteDomainComparable!==true||m.finiteUnknownChanceMass<0||m.finiteUnknownChanceMass>1+1e-8||!same(m.input,own[i].tree?.input)))return result;
 const identities=own.map(p=>policyIdentity(p.tree));
 if(identities.some(id=>id===null))return {...result,reason:'protected-current-policy-identity-unverified'};
 if(!Array.isArray(anchors)||anchors.length!==2)return {...result,reason:'protected-current-anchor-unverified'};
 for(const anchor of anchors){
  const identity=policyIdentity(anchor),matches=identities.flatMap((id,i)=>identity!==null&&id===identity?[i]:[]);
  if(matches.length!==1)return {...result,reason:'protected-current-anchor-missing-or-incomparable'};
  if(!result.protectedAnchorIndices.includes(matches[0]))result.protectedAnchorIndices.push(matches[0]);
 }
 result.valid=true;result.rows=evidence.rows.map(row=>{
  const peers=row.peers.filter(peer=>result.protectedAnchorIndices.includes(peer.peerIndex));
  return {ownIndex:row.ownIndex,passed:!result.protectedAnchorIndices.includes(row.ownIndex)&&peers.length===result.protectedAnchorIndices.length&&peers.every(peer=>peer.passed),peers};
 });
 const eligible=result.rows.filter(row=>row.passed).map(row=>row.ownIndex);
 // Full policy identity includes actual conditional dependencies. A source
 // label or admission order cannot break an equal-lower-bound tie.
 eligible.sort((a,b)=>frame.bounds[b].lower-frame.bounds[a].lower||(identities[a]<identities[b]?-1:identities[a]>identities[b]?1:0));
 result.selectedIndex=eligible[0]??-1;
 return {...result,reason:result.selectedIndex<0?'protected-current-strict-margins-not-met':'strict-protected-current-improvement'};
}

/** Every peer faces the same preserved legacy margin and incremental risk cost.
 * Domain-external uncertainty is reported, never claimed solved by this gate. */
export function finiteDomainWinner(bounds,own,measurements){
 if(bounds.length<2||bounds.some(b=>!Number.isFinite(b.lower)||!Number.isFinite(b.upper)||b.lower>b.upper))return -1;
 return bounds.findIndex((b,i)=>bounds.every((other,j)=>{
  if(i===j)return true;
  const c=own[i].policy,peer=own[j].policy;
  const margin=(c.ex.pTurnover<=1e-8&&c.input.kind!=='endTurn'?.5:4)+
   Math.max(0,c.ex.pTurnover-peer.ex.pTurnover)*30+
   Math.max(0,measurements[i].finiteUnknownChanceMass-measurements[j].finiteUnknownChanceMass)*120;
  return b.lower>other.upper+margin;
 }));
}

/** Diagnostic expansion of the existing strict peer comparisons. This does
 * not select a policy or reinterpret missing evidence as zero. */
export function finiteDomainEvidence(bounds,own,measurements){
 const valid=Array.isArray(bounds)&&bounds.length>=2&&own?.length===bounds.length&&measurements?.length===bounds.length&&
  bounds.every(b=>Number.isFinite(b?.lower)&&Number.isFinite(b?.upper)&&b.lower<=b.upper)&&
  own.every(p=>Number.isFinite(p?.policy?.ex?.pTurnover)&&p?.policy?.input)&&measurements.every(m=>Number.isFinite(m?.finiteUnknownChanceMass));
 if(!valid)return {valid:false,reason:'comparison-evidence-input-unverified',rows:[]};
 const rows=bounds.map((b,i)=>{
  const c=own[i].policy,peers=bounds.flatMap((other,j)=>{
   if(i===j)return [];const peer=own[j].policy;
   const baseMargin=c.ex.pTurnover<=1e-8&&c.input.kind!=='endTurn'?.5:4,turnoverIncrement=Math.max(0,c.ex.pTurnover-peer.ex.pTurnover)*30,unknownIncrement=Math.max(0,measurements[i].finiteUnknownChanceMass-measurements[j].finiteUnknownChanceMass)*120;
   const margin=baseMargin+turnoverIncrement+unknownIncrement,passed=b.lower>other.upper+margin;
   const reasons=[];
   if(!passed){
    if(!(b.lower>other.upper))reasons.push('candidate-lower-not-above-peer-upper');
    if(!(b.lower>other.upper+baseMargin))reasons.push('legacy-evidence-margin-not-met');
    if(turnoverIncrement>0&&!(b.lower>other.upper+baseMargin+turnoverIncrement))reasons.push('turnover-increment-margin-not-met');
    if(unknownIncrement>0&&!(b.lower>other.upper+margin))reasons.push('unknown-increment-margin-not-met');
   }
   return [{peerIndex:j,lower:b.lower,peerUpper:other.upper,gap:b.lower-other.upper,intervalsIntersect:b.lower<=other.upper&&other.lower<=b.upper,baseMargin,turnoverIncrement,unknownIncrement,requiredMargin:margin,passed,reasons,primaryReason:passed?'strict-peer-gate-passed':reasons[0]??'strict-peer-gate-not-met'}];
  });
  const failed=peers.filter(p=>!p.passed),reasons=[...new Set(failed.flatMap(p=>p.reasons))];
  return {ownIndex:i,passed:failed.length===0,peers,reasons,primaryReason:failed[0]?.primaryReason??'all-strict-peer-gates-passed'};
 });
 return {valid:true,scope:'existing strict finite-domain gate in legacy units; outside-domain risk remains unverified; diagnostic only',rows};
}
