import {same} from './policy.mjs';
import {challengeContinuation} from './continuation.mjs';
const dist=(a,b)=>a&&b?Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y)):Infinity;
/** Capability discovery supplies legal tools to the same team objective. No
 * roster-name or special-action reward is added to the frozen value function. */
export async function discoverMechanismTasks(o,services,deadline){
 const result={attempted:false,candidates:[],coverage:[],reason:'outside-current-special-window'};
 if(o.phase!=='play'||o.pending||o.active!==o.team||!services.legalChoices||!services.legalTargets||!services.validate||deadline-Date.now()<300)return result;
 const carrier=o.ball?.kind==='held'?o.players.find(p=>p.id===o.ball.playerId):null;
 const foes=o.players.filter(p=>p.team!==o.team&&p.location==='pitch'&&p.pos&&p.stance==='standing');
 let anchor=carrier?.team!==o.team?carrier?.pos:o.ball?.kind==='ground'?o.ball.pos:null;
 if(!anchor&&carrier?.team===o.team)anchor=foes.filter(p=>dist(p.pos,carrier.pos)<=3).sort((a,b)=>dist(a.pos,carrier.pos)-dist(b.pos,carrier.pos))[0]?.pos;
 if(!anchor||!foes.some(p=>dist(p.pos,anchor)<=2))return result;
 result.attempted=true;const until=Math.min(deadline,Date.now()+1000);let choices;
 try{choices=await services.legalChoices({team:o.team});}catch{return {...result,reason:'special-choice-discovery-failed'};}
 if(choices?.ok!==true||choices.owner!==o.team||choices.node!=='action')return {...result,reason:'special-choice-owner-or-phase-mismatch'};
 const add=async input=>{if(Date.now()>until-50)return;let r;try{r=await services.validate(input,{});}catch{return;}
  if(r?.ok===true&&r.legal===true)result.candidates.push({input,source:'authoritative-legal-choice',goal:'ball-relevant-contact-or-space',geometricHintOnly:true});};
 for(const type of ['special:bombardier','special:ballAndChain']){
  const choice=choices.choices?.find(c=>c.type===type);if(!choice)continue;
  const actors=(choice.actors||[]).filter(a=>a.enabled).map(a=>o.players.find(p=>p.id===a.playerId)).filter(p=>p?.team===o.team&&p.location==='pitch'&&p.pos);
  result.coverage.push({type,eligibleActors:actors.length,queriedActors:0,complete:false});const coverage=result.coverage.at(-1);
  for(const actor of actors.slice(0,1)){
   if(Date.now()>until-150)break;coverage.queriedActors++;
   const base={kind:'playerAction',playerId:actor.id,action:'special',special:type.slice(8),path:[]};
   if(type==='special:bombardier'){
    if(carrier?.team===o.team&&same(anchor,carrier.pos))continue;
    let targets;try{targets=await services.legalTargets({choice:type,actor:actor.id,param:'bombTarget',partial:base,
     region:{x0:Math.max(0,anchor.x-1),x1:Math.min(o.pitch.width-1,anchor.x+1),y0:Math.max(0,anchor.y-1),y1:Math.min(o.pitch.height-1,anchor.y+1)},limit:16,maxMs:Math.max(50,Math.min(400,until-Date.now()-50))});}catch{continue;}
    const legal=(targets?.values||[]).filter(t=>t.legal&&Number.isInteger(t.value?.x)&&Number.isInteger(t.value?.y));
    legal.sort((a,b)=>dist(a.value,anchor)-dist(b.value,anchor));
    for(const t of legal.slice(0,2))await add({...base,bombTarget:t.value});
   }else{
    // Pinned catalogue's compass enum is wrong. These are the engine's actual
    // documented axis values, each still checked by authoritative validation.
    const directions=[['x-',-1,0],['x+',1,0],['y-',0,-1],['y+',0,1]];
    directions.sort((a,b)=>((anchor.x-actor.pos.x)*b[1]+(anchor.y-actor.pos.y)*b[2])-((anchor.x-actor.pos.x)*a[1]+(anchor.y-actor.pos.y)*a[2]));
    for(const [facing] of directions.slice(0,2))await add({...base,facing});
   }
  }
 }
 result.reason=result.candidates.length?'bounded-ball-relevant-specials-discovered':'no-legal-relevant-special';return result;
}
export async function challengeMechanisms(o,snapshot,services,inspect,deadline){
 const result={attempted:false,selected:null,reason:'no-special-comparison',discovery:null,policies:[]};
 if(snapshot?.mode!=='normal'||!snapshot.selected?.ex||deadline-Date.now()<4000)return result;
 const until=Math.min(deadline,Date.now()+9000),discovery=await discoverMechanismTasks(o,services,until-3000);
 result.discovery=discovery;if(!discovery.candidates.length)return {...result,reason:discovery.reason};
 result.attempted=true;
 const options=discovery.candidates.filter(c=>!(snapshot.lines||[]).some(l=>same(l.input,c.input)));
 for(const c of options.slice(0,2)){
  if(until-Date.now()<3000)break;
  const compared=await challengeContinuation(o,snapshot,{input:c.input,validated:true},services,inspect,until);
  (result.policyTrees??=[]).push(...(compared.policyTrees||[]));
  result.policies.push({input:c.input,reason:compared.reason,evidence:compared.evidence});
  if(compared.selected)return {...result,selected:compared.selected,reason:'legal-special-clears-current-common-horizon',evidence:compared.evidence};
 }
 return {...result,reason:'special-does-not-clear-current-common-evidence'};
}
