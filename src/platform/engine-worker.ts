/**
 * The engine worker (V5.7): the script every pool worker runs. Bundled on its own (engine included) by
 * scripts/build.mjs to dist/web/engine-worker.js (the app embeds it as text, the headless host loads it from a file).
 *
 * It never holds the live match: it receives analysis views of states (no dice generator, no log), keeps them per
 * request (a private position registry), and answers four kinds of job:
 *   service  run a platform service exactly as the host would (same code), optionally with pre-computed plans
 *   collect  dry pass of a service: only report which exact plans it would need (for parallel fan-out)
 *   plan     one exact plan (engine planner) of one input in one known position
 *   builtin  the built-in coach's whole decision for a state (used by the game to keep it off the interface thread)
 * Messages in:  { t:'job', id, kind, … } | { t:'end', request }
 * Messages out: { t:'done', id, … } | { t:'fail', id, message }
 */
import * as Engine from '../engine/index';
import type { GameState, TeamId } from '../engine/index';
import { bindEngine, nextMove, type AIFile, type AIMove } from '../ai/index';
import { E } from '../ai/engine';
import { PlanCache, type PlanOpts } from './analysis';
import { execService } from './services';
import { Session, type PlanStore, type Position, type PlanRequest } from './session';
import type { Limits } from './limits';
import type { PlanResult } from '../engine/planner';
import type { Diagnostic } from './limits';

bindEngine(Engine);

interface Scope {
  postMessage(m: unknown): void;
  onmessage: ((ev: { data: Record<string, unknown> }) => void) | null;
}
const scope = globalThis as unknown as Scope;

export interface PosRec {
  key: string;
  state: GameState;
  driveOver: boolean;
  depth: number;
  parent: string | null;
  via: string | null;
}

export interface Ctx {
  requestId: number;
  team: TeamId;
  moduleMs: number;
  limits: Limits;
  root: GameState;
  rootBuiltIn: Array<[string, Record<string, unknown>]>;
  legacyErrors: boolean;
  leafCapOverride?: number | null;
}

interface Req {
  ctx: Ctx;
  positions: Map<string, PosRec>;
  evalCache: Session['evalCache'];
  leafRate: number;
  used: number;
}

const reqs = new Map<number, Req>();
const MAX_REQUESTS = 8;

function reqFor(m: Record<string, unknown>): Req {
  const id = Number(m.request);
  let r = reqs.get(id);
  if (!r) {
    const ctx = m.ctx as Ctx | undefined;
    if (!ctx) throw new Error(`unknown request ${id}: the host must send its context first`);
    r = { ctx, positions: new Map(), evalCache: new Map(), leafRate: 6, used: 0 };
    reqs.set(id, r);
    while (reqs.size > MAX_REQUESTS) reqs.delete(reqs.keys().next().value as number);
  }
  r.used = Date.now();
  for (const p of (m.states as PosRec[] | undefined) ?? []) r.positions.set(p.key, p);
  return r;
}

/** A session for one job: the request's positions (copies), budgets as the host granted them, reserved key ranges. */
class JobSession extends Session {
  private readonly hostKept: number;
  private baseSize = 0;
  private readonly jobStart = Date.now();
  private readonly budgetMs: number;
  private readonly hardAt: number;
  private readonly req: Req;
  constructor(r: Req, m: Record<string, unknown>) {
    const b = m.budget as { serviceMs: number; leavesLeft: number; leafRate: number; hardAt: number };
    super(r.ctx.root, r.ctx.team, r.ctx.requestId, r.ctx.moduleMs, { ...r.ctx.limits, maxLeavesPerRequest: b.leavesLeft });
    this.req = r;
    this.budgetMs = b.serviceMs;
    this.hardAt = b.hardAt;
    this.hostKept = Number(m.hostKept) || 0;
    this.legacyErrors = r.ctx.legacyErrors;
    this.leafCapOverride = r.ctx.leafCapOverride ?? null;
    this.rootBuiltIn = new Map(r.ctx.rootBuiltIn);
    for (const [k, v] of r.evalCache) this.evalCache.set(k, v);
    for (const p of r.positions.values()) if (p.key !== 'root') this.adopt(p);
    this.baseSize = this.positions.size;
    const ids = m.ids as { pos: number; cand: number; posLimit: number };
    this.nextPos = ids.pos;
    this.nextCand = ids.cand;
    this.posKeyLimit = ids.posLimit;
    this.leafRate = b.leafRate || this.leafRate;
  }
  override serviceTimeLeft(): number {
    const now = Date.now();
    return Math.max(0, Math.min(this.budgetMs, this.hardAt - this.jobStart) - (now - this.jobStart));
  }
  protected override keptCount(): number {
    return this.hostKept + (this.positions.size - this.baseSize);
  }
  newPositions(): PosRec[] {
    return [...this.positions.values()].filter((p) => p.key !== 'root' && !this.req.positions.has(p.key)) as PosRec[];
  }
}

/**
 * The plans a fan-out computed for THIS call. The real pass takes them whatever leaf cap it asks for: they were computed
 * with the cap the call itself asked for at its start (the time was spent already), and their `unresolved` mass says how
 * far they are from exact — asking again with a cap that only differs because the clock moved would just repeat the work.
 */
class CallPlans extends PlanCache<PlanResult> {
  override get(posHash: string, input: unknown, o: PlanOpts): PlanResult | null {
    return super.get(posHash, input, { ...o, maxLeaves: 0 });
  }
}
function plansStore(pre: Array<{ hash: string; input: unknown; opts: PlanOpts; plan: PlanResult }> | undefined): PlanStore {
  const c = new CallPlans(100000, 512 * 1024 * 1024);
  for (const e of pre ?? []) c.set(e.hash, e.input, e.opts, e.plan);
  return c as unknown as PlanStore;
}

const diagOut = (d: Diagnostic[]): Diagnostic[] => d.map((x) => ({ ...x }));

function serviceJob(m: Record<string, unknown>): Record<string, unknown> {
  const t0 = Date.now();
  const r = reqFor(m);
  const ses = new JobSession(r, m);
  ses.planStore = plansStore(m.plans as never);
  const collect = m.collect === true;
  if (collect) ses.planMode = 'collect';
  const out = execService(ses, String(m.name), (m.args as unknown[]) ?? []);
  if (collect) return { t: 'done', id: m.id, requests: dedupe(ses.planRequests), busyMs: Date.now() - t0 };
  // remember what this worker now knows of the request
  const fresh = ses.newPositions();
  for (const p of fresh) r.positions.set(p.key, p);
  for (const [k, v] of ses.evalCache) r.evalCache.set(k, v);
  r.leafRate = ses.leafRate;
  return {
    t: 'done',
    id: m.id,
    value: out.value,
    thrown: out.thrown,
    newPositions: fresh,
    candRefs: [...ses.candidateRefs.values()],
    diagnostics: diagOut(ses.diagnostics),
    stats: { leaves: ses.stats.leaves, candidatesReturned: ses.stats.candidatesReturned, planComputed: ses.stats.planComputed, planHits: ses.stats.planHits },
    computedPlans: ses.computedPlans,
    leafRate: ses.leafRate,
    busyMs: Date.now() - t0,
  };
}

function dedupe(list: PlanRequest[]): PlanRequest[] {
  const seen = new Set<string>();
  const out: PlanRequest[] = [];
  for (const q of list) {
    const k = PlanCache.base(q.hash, q.input, q.opts) + `|c${q.opts.maxLeaves ?? ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(q);
  }
  return out;
}

function planJob(m: Record<string, unknown>): Record<string, unknown> {
  const t0 = Date.now();
  const r = reqFor(m);
  const pos = r.positions.get(String(m.position));
  const state = pos ? pos.state : String(m.position) === 'root' ? r.ctx.root : undefined;
  if (!state) return { t: 'fail', id: m.id, message: `position ${String(m.position)} unknown to this worker`, missing: true };
  E.usePitch(state);
  const plan = E.planAction(state, m.input as never, m.opts as PlanOpts);
  plan.traceEvents = [];
  return { t: 'done', id: m.id, plan, leaves: plan.withTeamRerolls?.leaves ?? 0, busyMs: Date.now() - t0 };
}

function builtinJob(m: Record<string, unknown>): Record<string, unknown> {
  const t0 = Date.now();
  const state = m.state as GameState;
  const mv: AIMove | null = nextMove(state, m.team as TeamId, (m.style as never) ?? 'balanced', (m.params as never) ?? {}, { profile: m.profile as AIFile | undefined });
  return { t: 'done', id: m.id, move: mv, busyMs: Date.now() - t0 };
}

scope.onmessage = (ev) => {
  const m = ev.data;
  if (m.t === 'end') {
    reqs.delete(Number(m.request));
    return;
  }
  if (m.t !== 'job') return;
  try {
    const kind = String(m.kind);
    const reply = kind === 'nop' ? { t: 'done', id: m.id } : kind === 'service' ? serviceJob(m) : kind === 'plan' ? planJob(m) : kind === 'builtin' ? builtinJob(m) : { t: 'fail', id: m.id, message: `unknown job kind ${kind}` };
    scope.postMessage(reply);
  } catch (e) {
    scope.postMessage({ t: 'fail', id: m.id, message: (e as Error).message ?? String(e) });
  }
};
scope.postMessage({ t: 'ready' });
