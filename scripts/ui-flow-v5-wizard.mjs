// V5 step 6 interface flow — the Sports-Wizard (Inducement p.149):
//  A. team builder: a Tournament / Exhibition team buys the Wizard (150,000 gp, 0-1);
//  B. a hot-seat match: at the start of the Orcs' Turn (the end of the Humans' Turn) the match card offers Fireball /
//     Zap!; Fireball is aimed by clicking a square, the review lists the players in the area with their odds, Cast
//     rolls the dice in the dice tray, the Wizard is marked used, no Turnover;
//  C. a second match: during the Humans' own Turn (after an activation) Zap! is planned on an Orc and cast with
//     "End the Turn and cast" — the Turn ends first, then the spell.
// Run after `node scripts/build.mjs`:  node scripts/ui-flow-v5-wizard.mjs
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
const logText = () => st(page, () => window.bloodboard.game.log.flatMap((e) => e.events.map((v) => v.text)).join('\n'));

async function toTeams() {
  await page.click('.brand');
  await sleep(page, 100);
  await page.click('#mode-exhibition');
  await sleep(page, 300);
}
async function newTeam(roster, name, lineLabel, n) {
  await toTeams();
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
await newTeam('human', 'Wizard Humans', 'Human Lineman', 11);
const row = await st(page, () => document.querySelector('#team-inducements tr[data-inducement="wizard"]')?.textContent ?? '');
check('the Inducements table lists the Sports-Wizard: 150k, 0-1 (p.149)', /Wizard: Sports-Wizard/.test(row) && /150k0-1/.test(row), row.slice(0, 80));
const c0 = num(await cost());
await page.click('[data-inc="wizard"]');
await sleep(page, 80);
const c1 = num(await cost());
check('buying it adds 150,000 gp and the team is ready', c1 - c0 === 150000 && /Ready to play/.test(await st(page, () => document.querySelector('.teamsummary')?.textContent ?? '')), `${c0} → ${c1}`);
check('only one can be bought (the + button is disabled)', await st(page, () => document.querySelector('[data-inc="wizard"]')?.disabled === true));
await page.click('#save-team');
await sleep(page, 250);
await newTeam('orc', 'Wizard Orcs', 'Orc Lineman', 11);
await page.click('#save-team');
await sleep(page, 250);

async function startHotseat() {
  await startSavedMatch(page, { mode: 'exhibition', format: 'standard', p1: 'Wizard Humans', p2: 'Wizard Orcs' });
  if (await st(page, () => window.bloodboard.st.modal?.kind === 'confirm')) { await page.keyboard.press('Enter'); await sleep(page, 200); }
}

/** Play the pre-game, set-ups and kick-off until the first Turn (answers decisions with the first option). */
async function toFirstTurn() {
  for (let i = 0; i < 80; i++) {
    const s = await st(page, () => { const g = window.bloodboard.game; return { phase: g.phase, pending: g.pending ? g.pending.request.options.map((o) => o.id) : null, pp: g.match?.pendingPhase?.type ?? null, pb: window.bloodboard.playbackActive() }; });
    if (s.pb) { await drainTray(page); continue; }
    if (s.pending) { await page.click(`.decision [data-opt="${s.pending.includes('receive') ? 'receive' : s.pending[0]}"]`); await sleep(page, 60); continue; }
    if (s.phase === 'pregame') { await page.click('#pregame-btn'); await sleep(page, 120); continue; }
    if (s.phase === 'driveSetup') { await page.getByRole('complementary').getByRole('button', { name: 'Default formation' }).click(); await page.click('#confirm-setup'); await sleep(page, 80); continue; }
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
    if (s.phase === 'play') return true;
    await sleep(page, 100);
  }
  return false;
}
async function endTurn() {
  if (await page.locator('#tray-end-turn').count()) await page.click('#tray-end-turn');
  else await page.click('#end-turn');
  await sleep(page, 150);
  await drainTray(page);
}

// ------------------------------------------------------------ B. Fireball between two Turns
await startHotseat();
check('the match starts and reaches the first Turn', await toFirstTurn());
check('in the first Turn of a Drive the Wizard cannot cast "now" (no Turn has ended yet)', !(await page.locator('#wizard').count()) || /at the end of this Turn/.test(await st(page, () => document.querySelector('#wizard')?.textContent ?? '')) || (await st(page, () => window.bloodboard.game.turn.active)) === 'B');
// End Turns until it is the Orcs' Turn, just after the Humans' Turn ended (the gap between Turns).
for (let i = 0; i < 3; i++) {
  const s = await st(page, () => ({ active: window.bloodboard.game.turn.active, gap: !!window.bloodboard.game.turn.betweenTurns }));
  if (s.active === 'B' && s.gap) break;
  await endTurn();
}
const card = await st(page, () => document.querySelector('#wizard')?.textContent ?? '');
check('after the Humans\' Turn ended, the match card offers Fireball / Zap! "between Turns now"', /Wizard Humans — Sports-Wizard/.test(card) && /between Turns now/.test(card), card.slice(0, 120));
const clk0 = await st(page, () => ({ ...window.bloodboard.st.clock }));
await page.click('#wizard-fireball-A');
await sleep(page, 1600);
const clk1 = await st(page, () => ({ ...window.bloodboard.st.clock }));
check('V5.5 match timer: while the Humans\' coach aims the Wizard (in the Orcs\' Turn) the time counts for Player 1', clk1.A - clk0.A >= 1000 && clk1.B - clk0.B < 300, `P1 +${Math.round(clk1.A - clk0.A)} ms, P2 +${Math.round(clk1.B - clk0.B)} ms`);
// Aim at the Orcs' Line of Scrimmage (the Orcs set up on the right: column 13).
const aim = await st(page, () => {
  const g = window.bloodboard.game;
  const E = window.BloodboardEngine;
  let best = null;
  for (let x = 0; x < 26; x++) for (let y = 0; y < 15; y++) {
    const n = E.fireballTargets(g, { x, y }).filter((p) => p.team === 'B').length - E.fireballTargets(g, { x, y }).filter((p) => p.team === 'A').length * 2;
    if (!best || n > best.n) best = { x, y, n };
  }
  return best;
});
await clickSq(page, aim.x, aim.y);
await sleep(page, 100);
const review = await st(page, () => document.querySelector('#wizard-review')?.textContent ?? '');
check('clicking a square reviews the Fireball: the players in the area, hit 50%, Knocked Down, +1 to the Armour Roll', /Fireball at/.test(review) && /hit 50%/.test(review) && /\+1 to the Armour Roll/.test(review), review.slice(0, 200));
check('the Fireball area is marked on the pitch', (await st(page, () => document.querySelectorAll('.pitchhost svg rect.mark.target').length)) >= 1);
const before = await st(page, () => ({ active: window.bloodboard.game.turn.active, turn: window.bloodboard.game.teams.B.turn }));
await page.click('#wizard-cast');
await sleep(page, 200);
check('Cast shows the dice in the dice tray', await st(page, () => window.bloodboard.playbackActive()));
await drainTray(page);
const log1 = await logText();
check('the log has the Fireball and one D6 per player in the area', /Sports-Wizard casts a Fireball at/.test(log1) && /Fireball — .*: D6 \d/.test(log1), log1.split('\n').filter((l) => /Fireball/.test(l)).slice(0, 3).join(' | '));
const after = await st(page, () => ({ active: window.bloodboard.game.turn.active, turn: window.bloodboard.game.teams.B.turn, card: document.querySelector('#match-inducements')?.textContent ?? '' }));
check('no Turnover: still the Orcs\' same Turn; the Wizard is marked used', after.active === before.active && after.turn === before.turn && /Wizard: Sports-Wizard \(used\)/.test(after.card), JSON.stringify(after).slice(0, 200));
check('the Wizard controls are gone once it is used', (await page.locator('#wizard').count()) === 0);

// ------------------------------------------------------------ C. Zap! "at the end of this Turn"
await startHotseat();
await toFirstTurn();
// Get to a Humans' Turn and activate one Human (a Move), so the gap before this Turn is over.
for (let i = 0; i < 3 && (await st(page, () => window.bloodboard.game.turn.active)) !== 'A'; i++) await endTurn();
const mover = await st(page, () => {
  const g = window.bloodboard.game;
  const E = window.BloodboardEngine;
  for (const p of g.players.filter((q) => q.team === 'A' && q.location === 'pitch' && q.pos && q.stance === 'standing')) {
    if (E.markersOf(g, p.pos, 'A').length) continue;
    for (const dy of [-1, 1]) {
      const c = { x: p.pos.x - 1, y: p.pos.y + dy };
      if (c.y >= 0 && c.y < 15 && !E.playerAt(g, c) && !E.markersOf(g, c, 'A').length) return { from: p.pos, to: c };
    }
  }
  return null;
});
await clickSq(page, mover.from.x, mover.from.y);
await clickSq(page, mover.to.x, mover.to.y);
await sleep(page, 300);
await page.click('#tray-confirm');
await sleep(page, 300);
await drainTray(page);
await st(page, () => window.bloodboard.select(null));
const card2 = await st(page, () => document.querySelector('#wizard')?.textContent ?? '');
check('after an activation in the Humans\' own Turn the card offers the spell "at the end of this Turn"', /at the end of this Turn/.test(card2), card2.slice(0, 120));
await page.click('#wizard-zap-A');
await sleep(page, 100);
const orc = await st(page, () => window.bloodboard.game.players.find((p) => p.team === 'B' && p.location === 'pitch' && p.pos).pos);
await clickSq(page, orc.x, orc.y);
await sleep(page, 100);
const review2 = await st(page, () => ({ txt: document.querySelector('#wizard-review')?.textContent ?? '', btn: document.querySelector('#wizard-cast')?.textContent ?? '' }));
check('Zap! reviewed with the exact chance (Orc Lineman ST 3: 67%) and the button "End the Turn and cast"', /67% to become a Frog/.test(review2.txt) && /End the Turn and cast/.test(review2.btn), JSON.stringify(review2).slice(0, 220));
const turnA = await st(page, () => window.bloodboard.game.teams.A.turn);
await page.click('#wizard-cast');
await sleep(page, 200);
await drainTray(page);
const log2 = await logText();
const endIdx = log2.lastIndexOf(`Turn ${turnA} ends`);
const zapIdx = log2.lastIndexOf('casts Zap!');
check('the Humans\' Turn ended first, then the Zap! was rolled (the gap before the Orcs\' Turn)', endIdx >= 0 && zapIdx > endIdx && /Zap! — .*: D6 \d vs ST 3/.test(log2), `${endIdx} < ${zapIdx}`);
check("it is now the Orcs' Turn, and nobody of theirs has been activated", await st(page, () => window.bloodboard.game.turn.active === 'B' && !window.bloodboard.game.players.some((p) => p.team === 'B' && p.activated)));
check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} Sports-Wizard interface checks passed (${Math.round((Date.now() - t0) / 1000)} s)`);
process.exit(failed.length ? 1 : 0);
