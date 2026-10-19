# Computer opponent and AI Focus

Bloodboard (since V2.1) has **one computer coach** that plays a whole match against you, and V3 adds the optional **AI Focus** advice, which uses the same analysis for your side. Both are local, rules-based programs (`src/ai/`): no language model, no network, no hidden bonuses, no changed dice.

## Starting a match against the computer (V5.5)

- **Home ▸ Set up…** of League, Tournament or Exhibition (or **★ All-Star Match**): set **Player 1** and/or **Player 2**
  to *Computer* and choose its **AI file**; both computer = a match to watch. The set-up is remembered.
- **Home ▸ ▶ Quick Match** starts your remembered preset (e.g. "play the computer" or "watch computer v computer").

A saved match remembers its coaches (`match.options.coaches`: each computer side's AI file id, name and version);
reopening it continues with the same files (a missing file is reported and replaced by the fallback,
`docs/AI_EXTENSIONS.md`).

## What you see during the match

- The scoreboard marks the computer's team **COMPUTER**; the side panel has a **Computer** card with its style, its status (*Waiting*, *Thinking…*, *Playing*, *Rolling…*, *Paused*) and, if *Explain its moves* is on, one short line for its latest choice: the current objective, the action, the chances that matter and the main reason ("Stop the opponent scoring: #3 Orc Lineman could score next Turn … Chose #5 Human Blitzer: Blitz #3 … — knocks the ball loose (64% to succeed, 36% Turnover risk, 31% to knock the ball loose; estimates, see the plan)"). *Other options it weighed* lists the closest alternatives; *Earlier this match* keeps the last reasons.
- The computer acts **one action at a time through the normal rules flow**: its dice appear in the dice tray and the log exactly like yours (with the plan summary and probabilities in the log line). With *Pause after each roll* on, its rolls advance by themselves after a moment; press **Continue**/Space to go faster. *Fast* removes the pauses between its actions.
- While it is the computer's Turn, set-up or decision, clicks on the board are ignored (a message says why); you can still select players to look at them. **❚❚ Pause** stops it before its next action; **▶ Resume** lets it continue.
- Decisions during an action go to the coach the rules name: e.g. when you Block the computer's player and it may choose the block die, the computer chooses; your Apothecary is still your decision.
- Steps both coaches share — the pre-game roll and **End the Drive** / half-time / final whistle — are pressed by you.
- **Undo** (outside the rules, p.35) goes back to before *your* last confirmed action; any computer actions after it are taken back with it. Nothing is ever undone by the computer.
- Your set-up works like in any match (V3): click a Reserves Box player then a square in your half, or drag players; the computer arranges its own team with the engine's legal default formation.

## AI files (V5.5 — no separate style setting)

Each computer coach is a named **AI file**; the three bundled files are parameter files of the same built-in
algorithm. They change preferences between reasonable options — never the rules, legality, dice or re-rolls — and
never override an urgent situation (a realistic scoring chance, stopping an imminent opposing score, a loose ball in
danger, a ball carrier who is Marked). Your own parameter files and strategy modules: `docs/AI_EXTENSIONS.md`.

| AI file | Prefers | In numbers (multipliers on the Balanced weights) |
|---|---|---|
| **Bloodboard AI — Balanced** (default) | Attack, ball safety and defence weighed evenly | — |
| **Bloodboard AI — Offensive** | Moving the ball forward, receivers ahead of the ball, pressure on the opposing carrier; accepts a little more risk | progress ×1.35, receivers ×1.8, pressure ×1.2, reach ×1.3, marking ×1.5; screen ×0.7, cage ×0.8, Turnover cost ×0.85 |
| **Bloodboard AI — Defensive** | A caged, safe ball carrier, screening its End Zone, marking, fewer Turnovers | carrier Marked ×1.25, carrier exposed ×1.4, cage ×1.6, screen ×1.6, pressure ×1.3, opposing progress ×1.25, marked ×1.5; progress ×0.8, receivers ×0.6, Turnover cost ×1.25, crowd ×1.25 |

The **advisory coach** (any AI file) gives AI Focus advice and can take over a human side for one activation, the
rest of the Turn or until you take control back; a side's coach can also be changed during the match (at a safe
moment, logged).

## How it decides (inspectable)

Every decision is an `AIDecision` (`src/ai/types.ts`) with the objective, every candidate considered with its numbers, the position value broken into named terms, and the time taken — the interface shows a summary, the self-play report aggregates them.

1. **Read the position** — score, Turn markers of both teams (is there another Turn in this half for us / for them?), ball (held, loose), players' stance and Tackle Zones, who could reach whom. Only what both coaches can see: the AI never reads the dice generator (`state.rng`) and there is no hidden information in the game.
2. **Objective** (`chooseObjective`): *Take the scoring chance* (the carrier can reach the End Zone this Turn), *Protect the ball carrier* (urgent when he is Marked), *Stop the opponent scoring* (urgent when their carrier is within reach of our End Zone next Turn), *Recover / Contest the loose ball*, *Advance the attack*, *Pressure their ball carrier*, *Improve positioning*. The objective moderately emphasises the terms it is about; after every action the objective is chosen again, so a changed situation changes the plan at once.
3. **Candidates** (`genForPlayer`) come from the engine: `actionOptions` (which Actions each player may declare now, including Charge! restrictions and a continuing activation), `reachableSquares` + `safestRoute` (moves, pick-ups, runs to score), `blockBreakdown` (Blocks and the best square to Blitz from), passes and hand-offs to team-mates, Secure the Ball, Projectile Vomit, Throw Team-mate of a ball carrier into the End Zone, standing up. A cheap pre-screen keeps the promising ones; every scoring, ball-carrier and ball action, and every Block/Blitz on their carrier or on an opponent next to ours, is always kept.
4. **Exact outcomes** (`exploreOutcomes`, a new engine call): the engine plays the candidate through every dice branch with the same code and the same re-roll/decision policy as the plan preview, without rolling and without touching the state. Each resulting position is evaluated; the expected change of value is the candidate's gain. Branches rarer than 0.01% (0.03% for Blocks, 0.2% for passes) are not expanded; their mass is valued like the enumerated outcomes of the same kind (after a Turnover or not) — the engine reports how much of the cut mass followed a Turnover.
5. **Risk and order**: a Turnover also loses what the other players could still do safely this Turn — each action is charged its Turnover chance × the best no-risk gain of every other player. If the best action has ≥ 8% Turnover risk and another player has a useful action with < 1% risk, the safe action goes first (the risky one can still be tried after). An action must improve the position by more than 0.5 points (a Touchdown = 100), otherwise the Turn ends through the normal **End Turn**.
6. **Execute one action**, then think again from the real result.

### Position value (`src/ai/evaluate.ts`)

A sum of named terms in points (Touchdown = 100): score difference; players standing / Prone / Stunned (by Strength and key skills); Team Re-rolls left, scaled by the Turns left in the half; marking; for our carrier: holding the ball, progress towards the End Zone, a scoring threat next Turn (by the Rushes needed), receivers ahead, a cage (V5.5: team-mates on the diagonal corners count fully, those beside him half; smaller in Sevens, where a cage costs most of the team), and the **chance of losing the ball** before our next Turn (V5.5: for each free square next to him, whether an opponent can walk into it from a square our players do not Mark or must Dodge into it (−1 per Tackle Zone, the carrier's own included; the Dodge skill counted), times the assists our players next to that square give him against the Block — plus Blocks by opponents already next to him; the sideline adds crowd-push risk) — holding the ball is capped below a sure Touchdown; for their carrier the mirror image plus pressure, screening players between him and our End Zone and our players converging on him; for a loose ball: who is closer, our nearest player's distance and players around it.

Ball-carrier actions get a greedy one-step look-ahead (`supportUplift`): team-mates who have not acted yet walk (no dice) next to the carrier, so "move the carrier first, then form the cage around him" is valued correctly; every action is compared with the support the carrier could get where he stands.

**Match clock (V5.5, `clockAdjusted`):** in the last two Turns of the second half, a team that is behind fears a
Turnover less (×0.7) and values scoring chances (×1.3), progress (×1.2) and receivers (×1.3) more; a team that is
ahead values carrier safety (exposed ×1.3, Marked ×1.2), stopping their scoring (×1.25) and screening (×1.2) more and
fears a Turnover more (×1.25). Level scores and the rest of the match are unchanged. AI files can add their own
conditions (score, Turns left, half, possession, format).

### Decisions and match steps

- Decisions addressed to the computer use the same policy as the plan previews (`previewDecision`: re-rolls on failures, best block die, Stand Firm, …) except where the position decides: push and follow-up squares, Touchback and High Kick players (best resulting position), Apothecary (use it on a Casualty, keep it otherwise), Receive after winning the roll-off, Argue the Call / Bribe.
- Set-up: the engine's `defaultFormation` (legal by construction). Kick-off: the target least likely to be a Touchback, deep in their half (with Kick if available). Solid Defence: keeps the set-up. Quick Snap: Open players step forward. Charge!: plays its free Moves and one Blitz like a Turn, then ends the Charge.
- **Fouls (V4):** for each player, one Foul on a Prone or Stunned opponent it can reach without a Dodge or Rush, evaluated through every dice outcome like any action (Sent-off chance included); removing the fouled player (KO / Casualty) counts half of that player's worth on top of the position value (calibrated below). A Foul's risk makes it a "later" action after the safe ones. It answers Argue the Call and Bribes for its own Sent-off players.
- **Blood Bowl Sevens (V4 build 3):** the same AI plays Sevens. It reads the pitch size (20 × 11), the Turns per half (6) and the Sevens kick deviation (lower of two D6: the kick target is chosen with those odds, and a ball that lands in No Man's Land does not count as a Touchback); Alert Defence is played like Quick Snap; the Sevens set-up comes from the engine's Sevens `defaultFormation`. No Sevens-specific tactics were added then (V5.5: a smaller cage value in Sevens and the Desperate Measures).

- **Star Player rules at the start of an activation (V5 step 6):** Thorsson's Beer Barrel Bash, Zzharg's blast, Swiftvine's Furious Outburst, Boa's and Rodney's rules are candidate actions on their best targets; Kiroth, Zolcath, Jeremiah Kool and Gretchen add the rule to their player's two best actions; Maple's, Nobbla's and Bilerot's variants are Blocks / Special Actions. Each is evaluated through every dice outcome like any action, minus the value of keeping the rule (1.5 once per game, 0.8 per half, 0.5 per Drive): it bashes the opposing ball carrier with Thorsson, but not while Thorsson holds the ball. Not used: Estelle, Hakflem, Ivar, Grombrindal, Grak, Cindy (their value lies beyond one action). Tests: `tests/stars-ai.test.ts`; self-play `docs/selfplay/v5-stars.md`.
- **Sports-Wizard (V5 step 6):** at the start of its own Turn (the end of the opponent's), Zap! on the three opponents that matter most (their ball carrier, those next to its own carrier, then by the chance to turn them into a Frog) and Fireball on the three squares that hit most opponents and fewest of its own players — each evaluated exactly; cast if the best gain beats keeping the spell (1 + 3 × the share of the match still to play). It does not cast at the end of its own Turn (the human coach can, with "End the Turn and cast").
- **Barik Farblast's Blast It!:** the re-roll of the scatter dice that gives its team the best chance to end with the ball (the one the previews assume).
- **Sevens Desperate Measures (V5.5):** Set Piece on a Pass and Grudge Match on a Foul are candidate variants (valued minus the worth of keeping the measure); Hangover, You Dope!, Sports Espionage and the Discarded Banana Skin are answered by the evaluation; Razzle-Dazzle is not used by the computer.
- **Bloodlust (V5.5):** a hungry player with movement left prefers squares next to a Thrall team-mate (a bite instead of a Turnover); another player's action is not chosen while the hungry player's Turnover would stop it.

## AI Focus (optional advice)

During your Turn the side panel shows one unobtrusive line, **AI Focus · optional advice for this Turn — Ask ▸**. Asking runs exactly the same analysis the computer opponent uses, for your team (choose the style it assumes), and shows:

- the recommended legal action and why (objective and main effects), or *end the Turn* when nothing is worth its risk; when other options are within 1.5 points (a Touchdown = 100) it says **Close call** and presents the pick as a slight preference;
- its chances, labelled **estimates**: completes as planned, Turnover, Touchdown, ball comes loose / knocks their ball loose — with what they include (every roll of the action with modifiers, skill re-rolls, Pro and a Team Re-roll on a failure while one is left, i.e. the plan preview's assumptions; branches rarer than 0.01% are estimated, not enumerated) and the list of rolls from the plan preview;
- the main downside (a Turnover ends your Turn; the ball may come loose; the carrier is left exposed; …);
- up to three close alternatives with their trade-offs (safer / riskier, higher / lower scoring chance, how much less overall — the "points" are the AI's own position judgement, not exact);
- **Plan this move** opens it as your own plan (Plan → Review → Confirm); nothing happens until you confirm.

AI Focus never acts: it does not change the board, the Turn, the log or the dice generator and sees nothing a coach cannot see (tested on deep-frozen states, with the dice seed changed, and in the browser). It is discarded when the position changes; **Recalculate** runs it again, **Hide** folds it back to one line.

## Calibration

`node build/ai-selfplay.mjs [matches] [firstSeed]` (bundled by the commands in `docs/VERIFICATION.md`) plays whole matches computer against computer with random dice — every style pairing, Humans and Orcs on both sides — and reports per style: Touchdowns, scoring attempts and their average chance, declined scoring chances (≥ 60%), Turnovers against the AI's own expectation, *avoidable risks* (a clearly safer alternative within 1.5 points), ball lost during its own action and during the opponent's Turn, the action mix, the objective mix and think time. The results and the fixes they led to are in the section below and in `BLOODBOARD_WORK_STATUS.md`.

### V5.5: compared with the V5 step 6 coach (request item 9; 27–28 September 2026)

What changed (`src/ai/evaluate.ts`, `src/ai/brain.ts`): the chance of losing the ball counts **real access** to the
free squares next to the carrier (walked into from an unmarked square, or a Dodge with −1 per Tackle Zone and the Dodge
skill), the assists his team-mates give there, and Blocks by opponents already next to him; team-mates on the
diagonal corners count fully for the cage and those beside him half (a diagonal "X" cage is rated clearly safer than a
cross with the same four players — `tests/ai-tactics.test.ts`), and a cage is worth less in Sevens, where it costs most
of the team; the **match clock** in the last two Turns of the second half (behind: more risk for a score; ahead: ball
safety and screening); Sevens Desperate Measures; a Bloodlust player moves next to a Thrall. Unchanged: exact outcome
enumeration, Turnover charge, re-planning after every action, AI Focus (read-only).

**Method.** `scripts/ai-compare.ts` plays whole matches with the engine's seeded dice: each seed and pair of rosters twice,
the coaches on swapped sides (Human–Orc, Norse–Lizardmen, Skaven–Dwarf, Wood Elf–Chaos Chosen in turn), the new coach
with the bundled *Balanced* file against the V5 step 6 coach (`scripts/baseline/v5-step6-ai`, its Balanced style, on
the same rules engine). "Ball lost" = the team held the ball and lost it other than by scoring or the end of a half;
"Passive ends" = the Turn ended although a Block / Blitz with a positive value and < 10% Turnover risk was on offer;
KO / CAS are credited to the coach of the other team; think time = mean per decision.

**Harness check (before the changes):** 11-a-side, 2 pairs (seeds 101–102) — both rows identical (2-0-2, TD 2-2,
27 Turnovers, 12 balls lost, 374 actions): the comparison itself is neutral.

| Format, sample | Coach | Games | W-D-L | TD for-against | Turnovers | Ball lost | Actions | Blocks / Blitzes | Passive ends | KO / CAS caused | KO / CAS suffered | Crowd pushes suffered | Illegal | Think / decision |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 11-a-side, 6 pairs (seeds 301–306) | new | 12 | 3-6-3 | 5-3 (+2) | 65 | 13 | 1178 | 408 | 4 | 31 / 42 | 27 / 25 | 3 | 0 | 335 ms |
| | old (V5 step 6) | 12 | 3-6-3 | 3-5 (−2) | 60 | 25 | 1081 | 405 | 2 | 27 / 25 | 31 / 42 | 11 | 0 | 311 ms |
| Sevens, 8 pairs (seeds 201–208) | new | 16 | 4-7-5 | 9-8 (+1) | 59 | 17 | 790 | 241 | 3 | 15 / 14 | 7 / 20 | 0 | 0 | 268 ms |
| | old (V5 step 6) | 16 | 5-7-4 | 8-9 (−1) | 53 | 23 | 837 | 237 | 1 | 7 / 20 | 15 / 14 | 3 | 0 | 330 ms |
| Sevens, 24 pairs (seeds 401–424) | new | 48 | 12-25-11 | 25-26 (−1) | 162 | 57 | 2516 | 766 | 1 | 63 / 36 | 61 / 37 | 40 | 0 | 523 ms |
| | old (V5 step 6) | 48 | 11-25-12 | 26-25 (+1) | 149 | 72 | 2451 | 779 | 2 | 61 / 37 | 63 / 36 | 32 | 0 | 356 ms |
| **All 76 games** | new | 76 | 19-38-19 | 39-37 (+2) | 286 | 87 | 4484 | 1415 | 8 | 109 / 92 | 95 / 82 | 43 | 0 | — |
| | old (V5 step 6) | 76 | 19-38-19 | 37-39 (−2) | 262 | 120 | 4369 | 1421 | 5 | 95 / 82 | 109 / 92 | 46 | 0 | — |

**Reading the results.** Consistent in all three samples: the new coach **loses possession less often** (13 v 25,
17 v 23, 57 v 72 — 87 v 120 in all) and makes a few **more Turnovers** (286 v 262). Everything else is even or mixed: W-D-L **19-38-19** for both, Touchdowns 39-37; crowd pushes suffered
fewer in the first two samples but more in the large Sevens one (43 v 46 in all); injuries caused a little higher
(109 / 92 v 95 / 82); think time higher in Sevens (523 v 356 ms per decision). With 76 paired games these differences in
results are within chance, so **a strength gain is not demonstrated**; 0 illegal inputs on both sides does not show
strength either — these numbers describe behaviour.

### V4 build 3: Blood Bowl Sevens (27 September 2026)

`node build/ai-selfplay.mjs 12 301 --sevens` — 12 Sevens matches computer v computer (Human and Orc Sevens teams, every style pairing, full rules): all completed, **0 illegal inputs**, 7 Touchdowns, 93 Turnovers (the AI expected 92.1), ball lost in its own action / in the opponent's Turn 12 / 30, think time median 123 ms (95%: 840 ms, max 2.1 s), about 25 s per match. On the narrow 11-square pitch its players end Turns on an edge square more often (96, 15 pushed into the crowd); the crowd term works as on the full pitch, but no Sevens-specific tuning was done. Also checked: a whole Sevens match against a scripted coach (`tests/sevens.test.ts`) and one through the interface (`scripts/ui-flow-sevens.mjs`, 40 computer actions, full time). The Lizardmen and Norse rosters were checked the same way (`tests/rosters.test.ts`: a computer-v-computer half with legal inputs only; `scripts/ui-flow-rosters.mjs`: a whole match against the computer's Norse).

### V4 build 3: low-probability routes and Turnovers — reviewed, change not kept (27 September 2026)

The self-play "avoidable risks" list (a clearly safer, nearly as valuable alternative was available) showed a pattern: a risky move or Blitz (33–83% Turnover) taken over another player's 3–11% Block, because only no-risk actions (≤ 2%) counted in the Turnover charge and in "safe actions first". A focused change counted low-risk actions (≤ 15%, at their success chance) in the charge and took another player's low-risk action first when that put less value at stake (its risk × the risky action's gain < the risky action's risk × its gain). Self-play, seeds 101–112, against the kept version:

| | Kept (half foul bonus) | With the change |
|---|---|---|
| Avoidable-risk flags | 23 | 16 |
| Touchdowns | 13 | 7 |
| Turnovers (AI's expectation) | 135 (128.0) | 141 (139.6) |
| Edge Turn-ends / pushed into the crowd | 51 / 5 | 90 / 9 |

It did what it aimed at (fewer flagged risks) but played worse overall — more Blocks, slower attacks, more Turnovers and exposure — so it was reverted and the second seed set was not run. The remaining avoidable risks are mostly close calls (values within 1–1.5 points of the safer option); a better fix needs a two-action look-ahead (listed under *Known limitations*), not a broader rule.

### V4: Fouls (26–27 September 2026)

The value of removing the fouled player was calibrated with self-play (12 matches per seed set, every style pairing, Humans v Orcs on both sides):

| Version | TDs (101–112 / 201–212) | Turnovers | Fouls | Own players Sent-off | Fouled player removed |
|---|---|---|---|---|---|
| Build 1 (never fouls) | 12 / 8 | 132 / 135 | 0 | 0 | 0 |
| No removal bonus | — | — | 1 in 12 matches (seeds 101–112) | — | — |
| Full bonus (whole player's worth) | 11 / 5 | 140 / 131 | 12 / 27 | 3 / 5 | 2 / 5 |
| **Half bonus (kept)** | 13 / 7 | 135 / 136 | 6 / 14 | 1 / 1 | 1 / 1 |

With the full bonus it fouled too often and scored less; with half of it the computer fouls now and then when the odds are good, without losing Touchdowns or adding Turnovers. 0 illegal inputs in every run.

### V4: sideline and corner exposure (26 September 2026)

**Change** (`src/ai/evaluate.ts`, term `crowd`; `crowdPushSquares` in `src/engine/block.ts`). At the end of our Turn, for each of our Standing players on an edge square, the engine's own push rule is asked which squares next to him an attacker would push him *into the crowd* from (none if every push square on the pitch is free; Stand Firm, and Sidestep with a free square, protect him). If an opponent already stands on such a square (weight 0.6) or can reach one with a Blitz next Turn (MA + 1, weight 0.25), the player's worth × ⅔ (the chance a crowd push ends in a KO or Casualty) is counted as at risk. No blanket ban: a player keeps an edge square when that square does something worth more (e.g. marking their ball carrier) — the term only tips the choice between similar squares. Defensive style weighs it ×1.25.

**Targeted tests** (`tests/ai.test.ts`): the term follows the engine's push rule (zero one square in, with no opponent near, or with Stand Firm); a free player on the sideline with a comparable square one row in steps in (with the term switched off every style ran him up the sideline to an exposed square — the test fails without the change); a sideline player marking their ball carrier stays.

**Self-play comparison** (same code except the AI; `node build/ai-selfplay-baseline.mjs 12 <seed>` = V3 AI, `node build/ai-selfplay-v4.mjs 12 <seed>` = V4 AI; 12 matches per run, every style pairing, Humans v Orcs on both sides, full rules, random dice):

| | Seeds 101–112 V3 → V4 | New seeds 201–212 V3 → V4 |
|---|---|---|
| Player-Turn-ends on an edge square | 136 → **63** | 104 → **83** |
| …with an opponent already on a crowd-push square | 16 → **9** | 10 → **6** |
| …with one in Blitz reach of such a square | 96 → **21** | 61 → **17** |
| Players pushed into the crowd | 12 → **5** | 7 → **3** |
| Touchdowns | 8 → 12 | 6 → 8 |
| Turnovers (AI's own expectation) | 136 (133.1) → 132 (127.4) | 150 (146.1) → 135 (132.6) |
| Ball lost in own action / in opponent's Turn | 7 / 45 → 8 / 40 | 17 / 41 → 11 / 36 |
| Declined ≥ 60% scoring chances | 7 → 9 | 6 → 6 |
| Avoidable-risk flags | 22 → 23 | 25 → 26 |
| Illegal inputs | 0 → 0 | 0 → 0 |
| Think time median / 95% / max (ms) | 169 / 1028 / 4939 → 180 / 1603 / 8169 | 159 / 983 / 5552 → 142 / 1116 / 8722 |

Reading: exposure to crowd pushes and actual crowd pushes fell clearly on both seed sets, with no loss elsewhere (more Touchdowns, fewer Turnovers, fewer balls lost). The declined scoring chances were reviewed as leads, not tuned away: most are on Turn 7 (no Stalling risk, the carrier scores on Turn 8 so the opponent has no reply) or chances that need Rushes past a converging defence; delaying can be legitimate and the AI's timing was left unchanged. Think times were measured on a shared 2-core machine while other jobs ran, so the higher maxima are not a reliable comparison; the extra work per evaluated position is small (only edge players are checked).

### Latest results (V3, 26 September 2026)

6 complete matches (seeds 101–106), every style pairing, Humans v Orcs, full rules, random dice: **6 Touchdowns (Humans 6, Orcs 0), 0 illegal inputs**; Turnovers 74 against the AI's own expectation of 70; think time median about 0.2 s per action, 95th percentile 0.8–2.6 s, maximum 4.3 s. The earlier V2.1 run (9 matches): 10 Touchdowns, Humans 9, Orcs 1.

| | |
|---|---|
| Result | V3: 6 Touchdowns in 6 matches (0–2 per match), all by Humans; V2.1: 10 in 9 (Humans 9, Orcs 1) — the Orc AI rarely breaks through |
| Legality | 0 illegal inputs in every run (and in the tests) |
| Turnovers | the actual count matches the AI's own estimate (V3: 74 vs 70 expected over 6 matches; earlier 133 vs 123 over 12): its risk numbers are sound |
| Think time | median about 0.2 s per action, 95th percentile 0.8–2.6 s, maximum 4.3 s in V3's run (earlier runs: rare peaks of 6–11 s for a Blitz on a ball carrier or a pass, where every bounce is enumerated) |
| Against a coach who only ends Turns | 2–4 Touchdowns per match |

V3 fix: **Stalling (p.80-81)** — the AI now counts the Crowd's roll (D6 ≥ Turn number knocks the carrier down) when its carrier could score without dice, so it takes such a Touchdown instead of ending the Turn next to the End Zone (a 100% chance was declined on Turn 6 in the first V3 run; not any more). Earlier fixes: ball carrier kept still → chance-of-losing-the-ball model + support look-ahead; carrier moves screened out → every distance considered; pointless one-square moves removed; holding the ball capped below a Touchdown; loose balls and far ball carriers now chased; safe actions before risky ones; the value of an unfinished activation (a carrier who Blitzed and may still move) is no longer thrown away; time pressure late in a half; team-mates move up with the ball; think time cut from up to 17 s.

**Still open (next calibration step):** AI-v-AI matches are low-scoring and the Orc offence is weak (no Orc Touchdown in the V3 run); the carrier advances cautiously against a defence that converges on it; with an 80–97% chance that needs a Rush, the AI sometimes keeps the ball next to the End Zone and scores a Turn later. See `BLOODBOARD_WORK_STATUS.md`.

## Known limitations

- The look-ahead is one action deep plus the support walk for ball carriers; it does not search combinations of several risky actions or the opponent's reply. Plans that need two actions in a fixed order (e.g. a Blitz to open a lane *and then* a run) are found only when the first action is already worth it on its own.
- The position value is hand-tuned (see *Calibration*); it knows about cages, screens, exposure and scoring threats, and (V4) the risk of its own players being pushed into the crowd, but not deeper tactics such as deliberately stalling until the last Turn or surfing opponents. It fouls only when the odds are good (see *Fouls*); its only Sevens-specific tactics (V5.5) are a smaller cage value and the Desperate Measures.
- Passes are considered from where the thrower stands (plus hand-offs after a move); a "move, then pass" plan is found only after the thrower has moved for its own sake.
- Decisions inside an action follow the plan preview's policy (e.g. a Team Re-roll on any failure while one is left).
- Thinking usually takes 0.1–0.7 s per action, occasionally several seconds for Blitzes on a ball carrier or passes (every bounce is enumerated); the interface keeps painting and shows *Thinking…*.
- Calibration is not finished: computer-vs-computer matches are low-scoring (about one Touchdown per match) and the Orc offence rarely scores; it is an ordinary, careful player rather than a strong one. It may hold the ball next to the End Zone for a Turn instead of taking a Rushing score at once (it no longer does so when the Stalling rule applies).
- Re-roll decisions during its own actions follow the preview policy (a Team Re-roll on a failure while one is left); it re-plans after every action from the real result, not between the rolls of one action.
- Tested in Chromium (headless) only; the V5.5 Mac app has not been built or launched in the development environment.
- V5.5: the comparison with the V5 step 6 coach (above) shows different behaviour (fewer possessions lost, a few more Turnovers) but no gain in results (76 paired games: 19-38-19); the computer does not use Razzle-Dazzle.
- V5.5: with the access-based exposure model, a carrier who cannot be protected where he stands may be moved back out of every opponent's reach instead of advancing with a partial cage (in a 3 v 2 test position near a sideline: 4 squares back, the sideline player then a front cage corner). That is cautious play; it was not tuned away because the comparison matches above were played with these weights. Two older behaviour tests were re-stated for it (`tests/ai.test.ts`: the open-field style test and the sideline test; reasons in the tests).
