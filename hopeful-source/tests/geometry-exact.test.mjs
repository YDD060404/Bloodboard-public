// S4.37 exact-geometry-v1: differential tests of the typed-array distanceField (coordination-value.mjs) and corridor
// (champion.mjs) against verbatim S4.34 copies. Every result must be identical: Object.is on every number, the same
// array order and object key order, the same distance-closure value on every cell, and the same thrown error.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {coordinationFeatures} from '../src/coordination-value.mjs';
import {coordinationFeatures as coordinationFeaturesS434} from './fixtures/coordination-value-s4-34.mjs';
import {createChampion} from '../src/champion.mjs';
import {originalExactGeometrySource} from '../scripts/exact-geometry-transform.mjs';
import {verifiedFixture} from '../scripts/test-deps.mjs';

const sha=x=>createHash('sha256').update(x).digest('hex');
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const S434_COORDINATION_SHA='e5171a7b29ae1c47f62bef08d1c82deb68874071ac6c81747fa53066e51cf928';
const S434_CORRIDOR_REGION_SHA='92cdf42979f337b18d7993eccd4596319f82b15b2e2bc5bbea3eb8cf6531342f';
const REGION_START="  const other = t => t === 'A' ? 'B' : 'A';\n",REGION_END='\n  // Screening is valued by the approach routes it obstructs.';
const region=s=>{const i=s.indexOf(REGION_START),j=s.indexOf(REGION_END,i);if(i<0||j<i)throw Error('champion geometry region anchors');return s.slice(i,j);};

// Module internals by text: the same source evaluated as a strict function body. Only the fallback entry points are
// wrapped, to count how often the typed-array path was bypassed; their bodies are unchanged.
const counter=(text,name,stats)=>text.replace(`function ${name}(`,`function ${name}(...a){stats.fallback++;return ${name}Body(...a);}\nfunction ${name}Body(`);
function internals(text,names){
 const stats={fallback:0};
 const api=new Function('stats',`'use strict';\n${text.replace(/^export function /gm,'function ')}\nreturn {${names.join(',')}};`)(stats);
 return {...api,stats};
}
const coordinationNew=()=>internals(counter(read('../src/coordination-value.mjs'),'distanceFieldStrings'),['distanceField','neighbours','coordinationFeatures']);
const coordinationOld=()=>internals(read('./fixtures/coordination-value-s4-34.mjs'),['distanceField','neighbours','coordinationFeatures']);
const corridorNew=()=>internals(counter(region(read('../src/champion.mjs')),'corridorStrings'),['corridor']);
const corridorOld=()=>internals(read('./fixtures/champion-corridor-s4-34.txt'),['corridor']);

/** First difference, or null. Numbers by Object.is; arrays and objects by length/key order; functions are probed separately. */
function diff(a,b,path='$'){
 if(typeof a==='function'&&typeof b==='function')return null;
 if(typeof a!=='object'||a===null||typeof b!=='object'||b===null)return Object.is(a,b)?null:`${path}: ${String(a)} v ${String(b)}`;
 if(Array.isArray(a)!==Array.isArray(b))return path+': array/object';
 const ka=Object.keys(a),kb=Object.keys(b);
 if(ka.join('\u0000')!==kb.join('\u0000'))return `${path}: keys ${ka} v ${kb}`;
 for(const k of ka){const d=diff(a[k],b[k],path+'.'+k);if(d)return d;}
 return null;
}
const run=f=>{try{return {value:f()};}catch(e){return {error:`${e?.constructor?.name}: ${e?.message}`};}};
const sameRun=(f,g,label)=>{const a=run(f),b=run(g);const d=diff(a,b);if(d)assert.fail(`${label}: ${d}`);return a;};

// Probe every cell, a two-cell ring outside the pitch and values that take the original string path.
const ODD=[{x:0.5,y:3},{x:3,y:-0},{x:-0,y:-0},{x:1-2**-53,y:4},{x:'3',y:4},{x:3,y:'4'},{x:NaN,y:1},{x:Infinity,y:2},
 {x:2**53-1,y:3},{x:1-2**53,y:3},{x:1e21,y:0},{x:undefined,y:2},{x:null,y:2}];
function probes(w,h){const cells=[];for(let y=-2;y<=h+1;y++)for(let x=-2;x<=w+1;x++)cells.push({x,y});return cells.concat(ODD);}
function sameField(a,b,args,label){
 const fa=run(()=>a.distanceField(...args)),fb=run(()=>b.distanceField(...args));
 if(fa.error||fb.error){assert.equal(fa.error,fb.error,label);return 0;}
 const o=args[0],w=Number.isInteger(o.pitch?.width)?o.pitch.width:26,h=Number.isInteger(o.pitch?.height)?o.pitch.height:15;
 let n=0;for(const p of probes(w,h)){sameRun(()=>fa.value(p),()=>fb.value(p),`${label} cell ${String(p.x)},${String(p.y)}`);n++;}
 return n;
}
const onPitch=p=>p?.location==='pitch'&&!!p.pos;
const standingZone=p=>onPitch(p)&&p.stance==='standing'&&!p.distracted&&p.tackleZone!==false;
/** The distanceField calls coordinationFeatures can make for a carrier, plus guard-removal variants. */
function fieldCases(o,carrier,neighbours){
 const cases=[[o,neighbours(carrier.pos)]];
 const allies=o.players.filter(p=>p?.team===carrier.team&&p.id!==carrier.id&&standingZone(p)).slice(0,4);
 for(const lost of allies.slice(0,2)){
  const remaining=allies.filter(p=>p!==lost);
  cases.push([o,neighbours(carrier.pos),remaining,lost.id],[o,neighbours(carrier.pos),[],lost.id]);
 }
 return cases;
}
function corridorCalls(o,f,g,label,carriers=o.players){
 let n=0;
 for(const carrier of carriers)for(const team of ['A','B'])for(const approach of [false,true]){
  sameRun(()=>f.corridor(o,team,carrier,approach),()=>g.corridor(o,team,carrier,approach),`${label} corridor ${carrier?.id} ${team} ${approach}`);n++;
 }
 return n;
}
const holderVariants=o=>[o,...o.players.filter(p=>onPitch(p)&&p.stance==='standing'&&o.ball?.playerId!==p.id).slice(0,3)
 .map(p=>({...o,ball:{kind:'held',playerId:p.id}}))].flatMap(x=>[x,{...x,team:x.team==='A'?'B':'A'}]);

function differential(observations,label,{fieldCarriers=2,routeCarriers=Infinity}={}){
 const cn=coordinationNew(),co=coordinationOld(),rn=corridorNew(),ro=corridorOld();
 let features=0,fields=0,cells=0,routes=0;
 for(const [i,o] of observations.entries()){
  for(const x of holderVariants(o)){
   sameRun(()=>coordinationFeatures(x),()=>coordinationFeaturesS434(x),`${label}#${i} features`);features++;
  }
  const carriers=o.players.filter(p=>p?.pos&&typeof p.pos==='object');
  for(const carrier of carriers.slice(0,fieldCarriers))for(const args of fieldCases(o,carrier,co.neighbours)){
   cells+=sameField(cn,co,args,`${label}#${i} field ${carrier.id}`);fields++;
  }
  routes+=corridorCalls(o,rn,ro,`${label}#${i}`,o.players.slice(0,routeCarriers));
 }
 return {features,fields,cells,routes,fieldFallbacks:cn.stats.fallback,routeFallbacks:rn.stats.fallback};
}

// ---------------------------------------------------------------- reference identity
test('reference copies are the verbatim S4.34 sources and the champion transform reverses to them',()=>{
 assert.equal(sha(read('./fixtures/coordination-value-s4-34.mjs')),S434_COORDINATION_SHA);
 const corridorText=read('./fixtures/champion-corridor-s4-34.txt');
 assert.equal(sha(corridorText),S434_CORRIDOR_REGION_SHA);
 const s434=originalExactGeometrySource(read('../src/champion.mjs'));
 assert.equal(region(s434),corridorText);
 // The retained string-keyed fallbacks are the S4.34 functions verbatim apart from their names.
 const now=read('../src/champion.mjs'),old=corridorText.slice(corridorText.indexOf('  function corridor('));
 assert.ok(now.includes(old.replace('  function corridor(','  function corridorStrings(')));
 const cv=read('../src/coordination-value.mjs'),cvOld=read('./fixtures/coordination-value-s4-34.mjs');
 const body=cvOld.slice(cvOld.indexOf('function distanceField('),cvOld.indexOf('export function coordinationFeatures'));
 assert.ok(cv.includes(body.replace('function distanceField(','function distanceFieldStrings(')));
 assert.equal(cv.slice(cv.indexOf('export function coordinationFeatures')),cvOld.slice(cvOld.indexOf('export function coordinationFeatures')));
});

// ---------------------------------------------------------------- (a) recorded observations
test('recorded sevens game (20x11): every observation gives identical features, fields and corridors',()=>{
 const game=JSON.parse(verifiedFixture('champion-game-p0001-L2.json'));
 const observations=game.decisions.map(d=>d.observation).filter(Boolean);
 assert.ok(observations.length>=100);
 const sample=observations.filter((_,i)=>i%9===0);
 const r=differential(sample,'sevens');
 assert.ok(r.cells>5000&&r.routes>200,JSON.stringify(r));
 assert.ok(r.fieldFallbacks<r.fields*0.1&&r.routeFallbacks===0,JSON.stringify(r));
});
const recorded=(()=>{try{return JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/geometry-observations.json.gz',import.meta.url))).toString('utf8'));}catch{return null;}})();
test('recorded 7.0.1 matches (GUI-tree replay roots and captured real call arguments): identical results',()=>{
 assert.ok(recorded,'tests/fixtures/geometry-observations.json.gz is required');
 assert.equal(recorded.schema,'hopeful-geometry-observations/1');
 const r=differential(recorded.observations.filter((_,i)=>i%18===0),'roots',{fieldCarriers:1});
 assert.ok(r.routes>500,JSON.stringify(r));
 // Captured arguments are replayed exactly as Hopeful made the calls.
 const cn=coordinationNew(),co=coordinationOld(),rn=corridorNew(),ro=corridorOld();
 for(const [i,c] of recorded.calls.entries()){
  if(c.fn==='coordinationFeatures')sameRun(()=>coordinationFeatures(c.o),()=>coordinationFeaturesS434(c.o),`call#${i} features`);
  else if(c.fn==='distanceField')sameField(cn,co,[c.o,c.targets,c.guards,c.removed],`call#${i} field`);
  else{const carrier=c.o.players.find(p=>p.id===c.carrier)??c.carrierObject;
   sameRun(()=>rn.corridor(c.o,c.team,carrier,c.approach),()=>ro.corridor(c.o,c.team,carrier,c.approach),`call#${i} corridor`);}
 }
 assert.equal(rn.stats.fallback,0);assert.equal(cn.stats.fallback,0);
});

// ---------------------------------------------------------------- (b) seeded random boards and edge cases
function rng(seed){return()=>{seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function board(r,{w,h,count,offGrid=0.05,duplicate=0.05,format='standard',pitch=true}){
 const pick=a=>a[Math.floor(r()*a.length)],players=[];
 for(let i=0;i<count;i++){
  const prev=players.length&&r()<duplicate?pick(players).pos:null;
  const pos=prev?{...prev}:{x:r()<offGrid?pick([-1,w,w+1]):Math.floor(r()*w),y:r()<offGrid?pick([-1,h]):Math.floor(r()*h)};
  const location=r()<0.9?'pitch':pick(['reserves','ko','cas']);
  players.push({id:'p'+i,team:r()<0.5?'A':'B',ma:r()<0.05?undefined:1+Math.floor(r()*8),st:1+Math.floor(r()*5),ag:2+Math.floor(r()*4),skills:[],
   pos:location==='pitch'||r()<0.5?pos:null,location,stance:pick(['standing','standing','standing','prone','stunned']),
   distracted:r()<0.1,tackleZone:r()<0.9,rooted:r()<0.05,activated:r()<0.3,canBeActivated:r()<0.9});
 }
 const standing=players.filter(p=>p.location==='pitch'&&p.pos&&p.stance==='standing');
 const carrier=standing.length&&r()<0.85?pick(standing):null;
 const o={phase:'play',format,team:r()<0.5?'A':'B',active:'A',turn:{A:3,B:3},turnsPerHalf:8,score:{A:0,B:1},rerolls:{A:1,B:2},players,
  ball:carrier?{kind:'held',playerId:carrier.id}:{kind:'ground',pos:{x:Math.floor(r()*w),y:Math.floor(r()*h)}},
  activation:r()<0.4&&players.length?{playerId:pick(players).id,over:r()<0.3,maUsed:Math.floor(r()*4)}:null};
 if(pitch)o.pitch={width:w,height:h,endZone:r()<0.5?{A:w-1,B:0}:{A:0,B:w-1}};
 return o;
}
test('seeded random 26x15 and sevens boards: identical features, fields and corridors',()=>{
 const r=rng(43501),boards=[];
 for(let i=0;i<40;i++){const sevens=i%4===3;
  boards.push(board(r,sevens?{w:20,h:11,count:4+Math.floor(r()*12),format:'sevens'}:{w:26,h:15,count:4+Math.floor(r()*24)}));}
 const res=differential(boards,'random');
 assert.ok(res.cells>40000&&res.routes>1800,JSON.stringify(res));
 assert.ok(res.fieldFallbacks<res.fields*0.2&&res.routeFallbacks<res.routes*0.1,JSON.stringify(res));
});
test('edge cases: pitch edges, every square blocked, no path, duplicates, -0, fractional/string coordinates, missing pitch',()=>{
 const p=(id,team,x,y,extra={})=>({id,team,pos:{x,y},ma:6,st:3,ag:3,skills:[],location:'pitch',stance:'standing',activated:false,canBeActivated:true,tackleZone:true,...extra});
 const o=(players,extra={})=>({phase:'play',team:'A',active:'A',turn:{A:2,B:2},turnsPerHalf:8,score:{A:0,B:0},pitch:{width:26,height:15,endZone:{A:25,B:0}},
  ball:{kind:'held',playerId:players[0].id},players,...extra});
 const cases=[];
 for(const [x,y] of [[0,0],[25,0],[0,14],[25,14],[0,7],[25,7],[12,0],[12,14]])
  cases.push(o([p('c','A',x,y),p('f1','B',Math.min(25,x+2),y),p('f2','B',x,Math.min(14,y+1)),p('g','A',Math.max(0,x-1),y)]));
 const all=[];for(let y=0;y<15;y++)for(let x=0;x<26;x++)all.push(p(`b${x}_${y}`,(x+y)%2?'A':'B',x,y));
 cases.push(o(all),o(all.map(q=>({...q,stance:'prone'}))));
 const ring=[p('c','A',10,7)];for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)if(dx||dy)ring.push(p(`r${dx}${dy}`,'B',10+dx,7+dy));
 cases.push(o(ring),o(ring.map((q,i)=>i?{...q,team:'A'}:q)));
 const wall=[p('c','A',5,7),p('f','B',12,7)];for(let y=0;y<15;y++)wall.push(p('w'+y,'B',8,y,{stance:y%2?'standing':'prone'}));
 cases.push(o(wall));
 cases.push(o([p('c','A',5,7),p('d1','B',6,7),p('d2','B',6,7),p('d3','A',5,7),p('f','B',9,8)]));
 cases.push(o([p('c','A',-0,-0),p('f','B',2,-0),p('g','A',-0,1)]),o([p('c','A',3,-0),p('f','B',-0,2)]));
 cases.push(o([p('c','A',4.5,7),p('f','B',8,7)]),o([p('c','A',4,7),p('f','B',8.5,7),p('g','A',5,6.5)]));
 cases.push(o([p('c','A','4',7),p('f','B',8,7)]),o([p('c','A',4,7),p('f','B','8',7),p('g','A',5,'6')]));
 cases.push(o([p('c','A',4,7),p('f','B',8,7),{...p('off','B',3,3),location:'reserves'},{...p('gone','A',0,0),location:'pitch',pos:null}]));
 cases.push(o([p('c','A',4,7,{rooted:true}),p('f','B',8,7,{distracted:true}),p('g','B',6,7,{tackleZone:false})]));
 const missing=o([p('c','A',4,7),p('f','B',8,7)]);delete missing.pitch;cases.push(missing,{...missing,format:'sevens'});
 cases.push(o([p('c','A',4,7),p('f','B',8,7)],{pitch:{width:26.5,height:15,endZone:{A:25,B:0}}}));
 cases.push(o([p('c','A',4,7),p('f','B',8,7)],{pitch:{width:20,height:11,endZone:{A:19,B:0}},format:'sevens'}));
 cases.push(o([p('c','A',30,7),p('f','B',8,7)]),o([p('c','A',-1,7),p('f','B',8,7)]),o([p('c','A',4,20),p('f','B',8,7)]));
 const res=differential(cases,'edge',{fieldCarriers:4,routeCarriers:4});
 assert.ok(res.fieldFallbacks>0&&res.routeFallbacks>0,'the retained string path must be exercised: '+JSON.stringify(res));
 // Unreachable-in-play shapes still behave identically, including thrown errors.
 const rn=corridorNew(),ro=corridorOld(),cn=coordinationNew(),co=coordinationOld();
 const odd=o([p('c','A',4,7),p('f','B',8,7)]);
 for(const bad of [{...odd,players:[...odd.players,null]},{...odd,players:[...odd.players,{id:'q',team:'B',location:'pitch',pos:7,stance:'standing'}]}]){
  corridorCalls(bad,rn,ro,'bad',bad.players.filter(Boolean));
  sameField(cn,co,[bad,co.neighbours({x:4,y:7})],'bad field');
 }
 sameField(cn,co,[odd,[{x:3,y:6},{x:3,y:6},{x:30,y:6},{x:-1,y:2}]],'duplicate/off-grid targets');
 sameField(cn,co,[odd,[]],'no targets');
 sameField(cn,co,[odd,[{x:3.5,y:6}]],'fractional target');
 sameField(cn,co,[odd,co.neighbours({x:4,y:7}),[{...odd.players[1],pos:{x:'5',y:7}}]],'string guard');
});

test('corridor retains the frozen string path for aliased off-grid and fractional carrier starts',()=>{
 const fresh=corridorNew(),frozen=corridorOld();
 for(const [x,y] of [[26,0],[-1,1],[0.5,0.25],['4',1]]){
  const carrier={id:'c',team:'A',pos:{x,y},ma:6,location:'pitch',stance:'standing'};
  const foe={id:'f',team:'B',pos:{x:8,y:4},ma:6,location:'pitch',stance:'standing'};
  const o={players:[carrier,foe],ball:{kind:'held',playerId:'c'},pitch:{width:26,height:15,endZone:{A:25,B:0}}};
  for(const approach of [false,true]){
   const before=fresh.stats.fallback;
   sameRun(()=>fresh.corridor(o,'A',carrier,approach),()=>frozen.corridor(o,'A',carrier,approach),`start ${x},${y} approach=${approach}`);
   assert.equal(fresh.stats.fallback,before+1,`start ${x},${y} must use the frozen string path`);
  }
 }
});

// ---------------------------------------------------------------- (c) Dijkstra ties
test('corridor ties: mirror-symmetric boards with equal-cost routes choose the identical path',()=>{
 const p=(id,team,x,y)=>({id,team,pos:{x,y},ma:6,st:3,ag:3,skills:[],location:'pitch',stance:'standing',activated:false,canBeActivated:true,tackleZone:true});
 const rn=corridorNew(),ro=corridorOld();
 let ties=0,checked=0;
 for(let gap=1;gap<=6;gap++)for(const team of ['A','B'])for(const zone of [false,true]){
  const players=[p('c',team,team==='A'?3:22,7)];
  // A full wall at x=12 except the mirror-image gaps 7-gap and 7+gap: both detours cost exactly the same.
  for(let y=0;y<15;y++)if(y!==7-gap&&y!==7+gap)players.push(p('w'+y,team,12,y));
  if(zone)players.push(p('z1',team==='A'?'B':'A',16,7-gap-2),p('z2',team==='A'?'B':'A',16,7+gap+2));
  const o={phase:'play',team,players,pitch:{width:26,height:15,endZone:{A:25,B:0}},ball:{kind:'held',playerId:'c'}};
  const both=sameRun(()=>rn.corridor(o,team,players[0]),()=>ro.corridor(o,team,players[0]),`tie gap ${gap} ${team} ${zone}`).value;
  checked++;
  // The tie is real: closing either gap leaves a route of exactly the same cost.
  const upper=corridorOld().corridor({...o,players:[...players,p('u',team,12,7-gap)]},team,players[0]);
  const lower=corridorOld().corridor({...o,players:[...players,p('l',team,12,7+gap)]},team,players[0]);
  if(!upper.closedInStaticBoard&&Object.is(upper.cost,lower.cost)&&Object.is(both.cost,upper.cost))ties++;
  for(const approach of [true])sameRun(()=>rn.corridor(o,team==='A'?'B':'A',players[0],approach),()=>ro.corridor(o,team==='A'?'B':'A',players[0],approach),'tie approach');
 }
 assert.ok(ties>=checked/2,`${ties} of ${checked} boards carry an exact equal-cost route tie`);
 // Open boards: many equal-cost cells per heap level (all-integer costs without zones or edges).
 const r=rng(2026);
 for(let i=0;i<300;i++){
  const o={phase:'play',team:'A',players:[],pitch:{width:26,height:15,endZone:{A:25,B:0}},ball:{kind:'ground',pos:{x:0,y:0}}};
  const c=p('c',r()<0.5?'A':'B',Math.floor(r()*26),1+Math.floor(r()*13));o.players.push(c);
  for(let k=0;k<Math.floor(r()*6);k++){const x=Math.floor(r()*26),y=Math.floor(r()*15),q=p('s'+k,r()<0.5?'A':'B',x,y);o.players.push(q,{...q,id:'m'+k,pos:{x,y:14-y}});}
  o.ball={kind:'held',playerId:o.players.at(-1).id};
  corridorCalls(o,rn,ro,'open'+i,o.players.slice(0,3));
 }
 assert.equal(rn.stats.fallback,0);
});

// ---------------------------------------------------------------- champion-level: S4.34 v S4.37 inspector values
test('champion inspector boardValue/cheapScore inputs: S4.34 and S4.37 champions return identical values',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'geometry-exact-'));
 try{
  // The recovered S4.34 module, with its two relative imports pointed at the same src modules.
  const src=new URL('../src/',import.meta.url);
  const s434=originalExactGeometrySource(read('../src/champion.mjs'))
   .replace("from './reply-window.mjs';",`from '${new URL('reply-window.mjs',src).href}';`)
   .replace("from './root-refinement.mjs';",`from '${new URL('root-refinement.mjs',src).href}';`);
  writeFileSync(join(dir,'champion-s4-34.mjs'),s434);
  const old=await import(pathToFileURL(join(dir,'champion-s4-34.mjs')).href);
  const a=createChampion().inspector,b=old.createChampion().inspector;
  const game=JSON.parse(verifiedFixture('champion-game-p0001-L2.json'));
  const obs=game.decisions.map(d=>d.observation).filter(Boolean).concat(recorded?.observations??[]);
  let n=0;
  for(const o of obs)for(const me of ['A','B']){
   const x=structuredClone(o),y=structuredClone(o);
   sameRun(()=>a.boardValue(x,me),()=>b.boardValue(y,me),'boardValue');n++;
  }
  assert.ok(n>=200);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
