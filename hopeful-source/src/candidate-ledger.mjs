import {policyIdentity,stableDataKey} from './policy.mjs';

/** Request-local diagnostics only. Policy keys stay in memory; the wire uses
 * short identities and one input dictionary. No line or service is modified. */
export function createCandidateLedger(requestId=null){
 const inputs=[],candidates=[],occurrences=[],pools=[],producers=[],phases=[];
 const inputKeys=new Map(),policyKeys=new Map(),unverified=new WeakMap(),originKeys=new Map();
 const inputIdFor=input=>{
  if(!input)return null;
  const key=stableDataKey(input);
  let inputId=inputKeys.get(key);
  if(inputId===undefined){inputId='i'+inputs.length;inputKeys.set(key,inputId);inputs.push({inputId,input});}
  return inputId;
 };
 const candidate=line=>{
  if(!line?.input)return null;
  const inputId=inputIdFor(line.input);
  const identity=policyIdentity(line);
  let row=identity===null?unverified.get(line):policyKeys.get(identity);
  if(!row){row={candidateId:'c'+candidates.length,inputId,policyIdentityStatus:identity===null?'unverified':'observed',policyVariant:line.policyVariant??'retained'};
   candidates.push(row);if(identity===null)unverified.set(line,row);else policyKeys.set(identity,row);}
  return row;
 };
 const occurrence=(line,{source,role,index=null})=>{
  const c=candidate(line),key=stableDataKey([source,role,index,c?.candidateId??null]);
  let row=originKeys.get(key);
  if(!row){row={occurrenceId:'o'+occurrences.length,candidateId:c?.candidateId??null,source,role,index,policyVariant:line?.policyVariant??null};occurrences.push(row);originKeys.set(key,row);}
  return row;
 };
 const pool=(run,limit)=>{
  const record={poolRunId:'p'+pools.length,run,limit,occurrences:[]},rows=new Map();pools.push(record);
  const row=o=>{let r=rows.get(o.occurrenceId);if(!r){r={occurrenceId:o.occurrenceId,visits:[]};rows.set(o.occurrenceId,r);record.occurrences.push(r);}return r;};
  return {poolRunId:record.poolRunId,filter:(o,status)=>{row(o).filter=status;},
   visit:(o,category,status,detail={})=>{row(o).visits.push({category,status,...detail});},
   finish:admitted=>{record.admittedCandidateIds=admitted;}};
 };
 let returned=null;
 return {candidate,inputIdFor,occurrence,pool,
  phase:details=>{
   const record={...details,phaseId:'f'+phases.length,status:'entered',serviceCostsObserved:false};phases.push(record);
   return {phaseId:record.phaseId,owner:Object.freeze({phaseId:record.phaseId}),finish:details=>Object.assign(record,details)};
  },
  producer:r=>producers.push({...r}),
  producerOutput:(source,result)=>{
   const trees=[...(result.policyTrees||[])],origins=trees.map((line,index)=>occurrence(line,{source,role:'policyTrees',index}));
   const selectedOrigin=result.selected?occurrence(result.selected,{source,role:'selected'}):null;
   producers.push({source,invoked:true,reportedAttempted:typeof result.attempted==='boolean'?result.attempted:null,
    reason:result.reason??null,policyTreeCount:Array.isArray(result.policyTrees)?trees.length:null,
    collectedPolicyTreeCount:trees.length,selectedOccurrenceId:selectedOrigin?.occurrenceId??null});
   return {trees,origins,selectedOrigin};
  },
  returned:(input,line,{commonWinnerCandidateId=null,commonSelectedCandidateId=null,commonSelectionBasis=null,reason=null}={})=>{
   const final=candidate(line),inputId=inputIdFor(input);
   returned={inputId,candidateId:final?.inputId===inputId?final?.candidateId??null:null,
    commonWinnerCandidateId,commonSelectedCandidateId,commonSelectionBasis,reason,executionReceipt:{status:'unobserved',reason:'host-execution-receipt-unavailable'}};
  },
  snapshot:()=>({schema:'request-candidate-ledger/1',requestId,inputs,candidates,occurrences,pools,producers,phases,returned,
   coverage:{producerOutputs:'observed-policyTrees-and-selected-only',commonPools:'see-pool-runs; legacy-completeness-ablation-unobserved',championInternalGeneration:'unobserved',championInternalPruning:null,
    formalReplyRPC:phases.some(p=>p.phase==='formal-reply'&&p.serviceCostsObserved)?'owned-phase adapter aggregates; no per-call log; legacy unobserved':'unobserved',modelGenerationAndFiltering:'unobserved',hostExecution:'unobserved'}})
 };
}
