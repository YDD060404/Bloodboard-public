// V6: historical Replay of a saved match — no AI, no new dice. The authoritative engine re-executes the recorded inputs and
// recorded in-action decisions from the match's initial state; the dice come from the same seed and counter, so the events
// reproduce. A match is only called "replayable" after this reproduction has been VERIFIED against the saved log.
import { decide, execute } from './engine';
import { newGame, newTeam } from './setup';
import { SKILL_BY_ID } from './skills';
import type { GameState, GameEvent, LogEntry, TeamId, Player } from './types';

export type ReplayGrade =
  | 'replayable' // initial state stored in the file and the recorded log reproduces exactly
  | 'replayable-after-migration' // the initial state had to be reconstructed from the saved state, and the recorded log reproduces exactly
  | 'position-only' // the log does not reproduce (or is missing); only the saved position can be shown
  | 'unsupported';

export interface ReplayAssessment {
  grade: ReplayGrade;
  reason: string;
  entries: number;
  /** First log entry (0-based) whose events differ from the file, when the log does not reproduce. */
  firstMismatch?: number;
  initialFrom: 'stored' | 'reconstructed' | 'none';
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const PLAYER_KEEP: Array<keyof Player> = ['id', 'team', 'number', 'name', 'position', 'keywords', 'ma', 'st', 'ag', 'pa', 'av', 'skills', 'defId', 'captain', 'mercenary', 'star', 'journeyman'];

/**
 * The state at the very start of a match (as createMatch returns it), rebuilt from a saved state of the same match.
 * Only permanent facts are copied; everything the match changed (positions, scores, dice counter, log, usage …) is reset.
 * It is a RECONSTRUCTION: callers must verify it by replaying the log (see `assessReplay`).
 */
export function reconstructInitial(saved: GameState): GameState | null {
  if (!saved.match || saved.log.length === 0) return null;
  const base = newGame({ a: { name: saved.teams.A.name, roster: saved.teams.A.rosterId }, b: { name: saved.teams.B.name, roster: saved.teams.B.rosterId }, seed: saved.rng.seed });
  const s: GameState = base;
  if (saved.variant) s.variant = saved.variant;
  // The rules edition is part of the match's identity: a match saved before the FAQ corrections replays under the earlier behaviour.
  if (saved.rulesEdition) s.rulesEdition = saved.rulesEdition;
  else delete s.rulesEdition;
  s.phase = 'pregame';
  s.weather = 'perfect';
  s.turn.half = 1;
  if (saved.title) s.title = saved.title;
  s.options = clone(saved.options);
  const m = clone(saved.match);
  for (const t of ['A', 'B'] as TeamId[]) {
    const st = saved.teams[t];
    const nt = newTeam(t, st.name, st.rosterId);
    Object.assign(nt, { color: st.color, accent: st.accent, rerolls: m.rosterRerolls[t], leaderReroll: false, score: 0, turn: 0 });
    if (st.league) nt.league = st.league;
    if (st.specialRules) nt.specialRules = st.specialRules.slice();
    if (st.apothecary) nt.apothecary = 'available';
    s.teams[t] = nt;
  }
  s.players = saved.players.map((p) => {
    const q: Record<string, unknown> = {};
    for (const k of PLAYER_KEEP) if (p[k] !== undefined) q[k] = clone(p[k]);
    Object.assign(q, { location: 'reserves', pos: null, stance: 'standing', distracted: false, activated: false, usage: {} });
    if (p.veteran) q.veteran = 'ready';
    return q as unknown as Player;
  });
  undoPregamePrayers(s, saved.log[0]);
  const ind = m.inducements;
  s.match = {
    kind: m.kind,
    options: m.options,
    teamIds: m.teamIds,
    ...(m.mirror ? { mirror: m.mirror } : {}),
    rosterRerolls: m.rosterRerolls,
    dedicatedFans: m.dedicatedFans,
    assistantCoaches: m.assistantCoaches,
    cheerleaders: m.cheerleaders,
    half: 1,
    drive: 0,
    setupDone: { A: false, B: false },
    bribes: { A: ind?.A?.bribe ?? 0, B: ind?.B?.bribe ?? 0 },
    ...(ind ? { inducements: ind } : {}),
    coachEjected: { A: false, B: false },
    driveMods: [],
    ...(m.matched ? { matched: m.matched } : {}),
    ...(m.preMatch ? { preMatch: m.preMatch } : {}),
    ...(m.allStar ? { allStar: m.allStar } : {}),
  };
  return s;
}

/** Prayers to Nuffle change players "for the game" during the pre-game sequence; the saved profiles already carry them. Undo them using the recorded status events. */
function undoPregamePrayers(s: GameState, first: LogEntry): void {
  const skillByName = (name: string) => Object.keys(SKILL_BY_ID).find((id) => SKILL_BY_ID[id].name === name);
  const drop = (p: Player, id: string | undefined) => { if (id) p.skills = p.skills.filter((k) => k.id !== id); };
  for (const e of first.events ?? []) {
    if (e.type !== 'status') continue;
    const pid = (e.data as { playerId?: string } | undefined)?.playerId;
    const p = pid ? s.players.find((q) => q.id === pid) : undefined;
    if (!p) continue;
    const t = e.text;
    if (t.startsWith('Stiletto:')) drop(p, 'stab');
    else if (t.startsWith('Iron Man:')) p.av = Math.max(1, p.av - 1);
    else if (t.startsWith('Knuckle Dusters:')) drop(p, 'mightyBlow');
    else if (t.startsWith('Bad Habits:')) drop(p, 'loner');
    else if (t.startsWith('Greasy Cleats:')) p.ma += 1;
    else if (t.startsWith('Blessing of Nuffle:')) drop(p, 'pro');
    else if (t.startsWith('Intensive Training:')) { const m = /gains (.+) for the game/.exec(t); if (m) drop(p, skillByName(m[1])); }
  }
}

export interface StepResult { state: GameState; ok: boolean; error?: string; /** The events of this execution WITH their board snapshots (the log copies drop them); for animation only. */ events?: GameEvent[] }

/** Apply one recorded log entry (its input and, in order, its recorded decisions) with the authoritative engine. */
export function applyEntry(prev: GameState, entry: LogEntry): StepResult {
  let out = execute(prev, clone(entry.input) as never, entry.plan);
  if (out.status === 'illegal') return { state: prev, ok: false, error: (out as { error?: string }).error ?? 'illegal' };
  let k = 0;
  while ((out.state as GameState).pending) {
    const d = entry.decisions[k++];
    if (!d) return { state: out.state as GameState, ok: false, error: 'a decision is pending but none was recorded' };
    out = decide(out.state as GameState, { requestId: d.requestId, optionId: d.optionId });
    if (out.status === 'illegal') return { state: prev, ok: false, error: `recorded decision refused: ${(out as { error?: string }).error ?? 'illegal'}` };
  }
  return { state: out.state as GameState, ok: true, events: (out as { events?: GameEvent[] }).events };
}

const evKey = (e: LogEntry) => JSON.stringify([e.input, e.decisions.map((d) => [d.requestId, d.optionId]), e.events, e.outcome]);

/**
 * Re-execute the whole recorded log from `initial` and compare each entry (input, decisions, events with their dice, outcome)
 * with the file. Returns the index of the first difference, or null when everything reproduces.
 */
export function verifyLog(initial: GameState, log: LogEntry[]): { ok: boolean; at?: number; error?: string; final?: GameState } {
  let s = clone(initial);
  for (let i = 0; i < log.length; i++) {
    const r = applyEntry(s, log[i]);
    if (!r.ok) return { ok: false, at: i, error: r.error };
    s = r.state;
    const made = s.log[s.log.length - 1];
    if (!made || evKey(made) !== evKey(log[i])) return { ok: false, at: i, error: 'the replayed events differ from the recorded events (dice or outcome)' };
  }
  return { ok: true, final: s };
}

export interface ReplayableMatch {
  assessment: ReplayAssessment;
  initial: GameState | null;
  log: LogEntry[];
  saved: GameState;
}

/** Decide, by actually re-executing the log, what kind of Replay a saved match supports. */
export function assessReplay(saved: GameState, storedInitial?: GameState | null): ReplayableMatch {
  const log = saved.log ?? [];
  const mk = (grade: ReplayGrade, reason: string, extra: Partial<ReplayAssessment> = {}, initial: GameState | null = null): ReplayableMatch => ({ assessment: { grade, reason, entries: log.length, initialFrom: 'none', ...extra }, initial, log, saved });
  if (!saved.match) return mk('position-only', 'This is a practice position, not a match: it has no recorded match history to replay.');
  if (log.length === 0) return mk('position-only', 'The file has no recorded history.');
  if (storedInitial) {
    const v = verifyLog(storedInitial, log);
    if (v.ok) return mk('replayable', 'The initial state is stored and the recorded history reproduces exactly.', { initialFrom: 'stored' }, storedInitial);
    return mk('position-only', `The stored initial state does not reproduce the history (entry ${(v.at ?? 0) + 1}: ${v.error}).`, { firstMismatch: v.at, initialFrom: 'stored' });
  }
  const init = reconstructInitial(saved);
  if (!init) return mk('unsupported', 'The initial state could not be reconstructed.');
  const v = verifyLog(init, log);
  if (v.ok) return mk('replayable-after-migration', 'The file has no stored initial state; it was reconstructed from the saved teams and verified: re-executing every recorded input and decision reproduces every recorded die and outcome.', { initialFrom: 'reconstructed' }, init);
  return mk('position-only', `The recorded history cannot be reproduced from a reconstructed start (entry ${(v.at ?? 0) + 1}: ${v.error}). Only the saved position can be viewed; nothing was invented.`, { firstMismatch: v.at, initialFrom: 'reconstructed' });
}

/** Seekable playback over a verified match. States are produced by the engine; checkpoints keep backward/jump seeking cheap. */
export class ReplaySession {
  readonly count: number;
  private cps = new Map<number, GameState>();
  private cur = 0;
  private readonly every: number;
  constructor(readonly match: ReplayableMatch, every = 12) {
    if (!match.initial) throw new Error('ReplaySession needs a replayable match');
    this.count = match.log.length;
    this.every = every;
    this.cps.set(0, clone(match.initial));
  }
  /** The state after `i` recorded entries (0 = the start). Never mutates earlier states or the source. */
  stateAt(i: number): GameState {
    const idx = Math.max(0, Math.min(this.count, i));
    let from = idx;
    while (!this.cps.has(from)) from--;
    let s = this.cps.get(from) as GameState;
    for (let j = from; j < idx; j++) {
      const r = applyEntry(s, this.match.log[j]);
      if (!r.ok) throw new Error(`replay failed at entry ${j + 1}: ${r.error}`);
      s = r.state;
      if ((j + 1) % this.every === 0) this.cps.set(j + 1, s);
    }
    this.cur = idx;
    return s;
  }
  /** Events (with board snapshots) that executing recorded entry `i` (0-based) produces from the state before it. Display only; never changes state. */
  eventsFor(i: number): GameEvent[] | null {
    if (i < 0 || i >= this.count) return null;
    const keep = this.cur;
    const r = applyEntry(clone(this.stateAt(i)), this.match.log[i]);
    this.cur = keep;
    return r.ok ? r.events ?? null : null;
  }
  get index() { return this.cur; }
  step(d: number) { return this.stateAt(this.cur + d); }
  /** Entry indices (state indices) at which a boundary happens, for "jump to turn / drive / touchdown". */
  markers(): { turns: number[]; drives: number[]; touchdowns: number[] } {
    const turns: number[] = [], drives: number[] = [], touchdowns: number[] = [];
    let lastTurnKey = '';
    this.match.log.forEach((e, i) => {
      const k = `${e.team}:${e.turn}`;
      if (e.input.kind === 'playerAction' && k !== lastTurnKey) { lastTurnKey = k; turns.push(i); }
      if (e.input.kind === 'nextDrive' || e.input.kind === 'pregame') drives.push(i + 1);
      if (e.outcome === 'touchdown') touchdowns.push(i + 1);
    });
    return { turns, drives, touchdowns };
  }
}
