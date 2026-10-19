/**
 * Match play: team templates, pre-game, set-up validation (p.47), kick-off,
 * Kick-off Events (p.48), Touchbacks (p.49), End of Drive (p.82-83).
 * D8 directions (p.34 template): 1 up-left, 2 up, 3 up-right, 4 left, 5 right, 6 down-left, 7 down, 8 down-right.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  actionOptions,
  createMatch,
  decide,
  defaultFormation,
  execute,
  newTeamDef,
  playerFromRoster,
  ROSTER_BY_ID,
  ScriptedDice,
  validateFormalStart,
  validatePosition,
  validateState,
  validateTeamDef,
  type ActionInput,
  type ExecutionResult,
  type GameState,
  type TeamDef,
  type TeamId,
} from '../src/engine/index';
import { c, p, Pos } from './helpers';

function team(id: string, kind: 'league' | 'tournament', rosterId: string, comp: Array<[string, number]>, rerolls: number, apothecary = false): TeamDef {
  const t = newTeamDef(kind, rosterId, `${rosterId} ${id}`, id);
  let n = 1;
  for (const [pos, k] of comp) for (let i = 0; i < k; i++) t.players.push(playerFromRoster(ROSTER_BY_ID[rosterId], pos, n, `${id}-${n++}`));
  t.rerolls = rerolls;
  t.apothecary = apothecary;
  return t;
}
const humans = (kind: 'league' | 'tournament' = 'tournament') => team('hum', kind, 'human', [['lineman', 7], ['blitzer', 2], ['catcher', 2], ['thrower', 1]], 3, true);
const orcs = (kind: 'league' | 'tournament' = 'tournament') => team('orc', kind, 'orc', [['lineman', 7], ['blitzer', 2], ['bigUn', 2]], 3, true);

function newMatch(rules: 'full' | 'introductory' = 'full', seed = 7): GameState {
  const r = createMatch('tournament', humans(), orcs(), { rules }, seed);
  assert.ok(r.ok, r.errors.join('\n'));
  return r.state as GameState;
}

type Answer = (req: NonNullable<ExecutionResult['decision']>, s: GameState) => string;
const first: Answer = (req) => req.options[0].id;

/** Execute an input and answer every decision (RNG or scripted dice). */
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

/** Pre-game (A wins the roll-off and chooses to receive), then both default set-ups. */
function toKickoff(rules: 'full' | 'introductory' = 'introductory', seed = 7): GameState {
  let s = newMatch(rules, seed);
  // full: Fan Factor D3 2 / 3, Weather 3+4, roll-off A 5 B 2; introductory: roll-off only. A receives.
  s = ok(run(s, { kind: 'pregame' }, first, rules === 'full' ? [2, 3, 3, 4, 5, 2] : [5, 2]));
  assert.equal(s.match!.kicking, 'B');
  assert.equal(s.phase, 'driveSetup');
  const k = s.match!.kicking as TeamId;
  s = ok(run(s, { kind: 'setupTeam', team: k, positions: defaultFormation(s, k) }));
  const r: TeamId = k === 'A' ? 'B' : 'A';
  s = ok(run(s, { kind: 'setupTeam', team: r, positions: defaultFormation(s, r) }));
  assert.equal(s.phase, 'kickoff');
  return s;
}

const kickerOf = (s: GameState) => {
  const k = s.match!.kicking as TeamId;
  return s.players.find((q) => q.team === k && q.location === 'pitch' && q.pos && q.pos.y === 7 && (k === 'A' ? q.pos.x === 9 : q.pos.x === 16))!;
};

// ---------------------------------------------------------------------------
// Teams and match creation
// ---------------------------------------------------------------------------

test('tournament template: the drafted teams are valid (p.89-91)', () => {
  assert.deepEqual(validateTeamDef(humans()).filter((i) => i.level === 'error'), []);
  assert.deepEqual(validateTeamDef(orcs()).filter((i) => i.level === 'error'), []);
});

test('tournament template rejects over-budget teams, roster limits and changed profiles', () => {
  const t = humans();
  t.rerolls = 8;
  assert.ok(validateTeamDef(t).some((i) => i.level === 'error' && /Team Draft Budget/.test(i.text)));
  const u = team('x', 'tournament', 'human', [['lineman', 8], ['blitzer', 3]], 0);
  assert.ok(validateTeamDef(u).some((i) => i.level === 'error' && /Blitzer: the roster allows 0-2/.test(i.text)));
  const v = humans();
  v.players[0].st = 4;
  assert.ok(validateTeamDef(v).some((i) => i.level === 'error' && /roster profile unchanged/.test(i.text)));
  const tk = team('tk', 'tournament', 'tombKings', [['skeleton', 11]], 0, true);
  assert.ok(validateTeamDef(tk).some((i) => i.level === 'error' && /cannot hire an Apothecary/.test(i.text)));
  const small = team('s', 'tournament', 'orc', [['lineman', 10]], 0);
  assert.ok(validateTeamDef(small).some((i) => i.level === 'error' && /at least 11/.test(i.text)));
});

test('league teams are flexible: custom stats, extra re-rolls and few players are only warnings', () => {
  const t = humans('league');
  t.players[0].st = 5;
  t.rerolls = 9;
  t.players = t.players.slice(0, 9);
  const issues = validateTeamDef(t);
  assert.deepEqual(issues.filter((i) => i.level === 'error'), []);
  assert.ok(issues.some((i) => /Only 9 available players/.test(i.text)));
});

test('createMatch rejects invalid team choices with explanations', () => {
  const bad = createMatch('tournament', humans('league'), orcs(), { rules: 'full' });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => /League team/.test(e)));
  // V5.5: the same saved team on both sides is allowed — Player 2 plays an independent copy (tests/mirror.test.ts).
  const same = createMatch('tournament', humans(), humans(), { rules: 'full' });
  assert.ok(same.ok, same.errors.join());
  assert.equal(same.state!.teams.B.name, `${humans().name}*`);
  const t = orcs();
  t.players = t.players.slice(0, 5);
  const few = createMatch('tournament', humans(), t, { rules: 'full' });
  assert.ok(!few.ok && few.errors.some((e) => /at least 11/.test(e)));
  const league = createMatch('league', humans('league'), orcs('league'), { rules: 'full' });
  assert.ok(league.ok, league.errors.join());
  assert.equal(validateState(league.state).length, 0, validateState(league.state).join());
});

test('a new match starts in the pre-game with every player in the Reserves Box and no ball', () => {
  const s = newMatch();
  assert.equal(s.phase, 'pregame');
  assert.ok(s.players.every((q) => q.location === 'reserves'));
  assert.equal(s.ball.kind, 'none');
  assert.equal(s.teams.A.apothecary, 'available');
  const r = execute(s, { kind: 'playerAction', playerId: 'A1', action: 'move', path: [] });
  assert.equal(r.status, 'illegal');
});

// ---------------------------------------------------------------------------
// Pre-game
// ---------------------------------------------------------------------------

test('pre-game (full rules): Fan Factor = D3 + Dedicated Fans, Weather 2D6, roll-off, kick or receive', () => {
  // A: D3 2, B: D3 3; weather 3+4 = 7 Perfect; roll-off A 5, B 2 → A chooses to receive.
  const s = ok(run(newMatch('full'), { kind: 'pregame' }, first, [2, 3, 3, 4, 5, 2]));
  assert.deepEqual(s.match!.fanFactor, { A: 3, B: 4 });
  assert.equal(s.weather, 'perfect');
  assert.equal(s.match!.kicking, 'B');
  assert.equal(s.match!.receivedFirst, 'A');
  assert.equal(s.phase, 'driveSetup');
  assert.equal(s.turn.active, 'B');
});

test('pre-game: tied roll-offs are rolled again; the winner may choose to kick', () => {
  const s = ok(run(newMatch('full'), { kind: 'pregame' }, (req) => (req.type === 'kickOrReceive' ? 'kick' : req.options[0].id), [1, 1, 6, 6, 3, 3, 2, 6]));
  assert.equal(s.weather, 'blizzard');
  assert.equal(s.match!.kicking, 'B');
  const log = s.log[s.log.length - 1].events.map((e) => e.text).join('\n');
  assert.match(log, /tie, roll again/);
});

test('pre-game (introductory rules, p.44): no Fan Factor or Weather roll, Perfect Conditions', () => {
  const s = ok(run(newMatch('introductory'), { kind: 'pregame' }, first, [4, 2]));
  assert.equal(s.weather, 'perfect');
  assert.equal(s.match!.fanFactor, undefined);
  assert.equal(s.match!.kicking, 'B');
});

// ---------------------------------------------------------------------------
// Set-up (p.47)
// ---------------------------------------------------------------------------

function afterPregame(): GameState {
  return ok(run(newMatch('introductory'), { kind: 'pregame' }, first, [5, 2])); // A receives, B kicks
}

test('the kicking team must set up first', () => {
  const s = afterPregame();
  const r = execute(s, { kind: 'setupTeam', team: 'A', positions: defaultFormation(s, 'A') });
  assert.equal(r.status, 'illegal');
  assert.match(r.error ?? '', /kicking team sets up first/);
});

test('invalid set-ups are rejected with the rule, before any dice and without changing the state', () => {
  const s = afterPregame();
  const rng = JSON.stringify(s.rng);
  const snapshot = JSON.stringify(s);
  const base = defaultFormation(s, 'B');
  const ids = Object.keys(base);
  // 10 of 11 available players
  const ten = { ...base, [ids[10]]: null };
  let r = execute(s, { kind: 'setupTeam', team: 'B', positions: ten });
  assert.equal(r.status, 'illegal');
  assert.match(r.error ?? '', /set up 11 players/);
  // only 2 on the Line of Scrimmage
  r = execute(s, { kind: 'setupTeam', team: 'B', positions: { ...base, [ids[0]]: c(20, 7) } });
  assert.match(r.error ?? '', /at least 3 players must be on the Line of Scrimmage/);
  // 3 in one Wide Zone
  r = execute(s, { kind: 'setupTeam', team: 'B', positions: { ...base, [ids[5]]: c(18, 1), [ids[6]]: c(18, 2), [ids[7]]: c(18, 3) } });
  assert.match(r.error ?? '', /top Wide Zone/);
  // a player in the opponent's half
  r = execute(s, { kind: 'setupTeam', team: 'B', positions: { ...base, [ids[9]]: c(10, 7) } });
  assert.match(r.error ?? '', /opponent's half/);
  // two players in one square
  r = execute(s, { kind: 'setupTeam', team: 'B', positions: { ...base, [ids[9]]: base[ids[8]] } });
  assert.match(r.error ?? '', /cannot share/);
  assert.equal(JSON.stringify(s.rng), rng);
  assert.equal(JSON.stringify(s), snapshot);
});

test('a team with 3 or fewer players must put them all on the Line of Scrimmage', () => {
  const s = afterPregame();
  for (const q of s.players.filter((x) => x.team === 'B').slice(2)) q.location = 'cas';
  const f = defaultFormation(s, 'B');
  assert.equal(Object.keys(f).length, 2);
  assert.ok(ok(execute(s, { kind: 'setupTeam', team: 'B', positions: f })));
  const ids = Object.keys(f);
  const r = execute(s, { kind: 'setupTeam', team: 'B', positions: { [ids[0]]: c(14, 7), [ids[1]]: c(20, 7) } });
  assert.match(r.error ?? '', /all must be on the Line of Scrimmage/);
});

test('both set-ups done → kick-off; the kicker may not stand on the Line of Scrimmage and must aim at the opponent\'s half', () => {
  const s = toKickoff();
  const k = s.match!.kicking as TeamId;
  const los = s.players.find((q) => q.team === k && q.pos && (k === 'A' ? q.pos.x === 12 : q.pos.x === 13))!;
  let r = execute(s, { kind: 'kickoff', kicker: los.id, target: c(k === 'A' ? 20 : 5, 7) });
  assert.match(r.error ?? '', /not on the Line of Scrimmage/);
  r = execute(s, { kind: 'kickoff', kicker: kickerOf(s).id, target: c(k === 'A' ? 5 : 20, 7) });
  assert.match(r.error ?? '', /opponent's half/);
  r = execute(s, { kind: 'kickoff', kicker: kickerOf(s).id, target: c(k === 'A' ? 20 : 5, 7), useKick: true });
  assert.match(r.error ?? '', /Kick skill/);
});

// ---------------------------------------------------------------------------
// Kick-off
// ---------------------------------------------------------------------------

test('kick-off (introductory): Deviate D8 + D6, the ball lands and bounces; the receiving team starts Turn 1', () => {
  const s = toKickoff(); // B kicks at A's half
  // target C8 (x 2, y 7); D8 5 (right) D6 2 → x 4; lands empty → bounce D8 2 (up) → (4,6)
  const res = run(s, { kind: 'kickoff', kicker: kickerOf(s).id, target: c(2, 7) }, first, [5, 2, 2]);
  const t = ok(res);
  assert.deepEqual(t.ball, { kind: 'ground', pos: c(4, 6) });
  assert.equal(t.phase, 'play');
  assert.equal(t.turn.active, 'A');
  assert.equal(t.teams.A.turn, 1);
  assert.equal(t.teams.B.turn, 0);
  assert.ok(t.players.filter((q) => q.location === 'pitch').every((q) => q.inDrive));
  const dice = res.events.flatMap((e) => e.dice ?? []);
  assert.deepEqual(dice.map((d) => d.kind), ['d8', 'd6', 'd8']);
});

test('kick-off landing on a receiving player: Catch (no extra modifier for a kick)', () => {
  const s = toKickoff();
  const catcher = s.players.find((q) => q.team === 'A' && q.pos && q.pos.x === 9 && q.pos.y === 7)!;
  // target (9,7) directly; D8 1, D6 0 is impossible, so aim one square away: (10,7) D8 4 (left) D6 1 → (9,7); catch roll 3 vs AG 3+.
  const res = run(s, { kind: 'kickoff', kicker: kickerOf(s).id, target: c(10, 7) }, first, [4, 1, 3]);
  const t = ok(res);
  assert.deepEqual(t.ball, { kind: 'held', playerId: catcher.id });
  const catchEv = res.events.find((e) => /catches the kick-off/.test(e.text));
  assert.ok(catchEv, res.events.map((e) => e.text).join('\n'));
});

test('Touchback: the ball leaving the pitch lets the receiving coach give it to a Standing player (p.49)', () => {
  const s = toKickoff();
  // target (0,7); D8 4 (left) → off the pitch
  const res = run(s, { kind: 'kickoff', kicker: kickerOf(s).id, target: c(0, 7) }, (req) => (req.type === 'touchback' ? req.options[2].id : req.options[0].id), [4, 3]);
  const t = ok(res);
  assert.equal(t.ball.kind, 'held');
  const holder = p(t, (t.ball as { playerId: string }).playerId);
  assert.equal(holder.team, 'A');
  assert.match(res.events.map((e) => e.text).join('\n'), /Touchback/);
});

test('Touchback: a bounce across the Line of Scrimmage into the kicking half', () => {
  const s = toKickoff();
  // target (12,2) (A's half, wide zone, empty); D8 2 (up) D6 1 → (12,1); bounce D8 5 (right) → (13,1) = B's half → Touchback
  const res = run(s, { kind: 'kickoff', kicker: kickerOf(s).id, target: c(12, 2) }, first, [2, 1, 5]);
  const t = ok(res);
  assert.equal(t.ball.kind, 'held');
  assert.match(res.events.map((e) => e.text).join('\n'), /kicking team's half.*Touchback/);
});

test('Kick skill: the kick Deviates D3 instead of D6', () => {
  const s = toKickoff();
  const k = kickerOf(s);
  k.skills.push({ id: 'kick' });
  // target (4,6); D8 5 (right) D3 3 → (7,6), empty; bounce D8 2 (up) → (7,5)
  const res = run(s, { kind: 'kickoff', kicker: k.id, target: c(4, 6), useKick: true }, first, [5, 3, 2]);
  const t = ok(res);
  assert.deepEqual(res.events.flatMap((e) => e.dice ?? []).map((d) => d.kind), ['d8', 'd3', 'd8']);
  assert.deepEqual(t.ball, { kind: 'ground', pos: c(7, 5) });
});

// ---------------------------------------------------------------------------
// Kick-off Events (full rules): dice order = D8, D6 deviation, then 2D6 event
// ---------------------------------------------------------------------------

function fullKickoff(): GameState {
  return toKickoff('full', 11);
}

test('Kick-off Event 7 Brilliant Coaching: a free Team Re-roll that is lost at the end of the Drive', () => {
  const s = fullKickoff();
  const before = { A: s.teams.A.rerolls, B: s.teams.B.rerolls };
  // deviation (2,7)→ D8 5 D6 1 → (3,7) empty; event 3+4 = 7; D6 A 5, B 2 (+0 coaches) → A; bounce D8 2 → (3,6)
  const t = ok(run(s, { kind: 'kickoff', kicker: kickerOf(s).id, target: c(2, 7) }, first, [5, 1, 3, 4, 5, 2, 2]));
  assert.equal(t.teams.A.rerolls, before.A + 1);
  assert.equal(t.teams.A.bonusRerolls, 1);
  assert.equal(t.teams.B.rerolls, before.B);
  // End the half quickly: give A a touchdown-free Drive end by setting the turn markers to 8.
  t.teams.A.turn = 8;
  t.teams.B.turn = 8;
  const e = ok(run(t, { kind: 'endTurn' }));
  assert.equal(e.phase, 'halfOver');
  const n = ok(run(e, { kind: 'nextDrive' }));
  // half-time: re-rolls replenished to the roster value; the bonus is gone
  assert.equal(n.teams.A.rerolls, 3);
  assert.equal(n.teams.A.bonusRerolls, 0);
});

test('Kick-off Event 11 Dodgy Snack: the LOWEST roller is affected', () => {
  const s = fullKickoff();
  // deviation D8 5 D6 1; event 5+6 = 11; A 2, B 6 → A affected; random player 1 of 11 → first A player on the pitch; D6 4 → −1 MA/AV; bounce D8 2
  const res = run(s, { kind: 'kickoff', kicker: kickerOf(s).id, target: c(2, 7) }, first, [5, 1, 5, 6, 2, 6, 1, 4, 2]);
  const t = ok(res);
  const hit = res.events.find((e) => /Dodgy Snack: .*rolls 4/.test(e.text));
  assert.ok(hit, res.events.map((e) => e.text).join('\n'));
  const id = hit!.data?.playerId as string;
  assert.equal(p(t, id).team, 'A');
  assert.equal(p(t, id).ma, p(s, id).ma - 1);
  assert.equal(p(t, id).av, p(s, id).av - 1);
  assert.ok(t.match!.driveMods.some((m) => m.playerId === id));
});

test('Kick-off Event 12 Pitch Invasion: the lowest D6 + Fan Factor team has D3 players Stunned', () => {
  const s = fullKickoff();
  const ff = s.match!.fanFactor!;
  // A rolls 1, B rolls 6 → A lower (A 1+ff.A vs B 6+ff.B, fan factors 2-6)
  assert.ok(1 + ff.A < 6 + ff.B);
  const res = run(s, { kind: 'kickoff', kicker: kickerOf(s).id, target: c(2, 7) }, first, [5, 1, 6, 6, 1, 6, 2, 1, 1, 2]);
  const t = ok(res);
  const stunned = t.players.filter((q) => q.stance === 'stunned');
  assert.equal(stunned.length, 2);
  assert.ok(stunned.every((q) => q.team === 'A'));
});

test('Kick-off Event 3 Time-out: both Turn markers move forward (kicking team below Turn 6)', () => {
  const s = fullKickoff();
  const t = ok(run(s, { kind: 'kickoff', kicker: kickerOf(s).id, target: c(2, 7) }, first, [5, 1, 1, 2, 2]));
  // markers 0 → 1, then the receiving team starts Turn 2
  assert.equal(t.teams.B.turn, 1);
  assert.equal(t.teams.A.turn, 2);
});

test('Kick-off Event 10 Charge!: the kicking team moves before the ball lands; End ends the Charge', () => {
  const s = fullKickoff();
  const k = s.match!.kicking as TeamId;
  // deviation D8 5 D6 1; event 4+6 = 10; D3 1 → up to 4 players
  const c1 = ok(run(s, { kind: 'kickoff', kicker: kickerOf(s).id, target: c(2, 7) }, first, [5, 1, 4, 6, 1]));
  assert.equal(c1.phase, 'play');
  assert.equal(c1.turn.active, k);
  assert.equal(c1.match!.pendingPhase?.type, 'charge');
  assert.equal(c1.ball.kind, 'none');
  const mover = c1.players.find((q) => q.team === k && q.pos && q.pos.x === 21 && q.pos.y === 5)!; // B's (10,5) mirrored → (15,5)? use any open player
  const open = mover ?? c1.players.find((q) => q.team === k && q.pos && q.pos.x === 16 && q.pos.y === 7)!;
  const turnBefore = c1.teams[k].turn;
  const mv = ok(run(c1, { kind: 'playerAction', playerId: open.id, action: 'move', path: [{ to: c(open.pos!.x - 1, open.pos!.y), kind: 'step' }] }));
  assert.equal(mv.match!.pendingPhase?.type, 'charge');
  assert.deepEqual((mv.match!.pendingPhase as { activated: string[] }).activated, [open.id]);
  // Pass is not allowed during the Charge
  const other = mv.players.find((q) => q.team === k && q.location === 'pitch' && !q.activated && q.pos && q.pos.x === 17)!;
  const pass = execute(mv, { kind: 'playerAction', playerId: other.id, action: 'pass', path: [] });
  assert.equal(pass.status, 'illegal');
  // V4: one selected player may make a free Kick Team-mate (p.48): offered to a player with the Trait, other Special Actions not.
  const kicker2 = mv.players.find((q) => q.team === k && q.location === 'pitch' && !q.activated && q.pos && q.pos.x === 17 && q.id !== other.id) ?? other;
  const mvK = structuredClone(mv);
  const kp = mvK.players.find((q) => q.id === kicker2.id)!;
  kp.skills = [...kp.skills, { id: 'kickTeamMate' }, { id: 'stab' }];
  const ko = actionOptions(mvK, kp);
  assert.equal(ko.find((o) => o.action === 'special' && o.special === 'kickTeamMate')?.enabled, true, JSON.stringify(ko.find((o) => o.special === 'kickTeamMate')));
  assert.equal(ko.find((o) => o.action === 'special' && o.special === 'stab')?.enabled, false);
  // End: the ball lands (bounce D8 2), then the receiving team's Turn 1
  const end = ok(run(mv, { kind: 'endCharge' }, first, [2]));
  assert.equal(end.phase, 'play');
  assert.equal(end.turn.active, k === 'A' ? 'B' : 'A');
  assert.equal(end.teams[k].turn, turnBefore);
  assert.equal(end.match!.pendingPhase, undefined);
  assert.equal(end.ball.kind, 'ground');
});

test('Kick-off Event 4 Solid Defence: up to D3+3 kicking players set up again, still legally', () => {
  const s = fullKickoff();
  const k = s.match!.kicking as TeamId;
  const sd = ok(run(s, { kind: 'kickoff', kicker: kickerOf(s).id, target: c(2, 7) }, first, [5, 1, 1, 3, 2]));
  assert.equal(sd.phase, 'kickoff');
  assert.deepEqual(sd.match!.pendingPhase, { type: 'solidDefence', team: k, max: 5 });
  const back = sd.players.find((q) => q.team === k && q.pos && q.pos.x === 20 && q.pos.y === 6)!;
  const los = sd.players.find((q) => q.team === k && q.pos && q.pos.x === 13 && q.pos.y === 6)!;
  // Line of Scrimmage players are Marked, so they are not Open and cannot be selected
  const marked = execute(sd, { kind: 'solidDefence', positions: { [los.id]: c(15, 6) } });
  assert.match(marked.error ?? '', /not Open/);
  // the new set-up must still be legal: three players in the top Wide Zone → illegal
  const at = (x: number, y: number) => sd.players.find((q) => q.team === k && q.pos && q.pos.x === x && q.pos.y === y)!.id;
  const bad = execute(sd, { kind: 'solidDefence', positions: { [at(17, 4)]: c(17, 3), [at(15, 5)]: c(15, 2), [at(18, 7)]: c(18, 1) } });
  assert.match(bad.error ?? '', /top Wide Zone/);
  const tooMany = execute(sd, { kind: 'solidDefence', positions: { [at(17, 4)]: c(17, 5), [at(15, 5)]: c(15, 6), [at(18, 7)]: c(18, 6), [at(20, 6)]: c(21, 6), [at(20, 8)]: c(21, 8), [at(17, 10)]: c(17, 9) } });
  assert.match(tooMany.error ?? '', /at most 5/);
  const good = ok(run(sd, { kind: 'solidDefence', positions: { [back.id]: c(19, 6) } }, first, [2]));
  assert.deepEqual(p(good, back.id).pos, c(19, 6));
  assert.equal(good.phase, 'play');
});

test('Kick-off Event 9 Quick Snap: receiving players move one square, even across the halfway line', () => {
  const s = fullKickoff();
  const qs = ok(run(s, { kind: 'kickoff', kicker: kickerOf(s).id, target: c(2, 7) }, first, [5, 1, 4, 5, 1]));
  assert.equal(qs.match!.pendingPhase?.type, 'quickSnap');
  const a = qs.players.find((q) => q.team === 'A' && q.pos && q.pos.x === 10 && q.pos.y === 5)!;
  const two = execute(qs, { kind: 'quickSnap', moves: { [a.id]: c(12, 5) } });
  assert.match(two.error ?? '', /one square/);
  const t = ok(run(qs, { kind: 'quickSnap', moves: { [a.id]: c(11, 4) } }, first, [2]));
  assert.deepEqual(p(t, a.id).pos, c(11, 4));
});

// ---------------------------------------------------------------------------
// End of Drive, half-time, full time
// ---------------------------------------------------------------------------

test('Touchdown → End of Drive (KO recovery) → the scoring team kicks the next Drive', () => {
  const s = toKickoff();
  const t = ok(run(s, { kind: 'kickoff', kicker: kickerOf(s).id, target: c(0, 7) }, (req) => req.options[0].id, [4, 3]));
  const h = p(t, (t.ball as { playerId: string }).playerId);
  // put the ball carrier next to the opposition End Zone (x 25) in an empty row
  h.pos = c(24, 0);
  const ko = t.players.find((q) => q.team === 'B' && q.location === 'pitch')!;
  ko.location = 'ko';
  ko.pos = null;
  const td = ok(run(t, { kind: 'playerAction', playerId: h.id, action: 'move', path: [{ to: c(25, 0), kind: 'step' }] }));
  assert.equal(td.phase, 'touchdown');
  assert.equal(td.teams.A.score, 1);
  // End of Drive: KO recovery D6 5 → recovers
  const nd = ok(run(td, { kind: 'nextDrive' }, first, [5]));
  assert.equal(nd.phase, 'driveSetup');
  assert.equal(nd.match!.kicking, 'A');
  assert.equal(nd.match!.drive, 2);
  assert.equal(p(nd, ko.id).location, 'reserves');
  assert.ok(nd.players.every((q) => q.location !== 'pitch'));
  assert.equal(nd.ball.kind, 'none');
});

test('End of the first half → second half kicked by the team that received first; end of the second half → full time', () => {
  const s = toKickoff();
  let t = ok(run(s, { kind: 'kickoff', kicker: kickerOf(s).id, target: c(2, 7) }, first, [5, 2, 2]));
  t.teams.A.turn = 8;
  t.teams.B.turn = 8;
  t = ok(run(t, { kind: 'endTurn' }));
  assert.equal(t.phase, 'halfOver');
  t = ok(run(t, { kind: 'nextDrive' }));
  assert.equal(t.match!.half, 2);
  assert.equal(t.match!.kicking, 'A'); // A received first
  assert.equal(t.teams.A.turn, 0);
  t = ok(run(t, { kind: 'setupTeam', team: 'A', positions: defaultFormation(t, 'A') }));
  t = ok(run(t, { kind: 'setupTeam', team: 'B', positions: defaultFormation(t, 'B') }));
  const kicker = t.players.find((q) => q.team === 'A' && q.pos && q.pos.x === 9 && q.pos.y === 7)!;
  t = ok(run(t, { kind: 'kickoff', kicker: kicker.id, target: c(23, 7) }, first, [5, 1, 2]));
  assert.equal(t.turn.active, 'B');
  t.teams.A.turn = 8;
  t.teams.B.turn = 8;
  t = ok(run(t, { kind: 'endTurn' }));
  t = ok(run(t, { kind: 'nextDrive' }));
  assert.equal(t.phase, 'fullTime');
  assert.deepEqual(t.match!.result, { winner: null, score: { A: 0, B: 0 } });
  assert.equal(execute(t, { kind: 'nextDrive' }).status, 'illegal');
});

test('Apothecary (p.68): a Knocked-out player can be Patched-up to Stunned, once per game', () => {
  const b = new Pos({ rerollsA: 0 });
  b.add('A', 'orc', 'blitzer', c(10, 7), { id: 'X' });
  b.add('B', 'human', 'lineman', c(11, 7), { id: 'Y' });
  b.ball(c(2, 2));
  const s = b.start();
  s.teams.B.apothecary = 'available';
  // block die 6 (POW); armour 5+6 = 11 breaks AV 9; injury 4+4 = 8 KO; apothecary used
  const res = run(s, { kind: 'playerAction', playerId: 'X', action: 'block', path: [], blockTarget: 'Y' }, (req) => (req.type === 'apothecary' ? 'use' : req.options[0].id), [6, 5, 6, 4, 4]);
  const t = ok(res);
  assert.equal(p(t, 'Y').location, 'pitch');
  assert.equal(p(t, 'Y').stance, 'stunned');
  assert.equal(t.teams.B.apothecary, 'used');
});

// ---------------------------------------------------------------------------
// Formal position check (practice scenarios stay lenient)
// ---------------------------------------------------------------------------

test('a formal match position without a ball is rejected with an explanation; a practice scenario only warns', () => {
  const b = new Pos();
  b.add('A', 'human', 'lineman', c(10, 7));
  b.add('B', 'orc', 'lineman', c(15, 7));
  const s = b.s;
  const practice = validatePosition(s);
  assert.ok(practice.every((i) => i.level !== 'error'));
  assert.ok(practice.some((i) => /no ball/.test(i.text)));
  const formal = validateFormalStart(s);
  assert.ok(formal.some((i) => i.level === 'error' && /no ball on the pitch/.test(i.text)));
  b.ball(c(12, 7));
  assert.deepEqual(validateFormalStart(b.s).filter((i) => i.level === 'error'), []);
});

// ---------------------------------------------------------------------------
// Whole matches with random dice (smoke test of the sequence)
// ---------------------------------------------------------------------------

function playWholeMatch(seed: number, rules: 'full' | 'introductory'): GameState {
  const r = createMatch('tournament', humans(), orcs(), { rules }, seed);
  let s = r.state as GameState;
  let steps = 0;
  while (s.phase !== 'fullTime') {
    if (steps++ > 400) throw new Error(`match did not finish (phase ${s.phase})`);
    let input: ActionInput;
    const m = s.match!;
    if (s.phase === 'pregame') input = { kind: 'pregame' };
    else if (s.phase === 'driveSetup') {
      const t = (m.setupDone[m.kicking as TeamId] ? (m.kicking === 'A' ? 'B' : 'A') : m.kicking) as TeamId;
      input = { kind: 'setupTeam', team: t, positions: defaultFormation(s, t) };
    } else if (s.phase === 'kickoff' && m.pendingPhase?.type === 'solidDefence') input = { kind: 'solidDefence', positions: {} };
    else if (s.phase === 'kickoff' && m.pendingPhase?.type === 'quickSnap') input = { kind: 'quickSnap', moves: {} };
    else if (s.phase === 'kickoff') {
      const k = m.kicking as TeamId;
      const cands = s.players.filter((q) => q.team === k && q.location === 'pitch' && q.pos && q.pos.x !== (k === 'A' ? 12 : 13));
      const kicker = cands[0] ?? s.players.find((q) => q.team === k && q.location === 'pitch')!;
      input = { kind: 'kickoff', kicker: kicker.id, target: c(k === 'A' ? 20 : 5, 7) };
    } else if (s.phase === 'play' && m.pendingPhase?.type === 'charge') input = { kind: 'endCharge' };
    else if (s.phase === 'play') input = { kind: 'endTurn' };
    else input = { kind: 'nextDrive' };
    const res = run(s, input);
    assert.notEqual(res.status, 'illegal', `${input.kind}: ${res.error}`);
    s = res.state;
    assert.deepEqual(validateState(s), []);
    for (const t of ['A', 'B'] as TeamId[]) assert.ok(s.players.filter((q) => q.team === t && q.location === 'pitch').length <= 11);
    if (s.phase === 'play' && !s.match!.pendingPhase) assert.notEqual(s.ball.kind, 'none', 'the ball must be in play during Turns');
  }
  return s;
}

test('whole matches (end-turn only) run from pre-game to full time for many seeds', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const s = playWholeMatch(seed, seed % 5 === 0 ? 'introductory' : 'full');
    assert.equal(s.phase, 'fullTime');
    assert.equal(s.match!.half, 2);
    assert.ok(s.log.length > 20);
  }
});
