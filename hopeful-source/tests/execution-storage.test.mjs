import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPlan,armStep,reconcile,planView,publicFacts} from '../src/execution.mjs';
// Expose only the pure codec to this test. The shipped module has no test API.
const source=readFileSync(new URL('../src/execution.mjs',import.meta.url),'utf8').replace("from './availability.mjs'",'from '+JSON.stringify(new URL('../src/availability.mjs',import.meta.url).href));
const {pack,unpack}=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {pack,unpack};').toString('base64'));
const bytes=x=>Buffer.byteLength(JSON.stringify(x));
const identity={coachId:'test',version:'1',contextSchema:'test'};
const move=n=>({kind:'playerAction',playerId:'p',action:'move',path:[{kind:'step',to:{x:n,y:1}}]});
const ob=(n=0)=>({apiVersion:1,phase:'play',pending:null,active:'A',team:'A',drive:1,half:1,format:'sevens',turn:{A:1,B:1},
 requestId:n+1,revision:`${n}:-:0`,players:[{id:'p',team:'A',pos:{x:n,y:1},usage:{unfamiliarResource:'保留',nested:[false,null,3]}}],
 ball:{kind:'held',playerId:'p'},teams:{A:{rerolls:2},B:{rerolls:1}}});
function graph(){const o=ob(),nodes=[
 {input:move(1),branches:[{mass:.6,observation:ob(1),next:1},{mass:.4,observation:ob(2),next:2}]},
 {input:move(3),branches:[{mass:.7,observation:ob(3),next:3},{mass:.2,observation:ob(4),next:null}]},
 {input:move(4),branches:[{mass:1,observation:ob(4),next:null}]},
 {input:move(5),branches:[{mass:1,observation:ob(5),next:null}]}];
 const saved=createPlan(o,{id:'conditional',identity,nodes});assert.ok(saved.plan,saved.reason);return {o,plan:saved.plan};}
const apply=(anchor,patch)=>{let out=structuredClone(anchor);for(const p of patch){if(!p.path.length){out=structuredClone(p.value);continue;}
 let at=out;for(const k of p.path.slice(0,-1))at=at[k];const last=p.path.at(-1);if(p.remove)delete at[last];else at[last]=structuredClone(p.value);}return out;};
test('lossless shape defaults preserve complete JSON, Unicode, nulls and masks through 52 fields',()=>{
 let compressed=0;
 for(let width=0;width<=60;width++){
  const x=Array.from({length:20},(_,n)=>Object.fromEntries(Array.from({length:width},(_,k)=>['field'+k,k%5===0?{nested:[n%2,'重复文字',null]}:k%4===0?n:k%3===0?true:'complete shared text'])));
  const p=pack(x);assert.deepEqual(unpack(p),x);if(p.defaults)compressed++;
 }
 assert.ok(compressed>20);
 const unusual=JSON.parse('{"__proto__":{"kept":true},"constructor":"kept","arr":[[],null,false,0,"😀"]}');assert.deepEqual(unpack(pack(unusual)),unusual);
});
test('bounded seeded JSON roundtrip never normalizes missing versus explicit null',()=>{
 let seed=226;const rand=n=>(seed=(Math.imul(seed,1664525)+1013904223)>>>0)%n;
 const gen=depth=>depth<=0?[null,false,true,rand(80),'数据'+rand(5)][rand(5)]:rand(2)?Array.from({length:rand(5)},()=>gen(depth-1)):
  Object.fromEntries(Array.from({length:rand(5)},(_,n)=>['k'+n,gen(depth-1)]));
 for(let n=0;n<500;n++){const x=gen(4);assert.deepEqual(unpack(pack(x)),x);}
 assert.notDeepEqual(unpack(pack({a:null})),unpack(pack({})));
});
test('corrupt packed tags, shape fields, strings, defaults and masks are rejected',()=>{
 const base={value:null,shapes:[['a']],strings:['x'],defaults:{0:[null]}};
 for(const value of [[9],[1,-1,null],[1,0],[1,0,null,1],[2,-1],[2,1],[2,0,1],[3,0,-1],[3,0,2],[3,0,1],[3,0,0,null],[3,99,0]])
  assert.throws(()=>unpack({...base,value}),JSON.stringify(value));
 assert.throws(()=>unpack({...base,shapes:[['a','a']]}));
});
test('stored graph validates acyclicity, exact masses, proposal node and own guard paths',()=>{
 const {o,plan}=graph(),armed=armStep(plan,o,move(1)).plan;
 for(const change of [d=>{d.nodes[0].branches[0].next=0;},d=>{d.nodes[0].branches[0].next=-1;},
  d=>{d.nodes[0].omittedMass=.5;},d=>{d.nodes[0].branches[0].mass=-1;},
  d=>{d.nodes[0].branches[0].guard=[{path:['__proto__','polluted'],value:true}];},
  d=>{d.nodes[0].branches[0].guard=[{path:['constructor','prototype','polluted'],value:true}];}]){
  const corrupt=structuredClone(armed),d=unpack(corrupt.data);change(d);corrupt.data=pack(d);
  assert.equal(reconcile(corrupt,ob(1)).reason,'invalid-plan');
 }
 for(const change of [p=>{p.schema='hopeful-execution/2';},p=>{p.proposal.inputNode=1;},p=>{p.proposal.historyFrom=-1;},p=>{p.proposal.requestId=1.2;}]){
  const corrupt=structuredClone(armed);change(corrupt);assert.equal(reconcile(corrupt,ob(1)).reason,'invalid-plan');
 }
 assert.equal({}.polluted,undefined);
});
test('branch advancement retires only completed or unreachable nodes, preserving every reachable future outcome and unknown mass',()=>{
 const {o,plan}=graph(),old=unpack(plan.data),armed=armStep(plan,o,move(1)).plan;
 const r=reconcile(armed,ob(1));assert.equal(r.status,'candidate-ready');assert.deepEqual(r.candidate.input,move(3));
 const next=unpack(r.plan.data);assert.deepEqual(next.anchor,publicFacts(ob(1)));assert.equal(next.nodes.length,2);
 assert.equal(r.plan.cursor,0);assert.equal(r.plan.completedCount,1);assert.equal(r.plan.expected,null);
 for(const [at,before] of [[0,1],[1,3]]){
  const a=next.nodes[at],b=old.nodes[before];assert.deepEqual(a.input,b.input);assert.equal(a.omittedMass,b.omittedMass);assert.equal(a.branches.length,b.branches.length);
  for(let n=0;n<a.branches.length;n++){assert.equal(a.branches[n].mass,b.branches[n].mass);assert.deepEqual(apply(next.anchor,a.branches[n].guard),apply(old.anchor,b.branches[n].guard));}
 }
 assert.equal(next.nodes[0].branches[0].next,1);assert.equal(next.nodes[0].branches[1].next,null);
 assert.ok(bytes(r.plan)<bytes(armed));
 const second=armStep(r.plan,ob(1),move(3));assert.ok(second.plan);assert.equal(reconcile(second.plan,ob(3)).candidate.input.path[0].to.x,5);
 const unretained=ob(3);unretained.players[0].usage.unfamiliarResource='changed';assert.equal(reconcile(second.plan,unretained).status,'invalidated');
 assert.equal(planView(r.plan).tasks.length,2);
});

const extra=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {storeData,toBase64,fromBase64,compressBytes,decompressBytes,byteChecksum};').toString('base64'));
test('bounded byte codec exactly roundtrips dictionary graphs, random bytes, Unicode and repeated public facts',()=>{
 let seed=230,count=0;const rand=n=>(seed=(Math.imul(seed,1664525)+1013904223)>>>0)%n;
 for(const length of [0,1,2,3,7,8,9,17,18,19,255,768,4095,4096,8192,65536]){
  for(const mode of ['random','repeat']){
   const bytes=Uint8Array.from({length},(_,i)=>mode==='random'?32+rand(90):32+i%37);
   const packed={codec:'lz77-12/2',length,checksum:extra.byteChecksum(bytes),data:extra.toBase64(extra.compressBytes(bytes))};
   assert.deepEqual(new TextEncoder().encode(extra.decompressBytes(packed)),bytes);
  }
 }
 for(let n=0;n<150;n++){
  const value=Array.from({length:20+n%11},(_,i)=>({id:'player'+i,skills:['Dodge','保留完整😀'],
   pos:{x:rand(26),y:rand(15)},fields:Array.from({length:16},(_,j)=>j%3?false:'shared semantic value')}));
  const packed=extra.storeData(value);assert.deepEqual(unpack(packed),value);if(packed.codec)count++;
 }
 assert.ok(count>100);
});
test('malformed byte codec rejects corrupt base64, impossible references, size bombs and truncation',()=>{
 for(const text of ['A','AAAA=','====','AA=A','A===','AB==','AAA?','AA==\n'])assert.throws(()=>extra.fromBase64(text));
 for(const value of [
  {codec:'wrong',length:1,data:'AA=='},{codec:'lz77-12/2',length:-1,data:''},
  {codec:'lz77-12/2',length:65537,data:''},{codec:'lz77-12/2',length:3,data:extra.toBase64([1,0,0])},
  {codec:'lz77-12/2',length:3,data:extra.toBase64([1,1])},{codec:'lz77-12/2',length:3,data:extra.toBase64([0,65])},
  {codec:'lz77-12/2',length:1,data:extra.toBase64([0,65,66])},
  {codec:'lz77-12/2',length:1,data:extra.toBase64([0,255])}])assert.throws(()=>extra.decompressBytes(value));
 const nested=JSON.stringify({codec:'lz77-12/2',length:0,data:''}),b=new TextEncoder().encode(nested);
 assert.throws(()=>unpack({codec:'lz77-12/2',length:b.length,checksum:extra.byteChecksum(b),data:extra.toBase64(extra.compressBytes(b))}));
});

test('dictionary defaults cannot recursively amplify decoded objects, and ordinary decode is globally bounded',()=>{
 const p={shapes:[['a','b','c','d']],strings:[],value:[3,0,0],defaults:{0:[[3,0,0],[3,0,0],[3,0,0],[3,0,0]]}};
 assert.throws(()=>unpack(p),/invalid packed object/);
 let deep=null;for(let n=0;n<70;n++)deep=[0,deep];
 assert.throws(()=>unpack({shapes:[],strings:[],value:deep}),/budget/);
 assert.throws(()=>unpack({shapes:[],strings:['x'.repeat(200)],value:[0,...Array.from({length:2000},()=>[2,0])]}),/budget/);
 const bytes=new TextEncoder().encode(JSON.stringify({shapes:[],strings:[],value:1}));
 const corrupted={codec:'lz77-12/2',length:bytes.length,checksum:extra.byteChecksum(bytes),data:extra.toBase64(extra.compressBytes(bytes))};
 corrupted.checksum^=1;assert.throws(()=>unpack(corrupted),/checksum/);
});

test('producer refuses compressed plans that would exceed the decoder logical budget',()=>{
 const o={...ob(),extra:Array(13000).fill(0)};
 const r=createPlan(o,{id:'oversized-logical-graph',identity,nodes:[{input:{kind:'endTurn'},branches:[]}]});
 assert.equal(r.plan,null);assert.equal(r.reason,'decoded-plan-budget-or-shape-invalid');
});
