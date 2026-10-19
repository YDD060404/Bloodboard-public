/**
 * V4: Punt (p.134) and Fumblerooski (p.128) — the last two skills from the
 * Skill Table that the four included rosters can learn and that were still
 * switched off.
 *
 * Punt: Throw-in Template facing an End Zone or a Sideline; D6 direction
 * (1-2 / 3-4 / 5-6), D6 distance; a catch or a Bounce where it lands; no
 * Turnover if it ends on the ground, a Turnover if an opponent has it or it
 * went into the crowd. D8 directions: 1 up-left 2 up 3 up-right 4 left 5 right 6 down-left 7 down 8 down-right.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actionOptions, planAction, validateInput, type PlayerActionInput } from '../src/engine/index';
import { c, p, Pos, runScripted, type Chooser } from './helpers';

const punt = (id: string, facing: 'x-' | 'x+' | 'y-' | 'y+', path: Array<[number, number]> = []): PlayerActionInput => ({ kind: 'playerAction', playerId: id, action: 'special', special: 'punt', facing, path: path.map(([x, y]) => ({ to: c(x, y), kind: 'step' as const })) });
const texts = (r: { events: { text: string }[] }) => r.events.map((e) => e.text).join('\n');
const asked: string[] = [];
const answer =
  (map: Record<string, string>): Chooser =>
  (req) => {
    asked.push(req.type);
    return map[req.type] ?? req.options[0].id;
  };

/** A1 (Human Lineman + Punt) holds the ball at (10,7). */
function base(extra?: (b: Pos) => void, skills: string[] = ['punt']) {
  const b = new Pos({ rerollsA: 0 });
  const a1 = b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1', extraSkills: skills.map((id) => ({ id })) });
  b.add('B', 'orc', 'lineman', c(22, 2), { id: 'B1' });
  extra?.(b);
  b.give(a1);
  return b;
}

test('Punt is offered to a player with the Skill, once per Turn', () => {
  const s = base((b) => b.add('A', 'human', 'lineman', c(5, 3), { id: 'A2', extraSkills: [{ id: 'punt' }] })).start();
  const o = actionOptions(s, p(s, 'A1')).find((x) => x.action === 'special' && x.special === 'punt');
  assert.ok(o?.enabled, JSON.stringify(o));
  // Straight (3), 4 squares → (14,7), empty: it Bounces (D8 5 → 15,7) and comes to rest. No Turnover.
  const r = runScripted(s, punt('A1', 'x+'), [3, 4, 5]);
  assert.equal(r.status, 'completed', r.error);
  assert.deepEqual(r.state.ball, { kind: 'ground', pos: c(15, 7) });
  assert.equal(r.state.turn.active, 'A', 'no Turnover when it ends on the ground');
  assert.equal(r.state.turn.activation?.over ?? true, true);
  const o2 = actionOptions(r.state, p(r.state, 'A2')).find((x) => x.action === 'special' && x.special === 'punt');
  assert.equal(o2?.enabled, false);
  assert.match(o2?.reason ?? '', /Only one Punt/);
  assert.match(texts(r), /punts the ball towards the right End Zone/);
});

test('Punt: the direction D6 picks the diagonal or straight line of the template', () => {
  const s = base().start();
  // Facing the bottom Sideline (y+) from (10,7): D6 1 → one diagonal, 6 → the other; distance 2; bounce D8 2 (up).
  const r1 = runScripted(s, punt('A1', 'y+'), [1, 2, 2]);
  const r6 = runScripted(s, punt('A1', 'y+'), [6, 2, 2]);
  const land = (r: typeof r1) => (r.events.find((e) => /comes down in/.test(e.text))?.data as { landing: { x: number; y: number } }).landing;
  const l1 = land(r1);
  const l6 = land(r6);
  assert.equal(l1.y, 9);
  assert.equal(l6.y, 9);
  assert.deepEqual([Math.abs(l1.x - 10), Math.abs(l6.x - 10)], [2, 2]);
  assert.notEqual(l1.x, l6.x);
});

test('Punt: landing on a team-mate — a Catch; landing on an opponent who catches it — Turnover', () => {
  const mate = base((b) => b.add('A', 'human', 'catcher', c(13, 7), { id: 'C' })).start();
  // Straight 3 squares onto C: catch 4 (AG 3+).
  const r = runScripted(mate, punt('A1', 'x+'), [4, 3, 4]);
  assert.equal(r.state.ball.kind === 'held' && r.state.ball.playerId, 'C');
  assert.equal(r.state.turn.active, 'A');
  const opp = base((b) => b.add('B', 'orc', 'lineman', c(13, 7), { id: 'B2' })).start();
  const r2 = runScripted(opp, punt('A1', 'x+'), [4, 3, 5]);
  assert.equal(r2.state.ball.kind === 'held' && r2.state.ball.playerId, 'B2');
  assert.notEqual(r2.state.turn.active, 'A', 'Turnover');
});

test('Punt into the crowd: Turnover, and the fans throw it back', () => {
  const b = base();
  p(b.s, 'A1').pos = c(10, 1);
  const s = b.start();
  // Facing the top Sideline, straight, 3 squares: off the pitch after (10,0). Throw-in dice follow.
  const r = runScripted(s, punt('A1', 'y-'), [3, 3, 3, 3, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  assert.match(texts(r), /into the crowd/);
  assert.notEqual(r.state.turn.active, 'A');
});

test('Punt: move first (picking up the ball), then punt; no more moving afterwards; the ball is needed', () => {
  const b = new Pos({ rerollsA: 0 });
  b.add('A', 'human', 'lineman', c(8, 7), { id: 'A1', extraSkills: [{ id: 'punt' }] });
  b.add('B', 'orc', 'lineman', c(22, 2), { id: 'B1' });
  b.ball(c(10, 7));
  const s = b.start();
  // Move (9,7), (10,7): pick-up 3 (AG 3+); punt straight 2 → (12,7) → bounce D8 5 → (13,7).
  const r = runScripted(s, punt('A1', 'x+', [[9, 7], [10, 7]]), [3, 3, 2, 5]);
  assert.equal(r.status, 'completed', r.error);
  assert.deepEqual(p(r.state, 'A1').pos, c(10, 7));
  assert.deepEqual(r.state.ball, { kind: 'ground', pos: c(13, 7) });
  // Without the ball there is nothing to punt: the plan is refused.
  const s2 = base().start();
  const s3 = structuredClone(s2);
  s3.ball = { kind: 'ground', pos: c(3, 3) };
  assert.match(validateInput(s3, punt('A1', 'x+')).join(), /holding the ball/);
});

test('Punt with Kick: the direction and the distance may each be re-rolled (the direction first)', () => {
  const s = base(undefined, ['punt', 'kick']).start();
  asked.length = 0;
  // Direction 1 → re-rolled 3; distance 1 → re-rolled 5 → (15,7) → bounce D8 5 → (16,7).
  const r = runScripted(s, punt('A1', 'x+'), [1, 3, 1, 5, 5], answer({ punt: 'reroll' }));
  assert.equal(asked.filter((t) => t === 'punt').length, 2);
  assert.deepEqual(r.state.ball, { kind: 'ground', pos: c(16, 7) });
});

test('Punt preview: exact odds of an opponent ending with the ball', () => {
  const s = base((b) => b.add('B', 'orc', 'lineman', c(13, 7), { id: 'B2' })).start();
  const plan = planAction(s, punt('A1', 'x+'));
  assert.ok(plan.ok, plan.errors.join());
  const o = plan.withoutTeamRerolls!;
  assert.ok(o.explored > 0.999);
  assert.ok(o.pOppHasBall > 0 && o.pOppHasBall < 0.5, String(o.pOppHasBall));
  assert.ok(Math.abs(o.pTurnover - o.pOppHasBall) < 1e-9, 'here the only Turnover is an opponent with the ball');
});

// --- Fumblerooski ------------------------------------------------------------

const move = (id: string, path: Array<[number, number]>, extra: Partial<PlayerActionInput> = {}): PlayerActionInput => ({ kind: 'playerAction', playerId: id, action: 'move', path: path.map(([x, y]) => ({ to: c(x, y), kind: 'step' as const })), ...extra });

test('Fumblerooski: during a Move Action the ball carrier leaves the ball in a square they move out of (no Turnover)', () => {
  const s = base(undefined, ['fumblerooski']).start();
  const r = runScripted(s, move('A1', [[11, 7], [12, 7]], { leaveBall: true }), []);
  assert.equal(r.status, 'completed', r.error);
  assert.deepEqual(r.state.ball, { kind: 'ground', pos: c(10, 7) });
  assert.deepEqual(p(r.state, 'A1').pos, c(12, 7));
  assert.equal(r.state.turn.active, 'A');
  // In two parts: move one square, then leave the ball in (11,7) as the move continues.
  const r1 = runScripted(s, move('A1', [[11, 7]]), []);
  const r2 = runScripted(r1.state, move('A1', [[12, 7]], { leaveBall: true }), []);
  assert.equal(r2.status, 'completed', r2.error);
  assert.deepEqual(r2.state.ball, { kind: 'ground', pos: c(11, 7) });
});

test('Fumblerooski: only with the Skill, only in a Move Action, only while holding the ball and leaving the square', () => {
  const s0 = base().start();
  assert.match(validateInput(s0, move('A1', [[11, 7]], { leaveBall: true })).join(), /Only a player with Fumblerooski/);
  const s = base((b) => b.add('B', 'orc', 'lineman', c(14, 7), { id: 'B2' }), ['fumblerooski']).start();
  assert.match(validateInput(s, { ...move('A1', [[11, 7], [12, 7], [13, 7]], { leaveBall: true }), action: 'blitz', blitzTarget: 'B2' }).join(), /Move Action/);
  assert.match(validateInput(s, move('A1', [], { leaveBall: true })).join(), /move out of the square/);
});
