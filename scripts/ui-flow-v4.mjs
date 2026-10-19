// V4 interface checks through real pointer input (run after `node scripts/build.mjs`):
//   default teams Tomb Kings (you) v Bretonnian (computer), still editable;
//   the optional D6 difficulty control: Off by default, probabilities shown,
//   stored in computer matches only, labelled as a house rule on the board;
//   Foul Actions planned by clicking a Prone opponent, confirmed, rolled.
import { open, clickSq, waitPlan, gameJSON, drainTray } from './ui-helpers.mjs';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const st = (page, fn, arg) => page.evaluate(fn, arg);
const sleep = (page, ms) => page.waitForTimeout(ms);

const { browser, page, errors } = await open({ home: true });
await st(page, () => localStorage.removeItem('bloodboard.difficulty.v4'));
await page.reload();
await sleep(page, 400);

// V5.5: the Home screen's quick-match card and the old D6 tilt are replaced by the match set-up screen and the
// outcome-based difficulty (request items 1 and 10); these checks follow the same intentions there.
// ------------------------------------------------------------ default teams
{
  await st(page, () => { localStorage.removeItem('bloodboard.setup.v2'); });
  await page.reload();
  await sleep(page, 400);
  await page.click('#exhibition-setup');
  await sleep(page, 300);
  const you = await page.locator('#p1-roster').inputValue();
  const cpu = await page.locator('#p2-roster').inputValue();
  check('Exhibition set-up defaults: Player 1 (you) = Tomb Kings, Player 2 (computer) = Bretonnian', you === 'tombKings' && cpu === 'bretonnian' && (await page.locator('#p2-controller-computer.on').count()) === 1, `${you} v ${cpu}`);
  await page.selectOption('#p1-roster', 'human');
  await sleep(page, 100);
  check('…and they can be changed', (await page.locator('#p1-roster').inputValue()) === 'human');
  await page.selectOption('#p1-roster', 'tombKings');
  await sleep(page, 100);
}

// ------------------------------------------------------------ difficulty control
{
  const box = page.locator('#setup-difficulty');
  check('the difficulty control is on the set-up, labelled a house rule, Off by default', (await box.count()) === 1 && /optional house rule — not Blood Bowl rules/.test(await box.innerText()) && (await page.locator('#setup-diff-human-0.on').count()) === 1 && (await page.locator('#setup-diff-computer-0.on').count()) === 1);
  await page.click('#setup-diff-human-2');
  await sleep(page, 100);
  await page.click('#setup-diff-computer-1');
  await sleep(page, 100);
  const det = page.locator('#difficulty-details');
  check('worked examples are offered once a level is chosen', (await det.count()) === 1);
  await det.locator('summary').click();
  await sleep(page, 100);
  check('the examples say every result stays possible and the previews use the same odds', /stays possible|still possible/i.test(await box.innerText()) && /previews/i.test(await box.innerText()));
  await page.click('#start-match');
  await sleep(page, 600);
  const m = await st(page, () => {
    const g = window.bloodboard.game;
    return { diff: g.match?.options.difficulty, cpu: g.match?.options.computer, rA: g.teams.A.rosterId, rB: g.teams.B.rosterId, line: document.querySelector('#house-rule-line')?.textContent ?? null };
  });
  check('the match stores the setting (human side 2, computer side 1)', m.diff && m.diff.player === 2 && m.diff.computer === 1, JSON.stringify(m.diff));
  check('Tomb Kings v Bretonnian with the computer on the Bretonnian side', m.rA === 'tombKings' && m.rB === 'bretonnian' && m.cpu?.team === 'B', JSON.stringify(m));
  check('the board shows the house-rule line', !!m.line && /House rule/.test(m.line), m.line);
}

// ------------------------------------------------------------ Off again → standard dice, no line; hot-seat and Tournament
{
  await page.click('.brand');
  await sleep(page, 200);
  await page.click('#exhibition-setup');
  await sleep(page, 300);
  await page.click('#setup-diff-human-0');
  await page.click('#setup-diff-computer-0');
  await sleep(page, 100);
  await page.click('#start-match');
  await sleep(page, 600);
  const m = await st(page, () => ({ diff: window.bloodboard.game.match?.options.difficulty ?? null, line: document.querySelector('#house-rule-line')?.textContent ?? null }));
  check('both Off: no difficulty option in the match and no house-rule line', m.diff === null && m.line === null, JSON.stringify(m));
  await page.click('.brand');
  await sleep(page, 200);
  await page.click('#exhibition-setup');
  await sleep(page, 300);
  await page.click('#p2-controller-human');
  await sleep(page, 150);
  check('…not for two human coaches (hot-seat): standard dice', (await page.locator('#setup-diff-human-1').count()) === 0 && /Only for a human against the computer/.test(await page.locator('#setup-difficulty').innerText()));
  await page.click('#p2-controller-computer');
  await sleep(page, 100);
  await page.click('.brand');
  await sleep(page, 200);
  await page.click('#tournament-setup');
  await sleep(page, 300);
  check('…and never in Tournament matches', /Tournament matches always use standard dice/.test(await page.locator('#setup-difficulty').innerText()));
}

// ------------------------------------------------------------ Foul by clicks
{
  await st(page, () => {
    const E = window.BloodboardEngine;
    const g = E.newGame({ a: { name: 'Tomb Kings', roster: 'tombKings' }, b: { name: 'Bretonnians', roster: 'bretonnian' }, seed: 4242 });
    const add = (team, roster, idx, x, y, stance) => {
      const r = E.ROSTER_BY_ID[roster];
      const p = E.playerFromPosition(g, team, r.positions[idx], { x, y });
      if (stance) p.stance = stance;
      g.players.push(p);
      return p;
    };
    add('A', 'tombKings', 2, 8, 7); // Blitzer
    add('B', 'bretonnian', 0, 12, 7, 'prone'); // Squire, Prone
    add('B', 'bretonnian', 0, 16, 3);
    g.ball = { kind: 'ground', pos: { x: 3, y: 12 } };
    g.teams.A.rerolls = 1;
    g.teams.A.turn = 2;
    g.teams.B.turn = 1;
    g.turn.active = 'A';
    const s = E.startPlay(g);
    window.bloodboard.openBoard(s, { kind: 'practice', name: 'Foul check', start: E.cloneState(s) }, { docName: 'Foul check' });
  });
  await sleep(page, 200);
  const before = await gameJSON(page);
  await clickSq(page, 8, 7);
  await clickSq(page, 12, 7);
  await waitPlan(page);
  const d = await st(page, () => window.bloodboard.st.draft && JSON.parse(JSON.stringify(window.bloodboard.st.draft)));
  const end = d?.path?.[d.path.length - 1]?.to;
  check('clicking a Prone opponent with a player selected plans a Foul with a route next to them', d && d.action === 'foul' && !!d.foulTarget && end && Math.max(Math.abs(end.x - 12), Math.abs(end.y - 7)) === 1, JSON.stringify({ action: d?.action, end }));
  const plan = await st(page, () => ({ ok: window.bloodboard.st.plan?.ok, turnover: window.bloodboard.st.plan?.withoutTeamRerolls?.pTurnover, armour: window.bloodboard.st.plan?.withoutTeamRerolls?.pTargetArmourBroken }));
  // Squire AV 8, no assists: a double on the Armour Roll (6/36), or a broken armour without a double (12/36) then an Injury double (1/6).
  check('the Foul plan shows the exact risk of a Sent-off (Turnover 48/216) and the chance to break armour (15/36)', plan.ok && Math.abs(plan.turnover - 48 / 216) < 1e-9 && Math.abs(plan.armour - 15 / 36) < 1e-9, JSON.stringify(plan));
  check('only a draft so far', (await gameJSON(page)) === before);
  await page.getByRole('button', { name: /Review probabilities/ }).click();
  await sleep(page, 80);
  await page.getByRole('button', { name: /^Confirm/ }).first().click();
  await sleep(page, 300);
  // Answer any decision (Argue the Call) with the first option, and drain the tray.
  for (let i = 0; i < 10; i++) {
    const pend = await st(page, () => window.bloodboard.game.pending?.request?.type ?? null);
    if (pend) {
      await st(page, () => { const r = window.bloodboard.game.pending.request; window.bloodboard.decide(r, r.options[0].id); });
      await sleep(page, 200);
      continue;
    }
    if (await st(page, () => window.bloodboard.playbackActive())) await drainTray(page);
    else break;
  }
  const log = await st(page, () => window.bloodboard.game.log.map((l) => l.events.map((e) => e.text).join(' | ')).join('\n'));
  check('the Foul was executed: an Armour Roll for the fouled player is in the log', /Foul Armour Roll for/.test(log), log.split('\n').slice(-1)[0]?.slice(0, 200));
  const used = await st(page, () => window.bloodboard.game.turn.used.foul);
  check('the Foul Action of the Turn is used', used === true);
}

// ------------------------------------------------------------ the tray as the action bar
{
  await st(page, () => {
    const E = window.BloodboardEngine;
    const g = E.newGame({ a: { name: 'Tomb Kings', roster: 'tombKings' }, b: { name: 'Bretonnians', roster: 'bretonnian' }, seed: 777 });
    const add = (team, roster, idx, x, y) => { const r = E.ROSTER_BY_ID[roster]; const p = E.playerFromPosition(g, team, r.positions[idx], { x, y }); g.players.push(p); return p; };
    add('A', 'tombKings', 2, 10, 7); // Blitzer (Block)
    add('A', 'tombKings', 0, 5, 3);
    add('B', 'bretonnian', 0, 11, 7); // Squire next to the Blitzer
    add('B', 'bretonnian', 0, 20, 12);
    g.ball = { kind: 'ground', pos: { x: 2, y: 13 } };
    g.teams.A.rerolls = 2; g.teams.A.turn = 2; g.teams.B.turn = 1; g.turn.active = 'A';
    const s = E.startPlay(g);
    window.bloodboard.st.pauseDice = false;
    window.bloodboard.openBoard(s, { kind: 'practice', name: 'Tray check', start: E.cloneState(s) }, { docName: 'Tray check' });
  });
  await sleep(page, 200);
  check('idle: End Turn is next to the board', (await page.locator('#tray-end-turn').count()) === 1);
  await clickSq(page, 10, 7);
  await sleep(page, 100);
  const acts = await st(page, () => [...document.querySelectorAll('#tray-actions button[data-action]')].map((b) => b.dataset.action));
  check('a selected player\'s Actions are offered in the tray', acts.includes('block') && acts.includes('move') && acts.includes('blitz'), acts.join(','));
  await page.click('#tray-actions button[data-action="block"]');
  await sleep(page, 100);
  check('…and one click there starts that plan', await st(page, () => window.bloodboard.st.draft?.action === 'block'));
  await page.click('#tray-cancel');
  await sleep(page, 80);
  await st(page, () => window.bloodboard.select(null));
  await clickSq(page, 5, 3);
  await clickSq(page, 7, 3);
  await waitPlan(page);
  const bar = await st(page, () => ({
    txt: document.querySelector('#tray-plan')?.textContent ?? '',
    ok: window.bloodboard.st.plan?.ok,
    pc: window.bloodboard.st.plan?.withoutTeamRerolls?.pCompleted,
    confirm: !!document.querySelector('#tray-confirm:not([disabled])'),
  }));
  check('planning shows the odds and Confirm in the tray, next to the board', bar.ok && bar.confirm && /Completes/.test(bar.txt) && bar.txt.includes('100.0%'), bar.txt);
  await page.click('#tray-review');
  await sleep(page, 80);
  check('Details opens the full review (side panel)', await st(page, () => window.bloodboard.st.stage === 'review'));
  await page.click('#tray-back');
  await sleep(page, 80);
  check('← Edit plan returns to planning', await st(page, () => window.bloodboard.st.stage === 'plan'));
  const n0 = await st(page, () => window.bloodboard.game.log.length);
  await page.click('#tray-confirm');
  await sleep(page, 300);
  await drainTray(page);
  const after = await st(page, () => ({ n: window.bloodboard.game.log.length, pos: window.BloodboardEngine.findPlayer(window.bloodboard.game, window.bloodboard.game.log.at(-1)?.input?.playerId)?.pos }));
  check('Confirm in the tray executes the plan (one action logged, the player moved)', after.n === n0 + 1 && after.pos && after.pos.x === 7 && after.pos.y === 3, JSON.stringify(after));
  // A Block whose result is a push: the follow-up question is answered in the tray.
  let seed = await st(page, () => {
    const E = window.BloodboardEngine;
    const g = window.bloodboard.game;
    const blitzer = g.players.find((p) => p.team === 'A' && p.pos && p.pos.x === 10);
    const squire = g.players.find((p) => p.team === 'B' && p.pos && p.pos.x === 11);
    for (let seed = 1; seed < 400; seed++) {
      const x = E.cloneState(g);
      x.rng = { seed, counter: 0 };
      let r = E.execute(x, { kind: 'playerAction', playerId: blitzer.id, action: 'block', path: [], blockTarget: squire.id });
      for (let k = 0; k < 4 && r.status === 'awaitingDecision' && r.decision.type !== 'pushSquare'; k++) {
        const o = r.decision.options.find((q) => q.id === 'none' || q.id === 'push') ?? r.decision.options[0];
        r = E.decide(r.state, { requestId: r.decision.id, optionId: o.id });
      }
      if (r.status === 'awaitingDecision' && r.decision.type === 'pushSquare') return seed;
    }
    return null;
  });
  check('found a dice seed where the Block pushes the target', seed !== null, String(seed));
  await st(page, (seed) => { window.bloodboard.game.rng = { seed, counter: 0 }; window.bloodboard.emit(); }, seed);
  await clickSq(page, 10, 7);
  await clickSq(page, 11, 7);
  await waitPlan(page);
  await page.click('#tray-confirm');
  await sleep(page, 300);
  for (let i = 0; i < 6; i++) {
    if (await st(page, () => window.bloodboard.playbackActive())) await drainTray(page);
    const t = await st(page, () => window.bloodboard.game.pending?.request?.type ?? null);
    if (t === 'pushSquare') {
      const n = await page.locator('#tray-decision-generic').count();
      check('a push-square decision is offered in the tray (click a highlighted square)', n === 1 && /highlighted square/.test(await page.locator('#tray-decision-generic').innerText()));
      const sq = await st(page, () => window.bloodboard.game.pending.request.options[0].square);
      await clickSq(page, sq.x, sq.y);
      await sleep(page, 250);
      continue;
    }
    if (t === 'followUp') {
      check('the follow-up question is answered with a button in the tray', (await page.locator('#tray-decision-generic [data-opt="no"]').count()) === 1);
      await page.click('#tray-decision-generic [data-opt="no"]');
      await sleep(page, 250);
      continue;
    }
    if (!t) break;
    if (t === 'reroll' && (await page.locator('#tray-keep').count())) {
      await page.click('#tray-keep');
      await sleep(page, 200);
      continue;
    }
    // V5.5: when the attacker chooses, the Block dice themselves keep the roll and pick the result (no Keep button).
    if (t === 'reroll' && (await page.locator('#tray-decision button[data-keep-face]').count())) {
      await page.locator('#tray-decision button[data-keep-face]').first().click();
      await sleep(page, 200);
      continue;
    }
    await st(page, () => { const r = window.bloodboard.game.pending.request; window.bloodboard.decide(r, r.options[0].id); });
    await sleep(page, 200);
  }
  await drainTray(page);
  check('the Block finished without the side panel', await st(page, () => !window.bloodboard.game.pending && /blocks/.test(window.bloodboard.game.log.at(-1)?.events.map((e) => e.text).join(' ') ?? '')));
  const turn0 = await st(page, () => window.bloodboard.game.turn.active);
  await page.click('#tray-end-turn');
  await sleep(page, 300);
  await drainTray(page);
  check('End Turn in the tray ends the Turn', (await st(page, () => window.bloodboard.game.turn.active)) !== turn0);
}

// ------------------------------------------------------------ animations follow the engine's results
{
  await st(page, () => {
    const E = window.BloodboardEngine;
    const g = E.newGame({ a: { name: 'Tomb Kings', roster: 'tombKings' }, b: { name: 'Bretonnians', roster: 'bretonnian' }, seed: 99 });
    const add = (team, roster, idx, x, y) => { const r = E.ROSTER_BY_ID[roster]; const p = E.playerFromPosition(g, team, r.positions[idx], { x, y }); g.players.push(p); return p; };
    add('A', 'tombKings', 0, 4, 7);
    add('B', 'bretonnian', 0, 22, 2);
    g.ball = { kind: 'ground', pos: { x: 1, y: 13 } };
    g.teams.A.turn = 2; g.teams.B.turn = 1; g.turn.active = 'A';
    const s = E.startPlay(g);
    window.bloodboard.st.pauseDice = false;
    window.bloodboard.st.animate = true;
    window.bloodboard.openBoard(s, { kind: 'practice', name: 'Animation check', start: E.cloneState(s) }, { docName: 'Animation check' });
  });
  await sleep(page, 200);
  check('the Animate switch is in the tray and on by default', await page.locator('#anim-toggle').isChecked());
  await clickSq(page, 4, 7);
  await clickSq(page, 8, 7);
  await waitPlan(page);
  await page.click('#tray-confirm');
  await sleep(page, 60);
  const a = await st(page, () => {
    const g = window.bloodboard.game;
    const mover = g.players.find((p) => p.team === 'A');
    const el = document.querySelector(`g.player[data-player="${mover.id}"]`);
    const anims = el ? el.getAnimations() : [];
    return { n: anims.length, pos: mover.pos, frames: anims[0] ? anims[0].effect.getKeyframes().map((k) => k.transform) : [] };
  });
  const xs = a.frames.map((t) => Number(/translate\(([-\d.]+)px/.exec(t)?.[1])).filter((v) => !Number.isNaN(v));
  const cx = (x) => 22 + x * 34 + 17;
  check('a confirmed Move is animated on the moving player\'s token', a.n === 1, JSON.stringify(a.frames.slice(0, 3)));
  check('…from where he started to where the engine put him, square by square', xs[0] === cx(4) && xs[xs.length - 1] === cx(a.pos.x) && a.pos.x === 8 && [5, 6, 7].every((x) => xs.includes(cx(x))), xs.join(' '));
  await sleep(page, 2400);
  const b = await st(page, () => document.getAnimations().filter((x) => x.playState === 'running' && !(x instanceof CSSAnimation) && !(x instanceof CSSTransition)).length);
  check('the animation finishes by itself (no animation left running)', b === 0, String(b));
  await st(page, () => { window.bloodboard.st.animate = false; window.bloodboard.emit(); });
  if (!(await st(page, () => window.bloodboard.st.selected))) await clickSq(page, 8, 7);
  await clickSq(page, 9, 7);
  await waitPlan(page);
  await page.click('#tray-confirm');
  await sleep(page, 60);
  const c2 = await st(page, () => document.getAnimations().filter((x) => !(x instanceof CSSAnimation) && !(x instanceof CSSTransition)).length);
  check('with Animate off nothing is animated', c2 === 0, String(c2));
  await st(page, () => { window.bloodboard.st.animate = true; window.bloodboard.emit(); });
}

// ------------------------------------------------------------ V4 skills by clicks: Multiple Block, Trickster answered on the pitch
{
  await st(page, () => {
    const E = window.BloodboardEngine;
    const g = E.newGame({ a: { name: 'Tomb Kings', roster: 'tombKings' }, b: { name: 'Bretonnians', roster: 'bretonnian' }, seed: 31337 });
    const add = (team, roster, idx, x, y, extra) => { const r = E.ROSTER_BY_ID[roster]; const p = E.playerFromPosition(g, team, r.positions[idx], { x, y }); if (extra) p.skills = [...p.skills, ...extra.map((id) => ({ id }))]; g.players.push(p); return p; };
    add('A', 'tombKings', 2, 10, 7, ['multipleBlock']); // Blitzer + Multiple Block
    add('B', 'bretonnian', 0, 11, 6, ['trickster']); // Squire with Trickster
    add('B', 'bretonnian', 0, 11, 8); // Squire
    g.ball = { kind: 'ground', pos: { x: 2, y: 12 } };
    g.teams.A.turn = 2; g.teams.B.turn = 1; g.turn.active = 'A';
    const s = E.startPlay(g);
    window.bloodboard.st.animate = false;
    window.bloodboard.openBoard(s, { kind: 'practice', name: 'Skills check', start: E.cloneState(s) }, { docName: 'Skills check' });
  });
  await sleep(page, 200);
  const ids = await st(page, () => window.bloodboard.game.players.map((p) => p.id));
  await clickSq(page, 10, 7);
  await clickSq(page, 11, 6);
  await waitPlan(page);
  let d = await st(page, () => JSON.parse(JSON.stringify(window.bloodboard.st.draft)));
  check('Multiple Block: clicking an adjacent opponent plans a Block', d.action === 'block' && d.blockTarget === ids[1] && !d.blockTarget2);
  const hint = await st(page, () => document.body.innerText.includes('Multiple Block (p.132): click a second adjacent opponent'));
  check('…and the panel says how to add a second target', hint);
  await clickSq(page, 11, 8);
  await waitPlan(page);
  d = await st(page, () => JSON.parse(JSON.stringify(window.bloodboard.st.draft)));
  check('clicking a second adjacent opponent adds it as the second target', d.blockTarget === ids[1] && d.blockTarget2 === ids[2], JSON.stringify({ t1: d.blockTarget, t2: d.blockTarget2 }));
  const chips = await st(page, () => [...document.querySelectorAll('#tray-plan .oddchip small')].map((e) => e.textContent));
  check('the tray shows the odds for both targets', chips.includes('1st target down') && chips.includes('2nd target down'), chips.join(', '));
  const plan = await st(page, () => ({ ok: window.bloodboard.st.plan?.ok, t2: window.bloodboard.st.plan?.withoutTeamRerolls?.pTarget2Down }));
  check('…from an exact plan of both Blocks', plan.ok && plan.t2 > 0 && plan.t2 < 1, JSON.stringify(plan));
  await clickSq(page, 11, 8);
  await waitPlan(page);
  d = await st(page, () => JSON.parse(JSON.stringify(window.bloodboard.st.draft)));
  check('clicking the second target again removes it', d.blockTarget === ids[1] && !d.blockTarget2);
  await clickSq(page, 11, 8);
  await waitPlan(page);
  await page.click('#tray-confirm');
  await sleep(page, 250);
  // The Squire's Trickster decision (hot-seat practice: asked to the human coach) — answered by clicking a highlighted square.
  const pend = await st(page, () => { const r = window.bloodboard.game.pending?.request; return r ? { type: r.type, squares: r.options.filter((o) => o.square).map((o) => o.square) } : null; });
  check('Trickster: the target\'s coach is asked before the dice, with the squares next to the blocker', pend && pend.type === 'trickster' && pend.squares.length > 0, JSON.stringify(pend));
  const lit = await st(page, () => document.querySelectorAll('.decision-sq, [data-decision]').length);
  check('…the Trickster squares are shown in the tray', await page.locator('#tray-decision-generic').count() === 1, String(lit));
  const sq = pend?.squares.find((c) => c.x === 9 && c.y === 7) ?? pend?.squares[0];
  if (sq) await clickSq(page, sq.x, sq.y);
  await sleep(page, 250);
  const moved = await st(page, (id) => window.bloodboard.game.players.find((p) => p.id === id)?.pos, ids[1]);
  check('clicking a highlighted square moves the Trickster player there', moved && sq && moved.x === sq.x && moved.y === sq.y, JSON.stringify(moved));
  for (let i = 0; i < 20; i++) {
    const p2 = await st(page, () => window.bloodboard.game.pending?.request?.type ?? null);
    if (p2) {
      await st(page, () => { const r = window.bloodboard.game.pending.request; window.bloodboard.decide(r, r.options[0].id); });
      await sleep(page, 150);
      continue;
    }
    if (await st(page, () => window.bloodboard.playbackActive())) await drainTray(page);
    else break;
  }
  const log = await st(page, () => window.bloodboard.game.log.map((l) => l.events.map((e) => e.text).join(' | ')).join('\n'));
  check('both Blocks were resolved (Multiple Block, no Follow-up)', /uses Multiple Block on/.test(log) && (log.match(/\(Multiple Block\)\./g) ?? []).length === 2, log.split('\n').slice(-1)[0]?.slice(0, 240));
  await st(page, () => { window.bloodboard.st.animate = true; });
}

// ------------------------------------------------------------ V4 skills by clicks: Punt and Fumblerooski from the tray
{
  await st(page, () => {
    const E = window.BloodboardEngine;
    const g = E.newGame({ a: { name: 'Tomb Kings', roster: 'tombKings' }, b: { name: 'Bretonnians', roster: 'bretonnian' }, seed: 5150 });
    const add = (team, roster, idx, x, y, extra) => { const r = E.ROSTER_BY_ID[roster]; const p = E.playerFromPosition(g, team, r.positions[idx], { x, y }); if (extra) p.skills = [...p.skills, ...extra.map((id) => ({ id }))]; g.players.push(p); return p; };
    const k = add('A', 'tombKings', 0, 6, 7, ['punt']);
    add('A', 'tombKings', 0, 6, 11, ['fumblerooski']);
    add('B', 'bretonnian', 0, 12, 7);
    add('B', 'bretonnian', 0, 20, 3);
    g.ball = { kind: 'held', playerId: k.id };
    g.teams.A.turn = 2; g.teams.B.turn = 1; g.turn.active = 'A';
    const s = E.startPlay(g);
    window.bloodboard.st.animate = false;
    window.bloodboard.openBoard(s, { kind: 'practice', name: 'Punt check', start: E.cloneState(s) }, { docName: 'Punt check' });
  });
  await sleep(page, 200);
  await clickSq(page, 6, 7);
  await sleep(page, 150);
  const puntBtn = page.locator('#tray-actions button', { hasText: 'Punt' });
  check('Punt: the tray offers the Punt Special Action to the player with the Skill', (await puntBtn.count()) === 1);
  await puntBtn.click();
  await sleep(page, 150);
  check('…and asks which way the Throw-in Template faces', (await page.locator('#punt-facing-tray button').count()) === 4);
  await page.click('#punt-facing-tray [data-facing="x+"]');
  await waitPlan(page);
  const chips = await st(page, () => [...document.querySelectorAll('#tray-plan .oddchip small')].map((e) => e.textContent));
  const plan = await st(page, () => ({ ok: window.bloodboard.st.plan?.ok, opp: window.bloodboard.st.plan?.withoutTeamRerolls?.pOppHasBall, to: window.bloodboard.st.plan?.withoutTeamRerolls?.pTurnover }));
  check('the Punt plan shows the exact chance that an opponent ends with the ball', plan.ok && plan.opp > 0 && chips.includes('Opponent gets it'), JSON.stringify({ plan, chips }));
  await page.click('#tray-confirm');
  await sleep(page, 300);
  for (let i = 0; i < 12; i++) {
    const pend = await st(page, () => window.bloodboard.game.pending?.request?.type ?? null);
    if (pend) { await st(page, () => { const r = window.bloodboard.game.pending.request; window.bloodboard.decide(r, r.options[0].id); }); await sleep(page, 150); continue; }
    if (await st(page, () => window.bloodboard.playbackActive())) await drainTray(page);
    else break;
  }
  const log = await st(page, () => window.bloodboard.game.log.map((l) => l.events.map((e) => e.text).join(' | ')).join('\n'));
  check('the Punt is resolved by the engine (direction, distance, landing)', /punts the ball towards the right End Zone/.test(log) && /Punt distance: D6/.test(log) && /The punt comes down in|into the crowd/.test(log), log.split('\n').slice(-1)[0]?.slice(0, 200));
  // Fumblerooski: give the other player the ball (a new position) and leave it behind as he moves.
  await st(page, () => {
    const E = window.BloodboardEngine;
    const g = E.cloneState(window.bloodboard.game.log.length ? window.bloodboard.st.ctx.start : window.bloodboard.game);
    const f = g.players.find((p) => p.skills.some((s) => s.id === 'fumblerooski'));
    g.ball = { kind: 'held', playerId: f.id };
    window.bloodboard.openBoard(g, { kind: 'practice', name: 'Fumblerooski check', start: E.cloneState(g) }, { docName: 'Fumblerooski check' });
  });
  await sleep(page, 200);
  await clickSq(page, 6, 11);
  await clickSq(page, 8, 11);
  await waitPlan(page);
  check('Fumblerooski: a Move plan of the ball carrier offers to leave the ball behind', (await page.locator('#fumblerooski-tray input').count()) === 1);
  await page.locator('#fumblerooski-tray input').check();
  await waitPlan(page);
  const inp = await st(page, () => window.bloodboard.draftInput());
  check('…the plan leaves the ball in the starting square', inp?.leaveBall === true, JSON.stringify(inp));
  await page.click('#tray-confirm');
  await sleep(page, 300);
  await drainTray(page);
  const ball = await st(page, () => window.bloodboard.game.ball);
  check('confirmed: the ball is on the ground where he started, no Turnover', ball.kind === 'ground' && ball.pos.x === 6 && ball.pos.y === 11 && (await st(page, () => window.bloodboard.game.turn.active)) === 'A', JSON.stringify(ball));
  await st(page, () => { window.bloodboard.st.animate = true; });
}

// ------------------------------------------------------------ V4 Special Actions of custom players: Stab by clicks, Chainsaw instead of a Blitz's Block
{
  await st(page, () => {
    const E = window.BloodboardEngine;
    const g = E.newGame({ a: { name: 'Tomb Kings', roster: 'tombKings' }, b: { name: 'Bretonnians', roster: 'bretonnian' }, seed: 6006 });
    const add = (team, roster, idx, x, y, extra) => { const r = E.ROSTER_BY_ID[roster]; const p = E.playerFromPosition(g, team, r.positions[idx], { x, y }); if (extra) p.skills = [...p.skills, ...extra.map((id) => ({ id }))]; g.players.push(p); return p; };
    add('A', 'tombKings', 0, 10, 7, ['stab']);
    add('A', 'tombKings', 0, 6, 3, ['chainsaw']);
    add('B', 'bretonnian', 0, 11, 7);
    add('B', 'bretonnian', 0, 9, 3);
    g.ball = { kind: 'ground', pos: { x: 2, y: 13 } };
    g.teams.A.turn = 2; g.teams.B.turn = 1; g.turn.active = 'A';
    const s = E.startPlay(g);
    window.bloodboard.st.animate = false;
    window.bloodboard.openBoard(s, { kind: 'practice', name: 'Specials check', start: E.cloneState(s) }, { docName: 'Specials check' });
  });
  await sleep(page, 200);
  await clickSq(page, 10, 7);
  await sleep(page, 150);
  const stabBtn = page.locator('#tray-actions button', { hasText: 'Stab' });
  check('Stab: the tray offers the Special Action', (await stabBtn.count()) === 1);
  await stabBtn.click();
  await sleep(page, 100);
  await clickSq(page, 11, 7);
  await waitPlan(page);
  const inp = await st(page, () => window.bloodboard.draftInput());
  const plan = await st(page, () => ({ ok: window.bloodboard.st.plan?.ok, down: window.bloodboard.st.plan?.withoutTeamRerolls?.pTargetDown }));
  // Squire AV 8: unmodified Armour Roll 8+ breaks 15/36; then an Injury Roll: a "down" target = off the pitch or Stunned = all broken outcomes.
  check('clicking the adjacent opponent plans the Stab with the exact chance to hurt (15/36)', inp?.special === 'stab' && !!inp?.specialTarget && plan.ok && Math.abs(plan.down - 15 / 36) < 1e-9, JSON.stringify({ inp, plan }));
  await page.click('#tray-confirm');
  await sleep(page, 300);
  for (let i = 0; i < 10; i++) {
    const pend = await st(page, () => window.bloodboard.game.pending?.request?.type ?? null);
    if (pend) { await st(page, () => { const r = window.bloodboard.game.pending.request; window.bloodboard.decide(r, r.options[0].id); }); await sleep(page, 150); continue; }
    if (await st(page, () => window.bloodboard.playbackActive())) await drainTray(page);
    else break;
  }
  const log1 = await st(page, () => window.bloodboard.game.log.map((l) => l.events.map((e) => e.text).join(' | ')).join('\n'));
  check('the Stab is resolved (an unmodified Armour Roll)', /uses Stab on/.test(log1) && /Stab: cannot be modified/.test(log1), log1.split('\n').slice(-1)[0]?.slice(0, 200));
  // Chainsaw instead of the Block of a Blitz: square then opponent → Blitz plan, then choose the chainsaw in the side panel.
  await clickSq(page, 6, 3);
  await clickSq(page, 8, 3);
  await clickSq(page, 9, 3);
  await waitPlan(page);
  const d0 = await st(page, () => window.bloodboard.st.draft?.action);
  await page.selectOption('#blitz-special select', 'chainsaw');
  await waitPlan(page);
  const inp2 = await st(page, () => window.bloodboard.draftInput());
  check('Blitz: the Chainsaw Attack can replace the Block (chosen in the plan)', d0 === 'blitz' && inp2?.special === 'chainsaw' && !!inp2?.specialTarget && !inp2?.blockTarget, JSON.stringify(inp2));
  const plan2 = await st(page, () => window.bloodboard.st.plan?.ok);
  check('…and the plan is valid', plan2 === true);
  await st(page, () => { window.bloodboard.cancelDraft(); window.bloodboard.st.animate = true; });
}

// ------------------------------------------------------------ V4 Special Actions: Throw Bomb target by click, Ball & Chain steps
{
  await st(page, () => {
    const E = window.BloodboardEngine;
    const g = E.newGame({ a: { name: 'Orcs', roster: 'orc' }, b: { name: 'Bretonnians', roster: 'bretonnian' }, seed: 8118 });
    const add = (team, roster, idx, x, y, extra) => { const r = E.ROSTER_BY_ID[roster]; const p = E.playerFromPosition(g, team, r.positions[idx], { x, y }); if (extra) p.skills = [...p.skills, ...extra.map((id) => ({ id }))]; g.players.push(p); return p; };
    add('A', 'orc', 0, 6, 7, ['bombardier']);
    add('A', 'orc', 1, 6, 12, ['ballAndChain']);
    add('B', 'bretonnian', 0, 10, 7);
    add('B', 'bretonnian', 0, 10, 8);
    g.ball = { kind: 'ground', pos: { x: 2, y: 2 } };
    g.teams.A.turn = 2; g.teams.B.turn = 1; g.turn.active = 'A';
    const s = E.startPlay(g);
    window.bloodboard.st.animate = false;
    window.bloodboard.openBoard(s, { kind: 'practice', name: 'Bomb check', start: E.cloneState(s) }, { docName: 'Bomb check' });
  });
  await sleep(page, 200);
  await clickSq(page, 6, 7);
  await sleep(page, 150);
  await page.locator('#tray-actions button', { hasText: 'Throw Bomb' }).click();
  await sleep(page, 100);
  await clickSq(page, 9, 7);
  await waitPlan(page);
  const bi = await st(page, () => window.bloodboard.draftInput());
  const bp = await st(page, () => ({ ok: window.bloodboard.st.plan?.ok, ex: window.bloodboard.st.plan?.withoutTeamRerolls?.explored, un: window.bloodboard.st.plan?.withoutTeamRerolls?.unresolved }));
  check('Throw Bomb: the clicked square is the bomb target and the plan is computed quickly', bi?.special === 'bombardier' && bi.bombTarget?.x === 9 && bi.bombTarget?.y === 7 && bp.ok && bp.ex > 0.9, JSON.stringify({ bi, bp }));
  await st(page, () => window.bloodboard.cancelDraft());
  // Ball & Chain: choose the facing, confirm; the next step is planned again with the same facing.
  await clickSq(page, 6, 12);
  await sleep(page, 150);
  const onlyBnc = await st(page, () => [...document.querySelectorAll('#tray-actions button[data-action]')].map((b) => b.textContent));
  check('Ball & Chain: the tray offers only the Ball & Chain Special Action', onlyBnc.length === 1 && /Ball & Chain/.test(onlyBnc[0] ?? ''), JSON.stringify(onlyBnc));
  await page.locator('#tray-actions button', { hasText: 'Ball & Chain' }).click();
  await sleep(page, 100);
  await page.click('#chain-facing-tray [data-facing="y-"]');
  await waitPlan(page);
  const before = await st(page, () => window.bloodboard.game.players.find((p) => p.skills.some((s) => s.id === 'ballAndChain')).pos);
  await page.click('#tray-confirm');
  await sleep(page, 300);
  await drainTray(page);
  await sleep(page, 200);
  const after = await st(page, () => ({ pos: window.bloodboard.game.players.find((p) => p.skills.some((s) => s.id === 'ballAndChain')).pos, draft: window.bloodboard.st.draft && { special: window.bloodboard.st.draft.special, facing: window.bloodboard.st.draft.facing } }));
  check('one step of one square towards the top Sideline', after.pos.y === before.y - 1 && Math.abs(after.pos.x - before.x) <= 1, JSON.stringify({ before, after }));
  check('…and the next step is planned at once with the same facing', after.draft?.special === 'ballAndChain' && after.draft?.facing === 'y-', JSON.stringify(after.draft));
  await st(page, () => { window.bloodboard.cancelDraft(); window.bloodboard.st.animate = true; });
}

// ------------------------------------------------------------ a match start driven from the tray (no side-panel buttons)
{
  await st(page, () => window.bloodboard.set({ screen: 'home' }));
  await sleep(page, 150);
  await page.click('#mode-league');
  await sleep(page, 200);
  if (!(await page.locator('.teamlist li').count())) {
    await page.getByRole('button', { name: 'Add two starter teams' }).click();
    await sleep(page, 400);
  }
  // V5.5: the League match set-up (Player 1 / Player 2, both human), the first two saved League teams.
  await page.click('.brand');
  await sleep(page, 200);
  await page.click('#league-setup');
  await sleep(page, 300);
  await page.click('#p1-controller-human');
  await page.click('#p2-controller-human');
  await sleep(page, 100);
  const lt = await st(page, () => [...document.querySelectorAll('#p1-team option')].map((o) => o.value).filter(Boolean));
  await page.selectOption('#p1-team', lt[0]);
  await sleep(page, 100);
  await page.selectOption('#p2-team', lt[1] ?? lt[0]);
  await sleep(page, 150);
  await page.click('#start-match');
  await sleep(page, 250);
  const used = [];
  let ok = true;
  for (let i = 0; i < 80; i++) {
    const s = await st(page, () => ({ phase: window.bloodboard.game.phase, pb: window.bloodboard.playbackActive(), pend: window.bloodboard.game.pending?.request?.type ?? null, pp: window.bloodboard.game.match?.pendingPhase?.type ?? null }));
    if (s.phase === 'play' && !s.pb && !s.pend && !s.pp) break;
    if (s.pb) { await drainTray(page); continue; }
    if (s.pend) {
      // Decisions (kick or receive, a Touchback…) are answered with the tray's buttons.
      const b = page.locator('#tray-decision-generic button').first();
      if (await b.count()) { used.push(`decision:${s.pend}`); await b.click(); } else { ok = false; break; }
      await sleep(page, 150);
      continue;
    }
    const bar = await page.locator('#tray-matchstep').count();
    if (!bar) { ok = false; used.push(`no tray step in ${s.phase}/${s.pp}`); break; }
    if (s.phase === 'kickoff' && !s.pp) {
      const k = await st(page, () => { const g = window.bloodboard.game; const t = g.match.kicking; const kp = window.BloodboardEngine.kickerCandidates(g, t)[0]; return { kicker: kp.pos, target: t === 'A' ? { x: 19, y: 7 } : { x: 6, y: 7 } }; });
      await clickSq(page, k.kicker.x, k.kicker.y);
      await clickSq(page, k.target.x, k.target.y);
      used.push('kickoff');
      await page.click('#tray-kickoff');
      await sleep(page, 200);
      continue;
    }
    if (s.phase === 'driveSetup') {
      await page.click('#tray-default-formation');
      await sleep(page, 80);
      used.push('setup');
      await page.click('#tray-confirm-setup');
      await sleep(page, 200);
      continue;
    }
    const primary = page.locator('#tray-matchstep button.primary, #tray-matchstep button').first();
    used.push(await primary.getAttribute('id'));
    await primary.click();
    await sleep(page, 200);
  }
  const fin = await st(page, () => ({ phase: window.bloodboard.game.phase, turnA: window.bloodboard.game.teams.A.turn, turnB: window.bloodboard.game.teams.B.turn }));
  check('a League match is started from the tray: pre-game, both set-ups, kick-off (Kick-off Event steps too) — no side-panel button', ok && fin.phase === 'play' && used.filter((u) => u === 'setup').length === 2 && used.includes('kickoff') && used.includes('tray-pregame'), JSON.stringify({ used, fin }));
}

check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
