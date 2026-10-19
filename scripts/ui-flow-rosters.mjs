// Interface flow for the Lizardmen and Norse rosters (V4 build 3): building a
// Norse team (League choice, Favoured of Khorne, the roster's positions and
// limits), the rosters in the quick match, and a complete match of Lizardmen
// (a scripted human through the interface) against the computer's Norse.
// Run after `node scripts/build.mjs`:  node scripts/ui-flow-rosters.mjs
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

// ------------------------------------------------------------ A. A Norse team in the team builder
await page.click('#mode-exhibition');
await sleep(page, 300);
check('the roster list offers Lizardmen and Norse', await st(page, () => [...document.querySelectorAll('.teamlist select option')].map((o) => o.value).join(',').includes('lizardmen') && [...document.querySelectorAll('.teamlist select option')].some((o) => o.value === 'norse')));
await page.selectOption('.teamlist select', 'norse');
await page.click('#new-team');
await sleep(page, 150);
const issues = () => st(page, () => document.querySelector('.teameditor .issues')?.textContent ?? '');
check('a new Norse team asks for its League (Chaos Clash or Old World Classic, p.152)', /Choose the team's League: Chaos Clash or Old World Classic/.test(await issues()), (await issues()).slice(0, 120));
await page.selectOption('#team-league', 'Chaos Clash');
await sleep(page, 80);
check('Chaos Clash gives the team Favoured of Khorne', /Favoured of Khorne/.test(await st(page, () => document.querySelector('#team-special-rules')?.textContent ?? '')));
await page.selectOption('#team-league', 'Old World Classic');
await sleep(page, 80);
check('Old World Classic: no team special rule', (await st(page, () => document.querySelector('#team-special-rules')?.textContent ?? '')) === 'none');
const add = async (label, n) => {
  for (let i = 0; i < n; i++) {
    await page.locator('.addplayers button', { hasText: label }).first().click();
    await sleep(page, 30);
  }
};
await add('Norse Raider', 6);
await add('Beer Boar', 1);
await add('Norse Berserker', 2);
await add('Valkyrie', 2);
await add('Yhetee', 1);
const reroll = page.locator('.teameditor .field', { hasText: 'Team Re-rolls' }).locator('input');
await reroll.fill('2');
await reroll.dispatchEvent('change');
await page.locator('.teameditor .field', { hasText: 'Apothecary' }).locator('input').check();
await sleep(page, 80);
const summary = await st(page, () => document.querySelector('.teamsummary')?.textContent ?? '');
check('12 Norse players + 2 re-rolls + Apothecary = 1,000,000 gp and ready', /Cost 1,000,000 gp of 1,000,000/.test(summary) && /Ready to play/.test(summary), summary);
check('the Yhetee button is disabled at its 0-1 limit', await st(page, () => [...document.querySelectorAll('.addplayers button')].find((b) => /Yhetee/.test(b.textContent))?.disabled === true));
const row = await st(page, () => [...document.querySelectorAll('table.roster tbody tr')].map((tr) => tr.textContent).find((t) => /Yhetee/.test(t)) ?? '');
check('the Yhetee shows its profile and skills (MA 5, ST 5, AG 4+, AV 9+, Claws, Disturbing Presence, Frenzy, Loner, Unchannelled Fury)', /Yhetee5 ?5 ?4\+6\+9\+/.test(row.replace(/\s+/g, '')) || (/Claws/.test(row) && /Unchannelled Fury/.test(row) && /Disturbing Presence/.test(row)), row.slice(0, 160));
await page.click('#save-team');
await sleep(page, 200);

// ------------------------------------------------------------ B. Lizardmen (you) v Norse (computer), a whole match
await startReadyMatch(page, { p1: 'lizardmen', p2: 'norse' });
const cfg = await st(page, () => ({ a: window.bloodboard.game.teams.A.rosterId, b: window.bloodboard.game.teams.B.rosterId, league: window.bloodboard.game.teams.B.league, c: window.bloodboardComputer.config() }));
check('Quick match: Lizardmen (you) v Norse (computer, Chaos Clash)', cfg.a === 'lizardmen' && cfg.b === 'norse' && cfg.league === 'Chaos Clash' && cfg.c?.team === 'B', JSON.stringify(cfg));
check('the match card shows both Leagues and the Norse team rule', /Lustrian Superleague/.test(await st(page, () => document.querySelector('#match-leagues')?.textContent ?? '')) && /Chaos Clash · Favoured of Khorne/.test(await st(page, () => document.querySelector('#match-leagues')?.textContent ?? '')), await st(page, () => document.querySelector('#match-leagues')?.textContent ?? ''));
const HUMAN = 'A';
const stats = { humanTurns: 0, tokensChecked: false };
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
    if (!stats.tokensChecked) {
      stats.tokensChecked = true;
      const labels = await st(page, () => [...document.querySelectorAll('.pitchhost svg text')].map((t) => t.textContent));
      // V5.5: the ready-made teams are built by value (teambuild.ts), so the exact positions vary: every fielded
      // position of the two new rosters must carry its own label (e.g. Krx Kroxigor, Rdr Norse Raider, Val Valkyrie).
      const fielded = await st(page, () => [...new Set(window.bloodboard.game.players.filter((p) => p.location === 'pitch').map((p) => p.position))]);
      const tags = labels.filter((x) => /^[A-Z][a-z]{1,3}$/.test(x));
      check('the board labels the new positions (e.g. Krx, Blk / Rdr, Val on the pitch)', ['Krx', 'Rdr', 'Val'].every((x) => labels.includes(x)) && new Set(tags).size >= Math.min(5, fielded.length), `${tags.slice(0, 30).join(' ')} | fielded: ${fielded.join(', ')}`);
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
  const text = g.log.flatMap((e) => e.events.map((v) => v.text)).join('\n');
  return { phase: g.phase, score: [g.teams.A.score, g.teams.B.score], cpu: g.log.filter((e) => e.team === 'B' && e.input?.kind === 'playerAction').length, seen: ['Unchannelled Fury', 'Frenzy', 'Pick-me-up', 'Drunkard', 'Bone Head', 'Juggernaut', 'Dodge'].filter((k) => text.includes(k)) };
});
check('the Lizardmen v Norse match reaches full time through the interface', end.phase === 'fullTime', JSON.stringify(end));
check('the computer played the Norse (player actions in the log)', end.cpu > 20, `${end.cpu} actions`);
check('roster skills and Traits came up in the match log', end.seen.length >= 2, end.seen.join(', '));
check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} roster interface checks passed (${Math.round((Date.now() - t0) / 1000)} s)`);
process.exit(failed.length ? 1 : 0);
