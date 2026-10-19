/**
 * Validation of a module's answer (V5.6). The host never trusts an answer: every form is checked here and anything
 * that does not hold falls back to the built-in coach, with the reason in the diagnostics.
 *
 * Action answers (`chooseAction`):
 *   { candidateId: 3 }                      an id of the legacy candidate list (API 1 / 1.1)
 *   { candidateId: "17.c42" }               a request-scoped id returned by `services.candidates(...)` for the ROOT position
 *   { input: {...}, why }                   the module's own input: planned by the engine, must be legal, must be the team's
 *   { endTurn: true }                       end the Turn
 *   { ranking: [{ candidateId, score | logit }, ...], why }   V5.6: the host takes the best-scored VALID entry
 * Decision answers (`chooseDecision`):
 *   "optionId"                              API 1
 *   { optionId, why }                       V5.6 (modules declaring apiMinor >= 2 only: older modules' object answers were
 *                                           always ignored and stay ignored)
 *   { ranking: [{ optionId, score | logit }], why }          V5.6
 */
import type { ActionInput, PlayerActionInput, TeamId } from '../engine/index';
import { E } from '../ai/engine';
import type { Session } from './session';

export interface Ranked {
  id: string | number;
  score: number;
  prob: number;
  valid: boolean;
  reason?: string;
}

export interface ActionChoice {
  /** Index into the legacy (built-in) candidate list, when the answer named one. */
  legacyIndex: number | null;
  input: ActionInput | null;
  why: string | null;
  via: 'candidateId' | 'serviceCandidate' | 'input' | 'endTurn' | 'ranking';
  ranking?: Ranked[];
  /** Optional explanation object the module attached (size-capped JSON; recorded in traces, never interpreted). */
  trace?: unknown;
}
export type ActionResult = { ok: true; choice: ActionChoice } | { ok: false; message: string; ranking?: Ranked[] };

/** Optional factual diagnostic JSON. User-authorized 256 KiB transport cap;
 * diagnostics never determine legality, probability or action selection. */
export const MAX_TRACE_BYTES = 256 * 1024;
export function capTrace(v: unknown): unknown {
  if (v === undefined || v === null) return undefined;
  try {
    const t = JSON.stringify(v);
    const bytes = new TextEncoder().encode(t).byteLength;
    return bytes <= MAX_TRACE_BYTES ? JSON.parse(t) : { truncated: true, bytes, limitBytes: MAX_TRACE_BYTES };
  } catch {
    return undefined;
  }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown, n = 400): string | null => (typeof v === 'string' && v.trim() ? v.slice(0, n) : null);

/** Softmax over scores (for traces; the choice itself is the maximum, ties to the earlier entry). */
function withProbs(list: Array<{ id: string | number; score: number }>): Ranked[] {
  const mx = Math.max(...list.map((x) => x.score));
  const z = list.map((x) => Math.exp(x.score - mx));
  const sum = z.reduce((a, b) => a + b, 0) || 1;
  return list.map((x, i) => ({ id: x.id, score: x.score, prob: z[i] / sum, valid: true }));
}

function checkOwnInput(ses: Session, input: ActionInput): string | null {
  E.usePitch(ses.root);
  if (input.kind === 'endTurn') return null;
  if (input.kind === 'endActivation') return ses.root.turn.activation ? null : 'endActivation: no player is activated.';
  if (input.kind !== 'playerAction') return `input.kind "${String((input as { kind?: unknown }).kind)}" is not an action a coach can take (playerAction, endActivation, endTurn).`;
  const p = ses.root.players.find((q) => q.id === (input as PlayerActionInput).playerId);
  if (!p) return `Unknown player "${(input as PlayerActionInput).playerId}".`;
  if (p.team !== ses.root.turn.active) return `Player ${p.id} is not on the active team (${ses.root.turn.active}).`;
  // The engine's own legality check (the one `execute` applies): cheap, exact, no enumeration of dice.
  const errs = E.validateInput(ses.root, input);
  return errs.length ? `rejected by the rules engine: ${errs[0]}` : null;
}

export function resolveAction(ses: Session, result: unknown, legacyCount: number, legacyInputs: Array<ActionInput | null>): ActionResult {
  if (result === null || result === undefined) return { ok: false, message: 'gave no answer.' };
  if (typeof result !== 'object') return { ok: false, message: `answered ${JSON.stringify(result)}; an object is expected ({ candidateId } | { input } | { endTurn } | { ranking }).` };
  const r = result as Record<string, unknown>;
  const why = str(r.why, 8000);
  const byId = (id: unknown): { input: ActionInput | null; legacy: number | null; via: ActionChoice['via'] } | string => {
    if (typeof id === 'number' && Number.isInteger(id)) {
      if (id < 0 || id >= legacyCount) return `candidate id ${id} is not in the offered list (0–${legacyCount - 1}).`;
      return { input: legacyInputs[id] ?? null, legacy: id, via: 'candidateId' };
    }
    if (typeof id === 'string') {
      const ref = ses.candidateRefs.get(id);
      if (!ref) return `candidate id "${id}" was not issued in this request (ids are request-scoped).`;
      if (ref.position !== 'root') return `candidate "${id}" belongs to the explored position ${ref.position}; only candidates of the request's own position can be played (use explore/sequence for look-ahead, then answer with an id or input of the root position).`;
      return { input: ref.input as ActionInput, legacy: null, via: 'serviceCandidate' };
    }
    return `candidate id ${JSON.stringify(id)} is neither a number nor a string.`;
  };
  const finish = (input: ActionInput | null, legacy: number | null, via: ActionChoice['via'], ranking?: Ranked[]): ActionResult => {
    if (!input) return { ok: false, message: 'the named candidate has no input (it was not legal).', ranking };
    const bad = checkOwnInput(ses, input);
    if (bad) return { ok: false, message: bad, ranking };
    return { ok: true, choice: { legacyIndex: legacy, input, why, via, ranking, trace: capTrace(r.trace) } };
  };

  if (r.endTurn === true) return finish({ kind: 'endTurn' }, null, 'endTurn');
  if (Array.isArray(r.ranking)) {
    if (r.ranking.length > 5000) return { ok: false, message: 'ranking has more than 5000 entries.' };
    const entries: Array<{ id: string | number; score: number }> = [];
    for (const e of r.ranking as Array<Record<string, unknown>>) {
      const sc = num(e?.score) ?? num(e?.logit);
      if (!e || (typeof e.candidateId !== 'number' && typeof e.candidateId !== 'string') || sc === null) continue;
      entries.push({ id: e.candidateId, score: sc });
    }
    if (!entries.length) return { ok: false, message: 'ranking has no usable entry ({ candidateId, score } or { candidateId, logit }).' };
    const ranked = withProbs(entries);
    const order = ranked.map((x, i) => ({ x, i })).sort((a, b) => b.x.score - a.x.score || a.i - b.i);
    const notes: string[] = [];
    for (const { x } of order) {
      const c = byId(x.id);
      if (typeof c === 'string') { x.valid = false; x.reason = c; notes.push(c); continue; }
      const res = finish(c.input, c.legacy, 'ranking', ranked);
      if (res.ok) return res;
      x.valid = false;
      x.reason = res.message;
      notes.push(res.message);
    }
    return { ok: false, message: `no entry of the ranking is valid (${notes.slice(0, 3).join(' | ')}).`, ranking: ranked };
  }
  if (r.candidateId !== undefined) {
    const c = byId(r.candidateId);
    if (typeof c === 'string') return { ok: false, message: c };
    return finish(c.input, c.legacy, c.via);
  }
  if (r.input && typeof r.input === 'object') return finish(r.input as ActionInput, null, 'input');
  return { ok: false, message: 'gave no usable answer (candidateId, input, endTurn or ranking).' };
}

export type DecisionResult = { ok: true; optionId: string; why: string | null; via: 'string' | 'object' | 'ranking'; ranking?: Ranked[] } | { ok: false; message: string; ranking?: Ranked[] };

export function resolveDecision(options: Array<{ id: string }>, result: unknown, apiMinor: number): DecisionResult {
  if (result === null || result === undefined) return { ok: false, message: 'gave no answer.' };
  const has = (id: unknown) => typeof id === 'string' && options.some((o) => o.id === id);
  if (typeof result === 'string') return has(result) ? { ok: true, optionId: result, why: null, via: 'string' } : { ok: false, message: `answered "${result}", which is not one of the options.` };
  if (typeof result !== 'object') return { ok: false, message: `answered ${JSON.stringify(result)}, which is not one of the options.` };
  if (apiMinor < 2) return { ok: false, message: 'answered with an object; object answers need `apiMinor: 2` in register() (the answer is ignored, as in API 1).' };
  const r = result as Record<string, unknown>;
  const why = str(r.why, 8000);
  if (Array.isArray(r.ranking)) {
    const entries: Array<{ id: string | number; score: number }> = [];
    for (const e of r.ranking as Array<Record<string, unknown>>) {
      const sc = num(e?.score) ?? num(e?.logit);
      if (e && typeof e.optionId === 'string' && sc !== null) entries.push({ id: e.optionId, score: sc });
    }
    if (!entries.length) return { ok: false, message: 'ranking has no usable entry ({ optionId, score } or { optionId, logit }).' };
    const ranked = withProbs(entries);
    const order = ranked.map((x, i) => ({ x, i })).sort((a, b) => b.x.score - a.x.score || a.i - b.i);
    for (const { x } of order) {
      if (has(x.id)) return { ok: true, optionId: String(x.id), why, via: 'ranking', ranking: ranked };
      x.valid = false;
      x.reason = 'not one of the options';
    }
    return { ok: false, message: 'no entry of the ranking is one of the options.', ranking: ranked };
  }
  if (has(r.optionId)) return { ok: true, optionId: r.optionId as string, why, via: 'object' };
  return { ok: false, message: `answered ${JSON.stringify(r.optionId)}, which is not one of the options.` };
}

export type { TeamId };
