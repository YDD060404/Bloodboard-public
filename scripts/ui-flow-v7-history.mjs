// V7-06 — canonical history through the game UI (Chromium against dist/web), using the REAL saved matches.
//   REAL_MATCHES=tests/fixtures/real-matches/teams ESBUILD=… node scripts/ui-flow-v7-history.mjs
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { open } from './ui-helpers.mjs';
const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ` — ${d}` : ''}`); };
const dir = process.env.REAL_MATCHES || 'tests/fixtures/real-matches/teams';
const saveText = readFileSync(`${dir}/Lizaer v Lizaer2.json`, 'utf8');
// build the engine for node and write the history exactly as the game would
const tmp = mkdtempSync(join(tmpdir(), 'bb-hist-'));
execFileSync(process.env.ESBUILD || 'node_modules/.bin/esbuild', ['src/engine/index.ts', '--bundle', '--platform=node', '--format=cjs', `--outfile=${tmp}/engine.cjs`, '--log-level=error']);
const E = (await import(`${tmp}/engine.cjs`)).default ?? (await import(`${tmp}/engine.cjs`));
const p = E.parseSaveFile(saveText); const save = p.save;
const h = E.toHistory(save.state, { source: 'game', initial: save.meta?.initial }).history;
const histText = E.serializeHistory(h);
const tampered = JSON.parse(histText); tampered.result.score.A += 1;
const batch = E.serializeHistory(E.toBatch([h, tampered], 'ui batch'));
const finalScore = [save.state.teams.A.score, save.state.teams.B.score];

const { browser, page, errors } = await open({ home: true });
const ev = (fn, a) => page.evaluate(fn, a); const sleep = (ms) => page.waitForTimeout(ms);
const st = () => ev(() => { const g = window.bloodboard.st.game; return { log: g.log.length, score: [g.teams.A.score, g.teams.B.score], replay: !!window.bloodboard.st.replay, screen: window.bloodboard.st.screen }; });
const toast = () => ev(() => [...document.querySelectorAll('.toast, .toasts *')].map((e) => e.textContent).join(' | '));

// 1. a verified history opens directly in Replay
await ev((t) => window.bloodboard.loadText(t, null), histText); await sleep(700);
let s = await st();
check('a canonical history opens in Replay mode on the board', s.screen === 'board' && s.replay, JSON.stringify(s));
check('replay starts at the beginning (step 0)', s.log === 0);
await page.click('#replay-end'); s = await st();
check('the last step reproduces the history\'s final score', s.score[0] === finalScore[0] && s.score[1] === finalScore[1], JSON.stringify(s.score));
check('the user is told it was verified', /verified/i.test(await toast()), (await toast()).slice(0, 120));

// 1a. V7-09: the replay panel shows measured match data for the current step, never a probability
await page.click('#replay-start'); await sleep(200);
const anaText = () => page.locator('#replay-analytics').innerText();
check('the replay shows "Match data" for step 0 (after 0 actions)', /Match data · after 0 actions/.test(await anaText()));
await page.click('#replay-end'); await sleep(250);
const anaEnd = await anaText();
check('at the end it counts every recorded action and the final touchdowns', new RegExp(`after ${E.parseHistory(histText).history.log.length} actions`).test(anaEnd) && /Touchdowns/.test(anaEnd));
check('no win probability appears; the absence is labelled', !/\d+\s*%/.test(anaEnd) && /No win probability is shown/.test(anaEnd));

// 1b. V7-08: replay animation — a forward step animates what the engine did; seeks stay instant; the final state is unaffected
await page.click('#replay-start'); await page.selectOption('#replay-turn', { index: 2 }); await sleep(800);
const baseline = 0;
let animated = 0, stepsTried = 0, maxAnims = 0;
const sample = () => ev(async () => { document.querySelector('#replay-fwd').click(); let mx = 0; for (let k = 0; k < 40; k++) { await new Promise((r) => requestAnimationFrame(r)); mx = Math.max(mx, document.getAnimations().filter((a) => { const t = a.effect && a.effect.target; return t && t.closest && t.closest('g.player, g.ball, .thud, .ghost'); }).length); } return mx; });
for (let i = 0; i < 70 && animated < 2; i++) { const n = await sample(); if (process.env.DBG) console.log(i, n, JSON.stringify(await ev(() => ({ idx: window.bloodboard.st.replay.index, pb: !!window.bloodboard.st.playback, an: window.bloodboard.st.animate })))); stepsTried++; if (n > 0) { animated++; maxAnims = Math.max(maxAnims, n); } }
check('stepping forward through recorded actions animates the engine\'s movement (player/ball animations present)', animated >= 1, `${animated} animated of ${stepsTried} steps, up to ${maxAnims} animations`);
const pos1 = await st();
await sleep(2500);
await page.click('#replay-back'); await sleep(80);
check('stepping backward is instant (no new animation)', (await ev(() => document.getAnimations().filter((a) => { const t = a.effect && a.effect.target; return t && t.closest && t.closest('g.player, g.ball, .thud, .ghost'); }).length)) <= baseline);
await page.click('#replay-end'); await sleep(80);
const endAnims = await ev(() => document.getAnimations().filter((a) => { const t = a.effect && a.effect.target; return t && t.closest && t.closest('g.player, g.ball, .thud, .ghost'); }).length);
const endState = await st();
check('jumping to the end is instant and lands on the recorded final score', endAnims <= baseline && endState.score[0] === finalScore[0] && endState.score[1] === finalScore[1], JSON.stringify(endState));
await page.click('#replay-start'); await sleep(100);
await page.click('#replay-fwd'); await sleep(2500);
const settled = await st();
await page.click('#replay-start'); await page.click('#replay-fwd'); await sleep(2500);
check('an animated step ends in exactly the same state as the same step without animation waiting', JSON.stringify(settled) === JSON.stringify(await st()));

// 2. a tampered history is refused and nothing opens
await ev(() => window.bloodboard.set({ screen: 'home' })); await sleep(200);
await ev((t) => window.bloodboard.loadText(t, null), JSON.stringify(tampered)); await sleep(500);
s = await st();
check('a history with a changed result is refused (no replay opened)', s.screen === 'home', JSON.stringify(s));
check('the refusal explains why', /result|refused/i.test(await toast()), (await toast()).slice(0, 140));

// 3. a batch: verified games open, refused ones are counted and named
await ev((t) => window.bloodboard.loadText(t, null), batch); await sleep(700);
s = await st();
check('a batch opens its first verified game', s.screen === 'board' && s.replay);
check('the batch summary says 1 verified and 1 refused', /1 verified/.test(await toast()) && /1 refused/.test(await toast()), (await toast()).slice(0, 160));

// 4. export from a match on screen, then verify the exported file in node
await ev((state) => { const sv = state; window.bloodboard.openLoaded(sv.state, 'ui-export', sv, null); }, save); await sleep(500);
await page.click('#file-menu-btn');
const hasItem = await page.locator('button.menuitem:text-is("Export history…")').count();
check('File menu offers "Export history…" for a match', hasItem === 1);
if (hasItem) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), page.click('button.menuitem:text-is("Export history…")')]);
  let text = null;
  if (dl) { const path = await dl.path(); text = readFileSync(path, 'utf8'); }
  check('a file was downloaded', !!text);
  if (text) {
    const back = E.parseHistory(text);
    check('the exported file parses as bloodboard-history v1', back.ok && back.history.format === 'bloodboard-history' && back.history.version === 1);
    const v = back.ok ? E.verifyHistory(back.history) : { grade: 'refused' };
    check('the exported history verifies by re-execution', /^verified/.test(v.grade), v.reason);
    check('the exported id equals the one built outside the browser (same content, same identity)', back.ok && back.history.id === h.id);
  }
}
check('no browser errors', errors.length === 0, errors.slice(0, 2).join(' / '));
await browser.close();
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
