/**
 * Block-dice audit (moderate, reproducible samples). The full report with
 * larger samples is produced by scripts/audit-block-dice.ts →
 * docs/BLOCK_DICE_AUDIT.md.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blockFace } from '../src/engine/dice';
import { planAction } from '../src/engine/index';
import { blockFacesFromRaw, chiSquare, FACE_P, FACES, firstDiePerSeed, pairs, rawD6, sampleBlocks, scenarioState, BLOCK_INPUT, seedList, SCENARIOS } from '../scripts/lib/block-audit';

const within = (obs: number, n: number, p: number, sigmas = 4.5) => Math.abs(obs / n - p) <= sigmas * Math.sqrt((p * (1 - p)) / n) + 1e-12;

test('block-die face mapping: 1 Player Down, 2 Both Down, 3-4 Push Back, 5 Stumble, 6 POW (p.62)', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(blockFace), ['playerDown', 'bothDown', 'push', 'push', 'stumble', 'pow']);
});

test('raw D6 from the engine RNG is uniform across seeds (chi-square)', () => {
  const counts = rawD6(seedList(100), 2000); // 200,000 dice
  const cs = chiSquare(counts, [1, 1, 1, 1, 1, 1].map(() => 1 / 6));
  assert.ok(cs.pValue > 1e-4, `chi-square ${cs.statistic.toFixed(2)} p=${cs.pValue}`);
  const first = firstDiePerSeed(seedList(60000, 1, 1)); // seeds 1..60000, first die only
  assert.ok(chiSquare(first, new Array(6).fill(1 / 6)).pValue > 1e-4);
});

test('block faces from raw dice have the expected 1/6, 1/6, 2/6, 1/6, 1/6 frequencies', () => {
  const f = blockFacesFromRaw(seedList(100), 2000);
  const cs = chiSquare(FACES.map((k) => f[k]), FACES.map((k) => FACE_P[k]));
  assert.ok(cs.pValue > 1e-4, JSON.stringify(f));
  const pr = pairs(seedList(50), 2000);
  assert.ok(chiSquare(pr, new Array(36).fill(1 / 36)).pValue > 1e-4, 'consecutive dice (2-dice pools) are independent');
});

for (const sc of SCENARIOS) {
  test(`engine blocks ${sc.label}: dice faces, log text and chosen result agree and match the exact distribution`, () => {
    const s = sampleBlocks(sc.id, seedList(2500, 11));
    assert.deepEqual(s.mismatches.slice(0, 5), []);
    assert.equal(s.foreignDice, 0, 'no other dice are reported as block dice');
    for (const f of FACES) assert.ok(within(s.faceCounts[f], s.dice, FACE_P[f]), `${f}: ${s.faceCounts[f]}/${s.dice}`);
    for (const [k, p] of Object.entries(s.expectedChosen)) assert.ok(within(s.effectiveCounts[k] ?? 0, s.blocks, p), `${sc.id} chosen ${k}: ${s.effectiveCounts[k] ?? 0}/${s.blocks} vs ${p}`);
    const total = Object.values(s.expectedChosen).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - 1) < 1e-12);
  });
}

test('regression: a Pro re-roll of one block die no longer collides with the 1-die pool in the preview cache', () => {
  // Plan a 1-die block (fills the 1-die pool cache), then a block by a Pro player; both must stay valid.
  const s1 = scenarioState('1D', 5);
  const p1 = planAction(s1, BLOCK_INPUT);
  assert.ok(p1.ok);
  const s2 = scenarioState('1D', 5);
  (s2.players.find((p) => p.id === 'A1') as { skills: { id: string }[] }).skills.push({ id: 'pro' });
  const p2 = planAction(s2, BLOCK_INPUT);
  assert.ok(p2.ok, p2.errors.join());
  const p3 = planAction(s1, BLOCK_INPUT);
  assert.ok(p3.ok);
  for (const pl of [p1, p2, p3]) {
    const sum = Object.values(pl.withoutTeamRerolls!.blockResult).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum + pl.withoutTeamRerolls!.unresolved - 1) < 1e-9, JSON.stringify(pl.withoutTeamRerolls!.blockResult));
    for (const k of Object.keys(pl.withoutTeamRerolls!.blockResult)) assert.ok(['playerDown', 'bothDown', 'push', 'pow'].includes(k), k);
  }
});
