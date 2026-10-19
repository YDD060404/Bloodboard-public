/**
 * Capability discovery and JSON Schemas (V5.6). `capabilities()` is what a module (or the docs generator) reads to learn
 * what this host offers; `schemas()` are JSON Schema (draft 2020-12 subset) descriptions of the observation, candidate
 * record, responses, service results and the offline dataset records. Adding a service or an optional field never
 * changes `apiVersion`; see docs/AI_PLATFORM.md §Versioning.
 */
import { API_MINOR, API_VERSION, DEFAULT_LIMITS, PLATFORM_ID, type Limits } from './limits';
import { FAMILIES } from './candidates';
import { FEATURE_NAMES, FEATURE_SCHEMA_VERSION, TERM_NAMES } from './evaluation';
import { DEFAULT_BRANCH_TYPES } from './explore';
import { V2_SCHEMAS } from './schemas-v2';

export interface ServiceDoc {
  since: string;
  summary: string;
  args: string;
  returns: string;
  exact: string;
}

export const SERVICES: Record<string, ServiceDoc> = {
  plan: { since: '1.0', summary: 'The engine\'s preview of an input: legality, steps, exact probabilities.', args: '(input, from?)', returns: '{ ok, errors, steps, withTeamRerolls, withoutTeamRerolls }', exact: 'exact (engine enumeration)' },
  reachable: { since: '1.0', summary: 'Squares a player can reach this activation (plain steps), with Rushes needed.', args: '(playerId, from?)', returns: '[{ x, y, rushes }]', exact: 'exact' },
  explore: { since: '1.1', summary: 'Every outcome of an input, merged by resulting position, each with a key to continue from.', args: '(input, { from?, team?, perspective?, threshold?, maxLeaves?, maxOutcomes?, maxMs?, observations?, features?, decisions?, horizon? })', returns: '{ ok, value, pTurnover, pTouchdown, outcomes[{key,p,value,…}], rest, exact, unresolvedMass, decisionPolicy, applied }', exact: 'exact up to `threshold`/`maxLeaves`; the unexpanded mass is reported (`unresolvedMass`, `exact:false`, `approximation`)' },
  evaluate: { since: '1.1', summary: 'The built-in evaluation of a position (baseline) and, optionally, the feature vector.', args: '(from?, { perspective?, features?, horizon? })', returns: '{ value, terms, perspective, featureSchema, features? }', exact: 'n/a (heuristic value; features are exact position facts)' },
  candidates: { since: '2.0', summary: 'Legal candidate actions of the ACTIVE team in any position (root or explored key), filtered/paged, with exact probabilities.', args: '({ from?, team?, families?, players?, targets?, region?, maxRushes?, maxDodges?, minPSuccess?, maxPTurnover?, minPTouchdown?, limit?, offset?, maxPerFamily?, maxPerPlayer?, sort?, precision?, detail?, builtIn?, outcomeValue?, includeIllegal?, maxMs? })', returns: '{ ok, candidates[CandidateRecord], pool, total, truncated[], … }', exact: 'exact (engine enumeration) unless precision:"fast" (labelled `exact:false`) or "none" (legality only, no probabilities)' },
  'threats.tackleZones': { since: '2.0', summary: 'Current and projected (one movement) Tackle-Zone coverage per team.', args: '({ from?, team?, projected?, detail? })', returns: '{ teams: { A|B: { current[{x,y,n}], projected[{x,y,n}] } }, assumption }', exact: 'exact facts; projection ignores Dodge/Rush risk' },
  'threats.reach': { since: '2.0', summary: 'Reachable squares with the Rushes and Dodges of the safest route and its chance.', args: '({ from?, team?, players?, maxRushes?, maxDodges?, limit? })', returns: '{ players[{ playerId, squares[{x,y,steps,rushes,dodges,pSafe}] }] }', exact: 'exact route chance (skill re-rolls only)' },
  'threats.blitz': { since: '2.0', summary: 'Every legal Blitz of the active team on the requested targets with the engine\'s exact outcome.', args: '({ from?, team?, targets?, attackers?, squares?, precision?: "exact"|"fast", limit? })', returns: '{ blitzes[{attackerId,targetId,variants[{attackSquare,input,pTurnover,pTargetDown,pTargetCrowd,blockResult,block,…}]}], byTarget }', exact: 'exact' },
  'threats.scoring': { since: '2.0', summary: 'Direct scoring threats of the active team\'s ball carrier this Turn.', args: '({ from?, team?, players? })', returns: '{ threats[{playerId,to,rushes,dodges,pTouchdown,pTurnover,input}] }', exact: 'exact' },
  'threats.crowd': { since: '2.0', summary: 'Players a single Block could push into the crowd, and exact Block outcomes for attackers already in place.', args: '({ from?, team?, players?, victimTeam? })', returns: '{ exposed[…], blocks[{attackerId,targetId,pTargetCrowd,…}], notComputed[] }', exact: 'exact; chain pushes are not computed (listed)' },
  sequence: { since: '2.0', summary: 'Exact evaluation of a sequence of actions by the active team (every step explored in every likely branch).', args: '({ steps[input], from?, team?, perspective?, maxBranches?, decisions?, … })', returns: '{ value, pTurnover, pTouchdown, finals[{key,p,value}], steps[…], exact, … }', exact: 'exact over the followed branches; mass left unfollowed is valued where it stands and reported' },
  features: { since: '2.0', summary: 'The stable feature vector of a position from a team\'s perspective.', args: '(from?, { perspective? })', returns: '{ schema, names, values, terms }', exact: 'exact position facts' },
  capabilities: { since: '2.0', summary: 'This document: services, limits, schemas, versions.', args: '()', returns: '{ platform, apiVersion, apiMinor, services, limits, … }', exact: 'n/a' },
  schema: { since: '2.0', summary: 'JSON Schema of a named type.', args: '(name?)', returns: 'schema object, or the list of names', exact: 'n/a' },
  progress: { since: '2.0', summary: 'Publish a short, factual progress note for the person watching a long decision (shown in the match interface).', args: '({ stage?, headline, evaluating?: string[], ruledOut?: string[], best?: { label, detail?, pTurnover?, pTouchdown?, value? }, fraction? })', returns: '{ ok, accepted }', exact: 'n/a (display only: never affects the decision; rate-limited, size-capped)' },
  batch: { since: '2.1', summary: 'Run several independent service calls together. With the engine pool they run in parallel (bounded by the pool size and the request budgets); without it, one after the other. Each item is answered exactly as if it had been called alone; one item failing does not affect the others. Calls that depend on each other must be made one after the other.', args: '([{ service, args: [...] }, …])', returns: '{ ok, parallel, count, results[ each item\'s own result or { ok:false, … } ] } in call order', exact: 'as each service' },
  diagnostics: { since: '2.0', summary: 'The diagnostics of this request so far (limits hit, truncations, stale keys …) and the usage counters.', args: '()', returns: '{ diagnostics[], usage, limitsLeft }', exact: 'n/a' },
};

export function capabilities(limits: Limits = DEFAULT_LIMITS): Record<string, unknown> {
  return {
    platform: PLATFORM_ID,
    apiVersion: API_VERSION,
    apiMinor: API_MINOR,
    register: 'bloodboard.register({ id, name, apiVersion: 1, apiMinor?: 0|1|2, requires?: [serviceName…], version, description, timeLimitMs, chooseAction, chooseDecision? })',
    services: Object.fromEntries(Object.entries(SERVICES).map(([k, v]) => [k, v])),
    responses: {
      action: ['{ candidateId: number }', '{ candidateId: "<request>.c<n>" }', '{ input, why }', '{ endTurn: true, why }', '{ ranking: [{ candidateId, score | logit }], why }'],
      decision: ['"optionId"', '{ optionId, why } (apiMinor>=2)', '{ ranking: [{ optionId, score | logit }], why } (apiMinor>=2)'],
    },
    candidateFamilies: {
      generated: FAMILIES,
      notGenerated: ['Multiple Block, Bomb throws, Chainsaw and Bombardier star actions (propose them with `input` and check with `plan`); of the special actions only Projectile Vomit is generated', 'Hail Mary passes and Jumps over a player (propose with `input`)'],
    },
    decisionPolicies: {
      default: 'builtin',
      values: ['builtin', 'adversarial', 'optimistic', '{ own: "builtin"|"best"|"worst", opponent: "builtin"|"best"|"worst", branchTypes?: string[] }'],
      branchTypes: DEFAULT_BRANCH_TYPES,
      note: 'Every explore/sequence result states the policy used in `decisionPolicy`. "builtin" resolves in-action decisions (Block die, re-roll, push square, Follow-up …) with the engine\'s fixed policy and lists its assumptions; the other values enumerate them as branches and solve them (expectimax).',
    },
    features: { schema: FEATURE_SCHEMA_VERSION, names: FEATURE_NAMES, terms: TERM_NAMES },
    limits,
    exactness: 'Match-time probabilities are the engine\'s exact enumeration. Where mass is left unexpanded (threshold, maxLeaves, maxMs) the result says `exact:false` with `unresolvedMass`; nothing is sampled.',
    isolation: 'The module runs in its own worker, reads copies, and never receives a game state, the dice generator, its seed or counter, or any future die. Position keys are request-scoped.',
    fallback: 'A thrown error, a timeout, a stale or invalid answer falls back to the built-in coach; the reason is recorded in the move\'s diagnostics.',
  };
}

// ───────────────────────────────────────────────────────────── JSON Schemas
const num = { type: 'number' };
const int = { type: 'integer' };
const str = { type: 'string' };
const bool = { type: 'boolean' };
const team = { enum: ['A', 'B'] };
const coord = { type: 'object', required: ['x', 'y'], properties: { x: int, y: int } };
const obj = (required: string[], properties: Record<string, unknown>, additional = true) => ({ type: 'object', required, properties, additionalProperties: additional });
const arr = (items: unknown) => ({ type: 'array', items });
const nullable = (s: Record<string, unknown>) => ({ anyOf: [s, { type: 'null' }] });

const actionInput = { type: 'object', required: ['kind'], properties: { kind: { enum: ['playerAction', 'endActivation', 'endTurn'] } } };

export function schemas(): Record<string, unknown> {
  const player = obj(['id', 'team', 'location', 'stance', 'ma', 'st', 'ag', 'pa', 'av'], { id: str, team, name: str, position: str, location: str, stance: str, pos: nullable(coord), ma: int, st: int, ag: int, pa: nullable(int), av: int, skills: arr(str), activated: bool });
  const observation = obj(['apiMinor', 'team', 'players', 'ball', 'score', 'turn', 'turnsPerHalf', 'half', 'weather', 'phase', 'rerolls', 'requestId', 'active', 'pending'], {
    apiMinor: int, requestId: int, team, format: str, pitch: obj(['w', 'h'], { w: int, h: int }), players: arr(player), ball: obj(['kind'], { kind: { enum: ['held', 'ground', 'none', 'inAir'] } }),
    score: obj(['A', 'B'], { A: int, B: int }), turn: obj(['A', 'B'], { A: int, B: int }), turnsPerHalf: int, half: int, weather: str, phase: str, rerolls: obj(['A', 'B'], { A: int, B: int }),
    active: team, pending: nullable(obj(['requestId', 'type', 'team', 'options'], { requestId: str, type: str, team, prompt: str, options: arr(obj(['id'], { id: str, label: str })), context: {} })), activation: nullable(obj(['playerId'], { playerId: str })),
  });
  const candidate = obj(['id', 'position', 'team', 'family', 'kind', 'label', 'legal', 'input'], {
    id: str, position: str, team, family: { enum: [...FAMILIES] }, kind: str, actorId: nullable(str), targetId: nullable(str), targetIds: arr(str), label: str, input: nullable(actionInput), path: arr(obj(['x', 'y', 'kind'], { x: int, y: int, kind: str })),
    destination: nullable(coord), legal: bool, errors: arr(str), rushes: nullable(int), dodges: nullable(int), exact: nullable(bool), pSuccess: nullable(num), pTurnover: nullable(num), pTouchdown: nullable(num), pOpponentTouchdown: nullable(num), unresolved: nullable(num), builtIn: {},
  });
  const diagnostic = obj(['seq', 'tMs', 'service', 'code', 'severity', 'message'], { seq: int, tMs: num, service: str, code: str, severity: { enum: ['info', 'warn', 'error'] }, message: str, limit: str, max: num, value: num });
  const failure = obj(['ok', 'code', 'message', 'errors'], { ok: { const: false }, code: str, message: str, errors: arr(str) });
  const exploreResult = obj(['ok'], { ok: bool, value: num, pTurnover: num, pTouchdown: num, pOpponentTouchdown: num, pCompleted: num, enumerated: int, leaves: int, outcomes: arr(obj(['p', 'value', 'turnover', 'completed'], { key: nullable(str), p: num, value: num, turnover: bool, touchdown: nullable(team), completed: bool })), rest: obj(['p', 'value'], { p: num, value: num }), perspective: team, activeTeam: team, position: obj(['key'], { key: str, depth: int }), exact: bool, unresolvedMass: num, approximation: nullable(str), decisionPolicy: obj(['mode', 'statement'], { mode: str, statement: str }), applied: {} });
  const actionResponse = { anyOf: [obj(['candidateId'], { candidateId: { anyOf: [int, str] }, why: str }), obj(['input'], { input: actionInput, why: str }), obj(['endTurn'], { endTurn: { const: true }, why: str }), obj(['ranking'], { ranking: arr(obj(['candidateId'], { candidateId: { anyOf: [int, str] }, score: num, logit: num })), why: str })] };
  const decisionResponse = { anyOf: [str, obj(['optionId'], { optionId: str, why: str }), obj(['ranking'], { ranking: arr(obj(['optionId'], { optionId: str, score: num, logit: num })), why: str })] };
  const trajectoryStep = obj(['schema', 'game', 'step', 'team', 'kind'], {
    schema: { const: 'bloodboard-trajectory/1' }, game: str, step: int, team, kind: { enum: ['action', 'decision'] }, observation: observation, candidates: arr(candidate), selected: {}, source: obj(['coach', 'via'], { coach: str, via: str, fellBack: bool }), why: nullable(str), features: { type: 'object' }, builtInValue: nullable(num), diagnostics: arr(diagnostic), outcome: {},
  });
  return { observation, candidate, diagnostic, failure, exploreResult, actionResponse, decisionResponse, trajectoryStep, ...V2_SCHEMAS };
}

export function schemaNamed(name?: unknown): unknown {
  const all = schemas();
  if (name === undefined || name === null || name === '') return { names: Object.keys(all) };
  const s = all[String(name)];
  return s ?? { ok: false, errors: [`Unknown schema "${String(name)}" (names: ${Object.keys(all).join(', ')}).`] };
}
