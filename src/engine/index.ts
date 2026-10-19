/**
 * Public interface of the Bloodboard rules engine.
 *
 * The engine is a pure library: every function takes a GameState (plain JSON)
 * and returns a new one; nothing here touches the DOM, storage or network.
 * An external agent (Claude, Codex, a CLI) only needs these calls:
 *
 *   actionOptions(state, player)        -> which Actions a player may declare
 *   planAction(state, input)            -> validation + exact probabilities (no dice, no RNG)
 *   execute(state, input, planSummary)  -> rolls dice from state.rng, may pause for a decision
 *   decide(state, {requestId, optionId})-> answers the pending decision and continues
 *
 * See docs/INTERFACE.md and docs/schemas/*.json.
 */
export * from './types';
export { actionOptions, activationBlockReason, secureReason, type ActionAvailability } from './actions';
export { planAction, validateInput, exploreOutcomes, stepNode, type StepNode, type StepBranch, type StepOptions, previewDecision, POLICY_ASSUMPTIONS, type PlanResult, type OutcomeSummary, type BlockAnalysis, type PassAnalysis, type PlanOptions, type OutcomeLeaf, type ExploreOptions, type ExploreResult } from './planner';
export type { PolicyDecider, Ctx as PlanCtx } from './context';
export { execute, decide, describeInput, lastEvents } from './engine';
export { newGame, newTeam, playerFromPosition, customPlayer, validatePosition, startPlay, backToSetup, nextNumber, DEFAULT_RULER_WIDTH, type PositionIssue } from './setup';
export { toSaveFile, parseSaveFile, validateState, newMatchId, legacyMatchId, checkCompatibility, type SaveFile, type SaveMeta, type SaveOptions, type StoredCoachContext, type SaveCompatibility } from './serialize';
export { BUILD_FINGERPRINT } from './fingerprint';
export { matchAnalytics, ANALYTICS_SCHEMA, type MatchAnalytics, type TeamStats, type ActivityStats } from './analytics';
export { HISTORY_FORMAT, HISTORY_VERSION, HISTORY_BATCH_FORMAT, toHistory, verifyHistory, parseHistory, serializeHistory, validateHistoryShape, toBatch, importHistories, resultOf, type HistoryFile, type HistoryBatchFile, type HistoryParticipant, type HistoryResult, type HistoryGrade, type HistoryVerification, type HistorySource, type BatchEntryReport } from './history';
export { SKILLS, SKILL_BY_ID, skillName, gated, type SkillDef } from './skills';
export { ROSTERS, ROSTER_BY_ID, findPosition, isRetiredPosition, LEAGUES_PAGE, SPECIAL_RULES_PAGES, rosterLeague, rosterSpecialRules, specialRulePage, SPECIAL_RULE_PAGE, type Roster, type RosterPosition, type RosterGroup } from './rosters';
export { builtinFormation, type FormationChoice } from './formation';
export { rosterInfos, rosterScore, builtinTeam, chooseRosterBuiltin, validateBuild, violationCode, type RosterInfo, type RosterChoice, type BuildValidation, type Violation, type BuildFormat } from './lifecycle';
export { R as RULES } from './rules';
export * as board from './board';
export { cloneState, findPlayer, getPlayer, playerAt, markersOf, hasTackleZone, canUse, hasSkill, ballHolder, ballSquare, label, other, onPitch, isOpen } from './state';
export { canScoreWithoutDice } from './turn';
export { jumpedSquare, jumpMods, maxRushes } from './move';
export { blockStrength, blockBlockedReason, pushesIntoCrowd, crowdPushSquares } from './block';
export { passInfo, interceptors, interceptMods, passBlockedReason } from './pass';
export { d6SuccessProb, twoD6AtLeast, BLOCK_FACE_LABEL, BLOCK_FACE_P, ScriptedDice, RngDice, D6_TILT_LEVELS, D6_LEVEL_NAMES, DIFFICULTY_TILT, d6TiltWeights, d6SuccessProbW, type BlockFace } from './dice';
export { d6WeightsFor, difficultyFactors, outcomeFactor, testWeights, tiltedChance, difficultyExamples } from './context';
export type { StepRecord, Mod, Policy } from './context';
export { spendTeamReroll, useTeamReroll, captainOnPitch, CAPTAIN_RULE } from './roll';
export {
  MATCH_RULES,
  createMatch,
  validateDriveSetup,
  setupCandidates,
  kickerCandidates,
  inOwnHalf,
  losColumn,
  onLineOfScrimmageCentre,
  matchInputReason,
  isMatchInput,
  describeMatchInput,
  coachOf,
  validateFormalStart,
  defaultFormation,
  formationSlots,
  defaultSwarming,
  swarmingCandidates,
  SWARMING_RULE,
  cheeringBonus,
  kickLands,
  type CreateMatchResult,
  type SetupIssue,
} from './match';
export { MATCHED, SOURCE_TIERS, TIERS, OFFICIAL_TIERS, MEGA_STARS, MEGA_STAR_COST, isMegaStar, tierInfo, isEventTier, isTournamentTeam, skillPointAllowance, sourceTier, boughtSkillCategory, formatOfTeam, type Tier, type TierInfo, type MatchedFormat, type SkillPointUse } from './matched';
export { LEAGUE_RULES, PETTY_CASH_TOP_UP, playerValue, teamValue, currentTeamValue, journeymenFor, preMatchFunds, purchaseCost, leagueStarReason, leagueStarOptions, leagueInducementOptions, leagueMatchTeam, computerPreMatch, type PreMatchFunds, type PreMatchPurchase } from './league';
export { budgetsFor, fansRange, teamSkillPoints, newAllStarSquad, ALL_STAR_DEFAULTS, SEVENS_INSIGNIFICANT, usesSevensInsignificantException } from './teams';
export { buildTeam, autoSkills, positionValue, skillWorth, type BuildOptions } from './teambuild';
export { MATCH_KIND_LABEL, DRAFT_TEMPLATE, SEVENS_DRAFT, draftTemplate, setVeteran, setCaptain, hasTeamCaptainRule, CAPTAIN_PAGE, groupIssues, groupRoom, teamBudget, DRAFT_BUDGETS, expectedProfile, teamLeague, teamSpecialRules, newTeamDef, playerFromRoster, starAddReason, playerFromStar, addStar, removeStar, teamCost, validateTeamDef, parseTeamDef, playerCategories, type TeamDef, type TeamPlayerDef, type TeamIssue } from './teams';
export { ttmRange, throwablePlayers, vomitTargets, ttmBlockedReason } from './special';
export {
  LESSON_ORIGIN,
  lessonSquare,
  lessonLabel,
  parseLessonLabel,
  buildWorkbookState,
  blockBreakdown,
  diceCode,
  DICE_CODE_TEXT,
  meetsGoal,
  moveReach,
  whatIfMove,
  pushOptions,
  blockFirstOutcomes,
  blockTargets,
  checkExercise,
  solveExercise,
  exerciseMoves,
  parseWorkbookAnswer,
  buildScenario,
  checkGoal,
  type ScenarioSpec,
  type ScenarioPlayer,
  type TutorialGoal,
  type GoalCheck,
  type WorkbookPosition,
  type DiceCode,
  type BlockBreakdown,
  type AssistLine,
  type WhatIf,
  type ExerciseSpec,
  type ExerciseAnswer,
  type ExerciseResult,
  type ExerciseSolution,
  type OutcomeLine,
} from './teaching';
export { assistReason } from './block';
export { movementBudget, reachableSquares, safestRoute, dodgeChance, rushChance, jumpOptions, type MovementBudget, type ReachSquare, type Route, type RouteOptions, type JumpOption } from './routes';
export { sppTotal, matchSpp, raisedDead, postGameSpp, defaultMvpNominees, applyMatchSpp, mvpEligible, matchKey, type PostGameRow } from './spp';
export {
  SKILL_TABLE,
  ADVANCEMENT_COSTS,
  ADVANCEMENT_TITLES,
  ADV_KIND_LABEL,
  CAT_NAME,
  CHAR_LABEL,
  CHAR_TABLE,
  MAX_ADVANCEMENTS,
  SPP_AWARD,
  sppAward,
  BRAWLIN_BRUTES_PAGE,
  SPP_LABEL,
  advancementBlocked,
  advancementCost,
  advancementValue,
  applyAdvancement,
  charOptions,
  charRestriction,
  eligibleSkills,
  mustAdvance,
  rollRandomSkill,
  skillFromTable,
  skillRestriction,
  type AdvKind,
  type AdvancementChoice,
  type AdvancementRecord,
  type CharKey,
  type SkillCat,
  type SppKind,
} from './advancement';
export { foulAssists, foulTargets } from './foul';
export { RULESETS, rulesFor, isSevens, usePitch, pitch, pitchVariant, inTeamArea, inPitchHalf, inNoMansLand, type Ruleset, type PitchGeometry } from './variant';
export { SPECIALS, type SpecialInfo } from './specials';

export { INDUCEMENTS, INDUCEMENT_BY_ID, MERCENARY, DESPERATE_MEASURE, SEVENS_INDUCEMENT_PAGE, inducementCost, inducementsFor, inducementFor, inducementsNotOffered, induced, induceLeft, type InducementDef, type InducementList } from './inducements';
export { startRuleInfo, startRuleReason, startRuleTargets, type StartRuleInfo } from './starActions';
export { WIZARD_RULE, FIREBALL_RULE, ZAP_RULE, FROG, wizardWindowOpen, wizardReason, fireballTargets, zapChance, type WizardInput } from './wizard';
export { STARS, STAR_BY_ID, STAR_RULE, STAR_LIST_PAGE, STAR_MAX, STAR_RULES_IMPLEMENTED, starSupported, starRuleRef, playsForText, starPlaysFor, starChoiceKey, starsCost, starChoices, starOf, isStar, starReady, starMarker, type StarDef, type StarPer } from './stars';
export { PRAYERS, PRAYER_RULE, prayersOf, hasPrayer, throwARockReason, trapdoors } from './prayers';
// V5.5: Blood Bowl Sevens Desperate Measures (Spike! Journal 22 p.15) and the Sevens Prayers to Nuffle table.
export { DESPERATE, DESPERATE_NUMBER, DESPERATE_RULE, desperateOf, desperateLeft, razzlePairReason, type DesperateId } from './desperate';
export { SEVENS_PRAYERS } from './prayers';
export { desperateInputReason, razzleSecondReason } from './actions';
export { bloodlustSettled, biteTargetAdjacent, BLOODLUST_RULE } from './traits';
export { MIRROR_MARK, mirrorTeamCopy } from './match';
export * from './replay';
export {
  EXERCISE_FORMAT, EXERCISE_PACK_FORMAT, ATTEMPT_FORMAT, TRAINING_VERSION, GRADER as TRAINING_GRADER, defaultRubric, authorExercise, publicExercise, validateExerciseShape,
  checkTacticalExercise, attemptStatus, serializeTraining, makePack, importExercises, newAttempt, replayAttempt, validateAttemptShape, importAttempt, gradeAttempt,
  type Exercise as TacticalExercise, type Exercise, type ExercisePack, type Attempt, type ActorInfo, type AttemptLabels, type ScoreReport, type ComponentScore, type Objective, type ObjectiveKind,
  type Constraints, type Rubric, type RubricComponent, type ReferenceLine, type ImportReport, type AuthorOptions, type AttemptProgress,
} from './training';
export { applyWireUpdate, type WireUpdate } from './lan';
