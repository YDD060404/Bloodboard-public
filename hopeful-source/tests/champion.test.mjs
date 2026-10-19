import {originalHeldDirectSource,transformHeldDirectSource} from '../scripts/held-direct-transform.mjs';
import {originalExactGeometrySource,transformExactGeometrySource} from '../scripts/exact-geometry-transform.mjs';
import {originalSelectionSource} from '../scripts/selection-source-audit.mjs';
import {originalReplyWindowSource,transformReplyWindowSource} from '../scripts/reply-window-transform.mjs';
import {originalRootRefinementSource,transformRootRefinementSource} from '../scripts/root-refinement-transform.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createChampion,CHAMPION_METADATA} from '../src/champion.mjs';
import {verifiedFixture} from '../scripts/test-deps.mjs';
const source=verifiedFixture('champion-1.5.9.js');
const fixture=JSON.parse(verifiedFixture('champion-game-p0001-L2.json'));
const actual=fixture.decisions.find(r=>r.step===45&&r.observation);
const clone=x=>JSON.parse(JSON.stringify(x));
const hash=x=>createHash('sha256').update(x).digest('hex');
const NativeDate=Date;
class FixedDate extends NativeDate{static now(){return 12345;}}
function frozen(){
 let coach;
 vm.runInNewContext(source,{bloodboard:{register:c=>{assert.equal(coach,undefined);coach=c;}},Date:FixedDate});
 return coach;
}
function root(mode){
 const o=clone(actual.observation),legacy=clone(actual.candidates.slice(0,1));
 o.timeLimitMs=60000;o.builtInChoice={candidateId:legacy[0].id};
 if(mode==='final-turn'){o.turn[o.team]=o.turnsPerHalf;o.score={A:0,B:0};}
 if(mode==='controlled-delay'){
  o.turn[o.team]=2;o.score={A:0,B:0};o.activation=null;
  o.strategicPublic={wizardAvailable:{A:false,B:false}};
  for(const p of o.players)if(p.team!==o.team){p.location='reserves';p.pos=null;}
  const car=o.players.find(p=>p.id===o.ball.playerId);
  car.pos={x:1,y:5};car.activated=false;car.canBeActivated=true;car.stance='standing';
 }
 return {o,legacy};
}
/** Deterministic transcript only, not an engine simulation. It exercises the
 * frozen selection exits without host services or a search-strength claim. */
function services(o,mode){
 const transcript=[],states=new Map();let serial=0;
 const record=(name,args)=>transcript.push([name,clone(args)]);
 const result={transcript,
  candidates:async(...args)=>{record('candidates',args);return {ok:true,complete:true,candidates:mode==='controlled-delay'?
   [{input:{kind:'playerAction',playerId:o.ball.playerId,action:'move',path:[]},pTouchdown:1,pTurnover:0,exact:true,unresolved:0}]:[]};},
  explore:async(...args)=>{
   record('explore',args);if(mode==='fallback')return null;
   const [input,opts]=args,after=clone(states.get(opts?.from)||o);
   if(input.kind==='endTurn')after.active=o.team==='A'?'B':'A';
   const p=after.players.find(p=>p.id===input.playerId),destination=input.path?.at(-1)?.to;
   if(p&&destination)p.pos=clone(destination);
   const terminal=mode==='certain-td'?1:mode==='final-turn'?.5:0,outcomes=[];
   const add=(ob,p,touchdown)=>{const key='mock:'+serial++;states.set(key,ob);outcomes.push({key,p,observation:clone(ob),active:ob.active,turnover:false,touchdown,completed:true});};
   if(terminal){const scored=clone(after);scored.score[o.team]++;add(scored,terminal,o.team);}
   if(terminal<1)add(after,1-terminal,null);
   return {ok:true,exact:true,pTurnover:0,pTouchdown:terminal,unresolvedMass:0,rest:{p:0},outcomes};
  },
  progress:async(...args)=>{record('progress',args);},
  threats:{scoring:async(...args)=>{record('threats.scoring',args);return {ok:true,exact:true,threats:[]};},
   blitz:async(...args)=>{record('threats.blitz',args);return {ok:true,exact:true,blitzes:[]};}}
 };
 return result;
}
test('frozen source SHA and observer identities remain stable; guarded reply transform scope is explicit',()=>{
 assert.equal(hash(source),CHAMPION_METADATA.sourceSha);
 assert.equal(CHAMPION_METADATA.schema,'hopeful-source-derived-champion/2');
 assert.equal(CHAMPION_METADATA.transform,'selection-observer-v1+guarded-reply-window-v1+preparation-safe-root-refinement-v1+explicit-held-direct-time-v1+exact-geometry-v1');
 assert.match(CHAMPION_METADATA.exactGeometryScope,/identical heap push\/pop sequence/);
 assert.equal(CHAMPION_METADATA.baseObserverParser,'typescript');
 assert.match(CHAMPION_METADATA.replyWindowTransformMethod,/exact-count reversible/);
 assert.match(CHAMPION_METADATA.heldDirectTimeScope,/observed held soft deadline/);
 assert.match(CHAMPION_METADATA.instrumentedShaScope,/historical/);
 assert.match(CHAMPION_METADATA.replyWindowScope,/guard-enabled services only/);
 assert.match(CHAMPION_METADATA.replyWindowScope,/shared heldDeadline/);
 assert.match(CHAMPION_METADATA.rootRefinementScope,/at most two/);
 assert.match(CHAMPION_METADATA.guarantee,/preserve the candidate's prior evidence and scores/);
 assert.match(CHAMPION_METADATA.guarantee,/attempted calls still spend search budget/);
 assert.notEqual(CHAMPION_METADATA.instrumentedSha,CHAMPION_METADATA.observerInstrumentedSha);
 assert.deepEqual(CHAMPION_METADATA.insertions.map(x=>[x.mode,x.selected,x.line]),
  [['certain-td','c',717],['final-turn','best',915],['normal','best',1057]]);
 const original=frozen();let bound;
 const transformed=createChampion({onInspector:i=>{bound=i;throw Error('binding observer error');}});
 assert.deepEqual(Object.keys(transformed),Object.keys(original));
 for(const k of Object.keys(original)){
  if(typeof original[k]==='function')assert.equal(typeof transformed[k],'function');
  else assert.deepEqual(clone(transformed[k]),clone(original[k]));
 }
 assert.equal(bound,transformed.inspector);
 assert.equal(Object.isFrozen(bound.CFG),true);assert.equal(Object.isFrozen(bound.CFG.thresholds),true);
 assert.equal(Object.keys(transformed).includes('inspector'),false);
 for(const k of ['boardValue','outcomeValue','canonical','observedTerminalScore','contenderEvidence',
  'replyAssessment','strategicDelta','cheapScore','buildDrivePlan','rememberMovement'])assert.equal(typeof bound[k],'function');
});
test('recorded source transforms and observer insertions reverse to every original source byte',()=>{
 const transformed=readFileSync(new URL('../src/champion.mjs',import.meta.url),'utf8');
 const s434=originalExactGeometrySource(transformed),s416=originalHeldDirectSource(s434),replyWindowSource=originalRootRefinementSource(s416),parent=originalReplyWindowSource(replyWindowSource);
 assert.equal(transformExactGeometrySource(s434),transformed);assert.equal(transformExactGeometrySource(transformed),transformed);
 assert.equal(hash(s434),CHAMPION_METADATA.exactGeometryParentSha256);
 assert.equal(transformHeldDirectSource(s416),s434);assert.equal(transformHeldDirectSource(s434),s434);
 assert.equal(hash(parent),CHAMPION_METADATA.parentModuleSha256);
 assert.equal(transformReplyWindowSource(parent),replyWindowSource);
 assert.equal(transformRootRefinementSource(replyWindowSource),s416);
 assert.equal(transformRootRefinementSource(s416),s416);
 assert.throws(()=>originalRootRefinementSource(s416.replace('refineRootCandidates({candidates:rootAnchors,','refineRootCandidates({candidates:[], rootAnchors,')),/anchor|SHA/i);
 const module=originalSelectionSource(transformed);
 const firstLine=source.slice(0,source.indexOf('\n')+1);
 assert.equal(module.split(firstLine).length,2);
 let body=module.slice(module.indexOf(firstLine),module.lastIndexOf('\n if(!captured||!inspector)'));
 assert.equal(hash(body),CHAMPION_METADATA.observerInstrumentedSha);
 assert.equal(hash(replyWindowSource.slice(replyWindowSource.indexOf(firstLine),replyWindowSource.lastIndexOf('\n if(!captured||!inspector)'))),CHAMPION_METADATA.instrumentedSha);
 const insertions=CHAMPION_METADATA.insertions.map(p=>
  '__championSelected(o,'+p.selected+',lines,'+JSON.stringify(p.mode)+');\n        ');
 insertions.push('__championBind({CFG,boardValue,outcomeValue,canonical,observedTerminalScore,contenderEvidence,replyAssessment,strategicDelta,cheapScore,buildDrivePlan,rememberMovement});\n  ');
 for(const text of insertions){assert.equal(body.split(text).length,2);body=body.replace(text,'');}
 assert.equal(body,source);
});
for(const mode of ['certain-td','final-turn','normal','fallback','controlled-delay'])test(
 `fixed-clock ${mode}: full observer isolation and frozen compatibility with only zero refinement metadata`,async()=>{
 const {o,legacy}=root(mode),original=frozen(),a=services(o,mode),b=services(o,mode),c=services(o,mode);let seen;
 const unobserved=createChampion();
 const transformed=createChampion({onSelected:x=>{seen=x;throw Error('selection observer error');}});
 try{
  globalThis.Date=FixedDate;
  const before=await original.chooseAction(clone(o),clone(legacy),a);
  const withoutObserver=await unobserved.chooseAction(clone(o),clone(legacy),c);
  const after=await transformed.chooseAction(clone(o),clone(legacy),b);
  assert.deepEqual(clone(after),clone(withoutObserver));assert.deepEqual(b.transcript,c.transcript);
  const compatible=clone(withoutObserver);
  if(['final-turn','normal'].includes(mode)){
   assert.equal(Object.hasOwn(before.trace.search,'rootRefinement'),false);
   assert.deepEqual(compatible.trace.search.rootRefinement,{schema:'s4-15-root-refinement/1',
    eligible:0,attempted:0,committed:0,refused:0,samples:[],
    scope:'same-request root-only refinement before preparation; incomplete evidence remains unknown'});
   delete compatible.trace.search.rootRefinement;
  }
  assert.deepEqual(compatible,clone(before));assert.deepEqual(c.transcript,a.transcript);
  if(['fallback','controlled-delay'].includes(mode))assert.equal(seen,undefined);
  else{assert.equal(seen.mode,mode);assert.deepEqual(clone(seen.selected.input),after.input);}
  if(mode==='controlled-delay')assert.equal(after.trace.objective,'controlled delay');
  if(mode==='fallback')assert.equal(after.trace.selection.intentionalFallback,true);
 }finally{globalThis.Date=NativeDate;}
});
test('null fallback does not invent a selected snapshot or context',async()=>{
 const {o}=root('fallback');delete o.builtInChoice;let seen;
 const a=services(o,'fallback'),b=services(o,'fallback');
 try{
  globalThis.Date=FixedDate;
  const before=await frozen().chooseAction(clone(o),[],a);
  const after=await createChampion({onSelected:x=>{seen=x;}}).chooseAction(clone(o),[],b);
  assert.equal(before,null);assert.equal(after,null);assert.equal(seen,undefined);
  assert.deepEqual(a.transcript,b.transcript);
 }finally{globalThis.Date=NativeDate;}
});
