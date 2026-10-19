# Network matches — LAN (V7-05); internet play uses the same server (V7-12, see docs/INTERNET.md)

Two coaches on two devices play one match. One computer runs the **match server**; the other device only needs a browser (or the app's *Network* window) pointed at it. The server is the single authority: it validates every action, rolls every die, settles the result and keeps the journal. Clients send intents and show what the server returns.

## What runs where

| Piece | Where | Role |
| --- | --- | --- |
| `lan/server.mjs` + `lan/room.mjs` + `lan/engine.mjs` | host computer (Node ≥ 22; the same Node the online-coach bridge needs) | serves the game, runs the rules engine, owns the dice seed, journals every command |
| Game page / app | each device | draws the public state, sends the coach's intents |
| Online-coach bridge (`online/`) | stays on its own device, loopback only | **unrelated**: network play never exposes inference credentials, local files or a shell |

## Start a LAN match

1. On the host computer: `node lan/server.mjs` (or double-click `lan/Start LAN Server.command` on the Mac). It prints the **room code** and one URL per network interface, e.g. `http://192.168.1.20:8787/`.
2. On both devices open that URL in a browser (the host can use the same URL on the host computer). Click **Network** in the top bar.
3. Player 1 enters the room code and picks *Player 1 (host)*; Player 2 enters the code and picks *Player 2* (a third person may pick *Spectator*). The window shows who is connected.
4. Player 1 presses **Set up the match…** and uses the normal Exhibition/Tournament set-up (both players Human; rosters, skills, inducements and house rules are whatever Player 1 chooses and are what both coaches get), then **Start match**. The server replaces the dice seed with its own and sends both coaches the public state.
5. Play. The coach whose move it is gets the controls; the other sees *Waiting for the other coach…*. A decision addressed to the defender during the opponent's Turn goes to the defender's device. At full time either player can **Download verified history** (a canonical `bloodboard-history` file: it replays and verifies like any match; see `docs/HISTORY_FORMAT.md`).

## Rules of the protocol (all implemented and tested)

- **Authority and ownership.** Actions are accepted only from the seat whose move it is (`waitingFor`), decisions only from the seat they are addressed to; pre-game/next-Drive steps from either player; spectators never. Coach changes are refused (a coach/adviser taking over needs the owner's permission and is not part of this release).
- **Idempotent commands.** Every command carries a `commandId`; a repeat returns the stored acknowledgement and changes nothing (a client retries safely after a lost answer).
- **Stale revisions.** Every command carries the revision the sender saw; an older one is refused (`409 stale`) with the current revision and the client re-synchronises, then the player decides again.
- **No future information.** Clients receive the public state with the RNG seed replaced by 0 and without the in-flight action's pre-roll snapshot. The canonical history (which contains the seed) is released only at full time.
- **Reconnect.** A dropped client reconnects (the browser retries by itself, or reload the page: the saved token restores the seat) and receives the authoritative snapshot, including a pending decision; no die is re-rolled.
- **Save / resume.** The host's journal (`lan/rooms/room-*.jsonl`, private; it holds the seed) is replayed on restart: `node lan/server.mjs --resume lan/rooms/room-….jsonl --code <the room code>`. Replay reproduces the state, the dice and any pending decision exactly. Seat tokens survive, so players just reconnect.
- **Compatibility.** A client must declare the same protocol and rules code as the server (and a supported rules edition) to take a seat; otherwise it is refused with a plain reason ("use the same Bloodboard release on every device").
- **Security.** Seat tokens are 192-bit random values (only hashes are journalled); the room code locks the room after 20 wrong guesses; requests from another web origin are refused; bodies are size-limited; static files cannot escape the web folder. Traffic is plain HTTP: use it on a network you trust. **Do not expose a LAN-mode server to the internet.** For play across networks use `--mode internet` and follow docs/INTERNET.md (TLS/tunnel/NAT guidance, rate limits, expiry).

## Verification status

| Check | Result |
| --- | --- |
| Room logic with the real engine (join, compatibility, ownership, idempotency, stale, redaction, reconnect incl. pending decision, journal replay, history) | `lan/test/room.test.mjs` |
| HTTP + SSE server (limits, origin, static, two SSE clients, mirror fidelity) | `lan/test/server.test.mjs` |
| A complete Sevens match between two network clients over real HTTP/SSE with injected duplicate, stale, wrong-seat, dropped-connection and host-restart faults, then identical verified histories | `scripts/lan-acceptance.mjs` (loopback) |
| Two real game pages through the UI (join, host set-up and start, gating, reload/reconnect, spectator) | `scripts/ui-flow-v7-lan.mjs` (loopback) |
| **Two real devices on a LAN** | **NOT run** — needs two devices; procedure below |
| **Internet match across distinct networks** | **NOT run** — transport profile built in alpha.7 (docs/INTERNET.md); needs two networks |
| Native Mac app joining a match / hosting from the app | **NOT built** (the app has no embedded server; the Mac app can *join* by typing the host's address, but this path has never been run in the native shell) |

Loopback tests are component tests: they are not proof of real network behaviour (firewalls, Wi-Fi sleep, address changes).

## Your two-device acceptance run (what to do and report)

1. Both devices on the same Wi-Fi/LAN. On device 1: start the server, note the URL and code. If macOS asks to allow incoming connections for Node, allow it.
2. Device 2 opens the URL; both join; play a **complete** Sevens match including at least one Touchdown, the half change and a Re-roll/decision for the defender.
3. During play: switch Wi-Fi off on device 2 for ~20 s and on again (expect *reconnecting*, then the same board); reload device 2's page once; briefly stop and restart the server with `--resume`.
4. At full time download the history on both devices and open it in Replay (it should verify).
5. Report: device models/OS/browser, network type, any step that failed or looked different from this description.

## Known limits (alpha.6)

- One room per server process; two players + spectators. Player 1 must be the host seat.
- Keep-block-die and similar two-step shortcuts take one extra click over the network. No take-backs (Undo) in network matches. No computer coach seats and no adviser takeover over the network.
- The game's local match clock is display-only and not synchronised.
- League matches (pre-match purchases, treasury) are not offered over the network; Exhibition and Tournament are.
- Saving a network match from a client is disabled (the host's journal is the save); resuming is a host action.

## Free hosting option (V7-14)

If nobody wants to keep a computer running, the same server can run on Render Free with a free Upstash Redis store that keeps the match across sleeps and restarts. See docs/RENDER_FREE.md.
