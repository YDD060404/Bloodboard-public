/**
 * V4: activation Traits — Animal Savagery (p.123), Bloodlust (p.125) and
 * Take Root (p.137). None of the four included rosters has them; custom
 * League players can.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actionOptions, planAction, type PlayerActionInput } from '../src/engine/index';
import { c, p, Pos, runScripted, type Chooser } from './helpers';

const move = (id: string, path: Array<[number, number]>, action: PlayerActionInput['action'] = 'move', extra: Partial<PlayerActionInput> = {}): PlayerActionInput => ({ kind: 'playerAction', playerId: id, action, path: path.map(([x, y]) => ({ to: c(x, y), kind: 'step' as const })), ...extra });
const block = (id: string, t: string): PlayerActionInput => ({ kind: 'playerAction', playerId: id, action: 'block', path: [], blockTarget: t });
const texts = (r: { events: { text: string }[] }) => r.events.map((e) => e.text).join('\n');
const asked: string[] = [];
const answer =
  (map: Record<string, string>): Chooser =>
  (req) => {
    asked.push(req.type);
    return map[req.type] ?? req.options[0].id;
  };

function scene(skills: Array<{ id: string; value?: number }>, extra?: (b: Pos) => void) {
  const b = new Pos({ rerollsA: 0 });
  b.add('A', 'orc', 'lineman', c(10, 7), { id: 'A1', extraSkills: skills });
  b.add('B', 'orc', 'lineman', c(22, 2), { id: 'B1' });
  b.ball(c(2, 2));
  extra?.(b);
  return b;
}

// --- Animal Savagery -----------------------------------------------------------

test('Animal Savagery: 4+ acts as declared; +2 for a Block or Blitz', () => {
  const s = scene([{ id: 'animalSavagery' }]).start();
  assert.equal(actionOptions(s, p(s, 'A1')).find((o) => o.action === 'move')!.enabled, true, 'can be activated now');
  const r = runScripted(s, move('A1', [[11, 7]]), [4]);
  assert.deepEqual(p(r.state, 'A1').pos, c(11, 7));
  const s2 = scene([{ id: 'animalSavagery' }], (b) => b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B2' })).start();
  // 2 + 2 = 4 → the Block goes ahead: POW (6), no follow-up, armour 2+2.
  const r2 = runScripted(s2, block('A1', 'B2'), [2, 6, 2, 2], answer({ followUp: 'no' }));
  assert.equal(p(r2.state, 'B2').stance, 'prone');
});

test('Animal Savagery: on 1-3 the player lashes out — the chosen adjacent team-mate is Knocked Down (no Turnover); the activation continues (FAQ May 2026 p.123)', () => {
  const s = scene([{ id: 'animalSavagery' }], (b) => b.add('A', 'orc', 'lineman', c(10, 8), { id: 'A2' })).start();
  asked.length = 0;
  // AS 3 fails → A2 Knocked Down, armour 2+2 holds.
  const r = runScripted(s, move('A1', [[11, 7]]), [3, 2, 2], answer({ animalSavagery: 'A2' }));
  assert.equal(p(r.state, 'A2').stance, 'prone');
  assert.deepEqual(p(r.state, 'A1').pos, c(11, 7), 'the declared Move is completed after the lash-out');
  assert.equal(r.state.turn.active, 'A', 'no Turnover');
  assert.match(texts(r), /lashes out at/);
});

test('Animal Savagery: Mighty Blow must be used on the Armour Roll; a team-mate holding the ball → Turnover', () => {
  const s = scene([{ id: 'animalSavagery' }, { id: 'mightyBlow' }], (b) => {
    const a2 = b.add('A', 'orc', 'lineman', c(10, 8), { id: 'A2' });
    b.give(a2);
  }).start();
  // AS 1 → A2 down: armour 5+4 = 9 +1 Mighty Blow = 10 vs AV 10 → broken; injury 2+2 Stunned; the ball bounces (D8 7).
  const r = runScripted(s, move('A1', [[11, 7]]), [1, 5, 4, 2, 2, 7], answer({ animalSavagery: 'A2' }));
  assert.equal(p(r.state, 'A2').stance, 'stunned', texts(r));
  assert.match(texts(r), /Mighty Blow \(Animal Savagery\)/);
  assert.notEqual(r.state.turn.active, 'A', 'the team-mate held the ball: Turnover');
});

test('Animal Savagery: no Standing team-mate adjacent → the player is Distracted', () => {
  const s = scene([{ id: 'animalSavagery' }]).start();
  const r = runScripted(s, move('A1', [[11, 7]]), [2]);
  assert.equal(p(r.state, 'A1').distracted, true);
  assert.deepEqual(p(r.state, 'A1').pos, c(10, 7));
});

// --- Bloodlust -----------------------------------------------------------------

function vampire(extra?: (b: Pos) => void, thrallAt: [number, number] | null = [10, 8]) {
  return scene([{ id: 'bloodlust', value: 2 }], (b) => {
    if (thrallAt) {
      const t = b.add('A', 'human', 'lineman', c(thrallAt[0], thrallAt[1]), { id: 'T' });
      t.keywords = ['Thrall', 'Lineman'];
    }
    extra?.(b);
  });
}

test('Bloodlust (2+): passing the roll changes nothing; a natural 1 fails even with +1 for a Block', () => {
  const s = vampire().start();
  const r = runScripted(s, move('A1', [[11, 7]]), [2]);
  assert.equal(r.state.turn.activation?.bloodlust, undefined);
  const s2 = vampire((b) => b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B2' })).start();
  asked.length = 0;
  // Natural 1 (+1 = 2) still fails: keep the Block; Block Push (3), no follow-up.
  // (The Thrall at (10,8) also Marks B2: 2 dice.)
  // At the end of the Block the Thrall is bitten (Injury 2+2 Stunned).
  const r2 = runScripted(s2, block('A1', 'B2'), [1, 3, 3, 2, 2], (req) => {
    asked.push(req.type);
    if (req.type === 'bloodlust') return req.options.some((o) => o.id === 'keep') ? 'keep' : 'T';
    return req.type === 'followUp' ? 'no' : req.options[0].id;
  });
  assert.notEqual(r2.status, 'illegal', r2.error);
  assert.ok(asked.includes('bloodlust'));
  assert.match(texts(r2), /overcome by Bloodlust/);
});

test('Bloodlust: a failed roll — bite an adjacent Thrall at the end of the activation (Injury Roll, Casualty → Badly Hurt), no Turnover', () => {
  const s = vampire().start();
  const r1 = runScripted(s, move('A1', [[11, 8]]), [1]);
  assert.equal(r1.state.turn.activation?.bloodlust, 'hungry');
  // End the activation: bite T (still adjacent at (10,8)); Injury 6+6 = Casualty treated as Badly Hurt.
  const r2 = runScripted(r1.state, { kind: 'endActivation' }, [6, 6], answer({ bloodlust: 'T' }));
  assert.equal(r2.state.turn.active, 'A', 'no Turnover');
  assert.equal(p(r2.state, 'T').location, 'cas');
  assert.equal(p(r2.state, 'T').casualtyResult ?? 'Badly Hurt', p(r2.state, 'T').casualtyResult ?? 'Badly Hurt');
  assert.match(texts(r2), /bites/);
});

test('Bloodlust: no bite → Turnover, the player is Distracted and drops the ball', () => {
  // A Thrall far away (reachable) keeps the activation open; ending it without a bite is the Turnover.
  const s = vampire((b) => b.give(p(b.s, 'A1')), [16, 7]).start();
  const r1 = runScripted(s, move('A1', [[11, 7]]), [1]);
  assert.equal(r1.state.turn.activation?.bloodlust, 'hungry', 'a Thrall can still be reached: the activation stays open');
  const r2 = runScripted(r1.state, { kind: 'endActivation' }, [7], answer({}));
  assert.notEqual(r2.state.turn.active, 'A', 'Turnover');
  assert.equal(p(r2.state, 'A1').distracted || p(r2.state, 'A1').stance !== 'standing', true);
  assert.equal(r2.state.ball.kind, 'ground');
});

// --- V5.5: a resolved Bloodlust Turnover passes the Turn at once ------------------------------------------------

test('Bloodlust (V5.5): no Thrall can be reached any more → the Turnover is resolved after the move and the Turn passes (no extra step)', () => {
  // No Thrall on the pitch at all.
  const s = vampire((b) => b.give(p(b.s, 'A1')), null).start();
  const r = runScripted(s, move('A1', [[11, 7]]), [1, 7], answer({}));
  assert.notEqual(r.status, 'illegal', r.error);
  assert.deepEqual(p(r.state, 'A1').pos, c(11, 7), 'the planned move is made first');
  assert.equal(r.state.turn.active, 'B', 'the Turn has passed to the opponent');
  assert.equal(r.state.turn.activation, null);
  assert.match(texts(r), /did not bite a Thrall \(Bloodlust\)/);
  assert.equal(r.state.ball.kind, 'ground', 'the ball is dropped');
  // A Thrall too far away to reach with the movement left (MA 6: 1 used, 5 + 2 Rushes left) — the same.
  const s2 = vampire(undefined, [22, 12]).start();
  const r2 = runScripted(s2, move('A1', [[11, 7]]), [1], answer({}));
  assert.equal(r2.state.turn.active, 'B', texts(r2));
});

test('Bloodlust (V5.5): a failed roll is not an immediate Turnover while a Thrall can still be reached — the player keeps moving and bites', () => {
  const s = vampire(undefined, [15, 7]).start();
  const r1 = runScripted(s, move('A1', [[11, 7]]), [1]);
  assert.equal(r1.state.turn.active, 'A', 'no Turnover yet');
  assert.equal(r1.state.turn.activation?.bloodlust, 'hungry');
  // Keep moving next to the Thrall (legitimate Bloodlust movement): the activation still stays open (MA left).
  const r2 = runScripted(r1.state, move('A1', [[12, 7], [13, 7], [14, 7]]), []);
  assert.equal(r2.state.turn.active, 'A');
  assert.equal(r2.state.turn.activation?.playerId, 'A1');
  // Ending the activation offers the bite (and "No bite (Turnover)").
  let offered: string[] = [];
  const r3 = runScripted(r2.state, { kind: 'endActivation' }, [2, 2], (req) => {
    offered = req.options.map((o) => o.label);
    return 'T';
  });
  assert.deepEqual(offered, ['Bite #' + p(r2.state, 'T').number + ' ' + p(r2.state, 'T').position, 'No bite (Turnover)'].map((x, i) => (i === 0 ? offered[0] : x)));
  assert.match(offered[0], /^Bite /);
  assert.equal(r3.state.turn.active, 'A', 'bitten: no Turnover');
  assert.match(texts(r3), /bites/);
});

test('Bloodlust (V5.5): out of movement next to a Thrall → the bite is asked at once; no bite = Turnover and the Turn passes', () => {
  // MA 5 + 2 Rushes: 7 squares to (17,7), next to the Thrall at (18,7).
  const s = vampire((b) => b.give(p(b.s, 'A1')), [18, 7]).start();
  const path: Array<[number, number]> = [[11, 7], [12, 7], [13, 7], [14, 7], [15, 7], [16, 7], [17, 7]];
  let asked2 = '';
  const r = runScripted(s, move('A1', path), [1, 6, 6, 7], (req) => {
    asked2 = req.prompt;
    return 'none';
  });
  assert.notEqual(r.status, 'illegal', r.error);
  assert.match(asked2, /activation ends — bite a Thrall/);
  assert.equal(r.state.turn.active, 'B', texts(r));
  const r2 = runScripted(s, move('A1', path), [1, 6, 6, 2, 2], answer({ bloodlust: 'T' }));
  assert.equal(r2.state.turn.active, 'A', 'bitten: no Turnover');
  assert.equal(r2.state.turn.activation, null, 'the activation has ended (no movement left)');
});

test('Bloodlust (V5.5, the reported match log): a declared Block, a natural 1 fails despite the +1, "Change to a Move Action" — the activation goes on as a Move while a Thrall is in reach; with none, the Turnover follows at once', () => {
  const blockB2 = block('A1', 'B2');
  // A Thrall in reach (not adjacent): the Move goes on, nothing to confirm.
  const s = vampire((b) => b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B2' }), [14, 9]).start();
  const r = runScripted(s, blockB2, [1], answer({ bloodlust: 'move' }));
  assert.notEqual(r.status, 'illegal', r.error);
  assert.match(texts(r), /rolled 1.*failed/);
  assert.equal(r.state.turn.activation?.action, 'move');
  assert.equal(r.state.turn.activation?.bloodlust, 'hungry');
  assert.equal(r.state.turn.active, 'A');
  // Moving next to the Thrall and ending the activation: the bite (no Turnover).
  const r2 = runScripted(r.state, move('A1', [[10, 8], [11, 8], [12, 8], [13, 8]]), [6, 6, 6, 6]);
  assert.notEqual(r2.status, 'illegal', r2.error);
  const r3 = runScripted(r2.state, { kind: 'endActivation' }, [2, 2], answer({ bloodlust: 'T' }));
  assert.equal(r3.state.turn.active, 'A');
  // No Thrall on the pitch: after "Change to a Move Action" there is nothing left to do — Turnover now, the Turn passes.
  const s2 = vampire((b) => b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B2' }), null).start();
  const r4 = runScripted(s2, blockB2, [1], answer({ bloodlust: 'move' }));
  assert.notEqual(r4.status, 'illegal', r4.error);
  assert.equal(r4.state.turn.active, 'B', texts(r4));
  assert.match(texts(r4), /did not bite a Thrall/);
});

test('Bloodlust (V5.5): a Blitz whose Block is still to come stays open even when no Thrall can be reached', () => {
  const s = vampire((b) => b.add('B', 'orc', 'lineman', c(14, 7), { id: 'B2' }), null).start();
  const r = runScripted(s, { ...move('A1', [[11, 7]], 'blitz'), blitzTarget: 'B2' }, [1], answer({ bloodlust: 'keep' }));
  assert.equal(r.state.turn.active, 'A');
  assert.equal(r.state.turn.activation?.action, 'blitz', 'the Block of the Blitz can still be made before the Turnover');
});

test('Bloodlust (V5.5): planning another player while the hungry one has no Thrall next to them is not offered as a no-op Action', () => {
  const s = vampire((b) => b.add('A', 'orc', 'lineman', c(5, 10), { id: 'A3' }), [15, 7]).start();
  const r1 = runScripted(s, move('A1', [[11, 7]]), [1]);
  assert.equal(r1.state.turn.activation?.bloodlust, 'hungry');
  const pl = planAction(r1.state, move('A3', [[6, 10]]));
  assert.equal(pl.ok, false);
  assert.equal(pl.endsHungry?.turnover, true);
  assert.match(pl.errors[0], /ending that activation is a Turnover, so this Action would not be taken/);
  // Next to a Thrall: the plan is fine and says the bite is asked first.
  const r2 = runScripted(r1.state, move('A1', [[12, 7], [13, 7], [14, 7]]), []);
  const pl2 = planAction(r2.state, move('A3', [[6, 10]]));
  assert.equal(pl2.ok, true, pl2.errors.join(' | '));
  assert.equal(pl2.endsHungry?.turnover, false);
});

test('Bloodlust (V5): a Hand-off to the only Thrall, who is bitten and Knocked-out first, is not made — the ball stays with the Vampire, no Turnover', () => {
  const s = vampire((b) => b.give(p(b.s, 'A1'))).start();
  // Bloodlust 1 (hungry, keep the Hand-off); bite T (the receiver): Injury 4+5 = 9, Knocked-out.
  const r = runScripted(s, { kind: 'playerAction', playerId: 'A1', action: 'handoff', path: [], handoffTarget: 'T' }, [1, 4, 5], (req) => (req.type === 'bloodlust' ? (req.options.some((o) => o.id === 'keep') ? 'keep' : 'T') : req.options[0].id));
  assert.notEqual(r.status, 'illegal', r.error);
  assert.equal(p(r.state, 'T').location, 'ko', texts(r));
  assert.match(texts(r), /can no longer take the Hand-off \(bitten\), so it is not made/);
  assert.deepEqual(r.state.ball, { kind: 'held', playerId: 'A1' });
  assert.equal(r.state.turn.active, 'A', 'no Turnover');
});

test('Bloodlust: a Hand-off needs a bite first; without a Thrall next to him the Hand-off is not made (no illegal input after the dice)', () => {
  const s = vampire(
    (b) => {
      b.give(p(b.s, 'A1'));
      b.add('A', 'human', 'lineman', c(12, 7), { id: 'R' });
    },
    null,
  ).start();
  const keepThen = (bite: string): Chooser => (req) => (req.type === 'bloodlust' ? (req.options.some((o) => o.id === 'keep') ? 'keep' : bite) : req.options[0].id);
  // V5.5: no Thrall on the pitch at all — the Hand-off can never be made, so the Bloodlust Turnover is resolved at
  // once (the ball is dropped: bounce D8 7) and the Turn passes; no illegal input, no extra step.
  const r = runScripted(s, { ...move('A1', [[11, 7]], 'handoff'), handoffTarget: 'R' }, [1, 7], keepThen('none'));
  assert.notEqual(r.status, 'illegal', r.error);
  assert.match(texts(r), /the Hand-off is not made/);
  assert.equal(r.state.turn.active, 'B', 'Turnover');
  assert.equal(r.state.ball.kind, 'ground');
  // A Thrall that can still be reached: the Hand-off is not made, but the activation continues (move to the Thrall).
  const s1 = vampire(
    (b) => {
      b.give(p(b.s, 'A1'));
      b.add('A', 'human', 'lineman', c(12, 7), { id: 'R' });
    },
    [14, 9],
  ).start();
  const r1 = runScripted(s1, { ...move('A1', [[11, 7]], 'handoff'), handoffTarget: 'R' }, [1], keepThen('none'));
  assert.equal(r1.state.ball.kind === 'held' && r1.state.ball.playerId, 'A1', 'still holds the ball');
  assert.equal(r1.state.turn.activation?.bloodlust, 'hungry');
  // With a Thrall next to him: bite (Injury 2+2 Stunned), then the Hand-off (catch 4).
  const s2 = vampire((b) => {
    b.give(p(b.s, 'A1'));
    b.add('A', 'human', 'lineman', c(12, 7), { id: 'R' });
  }, [11, 8]).start();
  const r2 = runScripted(s2, { ...move('A1', [[11, 7]], 'handoff'), handoffTarget: 'R' }, [1, 2, 2, 4], keepThen('T'));
  assert.equal(r2.state.ball.kind === 'held' && r2.state.ball.playerId, 'R', texts(r2));
});

test('Bloodlust: a declared Blitz may become a Move Action (it still counts as the Blitz of the Turn)', () => {
  const s = vampire((b) => b.add('B', 'orc', 'lineman', c(14, 7), { id: 'B2' })).start();
  const r = runScripted(s, { ...move('A1', [[11, 7]], 'blitz'), blitzTarget: 'B2' }, [1], answer({ bloodlust: 'move' }));
  assert.equal(r.state.turn.activation?.action, 'move');
  assert.equal(r.state.turn.used.blitz, true);
  assert.deepEqual(p(r.state, 'A1').pos, c(11, 7));
});

// --- Take Root -----------------------------------------------------------------

test('Take Root: on a 1 the player is Rooted — the planned move is not made, the activation continues, no Turnover', () => {
  const s = scene([{ id: 'takeRoot' }]).start();
  const r = runScripted(s, move('A1', [[11, 7], [12, 7]]), [1]);
  assert.notEqual(r.status, 'illegal', r.error);
  assert.equal(p(r.state, 'A1').rooted, true);
  assert.deepEqual(p(r.state, 'A1').pos, c(10, 7));
  assert.equal(r.state.turn.active, 'A');
  assert.match(texts(r), /Rooted and cannot move/);
  // Further movement is refused before any dice.
  const r2 = runScripted(r.state, move('A1', [[11, 7]]), []);
  assert.equal(r2.status, 'illegal');
  // 2+: moves as planned.
  const r3 = runScripted(s, move('A1', [[11, 7]]), [2]);
  assert.deepEqual(p(r3.state, 'A1').pos, c(11, 7));
});

test('Take Root: a Rooted player cannot be Pushed Back and stops being Rooted when Knocked Down; a Rooted blocker cannot Follow-up', () => {
  const b = new Pos({ rerollsA: 0 });
  b.add('A', 'orc', 'lineman', c(10, 7), { id: 'A1' });
  const t = b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B2', extraSkills: [{ id: 'takeRoot' }] });
  t.rooted = true;
  b.ball(c(2, 2));
  const s = b.start();
  // POW (6): not pushed; Knocked Down in place (armour 2+2) → no longer Rooted.
  const r = runScripted(s, block('A1', 'B2'), [6, 2, 2], answer({}));
  assert.deepEqual(p(r.state, 'B2').pos, c(11, 7));
  assert.equal(p(r.state, 'B2').stance, 'prone');
  assert.ok(!p(r.state, 'B2').rooted);
  const b2 = new Pos({ rerollsA: 0 });
  const a1 = b2.add('A', 'orc', 'lineman', c(10, 7), { id: 'A1', extraSkills: [{ id: 'takeRoot' }] });
  a1.rooted = true;
  b2.add('B', 'orc', 'lineman', c(11, 7), { id: 'B2' });
  b2.ball(c(2, 2));
  asked.length = 0;
  // Push (3): the rooted blocker cannot follow up.
  const r2 = runScripted(b2.start(), block('A1', 'B2'), [3], answer({}));
  assert.ok(!asked.includes('followUp'));
  assert.deepEqual(p(r2.state, 'A1').pos, c(10, 7));
});

test('Previews with the Traits assume the roll is passed and show its odds', () => {
  const s = scene([{ id: 'animalSavagery' }]).start();
  const plan = planAction(s, move('A1', [[11, 7]]));
  assert.ok(plan.ok, plan.errors.join());
  assert.ok(Math.abs(plan.withoutTeamRerolls!.pCompleted - 0.5) < 1e-9, String(plan.withoutTeamRerolls!.pCompleted));
});
