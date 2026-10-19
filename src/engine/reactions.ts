/**
 * What the target of a Block Action or of a Special Action that targets them
 * directly may do before it is resolved: Foul Appearance (p.128), Trickster
 * (p.138) and Dump-off (p.128); and Pile Driver's free Foul after a Block
 * (p.133).
 */
import { adjacent, eq, fmt, inBounds, neighbours, passRange } from './board';
import { checkTouchdown, catchMods } from './ball';
import { bounce } from './ball';
import { ActionStop, Ctx } from './context';
import { d6Success } from './dice';
import { performFoul } from './foul';
import { goDown } from './injury';
import { dumpOffPass } from './pass';
import { rollTest } from './roll';
import { R } from './rules';
import { gated } from './skills';
import { canUse, faq2026, hasBall, hasSkill, hasTackleZone, heldInPlace, label, markersOf, playerAt } from './state';
import type { Activation, Coord, DecisionOption, Player } from './types';

export const FA_RULE = { page: 128, title: 'Foul Appearance' };
export const TRICKSTER_RULE = { page: 138, title: 'Trickster' };
export const DUMP_OFF_RULE = { page: 128, title: 'Dump-off' };

/** Foul Appearance: the acting player rolls a D6 before any other dice; on a 1 the Action is cancelled and the activation ends. */
export function foulAppearance(ctx: Ctx, att: Player, def: Player, act: Activation, what: string): void {
  if (!hasSkill(def, 'foulAppearance')) return;
  const fa = rollTest(ctx, {
    kind: 'foulAppearance',
    player: att,
    label: `Foul Appearance of ${label(def)}`,
    target: 2,
    mods: [],
    rule: FA_RULE,
    teamReroll: true,
    proAllowed: true,
    onFail: `the ${what} is cancelled and the activation ends`,
  });
  if (!fa.success) {
    ctx.emit('block', `${label(att)} is put off by ${label(def)}: the ${what} is cancelled and the activation ends.`, FA_RULE);
    act.over = true;
    throw new ActionStop('foul appearance');
  }
}

/** Trickster, then Dump-off, for the target of a Block or a Special Action aimed at them. */
export function targetReactions(ctx: Ctx, att: Player, def: Player, opts: { trickster: boolean }): void {
  if (def.team === att.team) return;
  if (opts.trickster) trickster(ctx, att, def);
  dumpOff(ctx, def);
  if (ctx.touchdown) throw new ActionStop('touchdown');
}

/**
 * Trickster: before the dice are determined, the target may be placed in any
 * other unoccupied square adjacent to the acting player; placed on the ball,
 * they may try to pick it up before any dice are rolled.
 */
function trickster(ctx: Ctx, att: Player, def: Player): void {
  const s = ctx.s;
  if (gated('trickster') || !canUse(def, 'trickster') || !att.pos || !def.pos || (faq2026(s) ? def.rooted : heldInPlace(s, def))) return; // Rooted (Take Root) still holds the player; Chomped does NOT (FAQ May 2026 p.131/138)
  const squares = neighbours(att.pos).filter((c) => inBounds(c) && !playerAt(s, c));
  if (!squares.length) return;
  const pick = ctx.ask({
    type: 'trickster',
    team: def.team,
    prompt: `${label(def)} may use Trickster: move to another square next to ${label(att)} before the dice are rolled?`,
    options: [{ id: 'stay', label: 'Stay where they are' }, ...squares.map((c) => ({ id: `${c.x},${c.y}`, label: `Move to ${fmt(c)}${s.ball.kind === 'ground' && eq(s.ball.pos, c) ? ' (the ball is there)' : ''}`, square: c }))],
    context: { target: def.id, attacker: att.id },
    rule: TRICKSTER_RULE,
  });
  if (pick === 'stay') return;
  const [x, y] = pick.split(',').map(Number);
  const from = def.pos;
  def.pos = { x, y };
  if (def.chompedBy && faq2026(s)) {
    def.chompedBy = undefined; // being removed from the pitch and placed elsewhere ends the Chomped condition
    ctx.emit('status', `${label(def)} is no longer Chomped.`, TRICKSTER_RULE, { playerId: def.id });
  }
  ctx.emit('move', `${label(def)} uses Trickster: ${fmt(from)} → ${fmt(def.pos)}.`, TRICKSTER_RULE, { playerId: def.id, from, to: def.pos });
  if (s.ball.kind === 'ground' && eq(s.ball.pos, def.pos)) {
    // A pick-up out of the player's own Turn: a failure bounces the ball (no Turnover for either side).
    const mods = markersOf(s, def.pos, def.team).length && !canUse(def, 'bigHand') ? [{ label: `Marked x${markersOf(s, def.pos, def.team).length}`, value: -markersOf(s, def.pos, def.team).length }] : [];
    if (s.weather === 'pouringRain' && !canUse(def, 'bigHand')) mods.push({ label: 'Pouring Rain', value: -1 });
    if (canUse(def, 'extraArms')) mods.push({ label: 'Extra Arms', value: 1 });
    const res = rollTest(ctx, {
      kind: 'pickup',
      player: def,
      label: `${label(def)} picks up the ball in ${fmt(def.pos)}`,
      target: def.ag,
      mods,
      rule: R.pickUp,
      skillReroll: { id: 'sureHands', name: 'Sure Hands', available: canUse(def, 'sureHands') },
      teamReroll: false,
      proAllowed: false,
      onFail: 'the ball bounces',
      autoFail: hasSkill(def, 'noBall') ? 'No Ball' : undefined,
    });
    if (res.success) {
      s.ball = { kind: 'held', playerId: def.id };
      ctx.emit('ball', `${label(def)} picks up the ball.`, R.pickUp, { holder: def.id });
    } else bounce(ctx, def.pos);
  }
}

/** Dump-off: the targeted ball carrier may make a Quick Pass first. */
function dumpOff(ctx: Ctx, def: Player): void {
  const s = ctx.s;
  if (gated('dumpOff') || !canUse(def, 'dumpOff') || !hasBall(s, def) || hasSkill(def, 'myBall') || def.pa === null || !def.pos) return;
  const from = def.pos;
  const mates: DecisionOption[] = [];
  const others: DecisionOption[] = [];
  for (let x = from.x - 3; x <= from.x + 3; x++)
    for (let y = from.y - 3; y <= from.y + 3; y++) {
      const c = { x, y };
      if (!inBounds(c) || eq(c, from) || passRange(from, c) !== 'quick') continue;
      const q = playerAt(s, c);
      if (q && q.team === def.team && hasTackleZone(q)) {
        const mod = catchMods(ctx, q, 'pass').reduce((a, m) => a + m.value, 0);
        let pc = 0;
        for (let f = 1; f <= 6; f++) if (d6Success(f, q.ag, mod)) pc += 1 / 6;
        mates.push({ id: `${x},${y}`, label: `Quick Pass to ${label(q)} (${fmt(c)}, catch ${Math.round(pc * 100)}%)`, square: c });
      } else if (!q) others.push({ id: `${x},${y}`, label: `Quick Pass to ${fmt(c)}`, square: c });
    }
  if (!mates.length && !others.length) return;
  const pick = ctx.ask({
    type: 'dumpOff',
    team: def.team,
    prompt: `${label(def)} is targeted while holding the ball. Use Dump-off to make a Quick Pass first (no Turnover)?`,
    options: [{ id: 'no', label: 'Keep the ball' }, ...mates, ...others],
    rule: DUMP_OFF_RULE,
  });
  if (pick === 'no') return;
  const [x, y] = pick.split(',').map(Number);
  dumpOffPass(ctx, def, { x, y });
  checkTouchdown(ctx, false);
}

/**
 * Pile Driver: after Knocking Down an opponent in a Block Action, a player
 * still Standing and Marking them may make a free Foul against them (not the
 * team's Foul Action of the Turn — interpretation, docs/RULES_COVERAGE.md);
 * they are then Placed Prone and the activation ends.
 */
export function pileDriver(ctx: Ctx, att: Player, def: Player, act: Activation): void {
  if (gated('pileDriver') || !canUse(att, 'pileDriver') || def.location !== 'pitch' || def.stance === 'standing' || !att.pos || !def.pos || !adjacent(att.pos, def.pos)) return;
  const rule = { page: 133, title: 'Pile Driver' };
  const opts: DecisionOption[] = [
    { id: 'no', label: 'No Pile Driver' },
    { id: 'yes', label: `Foul ${label(def)} (Pile Driver), then be Placed Prone` },
  ];
  if (hasSkill(att, 'chainsaw')) opts.push({ id: 'chainsaw', label: `Foul ${label(def)} with the chainsaw (Pile Driver), then be Placed Prone` });
  const c = ctx.ask({ type: 'pileDriver', team: att.team, prompt: `Pile Driver: make a free Foul on ${label(def)}? ${label(att)} is then Placed Prone and the activation ends.`, options: opts, rule });
  if (c === 'no') return;
  performFoul(ctx, att, def, act, { free: true, chainsaw: c === 'chainsaw' });
  if (att.location === 'pitch' && att.stance === 'standing') goDown(ctx, att, { kind: 'placedProne', reason: 'Pile Driver' });
  act.over = true;
  throw new ActionStop('pile driver');
}
