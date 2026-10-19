import {completeAction,same} from './policy.mjs';
/** Frozen valuation can price attack-followup -> loose-ball recovery. Bind
 * those existing goal proposals to their real retained branch before storage.
 * Matching a ball square discovers a proposal only; actual branch validation
 * and fresh exploration establish it. No extra value is awarded here. */
export async function bindRecoveryObligations(o,selected,services,deadline){
 const result={selected,attempted:false,bound:0,unbound:0,reason:'no-priced-recovery-obligations'};
 if(!selected?.preparedBranches?.size||deadline-Date.now()<350)return result;
 const until=Math.min(deadline,Date.now()+1800),prepared=new Map(selected.preparedBranches);
 let probes=0;
 for(const [key,follow] of prepared){
  const goals=follow?.plan?.recovery?.plans;if(!goals?.length)continue;
  result.attempted=true;const nested=new Map(follow.preparedBranches||[]),matched=new Set();
  for(const b of follow.ex?.outcomes||[]){
   if(b.turnover||b.touchdown||!b.key||b.observation?.ball?.kind!=='ground')continue;
   const goal=goals.find(g=>g.input&&same(g.ball,b.observation.ball.pos));if(!goal)continue;matched.add(goal);
   if(probes>=2||until-Date.now()<300){result.unbound++;continue;}probes++;
   let legal,ex;
   try{
    legal=await services.validate(goal.input,{from:b.key});
    if(legal?.ok!==true||legal.legal!==true){result.unbound++;continue;}
    ex=await services.explore(goal.input,{coachEnumerationDeadline:until,from:b.key,team:o.team,perspective:o.team,observations:true,decisions:'builtin',
     maxOutcomes:40,maxKeep:256,maxLeaves:3500,threshold:.00001,maxMs:Math.max(50,Math.min(600,until-Date.now()-80))});
   }catch{result.unbound++;continue;}
   if(!completeAction(ex,o.team)||ex.outcomeIdentity!=='complete-state-v1'){result.unbound++;continue;}
   nested.set(b.key,{plan:{input:goal.input,label:goal.label||'Recover the newly freed ball'},ex});result.bound++;
  }
  result.unbound+=goals.filter(goal=>!matched.has(goal)).length;
  if(nested.size)prepared.set(key,{...follow,preparedBranches:nested});
 }
 if(result.bound)result.selected={...selected,preparedBranches:prepared};
 result.reason=result.attempted?result.unbound?(result.bound?'priced-recovery-partially-bound':'priced-recovery-not-bound'):'priced-recovery-bound-to-real-branches':result.reason;
 return result;
}
