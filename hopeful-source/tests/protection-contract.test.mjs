import test from 'node:test';
import assert from 'node:assert/strict';
import {buildProtectionPolicy,challengeProtection,discoverProtectionMove,measureProtectionReplies,strictJointWinner,certifiedOwnEndPolicy} from '../src/protection.mjs';
import {auditBuiltinRules,builtinRuleChoice} from '../src/rules.mjs';
import {compareCarrierReplies} from '../src/carrier-replies.mjs';
import {saveChampionPlan} from '../src/plans.mjs';
import {reconcile,armStep,planView} from '../src/execution.mjs';
const identity={coachId:'test',version:'1',contextSchema:'test'};
const input=id=>({kind:'playerAction',playerId:id,action:'move',path:[{kind:'step',to:{x:3,y:3}}]});
const ob=(revision=0)=>({apiVersion:1,team:'A',active:'A',phase:'play',pending:null,turn:{A:1,B:1},turnsPerHalf:6,
 half:1,drive:1,format:'sevens',requestId:revision+1,revision:revision+':-:0',pitch:{width:20,height:11},
 ball:{kind:'held',playerId:'carrier'},teams:{A:{rerolls:1},B:{rerolls:1}},players:[
 {id:'carrier',team:'A',location:'pitch',stance:'standing',pos:{x:2,y:3},activated:false},
 {id:'guard',team:'A',location:'pitch',stance:'standing',pos:{x:4,y:3},activated:false}]});
const inspect={CFG:{carrierTurnover:50,turnover:30,unresolved:200,optionalRush:1,carrierDown:110,opponentScore:240},
 boardValue:()=>0,outcomeValue:()=>({value:10}),canonical:x=>x,cheapScore:()=>1};
const ex=(from,outcomes)=>({ok:true,position:{key:from},perspective:'A',activeTeam:'A',outcomeIdentity:'complete-state-v1',
 decisionPolicy:{mode:'builtin',own:'builtin',opponent:'builtin'},unresolvedMass:0,rest:{p:0},outcomes});
const leaf=(key,observation,p=1,turnover=false)=>({key,observation,p,completed:true,turnover,active:observation.active});
function services(){let id=0;return {
 validate:async(i,q)=>({ok:true,legal:true,position:q.from}),
 explore:async(i,q)=>{const o=ob(1);if(i.kind==='endTurn')o.active='B';return ex(q.from,[leaf('after-'+q.from,o)]);},
 candidates:async q=>({ok:true,position:{key:q.from},candidates:[]}),
 fork:{open:async q=>({ok:true,revisionBound:true,from:q.from,fork:'f'+(++id),node:'terminal',position:'terminal',completed:true,turnover:false}),close:async()=>({ok:true}) ,step:async()=>null}
 };}
test('own failure remains in a complete joint policy at the same opposing End boundary',async()=>{
 const o=ob(),sv=services(),success=ob(1),failure={...ob(1),active:'B'};
 const first={input:input('carrier'),ex:ex('root',[leaf('s',success,.75),leaf('fail',failure,.25,true)])};
 const r=await buildProtectionPolicy(o,first,sv,inspect,Date.now()+10000);
 assert.equal(r.complete,true,r.reason);assert.equal(r.policy.ex.pTurnover,.25);assert.equal(r.endpoints.reduce((s,b)=>s+b.p,0),1);
 assert.equal(r.endpoints.find(b=>b.key==='fail').ownTurnover,true);assert.equal(r.tree.requireRuleMaps,true);
});
test('every required child revalidates its actual parent, and dangling dependency fails closed',async()=>{
 const o=ob(),sv=services(),seen=[],v=sv.validate;sv.validate=async(i,q)=>{seen.push(q.from);return v(i,q);};
 const first={input:input('carrier'),ex:ex('root',[leaf('s',ob(1))]),preparedBranches:new Map([['s',{plan:{input:input('guard')},ex:ex('s',[leaf('g',ob(2))])}]])};
 const r=await buildProtectionPolicy(o,first,sv,inspect,Date.now()+10000);assert.equal(r.complete,true,r.reason);assert.deepEqual(seen,['root','s']);assert.equal(r.policy.maxDepth,1);
 first.preparedBranches.set('foreign',first.preparedBranches.get('s'));const bad=await buildProtectionPolicy(o,first,sv,inspect,Date.now()+10000);assert.equal(bad.complete,false);assert.equal(bad.reason,'own-dangling-dependency');
});
test('common-source refinement replaces coarse mass only after a real same-source complete result',async()=>{
 const sv=services(),o=ob(),coarse=ex('root',[leaf('s',ob(1),.99)]);coarse.rest.p=.01;coarse.unresolvedMass=.01;
 const first={input:input('carrier'),ex:coarse},before=JSON.stringify(first);
 const r=await buildProtectionPolicy(o,first,sv,inspect,Date.now()+10000,{refineIncomplete:true});
 assert.equal(r.complete,true,r.reason);assert.equal(r.refinements.length,1);
 assert.equal(r.refinements[0].reason,'same-source-complete-evidence-replaces-coarse-cache');
 assert.equal(JSON.stringify(first),before);assert.equal(r.endpoints.reduce((v,b)=>v+b.p,0),1);
});
test('refinement never rebases existing conditional dependencies to unrelated new keys',async()=>{
 const sv=services(),o=ob(),coarse=ex('root',[leaf('s',ob(1),.99)]);coarse.rest.p=.01;
 const first={input:input('carrier'),ex:coarse,preparedBranches:new Map([['s',{plan:{input:input('guard')},ex:ex('s',[leaf('g',ob(2))])}]])};
 let explores=0;sv.explore=async()=>{explores++;throw Error('not allowed');};
 const r=await buildProtectionPolicy(o,first,sv,inspect,Date.now()+10000,{refineIncomplete:true});
 assert.equal(r.complete,false);assert.equal(explores,0);assert.equal(r.refinements[0].reason,'retained-dependencies-require-original-successor-sources');
});
test('partial or foreign refreshed evidence stays unknown, including actual service failures',async()=>{
 for(const mode of ['partial','foreign','failure']){
  const sv=services(),o=ob(),coarse=ex('root',[leaf('s',ob(1),.99)]);coarse.rest.p=.01;
  sv.explore=async()=>mode==='failure'?{ok:false,code:'timeout'}:mode==='foreign'?ex('other',[leaf('g',ob(1))]):coarse;
  const r=await buildProtectionPolicy(o,{input:input('carrier'),ex:coarse},sv,inspect,Date.now()+10000,{refineIncomplete:true});
  assert.equal(r.complete,false,mode);assert.equal(r.refinements[0].attempted,true);assert.equal(r.refinements[0].reason,'same-source-refinement-not-complete');
 }
});
test('foreign identity, absent own headers, incomplete mass and unverified rule terminal cannot certify policy',async()=>{
 for(const mode of ['source','policy','mass','rule','terminal-active']){
  const sv=services(),value=ex('root',[leaf('s',ob(1))]);
  if(mode==='source')value.position.key='foreign';if(mode==='policy')value.decisionPolicy.own='custom';if(mode==='mass')value.rest.p=.2;
  if(mode==='terminal-active')value.outcomes[0].active=undefined;
  sv.explore=async()=>value;if(mode==='rule')sv.fork.open=async()=>({ok:false});
  const r=await buildProtectionPolicy(ob(),{input:input('carrier'),ex:value},sv,inspect,Date.now()+10000);assert.equal(r.complete,false,mode);
 }
});
test('no proposal and a protected immediate own TD spend no joint protection requests',async()=>{
 const sv=services(),o=ob(),current={input:input('guard'),terminalScoreMass:1};
 assert.equal((await challengeProtection(o,{mode:'normal',selected:current},[],sv,inspect,Date.now()+10000)).attempted,false);
 current.terminalScoreMass=0;current.input.action='pass';assert.equal((await challengeProtection(o,{mode:'normal',selected:current},[],sv,inspect,Date.now()+10000)).reason,'no-public-joint-protection-proposal');
});
test('new proposals obtain actual source evidence instead of requiring prefilled reply numbers',async()=>{
 const sv=services(),o=ob();let expensive=0;
 const proposed=input('guard');proposed.path[0].to={x:3,y:2};
 sv.candidates=async q=>({ok:true,position:{key:q.from},candidates:[{input:proposed}]});
 sv.explore=async()=>{expensive++;throw Error('source service failed');};
 for(const measured of [false,true]){
  const current={input:input('guard'),...(measured?{criticalReplyAdjustment:-110,positionReplyAdjustment:-20}:{})};
  const r=await challengeProtection(o,{mode:'normal',selected:current},[],sv,inspect,Date.now()+10000);
  assert.equal(r.attempted,true);assert.equal(r.reason,'joint-own-policy-or-rule-map-incomplete');assert.equal(r.selected,null);
  assert.ok(r.policies.every(p=>p.complete===false));
 }
 assert.ok(expensive>0,'missing prior scores neither certify safety nor prevent real evidence acquisition');
});
test('an incumbent End admits an actual carrier proposal and source-bound policy; End is not repeated',async()=>{
 const o=ob(),sv=services(),seen=[],base=sv.explore;
 sv.explore=async(i,q)=>{seen.push([i,q.from]);return base(i,q);};
 const current={input:{kind:'endTurn'}},carry={input:input('carrier'),family:'move',value:12};
 const r=await challengeProtection(o,{mode:'normal',selected:current,lines:[current,carry]},[],sv,inspect,Date.now()+10000);
 assert.equal(r.attempted,true);assert.ok(r.policyTrees?.some(p=>p.input.playerId==='carrier'));
 assert.ok(seen.some(([i])=>i.playerId==='carrier'));assert.ok(seen.some(([i,from])=>i.kind==='endTurn'&&from==='root'));
 assert.equal(r.selected,null,'unknown opponent domain cannot become safe because the proposal was admitted');
 const end=await buildProtectionPolicy(o,current,sv,inspect,Date.now()+10000);
 assert.equal(end.complete,true,end.reason);assert.equal(end.endpoints[0].active,'B');
 assert.equal(end.calls,2,'one validate and one End; no second End');
});
test('common own-End endpoint supplies value, retaining root risk and all action costs',async()=>{
 const sv=services(),o=ob(),inner={...inspect,outcomeValue:e=>({value:e.outcomes.reduce((sum,b)=>sum+b.p*b.observation.mark,0)})};
 sv.explore=async(i,q)=>{const b=ob(1);b.mark=i.kind==='endTurn'?20:10;if(i.kind==='endTurn')b.active='B';return ex(q.from,[leaf('after-'+q.from,b)]);};
 const r=await buildProtectionPolicy(o,{input:input('carrier')},sv,inner,Date.now()+10000);
 assert.equal(r.complete,true);assert.equal(r.baseValue,19.4,'shared terminal20 less real one-step.6 cost, not intermediate10');
});
test('real keyless own-End state retains terminal value but cannot certify future replies',async()=>{
 const sv=services(),o=ob(),inner={...inspect,outcomeValue:e=>({value:e.outcomes.reduce((sum,b)=>sum+b.p*b.observation.mark,0)})};
 sv.explore=async(i,q)=>{const b=ob(1);b.mark=i.kind==='endTurn'?20:10;if(i.kind==='endTurn')b.active='B';return ex(q.from,[leaf(i.kind==='endTurn'?null:'real-root-success',b)]);};
 const p=await buildProtectionPolicy(o,{input:input('carrier')},sv,inner,Date.now()+10000);
 assert.equal(p.complete,true,p.reason);assert.equal(p.baseValue,19.4);assert.equal(p.endpoints[0].key,null);
 const r=await measureProtectionReplies(o,p,sv,inner,Date.now()+10000);
 assert.equal(r.complete,false);assert.equal(r.unknownMass,1);
 assert.ok(r.reasons.includes('reply-source-unavailable'));
 const finite=await compareCarrierReplies(o,[{input:p.tree.input,endpoints:p.endpoints}],sv,inner,Date.now()+10000);
 assert.equal(finite.reason,'own-phase-endpoints-incomplete');assert.equal(finite.discoveryIncomplete,true);
 assert.equal(finite.discoveryIssues[0].reason,'own-end-reply-key-unavailable');
 const directEnd=await buildProtectionPolicy(o,{input:{kind:'endTurn'}},sv,inner,Date.now()+10000);
 assert.equal(directEnd.complete,true,directEnd.reason);assert.equal(directEnd.baseValue,20);
 assert.equal(directEnd.endpoints[0].key,null,'already-ended own actions obey the same state/handle distinction');
});
test('known own TD and observed critical reply cost survive incomplete reply mass',async()=>{
 const own=ob(),sv=services(),ins={...inspect,replyAssessment:async()=>({failed:false,unknown:true,essentialComplete:false,criticalAdjustment:-240,positionAdjustment:-3})};
 const p={endpoints:[{p:.8,touchdown:'A'},{p:.2,key:'e',active:'B',observation:{...ob(),active:'B'}}]};
 const r=await measureProtectionReplies(own,p,sv,ins,Date.now()+10000);
 assert.equal(r.complete,false);assert.ok(Math.abs(r.unknownMass-.2)<1e-8);assert.equal(r.criticalAdjustment,-48);
 assert.ok(r.reasons.includes('bounded-reply-coverage-incomplete'));
});
test('strict common-bound winner has no incumbent identity bonus and overlapping/invalid evidence cannot choose',()=>{
 const b=[{lower:2,upper:3},{lower:5,upper:6}];assert.equal(strictJointWinner(b),1);assert.equal(strictJointWinner([...b].reverse()),0);
 assert.equal(strictJointWinner([{lower:2,upper:6},{lower:5,upper:7}]),-1);
 assert.equal(strictJointWinner([{lower:2,upper:3},{lower:NaN,upper:7}]),-1);
});

const offer={team:'A',type:'followUp',prompt:'Follow?',options:[{id:'yes',label:'Follow up'},{id:'no',label:'Stay'}],optionId:'yes'};
test('audited maps survive exact graph rebasing with node order and final context admission',()=>{
 const o=ob(),s=ob(1),g=ob(2);s.players[0].pos.x=3;g.players[1].pos.x=3;
 const root={input:input('carrier'),ex:ex('root',[leaf('s',s)]),requireRuleMaps:true,ruleMap:{input:input('carrier'),offers:[]},
 preparedBranches:new Map([['s',{plan:{input:input('guard')},ex:ex('s',[leaf('g',g)]),ruleMap:{input:input('guard'),offers:[offer]}}]])};
 const saved=saveChampionPlan(o,root,identity);assert.ok(saved.plan,saved.reason);assert.equal(saved.plan.ruleMaps.length,2);
 const r=reconcile(saved.plan,s,{identity});assert.equal(r.status,'candidate-ready',r.reason);assert.equal(r.plan.ruleMaps.length,1);assert.deepEqual(r.plan.ruleMaps[0].input,input('guard'));
 assert.ok(armStep(r.plan,s,input('guard')).plan);assert.equal(planView(r.plan).activeTask.actor,'guard');
 const small=saveChampionPlan(o,root,identity,512);assert.equal(small.plan,null);
 delete root.preparedBranches.get('s').ruleMap;assert.equal(saveChampionPlan(o,root,identity).plan,null);
});
test('runtime audited builtin offer binds actor, history, identity, full offer and current pending request',()=>{
 const o=ob(),i={...input('carrier'),action:'block',path:[],blockTarget:'foe'},after=ob(1);
 const saved=saveChampionPlan(o,{input:i,ex:ex('root',[leaf('s',after)]),requireRuleMaps:true,ruleMap:{input:i,offers:[offer]}},identity);assert.ok(saved.plan,saved.reason);
 const request={id:12,team:'A',type:offer.type,prompt:offer.prompt,options:offer.options};
 const pending={...o,activation:{playerId:'carrier',action:'block'},pending:{requestId:12,team:'A',type:offer.type,options:offer.options}};
 assert.equal(builtinRuleChoice(pending,request,saved.plan,identity)?.optionId,'yes');
 for(const change of [x=>x.revision='1:-:0',x=>x.activation.playerId='guard',x=>x.contextInfo={resetReason:'cancelled'},x=>x.drive=2,x=>x.pending.requestId=13]){
  const altered=structuredClone(pending);change(altered);assert.equal(builtinRuleChoice(altered,request,saved.plan,identity),null);
 }
 assert.equal(builtinRuleChoice(pending,{...request,prompt:'different'},saved.plan,identity),null);
 assert.equal(builtinRuleChoice(pending,request,saved.plan,{...identity,version:'2'}),null);
 const corrupt=structuredClone(saved.plan);corrupt.ruleMaps[0].input=input('guard');assert.equal(planView(corrupt),null);
});
test('builtin fork audit rejects ambiguous offers and unresolved or invalid chance mass, and closes handles',async()=>{
 for(const mode of ['complete','ambiguous','mass','unresolved','NaN','cap','source']){
  let id=0;const opened=new Set(),closed=new Set(),node=(more)=>{const fork='f'+(++id);opened.add(fork);return {ok:true,revisionBound:true,fork,...more};};
  const sv={fork:{open:async q=>node({from:mode==='source'?'foreign':q.from,node:'chance',unresolvedMass:mode==='unresolved'?.1:mode==='NaN'?NaN:0,
   branches:[{p:.5},{p:mode==='mass'?.3:.5}]}),
   step:async q=>q.copy?node({node:'decision',decisionOf:'A',type:offer.type,prompt:offer.prompt,branches:offer.options,defaultBranch:mode==='ambiguous'&&q.branch===1?1:0}):
    node({node:'terminal',position:'terminal',completed:true,turnover:false}),close:async q=>{closed.add(q.fork);return {ok:true};}}};
  const r=await auditBuiltinRules(ob(),input('carrier'),sv,Date.now()+10000,{maxCalls:mode==='cap'?1:512});
  assert.equal(r.complete,mode==='complete',mode);assert.deepEqual([...opened].sort(),[...closed].sort(),mode);
  if(mode==='complete'){assert.equal(r.terminalMass,1);assert.equal(r.offers.length,1);}
 }
});

test('a purported reply source still owned by us stays unknown and spends no opponent query',async()=>{
 let queries=0;const ins={...inspect,replyAssessment:async()=>{queries++;throw Error('wrong side');}};
 const r=await measureProtectionReplies(ob(),{endpoints:[{key:'own',p:1,active:'A',observation:ob()}]},services(),ins,Date.now()+10000);
 assert.equal(queries,0);assert.equal(r.complete,false);assert.equal(r.unknownMass,1);assert.deepEqual(r.reasons,['reply-source-still-own-active']);
});

test('missing retained guard routes use bounded source-bound discovery without granting a value certificate',async()=>{
 const o=ob(),sv=services(),calls=[];o.players.push({...o.players[1],id:'spent',canBeActivated:false});
 const route={input:input('guard')};route.input.path[0].to={x:3,y:3};
 sv.candidates=async q=>{calls.push(q);return {ok:true,position:{key:'root'},candidates:[route,{input:input('spent')}]};};
 const r=await discoverProtectionMove(o,sv,inspect,Date.now()+10000);
 assert.equal(r.selected.input.playerId,'guard');assert.equal(r.candidates,1);
 assert.equal(calls[0].maxRushes,0);assert.equal(calls[0].limit,24);assert.deepEqual(calls[0].players,['guard']);
 assert.equal(r.selected.ruleMap,undefined);assert.equal(r.selected.ex,undefined);
 sv.candidates=async()=>({ok:true,position:{key:'foreign'},candidates:[route]});
 assert.equal((await discoverProtectionMove(o,sv,inspect,Date.now()+10000)).reason,'protector-discovery-source-unverified');
});

test('End comparison includes a discovered guard even when carrier continuation is retained',async()=>{
 const o=ob(),sv=services(),guard={input:input('guard')};guard.input.path[0].to={x:3,y:3};
 sv.candidates=async q=>({ok:true,position:{key:q.from},candidates:q.from==='root'?[guard]:[]});
 const current={input:{kind:'endTurn'}},carry={input:input('carrier')};
 const r=await challengeProtection(o,{mode:'normal',selected:current,lines:[current,carry]},[],sv,inspect,Date.now()+10000);
 assert.equal(r.discovery.reason,'public-protector-proposal');
 assert.deepEqual(r.policies.map(p=>p.input.playerId??'End'),['End','guard','carrier']);
 assert.deepEqual(r.policies.map(p=>p.variant),['current','stop-after-root','stop-after-root']);
 assert.equal(r.duplicatePolicies.length,2,'identical empty extensions must not tie a policy with itself');
 assert.ok(r.policyTrees.some(t=>t.input.playerId==='guard'));
 assert.equal(r.selected,null,'candidate discovery cannot stand in for complete reply evidence');
});

test('stop-after-root drops inherited dependencies while retaining the original certified strategy separately',async()=>{
 const o=ob(),sv=services(),carry={input:input('carrier'),ex:ex('root',[leaf('s',ob(1))]),
  preparedBranches:new Map([['s',{plan:{input:input('guard')},ex:ex('s',[leaf('g',ob(2))])}]])};
 const r=await challengeProtection(o,{mode:'normal',selected:{input:{kind:'endTurn'}},lines:[carry]},[],sv,inspect,Date.now()+10000);
 const stop=r.policies.find(p=>p.input.playerId==='carrier'&&p.variant==='stop-after-root');
 const original=r.policies.find(p=>p.input.playerId==='carrier'&&p.variant==='retained-dependencies');
 assert.equal(stop.complete,true);assert.equal(stop.dependencyDepth,0);
 assert.equal(original.complete,true);assert.equal(original.dependencyDepth,1);
 assert.equal(carry.preparedBranches.size,1,'snapshot evidence must remain intact');
});

test('Own-End reuse is request-local and invalidates on source, graph, probabilities, costs or endpoint mutation',async()=>{
 for(const mode of ['copy','root','input','probability','costs','endpoint','valid']){
  const o=ob(),sv=services(),ins={...inspect,CFG:{...inspect.CFG}};
  const p=await buildProtectionPolicy(o,{input:input('carrier')},sv,ins,Date.now()+10000);
  assert.equal(p.complete,true);let line=p.tree,root=o;
  if(mode==='copy')line={...line};
  if(mode==='root')root={...o,revision:'changed'};
  if(mode==='input')line.input={...line.input,playerId:'guard'};
  if(mode==='probability')line.ex.outcomes[0].p=.5;
  if(mode==='costs')ins.CFG.carrierTurnover++;
  if(mode==='endpoint')p.endpoints[0].p=.5;
  assert.equal(!!certifiedOwnEndPolicy(line,root,ins),mode==='valid',mode);
 }
});
