# Explore outcome identity: complete-state-v1

This additive platform repair replaces the incomplete continuation-state key in `src/platform/explore.ts`. No engine rule, probability formula, RNG, legal action or decision policy is changed.

Every successful `explore` result now includes `outcomeIdentity: 'complete-state-v1'`, even when `maxOutcomes: 0`. Hosts without this marker do not establish this continuation identity guarantee. A consumer may still use their scalar results under their existing documented assumptions, but must not infer complete continuation distributions from their retained keys.

The grouping key is exact canonical JSON of the complete `analysisView(state)` plus turnover, touchdown and completion flags. It includes full player states and profiles, full activation and turn state, team resources, match/options/phase/weather/ball and future state fields. The pre-existing analysis view excludes only top-level log, RNG, clock and title, which do not affect future probability analysis. Object member insertion order is ignored; arrays keep their order. No fixed-width hash is used for grouping.

The old key abbreviated both `standing` and `stunned` to `s` and omitted distracted, usage and several other public state fields. Equal keys could therefore retain the wrong representative successor. The repaired key still combines genuinely identical states and adds their probability mass.

Solved decision policies list only groups reachable under the selected policy. The old aggregation fallback could accidentally restore an unreachable group's raw leaf mass; this repair uses zero for an absent solved group. The expectimax solver, immediate scalar values and its existing `enumerated` diagnostic are unchanged. For solved decisions, `enumerated` can include explored alternatives and is not a normalized outcome probability; use the retained outcome distribution and `rest` for continuation mass.

The marker describes outcome identity, not full enumeration or universal game-tree coverage. Existing `exact`, `unresolvedMass`, `rest`, decision-policy assumptions, time/leaf limits and nullable retained keys still apply. Single-action scalar values and probabilities are unchanged for an equal set of enumerated leaves. Multistep analyses can change because they now receive the correct continuation distribution.

Build fingerprint scope: `apiHash` changes. `engineHash` and `rulesHash` are unchanged because the rules/transition source is unchanged. The local release package is `6.1.0` (V6.1); bundle identity, Application Support paths and save format remain V6-compatible.

## Verification

- `tests/outcome-identity.test.ts`: complete-state field sensitivity, stable equivalent-state merging, actual raw leaf grouping and probability mass for ordinary Block, Hypnotic Gaze, Chainsaw, Bombardier, Ball & Chain and Throw Team-mate with zero and one re-roll; retained state/observation fidelity; real keyed follow-up; marker with zero listed outcomes; root/RNG immutability
- Ordinary Block zero-reroll fixture: all 75 leaves enumerated with no unresolved mass; the pushed target's standing 1/3 and stunned 0.09002057613168729 branches remain separate
- Hypnotic Gaze zero-reroll fixture: distracted 2/3 and not-distracted 1/3 remain separate
- Adversarial and optimistic decision regressions: normalized retained mass and weighted value, no resurrected unreachable Gaze failure branch
- Before/after runtime comparison: same raw leaves, scalar results and deterministic executions with seeds 1, 13 and 99 across all 12 fixtures

Native Mac build/launch is not part of this repair's cloud validation.
