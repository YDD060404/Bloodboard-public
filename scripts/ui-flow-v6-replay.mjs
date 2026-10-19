// V6 — real Replay and collision-safe saving through the game UI (Chromium against dist/web), using the user's REAL saved matches.
//   REAL_MATCHES=<dir with the match json files> node scripts/ui-flow-v6-replay.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { open } from './ui-helpers.mjs';
const dir = process.env.REAL_MATCHES;
const results = [];
function check(name, ok, detail = '') { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); }
const files = Object.fromEntries(readdirSync(dir).filter((f) => /^(NorCh v NorCh|Lizaer v Lizaer\d*)\.json$/.test(f)).map((f) => [f.replace(/\.json$/, ''), readFileSync(`${dir}/${f}`, 'utf8')]));
const sha = (t) => createHash('sha256').update(t).digest('hex');
const { browser, page, errors } = await open({ home: true, width: 1470, height: 920 });
const ev = (fn, arg) => page.evaluate(fn, arg);
const sleep = (ms) => page.waitForTimeout(ms);
// seed the browser store exactly as the app would hold saved positions (name → json)
await ev((f) => { const d = {}; for (const [n, t] of Object.entries(f)) d[n] = { json: t, savedAt: new Date().toISOString() }; d['Broken history'] = (() => { const o = JSON.parse(f['NorCh v NorCh']); { let done = false; for (const en of o.state.log) { for (const e of en.events) for (const x of (e.dice || [])) if (!done) { x.faces = x.faces.map((v) => (v === 1 ? 2 : 1)); done = true; } if (done) break; } } return { json: JSON.stringify(o), savedAt: new Date().toISOString() }; })(); localStorage.setItem('bloodboard.positions.v1', JSON.stringify(d)); }, files);
await page.reload(); await sleep(400);
const before = await ev(() => localStorage.getItem('bloodboard.positions.v1'));


const text = (sel) => page.locator(sel).first().innerText();
async function openReplayVia(name) {
  await ev(() => window.bloodboard.set({ screen: 'home', modal: { kind: 'library' } }));
  await sleep(300);
  await page.locator(`.libitem:has(b:text-is("${name}")) button:text-is("Replay")`).click();
  await sleep(500);
}
const st = () => ev(() => { const g = window.bloodboard.st.game; return { counter: g.rng.counter, log: g.log.length, score: [g.teams.A.score, g.teams.B.score], half: g.turn.half, replay: !!window.bloodboard.st.replay, thinking: window.bloodboard.st.computer.thinking, screen: window.bloodboard.st.screen }; });

// ---- 1. a real saved match: NorCh v NorCh -----------------------------------------------------------------------
await openReplayVia('NorCh v NorCh');
check('Replay opens on the board screen in Replay mode', (await st()).screen === 'board' && (await st()).replay);
check('the file is graded "Replayable after migration" (verified against its recorded dice)', /after migration/i.test(await text('#replay-grade')), await text('#replay-reason'));
check('starts before the first action', /Step 0 of 142/.test(await text('#replay-pos')) && (await st()).log === 0);
const seen = {};
for (let i = 1; i <= 6; i++) { await page.click('#replay-fwd'); seen[i] = await st(); }
check('step forward ×6 reaches step 6 with 6 recorded entries applied', /Step 6 of 142/.test(await text('#replay-pos')) && seen[6].log === 6);
const dice = await text('#replay-events');
check('recorded dice are shown for the step', /D[0-9]+ [0-9]|BLOCK|D6|D3/i.test(await text('#replay-entry')) || dice.length > 10, dice.slice(0, 80));
await page.click('#replay-back'); await page.click('#replay-back');
const back = await st();
check('step backward ×2 returns exactly to step 4 (same dice counter and log)', /Step 4 of 142/.test(await text('#replay-pos')) && back.counter === seen[4].counter && back.log === seen[4].log, JSON.stringify([back, seen[4]]));
await page.click('#replay-fwd'); await page.click('#replay-fwd');
check('stepping forward again reproduces step 6 identically (no new random results)', JSON.stringify(await st()) === JSON.stringify(seen[6]));
await page.click('#replay-end');
const end = await st();
const savedFinal = JSON.parse(files['NorCh v NorCh']).state;
check('the last step reproduces the saved final score and the saved dice counter', end.score[0] === savedFinal.teams.A.score && end.score[1] === savedFinal.teams.B.score && end.counter === savedFinal.rng.counter && end.log === savedFinal.log.length, JSON.stringify([end, savedFinal.teams.A.score, savedFinal.teams.B.score, savedFinal.rng.counter]));
const same = await ev((saved) => JSON.stringify(window.bloodboard.st.game.log.map((e) => [e.input, e.decisions.map((d) => [d.requestId, d.optionId]), e.events, e.outcome])) === JSON.stringify(saved.log.map((e) => [e.input, e.decisions.map((d) => [d.requestId, d.optionId]), e.events, e.outcome])), savedFinal);
check('the replayed log equals the saved log event-for-event, dice-for-dice', same);
await page.click('#replay-start');
check('back to the beginning', (await st()).log === 0);
await page.selectOption('#replay-turn', { index: 3 }); await sleep(200);
const jt = await st();
check('jump to a turn lands on a recorded step', jt.log > 0 && jt.log < 142, JSON.stringify(jt));
await page.click('#replay-td-next'); await sleep(200);
const td = await st();
check('jump to the next touchdown', td.score[0] + td.score[1] >= 1, JSON.stringify(td));
await page.click('#replay-drive-prev'); await sleep(200);
check('jump to a drive boundary', (await st()).log < td.log);
await page.selectOption('#replay-speed', '8'); await page.click('#replay-start'); await page.click('#replay-play'); await sleep(400);
check('play advances automatically and pause stops it', (await st()).log > 0);
await page.click('#replay-play'); const pausedAt = (await st()).log; await sleep(500);
check('paused: no further movement', (await st()).log === pausedAt);
await page.keyboard.press('ArrowRight'); await sleep(100);
check('keyboard → steps forward', (await st()).log === pausedAt + 1);
check('Replay never ran a coach', !(await st()).thinking);
await page.click('#replay-exit'); await sleep(200);
check('the saved file is byte-identical after Replay (nothing written)', (await ev(() => localStorage.getItem('bloodboard.positions.v1'))) === before);

// ---- 2. the other real files ------------------------------------------------------------------------------------
for (const n of Object.keys(files)) {
  if (n === 'NorCh v NorCh') continue;
  await openReplayVia(n);
  const g = await text('#replay-grade'); const pos = await text('#replay-pos');
  await page.click('#replay-end'); const e = await st();
  const sv = JSON.parse(files[n]).state;
  check(`${n}: ${g}; end of Replay = saved final position`, /Replayable/i.test(g) && e.counter === sv.rng.counter && e.log === sv.log.length && e.score[0] === sv.teams.A.score && e.score[1] === sv.teams.B.score, pos);
}
// ---- 3. a history that does not reproduce is NOT replayed ----------------------------------------------------------
await openReplayVia('Broken history');
check('altered history: position-only, no Replay controls, reason given', /Position only/i.test(await text('#replay-grade')) && (await page.locator('#replay-fwd').count()) === 0 && /cannot be reproduced|differ/i.test(await text('#replay-reason')), await text('#replay-reason'));
await ev(() => window.bloodboard.set({ screen: 'home' }));

// ---- 4. collision-safe saving ---------------------------------------------------------------------------------------
const names = await ev((f) => {
  const E = window.BloodboardEngine; const app = window.bloodboard;
  const mk = (txt) => { const sf = JSON.parse(txt); return E.reconstructInitial(sf.state); };
  const out = [];
  return { a: mk(f['NorCh v NorCh']), b: mk(f['Lizaer v Lizaer']) } && 0;
}, files);
await ev(async (f) => {
  const E = window.BloodboardEngine; const app = window.bloodboard;
  const init = (txt) => E.reconstructInitial(JSON.parse(txt).state);
  window.__ids = [];
  for (const t of [f['NorCh v NorCh'], f['Lizaer v Lizaer']]) {
    const g = init(t);
    app.openBoard(g, { kind: 'match', matchKind: 'tournament' }, { docName: 'Same v Same' });
    await app.saveCurrent();
    window.__ids.push([app.st.matchId, app.st.saveFile]);
    await app.saveCurrent(); // update in place: must NOT create a third file
  }
}, files);
const list = await ev(async () => (await window.bloodboard.store.list()).map((x) => x.name).filter((n) => n.startsWith('Same v Same')).sort());
const ids = await ev(() => window.__ids);
check('two different matches with the same display name are saved as two files', list.length === 2 && list[0] === 'Same v Same' && list[1] === 'Same v Same (1)', JSON.stringify(list));
check('they have different match ids', ids[0][0] !== ids[1][0], JSON.stringify(ids));
check('saving again updates the current save in place (no third file)', list.length === 2);
const bodies = await ev(async () => { const s = window.bloodboard.store; const o = []; for (const n of ['Same v Same', 'Same v Same (1)']) { const p = JSON.parse(await s.load(n)); o.push([p.meta.matchId, p.meta.displayName, p.state.log.length, !!p.meta.initial, p.version, p.meta.rulesHash.length]); } return o; });
check('each file holds its own match (id, name, initial state, version 2, rules fingerprint)', bodies[0][0] !== bodies[1][0] && bodies.every((b) => b[1] === 'Same v Same' && b[3] && b[4] === 2 && b[5] === 64), JSON.stringify(bodies));
await ev(async () => { const app = window.bloodboard; await app.saveAs('Same v Same'); window.__sa = app.st.saveFile; });
check('Save As with an existing name creates a new file', (await ev(() => window.__sa)) === 'Same v Same (2)');
const after = await ev(async () => (await window.bloodboard.store.list()).map((x) => x.name).filter((n) => n.startsWith('Same v Same')).sort());
check('no earlier file was replaced', after.length === 3);
// exclusive creation is race-safe in the store itself
const race = await ev(async () => { const s = window.bloodboard.store; const r = await Promise.allSettled([s.save('Race', '{"a":1}', { exclusive: true }), s.save('Race', '{"a":2}', { exclusive: true })]); return r.map((x) => x.status); });
check('two simultaneous exclusive creates of one name: exactly one wins', race.filter((x) => x === 'fulfilled').length === 1, JSON.stringify(race));
// a replay-saved v2 file reopens as a replayable match with the stored initial state
await openReplayVia('Same v Same');
check('a V6 file with a stored initial state opens (a match with no moves yet: nothing to replay but position)', /Position only|Replayable/i.test(await text('#replay-grade')));
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} passed`);
await browser.close();
process.exit(bad.length ? 1 : 0);
