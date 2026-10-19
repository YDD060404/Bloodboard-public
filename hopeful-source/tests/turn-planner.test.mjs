import test from 'node:test';
import assert from 'node:assert/strict';
import {planTurn,PLANNER,actorValues,leafValue,replyNeutral} from '../src/turn-planner.mjs';

// Mock engine: position key = sorted list of done action ids. Values come from obs.v (inspect.boardValue stub);
// no opponents near the ball, so the exposure term is 0. Real-engine behaviour is measured by tools/harness/turn.mjs.
const ACTIONS={
 P:{input:{kind:'playerAction',playerId:'picker',action:'secure',path:[]},p:0.7,gain:100},   // risky pickup
 G:{input:{kind:'playerAction',playerId:'guard',action:'move',path:[{kind:'step',to:{x:1,y:1}}]},p:1,gain:20}, // dice-free setup
};
const obsFor=(done,active='A',extra=0)=>({team:'A',active,phase:'play',pending:null,ball:{kind:'ground',pos:{x:20,y:7}},
 players:[{id:'picker',team:'A',location:'pitch',stance:'standing',pos:{x:19,y:7},activated:done.includes('P')},
  {id:'guard',team:'A',location:'pitch',stance:'standing',pos:{x:2,y:2},activated:done.includes('G')}],
 v:done.reduce((s,a)=>s+ACTIONS[a].gain,0)+extra});
const keyOf=done=>[...done].sort().join('+')||'root';
function engine(){
 const calls=[];
 return {calls,
  candidates:async q=>{const done=q.from==='root'?[]:q.from.split('+');calls.push(['candidates',q.from]);
   return {ok:true,candidates:Object.entries(ACTIONS).filter(([id])=>!done.includes(id)).map(([id,a])=>({input:a.input,label:id,legal:true}))};},
  explore:async(input,opts)=>{const from=opts.from??'root',done=from==='root'?[]:from.split('+');
   const id=Object.keys(ACTIONS).find(k=>JSON.stringify(ACTIONS[k].input)===JSON.stringify(input));calls.push(['explore',id,from]);
   if(input.kind==='endTurn')return {ok:true,outcomes:[{key:from+'#end',p:1,active:'B',observation:obsFor(done,'B')}]};
   const a=ACTIONS[id],next=[...done,id];
   const outs=[{key:keyOf(next),p:a.p,active:'A',observation:{...obsFor(next),ball:id==='P'?{kind:'held',playerId:'picker'}:obsFor(next).ball}}];
   if(a.p<1)outs.push({key:keyOf(done)+'#to',p:1-a.p,turnover:true,active:'B',observation:obsFor(done,'B')});
   return {ok:true,pTurnover:1-a.p,outcomes:outs};}};
}
const inspect={boardValue:o=>o.v};

test('a dice-free setup is ordered before the risky pickup because a failed pickup forfeits it',async()=>{
 const o={...obsFor([]),team:'A'},e=engine();
 const r=await planTurn(o,e,inspect,Date.now()+10000,{championInput:ACTIONS.P.input});
 assert.equal(r.report.reason,'whole-turn-plan-improvement',JSON.stringify(r.report));
 assert.deepEqual(r.best.input,ACTIONS.G.input);
 assert.deepEqual(r.report.best.labels.slice(0,2),['G','champion (30%)']);   // the same input, now carried as the forced champion candidate
 assert.equal(r.report.best.value,90);                       // 0.7*120 + 0.3*20
 assert.equal(r.report.championPlan.value,84);               // 0.7*120 + 0.3*0
 assert.ok(e.calls.some(c=>c[0]==='explore'&&c[2]==='G'),'later actions are applied from the real successor key');
});

test('no override when the champion first action already starts the best plan, or the gain is below the margin',async()=>{
 const o={...obsFor([]),team:'A'};
 const r=await planTurn(o,engine(),inspect,Date.now()+10000,{championInput:ACTIONS.G.input});
 assert.equal(r.best,null);assert.equal(r.report.reason,'champion-first-action-is-best-plan-start');
 const save=ACTIONS.G.gain;ACTIONS.G.gain=PLANNER.margin;   // 0.3*3 < margin: the plan search keeps the champion first
 try{const s=await planTurn(o,engine(),inspect,Date.now()+10000,{championInput:ACTIONS.P.input});
  // S4.34: the risky-before-dice-free order check still plays the dice-free G first — with full branching G-first is
  // worth 3 + 0.7×100 = 73 v 0.7×103 = 72.1 (a failed pickup no longer forfeits G) and is not riskier.
  assert.equal(s.report.reason,'dice-free-before-risky');assert.deepEqual(s.best.input,ACTIONS.G.input);
  assert.equal(s.report.riskFirstCheck.diceFreeFirst,true);}
 finally{ACTIONS.G.gain=save;}
});

test('not our open turn: the planner does nothing',async()=>{
 const r=await planTurn({...obsFor([]),active:'B'},engine(),inspect,Date.now()+10000,{championInput:ACTIONS.P.input});
 assert.equal(r.best,null);assert.equal(r.report.reason,'not-own-open-turn');
});

test('ball safety: a riskier plan needs a large modelled gain to replace the champion plan',async()=>{
 // Champion: certain action C (−6). Alternative R first: 40 % turnover risk, +28 on success (R after C is worthless).
 // Expected 16.8 vs −6: above the margin but below PLANNER.riskGain while adding 40 points of turnover risk -> keep C.
 const A2={C:{input:{kind:'playerAction',playerId:'c',action:'move',path:[{kind:'step',to:{x:3,y:3}}]},p:1,gain:-6},
  R:{input:{kind:'playerAction',playerId:'r',action:'blitz',path:[]},p:0.6,gain:28}};
 const obs=done=>({team:'A',active:'A',phase:'play',pending:null,ball:{kind:'held',playerId:'x'},
  players:[{id:'x',team:'A',location:'pitch',stance:'standing',pos:{x:0,y:0},activated:true},
   ...['c','r'].map(id=>({id,team:'A',location:'pitch',stance:'standing',pos:{x:9,y:id==='c'?3:9},activated:done.includes(id.toUpperCase())}))],v:done.reduce((s,a)=>s+A2[a].gain,0)-(done.includes('C')&&done.includes('R')?100:0)});
 const e={candidates:async q=>{const d=q.from==='root'?[]:q.from.split('+');return {ok:true,candidates:Object.entries(A2).filter(([k])=>!d.includes(k)).map(([k,a])=>({input:a.input,label:k}))};},
  explore:async(input,opts)=>{const from=opts.from??'root',d=from==='root'?[]:from.split('+');if(input.kind==='endTurn')return {ok:true,outcomes:[{key:from+'#e',p:1,active:'B',observation:{...obs(d),active:'B'}}]};
   const k=Object.keys(A2).find(x=>JSON.stringify(A2[x].input)===JSON.stringify(input)),nx=[...d,k].sort();
   const outs=[{key:nx.join('+'),p:A2[k].p,active:'A',observation:obs(nx)}];if(A2[k].p<1)outs.push({key:from+'#t',p:1-A2[k].p,turnover:true,active:'B',observation:{...obs(d),active:'B'}});
   return {ok:true,pTurnover:1-A2[k].p,outcomes:outs};}};
 const r=await planTurn(obs([]),e,{boardValue:o=>o.v},Date.now()+10000,{championInput:A2.C.input});
 assert.equal(r.best,null);                                   // champion kept: the risky line never competes
 assert.ok(r.report.riskFiltered>=1);
 assert.ok(r.report.bestRaw.pTurnover>r.report.championPlan.pTurnover+PLANNER.riskSlack);
});

test('fail safe: if the champion first action cannot be evaluated, the planner never overrides',async()=>{
 const o={...obsFor([]),team:'A'};
 const ghost={kind:'playerAction',playerId:'ghost',action:'move',path:[{kind:'step',to:{x:5,y:5}}]};   // engine has no answer for it
 const r=await planTurn(o,engine(),inspect,Date.now()+10000,{championInput:ghost});
 assert.equal(r.best,null);
 assert.equal(r.report.reason,'champion-plan-unmeasured');
});

test('S4.28 opportunity model: actor values come from the champion root lines (best line minus End Turn, capped, >= 0)',()=>{
 const m=actorValues([{input:{kind:'endTurn'},value:100},{actorId:'a',input:{kind:'playerAction',playerId:'a'},value:104},
  {actorId:'a',input:{kind:'playerAction',playerId:'a'},value:101},{actorId:'b',input:{kind:'playerAction',playerId:'b'},value:90},
  {actorId:'c',input:{kind:'playerAction',playerId:'c'},value:180}]);
 assert.equal(m.get('a'),4);assert.equal(m.get('b'),0);assert.equal(m.get('c'),PLANNER.maxActorValue);
});

test('S4.28 opportunity model: a modest setup is banked before a risky pickup instead of being charged a flat cost',async()=>{
 const save=ACTIONS.G.gain;ACTIONS.G.gain=15;
 try{
  const o={...obsFor([]),team:'A'};
  const r=await planTurn(o,engine(),inspect,Date.now()+10000,{championInput:ACTIONS.P.input,
   championLines:[{input:{kind:'endTurn'},value:0},{actorId:'guard',input:ACTIONS.G.input,value:15},{actorId:'picker',input:ACTIONS.P.input,value:70}]});
  assert.equal(r.report.reason,'whole-turn-plan-improvement',JSON.stringify(r.report.top));
  assert.deepEqual(r.best.input,ACTIONS.G.input);
  assert.equal(r.report.actorValues.guard,15);
 }finally{ACTIONS.G.gain=save;}
});

test('S4.28 failure-1 fix: loose ball + unmeasurable champion contact -> a dice-free first action is played',async()=>{
 const o={...obsFor([]),team:'A'};
 const blitz={kind:'playerAction',playerId:'ghost',action:'blitz',blitzTarget:'x',path:[]};   // engine cannot evaluate it
 const r=await planTurn(o,engine(),inspect,Date.now()+10000,{championInput:blitz});
 assert.equal(r.report.reason,'dice-free-before-unmeasured-contact');
 assert.deepEqual(r.best.input,ACTIONS.G.input);
});

test('S4.28: a partially enumerated champion tree is used (missing mass pessimistic) instead of being a blind spot',async()=>{
 const o={...obsFor([]),team:'A'},e=engine();
 const inner=e.explore;
 e.explore=async(input,opts)=>{const r=await inner(input,opts);
  if(JSON.stringify(input)===JSON.stringify(ACTIONS.P.input)&&(opts.from??'root')==='root')return {...r,outcomes:r.outcomes.slice(0,1)};   // only the 70 % success branch
  return r;};
 const r=await planTurn(o,e,inspect,Date.now()+10000,{championInput:ACTIONS.P.input});
 assert.equal(r.report.championPartialMass,0.7);
 assert.ok(r.report.championPlan,'champion plan measured');
 assert.ok(r.report.championPlan.pTurnover>=0.3-1e-9,'missing mass counted as risk');
});

test('S4.28 useful damage: removing or stunning an opponent is credited relative to the plan root',()=>{
 const P=(id,team,extra={})=>({id,team,location:'pitch',stance:'standing',pos:{x:1,y:1},activated:true,...extra});
 const root={team:'A',ball:{kind:'held',playerId:'a'},players:[P('a','A'),P('x','B'),P('y','B')]};
 const after={...root,players:[P('a','A'),P('x','B',{location:'ko',pos:null}),P('y','B',{stance:'stunned'})]};
 const base={boardValue:()=>0};
 const v=leafValue(after,'A',base,0,false,{root,actorValues:new Map()})-leafValue(root,'A',base,0,false,{root,actorValues:new Map()});
 assert.equal(v,PLANNER.removal+PLANNER.stun);
});

test('S4.28: the champion action stays available deeper, so "safe first, then the champion risky action" is built',async()=>{
 // Engine offers only G at the root besides the forced champion; after G the champion pickup must still be explored.
 const o={...obsFor([]),team:'A'},e=engine(),inner=e.candidates;
 e.candidates=async q=>{const r=await inner(q);return {...r,candidates:r.candidates.filter(c=>c.label!=='P')};};
 const r=await planTurn(o,e,inspect,Date.now()+10000,{championInput:ACTIONS.P.input,
  championLines:[{input:{kind:'endTurn'},value:0},{actorId:'guard',input:ACTIONS.G.input,value:20}]});
 assert.ok(e.calls.some(c=>c[0]==='explore'&&c[1]==='P'&&c[2]==='G'),'champion pickup explored after the guard move');
 assert.deepEqual(r.report.best.labels.slice(0,2),['G','champion (30%)']);
});

test('S4.28: a safe reordering is selected even when a riskier variant has the highest raw value',async()=>{
 // Champion: risky pickup P (30 %). Variant Q: a riskier pickup (50 %) worth more on success. Guard G dice-free.
 const A3={P:{input:{kind:'playerAction',playerId:'picker',action:'secure',path:[]},p:0.7,gain:100},
  Q:{input:{kind:'playerAction',playerId:'picker',action:'move',path:[{kind:'step',to:{x:20,y:7}}]},p:0.5,gain:260},
  G:{input:{kind:'playerAction',playerId:'guard',action:'move',path:[{kind:'step',to:{x:1,y:1}}]},p:1,gain:15}};
 const save={...ACTIONS};Object.keys(ACTIONS).forEach(k=>delete ACTIONS[k]);Object.assign(ACTIONS,A3);
 try{
  const o={...obsFor([]),team:'A'};
  const r=await planTurn(o,engine(),inspect,Date.now()+10000,{championInput:A3.P.input,
   championLines:[{input:{kind:'endTurn'},value:0},{actorId:'guard',input:A3.G.input,value:15}]});
  assert.ok(r.report.bestRaw.labels.some(l=>l.startsWith('Q')),'the raw best uses the riskier pickup');
  assert.equal(r.report.reason,'whole-turn-plan-improvement',JSON.stringify(r.report.top));
  assert.deepEqual(r.best.input,A3.G.input);
  assert.ok(r.report.best.pTurnover<=r.report.championPlan.pTurnover+PLANNER.riskSlack);
 }finally{Object.keys(ACTIONS).forEach(k=>delete ACTIONS[k]);Object.assign(ACTIONS,save);}
});

// ---- Regression cases from real-engine diagnoses (session 3) ----
test('S4.29 regression (real bb 326 world 101): with nothing left to forfeit, a loose-ball pickup beats End Turn despite its risk',async()=>{
 // Champion: End Turn. Remaining players are worth 0 (champion lines). Pickup P: 67 % success (+100), failure = ball loose.
 const save=ACTIONS.G.gain;ACTIONS.G.gain=-1;          // as in the real position: the remaining moves are worth nothing
 try{
  const o={...obsFor([]),team:'A'},e=engine();
  const r=await planTurn(o,e,{...inspect,replyAssessment:async()=>({criticalAdjustment:0,positionAdjustment:0})},Date.now()+10000,{
   championInput:{kind:'endTurn'},championLines:[{input:{kind:'endTurn'},value:0},{actorId:'picker',input:ACTIONS.P.input,value:0},{actorId:'guard',input:ACTIONS.G.input,value:0}]});
  assert.equal(r.report.forfeitable,0);
  assert.equal(r.report.reason,'last-action-pickup',JSON.stringify(r.report.top));
  assert.deepEqual(r.best.input,ACTIONS.P.input);
 }finally{ACTIONS.G.gain=save;}
});

test('S4.29 regression: the exemption does not apply while other players still have real actions to lose',async()=>{
 const o={...obsFor([]),team:'A'};
 const r=await planTurn(o,engine(),{...inspect,replyAssessment:async()=>({criticalAdjustment:0,positionAdjustment:0})},Date.now()+10000,{
  championInput:{kind:'endTurn'},championLines:[{input:{kind:'endTurn'},value:0},{actorId:'guard',input:ACTIONS.G.input,value:12}]});
 assert.ok(r.report.forfeitable>PLANNER.lastActionForfeit);
 assert.notEqual(r.report.reason,'last-action-pickup');
});

test('S4.29 regression (real R1 step 41): the role cost does not remove a low-risk blitz that frees the ball carrier',async()=>{
 // The ball-carrying Catcher blitzes its marker at 1 % risk (champion line 424.5 vs next 395.3). Role cost (3) must not
 // flip a 29-point lead: no override when the champion action starts the best plan.
 const A4={B:{input:{kind:'playerAction',playerId:'carrier',action:'blitz',blitzTarget:'m',path:[]},p:0.99,gain:55},
  M:{input:{kind:'playerAction',playerId:'mate',action:'move',path:[{kind:'step',to:{x:4,y:4}}]},p:1,gain:26}};
 const save={...ACTIONS};Object.keys(ACTIONS).forEach(k=>delete ACTIONS[k]);Object.assign(ACTIONS,A4);
 try{
  const base=obsFor([]);
  const o={...base,team:'A',ball:{kind:'held',playerId:'carrier'},players:[{id:'carrier',team:'A',location:'pitch',stance:'standing',pos:{x:19,y:7},skills:['catch','dodge'],activated:false},
   {id:'mate',team:'A',location:'pitch',stance:'standing',pos:{x:2,y:2},activated:false}]};
  const r=await planTurn(o,engine(),inspect,Date.now()+10000,{championInput:A4.B.input});
  // The plan may put a dice-free move first (sound ordering), but the carrier blitz itself stays in the plan.
  const plan=r.report.best?.labels||[];
  assert.ok(plan.some(l=>l.startsWith('champion')),JSON.stringify(r.report.top));
 }finally{Object.keys(ACTIONS).forEach(k=>delete ACTIONS[k]);Object.assign(ACTIONS,save);}
});

test('S4.29: an End Turn plan is charged its own opponent reply (measured from the real End-of-Turn branch)',async()=>{
 const o={...obsFor([]),team:'A'};let asked=[];
 const reply={...inspect,replyAssessment:async at=>{asked.push(at.key);return {criticalAdjustment:0,positionAdjustment:-20};}};
 const r=await planTurn(o,engine(),reply,Date.now()+10000,{championInput:{kind:'endTurn'},championLines:[{input:{kind:'endTurn'},value:0}]});
 assert.ok(asked.includes('root#end'),'End Turn reply measured from its own branch: '+JSON.stringify(asked));
 assert.equal(r.report.championPlan.reply.position,-20);
});

// ---- S4.30 loose-ball order check (real case: bb 326 world 202, evaluation/probes/diagC-326-202.jsonl) ----
function orderEngine({pickupAfterBlitz=0.67}={}){
 // Actions: C = blitz (19 % turnover; 60 % knock-down branch, 21 % push branch, both continue), P = pickup (67 %).
 const C={kind:'playerAction',playerId:'blitzer',action:'blitz',blitzTarget:'foe',path:[]};
 const P={kind:'playerAction',playerId:'picker',action:'move',path:[{kind:'step',to:{x:20,y:7}}]};
 const st=(done,extra={})=>({team:'A',active:'A',phase:'play',pending:null,ball:done.includes('P')?{kind:'held',playerId:'picker'}:{kind:'ground',pos:{x:20,y:7}},
  players:[{id:'picker',team:'A',location:'pitch',stance:'standing',pos:{x:19,y:7},activated:done.includes('P')},
   {id:'blitzer',team:'A',location:'pitch',stance:'standing',pos:{x:2,y:2},activated:done.includes('C')}],
  v:(done.includes('P')?100:0)+(done.includes('C')?10:0),...extra});
 const parse=k=>k==='root'?[]:k.split('+').map(x=>x.replace(/[#].*$/,'')).filter(Boolean);
 const e={candidates:async q=>{const d=parse(q.from);const c=[];if(!d.includes('C'))c.push({input:C,label:'blitz'});if(!d.includes('P'))c.push({input:P,label:'pickup'});return {ok:true,candidates:c};},
  explore:async(input,opts)=>{const from=opts.from??'root',d=parse(from);
   if(input.kind==='endTurn')return {ok:true,outcomes:[{key:from+'#end',p:1,active:'B',observation:{...st(d),active:'B'}}]};
   if(input.action==='blitz'){const nx=[...d,'C'].join('+');
    return {ok:true,pTurnover:0.19,outcomes:[{key:nx+'#kd',p:0.6,active:'A',observation:st([...d,'C'])},{key:nx+'#push',p:0.21,active:'A',observation:st([...d,'C'],{v:(d.includes('P')?100:0)+2})},
     {key:from+'#ctO',p:0.19,turnover:true,active:'B',observation:{...st(d),active:'B'}}]};}
   const ps=d.includes('C')&&from.endsWith('#kd')?pickupAfterBlitz:0.67,nx=[...d,'P'].join('+');
   return {ok:true,pTurnover:1-ps,outcomes:[{key:nx,p:ps,active:'A',observation:st([...d,'P'])},{key:from+'#ptO',p:1-ps,turnover:true,active:'B',observation:{...st(d),active:'B'}}]};}};
 return {e,C,P};
}
test('S4.30 regression (bb 326 w202): blitz before a loose-ball pickup is replaced by pickup-first when that order is worth more',async()=>{
 const {e,C,P}=orderEngine();
 const r=await planTurn({...(await e.explore({kind:'endTurn'},{})).outcomes[0].observation,active:'A',team:'A'},e,{boardValue:o=>o.v},Date.now()+10000,{championInput:C});
 assert.equal(r.report.reason,'pickup-before-contact',JSON.stringify(r.report.orderCheck));
 assert.deepEqual(r.best.input,P);
 const oc=r.report.orderCheck;
 assert.ok(oc.pickupFirstOrder.value>=oc.contactFirst.value);
 // Full branching: contact-first cumulative risk ≈ 0.19 + 0.81 × 0.33 ≈ 0.457 (not the main-line-only 0.29).
 assert.ok(Math.abs(oc.contactFirst.risk-(0.19+0.81*0.33))<0.002,JSON.stringify(oc));
});
test('S4.30 regression: a blitz that makes the pickup much safer stays first (justified contact)',async()=>{
 const {e,C}=orderEngine({pickupAfterBlitz:0.97});
 const r=await planTurn({...(await e.explore({kind:'endTurn'},{})).outcomes[0].observation,active:'A',team:'A'},e,{boardValue:o=>o.v},Date.now()+10000,{championInput:C});
 assert.notEqual(r.report.reason,'pickup-before-contact',JSON.stringify(r.report.orderCheck));
 assert.equal(r.report.orderCheck.pickupFirst,false);
});
test('S4.30 regression (R1 step 41): with the ball held the order check never runs',async()=>{
 const A4={B:{input:{kind:'playerAction',playerId:'carrier',action:'blitz',blitzTarget:'m',path:[]},p:0.99,gain:55}};
 const save={...ACTIONS};Object.keys(ACTIONS).forEach(k=>delete ACTIONS[k]);Object.assign(ACTIONS,A4);
 try{
  const o={...obsFor([]),team:'A',ball:{kind:'held',playerId:'carrier'},players:[{id:'carrier',team:'A',location:'pitch',stance:'standing',pos:{x:19,y:7},skills:['catch'],activated:false}]};
  const r=await planTurn(o,engine(),inspect,Date.now()+10000,{championInput:A4.B.input});
  assert.equal(r.report.orderCheck,undefined);
  assert.notEqual(r.report.reason,'pickup-before-contact');
 }finally{Object.keys(ACTIONS).forEach(k=>delete ACTIONS[k]);Object.assign(ACTIONS,save);}
});

test('S4.30 regression (bb 326 w101 end): the picker own value is not counted as forfeited by its own pickup',async()=>{
 const save=ACTIONS.G.gain;ACTIONS.G.gain=-1;
 try{
  const o={...obsFor([]),team:'A'};
  const r=await planTurn(o,engine(),{...inspect,replyAssessment:async()=>({criticalAdjustment:0,positionAdjustment:0})},Date.now()+10000,{
   championInput:{kind:'endTurn'},championLines:[{input:{kind:'endTurn'},value:0},{actorId:'picker',input:ACTIONS.P.input,value:2.6}]});
  assert.equal(r.report.reason,'last-action-pickup',JSON.stringify(r.report.top));
 }finally{ACTIONS.G.gain=save;}
});

test('S4.30 regression (bb 326 w303): an unenumerable champion blitz is order-checked from the champion own tree',async()=>{
 const {e,C,P}=orderEngine();const inner=e.explore;
 e.explore=async(input,opts)=>input.action==='blitz'&&(opts.from??'root')==='root'?{ok:true,outcomes:[]}:inner(input,opts);
 const tree=await inner(C,{});                          // what the champion itself enumerated at the root
 const r=await planTurn({...(await inner({kind:'endTurn'},{})).outcomes[0].observation,active:'A',team:'A'},e,{boardValue:o=>o.v},Date.now()+10000,
  {championInput:C,championLine:{input:C,ex:tree}});
 assert.equal(r.report.orderCheck.measured,true,JSON.stringify(r.report.orderCheck));
 assert.equal(r.report.reason,'pickup-before-contact');
 assert.deepEqual(r.best.input,P);
});

test('S4.31 opportunity values compare lines before the opponent-reply correction (R1 step 41 world 202)',()=>{
 // Real champion lines at R1 step 41 world 202 after #8's block, #4 not yet moved (evaluation/probes/r41-202-*):
 // End Turn carried a measured reply (−30.66), #9's blocks only the flat unchecked charge (−18 × 1).
 const end={input:{kind:'endTurn'},value:507.344,replyAdjustment:-30.66,uncheckedReplyMass:0};
 const block={input:{kind:'playerAction',playerId:'A9',action:'block',blockTarget:'B10',path:[]},value:531.993,replyAdjustment:0,uncheckedReplyMass:1};
 const move={input:{kind:'playerAction',playerId:'A4',action:'move',path:[{kind:'step',to:{x:15,y:2}}]},value:509.472,replyAdjustment:0,uncheckedReplyMass:1};
 assert.equal(Math.round(replyNeutral(end)*10)/10,538);
 const v=actorValues([end,block,move]);
 assert.equal(Math.round(v.get('A9')*10)/10,12,'+24.6 with the reply asymmetry (capped 20), +12 like-for-like');
 assert.equal(v.get('A4'),0,'a move worth less than End Turn before replies earns no potential');
 // The asymmetry can also deflate: a mild measured End-Turn reply makes unchecked lines look worse than they are.
 const mild={...end,value:530,replyAdjustment:-5};
 assert.equal(Math.round(actorValues([mild,{...block,value:520}]).get('A9')*10)/10,3);
 // Lines without reply fields (older traces, synthetic fixtures) keep their plain values.
 assert.equal(actorValues([{input:{kind:'endTurn'},value:10},{input:{kind:'playerAction',playerId:'X'},value:17}]).get('X'),7);
});

test('S4.32 the opponent reply is charged to the whole plan, not only to its most likely branch',async()=>{
 // One player x: a dice-free move M (+9), or a block B whose two continuing outcomes are push (60 %, +10) and
 // knock-down (40 %, +14). The opponent reply costs −30 after either. Before S4.32 the block plan paid 0.6 × −30, so
 // its 40 % knock-down branch faced no opponent Turn and the block overrode the champion's move (−6.4 v −21).
 const X={B:{input:{kind:'playerAction',playerId:'x',action:'block',blockTarget:'y',path:[]}},
  M:{input:{kind:'playerAction',playerId:'x',action:'move',path:[{kind:'step',to:{x:4,y:4}}]}}};
 const ob=(v,done,active='A')=>({team:'A',active,phase:'play',pending:null,ball:{kind:'held',playerId:'z'},v,
  players:[{id:'x',team:'A',location:'pitch',stance:'standing',pos:{x:3,y:3},activated:done}]});
 const e={candidates:async q=>({ok:true,candidates:q.from&&q.from!=='root'?[]:Object.entries(X).map(([id,a])=>({input:a.input,label:id,legal:true}))}),
  explore:async(input,opts)=>{const from=opts.from??'root';
   if(input.kind==='endTurn')return {ok:true,outcomes:[{key:from+'#end',p:1,active:'B',observation:ob(0,true,'B')}]};
   if(from!=='root')return {ok:false};
   if(input.action==='move')return {ok:true,pTurnover:0,outcomes:[{key:'m',p:1,active:'A',observation:ob(9,true)}]};
   return {ok:true,pTurnover:0,outcomes:[{key:'push',p:0.6,active:'A',observation:ob(10,true)},{key:'down',p:0.4,active:'A',observation:ob(14,true)}]};}};
 const r=await planTurn(ob(0,false),e,{boardValue:o=>o.v,replyAssessment:async()=>({criticalAdjustment:0,positionAdjustment:-30})},
  Date.now()+10000,{championInput:X.M.input});
 const block=r.report.top.find(p=>p.labels[0]==='B');
 assert.equal(block.value,11.6);
 assert.equal(block.adjusted,-18.4,'0.6×10 + 0.4×14 − 30: the knock-down branch pays the reply too');
 assert.equal(r.report.championPlan.adjusted,-21);
 assert.equal(r.report.reason,'gain-below-margin','+2.6 is below the margin; with the old charge it was +14.6');
 assert.equal(r.best,null);
});

test('S4.33 a plan whose main line carries < 60 % also pays the measured reply of its larger other-outcome group',async()=>{
 // Block B: push 50 % (+10), knock-down 30 % (+14), both-down 20 % (+8). The reply after a knock-down is milder (−10)
 // than after the push (−30). S4.32 charged −30 to everything (+1.8 over the champion's move: below the margin).
 // S4.33 measures the non-main group (50 %, represented by its most probable branch, the knock-down) and charges the
 // mass-weighted mean (−20): the block is worth playing (+11.8).
 const X={B:{input:{kind:'playerAction',playerId:'x',action:'block',blockTarget:'y',path:[]}},
  M:{input:{kind:'playerAction',playerId:'x',action:'move',path:[{kind:'step',to:{x:4,y:4}}]}}};
 const ob=(v,done,active='A')=>({team:'A',active,phase:'play',pending:null,ball:{kind:'held',playerId:'z'},v,
  players:[{id:'x',team:'A',location:'pitch',stance:'standing',pos:{x:3,y:3},activated:done}]});
 const asked=[];
 const e={candidates:async q=>({ok:true,candidates:q.from&&q.from!=='root'?[]:Object.entries(X).map(([id,a])=>({input:a.input,label:id,legal:true}))}),
  explore:async(input,opts)=>{const from=opts.from??'root';
   if(input.kind==='endTurn')return {ok:true,outcomes:[{key:from+'#end',p:1,active:'B',observation:ob(0,true,'B')}]};
   if(from!=='root')return {ok:false};
   if(input.action==='move')return {ok:true,pTurnover:0,outcomes:[{key:'m',p:1,active:'A',observation:ob(9,true)}]};
   return {ok:true,pTurnover:0,outcomes:[{key:'push',p:0.5,active:'A',observation:ob(10,true)},{key:'down',p:0.3,active:'A',observation:ob(14,true)},
    {key:'both',p:0.2,active:'A',observation:ob(8,true)}]};}};
 const reply={boardValue:o=>o.v,replyAssessment:async at=>{asked.push(at.key);return {criticalAdjustment:0,positionAdjustment:at.key.startsWith('down')?-10:-30};}};
 const r=await planTurn(ob(0,false),e,reply,Date.now()+10000,{championInput:X.M.input});
 const block=r.report.top.find(p=>p.labels[0]==='B');
 assert.equal(block.value,10.8);
 assert.deepEqual({p:block.altReply.p,pMain:block.altReply.pMain,repP:block.altReply.repP},{p:0.5,pMain:0.5,repP:0.3});
 assert.equal(block.adjusted,-9.2,'10.8 + 0.5×−30 + 0.5×−10');
 assert.ok(asked.includes('down#end'),'the knock-down branch is played to its own End of Turn and assessed');
 assert.equal(r.report.reason,'whole-turn-plan-improvement');
 assert.deepEqual(r.best.input,X.B.input);
 assert.ok(!asked.includes('m#end#alt'),'a single-outcome plan needs no second reply');
});

test('S4.33 if a needed second reply cannot be measured, every plan falls back to the main-line reply (one basis)',async()=>{
 // Block B: push 50 % (+10), knock-down 30 % (+14), both-down 20 % (+8). The reply after a knock-down is milder (−10)
 // than after the push (−30). S4.32 charged −30 to everything (+1.8 over the champion's move: below the margin);
 // S4.33 measures both and charges their mass-weighted mean (−22.5): the block is worth playing (+9.3).
 const X={B:{input:{kind:'playerAction',playerId:'x',action:'block',blockTarget:'y',path:[]}},
  M:{input:{kind:'playerAction',playerId:'x',action:'move',path:[{kind:'step',to:{x:4,y:4}}]}}};
 const ob=(v,done,active='A')=>({team:'A',active,phase:'play',pending:null,ball:{kind:'held',playerId:'z'},v,
  players:[{id:'x',team:'A',location:'pitch',stance:'standing',pos:{x:3,y:3},activated:done}]});
 const asked=[];
 const e={candidates:async q=>({ok:true,candidates:q.from&&q.from!=='root'?[]:Object.entries(X).map(([id,a])=>({input:a.input,label:id,legal:true}))}),
  explore:async(input,opts)=>{const from=opts.from??'root';
   if(input.kind==='endTurn')return {ok:true,outcomes:[{key:from+'#end',p:1,active:'B',observation:ob(0,true,'B')}]};
   if(from!=='root')return {ok:false};
   if(input.action==='move')return {ok:true,pTurnover:0,outcomes:[{key:'m',p:1,active:'A',observation:ob(9,true)}]};
   return {ok:true,pTurnover:0,outcomes:[{key:'push',p:0.5,active:'A',observation:ob(10,true)},{key:'down',p:0.3,active:'A',observation:ob(14,true)},
    {key:'both',p:0.2,active:'A',observation:ob(8,true)}]};}};
 const reply={boardValue:o=>o.v,replyAssessment:async at=>{asked.push(at.key);return at.key.startsWith('down')?{failed:true}:{criticalAdjustment:0,positionAdjustment:-30};}};
 const r=await planTurn(ob(0,false),e,reply,Date.now()+10000,{championInput:X.M.input});
 const block=r.report.top.find(p=>p.labels[0]==='B');
 assert.equal(r.report.replyBasis,'main-line (second reply incomplete)');
 assert.equal(block.altReply,null);
 assert.equal(block.adjusted,-19.2,'10.8 − 30');
 assert.equal(r.report.reason,'gain-below-margin');
});

test('S4.33 a failed pickup spread over many bounce branches is charged the reply of a measured failure state',async()=>{
 // Pickup P: success 45 % (+40) continues; failure 55 % is 5 bounce branches of 11 % each (turnovers, ball loose).
 // Opponent reply after success −10, after a failure −60. S4.32 charged the success reply to the whole plan.
 const X={P:{input:{kind:'playerAction',playerId:'x',action:'secure',path:[]}},M:{input:{kind:'playerAction',playerId:'x',action:'move',path:[{kind:'step',to:{x:4,y:4}}]}}};
 const ob=(v,done,active='A')=>({team:'A',active,phase:'play',pending:null,ball:{kind:'held',playerId:'z'},v,
  players:[{id:'x',team:'A',location:'pitch',stance:'standing',pos:{x:3,y:3},activated:done}]});
 const e={candidates:async q=>({ok:true,candidates:q.from&&q.from!=='root'?[]:Object.entries(X).map(([id,a])=>({input:a.input,label:id,legal:true}))}),
  explore:async(input,opts)=>{const from=opts.from??'root';
   if(input.kind==='endTurn')return {ok:true,outcomes:[{key:from+'#end',p:1,active:'B',observation:ob(0,true,'B')}]};
   if(from!=='root')return {ok:false};
   if(input.action==='move')return {ok:true,pTurnover:0,outcomes:[{key:'m',p:1,active:'A',observation:ob(5,true)}]};
   return {ok:true,pTurnover:0.55,outcomes:[{key:'ok',p:0.45,active:'A',observation:ob(40,true)},
    ...[1,2,3,4,5].map(i=>({key:'fail'+i,p:0.11,turnover:true,active:'B',observation:ob(0,true,'B')}))]};}};
 const asked=[];
 const r=await planTurn(ob(0,false),e,{boardValue:o=>o.v,replyAssessment:async at=>{asked.push(at.key);return {criticalAdjustment:0,positionAdjustment:at.key.startsWith('fail')?-60:-10};}},
  Date.now()+10000,{championInput:X.P.input});
 const pick=r.report.championPlan;
 assert.ok(asked.includes('fail1'),'the most probable failure branch (already at the opponent start) is assessed directly');
 assert.equal(pick.altReply.turnover,true);assert.equal(pick.altReply.p,0.55);
 assert.equal(pick.adjusted,Math.round((18+0.45*-10+0.55*-60)*10)/10,'value 18 + 0.45×−10 + 0.55×−60');
});

test('S4.33 the champion plan reply is measured first; without it no measured plan overrides it',async()=>{
 const X={B:{input:{kind:'playerAction',playerId:'x',action:'block',blockTarget:'y',path:[]}},M:{input:{kind:'playerAction',playerId:'x',action:'move',path:[{kind:'step',to:{x:4,y:4}}]}}};
 const ob=(v,done,active='A')=>({team:'A',active,phase:'play',pending:null,ball:{kind:'held',playerId:'z'},v,
  players:[{id:'x',team:'A',location:'pitch',stance:'standing',pos:{x:3,y:3},activated:done}]});
 const e={candidates:async q=>({ok:true,candidates:q.from&&q.from!=='root'?[]:Object.entries(X).map(([id,a])=>({input:a.input,label:id,legal:true}))}),
  explore:async(input,opts)=>{const from=opts.from??'root';
   if(input.kind==='endTurn')return {ok:true,outcomes:[{key:from+'#end',p:1,active:'B',observation:ob(0,true,'B')}]};
   if(from!=='root')return {ok:false};
   if(input.action==='move')return {ok:true,pTurnover:0,outcomes:[{key:'m',p:1,active:'A',observation:ob(0,true)}]};
   return {ok:true,pTurnover:0,outcomes:[{key:'push',p:1,active:'A',observation:ob(40,true)}]};}};
 const asked=[];
 const run=failChampion=>planTurn(ob(0,false),e,{boardValue:o=>o.v,replyAssessment:async at=>{asked.push(at.key);
  return failChampion&&at.key==='m#end'?{failed:true}:{criticalAdjustment:0,positionAdjustment:-10};}},Date.now()+10000,{championInput:X.M.input});
 const ok=await run(false);
 assert.equal(asked[0],'m#end','the champion plan (the move) is assessed before any alternative');
 assert.equal(ok.report.reason,'whole-turn-plan-improvement');
 const r=await run(true);
 assert.equal(r.report.reason,'champion-plan-reply-unmeasured');assert.equal(r.best,null);
});

test('S4.34 a dice-free action the plan schedules after a risky one is played first when the orders are worth the same',async()=>{
 // Champion: block R by r (70 % continue +30, 30 % turnover). Move M by m is dice-free and worth +2 either way. The
 // planner's margin keeps the champion's [R, M] (gain 0.6 < 3), but a failed R forfeits M: [M, R] is never worse.
 // Real cases: A2 away 428 ([blitz 11 %, #9 move L9, …]), B1 away 298 (79 % pickup before "#3 move to M7").
 const mk=({mBefore,mAfter,rAfterM='ok',mRootRisk=0})=>{
  const R={input:{kind:'playerAction',playerId:'r',action:'block',blockTarget:'y',path:[]}},M={input:{kind:'playerAction',playerId:'m',action:'move',path:[{kind:'step',to:{x:6,y:6}}]}};
  const val=done=>(done.includes('R')?30:0)+(done.includes('M')?(done.indexOf('M')>done.indexOf('R')&&done.includes('R')?mAfter:mBefore):0);
  const ob=(done,active='A')=>({team:'A',active,phase:'play',pending:null,ball:{kind:'held',playerId:'z'},v:val(done),
   players:[{id:'r',team:'A',location:'pitch',stance:'standing',pos:{x:3,y:3},activated:done.includes('R')},{id:'m',team:'A',location:'pitch',stance:'standing',pos:{x:8,y:8},activated:done.includes('M')}]});
  const doneOf=from=>from==='root'?[]:from.split('+');
  const e={candidates:async q=>{const done=doneOf(q.from??'root');return {ok:true,candidates:[['R',R],['M',M]].filter(([k])=>!done.includes(k)).map(([k,a])=>({input:a.input,label:k,legal:true}))};},
   explore:async(input,opts)=>{const from=opts.from??'root';if(from.includes('#'))return {ok:false};const done=doneOf(from);
    if(input.kind==='endTurn')return {ok:true,outcomes:[{key:from+'#end',p:1,active:'B',observation:ob(done,'B')}]};
    const id=input.playerId==='r'?'R':'M';if(done.includes(id))return {ok:false};const next=[...done,id],key=next.join('+');
    // review variants: R cannot be measured after M (per-call timeout / M made it illegal); M needs a dodge at the root
    if(id==='R'&&done.includes('M')&&rAfterM!=='ok')return rAfterM==='timeout'?{ok:false,code:'timeout',timedOut:true,limit:'maxMs'}:{ok:false,code:'illegal'};
    if(id==='M'&&!done.includes('R')&&mRootRisk>0)return {ok:true,pTurnover:mRootRisk,outcomes:[{key,p:1-mRootRisk,active:'A',observation:ob(next)},{key:key+'#to',p:mRootRisk,turnover:true,active:'B',observation:ob(done,'B')}]};
    if(id==='M')return {ok:true,pTurnover:0,outcomes:[{key,p:1,active:'A',observation:ob(next)}]};
    return {ok:true,pTurnover:0.3,outcomes:[{key,p:0.7,active:'A',observation:ob(next)},{key:key+'#to',p:0.3,turnover:true,active:'B',observation:ob(done,'B')}]};}};
  return {R,M,e,ob};
 };
 const t=mk({mBefore:2,mAfter:2});
 const r=await planTurn(t.ob([]),t.e,{boardValue:o=>o.v},Date.now()+10000,{championInput:t.R.input});
 assert.equal(r.report.reason,'dice-free-before-risky',JSON.stringify(r.report.riskFirstCheck));
 assert.deepEqual(r.best.input,t.M.input);
 assert.equal(r.report.riskFirstCheck.diceFreeFirst,true);
 assert.ok(r.report.riskFirstCheck.diceFreeFirstOrder.value>=r.report.riskFirstCheck.riskyFirst.value);
 // Counterexample: M is only worth something after R (R opens its route) — risky first is kept.
 const u=mk({mBefore:0,mAfter:20});
 const s=await planTurn(u.ob([]),u.e,{boardValue:o=>o.v},Date.now()+10000,{championInput:u.R.input});
 assert.notEqual(s.report.reason,'dice-free-before-risky');
 assert.equal(s.best,null,'the champion block stays first');
 assert.equal(s.report.riskFirstCheck.diceFreeFirst,false);
 // Review fixes. (1) The risky action could not be measured after the dice-free one (per-call timeout, or the move made
 // it illegal — e.g. a hand-off receiver walking away): before the fix that branch counted as "not played, no risk"
 // and the order looked free. Now the champion's order is kept.
 for(const rAfterM of ['timeout','illegal']){
  const v=mk({mBefore:2,mAfter:2,rAfterM});
  const x=await planTurn(v.ob([]),v.e,{boardValue:o=>o.v},Date.now()+10000,{championInput:v.R.input});
  assert.notEqual(x.report.reason,'dice-free-before-risky',rAfterM);
  assert.equal(x.best,null,rAfterM+': the champion block stays first');
  assert.equal(x.report.riskFirstCheck.measured,false);assert.equal(x.report.riskFirstCheck.reason,'second-action-unmeasured');
  assert.equal(x.report.riskFirstCheck.unplayed.diceFreeFirst,1);
 }
 // (2) The later action is dice-free only after the risky one (its marker is knocked down); at the root it needs an
 // 11 % dodge. It must not be played first as "dice-free".
 const w=mk({mBefore:2,mAfter:2,mRootRisk:0.11});
 const y=await planTurn(w.ob([]),w.e,{boardValue:o=>o.v},Date.now()+10000,{championInput:w.R.input});
 assert.notEqual(y.report.reason,'dice-free-before-risky');
 assert.equal(y.report.riskFirstCheck.reason,'not-dice-free-at-root');
});

test('S4.34 the planner is consulted when a saved continuation is about to end the Turn',async()=>{
 const {plannerGate}=await import('../src/turn-planner.mjs');
 const move={kind:'playerAction',playerId:'A6',action:'move',path:[{kind:'step',to:{x:18,y:8}}]};
 assert.deepEqual(plannerGate({savedContinuation:false,championInput:move}),{run:true,reason:'no-saved-continuation'});
 assert.equal(plannerGate({savedContinuation:true,championInput:move,continuationInput:move}).run,false,'a saved multi-step plan still continues without re-planning');
 // B1 away turn 40, decision 8: the saved S3 continuation's next step was End Turn while guard moves were pending.
 assert.deepEqual(plannerGate({savedContinuation:true,championInput:{kind:'endTurn'},continuationInput:{kind:'endTurn'}}),{run:true,reason:'saved-continuation-ends-turn'});
 assert.equal(plannerGate({savedContinuation:true,championInput:move,continuationInput:{kind:'endTurn'}}).run,true);
 assert.equal(plannerGate({savedContinuation:true,championInput:{kind:'endTurn'},continuationInput:move}).run,false,
  'a saved real action keeps priority over a champion End Turn (lifecycle-host: saved dependency wins)');
});

test('S4.34 review: the late consult also covers a continuation that ends the Turn, unless End Turn was already the baseline',async()=>{
 const {lateConsultDue}=await import('../src/turn-planner.mjs');
 const end={kind:'endTurn'},move={kind:'playerAction',playerId:'A6',action:'move',path:[{kind:'step',to:{x:18,y:8}}]};
 const base={chosen:end,savedContinuation:true,mode:'normal',msLeft:30000};
 // B1 away turn 40: a real-action continuation lost to End Turn, early planner skipped by the gate.
 assert.equal(lateConsultDue({...base,plannerRan:false,championInput:end}),true);
 // Continuation ends the Turn, early consult skipped for budget (champion used its 48 s): before the fix, not consulted.
 assert.equal(lateConsultDue({...base,plannerRan:false,championInput:move}),true);
 // Early consult valued only the champion's move X; End Turn then won through the continuation or the common pool.
 assert.equal(lateConsultDue({...base,plannerRan:true,championInput:move}),true);
 // Early consult already compared its plans against End Turn: no second run.
 assert.equal(lateConsultDue({...base,plannerRan:true,championInput:end}),false);
 assert.equal(lateConsultDue({...base,savedContinuation:false,championInput:end}),false,'S4.33 path unchanged without a saved continuation');
 assert.equal(lateConsultDue({...base,championInput:end,chosen:move}),false,'only before End Turn');
 assert.equal(lateConsultDue({...base,championInput:end,mode:'certain-td'}),false,'special champion modes are kept');
 assert.equal(lateConsultDue({...base,championInput:end,msLeft:13999}),false,'needs 14 s');
});
