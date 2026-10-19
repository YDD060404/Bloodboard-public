// V7.0.1 — the game and the Match Lab each show the exact build they run, and both agree with the shipped fingerprint file.
//   LAB_DIR=<match-lab folder with the rebuilt runner> PLAYWRIGHT_MODULE=… node scripts/build-line-flow.mjs
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { open } from './ui-helpers.mjs';
const results = [];
const check = (n, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ` — ${d}` : ''}`); };
const fp = JSON.parse(/BUILD_FINGERPRINT = (\{[\s\S]*?\}) as const/.exec(readFileSync('src/engine/fingerprint.ts', 'utf8'))[1]);
const want = `Build ${fp.version} · engine ${fp.engineHash.slice(0, 12)} · rules ${fp.rulesHash.slice(0, 12)} · API ${fp.apiHash.slice(0, 12)}`;
const { browser, page } = await open({ home: true });
const gameLine = await page.locator('#build-line').innerText().catch(() => '');
check('the game home screen shows the build line', gameLine === want, gameLine);
await browser.close();
const SRC = process.env.LAB_DIR; if (!SRC) throw new Error('LAB_DIR is required');
const LAB = join(mkdtempSync(join(tmpdir(), 'lab-build-')), 'match-lab');
cpSync(SRC, LAB, { recursive: true, filter: (p) => !/\/(runs|exports)(\/|$)/.test(p) });
const PORT = Number(process.env.LAB_PORT || 8795);
const server = spawn(process.execPath, ['lab.mjs', 'window', '--no-open', '--port', String(PORT)], { cwd: LAB, stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let up = false; for (let i = 0; i < 80 && !up; i++) { await sleep(250); up = await fetch(`http://127.0.0.1:${PORT}/api/state`).then((r) => r.ok, () => false); }
check('the Match Lab server started', up); if (!up) { server.kill(); process.exit(1); }
const b = await fetch(`http://127.0.0.1:${PORT}/api/build`).then((r) => r.json());
check('the Lab runner reports the same engine, rules and API hashes as the game', b.fingerprint?.engineHash === fp.engineHash && b.fingerprint?.rulesHash === fp.rulesHash && b.fingerprint?.apiHash === fp.apiHash && b.fingerprint?.version === fp.version, JSON.stringify(b.fingerprint)?.slice(0, 120));
check('the Lab runner enforces the 120 s decision ceiling', b.maxDecisionMs === 120000, String(b.maxDecisionMs));
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright'); const { chromium } = pw.default ?? pw;
const br = await chromium.launch(); const pg = await br.newPage(); await pg.goto(`http://127.0.0.1:${PORT}`); await sleep(800);
const labLine = await pg.locator('#buildLine').innerText().catch(() => '');
check('the Lab page shows the build line with the same hashes', labLine.includes(`engine ${fp.engineHash.slice(0, 12)}`) && labLine.includes(`rules ${fp.rulesHash.slice(0, 12)}`) && labLine.includes('max decision 120 s'), labLine);
await br.close(); server.kill();
console.log(`${results.filter(Boolean).length}/${results.length} passed`); process.exit(results.every(Boolean) ? 0 : 1);
