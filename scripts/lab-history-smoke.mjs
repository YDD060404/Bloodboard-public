// V7-06 Match Lab canonical history (short, not a benchmark): plays TWO Sevens games in a temp copy of the Lab, checks that each completed
// game wrote a canonical history, that `./lab export` carries them AND one verified batch, and that the batch re-verifies with the GAME's
// importer (Lab and game cross-verification: the same verifier accepts what the Lab wrote).
//   LAB_DIR=/path/to/match-lab ESBUILD=… node scripts/lab-history-smoke.mjs
import { spawnSync, execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const SRC = process.env.LAB_DIR; if (!SRC) throw new Error('LAB_DIR is required');
const tmp = mkdtempSync(join(tmpdir(), 'lab-hist-'));
const LAB = join(tmp, 'match-lab');
cpSync(SRC, LAB, { recursive: true, filter: (p) => !/\/(runs|exports)(\/|$)/.test(p) });
const results = [];
const check = (n, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ` — ${d}` : ''}`); };
const lab = (...a) => spawnSync(process.execPath, ['lab.mjs', ...a], { cwd: LAB, encoding: 'utf8', timeout: 540000, maxBuffer: 1 << 28 });
const f = join(LAB, 'hist.json');
writeFileSync(f, JSON.stringify({ format: 'sevens', mode: 'exhibition', rules: 'full', p1: 'builtin:balanced', p2: 'builtin:balanced', teamKind: 'fixed', team1: 'roster:draft:human', team2: 'roster:draft:orc', mirror: false, pool: [], seedKind: 'base', seedBase: 7, pairing: 'none', count: 2, observations: 'compact', features: true, maxSteps: 6000, lifecycle: 'preset', label: 'history smoke' }));
const r = lab('run', f);
check('lab run (2 games) finished', r.status === 0, (r.stdout + r.stderr).split('\n').filter(Boolean).slice(-1).join('').slice(0, 160));
const runs = join(LAB, 'runs');
const dir = readdirSync(runs).map((d) => join(runs, d)).find((d) => existsSync(join(d, 'run.json')) && JSON.parse(readFileSync(join(d, 'run.json'), 'utf8')).label === 'history smoke');
check('the batch folder exists', !!dir);
const run = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));
const hist = readdirSync(join(dir, 'games')).filter((x) => x.endsWith('.bbhistory.json'));
check('each completed game wrote a canonical history next to its record', hist.length === 2, hist.join(', '));
// the game's own importer (bundled engine) accepts them
const tmpEng = join(tmp, 'engine.cjs');
execFileSync(process.env.ESBUILD || 'node_modules/.bin/esbuild', ['src/engine/index.ts', '--bundle', '--platform=node', '--format=cjs', `--outfile=${tmpEng}`, '--log-level=error']);
const { createRequire } = await import('node:module');
const E = createRequire(import.meta.url)(tmpEng);
for (const h of hist) {
  const imp = E.importHistories(readFileSync(join(dir, 'games', h), 'utf8'));
  check(`${h}: the GAME's verifier accepts the Lab's history`, imp.ok && imp.reports[0].grade.startsWith('verified'), imp.ok ? imp.reports[0].reason : imp.errors.join());
  const one = imp.ok ? imp.verified[0] : null;
  check(`${h}: source is lab, with the Lab plan recorded and built-in coaches recorded as such`, one?.source === 'lab' && one.extensions?.lab?.plan === run.id && one.participants.A.controller.kind === 'builtin', one && JSON.stringify(one.extensions));
}
const ex = lab('export', run.id);
check('lab export finished', ex.status === 0, (ex.stdout + ex.stderr).slice(-200));
const exports = join(LAB, 'exports');
const folder = existsSync(exports) ? readdirSync(exports).map((d) => join(exports, d)).find((d) => existsSync(join(d, 'history-batch.json'))) : null;
check('the export contains history-batch.json and a report', !!folder && existsSync(join(folder, 'history-batch-report.json')));
if (folder) {
  const batchText = readFileSync(join(folder, 'history-batch.json'), 'utf8');
  const imp = E.importHistories(batchText);
  check('the batch re-verifies in the game importer: every game verified, none refused', imp.ok && imp.reports.length === 2 && imp.reports.every((x) => x.grade.startsWith('verified')), imp.ok ? JSON.stringify(imp.reports.map((x) => x.grade)) : imp.errors.join());
  const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8'));
  check('the manifest lists the canonical histories', JSON.stringify(manifest).includes('canonical-history'));
  const rep = JSON.parse(readFileSync(join(folder, 'history-batch-report.json'), 'utf8'));
  check('the report names every game and its grade', rep.games.length === 2 && rep.games.every((g) => g.grade));
}
const v = lab('verify', run.id);
check('./lab verify (the Lab\'s own input replay) still agrees', v.status === 0, (v.stdout || v.stderr).slice(0, 160));
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
