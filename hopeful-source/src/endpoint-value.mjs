/** One common value at a real Turn end or an absorbing score. This point
 * evaluator is not a source certificate or a value for an unexpanded branch. */
export function endpointValuePoint(branch,root,inspect){
 const ob=branch?.observation,team=root?.team,opp=team==='A'?'B':'A';
 const reject=reason=>({valid:false,reason});
 if(!['A','B'].includes(team)||!ob||!Array.isArray(ob.players)||
  !Number.isInteger(ob.score?.A)||!Number.isInteger(ob.score?.B)||ob.score.A<0||ob.score.B<0||
  !Number.isFinite(inspect?.CFG?.touchdown)||inspect.CFG.touchdown<0)
  return reject('endpoint-value-public-state-unavailable');
 if(branch.active!==ob.active||!['A','B'].includes(ob.active))return reject('endpoint-value-active-state-mismatch');
 const finished=ob.phase==='fullTime',scored=['A','B'].includes(branch.touchdown),restart=scored||['halfOver','touchdown'].includes(ob.phase);
 if(!finished&&!scored&&!restart&&ob.active!==team)return reject('endpoint-value-opponent-Turn-not-ended');
 if(!Number.isInteger(root.score?.A)||!Number.isInteger(root.score?.B)||
  ob.score.A<root.score.A||ob.score.B<root.score.B||
  ob.score.A-root.score.A+ob.score.B-root.score.B>1)
  return reject('endpoint-value-outside-first-TD-horizon');
 if(scored&&(ob.score[branch.touchdown]-root.score[branch.touchdown]!==1||
  ob.score[branch.touchdown==='A'?'B':'A']!==root.score[branch.touchdown==='A'?'B':'A']))
  return reject('endpoint-value-score-marker-mismatch');
 const scoreValue=inspect.CFG.touchdown*(ob.score[team]-ob.score[opp]);
 if(finished)return {valid:true,value:scoreValue,scoreValue,positionAndMaterialValue:0,
  nextOwnOpportunity:'none; public fullTime',horizon:'finished-match-score/v1',scope:'final score in existing touchdown units; no post-match possession/position credit'};
 if(restart){
  if(!Number.isInteger(ob.half)||![1,2].includes(ob.half)||ob.players.some(p=>
   !['A','B'].includes(p.team)||!Number.isFinite(p.st)||p.st<1||!Array.isArray(p.skills)||p.skills.some(s=>typeof s!=='string')||
   !['pitch','reserves','ko','cas'].includes(p.location)))return reject('endpoint-value-period-roster-unavailable');
  // Reuse the frozen activity weights for currently available roster capacity.
  // Current board locations/stances and possession expire at the restart.
  // KO recovery, new setup, resources and next-period outcomes remain unknown.
  const useful=p=>['block','dodge','guard','standFirm','sidestep'].filter(s=>p.skills.some(k=>k===s||k.startsWith(s+'('))).length;
  const capacity=t=>ob.players.filter(p=>p.team===t&&['pitch','reserves'].includes(p.location))
   .reduce((sum,p)=>sum+10+Math.min(p.st,5)+useful(p)*1.5,0);
  const material=capacity(team)-capacity(opp);
  return {valid:true,value:scoreValue+material,scoreValue,positionAndMaterialValue:material,
   nextOwnOpportunity:{publicHalf:ob.half,nextPeriodOrDriveUnverified:true,koRecoveryUnverified:true,
    basis:'available roster capacity only; no fabricated restart state or future actions'},
   horizon:ob.phase==='halfOver'?'actual-period-End/v1':'first-TD-drive-End/v1',
   scope:'period/drive score plus currently available roster capacity in frozen activity units; stale positions/possession excluded, not a final result or full future value'};
 }
 if(typeof inspect.boardValue!=='function'||!Number.isInteger(ob.turn?.[team])||
  !Number.isInteger(ob.turnsPerHalf)||ob.turnsPerHalf<1)
  return reject('endpoint-value-public-opportunity-unavailable');
 const value=inspect.boardValue(ob,team);
 if(!Number.isFinite(value))return reject('endpoint-value-board-nonfinite');
 return {valid:true,value,scoreValue,positionAndMaterialValue:value-scoreValue,
  nextOwnOpportunity:{remainingOwnTurns:Math.max(0,ob.turnsPerHalf-ob.turn[team]),
   currentOwnTurn:ob.active===team&&ob.phase==='play',basis:'public static board heuristic; future actual actions/dice are unverified'},
  horizon:scored?'first-TD-absorbing/v1':'actual-opponent-End/next-own-boundary/v1',
  scope:'same frozen board units include material, screens, routes and public delivery budget; no full future win probability'};
}

/** Never normalize a partial retained distribution into a complete one.
 * This sum deliberately has no finite interval for missing endpoint values. */
export function summarizeEndpointValues(rows,{unresolvedMass=0}={}){
 if(!Array.isArray(rows)||rows.some(r=>!Number.isFinite(r?.p)||r.p<0||r.p>1)||
  rows.reduce((s,r)=>s+r.p,0)>1+1e-8||!Number.isFinite(unresolvedMass)||unresolvedMass<0||unresolvedMass>1)
  return {valid:false,reason:'endpoint-value-probability-contract-invalid'};
 let knownMass=0,knownWeightedValue=0;const reasons=new Set();
 for(const r of rows){
  if(r.point?.valid===true&&Number.isFinite(r.point.value)){knownMass+=r.p;knownWeightedValue+=r.p*r.point.value;}
  else reasons.add(r.point?.reason??'endpoint-value-missing');
 }
 if(unresolvedMass>1e-8)reasons.add('endpoint-value-unexpanded-probability');
 const unknownMass=Math.max(0,1-knownMass,unresolvedMass),complete=unknownMass<=1e-8;
 return {valid:true,knownMass,knownWeightedValue,unknownMass,complete,
  value:complete?knownWeightedValue:null,reasons:[...reasons],
  scope:'retained actual End/TD values only; absent mass has no invented baseline or finite bound'};
}
