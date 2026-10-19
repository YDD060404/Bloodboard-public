import test from 'node:test';
import assert from 'node:assert/strict';
import {E,observeV2,Session,callService} from './deps/archived-v6-host.mjs';
import {REQUIRED_ENGINE} from '../src/tactical-models.mjs';
import {TEACHER_TRAIN_DOMAIN} from '../src/teacher-domain.mjs';
import {learningDomain} from '../src/learning-domain.mjs';
import {tacticalFeatures} from '../src/tactical-features.mjs';
import {tacticalShadow} from '../src/tactical-shadow.mjs';
import {prepareLearnedProposal} from '../src/learned-proposal.mjs';

function standardState(){
 // buildScenario uses the engine's default standard rules. Check those rules
 // before observation; do not relabel a Sevens observation as standard.
 const state=E.buildScenario({teams:{A:'human',B:'human'},players:[
  {id:'A6',team:'A',roster:'human',position:'lineman',at:[8,7],number:6},
  {id:'A7',team:'A',roster:'human',position:'catcher',at:[9,7],number:7},
  {id:'B1',team:'B',roster:'human',position:'lineman',at:[16,7],number:1}
 ],ball:{holder:'A6'}},13);
 const rules=E.rulesFor(state);
 assert.equal(rules.variant,'standard');assert.equal(rules.pitch.w,26);assert.equal(rules.pitch.h,15);
 return state;
}
const inputs=[{kind:'playerAction',playerId:'A6',action:'move',path:[]},{kind:'endTurn'}];
function admissionRoot(state=standardState()){
 const o=observeV2(state,'A',501);
 // Controlled admission inputs, as in native-learning-domain.test.mjs. The
 // archived engine supplies a real standard public schema, not current runtime attestation.
 // No explore law, execution certificate, match result or FAQ odds are fabricated.
 o.engine={...REQUIRED_ENGINE};o.ruleset={...o.ruleset,rulesEdition:'faq2026'};o.rulesEdition='faq2026';
 return o;
}
function forbiddenServices(){
 const calls={validate:0,explore:0};
 return {calls,services:{validate:async()=>{calls.validate++;throw Error('unadmitted input reached validate');},
  explore:async()=>{calls.explore++;throw Error('unadmitted input reached explore');}}};
}

test('standard 26x15 public first-input schema ranks a real validated mask without executing it',{skip:!TEACHER_TRAIN_DOMAIN.verified},async()=>{
 const state=standardState(),o=admissionRoot(state),session=new Session(state,'A',501,60000);
 assert.equal(o.format,'standard');assert.equal(o.pitch.width,26);assert.equal(o.pitch.height,15);
 assert.equal(o.activation,null);assert.equal(o.pending,null);
 let validateCalls=0;
 const r=await tacticalShadow(o,inputs,{validate:async(...args)=>{validateCalls++;return callService(session,'validate',args);}},
  {deadline:Date.now()+10000});
 assert.equal(r.learning_domain.admitted,true);assert.equal(r.model_key,'teacherV3');
 assert.equal(r.model_invoked,true);assert.equal(r.ranked,true,r.reason);assert.equal(r.accepted_candidates,2);
 assert.equal(validateCalls,2);assert.equal(r.override,false);assert.equal(r.action_executed,false);
 assert.equal(r.rankRows.length,2);assert.deepEqual(new Set(r.rankRows.map(x=>JSON.stringify(x.input))),new Set(inputs.map(x=>JSON.stringify(x))));
 for(const row of r.rankRows){assert.equal(row.score,r.scores[row.acceptedIndex]);assert.equal(row.rank,1+r.scores.filter(x=>x>row.score).length);assert.ok(typeof row.inputKey==='string'&&row.inputKey.length>0);}
 assert.equal(r.score_semantics,'uncalibrated-engine-search-teacher-pairwise-preference-logit');assert.equal(Object.hasOwn(r,'source_choice_probabilities'),false);
});

for(const [name,change,reason] of [
 ['Sevens',o=>{o.format='sevens';o.pitch.width=20;o.pitch.height=11;},'OUTSIDE_TRAINED_PITCH'],
 ['wrong standard dimensions',o=>{o.pitch.width=25;},'OUTSIDE_TRAINED_PITCH'],
 ...['move','block','blitz'].map(action=>['active '+action,o=>{o.activation={playerId:'A6',action,maUsed:1,over:false};},'OUTSIDE_TRAINED_ACTIVATION']),
 ['pending offer',o=>{o.pending={requestId:'live-rule',type:'reroll',team:'A'};},'PUBLIC_DECISION_DOMAIN_UNVERIFIED'],
 ['unobserved activation',o=>{delete o.activation;},'PUBLIC_ACTIVATION_UNOBSERVED']
])test(name+' rejects before learned inference, validation or own-policy exploration',{skip:!TEACHER_TRAIN_DOMAIN.verified},async()=>{
 const o=admissionRoot();change(o);const f=forbiddenServices();
 const r=await prepareLearnedProposal(o,inputs.map(input=>({input})),f.services,{},Date.now()+60000);
 assert.equal(r.report.generated,false);assert.equal(r.report.ranked,false);assert.equal(r.line,null);
 assert.equal(r.report.learning.model_invoked,false);assert.equal(r.report.learning.model_inference_calls,0);
 assert.ok(r.report.reason===reason||r.report.learning.rejections.some(x=>x.reason===reason),r.report.reason);
 assert.deepEqual(f.calls,{validate:0,explore:0});
});

test('old Handoff learningDomain retains separate legacy-transfer metadata and cannot certify execution',()=>{
 const o=admissionRoot();o.ruleset.rulesEdition='faq2026';o.rulesEdition='faq2026';
 const d=learningDomain(o);assert.equal(d.admitted,true);assert.equal(d.domain_mode,'faq2026-transfer-proposal');
 assert.equal(d.training_rulesEdition,'legacy');assert.equal(d.runtime_rulesEdition,'faq2026');
 assert.match(d.execution_requires,/actual native legality/);
 assert.deepEqual(tacticalFeatures(o,inputs[0]),tacticalFeatures(admissionRoot(),inputs[0]));
 const conflicting=structuredClone(o);conflicting.rulesEdition='legacy';
 assert.equal(learningDomain(conflicting).reason,'PUBLIC_RULES_EDITION_CONFLICT');
});

test('future events, outcomes and intention labels never enter the first-input feature vector',()=>{
 const o=admissionRoot(),clean=tacticalFeatures(o,inputs[0]),tainted=structuredClone(o);
 Object.assign(tainted,{winner:'A',result:{touchdown:true},rng:{nextDie:6},future:{score:{A:99,B:0}},
  task:'advance',expert_intention:'protect',sinceLast:{entries:[{outcome:'touchdown',input:{path:[{kind:'step',to:{x:25,y:7}}]}}]},
  coachContext:{futureWinner:'A',candidateRank:0}});
 tainted.players.forEach(p=>{p.futureDice=6;p.nextTurnStamina=999;});
 assert.deepEqual(tacticalFeatures(tainted,inputs[0]),clean);
 for(const name of ['task_advance','task_protect','task_prevent_td'])assert.equal(clean[name],null);
 assert.equal(clean.own_score,o.teams.A.score);assert.equal(clean.opponent_score,o.teams.B.score);
 assert.equal(clean.own_turn,o.teams.A.turn);assert.equal(clean.opponent_turn,o.teams.B.turn);
 const missing=structuredClone(o);delete missing.teams.A.score;
 assert.equal(tacticalFeatures(missing,inputs[0]).own_score,null,'missing public score must not become zero or a root alias');
});

test('active Handoff retains spent movement, shared resources and missing usage without replaying the prefix',()=>{
 const o=admissionRoot(),actor=o.players.find(p=>p.id==='A6'),target=o.players.find(p=>p.id==='A7');
 assert.ok(actor&&target);const spent=Math.max(0,actor.ma-1);
 o.ball={kind:'held',playerId:actor.id};actor.activated=true;actor.canBeActivated=false;
 o.activation={playerId:actor.id,action:'handoff',maUsed:spent,rushesUsed:1,blocksDone:0,ballActionDone:false,over:false};
 o.used.handoff=true;actor.usage={sureFeet:true};
 const input={kind:'playerAction',playerId:actor.id,action:'handoff',path:[],handoffTarget:target.id};
 const f=tacticalFeatures(o,input);
 assert.equal(f.activation_maUsed,spent);assert.equal(f.actor_ma,actor.ma);
 assert.equal(f.activation_rushesUsed,1);assert.equal(f.activation_ballActionDone,0);assert.equal(f.used_handoff,1);
 assert.equal(f.actor_usage_sureFeet,1);assert.equal(f.actor_usage_dodgeReroll,null);
 assert.equal(f.actor_activated,1);assert.equal(f.actor_matches_active_actor,1);assert.equal(f.path_length,0);
 const prefix=structuredClone(o);prefix.sinceLast={entries:[{input:{kind:'playerAction',playerId:actor.id,action:'handoff',path:[{kind:'step',to:{x:11,y:5}}]}}]};
 assert.deepEqual(tacticalFeatures(prefix,input),f);
 const exhausted=structuredClone(o);exhausted.activation.maUsed=actor.ma;exhausted.activation.ballActionDone=true;
 const after=tacticalFeatures(exhausted,input);assert.equal(after.activation_maUsed,actor.ma);assert.equal(after.activation_ballActionDone,1);
 assert.throws(()=>tacticalFeatures(o,{...input,path:[{kind:'step',to:{...actor.pos}}]}),/OUTSIDE_ACTIVE_HANDOFF_INPUT_SCOPE/);
 assert.throws(()=>tacticalFeatures(o,{...input,playerId:target.id}),/OUTSIDE_ACTIVE_HANDOFF_INPUT_SCOPE/);
 assert.equal(tacticalFeatures(o,{kind:'endActivation'}).kind_endActivation,1);
});
