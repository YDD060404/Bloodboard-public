import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requestServices} from '../src/services.mjs';
import {policyFrom} from '../src/policy.mjs';
import {auditCommonBoundary} from '../src/common-boundary.mjs';

const input={kind:'endTurn'},move={kind:'playerAction',playerId:'p',action:'move',path:[]};
const branch=(phase,key='146.727',p=1)=>({key,p,active:'A',observation:{active:'A',phase,value:90},completed:true,turnover:false});
const explore=(b,extra={})=>({ok:true,outcomeIdentity:'complete-state-v1',position:{key:'root'},outcomes:[b],unresolvedMass:0,rest:{p:0},...extra});
test('known period endpoints refuse continuation locally, preserve final validation and consume no RPC',async()=>{
 for(const phase of ['halfOver','fullTime','touchdown']){
  const calls=[];const raw={explore:async(...a)=>{calls.push(['explore',...a]);return explore(branch(phase));},
   candidates:async a=>{calls.push(['candidates',a]);return {ok:true};},validate:async()=>{calls.push(['validate']);return {ok:true};}};
  const a=requestServices(raw,{requestId:146,cache:false});await a.services.explore(input,{from:'root'});
  assert.equal((await a.services.candidates({from:'146.727'})).code,'coach-terminal-position');
  assert.equal((await a.services.explore(input,{from:'146.727'})).code,'coach-terminal-position');
  assert.equal((await a.finalServices.validate(input)).ok,true);
  assert.deepEqual(calls.map(x=>x[0]),['explore','validate']);
  const s=a.snapshot();assert.equal(s.positionLifecycle.refusals,2);assert.equal(s.serviceFailures.count,0);
  assert.equal(s.resourceBudget.refusals,0);assert.equal(s.rpcCalls,2);
 }
});
test('foreign keys, unknown phase, wrong source, failed responses and keyless witnesses cannot create terminal handles',async()=>{
 const cases=[explore(branch('halfOver','145.727')),explore(branch('future')),explore(branch('halfOver'),{position:{key:'wrong'}}),
  explore(branch('halfOver'),{ok:false,code:'timeout'}),explore(branch('halfOver',null)),
  explore(branch('halfOver'),{outcomeIdentity:'grouped'}),explore({...branch('halfOver'),active:'B'})];
 for(const response of cases){let calls=0;const a=requestServices({explore:async()=>{calls++;return response;},candidates:async()=>{calls++;return {ok:true};}},{requestId:146,cache:false});
  await a.services.explore(input,{from:'root'});assert.equal((await a.services.candidates({from:'146.727'})).ok,true);assert.equal(calls,2);assert.equal(a.snapshot().positionLifecycle.knownTerminalPositions,0);
 }
});
test('partial successful enumeration retains known terminal mass without pretending unknown mass is resolved; scope is per request',async()=>{
 const response=explore(branch('halfOver','146.727',.6),{unresolvedMass:.4,rest:{p:.4}});
 const a=requestServices({explore:async()=>response,candidates:async()=>({ok:true})},{requestId:146});
 assert.deepEqual(await a.services.explore(input,{from:'root'}),response);
 assert.equal((await a.services.candidates({from:'146.727'})).code,'coach-terminal-position');
 const fresh=requestServices({candidates:async()=>({ok:true})},{requestId:146});assert.equal((await fresh.services.candidates({from:'146.727'})).ok,true);
 const playing=requestServices({explore:async()=>explore({...branch('play'),touchdown:'A'}),candidates:async()=>({ok:true})},{requestId:146});
 await playing.services.explore(move,{from:'root'});assert.equal((await playing.services.candidates({from:'146.727'})).ok,true,'event horizon absorption must not mislabel a play-phase service handle as illegal');
});
test('conditional policy absorbs real period end without executing a saved later dependency or charging its cost',()=>{
 for(const phase of ['halfOver','fullTime','touchdown']){
  const first={input,ex:explore(branch(phase))};const prepared=new Map([['146.727',{plan:{input:move},ex:explore(branch('play'))}]]);
  const p=policyFrom(first,prepared,'A',{CFG:{optionalRush:1}});assert.equal(p.complete,true);assert.equal(p.transitions.length,0);
  assert.equal(p.secondCost,0);assert.equal(p.ex.outcomes[0].observation.phase,phase);assert.equal(p.unknown,0);
 }
});
test('half boundary on own-active End retains value and probability with no closure or opponent queries',async()=>{
 let calls=0;const end={input,family:'endTurn',ex:explore(branch('halfOver')),baseValue:90};
 const inspect={CFG:{unresolved:120,turnover:0,carrierTurnover:0,optionalRush:0},boardValue:()=>0,outcomeValue:e=>({value:e.outcomes.reduce((s,b)=>s+b.p*b.observation.value,0),unknown:e.unresolvedMass}),
  replyAssessment:async()=>{calls++;throw Error('no opponent action after half');}};
 const r=await auditCommonBoundary({team:'A',players:[],ball:{kind:'ground'}},{mode:'normal',selected:end,lines:[end]},end,
  {explore:async()=>{calls++;throw Error('no second End after half');}},inspect,Date.now()+10000);
 assert.equal(calls,0);assert.equal(r.pool[0].terminal_mass,1);assert.equal(r.pool[0].own_unknown,0);
 assert.equal(r.pool[0].reply_unknown,0);assert.equal(r.pool[0].shadow_score,90);
});
