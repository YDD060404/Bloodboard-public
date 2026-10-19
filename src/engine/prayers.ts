/**
 * Prayers to Nuffle (Inducement, 0-3 at 10,000 gp, p.142; table p.143), V5 step 4.
 *
 * For each Prayer a team bought, roll a D16 in the pre-game (re-rolling results the team already has);
 * the effects last until the end of the game. Players selected by a Prayer are never Star Players. "Randomly select" is a die roll; "Select" is the coach's choice.
 *
 * In Bloodboard Inducements are bought by Tournament / Exhibition teams, which earn no Star Player
 * Points — so the four SPP Prayers (Perfect Passing, Dazzling Catching, Fan Interaction, Fouling
 * Frenzy) are recorded and shown but change nothing in those matches.
 */
import type { Ctx } from './context';
import { hasSkill, label, other, pitchPlayers } from './state';
import type { GameState, Player, RuleRef, TeamId } from './types';
import { SKILL_TABLE, skillCategory } from './advancement';
import { SKILL_BY_ID } from './skills';
import { ROSTER_BY_ID } from './rosters';

export const PRAYER_RULE: RuleRef = { page: 143, title: 'Prayers to Nuffle' };

export const PRAYERS: Record<number, { name: string; text: string }> = {
  1: { name: 'Treacherous Trapdoor', text: 'Each time a player from either team enters a Trapdoor square, roll a D6: on a 1 the player falls through (an Injury Roll as if Pushed into the Crowd; the ball Bounces from the Trapdoor).' },
  2: { name: 'Friends with the Ref', text: 'When you Argue the Call, a 5 or 6 keeps the player.' },
  3: { name: 'Stiletto', text: 'A random player of your team gains Stab for the game.' },
  4: { name: 'Iron Man', text: 'A player of your choice improves their AV by 1 (max 11+) for the game.' },
  5: { name: 'Knuckle Dusters', text: 'A player of your choice gains Mighty Blow for the game.' },
  6: { name: 'Bad Habits', text: 'D3 random opposition players gain Loner (2+) for the game.' },
  7: { name: 'Greasy Cleats', text: 'A random opposition player has MA −1 (min 1) for the game.' },
  8: { name: 'Blessing of Nuffle', text: 'A random player of your team gains Pro for the game.' },
  9: { name: 'Moles under the Pitch', text: 'Opposition players apply −1 when they Rush.' },
  10: { name: 'Perfect Passing', text: 'Completions earn 2 SPP (League play only).' },
  11: { name: 'Dazzling Catching', text: 'Catching a Pass earns 1 SPP (League play only).' },
  12: { name: 'Fan Interaction', text: 'A Casualty from a Push into the Crowd earns the pusher 2 SPP (League play only).' },
  13: { name: 'Fouling Frenzy', text: 'A Casualty from a Foul earns 2 SPP (League play only).' },
  14: { name: 'Throw a Rock', text: 'Once per game, at the start of your Turn before any activation: a random opposition player on the pitch; D6 4+ and they are Knocked Down.' },
  15: { name: 'Under Scrutiny', text: 'An opposition player who Fouls is automatically Sent-off if they break armour.' },
  16: { name: 'Intensive Training', text: 'A random player of your team gains one Primary skill of your choice for the game.' },
};

/** The Prayers a team received in this match (D16 results). */
export function prayersOf(s: GameState, team: TeamId): number[] {
  return s.match?.prayers?.[team] ?? [];
}
export function hasPrayer(s: GameState, team: TeamId, n: number): boolean {
  return prayersOf(s, team).includes(n);
}

/** Players of `team` playing this game (any not already out of the match). Star Players are never selected by a Prayer (p.142). */
function playing(s: GameState, team: TeamId): Player[] {
  return s.players.filter((p) => p.team === team && !p.star && (p.location === 'pitch' || p.location === 'reserves'));
}

/** A random player from `list` (one Dn roll), or undefined. */
function randomPlayer(ctx: Ctx, list: Player[], team: TeamId, why: string): Player | undefined {
  if (!list.length) return undefined;
  if (list.length === 1) return list[0];
  const r = ctx.roll({ dice: [list.length], interpret: ([n]) => n, by: team });
  const p = list[r.value - 1];
  ctx.emit('roll', `${why}: D${list.length} ${r.value} — ${label(p)}.`, PRAYER_RULE, { playerId: p.id });
  return p;
}

function choosePlayer(ctx: Ctx, list: Player[], team: TeamId, prompt: string, order: (a: Player, b: Player) => number): Player | undefined {
  if (!list.length) return undefined;
  const sorted = list.slice().sort(order);
  const id = ctx.ask({ type: 'prayerPick', team, prompt, options: sorted.map((p) => ({ id: p.id, label: `${label(p)} (${p.position}, ST ${p.st}, AV ${p.av}+)` })), rule: PRAYER_RULE });
  return sorted.find((p) => p.id === id) ?? sorted[0];
}

const addSkill = (p: Player, id: string, value?: number) => {
  if (!p.skills.some((k) => k.id === id)) p.skills.push(value !== undefined ? { id, value } : { id });
};

/** Pre-game: roll and apply `count` Prayers to Nuffle for `team` (D16, duplicates re-rolled). */
/**
 * Blood Bowl Sevens (Spike! 22 p.15): its own D8 Prayers to Nuffle table — eight results of the rulebook table with
 * the same wording (Treacherous Trapdoor, Stiletto, Iron Man, Knuckle Dusters, Blessing of Nuffle, Moles under the
 * Pitch, Under Scrutiny, Intensive Training). D8 result → the rulebook's D16 number.
 */
export const SEVENS_PRAYERS: Record<number, number> = { 1: 1, 2: 3, 3: 4, 4: 5, 5: 8, 6: 9, 7: 15, 8: 16 };
export const SEVENS_PRAYER_RULE: RuleRef = { page: 15, title: 'Prayers to Nuffle (Blood Bowl Sevens, Spike! Journal 22)' };

export function rollPrayers(ctx: Ctx, team: TeamId, count: number): void {
  const s = ctx.s;
  const m = s.match!;
  const got: number[] = [];
  const sevens = s.variant === 'sevens';
  const die = sevens ? 8 : 16;
  const rule = sevens ? SEVENS_PRAYER_RULE : PRAYER_RULE;
  for (let i = 0; i < Math.min(count, die); i++) {
    let n = 0;
    let face = 0;
    for (let guard = 0; guard < 100; guard++) {
      const r = ctx.roll({ dice: [die], interpret: ([x]) => x, cacheKey: sevens ? 'prayer8' : 'prayer16', by: team });
      face = r.value;
      n = sevens ? SEVENS_PRAYERS[face] : face;
      if (!got.includes(n)) break;
      ctx.emit('roll', `Prayer to Nuffle (${s.teams[team].name}): D${die} ${face} — already received, rolled again.`, rule);
    }
    got.push(n);
    ctx.emit('roll', `Prayer to Nuffle (${s.teams[team].name}): D${die} ${face} — ${PRAYERS[n].name}: ${PRAYERS[n].text}`, rule, { team, prayer: n });
    applyPrayer(ctx, team, n);
  }
  m.prayers = { A: m.prayers?.A ?? [], B: m.prayers?.B ?? [], [team]: [...(m.prayers?.[team] ?? []), ...got] } as Record<TeamId, number[]>;
}

function applyPrayer(ctx: Ctx, team: TeamId, n: number): void {
  const s = ctx.s;
  const opp = other(team);
  switch (n) {
    case 3: {
      const p = randomPlayer(ctx, playing(s, team), team, 'Stiletto');
      if (p) {
        addSkill(p, 'stab');
        ctx.emit('status', `Stiletto: ${label(p)} gains Stab for the game.`, PRAYER_RULE, { playerId: p.id });
      }
      break;
    }
    case 4: {
      const p = choosePlayer(ctx, playing(s, team).filter((q) => q.av < 11), team, 'Iron Man: choose a player to improve their AV by 1 (max 11+).', (a, b) => b.st - a.st || b.ag - a.ag);
      if (p) {
        p.av = Math.min(11, p.av + 1);
        ctx.emit('status', `Iron Man: ${label(p)} has AV ${p.av}+ for the game.`, PRAYER_RULE, { playerId: p.id });
      }
      break;
    }
    case 5: {
      const p = choosePlayer(ctx, playing(s, team).filter((q) => !hasSkill(q, 'mightyBlow')), team, 'Knuckle Dusters: choose a player to gain Mighty Blow.', (a, b) => b.st - a.st || Number(hasSkill(b, 'block')) - Number(hasSkill(a, 'block')));
      if (p) {
        addSkill(p, 'mightyBlow');
        ctx.emit('status', `Knuckle Dusters: ${label(p)} gains Mighty Blow for the game.`, PRAYER_RULE, { playerId: p.id });
      }
      break;
    }
    case 6: {
      const k = ctx.roll({ dice: [3], interpret: ([x]) => x, by: team }).value;
      ctx.emit('roll', `Bad Habits: D3 ${k} opposition players.`, PRAYER_RULE);
      const done: string[] = [];
      for (let i = 0; i < k; i++) {
        const p = randomPlayer(ctx, playing(s, opp).filter((q) => !done.includes(q.id)), team, 'Bad Habits');
        if (!p) break;
        done.push(p.id);
        p.skills = p.skills.filter((x) => x.id !== 'loner');
        p.skills.push({ id: 'loner', value: 2 });
        ctx.emit('status', `Bad Habits: ${label(p)} gains Loner (2+) for the game.`, PRAYER_RULE, { playerId: p.id });
      }
      break;
    }
    case 7: {
      const p = randomPlayer(ctx, playing(s, opp), team, 'Greasy Cleats');
      if (p) {
        p.ma = Math.max(1, p.ma - 1);
        ctx.emit('status', `Greasy Cleats: ${label(p)} has MA ${p.ma} for the game.`, PRAYER_RULE, { playerId: p.id });
      }
      break;
    }
    case 8: {
      const p = randomPlayer(ctx, playing(s, team), team, 'Blessing of Nuffle');
      if (p) {
        addSkill(p, 'pro');
        ctx.emit('status', `Blessing of Nuffle: ${label(p)} gains Pro for the game.`, PRAYER_RULE, { playerId: p.id });
      }
      break;
    }
    case 16: {
      const p = randomPlayer(ctx, playing(s, team), team, 'Intensive Training');
      if (!p) break;
      const r = ROSTER_BY_ID[s.teams[team].rosterId ?? ''];
      const pos = r?.positions.find((x) => x.name === p.position);
      const cats = pos?.primary ?? [];
      const skills = cats.flatMap((c) => SKILL_TABLE[c] ?? []).filter((id) => !hasSkill(p, id) && SKILL_BY_ID[id]);
      if (!skills.length) {
        ctx.emit('note', `Intensive Training: ${label(p)} has no Primary skill left to learn.`, PRAYER_RULE);
        break;
      }
      const id = ctx.ask({ type: 'prayerPick', team, prompt: `Intensive Training: choose a Primary skill for ${label(p)} (${cats.join(', ')}).`, options: skills.map((k) => ({ id: k, label: `${SKILL_BY_ID[k].name} (${skillCategory(k) ?? ''})` })), rule: PRAYER_RULE });
      addSkill(p, skills.includes(id) ? id : skills[0]);
      ctx.emit('status', `Intensive Training: ${label(p)} gains ${SKILL_BY_ID[skills.includes(id) ? id : skills[0]].name} for the game.`, PRAYER_RULE, { playerId: p.id });
      break;
    }
    default:
      break;
  }
}

/** Throw a Rock (Prayer 14): can `team` use it now (start of its Turn, not used yet)? */
export function throwARockReason(s: GameState, team: TeamId): string | null {
  if (!hasPrayer(s, team, 14)) return `${s.teams[team].name} did not receive Throw a Rock.`;
  if (s.teams[team].induceUsed?.throwARock) return 'Throw a Rock is used once per game.';
  if (s.phase !== 'play' || s.match?.pendingPhase || s.turn.active !== team) return 'Throw a Rock is used at the start of one of your Turns (p.143).';
  if (s.turn.activation || s.players.some((p) => p.team === team && p.activated)) return 'Throw a Rock is used before any player is activated (p.143).';
  if (!pitchPlayers(s, other(team)).length) return 'No opposition player is on the pitch.';
  return null;
}

/** Trapdoor squares of the current pitch (one in a Wide Zone of each half, drawn on the pitch, p.23; Sevens p.7). */
export function trapdoors(s: GameState): Array<{ x: number; y: number }> {
  return s.variant === 'sevens'
    ? [
        { x: 5, y: 1 },
        { x: 14, y: 9 },
      ]
    : [
        { x: 6, y: 1 },
        { x: 19, y: 13 },
      ];
}

/** Moles under the Pitch (Prayer to Nuffle 9, p.143): the opposing team received it, so this player's Rushes are at −1. */
export function molesUnder(s: GameState, p: Player): boolean {
  return hasPrayer(s, p.team === 'A' ? 'B' : 'A', 9);
}
