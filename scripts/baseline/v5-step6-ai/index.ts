/**
 * Computer opponent (local, rules-based). See docs/AI_OPPONENT.md.
 *
 * Call `bindEngine(engine)` once with the rules engine's public API, then ask
 * `planNext` / `nextMove` for the computer coach's next input and execute it
 * through the normal engine functions (execute / decide) — the AI never
 * changes the game state itself and never reads the dice generator.
 */
export { bindEngine, type EngineAPI } from './engine';
export { think, decideAction, answerDecision, matchStepFor, chooseObjective, wizardChoice, type ThinkOptions } from './brain';
export { evaluate, styleWeights, BASE_WEIGHTS, horizonFor, type Weights, type Evaluation } from './evaluate';
export { planNext, nextMove, aiToAct, waitingFor, type AIMove } from './driver';
export * from './types';
