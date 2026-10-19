# Block-dice audit

Question investigated: *do Player Down and Push Back come up unusually often, and POW and Both Down unusually rarely?*

**Result: the dice are fair and the engine reports them correctly.** No bias was found anywhere between the random number generator and the log. One real defect was found and fixed along the way: a cache-key collision that could corrupt *previewed* block probabilities (never the actual dice) after a preview involving a Pro re-roll of one block die. Details below.

Everything here is reproducible: the engine's dice come from a counter-based generator stored in the game state (`seed`, `counter`), and the seed lists are given for each sample. Regenerate this file with `node scripts/build.mjs` (or run `scripts/audit-block-dice.ts` directly). The same checks run with smaller samples in `tests/dice-audit.test.ts`.

## What was checked

1. **Random number generator** (`src/engine/dice.ts`): 32-bit hash of (seed, counter); a die is drawn by rejection sampling (`rollDie`), so every face of a D6 is exactly equally likely given uniform 32-bit values.
2. **Face mapping** (p.62): 1 Player Down, 2 Both Down, 3–4 Push Back, 5 Stumble, 6 POW.
3. **Block resolution** (`src/engine/block.ts`): strength → number of dice → one roll of the whole pool → re-roll options → the chooser picks one die → Stumble resolved (Dodge/Tackle) → push/knock-down.
4. **Reporting**: every physical die is recorded on the event that reports it (`event.dice`), which is what the dice tray shows; the log text and the chosen result were compared with those records for every sampled block.
5. **Other rolls**: armour, injury, re-roll and Loner/Pro dice are recorded as ordinary dice (D6/2D6), never as block dice.

## 1. Raw D6 from the generator

Seeds: 200 seeds (1, 7920, 15839, … step 7919), 5,000 consecutive dice each → **1,000,000 dice**.

| Face | Count | Share | Expected |
|---|---|---|---|
| 1 | 167,049 | 16.70% | 16.67% |
| 2 | 166,823 | 16.68% | 16.67% |
| 3 | 166,393 | 16.64% | 16.67% |
| 4 | 166,505 | 16.65% | 16.67% |
| 5 | 166,910 | 16.69% | 16.67% |
| 6 | 166,320 | 16.63% | 16.67% |

Chi-square = 2.71 (df 5), p = 0.745. A p-value this size is what fair dice produce; a biased die would give a p-value near 0.

**First die after loading a seed** (seeds 1 … 200,000, one die each — what you see first when a position is loaded): 1: 16.64%, 2: 16.59%, 3: 16.64%, 4: 16.59%, 5: 16.74%, 6: 16.81%; chi-square 4.91, p = 0.427.

Rejection sampling discards 0.00% of 32-bit draws (expected 4/4294967296 ≈ 0.0000001%).

## 2. Block faces from the generator

Seeds: 200 seeds (3, 7922, … step 7919), 5,000 dice each → **1,000,000 block dice**.

| Result | Count | Share | Expected |
|---|---|---|---|
| Player Down | 166,947 | 16.69% | 16.67% |
| Both Down | 166,636 | 16.66% | 16.67% |
| Push Back | 333,864 | 33.39% | 33.33% |
| Stumble | 166,382 | 16.64% | 16.67% |
| POW | 166,171 | 16.62% | 16.67% |

Chi-square = 3.28 (df 4), p = 0.512.

**Two dice rolled together** (as in a 2-dice block): 500,000 consecutive pairs over 36 combinations, chi-square 27.30 (df 35), p = 0.820 — the second die is independent of the first.

## 3. Real Block actions through the engine

Each block is a full `execute` of a Block Action (attacker A1 against defender B1, no skills, no re-rolls) from a fresh position with its own seed (seeds 11, 7930, … step 7919). Decisions are answered with the policy the previews state (the chooser takes the result that is best for them). For every block the audit compared the dice records, the log line "Block dice: …" and the "Result: …" line.

### ST 3 v 3 (1 die)

20,000 blocks, 20,000 dice. Consistency problems: **0**; non-block dice reported as block dice: **0**.

| Result | Dice showing it | Share of dice | Expected | Chosen result (Stumble → POW) | Expected chosen |
|---|---|---|---|---|---|
| Player Down | 3,333 | 16.66% | 16.67% | 16.66% | 16.67% |
| Both Down | 3,292 | 16.46% | 16.67% | 16.46% | 16.67% |
| Push Back | 6,722 | 33.61% | 33.33% | 33.61% | 33.33% |
| Stumble | 3,251 | 16.25% | 16.67% | — | — |
| POW | 3,402 | 17.01% | 16.67% | 33.27% | 33.33% |

Dice chi-square 4.42 (df 4), p = 0.352.

### ST 4 v 3 (2 dice, attacker chooses)

20,000 blocks, 40,000 dice. Consistency problems: **0**; non-block dice reported as block dice: **0**.

| Result | Dice showing it | Share of dice | Expected | Chosen result (Stumble → POW) | Expected chosen |
|---|---|---|---|---|---|
| Player Down | 6,655 | 16.64% | 16.67% | 2.77% | 2.78% |
| Both Down | 6,579 | 16.45% | 16.67% | 8.20% | 8.33% |
| Push Back | 13,527 | 33.82% | 33.33% | 33.70% | 33.33% |
| Stumble | 6,555 | 16.39% | 16.67% | — | — |
| POW | 6,684 | 16.71% | 16.67% | 55.34% | 55.56% |

Dice chi-square 5.90 (df 4), p = 0.207.

### ST 3 v 4 (2 dice, defender chooses)

20,000 blocks, 40,000 dice. Consistency problems: **0**; non-block dice reported as block dice: **0**.

| Result | Dice showing it | Share of dice | Expected | Chosen result (Stumble → POW) | Expected chosen |
|---|---|---|---|---|---|
| Player Down | 6,655 | 16.64% | 16.67% | 30.50% | 30.56% |
| Both Down | 6,579 | 16.45% | 16.67% | 24.70% | 25.00% |
| Push Back | 13,527 | 33.82% | 33.33% | 33.93% | 33.33% |
| Stumble | 6,555 | 16.39% | 16.67% | — | — |
| POW | 6,684 | 16.71% | 16.67% | 10.86% | 11.11% |

Dice chi-square 5.90 (df 4), p = 0.207.

### ST 7 v 3 (3 dice, attacker chooses)

20,000 blocks, 60,000 dice. Consistency problems: **0**; non-block dice reported as block dice: **0**.

| Result | Dice showing it | Share of dice | Expected | Chosen result (Stumble → POW) | Expected chosen |
|---|---|---|---|---|---|
| Player Down | 9,959 | 16.60% | 16.67% | 0.46% | 0.46% |
| Both Down | 9,942 | 16.57% | 16.67% | 3.13% | 3.24% |
| Push Back | 20,168 | 33.61% | 33.33% | 26.05% | 25.93% |
| Stumble | 9,886 | 16.48% | 16.67% | — | — |
| POW | 10,045 | 16.74% | 16.67% | 70.36% | 70.37% |

Dice chi-square 3.42 (df 4), p = 0.490.

### ST 3 v 7 (3 dice, defender chooses)

20,000 blocks, 60,000 dice. Consistency problems: **0**; non-block dice reported as block dice: **0**.

| Result | Dice showing it | Share of dice | Expected | Chosen result (Stumble → POW) | Expected chosen |
|---|---|---|---|---|---|
| Player Down | 9,959 | 16.60% | 16.67% | 41.98% | 42.13% |
| Both Down | 9,942 | 16.57% | 16.67% | 28.06% | 28.24% |
| Push Back | 20,168 | 33.61% | 33.33% | 26.42% | 25.93% |
| Stumble | 9,886 | 16.48% | 16.67% | — | — |
| POW | 10,045 | 16.74% | 16.67% | 3.54% | 3.70% |

Dice chi-square 3.42 (df 4), p = 0.490.

## 4. Fixed seeds repeat the same dice

Practice positions and examples store a seed. Loading one again restores that seed, so the **same dice come up in the same order** until you pick a new seed. For example:

- `examples/02-blitz-the-carrier.json` (seed 777): three separate loads → "Block dice: Both Down / Both Down.", "Block dice: Both Down / Both Down.", "Block dice: Both Down / Both Down.".
- `examples/06-sideline-crowd-surf.json` (seed 9001): three separate loads → "Block dice: Stumble.", "Block dice: Stumble.", "Block dice: Stumble.".

This is by design (reproducible practice), but replaying the same position several times shows the same results and can easily feel like a pattern. The Practice screen now says so and offers **New seed**.

## Why the results can still feel uneven

- **Push Back is on two faces**, so it is by far the most common single result: 1 die in 3. With two dice, at least one Push Back shows up 55.6% of the time.
- **Who chooses matters more than the dice.** When the defender chooses (a weaker attacker), they take Player Down whenever it shows (30.6% with two dice) and otherwise the least damaging result, so POW is only chosen when every die is POW or Stumble: 11.11% with two dice. In the samples above, a "−2D" block ended in Player Down 30.50% of the time and in POW 10.86%, against 16.66% and 33.27% for a 1-die block. (The 2-dice samples use the same seeds, so "attacker chooses" and "defender chooses" saw exactly the same dice — only the choice differs.)
- **POW and Both Down are individually as likely as Player Down** (1 in 6 each), but short runs swing a lot: over 20 single-die blocks, a 1-in-6 result appears on average 3.3 times, but at most once in 13.04% of such sessions and 6 or more times in 10.18% of them.
- **Fixed seeds** (section 4) repeat the same sequence on every reload.

## Defect found and fixed (previews only)

`src/engine/block.ts` used the cache key `block1` both for a 1-die block pool and for Pro/Brawler/Hatred re-rolls of a single block die. The two rolls are interpreted differently (a pool of results vs a single result), so after one of them had been previewed, a later *preview* of the other could reuse the wrong cached outcome table and show wrong block probabilities. Actual dice rolls never used this cache. Fixed by giving the single-die re-roll its own key, and the outcome cache now spot-checks every cached table against the roll's interpretation and refuses to reuse a mismatching one. Regression test: `tests/dice-audit.test.ts` ("Pro re-roll of one block die…").

## Previews re-checked

The preview probabilities for blocks are produced by exact enumeration with the same code that executes the block, and are cross-checked against thousands of real executions in `tests/montecarlo.test.ts` and `tests/dice-audit.test.ts` (the "chosen result" columns above match the previewed exact values). Previews state their assumptions (who chooses which die, push squares, follow-up), and anything not enumerated is reported as "not computed" rather than estimated.
