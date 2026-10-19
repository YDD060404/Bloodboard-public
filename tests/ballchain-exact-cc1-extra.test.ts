/**
 * Engine candidate cc1, further exactness tests (from the adversarial review): Star / Veteran re-roll spent before a
 * Captain-free Team Re-roll (re-roll record property order used-before-free), a chain still running at the 5000-iteration
 * cap (golden values from the verbatim 7.0.1 solver; full reference comparison with CC1_SLOW=1), the legacy edition really
 * switched on, an opposing standing Diving Catch, and planChain choice lists / applied outcomes v 7.0.1, cold and warm.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveBallChain, clearChainCache, ballArrives, bounce, throwIn } from '../src/engine/ball';
import { solveBallChain as reference, clearChainCache as clearReference, ballArrives as refArrives, bounce as refBounce, throwIn as refThrowIn } from './fixtures/ball-701-reference';
import { Ctx, DEFAULT_POLICY } from '../src/engine/context';
import { cloneState, faq2026 } from '../src/engine/state';
import { pitch, usePitch } from '../src/engine/variant';
import type { DiceSource } from '../src/engine/dice';
import type { GameState, Player } from '../src/engine/types';
import { Pos } from './helpers';

type Start = Parameters<typeof solveBallChain>[1];
type Policy = Parameters<typeof solveBallChain>[2];
const c = (x: number, y: number) => ({ x, y });
const P0: Policy = { useSkillRerolls: true, usePro: true, useTeamRerolls: true };
function assertSame(s: GameState, start: Start, policy: Policy, what: string) {
  clearChainCache();
  clearReference();
  usePitch(s);
  const want = reference(s, start, policy);
  const got = solveBallChain(s, start, policy);
  assert.ok(Object.is(got.unresolved, want.unresolved), `${what}: unresolved ${got.unresolved} v ${want.unresolved}`);
  assert.equal(JSON.stringify(got), JSON.stringify(want), `${what}: JSON text`);
  for (let i = 0; i < want.outcomes.length; i++) assert.ok(Object.is(got.outcomes[i].p, want.outcomes[i].p), `${what}: p[${i}]`);
  return want;
}
function captain(s: GameState, p: Player): void {
  s.teams[p.team].specialRules = [...(s.teams[p.team].specialRules ?? []).filter((r) => r !== 'Team Captain'), 'Team Captain'];
  for (const q of s.players) if (q.team === p.team) q.captain = false;
  p.captain = true;
}
const shape = (r: object) => Object.keys(r).join(',');

// --- 1. `used` BEFORE `free` (record shape 2) and same-key arrivals in both property orders --------------------------
/** Two Marked Human Linemen (NO Catch skill, so the Star / Veteran re-roll is actually reached), Team Captain clear. */
function starBoard(star: 'puggy' | 'ripper' | 'veteran', rerolls: number): GameState {
  const b = new Pos({ rerollsA: rerolls, rerollsB: 0, active: 'A', sevens: star === 'veteran' });
  const a1 = b.add('A', 'human', 'lineman', c(9, 5), { id: 'A1' });
  b.add('A', 'human', 'lineman', c(10, 5), { id: 'A2' });
  b.add('A', 'human', 'blitzer', c(5, 2), { id: 'A3' });
  b.add('B', 'orc', 'lineman', c(9, 4), { id: 'B1' });
  b.add('B', 'orc', 'lineman', c(10, 6), { id: 'B2' });
  b.give(a1);
  const s = b.start();
  captain(s, s.players.find((p) => p.id === 'A3')!);
  const p1 = s.players.find((p) => p.id === 'A1')!;
  if (star === 'veteran') p1.veteran = 'ready' as never;
  else {
    p1.star = star as never;
    p1.starUsed = [];
  }
  return s;
}
test('cc1+ exact chain: Star / Veteran re-roll before a Captain-free Team Re-roll (used before free) and both orders', () => {
  for (const star of ['puggy', 'ripper', 'veteran'] as const)
    for (const rerolls of [1, 2]) {
      const s = starBoard(star, rerolls);
      const shapes = new Set<string>();
      for (const st of [{ t: 'arrive', sq: c(9, 5), kind: 'pass' }, { t: 'bounce', from: c(9, 5) }, { t: 'arrive', sq: c(10, 5), kind: 'pass' }] as Start[]) {
        const want = assertSame(s, st, P0, `${star} r${rerolls} ${JSON.stringify(st)}`);
        for (const o of want.outcomes) shapes.add(shape(o.rr));
      }
      // Guard: the scenario really produces both property orders of a record with free and used.
      assert.ok(shapes.has('team,leader,pro,mascot,used,free'), `${star}: used-before-free reached ${[...shapes]}`);
      assert.ok(shapes.has('team,leader,pro,mascot,free,used'), `${star}: free-before-used reached ${[...shapes]}`);
    }
});

// --- 2. The 5000-iteration cap (unresolved mass left in the frontier) ------------------------------------------------
/** The whole Sevens pitch covered with Prone players (no Tackle Zones: every landing bounces on), one hole at `hole`. */
function trapBoard(hole: { x: number; y: number } | null): GameState {
  const b = new Pos({ rerollsA: 1, rerollsB: 1, active: 'A', sevens: true });
  b.start(); // sets the Sevens pitch
  const g = pitch();
  let n = 0;
  for (let x = 0; x < g.w; x++)
    for (let y = 0; y < g.h; y++) {
      if (hole && hole.x === x && hole.y === y) continue;
      b.add(n % 2 ? 'B' : 'A', n % 2 ? 'orc' : 'human', 'lineman', c(x, y), { id: `P${x}_${y}`, stance: 'prone' });
      n++;
    }
  return b.start();
}
test('cc1+ exact chain: a chain still running at the 5000-iteration cap (golden values from the verbatim 7.0.1 solver)', () => {
  // Golden: tests/fixtures/ball-701-reference.ts solveBallChain on these boards (19 s each there; ~1 s in cc1).
  const golden: Array<[{ x: number; y: number } | null, string, number]> = [
    [c(0, 0), 'rest:0,0|1|0|0|0|0|=0.5816792899047565', 0.4183207100952352],
    [null, '', 0.9999999999999932],
  ];
  for (const [hole, outs, unresolved] of golden) {
    const s = trapBoard(hole);
    clearChainCache();
    usePitch(s);
    const got = solveBallChain(s, { t: 'bounce', from: c(9, 5) }, P0);
    assert.equal(got.outcomes.map((o) => `${o.key}=${o.p}`).join(' '), outs);
    assert.ok(Object.is(got.unresolved, unresolved), `unresolved ${got.unresolved}`);
    if (process.env.CC1_SLOW) assertSame(s, { t: 'bounce', from: c(9, 5) }, P0, `cap hole ${JSON.stringify(hole)}`);
  }
});

// --- 3. The legacy (pre-FAQ) edition really switched on --------------------------------------------------------------
test('cc1+ exact chain: legacy edition (Mascot + Captain without the FAQ natural-6 return)', () => {
  const b = new Pos({ rerollsA: 0, rerollsB: 2, active: 'A' });
  const carrier = b.add('A', 'human', 'lineman', c(12, 7), { id: 'A1' });
  b.add('A', 'human', 'blitzer', c(11, 6), { id: 'A2' });
  b.add('A', 'human', 'lineman', c(13, 8), { id: 'A3' });
  b.add('B', 'orc', 'lineman', c(12, 6), { id: 'B1' });
  b.add('B', 'orc', 'blitzer', c(13, 7), { id: 'B2' });
  b.give(carrier);
  const text: Record<string, string> = {};
  for (const legacy of [true, false]) {
    const s = b.start();
    if (legacy) delete (s as { rulesEdition?: string }).rulesEdition;
    assert.equal(faq2026(s), !legacy);
    captain(s, s.players.find((p) => p.id === 'A2')!);
    s.teams.A.mascotReroll = true;
    text[String(legacy)] = JSON.stringify(assertSame(s, { t: 'arrive', sq: c(12, 7), kind: 'pass' }, P0, `legacy=${legacy}`));
    assertSame(s, { t: 'bounce', from: c(12, 7) }, P0, `legacy=${legacy} bounce`);
  }
  // Guard: the edition switch really changes the chain (the FAQ natural-6 Mascot return exists only under faq2026).
  assert.notEqual(text.true, text.false);
});

// --- 4. An OPPOSING Diving Catch on a pass / kick-off / target-square arrival -----------------------------------------
test('cc1+ exact chain: Diving Catch by the opposing team on pass, passTarget, kick, throw-in and Barik arrivals', () => {
  const b = new Pos({ rerollsA: 2, rerollsB: 2, active: 'A' });
  const a1 = b.add('A', 'human', 'lineman', c(5, 5), { id: 'A1' });
  b.add('A', 'human', 'blitzer', c(4, 4), { id: 'A2' });
  b.add('B', 'orc', 'blitzer', c(13, 7), { id: 'B1', extraSkills: [{ id: 'divingCatch' }] });
  b.add('B', 'orc', 'lineman', c(14, 9), { id: 'B2' });
  b.give(a1);
  const s = b.start();
  captain(s, s.players.find((p) => p.id === 'A2')!);
  for (const kind of ['pass', 'passTarget', 'kick', 'throwIn', 'barikA', 'barikB'] as const) assertSame(s, { t: 'arrive', sq: c(12, 7), kind }, P0, `opp DC ${kind}`);
});

// --- 5. planChain hands every dice source the same list as 7.0.1 (content, order) and applies the same pick ----------
class RecDice implements DiceSource {
  readonly mode = 'enumerate' as const;
  seen: string[] = [];
  constructor(private pick: (n: number) => number) {}
  roll(): never {
    throw new Error('unexpected roll in a ball chain');
  }
  choose<T>(outs: Array<{ key: string; p: number; value: T }>): T {
    this.seen.push(JSON.stringify(outs.map((o) => [o.key, o.p, o.value])));
    return outs[this.pick(outs.length)].value;
  }
}
type Entry = (ctx: Ctx, st: Start) => void;
const CAND: Entry = (ctx, st) => (st.t === 'arrive' ? void ballArrives(ctx, st.sq, st.kind) : st.t === 'bounce' ? bounce(ctx, st.from) : throwIn(ctx, st.last, st.off));
const REF: Entry = (ctx, st) => (st.t === 'arrive' ? void refArrives(ctx, st.sq, st.kind) : st.t === 'bounce' ? refBounce(ctx, st.from) : refThrowIn(ctx, st.last, st.off));
function viaPlanChain(entry: Entry, s: GameState, st: Start, pick: (n: number) => number): string {
  const dice = new RecDice(pick);
  usePitch(s);
  const ctx = new Ctx(cloneState(s), dice, 'plan', [], { ...DEFAULT_POLICY }, null);
  entry(ctx, st);
  return JSON.stringify({ seen: dice.seen, s: ctx.s, events: ctx.events, steps: ctx.steps, u: ctx.unresolvedExtra, qb: ctx.quickBite, td: ctx.touchdown });
}
test('cc1+ planChain: same choice list (content and order) and same applied outcome as the 7.0.1 planChain, warm and cold', () => {
  const boards: Array<[GameState, Start[]]> = [
    [starBoard('puggy', 2), [{ t: 'arrive', sq: c(9, 5), kind: 'pass' }, { t: 'bounce', from: c(9, 5) }, { t: 'arrive', sq: c(3, 3), kind: 'bounce' }, { t: 'arrive', sq: c(14, 9), kind: 'bounce' }]],
    [starBoard('veteran', 1), [{ t: 'throwIn', last: c(9, 0), off: c(9, -1) }, { t: 'arrive', sq: c(10, 5), kind: 'handoff' }]],
  ];
  // Guffle on the opposing team: the Quick Bite path of planChain (spendStar / quickBite) as well.
  const gs = starBoard('puggy', 1);
  const g = gs.players.find((p) => p.id === 'B1')!;
  g.star = 'guffle' as never;
  g.starUsed = [];
  boards.push([gs, [{ t: 'arrive', sq: c(9, 5), kind: 'pass' }]]);
  clearChainCache();
  clearReference();
  let n = 0;
  for (const warm of [false, true]) // second round: every result and choice list comes from the caches
    for (const [s, starts] of boards)
      for (const st of starts)
        for (const pick of [() => 0, (k: number) => k - 1, (k: number) => k >> 1, (k: number) => 7 % k, (k: number) => Math.min(k - 1, 3)]) {
          const want = viaPlanChain(REF, s, st, pick);
          const got = viaPlanChain(CAND, s, st, pick);
          assert.equal(got, want, `${warm ? 'warm' : 'cold'} ${JSON.stringify(st)} pick ${pick}`);
          n++;
        }
  assert.ok(n >= 70);
});
