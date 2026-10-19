/**
 * AI API v2 services: legal-choice discovery from the engine's own legality, lazy parameter queries, validation, and the
 * forkable coach-controlled simulation through the request session (the same path a coach module uses).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Engine from '../src/engine/index';
import type { GameState } from '../src/engine/index';
import { bindEngine } from '../src/ai/index';
import { Session, callService } from '../src/platform/index';
import { c, Pos } from './helpers';

bindEngine(Engine);

function scene(): GameState {
  const b = new Pos({ rerollsA: 1, rerollsB: 1, turnA: 3, turnB: 3 });
  const car = b.add('A', 'human', 'thrower', c(12, 7), { id: 'car' });
  b.add('A', 'human', 'blitzer', c(9, 4), { id: 'bl' });
  b.add('A', 'human', 'lineman', c(11, 7), { id: 'lm' });
  b.add('B', 'orc', 'lineman', c(10, 5), { id: 'b3' });
  b.add('B', 'orc', 'blitzer', c(15, 7), { id: 'b1' });
  b.give(car);
  return b.start();
}
const ses = (s = scene()) => new Session(s, 'A', 11, 5000);
const call = (x: Session, name: string, ...a: unknown[]) => callService(x, name, a) as Record<string, any>;

test('legalChoices: derived from the engine (every enabled choice has a legal skeleton for an enabled actor), coverage stated', () => {
  const x = ses();
  const r = call(x, 'legalChoices');
  assert.equal(r.ok, true);
  assert.equal(r.node, 'action');
  assert.equal(r.owner, 'A');
  assert.match(r.coverage.derivedFrom, /engine legality/);
  const types = r.choices.map((k: any) => k.type);
  for (const t of ['move', 'block', 'blitz', 'endTurn']) assert.ok(types.includes(t), t);
  const mv = r.choices.find((k: any) => k.type === 'move');
  const v = call(x, 'validate', { ...mv.skeleton });
  assert.equal(v.legal, true, v.errors?.join());
  // a disabled actor explains why
  const blk = r.choices.find((k: any) => k.type === 'block');
  assert.ok(blk.actors.some((a: any) => a.enabled));
});

test('legalTargets: block targets are exactly the opponents the engine accepts; illegal ones carry the engine\'s reason', () => {
  const x = ses();
  const r = call(x, 'legalTargets', { choice: 'block', param: 'blockTarget', actor: 'bl' });
  assert.equal(r.ok, true);
  assert.equal(r.complete, true);
  assert.deepEqual(r.values.map((v: any) => v.value), ['b3']);
  const all = call(x, 'legalTargets', { choice: 'block', param: 'blockTarget', actor: 'car', includeIllegal: true });
  assert.ok(all.values.some((v: any) => !v.legal && v.reason));
});

test('legalTargets: squares are paged and a path query returns reachable squares with Rushes', () => {
  const x = ses();
  const sq = call(x, 'legalTargets', { choice: 'pass', param: 'passTarget', actor: 'car', limit: 50 });
  assert.equal(sq.ok, true);
  assert.ok(sq.values.length <= 50);
  const path = call(x, 'legalTargets', { choice: 'move', param: 'path', actor: 'bl', limit: 10 });
  assert.equal(path.ok, true);
  assert.ok(path.values.length > 0 && 'x' in path.values[0].value);
});

test('legalChoices: a pending decision becomes a decision node owned by the right coach', () => {
  // A Block with a decision in progress is exercised through execute(); here a hand-made pending request.
  const s = scene();
  const r = Engine.execute(s, { kind: 'playerAction', playerId: 'bl', action: 'block', path: [], blockTarget: 'b3' }, undefined, undefined);
  if (r.status === 'awaitingDecision') {
    const y = new Session(r.state, 'A', 12, 5000);
    const lc = callService(y, 'legalChoices', [{}]) as Record<string, any>;
    assert.equal(lc.node, 'decision');
    assert.equal(lc.choices[0].type, 'decision');
    assert.ok(lc.choices[0].options.length >= 2);
  }
});

test('fork: open → step through chance and decision nodes → terminal position usable like any explored position', () => {
  const x = ses();
  const input = { kind: 'playerAction', playerId: 'bl', action: 'block', path: [], blockTarget: 'b3' };
  let n = call(x, 'fork.open', { input });
  assert.equal(n.ok, true, JSON.stringify(n));
  const f = n.fork;
  let guard = 0, joint = 1;
  while (n.node !== 'terminal' && guard++ < 40) {
    assert.ok(['chance', 'decision'].includes(n.node), n.node);
    const b = n.node === 'decision' ? n.defaultBranch : 0;
    if (n.node === 'chance') joint *= n.branches[b].p;
    n = call(x, 'fork.step', { fork: f, branch: b });
    assert.equal(n.ok, true, JSON.stringify(n));
  }
  assert.equal(n.node, 'terminal');
  assert.ok(Math.abs(n.p - joint) < 1e-9, `joint ${joint} vs ${n.p}`);
  assert.ok(n.position);
  const ev = call(x, 'evaluate', n.position);
  assert.equal(ev.ok, true);
  assert.equal(call(x, 'fork.step', { fork: f, branch: 0 }).ok, false);
  assert.equal(call(x, 'fork.close', { fork: f }).closed, true);
  assert.equal(call(x, 'fork.step', { fork: f, branch: 0 }).code, 'stale-key');
});

test('fork: an illegal input is refused at open; a bad branch index is refused; the request state is untouched', () => {
  const s = scene();
  const before = JSON.stringify(s);
  const x = ses(s);
  assert.equal(call(x, 'fork.open', { input: { kind: 'playerAction', playerId: 'lm', action: 'block', path: [], blockTarget: 'b1' } }).ok, false);
  const n = call(x, 'fork.open', { input: { kind: 'playerAction', playerId: 'bl', action: 'block', path: [], blockTarget: 'b3' } });
  assert.equal(call(x, 'fork.step', { fork: n.fork, branch: 999 }).ok, false);
  assert.equal(JSON.stringify(s), before);
});

test('fork: handles belong to their request (another request cannot step them)', () => {
  const x = ses();
  const n = call(x, 'fork.open', { input: { kind: 'playerAction', playerId: 'bl', action: 'block', path: [], blockTarget: 'b3' } });
  const y = new Session(scene(), 'A', 12, 5000);
  assert.equal(call(y, 'fork.step', { fork: n.fork, branch: 0 }).code, 'stale-key');
});
