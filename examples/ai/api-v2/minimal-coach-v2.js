// Bloodboard AI API v2 — the smallest useful coach (docs/AI_API_V2.md).
// It never looks at the candidate shortcut: it asks the engine what is legal (legalChoices → legalTargets → validate),
// blocks an adjacent opponent when the engine says it can, and otherwise ends the Turn.
bloodboard.register({
  id: 'minimal-v2',
  name: 'Minimal v2',
  apiVersion: 2,
  apiMinor: 0,
  version: '1.0',
  description: 'API v2 example: legal-choice discovery and validation, no candidates.',
  timeLimitMs: 4000,
  contextSchema: 'minimal-v2-memory/1',
  capabilities: { playTurn: true, ruleDecisions: true, persistentContext: true },
  async playTurn(obs, _candidates, sv) {
    const memory = obs.coachContext || { turnsPlayed: 0 };
    const lc = await sv.legalChoices();
    const block = lc.choices.find((c) => c.type === 'block' && c.enabled);
    if (block) {
      const actor = block.actors.find((a) => a.enabled);
      const t = await sv.legalTargets({ choice: 'block', param: 'blockTarget', actor: actor.playerId });
      if (t.values.length) {
        const input = { ...block.skeleton, playerId: actor.playerId, blockTarget: t.values[0].value };
        const v = await sv.validate(input);
        if (v.legal) return { input, why: 'Block ' + t.values[0].value + ' (engine-legal).', coachContext: { turnsPlayed: memory.turnsPlayed + 1 } };
      }
    }
    return { endTurn: true, why: 'Nothing legal worth doing.', coachContext: { turnsPlayed: memory.turnsPlayed + 1 } };
  },
  ruleDecisions(obs, request) {
    return { optionId: request.options[0].id, why: 'First option (example).' };
  },
});
