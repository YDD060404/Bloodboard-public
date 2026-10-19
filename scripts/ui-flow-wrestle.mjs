// V5 step 5 regression (reported from play): after a Both Down where Wrestle is used, both players are Placed Prone,
// the blocker's activation ends, the Turn goes on — and in the interface another unused player can be selected,
// planned and moved. Checked in a match against the computer (the computer's defender uses Wrestle) and in a
// hot-seat match (the human attacker uses Wrestle from the decision panel).
// Run after `node scripts/build.mjs`:  node scripts/ui-flow-wrestle.mjs
import { open, clickSq, drainTray, waitPlan } from './ui-helpers.mjs';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const st = (page, fn, arg) => page.evaluate(fn, arg);
const sleep = (page, ms) => page.waitForTimeout(ms);
const { browser, page, errors } = await open({ home: true });
const t0 = Date.now();

/**
 * A match (Human A v Orc B) in play, Human Turn: the blocker at (10,7) next to an Orc at (11,7), another Human at
 * (5,3), an unused Prone Human at (6,12); `wrestler` gets Wrestle. A seed is searched so the Block is a Both Down.
 */
async function setup(computer, wrestler, blitz) {
  return st(page, ({ computer, wrestler, blitz }) => {
    const E = window.BloodboardEngine;
    const mk = (id, roster, pos, n) => {
      const t = E.newTeamDef('tournament', roster, `${roster} ${id}`, id);
      for (let i = 1; i <= n; i++) t.players.push(E.playerFromRoster(E.ROSTER_BY_ID[roster], pos, i, `${id}-${i}`));
      t.rerolls = 0;
      return t;
    };
    const r = E.createMatch('tournament', mk('wa', 'human', 'lineman', 11), mk('wb', 'orc', 'lineman', 11), { rules: 'introductory', ...(computer ? { computer: { team: 'B', style: 'balanced' } } : {}) }, 5);
    let s = r.state;
    // To the first Turn with the engine (introductory rules: no Kick-off Event).
    for (let g = 0; g < 30 && !(s.phase === 'play' && !s.match.pendingPhase); g++) {
      const m = s.match;
      let input;
      if (s.phase === 'pregame') input = { kind: 'pregame' };
      else if (s.phase === 'driveSetup') {
        const t = m.setupDone[m.kicking] ? (m.kicking === 'A' ? 'B' : 'A') : m.kicking;
        input = { kind: 'setupTeam', team: t, positions: E.defaultFormation(s, t) };
      } else if (s.phase === 'kickoff') {
        const k = m.kicking;
        input = { kind: 'kickoff', kicker: E.kickerCandidates(s, k)[0].id, target: { x: k === 'A' ? 20 : 5, y: 7 } };
      } else input = { kind: 'nextDrive' };
      let res = E.execute(s, input);
      for (let k = 0; k < 10 && res.status === 'awaitingDecision'; k++) res = E.decide(res.state, { requestId: res.decision.id, optionId: res.decision.options.find((o) => o.id === 'receive')?.id ?? res.decision.options[0].id });
      s = res.state;
    }
    // Rearrange: Human Turn, a clean position.
    s.turn.active = 'A';
    s.teams.A.turn = 2;
    s.teams.B.turn = 1;
    const A = s.players.filter((p) => p.team === 'A');
    const B = s.players.filter((p) => p.team === 'B');
    for (const p of s.players) { p.location = 'reserves'; p.pos = null; p.stance = 'standing'; p.activated = false; }
    const put = (p, x, y, stance = 'standing') => { p.location = 'pitch'; p.pos = { x, y }; p.stance = stance; };
    put(A[0], blitz ? 8 : 10, 7); put(A[1], 5, 3); put(A[2], 6, 12, 'prone');
    put(B[0], 11, 7); put(B[1], 20, 3);
    if (wrestler === 'A') A[0].skills.push({ id: 'wrestle' });
    else {
      B[0].skills.push({ id: 'wrestle' });
      // The blocker has Block, so only the defender would go down: the defender (the computer too) uses Wrestle.
      A[0].skills.push({ id: 'block' });
    }
    s.ball = { kind: 'ground', pos: { x: 3, y: 13 } };
    s.turn.activation = null;
    s.turn.used = { blitz: false, pass: false, handoff: false, foul: false, secure: false, ttm: false, bomb: false, punt: false, ktm: false };
    s.turn.stunnedAtStart = [];
    // Find dice that give Both Down for this Block.
    for (let seed = 1; seed < 500; seed++) {
      const x = E.cloneState(s);
      x.rng = { seed, counter: 0 };
      const res = E.execute(x, blitz ? { kind: 'playerAction', playerId: A[0].id, action: 'blitz', blitzTarget: B[0].id, blockTarget: B[0].id, path: [{ to: { x: 9, y: 7 }, kind: 'step' }, { to: { x: 10, y: 7 }, kind: 'step' }] } : { kind: 'playerAction', playerId: A[0].id, action: 'block', path: [], blockTarget: B[0].id });
      if (res.status === 'awaitingDecision' && res.decision.type === 'wrestle' && res.decision.team === wrestler) { s.rng = { seed, counter: 0 }; break; }
    }
    // The dice tray pauses on every roll (the app's default): the coach presses Continue.
    window.bloodboard.st.pauseDice = true;
    window.bloodboard.openBoard(s, { kind: 'match', matchKind: 'tournament' }, { docName: 'Wrestle check' });
    return { att: A[0].id, mate: A[1].id, prone: A[2].id, def: B[0].id, seed: s.rng.seed };
  }, { computer, wrestler, blitz });
}

async function settle() {
  for (let i = 0; i < 60; i++) {
    const s = await st(page, () => ({ pend: window.bloodboard.game.pending?.request?.type ?? null, team: window.bloodboard.game.pending?.request?.team ?? null, pb: window.bloodboard.playbackActive(), busy: window.bloodboard.st.planBusy }));
    if (s.pb) { await drainTray(page); continue; }
    if (s.pend) return s;
    if (!s.busy) return s;
    await sleep(page, 100);
  }
  return null;
}

for (const [computer, wrestler, blitz] of [[true, 'B', false], [true, 'A', false], [false, 'A', false], [false, 'B', false], [true, 'B', true]]) {
  const tag = `${computer ? 'v computer' : 'hot-seat'}, ${blitz ? 'Blitz' : 'Block'}, ${wrestler === 'A' ? 'the blocker' : 'the defender'} uses Wrestle`;
  const ids = await setup(computer, wrestler, blitz);
  await sleep(page, 250);
  // Plan the Block (or the Blitz) by clicks: the blocker, then the target; confirm in the tray.
  await clickSq(page, blitz ? 8 : 10, 7);
  if (blitz) {
    // A Blitz is chosen in the tray, the route clicked square by square, then the target.
    await page.click('#tray-actions button[data-action="blitz"]');
    await sleep(page, 100);
    await clickSq(page, 9, 7);
    await clickSq(page, 10, 7);
  }
  await clickSq(page, 11, 7);
  await waitPlan(page);
  const planned = await st(page, () => ({ action: window.bloodboard.st.draft?.action ?? null, path: window.bloodboard.st.draft?.path, target: window.bloodboard.st.draft?.blockTarget ?? window.bloodboard.st.draft?.blitzTarget, ok: window.bloodboard.st.plan?.ok ?? null, plan: window.bloodboard.st.plan ? Object.keys(window.bloodboard.st.plan).join(",") : null, why: window.bloodboard.st.plan?.illegal ?? window.bloodboard.st.plan?.reason ?? null, confirm: !!document.querySelector("#tray-confirm") }));
  check(`${tag}: the ${blitz ? 'Blitz' : 'Block'} is planned by two clicks and can be confirmed`, planned.confirm && planned.ok, JSON.stringify(planned));
  if (!planned.confirm) continue;
  await page.click('#tray-confirm');
  await sleep(page, 300);
  // Decisions: the Wrestle question (the computer answers its own; a human one is clicked).
  for (let i = 0; i < 8; i++) {
    const s = await settle();
    if (!s?.pend) break;
    if (s.pend === 'wrestle' && !(computer && s.team === 'B')) {
      await page.click('.decision [data-opt="yes"]');
      await sleep(page, 250);
      continue;
    }
    if (computer && s.team === 'B') { await sleep(page, 400); continue; }
    await page.click(`.decision [data-opt]`);
    await sleep(page, 250);
  }
  await settle();
  const g = await st(page, (ids) => {
    const g = window.bloodboard.game;
    const f = (id) => g.players.find((p) => p.id === id);
    return { active: g.turn.active, turn: g.teams.A.turn, act: g.turn.activation, att: f(ids.att).stance, attAct: f(ids.att).activated, def: f(ids.def).stance, pending: !!g.pending, log: g.log.flatMap((e) => e.events.map((v) => v.text)).filter((t) => /Wrestle|Turnover|Both Down/.test(t)).join(' | ') };
  }, ids);
  check(`${tag}: both players are Placed Prone and the log says Wrestle`, g.att === 'prone' && g.def === 'prone' && /Wrestle: both players are Placed Prone/.test(g.log), JSON.stringify(g));
  check(`${tag}: the blocker's activation has ended, no decision is pending, and it is still the Human Turn (no Turnover)`, g.act === null && g.attAct && !g.pending && g.active === 'A' && g.turn === 2 && !/Turnover/.test(g.log));
  // The interface: click another unused player straight away (as a coach would); its Actions are offered; plan and confirm a move.
  const before = await st(page, () => ({ sel: window.bloodboard.st.selected, draft: window.bloodboard.st.draft?.action ?? null, stage: window.bloodboard.st.stage }));
  await clickSq(page, 5, 3);
  await sleep(page, 150);
  const ui = await st(page, () => ({ sel: window.bloodboard.st.selected, acts: [...document.querySelectorAll('#tray-actions button[data-action]:not([disabled])')].map((b) => b.dataset.action), computer: document.querySelector('.turnctl')?.textContent?.includes('(computer)') ?? false }));
  check(`${tag}: another unused player can be selected and has Actions in the tray`, ui.sel === ids.mate && ui.acts.includes('move'), JSON.stringify({ before, ui }));
  await clickSq(page, 7, 3);
  await waitPlan(page);
  const canConfirm = await st(page, () => !!document.querySelector('#tray-confirm:not([disabled])'));
  check(`${tag}: a Move for that player can be planned (Confirm enabled)`, canConfirm);
  if (canConfirm) {
    await page.click('#tray-confirm');
    await sleep(page, 300);
    await settle();
  }
  const moved = await st(page, (id) => window.bloodboard.game.players.find((p) => p.id === id).pos, ids.mate);
  check(`${tag}: …and it executes (the player moved to (7,3))`, moved && moved.x === 7 && moved.y === 3, JSON.stringify(moved));
  // The unused Prone player can stand up and move too.
  await clickSq(page, 6, 12);
  await sleep(page, 150);
  const pr = await st(page, () => ({ sel: window.bloodboard.st.selected, acts: [...document.querySelectorAll('#tray-actions button[data-action]:not([disabled])')].map((b) => b.dataset.action) }));
  check(`${tag}: the unused Prone team-mate can be selected (to stand up and move)`, pr.sel === ids.prone && pr.acts.includes('move'), JSON.stringify(pr));
  // The wrestled blocker cannot be activated again.
  await clickSq(page, 10, 7);
  await sleep(page, 150);
  const bl = await st(page, () => [...document.querySelectorAll('#tray-actions button[data-action]:not([disabled])')].map((b) => b.dataset.action));
  check(`${tag}: the wrestled blocker has no Action left`, bl.length === 0, bl.join(','));
}
check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} Wrestle interface checks passed (${Math.round((Date.now() - t0) / 1000)} s)`);
process.exit(failed.length ? 1 : 0);
