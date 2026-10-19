import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createChampion} from '../src/champion.mjs';
import {saveChampionPlan} from '../src/plans.mjs';
import {endorseContinuation} from '../src/policy.mjs';
const inspect=createChampion().inspector;
const identity={coachId:'hopeful-2-5-s4-37u-c-unified',version:'2.5.0-test.s4.37u.c',contextSchema:'hopeful-context/2.5-s4.37u.c'};
const move=id=>({kind:'playerAction',playerId:id,action:'move',path:[]});
const ob=(x=1)=>({apiVersion:1,requestId:1,revision:'1:-:0',phase:'play',team:'A',active:'A',format:'sevens',
 half:1,drive:1,turn:{A:1,B:0},pitch:{width:20,height:11,endZone:{A:19,B:0}},score:{A:0,B:0},
 ball:{kind:'held',playerId:'p'},rerolls:{A:1,B:1},used:{},weather:'perfect',activation:null,
 players:[{id:'p',team:'A',location:'pitch',pos:{x,y:4},stance:'standing',activated:false,
 ma:6,st:3,ag:3,av:8,skills:[]}],teams:{A:{rerolls:1},B:{rerolls:1}}});
const ex=o=>({ok:true,outcomes:[{p:1,key:'mock',observation:o,active:'A',completed:true}],
 pTurnover:0,pTouchdown:0,unresolvedMass:0,rest:{p:0}});
const line=(input,gain=0)=>({input,family:'move',ex:ex(ob()),unknown:0,baseValue:100+gain,
 preparationGain:0,reply:[{stage:'after first action'}],criticalReplyAdjustment:0,positionReplyAdjustment:0,
 replyAdjustment:0,observedReplyMass:1,checkedReplyMass:1,boundedReplyMass:1});
// Only the searched snapshot boundary is mocked. Production index, policy,
// plan and executor wiring execute unmodified; actual workers have a separate gate.
const mock=`import {createChampion as real} from ${JSON.stringify(new URL('../src/champion.mjs',import.meta.url).href)};
const inspect=real().inspector;
export function createChampion(options={}) {return {inspector:inspect,
 async chooseAction(o,native,s){options.onSelected?.(s.snapshot);await s.pause?.();return s.answer;},
 async chooseDecision(){return null;},chooseSetup(){return null;}};}`;
const data=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
let source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
source=source.replaceAll(/from '(\.\/[^']+)'/g,(_,rel)=>'from '+JSON.stringify(rel==='./champion.mjs'?data(mock):new URL('../src/'+rel.slice(2),import.meta.url).href));
globalThis.bloodboard={register(){}};
const {chooseAction}=await import(data(source));
delete globalThis.bloodboard;
function request(mode,equal=false){
 const first=ob(),after={...ob(2),requestId:2,revision:'2:-:0'},next=move('p');
 const saved=saveChampionPlan(first,{input:move('p'),ex:ex(after),preparedBranches:new Map([
  ['mock',{plan:{input:next},ex:ex(ob(3))}]])},identity);
 assert.ok(saved.plan,saved.reason);
 const selected=line(equal?next:move('other')),candidate=line(next,1000);
 assert.equal(endorseContinuation(candidate,selected,inspect,'normal').eligible,true,'ordinary gate would admit the candidate');
 const championContext={drivePlan:{team:'A'},movementMemory:[]};
 return {o:{...after,coachContext:{schema:identity.contextSchema,champion:championContext,plan:saved.plan}},
  services:{snapshot:{mode,selected,lines:[selected,candidate]},answer:{input:selected.input,coachContext:championContext},
   validate:async()=>({ok:true,legal:true})},selected,next,championContext};
}
for(const mode of ['final-turn','certain-td']){
 test(`${mode} cannot be overridden by a different saved continuation with a passing normal value gate`,async()=>{
  const r=request(mode),answer=await chooseAction(r.o,[],r.services);
  assert.deepEqual(answer.input,r.selected.input);assert.equal(answer.trace.reused,false);
  assert.equal(answer.trace.selection21.gate.reason,'champion-special-selection-preserved');
  assert.deepEqual(answer.coachContext.champion,r.championContext);
 });
 test(`${mode} still reuses a freshly identical saved continuation`,async()=>{
  const r=request(mode,true),answer=await chooseAction(r.o,[],r.services);
  assert.deepEqual(answer.input,r.next);assert.equal(answer.trace.reused,true);
  assert.equal(answer.trace.execution.inputConfirmed,false);assert.equal(answer.trace.execution.sourceConfirmed,false);
 });
}
test('normal selection retains its measured continuation admission',async()=>{
 const r=request('normal'),answer=await chooseAction(r.o,[],r.services);
 assert.deepEqual(answer.input,r.next);assert.equal(answer.trace.reused,true);
});
test('overlapping requests cannot substitute another request snapshot',async()=>{
 const a=request('certain-td'),b=request('normal');let release;
 a.services.pause=()=>new Promise(resolve=>{release=resolve;});
 const pending=chooseAction(a.o,[],a.services);
 const second=await chooseAction(b.o,[],b.services);release();
 const first=await pending;
 assert.deepEqual(first.input,a.selected.input);assert.equal(first.trace.reused,false);
 assert.deepEqual(second.input,b.next);assert.equal(second.trace.reused,true);
});
for(const [label,change] of [
 ['ball possession',o=>{o.ball={kind:'ground',pos:{x:3,y:4}};}],
 ['player position',o=>{o.players[0].pos.x++;}],
 ['team rerolls',o=>{o.teams.A.rerolls++;}]
])test(`material change to ${label} preserves prior-plan invalidation reason after fresh selection`,async()=>{
 const r=request('normal',true);change(r.o);
 const answer=await chooseAction(r.o,[],r.services);
 assert.equal(answer.trace.reused,false);
 assert.deepEqual(answer.input,r.selected.input);
 assert.equal(answer.trace.execution.previousPlan.status,'invalidated');
 assert.equal(answer.trace.execution.previousPlan.reason,'unretained-or-changed-public-outcome');
 assert.ok(answer.trace.execution.previousPlan.differenceCount>0);
 assert.ok(answer.trace.execution.previousPlan.differencePaths.length>0);
 assert.equal(answer.trace.execution.previousPlan.inputConfirmed,false);
 assert.equal(answer.trace.execution.previousPlan.sourceConfirmed,false);
});
