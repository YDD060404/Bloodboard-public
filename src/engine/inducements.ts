/**
 * Inducements (rulebook pp.141-149), V5 step 3.
 *
 * In Exhibition (and Matched) Play, Inducements are bought on the Team Draft List out of the Team
 * Draft Budget (pp.110, 116) — so in Bloodboard they are part of a Tournament / Exhibition team and
 * count towards its budget. League Play buys them in the pre-match step with Petty Cash and the
 * Treasury (p.94, V5.5 league.ts).
 *
 * V5.5: Blood Bowl Sevens has its own, shorter list with its own prices (Spike! Journal 22 p.14): Temp Agency
 * Cheerleaders, Part-Time Assistant Coaches, Blitzer's Best Kegs, Prayers to Nuffle (the Sevens D8 table, p.15),
 * Extra Team Training, Bribes, a Wandering Apothecary, Mortuary Assistant, Plague Doctor, Halfling Master Chef and
 * the Sevens-only Desperate Measures (D8 table, p.15, desperate.ts). Everything else (Team Mascot, Weather Mage,
 * Riotous Rookies, Biased Referee, Infamous Coaching Staff, Mercenaries, Star Players, Wizards) is not on the Sevens
 * list — a rules restriction, not missing work. `inducementsFor(variant)` gives the list of a format.
 *
 * Implemented in play: Part-time Assistant Coaches, Temp Agency Cheerleaders, Team Mascot, Weather
 * Mage, Blitzer's Best Kegs, Bribes, Extra Team Training, Mortuary Assistant, Plague Doctor, Riotous
 * Rookies, Wandering Apothecary, Halfling Master Chef, Biased Referee (Dodgy League Rep), Infamous
 * Coaching Staff (Josef Bugman) and Mercenary Players (players on the Team Draft List, see teams.ts).
 * Prayers to Nuffle (step 4, prayers.ts), Star Players (step 5, stars.ts) and the Sports-Wizard (step 6, wizard.ts).
 */
import type { Roster } from './rosters';
import type { GameState, TeamId } from './types';

export interface InducementDef {
  id: string;
  name: string;
  /** Printed page. */
  page: number;
  /** Most a team may take (it can depend on the team's special rules). */
  max: (rules: readonly string[]) => number;
  /** Cost in gold pieces for this team. */
  cost: (rules: readonly string[], roster?: Roster) => number;
  /** Why the team cannot take it, or null. */
  unavailable: (rules: readonly string[], roster?: Roster) => string | null;
  /** One-line summary shown in the team builder. */
  summary: string;
}

const any = () => null;
const bc = (rules: readonly string[]) => rules.includes('Bribery and Corruption');

export const INDUCEMENTS: InducementDef[] = [
  { id: 'prayer', name: 'Prayer to Nuffle', page: 142, max: () => 3, cost: () => 10000, unavailable: any, summary: 'A D16 each on the Prayers to Nuffle table (p.143) in the pre-game (no result twice); lasts for the game.' },
  { id: 'partTimeCoach', name: 'Part-time Assistant Coach', page: 144, max: () => 5, cost: () => 20000, unavailable: any, summary: '+1 Assistant Coach for the game each (Brilliant Coaching).' },
  { id: 'tempCheerleader', name: 'Temp Agency Cheerleader', page: 144, max: () => 5, cost: () => 5000, unavailable: any, summary: '+1 Cheerleader for the game each (Cheering Fans).' },
  { id: 'teamMascot', name: 'Team Mascot', page: 144, max: () => 1, cost: () => 25000, unavailable: any, summary: 'An extra Team Re-roll each half — roll a D6 before using it: 1-3 it is lost for the half. Re-roll a natural 1 for Cheering Fans.' },
  { id: 'weatherMage', name: 'Weather Mage', page: 144, max: () => 1, cost: () => 25000, unavailable: any, summary: 'Once per game, at the start of one of your Turns: roll on the Weather Table with a modifier from −2 to +2.' },
  { id: 'blitzersBestKeg', name: "Blitzer's Best Keg", page: 144, max: () => 2, cost: () => 50000, unavailable: any, summary: '+1 to each roll to recover a Knocked-out player, per Keg.' },
  { id: 'bribe', name: 'Bribe', page: 144, max: (r) => (bc(r) ? 6 : 3), cost: (r) => (bc(r) ? 50000 : 100000), unavailable: any, summary: 'When a player is Sent-off (after Argue the Call): D6 2+ and the player stays, no Turnover. 0-6 at 50,000 gp for Bribery and Corruption teams.' },
  { id: 'extraTraining', name: 'Extra Team Training', page: 145, max: () => 8, cost: () => 100000, unavailable: any, summary: '+1 Team Re-roll for the game each (replenished at half-time like the others).' },
  {
    id: 'mortuaryAssistant',
    name: 'Mortuary Assistant',
    page: 145,
    max: () => 1,
    cost: () => 100000,
    unavailable: (r) => (r.includes('Masters of Undeath') ? null : 'only for teams with Masters of Undeath'),
    summary: 'Once per game: re-roll a failed Regeneration roll.',
  },
  {
    id: 'plagueDoctor',
    name: 'Plague Doctor',
    page: 145,
    max: () => 1,
    cost: () => 100000,
    unavailable: (r) => (r.includes('Favoured of Nurgle') ? null : 'only for teams Favoured of Nurgle'),
    summary: 'Once per game: re-roll a failed Regeneration roll, or use it as an Apothecary.',
  },
  {
    id: 'riotousRookies',
    name: 'Riotous Rookies',
    page: 145,
    max: () => 1,
    cost: () => 150000,
    unavailable: (r) => (r.includes('Low Cost Linemen') ? null : 'only for teams with Low Cost Linemen'),
    summary: '2D3+1 Journeymen (roster Linemen with Loner (4+)) join the team for this game.',
  },
  {
    id: 'wanderingApothecary',
    name: 'Wandering Apothecary',
    page: 146,
    max: () => 2,
    cost: () => 100000,
    unavailable: (_r, ro) => (ro && !ro.apothecary ? 'not for teams that cannot hire an Apothecary' : null),
    summary: 'Once per game each: use it like the team’s Apothecary.',
  },
  { id: 'halflingMasterChef', name: 'Halfling Master Chef', page: 146, max: () => 1, cost: (_r, ro) => (ro?.id === 'halfling' ? 100000 : 300000), unavailable: any, summary: 'At the start of each half roll 3D6: each 4+ gives you a Team Re-roll for the half and takes one from the opponent. 100,000 gp for Halfling teams.' },
  { id: 'biasedReferee', name: 'Biased Referee: Dodgy League Rep', page: 146, max: () => 1, cost: (r) => (bc(r) ? 80000 : 120000), unavailable: any, summary: 'Close Scrutiny: after an opposition Foul that is not Sent-off, D6 5+ sends the fouler off. "I didn’t see a thing": +1 to Argue the Call (a natural 1 still ejects the coach). 80,000 gp for Bribery and Corruption teams.' },
  { id: 'wizard', name: 'Wizard: Sports-Wizard', page: 149, max: () => 1, cost: () => 150000, unavailable: any, summary: 'Once per game, at the end of any Turn before the next begins: Fireball (a square: everyone in or next to it is hit on a 4+ — Knocked Down, +1 Armour) or Zap! (a player: D6 ≥ ST or a 6 turns them into a Frog until the end of the Drive).' },
  { id: 'josefBugman', name: 'Infamous Coaching Staff: Josef Bugman', page: 147, max: () => 1, cost: () => 100000, unavailable: any, summary: "Bugman's XXXXXX: +1 to recover Knocked-out players. Dwarfen Wisdom: once per game, after the set-ups and before the kick-off, set up D3 of your players again." },
];

/** Desperate Measures (Blood Bowl Sevens only, Spike! 22 pp.14-15): a D8 each on their table (no result twice), each usable once per game. */
export const DESPERATE_MEASURE: InducementDef = {
  id: 'desperateMeasure',
  name: 'Desperate Measure',
  page: 15,
  max: () => 5,
  cost: () => 50000,
  unavailable: any,
  summary: 'Sevens only: a D8 each on the Desperate Measures table in the pre-game (duplicates re-rolled) — You Dope!, Razzle-Dazzle, Hangover, Grudge Match, Set Piece, Sports Espionage, Discarded Banana Skin, Magic Scroll; each once per game.',
};

export const INDUCEMENT_BY_ID: Record<string, InducementDef> = Object.fromEntries([...INDUCEMENTS, DESPERATE_MEASURE].map((d) => [d.id, d]));

/** Printed page of the Sevens Inducement list (Spike! Journal 22). */
export const SEVENS_INDUCEMENT_PAGE = 14;

/** The Blood Bowl Sevens list (Spike! 22 p.14): the Inducements it keeps, with the Sevens limits and prices. */
const SEVENS_LIST: Record<string, { max: InducementDef['max']; cost: InducementDef['cost']; page?: number; summary?: string }> = {
  tempCheerleader: { max: () => 2, cost: () => 15000 },
  partTimeCoach: { max: () => 2, cost: () => 15000 },
  blitzersBestKeg: { max: () => 2, cost: () => 50000 },
  prayer: { max: () => 2, cost: () => 5000, page: 15, summary: 'A D8 each on the Sevens Prayers to Nuffle table (Spike! 22 p.15) in the pre-game (no result twice); lasts for the game.' },
  extraTraining: { max: () => 6, cost: () => 125000 },
  bribe: { max: () => 2, cost: (r) => (bc(r) ? 50000 : 100000), summary: 'When a player is Sent-off (after Argue the Call): D6 2+ and the player stays, no Turnover. 0-2 in Sevens (50,000 gp each for Bribery and Corruption teams).' },
  wanderingApothecary: { max: () => 1, cost: () => 100000, summary: 'Once per game: use it like an Apothecary — in Sevens it patches up a Knocked-out player (there is no Casualty Roll to repeat).' },
  mortuaryAssistant: { max: () => 1, cost: () => 100000 },
  plagueDoctor: { max: () => 1, cost: () => 100000 },
  halflingMasterChef: { max: () => 1, cost: (_r, ro) => (ro?.id === 'halfling' ? 100000 : 300000) },
};

/** The Inducements a team of this format may buy (Sevens: the Spike! 22 list with its limits and prices). */
export function inducementsFor(variant: 'standard' | 'sevens' | undefined): InducementDef[] {
  if (variant !== 'sevens') return INDUCEMENTS;
  const out: InducementDef[] = [];
  for (const d of INDUCEMENTS) {
    const o = SEVENS_LIST[d.id];
    if (!o) continue;
    out.push({ ...d, max: o.max, cost: o.cost, page: o.page ?? SEVENS_INDUCEMENT_PAGE, summary: o.summary ?? d.summary });
  }
  out.push(DESPERATE_MEASURE);
  return out;
}

/** One Inducement as a team of this format buys it (undefined: not on that format's list). */
export function inducementFor(id: string, variant: 'standard' | 'sevens' | undefined): InducementDef | undefined {
  return inducementsFor(variant).find((d) => d.id === id);
}

/**
 * What a format's list does not offer, and why — a rules restriction (the item is not on that list) or unfinished
 * work (none at present: every Inducement of both lists is implemented).
 */
export function inducementsNotOffered(variant: 'standard' | 'sevens' | undefined): Array<{ name: string; why: string; kind: 'rules' | 'unfinished' }> {
  if (variant !== 'sevens')
    return [
      { name: 'Desperate Measures', why: 'Blood Bowl Sevens only (Spike! 22 p.15).', kind: 'rules' },
      { name: 'Other named Biased Referees, Infamous Coaching Staff and Wizards', why: 'The rulebook gives only the Dodgy League Rep, Josef Bugman and the Sports-Wizard (pp.146-149); the others are in other publications, not supplied.', kind: 'rules' },
    ];
  const std = INDUCEMENTS.filter((d) => !SEVENS_LIST[d.id]).map((d) => ({ name: d.name, why: 'Not on the Blood Bowl Sevens Inducement list (Spike! 22 p.14).', kind: 'rules' as const }));
  return [
    ...std,
    { name: 'Mercenary Players', why: 'Not on the Blood Bowl Sevens Inducement list (Spike! 22 p.14).', kind: 'rules' },
    { name: 'Star Players', why: 'Not on the Blood Bowl Sevens Inducement list (Spike! 22 p.14) — the All-Star Match (Exhibition) is the custom variant with Star Players.', kind: 'rules' },
  ];
}

/** Mercenary Players (p.147): +30,000 gp over the roster cost, Loner (4+); one Primary skill for +50,000 gp; at most three. */
export const MERCENARY = { page: 147, extra: 30000, skillCost: 50000, max: 3 } as const;

/** Inducement lines of a team: id → count (0 dropped). */
export type InducementList = Record<string, number>;

export function inducementCost(list: InducementList | undefined, rules: readonly string[], roster?: Roster, variant?: 'standard' | 'sevens'): number {
  let n = 0;
  for (const [id, k] of Object.entries(list ?? {})) {
    const d = variant === 'sevens' ? inducementFor(id, 'sevens') ?? INDUCEMENT_BY_ID[id] : INDUCEMENT_BY_ID[id];
    if (d && k > 0) n += d.cost(rules, roster) * k;
  }
  return n;
}

// ---------------------------------------------------------------------------
// In a match
// ---------------------------------------------------------------------------


/** How many of Inducement `id` team bought for this match (0 outside matches). */
export function induced(s: GameState, team: TeamId, id: string): number {
  return s.match?.inducements?.[team]?.[id] ?? 0;
}

/** How many uses of a once-per-game Inducement `id` the team has left. */
export function induceLeft(s: GameState, team: TeamId, id: string): number {
  return Math.max(0, induced(s, team, id) - (s.teams[team].induceUsed?.[id] ?? 0));
}

export function spendInduce(s: GameState, team: TeamId, id: string): void {
  const t = s.teams[team];
  t.induceUsed = { ...(t.induceUsed ?? {}), [id]: (t.induceUsed?.[id] ?? 0) + 1 };
}

export const INDUCE_RULE = (id: string) => ({ page: INDUCEMENT_BY_ID[id]?.page ?? 141, title: INDUCEMENT_BY_ID[id]?.name ?? 'Inducements' });
