import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actionOptions, blockStrength, gated, planAction, SKILLS, type GameState, type PlayerActionInput } from '../src/engine/index';
import { Ctx, DEFAULT_POLICY } from '../src/engine/context';
import { TraceDice } from '../src/engine/dice';
import { c, p, Pos, runScripted, type Chooser } from './helpers';

const mv = (id: string, path: Array<[number, number]>, extra: Partial<PlayerActionInput> = {}): PlayerActionInput => ({
  kind: 'playerAction',
  playerId: id,
  action: 'move',
  path: path.map(([x, y]) => ({ to: c(x, y), kind: 'step' as const })),
  ...extra,
});
const blk = (id: string, target: string): PlayerActionInput => ({ kind: 'playerAction', playerId: id, action: 'block', path: [], blockTarget: target });
const texts = (r: { events: { text: string }[] }) => r.events.map((e) => e.text).join('\n');
const strength = (s: GameState, a: string, d: string, blitz = false) => blockStrength(new Ctx(s, new TraceDice(), 'plan', [], DEFAULT_POLICY, null), p(s, a), p(s, d), { isBlitz: blitz, declaredBlock: !blitz });

// ---------------------------------------------------------------------------
// Block strength, assists and dice (p.60-62)
// ---------------------------------------------------------------------------

test('block dice: equal=1, stronger=2, more than double=3 (p.60)', () => {
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1' });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1' });
  b.ball(c(1, 1));
  let s = b.start();
  assert.equal(strength(s, 'A1', 'B1').dice, 1);
  p(s, 'A1').st = 4;
  assert.equal(strength(s, 'A1', 'B1').dice, 2);
  p(s, 'A1').st = 6;
  assert.equal(strength(s, 'A1', 'B1').dice, 2, '6 is not more than double 3');
  p(s, 'A1').st = 7;
  assert.equal(strength(s, 'A1', 'B1').dice, 3);
  p(s, 'A1').st = 2;
  const st = strength(s, 'A1', 'B1');
  assert.equal(st.dice, 2);
  assert.equal(st.chooser, 'defender');
  s = s;
});

test('assists: marking the target and not marked by others; Guard ignores that; Defensive cancels Guard (p.61, p.127, p.129)', () => {
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1' });
  b.add('A', 'human', 'lineman', c(11, 6), { id: 'A2' }); // marks B1
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1' });
  b.add('B', 'orc', 'lineman', c(12, 5), { id: 'B2' }); // marks A2 -> A2 cannot assist
  b.ball(c(1, 1));
  const s = b.start();
  assert.equal(strength(s, 'A1', 'B1').offAssists.length, 0);
  p(s, 'A2').skills.push({ id: 'guard' });
  assert.equal(strength(s, 'A1', 'B1').offAssists.length, 1, 'Guard assists although marked');
  p(s, 'B2').skills.push({ id: 'defensive' });
  assert.equal(strength(s, 'A1', 'B1').offAssists.length, 0, 'Defensive marker cancels Guard in its opponent\'s turn');
  // Defensive assist: B3 marks the attacker and is free
  const b2 = new Pos();
  b2.add('A', 'human', 'lineman', c(10, 7), { id: 'A1' });
  b2.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1' });
  b2.add('B', 'orc', 'lineman', c(9, 8), { id: 'B3' });
  b2.ball(c(1, 1));
  const s2 = b2.start();
  const st = strength(s2, 'A1', 'B1');
  assert.equal(st.defAssists.length, 1);
  assert.equal(st.dice, 2);
  assert.equal(st.chooser, 'defender');
});

test('Eye Gouge: a pushed player cannot assist until next activated (p.128)', () => {
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1', extraSkills: [{ id: 'eyeGouge' }] });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1' });
  b.ball(c(1, 1));
  const s = b.start();
  const r = runScripted(s, blk('A1', 'B1'), [3], (req) => (req.type === 'followUp' ? 'no' : req.options[0].id));
  assert.equal(p(r.state, 'B1').eyeGouged, true);
});

test('Dauntless: D6 + ST beating the target\'s ST raises Strength (p.127)', () => {
  const b = new Pos();
  b.add('A', 'bretonnian', 'grailKnight', c(10, 7), { id: 'A1' });
  b.add('B', 'orc', 'troll', c(11, 7), { id: 'B1' });
  b.ball(c(1, 1));
  const s = b.start();
  // Dauntless roll 3: 3+3=6 > 5 -> ST 5 vs 5 -> 1 die. Die: 6 (POW); push, no follow-up; armour 1+1
  const r = runScripted(s, blk('A1', 'B1'), [3, 6, 1, 1], (req) => (req.type === 'followUp' ? 'no' : req.options[0].id));
  assert.match(texts(r), /counts as ST 5/);
  assert.match(texts(r), /1 block die/);
  // Dauntless roll 2: 2+3=5 not > 5 -> 2 dice for the Troll
  const r2 = runScripted(s, blk('A1', 'B1'), [2, 3, 4], (req) => (req.type === 'blockDie' ? req.options[0].id : req.type === 'followUp' ? 'no' : req.options[0].id));
  assert.match(texts(r2), /defender chooses/);
});

// ---------------------------------------------------------------------------
// Block results and skills
// ---------------------------------------------------------------------------

test('Stumble: Dodge turns it into a Push; Tackle cancels Dodge (p.62, p.137)', () => {
  const mk = (tackle: boolean) => {
    const b = new Pos();
    b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1', extraSkills: tackle ? [{ id: 'tackle' }] : [] });
    // ST 3 vs ST 3 -> one block die, so the scripted die is the result.
    b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1', extraSkills: [{ id: 'dodge' }] });
    b.ball(c(1, 1));
    return b.start();
  };
  const noTackle = runScripted(mk(false), blk('A1', 'B1'), [5], (req) => (req.type === 'followUp' ? 'no' : req.options[0].id));
  assert.equal(p(noTackle.state, 'B1').stance, 'standing');
  const withTackle = runScripted(mk(true), blk('A1', 'B1'), [5, 1, 1], (req) => (req.type === 'followUp' ? 'no' : req.options[0].id));
  assert.equal(p(withTackle.state, 'B1').stance, 'prone');
});

test('Wrestle: Both Down places both players Prone with no Armour Roll and no Turnover (p.138)', () => {
  const b = new Pos();
  b.add('A', 'bretonnian', 'squire', c(10, 7), { id: 'A1' });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1' });
  b.ball(c(1, 1));
  const s = b.start();
  const r = runScripted(s, blk('A1', 'B1'), [2], (req) => (req.type === 'wrestle' ? 'yes' : req.options[0].id));
  assert.equal(r.status, 'completed');
  assert.equal(p(r.state, 'A1').stance, 'prone');
  assert.equal(p(r.state, 'B1').stance, 'prone');
  assert.ok(!/Armour Roll/.test(texts(r)));
  assert.equal(r.state.turn.active, 'A');
});

test('Stand Firm: not pushed; Frenzy still blocks again (p.136, p.128)', () => {
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1', extraSkills: [{ id: 'frenzy' }] });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1', extraSkills: [{ id: 'standFirm' }] });
  b.ball(c(1, 1));
  const s = b.start();
  // first block Push (3): Stand Firm -> stays; Frenzy second block: Push (4) again stand firm
  const r = runScripted(s, blk('A1', 'B1'), [3, 4], (req) => (req.type === 'standFirm' ? 'yes' : req.options[0].id));
  assert.equal(r.status, 'completed', texts(r));
  assert.match(texts(r), /blocks again \(Frenzy\)/);
  assert.deepEqual(p(r.state, 'B1').pos, c(11, 7));
});

test('Frenzy: must follow up and block again if the target is still Standing', () => {
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1', extraSkills: [{ id: 'frenzy' }] });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1' });
  b.ball(c(1, 1));
  const s = b.start();
  // Push (3) -> B1 to (12,7) (first push square), follow-up forced, second block POW (6) -> push to (13,7), armour 1+1
  const r = runScripted(s, blk('A1', 'B1'), [3, 6, 1, 1], (req) => req.options[0].id);
  assert.equal(r.status, 'completed', texts(r));
  assert.deepEqual(p(r.state, 'A1').pos, c(12, 7));
  assert.deepEqual(p(r.state, 'B1').pos, c(13, 7));
  assert.equal(p(r.state, 'B1').stance, 'prone');
});

test('Juggernaut on a Blitz: Both Down may be a Push and Stand Firm cannot be used (p.129)', () => {
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(9, 7), { id: 'A1', extraSkills: [{ id: 'juggernaut' }] });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1', extraSkills: [{ id: 'standFirm' }] });
  b.ball(c(1, 1));
  const s = b.start();
  const input: PlayerActionInput = { kind: 'playerAction', playerId: 'A1', action: 'blitz', blitzTarget: 'B1', blockTarget: 'B1', path: [{ to: c(10, 7), kind: 'step' }] };
  const r = runScripted(s, input, [2], (req) => (req.type === 'juggernaut' ? 'push' : req.type === 'followUp' ? 'no' : req.options[0].id));
  assert.equal(r.status, 'completed', texts(r));
  assert.deepEqual(p(r.state, 'B1').pos, c(12, 7));
  assert.ok(!r.events.some((e) => /Stand Firm/.test(e.text)));
});

test('Fend stops the follow-up; Taunt forces it (p.128, p.137)', () => {
  const mk = (skill: string) => {
    const b = new Pos();
    b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1' });
    b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1', extraSkills: [{ id: skill }] });
    b.ball(c(1, 1));
    return b.start();
  };
  const f = runScripted(mk('fend'), blk('A1', 'B1'), [3], (req) => (req.type === 'fend' ? 'yes' : req.options[0].id));
  assert.deepEqual(p(f.state, 'A1').pos, c(10, 7));
  const t = runScripted(mk('taunt'), blk('A1', 'B1'), [3], (req) => (req.type === 'taunt' ? 'yes' : req.type === 'followUp' ? 'no' : req.options[0].id));
  assert.deepEqual(p(t.state, 'A1').pos, c(11, 7));
});

test('Sidestep lets the defender choose; Grab lets the blocker choose and stops Sidestep (p.135, p.128)', () => {
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1' });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1', extraSkills: [{ id: 'sidestep' }] });
  b.ball(c(1, 1));
  const s = b.start();
  const r = runScripted(s, blk('A1', 'B1'), [3], (req) => {
    if (req.type === 'skill') return 'yes';
    if (req.type === 'sidestepSquare') return '10,6';
    if (req.type === 'followUp') return 'no';
    return req.options[0].id;
  });
  assert.deepEqual(p(r.state, 'B1').pos, c(10, 6), 'sidestepped next to the blocker');
  p(s, 'A1').skills.push({ id: 'grab' });
  const g = runScripted(s, blk('A1', 'B1'), [3], (req) => {
    if (req.type === 'skill') return req.context?.skill === 'grab' ? 'yes' : 'yes';
    if (req.type === 'grabSquare') return '11,8';
    if (req.type === 'followUp') return 'no';
    return req.options[0].id;
  });
  assert.deepEqual(p(g.state, 'B1').pos, c(11, 8));
  assert.ok(!g.events.some((e) => /Sidestep/.test(e.text)));
});

test('chain push: the pushed player displaces another; Stand Firm blocks that square (p.63)', () => {
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1' });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1' });
  b.add('B', 'orc', 'lineman', c(12, 6), { id: 'B2' });
  b.add('B', 'orc', 'lineman', c(12, 7), { id: 'B3' });
  b.add('B', 'orc', 'lineman', c(12, 8), { id: 'B4' });
  b.ball(c(1, 1));
  const s = b.start();
  const r = runScripted(s, blk('A1', 'B1'), [3], (req) => (req.type === 'pushSquare' ? req.options[0].id : req.type === 'followUp' ? 'no' : req.options[0].id));
  assert.deepEqual(p(r.state, 'B1').pos, c(12, 7));
  assert.deepEqual(p(r.state, 'B3').pos, c(13, 7));
});

test('Strip Ball: a pushed ball carrier drops the ball; Sure Hands prevents it (p.136)', () => {
  const mk = (sure: boolean) => {
    const b = new Pos();
    b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1', extraSkills: [{ id: 'stripBall' }] });
    const t = b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1', extraSkills: sure ? [{ id: 'sureHands' }] : [] });
    b.give(t);
    return b.start();
  };
  // Push (3); strip -> bounce d8 5 -> (13,7) rests
  const r = runScripted(mk(false), blk('A1', 'B1'), [3, 5], (req) => (req.type === 'stripBall' ? 'yes' : req.type === 'followUp' ? 'no' : req.options[0].id));
  assert.deepEqual(r.state.ball, { kind: 'ground', pos: c(13, 7) });
  const r2 = runScripted(mk(true), blk('A1', 'B1'), [3], (req) => (req.type === 'followUp' ? 'no' : req.options[0].id));
  assert.deepEqual(r2.state.ball, { kind: 'held', playerId: 'B1' });
});

test('Foul Appearance: a 1 cancels the Block and ends the activation without a Turnover (p.128)', () => {
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1' });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1', extraSkills: [{ id: 'foulAppearance' }] });
  b.ball(c(1, 1));
  const s = b.start();
  const r = runScripted(s, blk('A1', 'B1'), [1]);
  assert.equal(r.status, 'completed');
  assert.equal(r.state.turn.active, 'A');
  assert.equal(p(r.state, 'B1').stance, 'standing');
  assert.match(texts(r), /Block is cancelled/);
});

test('pushing an opposing ball carrier into your end zone... and a TD during the opponent\'s turn (p.80)', () => {
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(2, 7), { id: 'A1' });
  const t = b.add('B', 'orc', 'lineman', c(1, 7), { id: 'B1' });
  b.give(t);
  const s = b.start();
  // A1 at (2,7) pushes B1 from (1,7) to (0,7): B's scoring end zone is x=0 -> TD for B
  const r = runScripted(s, blk('A1', 'B1'), [3], (req) => (req.type === 'pushSquare' ? '0,7' : req.type === 'followUp' ? 'no' : req.options[0].id));
  assert.equal(r.status, 'touchdown', texts(r));
  assert.equal(r.state.teams.B.score, 1);
  assert.equal(r.state.phase, 'touchdown');
});

test('Mighty Blow is offered on the Armour Roll only when it breaks the armour, else on the Injury Roll (p.131)', () => {
  const b = new Pos();
  b.add('A', 'orc', 'bigUn', c(10, 7), { id: 'A1' });
  b.add('B', 'human', 'lineman', c(11, 7), { id: 'B1' });
  b.ball(c(1, 1));
  const s = b.start();
  // ST4 vs 3: 2 dice [6,6] POW; armour 4+4=8 vs AV9 -> MB breaks; injury 3+4=7 -> stunned (MB already used)
  const r = runScripted(s, blk('A1', 'B1'), [6, 6, 4, 4, 3, 4], (req) => (req.type === 'mightyBlow' ? (req.options.some((o) => o.id === 'armour') ? 'armour' : 'use') : req.type === 'followUp' ? 'no' : req.options[0].id));
  assert.match(texts(r), /Mighty Blow \+1 applied to the Armour Roll/);
  assert.equal(p(r.state, 'B1').stance, 'stunned');
  // armour breaks naturally (5+5): MB goes to injury 4+3=7 -> 8 = KO
  const r2 = runScripted(s, blk('A1', 'B1'), [6, 6, 5, 5, 4, 3], (req) => (req.type === 'mightyBlow' ? (req.options.some((o) => o.id === 'use') ? 'use' : 'save') : req.type === 'followUp' ? 'no' : req.options[0].id));
  assert.equal(p(r2.state, 'B1').location, 'ko', texts(r2));
});

test('Claws breaks armour on a natural 8+; Iron Hard Skin ignores Claws and armour modifiers (p.127, p.129)', () => {
  const mk = (ihs: boolean) => {
    const b = new Pos();
    b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1', extraSkills: [{ id: 'claws' }] });
    b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1', extraSkills: ihs ? [{ id: 'ironHardSkin' }] : [] });
    b.ball(c(1, 1));
    return b.start();
  };
  // POW (6), armour 4+4=8 vs AV10: Claws breaks; injury 1+1 stunned
  const r = runScripted(mk(false), blk('A1', 'B1'), [6, 4, 4, 1, 1], (req) => (req.type === 'followUp' ? 'no' : req.options[0].id));
  assert.equal(p(r.state, 'B1').stance, 'stunned');
  const r2 = runScripted(mk(true), blk('A1', 'B1'), [6, 4, 4], (req) => (req.type === 'followUp' ? 'no' : req.options[0].id));
  assert.equal(p(r2.state, 'B1').stance, 'prone');
});

test('Injury tables: Stunty, Thick Skull, Decay and Regeneration (p.66-67, p.135, p.137)', () => {
  const b = new Pos();
  b.add('A', 'orc', 'troll', c(10, 7), { id: 'A1', skills: [] });
  b.add('B', 'human', 'halfling', c(11, 7), { id: 'B1', av: 7 });
  b.ball(c(1, 1));
  const s = b.start();
  // ST5 vs 2 -> 3 dice. Dice 6,6,6 POW; armour 4+4; injury 4+3=7 -> Stunty KO
  const r = runScripted(s, blk('A1', 'B1'), [6, 6, 6, 4, 4, 4, 3], (req) => (req.type === 'followUp' ? 'no' : req.options[0].id));
  assert.equal(p(r.state, 'B1').location, 'ko', texts(r));
  // Stunty + Thick Skull: 7 -> Stunned
  const s2 = JSON.parse(JSON.stringify(s)) as GameState;
  p(s2, 'B1').skills.push({ id: 'thickSkull' });
  const r2 = runScripted(s2, blk('A1', 'B1'), [6, 6, 6, 4, 4, 4, 3], (req) => (req.type === 'followUp' ? 'no' : req.options[0].id));
  assert.equal(p(r2.state, 'B1').stance, 'stunned', texts(r2));
  // Regeneration on a casualty: injury 6+6 -> casualty; regeneration 4 -> reserves
  const s3 = JSON.parse(JSON.stringify(s)) as GameState;
  p(s3, 'B1').skills.push({ id: 'regeneration' });
  const r3 = runScripted(s3, blk('A1', 'B1'), [6, 6, 6, 4, 4, 6, 6, 4], (req) => (req.type === 'followUp' ? 'no' : req.options[0].id));
  assert.equal(p(r3.state, 'B1').location, 'reserves', texts(r3));
  // Decay: casualty roll +1 (D16 8 -> 9 Seriously Hurt)
  const s4 = JSON.parse(JSON.stringify(s)) as GameState;
  p(s4, 'B1').skills.push({ id: 'decay' });
  const r4 = runScripted(s4, blk('A1', 'B1'), [6, 6, 6, 4, 4, 6, 6, 8], (req) => (req.type === 'followUp' ? 'no' : req.options[0].id));
  assert.equal(p(r4.state, 'B1').casualtyResult, 'Seriously Hurt', texts(r4));
});

test('Steady Footing: a 6 avoids falling and there is no Turnover (p.136)', () => {
  const b = new Pos();
  b.add('A', 'bretonnian', 'grailKnight', c(10, 7), { id: 'A1' });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1' });
  b.ball(c(1, 1));
  const s = b.start();
  const r = runScripted(s, mv('A1', [[9, 7]]), [1, 6], ['none']);
  assert.equal(r.status, 'completed', texts(r));
  assert.equal(p(r.state, 'A1').stance, 'standing');
});

// ---------------------------------------------------------------------------
// Movement skills
// ---------------------------------------------------------------------------

test('Dodge skill re-roll once per Turn; Tackle cancels it (p.127, p.137)', () => {
  const mk = (tackle: boolean) => {
    const b = new Pos();
    b.add('A', 'human', 'catcher', c(10, 7), { id: 'A1' });
    b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1', extraSkills: tackle ? [{ id: 'tackle' }] : [] });
    b.ball(c(1, 1));
    return b.start();
  };
  const r = runScripted(mk(false), mv('A1', [[9, 7]]), [1, 3], ['skill']);
  assert.equal(r.status, 'completed');
  assert.equal(p(r.state, 'A1').usage.dodgeReroll, true);
  const plan = planAction(mk(true), mv('A1', [[9, 7]]));
  assert.ok(Math.abs(plan.withoutTeamRerolls!.pCompleted - 4 / 6) < 1e-12, 'Tackle removes the Dodge re-roll');
});

test('Stunty ignores Marking modifiers when dodging; Titchy +1 and does not mark dodge-into squares (p.136, p.138)', () => {
  const b = new Pos();
  b.add('A', 'orc', 'goblin', c(10, 7), { id: 'A1' });
  b.add('B', 'human', 'lineman', c(11, 7), { id: 'B1' });
  b.add('B', 'human', 'lineman', c(10, 9), { id: 'B2' });
  b.ball(c(1, 1));
  const s = b.start();
  const plan = planAction(s, mv('A1', [[10, 8]]));
  assert.equal(plan.steps[0].mods.length, 0, 'no marking modifier for Stunty');
  const b2 = new Pos();
  b2.add('A', 'human', 'lineman', c(10, 7), { id: 'A1', extraSkills: [{ id: 'titchy' }] });
  b2.add('B', 'human', 'lineman', c(11, 7), { id: 'B1', extraSkills: [{ id: 'titchy' }] });
  b2.add('B', 'human', 'lineman', c(10, 9), { id: 'B2' });
  b2.ball(c(1, 1));
  const plan2 = planAction(b2.start(), mv('A1', [[10, 8]]));
  const m = plan2.steps[0].mods;
  assert.deepEqual(m.map((x) => x.value).sort(), [-1, 1], 'only B2 counts (B1 is Titchy); +1 Titchy');
});

test('Break Tackle is offered after a failed Dodge when it would succeed (p.126)', () => {
  const b = new Pos();
  b.add('A', 'orc', 'blitzer', c(10, 7), { id: 'A1' });
  b.add('B', 'human', 'lineman', c(11, 7), { id: 'B1' });
  b.ball(c(1, 1));
  const s = b.start();
  const r = runScripted(s, mv('A1', [[9, 7]]), [2], ['use']);
  assert.equal(r.status, 'completed', texts(r));
  assert.equal(p(r.state, 'A1').usage.breakTackle, true);
});

test('Diving Tackle: -2 after the roll, the tackler is Placed Prone in the vacated square (p.127)', () => {
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1' });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1', extraSkills: [{ id: 'divingTackle' }] });
  b.ball(c(1, 1));
  const s = b.start();
  // dodge roll 4 (needs 3+): with -2 -> 2 fails. armour 1+1
  const r = runScripted(s, mv('A1', [[9, 7]]), [4, 1, 1], (req) => (req.type === 'divingTackle' ? 'B1' : req.options[0].id));
  assert.equal(r.status, 'turnover', texts(r));
  assert.deepEqual(p(r.state, 'B1').pos, c(10, 7));
  assert.equal(p(r.state, 'B1').stance, 'prone');
  const plan = planAction(s, mv('A1', [[9, 7]]));
  assert.ok(Math.abs(plan.withoutTeamRerolls!.pCompleted - 2 / 6) < 1e-12, 'only 5-6 survive Diving Tackle');
});

test('Tentacles holds the player in place: activation ends, no Turnover (p.137)', () => {
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1' });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1', extraSkills: [{ id: 'tentacles' }] });
  b.ball(c(1, 1));
  const s = b.start();
  const r = runScripted(s, mv('A1', [[9, 7]]), [6], (req) => (req.type === 'tentacles' ? 'B1' : req.options[0].id));
  assert.equal(r.status, 'completed');
  assert.deepEqual(p(r.state, 'A1').pos, c(10, 7));
  assert.equal(r.state.turn.activation, null, 'activation ended');
  assert.equal(r.state.turn.active, 'A');
});

test('Shadowing follows into the vacated square on a 4+ (p.135)', () => {
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1' });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1', extraSkills: [{ id: 'shadowing' }] });
  b.ball(c(1, 1));
  const s = b.start();
  const r = runScripted(s, mv('A1', [[9, 7]]), [3, 4], (req) => (req.type === 'shadowing' ? 'B1' : req.options[0].id));
  assert.deepEqual(p(r.state, 'B1').pos, c(10, 7));
});

test('Jumping over a Prone player uses the worse of the two marking counts; natural 1 falls in place (p.56)', () => {
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1' });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1', stance: 'prone' });
  b.add('B', 'orc', 'lineman', c(13, 8), { id: 'B2' });
  b.ball(c(1, 1));
  const s = b.start();
  const input: PlayerActionInput = { kind: 'playerAction', playerId: 'A1', action: 'move', path: [{ to: c(12, 7), kind: 'jump' }] };
  const plan = planAction(s, input);
  assert.ok(plan.ok, plan.errors.join());
  assert.equal(plan.steps[0].kind, 'jump');
  assert.equal(plan.steps[0].mods[0].value, -1);
  const r = runScripted(s, input, [1, 1, 1]);
  assert.deepEqual(p(r.state, 'A1').pos, c(10, 7), 'natural 1: falls in the square it was in');
  const r2 = runScripted(s, input, [3, 1, 1]);
  assert.deepEqual(p(r2.state, 'A1').pos, c(12, 7), 'failed: falls in the target square');
  assert.equal(p(r2.state, 'A1').stance, 'prone');
  assert.equal(p(runScripted(s, input, [4]).state, 'A1').stance, 'standing');
  assert.equal(runScripted(s, input, [4]).state.turn.activation?.maUsed, 2, 'a Jump costs 2 squares');
});

test('Leap over a Standing player with the modifier reduced by 1 (min -1) (p.130)', () => {
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1', extraSkills: [{ id: 'leap' }] });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1' });
  b.add('B', 'orc', 'lineman', c(10, 6), { id: 'B2' });
  b.ball(c(1, 1));
  const s = b.start();
  const input: PlayerActionInput = { kind: 'playerAction', playerId: 'A1', action: 'move', path: [{ to: c(12, 7), kind: 'leap' }] };
  const plan = planAction(s, input);
  assert.ok(plan.ok, plan.errors.join());
  assert.equal(plan.steps[0].mods[0].value, -1, 'two markers (-2) reduced to -1');
});

test('Standing up: 3 squares, or a 4+ roll with MA 2 (p.54); Jump Up stands for free (p.130)', () => {
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1', stance: 'prone' });
  b.add('A', 'orc', 'bigUn', c(5, 5), { id: 'A2', stance: 'prone', ma: 2 });
  b.add('B', 'orc', 'lineman', c(20, 7), { id: 'B1' });
  b.ball(c(1, 1));
  const s = b.start();
  const r = runScripted(s, mv('A1', [[11, 7], [12, 7], [13, 7]]), []);
  assert.equal(r.state.turn.activation?.maUsed, 6);
  const plan = planAction(s, mv('A1', [[11, 7], [12, 7], [13, 7], [14, 7], [15, 7], [16, 7]]));
  assert.equal(plan.ok, false, 'MA 6 - 3 to stand + 2 rushes = 5 squares at most');
  const r2 = runScripted(s, mv('A2', []), [3]);
  assert.equal(p(r2.state, 'A2').stance, 'prone');
  const r3 = runScripted(s, mv('A2', []), [4]);
  assert.equal(p(r3.state, 'A2').stance, 'standing');
  const s2 = JSON.parse(JSON.stringify(s)) as GameState;
  p(s2, 'A1').skills.push({ id: 'jumpUp' });
  const r4 = runScripted(s2, mv('A1', [[11, 7]]), []);
  assert.equal(r4.state.turn.activation?.maUsed, 1);
});

test('Sprint allows a third Rush; Sure Feet re-rolls a Rush once per Turn (p.136)', () => {
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(5, 7), { id: 'A1', ma: 1, extraSkills: [{ id: 'sprint' }, { id: 'sureFeet' }] });
  b.add('B', 'orc', 'lineman', c(20, 7), { id: 'B1' });
  b.ball(c(1, 1));
  const s = b.start();
  const r = runScripted(s, mv('A1', [[6, 7], [7, 7], [8, 7], [9, 7]]), [2, 1, 2, 2], ['skill']);
  assert.equal(r.status, 'completed', texts(r));
  assert.deepEqual(p(r.state, 'A1').pos, c(9, 7), 'MA 1 + three Rushes');
  assert.match(texts(r), /Sure Feet/);
  assert.equal(p(r.state, 'A1').activated, true, 'no movement left: the activation ends automatically');
  // A fourth Rush is not allowed even with Sprint.
  assert.equal(planAction(s, mv('A1', [[6, 7], [7, 7], [8, 7], [9, 7], [10, 7]])).ok, false);
  // Without Sprint only two Rushes.
  const s2 = JSON.parse(JSON.stringify(s)) as GameState;
  p(s2, 'A1').skills = p(s2, 'A1').skills.filter((k) => k.id !== 'sprint');
  assert.equal(planAction(s2, mv('A1', [[6, 7], [7, 7], [8, 7], [9, 7]])).ok, false);
  // Sure Feet is once per Turn: a second failure in the same Turn is not re-rolled by it.
  const r2 = runScripted(s, mv('A1', [[6, 7], [7, 7], [8, 7]]), [1, 3, 1, 1, 1], ['skill']);
  assert.equal(r2.status, 'turnover', texts(r2));
});

test('Blizzard: -1 to Rush; Pouring Rain: -1 to pick up; Big Hand ignores it (p.46, p.124)', () => {
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(5, 7), { id: 'A1', ma: 1 });
  b.add('B', 'orc', 'lineman', c(20, 7), { id: 'B1' });
  b.ball(c(1, 1));
  const s = b.start();
  s.weather = 'blizzard';
  const plan = planAction(s, mv('A1', [[6, 7], [7, 7]]));
  assert.ok(Math.abs(plan.withoutTeamRerolls!.pCompleted - 4 / 6) < 1e-12);
  const b2 = new Pos();
  b2.add('A', 'human', 'lineman', c(5, 7), { id: 'A1' });
  b2.add('B', 'orc', 'lineman', c(20, 7), { id: 'B1' });
  b2.ball(c(6, 7));
  const s2 = b2.start();
  s2.weather = 'pouringRain';
  assert.ok(Math.abs(planAction(s2, mv('A1', [[6, 7]])).withoutTeamRerolls!.pCompleted - 3 / 6) < 1e-12);
  p(s2, 'A1').skills.push({ id: 'bigHand' });
  assert.ok(Math.abs(planAction(s2, mv('A1', [[6, 7]])).withoutTeamRerolls!.pCompleted - 4 / 6) < 1e-12);
});

// ---------------------------------------------------------------------------
// Re-roll sources
// ---------------------------------------------------------------------------

test('Loner: a failed Loner check loses the Team Re-roll (p.131)', () => {
  const b = new Pos({ rerollsA: 1 });
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1', extraSkills: [{ id: 'loner', value: 4 }] });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1' });
  b.ball(c(1, 1));
  const s = b.start();
  const r = runScripted(s, mv('A1', [[9, 7]]), [1, 3, 1, 1], ['team']);
  assert.equal(r.status, 'turnover', texts(r));
  assert.equal(r.state.teams.A.rerolls, 0);
  assert.match(texts(r), /Team Re-roll is lost/);
});

test('Pro: on a 3+ the dice is re-rolled; once per activation (p.133)', () => {
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1', extraSkills: [{ id: 'pro' }] });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1' });
  b.ball(c(1, 1));
  const s = b.start();
  const r = runScripted(s, mv('A1', [[9, 7]]), [1, 3, 5], ['pro']);
  assert.equal(r.status, 'completed', texts(r));
  const r2 = runScripted(s, mv('A1', [[9, 7]]), [1, 2, 1, 1], ['pro']);
  assert.equal(r2.status, 'turnover');
});

test('Leader Re-roll only while a Leader is on the pitch (p.130)', () => {
  const b = new Pos({ rerollsA: 0 });
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1' });
  b.add('A', 'human', 'thrower', c(3, 3), { id: 'A2', extraSkills: [{ id: 'leader' }] });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1' });
  b.ball(c(1, 1));
  const s = b.start();
  s.teams.A.leaderReroll = true;
  const r = runScripted(s, mv('A1', [[9, 7]]), [1, 4], ['leader']);
  assert.equal(r.status, 'completed');
  assert.equal(r.state.teams.A.leaderReroll, false);
  const s2 = JSON.parse(JSON.stringify(s)) as GameState;
  p(s2, 'A2').location = 'ko';
  p(s2, 'A2').pos = null;
  const r2 = runScripted(s2, mv('A1', [[9, 7]]), [1, 1, 1]);
  assert.equal(r2.status, 'turnover', 'no re-roll offered without a Leader on the pitch');
});

test('a dice is never re-rolled twice (p.33)', () => {
  const b = new Pos({ rerollsA: 3 });
  b.add('A', 'human', 'catcher', c(10, 7), { id: 'A1' });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1' });
  b.ball(c(1, 1));
  const s = b.start();
  const r = runScripted(s, mv('A1', [[9, 7]]), [1, 1, 1, 1], ['skill']);
  assert.equal(r.status, 'turnover');
  assert.equal(r.state.teams.B.turn, 5);
  assert.equal(r.state.teams.A.rerolls, 3, 'no second re-roll offered');
});

// ---------------------------------------------------------------------------
// Activation traits
// ---------------------------------------------------------------------------

test('Bone Head on a 1: Distracted and the activation ends, no Turnover (p.126)', () => {
  const b = new Pos();
  b.add('A', 'human', 'ogre', c(10, 7), { id: 'A1', skills: [{ id: 'boneHead' }] });
  b.add('B', 'orc', 'lineman', c(20, 7), { id: 'B1' });
  b.ball(c(1, 1));
  const s = b.start();
  const r = runScripted(s, mv('A1', [[11, 7]]), [1]);
  assert.equal(r.status, 'completed');
  assert.equal(p(r.state, 'A1').distracted, true);
  assert.deepEqual(p(r.state, 'A1').pos, c(10, 7));
  assert.equal(r.state.turn.active, 'A');
});

test('Really Stupid: +2 with a helpful team-mate adjacent (p.135)', () => {
  const b = new Pos();
  b.add('A', 'orc', 'troll', c(10, 7), { id: 'A1', skills: [{ id: 'reallyStupid' }] });
  b.add('A', 'orc', 'lineman', c(11, 7), { id: 'A2' });
  b.add('B', 'orc', 'lineman', c(20, 7), { id: 'B1' });
  b.ball(c(1, 1));
  const s = b.start();
  const plan = planAction(s, mv('A1', [[9, 7]]));
  assert.equal(plan.steps[0].kind, 'reallyStupid');
  assert.ok(Math.abs((plan.steps[0].pSingle ?? NaN) - 5 / 6) < 1e-12);
});

test('Unchannelled Fury: +2 for a Block or Blitz; failure ends the activation (p.138)', () => {
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1', extraSkills: [{ id: 'unchannelledFury' }] });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1' });
  b.ball(c(1, 1));
  const s = b.start();
  const plan = planAction(s, blk('A1', 'B1'));
  assert.ok(Math.abs((plan.steps[0].pSingle ?? NaN) - 5 / 6) < 1e-12);
  const r = runScripted(s, blk('A1', 'B1'), [1]);
  assert.equal(p(r.state, 'B1').stance, 'standing');
  assert.equal(r.state.turn.activation, null);
});

// ---------------------------------------------------------------------------
// Passing skills
// ---------------------------------------------------------------------------

const passIn = (id: string, x: number, y: number, extra: Partial<PlayerActionInput> = {}): PlayerActionInput => ({ kind: 'playerAction', playerId: id, action: 'pass', path: [], passTarget: c(x, y), ...extra });

test('Safe Pass: a natural 1 keeps the ball, ends the activation, no Turnover (p.135)', () => {
  const b = new Pos();
  const t = b.add('A', 'human', 'thrower', c(10, 7), { id: 'A1', skills: [{ id: 'safePass' }] });
  b.add('A', 'human', 'catcher', c(13, 7), { id: 'A2' });
  b.add('B', 'orc', 'lineman', c(20, 1), { id: 'B1' });
  b.give(t);
  const s = b.start();
  const r = runScripted(s, passIn('A1', 13, 7), [1]);
  assert.equal(r.status, 'completed', texts(r));
  assert.deepEqual(r.state.ball, { kind: 'held', playerId: 'A1' });
  assert.equal(r.state.turn.activation, null);
});

test('Accurate/Cannoneer/Nerves of Steel/Very Sunny modify the Passing Ability Test (p.46, p.123, p.126, p.132)', () => {
  const b = new Pos();
  const t = b.add('A', 'human', 'thrower', c(10, 7), { id: 'A1', skills: [{ id: 'accurate' }, { id: 'nervesOfSteel' }] });
  b.add('A', 'human', 'catcher', c(13, 7), { id: 'A2' });
  b.add('B', 'orc', 'lineman', c(9, 7), { id: 'B1' });
  b.give(t);
  const s = b.start();
  s.weather = 'verySunny';
  const plan = planAction(s, passIn('A1', 13, 7));
  const mods = plan.pass!.mods.map((m) => `${m.label}:${m.value}`).sort();
  assert.deepEqual(mods, ['Accurate:1', 'Very Sunny:-1']);
});

test('Hail Mary Pass: any square, never Accurate, cannot be Intercepted (p.129)', () => {
  const b = new Pos();
  const t = b.add('A', 'human', 'thrower', c(2, 7), { id: 'A1', skills: [{ id: 'hailMaryPass' }] });
  b.add('B', 'orc', 'lineman', c(10, 7), { id: 'B1' });
  b.give(t);
  const s = b.start();
  const plan = planAction(s, passIn('A1', 24, 7, { hailMary: true }));
  assert.ok(plan.ok, plan.errors.join());
  assert.equal(plan.pass!.pAccurate, 0);
  assert.equal(plan.pass!.interceptorsIfAccurate.length, 0);
  assert.ok(!planAction(s, passIn('A1', 24, 7)).ok, 'out of range without Hail Mary');
});

test('Cloud Burster stops Interceptions unless the interceptor has Very Long Legs (p.127, p.138)', () => {
  const b = new Pos();
  const t = b.add('A', 'human', 'thrower', c(10, 7), { id: 'A1', extraSkills: [{ id: 'cloudBurster' }] });
  b.add('A', 'human', 'catcher', c(14, 7), { id: 'A2' });
  b.add('B', 'orc', 'lineman', c(12, 7), { id: 'B1' });
  b.give(t);
  const s = b.start();
  assert.equal(planAction(s, passIn('A1', 14, 7)).pass!.interceptorsIfAccurate.length, 0);
  p(s, 'B1').skills.push({ id: 'veryLongLegs' });
  assert.equal(planAction(s, passIn('A1', 14, 7)).pass!.interceptorsIfAccurate.length, 1);
});

test('Disturbing Presence: -1 per opposing player within 3 squares to pass and catch (p.127)', () => {
  const b = new Pos();
  const t = b.add('A', 'human', 'thrower', c(10, 7), { id: 'A1' });
  b.add('A', 'human', 'catcher', c(13, 7), { id: 'A2' });
  b.add('B', 'orc', 'lineman', c(10, 10), { id: 'B1', extraSkills: [{ id: 'disturbingPresence' }] });
  b.give(t);
  const s = b.start();
  const plan = planAction(s, passIn('A1', 13, 7));
  assert.ok(plan.pass!.mods.some((m) => /Disturbing Presence/.test(m.label)));
  const catchStep = plan.steps.find((st) => st.kind === 'catch');
  assert.ok(catchStep && catchStep.mods.some((m) => /Disturbing Presence/.test(m.label)), 'catcher within 3 squares too');
});

test('Blizzard allows only Quick and Short passes (p.46)', () => {
  const b = new Pos();
  const t = b.add('A', 'human', 'thrower', c(5, 7), { id: 'A1' });
  b.add('B', 'orc', 'lineman', c(20, 1), { id: 'B1' });
  b.give(t);
  const s = b.start();
  s.weather = 'blizzard';
  assert.ok(planAction(s, passIn('A1', 11, 7)).ok);
  assert.ok(!planAction(s, passIn('A1', 13, 7)).ok);
});

test('Animosity: a 1 refuses the hand-off and ends the activation (p.123)', () => {
  const b = new Pos();
  const t = b.add('A', 'orc', 'goblin', c(10, 7), { id: 'A1', extraSkills: [{ id: 'animosity', keyword: 'Orc' }] });
  b.add('A', 'orc', 'lineman', c(11, 7), { id: 'A2' });
  b.add('B', 'human', 'lineman', c(20, 1), { id: 'B1' });
  b.give(t);
  const s = b.start();
  const r = runScripted(s, { kind: 'playerAction', playerId: 'A1', action: 'handoff', path: [], handoffTarget: 'A2' }, [1]);
  assert.deepEqual(r.state.ball, { kind: 'held', playerId: 'A1' });
  assert.equal(r.state.turn.activation, null);
});

test('Safe Pair of Hands places the ball instead of bouncing (p.135)', () => {
  const b = new Pos();
  const a = b.add('A', 'human', 'catcher', c(10, 7), { id: 'A1', extraSkills: [{ id: 'safePairOfHands' }] });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1' });
  b.give(a);
  const s = b.start();
  const r = runScripted(s, mv('A1', [[9, 7]]), [1, 1, 1, 1], (req: Parameters<Chooser>[0]) => (req.type === 'reroll' ? 'none' : req.type === 'safePairOfHands' ? '8,7' : req.options[0].id));
  assert.deepEqual(r.state.ball, { kind: 'ground', pos: c(8, 7) }, texts(r));
});

// ---------------------------------------------------------------------------
// Turn structure
// ---------------------------------------------------------------------------

test('Stunned players who started the Turn Stunned roll over at its end (p.39); new stuns wait', () => {
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1', stance: 'stunned' });
  b.add('A', 'human', 'lineman', c(3, 3), { id: 'A2' });
  b.add('B', 'orc', 'lineman', c(20, 7), { id: 'B1', stance: 'stunned' });
  b.ball(c(1, 1));
  const s = b.start();
  const r = runScripted(s, { kind: 'endTurn' }, []);
  assert.equal(p(r.state, 'A1').stance, 'prone');
  assert.equal(p(r.state, 'B1').stance, 'stunned', "opponent's stunned players wait for their own turn");
  assert.equal(r.state.turn.active, 'B');
  const r2 = runScripted(r.state, { kind: 'endTurn' }, []);
  assert.equal(p(r2.state, 'B1').stance, 'prone');
});

test('Pick-me-up at the end of the opposition Turn (p.132)', () => {
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1' });
  b.add('B', 'orc', 'lineman', c(20, 7), { id: 'B1', extraSkills: [{ id: 'pickMeUp' }] });
  b.add('B', 'orc', 'lineman', c(21, 9), { id: 'B2', stance: 'prone' });
  b.ball(c(1, 1));
  const s = b.start();
  const r = runScripted(s, { kind: 'endTurn' }, [5]);
  assert.equal(p(r.state, 'B2').stance, 'standing');
});

test('per-turn limits: one Blitz, one Pass, one Hand-off and one Secure the Ball per Turn (p.51)', () => {
  const b = new Pos();
  b.add('A', 'human', 'blitzer', c(10, 7), { id: 'A1' });
  b.add('A', 'human', 'blitzer', c(10, 3), { id: 'A2' });
  b.add('B', 'orc', 'lineman', c(12, 7), { id: 'B1' });
  b.ball(c(1, 1));
  const s = b.start();
  const r = runScripted(s, { kind: 'playerAction', playerId: 'A1', action: 'blitz', blitzTarget: 'B1', path: [] }, []);
  const opts = actionOptions(r.state, p(r.state, 'A2'));
  assert.equal(opts.find((o) => o.action === 'blitz')?.enabled, false);
});

test('Secure the Ball is not allowed with a Standing opponent within 2 squares, for Big Guys or Unsteady (p.59, p.138)', () => {
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(5, 7), { id: 'A1' });
  b.add('A', 'human', 'ogre', c(5, 9), { id: 'A2' });
  b.add('B', 'orc', 'lineman', c(9, 7), { id: 'B1' });
  b.ball(c(7, 7));
  const s = b.start();
  assert.equal(actionOptions(s, p(s, 'A1')).find((o) => o.action === 'secure')?.enabled, false);
  p(s, 'B1').stance = 'prone';
  assert.equal(actionOptions(s, p(s, 'A1')).find((o) => o.action === 'secure')?.enabled, true);
  assert.equal(actionOptions(s, p(s, 'A2')).find((o) => o.action === 'secure')?.enabled, false);
});

test('V4: every Skill and Trait of the catalogue is implemented — nothing is disabled any more', () => {
  const notDone = SKILLS.filter((k) => k.support !== 'implemented' || gated(k.id)).map((k) => k.id);
  assert.deepEqual(notDone, []);
  assert.equal(SKILLS.length, 108);
  // Blocks against a Ball & Chain player (the last one that used to be disabled) are planned normally.
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1' });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1', extraSkills: [{ id: 'ballAndChain' }] });
  b.ball(c(1, 1));
  const s = b.start();
  assert.ok(planAction(s, blk('A1', 'B1')).ok);
  // Foul Actions (tests/foul.test.ts): here there is no Prone or Stunned opponent to foul.
  const foul = actionOptions(s, p(s, 'A1')).find((o) => o.action === 'foul');
  assert.equal(foul?.enabled, false);
  assert.match(foul?.reason ?? '', /Prone or Stunned/);
});
