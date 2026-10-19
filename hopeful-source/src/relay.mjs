import {withExploreDeadline} from './bounded-reply.mjs';
import {same,policyFrom,weightedPolicyValue,endorseContinuation} from './policy.mjs';
const n=(x,d=0)=>Number.isFinite(x)?x:d;
const dist=(a,b)=>a&&b?Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y)):Infinity;
const player=(o,id)=>o.players.find(p=>p.id===id);
const ready=p=>p?.location==='pitch'&&p.stance==='standing'&&!p.activated&&!p.rooted;
const held=o=>o.ball?.kind==='held'?player(o,o.ball.playerId):null;
const known=ex=>!!ex?.ok&&ex.outcomes?.some(b=>b.observation)&&
 Math.max(n(ex.unresolvedMass),n(ex.rest?.p),1-ex.outcomes.filter(b=>b.observation).reduce((s,b)=>s+n(b.p),0))<=.05;
/** Reserve legal transfer declarations outside the champion's cheap shortlist.
 * Compare both policies over at most two own inputs, then the same Turn closure
 * and bounded reply horizon. No geometric position grants probability or value. */
export async function challengeRelay(o,snapshot,services,inspect,deadline){
 const result={attempted:false,selected:null,reason:'no-eligible-relay',candidates:[],policies:[]};
 if(snapshot?.mode!=='normal')return {...result,reason:'special-champion-selection-preserved'};
 if(o.activation&&!o.activation.over)return {...result,reason:'activation-already-declared; transfer-cannot-be-appended'};
 if(o.used?.handoff)return {...result,reason:'handoff-window-used'};
 if(!snapshot.selected?.ex)return {...result,reason:'missing-fresh-champion-outcomes'};
 const start=Date.now(),end=Math.min(deadline,start+18000),left=()=>end-Date.now();
 const proposals=[],seen=new Set();
 const add=input=>{const key=JSON.stringify(input);if(!seen.has(key)){seen.add(key);proposals.push(input);}};
 if(o.ball?.kind==='ground'){
  // A Move cannot later change its declared action. Declare Hand-off at root,
  // retaining the real engine route to the loose ball and an adjacent receiver.
  const pickups=snapshot.lines.filter(c=>['move','secure'].includes(c.input?.action)&&
   c.input.path?.at(-1)?.to&&dist(c.input.path.at(-1).to,o.ball.pos)===0&&
   ready(player(o,c.input.playerId))).sort((a,b)=>n(a.ex.pTurnover)-n(b.ex.pTurnover));
  const actors=new Set();
  for(const c of pickups){if(actors.has(c.input.playerId))continue;actors.add(c.input.playerId);
   const actor=player(o,c.input.playerId);
   for(const receiver of o.players.filter(p=>p.team===o.team&&p.id!==actor.id&&ready(p)&&
    dist(p.pos,o.ball.pos)===1&&p.ma>actor.ma).sort((a,b)=>b.ma-a.ma).slice(0,2))
    add({...c.input,action:'handoff',handoffTarget:receiver.id});
   if(actors.size>=2)break;
  }
 }else{
  const carrier=held(o);
  if(carrier?.team!==o.team||!ready(carrier))return result;
  const receivers=o.players.filter(p=>p.team===o.team&&p.id!==carrier.id&&ready(p)&&p.ma>carrier.ma&&dist(p.pos,carrier.pos)<=2)
   .sort((a,b)=>b.ma-a.ma).slice(0,2);
  if(receivers.length){const r=await services.candidates({players:[carrier.id],targets:receivers.map(p=>p.id),families:['handoff'],
   sort:'steps',maxRushes:0,precision:'none',limit:12,maxMs:500});
   for(const c of r?.candidates||[])add(c.input);
   for(const receiver of receivers)if(dist(carrier.pos,receiver.pos)===1)
    add({kind:'playerAction',playerId:carrier.id,action:'handoff',path:[],handoffTarget:receiver.id});
  }
 }
 if(!proposals.length)return result;result.attempted=true;
 const explore=async(input,from)=>left()>250?services.explore(input,{coachEnumerationDeadline:end,...(from?{from}:{}),observations:true,perspective:o.team,
  decisions:'builtin',maxOutcomes:128,maxKeep:384,maxLeaves:12000,threshold:.000001,maxMs:Math.min(1400,left()-100)}):null;
 const rootValue=inspect.boardValue(o,o.team);
 const follow=async(first)=>{
  const prepared=new Map(first.preparedBranches||[]);
  // Both incumbents and challengers receive identical branch and route caps.
  for(const b of first.ex.outcomes.filter(b=>b.key&&b.observation&&!b.turnover&&!b.touchdown&&b.active===o.team)
   .sort((a,b)=>b.p-a.p).slice(0,2)){
   if(left()<1600)break;
   // Existing obligations are part of the incumbent policy, even on branches
   // outside this new discovery shortlist. Never re-rank them as isolated moves.
   if(prepared.has(b.key))continue;
   const ob=b.observation,carrier=held(ob);
   if(carrier?.team!==o.team)continue;
   const r=await services.candidates({from:b.key,players:[carrier.id],families:['move'],maxRushes:0,
    sort:'goalDistance',precision:'none',limit:100,maxMs:500});
   const routes=(r?.candidates||[]).map(c=>inspect.canonical(c,ob)).filter(Boolean);
   routes.forEach(c=>c.cheap=inspect.cheapScore(ob,c,o.team,inspect.boardValue(ob,o.team)));
   const foes=ob.players.filter(p=>p.team!==o.team&&p.location==='pitch'&&p.stance==='standing'&&p.tackleZone!==false&&!p.distracted);
   const safe=c=>[carrier.pos,...(c.input.path||[]).slice(0,-1).map(s=>s.to)].every(at=>!foes.some(p=>dist(at,p.pos)===1));
   const gx=ob.pitch.endZone[o.team],distance=c=>Math.abs(gx-c.input.path?.at(-1)?.to?.x);
   const safeRoutes=routes.filter(safe),nearest=Math.min(...safeRoutes.map(distance)),forward=safeRoutes.filter(c=>distance(c)===nearest).sort((a,b)=>b.cheap-a.cheap)[0];
   routes.sort((a,b)=>b.cheap-a.cheap);let best=null,bestValue=-Infinity;
   const choices=[...new Set([forward,...routes.slice(0,2)].filter(Boolean))];
   for(const c of choices){if(left()<1000)break;const ex=c.ex||await explore(c.input,b.key);if(!known(ex))continue;
    const value=inspect.outcomeValue(ex,o.team,rootValue),cost=(c.input.path?.length||0)*.6;
    const v=value.value-n(ex.pTurnover)*inspect.CFG.carrierTurnover-value.unknown*inspect.CFG.unresolved-cost;
    if(v>bestValue){bestValue=v;best={plan:{input:c.input,label:c.label||'Advance the receiver'},ex};}}
   if(best)prepared.set(b.key,best);
  }
  return prepared;
 };
 const assess=async(first)=>{
  const prepared=await follow(first),policy=policyFrom(first,prepared,o.team,inspect);
  if(policy.issues?.length)return null;
  const line={...first,ex:policy.ex,executionEx:first.ex,baseValue:weightedPolicyValue(policy,o,inspect),preparationGain:0,unknown:policy.unknown,
   terminalScoreMass:inspect.observedTerminalScore(policy.ex,o.team,o),reply:[],replyAttempted:true,
   checkedReplyMass:0,observedReplyMass:0,boundedReplyMass:0,criticalReplyAdjustment:0,positionReplyAdjustment:0};
  for(const b of policy.ex.outcomes.filter(b=>b.key&&b.observation&&!b.touchdown).sort((a,b)=>b.p-a.p).slice(0,2)){
   if(left()<1400)break;let at=b,mass=b.p;
   if(at.active===o.team){const closure=await explore({kind:'endTurn'},at.key);
    if(!known(closure)||closure.outcomes.length!==1)continue;at=closure.outcomes[0];mass*=at.p;}
   if(!at?.key||at.active===o.team)continue;
   const call=async(fn)=>{if(left()<180)return null;try{return await fn();}catch{return null;}};
   const reply=await inspect.replyAssessment(at,withExploreDeadline(services,end),call,()=>Math.min(650,Math.max(100,left()-150)),o.team,left,true);
   if(reply.failed)continue;
   line.observedReplyMass+=mass;if(!reply.unknown)line.checkedReplyMass+=mass;if(reply.essentialComplete)line.boundedReplyMass+=mass;
   line.criticalReplyAdjustment+=mass*Math.min(0,n(reply.criticalAdjustment));line.positionReplyAdjustment+=mass*Math.min(0,n(reply.positionAdjustment));
   line.reply.push({p:mass,stage:'after examined follow-up',...reply});
  }
  line.replyAdjustment=line.criticalReplyAdjustment+line.positionReplyAdjustment;
  line.value=line.baseValue+line.replyAdjustment;line.preparedBranches=prepared;
  result.policyScope='complete retained own dependency trees and new two-input relay proposals; identical End Turn closure; bounded branches/routes/replies, not full-turn EV';
  result.policies.push({input:first.input,value:line.baseValue,pTurnover:policy.ex.pTurnover,unknown:policy.unknown,
   ownPolicyComplete:policy.complete,structuralComplete:policy.structuralComplete,ownPolicyDepth:policy.maxDepth,
   observedReplyMass:line.observedReplyMass,checkedReplyMass:line.checkedReplyMass,criticalReplyAdjustment:line.criticalReplyAdjustment,
   transitions:policy.transitions,reply:line.reply});
  return line;
 };
 const incumbent=await assess(snapshot.selected);
 if(!incumbent)return {...result,reason:'incumbent-relay-policy-has-unresolved-dependencies'};
 for(const input of proposals.slice(0,3)){
  if(left()<3000)break;
  const ex=await explore(input),record={id:'relay:'+input.playerId+':'+input.handoffTarget,source:o.ball.kind==='ground'?'retained pickup route with root Hand-off declaration':'reserved engine handoff to unactivated receiver',input,legal:!!ex?.ok,pTurnover:ex?.pTurnover,unknown:ex?.unresolvedMass,reason:null};result.candidates.push(record);
  if(!known(ex)){record.reason='illegal-or-unresolved';continue;}
  const line=await assess({input,ex,family:'handoff',label:'Declare a legal transfer before activating the receiver'});
  if(!line){record.reason='relay-policy-has-unresolved-dependencies';continue;}
  (result.policyTrees??=[]).push({...line,ex:line.executionEx});
  const additionalUnobservedReply=Math.max(0,incumbent.observedReplyMass-line.observedReplyMass);
  // The champion already charges an unchecked reply by 18 common units.
  // Extra unexamined mass only hurts this challenger; never grants safety credit.
  line.baseValue-=additionalUnobservedReply*18;
  const e=endorseContinuation(line,incumbent,inspect,'normal');record.evidence={...e,additionalUnobservedReply};
  // Missing branches cannot invent positive safety. Preserve measured critical
  // costs in the common partial-relative gate; require meaningful reply mass.
  if(incumbent.observedReplyMass<=0||line.observedReplyMass<=0||!e.eligible){record.reason='insufficient-common-evidence';continue;}
  result.selected={...line,ex:line.executionEx};result.evidence=e;result.reason='legal-relay-clears-common-policy-margin';break;
 }
 if(!result.selected)result.reason='no-relay-clears-common-policy-margin';
 result.elapsedMs=Date.now()-start;return result;
}
