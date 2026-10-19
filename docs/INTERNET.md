# Internet matches (V7-12)

Internet play uses the **same authoritative match server as the LAN stage** (`lan/server.mjs`, see docs/LAN.md) — one engine, one dice source, one journal — with a transport profile for networks you do not control. What alpha.7 adds: `--mode internet`, native HTTPS, a refusal to serve plain HTTP on a public address, per-address rate limits, an open-stream cap, an idle-room expiry, request timeouts, security headers, and a connection-mode/encryption line in the Network window.

**Status: component-verified on loopback only.** No match has been played across two distinct real networks. That acceptance run is yours to do (procedure at the end); until you report it, V7-12 stays "partial".

## Choose how Player 2 reaches the host

The host's computer must be reachable from Player 2's. Pick one:

1. **A TLS tunnel (simplest; no router changes).** Keep the server on loopback and let a tunnel give you a public `https://` address:
   ```
   node lan/server.mjs --mode internet --port 8787 --trust-proxy --public-url https://<your-tunnel-host>/
   cloudflared tunnel --url http://127.0.0.1:8787        # one example of a tunnel program (a free "quick tunnel" needs no account at the time of writing; check the provider's current terms)
   ```
   Give Player 2 the printed `https://…` address and the room code (over a private channel, e.g. a direct message — not a public post). Use `--trust-proxy` **only** when a proxy/tunnel you run sits in front of the server: it makes the server believe the proxy's `X-Forwarded-For/-Proto` headers (used for rate limits and the "encrypted" indicator). Never use it when the server is directly reachable.
2. **A private overlay network** (for example a mesh VPN both players join). Both devices then behave as if on one LAN: run `--mode lan` and give Player 2 the overlay address. The overlay provides the encryption; the Network window will say "Local network match" because the server cannot know.
3. **Port forwarding + your own certificate.** Forward a TCP port on the router to the host, obtain a certificate for a hostname that points at your public address, and run `node lan/server.mjs --mode internet --host 0.0.0.0 --tls-cert fullchain.pem --tls-key privkey.pem`. Many home connections are behind carrier-grade NAT, where this cannot work — use option 1 or 2.

Plain HTTP on a public address is refused (exit 2). `--allow-plain-http` overrides it for a throw-away test; anyone on the path can then read and alter the match.

## What the server does for the internet profile

| Concern | Behaviour |
| --- | --- |
| Authority | unchanged: the server validates, rolls every die, settles, journals. Clients get public state only (no seed, no future dice). |
| Transport | HTTPS here (`--tls-*`) or at your tunnel. The ping reports `mode` and `secure`; the Network window shows "Internet match — encrypted (HTTPS)" or a "NOT encrypted" warning. |
| Abuse | per-address limits (default 240 requests/min, 20 join attempts/min; 8 open event streams); 429 with `Retry-After`. Wrong-room-code lockout (20) as in LAN. Header/request timeouts. Body size limits. |
| Idle rooms | after 6 hours without any API activity (`--idle-minutes N`) the room answers `410 expired`; the host resumes from the journal (`--resume`). |
| Same-origin | the game page is served by the same host, so browsers' origin checks apply; other websites cannot drive the server through a visitor's browser. |
| Latency / drops | commands are idempotent, stale revisions are resynchronised, event streams reconnect and receive a fresh snapshot; no die is re-rolled. Tested with injected 80–160 ms request delay (see below). |
| Separation | the server never exposes the online-coach bridge, AI credentials, local files or a shell. |

## Verification status

| Check | Result |
| --- | --- |
| HTTPS serving, HSTS, mode/secure flags, plain-HTTP refusal on the TLS port, rate/stream limits, trusted-proxy handling, idle expiry, CLI refusal | `lan/test/internet.test.mjs` |
| Full Sevens match over HTTPS (throw-away self-signed certificate) with ~80–160 ms added delay and the same injected faults as the LAN run | `node scripts/lan-acceptance.mjs --tls --latency 80 --mode internet` (loopback) |
| Two game pages through the UI in internet mode (mode line, join, play, reload) | `scripts/ui-flow-v7-lan.mjs` with `BB_MODE=internet` (loopback) |
| **A real match across two distinct networks** | **NOT run** — needs two networks |
| Native Mac app joining by typing an `https://` address | **NOT built** |

Loopback is not a network: NAT, mobile data, Wi-Fi sleep and real latency are untested.

## Your cross-network acceptance run

1. Host computer: start the server with one of the options above; note the public `https://` address and the room code. Confirm in your own browser that the address loads the game and that the Network window says "encrypted".
2. Player 2 (a different network — e.g. mobile data or another home): open the address, join with the code. Play a **complete** Sevens match including a Touchdown, the half change and a decision for the defender.
3. During play: switch Player 2's connection off for ~20 s and on again; reload Player 2's page once; stop and restart the host server with `--resume` (and restart the tunnel if the address changed).
4. At full time both download the history; open it in Replay (it must verify and be identical on both sides).
5. Report: both networks' type, tunnel/proxy used, devices/browsers, noticeable lag, anything that failed or looked different from this page.

## Known limits (alpha.7)

One room per server process (two players + spectators); the room code and the https address are the only secrets — share them privately. No accounts, no matchmaking, no relay hosted by us (no new paid services). Plain browsers only; the Mac app has no embedded server. Coach seats, adviser takeover and League matches are not offered over the network.

## Free hosting option (V7-14)

If nobody wants to keep a computer running, the same server can run on Render Free with a free Upstash Redis store that keeps the match across sleeps and restarts. See docs/RENDER_FREE.md.
