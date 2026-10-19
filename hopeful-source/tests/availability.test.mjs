import test from 'node:test';
import assert from 'node:assert/strict';
import {available,protectionReady} from '../src/availability.mjs';
import {discoverProtectionMove} from '../src/protection.mjs';
const p={id:'helper',team:'A',location:'pitch',pos:{x:2,y:2},stance:'standing',ma:4,activated:true,canBeActivated:false};
const o={team:'A',active:'A',pitch:{width:20,height:11},activation:{playerId:'helper',action:'move',maUsed:1,over:false},ball:{kind:'held',playerId:'carrier'},players:[p,{id:'carrier',team:'A',pos:{x:5,y:5}}]};
test('current activation can spend remaining ordinary movement but completed actors cannot restart',()=>{
 assert.equal(available(o,p),true);assert.equal(protectionReady(o,p),true);
 assert.equal(protectionReady({...o,activation:{...o.activation,maUsed:4}},p),false);
 assert.equal(protectionReady({...o,activation:{...o.activation,over:true}},p),false);
 assert.equal(available({...o,activation:null},p),false);
 assert.equal(available({...o,activation:{...o.activation,playerId:'other'}},p),false);
});
test('nonmoving and disabled protectors are excluded, with prone actors still available to the native selector',()=>{
 for(const patch of [{stance:'prone'},{stance:'stunned'},{distracted:true},{rooted:true},{location:'reserves'},{pos:null}])assert.equal(protectionReady(o,{...p,...patch}),false);
 assert.equal(available(o,{...p,stance:'prone'}),true);
 assert.equal(available({...o,activation:null},{...p,activated:false,canBeActivated:false}),false);
});
test('pending rules and foreign active team never start protector discovery',async()=>{
 const services={candidates:async()=>{throw Error('unexpected query');}};
 for(const ob of [{...o,pending:{type:'reroll'}},{...o,active:'B'}])assert.equal((await discoverProtectionMove(ob,services,{},Date.now()+5000)).attempted,false);
});
