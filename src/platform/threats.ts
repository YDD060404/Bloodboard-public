/**
 * Threat-analysis primitives (V5.6 `threats.*` services). They return DATA computed by the engine — never verdicts such as
 * "safe" or "dangerous": a coach decides what a number means. Nothing here knows any coach's principles.
 *
 *  - tackleZones:  current coverage of each square by each team, and the coverage a team could PROJECT with one move
 *                  (every square a standing player can reach, and the squares next to it).
 *  - reach:        the squares a player (or every standing player of a team) can reach, with the Rushes and Dodges of the
 *                  safest route and its exact chance of making them (engine route search, skill re-rolls only).
 *  - blitz:        every legal Blitz the ACTIVE team has on the requested targets, with the engine's exact outcome (the
 *                  attacker's Turnover chance, the target's Knock-down / crowd-push chance, Block dice, result mix).
 *  - scoring:      who can reach the far End Zone this Turn (with the ball now, or after a pick-up), with exact chances.
 *  - crowd:        which players stand where a single Block could push them into the crowd, and — for the active team's
 *                  Blocks/Blitzes — the exact chance it happens. Chain pushes are NOT computed (flagged in the result).
 *
 * As-if analysis of the OTHER team (for instance "what could the opponent do to my carrier next Turn") needs a position in
 * which that team is active: explore `{ kind: 'endTurn' }` (or follow a `sequence`) and pass that position's key as `from`.
 * `tackleZones` and `reach` may be asked for either team in any position, and say so in `assumption`.
 */
import type { Coord, GameState, Player, PlayerActionInput, TeamId } from '../engine/index';
import type { PlanResult } from '../engine/planner';
import { E } from '../ai/engine';
import { clamp } from './limits';
import { checkTeam } from './explore';
import { fail, KeyError, type Position, type ServiceFailure, type Session } from './session';

const cheb = (a: Coord, b: Coord) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const up = (p: Player) => p.location === 'pitch' && p.stance === 'standing' && !!p.pos;
const sq = (c: Coord) => ({ x: c.x, y: c.y });
const other = (t: TeamId): TeamId => (t === 'A' ? 'B' : 'A');
const ids = (v: unknown): Set<string> | null => (Array.isArray(v) ? new Set(v.map(String)) : null);

function resolve(ses: Session, o: { from?: unknown; team?: unknown }, svc: string, needActive: boolean): { pos: Position; st: GameState } | ServiceFailure {
  let pos: Position;
  try {
    pos = ses.position(o.from);
  } catch (e) {
    if (e instanceof KeyError) return fail('stale-key', e.message);
    throw e;
  }
  if (needActive) {
    const tm = checkTeam(pos, o.team, svc);
    if (tm) return tm;
    if (pos.driveOver) return fail('illegal', 'The Drive has ended in this position.');
    if (pos.state.pending) return fail('pending-decision', 'This position waits for a rule decision.');
    if (pos.state.phase !== 'play') return fail('illegal', `The game is not in play in this position (phase ${pos.state.phase}).`);
  } else if (o.team !== undefined && o.team !== null && o.team !== '' && o.team !== 'A' && o.team !== 'B') {
    return fail('invalid-argument', `team must be "A" or "B" (got ${JSON.stringify(o.team)}).`);
  }
  E.usePitch(ses.root);
  return { pos, st: ses.cloneOf(pos) };
}

const isFail = (x: unknown): x is ServiceFailure => !!x && (x as ServiceFailure).ok === false;

/** Dodges on a route: every step that leaves a square marked by the opponent. */
function dodgesOn(st: GameState, p: Player, from: Coord, path: Array<{ to: Coord }>): number {
  let n = 0;
  let at = from;
  for (const s of path) {
    if (E.markersOf(st, at, p.team).length) n++;
    at = s.to;
  }
  return n;
}

// ───────────────────────────────────────────────── tackle zones
export function tackleZonesService(ses: Session, o: { from?: unknown; team?: unknown; teams?: unknown; projected?: unknown; region?: unknown; detail?: unknown }): Record<string, unknown> | ServiceFailure {
  const t0 = Date.now();
  const r = resolve(ses, o, 'threats.tackleZones', false);
  if (isFail(r)) return r;
  const { pos, st } = r;
  const teams: TeamId[] = o.team === 'A' || o.team === 'B' ? [o.team] : Array.isArray(o.teams) ? (o.teams.filter((t) => t === 'A' || t === 'B') as TeamId[]) : ['A', 'B'];
  const W = E.pitch().w;
  const H = E.pitch().h;
  const inBounds = (c: Coord) => c.x >= 0 && c.y >= 0 && c.x < W && c.y < H;
  const withIds = o.detail === 'players';
  const out: Record<string, unknown> = {};
  let truncated = false;
  for (const team of teams) {
    const cur = new Map<string, string[]>();
    for (const p of st.players) {
      if (p.team !== team || !E.hasTackleZone(p) || !p.pos) continue;
      for (const n of E.board.neighbours(p.pos)) if (inBounds(n)) (cur.get(`${n.x},${n.y}`) ?? cur.set(`${n.x},${n.y}`, []).get(`${n.x},${n.y}`)!).push(p.id);
    }
    const rec: Record<string, unknown> = {
      current: [...cur].map(([k, v]) => { const [x, y] = k.split(',').map(Number); return withIds ? { x, y, n: v.length, by: v } : { x, y, n: v.length }; }),
    };
    if (o.projected !== false) {
      // One movement of each standing player: who could have a Tackle Zone on which square. Uses the position as it is
      // (the other side's own movement is not anticipated) and ignores Dodge/Rush risk — see `reach` for those.
      const proj = new Map<string, Set<string>>();
      let players = 0;
      for (const p of st.players) {
        if (p.team !== team || !up(p) || !E.hasTackleZone(p)) continue;
        if (Date.now() - t0 > ses.limits.maxCallMs) { truncated = true; break; }
        players++;
        const reach = E.reachableSquares(st, p.id);
        const cells = new Set<string>();
        for (const sqr of [{ c: p.pos as Coord }, ...reach]) for (const n of E.board.neighbours(sqr.c)) if (inBounds(n)) cells.add(`${n.x},${n.y}`);
        for (const k of cells) (proj.get(k) ?? proj.set(k, new Set()).get(k)!).add(p.id);
      }
      rec.projected = [...proj].map(([k, v]) => { const [x, y] = k.split(',').map(Number); return withIds ? { x, y, n: v.size, by: [...v] } : { x, y, n: v.size }; });
      rec.projectedPlayers = players;
    }
    out[team] = rec;
  }
  return {
    ok: true,
    position: { key: pos.key, depth: pos.depth },
    activeTeam: pos.state.turn.active,
    teams: out,
    assumption: 'current = Tackle Zones of standing players as they are; projected = one movement of each standing player from this position (other players unmoved, Dodge/Rush risk ignored).',
    exact: !truncated,
    truncated: truncated ? 'time' : null,
    elapsedMs: Date.now() - t0,
  };
}

// ───────────────────────────────────────────────── reach
export function reachService(ses: Session, o: { from?: unknown; team?: unknown; players?: unknown; region?: unknown; maxRushes?: unknown; maxDodges?: unknown; limit?: unknown }): Record<string, unknown> | ServiceFailure {
  const t0 = Date.now();
  const r = resolve(ses, o, 'threats.reach', false);
  if (isFail(r)) return r;
  const { pos, st } = r;
  const want = ids(o.players);
  const team: TeamId | null = o.team === 'A' || o.team === 'B' ? o.team : null;
  const perPlayer = Math.round(clamp(o.limit, 400, 1, 1000));
  const maxR = o.maxRushes === undefined ? Infinity : Number(o.maxRushes);
  const maxD = o.maxDodges === undefined ? Infinity : Number(o.maxDodges);
  const res: Array<Record<string, unknown>> = [];
  let truncated: string | null = null;
  for (const p of st.players) {
    if (!up(p) || (team && p.team !== team) || (want && !want.has(p.id)) || (!team && !want && p.team !== pos.state.turn.active)) continue;
    if (Date.now() - t0 > Math.min(ses.limits.maxCallMs, Math.max(50, ses.serviceTimeLeft()))) { truncated = 'time'; break; }
    const reach = E.reachableSquares(st, p.id);
    const squares: Array<Record<string, unknown>> = [];
    let cut = false;
    for (const s of reach) {
      if (s.rushes > maxR) continue;
      const route = E.safestRoute(st, p.id, s.c);
      if (!route) continue;
      const dodges = dodgesOn(st, p, p.pos as Coord, route.path);
      if (dodges > maxD) continue;
      if (squares.length >= perPlayer) { cut = true; break; }
      squares.push({ x: s.c.x, y: s.c.y, steps: s.steps, rushes: route.rushes, dodges, pSafe: route.pSafe, minRushes: s.rushes, detour: route.detour });
    }
    if (cut) truncated = 'limit';
    res.push({ playerId: p.id, team: p.team, from: sq(p.pos as Coord), maLeft: E.movementBudget(st, p.id)?.maLeft ?? null, squares, cut });
  }
  return {
    ok: true,
    position: { key: pos.key, depth: pos.depth },
    activeTeam: pos.state.turn.active,
    players: res,
    assumption: 'Plain steps through empty squares (no jumps, no pass/hand-off), the position as it is. `pSafe` is the engine route chance of every Dodge and Rush with skill re-rolls only (no team re-roll); `rushes`/`dodges` belong to that safest route, `minRushes` to the shortest one.',
    exact: true,
    truncated,
    elapsedMs: Date.now() - t0,
  };
}

// ───────────────────────────────────────────────── blitz
function planOf(ses: Session, st: GameState, input: PlayerActionInput, fast = false, deadline = Date.now() + 3000): PlanResult {
  const t1 = Date.now();
  const cap = ses.leafCap(deadline - t1);
  // `fast`: branches below 1e-4 are not expanded; the unexpanded mass is reported (`unresolved`, `exact:false`).
  const plan = ses.plan(st, input, fast ? { followUp: true, threshold: 1e-4, maxLeaves: Math.min(6000, cap) } : { followUp: true, maxLeaves: cap });
  ses.stats.leaves += plan.withTeamRerolls?.leaves ?? 0;
  ses.noteLeaves((plan.withTeamRerolls?.leaves ?? 0) * 2, Date.now() - t1);
  return plan;
}

export interface BlitzOpts {
  from?: unknown;
  team?: unknown;
  targets?: unknown;
  attackers?: unknown;
  /** 'best' (default): only the attack square with the lowest attacker Turnover chance per pair; 'all': every attack square. */
  squares?: unknown;
  /** 'exact' (default) or 'fast' (branches below 1e-4 unexpanded, reported). */
  precision?: unknown;
  limit?: unknown;
  maxMs?: unknown;
}

export function blitzService(ses: Session, o: BlitzOpts): Record<string, unknown> | ServiceFailure {
  const t0 = Date.now();
  const r = resolve(ses, o, 'threats.blitz', true);
  if (isFail(r)) return r;
  const { pos, st } = r;
  const team = st.turn.active;
  const targets = ids(o.targets);
  const attackers = ids(o.attackers);
  const all = o.squares === 'all';
  const limit = Math.round(clamp(o.limit, 60, 1, ses.limits.maxPage));
  const deadline = t0 + clamp(o.maxMs, ses.limits.defaultCallMs, 50, Math.min(ses.limits.maxCallMs, Math.max(50, ses.serviceTimeLeft())));
  const foes = st.players.filter((q) => q.team !== team && up(q) && (!targets || targets.has(q.id)));
  const rows: Array<Record<string, unknown>> = [];
  let truncated: string | null = null;
  let evaluated = 0;
  outer: for (const a of st.players) {
    if (a.team !== team || !up(a) || (attackers && !attackers.has(a.id)) || E.activationBlockReason(st, a)) continue;
    const opt = E.actionOptions(st, a).find((x) => x.action === 'blitz' && x.enabled);
    if (!opt) continue;
    const reach = [{ c: a.pos as Coord, steps: 0, rushes: 0 }, ...E.reachableSquares(st, a.id)];
    for (const f of foes) {
      const cand: Array<{ c: Coord; route: NonNullable<ReturnType<typeof E.safestRoute>> }> = [];
      for (const s of reach) {
        if (cheb(s.c, f.pos as Coord) !== 1) continue;
        const same = s.c.x === (a.pos as Coord).x && s.c.y === (a.pos as Coord).y;
        const route = same ? { path: [], pSafe: 1, dodges: 0, rushes: 0, detour: false } : E.safestRoute(st, a.id, s.c);
        if (route) cand.push({ c: s.c, route });
      }
      cand.sort((x, y) => y.route.pSafe - x.route.pSafe || x.route.path.length - y.route.path.length);
      const list = all ? cand : cand.slice(0, 1);
      const variants: Array<Record<string, unknown>> = [];
      for (const k of list) {
        if (Date.now() > deadline) { truncated = 'time'; break outer; }
        const input: PlayerActionInput = { kind: 'playerAction', playerId: a.id, action: 'blitz', path: k.route.path, blitzTarget: f.id, blockTarget: f.id };
        const plan = planOf(ses, st, input, o.precision === 'fast', deadline);
        evaluated++;
        if (!plan.ok || !plan.withTeamRerolls) continue;
        const w = plan.withTeamRerolls;
        const wo = plan.withoutTeamRerolls ?? w;
        variants.push({
          attackSquare: sq(k.c),
          input,
          rushes: k.route.rushes,
          dodges: dodgesOn(st, a, a.pos as Coord, k.route.path),
          pRouteSafe: k.route.pSafe,
          pTurnover: w.pTurnover,
          pTargetDown: w.pTargetDown,
          pTargetRemoved: w.pTargetRemoved,
          pTargetCrowd: w.pTargetCrowd,
          pTargetPushed: w.pTargetPushed,
          pActorFell: w.pActorFell,
          pBallFreed: f.id === (st.ball.kind === 'held' ? st.ball.playerId : null) ? w.pBallGround + w.pOppHasBall : null,
          blockResult: w.blockResult,
          noTeamReroll: { pTurnover: wo.pTurnover, pTargetDown: wo.pTargetDown, pTargetCrowd: wo.pTargetCrowd },
          block: plan.block ? { dice: plan.block.dice, chooser: plan.block.chooser, attST: plan.block.attST, defST: plan.block.defST, offAssists: plan.block.offAssists, defAssists: plan.block.defAssists, atLeastOne: plan.block.atLeastOne, chosen: plan.block.chosen } : null,
          exact: w.unresolved < 1e-9 && wo.unresolved < 1e-9,
          unresolved: Math.max(w.unresolved, wo.unresolved),
        });
      }
      if (variants.length) rows.push({ attackerId: a.id, targetId: f.id, variants });
    }
  }
  // The blitz with the lowest attacker Turnover chance first (data ordering only).
  rows.sort((x, y) => Math.min(...(x.variants as Array<{ pTurnover: number }>).map((v) => v.pTurnover)) - Math.min(...(y.variants as Array<{ pTurnover: number }>).map((v) => v.pTurnover)));
  const cut = rows.length > limit;
  if (cut && !truncated) truncated = 'limit';
  const byTarget: Record<string, { minPTurnover: number; attackers: number; dice: number[] }> = {};
  for (const row of rows) {
    const t = row.targetId as string;
    const b = (byTarget[t] ??= { minPTurnover: 1, attackers: 0, dice: [] });
    b.attackers++;
    for (const v of row.variants as Array<{ pTurnover: number; block: { dice: number } | null }>) {
      b.minPTurnover = Math.min(b.minPTurnover, v.pTurnover);
      const d = v.block?.dice;
      if (d !== undefined && !b.dice.includes(d)) b.dice.push(d);
    }
  }
  return {
    ok: true,
    position: { key: pos.key, depth: pos.depth },
    team,
    blitzes: rows.slice(0, limit),
    total: rows.length,
    byTarget,
    evaluated,
    exact: !truncated || truncated === 'limit',
    truncated,
    assumption: 'Each row is one attacker against one target; `variants` are the attack squares (best = lowest attacker Turnover chance unless squares:"all"). Probabilities are the engine\'s exact enumeration with team re-rolls; `noTeamReroll` gives the no-re-roll figures. The position is as it is: no other action of the team is assumed first.',
    elapsedMs: Date.now() - t0,
  };
}

// ───────────────────────────────────────────────── scoring
export function scoringService(ses: Session, o: { from?: unknown; team?: unknown; players?: unknown; limit?: unknown; maxMs?: unknown }): Record<string, unknown> | ServiceFailure {
  const t0 = Date.now();
  const r = resolve(ses, o, 'threats.scoring', true);
  if (isFail(r)) return r;
  const { pos, st } = r;
  const team = st.turn.active;
  const W = E.pitch().w;
  const goalX = team === 'A' ? W - 1 : 0;
  const want = ids(o.players);
  const limit = Math.round(clamp(o.limit, 12, 1, 100));
  const deadline = t0 + clamp(o.maxMs, ses.limits.defaultCallMs, 50, Math.min(ses.limits.maxCallMs, Math.max(50, ses.serviceTimeLeft())));
  const holder = st.ball.kind === 'held' ? (E.findPlayer(st, st.ball.playerId) ?? null) : null;
  const ball = st.ball.kind === 'ground' ? st.ball.pos : null;
  const rows: Array<Record<string, unknown>> = [];
  let truncated: string | null = null;
  for (const p of st.players) {
    if (p.team !== team || !up(p) || (want && !want.has(p.id)) || E.activationBlockReason(st, p)) continue;
    const opt = E.actionOptions(st, p);
    const carrying = holder?.id === p.id;
    if (!carrying && !ball) continue;
    if (!carrying && holder) continue;
    const reach = E.reachableSquares(st, p.id);
    const scoreSq = reach.filter((s) => s.c.x === goalX);
    if (!carrying) {
      // Needs the pick-up on the way: candidate route to the ball, then onwards is not modelled here (see explore/sequence).
      continue;
    }
    if (!opt.some((x) => (x.action === 'move' || x.action === 'blitz' || x.action === 'pass') && x.enabled) && !(st.turn.activation?.playerId === p.id)) continue;
    // Already in the End Zone?
    let best: Record<string, unknown> | null = null;
    for (const s of scoreSq.sort((a, b) => a.rushes - b.rushes || a.steps - b.steps).slice(0, 6)) {
      if (Date.now() > deadline) { truncated = 'time'; break; }
      const route = E.safestRoute(st, p.id, s.c);
      if (!route) continue;
      const input: PlayerActionInput = { kind: 'playerAction', playerId: p.id, action: 'move', path: route.path };
      const plan = planOf(ses, st, input, false, deadline);
      if (!plan.ok || !plan.withTeamRerolls) continue;
      const w = plan.withTeamRerolls;
      const row = { playerId: p.id, carrier: true, to: sq(s.c), steps: s.steps, rushes: route.rushes, dodges: dodgesOn(st, p, p.pos as Coord, route.path), pTouchdown: w.pTouchdownActive, pTurnover: w.pTurnover, input, exact: w.unresolved < 1e-9, unresolved: w.unresolved };
      if (!best || (row.pTouchdown as number) > (best.pTouchdown as number)) best = row;
    }
    if (best) rows.push(best);
    if (truncated) break;
  }
  rows.sort((a, b) => (b.pTouchdown as number) - (a.pTouchdown as number));
  return {
    ok: true,
    position: { key: pos.key, depth: pos.depth },
    team,
    goalX,
    carrierId: holder?.id ?? null,
    threats: rows.slice(0, limit),
    ballOnGround: ball ? sq(ball) : null,
    exact: !truncated,
    truncated,
    assumption: 'Direct threats only: the ball carrier moving to the End Zone with the route of the lowest risk. A ball on the ground, hand-offs and passes are not included — use `candidates` (every record carries an exact pTouchdown) or `sequence` for those.',
    elapsedMs: Date.now() - t0,
  };
}

// ───────────────────────────────────────────────── crowd
export function crowdService(ses: Session, o: { from?: unknown; team?: unknown; players?: unknown; victimTeam?: unknown; blitz?: unknown; limit?: unknown; maxMs?: unknown }): Record<string, unknown> | ServiceFailure {
  const t0 = Date.now();
  const r = resolve(ses, o, 'threats.crowd', false);
  if (isFail(r)) return r;
  const { pos, st } = r;
  const vt: TeamId | null = o.victimTeam === 'A' || o.victimTeam === 'B' ? o.victimTeam : null;
  const want = ids(o.players);
  const limit = Math.round(clamp(o.limit, 40, 1, 200));
  const rows: Array<Record<string, unknown>> = [];
  for (const v of st.players) {
    if (!up(v) || (vt && v.team !== vt) || (want && !want.has(v.id))) continue;
    const from = E.crowdPushSquares(st, v);
    if (!from.length) continue;
    const foes = from.map((c) => E.playerAt(st, c)).filter((p): p is Player => !!p && p.team !== v.team && up(p));
    const squares = from.map((c) => ({ ...sq(c), occupiedBy: E.playerAt(st, c)?.id ?? null }));
    rows.push({ playerId: v.id, team: v.team, at: sq(v.pos as Coord), carrier: st.ball.kind === 'held' && st.ball.playerId === v.id, attackSquares: squares, attackersInPlace: foes.map((p) => p.id), edgeDistance: Math.min((v.pos as Coord).y, E.pitch().h - 1 - (v.pos as Coord).y, (v.pos as Coord).x, E.pitch().w - 1 - (v.pos as Coord).x) });
  }
  // Exact chance for the ACTIVE team's Blocks (attackers already adjacent) — the engine's enumeration.
  const active = st.turn.active;
  const exact: Array<Record<string, unknown>> = [];
  if (!st.pending && st.phase === 'play' && !pos.driveOver) {
    const deadline = t0 + clamp(o.maxMs, ses.limits.defaultCallMs, 50, Math.min(ses.limits.maxCallMs, Math.max(50, ses.serviceTimeLeft())));
    for (const row of rows) {
      const v = E.getPlayer(st, row.playerId as string);
      if (v.team === active) continue;
      for (const pid of row.attackersInPlace as string[]) {
        if (Date.now() > deadline) break;
        const a = E.getPlayer(st, pid);
        if (a.team !== active || E.activationBlockReason(st, a)) continue;
        if (!E.actionOptions(st, a).some((x) => (x.action === 'block' || x.action === 'blitz') && x.enabled)) continue;
        const input: PlayerActionInput = { kind: 'playerAction', playerId: a.id, action: 'block', path: [], blockTarget: v.id };
        const plan = planOf(ses, st, input, false, deadline);
        if (!plan.ok || !plan.withTeamRerolls) continue;
        exact.push({ attackerId: a.id, targetId: v.id, pTargetCrowd: plan.withTeamRerolls.pTargetCrowd, pTurnover: plan.withTeamRerolls.pTurnover, pTargetDown: plan.withTeamRerolls.pTargetDown, dice: plan.block?.dice ?? null, exact: plan.withTeamRerolls.unresolved < 1e-9 });
      }
    }
  }
  return {
    ok: true,
    position: { key: pos.key, depth: pos.depth },
    activeTeam: active,
    exposed: rows.slice(0, limit),
    total: rows.length,
    blocks: exact,
    notComputed: ['chain pushes (a push that moves a second player into the crowd)', 'Blitz routes onto an attack square (use threats.blitz, which reports pTargetCrowd)'],
    assumption: '`exposed` lists players next to the edge such that a single Block from one of `attackSquares` pushes them off the pitch (their own Stand Firm / Sidestep considered, an attacker\'s Juggernaut / Grab not assumed). `blocks` are exact Block outcomes for attackers of the active team already standing on such a square.',
    exact: true,
    elapsedMs: Date.now() - t0,
  };
}
