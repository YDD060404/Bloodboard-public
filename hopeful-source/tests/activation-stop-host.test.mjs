import test from 'node:test';
import assert from 'node:assert/strict';
import {E,observe,Session,callService} from './deps/archived-v6-host.mjs';
import {verifiedFixture} from '../scripts/test-deps.mjs';
import {createChampion} from '../src/champion.mjs';
import {saveChampionPlan} from '../src/plans.mjs';
import {planView,reconcile,publicFacts} from '../src/execution.mjs';
import {challengeCompletedActivation,challengeContinuation} from '../src/continuation.mjs';
const inspect=createChampion().inspector,identity={coachId:'hopeful-2-5-s4-37u-c-unified',version:'2.5.0-test.s4.37u.c',contextSchema:'hopeful-context/2.5-s4.37u.c'};
const options={observations:true,decisions:'builtin',maxOutcomes:128,maxKeep:256,maxLeaves:12000,threshold:.000001,maxMs:1200};
const a=JSON.parse(verifiedFixture('new-match-p0002-L2-step153.json')),
 b=JSON.parse(verifiedFixture('new-match-p0002-L2-step154.json'));
function services(s,id){const session=new Session(s,'B',id,60000),sv={};for(const m of ['explore','candidates','validate','sequence'])sv[m]=async(...args)=>callService(session,m,args);
 sv.threats={scoring:async q=>callService(session,'threats.scoring',[q]),blitz:async q=>callService(session,'threats.blitz',[q])};return sv;}
async function fixture(){
 const before=observe(a.state,'B',1),sv1=services(a.state,1),input=a.decision.selected.input,ex=await sv1.explore(input,options);
 const saved=saveChampionPlan(before,{input,ex},identity);assert.ok(saved.plan,saved.reason);
 const actual=E.execute(a.state,input);assert.equal(actual.status,'completed');
 const o=observe(actual.state,'B',2);assert.deepEqual(publicFacts(o),publicFacts(observe(b.state,'B',2)));
 assert.equal(reconcile(saved.plan,o).status,'completed');
 const sv=services(actual.state,2),selectedInput=b.decision.selected.input,selectedEx=await sv.explore(selectedInput,options);
 assert.ok(selectedEx.ok);assert.ok(selectedEx.pTurnover>.074&&selectedEx.pTurnover<.075);
 return {o,sv,task:planView(saved.plan).activeTask,snapshot:{mode:'normal',selected:{...inspect.canonical({input:selectedInput},o),ex:selectedEx},lines:[]}};
}
test('latest real match: completed goal receives fair reply opportunity; historical positive is not forced through new harm',async()=>{
 const f=await fixture(),r=await challengeCompletedActivation(f.o,f.snapshot,f.task,f.sv,inspect,Date.now()+12000);
 assert.equal(r.budget.allocation,'round-robin-current-policy-branches');
 assert.deepEqual(r.budget.scheduled.slice(0,2).map(j=>j.policy),[0,1]);
 assert.equal(r.policies.length,2);assert.ok(r.policies.every(p=>p.observedReplyMass>0),'neither policy is starved to zero');
 if(r.selected){assert.deepEqual(r.selected.input,{kind:'endActivation'});assert.ok(r.evidence.effectiveGain>r.evidence.margin);
  assert.ok(r.evidence.replyBasis.criticalDelta>=0);assert.equal(r.evidence.matchedReplyMass,true);}
 else assert.ok(!r.evidence.eligible||!r.evidence.matchedReplyMass,'decline preserves unmatched or adverse current evidence');
 assert.ok(r.evidence.replyBasis.delta<=0,'partial reply coverage grants no positive safety credit');

});
test('activation stopping requires actual completed task, same actor, current activation and ordinary selection',async()=>{
 const f=await fixture();
 for(const [o,snapshot,task] of [[f.o,f.snapshot,null],[f.o,f.snapshot,{...f.task,actor:'other'}],
  [{...f.o,activation:null},f.snapshot,f.task],[f.o,{...f.snapshot,mode:'certain-td'},f.task]]){
  const r=await challengeCompletedActivation(o,snapshot,task,f.sv,inspect,Date.now()+12000);assert.equal(r.attempted,false);assert.equal(r.selected,null);
 }
});

test('real completed protection goal stops rather than taking unnecessary Rushes; reverse comparison cannot force them',async()=>{
 const state=E.buildScenario({teams:{A:'human',B:'human'},players:[
  {id:'helper',team:'A',roster:'human',position:'lineman',at:[2,5],number:1},
  {id:'carrier',team:'A',roster:'human',position:'lineman',at:[8,7],number:2},
  {id:'foe',team:'B',roster:'human',position:'lineman',at:[23,14],number:1}],ball:{holder:'carrier'}},13);
 const first={kind:'playerAction',playerId:'helper',action:'move',path:Array.from({length:6},(_,i)=>({kind:'step',to:{x:3+i,y:5}}))};
 const make=(s,id)=>{const session=new Session(s,'A',id,60000),sv={};for(const m of ['explore','candidates','validate','sequence'])sv[m]=async(...a)=>callService(session,m,a);
  sv.threats={scoring:async(...a)=>callService(session,'threats.scoring',a),blitz:async(...a)=>callService(session,'threats.blitz',a)};return sv;};
 const sv=make(state,1),before=observe(state,'A',1),ex=await sv.explore(first,options),saved=saveChampionPlan(before,{input:first,ex},identity);
 const actual=E.execute(state,first);assert.equal(actual.status,'completed');const o=observe(actual.state,'A',2);assert.equal(reconcile(saved.plan,o).status,'completed');
 const current=make(actual.state,2),input={kind:'playerAction',playerId:'helper',action:'move',path:[{kind:'step',to:{x:9,y:5}},{kind:'step',to:{x:10,y:5}}]},risk=await current.explore(input,options);
 assert.ok(risk.pTurnover>.074&&risk.pTurnover<.075);
 const chosen=await challengeCompletedActivation(o,{mode:'normal',selected:{...inspect.canonical({input},o),ex:risk},lines:[]},planView(saved.plan).activeTask,current,inspect,Date.now()+12000);
 assert.deepEqual(chosen.selected?.input,{kind:'endActivation'});assert.equal(chosen.evidence.matchedReplyMass,true);assert.ok(chosen.evidence.effectiveGain>chosen.evidence.margin);
 const stop={kind:'endActivation'},stopEx=await current.explore(stop,options),reverse=await challengeContinuation(o,{mode:'normal',selected:{...inspect.canonical({input:stop},o),ex:stopEx},lines:[]},{input,validated:true},current,inspect,Date.now()+12000);
 assert.equal(reverse.selected,null);assert.equal(reverse.evidence.matchedReplyMass,true);
 assert.deepEqual(reverse.budget.scheduled.slice(0,2).map(j=>j.policy),[0,1]);
});
