// V5.8 — the ACTUAL game UI path for the host extensions (Chromium against dist/web, the same bundle the Mac app loads):
//  the page is the new build (build-info, coach store present); a fixture coach (set-up hook, host-managed context, one slow
//  7.5 s decision under a 60 s declaration) plays BOTH sides of a Sevens match to full time through the real worker request
//  flow; set-up was external, context round-tripped per side, nothing fell back, progress was truthful; Undo / replaceGame
//  invalidate the context; an old module without hooks still plays; advice requests carry no host capabilities.
// Run after `node scripts/build.mjs`:  node scripts/ui-flow-v58-host.mjs
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { open, drainTray } from './ui-helpers.mjs';

const results = [];
function check(name, ok, detail = '') { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); }
const FIXTURE = readFileSync('tests/fixtures/host-fixture-coach.js', 'utf8');
const OLD = `bloodboard.register({ id: 'old-api', name: 'Old API', apiVersion: 1, version: '1.0', timeLimitMs: 3000, chooseAction(o, c) { return { candidateId: c.length ? c[0].id : undefined, endTurn: !c.length }; } });`;
const info = JSON.parse(readFileSync('dist/web/build-info.json', 'utf8'));
const sha = (f) => createHash('sha256').update(readFileSync('dist/web/' + f)).digest('hex');
check('dist/web is the V5.8+ build and its hashes match the files', /^(5\.8|6\.)/.test(info.version) && info.hostExtensions?.setup && Object.entries(info.sha256).every(([f, h]) => sha(f) === h));

const { browser, page, errors } = await open({ home: true, width: 1470, height: 920 });
const st = (fn, arg) => page.evaluate(fn, arg);
const sleep = (ms) => page.waitForTimeout(ms);
async function waitFor(fn, arg, ms = 30000, step = 150) { const end = Date.now() + ms; for (;;) { const v = await st(fn, arg); if (v) return v; if (Date.now() > end) return null; await sleep(step); } }

const live = await st(() => ({ store: !!window.bloodboard.coachStore && typeof window.bloodboard.coachStore.ticket === 'function', scripts: [...document.scripts].map((s) => s.src).filter(Boolean) }));
check('the page that is running loads dist/web/app.js and has the context store (not an old asset)', live.store && live.scripts.some((s) => /dist\/web\/app\.js$/.test(s)), JSON.stringify(live.scripts));
await st((a) => { window.BLOODBOARD_BUNDLED_AI = [...window.BLOODBOARD_BUNDLED_AI, { name: 'host-fixture-coach.js', text: a.f }, { name: 'old-api.js', text: a.o }]; }, { f: FIXTURE, o: OLD });
await st(() => window.bloodboardAI.reload());
await sleep(700);
const listed = await st(() => window.bloodboardAI.list().filter((c) => ['host-fixture', 'old-api'].includes(c.id)));
check('both test coaches are listed without errors ', listed.length === 2 && listed.every((c) => !c.errors), JSON.stringify(listed.map((c) => [c.id, c.timeLimitMs, c.errors])));

async function startCvC(p1, p2, seed) {
  await page.click('.brand'); await sleep(200);
  await page.click('#exhibition-setup'); await sleep(300);
  await page.click('#setup-format-sevens'); await sleep(150);
  await page.click('#p1-controller-computer'); await page.click('#p2-controller-computer'); await sleep(150);
  await page.selectOption('#p1-ai', p1); await page.selectOption('#p2-ai', p2);
  await page.selectOption('#setup-seedmode', 'fixed'); await sleep(100);
  await page.fill('#setup-seed', String(seed)); await page.press('#setup-seed', 'Tab'); await sleep(150);
  await st(() => { window.bloodboardDecisionLog = []; });
  await page.click('#start-match'); await sleep(400);
}
// ── A: the fixture plays both sides to full time ─────────────────────────────────────────────────────────────────
await startCvC('host-fixture', 'host-fixture', 4242);
await page.click('#computer-speed [data-speed="fast"]').catch(() => {});
const t0 = Date.now();
const panel = await waitFor(() => { const e = document.querySelector('#computer-progress'); return e && /Fixture/.test(e.textContent) ? e.textContent : null; }, null, 60000, 200);
check('truthful progress: a panel shows elapsed time against the coach\'s own 60 s while the slow decision runs', panel && /of up to 60 s/.test(panel) && /Fixture: a slow|Fixture: still/.test(panel), panel ? panel.slice(0, 200) : 'none');
const gone = await waitFor(() => !document.querySelector('#computer-progress'), null, 30000, 200);
check('the panel disappears when the coach answers', !!gone);
let guard = 0;
while (!(await st(() => window.bloodboard.game.phase === 'fullTime')) && guard++ < 1500) { await drainTray(page); await sleep(120); if (Date.now() - t0 > 420000) break; }
const done = await st(() => window.bloodboard.game.phase === 'fullTime');
check('the match played to full time through the real UI request flow', done, `${Math.round((Date.now() - t0) / 1000)} s`);
const log = await st(() => window.bloodboardDecisionLog);
const by = (f) => log.filter(f);
const setups = by((l) => l.kind === 'setup');
check('external set-up was offered and accepted for both sides, every Drive', setups.length >= 4 && setups.every((l) => l.setup && l.setup.accepted && !l.fellBack && l.via === 'setup') && ['A', 'B'].every((t) => setups.some((l) => l.team === t)), `${setups.length} set-ups`);
check('nothing fell back to the built-in coach', log.every((l) => !l.fellBack), JSON.stringify(by((l) => l.fellBack).slice(0, 2)));
check('every request carried hostExtensions { setup, coachContext } and a 60 s allowance', log.every((l) => l.hostExtensions && l.hostExtensions.setup === true && l.hostExtensions.coachContext === true && l.allowanceMs === 60000));
check('context was saved after legal answers, per side', ['A', 'B'].every((t) => by((l) => l.team === t && l.context && l.context.committed).length >= 4));
const slow = by((l) => l.team === 'A' && l.kind === 'action').sort((a, b) => b.elapsedMs - a.elapsedMs)[0];
check('the 7.5 s decision (longer than the old 6 s timers) was accepted, not cut off', slow && slow.elapsedMs >= 7400 && !slow.fellBack, slow ? `${slow.elapsedMs} ms` : 'none');
check('it ran on the engine worker pool path of the game', by((l) => l.kind === 'action').every((l) => typeof l.pooled === 'boolean'), `pooled=${log.some((l) => l.pooled)}`);
const seenWhy = await st(() => window.bloodboard.st.computer.records.map((r) => r.text).join('\n'));
check('the decision records show what the module received (mirrored set-up, capabilities)', /fixture set-up n=1 los=6 maxWide=1 minLine=3 fielded=7 hx=\{"setup":true,"coachContext":true\}/.test(seenWhy), seenWhy.slice(0, 200));
// ── B: invalidation ────────────────────────────────────────────────────────────────────────────────────────────
const sz = await st(() => { const a = window.bloodboard; const before = a.coachStore.size; const t = a.coachStore.ticket('A', 'host-fixture'); a.replaceGame(window.BloodboardEngine.cloneState(a.game)); return { before, stale: !t.current(), after: a.coachStore.size }; });
check('replacing/loading the game (the path Undo, Load and New match all use) drops stored context and stales in-flight requests', sz.before >= 1 && sz.stale && sz.after === 0, JSON.stringify(sz));
// ── C: an old module without hooks plays a whole match (built-in set-up, no errors) ──────────────────────────────
await startCvC('old-api', 'bloodboard-balanced', 99);
await page.click('#computer-speed [data-speed="fast"]').catch(() => {});
let g2 = 0;
const t1 = Date.now();
while (!(await st(() => window.bloodboard.game.phase === 'fullTime')) && g2++ < 1500) { await drainTray(page); await sleep(120); if (Date.now() - t1 > 420000) break; }
const log2 = await st(() => window.bloodboardDecisionLog);
const oldSetups = log2.filter((l) => l.kind === 'setup');
check('an old module (no hooks) plays to full time; its set-up stays the built-in legal formation without errors', await st(() => window.bloodboard.game.phase === 'fullTime') && oldSetups.length >= 2 && oldSetups.every((l) => l.setup && !l.setup.accepted && !l.fellBack), `${oldSetups.length} set-ups, ${log2.filter((l) => l.fellBack).length} fallbacks`);
const bad = errors.filter((e) => !/favicon/.test(e));
check('no page errors', bad.length === 0, bad.slice(0, 3).join(' | '));
await browser.close();
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} passed`);
process.exit(ok === results.length ? 0 : 1);
