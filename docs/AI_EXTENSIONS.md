# AI files and strategy modules (V5.5)

> **V5.6:** the strategy interface is now the versioned AI platform — see `docs/AI_PLATFORM.md` (services, candidates for any position, threat data, decision policies, features, rankings, progress, limits, versioning). Everything below still holds for modules written against API 1; a module may set its own `timeLimitMs` up to **60 s** (earlier text says 20 s).

Every computer coach in Bloodboard is an **AI file**. The match set-up lists exactly the valid AI files it finds —
the same list for Player 1, Player 2, a computer v computer match and the **advisory coach** (AI Focus advice and
temporary takeovers). There is no separate "style" setting: a different configuration is a different file with its
own id, name and version.

There are two kinds of AI file:

| Kind | File | What it can change | Runs where |
|---|---|---|---|
| **Parameter file** | `*.json`, format `bloodboard-ai`, `formatVersion` 1, `apiVersion` 1 | The built-in Bloodboard algorithm's weights, named preferences, conditional settings (score, Turns left, half, possession, format), objective thresholds and search budget. It is **not** a new algorithm. | In the app, inside the built-in algorithm |
| **Strategy module** | `*.js`, strategy API 1 | Its own decision logic: re-rank or replace the built-in candidates, answer rule decisions. | An isolated Web Worker; everything it proposes is validated by the rules engine |

## Where the files are

| Where | Folder |
|---|---|
| Mac app | `~/Library/Application Support/Bloodboard/AI` — the ONE folder shared with the Match Lab and the online-coach tools (*File › Show AI Folder in Finder*; *Choose AI Folder…* for a supported alternative). Older version-specific AI folders are merged into it by the installer (see `docs/AI_FOLDER.md`). `AI/Examples` holds the examples (not loaded). |
| Browser (`dist/web/index.html`) | The files bundled with the page (`dist/web/ai`, from the project's `ai/` folder at build time) plus files imported with **Import AI file…** (kept in the browser's local storage). |

After adding, changing or removing a file press **Reload AI list** in the match set-up (or restart the app).
**Restore bundled AI files** puts missing bundled files back (nothing is overwritten). A file that is invalid is still
listed, with the reason, and cannot be chosen.

Bundled with V5.5 — one algorithm, three parameter files, three separate choices:

| File | Name | What differs |
|---|---|---|
| `bloodboard-balanced.json` | Bloodboard AI — Balanced 5.5.0 | The built-in defaults (the fallback when a saved choice is missing). |
| `bloodboard-offensive.json` | Bloodboard AI — Offensive 5.5.0 | More progress, receivers, pressure and marking; less screening; a little more risk. |
| `bloodboard-defensive.json` | Bloodboard AI — Defensive 5.5.0 | More carrier protection, screening and containment; less risk. |

Examples (`ai/examples`, copied to `AI/Examples` in the Mac app): `aggressive-bashers.json` (a parameter file with a
conditional setting) and `cautious-scorer.js` (a strategy module).

## Choosing, saving and fallback

* The set-up remembers each side's AI file (and the advisory coach) across restarts; a saved match records the
  coaches (`match.options.coaches`: `{ ai, name, version }` per computer side).
* If a remembered or saved file is missing, the set-up and the match say so and use the fallback: the bundled Balanced
  file if installed, else the first valid file. If no AI file is installed at all, a saved match falls back to the
  built-in algorithm with its default parameters, labelled as such; the set-up then cannot start a computer coach
  and offers to restore the bundled files.
* During a match: the coach of a side can be changed at a safe boundary (never in the middle of a decision); a human
  side can hand over to the advisory coach for one activation, the rest of the Turn or until taken back. Every change
  is written to the match log.

## Parameter files (`*.json`)

```json
{
  "format": "bloodboard-ai",
  "formatVersion": 1,
  "apiVersion": 1,
  "id": "my-coach",
  "name": "My Coach",
  "version": "1.0",
  "description": "What it does, in one sentence.",
  "author": "Me",
  "implementation": "bloodboard",
  "formats": ["standard", "sevens"],
  "parameters": {
    "weights": { "progress": 1.2, "turnoverCost": 0.9 },
    "preferences": { "aggression": 0.5, "ballSecurity": -0.2 },
    "conditions": [
      { "when": { "scoreDiff": [1, 9], "turnsLeft": [0, 2] }, "preferences": { "ballSecurity": 0.8, "riskTolerance": -0.6 } }
    ],
    "objectives": { "protectThreats": 2, "protectCageBelow": 2 },
    "search": { "maxExplored": 14, "maxLeaves": 40000, "threshold": 1e-6, "minGain": 0.5 }
  }
}
```

Rules checked when the file is read (`src/ai/registry.ts`, `parseAIFile`):

| Field | Rule |
|---|---|
| `id` | 2–49 letters, digits, `.`, `-`, `_`; unique among the files (the first valid one wins) |
| `name`, `version` | 1–70 characters; a short version text |
| `implementation` | must be an installed algorithm — `"bloodboard"` (other algorithms come as strategy modules) |
| `style` | not allowed (each configuration is its own file) |
| `weights` | multipliers 0–5 of the evaluation's weights: `td, hold, progress, scoreThreat, carrierMarked, carrierExposed, cage, receivers, oppProgress, oppScoreThreat, pressure, pressureReach, contain, shape, screen, looseBall, ballChase, standing, prone, stunned, marking, marked, reroll, turnoverCost, crowd` |
| `preferences` | −1…+1: `riskTolerance`, `aggression`, `ballSecurity`, `tempo`, `defence`, `attrition` (each maps onto a group of weights) |
| `conditions` | up to 12; `when` may use `scoreDiff [min,max]`, `turnsLeft [min,max]`, `half` 1/2, `possession` us/them/loose, `format` standard/sevens; while it holds, its `weights` / `preferences` apply on top |
| `objectives` | when the carrier needs protecting: `protectThreats` 1–4 opponents able to reach him, `protectCageBelow` 0–4 team-mates next to him |
| `search` | thinking budget: `maxExplored` candidates enumerated exactly, `maxLeaves` outcome leaves, `threshold` smallest branch expanded, `minGain` least gain worth acting for |
| `formats` | where the file is offered (default both) |

A parameter file changes preferences of the same algorithm; the interface and these notes never describe it as a new
algorithm. The dice are never part of an AI file: the optional difficulty house rule belongs to the match set-up.

## Strategy modules (`*.js`, API 1)

```js
bloodboard.register({
  id: 'cautious-scorer',
  name: 'Cautious Scorer',
  apiVersion: 1,
  version: '1.0',
  description: 'Scores when it can, otherwise the best action under 20% Turnover risk.',
  timeLimitMs: 3000,
  async chooseAction(observation, candidates, services) {
    // return { candidateId }  |  { input }  |  { endTurn: true }  |  null (= let the built-in AI decide)
  },
  async chooseDecision(observation, request, services) {
    // return one of request.options[].id  |  null (= let the built-in AI answer)
  },
});
```

**What the module receives**

* `observation` — a read-only, serialisable copy: `apiVersion`, `requestId`, `revision`, `team`, `format`, `phase`,
  `half`, `turn`, `turnsPerHalf`, `score`, `weather`, `rerolls`, `ball`, `used` (once-per-Turn actions) and every
  player's public profile, skills, square, stance, location and activation. **Never** the game state object, the dice
  generator's seed or counter, or any future dice.
* `candidates` (Turn actions) — the legal actions the built-in generator found, each with `id`, `label`, `kind`,
  `playerId`, `input`, the rules engine's exact `pSuccess`, `pTurnover`, `pTouchdown` and the built-in evaluation's
  `builtInValue`.
* `request` (rule decisions: Block dice, re-rolls, pushes, Follow-up, Apothecary, …) — the engine's decision request
  with its `options`.
* `services` (asynchronous, read-only, computed on a copy, no dice rolled): `plan(input)` → the rules engine's plan
  preview (legal or not with the reason, steps, exact probabilities with / without Team Re-rolls);
  `reachable(playerId)` → reachable squares with the Rushes they need.
* **Look-ahead services (V5.5.1, same API version 1)** — `bloodboard.services` lists what the host offers
  (`['plan', 'reachable', 'explore', 'evaluate']`); a module written for V5.5 should check
  `typeof services.explore === 'function'` and do without them otherwise.
  * `explore(input, options)` → every dice outcome of `input`, enumerated by the rules engine's planner (the same
    enumeration the built-in algorithm uses; decisions inside the action — Block dice, re-rolls, pushes, Follow-up —
    follow the previews' policy, `POLICY_ASSUMPTIONS`), merged by resulting position and valued by the built-in
    evaluation from the module's side (a Touchdown = 100 — the scale of `builtInValue`). Returns
    `{ ok, errors, value, pTurnover, pTouchdown, pOpponentTouchdown, pCompleted, enumerated, leaves, outcomes, rest }`:
    `value` is the expected evaluation after the action over all outcomes; `outcomes` are the most likely distinct
    positions, each `{ key, p, value, turnover, touchdown, completed, observation }`; `rest` sums the others.
    Options: `from` (a key: explore from that position), `maxOutcomes` (default 8, up to 40), `observations`
    (default true), `threshold` (smallest branch expanded, default 3e-4), `maxLeaves` (default 700, up to 5000) and
    `maxMs` (default 3000, up to 15000): the enumeration runs on the interface's thread, and in rare positions (a ball
    that can bounce among many players, solved again for each outcome) it takes the engine very long — after `maxMs`
    it is stopped and `explore` answers `{ ok: false, timedOut: true }`.
    `{ kind: 'endTurn' }` can be explored too: its outcome is the position at the start of the other team's Turn, so
    their replies can be explored from its key (still valued from the module's side).
  * `evaluate(from)` → `{ value, terms }`: the built-in evaluation of the request's position (or of an explored one).
  * `plan(input, from)` and `reachable(playerId, from)` accept a key as their second argument.
  * A key is valid only during the request that explored it: the positions themselves stay in the host (the module
    gets their observations, never a game state or the dice generator) and are dropped when the answer arrives. The
    evaluation's weights are the built-in defaults (with the objective and match-clock adjustments of the request's
    position). Exploring costs time on the host (a few ms per action, more for bouncing balls); the module's time
    limit still applies.

**What is checked before anything happens**

* a `candidateId` must be one of those offered; an own `input` must pass the rules engine's plan (legal); a decision
  answer must be one of the request's option ids;
* answers for an older request or revision (the game moved on) are ignored;
* an exception, an invalid answer or the time limit (5 s by default, up to 120 s with `timeLimitMs`) falls back to the
  built-in algorithm for that decision and is shown as a notice in the computer card — the match is never changed by a
  failed module;
* set-up, kick-off and other match steps a module does not answer use the built-in algorithm.

## The built-in algorithm and the boundary

The built-in algorithm (`src/ai`) is called in-process, not through the worker: it reads the game state but never the
dice generator (its plans use the engine's enumerating planner, which does not touch the RNG), and it only returns an
input that the engine then validates like a human's. Strategy modules get the stricter boundary above. AI Focus
advice is read-only: it runs the same thinking on a copy and changes neither the state nor the dice.

## Compatibility

* `formatVersion` / `apiVersion` 1 are the versions of V5.5. A file with another version is listed as not supported.
  V5.5.1 adds the look-ahead services without changing the API version: every V5.5 module runs unchanged, and a
  module that uses them can fall back when they are absent.
* Saves of V5 step 6 and earlier, which named the coach by a style, are mapped to the bundled file of that style.
* Checked by: `tests/coaches.test.ts` (files, conditions, fallback, coach changes, takeovers) and
  `scripts/ui-flow-v55-coaches.mjs` (the set-up lists, invalid files, a strategy module as advisory coach and as a
  team's coach, its observation holding no dice generator).
* Not checked here: discovery and loading of the AI folder **inside the compiled Mac app** (the app was not built in
  this environment). To check it after building: *File › Show AI Folder in Finder* should show the three bundled files,
  `README.txt` and `Examples/`; copy `Examples/aggressive-bashers.json` up one level, press **Reload AI list** in the
  match set-up — "Aggressive Bashers 1.0" should appear in both players' lists.
