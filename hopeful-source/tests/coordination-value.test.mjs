import test from 'node:test';import assert from 'node:assert/strict';
import {createChampion} from '../src/champion.mjs';
import {coordinationFeatures} from '../src/coordination-value.mjs';
import {endpointUtilityPoint,endpointUtilityRange} from '../src/endpoint-utility.mjs';
const inspect=createChampion().inspector;
const player=(id,team,x,y,ma=6)=>({id,team,pos:{x,y},ma,st:3,ag:3,skills:[],location:'pitch',stance:'standing',activated:false,canBeActivated:true,tackleZone:true});
const base=()=>({phase:'play',team:'A',active:'A',half:1,drive:1,turn:{A:2,B:1},turnsPerHalf:8,score:{A:0,B:0},
 pitch:{width:26,height:15,endZone:{A:25,B:0}},ball:{kind:'held',playerId:'carrier'},
 players:[player('carrier','A',8,7),player('escort','A',7,5,2),player('foe','B',15,7)]});
const point=o=>endpointUtilityPoint({active:o.active,observation:o},o,inspect,'coordinated-terminal');
test('red old value ignores escort MA; C recognizes live synchronized movement without changing score units',()=>{
 const low=base(),high=structuredClone(low);high.players[1].ma=8;
 assert.equal(inspect.boardValue(low,'A'),inspect.boardValue(high,'A'));
 assert.equal(coordinationFeatures(low).escort,0);assert.ok(coordinationFeatures(high).escort>0);
 assert.ok(point(high).value>point(low).value);assert.equal(point(high).scoreValue,point(low).scoreValue);
});
test('coordination is invariant under translation, mirror and actor renaming',()=>{
 const o=base();o.players[1].ma=8;const expected=coordinationFeatures(o).adjustment;
 const shifted=structuredClone(o);shifted.players.forEach(p=>{p.pos.x+=2;p.pos.y++;});assert.equal(coordinationFeatures(shifted).adjustment,expected);
 const mirror=structuredClone(o);mirror.players.forEach(p=>p.pos.x=25-p.pos.x);mirror.pitch.endZone={A:0,B:25};assert.equal(coordinationFeatures(mirror).adjustment,expected);
 const renamed=structuredClone(o);renamed.players.forEach((p,i)=>p.id='unit'+i);renamed.ball.playerId='unit0';assert.equal(coordinationFeatures(renamed).adjustment,expected);
});
test('rooted/spent guards, no relevant threat and no carrier do not earn mobile escort credit',()=>{
 const o=base();o.players[1].ma=8;
 for(const change of [x=>x.players[1].rooted=true,x=>{x.players[1].activated=true;x.players[1].canBeActivated=false;}]){
  const x=structuredClone(o);change(x);assert.equal(coordinationFeatures(x).escort,0);
 }
 const quiet=structuredClone(o);quiet.players[2].pos={x:25,y:14};quiet.players[2].ma=1;assert.equal(coordinationFeatures(quiet).adjustment,0);
 const loose=structuredClone(o);loose.ball={kind:'ground',pos:{x:8,y:7}};assert.equal(coordinationFeatures(loose).adjustment,0);
});
test('a faster fifth opponent changes C pressure even when the frozen four-player pressure stays equal',()=>{
 const slow=base();slow.players=[player('carrier','A',8,7),player('escort','A',7,5,8),
  player('a','B',10,4),player('b','B',10,5),player('c','B',10,9),player('d','B',10,10),player('e','B',16,7,2)];
 const fast=structuredClone(slow);fast.players.at(-1).ma=8;
 assert.equal(inspect.boardValue(slow,'A'),inspect.boardValue(fast,'A'));
 assert.ok(coordinationFeatures(fast).missedPressure>coordinationFeatures(slow).missedPressure);
 assert.ok(point(fast).value<point(slow).value);
 const rooted=structuredClone(fast);rooted.players.at(-1).rooted=true;assert.equal(coordinationFeatures(rooted).missedPressure,0);
});
test('layered screens retain a static free-route barrier after one clear; a same-layer pile does not',()=>{
 const o=base();o.pitch={width:9,height:3,endZone:{A:8,B:0}};
 o.players=[player('carrier','A',1,1),player('first','A',3,1),player('second','A',5,1),player('foe','B',8,1,6)];
 const layered=coordinationFeatures(o);assert.ok(layered.screenResidual>0);
 const pile=structuredClone(o);pile.players[1].pos={x:3,y:0};pile.players[2].pos={x:3,y:2};
 assert.ok(coordinationFeatures(pile).screenResidual<layered.screenResidual);
 const single=structuredClone(o);single.players.splice(2,1);assert.equal(coordinationFeatures(single).screenResidual,0);
 assert.equal(layered.clearedGuardIsHypothetical,true);assert.match(layered.scope,/no Dodge\/TD probability/);
});
test('C retains an explicit finite range, terminal score and unchanged B values',()=>{
 const o=base(),range=endpointUtilityRange(o,inspect,'coordinated-terminal');assert.equal(range.positionScale,640);
 for(const x of [o,{...o,phase:'fullTime',score:{A:1,B:0}}]){const p=point(x);assert.ok(p.valid);assert.ok(p.value>=p.utilityRange.lower&&p.value<=p.utilityRange.upper);}
 const terminal=point({...o,phase:'fullTime',score:{A:1,B:0}});assert.equal(terminal.value,1500);
 const old=endpointUtilityPoint({active:'A',observation:o},o,inspect,'legacy-point');assert.equal(old.value,inspect.boardValue(o,'A'));
});
test('spent carrier and current defenders retain their actual movement limits',()=>{
 const o=base();o.players[1].ma=8;o.players[0].activated=true;o.players[0].canBeActivated=false;
 assert.equal(coordinationFeatures(o).escort,0);
 o.players[0].activated=false;o.players[0].canBeActivated=true;o.activation={playerId:'carrier',maUsed:6,over:false};
 assert.equal(coordinationFeatures(o).escort,0);
 const enemy=base();enemy.ball.playerId='carrier';enemy.players=[player('carrier','B',16,7),
 player('a','A',14,4),player('b','A',14,5),player('c','A',14,9),player('d','A',14,10),player('e','A',8,7,8)];
 assert.ok(coordinationFeatures(enemy).missedPressure>0);
 enemy.activation={playerId:'e',maUsed:8,over:false};assert.equal(coordinationFeatures(enemy).missedPressure,0);
 enemy.activation=null;enemy.players.at(-1).activated=true;enemy.players.at(-1).canBeActivated=false;
 assert.equal(coordinationFeatures(enemy).missedPressure,0);
});
test('distance alone and absorbed TD never gain screen or escort credit',()=>{
 const o=base();o.pitch={width:9,height:3,endZone:{A:8,B:0}};
 o.players=[player('carrier','A',1,1),player('guard','A',3,1),player('foe','B',8,1,2)];
 assert.equal(coordinationFeatures(o).screenResidual,0);
 const root=base(),scored=structuredClone(root);scored.score.A=1;scored.players[1].ma=8;
 const p=endpointUtilityPoint({active:'A',touchdown:'A',observation:scored},root,inspect,'coordinated-terminal');
 assert.ok(p.valid);assert.equal(p.coordination,null);assert.equal(p.value,p.originalPointValue);
});
test('equal-distance foes and seven guards are invariant to identifiers and input ordering',()=>{
 const o=base();o.players=[player('carrier','A',8,7),
 ...[[5,5],[5,7],[5,9],[7,4],[7,10],[10,4],[10,10]].map(([x,y],i)=>player('g'+i,'A',x,y,8)),
 ...[[12,3],[12,4],[12,7],[12,10],[12,11]].map(([x,y],i)=>player('f'+i,'B',x,y,i===4?8:2))];
 const a=coordinationFeatures(o),b=structuredClone(o);b.players.reverse();
 b.players.forEach((p,i)=>{if(p.id==='carrier')b.ball.playerId='renamed'+i;p.id='renamed'+i;});
 const r=coordinationFeatures(b);for(const k of ['adjustment','escort','missedPressure','screenResidual'])assert.equal(r[k],a[k]);
});
test('fifth-foe distance ties preserve horizontal and vertical mirror pressure',()=>{
 for(const layout of [
 [[9,7,8],[10,3,2],[10,11,2],[13,3,2],[17,7,2]],
 [[17,3,8],[17,5,2],[17,7,2],[17,9,2],[17,11,2]]]){
  const o=base();o.players=[player('carrier','A',13,7),...layout.map(([x,y,ma],i)=>player('foe'+i,'B',x,y,ma))];
  const a=coordinationFeatures(o);assert.equal(a.missedPressure,12);
  for(const axis of ['x','y']){const b=structuredClone(o);b.players.forEach(p=>p.pos[axis]=(axis==='x'?25:14)-p.pos[axis]);if(axis==='x')b.pitch.endZone={A:0,B:25};
   const r=coordinationFeatures(b);assert.equal(r.adjustment,a.adjustment);assert.equal(r.missedPressure,a.missedPressure);}
 }
});
