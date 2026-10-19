/**
 * V4: Multiple Block (p.132) — with a Block Action, Block two different
 * opponents the player Marks at the same time, ST −2 for both, no Follow-up;
 * both Blocks are resolved in full even if one causes a Turnover.
 *
 * Block dice: 1 Player Down, 2 Both Down, 3-4 Push, 5 Stumble, 6 POW.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planAction, validateInput, type PlayerActionInput } from '../src/engine/index';
import { c, p, Pos, runScripted, type Chooser } from './helpers';

const mb = (id: string, t1: string, t2?: string, action: 'block' | 'blitz' = 'block'): PlayerActionInput => ({ kind: 'playerAction', playerId: id, action, path: [], blockTarget: t1, ...(t2 ? { blockTarget2: t2 } : {}), ...(action === 'blitz' ? { blitzTarget: t1 } : {}) });
const texts = (r: { events: { text: string }[] }) => r.events.map((e) => e.text).join('\n');
const asked: string[] = [];
const answer =
  (map: Record<string, string>): Chooser =>
  (req) => {
    asked.push(req.type);
    return map[req.type] ?? req.options[0].id;
  };

/** A1 (Human Blitzer made ST 5, + Multiple Block) at (10,7); B1 Orc Lineman (11,6); B2 Goblin (11,8). */
function base(opts: { block?: boolean; mb?: boolean } = {}) {
  const b = new Pos({ rerollsA: 0 });
  const skills = opts.block === false ? [{ id: 'multipleBlock' }] : [{ id: 'block' }, { id: 'tackle' }, { id: 'multipleBlock' }];
  b.add('A', 'human', 'blitzer', c(10, 7), { id: 'A1', st: 5, skills: opts.mb === false ? skills.filter((x) => x.id !== 'multipleBlock') : skills });
  b.add('B', 'orc', 'lineman', c(11, 6), { id: 'B1' });
  b.add('B', 'orc', 'goblin', c(11, 8), { id: 'B2' });
  b.ball(c(1, 1));
  return b;
}

test('Multiple Block: two Blocks at ST −2 (each target assisted by the other), no Follow-up; both targets go down', () => {
  const s = base().start();
  asked.length = 0;
  // B1: ST 3 v 3+1 (B2 marks A1) → 2 dice, defender chooses: 6,6 → POW; push to (12,5); armour 2+2.
  // B2 (Goblin ST 2 +1 from B1) v ST 3 → 1 die: 6 POW (Tackle beats nothing here); push; armour 2+2.
  const r = runScripted(s, mb('A1', 'B1', 'B2'), [6, 6, 2, 2, 6, 2, 2], answer({}));
  assert.equal(r.status, 'completed', r.error);
  const t = texts(r);
  assert.match(t, /Multiple Block on .* and .* \(ST −2 for both Blocks\)/);
  assert.match(t, /Strength 3 vs 4 .* 2 block dice, defender chooses/);
  assert.match(t, /Strength 3 vs 3 .* 1 block die/);
  assert.match(t, /Multiple Block: no Follow-up/);
  assert.ok(!asked.includes('followUp'));
  assert.equal(p(r.state, 'B1').stance, 'prone');
  assert.equal(p(r.state, 'B2').stance, 'prone');
  assert.deepEqual(p(r.state, 'A1').pos, c(10, 7), 'the blocker stays put');
  assert.equal(r.state.turn.active, 'A');
});

test('Multiple Block: a Turnover in the first Block does not stop the second one', () => {
  const s = base({ block: false }).start();
  // B1: 2 dice (defender chooses) 1,1 → Player Down: A1 Knocked Down (armour 2+2) → Turnover.
  // B2: 1 die 6 → POW still resolved against the Goblin: pushed and Knocked Down (armour 2+2).
  const r = runScripted(s, mb('A1', 'B1', 'B2'), [1, 1, 2, 2, 6, 2, 2], answer({}));
  assert.equal(p(r.state, 'A1').stance, 'prone');
  assert.equal(p(r.state, 'B2').stance, 'prone', 'second Block resolved in full');
  assert.equal(p(r.state, 'B1').stance, 'standing');
  assert.notEqual(r.state.turn.active, 'A', 'Turnover');
});

test('Multiple Block: a Both Down against an attacker already down only affects the target', () => {
  const s = base({ block: false }).start();
  // B1: 1,1 → Player Down (A1 down, armour 2+2). B2: Both Down (2): A1 is already down → only the Goblin goes down (armour 2+2).
  const r = runScripted(s, mb('A1', 'B1', 'B2'), [1, 1, 2, 2, 2, 2, 2], answer({}));
  assert.equal(p(r.state, 'B2').stance, 'prone');
  assert.match(texts(r), /already down: the Both Down result only affects/);
});

test('Multiple Block: legality — needs the Skill, two different targets, a Block Action (not a Blitz)', () => {
  const s0 = base({ mb: false }).start();
  assert.match(validateInput(s0, mb('A1', 'B1', 'B2')).join(), /Only a player with Multiple Block/);
  const s = base().start();
  assert.match(validateInput(s, mb('A1', 'B1', 'B1')).join(), /two different targets/);
  assert.match(validateInput(s, mb('A1', 'B1', 'B2', 'blitz')).join(), /not a Blitz/);
  assert.deepEqual(validateInput(s, mb('A1', 'B1', 'B2')), []);
});

test('Multiple Block: the preview gives the odds for both targets', () => {
  const s = base().start();
  const plan = planAction(s, mb('A1', 'B1', 'B2'));
  assert.ok(plan.ok, plan.errors.join());
  const o = plan.withoutTeamRerolls!;
  assert.ok(o.explored > 0.99);
  assert.ok(o.pTargetDown > 0 && o.pTargetDown < 1);
  assert.ok(o.pTarget2Down > 0 && o.pTarget2Down < 1);
  // Against the Goblin (1 die; Block + Tackle): POW, Stumble or Both Down (Goblin has no Block) → 3/6 down — except that
  // when the first Block was a Player Down (11/36: the defender chooses from 2 dice), the prone attacker can no longer
  // use Tackle (Active skills need a Standing player, p.123), so the Goblin's Dodge turns the Stumble into a Push.
  assert.ok(Math.abs(o.pTarget2Down - (0.5 - (11 / 36) * (1 / 6))) < 1e-6, String(o.pTarget2Down));
});
