/** S4.29 (S4.28 + last-action pickup; from the S4.27 prototype): bounded whole-Turn planner on engine-forked hypothetical states.
 *
 * The champion values ONE root action. Here a plan is a sequence of the acting team's actions, each applied by the real
 * engine (`explore` from the previous successor key), so legality, dice, turnover branches, open activations and
 * movement costs are the engine's. Value of a plan = expectation over its outcome branches:
 *   - a branch where the Turn ends (turnover / touchdown / opponent active) is a terminal with its board value;
 *   - other side branches (e.g. a push instead of a knock-down) are valued as they stand (no further actions);
 *   - the most likely continuing branch is the "main line" from which the next action is planned.
 * So a risky action placed early also loses the value of every later action on its failure branch, and a low-risk
 * setup whose value only appears after later actions is credited when those actions follow. Order is a search
 * variable, not a rule. Leaf value = champion board value − exposure of our ball/carrier (protect-first metric);
 * the best few plans then get the champion's own opponent-reply assessment from the actual End-of-Turn state.
 * Only the first action is returned; the coach re-plans from the real position after every action and dice result.
 */
import {exposure} from './protect-first.mjs';
const n=(x,d=0)=>Number.isFinite(x)?x:d;
const dist=(a,b)=>a&&b?Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y)):99;
const key=p=>`${p.x},${p.y}`;
const onPitch=p=>p?.location==='pitch'&&!!p.pos;
const standing=p=>onPitch(p)&&p.stance==='standing';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const PLANNER={depth:4,beam:3,perNode:8,replyTop:3,exposureWeight:8,margin:3,maxMs:30000,
 potential:0.5,maxActorValue:20,removal:10,stun:4,roleContact:3,riskSlack:0.02,riskGain:25,championMinMass:0.3,lastActionForfeit:2,orderTolerance:3,altBelow:0.6,altMin:0.15};
const has=(p,s)=>(p?.skills||[]).some(x=>x===s||String(x).startsWith(s+'('));
const ballHandler=p=>['pass','catch','sureHands'].some(x=>has(p,x));
const readyIds=(obs,team)=>obs.players.filter(p=>p.team===team&&onPitch(p)&&!p.activated&&p.canBeActivated!==false&&p.stance!=='stunned').map(p=>p.id);

/** S4.34 planner gate. Since S4.28 the planner is skipped while a validated saved continuation (multi-step S3 plan)
 * exists. That plan was made from an earlier position: when its next step is End Turn, the planner must still be
 * consulted, because ending the Turn forfeits every remaining action (real case: B1 away turn 40, the saved plan ended
 * the Turn with guard moves to the carrier's open squares still pending; the opponent blitzed the carrier from one of
 * them and scored). A continuation that is a real action keeps priority over a champion End Turn, as before. */
export function plannerGate({savedContinuation=false,championInput=null,continuationInput=null}={}){
 const endingTurn=continuationInput?.kind==='endTurn';
 return {run:!savedContinuation||endingTurn,reason:!savedContinuation?'no-saved-continuation':endingTurn?'saved-continuation-ends-turn':'saved-continuation'};
}

/** S4.34 late consult (H3, widened after review): when End Turn is the final choice and a saved continuation existed,
 * the planner compares End Turn with its plans unless it already used End Turn as its baseline (the early consult ran
 * with End Turn as the champion's input). Covers a continuation that is a real action and lost, a continuation that
 * itself ends the Turn while the early consult was skipped for budget, and an early consult that valued only the
 * champion's move. Champion in normal mode and >= 14 s left. */
export function lateConsultDue({chosen=null,savedContinuation=false,plannerRan=false,championInput=null,mode='normal',msLeft=0}={}){
 return chosen?.kind==='endTurn'&&savedContinuation&&(!plannerRan||championInput?.kind!=='endTurn')&&mode==='normal'&&msLeft>=14000;
}

/** S4.28 opportunity model: the value each still-ready player's best action is worth, from the champion's own root
 * evaluation (best line of that actor minus End Turn, ≥ 0, capped). A continuing leaf keeps the value of every player
 * who has not acted; a Turn-ending branch forfeits it. Doing a safe action first therefore banks its value against
 * later failures, instead of being charged a flat per-player cost. */
export function actorValues(lines){
 const m=new Map();if(!Array.isArray(lines))return m;
 const vals=lines.map(l=>replyNeutral(l));
 const endAt=lines.findIndex(l=>l?.input?.kind==='endTurn');
 const end=endAt>=0?vals[endAt]:Math.min(...vals.map(v=>n(v,Infinity)));
 if(!Number.isFinite(end))return m;
 lines.forEach((l,i)=>{const id=l?.actorId??l?.input?.playerId;if(!id||!Number.isFinite(vals[i]))return;
  m.set(id,Math.min(PLANNER.maxActorValue,Math.max(m.get(id)??0,vals[i]-end)));});
 return m;
}
/** S4.31: a champion line's value before its opponent-reply correction. The champion charges every line a flat
 * 18 × unchecked reply mass and replaces it by the measured reply only for the few lines it checks (End Turn is
 * usually one). Comparing a checked End Turn with unchecked lines inflated (or deflated) every opportunity value by the
 * difference — real case R1 step 41 world 202: #9's block was +24.6 over End Turn only because End Turn carried a
 * −30.7 measured reply and the block the flat −18; with both checked the block was −0.6. Both sides are compared
 * before any reply here; the planner charges real replies to its own final plans. */
export const replyNeutral=l=>Number.isFinite(l?.value)?l.value-n(l.replyAdjustment)+REPLY_FLAT*n(l.uncheckedReplyMass):NaN;
const REPLY_FLAT=18;

const ballAt=o=>o.ball?.kind==='held'?o.players.find(p=>p.id===o.ball.playerId)?.pos:o.ball?.kind==='ground'?o.ball.pos:null;
/** Leaf value: champion board value, minus exposure of a loose ball or of our own carrier. A leaf where our Turn
 * continues also keeps the potential of every still-ready player (the champion's own 2-per-actor opportunity scale);
 * a Turn-ending branch forfeits it, so an early risky action pays for the later actions it may cancel. */
export function leafValue(obs,team,inspect,w=PLANNER.exposureWeight,continuing=false,ctx=null){
 let v=inspect.boardValue(obs,team);
 if(continuing)for(const id of readyIds(obs,team))v+=ctx?.actorValues?.has(id)?ctx.actorValues.get(id):PLANNER.potential;
 // Useful damage: removals and stuns change the numbers for the rest of the drive (relative to the plan's root).
 if(ctx?.root){
  const count=(o,t,f)=>o.players.filter(p=>(p.team===t)===f).reduce((a,p)=>({off:a.off+(p.location!=='pitch'?1:0),stun:a.stun+(onPitch(p)&&p.stance==='stunned'?1:0)}),{off:0,stun:0});
  const r0=count(ctx.root,team,false),r1=count(obs,team,false),o0=count(ctx.root,team,true),o1=count(obs,team,true);
  v+=PLANNER.removal*((r1.off-r0.off)-(o1.off-o0.off))+PLANNER.stun*((r1.stun-r0.stun)-(o1.stun-o0.stun));
 }
 const car=obs.ball?.kind==='held'?obs.players.find(p=>p.id===obs.ball.playerId):null;
 const at=ballAt(obs);
 if(at&&(obs.ball.kind==='ground'||car?.team===team))v-=w*exposure(obs,at,team).total;
 return v;
}

/** A small, role-aware candidate set at one hypothetical position (engine-enumerated, then heuristically trimmed). */
async function nodeCandidates(obs,from,team,services,cap,forced=[],inspect=null){
 const out=[],seen=new Set();
 const push=(c,role)=>{const k=JSON.stringify(c.input);if(seen.has(k))return;seen.add(k);out.push({input:c.input,label:c.label||c.input.kind,role});};
 forced.forEach(c=>push(c,'forced'));
 const q=async opts=>{try{const r=await services.candidates({from,precision:'none',limit:60,maxMs:cap(),...opts});return r?.ok===false?[]:(r?.candidates||[]).filter(c=>c.legal!==false);}catch{return [];}};
 const mine=obs.players.filter(p=>p.team===team),foes=obs.players.filter(p=>p.team!==team);
 const ready=mine.filter(p=>onPitch(p)&&!p.activated&&p.canBeActivated!==false).map(p=>p.id);
 const at=ballAt(obs),car=obs.ball?.kind==='held'?obs.players.find(p=>p.id===obs.ball.playerId):null;
 if(!ready.length)return out;
 // 1. Ball: pickup when loose; carrier advance when ours.
 if(obs.ball?.kind==='ground')(await q({families:['secure','move'],region:{within:[obs.ball.pos]},sort:'steps'})).slice(0,2).forEach(c=>push(c,'pickup'));
 if(car?.team===team&&ready.includes(car.id))(await q({players:[car.id],families:['move'],maxRushes:0,sort:'goalDistance'})).slice(0,2).forEach(c=>push(c,'advance'));
 // 2. Protection: dice-free moves that most reduce the ball's exposure (one per player).
 if(at&&(obs.ball.kind==='ground'||car?.team===team)){
  const enemyZone=new Set();
  for(const f of foes)if(standing(f)&&f.tackleZone!==false)for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)enemyZone.add(`${f.pos.x+dx},${f.pos.y+dy}`);
  const cells=[];for(let dx=-3;dx<=3;dx++)for(let dy=-3;dy<=3;dy++)if(dx||dy)cells.push({x:at.x+dx,y:at.y+dy});
  const guards=ready.filter(id=>id!==car?.id);
  const moves=guards.length?await q({players:guards,families:['move'],maxRushes:0,region:{within:cells},sort:'steps',limit:100}):[];
  const base=exposure(obs,at,team).total,best=new Map();
  for(const c of moves){
   const p=obs.players.find(x=>x.id===c.input.playerId),to=c.input.path?.at(-1)?.to;
   if(!p||!to||key(to)===key(at)||[p.pos,...c.input.path.slice(0,-1).map(s=>s.to)].some(s=>enemyZone.has(key(s))))continue;
   const g=base-exposure({...obs,players:obs.players.map(x=>x.id===p.id?{...x,pos:to}:x)},at,team).total;
   if(g>0.2&&g>(best.get(p.id)?.g??-1))best.set(p.id,{c,g});
  }
  [...best.values()].sort((a,b)=>b.g-a.g).slice(0,3).forEach(x=>push(x.c,'guard'));
 }
 // 3. Contact: blocks/blitzes on opponents that matter (near the ball, or marking our carrier).
 const targets=foes.filter(f=>standing(f)&&(!at||dist(f.pos,at)<=6)).map(f=>f.id);
 if(targets.length){
  const hits=await q({families:['block','blitz'],targets,maxRushes:0,sort:'steps'});
  const prio=c=>{const t=obs.players.find(x=>x.id===(c.input.blockTarget||c.input.blitzTarget||c.targetId));return (car&&t&&dist(t.pos,car.pos)===1?-10:0)+(t&&at?dist(t.pos,at):9);};
  hits.sort((a,b)=>prio(a)-prio(b)).slice(0,3).forEach(c=>push(c,'contact'));
 }
 // 4. Support/setup: dice-free moves of other ready players, ranked by the champion's own cheap geometric score, so a
 //    setup whose value appears only after later actions can enter the plan.
 if(out.length<PLANNER.perNode+forced.length){
  const others=ready.filter(id=>id!==car?.id);
  const moves=others.length?await q({players:others,families:['move'],maxRushes:0,sort:'steps',limit:60}):[];
  const rank=c=>{try{const x=inspect?.canonical?.(c,obs);return x&&inspect.cheapScore?inspect.cheapScore(obs,x,team,inspect.boardValue(obs,team)):0;}catch{return 0;}};
  const per=new Map();
  for(const c of moves){const r=rank(c);if(!per.has(c.input.playerId)||r>per.get(c.input.playerId).r)per.set(c.input.playerId,{c,r});}
  [...per.values()].sort((a,b)=>b.r-a.r).slice(0,2).forEach(x=>push(x.c,'support'));
 }
 return out.slice(0,PLANNER.perNode+forced.length);
}

/** Beam search. Returns {best, plans, report}; best=null means "no plan beats the champion's own first action". */
export async function planTurn(o,services,inspect,deadline,{championInput=null,championLine=null,championLines=null,extraRoot=[]}={}){
 const t0=Date.now(),until=Math.min(deadline,t0+PLANNER.maxMs),left=()=>until-Date.now();
 const cap=(ms=700)=>Math.max(80,Math.min(ms,left()-200));
 const team=o.team,report={attempted:true,explores:0,candidateCalls:0,nodes:0,failures:[],depthReached:0};
 if(o.phase!=='play'||o.pending||o.active!==team)return {best:null,plans:[],report:{...report,attempted:false,reason:'not-own-open-turn'}};
 const explore=async(input,from)=>{
  if(left()<300)return null;report.explores++;
  try{const ex=await services.explore(input,{...(from&&from!=='root'?{from}:{}),observations:true,decisions:'builtin',perspective:team,threshold:1e-4,maxOutcomes:40,maxKeep:128,maxLeaves:3500,maxMs:cap(1200)});
   return ex?.ok===true&&Array.isArray(ex.outcomes)&&ex.outcomes.length?ex:null;}catch(e){report.failures.push(String(e).slice(0,80));return null;}
 };
 const ctx={actorValues:actorValues(championLines),root:o};
 // With a loose ball, keep time for the loose-ball order check (it runs after the search).
 const reserve=o.ball?.kind==='ground'?4000:0;
 const lv=(obs,cont=false)=>leafValue(obs,team,inspect,undefined,cont,ctx);
 report.actorValues=Object.fromEntries([...ctx.actorValues].map(([k,v])=>[k,Math.round(v*10)/10]));
 const ends=b=>!!b.turnover||!!b.touchdown||b.active!==team||b.observation?.active!==team||b.observation?.phase!=='play';
 // A node is one plan prefix: value of finished side branches + probability-weighted main line.
 const root={seq:[],key:'root',obs:o,pMain:1,side:0,cost:0,value:lv(o,true),risk:0};
 let frontier=[root];const all=[root];
 for(let depth=0;depth<PLANNER.depth&&left()>1500+reserve;depth++){
  const next=[];
  for(const node of frontier){
   if(left()<1200+reserve)break;
   report.candidateCalls++;
   // The champion's own action stays a candidate at every depth until played, so "safe actions first, then the
   // champion's risky action" is a plan the search can actually build (the engine rejects it where it became illegal).
   const champLater=championInput&&!node.seq.some(x=>same(x.input,championInput))?[{input:championInput,label:'champion'}]:[];
   const forced=depth===0?[...champLater,...extraRoot]:champLater;
   const cands=await nodeCandidates(node.obs,node.key,team,services,cap,forced,inspect);
   for(const c of cands){
    if(left()<800+reserve)break;
    const isChampion=depth===0&&championInput&&same(c.input,championInput);
    let ex=await explore(c.input,node.key);
    let mass=ex?ex.outcomes.filter(b=>b.observation).reduce((s,b)=>s+n(b.p),0):0;
    // The champion's own root action must never be a blind spot: fall back to the outcome tree the champion itself
    // explored, accepting partial coverage; the missing mass is valued pessimistically below.
    if(isChampion&&mass<0.9&&championLine?.ex?.outcomes?.length){
     const cm=championLine.ex.outcomes.filter(b=>b.observation).reduce((s,b)=>s+n(b.p),0);
     if(cm>mass){ex={...championLine.ex,outcomes:championLine.ex.outcomes.filter(b=>b.observation)};mass=cm;report.championSource='champion-root-tree';}
    }
    const minMass=isChampion?PLANNER.championMinMass:0.9;
    if(!ex||mass<minMass){report.failures.push({at:depth,input:c.input,reason:'incomplete-outcomes',mass});continue;}
    if(isChampion&&mass<0.9)report.championPartialMass=Math.round(mass*1000)/1000;
    ex={...ex,outcomes:ex.outcomes.filter(b=>b.observation)};
    // Unenumerated mass is valued pessimistically: as a Turn-ending outcome at the unchanged position, and as risk.
    let side=node.side+node.pMain*(1-mass)*lv(node.obs),main=null,risk=node.risk+node.pMain*(1-mass);
    for(const b of ex.outcomes){
     const p=node.pMain*n(b.p);
     if(ends(b)){side+=p*lv(b.observation);if(b.turnover)risk+=p;}
     else if(!main||b.p>main.p)main=b;
    }
    for(const b of ex.outcomes)if(!ends(b)&&b!==main)side+=node.pMain*n(b.p)*lv(b.observation,true);
    const pMain=main?node.pMain*n(main.p):0;
    // S4.33: the most probable branch that leaves the main line (absolute probability), so its own opponent reply
    // can be measured for the final plans; a Turn-ending branch is already at the opponent's start.
    // Representatives of the two groups of non-main mass: turnovers (their mass is the plan's risk) and every other
    // branch (knock-downs, both-down, other push squares...). One failed pickup is ~8 bounce branches of ~6 % each,
    // so a group, not a single branch, is what carries the mass.
    let altT=node.altT??null,altO=node.altO??null;
    for(const b of ex.outcomes){const p=node.pMain*n(b.p);
     if(b===main||!b.key||b.touchdown)continue;
     const rec={key:b.key,p,ends:ends(b),turnover:!!b.turnover,active:b.active,observation:b.observation};
     if(b.turnover){if(p>(altT?.p??0))altT=rec;}else if(p>(altO?.p??0))altO=rec;}
    // A plan that ends the Turn with certainty (End Turn) has no continuing line; keep its real End-of-Turn branch so
    // its opponent reply is measured like every other plan's (S4.29: End Turn was otherwise never charged a reply).
    const endBranch=!main&&ex.outcomes.length===1&&ex.outcomes[0].key&&ex.outcomes[0].active!==team&&!ex.outcomes[0].turnover?ex.outcomes[0]:null;
    // Role preservation: a ball-handler spent on contact is a cost the board value does not see.
    const actor=node.obs.players.find(p=>p.id===c.input.playerId);
    const cost=node.cost+(['block','blitz'].includes(c.input.action)&&ballHandler(actor)?PLANNER.roleContact:0);
    const firstDiceFree=node.seq.length?node.firstDiceFree:(ex.outcomes.length===1&&!(n(ex.pTurnover)>0)&&mass>1-1e-9);
    const child={seq:[...node.seq,{input:c.input,label:c.label,role:c.role,pTurnover:n(ex.pTurnover)}],key:main?.key??null,obs:main?.observation??null,
     pMain,side,risk,cost,firstDiceFree,endBranch,altT,altO,value:side+(main?pMain*lv(main.observation,true):0)-cost};
    report.nodes++;all.push(child);if(main&&main.key)next.push(child);
   }
  }
  report.depthReached=depth+1;
  next.sort((a,b)=>b.value-a.value);
  // Keep the champion's own line alive one level so the comparison is like-for-like.
  const keep=next.slice(0,PLANNER.beam);
  const champ=next.find(x=>championInput&&same(x.seq[0].input,championInput));
  if(champ&&!keep.includes(champ))keep.push(champ);
  frontier=keep;
 }
 // S4.30 loose-ball order check: value of the two-action sequence (a, b) from the root with FULL branching — b is
 // applied on every continuing outcome of a (not only the most likely one), turn-ending branches are terminal, and
 // unenumerated mass is pessimistic and counted as risk. Returns {value, risk, unplayed, firstCertain} or null if not
// measurable. unplayed = mass of continuing branches where b could not be measured (illegal, refused, timed out, too
// little mass) and was valued as not played; firstCertain = a has one certain, non-turnover outcome from the root.
 const observed=ex=>ex?{...ex,outcomes:ex.outcomes.filter(y=>y.observation)}:null;
 const massOf=ex=>ex?ex.outcomes.filter(y=>y.observation).reduce((t,y)=>t+n(y.p),0):0;
 const contactMin=PLANNER.championMinMass;
 const evalPair=async(a,b)=>{
  let ex1=await explore(a,'root');
  // A contact action is often not fully enumerable; reuse the champion's own root tree for it (as the main search does).
  if(massOf(ex1)<0.9&&championInput&&same(a,championInput)&&massOf(championLine?.ex)>massOf(ex1))ex1=championLine.ex;
  ex1=observed(ex1);if(!ex1)return null;
  let value=0,risk=0,mass1=0,unplayed=0;
  for(const x of ex1.outcomes){if(!x.observation)continue;const p=n(x.p);mass1+=p;
   if(ends(x)){value+=p*lv(x.observation);if(x.turnover)risk+=p;continue;}
   const ex2=x.key?observed(await explore(b,x.key)):null;
   const m2=massOf(ex2),minB=['block','blitz','foul'].includes(b.action)?contactMin:0.9;
   // b not possible/measurable here: the branch stands as it is (b not played on this branch)
   if(!ex2||m2<minB){value+=p*lv(x.observation,true);unplayed+=p;continue;}
   value+=p*(1-m2)*lv(x.observation);risk+=p*(1-m2);
   for(const y of ex2.outcomes){if(!y.observation)continue;const q=p*n(y.p);
    value+=q*lv(y.observation,!ends(y));if(y.turnover)risk+=q;}
  }
  if(mass1<contactMin)return null;
  value+=(1-mass1)*lv(o);risk+=1-mass1;
  return {value,risk,unplayed,firstCertain:ex1.outcomes.length===1&&!(n(ex1.pTurnover)>0)&&!ex1.outcomes[0].turnover&&mass1>1-1e-9};
 };
 const orderCheck=async contact=>{
  if(o.ball?.kind!=='ground'||!['block','blitz','foul'].includes(contact?.action))return null;
  const isPick=i=>i?.kind==='playerAction'&&(i.action==='secure'||(i.action==='move'&&key(i.path?.at(-1)?.to??{x:-1,y:-1})===key(o.ball.pos)));
  const pickup=all.filter(x=>x.seq.length===1&&isPick(x.seq[0].input)).sort((a,b)=>b.value-a.value)[0]?.seq[0];
  if(!pickup||left()<3000)return null;
  const cp=await evalPair(contact,pickup.input),pc=await evalPair(pickup.input,contact);
  if(!cp||!pc)return {measured:false};
  const r=x=>Math.round(x*1000)/1000,v=x=>Math.round(x*10)/10;
  const pickupFirst=pc.value>=cp.value||(pc.value>=cp.value-PLANNER.orderTolerance&&pc.risk<cp.risk-PLANNER.riskSlack);
  return {measured:true,pickupFirst,pickup:pickup.input,pickupLabel:pickup.label,
   contactFirst:{value:v(cp.value),risk:r(cp.risk)},pickupFirstOrder:{value:v(pc.value),risk:r(pc.risk)}};
 };
 // Opponent reply for the best few complete plans and the champion-first plan, from the real End-of-Turn state.
 const ranked=all.filter(x=>x.seq.length).sort((a,b)=>b.value-a.value);
 const champBest=championInput?ranked.find(x=>same(x.seq[0].input,championInput)):null;
 // Ball safety as a constraint on selection (S4.28): only plans no riskier than the champion's plan (+ slack) compete,
 // so a safe reordering is chosen even when an unsafe variant has the highest raw value.
 // S4.29 last-action pickup: with the ball loose and (almost) nothing left to forfeit — the ready players' own best
 // actions are worth <= lastActionForfeit — a failed pickup only lets the ball bounce, which is no worse than leaving it
 // loose, so a plan that starts with the pickup is not filtered on raw turnover probability (it must still beat the
 // champion plan by the margin, with the opponent reply measured). Real case: bb 326 world 101, champion End Turn
 // with B7's 67 % pickup available (evaluation/probes/diagB2-326-101-end.jsonl).
 // What a failed pickup forfeits: the other ready players' values (the picker's own value is the pickup itself).
 const forfeitableFor=id=>[...ctx.actorValues].reduce((a,[k,v])=>k===id?a:a+v,0);
 // Verified from the input itself (not the candidate role label): a Secure, or a move that ends on the ball square.
 const isPickup=i=>o.ball?.kind==='ground'&&i?.kind==='playerAction'&&(i.action==='secure'||(i.action==='move'&&key(i.path?.at(-1)?.to??{x:-1,y:-1})===key(o.ball.pos)));
 const lastActionPickup=x=>isPickup(x.seq[0]?.input)&&forfeitableFor(x.seq[0].input.playerId)<=PLANNER.lastActionForfeit;
 report.forfeitable=Math.round([...ctx.actorValues.values()].reduce((a,v)=>a+v,0)*10)/10;
 const admissible=champBest?ranked.filter(x=>x.risk<=champBest.risk+PLANNER.riskSlack||lastActionPickup(x)):ranked;
 report.riskFiltered=ranked.length-admissible.length;
 // S4.33: the champion plan is measured first — it is the baseline of every override; a budget that runs out must not
 // leave it raw while the plans compared with it pay their replies (real case: bb step 256 world 202).
 const finals=[...new Set([...(champBest?[champBest]:[]),...admissible.slice(0,PLANNER.replyTop)])];
 // Opponent reply per final plan from its real End-of-Turn state. S4.33: where the main line carries less than altBelow
 // of a plan, also the reply after its most probable other branch (a knock-down, a both-down, a failed pickup...), so the
 // plan is charged the mass-weighted mean of two measured replies instead of assuming every branch faces the main
 // line's reply. Both are measured together per plan, so a short budget cannot leave only some plans two-branch.
 const call=async fn=>{if(left()<200)return null;try{return await fn();}catch{return null;}};
 const assess=async at=>{if(!at?.key||at.active===team)return null;
  try{const r=await inspect.replyAssessment(at,services,call,cap,team,left,false);
   return r?.failed?null:{critical:n(r.criticalAdjustment),position:n(r.positionAdjustment),unknown:!!r.unknown};}catch{return null;}};
 const pmOf=f=>f.endBranch?n(f.endBranch.p,1):f.pMain;
 // The larger non-main group (turnover mass or other mass) and its most probable branch as representative.
 const altOf=f=>{const pm=pmOf(f),mT=Math.min(f.risk,1-pm),mO=Math.max(0,1-pm-mT);
  const g=mT>=mO?{rep:f.altT,mass:mT}:{rep:f.altO,mass:mO};return g.rep?g:null;};
 const needsAlt=f=>pmOf(f)<PLANNER.altBelow&&(altOf(f)?.mass??0)>=PLANNER.altMin;
 for(const f of finals){
  f.reply=null;f.altReply=null;
  if((!f.key&&!f.endBranch)||left()<2500+reserve||typeof inspect.replyAssessment!=='function')continue;
  let at=f.endBranch;
  if(!at){const end=await explore({kind:'endTurn'},f.key);at=end?.outcomes?.length===1?end.outcomes[0]:null;}
  f.reply=await assess(at);
  if(!f.reply||!needsAlt(f)||left()<2000+reserve)continue;
  const g=altOf(f);let alt=null;
  // A Turn-ending branch is already at the opponent's start; otherwise (or if the hand-over is still pending) end it.
  if(g.rep.ends&&g.rep.active!==team)alt={key:g.rep.key,active:g.rep.active,observation:g.rep.observation};
  else{const end=await explore({kind:'endTurn'},g.rep.key);alt=end?.outcomes?.length===1?end.outcomes[0]:null;}
  const r=await assess(alt);
  if(r)f.altReply={...r,p:g.mass,pMain:pmOf(f),repP:g.rep.p,turnover:g.rep.turnover};
 }
 // Same basis for every plan: if any measured plan that needed a second reply did not get one, none uses it.
 const twoBranch=finals.filter(f=>f.reply&&needsAlt(f)).every(f=>f.altReply);
 report.replyBasis=twoBranch?'two-branch':'main-line (second reply incomplete)';
 if(!twoBranch)for(const f of finals){f.altUnused=f.altReply;f.altReply=null;}
 const R=x=>Math.min(0,x.critical)+Math.min(0,x.position);
 const adjusted=f=>f.value+(!f.reply?0:f.altReply?(f.altReply.pMain*R(f.reply)+f.altReply.p*R(f.altReply))/(f.altReply.pMain+f.altReply.p):R(f.reply));
 // Only plans whose reply was measured compete with each other on the adjusted value; others keep raw value.
 const scored=finals.filter(f=>f.reply).sort((a,b)=>adjusted(b)-adjusted(a));
 const best=scored[0]??admissible[0]??null;
 report.elapsedMs=Date.now()-t0;
 const view=f=>f&&{first:f.seq[0].input,labels:f.seq.map(s=>`${s.label}${s.pTurnover>0?` (${Math.round(s.pTurnover*100)}%)`:''}`),
  roles:f.seq.map(s=>s.role),value:Math.round(f.value*10)/10,adjusted:Math.round(adjusted(f)*10)/10,pTurnover:Math.round(f.risk*1000)/1000,reply:f.reply,altReply:f.altReply??null};
 report.best=view(best);report.bestRaw=view(ranked[0]);report.championPlan=view(champBest);report.rootValue=Math.round(root.value*10)/10;
 report.top=ranked.slice(0,5).map(view);
 const decided=await decide();
 // The action about to be played (planner's or champion's). If it is contact before a loose-ball pickup, compare the
 // two orders explicitly; play the pickup first only when that order is at least as valuable (or nearly so and safer).
 const toPlay=decided.best?decided.best.input:championInput;
 const oc=await orderCheck(toPlay);
 if(oc){report.orderCheck=oc;
  if(oc.pickupFirst)return {best:{input:oc.pickup,label:oc.pickupLabel,plan:{labels:[oc.pickupLabel,'then contact']}},plans:decided.plans,report:{...decided.report,...report,reason:'pickup-before-contact'}};
 }
 // S4.34 risky-before-dice-free order check. The plan about to be started may play a risky action (block, blitz,
 // dodge, rush, pickup) first and a dice-free action of another player later in the same Turn; if the risky one fails,
 // the later one is forfeited. Real cases: A2 away 428 ([blitz 11 %, #9 move L9, …], Both Down), B1 away 298 (79 %
 // pickup with "#3 move to M7" planned after it). Both orders are valued with full branching (evalPair); the dice-free
 // action goes first only when that order is worth at least as much (within orderTolerance) and is not riskier — a
 // risky-first order that is genuinely better (e.g. a blitz that opens the route the move needs) is kept.
 const plan=decided.best?best:(best&&championInput&&same(best.seq[0].input,championInput)?best:champBest);
 const rf=await riskFirstCheck(toPlay,plan);
 if(rf){report.riskFirstCheck=rf;
  if(rf.diceFreeFirst)return {best:{input:rf.first,label:rf.firstLabel,plan:{labels:[rf.firstLabel,'then '+rf.riskyLabel]}},plans:decided.plans,report:{...decided.report,...report,reason:'dice-free-before-risky'}};
 }
 return {...decided,report:{...decided.report,...report}};
 async function riskFirstCheck(a,p){
  const head=p?.seq?.[0];
  if(!a||a.kind!=='playerAction'||!head||!same(head.input,a)||!(n(head.pTurnover)>0))return null;
  const d=p.seq.slice(1).find(x=>x.input?.kind==='playerAction'&&!(n(x.pTurnover)>0)&&x.input.playerId&&x.input.playerId!==a.playerId&&
   !['block','blitz','foul'].includes(x.input.action)&&!isPickup(x.input));
  if(!d)return null;
  if(left()<3000)return {measured:false,reason:'time',candidate:d.label};
  const rf=await evalPair(a,d.input),df=await evalPair(d.input,a);
  if(!rf||!df)return {measured:false,reason:'order-unmeasurable',candidate:d.label};
  // S4.34 review: the comparison is only valid when d really is dice-free where it would be played (its plan entry was
  // measured after a, not at the root) and when each order's second action was measured on every continuing branch —
  // an unmeasured second action is valued as "not played" with no risk, which would make an order that destroys the
  // risky action (lost assist, illegal hand-off) or skips its dice look free. The planner's own block/blitz explores
  // are refused by the live-explore guard (no caller window), so this keeps H4 to measurable risky actions.
  if(!df.firstCertain)return {measured:false,reason:'not-dice-free-at-root',candidate:d.label};
  if(df.unplayed>1e-9||rf.unplayed>1e-9)return {measured:false,reason:'second-action-unmeasured',candidate:d.label,
   unplayed:{riskyFirst:Math.round(rf.unplayed*1000)/1000,diceFreeFirst:Math.round(df.unplayed*1000)/1000}};
  const r=x=>Math.round(x*1000)/1000,v=x=>Math.round(x*10)/10;
  const diceFreeFirst=df.value>=rf.value-PLANNER.orderTolerance&&df.risk<=rf.risk+1e-6;
  return {measured:true,diceFreeFirst,first:d.input,firstLabel:d.label,riskyLabel:head.label,
   riskyFirst:{value:v(rf.value),risk:r(rf.risk)},diceFreeFirstOrder:{value:v(df.value),risk:r(df.risk)}};
 }
 async function decide(){
 if(!best)return {best:null,plans:[],report:{...report,reason:'no-plan'}};
 // Without a measured champion-first plan there is no like-for-like comparison. One exception (S4.28): with the ball
 // loose and an unmeasurable contact action from the champion, a plan that STARTS with a certain dice-free action is
 // played — it cannot fail, keeps the contact available afterwards, and the planner re-decides from the real result.
 if(!champBest){
  const contact=['block','blitz','foul'].includes(championInput?.action);
  if(o.ball?.kind==='ground'&&contact){
   const safe=ranked.filter(x=>x.firstDiceFree).sort((a,b)=>adjusted(b)-adjusted(a))[0];
   if(safe)return {best:{input:safe.seq[0].input,label:safe.seq[0].label,plan:view(safe)},plans:finals,report:{...report,reason:'dice-free-before-unmeasured-contact'}};
  }
  return {best:null,plans:finals,report:{...report,reason:'champion-plan-unmeasured'}};
 }
 if(champBest&&same(best.seq[0].input,championInput))return {best:null,plans:finals,report:{...report,reason:'champion-first-action-is-best-plan-start'}};
 if(champBest&&adjusted(best)<adjusted(champBest)+PLANNER.margin)return {best:null,plans:finals,report:{...report,reason:'gain-below-margin'}};
 if(!best.reply&&champBest?.reply)return {best:null,plans:finals,report:{...report,reason:'best-plan-reply-unmeasured'}};
 // S4.33: and the reverse — a measured plan is not compared with a champion plan whose reply is missing.
 if(best.reply&&!champBest.reply)return {best:null,plans:finals,report:{...report,reason:'champion-plan-reply-unmeasured'}};
 // Ball safety first: never trade extra turnover risk for a small modelled gain.
 // Ball safety first (prototype rule): the planner only reorders/chooses plans that are not riskier than the champion's
 // plan (+2 points slack). Risk-for-reward trades stay with the champion while the leaf evaluation is this coarse.
 if(best.risk>champBest.risk+PLANNER.riskSlack&&!lastActionPickup(best))
  return {best:null,plans:finals,report:{...report,reason:'more-turnover-risk-than-champion-plan'}};
 if(best.risk>champBest.risk+PLANNER.riskSlack&&!best.reply)return {best:null,plans:finals,report:{...report,reason:'last-action-pickup-reply-unmeasured'}};
 return {best:{input:best.seq[0].input,label:best.seq[0].label,plan:view(best)},plans:finals,report:{...report,reason:best.risk>champBest.risk+PLANNER.riskSlack?'last-action-pickup':'whole-turn-plan-improvement'}};
 }
}
