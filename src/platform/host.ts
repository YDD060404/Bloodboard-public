/**
 * Host-independent strategy runner (V5.6). `platformDecide` does what the app's `strategyDecide` did in V5.5.1, on top of
 * the platform core, with a pluggable worker transport (Web Worker in the app, worker_threads headless), structured
 * diagnostics and the extended response forms. It never throws; a failed, late, stale or invalid answer falls back to the
 * built-in coach and says why in `meta`.
 */
import type { ActionInput, GameState, TeamId } from '../engine/index';
import { E } from '../ai/engine';
import { fallbackCoach, nextMove, planNext, type AIMove, type CoachEntry } from '../ai/index';
import { clamp, DEFAULT_LIMITS, type Diagnostic, type Limits } from './limits';
import { HARNESS } from './harness';
import { observe } from './observe';
import { Session, type ProgressUpdate } from './session';
import { callService } from './services';
import { callServiceAsync, poolKey, type Offload } from './dispatch';
import type { EnginePool, PoolSnapshot } from './pool';
import type { BestSoFar } from './session';
import { inputKey } from './candidates';
import { resolveAction, resolveDecision, type Ranked } from './respond';
import { PlanCache, forWorker } from './analysis';
import type { PlanResult } from '../engine/planner';
import { observeV2 } from './v2obs';
import { buildKickRequest, buildSetupRequest, checkKickAnswer, checkSetupAnswer, hostExtensions, strategicPublic, type ContextReport, type ContextTicket } from './hostext';

/** The minimal worker surface the host needs. */
export interface WorkerLike {
  postMessage(m: unknown): void;
  terminate(): void;
  onmessage: ((data: Record<string, unknown>) => void) | null;
  onerror: ((message: string) => void) | null;
}
export type Spawn = (source: string) => WorkerLike;

export interface ModuleMeta {
  id: string;
  name: string;
  apiVersion: number;
  apiMinor?: number;
  requires?: string[];
  version?: string;
  description?: string;
  timeLimitMs?: number;
  /** V5.8: which hooks the module implements (chooseSetup is the optional set-up hook). */
  hooks?: { action: boolean; decision: boolean; setup: boolean; roster?: boolean; build?: boolean; fielded?: boolean; kick?: boolean };
  /** V6 (API v2): the identity of the context the coach stores, the capabilities it declares / requires. */
  contextSchema?: string;
  declaredCapabilities?: Record<string, boolean>;
  requiresCapabilities?: string[];
}

export interface DecideMeta {
  coach: string;
  requestId: number;
  kind: 'action' | 'decision' | 'setup' | 'kick' | 'builtin';
  /** How the module's answer was taken, or why the built-in coach decided. */
  via: string;
  fellBack: boolean;
  reason: string | null;
  why: string | null;
  ranking?: Ranked[];
  /** The module's own explanation object, when it supplied one. */
  trace?: unknown;
  /** The coach's progress notes during the decision. */
  progress?: ProgressUpdate[];
  diagnostics: Diagnostic[];
  usage: { elapsedMs: number; serviceCalls: number; serviceMs: number; wallServiceMs?: number; leaves: number; positions: number; calls: Record<string, { n: number; ms: number }>; plans?: { hits: number; computed: number; parallel: number; resultHits: number }; engine?: { maxUnresolved: number; inexact: number; cutShort: number }; pooled?: boolean };
  /** The offered legacy candidates (for traces). */
  offered?: number;
  /** V5.8: set-up hook outcome (only for set-up requests): whether the module has the hook, answered, and whether its formation was accepted. */
  setup?: { hook: boolean; answered: boolean; accepted: boolean; fallback: boolean; reason: string | null };
  /** V5.8: coach-context outcome (only where the host offers a store). */
  context?: ContextReport;
  /** V5.8: the time allowance of this request (the coach's declared limit, clamped) and the host capabilities offered. */
  allowanceMs?: number;
  hostExtensions?: { setup: boolean; coachContext: boolean };
}

export async function moduleMeta(spawn: Spawn, code: string, timeoutMs = 10000): Promise<{ meta?: ModuleMeta; error?: string }> {
  return new Promise((resolve) => {
    let w: WorkerLike;
    try {
      w = spawn(`${HARNESS}\n${code}`);
    } catch (e) {
      resolve({ error: `Could not start a worker: ${(e as Error).message}` });
      return;
    }
    const timer = setTimeout(() => { w.terminate(); resolve({ error: `The module did not answer (${Math.round(timeoutMs / 1000)} s).` }); }, timeoutMs);
    w.onerror = (m) => { clearTimeout(timer); w.terminate(); resolve({ error: `Error while loading the module: ${m}` }); };
    w.onmessage = (m) => {
      clearTimeout(timer);
      w.terminate();
      resolve(m.ok && m.meta ? { meta: m.meta as ModuleMeta } : { error: 'The module did not call bloodboard.register({...}).' });
    };
    w.postMessage({ type: 'hello' });
  });
}

/** Run the module once for a request; every RPC is answered by `callService` on the request's session. */
export function runModule(spawn: Spawn, code: string, msg: Record<string, unknown>, ses: Session, onTick?: () => void, off?: Offload, stale?: () => boolean): Promise<{ result?: unknown; error?: string; timedOut?: boolean; cancelled?: boolean }> {
  const limit = ses.moduleMs;
  return new Promise((resolve) => {
    let w: WorkerLike;
    try {
      w = spawn(`${HARNESS}\n${code}`);
    } catch (e) {
      resolve({ error: `Could not start the strategy worker: ${(e as Error).message}` });
      return;
    }
    const requestId = msg.requestId;
    let over = false;
    // A decision that is no longer wanted (the position moved on, the match was closed) is abandoned at once: the module is stopped and its queued engine work dropped.
    const ticker = onTick || stale ? setInterval(() => {
      if (stale && !over && stale()) { done(); clearTimeout(timer); w.terminate(); resolve({ error: 'cancelled', cancelled: true }); return; }
      try { onTick?.(); } catch { /* display only */ }
    }, off ? 250 : 1000) : null;
    const done = () => { over = true; if (ticker) clearInterval(ticker); off?.pool.cancelRequest(poolKey(ses)); };
    const timer = setTimeout(() => { done(); w.terminate(); resolve({ error: `No answer within ${Math.round(limit / 100) / 10} s (time limit).`, timedOut: true }); }, limit);
    w.onerror = (m) => { done(); clearTimeout(timer); w.terminate(); resolve({ error: `Error in the module: ${m}` }); };
    w.onmessage = (m) => {
      if (m.type === 'rpc') {
        if (m.requestId !== requestId) return;
        if (off) {
          // Pooled: the call runs in the engine workers; calls issued together (Promise.all / batch) run concurrently.
          void (async () => {
            let ok = true;
            let value: unknown;
            try {
              value = await callServiceAsync(ses, String(m.method), (m.args as unknown[]) ?? [], off);
            } catch (e) {
              ok = false;
              value = (e as Error).message;
            }
            if (!over) w.postMessage({ type: 'rpcResult', id: m.id, ok, value });
          })();
          return;
        }
        let value: unknown;
        let ok = true;
        try {
          value = callService(ses, String(m.method), (m.args as unknown[]) ?? []);
        } catch (e) {
          ok = false;
          value = (e as Error).message;
        }
        w.postMessage({ type: 'rpcResult', id: m.id, ok, value });
        return;
      }
      if (m.type === 'result' && m.requestId === requestId) {
        done();
        clearTimeout(timer);
        w.terminate();
        resolve(m.error ? { error: String(m.error) } : { result: m.result });
      }
    };
    w.postMessage(msg);
  });
}

let seq = 1;
/** Without a pool the synchronous services still reuse exact plans across requests (same keys as the pool's cache). */
const SHARED_PLANS = new PlanCache<PlanResult>(3000, 48 * 1024 * 1024);

/** What the interface may show while a coach is still calculating. */
export interface ProgressEvent {
  kind: 'tick' | 'update';
  coach: string;
  team: TeamId;
  elapsedMs: number;
  limitMs: number;
  usage: { serviceCalls: number; positions: number; leaves: number };
  /** The coach's accepted progress notes so far (newest last). */
  updates: ProgressUpdate[];
  /** V5.7: real computation progress of the engine work (no estimate: counters and results). */
  engine: {
    stage: string;
    done: number;
    total: number;
    calls: number;
    best: BestSoFar | null;
    maxUnresolved: number;
    inexact: number;
    cutShort: number;
    cacheHits: number;
    /** Worker activity at this moment (null: no pool, services run on the calling thread). */
    workers: PoolSnapshot | null;
    wallServiceMs: number;
  };
}

export interface DecideOptions {
  /** V5.8: host-managed coach context for this request (from `CoachContextStore.ticket`). Omit where no store backs it. */
  context?: ContextTicket;
  /** V5.8: advice-only request (the human asked an AI for a suggestion): no set-up, no context, no capability flags. */
  advisory?: boolean;
  /** Called about once a second while the coach calculates, and whenever it publishes a progress note. */
  onProgress?: (e: ProgressEvent) => void;
  spawn: Spawn;
  /** Receives each problem in plain language (the app shows it as a notice). */
  note?: (why: string) => void;
  /** True once the position moved on: the answer is then dropped (returns `move: null`). */
  stale?: () => boolean;
  limits?: Limits;
  /** The engine pool (V5.7): heavy services run in its workers, off the calling thread, with shared caches. Without it, services run on the calling thread as in V5.6.1. */
  pool?: EnginePool;
}

/** Behaviour level of a module: gen-2 modules always get the V5.6 behaviours; gen-1 modules keep their declared minor. */
export function effectiveMinor(entry: { apiMinor?: unknown; apiGeneration?: unknown }): number {
  const declared = Number(entry.apiMinor ?? 0) || 0;
  return Number(entry.apiGeneration) === 2 ? Math.max(declared, 2) : declared;
}

export async function platformDecide(s: GameState, team: TeamId, entry: CoachEntry, o: DecideOptions): Promise<{ move: AIMove | null; meta: DecideMeta }> {
  const code = entry.code as string;
  const limits = o.limits ?? DEFAULT_LIMITS;
  const requestId = seq++;
  const t0 = Date.now();
  // Generation-aware minor: API generation 2 includes everything minor 2 of generation 1 introduced (object answers, typed
  // service errors), whatever its own `apiMinor` says (a generation-2 module declares minor 0 of ITS generation).
  const apiMinor = effectiveMinor(entry);
  const name = entry.name;
  // One stale test for everything below: the caller's own (position moved on, match closed, batch stopped) and the context
  // ticket's (superseded by a newer request, or the match instance was replaced / loaded / undone).
  const isStale = () => !!o.stale?.() || (!!o.context && !o.context.current());
  const observation = () => {
    const gen2 = (entry as { apiGeneration?: number }).apiGeneration === 2;
    const out: Record<string, unknown> = gen2 ? { ...observeV2(s, team, requestId, { sinceLog: o.context?.sinceLog }) } : { ...observe(s, team, requestId) };
    if (!o.advisory) {
      out.hostExtensions = hostExtensions({ coachContext: !!o.context });
      if (o.context && o.context.value !== undefined) out.coachContext = JSON.parse(JSON.stringify(o.context.value));
      if (gen2 && o.context) out.contextInfo = { present: o.context.value !== undefined, bytes: o.context.value === undefined ? 0 : new TextEncoder().encode(JSON.stringify(o.context.value)).length, maxBytes: 8192, schema: (entry as { contextSchema?: string }).contextSchema ?? null, resetReason: o.context.resetReason ?? null };
    }
    const sp = strategicPublic(s);
    if (sp) out.strategicPublic = sp;
    return out;
  };
  /** Commit only after a legal answer was accepted for this still-current request; an invalid/oversized/absent value never rejects the answer. */
  const commitContext = (result: unknown) => {
    if (!o.context || o.advisory) return;
    const has = !!result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'coachContext');
    const raw = has ? (result as { coachContext: unknown }).coachContext : undefined;
    meta.context = o.context.commit(isStale() ? undefined : raw);
    if (!isStale()) o.context.markSeen(s.log.length);
    if (isStale() && has) meta.context = { ...meta.context, returned: true, ignored: 'the request was superseded, cancelled or the match was replaced' };
  };
  const fb = fallbackCoach(s.variant === 'sevens' ? 'sevens' : 'standard');
  const builtIn = () => nextMove(s, team, 'balanced', {}, { profile: fb?.profile });
  const ses = new Session(s, team, requestId, Number(entry.timeLimitMs) || limits.defaultModuleMs, limits);
  ses.legacyErrors = apiMinor < 2;
  const meta: DecideMeta = { coach: entry.id, requestId, kind: s.pending ? 'decision' : s.phase === 'driveSetup' ? 'setup' : s.phase === 'kickoff' ? 'kick' : 'action', via: 'builtin', fellBack: false, reason: null, why: null, allowanceMs: ses.moduleMs, hostExtensions: o.advisory ? undefined : { setup: true, coachContext: !!o.context }, diagnostics: ses.diagnostics, usage: { elapsedMs: 0, serviceCalls: 0, serviceMs: 0, leaves: 0, positions: 0, calls: {} } };
  const emit = (kind: ProgressEvent['kind']) => o.onProgress?.({ kind, coach: name, team, elapsedMs: Date.now() - t0, limitMs: ses.moduleMs, usage: { serviceCalls: ses.stats.totalCalls, positions: ses.positions.size - 1, leaves: ses.stats.leaves }, updates: ses.progress, engine: { ...ses.engine, workers: o.pool ? o.pool.snapshot() : null, wallServiceMs: Math.round(ses.wallBusyMs()) } });
  if (o.onProgress) ses.onProgress = () => emit('update');
  if (o.onProgress && o.pool) {
    // engine progress is shown at most ~8 times a second
    let last = 0;
    ses.onEngine = () => { const n = Date.now(); if (n - last >= 120) { last = n; emit('tick'); } };
  }
  const off: Offload | undefined = o.pool ? { pool: o.pool } : undefined;
  if (off) ses.planStore = off.pool.plans;
  else ses.planStore = SHARED_PLANS;
  const tick = o.onProgress ? () => emit('tick') : undefined;
  const finish = (move: AIMove | null): { move: AIMove | null; meta: DecideMeta } => {
    meta.progress = ses.progress.slice();
    if (o.context && !o.advisory && !meta.context) meta.context = { supplied: o.context.value === undefined ? null : new TextEncoder().encode(JSON.stringify(o.context.value)).length, returned: false, committed: false, ignored: 'no legal module answer was accepted for this request' };
    meta.usage = { elapsedMs: Date.now() - t0, serviceCalls: ses.stats.totalCalls, serviceMs: Math.round(ses.stats.totalServiceMs), wallServiceMs: Math.round(ses.wallBusyMs()), leaves: ses.stats.leaves, positions: ses.positions.size - 1, calls: ses.stats.calls, plans: { hits: ses.stats.planHits, computed: ses.stats.planComputed, parallel: ses.stats.planParallel, resultHits: ses.stats.resultHits }, engine: { maxUnresolved: ses.engine.maxUnresolved, inexact: ses.engine.inexact, cutShort: ses.engine.cutShort }, pooled: !!off };
    off?.pool.release(poolKey(ses));
    return { move, meta };
  };
  const problem = (why: string, code: Diagnostic['code'] = 'module-error') => {
    meta.fellBack = true;
    meta.reason = why;
    ses.diag('host', code, 'error', `${name}: ${why}`);
    o.note?.(why);
  };
  try {
    E.usePitch(s);
    if (s.pending) {
      const req = s.pending.request;
      // One legal answer: nothing to analyse or ask a coach (the answer is the same whoever coaches), so return at once.
      if (req.options.length === 1) {
        meta.via = 'forced';
        meta.why = 'Only one option is available.';
        return finish({ type: 'decision', requestId: req.id, optionId: req.options[0].id, why: 'Only one option is available.' });
      }
      ses.restartClock();
      const r = await runModule(o.spawn, code, { type: 'decision', requestId, observation: observation(), request: JSON.parse(JSON.stringify(req)) }, ses, tick, off, isStale);
      if (isStale()) return finish(null);
      if (r.error) problem(r.error, r.timedOut ? 'timeout' : 'module-error');
      else {
        const d = resolveDecision(req.options, r.result, apiMinor);
        if (d.ok) {
          meta.via = `decision:${d.via}`;
          meta.why = d.why;
          meta.ranking = d.ranking;
          commitContext(r.result);
          return finish({ type: 'decision', requestId: req.id, optionId: d.optionId, why: d.why ?? `${name} chose this.` });
        }
        if (r.result !== null && r.result !== undefined) problem(d.message);
        else meta.reason = 'the module gave no decision answer';
      }
      return finish(builtIn());
    }
    if (s.phase === 'driveSetup') {
      // V5.8 optional set-up hook. The hook only rearranges the players the host fixed; anything else keeps the built-in formation.
      const gen2 = (entry as { apiGeneration?: number }).apiGeneration === 2;
      const setupRequest = buildSetupRequest(s, team, { free: gen2 });
      meta.setup = { hook: true, answered: false, accepted: false, fallback: false, reason: null };
      const keepDefault = (why: string | null, code?: Diagnostic['code']) => {
        meta.setup!.fallback = true;
        meta.setup!.reason = why;
        if (code && why) problem(why, code);
        return finish(builtIn());
      };
      if (o.advisory) return keepDefault(null);
      // API v2: a bounded correction loop — an illegal formation comes back with the engine's reasons and the coach may fix it (never silently replaced before the attempts are used).
      const attempts = gen2 ? 3 : 1;
      let errors: string[] = [];
      for (let attempt = 1; attempt <= attempts; attempt++) {
        ses.restartClock();
        const req = errors.length ? { ...setupRequest, attempt, previousErrors: errors.slice() } : setupRequest;
        const r = await runModule(o.spawn, code, { type: 'setup', requestId, observation: observation(), request: req }, ses, tick, off, isStale);
        if (isStale()) return finish(null);
        if (r.error) return keepDefault(r.error, r.timedOut ? 'timeout' : 'module-error');
        if (r.result === null || r.result === undefined) { meta.reason = 'the module has no set-up hook or gave no set-up answer'; return keepDefault(meta.reason); }
        meta.setup.answered = true;
        const chk = checkSetupAnswer(s, team, setupRequest, r.result);
        if (!chk.ok) {
          errors = [chk.reason];
          if (attempt < attempts) continue;
          return keepDefault(chk.reason, 'illegal');
        }
        meta.setup.accepted = true;
        commitContext(r.result);
        meta.via = attempt > 1 ? `setup (corrected, attempt ${attempt})` : 'setup';
        meta.why = chk.why;
        return finish({ type: 'step', input: chk.input, why: chk.why });
      }
      return keepDefault('no legal set-up', 'illegal');
    }
    if (s.phase === 'kickoff' && s.match && !s.match.pendingPhase && s.match.kicking === team && (entry as { apiGeneration?: number }).apiGeneration === 2 && (entry as { capabilities?: { chooseKick?: boolean } }).capabilities?.chooseKick && !o.advisory) {
      // API v2 kick placement hook (kicker + target square). Validated by the engine; the built-in placement is the fallback.
      const fallback = builtIn();
      const kreq = buildKickRequest(s, team);
      if (fallback && fallback.type === 'step' && fallback.input.kind === 'kickoff') kreq.defaultAnswer = { kicker: fallback.input.kicker, target: fallback.input.target, useKick: !!fallback.input.useKick };
      let errors: string[] = [];
      for (let attempt = 1; attempt <= 3; attempt++) {
        ses.restartClock();
        const r = await runModule(o.spawn, code, { type: 'kick', requestId, observation: observation(), request: errors.length ? { ...kreq, attempt, previousErrors: errors.slice() } : kreq }, ses, tick, off, isStale);
        if (isStale()) return finish(null);
        if (r.error) { problem(r.error, r.timedOut ? 'timeout' : 'module-error'); return finish(fallback); }
        if (r.result === null || r.result === undefined) { meta.reason = 'the module gave no kick answer'; return finish(fallback); }
        const chk = checkKickAnswer(s, team, r.result);
        if (chk.ok) {
          commitContext(r.result);
          meta.via = attempt > 1 ? `kick (corrected, attempt ${attempt})` : 'kick';
          meta.why = chk.why;
          return finish({ type: 'step', input: chk.input, why: chk.why });
        }
        errors = [chk.reason];
        if (attempt === 3) problem(chk.reason, 'illegal');
      }
      return finish(fallback);
    }
    if (s.phase !== 'play') return finish(builtIn());
    // The built-in coach's own analysis (it lists the options the module will see). With an engine pool it runs in a worker, so the
    // interface thread stays free; the answer is identical (the same code on a state without the dice generator).
    let base: AIMove | null | undefined;
    if (off) {
      ses.engine.stage = 'Built-in coach: listing and rating the options';
      ses.onEngine?.();
      const r = (await off.pool.submit(() => ({ t: 'job', kind: 'builtin', state: forWorker(s), team, style: 'balanced' }), { request: poolKey(ses), label: 'built-in options', hardAt: Date.now() + 120_000 })) as { move?: AIMove | null; t?: string; cancelled?: boolean; error?: string };
      if (isStale() || r.cancelled) return finish(null);
      if (!r.error && r.t !== 'fail' && 'move' in r) base = r.move ?? null;
    }
    if (base === undefined) {
      const gen = planNext(s, team, 'balanced');
      let d: IteratorResult<string, AIMove | null>;
      do d = gen.next();
      while (!d.done);
      base = d.value;
    }
    if (!base || base.type !== 'action') return finish(base);
    const cands = base.decision.candidates.map((k, i) => ({ id: i, label: k.label, kind: k.kind, playerId: k.playerId, input: k.input, pSuccess: k.pSuccess, pTurnover: k.pTurnover, pTouchdown: k.pTouchdown, builtInValue: k.gain }));
    for (const c of cands) ses.rootBuiltIn.set(inputKey(c.input), c);
    meta.offered = cands.length;
    // What the built-in coach itself would do here (V5.6.1, additive): a module may defer to it, compare with it or learn from it.
    const chosenIdx = base.decision.chosen ? base.decision.candidates.indexOf(base.decision.chosen) : -1;
    const builtInChoice = chosenIdx >= 0 ? { candidateId: chosenIdx, endTurn: false } : { candidateId: null, endTurn: true };
    ses.restartClock();
    const r = await runModule(o.spawn, code, { type: 'action', requestId, observation: { ...observation(), timeLimitMs: ses.moduleMs, builtInChoice }, candidates: cands }, ses, tick, off, isStale);
    if (isStale()) return finish(null);
    if (r.error) {
      problem(r.error, r.timedOut ? 'timeout' : 'module-error');
      return finish(base);
    }
    const res = resolveAction(ses, r.result, cands.length, cands.map((c) => c.input as ActionInput));
    if (!res.ok) {
      meta.ranking = res.ranking;
      if (r.result !== null && r.result !== undefined) problem(res.message, 'illegal');
      else meta.reason = 'the module gave no answer';
      return finish(base);
    }
    commitContext(r.result);
    const c = res.choice;
    const input = c.input as ActionInput;
    const reason = c.why ?? `${name} chose ${c.legacyIndex !== null ? base.decision.candidates[c.legacyIndex].label : c.via}.`;
    meta.via = c.via;
    meta.why = c.why;
    meta.ranking = c.ranking;
    meta.trace = c.trace;
    const chosen = c.legacyIndex !== null ? base.decision.candidates[c.legacyIndex] : (base.decision.candidates.find((k) => inputKey(k.input) === inputKey(input)) ?? null);
    return finish({ type: 'action', input, why: reason, decision: { ...base.decision, input, chosen, reason } });
  } catch (e) {
    problem(`failed (${(e as Error).message}).`, 'internal');
    try {
      return finish(builtIn());
    } catch {
      return finish(null);
    }
  }
}

export { clamp };
