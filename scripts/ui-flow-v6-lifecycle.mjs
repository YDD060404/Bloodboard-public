// V6 — roster-first match creation with "AI Build for this match" in the real game UI (Chromium against dist/web).
// Run after the build:  PLAYWRIGHT_MODULE=... node scripts/ui-flow-v6-lifecycle.mjs
import { readFileSync } from 'node:fs';
import { open } from './ui-helpers.mjs';
const results = [];
function check(name, ok, detail = '') { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); }
const BUILDER = readFileSync('examples/ai/api-v2/team-builder-example.js', 'utf8');
const { browser, page, errors } = await open({ home: true, width: 1470, height: 920 });
const st = (fn, arg) => page.evaluate(fn, arg);
const sleep = (ms) => page.waitForTimeout(ms);
await st((a) => { window.BLOODBOARD_BUNDLED_AI = [...window.BLOODBOARD_BUNDLED_AI, { name: 'team-builder-example.js', text: a }]; }, BUILDER);
await st(() => window.bloodboardAI.reload()); await sleep(700);
const listed = await st(() => window.bloodboardAI.list().find((c) => c.id === 'team-builder-v2'));
check('the v2 builder coach is listed with its lifecycle capabilities', listed && !listed.errors, JSON.stringify(listed && [listed.id, listed.errors]));

async function setup(p2ai, fmt = 'sevens') {
  await page.click('.brand'); await sleep(200);
  await page.click('#exhibition-setup'); await sleep(300);
  await page.click(`#setup-format-${fmt}`); await sleep(150);
  await page.click('#p1-controller-human'); await page.click('#p2-controller-computer'); await sleep(150);
  await page.selectOption('#p2-ai', p2ai); await sleep(150);
}
// ── A: the roster row comes before the team source; AI Build is offered to computer sides only ────────────────────
await setup('team-builder-v2');
const order = await st(() => { const ids = [...document.querySelectorAll('#setup-p2 [id]')].map((e) => e.id); return ids.indexOf('p2-roster') < ids.indexOf('p2-source') && ids.includes('p2-source-ai') && !document.querySelector('#p1-source-ai'); });
check('roster-first order: the roster row precedes the team source; AI Build is only offered to the computer side', order);
await page.click('#p2-source-ai'); await sleep(150);
check('choosing AI Build shows the built-in baseline preview and explains the fallback', await st(() => /AI Build/.test(document.querySelector('#p2-notes')?.textContent || '') && !!document.querySelector('#p2-summary')));
await page.click('#p2-airoster-ai'); await sleep(150);
// ── B: start: the AI chooses the roster, builds the team, the engine validates, the match starts ──────────────────
await page.selectOption('#setup-seedmode', 'fixed').catch(() => {}); 
await page.click('#start-match'); await sleep(1500);
let g = null;
for (let i = 0; i < 40 && !g; i++) { g = await st(() => { const G = window.bloodboard.game; return G ? { phase: G.phase, teams: ['A', 'B'].map((t) => ({ roster: G.teams[t].rosterId, name: G.teams[t].name, players: G.players.filter((p) => p.team === t).length })) } : null; }); if (!g) await sleep(300); }
check('the match started from the lifecycle', !!g, JSON.stringify(g));
const lc = await st(() => window.bloodboardLifecycle);
const rep = lc && lc[0] && lc[0].reports;
check('a roster report and a build report exist for the AI side', rep && rep.some((r) => r.stage === 'roster') && rep.some((r) => r.stage === 'build'), JSON.stringify(rep && rep.map((r) => [r.stage, r.via, r.fellBack, r.attempts])));
check('the coach chose the roster (Lizardmen) and the build was corrected or accepted by the engine', rep && rep.find((r) => r.stage === 'roster')?.via === 'coach' && g && g.teams[1].roster === 'lizardmen' && rep.find((r) => r.stage === 'build').attempts >= 1, JSON.stringify(g && g.teams));
check('both teams have a legal Sevens squad size (the engine validated the build)', g && g.teams.every((x) => x.players >= 3 && x.players <= 12));
// ── C: a coach without a builder (built-in baseline) still starts, with no fallback flag ───────────────────────────
await setup('bloodboard-balanced', 'sevens');
await page.click('#p2-source-ai'); await sleep(150);
await page.click('#start-match'); await sleep(1500);
const lc2 = await st(() => window.bloodboardLifecycle);
const rep2 = lc2 && lc2[0] && lc2[0].reports;
check('a coach without lifecycle hooks starts through the built-in builder (not a fallback)', rep2 && rep2.every((r) => r.via === 'builtin' && !r.fellBack) && await st(() => !!window.bloodboard.game), JSON.stringify(rep2 && rep2.map((r) => [r.stage, r.via, r.fellBack])));
const bad = errors.filter((e) => !/favicon/.test(e));
check('no page errors', bad.length === 0, bad.slice(0, 3).join(' | '));
await browser.close();
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} passed`);
process.exit(ok === results.length ? 0 : 1);
