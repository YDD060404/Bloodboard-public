// V6 acceptance regression: the roster the user selects is the roster that plays (checked on the real GameState), unless "AI chooses roster" is on.
import { open } from './ui-helpers.mjs';
const results = [];
function check(name, ok, detail = '') { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); }
// An external coach WITHOUT chooseRoster; its buildTeam records which roster the host asked it to build.
const CODE = `bloodboard.register({ id: 'build-only', name: 'Build Only', apiVersion: 2, apiMinor: 0, version: '1.0', timeLimitMs: 3000, capabilities: { buildTeam: true, playTurn: true },
  buildTeam(obs, req) { return { team: JSON.parse(JSON.stringify(req.builtinTeam)), why: 'built:' + req.rosterId }; },
  chooseAction(o, c) { return { candidateId: c.length ? c[0].id : undefined, endTurn: !c.length }; } });`;
const { browser, page, errors } = await open({ home: true, width: 1470, height: 920 });
const sleep = (ms) => page.waitForTimeout(ms);
const st = (fn, a) => page.evaluate(fn, a);
await st((c) => { window.BLOODBOARD_BUNDLED_AI = [...window.BLOODBOARD_BUNDLED_AI, { name: 'build-only.js', text: c }]; }, CODE);
await st(() => window.bloodboardAI.reload()); await sleep(700);
check('the build-only coach (no chooseRoster) is listed', await st(() => !!window.bloodboardAI.list().find((c) => c.id === 'build-only' && !c.errors)));
const KEY = 'bloodboard.setup.v2';
const roster = (side) => st((s) => window.bloodboard.game && window.bloodboard.game.teams[s].rosterId, side);
const ui = () => st(() => ({ roster: document.querySelector('#p2-roster')?.value, on: [...document.querySelectorAll('#setup-p2 .segbtn.on')].map((b) => b.id) }));
async function enter() { await page.click('.brand'); await sleep(200); await page.click('#exhibition-setup'); await sleep(300); }
async function base() { await enter(); await page.click('#setup-format-sevens'); await sleep(100); await page.click('#p1-controller-human'); await page.click('#p2-controller-computer'); await sleep(100); await page.selectOption('#p2-ai', 'build-only'); await sleep(100); }
async function start() { await st(() => { window.bloodboardLifecycle = undefined; window.bloodboard.game = window.bloodboard.game; }); await page.click('#start-match'); for (let i = 0; i < 40; i++) { await sleep(250); if (await st(() => !!window.bloodboard.game?.match)) break; } await sleep(300); }
async function reset() { await st((k) => localStorage.removeItem(k), KEY); await page.reload(); await sleep(500); await st((c) => { window.BLOODBOARD_BUNDLED_AI = [...window.BLOODBOARD_BUNDLED_AI, { name: 'build-only.js', text: c }]; }, CODE); await st(() => window.bloodboardAI.reload()); await sleep(600); }

// A. manual roster with the team source "ready-made" and with "AI Build" — human, lizardmen, darkElf
for (const src of ['ready', 'ai']) {
  for (const id of ['human', 'lizardmen', 'darkElf']) {
    await reset(); await base();
    if (src === 'ai') { await page.click('#p2-source-ai'); await sleep(100); }
    await page.selectOption('#p2-roster', id); await sleep(150);
    await start();
    const r = await roster('B');
    check(`${src === 'ai' ? 'AI Build' : 'ready-made'} + manual ${id}: the match team's rosterId is ${id}`, r === id, `actual ${r}`);
    if (src === 'ai') { const rep = await st(() => window.bloodboardLifecycle?.[0]?.reports ?? []); check(`  roster report absent (no AI roster stage) and the builder received exactly ${id}`, !rep.some((x) => x.stage === 'roster') && rep.find((x) => x.stage === 'build')?.via === 'coach' && rep.find((x) => x.stage === 'build')?.why === `built:${id}`, JSON.stringify(rep.map((x) => [x.stage, x.via, x.why]))); }
  }
}
// B. "AI chooses roster" is allowed to choose; the coach has no chooseRoster → documented built-in fallback, reported as such
await reset(); await base();
await page.click('#p2-source-ai'); await page.click('#p2-airoster-ai'); await sleep(150);
let u = await ui();
check('AI chooses roster: the selector shows "AI chooses" (not a concrete roster) and the toggle is on', u.roster === '' && u.on.includes('p2-airoster-ai'), JSON.stringify(u));
await start();
let rep = await st(() => window.bloodboardLifecycle?.[0]?.reports ?? []);
const rr = rep.find((x) => x.stage === 'roster');
check('AI chooses roster: a roster stage ran with the built-in chooser (coach has no chooseRoster) and the team follows it', rr && rr.via === 'builtin' && !rr.fellBack && (await roster('B')) && rep.find((x) => x.stage === 'build'), JSON.stringify(rep.map((x) => [x.stage, x.via])));
// C. AI chooses, then a manual concrete roster: the mode flips to "My choice", visibly, and the roster is authoritative
await reset(); await base();
await page.click('#p2-source-ai'); await page.click('#p2-airoster-ai'); await sleep(150);
await page.selectOption('#p2-roster', 'lizardmen'); await sleep(200);
u = await ui();
check('AI chooses → manual roster: the toggle visibly switches to "My choice" and the selector shows Lizardmen', u.roster === 'lizardmen' && u.on.includes('p2-airoster-mine') && !u.on.includes('p2-airoster-ai'), JSON.stringify(u));
const stored = await st((k) => JSON.parse(localStorage.getItem(k)).modes.exhibition.p2, KEY);
check('the persisted state agrees (roster lizardmen, aiRoster false, source ai)', stored.roster === 'lizardmen' && stored.aiRoster === false && stored.source === 'ai', JSON.stringify(stored));
await page.reload(); await sleep(500);
await st((c) => { window.BLOODBOARD_BUNDLED_AI = [...window.BLOODBOARD_BUNDLED_AI, { name: 'build-only.js', text: c }]; }, CODE); await st(() => window.bloodboardAI.reload()); await sleep(600);
await enter(); u = await ui();
check('after a reload the restored state is still "My choice" + Lizardmen', u.roster === 'lizardmen' && u.on.includes('p2-airoster-mine'), JSON.stringify(u));
await start();
check('…and the match team is Lizardmen (reloaded, persisted state)', (await roster('B')) === 'lizardmen', `actual ${await roster('B')}`);
rep = await st(() => window.bloodboardLifecycle?.[0]?.reports ?? []);
check('…with no roster stage and the builder asked for lizardmen', !rep.some((x) => x.stage === 'roster') && rep.find((x) => x.stage === 'build')?.why === 'built:lizardmen', JSON.stringify(rep.map((x) => [x.stage, x.why])));
// D. a stale persisted aiRoster flag on a non-AI source never overrides the roster
await st((k) => { const s = JSON.parse(localStorage.getItem(k)); s.modes.exhibition.p2 = { ...s.modes.exhibition.p2, source: 'ready', aiRoster: true, roster: 'human' }; localStorage.setItem(k, JSON.stringify(s)); }, KEY);
await page.reload(); await sleep(500);
await st((c) => { window.BLOODBOARD_BUNDLED_AI = [...window.BLOODBOARD_BUNDLED_AI, { name: 'build-only.js', text: c }]; }, CODE); await st(() => window.bloodboardAI.reload()); await sleep(600);
await enter(); await start();
check('stale aiRoster flag with source ready: the match team is Human', (await roster('B')) === 'human', `actual ${await roster('B')}`);
const bad = errors.filter((e) => !/favicon/.test(e));
check('no page errors', bad.length === 0, bad.slice(0, 3).join(' | '));
await browser.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
