import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifiedFixture,v6Root,esbuildModule,dependencyManifest} from '../scripts/test-deps.mjs';
const hostRoot=v6Root();
const {build}=await esbuildModule();
import {createPlan,armStep,reconcile,continuationCandidate,publicFacts} from '../src/execution.mjs';

// Real inspected V6 code produces every observation, receipt, rule state and
// validate response below. No invented feedback schema or host patch.
const runtime=await build({stdin:{contents:`
export * as E from './src/engine/index';
export {bindEngine} from './src/ai/index';
export {observeV2,receipt} from './src/platform/v2obs';
export {observe} from './src/platform/observe';
export {Session,callService} from './src/platform/index';`,
 resolveDir:hostRoot,loader:'ts'},
 bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent'});
const {E,bindEngine,observeV2,observe,receipt,Session,callService}=await import('data:text/javascript;base64,'+Buffer.from(runtime.outputFiles[0].text).toString('base64'));
bindEngine(E);
assert.deepEqual(E.BUILD_FINGERPRINT,dependencyManifest.V6Fingerprint,'Real V6 fingerprint must match inspected test host');
const fixture=JSON.parse(verifiedFixture('execution-step-54.json')).state;
const identity={coachId:'hopeful-2',version:'2.0',contextSchema:'hopeful-context/2'};
const action=id=>({kind:'playerAction',playerId:id,action:'move',path:[]});
const inputs=['A6','A7','A5','A1','A2'].map(action);
function setup(count=2,api=2){
 const states=[structuredClone(fixture)],nodes=[];
 for(let n=0;n<count;n++){
  const result=E.execute(states[n],inputs[n]);assert.equal(result.status,'completed');states.push(result.state);
  const after=api===2?observeV2(result.state,'A',n+2):observe(result.state,'A',n+2);
  nodes.push({input:inputs[n],branches:[{mass:1,observation:after,next:n+1<count?n+1:null}]});
 }
 const o=api===2?observeV2(states[0],'A',1):observe(states[0],'A',1);
 const built=createPlan(o,{id:'real-v6-chain',identity,nodes});assert.ok(built.plan,built.reason+' '+built.bytes);
 const armed=armStep(built.plan,o,inputs[0]);assert.ok(armed.plan,armed.reason);
 return {states,nodes,o,built,armed};
}
function nextObservation(s,before,request=2){return observeV2(s,'A',request,{sinceLog:before.log.length});}
function services(s){const session=new Session(s,'A',1,60000);return {validate:(i,o)=>callService(session,'validate',[i,o])};}

test('real API2 public events adopt a branch without confirming full input/source',async()=>{
 const {states,armed}=setup(),o=nextObservation(states[1],states[0]);
 const r=await continuationCandidate(armed.plan,o,services(states[1]));
 assert.equal(r.reason,'branch-adopted-from-public-facts');assert.equal(r.inputConfirmed,false);assert.equal(r.sourceConfirmed,false);
 assert.equal(r.plan.cursor,0);assert.equal(r.plan.completedCount,1);assert.deepEqual(r.candidate.input,inputs[1]);assert.equal(r.candidate.validated,true);
 assert.equal(r.candidate.requiresFreshEvaluation,true);
});
test('actual complete receipt confirms input and reports source; runner null input does not',()=>{
 const {states,o,armed}=setup(),after=nextObservation(states[1],states[0]);
 const full=receipt(states[0],states[1],{requestId:o.requestId,input:inputs[0],coach:identity.coachId,via:'input',fellBack:false,reason:null});
 const r=reconcile(armed.plan,after,{receipt:full});assert.equal(r.inputConfirmed,true);assert.equal(r.sourceConfirmed,true);
 assert.equal(r.source.fellBack,false);
 const logged={...full,input:null};assert.equal(reconcile(armed.plan,after,{receipt:logged}).inputConfirmed,false);
 const different={...full,input:{...inputs[0],path:[{to:{x:0,y:0}}]}};
 assert.equal(reconcile(armed.plan,after,{receipt:different}).reason,'different-executed-input');
});
test('complete actual LogEntry history confirms exact input after execution',()=>{
 const {states,armed}=setup(),o=nextObservation(states[1],states[0]);
 const r=reconcile(armed.plan,o,{history:states[1].log});assert.equal(r.inputConfirmed,true);assert.equal(r.sourceConfirmed,false);
});
test('V1 exact public branch adoption never claims execution, and requires increased revision',async()=>{
 const {states,armed,o}=setup(2,1);
 const after=observe(states[1],'A',2),r=await continuationCandidate(armed.plan,after,services(states[1]));
 assert.equal(r.reason,'actual-public-state-branch');assert.equal(r.inputConfirmed,false);assert.equal(r.sourceConfirmed,false);
 assert.equal(r.candidate.validated,true);
 assert.equal(reconcile(armed.plan,o).reason,'revision-did-not-advance');
});
test('five real actor nodes retain dependencies and finish without stale keys',async()=>{
 const {states,built}=setup(5);let plan=built.plan;
 for(let n=0;n<5;n++){
  const before=observeV2(states[n],'A',n+1),armed=armStep(plan,before,inputs[n]);assert.ok(armed.plan,armed.reason);
  const after=nextObservation(states[n+1],states[n],n+2),r=await continuationCandidate(armed.plan,after,services(states[n+1]));
  if(n===4){assert.equal(r.status,'completed');assert.equal(r.plan,null);}else{assert.equal(r.plan.cursor,0);assert.equal(r.plan.completedCount,n+1);plan=r.plan;}
 }
 assert.ok(built.bytes<=7500);assert.equal(JSON.stringify(built.plan).includes('positionKey'),false);
});
test('real observe-derived exact guard rejects unexpected resource/player/score facts',()=>{
 const {states,armed}=setup(),after=nextObservation(states[1],states[0]);
 for(const change of [o=>o.players[0].usage.unexpected=1,o=>o.teams.A.rerolls++,o=>o.resources.A.wizard.status='used']){
  const changed=structuredClone(after);change(changed);assert.equal(reconcile(armed.plan,changed).reason,'unretained-or-changed-public-outcome');
 }
 const score=structuredClone(after);score.score.A++;assert.equal(reconcile(armed.plan,score).plan,null);
 const turn=structuredClone(after);turn.turn.A++;assert.equal(reconcile(armed.plan,turn).reason,'scope-changed');
});
test('API2 must honor causal action summary, missing history cannot become V1 adoption',()=>{
 const {states,armed}=setup(),after=nextObservation(states[1],states[0]);
 const wrong=structuredClone(after);wrong.sinceLast.entries[0].input.playerId='A7';
 assert.equal(reconcile(armed.plan,wrong).reason,'causal-action-mismatch');
 const missing=structuredClone(after);delete missing.sinceLast;assert.equal(reconcile(armed.plan,missing).reason,'missing-causal-history');
});
test('unretained branch, resets, different chosen action and oversized context retire plan',()=>{
 const {states,armed,built,o}=setup();const after=nextObservation(states[1],states[0]);
 const reset={...after,contextInfo:{resetReason:{code:'undo'}}};assert.equal(reconcile(armed.plan,reset).reason,'identity-or-context-reset');
 const unretained=structuredClone(after);unretained.players[0].pos.x++;assert.equal(reconcile(armed.plan,unretained).plan,null);
 assert.equal(armStep(built.plan,o,inputs[1]).reason,'different-choice');
 assert.equal(createPlan(o,{id:'too-large',identity,nodes:setup().nodes,maxBytes:512}).reason,'context-reservation-exceeded');
});
test('actual pending rule decision waits, never moves to the next actor',()=>{
 const {armed}=setup();const s=structuredClone(fixture);
 const result=E.execute(s,{kind:'playerAction',playerId:'A1',action:'block',path:[],blockTarget:'B6'});
 const pending=observeV2(result.state,'A',2,{sinceLog:s.log.length});assert.ok(pending.pending);
 const r=reconcile(armed.plan,pending);assert.equal(r.status,'awaiting-rule');assert.equal(r.plan.cursor,0);
});
test('derived canBeActivated hint is excluded but all rule/player facts are retained',()=>{
 const {o}=setup(),copy=structuredClone(o);copy.players[0].canBeActivated=!copy.players[0].canBeActivated;
 assert.deepEqual(publicFacts(copy),publicFacts(o));copy.players[0].activated=!copy.players[0].activated;
 assert.notDeepEqual(publicFacts(copy),publicFacts(o));
});
test('actual legacy explore observations bridge to API2 current facts without losing resources',async()=>{
 const {states,o}=setup(),session=new Session(states[0],'A',1,60000);
 const ex=callService(session,'explore',[inputs[0],{observations:true,decisions:'builtin',maxOutcomes:40,maxMs:8000}]);
 assert.equal(ex.ok,true);assert.equal(ex.outcomes.length,1);assert.equal(ex.outcomes[0].observation.apiVersion,1);
 const root={...o,strategicPublic:{wizardAvailable:{A:false,B:false}}};
 const nodes=[{input:inputs[0],branches:[{mass:1,observation:ex.outcomes[0].observation,next:1}]},
  {input:inputs[1],branches:[]}];
 const built=createPlan(root,{id:'legacy-explore-bridge',identity,nodes});assert.ok(built.plan,built.reason);
 const armed=armStep(built.plan,root,inputs[0]);assert.ok(armed.plan,armed.reason);
 const after={...nextObservation(states[1],states[0]),strategicPublic:root.strategicPublic};
 const r=await continuationCandidate(armed.plan,after,services(states[1]));assert.equal(r.candidate.validated,true);
 const changed=structuredClone(after);changed.strategicPublic.wizardAvailable.B=true;
 assert.equal(reconcile(armed.plan,changed).reason,'unretained-or-changed-public-outcome');
});
