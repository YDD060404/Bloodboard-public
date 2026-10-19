/**
 * V5.5 optional difficulty (house rule, matches against the computer only) — outcome-based:
 * every consequential roll is weighed by who its result helps (a high number is never assumed good), Block dice
 * included; neutral rolls untouched; every result possible; Off = the standard generator; separate human / computer
 * settings; previews (steps, whole plans, Block analysis) equal to the executed frequencies; no effect outside
 * matches against the computer.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Ctx, DEFAULT_POLICY, difficultyFactors, outcomeFactor, testWeights, tiltedChance } from '../src/engine/context';
import { DIFFICULTY_TILT, RngDice, d6SuccessProbW, rollDie, type RollSpec } from '../src/engine/dice';
import { armourAndInjury } from '../src/engine/injury';
import { createMatch, difficultyExamples, execute, newTeamDef, planAction, playerFromRoster, ROSTER_BY_ID, type GameState, type TeamId } from '../src/engine/index';
import { c, Pos } from './helpers';

function team(id: string, rosterId: string) {
  const t = newTeamDef('league', rosterId, `${rosterId} ${id}`, id);
  const r = ROSTER_BY_ID[rosterId];
  let n = 1;
  const line = r.positions[0];
  while (t.players.length < 11) t.players.push(playerFromRoster(r, line.id, n, `${id}-${n++}`));
  t.rerolls = 2;
  return t;
}

/** A practice-style position that carries match options (enough for the house rule and the planner). */
function withOptions(s: GameState, computer: TeamId | null, player: number, cpu: number): GameState {
  (s as unknown as { match: unknown }).match = { options: { rules: 'full', ...(computer ? { computer: { team: computer } } : {}), difficulty: { player, computer: cpu } } };
  return s;
}

test('factors: Off = none; results good for the human side less likely, good for the computer side more likely; every result possible', () => {
  assert.deepEqual([...DIFFICULTY_TILT], [0, 0.1, 0.2, 0.35]);
  const s = withOptions(new Pos().start(), 'B', 0, 0);
  assert.equal(difficultyFactors(s, 'A'), null);
  assert.equal(difficultyFactors(s, 'B'), null);
  withOptions(s, 'B', 3, 2);
  assert.deepEqual(difficultyFactors(s, 'A'), { good: 0.65, bad: 1.2 }, 'human side: its good results ×0.65, its bad ones (good for the computer) ×1.2');
  assert.deepEqual(difficultyFactors(s, 'B'), { good: 1.2, bad: 0.65 });
  for (const b of [-1, -0.5, 0, 0.5, 1]) assert.ok(outcomeFactor({ good: 0.65, bad: 1.2 }, b) > 0.5, 'every result keeps a real chance');
  assert.equal(outcomeFactor({ good: 0.65, bad: 1.2 }, 0), 1, 'neutral results are not weighted');
  // A 4+ test for the human at Strong / computer Off: 0.5·0.65 / (0.5·0.65 + 0.5) ≈ 39.4%.
  withOptions(s, 'B', 3, 0);
  const w = testWeights(s, 'A', (f) => f >= 4)!;
  assert.ok(Math.abs(w[3] + w[4] + w[5] - 0.325 / 0.825) < 1e-12);
  // The worked examples shown in the interface.
  const ex = difficultyExamples(3, 3);
  assert.ok(ex[0].human < ex[0].standard && ex[0].computer > ex[0].standard, JSON.stringify(ex[0]));
  assert.ok(Math.abs(ex[0].standard - 0.5) < 1e-12);
});

test('a high number is never assumed good: the judge decides (a roll where LOW results help the roller)', () => {
  const s = withOptions(new Pos().start(), 'B', 3, 3);
  // A roll where 1-2 is good for the human (A): at the strongest settings 1-2 becomes LESS likely.
  const lowGood = tiltedChance(s, 'A', [6], (f) => f[0] <= 2, (f) => (f[0] <= 2 ? 1 : -1));
  assert.ok(lowGood < 1 / 3 - 0.05, `low results good for the human are made rarer: ${lowGood}`);
  // The same faces judged good for the computer (B): more likely.
  const lowCpu = tiltedChance(s, 'B', [6], (f) => f[0] <= 2, (f) => (f[0] <= 2 ? 1 : -1));
  assert.ok(lowCpu > 1 / 3 + 0.03, `…and good for the computer, more common: ${lowCpu}`);
});

test('weighted rolls follow the displayed probabilities; reproducible from the seed; Off = the standard generator', () => {
  const s = withOptions(new Pos().start(), 'B', 3, 0);
  const judge = (v: number) => (v >= 4 ? 1 : -1);
  const ctx = (seed: number) => new Ctx(s, new RngDice({ seed, counter: 0 }), 'execute', [], DEFAULT_POLICY, null);
  const run = (seed: number, n: number) => {
    const x = ctx(seed);
    let k = 0;
    for (let i = 0; i < n; i++) if (x.roll({ dice: [6], interpret: ([f]) => f, by: 'A', judge }).value >= 4) k++;
    return k / n;
  };
  const expected = 0.325 / 0.825;
  assert.ok(Math.abs(run(7, 120000) - expected) < 0.006, `observed vs ${expected}`);
  const seq = (seed: number) => {
    const x = ctx(seed);
    return Array.from({ length: 300 }, () => x.roll({ dice: [6], interpret: ([f]) => f, by: 'A', judge }).value);
  };
  assert.deepEqual(seq(42), seq(42));
  assert.ok(new Set(seq(43)).size === 6, 'every face occurs');
  // Off: exactly the V3 generator.
  const off = withOptions(new Pos().start(), 'B', 0, 0);
  const a = new Ctx(off, new RngDice({ seed: 99, counter: 0 }), 'execute', [], DEFAULT_POLICY, null);
  const rng = { seed: 99, counter: 0 };
  for (let i = 0; i < 2000; i++) assert.equal(a.roll({ dice: [6], interpret: ([f]) => f, by: 'A', judge }).value, rollDie(rng, 6));
  const mk = (difficulty?: { player: number; computer: number }) => createMatch('league', team('a', 'tombKings'), team('b', 'bretonnian'), { rules: 'full', computer: { team: 'B' }, ...(difficulty ? { difficulty } : {}) }, 1234).state as GameState;
  const r1 = execute(mk(), { kind: 'pregame' });
  const r2 = execute(mk({ player: 0, computer: 0 }), { kind: 'pregame' });
  assert.deepEqual(r1.events.map((e) => e.text), r2.events.map((e) => e.text));
  assert.equal(r1.state.rng.counter, r2.state.rng.counter);
});

test('separate settings; nothing outside matches against the computer; neutral rolls never weighted', () => {
  const s = new Pos().start();
  assert.equal(difficultyFactors(s, 'A'), null, 'practice position: standard dice');
  withOptions(s, null, 3, 3);
  assert.equal(difficultyFactors(s, 'A'), null, 'two human coaches: standard dice even if a setting were stored');
  withOptions(s, 'B', 3, 0);
  assert.deepEqual(difficultyFactors(s, 'A'), { good: 0.65, bad: 1 });
  assert.deepEqual(difficultyFactors(s, 'B'), { good: 1, bad: 0.65 }, 'the computer setting Off: its results only shift because the human side’s are handicapped');
  const hot = createMatch('league', team('a', 'human'), team('b', 'orc'), { rules: 'full', difficulty: { player: 3, computer: 3 } }, 5).state as GameState;
  assert.equal(difficultyFactors(hot, 'A'), null, 'createMatch drops the setting when no side is the computer');
  // Neutral rolls (no judge: scatter, weather…) keep their distribution at the strongest settings.
  withOptions(s, 'B', 3, 3);
  const ctx = new Ctx(s, new RngDice({ seed: 3, counter: 0 }), 'execute', [], DEFAULT_POLICY, null);
  const count = (spec: RollSpec<number>, sides: number, n: number) => {
    const k = new Array(sides).fill(0);
    for (let i = 0; i < n; i++) k[ctx.roll(spec).value - 1]++;
    return k.map((x) => x / n);
  };
  count({ dice: [8], interpret: ([f]) => f }, 8, 60000).forEach((f) => assert.ok(Math.abs(f - 1 / 8) < 0.008, `D8 face ${f}`));
  count({ dice: [6], interpret: ([f]) => f, by: 'A' }, 6, 60000).forEach((f) => assert.ok(Math.abs(f - 1 / 6) < 0.008, `an unjudged D6 is neutral: ${f}`));
  count({ dice: [6], interpret: ([f]) => f, by: 'A', judge: () => 0 }, 6, 60000).forEach((f) => assert.ok(Math.abs(f - 1 / 6) < 0.008, `mutually neutral results stay neutral: ${f}`));
});

test('previews use the same odds as the rolls (a Dodge by the human coach, Strong handicap)', () => {
  const b = new Pos({ rerollsA: 0 });
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1' });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1' });
  const s = withOptions(b.start(), 'B', 3, 0);
  const input = { kind: 'playerAction' as const, playerId: 'A1', action: 'move' as const, path: [{ to: c(9, 7), kind: 'step' as const }] };
  const plan = planAction(s, input);
  assert.ok(plan.ok, plan.errors?.join(' '));
  const dodge = plan.steps.find((st) => st.kind === 'dodge')!;
  const mod = dodge.mods.reduce((a, m) => a + m.value, 0);
  const std = d6SuccessProbW(dodge.target as number, mod);
  const expected = (std * 0.65) / (std * 0.65 + (1 - std));
  assert.ok(Math.abs((dodge.pSingle as number) - expected) < 1e-12, `step chance ${dodge.pSingle} vs ${expected}`);
  assert.ok(Math.abs((plan.withoutTeamRerolls?.pCompleted ?? 0) - expected) < 1e-9, 'whole-plan chance (enumeration) matches');
  let ok = 0;
  const N = 4000;
  for (let i = 0; i < N; i++) {
    const x = withOptions(b.start(), 'B', 3, 0);
    x.rng = { seed: 1000 + i, counter: 0 };
    const r = execute(x, input);
    if (r.status !== 'turnover') ok++;
  }
  assert.ok(Math.abs(ok / N - expected) < 0.025, `observed ${ok / N} vs previewed ${expected}`);
  const stdPlan = planAction(withOptions(b.start(), 'B', 0, 0), input);
  assert.ok((stdPlan.withoutTeamRerolls?.pCompleted ?? 0) > expected + 0.05);
});

test('Block dice are weighed by the face the choosing coach would take; the Block preview equals the executed frequencies', () => {
  // A human (A) Lineman blocks an equal Orc Lineman with one assist: two dice, the human chooses.
  const pos = () => {
    const b = new Pos({ rerollsA: 0 });
    b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1' });
    b.add('A', 'human', 'lineman', c(11, 6), { id: 'A2' });
    b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1' });
    return b;
  };
  const input = { kind: 'playerAction' as const, playerId: 'A1', action: 'block' as const, path: [], blockTarget: 'B1' };
  const std = planAction(withOptions(pos().start(), 'B', 0, 0), input);
  const hard = planAction(withOptions(pos().start(), 'B', 3, 3), input);
  assert.ok(std.block && hard.block);
  assert.equal(hard.block!.dice, 2);
  // Standard: both dice Player Down / Both Down = (2/6)^2 = 1/9; harder for the human now.
  const badStd = (std.block!.chosen.playerDown ?? 0) + (std.block!.chosen.bothDown ?? 0);
  const badHard = (hard.block!.chosen.playerDown ?? 0) + (hard.block!.chosen.bothDown ?? 0);
  assert.ok(Math.abs(badStd - 1 / 9) < 1e-12, `standard ${badStd}`);
  assert.ok(badHard > badStd + 0.03, `human handicap on its Block: ${badHard} vs ${badStd}`);
  // Executed: the attacker's Turnover rate matches the preview (no Block skill: Player Down / Both Down fall).
  let fell = 0;
  const N = 5000;
  for (let i = 0; i < N; i++) {
    const x = withOptions(pos().start(), 'B', 3, 3);
    x.rng = { seed: 77 + i, counter: 0 };
    let r = execute(x, input);
    while (r.status === 'awaitingDecision' && r.decision) {
      const req = r.decision;
      const pick = req.type === 'blockDie' ? ['pow', 'stumble', 'push', 'bothDown', 'playerDown'].find((f) => req.options.some((o) => o.id === f))! : req.options[0].id;
      r = Engine.decide(r.state, { requestId: req.id, optionId: pick });
    }
    if (r.status === 'turnover') fell++;
  }
  assert.ok(Math.abs(fell / N - badHard) < 0.02, `observed ${fell / N} vs previewed ${badHard}`);
  // The computer (B) blocking the human: its good faces are more likely.
  const cpu = () => {
    const b = new Pos({ rerollsA: 0 });
    b.add('B', 'orc', 'lineman', c(10, 7), { id: 'B1' });
    b.add('B', 'orc', 'lineman', c(11, 6), { id: 'B2' });
    b.add('A', 'human', 'lineman', c(11, 7), { id: 'A1' });
    const s = b.start();
    s.turn.active = 'B';
    return s;
  };
  const cStd = planAction(withOptions(cpu(), 'B', 0, 0), { kind: 'playerAction', playerId: 'B1', action: 'block', path: [], blockTarget: 'A1' });
  const cHard = planAction(withOptions(cpu(), 'B', 3, 3), { kind: 'playerAction', playerId: 'B1', action: 'block', path: [], blockTarget: 'A1' });
  assert.ok((cHard.block!.chosen.pow ?? 0) > (cStd.block!.chosen.pow ?? 0) + 0.03, 'the computer’s POW more likely');
});

test('Armour Rolls are judged by who they help: against the human side more often broken, against the computer side less', () => {
  const breaks = (victimTeam: 'A' | 'B', player: number, cpu: number) => {
    let n = 0;
    for (let i = 0; i < 6000; i++) {
      const b = new Pos();
      const v = b.add(victimTeam, 'human', 'lineman', c(10, 7), { id: `${victimTeam}1` });
      const s = withOptions(b.start(), 'B', player, cpu);
      const ctx = new Ctx(s, new RngDice({ seed: 500 + i, counter: 0 }), 'execute', [], DEFAULT_POLICY, null);
      armourAndInjury(ctx, s.players.find((q) => q.id === v.id)!, { kind: 'knockedDown', reason: 'test' });
      if (ctx.events.some((e) => e.type === 'roll' && /Injury Roll/.test(e.text))) n++;
    }
    return n / 6000;
  };
  const std = breaks('A', 0, 0);
  assert.ok(Math.abs(std - 10 / 36) < 0.03, `standard: ${std}`);
  assert.ok(breaks('A', 3, 3) > std + 0.06, 'a human player’s armour breaks more often');
  assert.ok(breaks('B', 3, 3) < std - 0.04, 'a computer player’s armour breaks less often (the human rolls it: its good result is handicapped)');
});

import * as Engine from '../src/engine/index';
