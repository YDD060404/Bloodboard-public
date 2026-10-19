/**
 * Strategy platform (V5.6): versions, limits and diagnostics.
 *
 * `apiVersion` is the strategy API's MAJOR version and stays 1. `apiMinor` counts additive releases:
 *   0 = V5.5   (plan, reachable; observation; chooseAction / chooseDecision)
 *   1 = V5.5.1 (explore, evaluate, position keys)
 *   2 = V5.6   (this platform: candidates, threats, sequence, features, rankings, capabilities, diagnostics …)
 * See docs/AI_PLATFORM.md §Versioning for what may change without a major bump.
 */
export const API_VERSION = 1;
export const API_MINOR = 2;
/** V6: the second generation of the module API (observation v2, legal-choice discovery, controlled simulation, lifecycle hooks, persistent context). Modules declare `apiVersion: 2`; apiVersion 1 modules keep working unchanged. */
export const API_V2_VERSION = 2;
export const API_V2_MINOR = 0;
export const SUPPORTED_API_VERSIONS: readonly number[] = [1, 2];
export const PLATFORM_ID = 'bloodboard-strategy-platform';

/** Every limit the host enforces. A module can read the effective values with `services.capabilities()`; it cannot raise them. */
export interface Limits {
  /** Module time limit per request (its `timeLimitMs`, clamped to [min, max]). */
  defaultModuleMs: number;
  minModuleMs: number;
  maxModuleMs: number;
  /** Share of the module's time the services may use in total (the module needs the rest to answer). */
  serviceTimeShare: number;
  /** Service calls per request. */
  maxServiceCalls: number;
  /** Wall-clock per service call (`maxMs` option): default and ceiling. */
  defaultCallMs: number;
  maxCallMs: number;
  /** Outcome leaves the engine may enumerate in one call / in one request. */
  defaultLeavesPerCall: number;
  maxLeavesPerCall: number;
  maxLeavesPerRequest: number;
  /** Distinct outcomes returned per explore call. */
  maxOutcomesPerCall: number;
  /** Explored positions kept per request (each is a cloned game state) and their estimated memory. */
  maxPositions: number;
  maxPositionBytes: number;
  /** Longest chain of keys (explore from a key that came from explore from a key …). */
  maxDepth: number;
  /** Candidate records per page, and candidates whose probabilities may be computed exactly in one call. */
  defaultPage: number;
  maxPage: number;
  maxExactPerCall: number;
  /** Steps of a `sequence`, and outcomes it follows per step. */
  maxSequenceSteps: number;
  maxSequenceBranches: number;
  /** Distinct in-action decision branches one explore call may enumerate. */
  maxDecisionLeaves: number;
  /** Diagnostics kept per request. */
  maxDiagnostics: number;
  /** Progress updates a module may publish per request, and the shortest gap between two accepted ones. */
  maxProgressUpdates: number;
  minProgressGapMs: number;
  /** Calls one `batch` service call may carry (V5.7; additive). */
  maxBatchCalls: number;
}

export const DEFAULT_LIMITS: Limits = {
  defaultModuleMs: 5000,
  minModuleMs: 500,
  maxModuleMs: 120000,
  serviceTimeShare: 0.9,
  maxServiceCalls: 6000,
  defaultCallMs: 3000,
  maxCallMs: 15000,
  defaultLeavesPerCall: 700,
  maxLeavesPerCall: 20000,
  maxLeavesPerRequest: 2_000_000,
  maxOutcomesPerCall: 40,
  maxPositions: 4000,
  maxPositionBytes: 400 * 1024 * 1024,
  maxDepth: 32,
  defaultPage: 50,
  maxPage: 400,
  maxExactPerCall: 300,
  maxSequenceSteps: 8,
  maxSequenceBranches: 6,
  maxDecisionLeaves: 20000,
  maxDiagnostics: 200,
  maxProgressUpdates: 80,
  minProgressGapMs: 200,
  maxBatchCalls: 32,
};

export type DiagCode =
  | 'timeout' // a call stopped at its maxMs
  | 'truncated' // a result is partial (page limit, outcome limit, exact cap …)
  | 'call-cap' // too many service calls in this request
  | 'time-budget' // the request's service-time budget is used up
  | 'leaf-budget' // the request's enumeration budget is used up
  | 'position-cap' // no more explored positions can be kept
  | 'memory-cap' // estimated memory of kept positions
  | 'depth-limit' // key chain too long
  | 'stale-key' // key from another request, or never issued / dropped
  | 'wrong-team' // requested team is not the one active in that position
  | 'pending-decision' // the position waits for a rule decision
  | 'illegal' // the action is illegal in that position
  | 'invalid-argument'
  | 'approximate' // a probability includes unexpanded mass
  | 'unsupported'
  | 'module-error' // the module threw / answered invalidly / timed out (host level)
  | 'internal';

export interface Diagnostic {
  seq: number;
  /** Milliseconds since the request started. */
  tMs: number;
  service: string;
  code: DiagCode;
  severity: 'info' | 'warn' | 'error';
  message: string;
  /** Which limit was hit, its value and the amount reached, where applicable. */
  limit?: string;
  max?: number;
  value?: number;
  detail?: unknown;
}

export const clamp = (v: unknown, d: number, lo: number, hi: number): number => {
  const n = Number(v);
  return v === undefined || v === null || !Number.isFinite(n) ? d : Math.min(hi, Math.max(lo, n));
};
