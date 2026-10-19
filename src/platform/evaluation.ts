/**
 * Evaluation services: the built-in evaluation of any position from either team's side (an optional baseline), and a
 * weight-free feature vector with a stable, versioned layout that a learned model can consume.
 *
 * Nothing here knows a coach's priorities: `features` are plain measurements (distances, counts, chances of the kind the
 * rules define) and `terms` are the built-in evaluation's named parts, always in the same order, zero-filled.
 */
import type { Coord, GameState, Player, TeamId } from '../engine/index';
import { E } from '../ai/engine';
import { chooseObjective } from '../ai/brain';
import { clockAdjusted, emphasise, evaluate, exposure, horizonFor, playerWorth, styleWeights, type Evaluation, type Horizon, type Weights } from '../ai/evaluate';
import type { EvalCfg, Position, Session } from './session';

export const TERM_NAMES = ['score', 'rerolls', 'players', 'opponents', 'marking', 'crowd', 'ball', 'progress', 'scoreThreat', 'support', 'carrierSafety', 'oppProgress', 'oppThreat', 'pressure', 'screen', 'looseBall'] as const;
export const FEATURE_SCHEMA_VERSION = 'features/1';

/** Evaluation weights as the built-in computes them at the request's position for `team` (balanced defaults, the objective's emphasis, the match clock). */
export function evalCfgFor(ses: Session, team: TeamId): EvalCfg {
  let c = ses.evalCache.get(team);
  if (!c) {
    E.usePitch(ses.root);
    const obj = chooseObjective(ses.root, team, 'balanced');
    c = { w: clockAdjusted(emphasise(styleWeights('balanced'), obj.id), ses.root, team), hz: horizonFor(ses.root, team), objective: obj.id };
    ses.evalCache.set(team, c);
  }
  return c;
}

export type HorizonMode = 'root' | 'position';

/** The built-in evaluation of a stored position. `horizon: 'root'` (default, as V5.5.1) keeps the request's Turn horizon; 'position' recomputes it from that position's Turn counters. */
export function evaluatePosition(ses: Session, pos: Position, team: TeamId, horizon: HorizonMode = 'root'): Evaluation {
  const c = evalCfgFor(ses, team);
  E.usePitch(ses.root);
  const hz: Horizon = horizon === 'position' ? horizonFor(pos.state, team) : c.hz;
  return evaluate(pos.state, team, c.w, hz, pos.driveOver);
}

export function evaluateState(ses: Session, state: GameState, team: TeamId, driveOver: boolean, horizon: HorizonMode = 'root'): Evaluation {
  const c = evalCfgFor(ses, team);
  const hz = horizon === 'position' ? horizonFor(state, team) : c.hz;
  return evaluate(state, team, c.w, hz, driveOver);
}

export function fullTerms(terms: Record<string, number>): Record<string, number> {
  const o: Record<string, number> = {};
  for (const k of TERM_NAMES) o[k] = terms[k] ?? 0;
  // A future term the layout does not list yet is kept after the stable ones, never dropped.
  for (const k of Object.keys(terms)) if (!(k in o)) o[k] = terms[k];
  return o;
}

const cheb = (a: Coord, b: Coord) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

function reachChance(need: number, ma: number): number {
  if (need <= ma) return 1;
  if (need === ma + 1) return 5 / 6;
  if (need === ma + 2) return 25 / 36;
  return 0;
}

export const FEATURE_NAMES: string[] = [
  // clock and score (self = the perspective team)
  'scoreSelf', 'scoreOpp', 'scoreDiff', 'half', 'turnsPerHalf', 'turnSelf', 'turnOpp', 'turnsLeftSelf', 'turnsLeftOpp', 'activeIsSelf', 'driveOver',
  'rerollsSelf', 'rerollsOpp',
  // people
  'standingSelf', 'proneSelf', 'stunnedSelf', 'reservesSelf', 'koSelf', 'casSelf', 'standingOpp', 'proneOpp', 'stunnedOpp', 'reservesOpp', 'koOpp', 'casOpp',
  'worthSelf', 'worthOpp', 'markedSelf', 'markedOpp', 'crowdExposedSelf', 'crowdExposedOpp',
  // ball
  'ballSelf', 'ballOpp', 'ballLoose', 'ballNone',
  // own carrier
  'carrierGoalDist', 'carrierMa', 'carrierMarkers', 'carrierCageOrth', 'carrierCageDiag', 'carrierOnEdge', 'carrierEdgeDist', 'carrierEndZoneChance', 'carrierStanding', 'exposureP', 'exposureN',
  // their carrier
  'oppCarrierGoalDist', 'oppCarrierMa', 'oppCarrierMarkers', 'oppCarrierReachers', 'oppCarrierEndZoneChance', 'oppCarrierOnEdge',
  // loose ball
  'looseDistSelf', 'looseDistOpp', 'looseProgressSelf',
];

export interface FeatureVector {
  schema: string;
  names: string[];
  values: number[];
  perspective: TeamId;
}

/** The weight-free feature vector of `state` for `team` (see FEATURE_NAMES; stable order, additions only at the end of a minor release). */
export function featuresOf(state: GameState, team: TeamId, driveOver = false): FeatureVector {
  E.usePitch(state);
  const opp: TeamId = team === 'A' ? 'B' : 'A';
  const tph = E.rulesFor(state).turnsPerHalf;
  const W = E.pitch().w;
  const H = E.pitch().h;
  const goal = (t: TeamId) => (t === 'A' ? W - 1 : 0);
  const dGoal = (t: TeamId, c: Coord) => Math.abs(goal(t) - c.x);
  const f: Record<string, number> = {};
  const set = (k: string, v: number) => {
    f[k] = Number.isFinite(v) ? v : 0;
  };
  set('scoreSelf', state.teams[team].score);
  set('scoreOpp', state.teams[opp].score);
  set('scoreDiff', state.teams[team].score - state.teams[opp].score);
  set('half', state.match?.half ?? 1);
  set('turnsPerHalf', tph);
  set('turnSelf', state.teams[team].turn);
  set('turnOpp', state.teams[opp].turn);
  set('turnsLeftSelf', Math.max(0, tph - state.teams[team].turn));
  set('turnsLeftOpp', Math.max(0, tph - state.teams[opp].turn));
  set('activeIsSelf', state.turn.active === team ? 1 : 0);
  set('driveOver', driveOver ? 1 : 0);
  set('rerollsSelf', state.teams[team].rerolls);
  set('rerollsOpp', state.teams[opp].rerolls);
  const up = (p: Player) => p.location === 'pitch' && p.stance === 'standing' && !!p.pos;
  const count = (t: TeamId, pred: (p: Player) => boolean) => state.players.filter((p) => p.team === t && pred(p)).length;
  for (const [t, suf] of [[team, 'Self'], [opp, 'Opp']] as Array<[TeamId, string]>) {
    set(`standing${suf}`, count(t, (p) => p.location === 'pitch' && p.stance === 'standing'));
    set(`prone${suf}`, count(t, (p) => p.location === 'pitch' && p.stance === 'prone'));
    set(`stunned${suf}`, count(t, (p) => p.location === 'pitch' && p.stance === 'stunned'));
    set(`reserves${suf}`, count(t, (p) => p.location === 'reserves'));
    set(`ko${suf}`, count(t, (p) => p.location === 'ko'));
    set(`cas${suf}`, count(t, (p) => p.location === 'cas' || p.location === 'sentOff'));
    set(`worth${suf}`, state.players.filter((p) => p.team === t && up(p)).reduce((a, p) => a + playerWorth(p), 0));
    set(`marked${suf}`, count(t, (p) => up(p) && E.markersOf(state, p.pos as Coord, t).length > 0));
    let ce = 0;
    for (const p of state.players) {
      if (p.team !== t || !up(p)) continue;
      const c = p.pos as Coord;
      if (c.x !== 0 && c.x !== W - 1 && c.y !== 0 && c.y !== H - 1) continue;
      if (E.crowdPushSquares(state, p).length) ce++;
    }
    set(`crowdExposed${suf}`, ce);
  }
  const b = state.ball;
  const holder = b.kind === 'held' ? state.players.find((p) => p.id === b.playerId) : undefined;
  set('ballSelf', holder?.team === team ? 1 : 0);
  set('ballOpp', holder && holder.team === opp ? 1 : 0);
  set('ballLoose', b.kind === 'ground' ? 1 : 0);
  set('ballNone', b.kind === 'none' ? 1 : 0);
  if (holder && holder.pos && holder.location === 'pitch') {
    const mine = holder.team === team;
    const c = holder.pos;
    const atkTeam = holder.team;
    const dg = dGoal(atkTeam, c);
    const edgeDist = Math.min(c.y, H - 1 - c.y);
    const onEdge = c.x === 0 || c.x === W - 1 || c.y === 0 || c.y === H - 1 ? 1 : 0;
    if (mine) {
      set('carrierGoalDist', dg);
      set('carrierMa', holder.ma);
      set('carrierMarkers', E.markersOf(state, c, team).length);
      let orth = 0;
      let diag = 0;
      for (const q of state.players) {
        if (q.team !== team || q.id === holder.id || !up(q) || cheb(q.pos as Coord, c) !== 1) continue;
        if ((q.pos as Coord).x !== c.x && (q.pos as Coord).y !== c.y) diag++;
        else orth++;
      }
      set('carrierCageOrth', orth);
      set('carrierCageDiag', diag);
      set('carrierOnEdge', onEdge);
      set('carrierEdgeDist', edgeDist);
      set('carrierEndZoneChance', reachChance(dg, holder.ma));
      set('carrierStanding', holder.stance === 'standing' ? 1 : 0);
      if (!driveOver && holder.stance === 'standing') {
        const ex = exposure(state, team, holder);
        set('exposureP', ex.p);
        set('exposureN', ex.n);
      }
    } else {
      set('oppCarrierGoalDist', dg);
      set('oppCarrierMa', holder.ma);
      set('oppCarrierMarkers', E.markersOf(state, c, opp).length);
      set('oppCarrierReachers', state.players.filter((q) => q.team === team && up(q) && cheb(q.pos as Coord, c) > 1 && cheb(q.pos as Coord, c) - 1 <= q.ma + 2).length);
      set('oppCarrierEndZoneChance', reachChance(dg, holder.ma));
      set('oppCarrierOnEdge', onEdge);
    }
  }
  if (b.kind === 'ground') {
    const dist = (t: TeamId) => Math.min(99, ...state.players.filter((p) => p.team === t && up(p)).map((p) => cheb(p.pos as Coord, b.pos)));
    set('looseDistSelf', dist(team));
    set('looseDistOpp', dist(opp));
    set('looseProgressSelf', W - 1 - dGoal(team, b.pos));
  }
  for (const k of FEATURE_NAMES) if (!(k in f)) f[k] = 0;
  return { schema: FEATURE_SCHEMA_VERSION, names: FEATURE_NAMES.slice(), values: FEATURE_NAMES.map((k) => f[k]), perspective: team };
}

export type { Evaluation, Weights, Horizon };
