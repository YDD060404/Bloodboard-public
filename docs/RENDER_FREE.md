# Free online play: Bloodboard match server on Render Free

Goal: a few friends play Bloodboard matches over the internet at no cost, using the HTTPS address Render gives you (no purchased domain, no paid server, no WebRTC). The rules and the dice stay on the server; each coach's AI runs on that coach's own computer.

## 1. Assessment

The existing Node match server (`lan/server.mjs`) runs on Render Free unchanged in shape: plain Node, no dependencies, HTTP plus server-sent events, one room per process, `PORT` honoured, HTTPS and the public hostname supplied by Render. Three facts about the free tier decided the design:

| Free-tier fact | Consequence | What was done |
|---|---|---|
| The service sleeps after about 15 minutes without incoming traffic and takes roughly a minute to wake. | The first request after a pause is slow or fails with 502/503; open event streams are cut. | The game client waits for the host with a visible "waking up" note, reconnects by itself with back-off, and sends a small keep-alive ping every 4 minutes while a match is open in a visible tab. |
| The disk is ephemeral: it is wiped on every sleep, restart and deploy. | The old journal file would be lost, and with it any active match. | The match journal is kept in a free **Upstash Redis** database (no card needed). Every change is written there **before** it is acknowledged or shown to the opponent. On wake the server replays the journal and the match continues. |
| Free Render Postgres expires after 30 days; free Render Key Value is memory-only. | Neither is a safe place for a match. | Not used. Nothing in this setup enables a paid or expiring Render add-on. |

Result: **feasible, free, and safe against sleep and restart.** It is built for a handful of friends, not a public matchmaking platform: one room, one fixed room code, two players plus spectators.

### What "never silently lose an active game" means here

- A move is acknowledged only after Upstash has stored it. If Upstash cannot be reached, the move is refused with a retryable error (HTTP 503), nothing changes on the server, nobody is told it happened, and the client retries with the same command id; the retry applies **once**.
- If the server cannot read the store at start-up it **exits** instead of opening an empty room, so Render shows a failed start rather than a silently blank match.
- Hosted mode refuses to start without a durable store and a room code.
- Starting a new match archives the old one in Upstash (kept 30 days); it never deletes it.
- If Upstash itself is lost (for example the database is deleted, or the account is archived after 30+ days of no use), the match is lost. That is the limit of this design; see section 6.

### Privacy of what is stored

Every journal record is encrypted (AES-256-GCM) before it leaves the server. The key is derived from your room code (and an optional extra secret), and the code itself is never stored. Upstash therefore holds only opaque text: no teams, dice seed, names or tokens.

## 2. What you need

- A GitHub account and a **private** repository for the deployment bundle (Render connects to it; no source code is needed in it).
- A free Render account (https://render.com).
- A free Upstash account (https://upstash.com), no credit card.
- The bundle `Bloodboard-<version>-render.zip` from the release.

## 3. Exact setup steps (about 15 minutes, once)

Screen labels at Render, Upstash and GitHub can change a little; the intent of each step stays the same.

**Step 1: Upstash (the recovery store).**

1. Sign up at Upstash and open the Redis section. Create a database. Name it `bloodboard`. Choose type **Regional** and a region close to the Render region (default Render region in `render.yaml` is Oregon, `us-west`). Select the **Free** plan. Leave eviction off if the option is shown.
2. Open the database and find the **REST API** section. Copy two values: `UPSTASH_REDIS_REST_URL` (starts with `https://`) and `UPSTASH_REDIS_REST_TOKEN`. Treat the token like a password.

**Step 2: GitHub (holds the bundle).**

1. Create a new **private** repository, for example `bloodboard-match`.
2. Unzip `Bloodboard-<version>-render.zip`. Upload the **contents** of the unzipped folder (the folder that holds `render.yaml`, `package.json`, `lan/`, `web/`) to the repository root, so `render.yaml` is at the top level. The web upload page works; or use Git on your computer: `git init`, `git add .`, `git commit`, add the remote, `git push`.

**Step 3: Render (the server).**

1. In Render choose **New**, then **Blueprint**, connect your GitHub account, and pick the repository. Render reads `render.yaml`.
2. Render asks for three secret values:
   - `BLOODBOARD_ROOM_CODE`: invent 8 to 24 letters and digits (for example `RIVERBANK42X`). Only you and your friends should know it. It is also the encryption secret for the stored journal; **if you change it, the stored match can no longer be opened**.
   - `UPSTASH_REDIS_REST_URL`: from Step 1.
   - `UPSTASH_REDIS_REST_TOKEN`: from Step 1.
3. Check that the plan shown is **Free** and press **Deploy Blueprint**. If Render ever asks you to add a payment method for this service, stop and read section 7.
4. Wait for the first deploy to finish (a few minutes). Open the service page and copy its address, which looks like `https://bloodboard-match.onrender.com` (the name may carry a suffix if it was taken).
5. Open that address in a browser. In the service **Logs** you should see "Bloodboard hosted match server ... Recovery store: Upstash Redis ... (sealed)".

**Step 4: Play.**

1. Give your friends only the address and (over a private channel) the room code.
2. Player 1 (host) opens the address, presses **Network**, leaves "Server" blank, enters the room code and a name, picks **Player 1 (host)** and presses **Connect**. Player 2 does the same with **Player 2**. Others can pick **Spectator**.
3. The host presses **Set up the match...**, chooses teams as usual (both coaches Human) and presses **Start match**.
4. After the match, the host can press **Start a new match in this room**; the old match is archived, and the other players are seated again automatically.

Everyone must open the page from the same address, so every device runs the identical release.

## 4. What players will notice

- **First connection after a quiet period:** the join form says the server is waking up and keeps trying for up to two minutes. It then continues by itself.
- **Connection lost during a match:** the Network window shows "reconnecting" and a note; the client retries by itself (1, 2, 4... up to 30 seconds apart) and the match resumes exactly where it was, without re-rolled dice. A move sent during the gap is retried and applied once.
- **While a match is open in a visible tab:** the client pings every 4 minutes, which keeps the free service awake. If every tab is closed or hidden, the service sleeps after about 15 minutes; the match is safe in the store and is restored on the next visit.

## 5. Free-tier limits to know

- Render Free has about 750 instance hours per month per workspace: enough for one always-warm service, and far more than a few evenings of play. If the monthly hours run out the service is suspended until the next month, with the match still stored.
- Upstash Free allows about 500,000 commands and 256 MB per month. A full Sevens match uses a few hundred commands and a few hundred kilobytes, so many hundreds of matches fit.
- Upstash may archive a database after at least 30 days with no activity; it can be restored from the console. Play at least once a month, or note the restore option.
- One match room per server. A second group needs a second deployment (a second Blueprint with a different room code).
- Render's shared outbound addresses and bandwidth limits are irrelevant for a few friends; match traffic is small.

## 6. Operations

- **See the state:** open `https://<your-address>/api/ping`. It shows whether a match is in progress, the revision, and that the store is `upstash` and durable. It never shows the code or any token.
- **Restart safely:** Render dashboard, **Manual Deploy / Restart**. Active matches resume. Players see "reconnecting" for under a minute.
- **Update the game:** replace the files in the repository with a newer bundle and press **Deploy** in Render (automatic deploys are off on purpose, so a push cannot restart a match in progress). Use the same release on every device; a client with a different rules version is refused with a plain message.
- **Rotate the room code:** change `BLOODBOARD_ROOM_CODE` in Render. The previous stored match cannot be opened afterwards; the server refuses to start with a clear error if the code does not match the stored match. Reset the store first (Upstash console: delete the key `bloodboard:room:current`) only if you intend to abandon that match.
- **Back up a finished match:** the host downloads the verified history from the Network window at full time.

## 7. Cost safety

- `render.yaml` selects `plan: free` and defines no disk, database or other add-on. Nothing in the bundle changes a plan.
- The server never enables anything paid by itself. Render and Upstash only charge if **you** upgrade a plan or add a payment method and choose a paid tier.
- To be certain: leave the Render workspace without a payment method, and do not add Upstash billing.

## 8. Security notes

- Anyone with the address and the room code can sit in an open seat, so share the code privately and only with friends. After 20 wrong codes the room locks join attempts for 15 minutes.
- The server serves the game and the match only. It holds no AI credentials, files or shell. AI coaches run on each player's computer and talk to the match only through that player's browser.
- Treat the Upstash REST token like a password: it is only ever stored in Render's environment settings.
- Traffic is HTTPS from Render. Requests are rate-limited per client address.

## 9. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Deploy fails and logs say "Hosted mode needs BLOODBOARD_ROOM_CODE" | The code is missing or not 8 to 24 letters or digits. Fix it in Environment. |
| Logs say "durable recovery store" | The two Upstash values are missing. Add them. |
| Logs say "recovery store unavailable" at start | The URL or token is wrong, or Upstash is down. The server stops on purpose; fix the values and redeploy. |
| Logs say "room code does not match this journal" | The code was changed after a match was stored. Restore the old code, or delete the Upstash key to abandon that match. |
| A move shows "could not save your move yet" | Upstash was unreachable for several seconds. Nothing changed; press the move again. |
| First join takes a minute | Normal cold start on the free plan. |
| "Seat is already taken" after a reload | Normal if browser storage was cleared: ask the host to start a new match in the room, or use the browser that holds the saved seat. |

## 10. What was and was not verified

Verified in this project's test environment: the sealed store and cold-start replay; write-ahead commits with rollback on a store outage; the real server process hard-killed four times in a full match and restarted with an empty disk (identical public state, same tokens, duplicate command not applied twice, refusal to start when the store is down); the browser client against a gateway that plays a sleeping host (waking note, back-off reconnect, retried move applied once). All of that used a **fake Upstash server on the loopback interface**.

Not verified here, because no Render or Upstash account is available to this project: a real deployment on Render, the real Upstash REST service, Render's real sleep and wake timing, and play between two devices on different networks. The first real run is yours: follow section 3, then do the two-device check in section 11.

## 11. Acceptance checklist for your first real run

1. Open `https://<address>/api/ping` in a browser: `store` shows `upstash`, `durable: true`.
2. On two devices (different networks if possible) connect as Player 1 and Player 2 and play several moves.
3. In Render press **Manual Deploy / Restart** mid-match. Both devices should show "reconnecting" and recover, with the same board and score.
4. Leave both devices idle for 20 minutes (close the tabs), then reopen: the join waits for the wake-up and the match is restored.
5. In the Upstash console check the database holds one key `bloodboard:room:current` with opaque `e1.` values.
