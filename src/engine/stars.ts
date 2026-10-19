/**
 * Star Players (Inducement "0-2 Star Players", p.148; the Star Players list pp.194-211), V5 step 5.
 *
 * A Tournament / Exhibition team hires up to two Star Players with gold pieces from its Team Draft
 * Budget (Exhibition Play, pp.110, 116; Matched Play's Skill Points are not implemented). A pair
 * (Grak & Crumbleberry, Dribl & Drull, the Swift Twins) counts as one Star Player choice but takes two
 * places on the team. A Star Player only plays for teams of a League (or with a special rule) printed in
 * its "Plays For" (p.194). Star Players earn no Star Player Points, are never selected by a Prayer to
 * Nuffle, and their Casualties are waived after the game (Tournament / Exhibition teams keep no injuries
 * anyway). A team that hired Josef Bugman as Infamous Coaching Staff cannot hire him as a Star Player
 * (p.147). League teams buy Inducements and hire Star Players for one match in the pre-match step (Petty Cash and Treasury, p.94).
 *
 * Every Star Player's own special rule is implemented in the engine before it can be hired: only the
 * Star Players listed in STAR_RULES_IMPLEMENTED are offered; the others are shown as "not yet".
 */
import type { Ctx } from './context';
import { STAR_DATA, type StarDef, type StarPer } from './stardata';
import type { Activation, GameState, Player, RuleRef, SkillRef, TeamId } from './types';

export type { StarDef, StarPer };
export const STARS: StarDef[] = STAR_DATA;
export const STAR_BY_ID: Record<string, StarDef> = Object.fromEntries(STARS.map((s) => [s.id, s]));

/** The Inducement (p.148), the Star Players list and "Plays For" (p.194). */
export const STAR_RULE: RuleRef = { page: 148, title: 'Star Players' };
export const STAR_LIST_PAGE = 194;
/** At most two Star Player choices per team (a pair counts once). */
export const STAR_MAX = 2;

/** Star Players whose special rule is implemented, so they can be hired. */
export const STAR_RULES_IMPLEMENTED = new Set<string>([
  'akhorne',
  'anqiPanqi',
  'lordBorak',
  'hthark',
  'willow',
  'grashnak',
  'karla',
  'lucien',
  'valen',
  'mightyZug',
  'grim',
  'ivan',
  'rumbelow',
  'varag',
  'wilhelm',
  'josefBugmanStar',
  'griff',
  'jordell',
  'puggy',
  'ripper',
  'morgNThorg',
  'eldril',
  'skrull',
  'rowana',
  'withergrasp',
  'kreek',
  'luthor',
  'skrorg',
  'glart',
  'roxanna',
  'gloriel',
  'deeproot',
  'blackGobbo',
  'dribl',
  'drull',
  'scrappa',
  'skitter',
  'rashnak',
  // Start-of-activation rules and Action variants (starActions.ts) and the remaining hooks:
  'barik',
  'bilerot',
  'boa',
  'bomber',
  'karina',
  'cindy',
  'grak',
  'crumbleberry',
  'estelle',
  'fungus',
  'glotl',
  'grombrindal',
  'guffle',
  'hakflem',
  'helmut',
  'ivar',
  'jeremiahKool',
  'kiroth',
  'maple',
  'maxSpleenripper',
  'nobbla',
  'rodney',
  'scyla',
  'swiftvine',
  'thorsson',
  'zolcath',
  'zzharg',
  'gretchen',
]);

export function starSupported(id: string): boolean {
  return STAR_RULES_IMPLEMENTED.has(id);
}

/** Rule reference of a Star Player's special rule (the Star Player's card page). */
export function starRuleRef(st: StarDef): RuleRef {
  return { page: st.page, title: `${st.name}: ${st.rule.name}` };
}

/** "Plays For" as text, e.g. "Old World Classic or Worlds Edge Superleague", "any team". */
export function playsForText(st: StarDef): string {
  if (!st.playsFor.length) return st.except?.length ? `any team except ${st.except.join(' or ')}` : 'any team';
  return st.playsFor.join(' or ');
}

/** Does the Star Player play for a team of League `league` with special rules `rules` (p.194)? */
export function starPlaysFor(st: StarDef, league: string | undefined, rules: readonly string[]): boolean {
  if (!st.playsFor.length) return !st.except?.some((x) => x === league || rules.includes(x));
  return st.playsFor.some((x) => x === league || rules.includes(x));
}

/** One hire per Star Player, or per pair: the key used to count Star Player choices and to charge a pair once. */
export function starChoiceKey(id: string): string {
  const st = STAR_BY_ID[id];
  return st?.pair ? [id, st.pair].sort().join('+') : id;
}

/** Total hiring cost of the Star Players among `players` (a pair is paid once). */
export function starsCost(players: ReadonlyArray<{ star?: string }>): number {
  const seen = new Set<string>();
  let n = 0;
  for (const p of players) {
    if (!p.star) continue;
    const k = starChoiceKey(p.star);
    if (seen.has(k)) continue;
    seen.add(k);
    n += STAR_BY_ID[p.star]?.cost ?? 0;
  }
  return n;
}

/** Number of Star Player choices (a pair counts once). */
export function starChoices(players: ReadonlyArray<{ star?: string }>): number {
  return new Set(players.filter((p) => p.star).map((p) => starChoiceKey(p.star as string))).size;
}

/** The Star Player's skills as the match gets them (copies). */
export function starSkills(st: StarDef): SkillRef[] {
  return st.skills.map((k) => ({ ...k }));
}

// ---------------------------------------------------------------------------
// In a match
// ---------------------------------------------------------------------------

export function starOf(p: Player | undefined | null): StarDef | undefined {
  return p?.star ? STAR_BY_ID[p.star] : undefined;
}

/** Is `p` the Star Player `id`? */
export function isStar(p: Player | undefined | null, id: string): boolean {
  return !!p && p.star === id;
}

/** When a special rule used "once per …" was used: the marker for the current game / half / Drive / activation. */
export function starMarker(s: GameState, per: StarPer): string {
  switch (per) {
    case 'half':
      return `h${s.match?.half ?? s.turn.half}`;
    case 'drive':
      return `d${s.match?.drive ?? 0}`;
    case 'activation':
      return `a${s.turn.half}${s.turn.active}${s.teams[s.turn.active].turn}`;
    default:
      return 'game';
  }
}

/** Can Star Player `p` (who must be Star Player `id`) use their special rule now (not used yet this game / half / Drive / activation)? */
export function starReady(s: GameState, p: Player | undefined | null, id: string): boolean {
  if (!p || p.star !== id) return false;
  // A Star Player turned into a Frog (Zap!, p.149) cannot use their special rule until they are themselves again.
  if (p.frog) return false;
  const st = STAR_BY_ID[id];
  if (!st || !starSupported(id)) return false;
  if (st.rule.per === 'always') return true;
  return !(p.starUsed ?? []).includes(starMarker(s, st.rule.per));
}

/** Record a use of `p`'s special rule, with a log line. */
export function spendStar(ctx: Ctx, p: Player, text: string): void {
  const st = starOf(p);
  if (!st) return;
  if (st.rule.per !== 'always') p.starUsed = [...(p.starUsed ?? []), starMarker(ctx.s, st.rule.per)];
  ctx.emit('status', `${st.name} — ${st.rule.name}: ${text}`, starRuleRef(st), { playerId: p.id, star: st.id });
}

/** Players of `team` on the pitch who are Star Player `id`. */
export function starsOnPitch(s: GameState, team: TeamId, id: string): Player[] {
  return s.players.filter((p) => p.team === team && p.star === id && p.location === 'pitch' && !!p.pos);
}

/**
 * Ask the Star Player's coach whether to use the special rule now. `helps`: whether using it changes the
 * result in their favour (the computer and the previews use it only then). Returns true to use it.
 */
export function askStar(ctx: Ctx, p: Player, prompt: string, useLabel: string, helps: boolean, noLabel = 'Do not use it now'): boolean {
  const st = starOf(p);
  if (!st) return false;
  const c = ctx.ask({
    type: 'starRule',
    team: p.team,
    prompt: `${st.name} — ${st.rule.name}: ${prompt}`,
    options: [
      { id: 'use', label: useLabel },
      { id: 'no', label: noLabel },
    ],
    rule: starRuleRef(st),
    context: { star: st.id, helps },
  });
  return c === 'use';
}

/**
 * Dribl & Drull's A Sneaky Pair (p.198): a Foul or a Stab by Dribl or Drull against an opposition player Marked
 * by both of them gets +1.
 */
export function sneakyPair(s: GameState, p: Player, target: Player): boolean {
  if (p.star !== 'dribl' && p.star !== 'drull') return false;
  const marks = (id: string) => s.players.some((q) => q.star === id && q.team === p.team && q.location === 'pitch' && q.stance === 'standing' && !q.distracted && !!q.pos && !!target.pos && Math.max(Math.abs(q.pos.x - target.pos.x), Math.abs(q.pos.y - target.pos.y)) === 1);
  return marks('dribl') && marks('drull');
}

/** Agility Tests (p.29) among the engine's test kinds ('jump' covers Jump, Leap and Pogo). */
const AGILITY_TESTS = new Set(['dodge', 'jump', 'pickup', 'catch', 'intercept', 'landing']);

/**
 * A modifier the Star Player may add after seeing a test (once per game): Griff Oberwald's Consummate Professional
 * (+1 to an Agility Test, p.200), Skrull Halfheight's Strong Passing Game (+ST to a Passing Ability Test of a Pass
 * Action, the result counting at most 6, p.208).
 */
export function starTestBonus(s: GameState, p: Player, kind: string): { id: string; value: number; what: string } | null {
  if (AGILITY_TESTS.has(kind) && starReady(s, p, 'griff')) return { id: 'griff', value: 1, what: "Griff Oberwald's Consummate Professional, once per game" };
  if (kind === 'pass' && starReady(s, p, 'skrull')) return { id: 'skrull', value: p.st, what: "Skrull Halfheight's Strong Passing Game, once per game" };
  return null;
}

/** Jordell Freshbreeze's Swift as the Breeze (p.203): once per game a Dodge, Leap or Rush test passes on a 2+ regardless of modifiers. */
export function starPassOn2(s: GameState, p: Player, kind: string, subkind?: string): boolean {
  if (!starReady(s, p, 'jordell')) return false;
  return kind === 'dodge' || kind === 'rush' || (kind === 'jump' && subkind === 'leap');
}

/**
 * A Star Player's re-roll of a test: Morg 'n' Thorg's The Ballista (a Throw Team-mate's Passing Ability Test, once
 * per game, p.205), Eldril Sidewinder's Mesmerizing Dance (Hypnotic Gaze, once per half, p.199), Puggy
 * Baconbreath's Halfling Luck (any single die he rolls, once per game) and Ripper Bolgrot's Thinking Man's Troll
 * (once per half, p.206). Armour, Injury and Casualty Rolls are never tests.
 */
export function starTestReroll(s: GameState, p: Player, kind: string): { id: string; what: string } | null {
  if (kind === 'ttm' && starReady(s, p, 'morgNThorg')) return { id: 'morgNThorg', what: "Morg 'n' Thorg's The Ballista (once per game)" };
  if (kind === 'hypnoticGaze' && starReady(s, p, 'eldril')) return { id: 'eldril', what: "Eldril Sidewinder's Mesmerizing Dance (once per half)" };
  if (starReady(s, p, 'puggy')) return { id: 'puggy', what: "Puggy Baconbreath's Halfling Luck (once per game)" };
  if (starReady(s, p, 'ripper')) return { id: 'ripper', what: "Ripper Bolgrot's Thinking Man's Troll (once per half)" };
  return null;
}

/**
 * Why `p` cannot declare a Foul Action because the team's Foul has been used this Turn (p.69), or null. The Black
 * Gobbo's Sneakiest of the Lot (p.196): his team may declare two Foul Actions per Turn, one of them by him.
 */
export function foulTakenReason(s: GameState, p: Player): string | null {
  if (!s.turn.used.foul) return null;
  const by = s.turn.used.foulBy ?? [];
  const gobbo = s.players.some((q) => q.team === p.team && q.star === 'blackGobbo' && q.location === 'pitch');
  if (gobbo && by.length < 2) {
    const gobboFouled = by.some((id) => s.players.find((q) => q.id === id)?.star === 'blackGobbo');
    if (gobboFouled || p.star === 'blackGobbo') return null;
    return "Sneakiest of the Lot (the Black Gobbo, p.196): the team's second Foul Action this Turn must be declared by the Black Gobbo.";
  }
  return 'The Foul Action has already been declared this Turn (p.69).';
}

/**
 * Star Player special rules chosen when the Action is declared (the coach is asked):
 *  - Glart Smashrip's Frenzied Rush (p.199): once per half, a Blitz with Frenzy — and no Grab that Turn;
 *  - Roxanna Darknail's Slashing Nails (p.207): once per half, a Blitz with Claws;
 *  - Gloriel Summerbloom's Shot to Nothing (p.199): once per game, Hail Mary Pass for this activation (asked for a Pass Action).
 */
export function starOnDeclare(ctx: Ctx, p: Player, act: Activation): void {
  const s = ctx.s;
  if (act.action === 'blitz' && starReady(s, p, 'glart') && askStar(ctx, p, 'gain Frenzy for this Blitz (he may not use Grab this Turn)?', 'Use Frenzied Rush: Frenzy', true)) {
    grantTempSkill(p, 'frenzy', 'activation');
    act.starFlags = [...(act.starFlags ?? []), 'noGrab'];
    spendStar(ctx, p, `${p.name} gains Frenzy until the end of his activation and may not use Grab this Turn.`);
  }
  if (act.action === 'blitz' && starReady(s, p, 'roxanna') && askStar(ctx, p, 'gain Claws for this Blitz?', 'Use Slashing Nails: Claws', true)) {
    grantTempSkill(p, 'claws', 'activation');
    spendStar(ctx, p, `${p.name} gains Claws until the end of her activation.`);
  }
  if (act.action === 'pass' && starReady(s, p, 'gloriel') && askStar(ctx, p, 'gain Hail Mary Pass for this activation?', 'Use Shot to Nothing: Hail Mary Pass', false)) {
    grantTempSkill(p, 'hailMaryPass', 'activation');
    spendStar(ctx, p, `${p.name} gains Hail Mary Pass until the end of her activation.`);
  }
}

/** Glart Smashrip used Frenzied Rush this activation: no Grab (p.199). */
export function grabForbidden(s: GameState, p: Player): boolean {
  const a = s.turn.activation;
  return !!a && a.playerId === p.id && !!a.starFlags?.includes('noGrab');
}

/** Remove the temporary skills that last until the end of the activation / Turn / Drive. */
export function dropTempSkills(s: GameState, until: 'activation' | 'turn' | 'drive'): void {
  const drop = until === 'drive' ? ['activation', 'turn', 'drive'] : until === 'turn' ? ['activation', 'turn'] : ['activation'];
  for (const p of s.players) if (p.skills.some((k) => k.until && drop.includes(k.until))) p.skills = p.skills.filter((k) => !k.until || !drop.includes(k.until));
}

/** Give `p` a skill until the end of the activation / Turn / Drive (no effect if they already have it). */
export function grantTempSkill(p: Player, id: string, until: 'activation' | 'turn' | 'drive'): boolean {
  if (p.skills.some((k) => k.id === id)) return false;
  p.skills.push({ id, until });
  return true;
}
