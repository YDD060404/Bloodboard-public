// V6 Match Lab smoke (short, not a benchmark): copies the Lab to a temp folder (the real Lab's data is never touched), plays ONE Sevens
// game with each team-construction option, checks the game record (engine fingerprint, lifecycle reports, receipts in the trajectory),
// then `./lab verify` replays it. Run:  LAB_DIR=/path/to/match-lab node scripts/lab-smoke-v6.mjs
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const SRC = process.env.LAB_DIR; if (!SRC) throw new Error('LAB_DIR is required');
const tmp = mkdtempSync(join(tmpdir(), 'lab-v6-'));
const LAB = join(tmp, 'match-lab');
cpSync(SRC, LAB, { recursive: true, filter: (p) => !/\/(runs|exports)(\/|$)/.test(p) });
const results = [];
function check(name, ok, detail = '') { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); }
const lab = (...a) => spawnSync(process.execPath, ['lab.mjs', ...a], { cwd: LAB, encoding: 'utf8', timeout: 540000, maxBuffer: 1 << 26 });
cpSync(join(process.cwd(), 'examples/ai/api-v2/team-builder-example.js'), join(LAB, 'coaches', 'team-builder-example.js'));
const moduleKey = lab('coaches').stdout.split('\n').map((l) => l.split('\t')[0]).find((k) => /team-builder-example\.js$/.test(k));
check('the v2 example coach is visible to the Lab', !!moduleKey, moduleKey ?? '');
for (const mode of ['preset', 'builtin', 'ai']) {
  const withModule = mode === 'ai' && moduleKey;
  const f = join(LAB, `smoke-${mode}.json`);
  writeFileSync(f, JSON.stringify({ format: 'sevens', mode: 'exhibition', rules: 'full', p1: withModule ? moduleKey : 'builtin:balanced', p2: 'builtin:balanced', teamKind: 'fixed', team1: 'roster:draft:human', team2: 'roster:draft:orc', mirror: false, pool: [], seedKind: 'base', seedBase: 7, pairing: 'none', count: 1, observations: 'compact', features: true, maxSteps: 6000, lifecycle: mode, label: `smoke ${mode}` }));
  const r = lab('run', f);
  check(`lab run (${mode}) finished`, r.status === 0, (r.stdout + r.stderr).split('\n').filter(Boolean).slice(-2).join(' | ').slice(0, 200));
  const runs = join(LAB, 'runs');
  const dir = existsSync(runs) ? readdirSync(runs).map((d) => join(runs, d)).filter((d) => existsSync(join(d, 'run.json'))).find((d) => JSON.parse(readFileSync(join(d, 'run.json'), 'utf8')).label === `smoke ${mode}`) : null;
  check(`${mode}: the batch folder exists`, !!dir);
  if (!dir) continue;
  const run = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));
  check(`${mode}: run.json carries the engine fingerprint and lifecycle setting`, run.fingerprint?.rulesHash && run.settings.lifecycle === mode, JSON.stringify(run.fingerprint?.version));
  const gf = readdirSync(join(dir, 'games')).find((x) => /\.json$/.test(x) && !/save|error|aborted|bbhistory/.test(x));
  const rec = JSON.parse(readFileSync(join(dir, 'games', gf), 'utf8'));
  check(`${mode}: the game record has the engine fingerprint, lifecycle reports and a completed result`, rec.engine?.rulesHash === run.fingerprint.rulesHash && rec.lifecycle?.mode === mode && rec.result && (mode === 'preset' || (rec.lifecycle.reports.A?.stage === 'build' && rec.lifecycle.reports.B?.stage === 'build')), JSON.stringify(rec.lifecycle?.reports?.A && [rec.lifecycle.reports.A.via, rec.lifecycle.reports.A.fellBack, rec.lifecycle.reports.A.attempts]));
  const traj = readFileSync(join(dir, 'trajectories.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const nr = traj.filter((l) => l.schema === 'bloodboard-receipt/1');
  check(withModule ? `${mode}: execution receipts of the module coach are in the trajectory (bloodboard-receipt/1)` : `${mode}: built-in coaches write no receipts (receipts are for module coaches)`, withModule ? nr.some((l) => l.receipt?.accepted) : nr.length === 0, `${nr.length} receipts`);
  const v = lab('verify', run.id);
  let out = null; try { out = JSON.parse(v.stdout); } catch { /* */ }
  check(`${mode}: ./lab verify replays the history and agrees`, v.status === 0, (v.stdout || v.stderr).slice(0, 300));
}
// Generation-2 object rule answers through the Lab production path (COACH-07): minimal-v2 declares apiMinor 0 and answers
// every rule choice with { optionId, why }. Before the generation-aware fix the host rejected those answers and fell back.
{
  cpSync(join(process.cwd(), 'examples/ai/api-v2/minimal-coach-v2.js'), join(LAB, 'coaches', 'minimal-coach-v2.js'));
  const key = lab('coaches').stdout.split('\n').map((l) => l.split('\t')[0]).find((k) => /minimal-coach-v2\.js$/.test(k));
  check('the v2 minimal coach is visible to the Lab', !!key);
  const f = join(LAB, 'smoke-objrule.json');
  writeFileSync(f, JSON.stringify({ format: 'sevens', mode: 'exhibition', rules: 'full', p1: key, p2: key, teamKind: 'fixed', team1: 'roster:draft:human', team2: 'roster:draft:orc', mirror: false, pool: [], seedKind: 'base', seedBase: 11, pairing: 'none', count: 1, observations: 'compact', features: true, maxSteps: 6000, lifecycle: 'preset', label: 'smoke objrule' }));
  const r = lab('run', f);
  check('lab run (gen-2 object rule answers) finished', r.status === 0, (r.stdout + r.stderr).split('\n').filter(Boolean).slice(-1).join('').slice(0, 160));
  const runs = join(LAB, 'runs');
  const dir = readdirSync(runs).map((d) => join(runs, d)).find((d) => existsSync(join(d, 'run.json')) && JSON.parse(readFileSync(join(d, 'run.json'), 'utf8')).label === 'smoke objrule');
  if (dir) {
    const run = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));
    check('run.json records apiGeneration 2 for the module coach', run.coaches.some((c) => c.apiVersion === 2), JSON.stringify(run.coaches.map((c) => [c.name, c.apiVersion, c.apiMinor])));
    const traj = readFileSync(join(dir, 'trajectories.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const rd = traj.filter((l) => l.kind === 'decision' && l.ruleDecision && l.coach?.id === 'minimal-v2');
    const forced = rd.filter((l) => l.source.via === 'forced').length;
    const obj = rd.filter((l) => l.source.via === 'decision:object');
    const fb = rd.filter((l) => l.source.fellBack);
    console.log(`  rule decisions: ${rd.length} (forced ${forced}, object ${obj.length}, fell back ${fb.length})`);
    check('at least one real rule decision was answered by the module with an object, none fell back', obj.length > 0 && fb.length === 0, `${rd.length} rule decisions`);
    const v = lab('verify', run.id);
    check('gen-2 object-answer game: ./lab verify replays and agrees', v.status === 0, (v.stdout || v.stderr).slice(0, 200));
  } else check('gen-2 object-answer batch folder exists', false);
}
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
