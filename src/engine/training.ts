/**
 * V7-11: tactical training mode — exercise / pack / attempt contracts, validation and fair scoring. Pure engine code.
 *
 *  - An EXERCISE is a legal practice position (a GameState with its log cleared) + side to act + an objective + constraints + a rubric.
 *    A history and an exercise are distinct payload types with distinct `format` discriminators; both reuse the canonical state.
 *  - An ATTEMPT is the committed action sequence (the engine's own log entries, dice included) played from the exercise's start. It is
 *    verified by re-execution exactly like a match history (`verifyLog`); the stored score is a claim that grading re-derives.
 *  - SCORING separates three things and never mixes them:
 *      legality   – the attempt re-executes with the authoritative engine;
 *      realized   – what the real dice did this time (objective reached or not, turnover, final position);
 *      plan quality – the SAME committed action sequence replayed on `samples` alternate dice seeds with a declared decision policy;
 *                     per-component means with a 95 % Wilson/normal interval. A plan that failed a roll is not penalised by the roll,
 *                     and a lucky bad plan is not rewarded: only the sampled behaviour of the plan is scored.
 *    Fewer than `minSamples` samples leaves the quality UNGRADED (never an invented exact score). Components the grader does not know are
 *    reported unavailable. Reference lines are grader-only (`publicExercise` strips them) and are scored with the same method for comparison;
 *    they are never the only accepted answer. No win probability or global tactical weights are implied.
 *  - What the plan-quality sample does NOT see: the human's adaptive replies to bad dice. It grades the committed sequence as a plan, and
 *    says so in `limits`.
 */
import { scoringEndZoneX } from './board';
import { BUILD_FINGERPRINT } from './fingerprint';
import { decide, describeInput, execute } from './engine';
import { applyEntry, verifyLog } from './replay';
import { ballHolder, cloneState, playersWithin } from './state';
import { validateState } from './serialize';
import { usePitch } from './variant';
import type { ActionInput, GameState, LogEntry, TeamId } from './types';

export const EXERCISE_FORMAT = 'bloodboard-exercise';
export const EXERCISE_PACK_FORMAT = 'bloodboard-exercise-pack';
export const ATTEMPT_FORMAT = 'bloodboard-attempt';
export const TRAINING_VERSION = 1;
export const GRADER = { id: 'bloodboard-tactical-rubric', version: '1.0.0' } as const;

export type ObjectiveKind = 'score' | 'keep-ball' | 'recover-ball' | 'stop-carrier' | 'no-turnover';
export interface Objective { kind: ObjectiveKind; text?: string }
export interface Constraints { maxActions?: number; /** Only when the exercise says so; otherwise elapsed time is recorded, never enforced. */ timeLimitMs?: number }
export type ComponentId = 'objective' | 'turnoverFree' | 'ballSecurity' | 'carrierProtection' | 'progress';
export interface RubricComponent { id: string; weight: number }
export interface Rubric { id: string; version: number; components: RubricComponent[]; minSamples?: number; samples?: number }

export interface ReferenceLine { label: string; inputs: ActionInput[] }
export interface Exercise {
  format: typeof EXERCISE_FORMAT;
  version: typeof TRAINING_VERSION;
  /** Stable user-visible id (duplicates are detected by id). */
  id: string;
  /** Content identity of position + objective + constraints + rubric. */
  hash: string;
  title: string;
  description?: string;
  createdAt: string;
  author?: string;
  side: TeamId;
  start: GameState;
  rulesEdition: string;
  variant: 'standard' | 'sevens';
  engine: { version: string; engineHash: string; rulesHash: string };
  objective: Objective;
  constraints: Constraints;
  rubric: Rubric;
  hints?: string[];
  /** GRADER-ONLY. Never given to an acting coach. */
  references?: ReferenceLine[];
  /** Where the position came from, explained rather than silently approximated. */
  source?: { kind: 'current-position' | 'recorded-snapshot' | 'example'; note?: string };
}
export interface ExercisePack { format: typeof EXERCISE_PACK_FORMAT; version: typeof TRAINING_VERSION; id: string; title: string; createdAt: string; exercises: Exercise[] }

export interface ActorInfo { kind: 'human' | 'coach'; coachId?: string; coachVersion?: string; provider?: string; model?: string; budgetMs?: number }
export interface AttemptLabels { hintsUsed: number; adviceUsed: boolean; retryIndex: number; /** Undo presses on the board (practice allows unlimited Undo; it is recorded, not forbidden). */ undos: number }
export interface Attempt {
  format: typeof ATTEMPT_FORMAT;
  version: typeof TRAINING_VERSION;
  id: string;
  exerciseId: string;
  exerciseHash: string;
  rubric: { id: string; version: number };
  actor: ActorInfo;
  labels: AttemptLabels;
  startedAt: string;
  elapsedMs: number;
  status: 'in-progress' | 'finished';
  /** The engine's own log entries (inputs, decisions, every die). */
  log: LogEntry[];
  engine: { version: string; engineHash: string; rulesHash: string };
  result?: ScoreReport;
  /** Optional captured predictions (e.g. spatial top-K): only attached when actually captured, never reconstructed. */
  predictions?: unknown;
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const OBJECTIVES: ObjectiveKind[] = ['score', 'keep-ball', 'recover-ball', 'stop-carrier', 'no-turnover'];
const KNOWN_COMPONENTS: ComponentId[] = ['objective', 'turnoverFree', 'ballSecurity', 'carrierProtection', 'progress'];

export function defaultRubric(kind: ObjectiveKind): Rubric {
  const base: Record<ObjectiveKind, RubricComponent[]> = {
    score: [{ id: 'objective', weight: 3 }, { id: 'turnoverFree', weight: 1 }, { id: 'ballSecurity', weight: 1 }, { id: 'progress', weight: 1 }],
    'keep-ball': [{ id: 'objective', weight: 3 }, { id: 'turnoverFree', weight: 1 }, { id: 'carrierProtection', weight: 1 }],
    'recover-ball': [{ id: 'objective', weight: 3 }, { id: 'turnoverFree', weight: 1 }, { id: 'ballSecurity', weight: 1 }],
    'stop-carrier': [{ id: 'objective', weight: 3 }, { id: 'turnoverFree', weight: 1 }],
    'no-turnover': [{ id: 'objective', weight: 1 }],
  };
  return { id: `rubric-${kind}`, version: 1, components: base[kind], minSamples: 50, samples: 200 };
}

function fnv(parts: string[]): string {
  let a = 2166136261, b = 5381;
  for (const str of parts) for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); a = Math.imul(a ^ c, 16777619) >>> 0; b = (Math.imul(b, 33) + c) >>> 0; }
  return `x-${a.toString(36)}${b.toString(36)}`;
}
const exerciseHash = (e: Pick<Exercise, 'start' | 'side' | 'objective' | 'constraints' | 'rubric'>): string => fnv([JSON.stringify(e.start), e.side, JSON.stringify(e.objective), JSON.stringify(e.constraints), JSON.stringify(e.rubric)]);

export interface AuthorOptions {
  id: string; title: string; side?: TeamId; objective: Objective; constraints?: Constraints; rubric?: Rubric;
  description?: string; author?: string; hints?: string[]; references?: ReferenceLine[]; createdAt?: string;
  source?: Exercise['source'];
}

/** Create an exercise from a position. Refuses (with a reason) positions the engine cannot load as a legal practice start. */
export function authorExercise(position: GameState, o: AuthorOptions): { ok: true; exercise: Exercise } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(o.id)) errors.push('The exercise id must be 1-64 characters: letters, digits, "." "_" "-".');
  if (!o.title?.trim()) errors.push('A title is required.');
  if (!OBJECTIVES.includes(o.objective?.kind)) errors.push(`Unknown objective "${String(o.objective?.kind)}". Supported: ${OBJECTIVES.join(', ')}.`);
  const side = o.side ?? position.turn.active;
  const verr = validateState(position);
  if (verr.length) errors.push(`The position is not a valid game state: ${verr.slice(0, 3).join('; ')}`);
  if (position.phase !== 'play') errors.push(`The position must be in play (it is in "${position.phase}"). Set-up and kick-off positions cannot be practised as exercises.`);
  if (position.pending) errors.push('The position has an unresolved decision pending. Resolve it first: exercises starting inside a decision are not supported.');
  if (position.turn.active !== side) errors.push(`The side to act (${side}) must be the team whose Turn it is (${position.turn.active}).`);
  if (o.constraints?.maxActions !== undefined && !(Number.isInteger(o.constraints.maxActions) && o.constraints.maxActions >= 1)) errors.push('maxActions must be a whole number of at least 1.');
  const rubric = o.rubric ?? defaultRubric(o.objective?.kind ?? 'score');
  errors.push(...validateRubric(rubric));
  if (errors.length) return { ok: false, errors };
  const start = clone(position); start.log = []; start.pending = null; delete start.title; delete start.notes;
  const ex: Exercise = {
    format: EXERCISE_FORMAT, version: TRAINING_VERSION, id: o.id, hash: '', title: o.title.trim(), ...(o.description ? { description: o.description } : {}),
    createdAt: o.createdAt ?? new Date().toISOString(), ...(o.author ? { author: o.author } : {}), side, start,
    rulesEdition: position.rulesEdition ?? 'legacy', variant: position.variant ?? 'standard',
    engine: { version: BUILD_FINGERPRINT.version, engineHash: BUILD_FINGERPRINT.engineHash, rulesHash: BUILD_FINGERPRINT.rulesHash },
    objective: clone(o.objective), constraints: clone(o.constraints ?? {}), rubric: clone(rubric),
    ...(o.hints?.length ? { hints: [...o.hints] } : {}), ...(o.references?.length ? { references: clone(o.references) } : {}),
    ...(o.source ? { source: o.source } : {}),
  };
  ex.hash = exerciseHash(ex);
  return { ok: true, exercise: ex };
}

function validateRubric(r: Rubric): string[] {
  const e: string[] = [];
  if (!isObj(r) || !Array.isArray(r.components) || !r.components.length) return ['The rubric needs at least one component.'];
  if (!r.components.some((c) => c.id === 'objective')) e.push('The rubric must include the "objective" component.');
  for (const c of r.components) {
    if (typeof c.id !== 'string') e.push('A rubric component has no id.');
    if (!(typeof c.weight === 'number' && c.weight > 0 && Number.isFinite(c.weight))) e.push(`Rubric component "${c.id}" needs a positive weight.`);
  }
  if (new Set(r.components.map((c) => c.id)).size !== r.components.length) e.push('Rubric components must be unique.');
  return e;
}

/** The exercise as an acting coach or the interface before the attempt may see it: no references, no rubric internals beyond the objective. */
export function publicExercise(ex: Exercise): Omit<Exercise, 'references'> {
  const { references: _drop, ...rest } = clone(ex); void _drop; return rest;
}

// ---------------------------------------------------------------- import / export

export interface ImportReport { added: Exercise[]; skipped: { id: string; reason: string }[]; conflicts: { id: string; reason: string }[]; errors: string[] }

export function validateExerciseShape(v: unknown): string[] {
  const e: string[] = [];
  if (!isObj(v)) return ['an exercise must be an object'];
  if (v.format !== EXERCISE_FORMAT) e.push(`format must be "${EXERCISE_FORMAT}"`);
  if (typeof v.version !== 'number') e.push('version must be a number');
  else if (v.version > TRAINING_VERSION) e.push(`exercise version ${v.version} is newer than this build supports (${TRAINING_VERSION})`);
  for (const k of ['id', 'hash', 'title', 'side', 'rulesEdition']) if (typeof v[k] !== 'string') e.push(`${k} must be a string`);
  if (v.side !== 'A' && v.side !== 'B') e.push('side must be "A" or "B"');
  if (!isObj(v.objective) || !OBJECTIVES.includes(v.objective.kind as ObjectiveKind)) e.push('objective.kind is missing or unsupported');
  if (!isObj(v.rubric) || !Array.isArray((v.rubric as { components?: unknown }).components)) e.push('rubric.components is missing');
  else e.push(...validateRubric(v.rubric as unknown as Rubric));
  if (!isObj(v.constraints)) e.push('constraints is missing');
  if (!isObj(v.start)) e.push('start (the position) is missing');
  else { const se = validateState(v.start); if (se.length) e.push(`start is not a valid state: ${se.slice(0, 2).join('; ')}`); }
  return e;
}

/** Check an exercise's integrity and whether this build can play it. Never repairs. */
export function checkTacticalExercise(ex: Exercise): { ok: boolean; errors: string[]; notes: string[] } {
  const errors = validateExerciseShape(ex); const notes: string[] = [];
  if (errors.length) return { ok: false, errors, notes };
  if (ex.rulesEdition !== 'faq2026' && ex.rulesEdition !== 'legacy') errors.push(`Unsupported rules edition "${ex.rulesEdition}": this build knows faq2026 and legacy and will not guess.`);
  if ((ex.start.rulesEdition ?? 'legacy') !== ex.rulesEdition) errors.push('The start position\'s rules edition differs from the exercise\'s.');
  if (exerciseHash(ex) !== ex.hash) errors.push('The exercise hash does not match its content: the file was edited or damaged.');
  if (ex.start.pending) errors.push('The start position has a pending decision, which is unsupported.');
  if (ex.engine?.rulesHash !== BUILD_FINGERPRINT.rulesHash) notes.push(`Authored with engine ${ex.engine?.version ?? 'unknown'} (different rules code). The position loads as stored; scoring re-executes under this build.`);
  return { ok: errors.length === 0, errors, notes };
}

export function serializeTraining(ex: Exercise | ExercisePack | Attempt): string { return JSON.stringify(ex); }

export function makePack(id: string, title: string, exercises: Exercise[], createdAt = new Date().toISOString()): ExercisePack {
  return { format: EXERCISE_PACK_FORMAT, version: TRAINING_VERSION, id, title, createdAt, exercises: clone(exercises) };
}

/** Import an exercise or a pack from text against the user's existing exercises. Never overwrites: same id + same content is skipped, same id + different content is a conflict. */
export function importExercises(text: string, existing: Exercise[]): ImportReport {
  const rep: ImportReport = { added: [], skipped: [], conflicts: [], errors: [] };
  let v: unknown;
  try { v = JSON.parse(text); } catch (e) { rep.errors.push(`The file is not valid JSON (${(e as Error).message}).`); return rep; }
  if (isObj(v) && (v.format === 'bloodboard-history' || v.format === 'bloodboard-history-batch')) { rep.errors.push('This is a game history, not an exercise. Open it with History / Replay.'); return rep; }
  if (isObj(v) && v.format === ATTEMPT_FORMAT) { rep.errors.push('This is an attempt record, not an exercise. Import it from the exercise\'s attempts.'); return rep; }
  let list: unknown[];
  if (isObj(v) && v.format === EXERCISE_PACK_FORMAT) {
    if (typeof v.version === 'number' && v.version > TRAINING_VERSION) { rep.errors.push(`Pack version ${v.version} is newer than this build supports.`); return rep; }
    if (!Array.isArray(v.exercises)) { rep.errors.push('The pack has no exercises array.'); return rep; }
    list = v.exercises;
  } else if (isObj(v) && v.format === EXERCISE_FORMAT) list = [v];
  else { rep.errors.push('Not a Bloodboard exercise or exercise pack.'); return rep; }
  const byId = new Map(existing.map((x) => [x.id, x]));
  const seen = new Map<string, Exercise>();
  for (const raw of list) {
    const id = isObj(raw) && typeof raw.id === 'string' ? raw.id : '(no id)';
    const ex = raw as Exercise;
    const chk = checkTacticalExercise(ex);
    if (!chk.ok) { rep.errors.push(`${id}: ${chk.errors.join(' ')}`); continue; }
    const prior = byId.get(ex.id) ?? seen.get(ex.id);
    if (prior) {
      if (prior.hash === ex.hash) rep.skipped.push({ id: ex.id, reason: 'already present (identical content)' });
      else rep.conflicts.push({ id: ex.id, reason: 'an exercise with this id but different content exists; it was NOT overwritten (rename one to keep both)' });
      continue;
    }
    seen.set(ex.id, ex); rep.added.push(clone(ex));
  }
  return rep;
}

// ---------------------------------------------------------------- attempts

export interface AttemptStart { start: GameState; boundary: { startedAt: string } }

export function newAttempt(ex: Exercise, actor: ActorInfo, opts: { id?: string; retryIndex?: number; startedAt?: string } = {}): Attempt {
  const startedAt = opts.startedAt ?? new Date().toISOString();
  return {
    format: ATTEMPT_FORMAT, version: TRAINING_VERSION, id: opts.id ?? `att-${fnv([ex.hash, startedAt, actor.kind, String(opts.retryIndex ?? 0)])}`,
    exerciseId: ex.id, exerciseHash: ex.hash, rubric: { id: ex.rubric.id, version: ex.rubric.version }, actor: clone(actor),
    labels: { hintsUsed: 0, adviceUsed: false, retryIndex: opts.retryIndex ?? 0, undos: 0 }, startedAt, elapsedMs: 0, status: 'in-progress', log: [],
    engine: { version: BUILD_FINGERPRINT.version, engineHash: BUILD_FINGERPRINT.engineHash, rulesHash: BUILD_FINGERPRINT.rulesHash },
  };
}

export interface AttemptProgress { ok: boolean; error?: string; state?: GameState; finished: boolean; why?: string; actions: number }

/** Is the attempt over (turn ended, touchdown, action limit, match phase change)? Pure function of the state and the log. */
export function attemptStatus(ex: Exercise, s: GameState, actions: number): { finished: boolean; why?: string } { return finishedCheck(ex, s, actions); }

function finishedCheck(ex: Exercise, s: GameState, actions: number): { finished: boolean; why?: string } {
  if (s.pending) return { finished: false };
  if (s.touchdown || s.teams[ex.side].score > ex.start.teams[ex.side].score) return { finished: true, why: 'touchdown' };
  if (s.phase !== 'play') return { finished: true, why: `phase changed to ${s.phase}` };
  if (s.turn.active !== ex.side || s.turn.half !== ex.start.turn.half) return { finished: true, why: 'the Turn ended' };
  if (ex.constraints.maxActions !== undefined && actions >= ex.constraints.maxActions) return { finished: true, why: 'action limit reached' };
  return { finished: false };
}

/** Re-execute an attempt's log from the exercise start. Used for resume, replay and grading. */
export function replayAttempt(ex: Exercise, a: Attempt): AttemptProgress {
  if (a.exerciseHash !== ex.hash) return { ok: false, error: 'This attempt was recorded against a different version of the exercise.', finished: false, actions: 0 };
  const v = verifyLog(ex.start, a.log);
  if (!v.ok) return { ok: false, error: `The attempt does not reproduce under the current rules (entry ${(v.at ?? 0) + 1}: ${v.error}).`, finished: false, actions: a.log.length };
  const s = v.final as GameState;
  const f = finishedCheck(ex, s, a.log.length);
  return { ok: true, state: s, finished: f.finished, why: f.why, actions: a.log.length };
}

export function validateAttemptShape(v: unknown): string[] {
  const e: string[] = [];
  if (!isObj(v)) return ['an attempt must be an object'];
  if (v.format !== ATTEMPT_FORMAT) e.push(`format must be "${ATTEMPT_FORMAT}"`);
  if (typeof v.version !== 'number') e.push('version must be a number');
  else if (v.version > TRAINING_VERSION) e.push(`attempt version ${v.version} is newer than this build supports`);
  for (const k of ['id', 'exerciseId', 'exerciseHash']) if (typeof v[k] !== 'string') e.push(`${k} must be a string`);
  if (!Array.isArray(v.log)) e.push('log must be an array');
  if (!isObj(v.actor) || (v.actor.kind !== 'human' && v.actor.kind !== 'coach')) e.push('actor.kind must be human or coach');
  if (!isObj(v.labels)) e.push('labels is missing');
  return e;
}

export function importAttempt(text: string, exercises: Exercise[], existing: Attempt[]): { ok: true; attempt: Attempt; duplicate: boolean; exercise: Exercise } | { ok: false; error: string } {
  let v: unknown;
  try { v = JSON.parse(text); } catch (e) { return { ok: false, error: `The file is not valid JSON (${(e as Error).message}).` }; }
  if (isObj(v) && v.format !== ATTEMPT_FORMAT) return { ok: false, error: 'Not an attempt record.' };
  const errs = validateAttemptShape(v); if (errs.length) return { ok: false, error: errs.join('; ') };
  const a = v as unknown as Attempt;
  const ex = exercises.find((x) => x.id === a.exerciseId);
  if (!ex) return { ok: false, error: `The exercise "${a.exerciseId}" is not in your library. Import the exercise first.` };
  if (ex.hash !== a.exerciseHash) return { ok: false, error: 'The attempt belongs to a different version of this exercise (content differs).' };
  const dup = existing.find((x) => x.id === a.id);
  if (dup && JSON.stringify(dup.log) !== JSON.stringify(a.log)) return { ok: false, error: 'An attempt with this id but different content exists; it was not overwritten.' };
  const p = replayAttempt(ex, a);
  if (!p.ok) return { ok: false, error: p.error ?? 'does not reproduce' };
  return { ok: true, attempt: clone(a), duplicate: !!dup, exercise: ex };
}

// ---------------------------------------------------------------- scoring

export interface ComponentScore { id: string; weight: number; available: boolean; mean: number | null; ci95: [number, number] | null; note?: string }
export interface StepFinding {
  /** 1-based position in the committed action sequence. */
  step: number;
  /** What the action was (from the attempt's own log). */
  title: string;
  /** Alternate-dice replays that reached this step / that ended the Turn in a Turnover at it / that lost the ball carrier at it. */
  reached: number; turnovers: number; ballLost: number;
  turnoverRate: number | null; turnoverCi95: [number, number] | null; ballLostRate: number | null;
  /** 'risk' = a Turnover here in at least 15 % of the replays that reached it, with the interval's lower end at least 5 %. */
  flag: 'risk' | 'ok' | 'thin';
  note: string;
}
export interface Divergence { reference: string; step: number; yours: string; theirs: string; referenceTotal: number | null; yourTotal: number | null; note: string }
export interface ScoreReport {
  grader: { id: string; version: string };
  exerciseHash: string;
  legal: { ok: boolean; reason?: string };
  /** What the real dice did this time. Reported separately and NEVER feeds the quality number. */
  realized: { objectiveAchieved: boolean | null; turnover: boolean; scored: boolean; actions: number; finishedBecause: string | null; finalSummary: string };
  quality: {
    graded: boolean;
    reason?: string;
    /** Weighted mean of the available components, 0-1. Null when ungraded. */
    total: number | null;
    ci95: [number, number] | null;
    components: ComponentScore[];
    samples: number;
    plannedThroughSamples: number;
    decisionPolicy: string;
    scale: string;
  };
  referenceComparison?: { label: string; total: number | null; actions: number }[];
  /** V7-11 step-level localisation: where in the committed plan the alternate-dice replays go wrong. Present only when the plan was graded. */
  steps?: StepFinding[];
  /** Where the first better-scoring reference line parts from the attempt (post-attempt, grader-side; shown only after the attempt is finished). */
  divergence?: Divergence;
  limits: string[];
  hints: { used: number }; labels: AttemptLabels;
}

const LIMITS = [
  'Plan quality grades the committed action sequence replayed on alternate dice seeds; it does not see how the player would adapt after bad dice.',
  'Components are 0-1 rates under this exercise\'s declared rubric. The number is not a calibrated playing strength or a rating.',
  'Pending decisions in a sample use the recorded choice when the same question is asked, otherwise the first option offered.',
];

function mulberry(a: number): () => number { return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const seedFor = (ex: Exercise, tag: string, i: number) => { let h = 2166136261; for (const c of `${ex.hash}|${tag}|${i}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h >>> 0; };

interface Facts { objective: boolean; turnover: boolean; scored: boolean; carrierKept: boolean; carrierStanding: boolean; adjacentEnemies: number | null; progress: number | null; actions: number; finishedBecause: string | null; summary: string; }

function goalDistance(s: GameState, team: TeamId, carrier: { location: string; pos?: { x: number } | null }): number | null {
  const p = carrier as { pos?: { x: number; y: number } | null };
  if (!p.pos) return null;
  return Math.abs(scoringEndZoneX(team) - p.pos.x);
}

function factsOf(ex: Exercise, s: GameState, log: LogEntry[], startCarrierDist: number | null): Facts {
  const side = ex.side;
  const turnover = log.some((e) => e.team === side && e.outcome === 'turnover');
  const scored = s.teams[side].score > ex.start.teams[side].score;
  const holder = ballHolder(s);
  const mine = !!holder && holder.team === side;
  const f = finishedCheck(ex, s, log.length);
  let objective = false;
  switch (ex.objective.kind) {
    case 'score': objective = scored; break;
    case 'keep-ball': objective = mine && !turnover; break;
    case 'recover-ball': objective = mine; break;
    case 'stop-carrier': objective = !(holder && holder.team !== side && holder.stance === 'standing'); break;
    case 'no-turnover': objective = !turnover; break;
  }
  // Measured against what the position offered: when the side starts with the ball, losing it scores 0 here rather than dropping the component.
  const hadBall = startCarrierDist !== null;
  let adj: number | null = null;
  if (mine && holder && (holder as { pos?: unknown }).pos) adj = playersWithin(s, (holder as { pos: { x: number; y: number } }).pos, 1, side === 'A' ? 'B' : 'A').filter((p) => p.stance === 'standing').length;
  else if (hadBall) adj = 3;
  let progress: number | null = null;
  if (hadBall && startCarrierDist! > 0) {
    progress = 0;
    if (mine && holder) { const d = goalDistance(s, side, holder as never); if (d !== null) progress = Math.max(0, Math.min(1, 1 - d / startCarrierDist!)); }
  }
  if (scored) progress = 1;
  const summary = scored ? 'touchdown' : holder ? `${holder.team === side ? 'own' : 'opposing'} player holds the ball` : 'ball loose or off the pitch';
  return { objective, turnover, scored, carrierKept: mine, carrierStanding: !!holder && mine && holder.stance === 'standing', adjacentEnemies: adj, progress, actions: log.length, finishedBecause: f.finished ? (f.why ?? null) : null, summary };
}

function startCarrierDistance(ex: Exercise): number | null {
  usePitch(ex.start);
  const h = ballHolder(ex.start);
  if (!h || h.team !== ex.side) return null;
  return goalDistance(ex.start, ex.side, h as never);
}

/** Replay a committed input sequence on a given seed with the declared decision policy. Stops (not fails) when the plan can no longer continue. */
function playSample(ex: Exercise, inputs: { input: ActionInput; decisions: { requestId: string; optionId: string; prompt?: string }[] }[], seed: number): { facts: Facts; ranAll: boolean } {
  let s = cloneState(ex.start); s.rng = { seed, counter: 0 };
  let ran = 0; let ranAll = true;
  for (const step of inputs) {
    if (finishedCheck(ex, s, ran).finished) { ranAll = ran === inputs.length; break; }
    const entry = { id: 0, team: ex.side, turn: s.turn.active === ex.side ? 0 : 0, title: '', input: step.input, events: [], decisions: [], outcome: 'completed' } as LogEntry;
    const r = tryStep(s, entry, step.decisions);
    if (!r) { ranAll = false; break; }
    s = r; ran++;
  }
  if (ran < inputs.length) ranAll = false;
  return { facts: factsOf(ex, s, s.log, startCarrierDistance(ex)), ranAll };
}

function tryStep(prev: GameState, entry: LogEntry, recorded: { requestId: string; optionId: string }[]): GameState | null {
  let out = execute(prev, clone(entry.input) as never);
  if (out.status === 'illegal') return null;
  let guard = 0;
  while ((out.state as GameState).pending && guard++ < 50) {
    const req = (out.state as GameState).pending!.request;
    const rec = recorded.find((d) => d.requestId === req.id);
    const opt = rec && req.options.some((o) => o.id === rec.optionId) ? rec.optionId : req.options[0].id;
    out = decide(out.state as GameState, { requestId: req.id, optionId: opt });
    if (out.status === 'illegal') return null;
  }
  return (out.state as GameState).pending ? null : (out.state as GameState);
}

function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), w = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - w) / d), Math.min(1, (c + w) / d)];
}

function evalSequence(ex: Exercise, steps: { input: ActionInput; decisions: { requestId: string; optionId: string }[] }[], tag: string, samples: number): { comps: ComponentScore[]; total: number | null; ci: [number, number] | null; ranAll: number; reason?: string } {
  const minSamples = ex.rubric.minSamples ?? 50;
  const vals: Record<string, number[]> = {}; let ranAll = 0;
  for (let i = 0; i < samples; i++) {
    const { facts, ranAll: ra } = playSample(ex, steps, seedFor(ex, tag, i));
    if (ra) ranAll++;
    const push = (id: string, v: number | null) => { if (v !== null) (vals[id] ??= []).push(v); };
    push('objective', facts.objective ? 1 : 0);
    push('turnoverFree', facts.turnover ? 0 : 1);
    push('ballSecurity', facts.carrierKept && facts.carrierStanding ? 1 : 0);
    push('carrierProtection', facts.adjacentEnemies === null ? null : 1 - Math.min(1, facts.adjacentEnemies / 3));
    push('progress', facts.progress);
  }
  const comps: ComponentScore[] = ex.rubric.components.map((c) => {
    if (!KNOWN_COMPONENTS.includes(c.id as ComponentId)) return { id: c.id, weight: c.weight, available: false, mean: null, ci95: null, note: 'unknown component for this grader version: ignored' };
    const v = vals[c.id] ?? [];
    if (v.length < Math.max(1, Math.ceil(samples / 2))) return { id: c.id, weight: c.weight, available: false, mean: null, ci95: null, note: 'not measurable in most samples (e.g. no ball carrier): excluded' };
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    const binary = v.every((x) => x === 0 || x === 1);
    const ci: [number, number] = binary ? wilson(v.filter((x) => x === 1).length, v.length) : (() => { const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length); const h = 1.96 * sd / Math.sqrt(v.length); return [Math.max(0, mean - h), Math.min(1, mean + h)] as [number, number]; })();
    return { id: c.id, weight: c.weight, available: true, mean, ci95: ci };
  });
  const av = comps.filter((c) => c.available);
  const objective = comps.find((c) => c.id === 'objective');
  if (samples < minSamples) return { comps, total: null, ci: null, ranAll, reason: `ungraded: ${samples} samples is below the exercise's minimum of ${minSamples}` };
  if (!objective?.available) return { comps, total: null, ci: null, ranAll, reason: 'ungraded: the objective component could not be measured' };
  const W = av.reduce((a, c) => a + c.weight, 0);
  const total = av.reduce((a, c) => a + c.weight * (c.mean as number), 0) / W;
  const lo = av.reduce((a, c) => a + c.weight * (c.ci95 as [number, number])[0], 0) / W;
  const hi = av.reduce((a, c) => a + c.weight * (c.ci95 as [number, number])[1], 0) / W;
  return { comps, total, ci: [lo, hi], ranAll };
}

const stepsOf = (log: LogEntry[]) => log.map((e) => ({ input: e.input, decisions: e.decisions.map((d) => ({ requestId: d.requestId, optionId: d.optionId })) }));


/** Per-step facts over the same alternate seeds: how often each committed action ended the Turn in a Turnover or lost the carrier. */
function stepFindings(ex: Exercise, a: Attempt, samples: number, tag: string): StepFinding[] {
  usePitch(ex.start);
  const steps = stepsOf(a.log);
  const reached = new Array(steps.length).fill(0), turn = new Array(steps.length).fill(0), lost = new Array(steps.length).fill(0);
  for (let k = 0; k < samples; k++) {
    let s = cloneState(ex.start); s.rng = { seed: seedFor(ex, tag, k), counter: 0 };
    let ran = 0;
    for (let i = 0; i < steps.length; i++) {
      if (finishedCheck(ex, s, ran).finished) break;
      const holderBefore = ballHolder(s);
      const entry = { id: 0, team: ex.side, turn: 0, title: '', input: steps[i].input, events: [], decisions: [], outcome: 'completed' } as LogEntry;
      const r = tryStep(s, entry, steps[i].decisions);
      if (!r) break;
      reached[i]++;
      const last = r.log[r.log.length - 1];
      if (last && last.team === ex.side && last.outcome === 'turnover') turn[i]++;
      const holderAfter = ballHolder(r);
      if (holderBefore && holderBefore.team === ex.side && !(holderAfter && holderAfter.team === ex.side)) lost[i]++;
      s = r; ran++;
    }
  }
  return steps.map((_, i) => {
    const n = reached[i]; const rate = n ? turn[i] / n : null; const ci = n ? wilson(turn[i], n) : null;
    const flag: StepFinding['flag'] = n < 20 ? 'thin' : rate !== null && ci !== null && rate >= 0.15 && ci[0] >= 0.05 ? 'risk' : 'ok';
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    const title = a.log[i]?.title || `action ${i + 1}`;
    const note = n === 0 ? 'No alternate-dice replay reached this step.'
      : flag === 'thin' ? `Only ${n} replays reached this step: too few to say anything about it.`
      : `${turn[i]} of the ${n} replays that reached this step ended the Turn in a Turnover here (${pct(rate!)}, 95% interval ${pct(ci![0])}–${pct(ci![1])})${lost[i] ? `; the ball carrier was lost at it in ${lost[i]}` : ''}.`;
    return { step: i + 1, title, reached: n, turnovers: turn[i], ballLost: lost[i], turnoverRate: rate, turnoverCi95: ci, ballLostRate: n ? lost[i] / n : null, flag, note };
  });
}

/** The first step at which a reference line that scored clearly higher differs from the attempt. */
function divergenceOf(ex: Exercise, a: Attempt, yourTotal: number | null, yourCi: [number, number] | null, refs: { label: string; total: number | null; ci: [number, number] | null; inputs: ActionInput[] }[]): Divergence | undefined {
  if (yourTotal === null || !yourCi) return undefined;
  const better = refs.filter((r) => r.total !== null && r.ci && r.ci[0] > yourCi[1]).sort((x, y) => (y.total as number) - (x.total as number))[0];
  if (!better) return undefined;
  const mine = a.log.map((e) => e.input);
  let k = 0; while (k < mine.length && k < better.inputs.length && JSON.stringify(mine[k]) === JSON.stringify(better.inputs[k])) k++;
  const stateAt = (inputs: ActionInput[], upTo: number): GameState | null => {
    let s = cloneState(ex.start);
    for (let i = 0; i < upTo; i++) { const r = tryStep(s, { id: 0, team: ex.side, turn: 0, title: '', input: inputs[i], events: [], decisions: [], outcome: 'completed' } as LogEntry, []); if (!r) return null; s = r; }
    return s;
  };
  const sy = stateAt(mine, k), st = stateAt(better.inputs, k);
  let yours = k < mine.length && sy ? describeInput(sy, mine[k]) : 'you stopped here';
  let theirs = k < better.inputs.length && st ? describeInput(st, better.inputs[k]) : 'it ended here';
  // Two moves can share a destination and differ only by route: say which squares each one passes through so the difference is visible.
  if (yours === theirs && k < mine.length && k < better.inputs.length) {
    const via = (i: ActionInput) => (i.kind === 'playerAction' && i.path.length ? ` (route: ${i.path.map((q) => `${q.to.x},${q.to.y}`).join(' → ')})` : '');
    yours += via(mine[k]); theirs += via(better.inputs[k]);
  }
  return { reference: better.label, step: k + 1, yours, theirs, referenceTotal: better.total, yourTotal, note: 'The other line scored higher with an interval clearly above yours under the same method. It is one legal alternative, not the only accepted answer.' };
}

/**
 * Grade an attempt. `samples` defaults to the rubric's `samples` (200). The result is deterministic for a given exercise + attempt.
 * References (grader-only) are scored by the same method for comparison.
 */
export function gradeAttempt(ex: Exercise, a: Attempt, opts: { samples?: number } = {}): ScoreReport {
  const samples = opts.samples ?? ex.rubric.samples ?? 200;
  const base = { grader: { ...GRADER }, exerciseHash: ex.hash, limits: [...LIMITS], hints: { used: a.labels.hintsUsed }, labels: clone(a.labels) };
  const rp = replayAttempt(ex, a);
  const emptyQuality = (reason: string): ScoreReport['quality'] => ({ graded: false, reason, total: null, ci95: null, components: [], samples: 0, plannedThroughSamples: 0, decisionPolicy: 'recorded choice when the same question is asked, else first option', scale: '0-1 component rates; not a rating' });
  if (!rp.ok || !rp.state) return { ...base, legal: { ok: false, reason: rp.error }, realized: { objectiveAchieved: null, turnover: false, scored: false, actions: a.log.length, finishedBecause: null, finalSummary: 'did not reproduce' }, quality: emptyQuality('ungraded: the attempt is not legal under the current rules') };
  const facts = factsOf(ex, rp.state, a.log, startCarrierDistance(ex));
  const realized = { objectiveAchieved: facts.objective, turnover: facts.turnover, scored: facts.scored, actions: a.log.length, finishedBecause: rp.why ?? null, finalSummary: facts.summary };
  if (!a.log.length) return { ...base, legal: { ok: true }, realized, quality: emptyQuality('ungraded: the attempt has no actions') };
  const ev = evalSequence(ex, stepsOf(a.log), `attempt:${a.id}`, samples);
  const report: ScoreReport = {
    ...base, legal: { ok: true }, realized,
    quality: { graded: ev.total !== null, ...(ev.reason ? { reason: ev.reason } : {}), total: ev.total, ci95: ev.ci, components: ev.comps, samples, plannedThroughSamples: ev.ranAll, decisionPolicy: 'recorded choice when the same question is asked, else first option', scale: '0-1 weighted mean of the declared components; not a rating' },
  };
  if (report.quality.graded) report.steps = stepFindings(ex, a, samples, `attempt:${a.id}`);
  if (ex.references?.length) {
    const evs = ex.references.map((r) => ({ r, e: evalSequence(ex, r.inputs.map((input) => ({ input, decisions: [] })), `ref:${r.label}`, samples) }));
    report.referenceComparison = evs.map(({ r, e }) => ({ label: r.label, total: e.total, actions: r.inputs.length }));
    const dv = divergenceOf(ex, a, ev.total, ev.ci, evs.map(({ r, e }) => ({ label: r.label, total: e.total, ci: e.ci, inputs: r.inputs })));
    if (dv) report.divergence = dv;
  }
  return report;
}

export { applyEntry };
