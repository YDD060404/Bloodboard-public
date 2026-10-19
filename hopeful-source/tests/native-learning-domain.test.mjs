import test from 'node:test';import assert from 'node:assert/strict';
import {learningDomain} from '../src/learning-domain.mjs';import {REQUIRED_ENGINE} from '../src/tactical-models.mjs';
import {buildProtectionPolicy,certifiedScopeClosure,certifiedOwnEndSelection} from '../src/protection.mjs';
const root=()=>({engine:{...REQUIRED_ENGINE},ruleset:{rulesEdition:'faq2026'},rulesEdition:'faq2026',team:'A',active:'A',phase:'play',players:[],ball:{kind:'ground'},pending:null,activation:{playerId:'p',action:'handoff'}});
test('legacy and actual FAQ share imitation input support without claiming FAQ training',()=>{
 for(const edition of ['legacy','faq2026']){const o=root();o.ruleset.rulesEdition=edition;o.rulesEdition=edition;const r=learningDomain(o);assert.equal(r.admitted,true);assert.equal(r.training_rulesEdition,'legacy');assert.equal(r.runtime_rulesEdition,edition);assert.ok(r.execution_requires.includes('native'));}
});
test('unknown edition, contradictory root, and any runtime fingerprint mismatch stay rejected',()=>{
 const o=root();o.rulesEdition='legacy';assert.equal(learningDomain(o).reason,'PUBLIC_RULES_EDITION_CONFLICT');o.rulesEdition='faq2026';delete o.ruleset.rulesEdition;assert.equal(learningDomain(o).admitted,false);o.ruleset.rulesEdition='faq2026';o.engine.apiHash='borrowed';assert.equal(learningDomain(o).admitted,false);
});
const inspect={CFG:{turnover:30,carrierTurnover:50,unresolved:200,optionalRush:1,carrierDown:110,opponentScore:240},boardValue:()=>0,outcomeValue:()=>({value:1})};
function services(mode='exact'){
 let f=0;return {validate:async(i,q)=>({ok:true,legal:mode!=='illegal',position:q.from}),
 explore:async(i,q)=>({ok:true,position:{key:q.from},perspective:'A',activeTeam:'A',outcomeIdentity:'complete-state-v1',decisionPolicy:{mode:'builtin',own:'builtin',opponent:'builtin'},exact:mode!=='inexact',unresolvedMass:0,rest:{p:0},outcomes:[{p:1,key:'s',active:'B',completed:true,turnover:false,observation:{...root(),active:'B',rulesEdition:mode==='wrong-successor'?'legacy':'faq2026'}}]}),
 fork:{open:async q=>({ok:true,from:q.from,revisionBound:true,fork:'f'+(++f),node:'terminal',position:'s',completed:true,turnover:false}),close:async()=>({ok:true}),step:async()=>null}};
}
test('certified EndActivation closure survives metadata selection but never graph copying or altered input',async()=>{
 const o=root(),r=await buildProtectionPolicy(o,{input:{kind:'endActivation'}},services(),inspect,Date.now()+8000);assert.equal(r.complete,true,r.reason);assert.equal(certifiedScopeClosure(r.tree,o,inspect),true);
 const chosen=certifiedOwnEndSelection(r.tree,{value:99},o,inspect);assert.equal(certifiedScopeClosure(chosen,o,inspect),true);assert.equal(certifiedScopeClosure({...chosen},o,inspect),false);
 assert.equal(certifiedScopeClosure(certifiedOwnEndSelection(r.tree,{input:{kind:'endTurn'}},o,inspect),o,inspect),false);assert.equal(certifiedScopeClosure(chosen,{...o,half:2},inspect),false);chosen.ruleMap.offers.push({});assert.equal(certifiedScopeClosure(chosen,o,inspect),false);
});
test('complete mass is insufficient when native FAQ chance is not exact, edition changes, or input illegal',async()=>{
 for(const [mode,reason] of [['inexact','own-FAQ-native-chance-not-exact'],['wrong-successor','own-FAQ-successor-edition-unverified'],['illegal','own-input-source-not-legal']]){const r=await buildProtectionPolicy(root(),{input:{kind:'endActivation'}},services(mode),inspect,Date.now()+8000);assert.equal(r.complete,false);assert.equal(r.reason,reason);}
});
