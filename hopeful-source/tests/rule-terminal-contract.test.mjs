import test from 'node:test';import assert from 'node:assert/strict';import{auditBuiltinRules}from'../src/rules.mjs';
const o={team:'A'},input={kind:'playerAction',playerId:'carrier',action:'move',path:[]};
function services(position,alter=x=>x){let live=new Set();return{live,fork:{open:async()=>{live.add('root');return alter({ok:true,revisionBound:true,fork:'root',from:'root',node:'decision',decisionOf:'A',type:'reroll',prompt:'Use a retry?',branches:[{id:'none',label:'Do not retry'},{id:'skill',label:'Re-roll with Dodge'}],defaultBranch:1});},step:async q=>alter({ok:true,revisionBound:true,fork:q.fork,node:'terminal',completed:true,turnover:false,position}),close:async q=>{live.delete(q.fork);return{ok:true};}}};}
test('nullable terminal handles retain the same complete source-bound builtin offers as keyed terminals',async()=>{
 const keyed=services('future-key'),keyless=services(null),a=await auditBuiltinRules(o,input,keyed,Date.now()+10000),b=await auditBuiltinRules(o,input,keyless,Date.now()+10000);
 assert.equal(a.complete,true);assert.equal(b.complete,true);assert.deepEqual(a.offers,b.offers);
 assert.equal(b.terminalMass,1);assert.equal(b.unknown,0);assert.equal(b.keylessTerminalMass,1);
 assert.equal(keyed.live.size,0);assert.equal(keyless.live.size,0);assert.ok(!('endpoints' in b),'offer evidence supplies no successor state or value');
});
test('missing or malformed terminal contract remains unknown even when no successor handle is needed',async()=>{
 for(const change of [n=>{delete n.position;return n;},n=>({...n,position:''}),n=>({...n,position:17}),n=>({...n,completed:'true'}),n=>({...n,completed:false,turnover:false}),n=>({...n,revisionBound:false})]){
  const s=services(null,n=>n.node==='terminal'?change(n):n),a=await auditBuiltinRules(o,input,s,Date.now()+10000);
  assert.equal(a.complete,false);assert.equal(a.unknown,1);assert.equal(s.live.size,0);
 }
});
test('nullable terminals do not certify an unbound source, foreign decision owner, or missing builtin option',async()=>{
 for(const change of [n=>({...n,from:'foreign'}),n=>({...n,decisionOf:'B'}),n=>({...n,defaultBranch:3})]){
  const s=services(null,n=>n.node==='decision'?change(n):n),a=await auditBuiltinRules(o,input,s,Date.now()+10000);
  assert.equal(a.complete,false);assert.equal(a.unknown,1);assert.equal(s.live.size,0);
 }
});
test('incomplete chance probability is never completed by a nullable terminal handle',async()=>{
 const s=services(null,n=>n.node==='decision'?{...n,node:'chance',branches:[{p:.8}],unresolvedMass:.2}:n),a=await auditBuiltinRules(o,input,s,Date.now()+10000);
 assert.equal(a.complete,false);assert.equal(a.terminalMass,0);assert.equal(a.unknown,1);assert.equal(s.live.size,0);
});
