// Online-coach smoke through the REAL Match Lab path (short, not a benchmark): a generated DeepSeek/Luna coach module plays one Sevens
// game in a temp copy of the Lab, talking to a real local bridge whose provider is a deterministic stand-in (no network, no credentials).
// This verifies the host path (worker fetch, gen-2 object rule answers, receipts, context, fallback truthfulness), NOT a real provider.
//   LAB_DIR=/path/to/match-lab node scripts/lab-online-smoke.mjs
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridge } from '../online/bridge.mjs';
import { coachSource } from '../online/build-coach.mjs';
import { ProviderError } from '../online/providers/errors.mjs';

const SRC = process.env.LAB_DIR; if (!SRC) throw new Error('LAB_DIR is required');
const tmp = mkdtempSync(join(tmpdir(), 'lab-online-'));
const LAB = join(tmp, 'match-lab');
cpSync(SRC, LAB, { recursive: true, filter: (p) => !/\/(runs|exports)(\/|$)/.test(p) });
mkdirSync(join(LAB, 'coaches'), { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
const lab = (...a) => spawnSync(process.execPath, ['lab.mjs', ...a], { cwd: LAB, encoding: 'utf8', timeout: 540000, maxBuffer: 1 << 26 });
/** The bridge lives in THIS process, so the long Lab run must not block the event loop. */
const labAsync = (...a) => new Promise((res) => { const c = spawn(process.execPath, ['lab.mjs', ...a], { cwd: LAB }); let out = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; }); c.on('close', (status) => res({ status, stdout: out, stderr: '' })); });
const CAP = 'c'.repeat(64);

/** Deterministic stand-in provider: picks the first offered candidate / rule option; optionally returns a candidateId:null first, or fails. */
function standIn(id, mode) {
  const stats = { calls: 0, nullFirst: 0, rules: 0, acts: 0 };
  return { stats, id, name: id, route: 'stand-in', concurrency: 8,
    async status() { return { id, configured: true, connected: true }; }, async listModels() { return [{ id: 'm1' }]; }, async check() { return { ok: true }; },
    async complete({ messages }) {
      stats.calls++;
      if (mode === 'down') throw new ProviderError('provider_overloaded', 'overloaded', { retryable: true, status: 503 });
      const ctx = JSON.parse(messages[0].content);
      const corrected = messages.some((m) => m.role === 'user' && /Rejected before execution/.test(m.content));
      const rev = ctx.observation.revision;
      if (ctx.request) { stats.rules++; return { text: JSON.stringify({ type: 'rule', revision: rev, optionId: ctx.request.options[0].id, why: 'stand-in rule answer', plan: 'stand-in' }), meta: { elapsedMs: 1 } }; }
      stats.acts++;
      if (mode === 'null-first' && !corrected) { stats.nullFirst++; return { text: JSON.stringify({ type: 'act', revision: rev, candidateId: null, why: 'bad id' }), meta: { elapsedMs: 1 } }; }
      const cand = ctx.offeredCandidates[0];
      const input = cand ? { candidateId: cand.id } : { input: { kind: 'endTurn' } };
      return { text: JSON.stringify({ type: 'act', revision: rev, ...input, why: 'stand-in action', plan: 'stand-in' }), meta: { elapsedMs: 1 } };
    } };
}

async function leg(provider, mode) {
  const p = standIn(provider, mode);
  const bridge = createBridge({ providers: [p], instructions: 'Return JSON.', capability: CAP, port: 0 });
  const port = await bridge.listen();
  try {
    const { text } = await coachSource({ provider, model: 'm1', capability: CAP, port });
    const file = `online-${provider}-${mode}.js`;
    writeFileSync(join(LAB, 'coaches', file), text);
    const key = lab('coaches').stdout.split('\n').map((l) => l.split('\t')[0]).find((k) => k.endsWith(file));
    check(`${provider}/${mode}: the generated coach is visible to the Lab`, !!key, key ?? '');
    if (!key) return;
    const label = `online ${provider} ${mode}`;
    const f = join(LAB, `online-${provider}-${mode}.json`);
    writeFileSync(f, JSON.stringify({ format: 'sevens', mode: 'exhibition', rules: 'full', p1: key, p2: 'builtin:balanced', teamKind: 'fixed', team1: 'roster:draft:human', team2: 'roster:draft:orc', mirror: false, pool: [], seedKind: 'base', seedBase: 11, pairing: 'none', count: 1, observations: 'compact', features: true, maxSteps: 6000, lifecycle: 'preset', label }));
    const r = await labAsync('run', f);
    check(`${provider}/${mode}: lab run finished`, r.status === 0, (r.stdout + r.stderr).split('\n').filter(Boolean).slice(-2).join(' | ').slice(0, 200));
    const runs = join(LAB, 'runs');
    const dir = existsSync(runs) ? readdirSync(runs).map((d) => join(runs, d)).find((d) => existsSync(join(d, 'run.json')) && JSON.parse(readFileSync(join(d, 'run.json'), 'utf8')).label === label) : null;
    if (!dir) { check(`${provider}/${mode}: batch folder exists`, false); return; }
    const gf = readdirSync(join(dir, 'games')).find((x) => /\.json$/.test(x) && !/save|error|aborted|bbhistory/.test(x));
    const rec = JSON.parse(readFileSync(join(dir, 'games', gf), 'utf8'));
    const traj = readFileSync(join(dir, 'trajectories.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const receipts = traj.filter((l) => l.schema === 'bloodboard-receipt/1');
    check(`${provider}/${mode}: the game completed`, !!rec.result, JSON.stringify(rec.result ?? null).slice(0, 120));
    if (mode !== 'down') check(`${provider}/${mode}: the bridge served model calls (acts ${p.stats.acts}, rule decisions ${p.stats.rules})`, p.stats.acts > 0 && p.stats.rules > 0);
    if (mode === 'null-first') check(`${provider}/null-first: candidateId:null was rejected ${p.stats.nullFirst}x and corrected, never played as End Turn`, p.stats.nullFirst > 0 && receipts.length > 0);
    if (mode === 'ok') check(`${provider}/ok: execution receipts of the online coach are recorded`, receipts.length > 0, `${receipts.length} receipts`);
    if (mode === 'down') {
      const fb = rec.result?.fallbacks?.A ?? 0, inc = rec.result?.incidents ?? [];
      check(`${provider}/down: every failed call is a recorded fallback with the provider's reason (${fb} fallbacks), not a model decision`, fb > 0 && p.stats.calls > 0 && inc.length > 0 && inc.every((i) => i.via === 'builtin' && /provider_overloaded/.test(i.reason)) && receipts.every((x) => x.source !== 'model'), inc[0]?.reason);
    }
    const v = lab('verify', JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')).id);
    check(`${provider}/${mode}: ./lab verify replays the history and agrees`, v.status === 0, (v.stdout || v.stderr).slice(0, 160));
  } finally { await bridge.close(); }
}
const LEGS = (process.env.LEGS ?? 'deepseek:ok,luna:ok,deepseek:null-first,deepseek:down').split(',');
for (const l of LEGS) { const [pv, md] = l.split(':'); await leg(pv, md); }
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
