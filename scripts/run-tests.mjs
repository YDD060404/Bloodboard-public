// Bundles tests/*.test.ts with esbuild and runs them with node's test runner.
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.env.BB_TEST_OUT || join(root, 'build', 'tests');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const only = process.argv.slice(2);
const files = readdirSync(join(root, 'tests')).filter((f) => f.endsWith('.test.ts') && (!only.length || only.some((o) => f.includes(o))));
const esbuild = process.env.ESBUILD || 'esbuild';
execFileSync(esbuild, [...files.map((f) => join('tests', f)), '--bundle', '--platform=node', '--format=esm', '--target=node18', `--outdir=${out}`, '--log-level=warning', "--banner:js=import { createRequire } from 'module'; const require = createRequire(import.meta.url);"], { cwd: root, stdio: 'inherit' });
try { execFileSync(esbuild, ['src/platform/engine-worker.ts', '--bundle', '--format=iife', '--target=es2020', '--outfile=build/engine-worker.js', '--log-level=warning'], { cwd: root, stdio: 'inherit' }); } catch { /* pool tests are skipped without the bundle */ }
const built = readdirSync(out).filter((f) => f.endsWith('.js')).map((f) => join(out, f));
const concurrency = process.env.BB_TEST_CONCURRENCY ? ['--test-concurrency=' + process.env.BB_TEST_CONCURRENCY] : [];
const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...concurrency, ...built], { stdio: 'inherit' });
process.exit(r.status ?? 1);
