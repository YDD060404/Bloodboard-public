/**
 * Desperate Measures — a Blood Bowl Sevens Inducement (0-5 at 50,000 gp, Spike! Journal 22 p.14; table p.15), V5.5.
 *
 * For every Desperate Measure bought, roll a D8 in the pre-game (re-rolling duplicates); each result can be used once
 * per game:
 *   1 You Dope!              after both teams have set up, before the kick-off: a player's ST or AG +1 for the game;
 *                            at the end of every Drive they took part in, D6 1-2: Knocked-out (no recovery roll then).
 *   2 Razzle-Dazzle          when a player is activated: two different Actions, not two that both contain a Move.
 *   3 Hangover               before either team sets up at the start of the game: an opposition player misses Drive 1.
 *   4 Grudge Match           when a player is activated: a Foul even if the team already declared one this Turn, and
 *                            the player cannot be Sent-off for it.
 *   5 Set Piece              a Pass Action: Accurate on any 2+ (the thrower's PA ignored), caught on any 2+ (the
 *                            receiver's AG ignored).
 *   6 Sports Espionage       when the team suffers a Turnover: two Team Re-rolls after it has been resolved.
 *   7 Discarded Banana Skin  when an opposition player enters the Tackle Zone of one of the team's players: that player
 *                            is Placed Prone and their activation ends (a Turnover only if they held the ball).
 *   8 Magic Scroll           before either team sets up: a free Sports-Wizard Inducement (rulebook p.149).
 *
 * Interpretations (docs/SEVENS_RULES.md): Magic Scroll is used at once in the pre-game (it can only help); Sports
 * Espionage's re-rolls last until half-time like the team's other re-rolls; Discarded Banana Skin is offered when a
 * player moves (a step, Jump or Leap) into a square next to one of the team's Standing players that was not next to
 * them before; "took part in a Drive" (You Dope!) = on the pitch at its kick-off.
 */
import type { Ctx } from './context';
import { adjacent, fmt } from './board';
import { findPlayer, hasTackleZone, label, other, pitchPlayers } from './state';
import type { ActionType, Coord, GameState, Player, RuleRef, TeamId } from './types';

export const DESPERATE_RULE: RuleRef = { page: 15, title: 'Desperate Measures (Spike! Journal 22)' };

export type DesperateId = 'youDope' | 'razzleDazzle' | 'hangover' | 'grudgeMatch' | 'setPiece' | 'sportsEspionage' | 'bananaSkin' | 'magicScroll';

export const DESPERATE: Record<number, { id: DesperateId; name: string; text: string }> = {
  1: { id: 'youDope', name: 'You Dope!', text: 'After both teams have set up, before the kick-off: one of your players has ST or AG improved by 1 for the rest of the game; at the end of each Drive they took part in, D6 1-2: Knocked-out (no recovery roll that time).' },
  2: { id: 'razzleDazzle', name: 'Razzle-Dazzle', text: 'When you activate a player: they may declare two different Actions this activation — not two that both contain a Move Action.' },
  3: { id: 'hangover', name: 'Hangover', text: 'Before either team sets up at the start of the game: one opposition player cannot take part in the first Drive.' },
  4: { id: 'grudgeMatch', name: 'Grudge Match', text: 'When you activate a player: they may Foul even if your team already declared a Foul this Turn, and cannot be Sent-off for this Foul.' },
  5: { id: 'setPiece', name: 'Set Piece', text: 'With a Pass Action: the Pass is Accurate on any roll of 2+ (the thrower’s PA is ignored) and the receiver catches it on any roll of 2+ (their AG is ignored).' },
  6: { id: 'sportsEspionage', name: 'Sports Espionage', text: 'When your team suffers a Turnover: gain two Team Re-rolls once it has been resolved (not for the dice that caused it).' },
  7: { id: 'bananaSkin', name: 'Discarded Banana Skin', text: 'When an opposition player enters the Tackle Zone of one of your players: they are Placed Prone and their activation ends (a Turnover only if they held the ball).' },
  8: { id: 'magicScroll', name: 'Magic Scroll', text: 'Before either team sets up: your team gains a free Sports-Wizard Inducement (rulebook p.149).' },
};

export const DESPERATE_NUMBER: Record<DesperateId, number> = Object.fromEntries(Object.entries(DESPERATE).map(([n, d]) => [d.id, Number(n)])) as Record<DesperateId, number>;

/** The Desperate Measures a team rolled (D8 results). */
export function desperateOf(s: GameState, team: TeamId): number[] {
  return s.match?.desperate?.[team] ?? [];
}

/** The team rolled this Desperate Measure and has not used it yet. */
export function desperateLeft(s: GameState, team: TeamId, id: DesperateId): boolean {
  const n = DESPERATE_NUMBER[id];
  return desperateOf(s, team).includes(n) && !(s.match?.desperateUsed?.[team] ?? []).includes(n);
}

export function spendDesperate(ctx: Ctx, team: TeamId, id: DesperateId, text: string): void {
  const m = ctx.s.match!;
  const n = DESPERATE_NUMBER[id];
  m.desperateUsed = { A: [...(m.desperateUsed?.A ?? [])], B: [...(m.desperateUsed?.B ?? [])] };
  m.desperateUsed[team].push(n);
  ctx.emit('note', `${ctx.s.teams[team].name} use a Desperate Measure — ${DESPERATE[n].name}: ${text}`, DESPERATE_RULE, { team, desperate: id });
}

/** Pre-game: a D8 for each Desperate Measure bought (duplicates re-rolled); Magic Scroll and Hangover are used now. */
export function rollDesperate(ctx: Ctx, team: TeamId, count: number): void {
  const s = ctx.s;
  const m = s.match!;
  const got: number[] = [];
  for (let i = 0; i < Math.min(count, 8); i++) {
    for (let guard = 0; guard < 100; guard++) {
      const r = ctx.roll({ dice: [8], interpret: ([n]) => n, by: team });
      const n = r.value;
      if (got.includes(n)) {
        ctx.emit('roll', `${s.teams[team].name} Desperate Measure: D8 ${n} — already rolled, roll again.`, DESPERATE_RULE, { team });
        continue;
      }
      got.push(n);
      ctx.emit('roll', `${s.teams[team].name} Desperate Measure: D8 ${n} — ${DESPERATE[n].name}. ${DESPERATE[n].text}`, DESPERATE_RULE, { team, desperate: DESPERATE[n].id });
      break;
    }
  }
  m.desperate = { A: [...(m.desperate?.A ?? [])], B: [...(m.desperate?.B ?? [])] };
  m.desperate[team] = got;
  // Magic Scroll: a free Sports-Wizard, used at once (nothing is gained by waiting).
  if (got.includes(8)) {
    const ind = (m.inducements ??= { A: {}, B: {} });
    ind[team] = { ...(ind[team] ?? {}), wizard: (ind[team]?.wizard ?? 0) + 1 };
    spendDesperate(ctx, team, 'magicScroll', 'a free Sports-Wizard joins the team for this game (rulebook p.149).');
  }
}

/** Pre-game, before either team sets up: Hangover — an opposition player misses the first Drive. */
export function askHangover(ctx: Ctx, team: TeamId): void {
  const s = ctx.s;
  if (!desperateLeft(s, team, 'hangover')) return;
  const opp = other(team);
  const list = s.players.filter((p) => p.team === opp && (p.location === 'reserves' || p.location === 'pitch') && !p.benched).sort((a, b) => b.st - a.st || a.number - b.number);
  if (!list.length) return;
  const id = ctx.ask({
    type: 'desperate',
    team,
    prompt: `Hangover (Desperate Measure): choose an opposition player who cannot take part in the first Drive — now or never (before either team sets up).`,
    options: [...list.map((p) => ({ id: p.id, label: `${label(p)} (${p.position}, ST ${p.st}, AG ${p.ag}+)` })), { id: 'no', label: 'Do not use it' }],
    context: { measure: 'hangover' },
    rule: DESPERATE_RULE,
  });
  if (id === 'no') return;
  const p = findPlayer(s, id);
  if (!p) return;
  p.benched = true;
  p.benchedWhy = 'Hangover';
  spendDesperate(ctx, team, 'hangover', `${label(p)} cannot take part in the first Drive.`);
}

/** After both teams have set up, before the kick-off: You Dope! (each team that still has it). */
export function askYouDope(ctx: Ctx): void {
  const s = ctx.s;
  const m = s.match!;
  const order: TeamId[] = [m.kicking as TeamId, other(m.kicking as TeamId)];
  for (const team of order) {
    if (!desperateLeft(s, team, 'youDope')) continue;
    const list = pitchPlayers(s, team).filter((p) => !p.doped).sort((a, b) => a.number - b.number);
    if (!list.length) continue;
    const id = ctx.ask({
      type: 'desperate',
      team,
      prompt: `You Dope! (Desperate Measure): improve a player's ST or AG by 1 for the rest of the game? At the end of every Drive they take part in, a D6 of 1-2 Knocks them Out. (Not now: ask again at the next kick-off.)`,
      options: [{ id: 'no', label: 'Not now' }, ...list.map((p) => ({ id: p.id, label: `${label(p)} (${p.position}, ST ${p.st}, AG ${p.ag}+)` }))],
      context: { measure: 'youDope' },
      rule: DESPERATE_RULE,
    });
    if (id === 'no') continue;
    const p = findPlayer(s, id);
    if (!p) continue;
    const stat = ctx.ask({
      type: 'desperate',
      team,
      prompt: `You Dope!: improve ${label(p)}'s ST (${p.st}) or AG (${p.ag}+)?`,
      options: [
        { id: 'st', label: `ST ${p.st} → ${Math.min(8, p.st + 1)}` },
        { id: 'ag', label: `AG ${p.ag}+ → ${Math.max(1, p.ag - 1)}+` },
      ],
      context: { measure: 'youDopeStat', playerId: p.id },
      rule: DESPERATE_RULE,
    });
    if (stat === 'ag') p.ag = Math.max(1, p.ag - 1);
    else p.st = Math.min(8, p.st + 1);
    p.doped = stat === 'ag' ? 'ag' : 'st';
    spendDesperate(ctx, team, 'youDope', `${label(p)} has ${stat === 'ag' ? `AG ${p.ag}+` : `ST ${p.st}`} for the rest of the game (a D6 at the end of each Drive they take part in: 1-2 Knocked-out).`);
  }
}

/** End of a Drive: doped players who took part roll a D6 — 1-2: Knocked-out, no recovery roll this time. Returns their ids. */
export function youDopeEndOfDrive(ctx: Ctx): Set<string> {
  const s = ctx.s;
  const out = new Set<string>();
  for (const p of s.players) {
    if (!p.doped || !p.inDrive || !(p.location === 'pitch' || p.location === 'reserves')) continue;
    const r = ctx.roll({ dice: [6], interpret: ([n]) => n, by: p.team, judge: (n) => (n <= 2 ? -1 : 1) });
    const ill = r.value <= 2;
    ctx.emit('roll', `You Dope! — ${label(p)}: D6 ${r.value} — ${ill ? 'falls ill and is Knocked-out (no recovery roll at this End of Drive)' : 'fine'}.`, DESPERATE_RULE, { playerId: p.id });
    if (ill) {
      p.location = 'ko';
      p.pos = null;
      out.add(p.id);
    }
  }
  return out;
}

/** A Turnover of `team` has been resolved: Sports Espionage (two Team Re-rolls). */
export function askSportsEspionage(ctx: Ctx, team: TeamId): void {
  const s = ctx.s;
  if (!desperateLeft(s, team, 'sportsEspionage')) return;
  const use = ctx.ask({
    type: 'desperate',
    team,
    prompt: 'Sports Espionage (Desperate Measure): gain two Team Re-rolls now that the Turnover has been resolved? (They last until half-time like your other Team Re-rolls.)',
    options: [
      { id: 'use', label: 'Use Sports Espionage (+2 Team Re-rolls)' },
      { id: 'no', label: 'Keep it for a later Turnover' },
    ],
    context: { measure: 'sportsEspionage' },
    rule: DESPERATE_RULE,
  });
  if (use !== 'use') return;
  s.teams[team].rerolls += 2;
  spendDesperate(ctx, team, 'sportsEspionage', `+2 Team Re-rolls (now ${s.teams[team].rerolls}).`);
}

/**
 * Discarded Banana Skin: `p` has just moved from `from` into its square. If that puts them into the Tackle Zone of a
 * Standing player of a team that still has the measure (a Tackle Zone they were not in before), that team may use it.
 * Returns true when `p` was Placed Prone (the caller ends the activation).
 */
export function bananaSkinWanted(s: GameState, p: Player, from: Coord): Player | null {
  const opp = other(p.team);
  if (!desperateLeft(s, opp, 'bananaSkin') || !p.pos) return null;
  const q = pitchPlayers(s, opp).find((x) => x.pos && hasTackleZone(x) && adjacent(x.pos, p.pos as Coord) && !adjacent(x.pos, from));
  return q ?? null;
}

export function askBananaSkin(ctx: Ctx, p: Player, from: Coord): boolean {
  const s = ctx.s;
  const q = bananaSkinWanted(s, p, from);
  if (!q) return false;
  const opp = q.team;
  const use = ctx.ask({
    type: 'desperate',
    team: opp,
    prompt: `Discarded Banana Skin (Desperate Measure): ${label(p)} has entered the Tackle Zone of ${label(q)} in ${fmt(p.pos)}. Place them Prone and end their activation?${s.ball.kind === 'held' && s.ball.playerId === p.id ? ' They hold the ball: a Turnover.' : ''}`,
    options: [
      { id: 'no', label: 'Not now' },
      { id: 'use', label: 'Use the Banana Skin' },
    ],
    context: { measure: 'bananaSkin', playerId: p.id },
    rule: DESPERATE_RULE,
  });
  if (use !== 'use') return false;
  spendDesperate(ctx, opp, 'bananaSkin', `${label(p)} slips on a Banana Skin in ${fmt(p.pos)}.`);
  return true;
}

/** Razzle-Dazzle: the Actions that contain a Move Action (two of them cannot be declared together). */
const HAS_MOVE: ActionType[] = ['move', 'blitz', 'pass', 'handoff', 'secure', 'foul', 'ttm'];
export function razzlePairReason(first: ActionType, second: ActionType): string | null {
  if (first === second) return 'Razzle-Dazzle: not the same Action twice.';
  if (HAS_MOVE.includes(first) && HAS_MOVE.includes(second)) return 'Razzle-Dazzle: not two Actions that both contain a Move Action.';
  if (first === 'special' || second === 'special') return 'Razzle-Dazzle: Special Actions are not combined in this version.';
  return null;
}
