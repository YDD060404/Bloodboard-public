import { pitchVariant } from './variant';
import type { RngState } from './types';

// ---------------------------------------------------------------------------
// Seeded, counter-based random number generator. The whole generator state is
// { seed, counter } and lives inside the GameState, so saving a position also
// saves "where the dice are". Planning never touches it.
// ---------------------------------------------------------------------------

function fmix32(h: number): number {
  h = h >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

export function nextU32(rng: RngState): number {
  const c = rng.counter >>> 0;
  const hi = Math.floor(rng.counter / 4294967296) >>> 0;
  const v = fmix32((fmix32((Math.imul(c, 0x9e3779b9) + 0x7f4a7c15 + Math.imul(hi, 0x632be5ab)) >>> 0) ^ (rng.seed >>> 0)) + 0x632be5ab);
  rng.counter += 1;
  return v;
}

/** Unbiased die roll 1..sides (rejection sampling). */
export function rollDie(rng: RngState, sides: number): number {
  const limit = Math.floor(4294967296 / sides) * sides;
  for (;;) {
    const u = nextU32(rng);
    if (u < limit) return (u % sides) + 1;
  }
}

// ---------------------------------------------------------------------------
// Optional difficulty (house rule for matches against the computer only).
//
// V5.5: outcome-based. Every consequential roll — Block dice included — says, through its `judge`, how good each
// result is for the team named by `judgeFor` (default `by`): +1 good, −1 bad, 0 neutral, graded in between. With
// the house rule on, each combination of faces is weighted by the result it gives: results good for the human side
// ×(1 − h), results good for the computer side ×(1 + c) (h, c from DIFFICULTY_TILT by level), then normalised. So a
// "high" face is never assumed to be good: an Armour Roll is judged by broken / holds for the coach it helps, a Block
// by the face the choosing coach would take, and so on. Rolls without a judge (scatter, weather, Kick-off table,
// random picks…) are neutral and never tilted; every result stays possible; level 0 is exactly the standard dice
// (the V3 generator path); the plan previews use the same weights, so displayed odds match execution.
// D6_TILT_LEVELS / d6TiltWeights: the V4-V5 numeric D6 tilt, kept for reference and old tests only.
// ---------------------------------------------------------------------------

export const DIFFICULTY_TILT = [0, 0.1, 0.2, 0.35] as const;
export const D6_TILT_LEVELS = [0, 0.15, 0.3, 0.5] as const;
export const D6_LEVEL_NAMES = ['Off (standard dice)', 'Slight', 'Moderate', 'Strong'] as const;

/** Face probabilities [P(1)…P(6)] for a difficulty level; `dir` +1 favours high faces, −1 low faces. */
export function d6TiltWeights(level: number, dir: 1 | -1): number[] {
  const t = D6_TILT_LEVELS[Math.max(0, Math.min(3, Math.round(level)))] ?? 0;
  return [1, 2, 3, 4, 5, 6].map((f) => (1 + (dir * t * (f - 3.5)) / 2.5) / 6);
}

/** One weighted face 1..6 from a single 32-bit draw (inverse CDF). */
export function rollWeightedD6(rng: RngState, w: number[]): number {
  const u = nextU32(rng) / 4294967296;
  let acc = 0;
  for (let i = 0; i < 5; i++) {
    acc += w[i];
    if (u < acc) return i + 1;
  }
  return 6;
}

/** Chance of a D6 test succeeding (natural 1 fails, natural 6 succeeds) with face weights (uniform when omitted). */
export function d6SuccessProbW(target: number, modifier: number, w?: number[] | null): number {
  let n = 0;
  for (let f = 1; f <= 6; f++) if (d6Success(f, target, modifier)) n += w ? w[f - 1] : 1 / 6;
  return n;
}

/** P(D6 ≥ x) with face weights (uniform when omitted). */
export function d6AtLeastW(x: number, w?: number[] | null): number {
  let n = 0;
  for (let f = Math.max(1, x); f <= 6; f++) n += w ? w[f - 1] : 1 / 6;
  return Math.min(1, n);
}

export function randomSeed(): number {
  const a = new Uint32Array(1);
  try {
    (globalThis.crypto as Crypto).getRandomValues(a);
    return a[0] >>> 0;
  } catch {
    return (Math.floor(Math.random() * 4294967296) >>> 0) || 1;
  }
}

// ---------------------------------------------------------------------------
// Block dice (p.62). Face mapping used only to generate results from a D6:
// 1 Player Down, 2 Both Down, 3-4 Push Back, 5 Stumble, 6 POW.
// ---------------------------------------------------------------------------

export type BlockFace = 'playerDown' | 'bothDown' | 'push' | 'stumble' | 'pow';

export function blockFace(n: number): BlockFace {
  switch (n) {
    case 1: return 'playerDown';
    case 2: return 'bothDown';
    case 3:
    case 4: return 'push';
    case 5: return 'stumble';
    default: return 'pow';
  }
}

export const BLOCK_FACE_LABEL: Record<BlockFace, string> = {
  playerDown: 'Player Down',
  bothDown: 'Both Down',
  push: 'Push Back',
  stumble: 'Stumble',
  pow: 'POW!',
};

export const BLOCK_FACE_P: Record<BlockFace, number> = {
  playerDown: 1 / 6,
  bothDown: 1 / 6,
  push: 2 / 6,
  stumble: 1 / 6,
  pow: 1 / 6,
};

// ---------------------------------------------------------------------------
// Dice sources. Rules code asks for a roll through a RollSpec: the list of
// dice and an `interpret` function that turns faces into everything the rules
// need. The rules code branches ONLY on the interpreted value; faces are used
// for the log. This lets the probability engine group faces that have the same
// effect and enumerate outcomes exactly with the very same rules code.
// ---------------------------------------------------------------------------

export interface RollSpec<T> {
  /** Sides of each die rolled, e.g. [6], [6, 6], [8, 8, 8]. */
  dice: number[];
  interpret: (faces: number[]) => T;
  /** Grouping key for the interpreted value (defaults to JSON). */
  key?: (value: T) => string;
  /** Outcome preferred by plan traces (the "planned success" path). */
  prefer?: (value: T) => boolean;
  /** Cache identifier for grouped outcomes (same dice & same interpretation). */
  cacheKey?: string;
  /** How the dice look (for dice trays and logs): Block dice or plain dice. */
  display?: 'block';
  /** Which coach makes this roll (logs; the team the `judge` speaks for unless `judgeFor` says otherwise). */
  by?: 'A' | 'B' | null;
  /**
   * V5.5 difficulty house rule: how good a result is for `judgeFor` (default `by`), from −1 (bad) to +1 (good);
   * 0 = neutral. Without a judge the roll is neutral and never tilted.
   */
  judge?: (value: T) => number;
  judgeFor?: 'A' | 'B' | null;
  /** Set by the engine context: relative weight of a face combination (house rule on); normalised over all of them. */
  weightOf?: ((faces: number[]) => number) | null;
  /** Older per-face D6 weights (no longer set by the engine; kept for callers that pass them). */
  weights?: number[] | null;
}

export interface RollResult<T> {
  faces: number[];
  value: T;
}

export interface ChoiceOutcome<T> {
  key: string;
  p: number;
  value: T;
}

export interface DiceSource {
  readonly mode: 'rng' | 'enumerate' | 'trace' | 'scripted';
  roll<T>(spec: RollSpec<T>): RollResult<T>;
  /**
   * Planning only: branch over a precomputed exact distribution (e.g. a whole
   * ball-bounce chain). Probabilities may sum to less than 1: the rest is
   * reported as unresolved.
   */
  choose<T>(outcomes: ChoiceOutcome<T>[], prefer?: (v: T) => boolean): T;
}

const noChoose = (): never => {
  throw new Error('choose() is only available while planning');
};

export class RngDice implements DiceSource {
  readonly mode = 'rng' as const;
  choose = noChoose;
  constructor(private rng: RngState) {}
  roll<T>(spec: RollSpec<T>): RollResult<T> {
    if (spec.weightOf) {
      // One draw over every face combination, weighted (difficulty house rule).
      const combos = allFaces(spec.dice);
      const ws = combos.map((f) => Math.max(0, spec.weightOf!(f)));
      const total = ws.reduce((a, b) => a + b, 0);
      const u = (nextU32(this.rng) / 4294967296) * total;
      let acc = 0;
      let pick = combos[combos.length - 1];
      for (let i = 0; i < combos.length; i++) {
        acc += ws[i];
        if (u < acc) {
          pick = combos[i];
          break;
        }
      }
      return { faces: pick.slice(), value: spec.interpret(pick.slice()) };
    }
    const w = spec.weights;
    const faces = spec.dice.map((sides) => (w && sides === 6 ? rollWeightedD6(this.rng, w) : rollDie(this.rng, sides)));
    return { faces, value: spec.interpret(faces) };
  }
}

/** Every face combination of a roll, in order (the last die changes fastest). */
export function allFaces(dice: number[]): number[][] {
  const total = dice.reduce((a, b) => a * b, 1);
  const out: number[][] = [];
  for (let n = 0; n < total; n++) {
    const f = dice.map(() => 1);
    let r = n;
    for (let i = dice.length - 1; i >= 0; i--) {
      f[i] = (r % dice[i]) + 1;
      r = Math.floor(r / dice[i]);
    }
    out.push(f);
  }
  return out;
}

/** Replays a fixed list of faces (used by tests). */
export class ScriptedDice implements DiceSource {
  readonly mode = 'scripted' as const;
  choose = noChoose;
  private i = 0;
  constructor(private faces: number[]) {}
  roll<T>(spec: RollSpec<T>): RollResult<T> {
    const faces = spec.dice.map(() => {
      if (this.i >= this.faces.length) throw new Error('ScriptedDice exhausted');
      return this.faces[this.i++];
    });
    return { faces, value: spec.interpret(faces) };
  }
  get used(): number {
    return this.i;
  }
}

export interface OutcomeGroup<T> {
  key: string;
  p: number;
  faces: number[];
  value: T;
}

const groupCache = new Map<string, OutcomeGroup<unknown>[]>();

export function groupOutcomes<T>(spec: RollSpec<T>): OutcomeGroup<T>[] {
  const keyOf = spec.key ?? ((v: T) => JSON.stringify(v));
  const w = spec.weights;
  // The pitch (standard / Sevens) is part of the key: scatter and bounce results depend on its size.
  // Weighted by the difficulty house rule: never cached (the weights depend on the situation).
  const cacheId = spec.cacheKey && !spec.weightOf ? `${pitchVariant()}|${spec.cacheKey}#${spec.dice.join(',')}${w ? `#w${w.map((x) => x.toFixed(6)).join(',')}` : ''}` : undefined;
  if (cacheId) {
    const c = groupCache.get(cacheId) as OutcomeGroup<T>[] | undefined;
    if (c) {
      // Guard against two different interpretations sharing a cache key: the
      // cached groups must re-interpret identically (cheap spot check).
      for (const g of c.length > 3 ? [c[0], c[c.length - 1]] : c) {
        if (keyOf(spec.interpret(g.faces.slice())) !== g.key) throw new Error(`Roll cache key collision: ${spec.cacheKey}`);
      }
      return c;
    }
  }
  const total = spec.dice.reduce((a, b) => a * b, 1);
  const map = new Map<string, OutcomeGroup<T>>();
  const faces = spec.dice.map(() => 1);
  for (let n = 0; n < total; n++) {
    let r = n;
    for (let i = spec.dice.length - 1; i >= 0; i--) {
      faces[i] = (r % spec.dice[i]) + 1;
      r = Math.floor(r / spec.dice[i]);
    }
    const value = spec.interpret(faces.slice());
    const k = keyOf(value);
    let pf = 1 / total;
    if (spec.weightOf) pf = Math.max(0, spec.weightOf(faces.slice())) / total;
    else if (w) {
      pf = 1;
      for (let i = 0; i < faces.length; i++) pf *= spec.dice[i] === 6 ? w[faces[i] - 1] : 1 / spec.dice[i];
    }
    const g = map.get(k);
    if (g) g.p += pf;
    else map.set(k, { key: k, p: pf, faces: faces.slice(), value });
  }
  const groups = [...map.values()];
  if (spec.weightOf) {
    const sum = groups.reduce((a, g) => a + g.p, 0);
    if (sum > 0) for (const g of groups) g.p /= sum;
  }
  if (cacheId) {
    if (groupCache.size > 5000) groupCache.clear();
    groupCache.set(cacheId, groups as OutcomeGroup<unknown>[]);
  }
  return groups;
}

export class PruneSignal {
  constructor(public p: number) {}
}

export interface EnumFrame {
  path: number[];
  p: number;
}

/**
 * Enumeration dice source: follows a forced prefix of outcome-group indices;
 * at each new random event it continues with the first group and pushes the
 * sibling groups onto the shared stack.
 */
export class EnumDice implements DiceSource {
  readonly mode = 'enumerate' as const;
  private i = 0;
  p: number;
  path: number[];
  /** V5.6: index of the next branch point (read-only; lets a decision hook record where in the path it branched). */
  get cursor(): number {
    return this.i;
  }
  constructor(frame: EnumFrame, private push: (f: EnumFrame) => void, private threshold: number, private onPruned: (p: number) => void) {
    this.path = frame.path.slice();
    this.p = frame.p;
  }
  private branch<T>(groups: Array<{ p: number; value: T }>, lost: number): T {
    if (this.i < this.path.length) {
      const g = groups[this.path[this.i++]];
      if (!g) throw new Error('Enumeration path mismatch');
      return g.value;
    }
    if (lost > 0) this.onPruned(this.p * lost);
    // continue with the most likely outcome, queue the others
    let best = 0;
    for (let j = 1; j < groups.length; j++) if (groups[j].p > groups[best].p) best = j;
    for (let j = 0; j < groups.length; j++) {
      if (j === best) continue;
      const pj = this.p * groups[j].p;
      if (pj >= this.threshold) this.push({ path: [...this.path, j], p: pj });
      else this.onPruned(pj);
    }
    this.p *= groups[best].p;
    this.path.push(best);
    this.i++;
    if (this.p < this.threshold) throw new PruneSignal(this.p);
    return groups[best].value;
  }
  roll<T>(spec: RollSpec<T>): RollResult<T> {
    const groups = groupOutcomes(spec);
    const g = this.branch(groups.map((x) => ({ p: x.p, value: x })), 0);
    return { faces: g.faces, value: g.value };
  }
  choose<T>(outcomes: ChoiceOutcome<T>[]): T {
    const total = outcomes.reduce((a, o) => a + o.p, 0);
    return this.branch(outcomes, Math.max(0, 1 - total));
  }
}

/** Trace source: follows the planned-success outcome of every roll. */
export class TraceDice implements DiceSource {
  readonly mode = 'trace' as const;
  choose<T>(outcomes: ChoiceOutcome<T>[], prefer?: (v: T) => boolean): T {
    const pool = prefer ? outcomes.filter((o) => prefer(o.value)) : [];
    const from = pool.length ? pool : outcomes;
    return from.reduce((a, b) => (b.p > a.p ? b : a)).value;
  }
  roll<T>(spec: RollSpec<T>): RollResult<T> {
    const groups = groupOutcomes(spec);
    const pool = spec.prefer ? groups.filter((x) => spec.prefer!(x.value)) : [];
    const from = pool.length ? pool : groups;
    const g = from.reduce((a, b) => (b.p > a.p ? b : a));
    return { faces: g.faces, value: g.value };
  }
}

// ---------------------------------------------------------------------------
// D6 test arithmetic (p.33; FAQ May 2026 p.33): a modified D6 result may not exceed 6 but CAN be below 1
// (e.g. natural 2 with -4 counts as -2); natural 1 always fails, natural 6 always succeeds.
// ---------------------------------------------------------------------------

/**
 * Rules-edition switch for D6 arithmetic. Matches started before the FAQ corrections keep the old lower bound of 1 so that their recorded
 * history replays exactly (it only matters for tests whose target is 1+). The engine entry points (execute, decide, planAction,
 * validateInput, actionOptions) set it from the state they are given; the engine is single-threaded per worker.
 */
let legacyD6Floor = false;
export function useD6Edition(s: { rulesEdition?: string }): void {
  legacyD6Floor = s.rulesEdition !== 'faq2026';
}

export function clampD6(n: number): number {
  // Upper cap only: the FAQ removed the lower bound of 1. Every test target is 2+ and a natural 1 fails regardless, so the
  // pass/fail outcome of ordinary tests is unchanged; the modified value itself (shown, compared with 1) is now exact.
  return Math.min(6, n);
}

export function d6Success(natural: number, target: number, modifier: number): boolean {
  if (natural === 1) return false;
  if (natural === 6) return true;
  const v = clampD6(natural + modifier);
  return (legacyD6Floor ? Math.max(1, v) : v) >= target;
}

export function d6SuccessProb(target: number, modifier: number): number {
  let n = 0;
  for (let f = 1; f <= 6; f++) if (d6Success(f, target, modifier)) n++;
  return n / 6;
}

/** Probability that 2D6 + modifier >= target. */
export function twoD6AtLeast(target: number, modifier = 0): number {
  let n = 0;
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (a + b + modifier >= target) n++;
  return n / 36;
}
