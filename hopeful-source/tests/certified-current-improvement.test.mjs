import test from 'node:test';
import assert from 'node:assert/strict';
import {certifiedCurrentImprovement,compareCommonTurnPool,finiteDomainWinner} from '../src/common-turn-pool.mjs';
import {policyIdentity} from '../src/policy.mjs';
import {certifiedOwnEndPolicy} from '../src/protection.mjs';
const input=id=>({kind:'playerAction',playerId:id,action:'move',path:[]});
const own=(id,to=0,kind='playerAction',dependencies=null)=>{
 const i=kind==='playerAction'?input(id):{kind},tree={input:i,...(dependencies?{preparedBranches:dependencies}:{})};
 return {complete:true,tree,policy:{input:i,ex:{pTurnover:to}}};
};
const frame=(policies,bounds,unknown=policies.map(()=>0))=>({comparisonScope:'finite-common',valid:true,finiteDomainComparable:true,domainDiscoveryComplete:true,stoppedRPC:null,bounds,
 policies:policies.map((p,i)=>({input:p.tree.input,finiteDomainComparable:true,finiteUnknownChanceMass:unknown[i]}))});
const gate=(policies,bounds,anchors=[policies[0].tree,policies[0].tree],unknown)=>certifiedCurrentImprovement(frame(policies,bounds,unknown),policies,anchors);
test('overlapping strict improvements choose highest lower without claiming an all-peer winner',()=>{
 const p=[own('current'),own('a'),own('b')],b=[{lower:0,upper:10},{lower:12,upper:20},{lower:13,upper:21}];
 assert.equal(finiteDomainWinner(b,p,frame(p,b).policies),-1);
 const r=gate(p,b);assert.equal(r.selectedIndex,2);assert.deepEqual(r.protectedAnchorIndices,[0]);assert.ok(r.rows[1].passed&&r.rows[2].passed);assert.match(r.scope,/not an all-peer unique winner/);
});
test('current and original champion both require their unchanged strict margin',()=>{
 const p=[own('champion'),own('current'),own('candidate'),own('overlap')],b=[{lower:14,upper:20},{lower:0,upper:10},{lower:15,upper:25},{lower:14,upper:24}];
 assert.equal(gate(p,b,[p[1].tree,p[0].tree]).selectedIndex,-1);
 b[2].lower=20.5;assert.equal(gate(p,b,[p[1].tree,p[0].tree]).selectedIndex,-1);
 b[2].lower=20.500001;const r=gate(p,b,[p[1].tree,p[0].tree]);assert.equal(r.selectedIndex,2);assert.deepEqual(r.protectedAnchorIndices,[1,0]);
});
test('original request43 intervals admit A4 Move while all-peer ordering remains unresolved',()=>{
 const p=[own('current'),own('A4'),own('A3')],b=[{lower:130.43958933639536,upper:137.45680226909016},{lower:139.28346121970742,upper:146.35000000000002},{lower:137.53186504534375,upper:144.59000000000003}];
 const f=frame(p,b,[.004774900929736319,.004774900929736314,.004774900929736314]);
 assert.equal(finiteDomainWinner(b,p,f.policies),-1);const r=certifiedCurrentImprovement(f,p,[p[0].tree,p[0].tree]);assert.equal(r.selectedIndex,1);assert.equal(r.rows[1].peers[0].requiredMargin,.5);
});
test('original request57 preserves EndTurn four-point margin beside EndActivation half-point margin',()=>{
 const p=[own('current'),own(null,0,'endTurn'),own(null,0,'endActivation')],b=[{lower:143.38233440592688,upper:150.4932741769548},{lower:151.63571221041005,upper:158.75000000000003},{lower:151.63571221041005,upper:158.75000000000003}];
 const f=frame(p,b,[.004774900929736316,.004774900929736314,.004774900929736314]);
 assert.equal(finiteDomainWinner(b,p,f.policies),-1);const r=certifiedCurrentImprovement(f,p,[p[0].tree,p[0].tree]);assert.equal(r.selectedIndex,2);assert.equal(r.rows[1].passed,false);assert.equal(r.rows[1].peers[0].requiredMargin,4);
});
test('strict equality at base, turnover and unknown margins never admits a candidate',()=>{
 for(const [to,kind,unknown,margin] of [[0,'playerAction',0,.5],[0,'endTurn',0,4],[.1,'playerAction',0,7],[.1,'playerAction',.02,9.4]]){
  const p=[own('current'),own('candidate',to,kind)],b=[{lower:0,upper:0},{lower:margin,upper:margin+1}];
  assert.equal(gate(p,b,undefined,[0,unknown]).selectedIndex,-1);
  b[1].lower=margin+1e-6;const r=gate(p,b,undefined,[0,unknown]);assert.equal(r.selectedIndex,1);assert.equal(r.rows[1].peers[0].requiredMargin,margin);
 }
});
test('equal lower tie follows full dependency identity under every admission order',()=>{
 const c=own('current'),a=own('same',0,'playerAction',new Map([['success',{plan:{input:input('a')}}]])),b=own('same',0,'playerAction',new Map([['success',{plan:{input:input('b')}}]]));
 const expected=[a,b].sort((x,y)=>policyIdentity(x.tree)<policyIdentity(y.tree)?-1:1)[0];
 for(const p of [[c,a,b],[b,c,a],[a,b,c]]){
  const bounds=p.map(x=>x===c?{lower:0,upper:10}:{lower:12,upper:20}),r=gate(p,bounds,[c.tree,c.tree]);assert.equal(p[r.selectedIndex],expected);
 }
});
test('same first input with different dependencies cannot stand in for the protected anchor',()=>{
 const c=own('current',0,'playerAction',new Map([['s',{plan:{input:input('real')}}]])),lookalike=own('current',0,'playerAction',new Map([['s',{plan:{input:input('other')}}]])),a=own('a');
 const p=[lookalike,a],r=gate(p,[{lower:0,upper:10},{lower:12,upper:20}],[c.tree,c.tree]);assert.equal(r.valid,false);assert.equal(r.selectedIndex,-1);assert.match(r.reason,/anchor-missing/);
});
test('missing, duplicate or incomplete anchor cannot open the new gate',()=>{
 const c=own('current'),a=own('a'),b=own('b'),bounds=[{lower:0,upper:10},{lower:12,upper:20},{lower:13,upper:21}];
 for(const anchors of [[c.tree,null],[null,c.tree],[c.tree]])assert.equal(gate([c,a,b],bounds,anchors).selectedIndex,-1);
 c.complete=false;assert.equal(gate([c,a,b],bounds).valid,false);c.complete=true;
 const duplicate=own('current');assert.equal(gate([c,duplicate,a],bounds).valid,false);
});
test('every frame incompleteness, first RPC stop and missing peer unknown remains a refusal',()=>{
 const p=[own('current'),own('a'),own('b')],bounds=[{lower:0,upper:10},{lower:12,upper:20},{lower:13,upper:21}];
 for(const change of [{valid:false},{comparisonScope:'global'},{finiteDomainComparable:false},{domainDiscoveryComplete:false},{stoppedRPC:{code:'timeout'}},{stoppedRPC:{code:'coach-resource-budget'}}]){
  const f={...frame(p,bounds),...change};assert.equal(certifiedCurrentImprovement(f,p,[p[0].tree,p[0].tree]).selectedIndex,-1);
 }
 for(const value of [undefined,null,NaN,Infinity,-.01,1.01]){const f=frame(p,bounds);f.policies[2].finiteUnknownChanceMass=value;assert.equal(certifiedCurrentImprovement(f,p,[p[0].tree,p[0].tree]).valid,false);}
 for(const value of [undefined,NaN,-.01,1.01]){const q=[own('current'),own('a'),own('b')];q[2].policy.ex.pTurnover=value;assert.equal(certifiedCurrentImprovement(frame(q,bounds),q,[q[0].tree,q[0].tree]).valid,false);}
 const f=frame(p,bounds);f.policies[2].finiteDomainComparable=false;assert.equal(certifiedCurrentImprovement(f,p,[p[0].tree,p[0].tree]).valid,false);
});
test('selection keeps all peer unknown and source-bound input alignment without mutation',()=>{
 const p=[own('current'),own('a'),own('b')],bounds=[{lower:0,upper:10},{lower:12,upper:20},{lower:13,upper:21}],f=frame(p,bounds,[.01,.02,.02]),before=JSON.stringify([f,p]);
 const r=certifiedCurrentImprovement(f,p,[p[0].tree,p[0].tree]);assert.equal(r.selectedIndex,2);assert.equal(r.rows[2].peers[0].unknownIncrement,1.2);assert.equal(JSON.stringify([f,p]),before);
 f.policies[2].input=input('foreign');assert.equal(certifiedCurrentImprovement(f,p,[p[0].tree,p[0].tree]).valid,false);
});

// Pure source-bound mock graph: the unknown reply chance widens every interval.
// This neither runs native nor asserts that a time allowance completes search.
function fixture(values){
 const o={requestId:1,team:'A',active:'A',phase:'play',half:1,drive:1,score:{A:0,B:0},turn:{A:1,B:1},turnsPerHalf:8,pitch:{width:26,height:15},ball:{kind:'ground',pos:{x:3,y:3}},players:[{id:'enemy',team:'B',location:'pitch',stance:'standing',pos:{x:20,y:3},ma:6,st:3,ag:3,skills:[],activated:false,canBeActivated:true}]};
 const states=new Map();let seq=0;
 const inspect={CFG:{touchdown:1500,possession:160,carrierTurnover:95,turnover:62,unresolved:120,optionalRush:12},canonical:x=>x,boardValue:ob=>ob.value??0,outcomeValue:e=>({value:e.outcomes.reduce((s,b)=>s+b.p*(b.observation.value??0),0)})};
 const make=(from,team,ob,unknown=0)=>{const key='s'+(++seq);states.set(key,ob);return {ok:true,position:{key:from},perspective:'A',activeTeam:team,outcomeIdentity:'complete-state-v1',decisionPolicy:{mode:'builtin',own:'builtin',opponent:'builtin'},exact:unknown===0,enumerated:1-unknown,unresolvedMass:unknown,rest:{p:unknown},pTurnover:0,pTouchdown:0,pOpponentTouchdown:0,outcomes:[{key,p:1-unknown,active:ob.active,observation:ob,turnover:false,completed:true}]};};
 const line=id=>({input:input(id),ex:make('root','A',{...o,active:'B',actor:id,value:values[id]})});
 const services={validate:async(i,q={})=>({ok:true,legal:true,position:q.from??'root'}),explore:async(i,q)=>make(q.from,q.team,{...states.get(q.from),active:'A',activation:null},.002),
  candidates:async q=>{const rows=q.families.length===1?[]:[{legal:true,input:input('enemy'),kind:'move'}];return {ok:true,position:{key:q.from},offset:0,limit:q.limit,total:rows.length,returned:rows.length,complete:true,hasMore:false,nextOffset:null,truncated:[],pool:{generated:rows.length,afterFilters:rows.length,afterLimits:rows.length,droppedByFilters:0},candidates:rows};},fork:{open:async q=>({ok:true,revisionBound:true,from:q.from,fork:'f',node:'terminal',position:'terminal',completed:true,turnover:false}),close:async()=>({ok:true}),step:async()=>null}};
 const run=async()=>{const c=line('current');return compareCommonTurnPool(o,{mode:'normal',selected:c,lines:[c]},c,[line('a'),line('b')],services,inspect,30000,{comparisonScope:'finite-common'});};
 return {run,o,inspect};
}
test('common pool returns a privately certified improvement with separate selection and winner fields',async t=>{
 t.mock.method(Date,'now',()=>0);const f=fixture({current:20,a:30,b:31}),r=await f.run();
 assert.ok(r.selected,r.reason);assert.equal(r.selected.input.playerId,'b');assert.equal(r.selectionBasis,'strict-protected-current-improvement');assert.equal(r.winnerIndex,-1);assert.equal(Object.hasOwn(r,'winnerCandidateId'),false);
 assert.equal(r.selectedIndex,r.rows.find(x=>x.input.playerId==='b').ownIndex);assert.equal(r.selectedCandidateId,r.rows.find(x=>x.input.playerId==='b').candidateId);assert.equal(r.comparisonEvidence.rows[r.selectedIndex].passed,false);
 assert.match(r.reason,/not-all-peer-unique-winner; outside-policies-unverified/);assert.ok(certifiedOwnEndPolicy(r.selected,f.o,f.inspect));assert.ok(r.endpointFrame.policies.every(x=>x.finiteUnknownChanceMass>0&&x.outsidePoliciesUnverified));
});
test('original unique all-peer winner remains preferred and retains its winner attribution',async t=>{
 t.mock.method(Date,'now',()=>0);const f=fixture({current:20,a:30,b:100}),r=await f.run();
 assert.equal(r.selected?.input.playerId,'b',r.reason);assert.equal(r.selectionBasis,'strict-all-peer-winner');assert.equal(r.winnerIndex,r.selectedIndex);assert.equal(r.winnerCandidateId,r.selectedCandidateId);assert.equal(Object.hasOwn(r,'protectedCurrentGate'),false);assert.match(r.reason,/strict-shared-finite-domain-winner/);
});
