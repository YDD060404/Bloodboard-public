import { molesUnder } from './prayers';
/**
 * Special Actions granted by Skills and Traits (p.54, pp.123-138), besides
 * Throw Team-mate / Kick Team-mate and Projectile Vomit's Armour Roll which
 * live in special.ts:
 *
 *  - targeted, next to the player: Projectile Vomit (p.133), Stab (p.136),
 *    Chainsaw Attack (p.126), Breathe Fire (p.126), Chomp (Monstrous Mouth,
 *    p.131) — each may replace the Block of a Blitz — and Hypnotic Gaze
 *    (p.129, after a free Move). The target's Foul Appearance, Trickster and
 *    Dump-off apply ("a Special Action that targets this player directly").
 *  - Throw Bomb (Bombardier, p.125), Punt (p.134), Ball & Chain (p.124).
 *
 * Violent Innovator (p.138): a Casualty caused by one of this player's
 * Special Actions earns them Star Player Points.
 */
import { pitch } from './variant';
import { adjacent, add, eq, facingDirection, fmt, FACING_LABEL, inBounds, neighbours, passRange, RANGE_LABEL } from './board';
import { ballArrives, bounce, catchMods, checkTouchdown, scatter, throwIn } from './ball';
import { performBlock, pushAway } from './block';
import { ActionStop, Ctx, IllegalAction } from './context';
import { clampD6, d6Success } from './dice';
import { armourAndInjury, crowdInjury, goDown, injuryRoll, moveOffPitch, oldPro, type ModSource } from './injury';
import { askStar, sneakyPair, spendStar, STAR_BY_ID, starReady, starRuleRef } from './stars';
import { maxRushes } from './move';
import { interceptAttempt, interceptors, passInfo } from './pass';
import { foulAppearance, targetReactions } from './reactions';
import { rollTest } from './roll';
import { R } from './rules';
import { canUse, faq2026, hasBall, hasSkill, hasTackleZone, label, other, pitchPlayers, playerAt } from './state';
import type { Activation, Coord, DecisionOption, Facing, GameState, Player, SpecialId } from './types';

export interface SpecialInfo {
  id: SpecialId;
  /** Name of the Special Action. */
  name: string;
  /** Skill or Trait granting it. */
  skill: string;
  page: number;
  /** Aimed at an adjacent Standing opposition player. */
  targeted: boolean;
  /** May replace the Block of a Blitz Action. */
  blitz: boolean;
  /** A free Move Action may come first (and it may be declared while Prone, p.121). */
  move: boolean;
  /** Only one player per Turn may declare it (TurnState.used key). */
  once?: 'bomb' | 'punt' | 'ktm';
}

export const SPECIALS: Record<SpecialId, SpecialInfo> = {
  projectileVomit: { id: 'projectileVomit', name: 'Projectile Vomit', skill: 'projectileVomit', page: 133, targeted: true, blitz: true, move: false },
  stab: { id: 'stab', name: 'Stab', skill: 'stab', page: 136, targeted: true, blitz: true, move: false },
  chainsaw: { id: 'chainsaw', name: 'Chainsaw Attack', skill: 'chainsaw', page: 126, targeted: true, blitz: true, move: false },
  breatheFire: { id: 'breatheFire', name: 'Breathe Fire', skill: 'breatheFire', page: 126, targeted: true, blitz: true, move: false },
  monstrousMouth: { id: 'monstrousMouth', name: 'Chomp', skill: 'monstrousMouth', page: 131, targeted: true, blitz: true, move: false },
  hypnoticGaze: { id: 'hypnoticGaze', name: 'Hypnotic Gaze', skill: 'hypnoticGaze', page: 129, targeted: true, blitz: false, move: true },
  bombardier: { id: 'bombardier', name: 'Throw Bomb', skill: 'bombardier', page: 125, targeted: false, blitz: false, move: false, once: 'bomb' },
  punt: { id: 'punt', name: 'Punt', skill: 'punt', page: 134, targeted: false, blitz: false, move: true, once: 'punt' },
  kickTeamMate: { id: 'kickTeamMate', name: 'Kick Team-mate', skill: 'kickTeamMate', page: 130, targeted: false, blitz: false, move: true, once: 'ktm' },
  ballAndChain: { id: 'ballAndChain', name: 'Ball & Chain', skill: 'ballAndChain', page: 124, targeted: false, blitz: false, move: false },
};

export const SPECIAL_ORDER: SpecialId[] = ['projectileVomit', 'stab', 'chainsaw', 'breatheFire', 'monstrousMouth', 'hypnoticGaze', 'bombardier', 'punt', 'kickTeamMate', 'ballAndChain'];

const rule = (id: SpecialId) => ({ page: SPECIALS[id].page, title: SPECIALS[id].name });

/** Special Actions this player's Skills and Traits grant. */
export function specialsOf(p: Player): SpecialId[] {
  // Bilerot Vomitflesh's Putrid Regurgitation (p.195): Projectile Vomit once per half without the Trait.
  return SPECIAL_ORDER.filter((id) => hasSkill(p, SPECIALS[id].skill) || (id === 'projectileVomit' && p.star === 'bilerot'));
}

/** Players a targeted Special Action could aim at from `from`. */
export function specialTargets(s: GameState, p: Player, id: SpecialId, from: Coord | null = p.pos): Player[] {
  if (!from || !SPECIALS[id].targeted) return [];
  return pitchPlayers(s).filter((q) => q.team !== p.team && q.stance === 'standing' && !!q.pos && adjacent(q.pos, from));
}

/** Casualty credit for Violent Innovator (p.138). */
function vi(p: Player): Player | undefined {
  return hasSkill(p, 'violentInnovator') ? p : undefined;
}

/**
 * An Armour Roll against `v` (+mod, which Iron Hard Skin cancels, p.129), then
 * an Injury Roll if the armour breaks. The ball of a carrier who ends up down
 * or off the pitch bounces.
 */
export function specialArmour(ctx: Ctx, v: Player, mod: number, why: string, rl: { page: number; title: string }, credit?: Player, stabBy?: Player, attacker?: Player): void {
  const s = ctx.s;
  const hadBall = hasBall(s, v);
  const from = v.pos ? { ...v.pos } : null;
  // Dribl & Drull's A Sneaky Pair (p.198): +1 to a Stab against a player Marked by both.
  const pair = stabBy && sneakyPair(s, stabBy, v) ? 1 : 0;
  const m = hasSkill(v, 'ironHardSkin') ? 0 : mod + pair;
  const rollIt = () => ctx.roll({ dice: [6, 6], interpret: ([a, b]) => (a + b + m >= v.av ? 'broken' : 'holds'), cacheKey: `armourfixed|${v.av}|${m}`, by: v.team === 'A' ? 'B' : 'A', judge: (x) => (x === 'broken' ? 1 : -1) });
  let ar = rollIt();
  const report = (prefix: string) => {
    const [a, b] = ar.faces;
    ctx.emit('roll', `${prefix}Armour Roll for ${label(v)} (${why}${pair && m ? ', +1 A Sneaky Pair' : ''}): ${a}+${b}${m ? ` +${m}` : ''}=${a + b + m} vs AV ${v.av}+ — ${ar.value === 'broken' ? 'armour broken' : 'armour holds, nothing happens'}.`, rl, { playerId: v.id, faces: [a, b], av: v.av, broken: ar.value === 'broken', armour: true });
  };
  report('');
  // Helmut Wulf's Old Pro (p.202): Pro to re-roll one die of the Armour Roll of his chainsaw (or against him).
  const helmut = attacker?.star === 'helmut' ? attacker : v.star === 'helmut' ? v : undefined;
  const redo = oldPro(ctx, helmut, v, ar.faces, ar.value === 'broken', (a, b) => a + b + m >= v.av);
  if (redo) ar = { faces: redo, value: redo[0] + redo[1] + m >= v.av ? 'broken' : 'holds' };
  // Skitter Stab-Stab's Master Assassin (p.208): once per game, re-roll the Armour Roll of a Stab.
  if (ar.value !== 'broken' && stabBy && starReady(s, stabBy, 'skitter') && askStar(ctx, stabBy, `the armour of ${label(v)} held. Re-roll the Armour Roll?`, 'Re-roll the Armour Roll', true)) {
    spendStar(ctx, stabBy, `the Stab's Armour Roll is re-rolled.`);
    ar = rollIt();
    report('Re-roll — ');
  }
  if (ar.value !== 'broken') return;
  // Rashnak Backstabber's Toxin Connoisseur (p.206): once per game, +1 to the Injury Roll after a Stab broke the armour.
  const toxin: ModSource[] = stabBy && starReady(s, stabBy, 'rashnak') ? [{ who: stabBy, skill: 'star', used: false, value: 1, stage: 'injury' }] : [];
  injuryRoll(ctx, v, toxin, false, { credit });
  if (hadBall && from && (v.location !== 'pitch' || v.stance !== 'standing')) {
    if (v.team === s.turn.active) ctx.setTurnover(`${label(v)} lost the ball`, R.turnover);
    s.ball = { kind: 'ground', pos: from };
    ctx.emit('ball', `The ball bounces from ${fmt(from)}.`, R.scatter);
    bounce(ctx, from);
  }
}

/**
 * A targeted Special Action by `p` against the adjacent Standing `target`.
 * `blitz`: it replaces the Block of a Blitz (the movement for it is paid by
 * the caller). Most end the activation; Chomp during a Blitz does not.
 */
export function performTargetedSpecial(ctx: Ctx, p: Player, target: Player, act: Activation, id: SpecialId, blitz: boolean, downTarget = false): void {
  const info = SPECIALS[id];
  if (!info.targeted) throw new IllegalAction(`${info.name} does not target a player.`);
  if (!hasSkill(p, info.skill) && !(id === 'projectileVomit' && p.star === 'bilerot')) throw new IllegalAction(`This player cannot perform ${info.name}.`);
  if (p.stance !== 'standing' || !p.pos) throw new IllegalAction(`${info.name}: the player must be Standing.`);
  // downTarget: Nobbla Blackwart's Kick 'em While They're Down! (a Chainsaw Attack on a Prone or Stunned player).
  if (target.team === p.team || target.location !== 'pitch' || (downTarget ? target.stance === 'standing' : target.stance !== 'standing') || !target.pos || !adjacent(target.pos, p.pos)) {
    throw new IllegalAction(`${info.name} needs a ${downTarget ? 'Prone or Stunned' : 'Standing'} opposition player next to this player (p.${info.page}).`);
  }
  if ((id === 'breatheFire' || id === 'monstrousMouth') && !hasTackleZone(p)) throw new IllegalAction(`${info.name}: the player must Mark the target.`);
  const rl = rule(id);
  ctx.emit('declare', `${label(p)} uses ${info.name} on ${label(target)}${blitz ? ' instead of the Block' : ''}.`, rl, { playerId: p.id, target: target.id, special: id });
  if (!downTarget) {
    foulAppearance(ctx, p, target, act, info.name);
    targetReactions(ctx, p, target, { trickster: true });
  }
  if (target.location !== 'pitch' || (downTarget ? target.stance === 'standing' : target.stance !== 'standing') || !target.pos || !adjacent(target.pos, p.pos)) {
    ctx.emit('note', `${label(target)} is no longer a Standing player next to ${label(p)}: ${info.name} has no effect.`, rl);
    act.over = true;
    return;
  }
  act.specialDone = true;
  switch (id) {
    case 'projectileVomit': {
      const r = rollTest(ctx, { kind: 'projectileVomit', player: p, label: `${label(p)} Projectile Vomit`, target: 2, mods: [], rule: rl, teamReroll: true, proAllowed: true, onFail: 'covers themselves in bile (own Armour Roll)', at: target.pos });
      const victim = r.success ? target : p;
      ctx.emit('status', r.success ? `${label(p)} vomits on ${label(target)}.` : `${label(p)} covers themselves in acidic bile!`, rl, { playerId: victim.id });
      specialArmour(ctx, victim, 0, 'cannot be modified', rl, victim === target ? vi(p) : undefined);
      act.over = true;
      return;
    }
    case 'stab':
      specialArmour(ctx, target, 0, 'Stab: cannot be modified', rl, vi(p), p);
      act.over = true;
      return;
    case 'chainsaw': {
      const r = rollTest(ctx, { kind: 'chainsaw', player: p, label: `${label(p)} Chainsaw Attack (Kick-back on a 1)`, target: 2, mods: [], rule: rl, teamReroll: true, proAllowed: true, onFail: 'Kick-back: the player is Knocked Down', at: target.pos });
      act.over = true;
      if (!r.success) {
        ctx.emit('status', 'Kick-back! The chainsaw bucks and hits its owner.', rl);
        goDown(ctx, p, { kind: 'knockedDown', reason: 'chainsaw Kick-back' });
        throw new ActionStop('kick-back');
      }
      specialArmour(ctx, target, 3, '+3 chainsaw', rl, vi(p), undefined, p);
      // Max Spleenripper's Maximum Carnage (p.205): once per game, another Chainsaw Attack on a different opponent.
      if (starReady(ctx.s, p, 'maxSpleenripper') && p.location === 'pitch' && p.stance === 'standing' && !ctx.turnover) {
        const more = specialTargets(ctx.s, p, 'chainsaw').filter((q) => q.id !== target.id);
        if (more.length) {
          const id2 = ctx.ask({ type: 'starRule', team: p.team, prompt: 'Maximum Carnage (Max Spleenripper, once per game): another Chainsaw Attack on a different opponent?', options: [...more.map((q) => ({ id: q.id, label: `Chainsaw ${label(q)}`, square: q.pos ?? undefined })), { id: 'no', label: 'No' }], rule: starRuleRef(STAR_BY_ID.maxSpleenripper), context: { star: 'maxSpleenripper', helps: true } });
          const q2 = more.find((q) => q.id === id2);
          if (q2) {
            spendStar(ctx, p, `a second Chainsaw Attack, on ${label(q2)}.`);
            performTargetedSpecial(ctx, p, q2, act, 'chainsaw', false);
          }
        }
      }
      return;
    }
    case 'breatheFire': {
      const big = target.st >= 5;
      const r = rollTest(ctx, {
        kind: 'breatheFire',
        player: p,
        label: `${label(p)} Breathe Fire at ${label(target)}`,
        target: 4,
        mods: big ? [{ label: 'target ST 5+', value: -1 }] : [],
        rule: rl,
        outcome: (n, m) => (n === 6 ? 'kd' : n === 1 || n + m <= 1 ? 'self' : n + m <= 3 ? 'none' : 'prone'),
        outcomeKey: `bf${big ? 1 : 0}`,
        isSuccess: (o) => o === 'kd' || o === 'prone',
        teamReroll: true,
        proAllowed: true,
        onFail: '1: the player is Knocked Down; 2-3: nothing happens',
        at: target.pos,
      });
      act.over = true;
      if (r.outcome === 'self') {
        ctx.emit('status', `${label(p)} is caught by their own flames!`, rl);
        goDown(ctx, p, { kind: 'knockedDown', reason: 'Breathe Fire backfires' });
        throw new ActionStop('breathe fire');
      }
      if (r.outcome === 'none') {
        ctx.emit('status', 'The flames miss: nothing happens.', rl);
        return;
      }
      if (r.outcome === 'kd') goDown(ctx, target, { kind: 'knockedDown', reason: 'Breathe Fire (natural 6)', credit: vi(p) });
      else goDown(ctx, target, { kind: 'placedProne', reason: 'Breathe Fire' });
      checkTouchdown(ctx, false);
      return;
    }
    case 'monstrousMouth': {
      const r = rollTest(ctx, { kind: 'chomp', player: p, label: `${label(p)} Chomp`, target: 3, mods: [], rule: rl, teamReroll: true, proAllowed: true, onFail: 'nothing happens', at: target.pos });
      if (r.success) {
        target.chompedBy = p.id;
        ctx.emit('status', `${label(target)} is Chomped: they cannot leave their square while ${label(p)} Marks them.`, rl, { playerId: target.id, chomped: true });
      } else ctx.emit('status', 'The jaws snap shut on nothing.', rl);
      if (!blitz) act.over = true;
      return;
    }
    case 'hypnoticGaze': {
      const r = rollTest(ctx, { kind: 'hypnoticGaze', player: p, label: `${label(p)} Hypnotic Gaze`, target: 3, mods: [], rule: rl, teamReroll: true, proAllowed: true, onFail: 'nothing happens', at: target.pos });
      if (r.success) {
        target.distracted = true;
        ctx.emit('status', `${label(target)} is hypnotised: Distracted until next activated (no Tackle Zone).`, rl, { playerId: target.id });
      } else ctx.emit('status', 'The gaze has no effect.', rl);
      act.over = true;
      return;
    }
    default:
      throw new IllegalAction(`${info.name} is not a targeted Special Action.`);
  }
}

// ---------------------------------------------------------------------------
// Throw Bomb (Bombardier, p.125)
// ---------------------------------------------------------------------------

export const BOMB_RULE = rule('bombardier');

/**
 * Throw Bomb: thrown like a Pass (range, Passing Ability Test, the skills
 * that apply to passes, Interceptions) without moving first. A bomb that comes
 * to rest explodes: the player in that square is hit, each adjacent player on
 * a 4+. Standing players hit are Knocked Down; Prone or Stunned ones get an
 * Armour Roll. A caught or intercepted bomb must be thrown again at once.
 */
export function performThrowBomb(ctx: Ctx, p: Player, target: Coord, hailMary: boolean, act: Activation): void {
  if (!hasSkill(p, 'bombardier')) throw new IllegalAction('Only a player with Bombardier can Throw a Bomb (p.125).');
  if (p.pa === null) throw new IllegalAction('This player has no Passing Ability (PA "-").');
  if (p.stance !== 'standing' || !p.pos) throw new IllegalAction('The bomber must be Standing.');
  const info = passInfo(ctx, p, p.pos, target, hailMary);
  if (typeof info === 'string') throw new IllegalAction(info);
  act.ballActionDone = true;
  act.specialDone = true;
  act.over = true;
  throwBomb(ctx, p, target, hailMary, 0);
}

function throwBomb(ctx: Ctx, p: Player, target: Coord, hailMary: boolean, depth: number): void {
  const s = ctx.s;
  if (depth > 20) {
    ctx.emit('note', 'The bomb has been thrown back and forth long enough: it fizzles out.', BOMB_RULE);
    return;
  }
  const from = p.pos as Coord;
  const info = passInfo(ctx, p, from, target, hailMary);
  if (typeof info === 'string') throw new IllegalAction(info);
  ctx.emit('declare', `${label(p)} throws a bomb (${hailMary ? 'Hail Mary' : RANGE_LABEL[info.range]}) at ${fmt(target)}.`, BOMB_RULE, { from, target, bomb: true });
  const pa = p.pa as number;
  const safePass = canUse(p, 'safePass');
  const res = rollTest(ctx, {
    kind: 'bomb',
    player: p,
    label: `Passing Ability Test (Throw Bomb, ${hailMary ? 'Hail Mary' : RANGE_LABEL[info.range]})`,
    target: pa,
    mods: info.mods,
    rule: BOMB_RULE,
    outcome: (n, m) => {
      if (n === 1) return safePass ? 'safe' : 'fumble';
      if (n !== 6 && clampD6(n + m) <= 1) return 'fumble';
      if (d6Success(n, pa, m)) return hailMary ? 'inaccurate' : 'accurate';
      return 'inaccurate';
    },
    outcomeKey: `bomb${pa}|${safePass}|${hailMary}`,
    isSuccess: (o) => o === (hailMary ? 'inaccurate' : 'accurate'),
    skillReroll: { id: 'pass', name: 'Pass', available: canUse(p, 'pass') },
    teamReroll: true,
    proAllowed: true,
    onFail: 'Inaccurate (Scatter 3) or Fumbled (explodes in the thrower\'s square)',
    at: target,
  });
  if (res.outcome === 'safe') {
    ctx.emit('status', `Safe Pass: the natural 1 is not a Fumble — ${label(p)} keeps hold of the bomb, which is not thrown and fizzles out (interpretation).`, { page: 135, title: 'Safe Pass' });
    return;
  }
  if (res.outcome === 'fumble') {
    ctx.emit('status', `Fumbled bomb! It explodes in ${label(p)}'s square.`, BOMB_RULE);
    explode(ctx, from, p);
    return;
  }
  let landing: Coord | null = target;
  if (res.outcome === 'inaccurate') {
    const sc = scatter(ctx, target, 3, 'Inaccurate bomb');
    landing = 'land' in sc ? sc.land : null;
  }
  if (!landing) {
    ctx.emit('status', 'The bomb sails into the crowd and explodes harmlessly off the pitch (interpretation).', BOMB_RULE);
    return;
  }
  // Interception (as a Pass, p.71).
  if (!hailMary) {
    const cands = interceptors(ctx, p, from, landing);
    if (cands.length) {
      const pick = ctx.ask({
        type: 'interceptor',
        team: other(p.team),
        prompt: `A bomb is flying over ${cands.length} of your Standing players. Attempt to Intercept it (the interceptor must then throw it)?`,
        options: [{ id: 'none', label: 'Let it fly' }, ...cands.map((q) => ({ id: q.id, label: `Intercept with ${label(q)}`, square: q.pos as Coord }))],
        rule: R.interception,
        context: { from, landing, accurate: res.outcome === 'accurate', bomb: true },
      });
      if (pick !== 'none') {
        const q = cands.find((c) => c.id === pick) as Player;
        if (interceptAttempt(ctx, q, res.outcome === 'accurate', 'the bomb', 'the bomb flies on')) {
          ctx.emit('status', `${label(q)} intercepts the bomb and must throw it at once!`, BOMB_RULE);
          rethrow(ctx, q, depth + 1);
          return;
        }
      }
    }
  }
  ctx.emit('status', `The bomb comes down in ${fmt(landing)}.`, BOMB_RULE, { landing });
  const occ = playerAt(s, landing);
  if (occ && hasTackleZone(occ) && !hasSkill(occ, 'noBall')) {
    const cr = rollTest(ctx, {
      kind: 'catch',
      player: occ,
      label: `${label(occ)} catches the bomb`,
      target: occ.ag,
      mods: catchMods(ctx, occ, eq(landing, target) ? 'passTarget' : 'pass'),
      rule: BOMB_RULE,
      skillReroll: { id: 'catch', name: 'Catch', available: canUse(occ, 'catch') },
      teamReroll: true,
      proAllowed: false,
      onFail: 'the bomb explodes in their square',
      notBall: true,
    });
    if (cr.success) {
      // Bomber Dribblesnot's Kaboom! (p.196): once per game, an opponent who catches his bomb has it explode.
      if (occ.team !== p.team && depth === 0 && starReady(ctx.s, p, 'bomber') && askStar(ctx, p, `${label(occ)} caught the bomb. Make it explode now instead of being thrown on?`, 'Kaboom!: it explodes', true)) {
        spendStar(ctx, p, `the bomb explodes in ${label(occ)}'s hands.`);
        explode(ctx, landing, p);
        return;
      }
      ctx.emit('status', `${label(occ)} catches the bomb and must throw it again at once!`, BOMB_RULE);
      rethrow(ctx, occ, depth + 1);
      return;
    }
    ctx.emit('status', `${label(occ)} drops the bomb!`, BOMB_RULE);
  }
  explode(ctx, landing, p);
}

/** Squares a player who caught a bomb may throw it at (in range and next to or on a player), best first. */
export function bombTargets(s: GameState, p: Player): Coord[] {
  const from = p.pos as Coord;
  const scored: Array<{ c: Coord; v: number }> = [];
  const g = pitch();
  for (let x = 0; x < g.w; x++)
    for (let y = 0; y < g.h; y++) {
      const c = { x, y };
      if (eq(c, from)) continue;
      const r = passRange(from, c);
      if (!r || (s.weather === 'blizzard' && (r === 'long' || r === 'bomb'))) continue;
      let v = 0;
      let near = false;
      for (const q of pitchPlayers(s)) {
        if (!q.pos) continue;
        const d = Math.max(Math.abs(q.pos.x - x), Math.abs(q.pos.y - y));
        if (d > 1) continue;
        near = true;
        const w = d === 0 ? 1 : 0.5;
        v += q.team === p.team ? -2 * w : w;
      }
      if (near) scored.push({ c, v });
    }
  scored.sort((a, b) => b.v - a.v || a.c.x - b.c.x || a.c.y - b.c.y);
  return scored.map((x) => x.c);
}

function rethrow(ctx: Ctx, q: Player, depth: number): void {
  if (q.pa === null) {
    ctx.emit('status', `${label(q)} has no Passing Ability (PA "-") and cannot throw the bomb: it explodes in their hands (interpretation).`, BOMB_RULE);
    explode(ctx, q.pos as Coord, q);
    return;
  }
  const targets = bombTargets(ctx.s, q);
  if (!targets.length) {
    explode(ctx, q.pos as Coord, q);
    return;
  }
  const pick = ctx.ask({
    type: 'bombThrow',
    team: q.team,
    prompt: `${label(q)} must throw the bomb again at once. Choose the target square.`,
    options: targets.map((c) => ({ id: `${c.x},${c.y}`, label: `${fmt(c)}${playerAt(ctx.s, c) ? ` (${label(playerAt(ctx.s, c) as Player)})` : ''}`, square: c })),
    rule: BOMB_RULE,
  });
  const [x, y] = pick.split(',').map(Number);
  throwBomb(ctx, q, { x, y }, false, depth);
}

/** A bomb explodes in `sq` (p.125). */
function explode(ctx: Ctx, sq: Coord, thrower: Player): void {
  const s = ctx.s;
  ctx.emit('status', `BOOM! The bomb explodes in ${fmt(sq)}.`, BOMB_RULE, { explosion: sq });
  const hit: Player[] = [];
  const occ = playerAt(s, sq);
  if (occ) hit.push(occ);
  for (const c of neighbours(sq)) {
    const q = playerAt(s, c);
    if (!q) continue;
    const r = ctx.roll({ dice: [6], interpret: ([n]) => (n >= 4 ? 'hit' : 'miss'), cacheKey: 'blast4' });
    ctx.emit('roll', `Blast for ${label(q)}: rolled ${r.faces[0]} — ${r.value === 'hit' ? 'hit' : 'missed'}.`, BOMB_RULE);
    if (r.value === 'hit') hit.push(q);
  }
  for (const q of hit) {
    if (q.location !== 'pitch') continue;
    const credit = q.team !== thrower.team ? vi(thrower) : undefined;
    if (q.stance === 'standing') goDown(ctx, q, { kind: 'knockedDown', reason: 'bomb blast', credit });
    else armourAndInjury(ctx, q, { kind: 'knockedDown', reason: 'bomb blast', credit });
  }
  checkTouchdown(ctx, false);
}

// ---------------------------------------------------------------------------
// Punt (p.134)
// ---------------------------------------------------------------------------

export const PUNT_RULE = rule('punt');

/**
 * Punt: after the free Move, a ball carrier kicks the ball: D6 on a Throw-in
 * Template facing the chosen End Zone or Sideline for the direction, a second
 * D6 for the distance (Kick: either or both may be re-rolled, the direction
 * before the distance is rolled). The ball flies over the squares in between
 * and lands: a player there must try to Catch it, otherwise it Bounces. No
 * Turnover for a ball on the ground; a Turnover if an opposition player has it
 * afterwards, or it went into the crowd.
 */
export function performPunt(ctx: Ctx, p: Player, facing: Facing, act: Activation): void {
  const s = ctx.s;
  act.specialDone = true;
  act.over = true;
  if (!hasBall(s, p)) throw new IllegalAction(`${label(p)} must be holding the ball to Punt it (p.134).`);
  act.ballActionDone = true;
  const kick = canUse(p, 'kick');
  ctx.emit('declare', `${label(p)} punts the ball ${FACING_LABEL[facing]}.`, PUNT_RULE, { facing });
  const dirRoll = () => ctx.roll({ dice: [6], interpret: ([n]) => n, cacheKey: 'puntdir' });
  let d = dirRoll();
  ctx.emit('roll', `Punt direction: D6 ${d.value} (${d.value <= 2 ? 'left diagonal' : d.value <= 4 ? 'straight' : 'right diagonal'}).`, PUNT_RULE);
  if (kick) {
    const c = ctx.ask({ type: 'punt', team: p.team, prompt: `Punt direction D6 ${d.value}. Re-roll it (Kick)?`, options: [{ id: 'keep', label: 'Keep the direction' }, { id: 'reroll', label: 'Re-roll the direction (Kick)' }], rule: { page: 130, title: 'Kick' } });
    if (c === 'reroll') {
      d = dirRoll();
      ctx.emit('roll', `Kick: direction re-rolled — D6 ${d.value}.`, { page: 130, title: 'Kick' });
    }
  }
  const distRoll = () => ctx.roll({ dice: [6], interpret: ([n]) => n, cacheKey: 'puntdist' });
  let n = distRoll();
  ctx.emit('roll', `Punt distance: D6 ${n.value} squares.`, PUNT_RULE);
  if (kick) {
    const c = ctx.ask({ type: 'punt', team: p.team, prompt: `Punt distance ${n.value}. Re-roll it (Kick)?`, options: [{ id: 'keep', label: 'Keep the distance' }, { id: 'reroll', label: 'Re-roll the distance (Kick)' }], rule: { page: 130, title: 'Kick' } });
    if (c === 'reroll') {
      n = distRoll();
      ctx.emit('roll', `Kick: distance re-rolled — D6 ${n.value}.`, { page: 130, title: 'Kick' });
    }
  }
  const dir = facingDirection(facing, d.value);
  let cur = p.pos as Coord;
  s.ball = { kind: 'none' };
  for (let i = 0; i < n.value; i++) {
    const next = add(cur, dir);
    if (!inBounds(next)) {
      ctx.emit('ball', `The punt goes into the crowd beyond ${fmt(cur)}: Turnover, and the fans throw it back.`, PUNT_RULE);
      ctx.setTurnover('the Punt went into the crowd', PUNT_RULE);
      throwIn(ctx, cur, next);
      checkTouchdown(ctx, false);
      throw new ActionStop('punt out');
    }
    cur = next;
  }
  ctx.emit('ball', `The punt comes down in ${fmt(cur)}.`, PUNT_RULE, { landing: cur });
  ballArrives(ctx, cur, 'punt');
  const ball = s.ball as GameState['ball'];
  const h = ball.kind === 'held' ? s.players.find((q) => q.id === ball.playerId) : undefined;
  checkTouchdown(ctx, false);
  if (h && h.team !== p.team) {
    ctx.setTurnover('an opposition player has the ball after the Punt', PUNT_RULE);
    throw new ActionStop('punt caught');
  }
}

// ---------------------------------------------------------------------------
// Ball & Chain (p.124)
// ---------------------------------------------------------------------------

export const BNC_RULE = rule('ballAndChain');

/**
 * One square of a Ball & Chain Special Action: the Throw-in Template faces the
 * chosen End Zone or Sideline and a D6 picks the square. No Dodges (and no
 * Shadowing or Tentacles). Into a Standing player: an automatic Block (Foul
 * Appearance ignored; against a team-mate their own coach picks the result).
 * Into a Prone or Stunned player: they are Pushed Back and get an Armour
 * Roll. Into the ball: it Bounces (no Turnover). Off the pitch: Injury by the
 * Crowd. Rushes as normal; a failed Rush still moves (and blocks, pushes...)
 * first, then the player Falls Over.
 */
export function ballAndChainStep(ctx: Ctx, p: Player, facing: Facing, act: Activation): void {
  const s = ctx.s;
  if (!hasSkill(p, 'ballAndChain')) throw new IllegalAction('Only a Ball & Chain player makes this Special Action.');
  if (p.stance !== 'standing' || !p.pos) throw new IllegalAction('The Ball & Chain player must be Standing.');
  const maLeft = p.ma - act.maUsed;
  const rushLeft = maxRushes(p) - act.rushesUsed;
  if (maLeft <= 0 && rushLeft <= 0) throw new IllegalAction(`${label(p)} has no movement left.`);
  let rushFailed = false;
  if (maLeft > 0) act.maUsed += 1;
  else {
    act.rushesUsed += 1;
    const mods = [];
    if (s.weather === 'blizzard') mods.push({ label: 'Blizzard', value: -1 });
    if (hasSkill(p, 'drunkard')) mods.push({ label: 'Drunkard', value: -1 });
    if (molesUnder(s, p)) mods.push({ label: 'Moles under the Pitch', value: -1 });
    const res = rollTest(ctx, {
      kind: 'rush',
      player: p,
      label: `Rush ${act.rushesUsed} (Ball & Chain)`,
      target: 2,
      mods,
      rule: R.rush,
      skillReroll: { id: 'sureFeet', name: 'Sure Feet', available: canUse(p, 'sureFeet') && !p.usage.sureFeet, markUsed: () => (p.usage.sureFeet = true) },
      teamReroll: true,
      proAllowed: true,
      onFail: 'moves, then Falls Over',
    });
    rushFailed = !res.success;
  }
  let r = ctx.roll({ dice: [6], interpret: ([n]) => n, cacheKey: 'bncdir' });
  const from = p.pos;
  // Fungus the Loon's Whirling Dervish (p.199): once per activation, re-roll the direction D6.
  if (starReady(s, p, 'fungus')) {
    const to0 = add(from, facingDirection(facing, r.value));
    const occ0 = inBounds(to0) ? playerAt(s, to0) : undefined;
    const bad = !inBounds(to0) || (!!occ0 && occ0.team === p.team);
    if (askStar(ctx, p, `the direction D6 is ${r.value} (→ ${inBounds(to0) ? fmt(to0) : 'off the pitch'}). Re-roll it?`, 'Re-roll the direction', bad, 'Keep it')) {
      spendStar(ctx, p, `the direction D6 ${r.value} is re-rolled.`);
      r = ctx.roll({ dice: [6], interpret: ([n]) => n, cacheKey: 'bncdir' });
    }
  }
  const to = add(from, facingDirection(facing, r.value));
  ctx.emit('roll', `Ball & Chain: template ${FACING_LABEL[facing]}, D6 ${r.value} → ${inBounds(to) ? fmt(to) : 'off the pitch'}.`, BNC_RULE, { playerId: p.id, from, to });
  if (!inBounds(to)) {
    ctx.emit('move', `${label(p)} whirls off the pitch into the crowd!`, BNC_RULE, { playerId: p.id, crowd: true });
    moveOffPitch(p, 'reserves');
    act.over = true;
    ctx.setTurnover(`${label(p)} went into the crowd`, BNC_RULE);
    crowdInjury(ctx, p);
    throw new ActionStop('crowd');
  }
  const occ = playerAt(s, to);
  if (occ && occ.stance === 'standing') {
    performBlock(ctx, p, occ, { isBlitz: false, declaredBlock: false, ballAndChain: true }, act);
  } else if (occ) {
    ctx.emit('push', `${label(p)} crashes into the fallen ${label(occ)}.`, BNC_RULE);
    const out = pushAway(ctx, p, from, occ);
    if (!out.crowd && occ.location === 'pitch') armourAndInjury(ctx, occ, { kind: 'knockedDown', reason: 'hit by the Ball & Chain', credit: vi(p) });
    if (!playerAt(s, to) && p.location === 'pitch' && p.stance === 'standing') moveInto(ctx, p, to);
  } else moveInto(ctx, p, to);
  if (rushFailed && p.location === 'pitch' && p.stance === 'standing') {
    if (!(goDown(ctx, p, { kind: 'fellOver', reason: 'failed Rush' }).avoided && faq2026(ctx.s))) throw new ActionStop('fell');
  }
  if (ctx.turnover) throw new ActionStop('turnover');
}

function moveInto(ctx: Ctx, p: Player, to: Coord): void {
  const s = ctx.s;
  const from = p.pos as Coord;
  p.pos = { ...to };
  ctx.emit('move', `${label(p)} moves ${fmt(from)} → ${fmt(to)} (Ball & Chain).`, BNC_RULE, { playerId: p.id, from, to });
  if (s.ball.kind === 'ground' && eq(s.ball.pos, to)) {
    ctx.emit('ball', 'The ball is sent bouncing (no Turnover).', BNC_RULE);
    bounce(ctx, to);
  }
}

export function specialOptionsList(p: Player): DecisionOption[] {
  return specialsOf(p).map((id) => ({ id, label: SPECIALS[id].name }));
}

void clampD6;
