// Builds the self-contained Render deployment folder for the CURRENT build: only the runnable match server and the web app (no source, no tests,
// no rulebooks, no AI folder, no credentials). Run after `scripts/build.mjs`.
//   node scripts/package-render.mjs [--out release]
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';
const root = process.cwd();
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const name = `Bloodboard-${pkg.version}-render`;
const out = join(root, arg('out', 'release'), name);
rmSync(out, { recursive: true, force: true }); mkdirSync(join(out, 'lan'), { recursive: true });
for (const f of ['server.mjs', 'room.mjs', 'store.mjs', 'engine.mjs']) cpSync(join('lan', f), join(out, 'lan', f));
cpSync('dist/web', join(out, 'web'), { recursive: true });
cpSync('deploy/render/render.yaml', join(out, 'render.yaml'));
cpSync('deploy/render/package.json', join(out, 'package.json'));
cpSync('deploy/render/gitignore.txt', join(out, '.gitignore'));
cpSync('docs/RENDER_FREE.md', join(out, 'RENDER_SETUP.md'));
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
for (const f of walk(out)) chmodSync(f, 0o644);
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const files = walk(out).sort();
const bi = JSON.parse(readFileSync('dist/web/build-info.json', 'utf8'));
const fp = JSON.parse(/BUILD_FINGERPRINT = (\{[\s\S]*?\}) as const/.exec(readFileSync('src/engine/fingerprint.ts', 'utf8'))[1]);
writeFileSync(join(out, 'MANIFEST.json'), JSON.stringify({ product: 'Bloodboard match server (Render Free bundle)', version: pkg.version, builtAt: new Date().toISOString(), fingerprints: fp, webBuild: bi, files: files.map((f) => ({ path: relative(out, f), bytes: readFileSync(f).length, sha256: sha(f) })) }, null, 1));
writeFileSync(join(out, 'SHA256SUMS'), walk(out).filter((f) => !/SHA256SUMS$/.test(f)).sort().map((f) => `${sha(f)}  ${relative(out, f)}`).join('\n') + '\n');
// a fixed-order, fixed-timestamp zip so the same inputs give the same bytes
const zip = join(root, arg('out', 'release'), `${name}.zip`); rmSync(zip, { force: true });
execFileSync('bash', ['-c', `cd "${join(root, arg('out', 'release'))}" && find "${name}" -type f | sort | TZ=UTC zip -X -q "${name}.zip" -@`]);
console.log(`${name}: ${files.length + 2} files; zip sha256 ${sha(zip)}`);
console.log(`folder: ${out}\nzip:    ${zip}`);
