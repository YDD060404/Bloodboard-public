// V5.6 interface flow — a coach with its own 60 s limit that thinks for several seconds and reports progress:
//  the AI list shows the module (timeLimitMs 60000 accepted, not clamped away); while it is still calculating, the match's
//  computer card shows a progress panel (elapsed time against the coach's own limit, what it is evaluating, what it ruled
//  out, the best line so far); the panel disappears when the coach answers; its answer is used (no fallback notice).
// Run after `node scripts/build.mjs`:  PLAYWRIGHT_MODULE=… node scripts/ui-flow-v56-progress.mjs
import { open } from './ui-helpers.mjs';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const MODULE = `
let first = true;
bloodboard.register({
  id: 'slow-thinker', name: 'Slow Thinker', apiVersion: 1, apiMinor: 2, version: '1.0', timeLimitMs: 60000,
  description: 'Test module: thinks for about 5 s on its first decision and reports progress, then answers at once.',
  async chooseAction(obs, cands, sv) {
    if (first) {
      first = false;
      const t0 = Date.now();
      await sv.progress({ stage: 'options', headline: 'Comparing ' + cands.length + ' options.', evaluating: [cands[0].label], best: { label: cands[0].label, pTurnover: cands[0].pTurnover || 0 } });
      while (Date.now() - t0 < 2000) await sv.plan(cands[0].input);
      await sv.progress({ stage: 'reply', headline: 'Checked the opponent reply.', ruledOut: ['Every move with a higher Turnover chance'], best: { label: cands[0].label, pTurnover: 0.05, detail: 'keeps the carrier covered' } });
      await new Promise((r) => setTimeout(r, 3500));
    }
    return { candidateId: cands[0].id, why: 'SLOWTHINKER done' };
  },
});
`;
const { browser, page, errors } = await open({ home: true, width: 1470, height: 920 });
const st = (fn, arg) => page.evaluate(fn, arg);
const sleep = (ms) => page.waitForTimeout(ms);
async function waitFor(fn, arg, ms = 30000, step = 100) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await st(fn, arg);
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(step);
  }
}
await st((code) => { window.BLOODBOARD_BUNDLED_AI = [...window.BLOODBOARD_BUNDLED_AI, { name: 'slow-thinker.js', text: code }]; }, MODULE);
await st(() => window.bloodboardAI.reload());
await sleep(700);
const listed = await st(() => window.bloodboardAI.list().find((c) => c.id === 'slow-thinker'));
check('the 60 s module is listed without errors', listed && listed.kind === 'strategy' && !listed.errors, JSON.stringify(listed));
await page.click('#exhibition-setup');
await sleep(400);
await page.click('#setup-format-sevens').catch(() => {});
await page.click('#p1-controller-computer');
await page.click('#p2-controller-computer');
await sleep(200);
await page.selectOption('#p1-ai', 'slow-thinker');
await page.selectOption('#p2-ai', 'bloodboard-balanced');
await sleep(150);
await page.click('#start-match');
const panel = await waitFor(() => { const e = document.querySelector('#computer-progress'); return e ? e.textContent : null; }, null, 25000, 150);
check('a progress panel appears while the coach is still calculating', !!panel, panel ? panel.slice(0, 160) : 'none');
check('it shows the coach\'s own limit (60 s) against the elapsed time', panel && /of up to 60 s/.test(panel), panel ? panel.slice(0, 120) : '');
const full = await waitFor(() => { const e = document.querySelector('#computer-progress'); return e && /Ruled out/.test(e.textContent) ? e.textContent : null; }, null, 15000, 200);
check('it lists what is being evaluated, what was ruled out and the best line so far', full && /Evaluating|Comparing/.test(full) && /Ruled out:/.test(full) && /Best so far:/.test(full) && /keeps the carrier covered/.test(full), full ? full.slice(0, 300) : 'none');
const gone = await waitFor(() => !document.querySelector('#computer-progress'), null, 20000, 200);
check('the panel goes away when the coach has answered', !!gone);
const answered = await waitFor(() => (window.bloodboard.st.computer.records || []).some((r) => /SLOWTHINKER done/.test(r.text)), null, 20000, 200);
const toast = await st(() => document.querySelector('.toast')?.textContent ?? '');
check('its answer was used (no fallback notice)', answered && !/decided this one/.test(toast), toast.slice(0, 120));
const bad = errors.filter((e) => !/favicon/.test(e));
check('no page errors', bad.length === 0, bad.slice(0, 3).join(' | '));
await browser.close();
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} passed`);
process.exit(ok === results.length ? 0 : 1);
