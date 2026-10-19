import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {E,observeV2} from './deps/archived-v6-host.mjs';
import {TEACHER_TRAIN_DOMAIN} from '../src/teacher-domain.mjs';
import {expandLearningTrace} from '../src/trace-size.mjs';
// S4.37 index-level admission: production index.mjs, learned-proposal, tactical-shadow, learning-domain and
// runtime-engines run unmodified; only the frozen champion's search is replaced by its returned snapshot (the
// selection.test.mjs pattern). The root is a real API2 standard 26x15 public observation (archived host schema);
// only the engine fingerprint and the rules edition are set, as the GUI hosts report them.
const GUI_CC1={version:'7.0.1-cc1',engineHash:'363a910be141a2c613fafb40021cb7f6d2f3f7bb72f55d2869a9e3d2b6b6f269',
 rulesHash:'1ae54891eed97354e1aaca931b44a7710c50ebe72a90fe9de178247a16dcb831',apiHash:'cc8878821f67091585f79e6553b67cd01b2794235e73c33f2dcb0d43e607dd97'};
const GUI_701={version:'7.0.1',engineHash:'015f6879ad93c03e810a71d7e541aad5da71f93839eb84951a0979d242ab7754',
 rulesHash:'d75586a708201fdbaa93e051d501bc1b6e604cf77e540d5d9611ba42418fc47e',apiHash:GUI_CC1.apiHash};
const RUNNER_701={...GUI_701,apiHash:'f51ae035be08e69190356db2f4cf18599c3050acd9d0075965c147bfb301b8f8'};
const mock=`import {createChampion as real} from ${JSON.stringify(new URL('../src/champion.mjs',import.meta.url).href)};
const inspect=real().inspector;
export function createChampion(options={}) {return {inspector:inspect,
 async chooseAction(o,native,s){s.championStarted?.();options.onSelected?.(s.snapshot);return s.answer;},
 async chooseDecision(){return null;},chooseSetup(){return null;}};}`;
const data=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
let source=readFileSync(new URL('../src/index.mjs',import.meta.url),'utf8');
source=source.replaceAll(/from '(\.\/[^']+)'/g,(_,rel)=>'from '+JSON.stringify(rel==='./champion.mjs'?data(mock):new URL('../src/'+rel.slice(2),import.meta.url).href));
globalThis.bloodboard={register(){}};
const {chooseAction}=await import(data(source));
delete globalThis.bloodboard;

function root(engine){
 const state=E.buildScenario({teams:{A:'human',B:'human'},players:[
  {id:'A6',team:'A',roster:'human',position:'lineman',at:[8,7],number:6},
  {id:'A7',team:'A',roster:'human',position:'catcher',at:[9,7],number:7},
  {id:'B1',team:'B',roster:'human',position:'lineman',at:[16,7],number:1}
 ],ball:{holder:'A6'}},13);
 const o=observeV2(state,'A',501);
 // Real archived public schema; the GUI host fingerprint and its observed edition replace the archived ones.
 o.engine={...engine};o.ruleset={...o.ruleset,rulesEdition:'faq2026'};o.rulesEdition='faq2026';
 return o;
}
const move={kind:'playerAction',playerId:'A6',action:'move',path:[]},end={kind:'endTurn'};
async function decide(engine,{timeLimitMs}={}){
 const o=root(engine),calls=[];let phase='before-champion';
 if(timeLimitMs)o.timeLimitMs=timeLimitMs;
 const line={input:move,family:'move',ex:{ok:true,outcomes:[{p:1,key:'mock',observation:o,active:'A',completed:true}],pTurnover:0,pTouchdown:0,unresolvedMass:0,rest:{p:0}},
  unknown:0,baseValue:100,preparationGain:0,reply:[{stage:'after first action'}],criticalReplyAdjustment:0,positionReplyAdjustment:0,
  replyAdjustment:0,observedReplyMass:1,checkedReplyMass:1,boundedReplyMass:1};
 const services={snapshot:{mode:'normal',selected:line,lines:[line]},answer:{input:move,coachContext:{drivePlan:{team:'A'},movementMemory:[]}},
  championStarted:()=>{phase='champion-or-later';},
  // Every public input is legal at the root; exploration is refused, so no own policy completes and no reservation runs.
  validate:async(input,options={})=>{calls.push({phase,method:'validate',input});return {ok:true,legal:true,position:options.from??'root'};},
  explore:async(input)=>{calls.push({phase,method:'explore',input});return {ok:false,code:'fixture-explore-refused'};}};
 const answer=await chooseAction(o,[{id:1,input:move},{id:2,input:end}],services);
 return {answer,trace:expandLearningTrace(answer.trace),calls};
}

test('S4.37 index: GUI 7.0.1-cc1 admits the teacher path and the trace names the runtime engine',{skip:!TEACHER_TRAIN_DOMAIN.verified},async()=>{
 const {answer,trace,calls}=await decide(GUI_CC1);
 assert.deepEqual(answer.input,move,'the champion answer is returned');
 const a=trace.learnedAdmission;
 assert.deepEqual(a.domain,{admitted:true,reason:null,runtimeEngine:'7.0.1-cc1',relation:'declared-bit-exact-equivalent-of-7.0.1'});
 assert.equal(a.domainSkipped,null);assert.equal(a.modelInvoked,true);assert.equal(a.ranked,true);assert.equal(a.generated,true);
 const prep=trace.planning.checks.learnedPreparation;
 assert.equal(prep.learning.model_key,'teacherV3');assert.equal(prep.learning.learning_domain.runtime_engine,'7.0.1-cc1');
 assert.equal(prep.learning.learning_domain.training_domain_receipt_sha256,TEACHER_TRAIN_DOMAIN.receiptSha256,'training receipt unchanged');
 assert.equal(prep.ownComplete,false,'refused exploration cannot complete an own policy');
 const early=calls.filter(c=>c.phase==='before-champion');
 assert.ok(early.filter(c=>c.method==='validate').length>=2,'the teacher pool is validated before the champion search');
 assert.equal(trace.tacticalLearning.learning_domain.runtime_engine,'7.0.1-cc1');assert.equal(trace.tacticalLearning.model_invoked,true);
 assert.deepEqual(trace.decisionAgreement.hostBuiltin.engine,GUI_CC1,'the observed fingerprint is recorded as reported');
});

test('S4.37 index: GUI 7.0.1 is admitted as the training domain',{skip:!TEACHER_TRAIN_DOMAIN.verified},async()=>{
 const {answer,trace}=await decide(GUI_701);
 assert.deepEqual(answer.input,move);
 assert.deepEqual(trace.learnedAdmission.domain,{admitted:true,reason:null,runtimeEngine:'7.0.1',relation:'training-domain'});
 assert.equal(trace.learnedAdmission.modelInvoked,true);
});

for(const [name,engine] of [['Match Lab runner 7.0.1 (apiHash f51ae0)',RUNNER_701],['Match Lab runner 7.0.1-cc1 (apiHash f51ae0)',{...GUI_CC1,apiHash:RUNNER_701.apiHash}]])
 test(`S4.37 index: ${name} stays rejected; no learned validate or explore call is made`,async()=>{
  const {answer,trace,calls}=await decide(engine);
  assert.deepEqual(answer.input,move,'the champion answer is returned');
  const a=trace.learnedAdmission;
  assert.deepEqual(a.domain,{admitted:false,reason:'RUNTIME_FINGERPRINT_MISMATCH',runtimeEngine:null,relation:null});
  assert.equal(a.domainSkipped,null);assert.equal(a.modelInvoked,false);assert.equal(a.ranked,false);assert.equal(a.generated,false);
  assert.deepEqual(calls.filter(c=>c.phase==='before-champion'),[],'no early learned validate/explore');
  const t=trace.tacticalLearning;
  assert.equal(t.reason,'RUNTIME_FINGERPRINT_MISMATCH');assert.equal(t.model_invoked,false);
  assert.equal(Object.hasOwn(t,'unique_candidates'),false,'the post-decision shadow stops before its validation loop');
  assert.deepEqual(t.rejections,[]);
 });

test('S4.37 index: when the early shadow is skipped for budget the domain is null with the reason; the final shadow still reports it',{skip:!TEACHER_TRAIN_DOMAIN.verified},async()=>{
 // A 10 s host limit leaves a 7 s pipeline deadline, below the early proposal's 6 s + 6 s floor.
 const {answer,trace,calls}=await decide(GUI_CC1,{timeLimitMs:10000});
 assert.deepEqual(answer.input,move);
 assert.equal(trace.learnedAdmission.domain,null);assert.equal(trace.learnedAdmission.domainSkipped,'learned-early-budget-unavailable');
 assert.equal(trace.learnedAdmission.modelInvoked,false);
 assert.deepEqual(calls.filter(c=>c.phase==='before-champion'),[]);
 assert.equal(trace.tacticalLearning.learning_domain.admitted,true);assert.equal(trace.tacticalLearning.learning_domain.runtime_engine,'7.0.1-cc1');
});
