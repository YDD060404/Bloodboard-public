// Player placement in every mode that has a set-up, through the real pointer
// input (mouse moves, presses and releases — not programmatic state changes):
// Practice position editor, Practice match (introductory rules), League match,
// Tournament / Exhibition match and matches against the computer (you as Home,
// you as Away), and (V4) Blood Bowl Sevens: hot-seat with Sevens teams and
// against the computer (Home and Away) on the 20 × 11 pitch. For each: click
// placement from the Reserves Box, drag from the Reserves Box, drag on the
// pitch, drag back to the Reserves Box, illegal squares rejected (Sevens: No
// Man's Land too), a legal formation confirmed and the match started.
// Run after `node scripts/build.mjs`:  node scripts/ui-flow-placement.mjs [--zoom=0.8]
import { open, sqPoint, drainTray } from './ui-helpers.mjs';

const zoomArg = process.argv.find((a) => a.startsWith('--zoom='));
const ZOOM = zoomArg ? Number(zoomArg.split('=')[1]) : 1;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const st = (page, fn, arg) => page.evaluate(fn, arg);
const sleep = (page, ms) => page.waitForTimeout(ms);

const { browser, page, errors } = await open({ home: true });
if (ZOOM !== 1) await st(page, (z) => { document.documentElement.style.zoom = String(z); }, ZOOM);

/** A realistic click: travel to the square in steps (hover re-renders the board), press, a 1px wobble, release. */
async function humanClick(x, y) {
  const p = await sqPoint(page, x, y);
  await page.mouse.move(p.x - 30, p.y - 20);
  await page.mouse.move(p.x, p.y, { steps: 8 });
  await page.mouse.down();
  await page.mouse.move(p.x + 1, p.y + 1);
  await page.mouse.up();
  await sleep(page, 80);
}
async function center(locator) {
  const b = await locator.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
/** Drag from a point (chip or square) to a pitch square. */
async function dragTo(from, x, y) {
  const to = await sqPoint(page, x, y);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 8, from.y + 4, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 14 });
  await page.mouse.up();
  await sleep(page, 100);
}
async function dragToElement(from, locator) {
  const to = await center(locator);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 8, from.y + 4, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 14 });
  await page.mouse.up();
  await sleep(page, 100);
}
const draftPos = (id) => st(page, (id) => window.bloodboard.st.setupDraft?.positions[id] ?? null, id);
const toastText = () => st(page, () => window.bloodboard.st.toast?.text ?? '');

async function answerDecisions(pick = (req) => req.options[0].id) {
  for (let i = 0; i < 30; i++) {
    await drainTray(page);
    const req = await st(page, () => {
      const g = window.bloodboard.game;
      if (!g.pending) return null;
      const cfg = window.bloodboardComputer.config();
      if (cfg && g.pending.request.team === cfg.team) return 'cpu';
      return g.pending.request;
    });
    if (!req) return;
    if (req === 'cpu') {
      await sleep(page, 150);
      continue;
    }
    await page.click(`.decision [data-opt="${pick(req)}"]`);
    await sleep(page, 80);
  }
}

/** Advance a match (pre-game, decisions, computer steps) until a human coach sets up. */
async function toHumanSetup(maxMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const s = await st(page, () => ({ phase: window.bloodboard.game.phase, pb: window.bloodboard.playbackActive(), cpu: window.bloodboardComputer.toAct(), draft: window.bloodboard.st.setupDraft?.team ?? null, pend: !!window.bloodboard.game.pending }));
    if (s.pb) {
      await drainTray(page);
      continue;
    }
    if (s.pend) {
      await answerDecisions((req) => (req.options.find((o) => o.id === 'receive') ?? req.options[0]).id);
      continue;
    }
    if (s.phase === 'pregame') {
      await page.click('#pregame-btn');
      await sleep(page, 120);
      continue;
    }
    if (s.phase === 'driveSetup' && !s.cpu && s.draft) return s.draft;
    await sleep(page, 150);
  }
  return null;
}

/**
 * The shared checks for one set-up. `label` names the mode. Returns true when
 * the set-up was confirmed.
 */
async function setupChecks(label) {
  const team = await st(page, () => window.bloodboard.st.setupDraft.team);
  const sevens = await st(page, () => window.BloodboardEngine.isSevens(window.bloodboard.game));
  const size = sevens ? 7 : 11;
  await page.getByRole('button', { name: 'Clear' }).click();
  await sleep(page, 80);
  const chips = page.locator('.reserves .btnchip');
  const n = await chips.count();
  check(`${label}: Clear puts every player in the Reserves Box`, n >= size, `${n} chips`);
  // V5.5: the set-up marks of the match (the Line of Scrimmage squares of the team setting up) are drawn.
  const losMarks = await st(page, () => document.querySelectorAll('.pitchhost svg rect.mark.los').length);
  check(`${label}: the Line of Scrimmage squares are marked on the pitch`, losMarks >= 7, `${losMarks} marks`);
  const own = sevens ? (team === 'A' ? { x: 4, y: 5 } : { x: 15, y: 5 }) : team === 'A' ? { x: 8, y: 7 } : { x: 17, y: 7 };
  // an empty square in the opponent's half / area (the opponent may already be set up)
  const opp = await st(page, ([t, sev]) => {
    const E = window.BloodboardEngine;
    const g = window.bloodboard.displayGame();
    const xs = sev ? (t === 'A' ? [15, 16, 17, 14] : [4, 3, 2, 5]) : t === 'A' ? [20, 21, 22, 19] : [5, 4, 3, 6];
    for (let y = 1; y < (sev ? 10 : 14); y++) for (const x of xs) if (!E.playerAt(g, { x, y })) return { x, y };
    return null;
  }, [team, sevens]);
  const ruleText = sevens ? /No Man's Land/ : /own half/;

  // 1. select a reserve, click a legal square
  const id1 = await chips.nth(0).getAttribute('data-player');
  await chips.nth(0).click();
  await sleep(page, 60);
  const sel1 = await st(page, () => window.bloodboard.st.selected);
  await humanClick(own.x, own.y);
  const p1 = await draftPos(id1);
  check(`${label}: select in the Reserves Box + click a legal square places the player`, sel1 === id1 && p1 && p1.x === own.x && p1.y === own.y, JSON.stringify(p1));
  check(`${label}: …the player is drawn on that square`, await st(page, ([id, c]) => { const g = window.bloodboard.displayGame(); const p = g.players.find((q) => q.id === id); return p.location === 'pitch' && p.pos.x === c.x && p.pos.y === c.y; }, [id1, own]));

  // 2. illegal square (opponent's half) is rejected, nothing moves
  await humanClick(opp.x, opp.y);
  const p1b = await draftPos(id1);
  const t2 = await toastText();
  check(`${label}: a square in the opponent's ${sevens ? 'area' : 'half'} is rejected with the rule`, p1b && p1b.x === own.x && p1b.y === own.y && ruleText.test(t2), t2);
  if (sevens) {
    // Sevens: No Man's Land (x 7-12) is never a set-up square.
    await humanClick(9, 5);
    const p1n = await draftPos(id1);
    const tn = await toastText();
    check(`${label}: a square in No Man's Land is rejected with the rule`, p1n && p1n.x === own.x && p1n.y === own.y && /No Man's Land/.test(tn), tn);
  }

  // 3. drag a reserve chip onto the pitch
  const id2 = await chips.nth(0).getAttribute('data-player');
  const from2 = await center(chips.nth(0));
  await dragTo(from2, own.x, own.y + 2);
  const p2 = await draftPos(id2);
  const sel2 = await st(page, () => window.bloodboard.st.selected);
  check(`${label}: dragging a player from the Reserves Box onto a legal square places them (and selects them)`, p2 && p2.x === own.x && p2.y === own.y + 2 && sel2 === id2, JSON.stringify({ p2, sel2 }));

  // 4. drag onto an occupied square is rejected
  const id3 = await chips.nth(0).getAttribute('data-player');
  await dragTo(await center(chips.nth(0)), own.x, own.y);
  const p3 = await draftPos(id3);
  check(`${label}: dropping on an occupied square is rejected`, !p3 && /occupied/.test(await toastText()));

  // 5. drag a reserve into the opponent's half is rejected
  await dragTo(await center(chips.nth(0)), opp.x, opp.y);
  check(`${label}: dropping in the opponent's ${sevens ? 'area' : 'half'} is rejected`, !(await draftPos(id3)) && ruleText.test(await toastText()));

  // 6. drag a player on the pitch to another square
  const a = await sqPoint(page, own.x, own.y);
  await dragTo(a, own.x - 1, own.y - 3);
  const p1c = await draftPos(id1);
  check(`${label}: dragging a player on the pitch moves them`, p1c && p1c.x === own.x - 1 && p1c.y === own.y - 3, JSON.stringify(p1c));

  // 7. drag a pitch player back to the Reserves Box
  const b = await sqPoint(page, own.x - 1, own.y - 3);
  await dragToElement(b, page.locator('.reserves .section-label'));
  check(`${label}: dragging a player onto the Reserves Box takes them off the pitch`, (await draftPos(id1)) === null);

  // 8. only the team setting up can be placed; the draft team never changes
  check(`${label}: the set-up still belongs to the same team`, (await st(page, () => window.bloodboard.st.setupDraft.team)) === team);

  // 9. a full legal formation by clicks: 3 on the Line of Scrimmage + the rest behind
  await page.getByRole('button', { name: 'Clear' }).click();
  await sleep(page, 60);
  const los = sevens ? (team === 'A' ? 6 : 13) : team === 'A' ? 12 : 13;
  const back = sevens ? (team === 'A' ? [4, 2] : [15, 17]) : team === 'A' ? [9, 10] : [15, 16];
  const squares = sevens
    ? [[los, 4], [los, 5], [los, 6], [back[0], 3], [back[0], 5], [back[0], 7], [back[1], 5]]
    : [[los, 6], [los, 7], [los, 8], [back[0], 5], [back[0], 6], [back[0], 7], [back[0], 8], [back[0], 9], [back[1], 6], [back[1], 7], [back[1], 8]];
  for (const [x, y] of squares) {
    const c = page.locator('.reserves .btnchip').first();
    if (!(await c.count())) break;
    await c.click();
    await sleep(page, 40);
    await humanClick(x, y);
  }
  const placed = await st(page, () => Object.values(window.bloodboard.st.setupDraft.positions).filter(Boolean).length);
  const legal = await st(page, () => !!document.querySelector('.matchcard .good') && /legal/.test(document.querySelector('.matchcard .good')?.textContent ?? ''));
  check(`${label}: ${size} players placed by clicking make a legal set-up`, placed === size && legal, `${placed} placed`);
  const phase0 = await st(page, () => ({ phase: window.bloodboard.game.phase, done: { ...window.bloodboard.game.match.setupDone } }));
  await page.click('#confirm-setup');
  await sleep(page, 150);
  await drainTray(page);
  const phase1 = await st(page, (t) => ({ phase: window.bloodboard.game.phase, done: window.bloodboard.game.match.setupDone[t], pos: window.bloodboard.game.players.filter((p) => p.team === t && p.location === 'pitch').length }), team);
  check(`${label}: Confirm set-up is accepted by the rules engine`, phase1.done === true && phase1.pos === size, JSON.stringify({ before: phase0, after: phase1 }));
  return phase1.done === true;
}

/** Kick-off by the human coach (kicker + target clicks), then the Kick-off / Solid Defence / Quick Snap steps. */
async function humanKickoff() {
  const kick = await st(page, () => {
    const g = window.bloodboard.game;
    const k = g.match.kicking;
    const kicker = window.BloodboardEngine.kickerCandidates(g, k)[0];
    const sev = window.BloodboardEngine.isSevens(g);
    return { kicker: kicker.pos, target: sev ? (k === 'A' ? { x: 16, y: 5 } : { x: 3, y: 5 }) : k === 'A' ? { x: 19, y: 7 } : { x: 6, y: 7 } };
  });
  await humanClick(kick.kicker.x, kick.kicker.y);
  await humanClick(kick.target.x, kick.target.y);
  await page.click('#kickoff-btn');
  await sleep(page, 120);
}
let lastKick = null;
async function throughKickoff(maxMs = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const s = await st(page, () => ({ phase: window.bloodboard.game.phase, pp: window.bloodboard.game.match?.pendingPhase?.type ?? null, pb: window.bloodboard.playbackActive(), cpu: window.bloodboardComputer.toAct(), pend: !!window.bloodboard.game.pending, toast: window.bloodboard.st.toast?.text ?? '', kd: window.bloodboard.st.kickDraft }));
    lastKick = s;
    if (s.phase === 'play' && !s.pb && !s.pend && !s.pp) return true;
    if (s.pb) { await drainTray(page); continue; }
    if (s.pend) { await answerDecisions(); continue; }
    if (s.cpu) { await sleep(page, 200); continue; }
    if (s.phase === 'driveSetup') return false;
    if (s.phase === 'kickoff' && !s.pp) { await humanKickoff(); continue; }
    if (s.pp === 'solidDefence' || s.pp === 'quickSnap') { await page.click('#confirm-event'); await sleep(page, 100); continue; }
    if (s.pp === 'charge') { await page.click('#end-charge'); await sleep(page, 100); continue; }
    await sleep(page, 150);
  }
  return false;
}

async function home() {
  await page.click('.brand');
  await sleep(page, 150);
}

// ------------------------------------------------------------------ 1. Practice position editor
await page.evaluate(() => window.bloodboardOpenPractice(0));
await sleep(page, 200);
await page.getByRole('button', { name: 'Edit position' }).click();
await sleep(page, 150);
{
  const g = await st(page, () => window.bloodboard.game.players.filter((p) => p.location === 'pitch').map((p) => ({ id: p.id, pos: p.pos })));
  const p = g[0];
  const free = await st(page, () => { const E = window.BloodboardEngine; const g = window.bloodboard.game; for (let x = 3; x < 23; x++) for (let y = 1; y < 14; y++) if (!E.playerAt(g, { x, y }) && !(g.ball.kind === 'ground' && g.ball.pos.x === x && g.ball.pos.y === y)) return { x, y }; return null; });
  await dragTo(await sqPoint(page, p.pos.x, p.pos.y), free.x, free.y);
  const moved = await st(page, (id) => window.bloodboard.game.players.find((q) => q.id === id).pos, p.id);
  check('Practice editor: dragging a player moves them', moved && moved.x === free.x && moved.y === free.y, JSON.stringify(moved));
  // take him off with the editor button, then put him back by clicking and by dragging
  await page.getByRole('button', { name: 'Move to Reserves' }).click();
  await sleep(page, 80);
  const offBtn = page.locator('.offpitch [data-player]').first();
  const offId = await offBtn.getAttribute('data-player');
  await offBtn.click();
  await sleep(page, 50);
  await humanClick(free.x, free.y);
  const back = await st(page, (id) => { const q = window.bloodboard.game.players.find((q) => q.id === id); return { loc: q.location, pos: q.pos }; }, offId);
  check('Practice editor: select an off-pitch player + click an empty square puts them on the pitch', back.loc === 'pitch' && back.pos.x === free.x && back.pos.y === free.y, JSON.stringify(back));
  await page.getByRole('button', { name: 'Move to Reserves' }).click();
  await sleep(page, 80);
  await dragTo(await center(page.locator('.offpitch [data-player]').first()), free.x, free.y + 1);
  const back2 = await st(page, (id) => { const q = window.bloodboard.game.players.find((q) => q.id === id); return { loc: q.location, pos: q.pos }; }, offId);
  check('Practice editor: dragging an off-pitch player onto the pitch places them', back2.loc === 'pitch' && back2.pos.x === free.x && back2.pos.y === free.y + 1, JSON.stringify(back2));
  await page.click('#start-practice');
  await sleep(page, 150);
  check('Practice editor: the edited position starts', await st(page, () => window.bloodboard.st.view === 'play' && window.bloodboard.game.phase === 'play'));
}

// ------------------------------------------------------------------ 2. Practice match (introductory rules)
await home();
await st(page, () => window.bloodboard.set({ screen: 'learn' }));
await sleep(page, 150);
await page.click('#course-tutorials');
await sleep(page, 60);
await page.locator('[data-lesson-toggle]').last().click(); // the last Basic Tutorial starts a practice match
await sleep(page, 60);
await page.getByRole('button', { name: /demo match/i }).first().click();
await sleep(page, 200);
{
  let t = await toHumanSetup();
  check('Practice match: reaches the first set-up', !!t, String(t));
  await setupChecks(`Practice match (team ${t})`);
  t = await toHumanSetup();
  check('Practice match: the other team sets up next', !!t, String(t));
  await setupChecks(`Practice match (team ${t})`);
  check('Practice match: kick-off → play', await throughKickoff(), JSON.stringify(lastKick));
}

// ------------------------------------------------------------------ 3. League match (hot-seat)
await home();
await page.click('#mode-league');
await sleep(page, 250);
await page.getByRole('button', { name: 'Add two starter teams' }).click();
await sleep(page, 400);
await page.getByRole('button', { name: 'Play a match →' }).click();
await sleep(page, 120);
if (await st(page, () => window.bloodboard.st.modal?.kind === 'confirm')) { await page.keyboard.press('Enter'); await sleep(page, 80); }
if (await page.locator('#nm-hotseat').count()) await page.click('#nm-hotseat');
await page.click('#start-match');
await sleep(page, 200);
{
  check('League: the match starts', await st(page, () => window.bloodboard.st.ctx.kind === 'match' && window.bloodboard.st.ctx.matchKind === 'league'));
  let t = await toHumanSetup();
  await setupChecks(`League (team ${t})`);
  t = await toHumanSetup();
  await setupChecks(`League (team ${t})`);
  check('League: kick-off → play', await throughKickoff(), JSON.stringify(lastKick));
  const turn = await st(page, () => ({ active: window.bloodboard.game.turn.active, recv: window.bloodboard.game.match.kicking === 'A' ? 'B' : 'A' }));
  check('League: the receiving team has the first Turn', turn.active === turn.recv, JSON.stringify(turn));
}

// ------------------------------------------------------------------ 4. Tournament / Exhibition match (hot-seat)
await home();
await page.click('#mode-exhibition');
await sleep(page, 250);
await page.getByRole('button', { name: 'Add two starter teams' }).click();
await sleep(page, 400);
await page.getByRole('button', { name: 'Play a match →' }).click();
await sleep(page, 120);
if (await st(page, () => window.bloodboard.st.modal?.kind === 'confirm')) { await page.keyboard.press('Enter'); await sleep(page, 80); }
if (await page.locator('#nm-hotseat').count()) await page.click('#nm-hotseat');
await page.click('#start-match');
await sleep(page, 200);
{
  check('Tournament: the match starts', await st(page, () => window.bloodboard.st.ctx.kind === 'match' && window.bloodboard.st.ctx.matchKind === 'tournament'));
  let t = await toHumanSetup();
  await setupChecks(`Tournament (team ${t})`);
  t = await toHumanSetup();
  await setupChecks(`Tournament (team ${t})`);
  check('Tournament: kick-off → play', await throughKickoff(), JSON.stringify(lastKick));
}

/** V5.5: start a match from the match set-up screen (Player 1 / Player 2, ready-made teams, AI files). */
async function startSetup(format, p1, p2) {
  await home();
  await page.click('#exhibition-setup');
  await sleep(page, 250);
  await page.click(`#setup-format-${format}`);
  await sleep(page, 120);
  await page.click(`#p1-controller-${p1}`);
  await page.click(`#p2-controller-${p2}`);
  await sleep(page, 80);
  await page.click('#p1-source-ready');
  await page.click('#p2-source-ready');
  await sleep(page, 100);
  await page.selectOption('#p1-roster', 'human');
  await page.selectOption('#p2-roster', 'orc');
  await sleep(page, 120);
  await page.click('#start-match');
  await sleep(page, 250);
}

// ------------------------------------------------------------------ 5. Against the computer: you are Player 1 (Home)
await startSetup('standard', 'human', 'computer');
{
  const t = await toHumanSetup();
  check('Computer (you = Home): your set-up opens for team A', t === 'A', String(t));
  await setupChecks('Computer, you = Home');
  check('Computer (you = Home): the computer sets up, kick-off → play', await throughKickoff(), JSON.stringify(lastKick));
  const s = await st(page, () => ({ cpuPlayers: window.bloodboard.game.players.filter((p) => p.team === 'B' && p.location === 'pitch').length }));
  check('Computer (you = Home): the computer placed its 11 players', s.cpuPlayers === 11, JSON.stringify(s));
}

// ------------------------------------------------------------------ 6. Against the computer: you are Player 2 (Away)
await startSetup('standard', 'computer', 'human');
{
  const t = await toHumanSetup();
  check('Computer (you = Away): your set-up opens for team B', t === 'B', String(t));
  await setupChecks('Computer, you = Away');
  check('Computer (you = Away): kick-off → play', await throughKickoff(), JSON.stringify(lastKick));
}

// ------------------------------------------------------------------ 7. Blood Bowl Sevens (hot-seat)
await startSetup('sevens', 'human', 'human');
{
  const s0 = await st(page, () => ({ ctx: window.bloodboard.st.ctx.kind, variant: window.bloodboard.game.variant ?? null, badge: document.querySelector('.sb-variant')?.textContent ?? '', vb: document.querySelector('.pitchhost svg')?.getAttribute('viewBox') ?? '' }));
  check('Sevens: the hot-seat match starts as Blood Bowl Sevens (badge shown, 20 × 11 pitch drawn)', s0.ctx === 'match' && s0.variant === 'sevens' && /SEVENS/.test(s0.badge) && s0.vb === `0 0 ${20 * 34 + 44} ${11 * 34 + 44}`, JSON.stringify(s0));
  let t = await toHumanSetup();
  await setupChecks(`Sevens hot-seat (team ${t})`);
  t = await toHumanSetup();
  await setupChecks(`Sevens hot-seat (team ${t})`);
  check('Sevens hot-seat: kick-off → play', await throughKickoff(), JSON.stringify(lastKick));
  const s1 = await st(page, () => ({ a: window.bloodboard.game.players.filter((p) => p.team === 'A' && p.location === 'pitch').length, b: window.bloodboard.game.players.filter((p) => p.team === 'B' && p.location === 'pitch').length, turnText: document.querySelector('.sb-meta span')?.textContent ?? '' }));
  check('Sevens hot-seat: seven players a side on the pitch; the Turn tracker counts to 6', s1.a <= 7 && s1.b <= 7 && s1.a + s1.b >= 13 && /\/6$/.test(s1.turnText), JSON.stringify(s1));
}

// ------------------------------------------------------------------ 8. Blood Bowl Sevens against the computer: you are Player 1
await startSetup('sevens', 'human', 'computer');
{
  check('Sevens v computer: the match is a Sevens match against the computer', await st(page, () => window.bloodboard.game.variant === 'sevens' && !!window.bloodboard.game.match.options.coaches?.B));
  const t = await toHumanSetup();
  check('Sevens v computer (you = Home): your set-up opens for team A', t === 'A', String(t));
  await setupChecks('Sevens v computer, you = Home');
  check('Sevens v computer (you = Home): the computer sets up, kick-off → play', await throughKickoff(), JSON.stringify(lastKick));
  const s = await st(page, () => ({ cpu: window.bloodboard.game.players.filter((p) => p.team === 'B' && p.location === 'pitch').map((p) => p.pos), E: null }));
  const legal = await st(page, () => window.bloodboard.game.players.filter((p) => p.team === 'B' && p.location === 'pitch').every((p) => p.pos.x >= 12));
  check('Sevens v computer (you = Home): the computer placed 7 players in its own area (Quick Snap may step into No Man\'s Land)', s.cpu.length === 7 && legal, JSON.stringify(s.cpu));
}

// ------------------------------------------------------------------ 9. Blood Bowl Sevens against the computer: you are Player 2
await startSetup('sevens', 'computer', 'human');
{
  check('Sevens v computer (you = Away): a Sevens match with the computer as Player 1', await st(page, () => window.bloodboard.game.variant === 'sevens' && !!window.bloodboard.game.match.options.coaches?.A));
  const t = await toHumanSetup();
  check('Sevens v computer (you = Away): your set-up opens for team B', t === 'B', String(t));
  await setupChecks('Sevens v computer, you = Away');
  check('Sevens v computer (you = Away): kick-off → play', await throughKickoff(), JSON.stringify(lastKick));
}
await home();

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} placement checks passed${ZOOM !== 1 ? ` (page zoom ${ZOOM})` : ''}`);
process.exit(failed.length ? 1 : 0);
