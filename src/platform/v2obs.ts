/**
 * AI API v2: the versioned, complete public observation, and the factual public-event increments / execution receipts.
 *
 * Everything is public information of the match as a coach at the table sees it. Resources that do not exist, are
 * used up, or that this build does not model are distinguished (`status`), never encoded as 0. Nothing here reveals
 * the dice generator, its seed/counter or any future die, and nothing infers the opponent's intentions: increments are
 * what the engine recorded.
 */
import type { ActionInput, GameEvent, GameState, LogEntry, TeamId } from '../engine/index';
import { BUILD_FINGERPRINT } from '../engine/index';
import { E } from '../ai/engine';
import { observe, revisionOf, type Observation } from './observe';

export const OBSERVATION_SCHEMA = 'bloodboard-observation/2';
export const RECEIPT_SCHEMA = 'bloodboard-receipt/1';
export const API_V2 = { apiVersion: 2, apiMinor: 0 } as const;

export type ResourceStatus = 'available' | 'used' | 'exhausted' | 'unavailable' | 'unknown' | 'unsupported';
export interface Resource {
  status: ResourceStatus;
  /** Number remaining, when the resource is countable. */
  count?: number;
  note?: string;
}

export interface PublicEvent {
  type: string;
  text: string;
  rule?: { page: number; title: string };
  dice?: Array<{ kind: string; faces: number[]; block?: string[] }>;
}
export interface PublicEntry {
  /** Index in the match history (stable: the history only grows, except through Undo, which resets the increment cursor). */
  index: number;
  team: TeamId;
  turn: number;
  title: string;
  input: { kind: string; playerId?: string; action?: string; special?: string };
  events: PublicEvent[];
  decisions: Array<{ requestId: string; optionId: string; label: string; team: TeamId }>;
  outcome: LogEntry['outcome'];
}

const pubEvent = (e: GameEvent): PublicEvent => {
  const o: PublicEvent = { type: e.type, text: e.text };
  if (e.rule) o.rule = { page: e.rule.page, title: e.rule.title };
  if (e.dice?.length) o.dice = e.dice.map((d) => ({ kind: d.kind, faces: d.faces.slice(), ...(d.block ? { block: d.block.slice() } : {}) }));
  return o;
};

export function publicEntries(s: GameState, since: number): PublicEntry[] {
  const out: PublicEntry[] = [];
  for (let i = Math.max(0, since); i < s.log.length; i++) {
    const l = s.log[i];
    const inp = l.input as { kind: string; playerId?: string; action?: string; special?: string };
    out.push({ index: i, team: l.team, turn: l.turn, title: l.title, input: { kind: inp.kind, ...(inp.playerId ? { playerId: inp.playerId } : {}), ...(inp.action ? { action: inp.action } : {}), ...(inp.special ? { special: inp.special } : {}) }, events: l.events.map(pubEvent), decisions: l.decisions.map((d) => ({ requestId: d.requestId, optionId: d.optionId, label: d.label, team: d.team })), outcome: l.outcome });
  }
  return out;
}

/** What the host returns to the coach (and keeps in the decision log) after an answer was applied. */
export interface ExecutionReceipt {
  schema: typeof RECEIPT_SCHEMA;
  requestId: number | null;
  accepted: boolean;
  /** The input the host executed (the coach's, validated — or the built-in fallback's, said so in `source`). */
  input: ActionInput | null;
  source: { coach: string; via: string; fellBack: boolean; reason: string | null };
  /** Revision of the position the answer was for, and after it. */
  revisionBefore: string;
  revisionAfter: string;
  historyFrom: number;
  historyTo: number;
  /** Public facts only: what the engine recorded for this execution. */
  entries: PublicEntry[];
  outcome: LogEntry['outcome'] | null;
  scoreAfter: { A: number; B: number };
  error?: string;
}

export function receipt(before: GameState, after: GameState, p: { requestId: number | null; input: ActionInput | null; coach: string; via: string; fellBack: boolean; reason: string | null; error?: string }): ExecutionReceipt {
  const entries = publicEntries(after, before.log.length);
  const last = entries[entries.length - 1];
  return {
    schema: RECEIPT_SCHEMA,
    requestId: p.requestId,
    accepted: !p.error && entries.length > 0,
    input: p.input,
    source: { coach: p.coach, via: p.via, fellBack: p.fellBack, reason: p.reason },
    revisionBefore: revisionOf(before),
    revisionAfter: revisionOf(after),
    historyFrom: before.log.length,
    historyTo: after.log.length,
    entries,
    outcome: last ? last.outcome : null,
    scoreAfter: { A: after.teams.A.score, B: after.teams.B.score },
    ...(p.error ? { error: p.error } : {}),
  };
}

const res = (status: ResourceStatus, count?: number, note?: string): Resource => ({ status, ...(count !== undefined ? { count } : {}), ...(note ? { note } : {}) });

function resources(s: GameState, t: TeamId) {
  const x = s.teams[t];
  const inds = s.match?.inducements?.[t] ?? {};
  const used = x.induceUsed ?? {};
  const act = s.turn.active === t;
  return {
    teamRerolls: x.rerolls > 0 ? res('available', x.rerolls) : res('exhausted', 0),
    bonusRerolls: x.bonusRerolls ? res('available', x.bonusRerolls, 'expires at the end of the Drive; used first') : res('unavailable'),
    leaderReroll: x.leaderReroll ? res('available', 1) : res('unavailable', 0, 'no Leader re-roll this half'),
    mascotReroll: x.mascotReroll ? res('available', 1) : res('unavailable'),
    apothecary: x.apothecary === 'available' ? res('available', 1) : x.apothecary === 'used' ? res('used', 0) : res('unavailable'),
    bribes: s.match ? (s.match.bribes?.[t] ? res('available', s.match.bribes[t]) : (inds.bribe ? res('exhausted', 0) : res('unavailable'))) : res('unknown', undefined, 'no match-level inducements in this position'),
    wizard: res(s.match && (inds.wizard || inds.sportsWizard) ? (used.wizard || used.sportsWizard ? 'used' : 'available') : 'unavailable'),
    turnWindow: {
      blitz: act ? res(s.turn.used.blitz ? 'used' : 'available') : res('unavailable', undefined, 'not this team\'s Turn'),
      pass: act ? res(s.turn.used.pass ? 'used' : 'available') : res('unavailable', undefined, 'not this team\'s Turn'),
      handoff: act ? res(s.turn.used.handoff ? 'used' : 'available') : res('unavailable', undefined, 'not this team\'s Turn'),
      foul: act ? res(s.turn.used.foul ? 'used' : 'available') : res('unavailable', undefined, 'not this team\'s Turn'),
      secure: act ? res(s.turn.used.secure ? 'used' : 'available') : res('unavailable', undefined, 'not this team\'s Turn'),
      ttm: act ? res(s.turn.used.ttm ? 'used' : 'available') : res('unavailable', undefined, 'not this team\'s Turn'),
      bomb: act ? res(s.turn.used.bomb ? 'used' : 'available') : res('unavailable', undefined, 'not this team\'s Turn'),
      punt: act ? res(s.turn.used.punt ? 'used' : 'available') : res('unavailable', undefined, 'not this team\'s Turn'),
      ktm: act ? res(s.turn.used.ktm ? 'used' : 'available') : res('unavailable', undefined, 'not this team\'s Turn'),
    },
    stars: res('unknown', undefined, 'per-Star once-per-game abilities are reported in each player\'s `usage`'),
  };
}

export interface ObsV2Context {
  /** Public history index the coach has already seen (events since then are attached as `sinceLast`). */
  sinceLog?: number;
  matchId?: string;
}

/** Observation v2: the v1 observation (every v1 field unchanged) plus the versioned, complete public additions. */
export function observeV2(s: GameState, team: TeamId, requestId: number, c: ObsV2Context = {}): Observation & Record<string, unknown> {
  const v1 = observe(s, team, requestId);
  E.usePitch(s);
  const R = E.rulesFor(s);
  const g = R.pitch;
  const since = c.sinceLog !== undefined ? Math.min(c.sinceLog, s.log.length) : s.log.length;
  return {
    ...v1,
    apiVersion: API_V2.apiVersion,
    apiMinor: API_V2.apiMinor,
    schemaVersion: OBSERVATION_SCHEMA,
    engineVersion: BUILD_FINGERPRINT.version,
    engine: { version: BUILD_FINGERPRINT.version, engineHash: BUILD_FINGERPRINT.engineHash, rulesHash: BUILD_FINGERPRINT.rulesHash, apiHash: BUILD_FINGERPRINT.apiHash },
    ruleset: { rulesEdition: v1.rulesEdition, id: R.variant === 'sevens' ? 'bb-sevens' : 'bb-standard', hash: BUILD_FINGERPRINT.rulesHash, format: R.variant === 'sevens' ? 'sevens' : 'standard', variant: s.variant ?? 'standard', rules: s.match?.options ? JSON.parse(JSON.stringify(s.match.options)) : null },
    match: { matchId: s.match?.matchId ?? null, kind: s.match?.kind ?? null, mirror: !!s.match?.mirror, half: s.match?.half ?? 1, drive: s.match ? s.match.drive : null, stateRevision: revisionOf(s), historyLength: s.log.length },
    // `width/height` (v1) and `w/h` (the published schema's names) are both present, so neither reading breaks.
    pitch: { width: g.w, height: g.h, w: g.w, h: g.h, wideRows: g.wide, endZone: { A: g.w - 1, B: 0 }, losColumn: { A: E.losColumn('A'), B: E.losColumn('B') } },
    resources: { A: resources(s, 'A'), B: resources(s, 'B') },
    sinceLast: { from: since, to: s.log.length, entries: publicEntries(s, since) },
  } as Observation & Record<string, unknown>;
}
