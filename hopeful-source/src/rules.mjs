import {planView,ordinaryMoveSourceMatches,ruleMapFor} from './execution.mjs';
import {same} from './policy.mjs';
export const SHARED_RULE_POLICY='hopeful-free-skill-turnover/1';
/** Both interfaces actually expose option IDs/labels and rule type. They do
 * not share arbitrary intermediate observation/context, so reject all other
 * choices instead of inventing state for the frozen live rule evaluator. */
export function sharedRuleChoice(request,team){
 if(request?.type!=='reroll'||(request.team??request.decisionOf)!==team)return null;
 const options=request.options??request.branches;
 if(!Array.isArray(options)||new Set(options.map(x=>x.id)).size!==options.length)return null;
 const skill=options.find(x=>x.id==='skill'),none=options.find(x=>x.id==='none');
 if(!skill||!none||!/^Re-roll with (Dodge|Sure Feet|Sure Hands|Catch|Pass)$/.test(skill.label||'')||
  !/Turnover/i.test(none.label||''))return null;
 return {optionId:skill.id,policy:SHARED_RULE_POLICY,reason:'offered-free-skill-prevents-explicit-turnover'};
}
/** Arm only an admitted, exact action plan. This commitment changes no other
 * Move, never survives a cancelled plan, and never covers unsupported offers. */
export function commitClearanceRule(o,plan,input,identity){
 const g=planView(plan);
 if(!g||plan.status!=='awaiting-execution'||!same(g.activeInput,input)||!same(plan.identity,identity)||
  input?.kind!=='playerAction'||input.action!=='move'||!Array.isArray(input.path))return null;
 const certificate={policy:SHARED_RULE_POLICY,agreement:true,scope:'final-clearance-Move/1',actor:input.playerId,action:input.action,
  identity,historyFrom:Number(String(o.revision).split(':')[0]),input,
  origin:o.players?.find(p=>p.id===input.playerId)?.pos??null};
 if(!Number.isInteger(certificate.historyFrom)||!certificate.origin)return null;
 return {...plan,rulePolicy:certificate};
}
export function clearanceRuleChoice(o,request,plan,identity){
 const c=plan?.rulePolicy,g=planView(plan);
 if(c?.scope!=='final-clearance-Move/1'||!same(c.identity,identity)||!same(plan?.identity,identity)||
  !g||!same(c.input,g.activeInput)||!ordinaryMoveSourceMatches(plan,o)||o.phase!=='play'||
  !o.pending||o.pending.requestId!==request?.id||o.pending.team!==o.team||request.team!==o.team||
  o.pending.type!==request.type||!same(o.pending.options,request.options)||
  Number(String(o.revision).split(':')[0])!==c.historyFrom||request.context?.kind==='blockDice')return null;
 const actor=o.players?.find(p=>p.id===c.actor),positions=[c.origin,...c.input.path.map(s=>s.to)];
 if(!actor?.pos||!positions.some(p=>same(p,actor.pos)))return null;
 return certifiedRuleChoice(o,request,plan,true);
}
/** Enumerate only enough to certify this helper agrees with the authoritative
 * builtin policy. Chance mass is summed; policy alternatives never are. A
 * missing/unsupported decision stops its mass, not turns it into safe evidence.
 * Existing explore outcomes remain unchanged and are never synthesized here. */
export async function auditSharedRule(o,input,services,deadline,{maxCalls=96,maxDepth=18}={}){
 const result={policy:SHARED_RULE_POLICY,attempted:false,complete:false,agreement:false,
  terminalMass:0,unknownMass:1,unsupportedMass:0,divergentMass:0,calls:0,decisions:[],reason:'no-applicable-shared-rule'};
 const actor=o.players?.find(p=>p.id===input?.playerId);
 if(input?.kind!=='playerAction'||!['move','secure','pass','handoff'].includes(input.action)||
  !(actor?.skills||[]).some(s=>['dodge','sureFeet','sureHands','catch','pass'].some(k=>s===k||s.startsWith(k+'(')))||
  !services.fork?.open||!services.fork?.step||!services.fork?.close||deadline-Date.now()<250)return result;
 result.attempted=true;const until=Math.min(deadline,Date.now()+1800),open=new Set();
 const remaining=()=>until-Date.now();
 const track=n=>{if(n?.fork)open.add(n.fork);return n;};
 const close=async fork=>{if(!open.delete(fork))return;try{await services.fork.close({fork});}catch{}};
 const next=async(args)=>{if(remaining()<60||result.calls>=maxCalls)return null;result.calls++;
  try{return track(await services.fork.step(args));}catch{return null;}};
 const visit=async(node,mass,depth)=>{
  if(!node?.ok||!Number.isFinite(mass)||mass<=0||depth>maxDepth)return;
  try{
   if(node.node==='terminal'){
    if(typeof node.position==='string'&&node.position)result.terminalMass+=mass;
    return;
   }
   if(remaining()<60||result.calls>=maxCalls)return;
   if(node.node==='decision'){
    const chosen=sharedRuleChoice(node,o.team);
    if(!chosen){result.unsupportedMass+=mass;return;}
    const index=node.branches.findIndex(x=>x.id===chosen.optionId),builtin=node.branches[node.defaultBranch]?.id;
    result.decisions.push({type:node.type,option:chosen.optionId,builtin,mass});
    if(index<0||builtin!==chosen.optionId){result.divergentMass+=mass;return;}
    await visit(await next({fork:node.fork,branch:index}),mass,depth+1);return;
   }
   if(node.node!=='chance'||!Array.isArray(node.branches))return;
   const total=node.branches.reduce((s,b)=>s+(Number.isFinite(b.p)&&b.p>=0&&b.p<=1?b.p:NaN),0);
   if(!Number.isFinite(total)||total>1+1e-8)return;
   for(let i=0;i<node.branches.length;i++){
    const b=node.branches[i];if(b.p<=0)continue;
    if(remaining()<60||result.calls>=maxCalls)break;
    await visit(await next({fork:node.fork,branch:i,copy:true}),mass*b.p,depth+1);
   }
  }finally{await close(node.fork);}
 };
 try{result.calls++;await visit(track(await services.fork.open({input,from:'root',controlTeam:o.team,controlAll:false})),1,0);}
 catch{result.reason='rule-audit-service-failed';}
 finally{for(const fork of [...open])await close(fork);}
 result.terminalMass=Math.min(1,result.terminalMass);result.unknownMass=Math.max(0,1-result.terminalMass);
 result.complete=result.unknownMass<=1e-8&&result.unsupportedMass<=1e-8&&result.divergentMass<=1e-8;
 result.agreement=result.complete&&result.decisions.length>0;
 result.reason=result.agreement?'shared-policy-certified-against-authoritative-builtin':
  result.divergentMass>0?'shared-policy-diverges':result.unsupportedMass>0?'unsupported-rule-decisions':
  result.complete?'no-rule-decision-needed':'shared-rule-coverage-incomplete';
 return result;
}
/** A certificate is an option-policy commitment only for the currently armed
 * action. Unsupported/changed offers use the legacy policy, never a stale ID. */
export function certifiedRuleChoice(o,request,plan,clearanceGuarded=false){
 const graph=planView(plan),certificate=plan?.rulePolicy;
 if(certificate?.scope==='final-clearance-Move/1'&&!clearanceGuarded)return null;
 if(!graph||plan.status!=='awaiting-execution'||certificate?.policy!==SHARED_RULE_POLICY||certificate.agreement!==true||
  certificate.actor!==graph.activeTask.actor||certificate.action!==graph.activeTask.action||
  o.team!==plan.scope.team||o.active!==o.team||o.half!==plan.scope.half||o.drive!==plan.scope.drive||!same(o.turn,plan.scope.turn)||
  o.activation?.playerId!==certificate.actor||o.activation.action!==certificate.action)return null;
 return sharedRuleChoice(request,o.team);
}

/** The joint-policy evaluator explicitly chooses the engine's builtin rule
 * policy. Retain every reachable own offer and its choice, rather than assume
 * the legacy coach makes the same Block/push/follow-up decisions. */
export async function auditBuiltinRules(o,input,services,deadline,{from='root',maxCalls=512,maxDepth=48}={}){
 const result={attempted:false,complete:false,terminalMass:0,unknown:1,calls:0,offers:[],reason:'rule-map-unavailable',keylessTerminalMass:0,rejections:[]};
 if(!(['endTurn','endActivation'].includes(input?.kind)||input?.playerId&&['move','block','blitz','pass','handoff','secure'].includes(input.action))||
  !services.fork?.open||!services.fork?.step||!services.fork?.close||typeof from!=='string'||!from)return result;
 const until=Math.min(deadline,Date.now()+1400),open=new Set(),table=new Map();result.attempted=true;
 const take=node=>{if(typeof node?.fork==='string')open.add(node.fork);return node;};
 const call=async(name,args)=>{if(until-Date.now()<60||result.calls>=maxCalls)return null;result.calls++;
  try{return take(await services.fork[name](args));}catch{return null;}};
 const close=async key=>{if(!open.delete(key))return;try{await services.fork.close({fork:key});}catch{}};
 const walk=async(node,mass,depth)=>{
  if(!node?.ok||node.revisionBound!==true||!node.fork||!Number.isFinite(mass)||mass<=0)return;
  try{
   if(node.node==='terminal'){
    // This audit certifies reachable rule offers, not successor state/value.
    // API2 terminal.position is nullable when key registration is exhausted;
    // the source-bound fork has still completed the same authoritative path.
    const retained=typeof node.position==='string'&&node.position.length>0;
    if((retained||node.position===null)&&typeof node.completed==='boolean'&&typeof node.turnover==='boolean'&&
     (node.completed||node.turnover||node.touchdown==='A'||node.touchdown==='B')){
     result.terminalMass+=mass;if(!retained)result.keylessTerminalMass+=mass;
    }else result.rejections.push('RULE_TERMINAL_CONTRACT_INCOMPLETE');
    return;
   }
   if(depth>=maxDepth||until-Date.now()<60||result.calls>=maxCalls)return;
   if(node.node==='decision'){
    if(node.decisionOf!==o.team||typeof node.type!=='string'||typeof node.prompt!=='string'||!Array.isArray(node.branches)||
     node.branches.some(b=>typeof b?.id!=='string'||typeof b.label!=='string')||new Set(node.branches.map(b=>b.id)).size!==node.branches.length||
     !Number.isInteger(node.defaultBranch)||!node.branches[node.defaultBranch])return;
    const offer={team:o.team,type:node.type,prompt:node.prompt,options:node.branches.map(b=>({id:b.id,label:b.label}))},key=JSON.stringify(offer),optionId=node.branches[node.defaultBranch].id;
    if(table.has(key)&&table.get(key).optionId!==optionId){result.reason='ambiguous-builtin-offer';return;}
    if(!table.has(key)&&table.size>=64)return;
    table.set(key,{...offer,optionId});
    await walk(await call('step',{fork:node.fork,branch:node.defaultBranch}),mass,depth+1);return;
   }
   if(node.node!=='chance'||!Array.isArray(node.branches))return;
   const sum=node.branches.reduce((v,b)=>v+(Number.isFinite(b.p)&&b.p>=0&&b.p<=1?b.p:NaN),0);
   if(!Number.isFinite(sum)||Math.abs(sum-1)>1e-8||node.unresolvedMass!==undefined&&(!Number.isFinite(node.unresolvedMass)||node.unresolvedMass<0||node.unresolvedMass>1e-8))return;
   for(let i=0;i<node.branches.length;i++)if(node.branches[i].p>0){
    if(until-Date.now()<60||result.calls>=maxCalls)break;
    await walk(await call('step',{fork:node.fork,branch:i,copy:true}),mass*node.branches[i].p,depth+1);
   }
  }finally{await close(node.fork);}
 };
 try{const node=await call('open',{input,from,controlTeam:o.team,controlAll:false});if(node?.from===from)await walk(node,1,0);}
 finally{for(const fork of [...open])await close(fork);}
 result.offers=[...table.values()];result.terminalMass=Math.min(1,result.terminalMass);result.unknown=Math.max(0,1-result.terminalMass);
 result.rejections=[...new Set(result.rejections)];
 result.complete=result.unknown<=1e-8&&result.reason!=='ambiguous-builtin-offer';
 result.reason=result.complete?'complete-explicit-builtin-rule-map':result.reason==='ambiguous-builtin-offer'?result.reason:'builtin-rule-map-incomplete';
 return result;
}

/** armStep has already matched this node's exact public source guard. Offers
 * apply only to the current input/actor/revision, never to a later activation. */
export function builtinRuleChoice(o,request,plan,identity){
 const graph=planView(plan),entry=ruleMapFor(plan);
 if(!graph||plan.status!=='awaiting-execution'||!entry||!same(plan.identity,identity)||
  !same(entry.input,graph.activeInput)||!same(plan.proposal?.inputNode,plan.cursor)||
  o.contextInfo?.resetReason||!same(o.turn,plan.scope.turn)||o.team!==plan.scope.team||o.active!==o.team||
  o.half!==plan.scope.half||o.drive!==plan.scope.drive||o.phase!=='play'||
  Number(String(o.revision).split(':')[0])!==plan.proposal?.historyFrom||
  o.activation?.playerId!==entry.input.playerId||o.activation.action!==entry.input.action||
  !o.pending||o.pending.requestId!==request?.id||o.pending.team!==o.team||request.team!==o.team||
  o.pending.type!==request.type||!same(o.pending.options,request.options)||!Array.isArray(request.options))return null;
 const options=request.options.map(x=>({id:x.id,label:x.label}));
 const offer=entry.offers?.find(x=>x.team===o.team&&x.type===request.type&&x.prompt===request.prompt&&same(x.options,options));
 if(!offer||!request.options.some(x=>x.id===offer.optionId))return null;
 return {optionId:offer.optionId,policy:'joint-protection-builtin/1',reason:'source-bound-audited-builtin-rule-choice'};
}
