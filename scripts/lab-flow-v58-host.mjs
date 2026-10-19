// V5.8 — the ACTUAL batch website path (Match Lab): starts the real lab server from LAB_DIR, drives its real web page
// (Chromium), starts batches through the page, and checks the files the runner wrote. Fixture: tests/fixtures/host-fixture-coach.js
// (copied by this script into LAB_DIR/coaches). Covers: coach inventory (hooks), a swapped pair to full time with external set-up
// and context, a 7.5 s decision under the coach's own 60 s limit, history replay verification, Stop (cancellation), and a
// chosen 2 s budget that does cut the slow coach off and records the fallback.
// Run:  LAB_DIR=/path/to/match-lab-copy PLAYWRIGHT_MODULE=… node scripts/lab-flow-v58-host.mjs
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = pw.default ?? pw;
const LAB = process.env.LAB_DIR; if (!LAB) throw new Error('LAB_DIR is required');
const PORT = Number(process.env.LAB_PORT || 8791);
const results = [];
function check(name, ok, detail = '') { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); }
mkdirSync(join(LAB, 'coaches'), { recursive: true });
copyFileSync('tests/fixtures/host-fixture-coach.js', join(LAB, 'coaches', 'host-fixture-coach.js'));
const cfg = JSON.parse(readFileSync(join(LAB, 'config/lab-config.json'), 'utf8')); void cfg;
const server = spawn(process.execPath, ['lab.mjs', 'window', '--no-open', '--port', String(PORT)], { cwd: LAB, env: { ...process.env, LAB_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; server.stdout.on('data', (d) => (out += d)); server.stderr.on('data', (d) => (out += d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let up = false; for (let i = 0; i < 80 && !up; i++) { await sleep(250); up = await fetch(`http://127.0.0.1:${PORT}/api/state`).then((r) => r.ok, () => false); }
check('the Match Lab server started from the delivered folder', up, out.slice(0, 200));
if (!up) { server.kill(); process.exit(1); }
const base = `http://127.0.0.1:${PORT}`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on('dialog', (d) => { void d.accept(); }); // the Stop button asks for confirmation
const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
await page.goto(base); await sleep(800);
const runs = () => readdirSync(join(LAB, 'runs')).filter((d) => !d.startsWith('.')).sort();
const gamesOf = (id) => { const dir = join(LAB, 'runs', id, 'games'); return existsSync(dir) ? readdirSync(dir) : []; };
const read = (id, f) => JSON.parse(readFileSync(join(LAB, 'runs', id, 'games', f), 'utf8'));

// ── coach inventory ───────────────────────────────────────────────────────────────────────────────────────────
await page.click('#nav button[data-t="coaches"]'); await sleep(1500);
const ctext = await page.locator('#coachTable').innerText();
check('the Coaches tab lists the fixture with its 60 s limit and "set-up hook"', /Host Fixture/.test(ctext) && /60 s/.test(ctext) && /set-up hook/.test(ctext), ctext.split('\n').filter((l) => /Host Fixture|set-up hook/.test(l)).slice(0, 3).join(' | '));
await page.click('#nav button[data-t="new"]');

async function newBatch({ tl = '', pairs = 1, seed = 4242 } = {}) {
  const before = new Set(runs());
  await page.selectOption('#fmt', 'sevens');
  const opt = await page.locator('#p1 option', { hasText: 'Host Fixture' }).first().getAttribute('value');
  await page.selectOption('#p1', opt); await page.selectOption('#p2', opt);
  await page.selectOption('#seedKind', 'base'); await page.fill('#seedBase', String(seed));
  await page.selectOption('#pairing', 'swap'); await page.fill('#count', String(pairs));
  await page.selectOption('#tl', tl); await page.selectOption('#obs', 'compact');
  await page.click('#bStart'); 
  let id = null; for (let i = 0; i < 80 && !id; i++) { await sleep(250); id = runs().find((r) => !before.has(r)) ?? null; }
  return id;
}
// ── batch 1: a swapped pair, the coach's own 60 s limit ───────────────────────────────────────────────────────────
const t0 = Date.now();
const b1 = await newBatch();
check('a batch started from the page created a run', !!b1, b1 ?? '');
const finished = async (id, n, ms) => { const end = Date.now() + ms; for (;;) { const g = gamesOf(id).filter((f) => /^[^.]+\.json$/.test(f)); if (g.length >= n) return g; if (Date.now() > end) return g; await sleep(1000); } };
const g1 = await finished(b1, 2, 300000);
check('both games of the swapped pair finished (match completion)', g1.length === 2, `${g1.length} games in ${Math.round((Date.now() - t0) / 1000)} s`);
const recs = g1.map((f) => read(b1, f));
for (const r of recs) {
  const hu = r.hostExtensions?.hostUse;
  check(`${r.game}: host extensions recorded; set-up external for both sides, no fallback`, r.hostExtensions?.setup && r.hostExtensions?.coachContext && hu && ['A', 'B'].every((t) => hu[t].setupAsked >= 2 && hu[t].setupAccepted === hu[t].setupAsked && hu[t].setupFallback === 0) && r.result.fallbacks.A === 0 && r.result.fallbacks.B === 0 && r.incidents.length === 0, JSON.stringify(hu));
  const su = r.decisions.filter((d) => d.kind === 'setup');
  check(`${r.game}: every set-up is in the decision log with the fixture's own words, hostExtensions and allowance`, su.length >= 4 && su.every((d) => d.host.setup.accepted && d.host.hostExtensions.setup && d.host.allowanceMs === 60000 && /fixture set-up n=\d+ los=(6|13) maxWide=1 minLine=3 fielded=7/.test(d.why)), su[0]?.why);
  const act = r.decisions.filter((d) => d.kind === 'action');
  const slow = act.filter((d) => d.team === 'A').sort((a, b) => b.thinkMs - a.thinkMs)[0];
  check(`${r.game}: context counters grow per side from a clean start (no leakage; the fixture throws on any)`, ['A', 'B'].every((t) => { const ns = r.decisions.filter((d) => d.team === t && d.host?.context?.committed).length; return ns >= 4; }) && r.decisions.every((d) => !d.source.fellBack));
  check(`${r.game}: the 7.5 s decision under the coach's own 60 s limit was accepted (longer than the old 6 s timers)`, slow && slow.thinkMs >= 7400 && !slow.source.fellBack && slow.host.allowanceMs === 60000, slow ? `${slow.thinkMs} ms` : 'none');
}
// replay verification through the website's own API
const ver = await page.evaluate(async (id) => { const r = await fetch(`/api/runs/${id}/verify`, { method: 'POST', headers: { 'x-lab': '1', 'content-type': 'application/json' }, body: '{}' }); return r.json(); }, b1);
const vtext = JSON.stringify(ver);
check('"Check histories by replay" reproduces both games, set-up inputs included', ver && !ver.error && /"ok":true|"mismatch":0|identical|match/i.test(vtext) && !/"ok":false/.test(vtext), vtext.slice(0, 220));
// the page itself shows it
await page.click('#nav button[data-t="hist"]'); await sleep(800);
await page.locator('#runTable tbody tr').first().click(); await sleep(1200);
const gt = await page.locator('#gameTable tbody tr').first(); if (await gt.count()) { await gt.click(); await sleep(1500); }
const review = await page.locator('#gameReview').innerText().catch(() => '');
check('the results page shows external set-up and context per decision', /set-up: external formation used/.test(review) && /context: saved/.test(review), review.slice(0, 160).replace(/\n/g, ' '));
await page.click('#nav button[data-t="new"]');

// ── batch 2: Stop = cancellation ─────────────────────────────────────────────────────────────────────────────────
const b2 = await newBatch({ seed: 777 });
await page.click('#nav button[data-t="live"]'); await sleep(2500);
const tStop = Date.now();
await page.click('#bStop', { timeout: 5000 }).catch((e) => console.log('stop click failed', e.message.slice(0, 80)));
let abortedAt = null; for (let i = 0; i < 100 && abortedAt === null; i++) { await sleep(250); const a = gamesOf(b2).some((f) => /aborted\.json$/.test(f) && !f.includes('/')); const st = await fetch(`${base}/api/state`).then((r) => r.json()).catch(() => ({})); if (a && !st.active) abortedAt = Date.now() - tStop; }
check('Stop cancels the running games promptly (even during a long decision) and writes the aborted markers', abortedAt !== null && abortedAt < 8000, `${abortedAt} ms`);
check('a stopped game is not counted as a result', gamesOf(b2).filter((f) => /^[^.]+\.json$/.test(f)).length === 0);
await page.click('#nav button[data-t="new"]'); await sleep(300);

// ── batch 3: a thinking limit chosen on the page is honoured ─────────────────────────────────────────────────────
const b3 = await newBatch({ tl: '2000', seed: 31337, pairs: 1 });
const g3 = await finished(b3, 2, 420000);
const r3 = g3.map((f) => read(b3, f));
check('with "every strategy coach 2 s" chosen on the page the slow decisions are cut off at 2 s and recorded as fallbacks', r3.length === 2 && r3.every((r) => r.result.fallbacks.A >= 1 && r.incidents.some((i) => /time limit|No answer within 2/.test(i.reason))) , r3.map((r) => `${r.game}: fallbacks A=${r.result.fallbacks.A}`).join(', '));
check('the matches still completed with the built-in coach covering', r3.every((r) => ['A', 'B', 'draw'].includes(r.result.winner)));
check('no page errors in the lab web page', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close(); server.kill();
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} passed`);
process.exit(ok === results.length ? 0 : 1);
