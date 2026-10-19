import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedFixture} from '../scripts/test-deps.mjs';
import {Session,callService} from './deps/archived-v6-host.mjs';
import {challengeDefense} from '../src/defense.mjs';
import {createChampion} from '../src/champion.mjs';
const original=createChampion().inspector;
function contactResult(){
 const state=JSON.parse(verifiedFixture('execution-step-54.json')).state;
 for(const p of state.players){p.location='reserves';p.pos=null;p.activated=false;p.stance='standing';p.skills=[];p.usage={};}
 for(const [id,x,y] of [['A1',2,5],['B1',1,5],['B2',3,5],['B3',1,4],['B4',1,6]])Object.assign(state.players.find(p=>p.id===id),{location:'pitch',pos:{x,y}});
 state.ball={kind:'held',playerId:'B1'};state.turn.activation=null;state.turn.active='B';state.pending=null;
 state.turn.used={blitz:false,pass:false,handoff:false,secure:false};
 const session=new Session(state,'A',1,60000);
 const input={kind:'playerAction',playerId:'B2',action:'blitz',path:[],blitzTarget:'A1',blockTarget:'A1'};
 const ex=callService(session,'explore',[input,{team:'B',perspective:'A',decisions:'builtin',observations:true,maxOutcomes:128,maxKeep:256,maxLeaves:8000,maxMs:1000,threshold:.00001}]);
 assert.equal(ex.ok,true);assert.ok(ex.outcomes.some(b=>b.touchdown==='B'&&b.observation));return {input,ex};
}
async function assessed({keyless=false}={}){
 const {input:contact,ex}=contactResult();if(keyless)for(const b of ex.outcomes)if(b.touchdown)b.key=null;
 const player=(id,team,x,y,activated=false)=>({id,team,location:'pitch',pos:{x,y},stance:'standing',activated,ma:6,st:3,ag:3,skills:[]});
 const o={team:'A',active:'A',phase:'play',turn:{A:1,B:1},turnsPerHalf:6,score:{A:0,B:0},
  pitch:{width:16,height:11,endZone:{A:15,B:0}},ball:{kind:'held',playerId:'B1'},activation:null,
  players:[player('B1','B',8,5),player('B2','B',6,5),player('A1','A',5,5,true),player('support','A',10,2)]};
 const out=key=>({key,p:1,active:'B',completed:true,turnover:false,touchdown:null,observation:{...structuredClone(o),active:'B'}});
 const explored=outcomes=>({ok:true,outcomes,pTurnover:0,pTouchdown:0,unresolvedMass:0,rest:{p:0}});
 const stop={kind:'endTurn'},alternative={kind:'playerAction',playerId:'support',action:'move',path:[{to:{x:5,y:3},kind:'step'}]};
 const selected={...original.canonical({input:stop},o),ex:explored([out('inc')]),preparedBranches:new Map()};
 // Own alternatives/proposals are controlled. The contact enumeration below is
 // unchanged actual V6 evidence. This proves terminal accounting, not that the
 // full chooser naturally proposes this geometric contact or improves a match.
 const inspect={...original,boardValue:()=>0,outcomeValue:()=>({value:0,unknown:0})};
 const services={
  // Controlled graph contract, like the synthetic own endpoints above. Real
  // chain-push enumeration and all terminal-probability assertions stay intact.
  async validate(input,q){return {ok:true,position:q.from,legal:JSON.stringify(input)===JSON.stringify(contact)};},
  async candidates(q){return {ok:true,hasMore:false,candidates:q.families.includes('blitz')?[{input:contact}]:q.players?[]:q.from?[]:[{input:alternative}]};},
  async explore(input){if(input.action==='blitz')return ex;if(input.playerId==='support')return explored([out('alt')]);throw Error('Unexpected graph edge');}};
 const result=await challengeDefense(o,{mode:'normal',selected},[],services,inspect,Date.now()+15000);
 return {result,ex};
}
for(const keyless of [false,true])test(`actual contact touchdown remains an absorbing observed threat; terminal key ${keyless?'absent':'retained'}`,async()=>{
 const {result,ex}=await assessed({keyless});
 const td=ex.outcomes.filter(b=>b.observation&&b.touchdown==='B').reduce((s,b)=>s+b.p,0);
 assert.ok(td>.88&&td<.89,'actual legal chain-push creates 8/9 observed opponent TD mass');
 const contacts=result.evidence.policies.flatMap(p=>p.branches.flatMap(b=>b.contacts));assert.ok(contacts.length>=2);
 for(const c of contacts){assert.ok(c.lower>=td-1e-10);assert.ok(c.lower<=1);assert.ok(c.unknown>=0);}
 for(const p of result.evidence.policies)assert.ok(p.criticalReplyAdjustment<=-td*inspectCost()+1e-7);
});
function inspectCost(){return original.CFG.opponentScore;}
