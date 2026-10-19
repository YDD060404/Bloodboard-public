// Deterministic fixture coach for the V5.8 host extensions (used by BOTH end-to-end checks: the game UI flow and the Match Lab run).
//  - set-up hook: mirrors the host's default formation top-to-bottom (always legal, always different from the default)
//  - every action request: ends the Turn (so a match always finishes quickly and identically)
//  - the very first action request of side A thinks for 7.5 s (> the former 6 s runner/test timeout) while reporting progress
//  - coach context: a per-side counter, the side and format it saw, and whether the slow decision already happened.
//    If a coach ever sees the other side's context it throws (the host then falls back and the test fails).
//  - `why` records what the module actually received (capabilities, Wizard resource) so the decision log proves it.
bloodboard.register({
  id: 'host-fixture', name: 'Host Fixture', version: '1.0', apiVersion: 1, apiMinor: 2, timeLimitMs: 60000,
  description: 'Test coach: mirrored set-up, ends every Turn, remembers a counter; side A thinks 7.5 s once.',
  chooseSetup(o, r) {
    const cc = o.coachContext || {};
    if (cc.team && cc.team !== o.team) throw new Error('LEAK: context of ' + cc.team + ' seen by ' + o.team);
    const m = {};
    for (const [id, c] of Object.entries(r.defaultPositions)) m[id] = c ? { x: c.x, y: r.pitch.h - 1 - c.y } : null;
    return { positions: m, why: 'fixture set-up n=' + ((cc.n || 0) + 1) + ' los=' + r.lineOfScrimmage + ' maxWide=' + r.maxWide + ' minLine=' + r.minLine + ' fielded=' + r.fieldedIds.length + ' hx=' + JSON.stringify(o.hostExtensions || null), coachContext: { n: (cc.n || 0) + 1, team: o.team, format: o.format, slowDone: !!cc.slowDone } };
  },
  async chooseAction(o, c, sv) {
    const cc = o.coachContext || {};
    if (cc.team && cc.team !== o.team) throw new Error('LEAK: context of ' + cc.team + ' seen by ' + o.team);
    if (o.team === 'A' && !cc.slowDone) {
      await sv.progress({ stage: 'think', headline: 'Fixture: a slow, legitimate calculation (7.5 s).', evaluating: [c[0] ? c[0].label : 'end turn'] });
      await new Promise((res) => setTimeout(res, 3500));
      await sv.progress({ stage: 'think', headline: 'Fixture: still calculating.', best: { label: 'End the Turn', pTurnover: 0 } });
      await new Promise((res) => setTimeout(res, 4000));
    }
    return { endTurn: true, why: 'fixture action n=' + ((cc.n || 0) + 1) + ' hx=' + JSON.stringify(o.hostExtensions || null) + ' wiz=' + JSON.stringify((o.strategicPublic && o.strategicPublic.wizardAvailable) || null), coachContext: { n: (cc.n || 0) + 1, team: o.team, format: o.format, slowDone: true } };
  },
  chooseDecision(o, req) {
    const cc = o.coachContext || {};
    if (cc.team && cc.team !== o.team) throw new Error('LEAK');
    return { optionId: req.options[0].id, why: 'fixture decision n=' + ((cc.n || 0) + 1), coachContext: { n: (cc.n || 0) + 1, team: o.team, format: o.format, slowDone: !!cc.slowDone } };
  },
});
