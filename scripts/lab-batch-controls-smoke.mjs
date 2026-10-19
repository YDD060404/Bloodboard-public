// V7-10 — the Match Lab's batch controls checked against what actually ran: game counts, fixed vs random rosters, fresh vs fixed seeds,
// fixed-seed swapped-side pairs (same seed, coaches exchanged), and one-click individual + batch history export. Two-game batches, not a benchmark (a built-in v built-in Sevens game takes minutes on a 2-core machine).
//   LAB_DIR=/path/to/match-lab node scripts/lab-batch-controls-smoke.mjs
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const SRC = process.env.LAB_DIR; if (!SRC) throw new Error('LAB_DIR is required');
const tmp = mkdtempSync(join(tmpdir(), 'lab-batch-')); const LAB = join(tmp, 'match-lab');
cpSync(SRC, LAB, { recursive: true, filter: (p) => !/\/(runs|exports)(\/|$)/.test(p) });
const results = []; const check = (n, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ` — ${d}` : ''}`); };
const lab = (...a) => spawnSync(process.execPath, ['lab.mjs', ...a], { cwd: LAB, encoding: 'utf8', timeout: 1700000, maxBuffer: 1 << 27 });
const base = { format: 'sevens', mode: 'exhibition', rules: 'full', p1: 'builtin:balanced', p2: 'builtin:offensive', mirror: false, observations: 'compact', features: true, maxSteps: 6000, lifecycle: 'preset' };
function run(label, over) {
  const f = join(LAB, `${label.replace(/\W+/g, '-')}.json`); writeFileSync(f, JSON.stringify({ ...base, label, ...over }));
  const r = lab('run', f);
  const runs = join(LAB, 'runs');
  const dir = existsSync(runs) ? readdirSync(runs).map((d) => join(runs, d)).find((d) => existsSync(join(d, 'run.json')) && JSON.parse(readFileSync(join(d, 'run.json'), 'utf8')).label === label) : null;
  const games = dir ? readdirSync(join(dir, 'games')).filter((x) => /\.json$/.test(x) && !/save|error|aborted|bbhistory/.test(x)).sort().map((x) => JSON.parse(readFileSync(join(dir, 'games', x), 'utf8'))) : [];
  return { r, dir, id: dir ? dir.split('/').pop() : null, games, run: dir ? JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')) : null };
}
// 1. fixed-seed list, swapped-side pairs, fixed rosters
const A = run('batch swap pairs', { teamKind: 'fixed', team1: 'roster:draft:human', team2: 'roster:draft:orc', seedKind: 'list', seedList: '5', pairing: 'swap' });
check('swap pairing over a seed list: finished, 1 seed x 2 legs = 2 games', A.r.status === 0 && A.games.length === 2, `${A.games.length} games; ${(A.r.stdout + A.r.stderr).trim().split('\n').slice(-1)[0]?.slice(0, 120)}`);
const byPair = new Map(); for (const g of A.games) { const k = g.pair ?? g.seed; (byPair.get(k) ?? byPair.set(k, []).get(k)).push(g); }
const sample = A.games[0] ?? {};
console.log('  record keys:', Object.keys(sample).join(','));
const pairsOk = [...byPair.values()].every((p) => p.length === 2 && p[0].seed === p[1].seed);
check('each pair replays ONE seed twice', byPair.size === 1 && pairsOk, JSON.stringify([...byPair.values()].map((p) => p.map((g) => g.seed))));
const coachOf = (g, side) => JSON.stringify(g.coaches?.[side] ?? g.sides?.[side] ?? g.teams?.[side]?.coach ?? null);
const swapped = [...byPair.values()].every(([a, b]) => b && coachOf(a, 'A') === coachOf(b, 'B') && coachOf(a, 'B') === coachOf(b, 'A') && coachOf(a, 'A') !== coachOf(a, 'B'));
check('in the second leg the two coaches have exchanged sides', swapped);
check('the seeds are exactly the requested ones (5)', JSON.stringify([...new Set(A.games.map((g) => g.seed))].sort()) === '[5]');
const rosterOf = (g, side) => g.rosters?.[side] ?? g.teams?.[side]?.roster ?? g.teams?.[side]?.name ?? null;
check('fixed rosters: every game used Humans v Orcs', A.games.every((g) => /human/i.test(String(rosterOf(g, 'A') ?? '') + String(rosterOf(g, 'B') ?? '')) && /orc/i.test(String(rosterOf(g, 'A') ?? '') + String(rosterOf(g, 'B') ?? ''))), JSON.stringify([rosterOf(sample, 'A'), rosterOf(sample, 'B')]));
// 2. fresh seeds, no pairing, rosters drawn from a pool
const B = run('batch fresh random', { teamKind: 'random', pool: ['roster:draft:human', 'roster:draft:orc', 'roster:draft:dwarf'], seedKind: 'fresh', pairing: 'none', count: 2 });
check('fresh seeds, no pairing: 2 games', B.r.status === 0 && B.games.length === 2, `${B.games.length}`);
check('fresh seeds differ from game to game', new Set(B.games.map((g) => g.seed)).size === B.games.length, JSON.stringify(B.games.map((g) => g.seed)));
const allowed = /human|orc|dwarf/i;
check('random rosters come from the chosen pool and are recorded', B.games.length > 0 && B.games.every((g) => allowed.test(String(rosterOf(g, 'A'))) && allowed.test(String(rosterOf(g, 'B')))), JSON.stringify(B.games.map((g) => [rosterOf(g, 'A'), rosterOf(g, 'B')])));
// 3. exports: one game, then the whole batch
if (A.id) {
  const one = lab('export', A.id, '1'); const all = lab('export', A.id);
  const ex = join(LAB, 'exports'); const dirs = existsSync(ex) ? readdirSync(ex) : [];
  check('export of one game and of the whole batch both succeed and write a folder (and a zip)', one.status === 0 && all.status === 0 && dirs.filter((d) => !d.endsWith('.zip')).length >= 2 && dirs.some((d) => d.endsWith('.zip')), JSON.stringify(dirs));
  const full = dirs.filter((d) => !d.endsWith('.zip')).map((d) => join(ex, d)).find((d) => existsSync(join(d, 'history-batch.json')));
  check('the batch export carries one canonical history batch and each game\'s canonical history', !!full && readdirSync(join(full, 'games')).filter((x) => /bloodboard-history\.json$/.test(x)).length === 2, full ?? 'no history-batch.json');
  if (full) {
    const rep = JSON.parse(readFileSync(join(full, 'history-batch-report.json'), 'utf8'));
    check('every game in the batch export was verified by re-execution', rep.games?.length === 2 && rep.games.every((g) => g.grade === 'verified'), JSON.stringify(rep.games?.[0]));
  }
}
const ok = results.filter(Boolean).length; console.log(`\n${ok}/${results.length} passed`); process.exit(ok === results.length ? 0 : 1);
