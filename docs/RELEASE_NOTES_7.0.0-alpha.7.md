# Bloodboard 7.0.0-alpha.7 — internet transport profile

Builds on alpha.6 (LAN matches on one authoritative server). Luna (alpha.3) remains not live-verified.

## Usable changes
- `node lan/server.mjs --mode internet`: same authority server (it alone validates, rolls dice, settles, journals; clients get public state only) with an internet profile — listens on loopback by default for use behind a TLS tunnel/reverse proxy; native HTTPS with `--tls-cert/--tls-key`; **refuses plain HTTP on a public address** (override `--allow-plain-http`); `--trust-proxy` and `--public-url` for tunnels; per-address rate limits (429 + Retry-After), open-stream cap, request timeouts, HSTS/frame/referrer headers; idle rooms expire after 6 h (`--idle-minutes`) and are resumed from the journal.
- The Network window shows the connection mode: "Local network match", "Internet match — encrypted (HTTPS)" or an explicit "NOT encrypted" warning. Connection errors now mention the https address for internet matches.
- docs/INTERNET.md: the three ways to reach the host (TLS tunnel, private overlay network, port-forward with a certificate), what the server does, limits, and your cross-network acceptance procedure.
- Acceptance script options `--tls --latency N --mode internet`; UI flow runs in either mode (`BB_MODE=internet`).

## Verification (loopback only)
tsc clean; lan tests 17/17 (4 new internet tests: HTTPS+HSTS, rate limits and trusted-proxy handling, stream cap and expiry, CLI refusal); a complete 200+-command Sevens match over HTTPS with 80–160 ms added delay and injected duplicate/stale/wrong-seat/drop/host-restart faults 18/18; UI flow in internet and LAN mode 18/18 each. Full suite: 699/699 on the frozen source (release/full-suite-alpha7.log); the lan tests and flows run outside that suite.

## Not verified / known limitations
A real match across two distinct networks; any real tunnel provider (none was run); NAT/CGNAT behaviour; mobile data; the native Mac app (never built; has no embedded server); real DeepSeek/Luna calls. No hosted relay or matchmaking (no new paid services). Single room per server; no coach seats/adviser takeover/League matches over the network.

## Next task
alpha.8: scouting, avatars and interaction fixes (V7-02/03/04), then V7-10 remainder, training remainder, rc.1.
