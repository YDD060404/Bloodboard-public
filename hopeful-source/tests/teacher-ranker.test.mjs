import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {TEACHER_MODEL} from '../src/teacher-model.mjs';
import {renderTeacherModel} from '../scripts/teacher-model-transform.mjs';
import {TEACHER_TRAIN_DOMAIN} from '../src/teacher-domain.mjs';
import {teacherFeatureVector,scoreTeacherFeatures} from '../src/teacher-ranker.mjs';
import {preferenceFeaturesV3} from '../src/teacher-features.mjs';
import {teacherPreferenceDomain,learningDomain} from '../src/learning-domain.mjs';
import {REQUIRED_ENGINE} from '../src/tactical-models.mjs';
import {tacticalShadow} from '../src/tactical-shadow.mjs';
import {prepareLearnedProposal,bindLearnedForCommonPool} from '../src/learned-proposal.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const player=(id,team,x,y)=>({id,team,location:'pitch',stance:'standing',pos:{x,y},ma:6,st:3,ag:3,skills:[],activated:false,distracted:false,tackleZone:true});
const root=()=>({apiVersion:2,engine:{...REQUIRED_ENGINE},ruleset:{rulesEdition:'faq2026'},rulesEdition:'faq2026',
 team:'A',active:'A',phase:'play',pending:null,activation:null,format:'standard',half:1,drive:1,
 pitch:{width:26,height:15,endZone:{A:25,B:0}},teams:{A:{score:0,turn:1,rerolls:2},B:{score:0,turn:0,rerolls:2}},
 used:{},ball:{kind:'held',playerId:'A1'},players:[player('A1','A',8,7),player('B1','B',9,7)]});
const move={kind:'playerAction',playerId:'A1',action:'move',path:[{kind:'step',to:{x:8,y:6}}]};
const block={kind:'playerAction',playerId:'A1',action:'block',path:[],blockTarget:'B1'};
const end={kind:'endTurn'};
const RUNNER_API='f51ae035be08e69190356db2f4cf18599c3050acd9d0075965c147bfb301b8f8';
const CC1_ENGINE={engineHash:'363a910be141a2c613fafb40021cb7f6d2f3f7bb72f55d2869a9e3d2b6b6f269',rulesHash:'1ae54891eed97354e1aaca931b44a7710c50ebe72a90fe9de178247a16dcb831'};
const vectorRow=()=>Object.fromEntries(TEACHER_MODEL.featureKeys.map(k=>[k,0]));
const syntheticDomain=()=>({...TEACHER_TRAIN_DOMAIN,verified:true,receiptSha256:'0'.repeat(64),verifiedCaptureCount:24,rulesEdition:'faq2026',engine:{...REQUIRED_ENGINE}});
const syntheticModel=()=>({...TEACHER_MODEL,scales:Array(396).fill(1),weights:Array(792).fill(0)});

test('compiled MODEL vectors and immutable encoder derivation roundtrip exactly to TRAIN sources',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../scripts/teacher-model-source.json',import.meta.url)));
 const modelBytes=readFileSync(new URL('./fixtures/teacher-train-source/MODEL.json',import.meta.url));
 assert.equal(hash(modelBytes),manifest.modelSha256);assert.equal(readFileSync(new URL('../src/teacher-model.mjs',import.meta.url),'utf8'),renderTeacherModel(modelBytes));const original=JSON.parse(modelBytes);
 for(const key of ['featureKeys','scales','weights'])assert.deepEqual(TEACHER_MODEL[key],original[key]);
 for(const source of manifest.featureSources){
  const originalBytes=readFileSync(new URL('./fixtures/teacher-train-source/'+source.sourcePath.split('/').at(-1),import.meta.url));assert.equal(hash(originalBytes),source.sourceSha256);
  const migrated=readFileSync(new URL('../src/'+source.destinationPath.split('/').at(-1),import.meta.url),'utf8');assert.equal(hash(migrated),source.sha256);
  assert.equal(migrated.replace("from '"+source.newImport+"'","from '"+source.oldImport+"'"),originalBytes.toString());
 }
 assert.equal(hash(readFileSync(new URL('../src/tactical-features.mjs',import.meta.url))),manifest.baseFeatureSha256);
 assert.equal(TEACHER_MODEL.weights.length,792);assert.equal(TEACHER_MODEL.featureKeys.length,396);
 assert.equal(Object.isFrozen(TEACHER_MODEL.weights),true);assert.equal(Object.isFrozen(TEACHER_MODEL.scales),true);
});
test('TRAIN scale and missing mask separate unknown null from known zero without online clipping',()=>{
 const m=syntheticModel(),r=vectorRow();m.scales[0]=4;r[m.featureKeys[0]]=null;r[m.featureKeys[1]]=0;
 let v=teacherFeatureVector(r,m);assert.equal(v.length,792);assert.equal(v[0],0);assert.equal(v[396],1);assert.equal(v[1],0);assert.equal(v[397],0);
 r[m.featureKeys[0]]=20;v=teacherFeatureVector(r,m);assert.equal(v[0],5);assert.equal(v[396],0);
});
test('dot score differences equal the explicit pairwise scaled-plus-mask design',()=>{
 const m=syntheticModel(),a=vectorRow(),b=vectorRow();m.scales[0]=2;m.weights[0]=3;m.weights[397]=-4;
 a[m.featureKeys[0]]=6;b[m.featureKeys[0]]=2;a[m.featureKeys[1]]=null;
 const scored=scoreTeacherFeatures([a,b],m);assert.deepEqual(scored.scores,[5,3]);assert.equal(scored.reference_index,0);
 const va=teacherFeatureVector(a,m),vb=teacherFeatureVector(b,m),margin=va.reduce((sum,x,i)=>sum+(x-vb[i])*m.weights[i],0);
 assert.equal(scored.scores[0]-scored.scores[1],margin);assert.equal(Object.hasOwn(scored,'source_choice_probabilities'),false);
});
test('exact ties remain unresolved and no score epsilon invents a reference winner',()=>{
 const m=syntheticModel(),a=vectorRow(),b=vectorRow();assert.equal(scoreTeacherFeatures([a,b],m).reference_index,null);
 m.weights[0]=1;b[m.featureKeys[0]]=Number.EPSILON;assert.equal(scoreTeacherFeatures([a,b],m).reference_index,1);
});
for(const [name,mutate] of [
 ['missing key',r=>{delete r[TEACHER_MODEL.featureKeys[0]];}],['extra key',r=>{r.futureOutcome=1;}],
 ['undefined',r=>{r[TEACHER_MODEL.featureKeys[0]]=undefined;}],['NaN',r=>{r[TEACHER_MODEL.featureKeys[0]]=NaN;}],
 ['Infinity',r=>{r[TEACHER_MODEL.featureKeys[0]]=Infinity;}]
])test(name+' refuses a teacher feature vector',()=>{const r=vectorRow();mutate(r);assert.throws(()=>teacherFeatureVector(r),/TEACHER_FEATURE_/);});
for(const [name,mutate] of [
 ['wrong weight count',m=>m.weights.pop()],['wrong scale count',m=>m.scales.pop()],['zero scale',m=>{m.scales[0]=0;}],
 ['nonfinite weight',m=>{m.weights[0]=NaN;}],['duplicate key',m=>{m.featureKeys=[...m.featureKeys];m.featureKeys[1]=m.featureKeys[0];}]
])test(name+' refuses the model contract',()=>{const m=syntheticModel();mutate(m);assert.throws(()=>scoreTeacherFeatures([vectorRow(),vectorRow()],m),/TEACHER_MODEL_CONTRACT_INVALID/);});

test('V3 uses own scoring/centerline coordinates and preserves unknown scoring map',()=>{
 const o=root(),f=preferenceFeaturesV3(o,move);assert.deepEqual(Object.keys(f).sort(),TEACHER_MODEL.featureKeys);
 assert.equal(f.actor_own_scoring_distance,17);assert.equal(f.actor_centerline_distance,0);assert.equal(f.path_end_own_scoring_distance,17);assert.equal(f.path_end_centerline_distance,1);
 assert.equal(Object.hasOwn(f,'actor_x'),false);assert.equal(Object.hasOwn(f,'own_forward_x_sign'),false);
 delete o.pitch.endZone;const missing=preferenceFeaturesV3(o,move);assert.equal(missing.actor_own_scoring_distance,null);assert.equal(missing.path_forward_progress,null);
 const b=root();b.team=b.active='B';b.ball={kind:'held',playerId:'B1'};const input={kind:'playerAction',playerId:'B1',action:'move',path:[{kind:'step',to:{x:8,y:6}}]};
 assert.equal(preferenceFeaturesV3(b,input).actor_own_scoring_distance,9);
});
test('encoder consumes only public root and literal input; labels/context/native odds are not features',()=>{
 const o=root(),clean=preferenceFeaturesV3(o,move),dirty=structuredClone(o);
 Object.assign(dirty,{seed:123,winner:'B',value:999,modelLabel:'preferred',coachContext:{future:'A'},rng:{next:6},nativeLaw:{pTouchdown:1}});
 dirty.players[0].futureSkill='dodge';assert.deepEqual(preferenceFeaturesV3(dirty,move),clean);
 for(const key of ['task_advance','task_protect','task_prevent_td'])assert.equal(clean[key],null);
 assert.equal(Object.values(clean).some(x=>Object.is(x,-0)),false);
});
test('V3 path geometry and unknown public zone facts are retained as encoded, not native odds',()=>{
 const o=root();delete o.players[1].tackleZone;const f=preferenceFeaturesV3(o,move);assert.equal(f.path_root_enemy_zone_count,null);
 assert.throws(()=>preferenceFeaturesV3(o,{...move,path:[{kind:'step',to:{x:12,y:10}}]}),/PUBLIC_PATH_GEOMETRY_INVALID/);
});
for(const [name,change,reason] of [
 ['API1',o=>{o.apiVersion=1;},'API_VERSION_OUTSIDE_TEACHER_PUBLIC_DOMAIN'],
 ['legacy',o=>{o.ruleset.rulesEdition=o.rulesEdition='legacy';},'TEACHER_RUNTIME_RULES_EDITION_UNSUPPORTED'],
 ['fingerprint',o=>{o.engine.apiHash='bad';},'RUNTIME_FINGERPRINT_MISMATCH'],
 // S4.37: the Match Lab runner apiHash and cross-mixed 7.0.1/7.0.1-cc1 engine/rules pairs stay outside the accepted runtime list.
 ['Match Lab runner apiHash',o=>{o.engine.apiHash=RUNNER_API;},'RUNTIME_FINGERPRINT_MISMATCH'],
 ['runner apiHash on cc1 engine/rules',o=>{Object.assign(o.engine,CC1_ENGINE,{apiHash:RUNNER_API});},'RUNTIME_FINGERPRINT_MISMATCH'],
 ['cc1 engineHash with 7.0.1 rulesHash',o=>{o.engine.engineHash=CC1_ENGINE.engineHash;},'RUNTIME_FINGERPRINT_MISMATCH'],
 ['7.0.1 engineHash with cc1 rulesHash',o=>{o.engine.rulesHash=CC1_ENGINE.rulesHash;},'RUNTIME_FINGERPRINT_MISMATCH'],
 ['foreign active',o=>{o.active='B';},'NOT_OWN_ACTIVE_SIDE'],
 ['pending',o=>{o.pending={type:'reroll'};},'PUBLIC_DECISION_DOMAIN_UNVERIFIED'],
 ['unknown activation',o=>{delete o.activation;},'PUBLIC_ACTIVATION_UNOBSERVED'],
 ['active Move',o=>{o.activation={playerId:'A1',action:'move'};},'OUTSIDE_TRAINED_ACTIVATION'],
 ['conflicting edition',o=>{o.rulesEdition='legacy';},'PUBLIC_RULES_EDITION_CONFLICT']
])test(name+' refuses the teacher runtime domain',()=>{const o=root();change(o);assert.equal(teacherPreferenceDomain(o,syntheticDomain()).admitted,false);assert.equal(teacherPreferenceDomain(o,syntheticDomain()).reason,reason);});

test('S4.37 the declared-equivalent cc1 GUI fingerprint is admitted against the same synthetic TRAIN identity',()=>{
 const o=root();Object.assign(o.engine,CC1_ENGINE);const d=teacherPreferenceDomain(o,syntheticDomain());
 assert.equal(d.admitted,true,d.reason);assert.equal(d.runtime_engine,'7.0.1-cc1');assert.equal(d.training_domain_receipt_sha256,'0'.repeat(64));
});

test('teacher ranking is a legal root subset reference only; native validate controls each endpoint',{skip:!TEACHER_TRAIN_DOMAIN.verified},async()=>{
 const o=root(),calls=[];const r=await tacticalShadow(o,[move,block,end],{validate:async(i,q)=>{calls.push([i,q]);return {ok:true,legal:i.kind==='endTurn',position:'root'};}},{deadline:Date.now()+10000});
 assert.equal(r.model_key,'teacherV3');assert.equal(r.model_invoked,true);assert.equal(r.ranked,false);assert.equal(r.accepted_candidates,1);
 assert.equal(r.action_executed,false);assert.equal(r.override,false);assert.equal(calls.length,3);
 assert.ok(r.rejections.some(x=>x.reason==='LIVE_INPUT_ILLEGAL'));
});
test('foreign validation source cannot qualify a high teacher score and never starts own exploration',{skip:!TEACHER_TRAIN_DOMAIN.verified},async()=>{
 const calls={explore:0};const r=await prepareLearnedProposal(root(),[{input:move},{input:block}],{
  validate:async()=>({ok:true,legal:true,position:'foreign'}),explore:async()=>{calls.explore++;throw Error('must not explore');}
 },{},Date.now()+20000);
 assert.equal(r.report.generated,false);assert.equal(r.line,null);assert.equal(calls.explore,0);
 assert.ok(r.report.learning.rejections.every(x=>x.reason==='VALIDATION_POSITION_MISMATCH'));
});
test('actual teacher reference partial own mass cannot become a common-pool certificate',{skip:!TEACHER_TRAIN_DOMAIN.verified},async()=>{
 const o=root(),inspector={canonical:x=>x,CFG:{optionalRush:1,unresolved:200},outcomeValue:()=>({value:1})};
 const services={validate:async(i,q={})=>({ok:true,legal:true,position:q.from??'root'}),explore:async(i,q)=>({ok:true,
  position:{key:q.from},perspective:'A',activeTeam:'A',outcomeIdentity:'complete-state-v1',decisionPolicy:{mode:'builtin',own:'builtin',opponent:'builtin'},
  exact:false,rest:{p:.2},unresolvedMass:.2,outcomes:[{key:'1.1',p:.8,active:'B',completed:true,turnover:false,touchdown:null,observation:{...o,active:'B'}}]})};
 const p=await prepareLearnedProposal(o,[{input:move},{input:block}],services,inspector,Date.now()+20000);
 assert.equal(p.report.generated,true);assert.equal(p.report.learning.model_key,'teacherV3');assert.equal(p.report.ownComplete,false);
 assert.equal(p.report.ownMass.rest,.2);assert.equal(p.report.ownMass.unresolved,.2);assert.equal(await bindLearnedForCommonPool(o,{mode:'normal'},p,services,inspector,Date.now()+20000),null);
});
test('old Handoff model remains separate from teacherV3 and raw teacher domain refuses it',async()=>{
 const o=root();o.activation={playerId:'A1',action:'handoff',maUsed:0,over:false};
 assert.equal(teacherPreferenceDomain(o).admitted,false);assert.equal(learningDomain(o).training_rulesEdition,'legacy');
 const handoff={kind:'playerAction',playerId:'A1',action:'handoff',path:[],handoffTarget:'B1'};
 const r=await tacticalShadow(o,[handoff,{kind:'endActivation'}],{validate:async()=>({ok:true,legal:true,position:'root'})},{deadline:Date.now()+10000});
 assert.equal(r.model_key,'handoff479');assert.equal(r.model_sha256,'849265bba89946e3b24062983a5f583e67730bcf9ee2af7511c9354976069fad');
 assert.equal(r.override,false);assert.equal(r.action_executed,false);
});

test('pending compiled TRAIN domain fails closed before model work or native calls',{skip:TEACHER_TRAIN_DOMAIN.verified},async()=>{
 let called=0;const r=await tacticalShadow(root(),[move,block,end],{validate:async()=>{called++;throw Error('pending domain must not validate');}},{deadline:Date.now()+10000});
 assert.equal(r.ranked,false);assert.equal(r.model_invoked,false);assert.equal(r.reason,'TEACHER_TRAIN_DOMAIN_RECEIPT_UNVERIFIED');assert.equal(called,0);
});
test('synthetic domain identity fixtures validate every frozen model/TRAIN/source binding, not current edition guesses',()=>{
 assert.equal(teacherPreferenceDomain(root(),syntheticDomain()).admitted,true);
 for(const key of ['receiptSha256','modelSha256','featureSourceSha256','datasetSha256','verificationSha256','fitFreezeSha256','runtimeSha256','rulesEdition','verifiedCaptureCount']){
  const proof=syntheticDomain();proof[key]=null;assert.equal(teacherPreferenceDomain(root(),proof).reason,'TEACHER_TRAIN_DOMAIN_RECEIPT_UNVERIFIED',key);
 }
 const proof=syntheticDomain();proof.engine.rulesHash='fake';assert.equal(teacherPreferenceDomain(root(),proof).admitted,false);
});
