import assert from 'node:assert/strict';
import {test} from 'node:test';
import {observe} from '../src/platform/observe';
import {observeV2} from '../src/platform/v2obs';
import {canonical} from '../src/platform/analysis';
import {capTrace} from '../src/platform/respond';
import {Pos} from './helpers';
import * as Engine from '../src/engine/index';
import {bindEngine} from '../src/ai/index';
bindEngine(Engine);
test('unified runtime exposes actual edition for explicit and legacy states',()=>{
 const s=new Pos().start();
 for(const edition of ['faq2026',undefined] as const){
  s.rulesEdition=edition;
  assert.equal((observe(s,'A',1) as any).rulesEdition,edition ?? 'legacy');
  assert.equal((observeV2(s,'A',1) as any).ruleset.rulesEdition,edition ?? 'legacy');
 }
 delete s.rulesEdition;
 assert.equal((observeV2(s,'A',1) as any).ruleset.rulesEdition,'legacy');
});
test('unified trace cap retains 100KiB and reports UTF8 overflow',()=>{
 const normal={value:'x'.repeat(100000)};
 assert.ok(JSON.stringify(capTrace(normal))===JSON.stringify(normal),'100KiB trace retained');
 const huge={value:'汉'.repeat(100000)};
 const result=capTrace(huge) as any;
 assert.equal(result.truncated,true);
 assert.equal(result.bytes,new TextEncoder().encode(JSON.stringify(huge)).length);
});
const legacy=(v:any):any=>v===undefined?'null':Array.isArray(v)?`[${v.map(legacy).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).filter(k=>v[k]!==undefined).sort().map(k=>`${JSON.stringify(k)}:${legacy(v[k])}`).join(',')}}`:JSON.stringify(v);
test('canonical keys preserve legacy bytes, unknown fields, holes and mutations',()=>{
 const samples:any[]=[undefined,null,NaN,-0,{z:[undefined,null,NaN],a:{future:1}},new Array(3),{a:()=>1},JSON.parse('{"__proto__":{"x":1}}')];
 for(const v of samples)assert.equal(canonical(v),legacy(v));
 const state={players:[{pos:{x:1,y:2}}]};const before=canonical(state);
 state.players[0].pos.x=3;assert.notEqual(canonical(state),before);assert.equal(canonical(state),legacy(state));
 assert.throws(()=>canonical(2n),TypeError);
});
