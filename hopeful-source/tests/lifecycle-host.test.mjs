import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {E,observe,Session,callService} from './deps/archived-v6-host.mjs';
import {createChampion} from '../src/champion.mjs';
import {saveChampionPlan} from '../src/plans.mjs';
import {planView,reconcile,continuationCandidate} from '../src/execution.mjs';
import {lifecycleReview} from '../src/lifecycle.mjs';
import {challengeContinuation} from '../src/continuation.mjs';
const inspect=createChampion().inspector;
const identity={coachId:'hopeful-2-5-s4-37u-c-unified',version:'2.5.0-test.s4.37u.c',contextSchema:'hopeful-context/2.5-s4.37u.c'};
const move=(playerId,points)=>({kind:'playerAction',playerId,action:'move',path:points.map(([x,y])=>({to:{x,y},kind:'step'}))});
const helper=move('helper',[[8,5]]),advance=move('carrier',[[9,7],[10,7],[11,7],[12,7],[13,7],[14,7]]),end={kind:'endTurn'};
const options={observations:true,decisions:'builtin',maxOutcomes:40,maxKeep:256,maxLeaves:3500,threshold:.00001,maxMs:900};
function services(s,id=1){const session=new Session(s,'A',id,60000),calls=[];const sv={};
 for(const method of ['capabilities','diagnostics','explore','candidates','validate','sequence'])sv[method]=async(...args)=>{calls.push(method);return callService(session,method,args);};
 sv.fork=Object.fromEntries(['open','step','close'].map(m=>[m,async(...args)=>callService(session,'fork.'+m,args)]));
 sv.legalChoices=async(...args)=>callService(session,'legalChoices',args);
 sv.threats={scoring:async q=>callService(session,'threats.scoring',[q]),blitz:async q=>callService(session,'threats.blitz',[q])};return {sv,session,calls};}
async function graph(){
 const state=E.buildScenario({teams:{A:'human',B:'human'},players:[
  {id:'carrier',team:'A',roster:'human',position:'lineman',at:[8,7],number:1},
  {id:'helper',team:'A',roster:'human',position:'lineman',at:[7,5],number:2},
  {id:'foe',team:'B',roster:'human',position:'lineman',at:[1,14],number:1}],ball:{holder:'carrier'}},13);
 const before=observe(state,'A',1),root=services(state);
 const first=await root.sv.explore(helper,options);assert.equal(first.ok,true);assert.equal(first.outcomes.length,1);
 const follow=await root.sv.explore(advance,{...options,from:first.outcomes[0].key});assert.equal(follow.ok,true);
 const selected={...inspect.canonical({input:helper},before),ex:first,preparedBranches:new Map([[first.outcomes[0].key,{plan:{input:advance},ex:follow}]])};
 const saved=saveChampionPlan(before,selected,identity);assert.ok(saved.plan,saved.reason);
 const actual=E.execute(state,helper);assert.equal(actual.status,'completed');
 const after=observe(actual.state,'A',2),next=services(actual.state,2);
 const stopEx=await next.sv.explore(end,options);
 next.sv.snapshot={mode:'normal',selected:{...inspect.canonical({input:end},after),ex:stopEx,preparedBranches:new Map()},lines:[]};
 next.sv.answer={input:end,coachContext:{drivePlan:inspect.buildDrivePlan(after,null),movementMemory:[]}};
 return {state,before,first,follow,saved,actual,after,...next};
}
// The fresh shortlist selection is controlled to model omission; unrelated
// goal discovery is disabled so the no-context control isolates persistence. All
// legality, probability, own closure, board value, reply search and execution
// below use the unchanged archived V6 and real frozen champion inspector.
const data=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const goals=`export async function challengeRepairTasks(){return {attempted:false,selected:null,reason:'isolated-persistence-test'};}
export async function challengeGoalTasks(){return {attempted:false,selected:null,reason:'isolated-persistence-test'};}`;
const mock=`import {createChampion as real} from ${JSON.stringify(new URL('../src/champion.mjs',import.meta.url).href)};
export function createChampion(options={}){return {inspector:real().inspector,async chooseAction(o,n,s){s.order?.push('champion');options.onSelected?.(s.snapshot);return s.answer;},async chooseDecision(){return null;},chooseSetup(){return null;}};}`;
let code=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
code=code.replaceAll(/from '(\.\/[^']+)'/g,(_,rel)=>'from '+JSON.stringify(rel==='./champion.mjs'?data(mock):rel==='./goals.mjs'?data(goals):new URL('../src/'+rel.slice(2),import.meta.url).href));
globalThis.bloodboard={register(){}};const {chooseAction:chooseRawAction}=await import(data(code));
const {expandLearningTrace}=await import('../src/trace-size.mjs');
const chooseAction=async(...args)=>{const r=await chooseRawAction(...args);if(r?.trace)r.trace=expandLearningTrace(r.trace);return r;};delete globalThis.bloodboard;
function observation(g,withPlan=true){return {...g.after,coachContext:withPlan?{schema:identity.contextSchema,champion:g.sv.answer.coachContext,plan:g.saved.plan}:null};}

test('actual saved dependency wins fresh common comparison and preserves progress; no-context has no saved progress',async()=>{
 const g=await graph(),order=[];g.sv.order=order;const validate=g.sv.validate;g.sv.validate=async(...a)=>{order.push('validate');return validate(...a);};
 const answer=await chooseAction(observation(g),[],g.sv);
 assert.deepEqual(answer.input,advance);assert.equal(answer.trace.reused,true);
 assert.equal(answer.trace.selection21.challenger.reason,'strict-shared-finite-domain-winner; outside-policies-unverified');
 assert.equal(answer.coachContext.plan.id,g.saved.plan.id);assert.equal(answer.coachContext.plan.cursor,0);assert.equal(answer.coachContext.plan.completedCount,1);
 assert.deepEqual(order.slice(0,2),['validate','champion'],'actual next task is reconciled before full search');
 assert.equal(answer.trace.planning.replan.event,'expected-branch-progress');
 assert.equal(answer.trace.planning.activationContract.actor,'carrier');
 assert.equal(answer.trace.planning.activationContract.routeSteps,6);
 assert.equal(answer.trace.execution.inputConfirmed,false);assert.equal(answer.trace.execution.sourceConfirmed,false);
 const neutral=await graph(),without=await chooseAction(observation(neutral,false),[],neutral.sv);assert.equal(without.trace.reused,false);assert.equal(without.trace.execution.previousPlan,null);
 if(without.input.kind!=='endTurn'&&without.trace.execution.status!=='turn-planner-selected')assert.match(without.trace.planning.checks.commonTurnPool.reason,/strict-shared-finite-domain-winner/);
});
test('actual selected successor executes once and retires at its predicted final outcome',async()=>{
 const g=await graph(),answer=await chooseAction(observation(g),[],g.sv);
 const final=E.execute(g.actual.state,answer.input);assert.equal(final.status,'completed');
 const observed=observe(final.state,'A',3),review=reconcile(answer.coachContext.plan,observed);
 assert.equal(review.status,'completed');assert.equal(review.reason,'planned-final-public-outcome');assert.equal(review.plan,null);assert.equal(review.candidate,undefined);
});
for(const [name,change] of [
 ['unexpected ball',o=>{o.ball={kind:'ground',pos:{x:8,y:7}};}],
 ['resource spent',o=>{o.used.blitz=true;}],
 ['helper incapacity',o=>{o.players.find(p=>p.id==='helper').stance='prone';}],
 ['new team turn',o=>{o.turn.A++;}]
])test(`${name} invalidates the saved task before chooser search`,async()=>{
 const g=await graph(),o=observation(g);change(o);const answer=await chooseAction(o,[],g.sv);
 assert.equal(answer.trace.reused,false);assert.equal(answer.trace.execution.previousPlan.status,'invalidated');
 // S4.28: with the saved task invalidated, the whole-turn planner may legitimately select instead of the common pool.
 if(answer.trace.turnPlanner&&answer.trace.execution.status==='turn-planner-selected')assert.equal(answer.trace.turnPlanner.reason,'whole-turn-plan-improvement');
 else if(answer.input.kind!=='endTurn'){assert.match(answer.trace.planning.checks.commonTurnPool.reason,/strict-shared-finite-domain-winner/);assert.equal(answer.trace.execution.persisted,true);}
 assert.notEqual(answer.trace.planning.replan.event,'expected-branch-progress');
});
test('fresh special scoring selection cannot be replaced by missing saved task',async()=>{
 const g=await graph();g.sv.snapshot.mode='certain-td';const answer=await chooseAction(observation(g),[],g.sv);
 assert.deepEqual(answer.input,end);assert.equal(answer.trace.reused,false);assert.equal(answer.trace.selection21.gate.reason,'missing-current-champion-evidence');
});
test('single selected action has a real activation contract and no invented successor',async()=>{
 const g=await graph(),one=saveChampionPlan(g.before,{input:helper,ex:g.first},identity);
 assert.ok(one.plan);const view=planView(one.plan);assert.equal(view.tasks.length,1);assert.equal(view.edges.length,0);
 assert.equal(view.activeTask.destination.x,8);assert.equal(view.activeTask.action,'move');
 const r=await continuationCandidate(one.plan,g.after,g.sv);assert.equal(r.status,'completed');assert.equal(r.candidate,undefined);
});
test('turn change is a turn replan; a drive change is a drive replan',async()=>{
 const g=await graph(),drive=inspect.buildDrivePlan(g.before,null),review={status:'invalidated',reason:'scope-changed'};
 assert.equal(lifecycleReview({...g.after,turn:{...g.after.turn,A:2}},review,drive).level,'turn');
 assert.equal(lifecycleReview({...g.after,drive:g.after.drive+1},review,drive).level,'drive');
});
test('current omission rescue preserves incumbent when successor or closure loses its retained key',async()=>{
 const g=await graph(),pending=await continuationCandidate(g.saved.plan,g.after,g.sv);
 for(const stage of ['input','closure']){
  const sv={...g.sv,explore:async(i,opts)=>{const r=await g.sv.explore(i,opts);if(stage==='input'&&i.kind==='playerAction'||stage==='closure'&&i.kind==='endTurn')for(const b of r.outcomes||[])b.key=null;return r;}};
  const r=await challengeContinuation(g.after,g.sv.snapshot,pending.candidate,sv,inspect,Date.now()+8000);assert.equal(r.selected,null);
 }
});
test('a current task blocked only by unmatched horizon receives common closure reassessment, fairly beaten tasks do not',async()=>{
 const g=await graph(),pending=await continuationCandidate(g.saved.plan,g.after,g.sv);
 const snapshot={...g.sv.snapshot,lines:[{input:advance}]};
 assert.equal((await challengeContinuation(g.after,snapshot,pending.candidate,g.sv,inspect,Date.now()+8000,{reason:'champion-not-beaten'})).attempted,false);
 const r=await challengeContinuation(g.after,snapshot,pending.candidate,g.sv,inspect,Date.now()+8000,{reason:'unmatched-own-horizon'});
 assert.equal(r.attempted,true);assert.deepEqual(r.selected?.input,advance);
});
