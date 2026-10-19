// V5 step 2 interface flow — the 25 new Team Rosters:
//  A. every roster in the Quick match lists; a quick match against the computer starts with each of the
//     31 rosters as "you" (standard and Sevens), with a legal team;
//  B. team builder: Chaos Chosen asks for its alignment (Favoured of…), the single-Big-Guy limit disables
//     the other Big Guys once one is taken;
//  C. Snotlings (you) v Human (computer): the Swarming card after both set-ups — a Lineman placed from the
//     Reserves Box by click, a non-Lineman refused — confirmed, then the match goes on to the kick-off and
//     play; a whole match to full time.
// Run after `node scripts/build.mjs`:  node scripts/ui-flow-v5-rosters.mjs
import { open, clickSq, drainTray } from './ui-helpers.mjs';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const st = (page, fn, arg) => page.evaluate(fn, arg);
const sleep = (page, ms) => page.waitForTimeout(ms);
const { browser, page, errors } = await open({ home: true });
const t0 = Date.now();

// ------------------------------------------------------------ A. every roster in a match (V5.5 match set-up)
await page.click('#exhibition-setup');
await sleep(page, 300);
await page.click('#p1-controller-human');
await page.click('#p2-controller-computer');
await page.click('#p1-source-ready');
await page.click('#p2-source-ready');
await sleep(page, 120);
const ids = await st(page, () => [...document.querySelectorAll('#p1-roster option')].map((o) => o.value));
check('the match set-up lists all 31 rosters (alphabetical)', ids.length === 31 && ids.includes('snotling') && ids.includes('amazon') && ids.includes('tombKings'), `${ids.length}: ${ids.slice(0, 6).join(', ')}…`);
const bad = [];
for (const fmt of ['standard', 'sevens']) {
  for (const id of ids) {
    await page.click('.brand').catch(() => {});
    await sleep(page, 60);
    await page.click('#exhibition-setup');
    await sleep(page, 120);
    await page.click(`#setup-format-${fmt}`);
    await sleep(page, 60);
    await page.selectOption('#p1-roster', id);
    await page.selectOption('#p2-roster', id === 'human' ? 'orc' : 'human');
    await sleep(page, 60);
    await page.click('#start-match');
    await sleep(page, 150);
    const g = await st(page, () => {
      const s = window.bloodboard.game;
      return { a: s.teams?.A?.rosterId, n: s.players?.filter((p) => p.team === 'A').length ?? 0, v: s.variant ?? 'standard', phase: s.phase, screen: window.bloodboard.st.screen };
    });
    const want = fmt === 'sevens' ? 7 : 11;
    if (g.screen !== 'board' || g.a !== id || g.n < want || g.phase !== 'pregame' || (fmt === 'sevens') !== (g.v === 'sevens')) bad.push(`${fmt}:${id}:${JSON.stringify(g)}`);
  }
}
check('a match against the computer starts with each of the 31 rosters, standard (11+) and Sevens (7+)', bad.length === 0, bad.slice(0, 4).join(' ; ') || '62 matches');

// ------------------------------------------------------------ B. team builder: Favoured of…, a single Big Guy
await page.click('.brand');
await sleep(page, 100);
await page.click('#mode-exhibition');
await sleep(page, 300);
await page.selectOption('.teamlist select', 'chaosChosen');
await page.click('#new-team');
await sleep(page, 150);
const issues = () => st(page, () => document.querySelector('.teameditor .issues')?.textContent ?? '');
check('a new Chaos Chosen team asks for its alignment (Favoured of…, p.154)', /Choose the team's alignment — Favoured of Hashut, Khorne, Nurgle, Slaanesh, Tzeentch, Undivided/.test(await issues()), (await issues()).slice(0, 140));
await page.selectOption('#team-favoured', 'Tzeentch');
await sleep(page, 80);
check('choosing Tzeentch adds "Favoured of Tzeentch" to the team special rules', /Favoured of Tzeentch/.test(await st(page, () => document.querySelector('#team-special-rules')?.textContent ?? '')));
await page.locator('.addplayers button', { hasText: 'Minotaur' }).first().click();
await sleep(page, 80);
const dis = await st(page, () => Object.fromEntries([...document.querySelectorAll('.addplayers button')].map((b) => [b.textContent.replace(/ \(.*/, '').replace('+ ', ''), b.disabled])));
check('after the Minotaur, the Troll and Ogre buttons are disabled (a single Big Guy, p.163)', dis.Troll === true && dis.Ogre === true && dis['Beastmen Lineman'] === false, JSON.stringify(dis));

// ------------------------------------------------------------ C. Snotlings (you) v Human (computer): Swarming
await page.click('.brand');
await sleep(page, 200);
await page.click('#exhibition-setup');
await sleep(page, 200);
await page.click('#setup-format-standard');
await sleep(page, 80);
await page.selectOption('#p1-roster', 'snotling');
await page.selectOption('#p2-roster', 'human');
await sleep(page, 80);
await page.click('#start-match');
await sleep(page, 300);
const HUMAN = 'A';
const stats = { swarmingSeen: 0, swarmChecked: false, humanTurns: 0 };
async function humanStep() {
  const s = await st(page, () => {
    const g = window.bloodboard.game;
    return { phase: g.phase, pending: g.pending ? { team: g.pending.request.team, options: g.pending.request.options.map((o) => o.id) } : null, pp: g.match?.pendingPhase?.type ?? null, ppTeam: g.match?.pendingPhase?.team ?? null, playback: window.bloodboard.playbackActive(), waiting: window.bloodboardComputer.waitingFor() };
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
    await page.click('#confirm-setup');
    return true;
  }
  if (s.phase === 'kickoff' && s.pp === 'swarming') {
    stats.swarmingSeen++;
    if (!stats.swarmChecked) {
      stats.swarmChecked = true;
      const info = await st(page, () => document.querySelector('#swarming-info')?.textContent ?? '');
      check('after both set-ups the Swarming card offers up to D3 more Linemen (p.155)', /Set up up to [123] more Lineman players? from the Reserves Box \(D3 rolled\)/.test(info), info.slice(0, 120));
      const chips = page.locator('.reserves .btnchip');
      const n = await chips.count();
      check('only Linemen are offered in the Swarming Reserves list', n > 0 && (await st(page, () => [...document.querySelectorAll('.reserves .btnchip')].every((b) => /Snotling Lineman/.test(b.textContent)))), `${n} chips`);
      const id1 = await chips.nth(0).getAttribute('data-player');
      await chips.nth(0).click();
      await sleep(page, 60);
      const sq = await st(page, () => {
        const E = window.BloodboardEngine;
        const g = window.bloodboard.displayGame();
        for (const x of [8, 7, 6, 9]) for (const y of [7, 6, 8, 5, 9]) if (!E.playerAt(g, { x, y }) && E.inOwnHalf('A', { x, y })) return { x, y };
        return null;
      });
      await clickSq(page, sq.x, sq.y);
      const placed = await st(page, (id) => window.bloodboard.st.setupDraft?.positions?.[id] ?? null, id1);
      check('a Lineman selected in the Reserves Box is placed by clicking a square in your half', placed && placed.x === sq.x && placed.y === sq.y, JSON.stringify({ sq, placed }));
      // A non-Lineman on the pitch cannot be moved during Swarming.
      const pump = await st(page, () => window.bloodboard.game.players.find((p) => p.team === 'A' && p.location === 'pitch' && !p.keywords.includes('Lineman'))?.pos ?? null);
      if (pump) {
        await clickSq(page, pump.x, pump.y);
        await clickSq(page, 5, 7);
        const t = await st(page, () => [...document.querySelectorAll('.toast')].map((x) => x.textContent).join(' | '));
        check('a player already on the pitch cannot be moved by Swarming (only Linemen from the Reserves Box)', /Swarming: only Lineman players from the Reserves Box/.test(t), t.slice(-120));
      }
      const before = await st(page, () => window.bloodboard.game.players.filter((p) => p.team === 'A' && p.location === 'pitch').length);
      await page.click('#confirm-swarming');
      await sleep(page, 300);
      await drainTray(page);
      const after = await st(page, () => ({ on: window.bloodboard.game.players.filter((p) => p.team === 'A' && p.location === 'pitch').length, pp: window.bloodboard.game.match.pendingPhase?.type ?? null, log: window.bloodboard.game.log.flatMap((e) => e.events.map((v) => v.text)).filter((x) => /Swarming/.test(x)).join(' | ') }));
      check('confirming sets the extra Lineman up: 12 Snotlings on the pitch, then the kick-off', before === 11 && after.on === 12 && after.pp !== 'swarming', JSON.stringify(after).slice(0, 240));
      return true;
    }
    await page.click('#confirm-swarming');
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
  const text = g.log.flatMap((e) => e.events.map((v) => v.text)).join('\n');
  return { phase: g.phase, score: [g.teams.A.score, g.teams.B.score], cpu: g.log.filter((e) => e.team === 'B' && e.input?.kind === 'playerAction').length, swarms: (text.match(/Swarming: .* set up \d more Lineman/g) ?? []).length };
});
check('the Snotling v Human match reaches full time through the interface', end.phase === 'fullTime', JSON.stringify(end));
check('Swarming came up at every kick-off you could swarm (your card each time)', stats.swarmingSeen >= 1 && end.swarms >= stats.swarmingSeen, JSON.stringify({ ...stats, logged: end.swarms }));
check('the computer played the Humans', end.cpu > 20, `${end.cpu} actions`);
check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} V5 roster interface checks passed (${Math.round((Date.now() - t0) / 1000)} s)`);
process.exit(failed.length ? 1 : 0);
