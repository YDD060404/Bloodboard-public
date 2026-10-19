/**
 * Property / fuzz tests for the guarantees the app makes:
 *  - planning never changes the game state or its random number generator
 *    (the input state is deep-frozen, so any write would throw);
 *  - an input the planner rejects is rejected by execute without rolling dice;
 *  - an input the planner accepts never turns illegal while executing;
 *  - execution is deterministic (same state + seed -> same result);
 *  - a Turnover hands the turn to the other team; a completed action does not;
 *  - saving and loading a position is lossless.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_POLICY } from '../src/engine/context';
import {
  actionOptions,
  decide,
  execute,
  parseSaveFile,
  planAction,
  toSaveFile,
  validateInput,
  type ActionInput,
  type Coord,
  type ExecutionResult,
  type GameState,
  type Player,
  type PlayerActionInput,
} from '../src/engine/index';
import { makeDecider } from '../src/engine/planner';
import { c, deepFreeze, p, Pos, runScripted } from './helpers';
declare function require(m: string): any;
const fs = require('node:fs');

// ---------------------------------------------------------------------------
// Small deterministic generator for test inputs (independent of the engine RNG)
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rand = ReturnType<typeof mulberry32>;
const pick = <T>(r: Rand, xs: T[]): T => xs[Math.floor(r() * xs.length)];
const inPitch = (q: Coord) => q.x >= 0 && q.x < 26 && q.y >= 0 && q.y < 15;
const occupied = (s: GameState, q: Coord) => s.players.some((o) => o.location === 'pitch' && o.pos && o.pos.x === q.x && o.pos.y === q.y);
const adjacent = (a: Coord, b: Coord) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) === 1;
const NEIGH = [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dy) => ({ dx, dy }))).filter((d) => d.dx || d.dy);

function randomPath(r: Rand, s: GameState, from: Coord, n: number, allowBad: boolean): Coord[] {
  const out: Coord[] = [];
  let cur = from;
  for (let i = 0; i < n; i++) {
    const opts = NEIGH.map((d) => ({ x: cur.x + d.dx, y: cur.y + d.dy })).filter((q) => inPitch(q) && (allowBad || (!occupied(s, q) && !out.some((o) => o.x === q.x && o.y === q.y))));
    if (!opts.length) break;
    cur = pick(r, opts);
    out.push(cur);
  }
  return out;
}

/** Greedy path towards `goal` that stops once adjacent (or on it, if onto). */
function pathTowards(s: GameState, from: Coord, goal: Coord, onto: boolean, max: number): Coord[] {
  const out: Coord[] = [];
  let cur = from;
  for (let i = 0; i < max; i++) {
    if (onto ? cur.x === goal.x && cur.y === goal.y : adjacent(cur, goal)) break;
    const opts = NEIGH.map((d) => ({ x: cur.x + d.dx, y: cur.y + d.dy }))
      .filter((q) => inPitch(q) && (!occupied(s, q) || (onto && q.x === goal.x && q.y === goal.y)) && !out.some((o) => o.x === q.x && o.y === q.y))
      .sort((a, b) => Math.max(Math.abs(a.x - goal.x), Math.abs(a.y - goal.y)) - Math.max(Math.abs(b.x - goal.x), Math.abs(b.y - goal.y)));
    if (!opts.length) break;
    cur = opts[0];
    out.push(cur);
  }
  return out;
}

const steps = (cs: Coord[]) => cs.map((to) => ({ to, kind: 'step' as const }));

function randomInput(r: Rand, s: GameState): ActionInput {
  const act = s.turn.activation;
  const roll = r();
  if (roll < 0.04) return { kind: 'endTurn' };
  if (act && roll < 0.1) return { kind: 'endActivation' };
  const mine = s.players.filter((q) => q.team === s.turn.active && q.location === 'pitch' && !q.activated);
  if (!mine.length) return { kind: 'endTurn' };
  const actor: Player = act && r() < 0.6 ? (s.players.find((q) => q.id === act.playerId) as Player) : pick(r, mine);
  if (roll < 0.13) return { kind: 'forgo', playerId: actor.id };
  const opts = actionOptions(s, actor).filter((o) => o.enabled || r() < 0.05);
  const action = (act && act.playerId === actor.id ? act.action : opts.length ? pick(r, opts).action : 'move') as PlayerActionInput['action'];
  const from = actor.pos as Coord;
  const opp = s.players.filter((q) => q.team !== actor.team && q.location === 'pitch');
  const mates = s.players.filter((q) => q.team === actor.team && q.id !== actor.id && q.location === 'pitch');
  const base: PlayerActionInput = { kind: 'playerAction', playerId: actor.id, action, path: [] };
  switch (action) {
    case 'move':
      return { ...base, path: steps(randomPath(r, s, from, 1 + Math.floor(r() * 5), r() < 0.1)) };
    case 'block': {
      const adj = opp.filter((q) => q.pos && adjacent(q.pos, from));
      const t = adj.length && r() < 0.9 ? pick(r, adj) : opp.length ? pick(r, opp) : undefined;
      return { ...base, blockTarget: t?.id };
    }
    case 'blitz': {
      const standing = opp.filter((q) => q.stance === 'standing');
      if (!standing.length) return { ...base, action: 'move', path: [] };
      const t = pick(r, standing);
      const path = pathTowards(s, from, t.pos as Coord, false, 1 + Math.floor(r() * 8));
      return { ...base, blitzTarget: t.id, blockTarget: r() < 0.85 ? t.id : undefined, path: steps(path) };
    }
    case 'pass': {
      const path = r() < 0.5 ? [] : randomPath(r, s, from, 1 + Math.floor(r() * 3), false);
      const end = path.length ? path[path.length - 1] : from;
      const target = mates.length && r() < 0.6 ? (pick(r, mates).pos as Coord) : { x: Math.max(0, Math.min(25, end.x + Math.floor(r() * 25) - 12)), y: Math.max(0, Math.min(14, end.y + Math.floor(r() * 15) - 7)) };
      return { ...base, path: steps(path), passTarget: target, hailMary: r() < 0.1 };
    }
    case 'handoff': {
      if (!mates.length) return { ...base, path: [] };
      const t = pick(r, mates);
      const path = pathTowards(s, from, t.pos as Coord, false, 1 + Math.floor(r() * 6));
      return { ...base, path: steps(path), handoffTarget: t.id };
    }
    case 'secure': {
      const b = s.ball.kind === 'ground' ? s.ball.pos : from;
      return { ...base, path: steps(pathTowards(s, from, b, true, 8)) };
    }
    default:
      return { ...base, path: steps(randomPath(r, s, from, 2, false)) };
  }
}

// ---------------------------------------------------------------------------

function example(file: string): GameState {
  const res = parseSaveFile(fs.readFileSync(`examples/${file}`, 'utf8'));
  if (!res.ok) throw new Error(res.errors.join());
  return res.save.state;
}

const json = (x: unknown) => JSON.stringify(x);
const decider = makeDecider({ ...DEFAULT_POLICY });

/** Execute and answer every decision with the stated planning policy. */
function executeFully(s: GameState, input: ActionInput): ExecutionResult {
  let res = execute(s, input);
  let guard = 0;
  while (res.status === 'awaitingDecision' && res.decision) {
    if (guard++ > 80) throw new Error('decision loop');
    const opt = decider(res.decision, { s: res.state, steps: [] } as unknown as Parameters<typeof decider>[1]);
    res = decide(res.state, { requestId: res.decision.id, optionId: opt });
  }
  return res;
}

interface Stats {
  rejectedNoDice?: number;
  planned: number;
  legal: number;
  executed: number;
  turnovers: number;
  touchdowns: number;
  decisions: number;
}

function fuzzFrom(start: GameState, seed: number, sequences: number, depth: number, stats: Stats) {
  const r = mulberry32(seed);
  for (let q = 0; q < sequences; q++) {
    let s: GameState = JSON.parse(json(start));
    s.rng = { seed: (seed * 31 + q * 7919) >>> 0, counter: 0 };
    for (let d = 0; d < depth && s.phase === 'play'; d++) {
      const input = randomInput(r, s);
      const before = json(s);
      const frozen = deepFreeze(JSON.parse(before) as GameState);

      // 1) planning: never mutates (frozen input), never touches the RNG
      const plan = planAction(frozen, input, { maxLeaves: 4000 });
      stats.planned++;
      assert.equal(json(frozen), before, 'planAction changed the state');
      const v = validateInput(frozen, input);
      assert.equal(v.length === 0, plan.ok || plan.errors.every((e) => e.startsWith('In some dice outcomes')), `validateInput and planAction disagree: ${v.join()} / ${plan.errors.join()}`);
      assert.equal(json(frozen), before, 'validateInput changed the state');

      // 2) execution on the frozen state (execute must not write to its input)
      const res = executeFully(frozen, input);
      assert.equal(json(frozen), before, 'execute changed its input state');
      if (!plan.ok) {
        if (v.length) {
          assert.equal(res.status, 'illegal', `planner rejected (${plan.errors.join()}) but execute returned ${res.status}`);
          assert.equal(json(res.state), before, 'an illegal input must leave the state unchanged');
          assert.equal(res.state.rng.counter, s.rng.counter, 'no dice for an illegal input');
          stats.rejectedNoDice = (stats.rejectedNoDice ?? 0) + 1;
        }
        continue;
      }
      stats.legal++;
      assert.notEqual(res.status, 'illegal', `planner accepted but execute said: ${res.error} (${json(input)})`);
      assert.ok(res.state.rng.counter >= s.rng.counter, 'the RNG only moves forwards');
      stats.executed++;
      stats.decisions += res.state.log[res.state.log.length - 1]?.decisions.length ?? 0;

      // 3) determinism: the same state and input give the same result
      const again = executeFully(JSON.parse(before), input);
      assert.equal(json(again.state), json(res.state), 'execution is not deterministic');

      // 4) turn bookkeeping
      const activeBefore = s.turn.active;
      if (res.status === 'turnover') {
        stats.turnovers++;
        assert.ok(res.state.turn.active !== activeBefore || res.state.phase !== 'play', `a Turnover must end the Turn: ${json(input)}\n${res.state.log[res.state.log.length - 1].events.map((e) => e.text).join('\n')}\nteams ${json(res.state.teams)}`);
        assert.equal(res.state.turn.activation, null);
      } else if (res.status === 'completed') {
        if (input.kind === 'endTurn') assert.ok(res.state.turn.active !== activeBefore || res.state.phase !== 'play');
        else assert.equal(res.state.turn.active, activeBefore, 'a completed action keeps the Turn');
      } else if (res.status === 'touchdown') {
        stats.touchdowns++;
        assert.equal(res.state.phase, 'touchdown');
      }
      // the log records what was planned/declared and why the board changed
      const last = res.state.log[res.state.log.length - 1];
      assert.ok(last && last.title.length > 0 && Array.isArray(last.events));

      // 5) save/load roundtrip is lossless
      const text = json(toSaveFile(res.state, 'fuzz'));
      const back = parseSaveFile(text);
      assert.ok(back.ok, back.ok ? '' : back.errors.join());
      if (back.ok) assert.equal(json(back.save.state), json(res.state));

      s = res.state;
    }
  }
}

const EXAMPLES = ['01-two-dodges-to-glory.json', '02-blitz-the-carrier.json', '03-short-pass-to-the-end-zone.json', '04-hand-off-and-run.json', '05-loose-ball-in-traffic.json', '06-sideline-crowd-surf.json', '07-stalling-check.json'];

test('fuzz: plans never mutate, illegal inputs roll no dice, legal plans execute deterministically (all examples)', () => {
  const stats: Stats = { planned: 0, legal: 0, executed: 0, turnovers: 0, touchdowns: 0, decisions: 0 };
  EXAMPLES.forEach((f, i) => fuzzFrom(example(f), 1000 + i, 14, 6, stats));
  // enough coverage to be meaningful
  assert.ok(stats.planned > 400, JSON.stringify(stats));
  assert.ok(stats.executed > 150, JSON.stringify(stats));
  assert.ok(stats.turnovers > 10, JSON.stringify(stats));
  console.log('fuzz stats', JSON.stringify(stats));
});

test('fuzz: a crowded midfield with skills (Frenzy, Stand Firm, Tentacles, Diving Tackle, Shadowing)', () => {
  const b = new Pos({ rerollsA: 2, rerollsB: 2 });
  b.add('A', 'human', 'blitzer', c(12, 7), { id: 'A1', extraSkills: [{ id: 'frenzy' }] });
  b.add('A', 'human', 'catcher', c(10, 5), { id: 'A2' });
  b.add('A', 'human', 'thrower', c(9, 8), { id: 'A3' });
  b.add('A', 'human', 'ogre', c(13, 9), { id: 'A4' });
  b.add('A', 'human', 'lineman', c(11, 10), { id: 'A5', stance: 'prone' });
  b.add('B', 'orc', 'bigUn', c(13, 7), { id: 'B1', extraSkills: [{ id: 'standFirm' }] });
  b.add('B', 'orc', 'blitzer', c(11, 4), { id: 'B2', extraSkills: [{ id: 'divingTackle' }] });
  b.add('B', 'orc', 'lineman', c(14, 8), { id: 'B3', extraSkills: [{ id: 'tentacles' }] });
  b.add('B', 'orc', 'goblin', c(10, 9), { id: 'B4', extraSkills: [{ id: 'shadowing' }] });
  b.add('B', 'orc', 'thrower', c(16, 6), { id: 'B5' });
  b.give(p(b.s, 'A3'));
  const stats: Stats = { planned: 0, legal: 0, executed: 0, turnovers: 0, touchdowns: 0, decisions: 0 };
  fuzzFrom(b.start(), 77, 30, 6, stats);
  assert.ok(stats.executed > 40, JSON.stringify(stats));
  console.log('fuzz stats (midfield)', JSON.stringify(stats));
});

test('a pending decision blocks planning and execution; a wrong answer changes nothing', () => {
  const b = new Pos({ rerollsA: 1 });
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1' });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1' });
  b.ball(c(1, 1));
  const s = b.start();
  // find a seed whose first dodge fails, so a re-roll decision is pending
  let res: ExecutionResult | null = null;
  for (let seed = 1; seed < 200 && !(res && res.status === 'awaitingDecision'); seed++) {
    const t = JSON.parse(json(s)) as GameState;
    t.rng = { seed, counter: 0 };
    res = execute(t, { kind: 'playerAction', playerId: 'A1', action: 'move', path: steps([c(9, 7)]) });
  }
  assert.ok(res && res.status === 'awaitingDecision' && res.decision);
  const pending = deepFreeze(res!.state);
  const before = json(pending);
  assert.equal(planAction(pending, { kind: 'endTurn' }).ok, false);
  assert.equal(execute(pending, { kind: 'endTurn' }).status, 'illegal');
  assert.equal(decide(pending, { requestId: 'nope', optionId: 'team' }).status, 'illegal');
  assert.equal(decide(pending, { requestId: res!.decision!.id, optionId: 'nonsense' }).status, 'illegal');
  assert.equal(json(pending), before);
  // answering re-runs the same dice: the first roll is identical in both branches
  const a1 = decide(pending, { requestId: res!.decision!.id, optionId: 'none' });
  const a2 = decide(pending, { requestId: res!.decision!.id, optionId: 'none' });
  assert.equal(json(a1.state), json(a2.state));
  assert.equal(a1.status, 'turnover');
});

test('displayed single-step probabilities equal the exact enumeration for one-roll actions', () => {
  const cases: Array<{ name: string; build: (b: Pos) => void; input: PlayerActionInput }> = [
    {
      name: 'dodge into two tackle zones',
      build: (b) => {
        b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1' });
        b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1' });
        b.add('B', 'orc', 'lineman', c(8, 8), { id: 'B2' });
        b.add('B', 'orc', 'lineman', c(8, 6), { id: 'B3' });
      },
      input: { kind: 'playerAction', playerId: 'A1', action: 'move', path: steps([c(9, 7)]) },
    },
    {
      name: 'rush',
      build: (b) => {
        b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1', ma: 1 });
        b.add('B', 'orc', 'lineman', c(20, 7), { id: 'B1' });
      },
      input: { kind: 'playerAction', playerId: 'A1', action: 'move', path: steps([c(11, 7), c(12, 7)]) },
    },
    {
      name: 'pick-up in a tackle zone',
      build: (b) => {
        b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1' });
        b.add('B', 'orc', 'lineman', c(12, 7), { id: 'B1' });
        b.ball(c(11, 7));
      },
      input: { kind: 'playerAction', playerId: 'A1', action: 'move', path: steps([c(11, 7)]) },
    },
    {
      name: 'Bone Head (with Loner 3+ on the Team Re-roll)',
      build: (b) => {
        b.add('A', 'human', 'ogre', c(10, 7), { id: 'A1' });
        b.add('B', 'orc', 'lineman', c(20, 7), { id: 'B1' });
      },
      input: { kind: 'playerAction', playerId: 'A1', action: 'move', path: steps([c(11, 7)]) },
    },
    {
      name: 'stand up with MA 2',
      build: (b) => {
        b.add('A', 'orc', 'bigUn', c(10, 7), { id: 'A1', ma: 2, stance: 'prone' });
        b.add('B', 'orc', 'lineman', c(20, 7), { id: 'B1' });
      },
      input: { kind: 'playerAction', playerId: 'A1', action: 'move', path: [] },
    },
  ];
  for (const k of cases) {
    for (const rr of [0, 1]) {
      const b = new Pos({ rerollsA: rr });
      k.build(b);
      if (b.s.ball.kind === 'none') b.ball(c(1, 1));
      const s = b.start();
      const plan = planAction(s, k.input);
      assert.ok(plan.ok, `${k.name}: ${plan.errors.join()}`);
      const dice = plan.steps.filter((st) => st.by !== 'opponent');
      assert.equal(dice.length, 1, `${k.name}: exactly one roll expected`);
      const st = dice[0] as typeof dice[0] & { pSingle: number };
      assert.ok(st.pSingle !== null);
      const without = plan.withoutTeamRerolls!.pCompleted;
      const withTR = plan.withTeamRerolls!.pCompleted;
      assert.ok(Math.abs(st.pSingle - without) < 1e-12, `${k.name}: step ${st.pSingle} vs exact ${without}`);
      if (rr) assert.ok(Math.abs((st.pWithReroll ?? st.pSingle) - withTR) < 1e-12, `${k.name}: step with re-roll ${st.pWithReroll} vs exact ${withTR}`);
      else assert.ok(Math.abs(st.pSingle - withTR) < 1e-12);
    }
  }
});

test('regression: a Stalling crowd hit while ending the Turn is a Turnover of that Turn only (p.80-81)', () => {
  const b = new Pos({ turnA: 5, turnB: 4 });
  const carrier = b.add('A', 'human', 'catcher', c(22, 7), { id: 'A1' });
  b.add('B', 'orc', 'lineman', c(5, 7), { id: 'B1' });
  b.give(carrier);
  const s = b.start();
  // crowd roll 5 vs Turn 5 -> hit; armour 1+1 holds; ball bounces (D8 2 = up)
  const r = runScripted(s, { kind: 'endTurn' }, [5, 1, 1, 2]);
  assert.equal(r.status, 'turnover');
  assert.equal(r.state.turn.active, 'B', 'the opponent now has their Turn');
  assert.equal(r.state.teams.B.turn, 5);
  const ends = r.events.filter((e) => e.type === 'turn' && /ends/.test(e.text));
  assert.equal(ends.length, 1, ends.map((e) => e.text).join(' | '));
  assert.match(ends[0].text, /Turnover/);
  assert.equal(p(r.state, 'A1').stance, 'prone');
});
