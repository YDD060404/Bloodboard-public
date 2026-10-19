/**
 * Computer opponent (src/ai): legal actions only, urgent priorities, styles,
 * turn completion, representative positions, no access to future dice, and
 * whole matches against a scripted "human" and against itself.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Engine from '../src/engine/index';
import { createMatch, decide, execute, newTeamDef, playerFromRoster, ROSTER_BY_ID, validateInput, validateState, type ActionInput, type ExecutionResult, type GameState, type TeamDef, type TeamId } from '../src/engine/index';
import { bindEngine, decideAction, nextMove, styleWeights, waitingFor, type AIDecision, type AIStyle } from '../src/ai/index';
import { c, deepFreeze, Pos } from './helpers';

bindEngine(Engine);
const STYLES: AIStyle[] = ['balanced', 'offensive', 'defensive'];

function think(s: GameState, team: TeamId = s.turn.active, style: AIStyle = 'balanced'): AIDecision {
  const d = decideAction(s, team, { style });
  assert.deepEqual(validateInput(s, d.input), [], `AI input must be legal: ${d.chosen?.label ?? d.input.kind}`);
  return d;
}

// ---------------------------------------------------------------------------
// Representative positions (Team A = the computer, attacking towards x = 25)
// ---------------------------------------------------------------------------

/** A catcher with the ball, 4 squares from the End Zone, nobody near. */
function scoringChance(turnA = 5): GameState {
  const b = new Pos({ turnA, rerollsA: 2 });
  const car = b.add('A', 'human', 'catcher', c(21, 7), { id: 'A1' });
  b.add('A', 'human', 'lineman', c(15, 7), { id: 'A2' });
  b.add('B', 'orc', 'lineman', c(12, 3), { id: 'B1' });
  b.add('B', 'orc', 'lineman', c(12, 11), { id: 'B2' });
  b.give(car);
  return b.start();
}

/** The ball on the ground between the teams. */
function looseBall(): GameState {
  const b = new Pos({ rerollsA: 2 });
  b.add('A', 'human', 'blitzer', c(7, 7), { id: 'A1' });
  b.add('A', 'human', 'lineman', c(5, 4), { id: 'A2' });
  b.add('A', 'human', 'lineman', c(5, 10), { id: 'A3' });
  b.add('B', 'orc', 'lineman', c(14, 7), { id: 'B1' });
  b.add('B', 'orc', 'blitzer', c(15, 5), { id: 'B2' });
  b.ball(c(10, 7));
  return b.start();
}

/** An orc ball carrier 3 squares from our End Zone (x = 0); our blitzer can reach him. */
function opponentThreat(): GameState {
  const b = new Pos({ rerollsA: 1 });
  b.add('A', 'human', 'blitzer', c(7, 6), { id: 'A1' });
  b.add('A', 'human', 'lineman', c(8, 10), { id: 'A2' });
  b.add('A', 'human', 'lineman', c(12, 3), { id: 'A3' });
  const car = b.add('B', 'orc', 'blitzer', c(3, 7), { id: 'B1' });
  b.add('B', 'orc', 'lineman', c(6, 11), { id: 'B2' });
  b.give(car);
  return b.start();
}

/** Our ball carrier Marked by an orc; team-mates around. */
function carrierMarked(): GameState {
  const b = new Pos({ rerollsA: 2 });
  const car = b.add('A', 'human', 'thrower', c(10, 7), { id: 'A1' });
  b.add('A', 'human', 'blitzer', c(9, 6), { id: 'A2' });
  b.add('A', 'human', 'lineman', c(9, 8), { id: 'A3' });
  b.add('A', 'human', 'lineman', c(8, 7), { id: 'A4' });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1' });
  b.add('B', 'orc', 'lineman', c(14, 5), { id: 'B2' });
  b.add('B', 'orc', 'blitzer', c(15, 9), { id: 'B3' });
  b.give(car);
  return b.start();
}

/**
 * A safe, useful Block (2 dice with an assist) and a risky Dodge: the Block
 * must come first (a failed Dodge is a Turnover that would cost the Block).
 */
function riskyVersusSafe(): GameState {
  const b = new Pos({ rerollsA: 0 });
  const car = b.add('A', 'human', 'lineman', c(6, 7), { id: 'A0' });
  b.add('A', 'human', 'blitzer', c(12, 7), { id: 'A1' });
  b.add('A', 'human', 'lineman', c(12, 8), { id: 'A2' });
  b.add('A', 'human', 'lineman', c(12, 3), { id: 'A3' });
  b.add('B', 'orc', 'lineman', c(13, 7), { id: 'B1' });
  b.add('B', 'orc', 'lineman', c(13, 3), { id: 'B2' });
  b.add('B', 'orc', 'lineman', c(11, 2), { id: 'B3' });
  b.add('B', 'orc', 'lineman', c(20, 12), { id: 'B4' });
  b.give(car);
  return b.start();
}

test('immediate scoring chance: the carrier runs in (every style — urgent)', () => {
  for (const style of STYLES) {
    const d = think(scoringChance(), 'A', style);
    assert.equal(d.objective.id, 'score');
    assert.ok(d.objective.urgent);
    assert.equal(d.chosen?.kind, 'score', `${style}: ${d.reason}`);
    assert.ok((d.chosen?.pTouchdown ?? 0) > 0.99);
  }
});

test('loose ball: a team-mate goes for it', () => {
  const d = think(looseBall());
  assert.ok(['recoverBall', 'contestBall'].includes(d.objective.id), d.objective.id);
  assert.ok(d.chosen && ['pickup', 'secure'].includes(d.chosen.kind), d.reason);
  assert.ok(d.chosen?.playerId?.startsWith('A'));
  assert.ok((d.chosen?.pTurnover ?? 1) < 0.1, 'the safe way to the ball (Secure the Ball, 2+) is preferred');
});

test('opponent scoring threat: the carrier is Blitzed (every style — urgent)', () => {
  for (const style of STYLES) {
    const d = think(opponentThreat(), 'A', style);
    assert.equal(d.objective.id, 'stopScore');
    assert.ok(d.objective.urgent);
    assert.equal(d.chosen?.kind, 'blitz', `${style}: ${d.reason}`);
    assert.equal((d.input as Engine.PlayerActionInput).blitzTarget, 'B1');
    assert.ok((d.chosen?.pBallFreed ?? 0) > 0.2, 'the Blitz can knock the ball loose');
  }
});

test('ball carrier Marked: protecting the carrier is urgent', () => {
  const d = think(carrierMarked());
  assert.equal(d.objective.id, 'protectCarrier');
  assert.ok(d.objective.urgent);
  const inp = d.input as Engine.PlayerActionInput;
  // Either the Marking orc is hit, or the carrier leaves.
  assert.ok(inp.blockTarget === 'B1' || inp.playerId === 'A1', d.reason);
});

test('risky actions wait: a safe Block comes before a Turnover-prone Dodge', () => {
  const s = riskyVersusSafe();
  const d = think(s);
  assert.ok(d.chosen, d.reason);
  assert.ok((d.chosen?.pTurnover ?? 1) < 0.1, `first action ${d.chosen?.label} (turnover ${d.chosen?.pTurnover})`);
  // The Dodge was considered, and it was charged with the Block it could lose.
  const dodge = d.candidates.find((k) => k.playerId === 'A3' && k.kind === 'move' && (k.pTurnover ?? 0) > 0.2);
  assert.ok(dodge, 'a risky Dodge was among the candidates');
});

test('last Turn of the half: the carrier goes for a Rushing score it would not risk earlier', () => {
  // MA 6 lineman, 8 squares out: two Rushes (25/36 ≈ 69%).
  const mk = (turnA: number) => {
    const b = new Pos({ turnA, rerollsA: 0 });
    const car = b.add('A', 'human', 'lineman', c(17, 7), { id: 'A1' });
    b.add('A', 'human', 'lineman', c(14, 7), { id: 'A2' });
    b.add('B', 'orc', 'lineman', c(8, 3), { id: 'B1' });
    b.give(car);
    return b.start();
  };
  const late = think(mk(8));
  assert.equal(late.chosen?.kind, 'score', late.reason);
  assert.ok(Math.abs((late.chosen?.pTouchdown ?? 0) - 25 / 36) < 0.01);
  const early = think(mk(4));
  assert.notEqual(early.chosen?.kind, 'score', `turn 4 should not risk the 69% run: ${early.reason}`);
});

test('styles change preferences, never urgent decisions or the rules', () => {
  // Weight tables differ the documented way.
  const off = styleWeights('offensive');
  const def = styleWeights('defensive');
  const bal = styleWeights('balanced');
  assert.ok(off.progress > bal.progress && bal.progress > def.progress);
  assert.ok(def.cage > bal.cage && bal.cage > off.cage);
  assert.ok(def.turnoverCost > bal.turnoverCost && bal.turnoverCost > off.turnoverCost);
  // Same urgent choice in every style (checked above); in a quiet position at least one choice differs.
  const quiet = styleProbe();
  const picks = STYLES.map((st) => think(quiet, 'A', st).chosen?.label ?? 'end turn');
  assert.ok(new Set(picks).size > 1, `styles all chose ${picks[0]}`);
});

/** A caged thrower at midfield, orcs spread 6-10 squares ahead (Turn 3). */
function openField(): GameState {
  const b = new Pos({ rerollsA: 2, turnA: 3, turnB: 2 });
  const car = b.add('A', 'human', 'thrower', c(9, 7), { id: 'A1' });
  b.add('A', 'human', 'blitzer', c(10, 6), { id: 'A2' });
  b.add('A', 'human', 'lineman', c(10, 8), { id: 'A3' });
  b.add('A', 'human', 'catcher', c(8, 3), { id: 'A4' });
  b.add('A', 'human', 'catcher', c(8, 11), { id: 'A5' });
  b.add('A', 'human', 'lineman', c(8, 7), { id: 'A6' });
  b.add('A', 'human', 'lineman', c(8, 6), { id: 'A7' });
  b.add('A', 'human', 'lineman', c(8, 8), { id: 'A8' });
  b.add('B', 'orc', 'lineman', c(15, 7), { id: 'B1' });
  b.add('B', 'orc', 'lineman', c(15, 4), { id: 'B2' });
  b.add('B', 'orc', 'lineman', c(15, 10), { id: 'B3' });
  b.add('B', 'orc', 'blitzer', c(17, 7), { id: 'B4' });
  b.add('B', 'orc', 'lineman', c(19, 5), { id: 'B5' });
  b.add('B', 'orc', 'lineman', c(19, 9), { id: 'B6' });
  b.give(car);
  return b.start();
}

test('styles in an open field: the carrier moves first (cage after) and advances in every style', () => {
  // V5.5: until V5 step 6 this test also required Offensive to gain more ground than Defensive here. With the
  // access-based cage model the two moves are a close call (0.3 points): Offensive keeps the two team-mates on the
  // carrier's diagonals (x = 11), Defensive runs one square further to where a full X cage can be built (x = 12).
  // That the styles choose differently in a quiet position is checked in "styles change preferences".
  const s = openField();
  const dest = (st: AIStyle) => {
    const d = think(s, 'A', st);
    assert.equal(d.chosen?.kind, 'carry', `${st}: ${d.reason}`);
    const path = (d.input as Engine.PlayerActionInput).path;
    return path[path.length - 1].to;
  };
  for (const st of STYLES) assert.ok(dest(st).x >= 11, `${st} advances the caged carrier at least two squares`);
});

/** Ball carrier safe in our half with free team-mates: Offensive and Defensive disagree about the next move. */
function styleProbe(): GameState {
  const b = new Pos({ rerollsA: 2 });
  const car = b.add('A', 'human', 'thrower', c(9, 7), { id: 'A1' });
  b.add('A', 'human', 'blitzer', c(10, 6), { id: 'A2' });
  b.add('A', 'human', 'lineman', c(10, 8), { id: 'A3' });
  b.add('A', 'human', 'catcher', c(8, 3), { id: 'A4' });
  b.add('A', 'human', 'catcher', c(8, 11), { id: 'A5' });
  b.add('A', 'human', 'lineman', c(8, 7), { id: 'A6' });
  b.add('B', 'orc', 'lineman', c(15, 7), { id: 'B1' });
  b.add('B', 'orc', 'lineman', c(15, 4), { id: 'B2' });
  b.add('B', 'orc', 'lineman', c(15, 10), { id: 'B3' });
  b.add('B', 'orc', 'blitzer', c(17, 7), { id: 'B4' });
  b.give(car);
  return b.start();
}

test('thinking never changes the game, never reads the dice generator', () => {
  for (const mk of [scoringChance, looseBall, opponentThreat, carrierMarked, riskyVersusSafe]) {
    const s = deepFreeze(mk());
    const before = JSON.stringify(s);
    const d1 = decideAction(s, 'A', { style: 'balanced' });
    assert.equal(JSON.stringify(s), before);
    // A different random seed (= different future dice) gives exactly the same decision.
    const other = JSON.parse(before) as GameState;
    other.rng = { seed: (other.rng.seed ^ 0x5bd1e995) >>> 0, counter: other.rng.counter + 17 };
    const d2 = decideAction(other, 'A', { style: 'balanced' });
    assert.deepEqual(d2.input, d1.input);
    assert.equal(d2.reason, d1.reason);
  }
});

test('a whole AI Turn: actions are legal, decisions answered, the Turn ends by the normal flow', () => {
  for (const mk of [looseBall, carrierMarked, riskyVersusSafe, styleProbe]) {
    let s = mk();
    let n = 0;
    while (s.turn.active === 'A' && s.phase === 'play') {
      assert.ok(n++ < 40, 'the Turn must end');
      const mv = nextMove(s, 'A', 'balanced');
      if (!mv) throw new Error('the AI must act during its Turn');
      let res: ExecutionResult;
      if (mv.type === 'decision') res = decide(s, { requestId: mv.requestId, optionId: mv.optionId });
      else {
        assert.deepEqual(validateInput(s, mv.input), []);
        res = execute(s, mv.input);
      }
      assert.notEqual(res.status, 'illegal', res.error);
      s = res.state;
      while (s.pending) {
        // Decisions of either coach during the action are answered by the AI for its own team.
        const req = s.pending.request;
        const a = nextMove(s, req.team, 'balanced');
        if (!a || a.type !== 'decision') throw new Error('expected a decision');
        assert.ok(req.options.some((o) => o.id === a.optionId));
        s = decide(s, { requestId: a.requestId, optionId: a.optionId }).state;
      }
      assert.deepEqual(validateState(s), []);
    }
    assert.ok(s.turn.active === 'B' || s.phase !== 'play', 'control passed to the other coach');
  }
});

// ---------------------------------------------------------------------------
// Whole matches
// ---------------------------------------------------------------------------

function team(id: string, rosterId: string, comp: Array<[string, number]>): TeamDef {
  const t = newTeamDef('tournament', rosterId, `${rosterId} ${id}`, id);
  let n = 1;
  for (const [pos, k] of comp) for (let i = 0; i < k; i++) t.players.push(playerFromRoster(ROSTER_BY_ID[rosterId], pos, n, `${id}-${n++}`));
  t.rerolls = 3;
  t.apothecary = true;
  return t;
}

/**
 * Plays a match to full time. `ai` lists the computer coaches; the other coach
 * is a scripted "human" who uses default set-ups, kicks to the middle and
 * ends every Turn (answering decisions with the first option).
 */
function playMatch(seed: number, ai: Partial<Record<TeamId, AIStyle>>, rules: 'full' | 'introductory', opts = { maxExplored: 6 }, firstHalfOnly = false) {
  const r = createMatch('tournament', team('hum', 'human', [['lineman', 7], ['blitzer', 2], ['catcher', 2], ['thrower', 1]]), team('orc', 'orc', [['lineman', 7], ['blitzer', 2], ['bigUn', 2]]), { rules }, seed);
  assert.ok(r.ok, r.errors.join('\n'));
  let s = r.state as GameState;
  const stats = { aiActions: 0, aiTurnsEnded: 0, humanTurns: 0, decisionsByAI: 0, kinds: {} as Record<string, number> };
  let guard = 0;
  while (s.phase !== 'fullTime' && !(firstHalfOnly && s.match!.half === 2)) {
    assert.ok(guard++ < 4000, `match stuck in ${s.phase}`);
    const who = waitingFor(s);
    let res: ExecutionResult;
    if (!who) res = execute(s, s.phase === 'pregame' ? { kind: 'pregame' } : { kind: 'nextDrive' });
    else if (ai[who]) {
      const mv = nextMove(s, who, ai[who] as AIStyle, opts);
      if (!mv) throw new Error(`the AI must act in ${s.phase}`);
      if (mv.type === 'decision') {
        stats.decisionsByAI++;
        res = decide(s, { requestId: mv.requestId, optionId: mv.optionId });
      } else {
        assert.deepEqual(validateInput(s, mv.input), [], `${mv.type}: ${mv.why}`);
        if (mv.type === 'action') {
          stats.aiActions++;
          const k = mv.decision.chosen?.kind ?? 'endTurn';
          stats.kinds[k] = (stats.kinds[k] ?? 0) + 1;
          if (!mv.decision.chosen) stats.aiTurnsEnded++;
        }
        res = execute(s, mv.input);
      }
    } else {
      const m = s.match!;
      let input: ActionInput;
      if (s.pending) {
        res = decide(s, { requestId: s.pending.request.id, optionId: s.pending.request.options[0].id });
        assert.notEqual(res.status, 'illegal', res.error);
        s = res.state;
        continue;
      }
      if (s.phase === 'driveSetup') input = { kind: 'setupTeam', team: who, positions: Engine.defaultFormation(s, who) };
      else if (s.phase === 'kickoff' && m.pendingPhase?.type === 'solidDefence') input = { kind: 'solidDefence', positions: {} };
      else if (s.phase === 'kickoff' && m.pendingPhase?.type === 'quickSnap') input = { kind: 'quickSnap', moves: {} };
      else if (s.phase === 'kickoff') input = { kind: 'kickoff', kicker: Engine.kickerCandidates(s, who)[0].id, target: c(who === 'A' ? 19 : 6, 7) };
      else {
        input = { kind: 'endTurn' };
        stats.humanTurns++;
      }
      res = execute(s, input);
    }
    assert.notEqual(res.status, 'illegal', res.error);
    s = res.state;
    assert.deepEqual(validateState(s), []);
  }
  return { s, stats };
}

test('a whole match against a scripted human: the AI plays every phase, both halves, to full time', () => {
  const { s, stats } = playMatch(3, { B: 'balanced' }, 'full');
  assert.equal(s.phase, 'fullTime');
  assert.ok(stats.aiActions > 30, `AI actions ${stats.aiActions}`);
  assert.ok(stats.aiTurnsEnded >= 8, 'the AI ends its Turns through the normal flow');
  assert.ok(stats.humanTurns >= 8);
  // Against a coach who never acts, the computer should score.
  assert.ok(s.teams.B.score >= 1, `AI scored ${s.teams.B.score}`);
});

test('AI versus AI (different styles) plays a half with legal inputs only (whole matches: scripts/ai-selfplay.ts)', () => {
  const { s, stats } = playMatch(11, { A: 'offensive', B: 'defensive' }, 'full', { maxExplored: 6 }, true);
  assert.equal(s.match!.half, 2, 'the first half was completed');
  assert.ok(stats.aiActions > 40);
  assert.ok((stats.kinds.block ?? 0) + (stats.kinds.blitz ?? 0) > 5, JSON.stringify(stats.kinds));
});

// ---------------------------------------------------------------------------
// Engine support used by the AI, Charge!, match steps, saves
// ---------------------------------------------------------------------------

test('exploreOutcomes: every outcome accounted for, nothing changed, Turnover part of the cut mass reported', () => {
  const s = deepFreeze(riskyVersusSafe());
  const before = JSON.stringify(s);
  // A Dodge out of two Tackle Zones (A3 at 12,3 is Marked by B2 and B3).
  const input: Engine.ActionInput = { kind: 'playerAction', playerId: 'A3', action: 'move', path: [{ to: c(11, 4), kind: 'step' }, { to: c(10, 5), kind: 'step' }] };
  let mass = 0;
  let turnovers = 0;
  const r = Engine.exploreOutcomes(s, input, { threshold: 1e-3, maxLeaves: 5000 }, (leaf) => {
    mass += leaf.p;
    if (leaf.turnover) turnovers += leaf.p;
    assert.ok(leaf.completed !== leaf.turnover || (!leaf.completed && !leaf.turnover));
  });
  assert.ok(r.ok, r.errors.join('; '));
  assert.ok(Math.abs(mass + r.unresolved - 1) < 1e-9, `explored ${mass} + unresolved ${r.unresolved}`);
  assert.ok(r.unresolvedTurnover >= 0 && r.unresolvedTurnover <= r.unresolved + 1e-12);
  // The planner's own exact figure for the same action.
  const plan = Engine.planAction(s, input);
  assert.ok(plan.ok);
  assert.ok(Math.abs(turnovers + r.unresolvedTurnover - (plan.withTeamRerolls?.pTurnover ?? plan.withoutTeamRerolls!.pTurnover)) < 2e-3);
  assert.equal(JSON.stringify(s), before);
  // An illegal input is reported, not enumerated.
  const bad = Engine.exploreOutcomes(s, { kind: 'playerAction', playerId: 'A3', action: 'move', path: [{ to: c(20, 20), kind: 'step' }] }, {}, () => assert.ok(false, 'no leaves'));
  assert.equal(bad.ok, false);
});

function chargeState(): GameState {
  const r = createMatch('tournament', team('hum', 'human', [['lineman', 7], ['blitzer', 2], ['catcher', 2], ['thrower', 1]]), team('orc', 'orc', [['lineman', 7], ['blitzer', 2], ['bigUn', 2]]), { rules: 'full', computer: { team: 'B', style: 'balanced' } }, 11);
  let s = r.state as GameState;
  const run = (st: GameState, input: ActionInput, faces?: number[]) => {
    const dice = faces ? () => new Engine.ScriptedDice(faces) : undefined;
    let res = execute(st, input, undefined, dice);
    while (res.status === 'awaitingDecision' && res.decision) res = decide(res.state, { requestId: res.decision.id, optionId: res.decision.options[0].id }, dice);
    assert.notEqual(res.status, 'illegal', res.error);
    return res.state;
  };
  // Fan Factor, Weather, roll-off A 5 B 2: A receives, B (the computer) kicks.
  s = run(s, { kind: 'pregame' }, [2, 3, 3, 4, 5, 2]);
  for (const t of ['B', 'A'] as TeamId[]) {
    const step = nextMove(s, t, 'balanced');
    if (t === 'B') {
      if (!step || step.type !== 'step') throw new Error('the computer sets up its own team');
      s = run(s, step.input);
    } else s = run(s, { kind: 'setupTeam', team: 'A', positions: Engine.defaultFormation(s, 'A') });
  }
  // Kick (deviation D8 5, D6 1), Kick-off Event 4+6 = 10 Charge!, D3 1.
  const kicker = Engine.kickerCandidates(s, 'B')[0];
  return run(s, { kind: 'kickoff', kicker: kicker.id, target: c(2, 7) }, [5, 1, 4, 6, 1]);
}

test('Charge!: the computer plays its free Moves within the restrictions and the Charge ends through the normal flow', () => {
  let s = chargeState();
  assert.equal(s.match?.pendingPhase?.type, 'charge');
  assert.equal(waitingFor(s), 'B');
  let n = 0;
  while (s.match?.pendingPhase?.type === 'charge') {
    assert.ok(n++ < 12, 'the Charge must end');
    const mv = nextMove(s, 'B', 'balanced');
    if (!mv) throw new Error('the computer must act during its Charge');
    let res: ExecutionResult;
    if (mv.type === 'decision') res = decide(s, { requestId: mv.requestId, optionId: mv.optionId });
    else {
      assert.deepEqual(validateInput(s, mv.input), [], mv.why);
      if (mv.input.kind === 'playerAction') assert.ok(['move', 'blitz', 'ttm'].includes(mv.input.action), `Charge! allows Move / Blitz / Throw Team-mate only, got ${mv.input.action}`);
      res = execute(s, mv.input);
    }
    assert.notEqual(res.status, 'illegal', res.error);
    s = res.state;
    while (s.pending) {
      const a = nextMove(s, s.pending.request.team, 'balanced');
      if (!a || a.type !== 'decision') throw new Error('expected a decision');
      s = decide(s, { requestId: a.requestId, optionId: a.optionId }).state;
    }
  }
  assert.ok(s.phase === 'play' && s.turn.active === 'A', 'after the Charge the receiving team plays its Turn');
});

test('match steps: the computer\'s set-up, kick-off and roll-off choice are legal engine inputs', () => {
  const r = createMatch('tournament', team('hum', 'human', [['lineman', 7], ['blitzer', 2], ['catcher', 2], ['thrower', 1]]), team('orc', 'orc', [['lineman', 7], ['blitzer', 2], ['bigUn', 2]]), { rules: 'introductory', computer: { team: 'A', style: 'defensive' } }, 5);
  let s = r.state as GameState;
  assert.equal(waitingFor(s), null, 'the pre-game roll is a shared step');
  // Roll-off: the winner chooses (make sure the computer is the one who won: swap the dice if needed).
  // A paused action is replayed from its start when the decision is answered, so the same dice go to decide().
  let faces = [5, 2];
  let res = execute(s, { kind: 'pregame' }, undefined, () => new Engine.ScriptedDice(faces));
  if (res.decision?.team !== 'A') {
    faces = [2, 5];
    res = execute(s, { kind: 'pregame' }, undefined, () => new Engine.ScriptedDice(faces));
  }
  assert.equal(res.status, 'awaitingDecision');
  assert.equal(res.decision?.team, 'A');
  assert.equal(waitingFor(res.state), 'A');
  const choice = nextMove(res.state, 'A', 'defensive');
  if (!choice || choice.type !== 'decision') throw new Error('the computer answers the roll-off');
  assert.equal(choice.optionId, 'receive');
  s = decide(res.state, { requestId: choice.requestId, optionId: choice.optionId }, () => new Engine.ScriptedDice(faces)).state;
  assert.equal(s.match?.kicking, 'B');
  s = execute(s, { kind: 'setupTeam', team: 'B', positions: Engine.defaultFormation(s, 'B') }).state;
  const setup = nextMove(s, 'A', 'defensive');
  if (!setup || setup.type !== 'step') throw new Error('the computer sets up');
  assert.deepEqual(validateInput(s, setup.input), []);
  s = execute(s, setup.input).state;
  assert.equal(s.phase, 'kickoff');
  assert.equal(waitingFor(s), 'B', 'the human kicks');
  // Saving keeps the computer opponent.
  const file = Engine.toSaveFile(s, 'vs computer');
  const back = Engine.parseSaveFile(JSON.stringify(file));
  if (!back.ok) throw new Error(back.errors.join('; '));
  assert.deepEqual(back.save.state.match?.options.computer, { team: 'A', style: 'defensive' });
  // The computer's kick-off when it kicks.
  const k = createMatch('tournament', team('hum', 'human', [['lineman', 7], ['blitzer', 2], ['catcher', 2], ['thrower', 1]]), team('orc', 'orc', [['lineman', 7], ['blitzer', 2], ['bigUn', 2]]), { rules: 'introductory', computer: { team: 'B', style: 'offensive' } }, 5).state as GameState;
  faces = [5, 2];
  res = execute(k, { kind: 'pregame' }, undefined, () => new Engine.ScriptedDice(faces));
  if (res.decision?.team !== 'A') {
    faces = [2, 5];
    res = execute(k, { kind: 'pregame' }, undefined, () => new Engine.ScriptedDice(faces));
  }
  let t = decide(res.state, { requestId: res.decision!.id, optionId: 'receive' }, () => new Engine.ScriptedDice(faces)).state;
  assert.equal(t.match?.kicking, 'B');
  const st1 = nextMove(t, 'B', 'offensive');
  if (!st1 || st1.type !== 'step') throw new Error('the computer sets up');
  t = execute(t, st1.input).state;
  t = execute(t, { kind: 'setupTeam', team: 'A', positions: Engine.defaultFormation(t, 'A') }).state;
  const kick = nextMove(t, 'B', 'offensive');
  if (!kick || kick.type !== 'step' || kick.input.kind !== 'kickoff') throw new Error('the computer kicks off');
  assert.deepEqual(validateInput(t, kick.input), []);
  assert.ok(Engine.inOwnHalf('A', kick.input.target), 'the kick goes into the receiving half');
});

test('Stalling (p.80-81): a carrier who can score without dice scores instead of waiting for the Crowd', async () => {
  const { stallingRisk } = await import('../src/ai/brain');
  // A caged carrier two squares from the End Zone, opponents far away: holding looks safe, but
  // ending the Turn without scoring lets the Crowd Take Action (D6 ≥ Turn number).
  const mk = (turnA: number) => {
    const b = new Pos({ turnA, rerollsA: 2 });
    const car = b.add('A', 'human', 'catcher', c(23, 7), { id: 'A1' });
    b.add('A', 'human', 'lineman', c(22, 6), { id: 'A2' });
    b.add('A', 'human', 'lineman', c(22, 8), { id: 'A3' });
    b.add('A', 'human', 'lineman', c(24, 6), { id: 'A4' });
    b.add('A', 'human', 'lineman', c(24, 8), { id: 'A5' });
    b.add('B', 'orc', 'lineman', c(12, 3), { id: 'B1' });
    b.add('B', 'orc', 'lineman', c(12, 11), { id: 'B2' });
    b.give(car);
    return b.start();
  };
  for (const turn of [3, 5]) {
    const s = mk(turn);
    assert.ok(Engine.canScoreWithoutDice(s, Engine.getPlayer(s, 'A1')));
    assert.ok(stallingRisk(s, 'A', { ball: 28, progress: 30, scoreThreat: 30 }) > 0);
    for (const style of STYLES) {
      const d = think(s, 'A', style);
      assert.equal(d.chosen?.kind, 'score', `turn ${turn}, ${style}: ${d.reason}`);
    }
  }
  // Turn 7: the Crowd cannot reach 7+ on a D6 — no Stalling risk to count.
  assert.equal(stallingRisk(mk(7), 'A', { ball: 28, progress: 30, scoreThreat: 30 }), 0);
});

// ---------------------------------------------------------------------------
// V4: sideline / corner exposure (crowd pushes)
// ---------------------------------------------------------------------------

/** Plays the AI's whole Turn (Team A) and returns the state when control passes. */
function playAITurn(s: GameState, style: AIStyle = 'balanced'): GameState {
  let n = 0;
  while (s.turn.active === 'A' && s.phase === 'play') {
    assert.ok(n++ < 40, 'the Turn must end');
    const mv = nextMove(s, 'A', style);
    if (!mv) throw new Error('the AI must act during its Turn');
    const res = mv.type === 'decision' ? decide(s, { requestId: mv.requestId, optionId: mv.optionId }) : execute(s, mv.input);
    assert.notEqual(res.status, 'illegal', res.error);
    s = res.state;
    while (s.pending) {
      const req = s.pending.request;
      const a = nextMove(s, req.team, style);
      if (!a || a.type !== 'decision') throw new Error('expected a decision');
      s = decide(s, { requestId: a.requestId, optionId: a.optionId }).state;
    }
  }
  return s;
}

test('crowd exposure: the engine’s own push rule decides which squares are dangerous', async () => {
  const { evaluate, styleWeights, horizonFor } = await import('../src/ai/evaluate');
  const mk = (ay: number, opp: boolean) => {
    const b = new Pos({ rerollsA: 1 });
    b.add('A', 'human', 'lineman', c(11, ay), { id: 'A1' });
    b.add('A', 'human', 'lineman', c(4, 7), { id: 'A2' });
    if (opp) b.add('B', 'orc', 'lineman', c(11, 1), { id: 'B1' });
    else b.add('B', 'orc', 'lineman', c(22, 12), { id: 'B1' });
    b.ball(c(2, 7));
    return b.start();
  };
  const crowd = (s: GameState) => evaluate(s, 'A', styleWeights('balanced'), horizonFor(s, 'A')).terms.crowd ?? 0;
  // On the sideline with an opponent directly inside him: every push square is off the pitch.
  const edge = mk(0, true);
  assert.equal(Engine.crowdPushSquares(edge, Engine.getPlayer(edge, 'A1')).length >= 1, true);
  assert.ok(crowd(edge) < -2.5, `exposed: ${crowd(edge)}`);
  // One square further in, the same opponent pushes him onto the pitch, not into the crowd.
  assert.equal(crowd(mk(2, true)), 0);
  // No blanket penalty: the sideline is fine when no opponent can get to a pushing square.
  assert.equal(crowd(mk(0, false)), 0);
  // Stand Firm: the player cannot be pushed, so no exposure.
  const sf = mk(0, true);
  Engine.getPlayer(sf, 'A1').skills.push({ id: 'standFirm' });
  assert.equal(crowd(sf), 0);
});

test('crowd exposure: a sideline player steps off the sideline unless he does a job there', () => {
  // A2 stands on the sideline, unmarked; an Orc can Blitz onto the square that pushes him out.
  // V4 (measured then with the crowd term switched off): every style ran A2 up the sideline, exposed; with it, the
  // AI picked the comparable square one row in (16,1). V5.5: the access-based exposure model moves the carrier
  // back out of both Orcs' reach, and A2 becomes a front corner of his cage on the sideline square (6,0) — a job,
  // as in the next test. So the check is: A2 ends off the sideline, or next to our carrier / marking an opponent.
  for (const style of STYLES) {
    const b = new Pos({ rerollsA: 1, turnA: 3 });
    b.add('A', 'human', 'lineman', c(11, 0), { id: 'A2' });
    const car = b.add('A', 'human', 'lineman', c(9, 2), { id: 'A1' });
    b.add('A', 'human', 'lineman', c(8, 3), { id: 'A3' });
    b.add('B', 'orc', 'lineman', c(14, 3), { id: 'B1' });
    b.add('B', 'orc', 'lineman', c(16, 7), { id: 'B2' });
    b.give(car);
    const before = b.start();
    assert.ok(Engine.crowdPushSquares(before, Engine.getPlayer(before, 'A2')).length > 0);
    const after = playAITurn(before, style);
    const a2 = Engine.getPlayer(after, 'A2');
    const exposed = a2.location === 'pitch' && a2.stance === 'standing' && (a2.pos!.y === 0 || a2.pos!.y === 14) && Engine.crowdPushSquares(after, a2).length > 0;
    const carrier = after.ball.kind === 'held' ? Engine.getPlayer(after, after.ball.playerId) : null;
    const job = !!a2.pos && ((!!carrier?.pos && carrier.team === 'A' && Math.max(Math.abs(carrier.pos.x - a2.pos.x), Math.abs(carrier.pos.y - a2.pos.y)) === 1) || Engine.markersOf(after, a2.pos, 'A').length > 0);
    assert.ok(!exposed || job, `${style}: A2 ended on ${JSON.stringify(a2.pos)} exposed to a crowd push without a job there`);
  }
});

test('crowd exposure: a sideline position is kept when it does a job (marking their ball carrier)', () => {
  // A2 on the sideline marks the Orc ball carrier standing right next to him. Moving away would need
  // a Dodge and would release the carrier: the AI keeps him there (or blocks the carrier), it does not flee.
  for (const style of STYLES) {
    const b = new Pos({ rerollsA: 0, turnA: 3 });
    b.add('A', 'human', 'lineman', c(11, 0), { id: 'A2' });
    b.add('A', 'human', 'lineman', c(4, 9), { id: 'A1' });
    const car = b.add('B', 'orc', 'lineman', c(11, 1), { id: 'B1', st: 5 });
    b.give(car);
    const after = playAITurn(b.start(), style);
    const a2 = Engine.getPlayer(after, 'A2');
    const c2 = Engine.getPlayer(after, 'B1');
    const stillOn = a2.location === 'pitch' && c2.location === 'pitch' && Math.max(Math.abs(a2.pos!.x - c2.pos!.x), Math.abs(a2.pos!.y - c2.pos!.y)) <= 1;
    assert.ok(stillOn || c2.stance !== 'standing', `${style}: A2 left their ball carrier (A2 ${JSON.stringify(a2.pos)}, B1 ${JSON.stringify(c2.pos)})`);
  }
});

// ---------------------------------------------------------------------------
// V4: Fouls (p.69)
// ---------------------------------------------------------------------------

test('V4: the computer fouls a Prone opponent when the odds are good (two assists, low Armour), and not when they are poor', () => {
  // Good: A1 is the last to act; A2 and A3 assist; the target is a Prone Goblin (AV 8).
  const b = new Pos({ rerollsA: 1 });
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1' });
  const a2 = b.add('A', 'human', 'lineman', c(12, 6), { id: 'A2' });
  const a3 = b.add('A', 'human', 'lineman', c(12, 8), { id: 'A3' });
  b.add('B', 'orc', 'goblin', c(11, 7), { id: 'B1', stance: 'prone' });
  const bc = b.add('B', 'orc', 'lineman', c(22, 3), { id: 'B2' });
  b.give(bc);
  a2.activated = true;
  a3.activated = true;
  const s = b.start();
  s.players.find((q) => q.id === 'A2')!.activated = true;
  s.players.find((q) => q.id === 'A3')!.activated = true;
  const d = think(s, 'A');
  const good = d.candidates.find((k) => k.kind === 'foul');
  assert.ok(good && !good.error && (good.gain as number) > 0, `the Foul is weighed exactly and gains: ${good?.gain}`);
  assert.equal(good!.input.kind === 'playerAction' && good!.input.foulTarget, 'B1');
  assert.ok((good!.pTurnover as number) > 0.15 && (good!.pTurnover as number) < 0.4, `Sent-off risk ${good!.pTurnover}`);
  // With nothing better to do (the last player cannot move — Rooted — and our ball carrier has acted), it fouls.
  const s3 = structuredClone(s);
  s3.players.find((q) => q.id === 'B2')!.pos = c(1, 1);
  s3.players.push({ ...structuredClone(s3.players.find((q) => q.id === 'A2')!), id: 'A4', number: 44, pos: c(1, 14), activated: true });
  s3.ball = { kind: 'held', playerId: 'A4' };
  const a1 = s3.players.find((q) => q.id === 'A1')!;
  a1.skills = [...a1.skills, { id: 'takeRoot' }];
  a1.rooted = true;
  const d3 = think(s3, 'A');
  assert.equal(d3.chosen?.kind, 'foul', d3.reason + ' | ' + d3.candidates.map((k) => `${k.kind}:${k.gain?.toFixed(2)}`).join(' ; '));
  // Poor: an Orc Blitzer (AV 10) and two opponents Marking the fouler (−2).
  const b2 = new Pos({ rerollsA: 1 });
  b2.add('A', 'human', 'lineman', c(10, 7), { id: 'A1' });
  b2.add('B', 'orc', 'blitzer', c(11, 7), { id: 'B1', stance: 'prone' });
  b2.add('B', 'orc', 'lineman', c(9, 6), { id: 'B3' });
  b2.add('B', 'orc', 'lineman', c(9, 8), { id: 'B4' });
  const bc2 = b2.add('B', 'orc', 'lineman', c(22, 3), { id: 'B2' });
  b2.give(bc2);
  const s2 = b2.start();
  const d2 = think(s2, 'A');
  assert.notEqual(d2.chosen?.kind, 'foul', d2.reason);
  const fc = d2.candidates.find((k) => k.kind === 'foul');
  if (fc && fc.gain !== undefined) assert.ok((fc.gain as number) < 0, `foul value ${fc.gain}`);
});

test('V4: the computer answers Argue the Call and Bribes for its Sent-off fouler', () => {
  const b = new Pos({ rerollsA: 1 });
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1' });
  b.add('B', 'orc', 'goblin', c(11, 7), { id: 'B1', stance: 'prone' });
  b.ball(c(2, 2));
  const s = b.start();
  const r = execute(s, { kind: 'playerAction', playerId: 'A1', action: 'foul', path: [], foulTarget: 'B1' }, undefined, () => new Engine.ScriptedDice([3, 3, 5]));
  assert.equal(r.status, 'awaitingDecision');
  const a = Engine.previewDecision(r.state, r.decision!);
  assert.equal(a, 'yes', 'Argue the Call');
});
