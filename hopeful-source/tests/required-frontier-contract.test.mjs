import test from 'node:test';import assert from 'node:assert/strict';
import {E,observe,Session,callService} from './deps/archived-v6-host.mjs';
import {saveChampionPlan,armContinuation,armAuditedContinuation} from '../src/plans.mjs';
import {planView,reconcile,ruleMapFor,storeRuleMaps,armStep} from '../src/execution.mjs';
const identity={coachId:'required-frontier',version:'1',contextSchema:'required-frontier'};
const move=(playerId,x,y)=>({kind:'playerAction',playerId,action:'move',path:[{kind:'step',to:{x,y}}]});
function fixture(){
 const state=E.buildScenario({teams:{A:'human',B:'human'},players:[{id:'carrier',team:'A',roster:'human',position:'lineman',at:[8,7],number:1},{id:'helper',team:'A',roster:'human',position:'lineman',at:[8,5],number:2},{id:'foe',team:'B',roster:'human',position:'lineman',at:[23,2],number:1}],ball:{holder:'carrier'}},13);
 const o=observe(state,'A',1),session=new Session(state,'A',1,60000),first=move('helper',9,5),second=move('carrier',9,7);
 const ex=callService(session,'explore',[first,{observations:true,decisions:'builtin',maxMs:500}]);
 const future=callService(session,'explore',[second,{from:ex.outcomes[0].key,observations:true,decisions:'builtin',maxMs:500}]);
 // Only persistence stress guards differ. These are not game/probability labels.
 const outcomes=Array.from({length:5},(_,i)=>{const b=structuredClone(ex.outcomes[0]);b.p=.2;b.key='synthetic-'+i;b.observation.players.find(p=>p.id==='foe').pos.y=2+i;return b;});
 const child={plan:{input:second},ex:future,ruleMap:{input:second,offers:[]},preparedBranches:new Map()};
 const selected={input:first,ex:{...ex,outcomes},ruleMap:{input:first,offers:[]},requireRuleMaps:true,preparedBranches:new Map(outcomes.map(b=>[b.key,child]))};
 const saved=saveChampionPlan(o,selected,identity);assert.ok(saved.plan,saved.reason);
 const actual=E.execute(state,first);const after=observe(actual.state,'A',2),r=reconcile(saved.plan,after,{identity});assert.equal(r.status,'candidate-ready');
 const fresh=callService(new Session(actual.state,'A',2,60000),'explore',[second,{observations:true,decisions:'builtin',maxMs:500}]);
 return {o,first,second,selected,saved,after,r,fresh};
}
test('required builtin maps permit a shared unknown frontier without losing any priced immediate branch',()=>{
 const f=fixture(),v=planView(f.saved.plan);assert.equal(v.tasks.length,2);assert.equal(v.edges.length,5);assert.equal(v.tasks[0].retainedSuccessMass,1);assert.equal(v.tasks[1].outcomeMassUnknown,1);assert.equal(ruleMapFor(f.saved.plan,1),null);assert.deepEqual(ruleMapFor(f.saved.plan,0),f.selected.ruleMap);
 assert.equal(armStep(f.r.plan,f.after,f.second).reason,'frontier-requires-current-expansion');
 assert.equal(armContinuation(f.r.plan,f.after,{input:f.second,ex:f.fresh},identity).reason,'frontier-current-rule-map-required');
});
test('nullable maps are restricted to unexpanded future nodes; schema and root corruption are rejected',()=>{
 const f=fixture();for(const mode of ['root-null','old-schema','wrong-input']){const plan=structuredClone(f.saved.plan);if(mode==='root-null')plan.ruleMaps=storeRuleMaps([null,null]);if(mode==='old-schema')plan.schema='hopeful-execution/5';if(mode==='wrong-input')plan.ruleMaps=storeRuleMaps([{input:f.second,offers:[]},null]);assert.equal(planView(plan),null,mode);}
});
test('overflow cannot hide a missing priced map, a dependency cycle, or five distinct obligations',()=>{
 const f=fixture(),firstChild=f.selected.preparedBranches.values().next().value;
 delete firstChild.ruleMap;assert.equal(saveChampionPlan(f.o,f.selected,identity).reason,'required-builtin-rule-map-missing');firstChild.ruleMap={input:f.second,offers:[]};
 firstChild.preparedBranches.set(firstChild.ex.outcomes[0].key,firstChild);assert.equal(saveChampionPlan(f.o,f.selected,identity).plan,null);firstChild.preparedBranches.clear();
 f.selected.preparedBranches=new Map(f.selected.ex.outcomes.map((b,i)=>{const input=move('carrier',9,3+i);return [b.key,{plan:{input},ex:f.fresh,ruleMap:{input,offers:[]}}];}));assert.equal(saveChampionPlan(f.o,f.selected,identity).reason,'too-many-frontier-obligations');
});
test('fresh continuation audits live rules once; incomplete audit and stale facts cannot execute',async()=>{
 const f=fixture();let calls=0;
 const services={fork:{open:async q=>{calls++;return {ok:true,revisionBound:true,from:q.from,fork:'current',node:'terminal',position:'current-terminal',completed:true,turnover:false};},close:async()=>({ok:true}),step:async()=>{throw Error('no decision in fixture');}}};
 const current={input:f.second,ex:f.fresh};const armed=await armAuditedContinuation(f.r.plan,f.after,current,identity,services,Date.now()+1000);assert.ok(armed.plan,armed.reason);assert.equal(calls,1);assert.equal(armed.selected.requireRuleMaps,true);assert.deepEqual(ruleMapFor(armed.plan),{input:f.second,offers:[]});assert.equal(planView(armed.plan).frontier,false);
 services.fork.open=async()=>{calls++;return {ok:false};};assert.equal((await armAuditedContinuation(f.r.plan,f.after,current,identity,services,Date.now()+1000)).reason,'frontier-current-rule-audit-incomplete');
 const changed=structuredClone(f.after);changed.teams.A.rerolls++;const at=calls;assert.equal((await armAuditedContinuation(f.r.plan,changed,current,identity,services,Date.now()+1000)).reason,'frontier-current-guard-not-matched');assert.equal(calls,at);
});
