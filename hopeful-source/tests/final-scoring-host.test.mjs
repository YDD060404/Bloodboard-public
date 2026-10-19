import test from 'node:test';import assert from 'node:assert/strict';
import {E,observe,Session,callService} from './deps/archived-v6-host.mjs';
import {verifiedFixture} from '../scripts/test-deps.mjs';
import {createChampion} from '../src/champion.mjs';
import {createScoringDiscovery,scoringPolicyBounds,scoringRuleScope,challengeFinalScoring} from '../src/scoring.mjs';
const fixture=JSON.parse(verifiedFixture('my-ball-final-scoring.json')),champion=createChampion(),inspect=champion.inspector;
const options={observations:true,decisions:'builtin',perspective:'A',maxOutcomes:40,maxKeep:256,maxLeaves:3500,threshold:.0001,maxMs:1300};
async function setup(){const state=structuredClone(fixture.prestate),o=observe(state,'A',1),session=new Session(state,'A',1,60000),sv={},calls=[];
 for(const m of ['candidates','explore','validate'])sv[m]=async(...a)=>{const r=callService(session,m,a);calls.push({m,a,r});return r;};
 sv.threats={scoring:async(...a)=>{const r=callService(session,'threats.scoring',a);calls.push({m:'scoring',a,r});return r;}};
 const ex=await sv.explore(fixture.standingInput,options),b=ex.outcomes.find(b=>!b.turnover&&b.observation?.ball?.playerId==='fox'),route={kind:'playerAction',playerId:'fox',action:'move',path:[23,24,25].map(x=>({kind:'step',to:{x,y:7}}))},follow=await sv.explore(route,{...options,from:b.key});
 assert.equal(follow.pTouchdown,1);const selected={...inspect.canonical({input:fixture.standingInput},o),ex,preparedBranches:new Map([[b.key,{plan:{input:route},ex:follow}]])};
 const discovery=createScoringDiscovery(o,fixture.native),query={players:['passer'],families:['move','blitz'],sort:'goalDistance',precision:'none',limit:100,maxMs:800},q=await sv.candidates(query);discovery.observe(query,q);
 return {state,o,session,sv,calls,selected,b,discovery,query,q,snapshot:{mode:'final-turn',selected,lines:[selected]}};
}
test('real known scoring policy retains conservative bounds and null active remains unknown',async()=>{
 const f=await setup(),r=scoringPolicyBounds(f.selected,'A',inspect);assert.equal(r.valid,true);assert.ok(Math.abs(r.lower-.1636284722222222)<1e-10);assert.ok(Math.abs(r.upper-.23190366294018494)<1e-10);
 const missing=structuredClone(f.selected);missing.preparedBranches.clear();const b=missing.ex.outcomes.find(b=>b.key===f.b.key);b.key=null;b.active=null;delete b.observation;
 const unknown=scoringPolicyBounds(missing,'A',inspect);assert.equal(unknown.valid,true);assert.equal(unknown.lower,0);assert.ok(Math.abs(unknown.upper-r.upper)<1e-10);
});
test('probability inconsistency, malformed flags, duplicate key and wrong child parent refuse scoring certification',async()=>{
 const f=await setup();for(const change of [c=>{c.ex.rest.p=1;c.ex.unresolvedMass=1;},c=>c.ex.unresolvedMass=-.1,c=>c.ex.outcomes[1].key=f.b.key,c=>c.preparedBranches.get(f.b.key).ex.position.key='root',c=>c.ex.outcomes[0].turnover='yes',c=>c.ex.activeTeam='B',c=>c.ex.position.key='wrong-root',c=>c.input.action='blitz',c=>c.preparedBranches.get(f.b.key).plan.input.action='block']){
  const bad=structuredClone(f.selected);change(bad);assert.equal(scoringPolicyBounds(bad,'A',inspect).valid,false);
 }
});
test('real missing My Ball move-pass clears complete incumbent scoring upper bound without altering old candidate list',async()=>{
 const f=await setup(),nativeBefore=structuredClone(fixture.native),r=await challengeFinalScoring(f.o,f.snapshot,f.discovery,f.sv,inspect,Date.now()+12000);
 assert.ok(r.selected,r.reason);assert.equal(r.selected.input.action,'pass');assert.equal(r.selected.input.path.length,5);assert.equal(r.selected.input.passTarget.x,22);
 assert.ok(r.evidence.alternative.lower>r.evidence.current.upper+.07);assert.equal(r.evidence.ordinaryValueNotUsed,true);assert.equal(r.evidence.ruleScope.certified,true);
 assert.deepEqual(fixture.native,nativeBefore);assert.deepEqual(E.validateInput(f.state,r.selected.input),[]);assert.equal(r.selected.preparedBranches.size,1);
 for(const [key,follow]of r.selected.preparedBranches){assert.equal(follow.ex.position.key,key);assert.equal(follow.ex.pTouchdown,1);assert.equal(follow.ex.rest.p,0);}
});
test('no ball, unavailable receiver, nonfinal clock and nonroot/failed discovery cannot create a missing proposal',async()=>{
 const f=await setup();for(const change of [o=>o.players.find(p=>p.id==='fox').skills.push('noBall'),o=>o.players.find(p=>p.id==='fox').activated=true,o=>o.turn.A--,o=>o.players.find(p=>p.id==='passer').skills.push('myBall')]){const o=structuredClone(f.o);change(o);const d=createScoringDiscovery(o,fixture.native);d.observe(f.query,f.q);assert.equal(d.proposals(inspect).length,0);}
 for(const [q,r] of [[{...f.query,from:'other'},f.q],[f.query,{...f.q,position:{key:'other'}}],[f.query,{ok:false,candidates:f.q.candidates}]]){const d=createScoringDiscovery(f.o,[]);d.observe(q,r);assert.equal(d.proposals(inspect).length,0);}
});
test('certain-TD and budget protection, failed scoring discovery and occupied receiver activation preserve original',async()=>{
 const f=await setup();for(const mode of ['certain-td','normal']){const r=await challengeFinalScoring(f.o,{...f.snapshot,mode},f.discovery,f.sv,inspect,Date.now()+12000);assert.equal(r.selected,null);assert.equal(r.attempted,false);}
 let r=await challengeFinalScoring(f.o,f.snapshot,f.discovery,f.sv,inspect,Date.now()+100);assert.equal(r.attempted,false);
 const broken={...f.sv,threats:{scoring:async()=>({ok:false})}};r=await challengeFinalScoring(f.o,f.snapshot,f.discovery,broken,inspect,Date.now()+12000);assert.equal(r.selected,null);assert.ok(r.policies.some(p=>p.reason==='receiver-score-discovery-failed'));
 const unavailable={...f.sv,explore:async(input,opt)=>{const ex=await f.sv.explore(input,opt);if(!opt?.from&&input.action==='pass'&&input.path.length){const copy=structuredClone(ex);for(const b of copy.outcomes||[])if(b.observation?.ball?.playerId==='fox')b.observation.players.find(p=>p.id==='fox').activated=true;return copy;}return ex;}};
 r=await challengeFinalScoring(f.o,f.snapshot,f.discovery,unavailable,inspect,Date.now()+12000);assert.equal(r.selected,null);assert.ok(r.policies.some(p=>p.reason==='receiver-has-no-real-activation'));
});
test('Pro plus reroll and every unreviewed/discretionary resource are blocked before promotion',async()=>{
 const f=await setup();assert.equal(scoringRuleScope(f.o).certified,true);
 for(const change of [o=>{o.rerolls.A=1;o.teams.A.rerolls=1;o.players[0].skills.push('pro');},o=>o.players[0].skills.push('pro'),o=>o.players[0].star='star',o=>o.teams.A.leaderReroll=true,o=>o.teams.A.mascotReroll=true,o=>o.teams.A.bonusRerolls=1,o=>o.teams.A.specialRules.push('unknown'),o=>o.teams.A.apothecary='available']){
  const o=structuredClone(f.o);change(o);assert.equal(scoringRuleScope(o).certified,false);const before=f.calls.length,r=await challengeFinalScoring(o,f.snapshot,f.discovery,f.sv,inspect,Date.now()+12000);assert.equal(r.selected,null);assert.equal(r.attempted,false);assert.equal(f.calls.length,before);
 }
});
test('ordinary/free-skill-only scope agrees with real builtin decisions on enumerated Pass and Catch retries',async()=>{
 for(const addSkills of [false,true]){
  const state=structuredClone(fixture.prestate);if(addSkills){state.players.find(p=>p.id==='passer').skills.push({id:'pass'});state.players.find(p=>p.id==='fox').skills.push({id:'catch'});}
  const o=observe(state,'A',1);assert.equal(scoringRuleScope(o).certified,true);const decisions=new Map();
  const input={...fixture.standingInput,path:[13,14,15,16,17].map(x=>({kind:'step',to:{x,y:7}}))};
  const result=E.exploreOutcomes(state,input,{followUp:true,threshold:.000001,maxLeaves:20000,wrapDecider:base=>(req,ctx)=>{const expected=base(req,ctx),ob=observe(ctx.s,req.team,1);decisions.set(JSON.stringify([req.type,req.options,req.context]),{req:structuredClone(req),ob,expected});return expected;}},()=>{});
  assert.equal(result.ok,true);if(addSkills)assert.ok(decisions.size>0);
  for(const {req,ob,expected}of decisions.values()){const choice=await champion.chooseDecision(ob,req,{});assert.equal(choice?.optionId??expected,expected);assert.equal(req.type,'reroll');assert.equal(expected,'skill');}
  if(!addSkills)assert.equal(decisions.size,0);
 }
});
