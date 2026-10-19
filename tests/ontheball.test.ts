/**
 * V4: On the Ball (p.132) — when an opposition player performs a Pass Action,
 * after the target is declared and before the Passing Ability Test, players
 * with the Skill may each move up to 3 squares (no Rush), one at a time; a
 * player who Falls Over ends the moves. At the kick-off, after the Deviation
 * and before the Kick-off Event, one Open receiving player may move up to 3
 * squares in their own half (not when the kick causes a Touchback).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMatch, setVeteran, decide, defaultFormation, execute, newTeamDef, planAction, playerFromRoster, ROSTER_BY_ID, ScriptedDice, type ActionInput, type ExecutionResult, type GameState, type PlayerActionInput, type TeamDef, type TeamId } from '../src/engine/index';
import { c, p, Pos, runScripted, type Chooser } from './helpers';

const OTB = [{ id: 'onTheBall' }];
const pass = (id: string, to: [number, number]): PlayerActionInput => ({ kind: 'playerAction', playerId: id, action: 'pass', path: [], passTarget: c(to[0], to[1]) });
const texts = (r: { events: { text: string }[] }) => r.events.map((e) => e.text).join('\n');
let asked: Array<{ type: string; team: string; options: string[] }> = [];
const answerSeq =
  (answers: Array<[string, string]>, fallback: Record<string, string> = {}): Chooser =>
  (req) => {
    asked.push({ type: req.type, team: req.team, options: req.options.map((o) => o.id) });
    const i = answers.findIndex(([t]) => t === req.type);
    if (i >= 0) return answers.splice(i, 1)[0][1];
    return fallback[req.type] ?? req.options[0].id;
  };

/** Human Thrower T (5,7) with the ball, Human Catcher C (9,7); B1 (Orc Lineman, On the Ball) at (5,10). */
function base(extra?: (b: Pos) => void) {
  const b = new Pos({ rerollsA: 1 });
  const t = b.add('A', 'human', 'thrower', c(5, 7), { id: 'T' });
  b.add('A', 'human', 'catcher', c(9, 7), { id: 'C' });
  b.add('B', 'orc', 'lineman', c(5, 10), { id: 'B1', extraSkills: OTB });
  extra?.(b);
  b.give(t);
  return b;
}

test('On the Ball: after the target is declared, the opponent moves up to 3 squares — the pass is then Marked', () => {
  const s = base().start();
  asked = [];
  // B1 moves next to the thrower (5,8). Short Pass −1, Marked −1: PA 3+ needs a 5; 5 → accurate. Catch 3 (AG 3+).
  const r = runScripted(s, pass('T', [9, 7]), [5, 3], answerSeq([['onTheBall', 'B1'], ['onTheBall', '5,8']], { interceptor: 'none', onTheBall: 'none' }));
  assert.equal(r.status, 'completed', r.error);
  assert.equal(asked[0].type, 'onTheBall');
  assert.equal(asked[0].team, 'B', 'asked to the opposing coach');
  assert.deepEqual(p(r.state, 'B1').pos, c(5, 8));
  assert.match(texts(r), /uses On the Ball/);
  assert.match(texts(r), /Passing Ability Test \(Short Pass\): rolled 5[^\n]*Marked x1/);
  assert.equal(r.state.ball.kind === 'held' && r.state.ball.playerId, 'C');
  // The destinations are at most 3 squares away, never further (MA 5, no Rush).
  const dests = asked[1].options.filter((o) => o !== 'stay').map((o) => o.split(',').map(Number));
  assert.ok(dests.length > 0 && dests.every(([x, y]) => Math.max(Math.abs(x - 5), Math.abs(y - 10)) <= 3));
  // Without the move the same 4 is enough (Short −1 only).
  asked = [];
  const r2 = runScripted(s, pass('T', [9, 7]), [4, 3], answerSeq([], { onTheBall: 'none', interceptor: 'none' }));
  assert.equal(r2.state.ball.kind === 'held' && r2.state.ball.playerId, 'C');
});

test('On the Ball: a player who Falls Over ends the moves (no Turnover for anyone); the pass goes on', () => {
  const s = base((b) => {
    b.add('A', 'human', 'lineman', c(5, 11), { id: 'A2' }); // Marks B1: leaving needs a Dodge
    b.add('B', 'orc', 'lineman', c(12, 12), { id: 'B2', extraSkills: OTB });
  }).start();
  asked = [];
  // B1 Dodges out: 1 → Falls Over (armour 2+2); B2 is not asked. Pass 4 (Short −1) accurate, catch 3.
  const r = runScripted(s, pass('T', [9, 7]), [1, 2, 2, 4, 3], answerSeq([['onTheBall', 'B1'], ['onTheBall', '5,8']], { interceptor: 'none', onTheBall: 'none' }));
  assert.equal(r.status, 'completed', r.error);
  assert.equal(p(r.state, 'B1').stance, 'prone');
  assert.equal(asked.filter((a) => a.type === 'onTheBall').length, 2, 'no further On the Ball moves');
  assert.ok(!asked.some((a) => a.type === 'reroll' && a.team === 'B'), 'no Team Re-roll outside their Turn');
  assert.equal(r.state.turn.active, 'A');
  assert.equal(r.state.ball.kind === 'held' && r.state.ball.playerId, 'C');
  assert.match(texts(r), /On the Ball move ends/);
});

test('On the Ball: several players move one at a time', () => {
  const s = base((b) => b.add('B', 'orc', 'lineman', c(9, 10), { id: 'B2', extraSkills: OTB })).start();
  asked = [];
  // B1 → (6,9); B2 → (9,8) next to the catcher. Pass 4 accurate; catch: Marked −1 → 4.
  const r = runScripted(s, pass('T', [9, 7]), [4, 4], answerSeq([['onTheBall', 'B1'], ['onTheBall', '6,9'], ['onTheBall', 'B2'], ['onTheBall', '9,8']], { interceptor: 'none', onTheBall: 'none' }));
  assert.deepEqual(p(r.state, 'B1').pos, c(6, 9));
  assert.deepEqual(p(r.state, 'B2').pos, c(9, 8));
  assert.ok(!asked[2].options.includes('B1'), 'each player moves once');
  assert.equal(r.state.ball.kind === 'held' && r.state.ball.playerId, 'C');
});

test('On the Ball: passes against it are planned (no longer disabled); the preview assumes no move', () => {
  const s = base().start();
  const plan = planAction(s, pass('T', [9, 7]));
  assert.ok(plan.ok, plan.errors.join());
  assert.ok(plan.assumptions.some((a) => /On the Ball/.test(a)));
});

// --- kick-off ---------------------------------------------------------------

function team(id: string, rosterId: string, comp: Array<[string, number]>): TeamDef {
  const t = newTeamDef('tournament', rosterId, `${rosterId} ${id}`, id);
  let n = 1;
  for (const [pos, k] of comp) for (let i = 0; i < k; i++) t.players.push(playerFromRoster(ROSTER_BY_ID[rosterId], pos, n, `${id}-${n++}`));
  t.rerolls = 2;
  return t;
}
function run(s: GameState, input: ActionInput, choose: Chooser, faces: number[]): ExecutionResult {
  const dice = () => new ScriptedDice(faces);
  let res = execute(s, input, undefined, dice);
  let g = 0;
  while (res.status === 'awaitingDecision' && res.decision) {
    if (g++ > 60) throw new Error('too many decisions');
    res = decide(res.state, { requestId: res.decision.id, optionId: choose(res.decision, res.state) }, dice);
  }
  return res;
}
const first: Chooser = (req) => req.options[0].id;
function kickoffState(): { s: GameState; kicker: string; mover: string } {
  const m = createMatch('tournament', team('hum', 'human', [['lineman', 7], ['blitzer', 2], ['catcher', 2], ['thrower', 1]]), team('orc', 'orc', [['lineman', 7], ['blitzer', 2], ['bigUn', 2]]), { rules: 'introductory' }, 7);
  assert.ok(m.ok);
  let s = m.state as GameState;
  s = run(s, { kind: 'pregame' }, first, [5, 2]).state; // A receives
  const k = s.match!.kicking as TeamId;
  s = run(s, { kind: 'setupTeam', team: k, positions: defaultFormation(s, k) }, first, []).state;
  s = run(s, { kind: 'setupTeam', team: 'A', positions: defaultFormation(s, 'A') }, first, []).state;
  const mover = s.players.find((q) => q.team === 'A' && q.location === 'pitch' && q.pos && q.pos.x <= 10 && q.pos.x >= 6)!;
  const busy = s.players.filter((q) => q.pos && ((q.pos.x === 6 && q.pos.y === 12) || (q.pos.x === 4 && q.pos.y === 12) || (q.pos.x === 5 && q.pos.y === 12)));
  assert.ok(!busy.length, JSON.stringify(s.players.filter((q) => q.pos).map((q) => [q.team, q.pos!.x, q.pos!.y])));
  mover.pos = c(6, 12);
  mover.skills = [...mover.skills, ...OTB];
  const kicker = s.players.find((q) => q.team === k && q.location === 'pitch' && q.pos && (q.pos.x < 12 || q.pos.x > 13) && (q.pos.y < 4 || q.pos.y > 10 || q.pos.x > 14))!;
  return { s, kicker: kicker.id, mover: mover.id };
}

test('On the Ball at the kick-off: after the Deviation, one Open receiving player moves up to 3 squares in their half (and can get under the ball)', () => {
  const { s, kicker, mover } = kickoffState();
  asked = [];
  // Target (2,12), D8 5 (right) D6 2 → the ball will land in (4,12). The mover goes (6,12) → (4,12); the kick comes down on him: catch 3.
  const r = run(s, { kind: 'kickoff', kicker, target: c(2, 12) }, answerSeq([['onTheBall', mover], ['onTheBall', '4,12']]), [5, 2, 3]);
  assert.equal(r.status, 'completed', r.error);
  assert.equal(asked[0].type, 'onTheBall');
  assert.equal(asked[0].team, 'A');
  const dests = asked[1].options.filter((o) => o !== 'stay').map((o) => o.split(',').map(Number));
  assert.ok(dests.every(([x]) => x <= 12), 'own half only');
  assert.deepEqual(p(r.state, mover).pos, c(4, 12));
  assert.equal(r.state.ball.kind === 'held' && r.state.ball.playerId, mover);
});

test('On the Ball at the kick-off: not offered when the kick causes a Touchback', () => {
  const { s, kicker } = kickoffState();
  asked = [];
  // Target (2,12), D8 4 (left) D6 3 → off the pitch: Touchback.
  const r = run(s, { kind: 'kickoff', kicker, target: c(2, 12) }, answerSeq([]), [4, 3]);
  assert.equal(r.status, 'completed', r.error);
  assert.ok(!asked.some((a) => a.type === 'onTheBall'));
  assert.ok(asked.some((a) => a.type === 'touchback'));
});

// --- V5.5: Blood Bowl Sevens — On the Ball may enter No Man's Land ------------------------------------------

function sevensTeam7(id: string, rosterId: string, comp: Array<[string, number]>): TeamDef {
  const t = newTeamDef('tournament', rosterId, `${rosterId} ${id}`, id, 'sevens');
  let n = 1;
  for (const [pos, k] of comp) for (let i = 0; i < k; i++) t.players.push(playerFromRoster(ROSTER_BY_ID[rosterId], pos, n, `${id}-${n++}`));
  t.rerolls = 1;
  const vet = t.players.find((q) => q.keywords.includes('Lineman'));
  if (vet) setVeteran(t, vet.id);
  return t;
}
function sevensKickoff(): { s: GameState; kicker: string; mover: string } {
  const m = createMatch('tournament', sevensTeam7('h7', 'human', [['blitzer', 2], ['catcher', 1], ['lineman', 5]]), sevensTeam7('o7', 'orc', [['blitzer', 2], ['bigUn', 1], ['lineman', 4]]), { rules: 'introductory' }, 7);
  assert.ok(m.ok, JSON.stringify(m));
  let s = m.state as GameState;
  s = run(s, { kind: 'pregame' }, (req) => (req.options.some((o) => o.id === 'receive') ? 'receive' : req.options[0].id), [5, 2, 3, 3, 6, 1]).state;
  const k = s.match!.kicking as TeamId;
  const recv: TeamId = k === 'A' ? 'B' : 'A';
  s = run(s, { kind: 'setupTeam', team: k, positions: defaultFormation(s, k) }, first, []).state;
  s = run(s, { kind: 'setupTeam', team: recv, positions: defaultFormation(s, recv) }, first, []).state;
  // A receiving player on the Line of Scrimmage (the Sevens LoS columns are 6 and 13) gets On the Ball.
  const losX = recv === 'A' ? 6 : 13;
  const mover = s.players.find((q) => q.team === recv && q.location === 'pitch' && q.pos?.x === losX)!;
  mover.skills = [...mover.skills, ...OTB];
  const kicker = s.players.find((q) => q.team === k && q.location === 'pitch' && q.pos && q.pos.x !== (k === 'A' ? 6 : 13) && q.pos.y >= 2 && q.pos.y <= 8)!;
  return { s, kicker: kicker.id, mover: mover.id };
}

test("V5.5 Sevens: On the Ball at the kick-off may move into No Man's Land (Designer's Commentary: Yes), never past the halfway line", () => {
  const { s, kicker, mover } = sevensKickoff();
  const recv = s.match!.kicking === 'A' ? 'B' : 'A';
  const m0 = p(s, mover).pos!;
  // Kick into the receiving area far from the mover; D8 1 (up-left) and the lower of 2D6 = 1: the ball lands one square away.
  const tgt = recv === 'A' ? c(2, 5) : c(17, 5);
  asked = [];
  const nml = recv === 'A' ? c(m0.x + 3, m0.y) : c(m0.x - 3, m0.y);
  const r = run(s, { kind: 'kickoff', kicker, target: tgt }, answerSeq([['onTheBall', mover], ['onTheBall', `${nml.x},${nml.y}`]]), [1, 1, 6, 1, 1, 1, 1, 1, 1, 1, 1]);
  assert.notEqual(r.status, 'illegal', r.error);
  const q = asked.findIndex((a) => a.type === 'onTheBall');
  assert.ok(q >= 0, 'On the Ball offered');
  const dests = asked[q + 1].options.filter((o) => o !== 'stay').map((o) => o.split(',').map(Number));
  const inNml = dests.filter(([x]) => x > 6 && x < 13);
  assert.ok(inNml.length > 0, "destinations in No Man's Land are offered");
  assert.ok(dests.every(([x]) => (recv === 'A' ? x <= 9 : x >= 10)), 'never past the halfway line');
  assert.deepEqual(p(r.state, mover).pos, nml, "the player ends the move in No Man's Land");
  assert.match(r.events.map((e) => e.text).join('\n'), /uses On the Ball/);
});

test("V5.5 Sevens, optional NAF recommendation (match option sevensOnTheBall 'ownArea'): On the Ball may not enter No Man's Land", () => {
  const { s, kicker, mover } = sevensKickoff();
  s.match!.options = { ...s.match!.options, sevensOnTheBall: 'ownArea' };
  const recv = s.match!.kicking === 'A' ? 'B' : 'A';
  const m0 = p(s, mover).pos!;
  const tgt = recv === 'A' ? c(2, 5) : c(17, 5);
  asked = [];
  const back = recv === 'A' ? c(m0.x - 2, m0.y) : c(m0.x + 2, m0.y);
  const r = run(s, { kind: 'kickoff', kicker, target: tgt }, answerSeq([['onTheBall', mover], ['onTheBall', `${back.x},${back.y}`]]), [1, 1, 6, 1, 1, 1, 1, 1, 1, 1, 1]);
  assert.notEqual(r.status, 'illegal', r.error);
  const q = asked.findIndex((a) => a.type === 'onTheBall');
  assert.ok(q >= 0, 'On the Ball offered');
  const dests = asked[q + 1].options.filter((o) => o !== 'stay').map((o) => o.split(',').map(Number));
  assert.ok(dests.length > 0);
  assert.ok(dests.every(([x]) => (recv === 'A' ? x <= 6 : x >= 13)), "no destination in No Man's Land");
});
