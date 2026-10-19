/**
 * Throw Team-mate Action (p.76-78) with Right Stuff (p.135), Always Hungry
 * (p.123), Strong Arm (p.136), Bullseye (p.126), Swoop (p.137) and Lethal
 * Flight (p.130); the Kick Team-mate Special Action (p.130) uses the same
 * code. Projectile Vomit and the other Special Actions are in specials.ts.
 */
import { adjacent, add, eq, facingDirection, FACING_LABEL, fmt, inBounds, passRange, RANGE_LABEL, type PassRange } from './board';
import { performTargetedSpecial } from './specials';
import { awardSpp } from './spp';
import { ballDisplacedBy, bounce, checkTouchdown, disturbingPresenceMods, scatterPath, throwIn } from './ball';
import { ActionStop, Ctx, IllegalAction, type Mod } from './context';
import { clampD6, d6Success } from './dice';
import { crowdInjury, goDown, injuryRoll } from './injury';
import { rollTest } from './roll';
import { R } from './rules';
import { gated } from './skills';
import { canUse, faq2026, getPlayer, hasBall, hasSkill, heldInPlace, label, markersOf, pitchPlayers, playerAt } from './state';
import type { Activation, Coord, Facing, GameState, Player } from './types';

export const TTM_RULE = { page: 76, title: 'Throw Team-mate Actions' };
const TTM_RANGE_RULE = { page: 77, title: 'Throw Team-mate: Measure Range / Test for Accuracy' };
const TTM_LAND_RULE = { page: 78, title: 'Throw Team-mate: Landing' };
export const PV_RULE = { page: 133, title: 'Projectile Vomit' };

// ---------------------------------------------------------------------------
// Throw Team-mate
// ---------------------------------------------------------------------------

/** Why this player cannot declare a Throw Team-mate Action now (null = allowed). */
export function ttmBlockedReason(s: GameState, p: Player): string | null {
  if (!hasSkill(p, 'throwTeamMate')) return 'Only players with the Throw Team-mate Trait can declare this Action (p.76).';
  if (s.turn.used.ttm) return 'A Throw Team-mate Action has already been declared this Turn (p.76).';
  if (p.pa === null) return 'This player has no Passing Ability (PA "-"), so the Passing Ability Test for the throw cannot be made.';
  const mates = pitchPlayers(s, p.team).filter((q) => q.id !== p.id && hasSkill(q, 'rightStuff'));
  if (!mates.length) return 'No team-mate with the Right Stuff Trait is on the pitch (p.135).';
  return null;
}

/** Quick Throw or Short Throw only (p.76-77). */
export function ttmRange(from: Coord, target: Coord): PassRange | null {
  const r = passRange(from, target);
  return r === 'quick' || r === 'short' ? r : null;
}

export function ttmTargetReason(from: Coord, target: Coord): string | null {
  if (!inBounds(target)) return 'The target square must be on the pitch.';
  if (eq(from, target)) return 'Choose a different target square.';
  if (!ttmRange(from, target)) return 'The target square must be within Quick Throw or Short Throw range (p.76-77).';
  return null;
}

export function ttmMods(ctx: Ctx | { s: GameState }, p: Player, from: Coord, range: PassRange): Mod[] {
  const mods: Mod[] = [];
  if (range === 'short') mods.push({ label: 'Short Throw', value: -1 });
  const m = markersOf(ctx.s, from, p.team).length;
  if (m) mods.push({ label: `Marked x${m}`, value: -m });
  if (ctx.s.weather === 'verySunny') mods.push({ label: 'Very Sunny', value: -1 });
  mods.push(...disturbingPresenceMods(ctx, { ...p, pos: from }));
  if (canUse(p, 'strongArm')) mods.push({ label: 'Strong Arm', value: 1 });
  return mods;
}

/** Players this thrower could pick up right now (adjacent team-mates with Right Stuff). */
export function throwablePlayers(s: GameState, p: Player, from: Coord = p.pos as Coord): Player[] {
  return pitchPlayers(s, p.team).filter((q) => q.id !== p.id && hasSkill(q, 'rightStuff') && !!q.pos && adjacent(q.pos, from));
}

type Flight = { land: Coord } | { last: Coord; off: Coord };

/**
 * Throw Team-mate, or with `kick` the Kick Team-mate Special Action (p.130):
 * the same, except a Fumbled Throw means an Injury Roll for the kicked
 * team-mate (Stunned counts as Knocked-out; a ball they held Bounces).
 */
export function performThrowTeamMate(ctx: Ctx, p: Player, thrownId: string, target: Coord, act: Activation, kick = false): void {
  const s = ctx.s;
  const from = p.pos as Coord;
  const thrown = getPlayer(s, thrownId);
  const held = heldInPlace(s, thrown);
  if (held) throw new IllegalAction(held);
  if (kick && !hasSkill(p, 'kickTeamMate')) throw new IllegalAction('Only a player with Kick Team-mate can kick a team-mate (p.130).');
  if (thrown.team !== p.team || thrown.id === p.id) throw new IllegalAction('Choose a team-mate to throw.');
  if (thrown.location !== 'pitch' || !thrown.pos || !adjacent(thrown.pos, from)) throw new IllegalAction('The thrown team-mate must be adjacent to the thrower (p.76).');
  if (!hasSkill(thrown, 'rightStuff')) throw new IllegalAction('Only a team-mate with the Right Stuff Trait can be thrown (p.135).');
  if (p.pa === null) throw new IllegalAction('This player has no Passing Ability (PA "-").');
  const why = ttmTargetReason(from, target);
  if (why) throw new IllegalAction(why);
  const range = ttmRange(from, target) as PassRange;

  act.ballActionDone = true;
  const carried = hasBall(s, thrown);
  const wasDown = thrown.stance !== 'standing' || thrown.distracted;
  const verb = kick ? 'Kick' : 'Throw';
  ctx.emit('declare', kick ? `${label(p)} kicks ${label(thrown)} (Kick Team-mate, ${range === 'quick' ? 'Quick' : 'Short'} range) at ${fmt(target)}.` : `${label(p)} picks up ${label(thrown)} for a ${range === 'quick' ? 'Quick' : 'Short'} Throw at ${fmt(target)}.`, kick ? KTM_RULE : TTM_RULE, { from, target, range, thrown: thrown.id });

  // Always Hungry (p.123), before the Passing Ability Test.
  let fumbled = false;
  if (hasSkill(p, 'alwaysHungry')) {
    const ah = rollTest(ctx, {
      kind: 'alwaysHungry',
      player: p,
      label: `${label(p)} Always Hungry`,
      target: 2,
      mods: [],
      rule: { page: 123, title: 'Always Hungry' },
      teamReroll: true,
      proAllowed: true,
      onFail: 'tries to eat the team-mate',
    });
    if (!ah.success) {
      const sq = rollTest(ctx, {
        kind: 'squirm',
        player: p,
        label: `${label(thrown)} tries to squirm free`,
        target: 2,
        mods: [],
        rule: { page: 123, title: 'Always Hungry' },
        teamReroll: true,
        proAllowed: true,
        onFail: 'is eaten',
      });
      if (!sq.success) {
        const at = thrown.pos as Coord;
        thrown.location = 'cas';
        thrown.pos = null;
        thrown.stance = 'standing';
        thrown.casualtyResult = 'Eaten';
        ctx.emit('injury', `${label(p)} eats ${label(thrown)}! The player is removed from the game (no Apothecary, no Regeneration).`, { page: 123, title: 'Always Hungry' }, { playerId: thrown.id, result: 'eaten', from: at });
        if (carried) {
          s.ball = { kind: 'ground', pos: { ...from } };
          ctx.emit('ball', `The ball bounces from ${fmt(from)}.`, R.scatter);
          bounce(ctx, from);
        }
        // FAQ May 2026 p.123: eating the team-mate causes a Turnover only if the eaten player had the ball. The throw is over either way.
        if (carried || !faq2026(ctx.s)) ctx.setTurnover(`${label(thrown)} was eaten${faq2026(ctx.s) ? ' while holding the ball' : ''}`, { page: 123, title: 'Always Hungry' });
        act.over = true;
        throw new ActionStop('eaten');
      }
      fumbled = true;
      ctx.emit('status', `${label(thrown)} squirms free: the throw is automatically a Fumbled Throw.`, { page: 123, title: 'Always Hungry' });
    }
  }

  let quality = 'fumble' as 'superb' | 'subpar' | 'fumble';
  if (!fumbled) {
    const pa = p.pa as number;
    const res = rollTest(ctx, {
      kind: 'ttm',
      player: p,
      label: `Passing Ability Test (${range === 'quick' ? 'Quick' : 'Short'} ${verb})`,
      target: pa,
      mods: ttmMods(ctx, p, from, range),
      rule: TTM_RANGE_RULE,
      outcome: (n, m) => {
        if (n === 1) return 'fumble';
        if (n !== 6 && clampD6(n + m) <= 1) return 'fumble';
        return d6Success(n, pa, m) ? 'superb' : 'subpar';
      },
      outcomeKey: `ttm${pa}`,
      isSuccess: (o) => o === 'superb',
      teamReroll: true,
      proAllowed: true,
      onFail: 'Subpar Throw (landing −1) or Fumbled Throw',
      at: target,
    });
    quality = res.outcome as typeof quality;
  }

  if (quality === 'fumble' && kick) {
    // Kick Team-mate: a Fumbled Throw is an Injury Roll for the kicked team-mate (p.130).
    ctx.emit('status', `Fumbled kick! ${label(thrown)} is hurt instead of flying.`, KTM_RULE, { playerId: thrown.id });
    const at = { ...(thrown.pos as Coord) };
    injuryRoll(ctx, thrown, [], false, { stunnedAsKO: true });
    if (carried && (thrown.location !== 'pitch' || thrown.stance !== 'standing')) {
      s.ball = { kind: 'ground', pos: at };
      ctx.emit('ball', `The ball bounces from ${fmt(at)}.`, R.scatter);
      ctx.setTurnover(`${label(thrown)} lost the ball`, KTM_RULE);
      bounce(ctx, at);
    }
    act.over = true;
    if (ctx.turnover) throw new ActionStop('ktm fumble');
    return;
  }

  // The thrown player leaves their square and is in the air.
  const start = thrown.pos as Coord;
  thrown.location = 'reserves';
  thrown.pos = null;
  let flight: Flight;
  let swooped: Facing | false = false;
  if (quality === 'fumble') {
    ctx.emit('status', `Fumbled Throw! ${label(thrown)} is dropped and bounces from ${fmt(from)}.`, TTM_RANGE_RULE);
    const r = ctx.roll({ dice: [8], interpret: ([d]) => scatterPath(from, [d]), cacheKey: `bounce|${from.x},${from.y}` });
    flight = r.value;
    ctx.emit('move', `${label(thrown)} bounces (D8: ${r.faces[0]}) ${'land' in flight ? `to ${fmt(flight.land)}` : 'off the pitch'}.`, R.scatter, { thrown: thrown.id });
  } else if (quality === 'superb' && canUse(p, 'bullseye')) {
    flight = { land: target };
    ctx.emit('move', `Superb Throw with Bullseye: ${label(thrown)} lands in the target square ${fmt(target)} without scattering.`, { page: 126, title: 'Bullseye' }, { thrown: thrown.id });
  } else if ((swooped = swoopChoice(ctx, thrown, target))) {
    flight = swoopFlight(ctx, thrown, target, swooped);
  } else {
    const r = ctx.roll({ dice: [8, 8, 8], interpret: (faces) => scatterPath(target, faces), cacheKey: `scatter3|${target.x},${target.y}` });
    flight = r.value;
    ctx.emit(
      'move',
      `${quality === 'superb' ? 'Superb' : 'Subpar'} Throw: ${label(thrown)} scatters (3) from ${fmt(target)} — D8 ${r.faces.join(', ')} → ${'land' in flight ? fmt(flight.land) : `off the pitch after ${fmt(flight.last)}`}.`,
      TTM_RANGE_RULE,
      { thrown: thrown.id, d8: r.faces },
    );
  }

  const landMods: Mod[] = [];
  if (quality === 'subpar') landMods.push({ label: 'Subpar Throw', value: -1 });
  if (quality === 'fumble') landMods.push({ label: 'Fumbled Throw', value: -1 });
  // Deeproot Strongbranch's Reliable (p.197): after his Fumbled Throw the thrown player Bounces as normal but lands safely.
  const reliable = quality === 'fumble' && p.star === 'deeproot' && !kick;
  if (reliable) ctx.emit('status', `Reliable (Deeproot Strongbranch): ${label(thrown)} bounces but will land safely.`, { page: 197, title: 'Deeproot Strongbranch: Reliable' }, { playerId: p.id, star: 'deeproot' });
  const landed = land(ctx, thrown, flight, landMods, wasDown, carried, start, 0, !!swooped, reliable);
  // Star Player Points (p.96): a Superb Throw landed safely (thrower), any safe landing (thrown player).
  if (landed) {
    awardSpp(ctx, thrown, 'landing');
    if (quality === 'superb') awardSpp(ctx, p, 'ttm');
  }
  act.over = true;
}

export const KTM_RULE = { page: 130, title: 'Kick Team-mate' };
const SWOOP_RULE = { page: 137, title: 'Swoop' };

/** Swoop: a thrown player may choose not to Scatter and travel with the Throw-in Template instead. Returns the facing, or false. */
function swoopChoice(ctx: Ctx, thrown: Player, target: Coord): Facing | false {
  if (!hasSkill(thrown, 'swoop') || gated('swoop')) return false;
  const c = ctx.ask({
    type: 'swoop',
    team: thrown.team,
    prompt: `${label(thrown)} has Swoop: Scatter as normal, or travel from ${fmt(target)} with the Throw-in Template (D6 direction, D6 squares; the landing may then be re-rolled)?`,
    options: [
      { id: 'scatter', label: 'Scatter as normal' },
      ...(['x-', 'x+', 'y-', 'y+'] as Facing[]).map((f) => ({ id: f, label: `Swoop ${FACING_LABEL[f]}` })),
    ],
    rule: SWOOP_RULE,
  });
  return c === 'scatter' ? false : (c as Facing);
}

function swoopFlight(ctx: Ctx, thrown: Player, from: Coord, facing: Facing): Flight {
  const r = ctx.roll({ dice: [6, 6], interpret: ([d, n]) => ({ d, n }), cacheKey: 'swoop' });
  const dir = facingDirection(facing, r.value.d);
  let cur = from;
  for (let i = 0; i < r.value.n; i++) {
    const next = add(cur, dir);
    if (!inBounds(next)) {
      ctx.emit('move', `${label(thrown)} swoops (D6 ${r.value.d}, ${r.value.n} squares) off the pitch after ${fmt(cur)}.`, SWOOP_RULE, { thrown: thrown.id });
      return { last: cur, off: next };
    }
    cur = next;
  }
  ctx.emit('move', `${label(thrown)} swoops from ${fmt(from)} (D6 ${r.value.d}, ${r.value.n} squares) → ${fmt(cur)}.`, SWOOP_RULE, { thrown: thrown.id });
  return { land: cur };
}

function intoCrowd(ctx: Ctx, thrown: Player, last: Coord, off: Coord, carried: boolean): void {
  ctx.emit('move', `${label(thrown)} lands in the crowd beyond ${fmt(last)}!`, TTM_RANGE_RULE, { thrown: thrown.id, crowd: true });
  ctx.setTurnover(`${label(thrown)} was thrown into the crowd`, TTM_RANGE_RULE);
  crowdInjury(ctx, thrown);
  if (carried) {
    ctx.emit('ball', `The ball goes into the crowd with ${label(thrown)} and is thrown in.`, R.throwIn);
    throwIn(ctx, last, off);
  }
}

/** Returns true if the thrown player landed safely on their feet. */
function land(ctx: Ctx, thrown: Player, flight: Flight, landMods: Mod[], wasDown: boolean, carried: boolean, start: Coord, depth: number, swooped: boolean, safe = false): boolean {
  const s = ctx.s;
  if (depth > 60) throw new Error('Throw Team-mate landing did not terminate');
  if ('off' in flight) {
    intoCrowd(ctx, thrown, flight.last, flight.off, carried);
    return false;
  }
  const sq = flight.land;
  const occ = playerAt(s, sq);
  if (occ) {
    // Crash landing (p.78): the occupant is Knocked Down, the thrown player bounces and Falls Over.
    ctx.emit('status', `${label(thrown)} crash-lands on ${label(occ)} in ${fmt(sq)}!`, TTM_LAND_RULE, { thrown: thrown.id, on: occ.id });
    const wasStunned = occ.stance === 'stunned';
    // Lethal Flight (p.130): +1 to the Armour or Injury Roll of an opposition player it crash-lands on, and the Casualty is theirs.
    const lf = occ.team !== thrown.team && hasSkill(thrown, 'lethalFlight') && !gated('lethalFlight') ? thrown : undefined;
    goDown(ctx, occ, { kind: 'knockedDown', reason: 'crash-landed on by a thrown player', lethalFlight: lf, credit: lf });
    if (wasStunned && occ.location === 'pitch' && occ.stance === 'prone') occ.stance = 'stunned';
    const r = ctx.roll({ dice: [8], interpret: ([d]) => scatterPath(sq, [d]), cacheKey: `bounce|${sq.x},${sq.y}` });
    const next = r.value;
    ctx.emit('move', `${label(thrown)} bounces (D8: ${r.faces[0]}) ${'land' in next ? `to ${fmt(next.land)}` : 'off the pitch'}.`, R.scatter, { thrown: thrown.id });
    if ('off' in next) {
      intoCrowd(ctx, thrown, next.last, next.off, carried);
      return false;
    }
    if (playerAt(s, next.land)) {
      return land(ctx, thrown, next, landMods, wasDown, carried, start, depth + 1, swooped, safe);
    }
    place(thrown, next.land);
    goDown(ctx, thrown, { kind: 'fellOver', reason: 'crash landing' });
    if (carried) ctx.setTurnover(`${label(thrown)} was thrown with the ball and did not land safely`, TTM_LAND_RULE);
    return false;
  }
  place(thrown, sq);
  if (safe) {
    thrown.stance = 'standing';
    thrown.distracted = false;
    ctx.emit('move', `${label(thrown)} lands safely on their feet in ${fmt(sq)} (Reliable, no landing roll).`, { page: 197, title: 'Deeproot Strongbranch: Reliable' }, { thrown: thrown.id, landed: true });
    if (!carried && s.ball.kind === 'ground' && eq(s.ball.pos, sq)) ballDisplacedBy(ctx, thrown);
    if (carried) checkTouchdown(ctx, false);
    return true;
  }
  const m = markersOf(s, sq, thrown.team).length;
  const mods = [...landMods];
  if (m) mods.push({ label: `Marked x${m} in ${fmt(sq)}`, value: -m });
  const res = rollTest(ctx, {
    kind: 'landing',
    player: thrown,
    label: `${label(thrown)} lands in ${fmt(sq)}`,
    target: thrown.ag,
    mods,
    rule: TTM_LAND_RULE,
    teamReroll: true,
    proAllowed: false,
    skillReroll: swooped ? { id: 'swoop', name: 'Swoop', available: true } : undefined,
    onFail: carried ? 'Falls Over with the ball — Turnover' : 'Falls Over (no Turnover)',
    autoFail: wasDown ? 'was Prone, Stunned or Distracted when thrown' : undefined,
    at: sq,
  });
  if (res.success) {
    thrown.stance = 'standing';
    thrown.distracted = false;
    ctx.emit('move', `${label(thrown)} lands on their feet in ${fmt(sq)}${thrown.activated ? '' : ' and can still be activated this Turn'}.`, TTM_LAND_RULE, { thrown: thrown.id, landed: true });
    if (!carried && s.ball.kind === 'ground' && eq(s.ball.pos, sq)) ballDisplacedBy(ctx, thrown);
    if (carried) checkTouchdown(ctx, false);
    return true;
  }
  goDown(ctx, thrown, { kind: 'fellOver', reason: 'failed to land' });
  if (carried) ctx.setTurnover(`${label(thrown)} was thrown with the ball and did not land safely`, TTM_LAND_RULE);
  void start;
  return false;
}

function place(p: Player, sq: Coord): void {
  p.location = 'pitch';
  p.pos = { ...sq };
}

// ---------------------------------------------------------------------------
// Projectile Vomit (p.133)
// ---------------------------------------------------------------------------

export function vomitTargets(s: GameState, p: Player, from: Coord = p.pos as Coord): Player[] {
  return pitchPlayers(s).filter((q) => q.team !== p.team && q.stance === 'standing' && !!q.pos && adjacent(q.pos, from));
}

/** Projectile Vomit on an adjacent Standing opponent (kept for older callers; see performTargetedSpecial). */
export function performProjectileVomit(ctx: Ctx, p: Player, target: Player, act: Activation): void {
  performTargetedSpecial(ctx, p, target, act, 'projectileVomit', false);
}
