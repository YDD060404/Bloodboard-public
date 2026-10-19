/**
 * Teaching area: Basic Tutorials and the Block School course.
 * Every exercise is played on the board; answers are checked and explained by
 * the rules engine (E.checkExercise / E.blockBreakdown / E.checkGoal).
 */
import { freshLesson, type App } from './app';
import { EXERCISES, EXERCISE_BY_ID, LEVELS, BLOCK_SCHOOL_SOURCE, type BlockSchoolExercise } from '../courses/blockSchool';
import { TUTORIALS, TUTORIAL_BY_ID, type Tutorial } from '../courses/basics';
import { h } from './dom';
import { E, type Coord, type DiceCode, type ExecutionResult } from './engine-global';
import { ruleTag } from './panels';
import { setExtraMarks, setLessonGrid, type Marks } from './pitch';
import { matchMarks } from './matchui';

// ---------------------------------------------------------------------------
// Progress (saved in the Progress folder / browser storage; no accounts)
// ---------------------------------------------------------------------------

export interface ProgressEntry {
  done: boolean;
  attempts: number;
  at: string;
}
export const progress: Record<string, ProgressEntry> = {};

export async function loadProgress(app: App) {
  try {
    const txt = await app.progressStore.load('progress');
    const data = JSON.parse(txt) as { format?: string; entries?: Record<string, ProgressEntry> };
    if (data.format === 'bloodboard-progress' && data.entries) Object.assign(progress, data.entries);
    app.emit();
  } catch {
    /* no progress saved yet */
  }
}

function saveProgress(app: App) {
  void app.progressStore.save('progress', JSON.stringify({ format: 'bloodboard-progress', version: 1, entries: progress }, null, 1)).catch(() => undefined);
}

function record(app: App, id: string, done: boolean) {
  const cur = progress[id] ?? { done: false, attempts: 0, at: '' };
  progress[id] = { done: cur.done || done, attempts: cur.attempts + 1, at: new Date().toISOString() };
  saveProgress(app);
}

/** Teaching area: which courses / tutorials / levels are expanded (collapsed by default, kept for the session). */
export const teachOpen = new Set<string>();

export function resetProgress(app: App, ids: string[]) {
  for (const id of ids) delete progress[id];
  saveProgress(app);
  app.emit();
}

// ---------------------------------------------------------------------------
// Opening lessons
// ---------------------------------------------------------------------------

export function openBlockSchool(app: App, id: string) {
  const ex = EXERCISE_BY_ID[id];
  if (!ex) return;
  const seed = 5000 + EXERCISES.indexOf(ex);
  const s = E.buildWorkbookState(ex, seed);
  s.title = `Block School ${ex.id}`;
  app.openBoard(s, { kind: 'lesson', course: 'blockSchool', id, start: E.cloneState(s) }, { docName: `Block School · Level ${ex.level} · Exercise ${ex.number}` });
  if (ex.movers && ex.movers.length === 1) app.st.lesson.pick = ex.movers[0];
  if (ex.kind === 'pushSquare') app.st.lesson.pick = null;
  app.emit();
}

export function openTutorial(app: App, id: string) {
  const t = TUTORIAL_BY_ID[id];
  if (!t?.scenario) return;
  const s = E.buildScenario(t.scenario, t.seed);
  s.title = t.title;
  app.openBoard(s, { kind: 'lesson', course: 'basics', id, start: E.cloneState(s) }, { docName: `Tutorial · ${t.title}` });
  app.st.lesson.playing = true;
  app.emit();
}

export function currentExercise(app: App): BlockSchoolExercise | null {
  const c = app.st.ctx;
  return c.kind === 'lesson' && c.course === 'blockSchool' ? EXERCISE_BY_ID[c.id] ?? null : null;
}

export function currentTutorial(app: App): Tutorial | null {
  const c = app.st.ctx;
  return c.kind === 'lesson' && c.course === 'basics' ? TUTORIAL_BY_ID[c.id] ?? null : null;
}

setLessonGrid((app) => {
  const ex = currentExercise(app);
  return ex ? { cols: ex.cols, rows: ex.rows } : null;
});

/** Called after every execution: tutorials check their objective. */
export function lessonAfterExecution(app: App, res: ExecutionResult) {
  const t = currentTutorial(app);
  const c = app.st.ctx;
  if (!t || c.kind !== 'lesson') return;
  const chk = E.checkGoal(res.state, t.goal, c.start.log.length);
  const L = app.st.lesson;
  if (chk.done && L.status !== 'done') {
    L.status = 'done';
    L.message = chk.text;
    L.attempts += 1;
    record(app, t.id, true);
  } else if (chk.failed && L.status === 'open') {
    L.status = 'failed';
    L.message = chk.text;
    L.attempts += 1;
    record(app, t.id, false);
  }
}

// ---------------------------------------------------------------------------
// Board clicks while answering a Block School exercise
// ---------------------------------------------------------------------------

function answer(app: App, a: Parameters<typeof E.checkExercise>[1]) {
  const ex = currentExercise(app);
  if (!ex) return;
  const res = E.checkExercise(ex, a);
  const L = app.st.lesson;
  L.result = res;
  L.attempts += 1;
  record(app, ex.id, res.correct);
  app.emit();
}

export function lessonClick(app: App, c: Coord): boolean {
  const ex = currentExercise(app);
  const L = app.st.lesson;
  if (!ex || L.playing) return false;
  const g = app.game;
  const occ = E.playerAt(g, c);
  if (ex.kind === 'moveOne' || ex.kind === 'normalMove') {
    if (occ && ex.movers?.includes(occ.id)) {
      L.pick = occ.id;
      L.result = null;
      app.emit();
      return true;
    }
    if (!L.pick) {
      app.toast(`First click the player you move (${(ex.movers ?? []).join(' or ')}).`, 'error');
      return true;
    }
    if (occ && occ.id !== L.pick) {
      app.toast('Pick an empty square.', 'error');
      return true;
    }
    answer(app, { kind: 'move', mover: L.pick, to: c });
    return true;
  }
  if (ex.kind === 'blockFirst') {
    if (!occ || occ.team !== 'B') {
      app.toast('Click the opponent (a Y player) you would block first.', 'error');
      return true;
    }
    answer(app, { kind: 'first', target: occ.id });
    return true;
  }
  if (ex.kind === 'whoBlocks') {
    if (!occ || !(ex.blockers ?? []).includes(occ.id)) {
      app.toast(`Click the X player who blocks first (${(ex.blockers ?? []).join(' or ')}).`, 'error');
      return true;
    }
    answer(app, { kind: 'first', blocker: occ.id, target: '' });
    return true;
  }
  if (ex.kind === 'pushSquare') {
    answer(app, { kind: 'push', to: c });
    return true;
  }
  return false;
}

/** Highlights for the current exercise: assists (green) and blocked helpers (red), push squares, movers. */
setExtraMarks((app): Marks => {
  const ex = currentExercise(app);
  const L = app.st.lesson;
  const marks: Marks = { squares: [] };
  const g = app.game;
  if (!ex) {
    return matchMarks(app);
  }
  if (L.playing) return marks;
  if (L.result) {
    // the board shows the answer's result; choices come back with Retry
  } else if (ex.kind === 'pushSquare') {
    for (const sq of E.pushOptions(g, (ex.blockers ?? [])[0], (ex.firstTargets ?? [])[0])) marks.squares!.push({ c: sq, cls: 'choice', label: E.lessonLabel(sq) });
  }
  if (!L.result && (ex.kind === 'moveOne' || ex.kind === 'normalMove') && L.pick) {
    const p = E.findPlayer(g, L.pick);
    if (p?.pos) {
      const squares = ex.kind === 'moveOne' ? E.board.neighbours(p.pos).filter((c) => !E.playerAt(g, c)) : E.moveReach(g, p.id);
      for (const c of squares) {
        const col = c.x - E.LESSON_ORIGIN.x;
        const row = c.y - E.LESSON_ORIGIN.y;
        if (col >= 0 && row >= 0 && col < ex.cols && row < ex.rows) marks.squares!.push({ c, cls: 'choice' });
      }
    }
  }
  const b = L.result?.breakdown ?? (L.solution && ex.kind === 'count' ? E.blockBreakdown(g, ex.attacker, ex.defender) : null);
  if (b) {
    marks.good = [...b.offensive, ...b.defensive].filter((x) => x.assists).map((x) => x.id);
    marks.bad = [...b.offensive, ...b.defensive].filter((x) => !x.assists).map((x) => x.id);
  }
  return marks;
});

/** Match set-up marks (own half, Line of Scrimmage, kick targets, Wizard spells) come from matchui.ts (matchMarks). */

// ---------------------------------------------------------------------------
// Side panels
// ---------------------------------------------------------------------------

const CODES: Array<{ code: DiceCode; label: string }> = [
  { code: '3D', label: '3 dice, attacker chooses' },
  { code: '2D', label: '2 dice, attacker chooses' },
  { code: '1D', label: '1 die' },
  { code: '-2D', label: '2 dice, defender chooses' },
  { code: '-3D', label: '3 dice, defender chooses' },
];

function facts(ex: BlockSchoolExercise): string {
  const st = Object.entries(ex.strength)
    .filter(([, v]) => v !== ex.defaultST)
    .map(([k, v]) => `${k} ST ${v}`);
  const parts = [`All players ST ${ex.defaultST}${st.length ? ` except ${st.join(', ')}` : ''}.`];
  parts.push(ex.guard.length ? `Guard: ${ex.guard.join(', ')}.` : 'No relevant skills.');
  return parts.join(' ');
}

function breakdownBox(b: import('./engine-global').BlockBreakdown) {
  return h(
    'div',
    { class: 'breakdown' },
    h('div', { class: 'row-between' }, h('b', null, `${b.attacker} on ${b.defender}: ${b.code}`), h('span', { class: 'small muted' }, `ST ${b.attST} v ${b.defST}`)),
    h('ul', { class: 'small' }, b.lines.map((l) => h('li', null, l))),
  );
}

export function renderBlockSchoolSide(app: App): HTMLElement {
  const ex = currentExercise(app) as BlockSchoolExercise;
  const L = app.st.lesson;
  const lvl = LEVELS.find((l) => l.level === ex.level)!;
  const same = EXERCISES.filter((e) => e.level === ex.level);
  const idx = EXERCISES.indexOf(ex);
  const wrap = h('div', { class: 'side-inner' });
  const card = h(
    'div',
    { class: 'card lesson' },
    h('div', { class: 'row-between' }, h('span', { class: 'pill' }, `Block School · Level ${ex.level}: ${lvl.title}`), h('span', { class: 'small muted' }, `Exercise ${ex.number} of ${same.length}`)),
    h('details', { class: 'small' }, h('summary', null, 'About this level'), h('p', null, lvl.intro, ' ', ...lvl.rules.map((r) => ruleTag(r)))),
    h('p', { class: 'question' }, ex.question),
    h('p', { class: 'small muted' }, facts(ex), ' Workbook p.', String(ex.page), ' (answer p.', String(ex.answerPage), ').'),
  );
  if (L.playing) {
    card.appendChild(h('p', { class: 'small' }, 'Playing the position with real dice. Plan and confirm actions as usual; Reset returns to the exercise (same dice), New seed changes the dice.'));
    card.appendChild(
      h(
        'div',
        { class: 'btnrow' },
        h('button', { class: 'btn', onclick: () => { app.practiceReset(); } }, 'Reset'),
        h('button', { class: 'btn ghost', onclick: () => app.practiceNewSeed(Math.floor(Math.random() * 2 ** 31)) }, 'New seed'),
        h('button', { class: 'btn', onclick: () => { app.practiceReset(); app.st.lesson = { ...freshLesson(), attempts: L.attempts }; app.emit(); } }, '← Back to the question'),
      ),
    );
    wrap.appendChild(card);
    return wrap;
  }
  // answering
  if (ex.kind === 'count') {
    card.appendChild(h('div', { class: 'codes' }, CODES.map((c) => h('button', { class: `btn code ${L.result?.answerText === c.code ? (L.result.correct ? 'ok' : 'bad') : ''}`, onclick: () => answer(app, { kind: 'count', code: c.code }) }, h('b', null, c.code.replace('-', '−')), h('small', null, c.label)))));
  } else {
    const how: Record<string, string> = {
      moveOne: (ex.movers ?? []).length > 1 ? `Click ${ex.movers!.join(' or ')}, then the square it moves to (one square).` : `Click the square ${ex.movers![0]} moves to (one square).`,
      normalMove: `Click the square ${ex.movers![0]} moves to (a normal Move through empty squares; its current square means “stay”).`,
      blockFirst: 'Click the opponent to block first.',
      whoBlocks: `Click the player who blocks first (${(ex.blockers ?? []).join(' or ')}).`,
      pushSquare: 'Click the square to push Y2 into (highlighted).',
    };
    card.appendChild(h('p', { class: 'instructions small' }, how[ex.kind]));
    if (L.pick && (ex.kind === 'moveOne' || ex.kind === 'normalMove')) card.appendChild(h('p', { class: 'small' }, `Moving ${L.pick}.`));
  }
  const res = L.result;
  if (res) {
    card.appendChild(h('div', { class: `feedback ${res.correct ? 'ok' : 'bad'}` }, h('b', null, res.correct ? '✓ ' : '✗ '), res.summary));
    if (res.breakdown && (ex.kind !== 'count' || !res.correct || L.solution)) card.appendChild(breakdownBox(res.breakdown));
    if (res.outcomes?.length) {
      const good = res.outcomes.filter((o) => o.ok);
      card.appendChild(h('details', { class: 'small', open: !res.correct }, h('summary', null, `Possible results of that Block (${good.length} of ${res.outcomes.length} give 2D)`), h('ul', null, res.outcomes.map((o) => h('li', { class: o.ok ? 'good' : 'muted' }, `${o.label} → ${o.code}`)))));
    }
  }
  // hints and solution
  const hintBtn = L.hints < ex.hints.length ? h('button', { class: 'btn ghost small', onclick: () => { L.hints += 1; app.emit(); } }, `Hint ${L.hints + 1} of ${ex.hints.length}`) : null;
  const solBtn = h('button', { class: 'btn ghost small', disabled: L.attempts === 0, title: L.attempts === 0 ? 'Make an attempt first' : '', onclick: () => { L.solution = !L.solution; app.emit(); } }, L.solution ? 'Hide solution' : L.attempts === 0 ? 'Solution (after an attempt)' : 'Show solution');
  card.appendChild(h('div', { class: 'btnrow' }, hintBtn, solBtn));
  if (L.hints) card.appendChild(h('ol', { class: 'hints small' }, ex.hints.slice(0, L.hints).map((t) => h('li', null, t))));
  if (L.solution) {
    const sol = E.solveExercise(ex);
    const box = h('div', { class: 'solution' }, h('h4', null, 'Solution (computed by the rules engine)'));
    if (ex.kind === 'count') box.appendChild(breakdownBox(sol.initial));
    else {
      box.appendChild(h('p', { class: 'small' }, `Correct answers: ${sol.answers.join(', ') || 'none'}.`));
      box.appendChild(h('ul', { class: 'small' }, sol.lines.slice(0, 14).map((l) => h('li', null, l))));
      if (sol.lines.length > 14) box.appendChild(h('p', { class: 'small muted' }, `…and ${sol.lines.length - 14} more results.`));
    }
    box.appendChild(h('p', { class: 'small' }, `Workbook answer: ${ex.workbookAnswer} (p.${ex.answerPage}).`));
    if (ex.discrepancy) box.appendChild(h('p', { class: 'small warn' }, 'Note: ', ex.discrepancy));
    card.appendChild(box);
  }
  card.appendChild(
    h(
      'div',
      { class: 'btnrow' },
      h('button', { class: 'btn', onclick: () => { L.result = null; L.pick = ex.movers && ex.movers.length === 1 ? ex.movers[0] : null; app.emit(); } }, 'Retry'),
      h('button', { class: 'btn', title: 'Play this position with real dice (Plan → Review → Confirm)', onclick: () => { L.playing = true; L.result = null; app.practiceReset(); app.st.lesson.playing = true; app.emit(); } }, 'Play it out with dice'),
    ),
  );
  card.appendChild(
    h(
      'div',
      { class: 'btnrow' },
      h('button', { class: 'btn ghost', disabled: idx === 0, onclick: () => openBlockSchool(app, EXERCISES[idx - 1].id) }, '◀ Previous'),
      h('button', { class: 'btn ghost', title: 'Back to the Teaching list (this level open)', onclick: () => { teachOpen.add('course:blockschool'); teachOpen.add(`lvl:${ex.level}`); app.set({ screen: 'learn' }); } }, 'Course'),
      h('button', { class: 'btn primary', disabled: idx === EXERCISES.length - 1, onclick: () => openBlockSchool(app, EXERCISES[idx + 1].id) }, 'Next ▶'),
    ),
  );
  card.appendChild(h('p', { class: 'tiny muted' }, BLOCK_SCHOOL_SOURCE));
  wrap.appendChild(card);
  return wrap;
}

export function renderTutorialCard(app: App): HTMLElement {
  const t = currentTutorial(app) as Tutorial;
  const L = app.st.lesson;
  const idx = TUTORIALS.indexOf(t);
  const status = L.status === 'done' ? h('div', { class: 'feedback ok' }, h('b', null, '✓ Objective complete. '), L.message ?? '') : L.status === 'failed' ? h('div', { class: 'feedback bad' }, h('b', null, '✗ '), L.message ?? '') : null;
  return h(
    'div',
    { class: 'card lesson' },
    h('div', { class: 'row-between' }, h('span', { class: 'pill' }, `Basic Tutorial ${idx + 1} of ${TUTORIALS.length}`), h('span', null, ...t.rules.map((r) => ruleTag(r)))),
    h('h3', null, t.title),
    h('details', { class: 'small', open: L.attempts === 0 && !app.game.log.length }, h('summary', null, 'How it works'), t.intro.map((p) => h('p', null, p))),
    h('div', { class: 'objective' }, h('b', null, 'Objective: '), t.objective),
    status,
    h(
      'div',
      { class: 'btnrow' },
      L.hints < t.hints.length ? h('button', { class: 'btn ghost small', onclick: () => { L.hints += 1; app.emit(); } }, `Hint ${L.hints + 1} of ${t.hints.length}`) : null,
      h('button', { class: 'btn ghost small', disabled: L.attempts === 0 && !app.game.log.length, title: 'Available after an attempt', onclick: () => { L.solution = !L.solution; app.emit(); } }, L.solution ? 'Hide solution' : 'Solution'),
      h('button', { class: 'btn small', onclick: () => app.practiceReset() }, 'Reset (same dice)'),
      h('button', { class: 'btn ghost small', onclick: () => app.practiceNewSeed(Math.floor(Math.random() * 2 ** 31)) }, 'New seed'),
    ),
    L.hints ? h('ol', { class: 'hints small' }, t.hints.slice(0, L.hints).map((x) => h('li', null, x))) : null,
    L.solution ? h('div', { class: 'solution small' }, h('h4', null, 'Solution'), t.solution.map((x) => h('p', null, x))) : null,
    h(
      'div',
      { class: 'btnrow' },
      h('button', { class: 'btn ghost small', disabled: idx === 0 || !TUTORIALS[idx - 1].scenario, onclick: () => openTutorial(app, TUTORIALS[idx - 1].id) }, '◀ Previous'),
      h('button', { class: 'btn ghost small', title: 'Back to the Teaching list', onclick: () => { teachOpen.add('course:tutorials'); app.set({ screen: 'learn' }); } }, 'Course'),
      TUTORIALS[idx + 1]?.scenario ? h('button', { class: 'btn small primary', onclick: () => openTutorial(app, TUTORIALS[idx + 1].id) }, 'Next ▶') : null,
    ),
  );
}

export { EXERCISES, LEVELS, TUTORIALS };
