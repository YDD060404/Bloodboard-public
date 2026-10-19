# Bloodboard 7.0.0 — release closure

Version 7.0.0 is the closure of the staged V7 releases (alpha.2, 4, 5, 6, 7, 8, rc.1). It is **not** a statement that every V7 requirement is complete. Source changes since rc.1: the version string only (package.json, online bridge, Info.plist; rebuilt). Delivered earlier releases are preserved unchanged.

## Verification of this release
- Frozen tested-source sha256: `5aab1091581e6a9fd012193975aba841c8b8f9c6c46cb1f0f391e5fe7a38157f` (re-verified identical after the run).
- Full suite: 740 tests in 72/72 files, 0 failed, 0 skipped, 0 cancelled, one file at a time (`release/full-suite-7.0.0.log`).
- Browser (Chromium), real Match Lab runs and Lab smokes: `release/regress-7.0.0.log` (16 flows, all passed; the five Lab flows were re-run on the final 7.0.0 runner 90253e18…: analytics 7/7, estimate 12/12, training 8/8, smoke-v6 24/24, batch controls 11/11).
- Evidence classes stay separate: unit/component (real engine), real Match Lab server+runner+workers, browser, loopback (LAN/internet components). **Not done anywhere:** native Mac build/launch, authenticated DeepSeek/Luna calls, two real LAN devices, cross-network play.

## 120-second decision ceiling (V7-13) — consistency check
| Layer | Location | Value |
|---|---|---|
| Host limit | `src/platform/limits.ts` maxModuleMs | 120000 |
| Coach loader clamp | `src/ui/aiload.ts` | min(120000, declared) |
| Spatial interactive profile | `src/platform/spatial.ts` | 120_000, cap message 120000 |
| Online bridge | `online/bridge.mjs` MAX_BUDGET_MS | 120_000 |
| Generated online coaches | `online/coach-core.js` | declares min(120000, max(60000, budget+5000)); default 55 s budget unchanged |
| Match Lab | `lab.mjs` clamp and UI option "120 s" | 120000 (300000 is clamped) |
Coaches that declare 60 s keep exactly 60 s. Regenerate online coaches to pick up the new coach-core. Live provider calls at 120 s are unverified.

## Implemented and verified in the cloud (component / real-Lab / browser)
Rules edition and May 2026 FAQ corrections (engine/data); generation-aware rule answers; Lab keeps API generation/schema; canonical histories with individual/batch export and direct viewing; Match Lab batch controls (swapped-side seed pairs, seeds, rosters, one-click export); remembered Quick Match settings; tactical training (exercises, packs, attempts, scorer review, Coach tries); optional cancellable policy-conditioned win-chance estimate (not a calibrated probability); animated replay; avatars; operation-flow fixes found so far; LAN and internet transport (loopback only); drag-and-drop import; 120 s ceiling.

## Partially implemented / stand-in only
COACH-01, COACH-03 (Node lifecycle verified; native auto-start unverified), COACH-05, COACH-06, COACH-09, COACH-10 (DeepSeek and Luna provider code; no live run), V7-01 (large AI packages: caps not fully removed), V7-03, V7-04, V7-05, V7-07, V7-08, V7-09 (no on-demand estimate in the replay panel), V7-11, V7-12, SPATIAL-INFRA.

## Not implemented / pending
COACH-04, ORACLE-01, SPATIAL-03, -04 (profiles partly present), -05, -06, -07, -08.

## Blocked on information or on your device
COACH-02 (Luna via ChatGPT subscription), COACH-08 (install into the two AI folders), SPATIAL-01/02/09 (original bbv2/obs-v6/Sevens materials; never guessed), FAQ-HE (High Elf source conflicts).

## Deferred by the user
**V7-02 six-dimensional scouting integration — `deferred-by-user`.** Not implemented, not completed, not cancelled, not a release blocker; requirements retained. No scouting code exists in the app; any future integration must remain optional. Dimensions and formulas have not been invented.

## Known limitations
Built-in-v-built-in games finish before a live estimate arrives; Coach tries offers built-in coaches only; the Mac native app is unbuilt (`native/*.swift` unverified until compiled on a Mac).

## Install and verify
See `INSTALL.md`, `docs/LOCAL_VERIFICATION.md`, `docs/USER_ACTIONS.md`. Verify the package with `sha256sum -c SHA256SUMS` inside the extracted folder; fingerprints are in `MANIFEST.json`.
