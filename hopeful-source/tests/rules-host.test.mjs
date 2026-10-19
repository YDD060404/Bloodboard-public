import test from 'node:test';
import assert from 'node:assert/strict';
import {E,observe,Session,callService} from './deps/archived-v6-host.mjs';
import {sharedRuleChoice,auditSharedRule,certifiedRuleChoice,SHARED_RULE_POLICY} from '../src/rules.mjs';
import {saveChampionPlan} from '../src/plans.mjs';
import {requestServices} from '../src/services.mjs';
const identity={coachId:'hopeful-2-5-s4-37u-c-unified',version:'2.5.0-test.s4.37u.c',contextSchema:'hopeful-context/2.5-s4.37u.c'};
const input={kind:'playerAction',playerId:'dodger',action:'move',path:[{kind:'step',to:{x:9,y:6}}]};
function fixture(seed=7){
 const state=E.buildScenario({teams:{A:'human',B:'human'},players:[
  {id:'dodger',team:'A',roster:'human',position:'catcher',at:[8,7],number:1},
  {id:'carrier',team:'A',roster:'human',position:'lineman',at:[3,3],number:2},
  {id:'foe',team:'B',roster:'human',position:'lineman',at:[8,8],number:1}],ball:{holder:'carrier'}},seed);
 const o=observe(state,'A',1),session=new Session(state,'A',1,60000),opened=new Set(),closed=new Set(),sv={
  explore:async(...a)=>callService(session,'explore',a),fork:{}};
 for(const m of ['open','step','close'])sv.fork[m]=async(...a)=>{const r=callService(session,'fork.'+m,a);
  if(r.fork)opened.add(r.fork);if(m==='close')closed.add(a[0].fork);return r;};
 return {state,o,sv,opened,closed};
}
test('same free-skill policy matches all real fork decisions and the actual pending rule offer',async()=>{
 const f=fixture(),adapter=requestServices(f.sv,{deadline:Date.now()+10000}),audit=await auditSharedRule(f.o,input,adapter.services,Date.now()+10000);
 assert.equal(audit.agreement,true,JSON.stringify(audit));assert.equal(audit.complete,true);assert.ok(audit.decisions.length);
 assert.ok(audit.decisions.every(d=>d.option==='skill'&&d.builtin==='skill'));assert.ok(Math.abs(audit.terminalMass-1)<1e-8);
 assert.deepEqual([...f.opened].sort(),[...f.closed].sort());
 assert.ok(adapter.snapshot().byMethod['fork.open']);assert.ok(adapter.snapshot().byMethod['fork.step']);assert.ok(adapter.snapshot().byMethod['fork.close']);
 const ex=await f.sv.explore(input,{observations:true,decisions:'builtin',maxOutcomes:128,maxLeaves:5000,maxMs:1000}),saved=saveChampionPlan(f.o,{input,ex},identity);
 assert.ok(saved.plan);saved.plan.rulePolicy={policy:SHARED_RULE_POLICY,agreement:true,actor:'dodger',action:'move'};
 const actual=E.execute(f.state,input);assert.ok(actual.state.pending);const pending=observe(actual.state,'A',2),request=actual.state.pending.request;
 const choice=certifiedRuleChoice(pending,request,saved.plan);assert.equal(choice?.optionId,'skill');
 assert.equal(choice.optionId,sharedRuleChoice(request,'A').optionId);
 const next=E.decide(actual.state,{requestId:request.id,optionId:choice.optionId});assert.notEqual(next.status,'illegal');
 assert.equal(next.state.teams.A.rerolls,f.state.teams.A.rerolls,'free skill does not spend team reroll');
});
test('low budget, unsupported type, and divergence never certify builtin probability equivalence',async()=>{
 const f=fixture();const short=await auditSharedRule(f.o,input,f.sv,Date.now()+10000,{maxCalls:1});
 assert.equal(short.complete,false);assert.equal(short.agreement,false);assert.equal(short.unknownMass,1);
 assert.equal(sharedRuleChoice({type:'pushSquare',team:'A',options:[{id:'skill',label:'Re-roll with Dodge'},{id:'none',label:'Turnover'}]},'A'),null);
 assert.equal(sharedRuleChoice({type:'reroll',team:'A',options:[{id:'team',label:'Team Reroll'},{id:'none',label:'Turnover'}]},'A'),null);
 const altered=fixture(),step=altered.sv.fork.step;altered.sv.fork.step=async(...args)=>{const n=await step(...args);return n.node==='decision'?{...n,defaultBranch:n.branches.findIndex(b=>b.id==='none')}:n;};
 const divergent=await auditSharedRule(altered.o,input,altered.sv,Date.now()+10000);
 assert.equal(divergent.agreement,false);assert.ok(divergent.divergentMass>0);assert.ok(divergent.unknownMass>0);
});
test('changed offer, actor, owner or scope never uses a stale policy commitment',async()=>{
 const f=fixture(),ex=await f.sv.explore(input,{observations:true,maxMs:1000}),saved=saveChampionPlan(f.o,{input,ex},identity);
 saved.plan.rulePolicy={policy:SHARED_RULE_POLICY,agreement:true,actor:'dodger',action:'move'};
 const state=E.execute(f.state,input).state,o=observe(state,'A',2),request=state.pending.request;
 for(const [ob,req] of [[{...o,drive:o.drive+1},request],[{...o,activation:{...o.activation,playerId:'carrier'}},request],
  [o,{...request,team:'B'}],[o,{...request,options:request.options.filter(x=>x.id!=='skill')}],
  [o,{...request,options:request.options.map(x=>x.id==='skill'?{...x,label:'Use Pro'}:x)}]])
  assert.equal(certifiedRuleChoice(ob,req,saved.plan),null);
});
test('fork service waits obey the shared request deadline',async()=>{
 const a=requestServices({fork:{open:async()=>new Promise(()=>{})}},{deadline:Date.now()+100});
 const r=await a.services.fork.open({});assert.equal(r.code,'coach-deadline');
 assert.equal(a.snapshot().deadlineTimeouts,1);assert.equal(a.snapshot().byMethod['fork.open'].rpcCalls,1);
});
