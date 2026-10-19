# Tactical training mode (V7-11)

Practise a tactical position on the real board, get it graded fairly, replay it, and carry exercises and results between the game and the Match Lab.
Everything is local: no sign-in is needed. (Choosing an online coach for an attempt would use its normal authorisation; the UI does not offer that yet — see Limits.)

## Payload types (distinct `format` values)

| `format` | What it is |
| --- | --- |
| `bloodboard-exercise` | One exercise: legal start position + side to act + objective + constraints + rubric (+ optional hints, grader-only references). |
| `bloodboard-exercise-pack` | A list of exercises. |
| `bloodboard-attempt` | One attempt: the engine's own log entries (inputs, decisions, every die) played from the exercise start, with actor, labels, elapsed time and the score report. |
| `bloodboard-history` | A game history — NOT an exercise. Importing one as an exercise is refused with that explanation. |

All carry `version`; a newer version than this build supports is refused. Exercises carry a content `hash` (position + side + objective + constraints + rubric): an edited or damaged file fails it.

## Workflow in the game

1. **Make an exercise**: on a board in play (File ▸ *Make exercise…*, or Training ▸ *New from current position…*). The position must be in play with no pending decision; set-up and kick-off positions and positions inside a decision are refused with the reason (never approximated). The action log is dropped; the start is the position as it stands, with its stored dice seed.
2. **Training** (top bar): library with Start / Resume / Export / Export last attempt / Last result; *Import…* (file picker) or drop files onto the window; *Export all as a pack*.
3. **Attempt**: the normal board plus a Training card (objective, try number, action count, hints). *Retry from start* (a new attempt, try number +1), *Hint* (reveals one and labels the attempt), *Save progress* (resume after a restart by re-executing the saved actions), *Finish & score*. Elapsed time is recorded; no timer is imposed unless the exercise sets `timeLimitMs`.
4. **Result**: legality; **what the dice did this time** (objective reached or not, Turnover, final position); **plan quality** with components, weights, 95 % intervals and the sample count; other legal lines scored the same way; labels (actor, try, hints, advice, undos, time); grader identity and limits.
5. Attempt files re-import (verified by re-execution) and appear in the exercise's records.
6. **Coach tries** (rc.1): in the library, a built-in coach (Balanced / Offensive / Defensive, chosen above the list) plays the exercise through the same engine and Attempt contract, then you get the same scored report; the attempt is stored like yours and appears in the attempt comparison, labelled as a coach. The coach function receives only the game state — never the references or the rubric. Installed (module) and online coaches are not driven from this window yet.
7. **Where your plan is risky** (rc.1, in the result): for each committed action, how many of the alternate-dice replays reached it, how many ended the Turn in a Turnover there (with a 95 % interval) and how many lost the ball carrier; a step is flagged *risky* only when the Turnover rate is at least 15 % with the interval's lower end at least 5 %, and *too few* below 20 replays. If a reference line scored clearly higher (interval above yours), a collapsed note names the first action where it parts from yours — one legal alternative, never the only accepted answer. Nothing is shown when the plan is ungraded.

## Objectives and rubric

Objectives: `score`, `keep-ball`, `recover-ball`, `stop-carrier`, `no-turnover`. Components (each a 0–1 rate over the samples): `objective`, `turnoverFree`, `ballSecurity`, `carrierProtection` (fewer adjacent standing opponents), `progress` (distance gained towards the end zone). Each objective has a default rubric (`defaultRubric`); the exercise file's `rubric.components` may re-weight them. Unknown component ids are reported as unavailable and ignored; components that cannot be measured (no carrier) are excluded and said to be.

## Fair grading (what the number means)

- **Legality** – the attempt re-executes with the authoritative engine (`verifyLog`). A forged die or outcome does not reproduce → *not legal, ungraded*.
- **Realized** – the real dice of this attempt. Reported on its own; it never feeds the quality number.
- **Plan quality** – the SAME committed action sequence is replayed on `samples` alternate dice seeds (default 200, derived deterministically from the exercise hash and attempt id, so the result is reproducible). Pending decisions use the recorded choice when the same question is asked, otherwise the first option. A plan that fails its roll is therefore not penalised by that roll, and a bad plan that got lucky is not rewarded. Fewer samples than `rubric.minSamples` (default 50) → **ungraded** (total `null`, reason stated). The interval is Wilson (rates) or normal (means).
- **Equivalent solutions** – nothing requires one reference line. Any legal sequence is graded with the same rubric; `references` (optional, grader-only; `publicExercise()` strips them) are scored with the same method only for comparison after the attempt, and never reach a coach (the coach function receives only the game state).
- **Limits stated in every report**: the sample grades the committed sequence as a plan and does not see how the player would adapt after bad dice; the 0–1 value is a weighted mean of declared components, not a calibrated playing strength or rating; no win probability is claimed.

## Headless / Match Lab contract

The Match Lab runner (`runner.mjs`) uses the same files:

```
node runner.mjs training-run   EXERCISE.json [--coach balanced|…] [--samples N]   # one built-in coach attempt + score (JSON on stdout)
node runner.mjs training-grade EXERCISE.json ATTEMPT.json [--samples N]           # re-verify and grade an attempt record
```

The record a Lab run writes is a normal `bloodboard-attempt` the game can import and replay; exercises authored in the game load in the Lab. The Lab has no exercise editor. Module (API v2) and online coaches use the same Attempt record through their host; they are not driven by these commands. One attempt per call — no strength batch.

## Limits (rc.1)

- Positions that start inside a pending decision are refused (resolve it first). Positions reconstructed from incomplete old replays are not offered; a recorded position is used only if the engine can load it as a legal state.
- The game UI offers human attempts and built-in coach attempts. Picking an installed (module) or online coach inside the UI, hints/advice labelled from a coach, and coach-written commentary are not built.
- Step-level feedback is risk localisation (where alternate dice end the Turn), not a verdict that an action was a mistake: it grades the committed plan and cannot see how you would adapt after bad dice, and it does not compare each step with a coach's best alternative. *Replay attempt* re-plays the recorded actions with the same dice on the board; supported-alternatives text is only what the exercise's references provide.
- Predictions (e.g. spatial top-K) have a slot (`attempt.predictions`) but nothing fills it yet, and nothing is invented.
- Native Mac: file dialogs/drop are the same code paths as the rest of the app and have not been run in the native shell.

## Scorer review (rc.1) — what each fairness property rests on

| Property | How it is guaranteed | Test |
| --- | --- | --- |
| Decision quality is separate from dice luck | The *realized* line (what the dice did) is reported apart from *plan quality* (the committed sequence replayed on alternate seeds); the same plan realised with different real dice keeps statistically the same plan quality | `fair grading` |
| Actions that become illegal after alternate outcomes | A replay branch that cannot play the next committed action stops there; `plannedThroughSamples` says in how many of the samples the whole plan could be played, and the score screen prints it | `scoring`, `ungraded rather than invented` |
| Fixed-sequence robustness vs adaptive strategy | Every report says the sample grades the committed sequence as a plan and cannot see how the player would adapt after bad dice; the UI shows it with the score | `limits` (3 entries, always present) |
| Equivalent solutions | Several references are allowed; they are scored by the same method and never the only accepted answer; a divergence is offered only when a reference's interval lies entirely above the attempt's, and says which route differs (squares are listed when two moves share a destination) | `scoring`, `divergence` |
| Incomplete analysis and uncertainty | `ungraded` (with the reason) below the minimum samples, with unknown components, or for illegal attempts; 95 % intervals on every figure; step findings are flagged `thin` when too few replays reach a step | `ungraded rather than invented`, `step-level localisation` |
| No terminal labels or reference answers in an acting coach's inputs | `publicExercise` strips `references`; a built-in coach attempt is driven by the game state alone (`nextMove(state, side, style)`): it is given no references, objective text, hints, labels or result | `scoring` (hidden references), `coach attempts` |

Known caveat: the start position handed to a built-in coach in **Coach tries** still contains the exercise's dice seed, as every game state does. The built-in coach does not read it (it plans on probabilities), and the attempt is graded on alternate seeds, but a module coach written to read `state.rng` could in principle peek; module and online coaches are therefore not offered in the UI for training attempts.

Observed in review: for the shipped example, the three components (objective, turnover-free, ball security, progress) coincide for that exercise, so the weighted total equals the same success rate; the interval is the conservative weighted combination. A component that cannot discriminate is still shown, not hidden.
