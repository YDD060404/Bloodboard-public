// V7-14 — the network client against a SLEEPING and RESTARTING free host (Chromium, two coaches).
// A small gateway in front of the match server plays the part of the host platform: while "asleep" it answers 502 and drops open event
// streams, like a free host that spun down; the match server behind it is then restarted from the (fake Upstash) recovery store.
// Evidence class: browser + real server code + fake Upstash on loopback. NOT Render, NOT Upstash, NOT two devices.
import http from 'node:http';
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = pw.default ?? pw;
const E = await import(new URL('../lan/engine.mjs', import.meta.url).href);
const { createServer } = await import(new URL('../lan/server.mjs', import.meta.url).href);
const { upstashStore, sealedStore, deriveKey } = await import(new URL('../lan/store.mjs', import.meta.url).href);
const { fakeUpstash } = await import(new URL('../lan/test/fake-upstash.mjs', import.meta.url).href);
const results = [];
const check = (n, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ` — ${d}` : ''}`); };
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const CODE = 'WAKE7777';
const fu = await fakeUpstash();
const boot = async () => {
  const srv = await createServer({ engine: E, code: CODE, mode: 'internet', trustProxy: true, store: sealedStore(upstashStore({ url: fu.url, token: 'tok-test', retries: 0 }), deriveKey(CODE)), webDir: new URL('../dist/web', import.meta.url).pathname, seed: () => 880077, ratePerMinute: 100000, joinsPerMinute: 100000 });
  return { srv, port: await srv.listen(0, '127.0.0.1') };
};
let up = await boot();
// the gateway
const conns = new Set(); let asleep = true; let target = up.port;
const gw = http.createServer((req, res) => {
  if (!conns.has(req.socket)) { conns.add(req.socket); req.socket.once('close', () => conns.delete(req.socket)); }
  if (asleep) { res.writeHead(502, { 'Content-Type': 'text/html' }); return res.end('<h1>Bad Gateway</h1>'); }
  const u = http.request({ host: '127.0.0.1', port: target, path: req.url, method: req.method, headers: { ...req.headers, 'x-forwarded-for': '203.0.113.9' } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  u.on('error', () => { try { res.writeHead(502); res.end(); } catch { /* gone */ } }); req.pipe(u); res.on('close', () => u.destroy());
});
await new Promise((ok) => gw.listen(0, '127.0.0.1', ok));
const sleepHost = () => { asleep = true; for (const s of conns) s.destroy(); };
const wakeHost = (port) => { if (port) target = port; asleep = false; };
const url = `http://127.0.0.1:${gw.address().port}/`;
const browser = await chromium.launch();
const errors = [];
const newPage = async (label) => {
  const ctx = await browser.newContext({ viewport: { width: 1470, height: 920 } }); const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
  await page.goto(url + '?x=1', { waitUntil: 'domcontentloaded' }).catch(() => undefined);
  return { page, ctx };
};
// the page itself must load while the host is asleep? No: a sleeping host serves nothing. Wake it for the first page load only.
wakeHost(); const P1 = await newPage('P1'), P2 = await newPage('P2'); await sleep(500);
// 1. COLD START: the host sleeps again; Player 1 presses Connect and sees the waking note, then gets in once the host is back
sleepHost();
await P1.page.click('#lan-open'); await sleep(200);
await P1.page.fill('#lan-code', CODE.toLowerCase()); await P1.page.fill('#lan-name', 'Ann'); await P1.page.selectOption('#lan-seat', 'A');
await P1.page.click('#lan-connect'); await sleep(3500);
const wakeTxt = await P1.page.evaluate(() => document.querySelector('#lan-wake')?.textContent ?? '');
check('while the host is asleep (502) the join form says the server is waking up instead of failing', /waking up/i.test(wakeTxt), wakeTxt);
wakeHost(); await sleep(9000);
const seatTxt = await P1.page.textContent('#lan-status').catch(() => '');
check('once the host is awake the join completes by itself (seat A)', /Player 1 \(host\)/.test(seatTxt), seatTxt);
await P2.page.click('#lan-open'); await sleep(200); await P2.page.fill('#lan-code', CODE); await P2.page.fill('#lan-name', 'Bob'); await P2.page.selectOption('#lan-seat', 'B'); await P2.page.click('#lan-connect'); await sleep(1200);
check('Player 2 takes seat B', /Player 2/.test(await P2.page.textContent('#lan-status')));
// 2. play a few moves
await P1.page.click('#lan-setup'); await sleep(600);
await P1.page.evaluate(() => { const b = document.querySelector('#nm-hotseat'); if (b) b.click(); }); await sleep(200);
await P1.page.click('#start-match'); await sleep(1800);
const started = await Promise.all([P1, P2].map((p) => p.page.evaluate(() => !!window.bloodboard.lan?.started)));
check('the match starts for both coaches through the gateway', started.every(Boolean));
const pageOf = { A: P1.page, B: P2.page };
const play = async (count) => {
  let n = 0;
  for (let g = 0; g < 300 && n < count; g++) {
    await sleep(120);
    const auth = up.srv.room.state; const w = E.waitingFor(auth); const seat = w ?? 'A';
    const revs = await Promise.all(['A', 'B'].map((s) => pageOf[s].evaluate(() => window.bloodboard.lan.rev)));
    if (revs.some((r) => r !== up.srv.room.rev)) continue;
    const mine = await pageOf[seat].evaluate(() => JSON.parse(JSON.stringify(window.bloodboard.st.game)));
    let intent;
    if (w === null) intent = seat === 'A' ? { kind: 'action', input: { kind: mine.phase === 'pregame' ? 'pregame' : 'nextDrive' } } : null;
    else { const mv = E.nextMove(mine, seat, 'balanced'); intent = !mv ? null : mv.type === 'decision' ? { kind: 'decision', req: mv.requestId, opt: mv.optionId } : { kind: 'action', input: mv.input }; }
    if (!intent) continue;
    if (intent.kind === 'decision') await pageOf[seat].evaluate(([r, o]) => window.bloodboard.decide({ id: r, options: [], prompt: '', team: 'A', type: 'x' }, o), [intent.req, intent.opt]);
    else await pageOf[seat].evaluate((i) => window.bloodboard.runSimple(i), intent.input);
    n++;
  }
  return n;
};
const n1 = await play(12);
check('about a dozen commands were played', n1 >= 10, String(n1));
const revA = up.srv.room.rev, logA = up.srv.room.state.log.length;
// 3. the host goes to sleep mid-match: streams drop, pages show reconnecting, nothing is lost
sleepHost(); await sleep(5000);
const st = await Promise.all([P1, P2].map((p) => p.page.evaluate(() => ({ status: window.bloodboard.lan.status, note: window.bloodboard.lan.note }))));
check('both pages notice the outage and show "reconnecting" with an explanation (no crash, seat kept)', st.every((x) => x.status === 'reconnecting'), JSON.stringify(st));
// 4. the process is replaced (a fresh server replays the store) and the gateway wakes; pages reconnect by themselves
await up.srv.close(); up = await boot();
check('the new server process replayed the match from the store (same revision)', up.srv.room.rev === revA && up.srv.room.state.log.length === logA, `${up.srv.room.rev} vs ${revA}`);
wakeHost(up.port);
let back = false;
for (let i = 0; i < 80 && !back; i++) { await sleep(500); const s = await Promise.all([P1, P2].map((p) => p.page.evaluate(() => window.bloodboard.lan?.status))); back = s.every((x) => x === 'online'); }
check('both pages reconnect on their own after the wake (back-off loop, no reload)', back);
const rv = await Promise.all([P1, P2].map((p) => p.page.evaluate(() => window.bloodboard.lan.rev)));
// a move that was in flight when the host went to sleep is retried with its old id and lands exactly once (revision may be revA or revA+1, never more)
check('both pages hold the server\'s restored revision (an in-flight move may have landed once)', rv.every((r) => r === up.srv.room.rev) && up.srv.room.rev - revA <= 1, JSON.stringify({ rv, revA, server: up.srv.room.rev }));
// 5. play continues on the restored room
const n2 = await play(8);
const revRestored = up.srv.room.rev - n2;
check('play continues after the restart (8 more commands, applied once each)', n2 >= 6 && up.srv.room.rev === revRestored + n2, `${n2} cmds, rev ${up.srv.room.rev}`);
// 6. a move sent while the gateway answers 502 is retried and applied exactly once
sleepHost(); setTimeout(() => wakeHost(), 3500);
const before = up.srv.room.rev; const m = await play(1);
await sleep(6000);
check('a command issued during a 502 is retried by the client and applied exactly once', m === 1 && up.srv.room.rev === before + 1, `rev ${before} -> ${up.srv.room.rev}`);
const real = errors.filter((e) => !/Failed to load resource|EventSource|ERR_|502|net::/.test(e));
check('no unexpected browser errors', real.length === 0, real.slice(0, 3).join(' | ').slice(0, 300));
await browser.close(); await up.srv.close(); gw.close(); await fu.close();
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} passed (evidence class: browser + server code + fake Upstash on loopback)`);
process.exit(ok === results.length ? 0 : 1);
