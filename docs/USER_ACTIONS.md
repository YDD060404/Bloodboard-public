# What only you can provide (consolidated; none of these blocks unrelated work)

| # | Needed | Unblocks | How |
|---|---|---|---|
| 1 | Your DeepSeek API key, entered **locally** in the Online coaches panel (never in chat) | COACH-10 DeepSeek live evidence | docs/LOCAL_VERIFICATION.md §A, send back `online/verification-reports/deepseek-*.json` |
| 2 | Your ChatGPT sign-in on your Mac + the siwc runtime build | COACH-02 / COACH-10 Luna live evidence | §B |
| 3 | Build and launch the Mac app (also `BLOODBOARD_NATIVE_BRIDGE=1` option) | COACH-03 native auto-start, native verification claims | §C, send build log + screenshot |
| 4 | On your Mac: run `bash install_bloodboard.sh` (verifies the package, installs V7 beside the rollback, merges older AI folders into the ONE shared folder `~/Library/Application Support/Bloodboard/AI`, checks game and Lab see the same coach hashes), then the checklist in docs/LOCAL_INSTALL.md | COACH-08, INSTALL-01, native verification | docs/LOCAL_INSTALL.md §1-3; send back `~/Desktop/Bloodboard/install-reports/install-*.txt` |
| 5 | Only if you disagree: the High Elf conflicts were adjudicated per field in 7.0.1 (docs/HIGH_ELF_ADJUDICATION.md: Lineman Secondary = S; Dragon Prince keywords = Elf, Blitzer, Runner). Send an official erratum or a different choice and it becomes one data-line change | FAQ-HE (no longer blocking) | reply with the value |
| 13 | After the install is accepted: `bash retire_obsolete.sh inventory`, review the candidate list, then `archive` and (only if you agree) `retire --confirm-verified` | safe retirement of obsolete installs (nothing is deleted; originals are moved into the archive) | docs/LOCAL_INSTALL.md §4 |
| 6 | The original spatial-network materials (bbv2 checkpoints/converter, obs-v6 frame definitions, Sevens data) | SPATIAL-01/02/09 exact compatibility (kept UNVERIFIED, never guessed) | place in a connected folder or attach |
| 12 | After a live provider run: confirm one decision with a 120 s declared budget completes or falls back truthfully | V7-13 live evidence | docs/LOCAL_VERIFICATION.md |
| 7 | Say which Luna model(s) your account lists (from the panel) | model-specific notes only | optional |
| 8 | Two devices on one LAN: run the two-device match in docs/LAN.md and report | V7-05 acceptance (currently loopback-only) | follow docs/LAN.md "Your two-device acceptance run" |
| 9 | Two distinct networks + a tunnel/port-forward on the host: run docs/INTERNET.md "Your cross-network acceptance run" and report | V7-12 acceptance (currently loopback-only) | follow docs/INTERNET.md |
| 10 | The definition of the **six scouting dimensions** (names, what each measures, how coaches should receive them) — the local Chinese requirements record is not available in the cloud | V7-02 — **deferred-by-user** (2026-10-04): not needed for rc.1 / 7.0.0; send it only when you lift the deferral (never guessed) | paste the list or attach the relevant section when resuming |
| 11 | The original reports for the operation-flow bugs (stay / return / jump operations and any other small UI bugs) | V7-03 remainder | paste or attach |
