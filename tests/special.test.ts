/**
 * Throw Team-mate (p.76-78) and Projectile Vomit (p.133).
 * D8 directions (p.34 template): 1 up-left, 2 up, 3 up-right, 4 left, 5 right, 6 down-left, 7 down, 8 down-right.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actionOptions, planAction, type GameState, type PlayerActionInput } from '../src/engine/index';
import { c, p, Pos, runScripted } from './helpers';

const texts = (r: { events: { text: string }[] }) => r.events.map((e) => e.text).join('\n');

function ttm(thrower: string, thrown: string, target: [number, number], path: Array<[number, number]> = []): PlayerActionInput {
  return { kind: 'playerAction', playerId: thrower, action: 'ttm', path: path.map(([x, y]) => ({ to: c(x, y), kind: 'step' as const })), thrownPlayerId: thrown, throwTarget: c(target[0], target[1]) };
}

/** Human Ogre (PA 5+, Bone Head, Loner 3+, TTM) and a Halfling (Right Stuff, AG 3+). */
function humans(extra?: (b: Pos) => void): GameState {
  const b = new Pos({ rerollsA: 0 });
  b.add('A', 'human', 'ogre', c(10, 7), { id: 'O' });
  b.add('A', 'human', 'halfling', c(11, 7), { id: 'H' });
  b.add('B', 'orc', 'lineman', c(22, 2), { id: 'B1' });
  b.ball(c(2, 2));
  extra?.(b);
  return b.start();
}

test('TTM is available to a Throw Team-mate player with a Right Stuff team-mate on the pitch', () => {
  const s = humans();
  const o = actionOptions(s, p(s, 'O')).find((x) => x.action === 'ttm');
  assert.ok(o && o.enabled, o?.reason);
  const s2 = humans();
  s2.players = s2.players.filter((q) => q.id !== 'H');
  assert.equal(actionOptions(s2, p(s2, 'O')).find((x) => x.action === 'ttm')?.enabled, false);
});

test('Superb Throw scatters (3) from the target, then an Agility Test to land; no Turnover (p.77-78)', () => {
  const s = humans();
  // Bone Head 4 (ok) · PA test 6 (Superb) · scatter D8 2,7,4 from N8(13,7): up, down, left → M8 (12,7) · landing 4
  const r = runScripted(s, ttm('O', 'H', [13, 7]), [4, 6, 2, 7, 4, 4]);
  assert.equal(r.status, 'completed', texts(r));
  assert.deepEqual(p(r.state, 'H').pos, c(12, 7));
  assert.equal(p(r.state, 'H').stance, 'standing');
  assert.match(texts(r), /Superb Throw/);
  assert.match(texts(r), /lands on their feet/);
  assert.equal(r.state.turn.used.ttm, true);
  assert.equal(p(r.state, 'O').activated, true);
});

test('Subpar Throw gives −1 to land; a failed landing Falls Over without a Turnover unless holding the ball', () => {
  const s = humans();
  // Bone Head 4 · PA 3 (Subpar; needs 5+) · scatter 5,5,6 from N8 → (14,7)(15,7)(14,8) · landing 3−1=2 fails · armour 1+1
  const r = runScripted(s, ttm('O', 'H', [13, 7]), [4, 3, 5, 5, 6, 3, 1, 1]);
  assert.equal(r.status, 'completed', texts(r));
  assert.deepEqual(p(r.state, 'H').pos, c(14, 8));
  assert.equal(p(r.state, 'H').stance, 'prone');
  assert.match(texts(r), /Subpar Throw/);
  // Same with the ball: Turnover and the ball bounces (D8 2).
  const s2 = humans((b) => b.give(p(b.s, 'H')));
  const r2 = runScripted(s2, ttm('O', 'H', [13, 7]), [4, 3, 5, 5, 6, 3, 1, 1, 2]);
  assert.equal(r2.status, 'turnover', texts(r2));
  assert.equal(r2.state.ball.kind, 'ground');
});

test('Fumbled Throw: the thrown player is dropped, bounces from the thrower and lands with −1 (p.77)', () => {
  const s = humans();
  // Bone Head 4 · PA 1 (Fumble) · bounce D8 8 from K8 (10,7) → L9 (11,8) · landing 4−1=3 ok
  const r = runScripted(s, ttm('O', 'H', [13, 7]), [4, 1, 8, 4]);
  assert.equal(r.status, 'completed', texts(r));
  assert.deepEqual(p(r.state, 'H').pos, c(11, 8));
  assert.match(texts(r), /Fumbled Throw/);
  assert.match(texts(r), /-1 Fumbled Throw/);
});

test('A thrown player who leaves the pitch goes into the crowd and causes a Turnover (p.77)', () => {
  const b = new Pos();
  b.add('A', 'human', 'ogre', c(10, 1), { id: 'O' });
  b.add('A', 'human', 'halfling', c(11, 1), { id: 'H' });
  b.add('B', 'orc', 'lineman', c(22, 9), { id: 'B1' });
  b.ball(c(2, 9));
  const s = b.start();
  // Bone Head 4 · PA 6 · scatter from N2 (13,1): 2 up → (13,0), 2 up → off · crowd injury 1+1 (Stunned → Reserves)
  const r = runScripted(s, ttm('O', 'H', [13, 1]), [4, 6, 2, 2, 5, 1, 1]);
  assert.equal(r.status, 'turnover', texts(r));
  assert.equal(p(r.state, 'H').location, 'reserves');
  assert.match(texts(r), /crowd/);
});

test('Crash landing: the occupant is Knocked Down, the thrown player bounces and Falls Over (p.78)', () => {
  const s = humans((b) => b.add('B', 'orc', 'lineman', c(13, 7), { id: 'B2' }));
  // Bone Head 4 · PA 6 · Bullseye? no → scatter 2,7,5: N7? from (13,7): up (13,6), down (13,7), right (14,7) — land (14,7)
  // Instead land ON B2: scatter 2,7,2,... use 4,5,? : left (12,7), right (13,7)=B2? path is per step; final = (13,7) after 4,5 then 7 → (13,8). Use 2,7,? final (13,7): 2 up, 7 down, then need a zero move — impossible, so use 4,5,5 → (12,7),(13,7),(14,7).
  // Simplest: B2 at the final square (14,7).
  const s2 = humans((b) => b.add('B', 'orc', 'lineman', c(14, 7), { id: 'B2' }));
  void s;
  // Bone Head 4 · PA 6 · scatter 4,5,5 → (14,7) occupied by B2 · B2 armour 1+1 holds · thrown bounces D8 5 → (15,7) · falls over, armour 1+1
  const r = runScripted(s2, ttm('O', 'H', [13, 7]), [4, 6, 4, 5, 5, 1, 1, 5, 1, 1]);
  assert.equal(r.status, 'completed', texts(r));
  assert.equal(p(r.state, 'B2').stance, 'prone');
  assert.deepEqual(p(r.state, 'H').pos, c(15, 7));
  assert.equal(p(r.state, 'H').stance, 'prone');
  assert.match(texts(r), /crash-lands/);
});

test('Crash landing on a team-mate Knocks them Down: Turnover (p.35, p.78)', () => {
  const s = humans((b) => b.add('A', 'human', 'lineman', c(14, 7), { id: 'A3' }));
  const r = runScripted(s, ttm('O', 'H', [13, 7]), [4, 6, 4, 5, 5, 1, 1, 5, 1, 1]);
  assert.equal(r.status, 'turnover', texts(r));
  assert.equal(p(r.state, 'A3').stance, 'prone');
});

test('Throwing the ball carrier into the End Zone scores when they land on their feet', () => {
  const b = new Pos({ turnA: 3, turnB: 2 });
  b.add('A', 'human', 'ogre', c(21, 7), { id: 'O' });
  const h = b.add('A', 'human', 'halfling', c(22, 7), { id: 'H' });
  b.add('B', 'orc', 'lineman', c(5, 2), { id: 'B1' });
  b.give(h);
  const s = b.start();
  // target Y8 (24,7) quick; Bone Head 4 · PA 6 · scatter 5,4,5 → (25,7) (24,7) (25,7) · landing 5
  const r = runScripted(s, ttm('O', 'H', [24, 7]), [4, 6, 5, 4, 5, 5]);
  assert.equal(r.status, 'touchdown', texts(r));
  assert.equal(r.state.teams.A.score, 1);
});

test('Always Hungry: 1 then 1 → the team-mate is eaten (a Turnover only if they held the ball, FAQ May 2026 p.123); 1 then 2+ → automatic Fumbled Throw (p.123)', () => {
  const mk = () => {
    const b = new Pos();
    b.add('A', 'orc', 'troll', c(10, 7), { id: 'T', skills: [{ id: 'alwaysHungry' }, { id: 'throwTeamMate' }] });
    b.add('A', 'orc', 'goblin', c(11, 7), { id: 'G' });
    b.add('B', 'human', 'lineman', c(20, 2), { id: 'B1' });
    b.ball(c(2, 2));
    return b.start();
  };
  const eaten = runScripted(mk(), ttm('T', 'G', [13, 7]), [1, 1]);
  assert.equal(eaten.status, 'completed', `no Turnover: the eaten team-mate did not have the ball. ${texts(eaten)}`);
  assert.equal(eaten.state.turn.active, 'A');
  assert.equal(p(eaten.state, 'G').location, 'cas');
  assert.match(texts(eaten), /eats/);
  // squirms free → fumble: bounce 5 from (10,7) → (11,7)? that is G's own vacated square → empty; landing 4−1=3 vs AG3 ok
  const free = runScripted(mk(), ttm('T', 'G', [13, 7]), [1, 3, 5, 4]);
  assert.equal(free.status, 'completed', texts(free));
  assert.match(texts(free), /squirms free/);
  assert.deepEqual(p(free.state, 'G').pos, c(11, 7));
});

test('illegal throws are rejected before any dice: out of range, not adjacent, no Right Stuff', () => {
  const s = humans((b) => b.add('A', 'human', 'lineman', c(9, 7), { id: 'L' }));
  assert.equal(planAction(s, ttm('O', 'H', [20, 7])).ok, false, 'Long range is not allowed');
  assert.equal(planAction(s, ttm('O', 'L', [13, 7])).ok, false, 'no Right Stuff');
  const far = humans((b) => {
    const h = b.s.players.find((q) => q.id === 'H');
    if (h) h.pos = c(15, 3);
  });
  assert.equal(planAction(far, ttm('O', 'H', [13, 7])).ok, false, 'not adjacent');
});

test('TTM preview lists the Passing Ability Test and the landing, and its odds add up', () => {
  const s = humans();
  const plan = planAction(s, ttm('O', 'H', [13, 7]));
  assert.ok(plan.ok, plan.errors.join());
  const kinds = plan.steps.map((st) => st.kind);
  assert.ok(kinds.includes('ttm') && kinds.includes('landing'), kinds.join());
  const w = plan.withoutTeamRerolls!;
  assert.ok(w.unresolved < 1e-6);
  // The rest is Bone Head (a 1 ends the activation without a Turnover, p.126).
  assert.ok(Math.abs(w.pCompleted + w.pTurnover + 1 / 6 - 1) < 1e-9, `${w.pCompleted} + ${w.pTurnover}`);
});

test('Projectile Vomit: 2+ → the target makes an unmodified Armour Roll; 1 → this player does (p.133)', () => {
  const mk = (mb = false) => {
    const b = new Pos({ rerollsA: 0 });
    b.add('A', 'orc', 'lineman', c(10, 7), { id: 'V', skills: [{ id: 'projectileVomit' }, ...(mb ? [{ id: 'mightyBlow' }] : [])] });
    b.add('B', 'human', 'lineman', c(11, 7), { id: 'T' });
    b.ball(c(2, 2));
    return b.start();
  };
  const vomit = (): PlayerActionInput => ({ kind: 'playerAction', playerId: 'V', action: 'special', special: 'projectileVomit', vomitTarget: 'T', path: [] });
  // 2 → hits; armour 5+5=10 vs AV9 → broken; injury 4+4=8 → KO
  const hit = runScripted(mk(true), vomit(), [2, 5, 5, 4, 4]);
  assert.equal(hit.status, 'completed', texts(hit));
  assert.equal(p(hit.state, 'T').location, 'ko');
  assert.match(texts(hit), /cannot be modified/);
  assert.ok(!/Mighty Blow/.test(texts(hit)), 'Mighty Blow does not apply');
  // armour holds: nothing happens, the target stays Standing
  const miss = runScripted(mk(), vomit(), [4, 2, 2]);
  assert.equal(p(miss.state, 'T').stance, 'standing');
  // 1 → own armour roll: 6+4=10 vs AV10 → broken; injury 2+3=5 → Stunned; no Turnover (no ball)
  const self = runScripted(mk(), vomit(), [1, 6, 4, 2, 3]);
  assert.equal(self.status, 'completed', texts(self));
  assert.equal(p(self.state, 'V').stance, 'stunned');
  assert.equal(p(self.state, 'V').activated, true);
});

test('Projectile Vomit can replace the Block of a Blitz; it counts as the Blitz for the Turn', () => {
  const b = new Pos();
  b.add('A', 'orc', 'lineman', c(8, 7), { id: 'V', skills: [{ id: 'projectileVomit' }] });
  b.add('B', 'human', 'lineman', c(11, 7), { id: 'T' });
  b.ball(c(2, 2));
  const s = b.start();
  const input: PlayerActionInput = { kind: 'playerAction', playerId: 'V', action: 'blitz', blitzTarget: 'T', vomitTarget: 'T', path: [{ to: c(9, 7), kind: 'step' }, { to: c(10, 7), kind: 'step' }] };
  const plan = planAction(s, input);
  assert.ok(plan.ok, plan.errors.join());
  const r = runScripted(s, input, [3, 2, 2]);
  assert.equal(r.status, 'completed', texts(r));
  assert.equal(r.state.turn.used.blitz, true);
  assert.equal(r.state.turn.activation, null);
});
