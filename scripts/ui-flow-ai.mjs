// End-to-end interface flow for the computer opponent: a complete match of a
// human (scripted clicks through the normal interface) against the computer,
// plus the move advisor, click blocking, the computer's dice in the tray and
// Undo in a computer match. Run after `node scripts/build.mjs`:
//   node scripts/ui-flow-ai.mjs [seedStyle]
import { open, clickSq, sqPoint, waitPlan, gameJSON, drainTray } from './ui-helpers.mjs';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const st = (page, fn, arg) => page.evaluate(fn, arg);
const sleep = (page, ms) => page.waitForTimeout(ms);

const { browser, page, errors } = await open({ home: true });
const t0 = Date.now();

// ------------------------------------------------------------ V5.5 match set-up: Player 2 = the computer (an AI file)
await page.click('#exhibition-setup');
await sleep(page, 300);
await page.click('#setup-format-standard');
await sleep(page, 150);
await page.click('#p1-controller-human');
await page.click('#p2-controller-computer');
await sleep(page, 100);
await page.click('#p1-source-ready');
await page.click('#p2-source-ready');
await sleep(page, 150);
await page.selectOption('#p1-roster', 'human');
await page.selectOption('#p2-roster', 'orc');
await sleep(page, 150);
await page.selectOption('#p2-ai', 'bloodboard-balanced');
await sleep(page, 150);
await page.click('#start-match');
await sleep(page, 400);
const cfg = await st(page, () => ({ c: window.bloodboardComputer.config(), coaches: window.bloodboardComputer.coaches(), kind: window.bloodboard.st.ctx.kind }));
check('the match set-up opens a match against the computer (Orcs, AI file Balanced)', cfg.c && cfg.c.team === 'B' && cfg.coaches.length === 1 && cfg.coaches[0].file === 'bloodboard-balanced' && cfg.kind === 'match', JSON.stringify(cfg));
check('the scoreboard marks the computer team', (await st(page, () => document.querySelector('.sb-cpu')?.textContent)) === 'COMPUTER');
check('the computer card names its AI file', /Bloodboard AI — Balanced/.test(await st(page, () => document.querySelector('#computer-card')?.textContent ?? '')));

const HUMAN = 'A';
const stats = { manualSetupDone: false, defaultDrawnChecked: false, humanTurns: 0, computerSawThinking: false, computerDiceAuto: false, computerActions: 0, maxLoop: 0, blockedClick: false, reasons: new Set(), undoChecked: false, advisorChecked: false, humanActionDone: false };

/** One step of the human coach through the interface; returns false when nothing was done. */
async function humanStep() {
  const s = await st(page, () => {
    const g = window.bloodboard.game;
    const m = g.match;
    return { phase: g.phase, pending: g.pending ? { team: g.pending.request.team, type: g.pending.request.type, options: g.pending.request.options.map((o) => o.id) } : null, pendingPhase: m?.pendingPhase?.type ?? null, kicking: m?.kicking ?? null, active: g.turn.active, playback: window.bloodboard.playbackActive(), modal: window.bloodboard.st.modal?.kind ?? null, waiting: window.bloodboardComputer.waitingFor() };
  });
  if (s.playback) {
    await drainTray(page);
    return true;
  }
  if (s.pending && s.pending.team === HUMAN) {
    const pick = s.pending.options.includes('receive') ? 'receive' : s.pending.options[0];
    await page.click(`.decision [data-opt="${pick}"]`);
    return true;
  }
  if (s.phase === 'pregame') {
    await page.click('#pregame-btn');
    return true;
  }
  if (s.phase === 'touchdown' || s.phase === 'halfOver') {
    await page.click('#next-drive');
    return true;
  }
  if (s.waiting !== HUMAN) return false;
  if (s.phase === 'driveSetup') {
    if (!stats.manualSetupDone) {
      // V3: the first set-up is placed by hand — Reserves Box click + pitch click, one drag — and must be drawn on the board.
      stats.manualSetupDone = true;
      await page.getByRole('button', { name: 'Clear' }).click();
      await sleep(page, 60);
      const squares = [[12, 6], [12, 7], [12, 8], [9, 5], [9, 6], [9, 7], [9, 8], [9, 9], [10, 6], [10, 7]];
      for (const [x, y] of squares) {
        await page.locator('.reserves .btnchip').first().click();
        await sleep(page, 30);
        await clickSq(page, x, y);
      }
      const chip = await page.locator('.reserves .btnchip').first().boundingBox();
      const to = await sqPoint(page, 10, 8);
      await page.mouse.move(chip.x + chip.width / 2, chip.y + chip.height / 2);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 12 });
      await page.mouse.up();
      await sleep(page, 80);
      const drawn = await st(page, () => window.bloodboard.displayGame().players.filter((p) => p.team === 'A' && p.location === 'pitch').length);
      check('your set-up against the computer: 10 players placed by clicks and 1 by drag are drawn on the pitch', drawn === 11, `${drawn} on the pitch`);
      await page.click('#confirm-setup');
      await sleep(page, 120);
      check('…and the rules engine accepts the formation', await st(page, () => window.bloodboard.game.match.setupDone.A === true));
      return true;
    }
    await page.getByRole('complementary').getByRole('button', { name: 'Default formation' }).click(); // V4: the tray has one too
    const drawn = await st(page, () => window.bloodboard.displayGame().players.filter((p) => p.team === 'A' && p.location === 'pitch').length);
    // 11 players, or all who can play when injuries left fewer (p.47).
    const can = await st(page, () => Math.min(11, window.BloodboardEngine.setupCandidates(window.bloodboard.game, 'A').length));
    if (!stats.defaultDrawnChecked) {
      stats.defaultDrawnChecked = true;
      check(`Default formation is drawn on the pitch (${can} players available)`, drawn === can && can >= 10, `${drawn} drawn`);
    }
    await page.click('#confirm-setup');
    return true;
  }
  if (s.phase === 'kickoff' && (s.pendingPhase === 'solidDefence' || s.pendingPhase === 'quickSnap')) {
    await page.click('#confirm-event');
    return true;
  }
  if (s.phase === 'kickoff') {
    const kicker = await st(page, () => {
      const g = window.bloodboard.game;
      return window.BloodboardEngine.kickerCandidates(g, g.match.kicking)[0].pos;
    });
    await clickSq(page, kicker.x, kicker.y);
    await clickSq(page, 19, 7);
    await page.click('#kickoff-btn');
    return true;
  }
  if (s.phase === 'play' && s.pendingPhase === 'charge') {
    await page.click('#end-charge');
    return true;
  }
  if (s.phase === 'play') {
    // First human Turn: use the advisor, plan its move, back out, then make one real move.
    if (!stats.advisorChecked) {
      const before = await gameJSON(page);
      await page.click('#advisor-btn');
      for (let i = 0; i < 100 && (await st(page, () => window.bloodboard.st.computer.advisor?.busy)); i++) await sleep(page, 100);
      const rec = await st(page, () => document.querySelector('#advisor-rec')?.textContent ?? document.querySelector('#advisor-card')?.textContent ?? '');
      check('the advisor recommends a legal action with probabilities and a downside', rec.length > 5 && /Main downside|end the Turn/.test(await st(page, () => document.querySelector('#advisor-card')?.textContent ?? '')), rec.slice(0, 90));
      check('the advisor changed nothing (state and dice generator)', (await gameJSON(page)) === before);
      if (await page.locator('#advisor-plan').count()) {
        await page.click('#advisor-plan');
        await waitPlan(page);
        const d = await st(page, () => !!window.bloodboard.st.draft && !!window.bloodboard.st.plan?.ok);
        check('"Plan this move" opens it as a normal plan (Plan → Review → Confirm)', d);
        await page.keyboard.press('Escape');
        check('cancelling the suggested plan leaves the game unchanged', (await gameJSON(page)) === before);
      }
      stats.advisorChecked = true;
    }
    if (!stats.humanActionDone) {
      // Move a free Human lineman one square forward through Plan → Review → Confirm.
      const mover = await st(page, () => {
        const g = window.bloodboard.game;
        const E = window.BloodboardEngine;
        const p = g.players.find((q) => q.team === 'A' && q.location === 'pitch' && q.stance === 'standing' && !q.activated && E.isOpen(g, q) && q.pos.x < 24 && !E.playerAt(g, { x: q.pos.x + 1, y: q.pos.y }) && !(g.ball.kind === 'ground' && g.ball.pos.x === q.pos.x + 1 && g.ball.pos.y === q.pos.y));
        return p ? { id: p.id, x: p.pos.x, y: p.pos.y } : null;
      });
      if (mover) {
        await page.keyboard.press('Escape'); // clear any selection left by the advisor's plan
        await sleep(page, 50);
        await clickSq(page, mover.x, mover.y);
        await clickSq(page, mover.x + 1, mover.y);
        await waitPlan(page);
        await page.getByRole('button', { name: /Review probabilities/ }).click();
        await page.click('#confirm-btn');
        await sleep(page, 100);
        await drainTray(page);
        stats.humanActionDone = true;
        const moved = await st(page, (id) => window.bloodboard.game.players.find((q) => q.id === id).pos.x, mover.id);
        check('the human coach plays an action through Plan → Review → Confirm', moved === mover.x + 1);
        return true;
      }
    }
    await page.click('#end-turn');
    stats.humanTurns++;
    return true;
  }
  return false;
}

/** Wait while the computer acts; record what can be seen. */
async function watchComputer() {
  // Up to ~3 minutes for one computer step (a whole Turn with its dice and V4 animations, on a busy machine).
  for (let i = 0; i < 2400; i++) {
    const s = await st(page, () => ({
      toAct: window.bloodboardComputer.toAct(),
      thinking: window.bloodboard.st.computer.thinking,
      playback: window.bloodboard.playbackActive(),
      by: window.bloodboard.st.playback?.by ?? null,
      pending: window.bloodboard.game.pending?.request.team ?? null,
      reason: document.querySelector('#computer-reason')?.textContent ?? '',
      phase: window.bloodboard.game.phase,
    }));
    if (s.thinking) stats.computerSawThinking = true;
    if (s.playback && s.by === 'computer') stats.computerDiceAuto = true;
    if (s.reason) stats.reasons.add(s.reason);
    if (!s.toAct && !(s.playback && s.by === 'computer')) return;
    if (s.phase === 'fullTime') return;
    // Dice of the human's own action (e.g. the roll-off before the computer chooses) wait for Continue.
    if (s.playback && s.by !== 'computer') {
      await drainTray(page);
      continue;
    }
    await sleep(page, 60);
  }
  throw new Error('the computer did not finish');
}

// First computer action with the normal (slow) pace: its dice advance by themselves.
let loops = 0;
let turnSeen = false;
while ((await st(page, () => window.bloodboard.game.phase)) !== 'fullTime') {
  if (loops++ > 3000) throw new Error('match did not finish');
  const toAct = await st(page, () => window.bloodboardComputer.toAct());
  if (toAct) {
    const phase = await st(page, () => window.bloodboard.game.phase);
    if (phase === 'play' && !stats.blockedClick) {
      const before = await st(page, () => window.bloodboard.game.log.length);
      await clickSq(page, 5, 5);
      const toast = await st(page, () => window.bloodboard.st.toast?.text ?? '');
      stats.blockedClick = /computer/.test(toast);
      check('clicks on the board are ignored during the computer\'s Turn (with a message)', stats.blockedClick && (await st(page, () => window.bloodboard.game.log.length)) >= before, toast);
    }
    if (phase === 'play' && !turnSeen) {
      turnSeen = true;
      const txt = await st(page, () => document.querySelector('.side')?.textContent ?? '');
      check('the side panel says it is the computer\'s Turn', /computer/i.test(txt));
    }
    const logBefore = await st(page, () => window.bloodboard.game.log.length);
    await watchComputer();
    const logAfter = await st(page, () => window.bloodboard.game.log.length);
    stats.computerActions += Math.max(0, logAfter - logBefore);
    // After the first real computer Turn, speed the computer up for the rest of the match.
    if (turnSeen && !(await st(page, () => window.bloodboard.st.computer.fast))) {
      check('the computer\'s own dice appear in the tray and advance by themselves', stats.computerDiceAuto);
      await st(page, () => { window.bloodboard.st.computer.fast = true; window.bloodboard.emit(); });
    }
    continue;
  }
  // Undo in a computer match: after the computer has answered the human's first End Turn.
  if (!stats.undoChecked && stats.humanTurns === 1 && (await st(page, () => window.bloodboard.game.phase)) === 'play' && !(await st(page, () => window.bloodboard.playbackActive() || !!window.bloodboard.game.pending))) {
    const entry = await st(page, () => window.bloodboard.undoEntry());
    if (entry && entry.computerActions > 0) {
      const logLen = await st(page, () => window.bloodboard.game.log.length);
      await page.click('#undo-btn');
      await page.click('#confirm-undo');
      await sleep(page, 100);
      const after = await st(page, () => ({ log: window.bloodboard.game.log.length, active: window.bloodboard.game.turn.active, cpu: window.bloodboardComputer.toAct() }));
      check('Undo in a computer match takes back the human action and the computer replies after it', after.log < logLen && after.active === 'A' && !after.cpu, `${logLen} → ${after.log} log entries; ${entry.computerActions} computer actions taken back`);
      stats.undoChecked = true;
      continue;
    }
  }
  const did = await humanStep();
  if (!did) await sleep(page, 50);
}
await drainTray(page);
const g = await st(page, () => ({ phase: window.bloodboard.game.phase, score: [window.bloodboard.game.teams.A.score, window.bloodboard.game.teams.B.score], half: window.bloodboard.game.match.half, result: window.bloodboard.game.match.result, log: window.bloodboard.game.log.length }));
check('the match reaches full time through both halves', g.phase === 'fullTime' && g.half === 2 && !!g.result, JSON.stringify(g));
check('the computer showed "Thinking…" while choosing', stats.computerSawThinking);
check('the computer played many actions through the normal flow', stats.computerActions > 20, `${stats.computerActions} log entries`);
check('the computer explained its choices', stats.reasons.size > 5, `${stats.reasons.size} distinct reasons, e.g. "${[...stats.reasons][2]?.slice(0, 120)}"`);
const cpuLog = await st(page, () => window.bloodboard.game.log.filter((e) => e.input?.kind === 'playerAction' && e.input.playerId.startsWith('B')).length);
const cpuPlans = await st(page, () => window.bloodboard.game.log.filter((e) => e.input?.kind === 'playerAction' && e.input.playerId.startsWith('B') && e.plan).length);
check('the computer\'s actions are in the log with their probabilities', cpuLog > 10 && cpuPlans >= cpuLog * 0.9, `${cpuPlans}/${cpuLog}`);
check('Undo was exercised', stats.undoChecked);
check('the full-time card is shown', /Full time/.test(await st(page, () => document.querySelector('.matchcard')?.textContent ?? '')));
check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await page.screenshot({ path: 'build/ui-ai-fulltime.png' });
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed in ${((Date.now() - t0) / 1000).toFixed(0)} s (human Turns ended: ${stats.humanTurns}).`);
process.exit(failed.length ? 1 : 0);
