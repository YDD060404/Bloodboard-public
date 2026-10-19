/**
 * V5.5: the match timer above the pitch — display only (no time limits, nothing ends a Turn).
 *
 *   total  — match time while the match board is open, not paused and not yet at full time;
 *   P1/P2  — the time each side used while acting or making a decision (the computer's thinking included). A decision
 *            that belongs to the other side (a Block die the defender chooses, Apothecary, Argue the Call, …) counts
 *            for the side that has to decide. While the dice of an action are being shown, the time counts for the
 *            side that made the action; while a coach aims their Sports-Wizard's spell, for that coach. Between Drives
 *            and at the pre-game (nobody to act) only the total runs.
 *
 * The authoritative times live in `app.st.clock` (Undo never winds them back); they are written into the game only
 * when it is saved or exported, and read back when a saved match is opened.
 */
import type { App } from './app';
import { h } from './dom';
import { E, type GameState, type MatchClock, type TeamId } from './engine-global';
import { waitingFor } from '../ai/index';
import { togglePause } from './computer';

export const zeroClock = (): MatchClock => ({ totalMs: 0, A: 0, B: 0 });

/** The longest step counted at once: a sleeping computer or a throttled window does not add hours. */
const MAX_STEP_MS = 2000;
let lastTick = 0;

function isMatchBoard(app: App): boolean {
  return app.st.ctx.kind === 'match' && !!app.game.match;
}

/** Match time runs: a match is open on the board, not paused, before full time. */
export function clockRunning(app: App): boolean {
  const g = app.game;
  return app.st.screen === 'board' && isMatchBoard(app) && g.phase !== 'fullTime' && !app.st.computer.paused;
}

/** The side whose time is running now (null: nobody has to act — pre-game, between Drives). */
export function clockSide(app: App): TeamId | null {
  const pb = app.st.playback;
  // The dice of an action being shown: the side that made it (the state has already moved on).
  if (pb && pb.shown < pb.events.length) return sideOf(pb.before);
  // A coach aiming their Sports-Wizard's spell (it may be the other team's Turn) is making that decision.
  if (app.st.wizardDraft && app.game.phase !== 'fullTime') return app.st.wizardDraft.team;
  return sideOf(app.game);
}

function sideOf(g: GameState): TeamId | null {
  if (g.phase === 'fullTime') return null;
  return waitingFor(g);
}

/** Adds the time since the last tick. Called about twice a second, and before the game changes. */
export function tickClock(app: App): void {
  const now = performance.now();
  const dt = lastTick ? Math.min(MAX_STEP_MS, Math.max(0, now - lastTick)) : 0;
  lastTick = now;
  if (!clockRunning(app) || !dt) return;
  const c = app.st.clock;
  c.totalMs += dt;
  const side = clockSide(app);
  if (side) c[side] += dt;
}

/** A game with the current times, for saving / exporting (the game in memory is not changed). */
export function withClock(app: App, g: GameState): GameState {
  return isMatchBoard(app) && g.match ? { ...g, clock: { ...app.st.clock } } : g;
}

/** Opening a board: a saved match brings its times back; anything else starts from zero. */
export function loadClock(app: App, g: GameState): void {
  const c = g.clock;
  app.st.clock = c && [c.totalMs, c.A, c.B].every((x) => typeof x === 'number' && x >= 0) ? { ...c } : zeroClock();
  lastTick = performance.now();
}

const sideText = (app: App, t: TeamId) => `P${t === 'A' ? 1 : 2} ⏱ ${fmtClock(app.st.clock[t])}`;

export function fmtClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
}

/** One side's time, for the scoreboard next to that team. */
export function sideClock(app: App, t: TeamId): HTMLElement | null {
  if (!isMatchBoard(app)) return null;
  const running = clockRunning(app) && clockSide(app) === t;
  return h('span', { class: `sb-clock ${running ? 'running' : ''}`, id: `clock-${t}`, title: `Time used by Player ${t === 'A' ? 1 : 2} (acting or deciding, the computer’s thinking included). Display only — there are no time limits.` }, sideText(app, t));
}

/** The total match time and the Pause control, in the middle of the scoreboard. */
export function totalClock(app: App): HTMLElement | null {
  if (!isMatchBoard(app)) return null;
  const g = app.game;
  const paused = app.st.computer.paused && g.phase !== 'fullTime';
  const done = g.phase === 'fullTime';
  return h(
    'span',
    { class: `sb-total ${paused ? 'paused' : ''}`, id: 'match-clock' },
    h('span', { id: 'clock-total', title: 'Match time (display only: no time limits). It stops while the match is paused and at full time.' }, `⏱ ${fmtClock(app.st.clock.totalMs)}`),
    done
      ? null
      : h(
          'button',
          { class: 'sb-pause', id: 'clock-pause', 'aria-label': paused ? 'Resume the match' : 'Pause the match', title: paused ? 'Resume the match (the timer and any computer coach go on)' : 'Pause the match (the timer stops; a computer coach waits)', onclick: () => togglePause(app) },
          paused ? '▶' : '❚❚',
        ),
    paused ? h('span', { class: 'sb-paused' }, 'Paused') : null,
  );
}

/** Refresh the timer texts in place (no full re-render twice a second). */
export function paintClock(app: App): void {
  if (!isMatchBoard(app) || app.st.screen !== 'board') return;
  const tot = document.getElementById('clock-total');
  if (tot) tot.textContent = `⏱ ${fmtClock(app.st.clock.totalMs)}`;
  const run = clockRunning(app) ? clockSide(app) : null;
  for (const t of ['A', 'B'] as TeamId[]) {
    const el = document.getElementById(`clock-${t}`);
    if (!el) continue;
    el.textContent = sideText(app, t);
    el.classList.toggle('running', run === t);
  }
}

/** Starts the timer (once, from main.ts). */
export function startClock(app: App): void {
  lastTick = performance.now();
  setInterval(() => {
    tickClock(app);
    paintClock(app);
  }, 500);
}

void E;
