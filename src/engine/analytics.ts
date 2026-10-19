/**
 * V7-09: match analytics MEASURED from a game state and its recorded log. Pure engine code: no AI, no dice, no future information.
 *
 * What is here are counts and positions (what has happened and where things are). It deliberately contains NO win probability:
 * a probability needs a sampling estimator with a stated sample count and an uncertainty, which this module does not pretend to be
 * (`outlook` says so explicitly). Hosts that add an estimate must label it with its method and sample count.
 */
import { scoringEndZoneX } from './board';
import { ballHolder, isMarked } from './state';
import type { ActionType, GameState, TeamId } from './types';

export const ANALYTICS_SCHEMA = 'match-analytics/1';
const TEAMS: TeamId[] = ['A', 'B'];

export interface TeamStats { score: number; standing: number; prone: number; stunned: number; reserves: number; ko: number; casualties: number; sentOff: number; marked: number; rerolls: number }
export interface ActivityStats { actions: Record<ActionType, number>; blocks: number; turnovers: number; touchdowns: number }
export interface MatchAnalytics {
  schema: typeof ANALYTICS_SCHEMA;
  phase: string;
  half: number;
  turn: Record<TeamId, number>;
  active: TeamId;
  possession: TeamId | null;
  ballLoose: boolean;
  /** Squares from the ball carrier to the end zone its team scores in (null when nobody carries the ball). */
  carrierGoalDistance: number | null;
  teams: Record<TeamId, TeamStats>;
  activity: Record<TeamId, ActivityStats>;
  /** How much recorded history these counts are based on. */
  basis: { entries: number };
  /** Always unavailable here: see the module comment. */
  outlook: { available: false; reason: string };
}

const emptyActions = (): Record<ActionType, number> => ({ move: 0, blitz: 0, block: 0, pass: 0, handoff: 0, secure: 0, foul: 0, ttm: 0, special: 0 });

export function matchAnalytics(s: GameState): MatchAnalytics {
  const teams = {} as Record<TeamId, TeamStats>;
  const activity = {} as Record<TeamId, ActivityStats>;
  for (const t of TEAMS) {
    const mine = s.players.filter((p) => p.team === t);
    const onPitch = mine.filter((p) => p.location === 'pitch');
    teams[t] = {
      score: s.teams[t].score,
      standing: onPitch.filter((p) => p.stance === 'standing').length,
      prone: onPitch.filter((p) => p.stance === 'prone').length,
      stunned: onPitch.filter((p) => p.stance === 'stunned').length,
      reserves: mine.filter((p) => p.location === 'reserves').length,
      ko: mine.filter((p) => p.location === 'ko').length,
      casualties: mine.filter((p) => p.location === 'cas').length,
      sentOff: mine.filter((p) => p.location === 'sentOff').length,
      marked: onPitch.filter((p) => p.stance === 'standing' && isMarked(s, p)).length,
      rerolls: s.teams[t].rerolls,
    };
    activity[t] = { actions: emptyActions(), blocks: 0, turnovers: 0, touchdowns: 0 };
  }
  for (const e of s.log) {
    const a = activity[e.team];
    if (!a) continue;
    const input = e.input as { kind?: string; action?: ActionType };
    if (input.kind === 'playerAction' && input.action && input.action in a.actions) a.actions[input.action]++;
    if (e.outcome === 'turnover') a.turnovers++;
    if (e.outcome === 'touchdown') a.touchdowns++;
  }
  for (const t of TEAMS) activity[t].blocks = activity[t].actions.block + activity[t].actions.blitz;
  const holder = ballHolder(s);
  const goal = holder?.pos ? Math.abs(scoringEndZoneX(holder.team) - holder.pos.x) : null;
  return {
    schema: ANALYTICS_SCHEMA, phase: s.phase, half: s.match?.half ?? s.turn.half, turn: { A: s.teams.A.turn, B: s.teams.B.turn }, active: s.turn.active,
    possession: holder ? holder.team : null, ballLoose: s.ball.kind === 'ground', carrierGoalDistance: goal,
    teams, activity, basis: { entries: s.log.length },
    outlook: { available: false, reason: 'These are measured counts, not predictions. A win-chance figure needs a sampling estimator with a stated sample count and uncertainty: hosts offer it only as an optional, separately labelled policy-conditioned estimate (src/platform/win-estimate.ts), never inside these counts.' },
  };
}
