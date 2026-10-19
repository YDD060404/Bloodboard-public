import test from 'node:test';
import assert from 'node:assert/strict';
import {E,observe,Session,callService} from './deps/archived-v6-host.mjs';
import {createChampion} from '../src/champion.mjs';
import {goalDiscovery,challengeGoalTasks} from '../src/goals.mjs';
import {saveChampionPlan} from '../src/plans.mjs';
import {reconcile,planView} from '../src/execution.mjs';
import {commonPool} from '../src/common-boundary.mjs';
import {policyIdentity} from '../src/policy.mjs';
const inspect=createChampion().inspector,identity={coachId:'hopeful-2-5-s4-37u-c-unified',version:'2.5.0-test.s4.37u.c',contextSchema:'hopeful-context/2.5-s4.37u.c'};
function setup(){
 const s=E.buildScenario({teams:{A:'human',B:'human'},players:[
  {id:'alpha',team:'A',roster:'human',position:'lineman',at:[8,7],number:1},
  {id:'beta',team:'A',roster:'human',position:'lineman',at:[8,9],number:2},
  {id:'foe',team:'B',roster:'human',position:'lineman',at:[23,2],number:1}],ball:{at:[10,7]}},13);
 const o=observe(s,'A',1);return {s,o};
}
function services(state,id=1){const session=new Session(state,'A',id,60000),sv={},queries=[];
 for(const m of ['explore','validate','candidates','sequence'])sv[m]=async(...a)=>{if(m==='candidates')queries.push(a[0]);return callService(session,m,a);};
 sv.threats={scoring:async(...a)=>callService(session,'threats.scoring',a),blitz:async(...a)=>callService(session,'threats.blitz',a)};
 return {sv,queries};
}
test('actual ability and reliability swaps change real recovery-role discovery without a value bonus',async()=>{
 for(const reliable of ['alpha','beta']){
  const {s,o}=setup();for(const p of o.players)if(p.team==='A'){p.ag=p.id===reliable?2:4;p.skills=p.id===reliable?['sureHands']:['boneHead'];}
  // Apply the same public abilities to actual engine actors for legal queries.
  for(const p of s.players)if(p.team==='A')Object.assign(p,{ag:o.players.find(x=>x.id===p.id).ag,skills:o.players.find(x=>x.id===p.id).skills.map(id=>({id}))});
  const actual=observe(s,'A',1),drive=inspect.buildDrivePlan(actual,null),goal=goalDiscovery(actual,drive);
  assert.equal(goal.kind,'recover-ball');assert.equal(goal.actorIds[0],reliable);
  const {sv,queries}=services(s),end={input:{kind:'endTurn'},ex:await sv.explore({kind:'endTurn'},{observations:true,maxMs:500})};
  const result=await challengeGoalTasks(actual,{mode:'normal',selected:end,lines:[end]},drive,null,null,sv,inspect,Date.now()+9000);
  assert.equal(result.attempted,true);assert.equal(result.queries[0].players[0],reliable);
  assert.ok(queries.some(q=>q.players?.[0]===reliable&&q.region?.within?.some(p=>p.x===10&&p.y===7)));
 }
});
test('superior special choice retains its existing discovery gate',async()=>{
 const {s,o}=setup(),{sv}=services(s),drive=inspect.buildDrivePlan(o,null);
 const r=await challengeGoalTasks(o,{mode:'certain-td',selected:{input:{kind:'endTurn'},ex:{ok:true}}},drive,null,null,sv,inspect,Date.now()+10000);
 assert.equal(r.attempted,false);assert.equal(r.selected,null);
});
test('material route displacement retains semantic objective only in the same valid activation and re-discovers fresh routes',async()=>{
 const {s}=setup();s.ball={kind:'held',playerId:'alpha'};const o=observe(s,'A',1),{sv}=services(s);
 const input={kind:'playerAction',playerId:'alpha',action:'move',path:[{kind:'step',to:{x:9,y:7}}]},
  ex=await sv.explore(input,{observations:true,maxMs:500}),goal={id:'actual-route-goal',kind:'advance',target:{x:9,y:7}},
  saved=saveChampionPlan(o,{input,ex,goal},identity);assert.ok(saved.plan);assert.deepEqual(planView(saved.plan).activeTask.goal,goal);
 const executed=E.execute(s,input);assert.equal(executed.status,'completed');executed.state.players.find(p=>p.id==='alpha').pos={x:8,y:6};
 const changed=observe(executed.state,'A',2),review=reconcile(saved.plan,changed,{identity});assert.equal(review.status,'invalidated');
 const repair=goalDiscovery(changed,inspect.buildDrivePlan(changed,null),saved.plan,review);
 assert.equal(repair.kind,'repair-activation-route');assert.equal(repair.id,goal.id);assert.deepEqual(repair.target,{x:9,y:7});
 const current=services(executed.state,2),found=await current.sv.candidates({players:repair.actorIds,families:repair.families,region:repair.region,precision:'none',maxRushes:0,limit:20});
 assert.ok(found.candidates.length);assert.ok(found.candidates.every(c=>callService(new Session(executed.state,'A',5,60000),'validate',[c.input,{}]).legal));
 const changedScope={...changed,drive:changed.drive+1};assert.notEqual(goalDiscovery(changedScope,inspect.buildDrivePlan(changedScope,null),saved.plan,review)?.kind,'repair-activation-route');
 const completed=observe(E.execute(s,input).state,'A',2);assert.notEqual(goalDiscovery(completed,inspect.buildDrivePlan(completed,null),saved.plan,{status:'invalidated',reason:'unretained-or-changed-public-outcome'})?.kind,'repair-activation-route');
});
test('possession and urgency change actual goal family; unavailable or unreliable actors are not fixed by player ID',()=>{
 const {s,o}=setup();assert.equal(goalDiscovery(o,{emergency:false}).kind,'recover-ball');
 assert.equal(goalDiscovery(o,{emergency:true})?.kind,'deny-scoring-lane');
 o.ball={kind:'held',playerId:'alpha'};assert.equal(goalDiscovery(o,{driveUrgency:'convert now'})?.kind,'score-current-window');
 assert.equal(goalDiscovery(o,{driveUrgency:'controlled advance'})?.kind,'stabilize-possession');
 o.players.filter(p=>p.team==='A').forEach(p=>p.activated=true);assert.equal(goalDiscovery(o,{}),null);
});
test('My Ball forbids transfer, not recovery: actual Fox gets the legal pickup role; noBall remains excluded',async()=>{
 const state=E.buildScenario({teams:{A:'gnome',B:'human'},players:[
  {id:'fox',team:'A',roster:'gnome',position:'woodlandFox',at:[8,7],number:1},
  {id:'foe',team:'B',roster:'human',position:'lineman',at:[23,2],number:1}],ball:{at:[9,7]}},13);
 const o=observe(state,'A',1),goal=goalDiscovery(o,inspect.buildDrivePlan(o,null));assert.equal(goal.kind,'recover-ball');assert.deepEqual(goal.actorIds,['fox']);
 const session=new Session(state,'A',1,60000),input={kind:'playerAction',playerId:'fox',action:'move',path:[{kind:'step',to:{x:9,y:7}}]};
 assert.equal(callService(session,'validate',[input,{}]).legal,true);
 const ex=callService(session,'explore',[input,{observations:true,decisions:'builtin',maxOutcomes:40,maxLeaves:3500,maxMs:700}]);
 assert.ok(ex.outcomes.filter(b=>b.observation?.ball?.playerId==='fox').reduce((p,b)=>p+b.p,0)>.97);
 state.players.find(p=>p.id==='fox').skills.push({id:'noBall'});
 assert.equal(goalDiscovery(observe(state,'A',2),{}),null);
});

// Plain service/clock mocks: these test discovery coverage, not native legality,
// probabilities, complete policy comparison or a guaranteed query duration.
function discoveryObservation(){
 const actor=(id,x,y,extra={})=>({id,team:'A',location:'pitch',pos:{x,y},stance:'standing',ma:6,ag:3,skills:[],activated:false,...extra});
 return {team:'A',half:1,drive:1,turn:{A:1,B:1},ball:{kind:'ground',pos:{x:10,y:7}},
  pitch:{width:26,height:15,endZone:{A:25,B:0}},players:[actor('one',9,7),actor('two',8,7),actor('three',7,7),
   actor('spent',9,8,{activated:true}),actor('no-ball',9,6,{skills:['noBall']}),actor('far',0,0)]};
}
const discoveryInspect={canonical:c=>c,boardValue:()=>0,cheapScore:()=>0};
const normalMove={mode:'normal',selected:{input:{kind:'playerAction',playerId:'one',action:'move',path:[]},ex:{ok:true}},lines:[]};
const completePage=()=>({ok:true,position:{key:'root'},candidates:[],hasMore:false,truncated:[]});
test('all task-eligible recovery and positioning actors are retained beyond two',()=>{
 const o=discoveryObservation();assert.deepEqual(goalDiscovery(o,{}).actorIds,['one','two','three']);
 o.ball={kind:'held',playerId:'one'};
 const screen=goalDiscovery(o,{});assert.equal(screen.kind,'stabilize-possession');
 assert.deepEqual(new Set(screen.actorIds),new Set(['two','three','no-ball']));
});
test('normal non-End selection discovers all actors without treating roles as a winner',async()=>{
 const queries=[],sv={candidates:async q=>{queries.push(q);return completePage();}};
 const r=await challengeGoalTasks(discoveryObservation(),normalMove,{},null,null,sv,discoveryInspect,Date.now()+10000);
 assert.equal(r.attempted,true);assert.equal(r.selected,null);
 assert.deepEqual(queries.map(q=>q.players[0]),['one','two','three']);
 assert.deepEqual(r.discoveryCoverage.queriedActorIds,['one','two','three']);
 assert.deepEqual(r.discoveryCoverage.unexaminedActorIds,[]);assert.equal(r.discoveryCoverage.complete,true);
 assert.match(r.discoveryCoverage.scope,/does not mean complete opportunity comparison/);
});
test('discovery stops in its original slot and reports remaining actors unexamined',async()=>{
 const originalNow=Date.now;let now=10000;Date.now=()=>now;
 try{
  const sv={candidates:async()=>{now+=7000;return completePage();}};
  const r=await challengeGoalTasks(discoveryObservation(),normalMove,{},null,null,sv,discoveryInspect,20000);
  assert.deepEqual(r.discoveryCoverage.queriedActorIds,['one']);
  assert.deepEqual(r.discoveryCoverage.unexaminedActorIds,['two','three']);
  assert.equal(r.discoveryCoverage.complete,false);assert.equal(r.discoveryCoverage.stopReason,'goal-discovery-slot-budget-unavailable');
  assert.ok(r.discoveryCoverage.actors.slice(1).every(row=>row.status==='unexamined'&&row.reason===r.discoveryCoverage.stopReason));
 }finally{Date.now=originalNow;}
});
test('local budget refusal is an attempted query, not measured actor coverage',async()=>{
 let calls=0;const sv={candidates:async()=>{calls++;return {ok:false,code:'coach-producer-budget',message:'producer-call-slot-exhausted'};}};
 const r=await challengeGoalTasks(discoveryObservation(),normalMove,{},null,null,sv,discoveryInspect,Date.now()+10000);
 assert.equal(calls,1);assert.deepEqual(r.discoveryCoverage.attemptedActorIds,['one']);
 assert.deepEqual(r.discoveryCoverage.queriedActorIds,[]);assert.deepEqual(r.discoveryCoverage.unexaminedActorIds,['one','two','three']);
 assert.equal(r.discoveryCoverage.actors[0].status,'local-refusal');assert.equal(r.discoveryCoverage.stopReason,'producer-call-slot-exhausted');
 assert.equal(r.discoveryCoverage.complete,false);assert.equal(r.selected,null);
});
test('truncated or unknown candidate pages never imply complete discovery',async()=>{
 for(const page of [{...completePage(),hasMore:true},{ok:true,position:{key:'root'},candidates:[]}]){
  const r=await challengeGoalTasks(discoveryObservation(),normalMove,{},null,null,{candidates:async()=>page},discoveryInspect,Date.now()+10000);
  assert.deepEqual(r.discoveryCoverage.queriedActorIds,['one','two','three']);
  assert.deepEqual(r.discoveryCoverage.incompleteActorIds,['one','two','three']);assert.equal(r.discoveryCoverage.complete,false);
  assert.equal(r.selected,null);
 }
});
test('entry slot refusal and query exception retain the actual uncovered actors',async()=>{
 const originalNow=Date.now;Date.now=()=>10000;
 try{
  let calls=0;const sv={candidates:async()=>{calls++;if(calls===1)throw Error('mock query failed');return completePage();}};
  const skipped=await challengeGoalTasks(discoveryObservation(),normalMove,{},null,null,sv,discoveryInspect,13000);
  assert.equal(skipped.attempted,false);assert.equal(calls,0);assert.deepEqual(skipped.discoveryCoverage.unexaminedActorIds,['one','two','three']);
  const r=await challengeGoalTasks(discoveryObservation(),normalMove,{},null,null,sv,discoveryInspect,20000);
  assert.deepEqual(r.discoveryCoverage.unexaminedActorIds,['one']);assert.deepEqual(r.discoveryCoverage.queriedActorIds,['two','three']);
  assert.equal(r.discoveryCoverage.actors[0].status,'query-exception');assert.match(r.discoveryCoverage.actors[0].reason,/mock query failed/);
  assert.equal(r.discoveryCoverage.complete,false);
 }finally{Date.now=originalNow;}
});

test('an open current activation retains the activated current actor and every unused native-enabled goal actor',async t=>{
 t.mock.method(Date,'now',()=>0);const o=discoveryObservation();
 o.activation={playerId:'one',over:false,maUsed:4};o.players.find(p=>p.id==='one').activated=true;
 for(const p of o.players)p.canBeActivated=p.id!=='spent';
 o.players.push({...o.players[1],id:'native-disabled',canBeActivated:false});
 const queries=[],r=await challengeGoalTasks(o,normalMove,{},null,null,{candidates:async q=>{queries.push(q);return completePage();}},discoveryInspect,10000);
 assert.deepEqual(goalDiscovery(o,{}).actorIds,['one','two','three']);
 assert.deepEqual(queries.map(q=>q.players[0]),['one','two','three']);assert.ok(queries.every(q=>q.from==='root'&&q.team==='A'));
 assert.equal(r.discoveryCoverage.complete,true);assert.deepEqual(r.discoveryCoverage.unexaminedActorIds,[]);assert.equal(r.selected,null);
});
test('a new actor uses its own MA rather than the previous actor activation movement',()=>{
 const o=discoveryObservation();o.activation={playerId:'one',over:false,maUsed:6};
 Object.assign(o.players.find(p=>p.id==='one'),{activated:true,canBeActivated:true,pos:{x:0,y:7}});
 Object.assign(o.players.find(p=>p.id==='two'),{ma:3,canBeActivated:true,pos:{x:5,y:7}});
 Object.assign(o.players.find(p=>p.id==='three'),{stance:'prone',ma:3,canBeActivated:true,pos:{x:7,y:7}});
 assert.deepEqual(goalDiscovery(o,{}).actorIds,['two'],'other actor has MA3 + discovery reach allowance; Prone actor must pay its own stand-up cost');
});
test('ended or spent actors cannot borrow another activation and rooted does not globally erase a legal transfer tool',()=>{
 const o=discoveryObservation();Object.assign(o.players.find(p=>p.id==='one'),{activated:true,canBeActivated:false});
 o.activation={playerId:'one',over:true,maUsed:1};assert.deepEqual(goalDiscovery(o,{}).actorIds,['two','three']);
 o.activation={playerId:'two',over:false,maUsed:1};assert.ok(!goalDiscovery(o,{}).actorIds.includes('one'));
 Object.assign(o.players.find(p=>p.id==='one'),{activated:false,canBeActivated:true,rooted:true});o.ball={kind:'held',playerId:'one'};
 const transfer=goalDiscovery(o,{driveUrgency:'convert now'});assert.equal(transfer.kind,'score-current-window');
 assert.deepEqual(transfer.actorIds,['one']);assert.ok(transfer.families.includes('pass'));
});
test('a switched actor input must be legal at the actual root before any chance or policy binding',async t=>{
 t.mock.method(Date,'now',()=>0);
 const input={kind:'playerAction',playerId:'two',action:'secure',path:[{kind:'step',to:{x:10,y:7}}]};
 for(const response of [{ok:true,legal:false,position:'root'},{ok:true,legal:true,position:'old-child'},
  {ok:false,code:'coach-producer-budget',message:'producer-call-slot-exhausted'}]){
  const o=discoveryObservation();o.activation={playerId:'one',over:false,maUsed:1};o.players[0].activated=true;
  let explores=0;const validations=[],sv={candidates:async()=>({...completePage(),candidates:[{input}]}),
   validate:async(i,q)=>{validations.push({i,q});return response;},explore:async()=>{explores++;throw Error('unvalidated switch must not explore');}};
  const r=await challengeGoalTasks(o,normalMove,{},null,null,sv,discoveryInspect,10000);
  assert.equal(validations.length,1);assert.deepEqual(validations[0],{i:input,q:{from:'root',team:'A'}});assert.equal(explores,0);
  assert.equal(r.selected,null);assert.equal(r.policyTrees,undefined);assert.equal(r.candidates.length,1);
  assert.deepEqual(r.candidates[0].validation,{ok:response.ok,legal:response.legal??null,position:response.position??null,code:response.code??null});
 }
});
test('a legal direct player switch is explored at root and incomplete native chance remains unbound',async t=>{
 t.mock.method(Date,'now',()=>0);const o=discoveryObservation();o.activation={playerId:'one',over:false,maUsed:1};o.players[0].activated=true;
 const input={kind:'playerAction',playerId:'two',action:'secure',path:[{kind:'step',to:{x:10,y:7}}]},explores=[];
 const sv={candidates:async()=>({...completePage(),candidates:[{input}]}),validate:async(i,q)=>({ok:true,legal:true,position:q.from}),
  explore:async(i,q)=>{explores.push({i,q});return {ok:true,position:{key:'root'},outcomes:[],unresolvedMass:1,rest:{p:1}};}};
 const r=await challengeGoalTasks(o,normalMove,{},null,null,sv,discoveryInspect,10000);
 assert.equal(explores.length,1);assert.deepEqual(explores[0].i,input);assert.equal(explores[0].q.from,'root');assert.equal(explores[0].q.team,'A');
 assert.equal(r.selected,null);assert.deepEqual(r.policyTrees,[]);assert.equal(r.candidates[0].reason,'current-task-exploration-incomplete');
});

// This fixture exercises the real goal -> continuation -> commonPool functions.
// Service replies are pure mocks; they do not certify native chance or strength.
function goalProposalFixture({eligible=false,dependencies=null,incumbentComplete=true}={}){
 const o=discoveryObservation();
 o.players.push({id:'foe',team:'B',location:'pitch',pos:{x:10,y:7},stance:'standing',skills:[]});
 o.ball={kind:'held',playerId:'foe'};
 const input={kind:'playerAction',playerId:'one',action:'move',path:[{kind:'step',to:{x:9,y:8}}]},
  ex={ok:true,position:{key:'root'},pTurnover:0,pTouchdown:0,unresolvedMass:0,rest:{p:0},
   outcomes:[{key:'fresh-own-End',p:1,active:'B',observation:{active:'B'}}]},
  incumbent={input:normalMove.selected.input,baseValue:100,ex:incumbentComplete?ex:{ok:true,outcomes:[],unresolvedMass:1,rest:{p:1}}},
  filler=Array.from({length:10},(_,i)=>({input:{kind:'playerAction',playerId:'filler'+i,action:'move',path:[]},ex,baseValue:100-i})),
  end={input:{kind:'endTurn'},ex,baseValue:0},early={input:{kind:'playerAction',playerId:'early',action:'move',path:[]},ex,baseValue:80},
  snapshot={mode:'normal',selected:incumbent,lines:[incumbent,...filler,end]},calls=[];
 const sv={candidates:async()=>({...completePage(),candidates:[{input}]}),
  validate:async(i,q)=>{calls.push({method:'validate',input:i,options:q});return {ok:true,legal:true,position:q.from};},
  explore:async(i,q)=>{calls.push({method:'explore',input:i,options:q});return ex;}};
 const inspector={...discoveryInspect,canonical:c=>({...c,...(dependencies?{preparedBranches:dependencies}:{})}),
  CFG:{turnover:0,carrierTurnover:0,unresolved:0,optionalRush:0},outcomeValue:()=>({value:0}),observedTerminalScore:()=>0,
  replyAssessment:async()=>({unknown:false,essentialComplete:true,failed:false,criticalAdjustment:0,positionAdjustment:0}),
  contenderEvidence:()=>({eligible,replyBasis:{mode:'complete'}})};
 return {o,input,ex,incumbent,early,snapshot,sv,inspector,calls};
}
test('a real nonselected goal proposal keeps public provenance and reaches the existing prevent-score reserve',async t=>{
 t.mock.method(Date,'now',()=>0);const f=goalProposalFixture();
 const r=await challengeGoalTasks(f.o,f.snapshot,{},null,null,f.sv,f.inspector,10000);
 assert.equal(r.selected,null);assert.equal(r.candidates[0].reason,'conditional-task-not-better-on-common-evidence');
 assert.equal(r.policyTrees.length,1);const tree=r.policyTrees[0],goal={id:r.discovery.id,kind:'deny-scoring-lane',target:'foe'};
 assert.deepEqual(tree.goal,goal);assert.strictEqual(tree.input,f.input);assert.strictEqual(tree.ex,f.ex);
 assert.equal(f.calls.filter(c=>c.method==='validate').length,1);
 const explored=f.calls.filter(c=>c.method==='explore');assert.equal(explored.length,1);
 assert.deepEqual(explored[0].options,{coachEnumerationDeadline:9000,from:'root',team:'A',perspective:'A',observations:true,
  decisions:'builtin',threshold:.00001,maxOutcomes:40,maxKeep:256,maxLeaves:3500,maxMs:900});
 const {goal:ignored,...oldTree}=tree;
 assert.equal(policyIdentity(tree),policyIdentity(oldTree));
 const oldPool=commonPool(f.o,f.snapshot,f.incumbent,8,[f.early,oldTree]);
 assert.equal(oldPool.length,8);assert.ok(!oldPool.some(p=>policyIdentity(p.line)===policyIdentity(tree)),'old unannotated route is crowded out');
 const pool=commonPool(f.o,f.snapshot,f.incumbent,8,[f.early,tree]);
 assert.equal(pool.length,8);assert.equal(pool.find(p=>p.line===tree)?.source,'prevent-score');
 assert.equal(pool.filter(p=>policyIdentity(p.line)===policyIdentity(tree)).length,1);
});
test('goal provenance preserves generated source evidence and the entire dependency identity after an incomplete local comparison',async t=>{
 t.mock.method(Date,'now',()=>0);
 const nested=new Map([['child-success',{plan:{input:{kind:'endActivation'}},ex:{ok:true}}]]),
  dependencies=new Map([['fresh-own-End',{plan:{input:{kind:'playerAction',playerId:'two',action:'move',path:[]}},ex:{ok:true},preparedBranches:nested}]]),
  f=goalProposalFixture({dependencies,incumbentComplete:false});
 const r=await challengeGoalTasks(f.o,f.snapshot,{},null,null,f.sv,f.inspector,10000);
 assert.equal(r.selected,null);assert.equal(r.candidates[0].reason,'incumbent-common-closure-incomplete');assert.equal(r.policyTrees.length,1);
 const tree=r.policyTrees[0];assert.strictEqual(tree.input,f.input);assert.strictEqual(tree.ex,f.ex);assert.strictEqual(tree.preparedBranches,dependencies);
 assert.strictEqual(tree.preparedBranches.get('fresh-own-End').preparedBranches,nested);
 assert.equal(policyIdentity(tree),policyIdentity({input:f.input,preparedBranches:dependencies}));
 assert.equal(tree.goal.kind,'deny-scoring-lane');assert.ok(!Object.hasOwn(tree,'requireRuleMaps'),'metadata cannot manufacture a binder certificate');
});
test('locally selected and generated goal views have one unchanged policy identity in the common pool',async t=>{
 t.mock.method(Date,'now',()=>0);const f=goalProposalFixture({eligible:true});
 const r=await challengeGoalTasks(f.o,f.snapshot,{},null,null,f.sv,f.inspector,10000);
 assert.ok(r.selected);assert.equal(r.policyTrees.length,1);assert.deepEqual(r.selected.goal,r.policyTrees[0].goal);
 const identity=policyIdentity(r.selected);assert.equal(identity,policyIdentity(r.policyTrees[0]));
 const pool=commonPool(f.o,f.snapshot,r.selected,8,[f.early,...r.policyTrees,r.selected]);
 assert.equal(pool.length,8);assert.equal(pool.filter(p=>policyIdentity(p.line)===identity).length,1);
});
test('wrong candidate source or illegal root cannot acquire a generated goal proposal',async t=>{
 t.mock.method(Date,'now',()=>0);
 for(const wrongPage of [true,false]){
  const f=goalProposalFixture();
  if(wrongPage)f.sv.candidates=async()=>({...completePage(),position:{key:'old-child'},candidates:[{input:f.input}]});
  else f.sv.validate=async()=>({ok:true,legal:false,position:'root'});
  const r=await challengeGoalTasks(f.o,f.snapshot,{},null,null,f.sv,f.inspector,10000);
  assert.equal(r.selected,null);assert.equal(r.policyTrees,undefined);assert.equal(f.calls.filter(c=>c.method==='explore').length,0);
  if(wrongPage){assert.equal(r.discoveryCoverage.complete,false);assert.ok(r.discoveryCoverage.actors.every(a=>a.reason==='goal-discovery-source-unverified'));}
  else assert.equal(r.candidates[0].reason,'goal-input-not-legal-at-root');
 }
});
