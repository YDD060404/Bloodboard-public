import test from 'node:test';
import assert from 'node:assert/strict';
import {protectFirst,riskyPickup,exposure} from '../src/protect-first.mjs';

// Synthetic service contracts (no engine). Real-engine behaviour is measured by tools/harness (turn.mjs, pos-decide.mjs).
const P=(id,team,x,y,extra={})=>({id,team,location:'pitch',stance:'standing',pos:{x,y},ma:6,st:3,ag:3,av:8,skills:[],activated:false,canBeActivated:true,...extra});
function world({players,ball={x:5,y:7},turn=2,activation=null}={}){
 return {team:'A',active:'A',phase:'play',pending:null,activation,turnsPerHalf:8,turn:{A:turn,B:turn},pitch:{width:26,height:15},
  ball:{kind:'ground',pos:ball},players:players??[P('picker','A',3,7),P('g1','A',4,4),P('g2','A',2,10),P('o1','B',9,7),P('o2','B',10,5)]};
}
const pickupLine=(o,p=0.1)=>({input:{kind:'playerAction',playerId:'picker',action:'secure',path:[{kind:'step',to:{x:4,y:7}},{kind:'step',to:{...o.ball.pos}}]},ex:{pTurnover:p,pTouchdown:0}});
function services(o,{multiOutcome=false,pickupIllegal=false,moves}={}){
 const calls=[];
 return {calls,
  candidates:async q=>{calls.push(['candidates',q]);
   const list=moves??[{playerId:'g1',to:{x:6,y:6}},{playerId:'g2',to:{x:3,y:10}}];
   return {ok:true,candidates:list.filter(m=>q.players.includes(m.playerId)).map(m=>({legal:true,label:`${m.playerId} to ${m.to.x},${m.to.y}`,
    input:{kind:'playerAction',playerId:m.playerId,action:'move',path:[{kind:'step',to:m.to}]}}))};},
  explore:async(input)=>{calls.push(['explore',input]);
   const players=o.players.map(p=>p.id===input.playerId?{...p,pos:{...input.path.at(-1).to}}:p);
   const out={key:'k-'+input.playerId,p:multiOutcome?0.9:1,turnover:false,observation:{...o,players}};
   return {ok:true,pTurnover:0,unresolvedMass:0,outcomes:multiOutcome?[out,{...out,key:'k2',p:0.1}]:[out]};},
  validate:async(input,q)=>{calls.push(['validate',input,q]);return {ok:true,legal:!pickupIllegal,position:q.from};}};
}

test('only the champion own risky ground-ball pickup is reordered',()=>{
 const o=world();
 assert.ok(riskyPickup(o,pickupLine(o)));
 assert.equal(riskyPickup(o,pickupLine(o,0)),null,'a certain pickup needs no reordering');
 assert.equal(riskyPickup(o,{...pickupLine(o),ex:{pTurnover:.1,pTouchdown:.2}}),null,'a scoring line is never delayed');
 assert.equal(riskyPickup({...o,ball:{kind:'held',playerId:'picker'}},pickupLine(o)),null);
 assert.equal(riskyPickup(o,{input:{kind:'playerAction',playerId:'g1',action:'move',path:[{kind:'step',to:{x:4,y:4}}]},ex:{pTurnover:.1}}),null,'a move that does not reach the ball is not a pickup');
});

test('exposure: reachable attack squares, discounted by our guards next to them; a cage nearly closes the ball',()=>{
 const o=world({players:[P('picker','A',3,7),P('o1','B',13,7),P('o2','B',12,3)]});
 const open=exposure(o,o.ball.pos,'A');
 assert.equal(open.total,1.75);                     // o2 free (1), o1 at the edge of reach with one Rush (0.75)
 const cage=world({players:[...o.players,P('a','A',6,6),P('b','A',6,8),P('c','A',4,6),P('d','A',4,8)]});
 assert.ok(exposure(cage,cage.ball.pos,'A').total<0.5);
 const far=world({players:[P('picker','A',3,7),P('o1','B',22,7)]});
 assert.equal(exposure(far,far.ball.pos,'A').total,0);
});

test('a certified dice-free guard move is played before the pickup and the pickup stays legal afterwards',async()=>{
 const o=world({players:[P('picker','A',3,7),P('g1','A',8,3),P('g2','A',8,11),P('o1','B',13,7),P('o2','B',12,3)]});
 const s=services(o,{moves:[{playerId:'g1',to:{x:6,y:6}},{playerId:'g2',to:{x:6,y:8}},{playerId:'g2',to:{x:2,y:12}}]});
 const r=await protectFirst(o,pickupLine(o),s,Date.now()+5000);
 assert.equal(r.reason,'dice-free guard move before risky pickup');
 assert.ok(['g1','g2'].includes(r.selected.input.playerId));
 assert.equal(r.selected.planSize,2,'two guards together close the ball; one alone does not');
 assert.ok(r.selected.nextGuard,'the planned second guard is reported for the next decision');
 assert.ok(s.calls.some(c=>c[0]==='validate'&&c[1].playerId==='picker'&&c[2].from==='k-'+r.selected.input.playerId),'pickup re-validated from the actual successor');
 const q=s.calls.find(c=>c[0]==='candidates')[1];
 assert.ok(!q.players.includes('picker'),'the picker is never used as a guard');
 assert.equal(q.maxRushes,0);
});

test('a guard still holding its activation does not stop the next guard, and is not reused',async()=>{
 const o=world({activation:{playerId:'g1',over:false},players:[P('picker','A',3,7),P('g1','A',6,6,{activated:true}),P('g2','A',8,11),P('g3','A',8,3),P('o1','B',13,7),P('o2','B',12,3)]});
 const s=services(o,{moves:[{playerId:'g1',to:{x:6,y:8}},{playerId:'g2',to:{x:6,y:8}},{playerId:'g3',to:{x:4,y:6}}]});
 const r=await protectFirst(o,pickupLine(o),s,Date.now()+5000);
 assert.ok(r.selected,r.reason);
 assert.notEqual(r.selected.input.playerId,'g1');
 assert.ok(!s.calls.find(c=>c[0]==='candidates')[1].players.includes('g1'));
});

test('uncertain, pickup-blocking or useless guard moves are refused',async()=>{
 const o=world({players:[P('picker','A',3,7),P('g1','A',8,3),P('g2','A',8,11),P('o1','B',13,7),P('o2','B',12,3)]});
 const moves=[{playerId:'g1',to:{x:6,y:6}},{playerId:'g2',to:{x:6,y:8}}];
 assert.equal((await protectFirst(o,pickupLine(o),services(o,{moves,multiOutcome:true}),Date.now()+5000)).selected,null);
 assert.equal((await protectFirst(o,pickupLine(o),services(o,{moves,pickupIllegal:true}),Date.now()+5000)).selected,null);
 const useless=await protectFirst(o,pickupLine(o),services(o,{moves:[{playerId:'g2',to:{x:2,y:12}}]}),Date.now()+5000);
 assert.equal(useless.reason,'no-guard-move-reduces-exposure');
});

test('a guard parked against standing opponents pays a contact cost',async()=>{
 // Two equivalent screening squares; one is adjacent to a standing opponent. The free square is preferred.
 const o=world({players:[P('picker','A',3,7),P('g1','A',8,3),P('g2','A',8,11),P('o1','B',13,7),P('o2','B',12,3),P('o3','B',8,5)]});
 const s=services(o,{moves:[{playerId:'g1',to:{x:7,y:6}},{playerId:'g1',to:{x:6,y:6}},{playerId:'g2',to:{x:6,y:8}}]});
 const r=await protectFirst(o,pickupLine(o),s,Date.now()+5000);
 assert.ok(r.selected,r.reason);
 assert.equal(r.selected.contacts,0);
});

test('urgent exceptions keep the champion pickup',async()=>{
 const o=world({turn:8});
 assert.match((await protectFirst(o,pickupLine(o),services(o),Date.now()+5000)).reason,/last-turn-of-half/);
 const a=world({activation:{playerId:'picker',over:false}});
 assert.equal((await protectFirst(a,pickupLine(a),services(a),Date.now()+5000)).reason,'picker-activation-in-progress');
 const safe=world({players:[P('picker','A',3,7),P('g1','A',4,4),P('o1','B',24,1)]});
 assert.equal((await protectFirst(safe,pickupLine(safe),services(safe),Date.now()+5000)).reason,'ball-not-exposed');
});
