import { askBananaSkin } from './desperate';
import { molesUnder } from './prayers';
import { adjacent, dist, eq, fmt, inBounds, inScoringEndZone } from './board';
import { checkTouchdown } from './ball';
import { ActionStop, Ctx, IllegalAction, type Mod } from './context';
import { d6Success } from './dice';
import { goDown, trapdoorCheck } from './injury';
import { plainD6, rollTest } from './roll';
import { R } from './rules';
import { canUse, faq2026, hasBall, hasSkill, hasTackleZone, heldInPlace, isOpen, label, markersOf, pitchPlayers, playerAt } from './state';
import { bounce } from './ball';
import type { Activation, Coord, PathStep, Player } from './types';
import { askStar, spendStar, starReady } from './stars';

export function maxRushes(p: Player): number {
  return 2 + (canUse(p, 'sprint') ? 1 : 0);
}

export function breakTackleValue(p: Player): number {
  return p.st >= 5 ? 3 : p.st === 4 ? 2 : 1;
}

/** Stand up at the start of a move (p.54). Returns false if the activation ended. */
export function standUp(ctx: Ctx, p: Player, act: Activation): boolean {
  if (p.stance !== 'prone') return true;
  if (canUse(p, 'jumpUp')) {
    p.stance = 'standing';
    ctx.emit('move', `${label(p)} stands up for free (Jump Up).`, { page: 130, title: 'Jump Up' }, { playerId: p.id, standUp: true });
    return true;
  }
  if (p.ma <= 2) {
    const mods: Mod[] = [];
    if (hasSkill(p, 'timmmber')) {
      const helpers = pitchPlayers(ctx.s, p.team).filter((q) => q.id !== p.id && adjacent(q.pos as Coord, p.pos as Coord) && isOpen(ctx.s, q)).length;
      if (helpers) mods.push({ label: `Timmm-ber! x${helpers}`, value: helpers });
    }
    const res = rollTest(ctx, {
      kind: 'standUp',
      player: p,
      label: `${label(p)} stands up (MA ${p.ma})`,
      target: 4,
      mods,
      rule: R.standUp,
      teamReroll: true,
      proAllowed: true,
      onFail: 'stays Prone and the activation ends',
    });
    if (!res.success) {
      ctx.emit('status', `${label(p)} fails to stand up and remains Prone; the activation ends.`, R.standUp);
      act.over = true;
      return false;
    }
    p.stance = 'standing';
    act.maUsed = Math.max(act.maUsed, p.ma);
    ctx.emit('move', `${label(p)} stands up using their full Move Allowance.`, R.standUp, { playerId: p.id, standUp: true });
    return true;
  }
  p.stance = 'standing';
  act.maUsed += 3;
  ctx.emit('move', `${label(p)} stands up (3 squares of Move Allowance).`, R.standUp, { playerId: p.id, standUp: true });
  return true;
}

/** Pay `cost` squares of movement, rushing as needed (p.58). Throws ActionStop if a Rush fails. */
export function payMovement(ctx: Ctx, p: Player, act: Activation, cost: number, fallAt: Coord | null, why: string): void {
  const maLeft = Math.max(0, p.ma - act.maUsed);
  const rushNeeded = Math.max(0, cost - maLeft);
  if (rushNeeded > maxRushes(p) - act.rushesUsed) throw new IllegalAction(`${label(p)} does not have enough movement to ${why}.`);
  act.maUsed += Math.min(cost, maLeft);
  for (let i = 0; i < rushNeeded; i++) {
    act.rushesUsed += 1;
    const mods: Mod[] = [];
    if (ctx.s.weather === 'blizzard') mods.push({ label: 'Blizzard', value: -1 });
    if (hasSkill(p, 'drunkard')) mods.push({ label: 'Drunkard', value: -1 });
    if (molesUnder(ctx.s, p)) mods.push({ label: 'Moles under the Pitch', value: -1 });
    const res = rollTest(ctx, {
      kind: 'rush',
      player: p,
      at: fallAt ?? (p.pos as Coord),
      label: `Rush ${act.rushesUsed} to ${why}`,
      target: 2,
      mods,
      rule: R.rush,
      skillReroll: { id: 'sureFeet', name: 'Sure Feet', available: canUse(p, 'sureFeet') && !p.usage.sureFeet, markUsed: () => (p.usage.sureFeet = true) },
      teamReroll: true,
      proAllowed: true,
      onFail: 'falls over — Turnover',
    });
    if (!res.success) {
      if (fallAt && !eq(fallAt, p.pos)) {
        const from = p.pos as Coord;
        p.pos = { ...fallAt };
        ctx.emit('move', `${label(p)} rushes from ${fmt(from)} into ${fmt(fallAt)} and trips.`, R.rush, { playerId: p.id, from, to: fallAt });
      }
      // FAQ May 2026 p.136: a successful Steady Footing means the player did not fall over, so the submitted movement goes on.
      if (!(goDown(ctx, p, { kind: 'fellOver', reason: 'failed Rush' }).avoided && faq2026(ctx.s))) throw new ActionStop('fell');
    }
  }
}

export interface StepOptions {
  /** Moving onto the ball does not trigger a normal pick-up (Secure the Ball's final square). */
  noPickup?: boolean;
}

function chooseOne(ctx: Ctx, list: Player[], type: 'tentacles' | 'shadowing' | 'divingTackle', prompt: string, rule: { page: number; title: string }, allowDecline: boolean): Player | null {
  if (!list.length) return null;
  const opts = list.map((q) => ({ id: q.id, label: `Use ${label(q)}`, square: q.pos ?? undefined }));
  if (allowDecline) opts.push({ id: 'none', label: 'Do not use it', square: undefined });
  const choice = ctx.ask({ type, team: list[0].team, prompt, options: opts, rule });
  if (choice === 'none') return null;
  return list.find((q) => q.id === choice) ?? null;
}

/**
 * Tentacles (p.137): when leaving a Tentacles player's Tackle Zone by a Dodge,
 * Jump or Leap. Resolved before the Agility Test. Returns true if held.
 */
function tentacles(ctx: Ctx, p: Player, from: Coord): boolean {
  const ts = markersOf(ctx.s, from, p.team).filter((q) => canUse(q, 'tentacles'));
  const t = chooseOne(ctx, ts, 'tentacles', `${label(p)} is trying to leave ${fmt(from)}. Use Tentacles to hold them in place?`, { page: 137, title: 'Tentacles' }, true);
  if (!t) return false;
  const r = ctx.roll({
    dice: [6],
    interpret: ([n]) => (n === 6 || (n !== 1 && n + t.st - p.st >= 6) ? 'held' : 'free'),
    cacheKey: `tent|${t.st - p.st}`,
    by: t.team,
    judge: (v) => (v === 'held' ? 1 : -1),
    prefer: (v) => v === 'free',
  });
  const n = r.faces[0];
  ctx.emit('roll', `Tentacles (${label(t)}): rolled ${n} +${t.st} ST −${p.st} ST = ${n + t.st - p.st}; needs 6+ — ${r.value === 'held' ? `${label(p)} is held and the activation ends` : 'no effect'}.`, { page: 137, title: 'Tentacles' });
  return r.value === 'held';
}

/** Moves `p` one path step (p.54-58). Throws ActionStop when the activation must end. */
export function moveStep(ctx: Ctx, p: Player, act: Activation, step: PathStep, opts: StepOptions = {}): void {
  const s = ctx.s;
  const from = p.pos as Coord;
  const to = step.to;
  if (!inBounds(to)) throw new IllegalAction('Players can never voluntarily move off the pitch.');
  if (playerAt(s, to)) throw new IllegalAction(`${fmt(to)} is occupied.`);
  const held = heldInPlace(s, p);
  if (held) throw new IllegalAction(held);
  const isJump = step.kind !== 'step';
  if (!isJump && !adjacent(from, to)) throw new IllegalAction(`${fmt(to)} is not adjacent to ${fmt(from)}.`);
  if (isJump) {
    if (dist(from, to) !== 2) throw new IllegalAction('A Jump/Leap must land two squares away.');
    const mid = jumpedSquare(s, p, from, to, step.kind);
    if (!mid) throw new IllegalAction(`No valid square to ${step.kind} over between ${fmt(from)} and ${fmt(to)}.`);
  }
  const cost = isJump ? 2 : 1;
  // Rowana Forestfoot's Bounding Leap (p.207): once per game, declared before any dice for the Leap are rolled —
  // no negative modifiers to its Agility Test, and she may re-roll it.
  let bounding = false;
  if (step.kind === 'leap' && starReady(s, p, 'rowana')) {
    const hurt = Math.max(markersOf(s, from, p.team).length, markersOf(s, to, p.team).length) > 0;
    bounding = askStar(ctx, p, `Leap ${fmt(from)} → ${fmt(to)} with no negative modifiers, and a re-roll if it fails?`, 'Use Bounding Leap', hurt);
    if (bounding) spendStar(ctx, p, `no negative modifiers for this Leap, and she may re-roll it.`);
  }
  // Rushes come first (p.58). A failed Rush for a normal step falls in the target square;
  // a failed Rush before a Jump falls in the current square (p.56).
  payMovement(ctx, p, act, cost, isJump ? null : to, `move to ${fmt(to)}`);

  const markersFrom = markersOf(s, from, p.team);
  const leaving = markersFrom.length > 0;

  if (leaving && tentacles(ctx, p, from)) {
    act.over = true;
    throw new ActionStop('held');
  }

  const dtCandidates = leaving ? markersFrom.filter((q) => canUse(q, 'divingTackle')) : [];
  const ptCount = leaving && markersFrom.some((q) => canUse(q, 'prehensileTail')) ? 1 : 0;
  const armBar = markersFrom.filter((q) => canUse(q, 'armBar'));

  if (!isJump) {
    // move into the square first, then Dodge if leaving a Marked square (p.55)
    p.pos = { ...to };
    ctx.emit('move', `${label(p)} moves ${fmt(from)} → ${fmt(to)}.`, R.move, { playerId: p.id, from, to });
    // Gretchen Wächter's Incorporeal (p.200): no Dodge rolls for the rest of her activation (nor Diving Tackle on them).
    const incorporeal = !!act.starFlags?.includes('incorporeal');
    if (leaving && incorporeal) ctx.emit('note', `${label(p)} leaves ${fmt(from)} without a Dodge roll (Incorporeal).`, { page: 200, title: 'Gretchen Wächter: Incorporeal' });
    if (leaving && !incorporeal) {
      const markersTo = markersOf(s, to, p.team).filter((q) => !hasSkill(q, 'titchy'));
      const mods: Mod[] = [];
      if (markersTo.length && !hasSkill(p, 'stunty')) mods.push({ label: `Marked x${markersTo.length} in ${fmt(to)}`, value: -markersTo.length });
      if (ptCount) mods.push({ label: 'Prehensile Tail', value: -1 });
      if (canUse(p, 'twoHeads')) mods.push({ label: 'Two Heads', value: 1 });
      if (hasSkill(p, 'titchy')) mods.push({ label: 'Titchy', value: 1 });
      const tackle = markersFrom.some((q) => canUse(q, 'tackle'));
      const btAvail = canUse(p, 'breakTackle') && !p.usage.breakTackle;
      const res = rollTest(ctx, {
        kind: 'dodge',
        player: p,
        label: `Dodge from ${fmt(from)} to ${fmt(to)}`,
        target: p.ag,
        mods,
        rule: R.dodge,
        skillReroll: { id: 'dodge', name: tackle ? 'Dodge (cancelled by Tackle)' : 'Dodge', available: canUse(p, 'dodge') && !p.usage.dodgeReroll && !tackle, markUsed: () => (p.usage.dodgeReroll = true) },
        teamReroll: true,
        proAllowed: true,
        bonus: btAvail ? { id: 'breakTackle', name: 'Break Tackle', value: breakTackleValue(p), markUsed: () => (p.usage.breakTackle = true) } : undefined,
        lateMalus: dtCandidates.length ? -2 : undefined,
        onFail: 'falls over — Turnover',
        extra: tackle ? { tackle: true } : undefined,
      });
      let ok = res.success;
      if (ok && dtCandidates.length && res.lateOutcome === 'F') {
        const dt = chooseOne(ctx, dtCandidates, 'divingTackle', `${label(p)} dodged successfully (rolled ${res.natural}). Use Diving Tackle (−2, the tackler is Placed Prone in ${fmt(from)})?`, { page: 127, title: 'Diving Tackle' }, true);
        if (dt) {
          ok = false;
          dt.pos = { ...from };
          ctx.emit('roll', `Diving Tackle by ${label(dt)}: −2 turns the Dodge into a failure.`, { page: 127, title: 'Diving Tackle' });
          goDown(ctx, dt, { kind: 'placedProne', reason: 'Diving Tackle' });
        }
      }
      // FAQ May 2026 p.55: Shadowing happens only after a SUCCESSFUL Dodge (a Dodge turned into a failure by Diving Tackle is a failure).
      if (ok || !faq2026(ctx.s)) shadowing(ctx, p, from, markersFrom);
      if (!ok) {
        // Steady Footing (FAQ May 2026 p.136): the player stays Standing in the square entered and the movement continues.
        if (!(goDown(ctx, p, { kind: 'fellOver', reason: 'failed Dodge', armBar }).avoided && faq2026(ctx.s))) throw new ActionStop('fell');
      }
    }
  } else {
    const mods = jumpMods(s, p, from, to, step.kind, bounding);
    const verb = step.kind === 'step' ? 'Move' : step.kind === 'jump' ? 'Jump' : step.kind === 'leap' ? 'Leap' : 'Pogo';
    const res = rollTest(ctx, {
      kind: 'jump',
      player: p,
      at: to,
      label: `${verb} from ${fmt(from)} to ${fmt(to)}`,
      target: p.ag,
      mods,
      rule: step.kind === 'jump' ? R.jump : { page: step.kind === 'leap' ? 130 : 133, title: verb },
      outcome: (n, m) => (n === 1 ? 'F1' : d6Success(n, p.ag, m) ? 'S' : 'F'),
      outcomeKey: `jump${p.ag}`,
      subkind: step.kind,
      skillReroll: bounding ? { id: 'leap', name: 'Bounding Leap (Rowana Forestfoot)', available: true } : undefined,
      teamReroll: true,
      proAllowed: true,
      lateMalus: dtCandidates.length ? -2 : undefined,
      onFail: 'falls over — Turnover',
    });
    let outcome = res.outcome;
    let diver: Player | null = null;
    if (outcome === 'S' && dtCandidates.length && res.lateOutcome !== 'S') {
      diver = chooseOne(ctx, dtCandidates, 'divingTackle', `${label(p)} landed the ${verb} (rolled ${res.natural}). Use Diving Tackle (−2, the tackler is Placed Prone in ${fmt(from)})?`, { page: 127, title: 'Diving Tackle' }, true);
      if (diver) {
        outcome = res.lateOutcome as string;
        ctx.emit('roll', `Diving Tackle by ${label(diver)}: −2 turns the ${verb} into a failure.`, { page: 127, title: 'Diving Tackle' });
      }
    }
    if (outcome === 'F1') {
      ctx.emit('move', `${label(p)} rolled a natural 1 and falls over in ${fmt(from)}.`, R.jump);
      goDown(ctx, p, { kind: 'fellOver', reason: `failed ${verb} (natural 1)`, armBar });
      throw new ActionStop('fell');
    }
    p.pos = { ...to };
    ctx.emit('move', `${label(p)} ${verb === 'Pogo' ? 'pogoes' : verb.toLowerCase() + 's'} ${fmt(from)} → ${fmt(to)}.`, step.kind === 'jump' ? R.jump : { page: 130, title: verb }, { playerId: p.id, from, to, kind: step.kind });
    if (diver) {
      diver.pos = { ...from };
      goDown(ctx, diver, { kind: 'placedProne', reason: 'Diving Tackle' });
    }
    if (outcome !== 'S') {
      if (!(goDown(ctx, p, { kind: 'fellOver', reason: `failed ${verb}`, armBar }).avoided && faq2026(ctx.s))) throw new ActionStop('fell');
    }
  }

  // Sevens Desperate Measure Discarded Banana Skin (Spike! 22 p.15): entering a Tackle Zone of the team that has it.
  if (askBananaSkin(ctx, p, from)) {
    goDown(ctx, p, { kind: 'placedProne', reason: 'Discarded Banana Skin' });
    act.over = true;
    throw new ActionStop('banana skin');
  }
  // Treacherous Trapdoor (Prayer to Nuffle, p.143).
  if (trapdoorCheck(ctx, p)) throw new ActionStop('trapdoor');
  // Picking up the ball (p.57)
  if (s.ball.kind === 'ground' && eq(s.ball.pos, p.pos) && !opts.noPickup) {
    pickUp(ctx, p);
  }
  if (hasBall(s, p) && inScoringEndZone(p.team, p.pos as Coord)) checkTouchdown(ctx, true);
}

function shadowing(ctx: Ctx, p: Player, from: Coord, markersFrom: Player[]): void {
  const cands = markersFrom.filter((q) => canUse(q, 'shadowing') && (q.usage.shadowing ?? 0) < q.ma);
  if (!cands.length || playerAt(ctx.s, from)) return;
  const sh = chooseOne(ctx, cands, 'shadowing', `${label(p)} dodged out of ${fmt(from)}. Use Shadowing (4+) to follow into the vacated square?`, { page: 135, title: 'Shadowing' }, true);
  if (!sh) return;
  sh.usage.shadowing = (sh.usage.shadowing ?? 0) + 1;
  const r = plainD6(ctx, `Shadowing (${label(sh)}) needs 4+`, { page: 135, title: 'Shadowing' }, (n) => n >= 4, 'shadow4', 'F', sh.team);
  if (r.ok && !playerAt(ctx.s, from)) {
    const old = sh.pos as Coord;
    sh.pos = { ...from };
    ctx.emit('move', `${label(sh)} shadows from ${fmt(old)} into ${fmt(from)}.`, { page: 135, title: 'Shadowing' }, { playerId: sh.id, from: old, to: from });
  }
}

/** Voluntary pick-up of the ball (p.57). Throws ActionStop on failure (Turnover). */
export function pickUp(ctx: Ctx, p: Player): void {
  const s = ctx.s;
  const mods: Mod[] = [];
  const m = markersOf(s, p.pos as Coord, p.team).length;
  const big = canUse(p, 'bigHand');
  if (m && !big) mods.push({ label: `Marked x${m}`, value: -m });
  if (s.weather === 'pouringRain' && !big) mods.push({ label: 'Pouring Rain', value: -1 });
  if (canUse(p, 'extraArms')) mods.push({ label: 'Extra Arms', value: 1 });
  const res = rollTest(ctx, {
    kind: 'pickup',
    player: p,
    label: `${label(p)} picks up the ball in ${fmt(p.pos)}`,
    target: p.ag,
    mods,
    rule: R.pickUp,
    skillReroll: { id: 'sureHands', name: 'Sure Hands', available: canUse(p, 'sureHands') },
    teamReroll: true,
    proAllowed: true,
    onFail: 'the ball bounces — Turnover',
    autoFail: hasSkill(p, 'noBall') ? 'No Ball' : undefined,
  });
  if (res.success) {
    s.ball = { kind: 'held', playerId: p.id };
    ctx.emit('ball', `${label(p)} picks up the ball.`, R.pickUp, { holder: p.id });
    return;
  }
  ctx.setTurnover(`${label(p)} failed to pick up the ball`, R.turnover);
  const act = s.turn.activation;
  if (act) act.over = true;
  bounce(ctx, p.pos as Coord);
  throw new ActionStop('pickup failed');
}

/**
 * The square jumped over between `from` and `to`, or null if not allowed.
 * Jump (p.56): over a Prone/Stunned player into a square adjacent to them and
 * not adjacent to the jumper. Leap/Pogo (p.130/133): over any adjacent square.
 */
export function jumpedSquare(s: Ctx['s'], p: Player, from: Coord, to: Coord, kind: PathStep['kind']): Coord | null {
  if (dist(from, to) !== 2) return null;
  const cands: Coord[] = [];
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const c = { x: from.x + dx, y: from.y + dy };
      if (!inBounds(c)) continue;
      if (adjacent(c, to) && !adjacent(from, to)) cands.push(c);
    }
  for (const c of cands) {
    const occ = playerAt(s, c);
    if (kind === 'jump') {
      if (occ && occ.stance !== 'standing') return c;
    } else if (kind === 'leap' && canUse(p, 'leap')) return c;
    else if (kind === 'pogo' && canUse(p, 'pogo')) return c;
  }
  return null;
}

/**
 * V5.5: the modifiers of the Agility Test for a Jump (p.56), Leap (p.132) or Pogo (p.133) from `from` to `to` — the
 * one function used both to roll the test and to show it while planning (so the shown odds are the rolled odds).
 * Jump: −1 per opponent Marking the square left or the square jumped into, whichever is higher (Prehensile Tail −1
 * more); Leap reduces that by 1 to a minimum of −1; Pogo and Bounding Leap ignore negative modifiers; Very Long Legs +1.
 */
export function jumpMods(s: Ctx['s'], p: Player, from: Coord, to: Coord, kind: PathStep['kind'], bounding = false): Mod[] {
  const markersFrom = markersOf(s, from, p.team);
  const ptCount = markersFrom.length > 0 && markersFrom.some((q) => canUse(q, 'prehensileTail')) ? 1 : 0;
  const markersTo = markersOf(s, to, p.team).filter((q) => q.id !== p.id).length;
  const worst = Math.max(markersFrom.length, markersTo);
  let neg = -worst - ptCount;
  if (kind === 'leap' && neg < 0) neg = Math.min(-1, neg + 1);
  if (kind === 'pogo' || bounding) neg = 0;
  const mods: Mod[] = [];
  if (neg) mods.push({ label: kind === 'leap' ? `Marked (max of ${markersFrom.length}/${markersTo})${ptCount ? ' + Prehensile Tail' : ''}, Leap −1` : `Marked (max of ${markersFrom.length}/${markersTo})${ptCount ? ' + Prehensile Tail' : ''}`, value: neg });
  if (canUse(p, 'veryLongLegs')) mods.push({ label: 'Very Long Legs', value: 1 });
  return mods;
}

export function playerCanActivate(p: Player): boolean {
  return p.location === 'pitch' && (p.stance === 'standing' || p.stance === 'prone') && !p.activated;
}

export { hasTackleZone };
