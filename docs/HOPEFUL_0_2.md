# Hopeful 0.2

`ai-models/hopeful/hopeful-0-2.js` — a **separate** strategy module (`id: hopeful-0-2`, `apiMinor: 2`) built only on the
generic platform services. **Hopeful 0.1 (`hopeful-0-1.js`) is unchanged** (SHA-256 `6926af25…3e10`, byte-identical to the
supplied file) and remains the baseline. Nothing in the platform or its API contains Hopeful's principles or numbers; they
are constants inside this file.

## What it does

At each decision (one action at a time — the coach re-plans after every action, so a changed position is always
re-examined):

1. **Candidates.** The built-in list plus targeted, engine-generated legal candidates: the carrier's routes, passes and
   hand-offs, Blocks/Blitzes on the opposing carrier or on players near ours, Secure the Ball / stand up, ball-recovery moves
   near a loose ball, and End the Turn. Pre-filtered queries keep exact-probability cost low.
2. **This Turn.** The shortlist (≤ 14) is explored with `explore`: every dice outcome, exact; in-action choices are solved
   (`decisions: {own:'best', opponent:'worst'}`). Principle terms are added to the value.
3. **Opponent reply.** For the best four lines, in the two most likely outcomes: end the Turn, then look at the opponent's
   direct scoring chance (`threats.scoring`), their Blitzes on our carrier (`threats.blitz`), and the best single reply
   among their legal actions (Blocks/Blitzes on our carrier, their carrier's routes, ball-recovery moves, passes,
   hand-offs, End Turn), each explored exactly and valued from our side.
4. **Next Turn.** After that reply, our own direct scoring chance next Turn (`threats.scoring`).
5. The best line is played; a `trace` (shortlist, per-line terms, opponent replies, exposure findings, search counts) is
   recorded with the move, and `progress` notes show the watcher what is being weighed, what was ruled out and the best
   line so far. It returns as soon as a scoring route is certain on its last Turn.

The search is bounded: it uses at most 40 % of the coach's own `timeLimitMs` (30 s at the 60 s maximum), sized by the clock
as it goes; what is not reached is skipped, not guessed.

## Principles → what is computed

| Principle | Implementation |
|---|---|
| Scoring urgency | On the coach's last Turn of the half, `+120 × P(Touchdown)` on top of the value; Turnover cost falls to a quarter when a scoring chance exists; a certain Touchdown route returns at once. Otherwise scoring chances are valued through the outcomes (a Touchdown outcome is worth 100 in the built-in evaluation) and the next-Turn scoring term. |
| Ball first | With a loose ball, `+30 × P(our team holds the ball afterwards)` (exact, from the explored outcomes); ball-recovery candidates are always fetched and the opponent's ball-recovery replies are searched. |
| Turnover cost | `−12 × P(Turnover)` (`−18` when we hold the ball), on top of what the Turnover outcomes are worth. |
| Carrier protection | In each line, the opponent's Blitzes on our carrier are enumerated exactly. A line is **exposed** if some Blitz has a Turnover chance for the attacker below the standard for its Block dice: **≥ 90 % (1 die), ≥ 95 % (2 dice), ≥ 96.9 % (3 dice)**. Exposure costs `6 + 8 × P(carrier knocked down)` (kept modest: the reply search already values the Blitz itself). |
| Defensive route denial | `−60 × the opponent's direct scoring chance next Turn` per line; their carrier's routes are among the replies searched. |
| Reliable receiving | Touchback: the strongest player who is not Bone-head / Really Stupid / Wild Animal / Unsteady / Take Root (Bloodlust and Loner are smaller penalties); hand-off / pass receivers with those traits are penalised. The object answer needs `apiMinor: 2`. |
| Sideline danger | `threats.blitz` reports `pTargetCrowd` for each Blitz on the carrier; `−10 × P(crowd push)` for the most dangerous exposing Blitz. |

Every other rule decision (Block dice, re-rolls, push squares …) is left to the built-in coach (`chooseDecision` returns
`null`) — Hopeful does not yet choose them.

## The three-die threshold — derived, not guessed

Supplied: the opponent's Blitz on our carrier must carry at least 90 % Turnover risk for one die and 95 % for two.
For three dice the value is derived from the engine's own Block outcomes (`tests/hopeful.test.ts`, "the three-die Blitz
threshold"):

* Measured with `planAction` (unskilled attacker and carrier, no re-rolls): chance the Block knocks the carrier down —
  **0.5000** (1 die, ST 3 v 3), **0.6389** (2 dice, ST 4 v 3), **0.7361** (3 dice, ST 7 v 3); attacker's own Turnover chance
  on the Block alone — 1/3, 1/9, 1/27.
* Total Turnover chance of a Blitz = `1 − s·(1 − b)`, where `s` is the chance that the movement before the Block succeeds and
  `b` the Block's own Turnover chance. The supplied standards fix how much movement success is tolerated: `s₁ = 0.10/(1−1/3) = 0.150`,
  `s₂ = 0.05/(1−1/9) = 0.05625`.
* The tolerated `s` falls as the Block's knock-down chance rises; a power law `s ∝ kd^−k` through the two supplied points gives
  **k = 4.001** — effectively an exact fourth power. Extrapolating to three dice: `s₃ = 0.0319`, hence a total Turnover
  standard of `1 − 0.0319·(26/27) =` **0.969**.

This is a fit through two supplied anchors using measured engine numbers, monotone in the number of dice (0.90 < 0.95 < 0.969);
it is a proposal for calibration, not a rule from the user.

## Known limits

* One opponent **action** of look-ahead, not a whole opponent Turn; our own next Turn is represented by its direct scoring
  chance, not a search. Multi-action plans of our own (a cage built over several activations) are not searched — each action
  is chosen, then the position is re-examined.
* Exposure uses the opponent's Blitz on the carrier only; other ways to dislodge the ball (Blocks from adjacent squares,
  fouls) enter through the reply search.
* `precision:'fast'` Blitz figures (branches below 1e-4 unexpanded, reported) are used in the opponent-reply stage.
* Constants are hand-set and uncalibrated.
* No claim is made that 0.2 is stronger than 0.1 — see the test section below.

## Status and tests

Hopeful 0.2 ships as an **optional example coach**. It is **not proven stronger** than Hopeful 0.1 or the built-in coach.

* `tests/hopeful.test.ts`: 8 scenario tests pass (scoring deadline, loose-ball recovery, carrier protection, touchline,
  replanning, reliable touchback, derivation of the three-die threshold).
* Only small pilots were run (4 games per pairing at a 6 s limit; about 3 of 12 games at the 60 s limit, stopped). The
  results (1W 1D 2L vs built-in balanced; 2W 2D 0L vs Hopeful 0.1) are far too few to read as strength.
* 60 s runs, first game: no fallbacks, median think about 7.6 s, p90 12.6 s, max about 20 s; every decision used some
  inexact (labelled) calls, unresolved mass up to 0.28.
* The full benchmark and tuning were deliberately paused; they are separate work.
