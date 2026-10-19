import test from 'node:test';import assert from 'node:assert/strict';import {decisionAgreement} from '../src/decision-agreement.mjs';
const move={kind:'playerAction',playerId:'p',action:'move',path:[]},native=[{id:7,input:move},{id:2,input:{kind:'endTurn'}}];
test('same-position builtin agreement uses observed id, never array position or opponent action',()=>{
 const o={requestId:1,builtInChoice:{candidateId:7,endTurn:false},engine:{apiHash:'verified-in-fixture'}},before=JSON.stringify([o,native]);const r=decisionAgreement(o,native,{action:'move',path:[],playerId:'p',kind:'playerAction'},{kind:'endTurn'});
 assert.equal(r.hostBuiltin.sameFinalInput,true);assert.equal(r.champion.sameFinalInput,false);assert.equal(r.hostBuiltin.exactPairedBalancedProfileVerified,false);assert.equal(JSON.stringify([o,native]),before);
});
test('builtin End and changed returned input stay distinct from champion comparison',()=>{
 const r=decisionAgreement({builtInChoice:{candidateId:null,endTurn:true}},native,{kind:'endTurn'},move);assert.equal(r.hostBuiltin.sameFinalInput,true);assert.equal(r.champion.sameFinalInput,false);
});
test('missing, inconsistent, unknown or duplicate builtin identities stay incomparable, not false agreement',()=>{
 for(const [o,ns] of [[{},native],[{builtInChoice:{candidateId:0,endTurn:false}},native],[{builtInChoice:{candidateId:7,endTurn:true}},native],[{builtInChoice:{candidateId:7,endTurn:false}},[native[0],native[0]]]]){
  const r=decisionAgreement(o,ns,move,null);assert.equal(r.hostBuiltin.comparable,false);assert.equal(r.hostBuiltin.sameFinalInput,null);assert.equal(r.champion.sameFinalInput,null);
 }
});
