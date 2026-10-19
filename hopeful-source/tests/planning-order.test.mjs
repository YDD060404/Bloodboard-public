import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {E,observe,Session,callService} from './deps/archived-v6-host.mjs';
import {createChampion} from '../src/champion.mjs';
import {saveChampionPlan} from '../src/plans.mjs';
const inspect=createChampion().inspector,identity={coachId:'hopeful-2-5-s4-37u-c-unified',version:'2.5.0-test.s4.37u.c',contextSchema:'hopeful-context/2.5-s4.37u.c'};
const data=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
// Tactical modules are controlled only to prove ordering/budget preservation.
// The old plan is real engine-generated/executed, and production index runs.
const mocks={
 './champion.mjs':`import {createChampion as real} from ${JSON.stringify(new URL('../src/champion.mjs',import.meta.url).href)};
 export function createChampion(options={}){return {inspector:real().inspector,async chooseAction(o,n,s){s.calls.push('champion');options.onSelected?.(s.snapshot);return s.answer;},async chooseDecision(){return null;},chooseSetup(){return null;}};}`,
 './endguard.mjs':`export async function challengeEnd(o,s,n,sv){return sv.stage('end');}`,
 './relay.mjs':`export async function challengeRelay(o,s,sv){return sv.stage('relay');}`,
 './defense.mjs':`export async function reserveDefenseTerminals(){return {attempted:false};}
 export async function captureDefenseTerminal(){}\nexport async function challengeDefense(o,s,n,sv){return sv.stage('defense');}`,
 './continuation.mjs':`export async function challengeContinuation(o,s,p,sv){return sv.stage('continuation');}
 export async function challengeCompletedActivation(o,s,p,sv){return sv.stage('activationCompletion');}`
};
let source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
source=source.replaceAll(/from '(\.\/[^']+)'/g,(_,rel)=>'from '+JSON.stringify(mocks[rel]?data(mocks[rel]):new URL('../src/'+rel.slice(2),import.meta.url).href));
globalThis.bloodboard={register(){}};const {chooseAction}=await import(data(source));delete globalThis.bloodboard;
const input=(id,x,y)=>({kind:'playerAction',playerId:id,action:'move',path:[{kind:'step',to:{x,y}}]});
async function fixture(kind){
 const s=E.buildScenario({teams:{A:'human',B:'human'},players:[
 {id:'carrier',team:'A',roster:'human',position:'lineman',at:[8,7],number:1},
 {id:'helper',team:'A',roster:'human',position:'lineman',at:[8,5],number:2},
 {id:'foe',team:'B',roster:'human',position:'lineman',at:[1,14],number:1}],ball:{holder:'carrier'}},13);
 const first=input('helper',9,5),second=input('carrier',9,7),session=new Session(s,'A',1,60000),o=observe(s,'A',1);
 const explore=(i,from)=>callService(session,'explore',[i,{...(from?{from}:{}),observations:true,decisions:'builtin',maxOutcomes:40,maxMs:500}]);
 const ex=explore(first),follow=explore(second,ex.outcomes[0].key),prepared=new Map([[ex.outcomes[0].key,{plan:{input:second},ex:follow}]]);
 const saved=saveChampionPlan(o,{input:first,ex,preparedBranches:kind==='continuation'?prepared:null},identity);assert.ok(saved.plan);
 const executed=E.execute(s,first),after=observe(executed.state,'A',2),next=new Session(executed.state,'A',2,60000);
 const result=(i)=>({...inspect.canonical({input:i},after),ex:callService(next,'explore',[i,{observations:true,decisions:'builtin',maxMs:500}]),preparedBranches:new Map()});
 const chosen=result(input('helper',10,5)),old=result({kind:'endTurn'}),newLine=result(kind==='continuation'?second:{kind:'endActivation'}),calls=[],results={};
 const sv={calls,results,stage:async(name)=>{calls.push(name);sv.onStage?.(name);return results[name]||{attempted:true,selected:null,reason:name+'-declined'};},
  snapshot:{mode:'normal',selected:chosen,lines:[chosen]},answer:{input:chosen.input,coachContext:{drivePlan:inspect.buildDrivePlan(after,null),movementMemory:[]}},
  validate:async(...args)=>callService(next,'validate',args)};
 return {o:{...after,coachContext:{schema:identity.contextSchema,champion:sv.answer.coachContext,plan:saved.plan}},sv,calls,old,newLine,chosen,kind};
}
for(const kind of ['continuation','activationCompletion'])for(const earlier of ['relay','defense'])test(`${earlier} provisional winner: later ${kind} participates but cannot replace without comparable evidence`,async()=>{
 const f=await fixture(kind);f.sv.results[earlier]={attempted:true,selected:f.old,reason:earlier+'-accepted'};
 const answer=await chooseAction(f.o,[],f.sv);assert.deepEqual(answer.input,f.chosen.input);
 assert.equal(f.calls.filter(x=>x===kind).length,1);
 assert.ok(answer.trace.planning.checks.lateProducers.some(x=>x.source===kind&&x.attempted));
 assert.equal(answer.trace.planning.checks.commonTurnPool.selected,null);
 assert.equal(answer.trace.planning.checks.lateProducers.find(x=>x.source===earlier).reason,earlier+'-accepted');
});
for(const kind of ['continuation','activationCompletion'])test(`all local proposals enter common comparison before ${kind} can replace`,async()=>{
 const f=await fixture(kind);f.sv.results[kind]={attempted:true,selected:f.newLine,reason:'new-common-margin',evidence:{eligible:true}};
 const answer=await chooseAction(f.o,[],f.sv);assert.deepEqual(answer.input,f.chosen.input);
 assert.deepEqual(f.calls,['champion','end','relay','defense',kind]);
 assert.equal(answer.trace.planning.checks.lateProducers.find(x=>x.source===kind).reason,'new-common-margin');
 assert.equal(answer.trace.planning.checks.commonTurnPool.selected,null);
});
for(const kind of ['continuation','activationCompletion'])test(`exhausted request budget keeps legal incumbent and records skipped ${kind}`,async()=>{
 const f=await fixture(kind),NativeDate=Date;f.o.timeLimitMs=120000;let now=1000;
 class Clock extends NativeDate{static now(){return now;}}
 try{globalThis.Date=Clock;f.sv.onStage=name=>{if(name==='defense')now=121000;};
  const answer=await chooseAction(f.o,[],f.sv);assert.deepEqual(answer.input,f.chosen.input);
  assert.deepEqual(f.calls,['champion','end','relay','defense']);
  assert.equal(answer.trace.planning.checks.lateProducers.find(x=>x.source===kind).reason,'shared-producer-slot-budget-unavailable');
 }finally{globalThis.Date=NativeDate;}
});
