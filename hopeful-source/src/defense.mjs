import {compareReceiverThreats} from './receiver-defense.mjs';
import {completeAction,same,weightedPolicyValue,endorseContinuation,policyFrom} from './policy.mjs';
const EPS=1e-8,n=(x,d=0)=>Number.isFinite(x)?x:d,key=i=>JSON.stringify(i);
/** Reserve a few public, real own-phase endpoints before the champion search.
 * The reservation never selects or executes an input. */
export async function reserveDefenseTerminals(o,native,services,inspect,deadline){
 const started=Date.now(),until=Math.min(deadline,started+4000),opp=o.team==='A'?'B':'A';
 const reservation={attempted:false,records:[],routeSeeds:[],contactTransitions:[],reason:'no-complete-standing-wall',elapsedMs:0,ownClosures:new Map()};
 const carrier=o.players?.find(p=>p.id===o.ball?.playerId);
 reservation.ownClosureEnabled=o.phase==='play'&&!o.pending&&o.active===o.team&&o.turn?.[o.team]===o.turnsPerHalf-1&&o.turn?.[opp]===o.turnsPerHalf-1&&carrier?.team===opp;
 if(n(o.turn?.[o.team])>=n(o.turnsPerHalf,Infinity)||o.phase!=='play'||o.pending||o.ball?.kind!=='held'||carrier?.team!==opp)return reservation;
 const goal=o.pitch?.endZone?.[opp]??(opp==='A'?o.pitch.width-1:0),dir=Math.sign(goal-carrier.pos.x);
 const groups=new Map();for(const p of o.players||[]){if(p.team!==o.team||p.location!=='pitch'||p.stance!=='standing'||dir*(p.pos.x-carrier.pos.x)<=0||dir*(p.pos.x-carrier.pos.x)>4)continue;
  if(!groups.has(p.pos.x))groups.set(p.pos.x,[]);groups.get(p.pos.x).push(p);}
 const walls=[...groups.values()].filter(ps=>{const ys=ps.map(p=>p.pos.y).sort((a,b)=>a-b);return ys.some(y=>ys.includes(y+2)&&ys.includes(y+4));});
 if(!walls.length)return reservation;reservation.attempted=true;const anchors=new Set(walls.flat().map(p=>p.id));
 const ready=(o.players||[]).filter(p=>p.team===o.team&&p.location==='pitch'&&p.stance==='standing'&&!p.activated);
 if(ready.some(p=>!anchors.has(p.id))){reservation.attempted=false;reservation.reason='non-anchor-helper-still-available';return reservation;}
 const moves=(native||[]).map(c=>inspect.canonical(c,o)).filter(c=>c?.family==='move'&&anchors.has(c.actorId)&&c.input.path?.length&&c.input.path.at(-1).to.x!==o.players.find(p=>p.id===c.actorId).pos.x);
 const inputs=[{kind:'endTurn'},...[...new Map(moves.map(c=>[key(c.input),c.input])).values()].slice(0,2)];
 const ex=async(input,from,team=o.team)=>{if(Date.now()>until-40)return null;try{return await services.explore(input,{coachEnumerationDeadline:until,...(from?{from}:{}),team,perspective:o.team,observations:true,decisions:'builtin',maxOutcomes:128,maxKeep:128,maxLeaves:8000,threshold:.00001,maxMs:Math.max(20,Math.min(350,until-Date.now()-30))});}catch{return null;}};
 for(const input of inputs){const first=await ex(input);const record={input,ex:first,states:[],complete:false};reservation.records.push(record);
  if(!completeAction(first,o.team)||first.outcomes.some(b=>!b.key))continue;let complete=true;
  for(const b of first.outcomes){if(b.touchdown){complete=false;break;}if(b.observation?.active===opp||b.active===opp){record.states.push({...b,turnover:false,ownTurnover:!!b.turnover});continue;}
   const closed=await ex({kind:'endTurn'},b.key);if(!completeAction(closed,o.team)||closed.outcomes.some(f=>!f.key||(f.active??f.observation?.active)!==opp)){complete=false;break;}
   for(const f of closed.outcomes)record.states.push({...f,p:b.p*f.p,turnover:false,ownTurnover:!!b.turnover});}
  record.complete=complete&&Math.abs(record.states.reduce((v,b)=>v+b.p,0)-1)<=EPS;
  if(record.complete&&input.kind==='endTurn'&&Date.now()<until-300){try{
   const at=record.states[0];const q=await services.candidates({from:at.key,team:opp,families:['blitz'],maxRushes:0,precision:'none',limit:100,sort:'steps',maxMs:150});
   const contacts=(q?.candidates||[]).filter(c=>{if(c.input?.playerId===carrier.id)return false;const target=at.observation.players.find(p=>p.id===(c.input.blitzTarget||c.input.blockTarget));return target?.pos&&dir*(target.pos.x-carrier.pos.x)>0&&dir*(target.pos.x-carrier.pos.x)<=4&&Math.abs(target.pos.y-carrier.pos.y)<=dir*(target.pos.x-carrier.pos.x)+1;}).slice(0,1);
   for(const contact of contacts){if(Date.now()>until-150)break;reservation.sharedContacts=contacts.map(c=>c.input);const hit=await ex(contact.input,at.key,opp);
    const best=(hit?.outcomes||[]).filter(b=>b.key&&b.observation&&!b.turnover).sort((a,b)=>b.p-a.p)[0];if(!best)continue;
    let state=best;if(best.observation.activation&&!best.observation.activation.over&&best.observation.activation.playerId!==carrier.id){const close=await ex({kind:'endActivation'},best.key,opp);if(!close?.outcomes?.[0]?.key)continue;state=close.outcomes[0];}
    const routes=await services.candidates({from:state.key,team:opp,players:[carrier.id],families:['move'],region:{x0:goal,x1:goal},precision:'none',limit:16,sort:'steps',maxMs:150});
    for(const c of (routes?.ok?routes.candidates||[]:[]).filter(c=>c.kind==='score').slice(0,1))reservation.routeSeeds.push({input:c.input,holder:state.observation.players.find(p=>p.id===carrier.id),activation:state.observation.activation,contact:contact.input,from:state.key});
   }
  }catch{}}
 }
 await reserveContactEndpoints(reservation,reservation.records,o,carrier,goal,ex,services,until);
 reservation.reason='public-own-phase-endpoints-reserved';reservation.elapsedMs=Date.now()-started;return reservation;
}
async function reserveContactEndpoints(reservation,records,o,carrier,goal,ex,services,until){
 const opp=o.team==='A'?'B':'A';
 for(const record of records.filter(r=>r.complete)){for(const at of record.states){for(const input of reservation.sharedContacts||[]){if(Date.now()>until-50)break;
  const hit=await ex(input,at.key,opp);if(!hit?.ok)continue;const retained=[];
  for(const b of [...(hit.outcomes||[]).filter(b=>b.observation&&(b.touchdown||b.turnover)),...(hit.outcomes||[]).filter(b=>b.key&&b.observation&&!b.touchdown&&!b.turnover).sort((a,b)=>b.p-a.p).slice(0,6)]){let replyAt=b;
   if(!b.turnover&&!b.touchdown&&b.observation.activation&&!b.observation.activation.over&&b.observation.activation.playerId!==carrier.id){const close=await ex({kind:'endActivation'},b.key,opp);if(!completeAction(close,opp)||close.outcomes.length!==1||!close.outcomes[0].key)continue;replyAt={...close.outcomes[0],p:1};}
   retained.push({...b,replyAt});}
  reservation.contactTransitions.push({from:at.key,input,ex:{...hit,outcomes:retained}});
  const best=retained.filter(b=>!b.turnover&&!b.touchdown&&b.replyAt?.key).sort((a,b)=>b.p-a.p)[0]?.replyAt;
  if(best&&Date.now()<until-100){try{const routes=await services.candidates({from:best.key,team:opp,players:[carrier.id],families:['move'],region:{x0:goal,x1:goal},precision:'none',limit:16,sort:'steps',maxMs:150});
   for(const c of (routes?.ok?routes.candidates||[]:[]).filter(c=>c.kind==='score').slice(0,1))reservation.routeSeeds.push({input:c.input,holder:best.observation.players.find(p=>p.id===carrier.id),activation:best.observation.activation,contact:input,from:best.key});}catch{}}

 }}}
}
/** Observe an actual root exploration; preserve its values and input order. */
export async function captureDefenseTerminal(reservation,o,input,options,first,services,inspect,deadline){
 const started=Date.now(),spent=n(reservation?.elapsedMs),until=Math.min(deadline,started+Math.max(0,4000-spent));
 const opp=o.team==='A'?'B':'A',carrier=o.players?.find(p=>p.id===o.ball?.playerId);
 // Retain already observed own closures while their real keys still exist.
 // This adds no engine work and never captures another team's phase.
 const from=options?.from||'root';
 if(reservation?.ownClosureEnabled&&['endTurn','endActivation'].includes(input?.kind)&&
  first?.outcomeIdentity==='complete-state-v1'&&first.position?.key===from&&first.perspective===o.team&&first.activeTeam===o.team&&
  first.decisionPolicy?.mode==='builtin'&&first.decisionPolicy.own==='builtin'&&first.decisionPolicy.opponent==='builtin'&&
  completeAction(first,o.team)&&first.outcomes.every(b=>b.key&&b.observation)&&reservation.ownClosures.size<24)
  reservation.ownClosures.set(JSON.stringify([from,o.team,input]),first);
 // Explore retains the pre-advance own Turn on some TO leaves. Close these
 // observed failures early; the champion's normal reply search skips them.
 if(reservation?.ownClosureEnabled&&from==='root'&&input?.kind==='playerAction'&&input.action==='move'&&
  n(first?.pTurnover)>EPS&&completeAction(first,o.team)&&first.outcomes.every(b=>b.key&&b.observation)&&
  n(reservation.failureClosureInputs)<2&&n(reservation.failureClosureMs)<1000){
  reservation.failureClosureInputs=n(reservation.failureClosureInputs)+1;const at=Date.now(),stop=Math.min(deadline,at+1000-n(reservation.failureClosureMs));
  try{for(const b of first.outcomes.filter(b=>b.turnover&&b.active===o.team)){
   if(Date.now()>stop-70||reservation.ownClosures.size>=24)break;
   const next={kind:'endTurn'},closed=await services.explore(next,{from:b.key,team:o.team,perspective:o.team,observations:true,decisions:'builtin',maxOutcomes:8,maxKeep:16,maxLeaves:512,maxMs:Math.max(40,Math.min(120,stop-Date.now()-40))});
   if(closed?.outcomeIdentity==='complete-state-v1'&&closed.position?.key===b.key&&closed.perspective===o.team&&closed.activeTeam===o.team&&
    completeAction(closed,o.team)&&closed.outcomes.every(c=>c.key&&c.observation))reservation.ownClosures.set(JSON.stringify([b.key,o.team,next]),closed);
  }}finally{reservation.failureClosureMs=n(reservation.failureClosureMs)+Date.now()-at;}
 }
 if(!reservation?.attempted||until-started<80||options?.from&&options.from!=='root'||options?.team&&options.team!==o.team||
  input?.kind!=='playerAction'||input.action!=='move'||input.blockTarget||input.blitzTarget||input.special||
  !completeAction(first,o.team)||n(first.pTurnover,1)>EPS||n(first.pTouchdown)>EPS||first.outcomes.some(b=>!b.key))return reservation;
 const c=inspect.canonical({input},o),actor=o.players.find(p=>p.id===c.actorId),to=input.path?.at(-1)?.to;
 if(c.family!=='move'||!actor||actor.activated||actor.stance!=='standing'||!to||same(to,actor.pos)||
  reservation.records.some(r=>r.complete&&same(r.input,c.input)))return reservation;
 // The preflight records the original late-wall scope; require the same root
 // player to be one of its standing goalward column anchors.
 const goal=o.pitch?.endZone?.[opp]??(opp==='A'?o.pitch.width-1:0),dir=Math.sign(goal-carrier.pos.x);
 const peers=o.players.filter(p=>p.team===o.team&&p.location==='pitch'&&p.stance==='standing'&&p.pos.x===actor.pos.x);
 const ys=peers.map(p=>p.pos.y),wall=ys.some(y=>ys.includes(y+2)&&ys.includes(y+4));
 if(!wall||dir*(actor.pos.x-carrier.pos.x)<=0||dir*(actor.pos.x-carrier.pos.x)>4)return reservation;
 const ex=async(next,from,team=o.team)=>{if(Date.now()>until-40)return null;try{return await services.explore(next,{coachEnumerationDeadline:until,from,team,perspective:o.team,observations:true,decisions:'builtin',maxOutcomes:128,maxKeep:128,maxLeaves:8000,threshold:.00001,maxMs:Math.max(20,Math.min(350,until-Date.now()-30))});}catch{return null;}};
 const record={input:c.input,ex:first,states:[],complete:false,capturedRoot:true};reservation.records.push(record);
 try{let complete=true;for(const b of first.outcomes){if(b.touchdown){complete=false;break;}if((b.active??b.observation?.active)===opp){record.states.push({...b,turnover:false,ownTurnover:!!b.turnover});continue;}
   const closed=await ex({kind:'endTurn'},b.key);if(!completeAction(closed,o.team)||closed.outcomes.some(f=>!f.key||(f.active??f.observation?.active)!==opp)){complete=false;break;}
   for(const f of closed.outcomes)record.states.push({...f,p:b.p*f.p,turnover:false,ownTurnover:!!b.turnover});}
  record.complete=complete&&Math.abs(record.states.reduce((v,b)=>v+b.p,0)-1)<=EPS;
  if(record.complete)await reserveContactEndpoints(reservation,[record],o,carrier,goal,ex,services,until);
 }finally{reservation.elapsedMs=spent+Date.now()-started;reservation.captures=n(reservation.captures)+1;}
 return reservation;
}
/** Two roll-free screen alternatives, shared legal-contact inputs and actual
 * carrier continuations and one actual own support action. This bounded search makes no whole-Turn safety claim. */
export async function challengeDefense(o,snapshot,native,services,inspect,deadline,reservation=null){
 const start=Date.now(),until=Math.min(deadline,start+15000),left=()=>until-Date.now();
 const selected=snapshot?.selected,opp=o.team==='A'?'B':'A',car=o.players?.find(p=>p.id===o.ball?.playerId);
 const result={selected:null,attempted:false,reason:'outside-safe-defense-scope',evidence:{scope:'at most two own inputs, own-phase closure; End/ownTO terminal; same retained teammate contact inputs then carrier direct score',policies:[],queries:[],sharedContacts:[],ownUncertainty:[]}};
 if(snapshot?.mode!=='normal'||o.ball?.kind!=='held'||car?.team!==opp||
  !['move','endActivation','endTurn'].includes(selected?.family)||!completeAction(selected?.ex,o.team)||
  left()<2000)return result;
 result.attempted=true;
 const cap=ms=>Math.max(20,Math.min(ms,left()-40));
 const call=async(method,args)=>{if(left()<80)return null;try{return await services[method](...args);}catch{return null;}};
 const explored=new Map();
 const explore=async(input,from,team=o.team,ms=450)=>{if(typeof from!=='string'||!from)return null;
  const signature=JSON.stringify([from,team,input]);const retained=reservation?.ownClosures?.get(signature);if(retained)return retained;
  if(explored.has(signature))return explored.get(signature);
  // A common input pool is a union of proposals, not a shared legality
  // certificate. A screen move can invalidate another endpoint's Blitz or
  // scoring route. Ask the engine about this exact source before exploration.
  if(team===opp){
   const v=typeof services.validate==='function'?await call('validate',[input,{from,team}]):null;
   const bound=v?.ok===true&&v.position===from&&typeof v.legal==='boolean';
   const row={from,input,verified:bound,legal:bound?v.legal:null,code:v?.code??null,errors:v?.errors};
   (result.evidence.sharedInputValidation??=[]).push(row);
   if(!bound)return {ok:false,code:'shared-input-validation-unverified'};
   if(!v.legal)return {ok:false,code:'shared-input-illegal-at-source',sourceValidation:{from,team,legal:false},errors:v.errors};
  }
  const ex=await call('explore',[input,{from,team,perspective:o.team,
  observations:true,decisions:'builtin',maxOutcomes:128,maxKeep:256,maxLeaves:8000,threshold:0.00001,maxMs:cap(ms)}]);
  if(ex?.ok&&missing(ex)<=EPS&&ex.outcomes?.every(b=>b.key))explored.set(signature,ex);return ex;};
 const query=async(q)=>{const validFrom=!Object.hasOwn(q,'from')||typeof q.from==='string'&&!!q.from;
  const r=validFrom?await call('candidates',[{...q,precision:'none',maxMs:cap(300)}]):null;
  result.evidence.queries.push({query:q,ok:r?.ok,returned:r?.candidates?.length,hasMore:r?.hasMore,truncated:r?.truncated});return r;};
 const candidateList=r=>r?.ok===true&&Array.isArray(r.candidates)&&r.candidates.every(c=>c&&typeof c.input==='object'&&c.input!==null);
 const listed=r=>candidateList(r)&&!r.hasMore&&!(r.truncated?.length)&&r.complete!==false;
 const missing=ex=>Math.min(1,Math.max(0,1-(ex?.outcomes||[]).filter(b=>b.observation).reduce((v,b)=>v+n(b.p),0),n(ex?.unresolvedMass),n(ex?.rest?.p)));
 const gx=o.pitch?.endZone?.[opp]??(opp==='A'?o.pitch.width-1:0),dir=Math.sign(gx-car.pos.x),
  depth=car.pos.x+dir*Math.min(4,Math.max(1,Math.floor(car.ma/2)));
 const anchors=o.players.filter(p=>p.team===o.team&&p.location==='pitch'&&p.stance==='standing'&&
  dir*(p.pos.x-car.pos.x)>0&&dir*(p.pos.x-car.pos.x)<=4);
 const cells=anchors.flatMap(p=>[-2,2].map(dy=>({x:p.pos.x,y:p.pos.y+dy,anchor:p.id}))).filter(p=>p.y>=0&&p.y<o.pitch.height);
 const generated=await query({families:['move'],region:{within:cells.map(({x,y})=>({x,y}))},maxRushes:0,limit:100,sort:'steps'});
 const firstAnchors=new Set(o.players.filter(p=>p.team===o.team&&p.stance==='standing'&&cells.some(t=>t.x===p.pos?.x&&Math.abs(t.y-p.pos.y)<=2)).map(p=>p.id));
 const options=[...(generated?.candidates||[]),...native].map(c=>inspect.canonical(c,o)).filter(c=>c?.family==='move'&&
  !firstAnchors.has(c.actorId)&&!same(c.input,selected.input)&&c.input.path?.length&&!c.rushes&&(!Number.isFinite(c.pTurnover)||c.pTurnover<=EPS));
 const unique=[...new Map(options.map(c=>[key(c.input),c])).values()];
 const priority=c=>{const d=c.input.path.at(-1).to,paired=cells.find(p=>p.x===d.x&&p.y===d.y&&p.anchor!==c.actorId);
  return (paired?0:50)+Math.abs(d.x-depth)+Math.abs(d.y-car.pos.y)*.25+c.input.path.length*.02;};
 unique.sort((a,b)=>priority(a)-priority(b));
 const actors=new Set(),screens=unique.filter(c=>{if(actors.has(c.actorId))return false;actors.add(c.actorId);return true;}).slice(0,2);
 const stop=inspect.canonical({input:{kind:'endTurn'}},o);
 const reserveStop=!!reservation?.attempted||n(selected.ex.pTurnover)>EPS||!screens.length;
 const reserved=[...(reserveStop&&!same(stop.input,selected.input)?[stop]:[]),...screens];
 result.evidence.reserved=reserved.map(c=>c.input);
 // Preserve full retained own dependencies; new screen discovery remains bounded.
 const matchingRecord=c=>(reservation?.records||[]).find(r=>r.complete&&same(r.input,c.input)&&completeAction(r.ex,o.team)&&
  r.states?.length&&r.states.every(b=>b.key&&b.observation)&&
  (c!==selected||!selected.preparedBranches?.size)&&
  (c!==selected||['pTurnover','pTouchdown'].every(k=>Math.abs(n(r.ex[k])-n(c.ex[k]))<=EPS)));
 const policies=[];
 for(const c of [selected,...reserved]){
  if(left()<1600)break;const saved=matchingRecord(c);const ex=saved?saved.ex:c===selected?c.ex:await explore(c.input,'root');
  if(!completeAction(ex,o.team)||(c!==selected&&n(ex.pTurnover,1)>EPS))continue;
  const states=saved?saved.states.map(b=>({...b})):[],prepared=new Map();let complete=true;
  for(const b of (saved?[]:ex.outcomes)){if(b.touchdown||!b.key||!b.observation){complete=false;
   if(!b.key||!b.observation)result.evidence.ownUncertainty.push({input:c.input,unknown:n(b.p),reason:'unretained-first-own-outcome'});break;}
   if(b.active===opp)continue;
   if(b.active!==o.team){complete=false;break;}
   if(b.turnover)continue;
   // Keep already occupying screen columns. One additional actor fills a missing
   // slot; both competitors receive exactly this same two-input opportunity.
   const protectedActors=new Set(b.observation.players.filter(p=>p.team===o.team&&p.stance==='standing'&&
    cells.some(t=>t.x===p.pos?.x&&Math.abs(t.y-p.pos.y)<=2)).map(p=>p.id));
   const occupied=new Set(b.observation.players.filter(p=>p.location==='pitch').map(p=>JSON.stringify(p.pos)));
   const slots=cells.filter(t=>!occupied.has(JSON.stringify({x:t.x,y:t.y})));
   const q=await query({from:b.key,families:['move'],region:{within:slots.map(({x,y})=>({x,y}))},maxRushes:0,limit:100,sort:'steps'});
   const helpers=(q?.candidates||[]).map(h=>inspect.canonical(h,b.observation)).filter(h=>h?.family==='move'&&h.input.path?.length&&
    !protectedActors.has(h.actorId)&&h.actorId!==c.actorId&&!h.rushes);
   helpers.sort((a,z)=>a.input.path.length-z.input.path.length||Math.abs(a.input.path.at(-1).to.x-depth)-Math.abs(z.input.path.at(-1).to.x-depth));
   let follow=c===selected?selected.preparedBranches?.get(b.key):null;
   if(follow&&!completeAction(follow.ex,o.team)){complete=false;break;}
   for(const h of (follow?[]:helpers.slice(0,4))){if(left()<700)break;const fx=await explore(h.input,b.key);
    if(completeAction(fx,o.team)&&n(fx.pTurnover,1)<=EPS){follow={ex:fx,plan:{input:h.input}};break;}}
   if(!follow){for(const input of [{kind:'endActivation'},{kind:'endTurn'}]){const fx=await explore(input,b.key);
    if(completeAction(fx,o.team)&&n(fx.pTurnover,1)<=EPS&&fx.outcomes.every(b=>b.key&&b.observation)){follow={ex:fx,plan:{input}};break;}}}
   if(!follow){complete=false;break;}
   const unretained=follow.ex.outcomes.filter(f=>!f.key||!f.observation);
   if(unretained.length){complete=false;result.evidence.ownUncertainty.push({input:c.input,from:b.key,
    unknown:b.p*unretained.reduce((v,f)=>v+n(f.p),0),reason:'unretained-own-follow-up'});break;}
   prepared.set(b.key,follow);
  }
  if(!complete)continue;
  const policy=policyFrom({...c,ex},prepared,o.team,inspect);if(!completeAction(policy.ex,o.team))continue;
  // Close from the SAME complete conditional leaves used for scalar value.
  // A third dependency must not be priced while replies start after only two.
  if(!saved)for(const leaf of policy.ex.outcomes){
   if(leaf.touchdown||!leaf.key||!leaf.observation){complete=false;
    result.evidence.ownUncertainty.push({input:c.input,unknown:n(leaf.p),reason:'unretained-complete-policy-leaf'});break;}
   if(leaf.active===opp){states.push({...leaf,turnover:false,ownTurnover:!!leaf.turnover});continue;}
   if(leaf.active!==o.team){complete=false;break;}
   const close=await explore({kind:'endTurn'},leaf.key);
   if(!completeAction(close,o.team)||close.outcomes.some(at=>!at.key||!at.observation)){complete=false;break;}
   for(const at of close.outcomes)states.push({...at,p:leaf.p*at.p,turnover:false,ownTurnover:!!leaf.turnover});
  }
  if(!complete||states.some(s=>s.active!==opp))continue;
  policies.push({candidate:{...c,ex,preparedBranches:prepared},states,baseValue:weightedPolicyValue(policy,o,inspect),
   ownPolicy:{horizon:'complete retained own dependencies; End/ownTO absorbs own phase',depth:policy.maxDepth,pTurnover:policy.ex.pTurnover,transitions:policy.transitions,secondCost:policy.secondCost,unknown:policy.unknown}});
 }
 if(policies[0]?.candidate.input!==selected.input)return {...result,reason:'incumbent-closure-incomplete'};
 if(policies.length<2)return {...result,reason:'no-complete-roll-free-screen'};
 if(o.turn?.[o.team]===o.turnsPerHalf-1&&o.turn?.[opp]===o.turnsPerHalf-1){
  result.evidence.scope='complete retained own dependencies and own-phase closure; common finite adaptive contact/transfer/receiver domain; next-own opportunity unverified';
  result.evidence.receiverWindow=await compareReceiverThreats(o,policies,services,until);
  // In this penultimate window a local denial gain does not price the next
  // own scoring opportunity (including a new Drive after opponent TD).
  // Retain the actual incumbent until that common continuation is verified.
  return {...result,reason:'penultimate-receiver-domain-next-own-opportunity-unverified',evidence:{...result.evidence,elapsedMs:Date.now()-start}};
 }
 // One shared input universe; queries propose, they do not supply probabilities.
 const contactMap=new Map();
 for(const p of policies){p.contactsByState=new Map();
  for(const s of [...p.states].sort((a,b)=>b.p-a.p).slice(0,2)){if(left()<600)break;
   const q=await query({from:s.key,team:opp,families:['blitz'],maxRushes:0,limit:100,sort:'steps'});
   const validContacts=candidateList(q)&&q.candidates.every(c=>c.input.kind==='playerAction'&&c.input.action==='blitz'&&
    typeof c.input.playerId==='string'&&!!c.input.playerId&&typeof(c.input.blitzTarget||c.input.blockTarget)==='string'&&
    !!(c.input.blitzTarget||c.input.blockTarget)&&Array.isArray(c.input.path)&&
    c.input.path.every(step=>Number.isInteger(step?.to?.x)&&Number.isInteger(step?.to?.y)));
   const candidates=validContacts?q.candidates:[];
   p.contactsByState.set(s.key,{complete:validContacts&&listed(q),established:validContacts&&(candidates.length>0||listed(q)),inputs:new Set(candidates.map(c=>key(c.input)))});
   for(const c of candidates){if(c.input?.playerId===car.id)continue;
    const target=s.observation.players.find(p=>p.id===(c.input.blitzTarget||c.input.blockTarget));
    if(!target?.pos||dir*(target.pos.x-car.pos.x)<=0||dir*(target.pos.x-car.pos.x)>4||Math.abs(target.pos.y-car.pos.y)>dir*(target.pos.x-car.pos.x)+1)continue;
    const signature=[c.input.playerId,c.input.blitzTarget||c.input.blockTarget].join(':');
    const old=contactMap.get(signature);if(!old||(c.input.path?.length||0)<(old.input.path?.length||0))contactMap.set(signature,c);}
  }
 }
 const reservedInputs=reservation?.sharedContacts||[];
 const contacts=(reservedInputs.length?reservedInputs.map(input=>({input})):[...contactMap.values()]).sort((a,b)=>(a.input.path?.length||0)-(b.input.path?.length||0)).slice(0,2);
 result.evidence.sharedContacts=contacts.map(c=>c.input);
 const scoreRoutes=new Map();
 const routeKeyFor=(holder,a)=>JSON.stringify([holder.id,holder.pos,holder.activated,a?.playerId===holder.id&&!a.over?a.action:'move',a?.playerId===holder.id?a.maUsed:0]);
 for(const seed of reservation?.routeSeeds||[]){const signature=routeKeyFor(seed.holder,seed.activation),routes=[...(scoreRoutes.get(signature)||[]),seed.input];scoreRoutes.set(signature,[...new Map(routes.map(i=>[key(i),i])).values()].sort((a,b)=>(a.path?.length||0)-(b.path?.length||0)).slice(0,3));}
 // Build shared routes before assigning any relative value. Normal routes exposed
 // after the first clear-out must not be hidden by the root's detouring routes.
 const seedRoutes=async(at)=>{if(!at?.observation||!at.key||at.turnover)return;
  const ob=at.observation,holder=ob.players.find(p=>p.id===ob.ball?.playerId);if(holder?.team!==opp)return;
  let s=at;if(ob.activation&&!ob.activation.over&&ob.activation.playerId!==holder.id){const ex=await explore({kind:'endActivation'},at.key,opp);if(!completeAction(ex,opp)||ex.outcomes.length!==1||!ex.outcomes[0]?.key)return;s=ex.outcomes[0];}
  const a=s.observation.activation,signature=routeKeyFor(holder,a),family=a?.playerId===holder.id&&!a.over?a.action:'move';
  const q=await query({from:s.key,team:opp,players:[holder.id],families:[family],region:{x0:gx,x1:gx},limit:16,sort:'steps'});
  if(!q?.ok)return;
  const routes=[...(scoreRoutes.get(signature)||[]),...(q?.candidates||[]).filter(c=>c.kind==='score').slice(0,1).map(c=>c.input)];
  if(routes.length||listed(q))scoreRoutes.set(signature,[...new Map(routes.map(i=>[key(i),i])).values()].sort((a,b)=>(a.path?.length||0)-(b.path?.length||0)).slice(0,reservation?.attempted?3:2));
 };
 for(const p of policies){for(const s of [...p.states].sort((a,b)=>b.p-a.p).slice(0,2)){if(left()<3000)break;await seedRoutes(s);}}
 for(const p of (reservation?.attempted?[]:policies)){for(const s of [...p.states].sort((a,b)=>b.p-a.p).slice(0,1)){for(const c of contacts.slice(0,1)){if(left()<3000)break;const ex=await explore(c.input,s.key,opp,650);
  for(const b of (ex?.outcomes||[]).filter(b=>b.observation&&!b.turnover).sort((a,b)=>b.p-a.p).slice(0,1))await seedRoutes(b);}}}
 const illegal=ex=>{if(ex?.sourceValidation?.legal===false)return true;const errors=ex?.errors?.length?ex.errors:typeof ex?.message==='string'?[ex.message]:[];return !ex?.ok&&errors.length>0&&errors.every(e=>typeof e==='string'&&/is occupied|not adjacent|isn't adjacent|must be adjacent|already activated|not on the pitch|outside the pitch/.test(e));};

 const directScore=async(at)=>{
  // A contact can itself score (for example an authoritative chain-push of
  // the carrier). This is an absorbing observed result, not a zero continuation.
  // No successor key is needed when there is no further action to explore.
  if(at?.touchdown)return {lower:at.touchdown===opp?1:0,unknown:0,observedMass:1,lines:[],terminal:at.touchdown};
  if(!at.key||!at.observation)return {lower:0,unknown:1,observedMass:0,lines:[]};
  const ob=at.observation,holder=ob.players.find(p=>p.id===ob.ball?.playerId);
  if(at.turnover||at.touchdown||at.active!==opp||ob.ball?.kind!=='held'||holder?.team!==opp)return {lower:0,unknown:0,observedMass:1,lines:[]};
  if(holder.activated&&ob.activation?.playerId!==holder.id)return {lower:0,unknown:0,observedMass:1,lines:[]};
  if(reservation?.attempted&&!reservation.contactTransitions?.length&&typeof services.sequence==='function'){
   const a=ob.activation,signature=routeKeyFor(holder,a),family=a?.playerId===holder.id&&!a.over?a.action:'move';
   let routes=scoreRoutes.get(signature),failed=false;
   if(!routes){const q=await query({from:at.key,team:opp,players:[holder.id],families:[family],region:{x0:gx,x1:gx},limit:16,sort:'steps'});
    routes=(q?.candidates||[]).filter(c=>c.kind==='score').slice(0,2).map(c=>c.input);failed=!q?.ok||(!routes.length&&!listed(q));if(!failed)scoreRoutes.set(signature,routes);}
   let lower=0,upper=failed?1:0,observed=failed?0:1;const lines=[];
   for(const input of routes){const steps=[...(a&&!a.over&&a.playerId!==holder.id?[{kind:'endActivation'}]:[]),input];
    const seq=await call('sequence',[{from:at.key,team:opp,perspective:o.team,steps,maxBranches:6,maxFinal:40,maxLeaves:8000,threshold:.00001,maxMs:cap(1200),decisions:'builtin',onIllegal:'stop'}]);
    let lo=0,known=0;for(const f of seq?.ok?seq.finals||[]:[]){const genuine=!['rest','budget','no-state','pruned'].includes(f.endedBecause)&&
      (f.touchdown||f.turnover||f.endedBecause==='sequence-complete'||/^step \d+: illegal$/.test(f.endedBecause));if(genuine){known+=n(f.p);if(f.touchdown===opp)lo+=n(f.p);}}
    const unknown=Math.max(0,1-known);lower=Math.max(lower,lo);upper=Math.max(upper,Math.min(1,lo+unknown));observed=Math.min(observed,known);
    lines.push({from:at.key,input,steps,lower:lo,unknown,observedMass:known,sequence:seq});
   }return {lower,unknown:Math.max(0,upper-lower),observedMass:observed,lines};
  }
  let states=[at];
  if(ob.activation&&!ob.activation.over&&ob.activation.playerId!==holder.id){const close=await explore({kind:'endActivation'},at.key,opp);
   if(!completeAction(close,opp)||close.outcomes.some(b=>!b.key||!b.observation))return {lower:0,unknown:1,observedMass:0,lines:[]};states=close.outcomes;}
  let lower=0,unknown=0,observedMass=0;const lines=[];
  for(const s of states){if(!s.key||!s.observation){unknown+=states[0]===at?1:s.p;continue;}const a=s.observation.activation,goal=s.observation.pitch.endZone?.[opp]??gx;
   const family=a?.playerId===holder.id&&!a.over?a.action:'move';
   const routeKey=routeKeyFor(holder,a);
   let routes=scoreRoutes.get(routeKey),routeFailure=false;
   if(!routes){const q=await query({from:s.key,team:opp,players:[holder.id],families:[family],region:{x0:goal,x1:goal},limit:16,sort:'steps'});
    routes=(q?.candidates||[]).filter(c=>c.kind==='score').slice(0,2).map(c=>c.input);
    routeFailure=!q?.ok||(!routes.length&&!listed(q)); if(!routeFailure)scoreRoutes.set(routeKey,routes);
   }
   let lo=0,hi=routeFailure?1:0,observed=routeFailure?0:1;
   for(const input of routes){if(left()<150){hi=1;observed=0;break;}const ex=await explore(input,s.key,opp,1200);
    const mass=inspect.observedTerminalScore(ex||{},opp,s.observation),m=ex?.ok?missing(ex):illegal(ex)?0:1;
    const known=ex?.ok?(ex.outcomes||[]).filter(b=>b.observation).reduce((v,b)=>v+n(b.p),0):illegal(ex)?1:0;
    observed=Math.min(observed,known);lo=Math.max(lo,mass);hi=Math.max(hi,Math.min(1,mass+m));lines.push({from:s.key,input,lower:mass,unknown:m,observedMass:known,errors:ex?.errors,message:ex?.message});}
   const weight=states[0]===at?1:s.p;lower+=weight*lo;unknown+=weight*Math.max(0,hi-lo);observedMass+=weight*observed;
  }return {lower,unknown:Math.min(1,unknown),observedMass,lines};
 };
 for(const p of policies){p.assessment={critical:0,contactUnknown:0,domainUnknown:0,domainEstablished:true,observed:0,branches:[]};p.orderedStates=[...p.states].sort((a,b)=>b.p-a.p);}
 for(let stateIndex=0;stateIndex<Math.max(...policies.map(p=>p.states.length));stateIndex++){for(const p of policies){const s=p.orderedStates[stateIndex];if(!s)continue;const branches=p.assessment.branches;let lo=0,hi=0;const direct=await directScore(s);lo=direct.lower;hi=direct.lower+direct.unknown;const checks=[];let observedHere=direct.observedMass;
   for(const c of contacts){const reservedContact=reservation?.contactTransitions?.find(r=>r.from===s.key&&same(r.input,c.input));if(reservation?.attempted&&!reservedContact&&typeof services.sequence==='function'){
     const holder=s.observation.players.find(p=>p.id===s.observation.ball?.playerId),routes=scoreRoutes.get(routeKeyFor(holder,s.observation.activation))||[];
     let bound=0,upper=routes.length?0:1,known=routes.length?1:0;const continuations=[];
     for(const route of routes){const seq=await call('sequence',[{from:s.key,team:opp,perspective:o.team,steps:[c.input,{kind:'endActivation'},route],maxBranches:6,maxFinal:40,maxLeaves:8000,threshold:.00001,maxMs:cap(1200),decisions:'builtin',onIllegal:'stop'}]);
      let score=0,mass=0;for(const f of seq?.ok?seq.finals||[]:[]){const genuine=!['rest','budget','no-state','pruned'].includes(f.endedBecause)&&(f.touchdown||f.turnover||f.endedBecause==='sequence-complete'||/^step \d+: illegal$/.test(f.endedBecause));if(genuine){mass+=n(f.p);if(f.touchdown===opp)score+=n(f.p);}}
      bound=Math.max(bound,score);upper=Math.max(upper,Math.min(1,score+Math.max(0,1-mass)));known=Math.min(known,mass);continuations.push({input:route,lower:score,unknown:Math.max(0,1-mass),observedMass:mass,sequence:seq});}
     lo=Math.max(lo,bound);hi=Math.max(hi,upper);observedHere=Math.min(observedHere,known);checks.push({input:c.input,lower:bound,unknown:Math.max(0,upper-bound),observedMass:known,continuations});continue;
    }if(left()<200){hi=1;observedHere=0;checks.push({input:c.input,unknown:'budget'});continue;}
    const ex=reservedContact?.ex||await explore(c.input,s.key,opp,650);
    if(!ex?.ok){// Only an explicit illegal-input error is evidence that this shared action
     // cannot occur. Service/budget failures remain unknown.
     const invalid=illegal(ex);
     checks.push({input:c.input,illegal:invalid,errors:ex?.errors,message:ex?.message,observedMass:invalid?1:0});if(!invalid){hi=1;observedHere=0;}continue;}
    // Correct state identity can split one score into many distinct public states.
    // Every already observed terminal counts; the six-branch cap only bounds future work.
    const retained=[...(ex.outcomes||[]).filter(b=>b.observation&&(b.touchdown||b.turnover)),
     ...(ex.outcomes||[]).filter(b=>b.observation&&!b.touchdown&&!b.turnover).sort((a,b)=>b.p-a.p).slice(0,6)];
    const kept=retained.reduce((v,b)=>v+b.p,0);let bound=0,unk=Math.max(missing(ex),1-kept),contactObserved=0;const continuations=[];
    for(const b of retained){if(left()<150&&!b.touchdown&&!b.turnover){unk+=b.p;continue;}const follow=await directScore(b.replyAt||b);bound+=b.p*follow.lower;unk+=b.p*follow.unknown;contactObserved+=b.p*follow.observedMass;continuations.push({mass:b.p,from:b.key,...follow});}
    unk=Math.min(1,unk);observedHere=Math.min(observedHere,contactObserved);lo=Math.max(lo,bound);hi=Math.max(hi,Math.min(1,bound+unk));checks.push({input:c.input,lower:bound,unknown:unk,retainedMass:kept,observedMass:contactObserved,continuations});
   }
   // Unexamined contacts and transfers are bounded-search uncertainty, charged
   // in the champion's existing unresolved units, never a proof of safety.
   const truncatedDomain=!p.contactsByState.get(s.key)?.complete||contactMap.size>contacts.length;
   const domainUnknown=p.contactsByState.get(s.key)?.established?0:1;
   if(domainUnknown){hi=1;observedHere=0;p.assessment.domainEstablished=false;}
   p.assessment.domainUnknown+=s.p*domainUnknown;
   p.assessment.observed+=s.p*observedHere;
   const u=Math.max(0,hi-lo);p.assessment.critical+=s.p*(-lo*inspect.CFG.opponentScore-u*inspect.CFG.unresolved);p.assessment.contactUnknown+=s.p*u;
   branches.push({mass:s.p,from:s.key,direct,contacts:checks,scoreLowerBound:lo,unknown:u,
    contactDomainUnknown:domainUnknown,unsearchedContactDomain:truncatedDomain});
  }}
 for(const p of policies){const {critical,contactUnknown,observed,branches}=p.assessment;
  const line={...p.candidate,baseValue:p.baseValue,preparationGain:0,unknown:0,preparedBranches:p.candidate.preparedBranches,
   replyAttempted:true,criticalReplyAdjustment:critical,positionReplyAdjustment:-18,
   replyAdjustment:critical-18,checkedReplyMass:0,boundedReplyMass:0,observedReplyMass:observed,
   reply:[{p:1,stage:'after examined follow-up',unknown:true,essentialComplete:false,criticalAdjustment:critical,positionAdjustment:-18}]};
  p.line=line;p.rawScore=branches.reduce((v,b)=>v+b.mass*b.scoreLowerBound,0);p.replyUnknown=contactUnknown;result.evidence.policies.push({input:line.input,baseValue:p.baseValue,criticalReplyAdjustment:critical,
   contactUnknown,contactDomainUnknown:p.assessment.domainUnknown,contactDomainEstablished:p.assessment.domainEstablished,
   observedReplyMass:observed,branches,ownPolicy:p.ownPolicy,scope:'successful finite shared contact subset; unsearched outside-model inputs remain unknown, not full-turn coverage'});
 }
 result.policyTrees=policies.map(p=>p.line);
 const incumbent=policies[0].line;
 for(const p of policies.slice(1)){const e=endorseContinuation(p.line,incumbent,inspect,'normal');
  const safetyLowerGain=policies[0].rawScore-p.rawScore-p.replyUnknown;
  const netLowerGain=p.line.baseValue-incumbent.baseValue+safetyLowerGain*inspect.CFG.opponentScore;
  const domainEstablished=p.assessment.domainEstablished&&policies[0].assessment.domainEstablished;
  const normalAccepted=domainEstablished&&e.eligible&&p.replyUnknown<=policies[0].replyUnknown+EPS;
  const terminalOwnRiskBound=domainEstablished&&p.line.input?.kind==='endTurn'&&n(p.line.ex.pTurnover,1)<=EPS&&n(incumbent.ex.pTurnover)>EPS&&netLowerGain>4&&p.line.criticalReplyAdjustment>=incumbent.criticalReplyAdjustment-EPS;
  const boundedEmergency=domainEstablished&&safetyLowerGain>EPS&&netLowerGain>4&&p.line.criticalReplyAdjustment>=incumbent.criticalReplyAdjustment-EPS;
  result.evidence.policies.find(x=>same(x.input,p.line.input)).gate={...e,normalGate:e,eligible:normalAccepted||boundedEmergency||terminalOwnRiskBound,
   reason:!domainEstablished?'contact-discovery-incomplete':terminalOwnRiskBound?'terminal-own-risk-full-unknown-net-margin':boundedEmergency?'bounded-shared-defense-interval-margin':e.reason,domainEstablished,boundedEmergency,terminalOwnRiskBound,safetyLowerGain,netLowerGain,
   interpretation:'lower/upper comparison for same retained contact and shared carrier-route subset; every missing probability branch reserved; unsearched opposing policies remain unknown, not complete Turn safety'};
  if(normalAccepted||boundedEmergency||terminalOwnRiskBound)
   return {...result,selected:p.line,reason:terminalOwnRiskBound?'terminal-own-risk-full-unknown-net-margin':boundedEmergency?'observed-contact-screen-lower-margin':'safe-screen-common-horizon-margin',evidence:{...result.evidence,elapsedMs:Date.now()-start}};
 }
 return {...result,reason:'no-measured-screen-improvement',evidence:{...result.evidence,elapsedMs:Date.now()-start}};
}
