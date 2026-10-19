import { adjacent, fmt, neighbours } from './board';
import { bounce } from './ball';
import { Ctx } from './context';
import { rollTest } from './roll';
import { INDUCE_RULE, INDUCEMENT_BY_ID, induceLeft, spendInduce } from './inducements';
import { awardSpp } from './spp';
import { ROSTER_BY_ID } from './rosters';
import { gated } from './skills';
import { playerFromPosition } from './setup';
import { R } from './rules';
import { canUse, hasBall, hasSkill, label, playerAt } from './state';
import type { GameState, Player, TeamId } from './types';
import { rulesFor } from './variant';
import { hasPrayer, trapdoors } from './prayers';
import { askStar, spendStar, STAR_BY_ID, starReady, starRuleRef } from './stars';

export type DownKind = 'knockedDown' | 'fellOver' | 'placedProne';

export interface DownCause {
  kind: DownKind;
  /** Player responsible (the blocker / the target that won the block). */
  by?: Player;
  /** Knocked Down as part of a Block Action (Mighty Blow and Claws apply). */
  inBlock?: boolean;
  /** Arm Bar players whose Tackle Zone the faller was leaving. */
  armBar?: Player[];
  /** Thrown player with Lethal Flight who crash-landed on this player (p.130). */
  lethalFlight?: Player;
  /** Player credited with a resulting Casualty when the rules name one (Violent Innovator, Lethal Flight). */
  credit?: Player;
  /** Animal Savagery (p.123): the player who lashed out (must use Claws / Mighty Blow on the Armour Roll). */
  savagery?: Player;
  /** No Turnover unless the player held the ball (Animal Savagery, Saboteur). */
  noTurnover?: boolean;
  /** Between two Turns (a Sports-Wizard's spell, p.149): never a Turnover. */
  betweenTurns?: boolean;
  /** A modifier that must be applied to the Armour Roll (Fireball +1, p.149). */
  armourMod?: number;
  reason: string;
}

export interface DownResult {
  /** The player avoided going down (Steady Footing). */
  avoided: boolean;
  /** The player is no longer on the pitch (KO / Casualty). */
  removed: boolean;
}

/**
 * A player goes to the ground (p.39-40). Handles Steady Footing, Safe Pair of
 * Hands, Turnovers, the Armour and Injury Rolls and the ball bouncing.
 */
export function goDown(ctx: Ctx, p: Player, cause: DownCause): DownResult {
  const s = ctx.s;
  const rule = cause.kind === 'knockedDown' ? R.knockedDown : cause.kind === 'fellOver' ? R.fallsOver : R.placedProne;
  const act = s.turn.activation;
  const isActivePlayer = !!act && act.playerId === p.id;

  // Steady Footing (p.136): a 6 avoids being Knocked Down or Falling Over.
  if (cause.kind !== 'placedProne' && canUse(p, 'steadyFooting')) {
    const sf = rollTest(ctx, {
      kind: 'steadyFooting',
      player: p,
      label: `${label(p)} Steady Footing`,
      target: 6,
      mods: [],
      rule: { page: 136, title: 'Steady Footing' },
      teamReroll: true,
      proAllowed: true,
      onFail: 'goes down',
    });
    if (sf.success) {
      ctx.emit('status', `${label(p)} keeps their footing (Steady Footing) and stays Standing${isActivePlayer ? '; no Turnover' : ''}.`, { page: 136, title: 'Steady Footing' });
      return { avoided: true, removed: false };
    }
  }

  // Saboteur (p.135) is used while going down, so it is checked while the player is still Standing.
  const saboteurReady = cause.kind === 'knockedDown' && !!cause.inBlock && !!cause.by && cause.by.team !== p.team && canUse(p, 'saboteur') && !gated('saboteur');
  const hadBall = hasBall(s, p);
  let ballPlaced = false;
  // Safe Pair of Hands (p.135)
  if (hadBall && canUse(p, 'safePairOfHands') && p.pos) {
    const free = neighbours(p.pos).filter((c) => !playerAt(s, c));
    if (free.length) {
      const choice = ctx.ask({
        type: 'safePairOfHands',
        team: p.team,
        prompt: `${label(p)} is going down with the ball. Use Safe Pair of Hands to place it in an adjacent unoccupied square?`,
        options: [
          ...free.map((c) => ({ id: `${c.x},${c.y}`, label: `Place the ball in ${fmt(c)}`, square: c })),
          { id: 'no', label: 'Let the ball bounce' },
        ],
        rule: { page: 135, title: 'Safe Pair of Hands' },
      });
      if (choice !== 'no') {
        const [x, y] = choice.split(',').map(Number);
        s.ball = { kind: 'ground', pos: { x, y } };
        ballPlaced = true;
        ctx.emit('ball', `${label(p)} places the ball in ${fmt({ x, y })} (Safe Pair of Hands).`, { page: 135, title: 'Safe Pair of Hands' });
      }
    }
  }

  p.stance = 'prone';
  p.distracted = false;
  const landedOnBall = s.ball.kind === 'ground' && !!p.pos && s.ball.pos.x === p.pos.x && s.ball.pos.y === p.pos.y;
  const verb = cause.kind === 'knockedDown' ? 'is Knocked Down' : cause.kind === 'fellOver' ? 'Falls Over' : 'is Placed Prone';
  ctx.emit('status', `${label(p)} ${verb} in ${fmt(p.pos)} (${cause.reason}).`, rule, { playerId: p.id, kind: cause.kind });

  if (p.rooted) {
    p.rooted = false;
    ctx.emit('note', `${label(p)} is no longer Rooted.`, { page: 137, title: 'Take Root' });
  }
  // Turnovers (p.35) — none between two Turns (a Sports-Wizard's spell).
  if (p.team === s.turn.active && !cause.betweenTurns) {
    if (cause.noTurnover) {
      if (hadBall) ctx.setTurnover(`${label(p)} went down with the ball`, R.turnover);
    } else {
      if (cause.kind === 'fellOver' && isActivePlayer) ctx.setTurnover(`${label(p)} fell over`, R.turnover);
      if (cause.kind === 'knockedDown') ctx.setTurnover(`${label(p)} was Knocked Down`, R.turnover);
      if (cause.kind === 'placedProne' && hadBall) ctx.setTurnover(`${label(p)} was Placed Prone with the ball`, R.turnover);
    }
  }
  if (isActivePlayer && act) act.over = true;

  const from = p.pos;
  if (landedOnBall && from) {
    ctx.emit('ball', `The loose ball in ${fmt(from)} bounces away from the fallen player.`, R.scatter);
    bounce(ctx, from);
  }
  let removed = false;
  if (saboteurReady && cause.by && saboteur(ctx, p, cause.by)) {
    removed = true;
  } else if (hasSkill(p, 'ballAndChain')) {
    // Ball & Chain (p.124): an Injury Roll straight away, Stunned counts as Knocked-out.
    ctx.emit('note', `${label(p)} has Ball & Chain: an Injury Roll is made at once (Stunned counts as Knocked-out).`, { page: 124, title: 'Ball & Chain' });
    removed = injuryRoll(ctx, p, [], false, { stunnedAsKO: true, credit: casualtyCredit(p, cause) });
  } else if (cause.kind !== 'placedProne') {
    removed = armourAndInjury(ctx, p, cause);
  }
  if (hadBall && !ballPlaced && from) {
    ctx.emit('ball', `The ball bounces from ${fmt(from)}.`, R.scatter);
    bounce(ctx, from);
  }
  return { avoided: false, removed };
}

/**
 * A +1 a player may apply to the Armour Roll or the Injury Roll after seeing it (Mighty Blow, Arm Bar, Dirty
 * Player, Lethal Flight), or a Star Player's once-per-game modifier ('star': The Mighty Zug, Grim Ironjaw, Ivan
 * 'the Animal' Deathshroud, Rumbelow Sheepskin, Rashnak Backstabber) — `value` (default 1) and the roll(s) it may
 * go to (`stage`, default either).
 */
export interface ModSource {
  who: Player;
  skill: 'mightyBlow' | 'armBar' | 'dirtyPlayer' | 'lethalFlight' | 'star';
  used: boolean;
  value?: number;
  stage?: 'armour' | 'injury' | 'either';
}

export const MOD_SOURCE_NAME: Record<ModSource['skill'], string> = { mightyBlow: 'Mighty Blow', armBar: 'Arm Bar', dirtyPlayer: 'Dirty Player', lethalFlight: 'Lethal Flight', star: 'Star Player rule' };
export const MOD_SOURCE_PAGE: Record<ModSource['skill'], number> = { mightyBlow: 131, armBar: 123, dirtyPlayer: 127, lethalFlight: 130, star: 148 };

function srcName(src: ModSource): string {
  const st = src.skill === 'star' && src.who.star ? STAR_BY_ID[src.who.star] : undefined;
  return st ? `${st.rule.name} (${st.name})` : MOD_SOURCE_NAME[src.skill];
}
function srcRule(src: ModSource): { page: number; title: string } {
  const st = src.skill === 'star' && src.who.star ? STAR_BY_ID[src.who.star] : undefined;
  return st ? starRuleRef(st) : { page: MOD_SOURCE_PAGE[src.skill], title: MOD_SOURCE_NAME[src.skill] };
}
const srcValue = (src: ModSource) => src.value ?? 1;

/**
 * Helmut Wulf's Old Pro (p.202): once per game Helmut may use Pro (3+) to re-roll ONE die of an Armour Roll — his
 * own armour (to keep it whole) or the armour of an opponent he Knocks Down or hits with the chainsaw (to break
 * it). Returns the new faces, or null when not used. Asked only when it could change the result.
 */
export function oldPro(ctx: Ctx, helmut: Player | undefined, target: Player, faces: number[], broken: boolean, breaks: (a: number, b: number) => boolean): number[] | null {
  if (!helmut || !starReady(ctx.s, helmut, 'helmut') || !hasSkill(helmut, 'pro')) return null;
  const mine = helmut.id === target.id;
  if (mine ? !broken : broken) return null;
  const c = ctx.ask({
    type: 'starRule',
    team: helmut.team,
    prompt: `Old Pro (Helmut Wulf, once per game): use Pro (3+) to re-roll one die of the Armour Roll ${faces[0]}+${faces[1]} ${mine ? 'against him' : `against ${label(target)}`}?`,
    options: [
      { id: 'd0', label: `Re-roll the ${faces[0]}` },
      { id: 'd1', label: `Re-roll the ${faces[1]}` },
      { id: 'no', label: 'No' },
    ],
    rule: starRuleRef(STAR_BY_ID.helmut),
    context: { star: 'helmut', pick: true },
  });
  if (c === 'no') return null;
  spendStar(ctx, helmut, `Pro to re-roll one die of the Armour Roll.`);
  const pr = ctx.roll({ dice: [6], interpret: ([n]) => (n >= 3 ? 'S' : 'F'), cacheKey: 'pro3', by: helmut.team, judge: (v) => (v === 'S' ? 1 : -1) });
  ctx.emit('roll', `Pro: rolled ${pr.faces[0]}; needs 3+ — ${pr.value === 'S' ? 'the die is re-rolled' : 'no re-roll'}.`, { page: 133, title: 'Pro' });
  if (pr.value !== 'S') return null;
  const i = c === 'd0' ? 0 : 1;
  const one = ctx.roll({ dice: [6], interpret: ([n]) => n, cacheKey: 'd6plain', by: target.team === 'A' ? 'B' : 'A', judge: (n) => { const o = faces.slice(); o[c === 'd0' ? 0 : 1] = n; return breaks(o[0], o[1]) ? 1 : -1; } });
  const out = faces.slice();
  out[i] = one.value;
  ctx.emit('roll', `Old Pro: the ${faces[i]} is re-rolled → ${one.value}. Armour Roll ${out[0]}+${out[1]} — ${breaks(out[0], out[1]) ? 'armour broken' : 'armour holds'}.`, starRuleRef(STAR_BY_ID.helmut), { playerId: target.id, faces: out, armour: true, broken: breaks(out[0], out[1]) });
  return out;
}

/**
 * Star Player modifiers when `by` Knocks Down the opposition player `p` with a Block (once per game each, applied
 * after the roll): The Mighty Zug's Crushing Blow (+1 Armour, p.205), Grim Ironjaw's Slayer (+1 against a Big Guy,
 * p.200), Ivan 'the Animal' Deathshroud's Dwarven Scourge (+1, +2 against a Dwarf, p.202), Rumbelow Sheepskin's
 * Ram (+1, p.207).
 */
function starBlockSources(s: GameState, by: Player, p: Player): ModSource[] {
  if (starReady(s, by, 'mightyZug')) return [{ who: by, skill: 'star', used: false, value: 1, stage: 'armour' }];
  if (starReady(s, by, 'grim') && p.keywords.includes('Big Guy')) return [{ who: by, skill: 'star', used: false, value: 1, stage: 'either' }];
  if (starReady(s, by, 'ivan')) return [{ who: by, skill: 'star', used: false, value: p.keywords.includes('Dwarf') ? 2 : 1, stage: 'either' }];
  if (starReady(s, by, 'rumbelow')) return [{ who: by, skill: 'star', used: false, value: 1, stage: 'either' }];
  return [];
}

/** Options for an Injury Roll. */
export interface InjuryOpts {
  /** Player credited with a Casualty (Star Player Points, p.96). */
  credit?: Player;
  /** Ball & Chain (p.124): a Stunned result counts as Knocked-out. */
  stunnedAsKO?: boolean;
  /** Bloodlust bite (p.125): a Casualty counts as Badly Hurt. */
  casAsBadlyHurt?: boolean;
  /** Filled with the two natural dice of the roll (a Foul checks them for a double, p.69). */
  out?: { faces?: number[] };
  /** Plague Ridden (p.133): the blocker whose Block Action caused this Injury Roll. */
  plague?: Player;
  /** The opposition player making this Injury Roll (Wilhelm Chaney's Savage Mauling may re-roll it, p.210). */
  rerollBy?: Player;
}

/** The player credited with causing a Casualty for a player who went down this way (p.96, Arm Bar p.123, Lethal Flight p.130). */
export function casualtyCredit(p: Player, cause: DownCause): Player | undefined {
  if (cause.credit) return cause.credit;
  if (cause.inBlock && cause.by && cause.by.team !== p.team) return cause.by;
  if (cause.kind === 'fellOver' && cause.armBar?.length) return cause.armBar.find((q) => hasSkill(q, 'armBar'));
  return undefined;
}

/** Armour Roll (p.37) and, if broken, Injury Roll (p.66). Returns true if removed from the pitch. */
export function armourAndInjury(ctx: Ctx, p: Player, cause: DownCause): boolean {
  const s = ctx.s;
  const ihs = hasSkill(p, 'ironHardSkin');
  const sources: ModSource[] = [];
  const byOpp = !!(cause.inBlock && cause.by && cause.by.team !== p.team);
  if (byOpp && canUse(cause.by as Player, 'mightyBlow')) sources.push({ who: cause.by as Player, skill: 'mightyBlow', used: false });
  if (cause.kind === 'fellOver' && cause.armBar?.length) {
    const ab = cause.armBar.find((q) => canUse(q, 'armBar'));
    if (ab) sources.push({ who: ab, skill: 'armBar', used: false });
  }
  if (cause.lethalFlight && !gated('lethalFlight') && hasSkill(cause.lethalFlight, 'lethalFlight') && cause.lethalFlight.team !== p.team) sources.push({ who: cause.lethalFlight, skill: 'lethalFlight', used: false });
  if (byOpp) sources.push(...starBlockSources(s, cause.by as Player, p));
  const sav = cause.savagery;
  const claws = !!(((cause.inBlock && cause.by && cause.by.team !== p.team && hasSkill(cause.by, 'claws')) || (sav && hasSkill(sav, 'claws'))) && !ihs);
  const chainsaw = hasSkill(p, 'chainsaw') && !ihs ? 3 : 0;
  // Animal Savagery (p.123): Mighty Blow must be used on the Armour Roll of the team-mate.
  const savMB = sav && hasSkill(sav, 'mightyBlow') && !ihs ? 1 : 0;

  const fixedMods: number[] = [];
  if (chainsaw) fixedMods.push(chainsaw);
  if (savMB) fixedMods.push(savMB);
  // Fireball (p.149): "these modifiers must always be applied" (not a player's modifier, so Iron Hard Skin does not stop it).
  if (cause.armourMod) fixedMods.push(cause.armourMod);
  const fixed = fixedMods.reduce((a, b) => a + b, 0);
  const modTxt = `${chainsaw ? ' +3 Chainsaw' : ''}${savMB ? ' +1 Mighty Blow (Animal Savagery)' : ''}${cause.armourMod ? ` +${cause.armourMod} ${cause.reason}` : ''}`;
  let broken = false;
  let prefix = '';
  for (;;) {
    const armourSources = ihs ? [] : sources.filter((x) => !x.used && (x.stage ?? 'either') !== 'injury');
    const optionalTotal = armourSources.reduce((a, x) => a + srcValue(x), 0);
    const ar = ctx.roll({
      dice: [6, 6],
      // Armour and Injury Rolls are made by the opposing coach (difficulty house rule owner).
      by: p.team === 'A' ? 'B' : 'A',
      interpret: ([a, b]) => {
        const sum = a + b;
        const base = sum + fixed >= p.av || (claws && sum >= 8);
        // how much of the optional modifiers is needed to break (0 = already broken, 99 = impossible)
        let need = 99;
        if (base) need = 0;
        else if (sum + fixed + optionalTotal >= p.av) need = p.av - sum - fixed;
        return { need };
      },
      // Difficulty house rule: broken armour is good for the coach making the roll (the opposing side).
      judge: (v) => (v.need === 0 ? 1 : v.need === 99 ? -1 : 0.5),
      prefer: () => true,
      cacheKey: `armour|${p.av}|${fixed}|${claws}|${optionalTotal}`,
    });
    let [a, b] = ar.faces;
    let need = ar.value.need;
    broken = need === 0;
    ctx.emit('roll', `${prefix}Armour Roll for ${label(p)}: ${a}+${b}=${a + b}${modTxt} vs AV ${p.av}+${claws ? ' (Claws: natural 8+ breaks)' : ''} — ${broken ? 'armour broken' : 'armour holds'}.`, R.armourValue, { playerId: p.id, faces: [a, b], av: p.av, broken, armour: true });
    // Helmut Wulf's Old Pro (p.202): his own armour, or an opponent he Knocked Down in a Block.
    const needOf = (x: number, y: number) => (x + y + fixed >= p.av || (claws && x + y >= 8) ? 0 : x + y + fixed + optionalTotal >= p.av ? p.av - x - y - fixed : 99);
    const helmut = p.star === 'helmut' ? p : byOpp && cause.by?.star === 'helmut' ? cause.by : undefined;
    const redo = oldPro(ctx, helmut, p, [a, b], broken, (x, y) => needOf(x, y) === 0);
    if (redo) {
      [a, b] = redo;
      need = needOf(a, b);
      broken = need === 0;
    }
    const sum = a + b;

    if (!broken && need < 99) {
      // Offer the optional modifiers one at a time (Mighty Blow, Arm Bar, Star Player rules), applied after the roll.
      let extra = 0;
      for (const src of armourSources) {
        if (broken || src.used) continue;
        const nm = srcName(src);
        const v = srcValue(src);
        const breaks = extra + v >= need;
        const onlyArmour = src.stage === 'armour';
        const choice = ctx.ask({
          type: src.skill === 'star' ? 'starRule' : src.skill,
          team: src.who.team,
          prompt: `Armour Roll ${sum} vs AV ${p.av}+. ${label(src.who)} may apply ${nm} (+${v}) to the Armour Roll${breaks ? ' to break the armour' : ''}${onlyArmour ? '' : ', or save it for the Injury Roll'}.`,
          options: [
            { id: 'armour', label: `Apply ${nm} to the Armour Roll` },
            onlyArmour ? { id: 'no', label: 'Do not use it now' } : { id: 'save', label: 'Keep it for the Injury Roll' },
          ],
          rule: srcRule(src),
          context: { stage: 'armour', breaks, ...(src.skill === 'star' ? { star: src.who.star } : {}) },
        });
        if (choice === 'armour') {
          src.used = true;
          extra += v;
          if (extra >= need) broken = true;
          if (src.skill === 'star') spendStar(ctx, src.who, `+${v} to the Armour Roll of ${label(p)}.`);
          ctx.emit('roll', `${nm} +${v} applied to the Armour Roll → ${sum + fixed + extra} — ${broken ? 'armour broken' : 'armour still holds'}.`, R.armourValue, { playerId: p.id, armour: true, broken });
        }
      }
    }
    // Varag Ghoul-Chewer's Krump and Smash (p.210): once per game, re-roll the Armour Roll after Knocking Down an opponent with a Block.
    if (!broken && byOpp && starReady(s, cause.by as Player, 'varag') && askStar(ctx, cause.by as Player, `the armour of ${label(p)} held (${sum}). Re-roll the Armour Roll?`, 'Re-roll the Armour Roll', true)) {
      spendStar(ctx, cause.by as Player, `the Armour Roll against ${label(p)} is re-rolled.`);
      prefix = 'Re-roll — ';
      continue;
    }
    // Josef Bugman's Dwarfen Grit (p.203): once per game, when his armour is broken, the Armour Roll is re-rolled.
    if (broken && starReady(s, p, 'josefBugmanStar') && askStar(ctx, p, `his armour is broken (${sum}). Have the Armour Roll re-rolled?`, 'Re-roll the Armour Roll', true)) {
      spendStar(ctx, p, `the Armour Roll against ${label(p)} is re-rolled.`);
      for (const x of sources) if (x.skill !== 'star') x.used = false;
      prefix = 'Re-roll — ';
      continue;
    }
    break;
  }
  if (!broken) return false;
  // Iron Hard Skin only stops modifiers to the Armour Roll; unused +1s may still go to the Injury Roll.
  const remaining = sources.filter((x) => !x.used && (x.stage ?? 'either') !== 'armour');
  const plague = cause.inBlock && cause.by && cause.by.team !== p.team && hasSkill(cause.by, 'plagueRidden') ? cause.by : undefined;
  return injuryRoll(ctx, p, remaining, false, { credit: casualtyCredit(p, cause), plague, rerollBy: byOpp ? cause.by : undefined });
}

/**
 * Injury result. Standard: the Injury Table / Stunty Injury Table (p.66) — 'cas' then needs a Casualty Roll;
 * Stunty 9 is a Badly Hurt Casualty ('bh'). Blood Bowl Sevens (Spike! 22 p.12): no Casualty Roll — the table
 * gives Badly Hurt ('bh'), Seriously Hurt ('sh') or Dead ('dead') directly. Thick Skull (p.137) turns the
 * lowest Knocked-out result (8, or 7 on a Stunty table) into Stunned on either table.
 */
type InjuryResult = 'stunned' | 'ko' | 'bh' | 'cas' | 'sh' | 'dead';

function injuryResult(p: Player, total: number, sevens = false): InjuryResult {
  const stunty = hasSkill(p, 'stunty');
  const ts = hasSkill(p, 'thickSkull');
  if (sevens) {
    // Sevens Injury Table: 2-7 Stunned, 8-9 KO, 10 BH, 11 SH, 12 Dead. Stunty: 2-6, 7-8, 9-10, 11, 12.
    if (total <= (stunty ? 6 : 7) + (ts ? 1 : 0)) return 'stunned';
    if (total <= (stunty ? 8 : 9)) return 'ko';
    if (total <= 10) return 'bh';
    if (total === 11) return 'sh';
    return 'dead';
  }
  if (stunty) {
    if (total <= (ts ? 7 : 6)) return 'stunned';
    if (total <= 8) return 'ko';
    if (total === 9) return 'bh';
    return 'cas';
  }
  if (total <= (ts ? 8 : 7)) return 'stunned';
  if (total <= 9) return 'ko';
  return 'cas';
}

const INJ_LABEL: Record<InjuryResult, string> = { stunned: 'Stunned', ko: 'Knocked-out', bh: 'Badly Hurt (Casualty)', cas: 'Casualty', sh: 'Seriously Hurt (Casualty)', dead: 'Dead (Casualty)' };

/** Injury Roll (p.66). `crowd`: Injury by the Crowd (p.68). Returns true if removed. */
export function injuryRoll(ctx: Ctx, p: Player, sources: ModSource[], crowd: boolean, opts: InjuryOpts = {}): boolean {
  const n = sources.reduce((a, x) => a + srcValue(x), 0);
  // A Foul needs to know whether the dice were a double (p.69), so the outcome keeps it apart then.
  const dbl = !!opts.out;
  const RS = rulesFor(ctx.s);
  const sevens = RS.injuryTables === 'sevens';
  const rollInjury = () =>
    ctx.roll({
      dice: [6, 6],
      by: p.team === 'A' ? 'B' : 'A',
      interpret: ([a, b]) => {
        const res: string[] = [];
        for (let k = 0; k <= n; k++) res.push(injuryResult(p, a + b + k, sevens));
        return res.join('/') + (dbl ? `|${a === b ? 'D' : 'N'}` : '');
      },
      // Difficulty house rule: the worse the injury, the better for the coach making the roll (the opposing side).
      judge: (v) => INJURY_WORTH[v.split('|')[0].split('/')[0]] ?? 0,
      prefer: () => true,
      cacheKey: `inj${sevens ? '7' : ''}|${hasSkill(p, 'stunty')}|${hasSkill(p, 'thickSkull')}|${n}${dbl ? '|dbl' : ''}`,
    });
  const table = sevens ? (hasSkill(p, 'stunty') ? ' (Sevens Stunty Injury Table)' : ' (Sevens Injury Table)') : hasSkill(p, 'stunty') ? ' (Stunty table)' : '';
  const report = (r: ReturnType<typeof rollInjury>, prefix: string) => {
    const [a, b] = r.faces;
    const res0 = r.value.split('|')[0].split('/')[0] as InjuryResult;
    ctx.emit('roll', `${prefix}Injury Roll for ${label(p)}: ${a}+${b}=${a + b}${table}${hasSkill(p, 'thickSkull') ? ' (Thick Skull)' : ''} — ${INJ_LABEL[res0]}.`, sevens ? RS.refs.injury : hasSkill(p, 'stunty') ? R.stuntyInjury : R.injury, { playerId: p.id, faces: [a, b], result: res0 });
  };
  let ir = rollInjury();
  report(ir, '');
  // Wilhelm Chaney's Savage Mauling (p.210): once per game, re-roll an Injury Roll he makes against an opponent.
  const w = opts.rerollBy;
  if (w && w.team !== p.team && starReady(ctx.s, w, 'wilhelm')) {
    const best = ir.value.split('|')[0].split('/')[n] as InjuryResult;
    if (askStar(ctx, w, `Injury Roll ${ir.faces[0] + ir.faces[1]} (${INJ_LABEL[ir.value.split('|')[0].split('/')[0] as InjuryResult]}). Re-roll it?`, 'Re-roll the Injury Roll', best === 'stunned' || best === 'ko')) {
      spendStar(ctx, w, `the Injury Roll against ${label(p)} is re-rolled.`);
      ir = rollInjury();
      report(ir, 'Re-roll — ');
    }
  }
  const [a, b] = ir.faces;
  if (opts.out) opts.out.faces = [a, b];
  const results = ir.value.split('|')[0].split('/') as InjuryResult[];
  let k = 0;
  for (const src of sources) {
    const v = srcValue(src);
    if (results[k + v] === results[k]) continue; // the modifier would not change anything
    const nm = srcName(src);
    const choice = ctx.ask({
      type: src.skill === 'star' ? 'starRule' : src.skill,
      team: src.who.team,
      prompt: `Injury Roll ${a + b + k} (${INJ_LABEL[results[k]]}). Apply ${nm} (+${v}) to make it ${INJ_LABEL[results[k + v]]}?`,
      options: [
        { id: 'use', label: `Apply ${nm} (+${v})` },
        { id: 'no', label: 'Do not apply it' },
      ],
      rule: srcRule(src),
      context: { stage: 'injury', helps: true, ...(src.skill === 'star' ? { star: src.who.star } : {}) },
    });
    if (choice === 'use') {
      k += v;
      if (src.skill === 'star') spendStar(ctx, src.who, `+${v} to the Injury Roll of ${label(p)}.`);
      ctx.emit('roll', `${nm} +${v} applied to the Injury Roll → ${a + b + k}: ${INJ_LABEL[results[k]]}.`, R.injury);
    }
  }
  let result = results[k];
  if (opts.stunnedAsKO && result === 'stunned') {
    result = 'ko';
    ctx.emit('note', `Ball & Chain: Stunned counts as Knocked-out.`, { page: 124, title: 'Ball & Chain' });
  }
  if (opts.casAsBadlyHurt && (result === 'cas' || result === 'sh' || result === 'dead')) result = 'bh';
  return applyInjury(ctx, p, result, crowd, opts);
}

function applyInjury(ctx: Ctx, p: Player, result: InjuryResult, crowd: boolean, opts: InjuryOpts): boolean {
  const credit = opts.credit;
  if (result === 'stunned') {
    if (crowd) {
      moveOffPitch(p, 'reserves');
      ctx.emit('injury', `${label(p)} would be Stunned by the crowd and is placed in the Reserves Box instead.`, R.crowdInjury, { playerId: p.id, result: 'reserves' });
      return true;
    }
    p.stance = 'stunned';
    ctx.emit('injury', `${label(p)} is Stunned.`, R.injury, { playerId: p.id, result: 'stunned' });
    return false;
  }
  if (result === 'ko') {
    if (useApothecary(ctx, p, `${label(p)} is Knocked-out.`, crowd ? 'Patch-up: the player goes to the Reserves Box instead (Injury by the Crowd).' : 'Patch-up: the player stays in their square, Stunned.')) {
      if (crowd) {
        moveOffPitch(p, 'reserves');
        ctx.emit('injury', `The Apothecary patches up ${label(p)}: Reserves Box instead of the KO box.`, APO, { playerId: p.id, result: 'reserves' });
        return true;
      }
      p.stance = 'stunned';
      ctx.emit('injury', `The Apothecary patches up ${label(p)}, who is Stunned instead of Knocked-out.`, APO, { playerId: p.id, result: 'stunned' });
      return false;
    }
    moveOffPitch(p, 'ko');
    ctx.emit('injury', `${label(p)} is Knocked-out and goes to the KO box.`, R.injury, { playerId: p.id, result: 'ko' });
    return true;
  }
  // Casualty: the player who caused it earns Star Player Points, even if it is later recovered (p.96).
  if (credit && credit.team !== p.team && !crowd) awardSpp(ctx, credit, 'casualty');
  // Casualty. Previews do not explore Regeneration and Casualty rolls (no effect on the rest of the Turn).
  if (ctx.mode === 'plan') {
    moveOffPitch(p, 'cas');
    ctx.emit('injury', `${label(p)} suffers a Casualty.`, R.casualty, { playerId: p.id, result: 'cas' });
    checkLeaderLoss(ctx, p.team);
    return true;
  }
  if (hasSkill(p, 'regeneration')) {
    const rg = ctx.roll({ dice: [6], interpret: ([n]) => (n >= 4 ? 'S' : 'F'), cacheKey: 'regen', prefer: () => true, by: p.team });
    let ok = rg.value === 'S';
    ctx.emit('roll', `Regeneration for ${label(p)}: rolled ${rg.faces[0]}; needs 4+ — ${ok ? 'regenerates' : 'fails'}.`, { page: 135, title: 'Regeneration' });
    // Mortuary Assistant / Plague Doctor (p.145): once per game, re-roll a failed Regeneration roll.
    const helpers = (['mortuaryAssistant', 'plagueDoctor'] as const).filter((id) => induceLeft(ctx.s, p.team, id) > 0);
    if (!ok && helpers.length) {
      const c = ctx.ask({
        type: 'regenReroll',
        team: p.team,
        prompt: `${label(p)} failed to Regenerate. Re-roll it (once per game)?`,
        options: [...helpers.map((id) => ({ id, label: `Use the ${INDUCEMENT_BY_ID[id].name}` })), { id: 'no', label: 'No re-roll' }],
        rule: INDUCE_RULE(helpers[0]),
      });
      if (c !== 'no') {
        spendInduce(ctx.s, p.team, c);
        const rg2 = ctx.roll({ dice: [6], interpret: ([n]) => (n >= 4 ? 'S' : 'F'), cacheKey: 'regen', prefer: () => true, by: p.team });
        ok = rg2.value === 'S';
        ctx.emit('roll', `${INDUCEMENT_BY_ID[c].name}: Regeneration re-rolled — ${rg2.faces[0]}; ${ok ? 'regenerates' : 'fails'}.`, INDUCE_RULE(c), { playerId: p.id });
      }
    }
    if (ok) {
      moveOffPitch(p, 'reserves');
      ctx.emit('injury', `${label(p)} regenerates and is placed in the Reserves Box.`, { page: 135, title: 'Regeneration' }, { playerId: p.id, result: 'reserves' });
      return true;
    }
  }
  let cas = 'Badly Hurt';
  const sevens = rulesFor(ctx.s).injuryTables === 'sevens';
  if (p.frog) {
    // A Frog (Zap!, p.149): no Casualty Roll — automatically Badly Hurt; no Apothecary.
    ctx.emit('roll', `${label(p)} is a Frog: no Casualty Roll — Badly Hurt (Zap!, p.149).`, { page: 149, title: 'Wizard: Zap!' }, { playerId: p.id, result: cas });
  } else if (sevens) {
    // Spike! 22 p.12: "Do not make a Casualty Roll" — the Sevens Injury Table already gave the result.
    cas = result === 'sh' ? 'Seriously Hurt' : result === 'dead' ? 'Dead' : 'Badly Hurt';
    ctx.emit('roll', `${label(p)} suffers a Casualty: ${cas} (Sevens Injury Table — no Casualty Roll${opts.casAsBadlyHurt ? '; treated as Badly Hurt' : ''}).`, rulesFor(ctx.s).refs.injury, { playerId: p.id, result: cas });
    if (ctx.s.teams[p.team].apothecary === 'available') ctx.emit('note', 'Sevens: there is no Casualty Roll to repeat, so the Apothecary cannot patch up a Casualty (it can still patch up a Knocked-out player; see docs/SEVENS_RULES.md, interpretation 2).', rulesFor(ctx.s).refs.injury);
  } else if (result === 'cas') {
    const decay = hasSkill(p, 'decay') ? 1 : 0;
    const cr = ctx.roll({
      dice: [16],
      interpret: ([n]) => casualtyName(n + decay),
      cacheKey: `cas|${decay}`,
      // Difficulty house rule: a worse Casualty is better for the other side.
      judge: (v) => CASUALTY_WORTH[v] ?? 0,
      judgeFor: p.team === 'A' ? 'B' : 'A',
      prefer: () => true,
    });
    cas = cr.value;
    ctx.emit('roll', `Casualty Roll for ${label(p)}: D16 ${cr.faces[0]}${decay ? ' +1 Decay' : ''} — ${cas}.`, R.casualty, { playerId: p.id, result: cas });
  } else if (opts.casAsBadlyHurt) {
    ctx.emit('roll', `${label(p)} suffers a Casualty, treated as Badly Hurt.`, R.casualty);
  } else {
    ctx.emit('roll', `${label(p)} suffers a Badly Hurt Casualty (Stunty Injury Table 9).`, R.stuntyInjury);
  }
  if (!sevens && !p.frog && useApothecary(ctx, p, `${label(p)} is a Casualty (${cas}).`, 'The opposing coach makes a second Casualty Roll and you choose either result; Badly Hurt = patched up to the Reserves Box.')) {
    let second = 'Badly Hurt';
    if (result === 'cas') {
      const decay = hasSkill(p, 'decay') ? 1 : 0;
      const cr2 = ctx.roll({ dice: [16], interpret: ([n]) => casualtyName(n + decay), cacheKey: `cas|${decay}`, prefer: () => true, judge: (v) => CASUALTY_WORTH[v] ?? 0, judgeFor: p.team === 'A' ? 'B' : 'A' });
      second = cr2.value;
      ctx.emit('roll', `Apothecary: second Casualty Roll for ${label(p)}: D16 ${cr2.faces[0]}${decay ? ' +1 Decay' : ''} — ${second}.`, APO, { playerId: p.id, result: second });
    }
    let chosen = cas;
    if (second !== cas) {
      const pick = ctx.ask({
        type: 'apothecary',
        team: p.team,
        prompt: `Apothecary for ${label(p)}: choose the Casualty result to apply.`,
        options: [
          { id: 'first', label: `First roll: ${cas}` },
          { id: 'second', label: `Second roll: ${second}` },
        ],
        rule: APO,
      });
      chosen = pick === 'second' ? second : cas;
    }
    if (chosen === 'Badly Hurt') {
      moveOffPitch(p, 'reserves');
      ctx.emit('injury', `The Apothecary patches up ${label(p)} (Badly Hurt): Reserves Box instead of the Casualty Box.`, APO, { playerId: p.id, result: 'reserves' });
      return true;
    }
    cas = chosen;
  }
  moveOffPitch(p, 'cas');
  p.casualtyResult = cas;
  ctx.emit('injury', `${label(p)} is a Casualty (${cas}) and goes to the Casualty box.`, R.casualty, { playerId: p.id, result: 'cas', casualty: cas });
  // Skrorg Snowpelt's Pump Up the Crowd (p.208): once per game, a Casualty from his Block gives a Team Re-roll for this Drive.
  const sk = opts.rerollBy;
  if (sk && sk.team !== p.team && starReady(ctx.s, sk, 'skrorg')) {
    const t = ctx.s.teams[sk.team];
    t.rerolls += 1;
    t.bonusRerolls = (t.bonusRerolls ?? 0) + 1;
    spendStar(ctx, sk, `${t.name} gain a Team Re-roll until the end of this Drive.`);
  }
  checkLeaderLoss(ctx, p.team);
  if (cas === 'Dead' && opts.plague) plagueRidden(ctx, opts.plague, p);
  if (cas === 'Dead') mastersOfUndeath(ctx, p);
  return true;
}

export const MASTERS_OF_UNDEATH_RULE = { page: 155, title: 'Masters of Undeath' };

/**
 * Masters of Undeath (p.155): once per game, when an opposition player with
 * ST 4 or less and without Stunty suffers a Dead result, the team may Raise
 * the Dead — a Lineman from its Team Roster joins its Reserves Box (even past
 * 16 players). Applied when the Dead result stands (not saved by an Apothecary
 * or Regeneration). In a League the raised player may be hired for free after
 * the game (`applyMatchSpp`).
 */
function mastersOfUndeath(ctx: Ctx, victim: Player): void {
  const s = ctx.s;
  const undead: TeamId = victim.team === 'A' ? 'B' : 'A';
  const t = s.teams[undead];
  const rule = MASTERS_OF_UNDEATH_RULE;
  if (!s.match || !t.specialRules?.includes('Masters of Undeath') || t.raiseDeadUsed) return;
  if (victim.st > 4 || hasSkill(victim, 'stunty')) {
    ctx.emit('note', `Masters of Undeath: ${label(victim)} cannot be raised (${victim.st > 4 ? `ST ${victim.st}, more than 4` : 'Stunty'}).`, rule);
    return;
  }
  const r = ROSTER_BY_ID[t.rosterId ?? ''];
  // Any Lineman position of the Team Roster (Shambling Undead: Skeleton or Zombie).
  const lines = r?.positions.filter((x) => x.keywords.includes('Lineman')) ?? [];
  if (!lines.length) {
    ctx.emit('note', `Masters of Undeath: ${t.name} have no Team Roster Lineman to raise.`, rule);
    return;
  }
  const c = ctx.ask({
    type: 'raiseDead',
    team: undead,
    prompt: `Masters of Undeath (once per game): ${label(victim)} is Dead. Raise the Dead — add a Lineman to your Reserves Box?`,
    options: [...lines.map((x) => ({ id: lines.length === 1 ? 'yes' : `pos:${x.id}`, label: `Raise the Dead: add a ${x.name}` })), { id: 'no', label: 'Not now' }],
    rule,
  });
  if (c === 'no') return;
  const pos = lines.length === 1 ? lines[0] : lines.find((x) => `pos:${x.id}` === c) ?? lines[0];
  t.raiseDeadUsed = true;
  const used = new Set(s.players.filter((q) => q.team === undead).map((q) => q.number));
  let n = 1;
  while (used.has(n)) n++;
  const np = playerFromPosition(s, undead, pos, null, n);
  np.location = 'reserves';
  np.raised = pos.id;
  s.players.push(np);
  ctx.emit('status', `Masters of Undeath: ${t.name} Raise the Dead — ${label(np)} joins the Reserves Box.`, rule, { playerId: np.id });
}

/**
 * Plague Ridden (p.133): once per game, a Dead result (not saved by an
 * Apothecary) caused by this player's Block Action lets the coach add a new
 * Lineman from their Team Roster to the Reserves Box. Not against Big Guys or
 * players with Decay, Regeneration or Stunty. Match play only (the new player
 * needs a Team Roster).
 */
function plagueRidden(ctx: Ctx, by: Player, victim: Player): void {
  const s = ctx.s;
  const rule = { page: 133, title: 'Plague Ridden' };
  if (!s.match || by.plagueUsed || gated('plagueRidden')) return;
  if (victim.keywords.some((k) => k.toLowerCase() === 'big guy') || ['decay', 'regeneration', 'stunty'].some((k) => hasSkill(victim, k))) return;
  const r = ROSTER_BY_ID[s.teams[by.team].rosterId ?? ''];
  const pos = r?.positions.find((x) => x.keywords.includes('Lineman') && x.qty.endsWith('16')) ?? r?.positions.find((x) => x.keywords.includes('Lineman'));
  if (!pos) {
    ctx.emit('note', `Plague Ridden: ${s.teams[by.team].name} have no Team Roster Lineman to add.`, rule);
    return;
  }
  const c = ctx.ask({
    type: 'plagueRidden',
    team: by.team,
    prompt: `Plague Ridden (once per game): add a new ${pos.name} to your Reserves Box?`,
    options: [
      { id: 'yes', label: `Add a ${pos.name}` },
      { id: 'no', label: 'Not now' },
    ],
    rule,
  });
  if (c !== 'yes') return;
  by.plagueUsed = true;
  const used = new Set(s.players.filter((q) => q.team === by.team).map((q) => q.number));
  let n = 1;
  while (used.has(n)) n++;
  const np = playerFromPosition(s, by.team, pos, null, n);
  np.location = 'reserves';
  s.players.push(np);
  ctx.emit('status', `Plague Ridden: ${label(np)} joins ${s.teams[by.team].name} in the Reserves Box.`, rule, { playerId: np.id });
}

const APO = { page: 68, title: 'Apothecaries' };

/** Difficulty house rule: how good an Injury / Casualty result is for the other side (0 = Stunned … 1 = Dead). */
const INJURY_WORTH: Record<string, number> = { stunned: 0, ko: 0.6, cas: 0.9, bh: 0.8, sh: 0.9, dead: 1 };
const CASUALTY_WORTH: Record<string, number> = { 'Badly Hurt': 0.3, 'Seriously Hurt': 0.55, 'Serious Injury': 0.7, 'Lasting Injury': 0.85, Dead: 1 };

function casualtyName(t: number): string {
  return t <= 8 ? 'Badly Hurt' : t <= 10 ? 'Seriously Hurt' : t <= 12 ? 'Serious Injury' : t <= 14 ? 'Lasting Injury' : 'Dead';
}

/**
 * Apothecary (p.68): once per game, Patch-up a Knocked-out player or one who
 * suffered a Casualty. Previews never use it (they assume it is kept).
 */
function useApothecary(ctx: Ctx, p: Player, what: string, effect: string): boolean {
  const t = ctx.s.teams[p.team];
  if (ctx.mode === 'plan') return false;
  // An Apothecary cannot be used on a Frog (Zap!, p.149).
  if (p.frog) return false;
  // The team's own Apothecary first, then Wandering Apothecaries, then a Plague Doctor (pp.145-146), each once per game.
  const source = t.apothecary === 'available' ? 'own' : induceLeft(ctx.s, p.team, 'wanderingApothecary') > 0 ? 'wanderingApothecary' : induceLeft(ctx.s, p.team, 'plagueDoctor') > 0 ? 'plagueDoctor' : null;
  if (!source) return false;
  const name = source === 'own' ? 'the Apothecary' : source === 'wanderingApothecary' ? 'a Wandering Apothecary' : 'the Plague Doctor';
  const choice = ctx.ask({
    type: 'apothecary',
    team: p.team,
    prompt: `${what} Use ${name} (once per game)? ${effect}`,
    options: [
      { id: 'use', label: `Use ${name}` },
      { id: 'keep', label: `Keep ${name}` },
    ],
    rule: source === 'own' ? APO : INDUCE_RULE(source),
  });
  if (choice !== 'use') return false;
  if (source === 'own') t.apothecary = 'used';
  else spendInduce(ctx.s, p.team, source);
  ctx.emit('decision', `${t.name} use ${name} on ${label(p)}.`, source === 'own' ? APO : INDUCE_RULE(source), { playerId: p.id });
  return true;
}

/**
 * Leader (p.130): a Leader Re-roll is lost if every player with Leader has
 * been removed from play as a Casualty or by being Sent-off before it is used.
 */
export function checkLeaderLoss(ctx: Ctx, team: TeamId): void {
  const t = ctx.s.teams[team];
  if (!t.leaderReroll) return;
  const leaders = ctx.s.players.filter((q) => q.team === team && hasSkill(q, 'leader'));
  if (leaders.length && leaders.every((q) => q.location === 'cas' || q.location === 'sentOff')) {
    t.leaderReroll = false;
    ctx.emit('note', `${t.name} lose their unused Leader Re-roll: no player with Leader remains in the game.`, { page: 130, title: 'Leader' });
  }
}

export function moveOffPitch(p: Player, where: 'reserves' | 'ko' | 'cas' | 'sentOff'): void {
  p.location = where;
  p.pos = null;
  p.stance = 'standing';
  p.distracted = false;
}

/** Injury by the Crowd (p.68): Injury Roll without an Armour Roll. */
export function crowdInjury(ctx: Ctx, p: Player): void {
  injuryRoll(ctx, p, [], true);
}

export function isAdjacentTo(p: Player, q: Player): boolean {
  return !!p.pos && !!q.pos && adjacent(p.pos, q.pos);
}

/**
 * Saboteur (p.135): Knocked Down by an opposition Block Action, the player may
 * roll a D6 before the Armour Roll. On a 4+ the blocker is also Knocked Down
 * (no Turnover unless they held the ball) and the saboteur is Knocked-out
 * without an Armour Roll. Returns true if the weapon went off.
 */
function saboteur(ctx: Ctx, p: Player, by: Player): boolean {
  const rule = { page: 135, title: 'Saboteur' };
  const c = ctx.ask({
    type: 'saboteur',
    team: p.team,
    prompt: `${label(p)} has been Knocked Down by ${label(by)}. Set off the sabotaged weapon (D6 4+: ${label(by)} is also Knocked Down and ${label(p)} is Knocked-out)?`,
    options: [
      { id: 'yes', label: 'Roll for Saboteur' },
      { id: 'no', label: 'No' },
    ],
    rule,
  });
  if (c !== 'yes') return false;
  const r = ctx.roll({ dice: [6], interpret: ([n]) => (n >= 4 ? 'boom' : 'dud'), cacheKey: 'sab4', by: p.team, judge: (v) => (v === 'boom' ? 1 : -1) });
  ctx.emit('roll', `Saboteur: rolled ${r.faces[0]} — ${r.value === 'boom' ? 'the sabotaged weapon goes off!' : 'nothing happens'}.`, rule);
  if (r.value !== 'boom') return false;
  if (by.location === 'pitch' && by.stance === 'standing') goDown(ctx, by, { kind: 'knockedDown', reason: 'sabotaged weapon', noTurnover: true });
  if (p.location === 'pitch') applyInjury(ctx, p, 'ko', false, {});
  return true;
}

export const TRAPDOOR_RULE = { page: 143, title: 'Treacherous Trapdoor' };

/**
 * Treacherous Trapdoor (Prayer to Nuffle 1, p.143): when a player enters a Trapdoor square, D6: on a 1
 * they fall through — an Injury Roll as if Pushed into the Crowd; a ball they held Bounces from the
 * Trapdoor. Interpretation: the roll is made once the move into the square is complete (after any
 * Dodge / Rush for it, or after a Block is resolved for a pushed player), and a player of the active
 * team who falls through during their own activation causes a Turnover. Returns true if they fell.
 */
export function trapdoorCheck(ctx: Ctx, p: Player): boolean {
  const s = ctx.s;
  if (!p.pos || p.location !== 'pitch' || !(hasPrayer(s, 'A', 1) || hasPrayer(s, 'B', 1))) return false;
  if (!trapdoors(s).some((t) => t.x === p.pos!.x && t.y === p.pos!.y)) return false;
  const r = ctx.roll({ dice: [6], interpret: ([n]) => (n === 1 ? 'F' : 'S'), cacheKey: 'trapdoor' });
  const from = { ...p.pos };
  ctx.emit('roll', `Treacherous Trapdoor in ${fmt(from)}: ${label(p)} rolls ${r.faces[0]} — ${r.value === 'F' ? 'the Trapdoor falls open!' : 'it holds'}.`, TRAPDOOR_RULE, { playerId: p.id });
  if (r.value === 'S') return false;
  const hadBall = hasBall(s, p);
  const active = s.turn.activation?.playerId === p.id;
  injuryRoll(ctx, p, [], true);
  if (p.location === 'pitch') moveOffPitch(p, 'reserves');
  if (active) ctx.setTurnover(`${label(p)} fell through a Trapdoor`, TRAPDOOR_RULE);
  if (hadBall) {
    s.ball = { kind: 'ground', pos: from };
    ctx.emit('ball', `The ball bounces from the Trapdoor in ${fmt(from)}.`, R.scatter);
    bounce(ctx, from);
  }
  return true;
}
