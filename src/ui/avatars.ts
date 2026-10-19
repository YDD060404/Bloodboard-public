// V7-04 — customizable animated pixel avatars for each AI coach.
//
// An avatar is a 16x16 pixel face drawn as inline SVG (crisp at any size, no canvas, no external assets). Its mood is derived ONLY from real runtime
// facts: whether the coach is computing a move (`app.st.computer.thinking`), the events the engine just produced (touchdown, turnover, injury) and the
// coach's own recorded move. Nothing is scripted or random. Avatars can be switched off, bubbles can be switched off, and the reason text of a move
// only appears in a bubble if the person turned that on (it is the same text the Computer card already shows). The look is saved per AI file id.
import type { GameEvent, GameState, TeamId } from '../engine/types';

export type Mood = 'idle' | 'thinking' | 'acting' | 'cheer' | 'dismay' | 'hurt';
export type Headgear = 'none' | 'helmet' | 'horns' | 'cap' | 'crown';
export type Face = 'dots' | 'wide' | 'narrow' | 'visor';

export interface AvatarSpec { v: 1; skin: number; accent: number; headgear: Headgear; face: Face; label: string }

export const SKINS = ['#e8c39e', '#c68642', '#8d5524', '#a8d08d', '#9bb7d4', '#c9a0dc', '#d9d9d9', '#d96c5b'] as const;
export const ACCENTS = ['#b3261e', '#1e5fb3', '#2e7d32', '#f9a825', '#6a1b9a', '#37474f', '#ef6c00', '#00838f'] as const;
export const HEADGEARS: Headgear[] = ['none', 'helmet', 'horns', 'cap', 'crown'];
export const FACES: Face[] = ['dots', 'wide', 'narrow', 'visor'];

function hash(s: string): number { let x = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0; } return x >>> 0; }

/** The look an AI gets until the person customizes it: a deterministic function of its id (the same AI always looks the same). */
export function defaultSpec(id: string): AvatarSpec {
  const h = hash(id || 'coach');
  return { v: 1, skin: h % SKINS.length, accent: (h >>> 3) % ACCENTS.length, headgear: HEADGEARS[(h >>> 6) % HEADGEARS.length], face: FACES[(h >>> 9) % FACES.length], label: '' };
}

export function sanitizeSpec(x: unknown, fallbackId: string): AvatarSpec {
  const d = defaultSpec(fallbackId);
  if (!x || typeof x !== 'object') return d;
  const o = x as Record<string, unknown>;
  const idx = (v: unknown, n: number, dflt: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < n ? v : dflt);
  return {
    v: 1, skin: idx(o.skin, SKINS.length, d.skin), accent: idx(o.accent, ACCENTS.length, d.accent),
    headgear: HEADGEARS.includes(o.headgear as Headgear) ? (o.headgear as Headgear) : d.headgear,
    face: FACES.includes(o.face as Face) ? (o.face as Face) : d.face,
    label: typeof o.label === 'string' ? o.label.replace(/[\u0000-\u001f<>]/g, '').slice(0, 24) : '',
  };
}

// ------------------------------------------------------------------ sprite
// 16 columns x 16 rows. Characters: '.' clear, 's' skin, 'a' accent, 'k' ink, 'w' white, 'r' mouth red.
const HEAD = [
  '................',
  '................',
  '................',
  '....ssssssss....',
  '...ssssssssss...',
  '..ssssssssssss..',
  '..ssssssssssss..',
  '..ssssssssssss..',
  '..ssssssssssss..',
  '..ssssssssssss..',
  '..ssssssssssss..',
  '...ssssssssss...',
  '....ssssssss....',
  '..aaaaaaaaaaaa..',
  '.aaaaaaaaaaaaaa.',
  '.aaaaaaaaaaaaaa.',
];
const GEAR: Record<Headgear, string[]> = {
  none: [],
  helmet: ['....aaaaaaaa....', '...aaaaaaaaaa...', '..aaaaaaaaaaaa..'],
  horns: ['.w..........w...', '.ww........ww...', '..ssssssssssss..'],
  cap: ['................', '....aaaaaaaa....', '...aaaaaaaaaaaa.'],
  crown: ['..a..a.aa.a..a..', '..aa.aaaaaa.aa..', '..aaaaaaaaaaaa..'],
};

function setRow(g: string[][], y: number, row: string) { for (let x = 0; x < 16; x++) if (row[x] !== '.') g[y][x] = row[x]; }
function put(g: string[][], x: number, y: number, c: string) { if (y >= 0 && y < 16 && x >= 0 && x < 16) g[y][x] = c; }

/** The grid for one (spec, mood, frame). `frame` 0/1 drives blinking / bobbing; the grid is pure data so it can be tested. */
export function spriteGrid(spec: AvatarSpec, mood: Mood, frame = 0): string[] {
  const g: string[][] = HEAD.map((r) => r.split(''));
  const gear = GEAR[spec.headgear];
  gear.forEach((row, i) => setRow(g, 1 + i, row)); // headgear covers rows 1-3, on top of the crown of the head
  // eyes (rows 7-8): shape from the face, expression from the mood
  const blink = frame === 1 && (mood === 'idle');
  const eye = (x: number) => {
    if (blink || mood === 'hurt') { put(g, x, 8, 'k'); put(g, x + 1, 8, 'k'); return; }
    if (spec.face === 'wide') { put(g, x, 7, 'w'); put(g, x + 1, 7, 'w'); put(g, x, 8, 'k'); put(g, x + 1, 8, 'w'); return; }
    if (spec.face === 'narrow') { put(g, x, 8, 'k'); put(g, x + 1, 8, 'k'); return; }
    put(g, x, 7, 'k'); put(g, x, 8, 'k'); put(g, x + 1, 7, 'k'); put(g, x + 1, 8, 'k');
  };
  if (spec.face === 'visor') { for (let x = 4; x <= 11; x++) { put(g, x, 7, 'k'); put(g, x, 8, 'k'); } if (mood !== 'hurt') { put(g, 6, 7, 'w'); put(g, 9, 7, 'w'); } }
  else { eye(5); eye(9); }
  if (mood === 'dismay') { put(g, 4, 6, 'k'); put(g, 5, 6, 'k'); put(g, 10, 6, 'k'); put(g, 11, 6, 'k'); }
  if (mood === 'thinking') { put(g, 10, 6, 'k'); put(g, 11, 6, 'k'); put(g, 12, 5, 'k'); }
  // mouth (rows 10-11)
  const mouth: Record<Mood, string[]> = {
    idle: ['......kkkk......'], thinking: ['.......kk.......'], acting: ['......kkkk......'],
    cheer: ['.....k....k.....', '......kkkk......'], dismay: ['......kkkk......', '.....k....k.....'], hurt: ['.....kkkkkk.....'],
  };
  const rows = mouth[mood]; rows.forEach((r, i) => setRow(g, 10 + i, r));
  if (mood === 'hurt') { put(g, 12, 9, 'r'); put(g, 12, 10, 'r'); }
  // colour pass happens at render time; the bob moves the whole face one pixel
  const out = g.map((r) => r.join(''));
  if (frame === 1 && (mood === 'cheer' || mood === 'acting')) return ['................', ...out.slice(0, 15)];
  return out;
}

export function spriteSvg(spec: AvatarSpec, mood: Mood, frame = 0, px = 3): string {
  const grid = spriteGrid(spec, mood, frame);
  const col: Record<string, string> = { s: SKINS[spec.skin], a: ACCENTS[spec.accent], k: '#1b1b1b', w: '#ffffff', r: '#d32f2f' };
  let rects = '';
  grid.forEach((row, y) => { for (let x = 0; x < 16; x++) { const c = col[row[x]]; if (c) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`; } });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="${16 * px}" height="${16 * px}" shape-rendering="crispEdges" role="img" aria-label="${(spec.label || 'coach avatar').replace(/[^\p{L}\p{N} .,'-]/gu, '')}, ${mood}">${rects}</svg>`;
}

// ------------------------------------------------------------------ mood from real events
export interface Reaction { mood: Mood; text: string; until: number }

/** Mood of ONE team's coach caused by ONE engine event (null = no reaction). Pure: uses only the event and the board it happened on. */
export function reactionTo(team: TeamId, ev: GameEvent, g: GameState): { mood: Mood; text: string } | null {
  const d = (ev.data ?? {}) as Record<string, unknown>;
  if (ev.type === 'touchdown') { const scorer = d.team as TeamId | undefined; if (!scorer) return null; return scorer === team ? { mood: 'cheer', text: 'Touchdown!' } : { mood: 'dismay', text: 'We concede.' }; }
  if (ev.type === 'turnover') return null; // the event does not name a side; the log entry's outcome is used by reactionToLog
  if (ev.type === 'injury') {
    const pid = d.playerId as string | undefined; const res = d.result as string | undefined;
    const p = pid ? g.players.find((x) => x.id === pid) : undefined;
    if (!p || !res || res === 'stunned') return null;
    return p.team === team ? { mood: 'hurt', text: res === 'ko' ? 'Knocked out…' : 'Ouch.' } : { mood: 'cheer', text: 'Good hit.' };
  }
  return null;
}

/** A finished action's outcome from the log: the acting coach's Turnover is a setback for it and relief for the opponent. */
export function reactionToLog(team: TeamId, actor: TeamId, outcome: string): { mood: Mood; text: string } | null {
  if (outcome === 'turnover') return actor === team ? { mood: 'dismay', text: 'Turnover.' } : { mood: 'cheer', text: 'Our ball!' };
  return null;
}

export interface AvatarInput { thinking: boolean; coachToAct: boolean; acting: boolean; reaction: Reaction | null; now: number }
export function moodFor(i: AvatarInput): Mood {
  if (i.reaction && i.reaction.until > i.now) return i.reaction.mood;
  if (i.thinking && i.coachToAct) return 'thinking';
  if (i.acting) return 'acting';
  return 'idle';
}

// ------------------------------------------------------------------ per-person settings (saved per AI file id)
export interface AvatarSettings { enabled: boolean; bubbles: boolean; reasons: boolean; specs: Record<string, AvatarSpec> }
const KEY = 'bloodboard.avatars.v1';
let settings: AvatarSettings | null = null;
const listeners = new Set<() => void>();

export function avatarSettings(): AvatarSettings {
  if (settings) return settings;
  let raw: Partial<AvatarSettings> = {};
  try { raw = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* optional */ }
  const specs: Record<string, AvatarSpec> = {};
  if (raw.specs && typeof raw.specs === 'object') for (const [k, v] of Object.entries(raw.specs)) specs[k] = sanitizeSpec(v, k);
  settings = { enabled: raw.enabled !== false, bubbles: raw.bubbles !== false, reasons: raw.reasons === true, specs };
  return settings;
}
export function saveAvatarSettings(): void { try { localStorage.setItem(KEY, JSON.stringify(avatarSettings())); } catch { /* optional */ } for (const l of listeners) l(); }
export function onAvatarChange(l: () => void): () => void { listeners.add(l); return () => listeners.delete(l); }
export function specFor(aiId: string): AvatarSpec { return avatarSettings().specs[aiId] ?? defaultSpec(aiId); }
export function setSpec(aiId: string, patch: Partial<AvatarSpec>): AvatarSpec { const s = sanitizeSpec({ ...specFor(aiId), ...patch }, aiId); avatarSettings().specs[aiId] = s; saveAvatarSettings(); return s; }
export function resetSpec(aiId: string): void { delete avatarSettings().specs[aiId]; saveAvatarSettings(); }
/** Test hook: forget the in-memory copy so the next call re-reads storage. */
export function _resetAvatarCache(): void { settings = null; }

// ------------------------------------------------------------------ live reactions (set from real execution results)
const reactions: Partial<Record<TeamId, Reaction>> = {};
export const REACTION_MS = 2600;
export function reactionOf(team: TeamId): Reaction | null { return reactions[team] ?? null; }
export function clearReactions(): void { delete reactions.A; delete reactions.B; }

/** Called once per execution result with the events it produced and the board after it. Returns the teams whose face changed. */
export function noteExecution(after: GameState, events: GameEvent[], actor: TeamId | null, outcome: string | null, now = Date.now()): TeamId[] {
  const changed: TeamId[] = [];
  for (const team of ['A', 'B'] as TeamId[]) {
    let r: { mood: Mood; text: string } | null = null;
    for (const ev of events) r = reactionTo(team, ev, after) ?? r;
    if (!r && actor && outcome) r = reactionToLog(team, actor, outcome);
    if (r) { reactions[team] = { ...r, until: now + REACTION_MS }; changed.push(team); }
  }
  return changed;
}

export function bubbleText(team: TeamId, reasonLine: string | null, now: number): string | null {
  const s = avatarSettings();
  if (!s.enabled || !s.bubbles) return null;
  const r = reactions[team];
  if (r && r.until > now) return r.text;
  if (s.reasons && reasonLine) return reasonLine.length > 90 ? `${reasonLine.slice(0, 87)}…` : reasonLine;
  return null;
}
