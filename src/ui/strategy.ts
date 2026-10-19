/**
 * Strategy modules (API version 1, additive minors — docs/AI_PLATFORM.md; V5.5 / V5.5.1 modules run unchanged).
 *
 * V5.6: this file is only the BROWSER transport. The observation, services, limits, validation, diagnostics and the
 * built-in fallback all live in `src/platform` (shared with the headless research host); here a module runs in a Web
 * Worker built from the platform's harness. The module never sees the game state, the dice generator, its seed or
 * counter, or any future die; a failure, timeout, stale or invalid answer falls back to the built-in algorithm and is
 * reported.
 */
import type { App } from './app';
import type { GameState, TeamId } from './engine-global';
import type { AIMove, CoachEntry } from '../ai/index';
import type { CoachCfg } from './computer';
import { getPool } from './enginepool';
import type { ContextTicket } from '../platform/hostext';
import { API_MINOR, API_VERSION, platformDecide, moduleMeta, SERVICE_NAMES, observe as platformObserve, type DecideMeta, type ProgressEvent, type Spawn, type WorkerLike } from '../platform/index';

export const STRATEGY_API_VERSION = API_VERSION;
export const STRATEGY_API_MINOR = API_MINOR;
export const STRATEGY_SERVICES = SERVICE_NAMES;

/** Web Worker transport for the platform host. */
export const browserSpawn: Spawn = (source: string): WorkerLike => {
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  const w = new Worker(url);
  URL.revokeObjectURL(url);
  const out: WorkerLike = { postMessage: (m) => w.postMessage(m), terminate: () => w.terminate(), onmessage: null, onerror: null };
  w.onmessage = (ev: MessageEvent) => out.onmessage?.(ev.data ?? {});
  w.onerror = (e: ErrorEvent) => out.onerror?.(e.message);
  return out;
};

export const observe = (s: GameState, team: TeamId, requestId: number) => platformObserve(s, team, requestId);

/** Read a module's metadata (for the AI list). */
export const strategyMeta = (code: string) => moduleMeta(browserSpawn, code);

/** The last decision's diagnostics (for the AI list / console). */
let lastMeta: DecideMeta | null = null;
export const lastStrategyMeta = () => lastMeta;

/**
 * A strategy module's next move for `team`: decisions and Turn actions go to the module (validated); set-up / kick-off
 * steps and anything the module does not answer use the built-in algorithm. `note` receives each problem; `stale` says
 * the position moved on (the answer is then dropped). Never throws.
 */
export async function strategyDecide(s: GameState, team: TeamId, entry: CoachEntry, note: (why: string) => void, stale: () => boolean, onProgress?: (e: ProgressEvent) => void, context?: ContextTicket, advisory = false): Promise<AIMove | null> {
  const r = await platformDecide(s, team, entry, { spawn: browserSpawn, note, stale, onProgress, pool: getPool() ?? undefined, context, advisory });
  lastMeta = r.meta;
  // V5.8: the same decision diagnostics the batch platform logs (what was offered, whether the set-up hook / coach context were used, fallback, time allowance).
  const w = window as unknown as { bloodboardDecisionLog?: unknown[] };
  const log = (w.bloodboardDecisionLog ??= []);
  log.push({ team, coach: entry.id, phase: s.phase, kind: r.meta.kind, via: r.meta.via, fellBack: r.meta.fellBack, reason: r.meta.reason, setup: r.meta.setup ?? null, context: r.meta.context ?? null, allowanceMs: r.meta.allowanceMs ?? null, hostExtensions: r.meta.hostExtensions ?? null, elapsedMs: r.meta.usage.elapsedMs, pooled: !!r.meta.usage.pooled, advisory, cancelled: r.move === null });
  if (log.length > 400) log.splice(0, log.length - 400);
  (window as unknown as { bloodboardLastDecision?: unknown }).bloodboardLastDecision = r.meta;
  return r.move;
}

/** The computer coach's next move with a strategy module (problems are shown as a notice). */
export async function strategyMove(app: App, s: GameState, c: CoachCfg): Promise<AIMove | null> {
  let lastEmit = 0;
  const show = (e: ProgressEvent) => {
    // Only a decision that is taking a few seconds gets a panel; redraws are limited to two a second.
    if (e.elapsedMs < 2000 && !e.updates.length) return;
    app.st.computer.progress = { team: c.team, coach: c.entry.name, elapsedMs: e.elapsedMs, limitMs: e.limitMs, serviceCalls: e.usage.serviceCalls, updates: e.updates.slice(-12), engine: e.engine };
    const now = Date.now();
    if (now - lastEmit >= 400) {
      lastEmit = now;
      app.emit();
    }
  };
  try {
    return await strategyDecide(s, c.team, c.entry, (why) => app.toast(`${c.entry.name}: ${why} The built-in algorithm decided this one.`, 'error'), () => app.game !== s, show, app.coachStore.ticket(c.team, c.entry.id, { version: c.entry.version, schema: c.entry.contextSchema, logLength: s.log.length + 1 }));
  } finally {
    app.st.computer.progress = null;
  }
}

/** A tiny example strategy module (docs/AI_EXTENSIONS.md; examples/ai/): prefers the safest candidate that scores, else the built-in best with less than 20% Turnover risk. */
export const EXAMPLE_STRATEGY = `// Bloodboard AI strategy module — API version 1 (docs/AI_EXTENSIONS.md)
bloodboard.register({
  id: 'cautious-scorer',
  name: 'Cautious Scorer',
  apiVersion: 1,
  version: '1.0',
  description: 'Re-ranks the built-in candidates: scores when it can, otherwise the best action whose Turnover risk is under 20%.',
  timeLimitMs: 3000,
  chooseAction(observation, candidates, services) {
    const scoring = candidates.filter((c) => (c.pTouchdown || 0) > 0.5).sort((a, b) => (b.pTouchdown || 0) - (a.pTouchdown || 0));
    if (scoring.length) return { candidateId: scoring[0].id, why: 'Scores with the best chance.' };
    const safe = candidates.filter((c) => (c.pTurnover || 0) < 0.2 && c.builtInValue !== undefined).sort((a, b) => b.builtInValue - a.builtInValue);
    if (safe.length && safe[0].builtInValue > 0.5) return { candidateId: safe[0].id, why: 'The best action with less than 20% Turnover risk.' };
    return { endTurn: true, why: 'Nothing safe enough is worth doing.' };
  },
});
`;
