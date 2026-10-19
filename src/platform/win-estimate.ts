/**
 * V7-09: a sampling estimator of how a position tends to turn out — NOT a prediction about the actual players.
 *
 * From a given game state it plays `samples` complete continuations to full time, each on an alternate dice seed derived from `seedBase`, with BOTH sides
 * played by the same built-in coach (default Balanced, reduced search so a rollout stays affordable). It reports win / draw / loss counts, the shares with
 * 95 % Wilson intervals, and the mean final margin with its standard error — always with the sample count and the policy, never as a calibrated probability.
 * The coach function receives only the game state (no seed/future-RNG leak; the rollout's own seed is set after the clone). It never changes the live game.
 *
 * The engine is injected so the same code runs headless (Lab runner, tests) and inside the game (the global engine bundle, no second engine copy).
 */
import { nextMove, waitingFor, type AIMove } from '../ai/driver';
import type { AIStyle } from '../ai/types';
import type { ExecutionResult, GameState, TeamId } from '../engine/types';

export interface EngineLike {
  execute(s: GameState, input: never): ExecutionResult;
  decide(s: GameState, d: { requestId: string; optionId: string }): ExecutionResult;
  cloneState(s: GameState): GameState;
}

export interface EstimateOptions { samples: number; style?: AIStyle; seedBase?: number; maxMovesPerSample?: number }
export const ESTIMATE_SCHEMA = 'bloodboard-win-estimate/1';
/** Below this many samples the report says so loudly. */
export const MIN_RELIABLE_SAMPLES = 20;
const FAST_SEARCH = { threshold: 1e-3, maxLeaves: 600, maxExplored: 6 } as const;

export interface Share { count: number; share: number; ci95: [number, number] }
export interface WinEstimate {
  schema: typeof ESTIMATE_SCHEMA;
  method: string;
  samples: number;
  completed: number;
  /** Rollouts that hit the move cap or stopped for another reason are counted here and excluded from the shares. */
  incomplete: number;
  from: { phase: string; half: number; turnA: number; turnB: number; score: Record<TeamId, number> };
  outcome: { A: Share; draw: Share; B: Share };
  /** Mean of (A's final score − B's final score) and its standard error. */
  margin: { mean: number; se: number } | null;
  reliable: boolean;
  policy: string;
  limits: string[];
}

function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), w = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - w) / d), Math.min(1, (c + w) / d)];
}
function seedFor(base: number, i: number): number { let h = (2166136261 ^ (base >>> 0)) >>> 0; for (const c of `win|${i}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h >>> 0; }

/** An incremental estimator: `advance(n)` plays at most n moves (so a UI can stay responsive), `result()` can be read at any time. */
export class WinEstimator {
  private done = 0; private moves = 0; private cur: GameState | null = null; private finished = false;
  private tallies = { A: 0, draw: 0, B: 0 }; private incomplete = 0; private margins: number[] = [];
  constructor(private E: EngineLike, private start: GameState, private o: EstimateOptions) {}
  get progress(): { done: number; total: number } { return { done: this.done, total: this.o.samples }; }
  get isDone(): boolean { return this.finished; }

  advance(maxMoves = 5): boolean {
    for (let n = 0; n < maxMoves && !this.finished; n++) {
      if (!this.cur) {
        if (this.done >= this.o.samples) { this.finished = true; break; }
        this.cur = this.E.cloneState(this.start); this.cur.rng = { seed: seedFor(this.o.seedBase ?? 1, this.done), counter: 0 }; this.moves = 0;
      }
      const s = this.cur;
      if (s.phase === 'fullTime') { this.record(s); continue; }
      if (this.moves++ >= (this.o.maxMovesPerSample ?? 1500)) { this.incomplete++; this.cur = null; this.done++; continue; }
      const side = waitingFor(s);
      if (!side) {
        // A neutral step (pre-game, the end of a Drive or half): no coach acts, the match simply moves on — the same inputs the Lab runner uses.
        const nin = s.phase === 'pregame' ? { kind: 'pregame' } : { kind: 'nextDrive' };
        const nout = this.E.execute(s, nin as never);
        if (nout.status === 'illegal') { this.incomplete++; this.cur = null; this.done++; continue; }
        this.cur = nout.state as GameState; continue;
      }
      let mv: AIMove | null = null;
      try { mv = nextMove(s, side, this.o.style ?? 'balanced', { ...FAST_SEARCH }); } catch { mv = null; }
      if (!mv) { this.incomplete++; this.cur = null; this.done++; continue; }
      const out = mv.type === 'decision' ? this.E.decide(s, { requestId: mv.requestId, optionId: mv.optionId }) : this.E.execute(s, mv.input as never);
      if (out.status === 'illegal') { this.incomplete++; this.cur = null; this.done++; continue; }
      this.cur = out.state as GameState;
    }
    if (!this.cur && this.done >= this.o.samples) this.finished = true;
    return this.finished;
  }

  private record(s: GameState) {
    const a = s.teams.A.score, b = s.teams.B.score;
    this.tallies[a > b ? 'A' : a < b ? 'B' : 'draw']++; this.margins.push(a - b);
    this.cur = null; this.done++;
  }

  result(): WinEstimate {
    const n = this.tallies.A + this.tallies.draw + this.tallies.B;
    const share = (k: number): Share => ({ count: k, share: n ? k / n : 0, ci95: wilson(k, n) });
    const mean = n ? this.margins.reduce((x, y) => x + y, 0) / n : 0;
    const sd = n > 1 ? Math.sqrt(this.margins.reduce((x, y) => x + (y - mean) ** 2, 0) / (n - 1)) : 0;
    const s = this.start;
    const style = this.o.style ?? 'balanced';
    return {
      schema: ESTIMATE_SCHEMA,
      method: `${n} complete continuations from this position on alternate dice seeds, both sides played by the built-in ${style} coach with a reduced search`,
      samples: this.o.samples, completed: n, incomplete: this.incomplete,
      from: { phase: s.phase, half: s.match?.half ?? s.turn.half, turnA: s.teams.A.turn, turnB: s.teams.B.turn, score: { A: s.teams.A.score, B: s.teams.B.score } },
      outcome: { A: share(this.tallies.A), draw: share(this.tallies.draw), B: share(this.tallies.B) },
      margin: n ? { mean, se: n > 1 ? sd / Math.sqrt(n) : 0 } : null,
      reliable: n >= MIN_RELIABLE_SAMPLES,
      policy: `both sides: built-in ${style} coach, reduced search (threshold ${FAST_SEARCH.threshold}, ${FAST_SEARCH.maxLeaves} leaves, ${FAST_SEARCH.maxExplored} explored); dice seeds derived from base ${this.o.seedBase ?? 1}`,
      limits: [
        'This measures how the position tends to turn out when both sides are played by the stated built-in coach. It is not a prediction about the actual players and not a calibrated probability.',
        `The shares carry 95 % Wilson intervals from ${n} samples; fewer than ${MIN_RELIABLE_SAMPLES} samples is flagged as unreliable.`,
        'The reduced search makes both coaches weaker than in a normal game, so draws and swings may be more frequent than in real play.',
      ],
    };
  }
}

/** Synchronous convenience for headless use (tests, the Lab runner). */
export function estimateWin(E: EngineLike, state: GameState, o: EstimateOptions): WinEstimate {
  const est = new WinEstimator(E, state, o);
  while (!est.advance(50)) { /* keep playing */ }
  return est.result();
}
