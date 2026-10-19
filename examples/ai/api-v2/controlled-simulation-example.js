// Bloodboard AI API v2 — coach-controlled simulation (fork.open / fork.step / fork.close).
// A fork walks ONE action node by node: Chance nodes (dice, with exact probabilities), Decision nodes (the coach picks), and a
// Terminal node whose position key works with evaluate / legalChoices / candidates. Joint probabilities are kept by the host.
// This coach estimates the chance that a Block ends in a Turnover by exploring the tree itself, choosing every decision with
// the rule it prefers (here: the engine's documented default), and blocks only when the risk is under 20 %.
// Mass it does not expand is treated as the worst case, never as zero.
bloodboard.register({
  id: 'controlled-sim-v2',
  name: 'Controlled Simulation v2',
  apiVersion: 2,
  apiMinor: 0,
  version: '1.0',
  description: 'API v2 example: explores a Block with fork.* and decides on its own risk estimate.',
  timeLimitMs: 15000,
  capabilities: { playTurn: true, ruleDecisions: true, controlledSimulation: true },
  async playTurn(obs, _c, sv) {
    const lc = await sv.legalChoices();
    const block = lc.choices.find((c) => c.type === 'block' && c.enabled);
    if (!block) return { endTurn: true, why: 'No Block available.' };
    const actor = block.actors.find((a) => a.enabled).playerId;
    const targets = (await sv.legalTargets({ choice: 'block', param: 'blockTarget', actor })).values;
    let best = null;
    for (const t of targets) {
      const input = { ...block.skeleton, playerId: actor, blockTarget: t.value };
      const open = await sv.fork.open({ input });
      if (!open.ok) continue;
      let turnover = 0, mass = 0, cut = 0, nodes = 0;
      // Depth-first walk with child handles: step({ copy: true }) leaves the node's handle in place so every sibling can be taken.
      const walk = async (node, handle, p) => {
        if (nodes++ > 300) { cut += p; return; }
        if (node.node === 'terminal') { mass += p; if (node.turnover) turnover += p; return; }
        if (p < 2e-3) { cut += p; return; }          // not expanded: reported as `unexplored`, never counted as zero
        const picks = node.node === 'decision' ? [node.defaultBranch] : node.branches.map((b) => b.index);
        for (const i of picks) {
          const child = await sv.fork.step({ fork: handle, branch: i, copy: true });
          if (!child.ok) { cut += p; continue; }
          await walk(child, child.fork, p * (node.node === 'chance' ? node.branches[i].p : 1));
          await sv.fork.close({ fork: child.fork });
        }
      };
      await walk(open, open.fork, 1);
      await sv.fork.close({ fork: open.fork });
      const risk = mass + cut > 0 ? (turnover + cut) / (mass + cut) : 1;   // unexplored mass is treated as the worst case
      if (!best || risk < best.risk) best = { input, risk, label: t.value };
    }
    if (best && best.risk < 0.2) return { input: best.input, why: 'Block ' + best.label + ': Turnover (unexplored mass counted against it) ' + Math.round(best.risk * 100) + ' %.' };
    return { endTurn: true, why: 'Every Block looked too risky.' };
  },
  ruleDecisions(obs, req) { return { optionId: req.options[0].id, why: 'First option (example).' }; },
});
