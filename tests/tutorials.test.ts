/** Basic Tutorials: every scenario builds, the intended solution is legal and the quoted chances are the engine's. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TUTORIALS, TUTORIAL_BY_ID } from '../src/courses/basics';
import { buildScenario, checkGoal, planAction, safestRoute, validateState, type PlayerActionInput } from '../src/engine/index';
import { c, runScripted } from './helpers';

const step = (x: number, y: number) => ({ to: c(x, y), kind: 'step' as const });
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

test('every tutorial builds a valid position with Team A to play', () => {
  for (const t of TUTORIALS) {
    if (!t.scenario) continue;
    const s = buildScenario(t.scenario, t.seed);
    assert.deepEqual(validateState(s), [], t.id);
    assert.equal(s.phase, 'play');
    assert.equal(s.turn.active, 'A');
    assert.equal(checkGoal(s, t.goal).done, false, `${t.id} must not start solved`);
  }
});

test('T1: 8 squares + 2 Rushes to score; (5/6)^2 without re-rolls', () => {
  const t = TUTORIAL_BY_ID.T1;
  const s = buildScenario(t.scenario!, t.seed);
  const r = safestRoute(s, 'C', c(25, 7))!;
  assert.equal(r.rushes, 2);
  const plan = planAction(s, { kind: 'playerAction', playerId: 'C', action: 'move', path: r.path });
  assert.ok(plan.ok);
  assert.ok(near(plan.withoutTeamRerolls!.pTouchdownActive, 25 / 36));
  // scripted: two successful Rushes → Touchdown and the goal is met
  const res = runScripted(s, { kind: 'playerAction', playerId: 'C', action: 'move', path: r.path }, [2, 2]);
  assert.equal(res.status, 'touchdown');
  assert.equal(checkGoal(res.state, t.goal).done, true);
});

test('T2: the auto-route Dodges into an unmarked square (4/6) and then avoids the Tackle Zones', () => {
  const t = TUTORIAL_BY_ID.T2;
  const s = buildScenario(t.scenario!, t.seed);
  const r = safestRoute(s, 'L', c(18, 8))!;
  assert.equal(r.dodges, 1);
  assert.ok(near(r.pSafe, 4 / 6));
  const plan = planAction(s, { kind: 'playerAction', playerId: 'L', action: 'move', path: [step(13, 8), step(14, 9), step(15, 9), step(16, 9), step(17, 8), step(18, 8)] });
  assert.ok(plan.ok, plan.errors.join());
  assert.ok(near(plan.withoutTeamRerolls!.pCompleted, 4 / 6));
  assert.ok(near(plan.withTeamRerolls!.pCompleted, 1 - (2 / 6) ** 2));
  const done = runScripted(s, { kind: 'playerAction', playerId: 'L', action: 'move', path: r.path }, [4]);
  assert.equal(checkGoal(done.state, t.goal).done, true);
  const fail = runScripted(s, { kind: 'playerAction', playerId: 'L', action: 'move', path: r.path }, [1, 3, 3], ['none']);
  const g = checkGoal(fail.state, t.goal);
  assert.equal(g.done, false);
  assert.equal(g.failed, true);
});

test('T3: Secure the Ball 2+ versus a pick-up 3+', () => {
  const t = TUTORIAL_BY_ID.T3;
  const s = buildScenario(t.scenario!, t.seed);
  const path = [step(11, 8), step(12, 8), step(13, 8)];
  const sec = planAction(s, { kind: 'playerAction', playerId: 'C', action: 'secure', path });
  assert.ok(sec.ok, sec.errors.join());
  assert.ok(near(sec.withoutTeamRerolls!.pCompleted, 5 / 6));
  const mv = planAction(s, { kind: 'playerAction', playerId: 'C', action: 'move', path });
  assert.ok(near(mv.withoutTeamRerolls!.pCompleted, 4 / 6));
});

test('T4: a Short pass from the start, a Quick pass from N7', () => {
  const t = TUTORIAL_BY_ID.T4;
  const s = buildScenario(t.scenario!, t.seed);
  const direct = planAction(s, { kind: 'playerAction', playerId: 'T', action: 'pass', path: [], passTarget: c(16, 5) });
  assert.ok(direct.ok, direct.errors.join());
  assert.equal(direct.pass?.range, 'Short Pass');
  const moved = planAction(s, { kind: 'playerAction', playerId: 'T', action: 'pass', path: [step(11, 6), step(12, 6), step(13, 6)], passTarget: c(16, 5) });
  assert.ok(moved.ok, moved.errors.join());
  assert.equal(moved.pass?.range, 'Quick Pass');
});

test('T5: hand-off then run in scores', () => {
  const t = TUTORIAL_BY_ID.T5;
  let s = buildScenario(t.scenario!, t.seed);
  const ho: PlayerActionInput = { kind: 'playerAction', playerId: 'B', action: 'handoff', path: [step(21, 6), step(21, 5)], handoffTarget: 'C' };
  assert.ok(planAction(s, ho).ok);
  s = runScripted(s, ho, [3]).state;
  assert.equal(s.ball.kind === 'held' && s.ball.playerId, 'C');
  const run = runScripted(s, { kind: 'playerAction', playerId: 'C', action: 'move', path: [step(23, 4), step(24, 4), step(25, 4)] }, []);
  assert.equal(checkGoal(run.state, t.goal).done, true);
});

test('T6 and T7: 2 dice, and with Block on the attacker the target goes down 3 times in 4', () => {
  for (const [id, input] of [
    ['T6', { kind: 'playerAction', playerId: 'X', action: 'block', path: [], blockTarget: 'Y' }],
    ['T7', { kind: 'playerAction', playerId: 'X', action: 'blitz', path: [step(10, 7), step(11, 7), step(12, 7), step(13, 7)], blitzTarget: 'Y', blockTarget: 'Y' }],
  ] as Array<[string, PlayerActionInput]>) {
    const t = TUTORIAL_BY_ID[id];
    const s = buildScenario(t.scenario!, t.seed);
    const plan = planAction(s, input);
    assert.ok(plan.ok, `${id}: ${plan.errors.join()}`);
    assert.equal(plan.block?.dice, 2);
    assert.equal(plan.block?.chooser, 'attacker');
    assert.ok(near(plan.withoutTeamRerolls!.pTargetDown, 0.75), `${id} ${plan.withoutTeamRerolls!.pTargetDown}`);
  }
});

test('T8: Throw Team-mate into the End Zone is a legal Short throw; T9: Projectile Vomit is offered', () => {
  const t8 = TUTORIAL_BY_ID.T8;
  const s8 = buildScenario(t8.scenario!, t8.seed);
  const plan = planAction(s8, { kind: 'playerAction', playerId: 'O', action: 'ttm', path: [], thrownPlayerId: 'H', throwTarget: c(25, 7) });
  assert.ok(plan.ok, plan.errors.join());
  assert.ok(plan.withoutTeamRerolls!.pTouchdownActive > 0);
  const t9 = TUTORIAL_BY_ID.T9;
  const s9 = buildScenario(t9.scenario!, t9.seed);
  const pv = planAction(s9, { kind: 'playerAction', playerId: 'V', action: 'special', special: 'projectileVomit', path: [], vomitTarget: 'H' });
  assert.ok(pv.ok, pv.errors.join());
});
