/** Regression for continuation-state collisions in the public explore interface. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as E from '../src/engine/index';
import type { ActionInput, GameState } from '../src/engine/index';
import { bindEngine } from '../src/ai/index';
import { Session, callService, DEFAULT_LIMITS, observe } from '../src/platform/index';
import { positionKey } from '../src/platform/explore';
import { analysisView, canonical } from '../src/platform/analysis';
bindEngine(E);

const close = (a: number, b: number, message = '') => assert.ok(Math.abs(a - b) < 1e-10, `${message}: ${a} != ${b}`);
function fixture(id: string, rr = 0): { state: GameState; input: ActionInput } {
  const skill = id === 'ordinaryBlock' ? null : id === 'ttm' ? 'throwTeamMate' : id;
  const state = E.buildScenario({ teams: { A: { name: 'A', roster: 'human' }, B: { name: 'B', roster: 'human' } }, rerolls: { A: rr, B: rr }, players: [
    { id: 'actor', team: 'A', roster: 'human', position: 'lineman', at: [8, 7], extraSkills: skill ? [{ id: skill }] : [] },
    { id: 'mate', team: 'A', roster: 'human', position: 'lineman', at: [8, 8], extraSkills: [{ id: 'rightStuff' }] },
    { id: 'foe', team: 'B', roster: 'human', position: 'lineman', at: [9, 7] },
  ], ball: { at: [20, 12] } }, 13);
  state.players[0].st = 5; state.players[0].pa = 2; state.players[1].st = 2;
  if (id === 'ballAndChain') state.players[0].ma = 1;
  const target = id === 'ordinaryBlock' ? { blockTarget: 'foe' } : id === 'bombardier' ? { bombTarget: { x: 12, y: 7 } }
    : id === 'ttm' ? { thrownPlayerId: 'mate', throwTarget: { x: 12, y: 7 } }
    : id === 'ballAndChain' ? { facing: 'x+' } : { specialTarget: 'foe' };
  return { state, input: { kind: 'playerAction', playerId: 'actor', action: id === 'ordinaryBlock' ? 'block' : id === 'ttm' ? 'ttm' : 'special', ...(id === 'ordinaryBlock' || id === 'ttm' ? {} : { special: id }), path: [], ...target } as ActionInput };
}
const key = (s: GameState) => positionKey(s, false, null);

test('outcome identity distinguishes full stance, location, activation, resources and future state fields', () => {
  const { state } = fixture('hypnoticGaze');
  // Use a real completed action to get every baseline activation flag.
  let base = state;
  E.exploreOutcomes(state, fixture('hypnoticGaze').input, { maxLeaves: 100, threshold: 1e-6, followUp: true }, l => { base = E.cloneState(l.state); });
  const mutations: Array<[string, (s: GameState) => void]> = [
    ['standing/stunned', s => { s.players[2].stance = 'stunned'; }],
    ['full location', s => { s.players[2].location = 'sentOff'; }],
    ['distracted', s => { s.players[2].distracted = !s.players[2].distracted; }],
    ['usage', s => { s.players[2].usage.dodgeReroll = true; }],
    ['rooted', s => { s.players[2].rooted = true; }],
    ['eyeGouged', s => { s.players[2].eyeGouged = true; }],
    ['chompedBy', s => { s.players[2].chompedBy = 'actor'; }],
    ['starUsed', s => { s.players[2].starUsed = ['game']; }],
    ['temporary skill', s => { s.players[2].skills.push({ id: 'block', until: 'activation' }); }],
    ['profile', s => { s.players[2].st++; }],
    ['proUsed', s => { s.turn.activation!.proUsed = true; }],
    ['ballActionDone', s => { s.turn.activation!.ballActionDone = true; }],
    ['specialDone', s => { s.turn.activation!.specialDone = false; }],
    ['bloodlust', s => { s.turn.activation!.bloodlust = 'hungry'; }],
    ['starFlags', s => { s.turn.activation!.starFlags = ['gored']; }],
    ['leaderReroll', s => { s.teams.A.leaderReroll = !s.teams.A.leaderReroll; }],
    ['bonusRerolls', s => { s.teams.A.bonusRerolls = 1; }],
    ['mascotReroll', s => { s.teams.A.mascotReroll = true; }],
    ['induceUsed', s => { s.teams.A.induceUsed = { weatherMage: 1 }; }],
    ['wizardDeclined', s => { s.turn.wizardDeclined = ['A']; }],
    ['stunnedAtStart', s => { s.turn.stunnedAtStart = ['foe']; }],
    ['phase', s => { s.phase = 'halfOver'; }],
    ['weather', s => { s.weather = 'blizzard'; }],
    ['future public field', s => { (s as any).futureContinuationFlag = true; }],
  ];
  for (const [label, mutate] of mutations) { const changed = E.cloneState(base); mutate(changed); assert.notEqual(key(changed), key(base), label); }
});

test('equivalent states merge despite object insertion order or volatile history/RNG/clock/title', () => {
  const { state } = fixture('ordinaryBlock');
  const other = E.cloneState(state);
  other.rng = { seed: 99, counter: 100 }; other.log = [{}] as any; other.clock = { totalMs: 9, A: 4, B: 5 }; other.title = 'display';
  other.turn.used = Object.fromEntries(Object.entries(other.turn.used).reverse()) as typeof other.turn.used;
  assert.equal(key(other), key(state));
  assert.notEqual(positionKey(state, true, null), positionKey(state, false, null));
  assert.notEqual(positionKey(state, false, 'A'), positionKey(state, false, null));
});

for (const id of ['ordinaryBlock', 'hypnoticGaze', 'chainsaw', 'bombardier', 'ballAndChain', 'ttm']) for (const rr of [0, 1]) {
  test(`${id} (${rr} RR): groups preserve raw leaf states/mass; retained keys match actual continuation`, () => {
    const { state, input } = fixture(id, rr), before = JSON.stringify(state);
    const ses = new Session(state, 'A', 321, 60000, { ...DEFAULT_LIMITS, maxOutcomesPerCall: 256 });
    const groups = new Map<string, { p: number; observation: unknown }>();
    const threshold = id === 'ordinaryBlock' ? 1e-6 : 1e-4;
    const raw = E.exploreOutcomes(state, input, { maxLeaves: 6000, threshold, followUp: true }, leaf => {
      const semantic = canonical({ state: analysisView(leaf.state), turnover: leaf.turnover, touchdown: leaf.touchdown, completed: leaf.completed });
      const g = groups.get(semantic);
      if (g) g.p += leaf.p; else groups.set(semantic, { p: leaf.p, observation: observe(leaf.state, 'A', 321) });
    });
    assert.ok(raw.ok, `${id}: ${raw.errors.join('; ')}`);
    const ex = callService(ses, 'explore', [input, { threshold, maxLeaves: 6000, maxMs: 15000, maxKeep: 256, maxOutcomes: 256 }]) as any;
    assert.ok(ex.ok, JSON.stringify(ex));
    assert.equal(ex.outcomeIdentity, 'complete-state-v1');
    close(ex.enumerated, raw.explored, 'enumerated'); assert.equal(ex.leaves, raw.leaves);
    for (const out of ex.outcomes) {
      assert.ok(out.key, 'retained fixture key');
      const retained = ses.position(out.key).state;
      const semantic = canonical({ state: analysisView(retained), turnover: out.turnover, touchdown: out.touchdown, completed: out.completed });
      const expected = groups.get(semantic); assert.ok(expected, 'retained state must equal an actual raw leaf');
      close(out.p, expected!.p, 'group mass'); assert.deepEqual(out.observation, expected!.observation);
      assert.deepEqual(out.observation, observe(retained, 'A', 321));
      const zones = callService(ses, 'threats.tackleZones', [{ from: out.key }]) as any;
      assert.ok(zones.ok, 'real service can continue from retained key');
    }
    if (groups.size <= 256) assert.equal(ex.outcomes.length, groups.size, 'all distinct semantic groups');
    close(ex.outcomes.reduce((p: number, x: any) => p + x.p, 0) + ex.rest.p, 1, 'mass plus rest');
    assert.equal(JSON.stringify(state), before, 'root and RNG unchanged');
    if (id === 'ordinaryBlock' && rr === 0) {
      assert.equal(raw.leaves, 75); assert.equal(raw.unresolved, 0);
      const matching = (stance: string) => ex.outcomes.filter((x: any) => { const p = x.observation.players.find((q: any) => q.id === 'foe'); return p.stance === stance && p.pos?.x === 10 && p.pos?.y === 7; }).reduce((p: number, x: any) => p + x.p, 0);
      close(matching('standing'), 1 / 3, 'standing branch'); close(matching('stunned'), .09002057613168729, 'stunned branch');
      assert.ok(groups.size < raw.leaves, 'truly equivalent leaves still merge');
    }
    if (id === 'hypnoticGaze' && rr === 0) {
      assert.equal(ex.outcomes.length, 2);
      for (const out of ex.outcomes) {
        const target = out.observation.players.find((p: any) => p.id === 'foe');
        close(out.p, target.distracted ? 2 / 3 : 1 / 3); assert.equal(target.tackleZone, !target.distracted);
        const move = { kind: 'playerAction', playerId: 'mate', action: 'move', path: [{ to: { x: 7, y: 8 }, kind: 'step' }] };
        const follow = callService(ses, 'plan', [move, out.key]) as any;
        const direct = E.planAction(ses.position(out.key).state, move as ActionInput, { followUp: true });
        assert.equal(follow.ok, direct.ok);
        assert.deepEqual(follow.withTeamRerolls, direct.withTeamRerolls, 'follow-up plan uses the retained state exactly');
      }
    }
  });
}

test('identity marker also accompanies scalar-only explore results', () => {
  const { state, input } = fixture('hypnoticGaze');
  const r = callService(new Session(state, 'A', 10, 60000), 'explore', [input, { maxOutcomes: 0 }]) as any;
  assert.ok(r.ok); assert.equal(r.outcomeIdentity, 'complete-state-v1'); assert.deepEqual(r.outcomes, []);
});

for (const id of ['hypnoticGaze', 'chainsaw']) for (const decisions of ['adversarial', 'optimistic']) {
  test(`${id}: ${decisions} lists only reachable solved outcomes with total probability one`, () => {
    const { state, input } = fixture(id, 1);
    const ses = new Session(state, 'A', 99, 60000);
    const r = callService(ses, 'explore', [input, { decisions, threshold: 1e-6, maxLeaves: 6000, maxOutcomes: 40, maxMs: 15000 }]) as any;
    assert.ok(r.ok, JSON.stringify(r)); assert.equal(r.exact, true);
    close(r.outcomes.reduce((p: number, o: any) => p + o.p, 0) + r.rest.p, 1, 'solved distribution mass');
    close(r.outcomes.reduce((v: number, o: any) => v + o.p * o.value, 0) + r.rest.p * r.rest.value, r.value, 'solved weighted value');
    if (id === 'hypnoticGaze') {
      // Default evaluation chooses the re-roll after a failure: failure without spending it is unreachable.
      assert.ok(!r.outcomes.some((o: any) => !o.observation.players.find((p: any) => p.id === 'foe').distracted && o.observation.rerolls.A === 1));
    }
  });
}

test('equal continuation states with different completion flags are distinct outcomes', () => {
  const { state } = fixture('hypnoticGaze');
  assert.notEqual(positionKey(state, false, null, true), positionKey(state, false, null, false));
});
