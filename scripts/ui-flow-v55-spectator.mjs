// V5.5 interface flow — spectator matches (request item 11): computer for both Player 1 and Player 2 starts a
// watchable full match in every mode — Exhibition (Sevens), Tournament (11-a-side), League, All-Star (Sevens) — with
// Pause / Resume and the speed control, the dice tray and the log; each plays to full time through the ordinary engine
// flow. Watching cannot change the outcome: the same fixed seed played once straight through and once with pauses and
// resumes and a speed change gives the identical match.
// Run after `node scripts/build.mjs`:  node scripts/ui-flow-v55-spectator.mjs
import { open, drainTray } from './ui-helpers.mjs';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const { browser, page, errors } = await open({ home: true, width: 1470, height: 920 });
const st = (fn, arg) => page.evaluate(fn, arg);
const sleep = (ms) => page.waitForTimeout(ms);
const t0 = Date.now();
async function waitFor(fn, arg, ms, step = 500) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await st(fn, arg);
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(step);
  }
}

// League teams for the League spectator match.
await st(async () => {
  const E = window.BloodboardEngine;
  const app = window.bloodboard;
  for (const [id, roster, comp] of [['spec-orcs', 'orc', [['blitzer', 2], ['bigUn', 2], ['thrower', 1], ['lineman', 6]]], ['spec-humans', 'human', [['blitzer', 2], ['catcher', 2], ['thrower', 1], ['lineman', 6]]]]) {
    const t = E.newTeamDef('league', roster, `Spectator ${roster}`, id);
    let n = 1;
    for (const [pos, k] of comp) for (let i = 0; i < k; i++) t.players.push(E.playerFromRoster(E.ROSTER_BY_ID[roster], pos, n, `${id}-${n++}`));
    t.rerolls = 2;
    await app.teamStore.save(t.id, JSON.stringify(t, null, 1));
  }
});
await page.reload();
await sleep(500);

/** Set up a computer v computer match of `mode` and start it (fixed seed when given). */
async function startCvC(mode, { format = null, seed = null } = {}) {
  await page.click('.brand');
  await sleep(200);
  if (mode === 'allstar') await page.click('#mode-allstar');
  else await page.click(`#${mode}-setup`);
  await sleep(300);
  if (format && mode !== 'league') {
    await page.click(`#setup-format-${format}`);
    await sleep(150);
  }
  await page.click('#p1-controller-computer');
  await page.click('#p2-controller-computer');
  await sleep(150);
  await page.selectOption('#p1-ai', 'bloodboard-offensive');
  await page.selectOption('#p2-ai', 'bloodboard-defensive');
  if (mode === 'league') {
    await page.selectOption('#p1-team', 'spec-orcs');
    await sleep(100);
    await page.selectOption('#p2-team', 'spec-humans');
  }
  if (seed !== null) {
    await page.selectOption('#setup-seedmode', 'fixed');
    await sleep(100);
    await page.fill('#setup-seed', String(seed));
    await page.press('#setup-seed', 'Tab');
  } else if (await page.locator('#setup-seedmode').count()) await page.selectOption('#setup-seedmode', 'random');
  await sleep(150);
  const label = await st(() => document.querySelector('#start-match')?.textContent ?? '');
  await page.click('#start-match');
  await sleep(400);
  return label;
}
const speed = async (k) => {
  await page.click(`#computer-speed [data-speed="${k}"]`);
  await sleep(100);
};
const snap = () => st(() => { const g = window.bloodboard.game; return { phase: g.phase, log: g.log.length, score: [g.teams.A.score, g.teams.B.score], coaches: g.match?.options.coaches }; });
/** The whole match as text (every event of every log entry), to compare two runs. */
const matchText = () => st(() => window.bloodboard.game.log.map((e) => e.events.map((v) => v.text).join('|')).join('\n'));

for (const [mode, format, minutes] of [['exhibition', 'sevens', 10], ['tournament', 'standard', 25], ['league', null, 25], ['allstar', 'sevens', 12]]) {
  const label = await startCvC(mode, { format });
  const s0 = await snap();
  check(`${mode}${format ? ` (${format})` : ''}: “${label.trim()}” starts a match with the computer coaching both teams`, /watch the computer/i.test(label) && s0.coaches?.A?.ai === 'bloodboard-offensive' && s0.coaches?.B?.ai === 'bloodboard-defensive', JSON.stringify(s0.coaches));
  await speed('instant');
  // Pause / Resume while it plays.
  await waitFor(() => window.bloodboard.game.log.length > 12, undefined, 60000, 200);
  await page.click('#computer-pause');
  await sleep(1500);
  const p1 = await snap();
  await sleep(2500);
  const p2 = await snap();
  const pausedUi = await st(() => !!document.querySelector('#computer-paused'));
  check(`${mode}: Pause stops the computers (nothing happens while paused)`, pausedUi && p1.log === p2.log, `${p1.log} → ${p2.log}`);
  // The action log opens with "Show log" (it starts collapsed so the pitch keeps its room).
  if (await st(() => !window.bloodboard.st.logOpen)) await page.locator('.log button', { hasText: 'Show log' }).click().catch(() => {});
  await sleep(300);
  const inspect = await st(() => ({ log: document.querySelectorAll('.log li').length, logOpen: window.bloodboard.st.logOpen, tray: !!document.querySelector('.trayhost .tray, .trayhost'), speeds: [...document.querySelectorAll('#computer-speed [data-speed]')].map((b) => b.getAttribute('data-speed')) }));
  check(`${mode}: the board, the dice tray, the log and the speed control (Slow / Normal / Fast / Instant) can be inspected`, inspect.log > 0 && inspect.tray && inspect.speeds.join(',') === 'slow,normal,fast,instant', JSON.stringify(inspect));
  await page.click('#computer-pause');
  const done = await waitFor(() => window.bloodboard.game.phase === 'fullTime', undefined, minutes * 60000, 1000);
  await drainTray(page);
  const end = await snap();
  check(`${mode}: the watched match reaches full time`, !!done && end.phase === 'fullTime', JSON.stringify({ phase: end.phase, score: end.score, log: end.log }));
}

// Watching cannot change the outcome: the same seed, once straight through, once with pauses and a speed change.
const SEED = 424242;
await startCvC('exhibition', { format: 'sevens', seed: SEED });
await speed('instant');
await waitFor(() => window.bloodboard.game.phase === 'fullTime', undefined, 10 * 60000, 500);
await drainTray(page);
const runA = await matchText();
await startCvC('exhibition', { format: 'sevens', seed: SEED });
await speed('instant');
for (let i = 0; i < 4; i++) {
  await waitFor((n) => window.bloodboard.game.log.length > n, 10 + i * 25, 120000, 200);
  await page.click('#computer-pause');
  await sleep(800);
  await speed(i % 2 ? 'fast' : 'instant');
  await page.click('#computer-pause');
}
await speed('instant');
await waitFor(() => window.bloodboard.game.phase === 'fullTime', undefined, 10 * 60000, 500);
await drainTray(page);
const runB = await matchText();
check('the same seed watched straight through and with pauses / speed changes gives the identical match (watching never changes the dice)', runA.length > 1000 && runA === runB, `${runA.length} v ${runB.length} characters`);

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} spectator checks passed (${Math.round((Date.now() - t0) / 1000)} s); page errors: ${errors.length}`);
if (errors.length) console.log(errors.join('\n'));
await browser.close();
process.exit(results.every((r) => r.ok) && !errors.length ? 0 : 1);
