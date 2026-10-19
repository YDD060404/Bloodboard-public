# V6 compatibility, save format and Replay

## Legacy AI
- `apiVersion: 1` modules and parameter files are untouched by v2: same observation, candidates, `chooseAction`, set-up hook (fixed fielding) and context semantics as V5.8. Hopeful stays at **1.5.4-GPT** (no 1.5.5, no strategy inside the engine).
- A v2 module that `requiresCapabilities` the host does not offer is listed with an error; optional capabilities missing → the hook is simply not called.
- Regression coverage on V6: `tests/hostext.test.ts` (V5.8 host fixture), `scripts/ui-flow-v58-host.mjs` (real UI, 16 checks, incl. an apiVersion-1 module playing a full match), `tests/legacy-coaches-v6.test.ts` (short smoke of the bundled coaches through the host).

## Saves
Format `bloodboard-position` **version 2**; `meta {saveFormatVersion, matchId, displayName, engineVersion, rulesHash, initial, coachContext, …}`. V1 files open (identity derived from seed + first log entry). `matchId` ≠ display name ≠ file name; saving the same match updates in place, anything else gets a collision-safe name (`Name`, `Name (1)`…, exclusive create). `checkCompatibility(save)` flags rules/engine hash differences instead of silently resuming.

## Replay
Re-execute the recorded inputs/decisions from the initial state with the real engine and compare `[input, decision ids, events, outcome]`. Grades: *replayable* (stored initial), *replayable after migration* (initial reconstructed, incl. undoing pregame Prayers), *position only* (mismatch/edited history — controls disabled, never guessed). All 10 real saved matches replay dice-for-dice (`tests/replay-real.test.ts`).
Not covered: hand-edited histories, coach-change entries beyond log equality, saves made under changed rules (flagged only), "continue from here" branching.
