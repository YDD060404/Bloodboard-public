# Online coaches (DeepSeek, ChatGPT Luna) — 7.0.0-rc.1

An online coach is an ordinary generated AI file (`Online-<Provider>-<model>-<version>.js`, apiVersion 2) that talks to a **local bridge on 127.0.0.1**. The bridge, not the coach, holds every provider credential. The coach file carries only a local pairing capability (loopback only) — treat it like a private file; regenerate it to rotate.

## What is and is not verified in this release
- Verified in the cloud with a **stand-in provider** (no network, no credentials): bridge security, protocol, generated coach, the real Lab worker path, the web game path, cancellation, outage fallback, `candidateId: null` rejection, panel flow, byte-identical install into two folders.
- **Not verified**: real DeepSeek calls (no key was supplied), real Luna sign-in/inference (needs your ChatGPT account on your Mac), the native Mac app (cloud cannot compile Swift), LAN/internet play. No strength claim is made for any provider.

## Run it on your Mac
```
cd online
npm install                      # jose + proper-lockfile (needed by the Luna route only)
# Luna only: build the supplied siwc-local runtime once
../node_modules/.bin/esbuild vendor/siwc-local/src/index.ts --bundle --platform=node --format=esm --packages=external --outfile=vendor/siwc-local/runtime.mjs   # adjust entry to the vendored main file
node bridge.mjs serve            # prints a one-time 8-digit pairing code; default port 60557
```
Open the game or Lab, **Online coaches** (AI-file row), enter the code, then:
- **DeepSeek**: paste your API key (sent once to the bridge, stored in the Keychain via the native helper when available, otherwise held in bridge memory only; never in the page, coach files, logs or exports). `BLOODBOARD_DEEPSEEK_API_KEY` also works. Models come from the provider's model list.
- **Luna**: Sign in opens the official ChatGPT authorization; only models your account lists can be selected. No API key, scraping or cookies.
Press **Install** to write the coach into the ONE shared AI folder, `~/Library/Application Support/Bloodboard/AI/` (the bridge reports filename, path and SHA-256). The game and the Match Lab both read that folder, so the coach is available in both without a second copy. `node bridge.mjs install-coach --provider deepseek --model <id>` does the same from a terminal; credentials are never written into the AI folder (they stay in `Bloodboard Online`). See `docs/AI_FOLDER.md`.

## Behaviour contract
- One total decision budget (default 55 s, configurable up to 115 s when the coach is built; never more than the host limit, now at most 120 s; minus 2.5 s margin), shared by every round, correction and engine query.
- Max 6 model rounds, 4 engine queries, 3 corrections. An invalid or missing `candidateId` is rejected and never becomes End Turn; End Turn needs an explicit `{"kind":"endTurn"}` input.
- Failures (bridge down, timeout, rejection) fall back to the built-in coach **visibly**; the decision log records via/provider/model/latency.
- Switching provider or model discards stored coach context and outstanding responses; providers never substitute for each other.
- Setup, fielding and kick-off stay with the built-in coach (declared, not claimed).
- Bridge security: Host/Origin loopback checks, Bearer capability, 2 MB body cap, 5 wrong pairing codes lock for 60 s, content-free audit log. Multiplayer layers must not expose it.

## Bridge lifecycle (COACH-03)
`node bridge.mjs serve` flags: `--port N` (0 = any free port), `--auto-port` (fall back to a free port if the default is busy — NOTE installed coaches embed the port they were generated for; regenerate them if the port changed), `--json` (one machine-readable ready line `BLOODBOARD_BRIDGE_READY {…}`), `--exit-on-stdin-close` and `--parent-pid N` (stop when the launching app exits or crashes), `--replace` (stop a running bridge and take over). One bridge per state folder (`bridge.json` holds pid and port only — never the pairing code or capability); a second start exits with code 3; a stale record from a dead process is replaced. SIGINT/SIGTERM stop it cleanly. This is tested with real child processes.
Mac app: **implemented but unverified.** `BLOODBOARD_NATIVE_BRIDGE=1 bash build_mac_app.sh` compiles `native/BridgeLauncher.swift` with `-D BRIDGE` and bundles `online/`; the app then starts the bridge, injects `{port, pairingCode}` into the page and the panel pairs by itself. The Swift has never been compiled (the cloud cannot) — procedure in docs/LOCAL_VERIFICATION.md section C. The default build is unchanged and does not need Node.

## Known limitations
Native auto-start is unverified Swift (see above); the Lab has no install button yet (use `install-coach --to <Lab>/coaches`); context reset/undo behaviour against a live provider is untested.
