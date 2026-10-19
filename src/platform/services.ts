/**
 * The service dispatcher: one entry point for every call a module makes (`callService(session, name, args)`), shared by
 * the in-app host and the headless host. It enforces the request budgets (`admit`), records usage, turns thrown
 * errors into structured failures, and keeps the V5.5.1 services' result shapes (additive superset).
 */
import type { ActionInput, PlayerActionInput } from '../engine/index';
import { E } from '../ai/engine';
import { KeyError, fail, type Session } from './session';
import { exploreService, sequenceService } from './explore';
import { candidatesService } from './candidates';
import { blitzService, crowdService, reachService, scoringService, tackleZonesService } from './threats';
import { evaluatePosition, featuresOf, fullTerms, FEATURE_SCHEMA_VERSION } from './evaluation';
import { perspectiveOf } from './explore';
import { capabilities, schemaNamed } from './schemas';
import { V2_SERVICE_NAMES, v2Service } from './v2';

type Args = unknown[];
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

function legacyPlan(ses: Session, input: ActionInput, from: unknown) {
  const pos = ses.position(from);
  // One plan cannot be interrupted, so its enumeration is capped to the time this call may use (the rest is reported as `unresolved`).
  const t1 = Date.now();
  const plan = ses.plan(ses.cloneOf(pos), input, { followUp: true, maxLeaves: ses.leafCap(Math.min(ses.limits.maxCallMs, ses.serviceTimeLeft())) });
  ses.stats.leaves += plan.withTeamRerolls?.leaves ?? 0;
  ses.noteLeaves((plan.withTeamRerolls?.leaves ?? 0) * 2, Date.now() - t1);
  return { ok: plan.ok, errors: plan.errors, steps: plan.steps.map((x) => ({ kind: x.kind, label: x.label, target: x.target, pSingle: x.pSingle })), withoutTeamRerolls: plan.withoutTeamRerolls, withTeamRerolls: plan.withTeamRerolls };
}

/** The items of a `batch` call, validated (shared by the synchronous and the pooled implementation). */
export function batchItems(ses: Session, v: unknown): Array<{ service: string; args: Args }> | ReturnType<typeof fail> {
  if (!Array.isArray(v) || !v.length) return fail('invalid-argument', 'batch needs a non-empty array of { service, args } items.');
  if (v.length > ses.limits.maxBatchCalls) return fail('invalid-argument', `batch is limited to ${ses.limits.maxBatchCalls} calls (got ${v.length}).`, { limit: 'maxBatchCalls', max: ses.limits.maxBatchCalls });
  const out: Array<{ service: string; args: Args }> = [];
  for (const [i, it] of v.entries()) {
    const o = obj(it);
    const svc = typeof o.service === 'string' ? o.service : '';
    if (!svc || svc === 'batch' || !SERVICE_NAMES.includes(svc)) return fail('invalid-argument', `batch item ${i}: "service" must name a service other than batch (got ${JSON.stringify(o.service)}).`);
    if (o.args !== undefined && !Array.isArray(o.args)) return fail('invalid-argument', `batch item ${i}: "args" must be an array (the arguments of the call).`);
    out.push({ service: svc, args: (o.args as Args) ?? [] });
  }
  return out;
}

/** Without the engine pool a batch is just the calls in order (same results, no parallelism). */
function batchSync(ses: Session, v: unknown): unknown {
  const items = batchItems(ses, v);
  if (!Array.isArray(items)) return items;
  const results = items.map((it) => {
    try {
      return callService(ses, it.service, it.args);
    } catch (e) {
      return fail('internal', (e as Error).message);
    }
  });
  return { ok: true, parallel: false, count: results.length, results };
}

function run(ses: Session, name: string, a: Args): unknown {
  switch (name) {
    case 'plan':
      return legacyPlan(ses, a[0] as ActionInput, a[1]);
    case 'reachable': {
      const pos = ses.position(a[1]);
      return E.reachableSquares(ses.cloneOf(pos), String(a[0])).map((r) => ({ x: r.c.x, y: r.c.y, rushes: r.rushes, steps: r.steps }));
    }
    case 'explore': {
      // V5.5.1 signature: (input, options); options.from names the position.
      return exploreService(ses, a[0] as ActionInput, obj(a[1]));
    }
    case 'evaluate': {
      // V5.5.1: evaluate(from). V5.6: evaluate(from, { perspective, features, horizon }) or evaluate({ from, … }).
      const first = a[0];
      const o = first && typeof first === 'object' ? obj(first) : { ...obj(a[1]), from: first };
      const pos = ses.position(o.from);
      const persp = perspectiveOf(ses, pos, o.perspective);
      if (typeof persp !== 'string') return persp;
      const ev = evaluatePosition(ses, pos, persp, o.horizon === 'position' ? 'position' : 'root');
      const out: Record<string, unknown> = { ok: true, value: ev.total, terms: ev.terms, perspective: persp, baseline: 'built-in evaluation', featureSchema: FEATURE_SCHEMA_VERSION };
      out.allTerms = fullTerms(ev.terms);
      if (o.features) out.features = featuresOf(pos.state, persp, pos.driveOver);
      return out;
    }
    case 'candidates':
      return candidatesService(ses, obj(a[0]));
    case 'threats.tackleZones':
      return tackleZonesService(ses, obj(a[0]));
    case 'threats.reach':
      return reachService(ses, obj(a[0]));
    case 'threats.blitz':
      return blitzService(ses, obj(a[0]));
    case 'threats.scoring':
      return scoringService(ses, obj(a[0]));
    case 'threats.crowd':
      return crowdService(ses, obj(a[0]));
    case 'sequence':
      return sequenceService(ses, obj(a[0]));
    case 'features': {
      const o = obj(a[1]);
      const pos = ses.position(a[0]);
      const persp = perspectiveOf(ses, pos, o.perspective);
      if (typeof persp !== 'string') return persp;
      const f = featuresOf(pos.state, persp, pos.driveOver);
      return { ok: true, position: { key: pos.key }, ...f };
    }
    case 'legalChoices':
    case 'legalTargets':
    case 'playerDestinations':
    case 'spatialMask':
    case 'validate':
    case 'fork.open':
    case 'fork.step':
    case 'fork.close':
      return v2Service(ses, name, a);
    case 'batch':
      return batchSync(ses, a[0]);
    case 'capabilities':
      return capabilities(ses.limits);
    case 'schema':
      return schemaNamed(a[0]);
    case 'progress':
      return ses.addProgress(a[0]);
    case 'diagnostics':
      return { ok: true, diagnostics: ses.diagnostics, usage: { ...ses.stats, elapsedMs: ses.elapsed(), positions: ses.positions.size - 1 }, limitsLeft: { serviceMs: ses.serviceTimeLeft(), calls: ses.limits.maxServiceCalls - ses.stats.totalCalls, leaves: ses.leavesLeft() } };
    default:
      return fail('unsupported', `Unknown service "${name}" (see services.capabilities()).`);
  }
}

const LEGACY = new Set(['plan', 'reachable', 'explore', 'evaluate']);
export const FREE = new Set(['capabilities', 'schema', 'diagnostics', 'progress']);

/** What running a service produced: a value, or (V5.5 legacy services only) the message of the error the call must reject with. */
export type ExecOutcome = { value: unknown; thrown?: undefined } | { thrown: string; value?: undefined };

/**
 * Run one service on a session WITHOUT the budget admission and usage recording (those belong to whoever schedules the
 * call: `callService` below in the host thread, `callServiceAsync` for pooled calls, the engine worker for a job).
 * Never throws for a module's mistake: failures come back as `{ ok:false, code, message }`.
 */
export function execService(ses: Session, name: string, args: Args): ExecOutcome {
  try {
    E.usePitch(ses.root);
    const r = run(ses, name, args);
    if (ses.legacyErrors && LEGACY.has(name) && r && typeof r === 'object' && (r as { code?: unknown }).code === 'stale-key') throw new KeyError((r as { message: string }).message);
    if (r && typeof r === 'object' && (r as { ok?: unknown }).ok === false) {
      const f = r as { code?: string; message?: string };
      if (f.code && f.code !== 'illegal') ses.diag(name, f.code as never, 'info', f.message ?? 'failed');
    }
    if (ses.leavesLeft() <= 0) ses.noteOnce(name, 'leaf-budget', `This request has enumerated ${ses.limits.maxLeavesPerRequest} outcome leaves (the limit); further calls get no more enumeration.`, { limit: 'maxLeavesPerRequest', max: ses.limits.maxLeavesPerRequest });
    return { value: r };
  } catch (e) {
    if (e instanceof KeyError) {
      if (ses.legacyErrors && LEGACY.has(name)) return { thrown: e.message }; // V5.5.1 contract: the call rejects with the message
      return { value: fail('stale-key', e.message) };
    }
    const msg = (e as Error).message ?? String(e);
    ses.diag(name, 'internal', 'error', msg);
    return { value: fail('internal', `${name} failed: ${msg}`) };
  }
}

/** Every module call goes through here (synchronous, on the calling thread). Never throws for a module's mistake. */
export function callService(ses: Session, name: string, args: Args): unknown {
  if (!FREE.has(name)) {
    const blocked = ses.admit(name);
    if (blocked) return blocked;
  }
  const t0 = Date.now();
  if (!FREE.has(name)) ses.callBegin();
  try {
    const o = execService(ses, name, args);
    if (o.thrown !== undefined) throw new KeyError(o.thrown);
    return o.value;
  } finally {
    if (!FREE.has(name)) {
      ses.callEnd();
      ses.record(name, Date.now() - t0);
    }
  }
}

export { run as runService };
export const SERVICE_NAMES = ['plan', 'reachable', 'explore', 'evaluate', 'candidates', 'threats.tackleZones', 'threats.reach', 'threats.blitz', 'threats.scoring', 'threats.crowd', 'sequence', 'features', 'capabilities', 'schema', 'diagnostics', 'progress', 'batch', ...V2_SERVICE_NAMES];
