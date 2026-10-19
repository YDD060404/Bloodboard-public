/**
 * What the computer coach does next in a match — the single entry point used
 * by the interface and by the self-play tests.
 *
 * It only answers when it is that coach's turn to act: a decision addressed to
 * its team, a set-up / kick-off / Kick-off Event step of its team, or an
 * action during its own Turn (or its Charge!). Neutral steps that both coaches
 * share (the pre-game sequence, ending a Drive) are left to the human.
 */
import type { ActionInput, GameState, TeamId } from '../engine/index';
import { answerDecision, matchStepFor, think, wizardChoice, type ThinkOptions } from './brain';
import { E } from './engine';
import type { AIDecision, AIStyle } from './types';
import { setCoachParams, type CoachParams } from './evaluate';
import { profileWeights, type AIFile, type ProfileContext } from './registry';

export type AIMove =
  | { type: 'decision'; requestId: string; optionId: string; why: string }
  | { type: 'step'; input: ActionInput; why: string }
  | { type: 'action'; input: ActionInput; why: string; decision: AIDecision };

/** Whose input the game is waiting for, or null for a neutral step (pre-game, End of Drive, full time). */
export function waitingFor(s: GameState): TeamId | null {
  if (s.pending) return s.pending.request.team;
  const m = s.match;
  if (s.phase === 'play') {
    if (m?.pendingPhase?.type === 'charge') return m.pendingPhase.team;
    return s.turn.active;
  }
  if (!m) return null;
  if (s.phase === 'driveSetup') return m.kicking && m.setupDone[m.kicking] ? E.other(m.kicking) : (m.kicking ?? null);
  if (s.phase === 'kickoff') {
    if (m.pendingPhase && m.pendingPhase.type !== 'charge') return m.pendingPhase.team;
    return m.kicking ?? null;
  }
  return null;
}

/** True when `team` (the computer) should act now. */
export function aiToAct(s: GameState, team: TeamId): boolean {
  return waitingFor(s) === team;
}

/**
 * Think about the computer coach's next input. A generator so the interface
 * can keep painting while it thinks; `nextMove` runs it to the end.
 */
/** V5.5: the AI file of the coach (registry.ts) — its parameters apply only while this coach thinks. */
export interface CoachSpec {
  profile?: AIFile;
}

function profileContext(s: GameState, team: TeamId): ProfileContext {
  const opp: TeamId = team === 'A' ? 'B' : 'A';
  const holder = s.ball.kind === 'held' ? s.players.find((p) => p.id === (s.ball as { playerId: string }).playerId) : undefined;
  const per = E.rulesFor(s).turnsPerHalf;
  return {
    scoreDiff: s.teams[team].score - s.teams[opp].score,
    turnsLeft: Math.max(0, per - s.teams[team].turn),
    half: (s.match?.half ?? 1) === 2 ? 2 : 1,
    possession: holder ? (holder.team === team ? 'us' : 'them') : 'loose',
    format: s.variant === 'sevens' ? 'sevens' : 'standard',
  };
}

/** The coach parameters of an AI file in this situation (null: the built-in defaults). */
export function paramsFor(s: GameState, team: TeamId, spec?: CoachSpec): CoachParams | null {
  const prof = spec?.profile;
  if (!prof) return null;
  const ctx = profileContext(s, team);
  const P = prof.parameters ?? {};
  return { weights: (w) => profileWeights(w, prof, ctx), objectives: P.objectives, search: P.search };
}

/** Run `fn` with the coach's parameters active (never while other code runs). */
export function withParams<T>(params: CoachParams | null, fn: () => T): T {
  setCoachParams(params);
  try {
    return fn();
  } finally {
    setCoachParams(null);
  }
}

/** Run a thinking generator with the coach's parameters set only while it runs. */
export function* hooked<T>(params: CoachParams | null, inner: Generator<string, T, void>): Generator<string, T, void> {
  for (;;) {
    const r = withParams(params, () => inner.next());
    if (r.done) return r.value;
    yield r.value;
  }
}

export function* planNext(s: GameState, team: TeamId, style: AIStyle, options: Partial<ThinkOptions> = {}, spec?: CoachSpec): Generator<string, AIMove | null, void> {
  return yield* hooked(paramsFor(s, team, spec), planNextInner(s, team, style, options));
}

function* planNextInner(s: GameState, team: TeamId, style: AIStyle, options: Partial<ThinkOptions> = {}): Generator<string, AIMove | null, void> {
  if (!aiToAct(s, team)) return null;
  if (s.pending) {
    const req = s.pending.request;
    const a = answerDecision(s, req, team, style);
    return { type: 'decision', requestId: req.id, optionId: a.optionId, why: a.why };
  }
  if (s.phase === 'play') {
    // Sports-Wizard (p.149): cast between the opponent's Turn and its own when it clearly pays (brain.ts wizardChoice).
    if (!s.match?.pendingPhase) {
      const wz = wizardChoice(s, team, style);
      if (wz) return { type: 'step', input: wz.input, why: wz.why };
    }
    // Throw a Rock (Prayer to Nuffle, p.143): free, so the computer uses it at the start of its first Turn.
    if (!E.throwARockReason(s, team)) return { type: 'step', input: { kind: 'throwARock', team }, why: 'Throw a Rock (Prayer to Nuffle): a free chance to Knock Down an opponent before the Turn starts.' };
    const d: AIDecision = yield* think(s, team, { ...options, style });
    return { type: 'action', input: d.input, why: d.reason, decision: d };
  }
  const st = matchStepFor(s, team, style);
  return st ? { type: 'step', input: st.input, why: st.why } : null;
}

export function nextMove(s: GameState, team: TeamId, style: AIStyle, options: Partial<ThinkOptions> = {}, spec?: CoachSpec): AIMove | null {
  const g = planNext(s, team, style, options, spec);
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
  }
}
