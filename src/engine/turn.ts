import { askSportsEspionage } from './desperate';
import { rulesFor } from './variant';
import { adjacent, dist, fmt, inScoringEndZone, neighbours } from './board';
import { ActionStop, Ctx } from './context';
import { checkTouchdown } from './ball';
import { goDown } from './injury';
import { animalSavagery, bloodlust, bloodlustEnd, takeRoot } from './traits';
import { rollTest } from './roll';
import { R } from './rules';
import { ballHolder, canUse, findPlayer, hasBall, hasSkill, hasTackleZone, label, markersOf, other, pitchPlayers, playerAt } from './state';
import type { Activation, ActionType, Coord, GameState, Player, SpecialId } from './types';
import { askStar, dropTempSkills, spendStar, starOnDeclare, starReady } from './stars';
import { setDownCarried } from './starActions';

export const ACTIVATION_TRAITS = ['boneHead', 'reallyStupid', 'unchannelledFury', 'animalSavagery', 'bloodlust', 'takeRoot'];

/**
 * Could the ball carrier score without rolling any dice (Stalling, p.80-81)?
 * Moves only through squares it can leave without Dodging, using its MA
 * without Rushing, and it must have no activation roll.
 */
export function canScoreWithoutDice(s: GameState, p: Player): boolean {
  if (!p.pos || p.stance !== 'standing' || !hasBall(s, p)) return false;
  if (ACTIVATION_TRAITS.some((t) => hasSkill(p, t))) return false;
  if (inScoringEndZone(p.team, p.pos)) return true;
  const budget = p.ma;
  const seen = new Map<string, number>();
  const q: Array<{ c: Coord; d: number }> = [{ c: p.pos, d: 0 }];
  seen.set(`${p.pos.x},${p.pos.y}`, 0);
  const marked = (c: Coord) => markersOf(s, c, p.team).length > 0;
  while (q.length) {
    const { c, d } = q.shift() as { c: Coord; d: number };
    if (d > 0 && inScoringEndZone(p.team, c)) return true;
    if (d >= budget) continue;
    if (marked(c)) continue; // leaving a Marked square needs a Dodge
    for (const n of neighbours(c)) {
      const k = `${n.x},${n.y}`;
      if (seen.has(k)) continue;
      const occ = playerAt(s, n);
      if (occ && occ.id !== p.id) continue;
      seen.set(k, d + 1);
      q.push({ c: n, d: d + 1 });
    }
  }
  return false;
}

/**
 * Activation rolls after declaring an Action: Bone Head, Really Stupid,
 * Unchannelled Fury, Animal Savagery, Bloodlust and Take Root (a player with
 * several makes them in this order).
 */
export function activationTraits(ctx: Ctx, p: Player, act: Activation): boolean {
  const blockish = act.action === 'block' || act.action === 'blitz';
  if (hasSkill(p, 'boneHead')) {
    const r = rollTest(ctx, { kind: 'boneHead', player: p, label: `${label(p)} Bone Head`, target: 2, mods: [], rule: { page: 126, title: 'Bone Head' }, teamReroll: true, proAllowed: true, onFail: 'becomes Distracted; activation ends' });
    if (!r.success) {
      p.distracted = true;
      act.over = true;
      ctx.emit('status', `${label(p)} is Distracted (Bone Head); the activation ends.`, { page: 126, title: 'Bone Head' });
      return false;
    }
  }
  if (hasSkill(p, 'reallyStupid')) {
    const helper = pitchPlayers(ctx.s, p.team).some((q) => q.id !== p.id && hasTackleZone(q) && !hasSkill(q, 'reallyStupid') && adjacent(q.pos as Coord, p.pos as Coord));
    const r = rollTest(ctx, {
      kind: 'reallyStupid',
      player: p,
      label: `${label(p)} Really Stupid`,
      target: 4,
      mods: helper ? [{ label: 'helpful team-mate adjacent', value: 2 }] : [],
      rule: { page: 135, title: 'Really Stupid' },
      teamReroll: true,
      proAllowed: true,
      onFail: 'becomes Distracted; activation ends',
    });
    if (!r.success) {
      p.distracted = true;
      act.over = true;
      ctx.emit('status', `${label(p)} is Distracted (Really Stupid); the activation ends.`, { page: 135, title: 'Really Stupid' });
      return false;
    }
  }
  if (hasSkill(p, 'unchannelledFury')) {
    const r = rollTest(ctx, {
      kind: 'unchannelledFury',
      player: p,
      label: `${label(p)} Unchannelled Fury`,
      target: 4,
      mods: blockish ? [{ label: 'Block/Blitz declared', value: 2 }] : [],
      rule: { page: 138, title: 'Unchannelled Fury' },
      teamReroll: true,
      proAllowed: true,
      onFail: 'the activation ends',
    });
    // Scyla Anfingrimm's Fury of the Blood God (p.208): once per game, a 1 on a declared Block → two Block Actions instead.
    if (!r.success && r.natural === 1 && act.action === 'block' && starReady(ctx.s, p, 'scyla') && askStar(ctx, p, 'Unchannelled Fury rolled a 1. Perform two Block Actions instead?', 'Use Fury of the Blood God: two Blocks', true)) {
      act.starFlags = [...(act.starFlags ?? []), 'twoBlocks'];
      spendStar(ctx, p, `${label(p)} performs two Block Actions instead (the first one fully resolved first).`);
      return true;
    }
    if (!r.success) {
      act.over = true;
      ctx.emit('status', `${label(p)} rages incoherently (Unchannelled Fury); the activation ends.`, { page: 138, title: 'Unchannelled Fury' });
      return false;
    }
  }
  if (hasSkill(p, 'animalSavagery') && !animalSavagery(ctx, p, act)) return false;
  if (hasSkill(p, 'bloodlust')) bloodlust(ctx, p, act);
  if (hasSkill(p, 'takeRoot')) takeRoot(ctx, p);
  return true;
}

export function startActivation(ctx: Ctx, p: Player, action: ActionType, blitzTarget?: string, special?: SpecialId): Activation {
  const s = ctx.s;
  const act: Activation = {
    playerId: p.id,
    action,
    blitzTarget,
    maUsed: 0,
    rushesUsed: 0,
    blocksDone: 0,
    ballActionDone: false,
    proUsed: false,
    stallingCandidate: false,
    over: false,
  };
  if (action === 'special' && special) act.special = special;
  p.activated = true;
  // The next Turn has begun: no more Wizard spells for the gap before it (p.149).
  s.turn.betweenTurns = false;
  const wasDistracted = p.distracted;
  p.distracted = false;
  p.eyeGouged = false;
  act.stallingCandidate = canScoreWithoutDice(s, p);
  s.turn.activation = act;
  if (action === 'blitz') s.turn.used.blitz = true;
  if (action === 'pass') s.turn.used.pass = true;
  if (action === 'handoff') s.turn.used.handoff = true;
  if (action === 'secure') s.turn.used.secure = true;
  if (action === 'ttm') s.turn.used.ttm = true;
  if (action === 'foul') {
    s.turn.used.foul = true;
    s.turn.used.foulBy = [...(s.turn.used.foulBy ?? []), p.id];
  }
  if (action === 'special' && special === 'bombardier') s.turn.used.bomb = true;
  if (action === 'special' && special === 'punt') s.turn.used.punt = true;
  if (action === 'special' && special === 'kickTeamMate') s.turn.used.ktm = true;
  // Charge! (p.48): count the selected players and the free Blitz / Throw Team-mate.
  const ph = s.match?.pendingPhase;
  if (ph && ph.type === 'charge') {
    if (!ph.activated.includes(p.id)) ph.activated.push(p.id);
    if (action === 'blitz') ph.blitz = true;
    if (action === 'ttm') ph.ttm = true;
    if (action === 'special' && special === 'kickTeamMate') ph.ktm = true;
  }
  const names: Record<ActionType, string> = { move: 'Move', blitz: 'Blitz', block: 'Block', pass: 'Pass', handoff: 'Hand-off', secure: 'Secure the Ball', foul: 'Foul', ttm: 'Throw Team-mate', special: 'Special' };
  const tgt = blitzTarget ? findPlayer(s, blitzTarget) : undefined;
  const SPECIAL_NAME: Partial<Record<SpecialId, string>> = { projectileVomit: 'Projectile Vomit', punt: 'Punt', stab: 'Stab', chainsaw: 'Chainsaw Attack', breatheFire: 'Breathe Fire', hypnoticGaze: 'Hypnotic Gaze', monstrousMouth: 'Chomp', bombardier: 'Throw Bomb', kickTeamMate: 'Kick Team-mate', ballAndChain: 'Ball & Chain' };
  const what = action === 'special' && special && SPECIAL_NAME[special] ? `${SPECIAL_NAME[special]} Special Action` : `${names[action]} Action`;
  ctx.emit('declare', `${label(p)} declares a ${what}${tgt ? ` targeting ${label(tgt)}` : ''}${wasDistracted ? ' (no longer Distracted)' : ''}.`, action === 'blitz' ? R.blitz : R.actions, { playerId: p.id, action, blitzTarget, special });
  starOnDeclare(ctx, p, act);
  return act;
}

/** End the current activation, including the Stalling check (p.80-81). */
export function endActivation(ctx: Ctx): void {
  const s = ctx.s;
  const act = s.turn.activation;
  if (!act) return;
  const p = findPlayer(s, act.playerId);
  if (p && act.bloodlust === 'hungry' && !ctx.turnover && !ctx.touchdown) {
    bloodlustEnd(ctx, p, act);
    if (!ctx.turnover && hasBall(s, p)) checkTouchdown(ctx, false);
  }
  // Grak's I'll Carry You (p.200): Crumbleberry is set down next to Grak at the end of his activation.
  if (p) setDownCarried(ctx, p);
  s.turn.activation = null;
  dropTempSkills(s, 'activation');
  if (!p) return;
  ctx.emit('activation', `${label(p)}'s activation ends.`, R.turn, { playerId: p.id });
  if (act.stallingCandidate && !ctx.touchdown && !ctx.turnover) {
    const gaveAway = (act.action === 'pass' || act.action === 'handoff') && !hasBall(s, p);
    if (!gaveAway) crowdTakesAction(ctx, p, 'finished the activation without scoring');
  }
}

export function crowdTakesAction(ctx: Ctx, p: Player, why: string): void {
  const s = ctx.s;
  const turnNo = s.teams[p.team].turn;
  ctx.emit('note', `${label(p)} could have scored without rolling any dice but ${why}: Stalling!`, R.stalling);
  if (p.location !== 'pitch' || p.stance !== 'standing') {
    ctx.emit('note', `${label(p)} is no longer Standing, so the Crowd Takes Action roll has no effect.`, R.crowdTakesAction);
    return;
  }
  const r = ctx.roll({ dice: [6], interpret: ([n]) => (n >= turnNo ? 'hit' : 'miss'), cacheKey: `crowd${turnNo}`, prefer: (v) => v === 'miss' });
  const n = r.faces[0];
  ctx.emit('roll', `The Crowd Takes Action: rolled ${n} vs Turn ${turnNo} — ${r.value === 'hit' ? 'the player is hit' : 'missed'}.`, R.crowdTakesAction, { natural: n, turn: turnNo });
  if (r.value === 'hit') {
    goDown(ctx, p, { kind: 'knockedDown', reason: 'hit by the crowd for Stalling' });
  }
}

/** Voluntary or forced end of the team turn (p.39, p.50, p.132). */
export function endTurn(ctx: Ctx, reason: 'voluntary' | 'turnover'): void {
  const s = ctx.s;
  // A Turn ends once: e.g. a Stalling crowd hit while ending the Turn is a
  // Turnover of this Turn, not of the next one.
  if (ctx.turnEnded) return;
  const team = s.turn.active;
  if (reason === 'voluntary') {
    if (s.turn.activation) endActivation(ctx);
    if (!ctx.turnover && !ctx.touchdown) {
      const h = ballHolder(s);
      if (h && h.team === team && !h.activated && canScoreWithoutDice(s, h)) {
        h.activated = true;
        ctx.emit('note', `${label(h)} holds the ball, could score without rolling dice and was not activated: ending the Turn counts as foregoing their activation.`, R.forgo);
        crowdTakesAction(ctx, h, 'the Turn ended without them scoring');
      }
    }
    if (ctx.turnover) reason = 'turnover';
  } else {
    const a0 = s.turn.activation;
    const ap = a0 ? findPlayer(s, a0.playerId) : undefined;
    if (ap) setDownCarried(ctx, ap);
    s.turn.activation = null;
    dropTempSkills(s, 'activation');
  }
  ctx.turnEnded = true;
  if (ctx.touchdown) {
    finishDrive(ctx);
    return;
  }
  // Stunned players that started this Turn Stunned roll over (p.39).
  for (const id of s.turn.stunnedAtStart) {
    const p = findPlayer(s, id);
    if (p && p.location === 'pitch' && p.stance === 'stunned') {
      p.stance = 'prone';
      ctx.emit('status', `${label(p)} rolls over from Stunned to Prone.`, R.prone, { playerId: p.id });
    }
  }
  // Pick-me-up (p.132): at the end of the opposition's Turn.
  const opp = other(team);
  const helpers = pitchPlayers(s, opp).filter((q) => canUse(q, 'pickMeUp'));
  if (helpers.length) {
    const prone = pitchPlayers(s, opp).filter((q) => q.stance === 'prone' && helpers.some((h) => h.id !== q.id && dist(h.pos as Coord, q.pos as Coord) <= 3));
    for (const q of prone) {
      const r = ctx.roll({ dice: [6], interpret: ([n]) => (n >= 5 ? 'S' : 'F'), cacheKey: 'pmu5', by: q.team, judge: (v) => (v === 'S' ? 1 : -1) });
      ctx.emit('roll', `Pick-me-up for ${label(q)}: rolled ${r.faces[0]}; needs 5+ — ${r.value === 'S' ? 'stands up' : 'stays Prone'}.`, { page: 132, title: 'Pick-me-up' });
      if (r.value === 'S') q.stance = 'standing';
    }
  }
  ctx.emit('turn', `${s.teams[team].name} Turn ${s.teams[team].turn} ends${reason === 'turnover' ? ' (Turnover)' : ''}.`, reason === 'turnover' ? R.turnover : R.turn);
  // Sevens Desperate Measure Sports Espionage (Spike! 22 p.15): two Team Re-rolls once the Turnover is resolved.
  if (reason === 'turnover') askSportsEspionage(ctx, team);
  startNextTurn(ctx);
  // "At the end of any Turn, before the next Turn begins" (Sports-Wizard, p.149): open until the next activation.
  s.turn.betweenTurns = true;
  s.turn.wizardDeclined = [];
}

export function startNextTurn(ctx: Ctx): void {
  const s = ctx.s;
  const next = other(s.turn.active);
  // Eight Turns per half (p.44); six in Blood Bowl Sevens (Spike! 22 p.7).
  if (s.teams[next].turn >= rulesFor(s).turnsPerHalf) {
    s.phase = 'halfOver';
    s.turn.activation = null;
    ctx.emit('turn', `End of the half: ${s.teams[next].name} has no Turns left.`, R.turn);
    return;
  }
  s.teams[next].turn += 1;
  s.turn.active = next;
  s.turn.used = { blitz: false, pass: false, handoff: false, foul: false, secure: false, ttm: false, bomb: false, punt: false, ktm: false };
  s.turn.activation = null;
  for (const p of s.players) {
    p.activated = false;
    p.usage = {};
  }
  dropTempSkills(s, 'turn');
  s.turn.stunnedAtStart = s.players.filter((p) => p.team === next && p.location === 'pitch' && p.stance === 'stunned').map((p) => p.id);
  ctx.emit('turn', `${s.teams[next].name} Turn ${s.teams[next].turn} begins.`, R.turn, { team: next, turn: s.teams[next].turn });
}

export function finishDrive(ctx: Ctx): void {
  const s = ctx.s;
  const td = ctx.touchdown;
  if (!td || s.phase === 'touchdown') return;
  ctx.turnEnded = true;
  s.phase = 'touchdown';
  s.turn.activation = null;
  // The Turn that scored has ended: a Sports-Wizard may still cast before the next Drive (p.149).
  s.turn.betweenTurns = true;
  s.turn.wizardDeclined = [];
  s.touchdown = { team: td.team, playerId: td.playerId, duringTeamTurn: s.turn.active };
  ctx.emit('turn', `The Drive ends with a Touchdown for ${s.teams[td.team].name}. Score ${s.teams.A.name} ${s.teams.A.score} – ${s.teams.B.score} ${s.teams.B.name}.`, R.touchdown);
}

/** Forego Activation (p.52): the player is not activated; Stalling still applies. */
export function forgo(ctx: Ctx, p: Player): void {
  const s = ctx.s;
  if (s.turn.activation) endActivation(ctx);
  if (ctx.turnover) throw new ActionStop('turnover');
  p.activated = true;
  s.turn.betweenTurns = false;
  ctx.emit('activation', `${label(p)} foregoes their activation.`, R.forgo, { playerId: p.id });
  if (canScoreWithoutDice(s, p)) crowdTakesAction(ctx, p, 'foregoes their activation');
}

export function describeSquare(c: Coord | null): string {
  return fmt(c);
}
