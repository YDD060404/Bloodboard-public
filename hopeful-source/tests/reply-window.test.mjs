import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleReplyWindow,fixedReplyWindow} from '../src/reply-window.mjs';
import {createChampion} from '../src/champion.mjs';
import {requestServices,guardLiveExplore,withServiceOwner} from '../src/services.mjs';
import {verifiedFixture} from '../scripts/test-deps.mjs';
const clone=x=>JSON.parse(JSON.stringify(x));
const observation=JSON.parse(verifiedFixture('champion-game-p0001-L2.json')).decisions.find(r=>r.step===45&&r.observation).observation;
const input={kind:'playerAction',playerId:'B1',action:'blitz',path:[],blitzTarget:'A1',blockTarget:'A1'};
const options={from:'reply-root',team:'B',perspective:'A',observations:true,decisions:'builtin',maxMs:800,maxLeaves:1400,maxOutcomes:16,maxKeep:256};
const exact=q=>({ok:true,exact:true,outcomeIdentity:'complete-state-v1',position:{key:q.from},perspective:'A',activeTeam:'B',
 unresolvedMass:0,rest:{p:0},outcomes:[{key:'reply-success',p:1,active:'B',observation:{active:'B',phase:'play'},completed:true,turnover:false}]});
function clock(t){let now=1000;t.mock.method(Date,'now',()=>now);return {now:()=>now,advance:ms=>now+=ms};}

test('unguarded services retain exact identity and never sample a new caller window',async()=>{
 const result={},seen=[],raw={explore:(i,q)=>{seen.push(q);return result;}},q=Object.freeze({...options});
 assert.equal(sampleReplyWindow(raw,()=>{throw Error('unguarded window must not be sampled');}),raw);
 assert.equal(fixedReplyWindow(raw,2500),raw);assert.equal(raw.explore(input,q),result);assert.equal(seen[0],q);
});
test('actual decreasing left is sampled once and fixed across later calls, including expired or unknown windows',async t=>{
 const c=clock(t),seen=[],raw={exploreLegalityValidation:true,explore:(i,q)=>{seen.push(q);return q;}};let samples=0;
 const view=sampleReplyWindow(raw,()=>{samples++;return 9000-c.now();});
 await view.explore(input,options);c.advance(4000);await view.explore(input,options);
 assert.equal(samples,1);assert.ok(seen.every(q=>q.coachEnumerationDeadline===9000&&q.coachEnumerationDeadlineSource==='champion-reply-callee-left'));
 assert.ok(seen.every(q=>q.maxMs===800&&q.maxLeaves===1400));
 const expired=sampleReplyWindow(raw,()=>-100);await expired.explore(input,options);assert.equal(seen.at(-1).coachEnumerationDeadline,4900);
 assert.equal(sampleReplyWindow(raw,()=>NaN),raw);assert.equal(sampleReplyWindow(raw,()=>Infinity),raw);
});
test('earlier explicit caller and nested held windows preserve the controlling source and input/options',async t=>{
 clock(t);const seen=[],raw={exploreLegalityValidation:true,explore:(i,q)=>{seen.push([i,q]);return q;}};
 const parent=fixedReplyWindow(raw,9000),held=fixedReplyWindow(parent,3600,'champion-held-reply-deadline'),q=Object.freeze({...options,
  coachEnumerationDeadline:2200,coachEnumerationDeadlineSource:'real-peer'});
 await held.explore(input,q);assert.equal(seen[0][0],input);assert.deepEqual(seen[0][1],q);
 await held.explore(input,options);assert.equal(seen[1][1].coachEnumerationDeadline,3600);assert.equal(seen[1][1].coachEnumerationDeadlineSource,'champion-held-reply-deadline');
 await fixedReplyWindow(fixedReplyWindow(raw,2100,'parent-peer'),3600,'held').explore(input,options);
 assert.equal(seen[2][1].coachEnumerationDeadline,2100);assert.equal(seen[2][1].coachEnumerationDeadlineSource,'parent-peer');
 assert.equal(Object.hasOwn(options,'coachEnumerationDeadline'),false);
});

// Real replyAssessment and its lexical pickup/transfer/direct/held callees,
// with plain public-state/service mocks. No native probabilities or execution.
function replyFixture(c,{held=false}={}){
 const o=clone(observation),own=clone(o.players.find(p=>p.team==='A')),foe=clone(o.players.find(p=>p.team==='B')),
  gx=o.pitch.endZone.B,direction=Math.sign(gx-o.pitch.endZone.A),x=gx-direction;
 o.team='A';o.active='B';o.activation=null;
 o.players=[{...own,id:'A1',team:'A',location:'pitch',pos:{x,y:6},stance:'standing',activated:false,canBeActivated:true,rooted:false},
  {...foe,id:'B1',team:'B',location:'pitch',pos:{x,y:7},stance:'standing',activated:false,canBeActivated:true,rooted:false,ma:6},
  {...foe,id:'B2',team:'B',location:'pitch',pos:{x:gx,y:8},stance:'standing',activated:false,canBeActivated:true,rooted:false,ma:6}];
 o.ball={kind:'held',playerId:held?'B1':'A1'};
 const seen=[],handoff={kind:'playerAction',playerId:'B1',action:'handoff',path:[],handoffTarget:'B2'};
 const sv={exploreLegalityValidation:true,threats:{scoring:async()=>{c.advance(20);return {ok:true,exact:true,threats:[]};},
  blitz:async()=>{c.advance(20);return {ok:true,exact:true,blitzes:[]};}},
  candidates:async q=>{c.advance(20);const rows=q.families.includes('blitz')?[{input,kind:'block'}]:
   q.families.includes('handoff')?[{input:handoff,kind:'handoff'}]:held&&q.players?.length===1&&q.region?.x0===gx?
    [{kind:'score',input:{kind:'playerAction',playerId:q.players[0],action:'move',path:[{kind:'step',to:{x:gx,y:7}}]}}]:[];
   return {ok:true,complete:true,hasMore:false,candidates:rows};},
  explore:async(i,q)=>{seen.push({input:i,options:q,started:c.now()});c.advance(350);
   if(!held||i.action==='move')return {ok:true,exact:false,outcomes:[],unresolvedMass:1,rest:{p:1}};
   const after=clone(o);if(i.action==='handoff')after.ball={kind:'held',playerId:'B2'};
   return {ok:true,exact:true,outcomes:[{key:'reply-child-'+seen.length,p:1,active:'B',observation:after,completed:true,turnover:false}],pTurnover:0,pTouchdown:0,pOpponentTouchdown:0,unresolvedMass:0,rest:{p:0}};
  }};
 const left=()=>9000-c.now(),cap=(max=800)=>Math.max(100,Math.min(max,left()-200));
 return {o,sv,seen,left,cap,out:{key:'reply-root',p:1,active:'B',observation:o}};
}
test('real main reply uses the sampled caller deadline and leaves the original 800/1400/16/256 request and unknown intact',async t=>{
 const c=clock(t),f=replyFixture(c),r=await createChampion().inspector.replyAssessment(f.out,f.sv,fn=>fn(),f.cap,'A',f.left,true);
 const row=f.seen.find(x=>x.input.action==='blitz');assert.ok(row);assert.equal(row.options.coachEnumerationDeadline,9000);
 assert.equal(row.options.coachEnumerationDeadlineSource,'champion-reply-callee-left');
 assert.equal(row.options.maxMs,800);assert.equal(row.options.maxLeaves,1400);assert.equal(row.options.maxOutcomes,16);assert.equal(row.options.maxKeep,256);
 assert.equal(row.options.team,'B');assert.equal(row.options.perspective,'A');assert.equal(row.options.from,'reply-root');
 assert.equal(r.unknown,true);assert.equal(r.essentialComplete,false);
});
test('real replyAssessment preserves an earlier external caller deadline without changing its nominal request',async t=>{
 const c=clock(t),f=replyFixture(c),sv=fixedReplyWindow(f.sv,2200,'real-peer');
 const r=await createChampion().inspector.replyAssessment(f.out,sv,fn=>fn(),f.cap,'A',f.left,true);
 const row=f.seen.find(x=>x.input.action==='blitz');assert.ok(row);
 assert.equal(row.options.coachEnumerationDeadline,2200);assert.equal(row.options.coachEnumerationDeadlineSource,'real-peer');
 assert.equal(row.options.maxMs,800);assert.equal(row.options.maxLeaves,1400);assert.equal(r.unknown,true);assert.equal(r.essentialComplete,false);
});
test('real transfer, receiver score and held contact followup inherit one heldDeadline while main reply keeps its own window',async t=>{
 const c=clock(t),f=replyFixture(c,{held:true}),r=await createChampion().inspector.replyAssessment(f.out,f.sv,fn=>fn(),f.cap,'A',f.left,true);
 const main=f.seen.find(x=>x.input.action==='blitz'),children=f.seen.filter(x=>['handoff','move'].includes(x.input.action));
 assert.ok(main);assert.equal(main.options.coachEnumerationDeadline,9000);assert.ok(children.some(x=>x.input.action==='handoff'));
 assert.ok(children.some(x=>x.input.action==='move'&&x.input.playerId==='B2'),'actual transfer receiver callee is reached');
 assert.ok(r.heldReplyContinuation,'actual held contact followup callee is reached');
 assert.ok(children.every(x=>x.options.coachEnumerationDeadline===3600&&x.options.coachEnumerationDeadlineSource==='champion-held-reply-deadline'));
 assert.ok(children.at(-1).started>children[0].started);assert.ok(children.every(x=>x.options.maxMs<=650));
 assert.equal(r.unknown,true);assert.equal(r.essentialComplete,false);assert.equal(r.transferContinuation.incomplete,true);
});
test('guard strips window metadata, preserves native settings and owner cache, and reports allocation separately from dispatch',async t=>{
 clock(t);const seen=[],adapter=requestServices({validate:async(i,q)=>({ok:true,legal:true,position:q.from}),
  explore:async(i,q)=>{seen.push([i,q]);return exact(q);}},{deadline:50000}),
  guard=guardLiveExplore(adapter.services,'A',[{id:'A1',team:'A'},{id:'B1',team:'B'}],{deadline:50000,commonReserveMs:0,complexTimeExtension:true});
 const a=sampleReplyWindow(withServiceOwner(guard.services,{phaseId:'main'}),()=>8000);
 await a.explore(input,options);
 await fixedReplyWindow(withServiceOwner(guard.services,{phaseId:'held'}),3500,'champion-held-reply-deadline').explore(input,options);
 assert.equal(seen.length,1);assert.equal(seen[0][0],input);assert.deepEqual(seen[0][1],{...options,maxMs:3200});
 assert.equal(adapter.snapshot().hits,1);assert.equal(guard.snapshot().complexUnscopedCalls,0);
 assert.deepEqual(guard.snapshot().complexRequestedMs,{count:2,min:800,max:800});
 const costs=adapter.snapshot().candidateServiceCosts,dispatch=costs.events.filter(e=>costs.statuses[e[2]]==='raw-dispatched'&&costs.methods[e[1]]==='explore');
 assert.equal(dispatch.length,1);assert.equal(dispatch[0][0],'main');
 assert.ok(costs.events.some(e=>e[0]==='held'&&costs.statuses[e[2]]==='cache-hit'));
 assert.ok(!Object.hasOwn(seen[0][1],'coachEnumerationDeadlineSource'));assert.ok(!Object.hasOwn(seen[0][1],'coachEnumerationDeadline'));
});
test('a spent held window refuses locally without native chance or service failure',async t=>{
 const c=clock(t);let explores=0,validations=0;const adapter=requestServices({validate:async(i,q)=>{validations++;c.advance(800);return {ok:true,legal:true,position:q.from};},
  explore:async()=>{explores++;throw Error('expired held window must not dispatch');}},{deadline:50000}),
  guard=guardLiveExplore(adapter.services,'A',[{id:'A1',team:'A'},{id:'B1',team:'B'}],{deadline:50000,commonReserveMs:0,complexTimeExtension:true});
 const r=await fixedReplyWindow(sampleReplyWindow(guard.services,()=>48000),2500,'champion-held-reply-deadline').explore(input,options);
 assert.equal(validations,1);assert.equal(explores,0);assert.equal(r.reason,'complex-enumeration-budget-unavailable');
 assert.equal(r.position.key,'reply-root');assert.equal(r.outcomes,undefined);assert.equal(r.rest,undefined);assert.equal(adapter.snapshot().serviceFailures.count,0);
});

test('real retainedDirectScore caller qualifies the transferred native child and extends only exact Move signature',async t=>{
 const c=clock(t),f=replyFixture(c,{held:true});f.o.requestId=17;f.o.pending=null;f.out.key='17.1';
 const raw={...f.sv,capabilities:async()=>({limits:{maxServiceCalls:12000,maxPositions:8000,maxOutcomesPerCall:40,maxCallMs:15000}}),
  diagnostics:async()=>({ok:true,usage:{totalCalls:0,positions:0},limitsLeft:{leaves:2000000,serviceMs:50000}}),
  validate:async(i,q)=>({ok:true,legal:true,position:q.from}),explore:async(i,q)=>{const r=await f.sv.explore(i,q);
   for(const [n,b] of (r.outcomes??[]).entries()){b.key='17.'+(10+f.seen.length*2+n);b.observation.requestId=17;b.observation.pending=null;}
   return r;}};
 const adapter=requestServices(raw,{deadline:100000,resourceBudget:true,callReserve:0,positionReserve:0});await adapter.initialize();
 const guard=guardLiveExplore(adapter.services,'A',f.o.players,{deadline:100000,heldDirectTimeExtension:true});
 const r=await createChampion().inspector.replyAssessment(f.out,guard.services,fn=>fn(),f.cap,'A',f.left,true);
 const receiver=f.seen.find(x=>x.input.action==='move'&&x.input.playerId==='B2');assert.ok(receiver);
 assert.equal(receiver.options.maxMs,1500);assert.equal(receiver.options.maxLeaves,1800);assert.equal(receiver.options.maxOutcomes,20);
 assert.ok(!Object.hasOwn(receiver.options,'coachEnumerationDeadline'));assert.equal(r.unknown,true);
 assert.ok(guard.snapshot().heldDirectSamples.some(x=>x.holderId==='B2'&&x.sourceValidation?.legal===true));
});
