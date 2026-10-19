import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

import {verifiedFixture} from '../scripts/test-deps.mjs';
import {E,observeV2} from './deps/archived-v6-host.mjs';
import {expandLearningTrace} from '../src/trace-size.mjs';
import {TEACHER_TRAIN_DOMAIN} from '../src/teacher-domain.mjs';
const source=readFileSync(new URL('../hopeful-2-5-s4-37u-c-unified.js',import.meta.url),'utf8');
const fixture=JSON.parse(verifiedFixture('champion-game-p0001-L2.json'));
const actual=fixture.decisions.find(r=>r.step===45&&r.observation);
const clone=x=>JSON.parse(JSON.stringify(x));
const hash=x=>createHash('sha256').update(x).digest('hex');
const NativeDate=Date;
class FixedDate extends NativeDate{static now(){return 12345;}}
function root(mode){
 const o=clone(actual.observation),legacy=clone(actual.candidates.slice(0,1));
 o.timeLimitMs=60000;o.builtInChoice={candidateId:legacy[0].id};
 if(mode==='final-turn'){o.turn[o.team]=o.turnsPerHalf;o.score={A:0,B:0};}
 if(mode==='controlled-delay'){
  o.turn[o.team]=2;o.score={A:0,B:0};o.activation=null;
  o.strategicPublic={wizardAvailable:{A:false,B:false}};
  for(const p of o.players)if(p.team!==o.team){p.location='reserves';p.pos=null;}
  const car=o.players.find(p=>p.id===o.ball.playerId);
  car.pos={x:1,y:5};car.activated=false;car.canBeActivated=true;car.stance='standing';
 }
 return {o,legacy};
}
/** Deterministic transcript only, not an engine simulation. It exercises the
 * frozen selection exits without host services or a search-strength claim. */
function services(o,mode){
 const transcript=[],states=new Map();let serial=0;
 const record=(name,args)=>transcript.push([name,clone(args)]);
 const result={transcript,
  candidates:async(...args)=>{record('candidates',args);return {ok:true,complete:true,candidates:mode==='controlled-delay'?
   [{input:{kind:'playerAction',playerId:o.ball.playerId,action:'move',path:[]},pTouchdown:1,pTurnover:0,exact:true,unresolved:0}]:[]};},
  explore:async(...args)=>{
   record('explore',args);if(mode==='fallback')return null;
   const [input,opts]=args,after=clone(states.get(opts?.from)||o);
   if(input.kind==='endTurn')after.active=o.team==='A'?'B':'A';
   const p=after.players.find(p=>p.id===input.playerId),destination=input.path?.at(-1)?.to;
   if(p&&destination)p.pos=clone(destination);
   const terminal=mode==='certain-td'?1:mode==='final-turn'?.5:0,outcomes=[];
   const add=(ob,p,touchdown)=>{const key='mock:'+serial++;states.set(key,ob);outcomes.push({key,p,observation:clone(ob),active:ob.active,turnover:false,touchdown,completed:true});};
   if(terminal){const scored=clone(after);scored.score[o.team]++;add(scored,terminal,o.team);}
   if(terminal<1)add(after,1-terminal,null);
   return {ok:true,outcomeIdentity:'complete-state-v1',exact:true,pTurnover:0,pTouchdown:terminal,unresolvedMass:0,rest:{p:0},outcomes};
  },
  progress:async(...args)=>{record('progress',args);},
  // Only the admitted API2 mode offers validate (the learned/teacher path needs it); the other modes keep their transcripts.
  ...(mode==='admitted'?{validate:async(...args)=>{record('validate',args);return {ok:true,legal:true,position:args[1]?.from??'root'};}}:{}),
  threats:{scoring:async(...args)=>{record('threats.scoring',args);return {ok:true,exact:true,threats:[]};},
   blitz:async(...args)=>{record('threats.blitz',args);return {ok:true,exact:true,blitzes:[]};}}
 };
 return result;
}

let sourceCoach,registrations=0;
globalThis.bloodboard={register(c){registrations++;sourceCoach=c;}};
await import('../src/index.mjs');
delete globalThis.bloodboard;
function bundled(){let coach,count=0;const context={bloodboard:{register(c){count++;coach=c;}},Date:FixedDate,TextEncoder,setTimeout,clearTimeout};
 vm.runInNewContext(source,context,{timeout:5000});assert.equal(count,1);
 assert.deepEqual(Object.keys(context).sort(),['Date','TextEncoder','bloodboard','clearTimeout','setTimeout']);return coach;}
test('standalone registers once, isolates globals and matches complete source metadata',()=>{
 assert.equal(registrations,1);const built=bundled();
 for(const k of Object.keys(sourceCoach))if(typeof sourceCoach[k]==='function')assert.equal(typeof built[k],'function');
 else assert.deepEqual(clone(built[k]),clone(sourceCoach[k]));
 assert.equal(built.name,'Hopeful S4.37U');assert.equal(built.id,'hopeful-2-5-s4-37u-c-unified');assert.equal(built.version,'2.5.0-test.s4.37u.c');
 assert.equal(built.contextSchema,'hopeful-context/2.5-s4.37u.c');assert.equal(built.timeLimitMs,120000);
});
for(const mode of ['certain-td','final-turn','normal','fallback','controlled-delay'])test(
 `standalone vs source ${mode}: equal full answer and service transcript`,async()=>{
 const {o,legacy}=root(mode),a=services(o,mode),b=services(o,mode);
 try{globalThis.Date=FixedDate;
 const expected=await sourceCoach.chooseAction(clone(o),clone(legacy),a);
 const actual=await bundled().chooseAction(clone(o),clone(legacy),b);
 assert.deepEqual(clone(actual),clone(expected));assert.deepEqual(b.transcript,a.transcript);
 }finally{globalThis.Date=NativeDate;}
});
// S4.37: the same parity with the learned/teacher path admitted. A real API2 standard 26x15 public observation
// (archived host schema) carries the GUI fingerprint and the observed faq2026 edition, so teacherV3 projection, the
// validated pool, own binding, key reservation and the final shadow run in both the source and the bundle.
const GUI701={version:'7.0.1',engineHash:'015f6879ad93c03e810a71d7e541aad5da71f93839eb84951a0979d242ab7754',rulesHash:'d75586a708201fdbaa93e051d501bc1b6e604cf77e540d5d9611ba42418fc47e',apiHash:'cc8878821f67091585f79e6553b67cd01b2794235e73c33f2dcb0d43e607dd97'};
const GUICC1={version:'7.0.1-cc1',engineHash:'363a910be141a2c613fafb40021cb7f6d2f3f7bb72f55d2869a9e3d2b6b6f269',rulesHash:'1ae54891eed97354e1aaca931b44a7710c50ebe72a90fe9de178247a16dcb831',apiHash:GUI701.apiHash};
function admittedRoot(engine){
 const state=E.buildScenario({teams:{A:'human',B:'human'},players:[
  {id:'A6',team:'A',roster:'human',position:'lineman',at:[8,7],number:6},
  {id:'A7',team:'A',roster:'human',position:'catcher',at:[9,7],number:7},
  {id:'B1',team:'B',roster:'human',position:'lineman',at:[16,7],number:1}
 ],ball:{holder:'A6'}},13);
 const o=observeV2(state,'A',501);
 o.engine={...engine};o.ruleset={...o.ruleset,rulesEdition:'faq2026'};o.rulesEdition='faq2026';o.timeLimitMs=60000;
 const legacy=[{id:1,input:{kind:'playerAction',playerId:'A6',action:'move',path:[{kind:'step',to:{x:9,y:6}}]}},{id:2,input:{kind:'endTurn'}}];
 o.builtInChoice={candidateId:1};
 return {o,legacy};
}
for(const [name,engine] of [['7.0.1-cc1',GUICC1],['7.0.1',GUI701]])test(
 `standalone vs source admitted API2 root on GUI ${name}: equal full answer and service transcript`,{skip:!TEACHER_TRAIN_DOMAIN.verified},async()=>{
 const {o,legacy}=admittedRoot(engine),a=services(o,'admitted'),b=services(o,'admitted');
 let expected,actual;
 try{globalThis.Date=FixedDate;
 expected=await sourceCoach.chooseAction(clone(o),clone(legacy),a);
 actual=await bundled().chooseAction(clone(o),clone(legacy),b);
 }finally{globalThis.Date=NativeDate;}
 assert.deepEqual(clone(actual),clone(expected));assert.deepEqual(b.transcript,a.transcript);
 const trace=expandLearningTrace(expected.trace);
 assert.equal(trace.tacticalLearning.learning_domain.runtime_engine,engine.version);assert.equal(trace.tacticalLearning.model_invoked,true);
 assert.deepEqual(trace.learnedAdmission.domain,{admitted:true,reason:null,runtimeEngine:engine.version,
  relation:engine===GUICC1?'declared-bit-exact-equivalent-of-7.0.1':'training-domain'});assert.equal(trace.learnedAdmission.modelInvoked,true);
 assert.ok(a.transcript.some(([n])=>n==='validate'),'the learned path validated its pool');
});
test('standalone vs source rule decision and setup callbacks',async()=>{
 const {o}=root('normal'),request={type:'kickOrReceive',options:[{id:'kick'},{id:'receive'}]};
 assert.deepEqual(clone(await bundled().chooseDecision(o,request,{})),clone(await sourceCoach.chooseDecision(o,request,{})));
 const setup={fixedPlayerIds:o.players.filter(p=>p.team===o.team).slice(0,3).map(p=>p.id),
  legalSquares:Array.from({length:8*11},(_,n)=>({x:2+Math.floor(n/11),y:n%11})),
  centreRows:{min:2,max:8},minLine:1,maxWide:2,lineOfScrimmage:9};
 const expected=sourceCoach.chooseSetup(o,setup);assert.ok(expected);
 assert.deepEqual(clone(bundled().chooseSetup(o,setup)),clone(expected));
});
