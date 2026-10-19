import {available} from './availability.mjs';
import {completeAction} from './policy.mjs';
import {buildProtectionPolicy} from './protection.mjs';
const dist=(a,b)=>Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));
/** Contact has no free bonus. A useful contact proposal must bind its actual
 * failures and legal activation closure before a live carrier continuation. */
export async function discoverContactCoordination(o,snapshot,native,services,inspect,deadline){
 const result={attempted:false,selected:null,policyTrees:[],checks:[],reason:'outside-carrier-contact-window'};
 const carrier=o.ball?.kind==='held'?o.players.find(p=>p.id===o.ball.playerId):null;
 if(snapshot?.mode!=='normal'||!carrier||carrier.team!==o.team||!available(o,carrier)||carrier.rooted||carrier.stance!=='standing')return result;
 const until=Math.min(deadline,Date.now()+9000),left=()=>until-Date.now(),end=o.pitch.endZone?.[o.team];
 if(!Number.isFinite(end)||left()<3000)return result;
 result.attempted=true;
 const query=await services.candidates({families:['block','blitz'],maxRushes:0,precision:'none',sort:'steps',limit:24,maxMs:350});
 if(query?.ok!==true)return {...result,reason:'contact-source-discovery-unverified'};
 const seen=new Set(),roots=[...(native||[]),...(query.candidates||[])].filter(c=>{
  const input=c?.input,target=o.players.find(p=>p.id===(input?.blockTarget??input?.blitzTarget));
  if(input?.playerId===carrier.id||!['block','blitz'].includes(input?.action)||c.legal===false||!target||target.team===o.team||!target.pos)return false;
  const forward=(target.pos.x-carrier.pos.x)*Math.sign(end-carrier.pos.x);
  if(dist(target.pos,carrier.pos)>1&&!(forward>=0&&forward<=Math.min(carrier.ma+2,7)&&Math.abs(target.pos.y-carrier.pos.y)<=2))return false;
  const k=JSON.stringify(input);if(seen.has(k))return false;seen.add(k);return true;
 }).map(c=>inspect.canonical(c,o)).filter(Boolean);
 roots.sort((a,b)=>Number(b.input.action==='block')-Number(a.input.action==='block')||inspect.cheapScore(o,b,o.team,inspect.boardValue(o,o.team))-inspect.cheapScore(o,a,o.team,inspect.boardValue(o,o.team)));
 const explore=(input,from)=>services.explore(input,{coachEnumerationDeadline:until,from,team:o.team,perspective:o.team,observations:true,decisions:'builtin',maxOutcomes:128,maxKeep:256,maxLeaves:512,threshold:1e-6,maxMs:Math.min(1500,Math.max(150,left()-200))});
 const advance=async at=>{
  const ob=at.observation,p=ob.players.find(p=>p.id===carrier.id);
  if(!p||!available(ob,p)||p.rooted||p.stance!=='standing'||ob.ball?.kind!=='held'||ob.ball.playerId!==carrier.id)return {stop:true};
  const q=await services.candidates({from:at.key,team:o.team,players:[carrier.id],families:['move'],maxRushes:0,precision:'none',sort:'goalDistance',limit:16,maxMs:350});
  if(q?.ok!==true)return null;
  const rows=(q.candidates||[]).filter(c=>c.legal!==false&&c.input?.action==='move'&&c.input.playerId===carrier.id&&c.input.path?.length&&
   Math.abs(end-c.input.path.at(-1).to.x)<Math.abs(end-p.pos.x)).map(c=>inspect.canonical(c,ob)).filter(Boolean);
  rows.sort((a,b)=>Number(b.kind==='score')-Number(a.kind==='score')||inspect.cheapScore(ob,b,o.team,inspect.boardValue(ob,o.team))-inspect.cheapScore(ob,a,o.team,inspect.boardValue(ob,o.team)));
  if(!rows.length)return {stop:true};const c=rows[0],v=await services.validate(c.input,{from:at.key});
  if(v?.ok!==true||v.legal!==true||v.position!==at.key)return null;
  const ex=await explore(c.input,at.key);if(!completeAction(ex,o.team))return null;
  return {plan:{input:c.input,goal:{id:'contact-carry:'+o.team+':'+o.drive+':'+o.turn[o.team],kind:'carrier-advance',target:c.input.path.at(-1).to}},ex};
 };
 for(const root of roots.slice(0,2)){
  if(left()<3000){result.checks.push({input:root.input,reason:'contact-chain-slot-unavailable'});break;}
  const v=await services.validate(root.input,{});if(v?.ok!==true||v.legal!==true){result.checks.push({input:root.input,reason:'contact-input-not-live-legal'});continue;}
  const ex=await explore(root.input,'root');
  if(!completeAction(ex,o.team)){result.checks.push({input:root.input,reason:'contact-root-chance-incomplete'});continue;}
  const tree={...root,ex,preparedBranches:new Map(),goal:{id:'contact-carry:'+o.team+':'+o.drive+':'+o.turn[o.team],kind:'clear-carrier-route',target:root.input.blockTarget??root.input.blitzTarget,beneficiary:carrier.id}};
  let incomplete=false,followCount=0;
  for(const b of ex.outcomes){
   if(b.turnover||b.touchdown||b.active!==o.team||b.observation?.phase!=='play')continue;
   if(left()<1500||!b.key||!b.observation){incomplete=true;break;}
   const active=b.observation.activation;
   if(active&&!active.over&&active.playerId!==carrier.id){
    const input={kind:'endActivation'},valid=await services.validate(input,{from:b.key});
    if(valid?.ok!==true||valid.legal!==true){incomplete=true;break;}
    const closed=await explore(input,b.key);if(!completeAction(closed,o.team)){incomplete=true;break;}
    const dependency={plan:{input,goal:tree.goal},ex:closed,preparedBranches:new Map()};
    for(const next of closed.outcomes){
     if(next.turnover||next.touchdown||next.active!==o.team||next.observation?.phase!=='play')continue;
     const f=await advance(next);if(!f){incomplete=true;break;}if(!f.stop){dependency.preparedBranches.set(next.key,f);followCount++;}
    }
    if(incomplete)break;tree.preparedBranches.set(b.key,dependency);
   }else{
    const f=await advance(b);if(!f){incomplete=true;break;}if(!f.stop){tree.preparedBranches.set(b.key,f);followCount++;}
   }
  }
  if(incomplete||!followCount){result.checks.push({input:root.input,reason:incomplete?'contact-follow-chance-or-source-incomplete':'contact-has-no-live-carrier-follow'});continue;}
  const bound=await buildProtectionPolicy(o,tree,services,inspect,until,{extend:false});
  result.checks.push({input:root.input,followCount,complete:bound.complete,reason:bound.reason??'contact-carry-own-End-certified'});
  if(bound.complete)result.policyTrees.push(bound.tree);
 }
 return {...result,reason:result.policyTrees.length?'contact-carry-proposals-require-common-comparison':'no-complete-contact-carry-policy',discovered:roots.length};
}
