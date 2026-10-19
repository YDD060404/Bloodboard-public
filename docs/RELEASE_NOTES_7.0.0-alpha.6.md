# Bloodboard 7.0.0-alpha.6 — LAN network matches

Builds on alpha.5 (training), alpha.4 (histories/replay) and alpha.2 (rules edition, online-coach bridge). Luna (alpha.3) remains not live-verified.

## Usable changes
- **Match server** (`node lan/server.mjs`, or `lan/Start LAN Server.command` on the Mac): one authoritative room with a room code; serves the game page and the API. It validates every action, rolls every die and keeps a journal.
- **Network** button (top bar): join as Player 1 (host), Player 2 or Spectator; the host uses the normal Exhibition/Tournament set-up and presses Start match.
- Control ownership: only the coach with the move gets controls; decisions go to the addressed coach; the other side shows "Waiting for the other coach…". No Undo in network matches.
- Duplicate commands idempotent, stale revisions refused and resynchronised, reconnect restores the board (including a pending decision) without re-rolling, host restart resumes from the journal.
- Clients never receive the dice seed. At full time both coaches download a byte-identical verified history (source `multiplayer`).
- See docs/LAN.md.

## Verification (loopback only)
tsc clean; lan unit/HTTP tests 13/13; scripts/lan-acceptance.mjs 18/18 (a full 231-command Sevens match over HTTP/SSE with duplicate, stale, wrong-seat, dropped-connection and two host-restart faults; histories identical and re-verified); scripts/ui-flow-v7-lan.mjs 17/17 (two Chromium game pages). Full suite: 699/699 on the frozen source (release/full-suite-alpha6.log); the lan tests and flows above run outside that suite.

## Not verified / known limitations
Real two-device LAN (needs your devices; procedure in docs/LAN.md); internet play (alpha.7); native Mac app joining/hosting (never built); no computer coaches or adviser takeover over the network; league matches not offered; plain HTTP (trusted networks only). Also unchanged: real DeepSeek/Luna calls, UI training coach attempts, scouting/avatars/interaction fixes, High Elf conflict, spatial originals.

## Next task
alpha.7 internet play (V7-12): TLS/tunnel/NAT guidance and hardening on the same authority server, then alpha.8 scouting/avatars/interaction fixes, rc.1.
