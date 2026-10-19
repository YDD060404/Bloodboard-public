// V7 interface flow — the "Online coaches" panel against a REAL local bridge (loopback) with the real DeepSeek and Luna provider
// adapters whose network/sign-in layers are replaced by deterministic fakes (no network, no credentials, nothing stored outside a temp dir).
//  A. unpaired: the panel says the bridge is needed / asks for the pairing code; a wrong code is refused
//  B. pairing with the printed code; both providers appear with separate status
//  C. DeepSeek: key entry -> field cleared, key never in page storage/DOM, status "stored", models discovered, connection check, install
//  D. Luna: sign-in starts, authorization link shown, signed-in status after completion, models from the account, install
//  E. installed coaches appear in the AI list for the match set-up; files are byte-identical in BOTH folders
//  F. bridge stopped -> the panel reports it honestly (no silent state)
// Run after `node scripts/build.mjs`:  node scripts/ui-flow-v7-online.mjs
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { open } from './ui-helpers.mjs';
import { createBridge, loadOrCreateCapability } from '../online/bridge.mjs';
import { createDeepSeekProvider } from '../online/providers/deepseek.mjs';
import { createLunaProvider } from '../online/providers/luna.mjs';
import { createSecretStore } from '../online/store.mjs';

const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
const KEY = 'sk-ui-flow-SECRET-4242';
const fakeEnc = { id: 'fake', isAvailable: () => true, encrypt: (t) => Buffer.from('E' + Buffer.from(t).toString('base64')), decrypt: (b) => Buffer.from(Buffer.from(b).toString().slice(1), 'base64').toString() };
const state = mkdtempSync(join(tmpdir(), 'ui-online-')); const aiA = join(state, 'AI-V6'); const aiB = join(state, 'AI-Workshop');
const secrets = createSecretStore({ dir: join(state, 'private'), encryption: fakeEnc });
const seen = [];
const deepseek = createDeepSeekProvider({ secrets, fetchImpl: async (url, init) => { seen.push({ url, auth: init.headers.Authorization }); if (url.endsWith('/models')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'ds-fast', name: 'DS Fast' }, { id: 'ds-pro' }] }), text: async () => '' }; return { ok: false, status: 400, text: async () => '' }; } });
let lunaConnected = false;
const luna = createLunaProvider({ encryption: fakeEnc, storageDir: join(state, 'private'), createChatGPT: (cfg) => ({
  getSession: async () => ({ status: lunaConnected ? 'connected' : 'disconnected', sharing: lunaConnected, profileLabel: 'Connection 1', identity: { email: 'tester@example.test' } }),
  listModels: async () => [{ slug: 'luna-a', displayName: 'Luna A' }], streamResponse: async () => ({ text: '{}' }),
  signIn: async () => { await cfg.openBrowser('https://auth.example.test/authorize?flow=ui'); await new Promise((r) => setTimeout(r, 600)); lunaConnected = true; return {}; },
  cancelSignIn: () => {}, disconnect: async () => { lunaConnected = false; } }) });
const capability = await loadOrCreateCapability(join(state, 'private'));
const bridge = createBridge({ providers: [deepseek, luna], instructions: 'Return JSON.', capability, pairingCode: '24681357', port: 60557, aiDirs: [aiA, aiB], stateDir: state });
await bridge.listen();

const { browser, page, errors } = await open({ home: true, width: 1470, height: 920 });
page.on('pageerror', (e) => console.log('PAGE ERROR', e.stack));
const sleep = (ms) => page.waitForTimeout(ms);
const text = (sel) => page.evaluate((s) => document.querySelector(s)?.textContent ?? '', sel);
async function waitText(sel, re, ms = 8000) { const end = Date.now() + ms; for (;;) { const t = await text(sel); if (re.test(t)) return t; if (Date.now() > end) return t; await sleep(100); } }

await page.click('#exhibition-setup'); await sleep(300);
await page.click('#nm-cvc'); await sleep(150);
await page.click('#p1-ai-online'); await sleep(400);
check('A: the Online coaches panel opens from the AI set-up', await page.$('#oc-pair') !== null);
await page.fill('#oc-code', '00000000'); await page.click('#oc-pair-go');
check('A: a wrong pairing code is refused', /not accepted/.test(await waitText('#oc-error', /not accepted/)));
await page.fill('#oc-code', '24681357'); await page.click('#oc-pair-go');
await waitText('#oc-deepseek-status', /No API key/);
check('B: after pairing both providers show separate status', (await text('#oc-deepseek-status')).includes('No API key') && (await text('#oc-luna-status')).includes('Not signed in'));
const stored = await page.evaluate(() => localStorage.getItem('bloodboard.onlineBridge.v1') ?? '');
check('B: page storage holds only the local pairing capability', stored.includes(capability) && !stored.includes('sk-'));

await page.fill('#oc-deepseek-key', KEY); await page.click('#oc-deepseek-save');
await waitText('#oc-deepseek-status', /Key stored/);
check('C: the key is stored by the bridge (encrypted store) and the status says so', /Key stored \(macOS Keychain\)/.test(await text('#oc-deepseek-status')));
const leak = await page.evaluate((k) => ({ dom: document.documentElement.innerHTML.includes(k), ls: JSON.stringify(localStorage).includes(k), input: document.querySelector('#oc-deepseek-key')?.value ?? '' }), KEY);
check('C: the key is nowhere in the page DOM or storage and the field is cleared', !leak.dom && !leak.ls && leak.input === '', JSON.stringify({ ...leak }));
const modelOpts = await page.evaluate(() => [...document.querySelectorAll('#oc-deepseek-model option')].map((o) => o.value));
check('C: models come from the provider discovery (GET /models), none hard-coded', JSON.stringify(modelOpts) === JSON.stringify(['ds-fast', 'ds-pro']) && seen.some((s) => s.url === 'https://api.deepseek.com/models' && s.auth === `Bearer ${KEY}`), modelOpts.join(','));
await page.click('#oc-deepseek-check'); await waitText('#oc-notice', /connection OK/);
check('C: connection check reports OK', /connection OK/.test(await text('#oc-notice')));
await page.selectOption('#oc-deepseek-model', 'ds-pro');
await page.click('#oc-deepseek-install'); await waitText('#oc-notice', /Installed Online-DeepSeek/);
check('C/E: install reports file name and SHA-256 prefix', /Installed Online-DeepSeek-ds-pro-.*SHA-256 [0-9a-f]{12}/.test(await text('#oc-notice')), (await text('#oc-notice')).slice(0, 140));

await page.click('#oc-luna-signin');
let link = '';
for (let i = 0; i < 30 && !link; i++) { link = await page.evaluate(() => document.querySelector('#oc-luna a')?.getAttribute('href') ?? ''); if (!link) await sleep(100); }
check('D: sign-in shows the authorization link', /^https:\/\/auth\.example\.test\//.test(link) || /Signed in/.test(await text('#oc-luna-status')), link);
await waitText('#oc-luna-status', /Signed in as tester@example\.test/, 12000);
check('D: signed-in status names the subscription route (no API key)', /Signed in as tester@example\.test\. Subscription route; no API key\./.test(await text('#oc-luna-status')), await text('#oc-luna-status'));
check('D: Luna models come from the account', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('#oc-luna-model option')].map((o) => o.value))) === '["luna-a"]');
await page.click('#oc-luna-install'); await waitText('#oc-notice', /Installed Online-ChatGPT-Luna/);
check('D/E: the Luna coach is installed', /Installed Online-ChatGPT-Luna-luna-a/.test(await text('#oc-notice')));

const fa = readdirSync(aiA).sort(), fb = readdirSync(aiB).sort();
check('E: both AI folders hold the same two coaches, byte-identical', JSON.stringify(fa) === JSON.stringify(fb) && fa.length === 2 && fa.every((n) => readFileSync(join(aiA, n)).equals(readFileSync(join(aiB, n)))), fa.join(', '));
check('E: no provider key in any installed file', fa.every((n) => !readFileSync(join(aiA, n), 'utf8').includes('sk-ui-flow')));
await page.click('#oc-close'); await sleep(200);
const aiOpts = await page.evaluate(() => [...document.querySelectorAll('#p1-ai option')].map((o) => o.textContent));
check('E: installed coaches are offered wherever a coach is chosen', aiOpts.some((t) => /DeepSeek ds-pro \(online\)/.test(t)) && aiOpts.some((t) => /ChatGPT Luna luna-a \(online\)/.test(t)), aiOpts.join(' | ').slice(0, 200));

await bridge.close();
await page.click('#p1-ai-online'); await sleep(5200);
check('F: with the bridge stopped the panel says so honestly', /not reachable|not running/.test(await page.evaluate(() => document.querySelector('.modal')?.textContent ?? '')));
const unexpected = errors.filter((e) => !/403 \(Forbidden\)|ERR_CONNECTION_REFUSED/.test(e));
check('no unexpected page errors (the refused wrong code and the stopped bridge are expected network errors)', unexpected.length === 0, unexpected.slice(0, 2).join(' | '));
await browser.close();
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
