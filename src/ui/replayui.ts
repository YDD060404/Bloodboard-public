// V6 Replay of a saved match: historical playback of what was recorded. No AI runs and no dice are rolled — the authoritative
// engine re-executes the recorded inputs and decisions (engine/replay.ts), and the result was VERIFIED against the file's own
// recorded dice before Replay was offered.
import type { App } from './app';
import { E, type GameState, type LogEntry, type SaveFile } from './engine-global';
import { h } from './dom';
import { eventLine } from './panels';

export interface ReplayUI {
  mode: 'full' | 'position';
  /** Verified engine replay (full mode). */
  session: InstanceType<typeof E.ReplaySession> | null;
  log: LogEntry[];
  /** Number of recorded entries applied (0 = the start). */
  index: number;
  count: number;
  playing: boolean;
  speed: number;
  timer: number | null;
  fileName: string | null;
  name: string;
  grade: string;
  reason: string;
  initialFrom: string;
  markers: { turns: number[]; drives: number[]; touchdowns: number[] };
  compat: string;
  /** The loaded file, so "Open as position" can leave Replay for the playable / final position. */
  save: SaveFile | null;
}

const SPEEDS = [0.5, 1, 2, 4, 8];
const BASE_MS = 1100;

export function stopReplayTimer(ui: ReplayUI | null) {
  if (ui && ui.timer !== null) {
    clearInterval(ui.timer);
    ui.timer = null;
  }
  if (ui) ui.playing = false;
}

/** Open a saved match in Replay. Practice positions and files whose history does not reproduce open as a read-only position. */
export function openReplay(app: App, save: SaveFile, fileName: string | null): void {
  const assessed = E.assessReplay(save.state, (save.meta?.initial as GameState | undefined) ?? null);
  const a = assessed.assessment;
  const compat = E.checkCompatibility(save).note;
  const full = a.grade === 'replayable' || a.grade === 'replayable-after-migration';
  const ui: ReplayUI = {
    mode: full ? 'full' : 'position',
    session: full ? new E.ReplaySession(assessed) : null,
    log: save.state.log,
    index: 0,
    count: full ? assessed.log.length : 0,
    playing: false,
    speed: 1,
    timer: null,
    fileName,
    name: save.name,
    grade: a.grade,
    reason: a.reason,
    initialFrom: a.initialFrom,
    markers: { turns: [], drives: [], touchdowns: [] },
    compat,
    save,
  };
  const first: GameState = full ? E.cloneState((ui.session as NonNullable<ReplayUI['session']>).stateAt(0)) : E.cloneState(save.state);
  if (full) ui.markers = (ui.session as NonNullable<ReplayUI['session']>).markers();
  app.openBoard(first, { kind: 'replay', name: save.name, grade: a.grade }, { docName: save.name });
  app.st.replay = ui;
  app.emit();
}

/**
 * The file-open semantics (V6):
 *  - Replay Match = historical playback from the reconstructed beginning (default for a COMPLETED match whose history verifies);
 *  - Open / Resume Match = the current playable state (an unfinished match resumes; a completed one only on explicit "position" view);
 *  - a completed match whose history cannot be replayed opens as a position and SAYS so.
 */
export function openSaved(app: App, save: SaveFile, fileName: string | null, how: 'auto' | 'position' | 'replay' = 'auto'): void {
  const completed = !!save.state.match && save.state.phase === 'fullTime';
  if (how === 'replay' || (how === 'auto' && completed)) {
    const a = E.assessReplay(save.state, (save.meta?.initial as GameState | undefined) ?? null).assessment;
    const full = a.grade === 'replayable' || a.grade === 'replayable-after-migration';
    if (full || how === 'replay') {
      openReplay(app, save, fileName);
      if (full) app.toast(`Replay of “${save.name}”: it starts from the beginning of the match (${a.grade === 'replayable' ? 'recorded start' : 'start reconstructed from the file'}). Use “Open as position” to see the final board instead.`);
      return;
    }
    app.openLoaded(save.state, save.name, save, fileName);
    app.toast(`“${save.name}” opened as a position only: its history cannot be replayed (${a.reason}).`, 'error');
    return;
  }
  app.openLoaded(save.state, save.name, save, fileName);
}

export async function openReplayFromStore(app: App, name: string): Promise<void> {
  try {
    const parsed = E.parseSaveFile(await app.store.load(name));
    if (!parsed.ok) return app.toast(`Could not open: ${parsed.errors.join('; ')}`, 'error');
    openReplay(app, parsed.save, name);
  } catch (e) {
    app.toast(`Could not open: ${(e as Error).message}`, 'error');
  }
}

export function replaySeek(app: App, i: number): void {
  const ui = app.st.replay;
  if (!ui || ui.mode !== 'full' || !ui.session) return;
  const idx = Math.max(0, Math.min(ui.count, Math.round(i)));
  const from = ui.index;
  const before = from !== idx ? E.cloneState(app.game) : null;
  ui.index = idx;
  app.st.playback = null;
  app.replaceGame(E.cloneState(ui.session.stateAt(idx)), {});
  // V7-08: stepping forward by exactly one recorded action animates what the engine did (movement, ball flight, falls, exits), taken from the
  // recorded events' board snapshots — nothing is recomputed, so the animation cannot show anything that did not happen. Seeks and jumps stay instant.
  if (before && idx === from + 1 && app.st.animate) {
    // The recorded file carries no board snapshots; the engine re-executes the entry (it is verified dice-for-dice) and those events carry them.
    const events = ui.session.eventsFor(from);
    const entry = app.game.log[app.game.log.length - 1];
    if (events?.some((e) => e.snap)) app.st.playback = { events, shown: events.length, before, logId: entry?.id ?? null, seq: ++replayAnimSeq, by: 'computer', animFrom: 0 };
  }
  if (idx >= ui.count) stopReplayTimer(ui);
}
let replayAnimSeq = 1_000_000;

export function replayStep(app: App, d: number) {
  const ui = app.st.replay;
  if (ui) replaySeek(app, ui.index + d);
}

export function toggleReplay(app: App): void { replayPlay(app, !app.st.replay?.playing); }

function replayPlay(app: App, on: boolean) {
  const ui = app.st.replay;
  if (!ui || ui.mode !== 'full') return;
  stopReplayTimer(ui);
  if (on) {
    if (ui.index >= ui.count) replaySeek(app, 0);
    ui.playing = true;
    ui.timer = window.setInterval(() => replayStep(app, 1), Math.max(60, BASE_MS / ui.speed));
  }
  app.emit();
}

function jumpTo(app: App, list: number[], dir: 1 | -1) {
  const ui = app.st.replay;
  if (!ui) return;
  const cand = dir === 1 ? list.find((x) => x > ui.index) : [...list].reverse().find((x) => x < ui.index);
  if (cand !== undefined) replaySeek(app, cand);
}

const diceText = (e: LogEntry['events'][number]) => (e.dice ?? []).map((d) => `${d.kind.toUpperCase()} ${d.faces.join(',')}`).join(' · ');

function entryCard(app: App, ui: ReplayUI): HTMLElement {
  const g = app.game;
  if (ui.index === 0) return h('div', { class: 'card' }, h('h4', null, 'Before the first action'), h('p', { class: 'small muted' }, 'The match as it was created. Step forward to play back the recorded history.'));
  const e = ui.log[ui.index - 1];
  const tm = g.teams[e.team];
  return h(
    'div',
    { class: 'card', id: 'replay-entry' },
    h('div', { class: 'row-between' }, h('h4', null, `#${e.id} ${e.title}`), h('span', { class: 'pill', style: `background:${tm.color};color:${tm.accent}` }, tm.name)),
    h('p', { class: 'small muted' }, `Turn ${e.turn} · outcome: ${e.outcome}`),
    e.decisions.length
      ? h('div', null, h('h5', null, 'Recorded decisions'), h('ul', { class: 'small', id: 'replay-decisions' }, e.decisions.map((d) => h('li', null, `${g.teams[d.team].name}: ${d.label}`, h('span', { class: 'muted' }, ` — ${d.prompt}`)))))
      : null,
    h('h5', null, 'Recorded events and dice'),
    h('ol', { class: 'events compact', id: 'replay-events' }, e.events.map((ev) => h('li', { class: `ev ev-${ev.type}` }, h('span', { class: 'evtxt' }, ev.text), diceText(ev) ? h('span', { class: 'pill', title: 'The recorded dice — not rolled again' }, diceText(ev)) : null))),
  );
}

/** V7-09: measured counts at the current replay step (recomputed from the engine state and its log; no prediction, no probability). */
function analyticsCard(app: App): HTMLElement {
  const a = E.matchAnalytics(app.game);
  const row = (label: string, f: (t: 'A' | 'B') => string | number) => h('tr', null, h('td', { class: 'muted' }, label), h('td', null, String(f('A'))), h('td', null, String(f('B'))));
  const ac = a.activity;
  return h('div', { class: 'card', id: 'replay-analytics' },
    h('h5', null, `Match data · after ${a.basis.entries} actions`),
    h('table', { class: 'small', style: 'width:100%' },
      h('tr', null, h('th'), h('th', null, app.game.teams.A.name), h('th', null, app.game.teams.B.name)),
      row('Standing / prone / stunned', (t) => `${a.teams[t].standing}/${a.teams[t].prone}/${a.teams[t].stunned}`),
      row('Reserves · KO · CAS', (t) => `${a.teams[t].reserves} · ${a.teams[t].ko} · ${a.teams[t].casualties}`),
      row('Marked players', (t) => a.teams[t].marked), row('Team re-rolls', (t) => a.teams[t].rerolls),
      row('Blocks + blitzes', (t) => ac[t].blocks), row('Passes · hand-offs', (t) => `${ac[t].actions.pass} · ${ac[t].actions.handoff}`), row('Fouls', (t) => ac[t].actions.foul),
      row('Turnovers', (t) => ac[t].turnovers), row('Touchdowns', (t) => ac[t].touchdowns),
    ),
    h('p', { class: 'small muted' }, a.possession ? `Ball: ${app.game.teams[a.possession].name} carries it${a.carrierGoalDistance !== null ? `, ${a.carrierGoalDistance} squares from the end zone` : ''}.` : a.ballLoose ? 'Ball: loose.' : ''),
    h('p', { class: 'small muted', title: a.outlook.reason }, 'Measured counts, not predictions. No win probability is shown: it would need a sampling estimator with a stated sample count.'),
  );
}

export function renderReplayPanel(app: App): HTMLElement {
  const ui = app.st.replay;
  const wrap = h('div', { id: 'replay-panel' });
  if (!ui) return wrap.appendChild(h('p', { class: 'muted' }, 'No replay is open.')) && wrap;
  const gradeLabel: Record<string, string> = { replayable: 'Replayable', 'replayable-after-migration': 'Replayable after migration', 'position-only': 'Position only', unsupported: 'Unsupported' };
  wrap.appendChild(
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'row-between' }, h('h3', null, 'Replay'), h('span', { class: `pill ${ui.mode === 'full' ? 'ok' : 'bad'}`, id: 'replay-grade' }, gradeLabel[ui.grade] ?? ui.grade)),
      h('p', { class: 'small', id: 'replay-reason' }, ui.reason),
      h('p', { class: 'small muted' }, ui.compat),
      h('p', { class: 'small muted' }, 'Replay shows what was recorded: no AI runs and no dice are rolled. It changes nothing — not the saved file, not a League, not a coach’s memory.'),
    ),
  );
  if (ui.mode !== 'full') {
    wrap.appendChild(h('div', { class: 'card' }, h('p', { class: 'small' }, 'Only the saved position can be viewed. Nothing was invented to fill in the missing history.'), h('button', { class: 'btn', id: 'replay-exit', onclick: () => app.set({ screen: 'home' }) }, 'Close')));
    return wrap;
  }
  const b = (id: string, label: string, title: string, fn: () => void, extra = {}) => h('button', { class: 'btn small', id, title, onclick: fn, ...extra }, label);
  const slider = h('input', { type: 'range', id: 'replay-slider', min: '0', max: String(ui.count), value: String(ui.index), style: 'width:100%', oninput: (ev: Event) => replaySeek(app, Number((ev.target as HTMLInputElement).value)) }) as HTMLInputElement;
  const speed = h('select', { id: 'replay-speed', onchange: (ev: Event) => { ui.speed = Number((ev.target as HTMLSelectElement).value); if (ui.playing) replayPlay(app, true); } }, SPEEDS.map((s) => h('option', { value: String(s), selected: s === ui.speed }, `${s}×`)));
  const turnSel = h('select', { id: 'replay-turn', onchange: (ev: Event) => { const v = Number((ev.target as HTMLSelectElement).value); if (v >= 0) replaySeek(app, v); } }, [h('option', { value: '-1' }, 'Jump to turn…'), ...ui.markers.turns.map((m) => { const e = ui.log[m]; return h('option', { value: String(m) }, `${app.game.teams[e.team].name} · T${e.turn} (step ${m + 1})`); })]);
  wrap.appendChild(
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'row-between' }, h('b', { id: 'replay-pos' }, `Step ${ui.index} of ${ui.count}`), h('span', { class: 'small muted' }, `${app.game.teams.A.name} ${app.game.teams.A.score} – ${app.game.teams.B.score} ${app.game.teams.B.name}`)),
      slider,
      h(
        'div',
        { class: 'btnrow tight' },
        b('replay-start', '⏮', 'Back to the beginning', () => replaySeek(app, 0)),
        b('replay-back', '◀', 'Step back (←)', () => replayStep(app, -1)),
        b('replay-play', ui.playing ? '⏸ Pause' : '▶ Play', ui.playing ? 'Pause' : 'Play', () => toggleReplay(app)),
        b('replay-fwd', '▶▏', 'Step forward (→)', () => replayStep(app, 1)),
        b('replay-end', '⏭', 'To the end', () => replaySeek(app, ui.count)),
        speed,
      ),
      h(
        'div',
        { class: 'btnrow tight' },
        turnSel,
        b('replay-drive-prev', '◀ Drive', 'Previous drive', () => jumpTo(app, ui.markers.drives, -1)),
        b('replay-drive-next', 'Drive ▶', 'Next drive', () => jumpTo(app, ui.markers.drives, 1)),
        b('replay-td-prev', '◀ Touchdown', 'Previous touchdown', () => jumpTo(app, ui.markers.touchdowns, -1)),
        b('replay-td-next', 'Touchdown ▶', 'Next touchdown', () => jumpTo(app, ui.markers.touchdowns, 1)),
      ),
    ),
  );
  wrap.appendChild(entryCard(app, ui));
  wrap.appendChild(analyticsCard(app));
  wrap.appendChild(h('div', { class: 'btnrow' }, ui.save ? h('button', { class: 'btn', id: 'replay-open-position', title: 'Leave Replay and open the saved position (the final board, playable if the match is not over)', onclick: () => { stopReplayTimer(ui); const sv = ui.save as SaveFile; openSaved(app, sv, ui.fileName, 'position'); } }, 'Open as position') : null, h('button', { class: 'btn', id: 'replay-exit', onclick: () => { stopReplayTimer(ui); app.set({ screen: 'home' }); } }, 'Close Replay')));
  return wrap;
}
