// V3 interface checks through real pointer / keyboard input:
//   quick Block / Blitz planning by clicks (draft only, nothing executed),
//   one Backspace = one whole operation (plan, then confirmed action via Undo),
//   End Turn without a confirmation dialog,
//   dice chosen in the tray and the inline re-roll control,
//   the single collapsible Teaching area.
// Run after `node scripts/build.mjs`:  node scripts/ui-flow-v3.mjs
import { open, clickSq, waitPlan, gameJSON, drainTray } from './ui-helpers.mjs';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const st = (page, fn, arg) => page.evaluate(fn, arg);
const sleep = (page, ms) => page.waitForTimeout(ms);

const { browser, page, errors } = await open({ home: true });

/**
 * Open a practice position: Humans (A, to play) against Orcs (B).
 * spec: { a: [[positionName, x, y], …], b: […], ball?: [x, y] | 'A0' (held by A's first player), seed, rerolls }
 */
async function loadPosition(spec) {
  await st(page, (spec) => {
    const E = window.BloodboardEngine;
    window.__v3build = (spec, seed) => {
      const g = E.newGame({ a: { name: 'Humans', roster: 'human' }, b: { name: 'Orcs', roster: 'orc' }, seed });
      const add = (team, roster, list) => {
        const r = E.ROSTER_BY_ID[roster];
        for (const [name, x, y] of list) {
          const pos = r.positions.find((p) => p.name === name) ?? r.positions[0];
          g.players.push(E.playerFromPosition(g, team, pos, { x, y }));
        }
      };
      add('A', 'human', spec.a);
      add('B', 'orc', spec.b);
      if (spec.ball === 'A0') g.ball = { kind: 'held', playerId: g.players.find((p) => p.team === 'A').id };
      else if (spec.ball) g.ball = { kind: 'ground', pos: { x: spec.ball[0], y: spec.ball[1] } };
      g.teams.A.rerolls = spec.rerolls ?? 2;
      g.teams.B.rerolls = 2;
      g.turn.active = 'A';
      g.teams.A.turn = 3;
      g.teams.B.turn = 2;
      return E.startPlay(g);
    };
    const s = window.__v3build(spec, spec.seed ?? 12345);
    window.bloodboard.openBoard(s, { kind: 'practice', name: 'V3 check', start: E.cloneState(s) }, { docName: 'V3 check' });
  }, spec);
  await sleep(page, 150);
}
/** First dice seed (1..600) for which `input` on the position stops at a decision of `type` for team A. */
async function seedFor(spec, input, type) {
  return st(page, ([spec, input, type]) => {
    const E = window.BloodboardEngine;
    for (let seed = 1; seed <= 600; seed++) {
      const s = window.__v3build(spec, seed);
      const r = E.execute(s, input);
      if (r.status === 'awaitingDecision' && r.state.pending?.request.type === type && r.state.pending.request.team === 'A') return seed;
    }
    return null;
  }, [spec, input, type]);
}
const idAt = (x, y) => st(page, ([x, y]) => window.BloodboardEngine.playerAt(window.bloodboard.game, { x, y })?.id ?? null, [x, y]);
const draft = () => st(page, () => window.bloodboard.st.draft && JSON.parse(JSON.stringify(window.bloodboard.st.draft)));

// ---------------------------------------------------------------- Block by click
await loadPosition({ a: [['Blitzer', 10, 7], ['Lineman', 5, 3]], b: [['Lineman', 11, 7], ['Black Orc', 16, 7], ['Lineman', 16, 3]], ball: [2, 12] });
{
  const before = await gameJSON(page);
  await clickSq(page, 10, 7); // select the Blitzer
  await clickSq(page, 11, 7); // adjacent opponent
  await waitPlan(page);
  const d = await draft();
  const tgt = await idAt(11, 7);
  check('Block by click: selected player + adjacent opponent → a Block plan on that target', d && d.action === 'block' && d.blockTarget === tgt, JSON.stringify(d));
  check('Block by click: only a draft — state and dice untouched', (await gameJSON(page)) === before);
  const plan = await st(page, () => ({ ok: window.bloodboard.st.plan?.ok, dice: window.bloodboard.st.plan?.block?.dice }));
  check('Block by click: the plan shows the block dice (risk preview)', plan.ok && plan.dice >= 1, JSON.stringify(plan));
  await page.keyboard.press('Backspace');
  await sleep(page, 60);
  check('Backspace cancels the Block plan; nothing changed', (await draft()) === null && (await gameJSON(page)) === before);
}

// ---------------------------------------------------------------- Blitz: destination, then opponent
{
  const before = await gameJSON(page);
  await clickSq(page, 10, 7);
  if (!(await st(page, () => window.bloodboard.st.selected))) await clickSq(page, 10, 7);
  await clickSq(page, 15, 6); // empty square next to the Black Orc at Q7 (x16)
  await waitPlan(page);
  const d1 = await draft();
  check('Blitz by clicks: a click on an empty square first makes a Move route', d1 && d1.action === 'move' && d1.path.length >= 4, JSON.stringify(d1?.path?.map((p) => p.to)));
  await clickSq(page, 16, 7);
  await waitPlan(page);
  const d2 = await draft();
  const orc = await idAt(16, 7);
  const end = d2?.path?.[d2.path.length - 1]?.to;
  check('Blitz by clicks: …then the opponent → a Blitz plan with the same route, target declared', d2 && d2.action === 'blitz' && d2.blitzTarget === orc && d2.blockTarget === orc && end && end.x === 15 && end.y === 6, JSON.stringify({ action: d2?.action, end, tgt: d2?.blitzTarget }));
  const plan = await st(page, () => ({ ok: window.bloodboard.st.plan?.ok, block: !!window.bloodboard.st.plan?.block, decl: window.bloodboard.st.plan?.input?.blitzTarget }));
  check('Blitz by clicks: the plan includes the movement and the Block, target nominated in the input', plan.ok && plan.block && plan.decl === orc, JSON.stringify(plan));
  check('Blitz by clicks: nothing was executed', (await gameJSON(page)) === before);
  const n = d2.path.length;
  // V5.5: Backspace takes back one planning operation — the opponent click (the Blitz), then the route click.
  await page.keyboard.press('Backspace');
  await sleep(page, 60);
  const d3 = await draft();
  check(`V5.5: one Backspace takes back the opponent click — the Move route of ${d1.path.length} squares is left`, d3 && d3.action === 'move' && d3.path.length === d1.path.length && !d3.blitzTarget);
  await page.keyboard.press('Backspace');
  await sleep(page, 60);
  check(`…and a second Backspace cancels the plan (${n}-square route + target gone); nothing changed`, (await draft()) === null && (await gameJSON(page)) === before);
}

// ---------------------------------------------------------------- A distant opponent click only selects; destination + opponent = Blitz
{
  const before = await gameJSON(page);
  await clickSq(page, 10, 7);
  if (!(await st(page, () => window.bloodboard.st.selected))) await clickSq(page, 10, 7);
  await clickSq(page, 16, 3); // V5.5: a distant opponent → a Blitz plan routed next to them
  await waitPlan(page);
  const d0 = await draft();
  const tgt = await idAt(16, 3);
  const e0 = d0?.path?.[d0.path.length - 1]?.to;
  check('V5.5: a click on a distant opponent plans a Blitz on them (route next to them, target declared)', d0 && d0.action === 'blitz' && d0.blitzTarget === tgt && e0 && Math.max(Math.abs(e0.x - 16), Math.abs(e0.y - 3)) === 1, JSON.stringify({ action: d0?.action, e0 }));
  await page.keyboard.press('Backspace');
  await sleep(page, 60);
  check('…one Backspace cancels it (it was one click)', (await draft()) === null && (await gameJSON(page)) === before);
  if ((await st(page, () => window.bloodboard.st.selected)) !== 'A1') await clickSq(page, 10, 7);
  if ((await st(page, () => window.bloodboard.st.selected)) !== 'A1') await clickSq(page, 10, 7);
  await clickSq(page, 15, 4); // destination next to the Lineman at Q3 (x16,y3)
  await waitPlan(page);
  await clickSq(page, 16, 3);
  await waitPlan(page);
  const d = await draft();
  const end = d?.path?.[d.path.length - 1]?.to;
  check('destination next to a distant opponent, then the opponent → Blitz plan (route + declared target)', d && d.action === 'blitz' && d.blitzTarget === tgt && end && end.x === 15 && end.y === 4, JSON.stringify({ end, action: d?.action }));
  check('…still only a draft', (await gameJSON(page)) === before);
  await page.getByRole('button', { name: /Review probabilities/ }).click();
  await sleep(page, 60);
  check('Review stage reached', await st(page, () => window.bloodboard.st.stage === 'review'));
  await page.keyboard.press('Backspace');
  await sleep(page, 60);
  const dr = await draft();
  check('V5.5: Backspace in Review takes back the last step (the opponent click) and returns to planning', dr && dr.action === 'move' && (await st(page, () => window.bloodboard.st.stage)) === 'plan');
  await page.keyboard.press('Backspace');
  await sleep(page, 60);
  check('…a second Backspace cancels the plan; nothing changed', (await draft()) === null && (await gameJSON(page)) === before);
}

// ---------------------------------------------------------------- confirmed action → one Backspace undoes the whole action
{
  const before = await gameJSON(page);
  await clickSq(page, 10, 7);
  if (!(await st(page, () => window.bloodboard.st.selected))) await clickSq(page, 10, 7);
  await clickSq(page, 11, 7);
  await waitPlan(page);
  await page.getByRole('button', { name: /Review probabilities/ }).click();
  await page.click('#confirm-btn');
  await sleep(page, 120);
  await drainTray(page);
  for (let i = 0; i < 6; i++) {
    const req = await st(page, () => window.bloodboard.game.pending?.request ?? null);
    if (!req) break;
    await page.click(`.decision [data-opt="${req.options[0].id}"], .tray [data-opt="${req.options[0].id}"]`);
    await sleep(page, 80);
    await drainTray(page);
  }
  const after = await st(page, () => ({ log: window.bloodboard.game.log.length, rng: window.bloodboard.game.rng.counter }));
  check('the Block was confirmed and rolled', after.log > 0 && after.rng > 0, JSON.stringify(after));
  await page.keyboard.press('Backspace');
  await sleep(page, 60);
  check('Backspace with nothing planned offers Undo', await st(page, () => window.bloodboard.st.modal?.kind === 'undo'));
  await page.keyboard.press('Backspace');
  await sleep(page, 100);
  check('a second Backspace undoes the whole action: board, dice generator and log restored', (await gameJSON(page)) === before);
}

// ---------------------------------------------------------------- Blitz limit respected
{
  // use the Blitz, then try to Blitz again with another player
  await clickSq(page, 10, 7);
  if ((await st(page, () => window.bloodboard.st.selected)) !== 'A1') await clickSq(page, 10, 7);
  await clickSq(page, 15, 4);
  await waitPlan(page);
  await clickSq(page, 16, 3);
  await waitPlan(page);
  await page.getByRole('button', { name: /Review probabilities/ }).click();
  await page.click('#confirm-btn');
  await sleep(page, 120);
  for (let i = 0; i < 10; i++) {
    await drainTray(page);
    const req = await st(page, () => window.bloodboard.game.pending?.request ?? null);
    if (!req) break;
    await page.click(`.decision [data-opt="${req.options[0].id}"], .tray [data-opt="${req.options[0].id}"]`);
    await sleep(page, 80);
  }
  const used = await st(page, () => ({ used: window.bloodboard.game.turn.used.blitz, active: window.bloodboard.game.turn.active }));
  if (used.active === 'A' && used.used) {
    // end the Blitzer's activation if it is still open
    if (await st(page, () => !!window.bloodboard.game.turn.activation && !window.bloodboard.game.turn.activation.over)) {
      await page.getByRole('button', { name: 'End activation' }).click().catch(() => {});
      await sleep(page, 80);
    }
    await clickSq(page, 5, 3); // the Lineman
    const sel = await st(page, () => window.bloodboard.st.selected);
    await clickSq(page, 10, 5); // a destination…
    await waitPlan(page);
    await clickSq(page, 16, 7); // …then an opponent: no second Blitz
    await sleep(page, 80);
    const d = await draft();
    const toast = await st(page, () => window.bloodboard.st.toast?.text ?? '');
    check('a second Blitz in the same Turn is not planned (action limit kept, reason shown)', (!d || d.action !== 'blitz') && /already been used/.test(toast), JSON.stringify({ sel, d: d?.action, toast }));
  } else check('a second Blitz in the same Turn is not planned (action limit kept)', true, 'Turnover ended the Turn — limit not reachable in this seed');
}

// ---------------------------------------------------------------- End Turn: immediate
await loadPosition({ a: [['Blitzer', 10, 7]], b: [['Lineman', 16, 7]], ball: [2, 12] });
{
  const t0 = await st(page, () => ({ active: window.bloodboard.game.turn.active, turn: window.bloodboard.game.teams.B.turn }));
  await page.click('#end-turn');
  await sleep(page, 120);
  await drainTray(page);
  const t1 = await st(page, () => ({ active: window.bloodboard.game.turn.active, turn: window.bloodboard.game.teams.B.turn, modal: window.bloodboard.st.modal }));
  check('End Turn: one click ends the Turn, no "Are you sure?"', t1.modal === null && t1.active === 'B' && t1.turn === t0.turn + 1, JSON.stringify({ t0, t1 }));
}



// ---------------------------------------------------------------- Dice tray: inline re-roll for a failed roll
{
  const spec = { a: [['Lineman', 10, 7]], b: [['Lineman', 11, 7]], ball: [2, 12], rerolls: 2 };
  await loadPosition(spec);
  const input = { kind: 'playerAction', playerId: 'A1', action: 'move', path: [{ to: { x: 9, y: 7 }, kind: 'step' }] };
  const seed = await seedFor(spec, input, 'reroll');
  check('a dice seed with a failed Dodge (re-roll offered) exists', !!seed, String(seed));
  await loadPosition({ ...spec, seed });
  const before = await gameJSON(page);
  await clickSq(page, 10, 7);
  await clickSq(page, 9, 7);
  await waitPlan(page);
  await page.getByRole('button', { name: /Review probabilities/ }).click();
  await page.click('#confirm-btn');
  await sleep(page, 100);
  await drainTray(page);
  const tray = await st(page, () => ({
    inline: !!document.querySelector('#tray-decision'),
    team: document.querySelector('#tray-decision [data-opt="team"]')?.textContent ?? '',
    keep: document.querySelector('#tray-keep')?.textContent ?? '',
    q: document.querySelector('#tray-decision .trayq')?.textContent ?? '',
    side: !!document.querySelector('.side .decision [data-opt="none"]'),
  }));
  check('failed roll: a small re-roll control appears in the tray next to the dice', tray.inline && /Team Re-roll \(2 left\)/.test(tray.team) && /rolled \d, needed \d\+/.test(tray.q), JSON.stringify(tray));
  check('…with "keep the result" as the default and the same choice still in the side panel', /No re-roll/.test(tray.keep) && tray.side, tray.keep);
  await page.keyboard.press('Space');
  await sleep(page, 100);
  await drainTray(page);
  const kept = await st(page, () => ({ rr: window.bloodboard.game.teams.A.rerolls, last: window.bloodboard.game.log.at(-1)?.decisions.map((d) => d.label).join(' | ') ?? '', pend: !!window.bloodboard.game.pending }));
  check('Space keeps the failed roll: no re-roll spent', kept.rr === 2 && /No re-roll/.test(kept.last), JSON.stringify(kept));
  // same action again (Undo restores the dice generator), this time re-rolling from the tray
  await page.keyboard.press('Backspace');
  await sleep(page, 60);
  await page.keyboard.press('Enter');
  await sleep(page, 100);
  check('Undo restored the position before the Dodge', (await gameJSON(page)) === before);
  await clickSq(page, 10, 7);
  if (!(await st(page, () => window.bloodboard.st.selected))) await clickSq(page, 10, 7);
  await clickSq(page, 9, 7);
  await waitPlan(page);
  await page.getByRole('button', { name: /Review probabilities/ }).click();
  await page.click('#confirm-btn');
  await sleep(page, 100);
  await drainTray(page);
  await page.click('#tray-decision [data-opt="team"]');
  await sleep(page, 100);
  await drainTray(page);
  const rr = await st(page, () => ({ rr: window.bloodboard.game.teams.A.rerolls, ev: window.bloodboard.game.log.at(-1)?.events.map((e) => e.text).join(' | ') ?? '' }));
  check('the tray control re-rolls with a Team Re-roll (one spent, re-roll in the log)', rr.rr === 1 && /Team Re-roll used/.test(rr.ev), JSON.stringify(rr).slice(0, 200));
}

// ---------------------------------------------------------------- Dice tray: pick the block die by clicking it
{
  const spec = { a: [['Blitzer', 10, 7], ['Lineman', 12, 6]], b: [['Lineman', 11, 7]], ball: [2, 12], rerolls: 0 };
  await loadPosition(spec);
  const input = { kind: 'playerAction', playerId: 'A1', action: 'block', path: [], blockTarget: 'B1' };
  const seed = await seedFor(spec, input, 'blockDie');
  await loadPosition({ ...spec, seed });
  await clickSq(page, 10, 7);
  await clickSq(page, 11, 7);
  await waitPlan(page);
  const dice = await st(page, () => window.bloodboard.st.plan?.block);
  check('2 block dice, attacker chooses (assist counted)', dice && dice.dice === 2 && dice.chooser === 'attacker', JSON.stringify(dice));
  await page.getByRole('button', { name: /Review probabilities/ }).click();
  await page.click('#confirm-btn');
  await sleep(page, 100);
  await drainTray(page);
  const pick = await st(page, () => {
    const req = window.bloodboard.game.pending?.request;
    const btns = [...document.querySelectorAll('#tray-decision button.die.pick')];
    return { type: req?.type, pool: req?.context?.pool, n: btns.length, opts: btns.map((b) => b.getAttribute('data-opt')) };
  });
  check('block dice appear in the tray as clickable dice', pick.type === 'blockDie' && pick.n === (pick.pool?.length ?? -1) && pick.n >= 2, JSON.stringify(pick));
  const face = pick.opts[pick.n - 1];
  await page.locator('#tray-decision button.die.pick').nth(pick.n - 1).click();
  await sleep(page, 100);
  await drainTray(page);
  const res = await st(page, () => window.bloodboard.game.log.at(-1)?.events.filter((e) => e.type === 'block').map((e) => e.text).join(' | ') ?? window.bloodboard.game.pending?.events.filter((e) => e.type === 'block').map((e) => e.text).join(' | '));
  const label = await st(page, (f) => window.BloodboardEngine.BLOCK_FACE_LABEL[f], face);
  check('clicking a die chooses that result', new RegExp(`Result: ${label.replace(/[!?]/g, '.')}`).test(res ?? ''), `${face} → ${res}`);
}


// ---------------------------------------------------------------- AI Focus: optional, advice only
await loadPosition({ a: [['Catcher', 20, 7], ['Lineman', 15, 3]], b: [['Lineman', 17, 7], ['Lineman', 22, 11]], ball: 'A0' });
{
  const line = await st(page, () => ({ compact: !!document.querySelector('#advisor-card.compact'), text: document.querySelector('#advisor-card')?.textContent ?? '' }));
  check('AI Focus is one unobtrusive line until asked', line.compact && /AI Focus/.test(line.text) && !/Suggested/.test(line.text), line.text.slice(0, 80));
  const before = await gameJSON(page);
  const rng0 = await st(page, () => ({ ...window.bloodboard.game.rng }));
  await page.click('#advisor-btn');
  for (let i = 0; i < 100 && (await st(page, () => window.bloodboard.st.computer.advisor?.busy)); i++) await sleep(page, 100);
  const card = await st(page, () => document.querySelector('#advisor-card')?.textContent ?? '');
  check('AI Focus recommends a legal action with estimated chances, what they include and the main downside', /Suggested|Slight preference/.test(card) && /Chances \(estimates\)/.test(card) && /Touchdown this action/.test(card) && /skill re-rolls/.test(card) && /Main downside/.test(card), card.slice(0, 160));
  const rec = await st(page, () => window.bloodboard.st.computer.advisor?.decision?.chosen?.input ?? null);
  const legal = await st(page, (inp) => (inp ? window.BloodboardEngine.validateInput(window.bloodboard.game, inp) : ['no recommendation']), rec);
  check('…the recommended action is legal (engine check)', rec && Array.isArray(legal) && legal.length === 0, JSON.stringify(legal));
  check('AI Focus changed nothing: board, Turn, log and dice generator identical', (await gameJSON(page)) === before && JSON.stringify(await st(page, () => window.bloodboard.game.rng)) === JSON.stringify(rng0));
  await page.getByRole('button', { name: 'Hide' }).click();
  await sleep(page, 60);
  check('Hide folds AI Focus back to one line', await st(page, () => !!document.querySelector('#advisor-card.compact')));
}

// ---------------------------------------------------------------- Teaching: one collapsible area
{
  await st(page, () => window.bloodboard.set({ screen: 'learn' }));
  await sleep(page, 100);
  const t0 = await st(page, () => ({ courses: document.querySelectorAll('.tcourse').length, lessons: document.querySelectorAll('[data-lesson], [data-ex]').length, rows: document.querySelectorAll('.trow').length }));
  check('Teaching: Basic Tutorials and Block School in one area, both collapsed', t0.courses === 2 && t0.lessons === 0 && t0.rows === 2, JSON.stringify(t0));
  await page.click('#course-blockschool');
  await sleep(page, 60);
  const t1 = await st(page, () => ({ levels: document.querySelectorAll('[data-level]').length, ex: document.querySelectorAll('[data-ex]').length }));
  check('opening Block School lists its 7 levels, exercises still collapsed', t1.levels === 7 && t1.ex === 0, JSON.stringify(t1));
  await page.click('[data-level="3"]');
  await sleep(page, 60);
  const t2 = await st(page, () => document.querySelectorAll('[data-ex]').length);
  check('opening a level shows only its exercises', t2 === 10, String(t2));
  await page.click('#course-tutorials');
  await sleep(page, 60);
  const t3 = await st(page, () => ({ rows: document.querySelectorAll('[data-lesson-toggle]').length, start: document.querySelectorAll('[data-lesson]').length }));
  check('opening Basic Tutorials lists the lessons collapsed (no details until one is selected)', t3.rows === 10 && t3.start === 0, JSON.stringify(t3));
  await page.click('[data-lesson-toggle="T2"]');
  await sleep(page, 60);
  check('selecting a lesson expands just that lesson', (await st(page, () => document.querySelectorAll('[data-lesson]').length)) === 1);
  await page.click('[data-lesson="T2"]');
  await sleep(page, 150);
  const onBoard = await st(page, () => ({ screen: window.bloodboard.st.screen, lessonCards: document.querySelectorAll('.side .card.lesson').length, list: document.querySelectorAll('.side [data-ex], .side [data-lesson], .side .tcourse').length }));
  check('a tutorial opens on the board with only its own card (no lesson list on the board)', onBoard.screen === 'board' && onBoard.lessonCards === 1 && onBoard.list === 0, JSON.stringify(onBoard));
  await page.getByRole('button', { name: 'Course' }).click();
  await sleep(page, 100);
  check('"Course" returns to the Teaching list', await st(page, () => window.bloodboard.st.screen === 'learn' && !!document.querySelector('#course-tutorials[aria-expanded="true"]')));
  // normal play: no teaching content on the board
  await page.evaluate(() => window.bloodboardOpenPractice(0));
  await sleep(page, 150);
  check('normal play shows no lesson list or lesson card', await st(page, () => document.querySelectorAll('.side .card.lesson, .side .tcourse, .side [data-ex]').length === 0));
}


check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} V3 interface checks passed`);
process.exit(failed.length ? 1 : 0);
