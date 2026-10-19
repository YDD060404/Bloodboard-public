// Interface flow — the three modes (League, Tournament, Exhibition) with their formats (V5 step 6, moved to the V5.5
// match set-up screen):
//  A. Home: League / Tournament / Exhibition (+ Quick Match, All-Star, Teaching); the Tournament set-up in the Sevens
//     format: Tiers from the sources (Norse Sevens Tier 1, Goblin Tier 4) and their Skill Points (1 / 4 — never the
//     11-a-side 6-10); the 11-a-side format shows the 11-a-side table; choices remembered after a reload;
//  B. a Sevens Tournament match against the computer — the Skill Points on the match card — played to full time;
//  C. "Save as a team and edit…": the ready-made team saved as a Tournament team, a skill bought with Skill Points (and
//     the limit enforced), then the saved team used from the set-up — the bought skill is on the player in the match;
//  D. Exhibition: a match against the computer (no Skill Points), the Tactical board; E. the Teams screens: mode and
//     format switches; no house-rule dice for Tournament matches.
// Run after `node scripts/build.mjs`:  node scripts/ui-flow-v5-modes.mjs
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
const home = async () => {
  await page.click('.brand');
  await sleep(page, 150);
};
const text = (sel) => st(page, (s) => document.querySelector(s)?.textContent ?? '', sel);
const val = (sel) => st(page, (s) => document.querySelector(s)?.value ?? '', sel);

// ------------------------------------------------------------ A. Home and the Tournament set-up
const cards = await st(page, () => [...document.querySelectorAll('.home .modecard h2')].map((x) => x.textContent));
check('Home: League, Tournament and Exhibition cards (with Quick Match, All-Star and Teaching) — no Practice mode', ['League', 'Tournament', 'Exhibition'].every((c) => cards.includes(c)) && !/Practice mode/.test(await text('.home')), JSON.stringify(cards));
await page.click('#tournament-format-sevens');
await sleep(page, 120);
await page.click('#tournament-setup');
await sleep(page, 300);
await page.click('#p1-controller-human');
await page.click('#p2-controller-computer');
await page.click('#p1-source-ready');
await page.click('#p2-source-ready');
await sleep(page, 120);
check('the Tournament set-up is in the Sevens format', (await page.locator('#setup-format-sevens.on').count()) === 1 && (await page.locator('#setup-mode-tournament.on').count()) === 1);
await page.selectOption('#p1-roster', 'norse');
await sleep(page, 120);
await page.selectOption('#p2-roster', 'goblin');
await sleep(page, 120);
check('Norse (Sevens) is Tier 1 and Goblins Tier 4, as Spike! 22 states', (await val('#p1-tier')) === '1' && (await val('#p2-tier')) === '4', `${await val('#p1-tier')} / ${await val('#p2-tier')}`);
const sp1s = await text('#p1-summary');
const sp2s = await text('#p2-summary');
check("Sevens Skill Points by Tier: Norse 1 (Tier 1), Goblins 4 (Tier 4) — not the 11-a-side 6-10", /Skill Points \d\/1\b/.test(sp1s) && /Skill Points \d\/4\b/.test(sp2s), `${sp1s.slice(0, 100)} | ${sp2s.slice(0, 100)}`);
await page.click('#setup-format-standard');
await sleep(page, 150);
await page.selectOption('#p1-roster', 'human');
await sleep(page, 120);
const t11 = await st(page, () => [...document.querySelectorAll('#p1-tier option')].map((o) => o.textContent));
check('the 11-a-side format uses the rulebook table (Tier 1-4 = 6 / 8 / 9 / 10 Skill Points)', /^1 — 6 Skill Points/.test(t11[0]) && /^2 — 8 Skill Points/.test(t11[1]) && /^3 — 9 Skill Points/.test(t11[2]) && /^4 — 10 Skill Points/.test(t11[3]), t11.join(' | '));
await page.click('#setup-format-sevens');
await sleep(page, 150);
await page.selectOption('#p1-roster', 'norse');
await sleep(page, 120);
await page.reload();
await sleep(page, 500);
await page.click('#tournament-setup');
await sleep(page, 300);
check('after a reload the set-up remembers the choices (Sevens, Norse Tier 1 v Goblin Tier 4, computer)', (await page.locator('#setup-format-sevens.on').count()) === 1 && (await val('#p1-roster')) === 'norse' && (await val('#p2-roster')) === 'goblin' && (await val('#p1-tier')) === '1' && (await val('#p2-tier')) === '4' && (await page.locator('#p2-controller-computer.on').count()) === 1);

// ------------------------------------------------------------ B. Sevens Tournament v computer, to full time
await page.click('#start-match');
await sleep(page, 300);
const m0 = await st(page, () => ({ pill: document.querySelector('#match-mode')?.textContent ?? '', sp: document.querySelector('#match-skillpoints')?.textContent ?? '', v: window.bloodboard.game.variant, play: window.bloodboard.game.match.options.play, cpu: window.bloodboardComputer.config(), n: ['A', 'B'].map((t) => window.bloodboard.game.players.filter((p) => p.team === t).length) }));
check('a Sevens Tournament match against the computer', /Sevens Tournament match · vs computer/.test(m0.pill) && m0.v === 'sevens' && m0.play === 'tournament' && m0.cpu?.team === 'B' && m0.n.every((k) => k >= 7 && k <= 11), JSON.stringify(m0).slice(0, 220));
check("the match card shows each team's Tier and Skill Points (Tier 1: 1, Tier 4: 4)", /Tier 1, \d of 1 spent/.test(m0.sp) && /Tier 4, \d of 4 spent/.test(m0.sp), m0.sp);
const HUMAN = 'A';
async function humanStep() {
  const s = await st(page, () => {
    const g = window.bloodboard.game;
    return { phase: g.phase, pending: g.pending ? { team: g.pending.request.team, options: g.pending.request.options.map((o) => o.id) } : null, pp: g.match?.pendingPhase?.type ?? null, playback: window.bloodboard.playbackActive(), waiting: window.bloodboardComputer.waitingFor() };
  });
  if (s.playback) { await drainTray(page); return true; }
  if (s.pending && s.pending.team === HUMAN) {
    await page.click(`.decision [data-opt="${s.pending.options.includes('receive') ? 'receive' : s.pending.options[0]}"]`);
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
  if (s.phase === 'kickoff' && s.pp) {
    if (await page.locator('#confirm-event').count()) await page.click('#confirm-event');
    else if (await page.locator('#confirm-swarming').count()) await page.click('#confirm-swarming');
    else return false;
    return true;
  }
  if (s.phase === 'kickoff') {
    const k = await st(page, () => { const g = window.bloodboard.game; return window.BloodboardEngine.kickerCandidates(g, g.match.kicking)[0].pos; });
    await clickSq(page, k.x, k.y);
    await clickSq(page, 15, 5);
    await page.click('#kickoff-btn');
    return true;
  }
  if (s.phase === 'play' && s.pp === 'charge') { await page.click('#end-charge'); return true; }
  if (s.phase === 'play') {
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
await drainTray(page);
for (let i = 0; i < 40 && !/Full time/.test(await text('.matchcard')); i++) { await drainTray(page); await sleep(page, 250); }
const end = await st(page, () => ({ phase: window.bloodboard.game.phase, score: [window.bloodboard.game.teams.A.score, window.bloodboard.game.teams.B.score], cpu: window.bloodboard.game.log.filter((e) => e.team === 'B' && e.input?.kind === 'playerAction').length }));
check('the Sevens Tournament match against the computer reaches full time', end.phase === 'fullTime' && /Full time/.test(await text('.matchcard')) && end.cpu > 10, JSON.stringify(end));

// ------------------------------------------------------------ C. Save as a team and edit: spend the Skill Points, then play
await home();
await page.click('#tournament-setup');
await sleep(page, 300);
await page.click('#p1-source-ready');
await sleep(page, 120);
await page.selectOption('#p1-roster', 'norse');
await sleep(page, 120);
await page.click('#p1-edit-copy');
await sleep(page, 600);
const ed = await st(page, () => ({ screen: window.bloodboard.st.screen, kind: window.bloodboard.st.teamKind, fmt: window.bloodboard.st.teamFormat, team: window.bloodboard.st.teamEdit?.name ?? '', tier: window.bloodboard.st.teamEdit?.tier, sp: document.querySelector('#team-skillpoints')?.textContent ?? '' }));
check('"Save as a team and edit…" saves the ready-made team as a Sevens Tournament team and opens it (Tier 1)', ed.screen === 'teams' && ed.kind === 'tournament' && ed.fmt === 'sevens' && /Norse/.test(ed.team) && ed.tier === 1 && /Skill Points \d\/1 \(Tier 1\)/.test(ed.sp), JSON.stringify(ed));
const raiderRow = page.locator('table.roster:not(.inducementTable):not(.starTable) tbody tr', { hasText: 'Norse Raider' });
// Clear skills the ready-made team came with, then buy Tackle for the first Raider.
await st(page, () => { const t = window.bloodboard.st.teamEdit; for (const p of t.players) delete p.boughtSkill; window.bloodboard.st.teamDirty = true; window.bloodboard.emit(); });
await sleep(page, 150);
await raiderRow.nth(0).locator('select.buy-skill').selectOption('tackle');
await sleep(page, 150);
const spT = await text('#team-skillpoints');
check('buying Tackle (Primary, 1 Skill Point) for a Raider: 1/1', /Skill Points 1\/1/.test(spT), spT);
await raiderRow.nth(1).locator('select.buy-skill').selectOption('dodge');
await sleep(page, 150);
const iss = await text('.teameditor .issues');
check('a Secondary skill (Dodge, 2 Skill Points) on top is over the Tier 1 allowance — refused with the reason', /Skill Points: 3 spent, but a Tier 1 team has 1 \(Spike! 22 p\.19\)/.test(iss), iss.slice(0, 160));
await raiderRow.nth(1).locator('select.buy-skill').selectOption('');
await sleep(page, 150);
await page.click('#save-team');
await sleep(page, 400);
await home();
await page.click('#tournament-setup');
await sleep(page, 300);
const tt = await st(page, () => ({ src: document.querySelector('#p1-source-saved')?.classList.contains('on'), team: document.querySelector('#p1-team')?.selectedOptions[0]?.textContent ?? '', sum: document.querySelector('#p1-summary')?.textContent ?? '' }));
check('the set-up now uses the saved Tournament team, with its Skill Points spent', tt.src && /Norse/.test(tt.team) && /Skill Points 1\/1 \(#\d+ Tackle\)/.test(tt.sum), JSON.stringify(tt));
await page.click('#start-match');
await sleep(page, 300);
const m1 = await st(page, () => ({ sp: document.querySelector('#match-skillpoints')?.textContent ?? '', tackle: window.bloodboard.game.players.filter((p) => p.team === 'A' && p.skills.some((k) => k.id === 'tackle')).length }));
check('in the match: "1 of 1 spent (#… Tackle)" on the card, and the Raider has Tackle', /Tier 1, 1 of 1 spent \(#\d+ Tackle\)/.test(m1.sp) && m1.tackle === 1, JSON.stringify(m1));

// ------------------------------------------------------------ D. Exhibition
await home();
await page.click('#exhibition-setup');
await sleep(page, 300);
await page.click('#setup-format-standard');
await sleep(page, 120);
await page.click('#p1-controller-human');
await page.click('#p2-controller-computer');
await page.click('#p1-source-ready');
await page.click('#p2-source-ready');
await sleep(page, 120);
await page.click('#start-match');
await sleep(page, 300);
const x = await st(page, () => ({ pill: document.querySelector('#match-mode')?.textContent ?? '', sp: !!document.querySelector('#match-skillpoints'), play: window.bloodboard.game.match.options.play }));
check('Exhibition match: "Exhibition match · vs computer", no Skill Points', /^Exhibition match · vs computer/.test(x.pill) && !x.sp && x.play === 'exhibition', JSON.stringify(x));
await home();
await page.click('#mode-board');
await sleep(page, 250);
check('the Tactical board opens (free set-up, fixed dice seed)', await st(page, () => window.bloodboard.st.ctx.kind === 'practice' && /Tactical board/.test(document.body.textContent)));

// ------------------------------------------------------------ E. Teams screens; no house-rule dice for Tournament matches
await home();
await page.click('#mode-league');
await sleep(page, 250);
check('League teams: 11-a-side only (no format switch)', (await page.locator('#tm-format-sevens').count()) === 0);
await page.click('#tm-cat-tournament');
await sleep(page, 150);
await page.click('#tm-format-sevens');
await sleep(page, 150);
check('Tournament · Sevens teams list the saved Norse Sevens Tournament team', /Norse/.test(await text('.teamlist')));
await page.click('#tm-cat-exhibition');
await sleep(page, 150);
check('Exhibition · Sevens: the saved Tournament team is not listed there', !/Norse Sevens/.test(await text('.teamlist')));
await home();
await page.click('#tournament-setup');
await sleep(page, 300);
check('against the computer, a Tournament match has no D6 house-rule dice (standard dice)', !(await page.locator('#setup-difficulty').count()) || /standard dice|not in Tournament/i.test(await text('#setup-shared')), (await text('#setup-shared')).slice(0, 200));
check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} mode interface checks passed (${Math.round((Date.now() - t0) / 1000)} s)`);
process.exit(failed.length ? 1 : 0);
