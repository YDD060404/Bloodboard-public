import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const expectedModelSha='fae8af896aaec15fe0817036085eea74ccfd8f4b5e1ae996710ed903f7375aec';
const sha=x=>createHash('sha256').update(x).digest('hex');
/** Build-time source derivation only. Never opens TEST, raw, labels or fits. */
export function renderTeacherModel(bytes){
 assert.equal(sha(bytes),expectedModelSha,'Frozen TRAIN MODEL changed');
 const model=JSON.parse(String(bytes));assert.equal(model.featureSourceSha256,'c3e8071f136cc70ee247fe9f1c2da3564c6d2e5f90e02d6e4304bf7250a48f2d');
 assert.equal(model.featureKeys.length,396);assert.equal(new Set(model.featureKeys).size,396);assert.equal(model.scales.length,396);assert.equal(model.weights.length,792);
 assert.ok(model.scales.every(x=>Number.isFinite(x)&&x>0)&&model.weights.every(Number.isFinite));
 return '// Frozen TRAIN MODEL JSON literal, preserved exactly; flags describe that artifact, not candidate acceptance.\nconst FROZEN_TRAIN_MODEL='+String(bytes).trim()+';\nexport const TEACHER_MODEL={modelSha256:'+JSON.stringify(expectedModelSha).replaceAll('"',"'")+',...FROZEN_TRAIN_MODEL};\n';
}
export function reverseTeacherEncoder(source,entry){
 const before="from '"+entry.newImport+"'",after="from '"+entry.oldImport+"'";
 assert.equal(source.split(before).length,2,'Exactly one reversible encoder import required');
 const original=source.replace(before,after);assert.equal(sha(original),entry.sourceSha256);return original;
}
export function verifyTeacherSources(){
 const manifest=JSON.parse(readFileSync(new URL('./teacher-model-source.json',import.meta.url)));
 const model=readFileSync(new URL('../../../'+manifest.modelPath,import.meta.url));
 assert.equal(readFileSync(new URL('../src/teacher-model.mjs',import.meta.url),'utf8'),renderTeacherModel(model));
 for(const entry of manifest.featureSources){
  const migrated=readFileSync(new URL('../../'+entry.destinationPath,import.meta.url),'utf8');assert.equal(sha(migrated),entry.sha256);
  assert.equal(reverseTeacherEncoder(migrated,entry),readFileSync(new URL('../../../'+entry.sourcePath,import.meta.url),'utf8'));
 }
 assert.equal(sha(readFileSync(new URL('../src/tactical-features.mjs',import.meta.url))),manifest.baseFeatureSha256);
 return {modelSha256:expectedModelSha,featureCount:396,weightCount:792,sourceVerified:true};
}
