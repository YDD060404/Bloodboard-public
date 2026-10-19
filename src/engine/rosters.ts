import type { SkillRef } from './types';

/**
 * Team rosters transcribed from the rulebook's Team Rosters section
 * (printed page numbers given per team): Bretonnian, Tomb Kings, Human, Orc,
 * (V4 build 3) Lizardmen and Norse, and (V5) the other 25 rosters printed on
 * pp.160-190. Any other player can be built with the custom player editor
 * (League teams).
 */
export interface RosterPosition {
  id: string;
  name: string;
  qty: string;
  keywords: string[];
  ma: number;
  st: number;
  ag: number;
  pa: number | null;
  av: number;
  skills: SkillRef[];
  /** Hiring fee in gold pieces (Team Roster, printed pp.162-187). */
  cost: number;
  /** Skill categories for advancements (p.97): A Agility, D Devious, G General, M Mutation, P Passing, S Strength. */
  primary: SkillCat[];
  secondary: SkillCat[];
}

/** Skill category letters used on the Team Rosters (p.97). */
export type SkillCat = 'A' | 'D' | 'G' | 'M' | 'P' | 'S';

export interface Roster {
  id: string;
  name: string;
  page: number;
  rerollCost: number;
  apothecary: boolean;
  color: string;
  accent: string;
  positions: RosterPosition[];
  /**
   * Positions of an earlier printed table that are NO LONGER recruitable (never in `positions`, never offered by a builder or the
   * auto-draft). They exist only so a team or match saved before the change still loads, keeps its value and is explained by the
   * validators instead of silently reinterpreted as a new position.
   */
  retiredPositions?: RosterPosition[];
  /** League(s) the team plays in (p.152). A team with several chooses one when its Team Draft List is created. */
  leagues: string[];
  /** Team special rules (pp.154-155), as printed on the roster. */
  specialRules: string[];
  /** Special rules gained only with one League choice (Norse: Chaos Clash → Favoured of Khorne). */
  leagueRules?: Record<string, string[]>;
  /** "Favoured of (choose …)" (p.154): the alignments a team may choose when drafted; it gains "Favoured of <choice>". */
  favouredOf?: string[];
  /** Limits across positions printed on the roster, e.g. "may have a single Big Guy, chosen from the following". */
  groups?: RosterGroup[];
}

export interface RosterGroup {
  id: string;
  /** At most this many players from `positions` together. */
  max: number;
  positions: string[];
  /** The roster's own words. */
  text: string;
}

/** Leagues (p.152) and team special rules (pp.154-155): printed pages. */
export const LEAGUES_PAGE = 152;
export const SPECIAL_RULES_PAGES = '154-155';

const sk = (...ids: Array<string | [string, number] | [string, string]>): SkillRef[] =>
  ids.map((x) => (Array.isArray(x) ? (typeof x[1] === 'number' ? { id: x[0], value: x[1] } : { id: x[0], keyword: x[1] }) : { id: x }));

export const ROSTERS: Roster[] = [
  {
    id: 'bretonnian',
    name: 'Bretonnian',
    page: 162,
    rerollCost: 60000,
    apothecary: true,
    leagues: ['Old World Classic'],
    specialRules: [],
    color: '#2451b3',
    accent: '#f5d77a',
    positions: [
      { id: 'squire', name: 'Bretonnian Squire', qty: '0-16', keywords: ['Human', 'Lineman'], ma: 6, st: 3, ag: 3, pa: 4, av: 8, skills: sk('wrestle'), cost: 50000, primary: ['G'], secondary: ['A', 'S'] },
      { id: 'knightCatcher', name: 'Bretonnian Knight Catcher', qty: '0-2', keywords: ['Catcher', 'Human'], ma: 7, st: 3, ag: 3, pa: 4, av: 9, skills: sk('catch', 'dauntless', 'nervesOfSteel'), cost: 85000, primary: ['A', 'G'], secondary: ['S'] },
      { id: 'knightThrower', name: 'Bretonnian Knight Thrower', qty: '0-2', keywords: ['Human', 'Thrower'], ma: 6, st: 3, ag: 3, pa: 3, av: 9, skills: sk('dauntless', 'nervesOfSteel', 'pass'), cost: 80000, primary: ['G', 'P'], secondary: ['A', 'S'] },
      { id: 'grailKnight', name: 'Grail Knight', qty: '0-2', keywords: ['Blitzer', 'Human'], ma: 7, st: 3, ag: 3, pa: 4, av: 10, skills: sk('block', 'dauntless', 'steadyFooting'), cost: 95000, primary: ['G', 'S'], secondary: ['A'] },
    ],
  },
  {
    id: 'tombKings',
    name: 'Tomb Kings',
    page: 187,
    rerollCost: 60000,
    apothecary: false,
    leagues: ['Sylvanian Spotlight'],
    specialRules: ['Masters of Undeath'],
    color: '#d9a82e',
    accent: '#1b2a3a',
    positions: [
      { id: 'skeleton', name: 'Skeleton Lineman', qty: '0-16', keywords: ['Human', 'Lineman', 'Skeleton', 'Undead'], ma: 5, st: 3, ag: 4, pa: 6, av: 8, skills: sk('regeneration', 'thickSkull'), cost: 40000, primary: ['G'], secondary: ['A', 'D', 'S'] },
      { id: 'tkThrower', name: 'Tomb Kings Thrower', qty: '0-2', keywords: ['Human', 'Skeleton', 'Thrower', 'Undead'], ma: 6, st: 3, ag: 4, pa: 3, av: 9, skills: sk('pass', 'regeneration', 'sureHands', 'thickSkull'), cost: 65000, primary: ['G', 'P'], secondary: ['A', 'D', 'S'] },
      { id: 'tkBlitzer', name: 'Tomb Kings Blitzer', qty: '0-2', keywords: ['Blitzer', 'Human', 'Skeleton', 'Undead'], ma: 6, st: 3, ag: 4, pa: 5, av: 9, skills: sk('block', 'regeneration', 'thickSkull'), cost: 85000, primary: ['G', 'S'], secondary: ['A', 'D'] },
      { id: 'tombGuardian', name: 'Tomb Guardian', qty: '0-4', keywords: ['Big Guy', 'Blocker', 'Human', 'Undead'], ma: 4, st: 5, ag: 5, pa: 6, av: 10, skills: sk('brawler', 'decay', 'regeneration'), cost: 115000, primary: ['S'], secondary: ['A', 'G'] },
    ],
  },
  {
    id: 'human',
    name: 'Human',
    page: 173,
    rerollCost: 50000,
    apothecary: true,
    leagues: ['Old World Classic'],
    specialRules: ['Team Captain'],
    color: '#f3efe4',
    accent: '#1d3f8f',
    positions: [
      { id: 'lineman', name: 'Human Lineman', qty: '0-16', keywords: ['Human', 'Lineman'], ma: 6, st: 3, ag: 3, pa: 4, av: 9, skills: [], cost: 50000, primary: ['G'], secondary: ['A', 'D', 'S'] },
      { id: 'halfling', name: 'Halfling Hopeful', qty: '0-3', keywords: ['Halfling', 'Lineman'], ma: 5, st: 2, ag: 3, pa: 4, av: 7, skills: sk('dodge', 'rightStuff', 'stunty'), cost: 30000, primary: ['A'], secondary: ['D', 'G', 'S'] },
      { id: 'catcher', name: 'Human Catcher', qty: '0-2', keywords: ['Catcher', 'Human'], ma: 8, st: 3, ag: 3, pa: 4, av: 8, skills: sk('catch', 'dodge'), cost: 75000, primary: ['A', 'G'], secondary: ['D', 'P', 'S'] },
      { id: 'thrower', name: 'Human Thrower', qty: '0-2', keywords: ['Human', 'Thrower'], ma: 6, st: 3, ag: 3, pa: 3, av: 9, skills: sk('pass', 'sureHands'), cost: 75000, primary: ['G', 'P'], secondary: ['A', 'D', 'S'] },
      { id: 'blitzer', name: 'Human Blitzer', qty: '0-2', keywords: ['Blitzer', 'Human'], ma: 7, st: 3, ag: 3, pa: 4, av: 9, skills: sk('block', 'tackle'), cost: 85000, primary: ['G', 'S'], secondary: ['A', 'D'] },
      { id: 'ogre', name: 'Ogre', qty: '0-1', keywords: ['Big Guy', 'Ogre'], ma: 5, st: 5, ag: 4, pa: 5, av: 10, skills: sk('boneHead', ['loner', 3], 'mightyBlow', 'thickSkull', 'throwTeamMate'), cost: 140000, primary: ['S'], secondary: ['A', 'G'] },
    ],
  },
  {
    id: 'orc',
    name: 'Orc',
    page: 182,
    rerollCost: 60000,
    apothecary: true,
    leagues: ['Badlands Brawl'],
    specialRules: ["Brawlin' Brutes", 'Team Captain'],
    color: '#b3261e',
    accent: '#fbe9d0',
    positions: [
      { id: 'lineman', name: 'Orc Lineman', qty: '0-16', keywords: ['Lineman', 'Orc'], ma: 5, st: 3, ag: 3, pa: 4, av: 10, skills: [], cost: 50000, primary: ['G', 'S'], secondary: ['A', 'D'] },
      { id: 'goblin', name: 'Goblin Lineman', qty: '0-4', keywords: ['Goblin', 'Lineman'], ma: 6, st: 2, ag: 3, pa: 4, av: 8, skills: sk('dodge', 'rightStuff', 'stunty'), cost: 40000, primary: ['A', 'D'], secondary: ['G', 'P', 'S'] },
      { id: 'thrower', name: 'Orc Thrower', qty: '0-2', keywords: ['Orc', 'Thrower'], ma: 6, st: 3, ag: 3, pa: 3, av: 9, skills: sk('pass', 'sureHands'), cost: 75000, primary: ['G', 'P'], secondary: ['A', 'D', 'S'] },
      { id: 'blitzer', name: 'Orc Blitzer', qty: '0-2', keywords: ['Blitzer', 'Orc'], ma: 6, st: 3, ag: 3, pa: 4, av: 10, skills: sk('block', 'breakTackle'), cost: 85000, primary: ['G', 'S'], secondary: ['A', 'D'] },
      { id: 'bigUn', name: 'Big Un Blocker', qty: '0-2', keywords: ['Blocker', 'Orc'], ma: 5, st: 4, ag: 4, pa: 6, av: 10, skills: sk('mightyBlow', 'taunt', 'thickSkull', 'unsteady'), cost: 95000, primary: ['G', 'S'], secondary: ['A', 'D'] },
      { id: 'troll', name: 'Troll', qty: '0-1', keywords: ['Big Guy', 'Troll'], ma: 4, st: 5, ag: 5, pa: 5, av: 10, skills: sk('alwaysHungry', ['loner', 4], 'mightyBlow', 'projectileVomit', 'reallyStupid', 'regeneration', 'throwTeamMate'), cost: 115000, primary: ['S'], secondary: ['A', 'G', 'P'] },
    ],
  },
  {
    // Printed p.176. Leagues: Lustrian Superleague. Special rules: none.
    id: 'lizardmen',
    name: 'Lizardmen',
    page: 176,
    rerollCost: 70000,
    apothecary: true,
    leagues: ['Lustrian Superleague'],
    specialRules: [],
    color: '#1f7a55',
    accent: '#f2cf5b',
    positions: [
      { id: 'skink', name: 'Skink Lineman', qty: '0-16', keywords: ['Lineman', 'Lizardman'], ma: 8, st: 2, ag: 3, pa: 4, av: 8, skills: sk('dodge', 'stunty'), cost: 60000, primary: ['A'], secondary: ['G', 'D', 'P', 'S'] },
      { id: 'chameleon', name: 'Chameleon Skink', qty: '0-2', keywords: ['Lizardman', 'Thrower'], ma: 7, st: 2, ag: 3, pa: 3, av: 8, skills: sk('dodge', 'onTheBall', 'shadowing', 'stunty'), cost: 70000, primary: ['A', 'P'], secondary: ['G', 'D', 'S'] },
      { id: 'saurus', name: 'Saurus Blocker', qty: '0-6', keywords: ['Blocker', 'Lizardman'], ma: 6, st: 4, ag: 5, pa: 6, av: 10, skills: sk('juggernaut', 'unsteady'), cost: 90000, primary: ['G', 'S'], secondary: ['A'] },
      { id: 'kroxigor', name: 'Kroxigor', qty: '0-1', keywords: ['Big Guy', 'Lizardman'], ma: 6, st: 5, ag: 5, pa: 6, av: 10, skills: sk('boneHead', ['loner', 4], 'mightyBlow', 'prehensileTail', 'thickSkull'), cost: 140000, primary: ['S'], secondary: ['A', 'G'] },
    ],
  },
  {
    // Printed p.178. Leagues: Chaos Clash or Old World Classic; with Chaos Clash the team gains Favoured of Khorne.
    id: 'norse',
    name: 'Norse',
    page: 178,
    rerollCost: 60000,
    apothecary: true,
    leagues: ['Chaos Clash', 'Old World Classic'],
    specialRules: [],
    leagueRules: { 'Chaos Clash': ['Favoured of Khorne'] },
    color: '#27466b',
    accent: '#e8eef6',
    positions: [
      { id: 'raider', name: 'Norse Raider', qty: '0-16', keywords: ['Human', 'Lineman'], ma: 6, st: 3, ag: 3, pa: 4, av: 8, skills: sk('block', 'drunkard', 'thickSkull', 'unsteady'), cost: 50000, primary: ['G'], secondary: ['A', 'P', 'S'] },
      { id: 'beerBoar', name: 'Beer Boar', qty: '0-2', keywords: ['Animal', 'Special'], ma: 5, st: 1, ag: 3, pa: null, av: 6, skills: sk('dodge', 'noBall', 'pickMeUp', 'stunty', 'titchy'), cost: 20000, primary: [], secondary: ['A'] },
      { id: 'berserker', name: 'Norse Berserker', qty: '0-2', keywords: ['Blitzer', 'Human'], ma: 6, st: 3, ag: 3, pa: 5, av: 8, skills: sk('block', 'frenzy', 'jumpUp'), cost: 90000, primary: ['G', 'S'], secondary: ['A', 'P'] },
      { id: 'valkyrie', name: 'Valkyrie', qty: '0-2', keywords: ['Catcher', 'Human', 'Thrower'], ma: 7, st: 3, ag: 3, pa: 3, av: 8, skills: sk('catch', 'dauntless', 'pass', 'stripBall'), cost: 95000, primary: ['A', 'G', 'P'], secondary: ['S'] },
      { id: 'ulfwerener', name: 'Ulfwerener', qty: '0-2', keywords: ['Blocker', 'Human'], ma: 6, st: 4, ag: 4, pa: 6, av: 9, skills: sk('frenzy', 'unsteady'), cost: 105000, primary: ['G', 'S'], secondary: ['A'] },
      { id: 'yhetee', name: 'Yhetee', qty: '0-1', keywords: ['Big Guy', 'Yhetee'], ma: 5, st: 5, ag: 4, pa: 6, av: 9, skills: sk('claws', 'disturbingPresence', 'frenzy', ['loner', 4], 'unchannelledFury'), cost: 140000, primary: ['S'], secondary: ['A', 'G'] },
    ],
  },
  {
    // V5: printed p.160 (PDF p.162), transcribed from the page image.
    id: 'amazon',
    name: 'Amazon',
    page: 160,
    rerollCost: 60000,
    apothecary: true,
    leagues: ['Lustrian Superleague'],
    specialRules: [],
    color: '#1f7a4d',
    accent: '#f2d16b',
    positions: [
      { id: 'eagleWarrior', name: 'Eagle Warrior', qty: '0-16', keywords: ['Human', 'Lineman'], ma: 6, st: 3, ag: 3, pa: 4, av: 8, skills: sk('dodge'), cost: 50000, primary: ['G'], secondary: ['A', 'S'] },
      { id: 'pythonWarrior', name: 'Python Warrior', qty: '0-2', keywords: ['Human', 'Thrower'], ma: 6, st: 3, ag: 3, pa: 3, av: 8, skills: sk('dodge', 'onTheBall', 'pass', 'safePass'), cost: 80000, primary: ['G', 'P'], secondary: ['A', 'S'] },
      { id: 'piranhaWarrior', name: 'Piranha Warrior', qty: '0-2', keywords: ['Blitzer', 'Human'], ma: 7, st: 3, ag: 3, pa: 4, av: 8, skills: sk('dodge', 'hitAndRun', 'jumpUp'), cost: 90000, primary: ['A', 'G'], secondary: ['S'] },
      { id: 'jaguarWarrior', name: 'Jaguar Warrior', qty: '0-2', keywords: ['Blocker', 'Human'], ma: 6, st: 4, ag: 3, pa: 4, av: 9, skills: sk('defensive', 'dodge'), cost: 110000, primary: ['G', 'S'], secondary: ['A'] },
    ],
  },
  {
    // V5: printed p.161 (PDF p.163), transcribed from the page image.
    id: 'blackOrc',
    name: 'Black Orc',
    page: 161,
    rerollCost: 60000,
    apothecary: true,
    leagues: ['Badlands Brawl'],
    specialRules: ["Brawlin' Brutes", 'Bribery and Corruption'],
    color: '#2b2b2b',
    accent: '#e8b64a',
    positions: [
      { id: 'goblinBruiser', name: 'Goblin Bruiser', qty: '0-16', keywords: ['Goblin', 'Lineman'], ma: 6, st: 2, ag: 3, pa: 4, av: 8, skills: sk('dodge', 'rightStuff', 'stunty', 'thickSkull'), cost: 45000, primary: ['A', 'D'], secondary: ['G', 'P', 'S'] },
      { id: 'blackOrc', name: 'Black Orc', qty: '0-6', keywords: ['Blocker', 'Orc'], ma: 4, st: 4, ag: 4, pa: 5, av: 10, skills: sk('brawler', 'grab'), cost: 90000, primary: ['G', 'S'], secondary: ['A', 'D'] },
      { id: 'trainedTroll', name: 'Trained Troll', qty: '0-1', keywords: ['Big Guy', 'Troll'], ma: 4, st: 5, ag: 5, pa: 5, av: 10, skills: sk('alwaysHungry', 'mightyBlow', 'projectileVomit', 'reallyStupid', 'regeneration', 'throwTeamMate'), cost: 115000, primary: ['S'], secondary: ['A', 'G', 'P'] },
    ],
  },
  {
    // V5: printed p.167 (PDF p.169), transcribed from the page image.
    id: 'dwarf',
    name: 'Dwarf',
    page: 167,
    rerollCost: 60000,
    apothecary: true,
    leagues: ['Worlds Edge Superleague'],
    specialRules: ["Brawlin' Brutes", 'Bribery and Corruption'],
    color: '#2f5d8a',
    accent: '#f0c75e',
    positions: [
      { id: 'lineman', name: 'Dwarf Lineman', qty: '0-16', keywords: ['Dwarf', 'Lineman'], ma: 4, st: 3, ag: 4, pa: 5, av: 10, skills: sk('block', 'defensive', 'thickSkull'), cost: 70000, primary: ['D', 'G'], secondary: ['S'] },
      { id: 'runner', name: 'Dwarf Runner', qty: '0-2', keywords: ['Dwarf', 'Runner'], ma: 6, st: 3, ag: 3, pa: 4, av: 9, skills: sk('sprint', 'sureHands', 'thickSkull'), cost: 80000, primary: ['G', 'P'], secondary: ['A', 'S'] },
      { id: 'blitzer', name: 'Dwarf Blitzer', qty: '0-2', keywords: ['Blitzer', 'Dwarf'], ma: 5, st: 3, ag: 4, pa: 4, av: 10, skills: sk('block', 'divingTackle', 'tackle', 'thickSkull'), cost: 100000, primary: ['G', 'S'], secondary: ['P'] },
      { id: 'trollSlayer', name: 'Troll Slayer', qty: '0-2', keywords: ['Dwarf', 'Special'], ma: 5, st: 3, ag: 4, pa: 5, av: 9, skills: sk('block', 'dauntless', 'frenzy', ['hatred', 'Troll'], 'thickSkull'), cost: 95000, primary: ['G', 'S'], secondary: ['D'] },
      { id: 'deathroller', name: 'Deathroller', qty: '0-1', keywords: ['Big Guy', 'Dwarf', 'Special'], ma: 5, st: 7, ag: 5, pa: null, av: 11, skills: sk('breakTackle', 'dirtyPlayer', 'juggernaut', ['loner', 4], 'mightyBlow', 'noBall', 'secretWeapon', 'standFirm'), cost: 170000, primary: ['D', 'S'], secondary: ['G'] },
    ],
  },
  {
    // V5: printed p.163 (PDF p.165), transcribed from the page image.
    id: 'chaosChosen',
    name: 'Chaos Chosen',
    page: 163,
    rerollCost: 50000,
    apothecary: true,
    leagues: ['Chaos Clash'],
    specialRules: [],
    favouredOf: ['Hashut', 'Khorne', 'Nurgle', 'Slaanesh', 'Tzeentch', 'Undivided'],
    groups: [
      { id: 'bigGuy', max: 1, positions: ['troll', 'ogre', 'minotaur'], text: 'A Chaos Chosen team may have a single Big Guy, chosen from the following' },
    ],
    color: '#5b1a1a',
    accent: '#d9c27a',
    positions: [
      { id: 'beastman', name: 'Beastmen Lineman', qty: '0-16', keywords: ['Beastman', 'Lineman'], ma: 6, st: 3, ag: 3, pa: 3, av: 9, skills: sk('horns', 'thickSkull'), cost: 55000, primary: ['G', 'M'], secondary: ['A', 'D', 'P', 'S'] },
      { id: 'chosen', name: 'Chaos Chosen', qty: '0-4', keywords: ['Blocker', 'Human'], ma: 5, st: 4, ag: 3, pa: 5, av: 10, skills: sk('armBar'), cost: 100000, primary: ['G', 'M', 'S'], secondary: ['A', 'D'] },
      { id: 'troll', name: 'Troll', qty: '0-1', keywords: ['Big Guy', 'Troll'], ma: 4, st: 5, ag: 5, pa: 5, av: 10, skills: sk('alwaysHungry', ['loner', 4], 'mightyBlow', 'projectileVomit', 'reallyStupid', 'regeneration', 'throwTeamMate'), cost: 115000, primary: ['M', 'S'], secondary: ['A', 'G', 'P'] },
      { id: 'ogre', name: 'Ogre', qty: '0-1', keywords: ['Big Guy', 'Ogre'], ma: 5, st: 5, ag: 4, pa: 5, av: 10, skills: sk('boneHead', ['loner', 4], 'mightyBlow', 'thickSkull', 'throwTeamMate'), cost: 140000, primary: ['M', 'S'], secondary: ['A', 'G'] },
      { id: 'minotaur', name: 'Minotaur', qty: '0-1', keywords: ['Big Guy', 'Minotaur'], ma: 5, st: 5, ag: 4, pa: 6, av: 9, skills: sk('frenzy', 'horns', ['loner', 4], 'mightyBlow', 'thickSkull', 'unchannelledFury'), cost: 150000, primary: ['M', 'S'], secondary: ['A', 'G'] },
    ],
  },
  {
    // V5: printed p.164 (PDF p.166), transcribed from the page image.
    id: 'chaosDwarf',
    name: 'Chaos Dwarf',
    page: 164,
    rerollCost: 70000,
    apothecary: true,
    leagues: ['Badlands Brawl', 'Chaos Clash'],
    specialRules: ['Favoured of Hashut'],
    color: '#7a2e12',
    accent: '#e3c16f',
    positions: [
      { id: 'hobgoblin', name: 'Hobgoblin Lineman', qty: '0-16', keywords: ['Goblin', 'Lineman'], ma: 6, st: 3, ag: 3, pa: 4, av: 8, skills: [], cost: 40000, primary: ['D'], secondary: ['A', 'G', 'S'] },
      { id: 'sneakyStabba', name: 'Sneaky Stabba', qty: '0-2', keywords: ['Goblin', 'Special'], ma: 6, st: 3, ag: 3, pa: 5, av: 8, skills: sk('shadowing', 'stab'), cost: 60000, primary: ['D', 'G'], secondary: ['A', 'S'] },
      { id: 'blocker', name: 'Chaos Dwarf Blocker', qty: '0-4', keywords: ['Blocker', 'Dwarf'], ma: 4, st: 3, ag: 4, pa: 6, av: 10, skills: sk('block', 'ironHardSkin', 'thickSkull'), cost: 70000, primary: ['G', 'S'], secondary: ['A', 'D', 'M'] },
      { id: 'flamesmith', name: 'Flamesmith', qty: '0-2', keywords: ['Dwarf', 'Special'], ma: 5, st: 3, ag: 4, pa: 6, av: 10, skills: sk('brawler', 'breatheFire', 'disturbingPresence', 'thickSkull'), cost: 80000, primary: ['G', 'S'], secondary: ['A', 'D', 'M'] },
      { id: 'bullCentaur', name: 'Bull Centaur', qty: '0-2', keywords: ['Blitzer', 'Dwarf'], ma: 6, st: 4, ag: 4, pa: 6, av: 10, skills: sk('sprint', 'sureFeet', 'thickSkull', 'unsteady'), cost: 130000, primary: ['G', 'S'], secondary: ['A', 'D', 'M'] },
      { id: 'minotaur', name: 'Minotaur', qty: '0-1', keywords: ['Big Guy', 'Minotaur'], ma: 5, st: 5, ag: 4, pa: 6, av: 9, skills: sk('frenzy', 'horns', ['loner', 4], 'mightyBlow', 'thickSkull', 'unchannelledFury'), cost: 150000, primary: ['M', 'S'], secondary: ['A', 'G'] },
    ],
  },
  {
    // V5: printed p.165 (PDF p.167), transcribed from the page image.
    id: 'chaosRenegade',
    name: 'Chaos Renegade',
    page: 165,
    rerollCost: 70000,
    apothecary: true,
    leagues: ['Chaos Clash'],
    specialRules: [],
    favouredOf: ['Khorne', 'Nurgle', 'Slaanesh', 'Tzeentch', 'Undivided'],
    groups: [
      { id: 'bigGuy', max: 3, positions: ['troll', 'ogre', 'minotaur', 'ratOgre'], text: 'A Chaos Renegade team may have up to three Big Guy players, chosen from the following' },
    ],
    color: '#4a2d6b',
    accent: '#e6d3a3',
    positions: [
      { id: 'human', name: 'Renegade Human', qty: '0-16', keywords: ['Human', 'Lineman'], ma: 6, st: 3, ag: 3, pa: 4, av: 9, skills: sk(['animosity', 'all']), cost: 50000, primary: ['D', 'G', 'M'], secondary: ['A', 'S'] },
      { id: 'goblin', name: 'Renegade Goblin', qty: '0-1', keywords: ['Goblin', 'Lineman'], ma: 6, st: 2, ag: 3, pa: 4, av: 8, skills: sk(['animosity', 'all'], 'dodge', 'rightStuff', 'stunty'), cost: 40000, primary: ['A', 'D', 'M'], secondary: ['G', 'P'] },
      { id: 'orc', name: 'Renegade Orc', qty: '0-1', keywords: ['Lineman', 'Orc'], ma: 5, st: 3, ag: 3, pa: 4, av: 10, skills: sk(['animosity', 'all']), cost: 50000, primary: ['D', 'G', 'M'], secondary: ['A', 'S'] },
      { id: 'skaven', name: 'Renegade Skaven', qty: '0-1', keywords: ['Lineman', 'Skaven'], ma: 7, st: 3, ag: 3, pa: 4, av: 8, skills: sk(['animosity', 'all']), cost: 50000, primary: ['D', 'G', 'M'], secondary: ['A', 'S'] },
      { id: 'darkElf', name: 'Renegade Dark Elf', qty: '0-1', keywords: ['Elf', 'Lineman'], ma: 6, st: 3, ag: 2, pa: 3, av: 9, skills: sk(['animosity', 'all']), cost: 65000, primary: ['A', 'D', 'G', 'M'], secondary: ['S'] },
      { id: 'thrower', name: 'Renegade Human Thrower', qty: '0-1', keywords: ['Human', 'Thrower'], ma: 6, st: 3, ag: 3, pa: 3, av: 9, skills: sk(['animosity', 'all'], 'pass', 'sureHands'), cost: 75000, primary: ['D', 'G', 'M', 'P'], secondary: ['A', 'S'] },
      { id: 'troll', name: 'Troll', qty: '0-1', keywords: ['Big Guy', 'Troll'], ma: 4, st: 5, ag: 5, pa: 5, av: 10, skills: sk('alwaysHungry', ['loner', 4], 'mightyBlow', 'projectileVomit', 'reallyStupid', 'regeneration', 'throwTeamMate'), cost: 115000, primary: ['S'], secondary: ['A', 'G', 'M', 'P'] },
      { id: 'ogre', name: 'Ogre', qty: '0-1', keywords: ['Big Guy', 'Ogre'], ma: 5, st: 5, ag: 4, pa: 5, av: 10, skills: sk('boneHead', ['loner', 3], 'mightyBlow', 'thickSkull', 'throwTeamMate'), cost: 140000, primary: ['S'], secondary: ['A', 'G', 'M'] },
      { id: 'minotaur', name: 'Minotaur', qty: '0-1', keywords: ['Big Guy', 'Minotaur'], ma: 5, st: 5, ag: 4, pa: 6, av: 9, skills: sk('frenzy', 'horns', ['loner', 4], 'mightyBlow', 'thickSkull', 'unchannelledFury'), cost: 150000, primary: ['S'], secondary: ['A', 'G', 'M'] },
      { id: 'ratOgre', name: 'Rat Ogre', qty: '0-1', keywords: ['Big Guy', 'Skaven'], ma: 6, st: 5, ag: 4, pa: 6, av: 9, skills: sk('animalSavagery', 'frenzy', ['loner', 4], 'mightyBlow', 'prehensileTail'), cost: 150000, primary: ['S'], secondary: ['A', 'G', 'M'] },
    ],
  },
  {
    // V5: printed p.166 (PDF p.168), transcribed from the page image.
    id: 'darkElf',
    name: 'Dark Elf',
    page: 166,
    rerollCost: 50000,
    apothecary: true,
    leagues: ['Elven Kingdoms League'],
    specialRules: [],
    color: '#3b1f5c',
    accent: '#d8c7f0',
    positions: [
      { id: 'lineman', name: 'Dark Elf Lineman', qty: '0-16', keywords: ['Elf', 'Lineman'], ma: 6, st: 3, ag: 2, pa: 3, av: 9, skills: [], cost: 65000, primary: ['A', 'G'], secondary: ['D', 'S'] },
      { id: 'runner', name: 'Dark Elf Runner', qty: '0-2', keywords: ['Elf', 'Runner'], ma: 7, st: 3, ag: 2, pa: 3, av: 8, skills: sk('dumpOff', 'punt'), cost: 80000, primary: ['A', 'G', 'P'], secondary: ['D', 'S'] },
      { id: 'assassin', name: 'Dark Elf Assassin', qty: '0-2', keywords: ['Elf', 'Special'], ma: 7, st: 3, ag: 2, pa: 4, av: 8, skills: sk('hitAndRun', 'shadowing', 'stab'), cost: 90000, primary: ['A', 'D'], secondary: ['G', 'S'] },
      { id: 'blitzer', name: 'Dark Elf Blitzer', qty: '0-2', keywords: ['Blitzer', 'Elf'], ma: 7, st: 3, ag: 2, pa: 3, av: 9, skills: sk('block'), cost: 105000, primary: ['A', 'G'], secondary: ['D', 'P', 'S'] },
      { id: 'witchElf', name: 'Witch Elf', qty: '0-2', keywords: ['Elf', 'Special'], ma: 7, st: 3, ag: 2, pa: 4, av: 8, skills: sk('dodge', 'frenzy', 'jumpUp'), cost: 110000, primary: ['A', 'G'], secondary: ['D', 'S'] },
    ],
  },
  {
    // V5: printed p.168 (PDF p.170), transcribed from the page image.
    id: 'elvenUnion',
    name: 'Elven Union',
    page: 168,
    rerollCost: 50000,
    apothecary: true,
    leagues: ['Elven Kingdoms League'],
    specialRules: [],
    color: '#e8e1c8',
    accent: '#2b4a9b',
    positions: [
      { id: 'lineman', name: 'Elf Lineman', qty: '0-16', keywords: ['Elf', 'Lineman'], ma: 6, st: 3, ag: 2, pa: 3, av: 8, skills: sk('fumblerooski'), cost: 65000, primary: ['A', 'G'], secondary: ['S'] },
      { id: 'thrower', name: 'Elf Thrower', qty: '0-2', keywords: ['Elf', 'Thrower'], ma: 6, st: 3, ag: 2, pa: 2, av: 8, skills: sk('hailMaryPass', 'pass'), cost: 75000, primary: ['A', 'G', 'P'], secondary: ['S'] },
      { id: 'catcher', name: 'Elf Catcher', qty: '0-2', keywords: ['Catcher', 'Elf'], ma: 8, st: 3, ag: 2, pa: 4, av: 8, skills: sk('catch', 'divingCatch', 'nervesOfSteel'), cost: 100000, primary: ['A', 'G'], secondary: ['S'] },
      { id: 'blitzer', name: 'Elf Blitzer', qty: '0-2', keywords: ['Blitzer', 'Elf'], ma: 7, st: 3, ag: 2, pa: 3, av: 9, skills: sk('block', 'sidestep'), cost: 115000, primary: ['A', 'G'], secondary: ['P', 'S'] },
    ],
  },
  {
    // V5: printed p.169 (PDF p.171), transcribed from the page image.
    id: 'gnome',
    name: 'Gnome',
    page: 169,
    rerollCost: 60000,
    apothecary: true,
    leagues: ['Halfling Thimble Cup', 'Woodland League'],
    specialRules: [],
    color: '#6b8f3a',
    accent: '#f4e6c4',
    positions: [
      { id: 'lineman', name: 'Gnome Lineman', qty: '0-16', keywords: ['Gnome', 'Lineman'], ma: 5, st: 2, ag: 3, pa: 4, av: 7, skills: sk('jumpUp', 'rightStuff', 'stunty', 'wrestle'), cost: 40000, primary: ['A'], secondary: ['D', 'G', 'S'] },
      { id: 'woodlandFox', name: 'Woodland Fox', qty: '0-2', keywords: ['Animal', 'Runner'], ma: 7, st: 2, ag: 2, pa: null, av: 6, skills: sk('dodge', 'myBall', 'sidestep', 'stunty'), cost: 50000, primary: [], secondary: ['A'] },
      { id: 'illusionist', name: 'Gnome Illusionist', qty: '0-2', keywords: ['Gnome', 'Special'], ma: 5, st: 2, ag: 3, pa: 3, av: 7, skills: sk('jumpUp', 'stunty', 'trickster', 'wrestle'), cost: 50000, primary: ['A', 'P'], secondary: ['D', 'G'] },
      { id: 'beastmaster', name: 'Gnome Beastmaster', qty: '0-2', keywords: ['Blocker', 'Gnome'], ma: 5, st: 2, ag: 3, pa: 4, av: 8, skills: sk('guard', 'jumpUp', 'stunty', 'wrestle'), cost: 55000, primary: ['A'], secondary: ['D', 'G', 'S'] },
      { id: 'treeman', name: 'Altern Forest Treeman', qty: '0-2', keywords: ['Big Guy', 'Treeman'], ma: 2, st: 6, ag: 5, pa: 5, av: 11, skills: sk('mightyBlow', 'standFirm', 'strongArm', 'takeRoot', 'thickSkull', 'throwTeamMate', 'timmmber'), cost: 120000, primary: ['S'], secondary: ['A', 'G', 'P'] },
    ],
  },
  {
    // V5: printed p.170 (PDF p.172), transcribed from the page image.
    id: 'goblin',
    name: 'Goblin',
    page: 170,
    rerollCost: 60000,
    apothecary: true,
    leagues: ['Badlands Brawl', 'Underworld Challenge'],
    specialRules: ['Bribery and Corruption'],
    color: '#d9b32e',
    accent: '#2a2a2a',
    positions: [
      { id: 'lineman', name: 'Goblin Lineman', qty: '0-16', keywords: ['Goblin', 'Lineman'], ma: 6, st: 2, ag: 3, pa: 4, av: 8, skills: sk('dodge', 'rightStuff', 'stunty'), cost: 40000, primary: ['A', 'D'], secondary: ['G', 'P', 'S'] },
      { id: 'loony', name: 'Loony', qty: '0-1', keywords: ['Goblin', 'Special'], ma: 6, st: 2, ag: 3, pa: null, av: 8, skills: sk('chainsaw', 'noBall', 'secretWeapon', 'stunty'), cost: 40000, primary: ['D'], secondary: ['A', 'G', 'S'] },
      { id: 'bomma', name: 'Bomma', qty: '0-1', keywords: ['Goblin', 'Special'], ma: 6, st: 2, ag: 3, pa: 4, av: 8, skills: sk('bombardier', 'dodge', 'secretWeapon', 'stunty'), cost: 45000, primary: ['D', 'P'], secondary: ['A', 'G', 'S'] },
      { id: 'ooligan', name: 'Ooligan', qty: '0-1', keywords: ['Goblin', 'Special'], ma: 6, st: 2, ag: 3, pa: 5, av: 8, skills: sk('dirtyPlayer', 'disturbingPresence', 'dodge', 'rightStuff', 'stunty', 'taunt'), cost: 60000, primary: ['A', 'D'], secondary: ['G', 'S'] },
      { id: 'doomDiver', name: 'Doom Diver', qty: '0-1', keywords: ['Goblin', 'Special'], ma: 6, st: 2, ag: 3, pa: 6, av: 8, skills: sk('dodge', 'rightStuff', 'stunty', 'swoop'), cost: 65000, primary: ['A'], secondary: ['D', 'G', 'S'] },
      { id: 'fanatic', name: 'Fanatic', qty: '0-1', keywords: ['Goblin', 'Special'], ma: 3, st: 7, ag: 3, pa: null, av: 8, skills: sk('ballAndChain', 'noBall', 'secretWeapon', 'stunty'), cost: 70000, primary: ['D', 'S'], secondary: ['A', 'G'] },
      { id: 'pogoer', name: 'Pogoer', qty: '0-1', keywords: ['Goblin', 'Special'], ma: 7, st: 2, ag: 3, pa: 4, av: 8, skills: sk('dodge', 'pogo', 'stunty'), cost: 75000, primary: ['A'], secondary: ['D', 'G', 'S'] },
      { id: 'trainedTroll', name: 'Trained Troll', qty: '0-2', keywords: ['Big Guy', 'Troll'], ma: 4, st: 5, ag: 5, pa: 5, av: 10, skills: sk('alwaysHungry', 'mightyBlow', 'projectileVomit', 'reallyStupid', 'regeneration', 'throwTeamMate'), cost: 115000, primary: ['S'], secondary: ['A', 'G', 'P'] },
    ],
  },
  {
    // V5: printed p.171 (PDF p.173), transcribed from the page image.
    id: 'halfling',
    name: 'Halfling',
    page: 171,
    rerollCost: 60000,
    apothecary: true,
    leagues: ['Halfling Thimble Cup', 'Woodland League'],
    specialRules: [],
    color: '#2e7d32',
    accent: '#fff3d6',
    positions: [
      { id: 'hopeful', name: 'Halfling Hopeful', qty: '0-16', keywords: ['Halfling', 'Lineman'], ma: 5, st: 2, ag: 3, pa: 4, av: 7, skills: sk('dodge', 'rightStuff', 'stunty'), cost: 30000, primary: ['A'], secondary: ['D', 'G', 'S'] },
      { id: 'hefty', name: 'Halfling Hefty', qty: '0-2', keywords: ['Blocker', 'Halfling'], ma: 5, st: 2, ag: 3, pa: 3, av: 8, skills: sk('dodge', 'fend', 'stunty'), cost: 50000, primary: ['A', 'P'], secondary: ['D', 'G', 'S'] },
      { id: 'catcher', name: 'Halfling Catcher', qty: '0-2', keywords: ['Catcher', 'Halfling'], ma: 5, st: 2, ag: 3, pa: 4, av: 7, skills: sk('catch', 'dodge', 'rightStuff', 'sprint', 'stunty'), cost: 55000, primary: ['A'], secondary: ['D', 'G', 'S'] },
      { id: 'treeman', name: 'Altern Forest Treeman', qty: '0-2', keywords: ['Big Guy', 'Treeman'], ma: 2, st: 6, ag: 5, pa: 5, av: 11, skills: sk('mightyBlow', 'standFirm', 'strongArm', 'takeRoot', 'thickSkull', 'throwTeamMate', 'timmmber'), cost: 120000, primary: ['S'], secondary: ['A', 'G', 'P'] },
    ],
  },
  {
    // 2026 table: Spike! Journal 21, printed p.172 (the page replaces the earlier rulebook p.172 table). Adjudicated per field for the two
    // disputed values (docs/HIGH_ELF_ADJUDICATION.md): Lineman Secondary = S (printed page + independent roster database; the Chinese quick
    // reference alone lists P,S) and Dragon Prince keywords = Elf, Blitzer, Runner (official designer article + database + quick reference; the
    // printed page omits Blitzer). Each is one data value: change it there if an official erratum says otherwise.
    id: 'highElf',
    name: 'High Elf',
    page: 172,
    rerollCost: 50000,
    apothecary: true,
    leagues: ['Elven Kingdoms League'],
    specialRules: [],
    color: '#f4f1ea',
    accent: '#9b1c1c',
    positions: [
      { id: 'lineman', name: 'High Elf Lineman', qty: '0-16', keywords: ['Elf', 'Lineman'], ma: 6, st: 3, ag: 2, pa: 3, av: 9, skills: [], cost: 65000, primary: ['A', 'G'], secondary: ['S'] },
      { id: 'phoenixWarrior', name: 'Phoenix Warrior', qty: '0-2', keywords: ['Elf', 'Thrower'], ma: 6, st: 3, ag: 2, pa: 2, av: 9, skills: sk('cloudBurster', 'pass', 'safePass'), cost: 90000, primary: ['A', 'G', 'P'], secondary: ['S'] },
      { id: 'dragonPrince', name: 'Dragon Prince', qty: '0-2', keywords: ['Elf', 'Blitzer', 'Runner'], ma: 8, st: 3, ag: 2, pa: 4, av: 9, skills: sk('block', 'myBall', 'steadyFooting'), cost: 110000, primary: ['A', 'G'], secondary: ['S'] },
      { id: 'whiteLion', name: 'White Lion', qty: '0-2', keywords: ['Elf', 'Blitzer'], ma: 7, st: 3, ag: 2, pa: 3, av: 9, skills: sk('claws', 'wrestle'), cost: 110000, primary: ['A', 'G'], secondary: ['P', 'S'] },
    ],
    // The earlier table (rulebook p.172): kept only to load teams saved under it.
    retiredPositions: [
      { id: 'thrower', name: 'High Elf Thrower', qty: '0-2', keywords: ['Elf', 'Thrower'], ma: 6, st: 3, ag: 2, pa: 2, av: 9, skills: sk('cloudBurster', 'pass', 'safePass'), cost: 100000, primary: ['A', 'G', 'P'], secondary: ['S'] },
      { id: 'catcher', name: 'High Elf Catcher', qty: '0-4', keywords: ['Elf', 'Catcher'], ma: 8, st: 3, ag: 2, pa: 3, av: 8, skills: sk('catch'), cost: 90000, primary: ['A', 'G'], secondary: ['S'] },
      { id: 'blitzer', name: 'High Elf Blitzer', qty: '0-2', keywords: ['Elf', 'Blitzer'], ma: 7, st: 3, ag: 2, pa: 4, av: 9, skills: sk('block'), cost: 100000, primary: ['A', 'G'], secondary: ['P', 'S'] },
    ],
  },
  {
    // V5: printed p.174 (PDF p.176), transcribed from the page image.
    id: 'imperialNobility',
    name: 'Imperial Nobility',
    page: 174,
    rerollCost: 60000,
    apothecary: true,
    leagues: ['Old World Classic'],
    specialRules: [],
    color: '#6d1f2f',
    accent: '#f1d98a',
    positions: [
      { id: 'retainer', name: 'Imperial Retainer', qty: '0-16', keywords: ['Human', 'Lineman'], ma: 6, st: 3, ag: 3, pa: 4, av: 8, skills: sk('fend'), cost: 45000, primary: ['G'], secondary: ['A', 'S'] },
      { id: 'thrower', name: 'Imperial Thrower', qty: '0-2', keywords: ['Human', 'Thrower'], ma: 6, st: 3, ag: 3, pa: 2, av: 9, skills: sk('giveAndGo', 'pass', 'pro'), cost: 75000, primary: ['G', 'P'], secondary: ['A', 'S'] },
      { id: 'bodyguard', name: 'Bodyguard', qty: '0-4', keywords: ['Blocker', 'Human'], ma: 5, st: 3, ag: 3, pa: 4, av: 9, skills: sk('standFirm', 'wrestle'), cost: 85000, primary: ['G', 'S'], secondary: ['A'] },
      { id: 'nobleBlitzer', name: 'Noble Blitzer', qty: '0-2', keywords: ['Blitzer', 'Human'], ma: 7, st: 3, ag: 3, pa: 4, av: 9, skills: sk('block', 'catch', 'pro'), cost: 90000, primary: ['A', 'G'], secondary: ['P', 'S'] },
      { id: 'ogre', name: 'Ogre', qty: '0-1', keywords: ['Big Guy', 'Ogre'], ma: 5, st: 5, ag: 4, pa: 5, av: 10, skills: sk('boneHead', ['loner', 3], 'mightyBlow', 'thickSkull', 'throwTeamMate'), cost: 140000, primary: ['S'], secondary: ['A', 'G'] },
    ],
  },
  {
    // V5: printed p.175 (PDF p.177), transcribed from the page image.
    id: 'khorne',
    name: 'Khorne',
    page: 175,
    rerollCost: 60000,
    apothecary: true,
    leagues: ['Chaos Clash'],
    specialRules: ["Brawlin' Brutes", 'Favoured of Khorne'],
    color: '#8b0f0f',
    accent: '#1a1a1a',
    positions: [
      { id: 'marauder', name: 'Bloodborn Marauder', qty: '0-16', keywords: ['Human', 'Lineman'], ma: 6, st: 3, ag: 3, pa: 4, av: 8, skills: sk('frenzy'), cost: 50000, primary: ['G', 'M'], secondary: ['A', 'D', 'S'] },
      { id: 'khorngor', name: 'Khorngor', qty: '0-2', keywords: ['Beastman', 'Runner'], ma: 6, st: 3, ag: 3, pa: 4, av: 9, skills: sk('horns', 'juggernaut', 'jumpUp', 'thickSkull'), cost: 70000, primary: ['G', 'M', 'S'], secondary: ['A', 'D', 'P'] },
      { id: 'bloodseeker', name: 'Bloodseeker', qty: '0-4', keywords: ['Blocker', 'Human'], ma: 5, st: 4, ag: 4, pa: 6, av: 10, skills: sk('frenzy'), cost: 105000, primary: ['G', 'M', 'S'], secondary: ['A', 'D'] },
      { id: 'bloodspawn', name: 'Bloodspawn', qty: '0-1', keywords: ['Big Guy', 'Spawn'], ma: 5, st: 5, ag: 4, pa: 6, av: 9, skills: sk('claws', 'frenzy', ['loner', 4], 'mightyBlow', 'unchannelledFury'), cost: 160000, primary: ['M', 'S'], secondary: ['A', 'G'] },
    ],
  },
  {
    // V5: printed p.177 (PDF p.179), transcribed from the page image.
    id: 'necromantic',
    name: 'Necromantic Horror',
    page: 177,
    rerollCost: 70000,
    apothecary: false,
    leagues: ['Sylvanian Spotlight'],
    specialRules: ['Masters of Undeath'],
    color: '#556b2f',
    accent: '#f0e68c',
    positions: [
      { id: 'zombie', name: 'Zombie Lineman', qty: '0-16', keywords: ['Human', 'Lineman', 'Undead', 'Zombie'], ma: 4, st: 3, ag: 4, pa: 6, av: 9, skills: sk('eyeGouge', 'regeneration', 'unsteady'), cost: 40000, primary: ['D', 'G'], secondary: ['A', 'S'] },
      { id: 'ghoul', name: 'Ghoul Runner', qty: '0-2', keywords: ['Ghoul', 'Runner', 'Undead'], ma: 7, st: 3, ag: 3, pa: 3, av: 8, skills: sk('dodge', 'regeneration'), cost: 75000, primary: ['A', 'G'], secondary: ['D', 'P', 'S'] },
      { id: 'wraith', name: 'Wraith', qty: '0-2', keywords: ['Blocker', 'Undead', 'Wraith'], ma: 6, st: 3, ag: 3, pa: null, av: 9, skills: sk('block', 'foulAppearance', 'noBall', 'regeneration', 'sidestep'), cost: 85000, primary: ['G', 'S'], secondary: ['A', 'D'] },
      { id: 'fleshGolem', name: 'Flesh Golem', qty: '0-2', keywords: ['Blocker', 'Construct', 'Undead'], ma: 4, st: 4, ag: 4, pa: 6, av: 10, skills: sk('regeneration', 'standFirm', 'thickSkull', 'unsteady'), cost: 110000, primary: ['G', 'S'], secondary: ['A', 'D'] },
      { id: 'werewolf', name: 'Werewolf', qty: '0-2', keywords: ['Blitzer', 'Undead', 'Werewolf'], ma: 8, st: 3, ag: 3, pa: 3, av: 9, skills: sk('claws', 'frenzy', 'regeneration'), cost: 120000, primary: ['A', 'G'], secondary: ['D', 'P', 'S'] },
    ],
  },
  {
    // V5: printed p.179 (PDF p.181), transcribed from the page image.
    id: 'nurgle',
    name: 'Nurgle',
    page: 179,
    rerollCost: 60000,
    apothecary: false,
    leagues: ['Chaos Clash'],
    specialRules: ["Brawlin' Brutes", 'Favoured of Nurgle'],
    color: '#7b8c3a',
    accent: '#3a2a1a',
    positions: [
      { id: 'rotter', name: 'Rotter Lineman', qty: '0-16', keywords: ['Human', 'Lineman'], ma: 5, st: 3, ag: 4, pa: 6, av: 9, skills: sk('decay', 'plagueRidden'), cost: 40000, primary: ['D', 'G', 'M'], secondary: ['A', 'S'] },
      { id: 'pestigor', name: 'Pestigor', qty: '0-2', keywords: ['Beastman', 'Runner'], ma: 6, st: 3, ag: 3, pa: 4, av: 9, skills: sk('horns', 'plagueRidden', 'regeneration', 'steadyFooting', 'thickSkull'), cost: 70000, primary: ['G', 'M', 'S'], secondary: ['A', 'D', 'P'] },
      { id: 'bloater', name: 'Bloater', qty: '0-4', keywords: ['Blocker', 'Human'], ma: 4, st: 4, ag: 4, pa: 6, av: 10, skills: sk('disturbingPresence', 'foulAppearance', 'plagueRidden', 'regeneration', 'standFirm', 'unsteady'), cost: 110000, primary: ['G', 'M', 'S'], secondary: ['A', 'D'] },
      { id: 'rotspawn', name: 'Rotspawn', qty: '0-1', keywords: ['Big Guy', 'Spawn'], ma: 4, st: 5, ag: 5, pa: 6, av: 10, skills: sk('disturbingPresence', 'foulAppearance', ['loner', 4], 'mightyBlow', 'pickMeUp', 'plagueRidden', 'reallyStupid', 'regeneration', 'tentacles'), cost: 140000, primary: ['S'], secondary: ['D', 'G', 'M'] },
    ],
  },
  {
    // V5: printed p.180 (PDF p.182), transcribed from the page image.
    id: 'ogre',
    name: 'Ogre',
    page: 180,
    rerollCost: 70000,
    apothecary: true,
    leagues: ['Badlands Brawl', 'Worlds Edge Superleague'],
    specialRules: ["Brawlin' Brutes", 'Low Cost Linemen'],
    color: '#8a5a2b',
    accent: '#f4e2c1',
    positions: [
      { id: 'gnoblar', name: 'Gnoblar Lineman', qty: '0-16', keywords: ['Gnoblar', 'Lineman'], ma: 5, st: 1, ag: 3, pa: 4, av: 6, skills: sk('dodge', 'rightStuff', 'sidestep', 'stunty', 'titchy'), cost: 15000, primary: ['A', 'D'], secondary: ['G'] },
      { id: 'ogreBlocker', name: 'Ogre Blocker', qty: '0-5', keywords: ['Big Guy', 'Blocker', 'Ogre'], ma: 5, st: 5, ag: 4, pa: 5, av: 10, skills: sk('boneHead', 'mightyBlow', 'thickSkull', 'throwTeamMate'), cost: 140000, primary: ['S'], secondary: ['A', 'D', 'G', 'P'] },
      { id: 'runtPunter', name: 'Ogre Runt Punter', qty: '0-1', keywords: ['Big Guy', 'Ogre', 'Thrower'], ma: 5, st: 5, ag: 4, pa: 4, av: 10, skills: sk('boneHead', 'kickTeamMate', 'mightyBlow', 'thickSkull'), cost: 145000, primary: ['P', 'S'], secondary: ['A', 'D', 'G'] },
    ],
  },
  {
    // V5: printed p.181 (PDF p.183), transcribed from the page image.
    id: 'oldWorldAlliance',
    name: 'Old World Alliance',
    page: 181,
    rerollCost: 70000,
    apothecary: true,
    leagues: ['Old World Classic'],
    specialRules: [],
    groups: [
      { id: 'bigGuy', max: 1, positions: ['ogre', 'treeman'], text: 'An Old World Alliance team may have a single Big Guy, chosen from the following' },
    ],
    color: '#1d4e89',
    accent: '#f2f2f2',
    positions: [
      { id: 'humanLineman', name: 'Human Lineman', qty: '0-16', keywords: ['Human', 'Lineman'], ma: 6, st: 3, ag: 3, pa: 4, av: 9, skills: [], cost: 50000, primary: ['G'], secondary: ['A', 'S'] },
      { id: 'halfling', name: 'Halfling Hopeful', qty: '0-3', keywords: ['Halfling', 'Lineman'], ma: 5, st: 2, ag: 3, pa: 4, av: 7, skills: sk('dodge', 'rightStuff', 'stunty'), cost: 30000, primary: ['A'], secondary: ['G', 'S'] },
      { id: 'humanCatcher', name: 'Human Catcher', qty: '0-1', keywords: ['Catcher', 'Human'], ma: 8, st: 3, ag: 3, pa: 4, av: 8, skills: sk('catch', 'dodge'), cost: 75000, primary: ['A', 'G'], secondary: ['P', 'S'] },
      { id: 'dwarfLineman', name: 'Dwarf Lineman', qty: '0-3', keywords: ['Dwarf', 'Lineman'], ma: 4, st: 3, ag: 4, pa: 5, av: 10, skills: sk('block', 'defensive', 'thickSkull'), cost: 70000, primary: ['D', 'G'], secondary: ['S'] },
      { id: 'humanThrower', name: 'Human Thrower', qty: '0-1', keywords: ['Human', 'Thrower'], ma: 6, st: 3, ag: 3, pa: 3, av: 9, skills: sk('pass', 'sureHands'), cost: 75000, primary: ['G', 'P'], secondary: ['A', 'S'] },
      { id: 'dwarfRunner', name: 'Dwarf Runner', qty: '0-1', keywords: ['Dwarf', 'Runner'], ma: 6, st: 3, ag: 3, pa: 4, av: 9, skills: sk('sprint', 'sureHands', 'thickSkull'), cost: 80000, primary: ['G', 'P'], secondary: ['A', 'S'] },
      { id: 'humanBlitzer', name: 'Human Blitzer', qty: '0-1', keywords: ['Blitzer', 'Human'], ma: 7, st: 3, ag: 3, pa: 4, av: 9, skills: sk('block', 'tackle'), cost: 85000, primary: ['G', 'S'], secondary: ['A'] },
      { id: 'dwarfBlitzer', name: 'Dwarf Blitzer', qty: '0-1', keywords: ['Blitzer', 'Dwarf'], ma: 5, st: 3, ag: 4, pa: 4, av: 10, skills: sk('block', 'divingTackle', 'tackle', 'thickSkull'), cost: 100000, primary: ['G', 'S'], secondary: ['P'] },
      { id: 'trollSlayer', name: 'Troll Slayer', qty: '0-1', keywords: ['Dwarf', 'Special'], ma: 5, st: 3, ag: 4, pa: 5, av: 9, skills: sk('block', 'dauntless', 'frenzy', ['hatred', 'Troll'], 'thickSkull'), cost: 95000, primary: ['G', 'S'], secondary: ['A'] },
      { id: 'ogre', name: 'Ogre', qty: '0-1', keywords: ['Big Guy', 'Ogre'], ma: 5, st: 5, ag: 4, pa: 5, av: 10, skills: sk('boneHead', ['loner', 3], 'mightyBlow', 'thickSkull', 'throwTeamMate'), cost: 140000, primary: ['S'], secondary: ['A', 'G'] },
      { id: 'treeman', name: 'Altern Forest Treeman', qty: '0-1', keywords: ['Big Guy', 'Treeman'], ma: 2, st: 6, ag: 5, pa: 5, av: 11, skills: sk(['loner', 4], 'mightyBlow', 'standFirm', 'strongArm', 'takeRoot', 'thickSkull', 'throwTeamMate', 'timmmber'), cost: 120000, primary: ['S'], secondary: ['A', 'G', 'P'] },
    ],
  },
  {
    // V5: printed p.183 (PDF p.185), transcribed from the page image.
    id: 'shamblingUndead',
    name: 'Shambling Undead',
    page: 183,
    rerollCost: 70000,
    apothecary: false,
    leagues: ['Sylvanian Spotlight'],
    specialRules: ['Masters of Undeath'],
    color: '#3d5a5a',
    accent: '#e3e3c7',
    positions: [
      { id: 'skeleton', name: 'Skeleton Lineman', qty: '0-16', keywords: ['Human', 'Lineman', 'Skeleton', 'Undead'], ma: 5, st: 3, ag: 4, pa: 6, av: 8, skills: sk('regeneration', 'thickSkull'), cost: 40000, primary: ['G'], secondary: ['A', 'D', 'S'] },
      { id: 'zombie', name: 'Zombie Lineman', qty: '0-16', keywords: ['Human', 'Lineman', 'Undead', 'Zombie'], ma: 4, st: 3, ag: 4, pa: 6, av: 9, skills: sk('eyeGouge', 'regeneration', 'unsteady'), cost: 40000, primary: ['D', 'G'], secondary: ['A', 'S'] },
      { id: 'ghoul', name: 'Ghoul Runner', qty: '0-2', keywords: ['Ghoul', 'Runner', 'Undead'], ma: 7, st: 3, ag: 3, pa: 3, av: 8, skills: sk('dodge', 'regeneration'), cost: 75000, primary: ['A', 'G'], secondary: ['D', 'P', 'S'] },
      { id: 'wight', name: 'Wight Blitzer', qty: '0-2', keywords: ['Blitzer', 'Human', 'Skeleton', 'Undead'], ma: 6, st: 3, ag: 3, pa: 5, av: 9, skills: sk('block', 'regeneration', 'tackle', 'thickSkull'), cost: 95000, primary: ['G', 'S'], secondary: ['A', 'D'] },
      { id: 'mummy', name: 'Mummy', qty: '0-2', keywords: ['Big Guy', 'Blocker', 'Human', 'Undead'], ma: 3, st: 5, ag: 5, pa: 6, av: 10, skills: sk('mightyBlow', 'regeneration'), cost: 125000, primary: ['S'], secondary: ['A', 'G'] },
    ],
  },
  {
    // V5: printed p.184 (PDF p.186), transcribed from the page image.
    id: 'skaven',
    name: 'Skaven',
    page: 184,
    rerollCost: 50000,
    apothecary: true,
    leagues: ['Underworld Challenge'],
    specialRules: [],
    color: '#3f6b2a',
    accent: '#e8e0c0',
    positions: [
      { id: 'clanrat', name: 'Skaven Clanrat', qty: '0-16', keywords: ['Lineman', 'Skaven'], ma: 7, st: 3, ag: 3, pa: 4, av: 8, skills: [], cost: 50000, primary: ['D', 'G'], secondary: ['A', 'M', 'S'] },
      { id: 'thrower', name: 'Skaven Thrower', qty: '0-2', keywords: ['Skaven', 'Thrower'], ma: 7, st: 3, ag: 3, pa: 2, av: 8, skills: sk('pass', 'sureHands'), cost: 80000, primary: ['G', 'P'], secondary: ['A', 'D', 'M', 'S'] },
      { id: 'gutterRunner', name: 'Gutter Runner', qty: '0-2', keywords: ['Runner', 'Skaven'], ma: 9, st: 2, ag: 2, pa: 4, av: 8, skills: sk('dodge', 'stab'), cost: 85000, primary: ['A', 'D', 'G'], secondary: ['M', 'S'] },
      { id: 'blitzer', name: 'Skaven Blitzer', qty: '0-2', keywords: ['Blitzer', 'Skaven'], ma: 8, st: 3, ag: 3, pa: 4, av: 9, skills: sk('block', 'stripBall'), cost: 90000, primary: ['G', 'S'], secondary: ['A', 'D', 'M'] },
      { id: 'ratOgre', name: 'Rat Ogre', qty: '0-1', keywords: ['Big Guy', 'Skaven'], ma: 6, st: 5, ag: 4, pa: 6, av: 9, skills: sk('animalSavagery', 'frenzy', ['loner', 4], 'mightyBlow', 'prehensileTail'), cost: 150000, primary: ['S'], secondary: ['A', 'G', 'M'] },
    ],
  },
  {
    // V5: printed p.185 (PDF p.187), transcribed from the page image.
    id: 'slann',
    name: 'Slann',
    page: 185,
    rerollCost: 50000,
    apothecary: true,
    leagues: ['Lustrian Superleague'],
    specialRules: [],
    color: '#2a8a8a',
    accent: '#f6e27f',
    positions: [
      { id: 'lineman', name: 'Slann Lineman', qty: '0-16', keywords: ['Lineman', 'Lizardman'], ma: 6, st: 3, ag: 3, pa: 4, av: 9, skills: sk('pogo'), cost: 60000, primary: ['G'], secondary: ['A', 'S'] },
      { id: 'catcher', name: 'Slann Catcher', qty: '0-2', keywords: ['Catcher', 'Lizardman'], ma: 7, st: 2, ag: 2, pa: 3, av: 8, skills: sk('divingCatch', 'onTheBall', 'pogo', 'veryLongLegs'), cost: 80000, primary: ['A', 'G'], secondary: ['P', 'S'] },
      { id: 'blitzer', name: 'Slann Blitzer', qty: '0-2', keywords: ['Blitzer', 'Lizardman'], ma: 7, st: 3, ag: 3, pa: 4, av: 9, skills: sk('divingTackle', 'hitAndRun', 'jumpUp', 'pogo'), cost: 100000, primary: ['A', 'G', 'S'], secondary: ['P'] },
      { id: 'kroxigor', name: 'Kroxigor', qty: '0-1', keywords: ['Big Guy', 'Lizardman'], ma: 6, st: 5, ag: 5, pa: 6, av: 10, skills: sk('boneHead', ['loner', 4], 'mightyBlow', 'prehensileTail', 'thickSkull'), cost: 140000, primary: ['S'], secondary: ['A', 'G'] },
    ],
  },
  {
    // V5: printed p.186 (PDF p.188), transcribed from the page image.
    id: 'snotling',
    name: 'Snotling',
    page: 186,
    rerollCost: 70000,
    apothecary: true,
    leagues: ['Underworld Challenge'],
    specialRules: ['Bribery and Corruption', 'Low Cost Linemen', 'Swarming'],
    color: '#9ccc65',
    accent: '#5d2e0f',
    positions: [
      { id: 'lineman', name: 'Snotling Lineman', qty: '0-16', keywords: ['Lineman', 'Snotling'], ma: 5, st: 1, ag: 3, pa: 4, av: 6, skills: sk('dodge', 'insignificant', 'rightStuff', 'sidestep', 'stunty', 'titchy'), cost: 15000, primary: ['A', 'D'], secondary: ['G'] },
      { id: 'funHoppa', name: 'Fun-hoppa', qty: '0-2', keywords: ['Snotling', 'Special'], ma: 6, st: 1, ag: 3, pa: 4, av: 6, skills: sk('dodge', 'pogo', 'rightStuff', 'sidestep', 'stunty'), cost: 20000, primary: ['A', 'D'], secondary: ['G'] },
      { id: 'stiltyRunna', name: 'Stilty Runna', qty: '0-2', keywords: ['Runner', 'Snotling'], ma: 6, st: 1, ag: 3, pa: 4, av: 6, skills: sk('dodge', 'rightStuff', 'sidestep', 'sprint', 'stunty'), cost: 20000, primary: ['A', 'D'], secondary: ['G'] },
      { id: 'fungusFlinga', name: 'Fungus Flinga', qty: '0-2', keywords: ['Snotling', 'Special'], ma: 5, st: 1, ag: 3, pa: 4, av: 6, skills: sk('bombardier', 'dodge', 'rightStuff', 'secretWeapon', 'sidestep', 'stunty', 'titchy'), cost: 30000, primary: ['A', 'D', 'P'], secondary: ['G'] },
      { id: 'pumpWagon', name: 'Pump Wagon', qty: '0-2', keywords: ['Big Guy', 'Snotling', 'Special'], ma: 5, st: 5, ag: 5, pa: 6, av: 9, skills: sk('dirtyPlayer', 'juggernaut', 'mightyBlow', 'reallyStupid', 'standFirm'), cost: 100000, primary: ['D', 'S'], secondary: ['A', 'G'] },
      { id: 'trainedTroll', name: 'Trained Troll', qty: '0-2', keywords: ['Big Guy', 'Troll'], ma: 4, st: 5, ag: 5, pa: 5, av: 10, skills: sk('alwaysHungry', 'mightyBlow', 'projectileVomit', 'reallyStupid', 'regeneration', 'throwTeamMate'), cost: 115000, primary: ['S'], secondary: ['A', 'G', 'P'] },
    ],
  },
  {
    // V5: printed p.188 (PDF p.190), transcribed from the page image.
    id: 'underworld',
    name: 'Underworld Denizens',
    page: 188,
    rerollCost: 70000,
    apothecary: true,
    leagues: ['Underworld Challenge'],
    specialRules: ['Bribery and Corruption'],
    groups: [
      { id: 'bigGuy', max: 1, positions: ['troll', 'ratOgre'], text: 'An Underworld Denizens team may have a single Big Guy, chosen from the following' },
    ],
    color: '#4f6b1f',
    accent: '#f3e0b5',
    positions: [
      { id: 'goblin', name: 'Goblin Lineman', qty: '0-16', keywords: ['Goblin', 'Lineman'], ma: 6, st: 2, ag: 3, pa: 4, av: 8, skills: sk('dodge', 'rightStuff', 'stunty'), cost: 40000, primary: ['A', 'D', 'M'], secondary: ['G', 'P', 'S'] },
      { id: 'snotling', name: 'Snotling Lineman', qty: '0-6', keywords: ['Lineman', 'Snotling'], ma: 5, st: 1, ag: 3, pa: 4, av: 6, skills: sk('dodge', 'insignificant', 'rightStuff', 'sidestep', 'stunty', 'titchy'), cost: 15000, primary: ['A', 'D', 'M'], secondary: ['G'] },
      { id: 'clanrat', name: 'Skaven Clanrat', qty: '0-3', keywords: ['Lineman', 'Skaven'], ma: 7, st: 3, ag: 3, pa: 4, av: 8, skills: sk(['animosity', 'Goblin']), cost: 50000, primary: ['D', 'G', 'M'], secondary: ['A', 'S'] },
      { id: 'thrower', name: 'Skaven Thrower', qty: '0-1', keywords: ['Skaven', 'Thrower'], ma: 7, st: 3, ag: 3, pa: 2, av: 8, skills: sk(['animosity', 'Goblin'], 'pass', 'sureHands'), cost: 80000, primary: ['G', 'M', 'P'], secondary: ['A', 'D', 'S'] },
      { id: 'gutterRunner', name: 'Gutter Runner', qty: '0-1', keywords: ['Runner', 'Skaven'], ma: 9, st: 2, ag: 2, pa: 4, av: 8, skills: sk(['animosity', 'Goblin'], 'dodge', 'stab'), cost: 85000, primary: ['A', 'D', 'G', 'M'], secondary: ['S'] },
      { id: 'blitzer', name: 'Skaven Blitzer', qty: '0-1', keywords: ['Blitzer', 'Skaven'], ma: 8, st: 3, ag: 3, pa: 4, av: 9, skills: sk(['animosity', 'Goblin'], 'block', 'stripBall'), cost: 90000, primary: ['G', 'M', 'S'], secondary: ['A', 'D'] },
      { id: 'troll', name: 'Troll', qty: '0-1', keywords: ['Big Guy', 'Troll'], ma: 4, st: 5, ag: 5, pa: 5, av: 10, skills: sk('alwaysHungry', ['loner', 4], 'mightyBlow', 'projectileVomit', 'reallyStupid', 'regeneration', 'throwTeamMate'), cost: 115000, primary: ['M', 'S'], secondary: ['A', 'G', 'P'] },
      { id: 'ratOgre', name: 'Rat Ogre', qty: '0-1', keywords: ['Big Guy', 'Skaven'], ma: 6, st: 5, ag: 4, pa: 6, av: 9, skills: sk('animalSavagery', 'frenzy', ['loner', 4], 'mightyBlow', 'prehensileTail'), cost: 150000, primary: ['M', 'S'], secondary: ['A', 'G'] },
    ],
  },
  {
    // V5: printed p.189 (PDF p.191), transcribed from the page image.
    id: 'vampire',
    name: 'Vampire',
    page: 189,
    rerollCost: 60000,
    apothecary: true,
    leagues: ['Sylvanian Spotlight'],
    specialRules: ['Masters of Undeath'],
    color: '#5a0f1f',
    accent: '#f0e2d0',
    positions: [
      { id: 'thrall', name: 'Thrall Lineman', qty: '0-16', keywords: ['Human', 'Lineman', 'Thrall'], ma: 6, st: 3, ag: 3, pa: 4, av: 8, skills: [], cost: 40000, primary: ['G'], secondary: ['A', 'S'] },
      { id: 'runner', name: 'Vampire Runner', qty: '0-2', keywords: ['Runner', 'Undead', 'Vampire'], ma: 8, st: 3, ag: 2, pa: 3, av: 8, skills: sk(['bloodlust', 2], 'hypnoticGaze', 'regeneration'), cost: 100000, primary: ['A', 'G'], secondary: ['P', 'S'] },
      { id: 'thrower', name: 'Vampire Thrower', qty: '0-2', keywords: ['Thrower', 'Undead', 'Vampire'], ma: 6, st: 4, ag: 2, pa: 2, av: 9, skills: sk(['bloodlust', 2], 'hypnoticGaze', 'pass', 'regeneration'), cost: 110000, primary: ['A', 'G', 'P'], secondary: ['S'] },
      { id: 'blitzer', name: 'Vampire Blitzer', qty: '0-2', keywords: ['Blitzer', 'Undead', 'Vampire'], ma: 6, st: 4, ag: 2, pa: 4, av: 9, skills: sk(['bloodlust', 3], 'hypnoticGaze', 'juggernaut', 'regeneration'), cost: 110000, primary: ['A', 'G', 'S'], secondary: [] },
      { id: 'vargheist', name: 'Vargheist', qty: '0-1', keywords: ['Big Guy', 'Undead', 'Vampire'], ma: 5, st: 5, ag: 4, pa: 6, av: 10, skills: sk(['bloodlust', 3], 'claws', 'frenzy', ['loner', 4], 'regeneration'), cost: 150000, primary: ['S'], secondary: ['A', 'G'] },
    ],
  },
  {
    // V5: printed p.190 (PDF p.192), transcribed from the page image.
    id: 'woodElf',
    name: 'Wood Elf',
    page: 190,
    rerollCost: 50000,
    apothecary: true,
    leagues: ['Elven Kingdoms League', 'Woodland League'],
    specialRules: [],
    color: '#2f6b3a',
    accent: '#e9d9a6',
    positions: [
      { id: 'lineman', name: 'Wood Elf Lineman', qty: '0-16', keywords: ['Elf', 'Lineman'], ma: 7, st: 3, ag: 2, pa: 3, av: 8, skills: [], cost: 65000, primary: ['A', 'G'], secondary: ['S'] },
      { id: 'thrower', name: 'Wood Elf Thrower', qty: '0-2', keywords: ['Elf', 'Thrower'], ma: 7, st: 3, ag: 2, pa: 2, av: 8, skills: sk('pass', 'safePairOfHands'), cost: 85000, primary: ['A', 'G', 'P'], secondary: ['S'] },
      { id: 'catcher', name: 'Wood Elf Catcher', qty: '0-2', keywords: ['Catcher', 'Elf'], ma: 8, st: 2, ag: 2, pa: 3, av: 8, skills: sk('catch', 'dodge', 'sprint'), cost: 90000, primary: ['A', 'G'], secondary: ['P', 'S'] },
      { id: 'wardancer', name: 'Wardancer', qty: '0-2', keywords: ['Blitzer', 'Elf'], ma: 8, st: 3, ag: 2, pa: 3, av: 8, skills: sk('block', 'dodge', 'leap'), cost: 130000, primary: ['A', 'G'], secondary: ['P', 'S'] },
      { id: 'treeman', name: 'Loren Forest Treeman', qty: '0-1', keywords: ['Big Guy', 'Treeman'], ma: 2, st: 6, ag: 5, pa: 5, av: 11, skills: sk(['loner', 4], 'mightyBlow', 'standFirm', 'strongArm', 'takeRoot', 'thickSkull', 'throwTeamMate'), cost: 120000, primary: ['S'], secondary: ['A', 'G', 'P'] },
    ],
  },
];

/** The League a saved team plays in: its choice, or the roster's only League (p.152). */
export function rosterLeague(r: Roster | undefined, chosen?: string): string | undefined {
  if (!r) return chosen;
  if (chosen && r.leagues.includes(chosen)) return chosen;
  return r.leagues.length === 1 ? r.leagues[0] : undefined;
}

/** Team special rules of a roster with a League choice (pp.154-155) and, for "Favoured of (choose …)", the chosen alignment. */
export function rosterSpecialRules(r: Roster | undefined, league?: string, favoured?: string): string[] {
  if (!r) return [];
  const l = rosterLeague(r, league);
  const fav = favoured && r.favouredOf?.includes(favoured) ? [`Favoured of ${favoured}`] : [];
  return [...r.specialRules, ...fav, ...((l && r.leagueRules?.[l]) ?? [])];
}

/** The team special rules pages (p.154: Brawlin' Brutes, Bribery and Corruption, Favoured of…; p.155: Low Cost Linemen, Masters of Undeath, Swarming, Team Captain). */
export const SPECIAL_RULE_PAGE: Record<string, number> = {
  "Brawlin' Brutes": 154,
  'Bribery and Corruption': 154,
  'Low Cost Linemen': 155,
  'Masters of Undeath': 155,
  Swarming: 155,
  'Team Captain': 155,
};
export function specialRulePage(rule: string): number {
  return SPECIAL_RULE_PAGE[rule] ?? 154;
}

export const ROSTER_BY_ID: Record<string, Roster> = Object.fromEntries(ROSTERS.map((r) => [r.id, r]));

/** A position by id: a recruitable one, else a retired one of an earlier table (only so saved teams still load). */
export function findPosition(r: Roster | undefined, id: string | undefined): RosterPosition | undefined {
  if (!r || !id) return undefined;
  return r.positions.find((x) => x.id === id) ?? r.retiredPositions?.find((x) => x.id === id);
}

/** True when `id` is a retired (no longer recruitable) position of this roster. */
export function isRetiredPosition(r: Roster | undefined, id: string | undefined): boolean {
  return !!r && !!id && !r.positions.some((x) => x.id === id) && !!r.retiredPositions?.some((x) => x.id === id);
}
