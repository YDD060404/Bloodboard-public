/**
 * V4: Foul Action (p.69) with Argue the Call / Bribes and the fouling skills
 * (Dirty Player p.127, Sneaky Git p.136, Lone Fouler p.130, Put the Boot In
 * p.134, Quick Foul p.134), and the Leader Re-roll timing (p.130).
 *
 * Dice are scripted: armour 2D6 first, then the Injury 2D6, then any
 * Argue the Call / Bribe D6.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { foulAssists } from '../src/engine/foul';
import {
  actionOptions,
  createMatch,
  decide,
  defaultFormation,
  execute,
  kickerCandidates,
  newTeamDef,
  planAction,
  playerFromRoster,
  ROSTER_BY_ID,
  ScriptedDice,
  type ActionInput,
  type ExecutionResult,
  type GameState,
  type PlayerActionInput,
  type TeamDef,
  type TeamId,
} from '../src/engine/index';
import { c, p, Pos, runScripted, type Chooser } from './helpers';

const foul = (id: string, target: string, path: Array<[number, number]> = [], extra: Partial<PlayerActionInput> = {}): PlayerActionInput => ({
  kind: 'playerAction',
  playerId: id,
  action: 'foul',
  path: path.map(([x, y]) => ({ to: c(x, y), kind: 'step' as const })),
  foulTarget: target,
  ...extra,
});
const texts = (r: { events: { text: string }[] }) => r.events.map((e) => e.text).join('\n');
const answer =
  (map: Record<string, string>): Chooser =>
  (req) =>
    map[req.type] ?? req.options[0].id;

/** A1 (Human Lineman) next to the Prone Orc Lineman B1 (AV 10). */
function base(opts: { a?: Record<string, unknown>; bStance?: 'prone' | 'stunned' } = {}) {
  const b = new Pos({ rerollsA: 1 });
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1', ...(opts.a ?? {}) });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1', stance: opts.bStance ?? 'prone' });
  b.ball(c(1, 1));
  return b;
}

test('Foul availability: needs a Prone or Stunned opponent on the pitch, once per Turn (p.69)', () => {
  const b0 = new Pos();
  b0.add('A', 'human', 'lineman', c(10, 7), { id: 'A1' });
  b0.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1' });
  b0.ball(c(1, 1));
  const s0 = b0.start();
  const o0 = actionOptions(s0, p(s0, 'A1')).find((o) => o.action === 'foul')!;
  assert.equal(o0.enabled, false);
  assert.match(o0.reason ?? '', /Prone or Stunned/);
  const b = base();
  b.add('A', 'human', 'lineman', c(5, 5), { id: 'A2' });
  const s = b.start();
  assert.equal(actionOptions(s, p(s, 'A1')).find((o) => o.action === 'foul')!.enabled, true);
  const r = runScripted(s, foul('A1', 'B1'), [4, 3]);
  assert.equal(r.status, 'completed');
  const o2 = actionOptions(r.state, p(r.state, 'A2')).find((o) => o.action === 'foul')!;
  assert.equal(o2.enabled, false);
  assert.match(o2.reason ?? '', /already been declared/);
});

/** FAQ May 2026: the fouler's coach now chooses the number of Offensive Assists before the Armour Roll; these older tests apply all of them. */
const allAssists = (req: { options: { id: string }[] }) => req.options[0].id;

test('Foul: move first, then an Armour Roll with offensive and defensive assists; armour holds → nothing, no Turnover', () => {
  const b = base();
  b.add('A', 'human', 'lineman', c(12, 8), { id: 'A2' }); // Marks B1, free → +1
  b.add('B', 'orc', 'lineman', c(9, 7), { id: 'B2' }); // Marks A1, free → −1
  const s = b.start();
  const as = foulAssists(s, p(s, 'A1'), p(s, 'B1'));
  assert.deepEqual([as.off.map((x) => x.id), as.def.map((x) => x.id)], [['A2'], ['B2']]);
  const r = runScripted(s, foul('A1', 'B1'), [5, 4], allAssists);
  assert.equal(r.status, 'completed');
  assert.match(texts(r), /5\+4=9 \+0 assists.*→ 9 vs AV 10\+ — armour holds/);
  assert.equal(p(r.state, 'B1').stance, 'prone');
  assert.equal(r.state.turn.activation, null, 'the activation ends after the Foul');
  // A move first: the fouler walks next to a prone opponent.
  const b2 = new Pos({ rerollsA: 0 });
  b2.add('A', 'human', 'lineman', c(6, 7), { id: 'A1' });
  b2.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1', stance: 'stunned' });
  b2.ball(c(1, 1));
  const r2 = runScripted(b2.start(), foul('A1', 'B1', [[7, 7], [8, 7], [9, 7], [10, 7]]), [6, 5, 2, 3]);
  assert.equal(r2.status, 'completed');
  assert.deepEqual(p(r2.state, 'A1').pos, c(10, 7));
  assert.match(texts(r2), /armour broken/);
  assert.equal(p(r2.state, 'B1').stance, 'stunned');
});

test('Foul: a natural double on the Armour Roll → Sent-off after the Foul, Turnover; Argue the Call 6 keeps the player but the Turnover stands', () => {
  const s = base().start();
  const r = runScripted(s, foul('A1', 'B1'), [5, 5, 2, 3], answer({ argueTheCall: 'no' }));
  assert.equal(r.status, 'turnover');
  assert.equal(p(r.state, 'A1').location, 'sentOff');
  assert.match(texts(r), /natural double/);
  assert.equal(p(r.state, 'B1').stance, 'stunned', 'the Foul is resolved first (armour 10 broken, Injury 5 Stunned)');
  // Argue the Call: 6 → not Sent-off, still a Turnover (p.69).
  const r2 = runScripted(s, foul('A1', 'B1'), [5, 5, 2, 3, 6], answer({ argueTheCall: 'yes' }));
  assert.equal(r2.status, 'turnover');
  assert.equal(p(r2.state, 'A1').location, 'pitch');
  // Argue the Call: 1 → the coach is ejected and cannot argue again.
  const r3 = runScripted(s, foul('A1', 'B1'), [5, 5, 2, 3, 1], answer({ argueTheCall: 'yes' }));
  assert.equal(p(r3.state, 'A1').location, 'sentOff');
  assert.equal(r3.state.teams.A.coachEjected, true);
});

test('Foul: a natural double on the Injury Roll also sends the fouler off', () => {
  const s = base().start();
  const r = runScripted(s, foul('A1', 'B1'), [6, 5, 3, 3], answer({ argueTheCall: 'no' }));
  assert.equal(r.status, 'turnover');
  assert.equal(p(r.state, 'A1').location, 'sentOff');
  assert.equal(p(r.state, 'B1').stance, 'stunned', 'Injury 6: Stunned');
});

test('Sneaky Git (p.136): no Sent-off for a double on the Armour Roll unless the armour breaks', () => {
  const sg = base({ a: { extraSkills: [{ id: 'sneakyGit' }] } }).start();
  const r = runScripted(sg, foul('A1', 'B1'), [4, 4]);
  assert.equal(r.status, 'completed');
  assert.equal(p(r.state, 'A1').location, 'pitch');
  assert.match(texts(r), /Sneaky Git/);
  const r2 = runScripted(sg, foul('A1', 'B1'), [5, 5, 2, 3], answer({ argueTheCall: 'no' }));
  assert.equal(p(r2.state, 'A1').location, 'sentOff', 'armour broken: still Sent-off');
});

test('Dirty Player (p.127): +1 to the Armour Roll to break the armour, or kept for the Injury Roll', () => {
  const s = base({ a: { extraSkills: [{ id: 'dirtyPlayer' }] } }).start();
  const r = runScripted(s, foul('A1', 'B1'), [5, 4, 2, 3], answer({ dirtyPlayer: 'armour' }));
  assert.match(texts(r), /Dirty Player \+1 applied to the Armour Roll → 10 — armour broken/);
  assert.equal(p(r.state, 'B1').stance, 'stunned');
  // Kept for the Injury Roll: 7 (Stunned) + 1 = 8 → Knocked-out.
  const r2 = runScripted(s, foul('A1', 'B1'), [6, 5, 3, 4], answer({ mightyBlow: 'use', dirtyPlayer: 'use' }));
  assert.equal(p(r2.state, 'B1').location, 'ko');
  assert.match(texts(r2), /Dirty Player \+1 applied to the Injury Roll/);
});

test('Lone Fouler (p.130): re-roll a failed Armour Roll when nobody assists; not with an assist', () => {
  const s = base({ a: { extraSkills: [{ id: 'loneFouler' }] } }).start();
  const r = runScripted(s, foul('A1', 'B1'), [2, 3, 6, 5, 1, 2], answer({ reroll: 'skill' }));
  assert.match(texts(r), /Lone Fouler re-roll: 6\+5=11/);
  const b = base({ a: { extraSkills: [{ id: 'loneFouler' }] } });
  b.add('A', 'human', 'lineman', c(12, 8), { id: 'A2' });
  const r2 = runScripted(b.start(), foul('A1', 'B1'), [2, 3], allAssists);
  assert.equal(r2.status, 'completed');
  assert.ok(!/Lone Fouler/.test(texts(r2)));
});

test('Put the Boot In (p.134): a Marked team-mate still assists the Foul; Defensive (p.127) cancels it in the opponent\'s Turn; Guard does not help a Foul', () => {
  const mk = (skills: string[], defensive: boolean) => {
    const b = base();
    b.add('A', 'human', 'lineman', c(12, 8), { id: 'A2', extraSkills: skills.map((id) => ({ id })) });
    b.add('B', 'orc', 'lineman', c(13, 9), { id: 'B3', extraSkills: defensive ? [{ id: 'defensive' }] : [] }); // Marks A2
    const s = b.start();
    return foulAssists(s, p(s, 'A1'), p(s, 'B1')).off.map((x) => x.id);
  };
  assert.deepEqual(mk([], false), []);
  assert.deepEqual(mk(['guard'], false), [], 'Guard is for Block Actions only (p.129)');
  assert.deepEqual(mk(['putTheBootIn'], false), ['A2']);
  assert.deepEqual(mk(['putTheBootIn'], true), []);
});

test('Quick Foul (p.134): the fouler may keep moving after the Foul; without it the activation ends', () => {
  const s = base({ a: { extraSkills: [{ id: 'quickFoul' }] } }).start();
  const r = runScripted(s, foul('A1', 'B1'), [4, 3]);
  assert.equal(r.status, 'completed');
  assert.equal(r.state.turn.activation?.playerId, 'A1');
  const r2 = runScripted(r.state, { kind: 'playerAction', playerId: 'A1', action: 'foul', path: [{ to: c(9, 6), kind: 'step' }] }, []);
  assert.equal(r2.status, 'completed');
  assert.deepEqual(p(r2.state, 'A1').pos, c(9, 6));
  const plain = runScripted(base().start(), foul('A1', 'B1'), [4, 3]);
  const r3 = execute(plain.state, { kind: 'playerAction', playerId: 'A1', action: 'foul', path: [{ to: c(9, 6), kind: 'step' }] });
  assert.equal(r3.status, 'illegal');
});

test('Foul preview: the chance of being Sent-off is shown as the Turnover chance (armour double 1/6, or broken without a double then an Injury double)', () => {
  const s = base().start();
  const plan = planAction(s, foul('A1', 'B1'));
  assert.ok(plan.ok, plan.errors.join(' '));
  // AV 10: doubles 6/36; broken without a double (4+6, 6+4, 5+6, 6+5) 4/36, then an Injury double 1/6.
  const expected = 6 / 36 + (4 / 36) * (1 / 6);
  assert.ok(Math.abs((plan.withoutTeamRerolls?.pTurnover ?? 0) - expected) < 1e-9, `${plan.withoutTeamRerolls?.pTurnover} vs ${expected}`);
});

test('a Foul target must be Prone or Stunned and adjacent after the move', () => {
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1' });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1' });
  b.add('B', 'orc', 'lineman', c(14, 7), { id: 'B2', stance: 'prone' });
  b.ball(c(1, 1));
  const s = b.start();
  assert.equal(execute(s, foul('A1', 'B1')).status, 'illegal', 'Standing target');
  assert.equal(execute(s, foul('A1', 'B2')).status, 'illegal', 'not adjacent');
});

// ---------------------------------------------------------------------------
// Match play: Bribes, Leader Re-roll
// ---------------------------------------------------------------------------

function team(id: string, rosterId: string, comp: Array<[string, number]>, leaderAt?: number): TeamDef {
  const t = newTeamDef('league', rosterId, `${rosterId} ${id}`, id);
  let n = 1;
  for (const [pos, k] of comp) for (let i = 0; i < k; i++) t.players.push(playerFromRoster(ROSTER_BY_ID[rosterId], pos, n, `${id}-${n++}`));
  if (leaderAt !== undefined) t.players[leaderAt].skills.push({ id: 'leader' });
  t.rerolls = 2;
  return t;
}
type Answer = (req: NonNullable<ExecutionResult['decision']>, s: GameState) => string;
function run(s: GameState, input: ActionInput, ans: Answer = (r) => r.options[0].id, faces?: number[]): ExecutionResult {
  const dice = faces ? () => new ScriptedDice(faces) : undefined;
  let res = execute(s, input, undefined, dice);
  let guard = 0;
  while (res.status === 'awaitingDecision' && res.decision) {
    if (guard++ > 60) throw new Error('too many decisions');
    res = decide(res.state, { requestId: res.decision.id, optionId: ans(res.decision, res.state) }, dice);
  }
  assert.notEqual(res.status, 'illegal', res.error);
  return res;
}
/** Pre-game (introductory: A wins the roll-off and receives), set-ups with `positions` overrides, kick-off. */
function kickedOff(a: TeamDef, b: TeamDef, benchA: string[] = []): GameState {
  let s = createMatch('league', a, b, { rules: 'introductory' }, 11).state as GameState;
  s = run(s, { kind: 'pregame' }, undefined, [5, 2]).state;
  s = run(s, { kind: 'setupTeam', team: 'B', positions: defaultFormation(s, 'B') }).state;
  const pos = defaultFormation(s, 'A');
  for (const defId of benchA) {
    const id = s.players.find((q) => q.defId === defId)!.id;
    const spare = s.players.find((q) => q.team === 'A' && !pos[q.id] && q.id !== id);
    if (pos[id] && spare) pos[spare.id] = pos[id];
    pos[id] = null;
  }
  s = run(s, { kind: 'setupTeam', team: 'A', positions: pos }).state;
  const kicker = kickerCandidates(s, 'B')[0];
  return run(s, { kind: 'kickoff', kicker: kicker.id, target: c(6, 7) }).state;
}

test('Leader (p.130): the Leader Re-roll is gained at the start of a half only if a Leader is on the pitch then', () => {
  const lead = team('hum', 'human', [['lineman', 7], ['thrower', 1], ['blitzer', 2], ['catcher', 1]], 7);
  const orcs = team('orc', 'orc', [['lineman', 11]]);
  const created = createMatch('league', lead, orcs, { rules: 'introductory' }, 11).state as GameState;
  assert.equal(created.teams.A.leaderReroll, false, 'nothing before the half starts');
  const s = kickedOff(lead, orcs);
  const leader = s.players.find((q) => q.team === 'A' && q.skills.some((k) => k.id === 'leader'))!;
  assert.equal(leader.location, 'pitch');
  assert.equal(s.teams.A.leaderReroll, true);
  assert.equal(s.teams.B.leaderReroll, false);
  // Leader kept in the Reserves Box at the start of the half: no Leader Re-roll this half.
  const s2 = kickedOff(team('hum', 'human', [['lineman', 8], ['thrower', 1], ['blitzer', 2], ['catcher', 1]], 8), orcs, ['hum-9']);
  assert.equal(s2.teams.A.leaderReroll, false);
});

test('Leader: the unused Leader Re-roll is lost when every Leader is a Casualty; a Knocked-out Leader only suspends it', () => {
  const lead = team('hum', 'human', [['lineman', 7], ['thrower', 1], ['blitzer', 2], ['catcher', 1]], 7);
  const s = kickedOff(lead, team('orc', 'orc', [['lineman', 11]]));
  const leader = s.players.find((q) => q.team === 'A' && q.skills.some((k) => k.id === 'leader'))!;
  // Knocked-out: still in the game, the re-roll is not usable but not lost.
  const ko = JSON.parse(JSON.stringify(s)) as GameState;
  const kl = ko.players.find((q) => q.id === leader.id)!;
  kl.location = 'ko';
  kl.pos = null;
  assert.equal(ko.teams.A.leaderReroll, true);
  // A Casualty (knocked down by a Block in the opponent's Turn): the re-roll is lost.
  const b = new Pos({ active: 'B', rerollsA: 1, rerollsB: 1 });
  const L = b.add('A', 'human', 'thrower', c(10, 7), { id: 'L1', extraSkills: [{ id: 'leader' }] });
  b.add('B', 'orc', 'blitzer', c(11, 7), { id: 'B1' });
  b.ball(c(1, 1));
  const st = b.start();
  st.teams.A.leaderReroll = true;
  const r = runScripted(st, { kind: 'playerAction', playerId: 'B1', action: 'block', path: [], blockTarget: 'L1' }, [6, 6, 6, 6, 5, 1], (req) => (req.type === 'followUp' ? 'no' : req.type === 'apothecary' ? 'keep' : req.type === 'reroll' ? 'none' : req.options[0].id));
  assert.equal(p(r.state, L.id).location, 'cas', texts(r));
  assert.equal(r.state.teams.A.leaderReroll, false);
  assert.match(texts(r), /lose their unused Leader Re-roll/);
});

test('Leader Re-roll: usable while a Leader is on the pitch, spent once', () => {
  const b = new Pos({ rerollsA: 0 });
  b.add('A', 'human', 'thrower', c(10, 7), { id: 'L1', extraSkills: [{ id: 'leader' }] });
  b.add('A', 'human', 'lineman', c(5, 7), { id: 'A2' });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1' });
  b.ball(c(1, 1));
  const s = b.start();
  s.teams.A.leaderReroll = true;
  // A2 Rushes: fails on a 1, Leader Re-roll → 2 succeeds.
  const path = [[6, 7], [7, 7], [8, 7], [9, 6], [9, 5], [9, 4], [9, 3], [9, 2]].map(([x, y]) => ({ to: c(x, y), kind: 'step' as const }));
  const seen: string[] = [];
  const r = runScripted(s, { kind: 'playerAction', playerId: 'A2', action: 'move', path }, [1, 2, 3], (req) => {
    seen.push(req.options.map((o) => o.id).join(','));
    return req.options.some((o) => o.id === 'leader') ? 'leader' : req.options[0].id;
  });
  assert.equal(r.status, 'completed', texts(r));
  assert.equal(r.state.teams.A.leaderReroll, false);
  assert.ok(seen.some((x) => x.includes('leader')));
  // No Leader on the pitch: not offered.
  const s2 = b.start();
  s2.teams.A.leaderReroll = true;
  const l = s2.players.find((q) => q.id === 'L1')!;
  l.location = 'reserves';
  l.pos = null;
  const r2 = runScripted(s2, { kind: 'playerAction', playerId: 'A2', action: 'move', path }, [1, 2, 2], (req) => {
    assert.ok(!req.options.some((o) => o.id === 'leader'));
    return req.options[req.options.length - 1].id;
  });
  assert.equal(r2.status, 'turnover');
});

test('Bribe (p.144) in a match: 2+ keeps a Sent-off fouler on the pitch and there is no Turnover', () => {
  const s = kickedOff(team('hum', 'human', [['lineman', 11]]), team('orc', 'orc', [['lineman', 11]]));
  assert.equal(s.turn.active, 'A');
  // Put an A player next to a Prone B player.
  const a = s.players.find((q) => q.team === 'A' && q.location === 'pitch')!;
  const bP = s.players.find((q) => q.team === 'B' && q.location === 'pitch')!;
  for (const q of s.players) if (q.location === 'pitch' && q.id !== a.id && q.id !== bP.id) {
    q.location = 'reserves';
    q.pos = null;
  }
  a.pos = c(12, 7);
  bP.pos = c(13, 7);
  bP.stance = 'prone';
  s.ball = { kind: 'ground', pos: c(3, 3) };
  s.match!.bribes.A = 1;
  const r = runScripted(s, foul(a.id, bP.id), [5, 5, 1, 2, 4], answer({ argueTheCall: 'no', bribe: 'yes' }));
  assert.equal(r.status, 'completed', texts(r));
  assert.equal(p(r.state, a.id).location, 'pitch');
  assert.equal(r.state.match!.bribes.A, 0);
  void ({} as TeamId);
});
