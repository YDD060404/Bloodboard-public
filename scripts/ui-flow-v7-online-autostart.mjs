// V7 COACH-03 — the app-launched bridge flow, with everything the native app does EXCEPT Swift: the REAL bridge is started as a child
// process with the exact arguments native/BridgeLauncher.swift uses, its startup line is parsed, the page receives the injection the
// launcher would send (window.__bloodboardBridge), and the panel pairs by itself. Then the "app" exits (stdin closed) and the bridge must stop.
// This does NOT verify the Swift code, Node discovery on a Mac, WKWebView, or real providers.
// Run after `node scripts/build.mjs`:  PLAYWRIGHT_MODULE=… node scripts/ui-flow-v7-online-autostart.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { open } from './ui-helpers.mjs';
import { STARTUP_PREFIX, pidAlive } from '../online/lifecycle.mjs';

const results = [];
const check = (n, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ` — ${d}` : ''}`); };
const dir = mkdtempSync(join(tmpdir(), 'bb-autostart-'));
const child = spawn(process.execPath, ['online/bridge.mjs', 'serve', '--json', '--auto-port', '--exit-on-stdin-close', '--port', '0', '--parent-pid', String(process.pid), '--dir', dir], { stdio: ['pipe', 'pipe', 'pipe'] });
let out = ''; const exited = new Promise((r) => child.on('exit', (c) => r(c)));
const info = await new Promise((resolve, reject) => { child.stdout.on('data', (d) => { out += d; const l = out.split('\n').find((x) => x.startsWith(STARTUP_PREFIX)); if (l) resolve(JSON.parse(l.slice(STARTUP_PREFIX.length))); }); child.on('exit', () => reject(new Error('bridge exited early'))); });
check('the bridge started as the app would start it and printed its ready line', info.port > 0 && /^\d{8}$/.test(info.pairingCode));

const { browser, page, errors } = await open({ home: true });
const sleep = (ms) => page.waitForTimeout(ms);
// the very string the Swift launcher evaluates (BridgeLauncher.injection)
await page.evaluate(`window.__bloodboardBridge = {port: ${info.port}, pairingCode: "${info.pairingCode}", version: "${info.version}"}; window.dispatchEvent(new Event('bloodboard-bridge'));`);
await page.click('#exhibition-setup'); await sleep(300);
await page.click('#nm-cvc'); await sleep(150);
await page.click('#p1-ai-online'); await sleep(2000);
const dbg = null;
const html = await page.evaluate(() => document.body.innerText);
check('the panel paired by itself (no pairing-code entry shown)', !(await page.locator('#oc-code').count()), dbg ? JSON.stringify(dbg) : '');
check('both providers are listed with separate status', /DeepSeek/.test(html) && /Luna/.test(html));
check('the user is told it paired automatically', /paired automatically/i.test(html));
const leaked = await page.evaluate(() => JSON.stringify(window.__bloodboardBridge ?? {}));
check('the one-time pairing code is dropped from the page after use', !leaked.includes(info.pairingCode), leaked);
const stored = await page.evaluate(() => { try { return JSON.stringify(Object.entries(localStorage)); } catch { return ''; } });
check('the pairing code is not stored in the page', !stored.includes(info.pairingCode));

// the app quits: stdin closes -> the bridge stops by itself
child.stdin.end();
const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r('timeout'), 5000))]);
check('closing the app pipe stops the bridge (exit 0)', code === 0, String(code));
check('the bridge process is gone', !pidAlive(info.pid));
await sleep(4500);
check('the panel reports the stopped bridge honestly', /not reachable|stopped|unreachable/i.test(await page.evaluate(() => document.body.innerText)));
check('no unexpected browser errors', errors.filter((e) => !/ERR_CONNECTION_REFUSED|Failed to fetch|Failed to load resource/.test(e)).length === 0, errors.slice(0, 2).join(' / '));
await browser.close();
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
