import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve,join,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url);
const deps=new URL('../tests/deps/',import.meta.url);
export const dependencyManifest=JSON.parse(readFileSync(new URL('manifest.json',deps),'utf8'));
export function verifiedFixture(name){
 const entry=dependencyManifest.files.find(x=>x.file===name);
 if(!entry)throw Error('Unknown isolated test dependency: '+name);
 const bytes=readFileSync(new URL(name,deps));
 if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('Test dependency SHA mismatch: '+name);
 return bytes.toString('utf8');
}
export function v6Root(){
 if(!process.env.V6_ROOT)throw Error('Execution tests require V6_ROOT pointing to the genuine V6 checkout; see TESTING.md. No host substitute or skipped pass.');
 const root=resolve(process.env.V6_ROOT);
 for(const p of dependencyManifest.requiredV6EntryPoints)if(!existsSync(join(root,p)))throw Error('V6_ROOT is missing required real source: '+p);
 return root;
}
function esbuildPath(){
 if(process.env.ESBUILD_MODULE){const p=process.env.ESBUILD_MODULE;return isAbsolute(p)?p:resolve(p);}
 try{return require.resolve('esbuild');}catch{}
 if(process.env.V6_ROOT){try{return createRequire(pathToFileURL(join(resolve(process.env.V6_ROOT),'package.json'))).resolve('esbuild');}catch{}}
 throw Error('Existing esbuild required: set ESBUILD_MODULE to its installed entrypoint, provide V6_ROOT/node_modules/esbuild, or make esbuild locally resolvable. No download performed.');
}
export async function esbuildModule(){return import(pathToFileURL(esbuildPath()).href);}
export function esbuildBin(){
 if(process.env.ESBUILD)return process.env.ESBUILD;
 const main=esbuildPath();
 const candidate=resolve(main,'../../bin/esbuild');
 if(!existsSync(candidate))throw Error('Set ESBUILD to an installed executable; derived bin unavailable: '+candidate);
 return candidate;
}
