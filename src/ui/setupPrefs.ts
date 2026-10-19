/**
 * V5.5: the remembered match set-up, per mode — Player 1 and Player 2 (Human or Computer, the AI file, the team), the
 * advisory coach, the format, competition budget, rules, difficulty and the other options. Kept in this browser's / app's
 * local storage and, in the Mac app, also as Settings/setup.json in the app's support folder so it survives app
 * restarts. Reset to defaults per mode. Match states in progress are saved separately (Positions); this is only the
 * set-up.
 *
 * V5 step 6's remembered quick-match choices (bloodboard.setup.v1) are taken over once.
 */
import { DEFAULT_AI_ID, legacyAiId } from '../ai/index';
import type { TeamFormat } from './app';
import { createStore, type PositionStore } from './storage';

export type Tier = 1 | 2 | 3 | 4;
export type SetupMode = 'league' | 'tournament' | 'exhibition' | 'allstar';
export const SETUP_MODES: SetupMode[] = ['league', 'tournament', 'exhibition', 'allstar'];

export interface SideCfg {
  controller: 'human' | 'computer';
  /** The AI file's id (a computer coach), e.g. "bloodboard-balanced". */
  ai: string;
  /** V5 step 6 / early V5.5 set-ups only: the former style, read once to pick the matching bundled file. */
  style?: string;
  /** A saved team, or a ready-made team built for the match. */
  source: 'saved' | 'ready' | 'ai';
  /** V6: with source 'ai' (computer sides only) the AI chooses the roster too (the roster below is then only the preview/fallback). */
  aiRoster?: boolean;
  /** V6: with source 'saved', only saved teams of this roster are listed ('' = any). */
  rosterFilter?: string;
  teamId: string;
  roster: string;
  /** Tournament ready-made team: its Tier (null = the official / stated one). */
  tier: Tier | null;
  /** All-Star squads: the Star Players (ids). */
  stars: string[];
}

export interface ModeCfg {
  format: TeamFormat;
  p1: SideCfg;
  p2: SideCfg;
  rules: 'full' | 'introductory';
  /** Team Draft Budget for ready-made teams: a preset, or custom rules. */
  budget: number;
  budgetCustom: boolean;
  /** Tournament ready-made teams: spend the Skill Points automatically (editable afterwards). */
  autoSkills: boolean;
  /** Optional dice house rule (human side handicap / computer side boost), 0-3. */
  difficulty: { human: number; computer: number };
  /** Fixed dice seed, or null = a new random seed for each match. */
  seed: number | null;
  /** All-Star squads: budget (null = unrestricted) and squad size. */
  allStar: { budget: number | null; maxStars: number };
  /** The advisory coach (AI Focus advice and temporary takeovers): an AI file id. */
  advisor: string;
  /** Sevens: use the optional NAF recommendation that On the Ball may not enter No Man's Land (default: GW ruling). */
  otbNaf?: boolean;
}

/**
 * V5.5: a Quick Match preset — exactly what the Home screen's Quick Match button starts: a mode and its complete
 * set-up (format, Player 1 / Player 2 controllers and AI files, saved or ready-made teams with their skills, budget,
 * rules, difficulty, seed, advisory coach…). Configured on the same set-up screen, kept across restarts.
 */
export interface QuickPreset {
  id: string;
  name: string;
  mode: SetupMode;
  cfg: ModeCfg;
}

export interface SetupStore {
  version: 2;
  savedAt: string;
  modes: Record<SetupMode, ModeCfg>;
  /** The Tier last chosen for a roster in a format (event override), `sevens:norse` → 1. */
  tiers: Record<string, Tier>;
  /** V5.5: Quick Match presets and the one the Home screen's button starts. */
  quick: { presets: QuickPreset[]; active: string };
}

const KEY = 'bloodboard.setup.v2';
const OLD_KEY = 'bloodboard.setup.v1';

const side = (controller: 'human' | 'computer', roster: string, extra: Partial<SideCfg> = {}): SideCfg => ({ controller, ai: DEFAULT_AI_ID, source: 'ready', teamId: '', roster, tier: null, stars: [], ...extra });

/** Default All-Star squads (Star Players whose rules are implemented; the set-up checks them). */
export const DEFAULT_ALLSTARS = {
  p1: ['griff', 'grim', 'rumbelow', 'lordBorak', 'zolcath', 'helmut', 'karla', 'willow', 'deeproot', 'akhorne', 'morgNThorg'],
  p2: ['hthark', 'varag', 'ivan', 'roxanna', 'grashnak', 'kiroth', 'lucien', 'valen', 'estelle', 'glart', 'hakflem'],
};

export function defaultMode(m: SetupMode): ModeCfg {
  const base = { rules: 'full' as const, budgetCustom: false, autoSkills: true, difficulty: { human: 0, computer: 0 }, seed: null, allStar: { budget: null, maxStars: 16 }, advisor: DEFAULT_AI_ID };
  switch (m) {
    case 'league':
      return { ...base, format: 'standard', p1: side('human', 'tombKings', { source: 'saved' }), p2: side('computer', 'bretonnian', { source: 'saved' }), budget: 1_000_000 };
    case 'tournament':
      return { ...base, format: 'sevens', p1: side('human', 'tombKings'), p2: side('computer', 'bretonnian'), budget: 600_000 };
    case 'exhibition':
      return { ...base, format: 'standard', p1: side('human', 'tombKings'), p2: side('computer', 'bretonnian'), budget: 1_000_000 };
    case 'allstar':
      return { ...base, format: 'standard', p1: side('human', 'tombKings', { stars: DEFAULT_ALLSTARS.p1 }), p2: side('computer', 'bretonnian', { stars: DEFAULT_ALLSTARS.p2 }), budget: 0, allStar: { budget: null, maxStars: 16 } };
  }
}

/** The two Quick Match presets offered at first: playing the computer, and watching computer v computer. */
export function defaultQuick(): SetupStore['quick'] {
  const watch = defaultMode('tournament');
  watch.p1 = side('computer', 'norse', { ai: 'bloodboard-offensive' });
  watch.p2 = side('computer', 'lizardmen', { ai: 'bloodboard-defensive' });
  return {
    presets: [
      { id: 'play-computer', name: 'Play the computer', mode: 'exhibition', cfg: defaultMode('exhibition') },
      { id: 'watch-cvc', name: 'Watch computer v computer (Sevens)', mode: 'tournament', cfg: watch },
    ],
    active: 'play-computer',
  };
}

export function defaultStore(): SetupStore {
  return { version: 2, savedAt: new Date(0).toISOString(), modes: { league: defaultMode('league'), tournament: defaultMode('tournament'), exhibition: defaultMode('exhibition'), allstar: defaultMode('allstar') }, tiers: {}, quick: defaultQuick() };
}

/** One mode's set-up with anything missing filled in (older or hand-edited files). */
function normaliseMode(m: SetupMode, raw: unknown): ModeCfg {
  const dm = defaultMode(m);
  const x = (raw && typeof raw === 'object' ? raw : {}) as Partial<ModeCfg>;
  const out: ModeCfg = {
    ...dm,
    ...x,
    p1: { ...dm.p1, ...(x.p1 ?? {}) },
    p2: { ...dm.p2, ...(x.p2 ?? {}) },
    difficulty: { ...dm.difficulty, ...(x.difficulty ?? {}) },
    allStar: { ...dm.allStar, ...(x.allStar ?? {}) },
  };
  if (m === 'league') out.format = 'standard';
  // No separate AI style any more: an older "bloodboard" + style becomes the bundled file of that name.
  for (const k of ['p1', 'p2'] as const) {
    const sd = out[k];
    sd.ai = legacyAiId(sd.ai, sd.style);
    delete sd.style;
    // V6: sanitise the set-up fields added in V6 (a stale or hand-edited value must never break the set-up screen).
    if (sd.source !== 'ready' && sd.source !== 'saved' && sd.source !== 'ai') sd.source = dm[k].source;
    sd.aiRoster = sd.aiRoster === true && sd.source === 'ai'; // "AI chooses" only exists with AI Build; a stale flag must never override a roster
    if (typeof sd.rosterFilter !== 'string') delete sd.rosterFilter;
    if (typeof sd.roster !== 'string' || !sd.roster) sd.roster = dm[k].roster;
    if (typeof sd.teamId !== 'string') sd.teamId = '';
    if (!Array.isArray(sd.stars)) sd.stars = [];
  }
  if (typeof out.advisor !== 'string' || !out.advisor) out.advisor = DEFAULT_AI_ID;
  return out;
}

/** Fill anything missing (an older or hand-edited file) with the defaults. */
function normalise(v: Partial<SetupStore> | null | undefined): SetupStore {
  const d = defaultStore();
  if (!v || typeof v !== 'object') return d;
  const out: SetupStore = { version: 2, savedAt: typeof v.savedAt === 'string' ? v.savedAt : d.savedAt, modes: d.modes, tiers: { ...(v.tiers ?? {}) }, quick: d.quick };
  for (const m of SETUP_MODES) out.modes[m] = normaliseMode(m, v.modes?.[m]);
  const q = v.quick;
  if (q && Array.isArray(q.presets) && q.presets.length) {
    const presets = q.presets
      .filter((p) => p && typeof p === 'object' && SETUP_MODES.includes(p.mode))
      .map((p, i) => ({ id: typeof p.id === 'string' && p.id ? p.id : `preset-${i + 1}`, name: typeof p.name === 'string' && p.name.trim() ? p.name.slice(0, 60) : `Quick Match ${i + 1}`, mode: p.mode, cfg: normaliseMode(p.mode, p.cfg) }));
    if (presets.length) out.quick = { presets, active: presets.some((p) => p.id === q.active) ? q.active : presets[0].id };
  }
  return out;
}

// --- Quick Match presets (V5.5) ---------------------------------------------------------------------------

export function quickPresets(): QuickPreset[] {
  return setupStore().quick.presets;
}

/** The preset the Quick Match button starts. */
export function activeQuick(): QuickPreset {
  const q = setupStore().quick;
  return q.presets.find((p) => p.id === q.active) ?? q.presets[0];
}

export function setActiveQuick(id: string): void {
  const q = setupStore().quick;
  if (q.presets.some((p) => p.id === id)) q.active = id;
  saveSetupStore();
}

/** Save a mode's set-up as a Quick Match preset: over the preset `id`, or as a new one. Returns the preset. */
export function saveQuickPreset(mode: SetupMode, cfg: ModeCfg, opts: { id?: string; name?: string; activate?: boolean } = {}): QuickPreset {
  const q = setupStore().quick;
  const copy = JSON.parse(JSON.stringify(cfg)) as ModeCfg;
  let p = opts.id ? q.presets.find((x) => x.id === opts.id) : undefined;
  if (p) {
    p.mode = mode;
    p.cfg = copy;
    if (opts.name) p.name = opts.name.slice(0, 60);
  } else {
    let n = q.presets.length + 1;
    while (q.presets.some((x) => x.id === `preset-${n}`)) n++;
    p = { id: `preset-${n}`, name: (opts.name ?? `Quick Match ${n}`).slice(0, 60), mode, cfg: copy };
    q.presets.push(p);
  }
  if (opts.activate !== false) q.active = p.id;
  saveSetupStore();
  return p;
}

export function renameQuickPreset(id: string, name: string): void {
  const p = quickPresets().find((x) => x.id === id);
  if (p && name.trim()) p.name = name.trim().slice(0, 60);
  saveSetupStore();
}

/** Remove a preset (at least one always remains). Returns the removed preset, for Undo. */
export function deleteQuickPreset(id: string): QuickPreset | null {
  const q = setupStore().quick;
  if (q.presets.length <= 1) return null;
  const i = q.presets.findIndex((x) => x.id === id);
  if (i < 0) return null;
  const [gone] = q.presets.splice(i, 1);
  if (q.active === id) q.active = q.presets[0].id;
  saveSetupStore();
  return gone;
}

export function restoreQuickPreset(p: QuickPreset): void {
  const q = setupStore().quick;
  if (!q.presets.some((x) => x.id === p.id)) q.presets.push(p);
  saveSetupStore();
}

/** Take over V5 step 6's quick-match choices once. */
function migrate(): SetupStore | null {
  try {
    const raw = localStorage.getItem(OLD_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Record<string, unknown>;
    const s = defaultStore();
    const t = s.modes.tournament;
    if (o.tFormat === 'standard' || o.tFormat === 'sevens') t.format = o.tFormat;
    if (typeof o.tYou === 'string') t.p1.roster = o.tYou;
    if (typeof o.tCpu === 'string') t.p2.roster = o.tCpu;
    if (typeof o.tStyle === 'string') t.p2.ai = legacyAiId('bloodboard', o.tStyle);
    if (typeof o.tTeam === 'string' && o.tTeam) {
      t.p1.source = 'saved';
      t.p1.teamId = o.tTeam;
    }
    t.budget = t.format === 'sevens' ? 600_000 : 1_100_000;
    const x = s.modes.exhibition;
    if (o.xFormat === 'standard' || o.xFormat === 'sevens') x.format = o.xFormat;
    if (typeof o.xYou === 'string') x.p1.roster = o.xYou;
    if (typeof o.xCpu === 'string') x.p2.roster = o.xCpu;
    if (typeof o.xStyle === 'string') x.p2.ai = legacyAiId('bloodboard', o.xStyle);
    x.budget = x.format === 'sevens' ? 600_000 : 1_000_000;
    if (o.tiers && typeof o.tiers === 'object') s.tiers = { ...(o.tiers as Record<string, Tier>) };
    return s;
  } catch {
    return null;
  }
}

let current: SetupStore | null = null;
let native: PositionStore | null = null;
let nativeLoaded = false;

/** The remembered set-up (synchronous: local storage now; the Mac app's Settings file is merged in by `syncSetup`). */
export function setupStore(): SetupStore {
  if (current) return current;
  try {
    const raw = localStorage.getItem(KEY);
    current = raw ? normalise(JSON.parse(raw)) : migrate() ?? defaultStore();
  } catch {
    current = migrate() ?? defaultStore();
  }
  return current;
}

export function saveSetupStore(): void {
  const s = setupStore();
  s.savedAt = new Date().toISOString();
  const text = JSON.stringify(s);
  try {
    localStorage.setItem(KEY, text);
  } catch {
    /* remembering the set-up is optional */
  }
  if (native?.kind === 'native') void native.saveFile('setup', JSON.stringify(s, null, 1)).catch(() => undefined);
}

/**
 * Mac app: read Settings/setup.json (kept across restarts even if the web view's storage is not). The newer of the
 * two copies wins. Calls `done` when something changed.
 */
export async function syncSetup(done: () => void): Promise<void> {
  if (nativeLoaded) return;
  nativeLoaded = true;
  native = createStore('Settings');
  if (native.kind !== 'native') return;
  try {
    const text = await native.load('setup');
    const file = normalise(JSON.parse(text));
    const mine = setupStore();
    if (file.savedAt > mine.savedAt) {
      current = file;
      try {
        localStorage.setItem(KEY, JSON.stringify(file));
      } catch {
        /* optional */
      }
      done();
    } else if (mine.savedAt > file.savedAt) saveSetupStore();
  } catch {
    // No settings file yet: write the current set-up.
    saveSetupStore();
  }
}

export function modeCfg(m: SetupMode): ModeCfg {
  return setupStore().modes[m];
}

export function resetMode(m: SetupMode): void {
  setupStore().modes[m] = defaultMode(m);
  saveSetupStore();
}

// --- V5 step 6 API kept for older callers ---------------------------------------------------------------

export interface SetupPrefs {
  tiers: Record<string, Tier>;
}
export function loadSetup(): SetupPrefs {
  return { tiers: setupStore().tiers };
}
