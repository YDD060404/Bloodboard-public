import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const manifest=JSON.parse(readFileSync(new URL('./reply-window-transform.json',import.meta.url),'utf8'));
const sha=x=>createHash('sha256').update(x).digest('hex');
const replaceOnce=(source,from,to)=>{
 if(source.split(from).length!==2)throw Error('Reply-window transform anchor mismatch');
 return source.replace(from,to);
};
export function originalReplyWindowSource(source){
 if(sha(source)===manifest.parentModuleSha256)return source;
 let recovered=source;
 for(const change of [...manifest.changes].reverse())recovered=replaceOnce(recovered,change.new,change.old);
 if(sha(recovered)!==manifest.parentModuleSha256)throw Error('Reply-window recovered parent SHA mismatch');
 return recovered;
}
export function transformReplyWindowSource(source){
 const parent=originalReplyWindowSource(source);
 if(manifest.sourceSha256!=='f5b495f8d873bf484640b2f70c6fa0ee81997eee7937e806a5eaccb74ad39941'||
  sha(readFileSync(new URL('../tests/deps/champion-1.5.9.js',import.meta.url)))!==manifest.sourceSha256)
  throw Error('Frozen champion source SHA mismatch');
 const selection=JSON.parse(readFileSync(new URL('./selection-adapter.json',import.meta.url),'utf8'));
 if(sha(JSON.stringify(selection))!==manifest.selectionAdapterDataSha256)throw Error('Selection adapter audit identity mismatch');
 let audited=parent;
 if(!selection.changes.every(({old,new:adapted})=>audited.includes(old)&&!audited.includes(adapted)))
  for(const {old,new:adapted} of selection.changes)audited=replaceOnce(audited,adapted,old);
 if(sha(audited)!==manifest.observerParentSha256)throw Error('Observer parent audit SHA mismatch');
 let transformed=parent;
 for(const change of manifest.changes)transformed=replaceOnce(transformed,change.old,change.new);
 if(originalReplyWindowSource(transformed)!==parent)throw Error('Reply-window reversibility mismatch');
 return transformed;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const target=new URL('../src/champion.mjs',import.meta.url),source=readFileSync(target,'utf8'),transformed=transformReplyWindowSource(source);
 if(process.argv.includes('--check')){if(transformed!==source)throw Error('Reply-window transform has not been applied');}
 else if(transformed!==source)writeFileSync(target,transformed);
 process.stdout.write(JSON.stringify({parentModuleSha256:manifest.parentModuleSha256,moduleSha256:sha(transformed),
  reversible:true,changeCount:manifest.changes.length,scope:manifest.scope})+'\n');
}
