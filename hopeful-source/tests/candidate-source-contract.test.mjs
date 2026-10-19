import test from 'node:test';
import assert from 'node:assert/strict';
import {E,Session,callService,observe} from './deps/archived-v6-host.mjs';
import {compareCarrierReplies} from '../src/carrier-replies.mjs';
import {buildProtectionPolicy} from '../src/protection.mjs';
import {createChampion} from '../src/champion.mjs';
import {auditCommonBoundary} from '../src/common-boundary.mjs';
const inspect=createChampion().inspector;
function fixture(){
 const state=E.buildScenario({teams:{A:'human',B:'human'},players:[
  {id:'carrier',team:'A',roster:'human',position:'lineman',at:[7,7],number:1},
  {id:'guard',team:'A',roster:'human',position:'lineman',at:[5,5],number:2},
  {id:'foe',team:'B',roster:'human',position:'lineman',at:[12,7],number:1}],ball:{holder:'carrier'}},7);
 const session=new Session(state,'A',1,60000),calls=[],services={fork:{}};
 for(const name of ['explore','validate','candidates'])services[name]=async(...args)=>{const value=callService(session,name,args);calls.push({name,args,value});return value;};
 for(const method of ['open','step','close'])services.fork[method]=async(...args)=>callService(session,'fork.'+method,args);
 return {state,o:observe(state,'A',1),services,calls};
}
test('real candidates object position permits source-bound protector continuation',async()=>{
 const f=fixture(),input={kind:'playerAction',playerId:'carrier',action:'move',path:[{kind:'step',to:{x:8,y:7}}]};
 const r=await buildProtectionPolicy(f.o,{input},f.services,inspect,Date.now()+10000,{extend:true});
 assert.equal(r.complete,true,r.reason);assert.ok(f.calls.some(q=>q.name==='candidates'&&q.value.position?.key));
 assert.ok(r.tree.preparedBranches.size>0,'A real legal protector move must not be rejected as a foreign source');
});
test('real opponent candidates object position reaches contact validation and exploration',async()=>{
 const f=fixture(),end=await f.services.explore({kind:'endTurn'},{from:'root',team:'A',perspective:'A',observations:true,decisions:'builtin',maxMs:500});
 assert.equal(end.ok,true);assert.equal(end.outcomes.length,1);
 const r=await compareCarrierReplies(f.o,[{input:{kind:'endTurn'},endpoints:end.outcomes}],f.services,inspect,Date.now()+10000);
 assert.ok(r.domain.some(row=>row.contact),'Legal real contact proposals must enter the finite domain');
 assert.ok(f.calls.some(q=>q.name==='validate'&&q.args[1].team==='B'));
 assert.ok(f.calls.some(q=>q.name==='explore'&&q.args[1].team==='B'));
});

test('certified native Own-End reuse avoids another closure with equal value and retains reply unknown',async()=>{
 const f=fixture(),ins={...inspect,replyAssessment:async()=>({failed:false,unknown:true,essentialComplete:false,criticalAdjustment:-5,positionAdjustment:0})};
 const input={kind:'playerAction',playerId:'carrier',action:'move',path:[{kind:'step',to:{x:8,y:7}}]};
 const bound=await buildProtectionPolicy(f.o,{input},f.services,ins,Date.now()+10000);
 assert.equal(bound.complete,true,bound.reason);
 const at=f.calls.length;
 const reused=await auditCommonBoundary(f.o,{mode:'normal',selected:bound.tree,lines:[bound.tree]},bound.tree,f.services,ins,Date.now()+10000);
 assert.equal(reused.pool[0].certified_own_end_reused,true);
 assert.equal(f.calls.slice(at).filter(c=>c.name==='explore'&&c.args[0].kind==='endTurn').length,0);
 const clone={...bound.tree},start=f.calls.length;
 const uncached=await auditCommonBoundary(f.o,{mode:'normal',selected:clone,lines:[clone]},clone,f.services,ins,Date.now()+10000);
 assert.equal(uncached.pool[0].certified_own_end_reused,false);
 assert.ok(f.calls.slice(start).some(c=>c.name==='explore'&&c.args[0].kind==='endTurn'));
 assert.equal(reused.pool[0].endpoint_value,uncached.pool[0].endpoint_value);
 assert.equal(reused.pool[0].own_turnover,uncached.pool[0].own_turnover);
 assert.equal(reused.pool[0].reply_unknown,1);assert.equal(reused.action_executed,false);
});
