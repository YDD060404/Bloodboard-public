import {same,policyFrom,weightedPolicyValue} from './policy.mjs';
const has = (p, s) => (p?.skills || []).some(x => x === s || x.startsWith(s + '('));
const dist = (a, b) => a && b ? Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) : 99;
const find = (o, id) => o.players.find(p => p.id === id);
const onPitch = p => p?.location === 'pitch' && !!p.pos;
const standing = p => onPitch(p) && p.stance === 'standing';
const tz = p => standing(p) && p.tackleZone !== false && !p.distracted;
const holder = o => o.ball?.kind === 'held' ? find(o, o.ball.playerId) : null;
const goal = (o, t) => o.pitch?.endZone?.[t] ?? (t === 'A' ? 25 : 0);
const goalDist = (o, t, p) => Math.abs(goal(o, t) - p.x);
const available = (o, p) => onPitch(p) && p.stance !== 'stunned' &&
    (o.activation?.playerId === p.id && !o.activation.over || !p.activated && p.canBeActivated !== false);
const destOf = c => c.destination || c.input?.path?.at(-1)?.to || null;

const other = t => t === 'A' ? 'B' : 'A';
const num = (x, d = 0) => Number.isFinite(x) ? x : d;
const sqKey = p => `${p.x},${p.y}`;
  function zones(o, team) {
    const m = new Map();
    for (const p of o.players.filter(p => p.team === team && tz(p))) {
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const c = { x: p.pos.x + dx, y: p.pos.y + dy };
        m.set(sqKey(c), (m.get(sqKey(c)) || 0) + 1);
      }
    }
    return m;
  }


/** Exact frozen geometric proposal composer; only My Ball receiver exclusion is removed. */
function movingPassProposals(o, candidates) {
    const car = holder(o);
    if (!car || car.team !== o.team || !standing(car) || !available(o,car) ||
        car.pa == null || car.rooted || has(car,'noBall') ||
        (o.activation && (o.activation.playerId !== car.id ||
          o.activation.action !== 'pass' || o.activation.ballActionDone))) return [];
    const zonesAgainst = zones(o,other(o.team));
    const markers = at => num(zonesAgainst.get(sqKey(at)));
    const remaining = Math.max(0,car.ma - num(o.activation?.maUsed));
    const routes = candidates.filter(c => c.actorId === car.id && c.family === 'move' &&
      c.input.path?.length && c.input.path.length <= remaining && !num(c.rushes) && destOf(c));
    const receivers = o.players.filter(p => p.team === o.team && p.id !== car.id &&
      standing(p) && !p.distracted && !has(p,'noBall') &&
      goalDist(o,o.team,p.pos) < goalDist(o,o.team,car.pos));
    const proposed = [];
    for (const receiver of receivers) {
      const before = dist(car.pos,receiver.pos);
      const approaches = routes.map(c => {
        const at = destOf(c), after = dist(at,receiver.pos);
        const departures = [car.pos,...c.input.path.slice(0,-1).map(s => s.to)];
        return {c,at,after,distanceSquared:(at.x-receiver.pos.x)**2+(at.y-receiver.pos.y)**2,
          departureMarkers:departures.reduce((n,s)=>n+markers(s),0),
          improvement:before-after, markerImprovement:markers(car.pos)-markers(at)};
      }).filter(r => r.after > 0 && (r.improvement >= 2 || r.markerImprovement > 0))
        .sort((a,b) => a.departureMarkers-b.departureMarkers || markers(a.at)-markers(b.at) ||
          a.distanceSquared-b.distanceSquared || a.c.input.path.length-b.c.input.path.length);
      const best = approaches[0];
      if (!best) continue;
      proposed.push({ input:{kind:'playerAction',playerId:car.id,action:'pass',
          path:best.c.input.path,passTarget:{...receiver.pos}},
        family:'pass',kind:'pass',actorId:car.id,targetId:receiver.id,
        destination:{...best.at},rushes:0,movingTransfer:true,
        transferHint:{receiverGoalDistance:goalDist(o,o.team,receiver.pos),
          distanceReduction:best.improvement,departureMarkers:best.departureMarkers},
        label:`${car.name}: move then pass to ${receiver.name}` });
    }
    return proposed.sort((a,b) => a.transferHint.departureMarkers-b.transferHint.departureMarkers ||
      a.transferHint.receiverGoalDistance-b.transferHint.receiverGoalDistance ||
      b.transferHint.distanceReduction-a.transferHint.distanceReduction).slice(0,2);
  }

const validInput=x=>x?.kind==='playerAction'&&typeof x.playerId==='string'&&typeof x.action==='string'&&Array.isArray(x.path)&&x.path.every(s=>['step','rush'].includes(s?.kind)&&Number.isInteger(s?.to?.x)&&Number.isInteger(s?.to?.y));
const copied=x=>JSON.parse(JSON.stringify(x));
/** Read-only request-local capture. No new RPC or proposal is inserted into the
 * champion's search, and no retained handle survives this chooseAction call. */
export function createScoringDiscovery(o,native=[]){
 const car=holder(o),enabled=o.phase==='play'&&o.active===o.team&&o.turn?.[o.team]===o.turnsPerHalf&&car?.team===o.team&&
  !has(car,'myBall')&&!has(car,'noBall')&&o.players.some(p=>p.team===o.team&&has(p,'myBall')&&!has(p,'noBall')&&available(o,p)&&standing(p));
 const inputs=new Map();let inspectedQueries=0;
 const add=c=>{const i=c?.input;if(!enabled||c.legal===false||!validInput(i)||i.action!=='move'||i.playerId!==car.id||!i.path.length||i.path.some(s=>s.kind==='rush'))return;
  const key=JSON.stringify(i);if(inputs.size<160&&!inputs.has(key))inputs.set(key,copied(c));};
 if(enabled)for(const c of native||[])add(c);
 return {enabled,observe(q,r){
  if(!enabled||q?.from&&q.from!=='root'||q?.team&&q.team!==o.team||r?.ok!==true||r.position?.key!=='root'||!Array.isArray(r.candidates))return;
  inspectedQueries++;for(const c of r.candidates)add(c);
 },proposals(inspect){
  if(!enabled)return [];
  return movingPassProposals(o,[...inputs.values()].map(c=>inspect.canonical(c,o)).filter(Boolean))
   .filter(c=>has(find(o,c.targetId),'myBall')&&available(o,find(o,c.targetId)));
 },report(){return {enabled,inspectedQueries,retainedMoveInputs:inputs.size,scope:'already returned current-root carrier Move candidates; no extra discovery RPC'};}};
}
/** This initial correction covers only ordinary/free-skill dice decisions.
 * With no discretionary team resources, stars or other skill mechanisms,
 * Pass/Catch/Dodge/Sure Feet/Sure Hands retries are the offered `skill`, which
 * both builtin and the frozen live chooser always take. Anything else is not
 * certified here (notably Pro + Team Re-roll) and preserves the incumbent. */
export function scoringRuleScope(o){
 const safe=new Set(['block','wrestle','dodge','stunty','rightStuff','jumpUp','myBall','sidestep','noBall','catch','pass','sureFeet','sureHands','sprint','guard','standFirm','fend','tackle']);
 for(const team of ['A','B']){const t=o.teams?.[team];
  if(!t||o.rerolls?.[team]!==0||t.rerolls!==0||t.leaderReroll!==false||t.bonusRerolls!==0||t.mascotReroll!==false||t.apothecary!=='none'||!Array.isArray(t.specialRules)||t.specialRules.length)
   return {certified:false,reason:'discretionary-team-rule-resources-not-certified'};
 }
 if(o.players.some(p=>onPitch(p)&&(p.star||!Array.isArray(p.skills)||p.skills.some(skill=>!safe.has(skill)))))return {certified:false,reason:'player-rule-mechanism-not-certified'};
 return {certified:true,policy:'ordinary-free-skill-only/1',reason:'only-ordinary-dice-or-free-skill-retries; builtin-and-live-choice-agree',
  scope:'no team/leader/bonus/mascot reroll, apothecary, stars, special team rule or unreviewed skill; does not certify general rule parity'};
}
function validPolicyTree(node,team,ancestors=new Set(),expectedParent=null){
 const input=node?.input||node?.plan?.input;
 if(!validInput(input)||!['move','pass','handoff'].includes(input.action))return false;
 const e=node?.ex;if(!e||ancestors.has(e)||e.ok!==true||e.outcomeIdentity!=='complete-state-v1'||e.perspective!==team||
  e.activeTeam!==team||e.decisionPolicy?.mode!=='builtin'||e.decisionPolicy.own!=='builtin'||e.decisionPolicy.opponent!=='builtin'||
  typeof e.position?.key!=='string'||!e.position.key||expectedParent!==null&&e.position.key!==expectedParent||
  !Array.isArray(e.outcomes)||!e.outcomes.length||
  [e.rest?.p,e.unresolvedMass,e.pTouchdown,e.pTurnover,e.pOpponentTouchdown].some(p=>!Number.isFinite(p)||p<0||p>1)||
  e.outcomes.some(b=>!b||!Number.isFinite(b.p)||b.p<0||b.p>1||typeof b.turnover!=='boolean'||
   b.touchdown!==null&&b.touchdown!==undefined&&!['A','B'].includes(b.touchdown)||
   b.active!==null&&b.active!==undefined&&!['A','B'].includes(b.active)||
   b.key!==null&&b.key!==undefined&&(typeof b.key!=='string'||!b.key)||
   ['A','B'].includes(b.active)&&b.observation&&b.observation.active!==b.active)||
  e.outcomes.reduce((s,b)=>s+b.p,0)>1+1e-8||Math.abs(e.outcomes.reduce((s,b)=>s+b.p,0)+e.rest.p-1)>1e-8||e.unresolvedMass>e.rest.p+1e-8)return false;
 const keys=e.outcomes.map(b=>b.key).filter(Boolean);if(new Set(keys).size!==keys.length)return false;
 const next=new Set(ancestors);next.add(e);
 return [...(node.preparedBranches||new Map()).entries()].every(([key,f])=>typeof key==='string'&&key&&keys.includes(key)&&f.plan?.input&&validPolicyTree(f,team,next,key));
}
/** Current-team-Turn TD bounds, using one composed conditional policy. Every
 * nonterminal or unretained mass is success in the upper bound. Observed TO/
 * opponent control closes THIS Turn; no future-turn or match-win claim. */
export function scoringPolicyBounds(first,team,inspect){
 if(!validPolicyTree(first,team,new Set(),'root'))return {valid:false,reason:'invalid-current-scoring-policy'};
 const policy=policyFrom(first,first.preparedBranches,team,inspect);
 if(!policy.structuralComplete)return {valid:false,reason:'unresolved-priced-scoring-dependency',issues:policy.issues};
 let lower=0,failure=0;
 for(const b of policy.ex.outcomes){
  if(b.touchdown===team)lower+=b.p;
  else if(b.touchdown||b.turnover||b.active===other(team))failure+=b.p;
 }
 if(lower+failure>1+1e-8)return {valid:false,reason:'non-unit-scoring-policy'};
 const upper=Math.max(lower,Math.min(1,1-failure));
 return {valid:true,lower,upper,unknown:Math.max(0,upper-lower),maxDepth:policy.maxDepth,
  scope:'current team Turn, retained conditional actions and builtin in-action decisions; unretained/nonterminal mass remains unknown'};
}
export async function challengeFinalScoring(o,snapshot,discovery,services,inspect,deadline){
 const ruleScope=scoringRuleScope(o),result={attempted:false,selected:null,reason:'outside-final-turn-scoring-gap',discovery:discovery?.report(),ruleScope,policies:[]};
 if(snapshot?.mode!=='final-turn'||o.turn?.[o.team]!==o.turnsPerHalf||!discovery?.enabled||deadline-Date.now()<2800)return result;
 if(!ruleScope.certified)return {...result,reason:ruleScope.reason};
 const current=scoringPolicyBounds(snapshot.selected,o.team,inspect);result.current=current;
 if(!current.valid)return {...result,reason:current.reason};
 if(current.upper>=1-1e-8)return {...result,reason:'current-scoring-upper-bound-protected'};
 const proposals=discovery.proposals(inspect).filter(c=>!same(c.input,snapshot.selected.input));
 if(!proposals.length)return {...result,reason:'no-missing-legal-receiver-proposal'};
 result.attempted=true;const until=Math.min(deadline,Date.now()+9000);
 for(let ci=0;ci<proposals.length;ci++){
  const proposal=proposals[ci],stop=Math.min(until,Date.now()+(until-Date.now())/(proposals.length-ci)),left=()=>stop-Date.now();
  if(left()<1600)break;
  const record={input:proposal.input,receiver:proposal.targetId,reason:null,followups:[]};result.policies.push(record);
  const call=async(fn)=>{if(left()<90)return null;try{return await fn();}catch{return null;}};
  const legal=await call(()=>services.validate(proposal.input,{}));if(legal?.ok!==true||legal.legal!==true){record.reason='proposal-not-currently-legal';continue;}
  const explore=(input,from)=>call(()=>services.explore(input,{coachEnumerationDeadline:stop,...(from?{from}:{}),observations:true,decisions:'builtin',perspective:o.team,
   maxOutcomes:40,maxKeep:256,maxLeaves:3500,threshold:.0001,maxMs:Math.max(50,Math.min(1300,left()-80))}));
  const ex=await explore(proposal.input),candidate={...proposal,ex,preparedBranches:new Map()};
  if(!validPolicyTree(candidate,o.team,new Set(),'root')){record.reason='proposal-exploration-uncertified';continue;}
  let failed=false;
  for(const b of ex.outcomes.filter(b=>!b.touchdown&&!b.turnover&&b.active===o.team&&b.observation?.ball?.playerId===proposal.targetId).sort((a,b)=>b.p-a.p)){
   if(!b.key||left()<700){failed=true;record.reason='scoring-success-state-or-budget-unavailable';break;}
   const actor=find(b.observation,proposal.targetId);
   if(!actor||!standing(actor)||!available(b.observation,actor)||!scoringRuleScope(b.observation).certified){failed=true;record.reason='receiver-has-no-real-activation';break;}
   const q=await call(()=>services.threats.scoring({from:b.key,team:o.team,players:[actor.id],maxMs:Math.max(50,Math.min(450,left()-500))}));
   if(q?.ok!==true||!Array.isArray(q.threats)||q.threats.some(t=>!validInput(t?.input)||t.input.playerId!==actor.id||!Number.isFinite(t.pTouchdown)||t.pTouchdown<0||t.pTouchdown>1)||
    !q.threats.length&&(q.truncated||q.exact===false)){failed=true;record.reason='receiver-score-discovery-failed';break;}
   const route=q.threats.slice().sort((a,b)=>b.pTouchdown-a.pTouchdown)[0];if(!route)continue;
   const validation=await call(()=>services.validate(route.input,{from:b.key,team:o.team}));if(validation?.ok!==true||validation.legal!==true){failed=true;record.reason='receiver-route-not-legal';break;}
   const follow=await explore(route.input,b.key),f={plan:{input:route.input,label:'receiver completes current-turn scoring route'},ex:follow};
   if(!validPolicyTree(f,o.team,new Set(),b.key)){failed=true;record.reason='receiver-scoring-exploration-uncertified';break;}
   candidate.preparedBranches.set(b.key,f);record.followups.push({from:b.key,mass:b.p,input:route.input});
  }
  if(failed)continue;
  const bounds=scoringPolicyBounds(candidate,o.team,inspect);record.bounds=bounds;
  if(!bounds.valid){record.reason=bounds.reason;continue;}
  const improvement=bounds.lower-current.upper;record.reason=improvement>1e-8?'strict-current-turn-TD-interval-improvement':'current-TD-interval-not-beaten';
  if(improvement<=1e-8)continue;
  const policy=policyFrom(candidate,candidate.preparedBranches,o.team,inspect);
  candidate.baseValue=weightedPolicyValue(policy,o,inspect);candidate.preparationGain=0;candidate.preparedScore=bounds.lower;
  candidate.unknown=bounds.unknown;candidate.goal={id:`final-score:${o.team}:${o.half}:${o.drive}:${o.turn[o.team]}`,kind:'complete-current-turn-score',target:proposal.targetId};
  return {...result,selected:candidate,reason:'missed-moving-transfer-clears-complete-current-scoring-upper-bound',evidence:{current,alternative:bounds,
   lowerAboveCurrentUpper:improvement,ordinaryValueNotUsed:true,previewPolicy:'builtin',ruleScope,source:'same real scoring objective; unretained probability credited to incumbent upper bound'}};
 }
 return {...result,reason:'no-certified-final-scoring-improvement; original choice retained'};
}
