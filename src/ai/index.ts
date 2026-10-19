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
export { evaluate, styleWeights, BASE_WEIGHTS, horizonFor, setCoachParams, type Weights, type Evaluation, type CoachParams } from './evaluate';
export { planNext, nextMove, aiToAct, waitingFor, paramsFor, withParams, hooked, type AIMove, type CoachSpec } from './driver';
export { AI_API_VERSION, AI_FORMAT, AI_FORMAT_VERSION, BUILTIN_IMPLEMENTATION, BUILTIN_ALGORITHM_VERSION, DEFAULT_AI_ID, NO_FILE_FALLBACK, BUNDLED_FILES, PREFERENCES, listCoaches, coachById, usableCoaches, fallbackCoach, legacyAiId, setLoadedCoaches, parseAIFile, parseProfile, profileWeights, entriesFromFiles, type AIFile, type AIParameters, type CoachEntry, type CoachKind, type ProfileFile, type ProfileCondition } from './registry';
export * from './types';
