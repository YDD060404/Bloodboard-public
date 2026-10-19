import {same} from './policy.mjs';
import {certifiedOwnEndPolicy,strictJointWinner} from './protection.mjs';
import {compareReceiverThreats} from './receiver-defense.mjs';
import {endpointValuePoint} from './endpoint-value.mjs';
const EPS=1e-8;
/** Finite-domain observations give a lower witness. They cannot bound omitted
 * opponent policies: a current opposing Turn can still score with probability1.
 * Unknown widens both competitors, rather than granting an incumbent victory. */
export function scoringValueIntervals(values,policies,cost){
 if(!Array.isArray(values)||values.length<2||!Array.isArray(policies)||policies.length!==values.length||
  !Number.isFinite(cost)||cost<0||values.some(v=>!Number.isFinite(v))||policies.some(p=>
   !Number.isFinite(p?.lower)||!Number.isFinite(p?.upper)||p.lower<0||p.upper>1+EPS||p.lower>p.upper+EPS))
  return {valid:false,reason:'scoring-interval-contract-invalid'};
 const bounds=values.map((v,i)=>({lower:v-cost,upper:v-cost*policies[i].lower}));
 return {valid:true,bounds,winnerIndex:strictJointWinner(bounds,.5),
  opponentTD:policies.map(p=>({lower:p.lower,upper:1,finiteUpper:Math.min(1,p.upper),outsideDomainUnverified:true})),
  scope:'known own-End value minus opposing-Turn TD cost; outside finite domain upper1; material/position and next-own opportunity unpriced, not full match value'};
}
export async function compareSharedScoring(o,own,services,inspect,deadline){
 const result={attempted:false,reason:'shared-scoring-endpoint-domain-unavailable'};
 if(!Array.isArray(own)||own.length<2||own.some(p=>!p.complete||!certifiedOwnEndPolicy(p.tree,o,inspect)))
  return {...result,reason:'shared-scoring-own-source-certificate-unavailable'};
 const opp=o.team==='A'?'B':'A';
 if(!Number.isInteger(o.pitch?.endZone?.[opp]))return {...result,reason:'shared-scoring-public-goal-unavailable'};
 for(const p of own)for(const b of p.endpoints){
  const ob=b.observation,h=ob?.players?.find(p=>p.id===ob.ball?.playerId);
  if(b.touchdown||ob?.phase==='fullTime'||!b.key||b.active!==opp||ob?.active!==opp||ob?.ball?.kind!=='held'||h?.team!==opp)
   return {...result,reason:'shared-scoring-not-common-opponent-held-boundary'};
 }
 const started=Date.now();result.attempted=true;
 const replies=await compareReceiverThreats(o,own.map(p=>({input:p.tree.input,complete:true,states:p.endpoints})),services,deadline,
  {valueEndState:b=>endpointValuePoint(b,o,inspect)});
 result.replyDomain={reason:replies.reason,calls:replies.calls,discoveryIncomplete:replies.discoveryIncomplete,
  count:replies.domain.length,scope:replies.scope,nextOwnOpportunity:replies.nextOwnOpportunity,transferDiscovery:replies.transferDiscovery,transferWork:replies.transferWork};
 if(replies.policies.length!==own.length||replies.policies.some((p,i)=>!same(p.input,own[i].tree.input)))
  return {...result,reason:'shared-scoring-policy-source-mismatch',elapsedMs:Date.now()-started};
 const intervals=scoringValueIntervals(own.map(p=>p.baseValue),replies.policies,inspect.CFG.opponentScore);
 return {...result,...intervals,policies:replies.policies,endpointValueAudit:replies.endpointValueAudit,elapsedMs:Date.now()-started,
  reason:!intervals.valid?intervals.reason:intervals.winnerIndex<0?'shared-scoring-intervals-overlap':'shared-scoring-metric-winner-with-unpriced-effects',
  executionCertified:false};
}
