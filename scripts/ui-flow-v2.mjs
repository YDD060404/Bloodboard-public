// End-to-end UI flows for v2 (Practice, League / Tournament match, Block School, tutorials, editor, undo).
// Run after `node scripts/build.mjs`:  node scripts/ui-flow-v2.mjs
import { open, toPractice, clickSq, waitPlan, gameJSON, drainTray } from './ui-helpers.mjs';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const st = (page, fn) => page.evaluate(fn);
async function answerDecisions(page, pick = (req) => req.options[0].id) {
  for (let i = 0; i < 30; i++) {
    await drainTray(page);
    const req = await st(page, () => window.bloodboard.game.pending?.request ?? null);
    if (!req) return;
    const id = pick(req);
    await page.click(`.decision [data-opt="${id}"]`);
    await page.waitForTimeout(80);
  }
}

/** V3: the Teaching area starts collapsed — open the course (and level) before clicking a lesson. */
async function expand(page, sel) {
  const el = page.locator(sel).first();
  if ((await el.getAttribute('aria-expanded')) !== 'true') await el.click();
  await page.waitForTimeout(40);
}
async function openEx(page, id) {
  await st(page, () => window.bloodboard.set({ screen: 'learn' }));
  await expand(page, '#course-blockschool');
  await expand(page, `[data-level="${id.match(/^L(\d)/)[1]}"]`);
  await page.click(`[data-ex="${id}"]`);
}
async function openTut(page, id) {
  await st(page, () => window.bloodboard.set({ screen: 'learn' }));
  await expand(page, '#course-tutorials');
  await expand(page, `[data-lesson-toggle="${id}"]`);
  await page.click(`[data-lesson="${id}"]`);
}

const { browser, page, errors } = await open({ home: true });

// ---------------------------------------------------------------- Practice
await toPractice(page);
check('practice opens on the board', await st(page, () => window.bloodboard.st.screen === 'board' && window.bloodboard.st.ctx.kind === 'practice'));
await clickSq(page, 17, 7); // catcher #7
const reach = await st(page, () => document.querySelectorAll('.pitch .reach').length);
const rush = await st(page, () => document.querySelectorAll('.pitch .reach.rush').length);
check('selecting a player shows green and yellow reachable squares', reach > 20 && rush > 0, `${reach} squares, ${rush} Rush`);
const before = await gameJSON(page);
await clickSq(page, 24, 3);
await waitPlan(page);
const draft = await st(page, () => window.bloodboard.st.draft);
check('clicking a reachable square creates a Move plan along an auto-route', draft && draft.action === 'move' && draft.path.length > 0 && draft.auto, JSON.stringify(draft?.auto));
check('planning did not change the game (state and RNG)', (await gameJSON(page)) === before);
await page.keyboard.press('Backspace');
await waitPlan(page);
check(`one Backspace cancels the whole ${draft.path.length}-square plan (V3); nothing changed`, (await st(page, () => window.bloodboard.st.draft)) === null && (await gameJSON(page)) === before);
if (!(await st(page, () => window.bloodboard.st.selected))) await clickSq(page, 17, 7);
await clickSq(page, 24, 3);
await waitPlan(page);
await page.getByRole('button', { name: /Review probabilities/ }).click();
if (!(await st(page, () => window.bloodboard.st.logOpen))) await page.click('#log-toggle'); // V3: the log starts collapsed
await page.click('#confirm-btn');
await page.waitForTimeout(150);
const pb = await st(page, () => ({ active: window.bloodboard.playbackActive(), dice: document.querySelectorAll('.tray .traydice .die').length }));
check('confirming shows the dice tray and pauses after the first roll', pb.active && pb.dice > 0, JSON.stringify(pb));
const logEventsVisible = await st(page, () => document.querySelectorAll('.log-entry.open .events li').length);
await drainTray(page);
await answerDecisions(page);
const logAll = await st(page, () => window.bloodboard.game.log[window.bloodboard.game.log.length - 1].events.length);
check('the log reveals events in step with the tray', logEventsVisible < logAll, `${logEventsVisible} while rolling, ${logAll} after`);
const trayDice = await st(page, () => window.bloodboard.st.playback.events.flatMap((e) => (e.dice ?? []).flatMap((d) => d.faces)).join(','));
const logText = await st(page, () => window.bloodboard.game.log[window.bloodboard.game.log.length - 1].events.map((e) => e.text).join('\n'));
check('tray dice match the log (every rolled face is reported)', trayDice.length > 0 && trayDice.split(',').every((f) => logText.includes(f)), trayDice);
const afterAction = await gameJSON(page);
await page.click('#practice-replay');
await page.waitForTimeout(100);
await drainTray(page);
await answerDecisions(page);
check('Replay re-runs the recorded action with exactly the same dice and result', (await gameJSON(page)) === afterAction);
await page.keyboard.press('Delete');
await page.waitForTimeout(80);
check('Delete with nothing planned asks before undoing', await st(page, () => window.bloodboard.st.modal?.kind === 'undo'));
await page.keyboard.press('Enter');
await page.waitForTimeout(100);
check('Undo restores the full prior state (board, log, RNG)', (await gameJSON(page)) === before);
await page.click('#practice-seed');
await page.waitForTimeout(80);
check('New seed changes the dice seed and resets', await st(page, () => window.bloodboard.game.rng.seed !== 20260925 && window.bloodboard.game.log.length === 0));
await page.screenshot({ path: 'build/shots/v2-flow-practice.png' });

// ---------------------------------------------------------------- Editor: practice vs formal start
await page.getByRole('button', { name: 'Edit position' }).click();
await page.waitForTimeout(80);
await st(page, () => { window.bloodboard.game.ball = { kind: 'none' }; window.bloodboard.emit(); });
await page.click('#start-formal');
await page.waitForTimeout(80);
const formalToast = await st(page, () => window.bloodboard.st.toast?.text ?? '');
check('a formal match position without a ball is rejected with the reason', /no ball on the pitch/.test(formalToast), formalToast.slice(0, 90));
check('…and nothing started', await st(page, () => window.bloodboard.st.view === 'setup'));
await page.click('#start-practice');
await page.waitForTimeout(80);
check('the same position starts as a practice scenario', await st(page, () => window.bloodboard.st.view === 'play' && window.bloodboard.game.ball.kind === 'none'));

// ---------------------------------------------------------------- League teams and a match
await page.click('.nav .segbtn:nth-child(1)'); // Home
await page.click('#mode-league');
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Add two starter teams' }).click();
await page.waitForTimeout(400);
const nTeams = await page.locator('.teamlist li').count();
check('League: two starter teams saved', nTeams >= 2, `${nTeams}`);
await page.locator('.teamlist li .linkbtn').first().click();
await page.waitForTimeout(80);
await page.locator('table.roster:not(.inducementTable):not(.starTable):not(.moneytable) tbody tr').first().click();
await page.keyboard.press('Delete');
await page.waitForTimeout(60);
// V5.5 (request item 7): an ordinary edit — the player is removed at once, no dialog; Undo puts them back.
const nPlayers = () => st(page, () => window.bloodboard.st.teamEdit?.players.length ?? 0);
const nAfter = await nPlayers();
check('Delete on a selected team player removes them at once (no confirmation dialog)', await st(page, () => window.bloodboard.st.modal === null) && (await page.locator('#team-undo').count()) === 1, `${nAfter} players`);
await page.keyboard.press('Control+z');
await page.waitForTimeout(80);
check('…and Ctrl+Z (Undo) puts the player back', (await nPlayers()) === nAfter + 1);
await page.click('#save-team').catch(() => {});
await page.waitForTimeout(150);
// V5.5: the League match set-up (Player 1 / Player 2), two human coaches, the two starter teams.
await page.click('.brand');
await page.waitForTimeout(150);
await page.click('#league-setup');
await page.waitForTimeout(300);
await page.click('#p1-controller-human');
await page.click('#p2-controller-human');
await page.waitForTimeout(80);
{
  const lt = await st(page, () => [...document.querySelectorAll('#p1-team option')].map((o) => o.value).filter(Boolean));
  await page.selectOption('#p1-team', lt[0]);
  await page.waitForTimeout(80);
  await page.selectOption('#p2-team', lt[1] ?? lt[0]);
  await page.waitForTimeout(120);
}
await page.click('#start-match');
await page.waitForTimeout(150);
check('a League match starts in the pre-game', await st(page, () => window.bloodboard.game.phase === 'pregame' && window.bloodboard.st.ctx.kind === 'match'));
await page.click('#pregame-btn');
await page.waitForTimeout(100);
await answerDecisions(page);
check('pre-game → set-up', await st(page, () => window.bloodboard.game.phase === 'driveSetup'));
await page.getByRole('button', { name: 'Clear' }).click();
await page.click('#confirm-setup');
await page.waitForTimeout(100);
const rej = await st(page, () => ({ phase: window.bloodboard.game.phase, toast: window.bloodboard.st.toast?.text ?? '' }));
check('an illegal set-up is rejected with the rule (p.47)', rej.phase === 'driveSetup' && /set up 11 players|Line of Scrimmage/.test(rej.toast), rej.toast.slice(0, 100));
await page.getByRole('complementary').getByRole('button', { name: 'Default formation' }).click(); // V4: the tray has one too
await page.click('#confirm-setup');
await page.waitForTimeout(100);
await drainTray(page);
await page.click('#confirm-setup');
await page.waitForTimeout(100);
await drainTray(page);
check('both teams set up → kick-off', await st(page, () => window.bloodboard.game.phase === 'kickoff'));
await page.screenshot({ path: 'build/shots/v2-flow-kickoff.png' });
const kick = await st(page, () => {
  const g = window.bloodboard.game;
  const k = g.match.kicking;
  const kicker = window.BloodboardEngine.kickerCandidates(g, k)[0];
  return { kicker: kicker.pos, target: k === 'A' ? { x: 20, y: 7 } : { x: 5, y: 7 } };
});
await clickSq(page, kick.kicker.x, kick.kicker.y);
await clickSq(page, kick.target.x, kick.target.y);
await page.click('#kickoff-btn');
await page.waitForTimeout(100);
for (let i = 0; i < 8; i++) {
  await answerDecisions(page);
  const ph = await st(page, () => ({ phase: window.bloodboard.game.phase, pp: window.bloodboard.game.match.pendingPhase?.type ?? null }));
  if (ph.pp === 'solidDefence' || ph.pp === 'quickSnap') await page.click('#confirm-event');
  else if (ph.pp === 'charge') await page.click('#end-charge');
  else break;
  await page.waitForTimeout(100);
}
const afterKick = await st(page, () => ({ phase: window.bloodboard.game.phase, ball: window.bloodboard.game.ball.kind, active: window.bloodboard.game.turn.active, recv: window.bloodboard.game.match.kicking === 'A' ? 'B' : 'A' }));
check('kick-off → the receiving team plays Turn 1 with the ball in play', afterKick.phase === 'play' && afterKick.ball !== 'none' && afterKick.active === afterKick.recv, JSON.stringify(afterKick));
await page.click('#end-turn');
await page.waitForTimeout(100);
check('End Turn ends the Turn at once (no confirmation dialog, V3)', await st(page, () => window.bloodboard.st.modal === null));
await drainTray(page);
check('End Turn hands over to the kicking team', await st(page, () => window.bloodboard.game.turn.active !== window.bloodboard.game.log.slice(-1)[0].team || window.bloodboard.game.phase !== 'play'));
await page.screenshot({ path: 'build/shots/v2-flow-match.png' });

// ---------------------------------------------------------------- Tournament rejection
await page.click('.nav .segbtn:nth-child(3)'); // Teams
await page.waitForTimeout(100);
await st(page, () => window.bloodboard.set({ teamKind: 'tournament', teamEdit: null }));
await page.waitForTimeout(100);
await page.click('#new-team');
await page.waitForTimeout(60);
await page.locator('.addplayers button').first().click();
await page.click('#save-team');
await page.waitForTimeout(150);
// V5.5: the one-player Tournament team chosen for Player 1 in the Tournament set-up — refused before the match.
{
  const t = await st(page, () => ({ id: window.bloodboard.st.teamEdit?.id, fmt: window.bloodboard.st.teamEdit?.variant === 'sevens' ? 'sevens' : 'standard' }));
  await page.click('.brand');
  await page.waitForTimeout(150);
  await page.click('#tournament-setup');
  await page.waitForTimeout(300);
  await page.click(`#setup-format-${t.fmt}`);
  await page.waitForTimeout(120);
  await page.click('#p1-source-saved');
  await page.waitForTimeout(150);
  const opt = await st(page, () => [...document.querySelectorAll('#p1-team option')].map((o) => [o.value, o.textContent]));
  const one = t.id && opt.some(([v]) => v === t.id) ? t.id : opt.find(([v]) => v)?.[0];
  await page.selectOption('#p1-team', one);
  await page.waitForTimeout(150);
}
const errText = await page.locator('#p1-errors').textContent().catch(() => '');
const startOff = await st(page, () => document.querySelector('#start-match')?.disabled === true);
check('Tournament: a team that breaks the draft template cannot start a match', /at least (11|7)/.test(errText ?? '') && startOff, (errText ?? '').slice(0, 100));

// ---------------------------------------------------------------- Block School
await page.click('.nav .segbtn:nth-child(4)'); // Teaching
await page.waitForTimeout(80);
check('Teaching: one area with both courses, collapsed by default', await st(page, () => document.querySelectorAll('.tcourse').length === 2 && document.querySelectorAll('[data-ex], [data-lesson]').length === 0));
await openEx(page, 'L1E1');
await page.waitForTimeout(80);
check('Block School exercise opens on a cropped board with workbook labels', await st(page, () => document.querySelectorAll('.pitch .wblabel').length > 5));
await page.getByRole('button', { name: /^1D/ }).click();
await page.waitForTimeout(60);
check('a correct count is confirmed', await st(page, () => window.bloodboard.st.lesson.result?.correct === true));
await page.click('[data-ex]').catch(() => {});
await openEx(page, 'L3E6');
await page.getByRole('button', { name: /^3D/ }).click();
await page.waitForTimeout(60);
check('a wrong count is explained with the engine breakdown', await st(page, () => window.bloodboard.st.lesson.result?.correct === false && document.querySelectorAll('.breakdown li').length > 2));
await page.getByRole('button', { name: 'Show solution' }).click();
await page.waitForTimeout(60);
check('the solution appears after an attempt, with the workbook page', await st(page, () => /Workbook answer: 2D \(p\.34\)/.test(document.querySelector('.solution')?.textContent ?? '')));
await openEx(page, 'L7E7');
await page.waitForTimeout(80);
const d4 = await st(page, () => window.BloodboardEngine.parseLessonLabel('D4'));
await clickSq(page, d4.x, d4.y);
await page.waitForTimeout(80);
check('Level 7: moving X2 to D4 gives a 2D block', await st(page, () => window.bloodboard.st.lesson.result?.correct === true && window.bloodboard.st.lesson.result?.breakdown?.code === '2D'));
await page.screenshot({ path: 'build/shots/v2-flow-blockschool.png' });
await page.getByRole('button', { name: 'Play it out with dice' }).click();
await page.waitForTimeout(60);
const x1 = await st(page, () => window.bloodboard.player('X1').pos);
const y1 = await st(page, () => window.bloodboard.player('Y1').pos);
await clickSq(page, x1.x, x1.y);
await page.getByRole('button', { name: 'Block', exact: true }).click();
await clickSq(page, y1.x, y1.y);
await waitPlan(page);
check('the exercise can be played out with Plan → Review', await st(page, () => window.bloodboard.st.plan?.ok === true));

// ---------------------------------------------------------------- Tutorial
await openTut(page, 'T1');
await page.waitForTimeout(80);
await clickSq(page, 15, 7);
await clickSq(page, 25, 7);
await waitPlan(page);
await page.getByRole('button', { name: /Review probabilities/ }).click();
await page.click('#confirm-btn');
await page.waitForTimeout(100);
await answerDecisions(page, (req) => req.options.find((o) => o.id === 'team')?.id ?? req.options[0].id);
const tut = await st(page, () => window.bloodboard.st.lesson.status);
check('tutorial objective is checked after the action', tut === 'done' || tut === 'failed', tut);
await page.screenshot({ path: 'build/shots/v2-flow-tutorial.png' });

// ---------------------------------------------------------------- Block dice: tray = decision = log
await st(page, () => window.bloodboardOpenPractice(1)); // Blitz the ball carrier (V5: no Practice card on Home)
await page.waitForTimeout(200);
await clickSq(page, 12, 7);
await page.getByRole('button', { name: 'Blitz', exact: true }).click();
for (const [x, y] of [[8, 7], [11, 7], [10, 7], [9, 7]]) await clickSq(page, x, y);
await waitPlan(page);
await page.getByRole('button', { name: /Review probabilities/ }).click();
await page.click('#confirm-btn');
await page.waitForTimeout(150);
let blockSeen = null;
let decisionWhileRolling = false;
for (let i = 0; i < 40 && !blockSeen; i++) {
  const stage = await st(page, () => {
    const dice = [...document.querySelectorAll('.tray .traygroup .die.block small')].map((e) => e.textContent);
    const text = document.querySelector('.tray .traytext')?.textContent ?? '';
    return { dice, text, active: window.bloodboard.playbackActive(), decision: !!document.querySelector('.card.decision') };
  });
  if (stage.active && stage.decision) decisionWhileRolling = true;
  if (stage.dice.length) blockSeen = stage;
  else if (stage.active) await page.click('#tray-continue');
  else break;
  await page.waitForTimeout(60);
}
await drainTray(page);
const pend2 = await st(page, () => (document.querySelector('.card.decision') ? window.bloodboard.game.pending?.request?.context?.pool ?? null : null));
const pend = decisionWhileRolling ? 'shown too early' : null;
const labels = await st(page, () => window.BloodboardEngine.BLOCK_FACE_LABEL);
check('block dice in the tray are the faces the event reports', !!blockSeen && blockSeen.dice.every((d) => blockSeen.text.includes(d)), JSON.stringify(blockSeen));
check('the block-dice decision is offered only after the dice were shown, with the same faces', pend === null && !!pend2 && pend2.map((f) => labels[f]).sort().join() === blockSeen.dice.slice().sort().join(), JSON.stringify({ pend, pend2 }));
await answerDecisions(page);

check('no console errors', errors.length === 0, errors.join(' | ').slice(0, 300));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} UI checks passed`);
process.exit(failed.length ? 1 : 0);
