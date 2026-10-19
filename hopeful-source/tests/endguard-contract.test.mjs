import test from 'node:test';
import assert from 'node:assert/strict';
import {challengeEnd} from '../src/endguard.mjs';
import {createChampion} from '../src/champion.mjs';

const original=createChampion().inspector;
const move={kind:'playerAction',playerId:'support',action:'move',path:[{kind:'step',to:{x:5,y:3}}]};
const observation=(world,active='A',value=0)=>({team:'A',active,world,testValue:value,phase:'play',
 turn:{A:1,B:1},pitch:{width:20,height:11,endZone:{A:19,B:0}},ball:{kind:'held',playerId:'carrier'},
 players:[{id:'support',team:'A',location:'pitch',pos:{x:4,y:3},stance:'standing',activated:false,ma:6,skills:[]},
  {id:'carrier',team:'A',location:'pitch',pos:{x:6,y:4},stance:'standing',activated:false,ma:6,skills:[]}]});
const branch=(world,key,active='A',value=0)=>({p:1,key,active,completed:true,turnover:false,touchdown:null,
 observation:observation(world,active,value)});
const explored=b=>({ok:true,outcomes:[b],pTurnover:0,pTouchdown:0,unresolvedMass:0,rest:{p:0}});
// Transport and board-value inputs are a synthetic graph. The production
// contenderEvidence, fixed margins and common-policy arithmetic remain active.
function fixture(key='after-support',closureKey='closed-after-support'){
 const calls=[],o=observation('root');
 const inspect={...original,boardValue:()=>0,cheapScore:()=>30,
  outcomeValue:ex=>({value:ex.outcomes.reduce((s,b)=>s+b.p*b.observation.testValue,0)}),
  observedTerminalScore:()=>0,
  replyAssessment:async b=>{calls.push({method:'reply',key:b.key,world:b.observation.world});
   return {failed:false,unknown:false,essentialComplete:true,criticalAdjustment:0,positionAdjustment:0};}};
 const selected={input:{kind:'endTurn'},family:'endTurn',unknown:0,
  ex:explored(branch('incumbent-closed','incumbent-closed','B')),preparedBranches:new Map()};
 const services={explore:async(input,options={})=>{calls.push({method:'explore',input,options});
  if(input.kind==='endTurn')return explored(branch(options.from==='after-support'?'support-closed':'ROOT-CLOSED',closureKey,'B'));
  assert.deepEqual(input,move);return explored(branch('support-moved',key,'A',30));}};
 return {o,inspect,selected,services,calls};
}
const run=f=>challengeEnd(f.o,{mode:'normal',selected:f.selected,lines:[f.selected]},
 [{input:move,pTurnover:0,rushes:0}],f.services,f.inspect,Date.now()+10000);

for(const key of [undefined,null,''])test(`unretained own End challenger (${String(key)}) cannot close from root`,async()=>{
 const f=fixture();f.services={explore:async(input,options={})=>{f.calls.push({method:'explore',input,options});
  return explored(input.kind==='endTurn'?branch('ROOT-CLOSED','root-closed','B'):branch('support-moved',key,'A',30));}};
 const result=await run(f);
 assert.equal(result.selected,null,'missing retained state cannot endorse an alternative to the actual champion');
 assert.equal(f.calls.some(c=>c.method==='explore'&&c.input.kind==='endTurn'&&!c.options.from),false,
  'a hypothetical child must never silently use root');
 assert.deepEqual(f.selected.input,{kind:'endTurn'});
});
test('retained own End challenger closes the exact moved state and can still win',async()=>{
 const f=fixture(),result=await run(f);
 assert.deepEqual(result.selected?.input,move);
 assert.deepEqual(f.calls.filter(c=>c.method==='explore'&&c.input.kind==='endTurn').map(c=>c.options.from),['after-support']);
 assert.ok(f.calls.some(c=>c.method==='reply'&&c.world==='support-closed'));
});
test('unretained End closure cannot fabricate opponent reply coverage',async()=>{
 const f=fixture('after-support',null),result=await run(f);
 assert.equal(result.selected,null);
 assert.equal(f.calls.some(c=>c.method==='reply'&&c.world==='support-closed'),false);
});

test('terminal touchdown without a retained key never requests a root continuation',async()=>{
 const f=fixture();f.services={explore:async(input,options={})=>{f.calls.push({method:'explore',input,options});
  const b={...branch('scored',null,'A',1000),touchdown:'A'};
  return {...explored(b),pTouchdown:1};}};
 const result=await run(f);
 assert.equal(result.selected,null,'retain the existing End challenger reply-mass admission policy');
 assert.equal(f.calls.some(c=>c.method==='explore'&&c.input.kind==='endTurn'),false);
});
