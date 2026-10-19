import {coordinationFeatures} from './coordination-value.mjs';
import {endpointValuePoint} from './endpoint-value.mjs';
/** Experimental C utility: preserve the existing score units; the original bounded mode preserves
 * ordering of each finite positional estimate, with a stated finite positional range.
 * This is a changed value function, not a trained model or a win probability.
 * B keeps the old endpoint point value, whose unobserved range is unbounded. */
export function endpointUtilityRange(root,inspect,mode='bounded-terminal'){
 const t=inspect?.CFG?.touchdown,p=inspect?.CFG?.possession,team=root?.team;
 if(!['A','B'].includes(team)||!Number.isInteger(root.score?.A)||!Number.isInteger(root.score?.B)||
  root.score.A<0||root.score.B<0||!Number.isFinite(t)||t<=0||!Number.isFinite(p)||p<=0)
  return {valid:false,reason:'endpoint-utility-public-score-or-scale-unavailable'};
 if(!['bounded-terminal','coordinated-terminal','legacy-point'].includes(mode))return {valid:false,reason:'endpoint-utility-mode-unavailable'};
 const score=t*(root.score[team]-root.score[team==='A'?'B':'A']);
 const positionScale=mode==='coordinated-terminal'?p*4:p;
 return {valid:true,mode,score,touchdown:t,positionScale,
  lower:mode!=='legacy-point'?score-t-positionScale:null,upper:mode!=='legacy-point'?score+t+positionScale:null,
  horizon:'first-TD-or-actual-opponent-End/v1',
  scope:'one absorbing TD at most; bounded-terminal uses P*tanh(position/P); coordinated-terminal clips legacy units plus bounded coordination to +/-4P; B has no invented finite bound'};
}
export function endpointUtilityPoint(branch,root,inspect,mode='bounded-terminal'){
 const point=endpointValuePoint(branch,root,inspect),range=endpointUtilityRange(root,inspect,mode);
 if(!point.valid)return point;if(!range.valid)return range;
 const features=mode==='coordinated-terminal'&&point.horizon==='actual-opponent-End/next-own-boundary/v1'?coordinationFeatures(branch.observation):null;
 const position=mode==='coordinated-terminal'?Math.max(-range.positionScale,Math.min(range.positionScale,point.positionAndMaterialValue+(features?.adjustment||0))):mode==='legacy-point'?point.positionAndMaterialValue:
  range.positionScale*Math.tanh(point.positionAndMaterialValue/range.positionScale);
 return {...point,value:point.scoreValue+position,positionAndMaterialValue:position,
  originalPointValue:point.value,coordination:features,valueMode:mode,utilityRange:range};
}
/** No average across opponent choices. Null lower/upper mean -/+ infinity,
 * respectively, and remain explicit transport values instead of JSON NaN. */
export function minimumUtilityBounds(bounds){
 if(!Array.isArray(bounds)||!bounds.length)return null;
 const finiteUpper=bounds.map(b=>b.upper).filter(Number.isFinite);
 return {lower:bounds.some(b=>b.lower===null)?null:Math.min(...bounds.map(b=>b.lower)),
  upper:finiteUpper.length?Math.min(...finiteUpper):null};
}
