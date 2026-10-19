import test from 'node:test';
import assert from 'node:assert/strict';
import {challengeDefense} from '../src/defense.mjs';
import {createChampion} from '../src/champion.mjs';

const original=createChampion().inspector;
const move=(actor,to)=>({kind:'playerAction',playerId:actor,action:'move',path:[{to,kind:'step'}]});
const firstInput=move('inc',{x:11,y:1}),alternative=move('support',{x:5,y:3});
const contact={kind:'playerAction',playerId:'contact',action:'blitz',path:[],blitzTarget:'anchor',blockTarget:'anchor'};
const scoring=move('carrier',{x:0,y:5});
function observation(world='root',active='A',value=0){
 const player=(id,team,x,y,activated=false)=>({id,team,location:'pitch',pos:{x,y},stance:'standing',activated,ma:6,st:3,ag:3,skills:[]});
 return {team:'A',active,world,testValue:value,phase:'play',turn:{A:1,B:1},turnsPerHalf:6,
  pitch:{width:16,height:11,endZone:{A:15,B:0}},ball:{kind:'held',playerId:'carrier'},activation:null,
  players:[player('carrier','B',8,5),player('contact','B',6,5),player('anchor','A',5,5,true),
   player('inc','A',10,0),player('support','A',10,2),player('helper','A',11,2)]};
}
function outcome(world,key,active='B',p=1,value=0){return {key,p,active,completed:true,turnover:false,touchdown:null,observation:observation(world,active,value)};}
const explored=outcomes=>({ok:true,outcomes,pTurnover:0,pTouchdown:0,unresolvedMass:0,rest:{p:0}});
// Only graph transport and board-value inputs are synthetic. Production policy
// arithmetic and contenderEvidence are retained, including the fixed margins.
const inspect={...original,boardValue:()=>0,
 outcomeValue:ex=>({value:ex.outcomes.reduce((v,b)=>v+b.p*b.observation.testValue,0)}),
 observedTerminalScore:(ex,team)=>ex.ok?(ex.outcomes||[]).reduce((v,b)=>v+(b.observation&&b.touchdown===team?b.p:0),0):0};
function fixture({contactQuery='complete',states=1,reserved=false,keyless=false,cap=false,
 contactLive=false,keylessContact=false,keylessEndActivation=false,scoreKeyless=false,incScore=.1}={}){
 const calls=[],o=observation();
 const branches=states===3?[.4,.35,.25]:[1];
 const firstEx=explored(branches.map((p,i)=>outcome('inc',`inc:${i}`,'B',p,20)));
 const selected={...inspect.canonical({input:firstInput},o),ex:firstEx,preparedBranches:new Map()};
 if(keyless||cap){selected.ex=explored([outcome('inc:first','inc:first','A',1,20)]);
  const child=outcome('inc:helper-next',cap?null:undefined,'A',1,20);
  const helper=move('helper',{x:6,y:3});
  selected.preparedBranches.set('inc:first',{plan:{input:helper},ex:{...explored([child]),diagnostics:cap?[{code:'position-cap'}]:[]}});
 }
 const positiveKey='inc:helper-next';
 const services={
  async validate(input,q){calls.push({method:'validate',input,query:q});return {ok:true,position:q.from,legal:true};},
  async candidates(q){calls.push({method:'candidates',query:q});
   if(q.families.includes('blitz')){
    if(contactQuery==='failed')return {ok:false,code:'timeout',message:'candidate query exhausted its budget'};
    if(contactQuery==='thrown')throw new Error('transport failure while discovering contact inputs');
    if(contactQuery==='malformed')return {ok:true,candidates:null,hasMore:false};
    if(contactQuery==='malformed-entry')return {ok:true,candidates:[{input:{kind:'playerAction',action:'blitz',path:[]}}],hasMore:true};
    if(contactQuery==='malformed-empty-target')return {ok:true,candidates:[{input:{...contact,blitzTarget:'',blockTarget:''}}],hasMore:true};
    if(contactQuery==='malformed-path')return {ok:true,candidates:[{input:{...contact,path:[{}]}}],hasMore:true};
    if(contactQuery==='truncated')return {ok:true,candidates:[],hasMore:true,truncated:['limit']};
    if(contactQuery==='finite')return {ok:true,candidates:[{input:contact}],hasMore:true};
    return {ok:true,candidates:[],hasMore:false};
   }
   if(q.players)return {ok:true,candidates:[{kind:'score',input:scoring}],hasMore:false};
   return {ok:true,candidates:q.from?[]:[{input:alternative}],hasMore:false};
  },
  async explore(input,options={}){calls.push({method:'explore',input,options});
   if(input.kind==='endTurn'){
    // Omitting a child key really returns ROOT, never the intended child.
    const world=options.from===positiveKey?'inc:helper-closed':options.from?'inc:closed':'ROOT:CLOSED';
    return explored([outcome(world,`${world}:B`)]);
   }
   if(input.kind==='endActivation'){
    if(contactLive&&String(options.from).endsWith(':CONTACT'))return explored([
     outcome('actual-contact-closed',keylessEndActivation?null:`${options.from}:CLOSED`)]);
    return {ok:false,message:'already activated'};
   }
   if(input.action==='blitz'){
    if(input.path?.some(step=>!step.to))return {ok:false,code:'invalid-argument',message:'a path step needs destination coordinates'};
    if(contactLive){const b=outcome('actual-contact-live',keylessContact?null:`${options.from}:CONTACT`);
     b.observation.activation={playerId:'contact',action:'blitz',over:false,maUsed:0};return explored([b]);}
    if(contactQuery==='finite')return explored([{...outcome('actual-contact-terminal',`contact:${options.from}`,'A'),turnover:true}]);
    return {ok:false,message:'target is not on the pitch'};
   }
   if(input.playerId==='carrier'){
    const inc=String(options.from).startsWith('inc:')||String(options.from).startsWith('ROOT:');
    const safe=outcome('terminal',scoreKeyless?null:`terminal:${options.from}`,'B',inc ? 1-incScore : 1);
    if(!inc)return explored([safe]);
    const td={...outcome('terminal-TD',scoreKeyless?null:`TD:${options.from}`,'B',incScore),touchdown:'B'};
    return explored([td,safe]);
   }
   if(input.playerId==='support')return explored(branches.map((p,i)=>outcome('alternative',`alternative:${i}`,'B',p)));
   throw new Error(`unexpected graph edge: ${JSON.stringify({input,options})}`);
  }
 };
 const reservation=reserved?{attempted:true,records:[],sharedContacts:[contact],routeSeeds:[],contactTransitions:[]}:null;
 return {o,selected,services,calls,reservation,positiveKey};
}
async function run(f){return challengeDefense(f.o,{mode:'normal',selected:f.selected},[],f.services,inspect,Date.now()+15000,f.reservation);}
test('a shared contact must be legal at each actual screen endpoint before exploration',async()=>{
 const f=fixture({contactQuery:'finite'});
 f.services.validate=async(input,q)=>{f.calls.push({method:'validate',input,query:q});
  return {ok:true,position:q.from,legal:input.action!=='blitz'||String(q.from).startsWith('inc:'),errors:['The target must be adjacent.']};};
 const r=await run(f);
 assert.ok(r.evidence.sharedInputValidation.some(x=>x.verified&&x.legal===false));
 assert.ok(f.calls.some(x=>x.method==='explore'&&x.input.action==='blitz'&&String(x.options.from).startsWith('inc:')));
 assert.ok(!f.calls.some(x=>x.method==='explore'&&x.input.action==='blitz'&&!String(x.options.from).startsWith('inc:')));
});
test('failed or foreign shared-input validation keeps reply uncertainty rather than certifying impossibility',async()=>{
 for(const mode of ['foreign','failed','missing']){
  const f=fixture({contactQuery:'finite'});
  if(mode==='missing')delete f.services.validate;
  else f.services.validate=async()=>mode==='failed'?{ok:false,code:'timeout'}:{ok:true,position:'foreign',legal:false};
  const r=await run(f);
  assert.equal(r.selected,null,mode);
  assert.ok(r.evidence.sharedInputValidation.some(x=>!x.verified&&x.legal===null));
  assert.ok(!f.calls.some(x=>x.method==='explore'&&x.options.team==='B'));
  assert.ok(r.evidence.policies.some(x=>x.contactUnknown>0));
 }
});
for(const kind of ['failed','truncated','thrown','malformed','malformed-entry','malformed-empty-target','malformed-path'])for(const reserved of [false,true]){
 test(`contact domain ${kind}, reserved seed ${reserved}: missing query cannot become complete safe coverage`,async()=>{
  const f=fixture({contactQuery:kind,reserved}),r=await run(f);
  assert.ok(r.evidence.policies.length>=2,'both real competitor closures were reached');
  for(const p of r.evidence.policies){assert.ok(p.contactUnknown>0,`${kind} query must carry unknown probability`);
   assert.ok(p.observedReplyMass<1,'a failed/unlisted contact universe is not full coverage');}
  assert.equal(r.selected,null,'absence of queried threats cannot grant positive emergency safety credit');
  const effective=r.selected??f.selected;
  assert.strictEqual(effective,f.selected,'the caller retains its available champion when no challenger is endorsed');
  assert.deepEqual(effective.input,firstInput,'fail closed does not manufacture a global End action');
  assert.equal(effective.ex.ok,true,'the original legally explored action remains available');
 });
}
test('a successful nonempty hasMore query establishes a finite common domain without claiming exhaustive coverage',async()=>{
 const f=fixture({contactQuery:'finite'}),r=await run(f);
 assert.ok(r.selected,'a real finite domain and actual complete endpoints may pass the existing interval margin');
 assert.deepEqual(r.evidence.sharedContacts,[contact]);
 for(const p of r.evidence.policies){assert.equal(p.contactUnknown,0);
  assert.equal(p.observedReplyMass,1,'all responses in this finite graph were actually observed');
  assert.ok(p.branches.every(b=>b.unsearchedContactDomain),'other possible contacts stay explicitly outside the finite model');}
 assert.equal(r.selected.checkedReplyMass,0,'finite model does not become a complete Turn reply proof');
 assert.equal(r.selected.boundedReplyMass,0);
});
test('states not queried because of the bounded proposal limit retain their weighted unknown mass',async()=>{
 const f=fixture({states:3}),r=await run(f);
 assert.ok(r.evidence.policies.length>=2);
 for(const p of r.evidence.policies){const minimumGap=p.input.playerId==='inc' ? .25*(1-.1) : .25;
  assert.ok(p.contactUnknown>=minimumGap-1e-8,'unqueried state mass .25 reserves its remaining score upper bound');
  assert.ok(p.observedReplyMass<=.75+1e-8,'only .75 of state-weighted domains was queried');}
 assert.equal(r.selected,null,'unqueried state cannot create safety gain');
});
for(const cap of [false,true])test(`${cap?'position-cap null':'undefined'} own helper key cannot close from root`,async()=>{
 const f=fixture({keyless:true,cap}),r=await run(f);
 const leaked=f.calls.filter(c=>c.method==='explore'&&c.input.kind==='endTurn'&&!c.options.from);
 assert.deepEqual(leaked,[],'child closure must not omit from and fall back to root');
 assert.ok(!r.evidence.policies.some(p=>p.branches.some(b=>b.from==='ROOT:CLOSED:B')),'root closure is not helper branch evidence');
 assert.equal(r.selected,null,'missing own-phase continuation identity must reject/retain unknown');
});
test('positive keyed helper closes the actual child, with distinct root and child identities',async()=>{
 const f=fixture({keyless:true});
 f.selected.preparedBranches.get('inc:first').ex.outcomes[0].key=f.positiveKey;
 const r=await run(f);
 assert.ok(f.calls.some(c=>c.method==='explore'&&c.input.kind==='endTurn'&&c.options.from===f.positiveKey));
 const first=r.evidence.policies[0];assert.ok(first,'incumbent closure evaluated');
 assert.ok(first.branches.some(b=>b.from==='inc:helper-closed:B'),'actual helper closure identity retained');
 assert.ok(!first.branches.some(b=>b.from==='ROOT:CLOSED:B'));
});
test('a complete first own outcome without a retained key cannot become a comparable closure',async()=>{
 const f=fixture();f.selected.ex.outcomes[0].key=null;
 const r=await run(f);
 assert.equal(r.selected,null);
 assert.ok(r.evidence.ownUncertainty.some(e=>e.reason==='unretained-first-own-outcome'&&e.unknown===1));
 assert.ok(!f.calls.some(c=>c.method==='explore'&&c.input.kind==='endTurn'&&!c.options.from));
});
for(const stage of ['contact','endActivation'])test(`${stage} position-cap key loss cannot continue scoring from root`,async()=>{
 const f=fixture({contactQuery:'finite',contactLive:true,keylessContact:stage==='contact',keylessEndActivation:stage==='endActivation'});
 const r=await run(f);
 assert.equal(r.selected,null);
 assert.ok(r.evidence.policies.every(p=>p.contactUnknown>0&&p.observedReplyMass===0));
 assert.ok(!f.calls.some(c=>c.method==='explore'&&(!c.options.from||c.options.from==='root')&&
  (c.input.playerId==='carrier'||c.input.kind==='endActivation')),'child reply never explores from implicit/explicit root');
 if(stage==='contact')assert.ok(!f.calls.some(c=>c.method==='explore'&&c.input.kind==='endActivation'));
 if(stage==='endActivation')assert.ok(!f.calls.some(c=>c.method==='explore'&&c.input.playerId==='carrier'&&String(c.options.from).includes(':CONTACT')));
});
test('retained contact and EndActivation keys score only from the actual closed contact state',async()=>{
 const f=fixture({contactQuery:'finite',contactLive:true}),r=await run(f);
 assert.ok(r.selected,'the complete finite graph remains eligible');
 assert.ok(f.calls.some(c=>c.method==='explore'&&c.input.kind==='endActivation'&&String(c.options.from).endsWith(':CONTACT')));
 assert.ok(f.calls.some(c=>c.method==='explore'&&c.input.playerId==='carrier'&&String(c.options.from).endsWith(':CONTACT:CLOSED')));
 assert.ok(!f.calls.some(c=>c.method==='explore'&&c.input.playerId==='carrier'&&(!c.options.from||c.options.from==='root')));
});
test('terminal score observations need no successor key when no further action is evaluated',async()=>{
 const f=fixture({contactQuery:'finite',scoreKeyless:true}),r=await run(f);
 assert.ok(r.selected,'keyless terminal observations do not erase an actually observed score');
 assert.ok(r.evidence.policies.every(p=>p.observedReplyMass===1&&p.contactUnknown===0));
});
test('an incumbent score already proved with mass1 still cannot erase failed domain discovery',async()=>{
 const f=fixture({contactQuery:'failed',incScore:1}),r=await run(f);
 assert.equal(r.selected,null);
 assert.ok(r.evidence.policies.every(p=>p.contactDomainUnknown===1&&p.observedReplyMass===0));
 assert.equal(r.evidence.policies[0].contactUnknown,0,'known score mass is not charged twice');
 assert.equal(r.evidence.policies[0].branches[0].scoreLowerBound,1,'failed discovery cannot erase an actually observed legal TD');
 assert.equal(r.evidence.policies[0].criticalReplyAdjustment,-inspect.CFG.opponentScore,'verified TD retains its critical cost, with no duplicate unresolved penalty');
 assert.strictEqual(r.selected??f.selected,f.selected,'unknown restricts positive proof, not availability of the champion');
 assert.ok(r.evidence.policies.slice(1).every(p=>p.gate.domainEstablished===false));
});
test('complete nested dependency leaves supply BOTH scalar risk and actual opponent reply parents',async()=>{
 const f=fixture({keyless:true}),follow=f.selected.preparedBranches.get('inc:first');follow.ex.outcomes[0].key=f.positiveKey;
 follow.preparedBranches=new Map([[f.positiveKey,{plan:{input:move('support',{x:6,y:4})},ex:explored([
  outcome('third-success','THIRD:success','B',.75,30),{...outcome('third-failure','THIRD:failure','B',.25,-40),turnover:true}])}]]);
 const r=await run(f),first=r.evidence.policies[0];assert.ok(first);assert.equal(first.ownPolicy.pTurnover,.25);assert.equal(first.ownPolicy.depth,2);
 assert.deepEqual(first.branches.map(b=>b.from),['THIRD:success','THIRD:failure']);
 assert.ok(!first.branches.some(b=>b.from==='inc:helper-closed:B'),'second-action state cannot stand in for the full policy endpoint');
});
