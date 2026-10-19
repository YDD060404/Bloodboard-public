import { molesUnder } from './prayers';
/**
 * Movement helpers for the board (no dice, no state changes):
 *
 *   movementBudget  — squares of Move Allowance and Rushes a player has left
 *   reachableSquares — every square reachable by plain steps, marked normal
 *                      (within MA) or Rush (needs 1-2 Rushes)
 *   safestRoute     — a legal step-by-step route to a square that avoids risk:
 *                      highest chance of making every Dodge and Rush first
 *                      (skill re-rolls such as Dodge / Sure Feet counted, Team
 *                      Re-rolls not), then fewest squares, then fewest turns.
 *
 * The route is only a suggestion for the plan: the exact probabilities shown
 * before confirming always come from planAction.
 */
import { usePitch } from './variant';
import { neighbours } from './board';
import { d6SuccessProb } from './dice';
import { jumpMods, jumpedSquare, maxRushes } from './move';
import { inBounds } from './board';
import { canUse, getPlayer, hasSkill, markersOf, playerAt } from './state';
import type { Coord, GameState, PathStep, Player } from './types';

export interface MovementBudget {
  from: Coord;
  /** Normal squares of movement left (after standing up, if needed). */
  maLeft: number;
  rushesLeft: number;
  standUp: 'none' | 'free' | 'costs3' | 'roll4';
}

export function movementBudget(s: GameState, playerId: string, pathSoFar: PathStep[] = []): MovementBudget | null {
  usePitch(s);
  const p = getPlayer(s, playerId);
  if (!p.pos || p.location !== 'pitch' || p.stance === 'stunned') return null;
  const act = s.turn.activation && s.turn.activation.playerId === p.id ? s.turn.activation : null;
  let maLeft = act ? Math.max(0, p.ma - act.maUsed) : p.ma;
  let rushesLeft = act ? Math.max(0, maxRushes(p) - act.rushesUsed) : maxRushes(p);
  let standUp: MovementBudget['standUp'] = 'none';
  if (!act && p.stance === 'prone') {
    if (canUse(p, 'jumpUp')) standUp = 'free';
    else if (p.ma <= 2) {
      standUp = 'roll4';
      maLeft = 0;
    } else {
      standUp = 'costs3';
      maLeft = p.ma - 3;
    }
  }
  let from = p.pos;
  for (const st of pathSoFar) {
    const cost = st.kind === 'step' ? 1 : 2;
    const fromMa = Math.min(cost, maLeft);
    maLeft -= fromMa;
    rushesLeft -= cost - fromMa;
    from = st.to;
  }
  if (rushesLeft < 0) return null;
  return { from, maLeft, rushesLeft, standUp };
}

export interface ReachSquare {
  c: Coord;
  steps: number;
  /** Rushes needed to get there (0 = within Move Allowance). */
  rushes: number;
}

/** V5.5: `revisit` lets a route come back through squares it has already visited, the start square included (p.54 does not forbid it). */
export interface RouteOptions {
  revisit?: boolean;
}

/** Squares reachable with plain steps through empty squares (jumps are not considered). */
export function reachableSquares(s: GameState, playerId: string, pathSoFar: PathStep[] = [], opts: RouteOptions = {}): ReachSquare[] {
  usePitch(s);
  const b = movementBudget(s, playerId, pathSoFar);
  if (!b) return [];
  const p = getPlayer(s, playerId);
  const total = b.maLeft + b.rushesLeft;
  const blocked = new Set(opts.revisit ? [] : pathSoFar.map((st) => `${st.to.x},${st.to.y}`));
  if (p.pos && !opts.revisit) blocked.add(`${p.pos.x},${p.pos.y}`);
  const seen = new Map<string, number>([[`${b.from.x},${b.from.y}`, 0]]);
  const q: Coord[] = [b.from];
  const out: ReachSquare[] = [];
  while (q.length) {
    const c = q.shift() as Coord;
    const d = seen.get(`${c.x},${c.y}`) as number;
    if (d >= total) continue;
    for (const n of neighbours(c)) {
      const k = `${n.x},${n.y}`;
      if (seen.has(k) || blocked.has(k)) continue;
      const occ = playerAt(s, n);
      if (occ && occ.id !== p.id) continue;
      seen.set(k, d + 1);
      out.push({ c: n, steps: d + 1, rushes: Math.max(0, d + 1 - b.maLeft) });
      q.push(n);
    }
  }
  return out;
}

/** Chance of one Dodge from `from` into `to` (rules p.55; first-roll success with the Dodge skill re-roll where usable). */
export function dodgeChance(s: GameState, p: Player, from: Coord, to: Coord): number {
  return dodgeChanceWith(p, markersOf(s, from, p.team), markersOf(s, to, p.team));
}

function dodgeChanceWith(p: Player, markersFrom: Player[], markersToAll: Player[]): number {
  if (!markersFrom.length) return 1;
  let mod = 0;
  const markersTo = markersToAll.filter((q) => !hasSkill(q, 'titchy'));
  if (markersTo.length && !hasSkill(p, 'stunty')) mod -= markersTo.length;
  if (markersFrom.some((q) => canUse(q, 'prehensileTail'))) mod -= 1;
  if (canUse(p, 'twoHeads')) mod += 1;
  if (hasSkill(p, 'titchy')) mod += 1;
  const one = d6SuccessProb(p.ag, mod);
  const tackle = markersFrom.some((q) => canUse(q, 'tackle'));
  const reroll = canUse(p, 'dodge') && !p.usage.dodgeReroll && !tackle;
  return reroll ? one + (1 - one) * one : one;
}

export function rushChance(s: GameState, p: Player): number {
  let mod = 0;
  if (s.weather === 'blizzard') mod -= 1;
  if (hasSkill(p, 'drunkard')) mod -= 1;
  if (molesUnder(s, p)) mod -= 1;
  const one = d6SuccessProb(2, mod);
  return canUse(p, 'sureFeet') && !p.usage.sureFeet ? one + (1 - one) * one : one;
}

export interface Route {
  path: PathStep[];
  /** Chance of making every Dodge and Rush on the route (skill re-rolls only). */
  pSafe: number;
  dodges: number;
  rushes: number;
  /** A shorter route exists but is riskier. */
  detour: boolean;
}

type Node = { c: Coord; steps: number; dir: number; cost: number; turns: number; dodges: number; prev: Node | null };

/**
 * Lowest-risk legal route of plain steps from the end of `pathSoFar` to `to`.
 * Loose balls are never crossed (a pick-up attempt would end the move) unless
 * `to` is the ball's square. Returns null if `to` cannot be reached.
 */
export function safestRoute(s: GameState, playerId: string, to: Coord, pathSoFar: PathStep[] = [], opts: RouteOptions = {}): Route | null {
  usePitch(s);
  const b = movementBudget(s, playerId, pathSoFar);
  if (!b) return null;
  const p = getPlayer(s, playerId);
  const total = b.maLeft + b.rushesLeft;
  const ball = s.ball.kind === 'ground' ? s.ball.pos : null;
  // Squares are indexed x*15+y; occupancy and markers are looked up once per square.
  const key = (c: Coord) => c.x * 15 + c.y;
  const blocked = new Set<number>(opts.revisit ? [] : pathSoFar.map((st) => key(st.to)));
  if (p.pos && !opts.revisit) blocked.add(key(p.pos));
  const occupied = new Set<number>();
  // With revisits the mover's own start square is free once he has left it.
  for (const q of s.players) if (q.location === 'pitch' && q.pos && !(opts.revisit && q.id === p.id)) occupied.add(key(q.pos));
  const markCache = new Map<number, Player[]>();
  const marks = (c: Coord) => {
    const k = key(c);
    let m = markCache.get(k);
    if (!m) {
      m = markersOf(s, c, p.team);
      markCache.set(k, m);
    }
    return m;
  };
  const pRush = rushChance(s, p);
  const EPS = 1e-12;
  // best[key(x,y,steps,dir)] = node
  const best = new Map<number, Node>();
  const better = (a: Node, c: Node) => (a.cost < c.cost - EPS ? true : a.cost > c.cost + EPS ? false : a.steps !== c.steps ? a.steps < c.steps : a.turns < c.turns);
  const start: Node = { c: b.from, steps: 0, dir: -1, cost: 0, turns: 0, dodges: 0, prev: null };
  // binary heap ordered by `better`
  const heap: Node[] = [];
  const push = (n: Node) => {
    heap.push(n);
    let i = heap.length - 1;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (!better(heap[i], heap[par])) break;
      [heap[i], heap[par]] = [heap[par], heap[i]];
      i = par;
    }
  };
  const pop = (): Node => {
    const top = heap[0];
    const last = heap.pop() as Node;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && better(heap[l], heap[m])) m = l;
        if (r < heap.length && better(heap[r], heap[m])) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]];
        i = m;
      }
    }
    return top;
  };
  const far = (c: Coord) => Math.max(Math.abs(c.x - to.x), Math.abs(c.y - to.y));
  push(start);
  let goal: Node | null = null;
  while (heap.length) {
    const cur = pop();
    if (cur.c.x === to.x && cur.c.y === to.y && cur.steps > 0) {
      if (!goal || better(cur, goal)) goal = cur;
      continue;
    }
    if (goal && cur.cost > goal.cost + EPS) break;
    if (cur.steps >= total) continue;
    const fromMarks = marks(cur.c);
    const nb = neighbours(cur.c);
    nb.forEach((n, dir) => {
      const k0 = key(n);
      if (blocked.has(k0)) return;
      if (occupied.has(k0)) return;
      const steps = cur.steps + 1;
      // A square from which `to` cannot be reached with the squares left leads nowhere.
      if (steps + far(n) > total) return;
      const isGoal = n.x === to.x && n.y === to.y;
      if (ball && ball.x === n.x && ball.y === n.y && !isGoal) return;
      let pStep = fromMarks.length ? dodgeChanceWith(p, fromMarks, marks(n)) : 1;
      if (steps > b.maLeft) pStep *= pRush;
      if (pStep <= 0) return;
      const dodged = fromMarks.length > 0;
      const node: Node = { c: n, steps, dir, cost: cur.cost - Math.log(pStep), turns: cur.turns + (cur.dir >= 0 && cur.dir !== dir ? 1 : 0), dodges: cur.dodges + (dodged ? 1 : 0), prev: cur };
      const k = (k0 * 32 + steps) * 8 + dir;
      const old = best.get(k);
      if (old && !better(node, old)) return;
      best.set(k, node);
      push(node);
    });
  }
  if (!goal) return null;
  const path: PathStep[] = [];
  for (let n: Node | null = goal; n && n.prev; n = n.prev) path.unshift({ to: { ...n.c }, kind: 'step' });
  const rushes = Math.max(0, goal.steps - b.maLeft);
  const shortest = reachableSquares(s, playerId, pathSoFar, opts).find((r) => r.c.x === to.x && r.c.y === to.y)?.steps ?? goal.steps;
  return { path, pSafe: Math.exp(-goal.cost), dodges: goal.dodges, rushes, detour: goal.steps > shortest };
}

/**
 * V5.5: the Jumps (p.56), Leaps (p.132) and Pogo jumps (p.133) the player can make from the end of `pathSoFar` — for
 * the planning control. Each lands two squares away (costing 2 squares of movement, Rushing if needed, rolled before
 * the jump) and needs an Agility Test with the modifiers `jumpMods` gives (the same function the roll uses). `pTest`
 * is the chance of the Agility Test alone (a natural 1 always fails), `pRushes` of the Rushes before it; neither
 * counts a re-roll. A failed test is a Turnover.
 */
export interface JumpOption {
  to: Coord;
  kind: 'jump' | 'leap' | 'pogo';
  over: Coord;
  target: number;
  mods: Array<{ label: string; value: number }>;
  rushes: number;
  pTest: number;
  pRushes: number;
}

export function jumpOptions(s: GameState, playerId: string, pathSoFar: PathStep[] = []): JumpOption[] {
  usePitch(s);
  const b = movementBudget(s, playerId, pathSoFar);
  if (!b || b.maLeft + b.rushesLeft < 2) return [];
  const p = getPlayer(s, playerId);
  if (!p.pos) return [];
  const from = b.from;
  const out: JumpOption[] = [];
  const pRush = rushChance(s, p);
  for (let dx = -2; dx <= 2; dx++)
    for (let dy = -2; dy <= 2; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== 2) continue;
      const to = { x: from.x + dx, y: from.y + dy };
      if (!inBounds(to)) continue;
      const occ = playerAt(s, to);
      if (occ && occ.id !== p.id) continue;
      let best: JumpOption | null = null;
      for (const kind of ['jump', 'leap', 'pogo'] as const) {
        if (kind !== 'jump' && !canUse(p, kind)) continue;
        const over = jumpedSquare(s, p, from, to, kind);
        if (!over) continue;
        const mods = jumpMods(s, p, from, to, kind);
        const m = mods.reduce((a, x) => a + x.value, 0);
        const pTest = d6SuccessProb(p.ag, m);
        const rushes = Math.max(0, 2 - b.maLeft);
        const o: JumpOption = { to, kind, over, target: p.ag, mods, rushes, pTest, pRushes: Math.pow(pRush, rushes) };
        if (!best || o.pTest > best.pTest + 1e-9) best = o;
      }
      if (best) out.push(best);
    }
  return out;
}
