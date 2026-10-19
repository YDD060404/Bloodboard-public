/**
 * V5.5 (request item 9): tactical checks of the computer coach's evaluation and choices.
 *  - protection by real access: a diagonal "X" cage rates safer than a cross-shaped one with the same players,
 *    because the cross's diagonal gaps can be walked into while the X's gaps need a Dodge;
 *  - no bonus for a shape as such: four players beside the carrier (cross) are not rated like four corners;
 *  - the match clock: behind in the last Turns, Turnovers cost less and scoring chances weigh more; ahead, the
 *    opposite; level scores and earlier Turns are unchanged;
 *  - a useful safe Block (no Turnover risk) is taken instead of ending the Turn.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Engine from '../src/engine/index';
import { validateInput, type GameState } from '../src/engine/index';
import { bindEngine, BASE_WEIGHTS, decideAction, evaluate, horizonFor } from '../src/ai/index';
import { clockAdjusted } from '../src/ai/evaluate';
import { c, Pos } from './helpers';

bindEngine(Engine);

/** Our (A) ball carrier at (12,7) with four team-mates in `shape`; three orc Blitzers 4-5 squares away. */
function cage(shape: 'x' | 'cross'): GameState {
  const b = new Pos({ rerollsA: 1, turnA: 3, turnB: 3 });
  const car = b.add('A', 'human', 'thrower', c(12, 7), { id: 'car' });
  const sq = shape === 'x' ? [c(11, 6), c(13, 6), c(11, 8), c(13, 8)] : [c(11, 7), c(13, 7), c(12, 6), c(12, 8)];
  sq.forEach((q, i) => b.add('A', 'human', 'lineman', q, { id: `g${i}` }));
  b.add('B', 'orc', 'blitzer', c(16, 3), { id: 'b1' });
  b.add('B', 'orc', 'blitzer', c(17, 11), { id: 'b2' });
  b.add('B', 'orc', 'blitzer', c(8, 11), { id: 'b3' });
  b.give(car);
  return b.start();
}

test('protection by access: the diagonal X cage is rated safer than a cross with the same players (the cross\'s gaps are walked into)', () => {
  const w = BASE_WEIGHTS;
  const x = cage('x');
  const cross = cage('cross');
  const ex = evaluate(x, 'A', w, horizonFor(x, 'A'));
  const ec = evaluate(cross, 'A', w, horizonFor(cross, 'A'));
  assert.ok(ex.terms.carrierSafety > ec.terms.carrierSafety + 2, `X ${ex.terms.carrierSafety.toFixed(2)} v cross ${ec.terms.carrierSafety.toFixed(2)}`);
});

test('the match clock: behind late — Turnovers cost less, scoring weighs more; ahead late — the reverse; otherwise unchanged', () => {
  const s = cage('x');
  s.match = { half: 2 } as never;
  s.teams.A.turn = 7;
  s.teams.A.score = 0;
  s.teams.B.score = 1;
  const behind = clockAdjusted(BASE_WEIGHTS, s, 'A');
  assert.ok(behind.turnoverCost < BASE_WEIGHTS.turnoverCost && behind.scoreThreat > BASE_WEIGHTS.scoreThreat);
  s.teams.A.score = 2;
  const ahead = clockAdjusted(BASE_WEIGHTS, s, 'A');
  assert.ok(ahead.turnoverCost > BASE_WEIGHTS.turnoverCost && ahead.carrierExposed > BASE_WEIGHTS.carrierExposed);
  s.teams.A.score = 1;
  assert.deepEqual(clockAdjusted(BASE_WEIGHTS, s, 'A'), BASE_WEIGHTS, 'level score');
  s.teams.A.score = 0;
  s.teams.A.turn = 3;
  assert.deepEqual(clockAdjusted(BASE_WEIGHTS, s, 'A'), BASE_WEIGHTS, 'early in the half');
  (s.match as { half: number }).half = 1;
  s.teams.A.turn = 8;
  assert.deepEqual(clockAdjusted(BASE_WEIGHTS, s, 'A'), BASE_WEIGHTS, 'first half');
});

test('not passive: a safe two-dice Block (Block skill, no Turnover risk) against a lone opponent is taken instead of ending the Turn', () => {
  const b = new Pos({ rerollsA: 1, turnA: 3, turnB: 3 });
  b.add('A', 'human', 'blitzer', c(10, 7), { id: 'a1' });
  b.add('A', 'human', 'lineman', c(10, 8), { id: 'a2' });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'o1' });
  b.add('B', 'orc', 'lineman', c(20, 3), { id: 'o2' });
  b.ball(c(2, 2));
  const s = b.start();
  const d = decideAction(s, 'A', { style: 'balanced' });
  assert.deepEqual(validateInput(s, d.input), []);
  assert.notEqual(d.input.kind, 'endTurn', d.reason);
});
