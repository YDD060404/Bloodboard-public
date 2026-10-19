/**
 * Saved teams for match play.
 *
 *  - League teams (kind 'league'): flexible team state — any roster or custom
 *    players, any skills, any number of Team Re-rolls, sideline staff and
 *    fans. No budget is enforced (progression and league administration are
 *    out of scope).
 *  - Tournament / Exhibition teams (kind 'tournament'): drafted from an
 *    official Team Roster with the fixed template of the Team Draft rules
 *    (printed pp.89-91): 1,000,000 gold pieces, 11-16 players within the
 *    roster's limits, up to 8 Team Re-rolls at the roster price, an Apothecary
 *    if the roster allows one (50,000), up to 6 Assistant Coaches and 6
 *    Cheerleaders (10,000 each), Dedicated Fans 1-3 (5,000 per step above 1).
 *
 * The internal kind is 'tournament'; the label shown to users is
 * MATCH_KIND_LABEL.tournament, so the wording can change in one place.
 *
 *  - Blood Bowl Sevens teams (variant 'sevens', always kind 'tournament'):
 *    drafted with the Sevens rules of Spike! Journal 22 (pp.8-9, 13):
 *    600,000 gp, 7-11 players, no more than 4 without the Lineman keyword,
 *    Team Re-rolls 100,000 gp each, Assistant Coaches and Cheerleaders
 *    20,000 gp (max 3 each), an Apothecary 80,000 gp, Dedicated Fans 1-5
 *    (20,000 gp per step above 1), and one Lineman chosen as the Veteran
 *    (MA −1, a once-per-game re-roll).
 */
import { skillCategory, type AdvancementRecord } from './advancement';
import { INDUCEMENT_BY_ID, inducementCost, inducementFor, MERCENARY, SEVENS_INDUCEMENT_PAGE, type InducementList } from './inducements';
import { LEAGUES_PAGE, ROSTER_BY_ID, findPosition, isRetiredPosition, rosterLeague, rosterSpecialRules, type Roster, type SkillCat } from './rosters';
import { SKILL_BY_ID } from './skills';
import { playsForText, STAR_BY_ID, STAR_LIST_PAGE, STAR_MAX, STAR_RULE, starChoiceKey, starChoices, starPlaysFor, starsCost, starSkills, starSupported } from './stars';
import { isMegaStar, isTournamentTeam, MATCHED, matchedIssues, MEGA_STAR_COST, skillPointUse, starChoiceSummary, type SkillPointUse, type Tier } from './matched';
import type { MatchKind, SkillRef, Variant } from './types';

export const MATCH_KIND_LABEL: Record<MatchKind, string> = {
  league: 'League',
  tournament: 'Tournament / Exhibition',
};

export const DRAFT_TEMPLATE = {
  budget: 1_000_000,
  minPlayers: 11,
  maxPlayers: 16,
  maxRerolls: 8,
  apothecaryCost: 50_000,
  assistantCost: 10_000,
  maxAssistants: 6,
  cheerleaderCost: 10_000,
  maxCheerleaders: 6,
  fanCost: 5_000,
  minFans: 1,
  maxFans: 3,
  pages: '89-91',
} as const;

/** Blood Bowl Sevens Team Draft (Spike! Journal 22 pp.8-9, Veteran p.13). */
export const SEVENS_DRAFT = {
  budget: 600_000,
  minPlayers: 7,
  maxPlayers: 11,
  maxNonLineman: 4,
  /** Spike! 22 sets no maximum; the rulebook draft limit (p.90) is kept. */
  maxRerolls: 8,
  rerollCost: 100_000,
  apothecaryCost: 80_000,
  assistantCost: 20_000,
  maxAssistants: 3,
  cheerleaderCost: 20_000,
  maxCheerleaders: 3,
  fanCost: 20_000,
  minFans: 1,
  maxFans: 5,
  pages: '8-9',
} as const;

/** The draft template a team uses (standard Tournament / Exhibition, or Sevens). */
export function draftTemplate(t: Pick<TeamDef, 'variant'>) {
  return t.variant === 'sevens' ? SEVENS_DRAFT : DRAFT_TEMPLATE;
}

export interface TeamPlayerDef {
  id: string;
  number: number;
  name: string;
  /** Roster position id (tournament teams always have one; league players may be custom). */
  positionId?: string;
  position: string;
  keywords: string[];
  ma: number;
  st: number;
  ag: number;
  pa: number | null;
  av: number;
  skills: SkillRef[];
  /** League teams: the player is not available for the next match (injury, etc.). */
  unavailable?: boolean;
  /**
   * Custom (non-roster) league players: skill categories for advancements
   * (p.97). Roster players always use their Team Roster's categories.
   */
  primary?: SkillCat[];
  secondary?: SkillCat[];
  /** League teams: unspent Star Player Points (p.96). */
  spp?: number;
  /** League teams: advancements taken, in order (p.97). */
  advancements?: AdvancementRecord[];
  /**
   * League teams: dice already rolled for an advancement not chosen yet
   * (random skill pairs, or the Characteristic D8), kept so reopening the
   * dialog cannot roll them again.
   */
  pendingAdvance?: { kind: 'randomPrimary'; cat: SkillCat; rolls: number[][]; choices: string[] } | { kind: 'characteristic'; d8: number };
  /** Blood Bowl Sevens: this Lineman is the team's Veteran (Spike! 22 p.13) — MA already reduced by 1. */
  veteran?: boolean;
  /** Team Captain (p.155): the nominated Captain — gains Pro at no cost (added when the match starts). */
  captain?: boolean;
  /** Mercenary Player (p.147, an Inducement): +30,000 gp, Loner (4+) added when the match starts. */
  mercenary?: boolean;
  /** A Mercenary's single extra Primary skill (+50,000 gp), added when the match starts. */
  mercSkill?: string;
  /** Star Player (Inducement, p.148): the Star Player's id (stars.ts); the profile is the Star Player's. */
  star?: string;
  /**
   * Tournament (Matched Play) teams: one extra skill bought with Skill Points (Primary 1, Secondary 2 — p.112,
   * Sevens Spike! 22 p.19), added to the player when the match starts. It does not add to the team's cost.
   */
  boughtSkill?: string;
  /** V5.5: hired for one match only (a League pre-match Inducement, p.94) — never written back to the saved team. */
  temporary?: boolean;
  /** V5.5: a Journeyman taken on for one League match (p.94): a 0-16 Lineman with Loner (4+). */
  journeyman?: boolean;
}

/** Primary / Secondary skill categories of a saved player (roster position, or the custom player's own). */
export function playerCategories(t: Pick<TeamDef, 'rosterId'>, p: TeamPlayerDef): { primary: SkillCat[]; secondary: SkillCat[]; fromRoster: boolean } {
  const r = t.rosterId ? ROSTER_BY_ID[t.rosterId] : undefined;
  const pos = findPosition(r, p.positionId);
  if (pos) return { primary: pos.primary.slice(), secondary: pos.secondary.slice(), fromRoster: true };
  return { primary: (p.primary ?? []).slice(), secondary: (p.secondary ?? []).slice(), fromRoster: false };
}

export interface TeamDef {
  format: 'bloodboard-team';
  version: 1;
  id: string;
  kind: MatchKind;
  /** Absent = a standard (11-a-side) team; 'sevens' = a Blood Bowl Sevens team (Spike! 22). */
  variant?: Variant;
  /** The League chosen for a roster with several (p.152), e.g. Norse: 'Chaos Clash' or 'Old World Classic'. */
  league?: string;
  /** "Favoured of (choose …)" (p.154): the alignment chosen when drafted (Chaos Chosen, Chaos Renegade), e.g. 'Nurgle'. */
  favoured?: string;
  /** Tournament / Exhibition teams: the Team Draft Budget (default 1,000,000; Matched / Exhibition Play often 1,100,000-1,200,000, p.110). */
  budget?: number;
  /** Tournament / Exhibition teams: Inducements bought on the Team Draft List (pp.110, 116, 141-147), id → count. */
  inducements?: InducementList;
  /**
   * Drafted teams (V5 step 6): built for Tournament play (Matched Play: Skill Points by Tier, Dedicated Fans from 0,
   * pp.110-113 / Spike! 22 pp.18-19) or for Exhibition play (absent = Exhibition: no purchased skills).
   */
  play?: 'tournament' | 'exhibition';
  /** Tournament teams: the team's Tier (1-4) for Skill Points — the official May 2026 Tier unless an event says otherwise (matched.ts). */
  tier?: Tier;
  /**
   * V5.5: the Team Draft Budget comes from custom (event / house) rules rather than the rulebook's usual values —
   * any amount is then accepted and the team is labelled as using custom rules.
   */
  budgetCustom?: boolean;
  /**
   * V5.5: an All-Star squad — the custom Exhibition variant made of Star Players only (no ordinary players needed, no
   * two-Star cap). `budget` null = unrestricted; `maxStars` = most Star Players in the squad. Not a rulebook team.
   */
  allStar?: { budget: number | null; maxStars: number };
  /** V5.5: League teams — gold pieces in the Treasury (p.89: what the draft did not spend; spent on Inducements, p.94). */
  treasury?: number;
  /**
   * V5.5: the match copy of a League team after the pre-match Inducements step (p.94): the Petty Cash it received and
   * the Treasury gold it spent. Its Inducements and hired Star Players / Mercenaries (marked `temporary`) are for this
   * match only.
   */
  preMatch?: { ctv: number; pettyCash: number; treasurySpent: number };
  name: string;
  rosterId?: string;
  color: string;
  accent: string;
  rerolls: number;
  apothecary: boolean;
  assistantCoaches: number;
  cheerleaders: number;
  dedicatedFans: number;
  players: TeamPlayerDef[];
  notes?: string;
  updatedAt: string;
  /** League teams: matches whose Star Player Points were added (see `matchKey`), so they are never added twice. */
  sppMatches?: string[];
}

export interface TeamIssue {
  level: 'error' | 'warning';
  text: string;
}

export function newTeamDef(kind: MatchKind, rosterId: string | undefined, name: string, id: string, variant?: Variant): TeamDef {
  const r = rosterId ? ROSTER_BY_ID[rosterId] : undefined;
  return {
    format: 'bloodboard-team',
    version: 1,
    id,
    kind: variant === 'sevens' ? 'tournament' : kind,
    ...(variant === 'sevens' ? { variant: 'sevens' as const } : {}),
    name,
    rosterId,
    color: r?.color ?? '#1f4e9c',
    accent: r?.accent ?? '#f4f1e8',
    rerolls: kind === 'league' ? 2 : 0,
    apothecary: false,
    assistantCoaches: 0,
    cheerleaders: 0,
    dedicatedFans: 1,
    players: [],
    updatedAt: new Date(0).toISOString(),
  };
}

export function playerFromRoster(r: Roster, positionId: string, number: number, id: string): TeamPlayerDef {
  const pos = r.positions.find((p) => p.id === positionId);
  if (!pos) throw new Error(`Unknown position ${positionId}`);
  return { id, number, name: pos.name, positionId: pos.id, position: pos.name, keywords: pos.keywords.slice(), ma: pos.ma, st: pos.st, ag: pos.ag, pa: pos.pa, av: pos.av, skills: pos.skills.map((s) => ({ ...s })) };
}

/** A saved team's League (its choice, or the roster's only one) and its team special rules (pp.152-155). */
export function teamLeague(t: Pick<TeamDef, 'rosterId' | 'league'>): string | undefined {
  return rosterLeague(t.rosterId ? ROSTER_BY_ID[t.rosterId] : undefined, t.league);
}
export function teamSpecialRules(t: Pick<TeamDef, 'rosterId' | 'league'> & { favoured?: string }): string[] {
  return rosterSpecialRules(t.rosterId ? ROSTER_BY_ID[t.rosterId] : undefined, t.league, t.favoured);
}

/** Team Captain (p.155) page, and whether the team has the special rule. */
export const CAPTAIN_PAGE = 155;
export function hasTeamCaptainRule(t: Pick<TeamDef, 'rosterId' | 'league'>): boolean {
  return teamSpecialRules(t).includes('Team Captain');
}

/** Nominate `playerId` as the Team Captain (p.155), or nobody. Any player except a Big Guy may be nominated. */
export function setCaptain(t: TeamDef, playerId: string | null): void {
  for (const p of t.players) {
    if (p.id === playerId) p.captain = true;
    else if (p.captain) delete p.captain;
  }
}

/** Team Captain nomination rules (p.155). */
function captainIssues(t: TeamDef, out: TeamIssue[]): void {
  const caps = t.players.filter((p) => p.captain);
  if (!caps.length) return;
  if (!hasTeamCaptainRule(t)) {
    out.push({ level: 'error', text: `Only teams with the Team Captain special rule have a Team Captain (p.${CAPTAIN_PAGE}).` });
    return;
  }
  if (caps.length > 1) out.push({ level: 'error', text: `${caps.length} Team Captains nominated: choose one (p.${CAPTAIN_PAGE}).` });
  for (const c of caps) if (c.keywords.includes('Big Guy')) out.push({ level: 'error', text: `#${c.number} ${c.name} cannot be the Team Captain: a Big Guy can never be nominated (p.${CAPTAIN_PAGE}).` });
}

/** A roster with several Leagues needs one chosen (p.152); "Favoured of (choose …)" needs an alignment (p.154). */
function leagueIssues(t: TeamDef, out: TeamIssue[]): void {
  const r = t.rosterId ? ROSTER_BY_ID[t.rosterId] : undefined;
  if (!r) return;
  if (t.league !== undefined && !r.leagues.includes(t.league)) out.push({ level: 'error', text: `${r.name} teams play in ${r.leagues.join(' or ')}, not ${t.league} (p.${LEAGUES_PAGE}).` });
  else if (r.leagues.length > 1 && !t.league) out.push({ level: 'error', text: `Choose the team's League: ${r.leagues.join(' or ')} (p.${LEAGUES_PAGE}; it cannot be changed later).` });
  if (r.favouredOf) {
    if (!t.favoured) out.push({ level: 'error', text: `Choose the team's alignment — Favoured of ${r.favouredOf.join(', ')} (p.154; it cannot be changed later).` });
    else if (!r.favouredOf.includes(t.favoured)) out.push({ level: 'error', text: `${r.name} teams may be Favoured of ${r.favouredOf.join(', ')}, not ${t.favoured} (p.154).` });
  } else if (t.favoured) out.push({ level: 'error', text: `${r.name} teams do not choose an alignment (Favoured of…, p.154).` });
}

/** Limits across positions printed on a roster, e.g. "a single Big Guy, chosen from the following". */
export function groupIssues(t: Pick<TeamDef, 'rosterId' | 'kind' | 'variant' | 'players'>, out: TeamIssue[] = []): TeamIssue[] {
  const r = t.rosterId ? ROSTER_BY_ID[t.rosterId] : undefined;
  for (const g of r?.groups ?? []) {
    const n = t.players.filter((p) => p.positionId && g.positions.includes(p.positionId)).length;
    if (n > g.max) {
      const names = g.positions.map((id) => r!.positions.find((x) => x.id === id)?.name ?? id).join(', ');
      out.push({ level: t.kind === 'tournament' || t.variant === 'sevens' ? 'error' : 'warning', text: `${n} players from ${names}: ${g.text.replace(/:$/, '')} — at most ${g.max} (${r!.name} Team Roster, p.${r!.page}).` });
    }
  }
  return out;
}

/** How many more players of `positionId` a team may add under its roster's group limits (Infinity if none applies). */
export function groupRoom(t: Pick<TeamDef, 'rosterId' | 'players'>, positionId: string): number {
  const r = t.rosterId ? ROSTER_BY_ID[t.rosterId] : undefined;
  let room = Infinity;
  for (const g of r?.groups ?? []) {
    if (!g.positions.includes(positionId)) continue;
    const n = t.players.filter((p) => p.positionId && g.positions.includes(p.positionId)).length;
    room = Math.min(room, g.max - n);
  }
  return room;
}

/** Team cost breakdown in gold pieces (players, re-rolls, staff, fans). Sevens teams use the Sevens prices (Spike! 22 p.9). */
export function teamCost(t: TeamDef): { players: number; rerolls: number; staff: number; fans: number; inducements: number; total: number } {
  const r = t.rosterId ? ROSTER_BY_ID[t.rosterId] : undefined;
  const T = draftTemplate(t);
  // Mercenary Players (p.147): +30,000 gp each, +50,000 gp for their extra Primary skill — part of the Inducements.
  const merc = t.players.reduce((a, p) => a + (p.mercenary ? MERCENARY.extra + (p.mercSkill ? MERCENARY.skillCost : 0) : 0), 0);
  const players = t.players.reduce((a, p) => a + (p.star ? 0 : findPosition(r, p.positionId)?.cost ?? 0), 0);
  const rerolls = (t.variant === 'sevens' ? SEVENS_DRAFT.rerollCost : r?.rerollCost ?? 0) * t.rerolls;
  const staff = (t.apothecary ? T.apothecaryCost : 0) + t.assistantCoaches * T.assistantCost + t.cheerleaders * T.cheerleaderCost;
  // Matched Play (Tournament) teams start with 0 Dedicated Fans and buy every one (p.110, Spike! 22 p.18).
  const fans = (isTournamentTeam(t) ? t.dedicatedFans : Math.max(0, t.dedicatedFans - 1)) * T.fanCost;
  // Star Players (p.148) are Inducements too: their hiring fee (a pair paid once).
  const inducements = inducementCost(t.inducements, teamSpecialRules(t), r, t.variant === 'sevens' ? 'sevens' : 'standard') + merc + starsCost(t.players);
  return { players, rerolls, staff, fans, inducements, total: players + rerolls + staff + fans + inducements };
}

/** Team Draft Budgets offered for Tournament / Exhibition teams: the League draft (p.89) and the usual Matched Play values (p.110). */
export const DRAFT_BUDGETS = [1_000_000, 1_100_000, 1_150_000, 1_200_000] as const;

/** The Team Draft Budget of a team: Sevens 600,000; Tournament / Exhibition its chosen budget (default 1,000,000). */
export function teamBudget(t: Pick<TeamDef, 'variant' | 'budget' | 'kind' | 'play' | 'budgetCustom' | 'allStar'>): number {
  // V5.5: custom (event / house) rules may set any budget; an All-Star squad's budget (null = unrestricted).
  if (t.allStar) return t.allStar.budget ?? Number.POSITIVE_INFINITY;
  if (t.budgetCustom && t.budget && t.budget > 0) return t.budget;
  if (t.variant === 'sevens') return SEVENS_DRAFT.budget;
  // Tournament (Matched Play) teams: usually 1,100,000-1,200,000 gp (p.110); 1,100,000 unless chosen.
  if (isTournamentTeam(t)) return t.budget && MATCHED.standard.budgets.includes(t.budget) ? t.budget : MATCHED.standard.defaultBudget;
  return t.kind === 'tournament' && t.budget ? t.budget : DRAFT_TEMPLATE.budget;
}

/** The Team Draft Budgets a team may choose (Tournament teams: the Matched Play values, p.110). */
export function budgetsFor(t: Pick<TeamDef, 'variant' | 'kind' | 'play'>): readonly number[] {
  if (t.variant === 'sevens') return [SEVENS_DRAFT.budget];
  return isTournamentTeam(t) ? MATCHED.standard.budgets : DRAFT_BUDGETS;
}

/** Dedicated Fans a drafted team may have: Tournament (Matched Play) 0-3 / Sevens 0-5; otherwise the draft template. */
export function fansRange(t: Pick<TeamDef, 'variant' | 'kind' | 'play'>): { min: number; max: number } {
  const T = draftTemplate(t);
  return { min: isTournamentTeam(t) ? 0 : T.minFans, max: T.maxFans };
}

/** Skill Points of a team: allowance and what its purchases (skills, Star Players — Mega-stars 4) cost. */
export function teamSkillPoints(t: TeamDef): SkillPointUse {
  const sc = starChoiceSummary(t.players, starChoiceKey);
  return skillPointUse(t, (p) => playerCategories(t, p), sc.choices, sc.mega);
}

/** Inducements and Mercenary Players on a Team Draft List (pp.141-147). */
function inducementIssues(t: TeamDef, out: TeamIssue[]): void {
  const list = Object.entries(t.inducements ?? {}).filter(([, k]) => k > 0);
  const mercs = t.players.filter((p) => p.mercenary);
  const stars = t.players.filter((p) => p.star);
  if (!list.length && !mercs.length && !stars.length) return;
  if (t.allStar) {
    // V5.5 All-Star squad (custom Exhibition variant): Star Players only, checked by allStarIssues.
    if (list.length || mercs.length) out.push({ level: 'error', text: 'An All-Star squad has Star Players only (no Inducements or Mercenaries).' });
    return;
  }
  if (t.kind === 'league') {
    // V5.5: a League team's Inducements and Star Players are bought for one match in the pre-match step (p.94) —
    // only the match copy of the team carries them (`preMatch`, hired players marked temporary); the saved team never.
    if (!t.preMatch || t.players.some((p) => (p.star || p.mercenary) && !p.temporary)) {
      out.push({ level: 'error', text: 'League teams buy Inducements and Star Players for one match in the pre-match step (Petty Cash and Treasury, p.94) — not on the saved team.' });
      return;
    }
  }
  const sevens = t.variant === 'sevens';
  if (sevens && (mercs.length || stars.length)) out.push({ level: 'error', text: `${mercs.length ? 'Mercenary Players' : 'Star Players'} are not on the Blood Bowl Sevens Inducement list (Spike! 22 p.${SEVENS_INDUCEMENT_PAGE}).` });
  const r = t.rosterId ? ROSTER_BY_ID[t.rosterId] : undefined;
  const rules = teamSpecialRules(t);
  for (const [id, k] of list) {
    const d = inducementFor(id, sevens ? 'sevens' : 'standard');
    if (!d) {
      out.push({ level: 'error', text: INDUCEMENT_BY_ID[id] ? `${INDUCEMENT_BY_ID[id].name}: ${sevens ? `not on the Blood Bowl Sevens Inducement list (Spike! 22 p.${SEVENS_INDUCEMENT_PAGE})` : 'Blood Bowl Sevens only (Spike! 22 p.15)'}.` : `Unknown Inducement "${id}".` });
      continue;
    }
    const why = d.unavailable(rules, r);
    if (why) out.push({ level: 'error', text: `${d.name}: ${why} (p.${d.page}).` });
    if (k > d.max(rules)) out.push({ level: 'error', text: `${k} × ${d.name}: at most ${d.max(rules)} (p.${d.page}).` });
  }
  if (mercs.length > MERCENARY.max) out.push({ level: 'error', text: `${mercs.length} Mercenary Players: at most ${MERCENARY.max} (p.${MERCENARY.page}).` });
  for (const p of mercs) {
    if (!p.mercSkill) continue;
    const pos = r?.positions.find((x) => x.id === p.positionId);
    const cat = skillCategory(p.mercSkill);
    if (!SKILL_BY_ID[p.mercSkill]) out.push({ level: 'error', text: `#${p.number}: unknown skill "${p.mercSkill}".` });
    else if (!pos || !cat || !pos.primary.includes(cat)) out.push({ level: 'error', text: `#${p.number} ${p.name}: a Mercenary's extra skill must be one of the position's Primary skills (p.${MERCENARY.page}).` });
    else if (p.skills.some((k) => k.id === p.mercSkill)) out.push({ level: 'error', text: `#${p.number} ${p.name} already has ${SKILL_BY_ID[p.mercSkill].name}.` });
  }
  starIssues(t, rules, out);
}

/** Star Players on a Team Draft List (p.148, Plays For p.194, profiles pp.195-211). */
function starIssues(t: TeamDef, rules: string[], out: TeamIssue[]): void {
  const stars = t.players.filter((p) => p.star);
  if (!stars.length) return;
  const league = teamLeague(t);
  const n = starChoices(stars);
  if (n > STAR_MAX) out.push({ level: 'error', text: `${n} Star Players: a team may hire at most ${STAR_MAX} (a pair counts as one, p.${STAR_RULE.page}).` });
  const mega = starChoiceSummary(stars, starChoiceKey).mega;
  if (mega > 1 && !isTournamentTeam(t)) out.push({ level: 'warning', text: `${mega} Mega-stars: in Matched Play a team may have only one (p.113); allowed here because this is not a Tournament team.` });
  const seen = new Set<string>();
  for (const p of stars) {
    const st = STAR_BY_ID[p.star as string];
    if (!st) {
      out.push({ level: 'error', text: `#${p.number}: unknown Star Player "${p.star}".` });
      continue;
    }
    if (seen.has(st.id)) out.push({ level: 'error', text: `${st.name} is hired twice.` });
    seen.add(st.id);
    if (!starSupported(st.id)) out.push({ level: 'error', text: `${st.name}: their special rule "${st.rule.name}" is not implemented yet, so they cannot play.` });
    if (!starPlaysFor(st, league, rules)) out.push({ level: 'error', text: `${st.name} plays for ${playsForText(st)} — not for this team (${league ?? 'no League'}${rules.length ? `; ${rules.join(', ')}` : ''}, p.${STAR_LIST_PAGE}).` });
    if (st.pair && !stars.some((q) => q.star === st.pair)) out.push({ level: 'error', text: `${st.name} must be hired together with ${STAR_BY_ID[st.pair]?.name ?? st.pair} (p.${st.page}).` });
    const same = p.ma === st.ma && p.st === st.st && p.ag === st.ag && p.pa === st.pa && p.av === st.av && JSON.stringify(p.skills) === JSON.stringify(st.skills);
    if (!same) out.push({ level: 'error', text: `#${p.number} ${st.name}: Star Players play with their printed profile (p.${st.page}).` });
    if (p.mercenary || p.captain || p.veteran) out.push({ level: 'error', text: `#${p.number} ${st.name}: a Star Player cannot be a Mercenary, the Team Captain or the Veteran.` });
    if (st.id === 'josefBugmanStar' && (t.inducements?.josefBugman ?? 0) > 0) out.push({ level: 'error', text: 'A team that hired Josef Bugman as Infamous Coaching Staff cannot also hire him as a Star Player (p.147).' });
  }
}

/** Why Star Player `id` cannot be added to team `t` now, or null (the team builder greys out the button). */
export function starAddReason(t: TeamDef, id: string): string | null {
  const st = STAR_BY_ID[id];
  if (!st) return 'Unknown Star Player.';
  if (t.allStar) return allStarAddReason(t, id);
  if (t.kind === 'league') return 'League teams hire Star Players for one match in the pre-match Inducements step (Petty Cash and Treasury, p.94): Match set-up → League → Pre-match Inducements.';
  if (t.variant === 'sevens') return 'Blood Bowl Sevens: the Sevens Inducements (Spike! 22 p.16) include no Star Players (an All-Star Sevens match is a custom Exhibition variant).';
  if (!starSupported(id)) return `Their special rule "${st.rule.name}" is not implemented yet.`;
  if (!starPlaysFor(st, teamLeague(t), teamSpecialRules(t))) return `Plays for ${playsForText(st)} (p.${STAR_LIST_PAGE}).`;
  if (t.players.some((p) => p.star === id)) return 'Already hired.';
  const key = starChoiceKey(id);
  if (!t.players.some((p) => p.star && starChoiceKey(p.star) === key) && starChoices(t.players) >= STAR_MAX) return `At most ${STAR_MAX} Star Players (p.${STAR_RULE.page}).`;
  const places = st.pair ? 2 : 1;
  if (t.players.length + places > DRAFT_TEMPLATE.maxPlayers) return `No room: a team may never have more than ${DRAFT_TEMPLATE.maxPlayers} players (p.${STAR_RULE.page}).`;
  if (id === 'josefBugmanStar' && (t.inducements?.josefBugman ?? 0) > 0) return 'The team hired Josef Bugman as Infamous Coaching Staff (p.147).';
  // Tournament (Matched Play): a Star Player also costs 2 Skill Points; Tier 1 teams at most one (p.113).
  if (isTournamentTeam(t)) {
    if (!t.tier) return "Choose the team's Tier first: in Matched Play a Star Player costs 2 Skill Points (p.113).";
    const F = MATCHED.standard;
    const choices = starChoices(t.players);
    if (choices >= F.starsMax[t.tier]) return `A Tier ${t.tier} team may have at most ${F.starsMax[t.tier]} Star Player${F.starsMax[t.tier] === 1 ? '' : 's'} (p.113).`;
    const mega = isMegaStar(id);
    if (mega && starChoiceSummary(t.players, starChoiceKey).mega >= 1) return 'A team may only ever have a single Mega-star (p.113).';
    const cost = mega ? MEGA_STAR_COST : (F.starCost ?? 2);
    const u = teamSkillPoints(t);
    if (u.allowance - u.spent < cost) return `Needs ${cost} Skill Points${mega ? ' (a Mega-star)' : ''} (${u.allowance - u.spent} left of ${u.allowance}, p.113).`;
  }
  // The team's gold: the hiring fee must fit the Team Draft Budget.
  const left = teamBudget(t) - teamCost(t).total;
  if (st.cost > left) return `Costs ${st.cost.toLocaleString('en-GB')} gp — ${Math.max(0, left).toLocaleString('en-GB')} gp left of the ${teamBudget(t).toLocaleString('en-GB')} gp budget.`;
  return null;
}

// ---------------------------------------------------------------------------
// V5.5: All-Star squads — a custom Exhibition variant (not a rulebook team)
// ---------------------------------------------------------------------------

/** Defaults: 11-a-side squads of up to 16 Star Players, Sevens up to 11; an unrestricted budget unless one is set. */
export const ALL_STAR_DEFAULTS = { standard: { maxStars: 16, budget: null as number | null }, sevens: { maxStars: 11, budget: null as number | null } };

/** A new, empty All-Star squad. */
export function newAllStarSquad(id: string, name: string, variant: Variant = 'standard', opts: Partial<{ budget: number | null; maxStars: number }> = {}): TeamDef {
  const d = ALL_STAR_DEFAULTS[variant === 'sevens' ? 'sevens' : 'standard'];
  const t = newTeamDef('tournament', undefined, name, id, variant === 'sevens' ? 'sevens' : undefined);
  t.play = 'exhibition';
  t.allStar = { budget: opts.budget === undefined ? d.budget : opts.budget, maxStars: opts.maxStars ?? d.maxStars };
  t.rerolls = 0;
  t.dedicatedFans = 1;
  t.color = '#6b3fa0';
  t.accent = '#ffd76a';
  return t;
}

/** Why Star Player `id` cannot join All-Star squad `t` now (each Star once per squad; a pair joins together). */
function allStarAddReason(t: TeamDef, id: string): string | null {
  const st = STAR_BY_ID[id];
  if (!st || !t.allStar) return 'Unknown Star Player.';
  if (!starSupported(id)) return `Their special rule "${st.rule.name}" is not implemented yet.`;
  if (t.players.some((p) => p.star === id)) return 'Already in this squad (each Star Player once per squad).';
  const places = st.pair && !t.players.some((p) => p.star === st.pair) ? 2 : 1;
  if (t.players.length + places > t.allStar.maxStars) return `Squad limit: at most ${t.allStar.maxStars} Star Players${st.pair ? ` (${st.name} comes with ${STAR_BY_ID[st.pair]?.name ?? st.pair})` : ''}.`;
  if (t.allStar.budget !== null) {
    const left = t.allStar.budget - starsCost(t.players);
    const fee = st.pair && t.players.some((p) => p.star === st.pair) ? 0 : st.cost;
    if (fee > left) return `Costs ${fee.toLocaleString('en-GB')} gp — ${Math.max(0, left).toLocaleString('en-GB')} gp left of the squad budget.`;
  }
  return null;
}

/** Checks of an All-Star squad. */
function allStarIssues(t: TeamDef, out: TeamIssue[]): TeamIssue[] {
  const a = t.allStar!;
  const sevens = t.variant === 'sevens';
  out.push({ level: 'warning', text: `All-Star Match — a custom Exhibition variant (not rulebook play): Star Players only, no two-Star cap, squad limit ${a.maxStars}, ${a.budget === null ? 'unrestricted budget' : `budget ${a.budget.toLocaleString('en-GB')} gp`}.` });
  const others = t.players.filter((p) => !p.star);
  if (others.length) out.push({ level: 'error', text: 'An All-Star squad has Star Players only.' });
  if (t.players.length < 3) out.push({ level: 'error', text: `${t.players.length} Star Player${t.players.length === 1 ? '' : 's'}: an All-Star squad needs at least 3 (the Line of Scrimmage needs three players, p.47).` });
  else if (t.players.length < (sevens ? 7 : 11)) out.push({ level: 'warning', text: `${t.players.length} Star Players: the squad will set up all of them (fewer than ${sevens ? 7 : 11}, p.47).` });
  if (t.players.length > a.maxStars) out.push({ level: 'error', text: `${t.players.length} Star Players: this squad allows at most ${a.maxStars}.` });
  if (t.players.length > (sevens ? SEVENS_DRAFT.maxPlayers : DRAFT_TEMPLATE.maxPlayers)) out.push({ level: 'error', text: `A team may never have more than ${sevens ? SEVENS_DRAFT.maxPlayers : DRAFT_TEMPLATE.maxPlayers} players.` });
  const seen = new Set<string>();
  for (const p of t.players) {
    if (!p.star) continue;
    const st = STAR_BY_ID[p.star];
    if (!st) {
      out.push({ level: 'error', text: `#${p.number}: unknown Star Player "${p.star}".` });
      continue;
    }
    if (seen.has(st.id)) out.push({ level: 'error', text: `${st.name} is in the squad twice (each Star Player once per squad).` });
    seen.add(st.id);
    if (!starSupported(st.id)) out.push({ level: 'error', text: `${st.name}: their special rule is not implemented yet.` });
    if (st.pair && !t.players.some((q) => q.star === st.pair)) out.push({ level: 'error', text: `${st.name} must be hired together with ${STAR_BY_ID[st.pair]?.name ?? st.pair} (p.${st.page}).` });
    const same = p.ma === st.ma && p.st === st.st && p.ag === st.ag && p.pa === st.pa && p.av === st.av && JSON.stringify(p.skills) === JSON.stringify(st.skills);
    if (!same) out.push({ level: 'error', text: `#${p.number} ${st.name}: Star Players play with their printed profile (p.${st.page}).` });
  }
  if (a.budget !== null && starsCost(t.players) > a.budget) out.push({ level: 'error', text: `The squad's hiring fees are ${starsCost(t.players).toLocaleString('en-GB')} gp: over its ${a.budget.toLocaleString('en-GB')} gp budget.` });
  if (t.rerolls < 0 || t.rerolls > 8) out.push({ level: 'error', text: 'Team Re-rolls: 0-8.' });
  return out;
}

/** A Star Player's entry on a Team Draft List. */
export function playerFromStar(id: string, number: number, playerId: string): TeamPlayerDef {
  const st = STAR_BY_ID[id];
  if (!st) throw new Error(`Unknown Star Player ${id}`);
  return { id: playerId, number, name: st.name, position: st.name, keywords: st.keywords.slice(), ma: st.ma, st: st.st, ag: st.ag, pa: st.pa, av: st.av, skills: starSkills(st), star: st.id };
}

/** Add Star Player `id` (and their partner, for a pair) to the team with the next free numbers. Returns the added players. */
export function addStar(t: TeamDef, id: string, newId: () => string): TeamPlayerDef[] {
  const st = STAR_BY_ID[id];
  if (!st) return [];
  const ids = st.pair && !t.players.some((p) => p.star === st.pair) ? [id, st.pair] : [id];
  const added: TeamPlayerDef[] = [];
  for (const sid of ids) {
    const used = new Set(t.players.map((p) => p.number));
    let n = 1;
    while (used.has(n)) n++;
    const p = playerFromStar(sid, n, newId());
    t.players.push(p);
    added.push(p);
  }
  return added;
}

/** Remove Star Player `id` (and their partner, for a pair). */
export function removeStar(t: TeamDef, id: string): void {
  const st = STAR_BY_ID[id];
  t.players = t.players.filter((p) => p.star !== id && (!st?.pair || p.star !== st.pair));
}

/** Sevens: the roster profile of a Veteran (MA −1, Spike! 22 p.13), or the plain roster profile. */
export function expectedProfile(t: Pick<TeamDef, 'variant'>, pos: { ma: number }, p: Pick<TeamPlayerDef, 'veteran'>): number {
  return t.variant === 'sevens' && p.veteran ? pos.ma - 1 : pos.ma;
}

/** Make `playerId` the Sevens team's Veteran (MA −1), restoring the previous Veteran's MA. */
export function setVeteran(t: TeamDef, playerId: string | null): void {
  for (const p of t.players) {
    if (p.veteran && p.id !== playerId) {
      p.veteran = undefined;
      p.ma += 1;
    }
  }
  const v = t.players.find((p) => p.id === playerId);
  if (v && !v.veteran) {
    v.veteran = true;
    v.ma -= 1;
  }
}

/**
 * V5.5: the Sevens exception to Insignificant (p.129) used by Bloodboard — the user's choice, following the optional
 * NAF "Recommendations and Clarifications for BB2025" (Sevens section): when drafting a Blood Bowl Sevens team the
 * Insignificant count limit is ignored. The Trait stays on the players; the budget (600,000 gp), roster position
 * limits, at most four non-Linemen, 7-11 players and seven on the pitch (Swarming aside) still apply; 11-a-side is
 * unchanged.
 */
export const SEVENS_INSIGNIFICANT = {
  label: 'Sevens exception: Insignificant ignored when drafting',
  text: 'Blood Bowl Sevens in Bloodboard: the Insignificant limit (no more players with the Trait than without it, rulebook p.129) is ignored when drafting a Sevens team — the chosen house setting, following the optional NAF BB2025 Sevens recommendation (not a Games Workshop erratum). The Trait stays on the players; the 600,000 gp budget, the roster position limits, at most four non-Linemen, 7-11 players and seven players on the pitch (Swarming aside) still apply. 11-a-side teams keep the rulebook limit.',
  source: 'NAF Recommendations and Clarifications for BB2025 — Sevens (optional, event-declared)',
} as const;

/** The team has more Insignificant players than others — allowed only by the Sevens exception. */
export function usesSevensInsignificantException(t: TeamDef): boolean {
  if (t.variant !== 'sevens') return false;
  const insig = t.players.filter((p) => p.skills.some((k) => k.id === 'insignificant')).length;
  return insig > t.players.length - insig;
}

/** Check a team for match play. Tournament teams must follow the draft template exactly. */
export function validateTeamDef(t: TeamDef): TeamIssue[] {
  const out: TeamIssue[] = [];
  const available = t.players.filter((p) => !p.unavailable);
  if (!t.name.trim()) out.push({ level: 'error', text: 'The team needs a name.' });
  if (available.length < 1) out.push({ level: 'error', text: 'The team has no available players.' });
  const nums = new Set<number>();
  for (const p of t.players) {
    if (nums.has(p.number)) out.push({ level: 'error', text: `Two players wear #${p.number}.` });
    nums.add(p.number);
    for (const sk of p.skills) {
      const def = SKILL_BY_ID[sk.id];
      if (!def) out.push({ level: 'error', text: `#${p.number} has an unknown skill "${sk.id}".` });
      else if (def.support === 'unsupported') out.push({ level: 'warning', text: `#${p.number} ${p.name}: ${def.name} is not implemented — ${def.note ?? 'affected actions are disabled'}` });
    }
  }
  // Insignificant (p.129): no more players with the Trait than players without it on a Team Draft List.
  // V5.5 Sevens exception (chosen by the user; the optional NAF BB2025 Sevens recommendation, not a GW erratum):
  // Insignificant is ignored when drafting a Sevens team — the other draft limits still apply (SEVENS_INSIGNIFICANT).
  const insig = t.players.filter((p) => p.skills.some((k) => k.id === 'insignificant')).length;
  // FAQ May 2026 p.129: the limit applies to the initial Team Draft List only; a League team may later fire down to eleven players and replace
  // them with Insignificant ones. A League team that has played (Star Player Points, advancements or recorded matches) is no longer an
  // initial draft, so the check stays silent for it; the eleven-player floor is enforced elsewhere (never below 11).
  const evolvedLeague = t.kind === 'league' && (!!t.sppMatches?.length || t.players.some((p) => (p.spp ?? 0) > 0 || !!p.advancements?.length));
  if (insig > t.players.length - insig && t.variant !== 'sevens' && !evolvedLeague) out.push({ level: t.kind === 'tournament' ? 'error' : 'warning', text: `${insig} players with Insignificant: ${t.kind === 'league' ? 'an initial League Team Draft List' : 'a Team Draft List'} may not include more of them than players without it (p.129). A League team may exceed this later by hiring and firing (FAQ May 2026).` });
  if (t.allStar) return allStarIssues(t, out);
  leagueIssues(t, out);
  captainIssues(t, out);
  groupIssues(t, out);
  inducementIssues(t, out);
  if (t.variant === 'sevens') return validateSevensDraft(t, out);
  if (t.players.length > DRAFT_TEMPLATE.maxPlayers) out.push({ level: t.kind === 'tournament' ? 'error' : 'warning', text: `${t.players.length} players: a team may never have more than 16 (p.89).` });
  if (t.players.some((p) => p.veteran)) out.push({ level: 'error', text: 'Only Blood Bowl Sevens teams have a Veteran.' });
  if (t.kind === 'league') {
    if (available.length < 11) out.push({ level: 'warning', text: `Only ${available.length} available players: the team will set up as many as it can (p.47).` });
    if (t.rerolls > 8) out.push({ level: 'warning', text: 'More than 8 Team Re-rolls (the draft limit is 8, p.90).' });
    skillPointIssues(t, out);
    return out;
  }
  // Tournament / Exhibition template (pp.89-91)
  const r = t.rosterId ? ROSTER_BY_ID[t.rosterId] : undefined;
  if (!r) {
    out.push({ level: 'error', text: 'Choose an official Team Roster.' });
    return out;
  }
  if (t.players.length < DRAFT_TEMPLATE.minPlayers) out.push({ level: 'error', text: `${t.players.length} players: a drafted team needs at least 11 (p.89).` });
  for (const pos of r.positions) {
    const max = Number(pos.qty.split('-')[1]);
    const n = t.players.filter((p) => p.positionId === pos.id).length;
    if (n > max) out.push({ level: 'error', text: `${n} × ${pos.name}: the roster allows ${pos.qty}.` });
  }
  for (const p of t.players) {
    if (p.star) continue; // checked with the Inducements (starIssues)
    const pos = r.positions.find((x) => x.id === p.positionId);
    if (!pos) {
      if (isRetiredPosition(r, p.positionId)) out.push({ level: 'error', text: `#${p.number} ${p.name} is a retired ${r.name} position (earlier table): it can no longer be hired. The saved team still loads; replace this player with a position of the current table.` });
      else out.push({ level: 'error', text: `#${p.number} is not a ${r.name} roster player.` });
      continue;
    }
    const same = pos.ma === p.ma && pos.st === p.st && pos.ag === p.ag && pos.pa === p.pa && pos.av === p.av && JSON.stringify(pos.skills) === JSON.stringify(p.skills);
    if (!same) out.push({ level: 'error', text: `#${p.number} ${p.name}: tournament teams use the roster profile unchanged.` });
    if (p.unavailable) out.push({ level: 'error', text: `#${p.number} is marked unavailable (league option).` });
  }
  if (t.rerolls < 0 || t.rerolls > DRAFT_TEMPLATE.maxRerolls) out.push({ level: 'error', text: 'Team Re-rolls: 0-8 (p.90).' });
  if (t.apothecary && !r.apothecary) out.push({ level: 'error', text: `${r.name} teams cannot hire an Apothecary.` });
  if (t.assistantCoaches < 0 || t.assistantCoaches > DRAFT_TEMPLATE.maxAssistants) out.push({ level: 'error', text: 'Assistant Coaches: 0-6 (p.90).' });
  if (t.cheerleaders < 0 || t.cheerleaders > DRAFT_TEMPLATE.maxCheerleaders) out.push({ level: 'error', text: 'Cheerleaders: 0-6 (p.90).' });
  const fr = fansRange(t);
  if (t.dedicatedFans < fr.min || t.dedicatedFans > fr.max) out.push({ level: 'error', text: isTournamentTeam(t) ? `Dedicated Fans: ${fr.min}-${fr.max} (Matched Play teams start at 0, p.110).` : 'Dedicated Fans: 1-3 when drafting (p.91).' });
  const cost = teamCost(t);
  const budget = teamBudget(t);
  const budgets = budgetsFor(t);
  if (t.budget !== undefined && !t.budgetCustom && !budgets.includes(t.budget)) out.push({ level: isTournamentTeam(t) ? 'warning' : 'error', text: `Team Draft Budget ${t.budget.toLocaleString('en-GB')} gp: choose ${budgets.map((b) => b.toLocaleString('en-GB')).join(', ')} (${isTournamentTeam(t) ? 'p.110 — using the default' : 'pp.89, 110'}), or mark it as custom rules.` });
  if (t.budgetCustom) out.push({ level: 'warning', text: `Custom rules: a ${budget.toLocaleString('en-GB')} gp Team Draft Budget set by the event or the coaches (the rulebook's usual values are ${budgets.map((b) => b.toLocaleString('en-GB')).join(', ')} gp).` });
  if (cost.total > budget) out.push({ level: 'error', text: `Team costs ${cost.total.toLocaleString('en-GB')} gp: over the ${budget.toLocaleString('en-GB')} gp Team Draft Budget (${t.budgetCustom ? 'custom rules' : budget === DRAFT_TEMPLATE.budget ? 'p.89' : 'p.110'}).` });
  skillPointIssues(t, out);
  return out;
}

function skillPointIssues(t: TeamDef, out: TeamIssue[]): void {
  const sc = starChoiceSummary(t.players, starChoiceKey);
  matchedIssues(t, (p) => playerCategories(t, p), sc.choices, (id) => SKILL_BY_ID[id]?.name ?? id, out, sc.mega);
}

/** Blood Bowl Sevens Team Draft (Spike! Journal 22 pp.8-9, Veteran p.13). */
function validateSevensDraft(t: TeamDef, out: TeamIssue[]): TeamIssue[] {
  const S = SEVENS_DRAFT;
  const pg = (n: number | string) => `Sevens p.${n}`;
  if (t.kind !== 'tournament') out.push({ level: 'error', text: 'Sevens teams play Exhibition matches: Sevens League play (random-skill advancement, Spike! 22 pp.14-17) is not implemented.' });
  const r = t.rosterId ? ROSTER_BY_ID[t.rosterId] : undefined;
  if (!r) {
    out.push({ level: 'error', text: 'Choose an official Team Roster.' });
    return out;
  }
  if (t.players.length < S.minPlayers) out.push({ level: 'error', text: `${t.players.length} players: a Sevens team needs at least ${S.minPlayers} (${pg(8)}).` });
  if (t.players.length > S.maxPlayers) out.push({ level: 'error', text: `${t.players.length} players: a Sevens team may never have more than ${S.maxPlayers} (${pg(8)}).` });
  for (const pos of r.positions) {
    const max = Number(pos.qty.split('-')[1]);
    const n = t.players.filter((p) => p.positionId === pos.id).length;
    if (n > max) out.push({ level: 'error', text: `${n} × ${pos.name}: the roster allows ${pos.qty} (still applies in Sevens, ${pg(8)}).` });
  }
  const nonLine = t.players.filter((p) => !p.keywords.includes('Lineman')).length;
  if (nonLine > S.maxNonLineman) out.push({ level: 'error', text: `${nonLine} players without the Lineman keyword: a Sevens team can include no more than ${S.maxNonLineman} (${pg(8)}).` });
  for (const p of t.players) {
    if (p.star) continue; // Star Players: an Inducement (refused in Sevens, see inducementIssues)
    const pos = r.positions.find((x) => x.id === p.positionId);
    if (!pos) {
      if (isRetiredPosition(r, p.positionId)) out.push({ level: 'error', text: `#${p.number} ${p.name} is a retired ${r.name} position (earlier table): it can no longer be hired. The saved team still loads; replace this player with a position of the current table.` });
      else out.push({ level: 'error', text: `#${p.number} is not a ${r.name} roster player.` });
      continue;
    }
    const same = expectedProfile(t, pos, p) === p.ma && pos.st === p.st && pos.ag === p.ag && pos.pa === p.pa && pos.av === p.av && JSON.stringify(pos.skills) === JSON.stringify(p.skills);
    if (!same) out.push({ level: 'error', text: `#${p.number} ${p.name}: Sevens teams use the roster profile unchanged${p.veteran ? ' (the Veteran with MA −1)' : ''}.` });
    if (p.unavailable) out.push({ level: 'error', text: `#${p.number} is marked unavailable (league option).` });
  }
  const vets = t.players.filter((p) => p.veteran);
  if (vets.length !== 1) out.push({ level: 'error', text: `Choose exactly one Lineman as the team's Veteran (${vets.length} chosen, ${pg(13)}).` });
  for (const v of vets) if (!v.keywords.includes('Lineman')) out.push({ level: 'error', text: `#${v.number} ${v.name} cannot be the Veteran: it must be a Lineman (${pg(13)}).` });
  if (t.rerolls < 0 || t.rerolls > S.maxRerolls) out.push({ level: 'error', text: `Team Re-rolls: 0-${S.maxRerolls} (p.90; ${S.rerollCost / 1000}k each in Sevens, ${pg(9)}).` });
  if (t.apothecary && !r.apothecary) out.push({ level: 'error', text: `${r.name} teams cannot hire an Apothecary.` });
  if (t.assistantCoaches < 0 || t.assistantCoaches > S.maxAssistants) out.push({ level: 'error', text: `Assistant Coaches: 0-${S.maxAssistants} in Sevens (${pg(9)}).` });
  if (t.cheerleaders < 0 || t.cheerleaders > S.maxCheerleaders) out.push({ level: 'error', text: `Cheerleaders: 0-${S.maxCheerleaders} in Sevens (${pg(9)}).` });
  const fr = fansRange(t);
  if (t.dedicatedFans < fr.min || t.dedicatedFans > fr.max) out.push({ level: 'error', text: `Dedicated Fans: ${fr.min}-${fr.max} in Sevens (${isTournamentTeam(t) ? `Matched Play teams start at 0, ${pg(18)}` : pg(9)}).` });
  const cost = teamCost(t);
  const sb = teamBudget(t);
  if (t.budgetCustom) out.push({ level: 'warning', text: `Custom rules: a ${sb.toLocaleString('en-GB')} gp Sevens Team Draft Budget (standard Sevens: ${S.budget.toLocaleString('en-GB')} gp, ${pg(8)}).` });
  if (cost.total > sb) out.push({ level: 'error', text: `Team costs ${cost.total.toLocaleString('en-GB')} gp: over the ${sb.toLocaleString('en-GB')} gp Sevens Team Draft Budget (${t.budgetCustom ? 'custom rules' : pg(8)}).` });
  skillPointIssues(t, out);
  return out;
}

export function parseTeamDef(text: string): { ok: true; team: TeamDef } | { ok: false; errors: string[] } {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`Not JSON: ${(e as Error).message}`] };
  }
  const t = v as Partial<TeamDef>;
  const errors: string[] = [];
  if (t.format !== 'bloodboard-team' || t.version !== 1) errors.push('Not a Bloodboard team file (format "bloodboard-team", version 1).');
  if (t.kind !== 'league' && t.kind !== 'tournament') errors.push('kind must be "league" or "tournament".');
  if (t.variant !== undefined && t.variant !== 'standard' && t.variant !== 'sevens') errors.push('variant must be "sevens" or absent.');
  if (!Array.isArray(t.players)) errors.push('players must be a list.');
  if (typeof t.name !== 'string') errors.push('name is missing.');
  if (errors.length) return { ok: false, errors };
  return { ok: true, team: t as TeamDef };
}
