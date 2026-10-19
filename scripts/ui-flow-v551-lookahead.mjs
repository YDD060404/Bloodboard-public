// V5.5.1 interface flow — the strategy interface's look-ahead services (docs/AI_EXTENSIONS.md):
//  A. a strategy module that uses them, as a team's coach in the real Web Worker: `bloodboard.services` lists them;
//     `evaluate`, `explore` (outcomes, probabilities and values that add up; the candidate's Turnover chance), a
//     position key to `evaluate` / `explore` / `plan` / `reachable` from, `endTurn` explored into the other team's
//     Turn and one of their moves explored from there, an unknown key refused, `maxMs` bounding an enumeration,
//     nothing of the dice generator in what the module receives; its answer is used (no fallback notice);
//  B. the same module as the advisory coach: advice that explores many positions leaves the game (and its dice
//     generator) exactly as it was;
//  C. a V5.5 module that does not know the services still plays (the example Cautious Scorer).
// Run after `node scripts/build.mjs`:  node scripts/ui-flow-v551-lookahead.mjs
import { readFileSync } from 'node:fs';
import { open } from './ui-helpers.mjs';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const MODULE = `
bloodboard.register({
  id: 'lookahead-check', name: 'Look-ahead Check', apiVersion: 1, version: '1.0', timeLimitMs: 20000,
  description: 'Test module: calls every look-ahead service once, then plays the first candidate.',
  async chooseAction(obs, cands, sv) {
    const r = { services: bloodboard.services, hasExplore: typeof sv.explore === 'function', t0: Date.now() };
    const c = cands.find((k) => typeof k.builtInValue === 'number' && k.input.kind === 'playerAction') || cands[0];
    const ev = await sv.evaluate();
    r.evalOk = typeof ev.value === 'number' && Number.isFinite(ev.value) && typeof ev.terms === 'object';
    const e = await sv.explore(c.input, { maxOutcomes: 40 });
    r.ok = e.ok;
    r.sumP = e.outcomes.reduce((a, o) => a + o.p, 0) + e.rest.p;
    r.valueGap = Math.abs(e.outcomes.reduce((a, o) => a + o.p * o.value, 0) + e.rest.p * e.rest.value - e.value);
    r.pTO = e.pTurnover;
    r.candPTO = c.pTurnover || 0;
    r.leaves = e.leaves;
    r.clean = !/"rng"|"seed"|"counter"/.test(JSON.stringify(e)) && !/"rng"|"seed"|"counter"/.test(JSON.stringify(obs));
    const o = e.outcomes.find((x) => x.key && !x.turnover && !x.touchdown) || e.outcomes.find((x) => x.key);
    r.keyType = typeof (o && o.key);
    if (o && o.observation) {
      const ev2 = await sv.evaluate(o.key);
      r.evalFrom = Number.isFinite(ev2.value);
      const et = await sv.explore({ kind: 'endTurn' }, { from: o.key, maxOutcomes: 3 });
      r.endTurnOk = et.ok;
      const opp = et.ok && et.outcomes[0];
      r.turnBefore = obs.turn;
      r.turnAfter = opp && opp.observation ? opp.observation.turn : null;
      if (opp && opp.key) {
        const q = opp.observation.players.find((p) => p.team !== obs.team && p.location === 'pitch' && p.stance === 'standing' && !p.activated);
        const reach = q ? await sv.reachable(q.id, opp.key) : [];
        r.oppReach = reach.length;
        const sq = reach.find((s) => s.rushes === 0 && Math.max(Math.abs(s.x - q.pos.x), Math.abs(s.y - q.pos.y)) === 1);
        if (sq) {
          const input = { kind: 'playerAction', playerId: q.id, action: 'move', path: [{ to: { x: sq.x, y: sq.y }, kind: 'step' }] };
          const pl = await sv.plan(input, opp.key);
          const ex = await sv.explore(input, { from: opp.key, maxOutcomes: 2 });
          r.oppPlanOk = pl.ok;
          r.oppExploreOk = ex.ok;
          r.oppMoved = ex.ok && ex.outcomes[0] && ex.outcomes[0].observation.players.find((p) => p.id === q.id).pos;
          r.oppTarget = { x: sq.x, y: sq.y };
        }
      }
    }
    const heavy = cands.find((k) => k.input.kind === 'playerAction' && (k.input.action === 'block' || k.input.action === 'blitz')) || c;
    const t1 = Date.now();
    const h = await sv.explore(heavy.input, { threshold: 1e-6, maxLeaves: 5000, maxMs: 50 });
    r.maxMsMs = Date.now() - t1;
    r.maxMsResult = h.ok ? 'ok' : h.timedOut ? 'timedOut' : 'error: ' + h.errors[0];
    r.heavyLeaves = h.ok ? h.leaves : 0;
    try {
      await sv.explore(c.input, { from: 'no-such-position' });
      r.badKey = 'accepted';
    } catch (err) {
      r.badKey = String(err && err.message || err).slice(0, 90);
    }
    r.ms = Date.now() - r.t0;
    return { candidateId: c.id, why: 'LOOKAHEAD ' + JSON.stringify(r) };
  },
});
`;

const { browser, page, errors } = await open({ home: true, width: 1470, height: 920 });
const st = (fn, arg) => page.evaluate(fn, arg);
const sleep = (ms) => page.waitForTimeout(ms);
const t0 = Date.now();
async function waitFor(fn, arg, ms = 30000, step = 50) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await st(fn, arg);
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(step);
  }
}
await st((code) => { window.BLOODBOARD_BUNDLED_AI = [...window.BLOODBOARD_BUNDLED_AI, { name: 'lookahead-check.js', text: code }]; }, MODULE);
await st(() => window.bloodboardAI.reload());
await sleep(700);
const listed = await st(() => window.bloodboardAI.list().find((c) => c.id === 'lookahead-check'));
check('the test module is listed as a strategy module', listed && listed.kind === 'strategy' && !listed.errors, JSON.stringify(listed));

// ------------------------------------------------------------------ A. as a team's coach (computer v computer, Sevens)
await page.click('#exhibition-setup');
await sleep(400);
await page.click('#setup-format-sevens').catch(() => {});
await page.click('#p1-controller-computer');
await page.click('#p2-controller-computer');
await sleep(200);
await page.selectOption('#p1-ai', 'lookahead-check');
await page.selectOption('#p2-ai', 'bloodboard-balanced');
await sleep(150);
await page.click('#start-match');
await sleep(500);
await page.click('#computer-speed [data-speed="instant"]').catch(() => {});
const toasts = [];
const rec = await waitFor(() => {
  const a = window.bloodboard;
  if (a.playbackActive()) a.skipPlayback();
  const t = document.querySelector('.toast')?.textContent ?? '';
  if (t && /decided this one/.test(t)) return { toast: t };
  const r = (a.st.computer.records || []).find((x) => x.team === 'A' && /LOOKAHEAD /.test(x.text));
  return r ? { text: r.text } : null;
}, null, 180000, 100);
if (rec && rec.toast) toasts.push(rec.toast);
let R = null;
try {
  R = rec && rec.text ? JSON.parse(rec.text.slice(rec.text.indexOf('LOOKAHEAD ') + 10).replace(/\.$/, '')) : null;
} catch {
  R = null;
}
check('A: the module answered through the worker (its choice was used, no fallback notice)', !!R && !toasts.length, rec ? (rec.toast ?? rec.text.slice(0, 120)) : 'no answer');
if (R) {
  // V5.6: the list only grows (additive) — the four V5.5.1 services stay first, in the same order.
check('A: bloodboard.services lists plan, reachable, explore, evaluate (V5.6 adds more after them)', JSON.stringify(R.services.slice(0, 4)) === JSON.stringify(['plan', 'reachable', 'explore', 'evaluate']) && R.hasExplore, JSON.stringify(R.services));
  check('A: evaluate() returns the built-in evaluation (value and terms)', R.evalOk);
  check('A: explore() enumerates the action: outcome probabilities add up to 1', R.ok && Math.abs(R.sumP - 1) < 1e-6, `sum ${R.sumP} over ${R.leaves} leaves`);
  check('A: explore() value = the probability-weighted outcome values', R.valueGap < 1e-6, String(R.valueGap));
  check('A: explore() Turnover chance matches the candidate’s (same enumeration)', Math.abs(R.pTO - R.candPTO) < 0.02, `${R.pTO} vs ${R.candPTO}`);
  check('A: outcomes come with position keys; evaluate(key) works', R.keyType === 'string' && R.evalFrom);
  check('A: endTurn explored from a key leads into the other team’s Turn', R.endTurnOk && R.turnAfter && R.turnAfter.A + R.turnAfter.B === R.turnBefore.A + R.turnBefore.B + 1, `${JSON.stringify(R.turnBefore)} → ${JSON.stringify(R.turnAfter)}`);
  check('A: reachable / plan / explore from that key (one of their moves)', R.oppReach > 0 && R.oppPlanOk && R.oppExploreOk && R.oppMoved && R.oppMoved.x === R.oppTarget.x && R.oppMoved.y === R.oppTarget.y, JSON.stringify({ reach: R.oppReach, plan: R.oppPlanOk, ex: R.oppExploreOk, moved: R.oppMoved, to: R.oppTarget }));
  check('A: an unknown position key is refused', /Unknown position/.test(R.badKey), R.badKey);
  check('A: maxMs bounds an enumeration (a fine-grained Block enumeration with maxMs 50 is stopped or finishes quickly)', (R.maxMsResult === 'timedOut' || R.maxMsResult === 'ok') && R.maxMsMs < 3000, `${R.maxMsResult} after ${R.maxMsMs} ms${R.heavyLeaves ? `, ${R.heavyLeaves} leaves` : ''}`);
  check('A: nothing of the dice generator in the observation or the explored outcomes', R.clean);
}
// Let the watched match run on a little: the module keeps answering (each Turn action of Team A).
await waitFor(() => {
  const a = window.bloodboard;
  if (a.playbackActive()) a.skipPlayback();
  const t = document.querySelector('.toast')?.textContent ?? '';
  if (t && /decided this one/.test(t)) return true;
  return (a.st.computer.records || []).filter((x) => x.team === 'A' && /LOOKAHEAD /.test(x.text)).length >= 4;
}, null, 180000, 100);
const n4 = await st(() => (window.bloodboard.st.computer.records || []).filter((x) => x.team === 'A' && /LOOKAHEAD /.test(x.text)).length);
const toast2 = await st(() => document.querySelector('.toast')?.textContent ?? '');
check('A: the module keeps answering (several Turn actions, no fallback notice)', n4 >= 4 && !/decided this one/.test(toast2), `${n4} answers ${toast2.slice(0, 80)}`);

// ------------------------------------------------------------------ B. advisory coach: read-only
await page.click('.brand');
await sleep(300);
await page.click('#exhibition-setup');
await sleep(400);
await page.click('#setup-format-sevens').catch(() => {});
await page.click('#p1-controller-human');
await page.click('#p2-controller-computer');
await sleep(200);
await page.selectOption('#p2-ai', 'bloodboard-balanced');
await page.selectOption('#setup-advisor', 'lookahead-check').catch(() => {});
await sleep(150);
await page.click('#start-match');
await sleep(500);
await page.click('#computer-speed [data-speed="instant"]').catch(() => {});
const human = await waitFor(() => {
  const a = window.bloodboard;
  const g = a.game;
  if (a.playbackActive()) { a.skipPlayback(); return false; }
  if (g.pending && g.pending.request.team === 'A') { a.decide(g.pending.request, g.pending.request.options[0].id); return false; }
  if (g.phase === 'pregame') { document.querySelector('#pregame-btn')?.click(); return false; }
  if (g.phase === 'driveSetup') {
    const m = g.match;
    const needA = m && (m.kicking === 'A' ? !m.setupDone.A : m.setupDone[m.kicking] && !m.setupDone.A);
    const btn = [...document.querySelectorAll('button')].find((b) => /Default formation/.test(b.textContent));
    if (needA && btn) { btn.click(); setTimeout(() => document.querySelector('#confirm-setup')?.click(), 100); }
    return false;
  }
  if (g.phase === 'kickoff' && g.match?.kicking === 'A' && !g.match.pendingPhase) {
    const k = window.BloodboardEngine.kickerCandidates(g, 'A')[0];
    if (k) a.runSimple({ kind: 'kickoff', kicker: k.id, target: { x: 14, y: 5 } });
    return false;
  }
  if (g.phase === 'kickoff' && g.match?.pendingPhase && g.match.pendingPhase.team === 'A') { document.querySelector('#confirm-event')?.click(); document.querySelector('#end-charge')?.click(); return false; }
  return g.phase === 'play' && g.turn.active === 'A' && !g.pending && !g.match.pendingPhase && !g.turn.activation;
}, null, 180000, 100);
check('B: Team A (human) has its Turn', !!human);
if (human) {
  await st(() => { window.bloodboard.st.computer.paused = true; window.bloodboard.st.computer.advisorAi = 'lookahead-check'; window.bloodboard.emit(); });
  await sleep(200);
  const before = await st(() => JSON.stringify(window.bloodboard.game));
  await page.click('#advisor-btn');
  const src = await waitFor(() => document.querySelector('#advisor-source')?.textContent, null, 60000, 100);
  const adviceText = await st(() => document.querySelector('#advisor-panel, .advisor, #advisor-card')?.textContent ?? document.body.innerText);
  const after = await st(() => JSON.stringify(window.bloodboard.game));
  check('B: the advisory coach’s advice uses the look-ahead (the module answered)', /Look-ahead Check 1\.0/.test(src ?? '') && /LOOKAHEAD/.test(adviceText), (src ?? '').slice(0, 80));
  check('B: exploring leaves the game and its dice generator exactly as they were', before === after);
}

// ------------------------------------------------------------------ C. a V5.5 module without the services
const cautious = readFileSync('ai/examples/cautious-scorer.js', 'utf8');
await st((code) => { window.BLOODBOARD_BUNDLED_AI = [...window.BLOODBOARD_BUNDLED_AI, { name: 'cautious-scorer.js', text: code }]; }, cautious);
await st(() => window.bloodboardAI.reload());
await sleep(700);
await page.click('.brand');
await sleep(300);
await page.click('#exhibition-setup');
await sleep(400);
await page.click('#setup-format-sevens').catch(() => {});
await page.click('#p1-controller-computer');
await page.click('#p2-controller-computer');
await sleep(200);
await page.selectOption('#p1-ai', 'cautious-scorer');
await page.selectOption('#p2-ai', 'bloodboard-balanced');
await sleep(150);
await page.click('#start-match');
await sleep(500);
await page.click('#computer-speed [data-speed="instant"]').catch(() => {});
const cs = await waitFor(() => {
  const a = window.bloodboard;
  if (a.playbackActive()) a.skipPlayback();
  const t = document.querySelector('.toast')?.textContent ?? '';
  if (t && /decided this one/.test(t)) return { toast: t };
  const n = window.bloodboard.game.log.filter((e) => e.team === 'A' && e.input?.kind === 'playerAction').length;
  return n >= 3 ? { n } : null;
}, null, 180000, 100);
check('C: a V5.5 strategy module (no look-ahead) still plays its Turns', cs && cs.n >= 3, JSON.stringify(cs));

const bad = errors.filter((e) => !/favicon/.test(e));
check('no page errors', bad.length === 0, bad.slice(0, 3).join(' | '));
const fails = results.filter((r) => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} passed in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
await browser.close();
process.exit(fails.length ? 1 : 0);
