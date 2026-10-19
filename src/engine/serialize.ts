import { SKILL_BY_ID } from './skills';
import { BUILD_FINGERPRINT } from './fingerprint';
import type { GameState, TeamId } from './types';

/** V6: persisted coach memory of one side, valid only for the same coach, coach version and context schema. */
export interface StoredCoachContext {
  coachId: string;
  coachVersion: string;
  schemaVersion: string;
  /** Revision of the state this memory describes (number of log entries when it was committed). */
  stateRevision: number;
  payload: unknown;
}

/** V6 save metadata. The file name, the display name and the match identity are three different things. */
export interface SaveMeta {
  saveFormatVersion: 2;
  /** Stable identity of the match; never derived from its name. Copies made by Save As keep it; a new match gets a new one. */
  matchId: string;
  displayName: string;
  createdAt: string;
  matchFormat: 'standard' | 'sevens' | 'practice';
  engineVersion: string;
  engineHash: string;
  rulesHash: string;
  aiApiVersion: string;
  /** The match as createMatch returned it (full match files): makes Replay exact instead of reconstructed. */
  initial?: GameState | null;
  coachContext?: Partial<Record<TeamId, StoredCoachContext | null>>;
}

export interface SaveFile {
  format: 'bloodboard-position';
  version: 1 | 2;
  name: string;
  savedAt: string;
  notes?: string;
  state: GameState;
  meta?: SaveMeta;
}

export function newMatchId(): string {
  const r = () => Math.floor(Math.random() * 0x100000000).toString(36);
  return `m-${Date.now().toString(36)}-${r()}${r()}`;
}

/** Matches saved before V6 carry no id: derive a stable one from what cannot change (seed and first recorded entry). */
export function legacyMatchId(state: GameState): string {
  const first = state.log?.[0] ? JSON.stringify([state.log[0].input, state.log[0].events?.[0]?.text ?? '']) : '';
  let h = 2166136261;
  for (const c of `${state.rng?.seed}|${state.title ?? ''}|${first}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return `legacy-${state.rng?.seed ?? 0}-${h.toString(36)}`;
}

export interface SaveOptions {
  matchId?: string;
  initial?: GameState | null;
  coachContext?: SaveMeta['coachContext'];
  createdAt?: string;
}

export function toSaveFile(state: GameState, name: string, notes?: string, opts: SaveOptions = {}): SaveFile {
  const copy = JSON.parse(JSON.stringify(state)) as GameState;
  const meta: SaveMeta = {
    saveFormatVersion: 2,
    matchId: opts.matchId ?? (state.match ? legacyMatchId(state) : newMatchId()),
    displayName: name,
    createdAt: opts.createdAt ?? new Date().toISOString(),
    matchFormat: state.match ? (state.variant === 'sevens' ? 'sevens' : 'standard') : 'practice',
    engineVersion: BUILD_FINGERPRINT.version,
    engineHash: BUILD_FINGERPRINT.engineHash,
    rulesHash: BUILD_FINGERPRINT.rulesHash,
    aiApiVersion: BUILD_FINGERPRINT.aiApiVersion,
    ...(opts.initial ? { initial: JSON.parse(JSON.stringify(opts.initial)) as GameState } : {}),
    ...(opts.coachContext ? { coachContext: JSON.parse(JSON.stringify(opts.coachContext)) as SaveMeta['coachContext'] } : {}),
  };
  return { format: 'bloodboard-position', version: 2, name, savedAt: new Date().toISOString(), notes, state: copy, meta };
}

export interface SaveCompatibility {
  /** 'same' = saved by an engine with identical rules; 'older-format' = a V5 file (no fingerprints); 'different-rules' = saved by other rule code. */
  rules: 'same' | 'older-format' | 'different-rules';
  note: string;
}

/** Never pretend an old file is equivalent: say what is known about the rules it was saved under. */
export function checkCompatibility(save: SaveFile): SaveCompatibility {
  const m = save.meta;
  if (!m) return { rules: 'older-format', note: 'Saved by Bloodboard V5 or earlier (no rules fingerprint). The position loads; Replay re-executes the recorded history under the current rules and only plays it if it reproduces exactly.' };
  const ed = save.state && (save.state as { rulesEdition?: string }).rulesEdition;
  if (ed !== undefined && ed !== 'faq2026') return { rules: 'different-rules', note: `This file was saved under rules edition "${String(ed)}", which this build does not support. It cannot be opened as a playable game.` };
  if (m.rulesHash === BUILD_FINGERPRINT.rulesHash) return { rules: 'same', note: 'Saved by the same rules code.' };
  return { rules: 'different-rules', note: `Saved by engine ${m.engineVersion} whose rules code differs from this build's (${BUILD_FINGERPRINT.version}). The position loads as saved; Replay verifies the history under the current rules before playing it, and stays position-only if it does not reproduce.` };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isInt = (v: unknown) => typeof v === 'number' && Number.isInteger(v);

/** Structural validation of a GameState (the JSON Schema in docs/schemas mirrors this). */
export function validateState(v: unknown): string[] {
  const e: string[] = [];
  if (!isObj(v)) return ['state must be an object'];
  if (v.format !== 'bloodboard-state') e.push('state.format must be "bloodboard-state"');
  if (v.version !== 1) e.push('state.version must be 1');
  if (v.variant !== undefined && v.variant !== 'standard' && v.variant !== 'sevens') e.push('state.variant must be "standard" or "sevens" when present');
  if (v.rulesEdition !== undefined && v.rulesEdition !== 'faq2026') e.push(`state.rulesEdition "${String(v.rulesEdition)}" is not supported by this build (supported: faq2026, or absent for legacy games)`);
  if (!['setup', 'play', 'touchdown', 'halfOver', 'pregame', 'driveSetup', 'kickoff', 'fullTime'].includes(v.phase as string)) e.push('state.phase is invalid');
  if (v.match !== undefined) {
    const m = v.match as Record<string, unknown>;
    if (!isObj(m)) e.push('state.match must be an object');
    else {
      if (m.kind !== 'league' && m.kind !== 'tournament') e.push('state.match.kind must be "league" or "tournament"');
      if (m.half !== 1 && m.half !== 2) e.push('state.match.half must be 1 or 2');
    }
  } else if (['pregame', 'driveSetup', 'kickoff', 'fullTime'].includes(v.phase as string)) e.push(`state.phase "${v.phase as string}" needs state.match`);
  if (!['perfect', 'verySunny', 'pouringRain', 'blizzard', 'swelteringHeat'].includes(v.weather as string)) e.push('state.weather is invalid');
  if (v.clock !== undefined) {
    const c = v.clock as Record<string, unknown>;
    if (!isObj(c) || !['totalMs', 'A', 'B'].every((k) => typeof c[k] === 'number' && (c[k] as number) >= 0)) e.push('state.clock must hold non-negative totalMs, A and B (milliseconds) when present');
  }
  if (!isObj(v.teams) || !isObj((v.teams as Record<string, unknown>).A) || !isObj((v.teams as Record<string, unknown>).B)) e.push('state.teams.A and .B are required');
  else
    for (const t of ['A', 'B']) {
      const tm = (v.teams as Record<string, Record<string, unknown>>)[t];
      if (!isInt(tm.rerolls) || (tm.rerolls as number) < 0) e.push(`teams.${t}.rerolls must be a non-negative integer`);
      if (!isInt(tm.turn) || (tm.turn as number) < 0 || (tm.turn as number) > 8) e.push(`teams.${t}.turn must be 0-8`);
      if (!isInt(tm.score)) e.push(`teams.${t}.score must be an integer`);
    }
  if (!Array.isArray(v.players)) e.push('state.players must be an array');
  else
    v.players.forEach((p: unknown, i: number) => {
      if (!isObj(p)) {
        e.push(`players[${i}] must be an object`);
        return;
      }
      if (typeof p.id !== 'string') e.push(`players[${i}].id must be a string`);
      if (p.team !== 'A' && p.team !== 'B') e.push(`players[${i}].team must be A or B`);
      for (const k of ['ma', 'st', 'ag', 'av', 'number']) if (!isInt(p[k])) e.push(`players[${i}].${k} must be an integer`);
      if (p.pa !== null && !isInt(p.pa)) e.push(`players[${i}].pa must be an integer or null`);
      if (!['pitch', 'reserves', 'ko', 'cas', 'sentOff'].includes(p.location as string)) e.push(`players[${i}].location is invalid`);
      if (!['standing', 'prone', 'stunned'].includes(p.stance as string)) e.push(`players[${i}].stance is invalid`);
      if (p.location === 'pitch' && !isObj(p.pos)) e.push(`players[${i}].pos is required on the pitch`);
      if (!Array.isArray(p.skills)) e.push(`players[${i}].skills must be an array`);
      else (p.skills as unknown[]).forEach((s) => {
        if (!isObj(s) || typeof s.id !== 'string' || !SKILL_BY_ID[s.id]) e.push(`players[${i}] has an unknown skill ${JSON.stringify(s)}`);
      });
    });
  if (!isObj(v.ball) || !['held', 'ground', 'none'].includes((v.ball as Record<string, unknown>).kind as string)) e.push('state.ball is invalid');
  if (!isObj(v.rng) || !isInt((v.rng as Record<string, unknown>).seed) || !isInt((v.rng as Record<string, unknown>).counter)) e.push('state.rng must have integer seed and counter');
  if (!isObj(v.turn) || !['A', 'B'].includes((v.turn as Record<string, unknown>).active as string)) e.push('state.turn.active must be A or B');
  if (!Array.isArray(v.log)) e.push('state.log must be an array');
  return e;
}

export function parseSaveFile(text: string): { ok: true; save: SaveFile } | { ok: false; errors: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, errors: [`Not valid JSON: ${(err as Error).message}`] };
  }
  if (!isObj(raw)) return { ok: false, errors: ['The file must contain a JSON object.'] };
  // Accept either a save file or a bare state.
  const state = raw.format === 'bloodboard-position' ? raw.state : raw.format === 'bloodboard-state' ? raw : undefined;
  if (!state) return { ok: false, errors: ['This is not a Bloodboard position file.'] };
  const errors = validateState(state);
  if (errors.length) return { ok: false, errors };
  const save: SaveFile =
    raw.format === 'bloodboard-position'
      ? (raw as unknown as SaveFile)
      : { format: 'bloodboard-position', version: 1, name: 'Imported position', savedAt: new Date().toISOString(), state: state as GameState };
  const st = save.state as GameState;
  if (!st.options) st.options = { rulerWidth: 1.8 };
  for (const p of st.players) if (!p.usage) p.usage = {};
  return { ok: true, save };
}
