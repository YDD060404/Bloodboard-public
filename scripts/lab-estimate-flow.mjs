// V7-09 — the OPTIONAL live win-chance estimate in the Match Lab, through the REAL Lab server, runner and page (Chromium).
// Starts a one-game batch with the estimate switched on, checks that an estimate appears with its sample counts, intervals, policy, cost and the
// "not a calibrated probability" labelling, that at most one estimate child runs at a time, and that stopping the batch leaves no estimate process.
//   LAB_DIR=<match-lab folder (with the rebuilt runner)> PLAYWRIGHT_MODULE=… node scripts/lab-estimate-flow.mjs
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = pw.default ?? pw;
const SRC = process.env.LAB_DIR; if (!SRC) throw new Error('LAB_DIR is required');
const LAB = join(mkdtempSync(join(tmpdir(), 'lab-est-')), 'match-lab');
cpSync(SRC, LAB, { recursive: true, filter: (p) => !/\/(runs|exports)(\/|$)/.test(p) });
// A built-in-v-built-in game is over in under a minute while one continuation costs about as much as a whole game, so an estimate could never arrive before
// full time. The flow therefore plays the Platform Minimal example coach slowed down by 2.5 s per decision (a stand-in for a slow online coach), which is the
// situation the live estimate is meant for.
const slowSrc = readFileSync(join(process.cwd(), 'examples/ai/platform-minimal.js'), 'utf8').replace("id: 'platform-minimal'", "id: 'slow-minimal'").replace("async chooseAction(observation, offered, services) {", "async chooseAction(observation, offered, services) {\n    await new Promise((r) => setTimeout(r, 2500));");
writeFileSync(join(LAB, 'coaches', 'slow-minimal.js'), slowSrc);
const PORT = Number(process.env.LAB_PORT || 8793);
const results = [];
const check = (n, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ` — ${d}` : ''}`); };
const server = spawn(process.execPath, ['lab.mjs', 'window', '--no-open', '--port', String(PORT)], { cwd: LAB, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; server.stdout.on('data', (d) => (out += d)); server.stderr.on('data', (d) => (out += d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const estProcs = () => (spawnSync('pgrep', ['-fc', 'runner.mjs win-estimate'], { encoding: 'utf8' }).stdout.trim() || '0');
let up = false; for (let i = 0; i < 80 && !up; i++) { await sleep(250); up = await fetch(`http://127.0.0.1:${PORT}/api/state`).then((r) => r.ok, () => false); }
check('the Match Lab server started', up, out.slice(0, 160)); if (!up) { server.kill(); process.exit(1); }
const base = `http://127.0.0.1:${PORT}`;
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base); await sleep(600);
await page.click('#nav button[data-t="live"]');
// the settings form exposes the switch, off by default
await page.click('#nav button[data-t="new"]').catch(() => undefined);
await page.waitForSelector('#est-on', { state: 'attached' }); await sleep(300);
const offByDefault = await page.evaluate(() => { const e = document.getElementById('est-on'); return e ? !e.checked : null; });
check('the live estimate is OFF by default in the settings form', offByDefault === true, String(offByDefault));
await page.click('#nav button[data-t="live"]');
const slowKey = spawnSync(process.execPath, ['lab.mjs', 'coaches'], { cwd: LAB, encoding: 'utf8' }).stdout.split('\n').map((l) => l.split('\t')[0]).find((k) => /slow-minimal\.js$/.test(k));
check('the slowed example coach is visible to the Lab', !!slowKey, slowKey ?? '');
const settings = { format: 'sevens', mode: 'exhibition', rules: 'full', p1: slowKey, p2: slowKey, teamKind: 'fixed', team1: 'roster:draft:human', team2: 'roster:draft:orc', mirror: false, pool: [], seedKind: 'base', seedBase: 7, pairing: 'none', count: 1, observations: 'compact', features: true, maxSteps: 6000, lifecycle: 'preset', label: 'estimate flow', estimate: { samples: 4, everyTurns: 1 } };
const r = await fetch(`${base}/api/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lab': '1' }, body: JSON.stringify({ settings }) });
check('the batch was started through the Lab API with the estimate on (4 continuations, at every turn boundary)', r.ok, r.ok ? String(r.status) : `${r.status} ${(await r.text()).slice(0, 300)}`);
let panel = ''; let maxProcs = 0; let sawProc = false; let sawActive = false;
for (let i = 0; i < 1500; i++) {
  await sleep(1000);
  const n = Number(estProcs()); maxProcs = Math.max(maxProcs, n); if (n > 0) sawProc = true;
  const t = await page.locator('#liveGames').innerText().catch(() => '');
  if (/Win-chance estimate\s+after action/.test(t)) { panel = t; break; }
  const st = await fetch(`${base}/api/state`).then((x) => x.json()).catch(() => null);
  if (st?.run?.active) sawActive = true; else if (sawActive) break;
}
check('an estimate process ran while the game was being played', sawProc);
check('an estimate appeared on the Live tab while the game was still being played', !!panel, panel ? 'seen' : 'never appeared');
check('it shows Home / draw / away shares with intervals and the continuation count', /Home \d+% \(\d+–\d+%\) · draw \d+% \(\d+–\d+%\) · away \d+% \(\d+–\d+%\)/.test(panel) && /\d+ continuations/.test(panel), panel.replace(/\s+/g, ' ').slice(panel.indexOf('Win-chance'), panel.indexOf('Win-chance') + 260));
check('with only 4 samples it says plainly that there are too few to rely on', /too few to rely on/.test(panel));
check('the policy, the cost and the "not calibrated / not a prediction" labelling are shown', /both sides: built-in balanced coach/.test(panel) && /Cost: [\d.]+ s of background compute/.test(panel) && /Not a prediction about these coaches or a calibrated win probability/.test(panel));
check('at most ONE estimate process ran at any time', maxProcs <= 1, `max ${maxProcs}`);
await fetch(`${base}/api/control/stop`, { method: 'POST', headers: { 'X-Lab': '1' } });
await sleep(4000);
check('stopping the batch left no estimate process running', Number(estProcs()) === 0, estProcs());
check('no page errors', errors.length === 0, errors.slice(0, 2).join(' / '));
await browser.close(); server.kill();
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
