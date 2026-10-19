import {same,completeAction} from './policy.mjs';
import {protectionReady} from './availability.mjs';
import {buildProtectionPolicy} from './protection.mjs';
/** Independent executable helper -> pickup discovery. These are proposals
 * for common comparison, never winners endorsed merely by discovery. */
export async function discoverPickupProtection(o,selected,services,inspect,deadline){
 const result={attempted:false,selected:null,policyTrees:[],reason:'outside-loose-ball-protection-window',rejections:[]};
 const picker=o.players?.find(p=>p.id===selected?.input?.playerId),ball=o.ball?.pos;
 if(o.ball?.kind!=='ground'||!ball||o.pending||o.active!==o.team||!picker||
  !['move','secure'].includes(selected?.input?.action)||!services.candidates||deadline-Date.now()<2000)return result;
 const guards=o.players.filter(p=>p.team===o.team&&p.id!==picker.id&&protectionReady(o,p));
 const cells=[];
 for(let dx=-2;dx<=2;dx++)for(let dy=-2;dy<=2;dy++)if(dx||dy){const to={x:ball.x+dx,y:ball.y+dy};
  if(to.x>=0&&to.y>=0&&to.x<o.pitch.width&&to.y<o.pitch.height&&!o.players.some(p=>p.pos&&same(p.pos,to)))cells.push(to);
 }
 if(!guards.length||!cells.length)return {...result,reason:'no-ready-loose-ball-protector'};
 result.attempted=true;
 const until=Math.min(deadline,Date.now()+4200),left=()=>until-Date.now();
 const sourceMatched=(ex,from)=>ex?.position?.key===from&&ex.perspective===o.team&&ex.activeTeam===o.team&&
  ex.outcomeIdentity==='complete-state-v1'&&ex.decisionPolicy?.mode==='builtin'&&ex.decisionPolicy.own==='builtin'&&ex.decisionPolicy.opponent==='builtin';
 try{
  const found=await services.candidates({from:'root',team:o.team,players:guards.map(p=>p.id),families:['move'],
   region:{within:cells},maxRushes:0,precision:'none',sort:'steps',limit:24,maxMs:250});
  if(found?.ok!==true||found.position?.key!=='root')return {...result,reason:'loose-ball-protector-source-unverified'};
  const rows=(found.candidates||[]).filter(c=>c.legal!==false&&c.input?.action==='move'&&c.input.path?.length&&
   guards.some(p=>p.id===c.input.playerId)&&cells.some(to=>same(to,c.input.path.at(-1).to)))
   .map(c=>inspect.canonical(c,o)).filter(Boolean);
  rows.sort((a,b)=>inspect.cheapScore(o,b,o.team,inspect.boardValue(o,o.team))-inspect.cheapScore(o,a,o.team,inspect.boardValue(o,o.team)));
  for(const helper of rows.slice(0,2)){
   if(left()<1600){result.rejections.push('pickup-protection-budget');break;}
   const helperLegal=await services.validate(helper.input,{from:'root'});
   if(helperLegal?.ok!==true||helperLegal.legal!==true||helperLegal.position!=='root'){
    result.rejections.push('protector-not-legal-at-root');continue;
   }
   if(left()<150){result.rejections.push('pickup-protection-budget');break;}
   const prep=await services.explore(helper.input,{from:'root',team:o.team,perspective:o.team,observations:true,
    decisions:'builtin',maxOutcomes:128,maxKeep:256,maxLeaves:4000,threshold:1e-6,maxMs:Math.min(1000,left()-100)});
   if(!completeAction(prep,o.team)||prep.outcomes.length!==1||prep.outcomes[0].p<1-1e-8||
    !sourceMatched(prep,'root')||prep.outcomes[0].turnover||prep.outcomes[0].active!==o.team||
    !prep.outcomes[0].key||prep.outcomes[0].observation?.active!==o.team||prep.outcomes[0].observation?.ball?.kind!=='ground'){
    result.rejections.push('protector-not-complete-roll-free');continue;
   }
   const b=prep.outcomes[0],tree={...helper,ex:prep,label:'Protect loose ball then attempt pickup',preparedBranches:new Map()};
   const bindPickup=async(at,branches)=>{
    if(at.active!==at.observation?.active){result.rejections.push('pickup-protection-successor-unverified');return false;}
    if(at.turnover||at.touchdown||at.active!==o.team||['fullTime','halfOver','touchdown'].includes(at.observation?.phase))return true;
    if(left()<150||!at.key||!at.observation){result.rejections.push('pickup-protection-successor-unverified');return false;}
    if(at.observation.ball?.kind!=='ground')return true;
    const valid=await services.validate(selected.input,{from:at.key});
    if(valid?.ok!==true||valid.legal!==true||valid.position!==at.key){result.rejections.push('pickup-not-legal-after-protection');return false;}
    // The builder explores the picker from THIS actual successor, never from
    // selected.ex's old root or another dependency's child key.
    branches.set(at.key,{plan:{input:selected.input}});return true;
   };
   const active=b.observation.activation;
   if(left()<150){result.rejections.push('pickup-protection-budget');continue;}
   // The engine may implicitly close a different actor's activation. Only a
   // verified legal input at this real helper successor can use that route.
   const direct=await services.validate(selected.input,{from:b.key});
   if(direct?.ok!==true||direct.position!==b.key||typeof direct.legal!=='boolean'){
    result.rejections.push('pickup-after-protection-legality-unverified');continue;
   }
   if(direct.legal)tree.preparedBranches.set(b.key,{plan:{input:selected.input}});
   else if(active&&!active.over&&active.playerId!==picker.id){
    if(left()<150){result.rejections.push('pickup-protection-budget');continue;}
    const input={kind:'endActivation'},valid=await services.validate(input,{from:b.key});
    if(valid?.ok!==true||valid.legal!==true||valid.position!==b.key){result.rejections.push('protector-activation-not-closable');continue;}
    if(left()<150){result.rejections.push('pickup-protection-budget');continue;}
    const closed=await services.explore(input,{from:b.key,team:o.team,perspective:o.team,observations:true,
     coachEnumerationDeadline:until,decisions:'builtin',maxOutcomes:128,maxKeep:256,maxLeaves:4000,threshold:1e-6,maxMs:Math.min(1000,left()-100)});
    if(!sourceMatched(closed,b.key)||!completeAction(closed,o.team)){result.rejections.push('protector-activation-closure-incomplete');continue;}
    const dependency={plan:{input},ex:closed,preparedBranches:new Map()};let complete=true;
    for(const next of closed.outcomes)if(!await bindPickup(next,dependency.preparedBranches)){complete=false;break;}
    if(!complete)continue;tree.preparedBranches.set(b.key,dependency);
   }else {result.rejections.push('pickup-not-legal-after-protection');continue;}
   const bound=await buildProtectionPolicy(o,tree,services,inspect,until);
   if(!bound.complete){result.rejections.push(bound.reason);continue;}
   const pickedUp=node=>(same(node.input,selected.input)&&node.ex?.outcomes?.some(c=>!c.turnover&&
    c.observation?.ball?.kind==='held'&&c.observation.ball.playerId===picker.id))||
    [...(node.preparedBranches?.values()||[])].some(child=>pickedUp({...child.plan,ex:child.ex,preparedBranches:child.preparedBranches}));
   if(!pickedUp(bound.tree)){
    result.rejections.push('follow-up-does-not-pick-up-ball');continue;
   }
   result.policyTrees.push(bound.tree);
  }
  result.reason=result.policyTrees.length?'source-bound-protection-pickup-proposals; common-comparison-required':'no-complete-protection-pickup-proposal';
 }catch(e){result.reason='pickup-protection-service-failed';result.error=String(e).slice(0,160);}
 return result;
}
