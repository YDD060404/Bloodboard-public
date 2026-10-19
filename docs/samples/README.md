# Sample inputs for the command-line interface

| File | Use with | What it does |
|---|---|---|
| `example1-move.json` | `examples/01-two-dodges-to-glory.json` | #7 Catcher runs R8 → Z7 (two Dodges) |
| `example2-blitz.json` | `examples/02-blitz-the-carrier.json` | #6 Blitzer moves to J8 and Blitzes the Knight Catcher |
| `example3-pass.json` | `examples/03-short-pass-to-the-end-zone.json` | #10 Thrower passes to Z6 |
| `example4-handoff.json` | `examples/04-hand-off-and-run.json` | #9 Knight Thrower hands off to #7 |
| `end-turn.json` | any position | ends the active team's Turn |
| `choice-reroll-with-skill.json` | a state paused on request `0:reroll` | answers that decision with the skill re-roll (edit `requestId` to match the pending request) |

Player ids (`A1`, `B1`, …) are the `id` fields in the position file, not shirt numbers; `node dist/cli/bloodboard-cli.mjs summary <position>` lists them.

```sh
node dist/cli/bloodboard-cli.mjs plan    examples/02-blitz-the-carrier.json docs/samples/example2-blitz.json
node dist/cli/bloodboard-cli.mjs execute examples/02-blitz-the-carrier.json docs/samples/example2-blitz.json --out next.json
```
