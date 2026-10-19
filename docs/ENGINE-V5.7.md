# V5.7 — engine pool, parallel analysis, Match Lab 2

## What changed
- **Engine pool** (`src/platform/pool.ts`, `engine-worker.ts`, `dispatch.ts`): heavy analysis services (candidates, threats.*, explore, sequence, plan, reachable) run in worker threads instead of the interface thread. Independent work is fanned out: a dry pass lists the exact plans a service needs, uncached plans are computed in parallel on all workers, then the real pass reads them. Independent calls of a strategy coach can be sent as one `batch` service call or as concurrent requests.
- **Isolation**: workers get analysis views of states (no dice generator, no log), keep their own position registries per request, and never touch the live match. The built-in coach gives the same answer on such a state (tested).
- **Caching**: plans and complete service results are cached by position hash (rules, resources, policies, precision included) + question + leaf cap. An entry answers a later request only if exact or computed with an equal/larger cap. Unresolved probability is always reported; a cut-off result is never cached as complete.
- **Thinking time is not shortened.** Deadlines, cancellation (stale position cancels the module and the pool work within ~250 ms) and progress stay live. A decision with a single legal option is answered at once. A strategy coach's built-in option analysis runs in a worker.
- **Progress panel** shows the current stage, plans done/total, workers busy, best legal option so far, remaining uncertainty.
- **App setting**: More → *Analysis workers*: Auto / Off / 1 / 2 / 4 / 6 / 8 (Auto = clamp(⌊(cores−2)/2⌋, 1, 4)). If workers cannot start, the game silently uses the interface thread.
- **Match Lab 2**: see match-lab/README.md. Same pool and shared engine code run whole matches headless, several at a time.

## Measurements (cloud Linux sandbox, **2 cores** — not your Mac)
Same five fixed positions (`bench/positions.json`), same settings, leaf cap fixed at 20000.

| position | inline | 1 worker | 2 workers | 4 workers |
|---|---|---|---|---|
| sevens-human-orc-s3@63 | 1.5 s | 1.2 s | 1.8 s | 1.8 s |
| sevens-human-orc-s3@140 | 24.9 s | 21.7 s | 14.8 s | 16.1 s |
| sevens-draft-elf-dwarf-s5@95 | 23.5 s | 27.0 s | 34.8 s | 30.9 s |
| standard-human-orc-s4@122 | 3.8 s | 4.5 s | 3.1 s | 3.3 s |
| standard-human-orc-s4@326 | 5.3 s | 5.0 s | 3.5 s | 3.9 s |
| total | 59.0 s | 59.4 s | 58.1 s | 56.0 s |

- Results are identical to inline on 3 of 5 positions. On @140 the inline run hit the 15 s per-call cap (30 of 41 attack scans done); the pool finished them all in 7.8 s. On @95 the risky-candidate generation is time-capped in every mode, so the set evaluated differs. Maximum unresolved probability: 17.5% inline, 18.3% pooled (the same caps; the pool evaluated a different, slightly larger set).
- Workers 2 helped the positions with independent work (@140, @122, @326: 1.2–1.7×); on a position dominated by one long enumeration (@95) the fan-out overhead made it slower. With only 2 cores 4 workers cannot beat 2. **A 10-core Mac could not be measured here; the Auto default is reasoned, not proven.** Run the benchmark there (below) and set the workers accordingly.
- Memory (process RSS after the five positions): inline 233 MB, 1 worker 295 MB, 2 workers 473 MB, 4 workers 770 MB.
- Actual concurrency (time-weighted average busy workers, corrected statistic): see `workerBusyMs` in the bench JSON; peak busy equalled the worker count.

Lab throughput, one swapped pair (2 games, fixed seed and teams, identical results in all three runs):

| configuration | wall time | peak games | workers busy (avg) | resident |
|---|---|---|---|---|
| 1 game, no workers (Lab 1 behaviour) | 418 s | 1 | – | 1.2 GB |
| 1 game, 1 worker | 395 s | 1 | 1.0 | 1.3 GB |
| 2 games, 2 workers | 297 s | 2 | 1.4 | 1.5 GB |

A single decision cannot be split, so one game gains little; batch throughput scales with games in flight (1.4× for 2 games on 2 cores, bounded by the slower game and the core count).

## Benchmark on your Mac
    cd ~/Desktop/Bloodboard/V5.7 && bash scripts/bench-mac.sh
(builds the benchmark and runs inline, then 1, 2, 4 workers; writes bench/mac-*.json; compare with `python3 scripts/bench-compare.py bench/mac-inline.json bench/mac-w4.json`.) Takes roughly 10–15 minutes.

## Limitations
- One long enumeration (a single huge blitz scan) is not split across workers.
- Pool of the built-in coach gives no speed-up inside one decision (it is one worker's work), only a free interface thread.
- Everything here was tested on Linux; the Mac app was not built or run by me.
