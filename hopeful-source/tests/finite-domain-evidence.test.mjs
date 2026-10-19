import test from 'node:test';import assert from 'node:assert/strict';
import {finiteDomainEvidence,finiteDomainWinner} from '../src/common-turn-pool.mjs';
const own=(to,kind='playerAction')=>({policy:{input:{kind},ex:{pTurnover:to}}});
test('peer diagnostics distinguish overlap, legacy margin, turnover cost and unknown cost',()=>{
 for(const [gap,turnover,unknown,expected] of [[-1,0,0,'candidate-lower-not-above-peer-upper'],[.5,0,0,'legacy-evidence-margin-not-met'],[5,.1,0,'turnover-increment-margin-not-met'],[8,.1,.02,'unknown-increment-margin-not-met']]){
  const b=[{lower:gap,upper:gap},{lower:0,upper:0}],p=[own(turnover),own(0)],m=[{finiteUnknownChanceMass:unknown},{finiteUnknownChanceMass:0}],d=finiteDomainEvidence(b,p,m);
  assert.equal(d.rows[0].primaryReason,expected);assert.equal(d.rows[0].passed,false);assert.ok(d.rows[0].reasons.includes(expected));assert.equal(d.rows[0].peers[0].turnoverIncrement,turnover*30);assert.equal(d.rows[0].peers[0].unknownIncrement,unknown*120);
 }
});
test('diagnostic pass identities match actual strict gate under candidate order and risk perturbations',()=>{
 let count=0;for(const gap of [-5,0,.5,1,4,5,8,20])for(const to of [0,.1,.25])for(const unknown of [0,.02,.2])for(const reversed of [false,true]){
  let b=[{lower:gap,upper:gap},{lower:0,upper:0}],p=[own(to),own(0)],m=[{finiteUnknownChanceMass:unknown},{finiteUnknownChanceMass:0}];if(reversed){b=b.reverse();p=p.reverse();m=m.reverse();}
  const before=JSON.stringify([b,p,m]),d=finiteDomainEvidence(b,p,m);assert.equal(d.rows.findIndex(r=>r.passed),finiteDomainWinner(b,p,m));assert.equal(JSON.stringify([b,p,m]),before);count++;
 }assert.equal(count,144);
});
test('missing comparison risk evidence is unverified, never a zero risk candidate',()=>{
 const d=finiteDomainEvidence([{lower:5,upper:5},{lower:0,upper:0}],[own(0),own(0)],[{},{}]);assert.equal(d.valid,false);assert.deepEqual(d.rows,[]);
});

test('failed lower bound advantage distinguishes actual intersecting intervals from strict inferiority',()=>{
 const p=[own(0),own(0)],m=[{finiteUnknownChanceMass:0},{finiteUnknownChanceMass:0}];
 for(const [bounds,intersects] of [[[{lower:0,upper:1},{lower:10,upper:11}],false],[[{lower:0,upper:12},{lower:10,upper:11}],true]]){
  const r=finiteDomainEvidence(bounds,p,m).rows[0];assert.equal(r.primaryReason,'candidate-lower-not-above-peer-upper');assert.equal(r.peers[0].intervalsIntersect,intersects);assert.equal(r.passed,false);
 }
});
