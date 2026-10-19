import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {learnedChoiceShadow} from '../src/learned-choice.mjs';
const fixture=(team='A')=>{
 const request={id:'0:blockDie',type:'blockDie',team,context:{pool:['push','bothDown'],attacker:'actor',defender:'target'},options:[{id:'push'},{id:'bothDown'}]};
 const o={team,ruleset:{rulesEdition:'legacy'},players:[{id:'actor',team:'A'},{id:'target',team:'B'}],pending:{requestId:request.id,type:request.type,team,context:structuredClone(request.context),options:structuredClone(request.options)}};
 return {o,request};
};
test('trained weights rank a source-bound legal mask in shadow and preserve incumbent',()=>{
 const {o,request}=fixture('B');const result=learnedChoiceShadow(o,request,'push');
 assert.equal(result.attempted,true);assert.equal(result.learnedOptionId,'bothDown');assert.equal(result.championOptionId,'push');
 assert.equal(result.override,false);assert.equal(result.agreement,false);assert.ok(Math.abs(result.ranking.reduce((s,r)=>s+r.probability,0)-1)<1e-12);
 assert.equal(result.modelSha256,'918553025e45d18998ea981ab9c0fc180aaed91c2d1fccfd35e0c74f630248f7');
});
test('stale source, incomplete mask, unknown chooser and unsupported decision fail closed',()=>{
 const {o,request}=fixture();
 assert.equal(learnedChoiceShadow(o,{...request,id:'stale'},'push').reason,'live-offer-source-mismatch');
 const mask=fixture();mask.request.options.push({id:'pow'});mask.o.pending.options=structuredClone(mask.request.options);
 assert.equal(learnedChoiceShadow(mask.o,mask.request,'push').reason,'offered-mask-mismatch');
 const sameTeam=fixture();sameTeam.o.players[1].team='A';assert.equal(learnedChoiceShadow(sameTeam.o,sameTeam.request,'push').reason,'chooser-relationship-unverified');
 assert.equal(learnedChoiceShadow(o,{type:'reroll'},'none').reason,'outside-trained-decision-type');
 assert.equal(learnedChoiceShadow(o,request,'not-offered').reason,'incumbent-option-not-legal');
});
test('native callback adds shadow evidence without changing the 2.3 decision/context policy',async()=>{
 const load=url=>{let coach;vm.runInNewContext(readFileSync(url,'utf8'),{bloodboard:{register:c=>coach=c},TextEncoder,setTimeout,clearTimeout});return coach;};
 const old=load(new URL('./fixtures/hopeful-2-3-gpt.js',import.meta.url));
 const candidate=load(new URL('../hopeful-2-5-s4-37u-c-unified.js',import.meta.url));
 const {o,request}=fixture('B');Object.assign(o,{phase:'play',active:'A',ball:{kind:'ground',pos:{x:5,y:5}},turn:{A:1,B:1},turnsPerHalf:6,pitch:{width:20,height:11,endZone:{A:19,B:0}},half:1,drive:1});
 o.players.forEach((p,i)=>Object.assign(p,{st:3,ma:6,ag:3,skills:[],location:'pitch',stance:'standing',pos:{x:5+i,y:5}}));
 const a=await old.chooseDecision(structuredClone(o),structuredClone(request),{}),b=await candidate.chooseDecision(structuredClone(o),structuredClone(request),{});
 assert.equal(b.optionId,a.optionId);assert.equal(b.trace.learning.override,false);assert.equal(b.trace.learning.attempted,true);
 assert.equal(b.coachContext.schema,'hopeful-context/2.5-s4.37u.c');
 assert.equal(candidate.version,'2.5.0-test.s4.37u.c');assert.equal(candidate.timeLimitMs,120000);
});
