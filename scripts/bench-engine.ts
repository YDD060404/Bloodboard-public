/**
 * Engine-service benchmark on fixed positions (bench/positions.json): single-decision latency of a representative
 * analysis workload, per service, with the same inputs and settings in every mode.
 *
 *   node build/bench-engine.mjs bench/positions.json [--mode inline|pool] [--workers N] [--reps R] [--out file.json] [--only id,id]
 *
 * The workload (per position) is what a search coach asks for in one decision:
 *   1 candidates (exact probabilities, sorted by pSuccess)          — one wide call
 *   2 threats.{blitz,scoring,crowd,reach,tackleZones}               — five calls
 *   3 explore of the 8 best candidates (default policy) and of the 4 best with adversarial decisions
 * Modes: "inline" = every call on the calling thread in order (the V5.6.1 behaviour); "pool" = the same calls through
 * the engine pool: phase 1 and 2 are issued one after the other (latency of a coach that awaits each call), phase 3 also
 * as one `batch` (latency of a coach that batches independent calls).
 */
import * as Engine from '../src/engine/index';
import { bindEngine } from '../src/ai/index';
import { Session } from '../src/platform/session';
import { DEFAULT_LIMITS } from '../src/platform/limits';
import { callService } from '../src/platform/services';
import { readFileSync, writeFileSync } from 'node:fs';
declare const process: any;
bindEngine(Engine);

const args = process.argv.slice(2);
const flag = (n: string, d?: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const mode = flag('mode', 'inline');
const reps = Number(flag('reps', '1'));
const only = flag('only')?.split(',');
const leafCap = flag('leafcap') ? Number(flag('leafcap')) : null;
const positions = JSON.parse(readFileSync(args[0], 'utf8')).positions as Array<{ id: string; state: any; active: string }>;

type Exec = (ses: Session, name: string, a: unknown[]) => Promise<any>;
const digest = (x: unknown, nd = 9): string => JSON.stringify(x, (_k, v) => (typeof v === 'number' ? Math.round(v * 10 ** nd) / 10 ** nd : v));

let reqSeq = 0;
async function workload(exec: Exec, posEntry: { id: string; state: any; active: string }) {
  const ses = new Session(posEntry.state, posEntry.active as any, ++reqSeq, 60000, { ...DEFAULT_LIMITS });
  ses.leafCapOverride = leafCap;
  if (mode !== 'pool') ses.planStore = null;
  const team = posEntry.active;
  const phases: Record<string, number> = {};
  const per: Record<string, { n: number; ms: number }> = {};
  const unresolved: number[] = [];
  const out: Record<string, unknown> = {};
  const timed = async <T,>(label: string, f: () => Promise<T>): Promise<T> => { const t = Date.now(); const r = await f(); const ms = Date.now() - t; const k = label.split(':')[0]; (per[k] ??= { n: 0, ms: 0 }); per[k].n++; per[k].ms += ms; return r; };
  const t0 = Date.now();
  let t = Date.now();
  const cands: any = await timed('candidates', () => exec(ses, 'candidates', [{ team, precision: 'exact', sort: 'pSuccess', limit: 60, maxMs: 30000, builtIn: false }]));
  phases.candidates = Date.now() - t;
  out.candidates = (cands.candidates ?? []).map((c: any) => [c.label, c.pSuccess, c.pTurnover, c.pTouchdown, c.unresolved]);
  for (const c of cands.candidates ?? []) if (typeof c.unresolved === 'number') unresolved.push(c.unresolved);
  t = Date.now();
  const thr: any = {};
  for (const [n, o] of [['threats.blitz', { team, maxMs: 30000 }], ['threats.scoring', { team, maxMs: 30000 }], ['threats.crowd', { team, maxMs: 30000 }], ['threats.reach', { maxMs: 30000 }], ['threats.tackleZones', {}]] as Array<[string, any]>) thr[n] = await timed(n, () => exec(ses, n, [o]));
  phases.threats = Date.now() - t;
  out.threats = Object.fromEntries(Object.entries(thr).map(([k, v]: any) => [k, v.ok ? 'ok' : v.code]));
  out.blitz = (thr['threats.blitz'].blitzes ?? []).map((b: any) => [b.attackerId, b.targetId, (b.variants ?? []).map((v: any) => [v.pTurnover, v.pTargetDown])]);
  out.scoring = (thr['threats.scoring'].threats ?? []).map((x: any) => [x.playerId, x.pTouchdown, x.pTurnover]);
  t = Date.now();
  const risky: any = await timed('candidates', () => exec(ses, 'candidates', [{ team, precision: 'exact', families: ['block', 'blitz', 'pass', 'handoff', 'foul'], sort: 'pTurnover', limit: 40, maxMs: 30000, builtIn: false, maxPerPlayer: 4 }]));
  phases.candidatesRisky = Date.now() - t;
  out.risky = (risky.candidates ?? []).map((c: any) => [c.label, c.pSuccess, c.pTurnover, c.pTouchdown, c.unresolved]);
  for (const c of risky.candidates ?? []) if (typeof c.unresolved === 'number') unresolved.push(c.unresolved);
  // the riskiest legal candidates with some chance of success: they have the most outcomes to enumerate
  const top = (risky.candidates ?? []).filter((c: any) => c.input && c.legal && (c.pTurnover ?? 0) > 0.05).sort((a: any, b: any) => (b.pTurnover ?? 0) - (a.pTurnover ?? 0)).slice(0, 8);
  t = Date.now();
  const ex: any[] = [];
  for (const c of top) ex.push(await timed('explore', () => exec(ses, 'explore', [c.input, { team, maxMs: 30000, maxOutcomes: 6, observations: false, maxLeaves: 4000 }])));
  for (const c of top.slice(0, 4)) ex.push(await timed('explore', () => exec(ses, 'explore', [c.input, { team, maxMs: 30000, maxOutcomes: 6, observations: false, maxLeaves: 4000, decisions: 'adversarial' }])));
  phases.exploreSeq = Date.now() - t;
  out.explore = ex.map((e) => (e.ok ? [e.value, e.pTurnover, e.pTouchdown, e.unresolvedMass, e.exact] : e.code));
  for (const e of ex) if (e.ok) unresolved.push(e.unresolvedMass);
  let batchMs: number | null = null;
  if (mode === 'pool') {
    t = Date.now();
    const items = [...top.map((c: any) => ({ service: 'explore', args: [c.input, { team, maxMs: 30000, maxOutcomes: 6, observations: false, maxLeaves: 4000 }] })), ...top.slice(0, 4).map((c: any) => ({ service: 'explore', args: [c.input, { team, maxMs: 30000, maxOutcomes: 6, observations: false, maxLeaves: 4000, decisions: 'adversarial' }] }))];
    const b: any = await exec(ses, 'batch', [items]);
    batchMs = Date.now() - t;
    out.batch = (b.results ?? []).map((e: any) => (e.ok ? [e.value, e.pTurnover, e.pTouchdown, e.unresolvedMass, e.exact] : e.code));
  }
  const total = Date.now() - t0;
  return { id: posEntry.id, totalMs: total, phases, batchMs, per, maxUnresolved: unresolved.length ? Math.max(...unresolved) : 0, meanUnresolved: unresolved.length ? unresolved.reduce((a, b) => a + b, 0) / unresolved.length : 0, digest: digest(out), nCands: (cands.candidates ?? []).length, usage: { ...ses.stats, wallServiceMs: Math.round(ses.wallServiceMs) }, out };
}

async function main() {
  let exec: Exec;
  let pool: any = null;
  if (mode === 'pool') {
    const { makeNodePool } = await import('../src/platform/research/nodepool');
    const { callServiceAsync } = await import('../src/platform/dispatch');
    pool = makeNodePool({ size: Number(flag('workers', '2')) });
    exec = (ses, n, a) => callServiceAsync(ses, n, a, { pool }) as Promise<any>;
  } else exec = async (ses, n, a) => callService(ses, n, a);
  const res: any[] = [];
  const list = positions.filter((p) => !only || only.includes(p.id));
  for (let r = 0; r < reps; r++) for (const p of list) {
    if (pool) pool.clearCaches();
    const x = await workload(exec, p);
    if (r === reps - 1 || reps === 1) res.push(x);
    process.stderr.write(`${mode}${pool ? ' w' + pool.size : ''} ${p.id}: total ${x.totalMs} ms (cand ${x.phases.candidates}, threats ${x.phases.threats}, explore ${x.phases.exploreSeq}${x.batchMs !== null ? ', batch ' + x.batchMs : ''}) maxUnres ${x.maxUnresolved.toExponential(2)} heap ${(process.memoryUsage().heapUsed / 1048576) | 0} MB\n`);
  }
  const summary = { mode, workers: pool ? pool.size : 0, reps, nodeVersion: process.version, cpus: (await import('node:os')).cpus().length, positions: res, stats: pool ? pool.stats() : null, rssMB: (process.memoryUsage().rss / 1048576) | 0, heapMB: (process.memoryUsage().heapUsed / 1048576) | 0 };
  if (flag('out')) writeFileSync(flag('out') as string, JSON.stringify(summary));
  if (pool) pool.close();
  process.exit(0);
}
main();
