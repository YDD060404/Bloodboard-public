/**
 * V5 step 6, item 3: the Sports-Wizard (Inducement, rulebook p.149) — buying it, when it may cast, Fireball, Zap!,
 * the Frog, the previews and the computer's decision.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Engine from '../src/engine/index';
import {
  createMatch,
  decide,
  defaultFormation,
  execute,
  exploreOutcomes,
  newTeamDef,
  playerFromRoster,
  ROSTER_BY_ID,
  ScriptedDice,
  validateInput,
  validateState,
  validateTeamDef,
  wizardReason,
  zapChance,
  type ActionInput,
  type ExecutionResult,
  type GameState,
  type TeamDef,
  type TeamId,
} from '../src/engine/index';
import { bindEngine, wizardChoice } from '../src/ai/index';
import { c, p } from './helpers';

bindEngine(Engine);

const texts = (r: { events: { text: string }[] }) => r.events.map((e) => e.text).join('\n');
const errs = (t: TeamDef) => validateTeamDef(t).filter((i) => i.level === 'error').map((i) => i.text);

function team(id: string, rosterId: string, pos: string, n: number, ind?: Record<string, number>): TeamDef {
  const t = newTeamDef('tournament', rosterId, `${rosterId} ${id}`, id);
  for (let i = 1; i <= n; i++) t.players.push(playerFromRoster(ROSTER_BY_ID[rosterId], pos, i, `${id}-${i}`));
  t.rerolls = 1;
  if (ind) t.inducements = ind;
  return t;
}

function run(s: GameState, input: ActionInput, faces?: number[], answer: (req: NonNullable<ExecutionResult['decision']>) => string = (q) => q.options[0].id): ExecutionResult {
  const dice = faces ? () => new ScriptedDice(faces) : undefined;
  let res = execute(s, input, undefined, dice);
  let g = 0;
  while (res.status === 'awaitingDecision' && res.decision) {
    assert.ok(g++ < 40, 'too many decisions');
    res = decide(res.state, { requestId: res.decision.id, optionId: answer(res.decision) }, dice);
  }
  return res;
}

/** A Human team with a Sports-Wizard against Orcs, to the first Turn of the match. */
function toPlay(seed = 7): GameState {
  const r = createMatch('tournament', team('h', 'human', 'lineman', 11, { wizard: 1 }), team('o', 'orc', 'lineman', 11), { rules: 'full' }, seed);
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

/** The first Turn played out (ended), so the gap between two Turns is open, with Team A to act next. */
function between(seed = 7): GameState {
  let s = toPlay(seed);
  let g = 0;
  while (!(s.turn.active === 'A' && s.turn.betweenTurns)) {
    assert.ok(g++ < 4);
    s = run(s, { kind: 'endTurn' }).state;
  }
  return s;
}

/** Move a player to a square (tests only). */
function place(s: GameState, id: string, x: number, y: number, stance: 'standing' | 'prone' | 'stunned' = 'standing') {
  const q = p(s, id);
  q.location = 'pitch';
  q.pos = { x, y };
  q.stance = stance;
}

test('buying it (p.149): 150,000 gp, 0-1, any Blood Bowl team; not in the Sevens Inducement list', () => {
  const d = Engine.INDUCEMENT_BY_ID.wizard;
  assert.equal(d.cost([]), 150000);
  assert.equal(d.max([]), 1);
  assert.equal(d.page, 149);
  const t = team('h', 'human', 'lineman', 11, { wizard: 1 });
  assert.deepEqual(errs(t), []);
  assert.equal(Engine.teamCost(t).inducements, 150000);
  t.inducements = { wizard: 2 };
  assert.ok(errs(t).some((e) => /Sports-Wizard/.test(e) && /at most 1|0-1|limit/i.test(e)), errs(t).join(' | '));
  const sev = newTeamDef('tournament', 'human', 'Sevens', 'sv');
  sev.variant = 'sevens';
  sev.inducements = { wizard: 1 };
  assert.ok(errs(sev).some((e) => /Inducement/i.test(e)), 'a Sevens team cannot buy it');
});

test('when (p.149): at the end of a Turn, before the next begins — not in the first Turn of a Drive, not after an activation, once per game', () => {
  const s0 = toPlay();
  assert.match(wizardReason(s0, 'A') ?? '', /end of a Turn/);
  const s = between();
  assert.equal(wizardReason(s, 'A'), null, 'after a Turn ended: open (it is A to act)');
  assert.match(wizardReason(s, 'B') ?? '', /no Sports-Wizard/);
  // The other coach may cast in the same gap: here the Humans at the start of the Orcs' Turn.
  let t = run(s, { kind: 'endTurn' }).state;
  assert.equal(t.turn.active, 'B');
  assert.equal(wizardReason(t, 'A'), null, 'the Humans may cast at the end of their own Turn');
  // Once a player of the new Turn is activated, the gap is over.
  const orc = t.players.find((q) => q.team === 'B' && q.location === 'pitch')!;
  t = run(t, { kind: 'playerAction', playerId: orc.id, action: 'move', path: [] }).state;
  assert.match(wizardReason(t, 'A') ?? '', /end of a Turn/);
  // Illegal choices.
  assert.match(validateInput(s, { kind: 'wizard', team: 'A', spell: 'fireball', square: c(40, 3) }).join(), /square on the pitch/);
  assert.match(validateInput(s, { kind: 'wizard', team: 'A', spell: 'zap', target: 'nobody' }).join(), /player on the pitch/);
});

test("Fireball: a D6 for each player in or next to the square, 4+ hit; Standing → Knocked Down, +1 Armour; Prone → Armour Roll +1; no Turnover", () => {
  const s = between();
  const a = s.players.find((q) => q.team === 'A' && q.location === 'pitch')!;
  const [b1, b2] = s.players.filter((q) => q.team === 'B' && q.location === 'pitch');
  place(s, a.id, 2, 2);
  place(s, b1.id, 3, 2);
  place(s, b2.id, 4, 3, 'prone');
  s.ball = { kind: 'ground', pos: c(20, 12) };
  const input: ActionInput = { kind: 'wizard', team: 'A', spell: 'fireball', square: c(3, 2) };
  assert.deepEqual(validateInput(s, input), []);
  // D6: A 4 (hit), B1 3 (misses), B2 6 (hit); A: Armour 4+4 +1 = 9 vs AV 9 broken, Injury 2+2 Stunned; B2: Armour 2+2 +1 = 5 holds.
  const r = run(s, input, [4, 3, 6, 4, 4, 2, 2, 2, 2]);
  assert.equal(r.status, 'completed', r.error);
  const t = texts(r);
  assert.match(t, /casts a Fireball at/);
  assert.match(t, /Armour Roll for .*4\+4=8 \+1 Fireball vs AV 9\+ — armour broken/);
  assert.equal(p(r.state, a.id).stance, 'stunned', 'the Human is Knocked Down and Stunned');
  assert.equal(p(r.state, b1.id).stance, 'standing', 'the Orc on a 3 avoids it');
  assert.equal(p(r.state, b2.id).stance, 'prone');
  assert.match(t, /Armour Roll for .*2\+2=4 \+1 Fireball vs AV 10\+ — armour holds/);
  assert.ok(!r.events.some((e) => e.type === 'turnover'), 'no Turnover');
  assert.equal(r.state.turn.active, s.turn.active);
  assert.match(wizardReason(r.state, 'A') ?? '', /once per game/);
  assert.deepEqual(validateState(r.state), []);
});

test('Zap!: D6 ≥ ST or a 6 → a Frog (never a natural 1); the ball Bounces; back to normal at the end of the Drive', () => {
  const s = between();
  const b = s.players.find((q) => q.team === 'B' && q.location === 'pitch')!;
  place(s, b.id, 18, 12);
  s.ball = { kind: 'held', playerId: b.id };
  const input: ActionInput = { kind: 'wizard', team: 'A', spell: 'zap', target: b.id };
  // ST 3: a 3 turns him into a Frog; the ball Bounces (D8 1: up-left) to an empty square.
  const r = run(s, input, [3, 1]);
  assert.equal(r.status, 'completed', r.error);
  const f = p(r.state, b.id);
  assert.deepEqual([f.ma, f.st, f.ag, f.pa, f.av, f.position], [5, 1, 2, null, 5, 'Frog']);
  assert.deepEqual(f.skills.map((k) => k.id).sort(), ['dodge', 'leap', 'noBall', 'stunty', 'titchy', 'veryLongLegs']);
  assert.ok(r.state.ball.kind === 'ground', 'the Frog cannot hold the ball: it bounced');
  assert.ok(!r.events.some((e) => e.type === 'turnover'));
  // The odds: natural 1 never, natural 6 always.
  const q = structuredClone(s);
  p(q, b.id).st = 1;
  assert.match(texts(run(q, input, [1])), /D6 1 vs ST 1 — nothing happens/);
  p(q, b.id).st = 6;
  assert.match(texts(run(q, input, [5])), /nothing happens/);
  assert.match(texts(run(q, input, [6, 1])), /turned into a Frog/);
  assert.ok(Math.abs(zapChance(p(s, b.id)) - 4 / 6) < 1e-12);
  // End of the Drive: the player is himself again (Reserves Box).
  const e = structuredClone(r.state);
  e.phase = 'halfOver';
  const nd = run(e, { kind: 'nextDrive' });
  assert.notEqual(nd.status, 'illegal', nd.error);
  const back = p(nd.state, b.id);
  assert.equal(back.frog, undefined);
  assert.deepEqual([back.ma, back.st, back.av], [p(s, b.id).ma, p(s, b.id).st, p(s, b.id).av]);
  assert.equal(back.location, 'reserves');
});

test('a Frog that suffers a Casualty is Badly Hurt without a Casualty Roll, and no Apothecary can be used', () => {
  const s = between();
  const b = s.players.find((q) => q.team === 'B' && q.location === 'pitch')!;
  place(s, b.id, 18, 12);
  const z = run(s, { kind: 'wizard', team: 'A', spell: 'zap', target: b.id }, [6]).state;
  assert.equal(p(z, b.id).position, 'Frog');
  z.teams.B.apothecary = 'available';
  const a = z.players.find((q) => q.team === 'A' && q.location === 'pitch')!;
  place(z, a.id, 17, 12);
  // Block: 3 dice (ST 3 v ST 1) 6, 6, 5 → POW; no re-roll; Armour 5+5 = 10 ≥ 5; Stunty Injury 6+6 = 12 → Casualty → Badly Hurt (no D16).
  const asked: string[] = [];
  const r = run(z, { kind: 'playerAction', playerId: a.id, action: 'block', path: [], blockTarget: b.id }, [6, 6, 5, 5, 5, 6, 6], (req) => {
    asked.push(req.type);
    if (req.type === 'reroll') return 'none';
    return req.options.find((o) => o.id === 'pow')?.id ?? req.options.find((o) => o.id === 'no')?.id ?? req.options[0].id;
  });
  assert.notEqual(r.status, 'illegal', r.error);
  assert.match(texts(r), /is a Frog: no Casualty Roll — Badly Hurt/);
  assert.ok(!asked.includes('apothecary'), `no Apothecary offered (${asked.join(', ')})`);
  assert.equal(p(r.state, b.id).location, 'cas');
});

test('previews: the spell is planned like an action (exact odds of Zap!)', () => {
  const s = between();
  const b = s.players.find((q) => q.team === 'B' && q.location === 'pitch')!;
  let frog = 0;
  const r = exploreOutcomes(s, { kind: 'wizard', team: 'A', spell: 'zap', target: b.id }, { threshold: 1e-9 }, (leaf) => {
    if (p(leaf.state, b.id).frog) frog += leaf.p;
  });
  assert.ok(r.ok, r.errors.join());
  assert.ok(Math.abs(frog - zapChance(b)) < 1e-9, `${frog}`);
});

test("the computer: Zap!s the opposing ball carrier who would score next Turn; keeps the spell when nothing is worth it", () => {
  const s = between();
  // Their ball carrier two squares from our End Zone (Orcs score at x = 0), nobody near him.
  const b = s.players.find((q) => q.team === 'B' && q.location === 'pitch')!;
  place(s, b.id, 2, 7);
  for (const q of s.players) if (q.id !== b.id && q.location === 'pitch' && q.pos && Math.abs(q.pos.x - 2) <= 3 && Math.abs(q.pos.y - 7) <= 3) q.pos = { x: q.pos.x + 8, y: q.pos.y };
  s.ball = { kind: 'held', playerId: b.id };
  const d = wizardChoice(s, 'A', 'balanced');
  assert.ok(d, 'it casts');
  const inp = d!.input as Extract<ActionInput, { kind: 'wizard' }>;
  assert.ok((inp.spell === 'zap' && inp.target === b.id) || (inp.spell === 'fireball' && Math.max(Math.abs(inp.square!.x - 2), Math.abs(inp.square!.y - 7)) <= 1), JSON.stringify(inp));
  assert.deepEqual(validateInput(s, d!.input), []);
  const r = run(s, d!.input, [6, 1, 6, 6, 6, 6, 6, 6]);
  assert.notEqual(r.status, 'illegal', r.error);
  assert.notEqual(r.state.ball.kind === 'held' ? r.state.ball.playerId : '', b.id, 'their carrier lost the ball');
  // Nothing worth it: the opponents spread out (no Fireball hits two of them), none holding the ball or near ours.
  const quiet = between();
  const spots = [1, 4, 7, 10, 13].flatMap((y) => [15, 18, 21].map((x) => c(x, y)));
  quiet.players.filter((q) => q.team === 'B' && q.location === 'pitch').forEach((q, i) => (q.pos = spots[i]));
  quiet.ball = { kind: 'ground', pos: c(6, 1) };
  const d2 = wizardChoice(quiet, 'A', 'balanced');
  assert.equal(d2, null, `kept for later (${d2?.why})`);
});
