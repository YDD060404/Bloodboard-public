import test from 'node:test';
import assert from 'node:assert/strict';
import {compareOpponentEndValues} from '../src/opponent-end-values.mjs';
import {stableDataKey} from '../src/policy.mjs';

// Pure source-bound service fixtures, never an engine proof or teacher label.
const move=(id,n=1)=>({kind:'playerAction',playerId:id,action:'move',path:Array.from({length:n},(_,i)=>({kind:'step',to:{x:10-i,y:7}}))});
const block={kind:'playerAction',playerId:'B5',action:'block',path:[],blockTarget:'own-a'};
const blitz={kind:'playerAction',playerId:'B7',action:'blitz',path:[{kind:'step',to:{x:10,y:6}}],blockTarget:'own-a',blitzTarget:'own-a'};
const row=input=>({legal:true,kind:input.action,input});
const page=(q,rows,total=rows.length)=>({ok:true,position:{key:q.from},offset:0,limit:q.limit,total,returned:rows.length,
 hasMore:rows.length<total,nextOffset:rows.length<total?rows.length:null,complete:true,
 pool:{generated:total,afterFilters:total,afterLimits:total,droppedByFilters:0},
 truncated:rows.length<total?[{reason:'page',nextOffset:rows.length}]:[],candidates:rows});
function fixture({candidateHook=null,validationHook=null,unknown=0,ready=true}={}){
 const player=(id,team)=>({id,team,location:'pitch',stance:'standing',pos:{x:team==='A'?8:12,y:id==='B7'?8:7},ma:6,st:3,ag:3,skills:[],activated:false,tackleZone:true,canBeActivated:team==='B'?ready:true});
 const root={requestId:100,team:'A',active:'A',phase:'play',half:1,drive:1,score:{A:0,B:0},turn:{A:1,B:1},turnsPerHalf:8,
  pitch:{width:26,height:15},ball:{kind:'ground',pos:{x:10,y:7}},players:[player('own-a','A'),player('own-z','A'),player('B5','B'),player('B7','B')]};
 const inspect={CFG:{touchdown:1500,possession:160,carrierTurnover:95,turnover:62,optionalRush:12},boardValue:ob=>ob.value??0};
 const own=['own-a','own-z'].map((id,i)=>{const input=move(id),key=id+'-source',observation={...root,active:'B',value:20+i*20};
  return {complete:true,tree:{input},policy:{input,secondCost:0},endpoints:[{key,p:1,active:'B',observation,turnover:false,touchdown:null}]};});
 const sources=new Map(own.map(o=>[o.endpoints[0].key,o.endpoints[0].observation])),queries=[],validations=[],explorations=[];
 const services={
  candidates:async q=>{queries.push(q);const main=q.families.length>1;
   const rows=main?Array.from({length:12},(_,i)=>row(move('B5',i+1))):[row(q.families[0]==='block'?block:blitz)];
   const response=page(q,rows);return candidateHook?candidateHook(q,response,queries.length):response;},
  validate:async(input,q)=>{validations.push({input,q});assert.ok(sources.has(q.from));
   const response={ok:true,position:q.from,legal:true};return validationHook?validationHook(input,q,response):response;},
  explore:async(input,q)=>{explorations.push({input,q});const source=sources.get(q.from);assert.ok(source);
   const p=input.kind==='endTurn'?1:1-unknown;
   return {ok:true,position:{key:q.from},perspective:'A',activeTeam:'B',outcomeIdentity:'complete-state-v1',
    decisionPolicy:{mode:'builtin',own:'builtin',opponent:'builtin'},exact:p===1,enumerated:p,unresolvedMass:1-p,rest:{p:1-p},
    pTurnover:0,pTouchdown:0,pOpponentTouchdown:0,
    outcomes:[{key:q.from+':'+input.action,p,active:'A',observation:{...source,active:'A',activation:null},turnover:false,touchdown:null}]};}
 };
 const run=(policies=own,scope='finite-common',deadline=10000)=>compareOpponentEndValues(root,policies,services,inspect,deadline,{comparisonScope:scope});
 return {root,own,inspect,services,queries,validations,explorations,run};
}

test('finite discovery completes original main peer round before bounded Block and Blitz peer rounds',async t=>{
 t.mock.method(Date,'now',()=>0);const f=fixture(),r=await f.run();
 assert.deepEqual(f.queries.map(q=>[q.families.length>1?'main':q.families[0],q.from]),[
  ['main','own-a-source'],['main','own-z-source'],['block','own-a-source'],['block','own-z-source'],['blitz','own-a-source'],['blitz','own-z-source']]);
 assert.deepEqual(f.queries.map(q=>[q.limit,q.sort]),[[12,'goalDistance'],[12,'goalDistance'],[4,'steps'],[4,'steps'],[4,'steps'],[4,'steps']]);
 assert.ok(f.queries.every(q=>q.team==='B'&&q.precision==='none'&&q.maxRushes===2&&q.maxMs===200));
 assert.equal(r.domainDiscoveryComplete,true);assert.equal(r.finiteDomainComparable,true);assert.equal(r.domain.length,3);
 assert.deepEqual(new Set(r.domain.map(i=>i.action)),new Set(['move','block','blitz']));
 assert.equal(r.domainPruning.unrepresentedVariants,11);assert.equal(r.domainPruning.cappedRepresentatives,0);assert.equal(r.domainPruning.equivalenceClaimed,false);
 assert.equal(r.replyClosureBranchLimit,64);assert.ok(f.explorations.every(({q})=>q.maxLeaves===512&&q.maxOutcomes===128&&q.maxKeep===256&&q.threshold===1e-6&&q.maxMs===1200&&q.decisions==='builtin'));
});

test('union identity dictionary records all actual source pages once without multiplying reply dispatches',async t=>{
 t.mock.method(Date,'now',()=>0);const f=fixture(),r=await f.run(),d=r.domainDiscovery;
 assert.equal(d.plannedPages,6);assert.equal(d.observedPages,6);assert.equal(d.unionSources.length,14);
 assert.equal(new Set(d.unionSources.map(x=>x.inputIdentity)).size,14);
 for(const input of r.domain){const identity=stableDataKey(input),entry=d.unionSources.find(x=>x.inputIdentity===identity);
  assert.ok(entry);assert.equal(entry.domainIndex,r.domain.findIndex(x=>stableDataKey(x)===identity));assert.equal(entry.sourcePageIds.length,2);
  for(const pageId of entry.sourcePageIds){const p=d.pages.find(x=>x.pageId===pageId);assert.ok(p.unionInputIds.includes(entry.inputId));assert.equal(p.responseFrom,p.from);}
 }
 assert.equal(f.explorations.filter(x=>x.input.kind!=='endTurn').length,6);
 assert.ok(d.unionSources.filter(x=>x.domainIndex===null).length===11);
});

test('native hasMore retains actual page counts and unsearched scope without rejecting a completed planned page',async t=>{
 t.mock.method(Date,'now',()=>0);const f=fixture({candidateHook:(q,r)=>q.families.length>1?page(q,r.candidates,40):r}),r=await f.run();
 assert.equal(r.domainDiscoveryComplete,true);assert.equal(r.finiteDomainComparable,true);assert.equal(r.domainDiscovery.hasUnsearchedPages,true);
 const main=r.domainDiscovery.pages.filter(p=>p.plan==='main');assert.ok(main.every(p=>p.returned===12&&p.total===40&&p.hasMore&&p.nextOffset===12&&p.pool.afterLimits===40));
 assert.match(r.domainDiscovery.scope,/not all native inputs/);assert.ok(r.policies.every(p=>p.outsidePoliciesUnverified));
});

test('an endpoint-specific Block remains in union and actual illegal proof prevents explore only at that source',async t=>{
 t.mock.method(Date,'now',()=>0);const f=fixture({validationHook:(i,q,r)=>i.action==='block'&&q.from==='own-z-source'?{...r,legal:false}:r}),r=await f.run();
 assert.ok(r.domain.some(i=>i.action==='block'));assert.equal(r.finiteDomainComparable,true);
 assert.equal(f.explorations.filter(x=>x.input.action==='block'&&x.q.from==='own-z-source').length,0);
 assert.equal(f.explorations.filter(x=>x.input.action==='block'&&x.q.from==='own-a-source').length,1);
 assert.ok(r.policies.every(p=>p.domainChecked[0].checked===3&&p.domainChecked[0].unknown===0));
});

test('unknown endpoint legality never substitutes for illegal proof or a complete shared frame',async t=>{
 t.mock.method(Date,'now',()=>0);const f=fixture({validationHook:(i,q,r)=>i.action==='block'&&q.from==='own-z-source'?{...r,legal:undefined}:r}),r=await f.run();
 assert.equal(r.domainDiscoveryComplete,true);assert.equal(r.finiteDomainComparable,false);assert.equal(r.policies[1].domainChecked[0].unknown,1);
 assert.equal(f.explorations.filter(x=>x.input.action==='block'&&x.q.from==='own-z-source').length,0);
});

for(const field of ['candidates','offset','limit','total','returned','complete','hasMore','nextOffset','truncated','pool'])
 test('missing actual candidate page '+field+' refuses planned discovery rather than inventing empty success',async t=>{
  t.mock.method(Date,'now',()=>0);const f=fixture({candidateHook:(q,r)=>{if(q.families[0]==='block'){r={...r};delete r[field];}return r;}}),r=await f.run();
  assert.equal(r.domainDiscoveryComplete,false);assert.equal(r.finiteDomainComparable,false);
  assert.ok(r.domainDiscovery.pages.filter(p=>p.plan==='block').every(p=>p.status==='unverified'));
  assert.equal(r.stoppedRPC,null);
 });

test('response from a different source is retained as unverified evidence, never merged into union',async t=>{
 t.mock.method(Date,'now',()=>0);const f=fixture({candidateHook:(q,r)=>q.families[0]==='block'?{...r,position:{key:'foreign'}}:r}),r=await f.run();
 assert.equal(r.domainDiscoveryComplete,false);assert.ok(!r.domain.some(i=>i.action==='block'));
 assert.ok(r.domainDiscovery.pages.filter(p=>p.plan==='block').every(p=>p.responseFrom==='foreign'&&p.from!=='foreign'&&p.status==='unverified'));
});

test('returned count mismatch and complete false are explicit page incompleteness',async t=>{
 t.mock.method(Date,'now',()=>0);
 for(const changed of [{returned:0},{complete:false}]){
  const f=fixture({candidateHook:(q,r)=>q.families[0]==='blitz'?{...r,...changed}:r}),r=await f.run();
  assert.equal(r.domainDiscoveryComplete,false);assert.equal(r.finiteDomainComparable,false);
  assert.ok(r.domainDiscovery.pages.filter(p=>p.plan==='blitz').every(p=>p.status!== 'observed'));
 }
});

test('deadline after first real main page records the remaining planned slots as skipped without an RPC failure',async t=>{
 let now=0;t.mock.method(Date,'now',()=>now);const f=fixture({candidateHook:(q,r,n)=>{if(n===1)now=4501;return r;}}),r=await f.run(f.own,'finite-common',5000);
 assert.equal(f.queries.length,1);assert.equal(r.domainDiscovery.plannedPages,6);assert.equal(r.domainDiscovery.observedPages,1);
 assert.equal(r.domainDiscovery.pages.filter(p=>p.status==='skipped').length,5);assert.equal(r.domainDiscoveryComplete,false);assert.equal(r.finiteDomainComparable,false);assert.equal(r.stoppedRPC,null);
});

for(const code of ['coach-resource-budget','timeout'])test('first real '+code+' candidate refusal retains original stop classification and issues no later discovery RPC',async t=>{
 t.mock.method(Date,'now',()=>0);const f=fixture({candidateHook:(q,r)=>q.families[0]==='block'?{ok:false,code}:r}),r=await f.run();
 assert.equal(f.queries.length,3);assert.equal(r.stoppedRPC.code,code);assert.equal(r.stoppedRPC.method,'candidates');assert.equal(r.domainDiscoveryComplete,false);
 assert.equal(r.domainDiscovery.pages.filter(p=>p.status==='skipped').length,3);assert.ok(r.domainDiscovery.pages.find(p=>p.responseCode===code));
 assert.equal(f.explorations.filter(x=>x.input.kind!=='endTurn').length,0);
});

test('candidate exception follows the inherited first-stop path and never produces a zero-cost empty page',async t=>{
 t.mock.method(Date,'now',()=>0);const f=fixture({candidateHook:(q,r)=>{if(q.families[0]==='blitz')throw Error('fixture');return r;}}),r=await f.run();
 assert.equal(f.queries.length,5);assert.equal(r.stoppedRPC.code,'service-exception');assert.equal(r.domainDiscoveryComplete,false);assert.equal(r.finiteDomainComparable,false);
});

test('canonical peer order and domain identity survive admission-order permutation without borrowed source keys',async t=>{
 t.mock.method(Date,'now',()=>0);const a=fixture(),b=fixture(),r=await a.run(),s=await b.run(b.own.slice().reverse());
 assert.deepEqual(a.queries,b.queries);assert.equal(r.domainId,s.domainId);
 assert.deepEqual(r.bounds,s.bounds.slice().reverse());
 assert.ok(a.validations.every(({q})=>a.own.some(p=>p.endpoints[0].key===q.from)));
});

test('real incomplete chance keeps finite bounds and unknown under the unchanged reply horizon',async t=>{
 t.mock.method(Date,'now',()=>0);const f=fixture({unknown:.25}),r=await f.run();
 assert.equal(r.finiteDomainComparable,true);assert.ok(r.policies.every(p=>p.finiteUnknownChanceMass===.25));
 assert.ok(r.bounds.every(b=>b.lower<b.upper));assert.ok(r.policies.every(p=>p.reasons.includes('reply-unpriced-chance-mass')));
});

test('the existing D8 cap remains binding when bounded contact pages introduce more actor-target representatives',async t=>{
 t.mock.method(Date,'now',()=>0);const f=fixture({candidateHook:(q,r)=>q.families.length===1?page(q,Array.from({length:4},(_,i)=>row({...r.candidates[0].input,blockTarget:'target'+i,...(q.families[0]==='blitz'?{blitzTarget:'target'+i}:{})}))):r}),r=await f.run();
 assert.equal(r.domain.length,8);assert.equal(r.domainPruning.cappedRepresentatives,1);assert.equal(r.domainPruning.equivalenceClaimed,false);assert.ok(r.policies.every(p=>p.domainChecked[0].checked===8));
});

test('global comparison retains its original single discovery page and original explore parameters',async t=>{
 t.mock.method(Date,'now',()=>0);const f=fixture(),r=await f.run(f.own,'global');
 assert.equal(f.queries.length,2);assert.ok(f.queries.every(q=>q.families.length===6&&q.limit===12&&q.sort==='goalDistance'&&q.maxRushes===0));
 assert.equal(r.domainDiscovery.plans.length,1);assert.equal(r.replyClosureBranchLimit,null);
 assert.ok(f.explorations.every(({q})=>q.maxLeaves===64&&q.maxOutcomes===40&&q.maxMs===450));assert.ok(r.globalBounds.every(b=>b.lower<=-1660));
});

test('actual End-only source with no activatable opponent needs no discovery pages and preserves the original finite contract',async t=>{
 t.mock.method(Date,'now',()=>0);const f=fixture({ready:false}),r=await f.run();
 assert.equal(f.queries.length,0);assert.equal(r.domainDiscovery.plannedPages,0);assert.equal(r.domain.length,0);assert.equal(r.domainDiscoveryComplete,true);assert.equal(r.finiteDomainComparable,true);
});


test('empty contact pages with actual full metadata complete the plan without invented contact inputs',async t=>{
 t.mock.method(Date,'now',()=>0);const f=fixture({candidateHook:(q,r)=>q.families.length===1?page(q,[]):r}),r=await f.run();
 assert.equal(r.domainDiscoveryComplete,true);assert.equal(r.finiteDomainComparable,true);assert.equal(r.domain.length,1);
 assert.ok(r.domainDiscovery.pages.filter(p=>p.plan!=='main').every(p=>p.status==='observed'&&p.returned===0&&p.total===0&&p.complete===true));
 assert.equal(f.explorations.filter(x=>x.input.kind!=='endTurn').length,2);
});

test('native materialisation may return zero legal records below limit with remaining page stubs',async t=>{
 t.mock.method(Date,'now',()=>0);const f=fixture({candidateHook:(q,r)=>q.families[0]==='block'?page(q,[],20):r}),r=await f.run();
 assert.equal(r.domainDiscoveryComplete,true);assert.equal(r.finiteDomainComparable,true);
 assert.ok(r.domainDiscovery.pages.filter(p=>p.plan==='block').every(p=>p.returned===0&&p.limit===4&&p.total===20&&p.hasMore===true&&p.nextOffset===0));
 assert.equal(r.domainDiscovery.hasUnsearchedPages,true);assert.ok(!r.domain.some(i=>i.action==='block'));assert.equal(f.queries.length,6);
});
