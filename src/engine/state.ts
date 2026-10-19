import { adjacent, dist, eq, inBounds } from './board';
import { SKILL_BY_ID } from './skills';
import type { Coord, GameState, Player, TeamId } from './types';
import { usePitch } from './variant';

export function other(t: TeamId): TeamId {
  return t === 'A' ? 'B' : 'A';
}

export function getPlayer(s: GameState, id: string): Player {
  const p = s.players.find((q) => q.id === id);
  if (!p) throw new Error(`Unknown player ${id}`);
  return p;
}

export function findPlayer(s: GameState, id: string | undefined | null): Player | undefined {
  if (!id) return undefined;
  return s.players.find((q) => q.id === id);
}

export function onPitch(p: Player): boolean {
  return p.location === 'pitch' && !!p.pos;
}

export function playerAt(s: GameState, c: Coord): Player | undefined {
  if (!inBounds(c)) return undefined;
  return s.players.find((p) => onPitch(p) && eq(p.pos, c));
}

export function pitchPlayers(s: GameState, team?: TeamId): Player[] {
  return s.players.filter((p) => onPitch(p) && (!team || p.team === team));
}

export function hasSkill(p: Player, id: string): boolean {
  return p.skills.some((sk) => sk.id === id);
}

export function skillValue(p: Player, id: string): number | undefined {
  return p.skills.find((sk) => sk.id === id)?.value;
}

export function skillKeywords(p: Player, id: string): string[] {
  return p.skills.filter((sk) => sk.id === id && sk.keyword).map((sk) => sk.keyword as string);
}

export function isStanding(p: Player): boolean {
  return onPitch(p) && p.stance === 'standing';
}

/** Standing and not Distracted: has a Tackle Zone (p.38-39). */
export function hasTackleZone(p: Player): boolean {
  return isStanding(p) && !p.distracted;
}

/**
 * Can the player use this skill right now? Passive skills always work; Active
 * skills need the player Standing and not Distracted (p.121), except Jump Up
 * which states it can be used while Prone.
 */
export function canUse(p: Player, id: string): boolean {
  if (!hasSkill(p, id)) return false;
  const def = SKILL_BY_ID[id];
  if (!def || !def.active) return true;
  if (id === 'jumpUp') return onPitch(p) && !p.distracted && (p.stance === 'standing' || p.stance === 'prone');
  return hasTackleZone(p);
}

/** Opposition players (of `team`'s opponents) with a Tackle Zone covering `sq`. */
export function markersOf(s: GameState, sq: Coord, team: TeamId): Player[] {
  const opp = other(team);
  return s.players.filter((p) => p.team === opp && hasTackleZone(p) && adjacent(p.pos as Coord, sq));
}

export function isMarked(s: GameState, p: Player): boolean {
  return !!p.pos && markersOf(s, p.pos, p.team).length > 0;
}

/** Standing player not Marked by any opposition player (p.38). */
export function isOpen(s: GameState, p: Player): boolean {
  return isStanding(p) && !isMarked(s, p);
}

export function ballHolder(s: GameState): Player | undefined {
  return s.ball.kind === 'held' ? findPlayer(s, s.ball.playerId) : undefined;
}

export function ballSquare(s: GameState): Coord | null {
  if (s.ball.kind === 'ground') return s.ball.pos;
  if (s.ball.kind === 'held') return findPlayer(s, s.ball.playerId)?.pos ?? null;
  return null;
}

export function hasBall(s: GameState, p: Player): boolean {
  return s.ball.kind === 'held' && s.ball.playerId === p.id;
}

export function leaderOnPitch(s: GameState, team: TeamId): boolean {
  return pitchPlayers(s, team).some((p) => hasSkill(p, 'leader'));
}

export function playersWithin(s: GameState, c: Coord, range: number, team?: TeamId): Player[] {
  return pitchPlayers(s, team).filter((p) => dist(p.pos as Coord, c) <= range);
}

/**
 * Deep copy of plain JSON data (states are plain JSON: no Dates, Maps or
 * cycles). Same result as JSON.parse(JSON.stringify(s)) — `undefined` object
 * properties are dropped — but several times faster, which matters because
 * the planner replays an action once per dice outcome.
 */
/**
 * Deep copy. Copying a game state also makes the board helpers use that
 * state's pitch (standard or Sevens, see variant.ts): every engine operation
 * starts by copying the state it works on.
 */
export function cloneState<T>(s: T): T {
  const g = s as unknown as Partial<GameState> | null;
  if (g && typeof g === 'object' && g.format === 'bloodboard-state') usePitch(g.variant ?? 'standard');
  return deepCopy(s) as T;
}

function deepCopy(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    const out = new Array(v.length);
    for (let i = 0; i < v.length; i++) {
      const x = v[i];
      out[i] = x === undefined ? null : deepCopy(x);
    }
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const k in v as Record<string, unknown>) {
    const x = (v as Record<string, unknown>)[k];
    if (x === undefined || typeof x === 'function') continue;
    out[k] = deepCopy(x);
  }
  return out;
}

export function label(p: Player): string {
  // Workbook / tutorial players are called by their diagram name (X1, Y2, …).
  if (/^[XY]\d+$/.test(p.name)) return p.name;
  return `#${p.number} ${p.position}`;
}

export function teamLabel(s: GameState, t: TeamId): string {
  return s.teams[t].name || `Team ${t}`;
}

/**
 * Monstrous Mouth (p.131): is this player held by a Chomp? The condition ends
 * as soon as the chomping player no longer Marks them (checked here, so the
 * stored id may be stale).
 */
export function isChomped(s: GameState, p: Player): boolean {
  if (!p.chompedBy || !p.pos) return false;
  const c = findPlayer(s, p.chompedBy);
  return !!c && hasTackleZone(c) && !!c.pos && adjacent(c.pos, p.pos);
}

/**
 * Why this player may not leave their square of their own accord (Take Root,
 * p.137; Chomp, p.131), or null.
 */
export function heldInPlace(s: GameState, p: Player): string | null {
  if (p.rooted) return 'Rooted (Take Root, p.137): this player may not leave their square.';
  if (isChomped(s, p)) return 'Chomped (Monstrous Mouth, p.131): this player cannot leave their square while the chomping player Marks them.';
  return null;
}

/** V7: does this match run the May 2026 FAQ corrections? Matches saved before them keep the earlier behaviour (replay stays exact). */
export const faq2026 = (s: { rulesEdition?: string }): boolean => s.rulesEdition === 'faq2026';
