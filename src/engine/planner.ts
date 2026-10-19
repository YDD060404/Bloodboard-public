import { usePitch } from './variant';
import { actionOptions, declarationReason, findOption } from './actions';
import { runInput } from './actions';
import { eq, fmt, passRange, RANGE_LABEL } from './board';
import { blockFaceValue } from './block';
import { Ctx, DEFAULT_POLICY, IllegalAction, NeedDecision, difficultyFactors, outcomeFactor, testWeights, type Policy, type PolicyDecider, type StepRecord } from './context';
import { BLOCK_FACE_LABEL, BLOCK_FACE_P, EnumDice, PruneSignal, TraceDice, d6AtLeastW, d6Success, d6SuccessProbW, groupOutcomes, type BlockFace, type ChoiceOutcome, type DiceSource, type EnumFrame, type RollResult, type RollSpec } from './dice';
import { starReady, starTestBonus } from './stars';
import { wizardReason } from './wizard';
import { biteTargetAdjacent } from './traits';
import { isMatchInput, matchInputReason } from './match';
import { interceptMods, interceptors, passInfo } from './pass';
import { modSum } from './roll';
import { canUse, cloneState, findPlayer, getPlayer, hasSkill, label, markersOf } from './state';
import type { ActionInput, Coord, DecisionRequest, GameEvent, GameState, Player, PlayerActionInput, TeamId } from './types';

export interface PlanOptions {
  /** Probability threshold below which branches are not explored (their mass is reported). */
  threshold?: number;
  /** Maximum number of explored outcome paths per policy. */
  maxLeaves?: number;
  followUp?: boolean;
}

export interface OutcomeSummary {
  /** Probability mass explored exactly. */
  explored: number;
  /** Probability mass not explored (pruned) — shown as uncertainty, never guessed. */
  unresolved: number;
  leaves: number;
  pCompleted: number;
  pTurnover: number;
  pTouchdownActive: number;
  pTouchdownOpp: number;
  pActorDown: number;
  pActorRemoved: number;
  pActorFell: number;
  pTargetDown: number;
  pTargetRemoved: number;
  pTargetKO: number;
  pTargetCas: number;
  pTargetArmourBroken: number;
  pTargetPushed: number;
  pTargetCrowd: number;
  /** Multiple Block (p.132): the second target is Knocked Down / off the pitch. */
  pTarget2Down: number;
  pIntercepted: number;
  pActiveHasBall: number;
  pOppHasBall: number;
  pBallGround: number;
  pBallWithReceiver: number;
  pBallWithActor: number;
  blockResult: Record<string, number>;
  passResult: Record<string, number>;
  /** Where the acting player falls (square key -> probability). */
  fallSquares: Record<string, number>;
  /** Branches in which the planned input became illegal (message -> probability). Must be empty for a valid plan. */
  illegal: Record<string, number>;
}

export interface BlockAnalysis {
  dice: number;
  chooser: 'attacker' | 'defender';
  attST: number;
  defST: number;
  offAssists: number;
  defAssists: number;
  /** P(at least one die shows face), single roll. */
  atLeastOne: Record<BlockFace, number>;
  /** P(the chosen result is X) with the chooser picking by the stated preference, no re-roll. */
  chosen: Record<string, number>;
  faceNotes: Record<BlockFace, string>;
}

export interface PassAnalysis {
  range: string;
  target: Coord;
  pa: number;
  mods: { label: string; value: number }[];
  pAccurate: number;
  pInaccurate: number;
  pFumble: number;
  interceptorsIfAccurate: { id: string; label: string; p: number }[];
  hailMary: boolean;
}

export interface PlanResult {
  ok: boolean;
  errors: string[];
  input: ActionInput;
  steps: StepRecord[];
  withTeamRerolls: OutcomeSummary | null;
  withoutTeamRerolls: OutcomeSummary | null;
  assumptions: string[];
  block?: BlockAnalysis;
  pass?: PassAnalysis;
  /** Final square of the mover if everything succeeds. */
  finalSquare?: Coord;
  /** Trace events along the planned-success path (for a textual preview). */
  traceEvents: GameEvent[];
  teamRerollsAvailable: number;
  /**
   * V5.5 Bloodlust (p.125): another player's activation is still open and hungry, and this Action would end it
   * first. `turnover` = no Thrall is next to that player, so ending it is a Turnover and this Action is not taken
   * (the plan is then not ok: end that activation, or move that player next to a Thrall, instead).
   */
  endsHungry?: { playerId: string; turnover: boolean; text: string };
}

// ---------------------------------------------------------------------------
// Decision policy used to explore outcomes (stated to the user as assumptions)
// ---------------------------------------------------------------------------

function faceScore(face: BlockFace, att: Player, def: Player, isBlitz: boolean): number {
  let f = face;
  if (f === 'stumble') f = canUse(def, 'dodge') && !canUse(att, 'tackle') ? 'push' : 'pow';
  switch (f) {
    case 'pow':
      return 3;
    case 'push':
      return 1;
    case 'playerDown':
      return -3;
    case 'bothDown': {
      const attUp = canUse(att, 'block');
      const defUp = canUse(def, 'block');
      let sc: number;
      if (attUp && !defUp) sc = 3;
      else if (attUp && defUp) sc = 0;
      else if (!attUp && !defUp) sc = canUse(att, 'wrestle') ? 0.5 : -1.5;
      else sc = canUse(att, 'wrestle') ? 0 : -3;
      if (isBlitz && canUse(att, 'juggernaut')) sc = Math.max(sc, 1);
      return sc;
    }
    default:
      return 0;
  }
}

/**
 * The chance of an Interception attempt as the match resolves it: Scrappa Sorehead's Yoink! (D6 2+ first, then the
 * normal roll), Griff Oberwald's +1 after the roll (once per game each).
 */
function interceptChance(ctx: Ctx, q: Player, accurate: boolean): number {
  const s = ctx.s;
  const mod = modSum(interceptMods(ctx, q, accurate));
  const sb = starTestBonus(s, q, 'intercept');
  const ok = (f: number) => d6Success(f, q.ag, mod) || (!!sb && d6Success(f, q.ag, mod + sb.value));
  const w = testWeights(s, q.team, ok);
  let pr = 0;
  for (let f = 1; f <= 6; f++) if (ok(f)) pr += w ? w[f - 1] : 1 / 6;
  if (starReady(s, q, 'scrappa')) {
    const y = d6AtLeastW(2, testWeights(s, q.team, (f) => f >= 2));
    pr = y + (1 - y) * pr;
  }
  return pr;
}

export function makeDecider(policy: Policy) {
  return (req: DecisionRequest, ctx: Ctx): string => {
    const ids = req.options.map((o) => o.id);
    const has = (id: string) => ids.includes(id);
    const s = ctx.s;
    switch (req.type) {
      case 'reroll': {
        if (req.context && req.context.kind === 'blockDice') {
          const pool = req.context.pool as BlockFace[];
          const act = s.turn.activation;
          const att = findPlayer(s, req.context.attacker as string);
          const def = findPlayer(s, req.context.defender as string);
          if (!att || !def) return 'none';
          const isBlitz = act?.action === 'blitz';
          const scores = pool.map((f) => faceScore(f, att, def, isBlitz));
          const chooserAtt = req.context.chooser === 'attacker';
          const result = chooserAtt ? Math.max(...scores) : Math.min(...scores);
          if (result >= 0) return 'none';
          if (policy.useSkillRerolls && has('veteran')) return 'veteran';
          if (policy.useTeamRerolls && has('team')) return 'team';
          if (policy.useTeamRerolls && has('leader')) return 'leader';
          if (policy.useTeamRerolls && has('mascot')) return 'mascot';
          const worst = pool[scores.indexOf(Math.min(...scores))];
          // Star Player re-rolls (pp.195-211): Anqi Panqi re-rolls every bad die; the others one die.
          if (chooserAtt) {
            const bad = pool.filter((f, i) => scores[i] < 0).sort();
            if (bad.length && has(`anqi:${bad.join('+')}`)) return `anqi:${bad.join('+')}`;
          }
          if (has(`star1:${worst}`)) return `star1:${worst}`;
          if (has('brawler') && worst === 'bothDown') return 'brawler';
          if (has('hatred') && worst === 'playerDown') return 'hatred';
          if (policy.usePro && has(`pro:${worst}`)) return `pro:${worst}`;
          return 'none';
        }
        if (policy.useSkillRerolls && has('skill')) return 'skill';
        if (policy.useSkillRerolls && has('star')) return 'star';
        if (policy.usePro && has('pro')) return 'pro';
        if (policy.useSkillRerolls && has('veteran')) return 'veteran';
        if (policy.useTeamRerolls && has('team')) return 'team';
        if (policy.useTeamRerolls && has('leader')) return 'leader';
        if (policy.useTeamRerolls && has('mascot')) return 'mascot';
        return 'none';
      }
      case 'blockDie': {
        const attId = req.context?.attacker as string;
        const defId = req.context?.defender as string;
        const att = findPlayer(s, attId);
        const def = findPlayer(s, defId);
        if (!att || !def) return ids[0];
        const isBlitz = s.turn.activation?.action === 'blitz';
        const pref: Record<string, number> = { pow: 0.03, stumble: 0.02, bothDown: 0.01, push: 0, playerDown: 0 };
        const attChooses = req.team === att.team;
        const scored = req.options.map((o) => ({ id: o.id, sc: faceScore(o.id as BlockFace, att, def, isBlitz) + (attChooses ? pref[o.id] ?? 0 : -(pref[o.id] ?? 0)) }));
        scored.sort((a, b) => (attChooses ? b.sc - a.sc : a.sc - b.sc));
        return scored[0].id;
      }
      case 'followUp':
        return policy.followUp ? 'yes' : 'no';
      // Sevens Desperate Measures: previews assume the opponent keeps a Banana Skin; a team's own choices are asked.
      case 'desperate':
        if (req.context?.measure === 'youDopeStat') return 'st';
        if (req.context?.measure === 'sportsEspionage') return 'use';
        return has('no') ? 'no' : ids[0];
      case 'standFirm':
      case 'fend':
      case 'stripBall':
        return has('yes') ? 'yes' : ids[0];
      case 'taunt':
        return 'no';
      case 'wrestle': {
        const act = s.turn.activation;
        const att = act ? findPlayer(s, act.playerId) : undefined;
        if (!att) return 'no';
        if (req.team === att.team) return canUse(att, 'block') ? 'no' : 'yes';
        // defender: use it if they would go down while the attacker stays up
        return canUse(att, 'block') ? 'yes' : 'no';
      }
      case 'juggernaut': {
        const act = s.turn.activation;
        const att = act ? findPlayer(s, act.playerId) : undefined;
        return att && canUse(att, 'block') ? 'both' : 'push';
      }
      case 'mightyBlow':
      case 'armBar':
      case 'dirtyPlayer':
      case 'lethalFlight':
        if (has('armour')) return req.context?.breaks ? 'armour' : 'save';
        return has('use') ? 'use' : ids[0];
      case 'interceptor': {
        const cands = req.options.filter((o) => o.id !== 'none');
        if (!cands.length) return 'none';
        const accurate = req.context?.accurate !== false;
        let best = cands[0].id;
        let bestP = -1;
        for (const o of cands) {
          const q = findPlayer(s, o.id);
          if (!q) continue;
          const pr = interceptChance(ctx, q, accurate);
          if (pr > bestP) {
            bestP = pr;
            best = o.id;
          }
        }
        return best;
      }
      case 'divingTackle':
      case 'tentacles':
      case 'shadowing':
        return ids.find((i) => i !== 'none') ?? 'none';
      case 'breakTackle':
        return 'use';
      case 'hitAndRun':
        return 'stay';
      case 'skill':
        // Sidestep / Grab usage: the defender uses Sidestep; the attacker does not use Grab.
        return req.context?.skill === 'sidestep' ? 'yes' : 'no';
      case 'safePairOfHands':
        return ids[0];
      case 'starRule':
        // Barik Farblast's Blast It!: the re-roll computed with the exact ball chains (ball.ts blastItBest).
        if (req.context?.star === 'barik' && typeof req.context.best === 'string' && has(req.context.best)) return req.context.best;
        // Zzharg Madeye's D6 2: the other coach picks who is hit — one of Zzharg's team (lowest AV) if they can,
        // otherwise their own player least likely to be hurt (highest AV).
        if (req.context?.star === 'zzharg' && req.context.pick) {
          const pl = req.options.map((o) => findPlayer(s, o.id)).filter((x): x is Player => !!x);
          const theirs = pl.filter((x) => x.team !== req.team).sort((a, b) => a.av - b.av);
          const ours = pl.filter((x) => x.team === req.team).sort((a, b) => b.av - a.av);
          return (theirs[0] ?? ours[0])?.id ?? ids[0];
        }
        // Swiftvine Glimmershard's squares: where the fewest opponents Mark her (the first such square).
        if (req.context?.star === 'swiftvine' && req.context.pick) {
          const sv = s.players.find((x) => x.star === 'swiftvine' && x.team === req.team && x.location === 'pitch');
          let best = ids[0];
          let bestN = Infinity;
          for (const o of req.options) {
            const sq = o.square ?? (o.id === 'stay' ? sv?.pos ?? undefined : undefined);
            if (!sq) continue;
            const n = markersOf(s, sq, req.team).filter((x) => x.id !== sv?.id).length;
            if (n < bestN) {
              bestN = n;
              best = o.id;
            }
          }
          return best;
        }
        // Star Player special rules: used when it helps (see stars.ts askStar); applied to the Armour Roll only when that breaks it.
        if (has('armour')) return req.context?.breaks ? 'armour' : has('save') ? 'save' : 'no';
        if (has('use')) return req.context?.helps ? 'use' : has('no') ? 'no' : ids[ids.length - 1];
        return ids[0];
      default:
        return ids[0];
    }
  };
}

export const POLICY_ASSUMPTIONS = [
  'Re-rolls: a failed roll is re-rolled with a skill first (Dodge, Sure Feet, Sure Hands, Catch, Pass), then Pro, then a Team/Leader Re-roll (when that column allows team re-rolls). You still choose every re-roll during execution.',
  'Block dice: the choosing coach takes the result that is best for them (knock-down without falling > push > nothing > both down > player down), taking Block, Dodge, Tackle, Wrestle and Juggernaut into account. The attacker re-rolls block dice only when every result is bad for them.',
  'Pushes: the first listed push square is assumed (you pick the real one during execution). The defender uses Stand Firm, Fend and Sidestep; Taunt is not used.',
  'Mighty Blow / Arm Bar: applied to the Armour Roll only if that breaks the armour, otherwise to the Injury Roll.',
  'Opponents always use Diving Tackle, Tentacles and Shadowing when able, and always attempt the most likely Interception.',
  'Casualty and Regeneration rolls are not explored in previews: they do not change anything else during the Turn.',
  'Fouls: a Sent-off fouler always Argues the Call; Dirty Player is used like Mighty Blow; Lone Fouler re-rolls a failed Armour Roll.',
  'Targets of a Block: previews assume Trickster and Dump-off are not used and Saboteur is always rolled; Pile Driver is not used (you choose during execution).',
  'On the Ball: previews of a Pass assume the opponents do not move with On the Ball (if they do, the Passing modifiers are recomputed before the roll).',
  'Throw Team-mate: previews assume a thrown player with Swoop Scatters as normal; Lethal Flight is used like Mighty Blow. A Punt with Kick is not re-rolled.',
  'Throw Bomb: outcomes less likely than 1 in 10,000 are not explored (shown as not explored); a player who catches the bomb throws it at the square worst for the other team.',
  'Star Players: a rule that helps is used (Griff\'s +1 after the roll, Puggy\'s / Ripper\'s re-roll after the skill re-rolls, Guffle\'s Quick Bite after a catch next to him, the ball chains included); Barik\'s Blast It! re-rolls the scatter dice that give his team the best chance of ending with the ball.',
];

// ---------------------------------------------------------------------------
// Enumeration
// ---------------------------------------------------------------------------

interface Leaf {
  p: number;
  ctx: Ctx;
  /** V5.6: the enumerator's branch path to this leaf (dice groups and, with a decision hook, decision options). */
  path: number[];
}

function stripped(s: GameState): GameState {
  return cloneState({ ...s, log: [], pending: null });
}

/** Max-heap of frames by probability: most likely outcome paths are explored first. */
class FrameHeap {
  private a: EnumFrame[] = [];
  get size() {
    return this.a.length;
  }
  push(f: EnumFrame) {
    const a = this.a;
    a.push(f);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].p >= a[i].p) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): EnumFrame | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop() as EnumFrame;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].p > a[m].p) m = l;
        if (r < a.length && a[r].p > a[m].p) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
  mass(): number {
    return this.a.reduce((s, f) => s + f.p, 0);
  }
}

function enumerate(
  base: GameState,
  input: ActionInput,
  policy: Policy,
  threshold: number,
  maxLeaves: number,
  onLeaf: (l: Leaf) => void,
  wrapDecider?: (base: PolicyDecider) => PolicyDecider,
): { unresolved: number; unresolvedTurnover: number; leaves: number; explored: number; illegal: Record<string, number> } {
  const illegal: Record<string, number> = {};
  const heap = new FrameHeap();
  heap.push({ path: [], p: 1 });
  let unresolved = 0;
  // Part of the unexplored mass whose branch had already suffered a Turnover when it was cut
  // (typically the fine detail of the Armour / Injury Rolls of a player who fell).
  let unresolvedTurnover = 0;
  let leaves = 0;
  let explored = 0;
  const decider = wrapDecider ? wrapDecider(makeDecider(policy)) : makeDecider(policy);
  const pushFrame = (f: EnumFrame) => heap.push(f);
  let cur: Ctx | null = null;
  const active = base.turn.active;
  const turnedOver = (c: Ctx | null) => !!c && !!c.turnover && c.touchdown?.team !== active;
  const pruned = (pp: number) => {
    unresolved += pp;
    if (turnedOver(cur)) unresolvedTurnover += pp;
  };
  while (heap.size) {
    if (leaves >= maxLeaves) {
      unresolved += heap.mass();
      break;
    }
    const frame = heap.pop() as EnumFrame;
    const work = cloneState(base);
    const src = new EnumDice(frame, pushFrame, threshold, pruned);
    const ctx = new Ctx(work, src, 'plan', [], policy, decider);
    cur = ctx;
    try {
      runInput(ctx, input, { preview: true });
    } catch (e) {
      if (e instanceof PruneSignal) {
        unresolved += e.p;
        if (turnedOver(ctx)) unresolvedTurnover += e.p;
        continue;
      }
      if (e instanceof IllegalAction || e instanceof NeedDecision) {
        // A branch in which the input becomes illegal: never estimated; reported as an error.
        unresolved += src.p;
        const msg = e instanceof IllegalAction ? e.message : 'an unanswered decision';
        illegal[msg] = (illegal[msg] ?? 0) + src.p;
        continue;
      }
      throw e;
    }
    leaves++;
    explored += src.p;
    onLeaf({ p: src.p, ctx, path: src.path.slice() });
  }
  return { unresolved, unresolvedTurnover, leaves, explored, illegal };
}

function emptySummary(): OutcomeSummary {
  return {
    explored: 0,
    unresolved: 0,
    leaves: 0,
    pCompleted: 0,
    pTurnover: 0,
    pTouchdownActive: 0,
    pTouchdownOpp: 0,
    pActorDown: 0,
    pActorRemoved: 0,
    pActorFell: 0,
    pTargetDown: 0,
    pTargetRemoved: 0,
    pTargetKO: 0,
    pTargetCas: 0,
    pTargetArmourBroken: 0,
    pTargetPushed: 0,
    pTargetCrowd: 0,
    pTarget2Down: 0,
    pIntercepted: 0,
    pActiveHasBall: 0,
    pOppHasBall: 0,
    pBallGround: 0,
    pBallWithReceiver: 0,
    pBallWithActor: 0,
    blockResult: {},
    passResult: {},
    fallSquares: {},
    illegal: {},
  };
}

function summarise(base: GameState, input: ActionInput, policy: Policy, opts: Required<PlanOptions>): OutcomeSummary {
  const sum = emptySummary();
  const active = base.turn.active;
  const pi = input.kind === 'playerAction' ? input : null;
  const actorId = pi?.playerId;
  const targetId = pi?.blockTarget ?? pi?.foulTarget ?? pi?.specialTarget ?? pi?.vomitTarget ?? pi?.handoffTarget;
  const receiverAt = pi?.passTarget;
  const baseReceiver = receiverAt ? base.players.find((q) => q.location === 'pitch' && q.pos && eq(q.pos, receiverAt)) : pi?.handoffTarget ? findPlayer(base, pi.handoffTarget) : undefined;
  const r = enumerate(base, input, policy, opts.threshold, opts.maxLeaves, ({ p, ctx }) => {
    const s = ctx.s;
    if (ctx.completed || ctx.touchdown?.team === active) sum.pCompleted += p;
    // A Touchdown also ends the Turn, but it is reported separately, not as a Turnover.
    if (ctx.turnover && ctx.touchdown?.team !== active) sum.pTurnover += p;
    if (ctx.touchdown) {
      if (ctx.touchdown.team === active) sum.pTouchdownActive += p;
      else sum.pTouchdownOpp += p;
    }
    const actor = actorId ? findPlayer(s, actorId) : undefined;
    if (actor) {
      if (actor.location !== 'pitch') sum.pActorRemoved += p;
      if (actor.location !== 'pitch' || actor.stance !== 'standing') sum.pActorDown += p;
    }
    let fell = false;
    let targetBroken = false;
    let pushed = false;
    let crowd = false;
    let blockResult: string | undefined;
    let passResult: string | undefined;
    let intercepted = false;
    for (const e of ctx.events) {
      const d = e.data ?? {};
      if (e.type === 'status' && d.playerId === actorId && d.kind === 'fellOver') fell = true;
      if (e.type === 'roll' && d.playerId === targetId && d.armour === true && d.broken === true) targetBroken = true;
      if (e.type === 'push' && d.playerId === targetId) {
        pushed = true;
        if (d.crowd) crowd = true;
      }
      if (e.type === 'block' && typeof d.result === 'string' && !blockResult) blockResult = d.effective as string;
      if (e.type === 'roll' && d.kind === 'pass' && typeof d.outcome === 'string') passResult = d.outcome as string;
      if (e.type === 'ball' && typeof e.text === 'string' && e.text.includes('intercepts the pass')) intercepted = true;
    }
    if (fell) {
      sum.pActorFell += p;
      const k = actor?.pos ? fmt(actor.pos) : 'off pitch';
      sum.fallSquares[k] = (sum.fallSquares[k] ?? 0) + p;
    }
    if (targetId) {
      const t = findPlayer(s, targetId);
      if (t && t.team !== active) {
        if (t.location !== 'pitch' || t.stance !== 'standing') sum.pTargetDown += p;
        if (t.location !== 'pitch') sum.pTargetRemoved += p;
        if (t.location === 'ko') sum.pTargetKO += p;
        if (t.location === 'cas') sum.pTargetCas += p;
        if (targetBroken) sum.pTargetArmourBroken += p;
        if (pushed) sum.pTargetPushed += p;
        if (crowd) sum.pTargetCrowd += p;
      }
    }
    if (pi?.blockTarget2) {
      const t2 = findPlayer(s, pi.blockTarget2);
      if (t2 && (t2.location !== 'pitch' || t2.stance !== 'standing')) sum.pTarget2Down += p;
    }
    if (blockResult) sum.blockResult[blockResult] = (sum.blockResult[blockResult] ?? 0) + p;
    if (passResult) sum.passResult[passResult] = (sum.passResult[passResult] ?? 0) + p;
    if (intercepted) sum.pIntercepted += p;
    const b = s.ball;
    if (b.kind === 'held') {
      const h = findPlayer(s, b.playerId);
      if (h?.team === active) sum.pActiveHasBall += p;
      else sum.pOppHasBall += p;
      if (baseReceiver && b.playerId === baseReceiver.id) sum.pBallWithReceiver += p;
      if (actorId && b.playerId === actorId) sum.pBallWithActor += p;
    } else if (b.kind === 'ground') sum.pBallGround += p;
  });
  sum.explored = r.explored;
  sum.unresolved = r.unresolved;
  sum.leaves = r.leaves;
  sum.illegal = r.illegal;
  return sum;
}

function blockAnalysis(s: GameState, step: StepRecord, att: Player, def: Player, isBlitz: boolean): BlockAnalysis {
  const ex = step.extra as { dice: number; chooser: 'attacker' | 'defender'; attST: number; defST: number; offAssists: number; defAssists: number };
  const faces: BlockFace[] = ['playerDown', 'bothDown', 'push', 'stumble', 'pow'];
  const atLeastOne = {} as Record<BlockFace, number>;
  for (const f of faces) atLeastOne[f] = 0;
  // Exact distribution of the chosen result by enumerating the pool — weighted as the match rolls it (standard, or
  // the difficulty house rule judging the face the choosing coach would take).
  const fac = att.team !== def.team ? difficultyFactors(s, att.team) : null;
  const chosen: Record<string, number> = {};
  const n = ex.dice;
  const total = Math.pow(6, n);
  const idx = Array.from({ length: n }, () => 1);
  const rows: Array<{ pool: BlockFace[]; w: number }> = [];
  let wsum = 0;
  for (let k = 0; k < total; k++) {
    let r = k;
    for (let i = 0; i < n; i++) {
      idx[i] = (r % 6) + 1;
      r = Math.floor(r / 6);
    }
    const pool = idx.map((v) => (v === 1 ? 'playerDown' : v === 2 ? 'bothDown' : v <= 4 ? 'push' : v === 5 ? 'stumble' : 'pow')) as BlockFace[];
    const vals = pool.map((f) => blockFaceValue(f, att, def, isBlitz));
    const w = fac ? outcomeFactor(fac, ex.chooser === 'attacker' ? Math.max(...vals) : Math.min(...vals)) : 1;
    rows.push({ pool, w });
    wsum += w;
  }
  for (const { pool, w } of rows) {
    const p = w / wsum;
    for (const f of new Set(pool)) atLeastOne[f] += p;
    const pref: Record<string, number> = { pow: 0.03, stumble: 0.02, bothDown: 0.01, push: 0, playerDown: 0 };
    const scores = pool.map((f) => faceScore(f, att, def, isBlitz) + (ex.chooser === 'attacker' ? pref[f] : -pref[f]));
    const pick = ex.chooser === 'attacker' ? pool[scores.indexOf(Math.max(...scores))] : pool[scores.indexOf(Math.min(...scores))];
    let eff: string = pick;
    if (pick === 'stumble') eff = canUse(def, 'dodge') && !canUse(att, 'tackle') ? 'push' : 'pow';
    chosen[eff] = (chosen[eff] ?? 0) + p;
  }
  void BLOCK_FACE_P;
  const faceNotes = {} as Record<BlockFace, string>;
  const dodge = canUse(def, 'dodge') && !canUse(att, 'tackle');
  faceNotes.playerDown = 'Attacker Knocked Down → Turnover';
  faceNotes.bothDown = `${canUse(att, 'block') ? 'Attacker stays up (Block)' : canUse(att, 'wrestle') ? 'Attacker may Wrestle (both Placed Prone)' : 'Attacker down → Turnover'}; ${canUse(def, 'block') ? 'defender stays up (Block)' : 'defender down'}${isBlitz && canUse(att, 'juggernaut') ? '; Juggernaut: may be a Push' : ''}`;
  faceNotes.push = 'Defender Pushed Back';
  faceNotes.stumble = dodge ? 'Defender has Dodge → Push Back' : canUse(def, 'dodge') ? 'Tackle cancels Dodge → POW!' : 'No Dodge → POW!';
  faceNotes.pow = 'Defender Pushed Back and Knocked Down';
  return { dice: ex.dice, chooser: ex.chooser, attST: ex.attST, defST: ex.defST, offAssists: ex.offAssists, defAssists: ex.defAssists, atLeastOne, chosen, faceNotes };
}

/**
 * Plan an action: validate it, trace the planned-success path, and enumerate
 * every dice outcome to compute exact probabilities. Never mutates `state`
 * and never touches its random number generator.
 */
/**
 * Static checks shared by planAction and execute: returns the reasons the
 * input cannot be declared, before any dice are considered.
 */
function preflight(state: GameState, base: GameState, input: ActionInput): string[] {
  if (state.pending) return ['A decision is pending.'];
  if (isMatchInput(input)) return ['Match sequence steps (set-up, kick-off, end of Drive) are not planned: they are resolved directly.'];
  if (input.kind === 'wizard') {
    const why = wizardReason(state, input.team, input);
    return why ? [why] : [];
  }
  if (state.phase !== 'play') return ['The game is not in play.'];
  if (input.kind !== 'playerAction') return [];
  const errors: string[] = [];
  const p = findPlayer(base, input.playerId);
  if (!p) return ['Unknown player.'];
  const act = base.turn.activation;
  if (!(act && act.playerId === p.id)) {
    const why = declarationReason(base, p, input);
    if (why) return [why];
  }
  if (input.action === 'secure' && base.ball.kind === 'ground') {
    const bp = base.ball.pos;
    const idx = input.path.findIndex((st) => eq(st.to, bp));
    if (idx !== input.path.length - 1) errors.push('Secure the Ball: the move must end on the ball (and not pass over it earlier).');
  }
  return errors;
}

/** Run the planned-success trace (no RNG). Throws nothing: illegal inputs come back as errors. */
function trace(base: GameState, input: ActionInput, policy: Policy): { errors: string[]; ctx: Ctx } {
  const ctx = new Ctx(cloneState(base), new TraceDice(), 'plan', [], policy, makeDecider(policy));
  try {
    runInput(ctx, input, { preview: true });
  } catch (e) {
    if (e instanceof IllegalAction) return { errors: [e.message], ctx };
    throw e;
  }
  return { errors: [], ctx };
}

/**
 * Validate an input without rolling dice or touching the state: the same
 * checks the planner makes. `execute` calls this first, so an illegal action
 * is rejected before any dice are rolled (never "half executed").
 */
export function validateInput(state: GameState, input: ActionInput): string[] {
  usePitch(state);
  if (isMatchInput(input)) {
    const why = matchInputReason(state, input);
    return why ? [why] : [];
  }
  const base = stripped(state);
  const pre = preflight(state, base, input);
  if (pre.length) return pre;
  return trace(base, input, { ...DEFAULT_POLICY }).errors;
}

/**
 * Plan an action: validate it, trace the planned-success path, and enumerate
 * every dice outcome to compute exact probabilities. Never mutates `state`
 * and never touches its random number generator.
 */
export function planAction(state: GameState, input: ActionInput, options: PlanOptions = {}): PlanResult {
  usePitch(state);
  // Throw Bomb (p.125): scatters, catches, re-throws and a blast with Armour and Injury Rolls for every player hit branch
  // very widely — its preview stops at 1 in 10,000 (the rest is reported as not explored, never guessed).
  const bomb = input.kind === 'playerAction' && input.special === 'bombardier';
  const opts: Required<PlanOptions> = { threshold: options.threshold ?? (bomb ? 1e-4 : 1e-9), maxLeaves: options.maxLeaves ?? (bomb ? 8000 : 60000), followUp: options.followUp ?? true };
  const base = stripped(state);
  const res: PlanResult = {
    ok: false,
    errors: [],
    input,
    steps: [],
    withTeamRerolls: null,
    withoutTeamRerolls: null,
    assumptions: [],
    traceEvents: [],
    teamRerollsAvailable: base.teams[base.turn.active].rerolls,
  };
  res.errors = preflight(state, base, input);
  if (res.errors.length) return res;
  // Bloodlust (p.125): declaring this Action first ends a hungry team-mate's activation.
  const act0 = base.turn.activation;
  if (input.kind === 'playerAction' && act0 && act0.playerId !== input.playerId && act0.bloodlust === 'hungry') {
    const v = findPlayer(base, act0.playerId);
    if (v && v.location === 'pitch') {
      const turnover = !biteTargetAdjacent(base, v);
      res.endsHungry = {
        playerId: v.id,
        turnover,
        text: turnover
          ? `Bloodlust: ${label(v)} has not bitten a Thrall and none is next to them — ending that activation is a Turnover, so this Action would not be taken. End ${label(v)}'s activation (Turnover), or move them next to a Thrall first.`
          : `Bloodlust: ${label(v)}'s activation ends first — you choose to bite the Thrall next to them (or not: Turnover, and this Action is not taken).`,
      };
      if (turnover) {
        res.errors = [res.endsHungry.text];
        return res;
      }
    }
  }

  // 1) Trace: the planned-success path (validation + step list).
  const policy: Policy = { ...DEFAULT_POLICY, followUp: opts.followUp };
  const tr = trace(base, input, policy);
  if (tr.errors.length) {
    res.errors = tr.errors;
    return res;
  }
  const traceCtx = tr.ctx;
  res.steps = traceCtx.steps;
  res.traceEvents = traceCtx.events;
  if (input.kind === 'playerAction') {
    const p = findPlayer(traceCtx.s, input.playerId);
    if (p?.pos) res.finalSquare = p.pos;
    const bstep = traceCtx.steps.find((st) => st.kind === 'block');
    if (bstep) {
      const att = getPlayer(base, input.playerId);
      const def = findPlayer(base, (bstep.extra?.defenderId as string) ?? '');
      if (def) res.block = blockAnalysis(base, bstep, att, def, input.action === 'blitz');
    }
    if (input.action === 'pass' && input.passTarget) res.pass = passPreview(base, traceCtx, input);
  }

  // 2) Exact enumeration with and without Team Re-rolls.
  res.withTeamRerolls = summarise(base, input, { ...policy, useTeamRerolls: true }, opts);
  const trAvail = base.teams[base.turn.active].rerolls > 0 || base.teams[base.turn.active].leaderReroll;
  res.withoutTeamRerolls = trAvail ? summarise(base, input, { ...policy, useTeamRerolls: false }, opts) : res.withTeamRerolls;
  res.assumptions = POLICY_ASSUMPTIONS.slice();
  if (!opts.followUp) res.assumptions.push('Follow-up: you do not follow up after a push.');
  else res.assumptions.push('Follow-up: you follow up after a push (unless Fend stops it).');
  const bad = new Set([...Object.keys(res.withTeamRerolls.illegal), ...Object.keys(res.withoutTeamRerolls.illegal)]);
  if (bad.size) {
    res.errors = [...bad].map((m) => `In some dice outcomes the rest of this plan would be illegal: ${m}`);
    return res;
  }
  res.ok = true;
  return res;
}

function passPreview(base: GameState, traceCtx: Ctx, input: PlayerActionInput): PassAnalysis | undefined {
  // Use the thrower's square at the end of the planned move (from the trace).
  const p = findPlayer(traceCtx.s, input.playerId);
  if (!p?.pos || !input.passTarget || p.pa === null) return undefined;
  const ctx = new Ctx(cloneState(traceCtx.s), new TraceDice(), 'plan', [], DEFAULT_POLICY, null);
  const info = passInfo(ctx, p, p.pos, input.passTarget, !!input.hailMary);
  if (typeof info === 'string') return undefined;
  // Sevens Set Piece: Accurate on any 2+ (PA and modifiers ignored) — as the match resolves it.
  const setPiece = input.desperate === 'setPiece' && !input.hailMary;
  const m = setPiece ? 0 : modSum(info.mods);
  const pa = setPiece ? 2 : (p.pa as number);
  const safe = canUse(p, 'safePass');
  let acc = 0;
  let inacc = 0;
  let fum = 0;
  const outcome = (n: number): 'accurate' | 'inaccurate' | 'fumble' | 'safe' => {
    if (n === 1) return safe ? 'safe' : 'fumble';
    if (setPiece) return 'accurate';
    const mod = Math.max(1, Math.min(6, n + m));
    if (n !== 6 && mod <= 1) return 'fumble';
    if (n === 6 || mod >= pa) return input.hailMary ? 'inaccurate' : 'accurate';
    return 'inaccurate';
  };
  // The thrower's coach rolls: standard, or the difficulty house rule judging the throw as the match does.
  const wp = testWeights(ctx.s, p.team, (n) => outcome(n) === (input.hailMary ? 'inaccurate' : 'accurate'));
  const pf = (n: number) => (wp ? wp[n - 1] : 1 / 6);
  for (let n = 1; n <= 6; n++) {
    const o = outcome(n);
    if (o === 'fumble') fum += pf(n);
    else if (o === 'accurate') acc += pf(n);
    else if (o === 'inaccurate') inacc += pf(n);
  }
  const ints = input.hailMary
    ? []
    : interceptors(ctx, p, p.pos, input.passTarget).map((q) => {
        const im = modSum(interceptMods(ctx, q, true));
        return { id: q.id, label: label(q), p: d6SuccessProbW(q.ag, im, testWeights(ctx.s, q.team, (f) => d6Success(f, q.ag, im))) };
      });
  void base;
  return {
    range: input.hailMary ? 'Hail Mary (Long Bomb)' : RANGE_LABEL[passRange(p.pos, input.passTarget) ?? 'quick'],
    target: input.passTarget,
    pa: p.pa as number,
    mods: info.mods,
    pAccurate: acc,
    pInaccurate: inacc,
    pFumble: fum,
    interceptorsIfAccurate: ints,
    hailMary: !!input.hailMary,
  };
}

export { hasSkill };

// ---------------------------------------------------------------------------
// Outcome exploration for analysis tools (the computer opponent, AI Focus)
// ---------------------------------------------------------------------------

export interface OutcomeLeaf {
  /** Probability of this outcome (product of the dice probabilities on its branch). */
  p: number;
  /** The position at the end of the action in this outcome (a private copy; do not keep references into it). */
  state: GameState;
  completed: boolean;
  /** The action caused a Turnover (a Touchdown for the acting team is not counted). */
  turnover: boolean;
  /** Team that scored in this outcome, if any. */
  touchdown: TeamId | null;
  /** V5.6: the enumerator's branch path to this outcome, and an opaque handle of the run that produced it (see `ExploreOptions.wrapDecider`). */
  path: number[];
  run: object;
}

export interface ExploreOptions {
  /** Branches less likely than this are not expanded (their mass is reported as `unresolved`). */
  threshold?: number;
  maxLeaves?: number;
  useTeamRerolls?: boolean;
  followUp?: boolean;
  /**
   * V5.6: wrap the previews' decision policy. The hook receives the default decider (`POLICY_ASSUMPTIONS`) and returns
   * the decider to use; it may branch on a decision with `ctx.dice.choose(...)` (each option becomes an enumerated
   * branch). Decisions are then coach-controlled branches, not silently resolved by the default policy.
   */
  wrapDecider?: (base: PolicyDecider) => PolicyDecider;
}

export interface ExploreResult {
  ok: boolean;
  errors: string[];
  explored: number;
  /** Probability mass not enumerated (branches below the threshold, or beyond maxLeaves). */
  unresolved: number;
  /** The part of `unresolved` in branches that had already suffered a Turnover when they were cut. */
  unresolvedTurnover: number;
  leaves: number;
}

/**
 * Enumerate the outcomes of an input with the same code and decision policy
 * as the previews, and hand every resulting position to `visit`. Like
 * planAction it never changes `state` and never touches the random number
 * generator: it is the planner's outcome tree, not a simulation with the
 * game's dice.
 */
export function exploreOutcomes(state: GameState, input: ActionInput, options: ExploreOptions, visit: (leaf: OutcomeLeaf) => void): ExploreResult {
  usePitch(state);
  const base = stripped(state);
  const errors = preflight(state, base, input);
  if (errors.length) return { ok: false, errors, explored: 0, unresolved: 1, unresolvedTurnover: 0, leaves: 0 };
  const policy: Policy = { ...DEFAULT_POLICY, followUp: options.followUp ?? true, useTeamRerolls: options.useTeamRerolls ?? true };
  const tr = trace(base, input, policy);
  if (tr.errors.length) return { ok: false, errors: tr.errors, explored: 0, unresolved: 1, unresolvedTurnover: 0, leaves: 0 };
  const active = base.turn.active;
  const r = enumerate(
    base,
    input,
    policy,
    options.threshold ?? 1e-9,
    options.maxLeaves ?? 60000,
    ({ p, ctx, path }) => {
      visit({ p, state: ctx.s, completed: !!ctx.completed || ctx.touchdown?.team === active, turnover: !!ctx.turnover && ctx.touchdown?.team !== active, touchdown: ctx.touchdown?.team ?? null, path, run: ctx });
    },
    options.wrapDecider,
  );
  const bad = Object.keys(r.illegal);
  if (bad.length) return { ok: false, errors: bad.map((m) => `In some dice outcomes the rest of this plan would be illegal: ${m}`), explored: r.explored, unresolved: r.unresolved, unresolvedTurnover: r.unresolvedTurnover, leaves: r.leaves };
  return { ok: true, errors: [], explored: r.explored, unresolved: r.unresolved, unresolvedTurnover: r.unresolvedTurnover, leaves: r.leaves };
}

/** The previews' decision policy (POLICY_ASSUMPTIONS) applied to a real decision request. */
export function previewDecision(state: GameState, req: DecisionRequest): string {
  usePitch(state);
  const ctx = new Ctx(cloneState(state), new TraceDice(), 'plan', [], DEFAULT_POLICY, null);
  const id = makeDecider(DEFAULT_POLICY)(req, ctx);
  return req.options.some((o) => o.id === id) ? id : req.options[0].id;
}

// ---------------------------------------------------------------------------
// V6: forkable, coach-controlled stepping through one action (AI API v2 "controlled simulation")
// ---------------------------------------------------------------------------
// A fork is (base position, input, path). `path` lists the branch taken at every earlier Chance / Decision node (an index
// into that node's branches). Advancing re-runs the SAME rules code as the previews up to the next unresolved node, so
// joint probabilities are kept exactly (the product of the chosen branches) and nothing here is a second rules engine.

export interface StepBranch {
  index: number;
  /** Probability of this branch given the node (1 for decision options). */
  p: number;
  label: string;
  faces?: number[];
  detail?: string;
  /** Decision options: the option id to submit with `decide`. */
  id?: string;
}

export type StepNode =
  | { node: 'chance'; p: number; path: number[]; dice: number[]; display?: string; by?: TeamId | null; branches: StepBranch[]; unresolved: number; events: GameEvent[] }
  | { node: 'decision'; p: number; path: number[]; team: TeamId; requestId: string; type: string; prompt: string; /** Branch the documented default policy (POLICY_ASSUMPTIONS) would take. */ defaultIndex: number; branches: StepBranch[]; events: GameEvent[] }
  | { node: 'terminal'; p: number; path: number[]; completed: boolean; turnover: boolean; touchdown: TeamId | null; events: GameEvent[]; state: GameState }
  | { node: 'illegal'; errors: string[] };

export interface StepOptions {
  /** Decisions of this team become Decision nodes (default: the acting team). */
  controlTeam?: TeamId;
  /** Every decision of both teams becomes a Decision node (otherwise the opponent's follow the documented default policy). */
  controlAll?: boolean;
  followUp?: boolean;
  useTeamRerolls?: boolean;
}

class StepPause {
  constructor(public node: StepNode) {}
}

class StepDice implements DiceSource {
  readonly mode = 'enumerate' as const;
  private i = 0;
  p = 1;
  constructor(private path: number[], private meta: { events: () => GameEvent[] }, private active: TeamId) {}
  private take<T>(branches: Array<{ p: number; value: T }>, make: () => StepNode): T {
    if (this.i < this.path.length) {
      const g = branches[this.path[this.i++]];
      if (!g) throw new Error('Step path mismatch');
      this.p *= g.p;
      return g.value;
    }
    throw new StepPause(make());
  }
  roll<T>(spec: RollSpec<T>): RollResult<T> {
    const groups = groupOutcomes(spec);
    const sum = groups.reduce((a, g) => a + g.p, 0);
    const g = this.take(
      groups.map((x) => ({ p: x.p, value: x })),
      () => ({
        node: 'chance',
        p: this.p,
        path: this.path.slice(),
        dice: spec.dice.slice(),
        display: spec.display,
        by: spec.by ?? null,
        unresolved: Math.max(0, 1 - sum),
        branches: groups.map((x, index) => ({ index, p: x.p, label: x.key.length > 80 ? x.key.slice(0, 77) + '…' : x.key, faces: x.faces.slice() })),
        events: this.meta.events().slice(),
      }),
    );
    return { faces: g.faces, value: g.value };
  }
  choose<T>(outcomes: ChoiceOutcome<T>[]): T {
    const dec = (outcomes as unknown as Array<{ decision?: { requestId: string; type: string; prompt: string; team: TeamId; label: string; detail?: string; id: string; dflt: boolean } }>)[0]?.decision;
    if (dec) {
      return this.take(outcomes, () => ({
        node: 'decision',
        p: this.p,
        path: this.path.slice(),
        team: dec.team,
        requestId: dec.requestId,
        type: dec.type,
        prompt: dec.prompt,
        defaultIndex: Math.max(0, outcomes.findIndex((o) => (o as unknown as { decision: { dflt: boolean } }).decision.dflt)),
        branches: outcomes.map((o, index) => {
          const d = (o as unknown as { decision: { label: string; detail?: string; id: string } }).decision;
          return { index, p: 1, label: d.label, detail: d.detail, id: d.id };
        }),
        events: this.meta.events().slice(),
      }));
    }
    const sum = outcomes.reduce((a, o) => a + o.p, 0);
    return this.take(outcomes, () => ({
      node: 'chance',
      p: this.p,
      path: this.path.slice(),
      dice: [],
      by: null,
      unresolved: Math.max(0, 1 - sum),
      branches: outcomes.map((o, index) => ({ index, p: o.p, label: (JSON.stringify(o.value) ?? String(o.value)).slice(0, 80) })),
      events: this.meta.events().slice(),
    }));
  }
}

/** Run the action along `path` and report the next node. Pure: `state` is never changed and the game's dice are never touched. */
export function stepNode(state: GameState, input: ActionInput, path: number[], options: StepOptions = {}): StepNode {
  usePitch(state);
  const base = stripped(state);
  const errors = preflight(state, base, input);
  if (errors.length) return { node: 'illegal', errors };
  const policy: Policy = { ...DEFAULT_POLICY, followUp: options.followUp ?? true, useTeamRerolls: options.useTeamRerolls ?? true };
  const active = base.turn.active;
  const control = options.controlTeam ?? active;
  const baseDecider = makeDecider(policy);
  let ctxRef: Ctx | null = null;
  const dice = new StepDice(path, { events: () => (ctxRef ? ctxRef.events : []) }, active);
  const decider: PolicyDecider = (req, ctx) => {
    if (!options.controlAll && req.team !== control) return baseDecider(req, ctx);
    const dflt = baseDecider(req, ctx);
    const outcomes = req.options.map((o) => ({ key: o.id, p: 1, value: o.id, decision: { requestId: req.id, type: req.type, prompt: req.prompt, team: req.team, label: o.label, detail: o.detail, id: o.id, dflt: o.id === dflt } }));
    return ctx.dice.choose(outcomes as never) as string;
  };
  const ctx = new Ctx(cloneState(base), dice, 'plan', [], policy, decider);
  ctxRef = ctx;
  try {
    runInput(ctx, input, { preview: true });
  } catch (e) {
    if (e instanceof StepPause) return e.node;
    if (e instanceof IllegalAction) return { node: 'illegal', errors: [e.message] };
    if (e instanceof NeedDecision) return { node: 'illegal', errors: ['an unanswered decision'] };
    if (e instanceof Error && !/path mismatch/.test(e.message)) return { node: 'illegal', errors: [e.message] };
    throw e;
  }
  return {
    node: 'terminal',
    p: dice.p,
    path: path.slice(),
    completed: !!ctx.completed || ctx.touchdown?.team === active,
    turnover: !!ctx.turnover && ctx.touchdown?.team !== active,
    touchdown: ctx.touchdown?.team ?? null,
    events: ctx.events.slice(),
    state: ctx.s,
  };
}
