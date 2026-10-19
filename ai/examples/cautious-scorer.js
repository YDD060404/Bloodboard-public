// Bloodboard AI strategy module — API version 1 (see docs/AI_EXTENSIONS.md in the Bloodboard folder).
// Runs in its own worker: it sees a read-only observation and the legal candidate actions (with the rules engine's
// exact probabilities and the built-in AI's value), and answers with a candidate id, its own input, or endTurn.
bloodboard.register({
  id: 'cautious-scorer',
  name: 'Cautious Scorer',
  apiVersion: 1,
  version: '1.0',
  description: 'Re-ranks the built-in candidates: scores when it can, otherwise the best action whose Turnover risk is under 20%.',
  timeLimitMs: 3000,
  chooseAction(observation, candidates, services) {
    const scoring = candidates.filter((c) => (c.pTouchdown || 0) > 0.5).sort((a, b) => (b.pTouchdown || 0) - (a.pTouchdown || 0));
    if (scoring.length) return { candidateId: scoring[0].id, why: 'Scores with the best chance.' };
    const safe = candidates.filter((c) => (c.pTurnover || 0) < 0.2 && c.builtInValue !== undefined).sort((a, b) => b.builtInValue - a.builtInValue);
    if (safe.length && safe[0].builtInValue > 0.5) return { candidateId: safe[0].id, why: 'The best action with less than 20% Turnover risk.' };
    return { endTurn: true, why: 'Nothing safe enough is worth doing.' };
  },
  // chooseDecision(observation, request, services) { return null; }  // null = let the built-in AI answer
});
