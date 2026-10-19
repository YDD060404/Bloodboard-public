/**
 * V4: Diving Catch (p.127) — a Standing player with the Skill may try to Catch
 * a pass, throw-in or kick-off landing in an empty square in their Tackle Zone
 * (not a bouncing ball), and gets +1 to Catch a pass in the target square.
 * Interpretation (docs/RULES_COVERAGE.md): the diving player catches from their
 * own square; the active team's coach (the receiving team's at a kick-off)
 * chooses first; a failed attempt bounces the ball from the landing square.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMatch, decide, defaultFormation, execute, newTeamDef, planAction, playerFromRoster, ROSTER_BY_ID, ScriptedDice, type ActionInput, type ExecutionResult, type GameState, type PlayerActionInput, type TeamDef, type TeamId } from '../src/engine/index';
import { c, p, Pos, runScripted, type Chooser } from './helpers';

const DC = [{ id: 'divingCatch' }];
const pass = (id: string, to: [number, number]): PlayerActionInput => ({ kind: 'playerAction', playerId: id, action: 'pass', path: [], passTarget: c(to[0], to[1]) });
const texts = (r: { events: { text: string }[] }) => r.events.map((e) => e.text).join('\n');
const asked: string[] = [];
const answer =
  (map: Record<string, string>): Chooser =>
  (req) => {
    asked.push(req.type);
    return map[req.type] ?? req.options[0].id;
  };

/** Human Thrower T (5,7) with the ball; a Human Lineman L at (9,7) — with Diving Catch unless `dc` is false. */
function base(opts: { dc?: boolean; lAt?: [number, number]; opp?: [number, number]; oppDc?: boolean } = {}) {
  const b = new Pos({ rerollsA: 0 });
  const t = b.add('A', 'human', 'thrower', c(5, 7), { id: 'T' });
  const at = opts.lAt ?? [9, 7];
  b.add('A', 'human', 'lineman', c(at[0], at[1]), { id: 'L', extraSkills: opts.dc === false ? [] : DC });
  b.add('B', 'orc', 'lineman', c(opts.opp?.[0] ?? 20, opts.opp?.[1] ?? 2), { id: 'B1', extraSkills: opts.oppDc ? DC : [] });
  b.give(t);
  return b;
}

test('Diving Catch: a pass landing in an empty square next to the player — they may Catch it from their own square', () => {
  const s = base().start();
  asked.length = 0;
  // Passing Test 6 (accurate) to the empty square (8,7); Diving Catch with L: catch 3 (AG 3+, no modifier).
  const r = runScripted(s, pass('T', [8, 7]), [6, 3], answer({ divingCatch: 'L' }));
  assert.ok(asked.includes('divingCatch'));
  assert.equal(r.state.ball.kind === 'held' && r.state.ball.playerId, 'L');
  assert.deepEqual(p(r.state, 'L').pos, c(9, 7), 'not moved');
  assert.equal(r.state.turn.active, 'A', 'no Turnover');
  assert.match(texts(r), /dives for the ball/);
  // Declined: the ball lands and bounces (D8 5 → (9,7): L catches the bouncing ball with −1 → 4).
  const r2 = runScripted(s, pass('T', [8, 7]), [6, 5, 4], answer({ divingCatch: 'none' }));
  assert.match(texts(r2), /lands in the empty square/);
});

test('Diving Catch: a failed dive bounces the ball from the landing square; a bouncing ball can never be dived for', () => {
  const b = base();
  b.add('A', 'human', 'lineman', c(7, 9), { id: 'L2', extraSkills: DC });
  const s = b.start();
  asked.length = 0;
  // Pass 6 to (8,7); L dives: 1 fails; bounce D8 7 (down) → (8,8), next to L2 (Diving Catch) — no dive for a bounce: it comes to rest.
  const r = runScripted(s, pass('T', [8, 7]), [6, 1, 7], answer({ divingCatch: 'L' }));
  assert.equal(asked.filter((t) => t === 'divingCatch').length, 1);
  assert.deepEqual(r.state.ball, { kind: 'ground', pos: c(8, 8) });
  assert.notEqual(r.state.turn.active, 'A', 'the pass was not caught: Turnover');
});

test('Diving Catch: +1 to Catch a pass in the target square', () => {
  const s = base({ lAt: [9, 7] }).start();
  // Accurate pass to L in (9,7): catch 2 + 1 = 3 → success.
  const r = runScripted(s, pass('T', [9, 7]), [6, 2]);
  assert.equal(r.state.ball.kind === 'held' && r.state.ball.playerId, 'L');
  assert.match(texts(r), /Diving Catch \(target square\)|\+1 Diving Catch/);
  const s2 = base({ lAt: [9, 7], dc: false }).start();
  const r2 = runScripted(s2, pass('T', [9, 7]), [6, 2, 3], answer({}));
  assert.notEqual(r2.state.ball.kind === 'held' && r2.state.ball.playerId, 'L', 'without the Skill a 2 fails');
});

test('Diving Catch: an opposition player may dive for a pass landing next to them (the passing team loses the ball)', () => {
  const s = base({ dc: false, lAt: [12, 12], opp: [9, 8], oppDc: true }).start();
  asked.length = 0;
  // Pass 6 to the empty (8,7), next to B1 (9,8); no Diving Catch for A, B1 dives: 4 vs AG 3+ → caught.
  const r = runScripted(s, pass('T', [8, 7]), [6, 4], answer({ divingCatch: 'B1', interceptor: 'none' }));
  assert.ok(asked.includes('divingCatch'));
  assert.equal(r.state.ball.kind === 'held' && r.state.ball.playerId, 'B1');
  assert.notEqual(r.state.turn.active, 'A', 'Turnover');
});

test('Diving Catch: previews assume the dive — a pass to an empty square next to a diving catcher is much safer', () => {
  const withDc = planAction(base().start(), pass('T', [8, 7]));
  const without = planAction(base({ dc: false }).start(), pass('T', [8, 7]));
  assert.ok(withDc.ok && without.ok);
  assert.ok(withDc.withoutTeamRerolls!.pTurnover + 0.3 < without.withoutTeamRerolls!.pTurnover, `${withDc.withoutTeamRerolls!.pTurnover} vs ${without.withoutTeamRerolls!.pTurnover}`);
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

test('Diving Catch at the kick-off: a receiving player next to the empty landing square may Catch the kick', () => {
  const m = createMatch('tournament', team('hum', 'human', [['lineman', 7], ['blitzer', 2], ['catcher', 2], ['thrower', 1]]), team('orc', 'orc', [['lineman', 7], ['blitzer', 2], ['bigUn', 2]]), { rules: 'introductory' }, 7);
  assert.ok(m.ok);
  let s = m.state as GameState;
  s = run(s, { kind: 'pregame' }, first, [5, 2]).state; // A receives
  const k = s.match!.kicking as TeamId;
  s = run(s, { kind: 'setupTeam', team: k, positions: defaultFormation(s, k) }, first, []).state;
  s = run(s, { kind: 'setupTeam', team: 'A', positions: defaultFormation(s, 'A') }, first, []).state;
  assert.equal(s.phase, 'kickoff');
  // Put an A player with Diving Catch at (4,8), next to the landing square (4,7), which must be empty.
  const diver = s.players.find((q) => q.team === 'A' && q.location === 'pitch' && q.pos && q.pos.x >= 6)!;
  diver.pos = c(4, 8);
  diver.skills = [...diver.skills, ...DC];
  assert.ok(!s.players.some((q) => q.pos && q.pos.x === 4 && q.pos.y === 7));
  const kicker = s.players.find((q) => q.team === k && q.location === 'pitch' && q.pos && (q.pos.x < 12 || q.pos.x > 13) && !(q.pos.y >= 4 && q.pos.y <= 10 && (q.pos.x === 13 || q.pos.x === 12)))!;
  // Target (2,7); D8 5 (right) D6 2 → lands (4,7); Diving Catch: catch 3 vs AG 3+.
  asked.length = 0;
  const r = run(s, { kind: 'kickoff', kicker: kicker.id, target: c(2, 7) }, answer({ divingCatch: diver.id }), [5, 2, 3]);
  assert.equal(r.status, 'completed', r.error);
  assert.ok(asked.includes('divingCatch'));
  assert.equal(r.state.ball.kind === 'held' && r.state.ball.playerId, diver.id);
  assert.equal(r.state.phase, 'play');
});
