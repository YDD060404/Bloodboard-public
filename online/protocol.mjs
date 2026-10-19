// Bloodboard online-coach wire protocol (provider neutral).
// A provider returns TEXT; this module turns it into exactly one command or a protocol error. Nothing here talks to a model.
//
// Commands (one JSON object per model response):
//   {"type":"query","service":S,"args":[...]}                          read-only engine service
//   {"type":"act","revision":R,"candidateId":N,"why":"…","plan":"…"}   offered candidate (a NUMBER)
//   {"type":"act","revision":R,"input":{…},"why":"…"}                  explicit engine input; End Turn is {"kind":"endTurn"}
//   {"type":"rule","revision":R,"optionId":"…","why":"…"}              answer to a pending rule decision

export const PROTOCOL_VERSION = 1;
export const MAX_RESPONSE_CHARS = 32000;
export const QUERY_SERVICES = Object.freeze([
  'legalChoices', 'legalTargets', 'reachable', 'candidates', 'plan', 'explore', 'evaluate',
  'threats.blitz', 'threats.scoring', 'validate',
  // V7 spatial contract (src/platform/spatial.ts)
  'playerDestinations', 'spatialMask',
]);
// Services whose single argument is an object (some models send {args:{…}} instead of {args:[{…}]}).
const OBJECT_ARG_SERVICES = new Set(['legalChoices', 'legalTargets', 'candidates', 'evaluate', 'threats.blitz', 'threats.scoring', 'playerDestinations', 'spatialMask']);

export class ProtocolError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/** Parse one model response. Throws ProtocolError. Accepts a ```json fence and one exact duplicate of a read-only query. */
export function parseCommand(text) {
  if (typeof text !== 'string' || !text.trim()) throw new ProtocolError('empty-response', 'The model returned no text.');
  if (text.length > MAX_RESPONSE_CHARS) throw new ProtocolError('response-too-large', 'The response is too large.');
  const raw = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let command, normalization = null;
  try { command = JSON.parse(raw); }
  catch (error) {
    // Observed: some responses repeat the SAME read-only query twice. Run it once. Different queries or repeated actions stay invalid.
    const half = raw.slice(0, raw.length / 2);
    if (raw.length % 2 || half !== raw.slice(raw.length / 2)) throw new ProtocolError('invalid-json', 'The response is not a single JSON object.');
    try { command = JSON.parse(half); } catch { throw new ProtocolError('invalid-json', 'The response is not a single JSON object.'); }
    if (command?.type !== 'query') throw new ProtocolError('invalid-json', 'Only a repeated read-only query is tolerated.');
    normalization = 'duplicate-read-only-query';
  }
  if (!command || typeof command !== 'object' || Array.isArray(command)) throw new ProtocolError('invalid-command', 'The response must be a JSON object.');
  delete command.protocolNormalization;
  if (!['query', 'act', 'rule'].includes(command.type)) throw new ProtocolError('invalid-command-type', 'type must be query, act or rule.');
  if (command.type === 'query') {
    if (typeof command.service !== 'string') throw new ProtocolError('invalid-query', 'A query needs a service name.');
    if (command.args && !Array.isArray(command.args) && typeof command.args === 'object' && OBJECT_ARG_SERVICES.has(command.service)) command.args = [command.args];
    if (command.args === undefined) command.args = [];
    if (!Array.isArray(command.args)) throw new ProtocolError('invalid-query', 'Query args must be an ARRAY.');
  } else if (typeof command.revision !== 'string') throw new ProtocolError('revision-required', 'Actions and rule choices need the current observation revision (a string).');
  if (normalization) command.protocolNormalization = normalization;
  return command;
}

// <<checkCommand
/**
 * Validate an act/rule command against what the host actually offered. Pure; the host's engine validation of an explicit `input`
 * is a separate (async) step done by the caller. Returns {ok:true, kind} or {ok:false, error}.
 *
 *  - candidateId must be a finite NUMBER that was offered. `null`, strings and missing values are rejected: an unusable ID must
 *    never be reinterpreted as "End Turn". End Turn needs an explicit, valid {"kind":"endTurn"} input.
 *  - during a rule decision only a `rule` command with an offered option id is acceptable.
 */
export function checkCommand(command, { revision, request, offeredIds }) {
  if (!command || command.type === 'query') return { ok: false, error: 'A query is not a decision.' };
  if (command.revision !== revision) return { ok: false, error: `Wrong observation revision (current: ${revision}).` };
  if (request) {
    if (command.type !== 'rule') return { ok: false, error: 'A rule decision is pending: return a "rule" command with an offered optionId.' };
    if (typeof command.optionId !== 'string' || !request.options.some((o) => o.id === command.optionId)) return { ok: false, error: 'optionId is not one of request.options[].id.' };
    return { ok: true, kind: 'rule' };
  }
  if (command.type !== 'act') return { ok: false, error: 'A normal turn needs an "act" command.' };
  const hasInput = command.input !== undefined && command.input !== null;
  const hasId = Object.prototype.hasOwnProperty.call(command, 'candidateId');
  if (hasInput && hasId && command.candidateId !== undefined && command.candidateId !== null) return { ok: false, error: 'Give candidateId OR input, not both.' };
  if (hasInput) {
    if (typeof command.input !== 'object' || Array.isArray(command.input) || typeof command.input.kind !== 'string') return { ok: false, error: 'input must be an engine input object with a "kind".' };
    return { ok: true, kind: 'input', explicitEndTurn: command.input.kind === 'endTurn' };
  }
  if (!hasId || command.candidateId === null || command.candidateId === undefined) return { ok: false, error: 'candidateId is missing or null. Choose an offered candidate NUMBER, or an explicit input such as {"kind":"endTurn"}. A missing ID is never End Turn.' };
  if (typeof command.candidateId !== 'number' || !Number.isFinite(command.candidateId)) return { ok: false, error: 'candidateId must be a NUMBER from offeredCandidates.' };
  if (offeredIds && !offeredIds.has(command.candidateId)) return { ok: false, error: 'candidateId was not offered in this decision.' };
  return { ok: true, kind: 'candidate' };
}

// checkCommand>>

export const MAX_ROUNDS = 6;
export const MAX_QUERIES = 4;
export const MAX_CORRECTIONS = 3;
