import test from 'node:test';
import assert from 'node:assert/strict';
import {compareCarrierReplies,contactRestBounds} from '../src/carrier-replies.mjs';
import {guardLiveExplore} from '../src/services.mjs';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const costs={CFG:{carrierDown:110,opponentScore:240}};
function graph({adaptiveOwn=false,adaptiveMarker=false}={}){
 const player=(id,team,x,y)=>({id,team,location:'pitch',pos:{x,y},stance:'standing',ma:7,tackleZone:true});
 const observation={team:'A',active:'B',pitch:{width:20,height:11},ball:{kind:'held',playerId:'carrier'},players:[player('carrier','A',7,7),player('guard','A',8,7),player('marker','B',10,7),player('hit1','B',9,4),player('hit2','B',10,4)]};
 const state=(key,p=1,lost=false)=>({key,p,active:'B',turnover:false,observation:{...structuredClone(observation),ball:lost?{kind:'ground',pos:{x:7,y:7}}:observation.ball}});
 const move={kind:'playerAction',playerId:'marker',action:'move',path:[{kind:'step',to:{x:9,y:7}}]};
 const attack=id=>({kind:'playerAction',playerId:id,action:'blitz',path:[],blitzTarget:'carrier'});
 const response=(from,outcomes,rest=0)=>({ok:true,position:{key:from},activeTeam:'B',perspective:'A',outcomeIdentity:'complete-state-v1',decisionPolicy:{mode:'builtin',own:'builtin',opponent:'builtin'},outcomes,rest:{p:rest},unresolvedMass:rest});
 const page=(q,candidates,extra={})=>({ok:true,position:{key:q.from},offset:q.offset??0,total:(q.offset??0)+candidates.length,returned:candidates.length,limit:16,nextOffset:null,hasMore:false,complete:true,candidates,...extra});
 const calls=[];
 const services={async candidates(q){calls.push(['candidates',q]);return page(q,q.families.includes('blitz')?[{input:attack('hit1')},{input:attack('hit2')}]:q.families[0]==='move'?[{input:move}]:[]);},
  async validate(i,q){calls.push(['validate',i,q]);assert.equal(q.team,'B');assert.ok(q.from);return {ok:true,position:q.from,legal:true};},
  async explore(i,q){calls.push(['explore',i,q]);
   assert.equal(q.team,'B');assert.equal(q.perspective,'A');assert.ok(q.from);
   if(i.action==='move')return response(q.from,adaptiveMarker?[state(q.from+':left',.5),state(q.from+':right',.5)]:[state(q.from+':marked')]);
   const marked=q.from.includes(':marked'),left=q.from.includes('left'),right=q.from.includes('right');
   const loss=adaptiveOwn||adaptiveMarker?(left&&i.playerId==='hit1'||right&&i.playerId==='hit2'):marked;
   return response(q.from,[state(q.from+':hit',1,!!loss)]);
  }};
 const endpoints=adaptiveOwn?[state('left',.5),state('right',.5)]:[state('root-end')];
 return {page,o:{...observation,team:'A'},services,endpoints,state,response,move,attack,calls};
}
const run=f=>compareCarrierReplies(f.o,[{input:{kind:'endTurn'},endpoints:f.endpoints}],f.services,costs,Date.now()+10000);
test('real RC4 short-window Blitz shape stays unknown without validation or chance RPC',async t=>{
 let now=0;t.mock.method(Date,'now',()=>now);const f=graph();
 const o=structuredClone(f.o);o.team='B';o.active='A';o.ball.playerId='B8';
 o.players=o.players.filter(p=>p.id!=='guard').map(p=>({...p,team:p.team==='A'?'B':'A',id:p.id==='carrier'?'B8':p.id==='hit1'?'A7':p.id}));
 const input={kind:'playerAction',playerId:'A7',action:'blitz',path:[{kind:'step',to:{x:11,y:9}},{kind:'step',to:{x:12,y:10}},{kind:'step',to:{x:13,y:10}},{kind:'step',to:{x:14,y:9}},{kind:'step',to:{x:15,y:8}},{kind:'step',to:{x:16,y:7}}],blitzTarget:'B8'};
 let validations=0,explores=0;
 const services={async candidates(q){now=3887;assert.equal(q.team,'A');return f.page(q,[{input}]);},async validate(){validations++;},async explore(){explores++;}};
 const r=await compareCarrierReplies(o,[{input:{kind:'endTurn'},endpoints:[{p:1,key:'230.1461',active:'A',observation:o}]}],services,costs,10000);
 assert.equal(validations,0);assert.equal(explores,0);assert.equal(r.terminalKeys.requests,0);
 near(r.policies[0].unknown,1);near(r.policies[0].lossLower,0);near(r.policies[0].lossUpper,1);near(r.policies[0].harmUpper,240);assert.equal(r.selected,null);
 const issue=r.discoveryIssues.find(x=>x.reason==='reply-complex-enumeration-budget-unavailable');
 assert.equal(issue.examples[0].from,'230.1461');assert.equal(issue.examples[0].remainingMs,113);assert.equal(issue.examples[0].stage,'before-validation');
});
test('contact validation consuming its local slot prevents a shortened Block or Blitz request',async t=>{
 let now=0;t.mock.method(Date,'now',()=>now);
 for(const action of ['block','blitz']){
  now=0;const f=graph();f.endpoints[0].observation.players=f.endpoints[0].observation.players.filter(p=>p.id!=='guard');
  const input={kind:'playerAction',playerId:'hit1',action,path:[],[action==='block'?'blockTarget':'blitzTarget']:'carrier'};
  let validations=0,explores=0;
  f.services.candidates=async q=>f.page(q,[{input}]);
  f.services.validate=async(i,q)=>{validations++;now=3000;return {ok:true,position:q.from,legal:true};};
  f.services.explore=async()=>{explores++;};
  const r=await run(f);assert.equal(validations,1);assert.equal(explores,0);near(r.policies[0].unknown,1);assert.equal(r.selected,null);
  assert.equal(r.discoveryIssues.find(x=>x.reason==='reply-complex-enumeration-budget-unavailable').examples[0].stage,'after-validation');
 }
});
test('full local slot preserves original chance parameters and guard strips its internal deadline',async t=>{
 t.mock.method(Date,'now',()=>0);const f=graph();f.endpoints[0].observation.players=f.endpoints[0].observation.players.filter(p=>p.id!=='guard');
 f.services.candidates=async q=>f.page(q,[{input:f.attack('hit1')}]);
 const explore=f.services.explore,requests=[];
 f.services.explore=async(i,q)=>{requests.push(q);return explore(i,q);};
 const guarded=guardLiveExplore(f.services,'A',f.o.players,{deadline:10000});f.services=guarded.services;
 const r=await run(f);assert.equal(requests.length,1);
 const q=requests[0];assert.equal(q.maxMs,1200);assert.equal(q.maxLeaves,512);assert.equal(q.maxOutcomes,128);assert.equal(q.maxKeep,256);assert.equal(q.threshold,.000001);
 assert.equal(q.from,'root-end');assert.equal(q.team,'B');assert.equal(q.perspective,'A');assert.equal(q.decisions,'builtin');assert.equal(q.observations,true);assert.equal(q.noKeys,true);assert.equal(Object.hasOwn(q,'coachEnumerationDeadline'),false);
 near(r.policies[0].unknown,0);assert.equal(guarded.snapshot().complexBudgetRefusals,0);
});
test('guard validation spending the final slot preserves unknown across the carrier boundary',async t=>{
 let now=0;t.mock.method(Date,'now',()=>now);const f=graph();f.endpoints[0].observation.players=f.endpoints[0].observation.players.filter(p=>p.id!=='guard');
 f.services.candidates=async q=>f.page(q,[{input:f.attack('hit1')}]);let validations=0,explores=0;
 f.services.validate=async(i,q)=>{validations++;if(validations===2)now=3000;return {ok:true,position:q.from,legal:true};};
 f.services.explore=async()=>{explores++;};const guard=guardLiveExplore(f.services,'A',f.o.players,{deadline:10000});f.services=guard.services;
 const r=await run(f);assert.equal(validations,2);assert.equal(explores,0);near(r.policies[0].unknown,1);near(r.policies[0].harmUpper,240);assert.equal(r.selected,null);
 assert.equal(guard.snapshot().complexBudgetRefusals,1);assert.equal(r.discoveryIssues.find(x=>x.reason==='reply-complex-enumeration-budget-unavailable').examples[0].stage,'service-admission');
});
test('one millisecond after contact admission refuses instead of shrinking its original 1200ms request',async t=>{
 let now=0,afterValidation=false,reads=0;t.mock.method(Date,'now',()=>afterValidation?(reads++===0?2760:2761):now);
 const f=graph();f.endpoints[0].observation.players=f.endpoints[0].observation.players.filter(p=>p.id!=='guard');
 f.services.candidates=async q=>f.page(q,[{input:f.attack('hit1')}]);let validations=0,explores=0;
 f.services.validate=async(i,q)=>{validations++;if(validations===1)afterValidation=true;return {ok:true,position:q.from,legal:true};};
 f.services.explore=async()=>{explores++;};const guard=guardLiveExplore(f.services,'A',f.o.players,{deadline:10000});f.services=guard.services;
 const r=await run(f);assert.equal(explores,0);assert.equal(validations,1);assert.equal(guard.snapshot().complexBudgetRefusals,1);near(r.policies[0].unknown,1);assert.equal(r.selected,null);
});
test('candidate position uses the real host object contract; string position is rejected',async()=>{
 const f=graph(),positive=await run(f);near(positive.policies[0].lossLower,1);assert.equal(positive.discoveryIncomplete,false);
 const query=f.services.candidates;f.services.candidates=async q=>{const r=await query(q);r.position=q.from;return r;};
 const negative=await run(f);near(negative.policies[0].lossLower,0);near(negative.policies[0].lossUpper,1);assert.equal(negative.discoveryIncomplete,true);
});
test('marking the real guard restores loss that direct-only contact misses',async()=>{
 const f=graph(),r=await run(f),v=r.policies[0];near(v.lossLower,1);near(v.lossUpper,1);near(v.harmLower,110);near(v.opponentTDLower,0);assert.equal(r.selected,null);
 assert.ok(r.domain.some(d=>d.preparation?.action==='move'&&d.contact?.action==='blitz'));
 assert.ok(f.calls.some(c=>c[0]==='explore'&&c[1].action==='blitz'&&c[2].from==='root-end:marked'));
});
test('observed own outcomes choose different contacts; mutually exclusive replies do not add',async()=>{
 const r=await run(graph({adaptiveOwn:true}));near(r.policies[0].lossLower,1);near(r.policies[0].harmLower,110);assert.ok(r.policies[0].lossUpper<=1);
});
test('contact choice adapts at each random marker child before weighting',async()=>{
 const r=await run(graph({adaptiveMarker:true}));near(r.policies[0].lossLower,1);near(r.policies[0].harmLower,110);
});
test('clearance Block chance children also choose their own later carrier Blitz',async()=>{
 const f=graph({adaptiveMarker:true}),query=f.services.candidates,explore=f.services.explore;
 const clear={kind:'playerAction',playerId:'marker',action:'block',path:[],blockTarget:'guard'};
 f.services.candidates=async q=>q.families.length===1&&q.families[0]==='block'?f.page(q,[{input:clear}]):q.families[0]==='move'?f.page(q,[]):query(q);
 f.services.explore=async(i,q)=>i.action==='block'?f.response(q.from,[f.state(q.from+':left',.5),f.state(q.from+':right',.5)]):explore(i,q);
 const r=await run(f);near(r.policies[0].lossLower,1);near(r.policies[0].harmLower,110);assert.ok(r.domain.some(d=>d.preparation?.action==='block'&&d.contact?.action==='blitz'));
});
test('post-preparation contact follows the actual child holder, not the old carrier ID',async()=>{
 const f=graph(),query=f.services.candidates;
 f.services.candidates=async q=>{const r=await query(q);if(q.families.includes('blitz')&&q.from.endsWith(':changed')){r.candidates=[{input:{...f.attack('hit1'),blitzTarget:'guard'}}];r.returned=1;r.total=(q.offset??0)+1;}return r;};
 f.services.explore=async(i,q)=>{
  f.calls.push(['explore',i,q]);
  if(i.action==='move'){const b=f.state(q.from+':changed');b.observation.ball={kind:'held',playerId:'guard'};return f.response(q.from,[b]);}
  return f.response(q.from,[f.state(q.from+':hit',1,i.blitzTarget==='guard')]);
 };
 const r=await run(f);near(r.policies[0].lossLower,1);assert.ok(f.calls.some(c=>c[0]==='explore'&&c[2].from==='root-end:changed'&&c[1].blitzTarget==='guard'));
});
test('own turnover marker is not an absorbing enemy turnover and source is unchanged',async()=>{
 const f=graph();f.endpoints[0].turnover=true;const r=await run(f);near(r.policies[0].lossLower,1);assert.equal(f.endpoints[0].turnover,true);
});
test('missing source headers, child keys, transport or discovery never certify safety',async()=>{
 for(const kind of ['header','perspective','activeTeam','identity','policy','key','timeout','empty']){
  const f=graph(),ex=f.services.explore;
  if(kind==='timeout')f.services.explore=async()=>{throw Error('timeout');};
  else if(kind==='empty')f.services.candidates=async q=>f.page(q,[]);
  else f.services.explore=async(i,q)=>{const r=await ex(i,q);if(kind==='header')r.position.key='wrong-parent';else if(kind==='perspective')r.perspective='B';else if(kind==='activeTeam')r.activeTeam='A';else if(kind==='identity')r.outcomeIdentity='old';else if(kind==='policy')r.decisionPolicy.mode='solved';else for(const b of r.outcomes)b.key=null;return r;};
  const r=await run(f);near(r.policies[0].lossUpper,1);near(r.policies[0].harmUpper,240);assert.equal(r.selected,null);
 }
});
test('expired budget and truncated empty discovery stay unknown',async()=>{
 const f=graph(),r=await compareCarrierReplies(f.o,[{endpoints:f.endpoints}],f.services,costs,Date.now()-1);near(r.policies[0].unknown,1);near(r.policies[0].harmUpper,240);
 f.services.candidates=async q=>({ok:true,position:{key:q.from},candidates:[],hasMore:true});const t=await run(f);near(t.policies[0].unknown,1);near(t.policies[0].harmUpper,240);
});

test('truncated candidate domains identify the source and do not discard observed contact loss',async()=>{
 const f=graph(),base=f.services.candidates;f.services.candidates=async q=>({...await base(q),hasMore:true,truncated:[{reason:'page',omitted:2}]});
 const r=await run(f);near(r.policies[0].lossLower,1);near(r.policies[0].unknown,1);
 const issue=r.discoveryIssues.find(x=>x.reason==='reply-candidate-domain-truncated');
 assert.ok(issue.count>0);assert.equal(issue.examples[0].from,'root-end');assert.deepEqual(issue.examples[0].truncated,[{reason:'page',omitted:2}]);
 assert.ok(issue.examples.length<=2);
});

test('terminal exact aggregates price omitted score once while non-TD ball states remain unknown',async()=>{
 const f=graph();f.endpoints[0].observation.players=f.endpoints[0].observation.players.filter(p=>p.id!=='guard');
 f.services.candidates=async q=>f.page(q,q.families.includes('blitz')?[{input:f.attack('hit1')}]:[]);
 f.services.explore=async(i,q)=>({...f.response(q.from,[f.state('listed',.4,true)],.6),exact:true,enumerated:1,
  pTurnover:0,pTouchdown:.1,pOpponentTouchdown:.3,unresolvedMass:0});
 const r=await run(f),v=r.policies[0];
 near(v.lossLower,.7);near(v.lossUpper,.9);near(v.opponentTDLower,.3);near(v.opponentTDUpper,.3);
 near(v.harmLower,116);near(v.harmUpper,138);near(v.unknown,.2);
 assert.equal(r.discoveryIncomplete,false);assert.ok(r.terminalAggregate.used>0);
});

test('extrapolated aggregates bound every compatible omitted outcome without asserting calibrated probabilities',()=>{
 let checked=0;
 for(const u of [0,.05,.2,.6])for(const obsTO of [0,.1,.3])for(const unFraction of [0,.5,1])
 for(const enemy of [0,.05,.15])for(const own of [0,.05])for(const enemyUnknown of [0,.5,1]){
  const E=1-u,unTO=u*unFraction;if(obsTO>E)continue;
  const k=E-obsTO>1e-12?1+(u-unTO)/(E-obsTO):1;
  if(enemy*k>1||own*k>1||enemy+own>E)continue;
  const listed=Math.min(.1,E-enemy-own),rest=1-listed;
  const e={ok:true,position:{key:'s'},activeTeam:'B',perspective:'A',outcomeIdentity:'complete-state-v1',
   decisionPolicy:{mode:'builtin',own:'builtin',opponent:'builtin'},exact:u<1e-9,enumerated:E,unresolvedMass:u,
   pTurnover:obsTO+unTO,pTouchdown:own*k,pOpponentTouchdown:enemy*k,rest:{p:rest},outcomes:[{p:listed}]};
  const td=enemy+u*enemyUnknown,our=own+u*(1-enemyUnknown);
  for(const [down,score] of [[110,240],[300,100]]){
   const b=contactRestBounds(e,'A','s',down,score);assert.ok(b);
   for(const lost of [0,rest-td-our]){
    const loss=td+lost,harm=td*score+lost*down;
    assert.ok(loss>=b.lossLower-1e-8&&loss<=b.lossUpper+1e-8);
    assert.ok(td>=b.opponentTDLower-1e-8&&td<=b.opponentTDUpper+1e-8);
    assert.ok(harm>=b.harmLower-1e-8&&harm<=b.harmUpper+1e-8);
   }
   checked++;
  }
 }
 assert.ok(checked>500);
});

test('foreign units, non-unit enumeration, missing metrics and inconsistent score aggregates reject the shortcut',()=>{
 const base={ok:true,position:{key:'s'},activeTeam:'B',perspective:'A',outcomeIdentity:'complete-state-v1',
  decisionPolicy:{mode:'builtin',own:'builtin',opponent:'builtin'},exact:true,enumerated:1,unresolvedMass:0,
  pTurnover:0,pTouchdown:0,pOpponentTouchdown:0,rest:{p:.5},outcomes:[{p:.5}]};
 assert.ok(contactRestBounds(base,'A','s',110,240));
 for(const mutate of [e=>e.perspective='B',e=>e.activeTeam='A',e=>e.position.key='foreign',e=>delete e.enumerated,
  e=>e.enumerated=.7,e=>delete e.pOpponentTouchdown,e=>e.exact=false,e=>e.outcomes[0].touchdown='B']){
  const e=structuredClone(base);mutate(e);assert.equal(contactRestBounds(e,'A','s',110,240),null);
 }
});

test('an observed last-contact state does not need a successor key; a preparation state still does',async()=>{
 const f=graph();f.endpoints[0].observation.players=f.endpoints[0].observation.players.filter(p=>p.id!=='guard');
 f.services.candidates=async q=>f.page(q,[{input:f.attack('hit1')}]);
 f.services.explore=async(i,q)=>f.response(q.from,[{...f.state('hit',1,true),key:null}]);
 const r=await run(f);near(r.policies[0].lossLower,1);near(r.policies[0].harmLower,110);near(r.policies[0].unknown,0);
 const p=graph();p.services.explore=async(i,q)=>p.response(q.from,[{...p.state('child'),key:null}]);
 const unknown=await run(p);near(unknown.policies[0].unknown,1);
});
test('last contact omits handles while preparation preserves source keys, observations and bounds',async()=>{
 const f=graph(),explore=f.services.explore;const requested=[];
 f.services.explore=async(i,q)=>{
  requested.push({input:i,options:q});assert.equal(q.maxKeep,256);assert.equal(q.observations,true);
  const r=await explore(i,q);
  if(q.noKeys)for(const b of r.outcomes)b.key=null;
  return r;
 };
 const r=await run(f);near(r.policies[0].lossLower,1);near(r.policies[0].lossUpper,1);near(r.policies[0].unknown,0);
 assert.ok(requested.some(x=>x.input.action==='move'&&x.options.noKeys===undefined));
 assert.ok(requested.some(x=>x.input.action==='blitz'&&x.options.noKeys===true&&x.options.from.endsWith(':marked')));
 assert.equal(r.terminalKeys.requests,requested.filter(x=>x.options.noKeys).length);
 assert.equal(r.terminalKeys.retainedKeys,0);assert.ok(r.terminalKeys.keylessObservedOutcomes>0);
});
test('ignoring key omission is measured, never mistaken for saved positions or relaxed evidence',async()=>{
 const r=await run(graph());near(r.policies[0].lossLower,1);near(r.policies[0].unknown,0);
 assert.ok(r.terminalKeys.retainedKeys>0);assert.equal(r.terminalKeys.keylessObservedOutcomes,0);
});
test('a keyless preparation cannot be reused as an executable source; terminal missing observations remain unknown',async()=>{
 for(const missing of ['preparation-key','terminal-observation']){
  const f=graph(),explore=f.services.explore;
  f.services.explore=async(i,q)=>{
   const r=await explore(i,q);
   for(const b of r.outcomes){if(q.noKeys)b.key=null;if(missing==='terminal-observation'&&q.noKeys)delete b.observation;if(missing==='preparation-key'&&i.action==='move')b.key=null;}
   return r;
  };
  const r=await run(f);near(r.policies[0].unknown,1);near(r.policies[0].harmUpper,240);
 }
});

test('final shared widening cannot restore a floating probability above one',async()=>{
 const f=graph();f.endpoints=Array.from({length:20},(_,i)=>f.state('source'+i,.05));
 const r=await compareCarrierReplies(f.o,[{endpoints:f.endpoints}],f.services,costs,Date.now()-1);
 assert.equal(r.policies[0].unknown,1);assert.equal(r.policies[0].lossUpper,1);
 assert.equal(r.policies[0].harmUpper,240);
 for(const [k,v] of Object.entries(r.policies[0]))if(typeof v==='number')assert.ok(v>=0&&v<=(k.startsWith('harm')?240:1),k);
});
test('later source-bound root contact pages enter the same comparison without page-size inflation',async()=>{
 const f=graph();f.endpoints[0].observation.players=f.endpoints[0].observation.players.filter(p=>p.id!=='guard');
 f.services.candidates=async q=>{
  f.calls.push(['candidates',q]);assert.equal(q.limit,16);
  return f.page(q,[{input:f.attack(q.offset===0?'hit1':'hit2')}],{total:2,hasMore:q.offset===0,nextOffset:q.offset===0?1:null,truncated:q.offset===0?[{reason:'page'}]:[]});
 };
 f.services.explore=async(i,q)=>f.response(q.from,[f.state('hit',1,i.playerId==='hit2')]);
 const r=await run(f);near(r.policies[0].lossLower,1);near(r.policies[0].unknown,0);
 assert.equal(r.discoveryIncomplete,false);assert.equal(r.contactPages.completed,1);assert.equal(r.contactPages.pages,2);
 assert.ok(r.domain.some(d=>d.contact?.playerId==='hit2'));assert.deepEqual(f.calls.filter(c=>c[0]==='candidates').map(c=>c[1].offset),[0,1]);
});
test('foreign page, changing total, non-page generation cuts and stalled cursor retain unknown and known harm',async()=>{
 for(const failure of ['foreign','total','cut','stall']){
  const f=graph();f.endpoints[0].observation.players=f.endpoints[0].observation.players.filter(p=>p.id!=='guard');
  f.services.candidates=async q=>{
   const r=f.page(q,[{input:f.attack(q.offset===0?'hit1':'hit2')}],{total:2,hasMore:q.offset===0,nextOffset:q.offset===0?1:null,truncated:q.offset===0?[{reason:'page'}]:[]});
   if(failure==='stall'&&q.offset===0)r.nextOffset=0;
   if(q.offset===1){if(failure==='foreign')r.position.key='other';if(failure==='total')r.total=3;if(failure==='cut')r.truncated=[{reason:'family-limit'}];}
   return r;
  };
  f.services.explore=async(i,q)=>f.response(q.from,[f.state('observed-loss',1,true)]);
  const r=await run(f);near(r.policies[0].lossLower,1);near(r.policies[0].unknown,1);
  assert.equal(r.discoveryIncomplete,true);assert.equal(r.contactPages.completed,0);assert.ok(r.calls<10);
 }
});
test('page collection respects the existing shared 64 ceiling and does not pretend two retained contacts are exhaustive',async()=>{
 const f=graph();f.endpoints[0].observation.players=f.endpoints[0].observation.players.filter(p=>p.id!=='guard');
 f.services.candidates=async q=>{
  f.calls.push(['candidates',q]);return f.page(q,Array.from({length:16},(_,i)=>({input:{...f.attack('hit1'),path:[{kind:'step',to:{x:q.offset+i,y:0}}]}})),{total:65,hasMore:true,nextOffset:q.offset+16,truncated:[{reason:'page'}]});
 };
 const r=await run(f);assert.equal(r.contactPages.pages,4);assert.equal(r.contactPages.completed,0);assert.equal(r.contactPages.uniqueInputs,64);
 assert.equal(r.domain.filter(d=>d.contact).length,2);near(r.policies[0].unknown,1);
 assert.ok(r.discoveryIssues.some(x=>x.reason==='reply-contact-page-domain-limit'));
 assert.ok(r.discoveryIssues.some(x=>x.reason==='local-contact-limit'&&x.examples[0].proposed===64));
 assert.deepEqual(f.calls.filter(c=>c[0]==='candidates').map(c=>c[1].offset),[0,16,32,48]);
});
test('root page completion and adaptive preparation-child truncation are separate evidence',async()=>{
 const f=graph(),base=f.services.candidates;
 f.services.candidates=async q=>{const r=await base(q);if(q.from.includes(':marked')&&q.families.includes('blitz')){r.hasMore=true;r.total=3;r.nextOffset=2;r.truncated=[{reason:'page'}];}return r;};
 const r=await run(f);assert.equal(r.contactPages.completed,1);near(r.policies[0].unknown,1);
 assert.ok(r.discoveryIssues.some(x=>x.reason==='reply-candidate-domain-truncated'&&x.examples.some(e=>e.from==='root-end:marked')));
 assert.equal(f.calls.filter(c=>c[0]==='candidates'&&c[1].from.includes(':marked')).length,1);
});
test('a partially returned earlier page cannot inflate the final collection above64',async()=>{
 const f=graph();f.endpoints[0].observation.players=f.endpoints[0].observation.players.filter(p=>p.id!=='guard');
 f.services.candidates=async q=>{
  f.calls.push(['candidates',q]);const count=q.offset===0?14:q.limit;
  return f.page(q,Array.from({length:count},(_,i)=>({input:{...f.attack('hit1'),path:[{kind:'step',to:{x:q.offset+i,y:0}}]}})),{total:65,hasMore:true,nextOffset:q.offset+count,truncated:[{reason:'page'}]});
 };
 const r=await run(f);assert.equal(r.contactPages.uniqueInputs,64);
 assert.deepEqual(f.calls.filter(c=>c[0]==='candidates').map(c=>[c[1].offset,c[1].limit]),[[0,16],[14,16],[30,16],[46,16],[62,2]]);
 near(r.policies[0].unknown,1);assert.equal(r.contactPages.completed,0);
});
test('expired page budget stops at the observed first page and preserves symmetric unknown',async t=>{
 let now=0;t.mock.method(Date,'now',()=>now);const f=graph();f.endpoints[0].observation.players=f.endpoints[0].observation.players.filter(p=>p.id!=='guard');
 f.services.candidates=async q=>{now=3990;return f.page(q,[{input:f.attack('hit1')}],{total:2,hasMore:true,nextOffset:1,truncated:[{reason:'page'}]});};
 const r=await compareCarrierReplies(f.o,[{endpoints:f.endpoints},{endpoints:f.endpoints}],f.services,costs,10000);
 assert.equal(r.contactPages.pages,1);assert.ok(r.discoveryIssues.some(x=>x.reason==='reply-contact-page-budget-exhausted'));
 for(const p of r.policies)near(p.unknown,1);
});
test('illegal union inputs are skipped and cannot manufacture a safe reply',async()=>{
 const f=graph();f.services.validate=async(i,q)=>({ok:true,position:q.from,legal:false});
 const r=await run(f);near(r.policies[0].lossLower,0);near(r.policies[0].lossUpper,1);near(r.policies[0].unknown,1);assert.equal(f.calls.some(c=>c[0]==='explore'),false);
});
test('enemy turnover absorbs preparation; enemy TD pays score once, not additional loss',async()=>{
 for(const td of [false,true]){
  const f=graph();f.services.explore=async(i,q)=>f.response(q.from,[td?{p:1,turnover:true,active:'A',touchdown:'B'}:{...f.state('enemy-failure'),active:'A',turnover:true,observation:{...f.state('x').observation,active:'A'}}]);
  const r=await run(f);near(r.policies[0].lossLower,td?1:0);near(r.policies[0].opponentTDLower,td?1:0);near(r.policies[0].harmLower,td?240:0);
 }
});
test('raw rest is weighted once and failure mass is not discarded',async()=>{
 const f=graph();f.services.explore=async(i,q)=>i.action==='move'?f.response(q.from,[f.state(q.from+':marked',.5),{...f.state('fail',.25),turnover:true,active:'A',observation:{...f.state('x').observation,active:'A'}}],.25):f.response(q.from,[f.state('lost',1,q.from.includes(':marked'))]);
 const r=await run(f);near(r.policies[0].lossLower,.5);near(r.policies[0].lossUpper,.75);near(r.policies[0].harmLower,55);near(r.policies[0].harmUpper,115);near(r.policies[0].unknown,.25);
});
test('non-unit or incomplete own endpoint mass is rejected',async()=>{
 const f=graph();f.endpoints[0].p=.9;const r=await run(f);assert.equal(r.reason,'own-phase-endpoints-incomplete');assert.deepEqual(r.policies,[]);
});
test('own TD endpoints absorb without an opponent-active observation or session key',async()=>{
 const f=graph();f.endpoints=[{p:1,touchdown:'A'}];
 const r=await compareCarrierReplies(f.o,[{endpoints:f.endpoints}],f.services,costs,Date.now()-1);
 near(r.policies[0].harmLower,0);near(r.policies[0].harmUpper,0);near(r.policies[0].unknown,0);assert.equal(r.calls,0);
 const mixed=await compareCarrierReplies(f.o,[{input:{kind:'endTurn'},endpoints:[{p:.4,touchdown:'A'},f.state('held',.6)]},{endpoints:[{p:1,touchdown:'A'}]}],f.services,costs,Date.now()-1);
 near(mixed.policies[0].lossUpper,.6);near(mixed.policies[0].harmUpper,144);near(mixed.policies[0].unknown,.6);near(mixed.policies[1].harmUpper,0);
});
test('a non-TD endpoint already lacking our ball prices loss without requiring carrier contacts',async()=>{
 const f=graph();f.endpoints=[f.state('ground',1,true)];
 const r=await compareCarrierReplies(f.o,[{endpoints:f.endpoints}],f.services,costs,Date.now()-1);
 near(r.policies[0].lossLower,1);near(r.policies[0].lossUpper,1);near(r.policies[0].harmUpper,110);near(r.policies[0].opponentTDUpper,0);near(r.policies[0].unknown,0);assert.equal(r.calls,0);assert.equal(r.discoveryIncomplete,false);
});
test('missing explore headers, non-unit mass and undefined nonterminal active remain unknown',async()=>{
 for(const kind of ['rest','unresolvedMass','decisionPolicy','position','mass','active']){
  const f=graph(),explore=f.services.explore;
  f.services.explore=async(i,q)=>{const r=await explore(i,q);if(kind==='mass')r.rest.p=.2;else if(kind==='active')for(const b of r.outcomes)delete b.active;else delete r[kind];return r;};
  const r=await run(f);near(r.policies[0].lossUpper,1);near(r.policies[0].harmUpper,240);near(r.policies[0].unknown,1);
 }
});
test('budget interruption within choose or assess widens all compared policies',async t=>{
 let now=0;t.mock.method(Date,'now',()=>now);
 for(const stopAt of ['root-end','root-end:marked']){
  now=0;const f=graph(),explore=f.services.explore;
  f.services.explore=async(i,q)=>{const r=await explore(i,q);if(i.action==='blitz'&&q.from===stopAt)now=3990;return r;};
  const r=await compareCarrierReplies(f.o,[{input:{kind:'endTurn'},endpoints:f.endpoints},{input:f.move,endpoints:f.endpoints}],f.services,costs,10000);
  assert.equal(r.discoveryIncomplete,true);for(const p of r.policies){near(p.lossUpper,1);near(p.harmUpper,240);near(p.unknown,1);}
 }
});
test('direct breadth reaches each policy before adaptive discovery and is invariant to incumbent array position',async()=>{
 const observed=[];
 for(const reverse of [false,true]){
  const f=graph({adaptiveOwn:true});const policies=[{input:{kind:'endTurn'},endpoints:[f.state('left-primary')]},{input:f.move,endpoints:[f.state('right-primary')]}];
  const r=await compareCarrierReplies(f.o,reverse?[...policies].reverse():policies,f.services,costs,Date.now()+10000);
  for(const p of r.policies)near(p.lossLower,1);
  for(const p of r.budget.policies){assert.equal(p.warmAttempts,1);near(p.warmAttemptedMass,1);assert.equal(p.newTerminalQueries,2);assert.equal(p.newListedTerminalOutcomes,2);}
  const first=f.calls.filter(c=>c[0]==='explore').slice(0,4).map(c=>[c[2].from,c[1].playerId]);
  assert.deepEqual(new Set(first.map(x=>x[0])),new Set(['left-primary','right-primary']));observed.push(first);
 }
 assert.deepEqual(observed[0],observed[1]);
});
test('only each policy major endpoint warms first; remaining chance sources stay in the full comparison',async()=>{
 const f=graph({adaptiveOwn:true}),policies=[{input:{kind:'endTurn'},endpoints:[f.state('left-minor',.2),f.state('left-major',.8)]},{input:f.move,endpoints:[f.state('right-primary')]}];
 const r=await compareCarrierReplies(f.o,policies,f.services,costs,Date.now()+10000);
 const first=f.calls.filter(c=>c[0]==='explore').slice(0,4).map(c=>c[2].from);
 assert.deepEqual(new Set(first),new Set(['left-major','right-primary']));
 for(const p of r.policies){near(p.lossLower,1);near(p.harmLower,110);}
 near(r.budget.policies[0].warmAttemptedMass,.8);near(r.budget.policies[1].warmAttemptedMass,1);
 assert.equal(r.budget.policies[0].aggregatedEndpoints,2);near(r.budget.policies[0].aggregatedMass,1);
});
test('known harm from every warmed policy survives later discovery exhaustion without certifying safety',async t=>{
 let now=0,contacts=0;t.mock.method(Date,'now',()=>now);const f=graph({adaptiveOwn:true}),explore=f.services.explore;
 f.services.explore=async(i,q)=>{const r=await explore(i,q);if(i.action==='blitz'&&++contacts===4)now=3990;return r;};
 const policies=[{input:{kind:'endTurn'},endpoints:[f.state('left-primary')]},{input:f.move,endpoints:[f.state('right-primary')]}];
 const r=await compareCarrierReplies(f.o,policies,f.services,costs,10000);
 assert.equal(r.discoveryIncomplete,true);for(const p of r.policies){near(p.lossLower,1);near(p.harmLower,110);near(p.unknown,1);}
 assert.equal(r.budget.warmupMs,3990);assert.equal(r.budget.allottedMs,4000);
});

test('actual preparation-child harm is priced before remaining own chance roots consume discovery',async t=>{
 let now=0;t.mock.method(Date,'now',()=>now);const f=graph(),query=f.services.candidates;
 f.endpoints=[f.state('major',.6),f.state('late-minor',.4)];
 f.services.candidates=async q=>{const r=await query(q);if(q.from==='late-minor')now=3990;return r;};
 const r=await run(f),v=r.policies[0];
 near(v.lossLower,.6);near(v.harmLower,66);near(v.unknown,1);near(v.harmUpper,240);
 assert.ok(f.calls.some(c=>c[0]==='explore'&&c[1].action==='blitz'&&c[2].from==='major:marked'));
 assert.equal(r.preparationWork.started,1);assert.equal(r.preparationWork.childAttempts,1);
 assert.ok(r.preparationWork.newListedTerminalOutcomes>0);
});

test('partial preparation children interleave across source policies; unvisited chance stays unknown',async t=>{
 let now=0;t.mock.method(Date,'now',()=>now);
 async function invoke(reverse){
  now=0;const f=graph(),explore=f.services.explore;let childContacts=0;
  f.services.explore=async(i,q)=>{
   if(i.action==='move'){f.calls.push(['explore',i,q]);return f.response(q.from,[f.state(q.from+':marked-high',.8),f.state(q.from+':marked-low',.2)]);}
   const r=await explore(i,q);
   if(q.from.endsWith(':marked-high')&&++childContacts===4)now=3990;
   return r;
  };
  const policies=[{input:{kind:'endTurn'},endpoints:[f.state('left')]},{input:f.move,endpoints:[f.state('right')]}];
  const r=await compareCarrierReplies(f.o,reverse?policies.reverse():policies,f.services,costs,10000);
  for(const p of r.policies){near(p.lossLower,.8);near(p.harmLower,88);near(p.unknown,1);near(p.harmUpper,240);}
  assert.equal(r.preparationWork.childAttempts,2);
  for(const p of r.budget.policies){assert.equal(p.preparedJobs,1);assert.equal(p.preparedChildAttempts,1);assert.equal(p.preparedNewTerminalOutcomes,2);}
  assert.equal(f.calls.some(c=>c[0]==='explore'&&c[2].from.endsWith(':marked-low')),false);
  return f.calls.filter(c=>c[0]==='explore'&&c[2].from.endsWith(':marked-high')).map(c=>[c[2].from,c[1].playerId]);
 }
 assert.deepEqual(await invoke(false),await invoke(true));
});
