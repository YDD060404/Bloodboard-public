import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planAction } from '../src/engine/index';
import { c, deepFreeze, p, Pos, runScripted } from './helpers';

test('open move needs no dice and keeps the activation open', () => {
  const b = new Pos();
  b.add('A', 'human', 'catcher', c(5, 7), { id: 'A1' });
  b.add('B', 'orc', 'lineman', c(20, 7), { id: 'B1' });
  b.ball(c(15, 2));
  const s = b.start();
  const input = { kind: 'playerAction' as const, playerId: 'A1', action: 'move' as const, path: [{ to: c(6, 7), kind: 'step' as const }, { to: c(7, 7), kind: 'step' as const }] };
  const res = runScripted(s, input, []);
  assert.equal(res.status, 'completed');
  assert.deepEqual(p(res.state, 'A1').pos, c(7, 7));
  assert.equal(res.state.turn.activation?.playerId, 'A1');
  assert.equal(res.state.turn.activation?.maUsed, 2);
});

test('failed dodge: falls in the target square, armour roll, turnover', () => {
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1' });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1' });
  b.ball(c(15, 2));
  const s = b.start();
  const input = { kind: 'playerAction' as const, playerId: 'A1', action: 'move' as const, path: [{ to: c(9, 7), kind: 'step' as const }] };
  const res = runScripted(s, input, [2, 3, 3]);
  assert.equal(res.status, 'turnover');
  const a1 = p(res.state, 'A1');
  assert.deepEqual(a1.pos, c(9, 7));
  assert.equal(a1.stance, 'prone');
  assert.equal(res.state.turn.active, 'B');
  assert.equal(res.state.teams.B.turn, 5);
});

test('successful dodge into a marked square uses the -1 modifier', () => {
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1' });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1' });
  b.add('B', 'orc', 'lineman', c(10, 9), { id: 'B2' });
  b.ball(c(15, 2));
  const s = b.start();
  // A1 (10,7) -> (10,8): destination marked by B1 (11,7) and B2 (10,9) -> -2, AG 3+ => needs 5 natural
  const input = { kind: 'playerAction' as const, playerId: 'A1', action: 'move' as const, path: [{ to: c(10, 8), kind: 'step' as const }] };
  const fail = runScripted(s, input, [4, 1, 1]);
  assert.equal(fail.status, 'turnover');
  const ok = runScripted(s, input, [5]);
  assert.equal(ok.status, 'completed');
  assert.deepEqual(p(ok.state, 'A1').pos, c(10, 8));
});

test('failed dodge pauses for a re-roll decision and a team re-roll saves it', () => {
  const b = new Pos({ rerollsA: 2 });
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1' });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1' });
  b.ball(c(15, 2));
  const s = b.start();
  const input = { kind: 'playerAction' as const, playerId: 'A1', action: 'move' as const, path: [{ to: c(9, 7), kind: 'step' as const }] };
  const res = runScripted(s, input, [1, 4], ['team']);
  assert.equal(res.status, 'completed');
  assert.equal(res.state.teams.A.rerolls, 1);
  assert.deepEqual(p(res.state, 'A1').pos, c(9, 7));
});

test('planning does not mutate the state or the RNG, and gives exact dodge odds', () => {
  const b = new Pos({ rerollsA: 1 });
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1' });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1' });
  b.ball(c(15, 2));
  const s = deepFreeze(b.start());
  const before = JSON.stringify(s);
  const input = { kind: 'playerAction' as const, playerId: 'A1', action: 'move' as const, path: [{ to: c(9, 7), kind: 'step' as const }] };
  const plan = planAction(s, input);
  assert.equal(JSON.stringify(s), before);
  assert.ok(plan.ok, plan.errors.join('; '));
  const w = plan.withTeamRerolls!;
  const wo = plan.withoutTeamRerolls!;
  assert.ok(Math.abs(wo.pCompleted - 4 / 6) < 1e-12, `without TRR ${wo.pCompleted}`);
  assert.ok(Math.abs(w.pCompleted - (1 - (2 / 6) * (2 / 6))) < 1e-12, `with TRR ${w.pCompleted}`);
  assert.ok(Math.abs(w.pTurnover - (2 / 6) * (2 / 6)) < 1e-12);
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].kind, 'dodge');
});

test('block with an assist rolls two dice and POW knocks the target down', () => {
  const b = new Pos();
  b.add('A', 'human', 'blitzer', c(10, 7), { id: 'A1' });
  b.add('A', 'human', 'lineman', c(11, 6), { id: 'A2' });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1' });
  b.ball(c(2, 2));
  const s = b.start();
  const input = { kind: 'playerAction' as const, playerId: 'A1', action: 'block' as const, path: [], blockTarget: 'B1' };
  // dice: block [6 (POW), 3 (push)], armour 4+5=9 vs AV10 holds
  const res = runScripted(s, input, [6, 3, 4, 5], (req) => {
    if (req.type === 'blockDie') return 'pow';
    if (req.type === 'pushSquare') return req.options[0].id;
    if (req.type === 'followUp') return 'yes';
    return req.options[0].id;
  });
  assert.equal(res.status, 'completed', JSON.stringify(res.events.map((e) => e.text), null, 1));
  const b1 = p(res.state, 'B1');
  assert.equal(b1.stance, 'prone');
  assert.deepEqual(b1.pos, c(12, 7));
  assert.deepEqual(p(res.state, 'A1').pos, c(11, 7));
});
