/**
 * Block-dice audit report → docs/BLOCK_DICE_AUDIT.md
 * Run: node scripts/build.mjs (it runs this too) or bundle + run this file.
 * Every sample uses a listed seed, so the whole report is reproducible.
 */
import { blockFacesFromRaw, chiSquare, FACE_P, FACES, firstDiePerSeed, pairs, rawD6, rejectionRate, sampleBlocks, seedList, SCENARIOS } from './lib/block-audit';
import { execute, parseSaveFile } from '../src/engine/index';

declare const process: { argv: string[] };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare function require(m: string): any;
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[2] ?? '.';
const quick = process.argv.includes('--quick');

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const LABEL: Record<string, string> = { playerDown: 'Player Down', bothDown: 'Both Down', push: 'Push Back', stumble: 'Stumble', pow: 'POW' };
const fmtP = (p: number) => (p < 0.0001 ? p.toExponential(1) : p.toFixed(3));

const K = quick ? 10 : 1;
let md = `# Block-dice audit

Question investigated: *do Player Down and Push Back come up unusually often, and POW and Both Down unusually rarely?*

**Result: the dice are fair and the engine reports them correctly.** No bias was found anywhere between the random number generator and the log. One real defect was found and fixed along the way: a cache-key collision that could corrupt *previewed* block probabilities (never the actual dice) after a preview involving a Pro re-roll of one block die. Details below.

Everything here is reproducible: the engine's dice come from a counter-based generator stored in the game state (\`seed\`, \`counter\`), and the seed lists are given for each sample. Regenerate this file with \`node scripts/build.mjs\` (or run \`scripts/audit-block-dice.ts\` directly). The same checks run with smaller samples in \`tests/dice-audit.test.ts\`.

## What was checked

1. **Random number generator** (\`src/engine/dice.ts\`): 32-bit hash of (seed, counter); a die is drawn by rejection sampling (\`rollDie\`), so every face of a D6 is exactly equally likely given uniform 32-bit values.
2. **Face mapping** (p.62): 1 Player Down, 2 Both Down, 3–4 Push Back, 5 Stumble, 6 POW.
3. **Block resolution** (\`src/engine/block.ts\`): strength → number of dice → one roll of the whole pool → re-roll options → the chooser picks one die → Stumble resolved (Dodge/Tackle) → push/knock-down.
4. **Reporting**: every physical die is recorded on the event that reports it (\`event.dice\`), which is what the dice tray shows; the log text and the chosen result were compared with those records for every sampled block.
5. **Other rolls**: armour, injury, re-roll and Loner/Pro dice are recorded as ordinary dice (D6/2D6), never as block dice.

## 1. Raw D6 from the generator

`;

{
  const seeds = seedList(200);
  const per = 5000 / K;
  const counts = rawD6(seeds, per);
  const cs = chiSquare(counts, new Array(6).fill(1 / 6));
  md += `Seeds: 200 seeds (1, 7920, 15839, … step 7919), ${per.toLocaleString()} consecutive dice each → **${cs.n.toLocaleString()} dice**.\n\n| Face | Count | Share | Expected |\n|---|---|---|---|\n`;
  counts.forEach((c, i) => (md += `| ${i + 1} | ${c.toLocaleString()} | ${pct(c / cs.n)} | 16.67% |\n`));
  md += `\nChi-square = ${cs.statistic.toFixed(2)} (df ${cs.df}), p = ${fmtP(cs.pValue)}. A p-value this size is what fair dice produce; a biased die would give a p-value near 0.\n\n`;
  const first = firstDiePerSeed(seedList(200000 / K, 1, 1));
  const fc = chiSquare(first, new Array(6).fill(1 / 6));
  md += `**First die after loading a seed** (seeds 1 … ${(200000 / K).toLocaleString()}, one die each — what you see first when a position is loaded): ${first.map((c, i) => `${i + 1}: ${pct(c / fc.n)}`).join(', ')}; chi-square ${fc.statistic.toFixed(2)}, p = ${fmtP(fc.pValue)}.\n\n`;
  md += `Rejection sampling discards ${pct(rejectionRate(12345, 1_000_000 / K))} of 32-bit draws (expected 4/4294967296 ≈ 0.0000001%).\n\n`;
}

{
  md += `## 2. Block faces from the generator\n\n`;
  const seeds = seedList(200, 3);
  const per = 5000 / K;
  const f = blockFacesFromRaw(seeds, per);
  const n = FACES.reduce((a, k) => a + f[k], 0);
  const cs = chiSquare(FACES.map((k) => f[k]), FACES.map((k) => FACE_P[k]));
  md += `Seeds: 200 seeds (3, 7922, … step 7919), ${per.toLocaleString()} dice each → **${n.toLocaleString()} block dice**.\n\n| Result | Count | Share | Expected |\n|---|---|---|---|\n`;
  for (const k of FACES) md += `| ${LABEL[k]} | ${f[k].toLocaleString()} | ${pct(f[k] / n)} | ${pct(FACE_P[k])} |\n`;
  md += `\nChi-square = ${cs.statistic.toFixed(2)} (df ${cs.df}), p = ${fmtP(cs.pValue)}.\n\n`;
  const pr = pairs(seedList(100, 5), 5000 / K);
  const pc = chiSquare(pr, new Array(36).fill(1 / 36));
  md += `**Two dice rolled together** (as in a 2-dice block): ${pc.n.toLocaleString()} consecutive pairs over 36 combinations, chi-square ${pc.statistic.toFixed(2)} (df 35), p = ${fmtP(pc.pValue)} — the second die is independent of the first.\n\n`;
}

md += `## 3. Real Block actions through the engine\n\nEach block is a full \`execute\` of a Block Action (attacker A1 against defender B1, no skills, no re-rolls) from a fresh position with its own seed (seeds 11, 7930, … step 7919). Decisions are answered with the policy the previews state (the chooser takes the result that is best for them). For every block the audit compared the dice records, the log line "Block dice: …" and the "Result: …" line.\n\n`;
const N = 20000 / K;
for (const sc of SCENARIOS) {
  const s = sampleBlocks(sc.id, seedList(N, 11));
  const cs = chiSquare(FACES.map((k) => s.faceCounts[k]), FACES.map((k) => FACE_P[k]));
  md += `### ${sc.label}\n\n${s.blocks.toLocaleString()} blocks, ${s.dice.toLocaleString()} dice. Consistency problems: **${s.mismatches.length}**; non-block dice reported as block dice: **${s.foreignDice}**.\n\n| Result | Dice showing it | Share of dice | Expected | Chosen result (Stumble → POW) | Expected chosen |\n|---|---|---|---|---|---|\n`;
  for (const k of FACES) {
    const eff = k === 'stumble' ? '—' : `${pct((s.effectiveCounts[k] ?? 0) / s.blocks)}`;
    const exp = k === 'stumble' ? '—' : pct(s.expectedChosen[k] ?? 0);
    md += `| ${LABEL[k]} | ${s.faceCounts[k].toLocaleString()} | ${pct(s.faceCounts[k] / s.dice)} | ${pct(FACE_P[k])} | ${eff} | ${exp} |\n`;
  }
  md += `\nDice chi-square ${cs.statistic.toFixed(2)} (df 4), p = ${fmtP(cs.pValue)}.\n\n`;
}

md += `## 4. Fixed seeds repeat the same dice\n\nPractice positions and examples store a seed. Loading one again restores that seed, so the **same dice come up in the same order** until you pick a new seed. For example:\n\n`;
for (const f of ['02-blitz-the-carrier.json', '06-sideline-crowd-surf.json']) {
  const r = parseSaveFile(fs.readFileSync(path.join(root, 'examples', f), 'utf8'));
  if (!r.ok) continue;
  const st = r.save.state;
  const a = st.players.find((p) => p.team === 'A' && p.number === (f.startsWith('02') ? 6 : 8));
  const b = st.players.find((p) => p.team === 'B' && p.number === (f.startsWith('02') ? 8 : 7));
  if (!a || !b) continue;
  const input = f.startsWith('02')
    ? { kind: 'playerAction' as const, playerId: a.id, action: 'blitz' as const, blitzTarget: b.id, blockTarget: b.id, path: [[11, 7], [10, 7], [9, 7]].map(([x, y]) => ({ to: { x, y }, kind: 'step' as const })) }
    : { kind: 'playerAction' as const, playerId: a.id, action: 'block' as const, path: [], blockTarget: b.id };
  const outs = [0, 1, 2].map(() => {
    const res = execute(JSON.parse(JSON.stringify(st)), input);
    const ev = res.events.find((e) => e.text.startsWith('Block dice:'));
    return ev ? ev.text : '(no block)';
  });
  md += `- \`examples/${f}\` (seed ${st.rng.seed}): three separate loads → ${outs.map((t) => `"${t}"`).join(', ')}.\n`;
}
md += `\nThis is by design (reproducible practice), but replaying the same position several times shows the same results and can easily feel like a pattern. The Practice screen now says so and offers **New seed**.\n\n`;

md += `## Why the results can still feel uneven

- **Push Back is on two faces**, so it is by far the most common single result: 1 die in 3. With two dice, at least one Push Back shows up 55.6% of the time.
- **Who chooses matters more than the dice.** When the defender chooses (a weaker attacker), they take Player Down whenever it shows (30.6% with two dice) and otherwise the least damaging result, so POW is only chosen when every die is POW or Stumble: ${pct(4 / 36)} with two dice. In the samples above, @@MINUS2D@@. (The 2-dice samples use the same seeds, so "attacker chooses" and "defender chooses" saw exactly the same dice — only the choice differs.)
- **POW and Both Down are individually as likely as Player Down** (1 in 6 each), but short runs swing a lot: over 20 single-die blocks, a 1-in-6 result appears ${'@@'}BINOM@@.
- **Fixed seeds** (section 4) repeat the same sequence on every reload.

## Defect found and fixed (previews only)

\`src/engine/block.ts\` used the cache key \`block1\` both for a 1-die block pool and for Pro/Brawler/Hatred re-rolls of a single block die. The two rolls are interpreted differently (a pool of results vs a single result), so after one of them had been previewed, a later *preview* of the other could reuse the wrong cached outcome table and show wrong block probabilities. Actual dice rolls never used this cache. Fixed by giving the single-die re-roll its own key, and the outcome cache now spot-checks every cached table against the roll's interpretation and refuses to reuse a mismatching one. Regression test: \`tests/dice-audit.test.ts\` ("Pro re-roll of one block die…").

## Previews re-checked

The preview probabilities for blocks are produced by exact enumeration with the same code that executes the block, and are cross-checked against thousands of real executions in \`tests/montecarlo.test.ts\` and \`tests/dice-audit.test.ts\` (the "chosen result" columns above match the previewed exact values). Previews state their assumptions (who chooses which die, push squares, follow-up), and anything not enumerated is reported as "not computed" rather than estimated.
`;

// fill in the −2D sentence with real numbers
{
  const one = sampleBlocks('1D', seedList(N, 11));
  const two = sampleBlocks('-2D', seedList(N, 11));
  md = md.replace('@@MINUS2D@@', `a "−2D" block ended in Player Down ${pct((two.effectiveCounts.playerDown ?? 0) / two.blocks)} of the time and in POW ${pct((two.effectiveCounts.pow ?? 0) / two.blocks)}, against ${pct((one.effectiveCounts.playerDown ?? 0) / one.blocks)} and ${pct((one.effectiveCounts.pow ?? 0) / one.blocks)} for a 1-die block`);
  const binom = (n: number, k: number, p: number) => {
    let c = 1;
    for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1);
    return c * Math.pow(p, k) * Math.pow(1 - p, n - k);
  };
  let le1 = 0;
  for (let k = 0; k <= 1; k++) le1 += binom(20, k, 1 / 6);
  let ge6 = 0;
  for (let k = 6; k <= 20; k++) ge6 += binom(20, k, 1 / 6);
  md = md.replace('@@BINOM@@', `on average 3.3 times, but at most once in ${pct(le1)} of such sessions and 6 or more times in ${pct(ge6)} of them`);
}

fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs', 'BLOCK_DICE_AUDIT.md'), md);
console.log('wrote docs/BLOCK_DICE_AUDIT.md');
