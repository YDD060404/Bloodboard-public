import {createPlan,armStep,planView,reconcile,storeRuleMaps} from './execution.mjs';
import {same,completeAction} from './policy.mjs';
import {auditBuiltinRules} from './rules.mjs';
/** Persist selected engine-observed dependencies, never request-local keys.
 * First prefer the full exact graph. A size failure can use a rolling frontier:
 * every current-action public outcome and required next input remains exact,
 * while deeper outcome predictions become explicitly unknown and must be rebuilt.
 */
export function saveChampionPlan(o,selected,identity,maxBytes=7500){
 if(['endTurn','endActivation'].includes(selected?.input?.kind)&&!selected?.preparedBranches?.size)
  return {plan:null,reason:'scope-closing-action-has-no-successor',nodes:0};
 if(!selected?.ex?.ok||!selected.ex.outcomes?.length)return {plan:null,reason:'selected-action-has-no-observed-outcome',nodes:0};
 const make=rows=>{
  if(!rows[0].branches.length)return {plan:null,reason:'no-own-play-success-branch',nodes:0};
  const made=createPlan(o,{id:`${identity.coachId}:${o.team}:${o.revision}`,identity,nodes:rows,maxBytes});
  if(!made.plan)return {...made,nodes:0};
  if(selected.requireRuleMaps){
   if(rows.some(row=>row.expansion!=='required'&&(!row.ruleMap||!same(row.ruleMap.input,row.input)||!Array.isArray(row.ruleMap.offers))))
    return {plan:null,reason:'required-builtin-rule-map-missing',nodes:0};
   made.plan.ruleMaps=storeRuleMaps(rows.map(row=>row.expansion==='required'?null:row.ruleMap));
  }
  const armed=armStep(made.plan,o,selected.input);
  return {...armed,nodes:armed.plan?rows.length:0,
   representation:armed.plan?(planView(armed.plan).frontier?'rolling-exact-frontier':'retained-exact-graph'):null};
 };
 // The priced source tree must already have complete rule maps. A frontier
 // defers their LIVE use, never excuses missing certification of priced inputs.
 if(selected.requireRuleMaps){
  const seen=new Set();
  const certified=first=>{
   if(!first.ruleMap||!same(first.ruleMap.input,first.input)||!Array.isArray(first.ruleMap.offers))return false;
   const marker=first.preparedBranches;
   if(marker&&seen.has(marker))return false;
   if(marker)seen.add(marker);
   let complete=true;
   for(const b of first.ex.outcomes){
    if(b.turnover||b.touchdown||!b.observation)continue;
    const f=first.preparedBranches?.get(b.key);
    if(f?.plan?.input&&f.ex?.outcomes?.length&&!certified({input:f.plan.input,ex:f.ex,preparedBranches:f.preparedBranches,ruleMap:f.ruleMap??f.plan.ruleMap})){complete=false;break;}
   }
   if(marker)seen.delete(marker);
   return complete;
  };
  if(!certified(selected))return {plan:null,reason:'required-builtin-rule-map-missing',nodes:0};
 }
 const rows=[];let nodeOverflow=false;
 const visit=(first,depth=0)=>{
  if(rows.length>=5||depth>2){nodeOverflow=true;return null;}
  const index=rows.length,node={input:first.input,branches:[],...(first.ruleMap?{ruleMap:first.ruleMap}:{}),...(first.goal?{goal:first.goal}:{})};rows.push(node);
  for(const b of first.ex.outcomes){
   if(b.turnover||b.touchdown||!b.observation)continue;
   const f=first.preparedBranches?.get(b.key);let next=null;
   if(f?.plan?.input&&f.ex?.outcomes?.length){next=visit({input:f.plan.input,ex:f.ex,preparedBranches:f.preparedBranches,ruleMap:f.ruleMap??f.plan.ruleMap,goal:f.plan.goal??first.goal},depth+1);
    if(next===null)continue;}
   node.branches.push({mass:b.p,observation:b.observation,next});
  }
  return index;
 };
 visit(selected);
 const exact=nodeOverflow?{plan:null,reason:'context-reservation-exceeded',nodes:0}:make(rows);
 if(exact.plan||exact.reason!=='context-reservation-exceeded'||!selected.preparedBranches?.size)return exact;
 const frontier=[{input:selected.input,branches:[],...(selected.ruleMap?{ruleMap:selected.ruleMap}:{}),...(selected.goal?{goal:selected.goal}:{})}];
 for(const b of selected.ex.outcomes){
  if(b.turnover||b.touchdown||!b.observation)continue;
  const f=selected.preparedBranches.get(b.key);let next=null;
  if(f?.plan?.input&&f.ex?.outcomes?.length){
   // Sharing only an obligation input assumes nothing about its future states:
   // after the actual guard matches, all probability evidence is recomputed.
   next=frontier.findIndex((node,index)=>index>0&&same(node.input,f.plan.input)&&same(node.goal??null,f.plan.goal??selected.goal??null));
   if(next<0){if(frontier.length>=5)return {plan:null,reason:'too-many-frontier-obligations',nodes:0};
    next=frontier.length;frontier.push({input:f.plan.input,branches:[],expansion:'required',...((f.plan.goal??selected.goal)?{goal:f.plan.goal??selected.goal}:{})});}
  }
  frontier[0].branches.push({mass:b.p,observation:b.observation,next});
 }
 return {...make(frontier),exactGraphReason:nodeOverflow?'exact-graph-node-budget-exceeded':exact.reason};
}
/** A deferred task has no reusable probability tree. Only a freshly evaluated
 * current selection can replace it with an executable contract. Preserve its
 * stable identity/progress, not stale branches or simulation handles. */
export function armContinuation(plan,o,selected,identity,maxBytes=7500){
 const current=planView(plan);
 if(!current||!same(selected?.input,current.activeInput))return {plan:null,reason:'different-choice'};
 const frontier=current.activeTask.expansion==='required';
 if(!frontier&&!(selected.requireRuleMaps&&!plan.ruleMaps))return armStep(plan,o,selected.input);
 const actual=reconcile(plan,o,{identity});
 if(actual.status!=='candidate-ready'||frontier&&!actual.candidate?.requiresExpansion)
  return {plan:null,reason:'frontier-current-guard-not-matched'};
 if(!completeAction(selected.ex,o.team))return {plan:null,reason:'frontier-current-expansion-incomplete'};
 if(plan.ruleMaps&&(!selected.requireRuleMaps||!selected.ruleMap||!same(selected.ruleMap.input,selected.input)))
  return {plan:null,reason:'frontier-current-rule-map-required'};
 const saved=saveChampionPlan(o,{...selected,goal:selected.goal??current.activeTask.goal},identity,maxBytes);
 if(!saved.plan)return {...saved,reason:'frontier-expansion-unavailable:'+saved.reason};
 saved.plan.id=plan.id;saved.plan.completedCount=current.completedCount;
 if(new TextEncoder().encode(JSON.stringify(saved.plan)).length>maxBytes)return {plan:null,reason:'frontier-expansion-does-not-fit'};
 return {...saved,reason:frontier?'frontier-expanded-from-current-evidence':'continuation-rebound-from-current-rule-certificate'};
}

/** Ordinary future tasks require a new root rule audit AFTER their actual
 * guard/identity and fresh expansion match. Never copy a simulated source map. */
export async function armAuditedContinuation(plan,o,selected,identity,services,deadline,maxBytes=7500){
 const initial=armContinuation(plan,o,selected,identity,maxBytes);
 if(initial.reason!=='frontier-current-rule-map-required')return {...initial,selected};
 const audit=await auditBuiltinRules(o,selected.input,services,deadline);
 if(!audit.complete)return {plan:null,reason:'frontier-current-rule-audit-incomplete',ruleAudit:audit,selected};
 const fresh={...selected,requireRuleMaps:true,ruleMap:{input:selected.input,offers:audit.offers}};
 return {...armContinuation(plan,o,fresh,identity,maxBytes),selected:fresh,ruleAudit:audit};
}
