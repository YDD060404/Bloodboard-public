import {same} from './policy.mjs';
/** Compare this request's returned input with observed same-position references.
 * Host builtin identity/configuration is deliberately not inferred from a label. */
export function decisionAgreement(o,native,finalInput,championInput){
 const choice=o?.builtInChoice;let input=null,reason='host-builtin-choice-unobserved';
 if(choice?.endTurn===true&&choice.candidateId===null){input={kind:'endTurn'};reason='host-builtin-End-observed';}
 else if(choice?.endTurn===false&&Number.isSafeInteger(choice.candidateId)){
  const matches=(native??[]).filter(c=>c?.id===choice.candidateId&&c.input);
  if(matches.length===1){input=matches[0].input;reason='host-builtin-candidate-observed';}
  else reason=matches.length?'host-builtin-candidate-identity-ambiguous':'host-builtin-candidate-unavailable';
 }else if(choice!==undefined)reason='host-builtin-choice-unverified';
 const knownFinal=!!finalInput&&typeof finalInput==='object';
 return {finalInput:finalInput??null,scope:'returned input in this immutable request, not host execution receipt or stronger-play evidence',
  champion:{referenceInput:championInput??null,comparable:knownFinal&&!!championInput,sameFinalInput:knownFinal&&championInput?same(finalInput,championInput):null},
  hostBuiltin:{referenceInput:input,comparable:knownFinal&&!!input,sameFinalInput:knownFinal&&input?same(finalInput,input):null,reason,
   scope:'host-provided same-position builtin choice; exact paired Balanced5.5.0 profile/configuration not established by this field',exactPairedBalancedProfileVerified:false,engine:o?.engine??null}};
}
