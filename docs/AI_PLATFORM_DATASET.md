# Offline research, self-play and the trajectory dataset

Offline tooling lives in `src/platform/research/` and `scripts/ai-platform-batch.ts`. It is **separate from the match-time
services** (nothing in `src/platform/*.ts` imports it) and depends on no other tool. It runs whole matches headlessly,
asking each coach for decisions through the same host the app uses (`platformDecide`: isolated worker, limits, validation,
fallback), so a batch tests what the app runs.

## Running a batch

```
esbuild scripts/ai-platform-batch.ts --bundle --platform=node --format=esm --outfile=build/ai-platform-batch.mjs \
  "--banner:js=import { createRequire } from 'module'; const require = createRequire(import.meta.url);"
node build/ai-platform-batch.mjs --out runs/demo \
  --coaches module:ai-models/hopeful/hopeful-0-2.js:6000,builtin:balanced \
  --seeds 11-12 --rosters human,orc --format standard --observations compact
```

| Option | Meaning |
|---|---|
| `--coaches a,b,…` | `builtin:<style>` (balanced, …) or `module:<file>[:timeLimitMs]`. Every unordered pair plays. The module's id, version and a SHA-256 prefix of its code are recorded; `:timeLimitMs` is the per-decision **budget** (0.5–60 s). |
| `--seeds 1-4` / `1,5,9` | Dice seeds (controlled). |
| `--rosters R1,R2` | `human`, `orc`. |
| `--format` | `standard` or `sevens`. |
| `--observations` | `none`, `compact` (positions + clock, default), `full` (the coach's whole observation). |
| `--no-features` | Omit the `features/1` vector from each step. |
| `--no-swap` | Skip side and roster swaps. |

Design per seed and pair (X, Y) with rosters (R1, R2): X/A R1 v Y/B R2, Y/A R1 v X/B R2, X/A R2 v Y/B R1, Y/A R2 v X/B R1 —
every coach plays every roster on every side. Output directory:

* `meta.json` — schemas, platform minor, feature names, coach list (label, id, version, limits, code hash), design, Node version, command line, reproducibility note.
* `trajectories.jsonl` — **public** dataset (below).
* `internal.jsonl` — **internal**: the engine's dice events and log entries added by each step. *Never give this to a coach or a learner that will play live.*
* `results.jsonl` — one record per game: score, winner, rewards per team, fallbacks, think time, configuration.
* `summary.json` — per coach wins/draws/losses, goals, fallbacks, decisions, think time.

Reproducibility: the same seed, rosters and coaches reproduce a match exactly for built-in coaches and for modules whose
decisions do not depend on wall-clock time. A module that stops its search on a time budget (Hopeful does) may choose
differently on a faster or slower machine; the decisions actually taken are in `trajectories.jsonl`, so the recorded
game can always be replayed from the file.

## `trajectories.jsonl` (schema `bloodboard-trajectory/1`, `docs/schemas/platform/trajectoryStep.schema.json`)

One JSON object per decision, written when the game ends (so each carries its outcome):

| Field | Content |
|---|---|
| `schema`, `game`, `step`, `team` | record type, game id, step index, deciding team |
| `coach` | `{label, id, version}` |
| `kind` | `action` (a Turn action) or `decision` (a rule decision: touchback, Block die, …) |
| `observation` | public observation (`compact`: clock, score, re-rolls, ball, `players:[id, team, x, y, stance, location, activated]`; `full`: the coach's observation) — **public information only** |
| `features` | `features/1` vector values (names in `meta.json`), from the deciding team's perspective |
| `candidates` | the offered candidate summaries: `{index, label, kind, playerId, input, pSuccess, pTurnover, pTouchdown, builtInValue}` |
| `selected` | the action played (`input`, `label`) or `{optionId}` |
| `ruleDecision` | for `decision`: request type and options |
| `source` | `{via, fellBack, reason}`: how the answer was taken (`candidateId`, `serviceCandidate`, `input`, `endTurn`, `ranking`, `builtin`), or why the built-in coach decided |
| `why`, `ranking`, `trace`, `progressNotes`, `diagnostics`, `usage`, `thinkMs` | the coach's explanation, scores/probabilities it returned, its own trace object, counts |
| `outcome` | `{result: +1/0/-1, scoreDiff}` for the deciding team, for the whole game |

Dice, seeds beyond `meta.json`, hidden state and the RNG appear **only** in `internal.jsonl`.

## Training a learned coach

The dataset is designed so that a model needs no heavyweight dependency at play time:

1. **Train offline** (any tool) on `trajectories.jsonl`: inputs `features` (and/or the compact observation), the candidate
   list, the selected index; targets `selected` (imitation) and/or `outcome` (returns, value learning). Generate more data by
   self-play with varied seeds, rosters and budgets.
2. **Export the model as data** — a weight array (a linear/logit model over `features/1` and a few candidate features, or a small
   MLP) small enough to paste into a JavaScript file.
3. **Package it as a coach**: a module that embeds the weights and, in `chooseAction`, builds the feature vector with
   `services.features()`, asks `services.candidates(...)` (or uses the offered list) and answers
   `{ranking: [{candidateId, logit}…], why}`. The host validates everything; a bad ranking falls back to the built-in coach.
   It can also call `evaluate`/`explore` for search features. No dependency beyond plain arithmetic in the worker.
4. **Evaluate** with the batch runner against fixed opponents, with side and roster swaps, before believing any strength claim.

```js
bloodboard.register({ id: 'tiny-linear', name: 'Tiny linear', apiVersion: 1, apiMinor: 2, version: '0.1', timeLimitMs: 5000,
  async chooseAction(o, cands, sv) {
    const f = (await sv.features()).values;                 // position features (stable order, features/1)
    const r = await sv.candidates({ families: ['move','block','blitz','endTurn'], limit: 60, builtIn: true });
    const dot = (a, b) => a.reduce((t, x, i) => t + x * (b[i] ?? 0), 0);
    const Wf = [/* weights over the position features */], Wc = [/* per-candidate weights */];
    const score = (c) => dot(Wf, f) + dot(Wc, [c.pSuccess ?? 0, c.pTurnover ?? 0, c.pTouchdown ?? 0, c.builtIn ? c.builtIn.builtInValue : 0]);
    return { ranking: r.candidates.map((c) => ({ candidateId: c.id, logit: score(c) })), why: 'linear model' };
  } });
```

Honest limits: the compact dataset records positions and chances, not dice; the candidate list in a record is what the
coach was offered (the built-in coach's pruned list), not every legal action — for richer action sets record
`services.candidates()` output in your own coach's `trace`.
