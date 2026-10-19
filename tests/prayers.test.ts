/**
 * V5 step 4: Prayers to Nuffle (Inducement 0-3 at 10,000 gp, p.142; D16 table p.143).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Engine from '../src/engine/index';
import {
  createMatch,
  decide,
  defaultFormation,
  execute,
  INDUCEMENT_BY_ID,
  newTeamDef,
  planAction,
  playerFromRoster,
  ROSTER_BY_ID,
  ScriptedDice,
  validateInput,
  validateState,
  type ActionInput,
  type ExecutionResult,
  type GameState,
  type PlayerActionInput,
  type TeamDef,
  type TeamId,
} from '../src/engine/index';
import { bindEngine, nextMove, waitingFor } from '../src/ai/index';
import { c, p } from './helpers';

bindEngine(Engine);

const texts = (r: { events: { text: string }[] }) => r.events.map((e) => e.text).join('\n');

function team(id: string, rosterId: string, comp: Array<[string, number]>, prayers = 0): TeamDef {
  const t = newTeamDef('tournament', rosterId, `${rosterId} ${id}`, id);
  let n = 1;
  for (const [pos, k] of comp) for (let i = 0; i < k; i++) t.players.push(playerFromRoster(ROSTER_BY_ID[rosterId], pos, n, `${id}-${n++}`));
  t.rerolls = 1;
  if (prayers) t.inducements = { prayer: prayers };
  return t;
}
const HUM = (k = 0) => team('hum', 'human', [['lineman', 9], ['blitzer', 2]], k);
const ORC = (k = 0) => team('orc', 'orc', [['lineman', 9], ['bigUn', 2]], k);

function run(s: GameState, input: ActionInput, answer: (req: NonNullable<ExecutionResult['decision']>) => string = (q) => q.options[0].id, faces?: number[]): ExecutionResult {
  const dice = faces ? () => new ScriptedDice(faces) : undefined;
  let res = execute(s, input, undefined, dice);
  let g = 0;
  while (res.status === 'awaitingDecision' && res.decision) {
    if (g++ > 80) throw new Error('too many decisions');
    res = decide(res.state, { requestId: res.decision.id, optionId: answer(res.decision) }, dice);
  }
  return res;
}

function toPlay(a: TeamDef, b: TeamDef, seed: number): GameState {
  const r = createMatch('tournament', a, b, { rules: 'full' }, seed);
  assert.ok(r.ok, r.errors.join('\n'));
  let s = r.state as GameState;
  for (let g = 0; !(s.phase === 'play' && !s.match!.pendingPhase); g++) {
    assert.ok(g < 40, `stuck in ${s.phase}`);
    const m = s.match!;
    let input: ActionInput;
    if (s.phase === 'pregame') input = { kind: 'pregame' };
    else if (s.phase === 'driveSetup') {
      const t = (m.setupDone[m.kicking as TeamId] ? (m.kicking === 'A' ? 'B' : 'A') : m.kicking) as TeamId;
      input = { kind: 'setupTeam', team: t, positions: defaultFormation(s, t) };
    } else if (s.phase === 'kickoff' && m.pendingPhase?.type === 'solidDefence') input = { kind: 'solidDefence', positions: {} };
    else if (s.phase === 'kickoff' && m.pendingPhase?.type === 'quickSnap') input = { kind: 'quickSnap', moves: {} };
    else if (s.phase === 'kickoff') {
      const k = m.kicking as TeamId;
      const kicker = s.players.find((q) => q.team === k && q.location === 'pitch' && q.pos && q.pos.x !== (k === 'A' ? 12 : 13))!;
      input = { kind: 'kickoff', kicker: kicker.id, target: c(k === 'A' ? 20 : 5, 7) };
    } else if (s.phase === 'play' && m.pendingPhase?.type === 'charge') input = { kind: 'endCharge' };
    else input = { kind: 'nextDrive' };
    const res = run(s, input);
    assert.notEqual(res.status, 'illegal', `${input.kind}: ${res.error}`);
    s = res.state;
  }
  return s;
}

/** Clear the area around (6..8, 3) and put two players there. */
function faceOff(s: GameState, aId: string, bId: string, bStance: 'standing' | 'prone' = 'standing'): void {
  for (const q of s.players) if (q.pos && q.id !== aId && q.id !== bId && Math.abs(q.pos.x - 7) <= 3 && Math.abs(q.pos.y - 3) <= 3) (q.location = 'reserves'), (q.pos = null);
  const a = p(s, aId);
  const b = p(s, bId);
  a.pos = c(6, 3);
  b.pos = c(7, 3);
  a.location = b.location = 'pitch';
  a.stance = 'standing';
  b.stance = bStance;
  if (s.ball.kind === 'held' && (s.ball.playerId === aId || s.ball.playerId === bId)) s.ball = { kind: 'ground', pos: c(20, 12) };
  s.match!.cheering = undefined;
}

test('Prayer to Nuffle: 10,000 gp, 0-3, any team (p.142)', () => {
  const d = INDUCEMENT_BY_ID.prayer;
  assert.deepEqual([d.cost([]), d.max([]), d.unavailable([])], [10000, 3, null]);
  assert.equal(Engine.PRAYERS[1].name, 'Treacherous Trapdoor');
  assert.equal(Engine.PRAYERS[16].name, 'Intensive Training');
  assert.equal(Object.keys(Engine.PRAYERS).length, 16);
});

test('pre-game: a D16 per Prayer, a result already received is rolled again; Stiletto and Blessing of Nuffle pick random players', () => {
  const r = createMatch('tournament', HUM(3), ORC(), { rules: 'full' }, 1);
  // D16 3 (Stiletto) → D11 2; D16 3 again (re-rolled) → 8 (Blessing) → D11 5; D16 14 (Throw a Rock);
  // then Fan Factor D3 D3, Weather 2D6, roll-off 6 v 1.
  const res = run(r.state!, { kind: 'pregame' }, (q) => q.options[0].id, [3, 2, 3, 8, 5, 14, 2, 2, 3, 4, 6, 1]);
  assert.notEqual(res.status, 'illegal', res.error);
  const t = texts(res);
  assert.match(t, /D16 3 — Stiletto/);
  assert.match(t, /D16 3 — already received, rolled again/);
  assert.match(t, /D16 8 — Blessing of Nuffle/);
  assert.match(t, /D16 14 — Throw a Rock/);
  assert.deepEqual(res.state.match!.prayers!.A, [3, 8, 14]);
  assert.deepEqual(res.state.match!.prayers!.B, []);
  const a = res.state.players.filter((q) => q.team === 'A');
  assert.ok(a[1].skills.some((k) => k.id === 'stab'), 'D11 2 → the second player gains Stab');
  assert.ok(a[4].skills.some((k) => k.id === 'pro'), 'D11 5 → the fifth player gains Pro');
  assert.deepEqual(validateState(res.state), []);
});

test('Iron Man and Knuckle Dusters (chosen player), Bad Habits (D3 random opponents: Loner (2+)), Greasy Cleats (MA −1), Intensive Training (a chosen Primary skill)', () => {
  const r = createMatch('tournament', HUM(3), ORC(2), { rules: 'full' }, 1);
  const picks: string[] = [];
  const answer = (q: NonNullable<ExecutionResult['decision']>) => {
    if (q.type === 'prayerPick') {
      picks.push(q.prompt);
      if (/Intensive Training/.test(q.prompt)) return q.options.find((o) => /Dodge|Block/.test(o.label))?.id ?? q.options[0].id;
      return q.options[q.options.length - 1].id;
    }
    return q.options[0].id;
  };
  // Humans: 4 Iron Man (chosen), 5 Knuckle Dusters (chosen), 16 Intensive Training → D11 1, skill chosen.
  // Orcs: 6 Bad Habits → D3 2 → D11 3, D10 1; 7 Greasy Cleats → D11 4.
  const res = run(r.state!, { kind: 'pregame' }, answer, [4, 5, 16, 1, 6, 2, 3, 1, 7, 4, 2, 2, 3, 4, 6, 1]);
  assert.notEqual(res.status, 'illegal', res.error);
  const t = texts(res);
  assert.match(t, /Iron Man: .* has AV 10\+ for the game/);
  assert.match(t, /Knuckle Dusters: .* gains Mighty Blow/);
  assert.match(t, /Intensive Training: .* gains (Block|Dodge|[A-Z][a-z]+)/);
  const hum = res.state.players.filter((q) => q.team === 'A');
  const orc = res.state.players.filter((q) => q.team === 'B');
  assert.equal(hum.filter((q) => q.av === 10).length, 1);
  assert.equal(hum.filter((q) => q.skills.some((k) => k.id === 'mightyBlow')).length, 1);
  // The Orcs' Prayers hit the Humans (their opposition).
  assert.equal(hum.filter((q) => q.skills.some((k) => k.id === 'loner' && k.value === 2)).length, 2, t);
  assert.equal(orc.filter((q) => q.skills.some((k) => k.id === 'loner')).length, 0);
  assert.match(t, /Greasy Cleats: #4 Human Lineman has MA 5 for the game/);
  assert.equal(picks.length, 3);
});

test('Moles under the Pitch (9): opposition Rushes at −1; Friends with the Ref (2): Argue the Call keeps the player on a 5', () => {
  const s0 = toPlay(HUM(), ORC(), 3);
  const s = structuredClone(s0);
  s.match!.prayers = { A: [9, 2], B: [] };
  s.turn.active = 'B';
  const orc = s.players.find((q) => q.team === 'B' && q.location === 'pitch' && q.pos!.x > 14)!;
  for (const q of s.players) if (q.pos && q.id !== orc.id && Math.abs(q.pos.x - orc.pos!.x) <= 7 && Math.abs(q.pos.y - orc.pos!.y) <= 2) (q.location = 'reserves'), (q.pos = null);
  if (s.ball.kind === 'held') s.ball = { kind: 'ground', pos: c(1, 1) };
  const path = Array.from({ length: orc.ma + 1 }, (_, i) => ({ to: { x: orc.pos!.x + (i + 1) * (orc.pos!.x < 20 ? 1 : -1), y: orc.pos!.y }, kind: 'step' as const }));
  const plan = planAction(s, { kind: 'playerAction', playerId: orc.id, action: 'move', path });
  assert.ok(plan.steps.some((st) => st.mods.some((m) => /Moles under the Pitch/.test(m.label))), JSON.stringify(plan.steps.map((x) => x.mods)));
  assert.ok(Math.abs(Engine.rushChance(s, orc) - 4 / 6) < 1e-9, 'Rush needs 3+ instead of 2+');
  // Friends with the Ref: the Humans foul (armour 4+4 double, holds), argue with a 5 → stays.
  const s2 = structuredClone(s0);
  s2.match!.prayers = { A: [2], B: [] };
  s2.turn.active = 'A';
  const f = s2.players.find((q) => q.team === 'A' && q.location === 'pitch')!;
  const v = s2.players.find((q) => q.team === 'B' && q.location === 'pitch')!;
  faceOff(s2, f.id, v.id, 'prone');
  const r = run(s2, { kind: 'playerAction', playerId: f.id, action: 'foul', path: [], foulTarget: v.id }, (q) => (q.type === 'argueTheCall' ? 'yes' : q.options[0].id), [4, 4, 5]);
  assert.equal(p(r.state, f.id).location, 'pitch', texts(r));
});

test('Under Scrutiny (15): an opposition fouler who breaks armour is Sent-off without a double', () => {
  const s0 = toPlay(HUM(), ORC(), 5);
  const s = structuredClone(s0);
  s.match!.prayers = { A: [15], B: [] };
  s.turn.active = 'B';
  const f = s.players.find((q) => q.team === 'B' && q.location === 'pitch')!;
  const v = s.players.find((q) => q.team === 'A' && q.location === 'pitch')!;
  faceOff(s, f.id, v.id, 'prone');
  // Armour 6+5 = 11 vs AV 9: broken, not a double; Injury 3+2 Stunned; no Argue.
  const r = run(s, { kind: 'playerAction', playerId: f.id, action: 'foul', path: [], foulTarget: v.id }, (q) => (q.type === 'argueTheCall' ? 'no' : q.options[0].id), [6, 5, 3, 2]);
  assert.match(texts(r), /Under Scrutiny \(Prayer to Nuffle\): the fouler broke armour and is Sent-off/);
  assert.equal(p(r.state, f.id).location, 'sentOff');
  assert.equal(r.status, 'turnover');
});

test('Throw a Rock (14): once per game at the start of your Turn — a random opposition player, 4+ Knocked Down', () => {
  const s0 = toPlay(HUM(), ORC(), 7);
  const s = structuredClone(s0);
  s.match!.prayers = { A: [14], B: [] };
  s.turn.active = 'A';
  s.turn.activation = null;
  for (const q of s.players) q.activated = false;
  const opp = s.players.filter((q) => q.team === 'B' && q.location === 'pitch').sort((a, b) => a.number - b.number);
  assert.deepEqual(validateInput(s, { kind: 'throwARock', team: 'A' }), []);
  assert.match(validateInput(s, { kind: 'throwARock', team: 'B' }).join(), /did not receive Throw a Rock/);
  // D(n) 1 → the first opposition player; D6 5 → Knocked Down (armour 2+2 holds).
  const r = run(s, { kind: 'throwARock', team: 'A' }, undefined, [1, 5, 2, 2]);
  assert.notEqual(r.status, 'illegal', r.error);
  assert.match(texts(r), /Throw a Rock .*: D\d+ 1 — .*; D6 5 — the rock hits: Knocked Down/);
  assert.notEqual(p(r.state, opp[0].id).stance, 'standing');
  assert.equal(r.state.turn.active, 'A', 'no Turnover');
  assert.match(validateInput(r.state, { kind: 'throwARock', team: 'A' }).join(), /once per game/);
  // Not after a player was activated.
  const s2 = structuredClone(s);
  s2.players.find((q) => q.team === 'A' && q.location === 'pitch')!.activated = true;
  assert.match(validateInput(s2, { kind: 'throwARock', team: 'A' }).join(), /before any player is activated/);
});

test('Treacherous Trapdoor (1): entering a Trapdoor square (6,1 / 19,13 on the standard pitch), D6 1 → falls through (Crowd injury), Turnover', () => {
  assert.deepEqual(Engine.trapdoors({ variant: undefined } as unknown as GameState), [c(6, 1), c(19, 13)]);
  const s0 = toPlay(HUM(), ORC(), 9);
  const s = structuredClone(s0);
  s.match!.prayers = { A: [], B: [1] };
  s.turn.active = 'A';
  const h = s.players.find((q) => q.team === 'A' && q.location === 'pitch')!;
  for (const q of s.players) if (q.pos && q.id !== h.id && Math.abs(q.pos.x - 6) <= 3 && Math.abs(q.pos.y - 1) <= 3) (q.location = 'reserves'), (q.pos = null);
  h.pos = c(6, 2);
  h.stance = 'standing';
  s.ball = { kind: 'held', playerId: h.id };
  const mv: PlayerActionInput = { kind: 'playerAction', playerId: h.id, action: 'move', path: [{ to: c(6, 1), kind: 'step' }] };
  // Trapdoor D6 1 → falls: crowd Injury 3+3 = 6 → Reserves (Stunned by the crowd); the ball bounces from (6,1): D8 5.
  const r = run(s, mv, undefined, [1, 3, 3, 5]);
  assert.notEqual(r.status, 'illegal', r.error);
  assert.match(texts(r), /Treacherous Trapdoor in G2: .* rolls 1 — the Trapdoor falls open!/);
  assert.equal(p(r.state, h.id).location, 'reserves');
  assert.equal(r.status, 'turnover');
  assert.equal(r.state.ball.kind, 'ground');
  // D6 2+: it holds.
  const r2 = run(s, mv, undefined, [4]);
  assert.match(texts(r2), /rolls 4 — it holds/);
  assert.deepEqual(p(r2.state, h.id).pos, c(6, 1));
  // No Treacherous Trapdoor Prayer: no roll at all.
  const s3 = structuredClone(s);
  s3.match!.prayers = { A: [], B: [] };
  assert.doesNotMatch(texts(run(s3, mv, undefined, [])), /Trapdoor/);
});

test('computer v computer with Prayers to Nuffle: legal inputs; the computer throws its rock', () => {
  const cr = createMatch('tournament', HUM(3), ORC(3), { rules: 'full' }, 41);
  let s = cr.state as GameState;
  let steps = 0;
  while (s.match!.half === 1 && s.phase !== 'fullTime' && steps < 3000) {
    steps++;
    const who = waitingFor(s);
    let res: ExecutionResult;
    if (!who) res = execute(s, s.phase === 'pregame' ? { kind: 'pregame' } : { kind: 'nextDrive' });
    else {
      const mv = nextMove(s, who, 'balanced', { maxExplored: 6 });
      assert.ok(mv, `no move in ${s.phase}`);
      if (mv!.type === 'decision') res = decide(s, { requestId: mv!.requestId, optionId: mv!.optionId });
      else {
        assert.deepEqual(validateInput(s, mv!.input), [], JSON.stringify(mv!.input).slice(0, 200));
        res = execute(s, mv!.input);
      }
    }
    assert.notEqual(res.status, 'illegal', res.error);
    s = res.state;
  }
  assert.deepEqual(validateState(s), []);
  assert.equal(s.match!.prayers!.A.length, 3);
  assert.equal(s.match!.prayers!.B.length, 3);
  const log = s.log.flatMap((e) => e.events.map((v) => v.text)).join('\n');
  for (const t of ['A', 'B'] as TeamId[]) if (s.match!.prayers![t].includes(14)) assert.match(log, new RegExp(`Throw a Rock \\(${s.teams[t].name}\\)`));
});
