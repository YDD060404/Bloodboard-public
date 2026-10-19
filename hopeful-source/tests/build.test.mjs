import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
function isolated(run){const dir=mkdtempSync(join(tmpdir(),'hopeful-221-build-'));
 try{cpSync(join(root,'build.mjs'),join(dir,'build.mjs'));mkdirSync(join(dir,'src'));return run(dir);}
 finally{rmSync(dir,{recursive:true,force:true});}}
const build=dir=>spawnSync(process.execPath,[join(dir,'build.mjs')],{cwd:tmpdir(),encoding:'utf8'});
test('two clean builds from another cwd reproduce exact standalone and manifest bytes',()=>isolated(dir=>{
 cpSync(join(root,'src'),join(dir,'src'),{recursive:true});
 for(let n=0;n<2;n++){const result=build(dir);assert.equal(result.status,0,result.stderr);
  for(const file of ['hopeful-2-5-s4-37u-c-unified.js','build-manifest.json'])
   assert.deepEqual(readFileSync(join(dir,file)),readFileSync(join(root,file)));}
}));
for(const [label,source] of [
 ['default export','export default function value(){return 1;}'],
 ['mutable export','export let value=1;'],
 ['dynamic import',"const value=import('./other.mjs');"],
 ['aliased import',"import {value as other} from './other.mjs';"],
 ['module cycle',"import {value} from './other.mjs';\nexport const other=1;"]
])test(`restricted builder rejects ${label}`,()=>isolated(dir=>{
 writeFileSync(join(dir,'src/index.mjs'),source+'\n');
 writeFileSync(join(dir,'src/other.mjs'),label==='module cycle'?"import {other} from './index.mjs';\nexport const value=1;\n":'export const value=1;\n');
 const result=build(dir);assert.notEqual(result.status,0);assert.match(result.stderr,/Unsupported/);
}));
