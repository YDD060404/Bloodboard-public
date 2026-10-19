import { Ctx, testWeights, type Mod } from './context';
import { clampD6, d6AtLeastW, d6Success } from './dice';

/** The modified D6 value shown in the log: FAQ May 2026 lets it fall below 1; matches started before it keep the old floor of 1 (exact replay). */
const shownD6 = (s: { rulesEdition?: string }, v: number): number => (s.rulesEdition === 'faq2026' ? clampD6(v) : Math.max(1, clampD6(v)));
import { R } from './rules';
import { canUse, faq2026, hasSkill, label, leaderOnPitch, pitchPlayers, skillValue } from './state';
import type { DecisionOption, GameState, Player, RuleRef, TeamId, TeamState } from './types';
import { askStar, spendStar, starPassOn2, starReady, starTestBonus, starTestReroll } from './stars';

/**
 * Generic D6 test with the full re-roll procedure (p.33):
 *  - modifiers that may be applied after the roll (Break Tackle, p.126),
 *  - one re-roll per dice from a skill, Pro (3+), or a Team / Leader Re-roll
 *    (with the Loner check), never re-rolling a re-roll,
 *  - an optional malus applied after all re-rolls (Diving Tackle, p.127).
 */
export interface TestSpec {
  kind: string;
  player: Player;
  label: string;
  target: number;
  mods: Mod[];
  rule: RuleRef;
  /** Outcome for a natural roll and a total modifier. Default: 'S' / 'F'. */
  outcome?: (natural: number, mod: number) => string;
  /** Identifies a custom outcome function for caching (required with `outcome`). */
  outcomeKey?: string;
  isSuccess?: (o: string) => boolean;
  /** Skill that grants a re-roll of this test. */
  skillReroll?: { id: string; name: string; available: boolean; markUsed?: () => void };
  /** Team re-rolls may be used for this kind of roll. */
  teamReroll: boolean;
  /** Pro may be used for this kind of roll. */
  proAllowed: boolean;
  /** Bonus that may be applied after the roll (Break Tackle). */
  bonus?: { id: string; name: string; value: number; markUsed: () => void };
  /** Malus the opposing coach may apply after all re-rolls (Diving Tackle: -2). */
  lateMalus?: number;
  onFail: string;
  /** Automatic failure without rolling (e.g. No Ball). */
  autoFail?: string;
  extra?: Record<string, unknown>;
  /** Square where the roll happens (drawn on the pitch in previews). */
  at?: { x: number; y: number };
  /** Not the ball (a bomb): the Sevens Veteran re-roll does not apply. */
  notBall?: boolean;
  /** Jump / Leap / Pogo for a 'jump' test (Jordell Freshbreeze's Swift as the Breeze covers a Leap, not a Jump). */
  subkind?: string;
}

/**
 * Blood Bowl Sevens Veteran (Spike! 22 p.13): once per game, when the Veteran fails to pick up the ball,
 * catch the ball or make a Pass Action (a Passing Ability Test that is not Accurate), it may re-roll the
 * dice. Not a Team Re-roll (no Loner roll); a die is still never re-rolled twice.
 */
const VETERAN_KINDS = new Set(['pickup', 'secure', 'catch', 'pass']);
export const VETERAN_RULE: RuleRef = { page: 13, title: 'Veterans', source: 'sevens' };

export function veteranRerollFor(spec: Pick<TestSpec, 'kind' | 'player' | 'notBall'>): boolean {
  return spec.player.veteran === 'ready' && VETERAN_KINDS.has(spec.kind) && !spec.notBall;
}

export interface TestResult {
  outcome: string;
  success: boolean;
  natural: number;
  modTotal: number;
  rerolled: boolean;
  /** Outcome if the late malus is applied. */
  lateOutcome?: string;
}

export function modSum(mods: Mod[]): number {
  return mods.reduce((a, m) => a + m.value, 0);
}

export function fmtMods(mods: Mod[]): string {
  if (!mods.length) return 'no modifiers';
  return mods.map((m) => `${m.value >= 0 ? '+' : ''}${m.value} ${m.label}`).join(', ');
}

/**
 * Spend one Team Re-roll. A free re-roll from Brilliant Coaching (p.48) is
 * lost at the end of the Drive, so it is always the one spent first.
 */
export function spendTeamReroll(t: TeamState, n = 1): void {
  t.rerolls -= n;
  if (t.bonusRerolls) t.bonusRerolls = Math.max(0, t.bonusRerolls - n);
}

export const CAPTAIN_RULE: RuleRef = { page: 155, title: 'Team Captain' };

/** The team's Team Captain (p.155) if it is on the pitch (standing, Prone or Stunned). */
export function captainOnPitch(s: GameState, team: TeamId): Player | undefined {
  if (!s.teams[team].specialRules?.includes('Team Captain')) return undefined;
  return pitchPlayers(s, team).find((p) => p.captain);
}

/**
 * Use one Team Re-roll (p.33). Team Captain (p.155): while the Captain is on
 * the pitch the coach rolls a D6 — on a natural 6 the Team Re-roll is free
 * (given back, including a Brilliant Coaching one).
 */
export function useTeamReroll(ctx: Ctx, team: TeamId, what = ''): void {
  const t = ctx.s.teams[team];
  const bonus = (t.bonusRerolls ?? 0) > 0;
  spendTeamReroll(t);
  ctx.emit('reroll', `Team Re-roll used${what} (${t.rerolls} Team Re-roll${t.rerolls === 1 ? '' : 's'} left).`, R.rerolls);
  const cap = captainOnPitch(ctx.s, team);
  if (!cap) return;
  const r = ctx.roll({ dice: [6], interpret: ([n]) => (n === 6 ? 'S' : 'F'), cacheKey: 'captain6', by: team, judge: (v) => (v === 'S' ? 1 : -1) });
  const free = r.value === 'S';
  if (free) {
    t.rerolls += 1;
    if (bonus) t.bonusRerolls = (t.bonusRerolls ?? 0) + 1;
  }
  ctx.emit('roll', `Team Captain ${label(cap)}: rolled ${r.faces[0]} — ${free ? 'a natural 6, the Team Re-roll is free' : 'the Team Re-roll is spent'}.`, CAPTAIN_RULE, { playerId: cap.id, captainFree: free });
}

/** Team Mascot (Inducement, p.144): its extra Team Re-roll can be used by the active team this half. */
export function mascotAvailable(ctx: Ctx, team: TeamId): boolean {
  return ctx.s.turn.active === team && !!ctx.s.teams[team].mascotReroll;
}

/** Team Mascot: roll a D6 before using its Team Re-roll — 4+ it is used (and spent), 1-3 it is lost for this half. */
export function mascotCheck(ctx: Ctx, team: TeamId): boolean {
  const t = ctx.s.teams[team];
  t.mascotReroll = false;
  const r = ctx.roll({ dice: [6], interpret: ([n]) => (n >= 4 ? 'S' : 'F'), cacheKey: 'mascot4', by: team, judge: (v) => (v === 'S' ? 1 : -1) });
  const rule = { page: 144, title: 'Team Mascot' };
  ctx.emit('roll', `Team Mascot: ${r.faces[0]} — ${r.value === 'S' ? 'the Team Re-roll can be used' : 'the Mascot is ineffective: its Team Re-roll is lost for this half'}.`, rule);
  return r.value === 'S';
}

/**
 * Team Captain with the Team Mascot (FAQ May 2026 p.144): after the Mascot's re-roll was used (its D6 4+ succeeded), the coach
 * may test whether it is free, as for any Team Re-roll — a natural 6 gives the Mascot's Team Re-roll back. Every later use
 * needs its own D6 4+ (the Mascot can be ineffective the second time).
 */
export function mascotCaptainFree(ctx: Ctx, team: TeamId): boolean {
  const cap = captainOnPitch(ctx.s, team);
  if (!cap) return false;
  const r = ctx.roll({ dice: [6], interpret: ([n]) => (n === 6 ? 'S' : 'F'), cacheKey: 'captain6', by: team, judge: (v) => (v === 'S' ? 1 : -1) });
  const free = r.value === 'S';
  if (free) ctx.s.teams[team].mascotReroll = true;
  ctx.emit('roll', `Team Captain ${label(cap)}: rolled ${r.faces[0]} — ${free ? "a natural 6, the Team Mascot's re-roll is free and can be used again (with a new D6 4+)" : "the Team Mascot's re-roll is spent"}.`, CAPTAIN_RULE, { playerId: cap.id, captainFree: free, mascot: true });
  return free;
}

export function teamRerollsAvailable(ctx: Ctx, p: Player): { team: boolean; leader: boolean } {
  const s = ctx.s;
  if (s.turn.active !== p.team) return { team: false, leader: false };
  const t = s.teams[p.team];
  return { team: t.rerolls > 0, leader: t.leaderReroll && leaderOnPitch(s, p.team) };
}

export function proAvailable(ctx: Ctx, p: Player): boolean {
  const a = ctx.s.turn.activation;
  return !!a && a.playerId === p.id && !a.proUsed && canUse(p, 'pro');
}

export function lonerValue(p: Player): number | undefined {
  return hasSkill(p, 'loner') ? skillValue(p, 'loner') ?? 4 : undefined;
}

export function rollTest(ctx: Ctx, spec: TestSpec): TestResult {
  const outcomeOf = spec.outcome ?? ((n: number, m: number) => (d6Success(n, spec.target, m) ? 'S' : 'F'));
  const isSuccess = spec.isSuccess ?? ((o: string) => o === 'S');
  const mod = modSum(spec.mods);
  const late = spec.lateMalus;
  const bonus = spec.bonus;
  // Star Player special rules for this test (stars.ts): a modifier after the roll, a pass on 2+, a re-roll.
  const sb = starTestBonus(ctx.s, spec.player, spec.kind);
  const s2 = starPassOn2(ctx.s, spec.player, spec.kind, spec.subkind);
  const starRr = starTestReroll(ctx.s, spec.player, spec.kind);

  if (ctx.mode === 'plan') recordStep(ctx, spec, outcomeOf, isSuccess, mod);

  if (spec.autoFail) {
    ctx.emit('roll', `${spec.label}: automatically fails (${spec.autoFail}).`, spec.rule, { kind: spec.kind, playerId: spec.player.id, auto: true });
    return { outcome: 'F', success: false, natural: 1, modTotal: mod, rerolled: false, lateOutcome: 'F' };
  }

  const cacheable = !spec.outcome || !!spec.outcomeKey;
  const doRoll = () =>
    ctx.roll({
      dice: [6],
      interpret: ([n]) => {
        const v: Record<string, string> = { o: outcomeOf(n, mod) };
        if (bonus) v.b = outcomeOf(n, mod + bonus.value);
        if (late !== undefined) {
          v.l = outcomeOf(n, mod + late);
          if (bonus) v.bl = outcomeOf(n, mod + bonus.value + late);
        }
        if (sb) v.g = outcomeOf(n, mod + sb.value);
        if (s2) v.j = n >= 2 ? 'S' : v.o;
        return v;
      },
      by: spec.player.team,
      // Difficulty house rule: a success is good for the tested player's team (with any help that turns it into one).
      judge: (v) => (isSuccess(v.o) || (!!sb && isSuccess(v.g)) || (!!s2 && isSuccess(v.j)) ? 1 : -1),
      // Plan traces follow the outcome that is good for the ACTIVE team.
      prefer: spec.player.team === ctx.s.turn.active ? (v) => isSuccess(v.o) && (late === undefined || isSuccess(v.l)) : (v) => !isSuccess(v.o),
      cacheKey: cacheable ? `t|${spec.outcomeKey ?? 'std'}|${spec.target}|${mod}|${bonus?.value ?? 0}|${late ?? 'x'}|${sb?.value ?? 0}|${s2 ? 1 : 0}` : undefined,
    });

  let bonusUsed = false;
  const describe = (n: number, o: string, prefix: string) => {
    const tot = mod + (bonusUsed && bonus ? bonus.value : 0);
    const modTxt = spec.mods.length || bonusUsed ? `, ${fmtMods(spec.mods)}${bonusUsed && bonus ? `, +${bonus.value} ${bonus.name}` : ''}` : '';
    const res = isSuccess(o) ? 'success' : o === 'F' ? 'failed' : o;
    ctx.emit('roll', `${prefix}${spec.label}: rolled ${n}${tot ? ` (counts as ${shownD6(ctx.s, n + tot)})` : ''}; needs ${spec.target}+${modTxt} — ${res}.`, spec.rule, {
      kind: spec.kind,
      playerId: spec.player.id,
      natural: n,
      target: spec.target,
      modifier: tot,
      outcome: o,
    });
  };

  let r = doRoll();
  let natural = r.faces[0];
  let v = r.value;
  let outcome = v.o;
  describe(natural, outcome, '');
  let rerolled = false;

  const offerBonus = () => {
    if (!bonus || bonusUsed || isSuccess(outcome) || !isSuccess(v.b)) return;
    const choice = ctx.ask({
      type: 'breakTackle',
      team: spec.player.team,
      prompt: `${label(spec.player)} rolled ${natural} for ${spec.label}. Apply ${bonus.name} (+${bonus.value}, once per turn) to succeed?`,
      options: [
        { id: 'use', label: `Use ${bonus.name} (+${bonus.value})` },
        { id: 'no', label: `Keep ${bonus.name} for later` },
      ],
      rule: { page: 126, title: bonus.name },
    });
    if (choice === 'use') {
      bonusUsed = true;
      bonus.markUsed();
      outcome = v.b;
      ctx.emit('roll', `${bonus.name} applied (+${bonus.value}): ${spec.label} succeeds.`, { page: 126, title: bonus.name });
    }
  };

  offerBonus();

  // Griff Oberwald's Consummate Professional (+1 to an Agility Test, p.200), Skrull Halfheight's Strong Passing Game
  // (+ST to a Passing Ability Test, p.208), Jordell Freshbreeze's Swift as the Breeze (a Dodge, Leap or Rush passes on
  // a 2+, p.203): once per game each, chosen after seeing the roll.
  const offerStar = () => {
    if (isSuccess(outcome)) return;
    if (sb && v.g !== undefined && isSuccess(v.g) && starReady(ctx.s, spec.player, sb.id)) {
      if (askStar(ctx, spec.player, `${spec.label}: rolled ${natural}. Apply +${sb.value} (${sb.what}) to succeed?`, `Use it: +${sb.value}`, true, 'Keep it for later')) {
        spendStar(ctx, spec.player, `+${sb.value} to ${spec.label} — ${natural} counts as ${shownD6(ctx.s, natural + mod + sb.value)}.`);
        outcome = v.g;
      }
    } else if (s2 && v.j !== undefined && isSuccess(v.j) && starReady(ctx.s, spec.player, 'jordell')) {
      if (askStar(ctx, spec.player, `${spec.label}: rolled ${natural}. Pass it on a 2+ regardless of modifiers?`, 'Use it: the test passes', true, 'Keep it for later')) {
        spendStar(ctx, spec.player, `${spec.label} passes on a 2+ regardless of modifiers (rolled ${natural}).`);
        outcome = v.j;
      }
    }
  };
  offerStar();

  while (!isSuccess(outcome) && !rerolled) {
    const options: DecisionOption[] = [];
    if (spec.skillReroll?.available && canUse(spec.player, spec.skillReroll.id)) {
      options.push({ id: 'skill', label: `Re-roll with ${spec.skillReroll.name}` });
    }
    if (spec.proAllowed && proAvailable(ctx, spec.player)) {
      options.push({ id: 'pro', label: 'Use Pro (needs 3+ to re-roll)' });
    }
    if (veteranRerollFor(spec)) options.push({ id: 'veteran', label: 'Use the Veteran re-roll (once per game)' });
    if (starRr && starReady(ctx.s, spec.player, starRr.id)) options.push({ id: 'star', label: `Re-roll with ${starRr.what}` });
    const tr = teamRerollsAvailable(ctx, spec.player);
    const lonerX = lonerValue(spec.player);
    if (spec.teamReroll && tr.team) {
      options.push({ id: 'team', label: `Use a Team Re-roll (${ctx.s.teams[spec.player.team].rerolls} left)${lonerX ? ` — Loner ${lonerX}+ check` : ''}` });
    }
    if (spec.teamReroll && tr.leader) {
      options.push({ id: 'leader', label: `Use the Leader Re-roll${lonerX ? ` — Loner ${lonerX}+ check` : ''}` });
    }
    if (spec.teamReroll && mascotAvailable(ctx, spec.player.team)) {
      options.push({ id: 'mascot', label: `Use the Team Mascot's Team Re-roll (D6 4+ first)${lonerX ? ` — Loner ${lonerX}+ check` : ''}` });
    }
    if (!options.length) break;
    options.push({ id: 'none', label: `No re-roll (${spec.onFail})` });
    const choice = ctx.ask({
      type: 'reroll',
      team: spec.player.team,
      prompt: `${label(spec.player)} — ${spec.label} failed (rolled ${natural}, needs ${spec.target}+${spec.mods.length ? ` with ${fmtMods(spec.mods)}` : ''}). Re-roll?`,
      options,
      rule: R.rerolls,
      context: { natural, target: spec.target, mods: spec.mods, kind: spec.kind },
    });
    if (choice === 'none') break;
    if (choice === 'mascot' && !mascotCheck(ctx, spec.player.team)) continue; // lost for the half: another re-roll may be used
    rerolled = true;
    if (choice === 'skill') {
      spec.skillReroll?.markUsed?.();
      ctx.emit('reroll', `${label(spec.player)} uses ${spec.skillReroll?.name} to re-roll.`, spec.rule);
    } else if (choice === 'veteran') {
      spec.player.veteran = 'used';
      ctx.emit('reroll', `${label(spec.player)} uses the Veteran's once-per-game re-roll.`, VETERAN_RULE, { playerId: spec.player.id });
    } else if (choice === 'star') {
      spendStar(ctx, spec.player, `re-roll of ${spec.label}.`);
    } else if (choice === 'pro') {
      const act = ctx.s.turn.activation;
      if (act) act.proUsed = true;
      const pro = ctx.roll({ dice: [6], interpret: ([n]) => (n >= 3 ? 'S' : 'F'), cacheKey: 'pro3', by: spec.player.team, judge: (v) => (v === 'S' ? 1 : -1) });
      ctx.emit('roll', `Pro: rolled ${pro.faces[0]}; needs 3+ — ${pro.value === 'S' ? 'the dice is re-rolled' : 'no re-roll'}.`, { page: 133, title: 'Pro' });
      if (pro.value !== 'S') break;
    } else if (choice === 'team' || choice === 'leader' || choice === 'mascot') {
      const t = ctx.s.teams[spec.player.team];
      if (choice === 'team') useTeamReroll(ctx, spec.player.team);
      else if (choice === 'mascot') {
        /* the Team Mascot's re-roll: already checked (4+) and spent; the Team Captain may make it free */
        if (faq2026(ctx.s)) mascotCaptainFree(ctx, spec.player.team);
      } else {
        t.leaderReroll = false;
        ctx.emit('reroll', `Leader Re-roll used (${t.rerolls} Team Re-roll${t.rerolls === 1 ? '' : 's'} left).`, R.rerolls);
      }
      if (lonerX) {
        const lr = ctx.roll({ dice: [6], interpret: ([n]) => (n >= lonerX ? 'S' : 'F'), cacheKey: `loner${lonerX}`, by: spec.player.team, judge: (v) => (v === 'S' ? 1 : -1) });
        ctx.emit('roll', `Loner (${lonerX}+): rolled ${lr.faces[0]} — ${lr.value === 'S' ? 'the re-roll can be used' : 'the Team Re-roll is lost'}.`, { page: 131, title: 'Loner' });
        if (lr.value !== 'S') break;
      }
    }
    r = doRoll();
    natural = r.faces[0];
    v = r.value;
    outcome = bonusUsed ? v.b : v.o;
    describe(natural, outcome, 'Re-roll — ');
    offerBonus();
    offerStar();
  }

  const lateOutcome = late === undefined ? undefined : bonusUsed ? v.bl : v.l;
  return { outcome, success: isSuccess(outcome), natural, modTotal: mod + (bonusUsed && bonus ? bonus.value : 0), rerolled, lateOutcome };
}

/** Record a plan step for a D6 test without rolling (used by exact sub-solvers). */
export function recordTestStep(ctx: Ctx, spec: TestSpec): void {
  if (ctx.mode !== 'plan') return;
  const outcomeOf = spec.outcome ?? ((n: number, m: number) => (d6Success(n, spec.target, m) ? 'S' : 'F'));
  const isSuccess = spec.isSuccess ?? ((o: string) => o === 'S');
  recordStep(ctx, spec, outcomeOf, isSuccess, modSum(spec.mods));
}

function recordStep(ctx: Ctx, spec: TestSpec, outcomeOf: (n: number, m: number) => string, isSuccess: (o: string) => boolean, mod: number) {
  let pSingle = 0;
  let pAfterLate = 0;
  // A Star Player's once-per-game help after the roll (Griff's +1, Skrull's +ST, Jordell's 2+) is used whenever it
  // turns a failure into a success — as the decision policy does in the match — so the step's odds include it.
  const sb = starTestBonus(ctx.s, spec.player, spec.kind);
  const s2 = starPassOn2(ctx.s, spec.player, spec.kind, spec.subkind);
  const okFace = (f: number) => isSuccess(outcomeOf(f, mod)) || (!!sb && isSuccess(outcomeOf(f, mod + sb.value))) || (s2 && f >= 2);
  // Face probabilities of this roll: standard, or the optional difficulty house rule judging success / failure —
  // exactly as the match rolls it.
  const w = testWeights(ctx.s, spec.player.team, okFace);
  const pf = (f: number) => (w ? w[f - 1] : 1 / 6);
  for (let f = 1; f <= 6; f++) {
    if (okFace(f)) pSingle += pf(f);
    if (spec.lateMalus !== undefined && isSuccess(outcomeOf(f, mod + spec.lateMalus))) pAfterLate += pf(f);
  }
  if (spec.autoFail) pSingle = 0;
  const rerolls: string[] = [];
  let q = 0;
  if (spec.skillReroll?.available && canUse(spec.player, spec.skillReroll.id)) {
    rerolls.push(spec.skillReroll.name);
    q = 1;
  }
  const tr = teamRerollsAvailable(ctx, spec.player);
  const lonerX = lonerValue(spec.player);
  if (spec.teamReroll && (tr.team || tr.leader)) {
    rerolls.push(lonerX ? `Team Re-roll (Loner ${lonerX}+)` : 'Team Re-roll');
    q = Math.max(q, lonerX ? d6AtLeastW(lonerX, testWeights(ctx.s, spec.player.team, (f) => f >= lonerX)) : 1);
  }
  if (spec.proAllowed && proAvailable(ctx, spec.player)) {
    rerolls.push('Pro (3+)');
    q = Math.max(q, d6AtLeastW(3, testWeights(ctx.s, spec.player.team, (f) => f >= 3)));
  }
  if (veteranRerollFor(spec)) {
    rerolls.push('Veteran (once per game)');
    q = 1;
  }
  const starRr = starTestReroll(ctx.s, spec.player, spec.kind);
  if (starRr && starReady(ctx.s, spec.player, starRr.id)) {
    rerolls.push(starRr.what);
    q = 1;
  }
  const extra: Record<string, unknown> = { ...(spec.extra ?? {}) };
  if (spec.lateMalus !== undefined) extra.pIfDivingTackle = pAfterLate;
  if (spec.bonus) extra.bonus = `${spec.bonus.name} +${spec.bonus.value} available`;
  if (sb) extra.star = `${sb.what}: +${sb.value} after the roll if it turns a failure into a success (included)`;
  else if (s2) extra.star = "Jordell Freshbreeze's Swift as the Breeze: passes on a 2+ (included)";
  ctx.step({
    kind: spec.kind,
    label: spec.label,
    playerId: spec.player.id,
    at: spec.at ?? (spec.player.pos ? { ...spec.player.pos } : undefined),
    dice: 'D6',
    target: spec.target,
    mods: spec.mods,
    pSingle,
    rerolls,
    pWithReroll: rerolls.length && !spec.autoFail ? pSingle + (1 - pSingle) * q * pSingle : undefined,
    onFail: spec.onFail,
    rule: spec.rule,
    extra,
    by: spec.player.team === ctx.s.turn.active ? 'active' : 'opponent',
  });
}

/** A roll that is never re-rolled here (e.g. Tentacles, Shadowing, Steady Footing). */
export function plainD6(
  ctx: Ctx,
  text: string,
  rule: RuleRef,
  success: (n: number) => boolean,
  cacheKey: string,
  /** Which result the acting coach hopes for (used by plan traces). */
  hopeFor: 'S' | 'F' = 'S',
  /** The coach who makes the roll (D6 difficulty house rule); unset = neutral. */
  by?: 'A' | 'B',
): { n: number; ok: boolean } {
  const r = ctx.roll({ dice: [6], interpret: ([n]) => (success(n) ? 'S' : 'F'), cacheKey, prefer: (v) => v === hopeFor, by });
  const n = r.faces[0];
  ctx.emit('roll', `${text}: rolled ${n} — ${r.value === 'S' ? 'success' : 'failed'}.`, rule, { natural: n });
  return { n, ok: r.value === 'S' };
}
