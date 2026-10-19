# Engine interface (the boundary for scripts and future agents)

The rules engine is a pure TypeScript library with no user interface, storage or network code. The app's interface uses exactly the calls below, so anything the app can do, a script — or later an agent such as Claude or Codex — can do through the same boundary.

**There is no model integration, no API key and no network access anywhere in the project.** The V2.1 computer opponent (`src/ai/`, see `docs/AI_OPPONENT.md`) is ordinary local code that uses this same boundary.

Where to find it:

| What | Where |
|---|---|
| Public API (TypeScript) | `src/engine/index.ts` |
| Same API in the browser | `dist/web/engine.js` (global `BloodboardEngine`) |
| Command-line wrapper (Node 18+) | `dist/cli/bloodboard-cli.mjs` |
| JSON Schema of every format | `docs/schemas/bloodboard.schema.json` (generated from the TypeScript types by `scripts/make-schemas.mjs`) |
| Sample inputs | `docs/samples/` |

## The four calls

```ts
actionOptions(state, player)        // which Actions this player may declare now, with reasons when disabled
planAction(state, input, options?)  // validate + preview: steps, targets, modifiers, exact probabilities. Rolls no dice.
execute(state, input, planSummary?) // confirm: rolls dice from state.rng; may pause for a decision
decide(state, { requestId, optionId }) // answer the pending decision; the action continues
```

Also available: `validateInput(state, input)` (the planner's checks without the probabilities), `newGame`, `startPlay`, `backToSetup`, `validatePosition`, `validateFormalStart`, `toSaveFile` / `parseSaveFile`, and read-only helpers (`findPlayer`, `playerAt`, `markersOf`, `passInfo`, `blockStrength`, …).

v2 adds, all pure and dice-free unless noted:

| Call | What |
|---|---|
| `createMatch(kind, teamA, teamB, {rules}, seed)` | A new match state from two `TeamDef`s (`'league'` or `'tournament'`); invalid teams are rejected with reasons |
| `validateTeamDef`, `teamCost`, `newTeamDef`, `playerFromRoster`, `parseTeamDef`, `DRAFT_TEMPLATE` | Saved teams (`format: "bloodboard-team"`) and the Team Draft template (p.89-91) |
| `SEVENS_DRAFT`, `setVeteran`, `rulesFor(state)`, `isSevens(state)`, `usePitch(state)`, `pitch()` | V4 build 3, Blood Bowl Sevens: a Sevens team is a `TeamDef` with `variant: "sevens"` (and one player with `veteran: true`); two such teams give a match state with `variant: "sevens"`. `rulesFor(state)` returns the ruleset in use (pitch size, players per Drive, Turns per half, tables — `src/engine/variant.ts`). The board helpers (`board.inBounds`, …) use the pitch of the state last copied or passed to a public call; `usePitch(state)` selects it explicitly |
| `validateDriveSetup(state, team)`, `defaultFormation`, `kickerCandidates`, `matchInputReason(state, input)` | Set-up and kick-off checks (p.47) — the same checks `execute` applies to match inputs |
| `reachableSquares(state, playerId, pathSoFar?)`, `movementBudget`, `safestRoute(state, playerId, to, pathSoFar?)` | Movement area (normal / Rush) and the lowest-risk step route used by click-to-move |
| `blockBreakdown`, `buildWorkbookState`, `checkExercise`, `solveExercise`, `buildScenario`, `checkGoal` | Teaching helpers (Block School and tutorials) |
| `ttmRange`, `throwablePlayers`, `vomitTargets` | Special action helpers |

V2.1 adds (for the computer opponent; pure and dice-free):

| Call | What |
|---|---|
| `exploreOutcomes(state, input, {threshold?, maxLeaves?, useTeamRerolls?, followUp?}, visit)` | Plays the input through every dice branch with the previews' code and decision policy and calls `visit({p, state, completed, turnover, touchdown})` for each outcome position. Returns `{ok, errors, explored, unresolved, unresolvedTurnover, leaves}`; branches below `threshold` are not expanded (`unresolved`), `unresolvedTurnover` is the part of them that had already suffered a Turnover. Never changes `state` or its dice generator. |
| `previewDecision(state, request)` | The option the previews' decision policy (`POLICY_ASSUMPTIONS`) would choose for a real decision request |
| `createMatch(..., { rules, computer: { team, style } })` | Records that the interface's computer coaches `team` with `style` (`'balanced' \| 'offensive' \| 'defensive'`); the engine itself ignores it |

The AI's own entry points (`src/ai/index.ts`, bound to an engine with `bindEngine(engine)`): `planNext(state, team, style)` / `nextMove(...)` return the computer's next input — `{type: 'decision', requestId, optionId, why}`, `{type: 'step', input, why}` (set-up, kick-off, Kick-off Events) or `{type: 'action', input, why, decision}` — or `null` when it is not that team's turn; the caller executes it with `execute` / `decide`. `think(state, team, {style})` is the analysis (a generator, so an interface can spread it over frames) that AI Focus (the optional advice) also uses; `waitingFor(state)` says which coach the game is waiting for.

### Typical loop

```ts
let state = parseSaveFile(text).save.state;         // or newGame(...) + startPlay(...)
const input = { kind: 'playerAction', playerId: 'A1', action: 'move', path: [...] };

const plan = planAction(state, input);               // no dice, no state change
if (!plan.ok) showErrors(plan.errors);               // e.g. "This square is occupied"
showPreview(plan);                                   // steps, odds, assumptions

let res = execute(state, input);                     // only after the coach confirms
while (res.status === 'awaitingDecision') {
  const choice = askCoach(res.decision);             // res.decision.team says which coach decides
  res = decide(res.state, { requestId: res.decision.id, optionId: choice });
}
state = res.state;                                   // res.status: completed | turnover | touchdown
```

`res.status === 'illegal'` means nothing happened: `res.state` is the unchanged input state and `res.error` explains why.

## Guarantees (all covered by tests)

- **Planning is side-effect free.** `planAction`, `validateInput` and `actionOptions` never modify their input and never advance the random number generator. The tests call them on deep-frozen states, so any write would throw.
- **Illegal inputs roll nothing.** `execute` runs the planner's validation first; an illegal input returns `illegal` with the state untouched and the RNG counter unchanged. An input the planner accepts never turns illegal halfway.
- **Deterministic dice.** The RNG lives in the state (`rng.seed`, `rng.counter`); each die is a hash of seed and counter. The same state, input and decisions always give the same result, so a saved position replays exactly.
- **Decisions are data.** When a choice is needed, `execute` returns `awaitingDecision` and stores the paused action in `state.pending` (a snapshot plus the decisions so far). `decide` replays the action from that snapshot with the recorded decisions, so a paused game can be saved, reopened and continued.
- **Every step is explained.** Each `GameEvent` has readable `text`, a rulebook reference `rule: {page, title}` (printed page numbers) and structured `data`. Each executed action appends a `LogEntry` with the input, the plan summary that was reviewed, every decision and every event.
- **Plain JSON.** Game state, inputs, results and save files contain no functions or class instances.

## Formats (summary — see the schema for every field)

### Coordinates

`{x, y}` with `x` 0–25 (columns A–Z) and `y` 0–14 (rows 1–15). Team A scores in column Z (`x = 25`), Team B in column A (`x = 0`). Squares are written like `R8` (`x = 17, y = 7`). Blood Bowl Sevens (`variant: "sevens"`): `x` 0–19 (A–T), `y` 0–10 (rows 1–11); Team A scores at `x = 19`; Team A sets up at `x ≤ 6`, Team B at `x ≥ 13`, No Man's Land is `x` 7–12.

### GameState (`format: "bloodboard-state"`, `version: 1`)

| Field | Meaning |
|---|---|
| `variant` | absent = standard Blood Bowl; `"sevens"` = Blood Bowl Sevens (Spike! Journal 22): 20 × 11 pitch, 7 players, 6 Turns a half, Sevens tables |
| `phase` | `setup`, `play`, `touchdown` (the Drive ended) or `halfOver`; in a match also `pregame`, `driveSetup`, `kickoff`, `fullTime` |
| `match` | only in a match: kind, options, fans, kicking team, half, Drive, set-up progress, the kick, the Kick-off Event and any interactive part of it (`pendingPhase`: Solid Defence, Quick Snap, Charge!), Bribes, Drive effects, result |
| `weather` | `perfect`, `verySunny`, `pouringRain`, `blizzard`, `swelteringHeat` |
| `teams.A / teams.B` | name, colours, `rerolls`, `leaderReroll`, `score`, `turn` (0–8; 0–6 in Sevens) |
| `players[]` | id, team, number, position, keywords, `ma st ag pa av` (ag/pa/av are target numbers, `pa: null` for "-"), `skills[]` (`{id, value?, keyword?}`), `location` (`pitch`, `reserves`, `ko`, `cas`, `sentOff`), `pos`, `stance` (`standing`, `prone`, `stunned`), `distracted`, `activated`, per-Turn skill `usage`; Sevens: `veteran` (`ready` / `used`) on the team's Veteran |
| `ball` | `{kind:'held', playerId}`, `{kind:'ground', pos}` or `{kind:'none'}` |
| `turn` | `active` team, `used` (blitz/pass/handoff/secure… this Turn), current `activation` (player, declared action, squares used, Rushes used…) |
| `rng` | `{seed, counter}` |
| `options.rulerWidth` | Range Ruler width for interceptions (default 1.8 squares) |
| `log[]` | one `LogEntry` per executed input |
| `pending` | a paused action waiting for `decide`, or `null` |
| `clock` | V5.5, optional: the match timer `{ totalMs, A, B }` written into saved matches (display only; the rules never read it) |

### ActionInput

```jsonc
// a player action segment (move, then optionally block / pass / hand-off)
{ "kind": "playerAction", "playerId": "A1", "action": "move",
  "path": [ { "to": { "x": 18, "y": 7 }, "kind": "step" } ] }

// Blitz: declare the target, move, then block it
{ "kind": "playerAction", "playerId": "A1", "action": "blitz", "blitzTarget": "B1", "blockTarget": "B1",
  "path": [ { "to": { "x": 11, "y": 7 }, "kind": "step" } ] }

// Pass (optionally after a move) / Hand-off
{ "kind": "playerAction", "playerId": "A1", "action": "pass", "path": [], "passTarget": { "x": 25, "y": 5 } }
{ "kind": "playerAction", "playerId": "A1", "action": "handoff", "path": [], "handoffTarget": "A2" }

// Throw Team-mate / Projectile Vomit
{ "kind": "playerAction", "playerId": "A9", "action": "ttm", "path": [], "thrownPlayerId": "A12", "throwTarget": { "x": 25, "y": 7 } }
{ "kind": "playerAction", "playerId": "A7", "action": "special", "special": "projectileVomit", "path": [], "vomitTarget": "B5" }

{ "kind": "endActivation" }
{ "kind": "forgo", "playerId": "A2" }
{ "kind": "endTurn" }

// match sequence (only in a match state; checked by matchInputReason before any dice)
{ "kind": "pregame" }
{ "kind": "setupTeam", "team": "B", "positions": { "B1": { "x": 13, "y": 6 }, "B12": null } }
{ "kind": "kickoff", "kicker": "B6", "target": { "x": 5, "y": 7 }, "useKick": false }
{ "kind": "solidDefence", "positions": { "B7": { "x": 19, "y": 6 } } }
{ "kind": "swarming", "positions": { "A13": { "x": 8, "y": 7 } } }
{ "kind": "quickSnap", "moves": { "A3": { "x": 11, "y": 4 } } }
{ "kind": "endCharge" }
{ "kind": "nextDrive" }
```

Player ids are the `id` fields of the position (e.g. `A1`), not shirt numbers; `docs/samples/` has ready-to-run inputs for the examples.

`action` is one of `move`, `blitz`, `block`, `pass`, `handoff`, `secure`, `foul` (V4), `ttm` and `special` (the Special Actions of Skills and Traits). `swarming` (V5, Swarming p.155) is accepted only while `match.pendingPhase` is `{ type: 'swarming', team, max }` — after both set-ups, before the kick — and places up to `max` (a D3) extra Lineman players of that team from the Reserves Box; `defaultSwarming(state, team)` returns a legal placement. Path steps have `kind` `step`, `jump` (over a Prone/Stunned player), `leap` or `pogo`. An activation can be continued with further `playerAction` inputs for the same player and action (for example, move first, then pass).

V5 step 5 — Star Players: a `playerAction` that starts a Star Player's activation may carry `"starRule": true` to use the Star Player's rule at the start of that activation (Kiroth, Zolcath, Estelle, Boa, Hakflem, Ivar, Grombrindal, Rodney, Grak, Jeremiah Kool — with a `move` Action —, Gretchen, Thorsson, Zzharg, Swiftvine) or the Action variant it allows (Maple Highgrove: `block` at a target 2 squares away, `blockTarget` optional; Nobbla Blackwart: `special` `chainsaw` on a Prone/Stunned player; Bilerot Vomitflesh: `special` `projectileVomit`; Cindy Piewhistle: `special` `bombardier`, two bombs). `startRuleInfo(player)` and `startRuleReason(state, player, action)` tell whether it can be used. Its choices (target, square, skill) and every other Star Player choice are decisions of type `starRule` (options with `square` where a square or player is chosen; `use` / `no` for yes-no questions, `armour` / `save` / `no` for modifiers applied after an Armour Roll).

V5 step 6 — `"starTarget": "<player id>"` (with `starRule`) answers the rule's first "choose a player" question in advance (Thorsson, Zzharg, Swiftvine, Kiroth, Zolcath, Estelle, Jeremiah, Hakflem, Ivar, Grombrindal); it must be one of `startRuleTargets(state, player)`. The computer opponent uses it.

V5 step 6 — Sports-Wizard (p.149): `{ "kind": "wizard", "team": "A", "spell": "fireball", "square": { "x": 13, "y": 7 } }` or `{ "kind": "wizard", "team": "A", "spell": "zap", "target": "<player id>" }` (`"spell": "none"` records a decision to keep it for this gap between Turns). Legal between two Turns (`state.turn.betweenTurns`: from the end of a Turn until the next Turn's first activation; also in the `touchdown` / `halfOver` phases), once per game, for a team that bought the `wizard` Inducement — `wizardReason(state, team, input)` gives the reason otherwise. It is planned and executed like an action (`planAction` / `exploreOutcomes` enumerate its dice). A Zap!ped player carries `frog` (the saved profile) until the end of the Drive.

V5 step 6 — modes: `createMatch(kind, a, b, { …, play: 'tournament' | 'exhibition' })` records the one-off match type (`match.options.play`). A drafted `TeamDef` has `play` (`'tournament'` = Matched Play; absent = Exhibition), `tier` (1-4) and per player `boughtSkill` (one skill bought with Skill Points, added when a Tournament team's match starts); `teamSkillPoints(team)`, `skillPointAllowance(team)`, `MATCHED`, `SOURCE_TIERS`, `sourceTier(rosterId, format)`, `budgetsFor(team)`, `fansRange(team)`. A Tournament match records each team's Tier and Skill Points in `match.matched`.

V5.5 — coaches and match options:

```jsonc
// change who coaches a team during a match (at a safe boundary; logged). coach null = a human at this computer.
{ "kind": "coachChange", "team": "B", "coach": { "ai": "bloodboard-defensive", "name": "Bloodboard AI — Defensive", "version": "5.5.0" } }
// a temporary takeover of a human team by the advisory coach: "activation", "turn" or "untilBack"
{ "kind": "coachChange", "team": "A", "coach": { "ai": "bloodboard-balanced", "takeover": { "mode": "turn", "half": 1, "turn": 3, "since": 57 } } }
```

`createMatch` options (`MatchOptions`) gain `coaches` (`{ A?, B? }`: the AI file of each computer-coached team —
both may be computers), `difficulty` (the optional house rule, computer matches only: `{ player, computer }` 0-3,
applied to every consequential roll by whom the result helps; `planAction` uses the same odds) and, for Sevens,
`sevensOnTheBall` (`'noMansLand'` default = the GW ruling; `'ownArea'` = the optional NAF recommendation).
`coachOf(state, team)` gives the current coach. When both teams are the same saved team (same `TeamDef.id`),
`createMatch` gives Player 2 an independent copy (`mirrorTeamCopy`: own team and player ids, name + "*", colours
inverted) and records `match.mirror = { team: 'B', of: <saved id> }`; nothing of that copy is written back to the saved
team. A League team's match copy (`leagueMatchTeam`) carries its pre-match purchases: Inducements, temporary Star
Players (`temporary: true`) and `preMatch` (Petty Cash, Treasury spent); `match.preMatch` records them.

Sevens Desperate Measures: a `playerAction` may carry `"desperate": "razzleDazzle" | "grudgeMatch" | "setPiece"`
(`desperateInputReason` says why not); the others are answered as decisions of type `desperate`.

### PlanResult

- `ok`, `errors[]`
- `steps[]` (`StepRecord`): every roll on the planned route in order — `label`, `dice`, `target` (e.g. 3 for 3+), `mods[]` (`{label, value}`), `pSingle` (chance the first roll succeeds; `null` for block dice), `rerolls[]` and `pWithReroll`, `onFail`, `rule`, `by` (`active` or `opponent`, e.g. an Interception).
- `withoutTeamRerolls` / `withTeamRerolls` (`OutcomeSummary`): exact probabilities of completing as planned, Turnover, Touchdown (either side), the actor falling or being removed, the target going down, armour broken, pushed, into the crowd, interception, where the ball ends up, block and pass result distributions, and `unresolved` — probability mass not computed (branches below 1e-9), reported instead of guessed.
- `block` (`BlockAnalysis`): strength, assists, number of dice, who chooses, the chance of each face appearing, and the result distribution under the stated choice policy.
- `pass` (`PassAnalysis`): range, modifiers, accurate/inaccurate/fumble chances and each possible interceptor's chance.
- `assumptions[]`: the choice policy behind the numbers (see `docs/RULES_COVERAGE.md`).
- `endsHungry` (V5.5): another player's activation is still open and hungry (Bloodlust, p.125) and this Action would
  end it first — `{ playerId, turnover, text }`. With `turnover: true` no Thrall is next to that player, so the plan is
  not ok (the Action would not be taken): end that activation (the Turnover) or move the player next to a Thrall.

### ExecutionResult

`{ status, state, events, decision?, error? }` with `status` `completed`, `awaitingDecision`, `turnover`, `touchdown` or `illegal`.

Each executed event carries `dice` — every physical die rolled for it (`{kind: 'block'|'d3'|'d6'|'d8'|'d16'|'random', faces, block?}`) — and `snap`, the board at that moment (players' squares/stances and the ball). The dice tray replays an action stage by stage from these; log copies keep `dice` but drop `snap`.

### DecisionRequest / DecisionChoice

```jsonc
{ "id": "0:reroll", "type": "reroll", "team": "A",
  "prompt": "#7 Human Catcher — Dodge from Y8 to Z7 failed (rolled 1, needs 3+ with -1 Marked x1 in Z7). Re-roll?",
  "options": [ { "id": "skill", "label": "Re-roll with Dodge" },
               { "id": "team",  "label": "Use a Team Re-roll (1 left)" },
               { "id": "none",  "label": "No re-roll (falls over — Turnover)" } ],
  "rule": { "page": 33, "title": "Re-rolls and Team Re-rolls" },
  "context": { "natural": 1, "target": 3, "mods": [ { "label": "Marked x1 in Z7", "value": -1 } ], "kind": "dodge" } }

{ "requestId": "0:reroll", "optionId": "skill" }
```

Decision types (a selection): `reroll`, `blockDie`, `bloodlust`, `desperate`, `starRule`, `onTheBall`, `pushSquare`, `kickOrReceive`, `highKick`, `touchback`, `argueTheCall`, `bribe`, `apothecary`, `followUp`, `mightyBlow`, `armBar`, `interceptor`, `sidestepSquare`, `grabSquare`, `safePairOfHands`, `hitAndRun`, `breakTackle`, `divingTackle`, `shadowing`, `tentacles`, `wrestle`, `juggernaut`, `standFirm`, `stripBall`, `fend`, `taunt`, `stalling`, `skill`. Options that refer to a square carry it in `square`. `team` is the coach who must answer (in hot-seat play the other coach takes the mouse for, e.g., the defender's block die or an Interception).

### SaveFile (`format: "bloodboard-position"`, `version: 1`)

`{ format, version, name, savedAt, notes?, state }` — what the app saves and what `examples/*.json` contain.

## Command line

```sh
node dist/cli/bloodboard-cli.mjs summary  examples/01-two-dodges-to-glory.json          # compact facts about the position
node dist/cli/bloodboard-cli.mjs options  examples/01-two-dodges-to-glory.json A1       # what A1 may declare
node dist/cli/bloodboard-cli.mjs plan     examples/01-two-dodges-to-glory.json docs/samples/example1-move.json
node dist/cli/bloodboard-cli.mjs execute  examples/01-two-dodges-to-glory.json docs/samples/example1-move.json --out next.json
node dist/cli/bloodboard-cli.mjs decide   next.json choice.json --out next2.json          # choice.json = DecisionChoice
node dist/cli/bloodboard-cli.mjs validate some-position.json
```

Positions can be save files or bare GameState JSON. `--out` writes the resulting state as a save file (including any pending decision), which the app can import. Example (`plan`, trimmed):

```json
{
  "ok": true,
  "steps": [
    { "label": "Dodge from R8 to S8", "dice": "D6", "target": 3, "mods": [], "pSingle": 0.667,
      "rerolls": ["Dodge", "Team Re-roll"], "pWithReroll": 0.889, "onFail": "falls over — Turnover", "rule": { "page": 55, "title": "Dodging" } },
    { "label": "Dodge from Y8 to Z7", "dice": "D6", "target": 3, "mods": [{ "label": "Marked x1 in Z7", "value": -1 }], "pSingle": 0.5, "...": "..." }
  ],
  "withoutTeamRerolls": { "pCompleted": 0.6111, "pTurnover": 0.3889, "pTouchdownActive": 0.6111, "unresolved": 3.2e-16, "...": "..." },
  "withTeamRerolls":    { "pCompleted": 0.6667, "...": "..." },
  "assumptions": ["Re-rolls: a failed roll is re-rolled with a skill first ...", "..."]
}
```

## Connecting an agent later

Nothing here is implemented, but the boundary is designed for it:

Nothing in v2 changes this: the app still uses only the public engine calls, and no AI or agent feature was added.

1. Give the agent `summary` (or the full `GameState`) and the schema.
2. Let it propose an `ActionInput`; run `planAction` and show the preview to the coach exactly as the app does.
3. Execute only after the coach confirms, and route every `DecisionRequest` to whichever side (coach or agent) its `team` field names.
4. Log the agent's proposals alongside the `LogEntry` records, which already capture what was planned, rolled and why the board changed.

Because every call is deterministic and side-effect free until `execute`, an agent can explore as many plans as it likes without touching the game.
