import {TEACHER_MODEL} from './teacher-model.mjs';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const fail=reason=>{throw Error(reason);};
function freeze(x){if(x&&typeof x==='object'&&!Object.isFrozen(x)){Object.freeze(x);for(const v of Object.values(x))freeze(v);}}
freeze(TEACHER_MODEL);
function modelContract(model){
 if(model?.schema!=='engine-search-teacher-v3-train-only-smoke-model/1'||
  !Array.isArray(model.featureKeys)||model.featureKeys.length!==396||new Set(model.featureKeys).size!==396||
  model.featureKeys.some((k,i)=>typeof k!=='string'||i>0&&model.featureKeys[i-1]>=k)||
  !Array.isArray(model.scales)||model.scales.length!==396||model.scales.some(x=>!finite(x)||x<=0)||
  !Array.isArray(model.weights)||model.weights.length!==792||model.weights.some(x=>!finite(x)))fail('TEACHER_MODEL_CONTRACT_INVALID');
}
/** Null is unknown, known zero is not. Never scale/clip from live candidates. */
export function teacherFeatureVector(features,model=TEACHER_MODEL){
 modelContract(model);
 if(!features||typeof features!=='object'||Array.isArray(features)||
  Object.keys(features).sort().join('\0')!==model.featureKeys.join('\0'))fail('TEACHER_FEATURE_SCHEMA_KEYS_MISMATCH');
 const xs=model.featureKeys.map(k=>features[k]);
 if(xs.some(x=>x!==null&&!finite(x)))fail('TEACHER_FEATURE_VALUE_INVALID');
 const vector=xs.map((x,i)=>x===null?0:x/model.scales[i]).concat(xs.map(x=>Number(x===null)));
 if(vector.some(x=>!finite(x)))fail('TEACHER_FEATURE_VECTOR_NONFINITE');
 return vector;
}
/** Frozen pairwise logits rank proposals only; no probability/value certificate. */
export function scoreTeacherFeatures(rows,model=TEACHER_MODEL){
 if(!Array.isArray(rows)||rows.length<2)fail('TEACHER_MODEL_OR_POOL_INVALID');
 const scores=rows.map(row=>teacherFeatureVector(row,model).reduce((sum,x,i)=>sum+x*model.weights[i],0));
 if(scores.some(x=>!finite(x)))fail('TEACHER_MODEL_SCORE_NONFINITE');
 const best=Math.max(...scores),winners=scores.flatMap((x,i)=>x===best?[i]:[]);
 return {scores,reference_index:winners.length===1?winners[0]:null,model_sha256:model.modelSha256,
  encoder_sha256:model.featureSourceSha256,feature_count:396,weight_count:792,
  score_semantics:'uncalibrated-engine-search-teacher-pairwise-preference-logit',probability_semantics:'none; score differences are preference margins, not native chance or safety'};
}
