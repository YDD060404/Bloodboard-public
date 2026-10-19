/**
 * Tournament play = Matched Play (V5 step 6): Skill Points by Tier, for each format, from the project's rule
 * sources.
 *
 *  - Blood Bowl (11-a-side), rulebook pp.110-113: Tier 1-4 → 6 / 8 / 9 / 10 Skill Points; a Primary skill costs 1, a
 *    Secondary skill 2 (at most 1 / 2 / 3 / 4 Secondary skills by Tier); each player at most ONE extra skill; Elite
 *    skills (Block, Dodge, Guard, Mighty Blow — p.121) at most four times in the roster; Star Players cannot be given
 *    skills. Star Players also cost Skill Points: 2 each (a pair counts once), Mega-stars 4; Tier 1 teams at most one
 *    Star Player; at most one Mega-star. Dedicated Fans start at 0 (p.110). Budget: usually 1,100,000 /
 *    1,150,000 / 1,200,000 gp (p.110). Skills bought do not add to the team's value.
 *  - Blood Bowl Sevens, Spike! Journal 22 pp.18-19: Tier 1-4 → 1 / 2 / 3 / 4 Skill Points; Primary 1, Secondary 2 —
 *    at most ONE Secondary skill for the team; each player at most one extra skill; at most two Elite skills in the
 *    roster. 600,000 gp, Dedicated Fans start at 0 (p.18). (No Star Players in Sevens teams in the app.)
 *  - League teams never use Skill Points (they advance with Star Player Points); Exhibition teams have no purchased
 *    skills by default (Exhibition Play, pp.114-117, drafts like Matched Play but is free to tweak).
 *
 * V5.5: the official Team Tiers and Mega-stars of May 2026 (Games Workshop, "Blood Bowl Team Tiers", published with
 * the May 2026 Designers' Commentary on warhammer-community.com) are built in (OFFICIAL_TIERS, MEGA_STARS). The list
 * is published for Blood Bowl without naming a format; Spike! 22 says Sevens has its own list, which is not in the
 * supplied sources — so Sevens uses the Tiers Spike! 22 states and otherwise suggests the May 2026 Tier, labelled as
 * such. A roster the list does not name (the legacy Slann) has no official Tier: an event-specific Tier must be
 * chosen and is labelled as one. Any other Tier chosen for a roster is an event-specific Tier and is labelled as one (isEventTier).
 */
import { ELITE_SKILLS, skillCategory } from './advancement';
import type { SkillCat } from './rosters';
import type { TeamDef, TeamIssue, TeamPlayerDef } from './teams';

export type Tier = 1 | 2 | 3 | 4;
export const TIERS: Tier[] = [1, 2, 3, 4];

export interface MatchedFormat {
  source: string;
  page: string;
  skillPoints: Record<Tier, number>;
  /** Most Secondary skills the team may buy, by Tier. */
  secondaryMax: Record<Tier, number>;
  eliteMax: number;
  /** Skill Points per Star Player choice (a pair counts once); null = no Star Players in this format. */
  starCost: number | null;
  /** Most Star Player choices by Tier. */
  starsMax: Record<Tier, number>;
  budgets: number[];
  defaultBudget: number;
  /** Dedicated Fans start at 0 in Matched Play (each one bought at the usual price). */
  fansFrom: 0;
}

export const MATCHED: Record<'standard' | 'sevens', MatchedFormat> = {
  standard: {
    source: 'Blood Bowl rulebook, Matched Play',
    page: '110-113',
    skillPoints: { 1: 6, 2: 8, 3: 9, 4: 10 },
    secondaryMax: { 1: 1, 2: 2, 3: 3, 4: 4 },
    eliteMax: 4,
    starCost: 2,
    starsMax: { 1: 1, 2: 2, 3: 2, 4: 2 },
    budgets: [1_100_000, 1_150_000, 1_200_000],
    defaultBudget: 1_100_000,
    fansFrom: 0,
  },
  sevens: {
    source: 'Spike! Journal 22, Blood Bowl Sevens Matched Play',
    page: '18-19',
    skillPoints: { 1: 1, 2: 2, 3: 3, 4: 4 },
    secondaryMax: { 1: 1, 2: 1, 3: 1, 4: 1 },
    eliteMax: 2,
    starCost: null,
    starsMax: { 1: 0, 2: 0, 3: 0, 4: 0 },
    budgets: [600_000],
    defaultBudget: 600_000,
    fansFrom: 0,
  },
};

/** The official Team Tiers, May 2026 (roster ids of the app). */
export const OFFICIAL_TIERS = {
  date: 'May 2026',
  source: 'Blood Bowl Team Tiers, Games Workshop (May 2026)',
  url: 'https://assets.warhammer-community.com/eng_20-05_blood_bowl_teamtiers-rhnqpyom8r-4rpfatdubw.pdf',
  tiers: {
    amazon: 1,
    chaosDwarf: 1,
    darkElf: 1,
    highElf: 1,
    lizardmen: 1,
    norse: 1,
    oldWorldAlliance: 1,
    underworld: 1,
    woodElf: 1,
    bretonnian: 2,
    dwarf: 2,
    elvenUnion: 2,
    human: 2,
    imperialNobility: 2,
    necromantic: 2,
    orc: 2,
    shamblingUndead: 2,
    skaven: 2,
    tombKings: 2,
    vampire: 2,
    blackOrc: 3,
    chaosChosen: 3,
    chaosRenegade: 3,
    khorne: 3,
    nurgle: 3,
    gnome: 4,
    goblin: 4,
    halfling: 4,
    ogre: 4,
    snotling: 4,
  } as Record<string, Tier>,
};

/** Mega-stars (May 2026 list; rulebook p.113): 4 Skill Points instead of 2, at most one per team. */
export const MEGA_STARS: readonly string[] = ['griff', 'hakflem', 'hthark', 'ivan', 'morgNThorg'];
export const MEGA_STAR_COST = 4;
export const isMegaStar = (starId: string | undefined): boolean => !!starId && MEGA_STARS.includes(starId);

export interface TierInfo {
  /** The Tier to use unless an event says otherwise (null: none known — an event Tier must be chosen). */
  tier: Tier | null;
  kind: 'official' | 'source' | 'suggested' | 'none';
  /** Short label for the interface. */
  label: string;
  ref: string;
}

/**
 * The Tier of a roster in a format and where it comes from: 11-a-side — the official May 2026 list; Sevens — the
 * Tier Spike! 22 states, else the May 2026 Tier as a suggestion (no Sevens list in the sources); a roster the list
 * does not name — none.
 */
export function tierInfo(rosterId: string | undefined, format: 'standard' | 'sevens'): TierInfo {
  const off = rosterId ? OFFICIAL_TIERS.tiers[rosterId] : undefined;
  if (format === 'sevens') {
    const src = rosterId ? SOURCE_TIERS.sevens[rosterId] : undefined;
    if (src) return { tier: src.tier, kind: 'source', label: `Tier ${src.tier} (Spike! 22)`, ref: src.ref };
    if (off) return { tier: off, kind: 'suggested', label: `Tier ${off} (May 2026 list — no Sevens list in the sources)`, ref: `${OFFICIAL_TIERS.source}; Spike! 22 p.19 says Sevens has its own list, which is not in the supplied sources.` };
    return { tier: null, kind: 'none', label: 'No official Tier (legacy / custom roster) — choose an event Tier', ref: 'Not on the May 2026 list.' };
  }
  if (off) return { tier: off, kind: 'official', label: `Tier ${off} (official, ${OFFICIAL_TIERS.date})`, ref: OFFICIAL_TIERS.source };
  return { tier: null, kind: 'none', label: 'No official Tier (legacy / custom roster) — choose an event Tier', ref: 'Not on the May 2026 list.' };
}

/** Is `tier` an event-specific Tier for this roster (different from the official / stated one, or none known)? */
export function isEventTier(rosterId: string | undefined, format: 'standard' | 'sevens', tier: Tier | undefined): boolean {
  if (!tier) return false;
  const info = tierInfo(rosterId, format);
  return info.tier !== tier || info.kind === 'none';
}

/** Tiers stated in the project's rule sources (the full lists are in the Designers' Commentary). */
export const SOURCE_TIERS: Record<'standard' | 'sevens', Record<string, { tier: Tier; ref: string }>> = {
  standard: Object.fromEntries(Object.entries(OFFICIAL_TIERS.tiers).map(([id, t]) => [id, { tier: t, ref: `${OFFICIAL_TIERS.source}` }])),
  sevens: {
    norse: { tier: 1, ref: 'Spike! 22 p.26 ("as a Tier 1 team, you only get 1 Skill Point")' },
    goblin: { tier: 4, ref: 'Spike! 22 p.27 ("you have 4 Skill Points to spend")' },
    chaosChosen: { tier: 2, ref: 'Spike! 22 p.29 ("Chaos Chosen are Tier 2")' },
  },
};

export const formatOfTeam = (t: Pick<TeamDef, 'variant'>): 'standard' | 'sevens' => (t.variant === 'sevens' ? 'sevens' : 'standard');
export const matchedFormat = (t: Pick<TeamDef, 'variant'>): MatchedFormat => MATCHED[formatOfTeam(t)];

/** A drafted team built for Tournament play (Matched Play rules and Skill Points). */
export function isTournamentTeam(t: Pick<TeamDef, 'kind' | 'play'>): boolean {
  return t.kind === 'tournament' && t.play === 'tournament';
}

/** The Tier the sources state for this roster in this format, if any. */
export function sourceTier(rosterId: string | undefined, format: 'standard' | 'sevens'): { tier: Tier; ref: string } | undefined {
  return rosterId ? SOURCE_TIERS[format][rosterId] : undefined;
}

/** Skill Points the team receives (0 unless it is a Tournament team with a Tier). */
export function skillPointAllowance(t: TeamDef): number {
  if (!isTournamentTeam(t) || !t.tier) return 0;
  return matchedFormat(t).skillPoints[t.tier];
}

/** Primary or Secondary for this player (their position's categories), or null if they cannot take the skill. */
export function boughtSkillCategory(t: TeamDef, p: TeamPlayerDef, skillId: string, cats: { primary: SkillCat[]; secondary: SkillCat[] }): 'primary' | 'secondary' | null {
  const c = skillCategory(skillId);
  if (!c) return null;
  if (cats.primary.includes(c)) return 'primary';
  if (cats.secondary.includes(c)) return 'secondary';
  void t;
  void p;
  return null;
}

export interface SkillPointUse {
  allowance: number;
  spent: number;
  primary: number;
  secondary: number;
  elite: number;
  /** Purchases of each Elite skill separately (May 2026 FAQ p.112: each individual Elite skill may be bought up to the cap). */
  eliteBySkill: Record<string, number>;
  /** The highest number of purchases of any single Elite skill. */
  eliteMostSame: number;
  /** Skill Points spent on Star Players (2 each, a pair once; Mega-stars 4). */
  stars: number;
  /** Mega-stars on the list (at most one). */
  megaStars: number;
}

/** Star Player choices of a team (a pair counts once) and how many are Mega-stars. */
export function starChoiceSummary(players: ReadonlyArray<{ star?: string }>, pairKey: (id: string) => string): { choices: number; mega: number } {
  const keys = new Map<string, string>();
  for (const p of players) if (p.star) keys.set(pairKey(p.star), p.star);
  let mega = 0;
  for (const id of keys.values()) if (isMegaStar(id)) mega++;
  return { choices: keys.size, mega };
}

/** What the team's purchases cost in Skill Points. `catsOf` gives a player's Primary / Secondary categories. */
export function skillPointUse(t: TeamDef, catsOf: (p: TeamPlayerDef) => { primary: SkillCat[]; secondary: SkillCat[] }, starChoices: number, megaStars = 0): SkillPointUse {
  let primary = 0;
  let secondary = 0;
  let elite = 0;
  const eliteBySkill: Record<string, number> = {};
  for (const p of t.players) {
    if (!p.boughtSkill) continue;
    const cat = boughtSkillCategory(t, p, p.boughtSkill, catsOf(p));
    if (cat === 'secondary') secondary++;
    else primary++;
    if (ELITE_SKILLS.includes(p.boughtSkill)) { elite++; eliteBySkill[p.boughtSkill] = (eliteBySkill[p.boughtSkill] ?? 0) + 1; }
  }
  const F = matchedFormat(t);
  const stars = F.starCost ? (starChoices - megaStars) * F.starCost + megaStars * MEGA_STAR_COST : 0;
  return { allowance: skillPointAllowance(t), spent: primary + secondary * 2 + stars, primary, secondary, elite, eliteBySkill, eliteMostSame: Math.max(0, ...Object.values(eliteBySkill)), stars, megaStars };
}

/** Matched Play checks for a Tournament team (and warnings for purchases on other teams). */
export function matchedIssues(t: TeamDef, catsOf: (p: TeamPlayerDef) => { primary: SkillCat[]; secondary: SkillCat[] }, starChoices: number, skillName: (id: string) => string, out: TeamIssue[], megaStars = 0): void {
  const bought = t.players.filter((p) => p.boughtSkill);
  if (!isTournamentTeam(t)) {
    if (bought.length) out.push({ level: t.kind === 'league' ? 'error' : 'warning', text: t.kind === 'league' ? 'League teams do not buy skills with Skill Points: they advance with Star Player Points (p.97).' : `Exhibition team: the ${bought.length} skill${bought.length === 1 ? '' : 's'} bought with Skill Points ${bought.length === 1 ? 'is' : 'are'} not used (Exhibition matches play without purchased skills).` });
    return;
  }
  const F = matchedFormat(t);
  const pg = t.variant === 'sevens' ? `Spike! 22 p.19` : 'p.112';
  if (!t.tier) {
    out.push({ level: 'error', text: `Choose the team's Tier (1-4): it sets its Skill Points (${pg}). The Tier list is in the Blood Bowl Designers' Commentary.` });
    return;
  }
  const u = skillPointUse(t, catsOf, starChoices, megaStars);
  if (u.spent > u.allowance) out.push({ level: 'error', text: `Skill Points: ${u.spent} spent, but a Tier ${t.tier} team has ${u.allowance} (${pg}).` });
  if (u.secondary > F.secondaryMax[t.tier]) out.push({ level: 'error', text: t.variant === 'sevens' ? `${u.secondary} Secondary skills: a Sevens team may buy only one (${pg}).` : `${u.secondary} Secondary skills: a Tier ${t.tier} team may buy at most ${F.secondaryMax[t.tier]} (${pg}).` });
  if (t.variant === 'sevens') {
    // The May 2026 FAQ (p.112) is a standard-format ruling; the Sevens cap is not derived from it: the existing Sevens limit on total Elite purchases stays.
    if (u.elite > F.eliteMax) out.push({ level: 'error', text: `${u.elite} Elite skills bought (Block, Dodge, Guard, Mighty Blow): at most ${F.eliteMax} in a Sevens Matched Play roster (${pg}).` });
  } else {
    // Standard Matched Play: each individual Elite skill may be taken up to four times; there is no combined cap (FAQ May 2026, p.112).
    for (const [id, n] of Object.entries(u.eliteBySkill)) if (n > F.eliteMax) out.push({ level: 'error', text: `${n} × ${skillName(id)} bought: each individual Elite skill (Block, Dodge, Guard, Mighty Blow) may be bought at most ${F.eliteMax} times in a Matched Play roster (${pg}; FAQ May 2026).` });
  }
  if (F.starCost && starChoices > F.starsMax[t.tier]) out.push({ level: 'error', text: `${starChoices} Star Players: a Tier ${t.tier} team may have at most ${F.starsMax[t.tier]} (p.113).` });
  if (megaStars > 1) out.push({ level: 'error', text: `${megaStars} Mega-stars: a team may only ever have a single Mega-star (p.113; May 2026 list).` });
  if (!F.starCost && starChoices > 0 && !t.allStar) out.push({ level: 'error', text: 'Blood Bowl Sevens Matched Play buys only skills with Skill Points; the Sevens Inducements (Spike! 22 p.16) include no Star Players.' });
  for (const p of bought) {
    const id = p.boughtSkill as string;
    if (p.star) out.push({ level: 'error', text: `#${p.number} ${p.name}: Star Players cannot be given additional skills (p.112).` });
    else if (!boughtSkillCategory(t, p, id, catsOf(p))) out.push({ level: 'error', text: `#${p.number} ${p.name}: ${skillName(id)} is neither a Primary nor a Secondary skill for this player.` });
    if (p.skills.some((k) => k.id === id)) out.push({ level: 'error', text: `#${p.number} ${p.name} already has ${skillName(id)}.` });
  }
}
