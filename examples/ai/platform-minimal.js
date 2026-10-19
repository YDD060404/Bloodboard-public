// Minimal coach for the V5.6 AI platform (docs/AI_PLATFORM.md). Copy it, rename `id`, and build from here.
//
// It asks the engine for legal candidates of its own Turn (request-scoped ids, exact probabilities), drops the risky ones,
// prefers scoring, then the built-in coach's own value, and answers with a RANKING — the host validates every entry and falls
// back to the built-in coach if none is legal. It tells the person watching what it is doing via `services.progress`.
bloodboard.register({
  id: 'platform-minimal',
  name: 'Platform Minimal',
  apiVersion: 1,
  apiMinor: 2,
  requires: ['candidates'],
  version: '1.0',
  description: 'Example: ranks engine-generated candidates by touchdown chance, then low Turnover risk, then the built-in value.',
  timeLimitMs: 10000, // your own per-decision limit, 0.5 – 60 s. Return earlier whenever you are sure.
  async chooseAction(observation, offered, services) {
    // Pre-filter cheaply (players / families / targets / region), page, and use exact probabilities on what is left.
    const page = await services.candidates({ families: ['move', 'block', 'blitz', 'pass', 'handoff', 'secure', 'standUp', 'endTurn'], maxPerPlayer: 3, limit: 40, builtIn: true });
    if (!page.ok) return null; // null = let the built-in coach decide (and the host records why)
    await services.progress({ stage: 'options', headline: `Ranking ${page.candidates.length} legal options by exact chances.`, evaluating: page.candidates.slice(0, 3).map((c) => c.label) });
    const score = (c) => 100 * (c.pTouchdown || 0) - 15 * (c.pTurnover || 0) + (c.builtIn && c.builtIn.builtInValue ? 0.2 * c.builtIn.builtInValue : 0) - (c.kind === 'endTurn' ? 1 : 0);
    const ranking = page.candidates.filter((c) => c.legal).map((c) => ({ candidateId: c.id, score: score(c) }));
    return { ranking, why: 'Platform Minimal: best of ' + ranking.length + ' legal options by touchdown chance and Turnover risk.' };
  },
  // Rule decisions: return an option id (or { optionId, why } with apiMinor 2), or null for the built-in coach.
  chooseDecision(observation, request) {
    return null;
  },
});
