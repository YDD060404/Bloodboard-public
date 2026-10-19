/**
 * AI API v2 — generic legal-choice discovery.
 *
 * `legalChoices` answers "what may this team do now?" from the ENGINE's own legality (actionOptions, validateInput,
 * reachableSquares, matchInputReason), never from a list of candidates: candidates are a shortcut and are not the
 * definition of legal. Every choice type is described by a registry entry (parameters, what is queried, cost, timing,
 * continuation). A future action is added by registering one entry (docs/AI_API_V2.md §"Registering a mechanic"); the
 * host, the validation, the controlled simulation, the receipts and Replay need no mechanic-specific code.
 *
 * Parameters are discovered lazily and in pages: `legalTargets` probes the engine's validation for each value of one
 * parameter (a player, or a square), reporting why a value is not legal. Coverage is always reported.
 */
import type { ActionInput, Coord, GameState, Player, PlayerActionInput, TeamId } from '../engine/index';
import { E } from '../ai/engine';
import { buildSetupRequest } from './hostext';

export const CHOICES_SCHEMA = 'bloodboard-legal-choices/1';

export type ParamKind = 'player' | 'square' | 'path' | 'flag' | 'enum';
export interface ParamDef {
  /** Field of the input (PlayerActionInput) the value goes into. */
  name: string;
  kind: ParamKind;
  required: boolean;
  /** player: whose players are offered ('opponent' | 'teammate' | 'any'). */
  domain?: 'opponent' | 'teammate' | 'any';
  /** enum: the values. */
  values?: string[];
  note?: string;
}

/** The registry: one entry per declarable mechanic. This is the ONLY place a mechanic's parameters are described. */
export interface MechanicDef {
  id: string;
  action: PlayerActionInput['action'];
  special?: string;
  params: ParamDef[];
  /** When the Action may also carry a movement path before its effect. */
  moves: boolean;
  timing: string;
  cost: string;
  continues: string;
}

const P = (name: string, domain: ParamDef['domain'], required = true, note?: string): ParamDef => ({ name, kind: 'player', domain, required, note });
const SQ = (name: string, required = true, note?: string): ParamDef => ({ name, kind: 'square', required, note });
const PATH: ParamDef = { name: 'path', kind: 'path', required: false };
const FLAG = (name: string): ParamDef => ({ name, kind: 'flag', required: false });
const FACING: ParamDef = { name: 'facing', kind: 'enum', required: true, values: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] };

export const MECHANICS: MechanicDef[] = [
  { id: 'move', action: 'move', params: [PATH, FLAG('leaveBall')], moves: true, timing: 'Declared by an unactivated player of the active team.', cost: 'Uses the player\'s activation; Move Allowance + Rushes.', continues: 'The activation stays open until endActivation or the player cannot continue.' },
  { id: 'block', action: 'block', params: [P('blockTarget', 'opponent'), P('blockTarget2', 'opponent', false, 'Only with Multiple Block.'), FLAG('jumpUpBlock')], moves: false, timing: 'As above.', cost: 'Uses the activation.', continues: 'Ends the activation after the Block.' },
  { id: 'blitz', action: 'blitz', params: [P('blitzTarget', 'opponent'), PATH, P('blockTarget', 'opponent', false)], moves: true, timing: 'Once per Turn.', cost: 'Uses the Turn\'s Blitz; one square of movement for the Block.', continues: 'Segments: declare with the target, move, then block.' },
  { id: 'pass', action: 'pass', params: [SQ('passTarget'), PATH, FLAG('hailMary')], moves: true, timing: 'Once per Turn.', cost: 'Uses the Turn\'s Pass.', continues: 'Ends the activation after the throw.' },
  { id: 'handoff', action: 'handoff', params: [P('handoffTarget', 'teammate'), PATH], moves: true, timing: 'Once per Turn.', cost: 'Uses the Turn\'s Hand-off.', continues: 'Ends the activation after the hand-off.' },
  { id: 'secure', action: 'secure', params: [PATH], moves: true, timing: 'Once per Turn.', cost: 'Uses the Turn\'s Secure the Ball.', continues: 'The move must end on the ball.' },
  { id: 'foul', action: 'foul', params: [P('foulTarget', 'opponent'), PATH, FLAG('useChainsaw')], moves: true, timing: 'Once per Turn.', cost: 'Uses the Turn\'s Foul.', continues: 'Ends the activation; the referee may send the player off.' },
  { id: 'ttm', action: 'ttm', params: [P('thrownPlayerId', 'teammate'), SQ('throwTarget'), PATH], moves: true, timing: 'Once per Turn.', cost: 'Uses the Turn\'s Throw Team-mate.', continues: 'Ends the activation.' },
  { id: 'special:projectileVomit', action: 'special', special: 'projectileVomit', params: [P('specialTarget', 'opponent')], moves: false, timing: 'Once per Turn.', cost: 'Uses the activation.', continues: 'Ends the activation.' },
  { id: 'special:stab', action: 'special', special: 'stab', params: [P('specialTarget', 'opponent')], moves: false, timing: 'Replaces a Block.', cost: 'Uses the activation.', continues: 'Ends the activation.' },
  { id: 'special:chainsaw', action: 'special', special: 'chainsaw', params: [P('specialTarget', 'opponent')], moves: false, timing: 'Replaces a Block.', cost: 'Uses the activation.', continues: 'Ends the activation.' },
  { id: 'special:breatheFire', action: 'special', special: 'breatheFire', params: [P('specialTarget', 'opponent')], moves: false, timing: 'Replaces a Block.', cost: 'Uses the activation.', continues: 'Ends the activation.' },
  { id: 'special:monstrousMouth', action: 'special', special: 'monstrousMouth', params: [P('specialTarget', 'opponent')], moves: false, timing: 'Replaces a Block.', cost: 'Uses the activation.', continues: 'Ends the activation.' },
  { id: 'special:hypnoticGaze', action: 'special', special: 'hypnoticGaze', params: [P('specialTarget', 'opponent'), PATH], moves: true, timing: 'After moving.', cost: 'Uses the activation.', continues: 'Ends the activation.' },
  { id: 'special:bombardier', action: 'special', special: 'bombardier', params: [SQ('bombTarget')], moves: false, timing: 'Once per Turn.', cost: 'Uses the Turn\'s Throw Bomb.', continues: 'Ends the activation.' },
  { id: 'special:punt', action: 'special', special: 'punt', params: [FACING, PATH], moves: true, timing: 'Once per Turn.', cost: 'Uses the Turn\'s Punt.', continues: 'Ends the activation.' },
  { id: 'special:kickTeamMate', action: 'special', special: 'kickTeamMate', params: [P('thrownPlayerId', 'teammate'), SQ('throwTarget')], moves: false, timing: 'Once per Turn.', cost: 'Uses the Turn\'s Kick Team-mate.', continues: 'Ends the activation.' },
  { id: 'special:ballAndChain', action: 'special', special: 'ballAndChain', params: [FACING], moves: false, timing: 'The only Action of a Ball & Chain player.', cost: 'Uses the activation.', continues: 'The player keeps moving until the chain ends.' },
];

const BY_ID = new Map(MECHANICS.map((m) => [m.id, m]));
export const mechanicOf = (action: string, special?: string): MechanicDef | undefined => BY_ID.get(special ? `special:${special}` : action);

export interface ChoiceActor {
  playerId: string;
  enabled: boolean;
  reason?: string;
}

export interface LegalChoice {
  /** Stable choice-type id: `move`, `block`, `special:stab`, `endTurn`, `decision`, `setupTeam`, `kickoff`, … */
  type: string;
  owner: TeamId;
  label: string;
  /** Who may take it (players), with why not when disabled. Empty for team-level choices. */
  actors: ChoiceActor[];
  /** The input skeleton: fill the parameters and submit the result as an input (or, for a decision, `{ optionId }`). */
  skeleton: Record<string, unknown>;
  params: ParamDef[];
  /** How to enumerate each parameter's legal values (call `legalTargets`). */
  targetQueries: Array<{ param: string; service: 'legalTargets'; args: { actor?: string; choice: string; param: string } }>;
  path?: { allowed: boolean; budget?: { maLeft: number; rushesLeft: number } };
  cost?: string;
  timing: string;
  continuation: string;
  enabled: boolean;
  reason?: string;
  /** Decision choices only. */
  options?: Array<{ id: string; label: string; detail?: string }>;
}

export interface LegalChoices {
  ok: true;
  schema: typeof CHOICES_SCHEMA;
  /** Whose move it is and what kind of node the position is. */
  node: 'action' | 'decision' | 'setup' | 'transition' | 'terminal';
  owner: TeamId | null;
  phase: string;
  choices: LegalChoice[];
  coverage: { complete: boolean; derivedFrom: string; notes: string[] };
}

const baseSkeleton = (m: MechanicDef, actor: string): Record<string, unknown> => ({ kind: 'playerAction', playerId: actor, action: m.action, ...(m.special ? { special: m.special } : {}), path: [] });

function choiceFor(m: MechanicDef, owner: TeamId, actors: ChoiceActor[], label: string): LegalChoice {
  const enabled = actors.some((a) => a.enabled);
  return {
    type: m.id,
    owner,
    label,
    actors,
    skeleton: baseSkeleton(m, actors.find((a) => a.enabled)?.playerId ?? actors[0]?.playerId ?? '<playerId>'),
    params: m.params,
    targetQueries: m.params.filter((p) => p.kind === 'player' || p.kind === 'square').map((p) => ({ param: p.name, service: 'legalTargets' as const, args: { choice: m.id, param: p.name } })),
    path: { allowed: m.moves },
    cost: m.cost,
    timing: m.timing,
    continuation: m.continues,
    enabled,
    reason: enabled ? undefined : actors[0]?.reason,
  };
}

/** The legal choice TYPES of the position for `team` (parameters are discovered lazily with `legalTargets`). */
export function legalChoices(s: GameState, team: TeamId): LegalChoices {
  E.usePitch(s);
  const out: LegalChoice[] = [];
  const notes: string[] = [];
  const mk = (node: LegalChoices['node'], owner: TeamId | null, complete = true): LegalChoices => ({ ok: true, schema: CHOICES_SCHEMA, node, owner, phase: s.phase, choices: out, coverage: { complete, derivedFrom: 'engine legality (actionOptions, validateInput, matchInputReason) — not the candidate shortcut', notes } });
  if (s.phase === 'fullTime') return mk('terminal', null);
  if (s.pending) {
    const r = s.pending.request;
    out.push({ type: 'decision', owner: r.team, label: r.prompt, actors: [], skeleton: { requestId: r.id }, params: [{ name: 'optionId', kind: 'enum', required: true, values: r.options.map((o) => o.id) }], targetQueries: [], timing: 'A rule decision the game is waiting for.', continuation: 'The interrupted Action continues with the answer.', enabled: r.team === team, reason: r.team === team ? undefined : 'The other coach answers this decision.', options: r.options.map((o) => ({ id: o.id, label: o.label, detail: o.detail })) });
    return mk('decision', r.team);
  }
  if (s.phase === 'play') {
    const owner = s.turn.active;
    if (owner !== team) {
      notes.push('It is the other team\'s Turn.');
      return mk('transition', owner);
    }
    const byMech = new Map<string, { m: MechanicDef; actors: ChoiceActor[]; label: string }>();
    const players = s.players.filter((p) => p.team === team && p.location === 'pitch');
    for (const p of players) {
      for (const o of E.actionOptions(s, p)) {
        const m = mechanicOf(o.action, o.special);
        if (!m) {
          // An engine action that has no registry entry is reported, never hidden.
          notes.push(`Unregistered mechanic ${o.action}${o.special ? ':' + o.special : ''} (offered by the engine to ${p.id}).`);
          continue;
        }
        if (!byMech.has(m.id)) byMech.set(m.id, { m, actors: [], label: o.label });
        byMech.get(m.id)!.actors.push({ playerId: p.id, enabled: o.enabled && !o.unsupported, reason: o.enabled ? undefined : o.reason });
      }
    }
    // Registry order, so the list is stable.
    for (const m of MECHANICS) {
      const e = byMech.get(m.id);
      if (e) out.push(choiceFor(m, team, e.actors, e.label));
    }
    const act = s.turn.activation;
    if (act && !act.over) out.push({ type: 'endActivation', owner: team, label: 'End this activation', actors: [{ playerId: act.playerId, enabled: true }], skeleton: { kind: 'endActivation' }, params: [], targetQueries: [], timing: 'During an open activation.', continuation: 'The player is done for this Turn.', enabled: true });
    if (!act || act.over) {
      const forgoers = players.filter((p) => !p.activated && p.stance !== 'stunned');
      if (forgoers.length) out.push({ type: 'forgo', owner: team, label: 'Forgo an activation', actors: forgoers.map((p) => ({ playerId: p.id, enabled: true })), skeleton: { kind: 'forgo', playerId: forgoers[0].id }, params: [], targetQueries: [], timing: 'Between activations.', continuation: 'The player is marked as having used their activation.', enabled: true });
      out.push({ type: 'endTurn', owner: team, label: 'End the Turn', actors: [], skeleton: { kind: 'endTurn' }, params: [], targetQueries: [], timing: 'Between activations.', continuation: 'The other team\'s Turn begins.', enabled: true });
    }
    return mk('action', team);
  }
  if (s.phase === 'driveSetup') {
    const req = buildSetupRequest(s, team);
    out.push({ type: 'setupTeam', owner: team, label: 'Set up for the Drive', actors: [], skeleton: { kind: 'setupTeam', team, positions: req.defaultPositions }, params: [{ name: 'positions', kind: 'enum', required: true, note: `player id → square in your half or null (reserves); ${req.fieldedIds.length} fielded, ≥${req.minLine} on the line, ≤${req.maxWide} per wide zone` }], targetQueries: [], timing: 'Before each Drive.', continuation: 'The kick-off follows.', enabled: true });
    return mk('setup', team);
  }
  notes.push(`Phase "${s.phase}" has no coach choice offered by this service yet; the host advances it (pregame, kick-off, touchdown and half transitions).`);
  return mk('transition', null, false);
}

// ---------------------------------------------------------------------------------------------------------------------
// Lazy parameter queries
// ---------------------------------------------------------------------------------------------------------------------

export interface TargetQuery {
  choice: string;
  actor?: string;
  param: string;
  /** Values already chosen (e.g. a blitzTarget when asking for the path's end). */
  partial?: Record<string, unknown>;
  /** square: restrict to a rectangle. */
  region?: { x0: number; y0: number; x1: number; y1: number };
  offset?: number;
  limit?: number;
  includeIllegal?: boolean;
  deadline?: number;
}

export interface TargetResult {
  ok: true;
  choice: string;
  param: string;
  values: Array<{ value: string | Coord; legal: boolean; reason?: string }>;
  total: number;
  offset: number;
  /** true when every value of the domain was probed (otherwise `next` continues). */
  complete: boolean;
  next: number | null;
  coverage: string;
}

const reasonOf = (errs: string[]) => (errs.length ? errs[0] : 'not legal');

export function legalTargets(s: GameState, team: TeamId, q: TargetQuery): TargetResult | { ok: false; message: string } {
  E.usePitch(s);
  const m = BY_ID.get(q.choice);
  if (!m) return { ok: false, message: `Unknown choice type "${q.choice}" (see legalChoices).` };
  const def = m.params.find((p) => p.name === q.param);
  if (!def) return { ok: false, message: `${q.choice} has no parameter "${q.param}".` };
  const actor = q.actor ?? s.players.find((p) => p.team === team && p.location === 'pitch' && E.actionOptions(s, p).some((o) => mechanicOf(o.action, o.special)?.id === m.id && o.enabled))?.id;
  if (!actor) return { ok: false, message: 'No player can take this choice right now.' };
  const inputFor = (v: unknown): ActionInput => ({ ...(baseSkeleton(m, actor) as unknown as PlayerActionInput), ...(q.partial ?? {}), [q.param]: v } as ActionInput);
  const test = (v: unknown): { legal: boolean; reason?: string } => {
    const errs = E.validateInput(s, inputFor(v));
    return errs.length ? { legal: false, reason: reasonOf(errs) } : { legal: true };
  };
  const offset = q.offset ?? 0;
  const limit = Math.min(q.limit ?? 120, 600);
  let domain: Array<string | Coord> = [];
  if (def.kind === 'player') {
    const me = s.players.find((p) => p.id === actor) as Player;
    domain = s.players.filter((p) => p.location === 'pitch' && p.id !== actor && (def.domain === 'any' || (def.domain === 'teammate' ? p.team === me.team : p.team !== me.team))).map((p) => p.id);
  } else if (def.kind === 'square') {
    const g = E.rulesFor(s).pitch;
    const r = q.region ?? { x0: 0, y0: 0, x1: g.w - 1, y1: g.h - 1 };
    for (let x = Math.max(0, r.x0); x <= Math.min(g.w - 1, r.x1); x++) for (let y = Math.max(0, r.y0); y <= Math.min(g.h - 1, r.y1); y++) domain.push({ x, y });
  } else if (def.kind === 'enum') {
    domain = (def.values ?? []).slice();
  } else if (def.kind === 'flag') {
    domain = ['true'];
  } else {
    // path: the engine's reachable squares (each with the Rushes it needs) are the legal path ENDS from here.
    const reach = E.reachableSquares(s, actor, ((q.partial?.path as never) ?? []) as never);
    const vals = reach.slice(offset, offset + limit).map((r) => ({ value: { x: r.c.x, y: r.c.y }, legal: true, reason: r.rushes ? `${r.rushes} Rush(es), ${r.steps} step(s)` : `${r.steps} step(s)` }));
    return { ok: true, choice: m.id, param: q.param, values: vals, total: reach.length, offset, complete: offset + vals.length >= reach.length, next: offset + vals.length < reach.length ? offset + vals.length : null, coverage: 'Squares the player can reach by plain steps from here; Jump, Leap and Pogo moves are described by their own path steps (kind).' };
  }
  const vals: TargetResult['values'] = [];
  let i = offset;
  for (; i < domain.length && vals.length < limit; i++) {
    if (q.deadline && Date.now() > q.deadline) break;
    const v = domain[i];
    const r = def.kind === 'enum' || def.kind === 'flag' ? { legal: true } : test(v);
    if (r.legal || q.includeIllegal) vals.push({ value: v, ...r });
  }
  const complete = i >= domain.length;
  return { ok: true, choice: m.id, param: q.param, values: vals, total: domain.length, offset, complete, next: complete ? null : i, coverage: `Probed ${i - offset} of ${domain.length} values with the engine's own validation; ${complete ? 'complete' : 'continue with offset=next'}.` };
}

/** Validate one concrete input exactly as the engine will (used by `validate` and by hosts). */
export function validateChoice(s: GameState, input: ActionInput): { legal: boolean; errors: string[] } {
  E.usePitch(s);
  const errors = E.validateInput(s, input);
  return { legal: errors.length === 0, errors };
}
