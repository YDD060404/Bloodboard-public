import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../tests/',import.meta.url));
// execution.test.mjs is retained unchanged as the optional source-host suite.
// archived-host.test.mjs transparently exercises the archived compiled host.
const files=readdirSync(root).filter(x=>x.endsWith('.test.mjs')&&x!=='execution.test.mjs').sort();
const env={...process.env};delete env.V6_ROOT;delete env.ESBUILD_MODULE;delete env.ESBUILD;
// Fixed-position tests share CPU and wall-clock search caps. Serial files keep
// unrelated fixtures from consuming each other's independent tactical budgets.
const result=spawnSync(process.execPath,['--test','--test-concurrency=1',...files.map(x=>root+x)],{env,stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status??1;
