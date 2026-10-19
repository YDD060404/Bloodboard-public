import test from 'node:test';
import assert from 'node:assert/strict';
import {E,observe,Session,callService} from './deps/archived-v6-host.mjs';
import {saveChampionPlan,armContinuation} from '../src/plans.mjs';
import {planView,reconcile,armStep,continuationCandidate,publicFacts,repairTasks} from '../src/execution.mjs';
const identity={coachId:'hopeful-2-5-s4-37u-c-unified',version:'2.5.0-test.s4.37u.c',contextSchema:'hopeful-context/2.5-s4.37u.c'};
const move=(playerId,x,y)=>({kind:'playerAction',playerId,action:'move',path:[{kind:'step',to:{x,y}}]});
function fixture(){
 const state=E.buildScenario({teams:{A:'human',B:'human'},players:[
  {id:'carrier',team:'A',roster:'human',position:'lineman',at:[8,7],number:1},
  {id:'helper',team:'A',roster:'human',position:'lineman',at:[8,5],number:2},
  {id:'foe',team:'B',roster:'human',position:'lineman',at:[23,2],number:1}],ball:{holder:'carrier'}},13);
 const session=new Session(state,'A',1,60000),o=observe(state,'A',1),first=move('helper',9,5),second=move('carrier',9,7);
 const ex=callService(session,'explore',[first,{observations:true,decisions:'builtin',maxMs:500}]);
 const future=callService(session,'explore',[second,{from:ex.outcomes[0].key,observations:true,decisions:'builtin',maxMs:500}]);
 // Deliberately large synthetic deep predictions test persistence semantics only.
 // They never decide the action, never enter the engine, and never serve as new
 // probability evidence. The current frontier and actual execution are real.
 const deep={...future,outcomes:Array.from({length:24},(_,i)=>{const b=structuredClone(future.outcomes[0]);
  b.p=1/24;b.observation.players.find(p=>p.id==='foe').pos={x:15+i%8,y:Math.floor(i/8)};return b;})};
 const goal={id:'advance-with-protection',kind:'stabilize-possession',target:'carrier'};
 const selected={input:first,ex,goal,preparedBranches:new Map([[ex.outcomes[0].key,{plan:{input:second},ex:deep}]])};
 let saved;
 for(let maxBytes=1500;maxBytes<=7500;maxBytes+=50){const x=saveChampionPlan(o,selected,identity,maxBytes);
  if(x.plan&&x.representation==='rolling-exact-frontier'){saved=x;break;}}
 assert.ok(saved,'fixture must exercise real capacity fallback');
 const actual=E.execute(state,first);assert.equal(actual.status,'completed');
 const after=observe(actual.state,'A',2),current=new Session(actual.state,'A',2,60000);
 const services={validate:async(...args)=>callService(current,'validate',args)};
 const fresh=callService(current,'explore',[second,{observations:true,decisions:'builtin',maxMs:500}]);
 return {state,o,first,second,ex,future,selected,saved,actual,after,services,fresh};
}
test('rolling frontier retains actual current branch and obligation, never the large deeper prediction',()=>{
 const f=fixture(),view=planView(f.saved.plan);
 assert.equal(view.frontier,true);assert.equal(view.tasks[0].retainedSuccessMass,1);
 assert.deepEqual(view.edges,[{from:0,to:1,mass:1}]);
 assert.equal(view.tasks[1].expansion,'required');assert.equal(view.tasks[1].retainedSuccessMass,0);
 assert.equal(view.tasks[1].outcomeMassUnknown,1);assert.ok(Buffer.byteLength(JSON.stringify(f.saved.plan))<=f.saved.plan.maxBytes);
 const advanced=reconcile(f.saved.plan,f.after,{identity});
 assert.equal(advanced.status,'candidate-ready');assert.equal(advanced.candidate.requiresExpansion,true);
 assert.deepEqual(advanced.candidate.input,f.second);assert.equal(advanced.plan.id,f.saved.plan.id);
 assert.equal(advanced.plan.completedCount,1);assert.equal(advanced.inputConfirmed,false);assert.equal(advanced.sourceConfirmed,false);
 assert.equal(armStep(advanced.plan,f.after,f.second).reason,'frontier-requires-current-expansion');
});
test('fresh real expansion preserves obligation identity, executes, and retires on actual final outcome',async()=>{
 const f=fixture(),r=await continuationCandidate(f.saved.plan,f.after,f.services,{identity});
 assert.equal(r.candidate.validated,true);assert.equal(r.candidate.requiresExpansion,true);
 const armed=armContinuation(r.plan,f.after,{input:f.second,ex:f.fresh},identity);
 assert.ok(armed.plan,armed.reason);assert.equal(armed.reason,'frontier-expanded-from-current-evidence');
 assert.equal(armed.plan.id,f.saved.plan.id);assert.equal(armed.plan.completedCount,1);
 assert.equal(planView(armed.plan).frontier,false);assert.equal(planView(armed.plan).activeTask.retainedSuccessMass,1);
 const actual=E.execute(f.actual.state,f.second);assert.equal(actual.status,'completed');
 assert.equal(reconcile(armed.plan,observe(actual.state,'A',3),{identity}).reason,'planned-final-public-outcome');
 // Replaying an unexecuted same request cannot consume an already armed prefix.
 assert.equal(reconcile(armed.plan,f.after,{identity}).reason,'revision-did-not-advance');
});
test('frontier cannot arm on missing/partial evidence, stale facts, changed identity, or different input',()=>{
 const f=fixture(),r=reconcile(f.saved.plan,f.after,{identity});
 for(const ex of [null,{...f.fresh,unresolvedMass:.2},{...f.fresh,outcomes:[]}]){
  assert.equal(armContinuation(r.plan,f.after,{input:f.second,ex},identity).plan,null);
 }
 const changed=structuredClone(f.after);changed.teams.A.rerolls++;
 assert.equal(armContinuation(r.plan,changed,{input:f.second,ex:f.fresh},identity).reason,'frontier-current-guard-not-matched');
 assert.equal(armContinuation(r.plan,f.after,{input:f.second,ex:f.fresh},{...identity,version:'other'}).plan,null);
 assert.equal(armContinuation(r.plan,f.after,{input:f.first,ex:f.fresh},identity).reason,'different-choice');
});
test('rolling frontier preserves every current-action branch and invalidates unretained material outcomes',()=>{
 const f=fixture(),alternate=structuredClone(f.ex.outcomes[0]);alternate.p=.4;
 alternate.observation.teams.A.rerolls--;const primary={...f.ex.outcomes[0],p:.6};
 const chosen={...f.selected,ex:{...f.ex,outcomes:[primary,alternate]}};
 // Both guards lead to the same exact input, but carry different actual facts.
 let saved;for(let cap=1500;cap<7500;cap+=50){const x=saveChampionPlan(f.o,chosen,identity,cap);if(x.plan&&x.representation==='rolling-exact-frontier'){saved=x;break;}}
 assert.ok(saved);assert.deepEqual(planView(saved.plan).edges.map(e=>e.mass),[.6,.4]);
 for(const changed of [false,true]){const after=structuredClone(f.after);if(changed)after.teams.A.rerolls--;
  const r=reconcile(saved.plan,after,{identity});assert.equal(r.status,'candidate-ready');
  assert.deepEqual(r.candidate.input,f.second);assert.equal(r.candidate.requiresExpansion,true);}
 const wrong=structuredClone(f.after);wrong.ball={kind:'ground',pos:{x:9,y:7}};
 assert.equal(reconcile(saved.plan,wrong,{identity}).reason,'unretained-or-changed-public-outcome');
});
test('five priced root outcomes cannot disappear behind the exact-graph node cap',()=>{
 const f=fixture(),outcomes=Array.from({length:5},(_,i)=>{const b=structuredClone(f.ex.outcomes[0]);
  b.p=.2;b.key='synthetic-branch-'+i;b.observation.players.find(p=>p.id==='foe').pos.y=2+i;return b;});
 const selected={input:f.first,ex:{...f.ex,outcomes},preparedBranches:new Map(outcomes.map(b=>[b.key,{plan:{input:f.second},ex:f.future}]))};
 const saved=saveChampionPlan(f.o,selected,identity,7500);assert.ok(saved.plan,saved.reason);
 const view=planView(saved.plan);assert.equal(view.frontier,true);assert.equal(view.edges.length,5);
 assert.equal(view.tasks[0].retainedSuccessMass,1);assert.equal(view.tasks[0].unretainedOutcomeMass,0);
 assert.equal(view.tasks.length,2,'identical inputs share only the re-expansion obligation');
 for(const b of outcomes){const actual=structuredClone(f.after);actual.players.find(p=>p.id==='foe').pos.y=b.observation.players.find(p=>p.id==='foe').pos.y;
  assert.equal(reconcile(saved.plan,actual,{identity}).status,'candidate-ready');}
 // Five distinct obligations exceed the declared bounded graph, so reject
 // atomically rather than retain four while silently dropping priced branches.
 selected.preparedBranches=new Map(outcomes.map((b,i)=>[b.key,{plan:{input:move('carrier',9,3+i)},ex:f.future}]));
 const rejected=saveChampionPlan(f.o,selected,identity,7500);
 assert.equal(rejected.plan,null);assert.equal(rejected.reason,'too-many-frontier-obligations');
});

test('full graph and frontier keep the semantic goal after prefix consumption and fresh expansion',()=>{
 const f=fixture(),goal=f.selected.goal;
 const full=saveChampionPlan(f.o,{...f.selected,preparedBranches:new Map([[f.ex.outcomes[0].key,{plan:{input:f.second},ex:f.future}]])},identity);
 assert.ok(full.plan);assert.deepEqual(planView(full.plan).tasks[1].goal,goal);
 assert.deepEqual(planView(f.saved.plan).tasks[1].goal,goal);
 const advanced=reconcile(f.saved.plan,f.after,{identity});
 assert.deepEqual(planView(advanced.plan).activeTask.goal,goal);
 const armed=armContinuation(advanced.plan,f.after,{input:f.second,ex:f.fresh},identity);
 assert.ok(armed.plan);assert.deepEqual(planView(armed.plan).activeTask.goal,goal);
 assert.equal(armed.plan.completedCount,1);assert.deepEqual(planView(armed.plan).tasks[0].actor,'carrier');
});
test('unrelated changed facts offer only fresh semantic repair; changed possession or scope retires it',()=>{
 const f=fixture(),changed=structuredClone(f.after);changed.players.find(p=>p.id==='foe').pos.y++;
 const review=reconcile(f.saved.plan,changed,{identity});assert.equal(review.status,'invalidated');
 const templates=repairTasks(f.saved.plan,changed,review,identity);
 assert.equal(templates.length,1);assert.deepEqual(templates[0].input,f.second);
 assert.deepEqual(templates[0].goal,f.selected.goal);assert.equal(templates[0].requiresFreshEvaluation,true);
 assert.ok(templates.every(t=>!('ex' in t)&&!('key' in t)&&!('guard' in t)));
 changed.ball={kind:'held',playerId:'foe'};assert.equal(repairTasks(f.saved.plan,changed,review,identity).length,0);
 changed.ball=f.after.ball;changed.drive++;assert.equal(repairTasks(f.saved.plan,changed,review,identity).length,0);
});
