/**
 * Star Player special rules used "at the start of an activation" or that change an Action (V5 step 5).
 *
 * A player action input with `starRule: true` uses the selected Star Player's rule when the activation starts
 * (after the Action is declared and after any activation roll); its choices (target, square, skill) are asked as
 * `starRule` decisions, so the interface and the computer answer them like any other decision.
 *
 *  - The activation goes on afterwards: Kiroth Krakeneye's Black Ink, Zolcath the Zoat's "Excuse me, are you a
 *    Zoat?", Estelle la Veneaux's Baleful Hex, Hakflem Skuttlespike's Treacherous, Ivar Eriksson's Raiding Party,
 *    Grombrindal's Wisdom of the White Dwarf, Rodney Roachbait's Catch of the Day, Jeremiah Kool's The Flashing Blade
 *    (Stab, then a Move Action), Grak's I'll Carry You (Crumbleberry is set down at the end of the activation), and
 *    Boa Kon'ssstriktr's Look Into My Eyes when the D6 is a 1, Gretchen Wächter's Incorporeal (no Dodge rolls for
 *    the rest of the activation).
 *  - The activation ends: Thorsson Stoutmead's Beer Barrel Bash, Zzharg Madeye's "Blastin' Solves Everything",
 *    Swiftvine Glimmershard's Furious Outburst (the team's Blitz), Boa's Look Into My Eyes on 2+.
 *  - Action variants: Maple Highgrove's Vicious Vines (a Block 2 squares away), Nobbla Blackwart's Kick 'em While
 *    They're Down! (Chainsaw Attack on a Prone or Stunned player), Bilerot Vomitflesh's Putrid Regurgitation
 *    (Projectile Vomit), Cindy Piewhistle's All You Can Eat (two bombs).
 */
import { adjacent, dist, eq, fmt, inBounds, neighbours } from './board';
import { ballDisplacedBy, checkTouchdown } from './ball';
import { ActionStop, Ctx, IllegalAction } from './context';
import { goDown } from './injury';
import { R } from './rules';
import { specialArmour } from './specials';
import { foulAppearance, targetReactions } from './reactions';
import { askStar, grantTempSkill, spendStar, STAR_BY_ID, starReady, starRuleRef } from './stars';
import { hasBall, hasTackleZone, isOpen, label, other, pitchPlayers, playerAt } from './state';
import type { Activation, ActionType, Coord, DecisionOption, GameState, Player, SpecialId } from './types';

export interface StartRuleInfo {
  star: string;
  name: string;
  summary: string;
  /** The Actions it can be used with (undefined = any). */
  actions?: ActionType[];
  special?: SpecialId;
  /** The activation always ends after it (the interface offers it as a one-click Action). */
  ends: boolean;
}

const INFO: Record<string, Omit<StartRuleInfo, 'star' | 'name' | 'summary'>> = {
  kiroth: { ends: false },
  gretchen: { ends: false },
  zolcath: { ends: false },
  estelle: { ends: false },
  boa: { ends: false },
  hakflem: { ends: false },
  ivar: { ends: false },
  grombrindal: { ends: false },
  rodney: { ends: false },
  grak: { ends: false },
  jeremiahKool: { ends: false, actions: ['move'] },
  thorsson: { ends: true },
  zzharg: { ends: true },
  swiftvine: { ends: true },
  maple: { ends: true, actions: ['block'] },
  nobbla: { ends: true, actions: ['special'], special: 'chainsaw' },
  bilerot: { ends: true, actions: ['special'], special: 'projectileVomit' },
  cindy: { ends: false, actions: ['special'], special: 'bombardier' },
};

/** The Star Player's rule that is used with `starRule: true`, or null if it has none. */
export function startRuleInfo(p: Player): StartRuleInfo | null {
  const st = p.star ? STAR_BY_ID[p.star] : undefined;
  const i = st ? INFO[st.id] : undefined;
  return st && i ? { star: st.id, name: st.rule.name, summary: st.rule.summary, ...i } : null;
}

const within = (a: Player, b: Player, n: number) => !!a.pos && !!b.pos && dist(a.pos, b.pos) <= n;
const opps = (s: GameState, p: Player) => pitchPlayers(s, other(p.team));
const mates = (s: GameState, p: Player) => pitchPlayers(s, p.team).filter((q) => q.id !== p.id);
const freeSq = (s: GameState, c: Coord) => inBounds(c) && !playerAt(s, c);

/** Candidates for each rule (players or squares); empty = cannot be used now. */
function candidates(s: GameState, p: Player): Player[] {
  switch (p.star) {
    case 'kiroth':
    case 'jeremiahKool':
      return hasTackleZone(p) ? opps(s, p).filter((q) => q.stance === 'standing' && within(p, q, 1)) : [];
    case 'zolcath':
      return opps(s, p).filter((q) => q.stance === 'standing' && within(p, q, 3));
    case 'estelle':
      return opps(s, p).filter((q) => within(p, q, 5));
    case 'boa':
      return hasTackleZone(p) ? opps(s, p).filter((q) => hasBall(s, q) && within(p, q, 1)) : [];
    case 'hakflem':
      return mates(s, p).filter((q) => hasBall(s, q) && within(p, q, 1));
    case 'ivar':
      return mates(s, p).filter((q) => isOpen(s, q) && within(p, q, 5) && ivarSquares(s, q).length > 0);
    case 'grombrindal':
      return mates(s, p).filter((q) => within(p, q, 2) && GROMBRINDAL_SKILLS.some((k) => !q.skills.some((x) => x.id === k)));
    case 'thorsson':
    case 'zzharg':
      return opps(s, p).filter((q) => q.stance === 'standing' && within(p, q, 3));
    case 'swiftvine':
      return p.stance === 'standing' && !s.turn.used.blitz ? opps(s, p).filter((q) => q.stance === 'standing' && within(p, q, 3) && neighbours(q.pos as Coord).some((c) => freeSq(s, c) || (!!p.pos && eq(c, p.pos)))) : [];
    case 'grak': {
      const c = s.players.find((q) => q.team === p.team && q.star === 'crumbleberry' && q.location === 'pitch' && q.pos);
      return c && within(p, c, 1) && !hasBall(s, c) ? [c] : [];
    }
    case 'maple':
      return hasTackleZone(p) ? opps(s, p).filter((q) => q.stance === 'standing' && !!q.pos && !!p.pos && dist(p.pos, q.pos) === 2) : [];
    case 'nobbla':
      return p.stance === 'standing' ? opps(s, p).filter((q) => q.stance !== 'standing' && within(p, q, 1)) : [];
    case 'bilerot':
      return p.stance === 'standing' ? opps(s, p).filter((q) => q.stance === 'standing' && within(p, q, 1)) : [];
    default:
      return [];
  }
}

const GROMBRINDAL_SKILLS = ['breakTackle', 'dauntless', 'mightyBlow', 'sureFeet'];

function ivarSquares(s: GameState, q: Player): Coord[] {
  if (!q.pos) return [];
  return neighbours(q.pos).filter((c) => freeSq(s, c) && !(s.ball.kind === 'ground' && eq(s.ball.pos, c)) && opps(s, q).some((o) => hasTackleZone(o) && !!o.pos && adjacent(o.pos, c)));
}

/**
 * Why Star Player `p` cannot use their start-of-activation rule with `action` now (null = they can). Checked
 * before the Action is declared; activation rolls come after it.
 */
export function startRuleReason(s: GameState, p: Player, action?: ActionType, special?: SpecialId): string | null {
  const info = startRuleInfo(p);
  if (!info) return 'This player has no Star Player rule to use at the start of the activation.';
  if (!starReady(s, p, info.star)) return `${info.name} has already been used (${STAR_BY_ID[info.star].rule.per === 'half' ? 'once per half' : STAR_BY_ID[info.star].rule.per === 'drive' ? 'once per Drive' : 'once per game'}).`;
  if (s.turn.activation && s.turn.activation.playerId === p.id) return `${info.name} is used at the start of the activation.`;
  if (action && info.actions && !info.actions.includes(action)) return `${info.name} is used with a ${info.actions.join(' / ')} Action.`;
  if (info.special && special && info.special !== special) return `${info.name} is used with the ${info.special} Special Action.`;
  if (p.star === 'rodney') {
    if (p.stance !== 'standing') return 'Catch of the Day: Rodney must be Standing at the start of his activation.';
    if (!(s.ball.kind === 'ground' && p.pos && dist(p.pos, s.ball.pos) <= 3)) return 'Catch of the Day: the ball must be on the ground within 3 squares.';
    return null;
  }
  if (p.star === 'cindy' || p.star === 'gretchen') return null;
  if (!candidates(s, p).length) {
    const why: Record<string, string> = {
      kiroth: 'no opposition player is Marked by Kiroth',
      jeremiahKool: 'no opposition player is Marked by Jeremiah',
      zolcath: 'no Standing opposition player within 3 squares',
      estelle: 'no opposition player within 5 squares',
      boa: 'Boa is not Marking the ball carrier',
      hakflem: 'no team-mate next to Hakflem holds the ball',
      ivar: 'no Open team-mate within 5 squares can step next to an opponent',
      grombrindal: 'no team-mate within 2 squares',
      thorsson: 'no Standing opposition player within 3 squares',
      zzharg: 'no Standing opposition player within 3 squares',
      swiftvine: s.turn.used.blitz ? 'the Blitz of this Turn has been used (Furious Outburst counts as the Blitz)' : 'no Standing opposition player within 3 squares',
      grak: 'Grak is not next to Crumbleberry (who must not hold the ball)',
      maple: 'no Standing opposition player exactly 2 squares away',
      nobbla: 'no Prone or Stunned opposition player next to Nobbla',
      bilerot: 'no Standing opposition player next to Bilerot',
    };
    return `${info.name}: ${why[p.star as string] ?? 'not possible now'}.`;
  }
  return null;
}

function pickAsk<T extends { id: string }>(ctx: Ctx, p: Player, prompt: string, list: T[], opt: (x: T) => DecisionOption, extra: DecisionOption[] = []): T | null {
  const st = STAR_BY_ID[p.star as string];
  const id = ctx.ask({ type: 'starRule', team: p.team, prompt: `${st.name} — ${st.rule.name}: ${prompt}`, options: [...list.map(opt), ...extra], rule: starRuleRef(st), context: { star: st.id, pick: true } });
  return list.find((x) => x.id === id) ?? null;
}
const playerOpt = (q: Player): DecisionOption => ({ id: q.id, label: `${label(q)} (${fmt(q.pos)})`, square: q.pos ?? undefined });
const sqId = (c: Coord) => `${c.x},${c.y}`;
function pickSquare(ctx: Ctx, p: Player, prompt: string, squares: Coord[], extra: DecisionOption[] = []): Coord | null {
  const list = squares.map((c) => ({ id: sqId(c), c }));
  const got = pickAsk(ctx, p, prompt, list, (x) => ({ id: x.id, label: fmt(x.c), square: x.c }), extra);
  return got ? got.c : null;
}

/**
 * Use Star Player `p`'s start-of-activation rule (after the Action is declared). Throws ActionStop when the
 * activation ends because of it.
 */
export function useStartRule(ctx: Ctx, p: Player, act: Activation, preset: { target?: string } = {}): void {
  const s = ctx.s;
  const st = STAR_BY_ID[p.star as string];
  const rl = starRuleRef(st);
  // The rule's target chosen in advance (input.starTarget) answers the first "choose a player" question.
  const pick = <T extends { id: string }>(c: Ctx, who: Player, prompt: string, list: T[], opt: (x: T) => DecisionOption, extra: DecisionOption[] = []): T | null => {
    const pre = preset.target ? list.find((x) => x.id === preset.target) : undefined;
    return pre ?? pickAsk(c, who, prompt, list, opt, extra);
  };
  const d6 = (key: string, hope: (n: number) => boolean) => {
    const r = ctx.roll({ dice: [6], interpret: ([n]) => n, cacheKey: key, by: p.team, prefer: (n) => hope(n) });
    return r.value;
  };
  switch (p.star) {
    case 'kiroth':
    case 'zolcath': {
      const q = pick(ctx, p, 'choose the opposition player who becomes Distracted.', candidates(s, p), playerOpt);
      if (!q) return;
      q.distracted = true;
      spendStar(ctx, p, `${label(q)} becomes Distracted until they are next activated.`);
      return;
    }
    case 'estelle': {
      const q = pick(ctx, p, 'choose an opposition player within 5 squares (D6 2+: Distracted and cannot be activated in their next Turn).', candidates(s, p), playerOpt);
      if (!q) return;
      const n = d6('hex2', (x) => x >= 2);
      if (n >= 2) {
        q.distracted = q.stance === 'standing';
        q.hexed = { half: s.turn.half, turn: s.teams[q.team].turn + 1 };
      }
      spendStar(ctx, p, `D6 ${n} — ${n >= 2 ? `${label(q)} becomes Distracted and cannot be activated during their team's next Turn` : 'nothing happens'}.`);
      return;
    }
    case 'boa': {
      const q = candidates(s, p)[0];
      const n = d6('boa2', (x) => x >= 2);
      if (n < 2) {
        spendStar(ctx, p, `D6 ${n} — nothing happens.`);
        return;
      }
      s.ball = { kind: 'held', playerId: p.id };
      spendStar(ctx, p, `D6 ${n} — ${label(q)} loses the ball and ${label(p)} takes it; his activation ends.`);
      ctx.emit('ball', `${label(p)} has the ball.`, rl, { holder: p.id });
      act.over = true;
      checkTouchdown(ctx, false);
      throw new ActionStop('look into my eyes');
    }
    case 'hakflem': {
      const q = pick(ctx, p, 'take the ball from this team-mate (who is Knocked Down, no Turnover)?', candidates(s, p), playerOpt);
      if (!q) return;
      s.ball = { kind: 'held', playerId: p.id };
      spendStar(ctx, p, `${label(p)} takes the ball from ${label(q)}, who is Knocked Down (no Turnover).`);
      goDown(ctx, q, { kind: 'knockedDown', reason: 'Treacherous', noTurnover: true });
      return;
    }
    case 'ivar': {
      const q = pick(ctx, p, 'choose an Open team-mate within 5 squares to move 1 square (ending Marking an opponent).', candidates(s, p), playerOpt);
      if (!q) return;
      const to = pickSquare(ctx, p, `where does ${label(q)} move?`, ivarSquares(s, q));
      if (!to) return;
      const from = q.pos as Coord;
      q.pos = { ...to };
      spendStar(ctx, p, `${label(q)} moves ${fmt(from)} → ${fmt(to)}.`);
      ctx.emit('move', `${label(q)} moves ${fmt(from)} → ${fmt(to)} (Raiding Party).`, rl, { playerId: q.id, from, to });
      return;
    }
    case 'grombrindal': {
      const q = pick(ctx, p, 'choose a team-mate within 2 squares.', candidates(s, p), playerOpt);
      if (!q) return;
      const skills = GROMBRINDAL_SKILLS.filter((k) => !q.skills.some((x) => x.id === k)).map((id) => ({ id }));
      const names: Record<string, string> = { breakTackle: 'Break Tackle', dauntless: 'Dauntless', mightyBlow: 'Mighty Blow', sureFeet: 'Sure Feet' };
      const k = pick(ctx, p, `which skill does ${label(q)} gain until the end of the Turn?`, skills, (x) => ({ id: x.id, label: names[x.id] }));
      if (!k) return;
      grantTempSkill(q, k.id, 'turn');
      spendStar(ctx, p, `${label(q)} gains ${names[k.id]} until the end of the Turn.`);
      return;
    }
    case 'rodney': {
      const n = d6('rodney3', (x) => x >= 3);
      if (n >= 3) {
        s.ball = { kind: 'held', playerId: p.id };
        spendStar(ctx, p, `D6 ${n} — ${label(p)} hooks the ball and has it.`);
        checkTouchdown(ctx, true);
      } else spendStar(ctx, p, `D6 ${n} — nothing happens.`);
      return;
    }
    case 'jeremiahKool': {
      const q = pick(ctx, p, 'Stab this opposition player (then a Move Action)?', candidates(s, p), playerOpt);
      if (!q) return;
      spendStar(ctx, p, `${label(p)} stabs ${label(q)} before his Move Action.`);
      foulAppearance(ctx, p, q, act, 'Stab');
      targetReactions(ctx, p, q, { trickster: true });
      if (q.location === 'pitch' && q.stance === 'standing' && q.pos && p.pos && adjacent(q.pos, p.pos)) specialArmour(ctx, q, 0, 'Stab: cannot be modified', { page: 136, title: 'Stab' }, undefined, p);
      else ctx.emit('note', `${label(q)} is no longer next to ${label(p)}: the Stab has no effect.`, rl);
      if (ctx.turnover) throw new ActionStop('turnover');
      return;
    }
    case 'gretchen': {
      act.starFlags = [...(act.starFlags ?? []), 'incorporeal'];
      spendStar(ctx, p, `no Dodge rolls for leaving Marked squares until the end of her activation.`);
      return;
    }
    case 'grak': {
      const c = candidates(s, p)[0];
      c.location = 'reserves';
      c.carriedFrom = { ...(c.pos as Coord) };
      c.pos = null;
      c.carriedBy = p.id;
      grantTempSkill(p, 'breakTackle', 'activation');
      grantTempSkill(p, 'dodge', 'activation');
      spendStar(ctx, p, `${label(p)} picks up Crumbleberry, who is set down next to him at the end of the activation; meanwhile Grak has Break Tackle and Dodge (I'll Carry You).`);
      return;
    }
    case 'thorsson': {
      const q = pick(ctx, p, 'choose a Standing opposition player within 3 squares (D6 3+ Knocked Down, 2 nothing, 1 Thorsson Falls Over; his activation ends).', candidates(s, p), playerOpt);
      if (!q) return;
      const n = d6('thorsson', (x) => x >= 3);
      spendStar(ctx, p, `D6 ${n} — ${n >= 3 ? `${label(q)} is Knocked Down` : n === 2 ? 'nothing happens' : `${label(p)} Falls Over`}; his activation ends.`);
      act.over = true;
      if (n >= 3) goDown(ctx, q, { kind: 'knockedDown', reason: 'Beer Barrel Bash' });
      else if (n === 1) goDown(ctx, p, { kind: 'fellOver', reason: 'Beer Barrel Bash' });
      checkTouchdown(ctx, false);
      throw new ActionStop('beer barrel bash');
    }
    case 'zzharg': {
      const q = pick(ctx, p, 'choose a Standing opposition player within 3 squares to blast (D6 3+ hit, 2 the opposing coach picks a player near them, 1 Zzharg is hit).', candidates(s, p), playerOpt);
      if (!q) return;
      const n = d6('zzharg', (x) => x >= 3);
      let hit: Player = q;
      if (n === 2) {
        const near = s.players.filter((x) => x.location === 'pitch' && x.pos && x.id !== p.id && q.pos && dist(x.pos, q.pos) <= 3);
        const id = ctx.ask({ type: 'starRule', team: other(p.team), prompt: `"Blastin' Solves Everything" (Zzharg Madeye): D6 2 — choose the player within 3 squares of ${label(q)} who is hit instead.`, options: near.map(playerOpt), rule: rl, context: { star: 'zzharg', pick: true } });
        hit = near.find((x) => x.id === id) ?? q;
      } else if (n === 1) hit = p;
      spendStar(ctx, p, `D6 ${n} — ${label(hit)} is hit: an Armour Roll; his activation ends.`);
      act.over = true;
      specialArmour(ctx, hit, 0, "Blastin' Solves Everything", rl);
      checkTouchdown(ctx, false);
      throw new ActionStop('blastin');
    }
    case 'swiftvine': {
      const q = pick(ctx, p, 'choose a Standing opposition player within 3 squares to leap next to and Stab (this is the Blitz of the Turn; the activation then ends).', candidates(s, p), playerOpt);
      if (!q) return;
      const land = pickSquare(ctx, p, `where next to ${label(q)} does she land?`, neighbours(q.pos as Coord).filter((c) => freeSq(s, c) || (!!p.pos && eq(c, p.pos))));
      if (!land) return;
      s.turn.used.blitz = true;
      const from = p.pos as Coord;
      p.pos = { ...land };
      spendStar(ctx, p, `${label(p)} springs ${fmt(from)} → ${fmt(land)} and Stabs ${label(q)} (the Blitz of this Turn).`);
      ctx.emit('move', `${label(p)} is placed in ${fmt(land)} (Furious Outburst).`, rl, { playerId: p.id, from, to: land });
      if (!hasBall(s, p)) ballDisplacedBy(ctx, p);
      foulAppearance(ctx, p, q, act, 'Stab');
      targetReactions(ctx, p, q, { trickster: true });
      if (p.stance === 'standing' && q.location === 'pitch' && q.stance === 'standing' && q.pos && p.pos && adjacent(q.pos, p.pos)) specialArmour(ctx, q, 0, 'Stab: cannot be modified', { page: 136, title: 'Stab' }, undefined, p);
      if (p.location === 'pitch' && p.stance === 'standing' && !ctx.turnover) {
        const here = p.pos as Coord;
        const around: Coord[] = [];
        for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) {
          const c = { x: here.x + dx, y: here.y + dy };
          if ((dx || dy) && freeSq(s, c)) around.push(c);
        }
        const to = pickSquare(ctx, p, 'she may now place herself in an unoccupied square within 3 squares.', around, [{ id: 'stay', label: `Stay in ${fmt(here)}` }]);
        if (to) {
          p.pos = { ...to };
          ctx.emit('move', `${label(p)} is placed in ${fmt(to)} (Furious Outburst).`, rl, { playerId: p.id, from: here, to });
          if (!hasBall(s, p)) ballDisplacedBy(ctx, p);
        }
      }
      act.over = true;
      checkTouchdown(ctx, false);
      throw new ActionStop('furious outburst');
    }
    default:
      return;
  }
}

/** Grak's I'll Carry You: set Crumbleberry down next to Grak at the end of Grak's activation (called before it is cleared). */
export function setDownCarried(ctx: Ctx, grak: Player): void {
  const s = ctx.s;
  const c = s.players.find((q) => q.carriedBy === grak.id);
  if (!c) return;
  c.carriedBy = undefined;
  const from = c.carriedFrom;
  c.carriedFrom = undefined;
  const rl = starRuleRef(STAR_BY_ID.grak);
  const at = grak.location === 'pitch' && grak.pos ? grak.pos : from;
  const squares = at ? neighbours(at).filter((x) => inBounds(x) && !playerAt(s, x)) : [];
  if (!squares.length) {
    ctx.emit('status', `No free square next to Grak: Crumbleberry goes to the Reserves Box.`, rl, { playerId: c.id });
    return;
  }
  const to = pickSquare(ctx, grak, 'where is Crumbleberry set down (next to Grak)?', squares) ?? squares[0];
  c.location = 'pitch';
  c.pos = { ...to };
  c.stance = 'standing';
  ctx.emit('move', `Crumbleberry is set down in ${fmt(to)} (I'll Carry You).`, rl, { playerId: c.id, to });
  ballDisplacedBy(ctx, c);
}

/**
 * Bilerot Vomitflesh's Putrid Regurgitation (p.195): after his Block Action, once per half, he may still use the
 * Projectile Vomit Special Action on an adjacent Standing opponent.
 */
export function bilerotAfterBlock(ctx: Ctx, p: Player, act: Activation, vomit: (target: Player) => void): void {
  const s = ctx.s;
  if (p.star !== 'bilerot' || !starReady(s, p, 'bilerot') || p.location !== 'pitch' || p.stance !== 'standing' || ctx.turnover) return;
  const list = candidates(s, p);
  if (!list.length) return;
  const q = pickAsk(ctx, p, 'use Projectile Vomit now as well?', list, (x) => ({ ...playerOpt(x), label: `Vomit on ${label(x)}` }), [{ id: 'no', label: 'No' }]);
  if (!q) return;
  void act;
  vomit(q);
}

/** A `starRule` decision choosing one of `list` (the first when only one). */
export function chooseStarPlayer(ctx: Ctx, p: Player, prompt: string, list: Player[]): Player {
  if (!list.length) throw new IllegalAction('No player to choose.');
  return pickAsk(ctx, p, prompt, list, playerOpt) ?? list[0];
}

/** Candidates exported for the interface and tests. */
export function startRuleTargets(s: GameState, p: Player): Player[] {
  return candidates(s, p);
}

void R;
void askStar;
void IllegalAction;
