/**
 * V5.5: one set-up for every match — League, Tournament, Exhibition (11-a-side or Sevens) and the All-Star Match
 * (a custom Exhibition variant).
 *
 *   Player 1 (Team A)  — Human or Computer (then the AI file: one choice per valid file in the AI folder) — the team
 *   Player 2 (Team B)  — the same
 *   Shared settings    — format, competition budget, rules, skills, difficulty, dice seed; League: the pre-match
 *                        Inducements (p.94); All-Star: squad limits.
 *
 * Human v human (on one computer), human v computer, computer v human and computer v computer (a match to watch).
 * Every choice is remembered per mode (setupPrefs.ts) — also across restarts of the Mac app — and can be reset.
 * A saved team or an AI that is no longer there is reported next to its side and replaced by a valid choice.
 */
import type { App, TeamFormat } from './app';
import { h } from './dom';
import { E, type CoachRef, type TeamDef, type TeamId } from './engine-global';
import { WORKER_CHOICES, autoWorkers, effectiveWorkers, poolProblem, setWorkersSetting, workersSetting } from './enginepool';
import { BUNDLED_FILES, coachById, fallbackCoach, legacyAiId, listCoaches, usableCoaches, type CoachEntry } from '../ai/index';
import { coachRef } from './computer';
import { browserSpawn } from './strategy';
import { buildTeamFor, chooseRoster, type StageReport } from '../platform/lifecycle';
import { openOnlineCoaches } from './onlinecoaches';
import { aiLoadState, aiStoreKind, importAIFile, loadAIFolder, restoreBundledAI } from './aiload';
import { DIFFICULTY_TEXT, difficultyTable } from './difficulty';
import { quickDraft, quickSevens } from './matchui';
import { lanHostIntercept } from './lanclient';
import { ensureTeamsLoaded, rostersByName, saveTeam, teamCache, teamsOfKind } from './teams';
import { activeQuick, DEFAULT_ALLSTARS, defaultMode, modeCfg, quickPresets, renameQuickPreset, resetMode, saveQuickPreset, saveSetupStore, setActiveQuick, setupStore, SETUP_MODES, type ModeCfg, type QuickPreset, type SetupMode, type SideCfg, type Tier } from './setupPrefs';

export const MODE_LABEL: Record<SetupMode, string> = { league: 'League', tournament: 'Tournament', exhibition: 'Exhibition', allstar: 'All-Star Match' };
const SIDE: Record<'p1' | 'p2', { team: TeamId; label: string; end: string }> = {
  p1: { team: 'A', label: 'Player 1', end: 'Team A — home, starts at the left End Zone' },
  p2: { team: 'B', label: 'Player 2', end: 'Team B — away, starts at the right End Zone' },
};

/** Open the set-up of a mode (and optionally a format). */
export function openSetup(app: App, mode: SetupMode, format?: TeamFormat): void {
  const cfg = modeCfg(mode);
  if (format && mode !== 'league') {
    cfg.format = format;
    saveSetupStore();
  }
  app.set({ screen: 'newMatch', setupMode: mode, quickEdit: undefined, teamKind: mode === 'allstar' ? 'exhibition' : mode, teamFormat: cfg.format });
}

const remember = (app: App) => {
  saveSetupStore();
  app.emit();
};

// ---------------------------------------------------------------------------
// Resolving a side: the team it plays with, and notes about fallbacks
// ---------------------------------------------------------------------------

export interface ResolvedSide {
  team: TeamDef | null;
  notes: string[];
  errors: string[];
  /** The AI file actually used (after a fallback). */
  ai: CoachEntry | null;
}

const kindOf = (mode: SetupMode): 'league' | 'tournament' | 'exhibition' => (mode === 'allstar' ? 'exhibition' : mode);

/** The official / stated Tier of a roster, or the event Tier chosen for it. */
export function tierFor(format: TeamFormat, roster: string, chosen: Tier | null): { tier: Tier; event: boolean; label: string } {
  const info = E.tierInfo(roster, format);
  const tier = (chosen ?? info.tier ?? 2) as Tier;
  const event = chosen !== null ? E.isEventTier(roster, format, chosen) : info.kind === 'none';
  return { tier, event, label: event ? `Tier ${tier} — event-specific${info.kind === 'none' ? ' (no official Tier for this roster)' : ` (official: ${info.label})`}` : info.label };
}

function readyTeam(mode: SetupMode, cfg: ModeCfg, key: 'p1' | 'p2', s: SideCfg): { team: TeamDef | null; notes: string[] } {
  const notes: string[] = [];
  const r = E.ROSTER_BY_ID[s.roster];
  if (!r) return { team: null, notes: [`Unknown roster "${s.roster}".`] };
  const sevens = cfg.format === 'sevens';
  // The same roster on both sides: the second team is told apart by "*" (and inverted colours, set by the engine).
  const same = mode !== 'allstar' && cfg.p1.source === 'ready' && cfg.p2.source === 'ready' && cfg.p1.roster === cfg.p2.roster && key === 'p2';
  const name = `${r.name}${sevens ? ' Sevens' : ''}${same ? E.MIRROR_MARK : ''}`;
  const id = `setup-${mode}-${key}-${s.roster}`;
  if (mode === 'tournament') {
    const t = tierFor(cfg.format, s.roster, s.tier);
    const built = E.buildTeam(s.roster, { format: cfg.format, play: 'tournament', tier: t.tier, budget: cfg.budget, budgetCustom: cfg.budgetCustom, skills: cfg.autoSkills, id, name });
    if (built) return { team: built, notes };
    notes.push(`No team could be built for ${r.name} within ${cfg.budget.toLocaleString('en-GB')} gp — the fixed ready-made team is used.`);
    const q = sevens ? quickSevens(s.roster, id, name, { play: 'tournament', tier: t.tier }) : quickDraft(s.roster, id, name, { play: 'tournament', tier: t.tier });
    if (cfg.autoSkills) E.autoSkills(q);
    return { team: q, notes };
  }
  const built = E.buildTeam(s.roster, { format: cfg.format, play: 'exhibition', budget: cfg.budget, budgetCustom: cfg.budgetCustom, id, name });
  if (built) return { team: built, notes };
  notes.push(`No team could be built for ${r.name} within ${cfg.budget.toLocaleString('en-GB')} gp — the fixed ready-made team is used.`);
  return { team: sevens ? quickSevens(s.roster, id, name, { play: 'exhibition' }) : quickDraft(s.roster, id, name, { play: 'exhibition' }), notes };
}

function allStarTeam(cfg: ModeCfg, key: 'p1' | 'p2', s: SideCfg): { team: TeamDef; notes: string[] } {
  const notes: string[] = [];
  const t = E.newAllStarSquad(`allstar-${key}`, `All-Stars ${SIDE[key].label}${cfg.format === 'sevens' ? ' (Sevens)' : ''}`, cfg.format === 'sevens' ? 'sevens' : 'standard', { budget: cfg.allStar.budget, maxStars: cfg.allStar.maxStars });
  if (key === 'p2') {
    t.color = '#1f6f5c';
    t.accent = '#f4f1e8';
  }
  let k = 0;
  for (const id of s.stars) {
    if (t.players.some((p) => p.star === id)) continue;
    const why = E.starAddReason(t, id);
    if (why) {
      notes.push(`${E.STAR_BY_ID[id]?.name ?? id}: ${why}`);
      continue;
    }
    E.addStar(t, id, () => `allstar-${key}-${k++}`);
  }
  return { team: t, notes };
}

/** The AI file a computer side uses: the chosen one if installed (and meant for the format), else the fallback. */
function resolveAI(s: SideCfg, format: TeamFormat, notes: string[]): CoachEntry | null {
  const want = legacyAiId(s.ai, s.style);
  const e = coachById(want);
  if (e && !e.errors?.length && (!e.formats || e.formats.includes(format))) return e;
  const fb = fallbackCoach(format);
  const instead = fb ? ` — ${fb.name} ${fb.version} is used instead (choose another below)` : '';
  notes.push(e ? `The AI file “${e.name}” cannot be used (${e.errors?.[0] ?? `not for ${format === 'sevens' ? 'Sevens' : '11-a-side'}`})${instead}.` : `The AI file “${want}” is not installed${instead}.`);
  return fb;
}

/** V6: does this side use the AI lifecycle (roster choice / team build for this match)? Only computer sides of Tournament and Exhibition. */
export const usesAiBuild = (mode: SetupMode, s: SideCfg) => s.source === 'ai' && s.controller === 'computer' && (mode === 'tournament' || mode === 'exhibition');

/**
 * The roster an AI-build side previews / falls back to, with a budget that can actually draft (a stored budget of the other format or a
 * stale value must never make the set-up unrenderable): the chosen budget first, then the format's default. Never throws.
 */
function aiRosterFor(mode: SetupMode, cfg: ModeCfg, key: 'p1' | 'p2', s: SideCfg): { rosterId: string | null; budget: number | undefined; note: string | null } {
  const play = mode === 'tournament' ? 'tournament' : 'exhibition';
  const concrete = E.ROSTER_BY_ID[s.roster] ? s.roster : null;
  const opponent = cfg[key === 'p1' ? 'p2' : 'p1'].roster;
  const tries: Array<number | undefined> = cfg.budgetCustom ? [cfg.budget] : [cfg.budget, undefined];
  if (!tries.includes(undefined)) tries.push(undefined);
  for (const budget of tries) {
    try {
      if (s.aiRoster) return { rosterId: E.chooseRosterBuiltin({ format: cfg.format, play, budget: budget && budget > 0 ? budget : undefined, deterministic: true, opponent }).rosterId, budget, note: budget === cfg.budget ? null : 'The stored budget does not fit this format, so the format\u2019s usual budget is used.' };
      if (concrete && E.builtinTeam(concrete, { format: cfg.format, play, budget: budget && budget > 0 ? budget : undefined, id: 'probe', name: 'probe' })) return { rosterId: concrete, budget, note: budget === cfg.budget ? null : 'The stored budget does not fit this format, so the format\u2019s usual budget is used.' };
    } catch { /* try the next budget */ }
  }
  return { rosterId: null, budget: undefined, note: null };
}

export interface PrebuiltSide { team: TeamDef; reports: StageReport[] }

/** The team an AI-build side would get from the built-in baseline (the preview, and the explicit fallback of every stage). */
function aiPreview(mode: SetupMode, cfg: ModeCfg, key: 'p1' | 'p2', s: SideCfg): { team: TeamDef | null; notes: string[]; errors: string[] } {
  const play = mode === 'tournament' ? 'tournament' : 'exhibition';
  const r = aiRosterFor(mode, cfg, key, s);
  const notes = [`AI Build: ${s.aiRoster ? 'the AI chooses the roster and ' : ''}builds this team when the match starts. The team shown is the built-in legal baseline — used if the AI file has no builder or its team is not legal.`];
  if (r.note) notes.push(r.note);
  const ros = r.rosterId ? E.ROSTER_BY_ID[r.rosterId] : null;
  if (!r.rosterId || !ros) return { team: null, notes, errors: [s.aiRoster ? `No roster can be drafted for this format${mode === 'tournament' ? ' and Tier' : ''} and budget. Choose a roster yourself or another team source.` : `${E.ROSTER_BY_ID[s.roster]?.name ?? 'This roster'} cannot be drafted for this format${mode === 'tournament' ? ' (Tournament teams need a Tier)' : ''} and budget. Choose another roster.`] };
  let team: TeamDef | null = null;
  try { team = E.builtinTeam(r.rosterId, { format: cfg.format, play, budget: r.budget && r.budget > 0 ? r.budget : undefined, ...(play === 'tournament' && !s.aiRoster ? (() => { const tr = tierFor(cfg.format, r.rosterId!, s.tier).tier; return tr ? { tier: tr } : {}; })() : {}), id: `setup-${mode}-${key}-${r.rosterId}`, name: `${ros.name}${cfg.format === 'sevens' ? ' Sevens' : ''}` }); } catch { team = null; }
  return { team, notes, errors: team ? [] : [`No team can be built for ${ros.name} here.`] };
}

/** Never throws: a stored state that cannot be resolved is reported next to its side instead of making the whole set-up screen disappear. */
export function resolveSide(mode: SetupMode, cfg: ModeCfg, key: 'p1' | 'p2', prebuilt?: PrebuiltSide): ResolvedSide {
  try {
    return resolveSideUnsafe(mode, cfg, key, prebuilt);
  } catch (e) {
    return { team: null, notes: [], errors: [`This side’s stored set-up could not be used (${(e as Error).message}). Choose the roster and team again.`], ai: null };
  }
}

function resolveSideUnsafe(mode: SetupMode, cfg: ModeCfg, key: 'p1' | 'p2', prebuilt?: PrebuiltSide): ResolvedSide {
  const s = cfg[key];
  const notes: string[] = [];
  const errors: string[] = [];
  let team: TeamDef | null = null;
  if (mode === 'allstar') team = allStarTeam(cfg, key, s).team;
  else if (usesAiBuild(mode, s)) {
    if (prebuilt) {
      team = prebuilt.team;
      for (const r of prebuilt.reports) notes.push(`AI ${r.stage === 'roster' ? 'roster choice' : 'team build'}: ${r.via === 'coach' ? 'by the AI file' : 'built-in'}${r.fellBack ? ` (fallback: ${r.reason})` : ''}${r.why ? ` — ${r.why}` : ''}`);
    } else {
      const r = aiPreview(mode, cfg, key, s);
      team = r.team;
      notes.push(...r.notes);
      errors.push(...r.errors);
    }
  } else if (s.source === 'saved' || mode === 'league') {
    const list = teamsOfKind(kindOf(mode), cfg.format);
    const saved = s.teamId ? teamCache.get(s.teamId) : undefined;
    const fits = saved && list.some((x) => x.id === saved.id);
    if (fits) {
      team = JSON.parse(JSON.stringify(saved));
      // V5.5: the same saved team for both players is allowed — Player 2 plays an independent copy.
      const o = cfg.p1;
      if (key === 'p2' && saved && (o.source === 'saved' || mode === 'league') && o.teamId === saved.id)
        notes.push(`Both players use “${saved.name}”: Player 2 plays an independent match copy, shown as “${saved.name}${E.MIRROR_MARK}” in inverted colours. The saved team itself is not changed${mode === 'league' ? ' (only Player 1’s Star Player Points are added to it after the match)' : ''}.`);
    } else if (mode === 'league') {
      const other = cfg[key === 'p1' ? 'p2' : 'p1'].teamId;
      const alt = list.find((x) => x.id !== other) ?? list[0];
      if (s.teamId) notes.push(`The saved League team chosen before is no longer there${alt ? ` — “${alt.name}” is used instead` : ''}.`);
      if (alt) team = JSON.parse(JSON.stringify(alt));
      else errors.push('No saved League team yet — create one under League teams (or add the starter teams).');
    } else {
      if (s.teamId) notes.push(`The saved team chosen before is no longer there (or is not a ${MODE_LABEL[mode]} ${cfg.format === 'sevens' ? 'Sevens' : '11-a-side'} team) — a ready-made ${E.ROSTER_BY_ID[s.roster]?.name ?? s.roster} team is used instead.`);
      const r = readyTeam(mode, cfg, key, s);
      team = r.team;
      notes.push(...r.notes);
    }
  } else {
    const r = readyTeam(mode, cfg, key, s);
    team = r.team;
    notes.push(...r.notes);
  }
  if (mode === 'allstar') notes.push(...allStarTeam(cfg, key, s).notes);
  if (team) for (const i of E.validateTeamDef(team)) if (i.level === 'error') errors.push(i.text);
  const ai = s.controller === 'computer' ? resolveAI(s, cfg.format, notes) : null;
  if (s.controller === 'computer' && !ai) errors.push('No AI file is installed: restore the bundled AI files, add one to the AI folder, or choose Human.');
  return { team, notes, errors, ai };
}

// ---------------------------------------------------------------------------
// League pre-match Inducements (p.94)
// ---------------------------------------------------------------------------

const leagueBuy: { key: string; A: import('./engine-global').PreMatchPurchase; B: import('./engine-global').PreMatchPurchase } = { key: '', A: { inducements: {}, stars: [] }, B: { inducements: {}, stars: [] } };

function leagueFunds(a: TeamDef, b: TeamDef) {
  const f0 = E.preMatchFunds(a, b, 0);
  const higher = f0.higher;
  const spentHigher = higher ? Math.max(0, E.purchaseCost(higher === 'A' ? a : b, leagueBuy[higher]) - f0.funds[higher].pettyCash) : 0;
  return E.preMatchFunds(a, b, spentHigher);
}

// ---------------------------------------------------------------------------
// Starting the match
// ---------------------------------------------------------------------------

/** Build and start the match of this mode's set-up. Returns the errors (empty when it started). */
export function startFromSetup(app: App, mode: SetupMode, cfg: ModeCfg = modeCfg(mode), prebuilt: Partial<Record<'p1' | 'p2', PrebuiltSide>> = {}): string[] {
  ensureTeamsLoaded(app);
  const r1 = resolveSide(mode, cfg, 'p1', prebuilt.p1);
  const r2 = resolveSide(mode, cfg, 'p2', prebuilt.p2);
  const errors = [...r1.errors.map((e) => `Player 1: ${e}`), ...r2.errors.map((e) => `Player 2: ${e}`)];
  if (!r1.team || !r2.team) return errors.length ? errors : ['Choose a team for both players.'];
  if (errors.length) return errors;
  let a = r1.team;
  let b = r2.team;
  let spentTreasury: Record<TeamId, number> = { A: 0, B: 0 };
  if (mode === 'league') {
    // Pre-match Inducements (p.94): computer-coached teams choose their own; the human choices come from the panel.
    if (leagueBuy.key !== `${a.id}|${b.id}`) resetLeagueBuy(a, b);
    const f = leagueFunds(a, b);
    if (cfg.p1.controller === 'computer') leagueBuy.A = E.computerPreMatch(a, f.funds.A);
    if (cfg.p2.controller === 'computer') leagueBuy.B = E.computerPreMatch(b, f.funds.B);
    const f2 = leagueFunds(a, b);
    const ma = E.leagueMatchTeam(a, leagueBuy.A, f2.funds.A, f2.ctv.A);
    const mb = E.leagueMatchTeam(b, leagueBuy.B, f2.funds.B, f2.ctv.B);
    if (!ma.ok) return ma.errors.map((e) => `Player 1 Inducements: ${e}`);
    if (!mb.ok) return mb.errors.map((e) => `Player 2 Inducements: ${e}`);
    a = ma.team;
    b = mb.team;
    spentTreasury = { A: ma.treasurySpent, B: a.id === b.id ? 0 : mb.treasurySpent };
  }
  const coaches: Partial<Record<TeamId, CoachRef>> = {};
  if (cfg.p1.controller === 'computer' && r1.ai) coaches.A = coachRef(r1.ai);
  if (cfg.p2.controller === 'computer' && r2.ai) coaches.B = coachRef(r2.ai);
  const cpuTeams = Object.keys(coaches) as TeamId[];
  const human = (['A', 'B'] as TeamId[]).filter((t) => !coaches[t]);
  const dif = cfg.difficulty;
  const useDif = mode !== 'tournament' && cpuTeams.length === 1 && human.length === 1 && (dif.human > 0 || dif.computer > 0);
  const options = {
    rules: cfg.rules,
    ...(mode === 'league' ? {} : { play: mode === 'tournament' ? ('tournament' as const) : ('exhibition' as const) }),
    ...(cpuTeams.length ? { computer: { team: cpuTeams[0] }, coaches } : {}),
    ...(useDif ? { difficulty: { player: dif.human, computer: dif.computer } } : {}),
    ...(cfg.format === 'sevens' && cfg.otbNaf ? { sevensOnTheBall: 'ownArea' as const } : {}),
  };
  const seed = cfg.seed ?? Math.floor(Math.random() * 2 ** 31);
  const res = E.createMatch(mode === 'league' ? 'league' : 'tournament', a, b, options, seed >>> 0);
  if (!res.ok || !res.state) return res.errors;
  if (mode === 'league') {
    leagueBuy.key = '';
    // Treasury gold spent on the pre-match purchases is gone (p.94): taken off the saved League teams now. (Player 2's
    // copy of the same saved team spends nothing of it.)
    for (const t of ['A', 'B'] as TeamId[]) {
      const spent = spentTreasury[t];
      const saved = spent > 0 ? teamCache.get((t === 'A' ? r1 : r2).team!.id) : undefined;
      if (!saved) continue;
      const upd: TeamDef = JSON.parse(JSON.stringify(saved));
      upd.treasury = Math.max(0, (upd.treasury ?? 0) - spent);
      void saveTeam(app, upd, false);
    }
  }
  if (app.lan?.hosting) {
    if (mode === 'league' || cpuTeams.length) return ['A network match is between two human coaches: choose Exhibition or Tournament and set both players to Human.'];
    if (lanHostIntercept(app, res.state)) return [];
  }
  app.openBoard(res.state, { kind: 'match', matchKind: mode === 'league' ? 'league' : 'tournament' }, { docName: `${a.name} v ${b.name}` });
  // The advisory coach chosen in the set-up (AI Focus, takeovers); it can be changed during the match.
  app.st.computer.advisorAi = cfg.advisor;
  app.savePrefs();
  const who = cpuTeams.length === 2 ? 'Computer v computer — watch, pause or change the speed in the computer card.' : cpuTeams.length === 1 ? `${human[0] === 'A' ? 'You are Player 1' : 'You are Player 2'} against the computer.` : 'Two coaches on this computer (hot-seat).';
  app.toast(`${cfg.format === 'sevens' ? 'Blood Bowl Sevens ' : ''}${MODE_LABEL[mode]} match. ${who}`);
  return [];
}

/**
 * V6: start the match of a set-up, running the AI lifecycle first for sides set to "AI Build": roster choice (optional) →
 * team construction → engine validation (3 correction attempts) → built-in baseline on any failure. Sides without AI Build
 * start exactly as before. Reports are kept on `window.bloodboardLifecycle` and shown in the first toast.
 */
export async function startFromSetupAsync(app: App, mode: SetupMode, cfg: ModeCfg = modeCfg(mode)): Promise<string[]> {
  ensureTeamsLoaded(app);
  const sides = (['p1', 'p2'] as const).filter((k) => usesAiBuild(mode, cfg[k]));
  if (!sides.length) return startFromSetup(app, mode, cfg);
  const prebuilt: Partial<Record<'p1' | 'p2', PrebuiltSide>> = {};
  const play = mode === 'tournament' ? 'tournament' : 'exhibition';
  const log: Array<{ side: string; reports: StageReport[] }> = [];
  const chosen: Partial<Record<'p1' | 'p2', string>> = {};
  for (const k of sides) {
    const s = cfg[k];
    const ai = resolveSide(mode, cfg, k).ai;
    const entry = ai && ai.kind === 'strategy' ? ai : null;
    const deps = { spawn: browserSpawn, note: (why: string) => app.toast(why) };
    const reports: StageReport[] = [];
    const rb = aiRosterFor(mode, cfg, k, { ...s, aiRoster: false });
    const budget = rb.rosterId ? rb.budget : undefined;
    let rosterId = s.roster;
    let league: string | undefined;
    let favoured: string | undefined;
    if (s.aiRoster) {
      const other = k === 'p1' ? 'p2' : 'p1';
      const r = await chooseRoster(deps, { format: cfg.format, play, budget: aiRosterFor(mode, cfg, k, s).budget, mode: sides.includes(other) && other === 'p2' ? 'blind' : 'sequential', opponentRoster: chosen[other] ?? (cfg[other].source !== 'saved' ? cfg[other].roster : null), entry, deterministic: false, rand: Math.random });
      reports.push(r.report);
      rosterId = r.choice.rosterId; league = r.choice.league; favoured = r.choice.favoured;
    }
    chosen[k] = rosterId;
    const sevens = cfg.format === 'sevens';
    const name = `${E.ROSTER_BY_ID[rosterId]?.name ?? rosterId}${sevens ? ' Sevens' : ''}${k === 'p2' && cfg.p1.roster === rosterId && !cfg.p1.aiRoster && !s.aiRoster ? E.MIRROR_MARK : ''}`;
    let built;
    try {
      built = await buildTeamFor(deps, { rosterId, league, favoured, format: cfg.format, play, budget, ...(play === 'tournament' && !s.aiRoster ? { tier: tierFor(cfg.format, rosterId, s.tier).tier ?? undefined } : {}), id: `setup-${mode}-${k}-${rosterId}`, name, entry });
    } catch (e) {
      return [`${k === 'p1' ? 'Player 1' : 'Player 2'}: no team could be built (${(e as Error).message}). Choose another roster or a saved team.`];
    }
    // The user's roster is authoritative unless "AI chooses" is on: a build for another roster is never started.
    if (!s.aiRoster && built.team.rosterId !== s.roster) return [`${k === 'p1' ? 'Player 1' : 'Player 2'}: the team built is not a ${E.ROSTER_BY_ID[s.roster]?.name ?? s.roster} team (${built.team.rosterId ?? 'unknown'}). Nothing was started.`];
    reports.push(built.report);
    prebuilt[k] = { team: built.team, reports };
    log.push({ side: k, reports });
  }
  (window as unknown as { bloodboardLifecycle?: unknown }).bloodboardLifecycle = log;
  return startFromSetup(app, mode, cfg, prebuilt);
}

function resetLeagueBuy(a: TeamDef, b: TeamDef) {
  leagueBuy.key = `${a.id}|${b.id}`;
  leagueBuy.A = { inducements: {}, stars: [] };
  leagueBuy.B = { inducements: {}, stars: [] };
}

/** One line describing the remembered set-up of a mode (Home screen quick start). */
export function setupSummary(mode: SetupMode, cfg: ModeCfg = modeCfg(mode)): string {
  const who = (k: 'p1' | 'p2') => {
    const s = cfg[k];
    const ctl = s.controller === 'human' ? 'Human' : `Computer (${coachById(legacyAiId(s.ai, s.style))?.name ?? s.ai})`;
    let team: string;
    if (mode === 'allstar') team = `${s.stars.length} Star Players`;
    else if (s.source === 'saved' || mode === 'league') team = teamCache.get(s.teamId)?.name ?? (mode === 'league' ? 'a saved League team' : 'a saved team');
    else team = `${E.ROSTER_BY_ID[s.roster]?.name ?? s.roster}${mode === 'tournament' ? ` (${tierFor(cfg.format, s.roster, s.tier).label.replace(/ \(.*$/, '')})` : ''}`;
    return `${ctl}: ${team}`;
  };
  return `${cfg.format === 'sevens' ? 'Sevens' : '11-a-side'} · P1 ${who('p1')} v P2 ${who('p2')}`;
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

const aiOpen: Record<string, boolean> = {};
/** V5.5: the set-up before the last "Reset to defaults" (no confirmation; Undo instead). */
let lastReset: { mode: SetupMode; cfg: ModeCfg } | null = null;

function segment<T extends string>(id: string, value: T, options: Array<[T, string, string?]>, on: (v: T) => void, cls = 'seg'): HTMLElement {
  return h('div', { class: cls, id }, options.map(([v, label, title]) => h('button', { class: `segbtn ${value === v ? 'on' : ''}`, id: `${id}-${v}`, title: title ?? '', onclick: () => on(v) }, label)));
}

function sidePanel(app: App, mode: SetupMode, cfg: ModeCfg, key: 'p1' | 'p2', res: ResolvedSide): HTMLElement {
  const s = cfg[key];
  const S = SIDE[key];
  const set = (patch: Partial<SideCfg>) => {
    Object.assign(s, patch);
    remember(app);
  };
  const box = h('div', { class: `card setupside ${key}`, id: `setup-${key}` });
  box.appendChild(h('div', { class: 'row-between' }, h('h3', null, S.label), h('span', { class: 'small muted' }, S.end)));
  // 1. Human or Computer
  box.appendChild(h('div', { class: 'setuprow' }, h('span', { class: 'flabel' }, 'Coach'), segment(`${key}-controller`, s.controller, [['human', 'Human'], ['computer', 'Computer']], (v) => set({ controller: v }))));
  // 2. The AI file (one choice per valid file found; details expandable)
  if (s.controller === 'computer') {
    const open = !!aiOpen[key];
    const all = listCoaches();
    const usable = usableCoaches(cfg.format);
    const ai = res.ai;
    box.appendChild(
      h(
        'div',
        { class: 'setuprow ailine' },
        h('span', { class: 'flabel' }, 'AI file'),
        usable.length
          ? h(
              'select',
              { id: `${key}-ai`, 'aria-label': `${S.label}: AI file`, onchange: (e: Event) => set({ ai: (e.target as HTMLSelectElement).value }) },
              usable.map((c) => h('option', { value: c.id, selected: ai?.id === c.id }, `${c.name} ${c.version}`)),
            )
          : h('span', { class: 'small warn', id: `${key}-ai-none` }, 'No AI file is installed.'),
        h('button', { class: 'btn small ghost', id: `${key}-ai-online`, title: 'Set up DeepSeek (API key) or ChatGPT Luna (subscription sign-in) and install them as coaches', onclick: () => openOnlineCoaches(app) }, 'Online coaches…'),
        h('button', { class: 'btn small ghost', id: `${key}-ai-toggle`, 'aria-expanded': open ? 'true' : 'false', title: 'About this AI file, the AI folder and invalid files', onclick: () => { aiOpen[key] = !open; app.emit(); } }, open ? 'Less ▾' : 'More ▸'),
      ),
    );
    if (!usable.length || open) {
      box.appendChild(
        h(
          'div',
          { class: 'aidetails', id: `${key}-ai-details` },
          ai
            ? h(
                'p',
                { class: 'small' },
                h('b', null, `${ai.name} ${ai.version}`),
                h('span', { class: 'muted' }, ` · id ${ai.id} · ${ai.kind === 'strategy' ? 'strategy module (its own decision logic, run in an isolated worker)' : `parameter file of the built-in ${ai.implementation === 'bloodboard' ? 'Bloodboard' : ai.implementation} algorithm`}${ai.source ? ` · ${ai.source}` : ''}`),
                h('br'),
                ai.description,
              )
            : h('p', { class: 'small' }, 'The computer coaches are AI files: parameter files (*.json) and strategy modules (*.js) in the AI folder. The three bundled files come with the app; restore them if they were removed.'),
          all.some((c) => c.errors?.length) ? h('ul', { class: 'small warn' }, all.filter((c) => c.errors?.length).map((c) => h('li', null, `${c.source ?? c.name}: ${c.errors![0]}`))) : null,
          all.some((c) => !c.errors?.length && !usable.includes(c)) ? h('p', { class: 'small muted' }, `Not for ${cfg.format === 'sevens' ? 'Sevens' : '11-a-side'}: ${all.filter((c) => !c.errors?.length && !usable.includes(c)).map((c) => c.name).join(', ')}.`) : null,
          h(
            'label',
            { class: 'setuprow', id: `${key}-engine-row` },
            h('span', { class: 'flabel' }, 'Analysis workers'),
            h('select', { id: `${key}-engine-workers`, title: 'Background workers that do the engine calculations (off the interface thread, in parallel). Auto uses half the cores less one, at most 4.', onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; setWorkersSetting(v === 'auto' || v === 'off' ? v : Number(v)); app.emit(); } }, WORKER_CHOICES.map((o) => h('option', { value: String(o.value), selected: workersSetting() === o.value }, o.value === 'auto' ? `Auto (${autoWorkers()})` : o.label))),
            h('span', { class: 'small muted' }, poolProblem() ? `Workers could not start (${poolProblem()}): the interface thread is used.` : effectiveWorkers() ? `${effectiveWorkers()} in use` : 'Off'),
          ),
          h(
            'div',
            { class: 'btnrow tight' },
            h('button', { class: 'btn small ghost', id: `${key}-ai-reload`, title: aiLoadState.folder, onclick: () => void loadAIFolder(app).then(() => app.toast(`AI list reloaded: ${usableCoaches().length} usable (${aiLoadState.files} file${aiLoadState.files === 1 ? '' : 's'}${aiLoadState.errors ? `, ${aiLoadState.errors} invalid` : ''}).`)) }, 'Reload AI list'),
            h('button', { class: 'btn small ghost', id: `${key}-ai-import`, onclick: () => void importAIFile(app) }, aiStoreKind() === 'native' ? 'Show AI folder' : 'Import AI file…'),
            BUNDLED_FILES.some((f) => !coachById(f.id)) ? h('button', { class: 'btn small', id: `${key}-ai-restore`, title: 'Put the bundled AI files that are missing back into the AI folder (nothing is overwritten)', onclick: () => void restoreBundledAI(app) }, 'Restore bundled AI files') : null,
          ),
        ),
      );
    }
  }
  // 3. The team
  if (mode === 'allstar') box.appendChild(allStarPicker(app, cfg, key));
  else {
    const list = teamsOfKind(kindOf(mode), cfg.format);
    const aiOk = s.controller === 'computer' && (mode === 'tournament' || mode === 'exhibition');
    // V6: roster first (format is chosen above), then the specific team: ready-made, AI Build for this match, or a saved team of that roster.
    if (mode !== 'league') {
      box.appendChild(
        h(
          'div',
          { class: 'setuprow' },
          h('span', { class: 'flabel' }, 'Race / roster'),
          h(
            'select',
            { id: `${key}-roster`, onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; if (v) set({ roster: v, tier: null, aiRoster: false, ...(s.source === 'saved' ? { rosterFilter: v, teamId: '' } : {}) }); else remember(app); } },
            s.source === 'saved' ? h('option', { value: '', selected: !s.rosterFilter }, 'Any roster') : null,
            usesAiBuild(mode, s) && s.aiRoster ? h('option', { value: '', selected: true }, '— the AI chooses when the match starts —') : null,
            rostersByName().map((r) => h('option', { value: r.id, selected: r.id === (s.source === 'saved' ? s.rosterFilter : usesAiBuild(mode, s) && s.aiRoster ? '' : s.roster) }, r.name)),
          ),
        ),
      );
      const sources: Array<[string, string, string]> = [['ready', 'Ready-made', 'A team built for this match from the roster (legal for the format and budget)'], ...(aiOk ? [['ai', 'AI Build for this match', 'The AI file builds the team (and can choose the roster) when the match starts; the built-in builder is the legal fallback'] as [string, string, string]] : []), ['saved', `Saved team (${list.length})`, 'One of your saved teams of this mode and format']];
      box.appendChild(h('div', { class: 'setuprow' }, h('span', { class: 'flabel' }, 'Team'), segment(`${key}-source`, s.source === 'ai' && !aiOk ? 'ready' : s.source, sources, (v) => set({ source: v as SideCfg['source'], ...(v === 'saved' ? { rosterFilter: s.rosterFilter ?? '' } : {}) }))));
      if (usesAiBuild(mode, s))
        box.appendChild(h('div', { class: 'setuprow' }, h('span', { class: 'flabel' }, 'Roster'), segment(`${key}-airoster`, s.aiRoster ? 'ai' : 'mine', [['mine', 'My choice', 'Build a team of the roster chosen above'], ['ai', 'AI chooses', 'The AI file picks a draftable roster (the built-in picks by value if it has no chooser)']], (v) => set({ aiRoster: v === 'ai' }))));
    }
    if (s.source === 'saved' || mode === 'league') {
      const shown = list.filter((x) => !s.rosterFilter || x.rosterId === s.rosterFilter || mode === 'league');
      box.appendChild(
        h(
          'div',
          { class: 'setuprow' },
          h('span', { class: 'flabel' }, mode === 'league' ? 'League team' : 'Saved team'),
          shown.length
            ? h('select', { id: `${key}-team`, onchange: (e: Event) => set({ teamId: (e.target as HTMLSelectElement).value }) }, h('option', { value: '', selected: !s.teamId || !shown.some((t) => t.id === s.teamId) }, '— choose —'), shown.map((t) => h('option', { value: t.id, selected: t.id === s.teamId }, `${t.name} (${E.ROSTER_BY_ID[t.rosterId ?? '']?.name ?? 'custom'}${t.tier ? `, Tier ${t.tier}` : ''})`)))
            : h('span', { class: 'small muted' }, `No saved ${MODE_LABEL[mode]} ${mode === 'league' ? '' : cfg.format === 'sevens' ? 'Sevens ' : '11-a-side '}team${s.rosterFilter ? ' of this roster' : ''} yet.`),
        ),
      );
    } else {
      if (mode === 'tournament') {
        const t = tierFor(cfg.format, s.roster, s.tier);
        const info = E.tierInfo(s.roster, cfg.format);
        box.appendChild(
          h(
            'div',
            { class: 'setuprow' },
            h('span', { class: 'flabel' }, 'Tier'),
            h(
              'select',
              { id: `${key}-tier`, title: info.ref, onchange: (e: Event) => { const v = Number((e.target as HTMLSelectElement).value); set({ tier: v && v !== info.tier ? (v as Tier) : null }); } },
              E.TIERS.map((x) => h('option', { value: String(x), selected: t.tier === x }, `${x} — ${E.MATCHED[cfg.format].skillPoints[x]} Skill Points${info.tier === x ? info.kind === 'official' ? ' (official)' : info.kind === 'source' ? ' (Spike! 22)' : ' (May 2026 list)' : ' (event)'}`)),
            ),
            h('span', { class: `small ${t.event ? 'warn' : 'muted'}`, id: `${key}-tier-label` }, t.label),
          ),
        );
      }
    }
  }
  // Summary of the team it will play with.
  const t = res.team;
  if (t && mode !== 'allstar') {
    const sp = E.isTournamentTeam(t) ? E.teamSkillPoints(t) : null;
    const cost = E.teamCost(t);
    const stars = t.players.filter((p) => p.star).map((p) => p.name);
    box.appendChild(
      h(
        'div',
        { class: 'small teamline', id: `${key}-summary` },
        h('b', null, t.name),
        ` — ${t.players.length} players, ${t.rerolls} Team Re-roll${t.rerolls === 1 ? '' : 's'}${t.apothecary ? ', Apothecary' : ''}`,
        mode === 'league' ? ` · CTV ${E.currentTeamValue(t).toLocaleString('en-GB')} gp · Treasury ${(t.treasury ?? 0).toLocaleString('en-GB')} gp` : ` · ${cost.total.toLocaleString('en-GB')} of ${E.teamBudget(t).toLocaleString('en-GB')} gp`,
        sp ? ` · Skill Points ${sp.spent}/${sp.allowance}${t.players.some((p) => p.boughtSkill) ? ` (${t.players.filter((p) => p.boughtSkill).map((p) => `#${p.number} ${E.SKILL_BY_ID[p.boughtSkill!]?.name ?? p.boughtSkill}`).join(', ')})` : ''}` : '',
        stars.length ? ` · Star Players: ${stars.join(', ')}` : '',
      ),
    );
    if (s.source === 'ready' && mode !== 'league')
      box.appendChild(
        h(
          'div',
          { class: 'btnrow tight' },
          h('button', { class: 'btn small ghost', id: `${key}-edit-copy`, title: 'Save this ready-made team as your own team and open it in the team builder (skills, Star Players, players)', onclick: () => editCopy(app, mode, cfg, key, t) }, 'Save as a team and edit…'),
        ),
      );
    else if (s.source === 'saved' || mode === 'league') box.appendChild(h('div', { class: 'btnrow tight' }, h('button', { class: 'btn small ghost', onclick: () => app.set({ screen: 'teams', teamKind: kindOf(mode), teamFormat: cfg.format, teamEdit: JSON.parse(JSON.stringify(t)), teamDirty: false, teamSel: null }) }, 'Open in the team builder')));
  }
  if (res.notes.length) box.appendChild(h('ul', { class: 'small warn setupnotes', id: `${key}-notes` }, res.notes.map((n) => h('li', null, n))));
  if (res.errors.length) box.appendChild(h('ul', { class: 'small bad setuperrors', id: `${key}-errors` }, res.errors.map((n) => h('li', null, n))));
  return box;
}

function editCopy(app: App, mode: SetupMode, cfg: ModeCfg, key: 'p1' | 'p2', t: TeamDef) {
  const copy: TeamDef = JSON.parse(JSON.stringify(t));
  copy.id = `${kindOf(mode)}-${Date.now().toString(36)}-${key}`;
  copy.name = t.name.replace(/ \(P2\)$/, '').replace(/\*$/, '');
  cfg[key].source = 'saved';
  cfg[key].teamId = copy.id;
  saveSetupStore();
  void saveTeam(app, copy, false).then(() => app.set({ screen: 'teams', teamKind: kindOf(mode), teamFormat: cfg.format, teamEdit: JSON.parse(JSON.stringify(copy)), teamDirty: false, teamSel: null }));
}

/** All-Star squads: pick Star Players (each once per squad; pairs together). */
let starFilter = '';
function allStarPicker(app: App, cfg: ModeCfg, key: 'p1' | 'p2'): HTMLElement {
  const s = cfg[key];
  const squad = allStarTeam(cfg, key, s).team;
  const cost = E.starsCost(squad.players);
  const wrap = h('div', { class: 'allstar', id: `${key}-stars` });
  wrap.appendChild(h('div', { class: 'small', id: `${key}-squad` }, h('b', null, `${squad.players.length} Star Player${squad.players.length === 1 ? '' : 's'}`), ` (limit ${cfg.allStar.maxStars}) · hiring fees ${cost.toLocaleString('en-GB')} gp${cfg.allStar.budget === null ? ' (unrestricted budget)' : ` of ${cfg.allStar.budget.toLocaleString('en-GB')}`}`));
  wrap.appendChild(
    h(
      'div',
      { class: 'chips' },
      squad.players.map((p) =>
        h(
          'button',
          {
            class: 'chip btnchip',
            'data-star-remove': p.star,
            title: `Remove ${p.name}${E.STAR_BY_ID[p.star!]?.pair ? ' (and the partner)' : ''}`,
            onclick: () => {
              const pair = E.STAR_BY_ID[p.star!]?.pair;
              s.stars = s.stars.filter((x) => x !== p.star && x !== pair);
              remember(app);
            },
          },
          `${p.name} ✕`,
        ),
      ),
    ),
  );
  const pick = h(
    'select',
    {
      id: `${key}-star-add`,
      onchange: (e: Event) => {
        const id = (e.target as HTMLSelectElement).value;
        if (!id) return;
        const st = E.STAR_BY_ID[id];
        s.stars = [...s.stars.filter((x) => x !== id), id, ...(st?.pair && !s.stars.includes(st.pair) ? [st.pair] : [])];
        remember(app);
      },
    },
    h('option', { value: '' }, '+ add a Star Player…'),
    E.STARS.filter((st) => !starFilter || st.name.toLowerCase().includes(starFilter))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((st) => {
        const why = squad.players.some((p) => p.star === st.id) ? 'in the squad' : E.starAddReason(squad, st.id);
        return h('option', { value: st.id, disabled: !!why }, `${st.name} — ${(st.cost / 1000).toFixed(0)}k${st.pair ? ` (pair with ${E.STAR_BY_ID[st.pair]?.name})` : ''}${E.isMegaStar(st.id) ? ' · Mega-star' : ''}${why ? ` — ${why}` : ''}`);
      }),
  );
  wrap.appendChild(h('div', { class: 'btnrow tight' }, pick, h('button', { class: 'btn small ghost', id: `${key}-stars-random`, onclick: () => { s.stars = randomSquad(cfg, key); remember(app); } }, 'Random squad'), h('button', { class: 'btn small ghost', onclick: () => { s.stars = []; remember(app); } }, 'Clear')));
  return wrap;
}

function randomSquad(cfg: ModeCfg, key: 'p1' | 'p2'): string[] {
  const n = Math.min(cfg.allStar.maxStars, cfg.format === 'sevens' ? 7 : 11);
  const pool = E.STARS.filter((s) => E.starSupported(s.id) && !s.pair).map((s) => s.id);
  const out: string[] = [];
  let seed = Date.now() + (key === 'p2' ? 7919 : 0);
  while (out.length < n && pool.length) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const id = pool.splice(seed % pool.length, 1)[0];
    const t = E.newAllStarSquad('x', 'x', cfg.format === 'sevens' ? 'sevens' : 'standard', { budget: cfg.allStar.budget, maxStars: cfg.allStar.maxStars });
    for (const x of out) E.addStar(t, x, () => `r${Math.random()}`);
    if (!E.starAddReason(t, id)) out.push(id);
  }
  return out;
}

function budgetControl(app: App, mode: SetupMode, cfg: ModeCfg): HTMLElement | null {
  if (mode === 'league' || mode === 'allstar') return null;
  const sevens = cfg.format === 'sevens';
  const presets = sevens ? [600_000] : mode === 'tournament' ? [...E.MATCHED.standard.budgets] : [...E.DRAFT_BUDGETS];
  const value = cfg.budgetCustom ? 'custom' : String(presets.includes(cfg.budget) ? cfg.budget : presets[0]);
  return h(
    'label',
    { class: 'field' },
    h('span', { class: 'flabel' }, 'Team Draft Budget (ready-made teams)'),
    h(
      'span',
      { class: 'btnrow tight' },
      h(
        'select',
        {
          id: 'setup-budget',
          onchange: (e: Event) => {
            const v = (e.target as HTMLSelectElement).value;
            if (v === 'custom') {
              cfg.budgetCustom = true;
              if (presets.includes(cfg.budget)) cfg.budget = presets[0] + 100_000;
            } else {
              cfg.budgetCustom = false;
              cfg.budget = Number(v);
            }
            remember(app);
          },
        },
        presets.map((b) => h('option', { value: String(b), selected: value === String(b) }, `${b.toLocaleString('en-GB')} gp${sevens ? ' (standard Sevens, Spike! 22 p.8)' : mode === 'tournament' ? ' (Matched Play, p.110)' : b === 1_000_000 ? ' (League draft, p.89)' : ' (Exhibition Play, p.110)'}`)),
        h('option', { value: 'custom', selected: value === 'custom' }, 'Custom rules (event / house budget)…'),
      ),
      cfg.budgetCustom
        ? h('input', { type: 'number', class: 'num wide', id: 'setup-budget-custom', min: '100000', max: '3000000', step: '5000', value: String(cfg.budget), onchange: (e: Event) => { const v = Math.round(Number((e.target as HTMLInputElement).value) / 5000) * 5000; cfg.budget = Math.max(100_000, Math.min(3_000_000, v || presets[0])); remember(app); } })
        : null,
    ),
    h('span', { class: 'hint' }, cfg.budgetCustom ? 'Custom rules: the match and both teams are labelled as using a custom budget.' : sevens ? 'Sevens: 600,000 gp. Other amounts are custom rules.' : 'Saved teams keep their own budget (team builder).'),
  );
}

function difficultyControl(app: App, cfg: ModeCfg, mode: SetupMode): HTMLElement {
  const one = (cfg.p1.controller === 'computer') !== (cfg.p2.controller === 'computer');
  const lv = (k: 'human' | 'computer', label: string) =>
    h(
      'span',
      { class: 'btnrow tight' },
      h('span', { class: 'small' }, label),
      segment(`setup-diff-${k}`, String(cfg.difficulty[k]) as '0' | '1' | '2' | '3', [['0', 'Off'], ['1', 'Slight'], ['2', 'Moderate'], ['3', 'Strong']], (v) => { cfg.difficulty[k] = Number(v); remember(app); }, 'seg small'),
    );
  return h(
    'div',
    { class: 'field', id: 'setup-difficulty' },
    h('span', { class: 'flabel' }, 'Difficulty (optional house rule — not Blood Bowl rules)'),
    mode === 'tournament'
      ? h('span', { class: 'small muted' }, 'Tournament matches always use standard dice.')
      : !one
        ? h('span', { class: 'small muted' }, 'Only for a human against the computer (both sides human or both computer: standard dice).')
        : h(
            'span',
            null,
            lv('human', 'Human side: '),
            lv('computer', ' Computer side: '),
            h('span', { class: 'hint' }, 'Weighs every consequential roll — Block dice included — by who its result helps: the human side’s good results a little less likely, the computer side’s a little more. Every result stays possible; Off = standard dice; the previews use the same odds; the match card records it.'),
            cfg.difficulty.human || cfg.difficulty.computer ? h('details', { class: 'why small', id: 'difficulty-details' }, h('summary', null, 'What it changes (worked examples)'), difficultyTable(cfg.difficulty.human, cfg.difficulty.computer), h('p', { class: 'muted' }, DIFFICULTY_TEXT)) : null,
          ),
  );
}

/** The advisory coach: the AI file that gives AI Focus advice and takes over when asked (changeable in the match). */
function advisorField(app: App, cfg: ModeCfg): HTMLElement {
  const usable = usableCoaches(cfg.format).filter((c) => c.id === 'bloodboard-balanced' || c.id === 'hopeful-1-5-9-gpt');
  const chosen = coachById(cfg.advisor);
  const cur = chosen && usable.includes(chosen) ? chosen : fallbackCoach(cfg.format);
  return h(
    'label',
    { class: 'field' },
    h('span', { class: 'flabel' }, 'Advisory coach (AI Focus, takeovers)'),
    usable.length
      ? h('select', { id: 'setup-advisor', onchange: (e: Event) => { cfg.advisor = (e.target as HTMLSelectElement).value; remember(app); } }, usable.map((c) => h('option', { value: c.id, selected: cur?.id === c.id }, `${c.name} ${c.version}`)))
      : h('span', { class: 'small warn' }, 'No AI file is installed.'),
    h('span', { class: 'hint' }, 'Any installed AI file, whoever coaches the teams. Its advice is read-only; during the match you can change it, and let it take over for one activation, the rest of a Turn or until you take control back.'),
  );
}

/** V5.5: the Quick Match preset being configured on this screen (Home ▸ Configure Quick Match), if any. */
export function quickEditing(app: App): QuickPreset | undefined {
  return app.st.quickEdit ? quickPresets().find((p) => p.id === app.st.quickEdit) : undefined;
}

/** Open the set-up screen on a Quick Match preset (its mode and choices), to configure it. */
export function configureQuick(app: App, id: string = activeQuick().id): void {
  const p = quickPresets().find((x) => x.id === id);
  if (!p) return;
  quickSnapshot = { id: p.id, mode: p.mode, cfg: JSON.parse(JSON.stringify(p.cfg)) as ModeCfg, name: p.name };
  setupErrors = [];
  app.set({ screen: 'newMatch', quickEdit: p.id, setupMode: p.mode, teamKind: kindOf(p.mode), teamFormat: p.cfg.format });
}

let quickSnapshot: { id: string; mode: SetupMode; cfg: ModeCfg; name: string } | null = null;

/**
 * Start a Quick Match preset with one click. Nothing is replaced silently: if a saved team or an AI file the preset
 * names is gone (a fallback would be needed), or the match cannot start, the preset opens for configuration instead,
 * with the reason.
 */
export function startQuick(app: App, id: string = activeQuick().id): boolean {
  ensureTeamsLoaded(app);
  const p = quickPresets().find((x) => x.id === id);
  if (!p) return false;
  const r1 = resolveSide(p.mode, p.cfg, 'p1');
  const r2 = resolveSide(p.mode, p.cfg, 'p2');
  const notes: string[] = [];
  for (const [r, lbl] of [[r1, 'Player 1'], [r2, 'Player 2']] as const)
    for (const n of r.notes) {
      if (/no longer there/.test(n)) notes.push(`${lbl}: the saved team chosen for this preset is no longer there (or is not a team of this mode and format) — choose another team.`);
      else if (/not installed|cannot be used/.test(n)) notes.push(`${lbl}: ${n.replace(/ — .*$/, '.')} Choose another AI file.`);
    }
  for (const [k, lbl] of [['p1', 'Player 1'], ['p2', 'Player 2']] as const) if (p.mode !== 'allstar' && (p.cfg[k].source === 'saved' || p.mode === 'league') && !p.cfg[k].teamId) notes.push(`${lbl}: choose the saved team to play with.`);
  const fail = (errs: string[]) => {
    configureQuick(app, p.id);
    setupErrors = [`Quick Match “${p.name}” did not start, so nothing was replaced — please check:`, ...errs];
    app.emit();
  };
  if (notes.length) { fail(notes); return false; }
  if ((['p1', 'p2'] as const).some((k) => usesAiBuild(p.mode, p.cfg[k]))) {
    void startFromSetupAsync(app, p.mode, p.cfg).then((errs) => { if (errs.length) fail(errs); });
    return true;
  }
  const errs = startFromSetup(app, p.mode, p.cfg);
  if (errs.length) { fail(errs); return false; }
  return true;
}

export function renderMatchSetup(app: App): HTMLElement {
  ensureTeamsLoaded(app);
  const qp = quickEditing(app);
  const mode: SetupMode = qp ? qp.mode : app.st.setupMode ?? (app.st.teamKind as SetupMode);
  const cfg = qp ? qp.cfg : modeCfg(mode);
  if (mode === 'league') cfg.format = 'standard';
  const r1 = resolveSide(mode, cfg, 'p1');
  const r2 = resolveSide(mode, cfg, 'p2');
  const errs = [...r1.errors, ...r2.errors];
  const shared = h('div', { class: 'card setupshared', id: 'setup-shared' });
  shared.appendChild(h('h3', null, 'Match settings'));
  const grid = h('div', { class: 'grid2' });
  grid.appendChild(
    h(
      'label',
      { class: 'field' },
      h('span', { class: 'flabel' }, 'Rules'),
      h(
        'select',
        { id: 'setup-rules', onchange: (e: Event) => { cfg.rules = (e.target as HTMLSelectElement).value as 'full' | 'introductory'; remember(app); } },
        h('option', { value: 'full', selected: cfg.rules === 'full' }, 'Full: Fan Factor, Weather and Kick-off Events'),
        h('option', { value: 'introductory', selected: cfg.rules === 'introductory' }, 'Introductory (p.44): no Fan Factor, Weather or Kick-off Events'),
      ),
    ),
  );
  const bc = budgetControl(app, mode, cfg);
  if (bc) grid.appendChild(bc);
  if (mode === 'tournament')
    grid.appendChild(
      h(
        'label',
        { class: 'field' },
        h('span', { class: 'flabel' }, 'Skill Points (ready-made teams)'),
        h('span', null, h('input', { type: 'checkbox', id: 'setup-autoskills', checked: cfg.autoSkills, onchange: (e: Event) => { cfg.autoSkills = (e.target as HTMLInputElement).checked; remember(app); } }), ' Spend them on sensible skills'),
        h('span', { class: 'hint' }, `By Tier: ${E.TIERS.map((t) => E.MATCHED[cfg.format].skillPoints[t]).join(' / ')} (${cfg.format === 'sevens' ? 'Spike! 22 p.19' : 'p.112'}). “Save as a team and edit…” to change them.`),
      ),
    );
  if (mode === 'allstar') {
    grid.appendChild(
      h(
        'label',
        { class: 'field' },
        h('span', { class: 'flabel' }, 'Squad budget'),
        h(
          'span',
          { class: 'btnrow tight' },
          h('select', { id: 'setup-allstar-budget', onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; cfg.allStar.budget = v === 'none' ? null : Number(v); remember(app); } }, [['none', 'Unrestricted'], ['1000000', '1,000,000 gp'], ['1500000', '1,500,000 gp'], ['2000000', '2,000,000 gp'], ['3000000', '3,000,000 gp']].map(([v, l]) => h('option', { value: v, selected: (cfg.allStar.budget === null ? 'none' : String(cfg.allStar.budget)) === v }, l))),
        ),
      ),
    );
    grid.appendChild(h('label', { class: 'field' }, h('span', { class: 'flabel' }, 'Squad size limit'), h('input', { type: 'number', class: 'num', id: 'setup-allstar-max', min: '3', max: cfg.format === 'sevens' ? '11' : '16', value: String(cfg.allStar.maxStars), onchange: (e: Event) => { cfg.allStar.maxStars = Math.max(3, Math.min(cfg.format === 'sevens' ? 11 : 16, Math.round(Number((e.target as HTMLInputElement).value) || 11))); remember(app); } })));
  }
  if (cfg.format === 'sevens')
    grid.appendChild(
      h(
        'label',
        { class: 'field', id: 'setup-otb' },
        h('span', { class: 'flabel' }, 'Sevens: On the Ball at the kick-off'),
        h(
          'select',
          { id: 'setup-otb-rule', onchange: (e: Event) => { cfg.otbNaf = (e.target as HTMLSelectElement).value === 'naf'; remember(app); } },
          h('option', { value: 'gw', selected: !cfg.otbNaf }, "May move into No Man's Land (GW ruling — default)"),
          h('option', { value: 'naf', selected: !!cfg.otbNaf }, "Not into No Man's Land (NAF recommendation — optional)"),
        ),
        h('span', { class: 'hint' }, "GW's Designer's Commentary (May 2025, Death Zone Sevens) answers “Yes” to On the Ball moving into the area between both Lines of Scrimmage. The NAF's recommendations for BB2025 Sevens (Sept 2026) say it may not — optional, for events that declare them."),
      ),
    );
  grid.appendChild(difficultyControl(app, cfg, mode));
  grid.appendChild(advisorField(app, cfg));
  grid.appendChild(
    h(
      'label',
      { class: 'field' },
      h('span', { class: 'flabel' }, 'Dice seed'),
      h(
        'span',
        { class: 'btnrow tight' },
        h('select', { id: 'setup-seedmode', onchange: (e: Event) => { cfg.seed = (e.target as HTMLSelectElement).value === 'fixed' ? cfg.seed ?? Math.floor(Math.random() * 2 ** 31) : null; remember(app); } }, h('option', { value: 'random', selected: cfg.seed === null }, 'A new seed each match'), h('option', { value: 'fixed', selected: cfg.seed !== null }, 'Fixed seed')),
        cfg.seed !== null ? h('input', { type: 'number', class: 'num wide', id: 'setup-seed', value: String(cfg.seed), onchange: (e: Event) => { cfg.seed = Math.max(0, Math.round(Number((e.target as HTMLInputElement).value) || 0)) >>> 0; remember(app); } }) : null,
      ),
      h('span', { class: 'hint' }, 'The same seed and the same choices give the same dice.'),
    ),
  );
  shared.appendChild(grid);
  if (mode === 'league' && r1.team && r2.team) shared.appendChild(leaguePanel(app, cfg, r1.team, r2.team));
  if (mode === 'allstar') shared.appendChild(h('p', { class: 'small warn', id: 'allstar-note' }, 'All-Star Match — a custom Exhibition variant, not rulebook play: squads of Star Players only, no ordinary players needed, no two-Star cap; each Star Player once per squad (a pair joins together); the same Star Player may play for both squads — as two independent players, each with their own special-rule uses. Standard matches keep their normal limits.'));
  const tabs = h(
    'div',
    { class: 'modeswitch' },
    segment<SetupMode>('setup-mode', mode, SETUP_MODES.map((m) => [m, MODE_LABEL[m]]), (m) => {
      if (qp) {
        // A Quick Match preset of another mode starts from that mode's remembered set-up.
        qp.mode = m;
        qp.cfg = JSON.parse(JSON.stringify(modeCfg(m))) as ModeCfg;
        saveSetupStore();
        app.set({ setupMode: m });
      } else openSetup(app, m);
    }),
    mode === 'league'
      ? h('p', { class: 'small muted' }, 'League matches are 11-a-side (Sevens League play, Spike! 22 pp.14-17, is not in the app).')
      : segment<TeamFormat>('setup-format', cfg.format, [['standard', '11-a-side'], ['sevens', 'Sevens']], (f) => {
          cfg.format = f;
          if (mode !== 'allstar' && !cfg.budgetCustom) cfg.budget = f === 'sevens' ? 600_000 : mode === 'tournament' ? 1_100_000 : 1_000_000;
          if (mode === 'allstar') cfg.allStar.maxStars = Math.min(cfg.allStar.maxStars, f === 'sevens' ? 11 : 16);
          remember(app);
        }, 'seg small'),
  );
  const presets = h(
    'div',
    { class: 'btnrow tight setuppresets' },
    h('span', { class: 'small muted' }, 'Quick choice:'),
    h('button', { class: 'btn small ghost', id: 'nm-computer', onclick: () => { cfg.p1.controller = 'human'; cfg.p2.controller = 'computer'; remember(app); } }, 'Human v Computer'),
    h('button', { class: 'btn small ghost', id: 'nm-hotseat', onclick: () => { cfg.p1.controller = 'human'; cfg.p2.controller = 'human'; remember(app); } }, 'Human v Human (hot-seat)'),
    h('button', { class: 'btn small ghost', id: 'nm-cvc', onclick: () => { cfg.p1.controller = 'computer'; cfg.p2.controller = 'computer'; remember(app); } }, 'Computer v Computer (watch)'),
    h('button', { class: 'btn small ghost', id: 'setup-swap', title: 'Swap Player 1 and Player 2', onclick: () => { const x = cfg.p1; cfg.p1 = cfg.p2; cfg.p2 = x; remember(app); } }, '⇄ Swap sides'),
  );
  const start = () => {
    void startFromSetupAsync(app, mode, cfg).then((e) => {
      if (e.length) {
        setupErrors = e;
        app.emit();
      } else {
        setupErrors = [];
        app.st.quickEdit = undefined;
      }
    });
  };
  const home = () => {
    app.set({ screen: 'home', quickEdit: undefined });
  };
  const quickHead = qp
    ? h(
        'div',
        { class: 'quickedit', id: 'quick-edit' },
        h('p', { class: 'small' }, h('b', null, 'Configure Quick Match: '), 'what the Home screen’s ▶ Quick Match button starts, with one click. Every choice below is saved at once (also across restarts).'),
        h(
          'label',
          { class: 'field' },
          h('span', { class: 'flabel' }, 'Preset name'),
          h('input', { type: 'text', id: 'quick-name', value: qp.name, maxlength: '60', onchange: (e: Event) => { renameQuickPreset(qp.id, (e.target as HTMLInputElement).value); app.emit(); } }),
        ),
      )
    : null;
  const footer = qp
    ? h(
        'div',
        { class: 'btnrow' },
        h('button', { class: 'btn primary', id: 'quick-done', onclick: () => { setActiveQuick(qp.id); quickSnapshot = null; setupErrors = []; app.toast(`Quick Match saved: ▶ Quick Match now starts “${qp.name}”.`); home(); } }, 'Save Quick Match'),
        h('button', { class: 'btn', id: 'quick-save-start', disabled: errs.length > 0, title: errs[0] ?? 'Save, then start this match now', onclick: () => { setActiveQuick(qp.id); quickSnapshot = null; start(); } }, 'Save & start'),
        quickSnapshot?.id === qp.id
          ? h('button', { class: 'btn ghost', id: 'quick-revert', title: 'Put the preset back as it was when you opened it', onclick: () => { qp.mode = quickSnapshot!.mode; qp.cfg = JSON.parse(JSON.stringify(quickSnapshot!.cfg)) as ModeCfg; qp.name = quickSnapshot!.name; saveSetupStore(); app.set({ setupMode: qp.mode }); app.toast('The Quick Match preset is back as it was.'); } }, '↶ Revert changes')
          : null,
        h('button', { class: 'btn', id: 'setup-teams', onclick: () => app.set({ screen: 'teams', teamKind: kindOf(mode), teamFormat: cfg.format, teamEdit: null }) }, 'Manage teams'),
      )
    : h(
        'div',
        { class: 'btnrow' },
        h('button', { class: 'btn primary', id: 'start-match', disabled: errs.length > 0, title: errs[0] ?? 'Start the match', onclick: start }, cfg.p1.controller === 'computer' && cfg.p2.controller === 'computer' ? 'Start — watch the computer play itself' : 'Start match'),
        h('button', { class: 'btn', id: 'setup-teams', onclick: () => app.set({ screen: 'teams', teamKind: kindOf(mode), teamFormat: cfg.format, teamEdit: null }) }, 'Manage teams'),
        h(
          'button',
          { class: 'btn ghost', id: 'setup-save-quick', title: 'Save this set-up as a Quick Match preset: the Home screen’s ▶ Quick Match button will start it with one click', onclick: () => { const p = saveQuickPreset(mode, cfg, { name: presetName(mode, cfg) }); app.toast(`Saved as the Quick Match preset “${p.name}” — ▶ Quick Match on the Home screen starts it.`); app.emit(); } },
          '☆ Save as Quick Match',
        ),
        lastReset?.mode === mode
          ? h('button', { class: 'btn ghost', id: 'setup-reset-undo', title: 'Put back the choices from before the reset', onclick: () => { setupStore().modes[mode] = lastReset!.cfg; lastReset = null; saveSetupStore(); app.toast(`The ${MODE_LABEL[mode]} set-up is back as it was.`); app.emit(); } }, '↶ Undo reset')
          : h('button', { class: 'btn ghost', id: 'setup-reset', title: `Go back to the defaults for ${MODE_LABEL[mode]} (both players, teams, AI files, settings — saved teams and matches are not touched; “Undo reset” puts them back)`, onclick: () => { lastReset = { mode, cfg: JSON.parse(JSON.stringify(modeCfg(mode))) as ModeCfg }; resetMode(mode); setupErrors = []; app.toast(`The ${MODE_LABEL[mode]} set-up is back to the defaults — “↶ Undo reset” puts your choices back.`); app.emit(); } }, 'Reset to defaults'),
      );
  return h(
    'div',
    { class: `newmatch matchsetup card ${qp ? 'quickmode' : ''}`, id: 'match-setup' },
    h('div', { class: 'row-between' }, h('h2', null, qp ? `Quick Match — ${qp.name}` : `${MODE_LABEL[mode]} — match set-up`), h('button', { class: 'btn ghost small', id: 'setup-home', onclick: home }, '← Home')),
    quickHead,
    tabs,
    presets,
    h('div', { class: 'setupsides' }, sidePanel(app, mode, cfg, 'p1', r1), sidePanel(app, mode, cfg, 'p2', r2)),
    shared,
    setupErrors.length ? h('div', { class: 'errors', id: 'setup-start-errors' }, h('b', null, qp ? 'Please check:' : 'This match cannot start:'), h('ul', null, setupErrors.map((e) => h('li', null, e)))) : null,
    footer,
    h('p', { class: 'small muted' }, qp ? `Quick Match presets are kept with the set-up${aiStoreKind() === 'native' ? ' (Settings/setup.json — also after the app is restarted)' : ''}. Saved teams are used as saved, with their skills; a missing team or AI file stops the Quick Match and brings you here instead of being replaced.` : `These choices are remembered for the ${MODE_LABEL[mode]} mode${aiStoreKind() === 'native' ? ' (also after the app is restarted)' : ''}.`),
  );
}

/** A name for a new Quick Match preset from its set-up, e.g. "Sevens Tournament: Human v Computer". */
export function presetName(mode: SetupMode, cfg: ModeCfg): string {
  const c = (k: 'p1' | 'p2') => (cfg[k].controller === 'human' ? 'Human' : 'Computer');
  return `${mode !== 'league' && cfg.format === 'sevens' ? 'Sevens ' : ''}${MODE_LABEL[mode]}: ${c('p1')} v ${c('p2')}`;
}

let setupErrors: string[] = [];

/** League pre-match Inducements (p.94): CTV, Petty Cash, Treasury, Inducements and Star Players for this match only. */
function leaguePanel(app: App, cfg: ModeCfg, a: TeamDef, b: TeamDef): HTMLElement {
  if (leagueBuy.key !== `${a.id}|${b.id}`) resetLeagueBuy(a, b);
  const f = leagueFunds(a, b);
  const wrap = h('div', { class: 'leagueprematch', id: 'league-prematch' });
  wrap.appendChild(h('h4', null, 'Pre-match: Journeymen and Inducements (League Play, p.94)'));
  wrap.appendChild(
    h(
      'p',
      { class: 'small', id: 'league-ctv' },
      `Current Team Value: ${a.name} ${f.ctv.A.toLocaleString('en-GB')} gp, ${b.name} ${f.ctv.B.toLocaleString('en-GB')} gp. `,
      f.higher ? `${(f.higher === 'A' ? a : b).name} has the higher CTV: it may first spend Treasury gold; the other team then gets Petty Cash = the difference + what was spent, and may add up to 50,000 gp of its Treasury. Petty Cash not spent is lost.` : 'Equal CTVs: neither team may spend Treasury gold (p.94).',
    ),
  );
  for (const [t, def, side] of [['A', a, cfg.p1], ['B', b, cfg.p2]] as const) {
    const fund = f.funds[t];
    const buy = leagueBuy[t];
    const spent = E.purchaseCost(def, buy);
    const avail = fund.pettyCash + fund.treasuryMax;
    const box = h('div', { class: 'card small', id: `league-buy-${t}` });
    const jm = E.journeymenFor(def);
    box.appendChild(h('div', null, h('b', null, def.name), ` — Petty Cash ${fund.pettyCash.toLocaleString('en-GB')} gp, Treasury usable ${fund.treasuryMax.toLocaleString('en-GB')} gp (Treasury ${(def.treasury ?? 0).toLocaleString('en-GB')} gp). Spent ${spent.toLocaleString('en-GB')} gp.`, jm.length ? ` ${jm.length} Journeym${jm.length === 1 ? 'an' : 'en'} (${jm[0].position}, Loner (4+)) take${jm.length === 1 ? 's' : ''} part.` : ''));
    if (side.controller === 'computer') {
      box.appendChild(h('p', { class: 'muted' }, 'Computer-coached: it chooses its own Inducements when the match starts (the best Star Player it can afford, then useful Inducements), with its Petty Cash only.'));
      wrap.appendChild(box);
      continue;
    }
    if (avail <= 0) {
      box.appendChild(h('p', { class: 'muted' }, 'No gold to spend on Inducements for this match.'));
      wrap.appendChild(box);
      continue;
    }
    const left = avail - spent;
    const stars = E.leagueStarOptions(def, buy, left);
    box.appendChild(
      h(
        'div',
        { class: 'btnrow tight' },
        h('span', null, 'Star Players: '),
        buy.stars.map((id) => h('button', { class: 'chip btnchip', 'data-hired': id, onclick: () => { const pair = E.STAR_BY_ID[id]?.pair; buy.stars = buy.stars.filter((x) => x !== id && x !== pair); app.emit(); } }, `${E.STAR_BY_ID[id]?.name} ✕`)),
        h(
          'select',
          { id: `league-star-${t}`, onchange: (e: Event) => { const id = (e.target as HTMLSelectElement).value; if (!id) return; const st = E.STAR_BY_ID[id]; buy.stars = [...buy.stars, id, ...(st?.pair ? [st.pair] : [])]; app.emit(); } },
          h('option', { value: '' }, `+ hire for this match (${stars.filter((o) => !o.reason).length} possible)…`),
          stars.map((o) => h('option', { value: o.id, disabled: !!o.reason || !!o.pair && buy.stars.includes(o.id) }, `${o.name} — ${(o.cost / 1000).toFixed(0)}k${o.pair ? ` (pair with ${E.STAR_BY_ID[o.pair]?.name})` : ''}${o.reason ? ` — ${o.reason}` : ''}`)),
        ),
      ),
    );
    const inds = E.leagueInducementOptions(def, buy).filter((o) => !o.reason);
    box.appendChild(
      h(
        'div',
        { class: 'btnrow tight' },
        h('span', null, 'Inducements: '),
        inds.map((o) =>
          h(
            'span',
            { class: 'chip', 'data-league-ind': o.id },
            `${o.name} ${(o.cost / 1000).toFixed(0)}k ×${o.have}/${o.max} `,
            h('button', { class: 'btn tiny ghost', disabled: o.have <= 0, onclick: () => { buy.inducements[o.id] = o.have - 1; if (!buy.inducements[o.id]) delete buy.inducements[o.id]; app.emit(); } }, '−'),
            h('button', { class: 'btn tiny ghost', disabled: o.have >= o.max || o.cost > left, onclick: () => { buy.inducements[o.id] = o.have + 1; app.emit(); } }, '+'),
          ),
        ),
      ),
    );
    if (spent > avail) box.appendChild(h('p', { class: 'bad' }, `Over the money available by ${(spent - avail).toLocaleString('en-GB')} gp.`));
    wrap.appendChild(box);
  }
  wrap.appendChild(h('p', { class: 'small muted' }, 'Hired Star Players, Mercenaries and Journeymen play this match only — they are never added to the saved League team. When the match starts, only the Treasury gold actually spent (beyond the Petty Cash) is taken from the saved team.'));
  return wrap;
}

export { defaultMode, DEFAULT_ALLSTARS, setupStore };
