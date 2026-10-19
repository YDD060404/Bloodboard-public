import {same,completeAction,policyFrom} from './policy.mjs';
const n=(x,d=0)=>Number.isFinite(x)?x:d;
const dist=(a,b)=>a&&b?Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y)):Infinity;
const actionInput=x=>x&&x.kind==='playerAction'&&typeof x.playerId==='string'&&!!x.playerId&&typeof x.action==='string'&&Array.isArray(x.path)&&x.path.every(s=>Number.isInteger(s?.to?.x)&&Number.isInteger(s?.to?.y));
const scoreRows=q=>q?.ok===true&&!q.truncated&&q.exact!==false&&Array.isArray(q.threats)&&q.threats.every(t=>t&&actionInput(t.input)&&Number.isFinite(t.pTouchdown)&&t.pTouchdown>=0&&t.pTouchdown<=1&&t.exact!==false);
const carrier=o=>o.ball?.kind==='held'?o.players.find(p=>p.id===o.ball.playerId):null;
const pitch=(o,team)=>o.players.filter(p=>p.team===team&&p.location==='pitch'&&p.pos);
const knownReplyChannels=c=>Number.isFinite(c?.criticalReplyAdjustment)&&Number.isFinite(c?.positionReplyAdjustment);
const skill=(p,k)=>(p.skills||[]).some(s=>s===k||s.startsWith(k+'('));
/** Match facts select which alternative purposes deserve the optional budget.
 * They do not add another scoring function or claim a future win probability. */
export function matchIntent(o,drive){
 const opp=o.team==='A'?'B':'A',ours=pitch(o,o.team),theirs=pitch(o,opp),diff=n(o.score?.[o.team])-n(o.score?.[opp]);
 const mean=(ps,k)=>ps.length?ps.reduce((v,p)=>v+n(p[k]),0)/ps.length:0;
 const ourTurns=Math.max(0,n(o.turnsPerHalf)-n(o.turn?.[o.team])+1),opponentTurns=Math.max(0,n(o.turnsPerHalf)-n(o.turn?.[opp]));
 const speed={ours:Math.max(0,...ours.map(p=>n(p.ma))),theirs:Math.max(0,...theirs.map(p=>n(p.ma)))},strength={ours:mean(ours,'st'),theirs:mean(theirs,'st')};
 const duty=drive?.emergency?'prevent-immediate-score':diff<0?'recover-score-deficit':diff===0?'create-winning-score':'preserve-lead-and-score-window';
 const matchup=strength.ours<strength.theirs&&speed.ours>=speed.theirs?'preserve-mobility':speed.ours<speed.theirs?'deny-fast-counter-window':'balanced-tools';
 return {duty,scoreDifference:diff,ourTurns,opponentTurns,counts:{ours:ours.length,theirs:theirs.length},speed,strength,matchup,
  scoringWindow:drive?.targetScoringWindow??null,windowRevision:drive?.windowRevision??null,
  preferredPurposes:matchup==='preserve-mobility'?['switch-side','regroup','advance','transfer','protect']:
   diff<=0?['advance','transfer','switch-side','protect','regroup']:['protect','switch-side','advance','regroup','transfer'],
  scope:'public match/ability facts guide discovery; bounded opportunity comparison, not match-win probability'};
}
export function strategyPurpose(o,c){
 const input=c?.input,car=carrier(o),actor=o.players.find(p=>p.id===input?.playerId),to=input?.path?.at(-1)?.to;
 if(input?.kind==='endTurn'||input?.kind==='endActivation')return 'hold-structure';
 if(['pass','handoff'].includes(input?.action))return 'transfer';
 if(car?.team===o.team&&input?.playerId===car.id&&to){const goal=o.pitch.endZone[o.team],direction=Math.sign(goal-car.pos.x);
  if(direction*(to.x-car.pos.x)<0)return 'regroup';
  if(Math.abs(to.y-car.pos.y)>=3)return 'switch-side';return 'advance';}
 if(car?.team===o.team&&actor&&to&&dist(to,car.pos)<=3)return 'protect';
 return ['block','blitz','special'].includes(input?.action)?'contact':'position';
}
/** Two complete own policies, one bounded opposing action followed by End,
 * then an actually explored next-own TD opportunity. Opponent alternatives are
 * evaluated separately at each parent, never summed as independent attacks.
 * Unknown discovery/branches abort the positive comparison. */
export async function challengeStrategicWindow(o,snapshot,drive,services,inspect,deadline){
 const intent=matchIntent(o,drive),result={attempted:false,selected:null,reason:'outside-bounded-strategic-window',intent,policies:[],
  scope:'complete bounded own dependency policy and End; one of score/contact/denial/End opponent actions and End; next-own direct-score opportunity; not a whole opponent Turn'};
 const selected=snapshot?.selected,car=carrier(o),opp=o.team==='A'?'B':'A';
 if(snapshot?.mode!=='normal'||car?.team!==o.team||intent.ourTurns<2||!completeAction(selected?.ex,o.team)||deadline-Date.now()<6500)return result;
 const unsupported=['bombardier','ballAndChain','throwTeamMate','kickTeamMate','hypnoticGaze','chainsaw'];
 if(pitch(o,opp).some(p=>unsupported.some(s=>skill(p,s))))return {...result,reason:'opponent-special-objectives-not-covered'};
 const policyCache=new Map(),policyOf=c=>{if(!policyCache.has(c))policyCache.set(c,policyFrom(c,c.preparedBranches,o.team,inspect));return policyCache.get(c);};
 const currentPolicy=policyOf(selected);
 if(!currentPolicy.complete)return {...result,reason:'current-policy-has-unresolved-priced-dependencies'};
 if(inspect.observedTerminalScore(currentPolicy.ex,o.team,o)>1e-8)return {...result,reason:'current-own-score-opportunity-protected'};
 if(!knownReplyChannels(selected))return {...result,reason:'current-known-reply-channels-unavailable'};
 const purpose=strategyPurpose(o,selected),rank=c=>{const p=intent.preferredPurposes.indexOf(strategyPurpose(o,c));return p<0?99:p;};
 const alternatives=(snapshot.lines||[]).filter(c=>policyOf(c).complete&&n(policyOf(c).ex.pTurnover)<=n(currentPolicy.ex.pTurnover)+1e-8&&knownReplyChannels(c)&&!same(c.input,selected.input)&&strategyPurpose(o,c)!==purpose&&
  completeAction(c.ex,o.team)&&n(c.ex.pTurnover)<=n(selected.ex.pTurnover)+1e-8&&
  n(c.criticalReplyAdjustment)>=n(selected.criticalReplyAdjustment)-1e-8&&
  n(c.positionReplyAdjustment)>=n(selected.positionReplyAdjustment)-1e-8&&
  n(c.baseValue,-Infinity)+n(c.preparationGain)>=n(selected.baseValue,-Infinity)+n(selected.preparationGain)-.5)
  .sort((a,b)=>rank(a)-rank(b)||n(b.baseValue)+n(b.preparationGain)-n(a.baseValue)-n(a.preparationGain));
 if(!alternatives.length)return {...result,reason:'no-nondominated-purpose-distinct-policy'};
 result.attempted=true;const until=Math.min(deadline,Date.now()+12000),choices=[selected,alternatives[0]];
 const evaluated=[];
 for(let index=0;index<choices.length;index++){
  const first=choices[index],policyDeadline=Math.min(until,Date.now()+(until-Date.now())/(choices.length-index)),left=()=>policyDeadline-Date.now();
  let calls=0,reason=null;
  const call=async(fn)=>{if(left()<100){reason='strategy-budget-exhausted';return null;}calls++;try{return await fn();}catch{reason='strategy-query-failed';return null;}};
  const explore=(input,from,team)=>typeof from==='string'&&from?call(()=>services.explore(input,{coachEnumerationDeadline:policyDeadline,from,team,perspective:o.team,observations:true,decisions:'builtin',
   maxOutcomes:40,maxKeep:256,maxLeaves:3500,threshold:.00001,maxMs:Math.max(50,Math.min(600,left()-50))})):null;
  const cert=ex=>ex?.outcomeIdentity==='complete-state-v1'&&completeAction(ex,o.team);
  const unit=()=>({ownTD:0,opponentTD:0,nextOwnTurnover:0,nextOwnMovement:0,complete:true,queries:[]});
  const terminal=b=>b.touchdown?{ownTD:b.touchdown===o.team?1:0,opponentTD:b.touchdown===opp?1:0,complete:true,queries:[],terminal:b.touchdown}:null;
  const add=(a,b,p)=>{a.ownTD+=p*b.ownTD;a.opponentTD+=p*b.opponentTD;a.nextOwnTurnover+=p*n(b.nextOwnTurnover);a.nextOwnMovement+=p*n(b.nextOwnMovement);a.queries.push(...b.queries);};
  const nextScore=async(at)=>{
   const done=terminal(at);if(done)return done;
   if(!at.key||!at.observation||at.active!==o.team)return null;
   const q=await call(()=>services.threats.scoring({from:at.key,team:o.team,maxMs:Math.max(50,Math.min(400,left()-50))}));
   if(!scoreRows(q))return null;
   let best=null;const queries=[];
   for(const route of q.threats.filter(x=>x.input).sort((a,b)=>n(b.pTouchdown)-n(a.pTouchdown)).slice(0,2)){
    const ex=await explore(route.input,at.key,o.team);if(!cert(ex))return null;
    const p=inspect.observedTerminalScore(ex,o.team,at.observation),opponentTD=inspect.observedTerminalScore(ex,opp,at.observation),
     nextOwnTurnover=ex.outcomes.filter(b=>b.turnover).reduce((sum,b)=>sum+b.p,0),candidate={ownTD:p,opponentTD,nextOwnTurnover,nextOwnMovement:n(route.steps,route.input.path?.length||0)};
    if(!best||candidate.ownTD>best.ownTD+1e-8||Math.abs(candidate.ownTD-best.ownTD)<=1e-8&&
     (candidate.opponentTD<best.opponentTD-1e-8||Math.abs(candidate.opponentTD-best.opponentTD)<=1e-8&&candidate.nextOwnTurnover<best.nextOwnTurnover))best=candidate;
    queries.push({kind:'next-own-score',input:route.input,observedTD:p,observedOpponentTD:opponentTD,nextOwnTurnover,
     movementSteps:candidate.nextOwnMovement,rushes:route.rushes??null,resourcesBefore:at.observation.teams?.[o.team],
     resourceOutcomes:ex.outcomes.map(b=>({p:b.p,turnover:!!b.turnover,touchdown:b.touchdown,resources:b.observation?.teams?.[o.team]}))});
   }
   return {...(best||unit()),complete:true,queries};
  };
  const afterOpponent=async(b)=>{
   const done=terminal(b);if(done)return done;
   if(!b.key||!b.observation)return null;
   if(b.active===o.team)return nextScore(b);
   if(b.active!==opp)return null;
   const close=await explore({kind:'endTurn'},b.key,opp);if(!cert(close)||close.outcomes.length>3)return null;
   const total=unit();for(const at of close.outcomes){const score=await nextScore(at);if(!score)return null;add(total,score,at.p);}return total;
  };
  const opposingPolicies=async(at)=>{
   const done=terminal(at);if(done)return done;
   if(!at.key||!at.observation||at.active!==opp)return null;
   const ob=at.observation,h=carrier(ob),inputs=[{kind:'endTurn'}],domain=[];
   const scores=await call(()=>services.threats.scoring({from:at.key,team:opp,maxMs:Math.max(50,Math.min(400,left()-50))}));
   if(!scoreRows(scores))return null;
   const score=scores.threats.filter(x=>x.input).sort((a,b)=>n(b.pTouchdown)-n(a.pTouchdown))[0];if(score)inputs.push(score.input);domain.push({purpose:'score',found:!!score});
   if(h?.team===o.team){
    const direction=Math.sign(ob.pitch.endZone[o.team]-h.pos.x),cells=[-1,0,1].map(dy=>({x:h.pos.x+direction*2,y:h.pos.y+dy})).filter(p=>p.x>=0&&p.x<ob.pitch.width&&p.y>=0&&p.y<ob.pitch.height);
    for(const [purpose,query] of [['contact',{families:['block','blitz'],targets:[h.id]}],['denial',{families:['move'],region:{within:cells}}]]){
     const q=await call(()=>services.candidates({from:at.key,team:opp,...query,precision:'none',maxRushes:0,limit:16,sort:'steps',maxMs:Math.max(50,Math.min(400,left()-50))}));
     if(q?.ok!==true||!Array.isArray(q.candidates)||q.candidates.some(c=>!c||c.legal===false||!actionInput(c.input)||
      !query.families.includes(c.input.action)||purpose==='contact'&&(c.input.blockTarget||c.input.blitzTarget)!==h.id||
      purpose==='denial'&&!cells.some(p=>same(p,c.input.path.at(-1)?.to)))||
      !q.candidates.length&&(q.hasMore||q.complete===false||q.truncated?.length))return null;
     const rows=q.candidates.map(c=>inspect.canonical(c,ob)).filter(Boolean).sort((a,b)=>inspect.cheapScore(ob,b,opp,inspect.boardValue(ob,opp))-inspect.cheapScore(ob,a,opp,inspect.boardValue(ob,opp)));
     if(rows[0])inputs.push(rows[0].input);domain.push({purpose,found:!!rows[0],domainLimited:!!q.hasMore||!!q.truncated?.length});
    }
   }
   const records=[];
   for(const input of [...new Map(inputs.map(i=>[JSON.stringify(i),i])).values()]){
    const ex=await explore(input,at.key,opp);if(!cert(ex)||ex.outcomes.filter(b=>!b.touchdown).length>4)return null;
    const total=unit();for(const b of ex.outcomes){const continuation=await afterOpponent(b);if(!continuation)return null;add(total,continuation,b.p);}
    records.push({...total,input});
   }
   // This is a policy choice at this exact parent. No independent worst parts
   // from different enemy inputs are combined into a fictitious super-action.
   records.sort((a,b)=>intent.scoreDifference>0?b.opponentTD-a.opponentTD||a.ownTD-b.ownTD:
    (a.ownTD-a.opponentTD)-(b.ownTD-b.opponentTD));
   return {...records[0],queries:[{kind:'opponent-domain',domain,policies:records.map(r=>({input:r.input,ownTD:r.ownTD,opponentTD:r.opponentTD,nextOwnTurnover:r.nextOwnTurnover}))},...records[0].queries]};
  };
  const own=policyOf(first),total=unit();let currentOwnTurnover=n(own.ex.pTurnover);
  let complete=completeAction(own.ex,o.team)&&own.ex.outcomes.filter(b=>!b.touchdown).length<=3;
  if(complete)for(const b of own.ex.outcomes){
   const done=terminal(b);if(done){add(total,done,b.p);continue;}
   if(!b.key||!b.observation){complete=false;break;}
   let states=[{...b,p:1}];
   if(b.active===o.team){const close=await explore({kind:'endTurn'},b.key,o.team);if(!cert(close)||close.outcomes.length>3){complete=false;break;}states=close.outcomes;if(!b.turnover)currentOwnTurnover+=b.p*n(close.pTurnover);}
   for(const at of states){const reply=await opposingPolicies(at);if(!reply){complete=false;break;}add(total,reply,b.p*at.p);}
   if(!complete)break;
  }
  const record={input:first.input,purpose:strategyPurpose(o,first),ownTD:total.ownTD,opponentTD:total.opponentTD,
   currentOwnTurnover,ownPolicyDepth:own.maxDepth,nextOwnTurnover:total.nextOwnTurnover,nextOwnMovement:total.nextOwnMovement,complete,unknown:complete?0:1,queries:total.queries,calls,reason:complete?'complete-within-declared-opponent-domain':reason||'incomplete-strategic-boundary'};
  result.policies.push(record);evaluated.push(record);
 }
 const [incumbent,alternative]=evaluated;
 if(!incumbent.complete||!alternative.complete)return {...result,reason:'strategic-comparison-incomplete; current choice preserved'};
 const gain=alternative.ownTD-incumbent.ownTD,noMoreConceding=alternative.opponentTD<=incumbent.opponentTD+1e-8,
  noMoreCurrentRisk=alternative.currentOwnTurnover<=incumbent.currentOwnTurnover+1e-8;
 const margin=n(alternatives[0].ex.pTurnover)<1e-8?.5:4;
 result.evidence={currentPurpose:purpose,alternativePurpose:alternative.purpose,nextOwnTDGain:gain,
  opponentTDChange:alternative.opponentTD-incumbent.opponentTD,matchedDeclaredBoundary:true,unknownOutsideDomain:true,
  valueGain:gain*inspect.CFG.touchdown,margin,noMoreConceding,noMoreCurrentRisk,
  originalCriticalAndPositionHarmPreserved:true};
 if(gain*inspect.CFG.touchdown<=margin||!noMoreConceding||!noMoreCurrentRisk)return {...result,reason:'no-certified-strategic-window-improvement'};
 return {...result,selected:{...alternatives[0],goal:{id:`window:${o.team}:${o.half}:${o.drive}:${o.turn[o.team]}`,
  kind:'next-own-score-opportunity',target:strategyPurpose(o,alternatives[0])}},reason:'purpose-distinct-policy-improves-examined-next-own-TD-window'};
}
