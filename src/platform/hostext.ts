/**
 * V5.8 host extensions — ONE contract for the Mac game and the Match Lab (batch platform). Everything the two delivery paths
 * must agree on lives here and nowhere else:
 *
 *  - the optional set-up hook: the request a module receives (`buildSetupRequest`) and the validation of its answer
 *    (`checkSetupAnswer`, which ends in the engine's own `matchInputReason`);
 *  - host-managed coach context: JSON clone, 8 KB UTF-8 limit, and a store keyed by match instance, team and coach id
 *    (`CoachContextStore`) whose tickets make late, cancelled, superseded and stale answers harmless;
 *  - the capability flags (`hostExtensions`) and the public Wizard resource (`strategicPublic.wizardAvailable`).
 *
 * Nothing here reads private state: no dice generator, seed, counter or future die is ever stored or exposed.
 */
import type { Coord, GameState, TeamId } from '../engine/index';
import { E } from '../ai/engine';

export const COACH_CONTEXT_MAX_BYTES = 8192;
export const HOST_EXTENSIONS_VERSION = '1.0';

// ---------------------------------------------------------------------------------------------------------------------
// Coach context
// ---------------------------------------------------------------------------------------------------------------------

export type ContextCheck = { ok: true; value: unknown } | { ok: false; reason: string };

/** JSON-clone a context value and enforce the byte limit. `undefined` means "not supplied" (never an error, never an erase). */
export function cloneCoachContext(raw: unknown): ContextCheck {
  if (raw === undefined) return { ok: false, reason: 'absent' };
  let text: string | undefined;
  try {
    text = JSON.stringify(raw);
  } catch {
    return { ok: false, reason: 'not JSON-serialisable' };
  }
  if (text === undefined) return { ok: false, reason: 'not JSON-serialisable' };
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > COACH_CONTEXT_MAX_BYTES) return { ok: false, reason: `over ${COACH_CONTEXT_MAX_BYTES} bytes (${bytes})` };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, reason: 'not JSON-serialisable' };
  }
}

/** What the host did with a module's `coachContext` in one request (goes into the decision log). */
export interface ContextReport {
  /** The context the module was given (its size in bytes), or null when none was stored. */
  supplied: number | null;
  /** The module's response carried a `coachContext` key. */
  returned: boolean;
  /** It was valid, within the limit and committed for the current request. */
  committed: boolean;
  /** Why it was not committed (absent / invalid / oversized / stale request / no store). */
  ignored?: string;
}

let storeSeq = 1;

/** V6: why a coach's stored context is absent. Structured, so a coach (and a log) can tell "never had one" from "was reset". */
export type ContextResetCode = 'new-match' | 'replace' | 'load' | 'undo' | 'coach-changed' | 'coach-version-changed' | 'schema-changed' | 'save-incompatible' | 'not-saved' | 'superseded' | 'rejected';
export interface ContextResetReason {
  code: ContextResetCode;
  detail?: string;
}

/** Identity a stored context is valid for. A change of any of the three means the context is NOT given to the coach. */
export interface ContextIdentity {
  coachId: string;
  coachVersion?: string;
  schema?: string;
}

interface CtxEntry {
  value: unknown;
  coachId: string;
  coachVersion: string;
  schema: string;
  /** Number of log entries when it was committed (the position it describes). */
  atLog: number;
}
const CHECKPOINTS = 24;

/**
 * Coach contexts of ONE match instance, by team and coach id. The Mac game owns one for the open board; every headless
 * match owns its own (so sequential games, parallel games, swapped-side pairs and both sides running the same coach can never
 * see each other's data). `invalidate()` is called when the match is replaced or loaded: every ticket issued before
 * it stops being current and every stored value is dropped. `rewind()` is Undo: the context returns to the newest
 * checkpoint that describes a position at or before the restored one, or is reset — it never describes a position that
 * did not happen (V6).
 */
export class CoachContextStore {
  /** Distinguishes match instances (diagnostics only). */
  readonly instance = storeSeq++;
  private epoch = 0;
  private values = new Map<string, CtxEntry>();
  private history = new Map<string, CtxEntry[]>();
  private latest = new Map<string, number>();
  /** Public-history cursor per team/coach: events after it have not been shown to that coach yet (API v2 `sinceLast`). */
  private seenLog = new Map<string, number>();
  private coachOf: Partial<Record<TeamId, string>> = {};
  private resets: Partial<Record<TeamId, ContextResetReason>> = {};
  private seq = 0;

  private key(team: TeamId, coach: string) { return `${team}\u0000${coach}`; }

  /** Drop everything and make all earlier tickets stale (new match, state replacement or loading). */
  invalidate(reason: ContextResetReason = { code: 'replace' }): void {
    this.epoch++;
    this.values.clear();
    this.history.clear();
    this.latest.clear();
    this.seenLog.clear();
    this.coachOf = {};
    this.resets = { A: reason, B: reason };
  }

  /** Undo: restore each side's context to its newest checkpoint at or before `logLength`, else reset it. Stale-ifies in-flight requests. */
  rewind(logLength: number): void {
    this.epoch++;
    this.latest.clear();
    for (const [k, v] of this.seenLog) this.seenLog.set(k, Math.min(v, logLength));
    const keep = new Map<string, CtxEntry>();
    for (const [k, list] of this.history) {
      const ok = list.filter((e) => e.atLog <= logLength);
      this.history.set(k, ok);
      if (ok.length) keep.set(k, ok[ok.length - 1]);
    }
    for (const t of ['A', 'B'] as TeamId[]) {
      const had = [...this.values.keys()].some((k) => k.startsWith(`${t}\u0000`));
      const has = [...keep.keys()].some((k) => k.startsWith(`${t}\u0000`));
      if (had && !has) this.resets[t] = { code: 'undo', detail: 'no checkpoint at or before the restored position' };
      else if (had) delete this.resets[t];
    }
    this.values = keep;
  }

  /** Contexts worth saving with a match: one per side, for the coach currently playing it. */
  persistable(): Partial<Record<TeamId, { coachId: string; coachVersion: string; schemaVersion: string; stateRevision: number; payload: unknown }>> | undefined {
    const out: Partial<Record<TeamId, { coachId: string; coachVersion: string; schemaVersion: string; stateRevision: number; payload: unknown }>> = {};
    for (const t of ['A', 'B'] as TeamId[]) {
      const c = this.coachOf[t];
      const e = c ? this.values.get(this.key(t, c)) : undefined;
      if (e) out[t] = { coachId: e.coachId, coachVersion: e.coachVersion, schemaVersion: e.schema, stateRevision: e.atLog, payload: JSON.parse(JSON.stringify(e.value)) };
    }
    return Object.keys(out).length ? out : undefined;
  }

  /**
   * Re-instate saved contexts after loading a match. A side's context is restored only when the coach now playing that side
   * has the same id, version and context schema, and it describes the loaded position; otherwise it is dropped with a
   * structured reason (never silently used).
   */
  restore(saved: Partial<Record<TeamId, { coachId: string; coachVersion: string; schemaVersion: string; stateRevision: number; payload: unknown } | null>> | undefined, now: Partial<Record<TeamId, ContextIdentity>>, logLength: number): Partial<Record<TeamId, ContextResetReason | 'restored'>> {
    const report: Partial<Record<TeamId, ContextResetReason | 'restored'>> = {};
    for (const t of ['A', 'B'] as TeamId[]) {
      const s = saved?.[t];
      const id = now[t];
      if (!s) { report[t] = { code: 'not-saved' }; this.resets[t] = report[t] as ContextResetReason; continue; }
      let why: ContextResetReason | null = null;
      if (!id || id.coachId !== s.coachId) why = { code: 'coach-changed', detail: `saved for ${s.coachId}` };
      else if ((id.coachVersion ?? '') !== s.coachVersion) why = { code: 'coach-version-changed', detail: `saved for version ${s.coachVersion}` };
      else if ((id.schema ?? '') !== s.schemaVersion) why = { code: 'schema-changed', detail: `saved for schema ${s.schemaVersion}` };
      else if (s.stateRevision > logLength + 1) why = { code: 'save-incompatible', detail: 'the context describes a later position than the one loaded' };
      else {
        const c = cloneCoachContext(s.payload);
        if (!c.ok) why = { code: 'rejected', detail: c.reason };
        else {
          const k = this.key(t, s.coachId);
          const e: CtxEntry = { value: c.value, coachId: s.coachId, coachVersion: s.coachVersion, schema: s.schemaVersion, atLog: s.stateRevision };
          this.values.set(k, e);
          this.history.set(k, [e]);
          this.coachOf[t] = s.coachId;
          delete this.resets[t];
          report[t] = 'restored';
          continue;
        }
      }
      report[t] = why;
      this.resets[t] = why;
    }
    return report;
  }

  /** Why a team's context is absent right now, if it was reset (undefined: never had one, or has one). */
  resetReasonOf(team: TeamId): ContextResetReason | undefined { return this.resets[team]; }

  /** Number of stored contexts (tests). */
  get size(): number { return this.values.size; }

  /** Stored context of one team/coach (a clone), or undefined. */
  peek(team: TeamId, coach: string): unknown {
    const v = this.values.get(this.key(team, coach));
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v.value));
  }

  /**
   * A ticket for one request of `coach` playing `team`. Switching the coach of a team drops that team's older contexts, so
   * a coach never sees what another coach stored (not even after switching back).
   */
  ticket(team: TeamId, coach: string, meta: { version?: string; schema?: string; logLength?: number } = {}): ContextTicket {
    if (this.coachOf[team] !== coach) {
      const had = [...this.values.keys()].some((k) => k.startsWith(`${team}\u0000`));
      for (const k of [...this.values.keys()]) if (k.startsWith(`${team}\u0000`)) { this.values.delete(k); this.history.delete(k); this.seenLog.delete(k); }
      if (had) this.resets[team] = { code: 'coach-changed' };
      this.coachOf[team] = coach;
    }
    const k = this.key(team, coach);
    const e0 = this.values.get(k);
    if (e0 && ((e0.coachVersion || '') !== (meta.version ?? '') || (e0.schema || '') !== (meta.schema ?? ''))) {
      this.values.delete(k);
      this.history.delete(k);
      this.resets[team] = (e0.coachVersion || '') !== (meta.version ?? '') ? { code: 'coach-version-changed' } : { code: 'schema-changed' };
    }
    const n = ++this.seq;
    this.latest.set(k, n);
    const epoch = this.epoch;
    const given = this.peek(team, coach);
    const current = () => this.epoch === epoch && this.latest.get(k) === n;
    const reason = given === undefined ? this.resets[team] : undefined;
    return {
      value: given,
      resetReason: reason,
      sinceLog: this.seenLog.get(k),
      markSeen: (logLength: number) => { if (current()) this.seenLog.set(k, logLength); },
      current,
      commit: (raw: unknown): ContextReport => {
        const base: ContextReport = { supplied: given === undefined ? null : new TextEncoder().encode(JSON.stringify(given)).length, returned: raw !== undefined, committed: false };
        if (raw === undefined) return { ...base, ignored: 'no coachContext in the response' };
        if (!current()) return { ...base, ignored: 'the request was superseded, cancelled or the match was replaced' };
        const c = cloneCoachContext(raw);
        if (!c.ok) return { ...base, ignored: c.reason };
        const entry: CtxEntry = { value: c.value, coachId: coach, coachVersion: meta.version ?? '', schema: meta.schema ?? '', atLog: meta.logLength ?? 0 };
        this.values.set(k, entry);
        const h = this.history.get(k) ?? [];
        h.push(entry);
        if (h.length > CHECKPOINTS) h.shift();
        this.history.set(k, h);
        delete this.resets[team];
        return { ...base, committed: true };
      },
    };
  }
}

export interface ContextTicket {
  /** The context to hand to the module (a private clone; undefined when none is stored). */
  value: unknown;
  /** V6: why there is no context although one may have existed (reset by load, undo, coach/version/schema change …). */
  resetReason?: ContextResetReason;
  /** V6: public-history index this coach has already seen (undefined before its first request). */
  sinceLog?: number;
  /** V6: the host calls this after the coach's answer was accepted, with the history length after applying it. */
  markSeen(logLength: number): void;
  /** Still the newest request of this team/coach in the same match instance. */
  current(): boolean;
  /** Commit the module's `coachContext` — only legal-answer callers use it; returns what happened. */
  commit(raw: unknown): ContextReport;
}

// ---------------------------------------------------------------------------------------------------------------------
// Capabilities and public resources
// ---------------------------------------------------------------------------------------------------------------------

export interface HostExtensions { setup: true; coachContext: boolean }

/** The capability block. `coachContext` is only advertised where a store really backs it (never for advice-only requests). */
export function hostExtensions(opts: { coachContext: boolean }): HostExtensions {
  return { setup: true, coachContext: opts.coachContext };
}

/**
 * Remaining unspent Sports-Wizard resources, from the match's real Inducement bookkeeping. A side is only reported when the
 * match records inducements at all (otherwise the answer is unknown and the key is omitted). The timing window for casting
 * (end of a Turn) is deliberately NOT considered: "available" means "bought and not yet cast".
 */
export function wizardAvailable(s: GameState): Partial<Record<TeamId, boolean>> | undefined {
  if (!s.match || !s.match.inducements) return undefined;
  const out: Partial<Record<TeamId, boolean>> = {};
  for (const t of ['A', 'B'] as TeamId[]) {
    if (!s.match.inducements[t]) continue;
    out[t] = E.induceLeft(s, t, 'wizard') > 0;
  }
  return Object.keys(out).length ? out : undefined;
}

export function strategicPublic(s: GameState): { wizardAvailable: Partial<Record<TeamId, boolean>> } | undefined {
  const w = wizardAvailable(s);
  return w ? { wizardAvailable: w } : undefined;
}

// ---------------------------------------------------------------------------------------------------------------------
// Set-up hook
// ---------------------------------------------------------------------------------------------------------------------

export interface SetupRequest {
  /** The legal formation the host would use (the built-in default). Null = not fielded this Drive. */
  defaultPositions: Record<string, Coord | null>;
  /** The players the host has fixed to be on the pitch (roster/bench/Captain/Star selection is not the hook's business). */
  fieldedIds: string[];
  /** Compatibility alias of `fieldedIds`. */
  fixedPlayerIds: string[];
  /** Every square of this team's own set-up area. */
  legalSquares: Coord[];
  lineOfScrimmage: number;
  /** Centre Field rows, inclusive. */
  centreRows: { min: number; max: number };
  /** Fewest players that must stand on the Line of Scrimmage in the Centre Field. */
  minLine: number;
  /** True with 3 or fewer fielded players: then ALL of them must be on the Line of Scrimmage in the Centre Field. */
  allOnLine: boolean;
  /** Most players allowed in each Wide Zone. */
  maxWide: number;
  /** Rows of the Wide Zones (top: 0..wide-1, bottom: h-wide..h-1) and the pitch size. */
  wideRows: number;
  pitch: { w: number; h: number };
  format: 'standard' | 'sevens';
  /**
   * V6 (API v2): who may be fielded. `fixed` (legacy modules): the host fixed the fielded players, the module only places
   * them. `free` (API v2 modules): the module chooses WHICH of `candidates` take the pitch (exactly `count`, or fewer only
   * if fewer are available) and where; the engine's own set-up check decides legality.
   */
  fielding: {
    mode: 'fixed' | 'free';
    count: number;
    candidates: Array<{ id: string; number: number; position: string; ma: number; st: number; ag: number; pa: number | null; av: number; skills: string[]; star?: string; captain?: boolean; onPitch: boolean }>;
    /** Players the rules require on the pitch (Team Captain). */
    mustField: string[];
  };
}

/** Constraints come from the ACTIVE ruleset (pitch geometry, players per Drive, Wide-Zone cap), never from constants of this file. */
export function buildSetupRequest(s: GameState, team: TeamId, o: { free?: boolean } = {}): SetupRequest {
  E.usePitch(s);
  const R = E.rulesFor(s);
  const g = R.pitch;
  const defaultPositions = E.defaultFormation(s, team);
  const fieldedIds = Object.keys(defaultPositions).filter((id) => defaultPositions[id] !== null);
  const legalSquares: Coord[] = [];
  for (let x = 0; x < g.w; x++) for (let y = 0; y < g.h; y++) if (E.inOwnHalf(team, { x, y })) legalSquares.push({ x, y });
  const allOnLine = fieldedIds.length <= 3;
  return {
    defaultPositions,
    fieldedIds,
    fixedPlayerIds: fieldedIds.slice(),
    legalSquares,
    lineOfScrimmage: E.losColumn(team),
    centreRows: { min: g.wide, max: g.h - g.wide - 1 },
    minLine: allOnLine ? fieldedIds.length : 3,
    allOnLine,
    maxWide: R.maxPerWideZone,
    wideRows: g.wide,
    pitch: { w: g.w, h: g.h },
    format: R.variant === 'sevens' ? 'sevens' : 'standard',
    fielding: (() => {
      const cands = E.setupCandidates(s, team);
      const cap = !!s.teams[team].specialRules?.includes('Team Captain');
      return {
        mode: o.free ? ('free' as const) : ('fixed' as const),
        count: Math.min(R.playersPerDrive, cands.length),
        candidates: cands.map((p) => ({ id: p.id, number: p.number, position: p.position, ma: p.ma, st: p.st, ag: p.ag, pa: p.pa, av: p.av, skills: p.skills.map((k) => (k.value ? `${k.id}(${k.value})` : k.id)), ...(p.star ? { star: p.star } : {}), ...(p.captain ? { captain: true } : {}), onPitch: p.location === 'pitch' })),
        mustField: cands.filter((p) => cap && p.captain).map((p) => p.id),
      };
    })(),
  };
}

export type SetupCheck = { ok: true; input: { kind: 'setupTeam'; team: TeamId; positions: Record<string, Coord | null> }; why: string } | { ok: false; reason: string };

/**
 * Validate a module's set-up answer. Order: shape → phase and ownership → exact fielded ids → finite integer coordinates →
 * own area and duplicate squares → the FULL formation by the engine's `matchInputReason`. Never accepts an illegal formation.
 */
export function checkSetupAnswer(s: GameState, team: TeamId, req: SetupRequest, answer: unknown): SetupCheck {
  const bad = (reason: string): SetupCheck => ({ ok: false, reason });
  if (s.phase !== 'driveSetup') return bad('Set-up answers are only accepted in the set-up phase.');
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return bad('The set-up answer must be an object { positions, why?, coachContext? }.');
  const a = answer as { positions?: unknown; why?: unknown };
  const positions = a.positions;
  if (!positions || typeof positions !== 'object' || Array.isArray(positions)) return bad('The set-up answer has no `positions` object.');
  const given = positions as Record<string, unknown>;
  const free = req.fielding.mode === 'free';
  const mine = new Set(free ? req.fielding.candidates.map((c) => c.id) : Object.keys(req.defaultPositions));
  for (const id of Object.keys(given)) {
    const owner = s.players.find((p) => p.id === id);
    if (!mine.has(id)) return bad(owner && owner.team !== team ? `Player ${id} belongs to the other team.` : `Unknown player id ${id} (not a player of this team's set-up).`);
  }
  const placed = Object.keys(given).filter((id) => given[id] !== null && given[id] !== undefined);
  const fielded = new Set(req.fieldedIds);
  if (!free) {
    for (const id of placed) if (!fielded.has(id)) return bad(`Player ${id} is not one of the fielded players the host fixed for this Drive.`);
    for (const id of req.fieldedIds) if (!placed.includes(id)) return bad(`Player ${id} is fixed on the pitch but has no position.`);
  }
  const legal = new Set(req.legalSquares.map((c) => `${c.x},${c.y}`));
  const used = new Map<string, string>();
  const clean: Record<string, Coord | null> = free ? Object.fromEntries(req.fielding.candidates.map((c) => [c.id, null])) : { ...req.defaultPositions };
  for (const id of placed) {
    const c = given[id] as { x?: unknown; y?: unknown } | null;
    if (!c || typeof c !== 'object' || typeof c.x !== 'number' || typeof c.y !== 'number' || !Number.isFinite(c.x) || !Number.isFinite(c.y) || !Number.isInteger(c.x) || !Number.isInteger(c.y)) return bad(`Player ${id} needs finite integer coordinates { x, y }.`);
    const k = `${c.x},${c.y}`;
    if (!legal.has(k)) return bad(`Square (${c.x}, ${c.y}) is outside this team's set-up area.`);
    if (used.has(k)) return bad(`Players ${used.get(k)} and ${id} share square (${c.x}, ${c.y}).`);
    used.set(k, id);
    clean[id] = { x: c.x, y: c.y };
  }
  const input = { kind: 'setupTeam' as const, team, positions: clean };
  const why = E.matchInputReason(s, input);
  if (why) return bad(why);
  return { ok: true, input, why: typeof a.why === 'string' && a.why.trim() ? a.why.slice(0, 500) : 'External coach set-up.' };
}

// ---------------------------------------------------------------------------------------------------------------------
// V6: kick placement hook (API v2 `chooseKick`)
// ---------------------------------------------------------------------------------------------------------------------

export interface KickRequest {
  receiving: TeamId;
  kickerCandidates: Array<{ id: string; number: number; position: string; skills: string[]; hasKick: boolean }>;
  /** Squares the kick may target (the receiving team's half). */
  legalSquares: Coord[];
  kickDistance: 'd6' | 'lowerOf2d6';
  pitch: { w: number; h: number };
  /** What the built-in coach would do (for reference; the answer may differ). */
  defaultAnswer?: { kicker: string; target: Coord; useKick: boolean };
}

export function buildKickRequest(s: GameState, team: TeamId): KickRequest {
  E.usePitch(s);
  const R = E.rulesFor(s);
  const g = R.pitch;
  const recv: TeamId = team === 'A' ? 'B' : 'A';
  const legal: Coord[] = [];
  for (let x = 0; x < g.w; x++) for (let y = 0; y < g.h; y++) if (E.inOwnHalf(recv, { x, y })) legal.push({ x, y });
  return {
    receiving: recv,
    kickerCandidates: E.kickerCandidates(s, team).map((p) => ({ id: p.id, number: p.number, position: p.position, skills: p.skills.map((k) => k.id), hasKick: p.skills.some((k) => k.id === 'kick') })),
    legalSquares: legal,
    kickDistance: R.kickDistance === 'lowerOf2d6' ? 'lowerOf2d6' : 'd6',
    pitch: { w: g.w, h: g.h },
  };
}

export type KickCheck = { ok: true; input: { kind: 'kickoff'; kicker: string; target: Coord; useKick?: boolean }; why: string } | { ok: false; reason: string };

export function checkKickAnswer(s: GameState, team: TeamId, answer: unknown): KickCheck {
  const bad = (reason: string): KickCheck => ({ ok: false, reason });
  if (s.phase !== 'kickoff' || s.match?.kicking !== team || s.match?.pendingPhase) return bad('A kick can only be placed by the kicking team at the start of the kick-off.');
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return bad('The kick answer must be an object { kicker, target: { x, y }, useKick?, why? }.');
  const a = answer as { kicker?: unknown; target?: { x?: unknown; y?: unknown }; useKick?: unknown; why?: unknown };
  if (typeof a.kicker !== 'string') return bad('The kick answer needs `kicker` (a player id).');
  const t = a.target;
  if (!t || typeof t.x !== 'number' || typeof t.y !== 'number' || !Number.isInteger(t.x) || !Number.isInteger(t.y)) return bad('The kick answer needs `target` with integer { x, y }.');
  const input = { kind: 'kickoff' as const, kicker: a.kicker, target: { x: t.x, y: t.y }, ...(a.useKick === true || a.useKick === false ? { useKick: a.useKick } : {}) };
  const why = E.matchInputReason(s, input);
  if (why) return bad(why);
  return { ok: true, input, why: typeof a.why === 'string' && a.why.trim() ? a.why.slice(0, 500) : 'External coach kick.' };
}
