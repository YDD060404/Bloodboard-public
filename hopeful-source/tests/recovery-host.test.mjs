import test from 'node:test';
import assert from 'node:assert/strict';
import {E,observe,Session,callService} from './deps/archived-v6-host.mjs';
import {bindRecoveryObligations} from '../src/recoveries.mjs';
import {saveChampionPlan} from '../src/plans.mjs';
import {planView,reconcile,armStep} from '../src/execution.mjs';
const identity={coachId:'hopeful-2-5-s4-37u-c-unified',version:'2.5.0-test.s4.37u.c',contextSchema:'hopeful-context/2.5-s4.37u.c'};
const move=(playerId,x,y)=>({kind:'playerAction',playerId,action:'move',path:[{kind:'step',to:{x,y}}]});
async function fixture(){
 const state=E.buildScenario({teams:{A:'human',B:'human'},players:[
 {id:'first',team:'A',roster:'human',position:'lineman',at:[8,5],number:1},
 {id:'second',team:'A',roster:'human',position:'lineman',at:[8,9],number:2},
 {id:'recovery',team:'A',roster:'human',position:'thrower',at:[8,7],number:3},
 {id:'foe',team:'B',roster:'human',position:'lineman',at:[23,2],number:1}],ball:{at:[9,7]}},13);
 const session=new Session(state,'A',1,60000),o=observe(state,'A',1),services={};
 for(const m of ['explore','validate'])services[m]=async(...a)=>callService(session,m,a);
 const first=move('first',9,5),second=move('second',9,9),third=move('recovery',9,7),opts={observations:true,decisions:'builtin',maxOutcomes:40,maxLeaves:3500,threshold:.00001,maxMs:600};
 const root=await services.explore(first,opts),follow=await services.explore(second,{...opts,from:root.outcomes[0].key});
 // This explicit goal proposal isolates binding/persistence; it is not evidence
 // that the natural chooser priced this particular three-person move sequence.
 const selected={input:first,ex:root,preparedBranches:new Map([[root.outcomes[0].key,{plan:{input:second,
  recovery:{plans:[{ball:{x:9,y:7},input:third}]}},ex:follow}]])};
 return {state,o,first,second,third,selected,services,root,follow};
}
test('recovery binding requires repaired state identity, fresh branch validation and complete current exploration',async()=>{
 const f=await fixture(),result=await bindRecoveryObligations(f.o,f.selected,f.services,Date.now()+3000);
 if(f.root.outcomeIdentity!=='complete-state-v1'){
  assert.equal(result.bound,0);assert.ok(result.unbound>0);return;
 }
 assert.equal(result.bound,1);assert.equal(result.unbound,0);assert.equal(f.selected.preparedBranches.values().next().value.preparedBranches,undefined,'frozen selected evidence is not mutated');
 const saved=saveChampionPlan(f.o,result.selected,identity);assert.ok(saved.plan,saved.reason);const view=planView(saved.plan);
 assert.equal(view.tasks.length,3);assert.deepEqual(view.edges.map(e=>[e.from,e.to]),[[0,1],[1,2]]);
 const one=E.execute(f.state,f.first);assert.equal(one.status,'completed');const r1=reconcile(saved.plan,observe(one.state,'A',2),{identity});assert.deepEqual(r1.candidate.input,f.second);
 const armed=armStep(r1.plan,observe(one.state,'A',2),f.second);assert.ok(armed.plan);
 const two=E.execute(one.state,f.second);assert.equal(two.status,'completed');const r2=reconcile(armed.plan,observe(two.state,'A',3),{identity});assert.deepEqual(r2.candidate.input,f.third);
 assert.equal(r2.plan.completedCount,2);assert.equal(r2.plan.id,saved.plan.id);
});
test('unrelated or illegal recovery proposal cannot bind a stale third actor',async()=>{
 const f=await fixture(),follow=f.selected.preparedBranches.values().next().value;
 follow.plan.recovery.plans[0].input=move('first',10,5); // Actor already finished before this branch.
 const r=await bindRecoveryObligations(f.o,f.selected,f.services,Date.now()+3000);assert.equal(r.bound,0);assert.ok(r.unbound>0);
 follow.plan.recovery.plans[0].ball={x:1,y:1};
 const other=await bindRecoveryObligations(f.o,f.selected,f.services,Date.now()+3000);assert.equal(other.bound,0);
});
