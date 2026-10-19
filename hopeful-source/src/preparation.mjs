import {withExploreDeadline} from './bounded-reply.mjs';
import {discoverPickupProtection} from './pickup-protection.mjs';
import {same,completeAction,policyFrom,weightedPolicyValue,endorseContinuation} from './policy.mjs';
const n=(x,d=0)=>Number.isFinite(x)?x:d;
/** Reorder a preparation already found by the champion. This is not a reward
 * for doing more actions. Compare pickup->escort and escort->pickup over the
 * same two-input horizon, including pickup failure and actual opponent replies. */
export async function protectBeforePickup(o,selected,services,inspect,deadline){
 if(!selected?.preparedBranches?.size)return discoverPickupProtection(o,selected,services,inspect,deadline);
 const result={selected:null,attempted:false,reason:'not-a-comparable-pickup-policy'};
 if(o.ball?.kind!=='ground'||!selected?.preparedBranches?.size||o.activation||
    !['move','secure'].includes(selected.input?.action)||!completeAction(selected.ex,o.team)||
    selected.ex.outcomes.some(b=>b.touchdown)||!selected.ex.outcomes.some(b=>
     !b.turnover&&b.observation?.ball?.kind==='held'&&b.observation.ball.playerId===selected.input.playerId))return result;
 if([...selected.preparedBranches.values()].some(f=>f.preparedBranches?.size||f.plan?.recovery?.plans?.length))
  return {...result,reason:'additional-dependencies-not-a-two-input-reorder'};
 const preparations=[...selected.preparedBranches.values()].filter(p=>
  p.plan?.input?.action==='move'&&p.plan.input.playerId!==selected.input.playerId&&
  !p.plan.input.blockTarget&&!p.plan.input.blitzTarget&&completeAction(p.ex,o.team)&&n(p.ex.pTurnover)<1e-8);
 const follow=preparations[0];if(!follow||deadline-Date.now()<2000)return result;
 result.attempted=true;
 const left=()=>deadline-Date.now(),cap=(ms=700)=>Math.max(50,Math.min(ms,left()-100));
 const explore=async(input,from)=>left()>150?services.explore(input,{coachEnumerationDeadline:deadline,...(from?{from}:{}),observations:true,
  decisions:'builtin',perspective:o.team,threshold:0.00001,maxOutcomes:40,maxLeaves:3000,maxKeep:256,maxMs:cap()}):null;
 const helper=follow.plan.input;
 const prep=await explore(helper);
 if(!completeAction(prep,o.team)||n(prep.pTurnover)>1e-8||prep.outcomes.length!==1||prep.outcomes[0].p<1-1e-8||
  !prep.outcomes[0].key||prep.outcomes[0].observation?.ball?.kind!=='ground')return {...result,reason:'preparation-is-not-certified-roll-free'};
 const child=await explore(selected.input,prep.outcomes[0].key);
 if(!completeAction(child,o.team))return {...result,reason:'reordered-pickup-has-unresolved-or-illegal-outcomes'};
 const original=policyFrom(selected,selected.preparedBranches,o.team,inspect);
 const challenger=policyFrom({input:helper,ex:prep},new Map([[prep.outcomes[0].key,
  {plan:{input:selected.input},ex:child}]]),o.team,inspect);
 if(!completeAction(original.ex,o.team)||!completeAction(challenger.ex,o.team)||
  challenger.ex.pTurnover>original.ex.pTurnover+1e-8||challenger.ex.pTouchdown+1e-8<original.ex.pTouchdown)
  return {...result,reason:'reordering-worsens-known-risk-or-score-probability'};
 const evaluate=async(policy)=>{
  const line={...policy,family:'move',baseValue:weightedPolicyValue(policy,o,inspect),preparationGain:0,
   terminalScoreMass:inspect.observedTerminalScore(policy.ex,o.team,o),reply:[],checkedReplyMass:0,
   observedReplyMass:0,boundedReplyMass:0,replyAttempted:true,criticalReplyAdjustment:0,positionReplyAdjustment:0};
  const branches=policy.ex.outcomes.filter(b=>b.key&&b.observation&&!b.touchdown).sort((a,b)=>b.p-a.p);
  for(const b of branches){
   if(left()<700)break;
   let at=b,mass=b.p;
   if(at.active===o.team){const end=await explore({kind:'endTurn'},at.key);
    if(!completeAction(end,o.team)||end.outcomes.length!==1)continue;
    at=end.outcomes[0];mass*=at.p;}
   if(at.active===o.team||!at.key)continue;
   let failed=false;
   const call=async(fn)=>{if(left()<150)return null;try{return await fn();}catch{failed=true;return null;}};
   const reply=await inspect.replyAssessment(at,withExploreDeadline(services,deadline),call,cap,o.team,left,true);
   if(failed||reply.failed)continue;
   line.observedReplyMass+=mass;
   if(!reply.unknown)line.checkedReplyMass+=mass;
   if(reply.essentialComplete)line.boundedReplyMass+=mass;
   line.criticalReplyAdjustment+=mass*Math.min(0,n(reply.criticalAdjustment));
   line.positionReplyAdjustment+=mass*Math.min(0,n(reply.positionAdjustment));
   line.reply.push({p:mass,stage:'after examined follow-up',...reply});
  }
  line.replyAdjustment=line.criticalReplyAdjustment+line.positionReplyAdjustment;
  return line;
 };
 // Alternate policy branches are measured independently. Both must receive the
 // same minimum coverage; budget expiry never grants the challenger a win.
 const incumbent=await evaluate(original),proposed=await evaluate(challenger);
 const newLine={...proposed,input:helper,ex:prep,preparedBranches:new Map([[prep.outcomes[0].key,
  {plan:{input:selected.input,label:selected.label},ex:child}]]),label:'Protect the loose ball before the champion pickup'};
 result.policyTrees=[newLine];
 const evidence=endorseContinuation(proposed,incumbent,inspect,'normal');
 if(incumbent.observedReplyMass<0.95||proposed.observedReplyMass<0.95||
   Math.abs(incumbent.observedReplyMass-proposed.observedReplyMass)>1e-6||
   evidence.replyBasis?.criticalDelta< -1e-8||!evidence.eligible)
  return {...result,reason:'no-fair-evidence-of-improvement',evidence};
 return {...result,selected:newLine,reason:'same-horizon-improvement-certified',evidence,
  originalRisk:original.ex.pTurnover,proposedRisk:challenger.ex.pTurnover};
}
