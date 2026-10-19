import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const manifest=JSON.parse(readFileSync(new URL('./exact-geometry-transform.json',import.meta.url),'utf8'));
const sha=x=>createHash('sha256').update(x).digest('hex');
const replaceOnce=(s,a,b)=>{if(s.split(a).length!==2)throw Error('Exact-geometry transform anchor mismatch');return s.replace(a,b);};
export function originalExactGeometrySource(source){
 if(sha(source)===manifest.parentSha256)return source;
 let recovered=source;
 for(const c of [...manifest.changes].reverse())recovered=replaceOnce(recovered,c.new,c.old);
 if(sha(recovered)!==manifest.parentSha256)throw Error('Exact-geometry recovered S4.34 SHA mismatch');
 return recovered;
}
export function transformExactGeometrySource(source){
 const parent=originalExactGeometrySource(source);
 if(sha(readFileSync(new URL('../tests/deps/champion-1.5.9.js',import.meta.url)))!==manifest.sourceSha256)
  throw Error('Immutable original champion SHA mismatch');
 let transformed=parent;for(const c of manifest.changes)transformed=replaceOnce(transformed,c.old,c.new);
 if(sha(transformed)!==manifest.transformedSha256||originalExactGeometrySource(transformed)!==parent)
  throw Error('Exact-geometry transformed SHA/reversibility mismatch');
 return transformed;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const target=new URL('../src/champion.mjs',import.meta.url),source=readFileSync(target,'utf8'),transformed=transformExactGeometrySource(source);
 if(process.argv.includes('--check')){if(transformed!==source)throw Error('Exact-geometry transform not applied');}
 else if(transformed!==source)writeFileSync(target,transformed);
 process.stdout.write(JSON.stringify({parentSha256:manifest.parentSha256,transformedSha256:manifest.transformedSha256,reversible:true,scope:manifest.scope})+'\n');
}
