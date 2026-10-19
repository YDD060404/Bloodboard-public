/**
 * Offline (research / training) match runner. SEPARATE from the match-time services: it schedules whole matches, asks each
 * coach for its decisions through the same host the app uses (`platformDecide`, worker isolation, limits, fallback) and
 * records two kinds of output that must never be mixed:
 *
 *   trajectories.jsonl — PUBLIC: what a coach could see and choose (observation / features, offered candidates, the
 *                        selected action, rule decisions, how the answer was taken, rewards). Safe to give a learner.
 *   internal.jsonl     — INTERNAL: the engine's dice events and log entries of each step. A coach must never receive
 *                        these; they exist for audits and reproduction only.
 *
 * Nothing in src/platform/*.ts (match time) imports this directory.
 */
import { createMatch, decide, execute, type ExecutionResult, type GameState, type TeamId, type TeamDef } from '../../engine/index';
import { nextMove, waitingFor, type AIFile, type AIMove, type AIStyle, type CoachEntry } from '../../ai/index';
import { nodeSpawn } from './nodehost';
import { platformDecide, type DecideMeta } from '../host';
import { RECEIPT_SCHEMA, receipt } from '../v2obs';
import { CoachContextStore } from '../hostext';
import { observe } from '../observe';
import { featuresOf, FEATURE_NAMES, FEATURE_SCHEMA_VERSION } from '../evaluation';
import { buildTeam } from './teams';
import { forWorker } from '../analysis';
import type { EnginePool } from '../pool';

export const TRAJECTORY_SCHEMA = 'bloodboard-trajectory/1';
export const RESULT_SCHEMA = 'bloodboard-result/1';
export const INTERNAL_SCHEMA = 'bloodboard-internal/1';

export interface CoachSpec {
  /** Unique label in the batch (for summaries). */
  label: string;
  kind: 'builtin' | 'module' | 'profile';
  /** builtin: the built-in algorithm's style. */
  style?: AIStyle;
  /** profile: a parameter AI file configuring the built-in algorithm. */
  profile?: AIFile;
  /** module: the code, its id/version (recorded), limits and declared minor. */
  code?: string;
  id?: string;
  version?: string;
  timeLimitMs?: number;
  apiMinor?: number;
  /** Strategy API generation (1 or 2), context schema and negotiated capabilities, from the module's own manifest. */
  apiGeneration?: number;
  contextSchema?: string;
  capabilities?: Record<string, boolean>;
  requiresCapabilities?: string[];
  /** Hash of the code (recorded for reproduction). */
  sha?: string;
}

export interface MatchConfig {
  game: string;
  seed: number;
  format: 'standard' | 'sevens';
  mode: 'tournament';
  rosters: Record<TeamId, string>;
  coaches: Record<TeamId, CoachSpec>;
  /** What the public trajectory stores per step: nothing, compact positions + features, or the coach's full observation. */
  observations: 'none' | 'compact' | 'full';
  features: boolean;
  /** Stop a match that somehow does not end. */
  maxSteps?: number;
  /** Ready-made teams (for example saved team files); otherwise `rosters` names them. */
  teams?: Partial<Record<TeamId, TeamDef>>;
  /** Optional observers: progress after every step, and a cooperative abort (checked between steps). */
  hooks?: MatchHooks;
  /** V5.7: the engine pool. Built-in / profile coaches decide in its workers and module coaches use it for their engine services (games running side by side share it). */
  pool?: EnginePool;
  /** Match rules (Fan Factor, weather, kick-off events: 'full'; the introductory rules otherwise). */
  rules?: 'full' | 'introductory';
  /** Keep the replayable input sequence and the final state in the result (a batch writes them into the game's history). */
  keepHistory?: boolean;
  /** Filled while the match runs (also when it fails or is aborted): what a batch keeps of an unfinished game. */
  trace?: MatchTrace;
}

export interface StepEvent { game: string; step: number; team: TeamId | null; kind: string; phase: string; score: Record<TeamId, number>; half: number; turn: Record<TeamId, number>; thinkMs: number; label?: string; coach?: string }
export interface MatchHooks { onStep?(e: StepEvent, state?: GameState): void; aborted?(): boolean; /** Awaited after every step: lets the host process messages (pause / stop) while built-in coaches, which never wait, are playing. */ tick?(): Promise<void> }
export interface MatchTrace { replay: ReplayStep[]; incidents: NonNullable<MatchResult['incidents']>; state?: GameState; steps: number }
export interface HostUse { setupAsked: number; setupAccepted: number; setupFallback: number; contextCommitted: number; contextIgnored: number }
export class MatchInvalid extends Error { constructor(msg: string) { super(msg); } }
export class MatchAborted extends Error { constructor(game: string) { super(`match ${game} aborted`); } }

export interface Sink {
  trajectory(line: Record<string, unknown>): void;
  internal(line: Record<string, unknown>): void;
  result(line: Record<string, unknown>): void;
}

export interface MatchResult {
  game: string;
  seed: number;
  score: Record<TeamId, number>;
  winner: TeamId | 'draw';
  steps: number;
  fallbacks: Record<TeamId, number>;
  decisions: Record<TeamId, number>;
  thinkMs: Record<TeamId, number>;
  maxThinkMs: Record<TeamId, number>;
  ms: number;
  /** Every coach problem in order (fallback to the built-in coach, timeout, module error), with its step. */
  incidents?: Array<{ step: number; team: TeamId; reason: string; via: string }>;
  /** V5.8: what the host extensions did per side — set-up hook asked / accepted / fell back, coach context committed / ignored. */
  hostUse?: Record<TeamId, HostUse>;
  /** With `keepHistory`: the exact inputs given to the engine, in order (see `replayHistory`). */
  replay?: ReplayStep[];
  /** With `keepHistory`: the state at full time (its log holds every dice event). */
  finalState?: GameState;
}

/** One engine input of a match. Replaying them from the initial teams and the seed reproduces the match. */
export type ReplayStep =
  | { k: 'neutral'; input: { kind: 'pregame' | 'nextDrive' } }
  | { k: 'input'; team: TeamId; input: unknown; thinkMs: number; label?: string }
  | { k: 'decide'; team: TeamId; requestId: string; optionId: string; thinkMs: number };

let builtinSeq = 2_000_000_000;
/** The built-in algorithm's decision: in an engine-pool worker when there is a pool (off the calling thread), else inline. */
async function builtinDecision(pool: EnginePool | undefined, s: GameState, who: TeamId, style: AIStyle, profile: AIFile | undefined, aborted?: () => boolean, game = ''): Promise<AIMove | null> {
  if (pool) {
    const r = (await pool.submit(() => ({ t: 'job', kind: 'builtin', state: forWorker(s), team: who, style, profile }), { request: builtinSeq++, label: 'built-in coach', hardAt: Date.now() + 180_000 })) as { move?: AIMove | null; t?: string; cancelled?: boolean; error?: string };
    if (!r.cancelled && !r.error && r.t !== 'fail' && 'move' in r) return r.move ?? null;
    // the pool was shut down because the batch is stopping: do not start the same calculation again on this thread
    if (aborted?.()) throw new MatchAborted(game);
  }
  return nextMove(s, who, style, {}, profile ? { profile } : undefined);
}

const other = (t: TeamId): TeamId => (t === 'A' ? 'B' : 'A');

function compact(s: GameState, team: TeamId): Record<string, unknown> {
  const o = observe(s, team, 0);
  return {
    team,
    half: o.half,
    turn: o.turn,
    score: o.score,
    rerolls: o.rerolls,
    active: o.active,
    ball: o.ball,
    weather: o.weather,
    used: o.used,
    players: o.players.map((p) => [p.id, p.team, p.pos ? p.pos.x : null, p.pos ? p.pos.y : null, p.stance, p.location, p.activated ? 1 : 0]),
  };
}

function entryOf(c: CoachSpec): CoachEntry {
  return { id: c.id ?? c.label, name: c.label, kind: 'strategy', implementation: `strategy:${c.id ?? c.label}`, version: c.version ?? '?', description: '', code: c.code, timeLimitMs: c.timeLimitMs, apiMinor: c.apiMinor ?? 0, apiGeneration: c.apiGeneration ?? 1, contextSchema: c.contextSchema, capabilities: c.capabilities, requiresCapabilities: c.requiresCapabilities } as CoachEntry;
}

export async function playMatch(cfg: MatchConfig, sink: Sink): Promise<MatchResult> {
  const t0 = Date.now();
  // V5.8: every headless match owns a fresh context store — sequential, parallel and swapped-side games never share one.
  const coachStore = new CoachContextStore();
  const a = cfg.teams?.A ? (JSON.parse(JSON.stringify(cfg.teams.A)) as TeamDef) : buildTeam(cfg.rosters.A, cfg.format);
  const b = cfg.teams?.B ? (JSON.parse(JSON.stringify(cfg.teams.B)) as TeamDef) : buildTeam(cfg.rosters.B, cfg.format);
  const cm = createMatch(cfg.mode, a, b, { rules: cfg.rules ?? 'full' }, cfg.seed);
  if (!cm.ok) throw new MatchInvalid(cm.errors.join('\n'));
  let s = cm.state as GameState;
  const res: MatchResult = { game: cfg.game, seed: cfg.seed, score: { A: 0, B: 0 }, winner: 'draw', steps: 0, fallbacks: { A: 0, B: 0 }, decisions: { A: 0, B: 0 }, thinkMs: { A: 0, B: 0 }, maxThinkMs: { A: 0, B: 0 }, ms: 0 };
  const buffer: Array<Record<string, unknown>> = [];
  const replay: ReplayStep[] = cfg.trace?.replay ?? [];
  res.incidents = cfg.trace?.incidents ?? [];
  res.hostUse = { A: { setupAsked: 0, setupAccepted: 0, setupFallback: 0, contextCommitted: 0, contextIgnored: 0 }, B: { setupAsked: 0, setupAccepted: 0, setupFallback: 0, contextCommitted: 0, contextIgnored: 0 } };
  const noteHost = (who: TeamId, meta: DecideMeta | null) => {
    if (!meta) return;
    const u = res.hostUse![who];
    if (meta.setup) { u.setupAsked++; if (meta.setup.accepted) u.setupAccepted++; else u.setupFallback++; }
    if (meta.context) { if (meta.context.committed) u.contextCommitted++; else if (meta.context.returned) u.contextIgnored++; }
  };
  const hostOf = (meta: DecideMeta | null) => (meta ? { allowanceMs: meta.allowanceMs ?? null, hostExtensions: meta.hostExtensions ?? null, setup: meta.setup ?? null, context: meta.context ?? null } : undefined);
  const keep = !!(cfg.keepHistory || cfg.trace);
  let logged = 0;
  const maxSteps = cfg.maxSteps ?? 6000;
  let step = 0;
  while (s.phase !== 'fullTime') {
    if (cfg.hooks?.aborted?.()) throw new MatchAborted(cfg.game);
    if (step++ > maxSteps) throw new Error(`match ${cfg.game} did not finish (phase ${s.phase})`);
    let lastThink = 0;
    let lastLabel: string | undefined;
    const stateBefore = s;
    let metaOfStep: DecideMeta | null = null;
    const who = waitingFor(s);
    let out: ExecutionResult;
    if (!who) {
      const nin = s.phase === 'pregame' ? ({ kind: 'pregame' } as const) : ({ kind: 'nextDrive' } as const);
      if (keep) replay.push({ k: 'neutral', input: nin });
      out = execute(s, nin);
    } else {
      const spec = cfg.coaches[who];
      const tt = Date.now();
      let mv: AIMove | null;
      let meta: DecideMeta | null = null;
      if (spec.kind === 'module') {
        const entry = entryOf(spec);
        const requestedState = s;
        const r = await platformDecide(s, who, entry, {
          spawn: nodeSpawn, pool: cfg.pool,
          context: coachStore.ticket(who, entry.id, { version: entry.version, schema: spec.contextSchema }),
          stale: () => s !== requestedState || !!cfg.hooks?.aborted?.(),
        });
        mv = r.move;
        meta = r.meta;
        metaOfStep = r.meta;
      } else if (spec.kind === 'profile') mv = await builtinDecision(cfg.pool, s, who, 'balanced', spec.profile, cfg.hooks?.aborted, cfg.game);
      else mv = await builtinDecision(cfg.pool, s, who, spec.style ?? 'balanced', undefined, cfg.hooks?.aborted, cfg.game);
      if (cfg.hooks?.aborted?.()) throw new MatchAborted(cfg.game);
      const ms = Date.now() - tt;
      lastThink = ms;
      lastLabel = mv && mv.type === 'action' ? (mv.decision.chosen ? mv.decision.chosen.label : mv.input.kind) : mv && mv.type === 'decision' ? `decision: ${mv.optionId}` : undefined;
      if (!mv) throw new Error(`no move for ${who} in phase ${s.phase}`);
      if (mv.type === 'action') {
        noteHost(who, meta);
        res.decisions[who]++;
        res.thinkMs[who] += ms;
        res.maxThinkMs[who] = Math.max(res.maxThinkMs[who], ms);
        if (meta?.fellBack) { res.fallbacks[who]++; res.incidents.push({ step: res.steps, team: who, reason: meta.reason ?? 'fell back to the built-in coach', via: meta.via }); }
        if (keep) replay.push({ k: 'input', team: who, input: mv.input, thinkMs: ms, label: lastLabel });
        const line: Record<string, unknown> = {
          schema: TRAJECTORY_SCHEMA,
          game: cfg.game,
          step: res.steps,
          team: who,
          coach: { label: spec.label, id: spec.id ?? null, version: spec.version ?? null },
          kind: 'action',
          observation: cfg.observations === 'none' ? undefined : cfg.observations === 'full' ? observe(s, who, res.steps) : compact(s, who),
          features: cfg.features ? featuresOf(s, who).values : undefined,
          candidates: mv.decision.candidates.slice(0, 40).map((k, i) => ({ index: i, label: k.label, kind: k.kind, playerId: k.playerId, input: k.input, pSuccess: k.pSuccess ?? null, pTurnover: k.pTurnover ?? null, pTouchdown: k.pTouchdown ?? null, builtInValue: k.gain ?? null })),
          selected: { input: mv.input, label: mv.decision.chosen ? mv.decision.chosen.label : mv.input.kind },
          source: { via: meta ? meta.via : 'builtin', fellBack: !!meta?.fellBack, reason: meta?.reason ?? null },
          host: hostOf(meta),
          why: mv.why,
          ranking: meta?.ranking,
          progressNotes: meta?.progress?.length,
          trace: meta?.trace,
          diagnostics: meta ? meta.diagnostics.map((d) => ({ service: d.service, code: d.code, message: d.message })) : undefined,
          usage: meta?.usage,
          thinkMs: ms,
        };
        buffer.push(line);
        out = execute(s, mv.input);
      } else if (mv.type === 'decision') {
        const req = s.pending?.request;
        buffer.push({ schema: TRAJECTORY_SCHEMA, game: cfg.game, step: res.steps, team: who, coach: { label: spec.label, id: spec.id ?? null, version: spec.version ?? null }, kind: 'decision', observation: cfg.observations === 'none' ? undefined : cfg.observations === 'full' ? observe(s, who, res.steps) : compact(s, who), ruleDecision: req ? { type: req.type, options: req.options.map((o) => ({ id: o.id, label: o.label })) } : null, selected: { optionId: mv.optionId }, source: { via: meta ? meta.via : 'builtin', fellBack: !!meta?.fellBack, reason: meta?.reason ?? null }, host: hostOf(meta), diagnostics: meta ? meta.diagnostics.map((d) => ({ service: d.service, code: d.code, message: d.message })) : undefined, usage: meta?.usage, why: mv.why, thinkMs: ms });
        noteHost(who, meta);
        if (meta?.fellBack) { res.fallbacks[who]++; res.incidents.push({ step: res.steps, team: who, reason: meta.reason ?? 'fell back to the built-in coach', via: meta.via }); }
        if (keep) replay.push({ k: 'decide', team: who, requestId: String(mv.requestId), optionId: mv.optionId, thinkMs: ms });
        out = decide(s, { requestId: mv.requestId, optionId: mv.optionId });
      } else {
        // setup / kick-off placement steps: part of the replayable input sequence; V5.8: a set-up that was offered to a module is also recorded.
        noteHost(who, meta);
        if (meta && s.phase === 'driveSetup') {
          if (meta.fellBack) { res.fallbacks[who]++; res.incidents.push({ step: res.steps, team: who, reason: meta.reason ?? 'fell back to the built-in set-up', via: meta.via }); }
          buffer.push({ schema: TRAJECTORY_SCHEMA, game: cfg.game, step: res.steps, team: who, coach: { label: spec.label, id: spec.id ?? null, version: spec.version ?? null }, kind: 'setup', selected: { input: mv.input, label: 'Set-up' }, source: { via: meta.via, fellBack: !!meta.fellBack, reason: meta.reason ?? null }, host: hostOf(meta), why: mv.why, diagnostics: meta.diagnostics.map((d) => ({ service: d.service, code: d.code, message: d.message })), usage: meta.usage, thinkMs: ms });
        }
        if (keep) replay.push({ k: 'input', team: who, input: mv.input, thinkMs: ms, label: lastLabel });
        out = execute(s, mv.input);
      }
    }
    if (out.status === 'illegal') throw new Error(`illegal input in ${cfg.game} (${who ?? 'neutral'}, ${s.phase}): ${(out as { error?: string }).error}`);
    s = out.state as GameState;
    // V6: the execution receipt of a module's answer (public facts only), next to its trajectory line.
    if (who && metaOfStep && s.log.length > stateBefore.log.length) {
      const spec = cfg.coaches[who];
      buffer.push({ schema: RECEIPT_SCHEMA, game: cfg.game, step: res.steps, team: who, coach: { label: spec.label, id: spec.id ?? null }, receipt: receipt(stateBefore, s, { requestId: metaOfStep.requestId, input: null, coach: metaOfStep.coach, via: metaOfStep.via, fellBack: metaOfStep.fellBack, reason: metaOfStep.reason }) });
    }
    if (cfg.trace) { cfg.trace.state = s; cfg.trace.steps = res.steps + 1; }
    // INTERNAL: the dice / log entries this step added. Never part of a coach's input or the public trajectory.
    if (s.log.length > logged) {
      sink.internal({ schema: INTERNAL_SCHEMA, game: cfg.game, step: res.steps, log: s.log.slice(logged) });
      logged = s.log.length;
    }
    res.steps++;
    if (cfg.hooks?.tick) await cfg.hooks.tick();
    if (cfg.hooks?.onStep) cfg.hooks.onStep({ game: cfg.game, step: res.steps, team: who, kind: who ? 'move' : 'neutral', phase: s.phase, score: { A: s.teams.A.score, B: s.teams.B.score }, half: s.match?.half ?? 1, turn: { A: s.teams.A.turn, B: s.teams.B.turn }, thinkMs: lastThink, label: lastLabel, coach: who ? cfg.coaches[who].label : undefined }, s);
  }
  res.score = { A: s.teams.A.score, B: s.teams.B.score };
  res.winner = res.score.A > res.score.B ? 'A' : res.score.B > res.score.A ? 'B' : 'draw';
  res.ms = Date.now() - t0;
  if (keep) { res.replay = replay; res.finalState = s; }
  const diff = res.score.A - res.score.B;
  const reward = (t: TeamId) => ({ result: res.winner === 'draw' ? 0 : res.winner === t ? 1 : -1, scoreDiff: t === 'A' ? diff : -diff });
  for (const line of buffer) sink.trajectory({ ...line, outcome: reward(line.team as TeamId) });
  const { replay: _replay, finalState: _final, ...plain } = res;
  void _replay; void _final;
  sink.result({ schema: RESULT_SCHEMA, ...plain, config: { seed: cfg.seed, format: cfg.format, mode: cfg.mode, rosters: cfg.rosters, coaches: { A: cfg.coaches.A.label, B: cfg.coaches.B.label }, observations: cfg.observations }, rewards: { A: reward('A'), B: reward('B') }, featureSchema: FEATURE_SCHEMA_VERSION, featureNames: undefined });
  void other;
  return res;
}

export { FEATURE_NAMES, FEATURE_SCHEMA_VERSION };

/**
 * Replays a recorded match: the same initial teams, seed and rules, then every recorded engine input in order.
 * Returns the state at the end and the first place (if any) where the engine refused an input.
 */
export function replayHistory(teams: Record<TeamId, TeamDef>, seed: number, rules: 'full' | 'introductory', steps: ReplayStep[]): { state: GameState; applied: number; error?: string } {
  const cm = createMatch('tournament', JSON.parse(JSON.stringify(teams.A)) as TeamDef, JSON.parse(JSON.stringify(teams.B)) as TeamDef, { rules }, seed);
  if (!cm.ok) return { state: undefined as unknown as GameState, applied: 0, error: cm.errors.join('; ') };
  let s = cm.state as GameState;
  let applied = 0;
  for (const st of steps) {
    const out = st.k === 'neutral' ? execute(s, st.input) : st.k === 'input' ? execute(s, st.input as never) : decide(s, { requestId: st.requestId, optionId: st.optionId });
    if (out.status === 'illegal') return { state: s, applied, error: `step ${applied}: the engine refused the input (${(out as { error?: string }).error ?? 'illegal'})` };
    s = out.state as GameState;
    applied++;
  }
  return { state: s, applied };
}
