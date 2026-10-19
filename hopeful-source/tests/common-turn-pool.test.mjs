// Frozen C31 completeness mode is retained as an explicit ablation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {compareCommonTurnPool} from '../src/common-turn-pool.mjs';
import {commonPool,auditCommonBoundary} from '../src/common-boundary.mjs';
import {createCandidateLedger} from '../src/candidate-ledger.mjs';
const move=id=>({kind:'playerAction',playerId:id,action:'move',path:[{kind:'step',to:{x:3,y:3}}]});
function graph(){
 const o={team:'A',active:'A',phase:'play',half:1,drive:1,turn:{A:1,B:1},turnsPerHalf:8,pitch:{width:26,height:15},ball:{kind:'held',playerId:'foe'},players:[{id:'foe',team:'B',location:'pitch',stance:'standing',pos:{x:20,y:3},ma:6,st:3,ag:3,skills:[]}]};
 const calls=[],values={current:700,later:740,third:710};let forks=0;
 const ex=(from,input)=>({ok:true,position:{key:from},perspective:'A',activeTeam:'A',outcomeIdentity:'complete-state-v1',decisionPolicy:{mode:'builtin',own:'builtin',opponent:'builtin'},exact:true,unresolvedMass:0,rest:{p:0},outcomes:[{key:from+':'+input.playerId,p:1,active:'B',observation:{...o,active:'B',actor:input.playerId,value:values[input.playerId]??700},turnover:false,completed:true}]});
 const inspect={CFG:{carrierTurnover:50,turnover:30,unresolved:200,optionalRush:1,carrierDown:110,opponentScore:240},canonical:x=>x,boardValue:()=>0,
  outcomeValue:e=>({value:e.outcomes.reduce((v,b)=>v+b.p*b.observation.value,0)}),replyAssessment:async()=>({failed:false,unknown:false,essentialComplete:true,criticalAdjustment:0,positionAdjustment:0})};
 const services={validate:async(i,q={})=>({ok:true,legal:true,position:q.from??'root'}),explore:async(i,q)=>{calls.push([i,q]);return ex(q.from,i);},
  candidates:async q=>({ok:true,position:{key:q.from},offset:0,total:0,returned:0,hasMore:false,complete:true,candidates:[]}),
  fork:{open:async q=>({ok:true,revisionBound:true,from:q.from,fork:'f'+(++forks),node:'terminal',position:'terminal',completed:true,turnover:false}),close:async()=>({ok:true}),step:async()=>null}};
 const line=id=>({input:move(id),ex:ex('root',move(id))});return {o,inspect,services,line,calls};
}
test('a later complete proposal competes against current in one common frame without role bonuses',async()=>{
 const f=graph(),current=f.line('current');
 const r=await compareCommonTurnPool(f.o,{mode:'normal',selected:current,lines:[current]},current,[f.line('later'),f.line('third')],f.services,f.inspect,Date.now()+30000,{valueMode:'legacy-completeness'});
 assert.ok(r.attempted);assert.equal(r.rows.length,3);assert.ok(r.rows.every(x=>x.ownComplete));
 assert.equal(r.selected?.input.playerId,'later',r.reason);assert.equal(r.replyMeasurements.length,3);
});
test('producer order cannot make the current identity defeat a stronger measured peer',async()=>{
 for(const ids of [['third','later'],['later','third']]){
  const f=graph(),current=f.line('current'),r=await compareCommonTurnPool(f.o,{mode:'normal',selected:current,lines:[current]},current,ids.map(f.line),f.services,f.inspect,Date.now()+30000,{valueMode:'legacy-completeness'});
  assert.equal(r.selected?.input.playerId,'later',r.reason);
 }
});
test('learned winner attribution follows its actual policy, not another plan with the same first action',async()=>{
 const f=graph(),current=f.line('current'),learned=f.line('later');
 const r=await compareCommonTurnPool(f.o,{mode:'normal',selected:current,lines:[current]},current,[learned],f.services,f.inspect,Date.now()+30000,{learnedLine:learned,valueMode:'legacy-completeness'});
 assert.equal(r.selected?.input.playerId,'later');assert.equal(r.selectedLearnedProposal,true);
 const g=graph(),c=g.line('current'),proposal=g.line('third');
 const other=await compareCommonTurnPool(g.o,{mode:'normal',selected:c,lines:[c]},c,[proposal,g.line('later')],g.services,g.inspect,Date.now()+30000,{learnedLine:proposal,valueMode:'legacy-completeness'});
 assert.equal(other.selected?.input.playerId,'later');assert.equal(other.selectedLearnedProposal,false);
});
test('unchecked current replies do not count as a winning safe incumbent',async()=>{
 const f=graph(),current=f.line('current');f.inspect.replyAssessment=async b=>({failed:false,unknown:b.observation.actor==='current',essentialComplete:b.observation.actor!=='current',criticalAdjustment:0,positionAdjustment:0});
 const r=await compareCommonTurnPool(f.o,{mode:'normal',selected:current,lines:[current]},current,[f.line('later')],f.services,f.inspect,Date.now()+30000,{valueMode:'legacy-completeness'});
 assert.equal(r.selected,null);assert.equal(r.winnerIndex,-1);assert.match(r.reason,/fallback-is-not-a-winner/);
 assert.ok(r.rows.find(x=>x.currentFallback).measuredUnknown>0);
});
test('two complete alternatives cannot replace a current action whose boundary is incomparable',async()=>{
 const f=graph(),current=f.line('current'),original=f.services.explore;
 current.ex={ok:false};f.services.explore=async(i,q)=>i.playerId==='current'?{ok:false,code:'timeout'}:original(i,q);
 const r=await compareCommonTurnPool(f.o,{mode:'normal',selected:current,lines:[]},current,[f.line('later'),f.line('third')],f.services,f.inspect,Date.now()+30000,{valueMode:'legacy-completeness'});
 assert.equal(r.selected,null);assert.match(r.reason,/current-own-boundary-incomparable/);assert.equal(r.rows.filter(x=>x.ownComplete).length,2);
});
test('same first action retains distinct dependency policies and a real End candidate',()=>{
 const f=graph(),current=f.line('current');const a={...current,preparedBranches:new Map([['branch',{plan:{input:move('later')}}]])};const b={...current,preparedBranches:new Map([['branch',{plan:{input:move('third')}}]])};const end={input:{kind:'endTurn'},ex:{ok:true}};
 const pool=commonPool(f.o,{selected:current,lines:[end]},current,8,[a,b]);
 assert.equal(pool.filter(x=>x.line.input.playerId==='current').length,3);assert.ok(pool.some(x=>x.line.input.kind==='endTurn'));
});
test('certain-TD and final-turn modes preserve their protected decision without extra work',async()=>{
 for(const mode of ['certain-td','final-turn']){const f=graph(),current=f.line('current'),r=await compareCommonTurnPool(f.o,{mode,selected:current},current,[f.line('later')],f.services,f.inspect,Date.now()+30000,{valueMode:'legacy-completeness'});assert.equal(r.attempted,false);assert.equal(f.calls.length,0);}
});

test('a duplicate category leader does not hide the next independent complete dependency',()=>{
 const f=graph(),current={...f.line('current'),baseValue:100,preparedBranches:new Map([['root:current',{plan:{input:move('later')}}]])};
 const dependency={...f.line('third'),baseValue:50,preparedBranches:new Map([['root:third',{plan:{input:move('later')}}]])};
 const ordinary={...f.line('later'),baseValue:200};
 const pool=commonPool(f.o,{selected:current,lines:[current,ordinary,dependency]},current,3,[]);
 assert.ok(pool.some(r=>r.line===dependency));assert.equal(pool.find(r=>r.line===dependency).source,'priced-dependency');
});

function possessionPool({limit=8,goalLines=[],ordinaryLines=[],ledger=null}={}){
 const holder={id:'carrier',team:'A',location:'pitch',stance:'standing',pos:{x:18,y:7},ma:6,skills:[]};
 const o={requestId:93,team:'A',active:'A',phase:'play',half:1,drive:2,turn:{A:3,B:2},
  pitch:{width:26,height:15,endZone:{A:25,B:0}},ball:{kind:'held',playerId:holder.id},players:[holder]};
 const line=(id,extra={})=>({input:move(id),ex:{ok:true,outcomes:[]},baseValue:extra.baseValue??0,...extra});
 const goal={id:`goal:A:1:2:3:held:${holder.id}`,kind:'stabilize-possession',target:holder.id};
 const champion=line('champion'),current=line('current'),early=line('early');
 const end={input:{kind:'endTurn'},ex:{ok:true,outcomes:[]},baseValue:0};
 const extras=[early,...goalLines],origins=ledger?extras.map((c,index)=>ledger.occurrence(c,
  {source:index===0?'learned':'goals',role:'policyTrees',index})):[];
 const snapshot={selected:champion,lines:[champion,end]};
 const pool=commonPool(o,snapshot,current,limit,[...extras,...ordinaryLines],
  {ledger,run:'goal-slot',extraOrigins:ledger?[
   ...origins,...ordinaryLines.map((c,index)=>ledger.occurrence(c,{source:'ordinary-fixture',role:'policyTrees',index}))
  ]:[]});
 return {o,goal,line,champion,current,early,end,snapshot,pool,extras:[...extras,...ordinaryLines],origins};
}

test('a source-identified stabilize-possession goal gets a pool slot before ordinary fill',()=>{
 const f=possessionPool({goalLines:[{input:move('support'),ex:{ok:true,outcomes:[]},baseValue:5,
  family:'move',goal:{id:'goal:A:1:2:3:held:carrier',kind:'stabilize-possession',target:'carrier'}}],
  ordinaryLines:Array.from({length:6},(_,i)=>({input:move('ordinary-'+i),ex:{ok:true,outcomes:[]},baseValue:100-i}))});
 assert.equal(f.pool.length,8);assert.deepEqual(f.pool.slice(0,4).map(x=>x.line),[f.champion,f.current,f.early,f.end]);
 const stable=f.pool.find(x=>x.line.input.playerId==='support');
 assert.equal(stable?.source,'stabilize-possession');assert.ok(!f.pool.some(x=>x.line===stable?.line&&x.source==='prevent-score'));
});

test('only the exact current stabilize goal id and carrier target receive that category',()=>{
 const valid={input:move('support'),ex:{ok:true,outcomes:[]},baseValue:1,
  goal:{id:'goal:A:1:2:3:held:carrier',kind:'stabilize-possession',target:'carrier'}};
 const unknown={input:move('unknown-goal'),ex:{ok:true,outcomes:[]},baseValue:100,
  goal:{id:'invented-goal',kind:'stabilize-possession',target:'someone-else'}};
 const f=possessionPool({goalLines:[valid,unknown],ordinaryLines:[{input:move('ordinary'),ex:{ok:true,outcomes:[]},baseValue:0}]});
 assert.equal(f.pool.find(x=>x.line===valid)?.source,'stabilize-possession');
 assert.equal(f.pool.find(x=>x.line===unknown)?.source,'ordinary');
 assert.ok(f.pool.length<=8);
});

test('duplicate goal policies share one slot while distinct priced dependencies remain separate',()=>{
 const ledger=createCandidateLedger(93),goal={id:'goal:A:1:2:3:held:carrier',kind:'stabilize-possession',target:'carrier'};
 const plain={input:move('support'),ex:{ok:true,outcomes:[]},goal,baseValue:10};
 const duplicate={...plain,label:'same policy, repeated goal proposal'};
 const variantA={...plain,preparedBranches:new Map([['same-root-branch',{plan:{input:move('follow-a')}}]])};
 const variantB={...plain,preparedBranches:new Map([['same-root-branch',{plan:{input:move('follow-b')}}]])};
 const f=possessionPool({limit:10,goalLines:[plain,duplicate,variantA,variantB],ledger});
 assert.equal(f.pool.filter(x=>x.line.input.playerId==='support').length,3);
 assert.notEqual(ledger.candidate(variantA).candidateId,ledger.candidate(variantB).candidateId);
 const duplicateOrigin=f.origins[2],run=ledger.snapshot().pools[0];
 assert.ok(run.occurrences.find(x=>x.occurrenceId===duplicateOrigin.occurrenceId).visits.some(v=>v.status==='duplicate'));
});

test('without exact goal metadata the old eight-policy ordinary ordering is retained',()=>{
 const ordinaryLines=Array.from({length:7},(_,i)=>({input:move('ordinary-'+i),ex:{ok:true,outcomes:[]},baseValue:70-i}));
 const unknown={input:move('missing-goal'),ex:{ok:true,outcomes:[]},baseValue:10};
 const f=possessionPool({goalLines:[unknown],ordinaryLines});
 assert.equal(f.pool.length,8);assert.deepEqual(f.pool.slice(4).map(x=>x.line.input.playerId),
  ordinaryLines.slice(0,4).map(x=>x.input.playerId));
 assert.ok(f.pool.find(x=>x.line===unknown)?.source!=='stabilize-possession');
});

test('a full protected anchor prefix rejects a stabilization proposal with a slot-limit visit',()=>{
 const ledger=createCandidateLedger(94),goal={id:'goal:A:1:2:3:held:carrier',kind:'stabilize-possession',target:'carrier'};
 const stable={input:move('support'),ex:{ok:true,outcomes:[]},goal};
 const f=possessionPool({limit:4,goalLines:[stable],ledger});
 assert.equal(f.pool.length,4);assert.ok(!f.pool.some(x=>x.line===stable));
 const origin=f.origins[1],row=ledger.snapshot().pools[0].occurrences.find(x=>x.occurrenceId===origin.occurrenceId);
 assert.ok(row.visits.some(v=>v.category==='stabilize-possession'&&v.status==='slot-limit'));
 assert.ok(f.pool.omitted.some(x=>x.input.playerId==='support'&&x.reason==='common-pool-slot-limit'));
});

test('formal and shadow rows share request policy IDs while keeping separate pool runs',async()=>{
 const f=graph(),ledger=createCandidateLedger(42),current=f.line('current'),later=f.line('later'),extras=[later];
 const origin=ledger.occurrence(later,{source:'relay',role:'policyTrees',index:0}),snapshot={mode:'normal',selected:current,lines:[current]};
 const formal=await compareCommonTurnPool(f.o,snapshot,current,extras,f.services,f.inspect,Date.now()+100,{ledger,extraOrigins:[origin]});
 const shadow=await auditCommonBoundary(f.o,snapshot,current,f.services,f.inspect,Date.now()+10000,extras,{ledger,extraOrigins:[origin]});
 assert.equal(formal.rows.length,2);assert.equal(shadow.pool.length,2);
 for(const row of formal.rows){const peer=shadow.pool.find(p=>p.input.playerId===row.input.playerId);assert.equal(row.candidateId,peer.candidateId);assert.equal(row.inputId,peer.inputId);}
 assert.notEqual(formal.poolRunId,shadow.poolRunId);assert.deepEqual(ledger.snapshot().pools.map(p=>p.run),['formal','shadow']);
 assert.equal(ledger.snapshot().occurrences.find(r=>r.occurrenceId===origin.occurrenceId).source,'relay');
});
