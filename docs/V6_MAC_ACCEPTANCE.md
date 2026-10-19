# Native Mac acceptance (not run in the cloud build environment)

Nothing below has been executed natively: `native/main.swift`, `native/Info.plist` and `build_mac_app.sh` changes are **uncompiled**.

```
cd ~/Desktop/Bloodboard/V6
npm install
npx tsc --noEmit -p .
node scripts/build.mjs
node scripts/run-tests.mjs apiv2 stepper schemas-v2 acceptance-v2 context-v6 lifecycle-v2 builtin-lifecycle replay-real
./build_mac_app.sh            # compiles native/main.swift with swiftc, assembles the V6 app (separate bundle id from V5.8)
open "dist/Bloodboard V6.app"
PLAYWRIGHT_MODULE=$(npm root)/playwright/index.js node scripts/ui-flow-v6-replay.mjs
PLAYWRIGHT_MODULE=$(npm root)/playwright/index.js node scripts/ui-flow-v6-lifecycle.mjs
PLAYWRIGHT_MODULE=$(npm root)/playwright/index.js node scripts/ui-flow-v58-host.mjs
```

Checklist (tick on the Mac):
- [ ] App builds with swiftc, launches, shows version 6.x, uses its own data folder; V5.8 is untouched.
- [ ] First-run import from V5.8 (teams, game history, AI files) copies and never moves/deletes.
- [ ] Save a match; save another match with the same display name → both files exist (`Name`, `Name (1)`); the first is unchanged (compare bytes).
- [ ] Two quick saves of one name from two windows/processes never overwrite (exclusive create / `link()` path).
- [ ] Open each real file under `~/Desktop/Bloodboard/*/gamehistory` → Replay: step ±, jump, play; grade shown; file byte-identical afterwards.
- [ ] New match: roster first → "AI Build for this match" with the v2 example coach; match starts; legal teams; Notes show roster/build reports.
- [ ] Computer v computer short match with Hopeful 1.5.4, Balanced, Vanguard: no errors; Undo then Save then Load restores coach context (or shows the reset reason).
- [ ] Match Lab (separate app): run `scripts/lab-flow-v58-host.mjs` equivalent smoke after V6 update.
