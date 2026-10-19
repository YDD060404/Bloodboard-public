/**
 * Position evaluation for the computer opponent.
 *
 * value(state) is measured in "points" where a Touchdown is worth 100. It is
 * a sum of named terms so every decision can be audited ("why did it prefer
 * that?"): the AI reports which terms changed most. It only reads what both
 * coaches can see on the board (positions, stances, ball, score, Turn
 * markers) — never the dice generator.
 */
import type { Coord, GameState, Player, TeamId } from '../engine/index';
import { E } from './engine';
import type { AIStyle, ObjectiveId } from './types';

export interface Weights {
  td: number;
  hold: number;
  progress: number;
  scoreThreat: number;
  /** Chance each opponent next to our ball carrier knocks the ball loose before our next Turn. */
  carrierMarked: number;
  /** Chance a Blitz that can reach our ball carrier knocks the ball loose (scaled by how exposed he is). */
  carrierExposed: number;
  cage: number;
  receivers: number;
  oppProgress: number;
  oppScoreThreat: number;
  pressure: number;
  pressureReach: number;
  /** Per square our players stand beyond 3 squares from their ball carrier (small, negative). */
  contain: number;
  /** Per square our players (not the carrier) have advanced, up to 3 squares past our carrier. */
  shape: number;
  screen: number;
  looseBall: number;
  /** Per square our nearest player is from a loose ball. */
  ballChase: number;
  standing: number;
  prone: number;
  stunned: number;
  marking: number;
  marked: number;
  /** Value of one unused Team Re-roll with the whole half ahead (scaled by the Turns left). */
  reroll: number;
  /** Multiplier on the value of the rest of the Turn that a Turnover would lose. */
  turnoverCost: number;
  /**
   * V4: our Standing players whose own square lets an opponent push them into the crowd next
   * Turn (sideline / end line / corner), weighted by how likely that Block is and what the player
   * is worth. Only a preference: tactical terms (ball, screen, pressure…) can outweigh it.
   */
  crowd: number;
}

/** Balanced weights. Offensive / Defensive scale groups of them (styleWeights). */
export const BASE_WEIGHTS: Weights = {
  td: 100,
  hold: 28,
  progress: 1.4,
  scoreThreat: 30,
  carrierMarked: 0.4,
  carrierExposed: 0.5,
  cage: 1.5,
  receivers: 1.2,
  oppProgress: 1.4,
  oppScoreThreat: 30,
  pressure: 5,
  pressureReach: 1,
  contain: 0.3,
  shape: 0.1,
  screen: 1.3,
  looseBall: 14,
  ballChase: 1.2,
  standing: 6,
  prone: 3,
  stunned: 2,
  marking: 0.35,
  marked: 0.35,
  reroll: 5,
  turnoverCost: 1,
  crowd: 1,
};

/**
 * V5.5: the parameters of the AI file that is thinking (registry.ts) — its weights, objective thresholds and search
 * budget. The driver sets them around each step of that coach's thinking and clears them afterwards, so another coach
 * (or the advisor) never sees them. Without an AI file the built-in defaults (the former "balanced" preset) apply.
 */
export interface CoachParams {
  weights?: (w: Weights) => Weights;
  objectives?: { protectThreats?: number; protectCageBelow?: number };
  search?: { threshold?: number; maxLeaves?: number; maxExplored?: number; minGain?: number };
}
let activeCoach: CoachParams | null = null;
export function setCoachParams(p: CoachParams | null): void {
  activeCoach = p;
}
export function coachParams(): CoachParams | null {
  return activeCoach;
}

/** The weights of the thinking coach: the built-in preset `style` (default "balanced"), then the AI file's parameters. */
export function styleWeights(style: AIStyle): Weights {
  const w = styleWeightsBase(style);
  return activeCoach?.weights ? activeCoach.weights(w) : w;
}

function styleWeightsBase(style: AIStyle): Weights {
  const w = { ...BASE_WEIGHTS };
  if (style === 'offensive') {
    w.progress *= 1.35;
    w.receivers *= 1.8;
    w.pressure *= 1.2;
    w.pressureReach *= 1.3;
    w.marking *= 1.5;
    w.screen *= 0.7;
    w.cage *= 0.8;
    w.turnoverCost *= 0.85;
  } else if (style === 'defensive') {
    w.carrierMarked *= 1.25;
    w.carrierExposed *= 1.4;
    w.cage *= 1.6;
    w.screen *= 1.6;
    w.pressure *= 1.3;
    w.oppProgress *= 1.25;
    w.progress *= 0.8;
    w.receivers *= 0.6;
    w.marked *= 1.5;
    w.turnoverCost *= 1.25;
    w.crowd *= 1.25;
  }
  return w;
}

/** The current objective shifts emphasis (moderately) towards the terms it is about. */
export function emphasise(w: Weights, obj: ObjectiveId): Weights {
  const x = { ...w };
  switch (obj) {
    case 'stopScore':
      x.oppScoreThreat *= 1.4;
      x.pressure *= 1.5;
      x.screen *= 1.4;
      break;
    case 'protectCarrier':
      x.carrierMarked *= 1.4;
      x.carrierExposed *= 1.4;
      x.cage *= 1.4;
      break;
    case 'recoverBall':
    case 'contestBall':
      x.looseBall *= 1.4;
      break;
    case 'advance':
      x.progress *= 1.15;
      x.receivers *= 1.2;
      break;
    case 'pressureCarrier':
      x.pressure *= 1.3;
      x.pressureReach *= 1.3;
      break;
    default:
      break;
  }
  return x;
}

/**
 * V5.5: the match clock and the score. In the last Turns of the second half, a team that is behind values scoring
 * chances and progress more and fears a Turnover less (there is little to lose); a team that is ahead values keeping
 * the ball safe and stopping the opponent's scoring more. Level scores and the rest of the match: unchanged.
 */
export function clockAdjusted(w: Weights, s: GameState, team: TeamId): Weights {
  const m = s.match;
  if (!m || m.half !== 2) return w;
  const left = E.rulesFor(s).turnsPerHalf - s.teams[team].turn;
  if (left > 2) return w;
  const diff = s.teams[team].score - s.teams[team === 'A' ? 'B' : 'A'].score;
  if (!diff) return w;
  const x = { ...w };
  if (diff < 0) {
    x.turnoverCost *= 0.7;
    x.scoreThreat *= 1.3;
    x.progress *= 1.2;
    x.receivers *= 1.3;
  } else {
    x.turnoverCost *= 1.25;
    x.carrierExposed *= 1.3;
    x.carrierMarked *= 1.2;
    x.oppScoreThreat *= 1.25;
    x.screen *= 1.2;
  }
  return x;
}

export const other = (t: TeamId): TeamId => (t === 'A' ? 'B' : 'A');
/** Pitch in use (standard 26 × 15, Sevens 20 × 11): last column index, last row index. */
export const lastX = () => E.pitch().w - 1;
export const lastY = () => E.pitch().h - 1;
export const goalX = (t: TeamId) => (t === 'A' ? lastX() : 0);
export const dGoal = (t: TeamId, c: Coord) => Math.abs(goalX(t) - c.x);
export const cheb = (a: Coord, b: Coord) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

export interface Horizon {
  /** The evaluating team gets another Turn in this half after the current one. */
  ourNext: boolean;
  /** The opponent gets another Turn in this half. */
  oppNext: boolean;
}

export function horizonFor(s: GameState, team: TeamId): Horizon {
  const tph = E.rulesFor(s).turnsPerHalf;
  return { ourNext: s.teams[team].turn < tph, oppNext: s.teams[other(team)].turn < tph };
}

/** Relative worth of a player (Strength and a few key skills). */
export function playerWorth(p: Player): number {
  let v = 1 + 0.18 * Math.max(0, p.st - 3);
  for (const k of p.skills) if (['block', 'dodge', 'guard', 'mightyBlow', 'tackle', 'sureHands', 'catch', 'pass', 'leader'].includes(k.id)) v += 0.06;
  return v;
}

const up = (p: Player) => p.location === 'pitch' && p.stance === 'standing';
const active = (p: Player) => up(p) && !p.distracted;

/** Chance of covering `need` squares with `ma` normal squares and up to 2 Rushes (2+ each). */
function reachChance(need: number, ma: number): number {
  if (need <= ma) return 1;
  if (need === ma + 1) return 5 / 6;
  if (need === ma + 2) return 25 / 36;
  return 0;
}

export interface Evaluation {
  total: number;
  terms: Record<string, number>;
}

/**
 * Value of `s` for `team` as the position stands (as if the Turn ended now).
 * `driveOver`: the Drive has ended (a Touchdown) — only the score and the
 * players' condition still matter.
 */
export function evaluate(s: GameState, team: TeamId, w: Weights, hz: Horizon, driveOver = false): Evaluation {
  const opp = other(team);
  const t: Record<string, number> = {};
  const add = (k: string, v: number) => {
    if (v) t[k] = (t[k] ?? 0) + v;
  };
  add('score', w.td * (s.teams[team].score - s.teams[opp].score));
  // Team Re-rolls still to use this half (they are replenished at half-time, p.33).
  const tph = E.rulesFor(s).turnsPerHalf;
  add('rerolls', s.teams[team].rerolls * w.reroll * (0.1 + (0.9 * Math.max(0, tph - s.teams[team].turn)) / (tph - 1)));

  let ours = 0;
  let theirs = 0;
  for (const p of s.players) {
    if (p.location !== 'pitch') continue;
    const v = playerWorth(p) * (p.stance === 'standing' ? w.standing : p.stance === 'prone' ? w.prone : w.stunned);
    if (p.team === team) ours += v;
    else theirs -= v;
  }
  add('players', ours);
  add('opponents', theirs);
  if (driveOver) return { total: sum(t), terms: t };

  const g = grid(s);
  const tzOf = (tm: TeamId) => (tm === 'A' ? g.tzA : g.tzB);
  /** Number of `tm`'s opponents whose Tackle Zones cover `c` (= markersOf(s, c, tm).length). */
  const marks = (c: Coord, tm: TeamId) => tzOf(other(tm))[c.x * 15 + c.y];
  const pitch = g.pitch;

  // Marking (small): players tied up next to opponents.
  let mk = 0;
  for (const p of pitch) {
    if (!active(p)) continue;
    const n = Math.min(3, marks(p.pos as Coord, p.team));
    if (!n) continue;
    mk += p.team === team ? -w.marked * n : w.marking * n;
  }
  add('marking', mk);

  // Crowd exposure (V4, localized): an opponent next to one of our players on a square from which
  // a Block pushes him into the crowd — or able to Blitz onto such a square — risks losing that
  // player for the Drive plus an Injury Roll without armour (p.63, p.68). The squares come from
  // the engine's own push rule (crowdPushSquares: Stand Firm and Sidestep considered).
  if (hz.oppNext && w.crowd) {
    let cr = 0;
    for (const p of pitch) {
      if (p.team !== team || !up(p)) continue;
      const c = p.pos as Coord;
      if (c.x !== 0 && c.x !== lastX() && c.y !== 0 && c.y !== lastY()) continue;
      const sq = E.crowdPushSquares(s, p);
      if (!sq.length) continue;
      let pThreat = 0;
      for (const a of sq) {
        const q = g.occ[a.x * 15 + a.y];
        if (q && q.team === opp && active(q)) pThreat = Math.max(pThreat, 0.6);
        else if (!q) {
          for (const r of pitch) if (r.team === opp && active(r) && cheb(r.pos as Coord, a) <= r.ma + 1) pThreat = Math.max(pThreat, 0.25);
        }
      }
      // A push result (Push Back, Stumble, POW) on a typical block is about 2/3; the player (and
      // his Injury Roll) is what the crowd takes.
      if (pThreat) cr -= pThreat * (2 / 3) * (w.standing * playerWorth(p) + 2);
    }
    add('crowd', w.crowd * cr);
  }

  const ball = s.ball;
  const holder = ball.kind === 'held' ? pitch.find((p) => p.id === ball.playerId) : undefined;
  if (holder && holder.pos) {
    const c = holder.pos;
    if (holder.team === team) {
      const markers = marks(c, team);
      let cage = 0;
      let recv = 0;
      const dg = dGoal(team, c);
      let follow = 0;
      for (const q of pitch) {
        if (q.team !== team || q.id === holder.id) continue;
        const d = cheb(q.pos as Coord, c);
        // Team shape: team-mates moving up with the ball (up to a few squares past it) can protect
        // the carrier and receive later; players left far behind cannot.
        if (active(q)) follow += Math.min(lastX() - dGoal(team, q.pos as Coord), lastX() - dg + 3);
        // Corners (diagonal) protect more than the squares beside him (V5.5: no bonus for a cross shape as such).
        if (d === 1 && up(q)) cage += (q.pos as Coord).x !== c.x && (q.pos as Coord).y !== c.y ? 1 : 0.5;
        if (active(q) && dGoal(team, q.pos as Coord) < dg && d <= 6 && marks(q.pos as Coord, team) === 0) recv++;
      }
      const exp = hz.oppNext ? exposureG(g, team, holder) : { p: 0, n: 0 };
      const expEff = Math.min(1, exp.p * (1 + 0.05 * Math.min(exp.n, 4)));
      // A carrier on the sideline can be pushed into the crowd (the ball is thrown back in by the fans).
      const edge = c.y === 0 || c.y === lastY() || c.x === 0 || c.x === lastX() ? 1.25 : 1;
      // Chance the carrier still has the ball when our next Turn starts: one Blitz can reach
      // him (exposure), and every opponent already next to him may Block him.
      const pKeep = hz.oppNext ? Math.max(0.05, (1 - Math.min(0.9, w.carrierExposed * expEff * edge)) * Math.pow(1 - Math.min(0.9, w.carrierMarked * edge), markers)) : 1;
      let threat = 0;
      if (hz.ourNext && dg <= holder.ma + 2) threat = w.scoreThreat * reachChance(dg, holder.ma) * (markers ? 0.5 : 1);
      const supp = hz.ourNext ? w.receivers * Math.min(recv, 3) : 0;
      // Time: the Turns left in this half against the Turns a supported carrier needs (about MA−2
      // squares a Turn, then one run into the End Zone). Behind that schedule, progress is worth less
      // — and each square gained towards it worth more.
      const turnsLeft = Math.max(0, tph - s.teams[team].turn);
      const pace = Math.max(3, holder.ma - 2);
      const need = dg <= holder.ma + 2 ? 1 : 1 + Math.ceil((dg - holder.ma - 2) / pace);
      const timeF = hz.ourNext ? Math.pow(0.6, Math.max(0, need - turnsLeft)) : 1;
      // Holding the ball is never worth as much as scoring with it.
      const prog = Math.min(w.progress * (lastX() - dg) * (hz.ourNext ? timeF : 0.25), Math.max(0, 0.85 * w.td - w.hold - threat - supp));
      add('ball', w.hold);
      add('progress', prog);
      add('scoreThreat', threat);
      add('support', supp);
      add('support', w.shape * follow);
      // What the ball is worth to us, times the chance of losing it before our next Turn.
      // A cage costs most of a Sevens team: the shape bonus is smaller there (the exposure above still counts in full).
      add('carrierSafety', -(1 - pKeep) * (w.hold + prog + threat + supp) + w.cage * (E.isSevens(s) ? 0.7 : 1) * Math.min(cage, 4));
    } else {
      const markersUs = marks(c, opp);
      const dg = dGoal(opp, c);
      add('ball', -w.hold);
      add('oppProgress', -w.oppProgress * (lastX() - dg) * (hz.oppNext ? 1 : 0.25));
      if (hz.oppNext && dg <= holder.ma + 2) add('oppThreat', -w.oppScoreThreat * reachChance(dg, holder.ma) * Math.pow(0.5, markersUs));
      let theirRecv = false;
      let reachers = 0;
      let screens = 0;
      const ourX = goalX(opp);
      const lo = Math.min(c.x, ourX);
      const hi = Math.max(c.x, ourX);
      let contain = 0;
      for (const q of pitch) {
        if (!active(q)) continue;
        const qc = q.pos as Coord;
        if (q.team === team) contain += Math.max(-8, Math.min(0, 3 - cheb(qc, c)));
        if (q.team === opp) {
          // A team-mate of theirs who could score after a hand-off or short pass.
          if (q.id !== holder.id && cheb(qc, c) <= 4 && dGoal(opp, qc) <= q.ma + 1 && marks(qc, opp) === 0) theirRecv = true;
        } else {
          if (cheb(qc, c) - 1 <= q.ma + 2) reachers++;
          if (qc.x > lo && qc.x < hi && Math.abs(qc.y - c.y) <= 3) screens++;
        }
      }
      if (hz.oppNext && theirRecv) add('oppThreat', -w.oppScoreThreat * 0.25 * Math.pow(0.6, markersUs));
      add('pressure', w.pressure * Math.min(markersUs, 3));
      if (hz.ourNext) add('pressure', w.pressureReach * Math.min(3, reachers));
      if (hz.oppNext) add('screen', w.screen * Math.min(screens, 5));
      // Converging on their carrier (small): our players far from the ball do little on defence.
      add('pressure', w.contain * contain);
    }
  } else if (ball.kind === 'ground') {
    const b = ball.pos;
    let dUs = 99;
    let dThem = 99;
    for (const q of pitch) {
      if (!active(q)) continue;
      const d = cheb(q.pos as Coord, b);
      if (q.team === team) dUs = Math.min(dUs, d);
      else dThem = Math.min(dThem, d);
    }
    add('looseBall', w.looseBall * Math.max(-1, Math.min(1, (dThem - dUs) / 3)));
    // Getting there: our nearest player's distance, and players arriving around the ball.
    let near = 0;
    for (const q of pitch) if (active(q) && cheb(q.pos as Coord, b) <= 2) near += q.team === team ? 1 : -1;
    add('looseBall', -w.ballChase * Math.min(dUs, 12) + w.ballChase * 0.5 * Math.max(-3, Math.min(3, near)));
    // A loose ball next to our End Zone is dangerous; next to theirs is promising.
    add('looseBall', 0.4 * ((lastX() - dGoal(team, b)) - (lastX() - dGoal(opp, b))) * 0.3);
  }
  return { total: sum(t), terms: t };
}

function sum(t: Record<string, number>): number {
  let x = 0;
  for (const k in t) x += t[k];
  return x;
}

interface Grid {
  pitch: Player[];
  occ: Array<Player | undefined>;
  /** Tackle Zones of team A / team B covering each square (index x*15+y). */
  tzA: Int8Array;
  tzB: Int8Array;
}

function grid(s: GameState): Grid {
  const occ: Array<Player | undefined> = new Array(26 * 15);
  const tzA = new Int8Array(26 * 15);
  const tzB = new Int8Array(26 * 15);
  const pitch: Player[] = [];
  for (const p of s.players) {
    if (p.location !== 'pitch' || !p.pos) continue;
    pitch.push(p);
    occ[p.pos.x * 15 + p.pos.y] = p;
    if (!E.hasTackleZone(p)) continue;
    const tz = p.team === 'A' ? tzA : tzB;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const x = p.pos.x + dx;
        const y = p.pos.y + dy;
        if (x >= 0 && x <= lastX() && y >= 0 && y <= lastY()) tz[x * 15 + y]++;
      }
  }
  return { pitch, occ, tzA, tzB };
}

/**
 * How exposed `team`'s ball carrier is to a Blitz next Turn (V5.5: by the real access to each free square next to
 * him, not by the shape of the cage). For each such square:
 *  - access: an opponent who can stand next to it outside our Tackle Zones walks in without a Dodge; otherwise he
 *    has to Dodge into it (−1 per Tackle Zone on it, the carrier's own included; Dodge re-roll counted) — this is why
 *    a diagonal "X" cage (whose gaps can only be reached from squares the corners Mark) protects better than a
 *    cross-shaped one (whose diagonal gaps can be walked into);
 *  - the Block: each of our Standing, unmarked players next to that square (not the carrier) gives the carrier an
 *    assist against it, so fewer dice for the Blitzer.
 * `p`: the best such chance of one opponent reaching a gap and making the Block count; `n`: how many could.
 */
function exposureG(g: Grid, team: TeamId, holder: Player): { p: number; n: number } {
  const opp = other(team);
  const c = holder.pos as Coord;
  const ourTz = team === 'A' ? g.tzA : g.tzB;
  const theirTz = team === 'A' ? g.tzB : g.tzA;
  let best = 0;
  const who = new Set<string>();
  const inb = (x: number, y: number) => x >= 0 && x <= lastX() && y >= 0 && y <= lastY();
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const n = { x: c.x + dx, y: c.y + dy };
      if (!inb(n.x, n.y)) continue;
      if (g.occ[n.x * 15 + n.y]) continue;
      // Squares next to the gap an opponent could stand on without being Marked by us (walk-in access).
      let walkIn = false;
      let assists = 0;
      for (let ex = -1; ex <= 1; ex++)
        for (let ey = -1; ey <= 1; ey++) {
          if (!ex && !ey) continue;
          const mx = n.x + ex;
          const my = n.y + ey;
          if (!inb(mx, my) || (mx === c.x && my === c.y)) continue;
          const o = g.occ[mx * 15 + my];
          if (!o && ourTz[mx * 15 + my] === 0) walkIn = true;
          if (o && o.team === team && up(o) && !o.distracted && E.hasTackleZone(o) && theirTz[mx * 15 + my] === 0) assists++;
        }
      const tzN = ourTz[n.x * 15 + n.y];
      const blockF = assists === 0 ? 1 : assists === 1 ? 0.65 : 0.4;
      for (const q of g.pitch) {
        if (q.team !== opp || q.stance === 'stunned' || cheb(q.pos as Coord, c) <= 1) continue;
        const qc = q.pos as Coord;
        const reach = reachChance(cheb(qc, n), q.ma - (q.stance === 'prone' ? 3 : 0));
        if (reach <= 0) continue;
        // Next to the gap already and unmarked, or able to walk in: no Dodge. Otherwise one Dodge into the gap.
        const free = walkIn || (cheb(qc, n) === 1 && ourTz[qc.x * 15 + qc.y] === 0);
        let pIn = 1;
        if (!free) {
          const one = E.d6SuccessProb(q.ag, -tzN);
          pIn = E.hasSkill(q, 'dodge') ? one + (1 - one) * one : one;
        }
        const pr = reach * pIn * blockF;
        if (pr > 0.01) {
          who.add(q.id);
          if (pr > best) best = pr;
        }
      }
    }
  return { p: best, n: who.size };
}

export function evalTotal(s: GameState, team: TeamId, w: Weights, hz: Horizon, driveOver = false): number {
  return evaluate(s, team, w, hz, driveOver).total;
}

/**
 * How exposed `team`'s ball carrier is to a Blitz next Turn: `p` is the best
 * chance (roughly) that one opponent reaches a free square next to the
 * carrier — a square in our Tackle Zones needs a Dodge, so it counts less —
 * and `n` the number of opponents who could.
 */
export function exposure(s: GameState, team: TeamId, holder: Player): { p: number; n: number } {
  return exposureG(grid(s), team, holder);
}
