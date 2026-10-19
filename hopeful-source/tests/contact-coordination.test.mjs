import test from 'node:test';import assert from 'node:assert/strict';
import {E,Session,callService,observe} from './deps/archived-v6-host.mjs';
import {discoverContactCoordination} from '../src/contact-coordination.mjs';
import {createChampion} from '../src/champion.mjs';
const inspect=createChampion().inspector;
function fixture(){
 const state=E.buildScenario({teams:{A:'human',B:'human'},players:[
 {id:'carrier',team:'A',roster:'human',position:'lineman',at:[7,7],number:1},
 {id:'helper',team:'A',roster:'human',position:'blitzer',at:[8,5],number:2},
 {id:'foe',team:'B',roster:'human',position:'lineman',at:[9,5],number:1}],ball:{holder:'carrier'}},7);
 const session=new Session(state,'A',1,60000),calls=[],services={fork:{}};
 for(const name of ['explore','validate','candidates'])services[name]=async(...args)=>{const value=callService(session,name,args);calls.push({name,args,value});return value;};
 for(const method of ['open','step','close'])services.fork[method]=async(...args)=>callService(session,'fork.'+method,args);
 return {state,o:observe(state,'A',1),services,calls};
}
test('contact proposals never claim a local winner and refuse unavailable carrier or unverified discovery',async()=>{
 const f=fixture();const spent=structuredClone(f.o);spent.players.find(p=>p.id==='carrier').activated=true;spent.players.find(p=>p.id==='carrier').canBeActivated=false;
 const blocked=await discoverContactCoordination(spent,{mode:'normal'},[],f.services,inspect,Date.now()+10000);
 assert.equal(blocked.attempted,false);assert.equal(f.calls.length,0);
 const unknown=await discoverContactCoordination(f.o,{mode:'normal'},[],{candidates:async()=>({ok:false})},inspect,Date.now()+10000);
 assert.equal(unknown.selected,null);assert.equal(unknown.policyTrees.length,0);assert.match(unknown.reason,/unverified/);
});
test('real contact chance is followed only through legal closure and current source-bound carrier inputs',async()=>{
 const f=fixture(),r=await discoverContactCoordination(f.o,{mode:'normal'},[],f.services,inspect,Date.now()+10000);
 assert.equal(r.selected,null);assert.ok(r.discovered>0);assert.ok(f.calls.some(q=>q.name==='explore'&&['block','blitz'].includes(q.args[0].action)));
 for(const tree of r.policyTrees){assert.ok(tree.ex.outcomes.some(b=>b.turnover),'actual contact failure stays in root chance');
 assert.ok(tree.preparedBranches.size>0);assert.ok(tree.ruleMap);}
 assert.ok(r.policyTrees.length>0,JSON.stringify(r.checks));
 assert.ok(f.calls.some(q=>q.name==='validate'&&q.args[0].kind==='endActivation'&&q.args[1].from));
 assert.ok(f.calls.some(q=>q.name==='explore'&&q.args[0].playerId==='carrier'&&q.args[1].from!=='root'));
});
