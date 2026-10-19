/**
 * The code that runs INSIDE the isolated worker before a module's own code: `bloodboard.register(...)`, the service
 * proxies (every call is a message to the host, which validates and answers) and the request loop. Identical in the app
 * (Web Worker) and in the headless host (worker_threads). The worker never receives a game state.
 */
import { API_MINOR, API_V2_MINOR, API_V2_VERSION, API_VERSION } from './limits';
import { SERVICE_NAMES } from './services';

export const HARNESS = `
"use strict";
let __coach = null;
let __rpcSeq = 1;
const __waiting = new Map();
const __names = ${JSON.stringify(SERVICE_NAMES)};
const bloodboard = {
  apiVersion: ${API_VERSION},
  apiMinor: ${API_MINOR},
  services: __names,
  api: { versions: [${API_VERSION}, ${API_V2_VERSION}], current: ${API_V2_VERSION}, minor: ${API_V2_MINOR} },
  register(def) { __coach = def; },
};
function __rpc(requestId, method, args) {
  const id = __rpcSeq++;
  return new Promise((resolve, reject) => { __waiting.set(id, { resolve, reject }); postMessage({ type: 'rpc', requestId, id, method, args }); });
}
const __services = (requestId) => {
  const s = {
    plan: (input, from) => __rpc(requestId, 'plan', [input, from]),
    reachable: (playerId, from) => __rpc(requestId, 'reachable', [playerId, from]),
    explore: (input, options) => __rpc(requestId, 'explore', [input, options || {}]),
    evaluate: (from, options) => __rpc(requestId, 'evaluate', [from, options]),
    candidates: (options) => __rpc(requestId, 'candidates', [options || {}]),
    sequence: (options) => __rpc(requestId, 'sequence', [options || {}]),
    features: (from, options) => __rpc(requestId, 'features', [from, options || {}]),
    capabilities: () => __rpc(requestId, 'capabilities', []),
    schema: (name) => __rpc(requestId, 'schema', [name]),
    diagnostics: () => __rpc(requestId, 'diagnostics', []),
    progress: (update) => __rpc(requestId, 'progress', [update]),
    legalChoices: (options) => __rpc(requestId, 'legalChoices', [options || {}]),
    legalTargets: (options) => __rpc(requestId, 'legalTargets', [options || {}]),
    playerDestinations: (options) => __rpc(requestId, 'playerDestinations', [options || {}]),
    spatialMask: (options) => __rpc(requestId, 'spatialMask', [options || {}]),
    validate: (input, options) => __rpc(requestId, 'validate', [input, options || {}]),
    fork: {
      open: (options) => __rpc(requestId, 'fork.open', [options || {}]),
      step: (options) => __rpc(requestId, 'fork.step', [options || {}]),
      close: (options) => __rpc(requestId, 'fork.close', [options || {}]),
    },
    threats: {
      tackleZones: (options) => __rpc(requestId, 'threats.tackleZones', [options || {}]),
      reach: (options) => __rpc(requestId, 'threats.reach', [options || {}]),
      blitz: (options) => __rpc(requestId, 'threats.blitz', [options || {}]),
      scoring: (options) => __rpc(requestId, 'threats.scoring', [options || {}]),
      crowd: (options) => __rpc(requestId, 'threats.crowd', [options || {}]),
    },
  };
  return s;
};
self.onmessage = async (ev) => {
  const m = ev.data || {};
  if (m.type === 'rpcResult') { const w = __waiting.get(m.id); if (w) { __waiting.delete(m.id); m.ok ? w.resolve(m.value) : w.reject(new Error(m.value)); } return; }
  if (m.type === 'hello') { postMessage({ type: 'hello', ok: !!__coach, meta: __coach ? { id: __coach.id, name: __coach.name, apiVersion: __coach.apiVersion, apiMinor: __coach.apiMinor, requires: __coach.requires, version: __coach.version, description: __coach.description, timeLimitMs: __coach.timeLimitMs, contextSchema: __coach.contextSchema, declaredCapabilities: __coach.capabilities && typeof __coach.capabilities === 'object' ? __coach.capabilities : undefined, requiresCapabilities: Array.isArray(__coach.requiresCapabilities) ? __coach.requiresCapabilities : undefined, hooks: { action: typeof __coach.chooseAction === 'function' || typeof __coach.playTurn === 'function', decision: typeof __coach.chooseDecision === 'function' || typeof __coach.ruleDecisions === 'function', setup: typeof __coach.chooseSetup === 'function', roster: typeof __coach.chooseRoster === 'function', build: typeof __coach.buildTeam === 'function', fielded: typeof __coach.chooseFieldedPlayers === 'function', kick: typeof __coach.chooseKick === 'function' } } : null }); return; }
  try {
    if (!__coach) throw new Error('The module did not call bloodboard.register({...}).');
    let result = null;
    if (m.type === 'action') result = typeof __coach.playTurn === 'function' ? await __coach.playTurn(m.observation, m.candidates, __services(m.requestId)) : __coach.chooseAction ? await __coach.chooseAction(m.observation, m.candidates, __services(m.requestId)) : null;
    else if (m.type === 'setup') result = __coach.chooseSetup ? await __coach.chooseSetup(m.observation, m.request, __services(m.requestId)) : null;
    else if (m.type === 'decision') result = __coach.chooseDecision ? await __coach.chooseDecision(m.observation, m.request, __services(m.requestId)) : __coach.ruleDecisions ? await __coach.ruleDecisions(m.observation, m.request, __services(m.requestId)) : null;
    else if (m.type === 'roster') result = __coach.chooseRoster ? await __coach.chooseRoster(m.observation, m.request, __services(m.requestId)) : null;
    else if (m.type === 'build') result = __coach.buildTeam ? await __coach.buildTeam(m.observation, m.request, __services(m.requestId)) : null;
    else if (m.type === 'fielded') result = __coach.chooseFieldedPlayers ? await __coach.chooseFieldedPlayers(m.observation, m.request, __services(m.requestId)) : null;
    else if (m.type === 'kick') result = __coach.chooseKick ? await __coach.chooseKick(m.observation, m.request, __services(m.requestId)) : null;
    postMessage({ type: 'result', requestId: m.requestId, result: result === undefined ? null : result });
  } catch (e) {
    postMessage({ type: 'result', requestId: m.requestId, error: String(e && e.message || e) });
  }
};
`;
