# Canonical match history — `bloodboard-history` v1 (V7-06)

One format for the game, the Match Lab and (later) multiplayer. Implemented in `src/engine/history.ts`; tests `tests/history-v7.test.ts` (real match files) and `scripts/ui-flow-v7-history.mjs` (game UI).

## Shape
`format:"bloodboard-history"`, `version:1`, `id` (content identity), `source` (`game|lab|multiplayer|training`), `title`, `createdAt`, `rulesEdition` (`faq2026` or `legacy`), `engine{version,engineHash,rulesHash,apiHash}`, `variant`, `seed`, `participants{A,B}{name,roster,controller{kind,coachId,coachVersion,provider,model}}`, `initial` (the match's stored initial state), `log` (every input, decision and die), `result{score,winner,completed,entries}`, `verified{method:"replay",ok,entries,at}`, optional `extensions`.
A **batch** is `format:"bloodboard-history-batch"`, `version:1`, `games:[history…]`.

## Rules
- **Verification is re-execution.** `verifyHistory` replays `initial` + `log` with the authoritative engine and checks every input, decision, die, the final result and the id. Stored claims are never trusted on their own.
- **Editions are explicit.** A match started before the rules edition existed stays `legacy` and replays under its recorded rules (never upgraded). Unknown editions, a mismatch between `rulesEdition` and the stored initial state, and newer format versions are refused with a reason — nothing is guessed.
- **Honest grades**: `verified` (same rules code), `verified-other-rules-code` (still reproduces exactly), `refused`.
- A practice position or an empty match cannot be exported; a history that does not reproduce is not written.
- A batch verifies each game independently; one bad game never hides the others.
- No credentials. The seed is part of the match identity; the dice that were rolled are already in the log.

## Where it is used
Game: *File → Export history…* (matches) and *Import…* / drag-in text (history or batch → Replay). Lab: each completed game also writes `<game>.history.json` next to its `.save.json` (a failure is recorded as `canonicalHistoryError`, never skipped silently). The older Lab records (`bloodboard-lab-history/2`) and game saves (`bloodboard-position`) keep working unchanged.

## Not done yet (V7-06 remainder)
Lab batch export button/CLI to one batch file; multiplayer adoption; drag-and-drop import UI (V7-07); decision-source provenance per log entry.
