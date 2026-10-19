/**
 * V5.5 — Blood Bowl Sevens additions:
 *  - the Sevens exception to Insignificant (the user's choice; the optional NAF BB2025 Sevens recommendation):
 *    ignored when drafting a Sevens team, every other draft limit kept, 11-a-side unchanged; reserves play later Drives;
 *  - the Sevens Inducement list (Spike! Journal 22 p.14) with its prices and limits, the Sevens D8 Prayers to Nuffle
 *    table and the eight Desperate Measures (p.15), each checked in play.
 * Spike! 22 printed pages as "S.p.N".
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Engine from '../src/engine/index';
import {
  cloneState,
  createMatch,
  decide,
  defaultFormation,
  execute,
  inducementsFor,
  newTeamDef,
  planAction,
  playerFromRoster,
  ROSTER_BY_ID,
  ScriptedDice,
  setVeteran,
  teamCost,
  usePitch,
  validateInput,
  validateTeamDef,
  type ActionInput,
  type ExecutionResult,
  type GameState,
  type TeamDef,
  type TeamId,
} from '../src/engine/index';
import { answerDecision, bindEngine, nextMove, waitingFor } from '../src/ai/index';

bindEngine(Engine);

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
const errs = (t: TeamDef) => validateTeamDef(t).filter((i) => i.level === 'error').map((i) => i.text);
const hum7 = (extra: Partial<TeamDef> = {}) => sevensTeam('h7', 'human', [['blitzer', 2], ['catcher', 1], ['lineman', 5]], 1, extra);
const orc7 = (extra: Partial<TeamDef> = {}) => sevensTeam('o7', 'orc', [['blitzer', 2], ['bigUn', 1], ['lineman', 4]], 1, extra);
/** The reported team: 7 Snotling Linemen and four others — 11 players. */
const snot11 = () => sevensTeam('s11', 'snotling', [['lineman', 7], ['pumpWagon', 1], ['trainedTroll', 1], ['fungusFlinga', 1], ['stiltyRunna', 1]], 1);

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

// ---------------------------------------------------------------------------
// Insignificant — the Sevens exception
// ---------------------------------------------------------------------------

test('Sevens exception: a Snotling team may draft more Insignificant players than others (up to 11); 11-a-side keeps the limit', () => {
  const t = snot11();
  assert.equal(t.players.length, 11);
  assert.equal(t.players.filter((q) => q.skills.some((k) => k.id === 'insignificant')).length, 7);
  assert.deepEqual(errs(t), [], 'the reported 11-player Snotling Sevens team is legal');
  assert.ok(Engine.usesSevensInsignificantException(t));
  assert.ok(t.players.every((q) => q.positionId !== 'lineman' || q.skills.some((k) => k.id === 'insignificant')), 'the Trait stays on the players');
  assert.match(Engine.SEVENS_INSIGNIFICANT.text, /NAF/);
  assert.match(Engine.SEVENS_INSIGNIFICANT.text, /not a Games Workshop erratum/);
  // The other limits still apply.
  const five = sevensTeam('x', 'snotling', [['lineman', 6], ['pumpWagon', 2], ['trainedTroll', 1], ['fungusFlinga', 1], ['stiltyRunna', 1]], 0);
  assert.ok(errs(five).some((e) => /non-Linemen|without the Lineman/i.test(e)), `at most four non-Linemen: ${errs(five).join(' | ')}`);
  const twelve = sevensTeam('x', 'snotling', [['lineman', 12]], 0);
  assert.ok(errs(twelve).some((e) => /more than 11/.test(e)));
  const rich = sevensTeam('x', 'snotling', [['lineman', 6], ['pumpWagon', 2], ['trainedTroll', 2]], 1);
  assert.ok(errs(rich).some((e) => /600,000/.test(e)), 'the budget still applies');
  // 11-a-side: unchanged (Tournament → an error).
  const std = newTeamDef('tournament', 'snotling', 'std', 'std');
  let n = 1;
  for (const [pos, k] of [['lineman', 12], ['pumpWagon', 2]] as Array<[string, number]>) for (let i = 0; i < k; i++) std.players.push(playerFromRoster(ROSTER_BY_ID.snotling, pos, n, `std-${n++}`));
  assert.ok(errs(std).some((e) => /Insignificant/.test(e)), '11-a-side keeps the Insignificant limit');
});

test('Sevens reserves: 11 drafted, 7 set up, 4 in the Reserves Box — and a reserve plays the next Drive', () => {
  const r = createMatch('tournament', snot11(), orc7(), { rules: 'introductory' }, 3);
  assert.ok(r.ok, r.errors.join(' | '));
  let s = r.state as GameState;
  s = ok(run(s, { kind: 'pregame' }, (req) => (req.type === 'kickOrReceive' ? 'kick' : req.options[0].id)));
  const kicking = s.match!.kicking as TeamId;
  const other: TeamId = kicking === 'A' ? 'B' : 'A';
  s = ok(run(s, { kind: 'setupTeam', team: kicking, positions: defaultFormation(s, kicking) }));
  s = ok(run(s, { kind: 'setupTeam', team: other, positions: defaultFormation(s, other) }));
  const snot = s.players.filter((q) => q.team === 'A');
  assert.equal(snot.filter((q) => q.location === 'pitch').length, 7, 'seven on the pitch');
  assert.equal(snot.filter((q) => q.location === 'reserves').length, 4, 'four in the Reserves Box');
  // Next Drive: set up with two of the reserves in place of two players who played.
  const g = cloneState(s);
  g.phase = 'touchdown';
  g.touchdown = { team: 'B', playerId: g.players.find((q) => q.team === 'B')!.id, duringTeamTurn: 'B' } as GameState['touchdown'];
  g.teams.B.score = 1;
  g.teams.A.turn = 1;
  g.teams.B.turn = 1;
  let s2 = ok(run(g, { kind: 'nextDrive' }));
  assert.equal(s2.phase, 'driveSetup');
  const k2 = s2.match!.kicking as TeamId;
  if (k2 !== 'A') s2 = ok(run(s2, { kind: 'setupTeam', team: k2, positions: defaultFormation(s2, k2) }));
  const pos = defaultFormation(s2, 'A');
  const reserve = s2.players.filter((q) => q.team === 'A' && q.location === 'reserves' && !Object.entries(pos).some(([id, c]) => id === q.id && c));
  const onPitch = Object.entries(pos).filter(([, c]) => c).map(([id]) => id);
  // Swap one reserve in for one of the default seven (same square).
  const out = onPitch.find((id) => s2.players.find((q) => q.id === id)?.keywords.includes('Lineman'))!;
  const inn = reserve.find((q) => q.keywords.includes('Lineman')) ?? reserve[0];
  pos[inn.id] = pos[out];
  pos[out] = null;
  s2 = ok(run(s2, { kind: 'setupTeam', team: 'A', positions: pos }));
  assert.equal(s2.players.find((q) => q.id === inn.id)?.location, 'pitch', 'the reserve plays this Drive');
  assert.equal(s2.players.filter((q) => q.team === 'A' && q.location === 'pitch').length, 7);
});

// ---------------------------------------------------------------------------
// The Sevens Inducement list (S.p.14)
// ---------------------------------------------------------------------------

test('the Sevens Inducement list: its eleven items, Sevens limits and prices; the others refused with the reason', () => {
  const list = inducementsFor('sevens');
  const by = Object.fromEntries(list.map((d) => [d.id, d]));
  assert.deepEqual(list.map((d) => d.id).sort(), ['blitzersBestKeg', 'bribe', 'desperateMeasure', 'extraTraining', 'halflingMasterChef', 'mortuaryAssistant', 'partTimeCoach', 'plagueDoctor', 'prayer', 'tempCheerleader', 'wanderingApothecary']);
  const expect: Record<string, [number, number]> = { tempCheerleader: [2, 15000], partTimeCoach: [2, 15000], blitzersBestKeg: [2, 50000], prayer: [2, 5000], extraTraining: [6, 125000], bribe: [2, 100000], wanderingApothecary: [1, 100000], mortuaryAssistant: [1, 100000], plagueDoctor: [1, 100000], halflingMasterChef: [1, 300000], desperateMeasure: [5, 50000] };
  for (const [id, [max, cost]] of Object.entries(expect)) {
    assert.equal(by[id].max([]), max, `${id} limit`);
    assert.equal(by[id].cost([]), cost, `${id} cost`);
  }
  assert.equal(by.bribe.cost(['Bribery and Corruption']), 50000);
  assert.equal(by.halflingMasterChef.cost([], ROSTER_BY_ID.halfling), 100000);
  assert.ok(by.mortuaryAssistant.unavailable([]));
  assert.ok(by.wanderingApothecary.unavailable([], Object.values(ROSTER_BY_ID).find((r) => !r.apothecary)), 'no Wandering Apothecary for a team that cannot hire one');
  // Standard list unchanged.
  assert.equal(inducementsFor('standard').find((d) => d.id === 'prayer')!.cost([]), 10000);
  assert.ok(!inducementsFor('standard').some((d) => d.id === 'desperateMeasure'));
  // Budget accounting and validation.
  const t = hum7({ rerolls: 0, inducements: { prayer: 2, desperateMeasure: 1, tempCheerleader: 2 } });
  assert.equal(teamCost(t).inducements, 2 * 5000 + 50000 + 2 * 15000);
  assert.deepEqual(errs(t), []);
  assert.ok(errs(hum7({ inducements: { teamMascot: 1 } })).some((e) => /Team Mascot: not on the Blood Bowl Sevens Inducement list/.test(e)));
  assert.ok(errs(hum7({ inducements: { prayer: 3 } })).some((e) => /at most 2/.test(e)));
  assert.ok(errs(orc7({ inducements: { extraTraining: 1 } })).some((e) => /600,000/.test(e)), '125,000 gp more is over the budget');
  const std = Engine.newTeamDef('tournament', 'human', 's', 's');
  std.inducements = { desperateMeasure: 1 };
  assert.ok(validateTeamDef(std).some((i) => /Blood Bowl Sevens only/.test(i.text)));
  // Why the others are missing: a rules restriction, not unfinished work.
  const no = Engine.inducementsNotOffered('sevens');
  assert.ok(no.length >= 8 && no.every((x) => x.kind === 'rules'));
  assert.ok(no.some((x) => x.name === 'Star Players'));
});

/** Human: 2 Blitzers (A1, A2), a Catcher (A3), 4 Linemen — 445,000 gp, room for Inducements. */
const humCheap = (extra: Partial<TeamDef> = {}) => sevensTeam('hc', 'human', [['blitzer', 2], ['catcher', 1], ['lineman', 4]], 0, extra);
function sevensMatch(indA: Record<string, number>, indB: Record<string, number> = {}, seed = 5): GameState {
  const r = createMatch('tournament', humCheap({ inducements: indA }), orc7({ rerolls: 0, inducements: indB }), { rules: 'introductory' }, seed);
  assert.ok(r.ok, r.errors.join(' | '));
  return r.state as GameState;
}

test('Sevens Prayers to Nuffle: a D8 on the Sevens table (S.p.15), mapped to the rulebook results; Inducements take effect', () => {
  const s = sevensMatch({ prayer: 2, tempCheerleader: 2, partTimeCoach: 1, extraTraining: 0 });
  assert.equal(s.match!.cheerleaders.A, 2);
  assert.equal(s.match!.assistantCoaches.A, 1);
  // D8 3 = Iron Man (rulebook 4), then 3 again (re-rolled), then 6 = Moles under the Pitch (rulebook 9).
  const res = run(s, { kind: 'pregame' }, first, [3, 3, 6, 5, 2]);
  const g = ok(res);
  assert.deepEqual(g.match!.prayers!.A, [4, 9]);
  assert.match(texts(res), /D8 3 — Iron Man/);
  assert.match(texts(res), /D8 3 — already received/);
  assert.match(texts(res), /D8 6 — Moles under the Pitch/);
  assert.ok(res.events.some((e) => e.dice?.some((d) => d.kind === 'd8')), 'rolled with a D8');
});

test('Desperate Measures: a D8 each in the pre-game, duplicates rolled again; Magic Scroll gives a free Sports-Wizard at once', () => {
  const s = sevensMatch({ desperateMeasure: 3 });
  // D8: 8 Magic Scroll, 8 again (re-rolled), 4 Grudge Match, 5 Set Piece; then the roll-off.
  const res = run(s, { kind: 'pregame' }, first, [8, 8, 4, 5, 5, 2]);
  const g = ok(res);
  assert.deepEqual(g.match!.desperate!.A, [8, 4, 5]);
  assert.deepEqual(g.match!.desperateUsed!.A, [8]);
  assert.equal(g.match!.inducements!.A.wizard, 1, 'Magic Scroll: a free Sports-Wizard');
  assert.equal(Engine.induceLeft(g, 'A', 'wizard'), 1);
  assert.match(texts(res), /Magic Scroll/);
  assert.ok(Engine.desperateLeft(g, 'A', 'grudgeMatch') && Engine.desperateLeft(g, 'A', 'setPiece') && !Engine.desperateLeft(g, 'A', 'magicScroll'));
});

test('Hangover: before the first set-up an opposition player is chosen — they cannot be set up for Drive 1 only', () => {
  const s = sevensMatch({ desperateMeasure: 1 });
  let hung = '';
  const res = run(s, { kind: 'pregame' }, (req) => {
    if (req.type === 'desperate') {
      hung = req.options[0].id;
      return hung;
    }
    return req.options[0].id;
  }, [3, 5, 2]);
  const g = ok(res);
  assert.ok(hung.startsWith('B'));
  const p = g.players.find((q) => q.id === hung)!;
  assert.equal(p.benched, true);
  assert.equal(p.benchedWhy, 'Hangover');
  const pos = defaultFormation(g, 'B');
  if (pos[hung] === undefined || pos[hung] === null) pos[hung] = { x: 16, y: 5 };
  // The engine refuses the player in Drive 1.
  const kicking = g.match!.kicking as TeamId;
  let h = g;
  if (kicking === 'A') h = ok(run(h, { kind: 'setupTeam', team: 'A', positions: defaultFormation(h, 'A') }));
  const bad = execute(h, { kind: 'setupTeam', team: 'B', positions: { ...defaultFormation(h, 'B'), [hung]: { x: 17, y: 5 } } });
  assert.equal(bad.status, 'illegal');
  assert.match(bad.error ?? '', /Hangover/);
});

/** A Sevens match in play: A to act; `place` puts players (others in the Reserves Box); measures rolled as given. */
function inPlay(place: Record<string, [number, number, ('standing' | 'prone')?]>, desperate: Partial<Record<TeamId, number[]>>, ball: [number, number] | string = [1, 0], rerolls = 0): GameState {
  const s = cloneState(sevensMatch({}));
  usePitch(s);
  s.phase = 'play';
  s.match!.half = 1;
  s.match!.drive = 1;
  s.match!.kicking = 'B';
  for (const p of s.players) {
    const w = place[p.id];
    if (w) {
      p.location = 'pitch';
      p.pos = { x: w[0], y: w[1] };
      p.stance = w[2] ?? 'standing';
    } else {
      p.location = 'reserves';
      p.pos = null;
    }
    p.activated = false;
  }
  s.ball = typeof ball === 'string' ? { kind: 'held', playerId: ball } : { kind: 'ground', pos: { x: ball[0], y: ball[1] } };
  s.turn = { active: 'A', half: 1, used: { blitz: false, pass: false, handoff: false, foul: false, secure: false, ttm: false }, stunnedAtStart: [], activation: null } as GameState['turn'];
  s.teams.A.turn = 2;
  s.teams.B.turn = 1;
  s.teams.A.rerolls = rerolls;
  s.teams.B.rerolls = 0;
  s.match!.desperate = { A: desperate.A ?? [], B: desperate.B ?? [] };
  s.match!.desperateUsed = { A: [], B: [] };
  return s;
}

test('Grudge Match: a second Foul in the Turn, and no Sent-off for it (a double on the Armour Roll)', () => {
  const s0 = inPlay({ A1: [8, 5], A2: [8, 7], B4: [9, 5, 'prone'], B5: [9, 7, 'prone'] }, { A: [4] });
  // First Foul (ordinary): armour 2+3 = 5 holds.
  let s = ok(run(s0, { kind: 'playerAction', playerId: 'A1', action: 'foul', path: [], foulTarget: 'B4' }, first, [2, 3]));
  const second: ActionInput = { kind: 'playerAction', playerId: 'A2', action: 'foul', path: [], foulTarget: 'B5' };
  assert.ok(validateInput(s, second).some((e) => /already been declared/.test(e)), 'without Grudge Match the second Foul is refused');
  const withGrudge: ActionInput = { ...second, desperate: 'grudgeMatch' };
  assert.deepEqual(validateInput(s, withGrudge), []);
  // A natural double (4+4) breaks armour (AV 10+? Orc Lineman AV 10+: 8+1 assist... no) — the fouler stays.
  const res = run(s, withGrudge, first, [5, 5, 3, 3]);
  s = ok(res);
  assert.match(texts(res), /Grudge Match/);
  assert.match(texts(res), /cannot be Sent-off/);
  assert.equal(s.players.find((q) => q.id === 'A2')!.location, 'pitch', 'not Sent-off');
  assert.notEqual(res.status, 'turnover');
  assert.ok(!Engine.desperateLeft(s, 'A', 'grudgeMatch'), 'used');
});

test('Set Piece: the Pass is Accurate on any 2+ and caught on any 2+ — in the preview and when played', () => {
  // A3 Catcher throws to A1 3 squares away; A1 is Marked (normally −1 to catch); nobody can intercept.
  const s = inPlay({ A3: [5, 5], A1: [8, 5], B4: [5, 7], B5: [9, 5] }, { A: [5] }, 'A3');
  const input: ActionInput = { kind: 'playerAction', playerId: 'A3', action: 'pass', path: [], passTarget: { x: 8, y: 5 }, desperate: 'setPiece' };
  assert.deepEqual(validateInput(s, input), []);
  const plan = planAction(s, input as never, { followUp: true });
  assert.ok(plan.ok, plan.errors.join(' '));
  const passStep = plan.steps.find((x) => x.kind === 'pass')!;
  const catchStep = plan.steps.find((x) => x.kind === 'catch')!;
  assert.equal(passStep.target, 2);
  assert.deepEqual(passStep.mods, []);
  assert.equal(catchStep.target, 2);
  assert.deepEqual(catchStep.mods, []);
  // 5/6 × 5/6 for the throw and the catch (a failed catch may still bounce back to a team-mate: a little more).
  const pc = plan.withoutTeamRerolls?.pCompleted ?? 0;
  assert.ok(pc >= 25 / 36 - 1e-9 && pc < 25 / 36 + 0.01, `P = ${pc}`);
  // Played: pass 2 (Accurate), catch 2 (caught).
  const res = run(s, input, first, [2, 2]);
  const g = ok(res);
  assert.equal(g.ball.kind === 'held' && g.ball.playerId, 'A1');
  assert.ok(!Engine.desperateLeft(g, 'A', 'setPiece'));
  // Without it the same rolls fail.
  const plain = run(s, { ...input, desperate: undefined } as ActionInput, first, [2, 1, 1, 1, 1, 1, 1]);
  assert.notEqual(plain.state.ball.kind === 'held' && plain.state.ball.playerId, 'A1');
});

test('Razzle-Dazzle: a Block and then a Move in one activation; not two Actions with a Move; only once', () => {
  const s0 = inPlay({ A1: [8, 5], B4: [9, 5], B5: [15, 9] }, { A: [2] });
  assert.ok(validateInput(s0, { kind: 'playerAction', playerId: 'A1', action: 'move', path: [], desperate: 'razzleDazzle' }).length === 0);
  // Block with Razzle-Dazzle: Push (face 3), follow up.
  let s = ok(run(s0, { kind: 'playerAction', playerId: 'A1', action: 'block', path: [], blockTarget: 'B4', desperate: 'razzleDazzle' }, (req) => req.options[0].id, [3, 3]));
  assert.ok(s.turn.activation && s.turn.activation.playerId === 'A1', 'the activation stays open for the second Action');
  const opts = Engine.actionOptions(s, s.players.find((q) => q.id === 'A1')!);
  assert.ok(opts.some((o) => o.action === 'move' && o.enabled && /second Action/.test(o.label)));
  assert.ok(!opts.some((o) => o.action === 'block' && /second Action/.test(o.label)), 'not the same Action twice');
  const at = s.players.find((q) => q.id === 'A1')!.pos!;
  const mv: ActionInput = { kind: 'playerAction', playerId: 'A1', action: 'move', path: [{ to: { x: at.x, y: at.y - 1 }, kind: 'step' }] };
  s = ok(run(s, mv, first, [6, 6, 6]));
  assert.equal(s.turn.activation?.razzle?.second, 'move');
  // No third Action.
  assert.ok(validateInput(s, { kind: 'playerAction', playerId: 'A1', action: 'blitz', path: [], blitzTarget: 'B5' }).length > 0);
  // Two Actions with a Move are refused.
  assert.match(Engine.razzlePairReason('move', 'pass') ?? '', /both contain a Move/);
  assert.equal(Engine.razzlePairReason('block', 'blitz'), null);
  assert.ok(!Engine.desperateLeft(s, 'A', 'razzleDazzle'));
});

test('Discarded Banana Skin: an opponent entering a Tackle Zone is Placed Prone, activation over; a Turnover only with the ball', () => {
  // B (the defending team) has the measure; A1 walks next to B4.
  const s0 = inPlay({ A1: [5, 5], A2: [3, 3], B4: [8, 5] }, { B: [7] });
  const mv: ActionInput = { kind: 'playerAction', playerId: 'A1', action: 'move', path: [{ to: { x: 6, y: 5 }, kind: 'step' }, { to: { x: 7, y: 5 }, kind: 'step' }] };
  const asked: string[] = [];
  const res = run(s0, mv, (req) => {
    if (req.type === 'desperate') {
      asked.push(`${req.team}:${req.context?.measure}`);
      return 'use';
    }
    return req.options[0].id;
  });
  const s = ok(res);
  assert.deepEqual(asked, ['B:bananaSkin'], 'asked once, of the defending team, when A1 entered the Tackle Zone');
  const a1 = s.players.find((q) => q.id === 'A1')!;
  assert.deepEqual(a1.pos, { x: 7, y: 5 });
  assert.equal(a1.stance, 'prone');
  assert.equal(res.status, 'completed', 'no Turnover without the ball');
  assert.ok(!Engine.desperateLeft(s, 'B', 'bananaSkin'));
  // With the ball: a Turnover.
  const s1 = inPlay({ A1: [5, 5], B4: [8, 5] }, { B: [7] }, 'A1');
  const r1 = run(s1, mv, (req) => (req.type === 'desperate' ? 'use' : req.options[0].id), [1, 1, 1, 1]);
  assert.equal(r1.status, 'turnover');
  // The computer uses it on a ball carrier, not on an ordinary step.
  const req = { id: '1:desperate', type: 'desperate' as const, team: 'B' as TeamId, prompt: '', options: [{ id: 'no', label: '' }, { id: 'use', label: '' }], context: { measure: 'bananaSkin', playerId: 'A1' } };
  const holder = cloneState(s1);
  assert.equal(answerDecision(holder, req, 'B', 'balanced').optionId, 'use');
  assert.equal(answerDecision(s0, req, 'B', 'balanced').optionId, 'no');
});

test('Sports Espionage: after a Turnover the team gains two Team Re-rolls', () => {
  // A1 dodges out of B4's Tackle Zone and fails (1): Turnover → Sports Espionage asked.
  const s0 = inPlay({ A1: [8, 5], B4: [9, 5] }, { A: [6] });
  const res = run(s0, { kind: 'playerAction', playerId: 'A1', action: 'move', path: [{ to: { x: 7, y: 5 }, kind: 'step' }] }, (req) => (req.type === 'desperate' ? 'use' : req.options[0].id), [1, 2, 3, 4, 5, 6, 1, 1]);
  assert.equal(res.status, 'turnover');
  const s = res.state;
  assert.equal(s.teams.A.rerolls, 2);
  assert.match(texts(res), /Sports Espionage/);
  assert.ok(!Engine.desperateLeft(s, 'A', 'sportsEspionage'));
});

test('You Dope!: before the kick-off a player gains ST +1; at the end of a Drive they took part in, 1-2 Knocks them Out (no recovery then)', () => {
  let s = sevensMatch({ desperateMeasure: 1 });
  s = ok(run(s, { kind: 'pregame' }, first, [1, 5, 2]));
  assert.deepEqual(s.match!.desperate!.A, [1]);
  const kicking = s.match!.kicking as TeamId;
  const recv: TeamId = kicking === 'A' ? 'B' : 'A';
  s = ok(run(s, { kind: 'setupTeam', team: kicking, positions: defaultFormation(s, kicking) }));
  s = ok(run(s, { kind: 'setupTeam', team: recv, positions: defaultFormation(s, recv) }));
  const target = s.players.find((q) => q.team === 'A' && q.location === 'pitch' && q.position === 'Human Blitzer')!;
  const kicker = Engine.kickerCandidates(s, kicking)[0];
  const tgt = s.players.filter((q) => q.team === recv && q.location === 'pitch')[0].pos!;
  let picked = false;
  const res = run(s, { kind: 'kickoff', kicker: kicker.id, target: tgt }, (req) => {
    if (req.type === 'desperate' && req.context?.measure === 'youDope') {
      picked = true;
      return target.id;
    }
    if (req.type === 'desperate' && req.context?.measure === 'youDopeStat') return 'st';
    return req.options[0].id;
  });
  const g = ok(res);
  assert.ok(picked, 'asked after both set-ups, before the kick');
  const t2 = g.players.find((q) => q.id === target.id)!;
  assert.equal(t2.st, target.st + 1);
  assert.equal(t2.doped, 'st');
  // End of the Drive: D6 1 — Knocked-out, no recovery roll this time.
  const e = cloneState(g);
  e.phase = 'touchdown';
  e.touchdown = { team: 'A', playerId: target.id, duringTeamTurn: 'A' } as GameState['touchdown'];
  e.teams.A.score = 1;
  e.teams.A.turn = 1;
  e.teams.B.turn = 1;
  const end = run(e, { kind: 'nextDrive' }, first, [1, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6]);
  const g2 = ok(end);
  assert.equal(g2.players.find((q) => q.id === target.id)!.location, 'ko');
  assert.match(texts(end), /You Dope!.*Knocked-out/);
  assert.ok(!/Recover .*#\d+ .*Blitzer/.test(texts(end).split('\n').filter((l) => l.includes(t2.name)).join('\n')), 'no recovery roll for them at this End of Drive');
});

test('whole Sevens matches with the Sevens Inducements and five Desperate Measures each: the computer plays them legally to full time', () => {
  for (const seed of [1, 2, 3]) {
    const r = createMatch('tournament', humCheap({ inducements: { desperateMeasure: 2, prayer: 2, tempCheerleader: 2 } }), sevensTeam('o5', 'orc', [['blitzer', 1], ['lineman', 6]], 0, { inducements: { desperateMeasure: 3, prayer: 2 } }), { rules: 'full' }, seed);
    assert.ok(r.ok, r.errors.join(' | '));
    let s = r.state as GameState;
    let used = 0;
    for (let i = 0; i < 3000 && s.phase !== 'fullTime'; i++) {
      const w = waitingFor(s);
      let input: ActionInput | null = null;
      if (!w) input = s.phase === 'pregame' ? { kind: 'pregame' } : s.phase === 'touchdown' || s.phase === 'halfOver' ? { kind: 'nextDrive' } : null;
      if (!w && !input) break;
      if (w) {
        const mv = nextMove(s, w, 'balanced');
        if (!mv) throw new Error('no move');
        if (mv.type === 'decision') {
          const res = decide(s, { requestId: mv.requestId, optionId: mv.optionId });
          assert.notEqual(res.status, 'illegal', res.error);
          s = res.state;
          continue;
        }
        input = mv.input;
        assert.deepEqual(validateInput(s, input), [], JSON.stringify(input).slice(0, 160));
        if (input.kind === 'playerAction' && input.desperate) used++;
      }
      const res = execute(s, input as ActionInput);
      assert.notEqual(res.status, 'illegal', res.error);
      s = res.state;
    }
    assert.equal(s.phase, 'fullTime', `seed ${seed}: full time`);
    assert.equal(s.match!.desperate!.A.length, 2);
    assert.equal(s.match!.desperate!.B.length, 3);
    void used;
  }
});
