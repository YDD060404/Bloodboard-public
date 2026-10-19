# Verification

Latest run: **V5.5.1** (28 September 2026) — see *V5.5.1 checks* below; V5.5's checks follow it. Earlier summary (26 September 2026 20:20–20:30, **V4 build 2**): **type check clean; unit tests 263/263** (engine, match, teaching, special actions, fouls and Leader, D6 difficulty, the V4 skills — reactions, Diving Catch, Multiple Block, On the Ball, Punt / Fumblerooski — League advancement and post-game, animations, property/fuzz, Monte Carlo, dice audit, schemas, computer-opponent tests); **interface flows in headless Chromium: `ui-flow1`–`ui-flow5` pass, `ui-flow-v2` 37/37, `ui-flow-placement` 114/114, `ui-flow-v3` 42/42, `ui-flow-v4` 57/57, `ui-flow-league` 21/21, `ui-flow-ai` 26/26 (a complete human-v-computer match to full time)**; no console errors. Self-play (build 1): 4 runs of 12 computer-v-computer matches, 0 illegal inputs. Not run here: Safari/WebKit and the Mac app.

Re-run with `npm test` (engine and computer opponent), `npm run test:ui` (interface, needs Playwright's Chromium) and `npm run calibrate` (computer-vs-computer report, a few minutes).

## V5.5.1 checks (28 September 2026, the delivered build)

V5.5.1 changes `src/ui/strategy.ts` (the look-ahead services) and the version labels; `dist/web/engine.js` and
`dist/cli/bloodboard-cli.mjs` are byte-identical to V5.5, the built-in AI files unchanged. Run in the cloud workspace
(Linux, headless Chromium, 2 CPU cores):

- **Type check** (`tsc --noEmit -p .`): clean. **Build** (`node scripts/build.mjs`): the generated docs and examples
  are identical to V5.5's.
- **Unit tests** (`npm test`): **517/517 passed** (none of them import `strategy.ts`; they show the engine and the
  built-in coach unchanged).
- **`scripts/ui-flow-v551-lookahead.mjs` (new): 19/19** — a test module using every service as a team's coach in the
  real Web Worker (`bloodboard.services`; `evaluate`; `explore` outcome probabilities summing to 1 and values adding
  up; its Turnover chance equal to the candidate's; position keys for `evaluate` / `explore` / `plan` /
  `reachable`; `endTurn` explored into the other team's Turn and one of their moves explored from there; an unknown
  key refused; `maxMs` bounding an enumeration — checked in Node too, where fine enumerations were stopped at 51–52
  ms with `timedOut`; nothing of the dice generator in the observation or the outcomes; the module keeps answering
  with no fallback notice); the same module as the advisory coach leaves the game **and its dice generator** exactly
  as they were; a V5.5 strategy module (no look-ahead) still plays.
- **`scripts/ui-flow-v55-coaches.mjs`** (the V5.5 AI-file flow, which covers strategy modules): **47/47**.
- The coach built on the services (**Genius — Claude 2.0**, an AI file outside the app) was played against the bundled
  *Bloodboard AI — Balanced 5.5.0* in paired, side-swapped computer-v-computer matches through this host code (the
  app's `strategy.ts` in Node with a `node:vm` worker):

  | Format | Matches | W-D-L (Genius) | Touchdowns |
  |---|---|---|---|
  | Sevens: Norse–Lizardmen, Skaven–Dwarf, Wood Elf–Chaos Chosen | 120 | 48-49-23 | 86-55 |
  | Sevens: Human–Orc | 16 | 4-9-3 | 8-6 |
  | 11-a-side: Dwarf–Skaven, Tomb Kings–Bretonnian, Wood Elf–Black Orc | 12 | 5-5-2 | 7-2 |
  | **All** | **148** | **57-63-28** (score rate 59.8%, z ≈ 3.2) | **101-63** |

  The 120- and 12-match sets used seeds not used during development; 80 of the 120 were played just before `maxMs`
  and the coach's 11 s stop were added (they change only positions where an enumeration takes seconds).
  0 illegal actions; no fallback notice in the final version (an earlier run found one time-out in Human–Orc, where
  one enumeration took the engine about 80 s — the reason for `maxMs`; 0 in the 8 Human–Orc matches after it). No
  stalls: at most 10 actions in a Turn in Sevens, 12 in 11-a-side (Balanced 11 and 11); Turns with nothing done 10 v 7
  in 120 Sevens matches. Ball lost 117 v 139, Turnovers 339 v 349, players pushed into the crowd 59 v 89. Its module
  time averaged 0.15–0.2 s per decision (longest 14.5 s in Human–Orc; 20 s is the limit). A stall found on the way (one
  player stepping back and forth inside his activation) was fixed before these runs. In the V5.5.1 web build (headless
  Chromium, with the Mac app's AI-folder messages) the file is listed for Player 1, Player 2 and the advisory coach and
  plays a Sevens match against Expert — Claude to full time with its look-ahead choices recorded (15/15); in the V5.5
  build it plays as its version 1.0 (15/15). The native Mac app was not built or run here.

## V5.5 checks (28 September 2026, the delivered build)

Run on the build delivered to `~/Desktop/Bloodboard/V5/` (`node scripts/build.mjs` with the block-dice audit;
build-info in `dist/web/build-info.json`), in the cloud workspace (Linux, headless Chromium, 2 CPU cores):

- **Type check** (`npx tsc --noEmit -p .`): clean.
- **Unit tests** (`npm test`): **517 tests — 515 passed on the first full run; the 2 that failed were older AI
  behaviour tests re-stated for the V5.5 evaluation** (below), then `tests/ai.test.ts` + `tests/stars-ai.test.ts`
  re-run: 25/25. New or extended in V5.5: `mirror`, `ai-tactics`, `allstar`, `teambuild`, `coaches`,
  `sevens-inducements`, `difficulty`, `traits` (Bloodlust, including the reported match-log case), `ontheball` (GW / NAF),
  `match`, `matched`, `stars`, `inducements`.
- **Re-stated tests** (`tests/ai.test.ts`, reasons written in the tests): (1) *styles in an open field* — until V5
  step 6 it also required Offensive to move the carrier further than Defensive; with the access-based cage model that
  is a 0.3-point call (Offensive x = 11 next to its two team-mates, Defensive x = 12 where a full X cage can be built),
  so it now checks that every style carries first and advances at least two squares (the styles' different choices are
  checked in *styles change preferences*); (2) *crowd exposure* — the Balanced coach now moves the carrier back out of
  both Orcs' reach and uses the sideline player as a front cage corner, so the check is "off the sideline, or next to
  our carrier / marking an opponent". Recorded as a behaviour change in `docs/AI_OPPONENT.md`.
- **Interface flows** (`npm run test:ui`, all 28, one after another, headless Chromium):
  `ui-flow1`–`5` pass, `v2` 37/37, `ai` 23/23 (a complete human-v-computer match to full time), `placement` 188/188,
  `v3` 45/45, `v4` 61/61, `league` 21/21, `sevens` 23/23 (incl. a complete Sevens match v computer), `rosters` 14/14,
  `v5` 15/15, `v5-rosters` 14/14, `v5-inducements` 17/17, `v5-stars` 22/22, `wrestle` 41/41, `v5-wizard` 18/18,
  `v5-modes` 21/21, **`v55-board` 35/35, `v55-coaches` 47/47, `v55-quick` 24/24, `v55-bloodlust` 10/10,
  `v55-mirror-clock` 22/22, `v55-league-prematch` 9/9, `v55-spectator` 17/17** (computer v computer to full time in
  Exhibition Sevens, Tournament 11-a-side, League and All-Star Sevens; the same seed watched with and without pauses
  gives the identical match), **`ui-shot-tray` 36/36**; no page errors. `v55-coaches` failed once in the sequential run
  (waiting for the human side's Turn while a decision addressed to that side, or an activation the computer left open
  when it handed the team over, waited for the human): the flow now plays the human side's part while it waits
  (answers such a decision, ends such an activation) and passed 5 runs in a row. After the last change (the timer text
  kept on one line, CSS only) `ui-shot-tray`, `v55-mirror-clock`, `v55-board`, `v5-wizard` and `v55-coaches` were run
  again on the delivered build: all pass.
- **Visual inspection**: `scripts/ui-shot-tray.mjs` screenshots (the feedback scenario: Sevens set-up after the pre-game
  rolls, and an active Turn) at 1100 × 720, 1280 × 800, 1440 × 900 and 1680 × 1050, looked at (at 1100 × 720 the side
  timers wrapped onto two lines — now kept on one line); and the Sports-Wizard's Fireball (card, aiming,
  review with the marked area, each roll in the tray, the result) at 1440 × 900 — no display fault found; the timer
  counted the wrong side while a coach aimed their Wizard in the other team's Turn — fixed and checked in
  `ui-flow-v5-wizard`.
- **Computer v previous computer** (request item 9): `scripts/ai-compare.ts`, results in `docs/AI_OPPONENT.md`
  (*V5.5: compared with the V5 step 6 coach*): 0 illegal inputs in every game.
- **Not run here:** the Mac app (not built or launched — no Mac or Swift compiler; `native/main.swift` reviewed by
  hand), AI-folder discovery inside the packaged app (steps in `docs/AI_EXTENSIONS.md`), Safari / WebKit.

## V5 checks (development builds; V4 build 3 stays the stable release)

- **V5 step 6 — Star Player previews and computer, Wizard, modes** (27 September 2026 16:53–17:34 Asia/Shanghai, on a separate copy): type check clean; unit tests **469/469** — new: `tests/stars-preview.test.ts` 6 (the exact ball-chain solver = the match code's own catch for Griff, Puggy, Ripper, the Team Mascot, a Sevens Veteran and Guffle's Quick Bite; Barik's Blast It! distribution and the computer's choice; Scrappa's interception), `tests/stars-ai.test.ts` 4 (Thorsson / Zzharg used by the computer when it pays, the resulting state; not used when Thorsson carries the ball), `tests/wizard.test.ts` 7 (buying, timing, Fireball, Zap!, the Frog, previews, the computer), `tests/matched.test.ts` 6 (Skill Points by Tier for 11-a-side and Sevens, limits, budgets, Dedicated Fans from 0, never for League / Exhibition teams, bought skills in a Tournament match only); interface flows `ui-flow1`–`5`, v2 37/37, v3 42/42, v4 67/67, League 21/21, placement 176/176, Sevens 23/23, rosters 14/14, v5 15/15, v5-rosters 14/14, v5-inducements 17/17, v5-stars 22/22, wrestle 41/41, complete match v computer 26/26, **v5-wizard 17/17, v5-modes 23/23** (incl. a Sevens Tournament against the computer to full time); no console errors. Older flows were updated for the new Home screen (drafted-team flows open Exhibition teams; Sevens through the format switch). Star Player self-play re-run on this copy: 12 matches, 0 illegal inputs, the same results as `docs/selfplay/v5-stars.md`. Not run here: Safari/WebKit; the Mac app was not built or launched (the user builds it: `bash build_mac_app.sh` in `V5/`).
- **V5 step 5 — Star Players** (27 September 2026 13:02–13:50 Asia/Shanghai, on a separate copy): type check clean; unit tests **446/446** — new: `tests/stars.test.ts` 27 (the list, hiring rules, match start, the default formation fielding hired Star Players, the block-dice / armour / injury / test rules, a computer-v-computer half), `tests/stars2.test.ts` 21 (the other rules, incl. those used at the start of an activation), `tests/wrestle.test.ts` 5 (the reported Both Down + Wrestle problem: not reproduced); interface flows `ui-flow1`–`5`, v2 37/37, v3 42/42, v4 67/67, League 21/21, placement 176/176, Sevens 23/23, rosters 14/14, v5 15/15, v5-rosters 14/14, v5-inducements 17/17, **v5-stars 22/22** (hiring in the team builder, a hot-seat match using Beer Barrel Bash from the tray, then a whole match against the computer with both hired teams to full time — run twice), **wrestle 41/41**, complete match v computer 26/26; no console errors. Found and fixed during this verification: the default formation (the computer's set-up) left a Star Player hired after 11 roster players in the Reserves Box; a Prayers check in `ui-flow-v5-inducements` depended on the dice (it ran before an Iron Man / Knuckle Dusters choice was made); `ui-flow-v5-stars` read the full-time card before the last events had played back. Star Player self-play: `docs/selfplay/v5-stars.md` (8 matches, 32 Star Players, 0 illegal inputs). Not run here: Safari/WebKit and the Mac app (*Bloodboard V5.app* was not built or launched).
- **V5 step 4** (27 September 2026, on a separate copy): type check clean; unit tests **393** (392 + the Sevens cost test fixed and re-run 29/29) — new: `tests/specialrules.test.ts` 11 (Team Captain, Brawlin' Brutes, Masters of Undeath), `tests/rosters-v5.test.ts` 11 (the 25 new rosters, group limits, Favoured of…, Bribery and Corruption, Swarming, computer-v-computer halves), `tests/inducements.test.ts` 13, `tests/prayers.test.ts` 8; interface flows `ui-flow1`–`5`, v2 37/37, v3 42/42, v4 67/67, League 21/21, placement 176/176, Sevens 23/23, rosters 14/14, **v5 15/15, v5-rosters 14/14, v5-inducements 17/17**, complete match v computer 26/26; no console errors. Roster self-play: `docs/selfplay/v5-rosters.md` (25 matches, 0 illegal inputs). Not run here: Safari/WebKit and the Mac app.

## V4 checks

- **Foul Action and fouling skills** (`tests/foul.test.ts`, 15): availability (needs a Prone/Stunned opponent, once per Turn), move then foul, assists counted like a Block (and Guard not counted, Put the Boot In counted, cancelled by Defensive), armour holds → no Turnover, natural double on the Armour Roll → Sent-off after the Foul is resolved and Turnover, Argue the Call 6 (stays, Turnover stands) and 1 (coach ejected), double on the Injury Roll, Sneaky Git (only an unbroken-armour double forgiven), Dirty Player on the Armour or the Injury Roll, Lone Fouler re-roll only without assists, Quick Foul keeps moving (and without it the activation ends), illegal targets rejected before any dice, the preview's Turnover chance equals the exact Sent-off chance (40/216 at AV 10), a Bribe in a match (2+: stays, no Turnover).
- **Leader Re-roll** (same file, 3): gained at the start of a half only with a Leader on the pitch (not when the Leader is in the Reserves Box), lost when the only Leader becomes a Casualty (a KO only suspends it), offered and spent once, not offered with no Leader on the pitch.
- **D6 difficulty** (`tests/difficulty.test.ts`, 7): levels and weights (every face ≥ 8.3%), 120,000-roll frequencies within 0.6 points of the table and reproducible from the seed, Off rolls exactly like V3 (same faces, same pre-game), player and computer settings independent and ignored in practice and two-coach games, Block dice and D8 unchanged at the strongest settings, previews use the same weights (dodge preview = weighted formula = 4,000 executions within 2.5 points), Armour Rolls are the opposing coach's rolls.
- **Computer opponent — sidelines** (`tests/ai.test.ts`, 19 incl. 3 new): the crowd term follows the engine's push rule; a free sideline player steps one row in when that costs nothing (fails with the term off); a sideline player marking their ball carrier stays. Self-play before/after table in `docs/AI_OPPONENT.md`; reports in `docs/selfplay/`. `node build/ai-selfplay.mjs 12 101 --crowd=0` reproduces the V3 opponent (checked: seed 101 gives the identical match).
- **Interface** (`scripts/ui-flow-v4.mjs`, 23): Quick match defaults Tomb Kings v Bretonnian and editable; the difficulty card is Off and collapsed by default, labelled as a house rule, stays open while choosing, its table equals the engine's weights, the chosen levels are stored in the computer match and shown on the board, Off stores nothing; the New match screen offers the two starter teams on a fresh install, preselects Tomb Kings (home, you) v Bretonnian (away, computer), shows the difficulty control against the computer and not for two coaches; clicking a Prone opponent with a player selected plans a Foul with a route next to them, the preview shows the exact Sent-off (48/216) and armour-break (15/36) chances, nothing changes before Confirm, the Foul executes and uses the Turn's Foul.
- **Tray action bar and animations** (`tests/animate.test.ts` 5; `ui-flow-v4`): see `BLOODBOARD_WORK_STATUS.md` (V4, play-flow and animations).
- **Skills the rosters can learn** (`tests/reactions.test.ts` 11, `tests/divingcatch.test.ts` 6, `tests/multipleblock.test.ts` 5, `tests/ontheball.test.ts` 6, `tests/punt.test.ts` 9): Trickster (squares next to the blocker, assists from the new square, pick-up on the ball, computer choice), Dump-off (Quick Pass first, Quick range only, never a Turnover), Saboteur (4+: blocker down without a Turnover, saboteur KO), Pile Driver (free Foul after a follow-up, Placed Prone, team Foul still free), Diving Catch (pass, failed dive bounces, bounce never dived for, +1 in the target square, opponent dive, kick-off), Multiple Block (ST −2, assists, no Follow-up, both Blocks resolved after a Turnover, legality, exact odds for both targets), On the Ball (pass: Marked afterwards; a fall ends the moves; several players; kick-off; not on a Touchback), Punt (once per Turn, template directions, catches, crowd, move first, Kick re-rolls, exact preview) and Fumblerooski (Move Action only). `ui-flow-v4` +18: Multiple Block by clicks with both odds in the tray, Trickster answered by clicking a highlighted square, Punt from the tray with its facing and odds, Fumblerooski tick box.
- **League post-game and advancement** (`tests/postgame.test.ts` 6, `tests/advancement.test.ts` 7, `scripts/ui-flow-league.mjs` 21): players who played, MVP nomination and D6 (re-roll a number without a nominee), +4 SPP, SPP added to the saved team once (also after Undo), none outside League matches, Touchdown and Violent Innovator SPP; Skill Table (incl. the rulebook's Halfling example), costs, restrictions, random rolls with re-rolls (a re-roll in the second pick — a bug the interface flow found), Elite value, D8 table and limits; in the interface: SPP table, nomination, both MVP rolls, adding the SPP, then Advance: chosen Primary, random Primary (the same roll after closing and reopening), Characteristic D8.
- **Unchanged behaviour** re-checked: every V3 flow above passes without edits except where V4 changed the behaviour on purpose (one unit test: the Foul option is now available when there is something to foul).

## V3 checks

- **Player placement in every mode** (`scripts/ui-flow-placement.mjs`, real mouse input: travel, press, 1-pixel wobble, release): Practice position editor (drag a player, click and drag an off-pitch player back on), Practice match (introductory rules, both set-ups), League (both set-ups, hot-seat), Tournament / Exhibition (both set-ups), against the computer as Home (Quick match) and as Away (Choose teams…). In each set-up: *Clear* puts every player in the Reserves Box; Reserves click + square click places the player **and the board draws him there**; a square in the opponent's half is refused with the p.47 reason; drag from the Reserves Box places (and selects) the player; dropping on an occupied square or in the opponent's half is refused; dragging a pitch player moves him; dragging him onto the Reserves Box takes him off; the set-up stays with the same team; 11 players placed by clicks give a legal set-up; *Confirm set-up* is accepted by the rules engine; the match proceeds through the kick-off to Turn 1 of the receiving team (the computer's set-up and kick-off included). 114/114, and again 114/114 with the page zoomed to 0.8.
  - Root cause of the reported bug: after any dice playback (the pre-game roll, the other team's set-up) the board drew the real game state instead of the set-up draft, so placements were stored but never shown. The earlier checks had tested the draft data only; the new checks test what is drawn.
- **Quick actions, Backspace, End Turn, dice tray, Teaching, AI Focus** (`scripts/ui-flow-v3.mjs`): selected player + adjacent opponent → Block plan (block dice shown), state and dice untouched; square then opponent → Blitz plan keeping the route, target declared in the input, Block included; a distant opponent click only selects him; one Backspace cancels a whole 7-square Blitz plan, also in Review; after a confirmed Block, Backspace offers Undo and a second Backspace restores board, dice generator and log exactly; a second Blitz in the same Turn is not planned (reason shown); End Turn ends at once without a dialog; a failed Dodge shows the inline re-roll control (Team Re-roll with the number left, "No re-roll" as default), Space keeps the roll (no re-roll spent) and the tray button re-rolls (one spent, logged); block dice (2, attacker chooses) are clickable in the tray and the clicked face is the result; Teaching: both courses in one area, collapsed, levels and lessons collapsed until opened, a tutorial opens with only its own card, *Course* returns; AI Focus is one line until asked, recommends a legal action (engine `validateInput`) with estimated chances, what they include and the main downside, and leaves board, Turn, log and dice generator identical. 42/42.
- **Complete match against the computer** (`scripts/ui-flow-ai.mjs`): as in V2.1, plus the human's first set-up placed by hand (10 clicks + 1 drag, drawn on the pitch, accepted by the engine) and *Default formation* drawn on the pitch; the computer's Turns run with real dice through the tray to full time. 26/26.
- **Computer opponent** (`tests/ai.test.ts`, 16): V2.1's 15 tests (legal inputs, urgent scoring / defence / carrier protection, styles differ in a quiet position but not in urgent ones, no state or RNG change and independence from the dice seed, whole Turns, a whole match against a scripted human, AI v AI) plus **Stalling** (p.80-81): a carrier who can score without dice on Turn 3 or 5 scores in every style instead of waiting for the Crowd; no Stalling risk counted from Turn 7.
- **Existing flows updated for V3 behaviour** (not weakened): the File menu, the collapsed log and Teaching area, End Turn without a dialog and whole-plan Backspace; every V2 check still runs.

### Not verified in this environment

- Safari / the Mac app (WebKit): Playwright's WebKit and system packages could not be downloaded here, and the Mac's screen could not be used. The placement fix is not browser-specific (the display bug was in the app's own state logic), and the pointer input no longer relies on getScreenCTM or on the pitch element surviving a re-render, but please try a set-up once in the Mac app.
- The V3 Mac app (`bash build_mac_app.sh` → *Bloodboard V3.app*) was not compiled or launched here (no Swift compiler); its Swift source differs from the V2 app only in the window title.

| Test file | Tests | What |
|---|---|---|
| `tests/ai.test.ts` | 16 | Computer opponent: representative positions (immediate scoring chance, loose ball, opposing scoring threat, carrier Marked, risky Dodge vs safe Block, last-Turn scoring vs early caution), styles differ in a quiet position but agree on urgent ones, thinking never changes the state or RNG and does not depend on the dice seed, a whole AI Turn ends through the normal flow, a whole match against a scripted human, AI v AI for a half, `exploreOutcomes` accounting (vs `planAction`), Charge!, roll-off / set-up / kick-off inputs, save/load of the opponent setting |
| `tests/skills.test.ts` | 50 | Skills and Traits rule by rule, each against its page |
| `tests/match.test.ts` | 29 | Team templates, match creation (and its rejections), pre-game, set-up validation and rejection (p.47), kick-off, Touchbacks, Kick skill, Kick-off Events (Brilliant Coaching, Dodgy Snack, Pitch Invasion, Time-out, Charge!, Solid Defence, Quick Snap), End of Drive with KO recovery, half-time, full time, Apothecary, formal-position check (missing ball), and **25 whole matches** from pre-game to full time with random dice (state validated after every step) |
| `tests/actions.test.ts` | 15 | Move, Block, Blitz, Pass, Hand-off, Secure the Ball end to end |
| `tests/special.test.ts` | 13 | Throw Team-mate (range, scatter, landing, crash, crowd, Always Hungry, Strong Arm, Bullseye) and Projectile Vomit |
| `tests/montecarlo.test.ts` | 9 | Previewed exact probabilities versus thousands of real executions (incl. Throw Team-mate and Projectile Vomit) |
| `tests/teaching.test.ts` | 8 | Block School: all 80 exercises, all 65 counting answers equal the workbook, every Level 7 workbook answer accepted, every documented discrepancy recomputed |
| `tests/tutorials.test.ts` | 8 | Basic Tutorials build, are solvable, and every number quoted in their hints/solutions is the engine's |
| `tests/basic.test.ts`, `tests/invariants.test.ts` | 11 | Planning never mutates state or RNG (deep-frozen fuzz), illegal inputs roll nothing, determinism, save/load |
| `tests/routes.test.ts` | 6 | Movement area (normal / Rush), lowest-risk auto-route (avoids Tackle Zones, never crosses a loose ball, unavoidable Dodge into the safest square) |
| `tests/geometry.test.ts` | 5 | Passing Range Chart, Range Ruler, push squares, templates |
| `tests/dice-audit.test.ts` | 4 | Block dice fairness and reporting (smaller samples of `docs/BLOCK_DICE_AUDIT.md`) |
| `tests/schema.test.ts` | 4 | Every format validates against `docs/schemas/bloodboard.schema.json` |

## V2.1 checks: computer opponent

- **Legal actions only.** Every input the AI chooses is checked with `validateInput` before it is executed (unit tests, the scripted-human match, the AI-v-AI half, the calibration runs: 0 illegal inputs in all of them). The AI builds candidates only from engine calls (`actionOptions`, `reachableSquares`, `safestRoute`, `blockBreakdown`, `throwablePlayers`, …) and executes through `execute` / `decide` like the interface.
- **No hidden information / future dice.** `think()` on deep-frozen states throws on any write; the same position with a different dice seed gives exactly the same decision (`ai.test.ts`). The AI never reads `state.rng`; `exploreOutcomes` enumerates outcomes without rolling.
- **Urgent priorities.** Scoring chance → every style runs in; opposing carrier 3 squares from our End Zone → every style Blitzes him; carrier Marked → *Protect the ball carrier* (urgent).
- **Turn completion.** Whole AI Turns in four positions end with the Turn passing to the opponent; every decision the AI is asked is answered with one of the offered options.
- **Complete human-v-computer match in the interface** (`scripts/ui-flow-ai.mjs`, headless Chromium): the human coach clicks through the pre-game, set-ups, kick-offs, decisions, one planned Move (Plan → Review → Confirm), End Turn and End of Drive; the computer plays its side of every step. Checked: opponent and style chosen on *New match* are recorded; the scoreboard and side panel show whose turn it is and *Thinking…*; board clicks are refused during the computer's Turn with a message; the computer's dice appear in the tray and advance by themselves; its actions are in the log with their plan summaries; it explains its choices; the advisor recommends an action, changes nothing (state and RNG compared) and *Plan this move* opens a normal plan; Undo takes back the human action together with the computer's replies; the match reaches full time; no console errors. Result: 23/23 checks, full time reached (26 Sep 2026).
- **Calibration** (`scripts/ai-selfplay.ts`): see `docs/AI_OPPONENT.md` for the table and what was fixed.

## v2 checks

### Modes (headless browser, `scripts/ui-flow-v2.mjs`)

- **Practice:** selecting a player shows green (Move Allowance) and yellow (Rush) squares; clicking a reachable square creates a Move plan along the auto-route; planning leaves the game JSON (and RNG) identical; Backspace removes path steps and, with none left, cancels; Confirm shows the dice tray paused after the first roll; the log reveals events in step with the tray; every rolled face appears in the log; **Replay** re-runs the recorded action with exactly the same dice and resulting state; Delete with nothing planned asks, then **Undo** restores the state byte for byte; **New seed** resets with a different seed.
- **Editor:** a position without a ball is **rejected as a formal match position** with the reason, and starts fine as a practice scenario.
- **League:** starter teams are saved; Delete on a selected team player asks first and then removes it; a match starts in the pre-game; the pre-game rolls and asks the roll-off winner; an **illegal set-up is rejected with the p.47 reason** and nothing changes; valid set-ups lead to the kick-off; the kick (and any Kick-off Event that needs the coaches) leads to Turn 1 of the receiving team with the ball in play; End Turn hands over.
- **Tournament / Exhibition:** a team that breaks the draft template cannot start a match (reason shown).
- **Block School:** the exercise opens on a cropped board with workbook labels; right and wrong counts are checked and explained; the solution (with the workbook page) appears after an attempt; a Level 7 move is checked; the exercise can be played out with Plan → Review.
- **Tutorials:** the objective is checked after the action.
- **Block dice in the tray** are the faces the event reports, and the block-die decision appears only after the dice are shown, with the same faces.

### Match engine

- The pre-game, set-up, kick-off and End of Drive inputs are validated by `matchInputReason` before any dice are rolled, exactly like player actions: rejected inputs leave the state and the RNG untouched (`match.test.ts` compares both).
- 25 complete matches (20 with full rules, 5 introductory) run from pre-game to full time with random dice; after every step the state passes `validateState`, no team has more than 11 players on the pitch, and the ball is in play whenever a Turn is being played.

### Block dice (see `docs/BLOCK_DICE_AUDIT.md`)

1,000,000 raw dice and 1,000,000 block faces from the generator, 200,000 first-rolls after loading a seed, 500,000 dice pairs, and 20,000 real Block actions for each of five Strength situations executed by the engine: no bias (p-values 0.43-0.82) and **zero** mismatches between dice records, log lines and chosen results. The perceived excess of Player Down / Push Back is the normal distribution of block dice (Push Back is on two faces; with 2 or 3 dice the chooser's pick shifts it further) plus fixed seeds: a scenario always starts from the same seed, so its first roll repeats until the seed changes. One real defect (a preview-only cache collision after a Pro re-roll of one block die) was fixed with a regression test.

### Workbook

All 65 counting answers of Levels 1-6 agree with the engine; all 15 Level 7 answers are accepted; every difference is listed with pages in `docs/BLOCK_SCHOOL.md` and recomputed by `tests/teaching.test.ts`.

## v1 checks (still run)


### Planning and cancelling leave the game state and the dice generator untouched

- `tests/invariants.test.ts` — **fuzz test**: 751 random plans (every example position plus a crowded midfield full of skills) are made on **deep-frozen** states, so any write would throw; the state, including `rng.seed` and `rng.counter`, is compared byte for byte before and after. Covers moves, dodges, Rushes, Jumps, Blocks, Blitzes, passes, hand-offs, Secure the Ball, End Turn and illegal inputs.
- `tests/basic.test.ts` — "planning does not mutate the state or the RNG".
- `scripts/ui-flow1.mjs` — in the real interface: select a player, build an 8-square plan, open the review, **Cancel plan** → the whole game JSON is identical.
- `scripts/ui-flow2.mjs` — the RNG counter stays at 0 through planning and review and only advances after **Confirm & roll dice**.
- A pending decision blocks planning and execution; answering with a wrong or unknown option changes nothing (`invariants.test.ts`).

### The displayed step probabilities follow the implemented rules

- The step table is produced by the same resolution code that executes the action (a trace run), and the totals by exact enumeration of every dice outcome with that code.
- **Monte Carlo cross-check** (`tests/montecarlo.test.ts`): seven scenarios (two-dodge run, Blitz on the carrier, short pass with two interceptors, hand-off to a marked catcher, dodge + pick-up in traffic, sideline crowd push, long pass that can scatter out of bounds) are executed 3,000–4,000 times each with real dice and the same decision policy, with and without Team Re-rolls. Completion, Turnover, Touchdown and ball-position frequencies all fall within 4.5 standard errors of the previewed exact values.
- **Single-roll actions** (`invariants.test.ts`): for a dodge into two Tackle Zones, a Rush, a pick-up in a Tackle Zone, Bone Head with Loner and a stand-up with MA 2, the displayed single-roll chance and "with a re-roll" chance equal the exact enumeration, with and without a Team Re-roll.
- Hand check (example 1, documented in `docs/EXAMPLES.md`): a 3+ dodge and a 3+ dodge with −1, one Dodge skill re-roll per Turn and one Team Re-roll → 11/18 = 61.1% without, 2/3 = 66.7% with the Team Re-roll; the app shows exactly these.
- `tests/skills.test.ts` (50 tests) checks targets and modifiers rule by rule: block dice counts, assists, Guard/Defensive, Dauntless, Leap's reduced modifier, Really Stupid/Unchannelled Fury/Bone Head chances, weather, passing modifiers, Disturbing Presence, Cloud Burster, and so on, each against its rulebook page.
- `tests/geometry.test.ts` checks the Passing Range Chart, the Range Ruler model against the rulebook examples, push-back squares, throw-in templates and the scatter template.

### Failed actions stop, or cause a Turnover when the rules require it

- Turnovers: failed Dodge, Rush, pick-up, Secure the Ball; fumbled or intercepted pass; pass or hand-off not caught; Player Down; Both Down without Block; Stalling crowd hit (`basic`, `actions`, `skills` tests).
- Activation ends **without** a Turnover: Bone Head, Really Stupid, Unchannelled Fury, Animosity, Foul Appearance, Tentacles, failed Jump Up, Safe Pass on a natural 1; Steady Footing and Wrestle avoid the Turnover (`skills.test.ts`).
- Fuzz: every result reported as a Turnover hands the Turn to the other team (or ends the half), and no completed action changes the active team. This check found and fixed a bug: a Stalling crowd hit while pressing **End Turn** also ended the opponent's next Turn (regression test added).

## Other guarantees tested

- **Illegal inputs roll no dice**: 129 rejected random inputs returned `illegal` with the state and RNG counter unchanged; no input accepted by the planner ever became illegal while executing.
- **Determinism**: every one of 622 executed random actions was executed twice from the same state and produced identical results.
- **Save / open / export / import** round trips are lossless (fuzz test and `ui-flow5.mjs`).
- **Interface formats**: example files, plans, paused executions, decisions and finished results validate against `docs/schemas/bloodboard.schema.json` (`schema.test.ts`).
- **Interface flows** (`scripts/ui-flow1…5.mjs`, headless Chromium): planning/review/cancel; confirm and roll; block with a paused decision; pass with an interceptor choice and a catch re-roll; scenarios, Save As, Open, position editor (move a player, change re-rolls), End Turn dialog, Export/Import, Delete — all with zero console errors. (They now start from the Home screen's Practice entry with the tray's pause switched off.)

## Not verified here

- The **Swift wrapper** (`native/main.swift`) could not be compiled in this environment (no macOS toolchain). It uses only standard AppKit/WebKit APIs available on macOS 11+, but the first `bash build_mac_app.sh` on your Mac is its first real compile. v2 changed it only to accept a storage `folder` (Positions / Teams / Progress, whitelisted).
- The interface was tested in Chromium, not in Safari/WebKit (the engine inside the Mac app). No browser features newer than Safari 14 are used.
- Planning a Throw Team-mate takes a few seconds (it enumerates tens of thousands of outcomes); other plans take well under a second.
