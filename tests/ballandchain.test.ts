/**
 * V4: Ball & Chain (p.124) — the only Action such a player can declare; each
 * step: the Throw-in Template faces an End Zone or a Sideline and a D6 picks
 * the square (1-2 / 3-4 / 5-6); no Dodges; a Standing player there is Blocked
 * automatically (Foul Appearance ignored; against a team-mate the Ball &
 * Chain player's coach picks the result); a Prone / Stunned player is Pushed
 * Back and gets an Armour Roll; the ball Bounces; off the pitch: the crowd.
 * Knocked Down, Falls Over or Placed Prone: an Injury Roll at once, Stunned
 * counts as Knocked-out.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actionOptions, planAction, validateInput, type Facing, type PlayerActionInput } from '../src/engine/index';
import { c, p, Pos, runScripted, type Chooser } from './helpers';

const step = (facing: Facing): PlayerActionInput => ({ kind: 'playerAction', playerId: 'F', action: 'special', special: 'ballAndChain', facing, path: [] });
const texts = (r: { events: { text: string }[] }) => r.events.map((e) => e.text).join('\n');
const first: Chooser = (req) => (req.type === 'followUp' ? 'no' : req.type === 'apothecary' ? 'keep' : req.options[0].id);

/** The Fanatic F (a Goblin with Ball & Chain, MA 6) at (10,7); an Orc Lineman B1 marking him from (9,7). */
function scene(extra?: (b: Pos) => void) {
  const b = new Pos({ rerollsA: 0 });
  b.add('A', 'orc', 'goblin', c(10, 7), { id: 'F', extraSkills: [{ id: 'ballAndChain' }] });
  b.add('B', 'orc', 'lineman', c(9, 7), { id: 'B1' });
  b.ball(c(2, 2));
  extra?.(b);
  return b.start();
}

test('Ball & Chain: the only Action offered is the Ball & Chain Special Action', () => {
  const s = scene();
  const opts = actionOptions(s, p(s, 'F'));
  const bnc = opts.find((o) => o.action === 'special' && o.special === 'ballAndChain');
  assert.ok(bnc?.enabled, bnc?.reason);
  for (const o of opts) if (o !== bnc) assert.equal(o.enabled, false, o.label);
  assert.match(opts.find((o) => o.action === 'move')!.reason ?? '', /only declare the Ball & Chain/);
});

test('Ball & Chain: a D6 on the template picks the square; no Dodge is needed to leave a Tackle Zone; the activation goes on', () => {
  const s = scene();
  // Facing the right End Zone: 3 → straight to (11,7) — out of B1's Tackle Zone without a Dodge.
  const r = runScripted(s, step('x+'), [3], first);
  assert.equal(r.status, 'completed', texts(r));
  assert.deepEqual(p(r.state, 'F').pos, c(11, 7));
  assert.ok(!/Dodge/.test(texts(r)));
  assert.equal(r.state.turn.activation?.maUsed, 1);
  // Second step: 1 → the diagonal (12,6).
  const r2 = runScripted(r.state, step('x+'), [1], first);
  assert.deepEqual(p(r2.state, 'F').pos, c(12, 6));
  assert.match(validateInput(s, { ...step('x+'), path: [{ to: c(11, 7), kind: 'step' }] }).join(), /movement|Throw-in Template/);
});

test('Ball & Chain: into a Standing opponent — an automatic Block', () => {
  const s = scene((b) => b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B2' }));
  // Straight into B2: Goblin ST 2 v 3 → 2 dice, B2's coach chooses: 6,6 → POW; B2 pushed to (12,7); armour 2+2.
  const r = runScripted(s, step('x+'), [3, 6, 6, 2, 2], first);
  assert.equal(p(r.state, 'B2').stance, 'prone', texts(r));
  assert.match(texts(r), /blocks/);
});

test('Ball & Chain: into a Prone player — Pushed Back and an Armour Roll; into the ball — it Bounces (no Turnover)', () => {
  const s = scene((b) => b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B2', stance: 'prone' }));
  // Straight into prone B2: pushed to the first offered square; armour 6+5 = 11 vs AV 10 → broken; injury 2+2 Stunned.
  const r = runScripted(s, step('x+'), [3, 6, 5, 2, 2], first);
  assert.equal(p(r.state, 'B2').stance, 'stunned', texts(r));
  assert.deepEqual(p(r.state, 'F').pos, c(11, 7));
  const s2 = scene((b) => b.ball(c(11, 7)));
  const r2 = runScripted(s2, step('x+'), [4, 5], first);
  assert.equal(r2.state.turn.active, 'A', 'no Turnover');
  assert.equal(r2.state.ball.kind, 'ground');
  assert.notDeepEqual((r2.state.ball as { pos: unknown }).pos, c(11, 7));
});

test('Ball & Chain: off the pitch → the crowd; a failed Rush moves first, then Falls Over → Injury Roll (Stunned counts as Knocked-out)', () => {
  const b = new Pos({ rerollsA: 0 });
  b.add('A', 'orc', 'goblin', c(10, 0), { id: 'F', extraSkills: [{ id: 'ballAndChain' }] });
  b.add('B', 'orc', 'lineman', c(20, 7), { id: 'B1' });
  b.ball(c(2, 2));
  const s = b.start();
  const r = runScripted(s, step('y-'), [3, 1, 1], first);
  assert.equal(p(r.state, 'F').location === 'pitch', false, texts(r));
  assert.match(texts(r), /into the crowd/);
  // Use up the 6 MA (6 steps), then a Rush: 1 fails → moves, then Falls Over: Injury 3+3 = 6 → Stunned → KO.
  const s2 = scene();
  let st = s2;
  for (let i = 0; i < 6; i++) st = runScripted(st, step('y+'), [3], first).state;
  assert.deepEqual(p(st, 'F').pos, c(10, 13));
  const r2 = runScripted(st, step('x+'), [1, 3, 3, 3], first);
  assert.equal(p(r2.state, 'F').location, 'ko', texts(r2));
});

test('Ball & Chain preview works (a step with its Block)', () => {
  const s = scene((b) => b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B2' }));
  const plan = planAction(s, step('x+'));
  assert.ok(plan.ok, plan.errors.join());
  assert.ok(plan.withoutTeamRerolls!.explored > 0.99);
});
