/**
 * V4: what the target of a Block may do before it is resolved — Trickster
 * (p.138) and Dump-off (p.128) — and the Block skills that act after a
 * knock-down: Saboteur (p.135) and Pile Driver (p.133).
 *
 * Block dice: 1 Player Down, 2 Both Down, 3-4 Push, 5 Stumble, 6 POW.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Engine from '../src/engine/index';
import { actionOptions, execute, ScriptedDice, type PlayerActionInput } from '../src/engine/index';
import { answerDecision, bindEngine } from '../src/ai/index';
import { c, p, Pos, runScripted, type Chooser } from './helpers';

const block = (id: string, target: string): PlayerActionInput => ({ kind: 'playerAction', playerId: id, action: 'block', path: [], blockTarget: target });
const texts = (r: { events: { text: string }[] }) => r.events.map((e) => e.text).join('\n');
const asked: string[] = [];
const answer =
  (map: Record<string, string>): Chooser =>
  (req) => {
    asked.push(req.type);
    return map[req.type] ?? req.options[0].id;
  };

/** A1 (Human Lineman, 10,7) next to B1 (Orc Lineman, 11,7); A2 assists from (12,7) unless moved away. */
function base(bSkills: string[], opts: { assist?: boolean } = {}) {
  const b = new Pos({ rerollsA: 0 });
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1' });
  if (opts.assist !== false) b.add('A', 'human', 'lineman', c(12, 7), { id: 'A2' });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1', extraSkills: bSkills.map((id) => ({ id })) });
  b.ball(c(1, 1));
  return b;
}

test('Trickster: before the dice, the target moves next to the blocker — assists are counted from the new square', () => {
  const s = base(['trickster']).start();
  // Stay: A2 assists → 2 dice (attacker chooses). POW + Push; armour 2+2 holds.
  const stay = runScripted(s, block('A1', 'B1'), [6, 3, 2, 2], answer({ trickster: 'stay', followUp: 'no', blockDie: 'pow' }));
  assert.match(texts(stay), /2 block dice/);
  // Move to (9,7), on the other side of A1: A2 no longer Marks B1 → 1 die.
  const moved = runScripted(s, block('A1', 'B1'), [6, 2, 2], answer({ trickster: '9,7', followUp: 'no' }));
  assert.equal(moved.status, 'completed');
  assert.match(texts(moved), /uses Trickster: \(?.*→/);
  assert.match(texts(moved), /1 block die/);
  const b1 = p(moved.state, 'B1');
  assert.equal(b1.stance, 'prone');
  assert.equal(b1.pos!.x, 8, 'pushed away from A1 out of the Trickster square');
});

test('Trickster: the offered squares are the unoccupied squares next to the blocker; placed on the ball, the target tries to pick it up', () => {
  const b = base(['trickster'], { assist: false });
  b.ball(c(10, 8));
  const s = b.start();
  let offered: string[] = [];
  // Pick-up: Orc AG 3+, Marked by A1 (−1) → 4+ needed: roll 4. Block: Push (3), push to (10,9) (first square), no follow-up.
  const r = runScripted(s, block('A1', 'B1'), [4, 3], (req) => {
    if (req.type === 'trickster') {
      offered = req.options.map((o) => o.id);
      return '10,8';
    }
    return req.type === 'followUp' ? 'no' : req.options[0].id;
  });
  assert.equal(offered[0], 'stay');
  assert.ok(!offered.includes('11,7'), 'not the square they are in');
  assert.ok(!offered.includes('12,7'), 'only squares next to the blocker');
  assert.equal(offered.length, 1 + 7, 'stay + the 7 other free squares around A1');
  assert.equal(r.status, 'completed');
  assert.equal(r.state.ball.kind === 'held' && r.state.ball.playerId, 'B1', 'picked up the ball, then pushed with it');
  assert.match(texts(r), /picks up the ball/);
});

test('Trickster: a failed pick-up bounces the ball (no Turnover for either side) and the Block goes on', () => {
  const b = base(['trickster'], { assist: false });
  b.ball(c(10, 8));
  const s = b.start();
  // Pick-up 1 fails → bounce D8 7 (down, to 10,9), Block POW, no follow-up, armour 2+2.
  const r = runScripted(s, block('A1', 'B1'), [1, 7, 6, 2, 2], answer({ trickster: '10,8', followUp: 'no', pushSquare: '11,9' }));
  assert.equal(r.status, 'completed');
  assert.equal(r.state.ball.kind, 'ground');
  assert.equal(r.state.turn.active, 'A', 'no Turnover');
  assert.equal(p(r.state, 'B1').stance, 'prone');
});

test('Dump-off: the targeted ball carrier makes a Quick Pass first, then the Block is resolved', () => {
  const b = base(['dumpOff'], { assist: false });
  const b1 = p(b.s, 'B1');
  b.add('B', 'orc', 'lineman', c(13, 7), { id: 'B2' });
  b.give(b1);
  const s = b.start();
  let offered: string[] = [];
  // Pass: Orc PA 4+, Marked by A1 (−1) → 5 accurate; catch 4 (AG 3+); Block POW (6), no follow-up, armour 2+2.
  const r = runScripted(s, block('A1', 'B1'), [5, 4, 6, 2, 2], (req) => {
    if (req.type === 'dumpOff') {
      offered = req.options.map((o) => o.id);
      return '13,7';
    }
    return req.type === 'followUp' ? 'no' : req.type === 'interceptor' ? 'none' : req.options[0].id;
  });
  assert.equal(offered[0], 'no');
  assert.ok(offered.includes('13,7'));
  assert.ok(offered.every((id) => id === 'no' || Math.max(Math.abs(+id.split(',')[0] - 11), Math.abs(+id.split(',')[1] - 7)) <= 3), 'Quick Pass range only');
  assert.equal(r.status, 'completed');
  assert.equal(r.state.ball.kind === 'held' && r.state.ball.playerId, 'B2');
  assert.equal(p(r.state, 'B1').stance, 'prone');
  assert.equal(r.state.turn.active, 'A', 'the Block goes on in A\'s Turn');
  assert.match(texts(r), /dumps the ball off/);
});

test('Dump-off: keeping the ball changes nothing; a player without the ball is not asked', () => {
  const b = base(['dumpOff'], { assist: false });
  b.give(p(b.s, 'B1'));
  const s = b.start();
  asked.length = 0;
  const r = runScripted(s, block('A1', 'B1'), [3], answer({ dumpOff: 'no', followUp: 'no' }));
  assert.ok(asked.includes('dumpOff'));
  assert.equal(r.state.ball.kind === 'held' && r.state.ball.playerId, 'B1');
  const s2 = base(['dumpOff'], { assist: false }).start();
  asked.length = 0;
  runScripted(s2, block('A1', 'B1'), [3], answer({ followUp: 'no' }));
  assert.ok(!asked.includes('dumpOff'));
});

test('Saboteur: on 4+ the blocker is also Knocked Down (no Turnover) and the saboteur is Knocked-out without an Armour Roll', () => {
  const s = base(['secretWeapon', 'saboteur'], { assist: false }).start();
  // POW, no follow-up; Saboteur D6 4 → A1 Knocked Down, A1 armour 2+2 holds.
  const r = runScripted(s, block('A1', 'B1'), [6, 4, 2, 2], answer({ followUp: 'no', saboteur: 'yes' }));
  assert.equal(r.status, 'completed');
  assert.equal(p(r.state, 'B1').location, 'ko');
  assert.equal(p(r.state, 'A1').stance, 'prone');
  assert.equal(r.state.turn.active, 'A', 'no Turnover: the blocker did not hold the ball');
  assert.match(texts(r), /sabotaged weapon goes off/);
  // On 1-3 nothing happens: B1's Armour Roll is made as normal (2+2 holds).
  const r2 = runScripted(s, block('A1', 'B1'), [6, 3, 2, 2], answer({ followUp: 'no', saboteur: 'yes' }));
  assert.equal(p(r2.state, 'B1').location, 'pitch');
  assert.equal(p(r2.state, 'B1').stance, 'prone');
  assert.equal(p(r2.state, 'A1').stance, 'standing');
});

test('Saboteur: a blocker holding the ball who is Knocked Down by it causes a Turnover', () => {
  const b = base(['secretWeapon', 'saboteur'], { assist: false });
  b.give(p(b.s, 'A1'));
  const s = b.start();
  // POW, no follow-up, Saboteur 5 → A1 down with the ball: armour 2+2, bounce D8 1.
  const r = runScripted(s, block('A1', 'B1'), [6, 5, 2, 2, 1, 1, 1, 1], answer({ followUp: 'no', saboteur: 'yes' }));
  assert.equal(p(r.state, 'B1').location, 'ko');
  assert.notEqual(r.state.turn.active, 'A', 'Turnover');
});

test('Pile Driver: after a knock-down with a follow-up, a free Foul, then the player is Placed Prone; the team Foul is still available', () => {
  const b = new Pos({ rerollsA: 0 });
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1', extraSkills: [{ id: 'pileDriver' }] });
  b.add('A', 'human', 'lineman', c(5, 5), { id: 'A2' });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1' });
  b.ball(c(1, 1));
  const s = b.start();
  // POW, push to (12,7), follow up; B1 armour 2+2 holds; Pile Driver: armour 6+5 = 11 breaks AV 10, injury 4+3 = 7 Stunned.
  const r = runScripted(s, block('A1', 'B1'), [6, 2, 2, 6, 5, 4, 3], (req) => (req.type === 'pushSquare' ? '12,7' : req.type === 'followUp' ? 'yes' : req.type === 'pileDriver' ? 'yes' : req.options[0].id));
  assert.equal(r.status, 'completed');
  assert.equal(p(r.state, 'B1').stance, 'stunned');
  assert.equal(p(r.state, 'A1').stance, 'prone', 'Placed Prone after the Foul');
  assert.equal(r.state.turn.active, 'A', 'no Turnover');
  const o = actionOptions(r.state, p(r.state, 'A2')).find((x) => x.action === 'foul')!;
  assert.notEqual(o.reason ?? '', 'The team has already been declared a Foul this Turn', 'team Foul not used');
  assert.ok(!/already been declared/.test(o.reason ?? ''));
});

test('Pile Driver: not offered when the blocker did not follow up (no longer Marking the target)', () => {
  const b = new Pos({ rerollsA: 0 });
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1', extraSkills: [{ id: 'pileDriver' }] });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1' });
  b.ball(c(1, 1));
  const s = b.start();
  asked.length = 0;
  const r = runScripted(s, block('A1', 'B1'), [6, 2, 2], answer({ pushSquare: '12,7', followUp: 'no' }));
  assert.ok(!asked.includes('pileDriver'));
  assert.equal(p(r.state, 'A1').stance, 'standing');
  // Declined: nothing happens, the player stays Standing.
  const r2 = runScripted(s, block('A1', 'B1'), [6, 2, 2], answer({ pushSquare: '12,7', followUp: 'yes', pileDriver: 'no' }));
  assert.equal(p(r2.state, 'A1').stance, 'standing');
  assert.equal(p(r2.state, 'B1').stance, 'prone');
});

test('Computer coach: Trickster steps away from the other opponents who could assist; no better square → stays', () => {
  bindEngine(Engine);
  const b = base(['trickster']); // A2 at (12,7) would assist against B1 in (11,7)
  const s = b.start();
  const r = execute(s, block('A1', 'B1'), undefined, () => new ScriptedDice([6, 2, 2]));
  assert.equal(r.status, 'awaitingDecision');
  assert.equal(r.decision!.type, 'trickster');
  const a = answerDecision(r.state, r.decision!, 'B', 'balanced');
  assert.notEqual(a.optionId, 'stay');
  const [x, y] = a.optionId.split(',').map(Number);
  assert.ok(Math.max(Math.abs(x - 12), Math.abs(y - 7)) > 1, 'not next to A2');
  const s2 = base(['trickster'], { assist: false }).start();
  const r2 = execute(s2, block('A1', 'B1'), undefined, () => new ScriptedDice([6, 2, 2]));
  assert.equal(answerDecision(r2.state, r2.decision!, 'B', 'balanced').optionId, 'stay');
});

test('Previews of a Block against Trickster / Dump-off / Saboteur players work (the policy assumes they are not used / always rolled)', () => {
  for (const sk of [['trickster'], ['dumpOff'], ['secretWeapon', 'saboteur']]) {
    const b = base(sk);
    if (sk[0] === 'dumpOff') b.give(p(b.s, 'B1'));
    const s = b.start();
    const plan = Engine.planAction(s, block('A1', 'B1'));
    assert.ok(plan.ok, `${sk.join('+')}: ${plan.errors?.join('; ')}`);
    const o = plan.withoutTeamRerolls!;
    assert.ok(o.pCompleted > 0 && o.pCompleted <= 1 && o.explored > 0.99, JSON.stringify(o));
  }
});
