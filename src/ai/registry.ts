/**
 * V5.5: the AI files — every computer coach the game can use (docs/AI_EXTENSIONS.md).
 *
 * Each selectable AI is its own named file with an id, a version and a display name, found in the AI folder:
 *  - parameter files (`*.json`, format "bloodboard-ai", formatVersion 1): a configuration of an installed algorithm —
 *    so far the built-in Bloodboard algorithm (implementation "bloodboard"): weight multipliers of its evaluation,
 *    named preferences, conditional settings (score, time, possession, format), objective thresholds and the search
 *    budget. Several files may share the same algorithm (the bundled "Bloodboard AI — Balanced / Offensive /
 *    Defensive" are three such files); each is a separate choice;
 *  - strategy modules (`*.js`, strategy API 1, src/ui/strategy.ts): different decision logic, run in an isolated
 *    worker; the rules engine validates everything they propose.
 * There is no separate style setting: the selectors list exactly the valid files found — one file, one choice; none,
 * none (the set-up then offers to restore the bundled files). Invalid files are listed with their errors and cannot
 * be chosen. The same list serves Player 1, Player 2, computer v computer and the advisory coach (AI Focus).
 */
import { BASE_WEIGHTS, type Weights } from './evaluate';

export const AI_API_VERSION = 1;
export const AI_FORMAT = 'bloodboard-ai';
export const AI_FORMAT_VERSION = 1;
/** The built-in algorithm the parameter files configure. */
export const BUILTIN_IMPLEMENTATION = 'bloodboard';
export const BUILTIN_ALGORITHM_VERSION = '5.5';
/** The bundled file used when a saved choice is missing (if it is installed). */
export const DEFAULT_AI_ID = 'bloodboard-balanced';

export type CoachKind = 'parameters' | 'strategy';

/** Named preferences a file may set (−1 … +1), mapped onto the evaluation's weights. */
export const PREFERENCES: Record<string, { text: string; apply: (w: Weights, v: number) => void }> = {
  riskTolerance: { text: 'Accept riskier actions (+) or avoid Turnovers more (−).', apply: (w, v) => (w.turnoverCost *= 1 - 0.4 * v) },
  aggression: { text: 'Mark, press and block more (+) or less (−).', apply: (w, v) => { w.pressure *= 1 + 0.4 * v; w.pressureReach *= 1 + 0.4 * v; w.marking *= 1 + 0.5 * v; } },
  ballSecurity: { text: 'Protect the ball carrier more (+) or less (−).', apply: (w, v) => { w.carrierMarked *= 1 + 0.4 * v; w.carrierExposed *= 1 + 0.4 * v; w.cage *= 1 + 0.5 * v; } },
  tempo: { text: 'Move the ball forward faster (+) or slower (−).', apply: (w, v) => { w.progress *= 1 + 0.35 * v; w.receivers *= 1 + 0.5 * v; } },
  defence: { text: 'Screen the End Zone and contain more (+) or less (−).', apply: (w, v) => { w.screen *= 1 + 0.5 * v; w.contain *= 1 + 0.5 * v; w.oppProgress *= 1 + 0.3 * v; } },
  attrition: { text: 'Value knocking opponents down and keeping own players up more (+) or less (−).', apply: (w, v) => { w.standing *= 1 + 0.3 * v; w.prone *= 1 + 0.3 * v; w.stunned *= 1 + 0.3 * v; } },
};

export interface ProfileCondition {
  when: {
    /** Own score minus the opponent's, inclusive range. */
    scoreDiff?: [number, number];
    /** Own Turns left in the half (after this one), inclusive range. */
    turnsLeft?: [number, number];
    half?: 1 | 2;
    possession?: 'us' | 'them' | 'loose';
    format?: 'standard' | 'sevens';
  };
  /** Weight multipliers applied while the condition holds. */
  weights?: Partial<Record<keyof Weights, number>>;
  preferences?: Partial<Record<string, number>>;
}

export interface AIParameters {
  /** Multipliers of the built-in evaluation's base weights (0 … 5). */
  weights?: Partial<Record<keyof Weights, number>>;
  preferences?: Partial<Record<string, number>>;
  conditions?: ProfileCondition[];
  /** When the ball carrier needs protecting: at least this many opponents able to reach him (1-4), and fewer than this many team-mates next to him (0-4). */
  objectives?: { protectThreats?: number; protectCageBelow?: number };
  /** Thinking budget: pre-screened candidates enumerated exactly, outcome leaves, the smallest branch expanded, the least gain worth acting for. */
  search?: { maxExplored?: number; maxLeaves?: number; threshold?: number; minGain?: number };
}

/** A parameter AI file (`*.json`). */
export interface AIFile {
  format: typeof AI_FORMAT;
  formatVersion: 1;
  apiVersion: number;
  id: string;
  name: string;
  /** The file's own version, e.g. "1.0" or "5.5.0". */
  version: string;
  description?: string;
  author?: string;
  /** The algorithm this file configures (installed implementations: "bloodboard"). */
  implementation: string;
  parameters?: AIParameters;
  /** Formats the file is meant for (default both). */
  formats?: Array<'standard' | 'sevens'>;
}

/** Older name kept for callers. */
export type ProfileFile = AIFile;

/** V6: the capability manifest of a coach (API v2). Built-in coaches and legacy modules get one derived by the host. */
export interface CoachCapabilities {
  chooseRoster: boolean;
  buildTeam: boolean;
  chooseFieldedPlayers: boolean;
  chooseSetup: boolean;
  chooseKick: boolean;
  playTurn: boolean;
  ruleDecisions: boolean;
  persistentContext: boolean;
  controlledSimulation: boolean;
}

export interface CoachEntry {
  /** The file's id. */
  id: string;
  name: string;
  kind: CoachKind;
  /** The algorithm that makes the decisions: "bloodboard" (built-in) or "strategy:<id>". */
  implementation: string;
  /** The file's version. */
  version: string;
  description: string;
  /** File name in the AI folder. */
  source?: string;
  /** Why it cannot be used (invalid file, unsupported API version…). */
  errors?: string[];
  profile?: AIFile;
  /** Strategy modules: the code (run in a worker). */
  code?: string;
  timeLimitMs?: number;
  /** Strategy modules (V5.6): the additive API minor the module was written for, and the services it requires. */
  apiMinor?: number;
  requires?: string[];
  /** V6: the module API generation (1 or 2) and, for API v2, what the module offers / needs (see docs/AI_API_V2.md). */
  apiGeneration?: number;
  contextSchema?: string;
  capabilities?: CoachCapabilities;
  requiresCapabilities?: string[];
  formats?: Array<'standard' | 'sevens'>;
  /** V7-01: what loading this file costs (accounted, not capped): script size in bytes and a 'large' flag above the warning level. */
  resource?: { bytes: number; level: 'normal' | 'large' };
}

/**
 * Last resort only — a saved match whose AI file is gone and no AI file is installed at all: the built-in algorithm
 * with its default parameters, labelled as such. Never offered in a selector.
 */
export const NO_FILE_FALLBACK: CoachEntry = {
  id: '(built-in defaults)',
  name: 'Built-in algorithm, default parameters (no AI file installed)',
  kind: 'parameters',
  implementation: BUILTIN_IMPLEMENTATION,
  version: BUILTIN_ALGORITHM_VERSION,
  description: 'Used only because no AI file is installed: the built-in Bloodboard algorithm with its default parameters.',
};

let loaded: CoachEntry[] = [];

/** Every AI file found (valid and invalid), in the order found. */
export function listCoaches(): CoachEntry[] {
  return loaded;
}

export function coachById(id: string | undefined): CoachEntry | undefined {
  return id ? loaded.find((c) => c.id === id && !c.errors?.length) ?? loaded.find((c) => c.id === id) : undefined;
}

/** Valid files, optionally only those meant for a format. */
export function usableCoaches(format?: 'standard' | 'sevens'): CoachEntry[] {
  return loaded.filter((c) => !c.errors?.length && (!format || !c.formats || c.formats.includes(format)));
}

/** The file used when a chosen one is missing: the bundled Balanced file if installed, else the first valid file. */
export function fallbackCoach(format?: 'standard' | 'sevens'): CoachEntry | null {
  const u = usableCoaches(format);
  return u.find((c) => c.id === DEFAULT_AI_ID) ?? u[0] ?? null;
}

/** V5 step 6 and older saves named the built-in AI "bloodboard" with a style: the bundled file of that name. */
export function legacyAiId(ai: string | undefined, style?: string): string {
  if (!ai || ai === 'bloodboard') return `bloodboard-${style === 'offensive' || style === 'defensive' ? style : 'balanced'}`;
  return ai;
}

/** Replace the loaded files (after reading the AI folder). */
export function setLoadedCoaches(list: CoachEntry[]): void {
  loaded = list;
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const ID_RE = /^[a-z0-9][a-z0-9-_.]{1,48}$/i;

/** Validate a parameter AI file's text. Returns the entry (with `errors` when it is not usable). */
export function parseAIFile(text: string, source: string): CoachEntry {
  const errors: string[] = [];
  let v: Partial<AIFile> & Record<string, unknown> = {};
  try {
    v = JSON.parse(text);
  } catch (e) {
    return { id: `file:${source}`, name: source, kind: 'parameters', implementation: '?', version: '?', description: '', source, errors: [`Not valid JSON: ${(e as Error).message}`] };
  }
  if (v.format !== AI_FORMAT) errors.push(`format must be "${AI_FORMAT}".`);
  if (v.formatVersion !== AI_FORMAT_VERSION) errors.push(`formatVersion must be ${AI_FORMAT_VERSION}.`);
  if (v.apiVersion !== AI_API_VERSION) errors.push(`apiVersion ${String(v.apiVersion)} is not supported (this app: ${AI_API_VERSION}).`);
  if (typeof v.id !== 'string' || !ID_RE.test(v.id)) errors.push('id: 2-49 letters, digits, ".", "-" or "_".');
  if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > 70) errors.push('name: 1-70 characters.');
  if (typeof v.version !== 'string' || !v.version.trim() || v.version.length > 20) errors.push('version: a short text such as "1.0".');
  if (v.implementation !== BUILTIN_IMPLEMENTATION) errors.push(`implementation "${String(v.implementation)}" is not installed (installed: "${BUILTIN_IMPLEMENTATION}"; other algorithms come as strategy modules, *.js).`);
  if ('style' in v) errors.push('"style" is not supported: put the parameters in "parameters" (each configuration is its own AI file).');
  const checkWeights = (w: unknown, where: string): void => {
    if (w === undefined) return;
    if (typeof w !== 'object' || w === null) {
      errors.push(`${where}: must be an object of weight multipliers.`);
      return;
    }
    for (const [k, x] of Object.entries(w)) {
      if (!(k in BASE_WEIGHTS)) errors.push(`${where}.${k}: unknown weight (supported: ${Object.keys(BASE_WEIGHTS).join(', ')}).`);
      else if (!isNum(x) || x < 0 || x > 5) errors.push(`${where}.${k}: a multiplier from 0 to 5.`);
    }
  };
  const checkPrefs = (p: unknown, where: string): void => {
    if (p === undefined) return;
    if (typeof p !== 'object' || p === null) {
      errors.push(`${where}: must be an object.`);
      return;
    }
    for (const [k, x] of Object.entries(p)) {
      if (!PREFERENCES[k]) errors.push(`${where}.${k}: unknown preference (supported: ${Object.keys(PREFERENCES).join(', ')}).`);
      else if (!isNum(x) || x < -1 || x > 1) errors.push(`${where}.${k}: a number from -1 to 1.`);
    }
  };
  const range = (x: unknown, lo: number, hi: number, where: string) => {
    if (x !== undefined && (!isNum(x) || x < lo || x > hi)) errors.push(`${where}: a number from ${lo} to ${hi}.`);
  };
  const P = v.parameters as AIParameters | undefined;
  if (P !== undefined && (typeof P !== 'object' || P === null)) errors.push('parameters: must be an object.');
  else if (P) {
    const known = ['weights', 'preferences', 'conditions', 'objectives', 'search'];
    for (const k of Object.keys(P)) if (!known.includes(k)) errors.push(`parameters.${k}: unsupported (supported: ${known.join(', ')}).`);
    checkWeights(P.weights, 'parameters.weights');
    checkPrefs(P.preferences, 'parameters.preferences');
    if (P.objectives !== undefined) {
      range(P.objectives.protectThreats, 1, 4, 'parameters.objectives.protectThreats');
      range(P.objectives.protectCageBelow, 0, 4, 'parameters.objectives.protectCageBelow');
    }
    if (P.search !== undefined) {
      range(P.search.maxExplored, 1, 40, 'parameters.search.maxExplored');
      range(P.search.maxLeaves, 100, 20000, 'parameters.search.maxLeaves');
      range(P.search.threshold, 1e-6, 1e-2, 'parameters.search.threshold');
      range(P.search.minGain, 0, 5, 'parameters.search.minGain');
    }
    if (P.conditions !== undefined) {
      if (!Array.isArray(P.conditions) || P.conditions.length > 12) errors.push('parameters.conditions: a list of at most 12 entries.');
      else
        P.conditions.forEach((c, i) => {
          const w = (c?.when ?? {}) as Record<string, unknown>;
          const r2 = (r: unknown, name: string) => {
            if (r === undefined) return;
            if (!Array.isArray(r) || r.length !== 2 || !isNum(r[0]) || !isNum(r[1]) || r[0] > r[1]) errors.push(`parameters.conditions[${i}].when.${name}: [min, max].`);
          };
          r2(w.scoreDiff, 'scoreDiff');
          r2(w.turnsLeft, 'turnsLeft');
          if (w.half !== undefined && w.half !== 1 && w.half !== 2) errors.push(`parameters.conditions[${i}].when.half: 1 or 2.`);
          if (w.possession !== undefined && !['us', 'them', 'loose'].includes(w.possession as string)) errors.push(`parameters.conditions[${i}].when.possession: us, them or loose.`);
          if (w.format !== undefined && !['standard', 'sevens'].includes(w.format as string)) errors.push(`parameters.conditions[${i}].when.format: standard or sevens.`);
          const knownW = ['scoreDiff', 'turnsLeft', 'half', 'possession', 'format'];
          for (const k of Object.keys(w)) if (!knownW.includes(k)) errors.push(`parameters.conditions[${i}].when.${k}: unsupported condition (supported: ${knownW.join(', ')}).`);
          checkWeights(c?.weights, `parameters.conditions[${i}].weights`);
          checkPrefs(c?.preferences, `parameters.conditions[${i}].preferences`);
        });
    }
  }
  if (v.formats !== undefined && (!Array.isArray(v.formats) || v.formats.some((f) => f !== 'standard' && f !== 'sevens'))) errors.push('formats: a list of "standard" and/or "sevens".');
  const f = v as AIFile;
  return {
    id: typeof v.id === 'string' && ID_RE.test(v.id) ? v.id : `file:${source}`,
    name: typeof v.name === 'string' && v.name.trim() ? v.name : source,
    kind: 'parameters',
    implementation: BUILTIN_IMPLEMENTATION,
    version: typeof v.version === 'string' ? v.version : '?',
    description: typeof v.description === 'string' ? v.description.slice(0, 500) : `A configuration of the built-in Bloodboard algorithm.`,
    source,
    errors: errors.length ? errors : undefined,
    profile: errors.length ? undefined : f,
    formats: Array.isArray(v.formats) ? v.formats : undefined,
  };
}

/** Older name kept for callers. */
export const parseProfile = parseAIFile;

export interface ProfileContext {
  scoreDiff: number;
  turnsLeft: number;
  half: 1 | 2;
  possession: 'us' | 'them' | 'loose';
  format: 'standard' | 'sevens';
}

/** The weights of an AI file in a situation: base weights × the file's multipliers, preferences and matching conditions. */
export function profileWeights(base: Weights, p: AIFile | undefined, c: ProfileContext): Weights {
  const w = { ...base };
  const P = p?.parameters;
  if (!P) return w;
  const mult = (m?: Partial<Record<keyof Weights, number>>) => {
    for (const [k, x] of Object.entries(m ?? {})) if (k in w && isNum(x)) (w as unknown as Record<string, number>)[k] *= x;
  };
  const prefs = (m?: Partial<Record<string, number>>) => {
    for (const [k, x] of Object.entries(m ?? {})) if (PREFERENCES[k] && isNum(x)) PREFERENCES[k].apply(w, Math.max(-1, Math.min(1, x)));
  };
  mult(P.weights);
  prefs(P.preferences);
  for (const cond of P.conditions ?? []) {
    const wh = cond.when;
    if (wh.scoreDiff && (c.scoreDiff < wh.scoreDiff[0] || c.scoreDiff > wh.scoreDiff[1])) continue;
    if (wh.turnsLeft && (c.turnsLeft < wh.turnsLeft[0] || c.turnsLeft > wh.turnsLeft[1])) continue;
    if (wh.half && wh.half !== c.half) continue;
    if (wh.possession && wh.possession !== c.possession) continue;
    if (wh.format && wh.format !== c.format) continue;
    mult(cond.weights);
    prefs(cond.preferences);
  }
  return w;
}

/**
 * The bundled parameter profile. Hopeful 1.5.9 is supplied as a strategy module in ai/.
 */
export const BUNDLED_FILES: AIFile[] = [
  {
    format: AI_FORMAT,
    formatVersion: 1,
    apiVersion: AI_API_VERSION,
    id: 'bloodboard-balanced',
    name: 'Bloodboard AI — Balanced',
    version: '5.5.0',
    description: 'The built-in Bloodboard algorithm with its default parameters: weighs attack, ball safety and defence evenly.',
    author: 'Bloodboard',
    implementation: BUILTIN_IMPLEMENTATION,
    parameters: { objectives: { protectThreats: 2, protectCageBelow: 2 } },
  },

];

/** Entries for files given as parsed objects (tests, self-play). */
export function entriesFromFiles(files: AIFile[]): CoachEntry[] {
  return files.map((f) => parseAIFile(JSON.stringify(f), `${f.id}.json`));
}
