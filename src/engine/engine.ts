import { runInput } from './actions';
import { fmt } from './board';
import { ActionStop, Ctx, DEFAULT_POLICY, IllegalAction, NeedDecision } from './context';
import { RngDice, type DiceSource } from './dice';
import { describeMatchInput, isMatchInput } from './match';
import { validateInput } from './planner';
import { cloneState, findPlayer, label } from './state';
import type { ActionInput, DecisionChoice, DecisionRecord, ExecutionResult, GameEvent, GameState, LogEntry, PlanSummaryForLog } from './types';

export function describeInput(s: GameState, input: ActionInput): string {
  if (input.kind === 'endTurn') return `${s.teams[s.turn.active].name}: End Turn`;
  if (input.kind === 'endActivation') {
    const p = findPlayer(s, s.turn.activation?.playerId);
    return p ? `${label(p)}: End activation` : 'End activation';
  }
  if (input.kind === 'forgo') {
    const p = findPlayer(s, input.playerId);
    return p ? `${label(p)}: Forego activation` : 'Forego activation';
  }
  if (input.kind === 'wizard') {
    const t = s.teams[input.team].name;
    if (input.spell === 'none') return `${t}: keep the Sports-Wizard`;
    if (input.spell === 'fireball') return `${t}: Sports-Wizard — Fireball at ${fmt(input.square ?? null)}`;
    const q = findPlayer(s, input.target);
    return `${t}: Sports-Wizard — Zap! ${q ? label(q) : input.target}`;
  }
  if (input.kind !== 'playerAction') return describeMatchInput(s, input);
  const p = findPlayer(s, input.playerId);
  const who = p ? label(p) : input.playerId;
  const names = { move: 'Move', blitz: 'Blitz', block: 'Block', pass: 'Pass', handoff: 'Hand-off', secure: 'Secure the Ball', foul: 'Foul', ttm: 'Throw Team-mate', special: 'Special' };
  const parts: string[] = [`${who} — ${names[input.action]}`];
  if (input.path.length) parts.push(`move ${input.path.length} square${input.path.length === 1 ? '' : 's'} to ${fmt(input.path[input.path.length - 1].to)}`);
  const t = findPlayer(s, input.blockTarget ?? input.handoffTarget);
  if (input.blockTarget && t) parts.push(`block ${label(t)}`);
  if (input.handoffTarget && t) parts.push(`hand-off to ${label(t)}`);
  if (input.passTarget) parts.push(`${input.hailMary ? 'Hail Mary' : 'pass'} to ${fmt(input.passTarget)}`);
  const f = findPlayer(s, input.foulTarget);
  if (f) parts.push(`foul ${label(f)}${input.useChainsaw ? ' with the chainsaw' : ''}`);
  const sp = findPlayer(s, input.specialTarget ?? input.vomitTarget);
  if (sp) parts.push(`${input.special ?? 'projectileVomit'} on ${label(sp)}`.replace('projectileVomit', 'Projectile Vomit'));
  if (input.blockTarget2) {
    const t2 = findPlayer(s, input.blockTarget2);
    if (t2) parts.push(`and ${label(t2)} (Multiple Block)`);
  }
  if (input.leaveBall) parts.push('leaving the ball behind (Fumblerooski)');
  return parts.join(', ');
}

function stripForBase(s: GameState): GameState {
  const b = cloneState({ ...s, pending: null });
  return b;
}

/** Log copies of events drop the board snapshots (they are only for replaying the result). */
function forLog(events: GameEvent[]): GameEvent[] {
  return events.map((e) => {
    if (!e.snap) return e;
    const { snap: _snap, ...rest } = e;
    void _snap;
    return rest;
  });
}

function finish(ctx: Ctx, base: GameState, input: ActionInput, plan: PlanSummaryForLog | undefined, decisions: DecisionRecord[]): ExecutionResult {
  const s = ctx.s;
  ctx.flushDice();
  s.pending = null;
  const outcome: LogEntry['outcome'] = ctx.touchdown ? 'touchdown' : ctx.turnover ? 'turnover' : ctx.completed ? 'completed' : 'stopped';
  const entry: LogEntry = {
    id: (base.log[base.log.length - 1]?.id ?? 0) + 1,
    team: base.turn.active,
    turn: base.teams[base.turn.active].turn,
    title: describeInput(base, input),
    plan,
    input,
    events: forLog(ctx.events),
    decisions,
    outcome,
  };
  s.log = [...base.log, entry];
  const status = ctx.touchdown ? 'touchdown' : ctx.turnover ? 'turnover' : 'completed';
  return { status, state: s, events: ctx.events };
}

function run(base: GameState, input: ActionInput, decisions: DecisionRecord[], plan: PlanSummaryForLog | undefined, original: GameState, dice?: (s: GameState) => DiceSource): ExecutionResult {
  const work = cloneState(base);
  const src = dice ? dice(work) : new RngDice(work.rng);
  const ctx = new Ctx(work, src, 'execute', decisions, DEFAULT_POLICY, null);
  try {
    runInput(ctx, input, { preview: false });
  } catch (e) {
    if (e instanceof NeedDecision) {
      work.pending = { base, input, decisions, request: e.request, events: forLog(ctx.events), plan };
      return { status: 'awaitingDecision', state: work, events: ctx.events, decision: e.request };
    }
    if (e instanceof IllegalAction) {
      return { status: 'illegal', state: original, events: [], error: e.message };
    }
    if (e instanceof ActionStop) {
      // runInput handles ActionStop itself; reaching here means an end-of-turn stop
    } else {
      throw e;
    }
  }
  return finish(ctx, base, input, plan, decisions);
}

/**
 * Execute a confirmed action. Dice are rolled from the RNG stored in the
 * state. If a coach decision is needed the result has status
 * 'awaitingDecision' and `state.pending` describes it; call `decide` next.
 */
export function execute(state: GameState, input: ActionInput, plan?: PlanSummaryForLog, dice?: (s: GameState) => DiceSource): ExecutionResult {
  if (state.pending) return { status: 'illegal', state, events: [], error: 'A decision is pending.' };
  if (state.phase !== 'play' && !isMatchInput(input) && input.kind !== 'wizard') return { status: 'illegal', state, events: [], error: 'The game is not in play.' };
  // Reject illegal inputs before any dice are rolled (same checks as planning).
  const errors = validateInput(state, input);
  if (errors.length) return { status: 'illegal', state, events: [], error: errors.join(' ') };
  const base = stripForBase(state);
  return run(base, input, [], plan, state, dice);
}

/** Answer the pending decision and continue the action (deterministic replay). */
export function decide(state: GameState, choice: DecisionChoice, dice?: (s: GameState) => DiceSource): ExecutionResult {
  const pend = state.pending;
  if (!pend) return { status: 'illegal', state, events: [], error: 'No decision is pending.' };
  if (choice.requestId !== pend.request.id) return { status: 'illegal', state, events: [], error: `Decision ${choice.requestId} does not match the pending request ${pend.request.id}.` };
  const opt = pend.request.options.find((o) => o.id === choice.optionId);
  if (!opt) return { status: 'illegal', state, events: [], error: `Unknown option ${choice.optionId}.` };
  const rec: DecisionRecord = { requestId: pend.request.id, team: pend.request.team, prompt: pend.request.prompt, optionId: opt.id, label: opt.label };
  return run(pend.base, pend.input, [...pend.decisions, rec], pend.plan, state, dice);
}

export function lastEvents(state: GameState): GameEvent[] {
  if (state.pending) return state.pending.events;
  return state.log[state.log.length - 1]?.events ?? [];
}
