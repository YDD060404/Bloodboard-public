# AI platform — architecture note (V5.6)

Status: design that the code in `src/platform/` implements. The long-form reference is `docs/AI_PLATFORM.md`.

## What was found

| Piece | State in V5.5.1 | Consequence |
|---|---|---|
| Strategy host (`src/ui/strategy.ts`) | Builds the observation, runs the module in a Worker, offers 4 services (`plan`, `reachable`, `explore`, `evaluate`). All logic lives in the UI file. | Not reusable headless; nothing to extend without touching the UI. |
| Candidates | Only the built-in's pruned list at the **root** position (`genForPlayer` keeps ~3 squares per player, 2–4 blitz/pass targets, …). | A coach cannot list the legal actions at an explored position, or see what the built-in pruned away. |
| Outcome exploration | `exploreOutcomes` resolves every in-action decision (Block die, re-roll, push, Follow-up …) with one fixed policy (`POLICY_ASSUMPTIONS`). | A single policy is silently baked into every coach's numbers. |
| Evaluation | `evaluate()` returns only the non-zero terms of one weight set, from the requested team. | No stable vector; nothing a learned model could consume. |
| Decision answers | A rule decision must be a bare option id. Hopeful 0.1 answers `{ optionId }`, which **both hosts silently ignore** (its touchback choice has never run). | Needs a documented, versioned response form. |
| Limits | `MAX_LIMIT_MS = 20000` in the code (docs/Hopeful say 60 s); per-call `maxMs`, but no per-request budgets, no diagnostics. | Needs reconciling and structured diagnostics. |

## Layers

```
┌────────────────────────── coaches (strategy modules, *.js) ──────────────────────────┐
│ Hopeful 0.1 / 0.2, Genius, Expert, future rule / heuristic / search / learned coaches  │
└───────────────▲──────────────────────────────────────────────────────────▲────────────┘
                │ Strategy API 1.x (observation, candidates, services, responses)        │
┌───────────────┴───────────── isolated worker (same HARNESS everywhere) ───────────────┴─┐
│ app host: src/ui/strategy.ts (Web Worker)     headless host: src/platform/nodehost.ts    │
│                               (worker_threads)                                           │
└───────────────▲──────────────────────────────────────────────────────────▲──────────────┘
                │ one shared, host-independent core: src/platform/*                        │
┌───────────────┴───────────────────────────────────────────────────────────┴─────────────┐
│ session (keys, limits, diagnostics) · observe · candidates · threats · explore/decisions  │
│ features · respond (validate + rank) · schemas/capabilities                               │
└───────────────▲─────────────────────────────────────────────────────────────────────────┘
                │ only the engine's public API (planAction, exploreOutcomes, reachableSquares …)
┌───────────────┴───────────────── rules engine (source of truth) ─────────────────────────┐
```

Offline research (`src/platform/research/*`, `scripts/ai-platform-batch.ts`) sits *beside* this stack, not inside
it: it schedules matches, calls the same host, and writes JSONL. Match-time code never imports it.

## Decisions

1. **One core, two transports.** Every service is a synchronous function `(session, args) → result` in
   `src/platform`. Hosts only move messages (Web Worker in the app, `worker_threads` in Node) and enforce the
   wall-clock limit by terminating the worker. The headless runner therefore tests exactly what the app runs.
2. **Additive versioning.** `apiVersion` stays `1`. A new `apiMinor` (0 = V5.5, 1 = V5.5.1, 2 = V5.6) and an
   optional `requires: [...]` list in `register()` describe what a module needs; services are only ever added.
   Behaviour that would change an existing module's result (for instance accepting `{optionId}` as a decision
   answer) is enabled only for modules that declare `apiMinor >= 2`. A major bump is needed only for the cases
   listed in `docs/AI_PLATFORM.md` §Versioning.
3. **Generic services, no coach knowledge.** `candidates`, `threats.*`, `explore` (+ `decisions` policy),
   `sequence`, `features`, `evaluate({perspective})` return *data*. Nothing in `src/platform` mentions Hopeful or a
   tactical principle; thresholds (for example 90 % / 95 %) live in the coach.
4. **Keys and scoping.** Every explored position gets a request-scoped key (`<requestId>.<n>`); a key from another
   request, a dropped key or a key beyond the position cap is rejected (`stale-key`). Any service that produces
   actions validates the requested team against the active team of the position (`wrong-team`).
5. **Decision policy is explicit.** `explore` labels the policy it used in every result
   (`decisionPolicy: { mode: 'builtin', assumptions: [...] }`). `decisions: 'branch'` enumerates the coach's and the
   opponent's in-action choices as branches; `{ own: 'best', opponent: 'worst' }` solves them (expectimax) over the
   enumerated tree. Nothing is chosen silently.
6. **Exact or labelled.** Probabilities are the engine's enumeration. Whenever mass was left unexpanded
   (`threshold`, `maxLeaves`, timeout) the result says `exact: false` with `unresolvedMass`.
7. **Budgets everywhere.** Per call (`maxMs`, `maxLeaves`, `maxOutcomes`, `limit`), per request (service calls,
   enumerated leaves, positions, total service time, key-chain depth) and per module (60 s cap). A breach returns a
   structured diagnostic (`{ code, limit, limitValue, detail }`), is recorded on the request and shown with the
   result; the module can keep going or stop. Memory is bounded by counts (positions, candidates, outcomes), not by
   measured bytes — documented as such.
8. **Validation and fallback.** The host validates every response form (`candidateId`, `input`, `endTurn`, `ranking`,
   decision answers). Anything invalid, stale, timed out or thrown falls back to the built-in coach; the reason is a
   `diagnostics` entry attached to the move (toast in the app, record in traces).
9. **Offline is separate.** Dice, seeds and engine internals exist only in offline traces, in files separate from
   the coach-visible dataset (`trajectories.jsonl` vs `internal.jsonl`); the match-time observation never carries
   them.

## Engine changes

Two small, read-only additions (the rules are untouched, all existing tests must pass unchanged): a `cursor`
accessor on `EnumDice` and an optional `decider` hook in `exploreOutcomes`' options so the platform can branch on
in-action decisions. Everything else uses the existing public API.
