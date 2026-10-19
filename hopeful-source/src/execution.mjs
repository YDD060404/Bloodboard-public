import {available} from './availability.mjs';
/** V6 5297f51 execution boundary. API2 sinceLast has factual outcomes but only
 * kind/playerId/action/special input summaries. It cannot confirm path/targets
 * or fallback source. A matching public branch is adopted honestly as current
 * evidence, never described as confirmation of the submitted complete input.
 */
export const EXECUTION_SCHEMA='hopeful-execution/6';
const clone=x=>JSON.parse(JSON.stringify(x));
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?
 Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const equal=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const size=x=>new TextEncoder().encode(JSON.stringify(x)).length;
const probability=x=>Number.isFinite(x)&&x>=0&&x<=1;
const input=x=>x&&typeof x.kind==='string';
const controlKeys=['apiVersion','apiMinor','schemaVersion','engineVersion','requestId','revision',
 'timeLimitMs','sinceLast','coachContext','contextInfo','hostExtensions','builtInChoice'];

/** Rule facts, with all players/resources retained. request/revision/history are
 * transport metadata. canBeActivated is a derived discovery hint, which may
 * differ in previews; underlying player facts remain and next input MUST be
 * freshly validated by the real engine. v1 explore observations lack v2 static
 * rule/resource additions: inherit those from the root, so a real change to an
 * unpredicted extra resource rejects adoption rather than silently ignoring it.
 */
export function publicFacts(observation,base=null){
 const o=clone(observation);
 for(const k of controlKeys)delete o[k];
 if(o.match){delete o.match.historyLength;delete o.match.stateRevision;}
 if(o.pitch){delete o.pitch.w;delete o.pitch.h;delete o.pitch.wideRows;delete o.pitch.losColumn;}
 for(const p of o.players??[])delete p.canBeActivated;
 // The planner preview retains an already closed activation; real execute()
 // auto-ends it. This field alone has no future choice semantics. Keep every
 // player/resource fact, including resulting temp-skill or Bloodlust changes.
 // A hungry or stalling activation still has consequences and cannot be erased.
 if(o.activation?.over===true&&!o.activation.hungry&&o.activation.bloodlust!=='hungry'&&
    !o.activation.stallingCandidate)o.activation=null;
 o.players?.sort((a,b)=>a.id.localeCompare(b.id));
 for(const k of ['engine','ruleset','resources','match','strategicPublic'])if(o[k]===undefined&&base?.[k]!==undefined)o[k]=clone(base[k]);
 if(!observation.resources&&o.resources){
  for(const t of ['A','B']){
   const r=o.resources[t],team=o.teams?.[t];if(!r||!team)continue;
   r.teamRerolls=team.rerolls>0?{status:'available',count:team.rerolls}:{status:'exhausted',count:0};
   r.bonusRerolls=team.bonusRerolls?{status:'available',count:team.bonusRerolls,note:'expires at the end of the Drive; used first'}:{status:'unavailable'};
   r.leaderReroll=team.leaderReroll?{status:'available',count:1}:{status:'unavailable',count:0,note:'no Leader re-roll this half'};
   r.mascotReroll=team.mascotReroll?{status:'available',count:1}:{status:'unavailable'};
   r.apothecary=team.apothecary==='available'?{status:'available',count:1}:team.apothecary==='used'?{status:'used',count:0}:{status:'unavailable'};
   if(t===o.active)for(const k of Object.keys(r.turnWindow??{}))r.turnWindow[k]={status:o.used?.[k]?'used':'available'};
  }
 }
 return stable(o);
}
function scope(o){return stable({team:o.team,active:o.active,format:o.format,half:o.half,
 drive:o.drive,turn:o.turn,matchId:o.match?.matchId??null});}
function normal(o){return o?.phase==='play'&&!o.pending&&o.active===o.team;}
function historyLength(o){return Number.isInteger(o.match?.historyLength)?o.match.historyLength:
 Number.isInteger(o.sinceLast?.to)?o.sinceLast.to:
 typeof o.revision==='string'&&/^\d+:[^:]*:\d+$/.test(o.revision)?Number(o.revision.split(':')[0]):null;}

// Exact dictionary packing, not a probabilistic hash. Repeated player object
// shapes share key lists; branch guards are exact patches against one anchor.
function pack(value){
 const shapes=[],indices=new Map(),strings=[],stringIndices=new Map(),frequencies=new Map();
 const count=x=>{if(typeof x==='string')frequencies.set(x,(frequencies.get(x)||0)+1);
  else if(Array.isArray(x))x.forEach(count);else if(x&&typeof x==='object')Object.values(x).forEach(count);};
 count(value);
 const visit=x=>{
  if(Array.isArray(x))return [0,...x.map(visit)];
  if(typeof x==='string'&&x.length>=8&&(frequencies.get(x)||0)>1){let n=stringIndices.get(x);if(n===undefined){n=strings.length;stringIndices.set(x,n);strings.push(x);}return [2,n];}
  if(!x||typeof x!=='object')return x;
  const keys=Object.keys(x).sort(),key=JSON.stringify(keys);
  let n=indices.get(key);if(n===undefined){n=shapes.length;indices.set(key,n);shapes.push(keys);}
  return [1,n,...keys.map(k=>visit(x[k]))];
 };
 const dense={value:visit(value),shapes,strings};
 // Lossless shape defaults encode repeated complete values once. No fields,
 // guards, resource facts, probabilities or branches are discarded. Select
 // defaults per shape only when their complete dictionary cost pays for itself;
 // retain the original dense form if the final payload would grow.
 const groups=new Map();
 const scan=x=>{if(!Array.isArray(x))return;
  if(x[0]===1){const rows=groups.get(x[1])||[];rows.push(x);groups.set(x[1],rows);}
  for(const child of x.slice(x[0]===1?2:1))scan(child);
 };
 scan(dense.value);const defaults={};
 const sparseRow=(row,base,convert=x=>x)=>{let mask=0;const values=[];
  for(let i=0;i<base.length;i++)if(JSON.stringify(row[i+2])!==JSON.stringify(base[i])){mask+=2**i;values.push(convert(row[i+2]));}
  return [3,row[1],mask,...values];
 };
 for(const [shape,rows] of groups){
  if(rows.length<3||shapes[shape].length<4||shapes[shape].length>52)continue;
  const base=shapes[shape].map((_,i)=>{
   const counts=new Map();for(const row of rows){const key=JSON.stringify(row[i+2]);const item=counts.get(key)||{value:row[i+2],count:0};item.count++;counts.set(key,item);}
   return [...counts.values()].sort((a,b)=>b.count-a.count)[0].value;
  });
  let saving=0;for(const row of rows){const sparse=sparseRow(row,base);
   saving+=Math.max(0,JSON.stringify(row).length-JSON.stringify(sparse).length);
  }
  if(saving>JSON.stringify(base).length+String(shape).length+8)defaults[shape]=base;
 }
 const compact=x=>{if(!Array.isArray(x))return x;
  if(x[0]===0)return [0,...x.slice(1).map(compact)];
  if(x[0]!==1)return x;
  const full=[1,x[1],...x.slice(2).map(compact)],base=defaults[x[1]];
  if(!base)return full;
  const sparse=sparseRow(x,base,compact);
  return JSON.stringify(sparse).length<JSON.stringify(full).length?sparse:full;
 };
 const smaller={value:compact(dense.value),shapes,strings,defaults};
 return size(smaller)<size(dense)?smaller:dense;
}
// Optional bounded byte compression over the existing exact JSON codec. This
// retains every guard and scalar; decompression is capped before allocation.
// References are backwards only (12-bit distance, 3..18 byte match length).
const BASE64='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function toBase64(bytes){let s='';for(let i=0;i<bytes.length;i+=3){const a=bytes[i],b=bytes[i+1],c=bytes[i+2],n=(a<<16)|((b||0)<<8)|(c||0);
 s+=BASE64[n>>>18]+BASE64[n>>>12&63]+(b===undefined?'=':BASE64[n>>>6&63])+(c===undefined?'=':BASE64[n&63]);}return s;}
function fromBase64(s){
 if(typeof s!=='string'||s.length>100000||s.length%4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s))throw Error('invalid compressed base64');
 const bytes=[];for(let i=0;i<s.length;i+=4){const a=BASE64.indexOf(s[i]),b=BASE64.indexOf(s[i+1]),c=BASE64.indexOf(s[i+2]),d=BASE64.indexOf(s[i+3]);
  bytes.push(a<<2|b>>4);if(c>=0)bytes.push((b&15)<<4|c>>2);if(d>=0)bytes.push((c&3)<<6|d);}
 if(toBase64(bytes)!==s)throw Error('noncanonical compressed base64');return bytes;
}
function byteChecksum(bytes){let hash=2166136261;for(const byte of bytes)hash=Math.imul(hash^byte,16777619)>>>0;return hash;}
function compressBytes(bytes){
 const out=[],seen=new Map(),key=i=>bytes[i]*65536+bytes[i+1]*256+bytes[i+2];
 const remember=i=>{if(i+2>=bytes.length)return;const k=key(i),a=seen.get(k)||[];a.push(i);
  while(a.length>48||a[0]<i-4095)a.shift();seen.set(k,a);};
 for(let at=0;at<bytes.length;){const flagAt=out.length;out.push(0);let flags=0;
  for(let bit=0;bit<8&&at<bytes.length;bit++){
   let length=0,distance=0;
   if(at+2<bytes.length){const starts=seen.get(key(at))||[];
    for(let n=starts.length-1;n>=0;n--){const p=starts[n];if(at-p>4095)break;let size=0;
     while(size<18&&at+size<bytes.length&&bytes[p+size]===bytes[at+size])size++;
     if(size>length&&size>=3){length=size;distance=at-p;if(length===18)break;}}
   }
   if(length>=3){flags|=1<<bit;out.push(distance>>4,((distance&15)<<4)|(length-3));}
   else {length=1;out.push(bytes[at]);}
   for(let n=0;n<length;n++)remember(at+n);at+=length;
  }
  out[flagAt]=flags;
 }
 return out;
}
function decompressBytes(value){
 if(value?.codec!=='lz77-12/2'||!Number.isInteger(value.length)||value.length<0||value.length>65536||!Number.isInteger(value.checksum)||value.checksum<0||value.checksum>4294967295)throw Error('invalid compressed size');
 const bytes=fromBase64(value.data),out=new Uint8Array(value.length);let at=0,count=0;
 while(at<bytes.length&&count<out.length){const flags=bytes[at++];
  for(let bit=0;bit<8&&count<out.length;bit++){
   if(at>=bytes.length)throw Error('truncated compressed bytes');
   if(flags&(1<<bit)){if(at+1>=bytes.length)throw Error('truncated compressed reference');
    const a=bytes[at++],b=bytes[at++],distance=a*16+(b>>4),length=(b&15)+3;
    if(distance<1||distance>count||count+length>out.length)throw Error('invalid compressed reference');
    for(let n=0;n<length;n++){out[count]=out[count-distance];count++;}
   }else out[count++]=bytes[at++];
  }
 }
 if(at!==bytes.length||count!==out.length)throw Error('invalid compressed extent');
 if(byteChecksum(out)!==value.checksum)throw Error('compressed checksum mismatch');
 // Decode strict UTF-8 without depending on TextDecoder in older workers.
 return decodeURIComponent([...out].map(x=>'%'+x.toString(16).padStart(2,'0')).join(''));
}
function storeData(value){
 const packed=pack(value),encoded=JSON.stringify(packed),bytes=new TextEncoder().encode(encoded);
 if(bytes.length<768||bytes.length>65536)return packed;
 const smaller={codec:'lz77-12/2',length:bytes.length,checksum:byteChecksum(bytes),data:toBase64(compressBytes(bytes))};
 return size(smaller)+24<size(packed)?smaller:packed;
}

function unpack(p){
 if(p?.codec!==undefined){const decoded=JSON.parse(decompressBytes(p));if(decoded?.codec!==undefined)throw Error('nested compression');p=decoded;}
 if(!p||!Array.isArray(p.shapes)||!Array.isArray(p.strings)||
  p.shapes.some(keys=>!Array.isArray(keys)||keys.some(k=>typeof k!=='string')||new Set(keys).size!==keys.length)||
  p.strings.some(x=>typeof x!=='string'))throw Error('invalid packed dictionaries');
 let decodedUnits=0,decodedNodes=0;
 const charge=n=>{decodedUnits+=n;if(decodedUnits>262144)throw Error('decoded graph budget exceeded');};
 const shape=n=>{if(!Number.isInteger(n)||n<0||n>=p.shapes.length)throw Error('invalid packed shape');return p.shapes[n];};
 const visit=(x,depth=0,inDefault=false)=>{
  if(++decodedNodes>12000||depth>64)throw Error('decoded graph depth or node budget exceeded');
  if(!Array.isArray(x)){
   if(x!==null&&!['string','number','boolean'].includes(typeof x)||typeof x==='number'&&!Number.isFinite(x))throw Error('invalid packed scalar');
   charge(size(x));return x;
  }
  if(x[0]===2){if(x.length!==2||!Number.isInteger(x[1])||x[1]<0||x[1]>=p.strings.length)throw Error('invalid packed string');charge(size(p.strings[x[1]]));return p.strings[x[1]];}
  if(x[0]===0){charge(x.length+1);return x.slice(1).map(v=>visit(v,depth+1,inDefault));}
  if(x[0]===1){const keys=shape(x[1]);if(x.length!==keys.length+2)throw Error('invalid dense fields');charge(2+keys.reduce((n,k)=>n+size(k)+2,0));return Object.fromEntries(keys.map((k,n)=>[k,visit(x[n+2],depth+1,inDefault)]));}
  if(inDefault||x[0]!==3||!Array.isArray(p.defaults?.[x[1]]))throw Error('invalid packed object');
  const keys=shape(x[1]);charge(2+keys.reduce((n,k)=>n+size(k)+2,0));
  const values=p.defaults[x[1]].map(v=>visit(v,depth+1,true)),mask=x[2];
  if(values.length!==keys.length||keys.length>52||!Number.isSafeInteger(mask)||mask<0||mask>=2**keys.length)throw Error('invalid shape defaults');
  let at=3;for(let i=0;i<keys.length;i++)if(Math.floor(mask/2**i)%2)values[i]=visit(x[at++],depth+1,inDefault);
  if(at!==x.length)throw Error('invalid packed field count');
  return Object.fromEntries(keys.map((k,n)=>[k,values[n]]));
 };
 return visit(p.value);
}
// Reuse the existing exact dictionary/LZ codec for large rule offer tables.
// Plain small maps remain readable; decoded extent and host envelope stay bounded.
function readRuleMaps(value){return Array.isArray(value)?value:unpack(value);}
// Reuse this bounded exact codec for diagnostic data as well as plan data.
// This does not change stored plans, their envelopes or execution semantics.
export function encodeBoundedData(value){
 if(size(value)>65536)throw Error('diagnostic-decoded-budget');
 return storeData(value);
}
export function decodeBoundedData(value){return unpack(value);}
export function storeRuleMaps(maps){
 if(!Array.isArray(maps)||size(maps)>65536)throw Error('rule-map-decoded-budget');
 const packed=storeData(maps);
 return size(maps)>1600&&size(packed)+24<size(maps)?packed:clone(maps);
}
export function ruleMapFor(plan,index=plan?.cursor){
 try{return readRuleMaps(plan.ruleMaps)?.[index]??null;}catch{return null;}
}
function differences(a,b,path=[]){
 if(equal(a,b))return [];
 if(a&&b&&typeof a==='object'&&typeof b==='object'&&!Array.isArray(a)&&!Array.isArray(b)){
  return [...new Set([...Object.keys(a),...Object.keys(b)])].sort().flatMap(k=>
   !(k in b)?[{path:[...path,k],remove:true}]:!(k in a)?[{path:[...path,k],value:b[k]}]:differences(a[k],b[k],[...path,k]));
 }
 if(Array.isArray(a)&&Array.isArray(b)&&a.length===b.length)return a.flatMap((x,n)=>differences(x,b[n],[...path,n]));
 return [{path,value:b}];
}
function apply(anchor,patch){
 let out=clone(anchor);
 for(const p of patch){
  if(!Array.isArray(p.path)||p.path.some(k=>typeof k!=='string'&&!Number.isInteger(k)||['__proto__','constructor','prototype'].includes(k)))throw Error('invalid guard path');
  if(!p.path.length){out=clone(p.value);continue;}
  let parent=out;for(const k of p.path.slice(0,-1)){if(!parent||typeof parent!=='object'||!Object.hasOwn(parent,k))throw Error('invalid guard parent');parent=parent[k];}
  const key=p.path.at(-1);if(p.remove)delete parent[key];else parent[key]=clone(p.value);
 }
 return out;
}
function end(plan,status,reason,extra={}){return {plan:null,status,reason,inputConfirmed:false,sourceConfirmed:false,...extra};}
const goalValid=g=>g===undefined||g&&typeof g.id==='string'&&g.id.length<=240&&typeof g.kind==='string'&&g.kind.length<=80&&size(g)<=512;
function valid(plan){
 if(plan?.schema!==EXECUTION_SCHEMA||!plan.data||!plan.identity||!plan.scope)return false;
 try{
  const d=unpack(plan.data),maps=plan.ruleMaps===undefined?null:readRuleMaps(plan.ruleMaps);
  return plan?.schema===EXECUTION_SCHEMA&&Array.isArray(d.nodes)&&d.nodes.length>=1&&d.nodes.length<=5&&
   Number.isInteger(plan.cursor)&&d.nodes[plan.cursor]&&['ready','awaiting-execution'].includes(plan.status)&&
   d.anchor&&plan.identity&&plan.scope&&
   (plan.ruleMaps===undefined||Array.isArray(maps)&&size(maps)<=65536&&maps.length===d.nodes.length&&
    maps.every((map,index)=>map===null?d.nodes[index].expansion==='required':map&&equal(map.input,d.nodes[index].input)&&Array.isArray(map.offers)&&map.offers.length<=64&&
     map.offers.every(offer=>offer.team===plan.scope.team&&typeof offer.type==='string'&&typeof offer.prompt==='string'&&
      Array.isArray(offer.options)&&offer.options.every(x=>typeof x.id==='string'&&typeof x.label==='string')&&
      new Set(offer.options.map(x=>x.id)).size===offer.options.length&&offer.options.some(x=>x.id===offer.optionId))))&&Number.isInteger(plan.maxBytes)&&plan.maxBytes>=512&&plan.maxBytes<=7500&&
   Number.isInteger(plan.completedCount??0)&&(plan.completedCount??0)>=0&&
   d.nodes.every((node,index)=>input(node.input)&&goalValid(node.goal)&&Array.isArray(node.branches)&&probability(node.omittedMass)&&
    (node.expansion===undefined||node.expansion==='required'&&node.branches.length===0&&node.omittedMass===1)&&
    Math.abs(node.omittedMass+node.branches.reduce((sum,b)=>sum+b.mass,0)-1)<=1e-8&&node.branches.every(b=>{
    if(!probability(b.mass)||b.mass===0||!Array.isArray(b.guard))return false;
    apply(d.anchor,b.guard);return b.next===null||Number.isInteger(b.next)&&b.next>index&&b.next<d.nodes.length;
   }))&&(!plan.expected||Number.isInteger(plan.expected.node)&&Number.isInteger(plan.expected.branch)&&
    d.nodes[plan.expected.node]?.branches[plan.expected.branch]?.next===plan.cursor)&&
   (plan.status==='ready'?plan.proposal===null:d.nodes[plan.cursor].expansion!=='required'&&plan.proposal?.inputNode===plan.cursor&&
    Number.isInteger(plan.proposal.requestId)&&plan.proposal.requestId>=0&&typeof plan.proposal.revision==='string'&&
    Number.isInteger(plan.proposal.historyFrom)&&plan.proposal.historyFrom>=0);
 }catch{return false;}
}
const expected=(plan,d)=>plan.expected?d.nodes[plan.expected.node].branches[plan.expected.branch].guard:[];

/** Match a pending ordinary Move against its admitted exact source guard.
 * Only the acting player's expected movement/skill-use fields, activation and
 * pending transport are variable. Every other public rule/resource fact stays
 * exact; no duplicate board snapshot is added to the context envelope. */
export function ordinaryMoveSourceMatches(plan,o){
 if(!valid(plan)||plan.status!=='awaiting-execution')return false;
 try{
  const d=unpack(plan.data),i=d.nodes[plan.cursor].input;
  if(i.kind!=='playerAction'||i.action!=='move'||o.activation?.playerId!==i.playerId||o.activation.action!=='move')return false;
  const source=apply(d.anchor,expected(plan,d)),actual=publicFacts(o,d.anchor);
  const fixed=x=>{const y=clone(x);delete y.activation;delete y.pending;
   const p=y.players?.find(p=>p.id===i.playerId);if(!p)return null;
   for(const key of ['pos','stance','activated','usage','tackleZone'])delete p[key];
   return y;};
  return equal(fixed(source),fixed(actual));
 }catch{return false;}
}

/** nodes are an acyclic conditional plan: [{input,branches:[{mass,observation,
 * next:<later node index>|null}]}]. Unknown/unretained outcomes are omitted and
 * cannot advance a plan. All 1–5 inputs and exact guards must fit the reservation.
 */
export function createPlan(o,{id,identity,nodes,entry=0,maxBytes=7500}){
 if(![1,2].includes(o?.apiVersion)||!normal(o)||historyLength(o)===null)return {plan:null,reason:'requires-own-action-position'};
 if(!id||!identity?.coachId||!identity.version||!identity.contextSchema||!Array.isArray(nodes)||
    nodes.length<1||nodes.length>5||!Number.isInteger(entry)||entry<0||entry>=nodes.length||
    !Number.isInteger(maxBytes)||maxBytes<512||maxBytes>7500)return {plan:null,reason:'invalid-plan-input'};
 const anchor=publicFacts(o),rows=[];
 for(let n=0;n<nodes.length;n++){
  const node=nodes[n];if(!input(node.input)||!goalValid(node.goal)||!Array.isArray(node.branches))return {plan:null,reason:'invalid-node'};
  if(node.expansion!==undefined){
   if(node.expansion!=='required'||node.branches.length||n===entry)return {plan:null,reason:'invalid-unexpanded-frontier'};
   rows.push({input:clone(node.input),branches:[],omittedMass:1,expansion:'required',...(node.goal?{goal:clone(node.goal)}:{})});continue;
  }
  const branches=[];let retained=0;
  for(const b of node.branches){
   if(!probability(b.mass)||b.mass===0||!b.observation||b.turnover||b.touchdown||
      !normal(b.observation)||!equal(scope({...b.observation,engine:b.observation.engine??o.engine,
       match:b.observation.match??o.match}),scope(o)))continue;
   if(b.next!==null&&(!Number.isInteger(b.next)||b.next<=n||b.next>=nodes.length))return {plan:null,reason:'invalid-dependency'};
   const facts=publicFacts(b.observation,anchor),patch=differences(anchor,facts);
   const old=branches.find(x=>equal(x.guard,patch));
   if(old&&old.next!==b.next)return {plan:null,reason:'ambiguous-public-branch'};
   if(old)old.mass+=b.mass;else branches.push({mass:b.mass,guard:patch,next:b.next});
   retained+=b.mass;
  }
  if(retained>1+1e-8)return {plan:null,reason:'non-unit-branch-mass'};
  rows.push({input:clone(node.input),branches,omittedMass:Math.max(0,1-retained),...(node.goal?{goal:clone(node.goal)}:{})});
 }
 const plan={schema:EXECUTION_SCHEMA,id,identity:clone(identity),scope:scope(o),data:storeData({anchor,nodes:rows}),
  cursor:entry,expected:null,status:'ready',proposal:null,maxBytes};
 if(size(plan)>maxBytes)return {plan:null,reason:'context-reservation-exceeded',bytes:size(plan)};
 if(!valid(plan))return {plan:null,reason:'decoded-plan-budget-or-shape-invalid'};
 return {plan,reason:null,bytes:size(plan)};
}

/** Arm only a choice the caller actually selected after planning/comparison. */
export function armStep(plan,o,chosenInput){
 if(!valid(plan)||plan.status!=='ready'||!normal(o))return {plan:null,reason:'plan-not-ready'};
 const d=unpack(plan.data),anchor=d.anchor;
 if(d.nodes[plan.cursor].expansion==='required')return {plan:null,reason:'frontier-requires-current-expansion'};
 if(!equal(chosenInput,d.nodes[plan.cursor].input))return {plan:null,reason:'different-choice'};
 if(!equal(scope(o),plan.scope)||!equal(publicFacts(o,anchor),apply(anchor,expected(plan,d))))return {plan:null,reason:'state-changed'};
 const at=historyLength(o);
 if(at===null||!Number.isInteger(o.requestId)||typeof o.revision!=='string')return {plan:null,reason:'missing-issue-identity'};
 const next={...clone(plan),status:'awaiting-execution',proposal:{requestId:o.requestId,
  revision:o.revision,historyFrom:at,inputNode:plan.cursor}};
 if(size(next)>next.maxBytes)return {plan:null,reason:'context-reservation-exceeded'};
 return {plan:next,reason:null};
}
const signature=x=>({kind:x?.kind,playerId:x?.playerId,action:x?.action,special:x?.special});

/** Optional actual full LogEntry[] / {entries:LogEntry[]} feedback. No invented
 * normalized receipt is needed. Raw history is indexed in the real log order.
 */
export function reconcile(plan,o,{identity=plan?.identity,receipt=null,history=null}={}){
 if(!valid(plan))return end(plan,'invalidated','invalid-plan');
 if(!equal(identity,plan.identity)||o?.contextInfo?.resetReason)return end(plan,'invalidated','identity-or-context-reset');
 if(!equal(scope(o),plan.scope))return end(plan,'invalidated','scope-changed');
 if(o.pending)return {plan:clone(plan),status:'awaiting-rule',reason:'actual-rule-decision-pending',inputConfirmed:false,sourceConfirmed:false};
 if(!normal(o))return end(plan,'invalidated','not-own-action-position');
 const d=unpack(plan.data),anchor=d.anchor,facts=publicFacts(o,anchor);
 if(plan.status==='ready'){
  if(!equal(facts,apply(anchor,expected(plan,d))))return end(plan,'invalidated','state-changed');
  return {plan:clone(plan),status:'candidate-ready',reason:'current-node-guard-matched',inputConfirmed:false,sourceConfirmed:false,
   candidate:{input:clone(d.nodes[plan.cursor].input),origin:'conditional-plan',requiresFreshEvaluation:true,requiresExpansion:d.nodes[plan.cursor].expansion==='required'}};
 }
 const p=plan.proposal,pInput=d.nodes[plan.cursor].input;
 if(!p||p.inputNode!==plan.cursor||historyLength(o)===null||historyLength(o)<p.historyFrom)return end(plan,'invalidated','history-rewound');
 let entry,inputConfirmed=false,sourceConfirmed=false,source=null;
 if(receipt){
  if(receipt.schema!=='bloodboard-receipt/1'||receipt.requestId!==p.requestId||receipt.revisionBefore!==p.revision||
     receipt.historyFrom!==p.historyFrom||receipt.revisionAfter!==o.revision||receipt.historyTo!==historyLength(o))
   return end(plan,'invalidated','uncorrelated-receipt');
  if(receipt.accepted!==true||receipt.error)return end(plan,'invalidated','execution-rejected');
  if(receipt.input&&!equal(receipt.input,pInput))return end(plan,'invalidated','different-executed-input');
  inputConfirmed=!!receipt.input;sourceConfirmed=typeof receipt.source?.fellBack==='boolean';source=receipt.source??null;
  entry=receipt.entries?.find(e=>e.index===p.historyFrom&&equal(signature(e.input),signature(pInput)));
 }
 if(history){
  const entries=Array.isArray(history)?history:history.entries;
  const actual=entries?.find((e,n)=>(e.index??n)===p.historyFrom);
  if(!actual||!equal(actual.input,pInput))return end(plan,'invalidated','different-or-missing-full-history-input');
  entry={...actual,index:actual.index??p.historyFrom};inputConfirmed=true;
 }
 let stateOnly=false;
 if(!entry){
  const increment=o.sinceLast;
  if(!increment&&o.apiVersion===1){
   if(historyLength(o)<=p.historyFrom)return end(plan,'invalidated','revision-did-not-advance');
   stateOnly=true;
  }else if(!increment||!Array.isArray(increment.entries)||increment.from>p.historyFrom||increment.to!==historyLength(o))
   return end(plan,'invalidated','missing-causal-history');
  else entry=increment.entries.find(e=>e.index>=p.historyFrom&&e.team===o.team&&equal(signature(e.input),signature(pInput)));
 }
 if(!stateOnly&&(!entry||entry.team!==o.team))return end(plan,'invalidated','causal-action-mismatch');
 if(!stateOnly&&entry.outcome!=='completed')return end(plan,entry.outcome==='touchdown'?'completed':'invalidated',entry.outcome??'unknown-execution-outcome',
  {inputConfirmed,sourceConfirmed,source});
 const branches=d.nodes[plan.cursor].branches;
 const branch=branches.find(b=>equal(facts,apply(anchor,b.guard)));
 if(!branch){
  const near=branches.map(b=>differences(apply(anchor,b.guard),facts)).sort((a,b)=>a.length-b.length)[0]||[];
  return end(plan,'invalidated','unretained-or-changed-public-outcome',{inputConfirmed,sourceConfirmed,source,
   differenceCount:near.length,differencePaths:near.slice(0,8).map(p=>p.path.join('.'))});
 }
 if(branch.next===null)return end(plan,'completed','planned-final-public-outcome',{inputConfirmed,sourceConfirmed,source});
 // The completed prefix is no longer an obligation. Re-anchor every reachable
 // future guard to the exact adopted public state, without deleting any future
 // outcome. This avoids carrying historical guards/proposal growth through the
 // tight host envelope and keeps subsequent arm/validate checks on current facts.
 const reachable=new Set(),collect=n=>{if(reachable.has(n))return;reachable.add(n);for(const b of d.nodes[n].branches)if(b.next!==null)collect(b.next);};
 collect(branch.next);const indices=[...reachable].sort((a,b)=>a-b),remap=new Map(indices.map((n,i)=>[n,i]));
 const nodes=indices.map(n=>({...clone(d.nodes[n]),branches:d.nodes[n].branches.map(b=>({...clone(b),
  guard:differences(facts,apply(anchor,b.guard)),next:b.next===null?null:remap.get(b.next)}))}));
 const next={...clone(plan),data:storeData({anchor:facts,nodes}),cursor:remap.get(branch.next),expected:null,
  completedCount:(plan.completedCount||0)+1,proposal:null,status:'ready'};
 if(plan.ruleMaps)next.ruleMaps=storeRuleMaps(indices.map(n=>ruleMapFor(plan,n)));
 delete next.rulePolicy; // A rule certificate belongs only to the completed input.
 if(!valid(next))return end(plan,'invalidated','rebased-graph-exceeds-decode-limits');
 return {plan:next,status:'candidate-ready',reason:inputConfirmed?'branch-adopted-from-confirmed-input':stateOnly?'actual-public-state-branch':'branch-adopted-from-public-facts',
  inputConfirmed,sourceConfirmed,source,
  candidate:{input:clone(nodes[next.cursor].input),origin:'conditional-plan',requiresFreshEvaluation:true,requiresExpansion:nodes[next.cursor].expansion==='required'}};
}

/** Real API2 validate supplies current legality, never a score or permission to
 * bypass the caller's current evaluator. No request-local key is persisted. */
export async function continuationCandidate(plan,o,services,feedback={}){
 let r;
 try{r=reconcile(plan,o,feedback);}catch{return end(plan,'invalidated','malformed-execution-context');}
 if(!r.candidate)return r;
 if(typeof services?.validate!=='function')return end(plan,'invalidated','validation-service-unavailable');
 let legality;try{legality=await services.validate(r.candidate.input,{});}catch{return end(plan,'invalidated','validation-query-failed');}
 if(legality?.ok!==true||legality.legal!==true)return end(plan,'invalidated','next-input-not-legal');
 return {...r,candidate:{...r.candidate,validated:true,requiresFreshEvaluation:true}};
}

/** Inspect the actual packed dependency graph for planning and evidence. The
 * same exact guards used by reconcile establish each node's prerequisites.
 * This view contains semantic tasks and edges, never ephemeral position keys. */
export function planView(plan){
 if(!valid(plan))return null;
 const d=unpack(plan.data),tasks=d.nodes.map((node,index)=>{
  const predecessor=d.nodes.flatMap((p,n)=>p.branches.filter(b=>b.next===index).map(b=>({node:n,guard:b.guard}))).at(0);
  const before=predecessor?apply(d.anchor,predecessor.guard):d.anchor;
  const actor=before.players?.find(p=>p.id===node.input.playerId),a=before.activation;
  const ownCarrier=before.ball?.kind==='held'&&before.players?.find(p=>p.id===before.ball.playerId)?.team===before.team;
  const action=node.input.action||node.input.kind;
  const target=node.input.handoffTarget||node.input.passTarget||node.input.blitzTarget||node.input.blockTarget||node.input.specialTarget||null;
  const destination=node.input.path?.at(-1)?.to??actor?.pos??null;
  const purpose=['handoff','pass'].includes(action)?'transfer-possession':
   ['block','blitz','special'].includes(action)?'contact-or-special-task':
   before.ball?.kind==='ground'&&node.input.path?.some(s=>equal(s.to,before.ball.pos))?'recover-ball':
   ownCarrier&&actor?.id===before.ball.playerId?'advance-or-protect-carrier':
   action==='endTurn'||action==='endActivation'?'close-current-scope':'support-or-position';
  return {index,actor:actor?.id??null,action,target,destination,purpose,goal:node.goal??null,
   expansion:node.expansion||'retained-exact-outcomes',outcomeMassUnknown:node.expansion==='required'?1:null,
   unretainedOutcomeMass:node.omittedMass,
   requires:predecessor?[predecessor.node]:[],
   resources:['blitz','handoff','pass','foul'].includes(action)?[action]:[],
   movementAvailable:actor?Math.max(0,(actor.ma||0)-(a?.playerId===actor.id?(a.maUsed||0):0)):null,
   declaredAction:a&&actor&&a.playerId===actor.id&&!a.over?a.action:action,
   routeSteps:node.input.path?.length||0,
   retainedSuccessMass:node.branches.reduce((s,b)=>s+b.mass,0),
   stop:'complete submitted input; advance only on retained actual public outcome'};
 });
 return {id:plan.id,cursor:plan.cursor,completedCount:plan.completedCount||0,status:plan.status,tasks,activeTask:tasks[plan.cursor],activeInput:clone(d.nodes[plan.cursor].input),
  frontier:d.nodes.some(node=>node.expansion==='required'),
  edges:d.nodes.flatMap((node,from)=>node.branches.filter(b=>b.next!==null).map(b=>({from,to:b.next,mass:b.mass})))};
}

/** Check every priced immediate obligation, not merely the existence of one
 * edge. This is structural admission, never a probability/value comparison. */
export function dependencyCoverage(plan,o,selected){
 const proposed=(selected?.ex?.outcomes||[]).filter(b=>!b.turnover&&!b.touchdown&&b.observation&&
  selected?.preparedBranches?.get(b.key)?.plan?.input&&selected.preparedBranches.get(b.key).ex?.outcomes?.length);
 const dangling=[...(selected?.preparedBranches?.keys?.()||[])].some(key=>!(selected.ex?.outcomes||[]).some(b=>b.key===key&&!b.turnover&&!b.touchdown));
 const result={scope:'immediate-priced-frontier',futureExpansionRequired:!!planView(plan)?.frontier,
  pricedBranches:proposed.length,danglingObligations:dangling,pricedMass:proposed.reduce((s,b)=>s+b.p,0),retainedBranches:0,retainedMass:0,complete:proposed.length===0&&!dangling};
 if(!valid(plan))return result;
 const d=unpack(plan.data),root=d.nodes[plan.cursor];
 for(const b of proposed){const task=selected.preparedBranches.get(b.key),facts=publicFacts(b.observation,d.anchor);
  if(root.branches.some(edge=>edge.next!==null&&equal(d.nodes[edge.next].input,task.plan.input)&&
    equal(apply(d.anchor,edge.guard),facts))){result.retainedBranches++;result.retainedMass+=b.p;}}
 result.complete=!dangling&&result.retainedBranches===result.pricedBranches;return result;
}

/** Semantic repair templates only. Exact execution guards still invalidate;
 * no old source handle, chance tree, rule map or guard is an execution proof. */
export function repairTasks(plan,o,review,identity=plan?.identity){
 if(!valid(plan)||!equal(identity,plan.identity)||!normal(o)||!equal(scope(o),plan.scope)||
  review?.status!=='invalidated'||!['state-changed','unretained-or-changed-public-outcome'].includes(review.reason))return [];
 const d=unpack(plan.data),view=planView(plan),templates=[];
 const possession=b=>b?.kind==='held'?{kind:b.kind,playerId:b.playerId}:b;
 for(const task of view.tasks.slice(view.cursor)){
  const node=d.nodes[task.index],predecessor=d.nodes.flatMap(p=>p.branches.filter(b=>b.next===task.index)).at(0);
  const before=predecessor?apply(d.anchor,predecessor.guard):d.anchor;
  const actor=o.players.find(p=>p.id===task.actor);
  if(!actor||!available(o,actor)||!equal(possession(before.ball),possession(o.ball)))continue;
  if(['endTurn','endActivation'].includes(node.input.kind))continue;
  if(task.action==='move'&&equal(actor.pos,task.destination))continue;
  if(['handoff','pass','secure'].includes(task.action)&&o.ball?.kind==='held'&&o.ball.playerId!==actor.id)continue;
  templates.push({input:clone(node.input),goal:clone(task.goal),destination:clone(task.destination),
   taskIndex:task.index,dependencies:clone(task.requires),requiresFreshEvaluation:true});
 }
 return templates;
}
