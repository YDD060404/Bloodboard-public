/**
 * AI API v2 services: generic legal-choice discovery, validation, and the forkable coach-controlled simulation.
 * All of them run on copies; a handle is isolated (it holds its own clone), bound to the request's revision, bounded
 * in number and depth, and disposable. Nothing here reveals the dice generator, its seed/counter or a future die.
 */
import type { ActionInput, GameEvent, StepNode } from '../engine/index';
import { E } from '../ai/engine';
import { fail, type Session } from './session';
import { legalChoices, legalTargets, validateChoice } from './choices';
import { spatialService, SPATIAL_SERVICE_NAMES } from './spatial';

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

export const V2_SERVICE_NAMES = ['legalChoices', 'legalTargets', 'validate', 'fork.open', 'fork.step', 'fork.close', ...SPATIAL_SERVICE_NAMES];

export const FORK_LIMITS = { maxForks: 64, maxDepth: 200, maxCallMs: 5000 };

interface Fork {
  id: string;
  posKey: string;
  input: ActionInput;
  path: number[];
  controlTeam?: 'A' | 'B';
  controlAll?: boolean;
  /** The node the handle is waiting at (a terminal handle accepts no more steps). */
  at: 'chance' | 'decision' | 'terminal' | 'illegal';
  closed: boolean;
}

const forksOf = new WeakMap<Session, Map<string, Fork>>();
const store = (ses: Session) => {
  let m = forksOf.get(ses);
  if (!m) forksOf.set(ses, (m = new Map()));
  return m;
};
let forkSeq = 1;

const brief = (evs: GameEvent[]) => evs.map((e) => ({ type: e.type, text: e.text }));

function present(ses: Session, f: Fork, n: StepNode, parentKey: string): Record<string, unknown> {
  f.at = n.node;
  if (n.node === 'illegal') return { node: 'illegal', errors: n.errors };
  const base = { node: n.node, fork: f.id, depth: f.path.length, p: n.p, revisionBound: true };
  if (n.node === 'chance') return { ...base, dice: n.dice, display: n.display ?? null, rolledBy: n.by, branches: n.branches, unresolvedMass: n.unresolved, exact: n.unresolved < 1e-9, events: brief(n.events), howToContinue: 'fork.step({ fork, branch: <index> })' };
  if (n.node === 'decision') return { ...base, decisionOf: n.team, requestId: n.requestId, type: n.type, prompt: n.prompt, branches: n.branches, defaultBranch: n.defaultIndex, events: brief(n.events), howToContinue: 'fork.step({ fork, branch: <index> })' };
  const parent = ses.position(parentKey);
  const key = ses.addPosition(n.state, !!n.touchdown, parent, `fork:${f.id}`, 'fork.step');
  return { ...base, completed: n.completed, turnover: n.turnover, touchdown: n.touchdown, events: brief(n.events), position: key, howToContinue: key ? 'The terminal position is a normal position key: pass it as `from` to evaluate / legalChoices / candidates / explore / fork.open.' : 'No more positions can be kept in this request (see diagnostics).' };
}

export function v2Service(ses: Session, name: string, a: unknown[]): unknown {
  switch (name) {
    case 'legalChoices': {
      const o = obj(a[0]);
      const pos = ses.position(o.from);
      const team = o.team === 'A' || o.team === 'B' ? o.team : pos.state.turn.active;
      const r = legalChoices(ses.cloneOf(pos), team);
      return { ...r, position: pos.key };
    }
    case 'legalTargets': {
      const o = obj(a[0]);
      const pos = ses.position(o.from);
      const team = o.team === 'A' || o.team === 'B' ? o.team : pos.state.turn.active;
      const ms = Math.min(Number(o.maxMs) || 1500, FORK_LIMITS.maxCallMs);
      const r = legalTargets(ses.cloneOf(pos), team, { choice: String(o.choice ?? ''), actor: typeof o.actor === 'string' ? o.actor : undefined, param: String(o.param ?? ''), partial: obj(o.partial), region: o.region as never, offset: Number(o.offset) || 0, limit: Number(o.limit) || undefined, includeIllegal: !!o.includeIllegal, deadline: Date.now() + ms });
      return r.ok ? { ...r, position: pos.key } : fail('invalid-argument', r.message);
    }
    case 'playerDestinations':
    case 'spatialMask':
      return spatialService(ses, name, a);
    case 'validate': {
      const pos = ses.position(obj(a[1]).from);
      const input = a[0] as ActionInput;
      if (!input || typeof input !== 'object' || typeof (input as { kind?: unknown }).kind !== 'string') return fail('invalid-argument', 'validate needs an input object with a `kind`.');
      const r = validateChoice(ses.cloneOf(pos), input);
      return { ok: true, legal: r.legal, errors: r.errors, position: pos.key };
    }
    case 'fork.open': {
      const o = obj(a[0]);
      const input = o.input as ActionInput;
      if (!input || typeof input !== 'object') return fail('invalid-argument', 'fork.open needs { input }.');
      const forks = store(ses);
      if (forks.size >= FORK_LIMITS.maxForks) return fail('call-cap', `At most ${FORK_LIMITS.maxForks} open forks per request; close some with fork.close.`);
      const pos = ses.position(o.from);
      const f: Fork = { id: `f${forkSeq++}`, posKey: pos.key, input, path: [], controlTeam: o.controlTeam === 'A' || o.controlTeam === 'B' ? o.controlTeam : undefined, controlAll: !!o.controlAll, at: 'chance', closed: false };
      const n = E.stepNode(ses.cloneOf(pos), input, [], { controlTeam: f.controlTeam, controlAll: f.controlAll });
      if (n.node === 'illegal') return fail('illegal', n.errors[0] ?? 'The input is not legal here.', { errors: n.errors });
      forks.set(f.id, f);
      return { ok: true, fork: f.id, from: pos.key, ...present(ses, f, n, pos.key) };
    }
    case 'fork.step': {
      const o = obj(a[0]);
      const f = store(ses).get(String(o.fork));
      if (!f || f.closed) return fail('stale-key', `Unknown or closed fork "${String(o.fork)}" (forks are valid only during the request that opened them).`);
      if (f.at === 'terminal') return fail('invalid-argument', 'This fork has already reached the end of the action; open a new fork from its position.');
      if (f.path.length >= FORK_LIMITS.maxDepth) return fail('depth-limit', `Forks are limited to ${FORK_LIMITS.maxDepth} steps.`);
      const b = Number(o.branch);
      if (!Number.isInteger(b) || b < 0) return fail('invalid-argument', 'fork.step needs { fork, branch: <index of a branch of the current node> }.');
      const pos = ses.position(f.posKey);
      // The chosen branch must exist at the node the handle waits at (the previous result listed them): step with it, re-checking.
      const here = E.stepNode(ses.cloneOf(pos), f.input, f.path, { controlTeam: f.controlTeam, controlAll: f.controlAll });
      if ((here.node === 'chance' || here.node === 'decision') && b >= here.branches.length) return fail('invalid-argument', `This node has ${here.branches.length} branches (0..${here.branches.length - 1}).`);
      const next = E.stepNode(ses.cloneOf(pos), f.input, [...f.path, b], { controlTeam: f.controlTeam, controlAll: f.controlAll });
      if (next.node === 'illegal') return fail('illegal', next.errors[0] ?? 'Not legal.', { errors: next.errors });
      let target = f;
      if (o.copy) {
        // `copy: true` leaves this handle where it is and returns a NEW handle one step further: how a coach explores several branches of the same node.
        const forks = store(ses);
        if (forks.size >= FORK_LIMITS.maxForks) return fail('call-cap', `At most ${FORK_LIMITS.maxForks} open forks per request; close some with fork.close.`);
        target = { ...f, id: `f${forkSeq++}`, path: f.path.slice() };
        forks.set(target.id, target);
      }
      target.path = [...target.path, b];
      // Joint probability: the node's `p` is the product of every chance branch taken so far (decisions carry probability 1).
      return { ok: true, fork: target.id, parent: o.copy ? f.id : null, ...present(ses, target, next, f.posKey) };
    }
    case 'fork.close': {
      const f = store(ses).get(String(obj(a[0]).fork ?? a[0]));
      if (f) { f.closed = true; store(ses).delete(f.id); }
      return { ok: true, closed: !!f, open: store(ses).size };
    }
  }
  return fail('unsupported', `Unknown service "${name}".`);
}
