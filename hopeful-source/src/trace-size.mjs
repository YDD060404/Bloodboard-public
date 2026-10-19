import {same} from './policy.mjs';
import {encodeBoundedData,decodeBoundedData} from './execution.mjs';
// The host replaces traces over40000 characters wholesale. Share exact repeated
// diagnostic objects by JSON pointer; never round numbers or discard refusals.
// Structured-clone transport retains optional undefined values. Dictionary
// frames use JSON diagnostic missing-field semantics. Invalid numbers remain
// explicit nonnumeric evidence rather than silently turning into null.
const copied=x=>Array.isArray(x)?Array.from(x,v=>v===undefined?null:copied(v)):
 typeof x==='number'&&!Number.isFinite(x)?{traceNonFiniteScalar:String(x),usableAsNumber:false}:x&&typeof x==='object'?
 Object.fromEntries(Object.entries(x).filter(([k,v])=>k!=='interpretation'&&v!==undefined).map(([k,v])=>[k,copied(v)])):x;
const pointerKey=k=>k.replace(/~/g,'~0').replace(/\//g,'~1');
export function learningTraceForHost(trace,{deferPhaseTables=false}={}){
 const out=copied(trace),common=out.commonComparison;
 if(common?.pool){
  delete common.candidateInputs;
  common.ranked=(common.ranked||[]).map(r=>{
   // A prior wire trace may already omit this duplicate input. Retain its
   // index only when the unique candidate identity verifies the same row.
   const verifiedOmission=r.input===undefined&&r.candidateId!==undefined&&Number.isSafeInteger(r.policy_index)&&
    common.pool[r.policy_index]?.candidateId===r.candidateId&&common.pool.filter(p=>p.candidateId===r.candidateId).length===1;
   const matches=common.pool.flatMap((p,i)=>(verifiedOmission||same(p.input,r.input))&&
    (r.candidateId===undefined||p.candidateId===r.candidateId)&&
    (r.policy_variant===undefined||p.policy_variant===r.policy_variant)&&
    (r.source===undefined||p.source===r.source)?[i]:[]);
   const provided=Number.isSafeInteger(r.policy_index)&&matches.includes(r.policy_index);
   const index=provided?r.policy_index:r.policy_index===undefined&&matches.length===1?matches[0]:null;
   return {...r,policy_index:index,...(index===null?{identityStatus:matches.length>1?'ambiguous-policy-identity':'unverified-policy-identity',matching_policy_indices:matches}:{input:undefined})};
  });
  for(const p of common.pool)for(const r of p.reply||[])if(r.carrierThreat){
   const c=r.carrierThreat;
   r.carrierThreat={attackerId:c.attackerId,pTurnover:c.pTurnover,pTargetDown:c.pTargetDown,
    pBallFreed:c.pBallFreed,pCrowd:c.pCrowd,exact:c.exact,unresolved:c.unresolved,possessionUnknown:c.possessionUnknown};
  }
 }
 const seen=new Map();let references=0;
 const frameFor=value=>{
  const data=encodeBoundedData(value);
  // The raw JSON limit alone does not guarantee that shape defaults satisfy
  // the decoder's independent node/depth budget. Accept only readable frames.
  decodeBoundedData(data);
  return {traceData:'bounded-dictionary-lz/v1',data};
 };
 const encodeDiagnostic=(value,key)=>{
  // Keep phase witness rows and commonTurnPool plain until their enclosing
  // field is encoded: nested base64 cannot share enclosing shape defaults.
  if(value!==undefined&&['endpointAudits','replyMeasurements','scoringIntervals','endpointValueAudit',...(!deferPhaseTables?['candidateServiceCosts','phases']:[])].includes(key)&&JSON.stringify(value).length>2000){
   try{const packed=frameFor(value);
    if(JSON.stringify(packed).length<JSON.stringify(value).length)return packed;
   }catch{/* Preserve the original diagnostic on codec limits. */}
  }
  return value;
 };
 const pack=(x,path='',key='')=>{
  if(x&&typeof x==='object'){
   const signature=JSON.stringify(x);
   if(signature.length>150){
    if(seen.has(signature)){
     references++;return {traceRef:seen.get(signature)};
    }
    seen.set(signature,path);
   }
  }
  if(Array.isArray(x)){
   const rows=x.map((v,i)=>pack(v,path+'/'+i));
   return encodeDiagnostic(rows,key);
  }
  if(!x||typeof x!=='object')return x;
  return encodeDiagnostic(Object.fromEntries(Object.entries(x).map(([k,v])=>[k,pack(v,path+'/'+pointerKey(k),k)])),key);
 };
 const packed=compactDiagnosticRows(pack(copied(out)));
 packed.traceCompaction={removed:'repeated interpretation prose and common candidate/ranking input duplicates',
  comparisons_and_rejection_reasons_preserved:true,shared_objects:references,
  optional_undefined:'object keys omitted; array slots null, as in JSON diagnostics',nonfinite_numbers:'explicit nonnumeric marker; never probability or value evidence',
  reference_format:'exact earlier-object JSON pointers; all frames and object-rows/v1 restore before pointers'};
 // Encode the common pool as one bounded frame only when the full trace needs
 // headroom. Nested pointers are restored after all frames, so paths into this
 // pool still identify the same evidence. Keep small traces directly readable.
 if(JSON.stringify(packed).length>36000&&packed.commonComparison){
  try{
   const frame=frameFor(packed.commonComparison);
   if(JSON.stringify(frame).length<JSON.stringify(packed.commonComparison).length)packed.commonComparison=frame;
  }catch{/* Keep evidence intact when the bounded codec cannot represent it. */}
 }
 // Large planning/selection records also share the host's 40000-character
 // transport ceiling. Reuse the same bounded, exact codec by whole field;
 // decode frames before resolving JSON pointers, preserving every refusal.
 if(JSON.stringify(packed).length>36000){
  const fields=Object.keys(packed).filter(k=>!['learnedAdmission','traceCompaction'].includes(k))
   .sort((a,b)=>JSON.stringify(packed[b]).length-JSON.stringify(packed[a]).length);
  for(const k of fields){
   if(JSON.stringify(packed).length<=36000)break;
   try{const frame=frameFor(packed[k]);
    if(JSON.stringify(frame).length<JSON.stringify(packed[k]).length)packed[k]=frame;
   }catch{/* Keep evidence intact when one field exceeds the decoded budget. */}
  }
 }
 // A dense phase ledger may leave several small, already bounded frames just
 // above the host ceiling. Reuse the same exact codec on their whole envelope;
 // decode restores the original trace root before resolving any pointers.
 let result=packed;
 if(JSON.stringify(packed).length>36000)try{
  const frame=frameFor(packed);
  if(JSON.stringify(frame).length<JSON.stringify(packed).length)result=frame;
 }catch{/* Preserve all evidence when the same codec bounds reject the frame. */}
 // Actual phase costs can be larger than a mock overlay. Early table frames
 // help fields beyond the decoded budget; deferred tables can share more
 // enclosing dictionary data. Try the other exact layout once, keeping the
 // smaller readable result and every event, parameter, mass and refusal.
 if(!deferPhaseTables&&JSON.stringify(result).length>36000){
  const alternative=learningTraceForHost(trace,{deferPhaseTables:true});
  if(JSON.stringify(alternative).length<JSON.stringify(result).length)result=alternative;
 }
 return result;
}
// Store repeated column names once, retaining optional-field presence and all
// numeric/unknown/refusal evidence. Only this diagnostic array is encoded.
export function compactDiagnosticRows(trace){
 const rows=trace.selection?.challengers;
 if(!Array.isArray(rows)||rows.length<3||JSON.stringify(rows).length<2000)return trace;
 const columns=[...new Set(rows.flatMap(r=>Object.keys(r).filter(k=>r[k]!==undefined)))];
 const data=rows.map(r=>columns.map(k=>r[k]===undefined?{traceAbsent:true}:r[k]));
 return {...trace,selection:{...trace.selection,challengers:{traceTable:'object-rows/v1',columns,rows:data}}};
}
// Review helper only. Forward/self references cannot be generated by the packer.
export function expandLearningTrace(trace){
 const restore=x=>{
  if(Array.isArray(x))return x.map(restore);
  if(!x||typeof x!=='object')return x;
  if(x.traceData==='bounded-dictionary-lz/v1')return restore(decodeBoundedData(x.data));
  if(x.traceTable==='object-rows/v1')return x.rows.map(row=>Object.fromEntries(x.columns.flatMap((k,i)=>
   row[i]?.traceAbsent===true&&Object.keys(row[i]).length===1?[]:[[k,restore(row[i])]])));
  return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,restore(v)]));
 };
 const restored=restore(trace);
 const expand=x=>{
  if(Array.isArray(x))return x.map(expand);
  if(!x||typeof x!=='object')return x;
  if(Object.keys(x).length===1&&typeof x.traceRef==='string'){
   const source=x.traceRef.split('/').slice(1).reduce((v,k)=>v[k.replace(/~1/g,'/').replace(/~0/g,'~')],restored);
   return expand(source);
  }
  return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,expand(v)]));
 };
 return expand(restored);
}
