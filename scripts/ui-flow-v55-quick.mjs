// V5.5 interface flow — the four additions of 27 Sep 2026:
//  A. Sevens team builder: the Snotling Insignificant exception (11 players, 7 Insignificant) is labelled and legal;
//  B. Sevens Inducements in the team builder (the Spike! 22 list, prices, limits, money, "not on this list");
//  C. removing a player happens at once (no dialog) and ⌘Z / "↶ Undo" puts them back;
//  D. Quick Match: configure a preset (Sevens Tournament, a saved team with its skills and Inducements v the
//     computer), remembered across a restart, started with one click; the watch (computer v computer) preset;
//     a missing saved team stops the Quick Match instead of being replaced;
//  E. in the match: the Desperate Measures are rolled and shown; the plan panel offers them.
// Run after `node scripts/build.mjs`:  node scripts/ui-flow-v55-quick.mjs
import { open } from './ui-helpers.mjs';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const { browser, page, errors } = await open({ home: true, width: 1470, height: 920 });
page.on('pageerror', (e) => console.log('PAGE ERROR', e.stack));
const st = (fn, arg) => page.evaluate(fn, arg);
const sleep = (ms) => page.waitForTimeout(ms);
const t0 = Date.now();
async function waitFor(fn, arg, ms = 20000, step = 30) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await st(fn, arg);
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(step);
  }
}

// ------------------------------------------------------------------ A. Snotling Sevens team: the Insignificant exception
await st(() => {
  const app = window.bloodboard;
  const E = window.BloodboardEngine;
  const t = E.newTeamDef('tournament', 'snotling', 'NoNo', 'snot-quick', 'sevens');
  t.play = 'tournament';
  t.dedicatedFans = 0;
  t.tier = 4;
  let n = 1;
  for (const [pos, k] of [['lineman', 7], ['pumpWagon', 1], ['trainedTroll', 1], ['fungusFlinga', 1], ['stiltyRunna', 1]]) for (let i = 0; i < k; i++) t.players.push(E.playerFromRoster(E.ROSTER_BY_ID.snotling, pos, n, `snot-${n++}`));
  t.rerolls = 1;
  E.setVeteran(t, t.players[0].id);
  app.set({ screen: 'teams', teamKind: 'tournament', teamFormat: 'sevens', teamEdit: t, teamDirty: true, teamSel: null });
});
await sleep(300);
const snot = await st(() => ({ issues: [...document.querySelectorAll('.teameditor .issues li.bad')].map((l) => l.textContent), note: document.querySelector('#sevens-insignificant')?.textContent ?? '', ready: /Ready to play/.test(document.querySelector('.teamsummary')?.textContent ?? '') }));
check('A: 11 Snotlings (7 Insignificant) — no Insignificant error, ready to play', !snot.issues.some((t) => /Insignificant/.test(t)) && snot.ready, JSON.stringify(snot.issues));
check('A: the Sevens exception is labelled (NAF recommendation, not a GW erratum; this team uses it)', /Sevens exception: Insignificant ignored when drafting/.test(snot.note) && /NAF/.test(snot.note) && /not a Games Workshop erratum/.test(snot.note) && /This team uses it/.test(snot.note), snot.note.slice(0, 120));
await page.screenshot({ path: 'build/shots/v55-snotling-sevens.png', fullPage: false });

// ------------------------------------------------------------------ B. Sevens Inducements
const ind = await st(() => ({ rows: [...document.querySelectorAll('#team-inducements tr[data-inducement]')].map((r) => r.getAttribute('data-inducement')), label: document.querySelector('#team-inducements .section-label')?.textContent ?? '', link: document.querySelector('#team-inducements-link')?.textContent ?? '' }));
check('B: the Sevens team builder shows the Sevens Inducement list (11 items incl. Desperate Measures)', ind.rows.length === 11 && ind.rows.includes('desperateMeasure') && !ind.rows.includes('teamMascot') && /Spike! 22 p\.14/.test(ind.label), ind.rows.join(','));
check('B: a link in the team summary goes to the Inducements', /Inducements: 0 bought/.test(ind.link), ind.link);
await page.click('[data-inc="desperateMeasure"]');
await page.click('[data-inc="prayer"]');
await sleep(150);
const bought = await st(() => ({ money: document.querySelector('#inducement-money')?.textContent ?? '', ind: window.bloodboard.st.teamEdit.inducements, cost: window.BloodboardEngine.teamCost(window.bloodboard.st.teamEdit), link: document.querySelector('#team-inducements-link')?.textContent ?? '' }));
check('B: buying a Desperate Measure (50k) and a Prayer (5k) is counted in the budget', bought.ind.desperateMeasure === 1 && bought.ind.prayer === 1 && bought.cost.inducements === 55000 && /Spent on Inducements: 55,000 gp/.test(bought.money) && /2 bought \(55,000 gp\)/.test(bought.link), `${bought.money} | ${bought.link}`);
const notOffered = await st(() => document.querySelector('#inducements-not-offered')?.textContent ?? '');
check('B: what the Sevens list does not offer is explained as a rules restriction', /Team Mascot/.test(notOffered) && /Star Players/.test(notOffered) && /rules restriction/.test(notOffered) && !/not implemented yet/.test(notOffered));
const overLimit = await st(() => document.querySelector('[data-inc="prayer"]')?.disabled === false);
await page.click('[data-inc="prayer"]');
await sleep(80);
check('B: the limit is enforced (Prayers 0-2 in Sevens)', overLimit && (await st(() => document.querySelector('[data-inc="prayer"]').disabled)));
await page.click('[data-dec="prayer"]');
await sleep(80);
await page.screenshot({ path: 'build/shots/v55-sevens-inducements.png', fullPage: true });

// ------------------------------------------------------------------ C. remove a player: at once, with Undo
const before = await st(() => window.bloodboard.st.teamEdit.players.length);
await page.click('.teameditor button[title="Remove this player"]');
await sleep(150);
const afterRemove = await st(() => ({ n: window.bloodboard.st.teamEdit.players.length, modal: window.bloodboard.st.modal, undo: !!document.querySelector('#team-undo') }));
check('C: Remove deletes the player at once (no dialog)', afterRemove.n === before - 1 && !afterRemove.modal, JSON.stringify(afterRemove));
check('C: an Undo control appears', afterRemove.undo);
await page.keyboard.press('Control+z');
await sleep(150);
check('C: Ctrl+Z puts the player back', (await st(() => window.bloodboard.st.teamEdit.players.length)) === before);
await page.click('.teameditor button[title="Remove this player"]');
await sleep(100);
await page.click('#team-undo');
await sleep(100);
check('C: “↶ Undo” puts the player back too', (await st(() => window.bloodboard.st.teamEdit.players.length)) === before);
// A Tournament skill for #9 (Fungus Flinga) so the saved team carries a skill allocation.
await st(() => { const t = window.bloodboard.st.teamEdit; const p = t.players.find((q) => q.position === 'Fungus Flinga'); p.boughtSkill = 'sureHands'; window.bloodboard.st.teamDirty = true; window.bloodboard.emit(); });
await page.click('#save-team');
await sleep(400);
check('C: the team is saved', await st(() => !window.bloodboard.st.teamDirty));

// ------------------------------------------------------------------ D. Quick Match
await page.click('.brand');
await sleep(300);
check('D: the Home screen has a Quick Match card with “Configure Quick Match”', !!(await page.$('#quick-match')) && !!(await page.$('#quick-configure')));
const defaults = await st(() => [...document.querySelectorAll('#quick-preset option')].map((o) => o.textContent));
check('D: presets for playing the computer and for watching computer v computer', defaults.some((t) => /Play the computer/.test(t)) && defaults.some((t) => /Watch computer v computer/.test(t)), defaults.join(' | '));
await page.click('#quick-configure');
await sleep(300);
check('D: Configure opens the set-up screen on the preset', !!(await page.$('#quick-edit')) && !!(await page.$('#quick-name')));
await page.fill('#quick-name', 'My Snotlings v the computer');
await page.press('#quick-name', 'Tab');
await page.click('#setup-mode-tournament');
await sleep(150);
await page.click('#setup-format-sevens');
await sleep(150);
await page.click('#p1-controller-human');
await page.click('#p2-controller-computer');
await sleep(100);
await page.click('#p1-source-saved');
await sleep(150);
await page.selectOption('#p1-team', 'snot-quick');
await sleep(150);
await page.selectOption('#p2-ai', 'bloodboard-defensive');
await sleep(150);
const setupState = await st(() => { const s = JSON.parse(localStorage.getItem('bloodboard.setup.v2')); const p = s.quick.presets.find((x) => x.name === 'My Snotlings v the computer'); return p && { mode: p.mode, fmt: p.cfg.format, p1: p.cfg.p1, p2: p.cfg.p2 }; });
check('D: every choice is saved in the preset at once', setupState && setupState.mode === 'tournament' && setupState.fmt === 'sevens' && setupState.p1.source === 'saved' && setupState.p1.teamId === 'snot-quick' && setupState.p2.controller === 'computer' && setupState.p2.ai === 'bloodboard-defensive', JSON.stringify(setupState));
await page.click('#quick-done');
await sleep(300);
// Restart
await page.reload();
await sleep(500);
const home2 = await st(() => ({ sel: document.querySelector('#quick-preset')?.selectedOptions[0]?.textContent, summary: document.querySelector('#quick-summary')?.textContent ?? '' }));
check('D: after a restart the Quick Match preset is still chosen and shows what it starts', /My Snotlings v the computer/.test(home2.sel ?? '') && /Sevens/.test(home2.summary) && /NoNo/.test(home2.summary) && /Bloodboard AI — Defensive/.test(home2.summary), JSON.stringify(home2));
await page.click('#quick-match');
await sleep(600);
const m1 = await st(() => { const g = window.bloodboard.game; return { screen: window.bloodboard.st.screen, v: g.variant, a: g.teams.A.name, nA: g.players.filter((p) => p.team === 'A').length, skill: g.players.some((p) => p.team === 'A' && p.position === 'Fungus Flinga' && p.skills.some((k) => k.id === 'sureHands')), ind: g.match?.inducements?.A, coaches: g.match?.options.coaches, adv: window.bloodboard.st.computer.advisorAi }; });
check('D: one click starts the configured match (Sevens, the saved team with its 11 players)', m1.screen === 'board' && m1.v === 'sevens' && m1.a === 'NoNo' && m1.nA === 11, JSON.stringify(m1));
check('D: the saved team keeps its bought skill and its Inducements', m1.skill && m1.ind?.desperateMeasure === 1 && m1.ind?.prayer === 1, JSON.stringify(m1.ind));
check('D: Player 2 is the computer with the chosen AI file', !m1.coaches?.A && m1.coaches?.B?.ai === 'bloodboard-defensive', JSON.stringify(m1.coaches));

// ------------------------------------------------------------------ E. in the match: Desperate Measures
await st(() => { window.bloodboard.st.pauseDice = false; window.bloodboard.st.computer.speed = 'instant'; window.bloodboard.emit(); });
// Pre-game (the human presses it); answer the roll-off / Hangover decisions with the first option.
await st(() => window.bloodboard.runSimple({ kind: 'pregame' }));
for (let i = 0; i < 6; i++) {
  const done = await st(() => { const a = window.bloodboard; const p = a.game.pending; if (!p) return true; if (window.BloodboardEngine.coachOf(a.game, p.request.team)) return false; a.decide(p.request, p.request.options[0].id); return false; });
  if (done) break;
  await sleep(150);
}
await waitFor(() => !window.bloodboard.game.pending && window.bloodboard.game.phase !== 'pregame', null, 10000);
const dm = await st(() => ({ rolled: window.bloodboard.game.match.desperate, line: document.querySelector('#match-desperate')?.textContent ?? '' }));
check('E: the Desperate Measure is rolled in the pre-game and shown on the match card', dm.rolled?.A?.length === 1 && /Desperate Measures — NoNo: /.test(dm.line), JSON.stringify(dm));

// ------------------------------------------------------------------ D (cont.). watch preset; missing saved team
await page.click('.brand');
await sleep(300);
await page.selectOption('#quick-preset', 'watch-cvc');
await sleep(150);
await page.click('#quick-match');
await sleep(600);
const m2 = await st(() => { const g = window.bloodboard.game; return { v: g.variant, c: g.match?.options.coaches, card: document.querySelector('#computer-card h3')?.textContent ?? '' }; });
check('D: the watch preset starts a computer v computer match', m2.c?.A && m2.c?.B && /Computer v computer/.test(m2.card), JSON.stringify(m2));
await page.click('.brand');
await sleep(300);
await page.selectOption('#quick-preset', { label: 'My Snotlings v the computer' });
await sleep(100);
await st(async () => { await window.bloodboard.teamStore.remove('snot-quick'); });
await page.reload();
await sleep(600);
await page.click('#quick-match');
await sleep(500);
const blocked = await st(() => ({ screen: window.bloodboard.st.screen, edit: !!document.querySelector('#quick-edit'), err: document.querySelector('#setup-start-errors')?.textContent ?? '' }));
check('D: a Quick Match whose saved team is gone does not start with a replacement — it opens the preset with the reason', blocked.screen === 'newMatch' && blocked.edit && /nothing was replaced/.test(blocked.err) && /(no longer there|choose the saved team)/.test(blocked.err), JSON.stringify(blocked).slice(0, 300));
await page.screenshot({ path: 'build/shots/v55-quick-blocked.png' });

const bad = errors.filter((e) => !/favicon/.test(e));
check('no page errors', bad.length === 0, bad.slice(0, 3).join(' | '));
const fails = results.filter((r) => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} passed in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
await browser.close();
process.exit(fails.length ? 1 : 0);
