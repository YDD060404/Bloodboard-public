/**
 * Canonical match history (V7-06): ONE versioned format shared by the game, the Match Lab and (later) multiplayer.
 *
 *  - A history is self-contained: it stores the match's INITIAL state and the complete recorded log (inputs, decisions, every die).
 *  - It is verified by RE-EXECUTION with the authoritative engine (`verifyHistory`); the stored `result` and `identity` are claims
 *    that verification checks, never trusted by themselves.
 *  - It records the rules edition the match was played under. Old matches replay under their recorded rules; unknown editions or
 *    newer format versions are refused explicitly, never guessed.
 *  - It never carries seeds' future dice beyond what the log already shows, and no credentials. The RNG seed is stored because it
 *    is part of the match's identity (the recorded dice are already in the log).
 *  - Provenance of each side (human, built-in or a named coach with provider/model) is optional metadata, never rules input.
 */
import { BUILD_FINGERPRINT } from './fingerprint';
import { assessReplay, verifyLog } from './replay';
import type { GameState, LogEntry, TeamId } from './types';

export const HISTORY_FORMAT = 'bloodboard-history';
export const HISTORY_VERSION = 1;
export const HISTORY_BATCH_FORMAT = 'bloodboard-history-batch';
export type HistorySource = 'game' | 'lab' | 'multiplayer' | 'training';

export interface HistoryParticipant {
  name: string;
  roster: string;
  controller: { kind: 'human' | 'builtin' | 'coach'; coachId?: string; coachVersion?: string; provider?: string; model?: string };
}

export interface HistoryResult { score: { A: number; B: number }; winner: TeamId | 'draw' | null; completed: boolean; entries: number }

export interface HistoryFile {
  format: typeof HISTORY_FORMAT;
  version: typeof HISTORY_VERSION;
  /** Content identity: stable for the same seed, teams, rules edition and recorded inputs. Not an integrity guarantee. */
  id: string;
  source: HistorySource;
  title: string;
  createdAt: string;
  /** 'faq2026' or 'legacy' (a match started before the rules edition existed). */
  rulesEdition: string;
  engine: { version: string; engineHash: string; rulesHash: string; apiHash: string };
  variant: 'standard' | 'sevens';
  seed: number;
  participants: Record<TeamId, HistoryParticipant>;
  initial: GameState;
  log: LogEntry[];
  result: HistoryResult;
  /** How it was verified when written ('replay' = re-executed from `initial`). */
  verified: { method: 'replay'; ok: true; entries: number; at: string };
  extensions?: Record<string, unknown>;
}

export interface HistoryBatchFile {
  format: typeof HISTORY_BATCH_FORMAT;
  version: 1;
  id: string;
  label: string;
  createdAt: string;
  games: HistoryFile[];
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const EDITIONS = new Set(['faq2026', 'legacy']);
const editionOf = (s: GameState) => s.rulesEdition ?? 'legacy';

/** Deterministic 64-bit-ish content identity (two FNV-1a lanes). */
function identityOf(seed: number, edition: string, teams: string[], log: LogEntry[]): string {
  let a = 2166136261, b = 5381;
  const feed = (str: string) => { for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); a = Math.imul(a ^ c, 16777619) >>> 0; b = (Math.imul(b, 33) + c) >>> 0; } };
  feed(`${seed}|${edition}|${teams.join('/')}|${log.length}`);
  for (const e of log) feed(JSON.stringify([e.input, e.decisions.map((d) => d.optionId), e.outcome]));
  return `h-${a.toString(36)}${b.toString(36)}`;
}

export function resultOf(state: GameState): HistoryResult {
  const A = state.teams.A.score, B = state.teams.B.score;
  const completed = state.phase === 'fullTime';
  return { score: { A, B }, winner: !completed ? null : A === B ? 'draw' : A > B ? 'A' : 'B', completed, entries: state.log.length };
}

export interface ToHistoryOptions {
  source: HistorySource;
  /** The stored initial state when known (exact); otherwise it is reconstructed and verified. */
  initial?: GameState | null;
  participants?: Partial<Record<TeamId, Partial<HistoryParticipant>>>;
  createdAt?: string;
  extensions?: Record<string, unknown>;
}

/** Build a history from a played match. Fails (never guesses) when the log cannot be shown to reproduce the match. */
export function toHistory(state: GameState, opts: ToHistoryOptions): { ok: true; history: HistoryFile } | { ok: false; error: string } {
  if (!state.match) return { ok: false, error: 'This is a practice position, not a match: there is no match history to export.' };
  if (state.log.length === 0) return { ok: false, error: 'The match has no recorded history yet.' };
  const rep = assessReplay(state, opts.initial ?? null);
  if (!rep.initial || !rep.assessment.grade.startsWith('replayable')) return { ok: false, error: `The history does not reproduce under the current rules (${rep.assessment.reason})` };
  const mk = (t: TeamId): HistoryParticipant => ({ name: state.teams[t].name, roster: state.teams[t].rosterId, controller: { kind: 'human' }, ...(opts.participants?.[t] as object) } as HistoryParticipant);
  const edition = editionOf(state);
  const seed = state.rng.seed;
  const history: HistoryFile = {
    format: HISTORY_FORMAT, version: HISTORY_VERSION,
    id: identityOf(seed, edition, [state.teams.A.name, state.teams.B.name], state.log),
    source: opts.source, title: state.title ?? `${state.teams.A.name} vs ${state.teams.B.name}`, createdAt: opts.createdAt ?? new Date().toISOString(),
    rulesEdition: edition, engine: { version: BUILD_FINGERPRINT.version, engineHash: BUILD_FINGERPRINT.engineHash, rulesHash: BUILD_FINGERPRINT.rulesHash, apiHash: BUILD_FINGERPRINT.apiHash },
    variant: state.variant ?? 'standard', seed, participants: { A: mk('A'), B: mk('B') },
    initial: clone(rep.initial), log: clone(state.log), result: resultOf(state),
    verified: { method: 'replay', ok: true, entries: state.log.length, at: new Date().toISOString() },
    ...(opts.extensions ? { extensions: clone(opts.extensions) } : {}),
  };
  return { ok: true, history };
}

export type HistoryGrade = 'verified' | 'verified-other-rules-code' | 'refused';
export interface HistoryVerification { grade: HistoryGrade; reason: string; firstMismatch?: number; final?: GameState }

/** Re-execute the history with the authoritative engine and check the stored claims. Never mutates the history. */
export function verifyHistory(h: HistoryFile): HistoryVerification {
  if (!EDITIONS.has(h.rulesEdition)) return { grade: 'refused', reason: `Unsupported rules edition "${h.rulesEdition}": this build knows faq2026 and legacy and will not guess.` };
  const initEdition = editionOf(h.initial);
  if (initEdition !== h.rulesEdition) return { grade: 'refused', reason: `The stored initial state is edition "${initEdition}" but the history says "${h.rulesEdition}".` };
  const v = verifyLog(h.initial, h.log);
  if (!v.ok) return { grade: 'refused', reason: `The recorded history does not reproduce (entry ${(v.at ?? 0) + 1}: ${v.error}).`, firstMismatch: v.at };
  const fin = v.final as GameState;
  const r = resultOf(fin);
  if (r.score.A !== h.result.score.A || r.score.B !== h.result.score.B || r.completed !== h.result.completed) return { grade: 'refused', reason: 'The stored result differs from the result of re-executing the log.' };
  if (identityOf(h.seed, h.rulesEdition, [h.initial.teams.A.name, h.initial.teams.B.name], h.log) !== h.id) return { grade: 'refused', reason: 'The history id does not match its contents.' };
  const same = h.engine.rulesHash === BUILD_FINGERPRINT.rulesHash;
  return { grade: same ? 'verified' : 'verified-other-rules-code', reason: same ? 'Re-executed with this build: every input, decision, die and the result reproduce.' : `Written by engine ${h.engine.version} with different rules code; re-execution under this build still reproduces every die and the result.`, final: fin };
}

export function serializeHistory(h: HistoryFile | HistoryBatchFile): string { return JSON.stringify(h); }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function validateHistoryShape(v: unknown): string[] {
  const e: string[] = [];
  if (!isObj(v)) return ['history must be an object'];
  if (v.format !== HISTORY_FORMAT) e.push(`format must be "${HISTORY_FORMAT}"`);
  if (typeof v.version !== 'number') e.push('version must be a number');
  else if (v.version > HISTORY_VERSION) e.push(`history version ${v.version} is newer than this build supports (${HISTORY_VERSION}); update Bloodboard`);
  else if (v.version < 1) e.push('history version is invalid');
  for (const k of ['id', 'title', 'createdAt', 'rulesEdition', 'source']) if (typeof v[k] !== 'string') e.push(`${k} must be a string`);
  if (!['game', 'lab', 'multiplayer', 'training'].includes(v.source as string)) e.push('source is invalid');
  if (typeof v.seed !== 'number') e.push('seed must be a number');
  if (!isObj(v.initial) || (v.initial as Record<string, unknown>).format !== 'bloodboard-state') e.push('initial must be a bloodboard-state');
  if (!Array.isArray(v.log)) e.push('log must be an array');
  if (!isObj(v.result) || !isObj((v.result as Record<string, unknown>).score)) e.push('result.score is required');
  if (!isObj(v.participants) || !isObj((v.participants as Record<string, unknown>).A) || !isObj((v.participants as Record<string, unknown>).B)) e.push('participants.A and .B are required');
  return e;
}

export function parseHistory(text: string): { ok: true; history: HistoryFile } | { ok: false; errors: string[] } {
  let v: unknown;
  try { v = JSON.parse(text); } catch { return { ok: false, errors: ['not valid JSON'] }; }
  const errors = validateHistoryShape(v);
  if (errors.length) return { ok: false, errors };
  return { ok: true, history: v as HistoryFile };
}

export function toBatch(games: HistoryFile[], label: string, createdAt = new Date().toISOString()): HistoryBatchFile {
  let a = 5381; for (const g of games) for (const c of g.id) a = (Math.imul(a, 33) + c.charCodeAt(0)) >>> 0;
  return { format: HISTORY_BATCH_FORMAT, version: 1, id: `hb-${games.length}-${a.toString(36)}`, label, createdAt, games };
}

export interface BatchEntryReport { id: string; title: string; grade: HistoryGrade; reason: string }
/** Parse a single history OR a batch; each game is verified independently (one bad game never hides the others). */
export function importHistories(text: string): { ok: true; reports: BatchEntryReport[]; verified: HistoryFile[] } | { ok: false; errors: string[] } {
  let v: unknown;
  try { v = JSON.parse(text); } catch { return { ok: false, errors: ['not valid JSON'] }; }
  const games: unknown[] = isObj(v) && v.format === HISTORY_BATCH_FORMAT ? (Array.isArray(v.games) ? v.games : []) : [v];
  if (isObj(v) && v.format === HISTORY_BATCH_FORMAT && (v.version as number) > 1) return { ok: false, errors: [`batch version ${String(v.version)} is newer than this build supports`] };
  if (!games.length) return { ok: false, errors: ['the file contains no games'] };
  const reports: BatchEntryReport[] = [], verified: HistoryFile[] = [];
  for (const g of games) {
    const shape = validateHistoryShape(g);
    if (shape.length) { reports.push({ id: String((g as Record<string, unknown>)?.id ?? '?'), title: String((g as Record<string, unknown>)?.title ?? '?'), grade: 'refused', reason: shape.join('; ') }); continue; }
    const h = g as HistoryFile; const r = verifyHistory(h);
    reports.push({ id: h.id, title: h.title, grade: r.grade, reason: r.reason });
    if (r.grade !== 'refused') verified.push(h);
  }
  return { ok: true, reports, verified };
}
