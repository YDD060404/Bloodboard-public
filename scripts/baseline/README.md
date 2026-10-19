# Baseline AI for comparisons

`v5-step6-ai/` is the computer coach of Bloodboard V5 step 6 (27 Sep 2026), copied unchanged except for the import
path of the engine types. `scripts/ai-compare.ts` plays it against the current V5.5 coach (request item 9: "compare
against the prior AI"). It runs on the current rules engine, so both coaches play by exactly the same rules.

It is excluded from type-checking (tsconfig.json) because it is frozen code written against the step 6 types.
