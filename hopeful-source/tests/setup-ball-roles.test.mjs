import {originalSelectionSource} from '../scripts/selection-source-audit.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {E} from './deps/archived-v6-host.mjs';
import {verifiedFixture} from '../scripts/test-deps.mjs';
import {createChampion} from '../src/champion.mjs';
import {correctSetupBallRoles} from '../src/setup.mjs';
const cases=JSON.parse(verifiedFixture('gnome-setup-role-pair.json')).cases,champion=createChampion();
const call=f=>{const baseline=champion.chooseSetup(f.observation,f.request),before=structuredClone(f);const answer=correctSetupBallRoles(f.observation,f.request,baseline,champion.inspector);assert.deepEqual(f,before);return {baseline,answer};};
const withoutMyBall=x=>({...x,skills:x.skills.filter(s=>typeof s==='string'?!s.startsWith('myBall'):s.id!=='myBall')});
test('actual Fox receiving/backup assignment treats My Ball as transfer-only and preserves legal formation',()=>{
 const f=cases[0],r=call(f),roles=r.answer.trace.ballRoleCorrection.roles;
 assert.equal(roles.find(p=>p.playerId==='A1').role,'recovery');assert.equal(roles.find(p=>p.playerId==='A2').role,'backup');
 assert.notDeepEqual(r.answer.positions,r.baseline.positions);
 const input={kind:'setupTeam',team:'A',positions:r.answer.positions};assert.deepEqual(E.validateInput(f.state,input),[]);
 const actual=E.execute(f.state,input);assert.equal(actual.status,'completed');assert.equal(actual.state.phase,'kickoff');assert.deepEqual(E.validateDriveSetup(actual.state,'A'),[]);
});
test('changing only My Ball does not churn the corrected actual ball roles',()=>{
 const a=call(cases[0]),b=call(cases[1]);assert.notDeepEqual(a.baseline.positions,b.baseline.positions);assert.deepEqual(a.answer.positions,b.answer.positions);
 const f=structuredClone(cases[0]);f.observation.players=f.observation.players.map(withoutMyBall);f.request.fielding.candidates=f.request.fielding.candidates.map(withoutMyBall);
 const ordinary=call(f);assert.equal(ordinary.answer,ordinary.baseline);assert.deepEqual(a.answer.positions,ordinary.baseline.positions,'same coefficients and layouts when My Ball has no false pickup exclusion');
});
test('No Ball remains excluded even when the actor also has My Ball',()=>{
 const f=structuredClone(cases[0]);f.observation.players.find(p=>p.id==='A1').skills.push('noBall');f.request.fielding.candidates.find(p=>p.id==='A1').skills.push('noBall');
 const r=call(f);assert.ok(!['recovery','backup'].includes(r.answer.trace.ballRoleCorrection.roles.find(p=>p.playerId==='A1').role));
 assert.equal(r.answer.trace.ballRoleCorrection.roles.find(p=>p.playerId==='A2').role,'recovery');
 f.observation.players.find(p=>p.id==='A2').skills.push('noBall');const both=call(f);assert.equal(both.answer,both.baseline);
});
test('ordinary roster, missing fixed fields and absent baseline preserve exact frozen answer',()=>{
 const f=structuredClone(cases[0]);f.observation.players=f.observation.players.map(withoutMyBall);const r=call(f);assert.equal(r.answer,r.baseline);
 assert.equal(correctSetupBallRoles(cases[0].observation,{},r.baseline,champion.inspector),r.baseline);
 assert.equal(correctSetupBallRoles(cases[0].observation,cases[0].request,null,champion.inspector),null);
});
test('kicking uses the same actual ball eligibility, never falsifies skills or fielded roster',()=>{
 const f=structuredClone(cases[0]);f.observation.kicking='A';const r=call(f),oracle=structuredClone(f);oracle.observation.players=oracle.observation.players.map(withoutMyBall);
 assert.deepEqual(r.answer.positions,champion.chooseSetup(oracle.observation,oracle.request).positions);
 assert.deepEqual(Object.keys(r.answer.positions).sort(),Object.keys(r.baseline.positions).sort());
 assert.ok(f.observation.players.find(p=>p.id==='A1').skills.includes('myBall'));
});
test('reversing reply-window and selection transforms recovers the byte-identical observer parent',()=>{
 assert.equal(createHash('sha256').update(originalSelectionSource(fs.readFileSync(new URL('../src/champion.mjs',import.meta.url),'utf8'))).digest('hex'),'f2437dab2a9ad888e4e9130e672e9bc159393772650084170d9da91c52c833ff');
});
