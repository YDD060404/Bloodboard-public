import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {E,observe,Session,callService} from './deps/archived-v6-host.mjs';
// This tests real host execution + production index/context contracts. Only
// tactical selection is injected; it is not evidence of a real champion miss.
const data=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const mock=`import {createChampion as real} from ${JSON.stringify(new URL('../src/champion.mjs',import.meta.url).href)};
export function createChampion(options={}) {return {inspector:real().inspector,
 async chooseAction(o,native,s){options.onSelected?.(s.snapshot);return s.answer;},async chooseDecision(){return null;},chooseSetup(){return null;}};}`;
const team=`export async function challengeEnd(o,s,native,services){return services.teamResult||{attempted:false,selected:null};}`;
const common=`export async function compareCommonTurnPool(o,s,current,extras,services){return {attempted:true,selected:services.teamResult?.selected??null,reason:'injected-selection-for-context-contract',rows:[]};}`;
let source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
source=source.replaceAll(/from '(\.\/[^']+)'/g,(_,rel)=>'from '+JSON.stringify(rel==='./champion.mjs'?data(mock):rel==='./endguard.mjs'?data(team):rel==='./common-turn-pool.mjs'?data(common):new URL('../src/'+rel.slice(2),import.meta.url).href));
globalThis.bloodboard={register(){}};const {chooseAction}=await import(data(source));delete globalThis.bloodboard;
function state(){return E.buildScenario({teams:{A:'human',B:'human'},players:[
 {id:'carrier',team:'A',roster:'human',position:'lineman',at:[8,7],number:1},
 {id:'helper',team:'A',roster:'human',position:'lineman',at:[8,5],number:2},
 {id:'foe',team:'B',roster:'human',position:'lineman',at:[23,2],number:1}],ball:{holder:'carrier'}},13);}
const helper={kind:'playerAction',playerId:'helper',action:'move',path:[{kind:'step',to:{x:9,y:5}}]};
const carrier={kind:'playerAction',playerId:'carrier',action:'move',path:[{kind:'step',to:{x:9,y:7}}]};
function services(s,id=1){const session=new Session(s,'A',id,60000);return {
 explore:async(...a)=>callService(session,'explore',a),validate:async(...a)=>callService(session,'validate',a),
 candidates:async()=>({ok:true,candidates:[]})};}
const explore=(s,i,from)=>s.explore(i,{...(from?{from}:{}),observations:true,decisions:'builtin',maxOutcomes:20,maxMs:500});
async function fixture(){
 const s=state(),o=observe(s,'A',1),sv=services(s),end={input:{kind:'endTurn'},ex:await explore(sv,{kind:'endTurn'}),unknown:0,preparedBranches:new Map()};
 const first=await explore(sv,helper);assert.equal(first.outcomes[0].p,1);
 const second=await explore(sv,carrier,first.outcomes[0].key);assert.equal(second.outcomes[0].p,1);
 const selected={input:helper,ex:first,preparedBranches:new Map([[first.outcomes[0].key,{plan:{input:carrier},ex:second}]]),label:'Host-verified helper/carrier chain'};
 sv.snapshot={mode:'normal',selected:end,lines:[end]};sv.answer={input:end.input,coachContext:{drivePlan:{team:'A'},movementMemory:[]}};
 sv.teamResult={attempted:true,selected,reason:'injected-team-selection'};
 return {s,o,sv};
}
test('selected helper persists its exact carrier node, actual execution adopts it, and fresh identical choice completes it',async()=>{
 const {s,o,sv}=await fixture(),answer=await chooseAction(o,[],sv);
 assert.deepEqual(answer.input,helper);assert.ok(answer.coachContext.plan);
 assert.equal(answer.trace.execution.status,'selected-plan-recorded');assert.ok(JSON.stringify(answer.coachContext).length<=8192);
 const first=E.execute(s,answer.input);assert.equal(first.status,'completed');
 const next=observe(first.state,'A',2);next.coachContext=answer.coachContext;
 const current=services(first.state,2);current.snapshot={mode:'normal',selected:{input:carrier},lines:[]};
 current.answer={input:carrier,coachContext:answer.coachContext.champion};
 const continued=await chooseAction(next,[],current);assert.deepEqual(continued.input,carrier);assert.equal(continued.trace.reused,true);
 assert.equal(continued.trace.execution.previousPlan.reason,'actual-public-state-branch');
 assert.equal(continued.trace.execution.inputConfirmed,false);assert.equal(continued.trace.execution.sourceConfirmed,false);
 const second=E.execute(first.state,continued.input);assert.equal(second.status,'completed');
 assert.deepEqual(second.state.ball,{kind:'held',playerId:'carrier'});assert.deepEqual(second.state.players.find(p=>p.id==='carrier').pos,{x:9,y:7});
});
for(const [name,change] of [['possession',s=>{s.ball={kind:'ground',pos:{x:9,y:7}};}],
 ['rerolls',s=>{s.teams.A.rerolls++;}],['player position',s=>{s.players.find(p=>p.id==='foe').pos.y++;}]])test(`actual ${name} changes invalidate helper continuation before a fresh replacement`,async()=>{
 const {s,o,sv}=await fixture(),answer=await chooseAction(o,[],sv),first=E.execute(s,answer.input);change(first.state);
 const next=observe(first.state,'A',2);next.coachContext=answer.coachContext;
 const current=services(first.state,2);current.snapshot={mode:'normal',selected:{input:{kind:'endTurn'}},lines:[]};
 current.answer={input:{kind:'endTurn'},coachContext:answer.coachContext.champion};
 const r=await chooseAction(next,[],current);assert.equal(r.trace.reused,false);assert.deepEqual(r.input,{kind:'endTurn'});
 assert.equal(r.trace.execution.previousPlan.reason,'unretained-or-changed-public-outcome');
});
test('unpersistable helper/carrier plan cannot displace End',async()=>{
 const {o,sv}=await fixture();sv.answer.coachContext.extra='x'.repeat(7700);
 const r=await chooseAction(o,[],sv);assert.deepEqual(r.input,{kind:'endTurn'});assert.equal(r.coachContext.plan,null);
 assert.equal(r.trace.selection21.challenger.reason,'required-plan-does-not-fit-final-context');
});
test('final movement memory must fit together with the helper plan, or End remains selected',async()=>{
 let sawFull=false,sawRejected=false;
 // Several boundary envelopes establish that no selected helper loses its
 // sidecar during final movement-memory/stats serialization.
 for(const extra of [0,3000,4000,5000,6000]){
  const {o,sv}=await fixture();sv.answer.coachContext.extra='x'.repeat(extra);
  const r=await chooseAction(o,[],sv);
  assert.ok(new TextEncoder().encode(JSON.stringify(r.coachContext)).length<=8192);
  if(r.input.playerId==='helper'){sawFull=true;assert.ok(r.coachContext.plan);assert.equal(r.trace.execution.persisted,true);}
  else {sawRejected=true;assert.deepEqual(r.input,{kind:'endTurn'});assert.equal(r.trace.selection21.challenger.reason,'required-plan-does-not-fit-final-context');}
 }
 assert.ok(sawFull);assert.ok(sawRejected);
});
test('ordinary 22-player exact helper/carrier graph fits beside movement memory and executes its retained continuation',async()=>{
 const s=JSON.parse(readFileSync(new URL('./deps/execution-step-54.json',import.meta.url))).state;
 s.variant='standard';
 for(const team of ['A','B'])for(let k=8;k<=11;k++)s.players.push({...structuredClone(s.players.find(p=>p.id===team+'1')),
  id:team+k,number:k,name:'Additional ordinary player '+k,pos:{x:team==='A'?k-6:k+9,y:10},skills:[],activated:true});
 Object.assign(s.players.find(p=>p.id==='A6'),{stance:'standing',pos:{x:2,y:5}});
 s.players.find(p=>p.id==='A7').pos={x:3,y:5};s.ball={kind:'held',playerId:'A6'};s.turn.activation=null;s.turn.betweenTurns=false;
 const o=observe(s,'A',1),session=new Session(s,'A',1,60000),get=(m,...a)=>callService(session,m,a),sv=services(s);
 const firstInput=get('candidates',{players:['A7'],families:['move'],maxRushes:0,sort:'steps',limit:30}).candidates.find(c=>c.input.path.length===1).input;
 const first=get('explore',firstInput,{observations:true,decisions:'builtin',maxMs:1000});
 const next=get('candidates',{from:first.outcomes[0].key,players:['A6'],families:['move'],maxRushes:0,sort:'steps',limit:30}).candidates.find(c=>c.input.path.length===1).input;
 const child=get('explore',next,{from:first.outcomes[0].key,observations:true,decisions:'builtin',maxMs:1000});
 const selected={input:firstInput,ex:first,preparedBranches:new Map([[first.outcomes[0].key,{plan:{input:next},ex:child}]])};
 const {createChampion}=await import('../src/champion.mjs');
 const end={input:{kind:'endTurn'},ex:await explore(sv,{kind:'endTurn'}),preparedBranches:new Map(),unknown:0};
 sv.snapshot={mode:'normal',selected:end,lines:[end]};sv.answer={input:end.input,coachContext:{drivePlan:createChampion().inspector.buildDrivePlan(o,null),movementMemory:null}};
 sv.teamResult={attempted:true,selected,reason:'injected-real-host-team-selection'};
 const r=await chooseAction(o,[],sv);assert.deepEqual(r.input,firstInput);assert.ok(r.coachContext.plan);
 assert.equal(r.trace.execution.persisted,true);assert.ok(Buffer.byteLength(JSON.stringify(r.coachContext))<=8192);
 const actual=E.execute(s,r.input);assert.equal(actual.status,'completed');
 const nextObservation=observe(actual.state,'A',2);nextObservation.coachContext=r.coachContext;
 const current=services(actual.state,2);current.snapshot={mode:'normal',selected:{input:next},lines:[]};
 current.answer={input:next,coachContext:{...r.coachContext.champion,drivePlan:createChampion().inspector.buildDrivePlan(nextObservation,r.coachContext.champion.drivePlan),movementMemory:createChampion().inspector.rememberMovement(nextObservation,r.coachContext.champion.movementMemory,next)}};
 const continued=await chooseAction(nextObservation,[],current);
 assert.deepEqual(continued.input,next);assert.equal(continued.trace.reused,true);
 assert.equal(continued.trace.execution.previousPlan.reason,'actual-public-state-branch');
 assert.ok(Buffer.byteLength(JSON.stringify(continued.coachContext))<=8192);assert.ok(continued.coachContext.plan);
 assert.equal(E.execute(actual.state,continued.input).status,'completed');
});
test('a singleton is not sufficient when an override depends on a missing conditional edge',async()=>{
 const {o,sv}=await fixture(),selected=sv.teamResult.selected;
 selected.preparedBranches=new Map([['not-an-observed-key',[...selected.preparedBranches.values()][0]]]);
 const r=await chooseAction(o,[],sv);assert.deepEqual(r.input,{kind:'endTurn'});
 assert.equal(r.trace.selection21.challenger.reason,'required-plan-does-not-fit-final-context');
});
