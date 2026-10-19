import {same,completeAction,policyFrom,weightedPolicyValue} from './policy.mjs';
import {summarizeEndpointValues} from './endpoint-value.mjs';
const EPS=1e-8,other=t=>t==='A'?'B':'A',copy=x=>JSON.parse(JSON.stringify(x));
const active=p=>p?.location==='pitch'&&p.pos&&p.stance==='standing';
const has=(p,s)=>p?.skills?.includes(s),dist=(a,b)=>Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const key=x=>JSON.stringify(stable(x)),prob=x=>Number.isFinite(x)&&x>=0&&x<=1;
const ordinary=i=>i?.kind==='playerAction'&&i.action==='move'&&typeof i.playerId==='string'&&Array.isArray(i.path)&&i.path.length&&i.path.every(s=>s.kind==='step'&&Number.isInteger(s.to?.x)&&Number.isInteger(s.to?.y))&&Object.keys(i).every(k=>['kind','playerId','action','path'].includes(k));
const holder=o=>o?.ball?.kind==='held'?o.players.find(p=>p.id===o.ball.playerId):null;
function exploration(e,from,perspective,team){return e?.ok===true&&e.outcomeIdentity==='complete-state-v1'&&e.position?.key===from&&e.perspective===perspective&&e.activeTeam===team&&e.decisionPolicy?.mode==='builtin'&&e.decisionPolicy.own==='builtin'&&e.decisionPolicy.opponent==='builtin'&&Array.isArray(e.outcomes)&&prob(e.rest?.p)&&prob(e.unresolvedMass)&&e.outcomes.every(b=>prob(b.p)&&typeof b.turnover==='boolean'&&(b.touchdown==null||['A','B'].includes(b.touchdown))&&(b.active==null||['A','B'].includes(b.active))&&(!b.observation||b.active==null||b.observation.active===b.active))&&Math.abs(e.outcomes.reduce((n,b)=>n+b.p,0)+e.rest.p-1)<=EPS;}
/** Source-bound existing V6 builtin immediate-active-team TD summary contract.
 * This is not a retained success distribution and must never extend a plan.
 * Extrapolation can shift reported TD by at most unresolved chance mass.
 * Solved policies and sequence headers do NOT satisfy this contract. */
export function activeTeamTDBounds(e,{from,team,perspective}){
 const q=team===perspective?e?.pTouchdown:e?.pOpponentTouchdown,u=e?.unresolvedMass;
 if(!exploration(e,from,perspective,team)||!prob(q)||u>=1||!Number.isFinite(e.enumerated)||e.enumerated<0||!e.applied||!Number.isFinite(e.leaves)||e.leaves<1||typeof e.exact!=='boolean'||Object.hasOwn(e,'finals')||Object.hasOwn(e,'steps'))return {valid:false,lower:0,upper:1};
 const total=e.enumerated/(1-u),tolerance=EPS+Math.abs(total-1);
 if(Math.abs(total-1)>1e-6)return {valid:false,lower:0,upper:1};
 return {valid:true,lower:Math.max(0,q-u-tolerance),upper:Math.min(1,q+u+tolerance),reported:q,unresolved:u,normalization:total,
  scope:'fixed builtin single-final-action active-team TD; audited V6 extrapolation bound, not full opposing Turn or adversarial decisions'};
}
function receivers(o,team){const car=holder(o),goal=o.pitch?.endZone?.[team];if(!car||car.team!==team||!Number.isInteger(goal))return [];
 return o.players.filter(p=>p.team===team&&p.id!==car.id&&active(p)&&!p.activated&&p.canBeActivated!==false&&!has(p,'noBall')&&!p.rooted&&dist(p.pos,car.pos)<=1&&Math.abs(goal-p.pos.x)<=p.ma+(has(p,'sprint')?3:2))
 .sort((a,b)=>Math.abs(goal-a.pos.x)-Math.abs(goal-b.pos.x)||b.ma-a.ma||a.id.localeCompare(b.id)).slice(0,2);
}
/** Retain real, cheap policy endpoints while they still have session identity.
 * The frozen chooser still receives its original result unchanged. No scoring
 * decision is made here; all final alternatives use the actual later incumbent. */
export function createReceiverDefenseReservation(o,services,deadline){
 const opp=other(o.team),car=holder(o),potential=car?.team===opp?o.players.filter(p=>p.team===opp&&active(p)&&p.id!==car.id&&!has(p,'noBall')&&dist(p.pos,car.pos)<=1&&Math.abs(o.pitch.endZone[opp]-p.pos.x)<=p.ma+(has(p,'sprint')?3:2)):[];
 const enabled=o.phase==='play'&&!o.pending&&o.active===o.team&&o.turn?.[o.team]===o.turnsPerHalf&&o.turn?.[opp]===o.turnsPerHalf-1&&car?.team===opp&&potential.length>0;
 const result={enabled,records:[],captures:0,calls:0,elapsedMs:0,rejected:[],scope:'last own Turn before opponent final Turn; at most24 genuine deterministic own Move/End endpoints and two adjacent receivers; no full-Turn coverage'};
 const until=Math.min(deadline-12000,Date.now()+5500),seen=new Set();
 const call=async(method,args)=>{if(Date.now()>until-70)return null;result.calls++;try{return await method(...args);}catch{return null;}};
 const explore=(i,from,team,maxOutcomes=4)=>call(services.explore,[i,{coachEnumerationDeadline:until,from,team,perspective:o.team,observations:true,decisions:'builtin',maxOutcomes,maxLeaves:5000,threshold:.000001,maxMs:Math.max(50,Math.min(550,until-Date.now()-70))}]);
 result.capture=async(input,opts,e)=>{
  if(!enabled||result.records.length>=24||Date.now()>until-200||opts?.from&&opts.from!=='root'||opts?.team&&opts.team!==o.team||seen.has(key(input))||input?.kind!=='endTurn'&&!ordinary(input))return;
  if(!exploration(e,'root',o.team,o.team)||!completeAction(e,o.team)||e.outcomes.length!==1||e.outcomes[0].p<1-EPS||e.outcomes[0].turnover||e.outcomes[0].touchdown||!e.outcomes[0].key||!e.outcomes[0].observation)return;
  seen.add(key(input));const started=Date.now();let fork;
  try{
   // A builtin roll-free aggregate alone cannot exclude hidden optional offers.
   if(!services.fork?.open||!services.fork?.close)return;
   fork=await call(services.fork.open,[{from:'root',input,controlTeam:o.team,controlAll:true}]);
   if(fork?.ok!==true||fork.from!=='root'||fork.revisionBound!==true||fork.node!=='terminal'||!fork.completed||fork.turnover||fork.touchdown||typeof fork.position!=='string')return;
   const first=e.outcomes[0],closed=input.kind==='endTurn'?e:await explore({kind:'endTurn'},first.key,o.team,1);
   if(!exploration(closed,input.kind==='endTurn'?'root':first.key,o.team,o.team)||!completeAction(closed,o.team)||closed.outcomes.length!==1)return;
   const at=closed.outcomes[0];if(at.p<1-EPS||at.turnover||at.touchdown||at.active!==opp||!at.key||!at.observation||holder(at.observation)?.id!==car.id)return;
   const available=receivers(at.observation,opp),transfers=[];
   for(const p of available){for(const transfer of [{kind:'playerAction',playerId:car.id,action:'handoff',path:[],handoffTarget:p.id},{kind:'playerAction',playerId:car.id,action:'pass',path:[],passTarget:p.pos}]){
    const v=await call(services.validate,[transfer,{from:at.key,team:opp}]);
    if(v?.ok!==true||v.position!==at.key||typeof v.legal!=='boolean'){transfers.push({input:transfer,receiver:p.id,unknown:true});continue;}
    if(!v.legal){transfers.push({input:transfer,receiver:p.id,illegal:true});continue;}
    const ex=await explore(transfer,at.key,opp,4);transfers.push({input:transfer,receiver:p.id,ex,unknown:!exploration(ex,at.key,o.team,opp)});
   }}
   result.records.push({input:copy(input),ex:e,close:closed,at,receivers:available.map(p=>p.id),transfers});result.captures++;
  }finally{if(fork?.fork)try{await services.fork.close({fork:fork.fork});}catch{}result.elapsedMs+=Date.now()-started;}
 };
 return result;
}
export async function challengeReceiverDefense(o,snapshot,reservation,services,inspect,deadline){
 const result={attempted:false,selected:null,reason:'outside-final-receiver-defense',policies:[],reservation:{enabled:!!reservation?.enabled,records:reservation?.records?.length||0,calls:reservation?.calls||0,elapsedMs:reservation?.elapsedMs||0}};
 if(!reservation?.enabled||snapshot?.mode!=='normal'||!snapshot.selected||deadline-Date.now()<4500)return result;
 if((snapshot.lines||[]).some(c=>(c.ex?.pTouchdown||0)>EPS||(c.preparedScore||0)>EPS))return {...result,reason:'known-own-TD-protected'};
 const selected=snapshot.selected;
 if(selected.preparedBranches?.size||selected.preparation||selected.preparationPlans?.length||selected.preparationGain>EPS)return {...result,reason:'existing-own-dependency-protected'};
 const incumbent=reservation.records.find(r=>same(r.input,selected.input));
 if(!incumbent)return {...result,reason:'actual-incumbent-endpoint-not-retained'};
 const opp=other(o.team),goal=o.pitch.endZone[opp],car=holder(o),potential=incumbent.receivers.map(id=>o.players.find(p=>p.id===id)),dir=Math.sign(goal-car.pos.x);
 const score=r=>{if(r.input.kind==='endTurn')return -1;const to=r.input.path?.at(-1)?.to;if(!to)return Infinity;const near=potential.filter(p=>dir*(to.x-p.pos.x)>0&&dir*(to.x-p.pos.x)<=4);return near.length?Math.min(...near.map(p=>dist(p.pos,to)))+(r.input.path.length*.02):Infinity;};
 const choices=reservation.records.filter(r=>!same(r.input,incumbent.input)&&Number.isFinite(score(r))).sort((a,b)=>score(a)-score(b)||key(a.input).localeCompare(key(b.input))).slice(0,2);
 if(!choices.length)return {...result,reason:'no-retained-goal-side-screen'};
 const started=Date.now(),records=[incumbent,...choices],until=Math.min(deadline,started+30000),left=()=>until-Date.now(),routes=new Map(),transferInputs=new Map();result.attempted=true;
 const call=async(f,args)=>{if(left()<80)return null;try{return await f(...args);}catch{return null;}};
 for(const r of records){for(const t of r.transfers)transferInputs.set(key(t.input),{input:t.input,receiver:t.receiver});
  for(const id of [car.id,...r.receivers]){const q=await call(services.candidates,[{from:r.at.key,team:opp,players:[id],families:['move'],region:{x0:goal,x1:goal},sort:'steps',precision:'none',limit:40,maxMs:Math.max(50,Math.min(500,left()-70))}]);
   if(q?.ok!==true||q.position?.key!==r.at.key||q.hasMore===true||q.complete===false||q.truncated!==undefined&&(!Array.isArray(q.truncated)||q.truncated.length>0)||!Array.isArray(q.candidates)||q.candidates.some(c=>!ordinary(c.input)||c.input.playerId!==id))return {...result,reason:'receiver-route-discovery-unverified'};
   for(const c of q.candidates){const m=routes.get(id)||new Map();m.set(key(c.input),c.input);routes.set(id,m);}
  }}
 const domain=[];for(const t of [{input:null,receiver:car.id},...[...transferInputs.values()].sort((a,b)=>key(a.input).localeCompare(key(b.input)))])for(const route of [...(routes.get(t.receiver)||new Map()).values()].sort((a,b)=>key(a).localeCompare(key(b))))domain.push({transfer:t.input,receiver:t.receiver,route});
 if(!domain.length||domain.length>160)return {...result,reason:'shared-receiver-domain-unavailable'};
 result.domain={policies:domain.map(d=>({transfer:d.transfer,receiver:d.receiver,route:d.route})),scope:'same finite stationary adjacent transfer/direct-carrier and generated goal-route union, fixed builtin in-action decisions; other opposing preparations/policies remain unknown'};
 const work=records.map(r=>({record:r,rows:[],lower:0,upper:1,inconsistent:false}));
 const store=(w,d,row)=>{
  const previous=w.rows.find(r=>r.policy===d);
  if(previous?.reason==='inconsistent-refinement')return;
  if(previous){row={...row,lower:Math.max(previous.lower,row.lower),upper:Math.min(previous.upper,row.upper),refinements:(previous.refinements||0)+1};
   if(row.lower>row.upper+EPS){w.inconsistent=true;row={policy:d,lower:0,upper:1,reason:'inconsistent-refinement'};}
   w.rows[w.rows.indexOf(previous)]=row;
  }else w.rows.push(row);
  w.lower=Math.max(0,...w.rows.map(r=>r.lower));
  w.upper=w.rows.length===domain.length?Math.max(0,...w.rows.map(r=>r.upper)):1;
 };
 const assess=async(w,d,targetUpper=-1,maxLeaves=128)=>{const r=w.record;let lower=0,failure=0,children=[];
  if(d.transfer){const t=r.transfers.find(t=>same(t.input,d.transfer));
   if(!t||t.unknown){store(w,d,{policy:d,lower:0,upper:1,reason:'transfer-state-unverified'});return;}
   if(t.illegal){store(w,d,{policy:d,lower:0,upper:0,reason:'transfer-currently-illegal'});return;}
   for(const b of t.ex.outcomes){if(b.touchdown===opp)lower+=b.p;else if(b.turnover||b.touchdown||b.active===o.team)failure+=b.p;
    else if(b.active===opp&&b.key&&b.observation?.ball?.kind==='held'&&b.observation.ball.playerId===d.receiver&&active(b.observation.players.find(p=>p.id===d.receiver))&&!b.observation.players.find(p=>p.id===d.receiver).activated)children.push(b);}
  }else children=[{...r.at,p:1}];
  const cap=Math.max(0,1-failure);
  // A known first-action failure excludes TD in this fixed policy. No final
  // probability is invented for an unqueried route: its explicit upper is cap.
  if(cap<=Math.max(w.lower-EPS,targetUpper)){store(w,d,{policy:d,lower,upper:cap,knownFirstFailure:failure,reason:'first-action-failure-cap-sufficient',finals:[]});return;}
  let upper=1-failure-children.reduce((n,b)=>n+b.p,0);const finals=[];
  for(const b of children){if(left()<120){upper+=b.p;finals.push({mass:b.p,from:b.key,unknown:true});continue;}
   const v=await call(services.validate,[d.route,{from:b.key,team:opp}]);
   if(v?.ok===true&&v.position===b.key&&v.legal===false&&Array.isArray(v.errors)&&v.errors.length){finals.push({mass:b.p,from:b.key,illegal:true});continue;}
   if(v?.ok!==true||v.position!==b.key||v.legal!==true){upper+=b.p;finals.push({mass:b.p,from:b.key,unknown:true});continue;}
   const e=await call(services.explore,[d.route,{from:b.key,team:opp,perspective:o.team,observations:false,decisions:'builtin',maxOutcomes:0,maxKeep:0,maxLeaves,threshold:.000001,maxMs:Math.max(50,Math.min(900,left()-70))}]);
   const bound=activeTeamTDBounds(e,{from:b.key,team:opp,perspective:o.team});lower+=b.p*bound.lower;upper+=b.p*bound.upper;finals.push({mass:b.p,from:b.key,maxLeaves,...bound});
  }
  store(w,d,{policy:d,lower,upper:Math.max(lower,Math.min(1,upper)),knownFirstFailure:failure,finals});
 };
 const publish=()=>{result.policies=work.map(w=>({input:w.record.input,lower:w.lower,upper:w.upper,gate:w.gate,rows:domain.map(d=>w.rows.find(r=>r.policy===d)||{policy:d,lower:0,upper:1,reason:'policy-not-evaluated-after-witness'})}));};
 // Only an incumbent LOWER witness is needed for interval dominance. Every
 // other incumbent policy remains upper1; a harder opponent policy can only
 // strengthen that baseline threat. The common domain itself is unchanged.
 const current=work[0];for(const d of domain){await assess(current,d);if(current.lower>EPS||left()<300)break;}
 result.current={lower:current.lower,upper:current.upper};
 if(current.lower<=EPS){publish();return {...result,reason:'no-certified-incumbent-threat-witness'};}
 const oldPolicy=policyFrom(selected,selected.preparedBranches,o.team,inspect),oldValue=weightedPolicyValue(oldPolicy,o,inspect);
 for(const w of work.slice(1)){
  const r=w.record,prepared=new Map();
  if(r.input.kind!=='endTurn')prepared.set(r.ex.outcomes[0].key,{plan:{input:{kind:'endTurn'},label:'preserve the current receiver screen through own-phase closure'},ex:r.close});
  const line={...inspect.canonical({input:r.input},o),ex:r.ex,preparedBranches:prepared,goal:{id:`receiver-defense:${o.team}:${o.half}:${o.drive}:${o.turn[o.team]}`,kind:'deny-last-receiver-scoring-route',target:car.id}},policy=policyFrom(line,prepared,o.team,inspect),baseValue=weightedPolicyValue(policy,o,inspect);
  if(!policy.structuralComplete||!Number.isFinite(baseValue)||!Number.isFinite(oldValue))continue;
  const targetUpper=Math.min(current.lower-EPS,current.lower+(baseValue-oldValue-4)/inspect.CFG.opponentScore-EPS);
  if(targetUpper<0)continue;
  // Coarse summaries already give honest q±u intervals. Refine only policies
  // whose upper can still block admission; never lower uncertainty by fiat.
  for(const d of domain)await assess(w,d,targetUpper,128);
  for(const precision of [512,2000,8000]){
   if(w.inconsistent||w.upper<=targetUpper||left()<300)break;
   for(const row of w.rows.filter(r=>r.upper>targetUpper)){
    if(w.inconsistent||left()<300)break;await assess(w,row.policy,targetUpper,precision);
   }
  }
  if(w.inconsistent){publish();return {...result,reason:'inconsistent-terminal-summary-refinement'};}
  const gain=current.lower-w.upper,net=baseValue-oldValue+gain*inspect.CFG.opponentScore;
  w.gate={threatUpperBelowIncumbentLower:gain>EPS,threatLowerGain:gain,baseValue,oldValue,netExistingValueMargin:net};
  if(gain<=EPS||net<=4)continue;
  publish();return {...result,selected:{...line,baseValue,preparationGain:0,unknown:policy.unknown,label:'hold goal-side depth against the last transfer-and-run scoring route'},reason:'bounded-final-receiver-threat-interval-improvement',evidence:{current:result.current,alternative:{lower:w.lower,upper:w.upper},gate:w.gate,domain:result.domain.scope,ownScope:'real deterministic own input then EndTurn; all immediate dependencies retained',selection:'first interval-certified improvement; not best among unexamined own alternatives',elapsedMs:Date.now()-started}};
 }
 publish();return {...result,reason:'receiver-threat-intervals-not-separated'};
}

/** Common finite contact/transfer/receiver policies from actual closed own
 * endpoints. Discovery proposes inputs; only source-bound engine replies price
 * them. No next-own opportunity or complete opposing Turn is certified here. */
export async function compareReceiverThreats(o,endpoints,services,deadline,{valueEndState=null}={}){
 const opp=other(o.team),until=Math.min(deadline,Date.now()+8000);let phaseEnd=Math.min(until,Date.now()+2500);const left=()=>phaseEnd-Date.now();
 const result={attempted:true,selected:null,domain:[],policies:[],calls:0,reason:'common-receiver-domain-unavailable',
  transferWork:{passLeafCap:64,remainingBudgetSkips:0,failedExplorations:0},
  scope:'one shared contact plus no contact; at most two ready scoring receivers with engine-offered moving Handoff/remote Pass and adjacent public proposals; two scoring routes per receiver; adaptive after actual outcomes, fixed builtin; unsearched opposing policies and next-own opportunities remain unknown'};
 const call=async(f,args)=>{if(typeof f!=='function'||left()<80)return null;result.calls++;try{return await f(...args);}catch{return null;}};
 const validState=b=>b&&typeof b.key==='string'&&b.key&&b.observation&&b.active===opp&&b.observation.active===opp;
 if(!Array.isArray(endpoints)||!endpoints.length||endpoints.some(p=>!Array.isArray(p.states)||Math.abs(p.states.reduce((v,b)=>v+(prob(b.p)?b.p:0),0)-1)>EPS||p.complete===false||p.states.some(b=>!prob(b.p)||!validState(b))))return {...result,reason:'own-phase-boundary-incomplete'};
 endpoints=endpoints.map(p=>({...p,states:p.states.map(b=>({...b,ownTurnover:!!b.ownTurnover||!!b.turnover,turnover:false}))}));
 let discoveryIncomplete=false;
 const parents=endpoints.flatMap(p=>p.states),contacts=new Map(),routeMap=new Map(),routeEmpty=new Set(),transfers=new Map(),prepared=new Map(),advanced=new Map(),finished=new Map();
 const query=async(at,q)=>{const r=await call(services.candidates,[{from:at.key,team:opp,precision:'none',sort:'steps',limit:16,maxMs:Math.max(50,Math.min(250,left()-40)),...q}]);if(r?.ok!==true||r.position?.key!==at.key||!Array.isArray(r.candidates)){discoveryIncomplete=true;return null;}return r;};
 const terminal=b=>b?.touchdown?{lower:b.touchdown===opp?1:0,upper:b.touchdown===opp?1:0}:b?.turnover||b?.active===o.team?{lower:0,upper:0}:null;
 const step=async(at,input)=>{
  if(!input)return {known:[{...at,p:1}],unknown:0};
  const k=key([at.key,opp,input]);if(advanced.has(k))return advanced.get(k);
  let value={known:[],unknown:1};
  if(validState(at)){
   const v=await call(services.validate,[input,{from:at.key,team:opp}]);
   if(v?.ok===true&&v.position===at.key&&v.legal===false)value={known:[{p:1,turnover:true,active:o.team}],unknown:0,illegal:true};
   else if(v?.ok===true&&v.position===at.key&&v.legal===true){
    // A complex Pass should return a bounded partial distribution, rather
    // than repeatedly use the whole local call budget and time out. Its
    // remaining mass stays unknown. Do not start a transfer with less than
    // the original 450ms allowance. Any guard extension stays within
    // the actual phase deadline; retained residual mass stays unknown.
    if(left()<490){result.transferWork.remainingBudgetSkips++;advanced.set(k,value);return value;}
    const e=await call(services.explore,[input,{coachEnumerationDeadline:phaseEnd,from:at.key,team:opp,perspective:o.team,observations:true,decisions:'builtin',maxOutcomes:8,maxKeep:32,maxLeaves:input.action==='pass'?64:512,threshold:.000001,maxMs:450}]);
    if(e?.ok!==true)result.transferWork.failedExplorations++;
    if(exploration(e,at.key,o.team,opp))value={known:e.outcomes,unknown:e.rest.p};
   }
  }
  advanced.set(k,value);return value;
 };
 const valueAudit=valueEndState?{horizon:'actual-opponent-End-or-first-TD/v1',stopRecords:[],terminalActionRecords:[],terminalActionsObserved:0,omittedDiagnosticRecords:0,outsideDomainUnverified:true,executionCertified:false}:null;
 const price=(at,input,e)=>{
  if(!exploration(e,at.key,o.team,opp))return {valid:false,from:at.key,reason:'endpoint-value-exploration-source-unverified'};
  const rows=e.outcomes.map(b=>({p:b.p,point:valueEndState(b)}));
  return {from:at.key,input,...summarizeEndpointValues(rows,{unresolvedMass:e.unresolvedMass}),reportedUnresolved:e.unresolvedMass,unlistedMass:e.rest.p,
   examples:rows.filter(r=>r.point.valid).slice(0,2)};
 };
 if(valueAudit){
  // A genuine End choice supplies one complete-value witness; it is not a
  // claim that the opponent will End, nor that the other replies are safe.
  for(const at of parents){
   const input={kind:'endTurn'};
   if(left()<490){valueAudit.stopRecords.push({from:at.key,valid:false,reason:'endpoint-value-stop-budget-unavailable'});continue;}
   const v=await call(services.validate,[input,{from:at.key,team:opp}]);
   if(v?.ok!==true||v.position!==at.key||v.legal!==true){valueAudit.stopRecords.push({from:at.key,valid:false,reason:'endpoint-value-stop-legality-unverified'});continue;}
   const e=await call(services.explore,[input,{coachEnumerationDeadline:phaseEnd,from:at.key,team:opp,perspective:o.team,observations:true,noKeys:true,decisions:'builtin',maxOutcomes:8,maxKeep:8,maxLeaves:64,threshold:.000001,maxMs:450}]);
   valueAudit.stopRecords.push(price(at,input,e));
  }
  result.endpointValueAudit=valueAudit;
 }
 const prepare=async(at,contact)=>{
  const k=key([at.key,contact]);if(prepared.has(k))return prepared.get(k);
  const first=await step(at,contact),out={known:[],unknown:first.unknown};
  for(const b of first.known){
   if(terminal(b)){out.known.push(b);continue;}
   if(!validState(b)){out.unknown+=b.p;continue;}
   const h=holder(b.observation),a=b.observation.activation;
   if(!h||h.team!==opp){out.unknown+=b.p;continue;}
   if(a&&!a.over&&a.playerId!==h.id){
    const close=await step(b,{kind:'endActivation'});out.unknown+=b.p*close.unknown;
    for(const c of close.known)out.known.push({...c,p:b.p*c.p});
   }else out.known.push(b);
  }
  prepared.set(k,out);return out;
 };
 // Public proposals exist before service discovery; an exhausted or missing
 // candidate query cannot turn every unqueried receiver into zero threat.
 for(const at of parents){const h=holder(at.observation);if(h?.team!==opp){discoveryIncomplete=true;continue;}
  transfers.set(key([null,h.id]),{input:null,receiver:h.id});
  for(const p of receivers(at.observation,opp))for(const input of [{kind:'playerAction',playerId:h.id,action:'handoff',path:[],handoffTarget:p.id},{kind:'playerAction',playerId:h.id,action:'pass',path:[],passTarget:p.pos}])transfers.set(key([input,p.id]),{input,receiver:p.id});
 }
 for(const at of endpoints.flatMap(p=>p.states.slice().sort((a,b)=>b.p-a.p).slice(0,1))){
  const h=holder(at.observation),q=await query(at,{families:['blitz'],maxRushes:0});
  for(const c of q?.candidates||[]){const i=c.input;if(i?.kind==='playerAction'&&i.action==='blitz'&&i.playerId!==h?.id&&typeof(i.blitzTarget||i.blockTarget)==='string'&&Array.isArray(i.path))contacts.set(key(i),i);}
 }
 const contactInputs=[null,...[...contacts.values()].sort((a,b)=>a.path.length-b.path.length||key(a).localeCompare(key(b))).slice(0,1)];
 const discover=async(at,receiver)=>{
  const q=await query(at,{players:[receiver],families:['move'],region:{x0:o.pitch.endZone[opp],x1:o.pitch.endZone[opp]}});
  if(q&&q.candidates.length===0&&q.hasMore===false&&q.complete!==false&&(!q.truncated||Array.isArray(q.truncated)&&!q.truncated.length))routeEmpty.add(key([at.key,receiver]));
  for(const c of q?.candidates||[]){if(c.kind!=='score'||!c.input?.path?.every(s=>['step','rush'].includes(s.kind))||!ordinary({...c.input,path:c.input.path.map(s=>({...s,kind:'step'}))})||c.input.playerId!==receiver)continue;const m=routeMap.get(receiver)||new Map();m.set(key(c.input),c.input);routeMap.set(receiver,m);}
 };
 // Adjacent empty-path transfers omit move-then-Handoff and remote Pass.
 // Discover real declared routes to ready scoring receivers instead of
 // inventing movement. Each source independently validates the common input.
 const transferRoutes=new Map();result.transferDiscovery={queries:0,offeredProposals:0,retained:0};
 const discoverTransfers=async(at)=>{
  const ob=at.observation,h=holder(ob),gx=ob.pitch?.endZone?.[opp];if(h?.team!==opp||!Number.isInteger(gx))return [];
  const potential=ob.players.filter(p=>p.team===opp&&p.id!==h.id&&active(p)&&!p.activated&&p.canBeActivated!==false&&!has(p,'noBall')&&!p.rooted&&
   Math.abs(gx-p.pos.x)<=p.ma+(has(p,'sprint')?3:2)).sort((a,b)=>Math.abs(gx-a.pos.x)-Math.abs(gx-b.pos.x)||b.ma-a.ma||a.id.localeCompare(b.id)).slice(0,2);
  const local=[];
  for(const family of ['handoff','pass']){
   if(!potential.length)break;result.transferDiscovery.queries++;
   const q=await query(at,{players:[h.id],targets:potential.map(p=>p.id),families:[family],maxRushes:0});
   const groups=new Map();
   for(const c of q?.candidates||[]){const i=c.input;
    if(i?.kind!=='playerAction'||i.playerId!==h.id||i.action!==family||!Array.isArray(i.path))continue;
    const receiver=family==='handoff'?potential.find(p=>p.id===i.handoffTarget):potential.find(p=>same(p.pos,i.passTarget));
    if(!receiver)continue;result.transferDiscovery.offeredProposals++;
    const old=groups.get(receiver.id);if(!old||i.path.length<old.input.path.length||i.path.length===old.input.path.length&&key(i)<key(old.input))groups.set(receiver.id,{input:i,receiver:receiver.id});
   }
   for(const t of groups.values()){
    local.push(t);const signature=key([family,t.receiver]),old=transferRoutes.get(signature);
    if(!old||t.input.path.length<old.input.path.length||t.input.path.length===old.input.path.length&&key(t.input)<key(old.input))transferRoutes.set(signature,t);
   }
  }
  return local;
 };
 for(const at of endpoints.flatMap(p=>p.states.slice().sort((a,b)=>b.p-a.p).slice(0,1))){for(const contact of contactInputs){
  if(left()<80){discoveryIncomplete=true;break;}
  const pre=await prepare(at,contact);
  for(const b of pre.known.filter(b=>!terminal(b)&&validState(b)).sort((a,b)=>b.p-a.p).slice(0,2)){
   const h=holder(b.observation);if(h?.team!==opp)continue;
   transfers.set(key([null,h.id]),{input:null,receiver:h.id});await discover(b,h.id);
   const offered=await discoverTransfers(b),publicAdjacent=receivers(b.observation,opp).flatMap(p=>
    [{input:{kind:'playerAction',playerId:h.id,action:'handoff',path:[],handoffTarget:p.id},receiver:p.id},
     {input:{kind:'playerAction',playerId:h.id,action:'pass',path:[],passTarget:p.pos},receiver:p.id}]);
   for(const {input,receiver} of [...offered,...publicAdjacent]){
    if(publicAdjacent.some(t=>same(t.input,input)))transfers.set(key([input,receiver]),{input,receiver});
    const ex=await step(b,input);
    const successful=ex.known.filter(c=>!terminal(c)&&validState(c)&&holder(c.observation)?.id===receiver).sort((a,b)=>b.p-a.p).slice(0,1);
    for(const c of successful)await discover(c,receiver);
   }
  }
 }}
 for(const t of transferRoutes.values())transfers.set(key([t.input,t.receiver]),t);
 result.transferDiscovery.retained=transferRoutes.size;
 for(const contact of contactInputs)result.domain.push({contact,transfer:null,receiver:null,route:null});
 for(const contact of contactInputs)for(const t of transfers.values()){
  const routes=[...(routeMap.get(t.receiver)||new Map()).values()].sort((a,b)=>a.path.length-b.path.length||key(a).localeCompare(key(b))).slice(0,2);
  for(const route of routes.length?routes:[null])result.domain.push({contact,transfer:t.input,receiver:t.receiver,route});
 }
 if(!result.domain.length||result.domain.length>64)return result;
 phaseEnd=until;
 const finish=async(at,input)=>{
  const signature=key([at.key,opp,input]);if(finished.has(signature))return finished.get(signature);
  const v=await call(services.validate,[input,{from:at.key,team:opp}]);
  if(v?.ok===true&&v.position===at.key&&v.legal===false)return {lower:0,upper:0,illegal:true};
  if(v?.ok!==true||v.position!==at.key||v.legal!==true)return {lower:0,upper:1};
  const e=await call(services.explore,[input,{coachEnumerationDeadline:phaseEnd,from:at.key,team:opp,perspective:o.team,observations:!!valueAudit,...(valueAudit?{noKeys:true}:{}),decisions:'builtin',maxOutcomes:valueAudit?8:0,maxKeep:valueAudit?8:0,maxLeaves:512,threshold:.000001,maxMs:Math.max(50,Math.min(700,left()-40))}]);
  if(valueAudit){
   valueAudit.terminalActionsObserved++;
   if(valueAudit.terminalActionRecords.length<20)valueAudit.terminalActionRecords.push(price(at,input,e));
   else valueAudit.omittedDiagnosticRecords++;
  }
  const bound=activeTeamTDBounds(e,{from:at.key,team:opp,perspective:o.team});finished.set(signature,bound);
  if(!bound.valid){result.invalidSummaries??=[];if(result.invalidSummaries.length<4)result.invalidSummaries.push({from:at.key,ok:e?.ok,perspective:e?.perspective,activeTeam:e?.activeTeam,identity:e?.outcomeIdentity,enumerated:e?.enumerated,unresolved:e?.unresolvedMass,rest:e?.rest?.p,applied:e?.applied,leaves:e?.leaves,exact:e?.exact,opponentTD:e?.pOpponentTouchdown});}
  return bound;
 };
 // The opponent observes each contact/transfer result before choosing its
 // next input. Max at that child, then multiply its chance mass; a fixed
 // precommitted receiver across contact branches would understate the upper.
 const assess=async(at,contact)=>{
  const pre=await prepare(at,contact);let lower=0,upper=pre.unknown;
  const rows=result.domain.filter(d=>same(d.contact,contact)),choices=[...new Map(rows.map(d=>[key([d.transfer,d.receiver]),{input:d.transfer,receiver:d.receiver}])).values()];
  for(const b of pre.known){const done=terminal(b);if(done){lower+=b.p*done.lower;upper+=b.p*done.upper;continue;}
   if(!validState(b)){upper+=b.p;continue;}
   let bestLower=0,bestUpper=0;
   for(const t of choices){if(t.receiver===null)continue;
    const ex=await step(b,t.input);let lo=0,hi=ex.unknown;
    for(const c of ex.known){const end=terminal(c);if(end){lo+=c.p*end.lower;hi+=c.p*end.upper;continue;}
     if(!validState(c)){hi+=c.p;continue;}
     let routeLower=0,routeUpper=0;
     for(const d of rows.filter(d=>d.receiver===t.receiver&&same(d.transfer,t.input))){
      const bound=d.route?await finish(c,d.route):{lower:0,upper:routeEmpty.has(key([c.key,d.receiver]))?0:1};
      routeLower=Math.max(routeLower,bound.lower);routeUpper=Math.max(routeUpper,bound.upper);
     }
     lo+=c.p*routeLower;hi+=c.p*routeUpper;
    }
    bestLower=Math.max(bestLower,lo);bestUpper=Math.max(bestUpper,hi);
   }
   lower+=b.p*bestLower;upper+=b.p*bestUpper;
  }
  return {lower,upper:Math.min(1,Math.max(lower,upper))};
 };
 const work=endpoints.map(p=>({p,rows:[],best:new Map(p.states.map(b=>[b,{lower:0,upper:0}]))}));
 // Interleave competitors so discovery/assessment does not spend the whole
 // shared budget certifying only the first own input.
 for(const contact of contactInputs)for(const w of work){let lower=0,upper=0;const branches=[];
  for(const at of w.p.states){const b=await assess(at,contact),v=w.best.get(at);v.lower=Math.max(v.lower,b.lower);v.upper=Math.max(v.upper,b.upper);lower+=at.p*b.lower;upper+=at.p*b.upper;branches.push({from:at.key,mass:at.p,ownTurnover:at.ownTurnover,...b});}
  w.rows.push({contact,lower,upper,branches});
 }
 for(const w of work){const p=w.p,lower=p.states.reduce((v,b)=>v+b.p*w.best.get(b).lower,0),upper=discoveryIncomplete?1:p.states.reduce((v,b)=>v+b.p*w.best.get(b).upper,0);
  result.policies.push({input:p.input??p.candidate?.input,lower,upper,rows:w.rows,branches:p.states.map(b=>({from:b.key,mass:b.p,ownTurnover:b.ownTurnover,...w.best.get(b)}))});
 }

 return {...result,discoveryIncomplete,reason:discoveryIncomplete?'common-receiver-discovery-incomplete':'common-finite-receiver-policy-bounds',nextOwnOpportunity:'unverified; these bounds alone cannot endorse ending a penultimate own Turn'};
}
