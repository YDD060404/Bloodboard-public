# Local verification procedures (what only YOU can run)

The cloud tests use a **stand-in provider**. They prove bridge security, protocol handling, the Lab/web wiring, cancellation and honest fallback. They prove **nothing** about real DeepSeek or Luna inference. These procedures produce that evidence on your machines. Each ends with an artifact you can send back.

Prerequisite (Mac): Node 22.12+ (`node -v`), then `cd online && npm install`.

## A. Real DeepSeek (needs your DeepSeek API key; the key never touches the page, coach files or logs)
1. Terminal 1: `cd online && node bridge.mjs serve` (note the port and the 8-digit pairing code).
2. Put the key in the bridge: open the game or Lab page → **Online coaches** → pair → DeepSeek → paste key → *Save*. (Or start the bridge with `BLOODBOARD_DEEPSEEK_API_KEY=… node bridge.mjs serve`.)
3. Terminal 2: `node verify-live.mjs --provider deepseek --code <code>` (add `--model <id>` to pick one). It checks pairing, health, model discovery, a real decision validated by the protocol, duplicate rejection and cancellation reaching the provider.
4. Evidence: `online/verification-reports/deepseek-*.json` with `"live": true`. A report with `"live": false` was a mock and does not count.
5. Small complete match: Online coaches → **Install** (writes the coach into both AI folders), start a match with the DeepSeek coach on one side, play to the end, export the history. Check the decision log: `via` is not `builtin` for answered turns, fallbacks (if any) name the provider reason.

## B. Real Luna (needs your ChatGPT account; official sign-in only)
1. Build the supplied runtime once: see docs/ONLINE_COACHES.md (esbuild with `--packages=external` → `online/vendor/siwc-local/runtime.mjs`).
2. `node bridge.mjs serve`, pair in the panel, Luna → **Sign in** (the official authorization page opens), then pick a model **from the list your account returns**.
3. `node verify-live.mjs --provider luna --model <listed id> --code <code>`; evidence in `verification-reports/luna-*.json`. Report account limits (model not offered, rate limits) as findings, not failures of the bridge.
4. Same small-match check as A.

## C. Native Mac app (the cloud cannot compile Swift — nothing below has been run)
Standard build: `bash build_mac_app.sh` (unchanged by this release). Bridge-integrated build (implemented, UNVERIFIED): `BLOODBOARD_NATIVE_BRIDGE=1 bash build_mac_app.sh`.
Check, and note pass/fail for each:
1. The app launches; **Online coaches** shows the bridge starting and pairs without typing a code.
2. Activity Monitor shows one `node … bridge.mjs` child; quit the app → it disappears within ~2 s (also after Force Quit).
3. Start a second copy of the app → it reports "already running" instead of a second bridge.
4. Run A and B again with the native app as the page host (WKWebView), not Chrome.
5. Without Node installed the panel shows the Node-not-found message.
Send back: the build log, a screenshot of the panel, and the verification reports.

## D. Install into the shared AI folder (COACH-08)
The folder is on your Mac and is not connected to the cloud session. Use the panel **Install** button, or `node bridge.mjs install-coach --provider deepseek --model <id>` (no `--to`: it writes into the shared folder `~/Library/Application Support/Bloodboard/AI`; run `node online/aidir.mjs where` to see it). It prints filename, path and SHA-256; verify with `shasum -a 256`. The game and the Match Lab read that same file, so there is nothing to copy into the Lab.
