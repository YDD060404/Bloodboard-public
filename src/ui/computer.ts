/**
 * The computer opponent in the interface, and the move advisor.
 *
 * The computer coach acts only through the same engine inputs as a human
 * coach (execute / decide), one at a time, and looks again after every result.
 * Its dice appear in the normal dice tray and log. Thinking runs in small
 * slices so the board keeps painting. The advisor uses exactly the same
 * evaluation for the human's side but never acts: it only suggests.
 */
import { avatarFor } from './avatarui';
import type { App, ComputerRecord } from './app';
import { animationRemaining } from './animate';
import { h, pct } from './dom';
import { E, type ActionInput, type CoachRef, type GameState, type PlayerActionInput, type TakeoverMode, type TeamId } from './engine-global';
import { bindEngine, coachById, fallbackCoach, hooked, legacyAiId, NO_FILE_FALLBACK, OBJECTIVE_LABEL, paramsFor, planNext, think, usableCoaches, waitingFor, type AIDecision, type AIMove, type Candidate, type CoachEntry } from '../ai/index';
import { lastStrategyMeta, strategyDecide, strategyMove } from './strategy';
import { receipt } from '../platform/v2obs';
import { builtinMoveInWorker } from './enginepool';
import { tickClock } from './clock';
import type { ComputerSpeed } from './app';

bindEngine(E);

/** V5.5: a computer-coached team of the current match, with the AI file that coaches it. */
export interface CoachCfg {
  team: TeamId;
  /** The AI file id recorded in the match. */
  ai: string;
  /** The AI file that plays: the recorded one, or — when it is not installed here — the fallback (see `missing`). */
  entry: CoachEntry;
  /** The recorded AI file is not installed on this computer: `entry` is the fallback. */
  missing: boolean;
  /** The recorded name and version (as shown in the log). */
  name: string;
  version: string;
  /** A temporary coaching takeover of a human-coached team. */
  takeover?: CoachRef['takeover'];
}

const fmtOf = (g: GameState): 'standard' | 'sevens' => (g.variant === 'sevens' ? 'sevens' : 'standard');

/**
 * The AI file for a recorded id: the installed file, else the bundled Balanced file / the first valid file (noted as
 * a fallback), else — no AI file installed at all — the built-in algorithm's default parameters (labelled as such).
 */
export function resolveAIFile(id: string | undefined, style?: string, format?: 'standard' | 'sevens'): { entry: CoachEntry; missing: boolean } {
  const want = legacyAiId(id, style);
  const e = coachById(want);
  if (e && !e.errors?.length) return { entry: e, missing: false };
  return { entry: fallbackCoach(format) ?? NO_FILE_FALLBACK, missing: true };
}

export const aiLabel = (e: Pick<CoachEntry, 'name' | 'version'>) => `${e.name} ${e.version}`;

/** A coach reference for the match record (id, name, version of the file). */
export const coachRef = (e: CoachEntry): CoachRef => ({ ai: e.id, name: e.name, version: e.version });

/** Every computer-coached team of the match on the board (none, one, or both — a match to watch). */
export function computerCoaches(app: App, g: GameState = app.game): CoachCfg[] {
  if (app.st.ctx.kind !== 'match' || !g.match) return [];
  const out: CoachCfg[] = [];
  for (const t of ['A', 'B'] as TeamId[]) {
    const c = E.coachOf(g, t);
    if (!c) continue;
    const r = resolveAIFile(c.ai, c.style, fmtOf(g));
    out.push({ team: t, ai: legacyAiId(c.ai, c.style), entry: r.entry, missing: r.missing, name: c.name ?? (r.missing ? c.ai : r.entry.name), version: c.version ?? (r.missing ? '' : r.entry.version), takeover: c.takeover });
  }
  return out;
}

/** The first computer-coached team (older code paths: one computer opponent). */
export function computerOf(app: App): { team: TeamId } | null {
  const c = computerCoaches(app)[0];
  return c ? { team: c.team } : null;
}

export function coachFor(app: App, t: TeamId | null | undefined): CoachCfg | undefined {
  return t ? computerCoaches(app).find((c) => c.team === t) : undefined;
}

export function isComputerTeam(app: App, t: TeamId | null | undefined): boolean {
  return !!coachFor(app, t);
}

/** V7-05/12: a team whose coach sits at the other end of a network match (or any team, for a spectator): this client sends nothing for it. */
export function remoteHeld(app: App, t: TeamId | null | undefined): boolean {
  return !!app.lan?.active && !!t && t !== app.lan.mySeat;
}

/** Controls for `t` are not offered on this device (a computer coach or another device's coach). */
export function controlledElsewhere(app: App, t: TeamId | null | undefined): boolean {
  return isComputerTeam(app, t) || remoteHeld(app, t);
}

/** Both teams are coached by the computer: the human watches (V5.5). */
export function spectating(app: App): boolean {
  return computerCoaches(app).length === 2;
}

/** The game is waiting for a computer coach (its Turn, its set-up or kick-off, or a decision addressed to it). */
export function computerToAct(app: App, g: GameState = app.game): boolean {
  if (app.st.ctx.kind === 'replay') return false; // a Replay never runs a coach
  const w = waitingFor(g);
  return !!w && isComputerTeam(app, w);
}

/** V5.5: watching speed — pauses before the computer acts and between its dice (ms). */
export const SPEEDS: Record<ComputerSpeed, { label: string; think: number; dice: number }> = {
  slow: { label: 'Slow', think: 1400, dice: 1800 },
  normal: { label: 'Normal', think: 500, dice: 900 },
  fast: { label: 'Fast', think: 30, dice: 250 },
  instant: { label: 'Instant', think: 0, dice: 0 },
};

function speedOf(app: App) {
  const cs = app.st.computer;
  return SPEEDS[cs.speed ?? (cs.fast ? 'fast' : 'normal')];
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let token = 0;

/**
 * Run `fn` after `ms` (one pending timer at a time). Afterwards the driver
 * looks again: a timer set for one purpose (say, advancing the computer's
 * dice) may fire when that is no longer needed — the human already pressed
 * Continue, or ended the Turn meanwhile — and without a new look the computer
 * would wait for the next re-draw (a mouse move) before starting to think.
 */
function schedule(app: App, fn: () => void, ms: number) {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    fn();
    if (!running) driveComputer(app);
  }, ms);
}

/** Stop whatever the computer was about to do (a new board, Undo, Pause). */
export function interruptComputer(app: App) {
  token++;
  if (timer) clearTimeout(timer);
  timer = null;
  running = false;
  app.st.computer.thinking = false;
  app.st.computer.progress = null;
}

// ---------------------------------------------------------------------------
// Changing coaches during a match (V5.5)
// ---------------------------------------------------------------------------

export interface CoachChangeRequest {
  coach: CoachRef | null;
  /** Shown while it waits and in the toast when it is applied. */
  why: string;
  /** Asked for by the human (not the automatic end of a takeover): dice still being revealed are shown at once. */
  explicit?: boolean;
}

const sameCoach = (a: CoachRef | null, b: CoachRef | null) => (!a && !b) || (!!a && !!b && legacyAiId(a.ai, a.style) === b.ai && !a.takeover === !b.takeover && a.takeover?.mode === b.takeover?.mode);

/**
 * A safe decision boundary: no decision is pending and no dice are still being revealed — the current action and its
 * decisions are finished. (An open activation may continue under the new coach: every input is complete by itself.)
 */
export function atSafeBoundary(app: App): boolean {
  return !app.game.pending && !app.playbackActive();
}

/** Ask for a change of a team's coach; it is applied at the next safe boundary (at once if the game is at one). */
export function requestCoachChange(app: App, team: TeamId, coach: CoachRef | null, why: string) {
  const cs = app.st.computer;
  const cur = E.coachOf(app.game, team);
  const changes = { ...(cs.changes ?? {}) };
  if (sameCoach(cur, coach)) delete changes[team];
  else changes[team] = { coach, why, explicit: true };
  cs.changes = changes;
  if (!applyPendingChanges(app)) app.emit();
}

export function cancelCoachChange(app: App, team: TeamId) {
  const cs = app.st.computer;
  if (!cs.changes?.[team]) return;
  const changes = { ...cs.changes };
  delete changes[team];
  cs.changes = changes;
  app.emit();
}

/** Apply waiting coach changes if the game is at a safe boundary. Returns true when something was applied. */
function applyPendingChanges(app: App): boolean {
  const cs = app.st.computer;
  const ch = cs.changes;
  if (!ch || !Object.keys(ch).length || app.st.ctx.kind !== 'match' || !app.game.match) return false;
  // Dice of a finished action still being revealed: show the rest at once (the results are already decided).
  if (!app.game.pending && app.playbackActive() && Object.values(ch).some((c) => c?.explicit)) app.skipPlayback();
  if (!atSafeBoundary(app)) return false;
  // Whatever the computer was thinking about belongs to the old coaches: drop it (nothing of it has been played).
  interruptComputer(app);
  app.st.computer.advisor = null;
  let applied = false;
  for (const t of ['A', 'B'] as TeamId[]) {
    const c = ch[t];
    if (!c) continue;
    delete ch[t];
    if (sameCoach(E.coachOf(app.game, t), c.coach)) continue;
    // A plan being drafted for that team by the human is dropped when the computer takes the team.
    const draftTeam = app.st.draft ? app.player(app.st.draft.playerId)?.team : undefined;
    if (c.coach && draftTeam === t) app.cancelDraft(false);
    const before = app.game;
    app.runSimple({ kind: 'coachChange', team: t, coach: c.coach }, 'human');
    if (app.game !== before) {
      applied = true;
      app.toast(c.why);
    }
  }
  cs.changes = {};
  return applied;
}

const TAKEOVER_LABEL: Record<TakeoverMode, string> = { activation: 'one player activation', turn: 'the rest of this Turn', untilBack: 'until you take control back' };

/** Why a temporary takeover is over now (null: it goes on). */
function takeoverOver(g: GameState, c: CoachCfg): string | null {
  const t = c.takeover;
  if (!t || t.mode === 'untilBack') return null;
  const sameTurn = g.phase === 'play' && g.turn.active === c.team && g.teams[c.team].turn === t.turn && ((g.match?.half ?? 1) === 2 ? 2 : 1) === t.half && !g.match?.pendingPhase;
  if (!sameTurn) return t.mode === 'turn' ? 'the Turn is over' : 'the Turn ended';
  if (t.mode === 'activation') {
    const acted = g.log.some((e) => e.id > t.since && (e.input.kind === 'playerAction' || e.input.kind === 'endActivation' || e.input.kind === 'forgo'));
    const first = takeoverPlayer(g, t.since);
    if (acted && (!g.turn.activation || (first && g.turn.activation.playerId !== first))) return 'the player activation is complete';
  }
  return null;
}

/** The player a one-activation takeover activated (the first player acting after it began). */
function takeoverPlayer(g: GameState, since: number): string | null {
  for (const e of g.log) if (e.id > since && e.input.kind === 'playerAction') return e.input.playerId;
  return null;
}

/** End the takeovers that are over (at a safe boundary). */
function endTakeovers(app: App): boolean {
  if (!atSafeBoundary(app)) return false;
  let any = false;
  for (const c of computerCoaches(app)) {
    const why = takeoverOver(app.game, c);
    if (!why || app.st.computer.changes?.[c.team]) continue;
    app.st.computer.changes = { ...(app.st.computer.changes ?? {}), [c.team]: { coach: null, why: `Takeover over (${why}): you coach ${app.game.teams[c.team].name} again.` } };
    any = true;
  }
  return any && applyPendingChanges(app);
}

/** The human team a takeover could start for now (and whether one activation / the rest of the Turn is possible). */
export function takeoverTarget(app: App): { team: TeamId; now: boolean } | null {
  const g = app.game;
  if (app.st.ctx.kind !== 'match' || !g.match || g.phase === 'fullTime') return null;
  const humans = (['A', 'B'] as TeamId[]).filter((t) => !E.coachOf(g, t));
  if (!humans.length) return null;
  const w = waitingFor(g);
  const team = humans.length === 1 ? humans[0] : w && humans.includes(w) ? w : g.turn.active;
  const now = g.phase === 'play' && !g.match.pendingPhase && g.turn.active === team && !g.pending;
  return { team, now };
}

/** Start a temporary takeover of a human-coached team by the advisory coach's AI file. */
export function startTakeover(app: App, team: TeamId, mode: TakeoverMode) {
  const { entry, missing } = resolveAIFile(app.st.computer.advisorAi, undefined, fmtOf(app.game));
  if (missing && entry === NO_FILE_FALLBACK) return app.toast('No AI file is installed: restore the bundled AI files (match set-up) or add one to the AI folder.', 'error');
  const ref: CoachRef = { ...coachRef(entry), takeover: { mode, half: 1, turn: 0, since: 0 } };
  requestCoachChange(app, team, ref, `${aiLabel(entry)} coaches ${app.game.teams[team].name} for ${TAKEOVER_LABEL[mode]}.`);
}

/** Take control back from a takeover (or from a permanent computer coach of one's own team). */
export function takeBack(app: App, team: TeamId) {
  requestCoachChange(app, team, null, `You coach ${app.game.teams[team].name} again.`);
}

/** Called after every render: applies coach changes at safe boundaries and lets the computer act when it is its turn to. */
export function driveComputer(app: App) {
  const cs = app.st.computer;
  if (app.st.screen !== 'board' || app.st.ctx.kind !== 'match') return;
  if (applyPendingChanges(app) || endTakeovers(app)) return;
  if (!computerCoaches(app).length || app.st.modal) return;
  const sp = speedOf(app);
  if (app.playbackActive()) {
    // The computer's dice advance by themselves (Continue / Space goes faster); Pause stops them too.
    if (app.st.playback?.by === 'computer' && !cs.paused) schedule(app, () => app.playbackActive() && !app.st.computer.paused && app.advancePlayback(), sp.dice + animationRemaining());
    return;
  }
  if (cs.paused || running) return;
  // V5.5: watching a computer v computer match — the shared steps (pre-game, End of Drive) go on by themselves too.
  if (spectating(app) && !app.game.pending) {
    const g = app.game;
    if (g.phase === 'pregame' || g.phase === 'touchdown' || g.phase === 'halfOver') {
      schedule(app, () => {
        const h = app.game;
        if (app.st.computer.paused || h !== g || h.pending) return;
        app.runSimple(h.phase === 'pregame' ? { kind: 'pregame' } : { kind: 'nextDrive' }, 'computer');
      }, sp.think);
      return;
    }
  }
  if (!computerToAct(app)) return;
  schedule(app, () => startThinking(app), sp.think);
}

function whenLabel(g: GameState, team: TeamId): string {
  if (g.phase === 'play') return g.match?.pendingPhase?.type === 'charge' ? 'Charge!' : `Turn ${g.teams[team].turn} · half ${g.match?.half ?? 1}`;
  if (g.phase === 'driveSetup') return 'Set-up';
  if (g.phase === 'kickoff') return 'Kick-off';
  return g.phase;
}

/** Missing AI files already reported (a saved match whose AI file is not installed here). */
const reportedMissing = new Set<string>();

function startThinking(app: App) {
  const game = app.game;
  const c = coachFor(app, waitingFor(game));
  if (!c || app.st.computer.paused || !computerToAct(app) || app.playbackActive() || app.st.modal || Object.keys(app.st.computer.changes ?? {}).length) return;
  const mine = ++token;
  running = true;
  app.st.computer.thinking = true;
  app.emit();
  if (c.missing && !reportedMissing.has(c.ai)) {
    reportedMissing.add(c.ai);
    app.toast(`The AI file “${c.name}${c.version ? ` ${c.version}` : ''}” (id ${c.ai}) chosen for ${game.teams[c.team].name} is not installed on this computer — ${aiLabel(c.entry)} plays instead. Change the coach in the Coaches card.`, 'error');
  }
  // Strategy modules decide in their own worker (strategy.ts); parameter files configure the built-in algorithm.
  if (c.entry.kind === 'strategy' && c.entry.code) {
    void strategyMove(app, game, c).then((mv) => {
      if (mine !== token || app.game !== game) return;
      running = false;
      app.st.computer.thinking = false;
      if (!mv) return app.emit();
      apply(app, game, c, mv);
    });
    return;
  }
  const finishBuiltin = (mv: AIMove | null) => {
    running = false;
    app.st.computer.thinking = false;
    if (!mv) {
      app.emit();
      return;
    }
    apply(app, game, c, mv);
  };
  // The built-in algorithm's decision runs in an engine worker (V5.7: off the interface thread); without workers it runs here in slices.
  const sliced = () => {
    const gen = planNext(game, c.team, 'balanced', {}, { profile: c.entry.profile });
    const slice = () => {
      if (mine !== token || app.game !== game) {
        running = false;
        return;
      }
      const t0 = performance.now();
      let r: IteratorResult<string, AIMove | null>;
      do r = gen.next();
      while (!r.done && performance.now() - t0 < 35);
      if (!r.done) {
        setTimeout(slice, 0);
        return;
      }
      finishBuiltin(r.value);
    };
    setTimeout(slice, 0);
  };
  void builtinMoveInWorker(game, c.team, c.entry.profile, () => mine !== token || app.game !== game).then((mv) => {
    if (mine !== token || app.game !== game) {
      running = false;
      return;
    }
    if (mv === undefined) sliced();
    else finishBuiltin(mv);
  });
}

function record(app: App, rec: ComputerRecord) {
  const list = app.st.computer.records;
  list.push(rec);
  if (list.length > 60) list.splice(0, list.length - 60);
}

/** V6: after a strategy coach's answer was applied, the host's execution receipt (public facts only) is kept for the log and for tests. */
function apply(app: App, game: GameState, c: CoachCfg, mv: AIMove) {
  const before = app.game;
  applyMove(app, game, c, mv);
  if (c.entry.kind !== 'strategy') return;
  const after = app.game;
  if (after === before || after.log.length <= before.log.length) return;
  const m = lastStrategyMeta();
  const input = mv.type === 'decision' ? null : mv.input;
  const r = receipt(before, after, { requestId: m?.requestId ?? null, input, coach: c.entry.id, via: m?.via ?? 'unknown', fellBack: !!m?.fellBack, reason: m?.reason ?? null });
  const w = window as unknown as { bloodboardReceipts?: unknown[] };
  const list = (w.bloodboardReceipts ??= []);
  list.push({ team: c.team, receipt: r });
  if (list.length > 200) list.splice(0, list.length - 200);
}

function applyMove(app: App, game: GameState, c: CoachCfg, mv: AIMove) {
  const team = c.team;
  const when = `${whenLabel(game, team)}${c.takeover ? ' · takeover' : ''}`;
  // A takeover for one activation: once its player has acted, the coach choosing another player (or the end of the
  // Turn) means that activation is complete — it is closed (End activation) and control goes back. It never ends the
  // human's Turn.
  if (c.takeover?.mode === 'activation' && mv.type === 'action') {
    const first = takeoverPlayer(game, c.takeover.since);
    const other = mv.input.kind === 'endTurn' || (mv.input.kind === 'playerAction' && !!first && mv.input.playerId !== first);
    if (other) {
      if (first && game.turn.activation?.playerId === first) {
        record(app, { team, when, kind: 'step', text: `${E.describeInput(game, { kind: 'endActivation' })}: the takeover's activation is complete.`, objective: null, urgent: false, alternatives: [], millis: 0 });
        app.runSimple({ kind: 'endActivation' }, 'computer');
        return;
      }
      if (mv.input.kind === 'endTurn') {
        record(app, { team, when, kind: 'step', text: `${aiLabel(c.entry)} would end the Turn here rather than activate a player — control handed back without ending the Turn.`, objective: null, urgent: false, alternatives: [], millis: 0 });
        app.st.computer.changes = { ...(app.st.computer.changes ?? {}), [team]: { coach: null, why: `${aiLabel(c.entry)} would end the Turn here, so it hands ${game.teams[team].name} back to you without ending the Turn.` } };
        app.emit();
        return;
      }
    }
  }
  if (mv.type === 'decision') {
    const req = game.pending?.request;
    if (!req) return;
    const opt = req.options.find((o) => o.id === mv.optionId);
    record(app, { team, when, kind: 'decision', text: `${req.prompt} → ${opt?.label ?? mv.optionId}. ${mv.why}`, objective: null, urgent: false, alternatives: [], millis: 0 });
    app.decide(req, mv.optionId, 'computer');
    return;
  }
  if (mv.type === 'step') {
    record(app, { team, when, kind: 'step', text: `${E.describeInput(game, mv.input)}: ${mv.why}`, objective: null, urgent: false, alternatives: [], millis: 0 });
    app.runSimple(mv.input, 'computer');
    return;
  }
  const d = mv.decision;
  record(app, {
    team,
    when,
    kind: 'action',
    text: d.reason,
    objective: OBJECTIVE_LABEL[d.objective.id],
    urgent: d.objective.urgent,
    alternatives: d.candidates
      .filter((k) => k.gain !== undefined && k !== d.chosen)
      .slice(0, 3)
      .map((k) => ({ label: k.label, gain: k.gain as number, pSuccess: k.pSuccess, pTurnover: k.pTurnover, pTouchdown: k.pTouchdown })),
    millis: d.millis,
  });
  if (mv.input.kind === 'playerAction') app.runComputerAction(mv.input);
  else app.runSimple(mv.input, 'computer');
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

/** V5.6: live notes from a coach that is still calculating — what it is weighing, what it has ruled out, the best so far. */
function renderProgress(p: NonNullable<App['st']['computer']['progress']>, g: GameState): HTMLElement {
  const last = p.updates[p.updates.length - 1];
  const secs = Math.round(p.elapsedMs / 1000);
  const pct = (x?: number) => (x === undefined ? '' : `${Math.round(x * 100)}%`);
  const box = h('div', { class: 'computer-progress', id: 'computer-progress', 'data-team': p.team },
    h('div', { class: 'small strong' }, `${p.coach} is still calculating — ${secs} s of up to ${Math.round(p.limitMs / 1000)} s (its own limit); ${p.serviceCalls} engine look-ups so far.`));
  box.appendChild(h('div', { class: 'progress-bar' }, h('span', { style: `width:${Math.min(100, Math.round((p.elapsedMs / p.limitMs) * 100))}%` })));
  const en = p.engine;
  if (en) {
    // V5.7: what the engine is really doing — counters and results, never an estimate.
    const pc = (x: number) => `${(x * 100).toPrecision(x < 0.1 ? 2 : 3)}%`;
    if (en.stage) box.appendChild(h('div', { class: 'small', id: 'engine-stage' }, h('b', null, 'Now: '), en.total > 0 ? `${en.stage} — ${en.done} of ${en.total} done` : en.stage));
    const w = en.workers;
    if (w) box.appendChild(h('div', { class: 'small', id: 'engine-workers' }, h('b', null, 'Analysis workers: '), `${w.busy} of ${w.size} busy${w.queued ? `, ${w.queued} jobs waiting` : ''}; ${w.jobsDone} jobs finished`, w.workers.some((x) => x.busy) ? ` (${w.workers.filter((x) => x.busy).map((x) => x.label).join(' · ')})` : ''));
    else box.appendChild(h('div', { class: 'small muted', id: 'engine-workers' }, h('b', null, 'Analysis workers: '), 'off — the engine work runs on the interface thread.'));
    if (en.best) box.appendChild(h('div', { class: 'small', id: 'engine-best' }, h('b', null, 'Best legal option found so far: '), `${en.best.label} — value ${en.best.value >= 0 ? '+' : ''}${en.best.value.toFixed(1)}, Turnover ${pc(en.best.pTurnover)}${en.best.pTouchdown ? `, Touchdown ${pc(en.best.pTouchdown)}` : ''}${en.best.unresolved > 1e-9 ? ` (of this analysis ${pc(en.best.unresolved)} of the probability is not expanded)` : ' (exact)'}`));
    const unc = en.inexact || en.cutShort || en.maxUnresolved > 1e-9;
    box.appendChild(h('div', { class: `small ${unc ? '' : 'muted'}`, id: 'engine-uncertainty' }, h('b', null, 'Remaining uncertainty: '), unc ? `the largest unexpanded probability so far is ${pc(en.maxUnresolved)}${en.inexact ? `; ${en.inexact} result(s) are not exact` : ''}${en.cutShort ? `; ${en.cutShort} call(s) were cut short by their time limit` : ''}.` : en.calls ? 'every result so far is exact.' : 'nothing analysed yet.'));
  }
  if (last) {
    // Notes accumulate: the latest list being evaluated, everything ruled out so far, the latest best line.
    const evaluating = [...p.updates].reverse().find((u) => u.evaluating?.length)?.evaluating;
    const ruled = [...new Set(p.updates.flatMap((u) => u.ruledOut ?? []))].slice(-6);
    const best = [...p.updates].reverse().find((u) => u.best)?.best;
    box.appendChild(h('p', { class: 'small', id: 'computer-progress-headline' }, last.headline));
    if (evaluating?.length) box.appendChild(h('div', { class: 'small' }, h('b', null, 'Evaluating: '), evaluating.join(' · ')));
    if (ruled.length) box.appendChild(h('div', { class: 'small muted' }, h('b', null, 'Ruled out: '), ruled.join(' · ')));
    if (best) box.appendChild(h('div', { class: 'small' }, h('b', null, 'Best so far: '), `${best.label}${best.pTurnover !== undefined ? ` — Turnover ${pct(best.pTurnover)}` : ''}${best.pTouchdown ? `, Touchdown ${pct(best.pTouchdown)}` : ''}${best.detail ? ` — ${best.detail}` : ''}`));
  } else box.appendChild(h('p', { class: 'small muted' }, 'This coach does not report what it is weighing; the engine look-up count above shows it is working.'));
  void g;
  return box;
}

/** Status of the computer coach(es), their latest reasons and the controls (V5.5: one card for one or two coaches). */
export function renderComputerCard(app: App): HTMLElement | null {
  const coaches = computerCoaches(app);
  if (!coaches.length) return null;
  const g = app.game;
  const cs = app.st.computer;
  const watch = coaches.length === 2;
  const acting = computerToAct(app) || (watch && !g.pending && (g.phase === 'pregame' || g.phase === 'touchdown' || g.phase === 'halfOver'));
  const status = cs.thinking
    ? h('span', { class: 'pill live thinking', id: 'computer-thinking' }, h('span', { class: 'spinner' }), ' Thinking…')
    : cs.paused
      ? h('span', { class: 'pill warn', id: 'computer-paused' }, 'Paused')
      : acting
        ? h('span', { class: 'pill live' }, app.playbackActive() ? 'Rolling…' : 'Playing')
        : h('span', { class: 'pill' }, g.phase === 'fullTime' ? 'Full time' : 'Waiting');
  const coachLine = (c: CoachCfg) =>
    h(
      'div',
      { class: 'small muted coachline', 'data-team': c.team },
      h('b', null, `${g.teams[c.team].name}: `),
      `${c.name}${c.version ? ` ${c.version}` : ''}`,
      c.missing ? ` (not installed here — ${aiLabel(c.entry)} plays)` : '',
      c.takeover ? ` — temporary takeover (${TAKEOVER_LABEL[c.takeover.mode]})` : '',
      ` — ${c.entry.kind === 'strategy' ? 'strategy module' : 'parameter file of the built-in algorithm'}`,
    );
  const card = h(
    'div',
    { class: `card computer ${acting ? 'acting' : ''} ${watch ? 'spectator' : ''}`, id: 'computer-card' },
    h('div', { class: 'row-between' }, h('h3', null, watch ? '🖥 Computer v computer' : `🖥 Computer: ${g.teams[coaches[0].team].name}`), status),
    ...coaches.flatMap((c) => {
      const recs = cs.records.filter((r) => r.team === c.team || (!r.team && coaches.length === 1));
      const last = [...recs].reverse().find((r) => r.kind !== 'decision') ?? recs[recs.length - 1];
      const face = avatarFor(app, c, cs.explain && last ? last.text : null, waitingFor(g) === c.team);
      return [face ? h('div', { class: 'coachrow' }, face, coachLine(c)) : coachLine(c)];
    }),
    h('div', { class: 'btnrow' }, h('button', { class: 'btn ghost small', id: 'avatars-open', onclick: () => app.set({ modal: { kind: 'avatars' } }) }, 'Avatars…')),
  );
  if (cs.thinking && cs.progress) card.appendChild(renderProgress(cs.progress, g));
  if (watch) card.appendChild(h('p', { class: 'small', id: 'spectator-note' }, 'You are watching: both teams are coached by the computer with the same rules and dice as any match — neither coach sees future dice. Pause at any time to look at the board, the dice tray and the log; the controls never change a result.'));
  else if (acting && g.phase === 'play') card.appendChild(h('p', { class: 'small strong' }, `It is the computer's ${g.match?.pendingPhase?.type === 'charge' ? 'Charge!' : 'Turn'}. Its dice appear in the tray and the log; your clicks on the board are ignored until it has finished.`));
  // The latest reasons (each coach's in a watched match).
  for (const c of coaches) {
    const recs = cs.records.filter((r) => r.team === c.team || (!r.team && coaches.length === 1));
    const last = [...recs].reverse().find((r) => r.kind !== 'decision') ?? recs[recs.length - 1];
    if (!cs.explain || !last) continue;
    card.appendChild(
      h(
        'div',
        { class: 'computer-last', 'data-team': c.team },
        h('div', { class: 'small muted' }, `${watch ? `${g.teams[c.team].name} · ` : ''}${last.when}${last.objective ? ` · ${last.urgent ? 'urgent: ' : ''}${last.objective}` : ''}`),
        h('p', { class: 'small', id: watch ? `computer-reason-${c.team}` : 'computer-reason' }, last.text),
        last.alternatives.length
          ? h(
              'details',
              { class: 'why' },
              h('summary', null, 'Other options it weighed'),
              h(
                'ul',
                { class: 'small' },
                last.alternatives.map((a) => h('li', null, `${a.label} — value ${a.gain >= 0 ? '+' : ''}${a.gain.toFixed(1)}${a.pTurnover !== undefined && a.pTurnover > 0.005 ? `, Turnover ${pct(a.pTurnover, 0)}` : ''}${a.pTouchdown ? `, score ${pct(a.pTouchdown, 0)}` : ''}`)),
              ),
              h('p', { class: 'small muted' }, 'Values are the expected change of the computer’s position score (a Touchdown = 100), with the chance of a Turnover charged against the rest of its Turn. Probabilities count every dice outcome of the action as the engine plays it (Team Re-rolls used where the plan preview would use them); branches rarer than 0.01% are estimated.'),
            )
          : null,
      ),
    );
  }
  if (cs.explain && cs.records.length > 1) {
    const lastAll = cs.records[cs.records.length - 1];
    card.appendChild(
      h(
        'details',
        { class: 'why' },
        h('summary', null, `Earlier this match (${cs.records.length - 1})`),
        h('ol', { class: 'small computer-history', reversed: true }, cs.records.filter((r) => r !== lastAll).slice(-12).reverse().map((r) => h('li', null, h('span', { class: 'muted' }, `${watch && r.team ? `${g.teams[r.team].name} · ` : ''}${r.when}: `), r.text))),
      ),
    );
  }
  const speed = cs.speed ?? (cs.fast ? 'fast' : 'normal');
  card.appendChild(
    h(
      'div',
      { class: 'btnrow tight' },
      acting || cs.paused || watch
        ? h('button', { class: 'btn small', id: 'computer-pause', onclick: () => togglePause(app) }, cs.paused ? '▶ Resume' : '❚❚ Pause')
        : null,
      h(
        'span',
        { class: 'seg small', id: 'computer-speed', title: 'How fast the computer acts and rolls (it never changes the results)' },
        (Object.keys(SPEEDS) as ComputerSpeed[]).map((k) => h('button', { class: `segbtn ${speed === k ? 'on' : ''}`, 'data-speed': k, onclick: () => { cs.speed = k; cs.fast = k === 'fast' || k === 'instant'; app.savePrefs(); app.emit(); } }, SPEEDS[k].label)),
      ),
      h('label', { class: 'small check', title: 'Show why the computer chose each action' }, h('input', { type: 'checkbox', checked: cs.explain, onchange: (e: Event) => { cs.explain = (e.target as HTMLInputElement).checked; app.savePrefs(); app.emit(); } }), ' Explain its moves'),
    ),
  );
  return card;
}

/**
 * V5.5: who coaches each team now, and the controls to change it during the match — Human or Computer and the AI file
 * for Player 1 and Player 2, a temporary takeover by the advisory coach, and taking control back. Changes wait for a
 * safe moment (the current action and its decisions finish first), change nothing else and are written to the log.
 */
export function renderCoachesCard(app: App): HTMLElement | null {
  const g = app.game;
  if (app.st.ctx.kind !== 'match' || !g.match) return null;
  const cs = app.st.computer;
  const open = !!cs.coachesOpen;
  const fmt = fmtOf(g);
  const files = usableCoaches(fmt);
  const adv = advisoryCoach(app);
  const card = h('div', { class: `card coaches ${open ? 'open' : ''}`, id: 'coaches-card' });
  card.appendChild(
    h(
      'div',
      { class: 'row-between' },
      h('h4', null, 'Coaches'),
      h('button', { class: 'btn small ghost', id: 'coaches-toggle', 'aria-expanded': open ? 'true' : 'false', title: 'Change who coaches each team (Human or Computer and its AI file) and your advisory coach', onclick: () => { cs.coachesOpen = !open; app.emit(); } }, open ? 'Done ▾' : 'Change ▸'),
    ),
  );
  const pname = (t: TeamId) => `${t === 'A' ? 'Player 1' : 'Player 2'} · ${g.teams[t].name}`;
  for (const t of ['A', 'B'] as TeamId[]) {
    const ref = E.coachOf(g, t);
    const cfg = coachFor(app, t);
    const pend = cs.changes?.[t];
    const who = !ref ? 'Human' : `${cfg?.takeover ? 'Takeover — ' : 'Computer — '}${cfg?.name ?? ref.name ?? ref.ai}${(cfg?.version ?? ref.version) ? ` ${cfg?.version ?? ref.version}` : ''}`;
    const row = h(
      'div',
      { class: 'coachrow', 'data-team': t, id: `coach-${t}` },
      h('div', { class: 'small' }, h('b', null, `${pname(t)}: `), h('span', { id: `coach-${t}-now` }, who)),
      cfg?.missing ? h('div', { class: 'small warn' }, `That AI file is not installed here — ${aiLabel(cfg.entry)} plays instead.`) : null,
      cfg?.takeover
        ? h('div', { class: 'small takeover-on' }, `Temporary takeover for ${TAKEOVER_LABEL[cfg.takeover.mode]}. `, h('button', { class: 'btn small', id: `takeover-back-${t}`, disabled: !!pend, onclick: () => takeBack(app, t) }, 'Take back control'))
        : null,
      pend
        ? h(
            'div',
            { class: 'small warn', id: `coach-${t}-pending` },
            `Waiting for a safe moment — after the current action and its decisions: ${pend.coach ? `${pend.coach.takeover ? 'takeover by ' : 'computer, '}${pend.coach.name ?? pend.coach.ai}` : 'the human coach takes control'}. `,
            cs.paused && g.pending && isComputerTeam(app, g.pending.request.team) ? 'The computer answers its pending decision when you press Resume. ' : '',
            h('button', { class: 'linkbtn small', id: `coach-${t}-cancel`, onclick: () => cancelCoachChange(app, t) }, 'Cancel'),
          )
        : null,
    );
    if (open) {
      const target = pend ? pend.coach : ref;
      const isComp = !!target && !target.takeover;
      const curId = target ? legacyAiId(target.ai, target.style) : undefined;
      const pick = (id: string | undefined) => resolveAIFile(id, undefined, fmt).entry;
      const toComputer = () => {
        const e = pick(curId ?? cs.advisorAi);
        if (e === NO_FILE_FALLBACK) return app.toast('No AI file is installed: restore the bundled AI files (match set-up) or add one to the AI folder.', 'error');
        requestCoachChange(app, t, coachRef(e), `${g.teams[t].name}: coached by ${aiLabel(e)} from now on.`);
      };
      row.appendChild(
        h(
          'div',
          { class: 'coachctl' },
          h(
            'span',
            { class: 'seg small' },
            h('button', { class: `segbtn ${!isComp ? 'on' : ''}`, id: `coach-${t}-human`, onclick: () => requestCoachChange(app, t, null, `${g.teams[t].name}: the human coach takes control.`) }, 'Human'),
            h('button', { class: `segbtn ${isComp ? 'on' : ''}`, id: `coach-${t}-computer`, disabled: !files.length, onclick: toComputer }, 'Computer'),
          ),
          isComp && files.length
            ? h(
                'select',
                {
                  id: `coach-${t}-ai`,
                  class: 'small',
                  'aria-label': `AI file for ${pname(t)}`,
                  onchange: (e: Event) => {
                    const en = pick((e.target as HTMLSelectElement).value);
                    requestCoachChange(app, t, coachRef(en), `${g.teams[t].name}: coached by ${aiLabel(en)} from now on.`);
                  },
                },
                files.map((f) => h('option', { value: f.id, selected: f.id === curId }, aiLabel(f))),
              )
            : null,
        ),
      );
    }
    card.appendChild(row);
  }
  // Temporary takeover by the advisory coach (a human-coached team).
  const tt = takeoverTarget(app);
  if (tt && !cs.changes?.[tt.team] && files.length) {
    const why = 'One activation and the rest of the Turn start during your own Turn (not in a Charge!), between actions.';
    card.appendChild(
      h(
        'div',
        { class: 'takeover', id: 'takeover-row' },
        h('div', { class: 'small' }, `Let your advisory coach (${aiLabel(adv.entry)}) play for ${g.teams[tt.team].name}:`),
        h(
          'div',
          { class: 'btnrow tight' },
          h('button', { class: 'btn small', id: 'takeover-activation', disabled: !tt.now || app.playbackActive(), title: tt.now ? 'It activates one player and completes that activation, then hands back' : why, onclick: () => startTakeover(app, tt.team, 'activation') }, 'One activation'),
          h('button', { class: 'btn small', id: 'takeover-turn', disabled: !tt.now || app.playbackActive(), title: tt.now ? 'It plays the rest of this Turn (it may end the Turn), then hands back' : why, onclick: () => startTakeover(app, tt.team, 'turn') }, 'Rest of this Turn'),
          h('button', { class: 'btn small', id: 'takeover-until', title: 'It coaches this team until you press “Take back control”', onclick: () => startTakeover(app, tt.team, 'untilBack') }, 'Until I take back'),
        ),
      ),
    );
  }
  if (open) {
    card.appendChild(h('div', { class: 'coachctl advisorline' }, h('span', { class: 'small' }, 'Your advisory coach (AI Focus, takeovers): '), advisorSelect(app, 'advisor-ai')));
    card.appendChild(
      h(
        'p',
        { class: 'small muted' },
        files.length
          ? `AI files found: ${files.length}. A change waits until the current action and its decisions are finished, never touches the board, score, Turns, players, re-rolls or rules, and is written to the log. The dice difficulty house rule keeps the sides set at the start of the match.`
          : 'No AI file is installed, so only human coaches are possible: restore the bundled AI files in the match set-up, or add AI files to the AI folder.',
      ),
    );
  }
  return card;
}

// ---------------------------------------------------------------------------
// Advisor ("AI Focus"): analysis for the human coach, never acts
// ---------------------------------------------------------------------------

export interface AdvisorState {
  /** Game the analysis belongs to (a new position discards it). */
  game: GameState;
  busy: boolean;
  /** The advisory coach's AI file that produced it. */
  entry: CoachEntry;
  missing: boolean;
  decision: AIDecision | null;
  /** Rolls of the recommended action, from the plan preview. */
  steps: string[];
  error: string | null;
  /** Strategy modules: problems met (the built-in algorithm's analysis was used for that part). */
  notes: string[];
}

let advisorToken = 0;

export function canAdvise(app: App): boolean {
  const g = app.game;
  if (app.st.ctx.kind === 'lesson' || app.st.view !== 'play' || g.phase !== 'play' || g.pending || app.playbackActive()) return false;
  return !isComputerTeam(app, waitingFor(g));
}

const RELEASE_COACH_IDS = ['bloodboard-balanced', 'hopeful-1-5-9-gpt', 'hopeful-2-5-s4-37u-c-unified'];

/** The advisory coach's AI file (the chosen one, or the fallback when it is not installed). */
export function advisoryCoach(app: App): { entry: CoachEntry; missing: boolean } {
  const id = app.st.computer.advisorAi;
  return resolveAIFile(id && RELEASE_COACH_IDS.includes(id) ? id : 'bloodboard-balanced', undefined, fmtOf(app.game));
}

/** Choose the advisory coach (any valid AI file); a shown analysis of another coach is dropped. */
export function setAdvisoryCoach(app: App, id: string) {
  if (!RELEASE_COACH_IDS.includes(id)) return;
  app.st.computer.advisorAi = id;
  app.savePrefs();
  const st = app.st.computer.advisor;
  advisorToken++;
  if (st && st.game === app.game && canAdvise(app)) runAdvisor(app);
  else {
    app.st.computer.advisor = null;
    app.emit();
  }
}

/** AI Focus offers the three coaches selected for this unified release. */
export function advisorSelect(app: App, id: string): HTMLElement {
  const files = usableCoaches(fmtOf(app.game)).filter((f) => RELEASE_COACH_IDS.includes(f.id));
  if (!files.length) return h('span', { class: 'small warn', id }, 'No AI file is installed.');
  const cur = advisoryCoach(app).entry;
  return h(
    'select',
    { id, class: 'small', 'aria-label': 'Advisory coach (AI file)', title: 'The AI file that advises you (AI Focus) and takes over when you ask it to', onchange: (e: Event) => setAdvisoryCoach(app, (e.target as HTMLSelectElement).value) },
    files.map((f) => h('option', { value: f.id, selected: f.id === cur.id }, aiLabel(f))),
  );
}

/**
 * Ask the advisory coach for advice on the current position: read-only — the analysis runs on the position as it is
 * (the AI never sees the dice generator or future dice) and nothing is moved, rolled or ended.
 */
export function runAdvisor(app: App) {
  if (!canAdvise(app)) return;
  const game = app.game;
  const mine = ++advisorToken;
  const { entry, missing } = advisoryCoach(app);
  const st: AdvisorState = { game, busy: true, entry, missing, decision: null, steps: [], error: null, notes: [] };
  app.st.computer.advisor = st;
  app.emit();
  const team = game.turn.active;
  const stale = () => mine !== advisorToken || app.game !== game || app.st.computer.advisor !== st;
  const done = (d: AIDecision | null, err?: string) => {
    if (stale()) return;
    st.busy = false;
    st.decision = d;
    st.error = d ? null : err ?? 'no result';
    const input = d?.input;
    if (input?.kind === 'playerAction') {
      try {
        const plan = E.planAction(game, input, { followUp: true });
        if (plan.ok) st.steps = plan.steps.map((x) => (x.kind === 'block' ? `${x.label} — ${x.dice}` : `${x.label}: ${x.target}+${x.mods.length ? ` (${x.mods.map((m) => `${m.value >= 0 ? '+' : ''}${m.value} ${m.label}`).join(', ')})` : ''}${x.pWithReroll !== undefined ? `, re-roll: ${x.rerolls.join(' / ')}` : ''}`));
      } catch {
        /* steps are optional */
      }
    }
    app.emit();
  };
  if (entry.kind === 'strategy' && entry.code) {
    void strategyDecide(game, team, entry, (why) => st.notes.push(why), stale, undefined, undefined, true).then((mv) => done(mv && mv.type === 'action' ? mv.decision : null, 'the strategy module gave no advice'));
    return;
  }
  const gen = hooked(paramsFor(game, team, { profile: entry.profile }), think(game, team, { style: 'balanced' }));
  const slice = () => {
    if (stale()) return;
    const t0 = performance.now();
    let r: IteratorResult<string, AIDecision>;
    try {
      do r = gen.next();
      while (!r.done && performance.now() - t0 < 35);
    } catch (e) {
      done(null, (e as Error).message);
      return;
    }
    if (!r.done) {
      setTimeout(slice, 0);
      return;
    }
    done(r.value);
  };
  setTimeout(slice, 0);
}

function downside(k: Candidate): string {
  const bits: string[] = [];
  if ((k.pTurnover ?? 0) > 0.02) bits.push(`${pct(k.pTurnover as number, 0)} chance of a Turnover — your Turn would end there`);
  if ((k.pBallLost ?? 0) > 0.01) bits.push(`${pct(k.pBallLost as number, 0)} chance the ball comes loose`);
  const neg = (k.drivers ?? []).filter(([, d]) => d < -0.5).map(([t]) => DRIVER_DOWN[t]).filter(Boolean);
  if (neg.length) bits.push(neg[0] as string);
  return bits.length ? bits.join('; ') : 'no significant risk found';
}

const DRIVER_DOWN: Record<string, string> = {
  carrierSafety: 'leaves the ball carrier more exposed',
  progress: 'moves the ball back',
  support: 'fewer receivers ahead of the ball',
  screen: 'opens a route to your End Zone',
  pressure: 'less pressure on their ball carrier',
  players: 'risks one of your players',
  rerolls: 'may spend a Team Re-roll',
  looseBall: 'lets them get closer to the loose ball',
  crowd: 'leaves a player where he can be pushed into the crowd',
};

function tradeOff(best: Candidate, k: Candidate): string {
  const parts: string[] = [];
  const dt = (k.pTurnover ?? 0) - (best.pTurnover ?? 0);
  if (Math.abs(dt) >= 0.02) parts.push(dt < 0 ? `safer (Turnover ${pct(k.pTurnover ?? 0, 0)} instead of ${pct(best.pTurnover ?? 0, 0)})` : `riskier (Turnover ${pct(k.pTurnover ?? 0, 0)} instead of ${pct(best.pTurnover ?? 0, 0)})`);
  const dtd = (k.pTouchdown ?? 0) - (best.pTouchdown ?? 0);
  if (Math.abs(dtd) >= 0.02) parts.push(dtd > 0 ? `better scoring chance (${pct(k.pTouchdown ?? 0, 0)})` : `lower scoring chance (${pct(k.pTouchdown ?? 0, 0)})`);
  const gap = (best.gain ?? 0) - (k.gain ?? 0);
  parts.push(gap < 0.5 ? 'about as good overall' : `about ${gap.toFixed(1)} points less overall`);
  return parts.join(', ');
}

/** Load the suggestion as a plan (Plan → Review → Confirm), exactly as if the coach had built it. */
function planIt(app: App, input: PlayerActionInput) {
  app.st.selected = input.playerId;
  const extra: Record<string, unknown> = { path: input.path.map((x) => ({ to: { ...x.to }, kind: x.kind })) };
  if (input.blitzTarget) extra.blitzTarget = input.blitzTarget;
  if (input.blockTarget) extra.blockTarget = input.blockTarget;
  if (input.passTarget) extra.passTarget = { ...input.passTarget };
  if (input.handoffTarget) extra.handoffTarget = input.handoffTarget;
  if (input.thrownPlayerId) extra.thrownPlayerId = input.thrownPlayerId;
  if (input.throwTarget) extra.throwTarget = { ...input.throwTarget };
  if (input.special) extra.special = input.special;
  if (input.vomitTarget) extra.vomitTarget = input.vomitTarget;
  if (input.foulTarget) extra.foulTarget = input.foulTarget;
  app.startDraft(input.action, extra);
}

function candLine(k: Candidate): string {
  const bits: string[] = [];
  if ((k.pTouchdown ?? 0) > 0.005) bits.push(`score ${pct(k.pTouchdown as number, 0)}`);
  else if (k.pSuccess !== undefined) bits.push(`succeeds ${pct(k.pSuccess, 0)}`);
  if ((k.pTurnover ?? 0) > 0.005) bits.push(`Turnover ${pct(k.pTurnover as number, 0)}`);
  return bits.join(' · ');
}

/** Button + result card of the advisor, for the coach whose Turn it is. */
export function renderAdvisor(app: App): HTMLElement | null {
  if (!canAdvise(app) && !app.st.computer.advisor) return null;
  const st = app.st.computer.advisor;
  const g = app.game;
  const fresh = st && st.game === g ? st : null;
  const card = h('div', { class: 'card advisor', id: 'advisor-card' });
  const coach = advisoryCoach(app);
  if (!fresh) {
    if (!canAdvise(app)) return null;
    // Unobtrusive: one line until the coach asks.
    card.classList.add('compact');
    card.appendChild(
      h(
        'div',
        { class: 'row-between' },
        h('span', { class: 'small', title: `Optional advice for ${g.teams[g.turn.active].name} from your advisory coach (an AI file of your choice). It looks only at the board as it is (no future dice, nothing hidden) and never moves anything, rolls dice or ends your Turn.` }, h('b', null, 'AI Focus'), h('span', { class: 'muted', id: 'advisor-coach' }, ` · ${aiLabel(coach.entry)}`)),
        h('button', { class: 'btn small ghost', id: 'advisor-btn', onclick: () => runAdvisor(app) }, 'Ask ▸'),
      ),
    );
    return card;
  }
  card.appendChild(
    h(
      'div',
      { class: 'row-between' },
      h('h4', null, 'AI Focus ', h('span', { class: 'small muted' }, '(advice only)')),
      advisorSelect(app, 'advisor-ai-focus'),
    ),
  );
  if (fresh.missing) card.appendChild(h('p', { class: 'small warn' }, `The chosen advisory coach is not installed here: ${aiLabel(fresh.entry)} advises instead.`));
  if (fresh.busy) {
    card.appendChild(h('p', { class: 'small' }, h('span', { class: 'spinner' }), ` ${aiLabel(fresh.entry)} is weighing every legal option and every dice outcome…`));
    return card;
  }
  if (fresh.error || !fresh.decision) {
    card.appendChild(h('p', { class: 'small bad' }, `The analysis failed: ${fresh.error ?? 'no result'}`));
    return card;
  }
  const d = fresh.decision;
  const best = d.chosen;
  card.appendChild(h('div', { class: 'small muted' }, `${d.objective.urgent ? 'Urgent — ' : ''}${OBJECTIVE_LABEL[d.objective.id]}: ${d.objective.why}.`));
  if (!best) {
    card.appendChild(h('p', null, h('b', null, 'Recommendation: end the Turn.'), ' No remaining legal action improves the position enough to be worth its risk.'));
  } else {
    const close = d.candidates.filter((k) => k !== best && k.gain !== undefined && !k.error && (best.gain ?? 0) - (k.gain ?? 0) < 1.5);
    if (close.length) card.appendChild(h('p', { class: 'small warn', id: 'advisor-close' }, `Close call: ${close.length === 1 ? 'one other option is' : `${close.length} other options are`} nearly as good (within 1.5 points, a Touchdown = 100). The pick below is slightly ahead; the trade-offs are listed under “Close alternatives”.`));
    card.appendChild(h('p', { id: 'advisor-rec' }, h('span', { class: 'small muted' }, close.length ? 'Slight preference: ' : 'Suggested: '), h('b', null, best.label)));
    card.appendChild(h('p', { class: 'small' }, d.reason.replace(/^[^:]+: [^.]*\. Chose [^—(]*(—\s*)?/, 'Why: ')));
    card.appendChild(h('div', { class: 'section-label' }, 'Chances (estimates)'));
    const probs = h(
      'ul',
      { class: 'small' },
      best.pTouchdown && best.pTouchdown > 0.005 ? h('li', null, `Touchdown this action: ${pct(best.pTouchdown)}`) : null,
      h('li', null, `Completes as planned: ${pct(best.pSuccess ?? 0)}`),
      h('li', null, `Turnover: ${pct(best.pTurnover ?? 0)}`),
      best.pBallLost && best.pBallLost > 0.005 ? h('li', null, `Ball comes loose: ${pct(best.pBallLost)}`) : null,
      best.pBallFreed && best.pBallFreed > 0.005 ? h('li', null, `Knocks their ball loose: ${pct(best.pBallFreed)}`) : null,
    );
    card.appendChild(probs);
    if (fresh.steps.length) card.appendChild(h('details', { class: 'why' }, h('summary', null, 'Rolls included'), h('ul', { class: 'small' }, fresh.steps.map((x) => h('li', null, x)))));
    card.appendChild(
      h(
        'p',
        { class: 'small muted' },
        'These chances count every dice outcome of the action as the engine plays it — every roll above with its modifiers, skill re-rolls and Pro, and a Team Re-roll on a failure while one is left (the same assumptions as the plan preview; Review shows the exact figures with and without Team Re-rolls). Outcomes rarer than 0.01% are estimated, not enumerated.',
      ),
    );
    card.appendChild(h('p', { class: 'small' }, h('b', null, 'Main downside: '), downside(best), '.'));
    if (best.input.kind === 'playerAction') card.appendChild(h('div', { class: 'btnrow tight' }, h('button', { class: 'btn small primary', id: 'advisor-plan', onclick: () => planIt(app, best.input as PlayerActionInput) }, 'Plan this move'), h('span', { class: 'small muted' }, 'Opens it as a normal plan: review and confirm it yourself.')));
  }
  const alts = d.candidates.filter((k) => k !== best && k.gain !== undefined && !k.error).slice(0, 3);
  if (alts.length) {
    card.appendChild(
      h(
        'details',
        { class: 'why', open: true },
        h('summary', null, 'Close alternatives (trade-offs)'),
        h(
          'ul',
          { class: 'small' },
          alts.map((k) =>
            h(
              'li',
              null,
              h('b', null, k.label),
              ` — ${candLine(k)}${best ? `; ${tradeOff(best, k)}` : ''}. `,
              k.input.kind === 'playerAction' ? h('button', { class: 'linkbtn small', onclick: () => planIt(app, k.input as PlayerActionInput) }, 'plan it') : null,
            ),
          ),
        ),
      ),
    );
  }
  if (fresh.notes.length) card.appendChild(h('p', { class: 'small warn' }, `${aiLabel(fresh.entry)}: ${fresh.notes.join(' ')} The built-in algorithm's analysis was used for that part.`));
  card.appendChild(h('div', { class: 'btnrow tight' }, h('button', { class: 'btn small ghost', id: 'advisor-recalc', onclick: () => runAdvisor(app) }, 'Recalculate'), h('button', { class: 'btn small ghost', onclick: () => { app.st.computer.advisor = null; app.emit(); } }, 'Hide')));
  card.appendChild(h('p', { class: 'small muted', id: 'advisor-source' }, `Advice from ${aiLabel(fresh.entry)} (${fresh.entry.kind === 'strategy' ? 'strategy module' : 'parameter file of the built-in algorithm'}, ${d.millis} ms). The chances are the rules engine's figures for this one action; the position scores behind “points” are the AI's own judgement, not exact. A suggestion, not a rule: nothing has been moved or rolled, and the choice is yours.`));
  return card;
}

export function describeComputerInput(g: GameState, input: ActionInput): string {
  return E.describeInput(g, input);
}

/** V5.5: Pause / Resume the match — the computer coaches wait and the match timer stops (the same control everywhere). */
export function togglePause(app: App): void {
  const cs = app.st.computer;
  tickClock(app);
  cs.paused = !cs.paused;
  if (cs.paused) interruptComputer(app);
  app.emit();
}
