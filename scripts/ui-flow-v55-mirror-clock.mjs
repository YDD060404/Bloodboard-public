// V5.5 interface flow — the same saved team on both sides, and the match timer:
//  A. both players choose the same saved team (11-a-side Exhibition, Human v Computer): no "choose two different
//     teams", a note explains the copy; Player 2 shows "*" and inverted colours; unique team / player ids; the saved
//     team in storage is unchanged;
//  B. Sevens, computer v computer with the same saved team: it plays; saving and reopening the match keeps both
//     teams, the mirror record and the timer; it plays on after reopening;
//  C. the timer: total and each side's time in the scoreboard (no extra height above the pitch); the running side is
//     the one acting (the computer thinking included); a decision that belongs to the other side counts for that
//     side; Pause stops it, Resume continues; it stops at full time.
// Run after `node scripts/build.mjs`:  node scripts/ui-flow-v55-mirror-clock.mjs
import { open, drainTray } from './ui-helpers.mjs';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const { browser, page, errors } = await open({ home: true, width: 1470, height: 920 });
const st = (fn, arg) => page.evaluate(fn, arg);
const sleep = (ms) => page.waitForTimeout(ms);
async function waitFor(fn, arg, ms = 30000, step = 50) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await st(fn, arg);
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(step);
  }
}

// Two saved teams (with a bought skill each), written to the team storage, then a restart.
await st(async () => {
  const E = window.BloodboardEngine;
  const app = window.bloodboard;
  const std = E.buildTeam('human', { format: 'standard', play: 'exhibition', id: 'mirror-humans', name: 'Mirror Humans' });
  const sev = E.buildTeam('orc', { format: 'sevens', play: 'exhibition', id: 'mirror-orcs', name: 'Mirror Orcs' });
  await app.teamStore.save(std.id, JSON.stringify(std, null, 1));
  await app.teamStore.save(sev.id, JSON.stringify(sev, null, 1));
});
await page.reload();
await sleep(500);
const savedJSON = (id) => st(async (id) => window.bloodboard.teamStore.load(id), id);
const humBefore = await savedJSON('mirror-humans');
const orcBefore = await savedJSON('mirror-orcs');

// ------------------------------------------------------------------ A. 11-a-side, Human v Computer, the same saved team
await page.click('#exhibition-setup');
await sleep(300);
await page.click('#setup-format-standard');
await sleep(150);
await page.click('#p1-controller-human');
await page.click('#p2-controller-computer');
await sleep(100);
await page.click('#p1-source-saved');
await sleep(200);
await page.selectOption('#p1-team', 'mirror-humans');
await sleep(150);
await page.click('#p2-source-saved');
await sleep(200);
await page.selectOption('#p2-team', 'mirror-humans');
await sleep(200);
const setupA = await st(() => ({ disabled: document.querySelector('#start-match')?.disabled, title: document.querySelector('#start-match')?.title, notes: document.querySelector('#p2-notes')?.textContent ?? '', page: document.body.textContent }));
check('A: the same saved team for both players is accepted (Start enabled, no “Choose two different teams”)', !setupA.disabled && !/two different teams/i.test(setupA.page), setupA.title);
check('A: a note says Player 2 plays an independent copy with “*” and inverted colours', /independent match copy/.test(setupA.notes) && /Mirror Humans\*/.test(setupA.notes) && /inverted colours/.test(setupA.notes), setupA.notes);
await page.click('#start-match');
await sleep(600);
const mA = await st(() => {
  const g = window.bloodboard.game;
  const ids = g.players.map((p) => p.id);
  return { screen: window.bloodboard.st.screen, a: g.teams.A.name, b: g.teams.B.name, ca: [g.teams.A.color, g.teams.A.accent], cb: [g.teams.B.color, g.teams.B.accent], teamIds: g.match.teamIds, mirror: g.match.mirror, unique: new Set(ids).size === ids.length, defs: g.players.filter((p) => p.team === 'B').every((p) => /\*p2$/.test(p.defId)), board: document.querySelector('.scoreboard')?.textContent ?? '' };
});
check('A: the match starts; Player 2’s team is shown as “Mirror Humans*”', mA.screen === 'board' && mA.a === 'Mirror Humans' && mA.b === 'Mirror Humans*' && /Mirror Humans\*/.test(mA.board), `${mA.a} / ${mA.b}`);
check('A: Player 2’s colours are inverted (primary and accent swapped)', mA.cb[0] === mA.ca[1] && mA.cb[1] === mA.ca[0], JSON.stringify([mA.ca, mA.cb]));
check('A: independent copies — unique team ids and player ids, recorded as a mirror of the saved team', mA.teamIds.A === 'mirror-humans' && mA.teamIds.B !== mA.teamIds.A && mA.unique && mA.defs && mA.mirror?.team === 'B' && mA.mirror?.of === 'mirror-humans', JSON.stringify({ t: mA.teamIds, m: mA.mirror }));
check('A: the saved team in storage is unchanged', (await savedJSON('mirror-humans')) === humBefore);

// ------------------------------------------------------------------ C1. timer layout
const layout = await st(() => {
  const sb = document.querySelector('.scorewrap')?.getBoundingClientRect();
  return { total: document.querySelector('#clock-total')?.textContent ?? null, a: document.querySelector('#clock-A')?.textContent ?? null, b: document.querySelector('#clock-B')?.textContent ?? null, pause: !!document.querySelector('#clock-pause'), h: sb?.height ?? 0 };
});
await page.screenshot({ path: 'build/shots/v55-mirror-timer.png', clip: { x: 0, y: 0, width: 1470, height: 260 } });
check('C: the scoreboard shows the total match time, each side’s time and a Pause control', /⏱ \d+:\d\d/.test(layout.total ?? '') && /⏱/.test(layout.a ?? '') && /⏱/.test(layout.b ?? '') && layout.pause, JSON.stringify(layout));

// Hot-seat test position for the timer: a Block whose die the defender chooses (a decision of the other side).
async function hotSeatBlock() {
  await st(() => {
    const app = window.bloodboard;
    const E = window.BloodboardEngine;
    const g = E.cloneState(app.game);
    delete g.pending;
    g.phase = 'play';
    g.match.options = { ...g.match.options, coaches: {}, computer: undefined };
    for (const p of g.players) {
      p.location = 'reserves';
      p.pos = null;
      p.activated = false;
    }
    const a = g.players.find((p) => p.team === 'A');
    const b = g.players.find((p) => p.team === 'B');
    const b2 = g.players.filter((p) => p.team === 'B')[1];
    Object.assign(a, { location: 'pitch', pos: { x: 10, y: 7 }, stance: 'standing', st: 3, skills: [] });
    Object.assign(b, { location: 'pitch', pos: { x: 11, y: 7 }, stance: 'standing', st: 5 });
    Object.assign(b2, { location: 'pitch', pos: { x: 20, y: 3 }, stance: 'standing' });
    g.ball = { kind: 'ground', pos: { x: 3, y: 3 } };
    g.turn.active = 'A';
    g.turn.activation = null;
    g.teams.A.turn = 2;
    g.teams.B.turn = 1;
    g.teams.A.rerolls = 0;
    g.teams.A.leaderReroll = false;
    const clock = { ...app.st.clock };
    app.openBoard(g, { kind: 'match', matchKind: 'tournament' }, { docName: 'timer check' });
    app.st.clock = clock;
    app.st.pauseDice = false;
    app.emit();
  });
  await sleep(200);
}
await hotSeatBlock();
const clk = () => st(() => ({ ...window.bloodboard.st.clock }));
let c0 = await clk();
await sleep(1600);
let c1 = await clk();
check('C: on Player 1’s Turn the total and Player 1’s time run; Player 2’s time does not', c1.totalMs - c0.totalMs > 1000 && c1.A - c0.A > 1000 && c1.B === c0.B, JSON.stringify({ c0, c1 }));
const running = await st(() => ({ a: document.querySelector('#clock-A')?.classList.contains('running'), b: document.querySelector('#clock-B')?.classList.contains('running') }));
check('C: the running side is highlighted', running.a && !running.b, JSON.stringify(running));
// A seed whose two Block dice differ (so the defender really has to choose).
await st(() => {
  const app = window.bloodboard;
  const E = window.BloodboardEngine;
  const a = app.game.players.find((p) => p.team === 'A' && p.location === 'pitch');
  const b = app.game.players.find((p) => p.team === 'B' && p.location === 'pitch' && p.pos.x === 11);
  const input = { kind: 'playerAction', playerId: a.id, action: 'block', path: [], blockTarget: b.id };
  for (let sd = 1; sd < 500; sd++) {
    const t = E.cloneState(app.game);
    t.rng = { seed: sd * 31337, counter: 0 };
    const r = E.execute(t, input);
    if (r.status === 'awaitingDecision' && r.decision?.type === 'blockDie' && r.decision.team === 'B') {
      app.game.rng = t.rng;
      app.game.rng = { seed: sd * 31337, counter: 0 };
      break;
    }
  }
  app.runSimple(input);
});
await sleep(150);
await drainTray(page);
const req = await st(() => { const r = window.bloodboard.game.pending?.request; return r ? { type: r.type, team: r.team } : null; });
c0 = await clk();
await sleep(1600);
c1 = await clk();
check('C: a Block die chosen by the defender — that decision time counts for Player 2', req && req.team === 'B' && c1.B - c0.B > 1000 && c1.A === c0.A, JSON.stringify({ req, dA: c1.A - c0.A, dB: c1.B - c0.B }));
await page.click('#clock-pause');
await sleep(150);
c0 = await clk();
await sleep(1500);
c1 = await clk();
const pausedUi = await st(() => ({ paused: window.bloodboard.st.computer.paused, label: document.querySelector('#match-clock')?.textContent ?? '' }));
check('C: Pause stops the timer (and says Paused)', pausedUi.paused && c1.totalMs === c0.totalMs && c1.A === c0.A && c1.B === c0.B && /Paused/.test(pausedUi.label), JSON.stringify({ c0, c1, pausedUi }));
await page.click('#clock-pause');
await sleep(1200);
c1 = await clk();
check('C: Resume continues it', !(await st(() => window.bloodboard.st.computer.paused)) && c1.totalMs > c0.totalMs + 700);
// Undo does not wind the timer back.
const beforeUndo = (await clk()).totalMs;
await st(() => window.bloodboard.undo?.());
await sleep(100);
check('C: Undo never winds the timer back', (await clk()).totalMs >= beforeUndo);
// Full time: the timer stops.
await st(() => { const app = window.bloodboard; const g = window.BloodboardEngine.cloneState(app.game); delete g.pending; g.phase = 'fullTime'; app.st.game = g; app.emit(); });
c0 = await clk();
await sleep(1200);
c1 = await clk();
check('C: at full time the timer stops (and the Pause control is gone)', c1.totalMs === c0.totalMs && !(await page.$('#clock-pause')), JSON.stringify({ c0, c1 }));

// ------------------------------------------------------------------ B. Sevens, computer v computer, same saved team
await page.click('.brand');
await sleep(300);
await page.click('#exhibition-setup');
await sleep(300);
await page.click('#setup-format-sevens');
await sleep(150);
await page.click('#p1-controller-computer');
await page.click('#p2-controller-computer');
await sleep(100);
await page.click('#p1-source-saved');
await sleep(200);
await page.selectOption('#p1-team', 'mirror-orcs');
await sleep(150);
await page.click('#p2-source-saved');
await sleep(200);
await page.selectOption('#p2-team', 'mirror-orcs');
await sleep(200);
await page.click('#start-match');
await sleep(500);
await st(() => { const app = window.bloodboard; app.st.computer.speed = 'instant'; app.st.computer.fast = true; app.emit(); });
const mB0 = await st(() => ({ a: window.bloodboard.game.teams.A.name, b: window.bloodboard.game.teams.B.name, v: window.bloodboard.game.variant }));
check('B: Sevens computer v computer with the same saved team starts (“Mirror Orcs” v “Mirror Orcs*”)', mB0.v === 'sevens' && mB0.a === 'Mirror Orcs' && mB0.b === 'Mirror Orcs*', JSON.stringify(mB0));
const played = await waitFor(() => { const g = window.bloodboard.game; return g.phase === 'play' && (g.teams.A.turn + g.teams.B.turn) >= 3 ? g.log.length : 0; }, undefined, 240000, 250);
const cB = await clk();
check('B: both computer coaches play (several Turns)', !!played, `log entries ${played}`);
check('B: both sides’ times ran while each computer acted and thought', cB.A > 0 && cB.B > 0 && cB.totalMs >= Math.max(cB.A, cB.B), JSON.stringify(cB));
// Save, then reopen.
await page.click('#clock-pause');
await sleep(300);
await waitFor(() => !window.bloodboard.st.computer.thinking && !window.bloodboard.game.pending, undefined, 20000);
const savedClock = await clk();
const beforeSave = await st(() => { const g = window.bloodboard.game; return JSON.stringify({ players: g.players, teams: g.teams, match: g.match, turn: g.turn, ball: g.ball }); });
await st(async () => { await window.bloodboard.saveAs('mirror sevens check'); });
await sleep(300);
const file = await st(async () => JSON.parse(await window.bloodboard.store.load('mirror sevens check')));
check('B: the saved file holds the timer', file.state.clock && Math.abs(file.state.clock.totalMs - savedClock.totalMs) < 1000 && file.state.clock.A > 0 && file.state.clock.B > 0, JSON.stringify(file.state.clock));
await page.click('.brand');
await sleep(300);
await st(async () => { await window.bloodboard.open('mirror sevens check'); });
await sleep(400);
const reopened = await st(() => { const g = window.bloodboard.game; return { json: JSON.stringify({ players: g.players, teams: g.teams, match: g.match, turn: g.turn, ball: g.ball }), clock: { ...window.bloodboard.st.clock }, total: document.querySelector('#clock-total')?.textContent }; });
check('B: reopening restores both teams, the mirror record and the whole match state', reopened.json === beforeSave);
check('B: reopening restores the accumulated times', Math.abs(reopened.clock.totalMs - file.state.clock.totalMs) < 600 && Math.abs(reopened.clock.A - file.state.clock.A) < 600 && Math.abs(reopened.clock.B - file.state.clock.B) < 600, JSON.stringify({ file: file.state.clock, now: reopened.clock }));
await st(() => { const app = window.bloodboard; app.st.computer.speed = 'instant'; app.st.computer.fast = true; app.emit(); });
const logN = await st(() => window.bloodboard.game.log.length);
const more = await waitFor((n) => window.bloodboard.game.log.length >= n + 15, logN, 120000, 250);
check('B: the reopened match plays on', !!more);
check('B: the saved Sevens team in storage is unchanged', (await savedJSON('mirror-orcs')) === orcBefore);
await st(() => { window.bloodboard.st.computer.paused = true; });

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed; page errors: ${errors.length}`);
if (errors.length) console.log(errors.join('\n'));
await browser.close();
process.exit(results.every((r) => r.ok) && !errors.length ? 0 : 1);
