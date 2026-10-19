import test from 'node:test';
import assert from 'node:assert/strict';
import {E,observe,Session,callService} from './deps/archived-v6-host.mjs';
import {createChampion} from '../src/champion.mjs';
import {challengeStrategicWindow,matchIntent} from '../src/strategy.mjs';
import {weightedPolicyValue} from '../src/policy.mjs';
const inspect=createChampion().inspector;
async function fixture({ma=6,turn=3,nestedRisk=false}={}){
 const state=E.buildScenario({teams:{A:'human',B:'human'},players:[
  {id:'carrier',team:'A',roster:'human',position:'lineman',at:[16,7],number:1},
  {id:'helper',team:'A',roster:'human',position:'lineman',at:[18,9],number:2},
  {id:'foe',team:'B',roster:'human',position:'lineman',at:[1,14],number:1}],ball:{holder:'carrier'}},13);
 state.players.find(p=>p.id==='carrier').ma=ma;state.teams.A.turn=turn;state.teams.B.turn=turn-1;
 if(nestedRisk){state.players.find(p=>p.id==='foe').pos={x:5,y:10};state.players.push({...structuredClone(state.players.find(p=>p.id==='helper')),id:'risk',number:3,pos:{x:5,y:9}});}
 const o=observe(state,'A',1),session=new Session(state,'A',1,60000),services={};
 for(const m of ['explore','candidates','validate','sequence'])services[m]=async(...args)=>callService(session,m,args);
 services.threats={scoring:async(...args)=>callService(session,'threats.scoring',args),blitz:async(...args)=>callService(session,'threats.blitz',args)};
 const end={kind:'endTurn'},advance={kind:'playerAction',playerId:'carrier',action:'move',path:[17,18,19].map(x=>({kind:'step',to:{x,y:7}}))};
 const line=async input=>{const ex=await services.explore(input,{observations:true,decisions:'builtin',maxOutcomes:40,maxLeaves:3500,maxMs:700,threshold:.00001});
  assert.equal(ex.outcomeIdentity,'complete-state-v1');return {...inspect.canonical({input},o),ex,
   baseValue:weightedPolicyValue({input,ex,unknown:0,secondCost:0},o,inspect),preparationGain:0,criticalReplyAdjustment:0,positionReplyAdjustment:0};};
 const selected=await line(end),alternative=await line(advance),snapshot={mode:'normal',selected,lines:[selected,alternative]};
 return {state,o,services,snapshot,advance,drive:inspect.buildDrivePlan(o,null)};
}
test('real matched three-phase boundary discovers next-own TD; actual policy can execute that opportunity',async()=>{
 const f=await fixture(),r=await challengeStrategicWindow(f.o,f.snapshot,f.drive,f.services,inspect,Date.now()+20000);
 assert.deepEqual(r.selected?.input,f.advance);assert.equal(r.evidence.nextOwnTDGain,1);assert.equal(r.evidence.noMoreCurrentRisk,true);
 assert.ok(r.policies.every(p=>p.complete&&p.unknown===0));assert.deepEqual(r.policies.map(p=>p.ownTD),[0,1]);
 assert.equal(r.evidence.unknownOutsideDomain,true,'one opposing action is not a whole-turn certificate');
 const future=r.policies[1].queries.find(q=>q.kind==='next-own-score'&&q.observedTD===1);assert.ok(future);
 let s=E.execute(f.state,r.selected.input);assert.equal(s.status,'completed');s=E.execute(s.state,{kind:'endTurn'});assert.equal(s.status,'completed');
 s=E.execute(s.state,{kind:'endTurn'});assert.equal(s.status,'completed');assert.equal(s.state.turn.active,'A');
 assert.deepEqual(E.validateInput(s.state,future.input),[]);const scored=E.execute(s.state,future.input);assert.equal(scored.status,'touchdown');
 assert.equal(scored.state.teams.A.score,f.state.teams.A.score+1);
});
test('same real routes lose the strategic override when actual MA removes the next-own direct TD opportunity',async()=>{
 const f=await fixture({ma:3}),r=await challengeStrategicWindow(f.o,f.snapshot,f.drive,f.services,inspect,Date.now()+20000);
 assert.equal(r.selected,null);assert.equal(r.reason,'no-certified-strategic-window-improvement');
 assert.ok(r.policies.every(p=>p.complete));assert.deepEqual(r.policies.map(p=>p.ownTD),[0,0]);assert.equal(r.evidence.nextOwnTDGain,0);
});
test('failed/truncated empty discovery and keyless parent cannot manufacture strategic advantage',async()=>{
 for(const failure of ['throw','truncated-empty','keyless']){
  const f=await fixture();if(failure==='keyless')f.snapshot.selected.ex.outcomes[0].key=null;
  else f.services.candidates=async()=>{if(failure==='throw')throw Error('probe');return {ok:true,candidates:[],hasMore:true};};
  const r=await challengeStrategicWindow(f.o,f.snapshot,f.drive,f.services,inspect,Date.now()+20000);
  assert.equal(r.selected,null);assert.ok(r.policies.some(p=>!p.complete));assert.match(r.reason,/incomplete/);
 }
});
test('known positional/critical harm, special TD mode, final half turn and budget preserve current choice',async()=>{
 for(const change of ['position','critical','certain-td','final-turn','budget']){
  const f=await fixture({turn:change==='final-turn'?8:3});
  if(change==='position')f.snapshot.lines[1].positionReplyAdjustment=-20;
  if(change==='critical')f.snapshot.lines[1].criticalReplyAdjustment=-20;
  if(change==='certain-td')f.snapshot.mode='certain-td';
  const r=await challengeStrategicWindow(f.o,f.snapshot,f.drive,f.services,inspect,Date.now()+(change==='budget'?100:20000));
  assert.equal(r.selected,null);assert.equal(r.attempted,false);
 }
});
test('existing stronger future route is not reversed merely because policies are proposed in reverse order',async()=>{
 const f=await fixture();const [end,advance]=f.snapshot.lines;
 const r=await challengeStrategicWindow(f.o,{mode:'normal',selected:advance,lines:[advance,end]},f.drive,f.services,inspect,Date.now()+20000);
 assert.equal(r.selected,null);
});
test('match facts and actual opponent capabilities change discovery duties without a scoring bonus',async()=>{
 const f=await fixture(),tied=matchIntent(f.o,f.drive),trailing=matchIntent({...f.o,score:{A:0,B:1}},f.drive),leading=matchIntent({...f.o,score:{A:1,B:0}},f.drive);
 assert.equal(tied.duty,'create-winning-score');assert.equal(trailing.duty,'recover-score-deficit');assert.equal(leading.duty,'preserve-lead-and-score-window');
 assert.notDeepEqual(tied.preferredPurposes,leading.preferredPurposes);
 const stronger=structuredClone(f.o);stronger.players.find(p=>p.id==='foe').st=5;
 assert.equal(matchIntent(stronger,f.drive).matchup,'preserve-mobility');
 // These are allocation controls; actual match-result-sensitive risk decisions
 // require separate natural chooser evidence and are not claimed by this test.
});

test('malformed or mixed opponent discovery/scoring rows remain unknown, never successful empty domains',async()=>{
 for(const bad of ['null-candidate','empty-object','mixed-candidate','malformed-score','mixed-score']){
  const f=await fixture();
  if(bad.includes('score')){const base=f.services.threats.scoring;f.services.threats.scoring=async(...a)=>{const r=await base(...a);return {...r,ok:true,exact:true,truncated:false,threats:bad==='mixed-score'?[...(r.threats||[]),{}]:[{}]};};}
  else {const base=f.services.candidates;f.services.candidates=async(...a)=>{const r=await base(...a);return {...r,ok:true,complete:true,hasMore:false,candidates:bad==='mixed-candidate'?[...(r.candidates||[]),{}]:[bad==='null-candidate'?null:{}]};};}
  const r=await challengeStrategicWindow(f.o,f.snapshot,f.drive,f.services,inspect,Date.now()+20000);
  assert.equal(r.selected,null);assert.ok(r.policies.some(p=>!p.complete&&p.unknown>0));assert.match(r.reason,/incomplete/);
 }
});

test('real risky third action and unbound priced recovery cannot disappear from the complete own-policy comparison',async()=>{
 const f=await fixture({nestedRisk:true}),alternative=f.snapshot.lines[1],a=alternative.ex.outcomes[0];
 const second={kind:'playerAction',playerId:'helper',action:'move',path:[{kind:'step',to:{x:19,y:9}}]},
  third={kind:'playerAction',playerId:'risk',action:'move',path:[{kind:'step',to:{x:6,y:9}}]},opts={observations:true,decisions:'builtin',maxOutcomes:40,maxLeaves:3500,threshold:.00001,maxMs:700};
 const follow=await f.services.explore(second,{...opts,from:a.key});assert.equal(follow.ok,true);const b=follow.outcomes[0];
 const risk=await f.services.explore(third,{...opts,from:b.key});assert.equal(risk.ok,true);assert.ok(risk.pTurnover>.24);
 alternative.preparedBranches=new Map([[a.key,{plan:{input:second},ex:follow,preparedBranches:new Map([[b.key,{plan:{input:third},ex:risk}]])}]]);
 let r=await challengeStrategicWindow(f.o,f.snapshot,f.drive,f.services,inspect,Date.now()+20000);assert.equal(r.selected,null);assert.equal(r.attempted,false);
 alternative.preparedBranches=new Map([[a.key,{plan:{input:second,recovery:{plans:[{input:third,ball:{x:6,y:9}}]}},ex:follow}]]);
 r=await challengeStrategicWindow(f.o,f.snapshot,f.drive,f.services,inspect,Date.now()+20000);assert.equal(r.selected,null);assert.equal(r.attempted,false);
 r=await challengeStrategicWindow(f.o,{...f.snapshot,selected:alternative},f.drive,f.services,inspect,Date.now()+20000);
 assert.equal(r.selected,null);assert.match(r.reason,/unresolved-priced-dependencies/);
});
test('absent prior reply channels are unknown rather than zero harm',async()=>{
 const f=await fixture();delete f.snapshot.lines[1].positionReplyAdjustment;
 let r=await challengeStrategicWindow(f.o,f.snapshot,f.drive,f.services,inspect,Date.now()+20000);assert.equal(r.selected,null);assert.equal(r.attempted,false);
 delete f.snapshot.selected.criticalReplyAdjustment;r=await challengeStrategicWindow(f.o,f.snapshot,f.drive,f.services,inspect,Date.now()+20000);
 assert.equal(r.selected,null);assert.equal(r.reason,'current-known-reply-channels-unavailable');
});
