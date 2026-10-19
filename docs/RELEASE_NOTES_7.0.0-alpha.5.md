# Bloodboard 7.0.0-alpha.5 — tactical training mode

Builds on alpha.4 (histories, drop import, animated replay, analytics) and alpha.2 (rules edition, online coach bridge). Luna (alpha.3) remains not live-verified.

## Usable changes
- **Training** button (top bar): exercise library, import (file picker or drop), export one / all as a pack, start / resume, last result, per-exercise best plan quality.
- **Make exercise…** (File menu / Training): authors an exercise from the board in play. Unusable positions (set-up, kick-off, inside a decision) are refused with the reason.
- **Attempts on the real board** with a Training card: objective, try number, action count, hints, Retry from start, Save progress (resumes after a restart by re-executing), Finish & score, Replay attempt.
- **Fair scoring**: legality by re-execution; what the dice did shown separately; plan quality = the committed sequence replayed on 200 alternate dice seeds, components and weights, 95 % intervals, ungraded when too few samples, limits printed. No win probability, no rating.
- Exercise / pack / attempt files are distinct payloads (`bloodboard-exercise`, `-pack`, `bloodboard-attempt`), hash- and version-checked; duplicates skipped, conflicting ids never overwritten, damaged files refused.
- **Match Lab contract**: `runner.mjs training-run EXERCISE.json [--coach balanced…]` plays one built-in coach attempt; `training-grade EXERCISE.json ATTEMPT.json` re-verifies and grades. Records are the same files the game reads.

See docs/TRAINING.md for formats, the method and limits.

## Verification (stand-in providers; no live calls)
tsc clean; tests/training-v7 7/7; ui-flow-v7-training 25/25; training-lab-smoke 8/8; alpha.4 flows re-run (history 21/21, drop 9/9). Full suite: 699/699 on the frozen source.

## Not verified / known limitations
UI coach attempts (headless only), online-coach attempts, step-level mistake localisation, predictions, native Mac (never built), real DeepSeek/Luna calls, LAN and internet multiplayer (not built), scouting/avatars/interaction fixes, High Elf conflict, spatial originals.

## Next task
alpha.6 LAN multiplayer (V7-05): authoritative host state, rooms/control ownership, rules-edition compatibility, reconnection, shared canonical history. Then alpha.7 internet (V7-12), alpha.8 scouting/avatars/interaction, rc.1.
