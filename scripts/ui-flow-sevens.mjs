// End-to-end interface flow for Blood Bowl Sevens (V4): the Sevens team
// builder (draft limits, the Veteran), the Sevens board and kick-off rules in
// the interface, and a complete Sevens match against the computer played
// through the normal interface (scripted human clicks). Placement in Sevens is
// covered in depth by ui-flow-placement.mjs. Run after `node scripts/build.mjs`:
//   node scripts/ui-flow-sevens.mjs
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

// ------------------------------------------------------------ A. Sevens team builder
await page.click('#mode-exhibition');
await sleep(page, 200);
await page.click('#tm-format-sevens');
await sleep(page, 300);
check('the Sevens teams screen explains the Sevens draft', /Spike! Journal: Sevens/.test(await st(page, () => document.querySelector('.teamsscreen')?.textContent ?? '')));
await page.selectOption('.teamlist select', 'human');
await page.click('#new-team');
await sleep(page, 150);
const edit = () => st(page, () => JSON.parse(JSON.stringify(window.bloodboard.st.teamEdit)));
let t = await edit();
check('Create makes a Sevens team (Exhibition kind, variant sevens)', t.variant === 'sevens' && t.kind === 'tournament', JSON.stringify({ v: t.variant, k: t.kind }));
const addPos = async (label, n) => {
  for (let i = 0; i < n; i++) {
    await page.locator('.addplayers button', { hasText: label }).first().click();
    await sleep(page, 40);
  }
};
await addPos('Human Blitzer', 2);
await addPos('Human Catcher', 1);
await addPos('Human Lineman', 5);
t = await edit();
const vet = t.players.filter((p) => p.veteran);
check('the first Lineman added becomes the Veteran with MA 5 (Human Lineman MA 6 − 1)', vet.length === 1 && vet[0].position === 'Human Lineman' && vet[0].ma === 5, JSON.stringify(vet.map((p) => [p.number, p.ma])));
const reroll = page.locator('.teameditor .field', { hasText: 'Team Re-rolls' }).locator('input');
await reroll.fill('1');
await reroll.dispatchEvent('change');
await sleep(page, 80);
let summary = await st(page, () => document.querySelector('.teamsummary')?.textContent ?? '');
check('8 players + 1 Team Re-roll cost 595,000 of 600,000 gp and the team is ready (re-roll 100k)', /Cost 595,000 gp of 600,000/.test(summary) && /Ready to play/.test(summary) && /Non-Linemen 3\/4/.test(summary), summary);
await addPos('Human Thrower', 1);
await addPos('Human Catcher', 1);
summary = await st(page, () => document.querySelector('.teamsummary')?.textContent ?? '');
const issues = await st(page, () => document.querySelector('.teameditor .issues')?.textContent ?? '');
check('a fifth non-Lineman is flagged (no more than 4) and the budget overrun too', /Non-Linemen 5\/4/.test(summary) && /no more than 4/.test(issues) && /600,000 gp Sevens Team Draft Budget/.test(issues), issues.slice(0, 160));
// remove the last two players again (#10 and #9: select the row, press Delete, confirm)
for (const idx of [9, 8]) {
  await page.locator('table.roster tbody tr').nth(idx).click();
  await sleep(page, 40);
  await page.keyboard.press('Delete');
  await sleep(page, 80);
  if (await st(page, () => window.bloodboard.st.modal?.kind === 'confirm')) {
    await page.keyboard.press('Enter');
    await sleep(page, 80);
  }
}
t = await edit();
check('removing them makes the team legal again', t.players.length === 8 && /Ready to play/.test(await st(page, () => document.querySelector('.teamsummary')?.textContent ?? '')), `${t.players.length} players`);
// choose another Lineman as the Veteran
const radios = page.locator('input.veteran-pick');
check('only Linemen can be picked as the Veteran (5 radio buttons)', (await radios.count()) === 5, String(await radios.count()));
await radios.nth(3).click();
await sleep(page, 80);
t = await edit();
const vets = t.players.filter((p) => p.veteran);
const lines = t.players.filter((p) => p.position === 'Human Lineman');
check('picking another Veteran moves the MA −1 (old one back to 6)', vets.length === 1 && vets[0].number === lines.map((p) => p.number).sort((a, b) => a - b)[3] && lines.filter((p) => p.ma === 5).length === 1 && lines.filter((p) => p.ma === 6).length === 4 && vets[0].ma === 5, JSON.stringify(lines.map((p) => [p.number, p.ma, !!p.veteran])));
await page.click('#save-team');
await sleep(page, 200);
check('the Sevens team is saved and listed', await st(page, () => [...document.querySelectorAll('.teamlist li')].some((li) => /New Human Sevens team/.test(li.textContent))));

// ------------------------------------------------------------ B. Sevens hot-seat: board and kick-off rules
// V5.5: the match set-up screen (Player 1 / Player 2), Exhibition · Sevens, two human coaches (hot-seat).
await page.click('.brand');
await sleep(page, 200);
await page.click('#exhibition-setup');
await sleep(page, 300);
await page.click('#setup-format-sevens');
await sleep(page, 150);
await page.click('#p1-controller-human');
await page.click('#p2-controller-human');
await page.click('#p1-source-ready');
await page.click('#p2-source-ready');
await sleep(page, 150);
await page.selectOption('#p1-roster', 'human');
await page.selectOption('#p2-roster', 'orc');
await sleep(page, 150);
check('the match set-up shows Exhibition · Sevens', (await page.locator('#setup-format-sevens.on').count()) === 1 && (await page.locator('#setup-mode-exhibition.on').count()) === 1);
await page.click('#start-match');
await sleep(page, 250);
check('the match is a Sevens match (header, badge)', await st(page, () => window.bloodboard.game.variant === 'sevens' && /Sevens Exhibition match|Exhibition match/.test(document.body.textContent) && !!document.querySelector('.sb-variant')));
check('the board is drawn 20 × 11 with No Man\'s Land and two Lines of Scrimmage', await st(page, () => document.querySelectorAll('.pitchhost svg .lines line.los').length === 2 && !!document.querySelector('.pitchhost svg rect.nml') && document.querySelectorAll('.pitchhost svg .coords text').length === 20 + 11 + 2));
await page.click('#pregame-btn');
await sleep(page, 150);
for (let i = 0; i < 10 && (await st(page, () => window.bloodboard.game.phase)) !== 'driveSetup'; i++) {
  await drainTray(page);
  if (await st(page, () => !!window.bloodboard.game.pending)) {
    await page.click('.decision [data-opt="receive"]').catch(() => page.click('.decision button'));
    await sleep(page, 100);
  }
}
for (let i = 0; i < 2; i++) {
  await page.click('#tray-default-formation');
  await sleep(page, 60);
  await page.click('#tray-confirm-setup');
  await sleep(page, 150);
  await drainTray(page);
}
check('both default Sevens formations are accepted (7 a side)', await st(page, () => window.bloodboard.game.phase === 'kickoff' && ['A', 'B'].every((t) => window.bloodboard.game.players.filter((p) => p.team === t && p.location === 'pitch').length === 7)));
check('the kick-off card explains the Sevens kick (lower of two D6, No Man\'s Land)', /LOWER of two D6/.test(await st(page, () => document.querySelector('.matchcard')?.textContent ?? '')));
const kicking = await st(page, () => window.bloodboard.game.match.kicking);
const kicker = await st(page, () => { const g = window.bloodboard.game; return window.BloodboardEngine.kickerCandidates(g, g.match.kicking)[0].pos; });
await clickSq(page, kicker.x, kicker.y);
await clickSq(page, 9, 5);
const toast = await st(page, () => window.bloodboard.st.toast?.text ?? '');
check('a kick aimed into No Man\'s Land is refused with the reason', /No Man's Land/.test(toast) && !(await st(page, () => window.bloodboard.st.kickDraft?.target)), toast);
await clickSq(page, kicking === 'A' ? 16 : 3, 5);
await page.click('#kickoff-btn');
await sleep(page, 150);
for (let i = 0; i < 20; i++) {
  await drainTray(page);
  const s = await st(page, () => ({ pend: !!window.bloodboard.game.pending, pp: window.bloodboard.game.match.pendingPhase?.type ?? null, phase: window.bloodboard.game.phase }));
  if (s.pend) { await page.locator('.decision button').first().click(); await sleep(page, 80); continue; }
  if (s.pp === 'quickSnap' || s.pp === 'solidDefence') { await page.click('#confirm-event'); await sleep(page, 100); continue; }
  if (s.pp === 'charge') { await page.click('#end-charge'); await sleep(page, 100); continue; }
  if (s.phase === 'play') break;
}
const dev = await st(page, () => window.bloodboard.game.log.flatMap((e) => e.events.map((v) => v.text)).find((x) => /The kick Deviates/.test(x)) ?? '');
check('the kick Deviates with the lower of two D6', /2D6 \d, \d \(the lower: \d\)/.test(dev), dev);
check('the receiving team starts Turn 1 of 6', /Turn 1\/6/.test(await st(page, () => document.querySelector('.sb-team.active .sb-meta')?.textContent ?? '')));

// ------------------------------------------------------------ C. A complete Sevens match against the computer
await page.click('.brand');
await sleep(page, 200);
await page.click('#exhibition-setup');
await sleep(page, 300);
await page.click('#setup-format-sevens');
await sleep(page, 150);
await page.click('#p1-controller-human');
await page.click('#p2-controller-computer');
await sleep(page, 150);
await page.selectOption('#p2-ai', 'bloodboard-offensive');
await sleep(page, 150);
await page.click('#start-match');
await sleep(page, 300);
const cfg = await st(page, () => ({ c: window.bloodboardComputer.coaches(), v: window.bloodboard.game.variant }));
check('the set-up opens a Sevens match against the computer (AI file Offensive)', cfg.v === 'sevens' && cfg.c.length === 1 && cfg.c[0].team === 'B' && cfg.c[0].file === 'bloodboard-offensive', JSON.stringify(cfg));
const HUMAN = 'A';
const stats = { humanTurns: 0, maxTurn: 0, maxOnPitch: 0, loops: 0, cpuTurnsSeen: 0 };
async function humanStep() {
  const s = await st(page, () => {
    const g = window.bloodboard.game;
    const m = g.match;
    return { phase: g.phase, pending: g.pending ? { team: g.pending.request.team, options: g.pending.request.options.map((o) => o.id) } : null, pp: m?.pendingPhase?.type ?? null, playback: window.bloodboard.playbackActive(), waiting: window.bloodboardComputer.waitingFor() };
  });
  if (s.playback) { await drainTray(page); return true; }
  if (s.pending && s.pending.team === HUMAN) {
    const pick = s.pending.options.includes('receive') ? 'receive' : s.pending.options[0];
    await page.click(`.decision [data-opt="${pick}"]`);
    return true;
  }
  if (s.pending) return false; // the computer's decision
  if (s.phase === 'pregame') {
    if (await page.locator('#pregame-btn').count()) await page.click('#pregame-btn');
    else await page.click('#tray-pregame');
    return true;
  }
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
    await clickSq(page, 16, 5);
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
const deadline = Date.now() + 8 * 60 * 1000;
while (Date.now() < deadline) {
  stats.loops++;
  const s = await st(page, () => ({ phase: window.bloodboard.game.phase, a: window.bloodboard.game.teams.A.turn, b: window.bloodboard.game.teams.B.turn, on: Math.max(...['A', 'B'].map((t) => window.bloodboard.game.players.filter((p) => p.team === t && p.location === 'pitch').length)) }));
  stats.maxTurn = Math.max(stats.maxTurn, s.a, s.b);
  stats.maxOnPitch = Math.max(stats.maxOnPitch, s.on);
  if (s.phase === 'fullTime') break;
  if (!(await humanStep())) await sleep(page, 150);
  else await sleep(page, 60);
}
const end = await st(page, () => ({ phase: window.bloodboard.game.phase, score: [window.bloodboard.game.teams.A.score, window.bloodboard.game.teams.B.score], half: window.bloodboard.game.match.half, cpuLog: window.bloodboard.game.log.filter((e) => e.team === 'B' && e.input?.kind === 'playerAction').length }));
check('the Sevens match against the computer reaches full time through the interface', end.phase === 'fullTime' && end.half === 2, JSON.stringify(end));
check('never more than 6 Turns a half and 7 players a side on the pitch', stats.maxTurn <= 6 && stats.maxOnPitch <= 7, JSON.stringify(stats));
check('the computer played its Turns (player actions in the log)', end.cpuLog > 10, `${end.cpuLog} actions`);
// The last Turn's dice may still be playing back in the tray: finish it, then read the full-time card.
for (let i = 0; i < 40 && !/Full time/.test(await st(page, () => document.querySelector('.matchcard')?.textContent ?? '')); i++) {
  if (await st(page, () => window.bloodboard.playbackActive())) await drainTray(page);
  await sleep(page, 250);
}
check('the full-time card names the Sevens Exhibition', /Sevens Exhibition match/.test(await st(page, () => document.querySelector('.matchcard')?.textContent ?? '')), (await st(page, () => document.querySelector('.matchcard')?.textContent ?? '')).slice(0, 160));
check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} Sevens interface checks passed (${Math.round((Date.now() - t0) / 1000)} s)`);
process.exit(failed.length ? 1 : 0);
