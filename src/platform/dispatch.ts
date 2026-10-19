/**
 * Pooled service execution (V5.7): `callServiceAsync` is `callService` for a host that has an engine pool.
 *
 *  - Heavy services (`explore`, `sequence`, `candidates`, the `threats.*` scans, `plan`, `reachable`) run in an engine
 *    worker — off the interface thread — through exactly the same service code (`execService`).
 *  - Calls that evaluate many independent plans (`candidates`, `threats.blitz/scoring/crowd`) are FANNED OUT: a dry pass
 *    lists the exact plans the call needs, the plans not already cached are computed in parallel on all workers, and the
 *    real pass then runs with every plan at hand. Dependent steps stay sequential: a service call is one unit, and a
 *    module that awaits call after call gets calls one after another. Independent calls may be issued together
 *    (`Promise.all`, or the `batch` service) and then run concurrently, bounded by the pool size.
 *  - Identical questions are answered from the shared caches (`PlanCache`, `ResultCache`; keys include the position
 *    hash, the question and its precision settings; dice generator and log are not part of a position).
 *  - Budgets are the same ones the synchronous path enforces, with service time counted as wall clock (overlapping
 *    calls count once), so a parallel call does not spend the request's time budget faster than real time.
 *
 * A worker failure never breaks a decision: the call is repeated on the calling thread and a diagnostic says so.
 */
import type { ActionInput } from '../engine/index';
import { EnginePool, type JobResult, type Reply, type WorkerView } from './pool';
import { analysisHash, forWorker, PlanCache, ResultCache, type PlanOpts } from './analysis';
import { clamp, type Diagnostic } from './limits';
import { batchItems, callService, execService, FREE } from './services';
import { KeyError, fail, type PlanRequest, type Position, type Session } from './session';
import type { Ctx, PosRec } from './engine-worker';
import type { PlanResult } from '../engine/planner';
import { inputKey } from './candidates';

export interface Offload {
  pool: EnginePool;
}

type Args = unknown[];
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Services that run in an engine worker. */
const OFFLOAD = new Set(['explore', 'sequence', 'candidates', 'threats.tackleZones', 'threats.reach', 'threats.blitz', 'threats.scoring', 'threats.crowd', 'plan', 'reachable']);
/** Services made of many independent plans: worth a parallel fan-out. */
const FANOUT = new Set(['candidates', 'threats.blitz', 'threats.scoring', 'threats.crowd']);
/** Pure services whose complete results may be reused. */
const CACHEABLE = new Set(['plan', 'reachable', 'threats.tackleZones', 'threats.reach', 'threats.blitz', 'threats.scoring', 'threats.crowd']);

declare const process: { env: Record<string, string | undefined>; stderr: { write(s: string): void } } | undefined;
/** Diagnostics for measurements only (BB_TRACE=1 in a Node host). */
const TRACE: ((s: string) => void) | null = typeof process !== 'undefined' && process?.env?.BB_TRACE ? (s) => process.stderr.write(`[engine] ${s}\n`) : null;

const POS_RESERVE = 64;
const CAND_RESERVE = 512;

/** The position key an offloadable call names (undefined/null = the request's position). */
function fromOf(name: string, a: Args): unknown {
  if (name === 'plan' || name === 'reachable') return a[1];
  if (name === 'explore') return obj(a[1]).from;
  return obj(a[0]).from;
}

/** Arguments with the position and the time limit removed (neither changes a complete result). */
function questionOf(name: string, a: Args): unknown {
  if (name === 'plan') return [a[0]];
  if (name === 'reachable') return [a[0]];
  const o = { ...obj(a[0]) };
  delete o.from;
  delete o.maxMs;
  return [o];
}

function isComplete(name: string, r: unknown): boolean {
  if (Array.isArray(r)) return true;
  const o = obj(r);
  if (o.ok === false) return false;
  if (name === 'plan') return Math.max(obj(o.withTeamRerolls).unresolved as number || 0, obj(o.withoutTeamRerolls).unresolved as number || 0) < 1e-12 && o.ok === true;
  if (o.ok !== true) return false;
  if (o.exact === false) return false;
  const t = o.truncated;
  if (t && (!Array.isArray(t) || t.length)) return false;
  return true;
}

const keys = new WeakMap<Session, number>();
let nextKey = 1;
/** The pool-wide identity of a session's request (request numbers of different hosts / tests may coincide; this never does). */
export function poolKey(ses: Session): number {
  let k = keys.get(ses);
  if (!k) keys.set(ses, (k = nextKey++));
  return k;
}

const ctxs = new WeakMap<Session, Ctx>();
function ctxOf(ses: Session): Ctx {
  let c = ctxs.get(ses);
  if (!c) {
    c = { requestId: ses.requestId, team: ses.team, moduleMs: ses.moduleMs, limits: ses.limits, root: forWorker(ses.root), rootBuiltIn: [...ses.rootBuiltIn] as never, legacyErrors: ses.legacyErrors, leafCapOverride: ses.leafCapOverride };
    ctxs.set(ses, c);
  }
  return c;
}

const rec = (p: Position): PosRec => ({ key: p.key, state: forWorker(p.state), driveOver: p.driveOver, depth: p.depth, parent: p.parent, via: p.via });

function describe(r: JobResult): string | null {
  const x = r as Record<string, unknown>;
  if (x.cancelled) return 'cancelled';
  if (x.timedOut) return 'timed out';
  if (x.skipped) return 'skipped';
  if (typeof x.error === 'string') return x.error;
  if (x.t === 'fail') return String(x.message);
  return null;
}

async function submitService(ses: Session, off: Offload, name: string, args: Args, pos: Position, extra: Record<string, unknown>): Promise<JobResult> {
  const ids = ses.reserveIds(POS_RESERVE, CAND_RESERVE);
  const hardAt = ses.t0 + ses.moduleMs + 250;
  const budget = { serviceMs: ses.serviceTimeLeft(), leavesLeft: ses.leavesLeft(), leafRate: ses.leafRate, hardAt };
  const hostKept = ses.positions.size - 1;
  return off.pool.submit(
    (w: WorkerView) => {
      const m: Record<string, unknown> = { t: 'job', kind: 'service', request: poolKey(ses), name, args, budget, hostKept, ids: { pos: ids.pos, cand: ids.cand, posLimit: ids.pos + POS_RESERVE }, states: [] as PosRec[], ...extra };
      if (!w.hasContext(poolKey(ses))) {
        m.ctx = ctxOf(ses);
        w.sentContext(poolKey(ses));
      }
      if (pos.key !== 'root' && !w.hasPosition(poolKey(ses), pos.key)) {
        (m.states as PosRec[]).push(rec(pos));
        w.sentPosition(poolKey(ses), pos.key);
      }
      return m;
    },
    { request: poolKey(ses), label: name, hardAt, affinity: [pos.key] },
  );
}

function mergeDiagnostics(ses: Session, list: Diagnostic[]): void {
  for (const d of list) {
    if (ses.diagnostics.some((x) => x.service === d.service && x.code === d.code && x.message === d.message)) continue;
    ses.diag(d.service, d.code, d.severity, d.message, { limit: d.limit, max: d.max, value: d.value, detail: d.detail });
  }
}

function applyReply(ses: Session, off: Offload, r: Reply): void {
  for (const p of (r.newPositions as PosRec[] | undefined) ?? []) {
    ses.adopt({ key: p.key, state: p.state, driveOver: p.driveOver, depth: p.depth, parent: p.parent, via: p.via });
    if (typeof r.workerId === 'number') off.pool.knows(r.workerId, poolKey(ses), p.key);
  }
  for (const c of (r.candRefs as Array<{ id: string; position: string; input: unknown }> | undefined) ?? []) ses.candidateRefs.set(c.id, c);
  mergeDiagnostics(ses, (r.diagnostics as Diagnostic[] | undefined) ?? []);
  const st = obj(r.stats);
  ses.stats.leaves += Number(st.leaves) || 0;
  ses.stats.candidatesReturned += Number(st.candidatesReturned) || 0;
  ses.stats.planComputed += Number(st.planComputed) || 0;
  ses.stats.planHits += Number(st.planHits) || 0;
  if (typeof r.leafRate === 'number') ses.leafRate = r.leafRate;
  for (const e of (r.computedPlans as Array<{ hash: string; input: unknown; opts: PlanOpts; plan: PlanResult }> | undefined) ?? []) off.pool.plans.set(e.hash, e.input, e.opts, e.plan);
}

/** Keep the interface's view of the work current: best option so far, uncertainty, cut-short results. */
function noteResult(ses: Session, name: string, args: Args, res: unknown): void {
  const e = ses.engine;
  const o = obj(res);
  if (o.ok === false) {
    if (o.code === 'timeout') e.cutShort++;
    return;
  }
  if (name === 'explore' && o.ok === true) {
    const unres = Number(o.unresolvedMass) || 0;
    e.maxUnresolved = Math.max(e.maxUnresolved, unres);
    if (o.exact === false) e.inexact++;
    const from = obj(args[1]).from;
    const input = args[0];
    if (o.perspective === ses.team && (from === undefined || from === null || from === '' || from === 'root') && input && typeof input === 'object' && typeof o.value === 'number') {
      const v = o.value as number;
      if (!e.best || v > e.best.value) {
        const k = inputKey(input);
        const label = ses.labels.get(k) ?? (ses.rootBuiltIn.get(k)?.label as string | undefined) ?? ((input as { kind?: string }).kind === 'endTurn' ? 'End the Turn' : String((input as { kind?: string }).kind ?? 'action'));
        e.best = { label, value: v, pTurnover: Number(o.pTurnover) || 0, pTouchdown: Number(o.pTouchdown) || 0, unresolved: unres, via: 'explore' };
      }
    }
  } else if (name === 'candidates' && Array.isArray(o.candidates)) {
    for (const c of o.candidates as Array<Record<string, unknown>>) {
      if (c.input && typeof c.label === 'string') ses.labels.set(inputKey(c.input), c.label);
      if (typeof c.unresolved === 'number') {
        e.maxUnresolved = Math.max(e.maxUnresolved, c.unresolved);
        if (c.exact === false) e.inexact++;
      }
    }
    const tr = o.truncated;
    if (Array.isArray(tr) && tr.some((t) => t && (t as { reason?: string }).reason === 'timeout')) e.cutShort++;
  } else if (name === 'sequence' && o.ok === true && o.exact === false) e.inexact++;
  else if (o.truncated && !Array.isArray(o.truncated)) e.cutShort++;
}

function tickEngine(ses: Session, stage: string, done = 0, total = 0): void {
  ses.engine.stage = stage;
  ses.engine.done = done;
  ses.engine.total = total;
  ses.onEngine?.();
}

/** The fan-out: what the call needs, computed in parallel; returns plans to preload into the real pass. */
async function fanout(ses: Session, off: Offload, name: string, args: Args, pos: Position, callStart: number, callMs: number): Promise<Array<{ hash: string; input: unknown; opts: PlanOpts; plan: PlanResult }> | undefined> {
  const pool = off.pool;
  if (pool.size < 2) return undefined;
  tickEngine(ses, `${name}: listing the analyses needed`);
  const col = await submitService(ses, off, name, args, pos, { collect: true });
  if (TRACE) TRACE(`${name} collect pass: worker busy ${(col as Reply).busyMs} ms, ${((col as Reply).requests as unknown[] | undefined)?.length ?? '?'} requests`);
  const reqs = (col as Reply).requests as PlanRequest[] | undefined;
  if (!reqs) return undefined;
  const have = (q: PlanRequest) => pool.plans.has(q.hash, q.input, q.opts);
  const need = reqs.filter((q) => q.position !== null && !have(q));
  const preload = () => reqs.map((q) => ({ hash: q.hash, input: q.input, opts: q.opts, plan: pool.plans.get(q.hash, q.input, q.opts) as PlanResult | null })).filter((x) => x.plan) as Array<{ hash: string; input: unknown; opts: PlanOpts; plan: PlanResult }>;
  if (need.length < 2) {
    ses.engine.cacheHits += reqs.length - need.length;
    return preload();
  }
  ses.engine.cacheHits += reqs.length - need.length;
  let done = 0;
  tickEngine(ses, `${name}: ${need.length} analyses in parallel`, 0, need.length);
  const deadlineAt = callStart + callMs;
  const hardAt = ses.t0 + ses.moduleMs + 250;
  await Promise.all(
    need.map(async (q) => {
      const ids = q.position as string;
      const p = ses.positions.get(ids);
      const r = await pool.submit(
        (w: WorkerView) => {
          const m: Record<string, unknown> = { t: 'job', kind: 'plan', request: poolKey(ses), position: ids, input: q.input, opts: q.opts, states: [] as PosRec[] };
          if (!w.hasContext(poolKey(ses))) {
            m.ctx = ctxOf(ses);
            w.sentContext(poolKey(ses));
          }
          if (ids !== 'root' && p && !w.hasPosition(poolKey(ses), ids)) {
            (m.states as PosRec[]).push(rec(p));
            w.sentPosition(poolKey(ses), ids);
          }
          return m;
        },
        { request: poolKey(ses), label: `${name} plan`, deadlineAt, hardAt, affinity: [ids] },
      );
      const rr = r as Reply;
      if (rr.plan) {
        pool.plans.set(q.hash, q.input, q.opts, rr.plan as PlanResult);
        ses.stats.planParallel++;
        ses.stats.leaves += Number(rr.leaves) || 0;
        ses.noteLeaves((Number(rr.leaves) || 0) * 2, Number(rr.busyMs) || 0);
      }
      done++;
      tickEngine(ses, `${name}: ${need.length} analyses in parallel`, done, need.length);
    }),
  );
  return preload();
}

const standing = (p: { location: string; stance: string; pos?: unknown }) => p.location === 'pitch' && p.stance === 'standing' && !!p.pos;

/** `threats.reach` is independent per player: one job per player, merged in the original order. */
async function splitReach(ses: Session, off: Offload, args: Args, pos: Position, callStart: number): Promise<unknown | undefined> {
  const o = obj(args[0]);
  const want = Array.isArray(o.players) ? new Set((o.players as unknown[]).map(String)) : null;
  const team = o.team === 'A' || o.team === 'B' ? o.team : null;
  const st = pos.state;
  const ids = st.players.filter((p) => standing(p) && (!team || p.team === team) && (!want || want.has(p.id)) && (team || want || p.team === st.turn.active)).map((p) => p.id);
  if (ids.length < 2) return undefined;
  tickEngine(ses, `threats.reach: ${ids.length} players in parallel`, 0, ids.length);
  let done = 0;
  const parts = await Promise.all(
    ids.map(async (id) => {
      const r = await submitService(ses, off, 'threats.reach', [{ ...o, players: [id] }], pos, {});
      done++;
      tickEngine(ses, `threats.reach: ${ids.length} players in parallel`, done, ids.length);
      return r;
    }),
  );
  const merged: Record<string, unknown>[] = [];
  let first: Record<string, unknown> | null = null;
  for (const r of parts) {
    if (describe(r)) return undefined; // any trouble: let the whole call run on one worker
    const rr = r as Reply;
    applyReply(ses, off, rr);
    if (rr.thrown !== undefined) throw new KeyError(String(rr.thrown));
    const v = obj(rr.value);
    if (v.ok === false) return v;
    first ??= v;
    merged.push(...((v.players as Record<string, unknown>[] | undefined) ?? []));
    if (v.truncated && !first.truncated) first.truncated = v.truncated;
  }
  return { ...(first as Record<string, unknown>), players: merged, elapsedMs: Date.now() - callStart };
}

async function offloaded(ses: Session, off: Offload, name: string, args: Args): Promise<unknown> {
  // Resolve the position here: a stale key is an ordinary, cheap failure (answered by the same code, inline).
  let pos: Position;
  try {
    pos = ses.position(fromOf(name, args));
  } catch (e) {
    if (e instanceof KeyError) return inline(ses, name, args);
    throw e;
  }
  const callStart = Date.now();
  // Reuse a complete result of the same question in the same position.
  let cacheKey: string | null = null;
  if (CACHEABLE.has(name)) {
    cacheKey = ResultCache.key(analysisHash(pos.state), name, questionOf(name, args), { team: ses.team, legacy: ses.legacyErrors, l: [ses.limits.maxCallMs, ses.limits.defaultCallMs, ses.limits.maxPage, ses.limits.maxExactPerCall, ses.limits.defaultLeavesPerCall] });
    const hit = off.pool.results.get(cacheKey);
    if (hit !== undefined) {
      ses.stats.resultHits++;
      ses.engine.cacheHits++;
      const h = hit as Record<string, unknown>;
      if (h && typeof h === 'object' && !Array.isArray(h)) {
        if (h.position && typeof h.position === 'object') (h.position as Record<string, unknown>).key = pos.key;
        if ('elapsedMs' in h) h.elapsedMs = 0;
        h.cached = true;
      }
      return hit;
    }
  }
  const opt = name === 'plan' || name === 'reachable' ? {} : name === 'explore' ? obj(args[1]) : obj(args[0]);
  const callMs = clamp(opt.maxMs, name === 'sequence' ? ses.limits.defaultCallMs * 2 : ses.limits.defaultCallMs, 50, name === 'sequence' ? ses.limits.maxCallMs * 2 : ses.limits.maxCallMs);
  let plans: Awaited<ReturnType<typeof fanout>>;
  let realArgs = args;
  if (FANOUT.has(name)) {
    plans = await fanout(ses, off, name, args, pos, callStart, Math.min(callMs, ses.serviceTimeLeft()));
    if (plans && plans.length) {
      // the real pass may only use what is left of the call's own time limit
      const left = Math.max(50, callMs - (Date.now() - callStart));
      realArgs = [{ ...obj(args[0]), maxMs: left }, ...args.slice(1)];
    }
  }
  if (name === 'threats.reach' && off.pool.size >= 2) {
    const v = await splitReach(ses, off, args, pos, callStart);
    if (v !== undefined) {
      if (cacheKey && isComplete(name, v)) off.pool.results.set(cacheKey, v);
      return v;
    }
  }
  tickEngine(ses, `${name}: running`);
  const r = await submitService(ses, off, name, realArgs, pos, { plans });
  if (TRACE) TRACE(`${name} real pass: worker busy ${(r as Reply).busyMs} ms, round trip ${Date.now() - callStart} ms, preloaded ${plans?.length ?? 0} plans`);
  const why = describe(r);
  if (why) {
    if ((r as { error?: string }).error || (r as { t?: string }).t === 'fail') {
      ses.diag(name, 'internal', 'warn', `An engine worker could not run ${name} (${why}); it was run on the calling thread instead.`);
      return inline(ses, name, args);
    }
    if ((r as { timedOut?: boolean }).timedOut) {
      ses.diag(name, 'timeout', 'warn', `${name} did not finish before the request's time limit.`, { limit: 'moduleMs', max: ses.moduleMs });
      return fail('timeout', `${name} did not finish before the request's time limit.`, { timedOut: true });
    }
    return fail('internal', `${name} was ${why}.`);
  }
  const reply = r as Reply;
  applyReply(ses, off, reply);
  if (reply.thrown !== undefined) throw new KeyError(String(reply.thrown));
  if (cacheKey && isComplete(name, reply.value)) off.pool.results.set(cacheKey, reply.value);
  return reply.value;
}

/** The synchronous path (also the fallback): same code, calling thread. */
function inline(ses: Session, name: string, args: Args): unknown {
  const o = execService(ses, name, args);
  if (o.thrown !== undefined) throw new KeyError(o.thrown);
  return o.value;
}

/**
 * The async `callService`. With no pool, or for a service that is cheap, it is the synchronous call. Never throws for a
 * module's mistake (legacy V5.5 services reject with the error message, as before).
 */
export async function callServiceAsync(ses: Session, name: string, args: Args, off?: Offload): Promise<unknown> {
  if (!off || FREE.has(name) || (!OFFLOAD.has(name) && name !== 'batch')) return callService(ses, name, args);
  ses.engine.calls++;
  if (name === 'batch') return batchAsync(ses, off, args);
  const blocked = ses.admit(name);
  if (blocked) return blocked;
  const t0 = Date.now();
  ses.callBegin();
  try {
    const res = await offloaded(ses, off, name, args);
    noteResult(ses, name, args, res);
    return res;
  } finally {
    ses.callEnd();
    ses.record(name, Date.now() - t0);
    ses.onEngine?.();
  }
}

async function batchAsync(ses: Session, off: Offload, args: Args): Promise<unknown> {
  const blocked = ses.admit('batch');
  if (blocked) return blocked;
  const t0 = Date.now();
  ses.callBegin();
  try {
    const items = batchItems(ses, args[0]);
    if (!Array.isArray(items)) return items;
    tickEngine(ses, `batch: ${items.length} independent calls`, 0, items.length);
    let done = 0;
    const results = await Promise.all(
      items.map(async (it) => {
        let r: unknown;
        try {
          r = await callServiceAsync(ses, it.service, it.args, off);
        } catch (e) {
          r = fail('internal', (e as Error).message);
        }
        done++;
        tickEngine(ses, `batch: ${items.length} independent calls`, done, items.length);
        return r;
      }),
    );
    return { ok: true, parallel: off.pool.size > 1, count: results.length, results };
  } finally {
    ses.callEnd();
    ses.record('batch', Date.now() - t0);
  }
}

export { PlanCache, ResultCache };
export type { ActionInput };
