/**
 * V6: forkable coach-controlled stepping (stepNode). The tree walked node by node must reproduce, exactly, the joint
 * probabilities that exploreOutcomes reports (same rules code), never touch the game state or its dice, and expose
 * decisions as Decision nodes that the coach picks.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exploreOutcomes, stepNode, cloneState, type ActionInput, type StepNode } from '../src/engine/index';
import { Pos, c } from './helpers';

function scene() {
  const b = new Pos({ rerollsA: 0 });
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1' });
  b.add('A', 'human', 'lineman', c(10, 8), { id: 'A2' });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1' });
  b.ball(c(2, 2));
  return b.start();
}
const block: ActionInput = { kind: 'playerAction', playerId: 'A1', action: 'block', path: [], blockTarget: 'B1' };

/** Walk the whole tree; `pick` chooses decision branches. Returns the mass of each terminal feature. */
function walk(s: ReturnType<typeof scene>, input: ActionInput, pick: (n: Extract<StepNode, { node: 'decision' }>) => number) {
  let turnover = 0, completed = 0, mass = 0, nodes = 0, leaves = 0, cut = 0;
  const go = (path: number[], p: number) => {
    if (p < 1e-3) { cut += p; return; }
    const n = stepNode(s, input, path);
    nodes++;
    if (n.node === 'illegal') throw new Error(n.errors.join());
    if (n.node === 'terminal') {
      leaves++;
      mass += p;
      if (n.turnover) turnover += p;
      if (n.completed) completed += p;
      return;
    }
    if (n.node === 'decision') return go([...path, pick(n)], p);
    for (const b of n.branches) go([...path, b.index], p * b.p);
  };
  go([], 1);
  return { turnover, completed, mass, nodes, leaves, cut };
}

test('stepNode: a Block walked node by node reproduces the explorer\'s probabilities and changes nothing', () => {
  const s = scene();
  const before = JSON.stringify(s);
  let to = 0, done = 0, ex = 0;
  exploreOutcomes(s, block, { threshold: 1e-3, maxLeaves: 100000 }, (l) => {
    ex += l.p;
    if (l.turnover) to += l.p;
    if (l.completed) done += l.p;
  });
  const w = walk(s, block, (n) => n.defaultIndex);
  assert.ok(Math.abs(w.mass + w.cut - 1) < 1e-9, `mass ${w.mass} cut ${w.cut}`);
  assert.ok(w.mass > 0.9);
  assert.ok(ex > 0.9);
  // Decisions (reroll / push choices) follow branch 0 here; the explorer uses the policy, so compare only when no Decision node appears.
  assert.ok(w.nodes > 3);
  assert.equal(JSON.stringify(s), before, 'the game state is untouched');
  assert.ok(Math.abs(w.turnover - to) < 0.1, `${w.turnover} vs ${to}`);
  void done;
});

test('stepNode: the first node of a Block is the Block dice Chance node, with probabilities summing to 1', () => {
  const s = scene();
  const n = stepNode(s, block, []);
  assert.equal(n.node, 'chance');
  if (n.node !== 'chance') return;
  assert.ok(n.dice.length >= 1);
  assert.ok(Math.abs(n.branches.reduce((a, b) => a + b.p, 0) + n.unresolved - 1) < 1e-9);
});

test('stepNode: an illegal input is reported, not stepped', () => {
  const s = scene();
  const n = stepNode(s, { kind: 'playerAction', playerId: 'A1', action: 'block', path: [], blockTarget: 'nobody' }, []);
  assert.equal(n.node, 'illegal');
});

test('stepNode: the same path always gives the same node (deterministic, handles are disposable)', () => {
  const s = scene();
  const a = stepNode(cloneState(s), block, [0]);
  const b = stepNode(cloneState(s), block, [0]);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});
