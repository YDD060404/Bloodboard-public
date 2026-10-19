/**
 * Match Lab v2 planning: fixed / random teams, seed modes, swapped pairs (N pairs = 2N games, same seed and snapshots,
 * coach and team assignments swapped together), separate generators for team choice and dice seeds, team snapshots,
 * replay of a recorded match, concurrency defaults.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Engine from '../src/engine/index';
import { bindEngine, waitingFor, nextMove } from '../src/ai/index';
import { planBatch, cpuPlan, countText, prng, type BatchSpec, type TeamSource } from '../src/platform/research/labplan';
import { replayHistory, type ReplayStep } from '../src/platform/research/match';

bindEngine(Engine);

const src = (id: string): TeamSource => ({ key: `draft:${id}`, kind: 'roster', roster: `draft:${id}`, label: id });
const sources = ['human', 'orc', 'dwarf', 'elvenUnion'].map(src);
const base: BatchSpec = { format: 'sevens', mode: 'exhibition', rules: 'full', build: {}, teams: { kind: 'fixed', p1: 'draft:human', p2: 'draft:orc' }, seeds: { kind: 'base', base: 10 }, pairing: 'none', count: 3 };

test('fixed teams, consecutive seeds, independent games: P1 is side A', () => {
  const p = planBatch(base, sources);
  assert.equal(p.games.length, 3);
  assert.deepEqual(p.games.map((g) => g.seed), [10, 11, 12]);
  assert.ok(p.games.every((g) => g.coach.A === 0 && g.coach.B === 1 && g.leg === null && g.pair === null));
  assert.equal(Object.keys(p.snapshots).length, 2);
});

test('swapped pairs: N pairs = 2N games; same seed and the same snapshots; coach and team swap together', () => {
  const p = planBatch({ ...base, pairing: 'swap', count: 4, seeds: { kind: 'fresh' }, teams: { kind: 'random', pool: sources.map((s) => s.key) } }, sources);
  assert.equal(p.gamesTotal, 8);
  assert.equal(p.pairs, 4);
  for (let i = 0; i < 4; i++) {
    const a = p.games[2 * i];
    const b = p.games[2 * i + 1];
    assert.equal(a.pair, b.pair);
    assert.equal([a.leg, b.leg].join(), '1,2');
    assert.equal(a.seed, b.seed);
    assert.deepEqual(a.teams, { A: b.teams.B, B: b.teams.A });
    assert.deepEqual(a.coach, { A: b.coach.B, B: b.coach.A });
    assert.deepEqual(a.slots, { A: b.slots.B, B: b.slots.A });
    assert.equal(a.coach.A, 0);
  }
  assert.equal(new Set(p.games.map((g) => g.game)).size, 8, 'game ids are unique');
  assert.equal(countText('swap', 4).startsWith('4 pairs = 8 games'), true);
});

test('seed list decides the count; fresh seeds and team choice use separate generators', () => {
  const l = planBatch({ ...base, seeds: { kind: 'list', list: [5, 9, 5] }, count: 99 }, sources);
  assert.deepEqual(l.games.map((g) => g.seed), [5, 9, 5]);
  // the team draw does not depend on the dice-seed generator and vice versa
  const spec: BatchSpec = { ...base, teams: { kind: 'random', pool: sources.map((s) => s.key) }, seeds: { kind: 'fresh' }, count: 12, teamSeed: 77, seedBase: 1 };
  const a = planBatch(spec, sources);
  const b = planBatch({ ...spec, seedBase: 2 }, sources);
  assert.deepEqual(a.games.map((g) => [g.teams.A, g.teams.B]), b.games.map((g) => [g.teams.A, g.teams.B]), 'same team seed, same teams');
  assert.notDeepEqual(a.games.map((g) => g.seed), b.games.map((g) => g.seed));
  const c = planBatch({ ...spec, teamSeed: 78 }, sources);
  assert.deepEqual(a.games.map((g) => g.seed), c.games.map((g) => g.seed), 'same dice generator, same seeds');
  assert.deepEqual(planBatch(spec, sources).games, a.games, 'the plan is deterministic given its recorded seeds');
  assert.ok(new Set(a.games.map((g) => g.teams.A)).size > 1, 'random pool actually varies');
});

test('snapshots are complete legal teams; budget / tier / skills / inducements are applied and checked', () => {
  const p = planBatch({ ...base, mode: 'tournament', build: { tier: 2, skills: true }, count: 1 }, sources);
  for (const s of Object.values(p.snapshots)) {
    assert.equal(Engine.validateTeamDef(s.def).filter((i) => i.level === 'error').length, 0);
    assert.ok((s.def as { tier?: number }).tier === 2);
  }
  const ind = planBatch({ ...base, mode: 'exhibition', build: { inducements: { prayer: 1 } }, count: 1 }, sources);
  assert.equal(Object.values(ind.snapshots)[0].def.inducements?.prayer, 1);
  assert.throws(() => planBatch({ ...base, build: { inducements: { extraTraining: 8 } }, count: 1 }, sources), /./);
  assert.throws(() => planBatch({ ...base, teams: { kind: 'random', pool: [] } }, sources), /pool is empty/);
  assert.throws(() => planBatch({ ...base, count: 0 }, sources), /Nothing to play/);
});

test('mirror gives both coaches the same snapshot', () => {
  const p = planBatch({ ...base, mirror: true, count: 2 }, sources);
  assert.ok(p.games.every((g) => g.teams.A === g.teams.B));
});

test('prng is deterministic; cpuPlan fits a 10-core / 16 GiB Mac and a 2-core box', () => {
  const r = prng(5);
  const r2 = prng(5);
  assert.equal(r(), r2());
  const mac = cpuPlan(10, 16, ['builtin', 'builtin']);
  assert.deepEqual([mac.games, mac.workers], [5, 5], 'built-in coaches: one game per worker, limited by memory (half of 16 GiB at 1.6 GiB per game+worker)');
  assert.deepEqual([cpuPlan(10, 64, ['builtin']).games, cpuPlan(10, 64, ['builtin']).workers], [8, 8], 'with plenty of memory: two cores left free');
  const macMod = cpuPlan(10, 16, ['builtin', 'module']);
  assert.ok(macMod.games + macMod.workers <= 8, `${macMod.games}+${macMod.workers} leaves two cores free (modules use a thread per game)`);
  assert.ok(cpuPlan(10, 4, ['builtin']).workers <= 1, 'memory limits the workers');
  const small = cpuPlan(2, 8, ['module']);
  assert.deepEqual([small.games, small.workers], [1, 1]);
});

test('a recorded sequence of engine inputs replays to the same match', () => {
  // play a short prefix with the built-in coach, record the inputs, replay from the same teams and seed
  const p = planBatch({ ...base, count: 1 }, sources);
  const g = p.games[0];
  const teams = { A: p.snapshots[g.teams.A].def, B: p.snapshots[g.teams.B].def };
  const cm = Engine.createMatch('tournament', JSON.parse(JSON.stringify(teams.A)), JSON.parse(JSON.stringify(teams.B)), { rules: 'full' }, g.seed);
  assert.ok(cm.ok);
  let s = (cm as { state: Engine.GameState }).state;
  const steps: ReplayStep[] = [];
  for (let i = 0; i < 40 && s.phase !== 'fullTime'; i++) {
    const who = waitingFor(s);
    let out: Engine.ExecutionResult;
    if (!who) {
      const input = s.phase === 'pregame' ? ({ kind: 'pregame' } as const) : ({ kind: 'nextDrive' } as const);
      steps.push({ k: 'neutral', input });
      out = Engine.execute(s, input);
    } else {
      const mv = nextMove(s, who, 'balanced');
      if (!mv) throw new Error('no move');
      if (mv.type === 'decision') {
        steps.push({ k: 'decide', team: who, requestId: String(mv.requestId), optionId: mv.optionId, thinkMs: 0 });
        out = Engine.decide(s, { requestId: mv.requestId, optionId: mv.optionId });
      } else if (mv.type === 'step' || mv.type === 'action') {
        steps.push({ k: 'input', team: who, input: mv.input, thinkMs: 0 });
        out = Engine.execute(s, mv.input);
      } else throw new Error('unexpected move');
    }
    assert.notEqual(out.status, 'illegal');
    s = out.state as Engine.GameState;
  }
  const r = replayHistory(teams, g.seed, 'full', steps);
  assert.equal(r.error, undefined);
  assert.equal(r.applied, steps.length);
  assert.equal(JSON.stringify(r.state.log), JSON.stringify(s.log), 'the dice log is identical');
  assert.equal(r.state.phase, s.phase);
});
