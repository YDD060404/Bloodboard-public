/**
 * The computer opponent's decision making.
 *
 *  1. Read the position (score, Turns left, ball, players, threats).
 *  2. Pick an objective; urgent situations override the ordinary one.
 *  3. Enumerate legal candidate actions with the engine (actionOptions,
 *     reachableSquares, safestRoute, blockBreakdown …) and pre-screen them cheaply.
 *  4. For the promising ones, enumerate every dice outcome with the engine's
 *     own outcome tree (exploreOutcomes — no dice are rolled) and compute the
 *     expected change of the position value, charging a Turnover with the
 *     value of the rest of the Turn it would lose.
 *  5. Return one action; the caller executes it through the normal flow and
 *     asks again after seeing the real result.
 */
import type { ActionInput, Coord, DecisionRequest, GameState, PathStep, Player, PlayerActionInput, TeamId } from '../../../src/engine/index';
import { E } from './engine';
import { cheb, dGoal, emphasise, evalTotal, evaluate, goalX, horizonFor, lastX, lastY, other, playerWorth, styleWeights, type Horizon, type Weights } from './evaluate';
import { OBJECTIVE_LABEL, type AIDecision, type AIStyle, type Candidate, type Objective } from './types';

export interface ThinkOptions {
  style: AIStyle;
  /** Outcome branches less likely than this are not expanded (their mass is estimated). */
  threshold?: number;
  maxLeaves?: number;
  /** Pre-screened candidates enumerated exactly (blocks, scoring and special actions are always enumerated). */
  maxExplored?: number;
  /** An action must improve the expected position value by more than this, otherwise the AI ends its Turn. */
  minGain?: number;
}

const DEFAULTS = { threshold: 1e-4, maxLeaves: 2500, maxExplored: 12, minGain: 0.5 };

const up = (p: Player) => p.location === 'pitch' && p.stance === 'standing' && !!p.pos;
const activeUp = (p: Player) => up(p) && !p.distracted;
const step = (to: Coord): PathStep => ({ to: { ...to }, kind: 'step' });
const pct = (x: number) => `${Math.round(x * 100)}%`;

interface Board {
  s: GameState;
  team: TeamId;
  opp: TeamId;
  w: Weights;
  hz: Horizon;
  /** Position value now. */
  V0: number;
  /** What team-mates who have not acted could add around our ball carrier where he stands (supportUplift). */
  U0: number;
  /** Team-mates that support would come from. */
  helpers: string[];
  terms: Record<string, number>;
  /** Scratch copy for cheap "what if this player stood there" evaluations. */
  work: GameState;
}

function holderOf(s: GameState): Player | undefined {
  return s.ball.kind === 'held' ? E.findPlayer(s, s.ball.playerId) : undefined;
}

/** Value of the position with `id` standing on `to` (and optionally the ball moved), computed on the scratch copy. */
function valueWith(b: Board, id: string, to: Coord | null, ballTo?: 'pickup' | { holder: string }): number {
  const wp = b.work.players.find((q) => q.id === id) as Player;
  const saved = { pos: wp.pos, stance: wp.stance, ball: b.work.ball };
  if (to) {
    wp.pos = { ...to };
    wp.stance = 'standing';
  }
  if (ballTo === 'pickup') b.work.ball = { kind: 'held', playerId: id };
  else if (ballTo) b.work.ball = { kind: 'held', playerId: ballTo.holder };
  const v = evalTotal(b.work, b.team, b.w, b.hz);
  wp.pos = saved.pos;
  wp.stance = saved.stance;
  b.work.ball = saved.ball;
  return v;
}

function inScoringZone(team: TeamId, c: Coord): boolean {
  return c.x === goalX(team);
}

// ---------------------------------------------------------------------------
// Objectives
// ---------------------------------------------------------------------------

export function chooseObjective(s: GameState, team: TeamId, style: AIStyle): Objective {
  const opp = other(team);
  const hz = horizonFor(s, team);
  const h = holderOf(s);
  const pitch = s.players.filter((p) => p.location === 'pitch' && p.pos);
  if (h && h.team === team && h.pos) {
    const act = s.turn.activation;
    const canAct = !h.activated || (act?.playerId === h.id && !act.over);
    if (canAct && h.stance === 'standing') {
      const ez = E.reachableSquares(s, h.id).filter((r) => inScoringZone(team, r.c));
      let best = 0;
      for (const r of ez.slice(0, 6)) {
        const route = E.safestRoute(s, h.id, r.c);
        if (route) best = Math.max(best, route.pSafe);
      }
      if (best >= 0.3) return { id: 'score', urgent: true, why: `${E.label(h)} can reach the End Zone this Turn (about ${pct(best)} without Team Re-rolls)` };
    }
    const markers = E.markersOf(s, h.pos, team).length;
    const threats = pitch.filter((q) => q.team === opp && activeUp(q) && cheb(q.pos as Coord, h.pos as Coord) > 1 && cheb(q.pos as Coord, h.pos as Coord) - 1 <= q.ma + 2).length;
    const cage = pitch.filter((q) => q.team === team && q.id !== h.id && up(q) && cheb(q.pos as Coord, h.pos as Coord) === 1).length;
    if (markers) return { id: 'protectCarrier', urgent: true, why: `${E.label(h)} holds the ball and is Marked by ${markers} opponent${markers > 1 ? 's' : ''}` };
    if (hz.oppNext && threats >= (style === 'defensive' ? 1 : 2) && cage < (style === 'offensive' ? 1 : 2)) return { id: 'protectCarrier', urgent: false, why: `${threats} opponent${threats > 1 ? 's' : ''} could reach ${E.label(h)} next Turn` };
    return { id: 'advance', urgent: false, why: `${E.label(h)} has the ball, ${dGoal(team, h.pos)} squares from the End Zone` };
  }
  if (h && h.team === opp && h.pos) {
    const dg = dGoal(opp, h.pos);
    if (hz.oppNext && dg <= h.ma + 2) return { id: 'stopScore', urgent: true, why: `${E.label(h)} could score next Turn (${dg} squares from our End Zone, MA ${h.ma})` };
    return { id: 'pressureCarrier', urgent: false, why: `${E.label(h)} has the ball, ${dg} squares from our End Zone` };
  }
  if (s.ball.kind === 'ground') {
    const b = s.ball.pos;
    const near = (tm: TeamId) => Math.min(99, ...pitch.filter((q) => q.team === tm && activeUp(q)).map((q) => cheb(q.pos as Coord, b)));
    const dUs = near(team);
    const dThem = near(opp);
    if (dThem <= 3 || dThem <= dUs) return { id: 'recoverBall', urgent: true, why: `the ball is loose; nearest opponent ${dThem} square${dThem === 1 ? '' : 's'} away, nearest team-mate ${dUs}` };
    return { id: 'contestBall', urgent: false, why: `the ball is loose; nearest team-mate ${dUs} squares away` };
  }
  return { id: 'position', urgent: false, why: 'no one has the ball' };
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

function canAct(s: GameState, p: Player): boolean {
  return !E.activationBlockReason(s, p);
}

interface PlayerGen {
  cands: Candidate[];
  /** Best cheap value this player could still add (for the rest-of-Turn estimate). */
  best: number;
}

function blockScore(code: string): number {
  return ({ '3D': 3, '2D': 2, '1D': 1, '-2D': -1, '-3D': -2 } as Record<string, number>)[code] ?? 0;
}

function genForPlayer(b: Board, p: Player): PlayerGen {
  const s = b.s;
  const out: Candidate[] = [];
  let best = 0;
  if (!p.pos || !canAct(s, p)) return { cands: out, best };
  const opts = E.actionOptions(s, p);
  const on = (a: string) => opts.find((o) => o.action === a && o.enabled);
  const act = s.turn.activation;
  const continuing = !!act && act.playerId === p.id && !act.over;
  const moveAction = continuing ? act!.action : on('move') ? 'move' : null;
  const holder = holderOf(s);
  const carrying = holder?.id === p.id;
  const who = E.label(p);
  const failBase = 3 + (carrying ? 22 : 0) + 4;

  // --- Moves (including standing up and picking up the ball) --------------
  if (moveAction && ['move', 'blitz', 'handoff', 'pass', 'secure'].includes(moveAction)) {
    const startMarked = E.markersOf(s, p.pos, b.team).length > 0 && p.stance === 'standing';
    const dodgeP = startMarked ? E.d6SuccessProb(p.ag, 0) : 1;
    const reach = E.reachableSquares(s, p.id);
    const scored: Array<{ c: Coord; pre: number; v: number }> = [];
    const loose = s.ball.kind === 'ground' ? s.ball.pos : null;
    for (const r of reach) {
      const pr = Math.pow(5 / 6, r.rushes) * dodgeP;
      const isTD = carrying && inScoringZone(b.team, r.c);
      const pickup = !!loose && loose.x === r.c.x && loose.y === r.c.y;
      const v = isTD ? b.V0 + b.w.td : valueWith(b, p.id, r.c, pickup ? 'pickup' : undefined);
      const pSucc = pickup ? pr * E.d6SuccessProb(p.ag, -E.markersOf(s, r.c, b.team).length) : pr;
      scored.push({ c: r.c, pre: pSucc * (v - b.V0) - (1 - pSucc) * failBase, v });
    }
    scored.sort((x, y) => y.pre - x.pre);
    const keep = scored.slice(0, 3);
    if (carrying) {
      // The ball carrier: the best square for every distance gained, so short safe advances
      // are weighed against long exposed ones (not only the most forward squares).
      // (two per distance: the pre-screen does not see how team-mates can cage him there)
      const byAdvance = new Map<number, Array<(typeof scored)[number]>>();
      for (const k of scored) {
        const d = dGoal(b.team, k.c);
        const list = byAdvance.get(d) ?? [];
        if (list.length < 2) list.push(k);
        byAdvance.set(d, list);
      }
      const lists = [...byAdvance.values()].sort((x, y) => y[0].pre - x[0].pre);
      lists.forEach((list, i) => {
        for (const k of list.slice(0, i < 3 ? 2 : 1)) if (!keep.includes(k)) keep.push(k);
      });
    }
    if (loose && !keep.some((k) => k.c.x === loose.x && k.c.y === loose.y)) {
      const ballSq = scored.find((k) => k.c.x === loose.x && k.c.y === loose.y);
      if (ballSq) keep.push(ballSq);
    }
    if (carrying) {
      const td = scored.filter((k) => inScoringZone(b.team, k.c)).slice(0, 2);
      for (const k of td) if (!keep.includes(k)) keep.push(k);
    }
    for (const k of keep) {
      const route = E.safestRoute(s, p.id, k.c);
      if (!route) continue;
      const pickup = !!loose && loose.x === k.c.x && loose.y === k.c.y;
      const pSucc = pickup ? route.pSafe * E.d6SuccessProb(p.ag, -E.markersOf(s, k.c, b.team).length) : route.pSafe;
      const pre = pSucc * (k.v - b.V0) - (1 - pSucc) * failBase;
      best = Math.max(best, route.pSafe >= 0.999 ? pre : 0);
      const kind = pickup ? 'pickup' : carrying && inScoringZone(b.team, k.c) ? 'score' : carrying ? 'carry' : continuing ? 'continue' : 'move';
      out.push({
        input: { kind: 'playerAction', playerId: p.id, action: moveAction, path: route.path } as PlayerActionInput,
        label: `${who}: ${pickup ? 'pick up the ball in' : kind === 'score' ? 'run in to score at' : 'move to'} ${E.board.fmt(k.c)}`,
        kind,
        playerId: p.id,
        prescore: pre,
      });
    }
    if (p.stance === 'prone' && !continuing) {
      const v = valueWith(b, p.id, p.pos);
      const pre = v - b.V0;
      best = Math.max(best, pre);
      out.push({ input: { kind: 'playerAction', playerId: p.id, action: 'move', path: [] }, label: `${who}: stand up`, kind: 'standUp', playerId: p.id, prescore: pre });
    }
  }

  const opps = b.s.players.filter((q) => q.team === b.opp && up(q));
  // Their ball carrier, or an opponent next to ours: Blocks and Blitzes on them are always weighed.
  const keyTarget = (q: Player) => !!holder && !!holder.pos && (holder.id === q.id || (holder.team === b.team && cheb(q.pos as Coord, holder.pos) === 1));
  // --- Block ---------------------------------------------------------------
  if (on('block') && p.stance === 'standing') {
    for (const q of opps) {
      if (cheb(q.pos as Coord, p.pos) !== 1) continue;
      const bb = E.blockBreakdown(s, p.id, q.id);
      const pre = 4 + blockScore(bb.code) * 2 + (holder?.id === q.id ? 25 : 0);
      out.push({ input: { kind: 'playerAction', playerId: p.id, action: 'block', path: [], blockTarget: q.id }, label: `${who}: Block ${E.label(q)} (${bb.code})`, kind: 'block', playerId: p.id, prescore: pre, key: keyTarget(q) });
    }
  }
  // --- Blitz ---------------------------------------------------------------
  const blitzDone = continuing && act!.action === 'blitz' && act!.blocksDone > 0;
  if (on('blitz') && !blitzDone) {
    const mb = E.movementBudget(s, p.id);
    const total = mb ? mb.maLeft + mb.rushesLeft : 0;
    const reach = new Map(E.reachableSquares(s, p.id).map((r) => [`${r.c.x},${r.c.y}`, r]));
    const ourCarrier = holder && holder.team === b.team ? holder : undefined;
    const prio = (q: Player) => (holder?.id === q.id ? 100 : 0) + (ourCarrier && cheb(q.pos as Coord, ourCarrier.pos as Coord) === 1 ? 40 : 0) + (ourCarrier ? 10 - Math.min(10, cheb(q.pos as Coord, ourCarrier.pos as Coord)) : 0) + q.st;
    const declared = continuing ? act!.blitzTarget : undefined;
    const targets = opps.filter((q) => (!declared || q.id === declared) && cheb(q.pos as Coord, p.pos as Coord) - 1 <= total - 1).sort((x, y) => prio(y) - prio(x)).slice(0, 4);
    for (const q of targets) {
      let bestSq: { c: Coord; score: number; steps: number } | null = null;
      const squares = cheb(q.pos as Coord, p.pos) === 1 ? [p.pos] : [];
      for (const n of E.board.neighbours(q.pos as Coord)) {
        const r = reach.get(`${n.x},${n.y}`);
        if (r && r.steps <= total - 1) squares.push(n);
      }
      for (const c of squares) {
        const wp = b.work.players.find((x) => x.id === p.id) as Player;
        const saved = wp.pos;
        wp.pos = { ...c };
        const code = E.blockBreakdown(b.work, p.id, q.id).code;
        wp.pos = saved;
        const r = reach.get(`${c.x},${c.y}`);
        const steps = r ? r.steps : 0;
        const risk = r ? Math.pow(5 / 6, Math.max(0, steps + 1 - (mb?.maLeft ?? 0))) : 1;
        const score = blockScore(code) * risk - steps * 0.01;
        if (!bestSq || score > bestSq.score) bestSq = { c, score, steps };
      }
      if (!bestSq) continue;
      const route = bestSq.c === p.pos ? { path: [] as PathStep[], pSafe: 1 } : E.safestRoute(s, p.id, bestSq.c);
      if (!route || route.path.length > total - 1) continue;
      out.push({
        input: { kind: 'playerAction', playerId: p.id, action: 'blitz', path: route.path, blitzTarget: q.id, blockTarget: q.id },
        label: `${who}: Blitz ${E.label(q)}${route.path.length ? ` from ${E.board.fmt(bestSq.c)}` : ''}`,
        kind: 'blitz',
        playerId: p.id,
        prescore: 5 + bestSq.score * 2 + (holder?.id === q.id ? 30 : 0) - (1 - route.pSafe) * 10,
        key: keyTarget(q),
      });
    }
  }
  // --- Pass / Hand-off (ball carrier) --------------------------------------
  if (carrying && p.stance === 'standing') {
    const mates = b.s.players.filter((q) => q.team === b.team && q.id !== p.id && activeUp(q));
    if (on('pass') && p.pa !== null) {
      const rows: Candidate[] = [];
      for (const q of mates) {
        const rng = E.board.passRange(p.pos, q.pos as Coord);
        if (!rng || rng === 'bomb') continue;
        const base = rng === 'quick' ? 0.72 : rng === 'short' ? 0.58 : 0.42;
        const pr = base * E.d6SuccessProb(q.ag, -E.markersOf(s, q.pos as Coord, b.team).length);
        const v = inScoringZone(b.team, q.pos as Coord) ? b.V0 + b.w.td : valueWith(b, q.id, null, { holder: q.id });
        rows.push({ input: { kind: 'playerAction', playerId: p.id, action: 'pass', path: [], passTarget: { ...(q.pos as Coord) } }, label: `${who}: ${rng} pass to ${E.label(q)}`, kind: 'pass', playerId: p.id, prescore: pr * (v - b.V0) - (1 - pr) * 25 });
      }
      rows.sort((x, y) => y.prescore - x.prescore);
      out.push(...rows.slice(0, 3));
    }
    if (on('handoff')) {
      const mb = E.movementBudget(s, p.id);
      const total = mb ? mb.maLeft + mb.rushesLeft : 0;
      const reach = new Map(E.reachableSquares(s, p.id).map((r) => [`${r.c.x},${r.c.y}`, r]));
      const rows: Candidate[] = [];
      for (const q of mates) {
        if (cheb(q.pos as Coord, p.pos) - 1 > total) continue;
        let sq: Coord | null = cheb(q.pos as Coord, p.pos) === 1 ? p.pos : null;
        if (!sq) {
          let bestSteps = 99;
          for (const n of E.board.neighbours(q.pos as Coord)) {
            const r = reach.get(`${n.x},${n.y}`);
            if (r && r.steps < bestSteps) {
              bestSteps = r.steps;
              sq = n;
            }
          }
        }
        if (!sq) continue;
        const route = sq === p.pos ? { path: [] as PathStep[], pSafe: 1 } : E.safestRoute(s, p.id, sq);
        if (!route) continue;
        const pr = route.pSafe * E.d6SuccessProb(q.ag, -E.markersOf(s, q.pos as Coord, b.team).length + 1);
        const wp = b.work.players.find((x) => x.id === p.id) as Player;
        const saved = wp.pos;
        wp.pos = { ...sq };
        const v = inScoringZone(b.team, q.pos as Coord) ? b.V0 + b.w.td : valueWith(b, q.id, null, { holder: q.id });
        wp.pos = saved;
        rows.push({ input: { kind: 'playerAction', playerId: p.id, action: 'handoff', path: route.path, handoffTarget: q.id }, label: `${who}: hand the ball to ${E.label(q)}`, kind: 'handoff', playerId: p.id, prescore: pr * (v - b.V0) - (1 - pr) * 25 });
      }
      rows.sort((x, y) => y.prescore - x.prescore);
      out.push(...rows.slice(0, 2));
    }
  }
  // --- Secure the Ball -------------------------------------------------------
  if (on('secure') && s.ball.kind === 'ground') {
    const route = E.safestRoute(s, p.id, s.ball.pos);
    if (route) {
      const v = valueWith(b, p.id, s.ball.pos, 'pickup');
      const pr = route.pSafe * (5 / 6);
      out.push({ input: { kind: 'playerAction', playerId: p.id, action: 'secure', path: route.path }, label: `${who}: Secure the Ball in ${E.board.fmt(s.ball.pos)}`, kind: 'secure', playerId: p.id, prescore: pr * (v - b.V0) - (1 - pr) * failBase });
    }
  }
  // --- Projectile Vomit ----------------------------------------------------------
  const pv = opts.find((o) => o.action === 'special' && o.special === 'projectileVomit' && o.enabled);
  if (pv) {
    for (const q of opps) {
      if (cheb(q.pos as Coord, p.pos) !== 1) continue;
      out.push({ input: { kind: 'playerAction', playerId: p.id, action: 'special', special: 'projectileVomit', path: [], vomitTarget: q.id }, label: `${who}: Projectile Vomit on ${E.label(q)}`, kind: 'vomit', playerId: p.id, prescore: 3 + (holder?.id === q.id ? 20 : 0) });
    }
  }
  // --- Foul (V4, p.69): a Prone or Stunned opponent within reach, not with the ball carrier ------
  if (on('foul') && !carrying && p.stance === 'standing') {
    const downs = b.s.players.filter((q) => q.team === b.opp && q.location === 'pitch' && q.pos && q.stance !== 'standing');
    const reachF = downs.length ? E.reachableSquares(s, p.id) : [];
    const rowsF: Candidate[] = [];
    for (const q of downs) {
      let sq: Coord | null = cheb(q.pos as Coord, p.pos) === 1 ? p.pos : null;
      if (!sq) {
        let bestSteps = 99;
        for (const r of reachF) {
          if (cheb(r.c, q.pos as Coord) !== 1 || r.rushes > 0) continue;
          const steps = cheb(r.c, p.pos);
          if (steps < bestSteps) {
            bestSteps = steps;
            sq = r.c;
          }
        }
      }
      if (!sq) continue;
      const route = sq === p.pos ? { path: [] as PathStep[], pSafe: 1 } : E.safestRoute(s, p.id, sq);
      if (!route || route.pSafe < 0.99) continue;
      // Rough pre-screen (the exact dice come later): armour broken with the net assists, a KO or worse on 8+,
      // and a natural double on either roll gets the fouler Sent-off.
      const wp = b.work.players.find((x) => x.id === p.id) as Player;
      const saved = wp.pos;
      wp.pos = { ...sq };
      const as = E.foulAssists(b.work, wp, b.work.players.find((x) => x.id === q.id) as Player);
      wp.pos = saved;
      const net = as.off.length - as.def.length;
      let pBreak = 0;
      for (let d1 = 1; d1 <= 6; d1++) for (let d2 = 1; d2 <= 6; d2++) if (d1 + d2 + net >= q.av) pBreak += 1 / 36;
      const pRemoved = pBreak * (15 / 36);
      const pSent = 1 / 6 + Math.max(0, pBreak - 1 / 6) * (1 / 6);
      rowsF.push({ input: { kind: 'playerAction', playerId: p.id, action: 'foul', path: route.path, foulTarget: q.id }, label: `${who}: Foul ${E.label(q)}`, kind: 'foul', playerId: p.id, prescore: 6 * pRemoved - 8 * pSent });
    }
    rowsF.sort((x, y) => y.prescore - x.prescore);
    out.push(...rowsF.slice(0, 1));
  }
  // --- Throw Team-mate (only to score: a thrown ball carrier into the End Zone) ---
  if (on('ttm')) {
    for (const tp of E.throwablePlayers(s, p)) {
      if (holder?.id !== tp.id) continue;
      const targets: Coord[] = [];
      const mid = lastY() / 2;
      for (let y = 1; y < lastY(); y++) {
        const c = { x: goalX(b.team), y };
        if (E.ttmRange(p.pos, c) && !E.playerAt(s, c)) targets.push(c);
      }
      targets.sort((x, y) => Math.abs(x.y - mid) - Math.abs(y.y - mid));
      for (const c of targets.slice(0, 2)) {
        out.push({ input: { kind: 'playerAction', playerId: p.id, action: 'ttm', path: [], thrownPlayerId: tp.id, throwTarget: c }, label: `${who}: throw ${E.label(tp)} (with the ball) at ${E.board.fmt(c)}`, kind: 'ttm', playerId: p.id, prescore: 30 });
      }
    }
  }
  starCandidates(b, p, out, holder);
  return { cands: out, best: Math.max(0, best) };
}

/**
 * Star Player rules used at the start of an activation (V5 step 6). Each is offered as its own candidate, evaluated
 * exactly like any other action (the engine resolves the rule in the outcome tree), and charged the value of keeping
 * a once-per-game / half / Drive rule for later (STAR_RESERVE) — so it is only used when it clearly pays:
 *  - rules that end the activation (Thorsson's Beer Barrel Bash, Zzharg's Blastin' Solves Everything, Swiftvine's
 *    Furious Outburst, Boa's Look Into My Eyes) and Rodney's Catch of the Day: on their best targets;
 *  - rules that help the rest of the activation (Kiroth's Black Ink, Zolcath's Distraction, Jeremiah Kool's Stab
 *    before his Move, Gretchen's Incorporeal): the player's two best actions again, with the rule used first;
 *  - Action variants: Maple's Block from 2 squares, Nobbla's Chainsaw on a Prone player, Bilerot's Projectile Vomit.
 * Not used by the computer (their value lies outside a one-action look-ahead): Estelle's Hex, Hakflem's Treacherous,
 * Ivar's Raiding Party, Grombrindal's Wisdom, Grak's I'll Carry You, Cindy's second bomb.
 */
const STAR_RESERVE: Record<string, number> = { game: 1.5, half: 0.8, drive: 0.5, activation: 0, always: 0 };
const ENDING_RULES = ['thorsson', 'zzharg', 'swiftvine', 'boa', 'rodney'];
const HELPING_RULES = ['kiroth', 'zolcath', 'jeremiahKool', 'gretchen'];

function starCandidates(b: Board, p: Player, out: Candidate[], holder: Player | undefined): void {
  const s = b.s;
  const info = E.startRuleInfo(p);
  if (!info || !p.pos) return;
  const act = s.turn.activation;
  if (act && act.playerId === p.id) return;
  if (!E.starReady(s, p, info.star)) return;
  const reserve = STAR_RESERVE[E.STAR_BY_ID[info.star].rule.per] ?? 1;
  const who = E.label(p);
  const ourCarrier = holder && holder.team === b.team ? holder : undefined;
  // Targets worth the rule first: their ball carrier, opponents Marking our carrier, then the strongest.
  const prio = (q: Player) => (holder?.id === q.id ? 100 : 0) + (ourCarrier?.pos && q.pos && cheb(q.pos, ourCarrier.pos) === 1 ? 40 : 0) + q.st * 2 + (info.star === 'zzharg' ? 11 - q.av : 0);
  const star = (input: PlayerActionInput, label: string, kind: string, prescore: number) =>
    out.push({ input: { ...input, starRule: true }, label, kind, playerId: p.id, prescore, star: true, reserve });
  if (ENDING_RULES.includes(info.star)) {
    if (E.startRuleReason(s, p, 'move') !== null) return;
    if (info.star === 'rodney' || info.star === 'boa') {
      star({ kind: 'playerAction', playerId: p.id, action: 'move', path: [] }, `${who}: ${info.name}`, 'star', 20);
      return;
    }
    const targets = E.startRuleTargets(s, p).sort((x, y) => prio(y) - prio(x)).slice(0, 2);
    for (const q of targets) star({ kind: 'playerAction', playerId: p.id, action: 'move', path: [], starTarget: q.id }, `${who}: ${info.name} on ${E.label(q)}`, 'star', 5 + prio(q) / 10);
    return;
  }
  if (HELPING_RULES.includes(info.star)) {
    const mine = out.filter((c) => c.playerId === p.id && !c.star && c.input.kind === 'playerAction' && (!info.actions || info.actions.includes(c.input.action)));
    if (info.star === 'gretchen') {
      // Incorporeal only matters when she leaves Marked squares on the way.
      const dodges = (c: Candidate) => c.input.kind === 'playerAction' && c.input.path.length > 0 && E.markersOf(s, p.pos as Coord, b.team).length > 0;
      for (const c of mine.filter(dodges).sort((x, y) => y.prescore - x.prescore).slice(0, 2)) {
        if (E.startRuleReason(s, p, (c.input as PlayerActionInput).action) !== null) continue;
        star(c.input as PlayerActionInput, `${c.label} (Incorporeal first)`, c.kind, c.prescore + 1);
      }
      return;
    }
    const targets = E.startRuleTargets(s, p).sort((x, y) => prio(y) - prio(x));
    if (!targets.length) return;
    for (const c of mine.sort((x, y) => y.prescore - x.prescore).slice(0, 2)) {
      const inp = c.input as PlayerActionInput;
      if (E.startRuleReason(s, p, inp.action, inp.special) !== null) continue;
      const q = targets.find((t) => t.id !== inp.blockTarget) ?? targets[0];
      star({ ...inp, starTarget: q.id }, `${c.label} (${info.name} on ${E.label(q)} first)`, c.kind, c.prescore + 1);
    }
    return;
  }
  // Action variants.
  const targets = E.startRuleTargets(s, p);
  if (!targets.length) return;
  if (info.star === 'maple' && E.startRuleReason(s, p, 'block') === null) {
    for (const q of targets.sort((x, y) => prio(y) - prio(x)).slice(0, 2)) star({ kind: 'playerAction', playerId: p.id, action: 'block', path: [], blockTarget: q.id }, `${who}: Vicious Vines — Block ${E.label(q)} from 2 squares away`, 'block', 6 + prio(q) / 10);
  } else if (info.star === 'nobbla' && E.startRuleReason(s, p, 'special', 'chainsaw') === null) {
    for (const q of targets.slice(0, 2)) star({ kind: 'playerAction', playerId: p.id, action: 'special', special: 'chainsaw', path: [], specialTarget: q.id }, `${who}: Chainsaw Attack on ${E.label(q)} (Prone)`, 'star', 5);
  } else if (info.star === 'bilerot' && E.startRuleReason(s, p, 'special', 'projectileVomit') === null) {
    for (const q of targets.sort((x, y) => prio(y) - prio(x)).slice(0, 2)) star({ kind: 'playerAction', playerId: p.id, action: 'special', special: 'projectileVomit', path: [], specialTarget: q.id }, `${who}: Putrid Regurgitation on ${E.label(q)}`, 'vomit', 5 + prio(q) / 10);
  }
}

// ---------------------------------------------------------------------------
// Exact expected value over the enumerated outcomes
// ---------------------------------------------------------------------------

/**
 * Greedy look-ahead used for ball-carrier actions: team-mates who have not
 * acted yet walk (no Dodge, no Rush — no dice) next to our ball carrier, one
 * at a time, each to the square that helps most. Returns how much the
 * position value rises. This is how "move the carrier first, then form the
 * cage around him" is valued without searching every order of actions.
 */
function supportUplift(b: Board, st: GameState): { value: number; helpers: string[] } {
  const none = { value: 0, helpers: [] as string[] };
  const h = holderOf(st);
  if (!h || h.team !== b.team || !h.pos || st.phase !== 'play') return none;
  const work = E.cloneState(st);
  const c = h.pos;
  const base = evalTotal(work, b.team, b.w, b.hz);
  let cur = base;
  const act = work.turn.activation;
  const helpers = work.players.filter(
    (q) => q.team === b.team && q.id !== h.id && q.location === 'pitch' && q.pos && q.stance === 'standing' && !q.activated && !q.distracted && !(act && act.playerId === q.id) && cheb(q.pos, c) - 1 <= q.ma && E.markersOf(work, q.pos, b.team).length === 0,
  );
  const ids = helpers.map((q) => q.id);
  // Squares next to the carrier each helper can walk to within its Move Allowance.
  const reach = new Map<string, Coord[]>();
  for (const q of helpers) reach.set(q.id, E.reachableSquares(work, q.id).filter((r) => r.rushes === 0 && cheb(r.c, c) === 1).map((r) => r.c));
  for (let i = 0; i < 4 && helpers.length; i++) {
    const options: Array<{ q: Player; to: Coord; v: number }> = [];
    for (const q of helpers) {
      for (const to of reach.get(q.id) ?? []) {
        if (E.playerAt(work, to)) continue;
        const saved = q.pos as Coord;
        q.pos = { ...to };
        const v = evalTotal(work, b.team, b.w, b.hz);
        q.pos = saved;
        if (v > cur + 0.1) options.push({ q, to, v });
      }
    }
    options.sort((x, y) => y.v - x.v);
    let placed = false;
    for (const o of options.slice(0, 6)) {
      const route = E.safestRoute(work, o.q.id, o.to);
      if (!route || route.pSafe < 0.999) continue;
      o.q.pos = { ...o.to };
      cur = o.v;
      helpers.splice(helpers.indexOf(o.q), 1);
      placed = true;
      break;
    }
    if (!placed) break;
  }
  return { value: Math.max(0, cur - base), helpers: ids };
}

function explore(b: Board, cand: Candidate, restOfTurn: number, opts: typeof DEFAULTS): void {
  // Passes scatter and bounce into many cheap-to-miss branches: a coarser threshold keeps them fast.
  // Blocks branch into many Armour / Injury / bounce details: a slightly coarser cut keeps them quick.
  const limits =
    cand.kind === 'ttm'
      ? { threshold: 1e-5, maxLeaves: 6000 }
      : cand.kind === 'foul'
        ? { threshold: Math.max(opts.threshold, 3e-4), maxLeaves: Math.min(opts.maxLeaves, 400) }
      : cand.kind === 'pass'
        ? { threshold: 5e-3, maxLeaves: 200 }
        : cand.kind === 'block' || cand.kind === 'blitz' || cand.kind === 'carry' || cand.kind === 'handoff'
          ? { threshold: Math.max(opts.threshold, 3e-4), maxLeaves: Math.min(opts.maxLeaves, 700) }
          : { threshold: opts.threshold, maxLeaves: opts.maxLeaves };
  let sumV = 0;
  let sumVTO = 0;
  let pTO = 0;
  let pTD = 0;
  let pOppTD = 0;
  let pDone = 0;
  let pLost = 0;
  let pLostTO = 0;
  let pFreed = 0;
  let pHeld = 0;
  let explored = 0;
  const terms: Record<string, number> = {};
  const hadBall = holderOf(b.s)?.team === b.team;
  const theyHadBall = holderOf(b.s)?.team === b.opp;
  let main: { p: number; state: GameState } | null = null;
  // A Foul's target is already down: the position value counts it as a Prone player (half a Standing one), but a
  // Prone player is Standing again next Turn — taking him off the pitch (KO / Casualty) is worth more than that.
  // Only half of the difference is added: a Sent-off fouler is lost for the whole match, a Knocked-out target
  // often only for the Drive (self-play: with the full difference the computer fouled at about break-even).
  const foulTarget = cand.kind === 'foul' && cand.input.kind === 'playerAction' ? cand.input.foulTarget : undefined;
  let pFoulRemoved = 0;
  const r = E.exploreOutcomes(b.s, cand.input, { ...limits, followUp: true }, (leaf) => {
    if (foulTarget) {
      const t = leaf.state.players.find((q) => q.id === foulTarget);
      if (t && t.location !== 'pitch') pFoulRemoved += leaf.p;
    }
    const driveOver = !!leaf.touchdown;
    const ev = evaluate(leaf.state, b.team, b.w, b.hz, driveOver);
    const v = ev.total;
    sumV += leaf.p * v;
    explored += leaf.p;
    for (const k in ev.terms) terms[k] = (terms[k] ?? 0) + leaf.p * ev.terms[k];
    if (leaf.turnover) {
      pTO += leaf.p;
      sumVTO += leaf.p * v;
    }
    if (leaf.touchdown === b.team) pTD += leaf.p;
    else if (leaf.touchdown) pOppTD += leaf.p;
    if (leaf.completed) pDone += leaf.p;
    const bl = leaf.state.ball;
    const h = bl.kind === 'held' ? leaf.state.players.find((q) => q.id === bl.playerId) : undefined;
    if (hadBall && !leaf.touchdown && (!h || h.team !== b.team)) {
      pLost += leaf.p;
      if (leaf.turnover) pLostTO += leaf.p;
    }
    if (theyHadBall && (!h || h.team !== b.opp)) pFreed += leaf.p;
    if (!leaf.turnover && !driveOver && h && h.team === b.team) {
      pHeld += leaf.p;
      // The leaf state belongs to the enumerator: keep a copy of the most likely one.
      if (!main || leaf.p > main.p) main = { p: leaf.p, state: E.cloneState(leaf.state) };
    }
  });
  if (!r.ok) {
    cand.error = r.errors[0];
    return;
  }
  const un = Math.max(0, r.unresolved);
  if (explored <= 0) {
    cand.error = 'no outcome could be enumerated';
    return;
  }
  // Branches too unlikely to expand (mostly the fine detail of Armour and Injury rolls) are
  // valued like the enumerated outcomes of the same kind: after a Turnover, or not.
  const unTO = Math.min(un, Math.max(0, r.unresolvedTurnover));
  const unOK = un - unTO;
  const exOK = explored - pTO;
  const vTO = pTO > 0 ? sumVTO / pTO : sumV / explored;
  const vOK = exOK > 1e-12 ? (sumV - sumVTO) / exOK : sumV / explored;
  const pTurn = pTO + unTO;
  const charge = pTurn * restOfTurn * b.w.turnoverCost;
  cand.gainStatic = sumV + unTO * vTO + unOK * vOK - b.V0 - charge;
  if (foulTarget) {
    const t = b.s.players.find((q) => q.id === foulTarget);
    if (t) cand.gainStatic += (pFoulRemoved / explored) * 0.5 * (b.w.standing - (t.stance === 'stunned' ? b.w.stunned : b.w.prone)) * playerWorth(t);
  }
  // Non-Turnover figures scale up with the non-Turnover share of the cut mass.
  const k = exOK > 1e-12 ? (exOK + unOK) / exOK : 1;
  const m = main as { p: number; state: GameState } | null;
  // Actions that neither move the ball nor use a would-be helper leave that support as it was.
  const touchesSupport = ['carry', 'pickup', 'secure', 'handoff', 'pass', 'score'].includes(cand.kind) || (cand.playerId !== null && b.helpers.includes(cand.playerId));
  cand.support = !m ? 0 : touchesSupport ? supportUplift(b, m.state).value : b.U0;
  // Compared with the support the carrier could get where he stands now (b.U0).
  cand.gainSupported = cand.gainStatic + pHeld * k * cand.support - b.U0;
  cand.gain = cand.gainSupported;
  cand.pSuccess = pDone * k;
  cand.pTurnover = pTurn;
  cand.pTouchdown = pTD * k;
  cand.pOppTouchdown = pOppTD * k;
  cand.pBallLost = pLost - pLostTO + (pLost - pLostTO) * (k - 1) + (pTO > 0 ? (pLostTO * (pTO + unTO)) / pTO : 0);
  cand.pBallFreed = pFreed * k;
  cand.unresolved = un;
  if (explored > 0) {
    const keys = new Set([...Object.keys(b.terms), ...Object.keys(terms)]);
    cand.drivers = [...keys]
      .map((k) => [k, (terms[k] ?? 0) / explored - (b.terms[k] ?? 0)] as [string, number])
      .filter(([, d]) => Math.abs(d) >= 0.5)
      .sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))
      .slice(0, 3);
  }
}

const DRIVER_TEXT: Record<string, [string, string]> = {
  score: ['scores', 'concedes'],
  players: ['gets a player back on its feet', 'risks our player'],
  opponents: ['knocks an opponent down', 'lets an opponent back into play'],
  ball: ['gains the ball', 'risks the ball'],
  carrierSafety: ['makes the ball carrier safer', 'exposes the ball carrier'],
  progress: ['moves the ball forward', 'moves the ball back'],
  scoreThreat: ['sets up a score next Turn', 'reduces our scoring threat'],
  oppProgress: ['pushes their ball carrier back', 'lets their ball carrier advance'],
  oppThreat: ['reduces their scoring threat', 'increases their scoring threat'],
  pressure: ['puts pressure on their ball carrier', 'releases their ball carrier'],
  screen: ['screens our End Zone', 'opens a route to our End Zone'],
  looseBall: ['gets closer to the loose ball', 'lets them get closer to the loose ball'],
  marking: ['ties up opponents', 'leaves our players marked'],
  support: ['creates receiving options', 'removes receiving options'],
  rerolls: ['keeps Team Re-rolls', 'may use a Team Re-roll'],
  crowd: ['keeps a player away from a crowd push', 'leaves a player where he can be pushed into the crowd'],
};

function describe(cand: Candidate, obj: Objective): string {
  const parts: string[] = [];
  if (cand.pTouchdown && cand.pTouchdown > 0.01) parts.push(`${pct(cand.pTouchdown)} to score`);
  else if (cand.pSuccess !== undefined && cand.pSuccess < 0.999) parts.push(`${pct(cand.pSuccess)} to succeed`);
  if (cand.pTurnover && cand.pTurnover > 0.005) parts.push(`${pct(cand.pTurnover)} Turnover risk`);
  if (cand.pBallLost && cand.pBallLost > 0.01) parts.push(`${pct(cand.pBallLost)} to lose the ball`);
  if (cand.pBallFreed && cand.pBallFreed > 0.01) parts.push(`${pct(cand.pBallFreed)} to knock the ball loose`);
  const drivers = (cand.drivers ?? []).map(([k, d]) => (k === 'ball' && d > 0 && (cand.pBallFreed ?? 0) > 0 ? 'knocks the ball loose' : DRIVER_TEXT[k]?.[d > 0 ? 0 : 1])).filter(Boolean);
  const because = drivers.length ? ` — ${drivers.slice(0, 2).join(' and ')}` : '';
  const stall = cand.stallAvoided && cand.stallAvoided > 0.5 ? ' Waiting would let the Crowd Take Action for Stalling (p.80-81).' : '';
  return `${OBJECTIVE_LABEL[obj.id]}: ${obj.why}. Chose ${cand.label}${because}${parts.length ? ` (${parts.join(', ')}; estimates, see the plan)` : ''}.${stall}`;
}

/**
 * Think about the next action for `team` (must be that team's Turn, no pending
 * decision). A generator so an interface can spread the work over several
 * frames; `decideAction` runs it to the end.
 */
export function* think(s: GameState, team: TeamId, options: ThinkOptions): Generator<string, AIDecision, void> {
  E.usePitch(s);
  const t0 = Date.now();
  const opts = { ...DEFAULTS, ...options };
  const hz = horizonFor(s, team);
  const objective = chooseObjective(s, team, options.style);
  const w = emphasise(styleWeights(options.style), objective.id);
  const base = evaluate(s, team, w, hz);
  const b: Board = { s, team, opp: other(team), w, hz, V0: base.total, U0: 0, helpers: [], terms: base.terms, work: E.cloneState(s) };
  const u0 = supportUplift(b, s);
  b.U0 = u0.value;
  b.helpers = u0.helpers;
  const endTurn: ActionInput = { kind: 'endTurn' };
  const mine = s.players.filter((p) => p.team === team && p.location === 'pitch');
  const gens = new Map<string, PlayerGen>();
  for (const p of mine) {
    gens.set(p.id, genForPlayer(b, p));
  }
  yield 'candidates';
  const all: Candidate[] = [];
  for (const g of gens.values()) all.push(...g.cands);
  // Which candidates get the exact (dice-by-dice) evaluation: every scoring, ball-carrier, ball
  // and special action; Blocks and Blitzes on the key opponents; the best of the rest by pre-screen.
  const always = new Set(['score', 'carry', 'ttm', 'vomit', 'handoff', 'pickup', 'secure']);
  // Passes are costly to enumerate (scatter and bounce chains): the two most promising only.
  const caps: Record<string, number> = { block: 8, blitz: 6, pass: 2, foul: 2 };
  const used: Record<string, number> = {};
  const sorted = all.slice().sort((x, y) => y.prescore - x.prescore);
  const chosen: Candidate[] = [];
  let others = 0;
  const perTarget: Record<string, number> = {};
  for (const c of sorted) {
    const tgt = c.input.kind === 'playerAction' ? c.input.blockTarget ?? c.input.blitzTarget : undefined;
    if (c.key && tgt) {
      // At most the three best Blocks / Blitzes on each key opponent.
      const k = `${c.kind}:${tgt}`;
      if ((perTarget[k] ?? 0) < 3) {
        chosen.push(c);
        perTarget[k] = (perTarget[k] ?? 0) + 1;
      }
    } else if (always.has(c.kind) || c.key || c.star) chosen.push(c);
    else if (caps[c.kind] !== undefined) {
      // A pass whose pre-screen is clearly negative (long, contested, poor receiver) is not worth enumerating.
      if (c.kind === 'pass' && c.prescore < -5) continue;
      if ((used[c.kind] ?? 0) < caps[c.kind]) {
        chosen.push(c);
        used[c.kind] = (used[c.kind] ?? 0) + 1;
      }
    } else if (others < opts.maxExplored) {
      chosen.push(c);
      others++;
    }
  }
  for (const c of chosen) {
    explore(b, c, 0, opts);
    // A once-per-game (half, Drive) Star Player rule is worth keeping for later: using it must gain more than that.
    if (c.reserve && c.gain !== undefined && !c.error) {
      c.gain -= c.reserve;
      c.gainStatic = (c.gainStatic as number) - c.reserve;
      c.gainSupported = c.gain;
    }
    yield c.label;
  }
  // A Turnover also loses what the other players could still do safely this Turn: charge each
  // action's Turnover chance with the best no-risk gain of every other player (capped).
  // (V4 build 3 tried counting low-risk actions up to 15% here and taking them first; self-play
  // flagged fewer "avoidable risks" but scored fewer Touchdowns with more Turnovers, so it was not
  // kept — docs/AI_OPPONENT.md.)
  const safeValue = new Map<string, number>();
  for (const c of chosen) {
    if (c.error || c.gain === undefined || !c.playerId || (c.pTurnover ?? 1) > 0.02) continue;
    safeValue.set(c.playerId, Math.max(safeValue.get(c.playerId) ?? 0, c.gain));
  }
  for (const c of chosen) {
    if (c.error || c.gain === undefined) continue;
    let rest = 0;
    for (const [id, v] of safeValue) if (id !== c.playerId) rest += v;
    c.charge = (c.pTurnover ?? 0) * Math.min(40, rest) * w.turnoverCost;
    c.gain -= c.charge;
    c.gainStatic = (c.gainStatic as number) - c.charge;
    c.gainSupported = c.gain;
  }
  // Another player's action ends a player's unfinished activation (e.g. a ball carrier who Blitzed and
  // may still move): that action also gives up the best continuation.
  const act = s.turn.activation;
  if (act && !act.over && act.playerId) {
    const cont = Math.max(0, ...chosen.filter((c) => c.playerId === act.playerId && !c.error && c.gain !== undefined).map((c) => c.gain as number));
    if (cont > 0)
      for (const c of chosen) {
        if (c.error || c.gain === undefined || c.playerId === act.playerId) continue;
        c.forfeit = cont;
        c.gain -= cont;
        c.gainStatic = (c.gainStatic as number) - cont;
        c.gainSupported = c.gain;
      }
  }
  // Stalling (p.80-81): if our ball carrier could score without rolling any dice and the Turn (or
  // his activation) ends without a Touchdown, the Crowd Takes Action — D6 ≥ the Turn number knocks
  // him down. Ending the Turn and every non-scoring action face that risk alike; scoring avoids it.
  const stall = stallingRisk(s, team, base.terms);
  if (stall > 0)
    for (const c of chosen) {
      if (c.error || c.gain === undefined || !(c.pTouchdown && c.pTouchdown > 0)) continue;
      c.stallAvoided = stall * c.pTouchdown;
      c.gain += c.stallAvoided;
      c.gainStatic = (c.gainStatic as number) + c.stallAvoided;
      c.gainSupported = c.gain;
    }
  const ranked = chosen.filter((c) => c.gain !== undefined && !c.error).sort((x, y) => (y.gain as number) - (x.gain as number));
  let top: Candidate | undefined = ranked[0];
  let later: Candidate | null = null;
  if (top && (top.gain as number) > opts.minGain && (top.pTurnover ?? 0) >= 0.08) {
    // Safe actions first: a risky action can still be tried after them, but a Turnover would lose them.
    const safe = ranked.filter((c) => c.playerId !== top!.playerId && (c.pTurnover ?? 1) < 0.01 && (c.gain as number) > opts.minGain)[0];
    if (safe) {
      later = top;
      top = safe;
    }
  }
  if (!top || (top.gain as number) <= opts.minGain) {
    // Nothing gains once the support the carrier can still get is counted: take the move that
    // improves the position most as it stands (typically forming the cage), or end the Turn.
    // (Only moves that keep that support plan intact: supported gain about zero, not below.)
    top = ranked.filter((c) => (c.gainStatic ?? 0) > opts.minGain && (c.gain as number) > -opts.minGain).sort((x, y) => (y.gainStatic as number) - (x.gainStatic as number))[0];
  }
  let obj = objective;
  if (top && (top.pTouchdown ?? 0) >= 0.3 && obj.id !== 'score') obj = { id: 'score', urgent: true, why: `${pct(top.pTouchdown as number)} chance to score now` };
  const candidates = [...ranked, ...all.filter((c) => !ranked.includes(c))];
  if (!top) {
    return {
      input: endTurn,
      objective: obj,
      chosen: null,
      candidates,
      reason: `${OBJECTIVE_LABEL[obj.id]}: ${obj.why}. No remaining action improves the position enough — ending the Turn.`,
      value: base.total,
      terms: base.terms,
      support: b.U0,
      millis: Date.now() - t0,
    };
  }
  const reason = describe(top, obj) + (later ? ` Safe actions first: ${later.label} (${pct(later.pTurnover as number)} Turnover risk) can come after.` : '');
  return { input: top.input, objective: obj, chosen: top, candidates, reason, value: base.total, terms: base.terms, support: b.U0, millis: Date.now() - t0 };
}

/**
 * Sports-Wizard (p.149, V5 step 6): at the start of its own Turn — the end of the opponent's Turn, before its own
 * begins — the computer weighs Zap! on the opponents that matter (their ball carrier, those Marking our carrier,
 * the strongest) and Fireball on the squares that hit the most opponents and the fewest of its own players. Each
 * choice is evaluated exactly (the engine's outcome tree of the spell, like any action) and cast only if the best
 * gain beats the value of keeping the once-per-game spell (larger early in the match).
 */
export function wizardChoice(s: GameState, team: TeamId, style: AIStyle): { input: ActionInput; why: string; gain: number } | null {
  if (E.wizardReason(s, team) !== null) return null;
  if (s.phase !== 'play' || s.turn.active !== team) return null;
  E.usePitch(s);
  const hz = horizonFor(s, team);
  const objective = chooseObjective(s, team, style);
  const w = emphasise(styleWeights(style), objective.id);
  const base = evaluate(s, team, w, hz);
  const b: Board = { s, team, opp: other(team), w, hz, V0: base.total, U0: 0, helpers: [], terms: base.terms, work: E.cloneState(s) };
  const holder = holderOf(s);
  const ourCarrier = holder && holder.team === team ? holder : undefined;
  const opps = s.players.filter((q) => q.team === b.opp && q.location === 'pitch' && !!q.pos);
  const cands: Candidate[] = [];
  // Zap!: the opponents that matter most.
  const prio = (q: Player) => (holder?.id === q.id ? 100 : 0) + (ourCarrier?.pos && q.pos && cheb(q.pos, ourCarrier.pos) <= 1 ? 30 : 0) + (q.stance === 'standing' ? 5 : 0) + 20 * E.zapChance(q);
  for (const q of opps.slice().sort((x, y) => prio(y) - prio(x)).slice(0, 3)) {
    cands.push({ input: { kind: 'wizard', team, spell: 'zap', target: q.id }, label: `Sports-Wizard: Zap! ${E.label(q)}`, kind: 'wizard', playerId: null, prescore: prio(q) });
  }
  // Fireball: the squares whose 3 × 3 area hits the most (standing) opponents and the fewest of ours.
  const scored: Array<{ c: Coord; v: number }> = [];
  const W = E.pitch().w;
  const H = E.pitch().h;
  for (let x = 0; x < W; x++)
    for (let y = 0; y < H; y++) {
      const c = { x, y };
      let v = 0;
      for (const q of E.fireballTargets(s, c)) {
        const mine = q.team === team;
        const w0 = (q.stance === 'standing' ? 3 : 1) + (holder?.id === q.id ? 10 : 0);
        v += mine ? -1.5 * w0 : w0;
      }
      if (v > 0) scored.push({ c, v });
    }
  scored.sort((x, y) => y.v - x.v);
  for (const k of scored.slice(0, 3)) cands.push({ input: { kind: 'wizard', team, spell: 'fireball', square: k.c }, label: `Sports-Wizard: Fireball at ${E.board.fmt(k.c)}`, kind: 'wizard', playerId: null, prescore: k.v });
  for (const c of cands) explore(b, c, 0, { ...DEFAULTS, threshold: 3e-4, maxLeaves: 800 });
  const ok = cands.filter((c) => !c.error && c.gain !== undefined).sort((x, y) => (y.gain as number) - (x.gain as number));
  const best = ok[0];
  // Keeping the spell is worth more early in the match: 1 + 3 × the share of the match's Turns still to come.
  const tph = E.rulesFor(s).turnsPerHalf;
  const played = (s.match?.half === 2 ? tph : 0) + s.teams[team].turn;
  const reserve = 1 + 3 * Math.max(0, 1 - played / (2 * tph));
  if (!best || (best.gain as number) <= reserve) return null;
  return { input: best.input, gain: best.gain as number, why: `${best.label}: expected gain ${(best.gain as number).toFixed(1)} — more than keeping the once-per-game spell for later (${reserve.toFixed(1)}).` };
}

/**
 * Expected value lost to the Stalling rule (p.80-81) if the Turn ended now: our carrier could score
 * without rolling dice, has not been activated (or is being activated as a stalling candidate), and
 * a D6 ≥ the Turn number knocks him down (ball lost, Turnover). 0 when it cannot happen.
 */
export function stallingRisk(s: GameState, team: TeamId, terms: Record<string, number>): number {
  const b = s.ball;
  if (b.kind !== 'held') return 0;
  const h = E.findPlayer(s, b.playerId);
  if (!h || h.team !== team || h.location !== 'pitch' || h.stance !== 'standing') return 0;
  const act = s.turn.activation;
  const candidate = act && act.playerId === h.id && !act.over ? act.stallingCandidate : !h.activated && E.canScoreWithoutDice(s, h);
  if (!candidate) return 0;
  const turnNo = s.teams[team].turn;
  const pHit = Math.max(0, 7 - turnNo) / 6;
  if (pHit <= 0) return 0;
  // What the ball is worth to us here (held, progress, scoring threat), lost if he is knocked down.
  const worth = Math.max(0, (terms.ball ?? 0) + (terms.progress ?? 0) + (terms.scoreThreat ?? 0));
  return pHit * worth;
}

export function decideAction(s: GameState, team: TeamId, options: ThinkOptions): AIDecision {
  const g = think(s, team, options);
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
  }
}

// ---------------------------------------------------------------------------
// Decisions requested from the AI's coach (during its own or the opponent's actions)
// ---------------------------------------------------------------------------

function severity(label: string): number {
  const order = ['Badly Hurt', 'Seriously Hurt', 'Serious Injury', 'Lasting Injury', 'Dead'];
  const i = order.findIndex((o) => label.includes(o));
  return i < 0 ? 0 : i;
}

export function answerDecision(s: GameState, req: DecisionRequest, team: TeamId, style: AIStyle): { optionId: string; why: string } {
  E.usePitch(s);
  const ids = req.options.map((o) => o.id);
  const hz = horizonFor(s, team);
  const w = styleWeights(style);
  const valueIf = (mut: (x: GameState) => void) => {
    const x = E.cloneState(s);
    mut(x);
    return evalTotal(x, team, w, hz);
  };
  switch (req.type) {
    case 'kickOrReceive':
      return { optionId: ids.includes('receive') ? 'receive' : ids[0], why: 'Receive: start the Drive with the ball.' };
    case 'argueTheCall':
      return { optionId: ids.includes('yes') ? 'yes' : ids[0], why: 'Argue the Call: nothing to lose but a small chance.' };
    case 'bribe':
      return { optionId: ids.includes('yes') ? 'yes' : ids[0], why: 'Use the Bribe to keep the player.' };
    case 'touchback':
    case 'highKick': {
      let best = ids[0];
      let bestV = -Infinity;
      for (const o of req.options) {
        if (o.id === 'none') continue;
        const v = valueIf((x) => {
          if (req.type === 'touchback') {
            const pl = x.players.find((q) => q.id === o.id);
            if (pl) x.ball = { kind: 'held', playerId: pl.id };
            else if (o.square) x.ball = { kind: 'ground', pos: { ...o.square } };
          } else {
            const pl = x.players.find((q) => q.id === o.id);
            const L = x.match?.kick?.landing;
            if (pl && L) pl.pos = { ...L };
          }
        });
        if (v > bestV) {
          bestV = v;
          best = o.id;
        }
      }
      return { optionId: best, why: req.type === 'touchback' ? 'Give the ball to the safest player.' : 'Put a player under the ball.' };
    }
    case 'pushSquare':
    case 'sidestepSquare':
    case 'grabSquare': {
      const victim = req.context?.victim as string | undefined;
      let best = ids[0];
      let bestV = -Infinity;
      for (const o of req.options) {
        if (!o.square || !victim) continue;
        const v = valueIf((x) => {
          const pl = x.players.find((q) => q.id === victim);
          const occ = E.playerAt(x, o.square as Coord);
          if (pl) pl.pos = { ...(o.square as Coord) };
          if (occ) occ.pos = null;
        });
        if (v > bestV) {
          bestV = v;
          best = o.id;
        }
      }
      return { optionId: best, why: 'Push to the square that leaves the best position.' };
    }
    case 'followUp': {
      const sq = req.options.find((o) => o.id === 'yes')?.square;
      const act = s.turn.activation;
      const att = act ? E.findPlayer(s, act.playerId) : undefined;
      if (!sq || !att || att.team !== team) return { optionId: E.previewDecision(s, req), why: 'Default follow-up choice.' };
      const vYes = valueIf((x) => {
        const pl = x.players.find((q) => q.id === att.id);
        if (pl) pl.pos = { ...sq };
      });
      const vNo = evalTotal(s, team, w, hz);
      return { optionId: vYes >= vNo - 0.2 ? 'yes' : 'no', why: vYes >= vNo - 0.2 ? 'Follow up.' : 'Stay put: following up would weaken our position.' };
    }
    case 'trickster': {
      // Move to the square next to the blocker where the fewest other opponents can assist,
      // avoiding the sideline squares (crowd pushes); stay when nothing is better.
      const act = s.turn.activation;
      const me = s.players.find((q) => q.id === (req.context?.target as string | undefined));
      const attId = (req.context?.attacker as string | undefined) ?? act?.playerId;
      const risk = (c: Coord) => {
        const assists = s.players.filter((q) => q.team !== team && q.id !== attId && q.location === 'pitch' && q.stance === 'standing' && !q.distracted && q.pos && cheb(q.pos, c) === 1).length;
        const edge = c.y === 0 || c.y === lastY() ? 0.5 : 0;
        return assists + edge;
      };
      if (!me?.pos) return { optionId: 'stay', why: 'Stay put.' };
      let best = 'stay';
      let bestR = risk(me.pos);
      for (const o of req.options) {
        if (!o.square) continue;
        const r = risk(o.square) - (s.ball.kind === 'ground' && s.ball.pos.x === o.square.x && s.ball.pos.y === o.square.y ? 0.25 : 0);
        if (r < bestR - 1e-9) {
          bestR = r;
          best = o.id;
        }
      }
      return { optionId: best, why: best === 'stay' ? 'Trickster: no better square next to the blocker.' : 'Trickster: step away from the other opponents who could assist the Block.' };
    }
    case 'apothecary': {
      if (ids.includes('first') && ids.includes('second')) {
        const [a, c] = [req.options.find((o) => o.id === 'first')!, req.options.find((o) => o.id === 'second')!];
        return { optionId: severity(a.label) <= severity(c.label) ? 'first' : 'second', why: 'Choose the lighter injury.' };
      }
      const cas = /Casualty/.test(req.prompt) && !/Badly Hurt\)/.test(req.prompt);
      return { optionId: cas && ids.includes('use') ? 'use' : ids.includes('keep') ? 'keep' : ids[0], why: cas ? 'Use the Apothecary on a serious injury.' : 'Keep the Apothecary for a worse injury.' };
    }
    default:
      return { optionId: E.previewDecision(s, req), why: 'Same choice the previews assume.' };
  }
}

// ---------------------------------------------------------------------------
// Match steps that are not player actions
// ---------------------------------------------------------------------------

/** The input the AI gives in a match phase that needs it (set-up, kick-off, Kick-off Events), or null. */
export function matchStepFor(s: GameState, team: TeamId, _style: AIStyle): { input: ActionInput; why: string } | null {
  E.usePitch(s);
  const m = s.match;
  if (!m || s.pending) return null;
  if (s.phase === 'driveSetup') {
    const settingUp = m.kicking && m.setupDone[m.kicking] ? other(m.kicking) : m.kicking;
    if (settingUp !== team) return null;
    return { input: { kind: 'setupTeam', team, positions: E.defaultFormation(s, team) }, why: 'Standard set-up: three on the Line of Scrimmage, the rest in a compact block behind.' };
  }
  if (s.phase === 'kickoff' && !m.pendingPhase && m.kicking === team) {
    const cands = E.kickerCandidates(s, team);
    const kicker = cands.find((p) => E.hasSkill(p, 'kick')) ?? cands[0];
    if (!kicker) return null;
    const useKick = E.hasSkill(kicker, 'kick');
    const recv = other(team);
    const los = E.losColumn(recv);
    let best: Coord = { x: recv === 'A' ? Math.floor(los / 2) : Math.ceil((los + lastX()) / 2), y: Math.floor(lastY() / 2) };
    let bestScore = -1;
    // Deviation distance: D6, the lower of two D6 in Sevens (Spike! 22 p.10), D3 with Kick.
    const lower2 = !useKick && E.rulesFor(s).kickDistance === 'lowerOf2d6';
    const dmax = useKick ? 3 : 6;
    const pDist = (n: number) => (lower2 ? (13 - 2 * n) / 36 : 1 / dmax);
    for (let x = 0; x <= lastX(); x++)
      for (let y = 0; y <= lastY(); y++) {
        if (!E.inOwnHalf(recv, { x, y })) continue;
        // Chance the kick deviates and still comes down without a Touchback (D8 direction × distance).
        let p = 0;
        for (let d = 1; d <= 8; d++) {
          const dir = E.board.D8_DIRS[d];
          for (let n = 1; n <= dmax; n++) {
            const c = { x: x + dir.x * n, y: y + dir.y * n };
            if (E.kickLands(team, c)) p += pDist(n) / 8;
          }
        }
        const depth = Math.abs(x - los);
        const score = p + depth * 0.004;
        if (score > bestScore) {
          bestScore = score;
          best = { x, y };
        }
      }
    return { input: { kind: 'kickoff', kicker: kicker.id, target: best, useKick }, why: `Kick to ${E.board.fmt(best)}: the landing spot least likely to be a Touchback.` };
  }
  if (s.phase === 'kickoff' && m.pendingPhase?.type === 'swarming' && m.pendingPhase.team === team) {
    const positions = E.defaultSwarming(s, team);
    const n = Object.keys(positions).length;
    return { input: { kind: 'swarming', positions }, why: `Swarming: ${n} more Lineman player${n === 1 ? '' : 's'} set up behind the Line of Scrimmage.` };
  }
  if (s.phase === 'kickoff' && m.pendingPhase?.type === 'solidDefence' && m.pendingPhase.team === team) return { input: { kind: 'solidDefence', positions: {} }, why: 'Keep the set-up.' };
  if (s.phase === 'kickoff' && m.pendingPhase?.type === 'dwarfenWisdom' && m.pendingPhase.team === team) return { input: { kind: 'dwarfenWisdom', positions: {} }, why: 'Keep the set-up.' };
  if (s.phase === 'kickoff' && m.pendingPhase?.type === 'quickSnap' && m.pendingPhase.team === team) {
    const moves: Record<string, Coord> = {};
    const dx = team === 'A' ? 1 : -1;
    let n = 0;
    const taken = new Set(s.players.filter((p) => p.location === 'pitch' && p.pos).map((p) => `${p.pos!.x},${p.pos!.y}`));
    for (const p of s.players.filter((q) => q.team === team && q.location === 'pitch' && q.pos && E.isOpen(s, q))) {
      if (n >= m.pendingPhase.max) break;
      const to = { x: (p.pos as Coord).x + dx, y: (p.pos as Coord).y };
      if (!E.board.inBounds(to) || taken.has(`${to.x},${to.y}`)) continue;
      taken.delete(`${p.pos!.x},${p.pos!.y}`);
      taken.add(`${to.x},${to.y}`);
      moves[p.id] = to;
      n++;
    }
    return { input: { kind: 'quickSnap', moves }, why: `${m.pendingPhase.alert ? 'Alert Defence' : 'Quick Snap'}: ${n} player${n === 1 ? '' : 's'} step forward.` };
  }
  return null;
}
