import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {REQUIRED_ENGINE} from '../src/tactical-models.mjs';
import {ACCEPTED_RUNTIME_ENGINES,runtimeEngine,TRAINING_ENGINE} from '../src/runtime-engines.mjs';
import {TEACHER_TRAIN_DOMAIN} from '../src/teacher-domain.mjs';
import {learningDomain,teacherPreferenceDomain} from '../src/learning-domain.mjs';
import {tacticalShadow} from '../src/tactical-shadow.mjs';
import {prepareLearnedProposal} from '../src/learned-proposal.mjs';
// S4.37 explicit engine compatibility. Training domain: Bloodboard 7.0.1 GUI. Runtime: 7.0.1 GUI or 7.0.1-cc1 GUI
// (declared bit-exact equivalent), each on an exact three-hash match. Everything else stays rejected.
const GUI701={version:'7.0.1',engineHash:'015f6879ad93c03e810a71d7e541aad5da71f93839eb84951a0979d242ab7754',rulesHash:'d75586a708201fdbaa93e051d501bc1b6e604cf77e540d5d9611ba42418fc47e',apiHash:'cc8878821f67091585f79e6553b67cd01b2794235e73c33f2dcb0d43e607dd97'};
const GUICC1={version:'7.0.1-cc1',engineHash:'363a910be141a2c613fafb40021cb7f6d2f3f7bb72f55d2869a9e3d2b6b6f269',rulesHash:'1ae54891eed97354e1aaca931b44a7710c50ebe72a90fe9de178247a16dcb831',apiHash:GUI701.apiHash};
const RUNNER='f51ae035be08e69190356db2f4cf18599c3050acd9d0075965c147bfb301b8f8';
const ARCHIVED_V6={version:'6.0.0-dev',engineHash:'c67a6dff7e0f0181c7fa32c05bb7a66fd1ee51f8ed574ffcb8a9a7e63efc2b96',rulesHash:'f30d05d600c9d94909a87b731dbb4608b371bcc13aa488b56cb1761b78341b54',apiHash:'517297804b7a6141574e5694b0fb780a78d67588aff8bfee7ad8e5b630561eba'};
const player=(id,team,x,y)=>({id,team,location:'pitch',stance:'standing',pos:{x,y},ma:6,st:3,ag:3,skills:[],activated:false,distracted:false,tackleZone:true});
const root=engine=>({apiVersion:2,engine:{...engine},ruleset:{rulesEdition:'faq2026'},rulesEdition:'faq2026',team:'A',active:'A',phase:'play',pending:null,activation:null,format:'standard',half:1,drive:1,
 pitch:{width:26,height:15,endZone:{A:25,B:0}},teams:{A:{score:0,turn:1,rerolls:2},B:{score:0,turn:0,rerolls:2}},used:{},ball:{kind:'held',playerId:'A1'},players:[player('A1','A',8,7),player('B1','B',9,7)]});
const handoffRoot=engine=>{const o=root(engine);o.activation={playerId:'A1',action:'handoff',maUsed:0,over:false};return o;};
const move={kind:'playerAction',playerId:'A1',action:'move',path:[{kind:'step',to:{x:8,y:6}}]},block={kind:'playerAction',playerId:'A1',action:'block',path:[],blockTarget:'B1'},end={kind:'endTurn'};
const HASHES=['engineHash','rulesHash','apiHash'];

test('training pin unchanged: TRAINING_ENGINE is the 7.0.1 GUI REQUIRED_ENGINE and the TRAIN receipt carries it',()=>{
 assert.equal(TRAINING_ENGINE,REQUIRED_ENGINE);
 assert.deepEqual({...TRAINING_ENGINE},{engineHash:GUI701.engineHash,rulesHash:GUI701.rulesHash,apiHash:GUI701.apiHash});
 assert.equal(TEACHER_TRAIN_DOMAIN.engine.version,'7.0.1');for(const k of HASHES)assert.equal(TEACHER_TRAIN_DOMAIN.engine[k],GUI701[k]);
});
test('accepted runtime list is frozen with exactly four named runtime identities; loop1 remains experimental',()=>{
 assert.equal(ACCEPTED_RUNTIME_ENGINES.length,4);
 assert.ok(Object.isFrozen(ACCEPTED_RUNTIME_ENGINES)&&ACCEPTED_RUNTIME_ENGINES.every(Object.isFrozen));
 const [a,b]=ACCEPTED_RUNTIME_ENGINES;
 assert.deepEqual({id:a.id,relation:a.relation,...Object.fromEntries(HASHES.map(k=>[k,a[k]]))},{id:'7.0.1',relation:'training-domain',engineHash:GUI701.engineHash,rulesHash:GUI701.rulesHash,apiHash:GUI701.apiHash});
 assert.deepEqual({id:b.id,relation:b.relation,...Object.fromEntries(HASHES.map(k=>[k,b[k]]))},{id:'7.0.1-cc1',relation:'declared-bit-exact-equivalent-of-7.0.1',engineHash:GUICC1.engineHash,rulesHash:GUICC1.rulesHash,apiHash:GUICC1.apiHash});
 assert.equal(b.evidence,'engine-candidates/bloodboard-7.0.1-cc1/VERIFICATION.md');
 assert.ok(!ACCEPTED_RUNTIME_ENGINES.some(e=>e.apiHash===RUNNER),'the Match Lab runner apiHash is never listed');
 assert.throws(()=>{ACCEPTED_RUNTIME_ENGINES.push({id:'x'});},TypeError);assert.throws(()=>{ACCEPTED_RUNTIME_ENGINES[1].apiHash=RUNNER;},TypeError);
 assert.equal(runtimeEngine({...GUICC1,apiHash:RUNNER}),null);
});
const evidence=new URL('../../../engine-candidates/bloodboard-7.0.1-cc1/VERIFICATION.md',import.meta.url);
test('the cc1 evidence document names the admitted cc1 hashes (repository checkout only)',{skip:!existsSync(evidence)},()=>{
 const text=readFileSync(evidence,'utf8');
 assert.ok(text.includes(GUICC1.engineHash.slice(0,16))&&text.includes(GUICC1.rulesHash.slice(0,16))&&text.includes(GUICC1.apiHash.slice(0,12)));
});
for(const [name,engine,id,relation] of [['GUI 7.0.1',GUI701,'7.0.1','training-domain'],['GUI 7.0.1-cc1',GUICC1,'7.0.1-cc1','declared-bit-exact-equivalent-of-7.0.1']])
 test(name+' admitted for the teacher and the Handoff domain; training receipt and runtime sha unchanged',()=>{
  const t=teacherPreferenceDomain(root(engine));assert.equal(t.admitted,true,t.reason);
  assert.equal(t.runtime_engine,id);assert.equal(t.runtime_engine_relation,relation);
  assert.equal(t.training_domain_receipt_sha256,TEACHER_TRAIN_DOMAIN.receiptSha256);assert.equal(t.training_rulesEdition,'faq2026');
  assert.equal(t.training_runtime_sha256,'26e02ac996afc5f6b18992a4893049366e37ec76f6fdfccdfdfc7fe1c48b9406');
  const h=learningDomain(handoffRoot(engine));assert.equal(h.admitted,true,h.reason);
  assert.equal(h.runtime_engine,id);assert.equal(h.runtime_engine_relation,relation);assert.equal(h.training_rulesEdition,'legacy');
  assert.equal(runtimeEngine(engine).id,id);
 });
test('the runtime id comes from the accepted list, never from the host version label',()=>{
 assert.equal(runtimeEngine({...GUICC1,version:'7.0.1'}).id,'7.0.1-cc1');
 assert.equal(runtimeEngine({...GUI701,version:'7.0.1-cc1'}).id,'7.0.1');
 assert.equal(runtimeEngine({version:'7.0.1-cc1'}),null);
});
for(const [name,engine] of [
 ['Match Lab runner 7.0.1',{...GUI701,apiHash:RUNNER}],['Match Lab runner 7.0.1-cc1',{...GUICC1,apiHash:RUNNER}],
 ['cc1 engineHash + 7.0.1 rulesHash',{...GUI701,engineHash:GUICC1.engineHash}],['7.0.1 engineHash + cc1 rulesHash',{...GUI701,rulesHash:GUICC1.rulesHash}],
 ['missing apiHash',{engineHash:GUI701.engineHash,rulesHash:GUI701.rulesHash}],['upper-case hex',{...GUICC1,engineHash:GUICC1.engineHash.toUpperCase()}],
 ['archived v6',ARCHIVED_V6],['hashes as non-strings',{engineHash:[GUI701.engineHash],rulesHash:GUI701.rulesHash,apiHash:GUI701.apiHash}]])
 test(name+' rejected for the teacher and the Handoff domain',()=>{
  assert.equal(runtimeEngine(engine),null);
  const t=teacherPreferenceDomain(root(engine));assert.equal(t.admitted,false);assert.equal(t.reason,'RUNTIME_FINGERPRINT_MISMATCH');
  assert.equal(Object.hasOwn(t,'runtime_engine'),false);
  assert.equal(learningDomain(handoffRoot(engine)).reason,'RUNTIME_FINGERPRINT_MISMATCH');
 });
test('non-object fingerprints are rejected; an absent fingerprint keeps its API1 reason',()=>{
 for(const x of [null,undefined,'7.0.1-cc1',42,true])assert.equal(runtimeEngine(x),null);
 const o=root(GUICC1);delete o.engine;assert.equal(teacherPreferenceDomain(o).reason,'RUNTIME_IDENTITY_UNOBSERVED_IN_API1');
 const o2=root(GUICC1);o2.engine='7.0.1-cc1';assert.equal(teacherPreferenceDomain(o2).reason,'RUNTIME_FINGERPRINT_MISMATCH');
});
test('the training receipt cannot be relabelled to cc1 (training pin is separate from the runtime list)',()=>{
 const proof={...TEACHER_TRAIN_DOMAIN,engine:{...GUICC1}};
 assert.equal(teacherPreferenceDomain(root(GUI701),proof).reason,'TEACHER_TRAIN_DOMAIN_RECEIPT_UNVERIFIED');
 assert.equal(teacherPreferenceDomain(root(GUICC1),proof).reason,'TEACHER_TRAIN_DOMAIN_RECEIPT_UNVERIFIED');
});
test('a runner-style observation without ruleset.rulesEdition is never admitted; the edition is not synthesised',()=>{
 const strip=o=>{delete o.ruleset.rulesEdition;delete o.rulesEdition;return o;};
 // Even under an accepted fingerprint the unobserved edition refuses; under the runner fingerprint the hash refuses first.
 for(const engine of [GUI701,GUICC1]){
  assert.equal(teacherPreferenceDomain(strip(root(engine))).reason,'PUBLIC_RULES_EDITION_UNOBSERVED');
  assert.equal(learningDomain(strip(handoffRoot(engine))).reason,'PUBLIC_RULES_EDITION_UNOBSERVED');
 }
 assert.equal(teacherPreferenceDomain(strip(root({...GUI701,apiHash:RUNNER}))).reason,'RUNTIME_FINGERPRINT_MISMATCH');
 const o=strip(root(GUICC1));teacherPreferenceDomain(o);learningDomain(o);assert.equal(o.ruleset.rulesEdition,undefined);assert.equal(o.rulesEdition,undefined);
});
test('identical scores, reference input and validate transcript under the 7.0.1 and cc1 fingerprints',{skip:!TEACHER_TRAIN_DOMAIN.verified},async()=>{
 const run=async engine=>{const calls=[];const r=await tacticalShadow(root(engine),[move,block,end],{validate:async(i,q)=>{calls.push(JSON.stringify([i,q]));return {ok:true,legal:true,position:'root'};}},{deadline:Date.now()+10000});return {r,calls};};
 const a=await run(GUI701),b=await run(GUICC1);
 assert.equal(a.r.ranked,true,a.r.reason);assert.equal(b.r.ranked,true,b.r.reason);
 assert.deepEqual(b.r.scores,a.r.scores);assert.deepEqual(b.r.reference_input,a.r.reference_input);assert.deepEqual(b.r.rankRows,a.r.rankRows);
 assert.deepEqual(b.calls,a.calls);assert.ok(a.calls.length>=2);
 assert.equal(a.r.learning_domain.runtime_engine,'7.0.1');assert.equal(b.r.learning_domain.runtime_engine,'7.0.1-cc1');
 const {runtime_engine:x,runtime_engine_relation:y,...restA}=a.r.learning_domain,{runtime_engine:x2,runtime_engine_relation:y2,...restB}=b.r.learning_domain;
 assert.deepEqual(restB,restA,'the domain record differs only in the runtime engine fields');
 const p=await prepareLearnedProposal(root(GUICC1),[{input:move},{input:block}],{validate:async()=>({ok:true,legal:true,position:'foreign'}),explore:async()=>{throw Error('no');}},{},Date.now()+20000);
 assert.equal(p.report.learning.model_invoked,true);assert.equal(p.report.learning.learning_domain.runtime_engine,'7.0.1-cc1');
});

const LOOP1={...GUICC1,version:'7.0.1-cc1-loop1',apiHash:'da7ab681dfa1b1f031239759f6286ddd2897dd734109df0673d8eae721d656d4'};
test('S4.37 loop1 exact runtime admitted without changing training receipt; each mixed hash rejected',()=>{
 const d=teacherPreferenceDomain(root(LOOP1));assert.equal(d.admitted,true,d.reason);assert.equal(d.runtime_engine,'7.0.1-cc1-loop1');
 assert.equal(d.training_domain_receipt_sha256,TEACHER_TRAIN_DOMAIN.receiptSha256);
 assert.equal(ACCEPTED_RUNTIME_ENGINES[2].apiHash,LOOP1.apiHash);
 for(const k of HASHES)assert.equal(runtimeEngine({...LOOP1,[k]:'0'.repeat(64)}),null);
 const missing=root(LOOP1);delete missing.rulesEdition;delete missing.ruleset.rulesEdition;
 assert.equal(teacherPreferenceDomain(missing).admitted,false);
});
