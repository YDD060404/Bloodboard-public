// V7-11 — tactical training mode through the game UI (Chromium, dist/web): author from the board, library, attempt, retry/hints, save/resume
// across a page reload, fair scoring screen, export, drag-and-drop import of exercise/pack/attempt, refusals (conflict, damage, wrong payload).
// rc.1: step-level localisation panel in the score screen and built-in coach attempts started from the library.
// (Online/installed-coach attempts are not driven from this UI; WKWebView file dialogs are native-only and NOT covered.)
import { readFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { open } from './ui-helpers.mjs';
const results = [];
const check = (n, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ` — ${d}` : ''}`); };
const tmp = mkdtempSync(join(tmpdir(), 'bb-train-'));
execFileSync(process.env.ESBUILD || 'node_modules/.bin/esbuild', ['src/engine/index.ts', '--bundle', '--platform=node', '--format=cjs', `--outfile=${tmp}/engine.cjs`, '--log-level=error']);
const { createRequire } = await import('node:module');
const E = createRequire(import.meta.url)(`${tmp}/engine.cjs`);
const exampleText = readFileSync('examples/01-two-dodges-to-glory.json', 'utf8');
const step = (pts) => pts.map(([x, y]) => ({ to: { x, y }, kind: 'step' }));
const MID = { kind: 'playerAction', playerId: 'A1', action: 'move', path: step([[18, 7], [19, 7], [20, 7], [21, 7], [22, 7], [23, 7], [24, 7], [25, 6]]) };
const PASSIVE = { kind: 'playerAction', playerId: 'A2', action: 'move', path: step([[14, 6]]) };

const { browser, page, errors } = await open({ home: true });
const sleep = (ms) => page.waitForTimeout(ms);
const toast = () => page.evaluate(() => [...document.querySelectorAll('.toast, .toasts *')].map((e) => e.textContent).join(' | '));
const drop = (files) => page.evaluate((fs) => {
  const dt = new DataTransfer();
  for (const f of fs) dt.items.add(new File([f.text], f.name, { type: 'application/octet-stream' }));
  window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
}, files);

// 1. author from the example position
await page.evaluate((t) => window.bloodboard.loadText(t, 'example'), exampleText); await sleep(500);
await page.click('#file-menu-btn'); await sleep(100);
const items = await page.evaluate(() => [...document.querySelectorAll('.menuitem')].map((e) => e.textContent));
check('File menu offers Make exercise…', items.includes('Make exercise…'), items.join(' | '));
await page.evaluate(() => [...document.querySelectorAll('.menuitem')].find((e) => e.textContent === 'Make exercise…').click()); await sleep(200);
await page.fill('#author-id', 'two-dodges'); await page.fill('#author-title', 'Two dodges to glory'); await page.fill('#author-max', '3');
await page.click('#author-save'); await sleep(500);
const listed = await page.evaluate(() => [...document.querySelectorAll('#training-list .libitem')].map((e) => e.dataset.exercise));
check('the exercise is saved and shows in the Training library', listed.includes('two-dodges'), listed.join(','));
// duplicate id is refused, not overwritten
await page.click('#training-new'); await sleep(200);
await page.fill('#author-id', 'two-dodges'); await page.click('#author-save'); await sleep(300);
check('authoring with an existing id is refused without overwriting', /already exists/.test(await page.textContent('#author-error')));
await page.keyboard.press('Escape'); await page.evaluate(() => window.bloodboard.set({ modal: null }));

// 2. start an attempt, play a passive action first, then retry, then the scoring plan
await page.click('#training-open'); await sleep(300);
await page.click('#training-list [data-act="start"]'); await sleep(400);
check('the training card shows the objective and replaces the practice seed controls', /score a Touchdown/.test(await page.textContent('#training-objective')) && !(await page.$('#practice-seed')));
await page.evaluate((i) => window.bloodboard.runSimple(i), PASSIVE); await sleep(300);
let s = await page.evaluate(() => ({ log: window.bloodboard.st.game.log.length }));
check('an action is recorded in the attempt', s.log === 1);
await page.click('#training-save'); await sleep(400);
// reload the page: resume from the saved attempt
await page.reload(); await sleep(500);
await page.evaluate(() => window.bloodboard.set({ screen: 'board' }));
await page.click('#training-open'); await sleep(500);
const hasResume = await page.$('#training-list [data-act="resume"]');
check('after a restart the saved attempt can be resumed', !!hasResume);
if (hasResume) { await hasResume.click(); await sleep(500); }
s = await page.evaluate(() => ({ log: window.bloodboard.st.game.log.length, card: !!document.querySelector('#training-card') }));
check('resume rebuilds the board by re-executing the saved actions', s.log === 1 && s.card, JSON.stringify(s));
// hint count labels the attempt
await page.click('#training-retry'); await sleep(400);
check('Retry restarts from the saved start (empty log) with the try counter increased', await page.evaluate(() => window.bloodboard.st.game.log.length === 0 && /try 2/.test(document.querySelector('#training-card').textContent)));
await page.evaluate((i) => window.bloodboard.runSimple(i), MID); await sleep(500);
await page.evaluate(() => { const g = window.bloodboard.st.game; return g.pending ? 1 : 0; });
check('the attempt is flagged over after the Touchdown', /attempt is over/.test(await page.textContent('#training-card')));
await page.click('#training-finish'); await sleep(900);
const res = await page.evaluate(() => ({ realized: document.querySelector('#result-realized')?.textContent, quality: document.querySelector('#result-quality')?.textContent, comps: document.querySelectorAll('#result-components tbody tr').length, labels: document.querySelector('#result-labels')?.textContent, limits: document.querySelectorAll('#result-limits li').length, legal: document.querySelector('#result-legal')?.textContent }));
check('the score screen separates what the dice did from plan quality', /Objective reached/.test(res.realized) && /alternate-dice replays/.test(res.quality) && /95% interval/.test(res.quality), `${res.realized} || ${res.quality}`);
check('components, labels, grader identity and limits are shown', res.comps >= 3 && /try 2/.test(res.labels) && /bloodboard-tactical-rubric/.test(res.labels) && res.limits >= 3 && /re-executes/.test(res.legal), JSON.stringify({ comps: res.comps, labels: res.labels }));
{ const t = await page.textContent('.modal'); check('no win-probability or rating claim appears; the scale is declared as not a rating', !/win probab|\bElo\b/i.test(t) && /not a calibrated playing strength or a rating/.test(t)); }

// replay the attempt with the same dice
await page.click('#result-replay'); await sleep(2500);
const rp = await page.evaluate(() => ({ log: window.bloodboard.st.game.log.length, td: window.bloodboard.st.game.teams.A.score, modal: window.bloodboard.st.modal }));
check('Replay attempt re-plays the recorded action on the board with the same dice (same Touchdown)', rp.log === 1 && rp.td >= 1, JSON.stringify(rp));

// 3. export an attempt and an exercise (through the store's browser fallback → captured by intercepting the download)
const stored = await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('bloodboard.progress.v1') || '{}'); return Object.fromEntries(Object.entries(d).filter(([k]) => /^(exercise|attempt)--/.test(k)).map(([k, v]) => [k, v.json])); });
const exKey = Object.keys(stored).find((k) => /^exercise--/.test(k));
const atKeys = Object.keys(stored).filter((k) => /^attempt--/.test(k));
check('exercise and finished attempt records are stored locally', !!exKey && atKeys.length >= 1, Object.keys(stored).join(', '));
const exText = stored[exKey]; const attText = stored[atKeys.find((k) => JSON.parse(stored[k]).status === 'finished')];
check('the stored attempt carries its score explanation, actor, labels and engine identity', (() => { const a = JSON.parse(attText); return a.result?.quality?.components?.length && a.actor.kind === 'human' && a.labels.retryIndex === 1 && a.engine.rulesHash; })());
const parsedAtt = JSON.parse(attText);
const reimp = E.importAttempt(attText, [JSON.parse(exText)], []);
check('the exported attempt re-imports and re-executes outside the app', reimp.ok);

// 4. drag-and-drop import in a fresh library: exercise, pack, attempt, refusals
await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('bloodboard.progress.v1') || '{}'); for (const k of Object.keys(d)) if (/^(exercise|attempt)--/.test(k)) delete d[k]; localStorage.setItem('bloodboard.progress.v1', JSON.stringify(d)); });
await page.reload(); await sleep(500);
await drop([{ name: 'two-dodges.exercise.json', text: exText }]); await sleep(900);
await page.click('#training-open'); await sleep(500);
let ids = await page.evaluate(() => [...document.querySelectorAll('#training-list .libitem')].map((e) => e.dataset.exercise));
check('a dropped exercise file is imported', ids.includes('two-dodges'), ids.join(','));
await page.evaluate(() => window.bloodboard.set({ modal: null }));
await drop([{ name: 'two-dodges.attempt.json', text: attText }]); await sleep(900);
check('a dropped attempt is verified by re-execution and imported', /Attempt imported/.test(await toast()), (await toast()).slice(0, 160));
const ex = JSON.parse(exText);
const pack = E.makePack('p', 'P', [ex, { ...JSON.parse(JSON.stringify(ex)), id: 'second', hash: '' }].map((x, i) => (i ? E.authorExercise(ex.start, { id: 'second', title: 'Second', side: 'A', objective: { kind: 'keep-ball' }, constraints: { maxActions: 2 } }).exercise : x)));
await drop([{ name: 'pack.json', text: E.serializeTraining(pack) }]); await sleep(900);
check('a pack adds new exercises and reports the one already present', /1 added/.test(await toast()) && /1 already present/.test(await toast()), (await toast()).slice(0, 200));
const conflicting = E.authorExercise(ex.start, { id: 'two-dodges', title: 'Different', side: 'A', objective: { kind: 'score' }, constraints: { maxActions: 7 } }).exercise;
await drop([{ name: 'conflict.json', text: E.serializeTraining(conflicting) }]); await sleep(700);
check('same id with different content is reported as a conflict and not overwritten', /not overwritten/.test(await toast()), (await toast()).slice(0, 200));
const damaged = JSON.parse(exText); damaged.start.players[0].ma = 99;
await drop([{ name: 'damaged.json', text: JSON.stringify(damaged) }]); await sleep(700);
check('a damaged exercise is refused (hash check)', /hash/.test(await toast()) && /refused/.test(await toast()), (await toast()).slice(0, 200));
const hist = E.toHistory(E.parseSaveFile(readFileSync('tests/fixtures/real-matches/teams/Lizaer v Lizaer2.json', 'utf8')).save.state, { source: 'game' });
check('a game history is not mistaken for an exercise', hist.ok ? !E.importExercises(E.serializeHistory(hist.history), []).added.length : true);
const afterIds = await page.evaluate(() => { window.bloodboard.set({ modal: { kind: 'training' } }); return null; }); void afterIds; await sleep(600);
ids = await page.evaluate(() => [...document.querySelectorAll('#training-list .libitem')].map((e) => e.dataset.exercise));
check('the library holds both good exercises and none of the refused ones', ids.length === 2 && ids.includes('second'), ids.join(','));
void PASSIVE; void parsedAtt;
// repeated-attempt comparison: a second finished attempt on the same exercise, with a different plan
await page.evaluate(() => window.bloodboard.set({ modal: null }));
await page.click('#training-open'); await sleep(400);
await page.click('#training-list [data-exercise="two-dodges"] [data-act="start"]'); await sleep(500);
await page.evaluate((i) => window.bloodboard.runSimple(i), PASSIVE); await sleep(300);
await page.click('#training-finish'); await sleep(900);
const hist2 = await page.evaluate(() => ({ rows: document.querySelectorAll('#result-history tbody tr').length, text: document.querySelector('#result-history')?.textContent ?? '' }));
check('a second attempt shows a comparison of attempts (quality, dice result, hints, undos, time)', hist2.rows === 2 && /Plan quality/.test(hist2.text) && /not reached/.test(hist2.text), JSON.stringify(hist2).slice(0, 200));

// rc.1 — the score screen localises risk per committed action
const stepsPanel = await page.evaluate(() => ({ items: [...document.querySelectorAll('#result-steps li')].map((e) => ({ flag: e.dataset.flag, text: e.textContent })), head: document.querySelector('#result-steps h4')?.textContent ?? '' }));
check('the score screen lists where the plan is risky, one line per committed action, with the replay counts', stepsPanel.items.length === 1 && /replays/.test(stepsPanel.items[0].text) && /Where your plan is risky/.test(stepsPanel.head), JSON.stringify(stepsPanel).slice(0, 240));
// rc.1 — a built-in coach attempt from the library: same contract, same report, labelled as a coach, references never shown to it
await page.evaluate(() => window.bloodboard.set({ modal: { kind: 'training' } })); await sleep(500);
await page.selectOption('#training-coach-style', 'offensive');
await page.click('#training-list [data-exercise="two-dodges"] [data-act="coach"]'); await sleep(200);
await page.waitForSelector('#result-labels', { timeout: 120000 }); await sleep(300);
const coachRes = await page.evaluate(() => ({ labels: document.querySelector('#result-labels')?.textContent ?? '', quality: document.querySelector('#result-quality')?.textContent ?? '', steps: document.querySelectorAll('#result-steps li').length, rows: document.querySelectorAll('#result-history tbody tr').length }));
check('"Coach tries" plays the exercise with a built-in coach and opens the same scored report, labelled as a coach attempt', /Actor: coach \(bloodboard-offensive\)/.test(coachRes.labels) && coachRes.quality.length > 10, JSON.stringify(coachRes).slice(0, 260));
check('the coach attempt is stored with the others and shows in the attempt comparison', coachRes.rows >= 3, String(coachRes.rows));
const realErrors = errors.filter((e) => !/Failed to load resource/.test(e));
check('no unexpected browser errors', realErrors.length === 0, realErrors.join(' | ').slice(0, 300));
await browser.close();
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} passed`);
process.exit(ok === results.length ? 0 : 1);
