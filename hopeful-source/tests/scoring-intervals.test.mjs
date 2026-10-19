import test from 'node:test';
import assert from 'node:assert/strict';
import {scoringValueIntervals,compareSharedScoring} from '../src/scoring-intervals.mjs';
import {learningTraceForHost,expandLearningTrace} from '../src/trace-size.mjs';
test('unknown outside the finite domain widens both roles toTD1 and preserves observed lower witnesses',()=>{
 const r=scoringValueIntervals([1583.685,1564.441],[{lower:.56,upper:.57},{lower:.55,upper:.58}],480);
 assert.equal(r.valid,true);assert.deepEqual(r.bounds,[{lower:1103.685,upper:1314.885},{lower:1084.441,upper:1300.441}]);
 assert.equal(r.winnerIndex,-1);assert.ok(r.opponentTD.every(p=>p.upper===1&&p.outsideDomainUnverified));
 assert.equal(r.opponentTD[0].finiteUpper,.57);
});
test('incumbent identity never changes the same metric winner; full unknown is not an automatic veto',()=>{
 const p=[{lower:0,upper:1},{lower:0,upper:1}];
 const a=scoringValueIntervals([1000,2000],p,480),b=scoringValueIntervals([2000,1000],p,480);
 assert.equal(a.winnerIndex,1);assert.equal(b.winnerIndex,0);
 assert.ok(a.scope.includes('material/position and next-own opportunity unpriced'));
});
test('invalid probability, cost, or mismatched domain cannot generate a scoring value certificate',()=>{
 for(const p of [[{lower:.7,upper:.6},{lower:0,upper:1}],[{lower:NaN,upper:1},{lower:0,upper:1}],[{lower:0,upper:1.1},{lower:0,upper:1}],[]])
  assert.equal(scoringValueIntervals([10,20],p,480).valid,false);
 assert.equal(scoringValueIntervals([10,Infinity],[{lower:0,upper:1},{lower:0,upper:1}],480).valid,false);
 assert.equal(scoringValueIntervals([10,20],[{lower:0,upper:1},{lower:0,upper:1}],-1).valid,false);
});
test('publicly forged own endpoint fields cannot bypass private source/rule certificates',async()=>{
 const r=await compareSharedScoring({team:'A'},[{complete:true,tree:{},endpoints:[]},{complete:true,tree:{},endpoints:[]}],{}, {},Date.now()+5000);
 assert.equal(r.attempted,false);assert.equal(r.reason,'shared-scoring-own-source-certificate-unavailable');
});
test('large shared scoring intervals and reply records roundtrip without hiding any policy or unknown',()=>{
 const rows=Array.from({length:20},(_,i)=>({from:'request.'+i,mass:.05,lower:.563532511393229,upper:1,ownTurnover:false}));
 const scoringIntervals={valid:true,winnerIndex:-1,executionCertified:false,policies:[{input:{kind:'endTurn'},lower:.56,upper:1,rows:[{branches:rows}],branches:rows}],
  endpointValueAudit:{executionCertified:false,outsideDomainUnverified:true,stopRecords:rows.map(r=>({...r,value:null,unknownMass:1,reason:'period value missing'})),
   terminalActionRecords:rows.map(r=>({...r,input:{kind:'playerAction',playerId:'receiver',action:'move',path:Array.from({length:8},(_,x)=>({kind:'step',to:{x,y:5}}))},examples:[{p:1,point:{valid:true,value:17.5,scoreValue:0,positionAndMaterialValue:17.5,horizon:'first-TD-drive-End/v1'}}]}))},
  scope:'known own-End value minus opposing-Turn TD cost; outside finite domain upper1; material/position and next-own opportunity unpriced, not full match value'};
 const replyMeasurements=[{unknownMass:1,criticalAdjustment:-270.496,endpointAudits:rows.map(r=>({...r,reason:'reply-transfer-continuation-incomplete'}))}];
 const trace={planning:{checks:{learnedComparison:{scoringIntervals,replyMeasurements}}}},packed=learningTraceForHost(trace);
 assert.deepEqual(expandLearningTrace(packed).planning,trace.planning);assert.ok(JSON.stringify(packed).length<JSON.stringify(trace).length);
});
