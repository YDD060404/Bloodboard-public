import test from 'node:test';
import assert from 'node:assert/strict';
import {E,observe,Session,callService} from './deps/archived-v6-host.mjs';
import {discoverMechanismTasks,challengeMechanisms} from '../src/mechanisms.mjs';
import {createChampion} from '../src/champion.mjs';
const inspect=createChampion().inspector;
function fixture(skill){
 const state=E.buildScenario({teams:{A:'human',B:'human'},rerolls:{A:0,B:0},players:[
 {id:'tool',team:'A',roster:'human',position:'lineman',at:[8,7],number:1,extraSkills:[{id:skill}]},
 {id:'mate',team:'A',roster:'human',position:'lineman',at:[8,9],number:2},
 {id:'foe',team:'B',roster:'human',position:'lineman',at:[9,7],number:1}],ball:{holder:'foe'}},13);
 const actor=state.players.find(p=>p.id==='tool');actor.pa=2;if(skill==='ballAndChain'){actor.ma=1;actor.st=5;}
 return state;
}
function services(state){const session=new Session(state,'A',1,60000),sv={};for(const m of ['legalChoices','legalTargets','validate','explore','candidates','sequence'])sv[m]=async(...a)=>callService(session,m,a);
 sv.threats={scoring:async(...a)=>callService(session,'threats.scoring',a),blitz:async(...a)=>callService(session,'threats.blitz',a)};return sv;}
for(const skill of ['bombardier','ballAndChain'])test(`${skill}: real legal-choice discovery supplies only validated ball-relevant candidates`,async()=>{
 const s=fixture(skill),o=observe(s,'A',1),sv=services(s),r=await discoverMechanismTasks(o,sv,Date.now()+3000);
 const candidates=r.candidates.filter(c=>c.input.special===skill);assert.ok(candidates.length);
 for(const c of candidates){assert.equal((await sv.validate(c.input,{})).legal,true);assert.deepEqual(c.input.path,[]);
  if(skill==='ballAndChain')assert.ok(['x-','x+','y-','y+'].includes(c.input.facing));
  const ex=await sv.explore(c.input,{observations:true,maxOutcomes:40,maxLeaves:3500,maxMs:800,decisions:'builtin'});
  assert.equal(ex.outcomeIdentity,'complete-state-v1');assert.ok(Math.abs(ex.outcomes.reduce((p,b)=>p+b.p,0)+ex.rest.p-1)<1e-8);}
 assert.equal(candidates[0].input.playerId,'tool');
 if(skill==='ballAndChain')assert.equal(candidates[0].input.facing,'x+','discovery points toward actual enemy ball; probability still comes from Engine');
});
for(const [label,change] of [
 ['trait absent',s=>{s.players.find(p=>p.id==='tool').skills=[];}],
 ['activation spent',s=>{s.players.find(p=>p.id==='tool').activated=true;}],
 ['bomb used',s=>{s.turn.used.bomb=true;}],
 ['no Passing Ability',s=>{s.players.find(p=>p.id==='tool').pa=null;}]
])test(`Bomb ${label}: no guessed special is offered`,async()=>{
 const s=fixture('bombardier');change(s);const r=await discoverMechanismTasks(observe(s,'A',1),services(s),Date.now()+3000);
 assert.equal(r.candidates.length,0);
});
test('same-roster ability swap changes the actual candidate actor; wrong owner, pending rule and budget cannot displace incumbent',async()=>{
 const s=fixture('bombardier');s.players.find(p=>p.id==='tool').skills=[];
 Object.assign(s.players.find(p=>p.id==='mate'),{skills:[{id:'bombardier'}],pa:2});const o=observe(s,'A',1),sv=services(s);
 const r=await discoverMechanismTasks(o,sv,Date.now()+3000);assert.ok(r.candidates.length);assert.ok(r.candidates.every(c=>c.input.playerId==='mate'));
 for(const ob of [{...o,active:'B'},{...o,pending:{type:'reroll'}}])assert.equal((await discoverMechanismTasks(ob,sv,Date.now()+3000)).attempted,false);
 for(const snapshot of [{mode:'certain-td',selected:{input:{kind:'endTurn'},ex:{ok:true}}},{mode:'normal',selected:{input:{kind:'endTurn'},ex:{ok:true}}}]){
  const deadline=snapshot.mode==='normal'?Date.now()+50:Date.now()+10000;
  const compared=await challengeMechanisms(o,snapshot,sv,inspect,deadline);assert.equal(compared.selected,null);assert.equal(compared.attempted,false);}
});
test('no enemy near the ball creates no obligation to use a secret weapon',async()=>{
 const s=fixture('bombardier');s.ball={kind:'ground',pos:{x:2,y:2}};
 const r=await discoverMechanismTasks(observe(s,'A',1),services(s),Date.now()+3000);assert.equal(r.attempted,false);assert.equal(r.candidates.length,0);
});
