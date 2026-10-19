/**
 * The read-only observation a module receives (V5.6: complete). Everything in it is public information of the match as
 * a coach at the table sees it. It never contains the game state object, the dice generator, its seed or counter, or
 * any future dice; the `pending` decision shows dice that have already been rolled (Block dice faces), as the coach
 * sees them.
 *
 * API 1 fields (V5.5) keep their names, types and meaning; everything added in V5.6 is new keys.
 */
import type { ActionInput, Coord, DecisionOption, GameState, TeamId } from '../engine/index';
import { E } from '../ai/engine';
import { API_MINOR, API_VERSION } from './limits';

export interface ObservedPlayer {
  id: string;
  team: TeamId;
  number: number;
  position: string;
  ma: number;
  st: number;
  ag: number;
  pa: number | null;
  av: number;
  skills: string[];
  pos: { x: number; y: number } | null;
  stance: 'standing' | 'prone' | 'stunned';
  location: 'pitch' | 'reserves' | 'ko' | 'cas' | 'sentOff';
  activated: boolean;
  star?: string;
  // --- V5.6 ---
  name: string;
  keywords: string[];
  /** Standing without a Tackle Zone (p.39: Distracted, Hypnotised, Rooted …). Use `tackleZone` for the current answer. */
  distracted: boolean;
  /** This player exerts a Tackle Zone right now. */
  tackleZone: boolean;
  /** Can be activated now (for the team whose Turn it is): standing or prone, not yet activated, not blocked by a rule. */
  canBeActivated: boolean;
  rooted?: boolean;
  eyeGouged?: boolean;
  /** Per-Turn skill usage counters. */
  usage: Record<string, unknown>;
  mercenary?: boolean;
  journeyman?: boolean;
  captain?: boolean;
  benched?: boolean;
  veteran?: 'ready' | 'used';
  casualtyResult?: string;
}

export interface ObservedTeam {
  name: string;
  rosterId?: string;
  score: number;
  turn: number;
  rerolls: number;
  leaderReroll: boolean;
  bonusRerolls: number;
  mascotReroll: boolean;
  apothecary: 'available' | 'used' | 'none';
  specialRules: string[];
}

export interface ObservedActivation {
  playerId: string;
  action: string;
  blitzTarget?: string;
  maUsed: number;
  rushesUsed: number;
  blocksDone: number;
  ballActionDone: boolean;
  over: boolean;
  special?: string;
  bloodlust?: string;
  foulDone?: boolean;
  specialDone?: boolean;
}

export interface ObservedPending {
  requestId: string;
  type: string;
  team: TeamId;
  prompt: string;
  options: DecisionOption[];
  context: Record<string, unknown> | null;
}

export interface Observation {
  apiVersion: number;
  apiMinor: number;
  requestId: number;
  /** Changes whenever the game changes (log length, pending decision); answers for another revision are ignored. */
  revision: string;
  team: TeamId;
  format: 'standard' | 'sevens';
  /** Actual match rules: an absent stored edition uses the engine's legacy semantics. */
  rulesEdition?: 'legacy' | 'faq2026';
  phase: string;
  half: number;
  turn: { A: number; B: number };
  turnsPerHalf: number;
  score: { A: number; B: number };
  weather: string;
  rerolls: { A: number; B: number };
  ball: GameState['ball'];
  used: GameState['turn']['used'];
  players: ObservedPlayer[];
  // --- V5.6 ---
  pitch: { width: number; height: number; endZone: { A: number; B: number } };
  /** The team whose Turn it is (or who acts next in a Drive step). */
  active: TeamId;
  teams: Record<TeamId, ObservedTeam>;
  /** Team that kicks the current Drive (null when no Drive is running). */
  kicking: TeamId | null;
  drive: number | null;
  activation: ObservedActivation | null;
  /** A rule decision the game is waiting for (null when the game waits for a Turn action). */
  pending: ObservedPending | null;
  /** Between two Turns (nobody activated yet in the new Turn). */
  betweenTurns: boolean;
}

/** Identifies the position a request belongs to (log length, pending decision) — nothing derived from the dice generator. */
export const revisionOf = (s: GameState): string => `${s.log.length}:${s.pending?.request.id ?? '-'}:${s.pending?.decisions.length ?? 0}`;

const plain = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

export function observe(s: GameState, team: TeamId, requestId: number): Observation {
  E.usePitch(s);
  const p = E.pitch();
  const act = s.turn.activation;
  const req = s.pending?.request;
  return {
    apiVersion: API_VERSION,
    apiMinor: API_MINOR,
    requestId,
    revision: revisionOf(s),
    team,
    format: s.variant === 'sevens' ? 'sevens' : 'standard',
    rulesEdition: s.rulesEdition ?? 'legacy',
    phase: s.phase,
    half: s.match?.half ?? 1,
    turn: { A: s.teams.A.turn, B: s.teams.B.turn },
    turnsPerHalf: E.rulesFor(s).turnsPerHalf,
    score: { A: s.teams.A.score, B: s.teams.B.score },
    weather: s.weather,
    rerolls: { A: s.teams.A.rerolls, B: s.teams.B.rerolls },
    ball: plain(s.ball),
    used: plain(s.turn.used),
    players: s.players.map((q) => {
      const o: ObservedPlayer = {
        id: q.id,
        team: q.team,
        number: q.number,
        position: q.position,
        ma: q.ma,
        st: q.st,
        ag: q.ag,
        pa: q.pa,
        av: q.av,
        skills: q.skills.map((k) => (k.value ? `${k.id}(${k.value})` : k.id)),
        pos: q.pos ? { ...q.pos } : null,
        stance: q.stance,
        location: q.location,
        activated: q.activated,
        name: q.name,
        keywords: q.keywords.slice(),
        distracted: q.distracted,
        tackleZone: q.location === 'pitch' && !!q.pos && E.hasTackleZone(q),
        canBeActivated: s.phase === 'play' && !s.pending && q.team === s.turn.active && !E.activationBlockReason(s, q),
        usage: plain(q.usage ?? {}) as Record<string, unknown>,
      };
      if (q.star) o.star = q.star;
      if (q.rooted) o.rooted = true;
      if (q.eyeGouged) o.eyeGouged = true;
      if (q.mercenary) o.mercenary = true;
      if (q.journeyman) o.journeyman = true;
      if (q.captain) o.captain = true;
      if (q.benched) o.benched = true;
      if (q.veteran) o.veteran = q.veteran;
      if (q.casualtyResult) o.casualtyResult = q.casualtyResult;
      return o;
    }),
    pitch: { width: p.w, height: p.h, endZone: { A: p.w - 1, B: 0 } },
    active: s.turn.active,
    teams: { A: teamOf(s, 'A'), B: teamOf(s, 'B') },
    kicking: s.match?.kicking ?? null,
    drive: s.match ? s.match.drive : null,
    activation: act
      ? { playerId: act.playerId, action: act.action, blitzTarget: act.blitzTarget, maUsed: act.maUsed, rushesUsed: act.rushesUsed, blocksDone: act.blocksDone, ballActionDone: act.ballActionDone, over: act.over, special: act.special, bloodlust: act.bloodlust, foulDone: act.foulDone, specialDone: act.specialDone }
      : null,
    pending: req ? { requestId: req.id, type: req.type, team: req.team, prompt: req.prompt, options: plain(req.options), context: req.context ? plain(req.context) : null } : null,
    betweenTurns: !!s.turn.betweenTurns,
  };
}

function teamOf(s: GameState, t: TeamId): ObservedTeam {
  const x = s.teams[t];
  return {
    name: x.name,
    rosterId: x.rosterId,
    score: x.score,
    turn: x.turn,
    rerolls: x.rerolls,
    leaderReroll: !!x.leaderReroll,
    bonusRerolls: x.bonusRerolls ?? 0,
    mascotReroll: !!x.mascotReroll,
    apothecary: x.apothecary ?? 'none',
    specialRules: (x.specialRules ?? []).slice(),
  };
}

export const coordKey = (c: Coord) => `${c.x},${c.y}`;
export type { ActionInput };
