import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const manifest=JSON.parse(readFileSync(new URL('./root-refinement-transform.json',import.meta.url),'utf8'));
const sha=x=>createHash('sha256').update(x).digest('hex');
const replaceOnce=(source,from,to)=>{
 if(source.split(from).length!==2)throw Error('Root-refinement transform anchor mismatch');
 return source.replace(from,to);
};
export function originalRootRefinementSource(source){
 if(sha(source)===manifest.parentSha256)return source;
 let recovered=source;
 for(const change of [...manifest.changes].reverse())recovered=replaceOnce(recovered,change.new,change.old);
 if(sha(recovered)!==manifest.parentSha256)throw Error('Root-refinement recovered S4.14 SHA mismatch');
 return recovered;
}
export function transformRootRefinementSource(source){
 const parent=originalRootRefinementSource(source);
 if(sha(parent)!==manifest.parentSha256)throw Error('S4.14 parent source identity mismatch');
 let transformed=parent;
 for(const change of manifest.changes)transformed=replaceOnce(transformed,change.old,change.new);
 if(sha(transformed)!==manifest.transformedSha256)throw Error('S4.15 transformed source SHA mismatch');
 if(originalRootRefinementSource(transformed)!==parent)throw Error('Root-refinement reversibility mismatch');
 return transformed;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const target=new URL('../src/champion.mjs',import.meta.url),source=readFileSync(target,'utf8'),transformed=transformRootRefinementSource(source);
 if(process.argv.includes('--check')){if(transformed!==source)throw Error('Root-refinement transform has not been applied');}
 else if(transformed!==source)writeFileSync(target,transformed);
 process.stdout.write(JSON.stringify({parentSha256:manifest.parentSha256,transformedSha256:manifest.transformedSha256,
  reversible:true,changeCount:manifest.changes.length,scope:manifest.scope})+'\n');
}
