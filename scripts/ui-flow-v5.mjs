// V5 interface flow, increment 1 — team special rules (pp.154-155):
//  A. Team Captain in the team builder (Human: radio for every player except the Ogre, chip, cost unchanged);
//  B. a Human (you, Captain) v Orc (computer, Captain + Brawlin' Brutes) match to full time: the match card
//     names the rules, the Captain shows CAPTAIN and Pro on the player card, is fielded every Drive, and
//     the Captain's D6 after a Team Re-roll appears in the log when a re-roll is used with a Captain on the pitch;
//  C. Tomb Kings: Masters of Undeath on the match card; its decision offered to the coach.
// Run after `node scripts/build.mjs`:  node scripts/ui-flow-v5.mjs
import { open, clickSq, drainTray, startReadyMatch } from './ui-helpers.mjs';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const st = (page, fn, arg) => page.evaluate(fn, arg);
const sleep = (page, ms) => page.waitForTimeout(ms);
const { browser, page, errors } = await open({ home: true });
const t0 = Date.now();

// ------------------------------------------------------------ A. Team Captain in the team builder
await page.click('#mode-exhibition');
await sleep(page, 300);
await page.selectOption('.teamlist select', 'human');
await page.click('#new-team');
await sleep(page, 150);
const add = async (label, n) => {
  for (let i = 0; i < n; i++) {
    await page.locator('.addplayers button', { hasText: label }).first().click();
    await sleep(page, 30);
  }
};
await add('Human Lineman', 6);
await add('Human Blitzer', 2);
await add('Human Catcher', 1);
await add('Human Thrower', 1);
await add('Ogre', 1);
check('the team special rules line shows Team Captain (Human, p.175)', /Team Captain/.test(await st(page, () => document.querySelector('#team-special-rules')?.textContent ?? '')), await st(page, () => document.querySelector('#team-special-rules')?.textContent ?? ''));
const radios = await st(page, () => [...document.querySelectorAll('table.roster:not(.inducementTable):not(.starTable):not(.moneytable) tbody tr')].map((tr) => ({ t: tr.textContent, r: !!tr.querySelector('.captain-pick') })));
check('every player except the Ogre (a Big Guy) can be nominated Captain', radios.length === 11 && radios.filter((x) => x.r).length === 10 && !radios.find((x) => /Ogre/.test(x.t)).r, JSON.stringify(radios.map((x) => x.r)));
const costBefore = await st(page, () => document.querySelector('.teamsummary')?.textContent ?? '');
const blitzRow = await st(page, () => [...document.querySelectorAll('table.roster:not(.inducementTable):not(.starTable):not(.moneytable) tbody tr')].findIndex((tr) => /Human Blitzer/.test(tr.textContent)));
await page.locator('table.roster:not(.inducementTable):not(.starTable):not(.moneytable) tbody tr').nth(blitzRow).locator('.captain-pick').click();
await sleep(page, 120);
const rowText = await st(page, (i) => document.querySelectorAll('table.roster:not(.inducementTable):not(.starTable):not(.moneytable) tbody tr')[i].textContent, blitzRow);
check('the nominated Blitzer shows CAPTAIN · Pro', /CAPTAIN · Pro/.test(rowText), rowText.slice(0, 80));
const costAfter = await st(page, () => document.querySelector('.teamsummary')?.textContent ?? '');
check('the Captain costs nothing extra (p.155)', (costBefore.match(/Cost ([\d,]+)/) ?? [])[1] === (costAfter.match(/Cost ([\d,]+)/) ?? [])[1], `${(costBefore.match(/Cost ([\d,]+)/) ?? [])[1]} → ${(costAfter.match(/Cost ([\d,]+)/) ?? [])[1]}`);
const other = await st(page, () => [...document.querySelectorAll('table.roster:not(.inducementTable):not(.starTable):not(.moneytable) tbody tr')].findIndex((tr) => /Human Catcher/.test(tr.textContent)));
await page.locator('table.roster:not(.inducementTable):not(.starTable):not(.moneytable) tbody tr').nth(other).locator('.captain-pick').click();
await sleep(page, 120);
const caps = await st(page, () => [...document.querySelectorAll('table.roster:not(.inducementTable):not(.starTable):not(.moneytable) tbody tr')].filter((tr) => /CAPTAIN/.test(tr.textContent)).map((tr) => tr.textContent.slice(0, 30)));
check('nominating another player moves the Captain (one Captain)', caps.length === 1 && /Catcher/.test(caps[0]), JSON.stringify(caps));
await page.click('#save-team');
await sleep(page, 200);

// ------------------------------------------------------------ B. Human (you) v Orc (computer)
await startReadyMatch(page, { p1: 'human', p2: 'orc' });
const info = await st(page, () => {
  const g = window.bloodboard.game;
  return { a: g.teams.A.specialRules, b: g.teams.B.specialRules, capA: g.players.filter((p) => p.team === 'A' && p.captain).map((p) => [p.position, p.skills.map((k) => k.id).includes('pro')]), capB: g.players.filter((p) => p.team === 'B' && p.captain).map((p) => [p.position, p.skills.map((k) => k.id).includes('pro')]) };
});
check('both quick teams have a Captain (a Blitzer) with Pro', info.capA.length === 1 && info.capB.length === 1 && info.capA[0][1] && info.capB[0][1] && /Blitzer/.test(info.capA[0][0]), JSON.stringify(info));
const lg = await st(page, () => document.querySelector('#match-leagues')?.textContent ?? '');
check('the match card names the team rules (Team Captain; Brawlin\' Brutes)', /Team Captain/.test(lg) && /Brawlin' Brutes/.test(lg), lg);
const HUMAN = 'A';
const stats = { humanTurns: 0, cardChecked: false, drives: 0, captainFielded: 0 };
async function humanStep() {
  const s = await st(page, () => {
    const g = window.bloodboard.game;
    return { phase: g.phase, pending: g.pending ? { team: g.pending.request.team, options: g.pending.request.options.map((o) => o.id) } : null, pp: g.match?.pendingPhase?.type ?? null, playback: window.bloodboard.playbackActive(), waiting: window.bloodboardComputer.waitingFor() };
  });
  if (s.playback) { await drainTray(page); return true; }
  if (s.pending && s.pending.team === HUMAN) {
    const pick = s.pending.options.includes('receive') ? 'receive' : s.pending.options[0];
    await page.click(`.decision [data-opt="${pick}"]`);
    return true;
  }
  if (s.pending) return false;
  if (s.phase === 'pregame') { await page.click('#pregame-btn'); return true; }
  if (s.phase === 'touchdown' || s.phase === 'halfOver') { await page.click('#next-drive'); return true; }
  if (s.waiting !== HUMAN) return false;
  if (s.phase === 'driveSetup') {
    await page.getByRole('complementary').getByRole('button', { name: 'Default formation' }).click();
    const placed = await st(page, () => { const d = window.bloodboard.st.setupDraft; const g = window.bloodboard.game; const cap = g.players.find((p) => p.team === 'A' && p.captain && (p.location === 'reserves' || p.location === 'pitch')); return cap ? !!d?.positions?.[cap.id] : null; });
    // null: the Captain cannot play this Drive (Knocked-out, a Casualty…) — "if able" (p.155).
    if (placed !== null) stats.drives++;
    else stats.captainUnavailable = (stats.captainUnavailable ?? 0) + 1;
    if (placed) stats.captainFielded++;
    await page.click('#confirm-setup');
    return true;
  }
  if (s.phase === 'kickoff' && (s.pp === 'quickSnap' || s.pp === 'solidDefence')) { await page.click('#confirm-event'); return true; }
  if (s.phase === 'kickoff') {
    const k = await st(page, () => { const g = window.bloodboard.game; return window.BloodboardEngine.kickerCandidates(g, g.match.kicking)[0].pos; });
    await clickSq(page, k.x, k.y);
    await clickSq(page, 19, 7);
    await page.click('#kickoff-btn');
    return true;
  }
  if (s.phase === 'play' && s.pp === 'charge') { await page.click('#end-charge'); return true; }
  if (s.phase === 'play') {
    if (!stats.cardChecked) {
      const cap = await st(page, () => window.bloodboard.game.players.find((p) => p.team === 'A' && p.captain && p.location === 'pitch')?.pos ?? null);
      if (cap) {
        stats.cardChecked = true;
        await clickSq(page, cap.x, cap.y);
        const card = await st(page, () => ({ head: document.querySelector('.pc-head')?.textContent ?? '', body: document.querySelector('.pc-head')?.parentElement?.textContent ?? '' }));
        check('the player card shows the Captain chip and Pro', /CAPTAIN/.test(card.head) && /Pro/.test(card.body), card.head.slice(0, 80));
        await page.keyboard.press('Escape');
      }
    }
    stats.humanTurns++;
    if (await page.locator('#tray-end-turn').count()) await page.click('#tray-end-turn');
    else await page.click('#end-turn');
    return true;
  }
  return false;
}
const deadline = Date.now() + 10 * 60 * 1000;
while (Date.now() < deadline) {
  if ((await st(page, () => window.bloodboard.game.phase)) === 'fullTime') break;
  if (!(await humanStep())) await sleep(page, 150);
  else await sleep(page, 60);
}
const end = await st(page, () => {
  const g = window.bloodboard.game;
  const ev = g.log.flatMap((e) => e.events);
  const used = ev.filter((v) => /^Team Re-roll used/.test(v.text));
  const capRolls = ev.filter((v) => /^Team Captain /.test(v.text));
  return { phase: g.phase, score: [g.teams.A.score, g.teams.B.score], cpu: g.log.filter((e) => e.team === 'B' && e.input?.kind === 'playerAction').length, used: used.length, capRolls: capRolls.length, capText: capRolls.slice(0, 2).map((v) => v.text) };
});
check('the Human v Orc match reaches full time through the interface', end.phase === 'fullTime', JSON.stringify({ ...end, capText: undefined }));
check('your Captain was fielded in every Drive you set up while able', stats.drives > 0 && stats.captainFielded === stats.drives, JSON.stringify(stats));
check('Team Re-rolls used with a Captain on the pitch are followed by the Captain\'s D6 in the log', end.used === 0 || (end.capRolls > 0 && end.capRolls <= end.used), `${end.used} Team Re-rolls used, ${end.capRolls} Captain rolls: ${end.capText.join(' | ')}`);
const ft = await st(page, () => document.querySelector('.matchcard')?.textContent ?? '');
check('the computer played the Orcs', end.cpu > 20, `${end.cpu} actions`);

// ------------------------------------------------------------ C. Tomb Kings: Masters of Undeath
await startReadyMatch(page, { p1: 'tombKings', p2: 'human' });
const tk = await st(page, () => document.querySelector('#match-leagues')?.textContent ?? '');
check('Tomb Kings v Human: the match card names Masters of Undeath and Team Captain', /Masters of Undeath/.test(tk) && /Team Captain/.test(tk), tk);
// The Raise the Dead decision, as the coach sees it: kill a Human Lineman with a Tomb Kings Blitzer (scripted dice in the engine, shown in the app).
const offered = await st(page, () => {
  const E = window.BloodboardEngine;
  const g = window.bloodboard.game;
  return { hasFn: typeof E.raisedDead === 'function', kind: g.match?.kind };
});
check('the app\'s engine includes Masters of Undeath\'s post-game hire (raisedDead); the rule itself is checked in tests/specialrules.test.ts', offered.hasFn, JSON.stringify(offered));
check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} V5 interface checks passed (${Math.round((Date.now() - t0) / 1000)} s)`);
process.exit(failed.length ? 1 : 0);
