/**
 * V7-11 headless coach attempts: a built-in or profile coach plays an exercise with the SAME contract the game uses (same start position,
 * same engine, same attempt record and grader). The coach function receives ONLY the game state, so references and the rubric's hidden data
 * cannot reach it. Module/online coaches use the same Attempt contract through the host; they are not driven from here.
 * No large batch: one attempt per call.
 */
import { decide, execute } from '../engine/engine';
import { attemptStatus, gradeAttempt, newAttempt, type ActorInfo, type Attempt, type Exercise, type ScoreReport } from '../engine/index';
import { cloneState } from '../engine/state';
import { nextMove, type AIMove, type CoachSpec } from '../ai/driver';
import type { AIStyle } from '../ai/types';
import type { GameState } from '../engine/types';

export interface CoachRunOptions {
  style?: AIStyle;
  spec?: CoachSpec;
  coachId: string;
  coachVersion?: string;
  /** Only a safety cap on moves (the exercise's own maxActions applies first). */
  maxMoves?: number;
  samples?: number;
  startedAt?: string;
}

export function runCoachAttempt(ex: Exercise, o: CoachRunOptions): { attempt: Attempt; report: ScoreReport; stoppedBecause: string } {
  const actor: ActorInfo = { kind: 'coach', coachId: o.coachId, ...(o.coachVersion ? { coachVersion: o.coachVersion } : {}) };
  const attempt = newAttempt(ex, actor, { startedAt: o.startedAt ?? new Date().toISOString() });
  let s: GameState = cloneState(ex.start);
  const t0 = Date.now();
  let stopped = 'the coach ended its Turn or the attempt finished';
  for (let n = 0; n < (o.maxMoves ?? 60); n++) {
    const st = attemptStatus(ex, s, s.log.length);
    if (st.finished) { stopped = st.why ?? stopped; break; }
    let mv: AIMove | null;
    try { mv = nextMove(s, ex.side, o.style ?? 'balanced', {}, o.spec); } catch (e) { stopped = `the coach failed: ${(e as Error).message}`; break; }
    if (!mv) { stopped = 'the coach had no move'; break; }
    const out = mv.type === 'decision' ? decide(s, { requestId: mv.requestId, optionId: mv.optionId }) : execute(s, mv.input);
    if (out.status === 'illegal') { stopped = `the coach proposed an illegal move: ${(out as { error?: string }).error ?? 'illegal'}`; break; }
    s = out.state as GameState;
  }
  attempt.log = JSON.parse(JSON.stringify(s.log));
  attempt.elapsedMs = Date.now() - t0;
  attempt.status = 'finished';
  attempt.result = gradeAttempt(ex, attempt, o.samples !== undefined ? { samples: o.samples } : {});
  return { attempt, report: attempt.result, stoppedBecause: stopped };
}
