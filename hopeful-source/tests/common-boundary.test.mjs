import {test} from 'node:test';
import assert from 'node:assert/strict';
import {auditCommonBoundary,commonPool} from '../src/common-boundary.mjs';
const move=id=>({kind:'playerAction',playerId:id,action:'move',path:[]});
const ob=(active='A',value=100)=>({active,phase:'play',value});
const branch=(key,active='A',value=100,p=1)=>({key,p,active,observation:ob(active,value),completed:true});
const ex=outcomes=>({ok:true,outcomes,pTurnover:0,pTouchdown:0,unresolvedMass:0,rest:{p:0}});
const end={input:{kind:'endTurn'},family:'endTurn',ex:ex([branch('end','B',90)]),baseValue:90};
const advance={input:move('p'),family:'move',ex:ex([branch('carry','A',120)]),baseValue:120};
const observation={team:'A',players:[],ball:{kind:'ground',pos:{x:0,y:0}}};
function mock(){
 const calls=[];
 const inspect={CFG:{optionalRush:0,turnover:0,carrierTurnover:0,unresolved:120},boardValue:()=>0,
  outcomeValue:e=>({value:e.outcomes.reduce((s,b)=>s+b.p*b.observation.value,0),unknown:e.unresolvedMass}),
  replyAssessment:async()=>({unknown:true,essentialComplete:false,failed:false,criticalAdjustment:-5,positionAdjustment:0})};
 const services={explore:async(input,args)=>{calls.push({input,args});return ex([branch('closed:'+args.from,'B',args.from==='carry'?120:140)]);}};
 return {calls,inspect,services};
}
test('own-End boundary ranks identically when incumbent identity is swapped; partial replies stay partial',async()=>{
 const a=mock(),b=mock();
 const r1=await auditCommonBoundary(observation,{mode:'normal',selected:end,lines:[end,advance]},end,a.services,a.inspect,Date.now()+10000);
 const r2=await auditCommonBoundary(observation,{mode:'normal',selected:advance,lines:[advance,end]},advance,b.services,b.inspect,Date.now()+10000);
 assert.deepEqual(r1.ranked.map(r=>r.input),r2.ranked.map(r=>r.input));
 assert.deepEqual(r1.ranked[0].input,advance.input);assert.equal(r1.ranked[0].reply_unknown,1);
 assert.equal(r1.override,false);assert.equal(r1.action_executed,false);
 assert.equal(a.calls.length,1);assert.equal(b.calls.length,1,'an already-ended policy never receives a second End');
 assert.equal(a.calls[0].args.decisions,'builtin');
});
test('actual prepared successor, rather than the intermediate board, reaches closure; source remains unchanged',async()=>{
 const m=mock(),line={...advance,preparedBranches:new Map([['carry',{plan:{input:move('guard')},ex:ex([branch('joint','A',140)])}]])};
 const original=JSON.stringify(line.ex);
 const r=await auditCommonBoundary(observation,{mode:'normal',selected:end,lines:[end,line]},end,m.services,m.inspect,Date.now()+10000);
 assert.equal(m.calls[0].args.from,'joint');assert.equal(r.pool.find(p=>p.input.playerId==='p').endpoint_value,140);
 assert.equal(JSON.stringify(line.ex),original);assert.equal(line.preparedBranches.size,1);
});
test('missing source key does not erase witnessed touchdown or normalize unknown mass away',async()=>{
 const m=mock(),line={input:move('p'),family:'move',ex:ex([{...branch('score','A',1500,.8),touchdown:'A'},branch(null,'A',100,.2)])};
 const r=await auditCommonBoundary(observation,{mode:'normal',selected:end,lines:[end,line]},end,m.services,m.inspect,Date.now()+10000);
 const row=r.pool.find(p=>p.input.playerId==='p');assert.equal(row.own_touchdown,.8);assert.equal(row.observed_own_touchdown,.8);
 assert.ok(Math.abs(row.own_unknown-.2)<1e-8);assert.equal(row.comparison_ready,false);
 assert.ok(row.rejections.includes('OWN_END_SOURCE_KEY_MISSING'));assert.equal(r.ranked.length,1);
});
test('terminal full-time End has no future closure or reply; probability and value survive',async()=>{
 const m=mock(),finish={...end,ex:ex([{...branch('full','A',90),observation:{...ob('A',90),phase:'fullTime'}}])};
 const r=await auditCommonBoundary(observation,{mode:'normal',selected:finish,lines:[finish]},finish,m.services,m.inspect,Date.now()+10000);
 assert.equal(m.calls.length,0);assert.equal(r.pool[0].terminal_mass,1);assert.equal(r.pool[0].reply_unknown,0);assert.equal(r.pool[0].shadow_score,90);
});
test('observed critical harm is charged even when reply completeness is unknown',async()=>{
 const m=mock();m.inspect.replyAssessment=async()=>({unknown:true,essentialComplete:false,failed:false,criticalAdjustment:-480,positionAdjustment:0});
 const r=await auditCommonBoundary(observation,{mode:'normal',selected:end,lines:[end]},end,m.services,m.inspect,Date.now()+10000);
 assert.equal(r.pool[0].critical_reply,-480);assert.equal(r.pool[0].shadow_score,90-480-18);
 assert.ok(r.pool[0].rejections.includes('BOUNDED_REPLY_INCOMPLETE'));
});
test('unavailable shared budget keeps pool visible and performs no query',async()=>{
 const m=mock(),r=await auditCommonBoundary(observation,{mode:'normal',selected:end,lines:[end,advance]},end,m.services,m.inspect,Date.now()+100);
 assert.equal(r.reason,'COMMON_COMPARISON_BUDGET_UNAVAILABLE');assert.equal(r.candidateInputs.length,2);assert.equal(m.calls.length,0);
 assert.equal(commonPool(observation,{selected:end,lines:[end,advance]},end).length,2);
});
test('explicit unresolved closure mass survives even when listed observations sum to one',async()=>{
 const m=mock();m.services.explore=async()=>({...ex([branch('closed','B',120)]),unresolvedMass:.1});
 const r=await auditCommonBoundary(observation,{mode:'normal',selected:end,lines:[end,advance]},end,m.services,m.inspect,Date.now()+10000);
 const row=r.pool.find(p=>p.input.playerId==='p');assert.equal(row.closed_own_mass,1);assert.equal(row.own_unknown,.1);
 assert.equal(row.comparison_ready,false);assert.ok(row.rejections.includes('OWN_END_OUTCOME_MASS_INCOMPLETE'));
});

test('source-bound joint policy remains in the shared review pool after a module declines endorsement',()=>{
 const joint={...advance,input:move('guard'),requireRuleMaps:true,preparedBranches:new Map([['carry',{plan:{input:move('p')}}]])};
 const pool=commonPool(observation,{selected:end,lines:[end]},end,8,[joint]);
 assert.deepEqual(pool.map(x=>x.line.input),[end.input,joint.input]);assert.equal(pool[1].line.preparedBranches,joint.preparedBranches);
});

test('own-active turnover must reach a real End boundary before any opponent reply',async()=>{
 const m=mock(),failure={...advance,ex:ex([{...branch('failed','A',100),turnover:true}])};let seen=[];
 m.inspect.replyAssessment=async b=>{seen.push(b.active);assert.equal(b.active,'B');return {unknown:true,essentialComplete:false,failed:false,criticalAdjustment:-5,positionAdjustment:0};};
 const r=await auditCommonBoundary(observation,{mode:'normal',selected:failure,lines:[failure]},failure,m.services,m.inspect,Date.now()+10000);
 assert.equal(m.calls.length,1);assert.equal(m.calls[0].args.from,'failed');assert.deepEqual(seen,['B']);
 assert.equal(r.pool[0].own_turnover,1);assert.equal(r.pool[0].own_unknown,0);
});

test('same first input retains different dependency policies but identical trees deduplicate',()=>{
 const extended={...advance,preparedBranches:new Map([['carry',{plan:{input:move('guard')},ex:ex([branch('joint','A',140)])}]])};
 const pool=commonPool(observation,{selected:end,lines:[end]},end,8,[advance,extended,extended]);
 assert.equal(pool.length,3);assert.deepEqual(pool[1].line.input,pool[2].line.input);
 assert.equal(pool[1].line.preparedBranches,undefined);assert.equal(pool[2].line.preparedBranches.size,1);
});
