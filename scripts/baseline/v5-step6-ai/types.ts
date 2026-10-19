import type { ActionInput, GameState, TeamId } from '../../../src/engine/index';

export type AIStyle = 'balanced' | 'offensive' | 'defensive';

export const STYLE_LABEL: Record<AIStyle, string> = {
  balanced: 'Balanced',
  offensive: 'Offensive',
  defensive: 'Defensive',
};

export type ObjectiveId =
  | 'score'
  | 'stopScore'
  | 'recoverBall'
  | 'protectCarrier'
  | 'advance'
  | 'pressureCarrier'
  | 'contestBall'
  | 'position'
  | 'disrupt';

export const OBJECTIVE_LABEL: Record<ObjectiveId, string> = {
  score: 'Take the scoring chance',
  stopScore: 'Stop the opponent scoring',
  recoverBall: 'Recover the loose ball',
  protectCarrier: 'Protect the ball carrier',
  advance: 'Advance the attack',
  pressureCarrier: 'Pressure their ball carrier',
  contestBall: 'Contest the loose ball',
  position: 'Improve positioning',
  disrupt: 'Disrupt the opponent',
};

export interface Objective {
  id: ObjectiveId;
  urgent: boolean;
  why: string;
}

/** One candidate the AI considered, with everything needed to audit the choice. */
export interface Candidate {
  input: ActionInput;
  /** Short description, e.g. "#5 Blitzer: Blitz #3 from M8". */
  label: string;
  /** 'move' | 'carry' (ball carrier moves) | 'score' | 'block' | 'blitz' | 'pass' | 'handoff' | 'secure' | 'pickup' | 'standUp' | 'vomit' | 'ttm' | 'continue' */
  kind: string;
  playerId: string | null;
  /** Cheap pre-screen value (before outcome enumeration). */
  prescore: number;
  /** Involves their ball carrier or an opponent next to ours (always enumerated). */
  key?: boolean;
  /** Uses a Star Player's special rule (always enumerated). */
  star?: boolean;
  /** Value of keeping that rule for later — subtracted from the gain (V5 step 6). */
  reserve?: number;
  /** Expected change of the position value, Turnover cost included (after enumeration) — the ranking value (= gainSupported). */
  gain?: number;
  /** … as the position would stand if the Turn ended right after the action. */
  gainStatic?: number;
  /** … plus, for ball-carrier actions, team-mates who have not acted yet coming to protect the carrier (no dice). */
  gainSupported?: number;
  /** Value those team-mates add around the carrier in the most likely outcome (see supportUplift). */
  support?: number;
  /** Turnover chance × what the other players could still do safely this Turn (already subtracted from the gains). */
  charge?: number;
  /** Value of the unfinished activation of another player that this action would end (already subtracted). */
  forfeit?: number;
  /** Stalling (p.80-81): expected loss the Crowd would cause at the end of the Turn/activation that this action avoids by scoring (already added). */
  stallAvoided?: number;
  pSuccess?: number;
  pTurnover?: number;
  pTouchdown?: number;
  pOppTouchdown?: number;
  pBallLost?: number;
  /** Chance an opposing ball carrier loses the ball. */
  pBallFreed?: number;
  /** Probability mass not enumerated (branches below the threshold) — estimated, not exact. */
  unresolved?: number;
  /** Largest evaluation-term changes in the successful outcomes (for explanations). */
  drivers?: Array<[string, number]>;
  error?: string;
}

export interface AIDecision {
  input: ActionInput;
  objective: Objective;
  chosen: Candidate | null;
  /** Considered candidates, best first (enumerated ones carry gain / probabilities). */
  candidates: Candidate[];
  /** Plain-language reason for a consequential action. */
  reason: string;
  /** Position value before acting, with its terms. */
  value: number;
  terms: Record<string, number>;
  /** What team-mates who have not acted could still add around our ball carrier where he stands (the baseline for ball-carrier actions). */
  support: number;
  millis: number;
}

export interface AIConfig {
  team: TeamId;
  style: AIStyle;
}

export type StateLike = GameState;
