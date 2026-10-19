/** Build NEW native/Match Lab hosts from an already built unified web tree.
 * Never installs, launches, modifies user data, or copies a Lab's runtime data. */
import {existsSync,readFileSync,writeFileSync,mkdirSync,cpSync,chmodSync,readdirSync,statSync,lstatSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),take=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
const bridge=args.includes('--bridge');
const bridgeModules=resolve(take('--bridge-modules')??join(root,'online','node_modules'));
const bridgeCode=['bridge.mjs','protocol.mjs','store.mjs','lifecycle.mjs','aidir.mjs','build-coach.mjs','coach-core.js','instructions.txt','package.json','providers/errors.mjs','providers/deepseek.mjs','providers/luna.mjs'];
const check=args.includes('--check'),outArg=take('--out'),labArg=take('--lab-source'),web=resolve(take('--web')??join(root,'dist/web'));
if(!labArg||!check&&!outArg)throw Error('Use --lab-source CODE_ONLY_LAB --check, or --lab-source CODE_ONLY_LAB --out NEW_OUTPUT [--web BUILT_WEB]');
const lab=resolve(labArg),pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
const code=['lab','lab.mjs','aidir.mjs','ai-tools.mjs','ui/index.html'];
const needed=['native/main.swift','native/Info.plist','scripts/match-lab-runner.ts','src/platform/engine-worker.ts','src/platform/research/nodepool.ts','src/engine/index.ts','src/engine/fingerprint.ts','node_modules/esbuild/lib/main.js'];
const webNeeded=['index.html','engine.js','app.js','app.css','engine-worker.js','engine-worker-src.js','ai/bundled.js','build-info.json'];
const missing=[...needed.filter(p=>!existsSync(join(root,p))).map(p=>'source:'+p),...code.filter(p=>!existsSync(join(lab,p))).map(p=>'lab:'+p),...webNeeded.filter(p=>!existsSync(join(web,p))).map(p=>'web:'+p)];
const dependencyPackages=new Map();
if(bridge){
 for(const p of ['native/BridgeLauncher.swift','online/native/keychain.swift','online/vendor/siwc-local/src/index.ts',...bridgeCode.map(p=>'online/'+p)])if(!existsSync(join(root,p)))missing.push('bridge:'+p);
 if(!missing.length){
  const dependencies=JSON.parse(readFileSync(join(root,'online/package.json'),'utf8')).dependencies;
  const pending=Object.keys(dependencies);
  while(pending.length){
   const name=pending.shift();if(dependencyPackages.has(name))continue;
   if(!/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name))throw Error('Invalid runtime dependency name');
   const dir=join(bridgeModules,name),manifest=join(dir,'package.json');
   if(!existsSync(manifest)){missing.push('npm:'+name);continue;}
   const metadata=JSON.parse(readFileSync(manifest,'utf8'));
   if(metadata.name!==name||dependencies[name]&&metadata.version!==dependencies[name])throw Error('Runtime package identity/version mismatch: '+name);
   dependencyPackages.set(name,{dir,version:metadata.version});pending.push(...Object.keys(metadata.dependencies??{}));
  }
 }
}
if(missing.length)throw Error('Missing prerequisites: '+missing.join(', '));
const swift=readFileSync(join(root,'native/main.swift'),'utf8');
if(!swift.includes('private let supportFolderName = "Bloodboard V6"')||!swift.includes('appendingPathComponent("Bloodboard", isDirectory: true)'))throw Error('Native support/AI path changed: review storage compatibility before building.');
const nativeTool=process.platform==='darwin'?execFileSync('xcrun',['--find','swiftc'],{encoding:'utf8'}).trim():null;
const status={sourceComplete:true,labCodeComplete:true,webComplete:true,version:pkg.version,requiredVersion:'0.2.0',nativeCompilerAvailable:!!nativeTool,bridge,bridgePackages:bridge?Object.fromEntries([...dependencyPackages].map(([n,p])=>[n,p.version])):null,bridgeRuntime:bridge?'Node.js22.12+ in BridgeLauncher search paths':null,storage:'Existing Bloodboard V6 stores and shared Bloodboard/AI remain unchanged',scope:'Read-only prerequisite validation; no app launch or installation'};
if(check){console.log(JSON.stringify(status,null,2));process.exit(0);}
if(pkg.version!=='0.2.0')throw Error('Set unified package version to0.2.0 before release build.');
if(!nativeTool)throw Error('Native assembly requires macOS Command Line Tools.');
const out=resolve(outArg);if(existsSync(out))throw Error('Output must be NEW; no overwrites.');
// Keep build output separate from the source tree and existing installed hosts.
if(out===root||out.startsWith(root+'/src/')||out.startsWith(lab+'/'))throw Error('Output cannot replace source or be inside the existing Match Lab.');
mkdirSync(out,{recursive:true});
const run=(exe,argv)=>execFileSync(exe,argv,{cwd:root,stdio:'inherit'});
const esbuild=(await import(new URL('../node_modules/esbuild/lib/main.js',import.meta.url))).build;
const labOut=join(out,'match-lab');mkdirSync(join(labOut,'runner'),{recursive:true});
for(const p of code){mkdirSync(dirname(join(labOut,p)),{recursive:true});cpSync(join(lab,p),join(labOut,p));}
chmodSync(join(labOut,'lab'),0o755);
mkdirSync(join(labOut,'config'),{recursive:true});
writeFileSync(join(labOut,'config/lab-config.json'),JSON.stringify({teamFolders:[{path:'teams',label:'Match Lab teams'},{path:'~/Library/Application Support/Bloodboard V6/Teams',label:'Current native saved teams (read only)'},{path:'~/Library/Application Support/Bloodboard Endgame Workshop/Teams',label:'Legacy saved teams (read only)'}]},null,2)+'\n');
writeFileSync(join(labOut,'Launch Match Lab.command'),'#!/usr/bin/env bash\ncd "$(dirname "$0")" || exit 1\nexec ./lab window\n');chmodSync(join(labOut,'Launch Match Lab.command'),0o755);
const common={absWorkingDir:root,bundle:true,target:'es2020',logLevel:'warning'};
await esbuild({...common,entryPoints:['scripts/match-lab-runner.ts'],outfile:join(labOut,'runner/runner.mjs'),platform:'node',format:'esm',banner:{js:"import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);"}});
await esbuild({...common,entryPoints:['src/platform/engine-worker.ts'],outfile:join(labOut,'runner/engine-worker.js'),format:'iife'});
const fingerprint=JSON.parse(execFileSync(process.execPath,[join(labOut,'runner/runner.mjs'),'fingerprint'],{encoding:'utf8',cwd:out})).fingerprint;
const webInfo=JSON.parse(readFileSync(join(web,'build-info.json'),'utf8'));
if(!webInfo.fingerprint||['engineHash','rulesHash','apiHash'].some(k=>webInfo.fingerprint[k]!==fingerprint[k]))throw Error('Web and Match Lab fingerprints disagree. Rebuild web from this same unified source.');
if(!readFileSync(join(web,'engine-worker.js')).equals(readFileSync(join(labOut,'runner/engine-worker.js'))))throw Error('Web and Lab workers differ; align build options before packaging.');
const app=join(out,'Bloodboard Unified 0.2.0.app'),contents=join(app,'Contents');mkdirSync(join(contents,'MacOS'),{recursive:true});mkdirSync(join(contents,'Resources'),{recursive:true});
const arch=process.arch==='arm64'?'arm64':'x86_64';
run('xcrun',['swiftc','-O','-target',arch+'-apple-macos11.0','-framework','Cocoa','-framework','WebKit','-framework','UniformTypeIdentifiers',...(bridge?['-D','BRIDGE']:[]),join(root,'native/main.swift'),...(bridge?[join(root,'native/BridgeLauncher.swift')]:[]),'-o',join(contents,'MacOS/Bloodboard')]);
let plist=readFileSync(join(root,'native/Info.plist'),'utf8');
for(const [key,value]of Object.entries({CFBundleShortVersionString:'0.2.0',CFBundleVersion:'200',CFBundleName:'Bloodboard Unified',CFBundleDisplayName:'Bloodboard Unified 0.2.0'})){
 const expression=new RegExp('(<key>'+key+'</key>\\s*<string>)[^<]*(</string>)');if(!expression.test(plist))throw Error('Missing plist key '+key);plist=plist.replace(expression,(_,a,b)=>a+value+b);
}
writeFileSync(join(contents,'Info.plist'),plist);cpSync(web,join(contents,'Resources/web'),{recursive:true});
if(bridge){
 const onlineOut=join(contents,'Resources/online');
 for(const p of bridgeCode){mkdirSync(dirname(join(onlineOut,p)),{recursive:true});cpSync(join(root,'online',p),join(onlineOut,p));}
 mkdirSync(join(onlineOut,'vendor/siwc-local'),{recursive:true});
 await esbuild({...common,entryPoints:['online/vendor/siwc-local/src/index.ts'],outfile:join(onlineOut,'vendor/siwc-local/runtime.mjs'),platform:'node',format:'esm',packages:'external',target:'node22'});
 // Read only declared public npm package trees; never copy the installed online root.
 const copyPackage=(src,dst)=>{
  const st=lstatSync(src);if(st.isSymbolicLink())throw Error('Symlink in runtime npm package; review before copying.');
  if(st.isDirectory()){
   mkdirSync(dst,{recursive:true});
   for(const name of readdirSync(src)){
    if(name.startsWith('.')||['node_modules','test','tests','coverage'].includes(name)||/\.(pem|key|enc)$/i.test(name))continue;
    copyPackage(join(src,name),join(dst,name));
   }
  }else cpSync(src,dst);
 };
 for(const [name,p] of dependencyPackages)copyPackage(p.dir,join(onlineOut,'node_modules',name));
 mkdirSync(join(onlineOut,'native'),{recursive:true});
 run('xcrun',['swiftc','-O','-target',arch+'-apple-macos11.0','-framework','Security','-framework','CryptoKit',join(root,'online/native/keychain.swift'),'-o',join(onlineOut,'native/keychain-helper')]);
 // Verify only module resolution/loading: never call serve, providers, keychain, OAuth or paid APIs.
 execFileSync(process.execPath,['--input-type=module','-e',"await import('./bridge.mjs');await import('./vendor/siwc-local/runtime.mjs');"],{cwd:onlineOut,stdio:'inherit'});
} // No state/config/env/credentials or installed online directory is copied.
if(existsSync(join(root,'native/AppIcon.icns')))cpSync(join(root,'native/AppIcon.icns'),join(contents,'Resources/AppIcon.icns'));
run('codesign',['--force','--deep','--sign','-',app]);
const files={};const walk=(dir,prefix='')=>{for(const name of readdirSync(dir)){const p=join(dir,name),relative=join(prefix,name);if(statSync(p).isDirectory())walk(p,relative);else files[relative]=createHash('sha256').update(readFileSync(p)).digest('hex');}};walk(out);
writeFileSync(join(out,'HOST-BUILD-RECEIPT.json'),JSON.stringify({version:'0.2.0',architecture:arch,fingerprint,files,bridge,bridgePackages:bridge?Object.fromEntries([...dependencyPackages].map(([n,p])=>[n,p.version])):null,bridgeRuntime:bridge?'Node.js22.12+':null,labRuntime:'Node.js18+',scope:'Built only; no launch, install, credentials, archives or existing Lab data copied'},null,2)+'\n');
console.log(JSON.stringify({out,app,matchLab:labOut,fingerprint},null,2));
