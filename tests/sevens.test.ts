/**
 * Blood Bowl Sevens (Spike! Journal: Sevens, Issue 22, 2026 — docs/SEVENS_RULES.md).
 * Printed Spike! 22 pages in brackets as "S.p.N"; rulebook pages as "p.N".
 *
 * Sevens pitch (S.p.7): 20 × 11. Team A's area x 0-6 (Line of Scrimmage x = 6), No Man's Land x 7-12,
 * Team B's area x 13-19 (Line of Scrimmage x = 13). Wide Zones rows y 0-1 and 9-10.
 * D8 directions: 1 up-left 2 up 3 up-right 4 left 5 right 6 down-left 7 down 8 down-right.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Engine from '../src/engine/index';
import {
  board,
  createMatch,
  decide,
  defaultFormation,
  execute,
  inNoMansLand,
  inOwnHalf,
  kickerCandidates,
  newTeamDef,
  planAction,
  playerFromRoster,
  ROSTER_BY_ID,
  rulesFor,
  ScriptedDice,
  setVeteran,
  teamCost,
  usePitch,
  validateDriveSetup,
  validateInput,
  validateState,
  validateTeamDef,
  type ActionInput,
  type ExecutionResult,
  type GameState,
  type PlayerActionInput,
  type TeamDef,
  type TeamId,
} from '../src/engine/index';
import { veteranWouldGoDown } from '../src/engine/block';
import { bindEngine, nextMove, waitingFor, type AIStyle } from '../src/ai/index';
import { c, p, Pos, runScripted, type Chooser } from './helpers';

bindEngine(Engine);

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

function sevensTeam(id: string, rosterId: string, comp: Array<[string, number]>, rerolls: number, extra: Partial<TeamDef> = {}): TeamDef {
  const t = newTeamDef('tournament', rosterId, `${rosterId} sevens ${id}`, id, 'sevens');
  let n = 1;
  for (const [pos, k] of comp) for (let i = 0; i < k; i++) t.players.push(playerFromRoster(ROSTER_BY_ID[rosterId], pos, n, `${id}-${n++}`));
  t.rerolls = rerolls;
  Object.assign(t, extra);
  const vet = t.players.find((q) => q.keywords.includes('Lineman'));
  if (vet) setVeteran(t, vet.id);
  return t;
}
/** 2 Blitzers, 1 Catcher, 5 Linemen, 1 Team Re-roll: 495,000 + 100,000 = 595,000 gp. */
const hum7 = () => sevensTeam('h7', 'human', [['blitzer', 2], ['catcher', 1], ['lineman', 5]], 1);
/** 2 Blitzers, 1 Big Un, 4 Linemen, 1 Team Re-roll: 465,000 + 100,000 = 565,000 gp. */
const orc7 = () => sevensTeam('o7', 'orc', [['blitzer', 2], ['bigUn', 1], ['lineman', 4]], 1);
const errs = (t: TeamDef) => validateTeamDef(t).filter((i) => i.level === 'error').map((i) => i.text);

test('Sevens draft (S.p.8-9, 13): the example teams are legal; costs use the Sevens prices', () => {
  assert.deepEqual(errs(hum7()), []);
  assert.deepEqual(errs(orc7()), []);
  const h = hum7();
  assert.deepEqual(teamCost(h), { players: 495_000, rerolls: 100_000, staff: 0, fans: 0, inducements: 0, total: 595_000 });
  // Staff: Apothecary 80,000; Assistant Coaches / Cheerleaders 20,000 each; Dedicated Fans 20,000 per step above 1.
  const s = { ...hum7(), rerolls: 0, apothecary: true, assistantCoaches: 1, cheerleaders: 1, dedicatedFans: 2 };
  assert.deepEqual(teamCost(s), { players: 495_000, rerolls: 0, staff: 120_000, fans: 20_000, inducements: 0, total: 635_000 });
  assert.ok(errs(s).some((e) => /600,000 gp Sevens Team Draft Budget/.test(e)));
});

test('Sevens draft: 7-11 players, at most 4 without the Lineman keyword, QTY limits, staff limits, fans 1-5', () => {
  assert.ok(errs(sevensTeam('x', 'human', [['lineman', 6]], 0)).some((e) => /at least 7/.test(e)));
  assert.ok(errs(sevensTeam('x', 'human', [['lineman', 12]], 0)).some((e) => /more than 11/.test(e)));
  // 2 Blitzers + 2 Catchers + 1 Thrower = 5 non-Linemen.
  assert.ok(errs(sevensTeam('x', 'human', [['blitzer', 2], ['catcher', 2], ['thrower', 1], ['lineman', 2]], 0)).some((e) => /no more than 4/.test(e)));
  // Halfling Hopefuls have the Lineman keyword: 4 non-Linemen + 3 Halflings is fine (QTY 0-3).
  assert.deepEqual(errs(sevensTeam('x', 'human', [['blitzer', 2], ['catcher', 1], ['thrower', 1], ['halfling', 3]], 0)), []);
  assert.ok(errs(sevensTeam('x', 'human', [['blitzer', 3], ['lineman', 5]], 0)).some((e) => /roster allows 0-2/.test(e)));
  assert.ok(errs({ ...hum7(), rerolls: 0, cheerleaders: 4 }).some((e) => /Cheerleaders: 0-3/.test(e)));
  assert.ok(errs({ ...hum7(), rerolls: 0, assistantCoaches: 4 }).some((e) => /Assistant Coaches: 0-3/.test(e)));
  assert.ok(errs({ ...sevensTeam('x', 'human', [['lineman', 7]], 0), dedicatedFans: 6 }).some((e) => /Dedicated Fans: 1-5/.test(e)));
  assert.deepEqual(errs({ ...sevensTeam('x', 'human', [['lineman', 7]], 0), dedicatedFans: 5 }), []);
});

test('Sevens Veteran (S.p.13): exactly one, a Lineman, MA −1 (setVeteran keeps the profile right)', () => {
  const t = hum7();
  const vet = t.players.find((q) => q.veteran)!;
  assert.equal(vet.position, 'Human Lineman');
  assert.equal(vet.ma, 5, 'Human Lineman MA 6 − 1');
  // Moving the Veteran restores the old one's MA.
  const other = t.players.find((q) => q.positionId === 'lineman' && !q.veteran)!;
  setVeteran(t, other.id);
  assert.equal(vet.ma, 6);
  assert.equal(other.ma, 5);
  assert.deepEqual(errs(t), []);
  setVeteran(t, null);
  assert.ok(errs(t).some((e) => /exactly one Lineman as the team's Veteran/.test(e)));
  const blitzer = t.players.find((q) => q.positionId === 'blitzer')!;
  setVeteran(t, blitzer.id);
  assert.ok(errs(t).some((e) => /must be a Lineman/.test(e)));
  // A hand-edited MA is caught by the profile check.
  const t2 = hum7();
  t2.players.find((q) => q.veteran)!.ma = 6;
  assert.ok(errs(t2).some((e) => /MA −1/.test(e)));
});

test('createMatch: Sevens only against Sevens; a Sevens League team is not supported', () => {
  const std = newTeamDef('tournament', 'orc', 'Standard Orcs', 'std');
  for (const [pos, k] of [['lineman', 7], ['blitzer', 2], ['bigUn', 2]] as Array<[string, number]>) for (let i = 0; i < k; i++) std.players.push(playerFromRoster(ROSTER_BY_ID.orc, pos, std.players.length + 1, `std-${std.players.length + 1}`));
  const mixed = createMatch('tournament', hum7(), std, { rules: 'full' }, 1);
  assert.equal(mixed.ok, false);
  assert.ok(mixed.errors.some((e) => /Sevens team can only play another Sevens team/.test(e)), mixed.errors.join('\n'));
  const league = { ...orc7(), kind: 'league' as const };
  assert.ok(errs(league).some((e) => /Sevens League play/.test(e)));
  const r = createMatch('tournament', hum7(), orc7(), { rules: 'full' }, 1);
  assert.ok(r.ok, r.errors.join('\n'));
  assert.equal(r.state!.variant, 'sevens');
  assert.equal(r.state!.players.filter((q) => q.veteran === 'ready').length, 2, 'one Veteran per team');
  assert.deepEqual(validateState(r.state), []);
});

// ---------------------------------------------------------------------------
// Pitch
// ---------------------------------------------------------------------------

test('Sevens pitch (S.p.7): 20 × 11, Wide Zones 2 squares, End Zones x 0 / 19, No Man\'s Land x 7-12; standard pitch unchanged', () => {
  usePitch('sevens');
  assert.equal(board.inBounds(c(19, 10)), true);
  assert.equal(board.inBounds(c(20, 5)), false);
  assert.equal(board.inBounds(c(5, 11)), false);
  assert.equal(board.isWideZone(c(5, 1)), true);
  assert.equal(board.isWideZone(c(5, 2)), false);
  assert.equal(board.isWideZone(c(5, 8)), false);
  assert.equal(board.isWideZone(c(5, 9)), true);
  assert.equal(board.scoringEndZoneX('A'), 19);
  assert.equal(board.scoringEndZoneX('B'), 0);
  assert.equal(inOwnHalf('A', c(6, 5)), true);
  assert.equal(inOwnHalf('A', c(7, 5)), false);
  assert.equal(inOwnHalf('B', c(13, 5)), true);
  assert.equal(inOwnHalf('B', c(12, 5)), false);
  for (let x = 0; x < 20; x++) assert.equal(inNoMansLand(x), x >= 7 && x <= 12, `x ${x}`);
  usePitch('standard');
  assert.equal(board.inBounds(c(25, 14)), true);
  assert.equal(board.isWideZone(c(5, 3)), true);
  assert.equal(board.scoringEndZoneX('A'), 25);
  assert.equal(inOwnHalf('A', c(12, 5)), true);
  assert.equal(inNoMansLand(12), false);
});

test('copying a state selects its pitch: a standard state after a Sevens one uses the full pitch again', () => {
  const r = createMatch('tournament', hum7(), orc7(), { rules: 'full' }, 1);
  Engine.cloneState(r.state!);
  assert.equal(board.inBounds(c(22, 5)), false);
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(22, 5), { id: 'A1' });
  b.ball(c(22, 5));
  const s = b.start();
  assert.equal(board.inBounds(c(22, 5)), true);
  assert.deepEqual(validateInput(s, { kind: 'playerAction', playerId: 'A1', action: 'move', path: [{ to: c(23, 5), kind: 'step' }] }), []);
});

// ---------------------------------------------------------------------------
// Match flow helpers
// ---------------------------------------------------------------------------

type Answer = (req: NonNullable<ExecutionResult['decision']>, s: GameState) => string;
const first: Answer = (req) => req.options[0].id;

function run(s: GameState, input: ActionInput, answer: Answer = first, faces?: number[]): ExecutionResult {
  const dice = faces ? () => new ScriptedDice(faces) : undefined;
  let res = execute(s, input, undefined, dice);
  let guard = 0;
  while (res.status === 'awaitingDecision' && res.decision) {
    if (guard++ > 60) throw new Error('too many decisions');
    res = decide(res.state, { requestId: res.decision.id, optionId: answer(res.decision, res.state) }, dice);
  }
  return res;
}
function ok(res: ExecutionResult): GameState {
  assert.notEqual(res.status, 'illegal', res.error);
  return res.state;
}
const texts = (r: { events: { text: string }[] }) => r.events.map((e) => e.text).join('\n');
const diceKinds = (r: ExecutionResult) => r.events.flatMap((e) => e.dice ?? []).map((d) => d.kind);
/** Dice as rolled: one record per run of same-sized dice, e.g. 'd8:5', 'd6:4+2'. */
const diceRolled = (r: ExecutionResult) => r.events.flatMap((e) => e.dice ?? []).map((d) => `${d.kind}:${d.faces.join('+')}`);

function newSevens(rules: 'full' | 'introductory' = 'introductory', seed = 7): GameState {
  const r = createMatch('tournament', hum7(), orc7(), { rules }, seed);
  assert.ok(r.ok, r.errors.join('\n'));
  return r.state as GameState;
}

/** Pre-game (A receives: roll-off A 5, B 2, first option), then both default set-ups. */
function toKickoff(rules: 'full' | 'introductory' = 'introductory'): GameState {
  let s = newSevens(rules);
  s = ok(run(s, { kind: 'pregame' }, first, rules === 'full' ? [2, 3, 3, 4, 5, 2] : [5, 2]));
  assert.equal(s.match!.kicking, 'B');
  s = ok(run(s, { kind: 'setupTeam', team: 'B', positions: defaultFormation(s, 'B') }));
  s = ok(run(s, { kind: 'setupTeam', team: 'A', positions: defaultFormation(s, 'A') }));
  assert.equal(s.phase, 'kickoff');
  return s;
}
/** B's kicker: the default set-up has B players at (15,3), (15,7), (16,5), (18,5) behind the Line of Scrimmage. */
const kicker = (s: GameState) => s.players.find((q) => q.team === 'B' && q.pos && q.pos.x === 16 && q.pos.y === 5)!;

// ---------------------------------------------------------------------------
// Set-up (S.p.10) — player placement
// ---------------------------------------------------------------------------

test('Sevens set-up: the default formations put 7 players in each team\'s own area (3 on the Line of Scrimmage, none in a Wide Zone)', () => {
  const s = toKickoff();
  for (const t of ['A', 'B'] as TeamId[]) {
    const on = s.players.filter((q) => q.team === t && q.location === 'pitch');
    assert.equal(on.length, 7, `${t} fields seven`);
    assert.ok(on.every((q) => inOwnHalf(t, q.pos!)), 'own area only');
    assert.equal(on.filter((q) => q.pos!.x === (t === 'A' ? 6 : 13)).length, 3);
    assert.ok(on.every((q) => !board.isWideZone(q.pos!)));
  }
  // The Human team's 8th player stays in the Reserves Box.
  assert.equal(s.players.filter((q) => q.team === 'A' && q.location === 'reserves').length, 1);
});

test('Sevens set-up rules are enforced: 7 players, one per Wide Zone, three on the Line of Scrimmage, never in No Man\'s Land', () => {
  let s = newSevens();
  s = ok(run(s, { kind: 'pregame' }, first, [5, 2]));
  const f = defaultFormation(s, 'B');
  const ids = Object.keys(f);
  const tryB = (pos: Record<string, { x: number; y: number } | null>) => execute(s, { kind: 'setupTeam', team: 'B', positions: pos }).error ?? '';
  // Into No Man's Land.
  assert.match(tryB({ ...f, [ids[6]]: c(12, 5) }), /No Man's Land/);
  // Two players in the top Wide Zone.
  assert.match(tryB({ ...f, [ids[5]]: c(16, 1), [ids[6]]: c(17, 0) }), /top Wide Zone.*at most 1/);
  // One is fine.
  assert.equal(tryB({ ...f, [ids[6]]: c(17, 0) }), '');
  // Only two on the Line of Scrimmage.
  assert.match(tryB({ ...f, [ids[0]]: c(14, 4) }), /at least 3 players must be on the Line of Scrimmage/);
  // Six players only.
  assert.match(tryB({ ...f, [ids[6]]: null }), /set up 7 players/);
  // The per-team check agrees.
  const t = structuredClone(s);
  for (const q of t.players) if (q.team === 'B' && f[q.id]) {
    q.location = 'pitch';
    q.pos = f[q.id];
  }
  assert.deepEqual(validateDriveSetup(t, 'B').filter((i) => i.level === 'error'), []);
});

test('Sevens set-up: a team with three or fewer players sets them all up on the Line of Scrimmage (S.p.10)', () => {
  let s = newSevens();
  s = ok(run(s, { kind: 'pregame' }, first, [5, 2]));
  const bs = s.players.filter((q) => q.team === 'B');
  for (const q of bs.slice(3)) {
    q.location = 'ko';
  }
  const three = { [bs[0].id]: c(13, 4), [bs[1].id]: c(13, 5), [bs[2].id]: c(15, 5) };
  assert.match(execute(s, { kind: 'setupTeam', team: 'B', positions: three }).error ?? '', /all must be on the Line of Scrimmage/);
  assert.equal(execute(s, { kind: 'setupTeam', team: 'B', positions: { ...three, [bs[2].id]: c(13, 6) } }).status !== 'illegal', true);
});

// ---------------------------------------------------------------------------
// Kick-off (S.p.10)
// ---------------------------------------------------------------------------

test('Sevens kick-off: aim into the receiving team\'s area (not No Man\'s Land); the kicker is off the Line of Scrimmage and out of the Wide Zones', () => {
  const s = toKickoff();
  const cands = kickerCandidates(s, 'B');
  assert.ok(cands.length && cands.every((q) => q.pos!.x !== 13 && !board.isWideZone(q.pos!)));
  assert.match(execute(s, { kind: 'kickoff', kicker: kicker(s).id, target: c(9, 5) }).error ?? '', /receiving team's area/);
  assert.equal(validateInput(s, { kind: 'kickoff', kicker: kicker(s).id, target: c(3, 4) }).length, 0);
});

test('Sevens kick-off: the Deviation distance is the LOWER of two D6', () => {
  const s = toKickoff();
  // Target (2,2); D8 5 (right); 2D6 4, 2 → 2 → (4,2), empty → Bounce D8 2 (up) → (4,1).
  const res = run(s, { kind: 'kickoff', kicker: kicker(s).id, target: c(2, 2) }, first, [5, 4, 2, 2]);
  const t = ok(res);
  assert.deepEqual(diceRolled(res), ['d8:5', 'd6:4+2', 'd8:2']);
  assert.match(texts(res), /2D6 4, 2 \(the lower: 2\)/);
  assert.deepEqual(t.ball, { kind: 'ground', pos: c(4, 1) });
  assert.equal(t.turn.active, 'A');
  assert.equal(t.teams.A.turn, 1);
});

test('Sevens kick-off: Kick (p.130) replaces the distance with a D3', () => {
  const s = toKickoff();
  const k = kicker(s);
  k.skills.push({ id: 'kick' });
  const res = run(s, { kind: 'kickoff', kicker: k.id, target: c(2, 2), useKick: true }, first, [5, 3, 2]);
  assert.deepEqual(diceKinds(res), ['d8', 'd3', 'd8']);
  assert.deepEqual(ok(res).ball, { kind: 'ground', pos: c(5, 1) });
});

test('Sevens Touchbacks: landing in No Man\'s Land is NOT a Touchback; crossing the kicking team\'s Line of Scrimmage or leaving the pitch is', () => {
  const s = toKickoff();
  // Target (5,2); D8 5; 2D6 3, 6 → 3 → (8,2): No Man's Land → lands, Bounce D8 5 → (9,2).
  const nml = run(s, { kind: 'kickoff', kicker: kicker(s).id, target: c(5, 2) }, first, [5, 3, 6, 5]);
  const t1 = ok(nml);
  assert.doesNotMatch(texts(nml), /Touchback/);
  assert.deepEqual(t1.ball, { kind: 'ground', pos: c(9, 2) });
  // Target (6,2); D8 5; 2D6 6, 6 → (12,2) No Man's Land; Bounce D8 5 → (13,2): across B's Line of Scrimmage → Touchback.
  const cross = run(s, { kind: 'kickoff', kicker: kicker(s).id, target: c(6, 2) }, first, [5, 6, 6, 5]);
  const t2 = ok(cross);
  assert.match(texts(cross), /behind the kicking team's Line of Scrimmage.*Touchback/);
  assert.equal(t2.ball.kind, 'held');
  assert.equal(p(t2, (t2.ball as { playerId: string }).playerId).team, 'A');
  // Target (1,5); D8 4 (left); 2D6 2, 5 → 2 → off the pitch → Touchback.
  const off = run(s, { kind: 'kickoff', kicker: kicker(s).id, target: c(1, 5) }, first, [4, 2, 5]);
  assert.match(texts(off), /leaves the pitch: Touchback/);
  assert.equal(ok(off).ball.kind, 'held');
});

// ---------------------------------------------------------------------------
// Kick-off Event Table (S.p.11). Full rules: D8, 2D6 deviation, then the 2D6 event.
// ---------------------------------------------------------------------------

/** Deviation used below: target (2,2), D8 5, 2D6 2, 2 → (4,2), an empty square. */
const DEV = [5, 2, 2];
const kickoffAt = (s: GameState, faces: number[], answer: Answer = first) => run(s, { kind: 'kickoff', kicker: kicker(s).id, target: c(2, 2) }, answer, faces);

test('Sevens Time-out: back one space when the kicking team\'s marker is on turn 5 or 6, otherwise forward', () => {
  const s = toKickoff('full');
  s.teams.A.turn = 5;
  s.teams.B.turn = 5;
  // Event 1+2 = 3; the ball lands at (4,2) and bounces D8 2 → (4,1); A then starts its next Turn.
  const back = ok(kickoffAt(s, [...DEV, 1, 2, 2]));
  assert.equal(back.teams.B.turn, 4);
  assert.equal(back.teams.A.turn, 5);
  s.teams.A.turn = 4;
  s.teams.B.turn = 4;
  const fwd = ok(kickoffAt(s, [...DEV, 1, 2, 2]));
  assert.equal(fwd.teams.B.turn, 5);
  assert.equal(fwd.teams.A.turn, 6);
});

test('Sevens Alert Defence (event 4): up to D3+1 Open kicking players move one square, even into No Man\'s Land', () => {
  const s = toKickoff('full');
  const res = kickoffAt(s, [...DEV, 1, 3, 2]);
  const t = ok(res);
  assert.match(texts(res), /Alert Defence/);
  assert.deepEqual(t.match!.pendingPhase, { type: 'quickSnap', team: 'B', max: 3, alert: true });
  const los = t.players.filter((q) => q.team === 'B' && q.pos && q.pos.x === 13);
  assert.match(execute(t, { kind: 'quickSnap', moves: { [los[0].id]: c(11, los[0].pos!.y) } }).error ?? '', /one square/);
  const four = Object.fromEntries(t.players.filter((q) => q.team === 'B' && q.location === 'pitch').slice(0, 4).map((q) => [q.id, c(q.pos!.x - 1, q.pos!.y)]));
  assert.match(execute(t, { kind: 'quickSnap', moves: four }).error ?? '', /Alert Defence: at most 3/);
  const receiving = t.players.find((q) => q.team === 'A' && q.location === 'pitch')!;
  assert.match(execute(t, { kind: 'quickSnap', moves: { [receiving.id]: c(receiving.pos!.x + 1, receiving.pos!.y) } }).error ?? '', /kicking players/);
  const moved = ok(run(t, { kind: 'quickSnap', moves: { [los[0].id]: c(12, los[0].pos!.y) } }, first, [2]));
  assert.deepEqual(p(moved, los[0].id).pos, c(12, los[0].pos!.y));
  assert.ok(inNoMansLand(12));
  assert.equal(moved.phase, 'play');
});

test('Sevens Quick Snap (event 9) and Charge! (event 10) use D3+1 players', () => {
  const s = toKickoff('full');
  const qs = ok(kickoffAt(s, [...DEV, 4, 5, 1]));
  assert.deepEqual(qs.match!.pendingPhase, { type: 'quickSnap', team: 'A', max: 2 });
  const ch = ok(kickoffAt(s, [...DEV, 4, 6, 3]));
  assert.equal(ch.match!.pendingPhase?.type, 'charge');
  assert.equal((ch.match!.pendingPhase as { max: number }).max, 4);
});

test('Sevens Pitch Invasion (event 12): ONE random player of the lowest roller is Placed Prone and Stunned', () => {
  const s = toKickoff('full');
  const ff = s.match!.fanFactor!;
  assert.ok(1 + ff.A < 6 + ff.B);
  // Event 6+6; A 1, B 6 → A; random player: die face 3 of 7; then the landing Bounce D8 2.
  const res = kickoffAt(s, [...DEV, 6, 6, 1, 6, 3, 2]);
  const t = ok(res);
  const stunned = t.players.filter((q) => q.stance === 'stunned');
  assert.equal(stunned.length, 1, texts(res));
  assert.equal(stunned[0].team, 'A');
});

test('Sevens High Kick (event 5): nobody is placed when the ball will come down in No Man\'s Land', () => {
  const s = toKickoff('full');
  // Target (5,2); D8 5; 2D6 3, 4 → (8,2) in No Man's Land; event 2+3; the ball lands and bounces D8 5 → (9,2).
  const res = run(s, { kind: 'kickoff', kicker: kicker(s).id, target: c(5, 2) }, first, [5, 3, 4, 2, 3, 5]);
  assert.match(texts(res), /High Kick: no Open player can be placed/);
  assert.deepEqual(ok(res).ball, { kind: 'ground', pos: c(9, 2) });
});

// ---------------------------------------------------------------------------
// Turns and Team Re-rolls (S.p.7; rulebook p.33)
// ---------------------------------------------------------------------------

test('Sevens: six Turns per half — the half ends after Turn 6', () => {
  const s = toKickoff();
  let t = ok(run(s, { kind: 'kickoff', kicker: kicker(s).id, target: c(2, 2) }, first, [5, 2, 2, 2]));
  assert.equal(rulesFor(t).turnsPerHalf, 6);
  // Play end-turn only: A 1, B 1, … A 6, B 6 → half over.
  let n = 0;
  while (t.phase === 'play') {
    t = ok(run(t, { kind: 'endTurn' }));
    n++;
    assert.ok(n <= 12);
  }
  assert.equal(t.phase, 'halfOver');
  assert.equal(n, 12);
  assert.equal(t.teams.A.turn, 6);
  assert.equal(t.teams.B.turn, 6);
});

test('Sevens Team Re-rolls: full at the start of each half, NOT replenished between Drives; Brilliant Coaching\'s extra one is lost at the end of its Drive', () => {
  const s = toKickoff('full');
  assert.deepEqual(s.match!.rosterRerolls, { A: 1, B: 1 });
  assert.equal(s.teams.A.rerolls, 1);
  // Event 3+4 = 7 Brilliant Coaching: A 5, B 2 → A gains a free re-roll for the Drive; landing Bounce D8 2.
  let t = ok(kickoffAt(s, [...DEV, 3, 4, 5, 2, 2]));
  assert.equal(t.teams.A.rerolls, 2);
  assert.equal(t.teams.A.bonusRerolls, 1);
  // A spends its roster re-roll this Drive (simulated), then scores: next Drive in the same half.
  t.teams.A.rerolls = 1;
  t.teams.A.bonusRerolls = 1;
  const carrier = t.players.find((q) => q.team === 'A' && q.location === 'pitch')!;
  carrier.pos = c(18, 0);
  t.ball = { kind: 'held', playerId: carrier.id };
  t = ok(run(t, { kind: 'playerAction', playerId: carrier.id, action: 'move', path: [{ to: c(19, 0), kind: 'step' }] }));
  assert.equal(t.phase, 'touchdown');
  t = ok(run(t, { kind: 'nextDrive' }, first, [6, 6, 6, 6, 6, 6]));
  assert.equal(t.match!.half, 1);
  assert.equal(t.teams.A.rerolls, 0, 'the bonus is gone and the spent re-roll is not replenished by a new Drive');
  assert.equal(t.teams.B.rerolls, 1);
  // Half-time: back to the roster's one re-roll each.
  t.teams.A.turn = 6;
  t.teams.B.turn = 6;
  t.phase = 'halfOver';
  t = ok(run(t, { kind: 'nextDrive' }, first, [6, 6, 6, 6, 6, 6]));
  assert.equal(t.match!.half, 2);
  assert.equal(t.teams.A.rerolls, 1);
  assert.equal(t.teams.B.rerolls, 1);
  assert.equal(t.teams.A.bonusRerolls ?? 0, 0);
});

// ---------------------------------------------------------------------------
// Throw-ins (S.p.13), injuries (S.p.12), referees (S.p.13)
// ---------------------------------------------------------------------------

test('Sevens Throw-in: distance D6+2 (two dice: direction and distance), and the preview still accounts for every outcome', () => {
  const b = new Pos({ sevens: true, rerollsA: 0 });
  b.add('A', 'human', 'lineman', c(4, 1), { id: 'A1' });
  b.add('B', 'orc', 'lineman', c(15, 5), { id: 'B1' });
  b.ball(c(5, 0));
  const s = b.start();
  // Pick-up 1 fails (no re-roll) → Bounce D8 2 (up) off the pitch → Throw-in: D6 3 (straight in), D6 4 → 6 squares.
  const res = runScripted(s, { kind: 'playerAction', playerId: 'A1', action: 'move', path: [{ to: c(5, 0), kind: 'step' }] }, [1, 2, 3, 4, 6], (r) => r.options[0].id);
  assert.match(texts(res), /distance D6\+2: 4\+2=6/);
  // Pick-up D6, Bounce D8, then the Throw-in: direction D6 and distance D6 only (no third die).
  assert.deepEqual(diceRolled(res).slice(0, 3), ['d6:1', 'd8:2', 'd6:3+4'], diceRolled(res).join(','));
  const plan = planAction(s, { kind: 'playerAction', playerId: 'A1', action: 'move', path: [{ to: c(5, 0), kind: 'step' }] });
  assert.ok(plan.ok, plan.errors.join());
});

function blockScene(target: { roster: string; position: string; extra?: Array<{ id: string }> }, apothecary = false) {
  const b = new Pos({ sevens: true, rerollsA: 0 });
  b.add('A', 'orc', 'blitzer', c(8, 5), { id: 'X' });
  b.add('B', target.roster, target.position, c(9, 5), { id: 'Y', extraSkills: target.extra });
  b.ball(c(2, 2));
  const s = b.start();
  if (apothecary) s.teams.B.apothecary = 'available';
  return s;
}
const blockY: PlayerActionInput = { kind: 'playerAction', playerId: 'X', action: 'block', path: [], blockTarget: 'Y' };
const noFollow: Chooser = (req) => (req.type === 'followUp' ? 'no' : req.type === 'apothecary' ? 'use' : req.options[0].id);

test('Sevens Injury Table (S.p.12): 2-7 Stunned, 8-9 KO, 10 Badly Hurt, 11 Seriously Hurt, 12 Dead — no Casualty Roll', () => {
  const s = blockScene({ roster: 'human', position: 'lineman' });
  // Block die 6 (POW); armour 5+5 = 10 breaks AV 9; then the Injury 2D6.
  const at = (a: number, b: number) => runScripted(s, blockY, [6, 5, 5, a, b], noFollow);
  assert.equal(p(at(3, 4).state, 'Y').stance, 'stunned');
  assert.equal(p(at(4, 4).state, 'Y').location, 'ko');
  assert.equal(p(at(4, 5).state, 'Y').location, 'ko');
  for (const [a, b, name] of [[5, 5, 'Badly Hurt'], [5, 6, 'Seriously Hurt'], [6, 6, 'Dead']] as const) {
    const r = at(a, b);
    assert.equal(p(r.state, 'Y').location, 'cas', texts(r));
    assert.equal(p(r.state, 'Y').casualtyResult, name);
    assert.ok(!diceKinds(r).includes('d16'), 'no Casualty Roll');
    assert.match(texts(r), /Sevens Injury Table — no Casualty Roll/);
  }
});

test('Sevens Stunty Injury Table: 2-6 Stunned, 7-8 KO, 9-10 Badly Hurt, 11 Seriously Hurt, 12 Dead; Thick Skull still saves the lowest KO', () => {
  const s = blockScene({ roster: 'orc', position: 'goblin' });
  // ST 3 v 2: two block dice (6, 6: POW); Goblin AV 8: armour 4+4 = 8 breaks.
  const at = (a: number, b: number) => runScripted(s, { ...blockY }, [6, 6, 4, 4, a, b], noFollow).state;
  assert.equal(p(at(3, 3), 'Y').stance, 'stunned');
  assert.equal(p(at(3, 4), 'Y').location, 'ko');
  assert.equal(p(at(4, 4), 'Y').location, 'ko');
  assert.equal(p(at(4, 5), 'Y').casualtyResult, 'Badly Hurt');
  assert.equal(p(at(5, 5), 'Y').casualtyResult, 'Badly Hurt');
  assert.equal(p(at(5, 6), 'Y').casualtyResult, 'Seriously Hurt');
  assert.equal(p(at(6, 6), 'Y').casualtyResult, 'Dead');
  const ts = blockScene({ roster: 'human', position: 'lineman', extra: [{ id: 'thickSkull' }] });
  const tsAt = (a: number, b: number) => runScripted(ts, blockY, [6, 5, 5, a, b], noFollow).state;
  assert.equal(p(tsAt(4, 4), 'Y').stance, 'stunned', 'Thick Skull: 8 is Stunned');
  assert.equal(p(tsAt(4, 5), 'Y').location, 'ko');
});

test('Sevens Apothecary: patches up a Knocked-out player as in the rulebook; a Casualty cannot be patched up (no Casualty Roll — interpretation 2)', () => {
  const s = blockScene({ roster: 'human', position: 'lineman' }, true);
  const ko = runScripted(s, blockY, [6, 5, 5, 4, 4], noFollow);
  assert.equal(p(ko.state, 'Y').stance, 'stunned');
  assert.equal(p(ko.state, 'Y').location, 'pitch');
  assert.equal(ko.state.teams.B.apothecary, 'used');
  const cas = runScripted(s, blockY, [6, 5, 5, 5, 6], noFollow);
  assert.equal(p(cas.state, 'Y').location, 'cas');
  assert.equal(cas.state.teams.B.apothecary, 'available');
  assert.match(texts(cas), /cannot patch up a Casualty/);
});

test('Sevens Amateur Referees (S.p.13): Argue the Call 5-6 keeps the player (Turnover stands), 1-4 still Sent-off, never a coach ejection', () => {
  const b = new Pos({ sevens: true, rerollsA: 0 });
  b.add('A', 'human', 'lineman', c(8, 5), { id: 'A1' });
  b.add('B', 'orc', 'lineman', c(9, 5), { id: 'B1', stance: 'prone' });
  b.ball(c(1, 1));
  const s = b.start();
  const foul: PlayerActionInput = { kind: 'playerAction', playerId: 'A1', action: 'foul', path: [], foulTarget: 'B1' };
  const argue: Chooser = (req) => (req.type === 'argueTheCall' ? 'yes' : req.options[0].id);
  // Armour 5+5 = 10 breaks AV 10 with a natural double → Sent-off; Injury 2+3 Stunned; Argue D6.
  const five = runScripted(s, foul, [5, 5, 2, 3, 5], argue);
  assert.equal(five.status, 'turnover');
  assert.equal(p(five.state, 'A1').location, 'pitch');
  assert.match(texts(five), /when you put it like that/);
  const four = runScripted(s, foul, [5, 5, 2, 3, 4], argue);
  assert.equal(p(four.state, 'A1').location, 'sentOff');
  const one = runScripted(s, foul, [5, 5, 2, 3, 1], argue);
  assert.equal(p(one.state, 'A1').location, 'sentOff');
  assert.notEqual(one.state.teams.A.coachEjected, true);
  assert.match(texts(one), /I don't care!/);
});

// ---------------------------------------------------------------------------
// Veteran (S.p.13)
// ---------------------------------------------------------------------------

test('Veteran: once per game, re-roll a failed pick-up (not a Team Re-roll); gone after use', () => {
  const b = new Pos({ sevens: true, rerollsA: 0 });
  const v = b.add('A', 'human', 'lineman', c(4, 5), { id: 'V' });
  v.veteran = 'ready';
  b.add('B', 'orc', 'lineman', c(15, 5), { id: 'B1' });
  b.ball(c(5, 5));
  const s = b.start();
  const asked: string[][] = [];
  const pick: Chooser = (req) => {
    if (req.type === 'reroll') asked.push(req.options.map((o) => o.id));
    return req.type === 'reroll' && req.options.some((o) => o.id === 'veteran') ? 'veteran' : req.options[0].id;
  };
  const r = runScripted(s, { kind: 'playerAction', playerId: 'V', action: 'move', path: [{ to: c(5, 5), kind: 'step' }] }, [1, 4], pick);
  assert.deepEqual(asked, [['veteran', 'none']]);
  assert.equal(r.state.ball.kind, 'held');
  assert.equal(p(r.state, 'V').veteran, 'used');
  assert.match(texts(r), /Veteran's once-per-game re-roll/);
  // Used: a later failure offers nothing.
  const s2 = structuredClone(s);
  p(s2, 'V').veteran = 'used';
  const r2 = runScripted(s2, { kind: 'playerAction', playerId: 'V', action: 'move', path: [{ to: c(5, 5), kind: 'step' }] }, [1, 2], pick);
  assert.equal(r2.status, 'turnover');
  // The preview counts it as a re-roll source.
  const plan = planAction(s, { kind: 'playerAction', playerId: 'V', action: 'move', path: [{ to: c(5, 5), kind: 'step' }] });
  assert.ok(plan.steps.some((st) => st.rerolls.includes('Veteran (once per game)')), JSON.stringify(plan.steps.map((st) => st.rerolls)));
});

test('Veteran: re-roll the block dice when its own Block would Knock it Down (interpretation 3)', () => {
  const b = new Pos({ sevens: true, rerollsA: 0 });
  const v = b.add('A', 'human', 'lineman', c(8, 5), { id: 'V' });
  v.veteran = 'ready';
  b.add('B', 'orc', 'lineman', c(9, 5), { id: 'Y' });
  b.ball(c(2, 2));
  const s = b.start();
  const asked: string[][] = [];
  const pick: Chooser = (req) => {
    if (req.type === 'reroll') asked.push(req.options.map((o) => o.id));
    return req.type === 'reroll' ? 'veteran' : req.type === 'followUp' ? 'no' : req.options[0].id;
  };
  // ST 3 v 3: one die, attacker chooses. Die 1 = Player Down → Veteran re-roll → 3 (Push).
  const r = runScripted(s, blockY2('V', 'Y'), [1, 3], pick);
  assert.deepEqual(asked, [['veteran', 'none']]);
  assert.equal(p(r.state, 'V').stance, 'standing');
  assert.equal(p(r.state, 'V').veteran, 'used');
  // A Push is not a Knock Down: nothing to offer.
  asked.length = 0;
  runScripted(s, blockY2('V', 'Y'), [3], pick);
  assert.deepEqual(asked, []);
  // The rule itself.
  assert.equal(veteranWouldGoDown(['playerDown', 'push'], true, p(s, 'V')), false, 'attacker chooses: a safe die exists');
  assert.equal(veteranWouldGoDown(['playerDown', 'push'], false, p(s, 'V')), true, 'defender chooses: it will pick the skull');
  assert.equal(veteranWouldGoDown(['bothDown'], true, p(s, 'V')), true);
  const withBlock = { ...p(s, 'V'), skills: [{ id: 'block' }] };
  assert.equal(veteranWouldGoDown(['bothDown'], true, withBlock), false);
});
const blockY2 = (att: string, def: string): PlayerActionInput => ({ kind: 'playerAction', playerId: att, action: 'block', path: [], blockTarget: def });

// ---------------------------------------------------------------------------
// Whole matches
// ---------------------------------------------------------------------------

function playWholeSevens(seed: number, rules: 'full' | 'introductory'): GameState {
  let s = newSevens(rules, seed);
  let steps = 0;
  while (s.phase !== 'fullTime') {
    if (steps++ > 300) throw new Error(`match did not finish (phase ${s.phase})`);
    let input: ActionInput;
    const m = s.match!;
    if (s.phase === 'pregame') input = { kind: 'pregame' };
    else if (s.phase === 'driveSetup') {
      const t = (m.setupDone[m.kicking as TeamId] ? (m.kicking === 'A' ? 'B' : 'A') : m.kicking) as TeamId;
      input = { kind: 'setupTeam', team: t, positions: defaultFormation(s, t) };
    } else if (s.phase === 'kickoff' && m.pendingPhase?.type === 'quickSnap') input = { kind: 'quickSnap', moves: {} };
    else if (s.phase === 'kickoff') {
      const k = m.kicking as TeamId;
      input = { kind: 'kickoff', kicker: kickerCandidates(s, k)[0].id, target: c(k === 'A' ? 16 : 3, 5) };
    } else if (s.phase === 'play' && m.pendingPhase?.type === 'charge') input = { kind: 'endCharge' };
    else if (s.phase === 'play') input = { kind: 'endTurn' };
    else input = { kind: 'nextDrive' };
    const res = run(s, input);
    assert.notEqual(res.status, 'illegal', `${input.kind}: ${res.error}`);
    s = res.state;
    assert.deepEqual(validateState(s), []);
    for (const t of ['A', 'B'] as TeamId[]) {
      assert.ok(s.players.filter((q) => q.team === t && q.location === 'pitch').length <= 7);
      assert.ok(s.teams[t].turn <= 6);
      assert.ok(s.teams[t].rerolls <= s.match!.rosterRerolls[t] + (s.teams[t].bonusRerolls ?? 0), 'never more re-rolls than the roster (+ a Brilliant Coaching bonus)');
    }
  }
  return s;
}

test('whole Sevens matches (end-turn only) run from pre-game to full time: ≤ 7 players a side, ≤ 6 Turns a half', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const s = playWholeSevens(seed, seed % 4 === 0 ? 'introductory' : 'full');
    assert.equal(s.phase, 'fullTime');
    assert.equal(s.match!.half, 2);
  }
});

test('the computer coach plays a whole Sevens match against a scripted coach: legal inputs, both halves, full time', () => {
  const r = createMatch('tournament', hum7(), orc7(), { rules: 'full', computer: { team: 'B', style: 'balanced' } }, 5);
  let s = r.state as GameState;
  const style: AIStyle = 'balanced';
  let aiActions = 0;
  let guard = 0;
  while (s.phase !== 'fullTime') {
    assert.ok(guard++ < 3000, `stuck in ${s.phase}`);
    const who = waitingFor(s);
    let res: ExecutionResult;
    if (!who) res = execute(s, s.phase === 'pregame' ? { kind: 'pregame' } : { kind: 'nextDrive' });
    else if (who === 'B') {
      const mv = nextMove(s, 'B', style, { maxExplored: 6 });
      if (!mv) throw new Error(`the AI must act in ${s.phase}`);
      if (mv.type === 'decision') res = decide(s, { requestId: mv.requestId, optionId: mv.optionId });
      else {
        assert.deepEqual(validateInput(s, mv.input), [], `${mv.type}: ${mv.why}`);
        if (mv.type === 'action') aiActions++;
        res = execute(s, mv.input);
      }
    } else if (s.pending) res = decide(s, { requestId: s.pending.request.id, optionId: s.pending.request.options[0].id });
    else {
      const m = s.match!;
      let input: ActionInput;
      if (s.phase === 'driveSetup') input = { kind: 'setupTeam', team: 'A', positions: defaultFormation(s, 'A') };
      else if (s.phase === 'kickoff' && m.pendingPhase?.type === 'quickSnap') input = { kind: 'quickSnap', moves: {} };
      else if (s.phase === 'kickoff') input = { kind: 'kickoff', kicker: kickerCandidates(s, 'A')[0].id, target: c(16, 5) };
      else input = { kind: 'endTurn' };
      res = execute(s, input);
    }
    assert.notEqual(res.status, 'illegal', res.error);
    s = res.state;
    for (const t of ['A', 'B'] as TeamId[]) assert.ok(s.players.filter((q) => q.team === t && q.location === 'pitch').length <= 7);
  }
  assert.ok(aiActions > 10, `AI actions ${aiActions}`);
  assert.ok(s.teams.B.score >= 1, `against a coach who never acts the computer should score (${s.teams.A.score}-${s.teams.B.score})`);
});
