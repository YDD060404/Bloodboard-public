/**
 * League player advancement (printed pp.96-97, Skill Table p.121).
 *
 * Pure functions with no randomness of their own: callers pass the dice
 * results (the interface rolls them with a seeded generator, tests pass fixed
 * faces), so every advancement can be reproduced and checked.
 *
 *  - Star Player Points (SPP) are spent on an advancement; its cost depends on
 *    how many advancements the player already has and on the type.
 *  - Skills come from the player's Primary / Secondary categories (Team
 *    Roster). Traits are never learnt. A player can not take a Skill they
 *    already have or one they cannot use because of their other Skills or
 *    Traits (p.97, and the restrictions printed in the Skill descriptions).
 *  - Characteristic improvement: D8 on the Characteristic Improvement Table,
 *    never more than twice per characteristic nor past the maximum (p.37); the
 *    coach may take a chosen Primary or Secondary Skill instead (SPP still spent).
 */
import type { SkillCat } from './rosters';
import { SKILL_BY_ID, type SkillCategory } from './skills';
import type { SkillRef } from './types';

export type { SkillCat };

export const CAT_NAME: Record<SkillCat, SkillCategory> = { A: 'Agility', D: 'Devious', G: 'General', M: 'Mutation', P: 'Passing', S: 'Strength' };
export const ALL_CATS: SkillCat[] = ['A', 'D', 'G', 'M', 'P', 'S'];

/**
 * Skill Table (p.121). Index 0-5: first D6 1-3, second D6 1-6; index 6-11:
 * first D6 4-6, second D6 1-6.
 */
export const SKILL_TABLE: Record<SkillCat, string[]> = {
  A: ['catch', 'divingCatch', 'divingTackle', 'dodge', 'defensive', 'hitAndRun', 'jumpUp', 'leap', 'safePairOfHands', 'sidestep', 'sprint', 'sureFeet'],
  D: ['dirtyPlayer', 'eyeGouge', 'fumblerooski', 'lethalFlight', 'loneFouler', 'pileDriver', 'putTheBootIn', 'quickFoul', 'saboteur', 'shadowing', 'sneakyGit', 'violentInnovator'],
  G: ['block', 'dauntless', 'fend', 'frenzy', 'kick', 'pro', 'steadyFooting', 'stripBall', 'sureHands', 'tackle', 'taunt', 'wrestle'],
  M: ['bigHand', 'claws', 'disturbingPresence', 'extraArms', 'foulAppearance', 'horns', 'ironHardSkin', 'monstrousMouth', 'prehensileTail', 'tentacles', 'twoHeads', 'veryLongLegs'],
  P: ['accurate', 'cannoneer', 'cloudBurster', 'dumpOff', 'giveAndGo', 'hailMaryPass', 'leader', 'nervesOfSteel', 'onTheBall', 'pass', 'punt', 'safePass'],
  S: ['armBar', 'brawler', 'breakTackle', 'bullseye', 'grab', 'guard', 'juggernaut', 'mightyBlow', 'multipleBlock', 'standFirm', 'strongArm', 'thickSkull'],
};

/** Elite Skills (marked on the Skill Table, p.121): +10,000 gp player value (p.97). */
export const ELITE_SKILLS = ['block', 'dodge', 'guard', 'mightyBlow'];

export type AdvKind = 'randomPrimary' | 'primary' | 'secondary' | 'characteristic';
export type CharKey = 'ma' | 'st' | 'ag' | 'pa' | 'av';

/** Advancement Table (p.97): SPP cost by the number of advancements already taken. */
export const ADVANCEMENT_COSTS: Record<AdvKind, number[]> = {
  randomPrimary: [3, 4, 6, 8, 10, 15],
  primary: [6, 8, 12, 16, 20, 30],
  secondary: [10, 12, 16, 20, 24, 34],
  characteristic: [14, 16, 20, 24, 28, 38],
};
export const ADVANCEMENT_TITLES = ['Experienced', 'Veteran', 'Emerging Star', 'Star', 'Superstar', 'Legend'];
export const MAX_ADVANCEMENTS = 6;
export const ADV_KIND_LABEL: Record<AdvKind, string> = {
  randomPrimary: 'Randomly select a Primary Skill',
  primary: 'Choose a Primary Skill',
  secondary: 'Choose a Secondary Skill',
  characteristic: 'Characteristic Improvement',
};

/** Value Increase Table (p.97). */
export const VALUE_INCREASE = { primary: 20000, secondary: 40000, elite: 10000, av: 10000, ma: 20000, pa: 20000, ag: 30000, st: 60000 } as const;

/** Characteristic limits (p.37). AG / PA / AV are target numbers: "improve" lowers AG and PA, raises AV. */
export const CHAR_MAX: Record<CharKey, number> = { ma: 9, st: 8, ag: 1, pa: 1, av: 11 };
export const CHAR_MIN: Record<CharKey, number> = { ma: 1, st: 1, ag: 6, pa: 6, av: 3 };
export const CHAR_LABEL: Record<CharKey, string> = { ma: 'MA', st: 'ST', ag: 'AG', pa: 'PA', av: 'AV' };

/** Characteristic Improvement Table (p.97), D8 → characteristics the coach may improve. */
export const CHAR_TABLE: Record<number, CharKey[]> = {
  1: ['av'],
  2: ['av', 'pa'],
  3: ['av', 'ma', 'pa'],
  4: ['av', 'ma', 'pa'],
  5: ['ma', 'pa'],
  6: ['ag', 'ma'],
  7: ['ag', 'st'],
  8: ['ma', 'st', 'ag', 'pa', 'av'],
};

export interface AdvancementRecord {
  kind: AdvKind;
  /** Skill gained (skill advancements, or a characteristic roll replaced by a chosen skill). */
  skill?: string;
  /** Category the skill came from. */
  cat?: SkillCat;
  /** Characteristic improved. */
  char?: CharKey;
  /** SPP spent. */
  spp: number;
  /** Player value increase in gold pieces. */
  value: number;
  /** Dice rolled for a random skill ([first D6, second D6] pairs) or the D8 of a characteristic roll. */
  rolls?: number[][];
}

/** The part of a player profile advancement reads and changes. */
export interface AdvancingPlayer {
  ma: number;
  st: number;
  ag: number;
  pa: number | null;
  av: number;
  skills: SkillRef[];
  primary?: SkillCat[];
  secondary?: SkillCat[];
  spp?: number;
  advancements?: AdvancementRecord[];
}

/** Skill from the Skill Table for two D6 results (p.121). */
export function skillFromTable(cat: SkillCat, first: number, second: number): string {
  const half = first <= 3 ? 0 : 6;
  return SKILL_TABLE[cat][half + second - 1];
}

/** Category of a learnable skill (null for Traits and unknown ids). */
export function skillCategory(id: string): SkillCat | null {
  for (const c of ALL_CATS) if (SKILL_TABLE[c].includes(id)) return c;
  return null;
}

const has = (p: { skills: SkillRef[] }, id: string) => p.skills.some((s) => s.id === id);

/** Traits that let a player perform a Special Action (Violent Innovator, p.138). */
export const SPECIAL_ACTION_TRAITS = ['ballAndChain', 'bombardier', 'breatheFire', 'chainsaw', 'hypnoticGaze', 'kickTeamMate', 'projectileVomit', 'stab'];

/** Skills a Ball & Chain player cannot have (p.124). */
export const BALL_AND_CHAIN_EXCLUDES = ['divingTackle', 'eyeGouge', 'frenzy', 'grab', 'hitAndRun', 'leap', 'multipleBlock', 'onTheBall', 'shadowing', 'steadyFooting'];

/**
 * Skills a player with No Ball (p.132: never has possession, cannot Catch,
 * Pick Up or Intercept) or My Ball (p.132: may not give up the ball, no Pass
 * or Hand-off Actions) could never use. Interpretation of "one they are unable
 * to use due to their other Skills" (p.97); see docs/RULES_COVERAGE.md.
 */
export const NO_BALL_UNUSABLE = ['catch', 'divingCatch', 'safePairOfHands', 'sureHands', 'bigHand', 'extraArms', 'accurate', 'cannoneer', 'cloudBurster', 'dumpOff', 'giveAndGo', 'hailMaryPass', 'nervesOfSteel', 'pass', 'punt', 'safePass', 'fumblerooski'];
export const MY_BALL_UNUSABLE = ['accurate', 'cannoneer', 'cloudBurster', 'dumpOff', 'giveAndGo', 'hailMaryPass', 'pass', 'punt', 'safePass', 'fumblerooski'];

/**
 * Why the player can not have this skill (null = allowed): already has it, or
 * the rules of the skill / the player's other Skills and Traits exclude it.
 */
export function skillRestriction(p: { skills: SkillRef[] }, id: string): string | null {
  const def = SKILL_BY_ID[id];
  if (!def) return 'Unknown skill.';
  if (has(p, id)) return 'Already has this skill.';
  const name = (x: string) => SKILL_BY_ID[x]?.name ?? x;
  // Prerequisites printed in the skill descriptions.
  if ((id === 'bullseye' || id === 'strongArm') && !has(p, 'throwTeamMate')) return `${def.name} needs the Throw Team-mate Trait (p.${def.page}).`;
  if (id === 'lethalFlight' && !has(p, 'rightStuff')) return 'Lethal Flight needs the Right Stuff Trait (p.130).';
  if (id === 'saboteur' && !has(p, 'secretWeapon')) return 'Saboteur needs the Secret Weapon Trait (p.135).';
  if (id === 'violentInnovator' && !SPECIAL_ACTION_TRAITS.some((t) => has(p, t))) return 'Violent Innovator needs a Trait that allows a Special Action (p.138).';
  // Mutually exclusive skills.
  const pairs: Array<[string, string[]]> = [
    ['frenzy', ['grab', 'hitAndRun', 'multipleBlock']],
    ['leap', ['pogo']],
  ];
  for (const [a, bs] of pairs) {
    if (id === a) {
      const clash = bs.find((b) => has(p, b));
      if (clash) return `${def.name} cannot be taken by a player with ${name(clash)} (p.${def.page}).`;
    }
    if (bs.includes(id) && has(p, a)) return `${def.name} cannot be taken by a player with ${name(a)} (p.${SKILL_BY_ID[a].page}).`;
  }
  if (has(p, 'ballAndChain') && BALL_AND_CHAIN_EXCLUDES.includes(id)) return `A Ball & Chain player cannot have ${def.name} (p.124).`;
  if (has(p, 'noBall') && NO_BALL_UNUSABLE.includes(id)) return `No Ball (p.132): this player could never use ${def.name}.`;
  if (has(p, 'myBall') && MY_BALL_UNUSABLE.includes(id)) return `My Ball (p.132): this player could never use ${def.name}.`;
  return null;
}

/** Skills of a category this player may take (Skill Table order). */
export function eligibleSkills(p: { skills: SkillRef[] }, cat: SkillCat): string[] {
  return SKILL_TABLE[cat].filter((id) => !skillRestriction(p, id));
}

export function advancementCount(p: AdvancingPlayer): number {
  return p.advancements?.length ?? 0;
}

/** SPP cost of the player's next advancement of this kind, or null after the sixth (Legend). */
export function advancementCost(p: AdvancingPlayer, kind: AdvKind): number | null {
  const n = advancementCount(p);
  if (n >= MAX_ADVANCEMENTS) return null;
  return ADVANCEMENT_COSTS[kind][n];
}

/** Times a characteristic has been improved by advancements. */
export function timesImproved(p: AdvancingPlayer, c: CharKey): number {
  return (p.advancements ?? []).filter((a) => a.char === c).length;
}

/** Why this characteristic cannot be improved (null = allowed). */
export function charRestriction(p: AdvancingPlayer, c: CharKey): string | null {
  if (timesImproved(p, c) >= 2) return `${CHAR_LABEL[c]} has already been improved twice (p.37).`;
  const v = p[c];
  if (v === null) return 'PA "-" cannot be improved.';
  if (c === 'ag' || c === 'pa') {
    if (v <= CHAR_MAX[c]) return `${CHAR_LABEL[c]} is already at its best (${CHAR_MAX[c]}+, p.37).`;
  } else if (v >= CHAR_MAX[c]) return `${CHAR_LABEL[c]} is already at its maximum (${CHAR_MAX[c]}${c === 'av' ? '+' : ''}, p.37).`;
  return null;
}

/** Characteristics allowed by a D8 roll on the Characteristic Improvement Table. */
export function charOptions(p: AdvancingPlayer, d8: number): CharKey[] {
  return (CHAR_TABLE[d8] ?? []).filter((c) => !charRestriction(p, c));
}

/** Why the player cannot take an advancement of this kind at all (null = allowed). */
export function advancementBlocked(p: AdvancingPlayer, kind: AdvKind): string | null {
  const cost = advancementCost(p, kind);
  if (cost === null) return 'A Legend (six advancements) cannot advance further (p.97).';
  if ((p.spp ?? 0) < cost) return `Needs ${cost} SPP (has ${p.spp ?? 0}).`;
  const cats = kind === 'secondary' ? p.secondary ?? [] : kind === 'characteristic' ? ALL_CATS : p.primary ?? [];
  if (kind !== 'characteristic') {
    if (!cats.length) return kind === 'secondary' ? 'This player has no Secondary skill categories.' : 'This player has no Primary skill categories.';
    if (!cats.some((c) => eligibleSkills(p, c).length)) return 'No skill in these categories can be taken.';
  }
  return null;
}

/** Must the player take an advancement before the next game? (enough SPP for a Characteristic Improvement, p.97) */
export function mustAdvance(p: AdvancingPlayer): boolean {
  const c = advancementCost(p, 'characteristic');
  return c !== null && (p.spp ?? 0) >= c;
}

/**
 * Random Primary Skill (p.97): two pairs of D6 on the chosen category; a skill
 * the player already has or cannot use is re-rolled. `d6` supplies the dice.
 * Returns the rolls made and the (one or two) skills the coach chooses from.
 */
export function rollRandomSkill(p: AdvancingPlayer, cat: SkillCat, d6: () => number): { rolls: number[][]; choices: string[] } {
  if (!eligibleSkills(p, cat).length) return { rolls: [], choices: [] };
  const rolls: number[][] = [];
  const pick = (): string => {
    for (let guard = 0; guard < 500; guard++) {
      const a = d6();
      const b = d6();
      rolls.push([a, b]);
      const id = skillFromTable(cat, a, b);
      if (!skillRestriction(p, id)) return id;
    }
    throw new Error('Random skill: no eligible result');
  };
  const first = pick();
  const second = pick();
  return { rolls, choices: first === second ? [first] : [first, second] };
}

function valueForSkill(kind: 'primary' | 'secondary', id: string): number {
  return VALUE_INCREASE[kind] + (ELITE_SKILLS.includes(id) ? VALUE_INCREASE.elite : 0);
}

export type AdvancementChoice =
  | { kind: 'randomPrimary'; cat: SkillCat; skill: string; rolls: number[][] }
  | { kind: 'primary' | 'secondary'; cat: SkillCat; skill: string }
  | { kind: 'characteristic'; d8: number; char: CharKey }
  | { kind: 'characteristic'; d8: number; skill: string; cat: SkillCat; as: 'primary' | 'secondary' };

/**
 * Check an advancement and return the updated player (a copy) with the SPP
 * spent, the skill or characteristic added and the record appended. Throws
 * with the rule reference when the advancement is not allowed.
 */
export function applyAdvancement<T extends AdvancingPlayer>(p: T, ch: AdvancementChoice): T {
  const why = advancementBlocked(p, ch.kind);
  if (why) throw new Error(why);
  const cost = advancementCost(p, ch.kind) as number;
  const out: T = { ...p, skills: p.skills.map((s) => ({ ...s })), advancements: [...(p.advancements ?? [])] };
  const rec: AdvancementRecord = { kind: ch.kind, spp: cost, value: 0 };
  const addSkill = (id: string, cat: SkillCat, from: 'primary' | 'secondary') => {
    const cats = from === 'primary' ? p.primary ?? [] : p.secondary ?? [];
    if (!cats.includes(cat)) throw new Error(`${CAT_NAME[cat]} is not one of this player's ${from === 'primary' ? 'Primary' : 'Secondary'} categories.`);
    if (!SKILL_TABLE[cat].includes(id)) throw new Error(`${SKILL_BY_ID[id]?.name ?? id} is not ${/^[AEIOU]/.test(CAT_NAME[cat]) ? 'an' : 'a'} ${CAT_NAME[cat]} skill (p.121).`);
    const r = skillRestriction(p, id);
    if (r) throw new Error(r);
    out.skills.push({ id });
    rec.skill = id;
    rec.cat = cat;
    rec.value = valueForSkill(from, id);
  };
  if (ch.kind === 'randomPrimary') {
    // The two results the coach chooses from: the first two rolls that give a skill the player may take
    // (a skill they have or cannot use is rolled again, p.97) — wherever those re-rolls happened.
    const allowed = ch.rolls
      .map(([a, b]) => skillFromTable(ch.cat, a, b))
      .filter((id) => !skillRestriction(p, id))
      .slice(0, 2);
    if (!allowed.includes(ch.skill)) throw new Error('The skill must be one of the two randomly rolled skills (p.97).');
    addSkill(ch.skill, ch.cat, 'primary');
    rec.rolls = ch.rolls.map((r) => r.slice());
  } else if (ch.kind === 'primary' || ch.kind === 'secondary') {
    addSkill(ch.skill, ch.cat, ch.kind);
  } else {
    const cc = ch as Extract<AdvancementChoice, { kind: 'characteristic' }>;
    rec.rolls = [[cc.d8]];
    if ('char' in cc) {
      const ch = cc;
      if (!charOptions(p, ch.d8).includes(ch.char)) throw new Error(`A D8 roll of ${ch.d8} does not allow improving ${CHAR_LABEL[ch.char]} (or it cannot be improved further).`);
      const c = ch.char;
      if (c === 'ag' || c === 'pa') (out as AdvancingPlayer)[c] = ((p[c] as number) - 1) as never;
      else (out as AdvancingPlayer)[c] = (p[c] as number) + 1;
      rec.char = c;
      rec.value = VALUE_INCREASE[c];
    } else addSkill(cc.skill, cc.cat, cc.as);
  }
  out.spp = (p.spp ?? 0) - cost;
  out.advancements = [...(p.advancements ?? []), rec];
  return out;
}

/** Player value increase from all advancements (gold pieces). */
export function advancementValue(p: AdvancingPlayer): number {
  return (p.advancements ?? []).reduce((a, r) => a + r.value, 0);
}

// ---------------------------------------------------------------------------
// Earning Star Player Points (p.96)
// ---------------------------------------------------------------------------

export const SPP_AWARD = { completion: 1, ttm: 1, landing: 1, interception: 2, casualty: 2, touchdown: 3, mvp: 4 } as const;
export type SppKind = keyof typeof SPP_AWARD;
/** Brawlin' Brutes (p.154): 3 SPP for a Casualty and 2 SPP for a Touchdown. */
export const BRAWLIN_BRUTES_PAGE = 154;
export function sppAward(kind: SppKind, specialRules?: readonly string[]): number {
  if (specialRules?.includes("Brawlin' Brutes")) {
    if (kind === 'casualty') return 3;
    if (kind === 'touchdown') return 2;
  }
  return SPP_AWARD[kind];
}
export const SPP_LABEL: Record<SppKind, string> = { completion: 'Completion', ttm: 'Superb Throw Team-mate', landing: 'Landed safely', interception: 'Interception', casualty: 'Casualty', touchdown: 'Touchdown', mvp: 'Most Valuable Player' };
