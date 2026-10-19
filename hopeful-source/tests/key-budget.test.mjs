import test from 'node:test';import assert from 'node:assert/strict';import {requestServices,reserveFutureKeyCapacity} from '../src/services.mjs';
const input={kind:'endTurn'};
async function fixture(){let positions=100,calls=[];
 const adapter=requestServices({capabilities:async()=>({limits:{maxServiceCalls:1000,maxPositions:4000}}),diagnostics:async()=>({ok:true,usage:{totalCalls:0,positions}}),explore:async(i,q)=>{calls.push([i,q]);return {ok:true,outcomes:[{p:1,key:q.noKeys?null:'7.101',observation:{active:'B'}}]};}},{resourceBudget:true,callReserve:0,positionReserve:0});
 await adapter.initialize();return {calls,services:adapter.services,set:n=>positions=n,stock:adapter.keyStock};}
test('remaining slots are shared by stages without registration changes to root/current-comparison calls',async()=>{
 const f=await fixture(),r=reserveFutureKeyCapacity(f.services,f.stock);
 await r.services.explore(input,{from:'7.1',maxOutcomes:40,observations:true,threshold:1e-6});
 assert.equal(r.report.reservedForComparison,1950);assert.equal(r.report.speculativeCeiling,2050);
 f.set(2030);const q={from:'7.1',maxOutcomes:40,observations:true,threshold:1e-6,maxLeaves:4000,maxMs:550},result=await r.services.explore(input,q);
 assert.equal(result.outcomes[0].key,null);assert.deepEqual(f.calls.at(-1)[1],{...q,noKeys:true});assert.ok(!('noKeys' in q));
 await r.services.explore(input,{from:'root'});assert.ok(!f.calls.at(-1)[1].noKeys);
 await f.services.explore(input,q);assert.ok(!f.calls.at(-1)[1].noKeys,'actual comparison is outside speculative wrapper');
});
test('source allocation watermark is request-local, includes fork/sequence headers, and cache hits allocate nothing',async()=>{
 const a=requestServices({explore:async()=>({ok:true,exact:true,unresolvedMass:0,rest:{p:0},position:{key:'root'},outcomes:[{key:'7.1',p:1,observation:{},completed:true,turnover:false}]}),fork:{open:async()=>({ok:true,position:'7.3'})},sequence:async()=>({ok:true,finals:[{key:'7.4'}]})});
 await a.services.explore(input,{});await a.services.explore(input,{});await a.services.fork.open({});await a.services.sequence({});
 assert.equal(a.keyStock().watermark,4);assert.equal(a.keyStock().observedUnique,3);assert.equal(a.snapshot().hits,1);
 const b=requestServices({});assert.equal(b.keyStock().watermark,0);
});
test('opaque or mixed request handles never imply a valid reservation',async()=>{
 const f=requestServices({fork:{open:async()=>({ok:true,position:'7.1'}),step:async()=>({ok:true,position:'8.2'})}});
 await f.services.fork.open({});await f.services.fork.step({});assert.equal(f.keyStock().mixedRequests,true);
 let q;const raw={explore:async(i,o)=>{q=o;return {ok:true};}},r=reserveFutureKeyCapacity(raw,f.keyStock);
 await r.services.explore(input,{from:'7.1'});assert.equal(q.noKeys,true);assert.equal(r.report.initialized,false);
});
test('service failure and malformed outcome arrays cannot manufacture or throw away key accounting',async()=>{
 const a=requestServices({explore:async()=>({ok:false,outcomes:[{key:'7.100'}]})});await a.services.explore(input,{});assert.equal(a.keyStock().watermark,0);
 const malformed=requestServices({sequence:async()=>({ok:true,finals:{key:'7.100'}})});assert.equal((await malformed.services.sequence({})).ok,true);assert.equal(malformed.keyStock().watermark,0);
});
