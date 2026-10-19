/**
 * Candidate generation for any position (V5.6 `candidates` service).
 *
 * Unlike the built-in coach's internal generator (which pre-screens and keeps only a few squares and targets per
 * player), this service lists the legal actions of the team that is ACTIVE in a position — the request's position or any
 * explored one — without silently restricting to what the built-in prefers: every reachable square, every adjacent
 * Block target, every Blitz target × attack square, pass and hand-off receivers, fouls, Secure the Ball, Throw
 * Team-mate, Projectile Vomit, standing up, ending an activation or the Turn. What is not generated is listed in
 * `capabilities().candidateFamilies.notGenerated` (and can still be proposed with `input` and checked with `plan`).
 *
 * Filtering, sorting and pagination happen BEFORE the expensive part: the exact probabilities (the engine's enumeration,
 * the same numbers as the plan preview) are computed only for the records returned (or for the pool, when a
 * probability filter or sort asks for it, up to `maxExactPerCall`). Every cut is reported in `truncated`.
 */
import type { ActionInput, Coord, GameState, PathStep, Player, PlayerActionInput, TeamId } from '../engine/index';
import type { PlanResult, OutcomeSummary } from '../engine/planner';
import { E } from '../ai/engine';
import { clamp } from './limits';
import { checkTeam, exploreCore } from './explore';
import { evaluatePosition } from './evaluation';
import { fail, KeyError, type Position, type ServiceFailure, type Session } from './session';

export const FAMILIES = ['move', 'standUp', 'secure', 'block', 'blitz', 'pass', 'handoff', 'foul', 'ttm', 'special', 'endActivation', 'endTurn'] as const;
export type Family = (typeof FAMILIES)[number];

export interface CandidateOpts {
  from?: unknown;
  team?: unknown;
  families?: unknown;
  players?: unknown;
  targets?: unknown;
  region?: unknown;
  maxRushes?: unknown;
  maxDodges?: unknown;
  minPSuccess?: unknown;
  maxPTurnover?: unknown;
  minPTouchdown?: unknown;
  limit?: unknown;
  offset?: unknown;
  maxPerFamily?: unknown;
  maxPerPlayer?: unknown;
  sort?: unknown;
  precision?: unknown;
  detail?: unknown;
  builtIn?: unknown;
  outcomeValue?: unknown;
  includeIllegal?: unknown;
  maxMs?: unknown;
}

interface Stub {
  family: Family;
  kind: string;
  actorId: string | null;
  targetId: string | null;
  targetIds: string[];
  to: Coord | null;
  steps: number | null;
  rushes: number | null;
  order: number;
  label: string;
  /** Builds the input (computing the route); null if it turns out impossible. */
  build: () => PlayerActionInput | { kind: 'endTurn' } | { kind: 'endActivation' } | null;
}

export interface CandidateRec {
  id: string;
  position: string;
  team: TeamId;
  family: Family;
  kind: string;
  actorId: string | null;
  targetId: string | null;
  targetIds: string[];
  label: string;
  input: ActionInput | null;
  path: Array<{ x: number; y: number; kind: string }>;
  destination: { x: number; y: number } | null;
  legal: boolean;
  errors?: string[];
  rushes: number | null;
  dodges: number | null;
  exact: boolean | null;
  pSuccess: number | null;
  pTurnover: number | null;
  pTouchdown: number | null;
  pOpponentTouchdown: number | null;
  pActiveHasBall: number | null;
  pOppHasBall: number | null;
  pBallGround: number | null;
  unresolved: number | null;
  noTeamReroll?: { pSuccess: number; pTurnover: number; pTouchdown: number };
  block?: { dice: number; chooser: string; attST: number; defST: number; offAssists: number; defAssists: number; atLeastOne: Record<string, number>; chosen: Record<string, number> };
  outcome?: { value: number; gain: number; pTurnover: number; pTouchdown: number; exact: boolean } | null;
  builtIn?: Record<string, unknown> | null;
  summary?: { withTeamRerolls: OutcomeSummary | null; withoutTeamRerolls: OutcomeSummary | null; steps: Array<{ kind: string; label: string; pSingle: number | null }> };
}

const up = (p: Player) => p.location === 'pitch' && p.stance === 'standing' && !!p.pos;
const cheb = (a: Coord, b: Coord) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/** The built-in coach's candidates carry this key for matching: the input's JSON. */
export const inputKey = (i: unknown) => JSON.stringify(i);

function stubsFor(st: GameState, team: TeamId, p: Player, startOrder: number): Stub[] {
  const out: Stub[] = [];
  if (!p.pos || E.activationBlockReason(st, p)) return out;
  let order = startOrder;
  const opts = E.actionOptions(st, p);
  const on = (a: string) => opts.find((o) => o.action === a && o.enabled);
  const act = st.turn.activation;
  const continuing = !!act && act.playerId === p.id && !act.over;
  const moveAction = continuing ? (act as NonNullable<typeof act>).action : on('move') ? 'move' : null;
  const holder = st.ball.kind === 'held' ? E.findPlayer(st, st.ball.playerId) : undefined;
  const carrying = holder?.id === p.id;
  const who = E.label(p);
  const goalX = team === 'A' ? E.pitch().w - 1 : 0;
  const fmt = E.board.fmt;
  const loose = st.ball.kind === 'ground' ? st.ball.pos : null;
  const add = (s: Omit<Stub, 'order' | 'targetIds'> & { targetIds?: string[] }) => out.push({ ...s, targetIds: s.targetIds ?? (s.targetId ? [s.targetId] : []), order: order++ });
  const opps = st.players.filter((q) => q.team !== team && up(q));
  const reachAll = E.reachableSquares(st, p.id);
  const reachMap = new Map(reachAll.map((r) => [`${r.c.x},${r.c.y}`, r]));
  const budget = E.movementBudget(st, p.id);
  const total = budget ? budget.maLeft + budget.rushesLeft : 0;
  const route = (c: Coord) => E.safestRoute(st, p.id, c);

  // --- moves (the declared Action's movement; a prone player's stand-up) ----------------------------------------
  if (moveAction && ['move', 'blitz', 'handoff', 'pass', 'secure'].includes(moveAction)) {
    for (const r of reachAll) {
      const pickup = !!loose && loose.x === r.c.x && loose.y === r.c.y;
      const score = carrying && r.c.x === goalX;
      const kind = pickup ? 'pickup' : score ? 'score' : carrying ? 'carry' : continuing ? 'continue' : 'move';
      add({
        family: moveAction === 'move' ? 'move' : (moveAction as Family),
        kind,
        actorId: p.id,
        targetId: null,
        to: r.c,
        steps: r.steps,
        rushes: r.rushes,
        label: `${who}: ${pickup ? 'pick up the ball in' : score ? 'run in to score at' : 'move to'} ${fmt(r.c)}`,
        build: () => {
          const rt = route(r.c);
          return rt ? ({ kind: 'playerAction', playerId: p.id, action: moveAction, path: rt.path } as PlayerActionInput) : null;
        },
      });
    }
    if (p.stance === 'prone' && !continuing) {
      add({ family: 'standUp', kind: 'standUp', actorId: p.id, targetId: null, to: p.pos, steps: 0, rushes: 0, label: `${who}: stand up`, build: () => ({ kind: 'playerAction', playerId: p.id, action: 'move', path: [] }) });
    }
  }
  // --- Block ------------------------------------------------------------------------------------------------------
  if (on('block') && p.stance === 'standing') {
    for (const q of opps) {
      if (cheb(q.pos as Coord, p.pos) !== 1) continue;
      add({ family: 'block', kind: 'block', actorId: p.id, targetId: q.id, to: null, steps: 0, rushes: 0, label: `${who}: Block ${E.label(q)}`, build: () => ({ kind: 'playerAction', playerId: p.id, action: 'block', path: [], blockTarget: q.id }) });
    }
  }
  // --- Blitz: every target × every square from which it can be attacked ----------------------------------------
  const blitzDone = continuing && (act as NonNullable<typeof act>).action === 'blitz' && (act as NonNullable<typeof act>).blocksDone > 0;
  if (on('blitz') && !blitzDone) {
    const declared = continuing ? (act as NonNullable<typeof act>).blitzTarget : undefined;
    for (const q of opps) {
      if (declared && q.id !== declared) continue;
      const squares: Coord[] = [];
      if (cheb(q.pos as Coord, p.pos) === 1) squares.push(p.pos);
      for (const nb of E.board.neighbours(q.pos as Coord)) {
        const r = reachMap.get(`${nb.x},${nb.y}`);
        if (r && r.steps <= total - 1) squares.push(nb);
      }
      for (const c of squares) {
        const r = reachMap.get(`${c.x},${c.y}`);
        const here = c === p.pos;
        add({
          family: 'blitz',
          kind: 'blitz',
          actorId: p.id,
          targetId: q.id,
          to: c,
          steps: here ? 0 : r?.steps ?? null,
          rushes: here ? 0 : r?.rushes ?? null,
          label: `${who}: Blitz ${E.label(q)}${here ? '' : ` from ${fmt(c)}`}`,
          build: () => {
            const rt = here ? { path: [] as PathStep[] } : route(c);
            if (!rt || rt.path.length > total - 1) return null;
            return { kind: 'playerAction', playerId: p.id, action: 'blitz', path: rt.path, blitzTarget: q.id, blockTarget: q.id };
          },
        });
      }
    }
  }
  // --- Pass and Hand-off (the ball carrier) -----------------------------------------------------------------------
  if (carrying && p.stance === 'standing') {
    const mates = st.players.filter((q) => q.team === team && q.id !== p.id && up(q) && !q.distracted);
    if (on('pass') && p.pa !== null) {
      for (const q of mates) {
        const rng = E.board.passRange(p.pos, q.pos as Coord);
        if (!rng || rng === 'bomb') continue;
        add({ family: 'pass', kind: 'pass', actorId: p.id, targetId: q.id, to: q.pos, steps: 0, rushes: 0, label: `${who}: ${rng} pass to ${E.label(q)}`, build: () => ({ kind: 'playerAction', playerId: p.id, action: 'pass', path: [], passTarget: { ...(q.pos as Coord) } }) });
      }
    }
    if (on('handoff')) {
      for (const q of mates) {
        if (cheb(q.pos as Coord, p.pos) - 1 > total) continue;
        let sq: Coord | null = cheb(q.pos as Coord, p.pos) === 1 ? p.pos : null;
        if (!sq) {
          let bestSteps = 99;
          for (const nb of E.board.neighbours(q.pos as Coord)) {
            const r = reachMap.get(`${nb.x},${nb.y}`);
            if (r && r.steps < bestSteps) {
              bestSteps = r.steps;
              sq = nb;
            }
          }
        }
        if (!sq) continue;
        const at = sq;
        add({
          family: 'handoff',
          kind: 'handoff',
          actorId: p.id,
          targetId: q.id,
          to: at,
          steps: at === p.pos ? 0 : reachMap.get(`${at.x},${at.y}`)?.steps ?? null,
          rushes: at === p.pos ? 0 : reachMap.get(`${at.x},${at.y}`)?.rushes ?? null,
          label: `${who}: hand the ball to ${E.label(q)}`,
          build: () => {
            const rt = at === p.pos ? { path: [] as PathStep[] } : route(at);
            return rt ? { kind: 'playerAction', playerId: p.id, action: 'handoff', path: rt.path, handoffTarget: q.id } : null;
          },
        });
      }
    }
  }
  // --- Secure the Ball ---------------------------------------------------------------------------------------------
  if (on('secure') && loose) {
    const r0 = reachMap.get(`${loose.x},${loose.y}`);
    add({ family: 'secure', kind: 'secure', actorId: p.id, targetId: null, to: loose, steps: r0?.steps ?? null, rushes: r0?.rushes ?? null, label: `${who}: Secure the Ball in ${fmt(loose)}`, build: () => {
      const rt = route(loose);
      return rt ? { kind: 'playerAction', playerId: p.id, action: 'secure', path: rt.path } : null;
    } });
  }
  // --- Projectile Vomit --------------------------------------------------------------------------------------------
  if (opts.find((o) => o.action === 'special' && o.special === 'projectileVomit' && o.enabled)) {
    for (const q of opps) {
      if (cheb(q.pos as Coord, p.pos) !== 1) continue;
      add({ family: 'special', kind: 'vomit', actorId: p.id, targetId: q.id, to: null, steps: 0, rushes: 0, label: `${who}: Projectile Vomit on ${E.label(q)}`, build: () => ({ kind: 'playerAction', playerId: p.id, action: 'special', special: 'projectileVomit', path: [], vomitTarget: q.id }) });
    }
  }
  // --- Foul: a Prone or Stunned opponent; the cheapest squares next to it -------------------------------------------
  if (on('foul') && !carrying && p.stance === 'standing') {
    const downs = st.players.filter((q) => q.team !== team && q.location === 'pitch' && q.pos && q.stance !== 'standing');
    for (const q of downs) {
      const squares: Array<{ c: Coord; steps: number; rushes: number }> = [];
      if (cheb(q.pos as Coord, p.pos) === 1) squares.push({ c: p.pos, steps: 0, rushes: 0 });
      for (const nb of E.board.neighbours(q.pos as Coord)) {
        const r = reachMap.get(`${nb.x},${nb.y}`);
        if (r) squares.push({ c: nb, steps: r.steps, rushes: r.rushes });
      }
      squares.sort((a, b) => a.steps - b.steps);
      for (const x of squares.slice(0, 2)) {
        add({
          family: 'foul',
          kind: 'foul',
          actorId: p.id,
          targetId: q.id,
          to: x.c,
          steps: x.steps,
          rushes: x.rushes,
          label: `${who}: Foul ${E.label(q)}${x.c === p.pos ? '' : ` from ${fmt(x.c)}`}`,
          build: () => {
            const rt = x.c === p.pos ? { path: [] as PathStep[] } : route(x.c);
            return rt ? { kind: 'playerAction', playerId: p.id, action: 'foul', path: rt.path, foulTarget: q.id } : null;
          },
        });
      }
    }
  }
  // --- Throw Team-mate: every square in range ----------------------------------------------------------------------
  if (on('ttm')) {
    for (const tp of E.throwablePlayers(st, p)) {
      for (let x = 0; x < E.pitch().w; x++) {
        for (let y = 0; y < E.pitch().h; y++) {
          const c = { x, y };
          if (!E.ttmRange(p.pos, c) || E.playerAt(st, c)) continue;
          add({ family: 'ttm', kind: 'ttm', actorId: p.id, targetId: tp.id, to: c, steps: 0, rushes: 0, label: `${who}: throw ${E.label(tp)}${holder?.id === tp.id ? ' (with the ball)' : ''} at ${fmt(c)}`, build: () => ({ kind: 'playerAction', playerId: p.id, action: 'ttm', path: [], thrownPlayerId: tp.id, throwTarget: c }) });
        }
      }
    }
  }
  // --- End the activation ------------------------------------------------------------------------------------------
  if (continuing && p.id === (act as NonNullable<typeof act>).playerId) {
    add({ family: 'endActivation', kind: 'endActivation', actorId: p.id, targetId: null, to: null, steps: 0, rushes: 0, label: `${who}: end the activation`, build: () => ({ kind: 'endActivation' }) });
  }
  return out;
}

function parseRegion(v: unknown): ((c: Coord) => boolean) | ServiceFailure | null {
  if (v === undefined || v === null) return null;
  const r = v as { x0?: number; x1?: number; y0?: number; y1?: number; within?: Coord[]; nearBall?: number };
  if (Array.isArray(r.within)) {
    const set = new Set(r.within.map((c) => `${c.x},${c.y}`));
    return (c) => set.has(`${c.x},${c.y}`);
  }
  if ([r.x0, r.x1, r.y0, r.y1].some((x) => x !== undefined && !Number.isFinite(Number(x)))) return fail('invalid-argument', 'region: x0/x1/y0/y1 must be numbers, or use { within: [{x,y}…] }.');
  const x0 = r.x0 ?? -Infinity;
  const x1 = r.x1 ?? Infinity;
  const y0 = r.y0 ?? -Infinity;
  const y1 = r.y1 ?? Infinity;
  return (c) => c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1;
}

const asSet = (v: unknown): Set<string> | null => (Array.isArray(v) ? new Set(v.map(String)) : null);

function familyCaps(v: unknown): { all: number | null; by: Record<string, number> } {
  if (typeof v === 'number' && Number.isFinite(v)) return { all: Math.max(0, Math.floor(v)), by: {} };
  if (v && typeof v === 'object') {
    const by: Record<string, number> = {};
    for (const [k, n] of Object.entries(v as Record<string, unknown>)) if (Number.isFinite(Number(n))) by[k] = Math.max(0, Math.floor(Number(n)));
    return { all: null, by };
  }
  return { all: null, by: {} };
}

export function countKind(plan: PlanResult, kind: string): number {
  return plan.steps.filter((s) => s.kind === kind).length;
}

/** The engine's exact preview of an input as candidate numbers (`precision: 'fast'` uses the coarser threshold and says so). */
function measure(ses: Session, pos: Position, input: ActionInput, precision: 'exact' | 'fast' | 'none', deadline: number): Partial<CandidateRec> & { ok: boolean; errors?: string[] } {
  E.usePitch(ses.root);
  if (precision === 'fast') {
    const r = exploreCore(ses, input, { pos, maxLeaves: 700, threshold: 3e-4, maxOutcomes: 0, observations: false, maxMs: 2500 });
    if (!r.ok) return { ok: false, errors: r.errors };
    return { ok: true, exact: r.exact, pSuccess: r.pCompleted, pTurnover: r.pTurnover, pTouchdown: r.pTouchdown, pOpponentTouchdown: r.pOpponentTouchdown, unresolved: r.unresolvedMass, rushes: null, dodges: null };
  }
  const tp = Date.now();
  const plan = ses.plan(pos.state, input, { followUp: true, maxLeaves: ses.leafCap(deadline - tp) });
  ses.stats.leaves += plan.withTeamRerolls?.leaves ?? 0;
  ses.noteLeaves((plan.withTeamRerolls?.leaves ?? 0) * 2, Date.now() - tp);
  if (!plan.ok || !plan.withTeamRerolls) return { ok: false, errors: plan.errors.length ? plan.errors : ['The action is not legal here.'] };
  const w = plan.withTeamRerolls;
  const wo = plan.withoutTeamRerolls ?? w;
  const rec: Partial<CandidateRec> & { ok: boolean } = {
    ok: true,
    exact: w.unresolved < 1e-9 && wo.unresolved < 1e-9,
    pSuccess: w.pCompleted,
    pTurnover: w.pTurnover,
    pTouchdown: w.pTouchdownActive,
    pOpponentTouchdown: w.pTouchdownOpp,
    pActiveHasBall: w.pActiveHasBall,
    pOppHasBall: w.pOppHasBall,
    pBallGround: w.pBallGround,
    unresolved: Math.max(w.unresolved, wo.unresolved),
    rushes: countKind(plan, 'rush'),
    dodges: countKind(plan, 'dodge'),
    noTeamReroll: { pSuccess: wo.pCompleted, pTurnover: wo.pTurnover, pTouchdown: wo.pTouchdownActive },
  };
  if (plan.block) rec.block = { dice: plan.block.dice, chooser: plan.block.chooser, attST: plan.block.attST, defST: plan.block.defST, offAssists: plan.block.offAssists, defAssists: plan.block.defAssists, atLeastOne: plan.block.atLeastOne, chosen: plan.block.chosen };
  (rec as { _plan?: PlanResult })._plan = plan;
  return rec;
}

export function candidatesService(ses: Session, o: CandidateOpts): Record<string, unknown> | ServiceFailure {
  const t0 = Date.now();
  const limits = ses.limits;
  let pos: Position;
  try {
    pos = ses.position(o.from);
  } catch (e) {
    if (e instanceof KeyError) return fail('stale-key', e.message);
    throw e;
  }
  if (pos.driveOver) return fail('illegal', 'The Drive has ended in this position: there are no actions to generate.');
  if (pos.state.pending) return fail('pending-decision', 'This position waits for a rule decision (see observation.pending): there are no Turn actions to generate.');
  if (pos.state.phase !== 'play') return fail('illegal', `The game is not in play in this position (phase ${pos.state.phase}).`);
  const tm = checkTeam(pos, o.team, 'candidates');
  if (tm) return tm;
  const team = pos.state.turn.active;
  E.usePitch(ses.root);
  const regionFn = parseRegion(o.region);
  if (regionFn && typeof regionFn !== 'function') return regionFn;
  const famFilter = asSet(o.families);
  if (famFilter) for (const f of famFilter) if (!(FAMILIES as readonly string[]).includes(f)) return fail('invalid-argument', `Unknown family "${f}" (families: ${FAMILIES.join(', ')}).`);
  const playerFilter = asSet(o.players);
  const targetFilter = asSet(o.targets);
  const caps = familyCaps(o.maxPerFamily);
  const perPlayer = typeof o.maxPerPlayer === 'number' ? Math.max(0, Math.floor(o.maxPerPlayer)) : null;
  const limit = Math.round(clamp(o.limit, limits.defaultPage, 0, limits.maxPage));
  const offset = Math.round(clamp(o.offset, 0, 0, 1e9));
  const precision: 'exact' | 'fast' | 'none' = o.precision === 'fast' ? 'fast' : o.precision === 'none' ? 'none' : 'exact';
  const detail = o.detail === 'full' ? 'full' : 'summary';
  const sortKey = typeof o.sort === 'string' ? o.sort : 'pool';
  const probSorts = ['pSuccess', 'pTouchdown', 'pTurnover'];
  if (!['pool', 'goalDistance', 'steps', ...probSorts].includes(sortKey)) return fail('invalid-argument', `sort must be one of pool, goalDistance, steps, pSuccess, pTouchdown, pTurnover (got ${JSON.stringify(o.sort)}).`);
  const needsExactPool = probSorts.includes(sortKey) || o.minPSuccess !== undefined || o.maxPTurnover !== undefined || o.minPTouchdown !== undefined || o.maxDodges !== undefined;
  if (precision === 'none' && needsExactPool) return fail('invalid-argument', 'precision "none" (legality only, no probabilities) cannot be combined with probability filters or sorts.');
  const callMs = clamp(o.maxMs, limits.defaultCallMs, 50, limits.maxCallMs);
  const deadline = t0 + Math.max(50, Math.min(callMs, ses.serviceTimeLeft()));
  const truncated: Array<{ reason: string; detail: string; [k: string]: unknown }> = [];
  const warnings: unknown[] = [];

  // 1. The pool: cheap, deterministic, every legal action the generator knows.
  const st = ses.cloneOf(pos);
  let pool: Stub[] = [];
  let order = 0;
  for (const p of st.players) {
    if (p.team !== team) continue;
    if (playerFilter && !playerFilter.has(p.id)) continue;
    const list = stubsFor(st, team, p, order);
    order += list.length;
    pool.push(...list);
  }
  pool.push({ family: 'endTurn', kind: 'endTurn', actorId: null, targetId: null, targetIds: [], to: null, steps: 0, rushes: 0, order: order++, label: 'End the Turn', build: () => ({ kind: 'endTurn' }) });
  const generated = pool.length;
  // 2. Cheap filters.
  if (famFilter) pool = pool.filter((s) => famFilter.has(s.family));
  if (targetFilter) pool = pool.filter((s) => s.targetIds.some((t) => targetFilter.has(t)));
  if (regionFn) pool = pool.filter((s) => !s.to || (regionFn as (c: Coord) => boolean)(s.to));
  if (o.maxRushes !== undefined && Number.isFinite(Number(o.maxRushes))) pool = pool.filter((s) => s.rushes === null || s.rushes <= Number(o.maxRushes));
  const afterFilters = pool.length;
  // 3. Per-family / per-player limits (in pool order), reported.
  const used: Record<string, number> = {};
  const usedP: Record<string, number> = {};
  const cut: Record<string, number> = {};
  pool = pool.filter((s) => {
    const cap = caps.by[s.family] ?? caps.all;
    if (cap !== null && (used[s.family] ?? 0) >= cap) {
      cut[s.family] = (cut[s.family] ?? 0) + 1;
      return false;
    }
    if (perPlayer !== null && s.actorId) {
      if ((usedP[s.actorId] ?? 0) >= perPlayer) {
        cut[`player:${s.actorId}`] = (cut[`player:${s.actorId}`] ?? 0) + 1;
        return false;
      }
      usedP[s.actorId] = (usedP[s.actorId] ?? 0) + 1;
    }
    used[s.family] = (used[s.family] ?? 0) + 1;
    return true;
  });
  if (Object.keys(cut).length) truncated.push({ reason: 'family-limit', detail: 'Candidates dropped by maxPerFamily / maxPerPlayer.', dropped: cut });
  // 4. Cheap sorts.
  const goalX = team === 'A' ? E.pitch().w - 1 : 0;
  if (sortKey === 'goalDistance') pool.sort((a, b) => (a.to ? Math.abs(goalX - a.to.x) : 99) - (b.to ? Math.abs(goalX - b.to.x) : 99) || a.order - b.order);
  else if (sortKey === 'steps') pool.sort((a, b) => (a.steps ?? 99) - (b.steps ?? 99) || a.order - b.order);

  // 5. Materialise records (route + exact probabilities) for what is needed.
  const includeIllegal = o.includeIllegal === true;
  const wantOutcome = o.outcomeValue === true;
  const wantBuiltIn = o.builtIn === true;
  let exactDone = 0;
  let exactStopped: string | null = null;
  const materialise = (s: Stub, withProbs: boolean): CandidateRec | null => {
    const input = s.build();
    const rec: CandidateRec = {
      id: '',
      position: pos.key,
      team,
      family: s.family,
      kind: s.kind,
      actorId: s.actorId,
      targetId: s.targetId,
      targetIds: s.targetIds,
      label: s.label,
      input: input as ActionInput | null,
      path: input && input.kind === 'playerAction' ? input.path.map((x) => ({ x: x.to.x, y: x.to.y, kind: x.kind })) : [],
      destination: s.to ? { x: s.to.x, y: s.to.y } : null,
      legal: !!input,
      rushes: s.rushes,
      dodges: null,
      exact: null,
      pSuccess: null,
      pTurnover: null,
      pTouchdown: null,
      pOpponentTouchdown: null,
      pActiveHasBall: null,
      pOppHasBall: null,
      pBallGround: null,
      unresolved: null,
    };
    if (!input) {
      rec.errors = ['No legal route to that square.'];
      return includeIllegal ? rec : null;
    }
    if (!withProbs) {
      const errs = E.validateInput(pos.state, input);
      rec.legal = errs.length === 0;
      if (errs.length) rec.errors = errs;
      return rec.legal || includeIllegal ? rec : null;
    }
    if (Date.now() > deadline) {
      exactStopped ??= 'maxMs';
      return null;
    }
    const m = measure(ses, pos, input, precision, deadline) as ReturnType<typeof measure> & { _plan?: PlanResult };
    exactDone++;
    if (!m.ok) {
      rec.legal = false;
      rec.errors = m.errors;
      return includeIllegal ? rec : null;
    }
    const plan = m._plan;
    delete m._plan;
    Object.assign(rec, m);
    delete (rec as { ok?: boolean }).ok;
    if (detail === 'full' && plan) rec.summary = { withTeamRerolls: plan.withTeamRerolls, withoutTeamRerolls: plan.withoutTeamRerolls, steps: plan.steps.map((x) => ({ kind: x.kind, label: x.label, pSingle: x.pSingle })) };
    return rec;
  };
  let records: CandidateRec[] = [];
  let poolForPaging: Stub[] = pool;
  let evaluated: number | null = null;
  let complete = true;
  if (needsExactPool) {
    const cap = Math.min(limits.maxExactPerCall, pool.length);
    if (pool.length > cap) {
      truncated.push({ reason: 'exact-cap', detail: `Probability filters / sorts need exact numbers for the whole pool; only the first ${cap} of ${pool.length} were evaluated. Narrow the pool (families, players, region, maxRushes) to cover the rest.`, evaluated: cap, pool: pool.length, limit: 'maxExactPerCall', max: limits.maxExactPerCall });
      complete = false;
    }
    const all: CandidateRec[] = [];
    for (const s of pool.slice(0, cap)) {
      const r = materialise(s, true);
      if (r) all.push(r);
      if (exactStopped) break;
    }
    evaluated = exactDone;
    if (exactStopped) {
      complete = false;
      truncated.push({ reason: 'timeout', detail: `Stopped after ${Math.round(Date.now() - t0)} ms (maxMs); only the ${exactDone} candidates evaluated so far are considered.`, limit: 'maxMs', max: callMs });
      ses.diag('candidates', 'timeout', 'warn', 'candidates stopped at maxMs while computing exact probabilities.', { limit: 'maxMs', max: callMs });
    }
    let list = all;
    const num = (v: unknown) => (v === undefined || v === null ? NaN : Number(v));
    if (o.minPSuccess !== undefined) list = list.filter((r) => (r.pSuccess ?? 0) >= num(o.minPSuccess));
    if (o.maxPTurnover !== undefined) list = list.filter((r) => (r.pTurnover ?? 1) <= num(o.maxPTurnover));
    if (o.minPTouchdown !== undefined) list = list.filter((r) => (r.pTouchdown ?? 0) >= num(o.minPTouchdown));
    if (o.maxDodges !== undefined) list = list.filter((r) => (r.dodges ?? 0) <= num(o.maxDodges));
    if (sortKey === 'pSuccess') list.sort((a, b) => (b.pSuccess ?? 0) - (a.pSuccess ?? 0));
    else if (sortKey === 'pTouchdown') list.sort((a, b) => (b.pTouchdown ?? 0) - (a.pTouchdown ?? 0));
    else if (sortKey === 'pTurnover') list.sort((a, b) => (a.pTurnover ?? 1) - (b.pTurnover ?? 1));
    records = list;
    poolForPaging = [];
  } else {
    const page = pool.slice(offset, offset + limit);
    for (const s of page) {
      if (exactStopped) break;
      const r = materialise(s, precision !== 'none');
      if (r) records.push(r);
    }
    if (exactStopped) {
      complete = false;
      truncated.push({ reason: 'timeout', detail: `Stopped after ${Math.round(Date.now() - t0)} ms (maxMs) while computing exact probabilities: ${records.length} of ${page.length} records of this page returned.`, limit: 'maxMs', max: callMs });
      ses.diag('candidates', 'timeout', 'warn', 'candidates stopped at maxMs while computing exact probabilities.', { limit: 'maxMs', max: callMs });
    }
    evaluated = exactDone;
  }
  const total = needsExactPool ? records.length : pool.length;
  const pageRecords = needsExactPool ? records.slice(offset, offset + limit) : records;
  const dropped = generated - afterFilters;
  void poolForPaging;
  for (const r of pageRecords) {
    r.id = ses.newCandidateId(pos.key, r.input);
    if (wantBuiltIn && pos.key === 'root' && r.input) r.builtIn = ses.rootBuiltIn.get(inputKey(r.input)) ?? null;
    else if (wantBuiltIn) r.builtIn = null;
    if (wantOutcome && r.input && r.legal) {
      const ex = exploreCore(ses, r.input, { pos, maxOutcomes: 0, observations: false, maxLeaves: 700, threshold: 3e-4, maxMs: 1500 });
      const base = evaluatePosition(ses, pos, ses.team).total;
      r.outcome = ex.ok ? { value: ex.value, gain: ex.value - base, pTurnover: ex.pTurnover, pTouchdown: ex.pTouchdown, exact: ex.exact } : null;
    }
  }
  ses.stats.candidatesReturned += pageRecords.length;
  const hasMore = offset + pageRecords.length < total;
  if (hasMore) truncated.push({ reason: 'page', detail: `Returned ${pageRecords.length} of ${total} (limit ${limit}, offset ${offset}); continue with offset ${offset + pageRecords.length}.`, nextOffset: offset + pageRecords.length });
  if (precision === 'fast') ses.noteOnce('candidates', 'approximate', 'candidates used precision "fast": probabilities come from a coarser enumeration (see each record\'s `exact` and `unresolved`).', { limit: 'precision' });
  return {
    ok: true,
    errors: [],
    position: { key: pos.key, depth: pos.depth, activeTeam: team },
    pool: { generated, afterFilters, afterLimits: pool.length, droppedByFilters: dropped },
    offset,
    limit,
    total,
    returned: pageRecords.length,
    hasMore,
    nextOffset: hasMore ? offset + pageRecords.length : null,
    complete,
    evaluated,
    precision,
    truncated,
    warnings,
    candidates: pageRecords,
    elapsedMs: Date.now() - t0,
  };
}
