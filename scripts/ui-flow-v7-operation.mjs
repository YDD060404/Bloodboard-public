// V7-03 operation-flow fixes in the real UI: (1) Undo needs no dialog where it is harmless (practice) but still asks in a match and for the Backspace key;
// (2) a failed-action message does not linger once the coach moves on. Reproduced on the current UI before the change (see docs notes).
import { open, gameJSON } from './ui-helpers.mjs';
const results = [];
const check = (n, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ` — ${d}` : ''}`); };
const { browser, page, errors } = await open({});
const sleep = (ms) => page.waitForTimeout(ms);
const st = (fn, a) => page.evaluate(fn, a);
// practice board: one confirmed action (end the Turn), then the Undo button
const before = await gameJSON(page);
await st(() => window.bloodboard.runSimple({ kind: 'endTurn' })); await sleep(300);
await st(() => { window.bloodboard.skipPlayback?.(); }); await sleep(100);
check('a confirmed action in practice can be undone', await st(() => window.bloodboard.canUndo()));
await page.click('#undo-btn'); await sleep(300);
check('Undo in practice acts at once: no dialog, state restored exactly, a toast says what was undone', (await st(() => window.bloodboard.st.modal)) === null && (await gameJSON(page)) === before && /Undone/.test(await st(() => window.bloodboard.st.toast?.text ?? '')));
// Backspace (easy to hit by accident) still asks
await st(() => window.bloodboard.runSimple({ kind: 'endTurn' })); await sleep(300); await st(() => window.bloodboard.skipPlayback?.());
await page.keyboard.press('Backspace'); await sleep(200);
check('Backspace with nothing planned still asks before undoing a whole action', (await st(() => window.bloodboard.st.modal?.kind)) === 'undo');
await st(() => window.bloodboard.set({ modal: null }));
// failed action prompt does not linger
await st(() => window.bloodboard.toast('That action is not allowed.', 'error')); await sleep(100);
check('an error message is showing', await st(() => window.bloodboard.st.toast?.kind === 'error'));
const pid = await st(() => window.bloodboard.game.players.find((p) => p.team === window.bloodboard.game.turn.active)?.id);
await st((id) => window.bloodboard.select(id), pid); await sleep(100);
check('selecting another player clears the stale error', await st(() => window.bloodboard.st.toast === null));
await st(() => window.bloodboard.toast('Saved.', 'info')); await st((id) => window.bloodboard.select(id), pid);
check('an ordinary info message is not cleared by selecting', await st(() => window.bloodboard.st.toast?.text === 'Saved.'));
// a real match asks: hot-seat match from the set-up
await page.evaluate(() => window.bloodboard.set({ screen: 'home' })); await sleep(200);
await page.click('#exhibition-setup'); await sleep(250);
await page.click('#p1-controller-human'); await page.click('#p2-controller-human'); await page.click('#p1-source-ready'); await page.click('#p2-source-ready'); await sleep(100);
await page.click('#start-match'); await sleep(500);
await st(() => { window.bloodboard.st.pauseDice = false; });
await st(() => window.bloodboard.runSimple({ kind: 'pregame' })); await sleep(300);
for (let i = 0; i < 10 && (await st(() => window.bloodboard.playbackActive())); i++) { await st(() => window.bloodboard.skipPlayback()); await sleep(100); }
const canU = await st(() => window.bloodboard.canUndo());
if (canU) { await st(() => window.bloodboard.requestUndo()); await sleep(250); check('in a real match Undo still asks first', (await st(() => window.bloodboard.st.modal?.kind)) === 'undo' && (await st(() => window.bloodboard.st.ctx.kind)) === 'match'); }
else check('in a real match Undo still asks first', false, 'no undoable action reached');
const real = errors.filter((e) => !/Failed to load resource/.test(e));
check('no unexpected browser errors', real.length === 0, real.slice(0, 3).join(' | ').slice(0, 300));
await browser.close();
const ok = results.filter(Boolean).length; console.log(`\n${ok}/${results.length} passed`); process.exit(ok === results.length ? 0 : 1);
