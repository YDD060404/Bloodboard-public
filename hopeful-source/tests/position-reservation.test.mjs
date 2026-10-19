import test from 'node:test';
import assert from 'node:assert/strict';
import {requestServices,reserveFutureKeyCapacity,withServiceOwner,guardLiveExplore} from '../src/services.mjs';

async function fixture({positions=40,maxPositions=4000}={}){
 const state={positions,calls:0,seen:[],diagnosticsFail:false,wait:null};
 const adapter=requestServices({
  capabilities:async()=>({limits:{maxServiceCalls:1000,maxPositions,maxOutcomesPerCall:40}}),
  diagnostics:async()=>state.readDiagnostics?state.readDiagnostics():state.diagnosticsFail?{ok:false}:{ok:true,usage:{totalCalls:state.calls,positions:state.positions}},
  fork:{open:async()=>({ok:true,position:'42.6000'})},
  validate:async(i,q)=>({ok:true,legal:true,position:q.from}),
  explore:async(input,q)=>{
   state.calls++;state.seen.push(q);
   if(state.wait)await state.wait;
   if(!q.noKeys)state.positions+=Math.min(q.maxOutcomes??40,q.maxKeep??40);
   return {ok:true,outcomes:[{p:1,key:q.noKeys?null:'42.9000',observation:{active:'B'}}]};
  }
 },{resourceBudget:true,callReserve:0,positionReserve:0,cache:false});
 await adapter.initialize();await adapter.services.fork.open({});
 const reservation=reserveFutureKeyCapacity(adapter.services,adapter.keyStock);
 return {state,adapter,reservation};
}

test('sparse worker id blocks do not consume the verified position reservation',async()=>{
 const {state,reservation}=await fixture();
 await reservation.services.explore({kind:'endTurn'},{from:'42.6000',maxOutcomes:40,observations:true});
 assert.equal(state.seen[0].noKeys,undefined);
 assert.equal(reservation.report.initialPositionsUsed,40);
 assert.equal(reservation.report.reservedForComparison,1980);
 assert.equal(reservation.report.speculativeCeiling,2020);
});

test('concurrent owner views share speculation capacity and preserve comparison handles',async()=>{
 const {state,reservation,adapter}=await fixture({positions:80,maxPositions:100});
 let release;state.wait=new Promise(r=>release=r);
 const a=withServiceOwner(reservation.services,{phaseId:'a'}).explore({kind:'endTurn'},{from:'42.6000',maxOutcomes:10});
 const b=withServiceOwner(reservation.services,{phaseId:'b'}).explore({kind:'endTurn'},{from:'42.6000',maxOutcomes:10});
 await new Promise(r=>setImmediate(r));release();await Promise.all([a,b]);state.wait=null;
 assert.equal(state.seen.filter(q=>!q.noKeys).length,1);
 assert.equal(state.positions,90);
 assert.equal(adapter.snapshot().resourceBudget.stopped,null);
 await adapter.services.explore({kind:'endTurn'},{from:'42.6000',maxOutcomes:10});
 assert.equal(state.positions,100,'common comparison retains the reserved ten positions');
});

test('failed diagnostics cannot silently grant speculative handles',async()=>{
 const {state,reservation}=await fixture();state.diagnosticsFail=true;
 const result=await reservation.services.explore({kind:'endTurn'},{from:'42.6000',maxOutcomes:40});
 assert.equal(result.ok,false);assert.equal(state.seen.length,0);
});


test('reservation survives copied service views and guard option rewriting',async()=>{
 const {state,adapter}=await fixture({positions:80,maxPositions:100});
 const guard=guardLiveExplore(adapter.services,'A',[{id:'A1',team:'A'}]);
 const copied={...guard.services,candidates:async()=>({ok:true})};
 const r=reserveFutureKeyCapacity(copied,adapter.keyStock);
 const input={kind:'playerAction',playerId:'A1',action:'move',path:[]};
 const q=Object.freeze({from:'42.6000',maxOutcomes:10,maxMs:100,coachEnumerationDeadline:Date.now()+10000});
 await r.services.explore(input,q);
 await r.services.explore(input,q);
 assert.equal(state.seen[0].noKeys,undefined);assert.equal(state.seen[1].noKeys,true);
 assert.equal(state.positions,90);assert.equal(q.noKeys,undefined);
 assert.equal(Object.hasOwn(state.seen[0],'coachEnumerationDeadline'),false);
});

test('root calls bypass the split and maxKeep bounds retained allocation',async()=>{
 const {state,adapter}=await fixture({positions:80,maxPositions:100});
 const r=reserveFutureKeyCapacity(adapter.services,adapter.keyStock);
 await r.services.explore({kind:'endTurn'},{from:'root',maxOutcomes:1});
 assert.equal(r.report.initialized,false,'root calls bypass the speculative split');
 await r.services.explore({kind:'endTurn'},{from:'42.6000',maxOutcomes:40,maxKeep:1});
 assert.equal(state.seen.at(-1).noKeys,undefined,'actual maxKeep bounds retained allocation');
});


test('a delayed diagnostic is refreshed after another allocation completes',async()=>{
 const {state,reservation}=await fixture({positions:80,maxPositions:100});
 let finishFirst;state.wait=new Promise(r=>finishFirst=r);
 const a=reservation.services.explore({kind:'endTurn'},{from:'42.6000',maxOutcomes:10});
 await new Promise(r=>setImmediate(r));
 let staleReply;state.readDiagnostics=()=>new Promise(r=>staleReply=r);
 const b=reservation.services.explore({kind:'endTurn'},{from:'42.6000',maxOutcomes:10});
 await new Promise(r=>setImmediate(r));
 finishFirst();await a;state.wait=null;state.readDiagnostics=null;
 staleReply({ok:true,usage:{totalCalls:1,positions:80}});
 await b;
 assert.equal(state.positions,90);
 assert.equal(state.seen[1].noKeys,true,'stale occupancy cannot spend common-comparison capacity');
});
