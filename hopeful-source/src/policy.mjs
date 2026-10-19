import {periodEnd} from './period-boundary.mjs';
/** Compare real retained policies in the champion's units. Length, persistence
 * and 2.0's pressure/beam score have no vote. No unsearched branch earns credit. */
const ordered=x=>Array.isArray(x)?x.map(ordered):x&&typeof x==='object'?
 Object.fromEntries(Object.keys(x).sort().map(k=>[k,ordered(x[k])])):x;
export const stableDataKey=x=>JSON.stringify(ordered(x));
export const same=(a,b)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
/** Within one request, include source-bound conditional dependencies in identity.
 * Two policies sharing their first input can have different real later actions. */
export function policyIdentity(line,depth=0){
 if(!line?.input||depth>4)return null;
 const dependencies=[];
 if(line.preparedBranches instanceof Map)for(const [key,d] of [...line.preparedBranches].sort(([a],[b])=>String(a).localeCompare(String(b)))){
  const child=policyIdentity({...d?.plan,preparedBranches:d?.preparedBranches},depth+1);
  if(child===null)return null;dependencies.push([key,child]);
 }
 return JSON.stringify(ordered({input:line.input,dependencies}));
}
const n=(x,d=0)=>Number.isFinite(x)?x:d;
export function evidenceSummary(c){
 if(!c)return null;
 return {input:c.input,family:c.family,baseValue:c.baseValue,preparationGain:n(c.preparationGain),
  value:c.value,pTurnover:n(c.ex?.pTurnover),pTouchdown:n(c.ex?.pTouchdown),
  terminalScoreMass:n(c.terminalScoreMass),unknown:n(c.unknown,1),
  replyAttempted:!!c.replyAttempted,checkedReplyMass:n(c.checkedReplyMass),
  observedReplyMass:n(c.observedReplyMass),boundedReplyMass:n(c.boundedReplyMass)};
}
export function endorseContinuation(c,incumbent,inspect,mode){
 if(!c||!incumbent)return {eligible:false,reason:'missing-current-champion-evidence'};
 if(same(c.input,incumbent.input))return {eligible:true,equivalent:true,reason:'fresh-champion-identical-input'};
 if(mode!=='normal')return {eligible:false,reason:'champion-special-selection-preserved'};
 if(!Number.isFinite(c.baseValue)||!Number.isFinite(incumbent.baseValue)||!c.ex||!incumbent.ex)
  return {eligible:false,reason:'missing-common-value-or-probabilities'};
 // No reply channel may silently lose its measured harm when the two policies
 // lack a shared reply horizon/coverage. This also applies to ordinary moves.
 const e=inspect.contenderEvidence(c,incumbent);
 if(['critical-only-unmatched','incomparable-reply-boundary'].includes(e.replyBasis?.mode))
  return {...e,eligible:false,reason:(n(c.preparationGain)>0||n(incumbent.preparationGain)>0)?
   'unmatched-own-horizon':'unmatched-reply-coverage'};
 if(e.replyBasis?.criticalDelta< -1e-8)return {...e,eligible:false,reason:'worsened-critical-reply'};
 return {...e,reason:e.eligible?'current-champion-evidence-margin':'champion-not-beaten'};
}
export function completeAction(ex,team){
 if(!ex?.ok||!Array.isArray(ex.outcomes)||!ex.outcomes.length||ex.outcomes.some(b=>!b||typeof b!=='object')||
  [ex.unresolvedMass,ex.rest?.p].some(p=>p!==undefined&&(!Number.isFinite(p)||p<0||p>1)))return false;
 const mass=ex.outcomes.filter(b=>b.observation).reduce((s,b)=>s+n(b.p),0);
 return Math.abs(mass-1)<=1e-8&&n(ex.unresolvedMass)<=1e-8&&n(ex.rest?.p)<=1e-8&&
  ex.outcomes.every(b=>b.observation&&Number.isFinite(b.p)&&b.p>=0&&b.p<=1);
}
/** Fold one real conditional action tree in a single place. Every nested
 * dependency contributes its actual weighted terminal/failure outcomes and
 * action cost. Unbound priced recovery, missing keys or excessive depth remain
 * explicitly incomplete instead of silently becoming a shorter policy. */
export function policyFrom(first,prepared,team,inspect){
 const outcomes=[],transitions=[],issues=[];let secondCost=0,unresolvedMass=0,participantsComplete=true,maxDepth=0;
 const unresolved=ex=>Math.max(n(ex?.unresolvedMass),n(ex?.rest?.p),
  1-(Array.isArray(ex?.outcomes)?ex.outcomes:[]).filter(b=>b?.observation).reduce((s,b)=>s+n(b.p),0),0);
 const fail=(reason,mass)=>{participantsComplete=false;unresolvedMass+=Math.max(0,mass);issues.push({reason,mass});};
 const walk=(node,children,weight,depth,ancestors,plan=null)=>{
  maxDepth=Math.max(maxDepth,depth);
  if(depth>4||ancestors.has(node.ex)){fail('conditional-policy-cycle-or-depth',weight);return;}
  const ancestry=new Set(ancestors);ancestry.add(node.ex);
  if(node.ex?.ok!==true||!Array.isArray(node.ex?.outcomes)||
   [node.ex?.unresolvedMass,node.ex?.rest?.p].some(p=>p!==undefined&&(!Number.isFinite(p)||p<0||p>1)))fail('invalid-participant-evidence',weight);
  participantsComplete&&=completeAction(node.ex,team);unresolvedMass+=weight*unresolved(node.ex);
  const branches=Array.isArray(node.ex?.outcomes)?node.ex.outcomes:[],keys=new Set(branches.map(b=>b?.key));
  if(branches.reduce((sum,b)=>sum+n(b?.p),0)>1+1e-8)fail('non-unit-participant-mass',weight);
  if(children&&[...children.keys()].some(key=>!keys.has(key)))fail('dangling-priced-branch',weight);
  const goals=Array.isArray(plan?.recovery?.plans)?plan.recovery.plans:[],matchedGoals=new Set();let continuingMass=0;
  for(const b of branches){
   if(!b||!Number.isFinite(b.p)||b.p<0||b.p>1){fail('invalid-conditional-mass',weight);continue;}
   const mass=weight*b.p;if(!mass)continue;
   const absorbing=b.turnover||periodEnd(b)||b.active!==undefined&&b.active!==team;
   if(!absorbing)continuingMass+=mass;
   const goal=!absorbing&&b.observation?.ball?.kind==='ground'?goals.find(g=>g.input&&same(g.ball,b.observation.ball.pos)):null;
   if(goal)matchedGoals.add(goal);
   const follow=!absorbing?children?.get(b.key):null;
   if(goal&&(!follow?.plan?.input||!same(goal.input,follow.plan.input)))fail('unbound-priced-recovery',mass);
   if(!follow){outcomes.push({...b,p:mass});continue;}
   if(typeof b.key!=='string'||!b.key||!follow.plan?.input||!follow.ex?.outcomes?.length){
    fail('missing-conditional-key-or-evidence',mass);outcomes.push({...b,p:mass});continue;
   }
   transitions.push({mass,input:follow.plan.input,depth:depth+1});
   secondCost+=mass*((follow.plan.input.path?.length||0)*.6+
    (follow.plan.input.path||[]).filter(step=>step.kind==='rush').length*inspect.CFG.optionalRush);
   walk({input:follow.plan.input,ex:follow.ex},follow.preparedBranches,mass,depth+1,ancestry,follow.plan);
  }
  if(continuingMass>0&&goals.some(goal=>!matchedGoals.has(goal)))fail('unmatched-priced-recovery-goal',continuingMass);
 };
 walk(first,prepared,1,0,new Set());
 const known=outcomes.filter(b=>b.observation).reduce((s,b)=>s+n(b.p),0),unknown=Math.min(1,Math.max(0,1-known,unresolvedMass));
 const ex={ok:participantsComplete,outcomes,pTurnover:outcomes.reduce((s,b)=>s+(b.turnover?n(b.p):0),0),
  pTouchdown:outcomes.reduce((s,b)=>s+(b.touchdown===team?n(b.p):0),0),unresolvedMass:unknown,rest:{p:unknown}};
 return {input:first.input,ex,unknown,transitions,secondCost,maxDepth,structuralComplete:issues.length===0,complete:participantsComplete&&unknown<=1e-8,issues};
}
export function weightedPolicyValue(policy,o,inspect){
 const carrier=o.ball?.kind==='held'?o.players.find(p=>p.id===o.ball.playerId):null;
 const actors=o.players.filter(p=>p.team===o.team&&p.location==='pitch'&&p.stance!=='stunned'&&!p.activated);
 const risk=(carrier?.team===o.team?inspect.CFG.carrierTurnover:inspect.CFG.turnover)+Math.min(30,actors.length*2);
 const value=inspect.outcomeValue(policy.ex,o.team,inspect.boardValue(o,o.team));
 return value.value-policy.ex.pTurnover*risk-policy.unknown*inspect.CFG.unresolved-
  (policy.ex.pTouchdown?0:(policy.input.path?.length||0)*0.6+
   (policy.input.path||[]).filter(s=>s.kind==='rush').length*inspect.CFG.optionalRush+policy.secondCost);
}
