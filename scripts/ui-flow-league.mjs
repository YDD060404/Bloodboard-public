// V4 League post-game and advancement through the interface (run after `node scripts/build.mjs`):
//   a League match at full time shows the Star Player Points earned, each coach nominates and rolls for
//   the MVP, "Add the SPP to the saved teams" updates the saved teams once, and the team editor's
//   "Advance" dialog spends SPP: a chosen Primary skill, a random Primary skill (dice kept until chosen,
//   not re-rolled by reopening), and a Characteristic Improvement (D8).
import { open, drainTray } from './ui-helpers.mjs';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const st = (page, fn, arg) => page.evaluate(fn, arg);
const sleep = (page, ms) => page.waitForTimeout(ms);
const stored = (page, id) => st(page, async (tid) => JSON.parse(await window.bloodboard.teamStore.load(tid)), id);

const { browser, page, errors } = await open({ home: true });
await st(page, () => { for (const k of Object.keys(localStorage)) if (/team/i.test(k)) localStorage.removeItem(k); });
await page.reload();
await sleep(page, 400);

// ------------------------------------------------------------ two League teams, a match played to full time
await page.click('#mode-league');
await sleep(page, 250);
await page.getByRole('button', { name: 'Add two starter teams' }).click();
await sleep(page, 500);
const teams = await st(page, async () => {
  const list = await window.bloodboard.teamStore.list();
  const out = [];
  for (const it of list) out.push(JSON.parse(await window.bloodboard.teamStore.load(it.name)));
  return out.filter((t) => t.kind === 'league').map((t) => ({ id: t.id, name: t.name, n: t.players.length }));
});
check('two League starter teams are saved', teams.length === 2, JSON.stringify(teams));

// Play the match in the page with the engine (End Turn only), then give A's first two players some SPP as if earned.
await st(page, async (ids) => {
  const E = window.BloodboardEngine;
  const a = JSON.parse(await window.bloodboard.teamStore.load(ids[0]));
  const b = JSON.parse(await window.bloodboard.teamStore.load(ids[1]));
  const r = E.createMatch('league', a, b, { rules: 'introductory' }, 20260926);
  let s = r.state;
  const answer = (res) => {
    let g = 0;
    while (res.status === 'awaitingDecision' && g++ < 80) res = E.decide(res.state, { requestId: res.decision.id, optionId: res.decision.options[0].id });
    return res;
  };
  for (let i = 0; s.phase !== 'fullTime' && i < 400; i++) {
    const m = s.match;
    let input;
    if (s.phase === 'pregame') input = { kind: 'pregame' };
    else if (s.phase === 'driveSetup') {
      const t = m.setupDone[m.kicking] ? (m.kicking === 'A' ? 'B' : 'A') : m.kicking;
      input = { kind: 'setupTeam', team: t, positions: E.defaultFormation(s, t) };
    } else if (s.phase === 'kickoff' && m.pendingPhase?.type === 'solidDefence') input = { kind: 'solidDefence', positions: {} };
    else if (s.phase === 'kickoff' && m.pendingPhase?.type === 'quickSnap') input = { kind: 'quickSnap', moves: {} };
    else if (s.phase === 'kickoff') {
      const k = m.kicking;
      const kicker = s.players.find((q) => q.team === k && q.location === 'pitch' && q.pos && q.pos.x !== (k === 'A' ? 12 : 13));
      input = { kind: 'kickoff', kicker: kicker.id, target: { x: k === 'A' ? 20 : 5, y: 7 } };
    } else if (s.phase === 'play' && m.pendingPhase?.type === 'charge') input = { kind: 'endCharge' };
    else if (s.phase === 'play') input = { kind: 'endTurn' };
    else input = { kind: 'nextDrive' };
    s = answer(E.execute(s, input)).state;
  }
  const played = E.mvpEligible(s, 'A');
  s.match.spp = { ...(s.match.spp ?? {}), [played[0].id]: { touchdown: 2 }, [played[1].id]: { casualty: 1, completion: 1 } };
  window.bloodboard.openBoard(s, { kind: 'match', matchKind: 'league' }, { docName: 'League check' });
}, teams.map((t) => t.id));
await sleep(page, 300);

const shot = async (name) => { if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` }); };
await shot('league-fulltime');
const phase = await st(page, () => window.bloodboard.game.phase);
check('the League match reached full time', phase === 'fullTime', phase);
const tableA = await page.locator('#spp-A').innerText().catch(() => '');
check('the full-time card lists the Star Player Points earned', /Touchdown/.test(tableA) && /\b6\b/.test(tableA) && /Casualty, Completion|Completion, Casualty|Casualty/.test(tableA), tableA.replace(/\s+/g, ' ').slice(0, 160));
check('…and an MVP roll for each team; Add SPP waits for both', (await page.locator('#mvp-roll-A').count()) === 1 && (await page.locator('#mvp-roll-B').count()) === 1 && (await page.locator('#spp-apply').isDisabled()));
const boxes = await page.locator('.mvpnominate').first().locator('input[type=checkbox]');
const nChecked = await st(page, () => [...document.querySelectorAll('.mvpnominate')][0].querySelectorAll('input:checked').length);
check('six players who played are nominated by default (the coach can change them)', nChecked === 6 && (await boxes.count()) >= 11, `${nChecked} of ${await boxes.count()}`);
// Change the nomination: untick the last one.
await st(page, () => { const b = [...document.querySelectorAll('.mvpnominate')][0].querySelectorAll('input:checked'); b[b.length - 1].click(); });
await sleep(page, 100);
const nominees = await st(page, () => [...document.querySelectorAll('.mvpnominate')][0].querySelectorAll('input:checked').length);
check('unticking a nominee leaves five', nominees === 5);
await page.click('#mvp-roll-A');
await sleep(page, 200);
await drainTray(page);
await page.click('#mvp-roll-B');
await sleep(page, 200);
await drainTray(page);
const mvp = await st(page, () => ({ ...window.bloodboard.game.match.mvp }));
check('both MVPs are rolled by the engine and shown', !!mvp.A && !!mvp.B && (await page.locator('#mvp-done-A').count()) === 1, JSON.stringify(mvp));
const log = await st(page, () => window.bloodboard.game.log.map((l) => l.events.map((e) => e.text).join(' | ')).join('\n'));
check('the MVP roll is in the action log (D6, 4 SPP)', /MVP roll: \d/.test(log) && /earns 4 SPP \(Most Valuable Player\)/.test(log));
const before = await stored(page, teams[0].id);
await page.click('#spp-apply');
await sleep(page, 500);
const after = await stored(page, teams[0].id);
const earned = await st(page, () => Object.fromEntries(window.BloodboardEngine.postGameSpp(window.bloodboard.game, 'A').map((r) => [r.defId, r.total])));
const ok = Object.entries(earned).every(([defId, n]) => (after.players.find((p) => p.id === defId)?.spp ?? 0) === (before.players.find((p) => p.id === defId)?.spp ?? 0) + n);
check('“Add the SPP” adds each player’s SPP to the saved team', ok && Object.keys(earned).length >= 2, JSON.stringify(earned));
check('…and the card says so (no second button)', (await page.locator('#spp-applied').count()) === 1 && (await page.locator('#spp-apply').count()) === 0);
// Undo the MVP roll and try to add again: the team remembers the match.
await st(page, async () => { const E = window.BloodboardEngine; const g = window.bloodboard.game; const x = E.cloneState(g); x.match.sppApplied = {}; window.bloodboard.st.game = x; window.bloodboard.emit(); });
await sleep(page, 150);
if (await page.locator('#spp-apply').count()) await page.click('#spp-apply');
await sleep(page, 400);
const again = await stored(page, teams[0].id);
check('adding the same match again changes nothing (the saved team remembers the match)', JSON.stringify(again.players.map((p) => p.spp)) === JSON.stringify(after.players.map((p) => p.spp)));

// ------------------------------------------------------------ Advance in the team editor
await st(page, () => window.bloodboard.set({ screen: 'teams', teamKind: 'league', teamEdit: null }));
await sleep(page, 300);
await page.getByRole('button', { name: teams[0].name }).first().click();
await sleep(page, 300);
const top = after.players.slice().sort((a, b) => (b.spp ?? 0) - (a.spp ?? 0))[0];
const btn = page.locator(`[data-advance="${top.id}"]`);
check('a player with SPP has an Advance button (players without enough SPP have none)', (await btn.count()) === 1 && !(await btn.isDisabled()) && (await page.locator('[data-advance]').count()) < after.players.length, `${top.name} ${top.spp} SPP`);
await btn.click();
await sleep(page, 200);
await shot('league-advance');
const dlg = await page.locator('.modal').innerText();
check('the Advance dialog shows SPP, costs from the Advancement Table and the categories', new RegExp(`${top.spp} SPP`).test(dlg) && /Choose a Primary Skill\s*6 SPP/.test(dlg) && /Randomly select a Primary Skill\s*3 SPP/.test(dlg), dlg.replace(/\s+/g, ' ').slice(0, 200));
// Chosen Primary skill: the first General skill offered.
const skillId = await st(page, () => document.querySelector('#adv-primary-skill')?.value);
await page.locator('#adv-primary button').click();
await sleep(page, 400);
const t1 = await stored(page, teams[0].id);
const p1 = t1.players.find((p) => p.id === top.id);
check('Take: the skill is added, 6 SPP spent, the advancement recorded and saved', p1.skills.some((s) => s.id === skillId) && p1.spp === top.spp - 6 && p1.advancements?.length === 1 && p1.advancements[0].kind === 'primary', JSON.stringify({ skills: p1.skills.map((s) => s.id), spp: p1.spp, adv: p1.advancements?.length }));
// Random Primary: needs 4 SPP for a second advancement — give 20 SPP through the (flexible) SPP field of the League editor.
await st(page, (id) => { const t = window.bloodboard.st.teamEdit; t.players.find((p) => p.id === id).spp = 20; window.bloodboard.st.teamDirty = true; window.bloodboard.emit(); }, top.id);
await sleep(page, 100);
await page.click('#save-team');
await sleep(page, 300);
await page.locator(`[data-advance="${top.id}"]`).click();
await sleep(page, 200);
await page.locator('#adv-random button').first().click();
await sleep(page, 400);
await shot('league-random');
const choices1 = await page.locator('#adv-choices button').allInnerTexts();
const pend = (await stored(page, teams[0].id)).players.find((p) => p.id === top.id).pendingAdvance;
check('Random Primary: two rolled skills to choose from; the dice are saved with the player', choices1.length >= 1 && pend?.kind === 'randomPrimary' && pend.rolls.length >= 2, JSON.stringify({ choices1, rolls: pend?.rolls }));
await page.getByRole('button', { name: 'Close' }).click();
await sleep(page, 150);
await page.locator(`[data-advance="${top.id}"]`).click();
await sleep(page, 200);
const choices2 = await page.locator('#adv-choices button').allInnerTexts();
check('closing and reopening the dialog shows the same roll (no second chance)', JSON.stringify(choices1) === JSON.stringify(choices2));
await page.locator('#adv-choices button').first().click();
await sleep(page, 400);
const p2 = (await stored(page, teams[0].id)).players.find((p) => p.id === top.id);
check('taking a rolled skill: 4 SPP (second advancement), no roll left pending', p2.spp === 16 && p2.advancements.length === 2 && !p2.pendingAdvance, JSON.stringify({ spp: p2.spp, n: p2.advancements.length }));
// Characteristic Improvement: 20 SPP for the third one; 16 left → give 20 again.
await st(page, (id) => { const t = window.bloodboard.st.teamEdit; t.players.find((p) => p.id === id).spp = 20; window.bloodboard.st.teamDirty = true; window.bloodboard.emit(); }, top.id);
await sleep(page, 100);
await page.click('#save-team');
await sleep(page, 300);
const must = await page.locator(`[data-advance="${top.id}"]`).innerText();
check('with enough SPP for a Characteristic Improvement the button says the player must advance', /Advance!/.test(must), must);
await page.locator(`[data-advance="${top.id}"]`).click();
await sleep(page, 200);
await page.click('#adv-d8');
await sleep(page, 400);
const d8 = (await stored(page, teams[0].id)).players.find((p) => p.id === top.id).pendingAdvance;
const charBtns = await page.locator('#adv-chars button').count();
check('Roll D8: the result is saved and the allowed characteristics are offered', d8?.kind === 'characteristic' && d8.d8 >= 1 && d8.d8 <= 8 && charBtns >= 1, JSON.stringify({ d8, charBtns }));
const ch = await page.locator('#adv-chars button').first().getAttribute('data-char');
const beforeChar = (await stored(page, teams[0].id)).players.find((p) => p.id === top.id);
await page.locator('#adv-chars button').first().click();
await sleep(page, 400);
const p3 = (await stored(page, teams[0].id)).players.find((p) => p.id === top.id);
const delta = ch === 'ag' || ch === 'pa' ? beforeChar[ch] - p3[ch] : p3[ch] - beforeChar[ch];
check('the characteristic is improved by 1 and 20 SPP are spent', delta === 1 && p3.spp === 0 && p3.advancements.length === 3 && p3.advancements[2].char === ch, JSON.stringify({ ch, delta, spp: p3.spp }));

check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} League checks passed`);
process.exit(failed.length ? 1 : 0);
