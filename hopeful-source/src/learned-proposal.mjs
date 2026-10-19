import {tacticalShadow} from './tactical-shadow.mjs';
import {same} from './policy.mjs';
import {buildProtectionPolicy,certifiedOwnEndPolicy,certifiedOwnEndSelection,measureProtectionReplies,strictJointWinner} from './protection.mjs';
import {compareCarrierReplies} from './carrier-replies.mjs';
import {compareSharedScoring} from './scoring-intervals.mjs';
const prepared=new WeakMap();
const proposed=new WeakMap();
async function bindProposal(o,result,services,inspect,deadline){
 const report=result.report,first=inspect.canonical({input:report.input},o);
 if(!first){report.reason='learned-input-canonicalization-failed';return result;}
 const policy=await buildProtectionPolicy(o,{...first,label:'Fixed learned first-input proposal'},services,inspect,
  Math.min(deadline,Date.now()+4200),{extend:false});
 report.ownComplete=policy.complete;report.ownReason=policy.reason??'actual-own-End-and-builtin-rule-map-bound';
 report.ownCalls=policy.calls;report.ruleCalls=policy.ruleCalls??0;
 if(policy.ruleAudit)report.ruleAudit=policy.ruleAudit;
 if(policy.rootEvidence){result.line=policy.rootEvidence;const e=policy.rootEvidence.ex;report.ownMass={listed:e.outcomes.reduce((sum,b)=>sum+b.p,0),rest:e.rest?.p,unresolved:e.unresolvedMass,exact:e.exact};}
 report.reason=policy.complete?'learned-policy-awaits-common-comparison':'learned-own-policy:'+report.ownReason;
 if(policy.complete){result.line=policy.tree;prepared.set(result,{root:JSON.stringify(o),inspect,policy});}
 return result;
}

/** First-input imitation proposes one legal strategy; it never prices safety.
 * Bind its actual own-End and builtin offers before the incumbent consumes
 * this request's position cap. The certificate is request/source local. */
export async function prepareLearnedProposal(o,native,services,inspect,deadline){
 const start=Date.now(),report={attempted:false,ranked:false,generated:false,ownComplete:false,
  reason:'learned-proposal-not-admitted',timing:'before-champion-search',elapsedMs:0};
 const result={report,line:null};
 if(deadline-Date.now()<6000){report.reason='learned-early-budget-unavailable';return result;}
 const learning=await tacticalShadow(o,[...(native||[]).map(c=>c.input),{kind:'endTurn'}],services,
  {deadline:Math.min(deadline,Date.now()+250)});
 report.learning=learning;report.ranked=learning.ranked===true;report.attempted=report.ranked;
 if(!learning.ranked||!learning.reference_input){report.reason=learning.reason;report.elapsedMs=Date.now()-start;return result;}
 report.generated=true;report.input=learning.reference_input;
 proposed.set(result,{root:JSON.stringify(o),inspect,input:JSON.stringify(report.input)});
 const opp=o.team==='A'?'B':'A';
 if(Number.isFinite(o.turnsPerHalf)&&o.turnsPerHalf>0&&Number.isFinite(o.turn?.[o.team])&&
  o.turn[o.team]>=o.turnsPerHalf&&Number.isFinite(o.score?.[o.team])&&Number.isFinite(o.score?.[opp])&&o.score[o.team]<=o.score[opp]){
  report.bindingDeferred=true;report.reason='learned-own-binding-awaits-final-opportunity-selection';
 }else await bindProposal(o,result,services,inspect,deadline);
 report.elapsedMs=Date.now()-start;
 return result;
}

/** Deferred learned proposals enter the common pool only with the same private
 * root/model proposal provenance and actual own-End certificate as early ones. */
export async function bindLearnedForCommonPool(o,snapshot,proposal,services,inspect,deadline){
 if(!proposal?.report.generated||snapshot?.mode!=='normal')return null;
 const origin=proposed.get(proposal);
 if(!origin||origin.root!==JSON.stringify(o)||origin.inspect!==inspect||origin.input!==JSON.stringify(proposal.report.input)){
  proposal.report.reason='learned-source-certificate-mismatch';return null;
 }
 if(proposal.report.bindingDeferred){
  if(deadline-Date.now()<7300){proposal.report.reason='learned-deferred-binding-budget-unavailable';return null;}
  proposal.report.bindingDeferred=false;proposal.report.bindingTiming='before-common-turn-selection';
  await bindProposal(o,proposal,services,inspect,deadline-3000);
 }
 const held=prepared.get(proposal);
 return held?.policy.tree===proposal.line&&same(proposal.line?.input,proposal.report.input)&&
  certifiedOwnEndPolicy(proposal.line,o,inspect)?proposal.line:null;
}

/** Compare to the final current strategy after ordinary modules have had
 * their opportunity. Both roles use the same End boundary, reply categories,
 * units and strict interval winner. Learned logits do not enter the value. */
export async function compareLearnedProposal(o,snapshot,proposal,services,inspect,deadline){
 const start=Date.now(),until=Math.min(deadline,start+12000);
 const result={attempted:false,selected:null,reason:'learned-proposal-not-generated',policies:[],
  policyScope:'actual-own-End/shared carrier replies and bounded critical reply; fixed endpoint units, no imitation-score value bonus'};
 if(!proposal?.report.generated)return result;
 if(snapshot?.mode!=='normal')return {...result,reason:'learned-special-current-selection-preserved'};
 if(same(snapshot?.selected?.input,proposal.report.input))return {...result,reason:'learned-input-identical-to-current'};
 if(proposal.report.bindingDeferred){
  const origin=proposed.get(proposal);
  if(!origin||origin.root!==JSON.stringify(o)||origin.inspect!==inspect||origin.input!==JSON.stringify(proposal.report.input))
   return {...result,reason:'learned-source-certificate-mismatch'};
  if(until-Date.now()<7300)return {...result,reason:'learned-deferred-binding-budget-unavailable'};
  proposal.report.bindingDeferred=false;proposal.report.bindingTiming='after-normal-current-selection';
  await bindProposal(o,proposal,services,inspect,until-3000);
 }
 const held=prepared.get(proposal);
 if(!held||held.root!==JSON.stringify(o)||held.inspect!==inspect||!certifiedOwnEndPolicy(proposal.line,o,inspect))
  return {...result,reason:proposal.report.ownComplete?'learned-source-certificate-mismatch':proposal.report.reason};
 if(until-Date.now()<4300||!snapshot.selected?.input)return {...result,reason:'learned-common-comparison-budget-or-current-unavailable'};
 result.attempted=true;
 const incumbent=await buildProtectionPolicy(o,snapshot.selected,services,inspect,until-3000,{extend:false});
 result.currentOwn={complete:incumbent.complete,reason:incumbent.reason,calls:incumbent.calls,ruleAudit:incumbent.ruleAudit};
 if(!incumbent.complete)return {...result,reason:'current-own-policy:'+incumbent.reason};
 const own=[incumbent,held.policy],replies=await compareCarrierReplies(o,own.map(p=>({input:p.tree.input,endpoints:p.endpoints})),services,inspect,until);
 result.scoringIntervals=await compareSharedScoring(o,own,services,inspect,until);
 result.replyDomain={reason:replies.reason,discoveryIncomplete:replies.discoveryIncomplete,issues:replies.discoveryIssues,
  count:replies.domain?.length,budget:replies.budget,preparationWork:replies.preparationWork};
 result.policies=own.map((p,i)=>({input:p.tree.input,baseValue:p.baseValue,role:i?'learned':'current',reply:replies.policies?.[i]}));
 if(replies.policies?.length!==2||replies.policies.some((p,i)=>!same(p.input,own[i].tree.input)||p.unknown>1e-8))
  return {...result,reason:'learned-shared-reply-domain-incomplete'};
 const measured=[];
 for(let i=0;i<own.length;i++)measured.push(await measureProtectionReplies(o,own[i],services,inspect,
  Math.min(until,Date.now()+Math.max(0,(until-Date.now())/(own.length-i))),{diagnostics:true}));
 result.replyMeasurements=measured;
 if(measured.some(r=>!r.complete))return {...result,reason:'learned-shared-boundary-replies-incomplete'};
 const bounds=own.map((p,i)=>({lower:p.baseValue-Math.max(replies.policies[i].harmUpper,-measured[i].criticalAdjustment)+measured[i].positionAdjustment,
  upper:p.baseValue-Math.max(replies.policies[i].harmLower,-measured[i].criticalAdjustment)+measured[i].positionAdjustment}));
 result.bounds=bounds;result.elapsedMs=Date.now()-start;
 const winner=strictJointWinner(bounds,.5);
 if(winner!==1)return {...result,reason:winner===0?'current-is-strict-common-winner':'learned-no-strict-common-winner'};
 const p=own[1],r=replies.policies[1],m=measured[1];
 return {...result,reason:'learned-strict-source-bound-policy-improvement',selected:certifiedOwnEndSelection(p.tree,{baseValue:p.baseValue,value:bounds[1].lower,
  unknown:p.policy.unknown,preparationGain:0,terminalScoreMass:p.policy.ex.pTouchdown,
  replyAttempted:true,observedReplyMass:1,checkedReplyMass:1,boundedReplyMass:1,
  criticalReplyAdjustment:-Math.max(r.harmUpper,-m.criticalAdjustment),positionReplyAdjustment:m.positionAdjustment},o,inspect)};
}
