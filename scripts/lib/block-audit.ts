/**
 * Block-dice audit helpers, shared by tests/dice-audit.test.ts (moderate
 * samples, assertions) and scripts/audit-block-dice.ts (large samples, report
 * in docs/BLOCK_DICE_AUDIT.md).
 *
 * Everything is reproducible: the engine's RNG is counter-based, so a seed
 * list fully determines every die in the audit.
 */
import { makeDecider } from '../../src/engine/planner';
import { DEFAULT_POLICY } from '../../src/engine/context';
import { blockFace, nextU32, rollDie, type BlockFace } from '../../src/engine/dice';
import { customPlayer, decide, execute, newGame, planAction, startPlay, type ExecutionResult, type GameState, type PlayerActionInput } from '../../src/engine/index';

export const FACES: BlockFace[] = ['playerDown', 'bothDown', 'push', 'stumble', 'pow'];
export const FACE_P: Record<BlockFace, number> = { playerDown: 1 / 6, bothDown: 1 / 6, push: 2 / 6, stumble: 1 / 6, pow: 1 / 6 };

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

function lnGamma(z: number): number {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/** Regularized upper incomplete gamma Q(a, x). */
function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x < a + 1) {
    let sum = 1 / a;
    let del = sum;
    let ap = a;
    for (let n = 0; n < 1000; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
    }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
  }
  let b = x + 1 - a;
  let c = 1 / 1e-300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}

export interface ChiSquare {
  n: number;
  statistic: number;
  df: number;
  pValue: number;
}

/** Pearson chi-square goodness of fit of `counts` against probabilities `p`. */
export function chiSquare(counts: number[], p: number[]): ChiSquare {
  const n = counts.reduce((a, b) => a + b, 0);
  let stat = 0;
  counts.forEach((c, i) => {
    const e = n * p[i];
    stat += ((c - e) * (c - e)) / e;
  });
  const df = counts.length - 1;
  return { n, statistic: stat, df, pValue: gammaQ(df / 2, stat / 2) };
}

// ---------------------------------------------------------------------------
// 1-3: the raw generator and the face mapping
// ---------------------------------------------------------------------------

/** D6 faces from many seeds, `perSeed` consecutive dice each. */
export function rawD6(seeds: number[], perSeed: number): number[] {
  const counts = [0, 0, 0, 0, 0, 0];
  for (const seed of seeds) {
    const rng = { seed, counter: 0 };
    for (let i = 0; i < perSeed; i++) counts[rollDie(rng, 6) - 1]++;
  }
  return counts;
}

/** The first die rolled after loading each seed (what "replaying a seed" shows first). */
export function firstDiePerSeed(seeds: number[]): number[] {
  const counts = [0, 0, 0, 0, 0, 0];
  for (const seed of seeds) counts[rollDie({ seed, counter: 0 }, 6) - 1]++;
  return counts;
}

/** Block faces produced by the engine's face mapping from raw dice. */
export function blockFacesFromRaw(seeds: number[], perSeed: number): Record<BlockFace, number> {
  const out: Record<BlockFace, number> = { playerDown: 0, bothDown: 0, push: 0, stumble: 0, pow: 0 };
  for (const seed of seeds) {
    const rng = { seed, counter: 0 };
    for (let i = 0; i < perSeed; i++) out[blockFace(rollDie(rng, 6))]++;
  }
  return out;
}

/** Consecutive pairs (as rolled for a 2-dice block): 36 cells. */
export function pairs(seeds: number[], perSeed: number): number[] {
  const cells = new Array(36).fill(0);
  for (const seed of seeds) {
    const rng = { seed, counter: 0 };
    for (let i = 0; i < perSeed; i++) {
      const a = rollDie(rng, 6);
      const b = rollDie(rng, 6);
      cells[(a - 1) * 6 + (b - 1)]++;
    }
  }
  return cells;
}

/** Share of 32-bit draws rejected by the unbiased sampler (should be ~0). */
export function rejectionRate(seed: number, n: number): number {
  const limit = Math.floor(4294967296 / 6) * 6;
  const rng = { seed, counter: 0 };
  let rej = 0;
  for (let i = 0; i < n; i++) if (nextU32(rng) >= limit) rej++;
  return rej / n;
}

// ---------------------------------------------------------------------------
// 4: real Block actions through the engine
// ---------------------------------------------------------------------------

export type Scenario = '1D' | '2D' | '-2D' | '3D' | '-3D';

export const SCENARIOS: Array<{ id: Scenario; label: string }> = [
  { id: '1D', label: 'ST 3 v 3 (1 die)' },
  { id: '2D', label: 'ST 4 v 3 (2 dice, attacker chooses)' },
  { id: '-2D', label: 'ST 3 v 4 (2 dice, defender chooses)' },
  { id: '3D', label: 'ST 7 v 3 (3 dice, attacker chooses)' },
  { id: '-3D', label: 'ST 3 v 7 (3 dice, defender chooses)' },
];

/** Attacker A1 blocks defender B1 in open field; no skills, no re-rolls. */
export function scenarioState(sc: Scenario, seed: number): GameState {
  const s = newGame({ a: { name: 'Attackers', roster: 'human' }, b: { name: 'Defenders', roster: 'orc' }, seed });
  s.teams.A.turn = 3;
  s.teams.B.turn = 2;
  s.teams.A.rerolls = 0;
  s.teams.B.rerolls = 0;
  const stA = sc === '2D' ? 4 : sc === '3D' ? 7 : 3;
  const stB = sc === '-2D' ? 4 : sc === '-3D' ? 7 : 3;
  const a = customPlayer(s, 'A', { position: 'Lineman', ma: 6, st: stA, ag: 3, pa: 4, av: 9, skills: [] } as never, { x: 10, y: 7 });
  a.id = 'A1';
  const b = customPlayer(s, 'B', { position: 'Lineman', ma: 6, st: stB, ag: 3, pa: 4, av: 9, skills: [] } as never, { x: 11, y: 7 });
  b.id = 'B1';
  s.players.push(a, b);
  s.ball = { kind: 'ground', pos: { x: 2, y: 2 } };
  return startPlay(s);
}

export const BLOCK_INPUT: PlayerActionInput = { kind: 'playerAction', playerId: 'A1', action: 'block', path: [], blockTarget: 'B1' };

export interface BlockSample {
  /** Every block die rolled (the original pool; there are no re-rolls here). */
  faceCounts: Record<BlockFace, number>;
  dice: number;
  /** Result chosen by the coach (policy stated in the preview), as rolled. */
  chosenCounts: Record<BlockFace, number>;
  /** Chosen result after Stumble is resolved (no Dodge here, so Stumble counts as POW). */
  effectiveCounts: Record<string, number>;
  blocks: number;
  /** Consistency problems between the dice record, the log text and the chosen result. */
  mismatches: string[];
  /** Dice records of another kind found in the block-dice event (should be none). */
  foreignDice: number;
  /** Exact distribution of the chosen result under the same policy (from planAction). */
  expectedChosen: Record<string, number>;
}

const LABEL: Record<BlockFace, string> = { playerDown: 'Player Down', bothDown: 'Both Down', push: 'Push Back', stumble: 'Stumble', pow: 'POW!' };

export function sampleBlocks(sc: Scenario, seeds: number[]): BlockSample {
  const decider = makeDecider({ ...DEFAULT_POLICY, followUp: false });
  const faceCounts: Record<BlockFace, number> = { playerDown: 0, bothDown: 0, push: 0, stumble: 0, pow: 0 };
  const chosenCounts: Record<BlockFace, number> = { playerDown: 0, bothDown: 0, push: 0, stumble: 0, pow: 0 };
  const effectiveCounts: Record<string, number> = {};
  const mismatches: string[] = [];
  let foreignDice = 0;
  let dice = 0;
  const plan = planAction(scenarioState(sc, 1), BLOCK_INPUT, { followUp: false });
  const expectedChosen = plan.block?.chosen ?? {};
  for (const seed of seeds) {
    let res: ExecutionResult = execute(scenarioState(sc, seed), BLOCK_INPUT);
    let guard = 0;
    while (res.status === 'awaitingDecision' && res.decision) {
      if (guard++ > 20) throw new Error('decision loop');
      const opt = decider(res.decision, { s: res.state, steps: [] } as never);
      res = decide(res.state, { requestId: res.decision.id, optionId: opt });
    }
    if (res.status === 'illegal') throw new Error(res.error);
    const evs = res.events;
    const poolEv = evs.find((e) => e.type === 'roll' && e.text.startsWith('Block dice:'));
    const resultEv = evs.find((e) => e.type === 'block' && e.text.startsWith('Result:'));
    if (!poolEv || !resultEv) {
      mismatches.push(`seed ${seed}: missing block events`);
      continue;
    }
    const rec = (poolEv.dice ?? []).filter((d) => d.kind === 'block');
    foreignDice += (poolEv.dice ?? []).length - rec.length;
    if (rec.length !== 1) {
      mismatches.push(`seed ${seed}: expected one block-dice record, found ${rec.length}`);
      continue;
    }
    const faces = rec[0].block as BlockFace[];
    faces.forEach((f, i) => {
      faceCounts[f]++;
      if (blockFace(rec[0].faces[i]) !== f) mismatches.push(`seed ${seed}: face ${rec[0].faces[i]} shown as ${f}`);
    });
    dice += faces.length;
    // The log text lists the same multiset of results.
    const logged = poolEv.text.replace(/^Block dice: /, '').replace(/\.$/, '').split(' / ');
    const shown = faces.map((f) => LABEL[f]);
    if (logged.slice().sort().join('|') !== shown.slice().sort().join('|')) mismatches.push(`seed ${seed}: log "${poolEv.text}" vs dice ${shown.join(', ')}`);
    const chosen = (resultEv.data?.result ?? '') as BlockFace;
    if (!faces.includes(chosen)) mismatches.push(`seed ${seed}: chosen ${chosen} is not among the dice ${faces.join(',')}`);
    chosenCounts[chosen]++;
    const eff = String(resultEv.data?.effective ?? chosen);
    effectiveCounts[eff] = (effectiveCounts[eff] ?? 0) + 1;
  }
  return { faceCounts, dice, chosenCounts, effectiveCounts, blocks: seeds.length, mismatches, foreignDice, expectedChosen };
}

/** Deterministic list of seeds (seed = start, start + step, ...). */
export function seedList(n: number, start = 1, step = 7919): number[] {
  return Array.from({ length: n }, (_, i) => (start + i * step) >>> 0);
}
