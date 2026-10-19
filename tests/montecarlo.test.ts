/**
 * Cross-check: the probabilities shown in previews (exact enumeration) must
 * match what actually happens when the same action is executed with real
 * random dice and the same decision policy.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_POLICY } from '../src/engine/context';
import { decide, execute, parseSaveFile, planAction, type ActionInput, type GameState, type OutcomeSummary, type PlayerActionInput } from '../src/engine/index';
import { makeDecider } from '../src/engine/planner';
import { c, Pos } from './helpers';
declare function require(m: string): any;
const fs = require('node:fs');

interface Tally {
  n: number;
  completed: number;
  turnover: number;
  tdActive: number;
  activeBall: number;
  groundBall: number;
  oppBall: number;
}

function simulate(state: GameState, input: ActionInput, runs: number, useTeamRerolls: boolean, seed0: number): Tally {
  const policy = { ...DEFAULT_POLICY, useTeamRerolls };
  const decider = makeDecider(policy);
  const t: Tally = { n: 0, completed: 0, turnover: 0, tdActive: 0, activeBall: 0, groundBall: 0, oppBall: 0 };
  const active = state.turn.active;
  for (let i = 0; i < runs; i++) {
    const s0: GameState = JSON.parse(JSON.stringify(state));
    s0.rng = { seed: (seed0 + i * 7919) >>> 0, counter: 0 };
    let res = execute(s0, input);
    let guard = 0;
    while (res.status === 'awaitingDecision' && res.decision) {
      if (guard++ > 60) throw new Error('decision loop');
      // same policy the planner states as its assumption
      const fakeCtx = { s: res.state, steps: [] } as unknown as Parameters<typeof decider>[1];
      const opt = decider(res.decision, fakeCtx);
      res = decide(res.state, { requestId: res.decision.id, optionId: opt });
    }
    if (res.status === 'illegal') throw new Error(res.error);
    t.n++;
    const last = res.state.log[res.state.log.length - 1];
    const td = res.status === 'touchdown' && res.state.touchdown?.team === active;
    if (last.outcome === 'completed' || td) t.completed++;
    if (res.status === 'turnover') t.turnover++;
    if (td) t.tdActive++;
    // Ball position right after the action (before any later turn): use the final state.
    const b = res.state.ball;
    if (b.kind === 'held') {
      const h = res.state.players.find((q) => q.id === b.playerId);
      if (h?.team === active) t.activeBall++;
      else t.oppBall++;
    } else if (b.kind === 'ground') t.groundBall++;
  }
  return t;
}

function close(label: string, observed: number, n: number, p: number) {
  const sd = Math.sqrt(Math.max(p * (1 - p), 1e-9) / n);
  const obs = observed / n;
  assert.ok(Math.abs(obs - p) <= 4.5 * sd + 1e-9, `${label}: simulated ${obs.toFixed(4)} vs exact ${p.toFixed(4)} (n=${n}, sd=${sd.toFixed(4)})`);
}

function check(name: string, state: GameState, input: ActionInput, runs = 4000) {
  const plan = planAction(state, input);
  assert.ok(plan.ok, `${name}: ${plan.errors.join('; ')}`);
  for (const useTRR of [false, true]) {
    const sum = (useTRR ? plan.withTeamRerolls : plan.withoutTeamRerolls) as OutcomeSummary;
    assert.ok(sum.unresolved < 1e-4, `${name}: unresolved ${sum.unresolved}`);
    const t = simulate(state, input, runs, useTRR, useTRR ? 1000 : 5000);
    close(`${name} completed (TRR ${useTRR})`, t.completed, t.n, sum.pCompleted);
    close(`${name} turnover (TRR ${useTRR})`, t.turnover, t.n, sum.pTurnover);
    close(`${name} TD (TRR ${useTRR})`, t.tdActive, t.n, sum.pTouchdownActive);
    close(`${name} active ball (TRR ${useTRR})`, t.activeBall, t.n, sum.pActiveHasBall);
    close(`${name} ground ball (TRR ${useTRR})`, t.groundBall, t.n, sum.pBallGround);
  }
}

function example(file: string): GameState {
  const r = parseSaveFile(fs.readFileSync(`examples/${file}`, 'utf8'));
  if (!r.ok) throw new Error(r.errors.join());
  return r.save.state;
}

const pid = (s: GameState, team: 'A' | 'B', num: number) => (s.players.find((q) => q.team === team && q.number === num) as { id: string }).id;
const steps = (pts: Array<[number, number]>) => pts.map(([x, y]) => ({ to: c(x, y), kind: 'step' as const }));

test('Monte Carlo: two-dodge run to the end zone (example 1) matches the preview', () => {
  const s = example('01-two-dodges-to-glory.json');
  const input: PlayerActionInput = { kind: 'playerAction', playerId: pid(s, 'A', 7), action: 'move', path: steps([[18, 7], [19, 7], [20, 7], [21, 7], [22, 7], [23, 7], [24, 7], [25, 6]]) };
  check('two dodges', s, input);
});

test('Monte Carlo: Blitz on the ball carrier (example 2) matches the preview', () => {
  const s = example('02-blitz-the-carrier.json');
  const input: PlayerActionInput = { kind: 'playerAction', playerId: pid(s, 'A', 6), action: 'blitz', blitzTarget: pid(s, 'B', 8), blockTarget: pid(s, 'B', 8), path: steps([[11, 7], [10, 7], [9, 7]]) };
  check('blitz', s, input, 3000);
});

test('Monte Carlo: short pass with interceptors (example 3) matches the preview', () => {
  const s = example('03-short-pass-to-the-end-zone.json');
  const input: PlayerActionInput = { kind: 'playerAction', playerId: pid(s, 'A', 10), action: 'pass', path: [], passTarget: c(25, 5) };
  check('pass', s, input, 4000);
});

test('Monte Carlo: hand-off to a marked catcher (example 4) matches the preview', () => {
  const s = example('04-hand-off-and-run.json');
  const input: PlayerActionInput = { kind: 'playerAction', playerId: pid(s, 'A', 9), action: 'handoff', path: [], handoffTarget: pid(s, 'A', 7) };
  check('handoff', s, input);
});

test('Monte Carlo: dodge and pick-up in traffic (example 5) matches the preview', () => {
  const s = example('05-loose-ball-in-traffic.json');
  const input: PlayerActionInput = { kind: 'playerAction', playerId: pid(s, 'A', 10), action: 'move', path: steps([[12, 7], [13, 7]]) };
  check('pickup', s, input);
});

test('Monte Carlo: sideline block into the crowd (example 6) matches the preview', () => {
  const s = example('06-sideline-crowd-surf.json');
  const input: PlayerActionInput = { kind: 'playerAction', playerId: pid(s, 'A', 8), action: 'block', path: [], blockTarget: pid(s, 'B', 7) };
  check('crowd', s, input, 3000);
});

test('Monte Carlo: long pass that can scatter out of bounds and bounce among players', () => {
  const b = new Pos({ rerollsA: 2 });
  const thr = b.add('A', 'human', 'thrower', c(12, 2), { id: 'A1' });
  b.add('A', 'human', 'catcher', c(21, 1), { id: 'A2' });
  b.add('A', 'human', 'lineman', c(20, 0), { id: 'A3' });
  b.add('B', 'orc', 'lineman', c(22, 1), { id: 'B1' });
  b.add('B', 'orc', 'lineman', c(16, 3), { id: 'B2' });
  b.add('B', 'orc', 'goblin', c(21, 3), { id: 'B3' });
  b.give(thr);
  const s = b.start();
  const input: PlayerActionInput = { kind: 'playerAction', playerId: 'A1', action: 'pass', path: [], passTarget: c(21, 1) };
  check('long pass', s, input, 4000);
});

test('Monte Carlo: Throw Team-mate with scatter, crash landings and landing tests matches the preview', () => {
  const b = new Pos({ rerollsA: 1 });
  b.add('A', 'human', 'ogre', c(10, 7), { id: 'O' });
  b.add('A', 'human', 'halfling', c(11, 7), { id: 'H' });
  b.add('B', 'orc', 'lineman', c(14, 6), { id: 'B1' });
  b.add('B', 'orc', 'lineman', c(15, 8), { id: 'B2' });
  b.ball(c(2, 2));
  const s = b.start();
  const input: PlayerActionInput = { kind: 'playerAction', playerId: 'O', action: 'ttm', path: [], thrownPlayerId: 'H', throwTarget: c(15, 7) };
  check('ttm', s, input, 4000);
});

test('Monte Carlo: Projectile Vomit matches the preview', () => {
  const b = new Pos({ rerollsA: 1 });
  b.add('A', 'orc', 'troll', c(10, 7), { id: 'T' });
  b.add('A', 'orc', 'lineman', c(9, 6), { id: 'A2' });
  const t = b.add('B', 'human', 'catcher', c(11, 7), { id: 'C' });
  b.give(t);
  const s = b.start();
  const input: PlayerActionInput = { kind: 'playerAction', playerId: 'T', action: 'special', special: 'projectileVomit', vomitTarget: 'C', path: [] };
  check('vomit', s, input, 4000);
});
