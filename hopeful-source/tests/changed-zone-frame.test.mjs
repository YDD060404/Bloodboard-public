import test from 'node:test';
import assert from 'node:assert/strict';
import {compareOpponentEndValues} from '../src/opponent-end-values.mjs';
const p=(id,team,x,y)=>({id,team,pos:{x,y},location:'pitch',stance:'standing',tackleZone:true,ma:6,st:3,ag:3,skills:[]});
async function frame({incomplete=false,missingZone=false,foreignActor=false,additionalSource=false,badKind=false,badTarget=false}={}){
 const root={team:'A',active:'A',score:{A:0,B:0},phase:'play',half:1,turn:{A:1,B:1},turnsPerHalf:8,players:[],rulesEdition:'faq2026'};
 const obs=[13,12].map((x,i)=>({...root,active:'B',players:[p('marker','A',x,i?8:7),p('target','A',11,11),p('foe','B',11,9)]}));
 if(missingZone)delete obs[0].players[0].tackleZone;
 if(additionalSource)obs.push({...obs[0]});
 const inputs=[{kind:'endTurn'},{kind:'playerAction',playerId:'marker',action:'move',path:[{to:{x:12,y:8},kind:'step'}]}];
 const own=obs.slice(0,2).map((o,i)=>({complete:true,tree:{input:inputs[i]},policy:{input:inputs[i],secondCost:0,ex:{pTurnover:0}},endpoints:[{p:1,key:'s'+i,active:'B',observation:o}]}));
 if(additionalSource)own[0].endpoints=[{...own[0].endpoints[0],p:.5},{p:.5,key:'s2',active:'B',observation:obs[2]}];
 const queries=[],services={validate:async(input,q)=>({ok:true,legal:input.kind==='endTurn',position:q.from}),
  explore:async(input,q)=>({ok:true,position:{key:q.from},perspective:'A',activeTeam:'B',outcomeIdentity:'complete-state-v1',decisionPolicy:{mode:'builtin',own:'builtin',opponent:'builtin'},enumerated:1,unresolvedMass:0,rest:{p:0},pTouchdown:0,pOpponentTouchdown:0,outcomes:[{p:1,key:q.from+'end',active:'A',turnover:false,observation:{...obs[Number(q.from.slice(1))],active:'A'}}]}),
  candidates:async q=>{queries.push(q);const candidates=(foreignActor||badKind||badTarget)&&q.players?[{legal:true,kind:'blitz',input:{kind:badKind?'endTurn':'playerAction',action:'blitz',playerId:foreignActor?'not-query-actor':'foe',blitzTarget:'target',blockTarget:badTarget?'other-target':'target',path:[{to:{x:1,y:1},kind:'step'}]}}]:q.players?[]:[{legal:true,kind:'blitz',input:{kind:'playerAction',action:'blitz',playerId:'foe',blitzTarget:'target',path:[]}}];
   return {ok:true,position:{key:q.from},offset:0,limit:q.limit,total:candidates.length,returned:candidates.length,hasMore:false,nextOffset:null,complete:!(incomplete&&q.players),pool:{generated:candidates.length,afterFilters:candidates.length,afterLimits:candidates.length,droppedByFilters:0},truncated:[],candidates};}};
 const inspect={CFG:{touchdown:1500,possession:160,carrierTurnover:50,turnover:30,optionalRush:1},boardValue:()=>0};
 return {result:await compareOpponentEndValues(root,own,services,inspect,Date.now()+30000,{valueMode:'coordinated-terminal',comparisonScope:'finite-common'}),queries};
}
test('every source gets the same per-actor changed-zone discovery query',async()=>{
 const {result,queries}=await frame();assert.equal(result.valid,true);assert.equal(result.finiteDomainComparable,true);
 const zone=queries.filter(q=>q.players);assert.equal(zone.length,2);assert.ok(zone.every(q=>q.players[0]==='foe'&&q.targets[0]==='target'));
});
test('an incomplete changed-zone page cannot certify the expanded finite domain',async()=>{
 const {result}=await frame({incomplete:true});assert.equal(result.finiteDomainComparable,false);
});
test('unavailable zone evidence cannot silently certify the new discovery',async()=>{
 const {result}=await frame({missingZone:true});assert.equal(result.finiteDomainComparable,false);
});
test('a response with another actor cannot masquerade as the scoped proposal page',async()=>{
 const {result}=await frame({foreignActor:true});assert.equal(result.finiteDomainComparable,false);
});

test('changed-zone pages cover every observed own-End source, not only the largest branch',async()=>{
 const {result,queries}=await frame({additionalSource:true});assert.equal(result.finiteDomainComparable,true);
 assert.deepEqual(queries.filter(q=>q.players).map(q=>q.from).sort(),['s0','s1','s2']);
});

test('a wrong input kind or inconsistent blitz/block targets cannot certify a scoped page',async()=>{
 for(const options of [{badKind:true},{badTarget:true}])assert.equal((await frame(options)).result.finiteDomainComparable,false);
});
