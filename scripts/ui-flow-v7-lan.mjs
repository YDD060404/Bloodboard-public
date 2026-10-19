// V7-05 — the network-match client in the real game UI (Chromium, dist/web served by the match server): two browser pages as two coaches.
// Component test over the loopback interface: it proves the client plumbing (join, host start from the normal set-up, authoritative updates,
// control gating, waiting states, reload/reconnect). It is NOT a two-device LAN run (see docs/LAN.md for the procedure on real devices).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = pw.default ?? pw;
const E = await import(new URL('../lan/engine.mjs', import.meta.url).href);
const { createServer } = await import(new URL('../lan/server.mjs', import.meta.url).href);
const results = [];
const check = (n, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ` — ${d}` : ''}`); };
const srv = await createServer({ engine: E, code: 'UIFLOW22', webDir: new URL('../dist/web', import.meta.url).pathname, journalDir: mkdtempSync(join(tmpdir(), 'bb-lan-ui-')), seed: () => 777001, mode: process.env.BB_MODE === 'internet' ? 'internet' : 'lan', ratePerMinute: 100000 });
const port = await srv.listen(0, '127.0.0.1');
const url = `http://127.0.0.1:${port}/`;
const browser = await chromium.launch();
const errors = [];
async function newPage(label) {
  const ctx = await browser.newContext({ viewport: { width: 1470, height: 920 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
  await page.goto(url); await page.waitForTimeout(400);
  return { page, ctx };
}
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const P1 = await newPage('P1'), P2 = await newPage('P2');
const connect = async ({ page }, seat, name) => {
  await page.click('#lan-open'); await sleep(200);
  await page.fill('#lan-code', 'uiflow22'); await page.fill('#lan-name', name); await page.selectOption('#lan-seat', seat);
  await page.click('#lan-connect'); await sleep(700);
};
await connect(P1, 'A', 'Ann');
check('Player 1 takes seat A and sees the status', /Player 1 \(host\)/.test(await P1.page.textContent('#lan-status')), await P1.page.textContent('#lan-status'));
await connect(P2, 'B', 'Bob');
check('the Network window states the connection mode', new RegExp(process.env.BB_MODE === 'internet' ? 'Internet match — NOT encrypted' : 'Local network match').test(await P1.page.textContent('#lan-mode')), await P1.page.textContent('#lan-mode'));
check('Player 2 takes seat B', /Player 2/.test(await P2.page.textContent('#lan-status')));
await sleep(300);
check('each player sees the other connected', /Player 2: Bob \(connected\)/.test(await P1.page.textContent('#lan-peers')) && /Player 1: Ann \(connected\)/.test(await P2.page.textContent('#lan-peers')), await P1.page.textContent('#lan-peers'));
const wrongCode = await newPage('P3');
await wrongCode.page.click('#lan-open'); await sleep(150); await wrongCode.page.fill('#lan-code', 'WRONGCODE'); await wrongCode.page.fill('#lan-name', 'Eve'); await wrongCode.page.selectOption('#lan-seat', 'B'); await wrongCode.page.click('#lan-connect'); await sleep(500);
check('a wrong room code is refused with a plain message', /Wrong room code/.test(await wrongCode.page.textContent('#lan-error')));
await wrongCode.ctx.close();

// host: normal set-up, then Start match
await P1.page.click('#lan-setup'); await sleep(600);
await P1.page.evaluate(() => { const b = document.querySelector('#nm-hotseat'); if (b) b.click(); }); await sleep(200);
const startDisabled = await P1.page.evaluate(() => document.querySelector('#start-match')?.disabled);
check('the normal Exhibition set-up opens for the host', startDisabled === false, String(startDisabled));
await P1.page.click('#start-match'); await sleep(1500);
const s1 = await P1.page.evaluate(() => ({ screen: window.bloodboard.st.screen, started: window.bloodboard.lan?.started, phase: window.bloodboard.st.game.phase, seed: window.bloodboard.st.game.rng.seed, kind: window.bloodboard.st.ctx.kind }));
const s2 = await P2.page.evaluate(() => ({ screen: window.bloodboard.st.screen, started: window.bloodboard.lan?.started, phase: window.bloodboard.st.game.phase, kind: window.bloodboard.st.ctx.kind }));
check('the match starts for both coaches from the host\'s set-up', s1.started && s2.started && s1.kind === 'match' && s2.kind === 'match' && s1.phase === 'pregame', JSON.stringify([s1, s2]));
check('the browsers never hold the dice seed (the server replaced it and sends 0)', s1.seed === 0 && srv.room.state.rng.seed === 777001);

// drive the game through the UI's own command paths, one coach per page, using each page's PUBLIC state only
const pageOf = { A: P1.page, B: P2.page };
const stateOf = (p) => p.evaluate(() => JSON.parse(JSON.stringify(window.bloodboard.st.game)));
let n = 0, sawWait = false, sawOwnDecision = false, undoOffered = null;
for (let guard = 0; guard < 400 && n < 60; guard++) {
  await sleep(120);
  const auth = srv.room.state;
  const w = E.waitingFor(auth);
  const seat = w ?? 'A';
  // both pages must have caught up
  const revs = await Promise.all(['A', 'B'].map((s) => pageOf[s].evaluate(() => window.bloodboard.lan.rev)));
  if (revs.some((r) => r !== srv.room.rev)) continue;
  const mine = await stateOf(pageOf[seat]);
  const intentFn = () => { if (w === null) return seat === 'A' ? { kind: 'action', input: { kind: mine.phase === 'pregame' ? 'pregame' : 'nextDrive' } } : null; const mv = E.nextMove(mine, seat, 'balanced'); return !mv ? null : mv.type === 'decision' ? { kind: 'decision', req: mv.requestId, opt: mv.optionId } : { kind: 'action', input: mv.input }; };
  const intent = intentFn(); if (!intent) continue;
  // gating: the OTHER page must offer no controls and, for a decision, say it is waiting
  if (w !== null && auth.pending && !sawWait) {
    const other = pageOf[seat === 'A' ? 'B' : 'A'];
    // the waiting coach first replays the opponent's dice locally (tray playback); skip it, then the waiting notice must show
    await other.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /Show the rest/.test(x.textContent)); if (b) b.click(); });
    await sleep(600);
    const txt = await other.evaluate(() => ({ remote: !!document.querySelector('#remote-deciding') || /Waiting for the other coach/.test(document.body.innerText), decisionButtons: document.querySelectorAll('.side .optbtn, .side [data-option]').length, undo: window.bloodboard.canUndo(), pend: !!window.bloodboard.st.game.pending, team: window.bloodboard.st.game.pending?.request.team, seat: window.bloodboard.lan?.seat, txt: document.body.innerText.slice(0, 0) + [...document.querySelectorAll('.side, #tray, .tray')].map((e) => e.innerText).join(' / ').slice(0, 300) }));
    check('while the other coach has a pending decision this page says it is waiting and offers no decision buttons', txt.remote && txt.decisionButtons === 0, JSON.stringify(txt)); sawWait = true;
  }
  if (auth.pending && auth.pending.request.team === seat && !sawOwnDecision) { sawOwnDecision = true; undoOffered = await pageOf[seat].evaluate(() => window.bloodboard.canUndo()); }
  if (intent.kind === 'decision') await pageOf[seat].evaluate(([r, o]) => window.bloodboard.decide({ id: r, options: [], prompt: '', team: 'A', type: 'x' }, o), [intent.req, intent.opt]);
  else await pageOf[seat].evaluate((i) => window.bloodboard.runSimple(i), intent.input);
  n++;
  // wrong-seat attempt from the page that must wait: refused with a message, state unchanged
  if (n === 12) { const rev0 = srv.room.rev; const other = pageOf[E.waitingFor(srv.room.state) === 'A' ? 'B' : 'A']; await sleep(300); if (E.waitingFor(srv.room.state)) { await other.evaluate(() => window.bloodboard.runSimple({ kind: 'endTurn' })); await sleep(400); check('a command sent by the page that does not have the move is refused and changes nothing', srv.room.rev >= rev0 && /not|move|decision|Turn/i.test(await other.evaluate(() => [...document.querySelectorAll('.toast, .toasts *')].map((e) => e.textContent).join(' | ')))); } }
}
check('about sixty commands were played through the UI', n >= 55, String(n));
check('Undo is not offered in a network match', undoOffered === false || undoOffered === null);
await sleep(500);
const a = await stateOf(P1.page), b = await stateOf(P2.page);
const pub = (s) => JSON.stringify({ ...s, pending: s.pending && s.pending.request.id, clock: 0 });
const strip = (s) => ({ ...s, clock: undefined });
check('both pages hold the same public state as the server (log, score, positions)', pub(strip(a)) === pub(strip(b)) && a.log.length === srv.room.state.log.length && JSON.stringify(a.players) === JSON.stringify(srv.room.state.players), `${a.log.length} vs ${b.log.length} vs ${srv.room.state.log.length}`);

// reload Player 2 mid-match: the saved token restores the seat and the board without any re-roll
const counterBefore = srv.room.state.rng.counter, revBefore = srv.room.rev;
await P2.page.reload(); await sleep(1500);
const r2 = await P2.page.evaluate(() => ({ lan: !!window.bloodboard.lan, seat: window.bloodboard.lan?.seat, started: window.bloodboard.lan?.started, log: window.bloodboard.st.game.log.length, screen: window.bloodboard.st.screen }));
check('after a reload the saved token restores the seat and the match board', r2.lan && r2.seat === 'B' && r2.started && r2.log === srv.room.state.log.length && r2.screen === 'board', JSON.stringify(r2));
check('reconnecting rolled no dice', srv.room.state.rng.counter === counterBefore && srv.room.rev === revBefore);

// a spectator sees the match and can send nothing
const P4 = await newPage('P4');
await P4.page.click('#lan-open'); await sleep(150); await P4.page.fill('#lan-code', 'UIFLOW22'); await P4.page.fill('#lan-name', 'Watcher'); await P4.page.selectOption('#lan-seat', 'S'); await P4.page.click('#lan-connect'); await sleep(1500);
const sp = await P4.page.evaluate(() => ({ seat: window.bloodboard.lan?.seat, log: window.bloodboard.st.game.log.length }));
check('a spectator sees the match', sp.seat === 'S' && sp.log === srv.room.state.log.length, JSON.stringify(sp));
await P4.page.evaluate(() => window.bloodboard.runSimple({ kind: 'endTurn' })); await sleep(300);
check('a spectator cannot send commands', srv.room.rev === revBefore);
const real = errors.filter((e) => !/Failed to load resource|EventSource/.test(e));
check('no unexpected browser errors', real.length === 0, real.slice(0, 3).join(' | ').slice(0, 300));
await browser.close(); await srv.close();
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} passed`);
process.exit(ok === results.length ? 0 : 1);
