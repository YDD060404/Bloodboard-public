// V7-11: tactical training mode in the game — exercise library, authoring from the current position, import/export (files and drag-and-drop),
// attempts on the real board (human), save/resume, fair scoring and feedback. All rules/grading live in the engine (src/engine/training.ts).
import type { App } from './app';
import { h } from './dom';
import { E } from './engine-global';
import type { Attempt, Exercise, ScoreReport } from '../engine/index';
import { shell } from './modals';
import { nextMove } from '../ai/index';
import type { AIStyle } from '../ai/types';

export interface TrainingSession { exercise: Exercise; attempt: Attempt; t0: number; baseElapsed: number; hintsShown: number; resumedFrom?: number }

const EX = 'exercise--';
const AT = 'attempt--';
let cache: { exercises: Exercise[]; attempts: Attempt[]; loaded: boolean; error?: string } = { exercises: [], attempts: [], loaded: false };
let lastReport: { report: ScoreReport; exercise: Exercise; attempt: Attempt } | null = null;
let draft = { id: '', title: '', objective: 'score' as Exercise['objective']['kind'], maxActions: '' , description: '' };

export const looksLikeTraining = (text: string): boolean => /"format"\s*:\s*"bloodboard-(exercise|exercise-pack|attempt)"/.test(text.slice(0, 600));

async function readAll<T>(app: App, prefix: string, parse: (t: string) => T | null): Promise<T[]> {
  const out: T[] = [];
  let names: { name: string }[] = [];
  try { names = await app.progressStore.list(); } catch { return out; }
  for (const n of names.filter((x) => x.name.startsWith(prefix))) {
    try { const v = parse(await app.progressStore.load(n.name)); if (v) out.push(v); } catch { /* an unreadable file is skipped, never deleted */ }
  }
  return out;
}

export async function refreshLibrary(app: App): Promise<void> {
  try {
    const exercises = await readAll<Exercise>(app, EX, (t) => { const v = JSON.parse(t) as Exercise; return E.checkTacticalExercise(v).ok ? v : null; });
    const attempts = await readAll<Attempt>(app, AT, (t) => { const v = JSON.parse(t) as Attempt; return E.validateAttemptShape(v).length ? null : v; });
    cache = { exercises, attempts, loaded: true };
  } catch (e) { cache = { exercises: [], attempts: [], loaded: true, error: (e as Error).message }; }
  app.emit();
}

export function openTraining(app: App): void { app.set({ modal: { kind: 'training' } }); void refreshLibrary(app); }

const safeName = (s: string) => s.replace(/[^\w.-]+/g, '-').slice(0, 64) || 'exercise';

async function storeExercise(app: App, ex: Exercise): Promise<void> { await app.progressStore.save(`${EX}${safeName(ex.id)}`, E.serializeTraining(ex), { exclusive: true }); }
async function storeAttempt(app: App, a: Attempt): Promise<void> { await app.progressStore.save(`${AT}${safeName(a.id)}`, E.serializeTraining(a)); }

// ------------------------------------------------------------- import / export

/** Import exercise, pack or attempt text (file picker, drop). Never overwrites; says what happened to every item. */
export async function importTrainingText(app: App, text: string, label = 'file'): Promise<boolean> {
  if (!cache.loaded) await refreshLibrary(app);
  const head = text.slice(0, 600);
  if (/"format"\s*:\s*"bloodboard-attempt"/.test(head)) {
    const r = E.importAttempt(text, cache.exercises, cache.attempts);
    if (!r.ok) { app.toast(`Attempt not imported: ${r.error}`, 'error'); return false; }
    if (r.duplicate) { app.toast('That attempt is already in your records.'); return true; }
    try { await storeAttempt(app, r.attempt); } catch (e) { app.toast(`Could not store the attempt: ${(e as Error).message}`, 'error'); return false; }
    await refreshLibrary(app);
    app.toast(`Attempt imported for “${r.exercise.title}” and verified by re-execution.`);
    return true;
  }
  const rep = E.importExercises(text, cache.exercises);
  const stored: string[] = []; const failed: string[] = [];
  for (const ex of rep.added) { try { await storeExercise(app, ex); stored.push(ex.id); } catch (e) { failed.push(`${ex.id}: ${(e as Error).message === 'exists' ? 'a file with that name already exists' : (e as Error).message}`); } }
  await refreshLibrary(app);
  const parts = [`${stored.length} added`, rep.skipped.length ? `${rep.skipped.length} already present` : '', rep.conflicts.length ? `${rep.conflicts.length} not overwritten (${rep.conflicts[0].id}: different content with the same id)` : '', rep.errors.length ? `${rep.errors.length} refused (${rep.errors[0]})` : '', failed.length ? `${failed.length} could not be stored (${failed[0]})` : ''].filter(Boolean);
  const bad = rep.errors.length || rep.conflicts.length || failed.length;
  app.toast(`${label}: ${parts.join(' · ')}`, bad && !stored.length ? 'error' : 'info');
  return stored.length > 0 || rep.skipped.length > 0;
}

async function exportText(app: App, name: string, text: string) { const ok = await app.store.exportFile(name, text); if (ok) app.toast(`Exported ${name}.`); }

// ------------------------------------------------------------- attempts on the board

export function trainingActive(app: App): TrainingSession | null {
  const t = app.training;
  if (!t) return null;
  const c = app.st.ctx;
  return c.kind === 'practice' && c.name === t.exercise.title && app.st.view === 'play' ? t : null;
}

export function startTraining(app: App, ex: Exercise, opts: { retryIndex?: number; from?: Attempt } = {}): void {
  const chk = E.checkTacticalExercise(ex);
  if (!chk.ok) { app.toast(`This exercise cannot be played: ${chk.errors[0]}`, 'error'); return; }
  const attempt = opts.from ?? E.newAttempt(ex, { kind: 'human' }, { retryIndex: opts.retryIndex ?? 0 });
  let state = E.cloneState(ex.start);
  if (opts.from) {
    const p = E.replayAttempt(ex, opts.from);
    if (!p.ok || !p.state) { app.toast(`The saved attempt cannot be resumed: ${p.error}`, 'error'); return; }
    state = p.state;
  }
  app.openBoard(state, { kind: 'practice', name: ex.title, start: E.cloneState(ex.start) }, { docName: null });
  app.training = { exercise: ex, attempt, t0: Date.now(), baseElapsed: attempt.elapsedMs, hintsShown: attempt.labels.hintsUsed };
  app.set({ modal: null });
  app.toast(opts.from ? `Resumed “${ex.title}” after ${opts.from.log.length} action(s).` : `Exercise “${ex.title}”: ${objectiveText(ex)}`);
}

export const objectiveText = (ex: Exercise): string => ex.objective.text ?? ({ score: 'score a Touchdown', 'keep-ball': 'keep the ball safely', 'recover-ball': 'get the ball into your hands', 'stop-carrier': 'stop the opposing ball carrier', 'no-turnover': 'finish without a Turnover' } as const)[ex.objective.kind];

function syncAttempt(app: App, t: TrainingSession): Attempt {
  t.attempt.log = JSON.parse(JSON.stringify(app.game.log)) as Attempt['log'];
  t.attempt.elapsedMs = t.baseElapsed + (Date.now() - t.t0);
  t.attempt.labels.hintsUsed = t.hintsShown;
  return t.attempt;
}

export function trainingCard(app: App): HTMLElement | null {
  const t = trainingActive(app);
  if (!t) return null;
  const ex = t.exercise;
  const a = syncAttempt(app, t);
  const prog = E.replayAttempt(ex, a);
  const over = prog.ok && prog.finished;
  const left = ex.constraints.maxActions !== undefined ? ` · ${a.log.length}/${ex.constraints.maxActions} actions` : ` · ${a.log.length} action${a.log.length === 1 ? '' : 's'}`;
  const hints = ex.hints ?? [];
  return h('div', { class: 'card practice training', id: 'training-card' },
    h('div', { class: 'row-between' }, h('span', { class: 'pill' }, 'Training'), h('span', { class: 'small muted' }, `try ${a.labels.retryIndex + 1}${left}`)),
    h('b', null, ex.title),
    h('div', { class: 'small', id: 'training-objective' }, `Objective: ${objectiveText(ex)}.`),
    ex.description ? h('div', { class: 'small muted' }, ex.description) : null,
    t.hintsShown > 0 ? h('div', { class: 'small', id: 'training-hints' }, hints.slice(0, t.hintsShown).map((x) => h('div', null, `Hint: ${x}`))) : null,
    over ? h('div', { class: 'small', id: 'training-over' }, `The attempt is over (${prog.why}). Finish to see the score.`) : null,
    h('div', { class: 'btnrow' },
      h('button', { class: `btn small ${over ? 'primary' : ''}`, id: 'training-finish', disabled: a.log.length === 0 || !!app.game.pending, onclick: () => void finishTraining(app) }, 'Finish & score'),
      h('button', { class: 'btn small', id: 'training-hint', disabled: t.hintsShown >= hints.length, title: hints.length ? 'Reveals one hint and marks this attempt as hinted' : 'This exercise has no hints', onclick: () => { t.hintsShown++; app.emit(); } }, `Hint (${t.hintsShown}/${hints.length})`),
      h('button', { class: 'btn small', id: 'training-retry', onclick: () => startTraining(app, ex, { retryIndex: a.labels.retryIndex + 1 }) }, 'Retry from start'),
      h('button', { class: 'btn small', id: 'training-save', onclick: () => void saveProgress(app) }, 'Save progress'),
      h('button', { class: 'btn small ghost', id: 'training-quit', onclick: () => { app.training = null; app.emit(); } }, 'Leave exercise'),
    ),
    h('div', { class: 'small muted' }, 'Retries and hints are recorded with the attempt so attempts stay comparable. The score is about the plan, not the dice you happened to roll.'),
  );
}

async function saveProgress(app: App): Promise<void> {
  const t = app.training; if (!t) return;
  syncAttempt(app, t);
  try { await storeAttempt(app, t.attempt); await refreshLibrary(app); app.toast('Attempt saved — resume it from Training.'); } catch (e) { app.toast(`Could not save: ${(e as Error).message}`, 'error'); }
}

export async function finishTraining(app: App): Promise<void> {
  const t = app.training; if (!t) return;
  if (app.game.pending) return app.toast('Finish the pending decision first.', 'error');
  const a = syncAttempt(app, t);
  a.status = 'finished';
  const report = E.gradeAttempt(t.exercise, a);
  a.result = report;
  lastReport = { report, exercise: t.exercise, attempt: JSON.parse(JSON.stringify(a)) as Attempt };
  try { await storeAttempt(app, a); await refreshLibrary(app); } catch (e) { app.toast(`The result could not be stored: ${(e as Error).message}`, 'error'); }
  app.set({ modal: { kind: 'trainingResult' } });
}


// ------------------------------------------------------------- built-in coach attempts (same Attempt contract as a human's)

const COACH_STYLES: AIStyle[] = ['balanced', 'offensive', 'defensive'];
let coachStyle: AIStyle = 'balanced';

/** One built-in coach plays the exercise (it sees only the game state — never the references or the rubric), then the attempt is stored and graded like any other. */
export async function coachAttempt(app: App, ex: Exercise, style: AIStyle = coachStyle): Promise<void> {
  const chk = E.checkTacticalExercise(ex);
  if (!chk.ok) { app.toast(`This exercise cannot be played: ${chk.errors[0]}`, 'error'); return; }
  app.toast(`Coach ${style} is playing “${ex.title}”…`);
  await new Promise((ok) => setTimeout(ok, 30)); // let the toast paint before the coach thinks
  const actor = { kind: 'coach' as const, coachId: `bloodboard-${style}` };
  const attempt = E.newAttempt(ex, actor, { startedAt: new Date().toISOString() });
  let s = E.cloneState(ex.start); const t0 = Date.now(); let stopped = '';
  for (let n = 0; n < 60; n++) {
    const st = E.attemptStatus(ex, s, s.log.length);
    if (st.finished) { stopped = st.why ?? ''; break; }
    let mv; try { mv = nextMove(s, ex.side, style, {}); } catch (e) { stopped = `the coach failed: ${(e as Error).message}`; break; }
    if (!mv) { stopped = 'the coach had no move'; break; }
    const out = mv.type === 'decision' ? E.decide(s, { requestId: mv.requestId, optionId: mv.optionId }) : E.execute(s, mv.input);
    if (out.status === 'illegal') { stopped = `the coach proposed an illegal move: ${(out as { error?: string }).error ?? 'illegal'}`; break; }
    s = out.state;
  }
  attempt.log = JSON.parse(JSON.stringify(s.log)) as Attempt['log'];
  attempt.elapsedMs = Date.now() - t0; attempt.status = 'finished';
  attempt.result = E.gradeAttempt(ex, attempt);
  lastReport = { report: attempt.result, exercise: ex, attempt: JSON.parse(JSON.stringify(attempt)) as Attempt };
  try { await storeAttempt(app, attempt); await refreshLibrary(app); } catch (e) { app.toast(`The result could not be stored: ${(e as Error).message}`, 'error'); }
  if (stopped && !/maxActions|objective|Turn/i.test(stopped)) app.toast(`Coach ${style}: ${stopped}.`);
  app.set({ modal: { kind: 'trainingResult' } });
}

// ------------------------------------------------------------- authoring

export function openAuthor(app: App): void {
  const g = app.game;
  const why = g.phase !== 'play' ? 'The position must be in play (not set-up or kick-off).' : g.pending ? 'Finish the pending decision first.' : null;
  if (why) { app.toast(`Cannot make an exercise here: ${why}`, 'error'); return; }
  draft = { ...draft, id: draft.id || `ex-${Date.now().toString(36)}`, title: draft.title || app.st.docName || 'New exercise' };
  app.set({ modal: { kind: 'trainingAuthor' } });
}

function authorModal(app: App) {
  const mk = <K extends keyof typeof draft>(k: K, el: HTMLInputElement | HTMLSelectElement) => { el.addEventListener('input', () => { (draft as Record<string, string>)[k] = el.value; }); return el; };
  const inId = mk('id', h('input', { id: 'author-id', value: draft.id, 'aria-label': 'Exercise id' }));
  const inTitle = mk('title', h('input', { id: 'author-title', value: draft.title, 'aria-label': 'Title' }));
  const inDesc = mk('description', h('input', { id: 'author-desc', value: draft.description, 'aria-label': 'Description' }));
  const inMax = mk('maxActions', h('input', { id: 'author-max', type: 'number', min: '1', value: draft.maxActions, placeholder: 'no limit', class: 'num wide', 'aria-label': 'Maximum actions' }));
  const objs: Array<[Exercise['objective']['kind'], string]> = [['score', 'Score a Touchdown'], ['keep-ball', 'Keep the ball safely'], ['recover-ball', 'Recover the loose ball'], ['stop-carrier', 'Stop the opposing carrier'], ['no-turnover', 'Finish without a Turnover']];
  const sel = mk('objective', h('select', { id: 'author-objective', 'aria-label': 'Objective' }, objs.map(([v, t]) => h('option', { value: v, selected: v === draft.objective }, t))));
  const err = h('div', { class: 'small', id: 'author-error', style: 'color:#b3261e' });
  return shell(app, 'Make an exercise from this position', [
    h('p', { class: 'small muted' }, `The exercise starts from the board exactly as it is now, with ${app.game.teams[app.game.turn.active].name} to act. The action history is not kept; dice come from the position's stored seed.`),
    h('div', { class: 'formgrid' },
      h('label', null, 'Id ', inId), h('label', null, 'Title ', inTitle), h('label', null, 'Description ', inDesc), h('label', null, 'Objective ', sel), h('label', null, 'Max actions ', inMax)),
    err,
    h('div', { class: 'btnrow' },
      h('button', { class: 'btn primary', id: 'author-save', onclick: () => void saveAuthored(app, err) }, 'Save exercise'),
      h('button', { class: 'btn', onclick: () => app.set({ modal: null }) }, 'Cancel')),
    h('p', { class: 'small muted' }, 'The rubric starts from the objective\'s default components (objective, Turnover risk, ball security…); edit the exported file to change weights. Reference solutions can be added in the file and stay hidden from coaches.'),
  ]);
}

async function saveAuthored(app: App, err: HTMLElement): Promise<void> {
  const g = E.cloneState(app.game);
  const max = draft.maxActions.trim() ? Number(draft.maxActions) : undefined;
  const r = E.authorExercise(g, { id: draft.id.trim(), title: draft.title, objective: { kind: draft.objective }, constraints: max !== undefined ? { maxActions: max } : {}, ...(draft.description.trim() ? { description: draft.description.trim() } : {}), source: { kind: 'current-position', note: 'Saved from the board' } });
  if (!r.ok) { err.textContent = r.errors.join(' '); return; }
  if (!cache.loaded) await refreshLibrary(app);
  const prior = cache.exercises.find((x) => x.id === r.exercise.id);
  if (prior) { err.textContent = `An exercise with the id “${r.exercise.id}” already exists. Choose another id; nothing was overwritten.`; return; }
  try { await storeExercise(app, r.exercise); } catch (e) { err.textContent = `Could not store: ${(e as Error).message}`; return; }
  draft = { ...draft, id: '', title: '' };
  await refreshLibrary(app);
  app.set({ modal: { kind: 'training' } });
  app.toast(`Exercise “${r.exercise.title}” saved.`);
}

// ------------------------------------------------------------- modals

const pctText = (v: number | null) => (v === null ? 'n/a' : `${Math.round(v * 100)}%`);

export function trainingModal(app: App) {
  const ex = cache.exercises;
  const attemptsOf = (id: string) => cache.attempts.filter((a) => a.exerciseId === id);
  return shell(app, 'Training exercises', [
    h('p', { class: 'small muted' }, 'Practise tactical positions on the real board. Local training needs no sign-in. Scores grade your plan over many alternate dice, separately from what the dice did.'),
    h('div', { class: 'btnrow' },
      h('button', { class: 'btn small', id: 'training-import', onclick: async () => { const t = await app.store.importFile(); if (t) await importTrainingText(app, t, 'Import'); } }, 'Import…'),
      h('button', { class: 'btn small', id: 'training-export-pack', disabled: ex.length === 0, onclick: () => void exportText(app, 'exercise-pack.json', E.serializeTraining(E.makePack(`pack-${Date.now().toString(36)}`, 'My exercises', ex))) }, 'Export all as a pack'),
      h('button', { class: 'btn small', id: 'training-new', onclick: () => { app.set({ modal: null }); openAuthor(app); } }, 'New from current position…')),
    h('label', { class: 'small' }, 'Coach for “Coach tries”: ', h('select', { id: 'training-coach-style', onchange: (ev: Event) => { coachStyle = (ev.target as HTMLSelectElement).value as AIStyle; } }, COACH_STYLES.map((x) => h('option', { value: x, selected: x === coachStyle }, x[0].toUpperCase() + x.slice(1))))),
    h('p', { class: 'small muted' }, 'Tip: drop exercise, pack or attempt files onto the window to import them.'),
    cache.loaded ? null : h('p', { class: 'small muted' }, 'Loading…'),
    cache.error ? h('p', { class: 'small', style: 'color:#b3261e' }, cache.error) : null,
    ex.length === 0 && cache.loaded ? h('p', { id: 'training-empty' }, 'No exercises yet. Import a pack or make one from a position on the board (File ▸ Make exercise…).') : null,
    h('div', { class: 'library', id: 'training-list' }, ex.map((e) => {
      const at = attemptsOf(e.id); const open = at.filter((a) => a.status === 'in-progress'); const done = at.filter((a) => a.status === 'finished' && a.result);
      const best = done.reduce<number | null>((m, a) => (a.result?.quality.total != null && (m === null || a.result.quality.total > m) ? a.result.quality.total : m), null);
      return h('div', { class: 'libitem', 'data-exercise': e.id },
        h('div', null, h('b', null, e.title), h('div', { class: 'small muted' }, `${objectiveText(e)} · ${e.rulesEdition} · ${at.length} attempt${at.length === 1 ? '' : 's'}${best !== null ? ` · best plan quality ${pctText(best)}` : ''}`), e.description ? h('div', { class: 'small muted' }, e.description) : null),
        h('div', { class: 'btnrow' },
          h('button', { class: 'btn small primary', 'data-act': 'start', onclick: () => startTraining(app, e) }, 'Start'),
          open.length ? h('button', { class: 'btn small', 'data-act': 'resume', onclick: () => startTraining(app, e, { from: open[open.length - 1] }) }, 'Resume') : null,
          h('button', { class: 'btn small', 'data-act': 'coach', title: 'A built-in coach plays this exercise (it never sees the reference lines); you get the same scored report', onclick: () => void coachAttempt(app, e) }, 'Coach tries'),
          h('button', { class: 'btn small ghost', 'data-act': 'export', onclick: () => void exportText(app, `${safeName(e.id)}.exercise.json`, E.serializeTraining(e)) }, 'Export'),
          done.length ? h('button', { class: 'btn small ghost', 'data-act': 'export-attempt', onclick: () => void exportText(app, `${safeName(done[done.length - 1].id)}.attempt.json`, E.serializeTraining(done[done.length - 1])) }, 'Export last attempt') : null,
          h('button', { class: 'btn small ghost', 'data-act': 'review', disabled: !done.length, onclick: () => { const a = done[done.length - 1]; lastReport = { report: a.result as ScoreReport, exercise: e, attempt: a }; app.set({ modal: { kind: 'trainingResult' } }); } }, 'Last result')));
    })),
  ], true);
}

export function resultModal(app: App) {
  if (!lastReport) return shell(app, 'Result', [h('p', null, 'No result to show.')]);
  const { report: r, exercise: ex, attempt: a } = lastReport;
  const q = r.quality;
  const rows = q.components.map((c) => h('tr', null,
    h('td', null, c.id), h('td', null, String(c.weight)),
    h('td', null, c.available ? pctText(c.mean) : '—'),
    h('td', null, c.available && c.ci95 ? `${pctText(c.ci95[0])}–${pctText(c.ci95[1])}` : (c.note ?? '')),
  ));
  return shell(app, `Result: ${ex.title}`, [
    h('div', { id: 'result-legal' }, r.legal.ok ? h('p', { class: 'small' }, 'Legality: every action re-executes with the rules engine.') : h('p', { style: 'color:#b3261e' }, `Not legal under the current rules: ${r.legal.reason}`)),
    h('h4', null, 'What the dice did this time'),
    h('p', { id: 'result-realized' }, `${r.realized.objectiveAchieved === null ? 'Objective: unknown.' : r.realized.objectiveAchieved ? 'Objective reached.' : 'Objective not reached.'} ${r.realized.turnover ? 'A Turnover happened. ' : ''}Final: ${r.realized.finalSummary}. ${r.realized.actions} action${r.realized.actions === 1 ? '' : 's'}${r.realized.finishedBecause ? ` (${r.realized.finishedBecause})` : ''}.`),
    h('h4', null, 'Quality of your plan (independent of this roll)'),
    q.graded
      ? h('p', { id: 'result-quality' }, `${pctText(q.total)} (95% interval ${pctText(q.ci95?.[0] ?? null)}–${pctText(q.ci95?.[1] ?? null)}) from ${q.samples} alternate-dice replays of ${a.actor.kind === 'coach' ? "the coach's" : 'your'} action sequence${q.plannedThroughSamples < q.samples ? `; the sequence could play through in ${q.plannedThroughSamples} of them` : ''}.`)
      : h('p', { id: 'result-quality' }, `Not graded: ${q.reason ?? 'unavailable'}.`),
    rows.length ? h('table', { class: 'small', id: 'result-components' }, h('thead', null, h('tr', null, ['Component', 'Weight', 'Rate', '95% interval / note'].map((x) => h('th', null, x)))), h('tbody', null, rows)) : null,
    r.steps?.length ? h('div', { id: 'result-steps' }, h('h4', null, 'Where your plan is risky'), h('p', { class: 'small muted' }, 'Measured on the same alternate dice as the quality number — it shows where in your sequence a Turnover happens, not what you should have done.'), h('ol', { class: 'small' }, r.steps.map((x) => h('li', { class: `step-${x.flag}`, 'data-flag': x.flag }, h('b', null, `${x.title}: `), x.flag === 'risk' ? h('b', { style: 'color:#b3261e' }, 'risky — ') : null, x.note)))) : null,
    r.divergence ? h('details', { id: 'result-divergence' }, h('summary', null, 'Where a higher-scoring line differs from yours'), h('p', { class: 'small' }, `At action ${r.divergence.step} you chose: ${r.divergence.yours}. Line “${r.divergence.reference}” chose: ${r.divergence.theirs}. (${pctText(r.divergence.yourTotal)} vs ${pctText(r.divergence.referenceTotal)} plan quality.)`), h('p', { class: 'small muted' }, r.divergence.note)) : null,
    r.referenceComparison?.length ? h('div', { id: 'result-references' }, h('h4', null, 'Other legal lines (same method)'), r.referenceComparison.map((x) => h('div', { class: 'small' }, `${x.label}: ${pctText(x.total)} with ${x.actions} action${x.actions === 1 ? '' : 's'}`))) : null,
    (() => {
      const prior = cache.attempts.filter((x) => x.exerciseId === ex.id && x.status === 'finished' && x.result).sort((x, y) => x.startedAt.localeCompare(y.startedAt));
      if (prior.length < 2) return null;
      return h('div', { id: 'result-history' }, h('h4', null, 'Your attempts at this exercise'), h('table', { class: 'small' }, h('thead', null, h('tr', null, ['Try', 'Actor', 'Plan quality', 'Dice result', 'Hints', 'Advice', 'Undos', 'Time'].map((c) => h('th', null, c)))),
        h('tbody', null, prior.map((x) => h('tr', { class: x.id === a.id ? 'on' : '' }, h('td', null, String(x.labels.retryIndex + 1)), h('td', null, x.actor.kind === 'coach' ? `coach ${x.actor.coachId ?? ''}` : 'you'), h('td', null, x.result?.quality.graded ? pctText(x.result.quality.total) : 'ungraded'), h('td', null, x.result?.realized.objectiveAchieved ? 'objective reached' : 'not reached'), h('td', null, String(x.labels.hintsUsed)), h('td', null, x.labels.adviceUsed ? 'yes' : 'no'), h('td', null, String(x.labels.undos ?? 0)), h('td', null, `${Math.round(x.elapsedMs / 1000)} s`))))));
    })(),
    h('p', { class: 'small muted', id: 'result-labels' }, `Actor: ${a.actor.kind}${a.actor.coachId ? ` (${a.actor.coachId})` : ''} · try ${a.labels.retryIndex + 1} · hints ${a.labels.hintsUsed} · advice ${a.labels.adviceUsed ? 'used' : 'none'} · time ${Math.round(a.elapsedMs / 1000)} s · grader ${r.grader.id} ${r.grader.version}`),
    h('ul', { class: 'small muted', id: 'result-limits' }, r.limits.map((x) => h('li', null, x))),
    h('div', { class: 'btnrow' },
      h('button', { class: 'btn primary', id: 'result-retry', onclick: () => startTraining(app, ex, { retryIndex: a.labels.retryIndex + 1 }) }, 'Retry'),
      h('button', { class: 'btn', id: 'result-replay', title: 'Replay your recorded actions with the same dice', onclick: () => { startTraining(app, ex, { from: { ...a, status: 'in-progress' } }); app.practiceReplay(); } }, 'Replay attempt'),
      h('button', { class: 'btn', id: 'result-export', onclick: () => void exportText(app, `${safeName(a.id)}.attempt.json`, E.serializeTraining(a)) }, 'Export attempt'),
      h('button', { class: 'btn', onclick: () => app.set({ modal: { kind: 'training' } }) }, 'Library')),
  ], true);
}

export { authorModal };
export const testHooks = { library: () => cache, lastReport: () => lastReport };
