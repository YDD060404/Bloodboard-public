import {same} from './policy.mjs';
const probability=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1+1e-8;
const near=(a,b)=>Math.abs(a-b)<=1e-8;
/** This is a failed search's diagnostic witness, never an executable policy
 * or an imputed expected value. Source, chance units and the unknown tail are
 * checked before recording it; callers continue to receive the same failure. */
export function timeoutWitness(response,input,options={},requestId=null){
 const bad=reason=>({usable:false,reason});
 if(response?.ok!==false||response.code!=='timeout')return bad('not-an-explore-timeout');
 const e=response.partialEvidence;
 if(!e)return bad('witness-unavailable:'+String(response.evidenceUnavailable||'host-did-not-retain-witness'));
 if(e.schema!=='explore-timeout-witness/1'||e.outcomeIdentity!=='complete-state-v1'||
  e.massUnit!=='unconditional-chance'||e.admissibility!=='evidence-only-no-execution-certificate'||
  e.enumerationComplete!==false||e.value!==null)return bad('unverified-witness-contract');
 if(!same(e.input,input)||e.position?.key!==(options.from??'root')||
  requestId!==null&&e.requestId!==requestId)return bad('witness-source-mismatch');
 const perspective=options.perspective,team=options.team;
 if(!['A','B'].includes(perspective)||!['A','B'].includes(team)||
  e.perspective!==perspective||e.activeTeam!==team)return bad('witness-team-or-perspective-mismatch');
 if(e.decisionPolicy?.mode!=='builtin'||e.decisionPolicy.own!=='builtin'||e.decisionPolicy.opponent!=='builtin')
  return bad('witness-not-a-builtin-chance-law');
 const mass=[e.enumerated,e.unknownMass,e.listedMass,e.unlistedEnumeratedMass];
 if(!mass.every(probability)||!near(e.enumerated+e.unknownMass,1)||
  !near(e.listedMass+e.unlistedEnumeratedMass,e.enumerated)||
  !Number.isSafeInteger(e.leaves)||e.leaves<1||!Array.isArray(e.outcomes)||e.outcomes.length>40)
  return bad('witness-invalid-probability-mass');
 if(e.outcomes.some(o=>!probability(o?.p)||o.key!==null||typeof o.turnover!=='boolean'||
  typeof o.completed!=='boolean'||!['A','B',null].includes(o.touchdown)))return bad('witness-invalid-outcome');
 const listed=e.outcomes.reduce((sum,o)=>sum+o.p,0);
 if(!near(listed,e.listedMass))return bad('witness-listed-mass-mismatch');
 const events={turnover:o=>o.turnover,touchdown:o=>o.touchdown===perspective,
  opponentTouchdown:o=>o.touchdown!==null&&o.touchdown!==perspective,completed:o=>o.completed};
 for(const [name,has] of Object.entries(events)){
  const known=e.observed?.[name],bound=e.probabilityBounds?.[name];
  const inList=e.outcomes.reduce((sum,o)=>sum+(has(o)?o.p:0),0);
  if(!probability(known)||known>e.enumerated+1e-8||known<inList-1e-8||
   known>inList+e.unlistedEnumeratedMass+1e-8||!probability(bound?.lower)||!probability(bound?.upper)||
   !near(bound.lower,known)||!near(bound.upper,Math.min(1,known+e.unknownMass)))
   return bad('witness-invalid-event-bound:'+name);
 }
 return {usable:true,reason:'source-bound-timeout-witness-only',diagnosticOnly:true,evidence:e};
}
