// V5.5 interface flow — AI files, coaches and takeovers (the latest V5.5 requirements):
//  A. the match set-up lists exactly the valid AI files (no style selector) for Player 1, Player 2 and the advisory
//     coach, and remembers the choices across a reload;
//  B. one AI file → one choice; no AI file → no computer coach (a clear message, the match does not start);
//  C. a computer v computer match; switching a team to the human coach during the match (logged, nothing else
//     changes, applied at a safe boundary);
//  D. a temporary takeover for one player activation, for the rest of the Turn, and until control is taken back;
//  E. the advisory coach: any AI file, changeable during the match, advice is read-only (state and dice untouched);
//  F. a change asked for while a decision is pending waits for it; changing a computer team's AI file; hot-seat;
//  G. a saved match reopens with its coaches; a missing AI file falls back (reported);
//  H. a strategy module as advisory coach and as a team's coach; its observation holds no dice generator.
// Run after `node scripts/build.mjs`:  node scripts/ui-flow-v55-coaches.mjs
import { open } from './ui-helpers.mjs';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const { browser, page, errors } = await open({ home: true, width: 1470, height: 920 });
page.on('pageerror', (e) => console.log('PAGE ERROR', e.stack));
const st = (fn, arg) => page.evaluate(fn, arg);
const sleep = (ms) => page.waitForTimeout(ms);
const t0 = Date.now();
async function waitFor(fn, arg, ms = 20000, step = 25) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await st(fn, arg);
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(step);
  }
}
const coach = (t) => st((t) => window.BloodboardEngine.coachOf(window.bloodboard.game, t), t);
const lastTitles = (n) => st((n) => window.bloodboard.game.log.slice(-n).map((e) => e.title), n);
/** Everything of the game except the log and the coaches (a coach change must leave it untouched). */
const core = () =>
  st(() => {
    const g = window.bloodboard.game;
    const o = { ...g.match.options };
    delete o.coaches;
    return JSON.stringify({ players: g.players, ball: g.ball, teams: g.teams, turn: g.turn, rng: g.rng, phase: g.phase, weather: g.weather, m: { ...g.match, options: o } });
  });
const selOptions = (sel) => st((sel) => [...document.querySelectorAll(`${sel} option`)].map((o) => o.value), sel);
const setSel = async (sel, v) => {
  await page.selectOption(sel, v);
  await sleep(120);
};

// ------------------------------------------------------------------ A. set-up: AI files only, remembered
await page.click('#exhibition-setup');
await sleep(300);
await page.click('#nm-cvc');
await sleep(100);
await page.click('#setup-format-standard');
await sleep(150);
const p2opts = await selOptions('#p2-ai');
check('A: the AI selector lists exactly the three bundled AI files', JSON.stringify([...p2opts].sort()) === JSON.stringify(['bloodboard-balanced', 'bloodboard-defensive', 'bloodboard-offensive']), p2opts.join(', '));
check('A: no separate style selector anywhere in the set-up', !(await page.$('#p1-style')) && !(await page.$('#p2-style')) && !(await st(() => /\bstyle\b/i.test(document.querySelector('#setup-p1')?.textContent + document.querySelector('#setup-p2')?.textContent))));
const optText = await st(() => [...document.querySelectorAll('#p2-ai option')].map((o) => o.textContent));
check('A: each choice shows the file name and version', optText.every((t) => /Bloodboard AI — (Balanced|Offensive|Defensive) 5\.5\.0/.test(t)), optText.join(' | '));
await setSel('#p1-ai', 'bloodboard-offensive');
await setSel('#p2-ai', 'bloodboard-defensive');
check('A: the advisory coach selector lists the same files', JSON.stringify(await selOptions('#setup-advisor')) === JSON.stringify(p2opts));
await setSel('#setup-advisor', 'bloodboard-defensive');
await page.click('#p2-ai-toggle');
await sleep(120);
const det = await st(() => document.querySelector('#p2-ai-details')?.textContent ?? '');
check('A: “More” shows the file’s id, version and kind', /id bloodboard-defensive/.test(det) && /parameter file of the built-in Bloodboard algorithm/.test(det), det.slice(0, 160));
// Restart (the page is reloaded; the set-up is remembered).
await page.reload();
await sleep(400);
await page.click('#exhibition-setup');
await sleep(300);
const remembered = await st(() => ({ p1: document.querySelector('#p1-ai')?.value, p2: document.querySelector('#p2-ai')?.value, adv: document.querySelector('#setup-advisor')?.value, c1: document.querySelector('#p1-controller-computer')?.classList.contains('on'), c2: document.querySelector('#p2-controller-computer')?.classList.contains('on') }));
check('A: after a restart P1 / P2 AI files, controllers and the advisory coach are remembered', remembered.p1 === 'bloodboard-offensive' && remembered.p2 === 'bloodboard-defensive' && remembered.adv === 'bloodboard-defensive' && remembered.c1 && remembered.c2, JSON.stringify(remembered));

// ------------------------------------------------------------------ B. one file / no file
const fullList = await st(() => window.BLOODBOARD_BUNDLED_AI);
await st(() => { window.BLOODBOARD_BUNDLED_AI = window.BLOODBOARD_BUNDLED_AI.filter((f) => f.name === 'bloodboard-defensive.json'); });
await st(() => window.bloodboardAI.reload());
await sleep(200);
check('B: with one AI file installed there is exactly one choice', JSON.stringify(await selOptions('#p2-ai')) === JSON.stringify(['bloodboard-defensive']) && JSON.stringify(await selOptions('#setup-advisor')) === JSON.stringify(['bloodboard-defensive']));
await st(() => { window.BLOODBOARD_BUNDLED_AI = []; });
await st(() => window.bloodboardAI.reload());
await sleep(200);
const none = await st(() => ({ sel: !!document.querySelector('#p2-ai'), msg: document.querySelector('#p2-ai-none')?.textContent ?? '', text: document.querySelector('#setup-p2')?.textContent ?? '' }));
check('B: with no AI file there is no AI choice and the side says so', !none.sel && /No AI file is installed/.test(none.msg), none.msg);
const startBtn = await st(() => ({ disabled: document.querySelector('#start-match')?.disabled, title: document.querySelector('#start-match')?.title }));
check('B: the match cannot start with a computer side and no AI file', startBtn.disabled && /No AI file is installed/.test(startBtn.title ?? ''), JSON.stringify(startBtn));
await st((l) => { window.BLOODBOARD_BUNDLED_AI = l; }, fullList);
await st(() => window.bloodboardAI.reload());
await sleep(200);
check('B: the files are offered again once they are back', (await selOptions('#p2-ai')).length === 3);

// ------------------------------------------------------------------ C. computer v computer → human takes a team
await page.click('#start-match');
await sleep(300);
await st(() => { const a = window.bloodboard; a.st.computer.speed = 'instant'; a.st.pauseDice = false; a.emit(); });
const o = await st(() => window.bloodboard.game.match.options.coaches);
check('C: the match records each team’s AI file (id, name, version)', o?.A?.ai === 'bloodboard-offensive' && o?.B?.ai === 'bloodboard-defensive' && o.A.version === '5.5.0' && /Offensive/.test(o.A.name), JSON.stringify(o));
check('C: the advisory coach chosen in the set-up is in use', (await st(() => window.bloodboard.st.computer.advisorAi)) === 'bloodboard-defensive');
const inPlayA = await waitFor(() => { const g = window.bloodboard.game; return g.phase === 'play' && g.turn.active === 'A' && !g.match.pendingPhase; }, null, 60000, 10);
await page.click('#computer-pause');
await waitFor(() => window.bloodboardComputer.safe() && !window.bloodboard.st.computer.thinking);
await sleep(100);
check('C: a computer v computer match reaches Team A’s Turn', !!inPlayA);
await page.click('#coaches-toggle');
await sleep(100);
const before = await core();
const logLen = await st(() => window.bloodboard.game.log.length);
await page.click('#coach-A-human');
await sleep(200);
check('C: Player 1 switched to the human coach during the match', (await coach('A')) === null && (await coach('B'))?.ai === 'bloodboard-defensive');
const after = await core();
check('C: the change leaves the board, score, Turns, players, re-rolls, dice and rules unchanged', before === after);
const t1 = await st((n) => window.bloodboard.game.log.slice(n).map((e) => ({ t: e.title, ev: e.events.map((x) => x.text).join(' ') })), logLen);
check('C: the change is written to the match log', t1.length === 1 && /human coach takes control/.test(t1[0].t) && /coach changed from the computer \(Bloodboard AI — Offensive 5\.5\.0\) to the human coach/.test(t1[0].ev), JSON.stringify(t1));
check('C: the computer card now shows one computer coach', /Computer: /.test(await st(() => document.querySelector('#computer-card h3')?.textContent ?? '')));
await page.click('#computer-pause'); // resume (the computer coaches Team B)

// ------------------------------------------------------------------ D. takeovers
async function toATurnStart() {
  // Team A (human) to act, no activation open, between actions. While waiting, the flow plays the human coach's
  // part: a decision addressed to Team A during the computer's Turn (e.g. a block die or an Apothecary) is answered
  // with its first option, and an activation left open when the computer handed Team A over is ended.
  return waitFor(() => {
    const a = window.bloodboard;
    const g = a.game;
    const E = window.BloodboardEngine;
    const human = E.coachOf(g, 'A') === null;
    if (a.playbackActive()) { a.skipPlayback(); return false; }
    if (human && g.pending && g.pending.request.team === 'A') { a.decide(g.pending.request, g.pending.request.options[0].id); return false; }
    if (human && g.phase === 'play' && g.turn.active === 'A' && g.turn.activation && !g.pending && window.bloodboardComputer.safe()) { a.runSimple({ kind: 'endActivation' }); return false; }
    return g.phase === 'play' && g.turn.active === 'A' && !g.pending && !g.match.pendingPhase && !g.turn.activation;
  }, null, 90000, 20);
}
async function humanEndsTurn() {
  await st(() => window.bloodboard.runSimple({ kind: 'endTurn' }));
  await sleep(100);
}
let ok = await toATurnStart();
check('D: Team A (human) has its Turn', !!ok);
const activated0 = await st(() => window.bloodboard.game.players.filter((p) => p.team === 'A' && p.activated).length);
const turnA = await st(() => window.bloodboard.game.teams.A.turn);
check('D: the takeover buttons are offered in the human’s Turn', !!(await page.$('#takeover-activation:not([disabled])')) && !!(await page.$('#takeover-turn:not([disabled])')) && !!(await page.$('#takeover-until')));
const logD = await st(() => window.bloodboard.game.log.length);
await page.click('#takeover-activation');
await sleep(80);
const tk = await coach('A');
check('D1: one-activation takeover starts (by the advisory coach’s file)', tk?.takeover?.mode === 'activation' && tk.ai === 'bloodboard-defensive', JSON.stringify(tk));
const back1 = await waitFor(() => window.BloodboardEngine.coachOf(window.bloodboard.game, 'A') === null && window.bloodboardComputer.safe(), null, 60000, 20);
const d1 = await st((n) => window.bloodboard.game.log.slice(n).map((e) => ({ t: e.title, k: e.input.kind, p: e.input.playerId ?? null, team: e.team })), logD);
const acts = d1.filter((e) => e.k === 'playerAction' || e.k === 'endActivation' || e.k === 'forgo');
const players1 = new Set(acts.filter((e) => e.p).map((e) => e.p));
const g1 = await st(() => { const g = window.bloodboard.game; return { active: g.turn.active, turn: g.teams.A.turn, activated: g.players.filter((p) => p.team === 'A' && p.activated).length }; });
check('D1: control comes back after one complete activation (logged)', !!back1 && /takeover ends|human coach takes control/.test(d1[d1.length - 1].t + (await st(() => window.bloodboard.game.log.slice(-1)[0].events.map((e) => e.text).join(' ')))), JSON.stringify(d1.map((e) => e.t)));
check('D1: exactly one player was activated by the takeover', players1.size <= 1 && (g1.active !== 'A' || g1.activated === activated0 + 1), `${[...players1]} · activated ${activated0} → ${g1.activated} · ${JSON.stringify(g1)}`);
check('D1: the human’s Turn was not ended by the takeover (unless a Turnover)', g1.active === 'A' && g1.turn === turnA ? true : d1.some((e) => /Turnover|turnover/.test(e.t)) || (await st(() => window.bloodboard.game.log.slice(-4).some((e) => e.outcome === 'turnover' || e.outcome === 'touchdown'))), JSON.stringify(g1));

// Rest of this Turn
if (!(await st(() => window.bloodboard.game.turn.active === 'A' && !window.bloodboard.game.turn.activation))) ok = await toATurnStart();
else ok = true;
const turnA2 = await st(() => window.bloodboard.game.teams.A.turn);
const logD2 = await st(() => window.bloodboard.game.log.length);
await page.click('#takeover-turn');
await sleep(60);
check('D2: rest-of-Turn takeover starts (logged)', await st((n) => window.bloodboard.game.log.slice(n).some((e) => e.input.kind === 'coachChange' && e.input.coach?.takeover?.mode === 'turn'), logD2));
const back2 = await waitFor(() => window.BloodboardEngine.coachOf(window.bloodboard.game, 'A') === null, null, 90000, 20);
const g2 = await st(() => { const g = window.bloodboard.game; return { active: g.turn.active, turnA: g.teams.A.turn, phase: g.phase }; });
check('D2: control comes back when the Turn is over', !!back2 && (g2.active === 'B' || g2.turnA !== turnA2 || g2.phase !== 'play'), JSON.stringify(g2));
const end2 = await st(() => window.bloodboard.game.log.filter((e) => e.input.kind === 'coachChange').slice(-1)[0]?.events.map((e) => e.text).join(' '));
check('D2: the end of the takeover is logged', /takeover ends/.test(end2 ?? ''), end2);

// Until I take control back
ok = await toATurnStart();
if (!ok) console.log('D3: Team A\'s Turn did not start —', JSON.stringify(await st(() => { const a = window.bloodboard; const g = a.game; return { phase: g.phase, active: g.turn.active, turnA: g.teams.A.turn, turnB: g.teams.B.turn, pending: g.pending ? { team: g.pending.request.team, kind: g.pending.request.kind } : null, pp: g.match?.pendingPhase?.type ?? null, activation: !!g.turn.activation, playback: a.playbackActive(), paused: a.st.computer.paused, thinking: a.st.computer.thinking, coaches: g.match?.options.coaches, last: g.log.slice(-3).map((e) => e.title) }; })));
await page.click('#takeover-until');
await sleep(60);
check('D3: “until I take back” takeover starts', (await coach('A'))?.takeover?.mode === 'untilBack');
const turnStart3 = await st(() => window.bloodboard.game.teams.A.turn);
const passed = await waitFor((t) => { const g = window.bloodboard.game; return (g.teams.A.turn > t && g.turn.active === 'A') || g.phase !== 'play'; }, turnStart3, 120000, 30);
check('D3: the takeover goes on past the end of the Turn', !!passed && (await coach('A'))?.takeover?.mode === 'untilBack', JSON.stringify(await st(() => ({ a: window.bloodboard.game.teams.A.turn, ph: window.bloodboard.game.phase }))));
await page.click('#takeover-back-A').catch(() => st(() => document.querySelector('#takeover-back-A')?.click()));
const back3 = await waitFor(() => window.BloodboardEngine.coachOf(window.bloodboard.game, 'A') === null, null, 60000, 20);
const lastCC = await st(() => { const g = window.bloodboard.game; const i = g.log.map((e) => e.input.kind).lastIndexOf('coachChange'); return { t: g.log[i].title, prevPending: false, ev: g.log[i].events.map((e) => e.text).join(' ') }; });
check('D3: “Take back control” returns the team to the human (logged)', !!back3 && /takeover ends/.test(lastCC.ev), lastCC.ev);
// Every coach change of the match sits between complete actions: never inside a pending decision.
const between = await st(() => window.bloodboard.st.history.every((h, i, hs) => { const next = hs[i + 1]?.game ?? window.bloodboard.game; const cc = next.log[next.log.length - 1]; return !(cc && cc.input.kind === 'coachChange') || !h.game.pending; }));
check('D: no coach change was applied while a decision was pending', between);

// ------------------------------------------------------------------ E. the advisory coach
ok = await toATurnStart();
await st(() => { window.bloodboard.st.computer.paused = true; window.bloodboard.emit(); });
await sleep(80);
if (!(await page.$('#advisor-ai'))) await page.click('#coaches-toggle');
await sleep(80);
await setSel('#advisor-ai', 'bloodboard-offensive');
const g0 = await st(() => JSON.stringify(window.bloodboard.game));
await page.click('#advisor-btn');
const advDone = await waitFor(() => document.querySelector('#advisor-source')?.textContent, null, 30000, 50);
check('E: the advisory coach gives advice (named AI file)', /Offensive 5\.5\.0/.test(advDone ?? ''), advDone?.slice(0, 80));
const advText = await st(() => document.querySelector('#advisor-card')?.textContent ?? '');
check('E: the advice has a recommendation, chances and risks', /(Suggested|Slight preference|Recommendation)/.test(advText) && /Turnover/.test(advText) && /(Main downside|end the Turn)/.test(advText), advText.slice(0, 200));
check('E: asking for advice changes nothing (board, log, dice generator)', g0 === (await st(() => JSON.stringify(window.bloodboard.game))));
await setSel('#advisor-ai-focus', 'bloodboard-balanced');
const adv2 = await waitFor(() => /Balanced/.test(document.querySelector('#advisor-source')?.textContent ?? '') && document.querySelector('#advisor-source')?.textContent, null, 30000, 50);
check('E: the advisory coach can be changed during the match (advice recalculated)', !!adv2, adv2?.slice(0, 60));
check('E: the advisory coach can differ from both team controllers', (await st(() => window.bloodboard.st.computer.advisorAi)) === 'bloodboard-balanced' && (await coach('B'))?.ai === 'bloodboard-defensive');
check('E: still unchanged after the second analysis', g0 === (await st(() => JSON.stringify(window.bloodboard.game))));

// ------------------------------------------------------------------ F. waiting for a pending decision; AI file change; hot-seat
// A human decision pending (a 2-dice Block by Team A): a change asked for now waits for it.
const made = await st(() => {
  const app = window.bloodboard;
  const E = window.BloodboardEngine;
  const g = E.cloneState(app.game);
  const a = g.players.find((p) => p.team === 'A' && p.location === 'pitch' && p.stance === 'standing' && !p.activated);
  const b = g.players.find((p) => p.team === 'B' && p.location === 'pitch' && p.stance === 'standing');
  if (!a || !b) return false;
  // Put them side by side in open space, the attacker much stronger (two dice, attacker chooses).
  for (const p of g.players)
    if (p !== a && p !== b && p.location === 'pitch' && p.pos && Math.abs(p.pos.x - 12) <= 3 && Math.abs(p.pos.y - 7) <= 3) {
      if (g.ball.kind === 'held' && g.ball.playerId === p.id) g.ball = { kind: 'ground', pos: { ...p.pos } };
      p.location = 'reserves';
      p.pos = null;
    }
  a.pos = { x: 12, y: 7 };
  b.pos = { x: 13, y: 7 };
  a.st = 6;
  b.st = 2;
  g.turn.activation = null;
  if (g.ball.kind === 'held' && (g.ball.playerId === a.id || g.ball.playerId === b.id)) g.ball = { kind: 'ground', pos: { x: 2, y: 2 } };
  app.replaceGame(g, { keepDirty: true });
  app.runSimple({ kind: 'playerAction', playerId: a.id, action: 'block', path: [], blockTarget: b.id });
  return !!app.game.pending;
});
check('F: a Block leaves the human a decision to make', made);
await page.click('#coaches-toggle').catch(() => undefined);
await sleep(80);
if (!(await page.$('#coach-B-ai'))) await page.click('#coaches-toggle');
await sleep(80);
await setSel('#coach-B-ai', 'bloodboard-balanced');
const waiting = await st(() => ({ pend: !!document.querySelector('#coach-B-pending'), ai: window.BloodboardEngine.coachOf(window.bloodboard.game, 'B')?.ai }));
check('F: a change asked for during a pending decision waits (shown as waiting)', waiting.pend && waiting.ai === 'bloodboard-defensive', JSON.stringify(waiting));
// Answer the human decision(s).
for (let i = 0; i < 6; i++) {
  const r = await st(() => { const a = window.bloodboard; const p = a.game.pending; if (!p || window.BloodboardEngine.coachOf(a.game, p.request.team)) return false; a.decide(p.request, p.request.options[0].id); return true; });
  if (!r) break;
  await sleep(60);
}
const applied = await waitFor(() => window.BloodboardEngine.coachOf(window.bloodboard.game, 'B')?.ai === 'bloodboard-balanced', null, 20000, 20);
check('F: … and is applied once the decision is answered (logged)', !!applied && /coached by Bloodboard AI — Balanced/.test((await lastTitles(3)).join(' | ')), (await lastTitles(3)).join(' | '));
await page.click('#coach-B-human');
await sleep(150);
check('F: switching the computer team to a human gives a hot-seat match', (await coach('B')) === null && !(await page.$('#computer-card')));
await page.click('#coach-B-computer');
await sleep(150);
check('F: … and back to the computer (the file it used before)', (await coach('B'))?.ai === 'bloodboard-balanced' && !!(await page.$('#computer-card')));

// ------------------------------------------------------------------ G. saved match; missing AI file
const reopened = await st(() => {
  const app = window.bloodboard;
  const E = window.BloodboardEngine;
  const text = E.serializeGame ? E.serializeGame(app.game) : JSON.stringify(app.game);
  const g = E.deserializeGame ? E.deserializeGame(text) : JSON.parse(text);
  g.match.options.coaches.B = { ai: 'old-ai-file', name: 'Old AI', version: '0.9' };
  app.openBoard(g, { kind: 'match', matchKind: 'tournament' }, { docName: 'reopened' });
  return window.bloodboardComputer.coaches();
});
await sleep(200);
check('G: a reopened match keeps its coaches; a missing AI file falls back to an installed one', reopened.length === 1 && reopened[0].team === 'B' && reopened[0].missing && reopened[0].file === 'bloodboard-balanced' && reopened[0].name === 'Old AI', JSON.stringify(reopened));
check('G: the Coaches card reports the missing file', /not installed here/.test(await st(() => document.querySelector('#coaches-card')?.textContent ?? '')));

// ------------------------------------------------------------------ H. strategy module
const code = (await import('node:fs')).readFileSync('ai/examples/cautious-scorer.js', 'utf8');
if (code) {
  await st((code) => { window.BLOODBOARD_BUNDLED_AI = [...window.BLOODBOARD_BUNDLED_AI, { name: 'cautious-scorer.js', text: code }]; }, code);
  await st(() => window.bloodboardAI.reload());
  await sleep(600);
  const cs = await st(() => window.bloodboardAI.list().find((c) => c.id === 'cautious-scorer'));
  check('H: a strategy module is listed as its own AI file (id, version)', cs && cs.kind === 'strategy' && cs.version === '1.0' && !cs.errors, JSON.stringify(cs));
  const obs = await st(() => JSON.stringify(window.bloodboardAI.observe('A')));
  check('H: the observation a module gets holds no dice generator (no seed, no counter)', !/"rng"|"seed"|"counter"/.test(obs), obs.slice(0, 120));
  if (cs && !cs.errors) {
    await st(() => { const a = window.bloodboard; a.st.computer.paused = false; a.st.computer.advisorAi = 'cautious-scorer'; a.emit(); });
    const human = await toATurnStart();
    if (human) {
      await st(() => { window.bloodboard.st.computer.paused = true; window.bloodboard.emit(); });
      const g5 = await st(() => JSON.stringify(window.bloodboard.game));
      await page.click('#advisor-btn');
      const src = await waitFor(() => document.querySelector('#advisor-source')?.textContent, null, 30000, 50);
      check('H: a strategy module gives read-only advice as the advisory coach', /Cautious Scorer 1\.0/.test(src ?? '') && g5 === (await st(() => JSON.stringify(window.bloodboard.game))), src?.slice(0, 80));
    }
  }
} else check('H: example strategy module readable', false, 'fetch failed (file://)');

const bad = errors.filter((e) => !/favicon/.test(e));
check('no page errors', bad.length === 0, bad.slice(0, 3).join(' | '));
const fails = results.filter((r) => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} passed in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
await browser.close();
process.exit(fails.length ? 1 : 0);
