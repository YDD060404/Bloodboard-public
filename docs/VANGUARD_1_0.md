# Vanguard 1.0 — optional coach (not proven stronger)

File: `ai-models/vanguard/vanguard-1-0.js` (install like any AI file; `timeLimitMs` 12 000, uses `candidates`, `explore`, `evaluate`).

**Idea.** Start from what the built-in coach would do (`observation.builtInChoice`, new in V5.6.1). For the built-in pick, "End the Turn"
and the best few other options, look at the likeliest exact outcomes and the opponent's best single reply (valued by the platform
evaluation). Deviate from the built-in pick only when the reply check favours another option by more than 2 points. No hand-set
principle weights. Falls back to the built-in pick if time runs out.

**Results (sevens, 8 s limit, coach v built-in Balanced, both sides and both rosters, seeds 1–9):**

| Setting | Games | W | D | L | Goals |
|---|---|---|---|---|---|
| Vanguard 1.0 (this file) | 36 | 9 | 17 | 10 | 16–18 |
| Aggressive variant (not shipped: shrink 1.0, margin 1.0) | 12 | 2 | 4 | 6 | 3–8 |
| First version, guessing the built-in pick (not shipped) | 12 | 0 | 6 | 6 | 0–9 |

Vanguard 1.0 plays level with the built-in coach; **no strength gain was found.** Think time about 2.6 s average, 9.5 s maximum, 0 fallbacks.
Not tested in the standard 11-a-side format. Games ran with two jobs sharing 2 CPU cores part of the time (time-budgeted coaches are not reproducible).

**Lessons for coach authors.** (1) Do not re-implement the built-in coach's choice from `builtInValue`: it also uses hidden `gainStatic` fallbacks and
ordering rules; use `builtInChoice`. (2) An opponent-reply search measured with incomplete enumeration is noisy at the scale of
ordinary action gains (0.5–3 points); trust it only for large differences. (3) Sevens games are low scoring; 36 games cannot show a small edge.
