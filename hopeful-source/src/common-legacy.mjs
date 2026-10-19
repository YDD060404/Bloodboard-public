import {commonPool} from './common-boundary.mjs';
import {policyFrom,same,policyIdentity} from './policy.mjs';
import {buildProtectionPolicy,certifiedOwnEndPolicy,measureProtectionReplies,strictJointWinner} from './protection.mjs';
import {compareCarrierReplies} from './carrier-replies.mjs';

/** One final comparison frame for actual conditional policies. Source labels
 * and imitation logits carry no value or incumbent margin. Old endpoint/reply
 * units are retained for this architectural step; this is not full Turn EV. */
export async function compareLegacyCommonTurnPool(o,snapshot,current,extras,services,inspect,deadline,{learnedLine=null}={}){
 const started=Date.now(),until=Math.min(deadline,started+24000);
 const result={attempted:false,selected:null,reason:'common-turn-pool-unavailable',rows:[],bounds:[],
  horizon:'actual-own-End/opponent-start/v1',scope:'common conditional own policies and shared bounded replies in frozen units; complete opposing-Turn value and next-own opportunity still unverified',winnerIndex:-1};
 if(snapshot?.mode!=='normal'||!current?.input)return {...result,reason:'special-current-mode-preserved'};
 const pool=commonPool(o,snapshot,current,8,extras),own=[],currentId=policyIdentity(current);
 result.attempted=true;result.candidateCount=pool.length;
 // Fixed peer slots share the same deadline. No role receives privileged
 // missing-state acceptance; already certified evidence costs no extra slot.
 const slot=Math.min(4200,Math.max(0,Math.floor((until-started-8000)/Math.max(1,pool.length))));
 result.ownSlotMs=slot;
 for(const {line,source} of pool){
  const row={input:line.input,source,learnedProposal:line===learnedLine,currentFallback:currentId!==null&&policyIdentity(line)===currentId,policyVariant:line.policyVariant??'retained',ownComplete:false,reason:null};result.rows.push(row);
  const cert=certifiedOwnEndPolicy(line,o,inspect);let p;
  if(cert){p={complete:true,tree:line,endpoints:cert.endpoints,baseValue:cert.baseValue,policy:policyFrom(line,line.preparedBranches,o.team,inspect),calls:0};row.reusedOwnEnd=true;}
  else if(slot<500||until-Date.now()<8500){row.reason='common-own-slot-budget-unavailable';continue;}
  else p=await buildProtectionPolicy(o,line,services,inspect,Math.min(until-8000,Date.now()+slot),{extend:false,refineIncomplete:true});
  row.ownComplete=p.complete;row.reason=p.complete?'own-End-certified':p.reason;row.calls=p.calls;row.refinements=p.refinements;
  if(p.complete){row.baseValue=p.baseValue;row.ownIndex=own.length;own.push(p);}
 }
 if(!result.rows.some(r=>r.currentFallback&&r.ownComplete))return {...result,reason:'current-own-boundary-incomparable; fallback-is-not-a-winner',elapsedMs:Date.now()-started};
 if(own.length<2)return {...result,reason:'fewer-than-two-source-bound-own-policies',elapsedMs:Date.now()-started};
 const replyStart=Date.now(),carrierUntil=replyStart+Math.max(0,(until-replyStart)/2);
 result.replyBudget={availableMs:Math.max(0,until-replyStart),carrierShare:.5,measurementShare:.5};
 const replies=await compareCarrierReplies(o,own.map(p=>({input:p.tree.input,endpoints:p.endpoints})),services,inspect,carrierUntil);
 result.replyDomain={reason:replies.reason,discoveryIncomplete:replies.discoveryIncomplete,issues:replies.discoveryIssues,count:replies.domain?.length,scope:replies.scope};
 result.replies=replies.policies;
 if(replies.policies?.length!==own.length||replies.policies.some((p,i)=>!same(p.input,own[i].tree.input)))
  return {...result,reason:'common-reply-policy-source-mismatch',elapsedMs:Date.now()-started};
 // Unchecked position/critical effects cannot be silently valued as zero.
 // Crucially, measure EVERY peer before rejecting incomplete coverage: the
 // current/champion receives the same quality requirements as all others.
 const measured=[];
 for(let i=0;i<own.length;i++)measured.push(await measureProtectionReplies(o,own[i],services,inspect,
  Math.min(until,Date.now()+Math.max(0,(until-Date.now())/(own.length-i)))));
 result.replyMeasurements=measured;
 for(const row of result.rows)if(row.ownIndex!==undefined){const i=row.ownIndex,r=replies.policies[i],m=measured[i];row.replyUnknown=r.unknown;row.measuredUnknown=m.unknownMass;row.replyReasons=m.reasons;
  if(!m.complete||r.unknown>1e-8)row.reason='common-replies-incomplete';else row.reason='common-evidence-ready';}
 if(measured.some(m=>!m.complete)||replies.policies.some(r=>r.unknown>1e-8))
  return {...result,reason:'common-peer-replies-incomplete; fallback-is-not-a-winner',elapsedMs:Date.now()-started};
 result.bounds=own.map((p,i)=>({lower:p.baseValue-Math.max(replies.policies[i].harmUpper,-measured[i].criticalAdjustment)+measured[i].positionAdjustment,
  upper:p.baseValue-Math.max(replies.policies[i].harmLower,-measured[i].criticalAdjustment)+measured[i].positionAdjustment}));
 result.winnerIndex=strictJointWinner(result.bounds,.5);
 if(result.winnerIndex<0)return {...result,reason:'common-policy-intervals-overlap; fallback-is-not-a-winner',elapsedMs:Date.now()-started};
 const i=result.winnerIndex,p=own[i],r=replies.policies[i],m=measured[i];
 return {...result,reason:'strict-common-policy-winner-in-frozen-units',elapsedMs:Date.now()-started,
  selectedLearnedProposal:result.rows.some(row=>row.ownIndex===i&&row.learnedProposal),
  selected:{...p.tree,baseValue:p.baseValue,value:result.bounds[i].lower,unknown:p.policy.unknown,preparationGain:0,
   terminalScoreMass:p.policy.ex.pTouchdown,replyAttempted:true,observedReplyMass:1,checkedReplyMass:1,boundedReplyMass:1,
   criticalReplyAdjustment:-Math.max(r.harmUpper,-m.criticalAdjustment),positionReplyAdjustment:m.positionAdjustment}};
}
