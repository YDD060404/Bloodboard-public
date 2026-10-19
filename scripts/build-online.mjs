import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'dist/web');
rmSync(join(root, 'dist'), { recursive: true, force: true });
mkdirSync(web, { recursive: true }); mkdirSync(join(root, 'build'), { recursive: true });
execFileSync(process.execPath, ['scripts/gen-fingerprint.mjs'], { cwd: root, stdio: 'inherit' });
const bundle = (entry, outfile, extra = {}) => build({ absWorkingDir: root, entryPoints: [entry], outfile, bundle: true, target: 'es2020', logLevel: 'warning', ...extra });
// Shipped examples are frozen build inputs. Regenerate only deliberately.
if (process.argv.includes('--regenerate-examples')) {
await bundle('scripts/make-examples.ts', 'build/make-examples.mjs', { platform: 'node', format: 'esm', banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" } });
execFileSync(process.execPath, ['build/make-examples.mjs', 'examples'], { cwd: root, stdio: 'inherit' });
}
await bundle('src/engine/index.ts', 'dist/web/engine.js', { format: 'iife', globalName: 'BloodboardEngine' });
await bundle('src/platform/engine-worker.ts', 'dist/web/engine-worker.js', { format: 'iife' });
writeFileSync(join(web, 'engine-worker-src.js'), 'window.BLOODBOARD_ENGINE_WORKER_SRC = ' + JSON.stringify(readFileSync(join(web, 'engine-worker.js'), 'utf8')) + ';\n');
// Existing display-only dictionary, extended for this project's room controls.
const catalogue = JSON.parse(readFileSync(join(root, 'localization/zh-CN/catalog.json'), 'utf8'));
for (const [source, target] of Object.entries(catalogue)) {
  const slots = text => [...text.matchAll(/\{\d+\}/g)].map(m => m[0]).sort().join('|');
  if (typeof target !== 'string' || slots(source) !== slots(target)) throw new Error('Invalid localization placeholders: ' + source);
}
writeFileSync(join(web, 'language.js'), '(() => {\n"use strict";\nconst CATALOG = ' + JSON.stringify(catalogue) + ';\n' + readFileSync(join(root, 'localization/zh-CN/runtime.js'), 'utf8') + '\n})();\n');
await bundle('src/ui/main.ts', 'dist/web/app.js', { format: 'iife' });
cpSync(join(root, 'src/ui/index.html'), join(web, 'index.html')); cpSync(join(root, 'src/ui/styles.css'), join(web, 'app.css'));
cpSync(join(root, 'ai'), join(web, 'ai'), { recursive: true });
const coaches = readdirSync(join(root, 'ai')).filter(n => /\.(js|json)$/i.test(n)).sort().map(name => ({ name, text: readFileSync(join(root, 'ai', name), 'utf8') }));
writeFileSync(join(web, 'ai/bundled.js'), 'window.BLOODBOARD_BUNDLED_AI = ' + JSON.stringify(coaches) + ';\n');
await bundle('src/platform/lan-engine.ts', 'lan/engine.mjs', { platform: 'node', format: 'esm', banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" } });
const pkg = JSON.parse(readFileSync(join(root, 'package.json')));
const engine = await import(new URL('../lan/engine.mjs', import.meta.url));
const sha256 = Object.fromEntries(['engine.js','engine-worker.js','engine-worker-src.js','app.js','app.css','index.html','language.js','ai/bundled.js'].map(n => [n, createHash('sha256').update(readFileSync(join(web,n))).digest('hex')]));
writeFileSync(join(web, 'build-info.json'), JSON.stringify({ application: 'Broadboard Online', version: pkg.version, upstreamVersion: '7.0.2 + 7.0.1-cc1-loop1', builtAt: new Date().toISOString(), fingerprint: engine.BUILD_FINGERPRINT, sha256 }, null, 2)+'\n');
console.log('Built Broadboard Online ' + pkg.version + ': dist/web + matching lan/engine.mjs');
