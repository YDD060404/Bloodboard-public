/**
 * Outcome exploration (V5.5.1 `explore`, extended in V5.6) and action sequences.
 *
 * The rules engine's planner enumerates every dice outcome of an action (no dice are rolled, the game's generator is
 * never touched). The platform adds what a coach needs to build a search on top of it:
 *  - every outcome is a position with a request-scoped key: explore again from it (`from`), any team's Turn;
 *  - valuation from either team's perspective with the built-in evaluation (optional feature vectors);
 *  - the in-action decisions (Block die, re-roll, push square, Follow-up …) are either resolved by the engine's
 *    documented default policy — always reported in `decisionPolicy` — or enumerated as branches and solved for the
 *    perspective team (`decisions`), so no coach inherits a hidden assumption;
 *  - probabilities are exact over the enumerated mass; the unexpanded mass is reported (`exact`, `unresolvedMass`).
 */
import type { ActionInput, GameState, TeamId } from '../engine/index';
import { E } from '../ai/engine';
import { clamp } from './limits';
import { analysisView, canonical } from './analysis';
import { evaluateState, featuresOf, type FeatureVector, type HorizonMode } from './evaluation';
import { observe, type Observation } from './observe';
import { fail, KeyError, type Position, type ServiceFailure, type Session } from './session';

export class ExploreTimeout extends Error {}

/** Additive capability: retained outcomes preserve the complete analysis-relevant continuation state. */
export const OUTCOME_IDENTITY = 'complete-state-v1' as const;

/**
 * Merge only equal continuation states and equal outcome flags. Use the complete analysis view rather than a
 * field allowlist: full stance/location, skill usage, activation flags, resources and future rule-state fields
 * must all survive. Canonical JSON ignores object insertion order without a lossy hash. History, RNG, clock and
 * title are deliberately excluded by analysisView; none affect future probability analysis.
 * `completed` is separate from the state: a representative outcome must never hide a different completion flag.
 */
export function positionKey(st: GameState, turnover: boolean, td: TeamId | null, completed = false): string {
  return canonical({ state: analysisView(st), turnover, touchdown: td, completed });
}

export type DecisionSel = 'builtin' | 'best' | 'worst';
export interface DecisionPolicyInput {
  own?: DecisionSel;
  opponent?: DecisionSel;
  /** Decision types that are branched (others use the engine's default policy). */
  branchTypes?: string[];
}
export const DEFAULT_BRANCH_TYPES = ['blockDie', 'reroll', 'pushSquare', 'followUp', 'skill'];

export interface DecisionPolicy {
  mode: 'builtin' | 'solved';
  own: DecisionSel;
  opponent: DecisionSel;
  branchTypes: string[];
  /** Plain-language statement of how in-action decisions were resolved. */
  statement: string;
  /** The engine's default-policy assumptions, which apply to every decision that is not branched. */
  assumptions?: string[];
}

export interface ExploreOpts {
  from?: unknown;
  team?: unknown;
  perspective?: unknown;
  threshold?: unknown;
  maxLeaves?: unknown;
  maxOutcomes?: unknown;
  observations?: unknown;
  features?: unknown;
  maxMs?: unknown;
  maxKeep?: unknown;
  horizon?: unknown;
  decisions?: unknown;
  /** Internal: also hand back the states of the listed outcomes (for `sequence`). */
  retain?: boolean;
  /** Internal: do not register positions (the caller keeps the states itself). */
  noKeys?: boolean;
  /** Internal: explore from this position object instead of a key. */
  pos?: Position;
}

export interface OutcomeRec {
  key: string | null;
  p: number;
  value: number;
  turnover: boolean;
  touchdown: TeamId | null;
  completed: boolean;
  /** Team to act in the resulting position (null if the state was not kept). */
  active?: TeamId | null;
  observation?: Observation;
  features?: FeatureVector;
  decisions?: Array<{ type: string; team: TeamId; optionId: string }>;
  /** Internal (retain): the resulting state. */
  state?: GameState | null;
}

export interface ExploreOk {
  ok: true;
  /** Identifies the outcome aggregation contract, including on scalar-only results. */
  outcomeIdentity: typeof OUTCOME_IDENTITY;
  errors: string[];
  value: number;
  pTurnover: number;
  pTouchdown: number;
  pOpponentTouchdown: number;
  pCompleted: number;
  enumerated: number;
  leaves: number;
  outcomes: OutcomeRec[];
  rest: { p: number; value: number };
  // V5.6
  perspective: TeamId;
  activeTeam: TeamId;
  position: { key: string; depth: number };
  exact: boolean;
  unresolvedMass: number;
  approximation: string | null;
  decisionPolicy: DecisionPolicy;
  decisionSummary?: Array<{ type: string; side: 'own' | 'opponent'; expectedNodes: number; chosen: Record<string, number> }>;
  applied: { threshold: number; maxLeaves: number; maxOutcomes: number; maxMs: number; horizon: HorizonMode };
  elapsedMs: number;
}

export function perspectiveOf(ses: Session, pos: Position, v: unknown): TeamId | ServiceFailure {
  if (v === undefined || v === null || v === '' || v === 'self') return ses.team;
  if (v === 'A' || v === 'B') return v;
  if (v === 'opponent') return ses.team === 'A' ? 'B' : 'A';
  if (v === 'active') return pos.state.turn.active;
  return fail('invalid-argument', `perspective must be "A", "B", "self", "opponent" or "active" (got ${JSON.stringify(v)}).`);
}

export function checkTeam(pos: Position, team: unknown, service: string): ServiceFailure | null {
  if (team === undefined || team === null || team === '') return null;
  if (team !== 'A' && team !== 'B') return fail('invalid-argument', `team must be "A" or "B" (got ${JSON.stringify(team)}).`);
  if (pos.state.turn.active !== team) return fail('wrong-team', `${service}: team ${String(team)} is not the active team in position ${pos.key} (active: ${pos.state.turn.active}).`, { requested: team, active: pos.state.turn.active, position: pos.key });
  return null;
}

export function parseDecisions(v: unknown): DecisionPolicyInput | ServiceFailure {
  if (v === undefined || v === null || v === 'builtin') return { own: 'builtin', opponent: 'builtin' };
  if (v === 'adversarial') return { own: 'best', opponent: 'worst' };
  if (v === 'optimistic') return { own: 'best', opponent: 'best' };
  if (typeof v === 'object') {
    const o = v as DecisionPolicyInput;
    const ok = (x: unknown) => x === undefined || x === 'builtin' || x === 'best' || x === 'worst';
    if (!ok(o.own) || !ok(o.opponent)) return fail('invalid-argument', 'decisions.own / decisions.opponent must be "builtin", "best" or "worst".');
    if (o.branchTypes !== undefined && (!Array.isArray(o.branchTypes) || o.branchTypes.some((x) => typeof x !== 'string'))) return fail('invalid-argument', 'decisions.branchTypes must be an array of decision type names.');
    return { own: o.own ?? 'builtin', opponent: o.opponent ?? 'builtin', branchTypes: o.branchTypes };
  }
  return fail('invalid-argument', 'decisions must be "builtin", "adversarial", "optimistic" or { own, opponent, branchTypes }.');
}

interface Grp {
  p: number;
  sumV: number;
  turnover: boolean;
  touchdown: TeamId | null;
  completed: number;
  state: GameState | null;
  first: number;
  decisions?: Array<{ type: string; team: TeamId; optionId: string }>;
}

interface DecRec {
  index: number;
  type: string;
  team: TeamId;
  side: 'own' | 'opponent';
  options: string[];
  chosen: string;
}

interface LeafRec {
  path: number[];
  p: number;
  v: number;
  turnover: boolean;
  touchdown: TeamId | null;
  completed: boolean;
  group: string;
  decs: DecRec[];
}

interface Node {
  kids: Map<number, Node>;
  leaf?: LeafRec;
  dec?: DecRec;
  // solved values
  V?: number;
  W?: number;
  pick?: number;
  reach?: number;
}

export function exploreCore(ses: Session, input: ActionInput, o: ExploreOpts): ExploreOk | ServiceFailure {
  const t0 = Date.now();
  let from: Position;
  try {
    from = o.pos ?? ses.position(o.from);
  } catch (e) {
    if (e instanceof KeyError) return fail('stale-key', e.message);
    throw e;
  }
  if (from.driveOver) return fail('illegal', 'The Drive has ended in this position.');
  if (from.state.pending) return fail('pending-decision', 'This position waits for a rule decision; explore needs a position where the game waits for an action.');
  const tm = checkTeam(from, o.team, 'explore');
  if (tm) return tm;
  const persp = perspectiveOf(ses, from, o.perspective);
  if (typeof persp !== 'string') return persp;
  const dp = parseDecisions(o.decisions);
  if ('ok' in dp) return dp;
  const limits = ses.limits;
  const threshold = clamp(o.threshold, 3e-4, 1e-6, 0.05);
  const leavesCap = Math.min(limits.maxLeavesPerCall, ses.leavesLeft());
  if (leavesCap <= 0) {
    ses.noteOnce('explore', 'leaf-budget', `The request's enumeration budget (${limits.maxLeavesPerRequest} leaves) is used up.`, { limit: 'maxLeavesPerRequest', max: limits.maxLeavesPerRequest });
    return fail('leaf-budget', 'The request\'s enumeration budget is used up.');
  }
  const maxLeaves = Math.round(clamp(o.maxLeaves, limits.defaultLeavesPerCall, 1, leavesCap));
  const maxOutcomes = Math.round(clamp(o.maxOutcomes, 8, 0, limits.maxOutcomesPerCall));
  const callMs = clamp(o.maxMs, limits.defaultCallMs, 50, limits.maxCallMs);
  const maxMs = Math.max(50, Math.min(callMs, ses.serviceTimeLeft()));
  const horizon: HorizonMode = o.horizon === 'position' ? 'position' : 'root';
  const maxKeep = Math.round(clamp(o.maxKeep, 64, 0, 256));
  const deadline = t0 + maxMs;
  const solved = dp.own !== 'builtin' || dp.opponent !== 'builtin';
  const branchTypes = new Set(dp.branchTypes ?? DEFAULT_BRANCH_TYPES);
  E.usePitch(ses.root);
  const active = from.state.turn.active;
  const groups = new Map<string, Grp>();
  const leafRecs: LeafRec[] = [];
  const decsByRun = new WeakMap<object, DecRec[]>();
  let sumV = 0;
  let sumVTO = 0;
  let explored = 0;
  let pTO = 0;
  let pTD = 0;
  let pOppTD = 0;
  let pDone = 0;
  let n = 0;
  const wrap = solved
    ? (base: (req: import('../engine/index').DecisionRequest, ctx: never) => string) =>
        (req: import('../engine/index').DecisionRequest, ctx: { dice: unknown }): string => {
          const side: 'own' | 'opponent' = req.team === persp ? 'own' : 'opponent';
          if (dp[side] === 'builtin' || !branchTypes.has(req.type) || req.options.length < 2) return (base as (r: typeof req, c: typeof ctx) => string)(req, ctx);
          const dice = ctx.dice as { cursor: number; choose<T>(x: Array<{ key: string; p: number; value: T }>): T };
          const index = dice.cursor;
          const chosen = dice.choose(req.options.map((x) => ({ key: x.id, p: 1, value: x.id })));
          let list = decsByRun.get(ctx as object);
          if (!list) decsByRun.set(ctx as object, (list = []));
          list.push({ index, type: req.type, team: req.team, side, options: req.options.map((x) => x.id), chosen });
          return chosen;
        }
    : undefined;
  let r: ReturnType<typeof E.exploreOutcomes>;
  try {
    r = E.exploreOutcomes(
      from.state,
      input,
      { threshold, maxLeaves, followUp: true, ...(wrap ? { wrapDecider: wrap as never } : {}) },
      (leaf) => {
        if (Date.now() > deadline) throw new ExploreTimeout();
        const v = evaluateState(ses, leaf.state, persp, !!leaf.touchdown, horizon).total;
        sumV += leaf.p * v;
        explored += leaf.p;
        if (leaf.turnover) {
          pTO += leaf.p;
          sumVTO += leaf.p * v;
        }
        if (leaf.touchdown === persp) pTD += leaf.p;
        else if (leaf.touchdown) pOppTD += leaf.p;
        if (leaf.completed) pDone += leaf.p;
        const key = positionKey(leaf.state, leaf.turnover, leaf.touchdown, leaf.completed);
        let g = groups.get(key);
        const decs = decsByRun.get(leaf.run) ?? [];
        if (!g) {
          // The leaf's state belongs to the enumerator: the first (most likely) leaf of each of the first groups is copied.
          g = { p: 0, sumV: 0, turnover: leaf.turnover, touchdown: leaf.touchdown, completed: 0, state: groups.size < maxKeep ? E.cloneState(leaf.state) : null, first: n };
          groups.set(key, g);
        }
        g.p += leaf.p;
        g.sumV += leaf.p * v;
        if (leaf.completed) g.completed += leaf.p;
        if (solved) leafRecs.push({ path: leaf.path, p: leaf.p, v, turnover: leaf.turnover, touchdown: leaf.touchdown, completed: leaf.completed, group: key, decs });
        n++;
        ses.stats.leaves++;
      },
    );
  } catch (e) {
    if (e instanceof ExploreTimeout) {
      ses.diag('explore', 'timeout', 'warn', `Stopped after ${Math.round(maxMs)} ms (maxMs): this action has too many outcomes to enumerate in time here.`, { limit: 'maxMs', max: maxMs });
      return fail('timeout', `Stopped after ${Math.round(maxMs)} ms (maxMs): this action has too many outcomes to enumerate in time here.`, { timedOut: true, limit: 'maxMs', max: maxMs });
    }
    throw e;
  }
  if (!r.ok) return fail('illegal', r.errors[0] ?? 'The action is not legal here.', { errors: r.errors });
  if (explored <= 0) return fail('illegal', 'No outcome could be enumerated.');
  const totalMass = explored + Math.max(0, r.unresolved);
  const unresolvedMass = totalMass > 0 ? Math.max(0, r.unresolved) / totalMass : 0;
  const exact = unresolvedMass < 1e-9;
  const applied = { threshold, maxLeaves, maxOutcomes, maxMs, horizon };
  const policyBase: DecisionPolicy = solved
    ? {
        mode: 'solved',
        own: dp.own as DecisionSel,
        opponent: dp.opponent as DecisionSel,
        branchTypes: [...branchTypes],
        statement: `In-action decisions of types [${[...branchTypes].join(', ')}] were enumerated as branches and solved for team ${persp}'s evaluation: the perspective team's own decisions ${dp.own === 'builtin' ? 'follow the default policy' : dp.own === 'best' ? 'take the best-valued option' : 'take the worst-valued option'}; the other team's ${dp.opponent === 'builtin' ? 'follow the default policy' : dp.opponent === 'best' ? 'take the option best for the perspective team' : 'take the option worst for the perspective team'}. All other decisions follow the default policy.`,
        assumptions: E.POLICY_ASSUMPTIONS,
      }
    : {
        mode: 'builtin',
        own: 'builtin',
        opponent: 'builtin',
        branchTypes: [],
        statement: 'Every in-action decision (Block die, re-roll, push square, Follow-up, skill use …) follows the rules engine\'s default policy, listed in `assumptions`. Use `decisions` to enumerate and solve them instead.',
        assumptions: E.POLICY_ASSUMPTIONS,
      };
  let reachableGroups: Map<string, { p: number; sumV: number; completed: number }> | null = null;
  let summary: ExploreOk['decisionSummary'];
  let value: number;
  let pTurnover: number;
  let pTouchdown: number;
  let pOppTouchdown: number;
  let pCompleted: number;
  let outcomeDecisions: Map<string, Array<{ type: string; team: TeamId; optionId: string }>> | null = null;
  if (!solved) {
    const un = Math.max(0, r.unresolved);
    const unTO = Math.min(un, Math.max(0, r.unresolvedTurnover));
    const unOK = un - unTO;
    const exOK = explored - pTO;
    const vTO = pTO > 0 ? sumVTO / pTO : sumV / explored;
    const vOK = exOK > 1e-12 ? (sumV - sumVTO) / exOK : sumV / explored;
    const k = exOK > 1e-12 ? (exOK + unOK) / exOK : 1;
    value = sumV + unTO * vTO + unOK * vOK;
    pTurnover = pTO + unTO;
    pTouchdown = pTD * k;
    pOppTouchdown = pOppTD * k;
    pCompleted = pDone * k;
  } else {
    // Solve the decision tree (expectimax over the enumerated leaves): chance nodes average by mass, decision nodes take
    // the best / worst child for the perspective team.
    const root: Node = { kids: new Map() };
    for (const lf of leafRecs) {
      let node = root;
      const decAt = new Map(lf.decs.map((d) => [d.index, d]));
      for (let i = 0; i < lf.path.length; i++) {
        const d = decAt.get(i);
        if (d && !node.dec) node.dec = d;
        let kid = node.kids.get(lf.path[i]);
        if (!kid) node.kids.set(lf.path[i], (kid = { kids: new Map() }));
        node = kid;
      }
      node.leaf = lf;
    }
    const solve = (node: Node): void => {
      if (node.leaf) {
        node.V = node.leaf.v;
        node.W = node.leaf.p;
        return;
      }
      for (const kid of node.kids.values()) solve(kid);
      if (node.dec) {
        const sel = dp[node.dec.side] as DecisionSel;
        let best = -1;
        for (const [idx, kid] of [...node.kids.entries()].sort((a, b) => a[0] - b[0])) {
          if (best < 0) best = idx;
          else {
            const cur = (node.kids.get(best) as Node).V as number;
            const v = kid.V as number;
            // "worst" for a decision of the other team means worst for the perspective team; for the perspective team's own
            // decision it is the option with the lowest value (a deliberately pessimistic model).
            if (sel === 'worst' ? v < cur : sel === 'best' ? v > cur : false) best = idx;
          }
        }
        // A branched decision whose selector is 'builtin' never reaches here (it is not branched).
        node.pick = best;
        node.V = (node.kids.get(best) as Node).V;
        node.W = (node.kids.get(best) as Node).W;
      } else {
        let w = 0;
        let s = 0;
        for (const kid of node.kids.values()) {
          w += kid.W as number;
          s += (kid.W as number) * (kid.V as number);
        }
        node.W = w;
        node.V = w > 0 ? s / w : 0;
      }
    };
    solve(root);
    // Top-down: the probability of reaching each node under the solved strategy, and the leaves it still uses.
    reachableGroups = new Map();
    outcomeDecisions = new Map();
    const tally = new Map<string, { type: string; side: 'own' | 'opponent'; expectedNodes: number; chosen: Record<string, number> }>();
    let pT = 0;
    let pTDs = 0;
    let pOTD = 0;
    let pC = 0;
    const walk = (node: Node, reach: number, trail: Array<{ type: string; team: TeamId; optionId: string }>): void => {
      node.reach = reach;
      if (node.leaf) {
        const lf = node.leaf;
        const pp = reach;
        if (lf.turnover) pT += pp;
        if (lf.touchdown === persp) pTDs += pp;
        else if (lf.touchdown) pOTD += pp;
        if (lf.completed) pC += pp;
        let g = reachableGroups!.get(lf.group);
        if (!g) reachableGroups!.set(lf.group, (g = { p: 0, sumV: 0, completed: 0 }));
        g.p += pp;
        g.sumV += pp * lf.v;
        if (lf.completed) g.completed += pp;
        if (!outcomeDecisions!.has(lf.group) && trail.length) outcomeDecisions!.set(lf.group, trail.slice());
        return;
      }
      if (node.dec) {
        const d = node.dec;
        const kid = node.kids.get(node.pick as number) as Node;
        const optionId = d.options[node.pick as number];
        const tk = `${d.type}|${d.side}`;
        let t = tally.get(tk);
        if (!t) tally.set(tk, (t = { type: d.type, side: d.side, expectedNodes: 0, chosen: {} }));
        t.expectedNodes += reach;
        t.chosen[optionId] = (t.chosen[optionId] ?? 0) + reach;
        walk(kid, reach, [...trail, { type: d.type, team: d.team, optionId }]);
        return;
      }
      const total = node.W as number;
      for (const kid of node.kids.values()) walk(kid, total > 0 ? (reach * (kid.W as number)) / total : 0, trail);
    };
    walk(root, 1, []);
    value = root.V as number;
    pTurnover = pT;
    pTouchdown = pTDs;
    pOppTouchdown = pOTD;
    pCompleted = pC;
    summary = [...tally.values()];
  }
  // Outcomes: the most likely distinct resulting positions.
  const listedAll = [...groups.entries()]
    .map(([key, g]) => {
      const rg = reachableGroups ? reachableGroups.get(key) : null;
      // Solving can make an entire group unreachable. Never resurrect its raw enumeration mass.
      return { key, g, p: reachableGroups ? (rg?.p ?? 0) : g.p, sumV: reachableGroups ? (rg?.sumV ?? 0) : g.sumV, completed: reachableGroups ? (rg?.completed ?? 0) : g.completed };
    })
    .filter((x) => x.p > 0)
    .sort((x, y) => y.p - x.p || x.g.first - y.g.first);
  const listed = listedAll.slice(0, maxOutcomes);
  const wantObs = o.observations !== false;
  const wantFeat = o.features === true;
  const outcomes: OutcomeRec[] = listed.map((x) => {
    const g = x.g;
    let key: string | null = null;
    if (g.state && !o.noKeys) key = ses.addPosition(g.state, !!g.touchdown, from, `explore ${input.kind}`, 'explore');
    const rec: OutcomeRec = { key, p: x.p, value: x.sumV / x.p, turnover: g.turnover, touchdown: g.touchdown, completed: x.completed / x.p > 0.5, active: g.state ? g.state.turn.active : null };
    if (wantObs && g.state) rec.observation = observe(g.state, persp, ses.requestId);
    if (wantFeat && g.state) rec.features = featuresOf(g.state, persp, !!g.touchdown);
    const dd = outcomeDecisions?.get(x.key);
    if (dd) rec.decisions = dd;
    if (o.retain) rec.state = g.state;
    return rec;
  });
  const listedP = listed.reduce((a, x) => a + x.p, 0);
  const listedV = listed.reduce((a, x) => a + x.sumV, 0);
  const totalP = solved ? listedAll.reduce((a, x) => a + x.p, 0) : 1;
  const restP = Math.max(0, totalP - listedP);
  const res: ExploreOk = {
    ok: true,
    outcomeIdentity: OUTCOME_IDENTITY,
    errors: [],
    value,
    pTurnover,
    pTouchdown,
    pOpponentTouchdown: pOppTouchdown,
    pCompleted,
    enumerated: explored,
    leaves: r.leaves,
    outcomes,
    rest: { p: restP, value: restP > 1e-9 ? (value * totalP - listedV) / restP : 0 },
    perspective: persp,
    activeTeam: active,
    position: { key: from.key, depth: from.depth },
    exact,
    unresolvedMass,
    approximation: exact ? null : `${(unresolvedMass * 100).toPrecision(2)}% of the probability mass was not expanded (branches below threshold ${threshold}${r.leaves >= maxLeaves ? `, or beyond maxLeaves ${maxLeaves}` : ''}); it is valued like the enumerated outcomes of the same kind.`,
    decisionPolicy: policyBase,
    applied,
    elapsedMs: Date.now() - t0,
  };
  if (summary) res.decisionSummary = summary;
  if (!exact) ses.noteOnce('explore', 'approximate', res.approximation as string, { limit: 'threshold', value: unresolvedMass });
  if (outcomes.length < listedAll.length) ses.noteOnce('explore', 'truncated', `explore listed ${outcomes.length} of ${listedAll.length} distinct outcomes (maxOutcomes ${maxOutcomes}); the rest are summed in \`rest\`.`, { limit: 'maxOutcomes', max: maxOutcomes, value: listedAll.length });
  return res;
}

/** `explore` service result: the core result without internal fields. */
export function exploreService(ses: Session, input: ActionInput, o: ExploreOpts): ExploreOk | ServiceFailure {
  return exploreCore(ses, input, { ...o, retain: false });
}

export interface SequenceOpts {
  from?: unknown;
  team?: unknown;
  perspective?: unknown;
  steps?: unknown;
  maxBranches?: unknown;
  threshold?: unknown;
  maxLeaves?: unknown;
  maxMs?: unknown;
  decisions?: unknown;
  horizon?: unknown;
  onIllegal?: unknown;
  maxFinal?: unknown;
  features?: unknown;
}

/**
 * Evaluate a planned sequence of actions (by the active team) exactly: each step is explored in every branch where the
 * previous one left the Turn running (the most likely `maxBranches` outcomes are followed, the rest are valued where they
 * stand). Turnovers, Touchdowns and end-of-Turn outcomes end a branch. Returns the expected value and chances over the
 * whole tree and the most likely final positions (with keys to continue from).
 */
export function sequenceService(ses: Session, o: SequenceOpts): Record<string, unknown> | ServiceFailure {
  const t0 = Date.now();
  const limits = ses.limits;
  if (!Array.isArray(o.steps) || !o.steps.length) return fail('invalid-argument', 'sequence needs `steps`: a non-empty array of action inputs.');
  if (o.steps.length > limits.maxSequenceSteps) return fail('invalid-argument', `sequence is limited to ${limits.maxSequenceSteps} steps (got ${o.steps.length}).`, { limit: 'maxSequenceSteps', max: limits.maxSequenceSteps });
  let start: Position;
  try {
    start = ses.position(o.from);
  } catch (e) {
    if (e instanceof KeyError) return fail('stale-key', e.message);
    throw e;
  }
  const tm = checkTeam(start, o.team, 'sequence');
  if (tm) return tm;
  const persp = perspectiveOf(ses, start, o.perspective);
  if (typeof persp !== 'string') return persp;
  const dpIn = parseDecisions(o.decisions);
  if ('ok' in dpIn) return dpIn;
  const branches = Math.round(clamp(o.maxBranches, 4, 1, limits.maxSequenceBranches));
  const onIllegal = o.onIllegal === 'fail' ? 'fail' : 'stop';
  const callMs = clamp(o.maxMs, limits.defaultCallMs * 2, 100, limits.maxCallMs * 2);
  const deadline = t0 + Math.min(callMs, ses.serviceTimeLeft());
  const activeAtStart = start.state.turn.active;
  interface Fr {
    p: number;
    pos: Position;
    depth: number;
    via: string[];
    turnover: boolean;
    touchdown: TeamId | null;
    stopped?: string;
  }
  let frontier: Fr[] = [{ p: 1, pos: start, depth: 0, via: [], turnover: false, touchdown: null }];
  const done: Fr[] = [];
  let calls = 0;
  let pTO = 0;
  let pTD = 0;
  let pOppTD = 0;
  let exact = true;
  const stepStats: Array<{ step: number; nodes: number; illegalMass: number; expandedMass: number }> = [];
  let failure: ServiceFailure | null = null;
  const detail = { maxOutcomes: branches, threshold: o.threshold, maxLeaves: o.maxLeaves, decisions: o.decisions, horizon: o.horizon, perspective: persp };
  const steps = o.steps as ActionInput[];
  for (let i = 0; i < steps.length && frontier.length; i++) {
    const next: Fr[] = [];
    const st = { step: i, nodes: frontier.length, illegalMass: 0, expandedMass: 0 };
    for (const fr of frontier) {
      const cont = fr.pos.state.turn.active === activeAtStart && !fr.pos.driveOver && !fr.turnover && !fr.touchdown;
      if (!cont) {
        done.push({ ...fr, stopped: 'turn-ended' });
        continue;
      }
      if (Date.now() > deadline || calls >= 400) {
        ses.noteOnce('sequence', Date.now() > deadline ? 'timeout' : 'truncated', `sequence stopped after ${calls} explore calls (${Math.round(Date.now() - t0)} ms); unexplored branches are valued where they stand.`, { limit: Date.now() > deadline ? 'maxMs' : 'sequenceCalls' });
        exact = false;
        done.push({ ...fr, stopped: 'budget' });
        continue;
      }
      calls++;
      const r = exploreCore(ses, steps[i], { ...detail, pos: fr.pos, retain: true, noKeys: true, observations: false, maxMs: Math.max(50, Math.min(ses.limits.maxCallMs, deadline - Date.now())) });
      if (!r.ok) {
        if (onIllegal === 'fail') {
          failure = fail(r.code === 'timeout' ? 'timeout' : 'illegal', `Step ${i + 1} cannot be played in a branch (p=${fr.p.toPrecision(3)}): ${r.message}`, { step: i, branchP: fr.p, reason: r.code });
          break;
        }
        st.illegalMass += fr.p;
        done.push({ ...fr, stopped: `step ${i + 1}: ${r.code}` });
        continue;
      }
      st.expandedMass += fr.p;
      if (!r.exact) exact = false;
      for (const oc of r.outcomes) {
        if (!oc.state) {
          exact = false; // the continuation of this outcome is not followed: the result says so
          // Not kept (more than maxKeep groups): value it where it stands by treating it as a final, stateless leaf.
          done.push({ p: fr.p * oc.p, pos: { ...fr.pos, state: fr.pos.state }, depth: i + 1, via: [...fr.via, `${steps[i].kind}`], turnover: oc.turnover, touchdown: oc.touchdown, stopped: 'no-state' });
          continue;
        }
        next.push({ p: fr.p * oc.p, pos: { key: '', state: oc.state, driveOver: !!oc.touchdown, depth: fr.pos.depth + 1, parent: fr.pos.key, via: null }, depth: i + 1, via: [...fr.via, `${steps[i].kind}`], turnover: oc.turnover, touchdown: oc.touchdown });
      }
      if (r.rest.p > 1e-9) done.push({ p: fr.p * r.rest.p, pos: fr.pos, depth: i, via: fr.via, turnover: false, touchdown: null, stopped: 'rest' });
    }
    stepStats.push(st);
    if (failure) return failure;
    // Keep the most likely nodes per step within a node budget (the rest are valued where they stand).
    next.sort((a, b) => b.p - a.p);
    const cap = 200;
    if (next.length > cap) {
      exact = false;
      ses.noteOnce('sequence', 'truncated', `sequence follows the ${cap} most likely branches per step (${next.length} arose); the rest are valued where they stand.`, { limit: 'sequenceBranches', max: cap, value: next.length });
      for (const x of next.slice(cap)) done.push({ ...x, stopped: 'pruned' });
    }
    frontier = next.slice(0, cap);
  }
  for (const fr of frontier) done.push(fr);
  // Value and chances over all branch ends.
  let total = 0;
  let sumV = 0;
  const finals: Array<{ p: number; value: number; fr: Fr }> = [];
  for (const fr of done) {
    const v = evaluateState(ses, fr.pos.state, persp, fr.pos.driveOver || !!fr.touchdown, o.horizon === 'position' ? 'position' : 'root').total;
    total += fr.p;
    sumV += fr.p * v;
    if (fr.turnover) pTO += fr.p;
    if (fr.touchdown === persp) pTD += fr.p;
    else if (fr.touchdown) pOppTD += fr.p;
    finals.push({ p: fr.p, value: v, fr });
  }
  finals.sort((a, b) => b.p - a.p);
  const maxFinal = Math.round(clamp(o.maxFinal, 8, 0, limits.maxOutcomesPerCall));
  const out = finals.slice(0, maxFinal).map((x) => {
    const key = x.fr.pos.key !== '' && ses.positions.has(x.fr.pos.key) ? x.fr.pos.key : ses.addPosition(x.fr.pos.state, x.fr.pos.driveOver, start, 'sequence', 'sequence');
    return { key, p: x.p / (total || 1), value: x.value, turnover: x.fr.turnover, touchdown: x.fr.touchdown, stepsPlayed: x.fr.depth, endedBecause: x.fr.stopped ?? 'sequence-complete', ...(o.features === true ? { features: featuresOf(x.fr.pos.state, persp, x.fr.pos.driveOver) } : {}) };
  });
  const norm = total || 1;
  return {
    ok: true,
    errors: [],
    perspective: persp,
    activeTeam: activeAtStart,
    position: { key: start.key, depth: start.depth },
    value: sumV / norm,
    pTurnover: pTO / norm,
    pTouchdown: pTD / norm,
    pOpponentTouchdown: pOppTD / norm,
    exact,
    approximation: exact ? null : 'Some branches were cut (time, call or branch budget) or contain unexpanded mass; they are valued where they stand.',
    steps: steps.length,
    exploreCalls: calls,
    stepStats,
    finals: out,
    decisionPolicy: { mode: dpIn.own === 'builtin' && dpIn.opponent === 'builtin' ? 'builtin' : 'solved', own: dpIn.own, opponent: dpIn.opponent },
    elapsedMs: Date.now() - t0,
  };
}
