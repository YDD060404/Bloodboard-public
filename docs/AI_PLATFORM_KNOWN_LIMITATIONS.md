# AI platform (V5.6) — known limitations

Read this before building a coach. Everything here is true of the delivered V5.6 release.

## Status of the example coaches
* `examples/ai/platform-minimal.js` is the reference example for developers: small, uses `candidates`, returns a `ranking`, posts progress.
* Hopeful 0.2 (`ai-models/hopeful/hopeful-0-2.js`) is an **optional** example of a heavy coach. It is **not shown to be stronger** than Hopeful 0.1 or the built-in coaches; only small pilots were run. Hopeful 0.1 is unchanged (byte-identical to the supplied file).

## Timing
* A coach sets its own `timeLimitMs` in `register()`: 500–120000 ms, default 5000. The host clamps it. `observation.timeLimitMs` tells the coach its limit. A coach may return earlier.
* Services run **synchronously on the host thread**. In the app that is the interface thread, so a long service call pauses redraws (progress updates appear between calls). Keep per-call `maxMs` small (default 3 s, cap 15 s).
* One exact engine plan cannot be interrupted. The platform caps each plan's enumeration (leaf cap from the measured leaf rate) and reports the remainder as `unresolvedMass` with `exact:false`. A module must not treat such a result as exact.
* Time-budgeted coaches are **not bit-reproducible** across machines or runs; a coach that must be reproducible should budget by leaves/calls, not by the clock.
* Test runners and simulations need timeouts above the coach's limit; the platform's own tests use the coach's declared limit.

## Coverage of the services
* `candidates` does not generate Multiple Block, Bomb, Hail Mary Pass, Jump/Leap actions, Chainsaw or Bombardier. Among special actions only Projectile Vomit is generated. A coach may still answer with its own `{input}` (validated by the engine's legality check).
* `threats.*` leave chain pushes uncomputed; `precision:'fast'` drops branches below 1e-4 (reported).
* `sequence` ≤ 8 steps and ≤ 6 branches; `explore` positions ≤ 4000, key depth ≤ 32. Memory use is an estimate.
* Probabilities come from exact engine enumeration; where enumeration is capped they are lower/upper bounded by `unresolvedMass`, never guessed.

## Compatibility
* `apiVersion: 1` is unchanged. Object decision answers (`{optionId}`, `{ranking}`) are honoured only for `apiMinor >= 2`; in V5.5/V5.5.1 and for Hopeful 0.1 they were ignored and still are.
* Modules with `apiMinor < 2` keep V5.5.1 behaviour: legacy `plan/reachable/explore/evaluate` calls reject on stale keys.
* New services appear only for modules that ask for them (`requires`). Progress text is sanitised and rate-limited (80 notes, ≥ 200 ms apart).

## Not done / out of scope
* No learned-model runtime is shipped; the dataset/JSONL tooling and offline batch runner exist (`docs/AI_PLATFORM_DATASET.md`) but no trained model.
* Hopeful tuning, strength benchmarks and extended simulations were paused by request.
* Hopeful looks one opponent action ahead; its constants are hand-set and uncalibrated.
* The Mac app was **not built or launched** by the assistant; the web build and Node/browser tests were run in the cloud workspace.
