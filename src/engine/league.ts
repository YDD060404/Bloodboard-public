/**
 * V5.5: the League Play pre-game steps that come before the match (rulebook pp.91, 94):
 *
 *  - Team Value (TV, p.91): the Current Value of every player (Team Roster cost + the value of their advancements,
 *    p.97) plus the cost of the Team Re-rolls and Sideline Staff. Dedicated Fans and the Treasury are not included.
 *  - Current Team Value (CTV, p.91): TV minus the players who cannot play the next game — with the Journeymen who
 *    step in counted (p.94).
 *  - Take on Journeymen (p.94): a team that cannot field 11 players takes Linemen (a 0-16 Lineman position of its
 *    roster) with Loner (4+) for this game, up to 11 able to play.
 *  - Inducements (p.94): the team with the higher CTV may first spend Treasury gold on Inducements; the other then
 *    receives Petty Cash = the CTV difference + what the first team spent, and may add up to 50,000 gp of its own
 *    Treasury. Petty Cash not spent is lost. Equal CTVs: no Treasury may be spent.
 *
 * Everything bought is for this match only: the match copy of the team carries the Inducements and the hired Star
 * Players / Mercenaries (marked `temporary`) and a `preMatch` record; the saved League team never does. After the
 * match only the Treasury gold actually spent is taken from the saved team.
 */
import { advancementValue } from './advancement';
import { INDUCEMENTS, INDUCEMENT_BY_ID, inducementCost, MERCENARY } from './inducements';
import { ROSTER_BY_ID, findPosition } from './rosters';
import { STAR_BY_ID, STARS, starChoiceKey, starChoices, starPlaysFor, starsCost, starSupported, playsForText, STAR_MAX } from './stars';
import { draftTemplate, playerFromRoster, playerFromStar, teamLeague, teamSpecialRules, type TeamDef, type TeamPlayerDef } from './teams';

export const LEAGUE_RULES = { tv: { page: 91, title: 'Team Value' }, journeymen: { page: 94, title: 'Take on Journeymen' }, inducements: { page: 94, title: 'Inducements (League Play)' } } as const;

/** Most Treasury gold the team with the lower CTV may add to its Petty Cash (p.94). */
export const PETTY_CASH_TOP_UP = 50_000;

/** Current Value of a saved League player: roster cost + advancements (p.97). Hired / temporary players count at their cost. */
export function playerValue(t: TeamDef, p: TeamPlayerDef): number {
  if (p.star) return 0; // Star Players are Inducements, not part of the Team Value
  const r = t.rosterId ? ROSTER_BY_ID[t.rosterId] : undefined;
  const base = findPosition(r, p.positionId)?.cost ?? 0;
  return base + advancementValue(p);
}

/** Team Value (p.91): players + Team Re-rolls + Sideline Staff (not Dedicated Fans or the Treasury). */
export function teamValue(t: TeamDef): number {
  const r = t.rosterId ? ROSTER_BY_ID[t.rosterId] : undefined;
  const T = draftTemplate(t);
  const players = t.players.filter((p) => !p.temporary).reduce((a, p) => a + playerValue(t, p), 0);
  const rerolls = (r?.rerollCost ?? 0) * t.rerolls;
  const staff = (t.apothecary ? T.apothecaryCost : 0) + t.assistantCoaches * T.assistantCost + t.cheerleaders * T.cheerleaderCost;
  return players + rerolls + staff;
}

/** The Journeymen a League team takes on for the next match (p.94): up to 11 players able to play. */
export function journeymenFor(t: TeamDef): TeamPlayerDef[] {
  const r = t.rosterId ? ROSTER_BY_ID[t.rosterId] : undefined;
  if (!r || t.kind !== 'league') return [];
  const able = t.players.filter((p) => !p.unavailable && !p.temporary).length;
  const need = Math.max(0, 11 - able);
  if (!need) return [];
  const pos = r.positions.find((x) => x.keywords.includes('Lineman') && x.qty === '0-16') ?? r.positions.find((x) => x.qty === '0-16');
  if (!pos) return [];
  const used = new Set(t.players.map((p) => p.number));
  const out: TeamPlayerDef[] = [];
  for (let i = 0; i < need; i++) {
    let n = 1;
    while (used.has(n)) n++;
    used.add(n);
    const p = playerFromRoster(r, pos.id, n, `${t.id}-journeyman-${i + 1}`);
    p.skills = [...p.skills.filter((k) => k.id !== 'loner'), { id: 'loner', value: 4 }];
    p.name = `Journeyman ${pos.name}`;
    p.temporary = true;
    p.journeyman = true;
    out.push(p);
  }
  return out;
}

/** Current Team Value (p.91) for the next match, Journeymen included (p.94). */
export function currentTeamValue(t: TeamDef): number {
  const unavailable = t.players.filter((p) => p.unavailable && !p.temporary).reduce((a, p) => a + playerValue(t, p), 0);
  const journeymen = journeymenFor(t).reduce((a, p) => a + playerValue(t, p), 0);
  return teamValue(t) - unavailable + journeymen;
}

export interface PreMatchFunds {
  ctv: { A: number; B: number };
  /** The team with the higher CTV (spends Treasury first), or null when equal. */
  higher: 'A' | 'B' | null;
  /** Gold each team may spend: the higher team its whole Treasury; the lower team Petty Cash + up to 50,000 gp of Treasury. */
  funds: { A: { pettyCash: number; treasuryMax: number }; B: { pettyCash: number; treasuryMax: number } };
}

/**
 * Pre-match funds (p.94). `spentByHigher`: Treasury gold the higher-CTV team spent first — it is added to the other
 * team's Petty Cash.
 */
export function preMatchFunds(a: TeamDef, b: TeamDef, spentByHigher = 0): PreMatchFunds {
  const ctv = { A: currentTeamValue(a), B: currentTeamValue(b) };
  const tre = { A: Math.max(0, a.treasury ?? 0), B: Math.max(0, b.treasury ?? 0) };
  if (ctv.A === ctv.B) return { ctv, higher: null, funds: { A: { pettyCash: 0, treasuryMax: 0 }, B: { pettyCash: 0, treasuryMax: 0 } } };
  const higher: 'A' | 'B' = ctv.A > ctv.B ? 'A' : 'B';
  const lower: 'A' | 'B' = higher === 'A' ? 'B' : 'A';
  const diff = Math.abs(ctv.A - ctv.B);
  const funds = { A: { pettyCash: 0, treasuryMax: 0 }, B: { pettyCash: 0, treasuryMax: 0 } };
  funds[higher] = { pettyCash: 0, treasuryMax: tre[higher] };
  funds[lower] = { pettyCash: diff + Math.max(0, spentByHigher), treasuryMax: Math.min(PETTY_CASH_TOP_UP, tre[lower]) };
  return { ctv, higher, funds };
}

/** A League team's purchases for one match. */
export interface PreMatchPurchase {
  inducements: Record<string, number>;
  stars: string[];
}

/** Cost of a purchase for this team (Star Player pairs paid once). */
export function purchaseCost(t: TeamDef, buy: PreMatchPurchase): number {
  const r = t.rosterId ? ROSTER_BY_ID[t.rosterId] : undefined;
  const players = buy.stars.map((id) => ({ star: id }));
  return inducementCost(buy.inducements, teamSpecialRules(t), r) + starsCost(players);
}

/** Why Star Player `id` cannot be hired by this League team for the match, or null. */
export function leagueStarReason(t: TeamDef, buy: PreMatchPurchase, id: string, available: number): string | null {
  const st = STAR_BY_ID[id];
  if (!st) return 'Unknown Star Player.';
  if (!starSupported(id)) return `Their special rule "${st.rule.name}" is not implemented yet.`;
  if (!starPlaysFor(st, teamLeague(t), teamSpecialRules(t))) return `Plays for ${playsForText(st)}.`;
  if (buy.stars.includes(id)) return 'Already hired.';
  const all = [...buy.stars.map((x) => ({ star: x })), { star: id }];
  if (starChoices(all) > STAR_MAX) return `At most ${STAR_MAX} Star Players (a pair counts as one, p.148).`;
  const extra = st.pair && !buy.stars.includes(st.pair) ? 2 : 1;
  const onTeam = t.players.filter((p) => !p.unavailable).length + journeymenFor(t).length + buy.stars.length;
  if (onTeam + extra > 16) return 'No room: a team may never have more than 16 players (p.148).';
  const fee = starsCost(all) - starsCost(buy.stars.map((x) => ({ star: x })));
  if (fee > available) return `Costs ${fee.toLocaleString('en-GB')} gp — ${Math.max(0, available).toLocaleString('en-GB')} gp left to spend.`;
  return null;
}

/** Star Players this team may hire for the match: every one that plays for it, with the reason when not possible. */
export function leagueStarOptions(t: TeamDef, buy: PreMatchPurchase, available: number): Array<{ id: string; name: string; cost: number; pair?: string; reason: string | null }> {
  const league = teamLeague(t);
  const rules = teamSpecialRules(t);
  return STARS.filter((st) => starPlaysFor(st, league, rules)).map((st) => ({ id: st.id, name: st.name, cost: st.cost, pair: st.pair, reason: leagueStarReason(t, buy, st.id, available) }));
}

/** Inducements this team may buy (with their price, limit and why not). */
export function leagueInducementOptions(t: TeamDef, buy: PreMatchPurchase): Array<{ id: string; name: string; cost: number; max: number; have: number; reason: string | null }> {
  const r = t.rosterId ? ROSTER_BY_ID[t.rosterId] : undefined;
  const rules = teamSpecialRules(t);
  return INDUCEMENTS.map((d) => ({ id: d.id, name: d.name, cost: d.cost(rules, r), max: d.max(rules), have: buy.inducements[d.id] ?? 0, reason: d.unavailable(rules, r) }));
}

/**
 * The match copy of League team `t` with its Journeymen and this purchase: Inducements on the list, hired Star Players
 * marked `temporary`, and the pre-match record (Petty Cash received, Treasury spent). Errors when the purchase does not
 * fit the funds.
 */
export function leagueMatchTeam(t: TeamDef, buy: PreMatchPurchase, funds: { pettyCash: number; treasuryMax: number }, ctv: number): { ok: true; team: TeamDef; treasurySpent: number } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const cost = purchaseCost(t, buy);
  const treasurySpent = Math.max(0, cost - funds.pettyCash);
  if (treasurySpent > funds.treasuryMax) errors.push(`The purchases cost ${cost.toLocaleString('en-GB')} gp: more than the ${funds.pettyCash.toLocaleString('en-GB')} gp Petty Cash${funds.treasuryMax ? ` + ${funds.treasuryMax.toLocaleString('en-GB')} gp of Treasury` : ''} (p.94).`);
  const rules = teamSpecialRules(t);
  const r = t.rosterId ? ROSTER_BY_ID[t.rosterId] : undefined;
  for (const [id, k] of Object.entries(buy.inducements)) {
    if (!k) continue;
    const d = INDUCEMENT_BY_ID[id];
    if (!d) errors.push(`Unknown Inducement "${id}".`);
    else if (d.unavailable(rules, r)) errors.push(`${d.name}: ${d.unavailable(rules, r)} (p.${d.page}).`);
    else if (k > d.max(rules)) errors.push(`${k} × ${d.name}: at most ${d.max(rules)} (p.${d.page}).`);
  }
  for (const id of buy.stars) {
    const st = STAR_BY_ID[id];
    if (!st) errors.push(`Unknown Star Player "${id}".`);
    else if (st.pair && !buy.stars.includes(st.pair)) errors.push(`${st.name} must be hired together with ${STAR_BY_ID[st.pair]?.name ?? st.pair} (p.${st.page}).`);
    else if (!starPlaysFor(st, teamLeague(t), rules)) errors.push(`${st.name} plays for ${playsForText(st)} — not for this team.`);
  }
  if (starChoices(buy.stars.map((x) => ({ star: x }))) > STAR_MAX) errors.push(`At most ${STAR_MAX} Star Players (p.148).`);
  if (errors.length) return { ok: false, errors };
  const team: TeamDef = JSON.parse(JSON.stringify(t));
  team.players.push(...journeymenFor(t));
  const used = new Set(team.players.map((p) => p.number));
  let k = 0;
  for (const id of buy.stars) {
    let n = 1;
    while (used.has(n)) n++;
    used.add(n);
    const p = playerFromStar(id, n, `${t.id}-star-${id}-${k++}`);
    p.temporary = true;
    team.players.push(p);
  }
  team.inducements = Object.fromEntries(Object.entries(buy.inducements).filter(([, v]) => v > 0));
  team.preMatch = { ctv, pettyCash: funds.pettyCash, treasurySpent };
  void starChoiceKey;
  void MERCENARY;
  return { ok: true, team, treasurySpent };
}

/**
 * A simple pre-match choice for a computer-coached League team: the best Star Player that plays for it and fits the
 * money (the strongest by cost), then useful Inducements (Bribes, a Wandering Apothecary, Prayers, Kegs) with the rest.
 */
export function computerPreMatch(t: TeamDef, funds: { pettyCash: number; treasuryMax: number }): PreMatchPurchase {
  const buy: PreMatchPurchase = { inducements: {}, stars: [] };
  let money = funds.pettyCash; // the computer keeps its Treasury
  if (money <= 0) return buy;
  const stars = leagueStarOptions(t, buy, money)
    .filter((o) => !o.reason && !o.pair)
    .sort((x, y) => y.cost - x.cost);
  if (stars[0]) {
    buy.stars.push(stars[0].id);
    money -= stars[0].cost;
  }
  const want = ['wanderingApothecary', 'bribe', 'blitzersBestKeg', 'prayer', 'extraTraining', 'partTimeCoach', 'tempCheerleader'];
  for (let pass = 0; pass < 3; pass++)
    for (const id of want) {
      const o = leagueInducementOptions(t, buy).find((x) => x.id === id);
      if (!o || o.reason || o.have >= o.max || o.cost > money) continue;
      buy.inducements[id] = o.have + 1;
      money -= o.cost;
    }
  return buy;
}
