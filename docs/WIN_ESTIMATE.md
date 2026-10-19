# Win-chance estimate (V7-09) — a policy-conditioned sampling estimate, not a prediction

**What it is.** From a position, the estimator plays `N` complete continuations to full time. Each continuation uses its own dice seed derived from a base seed, and **both sides are played by the same built-in coach** (default *Balanced*, with a reduced search so a continuation stays affordable). It reports win / draw / loss counts, their shares with 95 % Wilson intervals, the mean final margin with its standard error, how many continuations finished, and the policy used.

**What it is not.** It is not a prediction about the actual coaches (human, module or online) and not a calibrated universal win probability. It answers: "if both sides were played by this stated built-in policy from here, how often does each side win?" The reduced search makes both sides weaker than in normal play, so draws and swings may be more frequent than in real play. Fewer than 20 continuations is flagged "too few to rely on"; the numbers are still shown with their intervals.

**Continuation policy (stated in every report).** `both sides: built-in balanced coach, reduced search (threshold 0.001, 600 leaves, 6 explored); dice seeds derived from base <n>`. Neutral steps (pre-game, end of a Drive or half) are advanced with the same inputs the Lab runner uses; a continuation that cannot proceed is counted as *unfinished* and excluded from the shares.

**Optional and cancellable.** Off by default. In the Match Lab settings: *Live win-chance estimate* with *every K turns* and *N continuations* (4–200). Safeguards:

- one estimate process at a time across all games of a batch (concurrent games never multiply the load); boundaries that arrive while one runs are skipped;
- the estimate runs in a **separate child process at lower CPU priority** and never touches the game, its dice, or any coach input;
- it uses only the built-in coach: **no online-provider (DeepSeek/Luna) or module call is ever made**, so it cannot consume provider quota;
- stopping the batch (or the game reaching full time) kills the estimate process; an estimate that did not finish is simply absent.

**Cost (measured, 2-core / 8 GiB test VM, CLI `runner win-estimate`).** A continuation costs about as much as a whole built-in game: 8 continuations from turn 1 of a Sevens match took 360 s (≈ 45 s each), from turn 4 of the first half 197 s (≈ 25 s each). Late positions are cheaper. Every report carries `computeMs`, and the Lab shows it. Because of this cost, **in a built-in-v-built-in game (under a minute) no live estimate arrives**; the feature is meant for slower games (online or slow coaches) and for late positions.

**CLI.** `node runner.mjs win-estimate FILE|- [--at N] [--samples N] [--seed N] [--coach balanced|offensive|defensive]` prints one JSON report (`bloodboard-win-estimate/1`) on stdout; `-` reads a game state or save from stdin.

**Where it is shown.** Match Lab → Live tab → *Match data* panel (*Win-chance estimate … after action N*, with counts, intervals, policy, cost and the not-a-prediction label). The game's replay panel still shows measured counts only (it says so); an on-demand estimate there is not built (it would need a worker so the page stays responsive).

**Verification (evidence classes kept apart).** `tests/win-estimate-v7.test.ts` (3 tests, real engine: exact arithmetic on a settled position, reproducibility, the source game and its seed untouched, incremental `advance()`); `scripts/lab-estimate-flow.mjs` (real Lab server + real runner child process + real page, with the example coach slowed to 2.5 s per decision so an estimate can finish before full time: off by default, estimate appears with intervals/policy/cost/labels, never more than one estimate process, none left after stop). Not verified: estimates with online/module coaches in the game being estimated (the estimator itself never calls them), and any claim of calibration.
