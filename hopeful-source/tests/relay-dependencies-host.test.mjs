import test from 'node:test';
import assert from 'node:assert/strict';
import {E,observe,Session,callService} from './deps/archived-v6-host.mjs';
import {createChampion} from '../src/champion.mjs';
import {policyFrom,weightedPolicyValue} from '../src/policy.mjs';
import {challengeRelay} from '../src/relay.mjs';
const inspect=createChampion().inspector;
const move=(playerId,x,y)=>({kind:'playerAction',playerId,action:'move',path:[{kind:'step',to:{x,y}}]});
test('relay retains complete incumbent dependencies and actual third-action risk',async()=>{
const state=E.buildScenario({teams:{A:'human',B:'human'},players:[
 {id:'carrier',team:'A',roster:'human',position:'lineman',at:[8,7],number:1},
 {id:'receiver',team:'A',roster:'human',position:'catcher',at:[9,7],number:2},
 {id:'helper',team:'A',roster:'human',position:'lineman',at:[5,5],number:3},
 {id:'risk',team:'A',roster:'human',position:'lineman',at:[5,9],number:4},
 {id:'foe',team:'B',roster:'human',position:'lineman',at:[5,10],number:1}],ball:{holder:'carrier'}},13);
const session=new Session(state,'A',1,60000),o=observe(state,'A',1),calls=[],services={};
for(const m of ['explore','validate','sequence'])services[m]=async(...args)=>{const r=callService(session,m,args);calls.push({method:m,args,ok:r?.ok});return r;};
// Discovery is explicitly emptied to isolate retention, not natural proposing.
services.candidates=async(...args)=>{calls.push({method:'candidates',args,controlled:true});return {ok:true,candidates:[],hasMore:false};};
services.threats={};for(const m of ['scoring','blitz'])services.threats[m]=async(...args)=>callService(session,'threats.'+m,args);
const options={observations:true,decisions:'builtin',maxOutcomes:40,maxLeaves:3500,threshold:.00001,maxMs:900};
const firstInput=move('helper',6,5),secondInput=move('carrier',8,6),thirdInput=move('risk',6,9);
const first=await services.explore(firstInput,options),second=await services.explore(secondInput,{...options,from:first.outcomes[0].key}),third=await services.explore(thirdInput,{...options,from:second.outcomes[0].key});
assert.ok(third.pTurnover>.24);
const selected={...inspect.canonical({input:firstInput},o),ex:first,preparedBranches:new Map([[first.outcomes[0].key,{plan:{input:secondInput},ex:second,preparedBranches:new Map([[second.outcomes[0].key,{plan:{input:thirdInput},ex:third}]])}]])};
const whole=policyFrom(selected,selected.preparedBranches,'A',inspect);selected.baseValue=weightedPolicyValue(whole,o,inspect);
const result=await challengeRelay(o,{mode:'normal',selected,lines:[selected]},services,inspect,Date.now()+18000);
const report={scope:'Real states, keys, own action probabilities and reply Engine services; empty candidate discovery is a controlled retention-isolation input, not natural strategy evidence',expected:{pTurnover:whole.ex.pTurnover,secondCost:whole.secondCost},result,calls};
assert.ok(result.policies.length);assert.ok(Math.abs(result.policies[0].pTurnover-whole.ex.pTurnover)<1e-10);
assert.equal(result.policies[0].structuralComplete,true);assert.equal(result.policies[0].ownPolicyDepth,2);
assert.equal(result.policies[0].transitions.length,2);
});
