/**
 * One strategy request's state in the host: the position the module is deciding in (`root`), the positions its
 * explore calls reached (request-scoped keys), counters against the limits, and the diagnostics.
 *
 * Nothing here is ever sent to the module except results of services: the module never holds a game state, the dice
 * generator, its seed or counter.
 */
import type { GameState, TeamId } from '../engine/index';
import { E } from '../ai/engine';
import { clamp, DEFAULT_LIMITS, type Diagnostic, type DiagCode, type Limits } from './limits';
import type { Horizon, Weights } from '../ai/evaluate';
import type { ActionInput, PlayerActionInput } from '../engine/index';
import type { PlanResult } from '../engine/planner';
import { analysisHash, type PlanOpts } from './analysis';

/** Where exact plans are kept: the shared cache in the host, a per-job store (pre-filled by the pool) in an engine worker. */
export interface PlanStore {
  get(posHash: string, input: unknown, o: PlanOpts): PlanResult | null;
  set(posHash: string, input: unknown, o: PlanOpts, value: PlanResult): void;
}

/** The best legal option the engine work has found so far in the request's position (host-derived from real results). */
export interface BestSoFar {
  label: string;
  value: number;
  pTurnover: number;
  pTouchdown: number;
  /** Probability mass not expanded in the analysis behind it (0 = exact). */
  unresolved: number;
  via: string;
}

/** Live facts about the engine work of a request (what the interface may show while a coach calculates). */
export interface EngineProgress {
  /** What is being computed right now, in plain words. */
  stage: string;
  /** Work units completed / known so far in the current stage (plans, calls). */
  done: number;
  total: number;
  calls: number;
  best: BestSoFar | null;
  /** The largest unexpanded probability mass among the results so far, and how many results were not exact / cut short. */
  maxUnresolved: number;
  inexact: number;
  cutShort: number;
  cacheHits: number;
}

/** One plan a service would like to have (collected during a dry pass, computed in parallel, then served from the store). */
export interface PlanRequest {
  hash: string;
  /** Key of the position whose state is analysed (null: the state is not one of the session's positions, so it cannot be offloaded). */
  position: string | null;
  input: unknown;
  opts: PlanOpts;
}

const ZERO = new Proxy({}, { get: (_t, k) => (k === 'then' || typeof k === 'symbol' ? undefined : 0) }) as never;
/** The placeholder a dry pass hands to the service in place of a real plan (never returned to a module). */
export function dummyPlan(input: unknown): PlanResult {
  return { ok: true, errors: [], input: input as ActionInput, steps: [], withTeamRerolls: ZERO, withoutTeamRerolls: ZERO, assumptions: [], traceEvents: [], teamRerollsAvailable: 0 } as PlanResult;
}

export interface Position {
  key: string;
  state: GameState;
  /** A Touchdown ended the Drive in this position (only the score and the players' condition still count). */
  driveOver: boolean;
  /** 0 = the request's position. */
  depth: number;
  parent: string | null;
  /** Short description of how it was reached (for traces). */
  via: string | null;
}

export interface CandidateRef {
  id: string;
  position: string;
  input: unknown;
}

export interface ServiceFailure {
  ok: false;
  code: DiagCode;
  message: string;
  errors: string[];
  [k: string]: unknown;
}

export const fail = (code: DiagCode, message: string, extra: Record<string, unknown> = {}): ServiceFailure => ({ ok: false, code, message, errors: [message], ...extra });

/** A coach's public progress note for the person watching (sanitised by the host; never interpreted as an instruction). */
export interface ProgressUpdate {
  seq: number;
  tMs: number;
  stage: string;
  headline: string;
  evaluating?: string[];
  ruledOut?: string[];
  best?: { label: string; detail?: string; pTurnover?: number; pTouchdown?: number; value?: number };
  fraction?: number;
}

export class KeyError extends Error {
  code: DiagCode = 'stale-key';
}

export interface EvalCfg {
  w: Weights;
  hz: Horizon;
  objective: string;
}

export class Session {
  readonly root: GameState;
  readonly team: TeamId;
  readonly requestId: number;
  readonly limits: Limits;
  readonly moduleMs: number;
  /** Start of the module's time allowance. Restarted by the host right before the module runs (V5.8): the built-in options analysis before it must not eat the module's declared time. */
  t0 = Date.now();
  restartClock(): void { this.t0 = Date.now(); }
  readonly positions = new Map<string, Position>();
  readonly diagnostics: Diagnostic[] = [];
  readonly progress: ProgressUpdate[] = [];
  progressDropped = 0;
  /** Modules written before V5.6 (apiMinor < 2) get V5.5.1's behaviour for a stale key: the legacy service call throws. */
  legacyErrors = false;
  onProgress: ((u: ProgressUpdate) => void) | null = null;
  private lastProgressAt = -1e9;
  readonly candidateRefs = new Map<string, CandidateRef>();
  /** Built-in candidates of the root position by input (set by the host before the module runs). */
  rootBuiltIn = new Map<string, Record<string, unknown>>();
  readonly evalCache = new Map<TeamId, EvalCfg>();
  readonly stats = { calls: {} as Record<string, { n: number; ms: number }>, leaves: 0, positionsKept: 0, candidatesReturned: 0, totalServiceMs: 0, totalCalls: 0, planHits: 0, planComputed: 0, planParallel: 0, resultHits: 0 };
  /** Wall-clock time during which at least one service call was running (concurrent calls are counted once). */
  wallServiceMs = 0;
  private activeCalls = 0;
  private busySince = 0;
  /** Live engine facts for the interface (see `EngineProgress`); `onEngine` is called when they change. */
  readonly engine: EngineProgress = { stage: '', done: 0, total: 0, calls: 0, best: null, maxUnresolved: 0, inexact: 0, cutShort: 0, cacheHits: 0 };
  onEngine: (() => void) | null = null;
  /** Labels of inputs seen in candidate records (input JSON → label), for naming the best option found. */
  readonly labels = new Map<string, string>();
  /** Where exact plans are looked up / stored (shared cache in the host). */
  planStore: PlanStore | null = null;
  /** 'collect': `plan()` records what it is asked for and returns a placeholder (a dry pass); 'run' (default): real results. */
  planMode: 'run' | 'collect' = 'run';
  planRequests: PlanRequest[] = [];
  /** Plans computed inline (cache and pool misses), for the pool to hand back to the shared cache. */
  computedPlans: Array<{ hash: string; input: unknown; opts: PlanOpts; plan: PlanResult }> = [];
  private ownerOf = new WeakMap<object, Position>();
  /** An engine worker may only issue keys below this (its reserved block); null = unlimited. */
  protected posKeyLimit: number | null = null;
  protected nextPos = 1;
  protected nextCand = 1;
  private seq = 1;
  private bytesPer = 0;
  private overflowNoted = new Set<string>();

  constructor(root: GameState, team: TeamId, requestId: number, moduleMs: number, limits: Limits = DEFAULT_LIMITS) {
    this.root = root;
    this.team = team;
    this.requestId = requestId;
    this.limits = limits;
    this.moduleMs = clamp(moduleMs, limits.defaultModuleMs, limits.minModuleMs, limits.maxModuleMs);
    const rootPos: Position = { key: 'root', state: root, driveOver: false, depth: 0, parent: null, via: null };
    this.positions.set('root', rootPos);
    this.ownerOf.set(root, rootPos);
    // An estimate only: the size of a cloned state, measured once on the root position.
    this.bytesPer = Math.max(20_000, JSON.stringify(root.players).length * 3 + 4000);
  }

  elapsed(): number {
    return Date.now() - this.t0;
  }

  /** Wall-clock milliseconds the services have been busy so far (overlapping calls counted once). */
  wallBusyMs(): number {
    return this.wallServiceMs + (this.activeCalls > 0 ? Date.now() - this.busySince : 0);
  }

  /** A service call starts / ends (any number may overlap). */
  callBegin(): void {
    if (this.activeCalls++ === 0) this.busySince = Date.now();
  }
  callEnd(): void {
    if (--this.activeCalls === 0) this.wallServiceMs += Date.now() - this.busySince;
  }

  /** Milliseconds the services may still use in this request (wall clock: overlapping parallel calls count once). */
  serviceTimeLeft(): number {
    return Math.max(0, this.moduleMs * this.limits.serviceTimeShare - this.wallBusyMs());
  }

  /** Positions kept so far (the request's own count; an engine worker reports the host's count plus its new ones). */
  protected keptCount(): number {
    return this.positions.size - 1;
  }

  /** Reserve a block of position keys and candidate ids for a call that runs elsewhere (so concurrent calls never collide). */
  reserveIds(nPos: number, nCand: number): { pos: number; cand: number } {
    const r = { pos: this.nextPos, cand: this.nextCand };
    this.nextPos += nPos;
    this.nextCand += nCand;
    return r;
  }

  /** The state of a position by key, for whoever runs a call elsewhere. Same rules as `position()`. */
  positionOfState(st: object): Position | undefined {
    return this.ownerOf.get(st);
  }

  /**
   * The exact plan of `input` in `st` (the engine planner, no dice rolled). Served from the shared cache when an
   * equally precise result exists; in a dry pass (`planMode: 'collect'`) it only records the request.
   */
  plan(st: GameState, input: ActionInput, o: PlanOpts): PlanResult {
    const h = analysisHash(st);
    const hit = this.planStore?.get(h, input, o);
    if (hit) {
      this.stats.planHits++;
      return hit;
    }
    if (this.planMode === 'collect') {
      const owner = this.ownerOf.get(st);
      this.planRequests.push({ hash: h, position: owner ? owner.key : null, input, opts: o });
      return dummyPlan(input);
    }
    const plan = E.planAction(st, input as PlayerActionInput, o);
    plan.traceEvents = [];
    this.stats.planComputed++;
    this.planStore?.set(h, input, o, plan);
    this.computedPlans.push({ hash: h, input, opts: o, plan });
    return plan;
  }

  diag(service: string, code: DiagCode, severity: Diagnostic['severity'], message: string, extra: Partial<Diagnostic> = {}): Diagnostic {
    const d: Diagnostic = { seq: this.seq++, tMs: this.elapsed(), service, code, severity, message, ...extra };
    // The same limit is reported once per service after the first few times, so a loop cannot flood the record.
    if (this.diagnostics.length < this.limits.maxDiagnostics) this.diagnostics.push(d);
    else if (!this.overflowNoted.has('overflow')) {
      this.overflowNoted.add('overflow');
      this.diagnostics.push({ seq: this.seq++, tMs: this.elapsed(), service: 'platform', code: 'truncated', severity: 'warn', message: `More than ${this.limits.maxDiagnostics} diagnostics: the rest are not recorded.` });
    }
    return d;
  }

  /** The position a key names (undefined / null / '' / 'root' = the request's position). Throws KeyError for a stale key. */
  position(from: unknown): Position {
    if (from === undefined || from === null || from === '' || from === 'root') return this.positions.get('root') as Position;
    const k = String(from);
    const p = this.positions.get(k);
    if (p) return p;
    const m = /^(\d+)\.\d+$/.exec(k);
    if (!m) throw new KeyError(`Unknown position "${k}" (keys look like "<request>.<n>" and are valid only during the request that explored them).`);
    if (Number(m[1]) !== this.requestId) throw new KeyError(`Stale position "${k}": it belongs to request ${m[1]}, this is request ${this.requestId}. Keys are valid only during the request that explored them.`);
    throw new KeyError(`Unknown position "${k}": it was not kept (at most ${this.limits.maxPositions} positions per request) or never issued.`);
  }

  /** Keep an explored state under a new key; null (with a diagnostic) if a cap is reached. */
  addPosition(state: GameState, driveOver: boolean, parent: Position, via: string | null, service: string): string | null {
    if (this.keptCount() >= this.limits.maxPositions) {
      this.noteOnce(service, 'position-cap', `No more positions can be kept in this request (${this.limits.maxPositions}); further outcomes come without a key.`, { limit: 'maxPositions', max: this.limits.maxPositions });
      return null;
    }
    if (this.bytesPer * (this.keptCount() + 1) > this.limits.maxPositionBytes) {
      this.noteOnce(service, 'memory-cap', `The explored positions use an estimated ${Math.round((this.bytesPer * (this.keptCount() + 1)) / 1048576)} MB (limit ${Math.round(this.limits.maxPositionBytes / 1048576)} MB); further outcomes come without a key.`, { limit: 'maxPositionBytes', max: this.limits.maxPositionBytes, value: this.bytesPer * (this.keptCount() + 1) });
      return null;
    }
    if (parent.depth + 1 > this.limits.maxDepth) {
      this.noteOnce(service, 'depth-limit', `Key chains are limited to ${this.limits.maxDepth} steps; outcomes beyond that come without a key.`, { limit: 'maxDepth', max: this.limits.maxDepth });
      return null;
    }
    if (this.posKeyLimit !== null && this.nextPos >= this.posKeyLimit) {
      this.noteOnce(service, 'position-cap', 'This call has used the position keys reserved for it; further outcomes come without a key.', { limit: 'keysPerCall' });
      return null;
    }
    const key = `${this.requestId}.${this.nextPos++}`;
    const pos: Position = { key, state, driveOver, depth: parent.depth + 1, parent: parent.key, via };
    this.positions.set(key, pos);
    this.ownerOf.set(state, pos);
    this.stats.positionsKept = this.keptCount();
    return key;
  }

  /** Accept a module's progress note: sanitised, size-capped and rate-limited (a stage change is always accepted, up to the cap). */
  addProgress(raw: unknown): { ok: boolean; accepted: boolean } {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const txt = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, n) : '');
    const list = (v: unknown, k: number, n: number) => (Array.isArray(v) ? v.map((x) => txt(x, n)).filter(Boolean).slice(0, k) : undefined);
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
    const headline = txt(r.headline, 200);
    if (!headline) return { ok: false, accepted: false };
    const now = this.elapsed();
    const stage = txt(r.stage, 40) || 'search';
    const last = this.progress[this.progress.length - 1];
    if (this.progress.length >= this.limits.maxProgressUpdates || (now - this.lastProgressAt < this.limits.minProgressGapMs && last && last.stage === stage)) {
      this.progressDropped++;
      return { ok: true, accepted: false };
    }
    const b = r.best && typeof r.best === 'object' ? (r.best as Record<string, unknown>) : null;
    const u: ProgressUpdate = { seq: this.progress.length + 1, tMs: now, stage, headline };
    const ev = list(r.evaluating, 5, 140);
    const ro = list(r.ruledOut, 6, 140);
    if (ev?.length) u.evaluating = ev;
    if (ro?.length) u.ruledOut = ro;
    if (b && txt(b.label, 120)) u.best = { label: txt(b.label, 120), detail: txt(b.detail, 160) || undefined, pTurnover: num(b.pTurnover), pTouchdown: num(b.pTouchdown), value: num(b.value) };
    const f = num(r.fraction);
    if (f !== undefined) u.fraction = Math.max(0, Math.min(1, f));
    this.progress.push(u);
    this.lastProgressAt = now;
    try {
      this.onProgress?.(u);
    } catch {
      /* a display problem never affects the decision */
    }
    return { ok: true, accepted: true };
  }

  /** Fixed leaf cap per plan, ignoring the clock (benchmarks and tests that must compare identical work); null = adaptive, the default. */
  leafCapOverride: number | null = null;
  /** Observed enumeration speed (leaves per millisecond), learned from the plans this request has run. */
  leafRate = 6;
  noteLeaves(leaves: number, ms: number): void {
    if (ms >= 4 && leaves > 50) this.leafRate = Math.max(0.5, 0.6 * this.leafRate + 0.4 * (leaves / ms));
  }
  /** Leaf cap for ONE engine plan so that it cannot run far past `remainingMs` (the engine cannot be interrupted): the rest is reported as unresolved mass. */
  leafCap(remainingMs: number): number {
    if (this.leafCapOverride !== null) return this.leafCapOverride;
    return Math.max(1500, Math.min(60000, Math.floor((Math.max(0, remainingMs) * this.leafRate * 0.6) / 2)));
  }

  newCandidateId(position: string, input: unknown): string {
    const id = `${this.requestId}.c${this.nextCand++}`;
    this.candidateRefs.set(id, { id, position, input });
    return id;
  }

  /** Record a diagnostic once per (service, code) — for limits that would otherwise repeat on every call. */
  noteOnce(service: string, code: DiagCode, message: string, extra: Partial<Diagnostic> = {}): void {
    const k = `${service}:${code}`;
    if (this.overflowNoted.has(k)) return;
    this.overflowNoted.add(k);
    this.diag(service, code, 'warn', message, extra);
  }

  /** Checks made before every service call; a failure is returned to the module (never thrown). */
  admit(service: string): ServiceFailure | null {
    if (this.stats.totalCalls >= this.limits.maxServiceCalls) {
      this.noteOnce(service, 'call-cap', `This request has made ${this.limits.maxServiceCalls} service calls (the limit).`, { limit: 'maxServiceCalls', max: this.limits.maxServiceCalls });
      return fail('call-cap', `Service call limit reached (${this.limits.maxServiceCalls} per request).`);
    }
    if (this.serviceTimeLeft() <= 0) {
      this.noteOnce(service, 'time-budget', `The services used ${Math.round(this.stats.totalServiceMs)} ms of this request's ${Math.round(this.moduleMs * this.limits.serviceTimeShare)} ms service budget.`, { limit: 'serviceTimeShare', max: this.moduleMs * this.limits.serviceTimeShare, value: this.stats.totalServiceMs });
      return fail('time-budget', 'The request\'s service-time budget is used up: answer now with what you have.');
    }
    return null;
  }

  record(service: string, ms: number): void {
    const c = (this.stats.calls[service] ??= { n: 0, ms: 0 });
    c.n++;
    c.ms += ms;
    this.stats.totalCalls++;
    this.stats.totalServiceMs += ms;
  }

  /** Enumeration budget: how many leaves one call may still use (also capped by the request's remaining total). */
  leavesLeft(): number {
    return Math.max(0, this.limits.maxLeavesPerRequest - this.stats.leaves);
  }

  /** The clone every service works on (the stored position is never handed out or modified). */
  cloneOf(p: Position): GameState {
    E.usePitch(this.root);
    const c = E.cloneState(p.state);
    // The clone has the position's content: an analysis of it is an analysis of that position (and can be offloaded / cached as such).
    this.ownerOf.set(c, p);
    return c;
  }

  /** Register a position created elsewhere (an engine worker) under its reserved key. */
  adopt(pos: Position): void {
    this.positions.set(pos.key, pos);
    this.ownerOf.set(pos.state, pos);
    this.stats.positionsKept = this.keptCount();
  }
}
