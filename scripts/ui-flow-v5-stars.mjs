// V5 step 5 interface flow — Star Players (Inducement p.148, Plays For p.194, cards pp.195-211):
//  A. team builder: the Star Players table (only those who play for the team; "show every Star Player"), hiring
//     Griff Oberwald and Thorsson Stoutmead (costs, STAR PLAYER chip, at most two, over-budget message and a
//     1,200,000 gp budget), an Orc team hiring Varag Ghoul-Chewer;
//  B. a hot-seat match between the two teams: the match card lists the Star Players, the pitch shows them with
//     a ★, the player card shows the special rule; Thorsson's Beer Barrel Bash is used from the tray (★ button,
//     the target chosen in the decision panel) and is then marked used;
//  C. the same two saved teams in a whole match against the computer (it coaches the Orcs and Varag), to full time.
// Run after `node scripts/build.mjs`:  node scripts/ui-flow-v5-stars.mjs
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
const summary = () => st(page, () => document.querySelector('.teamsummary')?.textContent ?? '');
const num = (x) => Number(String(x).replace(/,/g, ''));
const cost = async () => num((await summary()).match(/Cost ([\d,]+)/)?.[1] ?? '0');

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
const starRow = (id) => st(page, (id) => { const tr = document.querySelector(`#team-stars tr[data-star="${id}"]`); return tr ? { text: tr.textContent, btn: tr.querySelector('button[data-hire]') ? { disabled: tr.querySelector('button[data-hire]').disabled, title: tr.querySelector('button[data-hire]').title } : null } : null; }, id);

// ------------------------------------------------------------ A. the team builder
await newTeam('human', 'Star Humans', 'Human Lineman', 9);
check('a Tournament / Exhibition team shows the Star Players table', (await page.locator('#team-stars').count()) === 1);
const listed = await st(page, () => [...document.querySelectorAll('#team-stars tr[data-star]')].map((tr) => tr.getAttribute('data-star')));
check('only Star Players who play for a Human team (Old World Classic) are listed: Griff yes, Lord Borak (Chaos Clash) no, Morg (any team) yes', listed.includes('griff') && !listed.includes('lordBorak') && listed.includes('morgNThorg'), `${listed.length} listed`);
const griff = await starRow('griff');
check("Griff's row shows cost, profile, skills, special rule and Plays For", /300k/.test(griff.text) && /7 \/ 4 \/ 2\+ \/ 3\+ \/ 9\+/.test(griff.text) && /Consummate Professional/.test(griff.text) && /Plays for Old World Classic/.test(griff.text), griff.text.slice(0, 160));
const c0 = await cost();
await page.click('#team-stars button[data-hire="griff"]');
await sleep(page, 120);
const c1 = await cost();
check('hiring Griff adds him to the team (10 players) and 300,000 gp to the cost', c1 - c0 === 300000 && /10 players/.test(await summary()), `${c0} → ${c1}`);
check('he shows a STAR PLAYER chip and his printed profile in the player table', await st(page, () => [...document.querySelectorAll('table.roster:not(.inducementTable):not(.starTable) tbody tr')].some((tr) => /Griff Oberwald/.test(tr.textContent) && /STAR PLAYER/.test(tr.textContent) && /Block/.test(tr.textContent))));
await page.click('#team-stars button[data-hire="thorsson"]');
await sleep(page, 120);
const c2 = await cost();
check('hiring Thorsson Stoutmead adds 170,000 gp (11 players, ready)', c2 - c1 === 170000 && /11 players/.test(await summary()) && /Ready to play/.test(await summary()), `${c1} → ${c2}: ${await summary()}`);
const zug = await starRow('mightyZug');
check('a third Star Player cannot be hired: at most two (p.148)', zug.btn?.disabled && /At most 2 Star Players/.test(zug.btn.title), JSON.stringify(zug.btn));
await page.check('#show-all-stars');
await sleep(page, 100);
const borak = await starRow('lordBorak');
check('"Show every Star Player" lists the others with the reason they cannot be hired', !!borak && borak.btn?.disabled && /Plays for Chaos Clash/.test(borak.btn.title), JSON.stringify(borak?.btn));
await page.uncheck('#show-all-stars');
await sleep(page, 60);
// Over budget with re-rolls, then a Matched Play budget.
const reroll = page.locator('.teameditor .field', { hasText: 'Team Re-rolls' }).locator('input');
await reroll.fill('2');
await reroll.dispatchEvent('change');
await sleep(page, 80);
const issues = await st(page, () => document.querySelector('.teameditor .issues')?.textContent ?? '');
check('with 2 Team Re-rolls (1,020,000 gp) it is over the 1,000,000 gp Team Draft Budget', /Team costs 1,020,000 gp: over the 1,000,000 gp Team Draft Budget/.test(issues), issues.slice(0, 140));
await page.selectOption('#team-budget', '1200000');
await sleep(page, 80);
check('a 1,200,000 gp budget makes it ready', /Ready to play/.test(await summary()), await summary());
await page.click('#save-team');
await sleep(page, 250);

await newTeam('orc', 'Star Orcs', 'Orc Lineman', 11);
await page.click('#team-stars button[data-hire="varag"]');
await sleep(page, 120);
check('the Orc team hires Varag Ghoul-Chewer (Badlands Brawl) and is ready', /12 players/.test(await summary()) && /Ready to play/.test(await summary()), await summary());
await page.selectOption('#team-budget', '1200000');
await sleep(page, 60);
await page.click('#save-team');
await sleep(page, 250);

// ------------------------------------------------------------ B. a hot-seat match
await startSavedMatch(page, { mode: 'exhibition', format: 'standard', p1: 'Star Humans', p2: 'Star Orcs' });
const card = await st(page, () => document.querySelector('#match-stars')?.textContent ?? '');
check("the match card lists both teams' Star Players and their special rules", /Star Humans: Griff Oberwald \(Consummate Professional\), Thorsson Stoutmead \(Beer Barrel Bash\)/.test(card) && /Star Orcs: Varag Ghoul-Chewer \(Krump and Smash\)/.test(card), card);

let used = false;
let chipChecked = false;
let movedUp = '';
const deadline = Date.now() + 5 * 60 * 1000;
while (Date.now() < deadline && !used) {
  const s = await st(page, () => {
    const g = window.bloodboard.game;
    return { phase: g.phase, pending: g.pending ? { type: g.pending.request.type, ids: g.pending.request.options.map((o) => o.id) } : null, pp: g.match?.pendingPhase?.type ?? null, playback: window.bloodboard.playbackActive(), active: g.turn.active };
  });
  if (s.playback) { await drainTray(page); continue; }
  if (s.pending) {
    const id = s.pending.ids.includes('receive') ? 'receive' : s.pending.ids[0];
    await page.click(`.decision [data-opt="${id}"]`);
    await sleep(page, 80);
    continue;
  }
  if (s.phase === 'pregame') { await page.click('#pregame-btn'); await sleep(page, 150); continue; }
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
  if (s.phase === 'play' && s.active === 'A') {
    if (!chipChecked) {
      chipChecked = true;
      const pitchTxt = await st(page, () => [...document.querySelectorAll('.pitchhost svg text.pos')].map((t) => t.textContent));
      check('the Star Players are marked with a ★ on the pitch', pitchTxt.includes('★Gri') && pitchTxt.includes('★Tho'), pitchTxt.filter((x) => x.startsWith('★')).join(','));
      const g = await st(page, () => window.bloodboard.game.players.find((p) => p.star === 'griff' && p.location === 'pitch')?.pos ?? null);
      if (g) {
        await clickSq(page, g.x, g.y);
        await sleep(page, 150);
        const chip = await st(page, () => document.querySelector('.star-chip')?.textContent ?? '');
        check("the player card shows Griff's special rule", /STAR · Consummate Professional/.test(chip), chip);
        await st(page, () => window.bloodboard.select(null));
      }
    }
    // Thorsson next to an opponent? Use Beer Barrel Bash from the tray.
    const th = await st(page, () => {
      const g = window.bloodboard.game;
      const p = g.players.find((q) => q.star === 'thorsson');
      return p && p.location === 'pitch' && !p.activated ? { pos: p.pos, why: window.BloodboardEngine.startRuleReason(g, p, 'move') } : null;
    });
    // Not in range yet: walk him up this Turn (a normal Move, planned by two clicks), then use the rule next Turn.
    const turnNo = await st(page, () => `${window.bloodboard.game.turn.half}-${window.bloodboard.game.teams.A.turn}`);
    if (th && th.why !== null && movedUp !== turnNo) {
      const sq = await st(page, () => {
        const g = window.bloodboard.game;
        const E = window.BloodboardEngine;
        const p = g.players.find((q) => q.star === 'thorsson');
        const opp = g.players.filter((q) => q.team !== p.team && q.location === 'pitch' && q.pos);
        const d = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
        let best = null;
        for (let x = 1; x < 25; x++) for (let y = 0; y < 15; y++) {
          const c = { x, y };
          if (E.playerAt(g, c) || d(c, p.pos) > p.ma) continue;
          if (!opp.some((o) => d(o.pos, c) <= 3) || opp.some((o) => d(o.pos, c) <= 1)) continue;
          if (!best || d(c, p.pos) < d(best, p.pos)) best = c;
        }
        return best;
      });
      if (sq) {
        movedUp = turnNo;
        await clickSq(page, th.pos.x, th.pos.y);
        await clickSq(page, sq.x, sq.y);
        await sleep(page, 400);
        if (await page.locator('#tray-confirm:not([disabled])').count()) {
          await page.click('#tray-confirm');
          await sleep(page, 300);
          await drainTray(page);
        }
        await st(page, () => window.bloodboard.select(null));
      }
    }
    if (th && th.why === null) {
      await clickSq(page, th.pos.x, th.pos.y);
      await sleep(page, 150);
      const btn = await st(page, () => { const b = document.querySelector('#tray-star-rule'); return b ? { txt: b.textContent, dis: b.disabled } : null; });
      check('Thorsson selected: the tray offers "★ Beer Barrel Bash"', btn && /Beer Barrel Bash/.test(btn.txt) && !btn.dis, JSON.stringify(btn));
      await page.click('#tray-star-rule');
      await sleep(page, 200);
      for (let i = 0; i < 12; i++) {
        const q = await st(page, () => { const g = window.bloodboard.game; return { pb: window.bloodboard.playbackActive(), req: g.pending?.request ? { type: g.pending.request.type, ids: g.pending.request.options.map((o) => o.id), prompt: g.pending.request.prompt } : null }; });
        if (q.pb) { await drainTray(page); continue; }
        if (!q.req) break;
        if (q.req.type === 'starRule') check('the target is chosen in the decision panel (opponents within 3 squares)', q.req.ids.length >= 1 && /Beer Barrel Bash/.test(q.req.prompt), q.req.prompt.slice(0, 120));
        await page.click(`.decision [data-opt="${q.req.ids[0]}"]`);
        await sleep(page, 150);
      }
      await drainTray(page);
      const after = await st(page, () => { const g = window.bloodboard.game; const p = g.players.find((q) => q.star === 'thorsson'); return { log: g.log.flatMap((e) => e.events.map((v) => v.text)).filter((t) => /Beer Barrel Bash/.test(t)).join(' | '), used: p.starUsed, act: g.turn.activation, card: document.querySelector('#match-stars')?.textContent ?? '' }; });
      check('Beer Barrel Bash is resolved (D6 in the log), his activation ends and the match card marks it used', /Beer Barrel Bash: D6 \d/.test(after.log) && after.act === null && /Beer Barrel Bash, used/.test(after.card), JSON.stringify({ log: after.log.slice(0, 160), used: after.used, card: after.card }));
      used = true;
      break;
    }
    if (await page.locator('#tray-end-turn').count()) await page.click('#tray-end-turn');
    else await page.click('#end-turn');
    await sleep(page, 100);
    continue;
  }
  if (s.phase === 'play') {
    if (await page.locator('#tray-end-turn').count()) await page.click('#tray-end-turn');
    else await page.click('#end-turn');
    await sleep(page, 100);
    continue;
  }
  if (s.phase === 'touchdown' || s.phase === 'halfOver') { await page.click('#next-drive').catch(() => {}); await sleep(page, 150); continue; }
  await sleep(page, 100);
}
check('a Star Player special rule was used from the tray in the match', used);

// ------------------------------------------------------------ C. a whole match against the computer
// The same two saved teams: you coach Star Humans, the computer coaches Star Orcs (with Varag). Played to full time
// through the interface (you answer your decisions, set up, kick and end your Turns; the computer plays its side).
await startSavedMatch(page, { mode: 'exhibition', format: 'standard', p1: 'Star Humans', p2: 'Star Orcs', p1Controller: 'human', p2Controller: 'computer' });
if (await st(page, () => window.bloodboard.st.modal?.kind === 'confirm')) { await page.keyboard.press('Enter'); await sleep(page, 300); }
const cpuCard = await st(page, () => document.querySelector('#match-stars')?.textContent ?? '');
check('against the computer: the match card lists the hired Star Players of both teams', /Griff Oberwald/.test(cpuCard) && /Varag Ghoul-Chewer/.test(cpuCard), cpuCard);
const HUMAN = 'A';
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
  if (s.phase === 'kickoff' && s.pp) {
    if (await page.locator('#confirm-event').count()) await page.click('#confirm-event');
    else return false;
    return true;
  }
  if (s.phase === 'kickoff') {
    const k = await st(page, () => { const g = window.bloodboard.game; return window.BloodboardEngine.kickerCandidates(g, g.match.kicking)[0].pos; });
    await clickSq(page, k.x, k.y);
    await clickSq(page, 19, 7);
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
const deadline2 = Date.now() + 12 * 60 * 1000;
while (Date.now() < deadline2) {
  if ((await st(page, () => window.bloodboard.game.phase)) === 'fullTime') break;
  if (!(await humanStep())) await sleep(page, 150);
  else await sleep(page, 60);
}
// The last events are still played back in the dice tray; the full-time card follows.
await drainTray(page);
for (let i = 0; i < 40 && !/Full time/.test(await st(page, () => document.querySelector('.matchcard')?.textContent ?? '')); i++) {
  await drainTray(page);
  await sleep(page, 250);
}
const endC = await st(page, () => {
  const g = window.bloodboard.game;
  const varag = g.players.find((p) => p.star === 'varag');
  const cpuActs = g.log.filter((e) => e.team === 'B' && e.input?.kind === 'playerAction');
  return {
    phase: g.phase,
    score: [g.teams.A.score, g.teams.B.score],
    cpu: cpuActs.length,
    varagActs: varag ? cpuActs.filter((e) => e.input.playerId === varag.id).length : -1,
    starsA: g.players.filter((p) => p.team === 'A' && p.star).map((p) => p.star),
    card: document.querySelector('.matchcard')?.textContent ?? '',
  };
});
check('the Star Humans v Star Orcs match against the computer reaches full time through the interface', endC.phase === 'fullTime' && /Full time/.test(endC.card), JSON.stringify({ ...endC, card: endC.card.slice(0, 80) }));
check("the computer played its team, including its hired Star Player's activations", endC.cpu > 20 && endC.varagActs > 0, `${endC.cpu} computer actions, ${endC.varagActs} by Varag`);
check('both hired Star Players are still on the Star Humans at full time', endC.starsA.includes('griff') && endC.starsA.includes('thorsson'), endC.starsA.join(','));
check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} V5 Star Player interface checks passed (${Math.round((Date.now() - t0) / 1000)} s)`);
process.exit(failed.length ? 1 : 0);
