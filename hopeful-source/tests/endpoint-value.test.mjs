import {test} from 'node:test';import assert from 'node:assert/strict';
import {endpointValuePoint,summarizeEndpointValues} from '../src/endpoint-value.mjs';
const root={team:'A',score:{A:1,B:0}};
const inspect={CFG:{touchdown:1500},boardValue:()=>1627.25};
const branch=(patch={})=>({active:'A',observation:{active:'A',phase:'play',players:[],score:{A:1,B:0},turn:{A:7,B:8},turnsPerHalf:8,...patch}});
test('finished matches use the same score units without phantom ball/material/space credit',()=>{
 let calls=0;const view={...inspect,boardValue:()=>{calls++;return 9999;}};
 for(const [score,expected] of [[{A:1,B:0},1500],[{A:1,B:1},0]]){
  const p=endpointValuePoint(branch({phase:'fullTime',score}),root,view);
  assert.equal(p.value,expected);assert.equal(p.positionAndMaterialValue,0);assert.equal(p.horizon,'finished-match-score/v1');
 }
 assert.equal(calls,0);
});
test('real next-own End boundary retains the frozen material/position value and public opportunity',()=>{
 const p=endpointValuePoint(branch(),root,inspect);
 assert.equal(p.value,1627.25);assert.equal(p.scoreValue,1500);assert.equal(p.positionAndMaterialValue,127.25);
 assert.deepEqual(p.nextOwnOpportunity,{remainingOwnTurns:1,currentOwnTurn:true,basis:'public static board heuristic; future actual actions/dice are unverified'});
});
test('halfOver and touchdown are restart boundaries even with the opponent still active; they are not fullTime',()=>{
 const players=[{team:'A',st:3,location:'pitch',skills:['block'],stance:'prone',pos:{x:2,y:2}},
  {team:'B',st:3,location:'reserves',skills:[],stance:'standing',pos:null},
  {team:'B',st:4,location:'ko',skills:['guard'],stance:'prone',pos:null}];
 const view={...inspect,boardValue:()=>{throw Error('stale board geometry must not price a restart');}};
 for(const phase of ['halfOver','touchdown','play']){
  const b=branch({active:'B',phase,half:1,players});b.active='B';
  if(phase!=='halfOver'){b.touchdown='B';b.observation.score={A:1,B:1};}
  const p=endpointValuePoint(b,root,view);assert.equal(p.valid,true);
  assert.equal(p.value,(phase==='halfOver'?1500:0)+1.5);assert.equal(p.positionAndMaterialValue,1.5);
  assert.equal(p.nextOwnOpportunity.nextPeriodOrDriveUnverified,true);assert.equal(p.nextOwnOpportunity.koRecoveryUnverified,true);
  assert.notEqual(p.horizon,'finished-match-score/v1');
 }
});
test('a real observed opposing TD is priced in score units and is never erased by unrelated unknown branches',()=>{
 const scored={...branch({phase:'fullTime',score:{A:1,B:1}}),touchdown:'B'};
 const p=endpointValuePoint(scored,root,inspect);assert.equal(p.value,0);
 const s=summarizeEndpointValues([{p:.6,point:p}]);assert.equal(s.knownMass,.6);assert.equal(s.knownWeightedValue,0);
 assert.equal(s.complete,false);assert.equal(s.unknownMass,.4);assert.equal(s.value,null);
});
test('open opposing Turns, source/body disagreement, missing public score and forged TD markers are not endpoints',()=>{
 for(const b of [branch({active:'B'}),{...branch(),active:'B'},branch({score:undefined}),{...branch(),touchdown:'B'},branch({score:{A:1,B:2}})])
  assert.equal(endpointValuePoint(b,root,inspect).valid,false);
});
test('partial distributions and unresolved probability are not normalized or certified complete',()=>{
 const p=endpointValuePoint(branch(),root,inspect);
 const partial=summarizeEndpointValues([{p:.25,point:p}]);assert.equal(partial.knownWeightedValue,.25*1627.25);assert.equal(partial.value,null);assert.equal(partial.unknownMass,.75);
 const unresolved=summarizeEndpointValues([{p:1,point:p}],{unresolvedMass:.1});assert.equal(unresolved.complete,false);assert.equal(unresolved.value,null);assert.ok(unresolved.reasons.includes('endpoint-value-unexpanded-probability'));
 for(const rows of [[{p:-1,point:p}],[{p:1,point:p},{p:.1,point:p}]])assert.equal(summarizeEndpointValues(rows).valid,false);
});
