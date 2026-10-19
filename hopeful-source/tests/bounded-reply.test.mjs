import test from 'node:test';import assert from 'node:assert/strict';import {boundedReplyServices,withExploreDeadline} from '../src/bounded-reply.mjs';
test('bounded replies preserve source, remaining unknown, request time and exact response object',async()=>{
 const result={ok:true,exact:false,rest:{p:.4},unresolvedMass:.4,outcomes:[{p:.6,key:null}]},seen=[];
 const raw={explore:async(i,o)=>{seen.push([i,o]);return result;}},sv=boundedReplyServices(raw),input={kind:'endTurn'};
 for(const leaves of [undefined,4000,32]){const options={from:'real',perspective:'A',maxMs:500,threshold:1e-6,...(leaves===undefined?{}:{maxLeaves:leaves})};assert.equal(await sv.explore(input,options),result);assert.equal(seen.at(-1)[1].maxLeaves,leaves===32?32:64);assert.equal(seen.at(-1)[1].maxMs,500);assert.equal(options.maxLeaves,leaves);}
 assert.equal(result.exact,false);assert.equal(result.unresolvedMass,.4);
});
test('actual failure remains failed rather than becoming an incomplete success',async()=>{const failure={ok:false,code:'timeout'};assert.equal(await boundedReplyServices({explore:async()=>failure}).explore({},{}),failure);});

test('reply peer deadline reaches guard and preserves earlier nested deadline',async()=>{
 let seen;const raw={exploreLegalityValidation:true,explore:async(i,o)=>{seen=o;return {ok:true};}},deadline=Date.now()+3200;const sv=boundedReplyServices(raw,deadline);
 await sv.explore({action:'pass'},{maxMs:500});assert.equal(seen.coachEnumerationDeadline,deadline);
 await sv.explore({action:'pass'},{maxMs:500,coachEnumerationDeadline:deadline-500});assert.equal(seen.coachEnumerationDeadline,deadline-500);
});

test('frozen reply slot wrapper preserves original leaves and response while forwarding earliest deadline',async()=>{
 let seen;const response={ok:true,rest:{p:.3}};const raw={exploreLegalityValidation:true,explore:async(i,o)=>{seen=o;return response;}},sv=withExploreDeadline(raw,10000);
 assert.equal(await sv.explore({action:'pass'},{maxLeaves:1400,maxMs:500,coachEnumerationDeadline:9000}),response);assert.equal(seen.maxLeaves,1400);assert.equal(seen.maxMs,500);assert.equal(seen.coachEnumerationDeadline,9000);
});
