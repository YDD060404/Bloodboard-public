/**
 * V5 step 6, item 2: the computer coach uses Star Player rules used at the start of an activation when the rules
 * allow them and they pay (exact outcome evaluation, minus the value of keeping a once-per-game rule for later) —
 * and not when they do not. Each test checks the computer's decision and the match state after executing it.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Engine from '../src/engine/index';
import { STAR_BY_ID, validateInput, validateState, type ActionInput, type GameState, type Player, type PlayerActionInput, type TeamId } from '../src/engine/index';
import { answerDecision, bindEngine, decideAction } from '../src/ai/index';
import { c, p, Pos, runScripted } from './helpers';

bindEngine(Engine);

function star(P: Pos, t: TeamId, id: string, at: { x: number; y: number }, pid: string): Player {
  const st = STAR_BY_ID[id];
  const pl = P.add(t, t === 'A' ? 'human' : 'orc', 'lineman', at, { id: pid, ma: st.ma, st: st.st, ag: st.ag, pa: st.pa, av: st.av, skills: st.skills.map((k) => ({ ...k })) });
  pl.star = id;
  pl.position = st.name;
  pl.keywords = st.keywords.slice();
  return pl;
}

function think(s: GameState) {
  const d = decideAction(s, s.turn.active, { style: 'balanced' });
  assert.deepEqual(validateInput(s, d.input), [], `legal: ${d.chosen?.label ?? d.input.kind}`);
  return d;
}

/** Their ball carrier 2 squares from Thorsson; nothing else to do for the computer (Team A). */
function thorssonPosition(): GameState {
  const P = new Pos({ rerollsA: 1 });
  star(P, 'A', 'thorsson', c(10, 7), 'TH');
  P.add('A', 'human', 'lineman', c(3, 2), { id: 'A2' });
  const car = P.add('B', 'orc', 'blitzer', c(12, 7), { id: 'BC' });
  P.add('B', 'orc', 'lineman', c(16, 3), { id: 'B2' });
  P.give(car);
  return P.start();
}

test("Thorsson Stoutmead: the computer uses Beer Barrel Bash on the opposing ball carrier, and the match resolves it", () => {
  const s = thorssonPosition();
  const d = think(s);
  const inp = d.input as PlayerActionInput;
  assert.equal(inp.kind, 'playerAction');
  assert.equal(inp.playerId, 'TH');
  assert.ok(inp.starRule, `chose ${d.chosen?.label}`);
  assert.equal(inp.starTarget, 'BC', 'on their ball carrier');
  assert.match(d.chosen?.label ?? '', /Beer Barrel Bash on/);
  // Execute it: D6 4 → Knocked Down (then the Armour Roll 2+2 holds, the ball bounces D8 1).
  const r = runScripted(s, d.input, [4, 2, 2, 1]);
  assert.equal(r.status, 'completed', r.error);
  const st = r.state;
  assert.equal(p(st, 'BC').stance, 'prone', 'the carrier is Knocked Down');
  assert.notEqual(st.ball.kind === 'held' ? st.ball.playerId : '', 'BC', 'he lost the ball');
  assert.equal(p(st, 'TH').starUsed?.length, 1, 'the rule is spent (once per Drive)');
  assert.equal(st.turn.activation, null, 'his activation ended');
  assert.equal(st.turn.active, 'A', 'no Turnover: the Turn goes on');
  assert.deepEqual(validateState(st), []);
  // Once it is spent the computer no longer considers it.
  const again = think(st);
  assert.ok(!(again.input as PlayerActionInput).starRule);
});

test('Thorsson with the ball in a safe cage: Beer Barrel Bash is not used (a 1 would drop the ball — not worth it)', () => {
  const P = new Pos({ rerollsA: 1 });
  const th = star(P, 'A', 'thorsson', c(10, 7), 'TH');
  for (const [x, y, id] of [[9, 6, 'A2'], [11, 6, 'A3'], [9, 8, 'A4'], [11, 8, 'A5']] as const) P.add('A', 'human', 'lineman', c(x, y), { id });
  P.add('B', 'orc', 'lineman', c(13, 7), { id: 'B1' });
  P.give(th);
  const s = P.start();
  const d = think(s);
  const inp = d.input as PlayerActionInput;
  assert.ok(!(inp.kind === 'playerAction' && inp.starRule), `must not use the rule: ${d.chosen?.label}`);
  // It was considered, and rejected on value.
  const cand = d.candidates.find((x) => x.input.kind === 'playerAction' && x.input.starRule);
  assert.ok(cand, 'the rule was evaluated');
  assert.ok((cand!.gain ?? -Infinity) < (d.chosen?.gain ?? 0) || d.input.kind === 'endTurn');
});

test("Zzharg Madeye: Blastin' Solves Everything on the ball carrier; D6 2 lets the other coach (computer) choose — a Chaos Dwarf is hit", () => {
  const P = new Pos({ rerollsA: 1, a: 'chaosDwarf' });
  star(P, 'A', 'zzharg', c(10, 7), 'ZZ');
  P.add('A', 'chaosDwarf', 'hobgoblin', c(12, 5), { id: 'HB' });
  const car = P.add('B', 'orc', 'blitzer', c(13, 7), { id: 'BC', av: 9 });
  P.add('B', 'orc', 'lineman', c(20, 3), { id: 'B2' });
  P.give(car);
  const s = P.start();
  // The team's Blitz has been used this Turn: the blast is the only way to reach their carrier.
  s.turn.used.blitz = true;
  const d = think(s);
  const inp = d.input as PlayerActionInput;
  assert.ok(inp.starRule && inp.playerId === 'ZZ', `chose ${d.chosen?.label}`);
  assert.equal(inp.starTarget, 'BC');
  // D6 3: the carrier is hit — Armour 5+5 = 10 ≥ 9 broken, Injury 4+4 = 8 Knocked-out: the ball bounces (D8 1).
  const r = runScripted(s, d.input, [3, 5, 5, 4, 4, 1, 1, 1]);
  assert.equal(r.status, 'completed', r.error);
  assert.notEqual(p(r.state, 'BC').location, 'pitch', 'the ball carrier is off the pitch');
  assert.equal(p(r.state, 'ZZ').starUsed?.length, 1);
  assert.equal(r.state.turn.activation, null);
  // D6 2: the other coach chooses who is hit (any player within 3 squares of the target): the computer picks one of
  // Zzharg's team — the Hobgoblin, the lowest Armour.
  const q = runScripted(s, d.input, [2, 2, 2], (req, st) => {
    if (req.type === 'starRule' && req.team === 'B') return answerDecision(st, req, 'B', 'balanced').optionId;
    return req.options[0].id;
  });
  assert.equal(q.status, 'completed', q.error);
  const hitLine = q.events.find((e) => /Blastin' Solves Everything: D6 2/.test(e.text))?.text ?? '';
  assert.match(hitLine, /Hobgoblin.* is hit/, q.events.map((e) => e.text).join('\n'));
});

test('Swiftvine, Boa, Rodney and the helping rules: the computer only proposes legal uses (every candidate validates)', () => {
  const P = new Pos({ rerollsA: 1, a: 'woodElf', b: 'lizardmen' });
  star(P, 'A', 'swiftvine', c(10, 7), 'SV');
  star(P, 'A', 'gretchen', c(8, 3), 'GR');
  P.add('B', 'lizardmen', 'saurus', c(8, 4), { id: 'S1' });
  const car = P.add('B', 'lizardmen', 'skink', c(12, 8), { id: 'SK' });
  P.add('B', 'lizardmen', 'saurus', c(18, 7), { id: 'S2' });
  P.give(car);
  const s = P.start();
  const d = think(s);
  const starCands = d.candidates.filter((x) => x.input.kind === 'playerAction' && x.input.starRule);
  assert.ok(starCands.length >= 2, `star candidates: ${starCands.map((x) => x.label).join(' | ')}`);
  for (const x of starCands) assert.deepEqual(validateInput(s, x.input as ActionInput), [], x.label);
  if ((d.input as PlayerActionInput).starRule) {
    const r = runScripted(s, d.input, Array(40).fill(4), (req, st) => answerDecision(st, req, req.team, 'balanced').optionId);
    assert.notEqual(r.status, 'illegal', r.error);
    assert.deepEqual(validateState(r.state), []);
  }
});
