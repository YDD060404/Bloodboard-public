import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {ACCEPTED_RUNTIME_ENGINES,runtimeEngine,TRAINING_ENGINE} from '../src/runtime-engines.mjs';
import {TEACHER_TRAIN_DOMAIN} from '../src/teacher-domain.mjs';
import {teacherPreferenceDomain} from '../src/learning-domain.mjs';
const fp=JSON.parse(readFileSync(new URL('../../unified-source/dist/web/build-info.json',import.meta.url))).fingerprint;
const root=engine=>({engine,ruleset:{rulesEdition:'faq2026'},rulesEdition:'faq2026',apiVersion:2,activation:null,pending:null,phase:'play',team:'A',active:'A',format:'standard',pitch:{width:26,height:15}});
test('S4.37U exact unified fingerprint admitted; closed list frozen',()=>{
 assert.equal(ACCEPTED_RUNTIME_ENGINES.length,4);assert.ok(Object.isFrozen(ACCEPTED_RUNTIME_ENGINES));assert.ok(Object.isFrozen(ACCEPTED_RUNTIME_ENGINES[0]));
 assert.equal(runtimeEngine(fp).id,'0.2.0');assert.equal(runtimeEngine(fp).relation,'rules-repair-compatible; Glotl continuation corrected');
 assert.equal(teacherPreferenceDomain(root(fp)).admitted,true);
});
test('S4.37U mixed hashes rejected; historical exact identities retained',()=>{
 for(const k of ['engineHash','rulesHash','apiHash']){
  assert.equal(runtimeEngine({...fp,[k]:TRAINING_ENGINE[k]}),null);
  assert.equal(runtimeEngine({...fp,[k]:undefined}),null);
  assert.equal(runtimeEngine({...fp,[k]:fp[k].toUpperCase()}),null);
 }
 assert.equal(runtimeEngine(TRAINING_ENGINE).id,'7.0.1');
});
test('TRAIN receipt and frozen model source bytes unchanged from accepted S4.37',()=>{
 for(const file of ['teacher-domain.mjs','teacher-model.mjs','tactical-models.mjs','learned-model.mjs']){
  const original=new URL('../../../../AI-development/Hopeful-next-20261015/local-evaluation/s437-engine-compat/source/src/'+file,import.meta.url);
  assert.deepEqual(readFileSync(new URL('../src/'+file,import.meta.url)),readFileSync(original),file);
 }
 assert.equal(TEACHER_TRAIN_DOMAIN.engine.version,'7.0.1');
 const proof={...TEACHER_TRAIN_DOMAIN,engine:fp};assert.equal(teacherPreferenceDomain(root(fp),proof).reason,'TEACHER_TRAIN_DOMAIN_RECEIPT_UNVERIFIED');
});
