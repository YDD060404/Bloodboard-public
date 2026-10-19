import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverPickupProtection} from '../src/pickup-protection.mjs';
import {policyFrom} from '../src/policy.mjs';

// Synthetic source-bound service contracts only; no engine or worker imports.
function fixture({closedActivation=false,split=false,illegalHelper=false,illegalClose=false,illegalPicker=false,
 partialClose=false,foreignClose=false,rollFree=true,pickupSucceeds=true,directLegal=true,directResponse=null,
 pickerFailure=null,pickerRevalidationIllegal=false,helperFailure=null,refusalAt=null,closureMismatch=false}={}){
 const o={team:'A',active:'A',phase:'play',half:1,drive:1,score:{A:0,B:0},turn:{A:1,B:1},turnsPerHalf:8,
  pitch:{width:26,height:15},ball:{kind:'ground',pos:{x:5,y:5}},activation:null,
  players:[{id:'helper',team:'A',location:'pitch',stance:'standing',pos:{x:1,y:1},ma:6,activated:false,canBeActivated:true},
   {id:'picker',team:'A',location:'pitch',stance:'standing',pos:{x:3,y:4},ma:6,activated:false,canBeActivated:true}]};
 const helper={kind:'playerAction',playerId:'helper',action:'move',path:[{kind:'step',to:{x:4,y:4}}]},
  pickup={kind:'playerAction',playerId:'picker',action:'secure',path:[]},states=new Map([['root',o]]),calls=[];let directChecks=0;
 const branch=(key,ob,p=1,turnover=false)=>{states.set(key,ob);return {key,observation:ob,active:ob.active,p,turnover,touchdown:null,completed:true};};
 const law=(from,outcomes)=>({ok:true,position:{key:from},perspective:'A',activeTeam:'A',outcomeIdentity:'complete-state-v1',
  decisionPolicy:{mode:'builtin',own:'builtin',opponent:'builtin'},exact:true,enumerated:1,unresolvedMass:0,rest:{p:0},
  pTurnover:outcomes.reduce((s,b)=>s+(b.turnover?b.p:0),0),pTouchdown:0,pOpponentTouchdown:0,outcomes});
 const inspect={CFG:{touchdown:1500,possession:160,carrierTurnover:95,turnover:62,unresolved:120,optionalRush:12},
  canonical:x=>x,cheapScore:()=>0,boardValue:()=>0,outcomeValue:ex=>({value:ex.outcomes.reduce((s,b)=>s+b.p*(b.observation.ball.kind==='held'?100:0),0)})};
 const services={
  candidates:async q=>{calls.push({method:'candidates',q});return {ok:true,position:{key:q.from},candidates:[{input:helper,legal:true}]};},
  validate:async(i,q)=>{
   calls.push({method:'validate',i,q});const ob=states.get(q.from);assert.ok(ob,'unknown validation source '+q.from);
   if(refusalAt==='helper-validation'&&i.playerId==='helper'||refusalAt==='closure-validation'&&i.kind==='endActivation'||refusalAt==='closed-picker-validation'&&i.playerId==='picker'&&q.from.startsWith('closed-'))return {ok:false,code:'coach-resource-budget'};
   if(i.playerId==='picker'&&q.from==='helper-source'){
    directChecks++;if(directResponse)return {position:q.from,...directResponse};
    if(pickerRevalidationIllegal&&directChecks>1)return {ok:true,legal:false,position:q.from};
   }
   const legal=i.kind==='endActivation'?!illegalClose&&ob.activation?.playerId==='helper':
    i.playerId==='helper'?!illegalHelper:(!ob.activation||directLegal&&q.from==='helper-source')&&illegalPicker!==true&&illegalPicker!==q.from;
   return {ok:true,legal,position:q.from};
  },
  explore:async(i,q)=>{
   calls.push({method:'explore',i,q});const ob=states.get(q.from);assert.ok(ob,'unknown exploration source '+q.from);
   if(refusalAt==='helper-exploration'&&i.playerId==='helper'||refusalAt==='closure-exploration'&&i.kind==='endActivation')return {ok:false,code:'coach-resource-budget'};
   if(i.playerId==='helper'){
    assert.equal(q.from,'root');const after={...o,activation:closedActivation?null:{playerId:'helper',over:false,maUsed:1}};
    const e=law(q.from,rollFree?[branch('helper-source',after)]:[branch('helper-source',after,.9),branch('helper-other',after,.1)]);
    if(helperFailure==='partial'){e.outcomes[0].p=.8;e.rest.p=.2;e.unresolvedMass=.2;}
    if(helperFailure==='foreign')e.position.key='old-success-source';
    if(helperFailure==='turnover')e.outcomes[0].turnover=true;
    if(helperFailure==='observation-mismatch')e.outcomes[0].observation={...after,active:'B'};
    return e;
   }
   if(i.kind==='endActivation'){
    assert.equal(q.from,'helper-source');const next={...ob,activation:null};
    const e=law(q.from,split?[branch('closed-1',next,.6),branch('closed-2',next,.2),branch('closed-failure',{...next,active:'B'},.2,true)]:[branch('closed-1',next)]);
    if(partialClose){e.outcomes[0].p=.8;e.rest.p=.2;e.unresolvedMass=.2;e.enumerated=.8;}
    if(foreignClose)e.position.key='old-success-source';
    if(closureMismatch)e.outcomes[0].observation={...next,active:'B'};return e;
   }
   if(i.playerId==='picker'){
    assert.ok(ob.activation===null||directLegal&&q.from==='helper-source','implicit actor switch requires source validation');assert.notEqual(q.from,'root');
    if(pickerFailure==='refused')return {ok:false,code:'coach-resource-budget'};
    const switched={...ob,players:ob.players.map(p=>p.id==='helper'?{...p,activated:true,canBeActivated:false}:p)};
    const e=law(q.from,[branch('pickup-success-'+q.from,{...switched,ball:pickupSucceeds?{kind:'held',playerId:'picker'}:ob.ball,activation:{playerId:'picker',over:false}},.75),
     branch('pickup-failure-'+q.from,{...ob,active:'B'},.25,true)]);
    if(pickerFailure==='partial'){e.outcomes[0].p=.5;e.rest.p=.25;e.unresolvedMass=.25;e.enumerated=.75;}
    if(pickerFailure==='foreign')e.position.key='old-success-source';return e;
   }
   assert.equal(i.kind,'endTurn');return law(q.from,[branch('end-'+q.from,{...ob,active:'B',activation:null})]);
  },fork:{open:async q=>{assert.ok(states.has(q.from));return {ok:true,revisionBound:true,from:q.from,fork:'audit:'+q.from,node:'terminal',position:q.from,completed:true,turnover:false};},
   step:async()=>{throw new Error('terminal audit does not step');},close:async()=>({ok:true})}
 };
 // Old picker evidence must never be rebound to the newly created helper keys.
 const selected={input:pickup,ex:law('old-success-source',[branch('old-child',{...o,ball:{kind:'held',playerId:'picker'}})]),
  preparedBranches:new Map([['old-child',{plan:{input:{kind:'endTurn'}},ex:law('old-child',[branch('old-grandchild',{...o,active:'B'})])}]])};
 return {o,selected,services,inspect,calls,run:()=>discoverPickupProtection(o,selected,services,inspect,10000)};
}
test('source-legal direct picker uses implicit actor closure and retains its actual turnover mass',async t=>{
 t.mock.method(Date,'now',()=>0);const f=fixture(),r=await f.run();assert.equal(r.selected,null);assert.equal(r.policyTrees.length,1,JSON.stringify(r.rejections));
 const tree=r.policyTrees[0],dependency=tree.preparedBranches.get('helper-source');assert.equal(dependency.plan.input.playerId,'picker');assert.equal(dependency.ex.position.key,'helper-source');
 assert.ok(!f.calls.some(c=>c.i?.kind==='endActivation'));assert.ok(f.calls.filter(c=>c.method==='explore'&&c.i.playerId==='picker').every(c=>c.q.from==='helper-source'));
 assert.ok(f.calls.filter(c=>c.q?.from).every(c=>!c.q.from.startsWith('old-')));
 const policy=policyFrom(tree,tree.preparedBranches,'A',f.inspect);assert.ok(policy.complete);assert.equal(policy.ex.pTurnover,.25);assert.equal(policy.ex.outcomes.filter(b=>!b.turnover&&b.observation.ball.kind==='held').reduce((s,b)=>s+b.p,0),.75);
 assert.match(r.reason,/common-comparison-required/);
});
test('a verified illegal direct source can fall back to actual EndActivation before picker binding',async t=>{
 t.mock.method(Date,'now',()=>0);const f=fixture({directLegal:false}),r=await f.run();
 assert.equal(r.selected,null);assert.equal(r.policyTrees.length,1,JSON.stringify(r.rejections));
 const dependency=r.policyTrees[0].preparedBranches.get('helper-source');assert.equal(dependency.plan.input.kind,'endActivation');
 assert.equal(dependency.ex.position.key,'helper-source');assert.ok(dependency.preparedBranches.has('closed-1'));
 assert.equal(dependency.preparedBranches.get('closed-1').ex.position.key,'closed-1');
 assert.ok(f.calls.some(c=>c.method==='validate'&&c.i.kind==='endActivation'&&c.q.from==='helper-source'));
 assert.ok(f.calls.some(c=>c.method==='explore'&&c.i.kind==='endActivation'&&c.q.from==='helper-source'));
 assert.ok(f.calls.filter(c=>c.method==='explore'&&c.i.playerId==='picker').every(c=>c.q.from==='closed-1'));
 assert.ok(f.calls.filter(c=>c.q?.from).every(c=>!c.q.from.startsWith('old-')));
 assert.match(r.reason,/common-comparison-required/);
});
test('each successful closure successor gets its own picker source while closure and pickup failures retain original mass',async t=>{
 t.mock.method(Date,'now',()=>0);const f=fixture({directLegal:false,split:true}),r=await f.run();assert.equal(r.policyTrees.length,1,JSON.stringify(r.rejections));
 const tree=r.policyTrees[0],dependency=tree.preparedBranches.get('helper-source');
 assert.deepEqual([...dependency.preparedBranches.keys()],['closed-1','closed-2']);
 assert.equal(dependency.ex.outcomes.find(b=>b.key==='closed-failure').p,.2);
 const sources=f.calls.filter(c=>c.method==='explore'&&c.i.playerId==='picker').map(c=>c.q.from);assert.deepEqual(sources,['closed-1','closed-2']);
 const policy=policyFrom(tree,tree.preparedBranches,'A',f.inspect);assert.ok(policy.complete);
 assert.ok(Math.abs(policy.ex.outcomes.reduce((s,b)=>s+b.p,0)-1)<1e-8);assert.ok(Math.abs(policy.ex.pTurnover-.4)<1e-8);
 assert.ok(Math.abs(policy.ex.outcomes.filter(b=>!b.turnover&&b.observation.ball.kind==='held').reduce((s,b)=>s+b.p,0)-.6)<1e-8);
});
test('an already closed helper activation binds the picker directly without inventing endActivation',async t=>{
 t.mock.method(Date,'now',()=>0);const f=fixture({closedActivation:true}),r=await f.run();assert.equal(r.policyTrees.length,1);
 assert.equal(r.policyTrees[0].preparedBranches.get('helper-source').plan.input.playerId,'picker');
 assert.ok(!f.calls.some(c=>c.i?.kind==='endActivation'));
});
test('native root activation legality can refuse a different helper before any helper exploration',async t=>{
 t.mock.method(Date,'now',()=>0);const f=fixture({illegalHelper:true});f.o.activation={playerId:'picker',over:false};
 const r=await f.run();assert.equal(r.policyTrees.length,0);assert.ok(r.rejections.includes('protector-not-legal-at-root'));
 assert.ok(!f.calls.some(c=>c.method==='explore'));
});
test('illegal, partial or foreign-source activation closure cannot lend a picker success certificate',async t=>{
 t.mock.method(Date,'now',()=>0);
 for(const options of [{illegalClose:true},{partialClose:true},{foreignClose:true}]){
  const f=fixture({directLegal:false,...options}),r=await f.run();assert.equal(r.policyTrees.length,0);
  assert.ok(!f.calls.some(c=>c.method==='explore'&&c.i.playerId==='picker'));
  assert.ok(r.rejections.includes(options.illegalClose?'protector-activation-not-closable':'protector-activation-closure-incomplete'));
 }
});
test('an illegal picker at the actual closure source rejects the dependency instead of using its old root success',async t=>{
 t.mock.method(Date,'now',()=>0);
 for(const options of [{illegalPicker:true},{split:true,illegalPicker:'closed-2'}]){
  const f=fixture({directLegal:false,...options}),r=await f.run();assert.equal(r.policyTrees.length,0);
  assert.ok(r.rejections.includes('pickup-not-legal-after-protection'));
  assert.ok(f.calls.some(c=>c.method==='validate'&&c.i.playerId==='picker'&&c.q.from===(options.split?'closed-2':'closed-1')));
  assert.ok(!f.calls.some(c=>c.method==='explore'&&c.i.playerId==='picker'));
 }
});
test('unverified or refused direct legality cannot trigger an explicit closure fallback',async t=>{
 t.mock.method(Date,'now',()=>0);
 for(const directResponse of [{ok:false,code:'coach-resource-budget'},{ok:false,code:'timeout'},{ok:true,legal:true,position:'old-success-source'},{ok:true}]){
  const f=fixture({directResponse}),r=await f.run();assert.equal(r.policyTrees.length,0);assert.ok(r.rejections.includes('pickup-after-protection-legality-unverified'));
  assert.ok(!f.calls.some(c=>c.i?.kind==='endActivation'||c.method==='explore'&&c.i.playerId==='picker'));
 }
});
test('direct source legality is rechecked by the binder instead of being a global actor-switch assumption',async t=>{
 t.mock.method(Date,'now',()=>0);const f=fixture({pickerRevalidationIllegal:true}),r=await f.run();assert.equal(r.policyTrees.length,0);assert.ok(r.rejections.includes('own-input-source-not-legal'));
 assert.equal(f.calls.filter(c=>c.method==='validate'&&c.i.playerId==='picker'&&c.q.from==='helper-source').length,2);
 assert.ok(!f.calls.some(c=>c.i?.kind==='endActivation'||c.method==='explore'&&c.i.playerId==='picker'));
});
test('partial, foreign or refused direct exploration remains unknown without borrowing old picker success or End fallback',async t=>{
 t.mock.method(Date,'now',()=>0);
 for(const pickerFailure of ['partial','foreign','refused']){
  const f=fixture({pickerFailure}),r=await f.run();assert.equal(r.policyTrees.length,0);assert.ok(r.rejections.length>0);assert.ok(f.calls.some(c=>c.method==='explore'&&c.i.playerId==='picker'&&c.q.from==='helper-source'));
  assert.ok(!f.calls.some(c=>c.i?.kind==='endActivation'));assert.ok(f.calls.filter(c=>c.q?.from).every(c=>!c.q.from.startsWith('old-')));
 }
});
test('helper partial chance, turnover or foreign/mismatched source cannot supply a direct picker branch',async t=>{
 t.mock.method(Date,'now',()=>0);
 for(const helperFailure of ['partial','foreign','turnover','observation-mismatch']){
  const f=fixture({helperFailure}),r=await f.run();assert.equal(r.policyTrees.length,0);assert.ok(r.rejections.includes('protector-not-complete-roll-free'));
  assert.ok(!f.calls.some(c=>c.method==='validate'&&c.i.playerId==='picker'||c.i?.kind==='endActivation'));
 }
});
test('resource refusal at helper or explicit fallback checks cannot be converted to a pickup proposal',async t=>{
 t.mock.method(Date,'now',()=>0);
 for(const refusalAt of ['helper-validation','helper-exploration','closure-validation','closure-exploration','closed-picker-validation']){
  const f=fixture({directLegal:false,refusalAt}),r=await f.run();assert.equal(r.policyTrees.length,0);assert.ok(r.rejections.length>0);
  assert.ok(!f.calls.some(c=>c.method==='explore'&&c.i.playerId==='picker'));
 }
 const f=fixture({directLegal:false,closureMismatch:true}),r=await f.run();assert.equal(r.policyTrees.length,0);assert.ok(r.rejections.includes('pickup-protection-successor-unverified'));
 assert.ok(!f.calls.some(c=>c.method==='explore'&&c.i.playerId==='picker'));
});
test('helper chance remains roll-free and recursively explored picker must actually hold the ball',async t=>{
 t.mock.method(Date,'now',()=>0);
 const chance=fixture({rollFree:false}),a=await chance.run();assert.equal(a.policyTrees.length,0);assert.ok(a.rejections.includes('protector-not-complete-roll-free'));
 const noPickup=fixture({pickupSucceeds:false}),b=await noPickup.run();assert.equal(b.policyTrees.length,0);assert.ok(b.rejections.includes('follow-up-does-not-pick-up-ball'));
});
