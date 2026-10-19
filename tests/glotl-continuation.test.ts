import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STAR_BY_ID, planAction, validateInput, type PlayerActionInput } from '../src/engine/index';
import { Pos, c, p, runScripted } from './helpers';
function scene(other=false) {
 const b=new Pos();const st=STAR_BY_ID.glotl;
 const g=b.add('A','human','lineman',c(10,7),{id:'G',st:st.st,ma:st.ma,ag:st.ag,av:st.av,skills:st.skills.map(s=>({...s}))});g.star='glotl';g.position=st.name;g.keywords=st.keywords.slice();
 b.add('B','orc','lineman',c(11,7),{id:'T'});
 if(other){b.add('B','orc','lineman',c(10,8),{id:'U'});b.add('B','orc','lineman',c(9,7),{id:'V'});}
 b.ball(c(2,2));return b.start();
}
const input=(action:'block'|'blitz'='block'):PlayerActionInput=>({kind:'playerAction',playerId:'G',action,path:[],blockTarget:'T',...(action==='blitz'?{blitzTarget:'T'}:{})});
const choose=(req:any)=>req.type==='animalSavagery'?'T':req.type==='starRule'?'U':req.type==='blockDie'?'pow':req.type==='followUp'?'no':req.type==='reroll'?'none':req.options[0].id;
test('Glotl Block preview admits every trait branch after the original target is knocked down',()=>{
 const s=scene();assert.deepEqual(validateInput(s,input()),[]);
 const plan=planAction(s,input(),{maxLeaves:5000,threshold:0.0001});assert.equal(plan.ok,true,plan.errors.join('; '));assert.deepEqual(Object.keys(plan.withTeamRerolls!.illegal),[]);
});
test('Primal Savagery downs the only target and ends a normal Block without rollback or Turnover',()=>{
 const s=scene();const r=runScripted(s,input(),[1,1,1],choose);
 assert.equal(r.status,'completed',r.error);assert.equal(p(r.state,'T').stance,'prone');assert.equal(p(r.state,'G').activated,true);assert.equal(r.state.turn.active,'A');assert.ok(p(r.state,'G').starUsed?.includes('game'));assert.match(r.events.map(e=>e.text).join('\n'),/no Standing opponent/);
});
test('normal Block asks for another standing target after Primal Savagery, then actually Blocks it',()=>{
 const asked:string[]=[];const r=runScripted(scene(true),input(),[1,1,1,6,6,1,1],req=>{asked.push(req.type);return choose(req);});
 assert.equal(r.status,'completed',r.error);assert.equal(p(r.state,'T').stance,'prone');assert.equal(p(r.state,'U').stance,'prone');assert.ok(asked.includes('starRule'));assert.equal(r.state.turn.active,'A');
});
test('Blitz cannot retarget after the declared target falls; remaining movement stays available',()=>{
 const r=runScripted(scene(true),input('blitz'),[1,1,1],choose);
 assert.equal(r.status,'completed',r.error);assert.equal(p(r.state,'T').stance,'prone');assert.equal(p(r.state,'U').stance,'standing');assert.equal(r.state.turn.activation?.action,'blitz');assert.equal(r.state.turn.activation?.blocksDone,0);
 const move=runScripted(r.state,{kind:'playerAction',playerId:'G',action:'blitz',blitzTarget:'T',path:[{to:c(9,6),kind:'step'}]},[6],choose);assert.equal(move.status,'completed',move.error);assert.deepEqual(p(move.state,'G').pos,c(9,6));
});
test('an already-prone chosen target is still illegal; no blanket suppression of invalid plans',()=>{
 const s=scene();p(s,'T').stance='prone';assert.equal(planAction(s,input()).ok,false);assert.equal(runScripted(s,input(),[],choose).status,'illegal');
});
test('a successful activation still executes its originally planned Block',()=>{
 const r=runScripted(scene(),input(),[2,6,6,1,1],choose);assert.equal(r.status,'completed',r.error);assert.equal(p(r.state,'T').stance,'prone');assert.ok(!p(r.state,'G').starUsed?.length);
});
