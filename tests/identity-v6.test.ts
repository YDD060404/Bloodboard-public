/** Unified package and native/browser core share an honest generated identity. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { BUILD_FINGERPRINT } from '../src/engine/fingerprint';
test('browser package, built page and generated engine fingerprint agree',()=>{
 const pkg=JSON.parse(readFileSync('package.json','utf8'));
 assert.equal(pkg.name,'broadboard-online');assert.equal(BUILD_FINGERPRINT.version,pkg.version);
 assert.match(readFileSync('src/ui/index.html','utf8'),/<title>Bloodboard Unified<\/title>/);
 assert.match(readFileSync('src/ui/main.ts','utf8'),/Browser edition.*BUILD_FINGERPRINT.version/);
 const built=JSON.parse(readFileSync('dist/web/build-info.json','utf8'));
 assert.equal(built.version,pkg.version);assert.deepEqual(built.fingerprint,BUILD_FINGERPRINT);
});
