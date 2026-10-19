// Bloodboard AI API v2 — the pre-match lifecycle: chooseRoster, buildTeam, a free choice of fielded players, kick placement.
// Every answer is validated by the engine. buildTeam receives the engine's structured violations on a rejected attempt
// (up to 3 attempts) and may correct; if it cannot, the built-in builder drafts the team and the match record says so.
bloodboard.register({
  id: 'team-builder-v2',
  name: 'Team Builder v2',
  apiVersion: 2,
  apiMinor: 0,
  version: '1.0',
  description: 'API v2 example: roster choice, team building with correction, fielded players, kick placement.',
  timeLimitMs: 5000,
  capabilities: { chooseRoster: true, buildTeam: true, chooseSetup: true, chooseKick: true, playTurn: true },
  chooseRoster(obs, req) {
    // Sequential mode: avoid mirroring the opponent when another draftable roster exists.
    const ok = req.rosters.filter((r) => r.draftable && r.id !== req.opponentRoster);
    const pick = ok.find((r) => r.id === 'lizardmen') || ok[0];
    return { rosterId: pick.id, why: 'Lizardmen if possible, else the first draftable roster.' };
  },
  buildTeam(obs, req) {
    // Start from the built-in reference team and drop one lineman to buy a re-roll when there is room; if the engine
    // rejects it, req.previousViolations says why and the next attempt simply returns the reference unchanged.
    const team = JSON.parse(JSON.stringify(req.builtinTeam));
    if (!req.previousViolations) team.rerolls += 1; // may break the budget → rejected with a structured violation
    return { team, why: req.previousViolations ? 'Corrected: the reference team.' : 'Reference team plus one extra re-roll.' };
  },
  chooseSetup(obs, req) {
    // Free fielding: the lowest-numbered players that fit, placed with the host's default formation order.
    const take = req.fielding.candidates.slice().sort((a, b) => a.number - b.number).slice(0, req.fielding.count).map((c) => c.id);
    const slots = Object.values(req.defaultPositions).filter(Boolean);
    const positions = {};
    take.forEach((id, i) => { positions[id] = slots[i]; });
    return { positions, why: 'Fielded the lowest numbers.' };
  },
  chooseKick(obs, req) {
    const k = req.kickerCandidates.find((c) => c.hasKick) || req.kickerCandidates[0];
    const mid = req.legalSquares[Math.floor(req.legalSquares.length / 2)];
    return { kicker: k.id, target: mid, useKick: k.hasKick, why: 'Middle of the receiving half.' };
  },
  playTurn() { return { endTurn: true, why: 'Example only.' }; },
});
