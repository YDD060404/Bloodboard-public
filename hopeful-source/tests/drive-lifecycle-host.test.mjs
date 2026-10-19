import test from 'node:test';
import assert from 'node:assert/strict';
import {E,observe} from './deps/archived-v6-host.mjs';
import {createChampion} from '../src/champion.mjs';
import {reviewDriveIntent} from '../src/lifecycle.mjs';
const inspect=createChampion().inspector;
function state(){return E.buildScenario({teams:{A:'human',B:'human'},players:[
 {id:'carrier',team:'A',roster:'human',position:'lineman',at:[13,7],number:1},
 {id:'foe',team:'B',roster:'human',position:'lineman',at:[1,1],number:1}],ball:{holder:'carrier'}},13);}
test('actual missed Drive window is explicitly revised; original target and reason remain auditable',()=>{
 let s=state(),plan=null;const records=[];
 for(let n=0;n<4;n++){
  const o=observe(s,'A',10+n),raw=inspect.buildDrivePlan(o,plan),current=reviewDriveIntent(o,raw,plan);
  assert.deepEqual(current.targetScoringWindow,raw.targetScoringWindow,'lifecycle correction does not silently alter frozen strategic scoring');
  records.push(current);plan=current;
  if(n<3){const a=E.execute(s,{kind:'endTurn'}),b=E.execute(a.state,{kind:'endTurn'});assert.equal(a.status,'completed');assert.equal(b.status,'completed');s=b.state;}
 }
 assert.equal(records[0].targetScoringWindow.target,6);assert.equal(records.at(-1).targetScoringWindow.target,8);
 assert.equal(records.at(-1).windowRevision.type,'missed-scoring-window');assert.equal(records.at(-1).windowRevision.previousTarget,6);
 assert.equal(records.at(-1).windowRevision.currentEarliest,7);assert.notEqual(records.at(-1).revisionReason,'plan retained; clock recomputed');
});
test('real expected progress preserves feasible target; new Drive does not inherit a missed-window record',()=>{
 const s=state(),o=observe(s,'A',1),prior=inspect.buildDrivePlan(o,null),input={kind:'playerAction',playerId:'carrier',action:'move',path:Array.from({length:6},(_,i)=>({kind:'step',to:{x:14+i,y:7}}))};
 const actual=E.execute(s,input);assert.equal(actual.status,'completed');const next=observe(actual.state,'A',2),current=reviewDriveIntent(next,inspect.buildDrivePlan(next,prior),prior);
 assert.equal(current.targetScoringWindow.target,prior.targetScoringWindow.target);assert.equal(current.windowRevision,undefined);
 const reset={...next,drive:(next.drive??0)+1};const result=reviewDriveIntent(reset,inspect.buildDrivePlan(reset,current),{...current,windowRevision:{type:'missed-scoring-window'}});
 assert.equal(result.windowRevision,undefined);assert.equal(result.revisionReason,'new Drive or match context');
});

test('missing/partial schemas remain compatible, and clamped final-turn labels do not hide infeasible carry',()=>{
 for(const [current,previous] of [[null,null],[{team:'A'},undefined],[{team:'A'},{}],[{schema:'other',team:'A'},{schema:'other',team:'A'}]])
  assert.deepEqual(reviewDriveIntent({team:'A'},current,previous),current);
 let s=state();s.teams.A.turn=7;s.teams.B.turn=6;
 const o=observe(s,'A',1),prior=inspect.buildDrivePlan(o,null);assert.equal(prior.targetScoringWindow.target,8);assert.equal(prior.targetScoringWindow.carryWithinHalf,true);
 s=E.execute(E.execute(s,{kind:'endTurn'}).state,{kind:'endTurn'}).state;
 const final=observe(s,'A',2),raw=inspect.buildDrivePlan(final,prior),current=reviewDriveIntent(final,raw,prior);
 assert.equal(raw.targetScoringWindow.earliest,8);assert.equal(raw.targetScoringWindow.carryEarliest,9);
 assert.equal(current.windowRevision.type,'ordinary-carry-window-closed');assert.equal(current.windowRevision.ordinaryCarryFeasible,false);
 assert.equal(current.windowRevision.unclampedCarryEarliest,9);assert.notEqual(current.revisionReason,'plan retained; clock recomputed');
});
