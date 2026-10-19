// V6 acceptance: opening a saved COMPLETED match enters Replay from the beginning (not the final snapshot).
//   REAL_MATCHES=tests/fixtures/real-matches/teams node scripts/ui-flow-v6-open-replay.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { open } from './ui-helpers.mjs';
const dir = process.env.REAL_MATCHES;
const results = [];
function check(name, ok, detail = '') { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); }
const files = Object.fromEntries(readdirSync(dir).filter((f) => /^(NorCh v NorCh|Lizaer v Lizaer)\.json$/.test(f)).map((f) => [f.replace(/\.json$/, ''), readFileSync(`${dir}/${f}`, 'utf8')]));
const { browser, page, errors } = await open({ home: true, width: 1470, height: 920 });
const ev = (fn, a) => page.evaluate(fn, a);
const sleep = (ms) => page.waitForTimeout(ms);
await ev((f) => {
  const d = {}; for (const [n, t] of Object.entries(f)) d[n] = { json: t, savedAt: new Date().toISOString() };
  const o = JSON.parse(f['NorCh v NorCh']); let done = false;
  for (const en of o.state.log) { for (const e of en.events) for (const x of (e.dice || [])) if (!done) { x.faces = x.faces.map((v) => (v === 1 ? 2 : 1)); done = true; } if (done) break; }
  d['Altered history'] = { json: JSON.stringify(o), savedAt: new Date().toISOString() };
  localStorage.setItem('bloodboard.positions.v1', JSON.stringify(d));
}, files);
await page.reload(); await sleep(400);
const snap = (n) => JSON.parse(files[n]).state;
const S = () => ev(() => { const a = window.bloodboard; const g = a.st.game; return { replay: !!a.st.replay, kind: a.st.ctx.kind, screen: a.st.screen, log: g.log.length, counter: g.rng.counter, score: [g.teams.A.score, g.teams.B.score], phase: g.phase, ball: JSON.stringify(g.ball), pos: JSON.stringify(g.players.map((p) => [p.id, p.pos, p.stance])), svg: (document.querySelector('.pitchhost svg')?.innerHTML || '').length }; });
const text = (sel) => page.locator(sel).first().innerText();
async function openViaLibrary(name, button = 'Open') {
  await ev(() => window.bloodboard.set({ screen: 'home', modal: { kind: 'library' } })); await sleep(300);
  await page.locator(`.libitem:has(b:text-is("${name}")) button:text-is("${button}")`).click(); await sleep(600);
}
for (const name of ['NorCh v NorCh', 'Lizaer v Lizaer']) {
  const fin = snap(name);
  await openViaLibrary(name, 'Open');
  const s0 = await S();
  check(`${name}: plain "Open" of a completed match enters Replay, not the final snapshot`, s0.replay && s0.kind === 'replay' && s0.screen === 'board' && s0.log === 0 && s0.phase !== 'fullTime', JSON.stringify([s0.kind, s0.log, s0.phase]));
  check(`${name}: the Replay panel says where it starts and offers "Open as position"`, /Step 0 of \d+/.test(await text('#replay-pos')) && !!(await page.$('#replay-open-position')));
  const count = Number((await text('#replay-pos')).match(/of (\d+)/)[1]);
  await page.click('#replay-fwd'); await page.click('#replay-fwd'); await page.click('#replay-fwd'); await sleep(100);
  const s3 = await S();
  check(`${name}: stepping forward changes the board (state and drawn pitch) and shows the recorded action`, s3.log === 3 && (s3.pos !== s0.pos || s3.ball !== s0.ball || s3.counter !== s0.counter) && s3.svg > 0 && !!(await page.$('#replay-entry')));
  await page.click('#replay-back'); await sleep(80);
  const s2 = await S();
  await page.click('#replay-fwd'); await sleep(80);
  const s3b = await S();
  check(`${name}: step back then forward restores the identical state (no new dice)`, s2.log === 2 && s3b.log === 3 && s3b.pos === s3.pos && s3b.counter === s3.counter);
  await page.selectOption('#replay-speed', '8'); await page.click('#replay-play'); await sleep(500); await page.click('#replay-play');
  const sp = await S(); await sleep(400);
  check(`${name}: play advances several steps and pause stops`, sp.log > 3 && (await S()).log === sp.log, `paused at ${sp.log}`);
  await page.selectOption('#replay-turn', { index: 4 }); await sleep(200);
  const jt = await S();
  check(`${name}: jump to a later turn`, jt.log > sp.log || jt.log > 3, `step ${jt.log}`);
  await page.click('#replay-drive-next').catch(() => {}); await page.click('#replay-td-next').catch(() => {}); await sleep(200);
  await page.click('#replay-end'); await sleep(200);
  const e = await S();
  check(`${name}: the end of Replay equals the saved final snapshot (score, dice counter, log, positions)`, e.log === fin.log.length && e.log === count && e.counter === fin.rng.counter && e.score[0] === fin.teams.A.score && e.score[1] === fin.teams.B.score && e.pos === JSON.stringify(fin.players.map((p) => [p.id, p.pos, p.stance])), JSON.stringify([e.log, fin.log.length, e.counter, fin.rng.counter]));
  await page.click('#replay-open-position'); await sleep(500);
  const p = await S();
  check(`${name}: "Open as position" leaves Replay and shows the saved final board as a match`, !p.replay && p.kind === 'match' && p.phase === 'fullTime' && p.log === fin.log.length);
  await openViaLibrary(name, 'Position');
  check(`${name}: the library's "Position" button also opens the final board directly`, !(await S()).replay && (await S()).kind === 'match');
}
// import path (Load from file / drop): the same semantics through loadText
await ev((t) => window.bloodboard.loadText(t, 'imported'), files['NorCh v NorCh']); await sleep(600);
const im = await S();
check('importing a completed match file enters Replay from the beginning', im.replay && im.log === 0);
// not replayable: explicit, never pretending
await openViaLibrary('Altered history', 'Open');
const alt = await S();
const toast = await ev(() => document.body.innerText);
check('a history that does not reproduce opens as a position only, with an explicit message, and no Replay controls', !alt.replay && alt.kind === 'match' && /position only/i.test(toast) && !(await page.$('#replay-fwd')), JSON.stringify([alt.kind, alt.replay]));
await openViaLibrary('Altered history', 'Replay');
check('explicit Replay of it says "Position only" and offers no playback', /Position only/i.test(await text('#replay-grade')) && !(await page.$('#replay-fwd')));
const bad = errors.filter((x) => !/favicon/.test(x));
check('no page errors', bad.length === 0, bad.slice(0, 3).join(' | '));
await browser.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
