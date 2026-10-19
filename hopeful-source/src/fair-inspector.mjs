/** Adapt external policy comparisons only. The frozen search and its
 * fallback proposals never receive this inspector, so an unproved comparison
 * cannot silently change the baseline search's internal ordering. */
export function fairInspector(original){
 return Object.freeze({...original,contenderEvidence:(candidate,incumbent)=>{
  const e=original.contenderEvidence(candidate,incumbent);
  if(e.replyBasis?.mode!=='critical-only-unmatched')return e;
  return {...e,replyDelta:0,gain:e.gain-e.replyDelta,effectiveGain:e.effectiveGain-e.replyDelta,eligible:false,
   replyBasis:{...e.replyBasis,delta:0,mode:'incomparable-reply-boundary',comparable:false,criticalDelta:null,positionDelta:null,
    interpretation:'missing or mismatched counterpart; not comparable until both policies reach a shared boundary; neither absolute cost is charged'}};
 }});
}
