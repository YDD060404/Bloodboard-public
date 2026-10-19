import { decide, execute, newGame, playerFromPosition, ROSTER_BY_ID, ScriptedDice, startPlay, type ActionInput, type Coord, type ExecutionResult, type GameState, type Player, type TeamId } from '../src/engine/index';

export interface PlaceOpts {
  number?: number;
  stance?: Player['stance'];
  distracted?: boolean;
  skills?: Player['skills'];
  extraSkills?: Player['skills'];
  ma?: number;
  st?: number;
  ag?: number;
  pa?: number | null;
  av?: number;
  id?: string;
}

export class Pos {
  s: GameState;
  constructor(opts: { a?: string; b?: string; seed?: number; rerollsA?: number; rerollsB?: number; turnA?: number; turnB?: number; active?: TeamId; sevens?: boolean } = {}) {
    this.s = newGame({ a: { name: 'Home', roster: opts.a ?? 'human' }, b: { name: 'Away', roster: opts.b ?? 'orc' }, seed: opts.seed ?? 12345 });
    if (opts.sevens) this.s.variant = 'sevens';
    this.s.teams.A.rerolls = opts.rerollsA ?? 0;
    this.s.teams.B.rerolls = opts.rerollsB ?? 0;
    this.s.teams.A.turn = opts.turnA ?? 5;
    this.s.teams.B.turn = opts.turnB ?? 4;
    this.s.turn.active = opts.active ?? 'A';
  }
  add(team: TeamId, roster: string, position: string, at: Coord | null, o: PlaceOpts = {}): Player {
    const r = ROSTER_BY_ID[roster];
    const pos = r.positions.find((x) => x.id === position);
    if (!pos) throw new Error(`no position ${position} in ${roster}`);
    const p = playerFromPosition(this.s, team, pos, at, o.number);
    if (o.id) p.id = o.id;
    if (o.stance) p.stance = o.stance;
    if (o.distracted) p.distracted = true;
    if (o.skills) p.skills = o.skills;
    if (o.extraSkills) p.skills = [...p.skills, ...o.extraSkills];
    for (const k of ['ma', 'st', 'ag', 'av'] as const) if (o[k] !== undefined) p[k] = o[k] as number;
    if (o.pa !== undefined) p.pa = o.pa;
    this.s.players.push(p);
    return p;
  }
  ball(at: Coord) {
    this.s.ball = { kind: 'ground', pos: at };
    return this;
  }
  give(p: Player) {
    this.s.ball = { kind: 'held', playerId: p.id };
    return this;
  }
  start(): GameState {
    return startPlay(this.s);
  }
}

export type Chooser = (req: NonNullable<ExecutionResult['decision']>, s: GameState) => string;

/** Execute with scripted dice, answering decisions with `choose` (replays from the start each time). */
export function runScripted(state: GameState, input: ActionInput, faces: number[], choose: Chooser | string[] = []): ExecutionResult {
  const dice = () => new ScriptedDice(faces);
  let res = execute(state, input, undefined, dice);
  let i = 0;
  let guard = 0;
  while (res.status === 'awaitingDecision' && res.decision) {
    if (guard++ > 50) throw new Error('too many decisions');
    const opt = Array.isArray(choose) ? choose[i++] : choose(res.decision, res.state);
    if (opt === undefined) throw new Error(`No scripted answer for decision ${res.decision.id}: ${res.decision.prompt} [${res.decision.options.map((o) => o.id).join(', ')}]`);
    res = decide(res.state, { requestId: res.decision.id, optionId: opt }, dice);
  }
  return res;
}

export function p(s: GameState, id: string): Player {
  const x = s.players.find((q) => q.id === id);
  if (!x) throw new Error(`no player ${id}`);
  return x;
}

export const c = (x: number, y: number): Coord => ({ x, y });

export function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}
