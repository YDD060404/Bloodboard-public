import { adjacent, eq, fmt, inBounds, passRange, RANGE_LABEL, RANGE_MOD, rulerOverlaps, type PassRange } from './board';
import { ballArrives, blastItBest, blastItOutcomes, bounce, catchAttempt, checkTouchdown, disturbingPresenceMods, scatter, scatterPath, throwIn } from './ball';
import { onTheBallPass } from './onTheBall';
import { awardSpp } from './spp';
import { gated } from './skills';
import { requireBite } from './traits';
import { ActionStop, Ctx, IllegalAction, type Mod } from './context';
import { d6Success } from './dice';
import { rollTest } from './roll';
import { R } from './rules';
import { ballHolder, canUse, hasBall, hasSkill, hasTackleZone, label, markersOf, other, pitchPlayers, playerAt, skillKeywords } from './state';
import type { Activation, Coord, Player } from './types';
import { askStar, spendStar, STAR_BY_ID, starReady, starRuleRef } from './stars';

export function passBlockedReason(ctx: Ctx, p: Player): string | null {
  if (p.pa === null) return 'This player has no Passing Ability (PA "-"); the rulebook gives no rule for such a pass, so Pass Actions are disabled.';
  if (hasSkill(p, 'myBall')) return 'My Ball: this player may not declare Pass Actions (p.132).';
  const otb = gated('onTheBall') ? pitchPlayers(ctx.s, other(p.team)).find((q) => canUse(q, 'onTheBall')) : undefined;
  if (otb) return `Not available yet: ${label(otb)} has On the Ball (p.132), so Pass Actions are disabled in this version.`;
  const dc = gated('divingCatch') ? pitchPlayers(ctx.s).find((q) => canUse(q, 'divingCatch')) : undefined;
  if (dc) return `Not available yet: ${label(dc)} has Diving Catch (p.127), so Pass Actions are disabled in this version.`;
  return null;
}

export interface PassInfo {
  range: PassRange;
  mods: Mod[];
  hailMary: boolean;
}

export function passInfo(ctx: Ctx, p: Player, from: Coord, target: Coord, hailMary: boolean): PassInfo | string {
  if (!inBounds(target)) return 'The target square must be on the pitch.';
  if (eq(from, target)) return 'Choose a different target square.';
  let range: PassRange | null;
  if (hailMary) {
    if (!canUse(p, 'hailMaryPass')) return 'This player does not have Hail Mary Pass.';
    range = 'bomb';
  } else {
    range = passRange(from, target);
    if (!range) return 'The target square is out of range (Passing Range Chart, p.71).';
  }
  if (ctx.s.weather === 'blizzard' && (range === 'long' || range === 'bomb')) return 'Blizzard: only Quick or Short Passes are allowed (p.46).';
  const mods: Mod[] = [];
  // Valen Swift's Working in Tandem (p.209): a Pass to the square Lucien Swift is in has no range modifier.
  const tandem = !hailMary && p.star === 'valen' && playerAt(ctx.s, target)?.star === 'lucien' && playerAt(ctx.s, target)?.team === p.team;
  if (RANGE_MOD[range] && !tandem) mods.push({ label: hailMary ? 'Hail Mary (Long Bomb)' : RANGE_LABEL[range], value: RANGE_MOD[range] });
  const tmp = { ...p, pos: from };
  const m = markersOf(ctx.s, from, p.team).length;
  if (m && !canUse(tmp, 'nervesOfSteel')) mods.push({ label: `Marked x${m}`, value: -m });
  if (ctx.s.weather === 'verySunny') mods.push({ label: 'Very Sunny', value: -1 });
  mods.push(...disturbingPresenceMods(ctx, tmp));
  if (canUse(p, 'accurate') && (range === 'quick' || range === 'short')) mods.push({ label: 'Accurate', value: 1 });
  if (canUse(p, 'cannoneer') && (range === 'long' || range === 'bomb')) mods.push({ label: 'Cannoneer', value: 1 });
  return { range, mods, hailMary };
}

/** Animosity (p.123) check for a Pass or Hand-off to a team-mate. Returns false if refused. */
function animosity(ctx: Ctx, p: Player, receiver: Player | undefined, act: Activation): boolean {
  if (!receiver || receiver.team !== p.team || !hasSkill(p, 'animosity')) return true;
  const kws = skillKeywords(p, 'animosity');
  const applies = kws.some((k) => k.toLowerCase() === 'all' || receiver.keywords.includes(k));
  if (!applies) return true;
  const r = rollTest(ctx, {
    kind: 'animosity',
    player: p,
    label: `Animosity (${kws.join(', ')}) towards ${label(receiver)}`,
    target: 2,
    mods: [],
    rule: { page: 123, title: 'Animosity' },
    teamReroll: true,
    proAllowed: true,
    onFail: 'refuses; activation ends',
  });
  if (!r.success) {
    ctx.emit('status', `${label(p)} refuses to give the ball to ${label(receiver)}; the activation ends.`, { page: 123, title: 'Animosity' });
    act.over = true;
    return false;
  }
  return true;
}

export function interceptors(ctx: Ctx, thrower: Player, from: Coord, landing: Coord): Player[] {
  const cloud = canUse(thrower, 'cloudBurster');
  return pitchPlayers(ctx.s, other(thrower.team)).filter(
    (q) => hasTackleZone(q) && !hasSkill(q, 'noBall') && rulerOverlaps(from, landing, q.pos as Coord, ctx.s.options.rulerWidth) && (!cloud || canUse(q, 'veryLongLegs')),
  );
}

/**
 * An Interception attempt by `q` (p.71). Scrappa Sorehead's Yoink! (p.207): once per game he may roll a D6 first —
 * on a 2+ he intercepts without the Agility Test.
 */
export function interceptAttempt(ctx: Ctx, q: Player, accurate: boolean, what: string, onFail: string): boolean {
  if (starReady(ctx.s, q, 'scrappa') && askStar(ctx, q, `roll a D6 — on a 2+ he intercepts ${what} automatically?`, 'Use Yoink! (D6 2+)', true, 'Roll to Intercept as normal')) {
    const r = ctx.roll({ dice: [6], interpret: ([n]) => (n >= 2 ? 'S' : 'F'), cacheKey: 'yoink2', by: q.team, judge: (v) => (v === 'S' ? 1 : -1), prefer: (v) => v === 'F' });
    spendStar(ctx, q, `D6 ${r.faces[0]} — ${r.value === 'S' ? 'he intercepts automatically' : 'no luck: he rolls to Intercept as normal'}.`);
    if (r.value === 'S') return true;
  }
  return rollTest(ctx, { kind: 'intercept', player: q, label: `${label(q)} intercepts${what === 'the pass' ? '' : ` ${what}`}`, target: q.ag, mods: interceptMods(ctx, q, accurate), rule: R.interception, teamReroll: false, proAllowed: false, onFail }).success;
}

export function interceptMods(ctx: Ctx, q: Player, accurate: boolean): Mod[] {
  const mods: Mod[] = [{ label: accurate ? 'Accurate Pass' : 'Inaccurate Pass', value: accurate ? -3 : -2 }];
  const m = markersOf(ctx.s, q.pos as Coord, q.team).length;
  if (m) mods.push({ label: `Marked x${m}`, value: -m });
  if (ctx.s.weather === 'pouringRain') mods.push({ label: 'Pouring Rain', value: -1 });
  if (hasSkill(q, 'stunty')) mods.push({ label: 'Stunty', value: -1 });
  if (canUse(q, 'extraArms')) mods.push({ label: 'Extra Arms', value: 1 });
  if (canUse(q, 'veryLongLegs')) mods.push({ label: 'Very Long Legs', value: 2 });
  mods.push(...disturbingPresenceMods(ctx, q));
  return mods;
}

/** Pass Action (p.70-73). */
export function performPass(ctx: Ctx, p: Player, target: Coord, hailMary: boolean, act: Activation): void {
  const s = ctx.s;
  if (!hasBall(s, p)) {
    ctx.emit('note', `${label(p)} is not holding the ball, so no pass can be made.`, R.pass);
    act.over = true;
    return;
  }
  const why = passBlockedReason(ctx, p);
  if (why) throw new IllegalAction(why);
  const from = p.pos as Coord;
  const info = passInfo(ctx, p, from, target, hailMary);
  if (typeof info === 'string') throw new IllegalAction(info);
  const receiver = playerAt(s, target);
  requireBite(ctx, p, act, 'pass');
  if (!animosity(ctx, p, receiver, act)) throw new ActionStop('animosity');

  act.ballActionDone = true;
  ctx.emit('declare', `${label(p)} throws a ${hailMary ? 'Hail Mary Pass' : RANGE_LABEL[info.range]} at ${fmt(target)}${receiver ? ` (${label(receiver)})` : ''}.`, R.pass, { from, target, range: info.range, hailMary });
  // On the Ball (p.132): opposition players may move before the Passing Ability Test.
  onTheBallPass(ctx, p);
  // The move may have changed the modifiers for being Marked or Disturbing Presence.
  const info2 = passInfo(ctx, p, from, target, hailMary);
  if (typeof info2 !== 'string') info.mods = info2.mods;

  const safePass = canUse(p, 'safePass');
  // Sevens Desperate Measure Set Piece (Spike! 22 p.15): Accurate on any roll of 2+ — the PA and modifiers ignored.
  const setPiece = !!act.setPiece && !hailMary;
  const pa = setPiece ? 2 : (p.pa as number);
  const res = rollTest(ctx, {
    kind: 'pass',
    player: p,
    label: `Passing Ability Test (${hailMary ? 'Hail Mary' : RANGE_LABEL[info.range]})${setPiece ? ' — Set Piece: Accurate on any 2+' : ''}`,
    target: pa,
    mods: setPiece ? [] : info.mods,
    rule: R.passTest,
    outcome: (n, m) => {
      if (n === 1) return safePass ? 'safe' : 'fumble';
      if (setPiece) return 'accurate';
      const mod = Math.max(1, Math.min(6, n + m));
      if (n !== 6 && mod <= 1) return 'fumble';
      if (d6Success(n, pa, m)) return hailMary ? 'inaccurate' : 'accurate';
      return 'inaccurate';
    },
    outcomeKey: `pass${pa}|${safePass}|${hailMary}|${setPiece}`,
    isSuccess: (o) => o === (hailMary ? 'inaccurate' : 'accurate'),
    skillReroll: { id: 'pass', name: 'Pass', available: canUse(p, 'pass') },
    teamReroll: true,
    proAllowed: true,
    onFail: 'Inaccurate (Scatter 3) or Fumbled',
  });
  const outcome = res.outcome;
  if (outcome === 'safe') {
    ctx.emit('ball', `Safe Pass: the natural 1 is not a Fumble — ${label(p)} keeps the ball and the activation ends (no Turnover).`, { page: 135, title: 'Safe Pass' });
    act.over = true;
    return;
  }
  if (outcome === 'fumble') {
    ctx.emit('ball', `Fumbled Pass! The ball bounces from ${fmt(from)}.`, R.passTest);
    ctx.setTurnover(`${label(p)} fumbled the pass`, R.turnover);
    act.over = true;
    s.ball = { kind: 'ground', pos: { ...from } };
    bounce(ctx, from);
    throw new ActionStop('fumble');
  }
  const accurate = outcome === 'accurate';
  s.ball = { kind: 'none' };
  let landing: Coord | null = target;
  let out: { last: Coord; off: Coord } | null = null;
  if (accurate) {
    ctx.emit('ball', `Accurate Pass: the ball is heading for ${fmt(target)}.`, R.passTest);
  } else {
    const sc = hailMary && p.star === 'barik' ? (ctx.mode === 'plan' ? blastItPlan(ctx, p, target) : blastIt(ctx, p, target)) : scatter(ctx, target, 3, 'Inaccurate Pass');
    if ('land' in sc) landing = sc.land;
    else {
      landing = null;
      out = sc;
    }
  }

  // Interceptions (p.71)
  if (landing && !hailMary) {
    const cands = interceptors(ctx, p, from, landing);
    if (cands.length) {
      const pick = ctx.ask({
        type: 'interceptor',
        team: other(p.team),
        prompt: `The Range Ruler from ${fmt(from)} to ${fmt(landing)} covers ${cands.length} of your Standing players. Attempt an Interception?`,
        options: [
          ...cands.map((q) => ({ id: q.id, label: `Intercept with ${label(q)}`, square: q.pos as Coord })),
          { id: 'none', label: 'No interception attempt' },
        ],
        rule: R.interception,
        context: { from, landing, accurate },
      });
      if (pick !== 'none') {
        const q = cands.find((c) => c.id === pick) as Player;
        if (interceptAttempt(ctx, q, accurate, 'the pass', 'the pass continues')) {
          s.ball = { kind: 'held', playerId: q.id };
          ctx.emit('ball', `${label(q)} intercepts the pass!`, R.interception, { holder: q.id });
          awardSpp(ctx, q, 'interception');
          ctx.setTurnover('the pass was intercepted', R.interception);
          act.over = true;
          checkTouchdown(ctx, false);
          throw new ActionStop('intercepted');
        }
      }
    }
  } else if (landing && hailMary) {
    ctx.emit('note', 'A Hail Mary Pass cannot be Intercepted.', { page: 129, title: 'Hail Mary Pass' });
  }

  if (landing) {
    ctx.emit('ball', `The ball lands in ${fmt(landing)}.`, R.resolvePass, { landing });
    const direct = ballArrives(ctx, landing, hailMary && p.star === 'barik' ? (p.team === 'A' ? 'barikA' : 'barikB') : eq(landing, target) ? (setPiece && receiver ? 'setPiece' : 'passTarget') : 'pass');
    // Completion (p.96): an Accurate Pass caught by a team-mate without the ball bouncing first.
    const h0 = ballHolder(s);
    if (direct && accurate && h0 && h0.team === p.team && h0.id !== p.id) awardSpp(ctx, p, 'completion');
  } else if (out) {
    throwIn(ctx, out.last, out.off);
  }
  // Sevens Razzle-Dazzle: the second Action (a Block) may still follow the Pass.
  act.over = !(act.razzle && !act.razzle.second);
  const h = ballHolder(s);
  if ((!h || h.team !== p.team) && !ctx.quickBite) ctx.setTurnover('no team-mate caught the pass', R.resolvePass);
  checkTouchdown(ctx, true);
  if (ctx.turnover) throw new ActionStop('pass failed');
  if (canUse(p, 'giveAndGo') && info.range === 'quick' && !hailMary) {
    act.over = false;
    ctx.emit('note', 'Give and Go: the passer may continue moving.', { page: 128, title: 'Give and Go' });
  }
}

/**
 * Barik Farblast's Blast It! (p.195): his Hail Mary Pass scatters as usual, then he may re-roll any of the three
 * scatter dice (once). Execution only — previews use the plain scatter.
 */
function blastIt(ctx: Ctx, p: Player, target: Coord): ReturnType<typeof scatter> {
  const r = ctx.roll({ dice: [8, 8, 8], interpret: (f) => f.join(','), cacheKey: 'd8x3' });
  let faces = r.faces.slice();
  const path = () => scatterPath(target, faces);
  const txt = (x: ReturnType<typeof path>) => ('land' in x ? fmt(x.land) : `out of the pitch after ${fmt(x.last)}`);
  ctx.emit('ball', `Hail Mary Pass: Scatter (3) from ${fmt(target)} — D8 ${faces.join(', ')} → ${txt(path())}.`, R.scatter, { d8: faces, result: path() });
  const subsets: number[][] = [[0], [1], [2], [0, 1], [0, 2], [1, 2], [0, 1, 2]];
  // The choice the previews assume (and the computer makes): the best chance for Barik's team to end with the ball.
  const best = blastItBest(ctx.s, p, target, faces, { useSkillRerolls: true, usePro: true, useTeamRerolls: true });
  const tag = (id: string) => (id === best.choice ? ` — best: ${Math.round(best.ev * 100)}% your team ends with the ball` : '');
  const c = ctx.ask({
    type: 'starRule',
    team: p.team,
    prompt: `Blast It! (Barik Farblast): the ball would come down ${txt(path())} (${Math.round(best.keep * 100)}% your team ends with the ball). Re-roll any of the scatter dice (${faces.join(', ')})?`,
    options: [{ id: 'none', label: `Keep them${tag('none')}` }, ...subsets.map((sub) => ({ id: sub.join(''), label: `Re-roll ${sub.map((i) => `die ${i + 1} (${faces[i]})`).join(' + ')}${tag(sub.join(''))}` }))],
    rule: starRuleRef(STAR_BY_ID.barik),
    context: { star: 'barik', pick: true, best: best.choice },
  });
  if (c !== 'none') {
    const idx = c.split('').map(Number);
    const again = ctx.roll({ dice: idx.map(() => 8), interpret: (f) => f.join(','), cacheKey: `d8x${idx.length}` });
    idx.forEach((i, k) => (faces[i] = again.faces[k]));
    faces = faces.slice();
    ctx.emit('ball', `Blast It!: re-rolled → D8 ${faces.join(', ')} → ${txt(path())}.`, starRuleRef(STAR_BY_ID.barik), { d8: faces, result: path() });
  }
  return path();
}

/**
 * Blast It! while planning: the Hail Mary's landing distribution with the re-roll the previews assume (the best
 * chance for Barik's team to end with the ball, exact) — the same choice the computer makes in the match.
 */
function blastItPlan(ctx: Ctx, p: Player, target: Coord): ReturnType<typeof scatter> {
  const outs = blastItOutcomes(ctx.s, p, target, ctx.policy);
  const r = ctx.dice.choose(outs.map((o) => ({ key: o.key, p: o.p, value: o.value })));
  ctx.emit('ball', `Hail Mary Pass: Scatter (3) from ${fmt(target)} with Blast It! (the best re-roll assumed) → ${'land' in r ? fmt(r.land) : `out of the pitch after ${fmt(r.last)}`}.`, starRuleRef(STAR_BY_ID.barik), { result: r });
  return r;
}

export function handoffBlockedReason(ctx: Ctx, p: Player, receiver: Player): string | null {
  if (hasSkill(p, 'myBall')) return 'My Ball: this player may not declare Hand-off Actions (p.132).';
  if (receiver.team !== p.team) return 'Hand-offs go to a team-mate.';
  if (!hasTackleZone(receiver)) return 'The receiver must be a Standing team-mate who has not lost their Tackle Zone (p.74).';
  void ctx;
  return null;
}

/** Hand-off Action (p.74). */
export function performHandoff(ctx: Ctx, p: Player, receiver: Player, act: Activation): void {
  const s = ctx.s;
  if (!hasBall(s, p)) {
    ctx.emit('note', `${label(p)} is not holding the ball, so no hand-off can be made.`, R.handoff);
    act.over = true;
    return;
  }
  const why = handoffBlockedReason(ctx, p, receiver);
  if (why) throw new IllegalAction(why);
  if (!p.pos || !receiver.pos || !adjacent(p.pos, receiver.pos)) throw new IllegalAction('The receiver must be adjacent to finish a Hand-off.');
  requireBite(ctx, p, act, 'handoff');
  // Bloodlust: the bitten Thrall may have been the receiver — a Hand-off needs a Standing team-mate (p.74).
  if (receiver.location !== 'pitch' || receiver.stance !== 'standing') {
    ctx.emit('status', `${label(receiver)} can no longer take the Hand-off (bitten), so it is not made; ${label(p)} keeps the ball and the activation ends.`, R.handoff, { playerId: p.id });
    act.over = true;
    throw new ActionStop('handoff: receiver bitten');
  }
  if (!animosity(ctx, p, receiver, act)) throw new ActionStop('animosity');
  act.ballActionDone = true;
  ctx.emit('declare', `${label(p)} hands the ball to ${label(receiver)}.`, R.handoff);
  s.ball = { kind: 'none' };
  const ok = catchAttempt(ctx, receiver, 'handoff');
  if (!ok) {
    s.ball = { kind: 'ground', pos: { ...(receiver.pos as Coord) } };
    bounce(ctx, receiver.pos as Coord);
  }
  act.over = !(act.razzle && !act.razzle.second);
  const h = ballHolder(s);
  if ((!h || h.team !== p.team) && !ctx.quickBite) ctx.setTurnover('the hand-off was not caught', R.handoff);
  checkTouchdown(ctx, true);
  if (ctx.turnover) throw new ActionStop('handoff failed');
  if (canUse(p, 'giveAndGo')) {
    act.over = false;
    ctx.emit('note', 'Give and Go: the player may continue moving.', { page: 128, title: 'Give and Go' });
  }
}

/**
 * Dump-off (p.128): the ball carrier targeted by a Block or a Special Action
 * makes a Quick Pass before it is resolved. Normal Quick Pass rules, but it
 * never causes a Turnover (it is not the passer's Turn anyway).
 */
export function dumpOffPass(ctx: Ctx, p: Player, target: Coord): void {
  const s = ctx.s;
  const rule = { page: 128, title: 'Dump-off' };
  const from = p.pos as Coord;
  const info = passInfo(ctx, p, from, target, false);
  if (typeof info === 'string' || info.range !== 'quick' || p.pa === null) return;
  const receiver = playerAt(s, target);
  ctx.emit('declare', `${label(p)} dumps the ball off: a Quick Pass to ${fmt(target)}${receiver ? ` (${label(receiver)})` : ''}.`, rule, { from, target, range: 'quick' });
  const safePass = canUse(p, 'safePass');
  const pa = p.pa;
  const res = rollTest(ctx, {
    kind: 'pass',
    player: p,
    label: 'Passing Ability Test (Quick Pass, Dump-off)',
    target: pa,
    mods: info.mods,
    rule: R.passTest,
    outcome: (n, m) => {
      if (n === 1) return safePass ? 'safe' : 'fumble';
      const mod = Math.max(1, Math.min(6, n + m));
      if (n !== 6 && mod <= 1) return 'fumble';
      return d6Success(n, pa, m) ? 'accurate' : 'inaccurate';
    },
    outcomeKey: `pass${pa}|${safePass}|false`,
    isSuccess: (o) => o === 'accurate',
    skillReroll: { id: 'pass', name: 'Pass', available: canUse(p, 'pass') },
    teamReroll: false,
    proAllowed: false,
    onFail: 'Inaccurate (Scatter 3) or Fumbled',
  });
  if (res.outcome === 'safe') {
    ctx.emit('ball', `Safe Pass: ${label(p)} keeps the ball.`, { page: 135, title: 'Safe Pass' });
    return;
  }
  if (res.outcome === 'fumble') {
    ctx.emit('ball', `Fumbled Dump-off! The ball bounces from ${fmt(from)} (no Turnover).`, rule);
    s.ball = { kind: 'ground', pos: { ...from } };
    bounce(ctx, from);
    return;
  }
  const accurate = res.outcome === 'accurate';
  s.ball = { kind: 'none' };
  let landing: Coord | null = target;
  let out: { last: Coord; off: Coord } | null = null;
  if (!accurate) {
    const sc = scatter(ctx, target, 3, 'Inaccurate Pass');
    if ('land' in sc) landing = sc.land;
    else {
      landing = null;
      out = sc;
    }
  }
  if (landing) {
    const cands = interceptors(ctx, p, from, landing);
    if (cands.length) {
      const pick = ctx.ask({
        type: 'interceptor',
        team: other(p.team),
        prompt: `The Range Ruler of the Dump-off covers ${cands.length} of your Standing players. Attempt an Interception?`,
        options: [...cands.map((q) => ({ id: q.id, label: `Intercept with ${label(q)}`, square: q.pos as Coord })), { id: 'none', label: 'No interception attempt' }],
        rule: R.interception,
        context: { from, landing, accurate },
      });
      if (pick !== 'none') {
        const q = cands.find((c) => c.id === pick) as Player;
        if (interceptAttempt(ctx, q, accurate, 'the pass', 'the pass continues')) {
          s.ball = { kind: 'held', playerId: q.id };
          ctx.emit('ball', `${label(q)} intercepts the Dump-off!`, R.interception, { holder: q.id });
          awardSpp(ctx, q, 'interception');
          checkTouchdown(ctx, false);
          return;
        }
      }
    }
    ctx.emit('ball', `The ball lands in ${fmt(landing)}.`, R.resolvePass, { landing });
    ballArrives(ctx, landing, eq(landing, target) ? 'passTarget' : 'pass');
  } else if (out) throwIn(ctx, out.last, out.off);
  checkTouchdown(ctx, false);
}
