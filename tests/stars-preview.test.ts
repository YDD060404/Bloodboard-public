/**
 * V5 step 6, item 1: the probability previews use the same Star Player rules as match resolution.
 *
 * The exact ball-chain solver (ball.ts solveBallChain) must resolve every catch the way rollTest + catchAttempt
 * do in the match with the previews' decision policy: Griff Oberwald's +1 after the roll, Puggy's / Ripper's
 * re-roll, the Sevens Veteran, the Team Mascot, Guffle Pusmaw's Quick Bite. A Hand-off catch is previewed by the
 * engine itself (rollTest in plan mode, every die enumerated), so for the same position both routes must give the
 * same probability to within rounding. Barik Farblast's Blast It! is previewed with the re-roll the computer makes.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exploreOutcomes, planAction, previewDecision, STAR_BY_ID, type ActionInput, type GameState, type Player, type TeamId } from '../src/engine/index';
import { blastItBest, blastItOutcomes, scatterPath, solveBallChain } from '../src/engine/ball';
import { DEFAULT_POLICY } from '../src/engine/context';
import { c, p, Pos, runScripted } from './helpers';

function star(P: Pos, t: TeamId, id: string, at: { x: number; y: number }, pid: string): Player {
  const st = STAR_BY_ID[id];
  const pl = P.add(t, t === 'A' ? 'human' : 'orc', 'lineman', at, { id: pid, ma: st.ma, st: st.st, ag: st.ag, pa: st.pa, av: st.av, skills: st.skills.map((k) => ({ ...k })) });
  pl.star = id;
  pl.position = st.name;
  pl.keywords = st.keywords.slice();
  return pl;
}

/** P(each holder) after the input, from the planner's full outcome tree (the match code in plan mode). */
function holders(s: GameState, input: ActionInput): Record<string, number> {
  const out: Record<string, number> = {};
  const r = exploreOutcomes(s, input, { threshold: 1e-12, maxLeaves: 200000 }, (leaf) => {
    const b = leaf.state.ball;
    const k = b.kind === 'held' ? b.playerId : 'ground';
    out[k] = (out[k] ?? 0) + leaf.p;
  });
  assert.ok(r.ok, r.errors.join());
  return out;
}

/** P(each holder) from the exact chain solver for a catch in square `sq`. */
function chainHolders(s: GameState, sq: { x: number; y: number }, kind: 'handoff' | 'pass'): Record<string, number> {
  const res = solveBallChain(s, { t: 'arrive', sq, kind }, DEFAULT_POLICY);
  const out: Record<string, number> = {};
  for (const o of res.outcomes) {
    const k = o.holder ?? 'ground';
    out[k] = (out[k] ?? 0) + o.p;
  }
  return out;
}

const handoff = (from: string, to: string): ActionInput => ({ kind: 'playerAction', playerId: from, action: 'handoff', path: [], handoffTarget: to });

function same(a: Record<string, number>, b: Record<string, number>, what: string) {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) assert.ok(Math.abs((a[k] ?? 0) - (b[k] ?? 0)) < 1e-9, `${what}: ${k} ${a[k] ?? 0} vs ${b[k] ?? 0}`);
}

test("Griff Oberwald's +1 is in the exact chain: a catch previewed by the solver = the match code's own catch", () => {
  const P = new Pos({ rerollsA: 0 });
  const h = P.add('A', 'human', 'lineman', c(9, 7), { id: 'H' });
  const g = star(P, 'A', 'griff', c(10, 7), 'G');
  P.add('B', 'orc', 'lineman', c(11, 6), { id: 'O1' });
  P.add('B', 'orc', 'lineman', c(11, 8), { id: 'O2' });
  P.give(h);
  const s = P.start();
  // AG 2+, Marked twice: natural 4+; with the +1 after the roll: 3+.
  const viaEngine = holders(s, handoff('H', 'G'));
  const viaChain = chainHolders(s, g.pos!, 'handoff');
  same(viaEngine, viaChain, 'hand-off to Griff');
  assert.ok(viaChain.G >= 4 / 6 - 1e-9, `with the +1: ${viaChain.G}`);
  // Once the +1 is spent, the chain no longer counts it.
  const used = P.start();
  p(used, 'G').starUsed = ['game'];
  const noBonus = chainHolders(used, g.pos!, 'handoff');
  assert.ok(noBonus.G < 4 / 6 - 0.1, `without it: ${noBonus.G}`);
  same(holders(used, handoff('H', 'G')), noBonus, 'hand-off to Griff (rule already used)');
});

test("the chain spends Griff's +1 in the previewed outcome where it was used (as the match would)", () => {
  const P = new Pos({ rerollsA: 0 });
  const h = P.add('A', 'human', 'lineman', c(9, 7), { id: 'H' });
  star(P, 'A', 'griff', c(10, 7), 'G');
  P.add('B', 'orc', 'lineman', c(11, 6), { id: 'O1' });
  P.add('B', 'orc', 'lineman', c(11, 8), { id: 'O2' });
  P.give(h);
  const s = P.start();
  // A Short Pass from H at (9,7) to Griff 1 square away would be a Quick Pass: use the planner's pass preview.
  const s2 = JSON.parse(JSON.stringify(s)) as GameState;
  const hp = p(s2, 'H');
  hp.pos = c(6, 7);
  let spent = 0;
  let held = 0;
  const r = exploreOutcomes(s2, { kind: 'playerAction', playerId: 'H', action: 'pass', path: [], passTarget: c(10, 7) }, { threshold: 1e-12 }, (leaf) => {
    const b = leaf.state.ball;
    if (b.kind === 'held' && b.playerId === 'G') {
      held += leaf.p;
      if ((p(leaf.state, 'G').starUsed ?? []).length) spent += leaf.p;
    }
  });
  assert.ok(r.ok, r.errors.join());
  assert.ok(held > 0 && spent > 0 && spent < held, `held ${held}, of which with the +1 spent ${spent}`);
});

test("Puggy Baconbreath's and Ripper Bolgrot's re-rolls, the Team Mascot and a Sevens Veteran: the chain = the match code", () => {
  for (const who of ['puggy', 'ripper'] as const) {
    const P = new Pos({ rerollsA: 0 });
    const h = P.add('A', 'human', 'lineman', c(9, 7), { id: 'H' });
    const x = star(P, 'A', who, c(10, 7), 'X');
    P.add('B', 'orc', 'lineman', c(11, 7), { id: 'O1' });
    P.give(h);
    const s = P.start();
    const chain = chainHolders(s, x.pos!, 'handoff');
    same(holders(s, handoff('H', 'X')), chain, `hand-off to ${who}`);
    const used = P.start();
    p(used, 'X').starUsed = ['game', 'h1', 'h2'];
    assert.ok(chainHolders(used, x.pos!, 'handoff').X < chain.X - 0.05, `${who}: the re-roll is part of the chain`);
  }
  // Team Mascot (4+ first), no Team Re-rolls left.
  const P = new Pos({ rerollsA: 0 });
  const h = P.add('A', 'human', 'lineman', c(9, 7), { id: 'H' });
  const r = P.add('A', 'human', 'lineman', c(10, 7), { id: 'R' });
  P.add('B', 'orc', 'lineman', c(11, 7), { id: 'O1' });
  P.give(h);
  const s = P.start();
  s.teams.A.mascotReroll = true;
  const m = chainHolders(s, r.pos!, 'handoff');
  same(holders(s, handoff('H', 'R')), m, 'hand-off with the Team Mascot');
  s.teams.A.mascotReroll = false;
  assert.ok(chainHolders(s, r.pos!, 'handoff').R < m.R - 0.05);
  // Sevens: the Veteran's once-per-game re-roll of a Catch.
  const V = new Pos({ rerollsA: 0, sevens: true });
  const hv = V.add('A', 'human', 'lineman', c(8, 5), { id: 'H' });
  const vet = V.add('A', 'human', 'lineman', c(9, 5), { id: 'V' });
  vet.veteran = 'ready';
  V.add('B', 'orc', 'lineman', c(10, 5), { id: 'O1' });
  V.give(hv);
  const sv = V.start();
  const vc = chainHolders(sv, vet.pos!, 'handoff');
  same(holders(sv, handoff('H', 'V')), vc, 'hand-off to a Veteran');
  p(sv, 'V').veteran = 'used';
  assert.ok(chainHolders(sv, vet.pos!, 'handoff').V < vc.V - 0.05);
});

test("Guffle Pusmaw's Quick Bite is in the previews: Armour Roll after an opponent's catch, Guffle takes the ball, no Turnover", () => {
  const P = new Pos({ rerollsA: 0 });
  const h = P.add('A', 'human', 'lineman', c(6, 7), { id: 'H', skills: [{ id: 'sureHands' }] });
  const r = P.add('A', 'human', 'lineman', c(10, 7), { id: 'R', av: 9, skills: [{ id: 'catch' }] });
  star(P, 'B', 'guffle', c(11, 7), 'GU');
  P.give(h);
  const s = P.start();
  // The hand-off route (engine) and the chain route agree, Guffle included.
  const s1 = JSON.parse(JSON.stringify(s)) as GameState;
  p(s1, 'H').pos = c(9, 7);
  same(holders(s1, handoff('H', 'R')), chainHolders(s1, r.pos!, 'handoff'), 'hand-off next to Guffle');
  const ch = chainHolders(s, r.pos!, 'pass');
  assert.ok(ch.GU > 0.1, `Guffle bites: ${ch.GU}`);
  // P(Guffle has it) = P(caught) × P(2D6 ≥ 9) = P(caught) × 10/36 when the catch cannot come back.
  // A pass to R: Guffle's Quick Bite gives him the ball — no Turnover for the passing team (as in the match).
  let bite = 0;
  let biteTurnover = 0;
  const res = exploreOutcomes(s, { kind: 'playerAction', playerId: 'H', action: 'pass', path: [], passTarget: c(10, 7) }, { threshold: 1e-12 }, (leaf) => {
    const b = leaf.state.ball;
    // Guffle can also catch a bouncing ball himself; the Quick Bite outcomes are those where his rule was spent.
    if (b.kind === 'held' && b.playerId === 'GU' && (p(leaf.state, 'GU').starUsed ?? []).includes('game')) {
      bite += leaf.p;
      if (leaf.turnover) biteTurnover += leaf.p;
    }
  });
  assert.ok(res.ok, res.errors.join());
  assert.ok(bite > 0.05, `P(Guffle has the ball after the pass) ${bite}`);
  assert.ok(biteTurnover < 1e-12, 'no Turnover when Guffle takes the ball with Quick Bite');
  // The match: an accurate pass, R catches (4+ needed? AG 3+), Guffle's Armour Roll 5+5 = 10 ≥ 9 → Guffle has the ball.
  const played = runScripted(s, { kind: 'playerAction', playerId: 'H', action: 'pass', path: [], passTarget: c(10, 7) }, [6, 6, 5, 5], (req) => (req.type === 'starRule' ? 'use' : req.options[0].id));
  const ball = played.state.ball;
  assert.equal(ball.kind === 'held' ? ball.playerId : '', 'GU');
  assert.ok(!played.events.some((e) => e.type === 'turnover'), 'no Turnover in the match either');
});

test("Barik Farblast's Blast It!: previews use the best re-roll of the three D8 — the choice the computer makes in the match", () => {
  const P = new Pos({ rerollsA: 0 });
  const bk = star(P, 'A', 'barik', c(4, 7), 'BF');
  P.add('A', 'human', 'catcher', c(20, 7), { id: 'C1' });
  P.add('A', 'human', 'catcher', c(19, 5), { id: 'C2' });
  P.add('B', 'orc', 'lineman', c(21, 9), { id: 'O1' });
  P.give(bk);
  const s = P.start();
  const target = c(20, 6);
  const outs = blastItOutcomes(s, p(s, 'BF'), target, DEFAULT_POLICY);
  const total = outs.reduce((a, o) => a + o.p, 0);
  assert.ok(Math.abs(total - 1) < 1e-12, `landing distribution sums to 1: ${total}`);
  // The chance that a team-mate ends with the ball, with Blast It! vs the plain scatter.
  const valueOf = (outcomes: Array<{ p: number; value: ReturnType<typeof scatterPath> }>) => {
    let v = 0;
    for (const o of outcomes) {
      const r = o.value;
      const res = solveBallChain(s, 'land' in r ? { t: 'arrive', sq: r.land, kind: 'barikA' } : { t: 'throwIn', last: r.last, off: r.off }, DEFAULT_POLICY);
      for (const x of res.outcomes) if (x.holder && p(s, x.holder).team === 'A') v += o.p * x.p;
    }
    return v;
  };
  const plain: Array<{ p: number; value: ReturnType<typeof scatterPath> }> = [];
  for (let n = 0; n < 512; n++) plain.push({ p: 1 / 512, value: scatterPath(target, [(n % 8) + 1, (Math.floor(n / 8) % 8) + 1, Math.floor(n / 64) + 1]) });
  const vBlast = valueOf(outs);
  const vPlain = valueOf(plain);
  assert.ok(vBlast > vPlain + 0.05, `Blast It! ${vBlast.toFixed(3)} > plain ${vPlain.toFixed(3)}`);
  // The planner's Hail Mary preview uses exactly this distribution.
  const input: ActionInput = { kind: 'playerAction', playerId: 'BF', action: 'pass', path: [], passTarget: target, hailMary: true };
  const plan = planAction(s, input, { threshold: 1e-9 });
  assert.ok(plan.ok, plan.errors.join());
  assert.ok(plan.traceEvents.some((e) => /with Blast It! \(the best re-roll assumed\)/.test(e.text)));
  // In the match: dice 1,1,1 would scatter it far from the catchers; the computer's decision = blastItBest.
  const faces = [1, 1, 1];
  const best = blastItBest(s, p(s, 'BF'), target, faces, DEFAULT_POLICY);
  assert.notEqual(best.choice, 'none');
  let asked = '';
  runScripted(s, input, [6, ...faces, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6], (req, st) => {
    if (req.type === 'starRule' && req.context?.star === 'barik') {
      asked = previewDecision(st, req);
      return asked;
    }
    return req.options[0].id;
  });
  assert.equal(asked, best.choice, 'the computer picks the re-roll the previews assume');
});

test("Interceptions: the previews pick the interceptor by the match's chances (Scrappa's Yoink! 2+, Griff's +1)", () => {
  const P = new Pos({ rerollsA: 0 });
  const h = P.add('A', 'human', 'thrower', c(5, 7), { id: 'H' });
  P.add('A', 'human', 'catcher', c(12, 7), { id: 'R' });
  P.add('B', 'orc', 'blitzer', c(8, 7), { id: 'OB', ag: 2 });
  star(P, 'B', 'scrappa', c(9, 7), 'SC');
  P.give(h);
  const s = P.start();
  let picked = '';
  runScripted(s, { kind: 'playerAction', playerId: 'H', action: 'pass', path: [], passTarget: c(12, 7) }, [6, 6, 6, 6, 6, 6, 6, 6, 6, 6], (req, st) => {
    if (req.type === 'interceptor') {
      picked = previewDecision(st, req);
      return picked;
    }
    return req.options.find((o) => o.id === 'no' || o.id === 'none')?.id ?? req.options[0].id;
  });
  assert.equal(picked, 'SC', 'Scrappa (D6 2+ first) is a better interceptor than an AG 2+ Blitzer (5+ against an Accurate Pass)');
});
