/**
 * V4: the targeted Special Actions of custom players — Stab (p.136), Breathe
 * Fire (p.126), Chomp (Monstrous Mouth, p.131), Hypnotic Gaze (p.129) and
 * Chainsaw Attack (p.126). None of the four included rosters has them.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actionOptions, planAction, validateInput, type PlayerActionInput, type SpecialId } from '../src/engine/index';
import { c, p, Pos, runScripted, type Chooser } from './helpers';

const special = (id: string, sp: SpecialId, target: string, path: Array<[number, number]> = []): PlayerActionInput => ({ kind: 'playerAction', playerId: id, action: 'special', special: sp, specialTarget: target, path: path.map(([x, y]) => ({ to: c(x, y), kind: 'step' as const })) });
const texts = (r: { events: { text: string }[] }) => r.events.map((e) => e.text).join('\n');
const first: Chooser = (req) => (req.type === 'followUp' ? 'no' : req.type === 'apothecary' ? 'keep' : req.options[0].id);

/** A1 (Orc Lineman + the Special Action's Trait) at (10,7) next to a Human Lineman T (AV 9) at (11,7). */
function scene(skill: string, extra?: (b: Pos) => void, targetPos: [number, number] = [11, 7]) {
  const b = new Pos({ rerollsA: 0 });
  b.add('A', 'orc', 'lineman', c(10, 7), { id: 'A1', extraSkills: [{ id: skill }] });
  b.add('B', 'human', 'lineman', c(targetPos[0], targetPos[1]), { id: 'T' });
  b.ball(c(2, 2));
  extra?.(b);
  return b.start();
}

test('Special Actions are offered to players with the Trait (and Stab, Chainsaw, Breathe Fire, Chomp can replace the Block of a Blitz)', () => {
  for (const [skill, sp] of [['stab', 'stab'], ['breatheFire', 'breatheFire'], ['monstrousMouth', 'monstrousMouth'], ['hypnoticGaze', 'hypnoticGaze'], ['chainsaw', 'chainsaw']] as Array<[string, SpecialId]>) {
    const s = scene(skill);
    const o = actionOptions(s, p(s, 'A1')).find((x) => x.action === 'special' && x.special === sp);
    assert.ok(o?.enabled, `${sp}: ${o?.reason}`);
  }
});

test('Stab: an unmodified Armour Roll against an adjacent Standing opponent; broken → Injury Roll; the activation ends', () => {
  const s = scene('stab', (b) => b.add('A', 'orc', 'lineman', c(12, 6), { id: 'A2', extraSkills: [{ id: 'mightyBlow' }] }));
  // Armour 5+4 = 9 vs AV 9 → broken; injury 4+4 = 8 → KO.
  const r = runScripted(s, special('A1', 'stab', 'T'), [5, 4, 4, 4], first);
  assert.equal(r.status, 'completed', texts(r));
  assert.equal(p(r.state, 'T').location, 'ko');
  assert.match(texts(r), /Stab: cannot be modified/);
  assert.equal(r.state.turn.activation, null);
  const r2 = runScripted(s, special('A1', 'stab', 'T'), [4, 4], first);
  assert.equal(p(r2.state, 'T').stance, 'standing', 'armour holds: nothing happens');
  assert.match(validateInput(s, special('A1', 'stab', 'A2')).join(), /Standing opposition player next to/);
});

test('Breathe Fire: 1 → the player is Knocked Down (Turnover); 2-3 nothing; 4+ the target is Placed Prone; a natural 6 Knocks it Down; −1 against ST 5+', () => {
  const s = scene('breatheFire');
  const self = runScripted(s, special('A1', 'breatheFire', 'T'), [1, 2, 2], first);
  assert.equal(p(self.state, 'A1').stance, 'prone');
  assert.notEqual(self.state.turn.active, 'A', 'Turnover');
  const none = runScripted(s, special('A1', 'breatheFire', 'T'), [3], first);
  assert.equal(p(none.state, 'T').stance, 'standing');
  const prone = runScripted(s, special('A1', 'breatheFire', 'T'), [4], first);
  assert.equal(p(prone.state, 'T').stance, 'prone');
  assert.ok(!/Armour Roll for #/.test(texts(prone)), 'Placed Prone: no Armour Roll');
  const kd = runScripted(s, special('A1', 'breatheFire', 'T'), [6, 2, 2], first);
  assert.equal(p(kd.state, 'T').stance, 'prone');
  assert.match(texts(kd), /Armour Roll for/);
  // Against an Ogre (ST 5): a 4 counts as 3 → nothing happens.
  const big = scene('breatheFire', (b) => {
    b.s.players = b.s.players.filter((q) => q.id !== 'T');
    b.add('B', 'human', 'ogre', c(11, 7), { id: 'T' });
  });
  const r = runScripted(big, special('A1', 'breatheFire', 'T'), [4], first);
  assert.equal(p(r.state, 'T').stance, 'standing');
});

test('Chomp: 3+ → the target cannot leave its square while the player Marks it; 1-2 nothing', () => {
  const s = scene('monstrousMouth');
  const r = runScripted(s, special('A1', 'monstrousMouth', 'T'), [3], first);
  assert.equal(p(r.state, 'T').chompedBy, 'A1');
  // In B's Turn the Chomped player cannot move away.
  const sb = structuredClone(r.state);
  sb.turn.active = 'B';
  sb.turn.activation = null;
  for (const q of sb.players) q.activated = false;
  assert.match(validateInput(sb, { kind: 'playerAction', playerId: 'T', action: 'move', path: [{ to: c(12, 7), kind: 'step' }] }).join(), /Chomped/);
  const miss = runScripted(s, special('A1', 'monstrousMouth', 'T'), [2], first);
  assert.equal(p(miss.state, 'T').chompedBy, undefined);
});

test('Hypnotic Gaze: move first, then 3+ → the target is Distracted (no Tackle Zone); the activation ends either way', () => {
  const s = scene('hypnoticGaze', undefined, [13, 7]);
  const r = runScripted(s, special('A1', 'hypnoticGaze', 'T', [[11, 7], [12, 7]]), [3], first);
  assert.equal(r.status, 'completed', texts(r));
  assert.equal(p(r.state, 'T').distracted, true);
  assert.deepEqual(p(r.state, 'A1').pos, c(12, 7));
  assert.equal(r.state.turn.activation, null);
  const miss = runScripted(s, special('A1', 'hypnoticGaze', 'T', [[11, 7], [12, 7]]), [2], first);
  assert.equal(p(miss.state, 'T').distracted, false);
  assert.equal(miss.state.turn.active, 'A', 'no Turnover');
});

test('Chainsaw Attack: 2+ → Armour Roll +3 (not against Iron Hard Skin); 1 → Kick-back, the player is Knocked Down (+3 on its own Armour Roll)', () => {
  const s = scene('chainsaw');
  // 2 → armour 3+3 = 6 +3 = 9 vs AV 9 → broken; injury 2+2 Stunned.
  const r = runScripted(s, special('A1', 'chainsaw', 'T'), [2, 3, 3, 2, 2], first);
  assert.equal(p(r.state, 'T').stance, 'stunned', texts(r));
  // Kick-back: 1 → A1 Knocked Down; its Armour Roll 4+3 = 7 +3 chainsaw = 10 vs AV 10 → broken; injury 2+2 Stunned; Turnover.
  const k = runScripted(s, special('A1', 'chainsaw', 'T'), [1, 4, 3, 2, 2], first);
  assert.equal(p(k.state, 'A1').stance, 'stunned', texts(k));
  assert.notEqual(k.state.turn.active, 'A');
  // Iron Hard Skin: no +3.
  const ihs = scene('chainsaw', (b) => {
    p(b.s, 'T').skills.push({ id: 'ironHardSkin' });
  });
  const r3 = runScripted(ihs, special('A1', 'chainsaw', 'T'), [2, 3, 3], first);
  assert.equal(p(r3.state, 'T').stance, 'standing');
});

test('Chainsaw Foul: Kick-back roll, then +3 on the Foul\'s Armour Roll', () => {
  const s = scene('chainsaw', (b) => {
    p(b.s, 'T').stance = 'prone';
  });
  const foul: PlayerActionInput = { kind: 'playerAction', playerId: 'A1', action: 'foul', path: [], foulTarget: 'T', useChainsaw: true };
  // Kick-back 2 (fine); armour 3+4 = 7 +3 = 10 vs AV 9 → broken; injury 2+3 Stunned.
  const r = runScripted(s, foul, [2, 3, 4, 2, 3], first);
  assert.equal(r.status, 'completed', texts(r));
  assert.equal(p(r.state, 'T').stance, 'stunned');
  assert.match(texts(r), /with the chainsaw/);
});

test('Stab, Breathe Fire, Chomp and the Chainsaw can replace the Block of a Blitz', () => {
  for (const sp of ['stab', 'breatheFire', 'monstrousMouth', 'chainsaw'] as SpecialId[]) {
    const skill = sp;
    const b = new Pos({ rerollsA: 0 });
    b.add('A', 'orc', 'lineman', c(8, 7), { id: 'A1', extraSkills: [{ id: skill }] });
    b.add('B', 'human', 'lineman', c(11, 7), { id: 'T' });
    b.ball(c(2, 2));
    const s = b.start();
    const input: PlayerActionInput = { kind: 'playerAction', playerId: 'A1', action: 'blitz', blitzTarget: 'T', special: sp, specialTarget: 'T', path: [{ to: c(9, 7), kind: 'step' }, { to: c(10, 7), kind: 'step' }] };
    const plan = planAction(s, input);
    assert.ok(plan.ok, `${sp}: ${plan.errors.join()}`);
    assert.equal(validateInput(s, input).length, 0);
  }
});
