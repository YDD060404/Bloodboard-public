/**
 * V6 pre-match lifecycle (engine side): which rosters can be drafted, the built-in basic roster choice, the built-in
 * team builder, and the engine's validation of any team a coach proposes — as structured violations, never prose to parse.
 * Nothing here knows about a coach module: the platform layer orchestrates, the engine decides legality.
 */
import { ROSTERS, ROSTER_BY_ID, findPosition, type Roster } from './rosters';
import { tierInfo } from './matched';
import { buildTeam, positionValue, type BuildOptions } from './teambuild';
import { teamBudget, teamCost, validateTeamDef, type TeamDef, type TeamIssue } from './teams';

export interface RosterInfo {
  id: string;
  name: string;
  leagues: string[];
  specialRules: string[];
  rerollCost: number;
  apothecary: boolean;
  favouredOf?: string[];
  positions: Array<{ id: string; name: string; cost: number; qty: string; ma: number; st: number; ag: number; pa: number | null; av: number; skills: string[]; keywords: string[] }>;
  /** Whether the built-in builder can draft a legal team for this format/play/budget. */
  draftable: boolean;
}

export type BuildFormat = BuildOptions['format'];

const key = (r: string, f: BuildFormat, p: BuildOptions['play'], b?: number) => `${r}|${f}|${p}|${b ?? ''}`;
const cache = new Map<string, TeamDef | null>();

/** The built-in builder's team for a roster (cached; deterministic — it uses no randomness). */
export function builtinTeam(rosterId: string, o0: BuildOptions): TeamDef | null {
  // Tournament (Matched Play) teams need a Tier: without an explicit one the roster's official / stated Tier is used (none known → not draftable).
  let o = o0;
  if (o.play === 'tournament' && !o.tier) {
    const tier = tierInfo(rosterId, o.format).tier;
    if (!tier) return null;
    o = { ...o, tier };
  }
  const k = key(rosterId, o.format, o.play, o.budget) + `|${o.id}|${o.name ?? ''}|${o.tier ?? ''}`;
  if (!cache.has(k)) cache.set(k, buildTeam(rosterId, o));
  const t = cache.get(k);
  return t ? (JSON.parse(JSON.stringify(t)) as TeamDef) : null;
}

export function rosterInfos(format: BuildFormat, play: BuildOptions['play'], budget?: number): RosterInfo[] {
  return ROSTERS.map((r: Roster) => ({
    id: r.id,
    name: r.name,
    leagues: r.leagues.slice(),
    specialRules: r.specialRules.slice(),
    rerollCost: r.rerollCost,
    apothecary: r.apothecary,
    ...(r.favouredOf ? { favouredOf: r.favouredOf.slice() } : {}),
    positions: r.positions.map((p) => ({ id: p.id, name: p.name, cost: p.cost, qty: p.qty, ma: p.ma, st: p.st, ag: p.ag, pa: p.pa, av: p.av, skills: p.skills.map((k) => (k.value ? `${k.id}(${k.value})` : k.id)), keywords: p.keywords.slice() })),
    draftable: !!builtinTeam(r.id, { format, play, budget, id: 'probe', name: 'probe' }),
  }));
}

/**
 * A plain, explainable strength figure of the team the built-in builder drafts for a roster: the summed position value of
 * its best players (11 or 7). It is a static draft measure, not a matchup model, and uses no coach tactics.
 */
export function rosterScore(rosterId: string, o: Pick<BuildOptions, 'format' | 'play' | 'budget'>): number {
  const t = builtinTeam(rosterId, { ...o, id: 'score', name: 'score' });
  if (!t) return -Infinity;
  const r = ROSTER_BY_ID[rosterId];
  const n = o.format === 'sevens' ? 7 : 11;
  const vals = t.players
    .map((p) => {
      const pos = findPosition(r, p.positionId);
      return pos ? positionValue({ ...pos, skills: [...pos.skills, ...p.skills] }) : 0;
    })
    .sort((a, b) => b - a)
    .slice(0, n);
  return vals.reduce((a, b) => a + b, 0);
}

export interface RosterChoice {
  rosterId: string;
  league?: string;
  favoured?: string;
  why: string;
  scores?: Array<{ rosterId: string; score: number }>;
}

/**
 * The built-in basic roster choice. `deterministic` = the best-scoring roster (ties by id); otherwise one of the rosters
 * within 8 % of the best, picked with `rand` (so matches vary but no roster is ever chosen for being weak). The same
 * procedure serves both seats; `opponent` is only passed in sequential choice and the baseline does not use it.
 */
export function chooseRosterBuiltin(o: Pick<BuildOptions, 'format' | 'play' | 'budget'> & { deterministic?: boolean; rand?: () => number; opponent?: string | null; exclude?: string[] }): RosterChoice {
  const scores = ROSTERS.filter((r) => !(o.exclude ?? []).includes(r.id))
    .map((r) => ({ rosterId: r.id, score: rosterScore(r.id, o) }))
    .filter((x) => Number.isFinite(x.score))
    .sort((a, b) => b.score - a.score || (a.rosterId < b.rosterId ? -1 : 1));
  if (!scores.length) throw new Error('No roster can be drafted for this format.');
  const best = scores[0];
  let pick = best;
  if (!o.deterministic && o.rand) {
    const pool = scores.filter((x) => x.score >= best.score * 0.92);
    pick = pool[Math.min(pool.length - 1, Math.floor(o.rand() * pool.length))];
  }
  const r = ROSTER_BY_ID[pick.rosterId];
  return { rosterId: pick.rosterId, ...(r.leagues.length > 1 ? { league: r.leagues[0] } : {}), why: `${r.name}: ${o.deterministic || !o.rand ? 'the best' : 'one of the best'} draft for ${o.format} (built-in draft score ${pick.score.toFixed(1)}).`, scores: scores.slice(0, 6) };
}

export interface Violation {
  level: 'error' | 'warning';
  /** Stable machine-readable class (from the issue text's rule), plus the engine's own wording. */
  code: string;
  text: string;
}

const CODES: Array<[RegExp, string]> = [
  [/budget|over\b.*gp|exceeds/i, 'budget'],
  [/at least|too few|minimum/i, 'too-few-players'],
  [/more than 16|too many players|maximum/i, 'too-many-players'],
  [/big guy|group|may have a single|at most/i, 'position-limit'],
  [/re-?roll/i, 'rerolls'],
  [/apothecary/i, 'apothecary'],
  [/skill|primary|secondary/i, 'skills'],
  [/captain/i, 'captain'],
  [/veteran/i, 'veteran'],
  [/league|favoured/i, 'league'],
  [/wear|number/i, 'numbers'],
  [/name/i, 'name'],
];
export const violationCode = (text: string): string => CODES.find(([re]) => re.test(text))?.[1] ?? 'rules';

export interface BuildValidation {
  ok: boolean;
  violations: Violation[];
  cost: number;
  budget: number;
}

/** Validate a proposed team with the engine's own rules (the single source of legality). */
export function validateBuild(t: TeamDef, expect?: { format?: BuildFormat; rosterId?: string }): BuildValidation {
  const issues: TeamIssue[] = validateTeamDef(t);
  const v: Violation[] = issues.map((i) => ({ level: i.level, code: violationCode(i.text), text: i.text }));
  if (expect?.format && (t.variant === 'sevens' ? 'sevens' : 'standard') !== expect.format) v.push({ level: 'error', code: 'format', text: `The team is a ${t.variant === 'sevens' ? 'Sevens' : 'standard 11-a-side'} team but this match is ${expect.format}.` });
  if (expect?.rosterId && !t.allStar && t.rosterId !== expect.rosterId) v.push({ level: 'error', code: 'roster', text: `The team's roster is ${t.rosterId ?? 'unknown'} but the chosen roster is ${expect.rosterId}.` });
  let cost = 0;
  let budget = 0;
  try {
    cost = teamCost(t).total;
    budget = teamBudget(t);
  } catch {
    /* an unusable team already has violations */
  }
  return { ok: !v.some((x) => x.level === 'error'), violations: v, cost, budget };
}
