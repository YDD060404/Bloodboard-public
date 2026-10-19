/** Reachable area and lowest-risk auto-routing (board helpers; no dice, no state changes). */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { movementBudget, planAction, reachableSquares, safestRoute } from '../src/engine/index';
import { c, Pos } from './helpers';

test('reachable squares: within MA are normal, the next two squares need Rushes', () => {
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'L' }); // MA 6
  b.add('B', 'orc', 'lineman', c(20, 2));
  b.ball(c(2, 2));
  const s = b.start();
  const before = JSON.stringify(s);
  const r = reachableSquares(s, 'L');
  const at = (x: number, y: number) => r.find((q) => q.c.x === x && q.c.y === y);
  assert.equal(at(16, 7)?.rushes, 0);
  assert.equal(at(17, 7)?.rushes, 1);
  assert.equal(at(18, 7)?.rushes, 2);
  assert.equal(at(19, 7), undefined);
  assert.equal(JSON.stringify(s), before, 'no state change');
});

test('a Prone player pays 3 squares to stand up before moving', () => {
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'L', stance: 'prone' });
  const s = b.start();
  assert.deepEqual(movementBudget(s, 'L'), { from: c(10, 7), maLeft: 3, rushesLeft: 2, standUp: 'costs3' });
});

test('auto-route: a straight route in open field needs no rolls', () => {
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'L' });
  const s = b.start();
  const r = safestRoute(s, 'L', c(14, 7))!;
  assert.equal(r.path.length, 4);
  assert.ok(r.path.every((p) => p.to.y === 7));
  assert.equal(r.pSafe, 1);
  assert.equal(r.detour, false);
});

test('auto-route: steps around a Tackle Zone instead of dodging through it', () => {
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'L' });
  b.add('B', 'orc', 'lineman', c(12, 6), { id: 'O' }); // Marks (11..13, 5..7)
  const s = b.start();
  const r = safestRoute(s, 'L', c(14, 7))!;
  assert.equal(r.dodges, 0, JSON.stringify(r.path));
  assert.equal(r.pSafe, 1);
  assert.equal(r.path.length, 4); // as short as the straight line, but no Dodge
  // the plan built from the route has no dice at all
  const plan = planAction(s, { kind: 'playerAction', playerId: 'L', action: 'move', path: r.path });
  assert.ok(plan.ok, plan.errors.join());
  assert.equal(plan.steps.length, 0);
});

test('auto-route: an unavoidable Dodge is taken into the safest square', () => {
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'L' });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'O1' });
  b.add('B', 'orc', 'lineman', c(9, 9), { id: 'O2' });
  const s = b.start();
  const r = safestRoute(s, 'L', c(10, 4))!;
  assert.equal(r.dodges, 1);
  // first step leaves O1's zone into a square no opponent Marks: AG 3+ → 4/6
  assert.ok(Math.abs(r.pSafe - 4 / 6) < 1e-9, String(r.pSafe));
  const plan = planAction(s, { kind: 'playerAction', playerId: 'L', action: 'move', path: r.path });
  assert.ok(plan.ok);
  assert.equal(plan.steps.filter((x) => x.kind === 'dodge').length, 1);
});

test('auto-route: prefers no Rush when an equally short route has none, and never crosses a loose ball', () => {
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'L' });
  b.ball(c(12, 7));
  const s = b.start();
  const r = safestRoute(s, 'L', c(14, 7))!;
  assert.ok(!r.path.some((p) => p.to.x === 12 && p.to.y === 7));
  const toBall = safestRoute(s, 'L', c(12, 7))!;
  assert.deepEqual(toBall.path[toBall.path.length - 1].to, c(12, 7));
  const far = safestRoute(s, 'L', c(18, 7))!;
  assert.equal(far.rushes, 2);
  assert.ok(Math.abs(far.pSafe - (5 / 6) ** 2) < 1e-9);
  assert.equal(safestRoute(s, 'L', c(19, 7)), null);
});
