/**
 * Activation Traits added in V4: Animal Savagery (p.123), Bloodlust (p.125)
 * and Take Root (p.137). Bone Head, Really Stupid and Unchannelled Fury are
 * in turn.ts (activationTraits), which calls these.
 */
import { adjacent, fmt } from './board';
import { bounce } from './ball';
import { ActionStop, Ctx, IllegalAction } from './context';
import { goDown, injuryRoll } from './injury';
import { rollTest } from './roll';
import { R } from './rules';
import { canUse, faq2026, hasBall, hasSkill, label, pitchPlayers, skillValue } from './state';
import type { Activation, Coord, DecisionOption, GameState, Player } from './types';
import { reachableSquares } from './routes';
import { SPECIALS } from './specials';
import { spendStar, starReady } from './stars';

export const SAVAGERY_RULE = { page: 123, title: 'Animal Savagery' };
export const BLOODLUST_RULE = { page: 125, title: 'Bloodlust' };
export const TAKE_ROOT_RULE = { page: 137, title: 'Take Root' };

/**
 * Animal Savagery: D6 (+2 for a declared Block or Blitz), 4+ to act as
 * declared. On 1-3 the player lashes out: the coach picks a Standing
 * team-mate next to them, who is Knocked Down (Claws and Mighty Blow must be
 * used on the Armour Roll; no Turnover unless that team-mate held the ball).
 * With no Standing team-mate adjacent the player becomes Distracted.
 * FAQ May 2026 p.123: after a lash-out the activation CONTINUES unless the player became
 * Distracted or a Turnover occurred.
 */
export function animalSavagery(ctx: Ctx, p: Player, act: Activation): boolean {
  const blockish = act.action === 'block' || act.action === 'blitz';
  const r = rollTest(ctx, {
    kind: 'animalSavagery',
    player: p,
    label: `${label(p)} Animal Savagery`,
    target: 4,
    mods: blockish ? [{ label: 'Block/Blitz declared', value: 2 }] : [],
    rule: SAVAGERY_RULE,
    teamReroll: true,
    proAllowed: true,
    onFail: faq2026(ctx.s) ? 'lashes out at a team-mate' : 'lashes out at a team-mate; the activation ends',
  });
  if (r.success) return true;
  // FAQ May 2026 p.123: after lashing out the player may complete the activation, unless the lash-out Distracted them or caused a Turnover.
  const goOn = (): boolean => {
    if (!faq2026(ctx.s)) { act.over = true; return false; } // matches started before the FAQ: the activation ends
    if (p.distracted || ctx.turnover || p.stance !== 'standing' || p.location !== 'pitch') { act.over = true; return false; }
    return true;
  };
  const mates = pitchPlayers(ctx.s, p.team).filter((q) => q.id !== p.id && q.stance === 'standing' && adjacent(q.pos as Coord, p.pos as Coord));
  // Glotl Stop's Primal Savagery (p.199): once per game, lash out at an adjacent Standing opposition player instead.
  const foes = starReady(ctx.s, p, 'glotl') ? pitchPlayers(ctx.s, p.team === 'A' ? 'B' : 'A').filter((q) => q.stance === 'standing' && adjacent(q.pos as Coord, p.pos as Coord)) : [];
  if (foes.length) {
    const pick0 = ctx.ask({
      type: 'animalSavagery',
      team: p.team,
      prompt: `${label(p)} lashes out (Animal Savagery). Primal Savagery (once per game): lash out at an opposition player instead?`,
      options: [...foes.map((q) => ({ id: q.id, label: `${label(q)} (${fmt(q.pos)}) — opposition, Primal Savagery`, square: q.pos as Coord })), ...mates.map((q) => ({ id: q.id, label: `${label(q)} (${fmt(q.pos)})`, square: q.pos as Coord }))],
      rule: SAVAGERY_RULE,
    });
    const foe = foes.find((q) => q.id === pick0);
    if (foe) {
      spendStar(ctx, p, `${label(p)} lashes out at the opposition player ${label(foe)} instead${faq2026(ctx.s) ? '.' : '; the activation ends.'}`);
      goDown(ctx, foe, { kind: 'knockedDown', reason: 'Animal Savagery (Primal Savagery)', savagery: p });
      return goOn();
    }
    const mate = mates.find((q) => q.id === pick0) as Player;
    ctx.emit('status', `${label(p)} lashes out at ${label(mate)}${faq2026(ctx.s) ? '.' : '; the activation ends.'}`, SAVAGERY_RULE, { playerId: mate.id });
    goDown(ctx, mate, { kind: 'knockedDown', reason: 'Animal Savagery', savagery: p, noTurnover: true });
    return goOn();
  }
  if (!mates.length) {
    p.distracted = true;
    act.over = true;
    ctx.emit('status', `${label(p)} lashes out, but no Standing team-mate is adjacent: they are Distracted and the activation ends.`, SAVAGERY_RULE);
    return false;
  }
  const pick = ctx.ask({
    type: 'animalSavagery',
    team: p.team,
    prompt: `${label(p)} lashes out (Animal Savagery). Choose the adjacent Standing team-mate who is Knocked Down.`,
    options: mates.map((q) => ({ id: q.id, label: `${label(q)} (${fmt(q.pos)})`, square: q.pos as Coord })),
    rule: SAVAGERY_RULE,
  });
  const victim = mates.find((q) => q.id === pick) as Player;
  ctx.emit('status', `${label(p)} lashes out at ${label(victim)}${faq2026(ctx.s) ? '.' : '; the activation ends.'}`, SAVAGERY_RULE, { playerId: victim.id });
  goDown(ctx, victim, { kind: 'knockedDown', reason: 'Animal Savagery', savagery: p, noTurnover: true });
  return goOn();
}

/** Take Root: a Standing player rolls a D6 when activated; on a 1 they become Rooted (the activation continues). */
export function takeRoot(ctx: Ctx, p: Player): void {
  if (p.stance !== 'standing' || p.rooted) return;
  const r = rollTest(ctx, {
    kind: 'takeRoot',
    player: p,
    label: `${label(p)} Take Root`,
    target: 2,
    mods: [],
    rule: TAKE_ROOT_RULE,
    teamReroll: true,
    proAllowed: true,
    onFail: 'becomes Rooted (cannot move or be Pushed Back)',
  });
  if (r.success) return;
  p.rooted = true;
  ctx.emit('status', `${label(p)} takes root: Rooted until Knocked Down, Placed Prone or the end of the Drive (no moving, no Follow-up, cannot be Pushed Back).`, TAKE_ROOT_RULE, { playerId: p.id, rooted: true });
}

/**
 * Bloodlust (X+): D6 (+1 for a declared Block or Blitz); X+ (and not a
 * natural 1) acts as normal. Otherwise the player may change the declared
 * Action to a Move Action and must bite an adjacent Thrall Lineman team-mate
 * before a Pass, a Hand-off or scoring, or at the end of the activation;
 * without a bite: Turnover, Distracted and the ball is dropped.
 */
export function bloodlust(ctx: Ctx, p: Player, act: Activation): void {
  const x = skillValue(p, 'bloodlust') ?? 2;
  const blockish = act.action === 'block' || act.action === 'blitz';
  const r = rollTest(ctx, {
    kind: 'bloodlust',
    player: p,
    label: `${label(p)} Bloodlust (${x}+)`,
    target: x,
    mods: blockish ? [{ label: 'Block/Blitz declared', value: 1 }] : [],
    rule: BLOODLUST_RULE,
    teamReroll: true,
    proAllowed: true,
    onFail: 'must bite a Thrall this activation (or Turnover)',
  });
  if (r.success) return;
  act.bloodlust = 'hungry';
  ctx.hungryNow = true;
  ctx.emit('status', `${label(p)} is overcome by Bloodlust: they must bite a Thrall team-mate this activation.`, BLOODLUST_RULE, { playerId: p.id });
  if (act.action !== 'move') {
    const c = ctx.ask({
      type: 'bloodlust',
      team: p.team,
      prompt: `Bloodlust: keep the declared ${act.action === 'blitz' ? 'Blitz' : act.action} Action or change it to a Move Action? (${act.action === 'blitz' ? 'The Blitz still counts as the Blitz of this Turn.' : 'Once-per-Turn Actions still count as declared.'})`,
      options: [
        { id: 'keep', label: 'Keep the declared Action' },
        { id: 'move', label: 'Change to a Move Action' },
      ],
      rule: BLOODLUST_RULE,
    });
    if (c === 'move') {
      act.action = 'move';
      act.blitzTarget = undefined;
      ctx.emit('declare', `${label(p)} changes to a Move Action (Bloodlust).`, BLOODLUST_RULE, { playerId: p.id, action: 'move' });
    }
  }
}

export function thrallsNear(ctx: Ctx | { s: Ctx['s'] }, p: Player): Player[] {
  if (!p.pos) return [];
  return pitchPlayers(ctx.s, p.team).filter((q) => q.id !== p.id && q.keywords.some((k) => k.toLowerCase() === 'thrall') && adjacent(q.pos as Coord, p.pos as Coord));
}

/** Captain Karina von Riesz's Tasty Morsel (p.196): once per game, an adjacent opposition player with ST 3 or less (not a Star Player) may be bitten as a Thrall. */
function morselsNear(ctx: Ctx | { s: Ctx['s'] }, p: Player): Player[] {
  return biteTargets(ctx.s, p).filter((q) => q.team !== p.team && adjacent(q.pos as Coord, p.pos as Coord));
}

/** Everyone a hungry player could bite anywhere on the pitch: Thrall team-mates, and Tasty Morsels for Karina (p.196). */
function biteTargets(s: GameState, p: Player): Player[] {
  if (!p.pos) return [];
  const thralls = pitchPlayers(s, p.team).filter((q) => q.id !== p.id && !!q.pos && q.keywords.some((k) => k.toLowerCase() === 'thrall'));
  const morsels = starReady(s, p, 'karina') ? pitchPlayers(s, p.team === 'A' ? 'B' : 'A').filter((q) => !!q.pos && q.st <= 3 && !q.star) : [];
  return [...morsels, ...thralls];
}

/** Bloodlust: a Thrall (or Tasty Morsel) is next to the hungry player right now. */
export function biteTargetAdjacent(s: GameState, p: Player): boolean {
  return !!p.pos && biteTargets(s, p).some((q) => adjacent(q.pos as Coord, p.pos as Coord));
}

/** Can the acting player still take steps in this activation (before any movement budget)? */
function mayStillMove(p: Player, act: Activation): boolean {
  if (p.stance !== 'standing' || p.rooted) return false;
  switch (act.action) {
    case 'move':
    case 'blitz':
      return true;
    case 'pass':
    case 'handoff':
      return !act.ballActionDone || canUse(p, 'giveAndGo');
    case 'secure':
    case 'ttm':
      return !act.ballActionDone;
    case 'foul':
      return !act.foulDone || canUse(p, 'quickFoul');
    case 'special':
      return !!act.special && !!SPECIALS[act.special]?.move && !act.specialDone;
    default:
      return false;
  }
}

/**
 * V5.5: a hungry activation (Bloodlust, p.125) that can no longer lead to a bite is settled at once, so the Turnover
 * is resolved and the Turn passes without the coach having to end the activation (or to try another player's
 * Action, which would only end it). The activation stays open while the declared Action still has its main part to
 * make (the Block of a Blitz, the Foul, the Special Action, the throw of a Throw Team-mate, a Razzle-Dazzle second
 * Action) and while the player can still move next to a Thrall (legitimate Bloodlust movement). A player who can no
 * longer move but has a Thrall next to them is asked about the bite now (the bite choice is kept).
 */
export function bloodlustSettled(s: GameState, p: Player, act: Activation): boolean {
  if (act.bloodlust !== 'hungry' || act.over || act.playerId !== p.id || p.location !== 'pitch' || !p.pos) return false;
  if (act.razzle && !act.razzle.second) return false;
  const mainPending = (act.action === 'blitz' && act.blocksDone === 0) || (act.action === 'foul' && !act.foulDone) || (act.action === 'special' && !act.specialDone) || (act.action === 'ttm' && !act.ballActionDone);
  if (mainPending) return false;
  const reach = mayStillMove(p, act) ? reachableSquares(s, p.id) : [];
  if (!reach.length) return true; // no more movement: bite the adjacent Thrall now, or the Turnover
  if (biteTargetAdjacent(s, p)) return false; // may keep moving and still bite at the end
  const targets = biteTargets(s, p);
  return !reach.some((r) => targets.some((q) => adjacent(q.pos as Coord, r.c)));
}

function bite(ctx: Ctx, p: Player, thrall: Player, act: Activation): void {
  const s = ctx.s;
  act.bloodlust = 'fed';
  if (thrall.team !== p.team) spendStar(ctx, p, `${label(p)} bites the opposition player ${label(thrall)} as if a Thrall.`);
  ctx.emit('status', `${label(p)} bites ${label(thrall)} (Bloodlust).`, BLOODLUST_RULE, { playerId: thrall.id });
  const hadBall = hasBall(s, thrall);
  const from = thrall.pos ? { ...thrall.pos } : null;
  injuryRoll(ctx, thrall, [], false, { casAsBadlyHurt: true });
  if (hadBall && from && (thrall.location !== 'pitch' || thrall.stance !== 'standing')) {
    if (thrall.team === p.team) ctx.setTurnover(`${label(thrall)} dropped the ball after being bitten`, BLOODLUST_RULE);
    s.ball = { kind: 'ground', pos: from };
    bounce(ctx, from);
  }
}

function chooseThrall(ctx: Ctx, p: Player, why: string, allowNone: boolean, noneLabel = 'Not now'): Player | null {
  const th = [...morselsNear(ctx, p), ...thrallsNear(ctx, p)];
  if (!th.length) return null;
  const opts: DecisionOption[] = th.map((q) => ({ id: q.id, label: `Bite ${label(q)}${q.team !== p.team ? ' (opposition — Tasty Morsel, once per game)' : ''}`, square: q.pos as Coord }));
  if (allowNone) opts.push({ id: 'none', label: noneLabel });
  const pick = ctx.ask({ type: 'bloodlust', team: p.team, prompt: `Bloodlust: ${why}`, options: opts, rule: BLOODLUST_RULE });
  return th.find((q) => q.id === pick) ?? null;
}

/** Before a Pass or Hand-off: a hungry player must bite a Thrall first. */
export function requireBite(ctx: Ctx, p: Player, act: Activation, what: 'pass' | 'handoff'): void {
  if (act.bloodlust !== 'hungry') return;
  const th = chooseThrall(ctx, p, `bite a Thrall before the ${what === 'pass' ? 'Pass' : 'Hand-off'}.`, false);
  if (!th) {
    const why = `Bloodlust: ${label(p)} must bite an adjacent Thrall Lineman before a ${what === 'pass' ? 'Pass' : 'Hand-off'} (p.125), and none is adjacent`;
    if (!ctx.hungryNow) throw new IllegalAction(`${why}.`);
    ctx.emit('status', `${why}: the ${what === 'pass' ? 'Pass' : 'Hand-off'} is not made.`, BLOODLUST_RULE, { playerId: p.id });
    throw new ActionStop('bloodlust: no Thrall');
  }
  bite(ctx, p, th, act);
  if (ctx.turnover) throw new ActionStop('turnover');
}

/** Before scoring: returns false (no Touchdown yet) while the ball carrier still has to bite. */
export function bloodlustMayScore(ctx: Ctx, h: Player): boolean {
  const act = ctx.s.turn.activation;
  if (!act || act.playerId !== h.id || act.bloodlust !== 'hungry') return true;
  const th = chooseThrall(ctx, h, 'bite a Thrall now so the Touchdown can be scored?', true);
  if (!th) return false;
  bite(ctx, h, th, act);
  return !ctx.turnover;
}

/** End of the activation of a hungry player (called before the activation is cleared). */
export function bloodlustEnd(ctx: Ctx, p: Player, act: Activation): void {
  if (act.bloodlust !== 'hungry' || p.location !== 'pitch') return;
  const th = chooseThrall(ctx, p, `${label(p)}'s activation ends — bite a Thrall team-mate now? Without a bite: Turnover, Distracted, and the ball is dropped.`, true, 'No bite (Turnover)');
  if (th) {
    bite(ctx, p, th, act);
    return;
  }
  const s = ctx.s;
  act.bloodlust = 'fed';
  p.distracted = p.stance === 'standing';
  ctx.setTurnover(`${label(p)} did not bite a Thrall (Bloodlust)`, BLOODLUST_RULE);
  if (hasBall(s, p) && p.pos) {
    const from = { ...p.pos };
    ctx.emit('ball', `${label(p)} drops the ball (Bloodlust).`, BLOODLUST_RULE);
    s.ball = { kind: 'ground', pos: from };
    bounce(ctx, from);
  }
  void hasSkill;
  void R;
}
