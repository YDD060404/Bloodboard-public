# Bloodboard AI platform (V5.6) — reference

The strategy platform lets any number of coaches (rule-based, heuristic, search-based, learned) play through the
**same** authoritative engine services. It is generic: nothing in the platform or its API mentions a particular coach,
principle or weight. Hopeful 0.2 is one consumer (`docs/HOPEFUL_0_2.md`).

Architecture note: `docs/AI_PLATFORM_ARCHITECTURE.md`. Offline research and the dataset: `docs/AI_PLATFORM_DATASET.md`. **Known limitations: `docs/AI_PLATFORM_KNOWN_LIMITATIONS.md`.** Example coach: `examples/ai/platform-minimal.js`. Schemas: `docs/schemas/platform/`.
Machine-readable: `docs/schemas/platform/*.json` (JSON Schemas, `capabilities.json`); at run time `services.capabilities()`
and `services.schema(name)`.

## Writing a coach

```js
bloodboard.register({
  id: 'my-coach', name: 'My Coach', version: '1.0',
  apiVersion: 1,            // major: always 1
  apiMinor: 2,              // the additive release you were written for (0 = V5.5, 1 = V5.5.1, 2 = V5.6)
  requires: ['candidates', 'explore'],   // optional: services you need (the AI list shows a clear error if missing)
  timeLimitMs: 30000,       // YOUR thinking-time limit per decision, 500 – 120000 ms (5000 when omitted)
  async chooseAction(observation, candidates, services) { … },
  async chooseDecision(observation, request, services) { … }, // optional
});
```

`timeLimitMs` is read from the coach's own file and applies per decision; the host clamps it to 0.5–120 s. A coach may
return as soon as it has a move it trusts — the time is a limit, not a duration. `observation.timeLimitMs` tells the
coach the limit that applies to this request so it can budget itself.

## Observation (read-only, JSON)

Every player (profile `ma st ag pa av`, `skills`, `name`, `keywords`, `pos`, `stance`, `location`, `activated`,
`distracted`, `tackleZone`, `canBeActivated`, `usage`, `rooted`…), the ball, score, `turn`/`half`/`turnsPerHalf`,
`weather`, `rerolls`, `phase`, `active`, `used` actions, the current `activation`, teams (re-roll kinds, apothecary,
special rules), pitch size and End Zones, and `pending` (the rule decision the game waits for, with options and context).
**`observation.builtInChoice`** (V5.6.1, action requests only, additive): what the built-in coach itself would do in this position — `{ candidateId: <index in the offered list> | null, endTurn: boolean }`. A coach can defer to it, measure itself against it, or deviate only when its own analysis clearly says so. It is information about the built-in coach, not a rule; it never depends on hidden state.
Schema: `observation.schema.json`. It never contains the dice generator, its seed or counter, or any future die.

## Services (all read-only; results are data, never verdicts)

| Service | Since | Purpose |
|---|---|---|
| `plan(input, from?)` | 1.0 | Engine preview of an input: legality, steps, exact probabilities |
| `reachable(playerId, from?)` | 1.0 | Reachable squares with Rushes needed |
| `explore(input, opts)` | 1.1 | Every outcome of an input merged by resulting position, each with a **key** to continue from |
| `evaluate(from?, opts)` | 1.1 | Built-in evaluation (optional baseline), terms, optional feature vector, either team's perspective |
| `candidates(opts)` | 2.0 | Legal candidate actions of the **active** team in the root or any explored position |
| `threats.tackleZones` / `.reach` / `.blitz` / `.scoring` / `.crowd` | 2.0 | Threat data (see below) |
| `sequence(opts)` | 2.0 | Exact evaluation of a sequence of actions, continuing from result keys |
| `features(from?, opts)` | 2.0 | Stable feature vector (`features/1`) |
| `progress(update)` | 2.0 | A short factual note for the person watching a long decision |
| `capabilities()`, `schema(name?)`, `diagnostics()` | 2.0 | Discovery, schemas, this request's diagnostics and usage |

### Position keys

`explore` and `sequence` return a `key` (`"<requestId>.<n>"`) for each resulting position. `from` on any service names a
position; omitted or `"root"` is the request's own position. Keys exist only for the request that issued them:
a key from another request (or one dropped by a cap) is rejected with `code: "stale-key"`.

### `candidates`

Lists the legal actions of the team active in the position — **no built-in restriction** (the built-in coach's pruned
list is available as `builtIn` on matching records of the root position). Options: `from`, `team` (validated; a team that
is not active there is rejected with `wrong-team`), `families` (`move standUp secure block blitz pass handoff foul ttm
special endActivation endTurn`), `players`, `targets`, `region` (`{x0,x1,y0,y1}` or `{within:[{x,y}…]}`), `maxRushes`,
`maxDodges`, `minPSuccess`, `maxPTurnover`, `minPTouchdown`, `limit`/`offset` (pagination), `maxPerFamily`,
`maxPerPlayer`, `sort` (`pool goalDistance steps pSuccess pTouchdown pTurnover`), `precision` (`exact` default, `fast`
labelled inexact, `none` = legality only, no probabilities), `detail`, `builtIn`, `outcomeValue`, `includeIllegal`, `maxMs`.
Each record: request-scoped `id`, `position`, `team`, `family`, `kind`, `actorId`, `targetId(s)`, `label`, full `input`
and `path`, `legal`, `rushes`, `dodges`, `exact`, `pSuccess`, `pTurnover`, `pTouchdown`, `pOpponentTouchdown`,
`pActiveHasBall`, `pOppHasBall`, `pBallGround`, `noTeamReroll`, `block` analysis, optional `builtIn` and `outcome`.
Probability filters and sorts need exact numbers for the whole pool (capped by `maxExactPerCall`); structural filters
(`players`, `targets`, `region`, `families`, `maxRushes`) run first and are cheap — **prefer them**. Every cut is
reported in `truncated`. Special actions: only Projectile Vomit is generated. Not generated (propose with `input`, check with `plan`): Multiple Block, Bomb throws, Hail Mary passes, Jumps over a player, Chainsaw and Bombardier star actions.

### Threat primitives

* `threats.tackleZones({from, team?, projected?, detail?})` — squares covered now by each team, and the coverage each
  could project with one movement of every standing player (Dodge/Rush risk ignored; see `reach`).
* `threats.reach({from, team?, players?, maxRushes?, maxDodges?})` — reachable squares with `rushes`, `dodges` and
  `pSafe` of the safest route (skill re-rolls only).
* `threats.blitz({from, team?, targets?, attackers?, squares?, precision?})` — every legal Blitz of the **active** team on
  the targets: attack square(s), route risk, and the engine's outcome: attacker `pTurnover`, `pTargetDown`, `pTargetCrowd`,
  `blockResult`, dice and strengths. To see the opponent's Blitzes on your carrier, explore `{kind:'endTurn'}` to get a
  position in which they are active, then call it with that key.
* `threats.scoring({from, team?})` — the active team's carrier's direct scoring routes with exact chances.
* `threats.crowd({from, team?})` — players a single Block could push into the crowd (engine push rule), and exact Block
  outcomes for attackers already in place. **Not computed:** chain pushes.

### Stochastic outcomes and rule decisions

`explore`/`sequence` results state their policy in `decisionPolicy`. Default (`"builtin"`): the engine's fixed policy
resolves in-action choices (Block die, re-roll, push square, Follow-up …) and its assumptions are listed. `decisions`:
`"adversarial"` (own best, opponent worst), `"optimistic"`, or `{own, opponent, branchTypes}` with `builtin|best|worst`
enumerates those choices as branches and solves them (expectimax); `decisionSummary` reports what was chosen.
Probabilities are the engine's exact enumeration; mass left unexpanded (threshold, `maxLeaves`, `maxMs`) is reported as
`unresolvedMass` with `exact:false` and `approximation` — never guessed, never sampled.

### Evaluation and features

`evaluate({perspective: 'A'|'B'|'self'|'opponent'|'active', features?:true})` returns the built-in value (a baseline you
may ignore), its 16 `terms`, and with `features` the `features/1` vector (`names`, `values`). Order is stable; additions
come only at the end in a minor release.

## Responses

Action (`chooseAction`): `{candidateId: n}` (legacy list), `{candidateId: "<req>.c<n>"}` (from `candidates`, root
position only), `{input, why}` (your own input — planned by the engine, must be legal and the team's), `{endTurn:true}`,
or `{ranking:[{candidateId, score|logit}…], why}` — the host plays the best valid entry and records softmax
probabilities. Optional `trace` (JSON, ≤ 40 KB) is stored with the move and never interpreted.
Decision (`chooseDecision`): `"optionId"` (API 1), or — declare `apiMinor: 2` — `{optionId, why}` or
`{ranking:[{optionId, score|logit}]}`. (In V5.5/V5.5.1 object answers were silently ignored; they stay ignored for
modules that do not declare `apiMinor >= 2`.)

Anything invalid, stale, thrown, late or illegal falls back to the built-in coach for that decision and is visible in
`meta.diagnostics` (and as a notice in the app).

## Progress (long decisions)

`services.progress({stage, headline, evaluating:[…], ruledOut:[…], best:{label, pTurnover, pTouchdown, value, detail}, fraction})`
publishes a short note. The host sanitises it (text length, control characters, list sizes), rate-limits it (≥ 200 ms
between notes of one stage, 80 per request) and shows it in the match's computer card once a decision has run for about
three seconds, together with the elapsed time against the coach's own limit and the number of engine look-ups. It is display
only and cannot change the decision. Publish facts (what you are weighing, what you ruled out and why, the best line so far
with its numbers), not raw reasoning.

## Limits (effective values: `services.capabilities().limits`)

| Limit | Value |
|---|---|
| Module time per decision (`timeLimitMs`) | 0.5 – 120 s, default 5 s |
| Share of that time the services may use | 90 % |
| Service calls per request | 6000 |
| Wall-clock per call (`maxMs`) | default 3 s, at most 15 s |
| Enumerated leaves per call / per request | ≤ 20 000 / 2 000 000 |
| Outcomes returned per `explore` | ≤ 40 |
| Kept explored positions / estimated memory / key-chain depth | 4000 / 400 MB / 32 |
| Candidates per page / exact evaluations per call | ≤ 400 / 300 |
| `sequence` | ≤ 8 steps, ≤ 6 branches per step |
| Progress notes | 80 per request |

A breach returns `{ok:false, code, message}` or a truncated result and adds a structured diagnostic
(`{seq, tMs, service, code, severity, message, limit, max, value}`); memory is bounded by counts and an *estimate*, not measured.

**Platform constraints to know:** services run synchronously in the host (in the app: on the interface thread), so a single
long call (up to its `maxMs`, 15 s at most) pauses redraws until it returns — coaches should prefer many short, pre-filtered
calls; the wall-clock limit is enforced by terminating the coach's worker, but a service already running finishes first.
Time-budgeted coaches are not bit-reproducible across machines of different speed.

## Versioning

`apiVersion` (major) stays `1` as long as every V5.5/V5.5.1 module keeps working unchanged. Without a major bump the
platform may: add services, options, result fields, candidate families, diagnostic codes, response forms and feature names
(at the end); raise limits; add new `apiMinor` behaviour that older modules do not opt into.
A major bump (`apiVersion: 2`) is needed only to: remove or rename a service/option/field; change the meaning, units or
shape of an existing field (for instance a different `pTurnover` definition or another candidate id format); make an
existing limit stricter; change the legacy candidate list or observation fields' meaning; or make `chooseAction` /
`chooseDecision` answer semantics stricter for modules that do not declare a newer `apiMinor`. A module that needs newer
services declares `apiMinor` and `requires`; the AI list refuses it with a clear message on a host that lacks them.

## Safety model

Modules run in a worker, read copies, and never receive the game state, the dice generator, its seed or counter, future
dice, or any mutation method. Position keys are request-scoped. The requested team is validated against the team active in
the position. The rules engine remains the only source of truth: every service is an engine call, every answer is validated
by `planAction` before it is played.
