import test from 'node:test';import assert from 'node:assert/strict';
import {compareReceiverThreats} from '../src/receiver-defense.mjs';
import {endpointValuePoint} from '../src/endpoint-value.mjs';
const near=(a,b)=>assert.ok(Math.abs(a-b)<2e-8,`${a} differs from ${b}`);
function graph({failure=0,rest=0,keyless=false,wrongIdentity=false,adaptive=false}={}){
 const player=(id,x,y)=>({id,team:'B',location:'pitch',pos:{x,y},stance:'standing',activated:false,ma:8,skills:[]});
 const o={team:'A',active:'B',phase:'play',pitch:{width:11,height:9,endZone:{A:0,B:10}},ball:{kind:'held',playerId:'holder'},players:[player('holder',2,3),player('r1',3,3),player('r2',2,4)],activation:null};
 const ob=id=>({...structuredClone(o),ball:{kind:'held',playerId:id}});
 const state=(key,p=1,id='holder')=>({key,p,active:'B',turnover:false,observation:ob(id)});
 const head=from=>({ok:true,position:{key:from},activeTeam:'B',perspective:'A',outcomeIdentity:'complete-state-v1',decisionPolicy:{mode:'builtin',own:'builtin',opponent:'builtin'},unresolvedMass:0,rest:{p:0}});
 const route=id=>({kind:'playerAction',playerId:id,action:'move',path:[{kind:'step',to:{x:10,y:id==='r1'?3:4}}]});
 const calls=[];
 const services={async candidates(q){calls.push(['candidates',q]);return {ok:true,position:{key:q.from},candidates:q.families[0]==='move'&&q.players[0]!=='holder'?[{kind:'score',input:route(q.players[0])}]:[],hasMore:false};},
 async validate(input,q){calls.push(['validate',input,q]);assert.ok(q.from,'Every validation is bound to a real parent');return {ok:true,position:q.from,legal:input.action!=='pass'};},
 async explore(input,q){calls.push(['explore',input,q]);assert.ok(q.from,'Every action is bound to a real parent');
  if(input.action==='handoff'){
   const target=input.handoffTarget,outcomes=[state(keyless?null:q.from+':'+target,1-failure-rest,target)];
   if(failure)outcomes.push({p:failure,turnover:true,active:'A'});
   return {...head(q.from),outcomes,rest:{p:rest},unresolvedMass:rest};
  }
  assert.equal(input.action,'move');const p=adaptive?(q.from.startsWith('left')===(input.playerId==='r1')?1:0):input.playerId==='r1'?1:.5;
  return {...head(q.from),perspective:wrongIdentity?'B':'A',outcomes:[],rest:{p:1},unresolvedMass:0,enumerated:1,applied:true,leaves:1,exact:true,pOpponentTouchdown:p};
 }};
 const states=adaptive?[state('left',.5),state('right',.5)]:[state('root-end')];return {o,services,states,calls};
}
async function run(f){return compareReceiverThreats(f.o,[{input:{kind:'endTurn'},states:f.states}],f.services,Date.now()+10000);}
test('engine-offered moving Handoff and remote Pass enter the same finite receiver pool with their full declared inputs',async()=>{
 const f=graph();f.o.players.find(p=>p.id==='r1').pos.x=6;
 for(const s of f.states)s.observation.players.find(p=>p.id==='r1').pos.x=6;
 const moving={kind:'playerAction',playerId:'holder',action:'handoff',path:[3,4,5].map(x=>({kind:'step',to:{x,y:3}})),handoffTarget:'r1'};
 const remote={kind:'playerAction',playerId:'holder',action:'pass',path:[],passTarget:{x:6,y:3}};
 const query=f.services.candidates,validate=f.services.validate,explore=f.services.explore;
 f.services.candidates=async q=>['handoff','pass'].includes(q.families[0])?
  {ok:true,position:{key:q.from},hasMore:false,candidates:[{input:q.families[0]==='handoff'?moving:remote}]}:query(q);
 f.services.validate=async(i,q)=>i.action==='pass'?{ok:true,position:q.from,legal:true}:validate(i,q);
 f.services.explore=async(i,q)=>{
  if(i.action==='pass'){assert.equal(q.maxLeaves,64);assert.equal(q.maxMs,450);return explore({...i,action:'handoff',handoffTarget:'r1'},q);}
  return explore(i,q);
 };
 const r=await run(f);assert.ok(r.domain.some(d=>JSON.stringify(d.transfer)===JSON.stringify(moving)));
 assert.ok(r.domain.some(d=>JSON.stringify(d.transfer)===JSON.stringify(remote)));
 assert.ok(f.calls.some(c=>c[0]==='explore'&&JSON.stringify(c[1])===JSON.stringify(moving)&&c[2].from==='root-end'));
 assert.ok(r.transferDiscovery.retained>=2);near(r.policies[0].lower,1);
});
test('bounded partial remote Pass preserves real success mass and every unlisted outcome as an upper gap',async()=>{
 const f=graph();f.o.players.find(p=>p.id==='r1').pos.x=6;
 f.o.players.find(p=>p.id==='r2').activated=true;
 f.states[0].observation=structuredClone(f.o);
 const remote={kind:'playerAction',playerId:'holder',action:'pass',path:[],passTarget:{x:6,y:3}};
 const query=f.services.candidates,explore=f.services.explore;
 f.services.candidates=async q=>['handoff','pass'].includes(q.families[0])?
  {ok:true,position:{key:q.from},hasMore:false,candidates:q.families[0]==='pass'?[{input:remote}]:[]}:query(q);
 f.services.validate=async(i,q)=>({ok:true,position:q.from,legal:i.action!=='handoff'});
 f.services.explore=async(i,q)=>{
  if(i.action!=='pass')return explore(i,q);
  assert.equal(q.maxLeaves,64);assert.equal(q.maxMs,450);
  return {ok:true,position:{key:q.from},activeTeam:'B',perspective:'A',outcomeIdentity:'complete-state-v1',decisionPolicy:{mode:'builtin',own:'builtin',opponent:'builtin'},unresolvedMass:.4,rest:{p:.4},outcomes:[{key:q.from+':r1',p:.6,active:'B',turnover:false,observation:{...structuredClone(f.o),ball:{kind:'held',playerId:'r1'}}}]};
 };
 const r=await run(f);near(r.policies[0].lower,.6);near(r.policies[0].upper,1);
 assert.equal(r.transferWork.failedExplorations,0);
});
test('opponent End valuation retains observations without retaining future handles, and does not certify omitted opponent policies',async()=>{
 const f=graph(),explore=f.services.explore,root={team:'A',score:{A:1,B:0}},view={CFG:{touchdown:1500}};
 f.services.explore=async(i,q)=>{
  if(i.kind==='endTurn'||i.action==='move'){
   assert.equal(q.noKeys,true);assert.equal(q.observations,true);assert.equal(q.maxKeep,8);assert.equal(q.maxOutcomes,8);
   const scored=i.action==='move';
   return {ok:true,position:{key:q.from},activeTeam:'B',perspective:'A',outcomeIdentity:'complete-state-v1',decisionPolicy:{mode:'builtin',own:'builtin',opponent:'builtin'},unresolvedMass:0,rest:{p:0},enumerated:1,applied:true,leaves:1,exact:true,pOpponentTouchdown:Number(scored),outcomes:[{key:null,p:1,active:'A',turnover:!scored,touchdown:scored?'B':null,observation:{...structuredClone(f.o),active:'A',phase:'fullTime',score:{A:1,B:Number(scored)}}}]};
  }
  return explore(i,q);
 };
 const r=await compareReceiverThreats(f.o,[{input:{kind:'endTurn'},states:f.states}],f.services,Date.now()+10000,
  {valueEndState:b=>endpointValuePoint(b,root,view)});
 const a=r.endpointValueAudit;assert.equal(a.stopRecords[0].complete,true);assert.equal(a.stopRecords[0].value,1500);
 assert.ok(a.terminalActionRecords.some(x=>x.complete&&x.value===0));
 assert.equal(a.outsideDomainUnverified,true);assert.equal(a.executionCertified,false);
});
test('no-contact handoff to either receiver shares the domain and mutual alternatives take max',async()=>{
 const f=graph(),r=await run(f);assert.equal(r.reason,'common-finite-receiver-policy-bounds');
 assert.ok(r.domain.some(d=>d.contact===null&&d.transfer?.handoffTarget==='r2'));
 near(r.policies[0].lower,1);assert.equal(r.policies[0].upper,1);assert.equal(r.selected,null);
 assert.ok(f.calls.some(c=>c[0]==='explore'&&c[1].action==='move'&&c[2].from==='root-end:r2'));
});
test('transfer failure multiplies probability and rest remains an upper gap',async()=>{
 const known=await run(graph({failure:.25}));near(known.policies[0].lower,.75);assert.equal(known.policies[0].upper,.75);
 const unresolved=await run(graph({rest:.25}));near(unresolved.policies[0].lower,.75);assert.equal(unresolved.policies[0].upper,1);
});
test('missing child key or wrong summary perspective never creates a zero-threat certificate',async()=>{
 for(const options of [{keyless:true},{wrongIdentity:true}]){const r=await run(graph(options));assert.equal(r.policies[0].lower,0);assert.equal(r.policies[0].upper,1);assert.equal(r.selected,null);}
});
test('opponent may choose a different receiver at each observed own-policy outcome',async()=>{
 const r=await run(graph({adaptive:true}));near(r.policies[0].lower,1);assert.equal(r.policies[0].upper,1);
 assert.equal(r.policies[0].branches.length,2);for(const b of r.policies[0].branches)near(b.lower,1);
});
test('own turnover boundary remains an opponent scoring opportunity',async()=>{
 const f=graph({adaptive:true});f.states[0].turnover=true;
 const r=await run(f);near(r.policies[0].lower,1);assert.equal(r.policies[0].upper,1);
 assert.equal(f.states[0].turnover,true,'source own-failure evidence is not mutated');
});
test('missing candidate service cannot make an empty domain a zero-threat proof',async()=>{
 const f=graph();f.services.candidates=async()=>{throw Error('transport unavailable');};
 const r=await run(f);assert.equal(r.policies[0].upper,1);assert.ok(r.discoveryIncomplete);assert.ok(r.domain.some(d=>d.receiver==='r2'&&d.route===null));assert.equal(r.selected,null);
});
test('expired discovery budget keeps unknown rather than returning an empty safe domain',async()=>{
 const f=graph();const r=await compareReceiverThreats(f.o,[{states:f.states}],f.services,Date.now()-1);
 assert.equal(r.policies[0].upper,1);assert.ok(r.discoveryIncomplete);assert.equal(r.selected,null);
});
test('contact chain-push touchdown remains absorbing even without later receiver routes',async()=>{
 const f=graph(),contact={kind:'playerAction',playerId:'r1',action:'blitz',path:[],blitzTarget:'defender'},q=f.services.candidates,ex=f.services.explore;
 f.services.candidates=async opts=>opts.families[0]==='blitz'?{ok:true,position:{key:opts.from},candidates:[{input:contact}]}:q(opts);
 f.services.explore=async(i,o)=>i.action==='blitz'?{ok:true,position:{key:o.from},activeTeam:'B',perspective:'A',outcomeIdentity:'complete-state-v1',decisionPolicy:{mode:'builtin',own:'builtin',opponent:'builtin'},unresolvedMass:0,rest:{p:0},outcomes:[{p:1,active:'B',touchdown:'B',turnover:true}]}:ex(i,o);
 const r=await run(f);assert.equal(r.policies[0].lower,1);assert.equal(r.policies[0].upper,1);
});
test('receiver choice adapts after each observable contact chance outcome',async()=>{
 const f=graph({adaptive:true});f.states=[{...f.states[0],key:'root-end',p:1}];
 const contact={kind:'playerAction',playerId:'r1',action:'blitz',path:[],blitzTarget:'defender'},query=f.services.candidates,explore=f.services.explore;
 f.services.candidates=async opts=>opts.families[0]==='blitz'?{ok:true,position:{key:opts.from},candidates:[{input:contact}]}:query(opts);
 f.services.explore=async(i,o)=>{
  if(i.action==='blitz')return {ok:true,position:{key:o.from},activeTeam:'B',perspective:'A',outcomeIdentity:'complete-state-v1',decisionPolicy:{mode:'builtin',own:'builtin',opponent:'builtin'},unresolvedMass:0,rest:{p:0},outcomes:['left','right'].map(key=>({...structuredClone(f.states[0]),key,p:.5}))};
  const r=await explore(i,o);if(i.action==='move'&&o.from.startsWith('root-end'))r.pOpponentTouchdown=0;return r;
 };
 const r=await run(f);near(r.policies[0].lower,1);assert.equal(r.policies[0].upper,1);
 const direct=r.policies[0].rows.find(r=>r.contact===null);assert.equal(direct.lower,0);
});

import {reserveDefenseTerminals,captureDefenseTerminal} from '../src/defense.mjs';
async function closureFixture(){
 const f=graph(),o={...f.o,active:'A',turn:{A:5,B:5},turnsPerHalf:6};
 const r=await reserveDefenseTerminals(o,[],{}, {},Date.now()+10000);
 const e={ok:true,outcomeIdentity:'complete-state-v1',position:{key:'actual-child'},perspective:'A',activeTeam:'A',decisionPolicy:{mode:'builtin',own:'builtin',opponent:'builtin'},rest:{p:0},unresolvedMass:0,outcomes:[{...f.states[0],key:'closed-own'}]};
 return {o,r,e};
}
test('observed own closure retains the exact parent without issuing more engine work',async()=>{
 const {o,r,e}=await closureFixture();assert.ok(r.ownClosureEnabled);
 const input={kind:'endTurn'};await captureDefenseTerminal(r,o,input,{from:'actual-child'},e,{}, {},Date.now()+10000);
 assert.strictEqual(r.ownClosures.get(JSON.stringify(['actual-child','A',input])),e);
 assert.equal(r.ownClosures.size,1);assert.equal(r.attempted,false,'no old standing-wall scope is fabricated');
});
test('observed own closure rejects wrong source/team and unretained successor keys',async()=>{
 for(const mutation of [e=>e.position.key='other-child',e=>e.activeTeam='B',e=>e.perspective='B',e=>e.outcomes[0].key=null]){
  const {o,r,e}=await closureFixture();mutation(e);
  await captureDefenseTerminal(r,o,{kind:'endTurn'},{from:'actual-child'},e,{}, {},Date.now()+10000);assert.equal(r.ownClosures.size,0);
 }
});
