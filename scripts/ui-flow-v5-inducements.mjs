// V5 step 3 interface flow — Inducements on a Tournament / Exhibition Team Draft List (pp.141-147):
//  A. team builder: the Inducements table (prices, limits, who may buy them), the Team Draft Budget,
//     buying a Bribe and a Weather Mage, a Mercenary Player with an extra Primary skill — costs add up;
//  B. a hot-seat match between two such teams: the match card lists the Inducements, the Weather Mage
//     control appears at the start of the team's Turn and changes the weather, marked used afterwards.
// Run after `node scripts/build.mjs`:  node scripts/ui-flow-v5-inducements.mjs
import { open, clickSq, drainTray, startSavedMatch } from './ui-helpers.mjs';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const st = (page, fn, arg) => page.evaluate(fn, arg);
const sleep = (page, ms) => page.waitForTimeout(ms);
const { browser, page, errors } = await open({ home: true });
const t0 = Date.now();
const cost = () => st(page, () => (document.querySelector('.teamsummary')?.textContent ?? '').match(/Cost ([\d,]+)/)?.[1] ?? '');
const num = (x) => Number(String(x).replace(/,/g, ''));

async function newTeam(roster, name, lineLabel, n) {
  await page.click('.brand');
  await sleep(page, 100);
  await page.click('#mode-exhibition');
  await sleep(page, 300);
  await page.selectOption('.teamlist select', roster);
  await page.click('#new-team');
  await sleep(page, 150);
  await page.locator('.teameditor input[type=text]').first().fill(name);
  await page.locator('.teameditor input[type=text]').first().dispatchEvent('change');
  for (let i = 0; i < n; i++) {
    await page.locator('.addplayers button', { hasText: lineLabel }).first().click();
    await sleep(page, 20);
  }
}

// ------------------------------------------------------------ A. the team builder
await newTeam('human', 'Inducement Humans', 'Human Lineman', 11);
check('a Tournament / Exhibition team shows the Inducements table', await page.locator('#team-inducements').count() === 1);
const rows = await st(page, () => Object.fromEntries([...document.querySelectorAll('#team-inducements tr[data-inducement]')].map((tr) => [tr.getAttribute('data-inducement'), tr.textContent])));
check('prices and limits as printed (Bribe 100k 0-3, Extra Team Training 100k 0-8, Temp Agency Cheerleader 5k 0-5, Halfling Master Chef 300k)', /100k0-3/.test(rows.bribe) && /100k0-8/.test(rows.extraTraining) && /5k0-5/.test(rows.tempCheerleader) && /300k0-1/.test(rows.halflingMasterChef), JSON.stringify({ b: rows.bribe?.slice(0, 40), c: rows.halflingMasterChef?.slice(0, 40) }));
check('team-only Inducements say who may buy them (Mortuary Assistant, Plague Doctor, Riotous Rookies)', /only for teams with Masters of Undeath/.test(rows.mortuaryAssistant) && /only for teams Favoured of Nurgle/.test(rows.plagueDoctor) && /only for teams with Low Cost Linemen/.test(rows.riotousRookies));
const c0 = num(await cost());
await page.click('[data-inc="bribe"]');
await sleep(page, 60);
await page.click('[data-inc="weatherMage"]');
await sleep(page, 60);
const c1 = num(await cost());
check('buying a Bribe (100k) and a Weather Mage (25k) adds 125,000 gp to the team cost', c1 - c0 === 125000, `${c0} → ${c1}`);
await page.check('#add-as-merc');
await page.locator('.addplayers button', { hasText: 'Human Lineman' }).first().click();
await sleep(page, 80);
await page.uncheck('#add-as-merc');
const c2 = num(await cost());
check('a Mercenary Human Lineman costs 80,000 gp (50k + 30k) and shows MERCENARY', c2 - c1 === 80000 && (await page.locator('.merc').count()) === 1, `${c1} → ${c2}`);
await page.locator('.merc-skill').selectOption('block');
await sleep(page, 80);
const c3 = num(await cost());
check("the Mercenary's extra Primary skill (Block) costs 50,000 gp more", c3 - c2 === 50000, `${c2} → ${c3}`);
const reroll = page.locator('.teameditor .field', { hasText: 'Team Re-rolls' }).locator('input');
await reroll.fill('4');
await reroll.dispatchEvent('change');
await sleep(page, 80);
const issues = await st(page, () => document.querySelector('.teameditor .issues')?.textContent ?? '');
check('with 4 Team Re-rolls (1,005,000 gp) it is over the 1,000,000 gp budget and cannot play yet', /Team costs 1,005,000 gp: over the 1,000,000 gp Team Draft Budget/.test(issues), issues.slice(0, 120));
await page.selectOption('#team-budget', '1200000');
await sleep(page, 80);
const summary = await st(page, () => document.querySelector('.teamsummary')?.textContent ?? '');
check('with a 1,200,000 gp Matched Play budget (p.110) it is ready', /of 1,200,000/.test(summary) && /Ready to play/.test(summary), summary);
await page.click('#save-team');
await sleep(page, 250);

await newTeam('orc', 'Inducement Orcs', 'Orc Lineman', 11);
await page.click('[data-inc="blitzersBestKeg"]');
await sleep(page, 60);
await page.click('[data-inc="prayer"]');
await page.click('[data-inc="prayer"]');
await sleep(page, 60);
await page.selectOption('#team-budget', '1200000');
await sleep(page, 60);
check('the Orc team with a Keg is ready', /Ready to play/.test(await st(page, () => document.querySelector('.teamsummary')?.textContent ?? '')));
await page.click('#save-team');
await sleep(page, 250);

// ------------------------------------------------------------ B. a hot-seat match
await startSavedMatch(page, { mode: 'exhibition', format: 'standard', p1: 'Inducement Humans', p2: 'Inducement Orcs' });
const ind = await st(page, () => document.querySelector('#match-inducements')?.textContent ?? '');
check('the match card lists both teams\' Inducements', /Inducement Humans: Bribe, Weather Mage/.test(ind) && /Inducement Orcs: 2 × Prayer to Nuffle, Blitzer's Best Keg|Inducement Orcs: Blitzer's Best Keg, 2 × Prayer to Nuffle/.test(ind), ind);
check('the match starts with the Bribe and the Mercenary (Loner (4+), Block)', await st(page, () => { const g = window.bloodboard.game; const merc = g.players.find((p) => p.mercenary); return g.match.bribes.A === 1 && !!merc && merc.skills.some((k) => k.id === 'loner' && k.value === 4) && merc.skills.some((k) => k.id === 'block'); }));

let used = false;
const deadline = Date.now() + 4 * 60 * 1000;
while (Date.now() < deadline && !used) {
  const s = await st(page, () => {
    const g = window.bloodboard.game;
    return { phase: g.phase, pending: g.pending ? g.pending.request.options.map((o) => o.id) : null, pp: g.match?.pendingPhase?.type ?? null, playback: window.bloodboard.playbackActive(), active: g.turn.active };
  });
  if (s.playback) { await drainTray(page); continue; }
  if (s.pending) { await page.click(`.decision [data-opt="${s.pending.includes('receive') ? 'receive' : s.pending[0]}"]`); await sleep(page, 60); continue; }
  if (s.phase === 'pregame') {
    await page.click('#pregame-btn');
    await sleep(page, 150);
    await drainTray(page);
    // Some Prayers (Iron Man, Knuckle Dusters, Intensive Training) ask the coach to choose a player or skill first:
    // the Prayers are recorded once those choices are made (answered here in the decision panel).
    const picks = [];
    for (let i = 0; i < 6; i++) {
      const q = await st(page, () => { const g = window.bloodboard.game; return g.pending?.request?.type === 'prayerPick' ? { prompt: g.pending.request.prompt, id: g.pending.request.options[0].id } : null; });
      if (!q) break;
      picks.push(q.prompt.replace(/:.*/, ''));
      await page.click(`.decision [data-opt="${q.id}"]`);
      await sleep(page, 150);
      await drainTray(page);
    }
    const pr = await st(page, () => ({ card: document.querySelector('#match-prayers')?.textContent ?? '', got: window.bloodboard.game.match.prayers?.B ?? [] }));
    check('the Orcs\' two Prayers to Nuffle are rolled in the pre-game and listed on the match card (p.143)', pr.got.length === 2 && new Set(pr.got).size === 2 && /Prayers to Nuffle — Inducement Orcs: /.test(pr.card), JSON.stringify({ ...pr, picks }));
    continue;
  }
  if (s.phase === 'driveSetup') {
    await page.getByRole('complementary').getByRole('button', { name: 'Default formation' }).click();
    await page.click('#confirm-setup');
    await sleep(page, 80);
    continue;
  }
  if (s.phase === 'kickoff' && s.pp) { await page.click('#confirm-event').catch(() => {}); await sleep(page, 80); continue; }
  if (s.phase === 'kickoff') {
    const k = await st(page, () => { const g = window.bloodboard.game; return window.BloodboardEngine.kickerCandidates(g, g.match.kicking)[0].pos; });
    const tx = await st(page, () => (window.bloodboard.game.match.kicking === 'A' ? 19 : 6));
    await clickSq(page, k.x, k.y);
    await clickSq(page, tx, 7);
    await page.click('#kickoff-btn');
    await sleep(page, 80);
    continue;
  }
  if (s.phase === 'play' && s.pp === 'charge') { await page.click('#end-charge'); continue; }
  if (s.phase === 'play') {
    if (s.active === 'A') {
      const shown = await page.locator('#weather-mage').count();
      check('at the start of the Humans\' Turn the Weather Mage control is shown', shown === 1);
      await page.selectOption('#weather-mage-mod', '1');
      await page.click('#weather-mage-btn');
      await sleep(page, 200);
      await drainTray(page);
      const log = await st(page, () => window.bloodboard.game.log.flatMap((e) => e.events.map((v) => v.text)).filter((x) => /Weather Mage/.test(x)).join(' | '));
      check('using it rolls 2D6 +1 on the Weather Table and logs the new weather', /Weather Mage \(Inducement Humans\): 2D6 \d\+\d \+1 = \d+ — /.test(log), log);
      check('afterwards it is marked used and the control is gone', (await page.locator('#weather-mage').count()) === 0 && /Weather Mage \(used\)/.test(await st(page, () => document.querySelector('#match-inducements')?.textContent ?? '')));
      used = true;
      break;
    }
    if (await page.locator('#tray-end-turn').count()) await page.click('#tray-end-turn');
    else await page.click('#end-turn');
    await sleep(page, 80);
    continue;
  }
  await sleep(page, 100);
}
check('the Weather Mage was reached and used in the match', used);
check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} V5 Inducement interface checks passed (${Math.round((Date.now() - t0) / 1000)} s)`);
process.exit(failed.length ? 1 : 0);
