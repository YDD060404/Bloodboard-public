/** Home screen (choose a mode) and the Learn screen (course lists with progress). */
import type { App } from './app';
import { h } from './dom';
import { openLan } from './lanclient';
import { E } from './engine-global';
import { EXAMPLES } from './examples';
import { EXERCISES, LEVELS, TUTORIALS, openBlockSchool, openTutorial, progress, resetProgress, teachOpen } from './lessons';
import { startDemoMatch } from './matchui';
import { ensureTeamsLoaded } from './teams';
import { configureQuick, MODE_LABEL, openSetup, setupSummary, startFromSetupAsync, startQuick } from './matchsetup';
import { activeQuick, deleteQuickPreset, modeCfg, quickPresets, restoreQuickPreset, saveQuickPreset, saveSetupStore, setActiveQuick, type QuickPreset, type SetupMode } from './setupPrefs';

export function openPractice(app: App, exampleIndex = 0) {
  const ex = EXAMPLES[exampleIndex];
  const parsed = E.parseSaveFile(JSON.stringify(ex.file));
  if (!parsed.ok) return app.toast('Could not load the example.', 'error');
  app.openBoard(parsed.save.state, { kind: 'practice', name: ex.name, start: E.cloneState(parsed.save.state) }, { docName: ex.name });
}

/** Start the remembered set-up of a mode at once (errors: open the set-up, which lists them). */
function quickStart(app: App, mode: SetupMode) {
  void startFromSetupAsync(app, mode).then((errs) => {
    if (errs.length) {
      openSetup(app, mode);
      app.toast(errs[0], 'error');
    }
  });
}

/**
 * V5.5: a mode card — its one-click start with the remembered set-up (both players, teams, AI, format…), the full
 * set-up (Player 1 / Player 2), and the mode's teams.
 */
function modeCard(app: App, mode: 'league' | 'tournament' | 'exhibition', title: string, text: string, extra: HTMLElement[] = []): HTMLElement {
  const cfg = modeCfg(mode);
  const format = cfg.format;
  const quickLabel = mode === 'league' ? 'Play League match' : `${format === 'sevens' ? 'Sevens ' : ''}${MODE_LABEL[mode]} match`;
  return h(
    'div',
    { class: 'modecard', id: `card-${mode}` },
    h('h2', null, title),
    h('p', null, text),
    mode === 'league'
      ? null
      : h(
          'div',
          { class: 'seg small', id: `${mode}-format` },
          (['standard', 'sevens'] as const).map((f) => h('button', { class: `segbtn ${format === f ? 'on' : ''}`, id: `${mode}-format-${f}`, onclick: () => { cfg.format = f; if (!cfg.budgetCustom) cfg.budget = f === 'sevens' ? 600_000 : mode === 'tournament' ? 1_100_000 : 1_000_000; saveSetupStore(); app.emit(); } }, f === 'sevens' ? 'Sevens' : '11-a-side')),
        ),
    h('p', { class: 'small muted setupline', id: `${mode}-remembered` }, setupSummary(mode)),
    h(
      'div',
      { class: 'btnrow' },
      h('button', { class: 'btn primary', id: `${mode}-quick`, title: 'Start at once with the choices shown (remembered from last time)', onclick: () => quickStart(app, mode) }, `▶ ${quickLabel}`),
      h('button', { class: 'btn', id: `${mode}-setup`, onclick: () => openSetup(app, mode) }, 'Set up…'),
    ),
    h(
      'div',
      { class: 'btnrow' },
      h('button', { class: 'btn small', id: `mode-${mode}`, onclick: () => app.set({ screen: 'teams', teamKind: mode, teamFormat: mode === 'league' ? 'standard' : format, teamEdit: null }) }, `${MODE_LABEL[mode]} teams`),
      ...extra,
    ),
  );
}

/**
 * V5.5: Quick Match — one click starts the chosen preset (a mode and its complete set-up: format, Player 1 / Player 2
 * Human or Computer with their AI files, saved or ready-made teams with their skills, budget, rules…). “Configure
 * Quick Match” opens it on the set-up screen; presets are kept across restarts.
 */
function quickCard(app: App): HTMLElement {
  const presets = quickPresets();
  const p = activeQuick();
  const card = h('div', { class: 'modecard quickcard', id: 'card-quick' });
  card.appendChild(h('h2', null, 'Quick Match'));
  if (presets.length > 1)
    card.appendChild(
      h(
        'label',
        { class: 'field' },
        h('span', { class: 'flabel' }, 'Preset'),
        h('select', { id: 'quick-preset', 'aria-label': 'Quick Match preset', onchange: (e: Event) => { setActiveQuick((e.target as HTMLSelectElement).value); app.emit(); } }, presets.map((x) => h('option', { value: x.id, selected: x.id === p.id }, x.name))),
      ),
    );
  else card.appendChild(h('p', null, h('b', null, p.name)));
  card.appendChild(h('p', { class: 'small muted setupline', id: 'quick-summary' }, `${MODE_LABEL[p.mode]} · ${setupSummary(p.mode, p.cfg)}`));
  card.appendChild(
    h(
      'div',
      { class: 'btnrow' },
      h('button', { class: 'btn primary', id: 'quick-match', title: `Start “${p.name}” now`, onclick: () => startQuick(app, p.id) }, p.cfg.p1.controller === 'computer' && p.cfg.p2.controller === 'computer' ? '▶ Quick Match (watch)' : '▶ Quick Match'),
      h('button', { class: 'btn', id: 'quick-configure', title: 'Choose what ▶ Quick Match starts: mode, format, Player 1 / Player 2, AI files, teams, budget, skills…', onclick: () => configureQuick(app, p.id) }, 'Configure Quick Match…'),
    ),
  );
  card.appendChild(
    h(
      'div',
      { class: 'btnrow tight' },
      h('button', { class: 'btn small ghost', id: 'quick-new', title: 'A new preset, starting as a copy of this one', onclick: () => { const n = saveQuickPreset(p.mode, p.cfg, { name: `${p.name} (copy)` }); configureQuick(app, n.id); } }, '+ New preset'),
      presets.length > 1
        ? h('button', { class: 'btn small ghost', id: 'quick-delete', title: 'Remove this preset (Undo brings it back)', onclick: () => { const gone = deleteQuickPreset(p.id); if (gone) { lastDeletedQuick = gone; app.toast(`Removed the preset “${gone.name}”.`); } app.emit(); } }, 'Remove preset')
        : null,
      lastDeletedQuick ? h('button', { class: 'btn small ghost', id: 'quick-undo-delete', onclick: () => { if (lastDeletedQuick) { restoreQuickPreset(lastDeletedQuick); setActiveQuick(lastDeletedQuick.id); lastDeletedQuick = null; } app.emit(); } }, '↶ Undo remove') : null,
    ),
  );
  return card;
}

let lastDeletedQuick: QuickPreset | null = null;

/** The exact build this window runs: version plus the first 12 characters of the engine, rules and API hashes. */
export function buildLine(): string {
  const f = E.BUILD_FINGERPRINT;
  return `Build ${f.version} · engine ${f.engineHash.slice(0, 12)} · rules ${f.rulesHash.slice(0, 12)} · API ${f.apiHash.slice(0, 12)}`;
}

export function renderHome(app: App): HTMLElement {
  ensureTeamsLoaded(app);
  const inBoard = app.st.ctx;
  const cont =
    app.st.history.length || app.game.log.length
      ? h('button', { class: 'btn', onclick: () => app.set({ screen: 'board' }) }, `Continue: ${inBoard.kind === 'match' ? app.game.title ?? 'match' : app.st.docName ?? 'current board'}`)
      : null;
  const card = (title: string, text: string, btn: HTMLElement, extra?: HTMLElement | null) => h('div', { class: 'modecard' }, h('h2', null, title), h('p', null, text), extra ?? null, btn);
  return h(
    'div',
    { class: 'home' },
    h('div', { class: 'hero' }, h('span', { class: 'logo big' }, '◆'), h('div', null, h('h1', null, 'Bloodboard Unified'), h('p', { class: 'muted' }, 'Play in your browser. Join a room with a friend, or practise locally with your own coaches.'))),
    h('div', { class: 'modecard online-room-card' }, h('h2', null, 'Play with a friend'), h('p', null, 'Open the same server address on both devices. Player 1 sets up the match; Player 2 joins with the private room code.'), h('button', { class: 'btn primary', id: 'online-room-open', onclick: () => openLan(app) }, app.lan ? 'Manage my room' : 'Join / reconnect'), h('p', { class: 'small muted' }, 'Temporary disconnect keeps your seat. The host can archive an unfinished match and open a fresh room.')),
    cont ? h('div', { class: 'btnrow center' }, cont) : null,
    h('div', { class: 'modes quickrow' }, quickCard(app)),
    h(
      'div',
      { class: 'modes' },
      modeCard(app, 'league', 'League', 'Your saved League teams with their team state — players, injuries, Star Player Points and advancement (pp.96-97) — played 11-a-side, with the pre-match Journeymen, Petty Cash and Inducements (Star Players for hire, p.94).'),
      modeCard(app, 'tournament', 'Tournament', 'Matched Play: a Team Draft Budget and Skill Points by Tier (official May 2026 Tiers; Mega-stars) — 11-a-side (rulebook pp.110-113) or Sevens (Spike! 22 pp.18-19).'),
      modeCard(app, 'exhibition', 'Exhibition', 'One-off matches with drafted teams and no purchased skills (pp.114-117). Also the All-Star Match (Star Players only — a custom variant) and the Tactical board.', [
        h('button', { class: 'btn small', id: 'mode-allstar', title: 'All-Star Match: two squads of Star Players (custom Exhibition variant)', onclick: () => openSetup(app, 'allstar') }, '★ All-Star Match'),
        h('button', { class: 'btn small', id: 'mode-board', title: 'Free set-up of any position, played with a fixed dice seed (Reset, Replay, New seed)', onclick: () => openPractice(app, 0) }, 'Tactical board'),
      ]),
      card('Teaching', 'Basic Tutorials on the core rules, and Block School — 80 blocking exercises in 7 levels, each playable on the board with hints and engine-checked solutions.', h('button', { class: 'btn primary', id: 'mode-learn', onclick: () => app.set({ screen: 'learn' }) }, 'Open Teaching')),
    ),
    h('p', { class: 'small muted center' }, 'Human v human on one computer, human v computer, or computer v computer to watch. Local matches run in your browser. Network matches use the authoritative room server. Imported local coaches remain available for offline practice; network AI seats are planned for a later release.'),
    h('p', { class: 'small muted center', id: 'build-line', title: 'Compare these with the installer report and the Match Lab run records' }, buildLine()),
  );
}

function toggleOpen(app: App, key: string) {
  if (teachOpen.has(key)) teachOpen.delete(key);
  else teachOpen.add(key);
  app.emit();
}

/**
 * V3: one Teaching area with both courses (Basic Tutorials, Block School) as a
 * compact list. Courses, tutorials and Block School levels stay collapsed until
 * the coach opens them; opening an exercise or tutorial goes to the board,
 * where only that lesson's card is shown.
 */
export function renderLearn(app: App): HTMLElement {
  const tutDone = TUTORIALS.filter((t) => progress[t.id]?.done).length;
  const bsDone = EXERCISES.filter((e) => progress[e.id]?.done).length;
  const chev = (open: boolean) => h('span', { class: 'chev' }, open ? '▾' : '▸');
  const courseRow = (key: string, id: string, title: string, meta: string, text: string, body: () => HTMLElement) => {
    const open = teachOpen.has(key);
    return h(
      'section',
      { class: `tcourse ${open ? 'open' : ''}` },
      h('button', { class: 'trow', id, 'aria-expanded': open ? 'true' : 'false', onclick: () => toggleOpen(app, key) }, chev(open), h('b', null, title), h('span', { class: 'small muted tmeta' }, meta)),
      open ? h('div', { class: 'tbody' }, h('p', { class: 'small muted' }, text), body()) : null,
    );
  };
  const tutorials = () =>
    h(
      'ol',
      { class: 'tlist' },
      TUTORIALS.map((t, i) => {
        const key = `tut:${t.id}`;
        const open = teachOpen.has(key);
        const done = !!progress[t.id]?.done;
        return h(
          'li',
          { class: `titem ${done ? 'done' : ''} ${open ? 'open' : ''}` },
          h('button', { class: 'trow small', 'data-lesson-toggle': t.id, 'aria-expanded': open ? 'true' : 'false', onclick: () => toggleOpen(app, key) }, chev(open), h('span', null, `${i + 1}. ${t.title}`), done ? h('span', { class: 'tick' }, '✓') : null),
          open
            ? h(
                'div',
                { class: 'tdetail' },
                h('div', { class: 'small muted' }, t.summary, ' · ', t.rules.map((r) => `p.${r.page}`).join(', ')),
                t.scenario
                  ? h('button', { class: 'btn small primary', 'data-lesson': t.id, onclick: () => openTutorial(app, t.id) }, done ? 'Practise again' : 'Start')
                  : h('button', { class: 'btn small primary', 'data-lesson': t.id, onclick: () => startDemoMatch(app) }, 'Start a demo match'),
              )
            : null,
        );
      }),
    );
  const levels = () =>
    h(
      'div',
      { class: 'tlist' },
      LEVELS.map((l) => {
        const key = `lvl:${l.level}`;
        const open = teachOpen.has(key);
        const ex = EXERCISES.filter((e) => e.level === l.level);
        const done = ex.filter((e) => progress[e.id]?.done).length;
        return h(
          'div',
          { class: `titem ${open ? 'open' : ''}` },
          h('button', { class: 'trow small', 'data-level': String(l.level), 'aria-expanded': open ? 'true' : 'false', onclick: () => toggleOpen(app, key) }, chev(open), h('span', null, `Level ${l.level}: ${l.title}`), h('span', { class: 'small muted tmeta' }, `${done}/${ex.length}`)),
          open
            ? h(
                'div',
                { class: 'tdetail' },
                h('p', { class: 'small muted' }, l.intro),
                h(
                  'div',
                  { class: 'exgrid' },
                  ex.map((e) => h('button', { class: `exbtn ${progress[e.id]?.done ? 'done' : progress[e.id] ? 'tried' : ''}`, title: `${e.question} (workbook p.${e.page})`, 'data-ex': e.id, onclick: () => openBlockSchool(app, e.id) }, String(e.number))),
                ),
              )
            : null,
        );
      }),
    );
  // "Next up": the first unfinished lesson of each course, one click away.
  const nextTut = TUTORIALS.find((t) => t.scenario && !progress[t.id]?.done);
  const nextEx = EXERCISES.find((e) => !progress[e.id]?.done);
  return h(
    'div',
    { class: 'learn teaching' },
    h('div', { class: 'row-between' }, h('button', { class: 'btn ghost', onclick: () => app.set({ screen: 'home' }) }, '← Home'), h('button', { class: 'btn ghost small', onclick: () => app.confirmModal('Reset course progress?', 'This clears the completed marks for both courses on this computer.', 'Reset progress', () => resetProgress(app, [...TUTORIALS.map((t) => t.id), ...EXERCISES.map((e) => e.id)])) }, 'Reset progress')),
    h('div', { class: 'row-between' }, h('h1', null, 'Teaching'), h('span', { class: 'small muted' }, `Basic Tutorials ${tutDone}/${TUTORIALS.length} · Block School ${bsDone}/${EXERCISES.length}`)),
    nextTut || nextEx
      ? h(
          'div',
          { class: 'btnrow nextup' },
          h('span', { class: 'small muted' }, 'Next up:'),
          nextTut ? h('button', { class: 'btn small', onclick: () => openTutorial(app, nextTut.id) }, `Tutorial ${TUTORIALS.indexOf(nextTut) + 1}: ${nextTut.title}`) : null,
          nextEx ? h('button', { class: 'btn small', onclick: () => openBlockSchool(app, nextEx.id) }, `Block School L${nextEx.level} · ${nextEx.number}`) : null,
        )
      : null,
    h(
      'div',
      { class: 'tcourses' },
      courseRow('course:tutorials', 'course-tutorials', 'Basic Tutorials', `${tutDone} of ${TUTORIALS.length} completed`, 'Short playable lessons on the core rules, with an objective checked by the rules engine. Page numbers refer to the rulebook.', tutorials),
      courseRow(
        'course:blockschool',
        'course-blockschool',
        'Block School',
        `${bsDone} of ${EXERCISES.length} solved · 7 levels`,
        'Exercises from “BB School of Block” (an unofficial fan-made workbook by Ferns, bbsob.net), checked against the rulebook: dice count, assists, Strength, Guard, positioning and block sequence. Differences between the workbook and the rules engine are pointed out in the exercise.',
        levels,
      ),
    ),
  );
}
