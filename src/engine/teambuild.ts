/**
 * V5.5: building ready-made teams — the computer's teams and the "ready-made" choice of the match set-up — for any
 * roster, format and budget, and spending a Tournament team's Skill Points.
 *
 * buildTeam: a heuristic value for each roster position (Strength, Agility, Movement, Armour, skills that matter —
 * Block, Dodge, Guard, Mighty Blow, Sure Hands, Catch… — minus the drawbacks of Loner, Bone-head, Really Stupid…),
 * then positions are bought by value above the Lineman for their price, keeping role coverage (a ball handler, a
 * Blitzer, at most the roster's Big Guys), enough money for the minimum number of players, Team Re-rolls (2 for
 * 11-a-side, 1-2 for Sevens) and an Apothecary where allowed. Whatever gold is left goes on more Team Re-rolls, a
 * bench player and Sideline Staff (Matched Play: gold not spent is lost, p.110). The result is always checked with
 * validateTeamDef; the caller falls back to a fixed plan if it is not legal.
 *
 * autoSkills: spends a Tournament team's Skill Points (p.112; Sevens Spike! 22 p.19) — one skill per player, Primary 1
 * / Secondary 2 (Secondary limit by Tier), Elite skills limited — choosing for each player the most useful skill of
 * its categories for its role (Block for Blitzers and Linemen, Dodge for agile players, Sure Hands for the ball
 * handler, Guard / Mighty Blow for strong players…). The choice is ordinary team data, editable in the team builder.
 *
 * These are heuristics for sensible, legal teams, not a claim of optimal team building.
 */
import { ELITE_SKILLS, skillCategory, skillRestriction } from './advancement';
import { MATCHED, type Tier } from './matched';
import { ROSTER_BY_ID, type Roster, type RosterPosition, type SkillCat } from './rosters';
import { SKILL_BY_ID } from './skills';
import { DRAFT_TEMPLATE, groupRoom, hasTeamCaptainRule, newTeamDef, playerCategories, playerFromRoster, SEVENS_DRAFT, setCaptain, setVeteran, teamBudget, teamCost, teamSkillPoints, validateTeamDef, type TeamDef, type TeamPlayerDef } from './teams';

const has = (p: { skills: Array<{ id: string }> }, id: string) => p.skills.some((k) => k.id === id);

/** Heuristic worth of a roster position (Lineman ≈ 40). */
export function positionValue(p: Pick<RosterPosition, 'ma' | 'st' | 'ag' | 'pa' | 'av' | 'skills' | 'keywords'>): number {
  let v = 40;
  v += 11 * (p.st - 3) + (p.st >= 5 ? 4 : 0);
  v += 3 * (p.ma - 6);
  v += 6 * (3 - p.ag);
  v += 2.5 * (p.av - 9);
  if (p.pa !== null && p.pa <= 3) v += 2;
  const S: Record<string, number> = {
    block: 11, dodge: 8, guard: 8, mightyBlow: 6, sureHands: 5, catch: 5, pass: 3, tackle: 4, frenzy: 3, claws: 6, juggernaut: 3, standFirm: 4,
    thickSkull: 2, sprint: 2, sureFeet: 2, horns: 3, wrestle: 5, sidestep: 5, jumpUp: 2, leader: 3, accurate: 2, strongArm: 1, stripBall: 3,
    divingTackle: 2, grab: 3, breakTackle: 2, multipleBlock: 2, defensive: 3, fend: 2, dauntless: 3, disturbingPresence: 3, foulAppearance: 3,
    extraArms: 2, twoHeads: 3, bigHand: 2, prehensileTail: 2, tentacles: 3, ironHardSkin: 3, regeneration: 4, kick: 2, stab: 3, hypnoticGaze: 3,
    safePairOfHands: 1, steadyFooting: 2, pro: 3, brawler: 3, armBar: 1, shadowing: 2, dirtyPlayer: 1, sneakyGit: 1, onTheBall: 2, nervesOfSteel: 1,
    // drawbacks
    loner: -7, boneHead: -8, reallyStupid: -12, wildAnimal: -8, animalSavagery: -8, unchannelledFury: -7, stunty: -5, decay: -4,
    insignificant: -3, noBall: -6, secretWeapon: -12, takeRoot: -5, titchy: 1, rightStuff: 0, alwaysHungry: -1, throwTeamMate: 2, bloodlust: -4, plagueRidden: 1,
  };
  for (const k of p.skills) v += S[k.id] ?? 1;
  return v;
}

function lineman(r: Roster): RosterPosition {
  return r.positions.find((p) => p.keywords.includes('Lineman') && /-1[26]$/.test(p.qty)) ?? r.positions.find((p) => p.keywords.includes('Lineman')) ?? r.positions.reduce((a, b) => (b.cost < a.cost ? b : a));
}

export interface BuildOptions {
  format: 'standard' | 'sevens';
  play: 'tournament' | 'exhibition';
  /** Team Draft Budget (default: the format's usual one). */
  budget?: number;
  budgetCustom?: boolean;
  tier?: Tier;
  /** Spend the Tournament Skill Points (default true). */
  skills?: boolean;
  id: string;
  name?: string;
}

/** A legal ready-made team for this roster, format and budget (null if the roster cannot be drafted this way). */
export function buildTeam(rosterId: string, o: BuildOptions): TeamDef | null {
  const r = ROSTER_BY_ID[rosterId];
  if (!r) return null;
  const sevens = o.format === 'sevens';
  const t = newTeamDef('tournament', rosterId, o.name ?? `${r.name}${sevens ? ' Sevens' : ''}`, o.id, sevens ? 'sevens' : undefined);
  t.play = o.play;
  if (o.play === 'tournament') {
    t.dedicatedFans = 0;
    if (o.tier) t.tier = o.tier;
  }
  if (o.budget) {
    t.budget = o.budget;
    if (o.budgetCustom) t.budgetCustom = true;
  }
  if (r.leagues.length > 1) t.league = r.leagues[0];
  if (r.favouredOf) t.favoured = r.favouredOf.includes('Undivided') ? 'Undivided' : r.favouredOf[0];
  const budget = teamBudget(t);
  const line = lineman(r);
  const minPlayers = sevens ? SEVENS_DRAFT.minPlayers : DRAFT_TEMPLATE.minPlayers;
  const maxNonLine = sevens ? SEVENS_DRAFT.maxNonLineman : 99;
  const rrCost = sevens ? SEVENS_DRAFT.rerollCost : r.rerollCost;
  const baseRR = sevens ? 1 : 2;
  // 11-a-side keeps money for an Apothecary; in Sevens (80,000 gp, Spike! 22 p.9) players come first.
  const apoCost = r.apothecary && !sevens ? 50_000 : 0;
  // Insignificant Linemen (Snotlings): no more of them than other players.
  const insigLine = line.skills.some((k) => k.id === 'insignificant');
  let n = 1;
  const add = (pos: RosterPosition) => t.players.push(playerFromRoster(r, pos.id, n, `${o.id}-${n++}`));
  const count = (id: string) => t.players.filter((p) => p.positionId === id).length;
  const spent = () => teamCost(t).total;
  const reserve = (players: number) => players * line.cost + baseRR * rrCost + apoCost;
  // 1. positionals by value above the Lineman per 10,000 gp, while the minimum team still fits.
  const cands = r.positions.filter((p) => p.id !== line.id);
  const lv = positionValue(line);
  for (let guard = 0; guard < 40; guard++) {
    const nonLine = t.players.filter((p) => !p.keywords.includes('Lineman')).length;
    const need = Math.max(0, minPlayers - t.players.length - 1);
    let best: { pos: RosterPosition; score: number } | null = null;
    for (const pos of cands) {
      const max = Number(pos.qty.split('-')[1]);
      if (count(pos.id) >= max || groupRoom(t, pos.id) <= 0) continue;
      if (!pos.keywords.includes('Lineman') && nonLine >= maxNonLine) continue;
      if (spent() + pos.cost + reserve(need) > budget) continue;
      const gain = positionValue(pos) - lv;
      if (gain <= 2) continue;
      // Big Guys: one is usually enough in Sevens; diminishing returns for more of the same position.
      const big = pos.keywords.includes('Big Guy');
      const dup = count(pos.id);
      let score = gain / Math.max(1, (pos.cost - line.cost * 0.6) / 10_000);
      score *= Math.pow(0.8, dup);
      if (big && sevens && t.players.some((p) => p.keywords.includes('Big Guy'))) score *= 0.3;
      // Role coverage: a first ball handler and a first Blitzer are worth more.
      const handler = has(pos, 'sureHands') || has(pos, 'pass') || has(pos, 'catch');
      if (handler && !t.players.some((p) => has(p, 'sureHands') || has(p, 'pass') || has(p, 'catch'))) score *= 1.4;
      if (pos.keywords.includes('Blitzer') && !t.players.some((p) => p.keywords.includes('Blitzer'))) score *= 1.3;
      if (insigLine && sevens) score *= 1.2;
      if (!best || score > best.score) best = { pos, score };
    }
    if (!best) break;
    add(best.pos);
  }
  // 2. Linemen up to the minimum.
  while (t.players.length < minPlayers && spent() + line.cost <= budget) add(line);
  // 3. Team Re-rolls, an Apothecary.
  const fits = (x: Partial<TeamDef>) => teamCost({ ...t, ...x }).total <= budget;
  while (t.rerolls < baseRR && fits({ rerolls: t.rerolls + 1 })) t.rerolls += 1;
  if (r.apothecary && fits({ apothecary: true })) t.apothecary = true;
  // 4. The rest: a third Team Re-roll, a bench player (11-a-side: a 12th), then more re-rolls and staff.
  if (!sevens) {
    if (fits({ rerolls: t.rerolls + 1 })) t.rerolls += 1;
    if (t.players.length < 12 && spent() + line.cost <= budget) add(line);
  } else if (t.players.length < 8 && spent() + line.cost <= budget) add(line);
  const maxRR = sevens ? SEVENS_DRAFT.maxRerolls : DRAFT_TEMPLATE.maxRerolls;
  while (t.rerolls < Math.min(maxRR, sevens ? 3 : 4) && fits({ rerolls: t.rerolls + 1 })) t.rerolls += 1;
  const T = sevens ? SEVENS_DRAFT : DRAFT_TEMPLATE;
  if (o.play === 'tournament') {
    // Matched Play: gold not spent is lost — Dedicated Fans (from 0), Assistant Coaches, Cheerleaders.
    const maxFans = sevens ? SEVENS_DRAFT.maxFans : DRAFT_TEMPLATE.maxFans;
    for (let g = 0; g < 30; g++) {
      if (t.assistantCoaches < T.maxAssistants && fits({ assistantCoaches: t.assistantCoaches + 1 })) t.assistantCoaches += 1;
      else if (t.dedicatedFans < maxFans && fits({ dedicatedFans: t.dedicatedFans + 1 })) t.dedicatedFans += 1;
      else if (t.cheerleaders < T.maxCheerleaders && fits({ cheerleaders: t.cheerleaders + 1 })) t.cheerleaders += 1;
      else break;
    }
  } else {
    // A larger budget buys depth: bench players (up to 13 in 11-a-side, 9 in Sevens), then Sideline Staff.
    while (t.players.length < (sevens ? 9 : 13) && spent() + line.cost <= budget && count(line.id) < Number(line.qty.split('-')[1]) && groupRoom(t, line.id) > 0) add(line);
    while (t.assistantCoaches < Math.min(2, T.maxAssistants) && fits({ assistantCoaches: t.assistantCoaches + 1 })) t.assistantCoaches += 1;
    while (t.cheerleaders < Math.min(2, T.maxCheerleaders) && fits({ cheerleaders: t.cheerleaders + 1 })) t.cheerleaders += 1;
  }
  if (sevens) {
    const vet = t.players.find((p) => p.keywords.includes('Lineman'));
    if (vet) setVeteran(t, vet.id);
  }
  if (hasTeamCaptainRule(t)) {
    const c = t.players.find((p) => p.keywords.includes('Blitzer')) ?? t.players.find((p) => !p.keywords.includes('Big Guy'));
    if (c) setCaptain(t, c.id);
  }
  // Numbers: Linemen last, so the default formation fields the others first.
  t.players.sort((a, b) => Number(a.keywords.includes('Lineman')) - Number(b.keywords.includes('Lineman')));
  t.players.forEach((p, i) => (p.number = i + 1));
  if (o.play === 'tournament' && t.tier && o.skills !== false) autoSkills(t);
  t.updatedAt = new Date().toISOString();
  return validateTeamDef(t).some((i) => i.level === 'error') ? null : t;
}

/** How useful skill `id` is for player `p` (0 = not worth buying). */
export function skillWorth(p: TeamPlayerDef, id: string): number {
  if (has(p, id)) return 0;
  const big = p.keywords.includes('Big Guy');
  const agile = p.ag <= 3 && p.ma >= 6;
  const handler = has(p, 'pass') || has(p, 'catch') || p.keywords.includes('Thrower') || p.keywords.includes('Catcher') || p.keywords.includes('Runner');
  const blitzer = p.keywords.includes('Blitzer');
  const strong = p.st >= 4;
  const hasBlock = has(p, 'block');
  const hasDodge = has(p, 'dodge');
  const drawback = has(p, 'noBall') || has(p, 'secretWeapon');
  const W: Record<string, number> = {
    block: hasBlock ? 0 : blitzer ? 16 : big ? 11 : 13,
    dodge: hasDodge ? 0 : agile ? (handler ? 13 : 10) : 5,
    guard: strong ? 11 : p.st >= 3 ? 6 : 1,
    mightyBlow: strong ? (hasBlock ? 10 : 7) : blitzer && hasBlock ? 6 : 2,
    sureHands: handler && !drawback ? 12 : 2,
    wrestle: hasBlock ? 0 : 7,
    tackle: blitzer ? 7 : 3,
    sidestep: agile ? (hasDodge ? 8 : 6) : 3,
    standFirm: big ? 8 : 3,
    stripBall: blitzer && hasBlock ? 7 : 2,
    catch: p.keywords.includes('Catcher') || has(p, 'sureHands') ? 7 : 2,
    fend: agile ? 4 : 2,
    sureFeet: p.ma >= 7 ? 5 : 2,
    sprint: p.ma >= 7 ? 4 : 1,
    diving: 0,
    divingTackle: agile ? 4 : 2,
    jumpUp: big ? 3 : 2,
    juggernaut: blitzer ? 5 : 2,
    grab: strong && hasBlock ? 6 : 2,
    brawler: strong ? 5 : 2,
    thickSkull: 3,
    pro: 3,
    leader: handler ? 5 : 1,
    accurate: has(p, 'pass') ? 5 : 1,
    nervesOfSteel: has(p, 'pass') ? 3 : 1,
    dauntless: p.st <= 3 && blitzer ? 5 : 2,
    frenzy: blitzer && hasBlock ? 3 : 1,
    claws: strong ? 7 : 5,
    horns: blitzer ? 4 : 2,
    kick: 3,
    defensive: 4,
    steadyFooting: 3,
    armBar: 2,
    breakTackle: strong ? 4 : 2,
    safePairOfHands: 2,
    extraArms: handler ? 5 : 1,
    twoHeads: agile ? 5 : 2,
    bigHand: handler ? 3 : 1,
    disturbingPresence: 3,
    foulAppearance: 3,
    ironHardSkin: 3,
    tentacles: 3,
    prehensileTail: 3,
  };
  return W[id] ?? 0;
}

/**
 * Spend a Tournament team's Skill Points (Primary 1, Secondary 2 within the Tier's limit, one skill per player, Elite
 * skills within the limit) on the most useful skills. Clears previous purchases unless `keep`. Returns the team.
 */
export function autoSkills(t: TeamDef, keep = false): TeamDef {
  if (!t.tier) return t;
  const F = MATCHED[t.variant === 'sevens' ? 'sevens' : 'standard'];
  if (!keep) for (const p of t.players) delete p.boughtSkill;
  const tier = t.tier;
  for (let guard = 0; guard < 16; guard++) {
    const u = teamSkillPoints(t);
    const left = u.allowance - u.spent;
    if (left <= 0) break;
    let best: { p: TeamPlayerDef; id: string; cost: number; score: number } | null = null;
    for (const p of t.players) {
      if (p.star || p.boughtSkill) continue;
      const cats = playerCategories(t, p);
      for (const cat of [...cats.primary, ...cats.secondary] as SkillCat[]) {
        const secondary = !cats.primary.includes(cat);
        const cost = secondary ? 2 : 1;
        if (cost > left) continue;
        if (secondary && u.secondary >= F.secondaryMax[tier]) continue;
        for (const id of Object.keys(SKILL_BY_ID)) {
          if (skillCategory(id) !== cat) continue;
          if (ELITE_SKILLS.includes(id) && (t.variant === 'sevens' ? u.elite : (u.eliteBySkill[id] ?? 0)) >= F.eliteMax) continue;
          if (skillRestriction(p, id)) continue;
          const w = skillWorth(p, id);
          if (w <= 0) continue;
          // A Secondary skill must be clearly better than the Primary options to be worth 2 points.
          const score = secondary ? w / 1.7 : w;
          if (!best || score > best.score) best = { p, id, cost, score };
        }
      }
    }
    if (!best || best.score < 3) break;
    best.p.boughtSkill = best.id;
  }
  return t;
}
