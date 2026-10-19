/**
 * V4: Lethal Flight (p.130) and Swoop (p.137) — skills of a player thrown by
 * a Throw Team-mate Action. Dice as in tests/special.test.ts: Bone Head D6,
 * Passing Ability D6, then the flight.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planAction, type GameState, type PlayerActionInput } from '../src/engine/index';
import { c, p, Pos, runScripted, type Chooser } from './helpers';

const ttm = (thrower: string, thrown: string, target: [number, number]): PlayerActionInput => ({ kind: 'playerAction', playerId: thrower, action: 'ttm', path: [], thrownPlayerId: thrown, throwTarget: c(target[0], target[1]) });
const texts = (r: { events: { text: string }[] }) => r.events.map((e) => e.text).join('\n');
const asked: string[] = [];
const answer =
  (map: Record<string, string>): Chooser =>
  (req) => {
    asked.push(req.type);
    return map[req.type] ?? req.options[0].id;
  };

/** Human Ogre (TTM) and a Halfling (Right Stuff) with the given extra skills; an Orc Lineman B2 (AV 10) at (14,7). */
function scene(halflingSkills: string[], opp = true): GameState {
  const b = new Pos({ rerollsA: 0 });
  b.add('A', 'human', 'ogre', c(10, 7), { id: 'O' });
  b.add('A', 'human', 'halfling', c(11, 7), { id: 'H', extraSkills: halflingSkills.map((id) => ({ id })) });
  if (opp) b.add('B', 'orc', 'lineman', c(14, 7), { id: 'B2' });
  b.add('B', 'orc', 'lineman', c(22, 2), { id: 'B1' });
  b.ball(c(2, 2));
  return b.start();
}

test('Lethal Flight: crash-landing on an opponent — +1 to their Armour Roll (chosen after the roll)', () => {
  // Bone Head 4 · PA 6 · scatter 4,5,5 → (14,7) on B2 · armour 5+4=9 vs AV 10: +1 breaks → injury 4+3=7 Stunned · bounce D8 5 → (15,7) · H falls, armour 1+1.
  const r = runScripted(scene(['lethalFlight']), ttm('O', 'H', [13, 7]), [4, 6, 4, 5, 5, 5, 4, 4, 3, 5, 1, 1], answer({ lethalFlight: 'armour' }));
  assert.equal(r.status, 'completed', texts(r));
  assert.equal(p(r.state, 'B2').stance, 'stunned');
  assert.match(texts(r), /Lethal Flight \+1 applied to the Armour Roll → 10 — armour broken/);
  // Without the Skill the same 9 holds.
  const r2 = runScripted(scene([]), ttm('O', 'H', [13, 7]), [4, 6, 4, 5, 5, 5, 4, 5, 1, 1]);
  assert.equal(p(r2.state, 'B2').stance, 'prone');
});

test('Lethal Flight: or kept for the Injury Roll; the Casualty is credited to the thrown player', () => {
  // Armour 6+6 broken anyway → +1 on the Injury Roll: 5+4+1 = 10 → Casualty; Casualty roll D16.
  const r = runScripted(scene(['lethalFlight']), ttm('O', 'H', [13, 7]), [4, 6, 4, 5, 5, 6, 6, 5, 4, 1, 5, 1, 1, 1, 1, 1], answer({ lethalFlight: 'use', apothecary: 'keep' }));
  assert.equal(p(r.state, 'B2').location, 'cas', texts(r));
  assert.match(texts(r), /Lethal Flight/);
});

test('Lethal Flight is not used against a team-mate', () => {
  const b = new Pos({ rerollsA: 0 });
  b.add('A', 'human', 'ogre', c(10, 7), { id: 'O' });
  b.add('A', 'human', 'halfling', c(11, 7), { id: 'H', extraSkills: [{ id: 'lethalFlight' }] });
  b.add('A', 'human', 'lineman', c(14, 7), { id: 'A3' });
  b.add('B', 'orc', 'lineman', c(22, 2), { id: 'B1' });
  b.ball(c(2, 2));
  asked.length = 0;
  const r = runScripted(b.start(), ttm('O', 'H', [13, 7]), [4, 6, 4, 5, 5, 5, 3, 5, 1, 1], answer({}));
  assert.ok(!asked.includes('lethalFlight'));
  assert.equal(p(r.state, 'A3').stance, 'prone');
});

test('Swoop: instead of Scattering, the Throw-in Template (D6 direction, D6 squares); the landing may be re-rolled', () => {
  const s = scene(['swoop'], false);
  asked.length = 0;
  // Bone Head 4 · PA 6 · Swoop facing the right End Zone: D6 3 (straight), D6 2 → (15,7) · landing 1 fails → Swoop re-roll 5.
  const r = runScripted(s, ttm('O', 'H', [13, 7]), [4, 6, 3, 2, 1, 5], (req) => {
    asked.push(req.type);
    if (req.type === 'swoop') return 'x+';
    if (req.type === 'reroll') return req.options.some((o) => o.id === 'skill') ? 'skill' : 'none';
    return req.options[0].id;
  });
  assert.equal(r.status, 'completed', texts(r));
  assert.deepEqual(p(r.state, 'H').pos, c(15, 7));
  assert.equal(p(r.state, 'H').stance, 'standing');
  assert.match(texts(r), /swoops from/);
  assert.ok(asked.includes('swoop'));
  // Scattering as normal is still possible: 4,5,5 → (14,7), landing 4.
  const r2 = runScripted(s, ttm('O', 'H', [13, 7]), [4, 6, 4, 5, 5, 4], answer({ swoop: 'scatter' }));
  assert.deepEqual(p(r2.state, 'H').pos, c(14, 7));
});

test('Previews of a throw with Swoop / Lethal Flight work (Swoop is assumed not used)', () => {
  for (const sk of [['swoop'], ['lethalFlight']]) {
    const plan = planAction(scene(sk), ttm('O', 'H', [13, 7]));
    assert.ok(plan.ok, plan.errors.join());
    assert.ok(plan.withoutTeamRerolls!.explored > 0.99);
  }
});
