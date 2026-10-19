import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planAction, type PlayerActionInput } from '../src/engine/index';
import { c, p, Pos, runScripted } from './helpers';

const mv = (id: string, path: Array<[number, number]>, extra: Partial<PlayerActionInput> = {}): PlayerActionInput => ({
  kind: 'playerAction',
  playerId: id,
  action: 'move',
  path: path.map(([x, y]) => ({ to: c(x, y), kind: 'step' as const })),
  ...extra,
});

test('rush: third square beyond MA needs 2+; failure falls in the target square and ends the turn', () => {
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(5, 7), { id: 'A1', ma: 2 });
  b.add('B', 'orc', 'lineman', c(20, 7), { id: 'B1' });
  b.ball(c(15, 2));
  const s = b.start();
  const input = mv('A1', [[6, 7], [7, 7], [8, 7]]);
  const ok = runScripted(s, input, [2]);
  assert.equal(ok.status, 'completed');
  assert.equal(ok.state.turn.activation?.rushesUsed, 1);
  const bad = runScripted(s, input, [1, 3, 3]);
  assert.equal(bad.status, 'turnover');
  assert.deepEqual(p(bad.state, 'A1').pos, c(8, 7));
  assert.equal(p(bad.state, 'A1').stance, 'prone');
});

test('cannot rush more than twice (three with Sprint)', () => {
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(5, 7), { id: 'A1', ma: 1 });
  b.add('B', 'orc', 'lineman', c(20, 7), { id: 'B1' });
  b.ball(c(15, 2));
  const s = b.start();
  const plan = planAction(s, mv('A1', [[6, 7], [7, 7], [8, 7], [9, 7]]));
  assert.equal(plan.ok, false);
  const b2 = new Pos();
  b2.add('A', 'human', 'lineman', c(5, 7), { id: 'A1', ma: 1, extraSkills: [{ id: 'sprint' }] });
  b2.add('B', 'orc', 'lineman', c(20, 7), { id: 'B1' });
  b2.ball(c(15, 2));
  const plan2 = planAction(b2.start(), mv('A1', [[6, 7], [7, 7], [8, 7], [9, 7]]));
  assert.ok(plan2.ok, plan2.errors.join());
  // three rushes at 5/6 each
  assert.ok(Math.abs(plan2.withTeamRerolls!.pCompleted - Math.pow(5 / 6, 3)) < 1e-12);
});

test('pick-up: failed pick-up is a turnover and the ball bounces', () => {
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(5, 7), { id: 'A1' });
  b.add('B', 'orc', 'lineman', c(20, 7), { id: 'B1' });
  b.ball(c(6, 7));
  const s = b.start();
  const res = runScripted(s, mv('A1', [[6, 7]]), [2, 5]);
  assert.equal(res.status, 'turnover');
  assert.deepEqual(res.state.ball, { kind: 'ground', pos: c(7, 7) });
  const ok = runScripted(s, mv('A1', [[6, 7]]), [3]);
  assert.equal(ok.status, 'completed');
  assert.deepEqual(ok.state.ball, { kind: 'held', playerId: 'A1' });
});

test('Sure Hands offers a re-roll for a failed pick-up', () => {
  const b = new Pos();
  b.add('A', 'human', 'thrower', c(5, 7), { id: 'A1' });
  b.add('B', 'orc', 'lineman', c(20, 7), { id: 'B1' });
  b.ball(c(6, 7));
  const s = b.start();
  const res = runScripted(s, mv('A1', [[6, 7]]), [1, 4], ['skill']);
  assert.equal(res.status, 'completed');
  assert.deepEqual(res.state.ball, { kind: 'held', playerId: 'A1' });
  const plan = planAction(s, mv('A1', [[6, 7]]));
  assert.ok(Math.abs(plan.withTeamRerolls!.pCompleted - (1 - (2 / 6) * (2 / 6))) < 1e-12);
});

test('touchdown when a ball carrier enters the opposition end zone', () => {
  const b = new Pos();
  const a1 = b.add('A', 'human', 'catcher', c(23, 7), { id: 'A1' });
  b.add('B', 'orc', 'lineman', c(2, 7), { id: 'B1' });
  b.give(a1);
  const s = b.start();
  const res = runScripted(s, mv('A1', [[24, 7], [25, 7]]), []);
  assert.equal(res.status, 'touchdown');
  assert.equal(res.state.phase, 'touchdown');
  assert.equal(res.state.teams.A.score, 1);
});

test('accurate short pass caught in the end zone scores', () => {
  const b = new Pos();
  const thr = b.add('A', 'human', 'thrower', c(20, 7), { id: 'A1' });
  b.add('A', 'human', 'catcher', c(25, 5), { id: 'A2' });
  b.add('B', 'orc', 'lineman', c(2, 7), { id: 'B1' });
  b.give(thr);
  const s = b.start();
  const input: PlayerActionInput = { kind: 'playerAction', playerId: 'A1', action: 'pass', path: [], passTarget: c(25, 5) };
  // PA 3+, short pass -1 => natural 4 needed. Roll 4 (accurate), catch 3 (AG3+).
  const res = runScripted(s, input, [4, 3]);
  assert.equal(res.status, 'touchdown', res.events.map((e) => e.text).join('\n'));
  assert.equal(res.state.teams.A.score, 1);
});

test('fumbled pass: ball bounces from the thrower, turnover', () => {
  const b = new Pos();
  const thr = b.add('A', 'human', 'thrower', c(10, 7), { id: 'A1' });
  b.add('A', 'human', 'catcher', c(14, 7), { id: 'A2' });
  b.add('B', 'orc', 'lineman', c(2, 7), { id: 'B1' });
  b.give(thr);
  const s = b.start();
  const input: PlayerActionInput = { kind: 'playerAction', playerId: 'A1', action: 'pass', path: [], passTarget: c(14, 7) };
  // short pass (-1): natural 2 -> counts as 1 -> fumble ; bounce d8=5 -> (11,7)
  const res = runScripted(s, input, [2, 5], ['none']);
  assert.equal(res.status, 'turnover', res.events.map((e) => e.text).join('\n'));
  assert.deepEqual(res.state.ball, { kind: 'ground', pos: c(11, 7) });
});

test('interception by a player under the ruler causes a turnover', () => {
  const b = new Pos();
  const thr = b.add('A', 'human', 'thrower', c(10, 7), { id: 'A1' });
  b.add('A', 'human', 'catcher', c(14, 7), { id: 'A2' });
  b.add('B', 'orc', 'lineman', c(12, 8), { id: 'B1' });
  b.give(thr);
  const s = b.start();
  const input: PlayerActionInput = { kind: 'playerAction', playerId: 'A1', action: 'pass', path: [], passTarget: c(14, 7) };
  const plan = planAction(s, input);
  assert.ok(plan.ok, plan.errors.join());
  assert.equal(plan.pass?.interceptorsIfAccurate.length, 1);
  // accurate (5), interceptor AG3+ -3 accurate => needs natural 6
  const res = runScripted(s, input, [5, 6], (req) => (req.type === 'interceptor' ? 'B1' : req.options[0].id));
  assert.equal(res.status, 'turnover');
  assert.deepEqual(res.state.ball, { kind: 'held', playerId: 'B1' });
});

test('hand-off: failed catch bounces and causes a turnover', () => {
  const b = new Pos();
  const a1 = b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1' });
  b.add('A', 'human', 'lineman', c(11, 7), { id: 'A2' });
  b.add('B', 'orc', 'lineman', c(2, 7), { id: 'B1' });
  b.give(a1);
  const s = b.start();
  const input: PlayerActionInput = { kind: 'playerAction', playerId: 'A1', action: 'handoff', path: [], handoffTarget: 'A2' };
  const bad = runScripted(s, input, [2, 5]);
  assert.equal(bad.status, 'turnover');
  assert.deepEqual(bad.state.ball, { kind: 'ground', pos: c(12, 7) });
  const good = runScripted(s, input, [3]);
  assert.equal(good.status, 'completed');
  assert.deepEqual(good.state.ball, { kind: 'held', playerId: 'A2' });
  assert.equal(good.state.turn.activation, null);
});

test('Player Down knocks the attacker down and causes a turnover', () => {
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1' });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1' });
  b.ball(c(2, 2));
  const s = b.start();
  const input: PlayerActionInput = { kind: 'playerAction', playerId: 'A1', action: 'block', path: [], blockTarget: 'B1' };
  const res = runScripted(s, input, [1, 2, 2]);
  assert.equal(res.status, 'turnover');
  assert.equal(p(res.state, 'A1').stance, 'prone');
  assert.equal(res.state.turn.active, 'B');
});

test('Both Down: Block keeps the attacker up; defender without Block goes down; no turnover', () => {
  const b = new Pos();
  b.add('A', 'human', 'blitzer', c(10, 7), { id: 'A1' });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1' });
  b.ball(c(2, 2));
  const s = b.start();
  const input: PlayerActionInput = { kind: 'playerAction', playerId: 'A1', action: 'block', path: [], blockTarget: 'B1' };
  const res = runScripted(s, input, [2, 1, 1]);
  assert.equal(res.status, 'completed', res.events.map((e) => e.text).join('\n'));
  assert.equal(p(res.state, 'A1').stance, 'standing');
  assert.equal(p(res.state, 'B1').stance, 'prone');
});

test('crowd push: a defender on the sideline with no free push squares goes into the crowd', () => {
  const b = new Pos();
  b.add('A', 'human', 'blitzer', c(10, 1), { id: 'A1' });
  b.add('B', 'orc', 'lineman', c(10, 0), { id: 'B1' });
  b.ball(c(2, 2));
  const s = b.start();
  const input: PlayerActionInput = { kind: 'playerAction', playerId: 'A1', action: 'block', path: [], blockTarget: 'B1' };
  // Push result (3); crowd injury 2D6 = 3+3 -> stunned -> reserves
  const res = runScripted(s, input, [3, 3, 3], (req) => (req.type === 'followUp' ? 'no' : req.options[0].id));
  assert.equal(res.status, 'completed', res.events.map((e) => e.text).join('\n'));
  assert.equal(p(res.state, 'B1').location, 'reserves');
});

test('stalling: a carrier who could score without dice and ends the activation risks the crowd', () => {
  const b = new Pos({ turnA: 3 });
  const a1 = b.add('A', 'human', 'catcher', c(20, 7), { id: 'A1' });
  b.add('B', 'orc', 'lineman', c(2, 7), { id: 'B1' });
  b.give(a1);
  const s = b.start();
  const r1 = runScripted(s, mv('A1', [[21, 7]]), []);
  assert.equal(r1.status, 'completed');
  // End the activation: crowd D6 >= turn 3 -> hit. roll 4 -> knocked down, armour 1+1 holds, ball bounces d8 7 -> (21,8)
  const r2 = runScripted(r1.state, { kind: 'endActivation' }, [4, 1, 1, 7]);
  assert.equal(r2.status, 'turnover', r2.events.map((e) => e.text).join('\n'));
  assert.equal(p(r2.state, 'A1').stance, 'prone');
});

test('Secure the Ball: 2+ picks up without an Agility Test and ends the activation', () => {
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(5, 7), { id: 'A1' });
  b.add('B', 'orc', 'lineman', c(20, 7), { id: 'B1' });
  b.ball(c(7, 7));
  const s = b.start();
  const input: PlayerActionInput = { kind: 'playerAction', playerId: 'A1', action: 'secure', path: [{ to: c(6, 7), kind: 'step' }, { to: c(7, 7), kind: 'step' }] };
  const plan = planAction(s, input);
  assert.ok(plan.ok, plan.errors.join());
  assert.ok(Math.abs(plan.withTeamRerolls!.pCompleted - 5 / 6) < 1e-12);
  const res = runScripted(s, input, [2]);
  assert.equal(res.status, 'completed');
  assert.deepEqual(res.state.ball, { kind: 'held', playerId: 'A1' });
  assert.equal(res.state.turn.activation, null);
});

test('Blitz: move then block costs one square of movement', () => {
  const b = new Pos();
  b.add('A', 'human', 'blitzer', c(5, 7), { id: 'A1' });
  b.add('B', 'orc', 'lineman', c(9, 7), { id: 'B1' });
  b.ball(c(2, 2));
  const s = b.start();
  const input: PlayerActionInput = { kind: 'playerAction', playerId: 'A1', action: 'blitz', blitzTarget: 'B1', blockTarget: 'B1', path: [{ to: c(6, 7), kind: 'step' }, { to: c(7, 7), kind: 'step' }, { to: c(8, 7), kind: 'step' }] };
  const res = runScripted(s, input, [3], (req) => (req.type === 'followUp' ? 'yes' : req.options[0].id));
  assert.equal(res.status, 'completed', res.events.map((e) => e.text).join('\n'));
  assert.equal(res.state.turn.activation?.maUsed, 4);
  assert.deepEqual(p(res.state, 'A1').pos, c(9, 7));
  assert.deepEqual(p(res.state, 'B1').pos, c(10, 7));
});
