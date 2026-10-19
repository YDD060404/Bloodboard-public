import {TACTICAL_MODELS,REQUIRED_ENGINE} from './tactical-models.mjs';
import {learningDomain,teacherPreferenceDomain} from './learning-domain.mjs';
import {preferenceFeaturesV3} from './teacher-features.mjs';
import {scoreTeacherFeatures} from './teacher-ranker.mjs';
import {TEACHER_MODEL} from './teacher-model.mjs';
import {tacticalFeatures} from './tactical-features.mjs';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const canonical=x=>x&&typeof x==='object'?Array.isArray(x)?x.map(canonical):Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const key=x=>JSON.stringify(canonical(x));
function freeze(x){if(x&&typeof x==='object'&&!Object.isFrozen(x)){Object.freeze(x);for(const v of Object.values(x))freeze(v);}}
for(const m of Object.values(TACTICAL_MODELS)){m.weights=[];for(let i=0;i<m.weight_pairs.length;i+=2)m.weights.push(m.weight_pairs[i],m.weight_values[m.weight_pairs[i+1]]);m.scales=Array(m.n).fill(1);for(let i=0;i<m.scale_pairs.length;i+=2)m.scales[m.scale_pairs[i]]=m.scale_pairs[i+1];}
freeze(TACTICAL_MODELS);freeze(REQUIRED_ENGINE);
/** Same fixed-model arithmetic, deployed sparse without quantization or fitting. */
export function scoreTacticalFeatures(rows,modelKey){
 const m=TACTICAL_MODELS[modelKey];if(!m||!Array.isArray(rows)||rows.length<2)throw Error('MODEL_OR_POOL_INVALID');
 const names=Object.keys(rows[0]).sort();
 if(names.length!==m.n||rows.some(r=>key(Object.keys(r).sort())!==key(names)))throw Error('FEATURE_SCHEMA_KEYS_MISMATCH');
 const vectors=rows.map(r=>{
  const xs=names.map(n=>r[n]);if(xs.some(v=>v!==null&&!finite(v)))throw Error('FEATURE_VALUE_INVALID');
  return xs.map((v,i)=>v===null?0:v/m.scales[i]).concat(xs.map(v=>Number(v===null)));
 });
 if(m.context_keys.length){
  const ci=m.context_keys.map(k=>names.indexOf(k)),bi=m.candidate_keys.map(k=>names.indexOf(k));
  if([...ci,...bi].includes(-1)||ci.some(k=>vectors.some(v=>v[k]!==vectors[0][k]||v[k+m.n]!==vectors[0][k+m.n])))throw Error('COMMON_CONTEXT_MISMATCH');
  for(const v of vectors)for(const b of bi)for(const c of ci)v.push(m.gain*v[b]*v[c],m.gain*v[b]*v[c+m.n],m.gain*v[b+m.n]*v[c],m.gain*v[b+m.n]*v[c+m.n]);
 }
 const scores=vectors.map(v=>{let s=0;for(let k=0;k<m.weights.length;k+=2)s+=m.weights[k+1]*v[m.weights[k]];return s;});
 if(scores.some(s=>!finite(s)))throw Error('MODEL_SCORE_NONFINITE');
 const max=Math.max(...scores),es=scores.map(s=>Math.exp(s-max)),sum=es.reduce((s,x)=>s+x,0),probabilities=es.map(x=>x/sum);
 const best=Math.max(...probabilities),winners=probabilities.flatMap((p,i)=>p===best?[i]:[]);
 return {scores,source_choice_probabilities:probabilities,reference_index:winners.length===1?winners[0]:null,model_sha256:m.spec.model_sha256};
}
/** A closed reference channel. It cannot select/execute an action or save a plan. */
export async function tacticalShadow(o,inputs,services,{deadline=Date.now()+250,selectedInput=null}={}){
 const start=Date.now(),report={mode:'shadow',override:false,action_executed:false,ranked:false,model_invoked:false,model_inference_calls:0,task_context:'unknown; no historical label or inferred expert intention',candidate_limit:8,candidates_seen:inputs?.length??0,rejections:[]};
 const reject=reason=>({...report,reason,elapsed_ms:Date.now()-start});
 const teacher=o?.activation===null,domain=teacher?teacherPreferenceDomain(o):learningDomain(o);report.learning_domain=domain;
 if(!domain.admitted)return reject(domain.reason);
 report.runtime_fingerprint_observed=true;report.runtime_artifact_sha_verified=false;
 if(!Object.hasOwn(o,'activation'))return reject('PUBLIC_ACTIVATION_UNOBSERVED');
 const modelKey=teacher?'teacherV3':'handoff479';
 if(!teacher&&!TACTICAL_MODELS[modelKey].deployment_admitted)return reject('MODEL_TRAINING_PUBLIC_PARITY_FAILED');
 const project=teacher?preferenceFeaturesV3:tacticalFeatures,score=teacher?rows=>scoreTeacherFeatures(rows):rows=>scoreTacticalFeatures(rows,modelKey);
 const modelSha=teacher?TEACHER_MODEL.modelSha256:TACTICAL_MODELS[modelKey].spec.model_sha256;
 if(typeof services?.validate!=='function')return reject('LEGAL_VALIDATOR_UNAVAILABLE');
 const unique=[],seen=new Set();
 for(const input of [selectedInput,...(o.activation?.action==='handoff'?[{kind:'endActivation'}]:[]),...(inputs??[])])if(input){const k=key(input);if(!seen.has(k)){seen.add(k);unique.push(input);}}
 report.unique_candidates=unique.length;report.pruned_by_pool_limit=0;report.unrepresented_candidates=0;
 const proposed=[];
 for(const [i,input] of unique.entries()){
  if(Date.now()>=deadline-40)return reject('SHADOW_CANDIDATE_PROJECTION_DEADLINE');
  let f;try{f=project(o,input);}catch(e){report.unrepresented_candidates++;report.rejections.push({index:i,reason:String(e.message)});continue;}
  proposed.push({index:i,input,features:f});
 }
 report.represented_candidates=proposed.length;
 if(proposed.length<2)return reject('FEWER_THAN_TWO_REPRESENTED_LEGAL_INPUTS');
 let preliminary;
 try{report.model_invoked=true;report.model_inference_calls++;report.model_key=modelKey;report.model_sha256=modelSha;preliminary=score(proposed.map(c=>c.features));}catch(e){return reject(String(e.message));}
 const current=proposed.find(c=>key(c.input)===key(selectedInput));
 const ordered=proposed.map((c,i)=>({...c,score:preliminary.scores[i]})).sort((a,b)=>b.score-a.score||key(a.input).localeCompare(key(b.input)));
 const pool=[...(current?[current]:[]),...ordered.filter(c=>c!==current&&key(c.input)!==key(selectedInput))].slice(0,8);
 report.pruned_by_pool_limit=proposed.length-pool.length;report.pool_selection='fixed learned score before capacity; current action retained as candidate';
 const accepted=[],features=[];
 for(const {index:i,input,features:f} of pool){
  if(Date.now()>=deadline-40){report.rejections.push({index:i,reason:'SHADOW_SHARED_DEADLINE'});continue;}
  let result;try{result=await services.validate(input,{});}catch{report.rejections.push({index:i,reason:'LIVE_VALIDATION_SERVICE_FAILED'});continue;}
  if(result?.ok!==true||result.legal!==true||result.position!=='root'){report.rejections.push({index:i,reason:result?.position&&result.position!=='root'?'VALIDATION_POSITION_MISMATCH':result?.ok===true?'LIVE_INPUT_ILLEGAL':'LIVE_VALIDATION_FAILED'});continue;}
  if(Date.now()>=deadline){report.rejections.push({index:i,reason:'SHADOW_VALIDATION_DEADLINE'});continue;}
  accepted.push(input);features.push(f);
 }
 report.accepted_candidates=accepted.length;
 if(accepted.length<2)return reject('FEWER_THAN_TWO_REPRESENTED_LEGAL_INPUTS');
 let scored;
 try{report.model_inference_calls++;scored=score(features);}catch(e){return reject(String(e.message));}
 const reference=scored.reference_index===null?null:accepted[scored.reference_index];
 return {...report,...scored,model_key:modelKey,ranked:true,rankRows:accepted.map((input,index)=>({input,inputKey:key(input),acceptedIndex:index,score:scored.scores[index],rank:1+scored.scores.filter(score=>score>scored.scores[index]).length,scope:'model accepted subset; ties share rank, not a policy value'})),reference_input:reference,agreement:reference?key(reference)===key(selectedInput):null,reason:reference?teacher?'UNPROMOTED_TEACHER_REFERENCE_ONLY':'UNPROMOTED_LEARNED_REFERENCE_ONLY':'UNRESOLVED_EQUAL_SCORE_TIE',elapsed_ms:Date.now()-start,scope:teacher?'bounded legal subset, uncalibrated teacher pairwise logits; no value/probability/safety/optimality or strength certificate':'bounded legal subset, imitation probability; no value/safety/optimality or strength certificate'};
}
