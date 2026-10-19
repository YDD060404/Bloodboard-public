# Bloodboard 7.0.0-alpha.2 — release notes

Release scheme: alpha.1 foundation+rules · **alpha.2 DeepSeek + bridge lifecycle (this build; includes the alpha.1 content)** · alpha.3 Luna live · alpha.4 histories/Lab/replay · alpha.5 training · alpha.6 LAN · alpha.7 internet · alpha.8 scouting/avatars/interaction · rc.1 · 7.0.0. Luna's code ships here but is not live-verified, so alpha.3 stays open.

## What you can use now
- **Online coaches (DeepSeek, ChatGPT Luna)**: local bridge + generated coach files + *Online coaches…* panel in the AI set-up, in the web/native game and (through the generated coach file) the Match Lab.
- **Bridge lifecycle**: single instance, ready line, auto-port, shutdown with the app, `--replace`. Mac auto-start is written but UNVERIFIED (never compiled).
- **Rules edition** (`faq2026`): FAQ corrections for new matches; old matches replay dice-exact under their recorded rules; edition survives save/export/import; unsupported editions refused; cache keys edition-aware.
- Match Lab runner + worker rebuilt from the same sources as the web build (`match-lab/` in the package).
- docs: ONLINE_COACHES.md, LOCAL_VERIFICATION.md, ACCEPTANCE_MATRIX.md (generated).

## Verification evidence (stand-in provider only — NO real provider call was made)
| Check | Result |
|---|---|
| Full unit suite on the frozen source (hash f610ced7…760, in MANIFEST.json) | **665/665 pass**, 21.7 min, single instance |
| online component tests | 51/51 |
| bridge lifecycle with real child processes | 6/6 |
| Lab smoke (lab-smoke-v6, rebuilt Lab) | 24/24 |
| Lab online smoke (mock provider legs ok / null-first / outage) | 23/23 |
| UI: online panel / online play / app-launched bridge | 18/18 · 9/9 · 10/10 |
| tsc | clean |

**What this does not show:** real DeepSeek or Luna inference, native Mac behaviour, playing strength. The mock/outage tests and the live procedures are separate (`docs/LOCAL_VERIFICATION.md`; `online/verify-live.mjs` writes `live:true` reports only against a real provider).

## Install
See INSTALL.md in the package root. Generated sample coaches in `coaches-sample/` are UNPAIRED placeholders; real coaches are generated on your machine (they embed your local pairing capability and must not be shared).

## Known limitations / blockers
Live DeepSeek, Luna sign-in/inference, Mac build and launch, Lab-side install button, package manifest + drag-drop import (V7-01/07), High Elf source conflict (needs your choice), spatial originals (compatibility UNVERIFIED), league hiring/Apothecary/Captain-replacement workflows (not present in the app), COACH-08 installs (the AI folders are on your Mac). Later stages not started in this package: see ROADMAP.md and the matrix.

## Full-suite record
- Run 3 (this release): `node scripts/run-tests.mjs` on the frozen tree (pid 4682, log /tmp/full-tests3.log in the build session) → 665 tests, 665 pass, 0 fail. The source hash was recomputed after the run and is unchanged.
- Earlier runs on earlier bytes (not this release): run 1 stopped partway when the session's tool link reconnected; run 2 (664/665) had one failure, `pool.test` "pooled candidates / threats equal the inline results", which uses 15 s exact-analysis budgets and failed only while other CPU-heavy jobs shared the 2-core machine; it passed alone three times and inside run 3. Treat that test as load-sensitive.
- One test (`identity-v6`) was changed in this release to accept a 7.x version string; the product name and data folders stay "V6".
