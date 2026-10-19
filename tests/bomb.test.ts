/**
 * V4: Throw Bomb (Bombardier, p.125) and Kick Team-mate (p.130) — Special
 * Actions of custom players.
 * D8 directions: 1 up-left 2 up 3 up-right 4 left 5 right 6 down-left 7 down 8 down-right.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actionOptions, planAction, validateInput, type PlayerActionInput } from '../src/engine/index';
import { c, p, Pos, runScripted, type Chooser } from './helpers';

const bomb = (id: string, to: [number, number], path: Array<[number, number]> = []): PlayerActionInput => ({ kind: 'playerAction', playerId: id, action: 'special', special: 'bombardier', bombTarget: c(to[0], to[1]), path: path.map(([x, y]) => ({ to: c(x, y), kind: 'step' as const })) });
const texts = (r: { events: { text: string }[] }) => r.events.map((e) => e.text).join('\n');
const first: Chooser = (req) => (req.type === 'interceptor' ? 'none' : req.type === 'apothecary' ? 'keep' : req.options[0].id);

/** A1 (Orc Lineman, PA 4+, Bombardier) at (10,7); Human Linemen B1 (14,7) and B2 (14,8). */
function scene(extra?: (b: Pos) => void) {
  const b = new Pos({ rerollsA: 0 });
  b.add('A', 'orc', 'lineman', c(10, 7), { id: 'A1', extraSkills: [{ id: 'bombardier' }] });
  b.add('B', 'human', 'lineman', c(14, 7), { id: 'B1' });
  b.add('B', 'human', 'lineman', c(14, 8), { id: 'B2' });
  b.ball(c(2, 2));
  extra?.(b);
  return b.start();
}

test('Throw Bomb: offered once per Turn, thrown without moving first', () => {
  const s = scene((b) => b.add('A', 'orc', 'lineman', c(5, 5), { id: 'A2', extraSkills: [{ id: 'bombardier' }] }));
  const o = actionOptions(s, p(s, 'A1')).find((x) => x.action === 'special' && x.special === 'bombardier');
  assert.ok(o?.enabled, o?.reason);
  assert.match(validateInput(s, bomb('A1', [13, 7], [[11, 7]])).join(), /does not include movement/);
  const r = runScripted(s, bomb('A1', [13, 7]), [4, 1, 1], first);
  const o2 = actionOptions(r.state, p(r.state, 'A2')).find((x) => x.action === 'special' && x.special === 'bombardier');
  assert.equal(o2?.enabled, false);
  assert.match(o2?.reason ?? '', /Only one Throw Bomb/);
});

test('Throw Bomb: it comes to rest in an empty square and explodes — adjacent players are hit on 4+ and Knocked Down', () => {
  const s = scene();
  // Quick throw at (13,7): PA 4 accurate; blast D6 5 and 5 for B1 and B2 → both Knocked Down (armour 2+2, 2+2).
  const r = runScripted(s, bomb('A1', [13, 7]), [4, 5, 5, 2, 2, 2, 2], first);
  assert.equal(r.status, 'completed', texts(r));
  assert.equal(p(r.state, 'B1').stance, 'prone');
  assert.equal(p(r.state, 'B2').stance, 'prone');
  assert.match(texts(r), /BOOM! The bomb explodes in N8/);
  assert.equal(r.state.turn.active, 'A', 'no Turnover');
  // Misses on 1-3.
  const r2 = runScripted(s, bomb('A1', [13, 7]), [4, 3, 1], first);
  assert.equal(p(r2.state, 'B1').stance, 'standing');
  assert.equal(p(r2.state, 'B2').stance, 'standing');
});

test('Throw Bomb: a dropped bomb explodes in the catcher\'s square; a Fumbled one in the thrower\'s (Turnover)', () => {
  const s = scene();
  // Short throw at B1 (14,7): PA 5 (−1 Short) accurate; B1 fails the catch (1) → explodes: B1 hit; blast for B2 3 (miss); B1 armour 2+2.
  const r = runScripted(s, bomb('A1', [14, 7]), [5, 1, 3, 2, 2], first);
  assert.equal(p(r.state, 'B1').stance, 'prone', texts(r));
  assert.equal(p(r.state, 'B2').stance, 'standing');
  const f = runScripted(s, bomb('A1', [13, 7]), [1, 2, 2], first);
  assert.equal(p(f.state, 'A1').stance, 'prone', texts(f));
  assert.notEqual(f.state.turn.active, 'A', 'the thrower was Knocked Down: Turnover');
});

test('Throw Bomb: a caught bomb must be thrown again at once (the catcher\'s coach picks the square)', () => {
  const s = scene();
  const asked: string[] = [];
  // Short throw at B1: accurate 5; B1 catches (4) → must throw it: B1 (Human Lineman PA 4) throws back at the first offered square;
  // the rest of the dice: the second throw 1 (Fumble) → explodes in B1's square, B2 blast 6 → both hit; armour 2+2, 2+2.
  const r = runScripted(s, bomb('A1', [14, 7]), [5, 4, 1, 6, 2, 2, 2, 2], (req) => {
    asked.push(req.type);
    return first(req, s);
  });
  assert.ok(asked.includes('bombThrow'), asked.join());
  assert.match(texts(r), /catches the bomb and must throw it again/);
  assert.equal(p(r.state, 'B1').stance, 'prone', texts(r));
});

test('Throw Bomb preview: exact odds from the Passing Ability Test, the catch, and the blasts', () => {
  const s = scene();
  const plan = planAction(s, bomb('A1', [13, 7]));
  assert.ok(plan.ok, plan.errors.join());
  const o = plan.withoutTeamRerolls!;
  assert.ok(o.explored > 0.9 && Math.abs(o.explored + o.unresolved - 1) < 1e-6, `${o.explored} + ${o.unresolved}`);
  assert.ok(o.leaves <= 8000);
});

// --- Kick Team-mate -----------------------------------------------------------

function ktmScene() {
  const b = new Pos({ rerollsA: 0 });
  b.add('A', 'orc', 'lineman', c(10, 7), { id: 'K', extraSkills: [{ id: 'kickTeamMate' }] });
  b.add('A', 'orc', 'goblin', c(11, 7), { id: 'G' });
  b.add('B', 'human', 'lineman', c(22, 2), { id: 'B1' });
  b.ball(c(2, 2));
  return b.start();
}
const ktm = (target: [number, number]): PlayerActionInput => ({ kind: 'playerAction', playerId: 'K', action: 'special', special: 'kickTeamMate', path: [], thrownPlayerId: 'G', throwTarget: c(target[0], target[1]) });

test('Kick Team-mate: works like Throw Team-mate, and does not use the team\'s Throw Team-mate Action', () => {
  const s = ktmScene();
  const o = actionOptions(s, p(s, 'K')).find((x) => x.action === 'special' && x.special === 'kickTeamMate');
  assert.ok(o?.enabled, o?.reason);
  // PA 6 (Superb) · scatter 2,7,4 from (13,7) → (12,7) · landing 4 (Goblin AG 3+).
  const r2 = runScripted(s, ktm([13, 7]), [6, 2, 7, 4, 4], first);
  assert.equal(r2.status, 'completed', texts(r2));
  assert.deepEqual(p(r2.state, 'G').pos, c(12, 7));
  assert.equal(r2.state.turn.used.ktm, true);
  assert.equal(r2.state.turn.used.ttm, false);
  assert.match(texts(r2), /kicks #/);
});

test('Kick Team-mate: a Fumbled kick is an Injury Roll for the kicked player (Stunned counts as Knocked-out)', () => {
  const s = ktmScene();
  // PA 1 → Fumble: Injury 3+3 = 6 → Stunned → Knocked-out.
  const r = runScripted(s, ktm([13, 7]), [1, 3, 3], first);
  assert.equal(p(r.state, 'G').location, 'ko', texts(r));
});
