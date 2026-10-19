/**
 * V7 shared online / script / local-neural contract, spatial part.
 *
 *  - `playerDestinations`: for ONE player, every engine-legal destination with its real route and the engine's route
 *    probability (skill re-rolls only, as `threats.reach`), the explicit stay option, Pass / Hand-off targets, paging,
 *    completeness flags. Frame, rules version and position revision are part of every answer.
 *  - `spatialMask`: the same legality as a dense width x height boolean grid with provenance. Legality comes from the
 *    ENGINE (reachableSquares / validateInput); a mask is never built from a recording or from "new rules" for an old one.
 *  - `ActorFrame`: a named, versioned mapping between canonical engine coordinates and the frame a model was trained in.
 *    Canonical coordinates are never rewritten. Mapping is its own inverse and tested for both sides.
 *  - `resolveSpatialAdvice`: validates a model's heatmap against the request (stale revision, wrong player / frame /
 *    board, non-finite values, everything masked) and resolves it to ONE destination with a declared script. It records
 *    proposed, selected and (later) executed destinations separately.
 *  - Compute profiles: interactive, local batch and training sampling are separate declarations; a maximum is not a duration.
 *
 * Nothing here reads or reveals the dice generator, its seed or counter, or a future die.
 */
import type { ActionInput, Coord, GameState, Player, TeamId } from '../engine/index';
import { E } from '../ai/engine';
import { BUILD_FINGERPRINT } from '../engine/fingerprint';
import { legalTargets } from './choices';
import { revisionOf } from './observe';
import { fail, type ServiceFailure, type Session } from './session';

export const FRAME_SCHEMA = 'bloodboard-engine-frame/1';
export const DESTINATIONS_SCHEMA = 'bloodboard-player-destinations/1';
export const MASK_SCHEMA = 'bloodboard-spatial-mask/1';
export const ADVICE_REQUEST_SCHEMA = 'bloodboard-spatial-advice-request/1';
export const ADVICE_RESPONSE_SCHEMA = 'bloodboard-spatial-advice/1';
export const ADVICE_RECEIPT_SCHEMA = 'bloodboard-spatial-advice-receipt/1';

const o = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

// ───────────────────────────────────────────────────────────────────────── frames
export interface Frame {
  schema: typeof FRAME_SCHEMA;
  /** Canonical engine frame: x along the length (0..w-1), y across (0..h-1), origin at the top-left square, rows downwards. */
  w: number;
  h: number;
  format: 'standard' | 'sevens';
  /** Which End Zone column each side scores in (team A attacks toward increasing x). */
  attacks: { A: number; B: number };
}

export function frameOf(s: GameState): Frame {
  E.usePitch(s);
  const g = E.pitch();
  return { schema: FRAME_SCHEMA, w: g.w, h: g.h, format: s.variant === 'sevens' ? 'sevens' : 'standard', attacks: { A: g.w - 1, B: 0 } };
}

/**
 * A named mapping from canonical coordinates into the frame a network was trained in. `native` leaves coordinates alone.
 * `mirrorX` / `rotate180` make the acting side attack toward increasing x. Which of them (if any) a given checkpoint's
 * encoder uses must be taken from that encoder's source; `verifiedAgainst` stays null until that was done.
 */
export type FrameTransform = 'native' | 'mirrorX' | 'rotate180';
export interface ActorFrame {
  id: string;
  transform: FrameTransform;
  /** The acting side (the perspective the tensor is built from). */
  side: TeamId;
  w: number;
  h: number;
  /** Source the mapping was verified against (e.g. an encoder file hash). null = declared, not verified. */
  verifiedAgainst: string | null;
}

/** The transform that makes `side` attack toward increasing x (the engine already does for A). */
export function attackRightTransform(side: TeamId, rotate = false): FrameTransform {
  return side === 'A' ? 'native' : rotate ? 'rotate180' : 'mirrorX';
}

export function actorFrame(side: TeamId, frame: Pick<Frame, 'w' | 'h'>, transform: FrameTransform = attackRightTransform(side), verifiedAgainst: string | null = null): ActorFrame {
  return { id: `actor-frame/${transform}`, transform, side, w: frame.w, h: frame.h, verifiedAgainst };
}

export function toActorFrame(f: ActorFrame, c: Coord): Coord {
  switch (f.transform) {
    case 'native': return { x: c.x, y: c.y };
    case 'mirrorX': return { x: f.w - 1 - c.x, y: c.y };
    case 'rotate180': return { x: f.w - 1 - c.x, y: f.h - 1 - c.y };
  }
}
/** Every supported transform is an involution, so the inverse is the same mapping. */
export const fromActorFrame = toActorFrame;

// ───────────────────────────────────────────────────────────────────────── identity of a rules version
export interface RulesVersion { engineVersion: string; rulesHash: string; engineHash: string }
export const currentRulesVersion = (): RulesVersion => ({ engineVersion: BUILD_FINGERPRINT.version, rulesHash: BUILD_FINGERPRINT.rulesHash, engineHash: BUILD_FINGERPRINT.engineHash });

// ───────────────────────────────────────────────────────────────────────── player destinations
export interface DestinationsOpts { playerId: string; offset?: number; limit?: number; routes?: boolean; maxRushes?: number; maxDodges?: number; includeTargets?: boolean; deadline?: number }

const sq = (c: Coord) => ({ x: c.x, y: c.y });

function dodgesOn(st: GameState, p: Player, path: Array<{ to: Coord }>): number {
  let n = 0;
  let from = p.pos as Coord;
  for (const step of path) {
    if (E.dodgeChance(st, p, from, step.to) < 1 - 1e-12) n++;
    from = step.to;
  }
  return n;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DestinationsResult = ({ ok: true } & Record<string, any>) | { ok: false; code: string; message: string };

export function playerDestinations(s: GameState, team: TeamId, q: DestinationsOpts): DestinationsResult {
  E.usePitch(s);
  const p = s.players.find((x) => x.id === q.playerId);
  if (!p) return { ok: false, code: 'invalid-argument', message: `Unknown player "${q.playerId}".` };
  if (p.team !== team) return { ok: false, code: 'invalid-argument', message: `${p.id} belongs to team ${p.team}; ask as that team.` };
  const frame = frameOf(s);
  const base = { ok: true as const, schema: DESTINATIONS_SCHEMA, frame, rules: currentRulesVersion(), revision: revisionOf(s), player: { id: p.id, team: p.team, number: p.number, position: p.position, stance: p.stance, location: p.location, from: p.pos ? sq(p.pos) : null } };
  const notes: string[] = [];
  const offer = E.actionOptions(s, p).find((a) => a.action === 'move');
  const canMove = p.location === 'pitch' && !!p.pos && s.phase === 'play' && s.turn.active === team && !!offer?.enabled;
  if (!canMove) {
    return { ...base, canMove: false, reason: !p.pos || p.location !== 'pitch' ? 'The player is not on the pitch.' : s.turn.active !== team ? 'It is not this team\'s Turn.' : offer ? (offer as { reason?: string }).reason ?? 'The player cannot be activated to move.' : 'Move is not offered to this player.', stay: { legal: false }, destinations: [], total: 0, offset: 0, complete: true, next: null, targets: null, coverage: { complete: true, derivedFrom: 'engine action options', notes: ['No destination is legal; this is complete, not truncated.'] } };
  }
  const offset = Math.max(0, Math.floor(q.offset ?? 0));
  const limit = Math.min(Math.max(1, Math.floor(q.limit ?? 120)), 600);
  const maxR = q.maxRushes ?? Infinity;
  const maxD = q.maxDodges ?? Infinity;
  const reach = E.reachableSquares(s, p.id).slice().sort((a, b) => a.steps - b.steps || a.c.x - b.c.x || a.c.y - b.c.y);
  const dests: Array<Record<string, unknown>> = [];
  let i = offset;
  let timedOut = false;
  for (; i < reach.length && dests.length < limit; i++) {
    if (q.deadline && Date.now() > q.deadline) { timedOut = true; break; }
    const r = reach[i];
    if (r.rushes > maxR) continue;
    const route = E.safestRoute(s, p.id, r.c);
    if (!route) continue;
    const dodges = dodgesOn(s, p, route.path);
    if (dodges > maxD) continue;
    const d: Record<string, unknown> = { x: r.c.x, y: r.c.y, steps: r.steps, minRushes: r.rushes, rushes: route.rushes, dodges, pRoute: route.pSafe, detour: route.detour };
    if (q.routes !== false) d.route = route.path.map((st) => sq(st.to));
    dests.push(d);
  }
  const complete = i >= reach.length && !timedOut;
  if (timedOut) notes.push('The call deadline cut the enumeration; `next` continues it.');
  notes.push('pRoute is the engine route chance of every Dodge and Rush with skill re-rolls only (no team re-roll).');
  notes.push('Plain steps through empty squares. Jumps are separate declarations (see legalChoices).');
  let targets: Record<string, unknown> | null = null;
  if (q.includeTargets !== false) {
    const carrying = s.ball.kind === 'held' && s.ball.playerId === p.id;
    const run = (choice: string, param: string) => {
      const r = legalTargets(s, team, { choice, param, actor: p.id });
      return r.ok ? { legal: r.values.filter((v) => v.legal).map((v) => v.value), complete: r.complete, coverage: r.coverage } : { legal: [], complete: true, coverage: r.message };
    };
    targets = { carryingBall: carrying, pass: carrying ? run('pass', 'passTarget') : null, handoff: carrying ? run('handoff', 'handoffTarget') : null, note: 'Probabilities of passes and hand-offs come from threats.* / explore; this list is legality only.' };
  }
  return {
    ...base, canMove: true,
    stay: { legal: true, x: p.pos!.x, y: p.pos!.y, note: 'Declaring the Move Action and not leaving the square is legal; it still uses the activation.' },
    destinations: dests, total: reach.length, offset, complete, next: complete ? null : i, targets,
    coverage: { complete, derivedFrom: 'engine reachableSquares + safestRoute', notes },
  };
}

// ───────────────────────────────────────────────────────────────────────── dense mask
export interface SpatialMask {
  ok: true;
  schema: typeof MASK_SCHEMA;
  frame: Frame;
  rules: RulesVersion;
  revision: string;
  player: string;
  side: TeamId;
  /** Row-major in CANONICAL engine coordinates: index = y * w + x. 1 = legal destination (the stay square included). */
  legal: number[];
  provenance: { source: 'engine-current-rules'; complete: boolean; reason: string | null };
  count: number;
}

export function spatialMask(s: GameState, team: TeamId, playerId: string): SpatialMask | { ok: false; code: string; message: string } {
  const d = playerDestinations(s, team, { playerId, limit: 600, routes: false, includeTargets: false });
  if (!d.ok) return d;
  const frame = d.frame as Frame;
  const legal = new Array<number>(frame.w * frame.h).fill(0);
  let all: DestinationsResult = d;
  const gathered: Array<{ x: number; y: number }> = [...(d.destinations as Array<{ x: number; y: number }>)];
  let guard = 0;
  while (all.next !== null && guard++ < 50) {
    const more = playerDestinations(s, team, { playerId, offset: all.next as number, limit: 600, routes: false, includeTargets: false });
    if (!more.ok) break;
    all = more;
    gathered.push(...(all.destinations as Array<{ x: number; y: number }>));
  }
  for (const c of gathered) legal[c.y * frame.w + c.x] = 1;
  const from = (d.player as { from: Coord | null }).from;
  if (d.canMove && from) legal[from.y * frame.w + from.x] = 1;
  return { ok: true, schema: MASK_SCHEMA, frame, rules: currentRulesVersion(), revision: d.revision as string, player: playerId, side: team, legal, provenance: { source: 'engine-current-rules', complete: all.next === null, reason: all.next === null ? null : 'enumeration stopped before completion' }, count: legal.reduce((a, b) => a + b, 0) };
}

/** Re-express a canonical dense array in an actor frame (and back: the mapping is an involution). */
export function remapGrid<T>(grid: T[], f: ActorFrame): T[] {
  const out = new Array<T>(grid.length);
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
    const t = toActorFrame(f, { x, y });
    out[t.y * f.w + t.x] = grid[y * f.w + x];
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────── advice
export interface AdviceRequest { schema: typeof ADVICE_REQUEST_SCHEMA; requestId: number; revision: string; side: TeamId; player: string; frame: Frame; actorFrame: ActorFrame; maskHash: string; rules: RulesVersion }
export interface AdviceResponse { schema: typeof ADVICE_RESPONSE_SCHEMA; requestId: number; revision: string; player: string; side?: TeamId; frame: { id: string; w: number; h: number }; /** Scores in the ACTOR frame, row-major y * w + x. Logits or probabilities. */ scores: number[]; kind?: 'logit' | 'probability'; why?: string; model?: { id?: string; sha?: string } }
export type AdviceScript = { kind: 'argmax' } | { kind: 'topk'; k: number } | { kind: 'sample'; temperature: number; topK?: number };
export interface Ranked { x: number; y: number; score: number; p: number }
export type AdviceResolution =
  | { ok: true; schema: typeof ADVICE_RECEIPT_SCHEMA; proposed: Ranked | null; selected: Ranked; top: Ranked[]; script: AdviceScript; executed: null; maskedMass: number; legalCount: number }
  | { ok: false; schema: typeof ADVICE_RECEIPT_SCHEMA; code: 'wrong-schema' | 'stale-revision' | 'wrong-request' | 'wrong-player' | 'wrong-frame' | 'wrong-board' | 'bad-shape' | 'non-finite' | 'all-masked' | 'bad-script'; message: string; proposed: null; selected: null; executed: null };

/** FNV-1a over the mask: identifies which legality a response was computed against. Not a security hash. */
export function maskHash(mask: number[]): string {
  let h = 0x811c9dc5;
  for (const v of mask) { h ^= v & 1; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

export function adviceRequest(s: GameState, team: TeamId, playerId: string, requestId: number, af?: ActorFrame): AdviceRequest | { ok: false; code: string; message: string } {
  const m = spatialMask(s, team, playerId);
  if (!m.ok) return m;
  return { schema: ADVICE_REQUEST_SCHEMA, requestId, revision: m.revision, side: team, player: playerId, frame: m.frame, actorFrame: af ?? actorFrame(team, m.frame), maskHash: maskHash(m.legal), rules: m.rules };
}

const bad = (code: Extract<AdviceResolution, { ok: false }>['code'], message: string): AdviceResolution => ({ ok: false, schema: ADVICE_RECEIPT_SCHEMA, code, message, proposed: null, selected: null, executed: null });

function softmax(xs: number[], t: number): number[] {
  const m = Math.max(...xs);
  const e = xs.map((x) => Math.exp((x - m) / t));
  const z = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / z);
}

/**
 * Resolve a heatmap to ONE legal destination. `legalCanonical` is the engine mask in canonical coordinates for the CURRENT
 * position; `rng` (only for the sample script) belongs to the host and is never shown to a coach.
 */
export function resolveSpatialAdvice(req: AdviceRequest, current: { revision: string; mask: number[]; requestId: number }, res: unknown, script: AdviceScript = { kind: 'argmax' }, rng?: () => number): AdviceResolution {
  const r = o(res);
  if (r.schema !== ADVICE_RESPONSE_SCHEMA) return bad('wrong-schema', `Expected schema ${ADVICE_RESPONSE_SCHEMA}.`);
  if (r.requestId !== req.requestId || current.requestId !== req.requestId) return bad('wrong-request', 'The response answers a different request.');
  if (r.revision !== req.revision || current.revision !== req.revision) return bad('stale-revision', 'The position changed since the request; the advice is stale and is not applied.');
  if (r.player !== req.player) return bad('wrong-player', `The advice is for ${String(r.player)}, the request was for ${req.player}.`);
  if (r.side !== undefined && r.side !== req.side) return bad('wrong-player', 'The advice names the other side.');
  const fr = o(r.frame);
  if (fr.id !== req.actorFrame.id) return bad('wrong-frame', `Frame ${String(fr.id)} does not match the requested ${req.actorFrame.id}.`);
  if (fr.w !== req.frame.w || fr.h !== req.frame.h) return bad('wrong-board', `Board ${String(fr.w)}x${String(fr.h)} does not match ${req.frame.w}x${req.frame.h}.`);
  const n = req.frame.w * req.frame.h;
  if (!Array.isArray(r.scores) || r.scores.length !== n) return bad('bad-shape', `scores must be an array of ${n} numbers (row-major y*w+x in the actor frame).`);
  if (maskHash(current.mask) !== req.maskHash) return bad('stale-revision', 'The legal mask changed since the request.');
  const raw = r.scores as unknown[];
  for (const v of raw) if (typeof v !== 'number' || !Number.isFinite(v)) return bad('non-finite', 'scores must all be finite numbers.');
  const scoresActor = raw as number[];
  // Scores arrive in the actor frame; legality is canonical. Map the scores back to canonical coordinates.
  const af = req.actorFrame;
  const canon = remapGrid(scoresActor, af);
  const idx: number[] = [];
  for (let i = 0; i < n; i++) if (current.mask[i] === 1) idx.push(i);
  if (!idx.length) return bad('all-masked', 'No destination is legal.');
  const rankOf = (i: number, p: number): Ranked => ({ x: i % req.frame.w, y: Math.floor(i / req.frame.w), score: canon[i], p });
  const asLogit = r.kind !== 'probability';
  const legalScores = idx.map((i) => (asLogit ? canon[i] : Math.log(Math.max(canon[i], 1e-300))));
  const probs = softmax(legalScores, 1);
  const order = idx.map((i, k) => ({ i, p: probs[k] })).sort((a, b) => b.p - a.p || a.i - b.i);
  // What the model proposed before masking: its best square over ALL squares.
  let best = 0;
  for (let i = 1; i < n; i++) if (canon[i] > canon[best]) best = i;
  const proposed = rankOf(best, current.mask[best] === 1 ? (order.find((x) => x.i === best)?.p ?? 0) : 0);
  const maskedMass = (() => {
    const all = softmax(asLogit ? canon : canon.map((v) => Math.log(Math.max(v, 1e-300))), 1);
    let m = 0;
    for (let i = 0; i < n; i++) if (current.mask[i] !== 1) m += all[i];
    return m;
  })();
  let chosen = order[0];
  if (script.kind === 'topk') {
    if (!(script.k >= 1)) return bad('bad-script', 'topk needs k >= 1.');
  } else if (script.kind === 'sample') {
    if (!(script.temperature > 0) || !rng) return bad('bad-script', 'sample needs temperature > 0 and a host rng.');
    const pool = order.slice(0, script.topK && script.topK > 0 ? script.topK : order.length);
    const pp = softmax(pool.map((x) => Math.log(Math.max(x.p, 1e-300))), script.temperature);
    let u = rng();
    chosen = pool[pool.length - 1];
    for (let k = 0; k < pool.length; k++) { u -= pp[k]; if (u <= 0) { chosen = pool[k]; break; } }
  } else if (script.kind !== 'argmax') return bad('bad-script', 'Unknown script.');
  const k = script.kind === 'topk' ? script.k : 5;
  return { ok: true, schema: ADVICE_RECEIPT_SCHEMA, proposed, selected: rankOf(chosen.i, chosen.p), top: order.slice(0, k).map((x) => rankOf(x.i, x.p)), script, executed: null, maskedMass, legalCount: idx.length };
}

/** Turn a resolved destination into the engine input a host executes (a one-square or routed Move). The host still validates it. */
export function moveInputFor(s: GameState, playerId: string, to: Coord): ActionInput | null {
  E.usePitch(s);
  const p = s.players.find((x) => x.id === playerId);
  if (!p || !p.pos) return null;
  if (p.pos.x === to.x && p.pos.y === to.y) return { kind: 'player', playerId, action: 'move', path: [] } as unknown as ActionInput;
  const route = E.safestRoute(s, playerId, to);
  if (!route) return null;
  return { kind: 'player', playerId, action: 'move', path: route.path } as unknown as ActionInput;
}

// ───────────────────────────────────────────────────────────────────────── services (registered in v2.ts)
export function spatialService(ses: Session, name: string, a: unknown[]): unknown | ServiceFailure {
  const q = o(a[0]);
  const pos = ses.position(q.from);
  const team = q.team === 'A' || q.team === 'B' ? q.team : pos.state.turn.active;
  const st = ses.cloneOf(pos);
  const playerId = String(q.playerId ?? q.player ?? '');
  if (!playerId) return fail('invalid-argument', `${name} needs { playerId }.`);
  if (name === 'playerDestinations') {
    const ms = Math.min(Number(q.maxMs) || 1500, 5000);
    const r = playerDestinations(st, team, { playerId, offset: Number(q.offset) || 0, limit: Number(q.limit) || undefined, routes: q.routes !== false, includeTargets: q.targets !== false, maxRushes: q.maxRushes === undefined ? undefined : Number(q.maxRushes), maxDodges: q.maxDodges === undefined ? undefined : Number(q.maxDodges), deadline: Date.now() + ms });
    return r.ok ? { ...r, position: pos.key } : fail('invalid-argument', (r as { message: string }).message);
  }
  if (name === 'spatialMask') {
    const m = spatialMask(st, team, playerId);
    if (!m.ok) return fail('invalid-argument', m.message);
    const f = q.frame === 'actor' ? actorFrame(team, m.frame) : null;
    return { ...m, legal: f ? remapGrid(m.legal, f) : m.legal, inFrame: f ? f.id : 'canonical', actorFrame: f, maskHash: maskHash(m.legal), position: pos.key };
  }
  return fail('unsupported', `Unknown spatial service ${name}.`);
}
export const SPATIAL_SERVICE_NAMES = ['playerDestinations', 'spatialMask'];

// ───────────────────────────────────────────────────────────────────────── compute profiles
export type ProfileKind = 'interactive' | 'localBatch' | 'trainingSampling';
export interface ComputeProfile {
  id: string;
  kind: ProfileKind;
  /** Upper bound per decision. NOT a duration: a decision returns as soon as it has a valid answer. */
  maxDecisionMs: number;
  /** Optional soft target for batch/sampling schedulers. */
  targetDecisionMs: number | null;
  /** The profile inherits the online account's concurrency cap (interactive online coaches only). */
  onlineConcurrencyCap: boolean;
  cancellable: true;
  /** Local jobs are limited by hardware, not by a provider cap. */
  concurrency: 'hardware' | 'provider';
  forceFullBudget: false;
}
export const PROFILES: Record<string, ComputeProfile> = {
  interactive: { id: 'interactive', kind: 'interactive', maxDecisionMs: 120_000, targetDecisionMs: null, onlineConcurrencyCap: true, cancellable: true, concurrency: 'provider', forceFullBudget: false },
  localBatch: { id: 'localBatch', kind: 'localBatch', maxDecisionMs: 5_000, targetDecisionMs: null, onlineConcurrencyCap: false, cancellable: true, concurrency: 'hardware', forceFullBudget: false },
  trainingSampling: { id: 'trainingSampling', kind: 'trainingSampling', maxDecisionMs: 500, targetDecisionMs: 100, onlineConcurrencyCap: false, cancellable: true, concurrency: 'hardware', forceFullBudget: false },
};
export function resolveProfile(id: string, overrides: Partial<Pick<ComputeProfile, 'maxDecisionMs' | 'targetDecisionMs'>> = {}): { ok: true; profile: ComputeProfile } | { ok: false; message: string } {
  const base = PROFILES[id];
  if (!base) return { ok: false, message: `Unknown compute profile "${id}" (${Object.keys(PROFILES).join(', ')}).` };
  const max = overrides.maxDecisionMs ?? base.maxDecisionMs;
  if (!Number.isFinite(max) || max < 1 || max > 600_000) return { ok: false, message: 'maxDecisionMs must be 1..600000.' };
  if (base.kind === 'interactive' && max > 120_000) return { ok: false, message: 'The interactive allowance is capped at 120000 ms.' };
  const target = overrides.targetDecisionMs === undefined ? base.targetDecisionMs : overrides.targetDecisionMs;
  if (target !== null && (!(target > 0) || target > max)) return { ok: false, message: 'targetDecisionMs must be > 0 and <= maxDecisionMs.' };
  return { ok: true, profile: { ...base, maxDecisionMs: max, targetDecisionMs: target } };
}
