import {fairInspector} from '../src/fair-inspector.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {same,endorseContinuation,completeAction,policyFrom} from '../src/policy.mjs';
import {createChampion} from '../src/champion.mjs';
import {saveChampionPlan} from '../src/plans.mjs';
import {reconcile} from '../src/execution.mjs';
const inspect=fairInspector(createChampion().inspector);
const move=id=>({kind:'playerAction',playerId:id,action:'move',path:[]});
const ob=(x=1)=>({apiVersion:1,requestId:1,revision:'1:-:0',phase:'play',team:'A',active:'A',format:'sevens',
 half:1,drive:1,turn:{A:1,B:0},pitch:{width:20,height:11,endZone:{A:19,B:0}},score:{A:0,B:0},
 ball:{kind:'ground',pos:{x:4,y:4}},rerolls:{A:1,B:1},used:{},weather:'perfect',activation:null,
 players:[{id:'p',team:'A',location:'pitch',pos:{x,y:4},stance:'standing',activated:false,
 ma:6,st:3,ag:3,av:8,skills:[]}],teams:{A:{rerolls:1},B:{rerolls:1}}});
const branch=(p,o,key)=>({p,observation:o,key,active:o.active,completed:true});
const ex=(outcomes,extra={})=>({ok:true,outcomes,pTurnover:0,pTouchdown:0,rest:{p:0},unresolvedMass:0,...extra});
const line=(input,gain=0,stage='after first action')=>({input,family:'move',ex:{pTurnover:0},unknown:0,
 baseValue:100+gain,preparationGain:0,reply:[{stage}],criticalReplyAdjustment:0,positionReplyAdjustment:0,
 replyAdjustment:0,observedReplyMass:1,checkedReplyMass:1,boundedReplyMass:1});
test('equivalent complete inputs ignore object key order but preserve path order',()=>{
 assert.ok(same(move('a'),{action:'move',path:[],playerId:'a',kind:'playerAction'}));
 assert.ok(!same({path:[1,2]},{path:[2,1]}));
});
test('fresh actual champion, not a persisted plan, determines equivalence',()=>{
 const i=line(move('a'));assert.equal(endorseContinuation(line(move('a')),i,inspect,'normal').equivalent,true);
 assert.equal(endorseContinuation(null,i,inspect,'normal').eligible,false);
});
test('longer prepared policy cannot win a mismatched first-action horizon',()=>{
 const c=line(move('b'),30,'after examined follow-up');c.preparationGain=10;
 const result=endorseContinuation(c,line(move('a')),inspect,'normal');
 assert.equal(result.eligible,false);assert.equal(result.reason,'unmatched-own-horizon');
});
test('positional gain cannot erase a worse critical reply',()=>{
 const c=line(move('b'),200);c.criticalReplyAdjustment=-40;c.replyAdjustment=-40;
 assert.equal(endorseContinuation(c,line(move('a')),inspect,'normal').reason,'worsened-critical-reply');
});
test('unmatched replies cannot discard measured positional harm for a small root gain',()=>{
 for(const [gain,harm] of [[2.6,-66.179],[3.2,-47.958]]){
  const incumbent=line(move('a')),candidate=line(move('b'),gain);
  incumbent.checkedReplyMass=0;incumbent.boundedReplyMass=0;incumbent.observedReplyMass=0;incumbent.reply=[];
  candidate.checkedReplyMass=0;candidate.boundedReplyMass=0;
  candidate.positionReplyAdjustment=harm;candidate.replyAdjustment=harm;
  assert.equal(inspect.contenderEvidence(candidate,incumbent).eligible,false,'adapted selector leaves unpaired evidence explicitly incomparable');
  const result=endorseContinuation(candidate,incumbent,inspect,'normal');
  assert.equal(result.eligible,false);assert.equal(result.reason,'unmatched-reply-coverage');
 }
});
test('partial unobserved probability does not count as complete evidence',()=>{
 assert.equal(completeAction(ex([branch(.8,ob(),'k')],{rest:{p:.2}}),'A'),false);
 assert.equal(completeAction(ex([branch(1.1,ob(),'k')]),'A'),false);
 assert.equal(completeAction(ex([branch(1,ob(),'k')]),'A'),true);
});
test('two-action policy retains failed pickup and weights actual conditional outcomes',()=>{
 const failure={...ob(),active:'B'},first={input:move('p'),ex:ex([
  branch(.75,ob(),'s'),{...branch(.25,failure,'f'),turnover:true}],{pTurnover:.25})};
 const second=ex([{...branch(1,{...ob(),score:{A:1,B:0}},'td'),touchdown:'A'}]);
 const p=policyFrom(first,new Map([['s',{plan:{input:move('p')},ex:second}]]),'A',inspect);
 assert.equal(p.ex.pTouchdown,.75);assert.equal(p.ex.pTurnover,.25);assert.equal(p.unknown,0);
 assert.equal(p.ex.outcomes.find(x=>x.key==='f').p,.25);
});
test('unknown second branch remains unknown rather than credited as full preparation',()=>{
 const first={input:move('p'),ex:ex([branch(1,ob(),'s')])};
 const p=policyFrom(first,new Map([['s',{plan:{input:move('p')},ex:ex([branch(.6,ob(),'next')],{rest:{p:.4}})}]]),'A',inspect);
 assert.ok(Math.abs(p.unknown-.4)<1e-9);assert.equal(completeAction(p.ex,'A'),false);
});
for(const stage of ['first','follow'])for(const field of ['unresolvedMass','rest']){
 test(`${stage} explicit ${field} survives observed mass one`,()=>{
  const first={input:move('p'),ex:ex([branch(1,ob(),'s')])};
  const follow={plan:{input:move('p')},ex:ex([branch(1,ob(),'next')])};
  const target=stage==='first'?first.ex:follow.ex;
  if(field==='rest')target.rest={p:.1};else target.unresolvedMass=.1;
  const policy=policyFrom(first,new Map([['s',follow]]),'A',inspect);
  assert.ok(policy.unknown>=.1);assert.equal(completeAction(policy.ex,'A'),false);
 });
}
test('a complete helper cannot hide an incomplete follow on another first branch',()=>{
 const first={input:move('p'),ex:ex([branch(.75,ob(),'helper'),branch(.25,ob(),'other')])};
 const follow=extra=>({plan:{input:move('p')},ex:ex([branch(1,ob(),'next')],extra)});
 const policy=policyFrom(first,new Map([['helper',follow({})],['other',follow({unresolvedMass:.2})]]),'A',inspect);
 assert.ok(Math.abs(policy.unknown-.05)<1e-9);assert.equal(completeAction(policy.ex,'A'),false);
});
test('failed or invalid participating evidence cannot become a complete synthetic policy',()=>{
 for(const extra of [{ok:false},{outcomes:[branch(-.1,ob(),'bad'),branch(1.1,ob(),'bad2')]}]){
  const first={input:move('p'),ex:ex([branch(1,ob(),'s')])};
  const policy=policyFrom(first,new Map([['s',{plan:{input:move('p')},ex:ex([branch(1,ob(),'next')],extra)}]]),'A',inspect);
  assert.equal(completeAction(policy.ex,'A'),false);
 }
});
test('unknown channels use their maximum without double charging the same missing mass',()=>{
 const first={input:move('p'),ex:ex([branch(1,ob(),'s')])};
 const policy=policyFrom(first,new Map([['s',{plan:{input:move('p')},ex:ex([branch(.6,ob(),'next')],
  {unresolvedMass:.4,rest:{p:.4}})}]]),'A',inspect);
 assert.ok(Math.abs(policy.unknown-.4)<1e-9);
});
test('same next input on different public outcomes retains its own actual endpoint',()=>{
 const initial=ob(),a=ob(2),b=ob(3),endA=ob(4),endB=ob(5),id={coachId:'hopeful-2-1-gpt',version:'2.1.0',contextSchema:'ctx'};
 const selected={input:move('p'),ex:ex([branch(.5,a,'a'),branch(.5,b,'b')]),preparedBranches:new Map([
  ['a',{plan:{input:move('p')},ex:ex([branch(1,endA,'c')])}],
  ['b',{plan:{input:move('p')},ex:ex([branch(1,endB,'d')])}]])};
 const saved=saveChampionPlan(initial,selected,id);assert.ok(saved.plan,saved.reason);assert.equal(saved.nodes,3);
 const r=reconcile(saved.plan,{...b,requestId:2,revision:'2:-:0'},{identity:id});
 assert.equal(r.status,'candidate-ready');assert.equal(r.plan.cursor,0);assert.equal(r.plan.completedCount,1);
});
test('insufficient sidecar reservation leaves champion input unchanged',()=>{
 const initial=ob(),selected={input:move('p'),ex:ex([branch(1,ob(2),'a')]),
  preparedBranches:new Map([['a',{plan:{input:move('p')},ex:ex([branch(1,ob(3),'b')])}]])};
 const saved=saveChampionPlan(initial,selected,{coachId:'h21',version:'2.1',contextSchema:'ctx'},512);
 assert.equal(saved.plan,null);assert.deepEqual(selected.input,move('p'));
});
test('central conditional walker includes third-action risk/TD mass and stops failed prefixes once',()=>{
 const first={input:move('a'),ex:ex([branch(.8,ob(),'first-success'),{...branch(.2,{...ob(),active:'B'},'first-fail'),turnover:true}])};
 const third=ex([{...branch(.75,{...ob(),score:{A:1,B:0}},'third-td'),touchdown:'A'},
  {...branch(.25,{...ob(),active:'B'},'third-fail'),turnover:true}]);
 const nested=new Map([['first-success',{plan:{input:move('b')},ex:ex([branch(1,ob(),'second-success')]),
  preparedBranches:new Map([['second-success',{plan:{input:move('c')},ex:third}]])}]]);
 const p=policyFrom(first,nested,'A',inspect);assert.equal(p.complete,true);assert.equal(p.maxDepth,2);
 assert.ok(Math.abs(p.ex.pTurnover-.4)<1e-8);assert.ok(Math.abs(p.ex.pTouchdown-.6)<1e-8);assert.equal(p.ex.outcomes.length,3);
 assert.deepEqual(p.transitions.map(t=>t.depth),[1,2]);assert.ok(p.transitions.every(t=>Math.abs(t.mass-.8)<1e-8));
});
test('central walker refuses unbound recovery, dangling/missing-key evidence and recursive plans',()=>{
 const first={input:move('a'),ex:ex([branch(1,ob(),'root')])},follow={plan:{input:move('b'),recovery:{plans:[{ball:ob().ball.pos,input:move('c')}]}},ex:ex([branch(1,ob(),'child')])};
 let p=policyFrom(first,new Map([['root',follow]]),'A',inspect);assert.equal(p.complete,false);assert.ok(p.issues.some(i=>i.reason==='unbound-priced-recovery'));
 p=policyFrom(first,new Map([['missing',{plan:{input:move('b')},ex:follow.ex}]]),'A',inspect);assert.equal(p.complete,false);assert.ok(p.issues.some(i=>i.reason==='dangling-priced-branch'));
 const keyless={input:move('a'),ex:ex([branch(1,ob(),null)])};
 p=policyFrom(keyless,new Map([[null,{plan:{input:move('b')},ex:follow.ex}]]),'A',inspect);assert.equal(p.complete,false);
 const cycle={plan:{input:move('a')},ex:first.ex};cycle.preparedBranches=new Map([['root',cycle]]);
 p=policyFrom(first,new Map([['root',cycle]]),'A',inspect);assert.equal(p.complete,false);assert.ok(p.issues.some(i=>/cycle/.test(i.reason)));
});
test('malformed policy outcome containers and invalid explicit mass cannot certify completeness',()=>{
 for(const bad of [{ok:true,outcomes:{length:1}},ex([null]),ex([branch(1,ob(),'x')],{unresolvedMass:-.1}),ex([branch(1,ob(),'x')],{rest:{p:null}})]){
  assert.equal(completeAction(bad,'A'),false);
  const p=policyFrom({input:move('p'),ex:bad},null,'A',inspect);assert.equal(p.complete,false);
 }
});
test('absorbing TD does not execute or charge a no-longer-needed third recovery goal',()=>{
 const first={input:move('a'),ex:ex([branch(1,ob(),'root')])};
 const p=policyFrom(first,new Map([['root',{plan:{input:move('b'),recovery:{plans:[{ball:ob().ball.pos,input:move('c')}]}},
  ex:ex([{...branch(1,{...ob(),score:{A:1,B:0}},'goal'),touchdown:'A'}])}]]),'A',inspect);
 assert.equal(p.complete,true);assert.equal(p.ex.pTouchdown,1);assert.equal(p.transitions.length,1);assert.equal(p.unknown,0);
});

test('overweight participant mass is structurally invalid, while honest partial mass stays explicit',()=>{
 const over=policyFrom({input:move('p'),ex:ex([branch(.6,ob(),'a'),branch(.6,ob(),'b')])},null,'A',inspect);
 assert.equal(over.structuralComplete,false);assert.equal(over.complete,false);assert.ok(over.unknown>0);assert.ok(over.issues.some(i=>i.reason==='non-unit-participant-mass'));
 const partial=policyFrom({input:move('p'),ex:ex([branch(.98,ob(),'a')],{rest:{p:.02},unresolvedMass:.02})},null,'A',inspect);
 assert.equal(partial.structuralComplete,true);assert.equal(partial.complete,false);assert.ok(Math.abs(partial.unknown-.02)<1e-8);
});

test('mismatched stages do not charge either side an absolute critical cost',()=>{
 const c=line(move('b'),20,'after examined follow-up'),i=line(move('a'));
 c.criticalReplyAdjustment=-298.445;i.criticalReplyAdjustment=-298.434;
 const r=inspect.contenderEvidence(c,i);assert.equal(r.replyDelta,0);assert.equal(r.eligible,false);
 assert.equal(r.replyBasis.mode,'incomparable-reply-boundary');assert.equal(r.replyBasis.criticalDelta,null);
 assert.equal(r.replyBasis.challengerCritical,-298.445);assert.equal(r.replyBasis.incumbentCritical,-298.434);
});
