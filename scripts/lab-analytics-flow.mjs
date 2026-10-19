// V7-09 — Match Lab live "Match data" panel through the REAL Lab server and page (Chromium): starts a one-game batch, watches the Live tab,
// checks the measured counts update while the game is played and that NO win probability is shown (only the labelled absence).
//   LAB_DIR=<match-lab folder (with the rebuilt runner)> PLAYWRIGHT_MODULE=… node scripts/lab-analytics-flow.mjs
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = pw.default ?? pw;
const SRC = process.env.LAB_DIR; if (!SRC) throw new Error('LAB_DIR is required');
const LAB = join(mkdtempSync(join(tmpdir(), 'lab-ana-')), 'match-lab');
cpSync(SRC, LAB, { recursive: true, filter: (p) => !/\/(runs|exports)(\/|$)/.test(p) });
const PORT = Number(process.env.LAB_PORT || 8792);
const results = [];
const check = (n, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ` — ${d}` : ''}`); };
const server = spawn(process.execPath, ['lab.mjs', 'window', '--no-open', '--port', String(PORT)], { cwd: LAB, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; server.stdout.on('data', (d) => (out += d)); server.stderr.on('data', (d) => (out += d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let up = false; for (let i = 0; i < 80 && !up; i++) { await sleep(250); up = await fetch(`http://127.0.0.1:${PORT}/api/state`).then((r) => r.ok, () => false); }
check('the Match Lab server started', up, out.slice(0, 160)); if (!up) { server.kill(); process.exit(1); }
const base = `http://127.0.0.1:${PORT}`;
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base); await sleep(600);
await page.click('#nav button[data-t="live"]');
const settings = { format: 'sevens', mode: 'exhibition', rules: 'full', p1: 'builtin:balanced', p2: 'builtin:balanced', teamKind: 'fixed', team1: 'roster:draft:human', team2: 'roster:draft:orc', mirror: false, pool: [], seedKind: 'base', seedBase: 7, pairing: 'none', count: 1, observations: 'compact', features: true, maxSteps: 6000, lifecycle: 'preset', label: 'analytics flow' };
const r = await fetch(`${base}/api/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lab': '1' }, body: JSON.stringify({ settings }) });
check('the batch was started through the Lab API', r.ok, String(r.status));
const seen = [];
for (let i = 0; i < 240; i++) {
  await sleep(500);
  const t = await page.locator('#liveGames').innerText().catch(() => '');
  const m = /after (\d+) actions/.exec(t);
  if (m) seen.push({ n: Number(m[1]), t });
  const done = await fetch(`${base}/api/state`).then((x) => x.json()).then((s) => !s.run.active).catch(() => false);
  if (done && seen.length) break;
}
check('the Live tab showed the "Match data" panel with measured counts', seen.length > 0 && /Match data/.test(seen[0].t) && /Standing \/ prone \/ stunned/.test(seen[0].t));
const ns = seen.map((x) => x.n);
check('the counts grew while the game was played (basis actions increased)', ns.length > 1 && ns[ns.length - 1] > ns[0], `${ns[0]} → ${ns[ns.length - 1]} over ${ns.length} samples`);
const last = seen[seen.length - 1]?.t ?? '';
check('no win probability is shown; its absence is labelled', !/\d+\s*%\s*(win|chance)/i.test(last) && /No win-chance estimate for this game/.test(last) && !/Win-chance estimate<|Win-chance estimate /.test(last.replace(/No win-chance estimate/g,'')));
check('blocks, turnovers and touchdowns rows are present', /Blocks \+ blitzes/.test(last) && /Turnovers/.test(last) && /Touchdowns/.test(last));
check('no page errors', errors.length === 0, errors.slice(0, 2).join(' / '));
await browser.close(); server.kill();
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
