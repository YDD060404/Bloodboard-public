import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareLearnedProposal,compareLearnedProposal,bindLearnedForCommonPool} from '../src/learned-proposal.mjs';
import {REQUIRED_ENGINE} from '../src/tactical-models.mjs';
import {TEACHER_TRAIN_DOMAIN} from '../src/teacher-domain.mjs';
const move=id=>({kind:'playerAction',playerId:id,action:'move',path:[{kind:'step',to:{x:3,y:3}}]});
const player=(id,team,x)=>({id,team,location:'pitch',stance:'standing',pos:{x,y:3},ma:6,st:3,ag:3,skills:[],activated:false});
function graph(){
 const o={apiVersion:2,engine:{...REQUIRED_ENGINE},ruleset:{rulesEdition:'faq2026'},rulesEdition:'faq2026',team:'A',active:'A',phase:'play',pending:null,activation:null,
  format:'standard',half:1,drive:1,turn:{A:1,B:1},pitch:{width:26,height:15},ball:{kind:'held',playerId:'foe'},used:{},teams:{A:{turn:1,score:0},B:{turn:1,score:0}},
  players:[player('p','A',2),player('foe','B',20)]};
 const calls=[];
 const ex=(from,input)=>{const after={...o,active:'B',value:700};return {ok:true,position:{key:from},perspective:'A',activeTeam:'A',outcomeIdentity:'complete-state-v1',
  decisionPolicy:{mode:'builtin',own:'builtin',opponent:'builtin'},exact:true,unresolvedMass:0,rest:{p:0},outcomes:[{key:from+':'+input.kind,p:1,active:'B',observation:after,turnover:false,completed:true}]};};
 const inspect={CFG:{carrierTurnover:50,turnover:30,unresolved:200,optionalRush:1,carrierDown:110,opponentScore:240},
  canonical:x=>x,boardValue:()=>0,outcomeValue:e=>({value:e.outcomes.reduce((sum,b)=>sum+b.p*b.observation.value,0)}),
  replyAssessment:async()=>({failed:false,unknown:false,essentialComplete:true,criticalAdjustment:0,positionAdjustment:0})};
 let forks=0;
 const services={validate:async(i,q={})=>{calls.push(['validate',i,q]);return {ok:true,legal:true,position:q.from??'root'};},
  explore:async(i,q)=>{calls.push(['explore',i,q]);return ex(q.from,i);},
  candidates:async q=>({ok:true,position:{key:q.from},offset:0,total:0,returned:0,hasMore:false,complete:true,candidates:[]}),
  fork:{open:async q=>({ok:true,revisionBound:true,from:q.from,fork:'f'+(++forks),node:'terminal',position:'terminal',completed:true,turnover:false}),
   close:async()=>({ok:true}),step:async()=>null}};
 const native=[{input:move('p')},{input:{kind:'playerAction',playerId:'p',action:'block',path:[],blockTarget:'foe'}}];
 return {o,services,inspect,native,calls,ex};
}
test('fixed trained inference produces a legal source-bound policy before any incumbent search',{skip:!TEACHER_TRAIN_DOMAIN.verified},async()=>{
 const f=graph(),r=await prepareLearnedProposal(f.o,f.native,f.services,f.inspect,Date.now()+20000);
 assert.equal(r.report.ranked,true);assert.equal(r.report.generated,true);assert.equal(r.report.ownComplete,true,r.report.ownReason);
 assert.equal(r.report.timing,'before-champion-search');assert.ok(r.line.requireRuleMaps);
 assert.ok(f.calls.some(x=>x[0]==='explore'&&x[2].from==='root'));assert.equal(r.report.learning.action_executed,false);
});
test('FAQ and missing runtime identity do not start learned policy exploration',async()=>{
 for(const mode of ['FAQ','identity']){
  const f=graph();if(mode==='FAQ')f.o.ruleset.rulesEdition='FAQ2026';else delete f.o.engine;
  const r=await prepareLearnedProposal(f.o,f.native,f.services,f.inspect,Date.now()+20000);
  assert.equal(r.report.generated,false);assert.equal(f.calls.length,0);
 }
});
test('common-pool binding accepts actual deferred inference and refuses borrowed root or proposal objects',{skip:!TEACHER_TRAIN_DOMAIN.verified},async()=>{
 const f=graph();Object.assign(f.o,{turnsPerHalf:8,turn:{A:8,B:7},score:{A:0,B:1}});
 const p=await prepareLearnedProposal(f.o,f.native,f.services,f.inspect,Date.now()+20000);
 assert.equal(await bindLearnedForCommonPool(f.o,{mode:'final-turn'},p,f.services,f.inspect,Date.now()+20000),null);
 assert.equal(f.calls.filter(x=>x[0]==='explore').length,0);
 const bound=await bindLearnedForCommonPool(f.o,{mode:'normal'},p,f.services,f.inspect,Date.now()+20000);
 assert.equal(bound,p.line);assert.equal(p.report.bindingTiming,'before-common-turn-selection');
 for(const [o,r] of [[{...f.o,half:2},p],[f.o,{report:{...p.report},line:p.line}]]){
  assert.equal(await bindLearnedForCommonPool(o,{mode:'normal'},r,f.services,f.inspect,Date.now()+20000),null);
 }
});
test('public final opportunity defers own binding until normal selection, without suppressing learned ranking',{skip:!TEACHER_TRAIN_DOMAIN.verified},async()=>{
 const f=graph();Object.assign(f.o,{turnsPerHalf:8,turn:{A:8,B:7},score:{A:0,B:1}});
 const p=await prepareLearnedProposal(f.o,f.native,f.services,f.inspect,Date.now()+20000);
 assert.equal(p.report.ranked,true);assert.equal(p.report.bindingDeferred,true);
 assert.equal(f.calls.filter(x=>x[0]==='explore').length,0);
 const special=await compareLearnedProposal(f.o,{mode:'final-turn',selected:{input:move('other')}},p,f.services,f.inspect,Date.now()+20000);
 assert.equal(special.reason,'learned-special-current-selection-preserved');assert.equal(f.calls.filter(x=>x[0]==='explore').length,0);
 const normal=await compareLearnedProposal(f.o,{mode:'normal',selected:{input:move('other')}},p,f.services,f.inspect,Date.now()+20000);
 assert.equal(normal.attempted,true);assert.equal(p.report.ownComplete,true);
 assert.equal(p.report.bindingTiming,'after-normal-current-selection');
});
test('deferred proposal cannot borrow another root or a fabricated ranking identity',{skip:!TEACHER_TRAIN_DOMAIN.verified},async()=>{
 const f=graph();Object.assign(f.o,{turnsPerHalf:8,turn:{A:8,B:7},score:{A:0,B:1}});
 const p=await prepareLearnedProposal(f.o,f.native,f.services,f.inspect,Date.now()+20000);
 for(const [o,r] of [[{...f.o,half:2},p],[f.o,{report:{...p.report},line:p.line}]]){
  const c=await compareLearnedProposal(o,{mode:'normal',selected:{input:move('other')}},r,f.services,f.inspect,Date.now()+20000);
  assert.equal(c.reason,'learned-source-certificate-mismatch');
 }
 assert.equal(f.calls.filter(x=>x[0]==='explore').length,0);
});
test('failed own exploration retains the precise service refusal instead of an identity diagnosis',{skip:!TEACHER_TRAIN_DOMAIN.verified},async()=>{
 const f=graph();f.services.explore=async()=>({ok:false,code:'timeout'});
 const p=await prepareLearnedProposal(f.o,f.native,f.services,f.inspect,Date.now()+20000);
 assert.equal(p.report.ownReason,'own-policy-service:timeout');assert.equal(p.report.ownComplete,false);
});
test('early budget reserves incumbent opportunity and does not start model work when insufficient',async()=>{
 const f=graph(),r=await prepareLearnedProposal(f.o,f.native,f.services,f.inspect,Date.now()+1000);
 assert.equal(r.report.reason,'learned-early-budget-unavailable');assert.equal(f.calls.length,0);
});
test('partial own mass is visible and cannot become a learned executable certificate',{skip:!TEACHER_TRAIN_DOMAIN.verified},async()=>{
 const f=graph();f.services.explore=async(i,q)=>{const e=f.ex(q.from,i);e.outcomes[0].p=.8;e.rest.p=.2;e.unresolvedMass=.2;e.exact=false;return e;};
 const r=await prepareLearnedProposal(f.o,f.native,f.services,f.inspect,Date.now()+20000);
 assert.equal(r.report.generated,true);assert.equal(r.report.ownComplete,false);assert.equal(r.report.ownReason,'own-outcome-mass-incomplete');
 assert.ok(r.line);assert.equal(r.report.ownMass.rest,.2);
 const c=await compareLearnedProposal(f.o,{mode:'normal',selected:{input:move('other')}},r,f.services,f.inspect,Date.now()+20000);
 assert.equal(c.selected,null);assert.equal(c.reason,'learned-own-policy:own-outcome-mass-incomplete');
});
test('foreign current source and fabricated proposal reports cannot borrow a certificate',{skip:!TEACHER_TRAIN_DOMAIN.verified},async()=>{
 const f=graph(),r=await prepareLearnedProposal(f.o,f.native,f.services,f.inspect,Date.now()+20000);
 for(const [o,p] of [[{...f.o,half:2},r],[f.o,{report:r.report,line:r.line}]]){
  const c=await compareLearnedProposal(o,{mode:'normal',selected:{input:move('other')}},p,f.services,f.inspect,Date.now()+20000);
  assert.equal(c.reason,'learned-source-certificate-mismatch');assert.equal(c.selected,null);
 }
});
test('normal comparison can admit a strict endpoint winner; model logits add no value',{skip:!TEACHER_TRAIN_DOMAIN.verified},async()=>{
 const f=graph(),p=await prepareLearnedProposal(f.o,f.native,f.services,f.inspect,Date.now()+20000);
 const current={input:move('other'),ex:f.ex('root',move('other'))};current.ex.outcomes[0].observation.value=400;
 const r=await compareLearnedProposal(f.o,{mode:'normal',selected:current},p,f.services,f.inspect,Date.now()+20000);
 assert.equal(r.reason,'learned-strict-source-bound-policy-improvement');assert.deepEqual(r.selected.input,p.report.input);
 assert.ok(r.selected.requireRuleMaps);assert.ok(r.bounds[1].lower>r.bounds[0].upper+.5);
});
test('certain-TD/final-turn and freshly identical input preserve the current selection',{skip:!TEACHER_TRAIN_DOMAIN.verified},async()=>{
 const f=graph(),p=await prepareLearnedProposal(f.o,f.native,f.services,f.inspect,Date.now()+20000);
 for(const mode of ['certain-td','final-turn']){
  const r=await compareLearnedProposal(f.o,{mode,selected:{input:move('other')}},p,f.services,f.inspect,Date.now()+20000);
  assert.equal(r.reason,'learned-special-current-selection-preserved');assert.equal(r.selected,null);
 }
 const same=await compareLearnedProposal(f.o,{mode:'normal',selected:{input:p.report.input}},p,f.services,f.inspect,Date.now()+20000);
 assert.equal(same.reason,'learned-input-identical-to-current');
});
