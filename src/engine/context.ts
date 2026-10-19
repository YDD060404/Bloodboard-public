import { allFaces, blockFace, DIFFICULTY_TILT, type DiceSource, type RollResult, type RollSpec } from './dice';
import type { BoardSnap, DecisionRecord, DecisionRequest, DiceRecord, GameEvent, GameState, RuleRef, TeamId } from './types';

/** Assumptions used to answer decisions when the engine explores outcomes. */
export interface Policy {
  /** Use Team (and Leader) Re-rolls on failed rolls while any remain. */
  useTeamRerolls: boolean;
  /** Use Pro when it is the only re-roll left (Pro 3+). */
  usePro: boolean;
  /** Use free skill re-rolls (Dodge, Sure Feet, Sure Hands, Catch, Pass). */
  useSkillRerolls: boolean;
  /** Follow-up after pushing the target. */
  followUp: boolean;
}

export const DEFAULT_POLICY: Policy = {
  useTeamRerolls: true,
  usePro: true,
  useSkillRerolls: true,
  followUp: true,
};

export class NeedDecision {
  constructor(public request: DecisionRequest) {}
}

/** Stops the current action after its consequences have been resolved. */
export class ActionStop {
  constructor(public reason: string) {}
}

export class IllegalAction extends Error {}

export interface Mod {
  label: string;
  value: number;
}

export interface StepRecord {
  kind: string;
  label: string;
  playerId?: string;
  /** Square where the roll happens (for drawing on the pitch). */
  at?: { x: number; y: number };
  dice: string;
  /** Target number (e.g. 4 for 4+) after listing modifiers separately. */
  target?: number;
  mods: Mod[];
  /**
   * Chance the first roll succeeds. `null` for a Block dice step: there is no
   * single success chance because the result depends on which die is chosen
   * (see PlanResult.block for the per-face breakdown).
   */
  pSingle: number | null;
  /** Re-roll sources that could be available at this step. */
  rerolls: string[];
  /** Chance with the best single re-roll available at this point. */
  pWithReroll?: number;
  onFail: string;
  rule: RuleRef;
  extra?: Record<string, unknown>;
  /** Whose roll it is: the active team or the opponent (e.g. an Interception). */
  by?: 'active' | 'opponent';
}

export type PolicyDecider = (req: DecisionRequest, ctx: Ctx) => string;

export class Ctx {
  events: GameEvent[] = [];
  steps: StepRecord[] = [];
  turnover: { reason: string; rule: RuleRef } | null = null;
  touchdown: { team: TeamId; playerId: string } | null = null;
  completed = false;
  /** Set once the team Turn has been ended in this run, so it is never ended twice. */
  turnEnded = false;
  /** Probability mass (conditional) lost inside exact sub-solvers; informational. */
  unresolvedExtra = 0;
  /**
   * Bloodlust failed during this input (p.125): a Pass or Hand-off that now
   * needs a Thrall bite without one adjacent is simply not made (the dice have
   * been rolled), instead of making the input illegal.
   */
  hungryNow = false;
  /** Guffle Pusmaw's Quick Bite took the ball during this input: it causes no Turnover (p.201). */
  quickBite = false;
  private seq = 0;
  private recordedIdx = 0;
  newDecisions: DecisionRecord[] = [];

  constructor(
    public s: GameState,
    public dice: DiceSource,
    public mode: 'execute' | 'plan',
    public recorded: DecisionRecord[],
    public policy: Policy,
    public decider: PolicyDecider | null,
  ) {}

  /** Dice rolled since the last event (execution only); attached to the next event. */
  private pendingDice: DiceRecord[] = [];

  emit(type: GameEvent['type'], text: string, rule?: RuleRef, data?: Record<string, unknown>): void {
    const e: GameEvent = { type, text };
    if (rule) e.rule = rule;
    if (data) e.data = data;
    if (this.mode === 'execute') {
      if (this.pendingDice.length) {
        e.dice = this.pendingDice;
        this.pendingDice = [];
      }
      e.snap = snapshot(this.s);
    }
    this.events.push(e);
  }

  roll<T>(spec: RollSpec<T>): RollResult<T> {
    // Optional difficulty house rule (V5.5, outcome-based): weight the results by how good they are for each side.
    const team = spec.judgeFor ?? spec.by;
    if (spec.judge && team) {
      const f = difficultyFactors(this.s, team);
      if (f) {
        const judge = spec.judge;
        const interpret = spec.interpret;
        spec = { ...spec, weightOf: (faces) => outcomeFactor(f, judge(interpret(faces))) };
      }
    }
    const r = this.dice.roll(spec);
    if (this.mode === 'execute') {
      if (spec.display === 'block') {
        this.pendingDice.push({ kind: 'block', faces: r.faces.slice(), block: r.faces.map(blockFace) });
      } else {
        // One record per run of same-sized dice (e.g. a kick's D8 direction + D6 distance = two records).
        spec.dice.forEach((sides, i) => {
          const kind: DiceRecord['kind'] = sides === 3 ? 'd3' : sides === 6 ? 'd6' : sides === 8 ? 'd8' : sides === 16 ? 'd16' : 'random';
          const last = this.pendingDice[this.pendingDice.length - 1];
          if (i > 0 && last && last.kind === kind && (kind !== 'random' || last.sides === sides)) last.faces.push(r.faces[i]);
          else this.pendingDice.push(kind === 'random' ? { kind, sides, faces: [r.faces[i]] } : { kind, faces: [r.faces[i]] });
        });
      }
    }
    return r;
  }

  /** Attach dice that were rolled but not yet reported to a final event. */
  flushDice(): void {
    if (this.pendingDice.length) this.emit('note', 'Dice rolled.');
  }

  /**
   * Ask a coach to decide. With a single option the answer is automatic.
   * In execute mode the answer comes from the recorded decisions (replay) or
   * the engine pauses (NeedDecision). In plan mode the policy decides.
   */
  ask(req: Omit<DecisionRequest, 'id'>): string {
    const id = `${this.seq++}:${req.type}`;
    const full: DecisionRequest = { ...req, id };
    if (full.options.length === 1) return full.options[0].id;
    if (this.mode === 'execute') {
      const rec = this.recorded[this.recordedIdx];
      if (!rec) throw new NeedDecision(full);
      if (rec.requestId !== id) throw new Error(`Decision replay mismatch: expected ${id}, got ${rec.requestId}`);
      this.recordedIdx++;
      const opt = full.options.find((o) => o.id === rec.optionId);
      if (!opt) throw new Error(`Invalid option ${rec.optionId} for ${id}`);
      this.newDecisions.push(rec);
      this.emit('decision', `${this.s.teams[full.team].name} coach: ${opt.label}`, full.rule, { requestId: id, option: opt.id, decisionType: full.type });
      return opt.id;
    }
    if (!this.decider) return full.options[0].id;
    return this.decider(full, this);
  }

  /** Record a step for plan traces (ignored during execution). */
  step(rec: StepRecord): void {
    if (this.mode === 'plan') this.steps.push(rec);
  }

  setTurnover(reason: string, rule: RuleRef): void {
    if (!this.turnover) {
      this.turnover = { reason, rule };
      this.emit('turnover', `Turnover: ${reason}`, rule);
    }
  }
}

/**
 * V5.5 difficulty house rule (outcome-based): the weights of results good / bad for `team`, or null for standard
 * dice. Only matches against the computer use it (match.options.computer: the computer's side at the start of the
 * match; difficulty.player / .computer: the human side's handicap and the computer side's boost, levels 0-3) —
 * practice positions, hot-seat and computer v computer matches always roll standard dice.
 */
export function difficultyFactors(s: GameState, team: TeamId | null | undefined): { good: number; bad: number } | null {
  const o = s.match?.options;
  if (!team || !o?.computer || !o.difficulty) return null;
  const lv = (n: number) => DIFFICULTY_TILT[Math.max(0, Math.min(3, Math.round(Number(n) || 0)))] ?? 0;
  const h = lv(o.difficulty.player);
  const c = lv(o.difficulty.computer);
  if (!h && !c) return null;
  // Results good for the human side ×(1 − h); results good for the computer side ×(1 + c).
  return team === o.computer.team ? { good: 1 + c, bad: 1 - h } : { good: 1 - h, bad: 1 + c };
}

/** Relative weight of a result worth `benefit` (−1…+1) to the team `f` belongs to. */
export function outcomeFactor(f: { good: number; bad: number }, benefit: number): number {
  const b = Math.max(-1, Math.min(1, Number(benefit) || 0));
  return b > 0 ? Math.pow(f.good, b) : b < 0 ? Math.pow(f.bad, -b) : 1;
}

/**
 * Face probabilities [P(1)…P(6)] of a D6 roll for `team` whose faces are judged by `good` (true / +1: good for the
 * team; false / −1: bad) — the same weights the match uses — or null for standard dice.
 */
export function testWeights(s: GameState, team: TeamId | null | undefined, good: (face: number) => boolean | number): number[] | null {
  const f = difficultyFactors(s, team);
  if (!f) return null;
  const raw = [1, 2, 3, 4, 5, 6].map((n) => {
    const g = good(n);
    return outcomeFactor(f, typeof g === 'number' ? g : g ? 1 : -1);
  });
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((x) => x / sum);
}

/** P(event) for a roll of `dice` for `team`, judged by `judge(faces)` (the event: `hit(faces)`), under the house rule. */
export function tiltedChance(s: GameState, team: TeamId | null | undefined, dice: number[], hit: (faces: number[]) => boolean, judge: (faces: number[]) => number): number {
  const f = difficultyFactors(s, team);
  let num = 0;
  let den = 0;
  for (const faces of allFaces(dice)) {
    const w = f ? outcomeFactor(f, judge(faces)) : 1;
    den += w;
    if (hit(faces)) num += w;
  }
  return den ? num / den : 0;
}

/**
 * Worked examples of the difficulty house rule at levels `player` (the human side's handicap) and `computer` (the
 * computer side's boost): the chance of each result as the match rolls it, for a roll made by / against each side.
 */
export function difficultyExamples(player: number, computer: number): Array<{ what: string; standard: number; human: number; computer: number }> {
  const s = { match: { options: { computer: { team: 'B' }, difficulty: { player, computer } } } } as unknown as GameState;
  const test = (x: number) => (f: number[]) => f[0] >= x;
  const judgeOf = (hit: (f: number[]) => boolean) => (f: number[]) => (hit(f) ? 1 : -1);
  const row = (what: string, dice: number[], hit: (f: number[]) => boolean) => ({ what, standard: tiltedChance({} as GameState, 'A', dice, hit, () => 0), human: tiltedChance(s, 'A', dice, hit, judgeOf(hit)), computer: tiltedChance(s, 'B', dice, hit, judgeOf(hit)) });
  // Two Block dice, the attacker chooses, no skills: the worst case is only Player Down / Both Down (a Turnover).
  const faceV = (n: number) => (n === 1 ? -1 : n === 2 ? -0.5 : n <= 4 ? 0.33 : 1);
  const bad2 = (f: number[]) => f[0] <= 2 && f[1] <= 2;
  const block = { what: 'Two Block dice, the attacker chooses: only Player Down / Both Down (no Block skill)', standard: tiltedChance({} as GameState, 'A', [6, 6], bad2, () => 0), human: tiltedChance(s, 'A', [6, 6], bad2, (f) => Math.max(faceV(f[0]), faceV(f[1]))), computer: tiltedChance(s, 'B', [6, 6], bad2, (f) => Math.max(faceV(f[0]), faceV(f[1]))) };
  return [row('A 4+ test (Dodge, Pick-up…) succeeds', [6], test(4)), row('A 2+ test (Rush, Pro 3+ aside) succeeds', [6], test(2)), row('Armour Roll 9+ breaks (made against the other side)', [6, 6], (f) => f[0] + f[1] >= 9), block];
}

/** Older name (V4-V5): the face weights of a success-good D6 test for `team`, 4+ as the reference test. */
export function d6WeightsFor(s: GameState, team: TeamId | null | undefined): number[] | null {
  return testWeights(s, team, (n) => n >= 4);
}

export function snapshot(s: GameState): BoardSnap {
  return {
    players: s.players.map((p) => [p.id, p.pos ? p.pos.x : -1, p.pos ? p.pos.y : -1, p.stance, p.location]),
    ball: JSON.parse(JSON.stringify(s.ball)),
  };
}
