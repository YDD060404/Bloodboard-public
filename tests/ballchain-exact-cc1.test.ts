/**
 * Engine candidate cc1: the exact ball-chain solver (src/engine/ball.ts solveBallChain) must return EXACTLY what the
 * Bloodboard 7.0.1 string-keyed solver returns (tests/fixtures/ball-701-reference.ts, a verbatim copy): the same
 * outcomes in the same order, the same keys, probabilities equal to the last bit, the same holder / rest square /
 * Quick Bite flag and re-roll record (team, leader, pro, Team Captain free count, mascot, used resources) by value, and
 * the same unresolved mass. Covers the Team Captain free-natural-6 branch (rr.free), the Mascot (+ Captain under FAQ
 * 2026), Leader, Pro, skill / star re-rolls, Griff's +1, Guffle's Quick Bite, Sevens Veterans and throw-ins, Diving
 * Catch, every arrival kind, the difficulty house rule, the three re-roll policies, and seeded random crowded boards.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveBallChain, clearChainCache } from '../src/engine/ball';
import { solveBallChain as reference, clearChainCache as clearReference, bounce as refBounce, ballArrives as refArrives, throwIn as refThrowIn } from './fixtures/ball-701-reference';
import { bounce as candBounce, ballArrives as candArrives, throwIn as candThrowIn } from '../src/engine/ball';
import { Ctx, DEFAULT_POLICY } from '../src/engine/context';
import { TraceDice, type ChoiceOutcome } from '../src/engine/dice';
import { cloneState } from '../src/engine/state';
import type { GameState, Player, TeamId } from '../src/engine/types';
import { exploreOutcomes, planAction, type ActionInput } from '../src/engine/index';
import { usePitch } from '../src/engine/variant';
import { Pos } from './helpers';

type Start = Parameters<typeof solveBallChain>[1];
type Policy = Parameters<typeof solveBallChain>[2];
const c = (x: number, y: number) => ({ x, y });
const POLICIES: Policy[] = [
  { useSkillRerolls: true, usePro: true, useTeamRerolls: true },
  { useSkillRerolls: true, usePro: true, useTeamRerolls: false },
  { useSkillRerolls: false, usePro: false, useTeamRerolls: true },
  { useSkillRerolls: false, usePro: true, useTeamRerolls: true },
];
const sorted = (x: unknown): unknown => (Array.isArray(x) ? x.map(sorted) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sorted((x as Record<string, unknown>)[k])])) : x);

/** Bit-exact comparison of two solver results; returns the number of outcomes compared. */
function assertSame(s: GameState, start: Start, policy: Policy, what: string): number {
  clearChainCache();
  clearReference();
  usePitch(s); // the pitch / D6-edition globals follow the board under test (both solvers read them)
  const want = reference(s, start, policy);
  const got = solveBallChain(s, start, policy);
  const at = `${what} ${JSON.stringify(start)} ${JSON.stringify(policy)}`;
  assert.equal(got.outcomes.length, want.outcomes.length, `${at}: outcome count`);
  assert.ok(Object.is(got.unresolved, want.unresolved), `${at}: unresolved ${got.unresolved} v ${want.unresolved}`);
  for (let i = 0; i < want.outcomes.length; i++) {
    const g = got.outcomes[i], w = want.outcomes[i];
    assert.equal(g.key, w.key, `${at}: key[${i}]`);
    assert.ok(Object.is(g.p, w.p), `${at}: p[${i}] ${g.key} ${g.p} v ${w.p}`);
    assert.deepEqual(Object.keys(g), Object.keys(w), `${at}: fields[${i}]`);
    assert.equal(g.holder, w.holder);
    assert.equal(g.bite, w.bite);
    assert.deepEqual(g.rest, w.rest);
    assert.deepEqual(sorted(g.rr), sorted(w.rr), `${at}: rr[${i}] ${g.key}`);
    assert.equal(g.rr.free, w.rr.free, `${at}: free[${i}] (presence and value)`);
  }
  // Strictest form: the whole result serialises to the same JSON text (property order of every record included).
  assert.equal(JSON.stringify(got), JSON.stringify(want), `${at}: JSON text`);
  return want.outcomes.length;
}

function captain(s: GameState, p: Player): void {
  s.teams[p.team].specialRules = [...(s.teams[p.team].specialRules ?? []).filter((r) => r !== 'Team Captain'), 'Team Captain'];
  for (const q of s.players) if (q.team === p.team) q.captain = false;
  p.captain = true;
}

/** A crowded midfield: the drafted-Human-with-Captain situation of the recorded slow decisions (batch H, B1). */
function crowd(o: { rerolls?: number; capt?: boolean; leader?: boolean; mascot?: boolean; faq?: boolean } = {}): { s: GameState; carrier: Player } {
  const b = new Pos({ rerollsA: o.rerolls ?? 3, rerollsB: 2, active: 'A' });
  const carrier = b.add('A', 'human', 'catcher', c(12, 7), { id: 'A1' });
  const cap = b.add('A', 'human', 'blitzer', c(11, 6), { id: 'A2' });
  b.add('A', 'human', 'lineman', c(13, 8), { id: 'A3' });
  b.add('A', 'human', 'thrower', c(10, 8), { id: 'A4', extraSkills: o.leader ? [{ id: 'leader' }] : [] });
  b.add('A', 'human', 'catcher', c(14, 6), { id: 'A5', extraSkills: [{ id: 'divingCatch' }] });
  b.add('B', 'orc', 'lineman', c(12, 6), { id: 'B1' });
  b.add('B', 'orc', 'blitzer', c(13, 7), { id: 'B2' });
  b.add('B', 'orc', 'lineman', c(11, 8), { id: 'B3' });
  b.add('B', 'orc', 'bigUn', c(13, 6), { id: 'B4' });
  b.add('B', 'orc', 'lineman', c(10, 6), { id: 'B5', stance: 'prone' });
  b.give(carrier);
  const s = b.start();
  // Pos boards start in the FAQ 2026 edition; faq: false really switches to the legacy (pre-FAQ) rules.
  if (o.faq === false) delete (s as { rulesEdition?: string }).rulesEdition;
  else if (o.faq) s.rulesEdition = 'faq2026';
  if (o.capt !== false) captain(s, s.players.find((p) => p.id === 'A2')!);
  s.teams.A.leaderReroll = !!o.leader;
  s.teams.A.mascotReroll = !!o.mascot;
  return { s, carrier: s.players.find((p) => p.id === 'A1')! };
}

test('cc1 exact chain: Team Captain crowd, every start square and re-roll count, all policies', () => {
  let n = 0;
  for (const rerolls of [0, 1, 3]) {
    const { s, carrier } = crowd({ rerolls });
    for (const policy of POLICIES)
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) n += assertSame(s, { t: 'bounce', from: c(carrier.pos!.x + dx, carrier.pos!.y + dy) }, policy, `captain r${rerolls}`);
  }
  assert.ok(n > 1000, `outcomes compared ${n}`);
});

test('cc1 exact chain: the Captain free count is split exactly as before (free > 0 outcomes exist and match)', () => {
  const { s, carrier } = crowd({ rerolls: 3 });
  const policy = POLICIES[0];
  assertSame(s, { t: 'arrive', sq: carrier.pos!, kind: 'pass' }, policy, 'captain pass');
  clearChainCache();
  const res = solveBallChain(s, { t: 'arrive', sq: carrier.pos!, kind: 'pass' }, policy);
  const frees = new Set(res.outcomes.map((o) => o.rr.free ?? 0));
  assert.ok(frees.has(0) && frees.has(1) && frees.has(2), `free counts ${[...frees]}`);
  // Without the Captain no outcome carries a free count.
  const nc = crowd({ rerolls: 3, capt: false }).s;
  clearChainCache();
  assert.ok(solveBallChain(nc, { t: 'arrive', sq: carrier.pos!, kind: 'pass' }, policy).outcomes.every((o) => o.rr.free === undefined));
  assertSame(nc, { t: 'arrive', sq: carrier.pos!, kind: 'pass' }, policy, 'no captain');
});

test('cc1 exact chain: Leader, Mascot and Mascot + Captain (FAQ May 2026), Pro of the active player', () => {
  for (const faq of [false, true])
    for (const o of [{ leader: true }, { mascot: true }, { leader: true, mascot: true, rerolls: 0 }, { mascot: true, rerolls: 0 }]) {
      const { s, carrier } = crowd({ ...o, faq });
      s.turn.activation = { playerId: 'A1', proUsed: false } as never;
      carrier.skills = [...carrier.skills, { id: 'pro' }];
      for (const policy of POLICIES) assertSame(s, { t: 'arrive', sq: carrier.pos!, kind: 'pass' }, policy, `rr ${JSON.stringify(o)} faq=${faq}`);
    }
});

test('cc1 exact chain: Catch, Loner, No Ball, Diving Catch and every arrival kind', () => {
  const { s, carrier } = crowd({ rerolls: 2 });
  carrier.skills = [...carrier.skills, { id: 'catch' }];
  s.players.find((p) => p.id === 'A3')!.skills.push({ id: 'loner', value: 4 } as never);
  s.players.find((p) => p.id === 'B3')!.skills.push({ id: 'noBall' } as never);
  s.players.find((p) => p.id === 'B5')!.skills.push({ id: 'divingCatch' } as never); // prone: may not dive
  s.players.find((p) => p.id === 'B2')!.skills.push({ id: 'divingCatch' } as never); // standing opposing diver
  for (const kind of ['pass', 'passTarget', 'bounce', 'throwIn', 'handoff', 'kick', 'punt', 'setPiece', 'barikA', 'barikB'] as const)
    for (const sq of [carrier.pos!, c(12, 5), c(15, 7), c(13, 8)]) assertSame(s, { t: 'arrive', sq, kind }, POLICIES[0], `arrive ${kind}`);
});

test("cc1 exact chain: Star Players — Guffle's Quick Bite, Griff's +1, Puggy's and Ripper's re-rolls (used resources)", () => {
  for (const [team, star] of [['B', 'guffle'], ['A', 'griff'], ['A', 'puggy'], ['A', 'ripper']] as Array<[TeamId, string]>) {
    const { s, carrier } = crowd({ rerolls: 1 });
    const p = team === 'B' ? s.players.find((q) => q.id === 'B1')! : carrier;
    p.star = star as never;
    p.starUsed = [];
    for (const policy of POLICIES.slice(0, 3)) {
      assertSame(s, { t: 'arrive', sq: carrier.pos!, kind: 'pass' }, policy, `star ${star}`);
      assertSame(s, { t: 'bounce', from: c(12, 8) }, policy, `star ${star}`);
    }
  }
});

test('cc1 exact chain: Sevens throw-ins (D6+2), Veterans and side-line starts', () => {
  const b = new Pos({ rerollsA: 2, rerollsB: 1, active: 'A', sevens: true });
  const a1 = b.add('A', 'human', 'catcher', c(9, 1), { id: 'A1' });
  b.add('A', 'human', 'blitzer', c(10, 1), { id: 'A2' });
  b.add('B', 'orc', 'lineman', c(9, 2), { id: 'B1' });
  b.add('B', 'orc', 'blitzer', c(8, 1), { id: 'B2' });
  b.give(a1);
  const s = b.start();
  s.variant = 'sevens';
  captain(s, s.players.find((p) => p.id === 'A2')!);
  s.players.find((p) => p.id === 'A1')!.veteran = 'ready' as never;
  for (const policy of POLICIES) {
    assertSame(s, { t: 'throwIn', last: c(9, 0), off: c(9, -1) }, policy, 'sevens throw-in');
    assertSame(s, { t: 'bounce', from: c(9, 0) }, policy, 'sevens edge bounce');
    assertSame(s, { t: 'arrive', sq: c(9, 1), kind: 'pass' }, policy, 'veteran catch');
  }
});

test('cc1 exact chain: the difficulty house rule (weighted dice) for both teams', () => {
  for (const [player, cpu, comp] of [[1, 5, 'B'], [5, 1, 'A'], [3, 3, 'B']] as Array<[number, number, TeamId]>) {
    const { s, carrier } = crowd({ rerolls: 2 });
    (s as unknown as { match: unknown }).match = { ...(s.match ?? {}), options: { rules: 'full', computer: { team: comp }, difficulty: { player, computer: cpu } } };
    for (const policy of POLICIES.slice(0, 2)) assertSame(s, { t: 'bounce', from: carrier.pos! }, policy, `difficulty ${player}/${cpu}/${comp}`);
  }
});

test('cc1 exact chain: seeded random crowded boards (rosters, stances, skills, Captain, re-rolls, starts, policies)', () => {
  let seed = 0x5eed1;
  const rnd = () => ((seed = (Math.imul(seed ^ (seed >>> 15), 1 | seed) + 0x6d2b79f5) >>> 0), seed / 4294967296);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
  let solves = 0;
  for (let k = 0; k < 40; k++) {
    const b = new Pos({ rerollsA: Math.floor(rnd() * 3), rerollsB: Math.floor(rnd() * 3), active: rnd() < 0.5 ? 'A' : 'B', seed: 1000 + k });
    const used = new Set<string>();
    const square = () => { for (;;) { const q = c(8 + Math.floor(rnd() * 10), 3 + Math.floor(rnd() * 9)); if (!used.has(`${q.x},${q.y}`)) { used.add(`${q.x},${q.y}`); return q; } } };
    const people: Player[] = [];
    for (const [team, roster, positions] of [['A', 'human', ['lineman', 'catcher', 'blitzer', 'thrower']], ['B', 'orc', ['lineman', 'blitzer']]] as Array<[TeamId, string, string[]]>) {
      const n = 4 + Math.floor(rnd() * 5);
      for (let i = 0; i < n; i++) {
        const extra = [] as Player['skills'];
        if (rnd() < 0.2) extra.push({ id: 'catch' });
        if (rnd() < 0.1) extra.push({ id: 'divingCatch' });
        if (rnd() < 0.08) extra.push({ id: 'pro' });
        if (rnd() < 0.05) extra.push({ id: 'loner', value: 4 } as never);
        if (rnd() < 0.05) extra.push({ id: 'leader' });
        people.push(b.add(team, roster, pick(positions), square(), { id: `${team}${i + 1}`, stance: rnd() < 0.1 ? 'prone' : rnd() < 0.05 ? 'stunned' : 'standing', extraSkills: extra }));
      }
    }
    const holder = people.find((p) => p.stance === 'standing') ?? people[0];
    b.give(holder);
    const s = b.start();
    if (rnd() < 0.5) delete (s as { rulesEdition?: string }).rulesEdition; // legacy edition on about half the boards
    for (const team of ['A', 'B'] as TeamId[]) {
      if (rnd() < 0.6) { const cand = s.players.filter((p) => p.team === team && p.stance === 'standing'); if (cand.length) captain(s, pick(cand)); }
      s.teams[team].leaderReroll = rnd() < 0.3;
      s.teams[team].mascotReroll = rnd() < 0.3;
    }
    if (rnd() < 0.15) { const p = pick(s.players); p.star = pick(['guffle', 'griff', 'puggy', 'ripper']) as never; p.starUsed = []; }
    if (rnd() < 0.3) s.turn.activation = { playerId: pick(s.players.filter((p) => p.team === s.turn.active)).id, proUsed: rnd() < 0.3 } as never;
    const anchor = s.players.find((p) => p.id === holder.id)!.pos!;
    const starts: Start[] = [
      { t: 'bounce', from: c(anchor.x + Math.floor(rnd() * 3) - 1, anchor.y + Math.floor(rnd() * 3) - 1) },
      { t: 'arrive', sq: pick(s.players).pos!, kind: pick(['pass', 'handoff', 'kick', 'throwIn', 'passTarget', 'setPiece'] as const) },
      { t: 'throwIn', last: c(anchor.x, rnd() < 0.5 ? 0 : 14), off: c(anchor.x, rnd() < 0.5 ? -1 : 15) },
    ];
    for (const st of starts) {
      if (st.t === 'throwIn' && ((st.last.y === 0) !== (st.off.y === -1))) continue;
      assertSame(s, st, pick(POLICIES), `random #${k}`);
      solves++;
    }
  }
  assert.ok(solves >= 100, `random solves ${solves}`);
});

test('cc1 exact chain: cache semantics unchanged (same object on a repeated call, recomputed after clearChainCache)', () => {
  const { s, carrier } = crowd({ rerolls: 2 });
  clearChainCache();
  const a = solveBallChain(s, { t: 'bounce', from: carrier.pos! }, POLICIES[0]);
  assert.equal(solveBallChain(s, { t: 'bounce', from: carrier.pos! }, POLICIES[0]), a);
  clearChainCache();
  const b = solveBallChain(s, { t: 'bounce', from: carrier.pos! }, POLICIES[0]);
  assert.notEqual(b, a);
  assert.deepEqual(b, a);
});

test('cc1 exact chain: planner output through planChain is identical with cold and warm chain / choice-list caches', () => {
  const { s } = crowd({ rerolls: 3 });
  const inputs: ActionInput[] = [
    { kind: 'playerAction', playerId: 'A1', action: 'handoff', path: [], handoffTarget: 'A3' } as ActionInput,
    { kind: 'playerAction', playerId: 'A1', action: 'pass', path: [], passTarget: c(14, 6) } as ActionInput,
  ];
  const signature = (input: ActionInput): string => {
    const leaves: string[] = [];
    const r = exploreOutcomes(s, input, { threshold: 1e-9, maxLeaves: 20000 }, (leaf) => {
      leaves.push(`${leaf.p}|${JSON.stringify(leaf.state.ball)}|${leaf.state.teams.A.rerolls}|${leaf.state.teams.A.leaderReroll}|${leaf.state.teams.A.mascotReroll}`);
    });
    assert.ok(r.ok, r.errors.join());
    const plan = planAction(s, input, { threshold: 1e-9 });
    return JSON.stringify({ leaves, r, plan });
  };
  for (const input of inputs) {
    clearChainCache();
    const cold = signature(input);
    const warm = signature(input);
    assert.equal(warm, cold, `${JSON.stringify(input)}: warm caches change nothing`);
    assert.ok(cold.length > 1000);
  }
});

/** A plan-mode dice source that records every choice list it is handed (as JSON) and picks by a fixed rule. */
class Picker extends TraceDice {
  lists: string[] = [];
  constructor(private pickIndex: (outs: ChoiceOutcome<unknown>[]) => number) { super(); }
  override choose<T>(outcomes: ChoiceOutcome<T>[], prefer?: (v: T) => boolean): T {
    this.lists.push(JSON.stringify(outcomes));
    const i = this.pickIndex(outcomes as ChoiceOutcome<unknown>[]);
    return i < 0 ? super.choose(outcomes, prefer) : outcomes[i].value;
  }
}

test('cc1 exact chain: planChain (bounce / arrival / throw-in) equals 7.0.1 — choice list, picked outcome, state, events incl. the Captain note', () => {
  const PICKS: Array<[string, (o: ChoiceOutcome<unknown>[]) => number]> = [
    ['trace (first strict max p, prefer own holder)', () => -1],
    ['first outcome with a Captain free count', (o) => Math.max(0, o.findIndex((x) => ((x.value as { rr: { free?: number } }).rr.free ?? 0) > 0))],
    ['last', (o) => o.length - 1],
    ['middle', (o) => o.length >> 1],
  ];
  let captainNotes = 0, compared = 0;
  const boards: Array<[string, GameState]> = [['captain crowd', crowd({ rerolls: 3 }).s]];
  const g = crowd({ rerolls: 2 }).s;
  const b1 = g.players.find((p) => p.id === 'B1')!;
  b1.star = 'guffle' as never;
  b1.starUsed = [];
  boards.push(['captain + Guffle', g]);
  for (const [name, s] of boards) {
    const car = s.players.find((p) => p.id === 'A1')!.pos!;
    const starts: Array<[string, (ctx: Ctx, ref: boolean) => void]> = [
      ['bounce', (ctx, ref) => (ref ? refBounce : candBounce)(ctx, car)],
      ['bounce +1', (ctx, ref) => (ref ? refBounce : candBounce)(ctx, c(car.x + 1, car.y))],
      ['arrive pass', (ctx, ref) => { (ref ? refArrives : candArrives)(ctx, car, 'pass'); }],
      ['throw-in', (ctx, ref) => (ref ? refThrowIn : candThrowIn)(ctx, c(car.x, 0), c(car.x, -1))],
    ];
    for (const [pname, pick] of PICKS)
      for (const [sname, run] of starts) {
        const out: string[] = [];
        for (const ref of [true, false, false]) { // reference, candidate cold, candidate warm (cached choice list)
          if (ref) { clearReference(); clearChainCache(); }
          const dice = new Picker(pick);
          const ctx = new Ctx(cloneState(s), dice, 'plan', [], { ...DEFAULT_POLICY, ...POLICIES[0] }, null);
          run(ctx, ref);
          captainNotes += ctx.events.filter((e) => /Team Captain/.test(e.text)).length;
          out.push(JSON.stringify({ lists: dice.lists, state: ctx.s, events: ctx.events, unresolved: ctx.unresolvedExtra, bite: ctx.quickBite }));
        }
        assert.equal(out[1], out[0], `${name} / ${sname} / ${pname}: candidate = 7.0.1`);
        assert.equal(out[2], out[0], `${name} / ${sname} / ${pname}: warm candidate = 7.0.1`);
        compared++;
      }
  }
  assert.equal(compared, 32);
  assert.ok(captainNotes > 0, 'the Captain note path was exercised');
});
