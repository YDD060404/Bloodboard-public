import { usePitch } from './variant';
import { eq, fmt, inBounds, inScoringEndZone } from './board';
import { randomSeed } from './dice';
import { ROSTER_BY_ID, type RosterPosition } from './rosters';
import { SKILL_BY_ID } from './skills';
import { cloneState, onPitch } from './state';
import type { Coord, GameState, Player, SkillRef, TeamId, TeamState, Weather } from './types';

export const DEFAULT_RULER_WIDTH = 1.8;

export function newTeam(id: TeamId, name: string, rosterId?: string): TeamState {
  const r = rosterId ? ROSTER_BY_ID[rosterId] : undefined;
  return {
    id,
    name,
    rosterId,
    color: r?.color ?? (id === 'A' ? '#1f4e9c' : '#8c1c1c'),
    accent: r?.accent ?? '#f4f1e8',
    rerolls: 2,
    leaderReroll: false,
    score: 0,
    turn: 1,
  };
}

export function newGame(opts: { a?: { name: string; roster?: string }; b?: { name: string; roster?: string }; seed?: number; weather?: Weather } = {}): GameState {
  return {
    format: 'bloodboard-state',
    version: 1,
    phase: 'setup',
    rulesEdition: 'faq2026',
    weather: opts.weather ?? 'perfect',
    teams: {
      A: newTeam('A', opts.a?.name ?? 'Home', opts.a?.roster),
      B: newTeam('B', opts.b?.name ?? 'Away', opts.b?.roster),
    },
    players: [],
    ball: { kind: 'none' },
    turn: {
      active: 'A',
      half: 2,
      used: { blitz: false, pass: false, handoff: false, foul: false, secure: false, ttm: false, bomb: false, punt: false, ktm: false },
      stunnedAtStart: [],
      activation: null,
    },
    rng: { seed: opts.seed ?? randomSeed(), counter: 0 },
    options: { rulerWidth: DEFAULT_RULER_WIDTH },
    log: [],
    pending: null,
  };
}

export function nextPlayerId(s: GameState, team: TeamId): string {
  let n = 1;
  while (s.players.some((p) => p.id === `${team}${n}`)) n++;
  return `${team}${n}`;
}

export function nextNumber(s: GameState, team: TeamId): number {
  let n = 1;
  while (s.players.some((p) => p.team === team && p.number === n)) n++;
  return n;
}

export function playerFromPosition(s: GameState, team: TeamId, pos: RosterPosition, at: Coord | null, number?: number): Player {
  return {
    id: nextPlayerId(s, team),
    team,
    number: number ?? nextNumber(s, team),
    name: pos.name,
    position: pos.name,
    keywords: pos.keywords.slice(),
    ma: pos.ma,
    st: pos.st,
    ag: pos.ag,
    pa: pos.pa,
    av: pos.av,
    skills: pos.skills.map((x) => ({ ...x })),
    location: at ? 'pitch' : 'reserves',
    pos: at ? { ...at } : null,
    stance: 'standing',
    distracted: false,
    activated: false,
    usage: {},
  };
}

export function customPlayer(s: GameState, team: TeamId, p: Partial<Player> & { position: string }, at: Coord | null): Player {
  return {
    id: nextPlayerId(s, team),
    team,
    number: p.number ?? nextNumber(s, team),
    name: p.name ?? p.position,
    position: p.position,
    keywords: p.keywords ?? [],
    ma: p.ma ?? 6,
    st: p.st ?? 3,
    ag: p.ag ?? 3,
    pa: p.pa === undefined ? 4 : p.pa,
    av: p.av ?? 9,
    skills: (p.skills ?? []).map((x) => ({ ...x })),
    location: at ? 'pitch' : 'reserves',
    pos: at ? { ...at } : null,
    stance: p.stance ?? 'standing',
    distracted: p.distracted ?? false,
    activated: false,
    usage: {},
  };
}

export interface PositionIssue {
  level: 'error' | 'warning';
  text: string;
}

/** Check a manually arranged position before play starts. */
export function validatePosition(s: GameState): PositionIssue[] {
  usePitch(s);
  const out: PositionIssue[] = [];
  const onP = s.players.filter(onPitch);
  for (let i = 0; i < onP.length; i++) {
    const p = onP[i];
    if (!inBounds(p.pos as Coord)) out.push({ level: 'error', text: `#${p.number} (${p.team}) is off the pitch.` });
    for (let j = i + 1; j < onP.length; j++) if (eq(p.pos, onP[j].pos)) out.push({ level: 'error', text: `Two players share ${fmt(p.pos)}.` });
  }
  for (const t of ['A', 'B'] as TeamId[]) {
    const n = onP.filter((p) => p.team === t).length;
    if (n > 11) out.push({ level: 'warning', text: `${s.teams[t].name} has ${n} players on the pitch (normally at most 11).` });
    const tm = s.teams[t];
    if (tm.turn < 0 || tm.turn > 8) out.push({ level: 'error', text: `${tm.name}: the Turn marker must be between 0 and 8.` });
  }
  if (s.teams[s.turn.active].turn < 1) out.push({ level: 'error', text: 'The active team must be on Turn 1-8.' });
  if (s.ball.kind === 'held') {
    const h = s.players.find((p) => p.id === (s.ball as { playerId: string }).playerId);
    if (!h || !onPitch(h)) out.push({ level: 'error', text: 'The ball carrier must be on the pitch.' });
    else if (h.stance !== 'standing') out.push({ level: 'error', text: 'Only a Standing player can hold the ball.' });
    else if (inScoringEndZone(h.team, h.pos as Coord)) out.push({ level: 'error', text: 'A Standing ball carrier in the opposition End Zone would already have scored.' });
  } else if (s.ball.kind === 'ground') {
    const b = s.ball.pos;
    if (!inBounds(b)) out.push({ level: 'error', text: 'The ball is off the pitch.' });
    if (onP.some((p) => eq(p.pos, b))) out.push({ level: 'error', text: `A loose ball cannot share ${fmt(b)} with a player: give it to the player or move it.` });
  } else {
    out.push({ level: 'warning', text: 'There is no ball on the pitch.' });
  }
  for (const p of s.players) {
    for (const sk of p.skills) {
      const def = SKILL_BY_ID[sk.id];
      if (!def) out.push({ level: 'error', text: `#${p.number} (${p.team}) has an unknown skill "${sk.id}".` });
      else if (def.support === 'unsupported') out.push({ level: 'warning', text: `#${p.number} (${s.teams[p.team].name}) has ${def.name}: not implemented — ${def.note ?? 'affected actions are disabled'}` });
    }
    if (p.distracted && p.stance !== 'standing') out.push({ level: 'error', text: `#${p.number}: only Standing players can be Distracted.` });
  }
  return out;
}

/** Leave setup and start play for the active team. */
export function startPlay(state: GameState): GameState {
  const s = cloneState(state);
  s.phase = 'play';
  s.pending = null;
  s.turn.activation = null;
  s.turn.used = { blitz: false, pass: false, handoff: false, foul: false, secure: false, ttm: false, bomb: false, punt: false, ktm: false };
  s.touchdown = undefined;
  for (const p of s.players) {
    p.activated = false;
    p.usage = {};
    if (p.location !== 'pitch') p.pos = null;
    if (p.stance !== 'standing') p.distracted = false;
  }
  s.turn.stunnedAtStart = s.players.filter((p) => p.team === s.turn.active && p.location === 'pitch' && p.stance === 'stunned').map((p) => p.id);
  return s;
}

/** Return to setup mode keeping the current arrangement. */
export function backToSetup(state: GameState): GameState {
  const s = cloneState(state);
  s.phase = 'setup';
  s.pending = null;
  s.turn.activation = null;
  return s;
}

export function withSkills(p: Player, skills: SkillRef[]): Player {
  return { ...p, skills: skills.map((x) => ({ ...x })) };
}
