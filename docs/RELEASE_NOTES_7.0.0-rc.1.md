# Bloodboard 7.0.0-rc.1 — training review, Coach tries, win-chance estimate, Lab batch controls, 120 s decision ceiling

Builds on alpha.8 (avatars, operation-flow fixes), alpha.7 (internet transport profile), alpha.6 (LAN), alpha.5 (training), alpha.4 (histories/Lab/replay) and alpha.2 (rules edition, online-coach bridge). Delivered alpha releases are unchanged and preserved.

## Scope decisions recorded in this release
- **V7-02 six-dimensional scouting integration is `deferred-by-user`** (2026-10-04): not implemented, not waited for, not completed, not cancelled, not a release blocker. Its requirement text is retained in PROGRESS.json, ROADMAP.md and the acceptance matrix. No scouting integration exists in the application, so nothing needs disabling; any future integration must stay optional. The dimensions and formulas are not invented.
- **Decision-time ceiling raised from 60 s to 120 s** (V7-13) in Bloodboard and the Match Lab (details below).

## Usable changes
- **Training (V7-11)**
  - *Where your plan is risky*: after grading, one line per committed action with how often alternate dice end the Turn there (with a 95 % interval and the number of replays that reached the step; flagged `thin` when too few). It is risk localisation, not a verdict that an action was a mistake.
  - *Divergence*: when a reference line scored clearly higher (its interval entirely above the attempt's), the report names the first differing action in words (route squares are listed when two moves share a destination) and says it is one legal alternative, not the only accepted answer. Shown only after grading.
  - *Coach tries*: plays the exercise with a built-in coach (style selectable) and opens the same scored report, labelled as a coach attempt and stored with the other attempts. Only the game state reaches the coach.
  - Scorer review with the fairness properties mapped to tests: `docs/TRAINING.md`.
- **Win-chance estimate (V7-09)**: optional, cancellable, policy-conditioned sampling estimate in the Match Lab live panel and via `runner win-estimate` — policy stated, sample counts, Wilson intervals, margin ± SE, computation cost shown; one lower-priority process at a time; no online-provider calls; not a calibrated probability. See `docs/WIN_ESTIMATE.md`.
- **Match Lab batch controls (V7-10)** verified against actual runs (swapped-side seed pairs, fresh/fixed seeds, fixed/random rosters, one-click single and batch history export). Quick Match remembered settings were already present and are re-verified.
- **120 s maximum decision time (V7-13)**: host ceiling, module-file clamp, spatial interactive profile, online bridge budget ceiling, generated online coaches (default 55 s budget unchanged; a larger budget declares up to 120 s), Match Lab clamp and a "120 s" option in the Lab. Coaches that declare 60 s keep exactly 60 s. Regenerate online coaches to pick up the new coach-core; delivered coaches still work.

## Bugs found and fixed while verifying
- The win estimator stalled at neutral steps (half time, pre-game): rollouts never finished. It now advances them like the Lab runner.
- The estimate child read `/dev/stdin` synchronously, which fails when spawned through a socket pipe by the Lab runner: no live estimate ever arrived. It now reads stdin as a stream (found only by the real-runner flow test).
- Estimate processes were not stopped with the batch / at full time; now they are.
- Divergence described two routes with the same destination identically; it now lists the route squares.

## Verification (evidence classes kept apart)
**Full suite (frozen source sha256 `4f2265c899d72dbf5444908be0ca1f17382c1ef5343802a4130f6558ee26f661`, re-verified after the run):** 740 tests in 72/72 test files, 0 failed, 0 skipped, 0 cancelled, run one file at a time (log `release/full-suite-rc1.log`). An earlier attempt was discarded in full because one test still encoded the old 60 s limit; the final run started from scratch on the final source. Browser flows and Lab smokes: `release/regress-rc1.log`.
- Unit/component (real engine): training 10/10, win-estimate 3/3, hostext/spatial additions, online component tests 51/51.
- Real Match Lab execution: `lab-batch-controls-smoke` 11/11, `lab-estimate-flow` 12/12 (real Lab server + runner + page), `training-lab-smoke` 8/8, `lab-analytics-flow` 7/7, Lab API clamp check for the 120 s limit.
- Browser (Chromium): ui-flow-v2 37/37, v3 45/45, v55-quick 24/24, v55-coaches 47/47, v6-setup-persist 31/31, v7-training 28/28, v7-history 21/21, v7-drop 9/9, v7-avatars 11/11, v7-operation 8/8, v7-online 18/18.
- NOT done: native Mac build/launch; any authenticated DeepSeek/Luna call (including at 120 s); two real LAN devices; cross-network internet play. Loopback LAN/internet tests are component tests only.

## Known limitations
- A built-in-v-built-in game finishes before a live estimate can arrive (a continuation costs about a whole game); estimates are for slower games and late positions. The game's replay panel has no on-demand estimate.
- Coach tries offers built-in coaches only; the start state still carries the exercise seed (documented; the built-in coach does not read it).
- Still open: V7-02 (deferred by the user), live provider runs, native Mac, two-device LAN and cross-network runs, High Elf conflict, spatial originals, COACH-08 folders, original operation-flow bug reports (see `docs/USER_ACTIONS.md`).

## Next task
Freeze rc.1, run the full suite on the frozen source, package and deliver; then 7.0.0 (cloud-verified, with the unverified native/live/two-device items stated explicitly).
