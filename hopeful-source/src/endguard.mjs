import {withExploreDeadline} from './bounded-reply.mjs';
import {completeAction,weightedPolicyValue,endorseContinuation} from './policy.mjs';
const n=(x,d=0)=>Number.isFinite(x)?x:d;
/** A limited current-End challenger. The entire champion search runs first.
 * Only unexamined native roll-free alternatives get this additional budget. */
export async function challengeEnd(o,snapshot,native,services,inspect,deadline){
 const selected=snapshot?.selected,result={selected:null,attempted:false,reason:'not-an-unprepared-End'};
 if(selected?.input?.kind!=='endTurn'||selected.preparedBranches?.size||!completeAction(selected.ex,o.team)||
  n(selected.unknown,1)>1e-8||deadline-Date.now()<2200)return result;
 const seen=new Set((snapshot.lines||[]).map(c=>JSON.stringify(c.input)));
 const options=native.map(c=>inspect.canonical(c,o)).filter(c=>c&&c.input?.kind!=='endTurn'&&
  c.family!=='endActivation'&&Number.isFinite(c.pTurnover)&&c.pTurnover<1e-8&&!c.rushes&&
  !seen.has(JSON.stringify(c.input)));
 options.sort((a,b)=>inspect.cheapScore(o,b,o.team,inspect.boardValue(o,o.team))-
  inspect.cheapScore(o,a,o.team,inspect.boardValue(o,o.team)));
 if(!options.length)return {...result,reason:'all-native-safe-alternatives-already-admitted'};
 result.attempted=true;const left=()=>deadline-Date.now(),cap=(ms=650)=>Math.max(50,Math.min(ms,left()-100));
 const explore=async(input,from)=>left()>150?services.explore(input,{coachEnumerationDeadline:deadline,...(from?{from}:{}),observations:true,
  perspective:o.team,decisions:'builtin',maxOutcomes:20,maxKeep:256,maxLeaves:1800,threshold:0.00001,maxMs:cap()}):null;
 const assess=async(first)=>{
  const ex=first.ex;if(!completeAction(ex,o.team))return null;
  const line={...first,baseValue:weightedPolicyValue({...first,unknown:0,secondCost:0},o,inspect),
   preparationGain:0,unknown:0,terminalScoreMass:inspect.observedTerminalScore(ex,o.team,o),reply:[],
   checkedReplyMass:0,observedReplyMass:0,boundedReplyMass:0,replyAttempted:true,
   criticalReplyAdjustment:0,positionReplyAdjustment:0};
  for(const b of ex.outcomes.filter(b=>!b.touchdown).sort((a,b)=>b.p-a.p)){
   if(left()<700)return null;let at=b,mass=b.p;
   // Every nonterminal continuation needs the retained state it follows.
   // Missing keys (for example at the host position cap) must not omit `from`
   // and accidentally compare the alternative against End Turn from ROOT.
   if(!at.key||!at.observation)return null;
   if(at.active===o.team){const closure=await explore({kind:'endTurn'},at.key);
    if(!completeAction(closure,o.team)||closure.outcomes.length!==1||n(closure.pTurnover)>0)return null;
    at=closure.outcomes[0];mass*=at.p;}
   if(!at.key||at.active===o.team)return null;
   const call=async(fn)=>{if(left()<150)return null;try{return await fn();}catch{return null;}};
   const reply=await inspect.replyAssessment(at,withExploreDeadline(services,deadline),call,cap,o.team,left,true);
   if(reply.failed)return null;
   line.observedReplyMass+=mass;if(!reply.unknown)line.checkedReplyMass+=mass;
   if(reply.essentialComplete)line.boundedReplyMass+=mass;
   line.criticalReplyAdjustment+=mass*Math.min(0,n(reply.criticalAdjustment));
   line.positionReplyAdjustment+=mass*Math.min(0,n(reply.positionAdjustment));
   line.reply.push({p:mass,stage:'after first action',...reply});
  }
  line.replyAdjustment=line.criticalReplyAdjustment+line.positionReplyAdjustment;return line;
 };
 const incumbent=await assess(selected);if(!incumbent)return {...result,reason:'incumbent-not-comparably-covered'};
 for(const c of options.slice(0,2)){
  if(left()<1500)break;
  const ex=await explore(c.input);
  if(!completeAction(ex,o.team)||n(ex.pTurnover)>1e-8)continue;
  (result.policyTrees??=[]).push({...c,ex,preparedBranches:new Map()});
  const measured=await assess({...c,ex});if(!measured)continue;
  const e=endorseContinuation(measured,incumbent,inspect,'normal');
  if(measured.observedReplyMass<1-1e-8||incumbent.observedReplyMass<1-1e-8||
   e.replyBasis?.criticalDelta< -1e-8||!e.eligible)continue;
  return {...result,selected:{...measured,preparedBranches:new Map()},reason:'roll-free-gain-clears-equal-closure-comparison',evidence:e};
 }
 return {...result,reason:'no-measured-safe-improvement'};
}
