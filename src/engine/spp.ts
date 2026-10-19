/**
 * Star Player Points earned during a League match (p.96): recorded in
 * match.spp by player id, so the interface can add them to the saved League
 * teams after the game. Nothing is recorded in practice positions, previews,
 * or Tournament / Exhibition games (those teams do not advance).
 */
import { BRAWLIN_BRUTES_PAGE, SPP_AWARD, SPP_LABEL, sppAward, type SppKind } from './advancement';
import type { Ctx } from './context';
import { ROSTER_BY_ID } from './rosters';
import { label } from './state';
import { playerFromRoster, type TeamPlayerDef } from './teams';
import type { GameState, MatchState, Player, SppTally, TeamId } from './types';

export const SPP_RULE = { page: 96, title: 'Earning Star Player Points' };

export function awardSpp(ctx: Ctx, p: Player | undefined, kind: SppKind): void {
  const m = ctx.s.match;
  // Star Players never earn Star Player Points (p.148).
  if (!p || !m || m.kind !== 'league' || ctx.mode === 'plan' || p.star) return;
  const book = (m.spp ??= {});
  const t = (book[p.id] ??= {});
  t[kind] = (t[kind] ?? 0) + 1;
  const rules = ctx.s.teams[p.team].specialRules;
  const n = sppAward(kind, rules);
  const brutes = n !== SPP_AWARD[kind];
  ctx.emit('note', `${label(p)} earns ${n} SPP (${SPP_LABEL[kind]}${brutes ? ", Brawlin' Brutes" : ''}).`, brutes ? { page: BRAWLIN_BRUTES_PAGE, title: "Brawlin' Brutes" } : SPP_RULE, { spp: kind, playerId: p.id });
}

/** Total SPP of one tally (with the team's special rules: Brawlin' Brutes, p.154). */
export function sppTotal(t: SppTally | undefined, specialRules?: readonly string[]): number {
  if (!t) return 0;
  let n = 0;
  for (const k of Object.keys(SPP_AWARD) as SppKind[]) n += (t[k] ?? 0) * sppAward(k, specialRules);
  return n;
}

/** SPP earned in the match by every player (by in-match player id). */
export function matchSpp(m: MatchState | undefined, s?: GameState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, t] of Object.entries(m?.spp ?? {})) {
    const team = s?.players.find((p) => p.id === id)?.team;
    out[id] = sppTotal(t, team ? s?.teams[team].specialRules : undefined);
  }
  return out;
}

/** Identifies a match for its saved teams (dice seed + the two team ids), so its SPP are never added twice (even after Undo). */
export function matchKey(s: GameState): string {
  return `${s.rng.seed}:${s.match?.teamIds.A ?? ''}:${s.match?.teamIds.B ?? ''}`;
}

/** Players of `team` who were set up for at least one Drive of the match (MVP nominees, p.96). */
export function mvpEligible(s: GameState, team: TeamId): Player[] {
  const played = s.match?.played;
  return s.players.filter((p) => p.team === team && !p.star && (played ? played.includes(p.id) : true)).sort((a, b) => a.number - b.number);
}

/** One line of the post-game Star Player Points table. */
export interface PostGameRow {
  id: string;
  defId?: string;
  number: number;
  name: string;
  tally: SppTally;
  total: number;
}

/** Players of `team` who earned SPP in this match (MVP included once rolled), most SPP first. */
export function postGameSpp(s: GameState, team: TeamId): PostGameRow[] {
  const book = s.match?.spp ?? {};
  const rows: PostGameRow[] = [];
  for (const p of s.players) {
    if (p.team !== team) continue;
    const t = book[p.id];
    const total = sppTotal(t, s.teams[team].specialRules);
    if (total > 0) rows.push({ id: p.id, defId: p.defId, number: p.number, name: p.name, tally: { ...t }, total });
  }
  return rows.sort((a, b) => b.total - a.total || a.number - b.number);
}

/** A default MVP nomination: up to six players who played, those who earned the most SPP first, then by number. */
export function defaultMvpNominees(s: GameState, team: TeamId): string[] {
  const earned = matchSpp(s.match, s);
  return mvpEligible(s, team)
    .slice()
    .sort((a, b) => (earned[b.id] ?? 0) - (earned[a.id] ?? 0) || a.number - b.number)
    .slice(0, 6)
    .map((p) => p.id);
}

/**
 * Add the SPP `team` earned in this League match to its saved roster (by
 * TeamPlayerDef id). Returns a copy of the team and what was added; the
 * caller marks the match (`match.sppApplied`) so it is never added twice.
 */
export function applyMatchSpp<T extends { players: Array<{ id: string; spp?: number }>; sppMatches?: string[]; rosterId?: string }>(
  def: T,
  s: GameState,
  team: TeamId,
  opts: { hireRaised?: boolean } = {},
): { team: T; added: Array<{ defId: string; name: string; spp: number }>; hired: string[] } {
  const m = s.match;
  if (!m || m.kind !== 'league') throw new Error('Only League matches award Star Player Points (p.96).');
  if (s.phase !== 'fullTime') throw new Error('Star Player Points are added after the final whistle.');
  const key = matchKey(s);
  if (m.sppApplied?.[team] || def.sppMatches?.includes(key)) throw new Error('These Star Player Points have already been added to the team.');
  const out = { ...def, players: def.players.map((p) => ({ ...p })), sppMatches: [...(def.sppMatches ?? []), key] } as T;
  const added: Array<{ defId: string; name: string; spp: number }> = [];
  for (const row of postGameSpp(s, team)) {
    const tp = row.defId ? out.players.find((p) => p.id === row.defId) : undefined;
    if (!tp) continue;
    tp.spp = (tp.spp ?? 0) + row.total;
    added.push({ defId: tp.id, name: row.name, spp: row.total });
  }
  // Masters of Undeath (p.155): a Lineman raised during the game may be hired for free if the Team Draft List has fewer than 16 players.
  const hired: string[] = [];
  const r = def.rosterId ? ROSTER_BY_ID[def.rosterId] : undefined;
  if (opts.hireRaised !== false && r) {
    for (const p of raisedDead(s, team)) {
      if (out.players.length >= 16) break;
      const nums = new Set((out.players as unknown as TeamPlayerDef[]).map((q) => q.number));
      let n = p.number;
      while (nums.has(n)) n++;
      const np = playerFromRoster(r, p.raised as string, n, `${key}-raised-${p.id}`);
      (out.players as unknown as TeamPlayerDef[]).push(np);
      hired.push(`#${np.number} ${np.name}`);
    }
  }
  return { team: out, added, hired };
}

/** Masters of Undeath (p.155): the Linemen `team` raised during this game. */
export function raisedDead(s: GameState, team: TeamId): Player[] {
  return s.players.filter((p) => p.team === team && p.raised);
}
