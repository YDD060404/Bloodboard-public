# Host extensions (V5.8): set-up hook, host-managed coach context, public resources

One contract, implemented once in `src/platform/hostext.ts` and used by both delivery paths:

* **the Mac game** — `src/ui/strategy.ts` → `platformDecide` (engine worker pool when available, a Web Worker per request),
* **the Match Lab** (batch website) — `scripts/match-lab-runner.ts` → `src/platform/research/match.ts` → `platformDecide`
  (Node worker threads per request, shared engine pool).

Nothing here changes the rules engine, roster hiring, bench / Captain / Star selection, Hopeful 1.5.0-GPT or any save format.

## 1. Optional set-up hook

```js
bloodboard.register({ …, chooseSetup(observation, setupRequest, services) { return { positions, why?, coachContext? }; } });
```

Missing hook or `null` → the built-in legal formation is used (not an error, recorded as `setup.accepted:false`).

`setupRequest`:

| field | meaning |
|---|---|
| `defaultPositions` | the legal built-in formation (`null` = not fielded this Drive) |
| `fieldedIds` / `fixedPlayerIds` | the players the host fixed on the pitch (alias kept for compatibility) |
| `legalSquares` | every square of this team's own set-up area |
| `lineOfScrimmage` | the team's Line-of-Scrimmage column |
| `centreRows` | `{ min, max }`, Centre Field rows |
| `minLine` / `allOnLine` | fewest players on the Line of Scrimmage in the Centre Field; with ≤ 3 fielded, **all** of them |
| `maxWide` / `wideRows` | most players per Wide Zone, and the Wide Zone depth |
| `pitch`, `format` | pitch size and `standard` / `sevens` |

All values come from the active ruleset (`rulesFor`, `pitch`, `playersPerDrive`, `maxPerWideZone`), including reduced-player Drives.

The answer is accepted only if: it is an object with a `positions` object; every key belongs to this team's set-up; the placed ids are
**exactly** `fieldedIds`; coordinates are finite integers inside `legalSquares`; no square is used twice; the phase is `driveSetup`; and the
whole formation passes the engine's own `matchInputReason` (the same check a human's *Confirm set-up* passes). An invalid, throwing or
timed-out hook keeps the legal default and leaves a diagnostic (`illegal`, `module-error`, `timeout`).

## 2. Coach context

A module may return `coachContext` (any JSON) with a legal answer. The host JSON-clones it, enforces **8 KB UTF-8**, and — only after
the answer was accepted for the current, non-aborted request — stores it under **match instance × team × coach id**. The next request of that
coach and team receives it as `observation.coachContext`.

* Missing, invalid (not JSON) or oversized context is ignored; the legal action is still played; an earlier valid context is kept.
* Switching the coach of a team drops that team's older contexts (also when switching back).
* A request that was cancelled, superseded by a newer request of the same team/coach, or belongs to a replaced match instance cannot commit.
* **Mac game:** `app.coachStore` is invalidated by `replaceGame` — new match, loading a save, Undo, reset. **Match Lab:** every `playMatch` owns
  a fresh `CoachContextStore`, so sequential games, parallel games, swapped-side pairs and a coach on both sides never share one.
* Not persisted in saves (a plan is rebuilt after loading). No worker globals, private state or RNG data are used for storage.

## 3. Capabilities and public resources

* `observation.hostExtensions = { setup: true, coachContext: true }` on action, decision and set-up observations of real matches. Advice-only
  requests (the human asks an AI for a suggestion) carry neither the block nor context, and never commit.
* `observation.strategicPublic.wizardAvailable = { A, B }`: `true` while the side bought a Sports-Wizard and has not cast it. It does **not** turn
  `false` because the cast window is closed. A side (or the whole key) is **omitted when unknown** (positions without match bookkeeping).
* No future dice, seed or counter is ever exposed.

## 4. Time allowance

A coach's declared `timeLimitMs` (up to 120 000 ms) is the whole-request maximum in both paths; it is a limit, never a delay.
V5.8 audit: the allowance now starts when the module starts (before, the built-in options listing that runs first could shorten the
module's service deadline); pool job deadlines, service call limits (`serviceTimeShare` 0.9 of the allowance) and the module timer all derive
from the same value; the 2 s module-loading check is now 10 s (loading only). Service calls stay bounded, cancellable, and report unresolved
probability (`exact:false`, `unresolvedMass`) when an enumeration is incomplete.

## 5. Diagnostics

Both paths record, for every decision: `kind` (`action` / `decision` / `setup`), `via`, `fellBack` + reason, `host.allowanceMs`,
`host.hostExtensions`, `host.setup {hook, answered, accepted, fallback, reason}`, `host.context {supplied, returned, committed, ignored}`.
Match Lab games also keep `hostExtensions.hostUse` per side (set-ups asked / accepted / fallback, contexts committed / ignored) and a
`kind:"setup"` record per set-up in `decisions`. The game keeps the same records in `window.bloodboardDecisionLog` (last 400).

## 6. Checks

`npm test` (`tests/hostext.test.ts`), `node scripts/ui-flow-v58-host.mjs` (game UI, Chromium), `node scripts/lab-flow-v58-host.mjs` (Match Lab
website, `LAB_DIR=…`), `scripts/hopeful-host-smoke.ts` (unchanged Hopeful file). Fixture coach: `tests/fixtures/host-fixture-coach.js`.
