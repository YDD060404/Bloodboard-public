# Bloodboard 7.0.2: free online play on Render Free

7.0.2 follows the delivered 7.0.1 (kept as the rollback). Rules, engine, API and save formats are unchanged (the engine, rules and API fingerprints are identical to 7.0.1). It is not a statement that every V7 requirement is complete.

## What changed
1. **Hosted mode for the existing match server** (`node lan/server.mjs --hosted`). It uses Render's HTTPS address and `PORT`, one fixed room code from an environment variable, and refuses to run without a durable recovery store and a room code.
2. **Free recovery store**: the match journal is kept in a free Upstash Redis database over its REST API (plain `fetch`, no new dependency). Every record is encrypted (AES-256-GCM) before it leaves the server; the key comes from the room code.
3. **Write-ahead commits**: a join, start or move is acknowledged and shown to the opponent only after the store has saved it. If the store fails, the change is rolled back and the client gets a retryable 503; the retry with the same command id applies once.
4. **Cold-start recovery**: a restarted or woken server replays the store to the identical state, tokens included. If the store cannot be read at start-up, the process exits instead of opening an empty room.
5. **New match in the same room** (`POST /api/reset`, host only): the old match is archived in the store (30 days), never deleted; the other players are seated again automatically.
6. **Client**: a visible "server is waking up" note, a back-off reconnect loop (EventSource gives up after a 502), a 4-minute keep-alive while a match is open in a visible tab, safe retry of moves on 502/503, and a "Start a new match in this room" button for the host.
7. **Deployment bundle** (`Bloodboard-7.0.2-render.zip`): only the match server files and the web app, a `render.yaml` Blueprint (free plan, no paid add-ons, automatic deploys off) and `RENDER_SETUP.md` with exact steps. Nothing else is in it.

## Verification (frozen source)
- Tested-source sha256 `505b0831012ccb16725063d307c110960901565b26a3edfa6c9d55952948a1d4`.
- `scripts/run-tests.mjs`: 718/718. Online tests 56/56. LAN tests 25/25 (17 existing, 8 new hosted tests).
- `scripts/hosted-restart-acceptance.mjs` 10/10: a complete Sevens match on the real server process, hard-killed four times and restarted with an empty disk; identical public state and tokens each time, the last command re-sent is a duplicate, a restart with the store down exits, nothing readable in the store, verified history at the end.
- `scripts/ui-flow-v7-hosted.mjs` 12/12: Chromium against a gateway that plays a sleeping host (502s, dropped streams, process replaced).
- `scripts/lan-acceptance.mjs` 18/18 (plain, and internet mode with latency); `scripts/ui-flow-v7-lan.mjs` 18/18.
- Evidence class: **fake Upstash on loopback**. No real Render or Upstash account was available.

## Not verified (yours to do; never claimed)
A real deployment on Render, the real Upstash service, Render's real sleep and wake timing, and play between two devices on different networks. Follow `docs/RENDER_FREE.md` section 3 and the acceptance checklist in section 11. Also unchanged from 7.0.1: the compiled native Mac app and live AI providers.

## Known limits
One room per server; a few friends, not matchmaking. If the Upstash database is deleted or lost, the match is lost. Changing the room code makes the stored match unreadable. Free-tier terms can change; check the current Render and Upstash pages.
