// V7-07 — drag-and-drop import through the game UI (Chromium, dist/web): histories, saved matches, AI parameter files and strategy modules,
// including refusals. The drop is a real DataTransfer with File objects dispatched on the window.
// (The Mac app's WKWebView drop handling and native AI-folder behaviour are NOT covered here: unverified.)
import { readFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { open } from './ui-helpers.mjs';
const results = [];
const check = (n, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ` — ${d}` : ''}`); };
const tmp = mkdtempSync(join(tmpdir(), 'bb-drop-'));
execFileSync(process.env.ESBUILD || 'node_modules/.bin/esbuild', ['src/engine/index.ts', '--bundle', '--platform=node', '--format=cjs', `--outfile=${tmp}/engine.cjs`, '--log-level=error']);
const { createRequire } = await import('node:module');
const E = createRequire(import.meta.url)(`${tmp}/engine.cjs`);
const saveText = readFileSync('tests/fixtures/real-matches/teams/Lizaer v Lizaer2.json', 'utf8');
const save = E.parseSaveFile(saveText).save;
const hist = E.toHistory(save.state, { source: 'game', initial: save.meta?.initial }).history;
const histText = E.serializeHistory(hist);
const bad = JSON.parse(histText); bad.result.score.B += 2;
const paramText = readFileSync('ai/bloodboard-balanced.json', 'utf8');
const moduleText = readFileSync('examples/ai/api-v2/minimal-coach-v2.js', 'utf8');

const { browser, page, errors } = await open({ home: true });
const sleep = (ms) => page.waitForTimeout(ms);
const drop = (files) => page.evaluate((fs) => {
  const dt = new DataTransfer();
  for (const f of fs) dt.items.add(new File([f.text], f.name, { type: 'application/octet-stream' }));
  for (const t of ['dragenter', 'dragover']) window.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
  const hinted = document.body.classList.contains('dropping');
  const ev = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
  window.dispatchEvent(ev);
  return { hinted, prevented: ev.defaultPrevented };
}, files);
const st = () => page.evaluate(() => ({ screen: window.bloodboard.st.screen, replay: !!window.bloodboard.st.replay, log: window.bloodboard.st.game.log.length }));
const toast = () => page.evaluate(() => [...document.querySelectorAll('.toast, .toasts *')].map((e) => e.textContent).join(' | '));

let r = await drop([{ name: 'match.history.json', text: histText }]); await sleep(900);
check('a drag over the window shows the drop hint and the drop does not navigate away', r.hinted && r.prevented);
let s = await st();
check('a dropped history opens in Replay (verified first)', s.screen === 'board' && s.replay, JSON.stringify(s));

await page.evaluate(() => window.bloodboard.set({ screen: 'home' })); await sleep(200);
await drop([{ name: 'tampered.history.json', text: JSON.stringify(bad) }]); await sleep(600);
s = await st();
check('a tampered history is refused and nothing opens', s.screen === 'home', (await toast()).slice(0, 140));

await drop([{ name: 'Lizaer v Lizaer2.json', text: saveText }]); await sleep(900);
s = await st();
check('a dropped saved match opens', s.screen === 'board', JSON.stringify(s));

await page.evaluate(() => window.bloodboard.set({ screen: 'home' })); await sleep(200);
await drop([{ name: 'dropped-balanced.json', text: paramText.replace(/"id"\s*:\s*"[^"]*"/, '"id": "dropped-balanced"').replace(/"name"\s*:\s*"[^"]*"/, '"name": "Dropped Balanced"') }, { name: 'dropped-minimal-v2.js', text: moduleText }]); await sleep(1800);
const stored = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('bloodboard.ai.v1') || '{}')));
check('dropped AI files (a parameter file and a strategy module) are stored', stored.includes('dropped-balanced.json') && stored.includes('dropped-minimal-v2.js'), stored.join(', '));
await page.click('#exhibition-setup'); await sleep(300); await page.click('#nm-cvc'); await sleep(200);
const opts = await page.evaluate(() => [...document.querySelectorAll('#p1-ai option')].map((o) => o.textContent));
check('both dropped coaches are selectable in the match set-up', opts.some((o) => /Dropped Balanced/.test(o)) && opts.some((o) => /minimal|Minimal/i.test(o)), opts.join(' | ').slice(0, 200));

await drop([{ name: 'notes.txt', text: 'hello' }, { name: 'random.json', text: '{"a":1}' }]); await sleep(400);
check('unknown files are refused with their names', /notes\.txt/.test(await toast()) && /random\.json/.test(await toast()), (await toast()).slice(0, 160));
const big = 'x'.repeat(1000);
await drop([{ name: 'bad name!.js', text: big }]); await sleep(300);
check('an unusable AI file name is refused', /not a usable AI file name/.test(await toast()), (await toast()).slice(0, 120));
check('no browser errors', errors.length === 0, errors.slice(0, 2).join(' / '));
await browser.close();
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
