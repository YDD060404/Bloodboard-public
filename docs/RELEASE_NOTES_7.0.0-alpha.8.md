# Bloodboard 7.0.0-alpha.8 — coach avatars and operation-flow fixes

Builds on alpha.7 (internet transport profile), alpha.6 (LAN), alpha.5 (training), alpha.4 (histories/replay) and alpha.2 (rules edition, online-coach bridge). Luna (alpha.3) remains not live-verified.

## Usable changes
- **Coach avatars (V7-04)** — customizable animated pixel faces for each computer coach on the Computer card: thinking, acting, cheer, dismay, hurt, driven only by real runtime state and engine events; optional speech bubbles (short reactions; the move's reason only if you turn that on); both can be switched off. See docs/AVATARS.md.
- **Operation flow (V7-03), reproduced on the current UI first:**
  - Undo: the "Undo last action" button and Ctrl/⌘-Z now undo at once in practice, lessons and training (re-confirming the same action reproduces the same dice, so it is harmless) and say what was undone; they still ask in a real match, when the computer's replies would be taken back, and for the easy-to-hit Backspace/Delete key.
  - Stale failed-action messages: an error message is cleared as soon as the coach selects another player or starts a new action (info messages are untouched).
  - Cramped layout, found by a layout probe at 1000/1180/1470 px: rotated dice overhung the dice-tray box and the scoreboard squeezed a team name onto two lines when "COMPUTER"/"TO PLAY" tags were present — fixed (tags now drop under the name as a unit). The probe (`scripts/probe-layout-v7.mjs`) passes at all three sizes.
  - Legal stay/return/jump operations: the engine and the board already expose End activation, Leap/jump planning and the return-to-start affordances; I could not reproduce a missing operation without the original report. Not closed (see below).

## Verification
tsc clean; tests/avatars-v7 6/6; ui-flow-v7-avatars 11/11; ui-flow-v7-operation 8/8; layout probe 3/3; regression UI flows re-run (see release/regress-alpha8.log). Full suite: see the next paragraph.

**Full suite (frozen source sha256 `5c644a1c1a9f518534b3cc051411329de720d254917db7403d4537f062c1c772`, re-verified after the run):** 733 tests in 71/71 test files, 0 failed, 0 skipped, 0 cancelled. Container restarts killed two whole-suite attempts (at 423/705 and at 47 tests), so the final run executed one test file at a time, sequentially, with a marker per file; interrupted files were rerun from scratch and only files with a clean exit are counted. All files ran on the same frozen tree and configuration. Log: `release/full-suite-alpha8.log`. The test total differs from the alpha.7 figure (699) because per-file runs count every file's top-level and nested tests; no test was skipped. Evidence classes: unit/component tests and real-engine tests (suite); Chromium browser flows (regress-alpha8.log); no native Mac, authenticated-provider or real two-device runs.

## Not verified / known limitations
- **V7-02 six-dimensional scouting is NOT started: the definition of the six dimensions is not in any material I hold** (it was in the local Chinese requirements record). I will not invent them — please send the list (names, what each measures, how it should reach the coaches).
- V7-03: the original reports for the stay/return/jump operations and any other small bugs are needed to reproduce and close; only the items above were reproducible.
- Avatars: Chromium only (native Mac app never built); human coaches and network opponents have none.
- Still open from earlier stages: real two-device LAN and cross-network runs, real DeepSeek/Luna calls, High Elf conflict, spatial originals, V7-10 remainder, training remainder.

## Next task
rc.1: close the remaining implementable items (V7-10 remainder: Quick Match remembered settings and batch seed/roster/swap controls; training: UI coach attempts and step-level mistake localisation), full regression, release candidate documentation.
