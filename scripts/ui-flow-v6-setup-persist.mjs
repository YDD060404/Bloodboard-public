// V6 acceptance regression: match set-up state restoration (leave → reopen, reload, fresh and stale persisted values).
import { open } from './ui-helpers.mjs';
const results = [];
function check(name, ok, detail = '') { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); }
const { browser, page, errors } = await open({ home: true, width: 1470, height: 920 });
const sleep = (ms) => page.waitForTimeout(ms);
const st = (fn, a) => page.evaluate(fn, a);
const KEY = 'bloodboard.setup.v2';
const rendered = () => st(() => !!document.querySelector('#setup-p1') && !!document.querySelector('#setup-p2') && !!document.querySelector('#start-match') && document.querySelector('main, #app, body').innerText.length > 200);
const controlsValid = () => st(() => {
  const out = {};
  for (const k of ['p1', 'p2']) {
    const side = document.querySelector(`#setup-${k}`);
    const on = side && [...side.querySelectorAll('.segbtn.on')].map((b) => b.id);
    const roster = document.querySelector(`#${k}-roster`);
    out[k] = { on, roster: roster ? roster.value : null, rosterOptions: roster ? roster.options.length : 0 };
  }
  return out;
});
async function enter() { await page.click('.brand'); await sleep(200); await page.click('#exhibition-setup'); await sleep(300); }
async function leave() { await page.click('.brand'); await sleep(250); }
async function prep() { await page.click('#setup-format-sevens'); await sleep(100); await page.click('#p2-controller-computer'); await sleep(100); }

// 1. fresh / empty preferences
await st((k) => localStorage.removeItem(k), KEY);
await page.reload(); await sleep(500);
await enter();
check('fresh preferences: set-up renders', await rendered());
await prep();
// 2-6. AI chooses roster, leave, reopen
await page.click('#p2-source-ai'); await sleep(150);
await page.click('#p2-airoster-ai'); await sleep(200);
check('AI chooses roster: renders with a valid preview', await rendered() && await st(() => !!document.querySelector('#p2-summary')));
await leave(); await enter();
check('leave and reopen after "AI chooses roster": set-up still renders', await rendered());
let c = await controlsValid();
check('restored controls show AI Build + AI chooses (roster selector shows "AI chooses", not a concrete roster)', c.p2.on.includes('p2-source-ai') && c.p2.on.includes('p2-airoster-ai') && c.p2.roster === '', JSON.stringify(c.p2));
// reload the page (persisted state is read from storage)
await page.reload(); await sleep(500); await enter();
check('after a full reload the persisted AI-roster state renders', await rendered());
// 7-10. concrete roster + AI Build, leave, reopen, edit
await page.click('#p2-airoster-mine'); await sleep(150);
await page.selectOption('#p2-roster', 'lizardmen'); await sleep(150);
await leave(); await enter();
c = await controlsValid();
check('concrete roster + AI Build restored and editable', await rendered() && c.p2.roster === 'lizardmen' && c.p2.on.includes('p2-source-ai') && c.p2.on.includes('p2-airoster-mine'), JSON.stringify(c.p2));
await page.click('#p2-source-ready'); await sleep(150);
check('switching to Ready-made works after re-entry', await rendered() && (await controlsValid()).p2.on.includes('p2-source-ready'));
await page.click('#p2-source-saved'); await sleep(150);
check('Saved team source with no saved teams renders', await rendered());
await leave(); await enter();
check('saved source restored without blanking', await rendered());
await page.click('#p2-source-ai'); await sleep(100); await leave(); await enter();
// stale / invalid persisted values
const bad = [
  ['unknown roster id', { roster: 'nosuchroster' }],
  ['unknown source', { source: 'bogus' }],
  ['AI source on a human side', { source: 'ai', controller: 'human', aiRoster: true }],
  ['AI roster with garbage roster', { source: 'ai', aiRoster: true, roster: null, controller: 'computer' }],
  ['aiRoster non-boolean + stale rosterFilter', { source: 'ai', aiRoster: 'yes', rosterFilter: 'gone', controller: 'computer' }],
  ['AI source in league mode shape', { source: 'ai', teamId: 42, tier: 99, controller: 'computer' }],
];
for (const [name, patch] of bad) {
  await st(([k, p]) => { const s = JSON.parse(localStorage.getItem(k) || '{}'); s.modes = s.modes || {}; for (const m of ['exhibition', 'tournament', 'league']) { s.modes[m] = s.modes[m] || {}; s.modes[m].p1 = { ...(s.modes[m].p1 || {}), ...p }; s.modes[m].p2 = { ...(s.modes[m].p2 || {}), ...p }; } localStorage.setItem(k, JSON.stringify(s)); }, [KEY, patch]);
  await page.reload(); await sleep(500);
  let ok = true;
  for (const sel of ['#exhibition-setup']) { await page.click('.brand'); await sleep(200); await page.click(sel); await sleep(300); ok = ok && await rendered(); }
  check(`stale persisted value (${name}): set-up renders and is editable`, ok);
  if (ok) { await page.click('#p2-controller-computer').catch(() => {}); await sleep(100); ok = await rendered(); check(`  …and stays rendered after an edit`, ok); }
}
// Tournament (Matched Play) mode — the reported path: AI chooses roster, leave, reopen, both formats; then start
for (const fmt of ['sevens', 'standard']) {
  await page.click('.brand'); await sleep(200);
  await page.click('#tournament-setup'); await sleep(300);
  await page.click(`#setup-format-${fmt}`); await sleep(150);
  await page.click('#p2-controller-computer'); await sleep(100);
  await page.click('#p2-source-ai'); await sleep(150);
  await page.click('#p2-airoster-ai'); await sleep(250);
  check(`tournament ${fmt}: AI chooses roster renders with a team preview`, await rendered() && await st(() => !!document.querySelector('#p2-summary')));
  await leave(); await page.click('#tournament-setup'); await sleep(300);
  const tc = await controlsValid();
  check(`tournament ${fmt}: reopened, restored AI-chooses state is valid`, await rendered() && tc.p2.on.includes('p2-airoster-ai'), JSON.stringify(tc.p2));
  await page.click('#p2-airoster-mine'); await sleep(100); await page.selectOption('#p2-roster', 'lizardmen'); await sleep(150);
  await leave(); await page.click('#tournament-setup'); await sleep(300);
  check(`tournament ${fmt}: concrete roster + AI Build restored and editable`, await rendered() && (await controlsValid()).p2.roster === 'lizardmen');
  await page.click('#p2-airoster-ai'); await sleep(100);
}
await page.click('#start-match'); await sleep(2500);
check('a Tournament match starts with the AI choosing the roster', await st(() => !!window.bloodboard.game && !!window.bloodboard.game.match));
// other modes also render after the AI state
for (const sel of ['#tournament-setup', '#league-setup']) {
  await page.click('.brand'); await sleep(200);
  const has = await page.$(sel);
  if (!has) continue;
  await page.click(sel); await sleep(300);
  check(`${sel} renders with the stored state`, await st(() => !!document.querySelector('#setup-p1') || !!document.querySelector('.card')));
}
const errs = errors.filter((e) => !/favicon/.test(e));
check('no page errors during the whole flow', errs.length === 0, errs.slice(0, 3).join(' | '));
await browser.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
