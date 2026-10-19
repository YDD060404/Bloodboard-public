/**
 * V6 pre-match lifecycle: roster choice and team construction, for the built-in coach and for API v2 coaches.
 *
 *  - The built-in baseline always exists (engine/lifecycle.ts) and is the explicit fallback of every stage.
 *  - A coach module is asked only if its negotiated capabilities say it implements the hook.
 *  - Whatever a coach proposes is validated by the ENGINE (`validateBuild` = validateTeamDef): violations come back as
 *    structured objects and the coach gets a bounded number of correction attempts; if they are used up the built-in builder
 *    answers and the report says so. A coach's failed build is never silently replaced by a saved team.
 *  - Every stage returns a report (who answered, attempts, violations, fallback reason, time) for the match record.
 */
import { E } from '../ai/engine';
import type { CoachEntry } from '../ai/index';
import type { BuildFormat, RosterChoice, TeamDef, Violation } from '../engine/index';
import { BUILD_FINGERPRINT } from '../engine/index';
import { DEFAULT_LIMITS, type Limits } from './limits';
import { HARNESS } from './harness';
import { runModule, type Spawn } from './host';
import { Session } from './session';

export type Play = 'exhibition' | 'tournament';
export type RosterMode = 'blind' | 'sequential';

export interface StageReport {
  stage: 'roster' | 'build';
  /** Who produced the answer that was used. */
  via: 'coach' | 'builtin';
  coach: string;
  fellBack: boolean;
  reason: string | null;
  attempts: number;
  /** Engine violations of each rejected attempt (empty when the first answer was legal). */
  rejected: Violation[][];
  elapsedMs: number;
  why: string | null;
}

export interface LifecycleDeps {
  spawn: Spawn;
  limits?: Limits;
  note?: (why: string) => void;
  stale?: () => boolean;
}

let hookSeq = 9_000_000;

function prematchObservation(requestId: number, stage: 'roster' | 'build', extra: Record<string, unknown>) {
  return { apiVersion: 2, apiMinor: 0, schemaVersion: 'bloodboard-prematch/1', requestId, phase: 'prematch', stage, engine: { version: BUILD_FINGERPRINT.version, engineHash: BUILD_FINGERPRINT.engineHash, rulesHash: BUILD_FINGERPRINT.rulesHash, apiHash: BUILD_FINGERPRINT.apiHash }, ...extra };
}

async function ask(deps: LifecycleDeps, entry: CoachEntry, type: 'roster' | 'build', request: Record<string, unknown>, observation: Record<string, unknown>) {
  const limits = deps.limits ?? DEFAULT_LIMITS;
  const requestId = hookSeq++;
  // The services need a position; before the match there is none, so they get an empty practice position (they are of no use here, and say so).
  const ses = new Session(E.newGame({ seed: 1 }), 'A', requestId, Number(entry.timeLimitMs) || limits.defaultModuleMs, limits);
  ses.restartClock();
  void HARNESS;
  return runModule(deps.spawn, entry.code as string, { type, requestId, observation: { ...observation, requestId }, request }, ses, undefined, undefined, deps.stale);
}

const hasHook = (e: CoachEntry | null | undefined, k: 'chooseRoster' | 'buildTeam') => !!e && e.kind === 'strategy' && (e as { apiGeneration?: number }).apiGeneration === 2 && !!e.capabilities?.[k] && !!e.code;

export interface RosterRequest {
  format: BuildFormat;
  play: Play;
  budget?: number;
  mode: RosterMode;
  /** Sequential mode: the roster the other side has already chosen (null for the first chooser; absent in blind mode). */
  opponentRoster?: string | null;
  rosters: ReturnType<typeof E.rosterInfos>;
}

export async function chooseRoster(deps: LifecycleDeps, a: { format: BuildFormat; play: Play; budget?: number; mode: RosterMode; opponentRoster?: string | null; entry?: CoachEntry | null; deterministic?: boolean; rand?: () => number }): Promise<{ choice: RosterChoice; report: StageReport }> {
  const t0 = Date.now();
  const builtin = (reason: string | null, why?: string): { choice: RosterChoice; report: StageReport } => {
    const choice = E.chooseRosterBuiltin({ format: a.format, play: a.play, budget: a.budget, deterministic: a.deterministic, rand: a.rand, opponent: a.mode === 'sequential' ? a.opponentRoster : null });
    return { choice, report: { stage: 'roster', via: 'builtin', coach: 'built-in', fellBack: !!reason, reason, attempts: 0, rejected: [], elapsedMs: Date.now() - t0, why: why ?? choice.why } };
  };
  if (!hasHook(a.entry, 'chooseRoster')) return builtin(null);
  const entry = a.entry as CoachEntry;
  const request: RosterRequest = { format: a.format, play: a.play, budget: a.budget, mode: a.mode, ...(a.mode === 'sequential' ? { opponentRoster: a.opponentRoster ?? null } : {}), rosters: E.rosterInfos(a.format, a.play, a.budget) };
  const r = await ask(deps, entry, 'roster', request as unknown as Record<string, unknown>, prematchObservation(0, 'roster', { format: a.format, play: a.play, mode: a.mode }));
  const fall = (why: string) => {
    deps.note?.(`${entry.name}: ${why} The built-in roster choice was used.`);
    return builtin(why);
  };
  if (r.error) return fall(r.error);
  const ans = r.result as { rosterId?: unknown; league?: unknown; favoured?: unknown; why?: unknown } | null;
  if (!ans || typeof ans.rosterId !== 'string') return fall('no roster answer ({ rosterId }).');
  const info = request.rosters.find((x) => x.id === ans.rosterId);
  if (!info) return fall(`unknown roster "${ans.rosterId}".`);
  if (!info.draftable) return fall(`the roster ${info.name} cannot be drafted for this format and budget.`);
  const ros = E.ROSTER_BY_ID[info.id];
  const choice: RosterChoice = { rosterId: info.id, ...(ros.leagues.length > 1 ? { league: typeof ans.league === 'string' && ros.leagues.includes(ans.league) ? ans.league : ros.leagues[0] } : {}), ...(ros.favouredOf ? { favoured: typeof ans.favoured === 'string' && ros.favouredOf.includes(ans.favoured) ? ans.favoured : undefined } : {}), why: typeof ans.why === 'string' ? ans.why.slice(0, 300) : `${entry.name} chose ${info.name}.` };
  return { choice, report: { stage: 'roster', via: 'coach', coach: entry.id, fellBack: false, reason: null, attempts: 1, rejected: [], elapsedMs: Date.now() - t0, why: choice.why } };
}

export interface BuildRequest {
  rosterId: string;
  format: BuildFormat;
  play: Play;
  budget: number;
  roster: ReturnType<typeof E.rosterInfos>[number];
  /** Template limits of the format (players, re-rolls, staff). */
  template: Record<string, unknown>;
  /** What the built-in builder would draft (a legal reference). */
  builtinTeam: TeamDef | null;
  /** Correction attempts: 1-based, with the engine's violations of the previous answer. */
  attempt?: number;
  previousViolations?: Violation[];
}

export const BUILD_ATTEMPTS = 3;

export async function buildTeamFor(deps: LifecycleDeps, a: { rosterId: string; league?: string; favoured?: string; format: BuildFormat; play: Play; budget?: number; tier?: import('../engine/index').Tier; id: string; name?: string; entry?: CoachEntry | null; maxAttempts?: number }): Promise<{ team: TeamDef; report: StageReport }> {
  const t0 = Date.now();
  const opts = { format: a.format, play: a.play, budget: a.budget, ...(a.tier ? { tier: a.tier } : {}), id: a.id, name: a.name } as const;
  const ref = E.builtinTeam(a.rosterId, opts);
  const finish = (team: TeamDef, report: Omit<StageReport, 'stage' | 'elapsedMs'>) => ({ team, report: { stage: 'build' as const, elapsedMs: Date.now() - t0, ...report } });
  const builtin = (reason: string | null, attempts: number, rejected: Violation[][]) => {
    if (!ref) throw new Error(`The built-in builder cannot draft a ${a.rosterId} team for ${a.format}.`);
    const team = { ...ref, ...(a.league ? { league: a.league } : {}), ...(a.favoured ? { favoured: a.favoured } : {}) } as TeamDef;
    return finish(team, { via: 'builtin', coach: 'built-in', fellBack: !!reason, reason, attempts, rejected, why: 'Built-in draft: value per cost, a legal minimum team, re-rolls, staff.' });
  };
  if (!hasHook(a.entry, 'buildTeam')) return builtin(null, 0, []);
  const entry = a.entry as CoachEntry;
  const info = E.rosterInfos(a.format, a.play, a.budget).find((x) => x.id === a.rosterId);
  if (!info || !ref) return builtin(`roster ${a.rosterId} cannot be drafted here`, 0, []);
  const rejected: Violation[][] = [];
  const max = a.maxAttempts ?? BUILD_ATTEMPTS;
  let previous: Violation[] | undefined;
  for (let attempt = 1; attempt <= max; attempt++) {
    const request: BuildRequest = { rosterId: a.rosterId, format: a.format, play: a.play, budget: E.teamBudget(ref), roster: info, template: (a.format === 'sevens' ? E.SEVENS_DRAFT : E.DRAFT_TEMPLATE) as unknown as Record<string, unknown>, builtinTeam: ref, ...(previous ? { attempt, previousViolations: previous } : {}) };
    const r = await ask(deps, entry, 'build', request as unknown as Record<string, unknown>, prematchObservation(0, 'build', { format: a.format, play: a.play, rosterId: a.rosterId, attempt }));
    if (r.error) {
      deps.note?.(`${entry.name}: ${r.error} The built-in builder drafted this team.`);
      return builtin(r.error, attempt, rejected);
    }
    const ans = r.result as { team?: unknown; why?: unknown } | null;
    if (!ans || !ans.team || typeof ans.team !== 'object') {
      const why = 'no team answer ({ team: <bloodboard-team> }).';
      return builtin(why, attempt, rejected);
    }
    const parsed = E.parseTeamDef(JSON.stringify(ans.team));
    if (!parsed.ok) {
      previous = parsed.errors.map((text) => ({ level: 'error' as const, code: 'shape', text }));
      rejected.push(previous);
      continue;
    }
    const team = parsed.team;
    team.id = a.id;
    if (a.name) team.name = a.name;
    const v = E.validateBuild(team, { format: a.format, rosterId: a.rosterId });
    if (v.ok) return finish(team, { via: 'coach', coach: entry.id, fellBack: false, reason: null, attempts: attempt, rejected, why: typeof ans.why === 'string' ? ans.why.slice(0, 300) : `${entry.name} built this team.` });
    previous = v.violations.filter((x) => x.level === 'error');
    rejected.push(previous);
  }
  const why = `the engine rejected every one of ${max} attempts (${rejected[rejected.length - 1]?.[0]?.text ?? 'invalid'}).`;
  deps.note?.(`${entry.name}: ${why} The built-in builder drafted this team.`);
  return builtin(why, max, rejected);
}
