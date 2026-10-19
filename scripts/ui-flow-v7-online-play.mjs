// V7: an online coach plays inside the WEB game (browser worker -> loopback bridge -> provider), through the normal set-up screen.
// Provider answers come from a deterministic stand-in (no network, no credentials) — this verifies the game-side path:
//  - coach installed from the Online coaches panel is selectable and recorded in the match,
//  - normal actions AND rule decisions (gen-2 object answers) are answered by the coach (decision log: via=module, no fallback),
//  - a provider outage falls back visibly with the provider's reason (not counted as a coach decision),
//  - taking control while the provider is thinking cancels the in-flight provider call (worker -> bridge -> provider).
// Run after `node scripts/build.mjs`:  node scripts/ui-flow-v7-online-play.mjs
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { open } from './ui-helpers.mjs';
import { createBridge, loadOrCreateCapability } from '../online/bridge.mjs';
import { ProviderError } from '../online/providers/errors.mjs';

const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
const state = mkdtempSync(join(tmpdir(), 'ui-play-'));
const ctl = { mode: 'ok', stats: { acts: 0, rules: 0, aborted: 0 }, hold: null };
const provider = { id: 'deepseek', name: 'DeepSeek', route: 'stand-in', concurrency: 4,
  async status() { return { id: 'deepseek', name: 'DeepSeek', route: 'api-key', configured: true, connected: true, keyStorage: 'keychain' }; },
  async listModels() { return [{ id: 'stand-in', name: 'stand-in' }]; }, async check() { return { ok: true }; },
  async complete({ messages, signal }) {
    if (ctl.mode === 'down') throw new ProviderError('provider_overloaded', 'overloaded', { retryable: true, status: 503 });
    if (ctl.mode === 'hang') await new Promise((res, rej) => { ctl.hold = true; signal.addEventListener('abort', () => { ctl.stats.aborted++; ctl.hold = false; rej(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true }); });
    const c = JSON.parse(messages[0].content); const rev = c.observation.revision;
    if (c.request) { ctl.stats.rules++; return { text: JSON.stringify({ type: 'rule', revision: rev, optionId: c.request.options[0].id, why: 'stand-in rule', plan: 'p' }), meta: {} }; }
    ctl.stats.acts++;
    const cand = c.offeredCandidates[0];
    return { text: JSON.stringify({ type: 'act', revision: rev, ...(cand ? { candidateId: cand.id } : { input: { kind: 'endTurn' } }), why: 'stand-in action', plan: 'p' }), meta: {} };
  } };
const capability = await loadOrCreateCapability(join(state, 'private'));
const bridge = createBridge({ providers: [provider], instructions: 'Return JSON.', capability, pairingCode: '11112222', port: 60557, aiDirs: [join(state, 'AI')], stateDir: state });
await bridge.listen();
const { browser, page, errors } = await open({ home: true, width: 1470, height: 920 });
page.on('pageerror', (e) => console.log('PAGE ERROR', e.stack));
const st = (fn, arg) => page.evaluate(fn, arg);
const sleep = (ms) => page.waitForTimeout(ms);
async function waitFor(fn, arg, ms = 60000, step = 50) { const end = Date.now() + ms; for (;;) { const v = await st(fn, arg); if (v) return v; if (Date.now() > end) return null; await sleep(step); } }

await page.click('#exhibition-setup'); await sleep(300);
await page.click('#nm-cvc'); await sleep(100);
await page.click('#setup-format-sevens').catch(() => {}); await sleep(100);
await page.click('#p1-ai-online'); await sleep(300);
await page.fill('#oc-code', '11112222'); await page.click('#oc-pair-go');
await waitFor(() => !!document.querySelector('#oc-deepseek-install:not([disabled])'), null, 8000);
await page.click('#oc-deepseek-install');
await waitFor(() => /Installed Online-DeepSeek/.test(document.querySelector('#oc-notice')?.textContent ?? ''), null, 8000);
await page.click('#oc-close'); await sleep(200);
const id = 'online-deepseek-stand-in';
await page.selectOption('#p1-ai', id); await sleep(100);
check('the installed online coach is selectable for Player 1', (await st(() => document.querySelector('#p1-ai')?.value)) === id);

// ── A. normal play with the coach: actions + rule decisions
await page.click('#start-match'); await sleep(300);
await st(() => { const a = window.bloodboard; a.st.computer.speed = 'instant'; a.st.pauseDice = false; a.emit(); });
const decided = await waitFor(() => (window.bloodboardDecisionLog ?? []).filter((d) => d.coach === 'online-deepseek-stand-in' && !d.fellBack && d.via !== 'builtin' && d.kind === 'action').length >= 12 && (window.bloodboardDecisionLog ?? []).some((d) => d.coach === 'online-deepseek-stand-in' && !d.fellBack && d.kind === 'decision' && /^decision:/.test(d.via)), null, 90000);
const log = await st(() => (window.bloodboardDecisionLog ?? []).filter((d) => d.coach === 'online-deepseek-stand-in'));
check('A: the coach answered turn actions and rule decisions through the bridge (rule answers via the gen-2 object path)', !!decided && ctl.stats.acts > 0 && ctl.stats.rules > 0, `acts ${ctl.stats.acts}, rules ${ctl.stats.rules}, logged ${log.length}`);
check('A: no fallback while the provider is healthy', log.every((d) => !d.fellBack), JSON.stringify(log.filter((d) => d.fellBack).slice(0, 1)));
const rec = await st(() => window.bloodboard.game.match.options.coaches?.A);
check('A: the match records the coach id/name/version', rec?.ai === id && /DeepSeek stand-in \(online\)/.test(rec.name ?? ''), JSON.stringify(rec));

// ── B. provider outage: visible fallback with the reason; not a model decision
await st(() => { window.bloodboardDecisionLog.length = 0; });
ctl.mode = 'down';
const fell = await waitFor(() => (window.bloodboardDecisionLog ?? []).some((d) => d.coach === 'online-deepseek-stand-in' && d.fellBack), null, 90000);
const fb = await st(() => (window.bloodboardDecisionLog ?? []).find((d) => d.coach === 'online-deepseek-stand-in' && d.fellBack));
check('B: an outage is a recorded fallback with the provider reason', !!fell && /provider_overloaded/.test(fb?.reason ?? ''), fb?.reason);
check('B: the fallback decision is attributed to the built-in algorithm, not the module', fb && fb.via === 'builtin', fb?.via);

// ── C. cancellation: take control while the provider is thinking
ctl.mode = 'hang';
await waitFor(() => true, null, 10);
const hung = await waitFor(() => 1, null, 5);
for (let i = 0; i < 400 && !ctl.hold; i++) await sleep(100);
check('C: a provider request is in flight', ctl.hold === true);
if (ctl.hold) {
  await page.click('#coaches-toggle').catch(() => {});
  await sleep(150);
  await page.click('#coach-A-human').catch(() => {});
  for (let i = 0; i < 80 && ctl.stats.aborted === 0; i++) await sleep(100);
  check('C: switching to the human coach aborted the in-flight provider call (worker -> bridge -> provider)', ctl.stats.aborted >= 1 && bridge.activeCount() === 0, `aborted ${ctl.stats.aborted}, active ${bridge.activeCount()}`);
}
const unexpected = errors.filter((e) => !/403 \(Forbidden\)|ERR_CONNECTION_REFUSED|503|502|409/.test(e));
check('no unexpected page errors', unexpected.length === 0, unexpected.slice(0, 2).join(' | '));
await bridge.close(); await browser.close();
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
