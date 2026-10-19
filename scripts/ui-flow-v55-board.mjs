// V5.5 interface flow — board interactions (request items 6, 7 and 8):
//  A. routes that come back through earlier squares (the start included), with every Dodge / Rush charged;
//     Backspace takes back one planning operation (a whole automatic route at once), the first one cancels the plan;
//  B. own-square clicks: a Prone player's Stand Up plan; back to the start inside a route;
//  C. the Jump / Leap control: highlighted landing squares with the Agility Test, the jump added to the plan with the
//     same odds; Leap over a Standing player with the Leap skill;
//  D. a click on a distant opponent plans a Blitz (route next to them, target declared); a click on an empty reachable
//     square plans a Move;
//  E. Block dice: when you choose, a click on the die keeps the roll and uses it (no "Keep these dice"); the
//     Follow-up "Stay put" by clicking the blocker's own square;
//  F. End Turn while dice are still being revealed ends the Turn at once;
//  G. match set-up: select a player, click another → they swap; Shift-click selects without swapping;
//  H. Alert Defence: the player limit is enforced while arranging (Backspace puts one back);
//  I. Sevens On the Ball at the kick-off offers squares in No Man's Land (never past the halfway line).
// Run after `node scripts/build.mjs`:  node scripts/ui-flow-v55-board.mjs
import { open, clickSq, drainTray, waitPlan, gameJSON } from './ui-helpers.mjs';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const st = (page, fn, arg) => page.evaluate(fn, arg);
const sleep = (page, ms) => page.waitForTimeout(ms);
const { browser, page, errors } = await open({});
const t0 = Date.now();
const draft = () => st(page, () => window.bloodboard.st.draft);
const plan = () => st(page, () => window.bloodboard.st.plan);

/** Practice position: the players listed are placed (others go to the Reserves Box); team A to act, no Blitz used yet. */
async function position(spec, extra = {}) {
  await st(
    page,
    ({ spec, extra }) => {
      const app = window.bloodboard;
      const E = window.BloodboardEngine;
      const g = E.cloneState(app.game);
      delete g.pending;
      g.phase = 'play';
      for (const p of g.players) {
        const w = spec[p.id];
        if (w) {
          p.location = 'pitch';
          p.pos = { x: w[0], y: w[1] };
          p.stance = w[2] ?? 'standing';
          if (w[3]) p.skills = [...p.skills.filter((k) => k.id !== w[3]), { id: w[3] }];
        } else {
          p.location = 'reserves';
          p.pos = null;
        }
        p.activated = false;
      }
      g.ball = extra.ball ? { kind: 'ground', pos: { x: extra.ball[0], y: extra.ball[1] } } : { kind: 'ground', pos: { x: 1, y: 1 } };
      g.turn.active = 'A';
      g.turn.activation = null;
      g.turn.used = { blitz: false, pass: false, handoff: false, foul: false, ttm: false, secure: false };
      g.teams.A.rerolls = extra.rerolls ?? 0;
      g.teams.A.turn = 3;
      g.teams.B.turn = 2;
      g.teams.A.rerollUsedThisTurn = false;
      app.openBoard(g, { kind: 'practice', name: 'V5.5 check', start: E.cloneState(g) }, { docName: 'V5.5 check' });
      app.st.pauseDice = false;
      app.emit();
    },
    { spec, extra },
  );
  await sleep(page, 150);
}

// ------------------------------------------------------------ A. routes that revisit squares; Backspace = one step back
await position({ A3: [5, 5], B6: [6, 5] });
await clickSq(page, 5, 5); // select A3 (Human Lineman, MA 6)
await clickSq(page, 4, 5); // leave the Marked square: 1 Dodge
await waitPlan(page);
let d = await draft();
check('A: a click on an empty reachable square plans a Move', d?.action === 'move' && d.path.length === 1, JSON.stringify(d?.path));
await clickSq(page, 5, 5); // back to the start square (Marked by B6)
await waitPlan(page);
d = await draft();
check('A: clicking the start square with a route going on adds the way back (a real step, not a reset)', d?.path.length === 2 && d.path[1].to.x === 5 && d.path[1].to.y === 5, JSON.stringify(d?.path));
await clickSq(page, 4, 4); // leave the Marked start square again: a second Dodge
await waitPlan(page);
let pl = await plan();
const dodges = (pl?.steps ?? []).filter((s) => s.kind === 'dodge').length;
check('A: the plan charges both Dodges (leaving the Marked start square twice) and 3 squares of movement', pl?.ok && dodges === 2 && (await draft()).path.length === 3, JSON.stringify((pl?.steps ?? []).map((s) => `${s.kind}@${s.at?.x},${s.at?.y}`)));
await clickSq(page, 4, 1); // 3 more squares by one click (auto-route) → 6 squares, then one more → a Rush
await waitPlan(page);
const n6 = (await draft()).path.length;
await clickSq(page, 3, 0);
await waitPlan(page);
pl = await plan();
check('A: going past the Move Allowance adds a Rush to the plan', pl?.ok && (pl.steps ?? []).some((s) => s.kind === 'rush') && (await draft()).path.length === n6 + 1, JSON.stringify({ n6, steps: (pl?.steps ?? []).map((s) => s.kind) }));
const before = await gameJSON(page);
await page.keyboard.press('Backspace');
await waitPlan(page);
check('A: Backspace takes back the last click only (one square)', (await draft())?.path.length === n6);
await page.keyboard.press('Backspace');
await waitPlan(page);
check('A: Backspace again takes back the whole automatic route of that click at once', (await draft())?.path.length === 3);
for (let i = 0; i < 3; i++) {
  await page.keyboard.press('Backspace');
  await waitPlan(page);
}
check('A: …and the first operation cancels the plan; nothing was rolled or changed', (await draft()) === null && (await gameJSON(page)) === before);

// ------------------------------------------------------------ B. own-square clicks: Stand Up plan for a Prone player
await position({ A4: [8, 8, 'prone'], B6: [15, 3] });
await clickSq(page, 8, 8); // select
await clickSq(page, 8, 8); // own square again: plan Stand Up
await waitPlan(page);
d = await draft();
pl = await plan();
check('B: clicking the selected Prone player plans a Stand Up (a Move, no square)', d?.action === 'move' && d.path.length === 0 && pl?.ok, JSON.stringify(d));
check('B: the Stand Up plan costs 3 squares of movement and no dice (MA 6)', pl?.ok && !(pl.steps ?? []).some((s) => s.target) && /stand/i.test(JSON.stringify(pl.steps ?? []) + JSON.stringify(pl.assumptions ?? []) + (await st(page, () => document.querySelector('.side')?.textContent ?? ''))), JSON.stringify(pl?.steps?.map((s) => s.kind)));
await clickSq(page, 8, 8);
check('B: a further click on the player drops the Stand Up plan and deselects (selection stays a deliberate toggle)', (await draft()) === null && (await st(page, () => window.bloodboard.st.selected)) === null);

// ------------------------------------------------------------ C. Jump / Leap control
await position({ A3: [5, 5], B6: [6, 5, 'prone'], B2: [9, 9] });
await clickSq(page, 5, 5);
await page.evaluate(() => window.bloodboard.startDraft('move'));
await waitPlan(page);
const jbtn = await st(page, () => document.querySelector('#tray-jump')?.textContent ?? '');
check('C: while planning next to a Prone player, the tray offers the Jump control with the number of landing squares', /Jump \(\d+\)/.test(jbtn), jbtn);
await page.click('#tray-jump');
await sleep(page, 120);
const jl = await st(page, () => ({ sq: document.querySelectorAll('.pitch .mark.jumpsq').length, list: [...document.querySelectorAll('#jump-list li')].map((li) => [li.getAttribute('data-jump'), li.textContent]) }));
check('C: Jump mode highlights the landing squares and lists cost, modifiers, chance and Turnover risk', jl.sq >= 3 && jl.list.length === jl.sq && jl.list.every(([, t]) => /2 squares of movement/.test(t) && /Turnover \d/.test(t)), JSON.stringify(jl.list.slice(0, 2)));
const landing = jl.list.find(([k]) => k === '7,5');
await clickSq(page, 7, 5);
await waitPlan(page);
d = await draft();
pl = await plan();
const jstep = (pl?.steps ?? []).find((s) => s.kind === 'jump');
const shownP = landing ? Number(/= (\d+(?:\.\d+)?)%\. Succeeds/.exec(landing[1])?.[1]) / 100 : NaN;
check('C: a click on a highlighted square adds a Jump step (2 squares away) and turns Jump mode off', d?.path.length === 1 && d.path[0].kind === 'jump' && !d.jumpMode, JSON.stringify(d?.path));
check('C: the plan rolls the same Agility Test as shown in Jump mode', !!jstep && Math.abs((jstep.pSingle ?? 0) - shownP) < 0.006, JSON.stringify({ plan: jstep?.pSingle, shown: shownP }));
await clickSq(page, 9, 5); // and the route goes on after the jump
await waitPlan(page);
check('C: the route continues after the jump', (await draft())?.path.length === 3 && (await plan())?.ok);
await page.keyboard.press('Escape');
// Leap over a Standing opponent (Leap skill): Leap −1 reduced (min −1).
await position({ A3: [5, 5, 'standing', 'leap'], B6: [6, 5], B2: [9, 9] });
await clickSq(page, 5, 5);
await page.evaluate(() => window.bloodboard.startDraft('move'));
await waitPlan(page);
await page.keyboard.press('j');
await sleep(page, 120);
const leapList = await st(page, () => [...document.querySelectorAll('#jump-list li')].map((li) => li.textContent));
check('C: with the Leap skill the control is "Jump / Leap" and a Standing player can be leapt (J key toggles it)', leapList.length > 0 && leapList.some((t) => /^Leap /.test(t)) && /Jump \/ Leap/.test(await st(page, () => document.querySelector('#tray-jump')?.textContent ?? '')), leapList[0]);
await page.keyboard.press('Escape');
check('C: Escape leaves Jump mode first (the plan stays)', (await draft()) && !(await draft()).jumpMode);
await page.keyboard.press('Escape');

// ------------------------------------------------------------ D. click a distant opponent → Blitz plan
await position({ A2: [5, 7], B1: [10, 7], B2: [20, 3] });
await clickSq(page, 5, 7);
await clickSq(page, 10, 7);
await waitPlan(page);
d = await draft();
const end = d?.path?.[d.path.length - 1]?.to;
check('D: a click on a distant opponent plans a Blitz with the route next to them and the target declared', d?.action === 'blitz' && d.blitzTarget === 'B1' && end && Math.max(Math.abs(end.x - 10), Math.abs(end.y - 7)) === 1 && (await plan())?.ok, JSON.stringify({ action: d?.action, end }));
await page.keyboard.press('Backspace');
check('D: one Backspace cancels that Blitz plan (it was one click)', (await draft()) === null);
await st(page, () => { window.bloodboard.game.turn.used.blitz = true; window.bloodboard.emit(); });
await clickSq(page, 5, 7);
await clickSq(page, 10, 7);
check('D: with the Blitz already used this Turn no Blitz is planned (the limit is respected)', (await draft()) === null);

// ------------------------------------------------------------ E. Block dice: click the die to keep and use it; Stay put by clicking the blocker
{
  let done = false;
  for (let seed = 1; seed < 40 && !done; seed++) {
    await position({ A2: [8, 7], B1: [9, 7], B2: [20, 3] }, { rerolls: 2 });
    await st(page, (sd) => {
      const app = window.bloodboard;
      const g = app.game;
      g.rng = { seed: sd * 7919, counter: 0 };
      const a = g.players.find((p) => p.id === 'A2');
      a.st = 7; // three dice, attacker chooses
      app.emit();
    }, seed);
    await clickSq(page, 8, 7);
    await clickSq(page, 9, 7);
    await waitPlan(page);
    if (!(await page.locator('#tray-confirm').count())) {
      console.log('debug E', JSON.stringify(await st(page, () => ({ sel: window.bloodboard.st.selected, d: window.bloodboard.st.draft, plan: window.bloodboard.st.plan?.errors, toast: window.bloodboard.st.toast }))));
      await page.screenshot({ path: 'build/shots/v55-debugE.png' });
      break;
    }
    await page.click('#tray-confirm');
    await sleep(page, 150);
    const q = await st(page, () => { const r = window.bloodboard.game.pending?.request; return r ? { type: r.type, kind: r.context?.kind, chooser: r.context?.chooser, pool: r.context?.pool } : null; });
    if (!q || q.type !== 'reroll' || q.kind !== 'blockDice') continue;
    const pushIdx = (q.pool ?? []).findIndex((f) => f === 'push');
    if (pushIdx < 0) continue;
    const keepBtn = await page.locator('#tray-keep').count();
    check('E: when you choose the Block die, no "Keep these dice" button is needed — the dice themselves are clickable', keepBtn === 0 && (await page.locator('#tray-decision button[data-keep-face]').count()) === q.pool.length, JSON.stringify(q));
    await page.locator('#tray-decision button[data-keep-face]').nth(pushIdx).click();
    await sleep(page, 150);
    const q2 = await st(page, () => { const r = window.bloodboard.game.pending?.request; return r ? { type: r.type, opts: r.options.map((o) => o.id) } : null; });
    const log = await st(page, () => window.bloodboard.game.pending?.events.map((e) => e.text).join(' | ') ?? '');
    const q2ok = q2 && (q2.type === 'followUp' || q2.type === 'pushSquare');
    check('E: one click on the Push die kept the roll and used it (the next question is about the push / follow-up)', !!q2ok && !/Re-roll/.test(log.split('|').slice(-1)[0] ?? ''), JSON.stringify(q2));
    // Answer push-direction questions (first option) until the Follow-up question comes.
    for (let i = 0; i < 4; i++) {
      const r = await st(page, () => { const r = window.bloodboard.game.pending?.request; return r ? { type: r.type, first: r.options[0].id } : null; });
      if (!r || r.type === 'followUp') break;
      await st(page, (id) => { const app = window.bloodboard; app.decide(app.game.pending.request, id); }, r.first);
      await sleep(page, 100);
    }
    const fu = await st(page, () => window.bloodboard.game.pending?.request?.type);
    if (fu !== 'followUp') continue;
    const stayMark = await st(page, () => document.querySelector('.pitch .mark.staysq')?.getAttribute('data-opt'));
    await clickSq(page, 8, 7); // the blocker's own square = Stay put
    await sleep(page, 150);
    const after = await st(page, () => ({ pos: window.bloodboard.game.players.find((p) => p.id === 'A2').pos, pending: window.bloodboard.game.pending?.request?.type ?? null, text: window.bloodboard.game.log.at(-1)?.events.map((e) => e.text).join(' | ') ?? '' }));
    check('E: the Follow-up question marks the blocker\'s square; clicking it chooses "Stay put"', stayMark === 'no' && after.pos.x === 8 && after.pos.y === 7 && after.pending === null, JSON.stringify(after));
    done = true;
  }
  check('E: a three-dice Block with a Push was reached', done);
}

// ------------------------------------------------------------ F. End Turn while dice are still being revealed
{
  let doneF = false;
  for (let seed = 1; seed < 30 && !doneF; seed++) {
    await position({ A3: [5, 5], B6: [6, 5], B2: [3, 5] });
    await st(page, (sd) => { const app = window.bloodboard; app.game.rng = { seed: sd * 104729, counter: 0 }; app.st.pauseDice = true; app.emit(); }, seed);
    await clickSq(page, 5, 5);
    await clickSq(page, 4, 4); // Dodge (Marked by B6) into a square Marked by B2
    await clickSq(page, 3, 3); // and a second Dodge
    await waitPlan(page);
    await page.click('#tray-confirm');
    await sleep(page, 150);
    const s0 = await st(page, () => ({ active: window.bloodboard.playbackActive(), pending: !!window.bloodboard.game.pending, turn: window.bloodboard.game.turn.active, phase: window.bloodboard.game.phase, btn: !!document.querySelector('#tray-end-turn') }));
    if (!s0.active || s0.pending || s0.turn !== 'A' || s0.phase !== 'play') continue;
    await page.click('#tray-end-turn');
    await sleep(page, 150);
    const s1 = await st(page, () => ({ active: window.bloodboard.playbackActive(), turn: window.bloodboard.game.turn.active, log: window.bloodboard.game.log.length }));
    check('F: End Turn in the tray while the dice are still shown one by one ends the Turn at once (the rest of the dice revealed, no extra presses)', s0.btn && !s1.active && s1.turn === 'B', JSON.stringify({ s0, s1 }));
    doneF = true;
  }
  check('F: a two-Dodge move without a Turnover was reached', doneF);
  await st(page, () => { window.bloodboard.st.pauseDice = false; });
}

await browser.close();

// ------------------------------------------------------------ G–I: a Sevens hot-seat match
{
  const { browser, page, errors: errs2 } = await open({ home: true });
  const st2 = (fn, arg) => page.evaluate(fn, arg);
  await st2(() => {
    const E = window.BloodboardEngine;
    const app = window.bloodboard;
    const team = (id, rid) => {
      const t = E.newTeamDef('tournament', rid, `${rid} ${id}`, id, 'sevens');
      const r = E.ROSTER_BY_ID[rid];
      const lin = r.positions.find((p) => p.keywords?.includes('Lineman')) ?? r.positions[0];
      for (let i = 0; i < 7; i++) t.players.push(E.playerFromRoster(r, lin.id, i + 1, `${id}-${i + 1}`));
      E.setVeteran(t, t.players[0].id);
      t.rerolls = 1;
      return t;
    };
    const a = team('liz', 'lizardmen');
    const b = team('he', 'highElf');
    const r = E.createMatch('tournament', a, b, { rules: 'full' }, 20260927);
    app.openBoard(r.state, { kind: 'match', matchKind: 'tournament' }, { docName: 'v55 sevens' });
    app.st.pauseDice = false;
    app.runSimple({ kind: 'pregame' });
  });
  await sleep(page, 200);
  // Kick/receive: whoever decides chooses to kick (sets up first).
  for (let i = 0; i < 6; i++) {
    const p = await st2(() => { const r = window.bloodboard.game.pending?.request; return r ? r.options.map((o) => o.id) : null; });
    if (!p) break;
    await st2((id) => { const app = window.bloodboard; app.decide(app.game.pending.request, id); }, p.includes('kick') ? 'kick' : p[0]);
    await sleep(page, 100);
  }
  const setupTeam = await st2(() => { const m = window.bloodboard.game.match; return m.setupDone[m.kicking] ? (m.kicking === 'A' ? 'B' : 'A') : m.kicking; });
  // G. swap two players of the set-up
  const pos0 = await st2(() => window.bloodboard.displayGame().players.filter((p) => p.location === 'pitch').map((p) => [p.id, p.pos.x, p.pos.y]));
  const [p1, p2] = pos0.slice(0, 2);
  const sevensSq = async (x, y) => {
    // Sevens pitch 20 × 11: same square size.
    const pt = await page.evaluate(({ x, y }) => {
      const svg = document.querySelector('.pitchhost svg');
      const r = svg.getBoundingClientRect();
      const vb = svg.getAttribute('viewBox').split(/\s+/).map(Number);
      const sc = Math.min(r.width / vb[2], r.height / vb[3]);
      const ox = r.left + (r.width - vb[2] * sc) / 2;
      const oy = r.top + (r.height - vb[3] * sc) / 2;
      return { x: ox + (22 + x * 34 + 17 - vb[0]) * sc, y: oy + (22 + y * 34 + 17 - vb[1]) * sc };
    }, { x, y });
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(120);
  };
  await sevensSq(p1[1], p1[2]);
  await sevensSq(p2[1], p2[2]);
  const pos1 = await st2(() => Object.fromEntries(window.bloodboard.displayGame().players.filter((p) => p.location === 'pitch').map((p) => [p.id, [p.pos.x, p.pos.y]])));
  check('G: set-up — select a player, click another of yours → they swap squares', pos1[p1[0]]?.[0] === p2[1] && pos1[p1[0]]?.[1] === p2[2] && pos1[p2[0]]?.[0] === p1[1] && pos1[p2[0]]?.[1] === p1[2], JSON.stringify({ p1, p2, a: pos1[p1[0]], b: pos1[p2[0]] }));
  await sevensSq(p1[1], p1[2]); // now occupied by p2: select it
  await page.keyboard.down('Shift');
  await sevensSq(pos0[2][1], pos0[2][2]);
  await page.keyboard.up('Shift');
  const sel = await st2(() => window.bloodboard.st.selected);
  const pos2 = await st2(() => Object.fromEntries(window.bloodboard.displayGame().players.filter((p) => p.location === 'pitch').map((p) => [p.id, [p.pos.x, p.pos.y]])));
  check('G: Shift-click selects another player without swapping', sel === pos0[2][0] && JSON.stringify(pos2) === JSON.stringify(pos1), sel);
  check('G: the set-up team was the one setting up', !!setupTeam);
  // H. Alert Defence limit (the pending phase is set directly: the interface limit is what is checked here; the engine
  // refuses more than the maximum on Confirm too — tests/sevens.test.ts).
  await st2(() => {
    const app = window.bloodboard;
    const g = app.game;
    const E = window.BloodboardEngine;
    for (const t of ['A', 'B']) if (!g.match.setupDone[t]) app.runSimple({ kind: 'setupTeam', team: t, positions: E.defaultFormation(app.game, t) });
  });
  await sleep(page, 150);
  await st2(() => {
    const app = window.bloodboard;
    const g = window.BloodboardEngine.cloneState(app.game);
    g.phase = 'kickoff';
    g.match.pendingPhase = { type: 'quickSnap', team: g.match.kicking, max: 2, alert: true };
    app.replaceGame(g, { keepDirty: true });
  });
  await sleep(page, 150);
  const kick = await st2(() => window.bloodboard.game.match.kicking);
  const open3 = await st2((t) => { const g = window.bloodboard.game; const E = window.BloodboardEngine; return g.players.filter((p) => p.team === t && p.location === 'pitch' && E.isOpen(g, p)).map((p) => [p.id, p.pos.x, p.pos.y]).slice(0, 3); }, kick);
  const step = async (p) => {
    await sevensSq(p[1], p[2]);
    const tgt = await st2(({ x, y }) => { const g = window.bloodboard.displayGame(); const E = window.BloodboardEngine; for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]]) { const c = { x: x + dx, y: y + dy }; if (c.x >= 0 && c.y >= 0 && c.x < 20 && c.y < 11 && !E.playerAt(g, c)) return c; } return null; }, { x: p[1], y: p[2] });
    await sevensSq(tgt.x, tgt.y);
    return tgt;
  };
  await step(open3[0]);
  await step(open3[1]);
  const toastsBefore = await st2(() => window.bloodboard.st.toast?.text ?? '');
  await step(open3[2]);
  const lim = await st2(() => ({ n: Object.keys(window.bloodboard.st.setupDraft?.positions ?? {}).length, toast: window.bloodboard.st.toast?.text ?? '' }));
  check('H: Alert Defence — a third player cannot be moved while two (the maximum) are moved; the reason is shown', lim.n === 2 && /at most 2/.test(lim.toast), JSON.stringify({ lim, toastsBefore }));
  await sevensSq((await st2((id) => window.bloodboard.displayGame().players.find((p) => p.id === id).pos, open3[0][0])).x, (await st2((id) => window.bloodboard.displayGame().players.find((p) => p.id === id).pos, open3[0][0])).y);
  await page.keyboard.press('Backspace');
  await sleep(page, 100);
  await step(open3[2]);
  const lim2 = await st2(() => Object.keys(window.bloodboard.st.setupDraft?.positions ?? {}));
  check('H: Backspace puts a moved player back, and then another player can be moved', lim2.length === 2 && lim2.includes(open3[2][0]) && !lim2.includes(open3[0][0]), JSON.stringify(lim2));
  check('G-H: no console errors', errs2.length === 0, errs2.slice(0, 2).join(' | '));
  await browser.close();
}

// ------------------------------------------------------------ I. On the Ball in Sevens (engine check through the page's engine)
{
  const { browser, page, errors: errs3 } = await open({ home: true });
  const r = await page.evaluate(() => {
    const E = window.BloodboardEngine;
    const team = (id, rid) => {
      const t = E.newTeamDef('tournament', rid, `${rid} ${id}`, id, 'sevens');
      const ros = E.ROSTER_BY_ID[rid];
      const lin = ros.positions.find((p) => p.keywords?.includes('Lineman')) ?? ros.positions[0];
      for (let i = 0; i < 7; i++) t.players.push(E.playerFromRoster(ros, lin.id, i + 1, `${id}-${i + 1}`));
      E.setVeteran(t, t.players[0].id);
      return t;
    };
    const m = E.createMatch('tournament', team('liz', 'lizardmen'), team('he', 'highElf'), { rules: 'introductory' }, 11);
    let s = m.state;
    const answer = (res, pick) => {
      let g = 0;
      while (res.status === 'awaitingDecision' && g++ < 30) res = E.decide(res.state, { requestId: res.decision.id, optionId: pick(res.decision) });
      return res;
    };
    s = answer(E.execute(s, { kind: 'pregame' }), (q) => (q.options.some((o) => o.id === 'kick') ? 'kick' : q.options[0].id)).state;
    const k = s.match.kicking;
    const recv = k === 'A' ? 'B' : 'A';
    s = answer(E.execute(s, { kind: 'setupTeam', team: k, positions: E.defaultFormation(s, k) }), (q) => q.options[0].id).state;
    s = answer(E.execute(s, { kind: 'setupTeam', team: recv, positions: E.defaultFormation(s, recv) }), (q) => q.options[0].id).state;
    const losX = recv === 'A' ? 6 : 13;
    const mover = s.players.find((q) => q.team === recv && q.location === 'pitch' && q.pos.x === losX);
    mover.skills.push({ id: 'onTheBall' });
    const kicker = E.kickerCandidates(s, k)[0];
    const tgt = recv === 'A' ? { x: 2, y: 5 } : { x: 17, y: 5 };
    let seen = null;
    let first = '';
    for (let seed = 0; seed < 30 && !seen; seed++) {
      const s2 = E.cloneState(s);
      s2.rng = { seed: 1000 + seed, counter: 0 };
      let res = E.execute(s2, { kind: 'kickoff', kicker: kicker.id, target: tgt });
      let guard = 0;
      while (res.status === 'awaitingDecision' && guard++ < 10) {
        const q = res.decision;
        if (q.type === 'onTheBall' && q.options.some((o) => o.id === mover.id)) { first = q.prompt; res = E.decide(res.state, { requestId: q.id, optionId: mover.id }); continue; }
        if (q.type === 'onTheBall' && q.options.some((o) => o.id === 'stay')) { seen = { prompt: first, xs: q.options.filter((o) => o.square).map((o) => o.square.x) }; break; }
        res = E.decide(res.state, { requestId: q.id, optionId: q.options[0].id });
      }
    }
    return { recv, seen };
  });
  const nml = (r.seen?.xs ?? []).filter((x) => x > 6 && x < 13);
  check("I: Sevens On the Ball at the kick-off offers No Man's Land squares, none past the halfway line, and says so", nml.length > 0 && (r.seen?.xs ?? []).every((x) => (r.recv === 'A' ? x <= 9 : x >= 10)) && /No Man's Land/.test(r.seen?.prompt ?? ''), JSON.stringify(r));
  check('I: no console errors', errs3.length === 0, errs3.slice(0, 2).join(' | '));
  await browser.close();
}

check('A-F: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} V5.5 board-interaction checks passed (${Math.round((Date.now() - t0) / 1000)} s)`);
process.exit(failed.length ? 1 : 0);
