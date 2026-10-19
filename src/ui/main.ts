import { App } from './app';
import { clear, h } from './dom';
import { E, type Coord, type GameState, type PathStep, type Player, type TeamId } from './engine-global';
import { EXAMPLES } from './examples';
import { openPractice, renderHome, renderLearn } from './home';
import { currentExercise, currentTutorial, lessonAfterExecution, lessonClick, loadProgress, renderBlockSchoolSide, renderTutorialCard } from './lessons';
import { renderReplayPanel, replayStep, stopReplayTimer, toggleReplay } from './replayui';
import { renderLog } from './log';
import { ensureDraft, matchClick, matchModeLabel, matchPlace, mods as clickMods, renderMatchPanel, setupRemoveSelected } from './matchui';
import { renderModal } from './modals';
import { renderPlaySide, renderScoreboard, setTopCards } from './panels';
import { renderDugout, renderInspection } from './sideline';
import { draftJumps, editPath, isPathDraft, PATH_ACTIONS, reachFor, renderPitch, squareFromPoint, stayChoice } from './pitch';
import { armDrag, dragging, setDragHooks } from './drag';
import { editorDeleteSelected, renderSetupSide, undoEditorDelete } from './setup';
import { removeTeamPlayer, renderTeams, undoTeamEdit } from './teams';
import { renderMatchSetup } from './matchsetup';
import { loadAIFolder, loadedCoachReport } from './aiload';
import { loadEngineSettings } from './enginepool';
import { syncSetup } from './setupPrefs';
import { atSafeBoundary, computerCoaches, computerOf, computerToAct, controlledElsewhere, driveComputer, togglePause } from './computer';
import { listCoaches, waitingFor } from '../ai/index';
import { observe } from './strategy';
import { renderTray } from './tray';
import { handleDecisionKey, refreshDecisionKeys } from './decisionkeys';
import { startClock, tickClock, withClock } from './clock';
import { exportCurrentHistory } from './historyio';
import { installDropImport } from './dropimport';
import { openAuthor, openTraining, trainingActive, trainingCard } from './trainingui';
import { openLan, restoreLan } from './lanclient';

declare global {
  interface Window {
    bloodboard?: App;
    __bloodboardNativeMenu?: (cmd: string) => void;
  }
}

function initialGame(): GameState {
  const ex = EXAMPLES[0];
  const parsed = E.parseSaveFile(JSON.stringify(ex.file));
  if (parsed.ok) return parsed.save.state;
  return E.newGame();
}

function newBlankGame(a: string, b: string): GameState {
  const ra = E.ROSTER_BY_ID[a];
  const rb = E.ROSTER_BY_ID[b];
  const g = E.newGame({ a: { name: ra?.name ?? 'Home', roster: a }, b: { name: rb?.name ?? 'Away', roster: b } });
  if (ra && rb && ra.id === rb.id) g.teams.B.name = `${rb.name} (Away)`;
  return g;
}

/** Practice controls: fixed seed, reset, replay, new seed. */
function practiceCard(app: App): HTMLElement | null {
  const c = app.st.ctx;
  if (c.kind !== 'practice' || app.st.view !== 'play' || trainingActive(app)) return null;
  const g = app.game;
  const recorded = g.log.length - c.start.log.length;
  let seedInput: HTMLInputElement;
  return h(
    'div',
    { class: 'card practice' },
    h('div', { class: 'row-between' }, h('span', { class: 'pill' }, 'Tactical board'), h('span', { class: 'small muted' }, `dice seed ${c.start.rng.seed}`)),
    h('b', { title: 'This scenario always starts from the same dice seed: Reset and play the same actions in the same order and you get exactly the same dice. Replay re-runs your recorded actions to show it. New seed gives different dice.' }, c.name),
    h(
      'div',
      { class: 'btnrow' },
      h('button', { class: 'btn small', id: 'practice-reset', onclick: () => app.practiceReset() }, 'Reset'),
      h('button', { class: 'btn small', id: 'practice-replay', disabled: recorded <= 0, title: recorded > 0 ? `Replay ${recorded} recorded action${recorded === 1 ? '' : 's'} with the same dice` : 'Confirm some actions first', onclick: () => app.practiceReplay() }, `Replay (${Math.max(0, recorded)})`),
      (seedInput = h('input', { type: 'number', class: 'num wide', value: String(Math.floor(Math.random() * 2 ** 31)), 'aria-label': 'New seed' })),
      h('button', { class: 'btn small ghost', id: 'practice-seed', onclick: () => app.practiceNewSeed(Number(seedInput.value) || 1) }, 'New seed'),
    ),
  );
}

export function boot(root: HTMLElement): App {
  const app = new App(initialGame());
  app.st.ctx = { kind: 'practice', name: EXAMPLES[0].name, start: E.cloneState(app.game) };
  app.st.docName = EXAMPLES[0].name;
  app.onExecuted = (res) => lessonAfterExecution(app, res);
  window.bloodboard = app;
  // V5.5: the match timer above the pitch (display only).
  startClock(app);
  installDropImport(app);
  // Read-only hooks for the interface tests.
  (window as unknown as { bloodboardComputer: unknown }).bloodboardComputer = { toAct: () => computerToAct(app), waitingFor: () => waitingFor(app.game), config: () => computerOf(app), coaches: () => computerCoaches(app).map((c) => ({ team: c.team, ai: c.ai, file: c.entry.id, missing: c.missing, name: c.name, version: c.version, takeover: c.takeover?.mode ?? null })), safe: () => atSafeBoundary(app) };
  // V5.5: the AI files found (read-only) and a reload after a test replaced the bundled list; the observation a strategy module would get.
  (window as unknown as { bloodboardAI: unknown }).bloodboardAI = { list: () => listCoaches().map((c) => ({ id: c.id, name: c.name, version: c.version, kind: c.kind, errors: c.errors ?? null })), reload: () => loadAIFolder(app), observe: (team: TeamId) => observe(app.game, team, 0) };
  // V5: no Practice mode on the Home screen; the free set-up board is the Exhibition card's Tactical board (tests open it directly).
  (window as unknown as { bloodboardCoaches: () => unknown }).bloodboardCoaches = () => loadedCoachReport();
  (window as unknown as { bloodboardOpenPractice: (i?: number) => void }).bloodboardOpenPractice = (i = 0) => openPractice(app, i);
  void loadProgress(app);
  void restoreLan(app);
  // V5.5: the AI folder (profiles and strategy modules) and the remembered set-up (Mac app: Settings/setup.json).
  void loadAIFolder(app);
  void loadEngineSettings().then(() => app.emit());
  void syncSetup(() => app.emit());
  setTopCards((a) => [renderMatchPanel(a), trainingCard(a), practiceCard(a), currentTutorial(a) ? renderTutorialCard(a) : null]);

  const layout = h(
    'div',
    { class: 'layout' },
    h('header', { class: 'topbar' }),
    h('div', { class: 'screenhost' }),
    h(
      'div',
      { class: 'boardscreen' },
      h('div', { class: 'scorewrap' }),
      h('main', { class: 'main' }, h('section', { class: 'pitchwrap' }, h('div', { class: 'trayhost' }), h('div', { class: 'pitchtools' }), h('div', { class: 'pitcharena' }, h('div', { class: 'pitch-dugout dugout-a' }), h('div', { class: 'pitchhost' }), h('div', { class: 'pitch-dugout dugout-b' })), h('div', { class: 'legend' })), h('div', { class: 'board-rail' }, h('aside', { class: 'sideline' }, h('div', { class: 'inspectionhost' })), h('aside', { class: 'side' }))),
      h('section', { class: 'log' }),
    ),
    h('div', { class: 'modalhost' }),
    h('div', { class: 'toasthost' }),
  );
  root.appendChild(layout);
  const $ = (sel: string) => layout.querySelector(sel) as HTMLElement;

  let fileMenuOpen = false;
  let benchHoverId: string | null = null;
  let lastDugoutKey = '';
  let lastInspectionKey = ''; 
  function inspect(force = false) {
    const shown = app.displayGame();
    const hoverPlayer = app.st.hover ? E.playerAt(shown, app.st.hover) : null;
    const id = benchHoverId ?? hoverPlayer?.id ?? app.st.selected;
    const key = `${id}:${!!(benchHoverId || hoverPlayer)}`;
    if (!force && lastInspectionKey === key) return;
    lastInspectionKey = key;
    const host = $('.inspectionhost');
    clear(host);
    host.appendChild(renderInspection(app, id, !!(benchHoverId || hoverPlayer)));
  }
  document.addEventListener('pointerdown', (ev) => {
    if (fileMenuOpen && !(ev.target as Element | null)?.closest?.('.dropdown')) {
      fileMenuOpen = false;
      topbar();
    }
  });

  function topbar() {
    const t = $('.topbar');
    clear(t);
    const st = app.st;
    t.appendChild(h('button', { class: 'brand linkbtn', title: 'Home', onclick: () => app.set({ screen: 'home', modal: null }) }, h('span', { class: 'logo' }, '◆'), h('div', null, h('div', { class: 'title' }, 'Bloodboard Unified'), h('div', { class: 'subtitle' }, `Browser edition · ${E.BUILD_FINGERPRINT.version}`))));
    const nav = h(
      'div',
      { class: 'seg nav' },
      h('button', { class: `segbtn ${st.screen === 'home' ? 'on' : ''}`, onclick: () => app.set({ screen: 'home' }) }, 'Home'),
      h('button', { class: `segbtn ${st.screen === 'board' ? 'on' : ''}`, onclick: () => app.set({ screen: 'board' }) }, 'Board'),
      h('button', { class: `segbtn ${st.screen === 'teams' ? 'on' : ''}`, onclick: () => app.set({ screen: 'teams' }) }, 'Teams'),
      h('button', { class: `segbtn ${st.screen === 'learn' ? 'on' : ''}`, onclick: () => app.set({ screen: 'learn' }) }, 'Teaching'),
    );
    t.appendChild(nav);
    t.appendChild(h('button', { class: `btn small ${app.lan?.active ? 'on' : ''}`, id: 'lan-open', title: 'Play over a local network or the internet', onclick: () => openLan(app) }, app.lan ? (app.lan.status === 'online' ? `Network ● P${app.lan.seat === 'A' ? 1 : app.lan.seat === 'B' ? 2 : '–'}` : `Network (${app.lan.status})`) : 'Play online'));
    t.appendChild(h('button', { class: 'btn small', id: 'training-open', title: 'Tactical training exercises', onclick: () => openTraining(app) }, 'Training'));
    if (st.screen !== 'board') {
      t.appendChild(h('div', { class: 'menu' }, h('button', { class: 'btn small ghost', onclick: () => app.set({ modal: { kind: 'help' } }) }, 'Help')));
      return;
    }
    const c = st.ctx;
    const ctxLabel = c.kind === 'practice' ? 'Tactical board' : c.kind === 'replay' ? 'Replay' : c.kind === 'match' ? matchModeLabel(app.game) : c.course === 'blockSchool' ? 'Block School' : 'Tutorial';
    const name = st.docName ? `${st.docName}${st.dirty && c.kind !== 'lesson' ? ' •' : ''}` : st.dirty ? 'Unsaved position •' : 'Untitled';
    t.appendChild(h('div', { class: 'docname', title: 'Current board' }, h('span', { class: 'pill' }, ctxLabel), ' ', name));
    const menu = h('div', { class: 'menu' });
    if (c.kind === 'practice') {
      menu.appendChild(
        h(
          'div',
          { class: 'seg mode' },
          h('button', { class: `segbtn ${st.view === 'setup' ? 'on' : ''}`, onclick: () => goSetup() }, 'Edit position'),
          h('button', { class: `segbtn ${st.view === 'play' ? 'on' : ''}`, onclick: () => goPlay() }, 'Play'),
        ),
      );
      menu.appendChild(h('button', { class: 'btn small', onclick: () => app.set({ modal: { kind: 'examples' } }) }, 'Scenarios'));
    }
    if (c.kind === 'replay') menu.appendChild(h('button', { class: 'btn small', id: 'replay-topexit', onclick: () => { stopReplayTimer(app.st.replay); app.set({ screen: 'home' }); } }, '← Leave Replay'));
    else if (c.kind !== 'lesson') {
      // Low-frequency file commands live in one File menu (the Mac app also has them in its menu bar).
      const item = (label: string, fn: () => void) => h('button', { class: 'menuitem', role: 'menuitem', onclick: () => { fileMenuOpen = false; fn(); } }, label);
      const fileWrap = h('div', { class: 'dropdown' }, h('button', { class: `btn small ${fileMenuOpen ? 'on' : ''}`, id: 'file-menu-btn', 'aria-haspopup': 'menu', 'aria-expanded': fileMenuOpen ? 'true' : 'false', onclick: () => { fileMenuOpen = !fileMenuOpen; topbar(); } }, 'File ▾'));
      if (fileMenuOpen)
        fileWrap.appendChild(
          h(
            'div',
            { class: 'dropmenu', role: 'menu' },
            c.kind === 'practice' ? item('New', () => newPosition()) : null,
            item('Open…', () => app.set({ modal: { kind: 'library' } })),
            item('Save', () => void save()),
            item('Save As…', () => app.set({ modal: { kind: 'saveAs' } })),
            item('Export…', () => void exportFile()),
            c.kind === 'match' ? item('Export history…', () => void exportHistory()) : null,
            item('Make exercise…', () => openAuthor(app)),
            item('Import…', () => void importFile()),
          ),
        );
      menu.appendChild(fileWrap);
    }
    menu.appendChild(h('button', { class: `btn small ${st.showTZ ? 'on' : ''}`, title: 'Toggle Tackle Zone shading (T)', onclick: () => app.set({ showTZ: !st.showTZ }) }, 'Tackle zones'));
    menu.appendChild(h('button', { class: `btn small ${st.showReach ? 'on' : ''}`, title: 'Toggle the movement area of the selected player (R)', onclick: () => { app.st.showReach = !st.showReach; app.savePrefs(); app.emit(); } }, 'Move area'));
    menu.appendChild(h('button', { class: `btn small ${st.pitchOrientation === 'vertical' ? 'on' : ''}`, id: 'pitch-orientation-toggle', 'aria-pressed': st.pitchOrientation === 'vertical' ? 'true' : 'false', title: 'Switch between horizontal and vertical pitch views', onclick: () => { app.st.pitchOrientation = st.pitchOrientation === 'vertical' ? 'horizontal' : 'vertical'; app.savePrefs(); app.emit(); } }, st.pitchOrientation === 'vertical' ? 'Horizontal pitch' : 'Vertical pitch'));
    menu.appendChild(h('button', { class: 'btn small ghost', onclick: () => app.set({ modal: { kind: 'help' } }) }, 'Help'));
    t.appendChild(menu);
  }

  function goSetup() {
    if (app.st.view === 'setup') return;
    if (app.game.pending) return app.toast('Finish the pending decision first.', 'error');
    app.cancelDraft(false);
    app.st.playback = null;
    app.replaceGame(E.backToSetup(app.game), { keepDirty: true });
  }

  function goPlay() {
    if (app.st.view === 'play') return;
    const errors = E.validatePosition(app.game).filter((i) => i.level === 'error');
    if (errors.length) return app.toast(`Fix the position first: ${errors[0].text}`, 'error');
    const s = E.startPlay(app.game);
    app.openBoard(s, { kind: 'practice', name: app.st.docName ?? 'Tactical board position', start: E.cloneState(s) }, { docName: app.st.docName });
  }

  function newPosition() {
    const g = newBlankGame('human', 'orc');
    app.openBoard(g, { kind: 'practice', name: 'New position', start: E.cloneState(g) }, { docName: null });
    app.toast('New blank position: choose rosters and place players, then start it.');
  }

  async function save() {
    await app.saveCurrent(app.game.notes);
  }

  async function exportFile() {
    const name = (app.st.docName ?? 'bloodboard-position').replace(/[^\w\- ]+/g, '').trim() || 'bloodboard-position';
    tickClock(app);
    const file = E.toSaveFile(withClock(app, app.game), app.st.docName ?? name, app.game.notes);
    try {
      const ok = await app.store.exportFile(`${name}.json`, JSON.stringify(file, null, 1));
      if (ok) app.toast('Exported.');
    } catch (e) {
      app.toast(`Export failed: ${(e as Error).message}`, 'error');
    }
  }

  async function exportHistory() {
    const r = exportCurrentHistory(app);
    if (!r.ok) return app.toast(r.error, 'error');
    try { if (await app.store.exportFile(r.name, r.text)) app.toast('History exported (canonical, verified by replay).'); }
    catch (e) { app.toast(`Export failed: ${(e as Error).message}`, 'error'); }
  }

  async function importFile() {
    try {
      const t = await app.store.importFile();
      if (t && app.loadText(t, null)) app.toast('Imported.');
    } catch (e) {
      app.toast(`Import failed: ${(e as Error).message}`, 'error');
    }
  }

  function legend() {
    const l = $('.legend');
    clear(l);
    const tgl = h('button', { class: 'linkbtn legend-toggle', title: app.st.legendOpen ? 'Hide the legend' : 'Show the legend', onclick: () => { app.st.legendOpen = !app.st.legendOpen; app.savePrefs(); legend(); } }, app.st.legendOpen ? '▾ Legend' : '▸ Legend');
    if (!app.st.legendOpen && app.st.view === 'play' && !(currentExercise(app) && !app.st.lesson.playing)) {
      l.appendChild(tgl);
      return;
    }
    if (app.st.view === 'play' && !(currentExercise(app) && !app.st.lesson.playing)) l.appendChild(tgl);
    if (app.st.view === 'setup') {
      l.appendChild(h('span', null, 'Editing — arrange players, ball, Turn markers and re-rolls. Team ', h('b', null, app.game.teams.A.name), ' scores at column Z, ', h('b', null, app.game.teams.B.name), ' at column A.'));
      return;
    }
    if (currentExercise(app) && !app.st.lesson.playing) {
      l.appendChild(h('span', { class: 'legend-items' }, h('span', { class: 'lg' }, h('i', { class: 'lg-ring good' }), 'assists'), h('span', { class: 'lg' }, h('i', { class: 'lg-ring bad' }), 'cannot assist'), h('span', { class: 'lg' }, h('i', { class: 'lg-sq choice' }), 'squares you can choose'), h('span', null, 'Labels match the workbook grid.')));
      return;
    }
    l.appendChild(
      h(
        'span',
        { class: 'legend-items' },
        h('span', { class: 'lg' }, h('i', { class: 'lg-sq reach' }), 'move'),
        h('span', { class: 'lg' }, h('i', { class: 'lg-sq reach rush' }), 'Rush'),
        h('span', { class: 'lg' }, h('i', { class: 'lg-sq range-quick' }), h('i', { class: 'lg-sq range-short' }), h('i', { class: 'lg-sq range-long' }), h('i', { class: 'lg-sq range-bomb' }), 'Quick / Short / Long / Bomb'),
        h('span', { class: 'lg' }, h('i', { class: 'lg-badge P' }, 'P'), 'Prone'),
        h('span', { class: 'lg' }, h('i', { class: 'lg-badge S' }, 'S'), 'Stunned'),
        h('span', { class: 'lg' }, h('i', { class: 'lg-badge D' }, 'D'), 'Distracted'),
        h('span', { class: 'lg' }, h('i', { class: 'lg-badge W' }, '!'), 'skill not implemented'),
        h('span', { class: 'lg' }, h('i', { class: 'lg-tag' }, 'D4+'), 'roll on the path (D dodge, R rush, J jump, P pick-up, C catch, T pass)'),
      ),
    );
  }

  function pitchTools() {
    const tools = $('.pitchtools');
    clear(tools);
    const st = app.st;
    tools.style.display = st.pitchOrientation === 'vertical' ? '' : 'none';
    if (st.pitchOrientation !== 'vertical') return;
    const zoom = (delta: number) => {
      st.pitchZoom = Math.max(0.75, Math.min(2, Math.round((st.pitchZoom + delta) * 100) / 100));
      st.pitchFit = false;
      app.savePrefs();
      app.emit();
    };
    tools.appendChild(h('span', { class: 'muted' }, 'Pitch size'));
    tools.appendChild(h('button', { class: 'btn small', id: 'pitch-zoom-out', title: 'Zoom out', disabled: !st.pitchFit && st.pitchZoom <= 0.75, onclick: () => zoom(-0.25) }, '−'));
    tools.appendChild(h('span', { id: 'pitch-zoom-value' }, st.pitchFit ? 'Overview' : `${Math.round(st.pitchZoom * 100)}%`));
    tools.appendChild(h('button', { class: 'btn small', id: 'pitch-zoom-in', title: 'Zoom in', disabled: !st.pitchFit && st.pitchZoom >= 2, onclick: () => zoom(0.25) }, '+'));
    tools.appendChild(h('button', { class: `btn small ${st.pitchFit ? 'on' : ''}`, id: 'pitch-fit', onclick: () => { st.pitchFit = !st.pitchFit; app.savePrefs(); app.emit(); } }, st.pitchFit ? 'Readable size' : 'Fit entire pitch'));
    tools.appendChild(h('span', { class: 'muted pitch-scroll-hint' }, st.pitchFit ? 'Overview — use Readable size to enlarge.' : 'Scroll the pitch to see the other end.'));
  }

  function sidePanel(): HTMLElement {
    if (app.st.ctx.kind === 'replay') return renderReplayPanel(app);
    if (app.st.view === 'setup') return renderSetupSide(app);
    if (currentExercise(app) && !app.st.lesson.playing) return renderBlockSchoolSide(app);
    if (currentExercise(app) && app.st.lesson.playing) {
      const wrap = renderBlockSchoolSide(app);
      wrap.appendChild(renderPlaySide(app, true));
      return wrap;
    }
    if (app.st.ctx.kind === 'match') ensureDraft(app);
    return renderPlaySide(app, true);
  }

  function render() {
    topbar();
    const onBoard = app.st.screen === 'board';
    $('.boardscreen').style.display = onBoard ? '' : 'none';
    $('.boardscreen').classList.toggle('log-collapsed', !app.st.logOpen);
    $('.main').classList.toggle('vertical-layout', app.st.pitchOrientation === 'vertical');
    const sh = $('.screenhost');
    sh.style.display = onBoard ? 'none' : '';
    clear(sh);
    if (!onBoard) {
      sh.appendChild(app.st.screen === 'home' ? renderHome(app) : app.st.screen === 'learn' ? renderLearn(app) : app.st.screen === 'teams' ? renderTeams(app) : renderMatchSetup(app));
    } else {
      if (app.st.ctx.kind === 'match') ensureDraft(app);
      const sw = $('.scorewrap');
      clear(sw);
      sw.appendChild(renderScoreboard(app));
      const tray = $('.trayhost');
      clear(tray);
      if (app.st.view === 'play' && app.st.ctx.kind !== 'replay' && !(currentExercise(app) && !app.st.lesson.playing)) tray.appendChild(renderTray(app));
      pitchTools();
      renderPitch(app, $('.pitchhost'));
      legend();
      inspect(true);
      const dugouts = $('.pitcharena');
      const shown = app.displayGame();
      const dugoutKey = JSON.stringify([app.st.ctx.kind, app.st.view, app.st.selected, app.st.setupDraft?.team, app.playbackActive(), controlledElsewhere(app, 'A'), controlledElsewhere(app, 'B'), shown.teams, shown.players.filter(p => p.location !== 'pitch'), shown.players.map(p => [p.id, p.team, p.location])]);
      if (lastDugoutKey !== dugoutKey) {
        lastDugoutKey = dugoutKey;
        const benchScroll = [...dugouts.querySelectorAll<HTMLElement>('.dugout-players')].map(el => el.scrollTop);
        for (const team of ['A', 'B'] as const) {
          const host = $('.dugout-' + team.toLowerCase());
          clear(host);
          host.appendChild(renderDugout(app, team, id => { benchHoverId = id; inspect(); }));
        }
        [...dugouts.querySelectorAll<HTMLElement>('.dugout-players')].forEach((el, i) => { el.scrollTop = benchScroll[i] ?? 0; });
      }
      const side = $('.side');
      const scroll = side.scrollTop;
      clear(side);
      side.appendChild(sidePanel());
      side.scrollTop = scroll;
      refreshDecisionKeys(app);
      const log = $('.log');
      const lscroll = log.scrollTop;
      const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
      clear(log);
      log.appendChild(renderLog(app));
      log.scrollTop = atBottom ? log.scrollHeight : lscroll;
    }
    const mh = $('.modalhost');
    clear(mh);
    const m = renderModal(app);
    if (m) mh.appendChild(m);
    const th = $('.toasthost');
    clear(th);
    if (app.st.toast) th.appendChild(h('div', { class: `toast ${app.st.toast.kind}` }, app.st.toast.text));
  }

  // ---------------------------------------------------------------------------
  // Pitch input — one handler set for every mode (practice editor, match
  // set-ups, play, lessons). The listeners live on the stable `.pitchhost`
  // element, not on the <svg> (which is rebuilt on every render and hover
  // change), so a press and its release are never split between two different
  // boards. Squares are computed from the board's on-screen box and viewBox
  // (`squareFromPoint`), not from getScreenCTM, which WebKit reports
  // inconsistently for a zoomed page (the Mac app's View ▸ Zoom).
  // ---------------------------------------------------------------------------
  let press: { id: number; x: number; y: number } | null = null;
  let hoverFrame = 0;

  function squareAtPoint(x: number, y: number): Coord | null {
    const svg = $('.pitchhost').querySelector('svg') as SVGSVGElement | null;
    return svg ? squareFromPoint(svg, x, y) : null;
  }

  function setHover(c: Coord | null) {
    benchHoverId = null;
    const cur = app.st.hover;
    if ((c && cur && c.x === cur.x && c.y === cur.y) || (!c && !cur)) return;
    app.st.hover = c;
    if (hoverFrame) return;
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = 0;
      if (app.st.screen === 'board') { renderPitch(app, $('.pitchhost')); inspect(); refreshDecisionKeys(app); }
    });
  }

  /** The player a press on this square may drag (set-ups and the position editor only). */
  function draggableAt(c: Coord): { id: string; label: string } | null {
    if (app.st.view === 'setup') {
      const p = E.playerAt(app.game, c);
      return p ? { id: p.id, label: E.label(p) } : null;
    }
    const d = app.st.ctx.kind === 'match' && !computerToAct(app) ? ensureDraft(app) : null;
    if (!d) return null;
    const p = E.playerAt(app.displayGame(), c);
    return p && p.team === d.team ? { id: p.id, label: E.label(p) } : null;
  }

  function initPitchInput() {
    const host = $('.pitchhost');
    host.addEventListener('pointerdown', (ev) => {
      if (app.st.ctx.kind === 'replay') return;
      if (ev.button !== 0) return;
      const c = squareAtPoint(ev.clientX, ev.clientY);
      if (!c) return;
      // Keep WebKit from starting a text selection or a native drag on the board;
      // blur a focused field so keyboard shortcuts (Delete, Enter) reach the board.
      ev.preventDefault();
      const fe = document.activeElement as HTMLElement | null;
      if (fe && fe !== document.body && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(fe.tagName)) fe.blur();
      press = { id: ev.pointerId, x: ev.clientX, y: ev.clientY };
      try {
        host.setPointerCapture(ev.pointerId);
      } catch {
        /* capture is optional */
      }
      const dp = draggableAt(c);
      if (dp) armDrag(app, ev, dp.id, dp.label);
    });
    host.addEventListener('pointermove', (ev) => {
      if (dragging()) return; // the drag handler updates the hover square
      setHover(squareAtPoint(ev.clientX, ev.clientY));
    });
    host.addEventListener('pointerup', (ev) => {
      if (app.st.ctx.kind === 'replay') { press = null; return; }
      if (!press || press.id !== ev.pointerId) return;
      press = null;
      const c = squareAtPoint(ev.clientX, ev.clientY);
      clickMods.select = ev.shiftKey || ev.metaKey || ev.ctrlKey;
      if (c) boardClick(c);
      clickMods.select = false;
    });
    host.addEventListener('pointercancel', () => {
      press = null;
    });
    host.addEventListener('pointerleave', () => {
      if (!press && !dragging()) setHover(null);
    });
    setDragHooks({ squareAt: squareAtPoint, drop: dropPlayer });
  }

  function boardClick(c: Coord) {
    if (app.st.view === 'setup') setupClick(c);
    else playClick(c);
  }

  /** A player dropped after a drag (from the Reserves Box, the off-pitch list or another square). */
  function dropPlayer(id: string, c: Coord | null, target: Element | null) {
    const toReserves = !!target?.closest('.reserves, .offpitch');
    const targetTeam = (target?.closest('.dugout-team') as HTMLElement | null)?.dataset.team;
    if (toReserves && targetTeam && app.player(id)?.team !== targetTeam) {
      app.st.hover = null;
      app.emit();
      app.toast('Use this player’s own dugout.', 'error');
      return;
    }
    if (app.st.view === 'setup') {
      const p = E.findPlayer(app.game, id);
      if (!p) return;
      if (toReserves) {
        if (p.location === 'pitch') {
          if (app.game.ball.kind === 'held' && app.game.ball.playerId === p.id) app.game.ball = { kind: 'none' };
          p.location = 'reserves';
          p.pos = null;
          app.st.dirty = true;
        }
        app.st.selected = null;
        app.st.hover = null;
        app.emit();
        return;
      }
      app.st.hover = null;
      if (!c) return app.emit();
      const occ = E.playerAt(app.game, c);
      if (occ && occ.id !== id) {
        app.emit();
        return app.toast('That square is occupied.', 'error');
      }
      if (!occ) movePlayerTo(id, c);
      else app.set({ selected: id });
      return;
    }
    app.st.hover = null;
    if (app.st.ctx.kind === 'match') {
      if (toReserves) {
        app.st.selected = id;
        if (setupRemoveSelected(app)) return app.emit();
      }
      if (c) {
        matchPlace(app, id, c);
        return;
      }
    }
    app.emit();
  }

  function setupClick(c: Coord) {
    const g = app.game;
    const tool = app.st.setupTool;
    const occ = E.playerAt(g, c);
    if (tool.kind === 'place') {
      if (occ) {
        app.set({ selected: occ.id });
        return;
      }
      const r = E.ROSTER_BY_ID[tool.rosterId];
      const pos = r.positions.find((x) => x.id === tool.positionId);
      if (!pos) return;
      const p = E.playerFromPosition(g, tool.team, pos, c);
      g.players.push(p);
      if (g.ball.kind === 'ground' && g.ball.pos.x === c.x && g.ball.pos.y === c.y && p.stance === 'standing') g.ball = { kind: 'held', playerId: p.id };
      app.st.selected = p.id;
      app.st.dirty = true;
      app.emit();
      return;
    }
    if (tool.kind === 'ball') {
      if (occ) {
        if (occ.stance !== 'standing') return app.toast('Only a Standing player can hold the ball.', 'error');
        g.ball = { kind: 'held', playerId: occ.id };
      } else g.ball = { kind: 'ground', pos: c };
      app.st.dirty = true;
      app.emit();
      return;
    }
    if (occ) {
      app.set({ selected: app.st.selected === occ.id ? null : occ.id });
      return;
    }
    const sel = app.player(app.st.selected);
    if (sel) movePlayerTo(sel.id, c);
  }

  function movePlayerTo(id: string, c: Coord) {
    const g = app.game;
    const p = E.findPlayer(g, id);
    if (!p || E.playerAt(g, c)) return;
    p.location = 'pitch';
    p.pos = { ...c };
    if (g.ball.kind === 'ground' && g.ball.pos.x === c.x && g.ball.pos.y === c.y && p.stance === 'standing') g.ball = { kind: 'held', playerId: p.id };
    app.st.dirty = true;
    app.st.selected = p.id;
    app.emit();
  }

  /** Click on a reachable square with nothing planned: plan a Move (or continue the activation) along the safest route. */
  function clickToMove(c: Coord): boolean {
    const g = app.game;
    const sel = app.player(app.st.selected);
    if (!sel || sel.team !== g.turn.active) return false;
    if (!reachFor(app).some((r) => r.c.x === c.x && r.c.y === c.y)) return false;
    const act = g.turn.activation;
    const continuing = act && act.playerId === sel.id && !act.over;
    const action = continuing ? act!.action : 'move';
    if (continuing && !PATH_ACTIONS.includes(action)) return false;
    app.startDraft(action);
    editPath(app, c);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Quick actions on the board: a click on an opponent turns the selected
  // player's click into a Block plan (adjacent, Block legal) or a Blitz plan
  // (target declared first, then the lowest-risk route next to the target).
  // Only a draft is created — nothing runs before Review → Confirm, and the
  // engine re-checks everything (action limits, movement, target) in the plan.
  // ---------------------------------------------------------------------------

  /** Lowest-risk route from the end of the draft's path to a square next to the target, keeping 1 square for the Block. */
  function routeNextTo(moverId: string, target: Player, pathSoFar: PathStep[], extraCost = 1): PathStep[] | null {
    const g = app.game;
    const mover = E.findPlayer(g, moverId);
    if (!mover?.pos || !target.pos) return null;
    const end = pathSoFar.length ? pathSoFar[pathSoFar.length - 1].to : mover.pos;
    if (E.board.adjacent(end, target.pos)) return [];
    let best: { path: PathStep[]; key: number[] } | null = null;
    for (const n of E.board.neighbours(target.pos)) {
      const occ = E.playerAt(g, n);
      if (occ && occ.id !== mover.id) continue;
      if (pathSoFar.some((st) => st.to.x === n.x && st.to.y === n.y)) continue;
      const r = E.safestRoute(g, mover.id, n, pathSoFar);
      if (!r || !r.path.length) continue;
      const b = E.movementBudget(g, mover.id, [...pathSoFar, ...r.path]);
      if (!b || b.maLeft + b.rushesLeft < extraCost) continue; // the Block costs one square (p.64); a Foul nothing
      // highest chance first, then no Rush for the Block, then fewer Rushes, then shorter
      const key = [-r.pSafe, b.maLeft >= 1 ? 0 : 1, r.rushes, r.path.length];
      if (!best || lexLess(key, best.key)) best = { path: r.path, key };
    }
    return best ? best.path : null;
  }
  function lexLess(a: number[], b: number[]) {
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-12) return a[i] < b[i];
    return false;
  }

  /** Turn the current (or a new) draft into a Blitz on `target`, routed next to it. */
  function planBlitzOn(sel: Player, target: Player, pathSoFar: PathStep[]): boolean {
    const route = routeNextTo(sel.id, target, pathSoFar);
    const d = app.st.draft;
    const path = [...pathSoFar, ...(route ?? [])];
    if (d && d.playerId === sel.id) {
      app.updateDraft({ action: 'blitz', clickMode: 'path', path, blitzTarget: target.id, blockTarget: target.id, auto: null });
    } else {
      app.startDraft('blitz', { blitzTarget: target.id, blockTarget: target.id });
      if (path.length) app.updateDraft({ path });
    }
    if (route === null) app.toast(`Blitz on ${E.label(target)} declared in the plan, but no route next to them leaves a square for the Block — edit the path or pick another target.`, 'error');
    return true;
  }

  /** A click on an opponent with one of your players selected. Returns true when a plan was created or updated. */
  function quickAttack(target: Player): boolean {
    const g = app.game;
    const sel = app.player(app.st.selected);
    if (!sel || !sel.pos || sel.team !== g.turn.active || target.team === sel.team) return false;
    if (target.location === 'pitch' && target.pos && target.stance !== 'standing') {
      // A Prone or Stunned opponent: plan a Foul, with a route next to them (p.69).
      const act0 = g.turn.activation;
      const cont0 = !!act0 && act0.playerId === sel.id && !act0.over;
      const canFoul = cont0 ? act0!.action === 'foul' : !!E.actionOptions(g, sel).find((o) => o.action === 'foul')?.enabled;
      if (!canFoul) {
        if (!cont0 && g.turn.used.foul) app.toast('The Foul Action has already been used this Turn (p.69).', 'error');
        return false;
      }
      const route = routeNextTo(sel.id, target, [], 0);
      if (route === null) {
        app.toast(`${E.label(sel)} cannot reach a square next to ${E.label(target)} this Turn.`, 'error');
        return true;
      }
      app.startDraft('foul', { foulTarget: target.id });
      if (route.length) app.updateDraft({ path: route });
      return true;
    }
    if (target.location !== 'pitch' || !target.pos || target.stance !== 'standing') return false;
    const opts = E.actionOptions(g, sel);
    const enabled = (a: string) => !!opts.find((o) => o.action === a)?.enabled;
    const act = g.turn.activation;
    const continuing = !!act && act.playerId === sel.id && !act.over;
    const adj = E.board.adjacent(sel.pos, target.pos);
    if (continuing) {
      if (act!.action === 'blitz' && act!.blitzTarget === target.id && enabled('blitz')) {
        app.startDraft('blitz', { blockTarget: target.id });
        const route = routeNextTo(sel.id, target, []);
        if (route?.length) app.updateDraft({ path: route });
        return true;
      }
      if (act!.action === 'blitz' && act!.blitzTarget !== target.id) {
        app.toast(`This Blitz was declared against ${E.label(E.getPlayer(g, act!.blitzTarget as string))}: it can only Block that player (p.64).`, 'error');
        return true;
      }
      return false;
    }
    if (adj && enabled('block')) {
      app.startDraft('block', { blockTarget: target.id });
      return true;
    }
    // Adjacent but a Block cannot be declared (e.g. the player is Prone): a Blitz can still stand up and Block.
    if (adj && enabled('blitz')) return planBlitzOn(sel, target, []);
    // V5.5: a distant opponent — a Blitz on them, routed next to them along the lowest-risk way, when a Blitz can still
    // be declared this Turn and they can be reached with a square left for the Block (p.64). Otherwise the click
    // selects them (e.g. to look at their card) and says why no Blitz was planned.
    if (!adj && enabled('blitz')) {
      if (routeNextTo(sel.id, target, []) !== null) return planBlitzOn(sel, target, []);
      app.toast(`${E.label(sel)} cannot reach a square next to ${E.label(target)} with a square left for the Block — no Blitz planned.`, 'error');
      return false;
    }
    if (!adj && g.turn.used.blitz) app.toast('The Blitz Action has already been declared this Turn (p.64) — select a player next to an opponent to Block.', 'error');
    return false;
  }

  function playClick(c: Coord) {
    const g = app.game;
    if (computerToAct(app)) return app.toast(app.st.computer.paused ? 'The computer is paused: press Resume in its card to let it continue.' : 'The computer is playing — wait until it has finished.', 'error');
    if (app.playbackActive()) return app.toast('Press Continue in the dice tray first.', 'error');
    if (lessonClick(app, c)) return;
    if (matchClick(app, c)) return;
    if (g.pending) {
      const opt = g.pending.request.options.find((o) => o.square && o.square.x === c.x && o.square.y === c.y);
      if (opt) app.decide(g.pending.request, opt.id);
      else {
        // V5.5: the player's own square = stay where they are (Follow-up: Stay put; On the Ball / Hit and Run: Stay).
        const stay = stayChoice(g, g.pending.request);
        if (stay && stay.c.x === c.x && stay.c.y === c.y) app.decide(g.pending.request, stay.id);
      }
      return;
    }
    if (g.phase !== 'play') return;
    const occ = E.playerAt(g, c);
    const d = app.st.draft;
    if (d) {
      const mover = app.player(d.playerId);
      if (!mover) return;
      if (occ && occ.id === mover.id) {
        // V5.5: the selected player's own square. With a route: go back to the starting square (a real route —
        // every step costs movement as usual). Without one: nothing to add; a Prone player's Stand Up plan is dropped
        // (a second click on the player), so selection stays a deliberate toggle.
        if (d.path.length && isPathDraft(d) && d.clickMode === 'path') editPath(app, occ.pos as Coord);
        else if (!d.path.length && mover.stance === 'prone' && d.action === 'move') {
          app.cancelDraft();
          app.select(null);
        }
        return;
      }
      if (d.action === 'block') {
        if (!occ || occ.team === mover.team) return;
        // Multiple Block (p.132): a second opponent next to the blocker is added as the second target; click it again to remove it.
        const mb = E.canUse(mover, 'multipleBlock') && !E.gated('multipleBlock');
        if (mb && d.blockTarget2 === occ.id) app.updateDraft({ blockTarget2: undefined });
        else if (mb && d.blockTarget && d.blockTarget !== occ.id && occ.stance === 'standing' && occ.pos && mover.pos && E.board.adjacent(mover.pos, occ.pos)) app.updateDraft({ blockTarget2: occ.id });
        else if (d.blockTarget === occ.id && d.blockTarget2) app.updateDraft({ blockTarget: d.blockTarget2, blockTarget2: undefined });
        else app.updateDraft({ blockTarget: occ.id });
        return;
      }
      if (d.action === 'special' && d.special === 'bombardier') {
        // Throw Bomb: any square is the target (range bands show the Passing ranges).
        app.updateDraft({ bombTarget: d.bombTarget && d.bombTarget.x === c.x && d.bombTarget.y === c.y ? undefined : c });
        return;
      }
      if (d.action === 'special' && d.special === 'kickTeamMate') {
        // Kick Team-mate: like Throw Team-mate — path, then the kicked team-mate, then the target square.
        if (d.clickMode === 'target') {
          app.updateDraft({ throwTarget: c });
          return;
        }
        if (occ && occ.team === mover.team) {
          app.updateDraft({ thrownPlayerId: occ.id, clickMode: 'target' });
          return;
        }
        if (occ) return;
        editPath(app, c);
        return;
      }
      if (d.action === 'special') {
        const info = E.SPECIALS[(d.special ?? 'projectileVomit') as keyof typeof E.SPECIALS];
        if (info?.targeted && occ && occ.team !== mover.team) {
          app.updateDraft({ vomitTarget: d.vomitTarget === occ.id ? undefined : occ.id });
          return;
        }
        // Targeted Special Actions without a move take no other clicks; Hypnotic Gaze and Punt build a path first.
        if (info && !info.move) return;
      }
      if (d.action === 'foul' && occ && occ.team !== mover.team) {
        if (occ.stance === 'standing') {
          app.toast('A Foul targets a Prone or Stunned opponent (p.69).', 'error');
          return;
        }
        if (d.foulTarget === occ.id) {
          app.updateDraft({ foulTarget: undefined });
          return;
        }
        const route = routeNextTo(mover.id, occ, d.path, 0);
        if (route === null) {
          app.toast(`${E.label(mover)} cannot reach a square next to ${E.label(occ)} this Turn.`, 'error');
          return;
        }
        app.updateDraft({ foulTarget: occ.id, path: [...d.path, ...route] });
        return;
      }
      if (d.action === 'blitz' && occ && occ.team !== mover.team) {
        const act = g.turn.activation;
        const continuing = act?.playerId === mover.id;
        if (continuing) {
          if (act?.blitzTarget === occ.id) app.updateDraft({ blockTarget: d.blockTarget === occ.id ? undefined : occ.id });
          else app.toast('A Blitz can only Block its declared target.', 'error');
        } else if (d.blitzTarget === occ.id) {
          app.updateDraft({ blockTarget: d.blockTarget ? undefined : occ.id });
        } else app.updateDraft({ blitzTarget: occ.id, blockTarget: occ.id });
        return;
      }
      if (d.action === 'move' && occ && occ.team !== mover.team) {
        // Destination clicked first, then the opponent: make it a Blitz with that route (if a Blitz can still be declared).
        const act = g.turn.activation;
        const continuing = !!act && act.playerId === mover.id;
        const canBlitz = !continuing && !!E.actionOptions(g, mover).find((o) => o.action === 'blitz')?.enabled;
        if (canBlitz && occ.stance === 'standing') planBlitzOn(mover, occ, d.path);
        else app.toast(continuing ? 'This player declared a Move Action: a Move cannot include a Block.' : g.turn.used.blitz ? 'The Blitz has already been used this Turn (p.64).' : `${E.label(occ)} cannot be Blitzed now.`, 'error');
        return;
      }
      if (d.action === 'pass' && (d.clickMode === 'target' || (occ && occ.team === mover.team))) {
        app.updateDraft({ passTarget: c });
        return;
      }
      if (d.action === 'ttm') {
        if (d.clickMode === 'target') {
          app.updateDraft({ throwTarget: c });
          return;
        }
        if (occ && occ.team === mover.team) {
          app.updateDraft({ thrownPlayerId: occ.id, clickMode: 'target' });
          return;
        }
      }
      if (d.action === 'handoff' && occ && occ.team === mover.team) {
        app.updateDraft({ handoffTarget: occ.id });
        return;
      }
      if (occ) return;
      editPath(app, c);
      return;
    }
    if (occ && quickAttack(occ)) return;
    if (!occ && clickToMove(c)) return;
    // V5.5: a click on the selected Prone player plans a Stand Up (a Move Action standing up where they are; standing
    // costs 3 squares of movement, or a 4+ roll with MA 2 or less — shown in the plan before anything is rolled).
    if (occ && occ.id === app.st.selected && occ.team === g.turn.active && occ.stance === 'prone' && !occ.activated) {
      const mv = E.actionOptions(g, occ).find((o) => o.action === 'move');
      if (mv?.enabled) {
        app.startDraft('move');
        app.toast(`Stand Up planned for ${E.label(occ)} — Confirm, or click squares to move on after standing up.`);
        return;
      }
    }
    if (occ) app.select(app.st.selected === occ.id ? null : occ.id);
    else app.select(null);
  }

  /**
   * Delete / Backspace, by context (never destructive without a confirmation):
   *  plan being edited or reviewed → cancel the whole plan (route, targets, action) in one go;
   *  match set-up → selected player to the Reserves Box;
   *  position editor / team builder → delete the selected player at once (V5.5: ⌘Z / Ctrl+Z or “↶ Undo” puts it back);
   *  otherwise → offer to undo the last confirmed action (asks first).
   */
  function deleteKey(): boolean {
    const st = app.st;
    if (st.screen === 'teams') {
      if (st.teamSel) {
        removeTeamPlayer(app, st.teamSel);
        return true;
      }
      return false;
    }
    if (st.screen !== 'board') return false;
    if (st.view === 'setup') return editorDeleteSelected(app);
    if (app.playbackActive()) return false;
    const d = st.draft;
    if (d) {
      // V5.5: one key press = one planning operation taken back (a whole automatic route counts as one); the first
      // operation of the plan cancels it. Nothing was rolled either way.
      const r = app.undoDraftOp();
      if (r === 'cancelled') app.toast('Plan cancelled — nothing was rolled or changed.');
      return true;
    }
    if (setupRemoveSelected(app)) {
      app.emit();
      return true;
    }
    if (currentExercise(app) && !st.lesson.playing) return false;
    if (app.canUndo()) {
      app.set({ modal: { kind: 'undo' } });
      return true;
    }
    app.toast('Nothing to undo on this board.');
    return true;
  }

  document.addEventListener('keydown', (ev) => {
    const tag = (ev.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (ev.target as HTMLElement)?.isContentEditable) return;
    const m = app.st.modal;
    if (m) {
      if (ev.key === 'Escape') app.set({ modal: null });
      // Backspace / Delete again confirms the Undo it opened (a held key does not).
      if ((ev.key === 'Backspace' || ev.key === 'Delete') && m.kind === 'undo' && !ev.repeat) {
        const yes = document.querySelector('#confirm-undo') as HTMLButtonElement | null;
        if (yes) {
          ev.preventDefault();
          yes.click();
        }
        return;
      }
      if (ev.key === 'Enter') {
        const yes = document.querySelector('#confirm-yes, #confirm-undo') as HTMLButtonElement | null;
        if (yes) {
          ev.preventDefault();
          yes.click();
        }
      }
      return;
    }
    if (ev.key === 'Backspace' || ev.key === 'Delete') {
      if (deleteKey()) ev.preventDefault();
      return;
    }
    // V5.5: ⌘Z / Ctrl+Z — undo the last routine edit (team builder, position editor) without any confirmation.
    if ((ev.metaKey || ev.ctrlKey) && (ev.key === 'z' || ev.key === 'Z') && !ev.shiftKey) {
      if (app.st.screen === 'teams' && undoTeamEdit(app)) ev.preventDefault();
      else if (app.st.screen === 'board' && app.st.view === 'setup' && undoEditorDelete(app)) ev.preventDefault();
      return;
    }
    if (app.st.screen !== 'board') return;
    if (app.st.ctx.kind === 'replay') {
      const t = ev.target as HTMLElement | null;
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      if (ev.key === ' ') { ev.preventDefault(); if (!ev.repeat) toggleReplay(app); }
      else if (ev.key === 'ArrowRight') { ev.preventDefault(); replayStep(app, 1); }
      else if (ev.key === 'ArrowLeft') { ev.preventDefault(); replayStep(app, -1); }
      return;
    }
    if (!ev.altKey && !ev.metaKey && !ev.ctrlKey && handleDecisionKey(app, ev)) return;
    if (ev.key === ' ' && document.getElementById('computer-pause')) {
      ev.preventDefault();
      if (!ev.repeat) togglePause(app);
      return;
    }
    // Dice decisions in the tray: Space / Enter keeps the roll (no re-roll); 1-3 pick a block die.
    const pend = app.game.pending?.request;
    if (pend && !app.playbackActive() && document.querySelector('#tray-decision')) {
      if (pend.type === 'reroll' && pend.context?.kind === 'blockDice' && pend.context?.chooser === 'attacker' && /^[1-9]$/.test(ev.key)) {
        const dice = [...document.querySelectorAll('#tray-decision button.die.pick[data-keep-face]')] as HTMLButtonElement[];
        const b = dice[Number(ev.key) - 1];
        if (b) {
          ev.preventDefault();
          b.click();
        }
        return;
      }
      if ((ev.key === ' ' || ev.key === 'Enter') && pend.type === 'reroll' && pend.options.some((o) => o.id === 'none')) {
        ev.preventDefault();
        app.decide(pend, 'none');
        return;
      }
      if (pend.type === 'blockDie' && /^[1-9]$/.test(ev.key)) {
        const dice = [...document.querySelectorAll('#tray-decision button.die.pick')] as HTMLButtonElement[];
        const b = dice[Number(ev.key) - 1];
        if (b && !b.disabled) {
          ev.preventDefault();
          b.click();
        }
        return;
      }
    }
    if ((ev.key === ' ' || ev.key === 'Enter') && app.playbackActive()) {
      ev.preventDefault();
      app.advancePlayback();
      return;
    }
    if ((ev.key === ' ' || ev.key === 'Enter') && app.st.replayQueue.length && !app.game.pending) {
      ev.preventDefault();
      app.replayNext();
      return;
    }
    // V5.5: J toggles the Jump / Leap planning mode while a route is being planned.
    if ((ev.key === 'j' || ev.key === 'J') && app.st.draft && app.st.stage === 'plan' && (app.st.draft.jumpMode || draftJumps(app).length)) {
      app.updateDraft({ jumpMode: !app.st.draft.jumpMode });
      return;
    }
    if (ev.key === 't' || ev.key === 'T') app.set({ showTZ: !app.st.showTZ });
    if (ev.key === 'r' || ev.key === 'R') {
      app.st.showReach = !app.st.showReach;
      app.savePrefs();
      app.emit();
    }
    if (ev.key === 'Escape') {
      if (app.st.draft?.jumpMode) app.updateDraft({ jumpMode: false });
      else if (app.st.draft) app.cancelDraft();
      else app.select(null);
    }
    if (ev.key === 'Enter' && app.st.draft) {
      ev.preventDefault();
      if (!ev.repeat) app.confirmNow();
    }
    if ((ev.metaKey || ev.ctrlKey) && ev.key === 's') {
      ev.preventDefault();
      void save();
    }
  });

  // Native menu commands (Swift wrapper)
  window.__bloodboardNativeMenu = (cmd: string) => {
    if (cmd === 'new') {
      app.st.screen = 'board';
      newPosition();
    } else if (cmd === 'open') app.set({ screen: 'board', modal: { kind: 'library' } });
    else if (cmd === 'save') void save();
    else if (cmd === 'saveAs') app.set({ modal: { kind: 'saveAs' } });
    else if (cmd === 'export') void exportFile();
    else if (cmd === 'import') void importFile();
    else if (cmd === 'examples') app.set({ screen: 'board', modal: { kind: 'examples' } });
    else if (cmd === 'help') app.set({ modal: { kind: 'help' } });
    else if (cmd === 'toggleTZ') app.set({ showTZ: !app.st.showTZ });
    else if (cmd === 'home') app.set({ screen: 'home' });
    else if (cmd === 'undo') {
      if (app.st.screen === 'teams') undoTeamEdit(app);
      else if (app.st.view === 'setup') undoEditorDelete(app);
      else if (app.canUndo()) app.requestUndo();
    }
  };

  app.onChange(render);
  initPitchInput();
  // The computer opponent acts after a render when it is its turn to.
  app.onChange(() => driveComputer(app));
  render();
  void openPractice;
  return app;
}

export function teamName(g: GameState, t: TeamId) {
  return g.teams[t].name;
}

boot(document.getElementById('app') as HTMLElement);
