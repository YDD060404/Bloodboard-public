/**
 * Match Lab v2 planning: turns a batch specification into a run plan (games, pairs, legs, seeds) and the exact team
 * snapshots every game will use. Pure: no files are read or written here (the runner does that), so it is unit-tested.
 *
 * Randomness is kept apart on purpose:
 *   - team choice uses its own generator (`teamSeed`, recorded in the plan),
 *   - match dice use the game's `seed` (fresh seeds come from a third generator, `seedBase`, also recorded),
 * so changing which teams are drawn never changes the dice seeds, and the plan (teams AND seeds) is saved before any game runs.
 */
import { buildTeam as engineBuildTeam, OFFICIAL_TIERS, teamBudget, validateTeamDef, type TeamDef, type Tier } from '../../engine/index';
import { buildTeam as classicTeam } from './teams';

export type Format = 'standard' | 'sevens';
export type PlayMode = 'tournament' | 'exhibition';

/** Where a team comes from: a roster (built by the engine's team builder with the batch's budget / tier / skills) or a saved team file (used exactly as saved). */
export interface TeamSource {
  key: string;
  kind: 'roster' | 'file';
  /** roster: `human`, `orc` (classic compositions) or `draft:<rosterId>`. */
  roster?: string;
  /** file: the parsed team definition (the caller read it). */
  def?: TeamDef;
  label: string;
  /** file: where it came from (recorded). */
  path?: string;
}

export interface BuildSettings {
  /** Team Draft Budget for roster-built teams (null = the format's usual one). */
  budget?: number | null;
  /** Matched Play Tier for roster-built teams in tournament mode (null = the roster's official tier). */
  tier?: Tier | null;
  /** Spend the tournament skill points (tournament mode). */
  skills?: boolean;
  /** Inducements both sides take (id → count); null / empty = none. Must fit the team's rules. */
  inducements?: Record<string, number> | null;
}

export interface BatchSpec {
  label?: string;
  format: Format;
  mode: PlayMode;
  rules: 'full' | 'introductory';
  build: BuildSettings;
  /** 'fixed': P1 and P2 each play the team named in `fixed`; 'random': each game (or pair) draws teams from `pool`. */
  teams: { kind: 'fixed'; p1: string; p2: string } | { kind: 'random'; pool: string[]; sameForBoth?: boolean };
  /** The same team for both sides in every game (a mirror match). Only for fixed: p2 is ignored. */
  mirror?: boolean;
  seeds: { kind: 'fresh' } | { kind: 'base'; base: number } | { kind: 'list'; list: number[] };
  /** none: independent games (P1 is side A). swap: pairs of games with the same seed and teams, sides swapped in leg 2. */
  pairing: 'none' | 'swap';
  /** Games (pairing none) or pairs (swap). Ignored for a seed list: its length decides. */
  count: number;
  /** Team-draw generator seed (null = fresh); recorded. */
  teamSeed?: number | null;
  /** Fresh-seed generator seed (null = fresh); recorded. */
  seedBase?: number | null;
}

export interface Snapshot { id: string; source: string; label: string; format: Format; def: TeamDef }

export interface PlannedGame {
  game: string;
  pair: string | null;
  leg: 1 | 2 | null;
  seed: number;
  format: Format;
  /** Snapshot ids per side. */
  teams: { A: string; B: string };
  /** Coach indexes per side (0 = P1, 1 = P2). */
  coach: { A: number; B: number };
  slots: { A: 'P1' | 'P2'; B: 'P1' | 'P2' };
}

export interface Plan {
  games: PlannedGame[];
  snapshots: Record<string, Snapshot>;
  pairs: number;
  gamesTotal: number;
  teamSeed: number;
  seedBase: number;
  notes: string[];
}

/** Small, fast, seedable generator (mulberry32). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd32 = (): number => Math.floor(Math.random() * 0xffffffff) >>> 0;
const pad = (n: number, w: number): string => String(n).padStart(w, '0');

/** Builds the team of one source under the batch's settings. Throws with a plain-language message. */
export function resolveTeam(src: TeamSource, format: Format, mode: PlayMode, b: BuildSettings, id: string): TeamDef {
  let t: TeamDef | null = null;
  if (src.kind === 'file') {
    if (!src.def) throw new Error(`${src.label}: the team file was not loaded.`);
    t = JSON.parse(JSON.stringify(src.def)) as TeamDef;
    if ((t.variant ?? 'standard') !== format) throw new Error(`${src.label} is a ${(t.variant ?? 'standard') === 'sevens' ? 'Sevens' : '11-a-side'} team; this batch plays ${format === 'sevens' ? 'Sevens' : '11-a-side'}.`);
    if (t.kind !== 'tournament') throw new Error(`${src.label} is a League team; batches need teams built with the tournament template.`);
  } else {
    const roster = src.roster as string;
    if (roster.startsWith('draft:')) {
      const rid = roster.slice(6);
      const tier = mode === 'tournament' ? b.tier ?? OFFICIAL_TIERS.tiers[rid] ?? 3 : undefined;
      t = engineBuildTeam(rid, { format, play: mode, budget: b.budget ?? undefined, budgetCustom: !!b.budget && mode === 'exhibition', tier: tier as Tier | undefined, skills: b.skills !== false, id });
      if (!t) throw new Error(`Roster "${rid}" cannot be built for ${format === 'sevens' ? 'Sevens' : '11-a-side'} with these settings.`);
    } else t = classicTeam(roster, format);
  }
  if (b.inducements && Object.values(b.inducements).some((k) => k > 0)) t.inducements = { ...(t.inducements ?? {}), ...Object.fromEntries(Object.entries(b.inducements).filter(([, k]) => k > 0)) };
  const errs = validateTeamDef(t).filter((i) => i.level === 'error');
  if (errs.length) throw new Error(`${src.label}: ${errs.map((e) => e.text).join('; ')}`);
  void teamBudget;
  return t;
}

/** The full plan of a batch. Deterministic given the spec (including the recorded generator seeds). */
export function planBatch(spec: BatchSpec, sources: TeamSource[]): Plan {
  const byKey = new Map(sources.map((s) => [s.key, s]));
  const src = (k: string): TeamSource => {
    const s = byKey.get(k);
    if (!s) throw new Error(`Unknown team source "${k}".`);
    return s;
  };
  const teamSeed = spec.teamSeed ?? rnd32();
  const seedBase = spec.seedBase ?? rnd32();
  const teamRng = prng(teamSeed);
  const seedRng = prng(seedBase ^ 0x9e3779b9);
  const notes: string[] = [];
  const swap = spec.pairing === 'swap';
  const n = spec.seeds.kind === 'list' ? spec.seeds.list.length : Math.max(0, Math.floor(spec.count));
  if (n < 1) throw new Error('Nothing to play: choose at least one game (or one pair).');
  if (n * (swap ? 2 : 1) > 20000) throw new Error(`That is ${n * (swap ? 2 : 1)} games; the limit per batch is 20000.`);
  const seedOf = (i: number): number => (spec.seeds.kind === 'list' ? spec.seeds.list[i] : spec.seeds.kind === 'base' ? spec.seeds.base + i : Math.floor(seedRng() * 0x7fffffff) + 1);
  const snapshots: Record<string, Snapshot> = {};
  const bySource = new Map<string, string>();
  const snapshotOf = (key: string): string => {
    const have = bySource.get(key);
    if (have) return have;
    const id = `T${pad(bySource.size + 1, 3)}`;
    const def = resolveTeam(src(key), spec.format, spec.mode, spec.build, `${id}-${key.replace(/[^A-Za-z0-9]+/g, '-').slice(0, 24)}`);
    snapshots[id] = { id, source: key, label: src(key).label, format: spec.format, def };
    bySource.set(key, id);
    return id;
  };
  const pick = (pool: string[]): string => pool[Math.min(pool.length - 1, Math.floor(teamRng() * pool.length))];
  if (spec.teams.kind === 'random') {
    if (!spec.teams.pool.length) throw new Error('The random team pool is empty: select at least one eligible team.');
    if (spec.teams.pool.length === 1) notes.push('The pool has one team, so every game uses it.');
  }
  const games: PlannedGame[] = [];
  for (let i = 0; i < n; i++) {
    const seed = seedOf(i);
    let p1: string;
    let p2: string;
    if (spec.teams.kind === 'fixed') {
      p1 = spec.teams.p1;
      p2 = spec.mirror ? spec.teams.p1 : spec.teams.p2;
    } else {
      p1 = pick(spec.teams.pool);
      p2 = spec.teams.sameForBoth || spec.mirror ? p1 : pick(spec.teams.pool);
    }
    const t1 = snapshotOf(p1);
    const t2 = snapshotOf(p2);
    if (swap) {
      const pair = `p${pad(i + 1, 4)}`;
      games.push({ game: `${pair}-L1`, pair, leg: 1, seed, format: spec.format, teams: { A: t1, B: t2 }, coach: { A: 0, B: 1 }, slots: { A: 'P1', B: 'P2' } });
      games.push({ game: `${pair}-L2`, pair, leg: 2, seed, format: spec.format, teams: { A: t2, B: t1 }, coach: { A: 1, B: 0 }, slots: { A: 'P2', B: 'P1' } });
    } else games.push({ game: `g${pad(i + 1, 4)}`, pair: null, leg: null, seed, format: spec.format, teams: { A: t1, B: t2 }, coach: { A: 0, B: 1 }, slots: { A: 'P1', B: 'P2' } });
  }
  return { games, snapshots, pairs: swap ? n : 0, gamesTotal: games.length, teamSeed, seedBase, notes };
}

/** "N pairs = 2N games" (or N games), as shown next to the count field. */
export function countText(pairing: 'none' | 'swap', n: number): string {
  return pairing === 'swap' ? `${n} pair${n === 1 ? '' : 's'} = ${2 * n} games (each pair: same seed and teams, sides swapped)` : `${n} game${n === 1 ? '' : 's'}`;
}

/**
 * Default concurrency for a machine: games in parallel, engine workers, and the reasoning behind them.
 * A built-in / parameter coach decides in ONE engine worker per decision (no speed-up inside a decision), so its batches
 * scale with the number of games in flight: games = workers. A strategy module also spends a thread per game and fans
 * its engine services out over the pool, so fewer games and the remaining cores as workers.
 */
export function cpuPlan(cores: number, memGiB: number, coachKinds: Array<'builtin' | 'profile' | 'module'>): { games: number; workers: number; note: string } {
  const c = Math.max(1, Math.floor(cores));
  // Two cores stay free for the Lab itself, the window and the system.
  const usable = Math.max(1, c - 2);
  // A worker's heap is capped at 768 MB and a running game (log, decision records) was measured at up to about 0.6 GiB resident: plan with 1.6 GiB per game+worker and use at most half the memory.
  const byMem = Math.max(1, Math.floor((memGiB * 0.5) / 1.6));
  const hasModule = coachKinds.includes('module');
  let games: number;
  let workers: number;
  if (c <= 2) { games = 1; workers = 1; }
  else if (hasModule) { games = Math.max(1, Math.min(4, Math.floor(usable / 2))); workers = Math.max(1, usable - games); }
  else { games = Math.min(usable, byMem, 8); workers = games; }
  workers = Math.min(workers, byMem, 8);
  games = Math.min(games, 8);
  return { games, workers, note: `${c} cores, ${memGiB.toFixed(0)} GiB: ${games} game${games === 1 ? '' : 's'} at a time with ${workers} engine worker${workers === 1 ? '' : 's'}${hasModule ? ' (each strategy module also runs in its own thread)' : ' (a built-in coach uses one worker per decision, so games and workers match)'}.` };
}
