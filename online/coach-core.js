// Installed Bloodboard online coach (generated). Provider-neutral: the provider and model are fixed by the generated config.
// This file holds NO provider key and NO OAuth token. The only secret it carries is the local pairing capability for the
// bridge on this computer (loopback only); regenerate the coach to rotate it. Do not share this file.
const ONLINE = __BRIDGE_CONFIG__;
const TOOL_NAMES = new Set(['legalChoices', 'legalTargets', 'reachable', 'candidates', 'plan', 'explore', 'evaluate', 'threats.blitz', 'threats.scoring', 'validate', 'playerDestinations', 'spatialMask']);
const MAX_ROUNDS = 6, MAX_QUERIES = 4, MAX_CORRECTIONS = 3;
__CHECK_COMMAND__
let sequence = 0;

function clampQuery(c) {
  // Bound what a model may ask the engine for; the host enforces its own limits as well.
  if (c.service === 'candidates') c.args = [{ ...c.args[0], limit: Math.min(32, Number(c.args[0] && c.args[0].limit) || 16), maxMs: 2000 }];
  if (c.service === 'explore') c.args = [c.args[0], { ...c.args[1], maxMs: 2000, maxLeaves: 1000, maxOutcomes: 6, observations: true }];
  if (c.service === 'playerDestinations') c.args = [{ ...c.args[0], pageSize: Math.min(64, Number(c.args[0] && c.args[0].pageSize) || 32) }];
  return c;
}

async function onlineDecision(observation, offeredCandidates, request, services) {
  const started = Date.now();
  const hostLimit = Number(observation && observation.timeLimitMs) || ONLINE.budgetMs;
  // ONE total budget for the whole decision (all rounds, retries and queries), never per call.
  const budget = Math.max(3000, Math.min(ONLINE.budgetMs, hostLimit) - 2500);
  const deadline = started + budget;
  const saved = observation && observation.coachContext;
  const prior = saved && saved.schema === 'online-coach/1' && saved.provider === ONLINE.provider && saved.model === ONLINE.model ? saved : null; // a switch of provider/model never reuses context
  const shown = Object.assign({}, observation); delete shown.coachContext; // the plan is passed separately, and only when it came from THIS provider and model
  const context = { observation: shown, offeredCandidates, request: request || null, persistentPlan: prior ? prior.plan : null };
  const messages = [{ role: 'user', content: JSON.stringify(context) }];
  const offeredIds = new Set((offeredCandidates || []).map((c) => c && c.id).filter((x) => typeof x === 'number'));
  let queries = 0, corrections = 0, cacheHit = 0, promptTokens = 0, modelCalls = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Online coach decision time exhausted (' + ONLINE.provider + ')');
    await services.progress({ stage: 'online-model', headline: ONLINE.label + ': response ' + (round + 1) + '; ' + queries + ' engine queries', evaluating: ['Public position, execution feedback and the continuing turn plan'] });
    const requestId = 'c' + Date.now().toString(36) + '-' + (++sequence);
    let response, data;
    try {
      response = await fetch(ONLINE.endpoint + '/decision', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ONLINE.capability },
        body: JSON.stringify({ provider: ONLINE.provider, model: ONLINE.model, messages, maxMs: remaining, requestId }),
        signal: AbortSignal.timeout(remaining + 1500),
      });
      data = await response.json();
    } catch (e) { throw new Error('Online bridge unreachable: ' + (e && e.name === 'TimeoutError' ? 'timed out' : 'connection failed')); }
    modelCalls++;
    if (!response.ok) throw new Error('Online ' + ONLINE.provider + ' unavailable: ' + ((data && data.error && (data.error.code || data.error)) || response.status));
    if (data.meta) { cacheHit += Number(data.meta.cacheHitTokens) || 0; promptTokens += Number(data.meta.promptTokens) || 0; }
    if (data.protocolError) {
      if (++corrections > MAX_CORRECTIONS) throw new Error('Online coach correction budget exhausted (protocol)');
      messages.push({ role: 'assistant', content: String(data.raw || '').slice(0, 8000) }, { role: 'user', content: 'Protocol rejected: ' + (data.protocolError.message || data.protocolError) + ' Return exactly one valid JSON command.' });
      continue;
    }
    const c = data.command;
    if (!c || !['act', 'rule', 'query'].includes(c.type)) throw new Error('Invalid bridge command');
    messages.push({ role: 'assistant', content: JSON.stringify(c) });
    if (c.type === 'query') {
      if (++queries > MAX_QUERIES) { messages.push({ role: 'user', content: 'Query allowance exhausted. Submit a legal act/rule command now.' }); continue; }
      let result;
      try {
        if (!TOOL_NAMES.has(c.service) || !Array.isArray(c.args) || c.args.length > 3) throw new Error('Unsupported service query');
        clampQuery(c);
        const parts = c.service.split('.');
        result = parts.length > 1 ? await services[parts[0]][parts[1]].apply(null, c.args) : await services[parts[0]].apply(null, c.args);
      } catch (e) { result = { ok: false, error: String(e && e.message) }; }
      messages.push({ role: 'user', content: JSON.stringify({ toolResult: result }) });
      continue;
    }
    const verdict = checkCommand(c, { revision: observation.revision, request: request || null, offeredIds: request ? null : offeredIds });
    let error = verdict.ok ? null : verdict.error;
    if (!error && verdict.kind === 'input') {
      const v = await services.validate(c.input);
      if (!v || !v.legal) error = 'The engine rejected that input: ' + JSON.stringify(v).slice(0, 600);
    }
    if (error) {
      if (++corrections > MAX_CORRECTIONS) throw new Error('Online coach correction budget exhausted (rejected: ' + error.slice(0, 120) + ')');
      messages.push({ role: 'user', content: 'Rejected before execution: ' + error + ' Choose a valid current command.' });
      continue;
    }
    const why = String(c.why || 'Online coach selected a legal action.').slice(0, 2000);
    const coachContext = { schema: 'online-coach/1', provider: ONLINE.provider, model: ONLINE.model, plan: String(c.plan || '').slice(0, 2000), lastRevision: observation.revision };
    const trace = { online: true, provider: ONLINE.provider, model: ONLINE.model, route: ONLINE.route, version: ONLINE.version, queries, rounds: round + 1, modelCalls, corrections, cacheHitTokens: cacheHit, promptTokens, elapsedMs: Date.now() - started };
    if (request) { await services.progress({ stage: 'rule-choice', headline: why }); return { optionId: c.optionId, why, coachContext, trace }; }
    return Object.assign(c.input ? { input: c.input } : { candidateId: c.candidateId }, { why, coachContext, trace });
  }
  throw new Error('Online coach protocol allowance exhausted');
}

bloodboard.register({
  id: ONLINE.id, name: ONLINE.label, version: ONLINE.version, apiVersion: 2, apiMinor: 0,
  description: ONLINE.label + ' (online coach via the local bridge). Start the Bloodboard online-coach bridge first. Actions and rule choices use the real engine; setup and kick-off use the built-in coach; connection failures are reported by the host and fall back visibly.',
  timeLimitMs: Math.min(120000, Math.max(60000, (Number(ONLINE.budgetMs) || 55000) + 5000)), contextSchema: 'online-coach/1',
  capabilities: { playTurn: true, ruleDecisions: true, persistentContext: true, controlledSimulation: true },
  chooseAction: (o, offered, s) => onlineDecision(o, offered, null, s),
  chooseDecision: (o, r, s) => onlineDecision(o, [], r, s),
});
