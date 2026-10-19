import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {createRequire} from 'node:module';
// Build-time only: preserve names and expressions, compact whitespace/comments.
const esbuild=createRequire(import.meta.url)(process.env.HOPEFUL_ESBUILD_MODULE||'esbuild');
const root=dirname(fileURLToPath(import.meta.url));
const mode=process.env.HOPEFUL_ABLATION||'C';if(mode!=='C')throw Error('Unified identity is C-only');if(!['B','C','D'].includes(mode))throw Error('A uses frozen external RC4; build mode must be B/C/D');
const sha=x=>createHash('sha256').update(x).digest('hex');
// Deliberately restricted to this project's static, named module declarations.
// No npm dependency, dynamic imports, eval, global export or function-body rewriting.
// Each source module retains its own lexical scope and ESM strict semantics.
const imports=/^import \{([A-Za-z0-9_,\s]+)\} from '(\.\/[a-z-]+\.mjs)';\r?$/gm;
const exported=/^export (?=(?:async )?function |const )((?:async )?function|const) ([A-Za-z_$][\w$]*)/gm;
const modules=new Map(),visiting=new Set();
function visit(name){
 if(modules.has(name))return modules.get(name).id;
 if(visiting.has(name))throw Error('Unsupported module cycle: '+name);
 visiting.add(name);
 let source=readFileSync(join(root,'src',name),'utf8');
 if(name==='experiment-config.mjs')source=source.replace("EXPERIMENT_MODE='C'","EXPERIMENT_MODE='"+mode+"'");
 let body=source.replace(imports,(_,bindings,path)=>{
  const names=bindings.split(',').map(x=>x.trim());
  if(names.some(x=>!/^[$A-Za-z_][\w$]*$/.test(x)))throw Error('Unsupported import binding in '+name);
  return `const {${names.join(',')}}=${visit(path.slice(2))};`;
 });
 const exports=[];
 body=body.replace(exported,(_,kind,name)=>{exports.push(name);return `${kind} ${name}`;});
 if(/^\s*(?:import|export)\b/m.test(body)||/\bimport\s*\(/.test(body))
  throw Error('Unsupported module declaration in '+name);
 if(new Set(exports).size!==exports.length)throw Error('Duplicate export in '+name);
 // Compilation also rejects malformed/unhandled ESM declarations anywhere.
 const id='__hopeful_module_'+modules.size;
 const getters=exports.map(x=>`get ${x}(){return ${x};}`).join(',');
 const compiled=`const ${id}=(()=>{\n${body}\nreturn Object.freeze({${getters}});\n})();\n`;
 new vm.Script(`"use strict";\n${compiled}`,{filename:name});
 modules.set(name,{id,source,compiled});visiting.delete(name);return id;
}
visit('index.mjs');
const output='hopeful-2-5-s4-37u-c-unified.js';
const readable='// Hopeful S4.37U unified candidate. Rebuild with node build.mjs.\n'+
 '(function(){\n"use strict";\n'+[...modules].map(([name,m])=>`// Module: ${name}\n${m.compiled}`).join('\n')+'})();\n';
const code=esbuild.transformSync(readable,{loader:'js',minifyWhitespace:true,minifyIdentifiers:false,minifySyntax:false,legalComments:'none',charset:'utf8',target:'esnext'}).code;
// User2026-10-04 removed the module-size cap. Actual host admission is checked separately.
new vm.Script(code,{filename:output});
writeFileSync(join(root,output),code);
writeFileSync(join(root,'build-manifest.json'),JSON.stringify({
 schema:'hopeful-standalone-build/1',file:output,version:'2.5.0-test.s4.37u.c',experimentMode:mode,bytes:Buffer.byteLength(code),sha256:sha(code),
 method:'deterministic named-module IIFE bundler plus whitespace/comment compaction; names and syntax optimization disabled',
 packer:{name:'esbuild',version:esbuild.version,minifyWhitespace:true,minifyIdentifiers:false,minifySyntax:false},
 readableSha256:sha(readable),importLimit:null,characters:code.length,
 builderSha256:sha(readFileSync(fileURLToPath(import.meta.url))),
 modules:[...modules].map(([file,m])=>({file:'src/'+file,sha256:sha(m.source),bytes:Buffer.byteLength(m.source)}))
},null,2)+'\n');
console.log(output,Buffer.byteLength(code),sha(code));
