// V5.5 interface flow — Bloodlust (p.125) without an extra no-op step:
//  A. a failed roll with a Thrall still reachable keeps the activation open (Bloodlust movement); the tray says what is
//     left and the End activation button says it is a Turnover;
//  B. planning another player then is not offered as an Action to confirm: one click ends the hungry activation
//     (Turnover) and the Turn passes;
//  C. no Thrall reachable: the Turnover is resolved right after the confirmed move and the Turn passes at once;
//  D. next to a Thrall: ending the activation asks the bite (bite / No bite (Turnover)); biting keeps the Turn going.
// Run after `node scripts/build.mjs`:  node scripts/ui-flow-v55-bloodlust.mjs
import { open, clickSq, drainTray, waitPlan } from './ui-helpers.mjs';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const { browser, page, errors } = await open({});
const st = (fn, arg) => page.evaluate(fn, arg);
const sleep = (ms) => page.waitForTimeout(ms);

/** Position: spec id → [x, y, stance?]; vampire ids get Bloodlust 2 (+ Hypnotic Gaze); thrall ids get the Thrall keyword. */
async function position(spec, { vampires = [], thralls = [], ball = null, seedFor = null } = {}) {
  return st(
    ({ spec, vampires, thralls, ball, seedFor }) => {
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
        } else {
          p.location = 'reserves';
          p.pos = null;
        }
        p.activated = false;
        if (vampires.includes(p.id)) p.skills = [...p.skills.filter((k) => k.id !== 'bloodlust'), { id: 'bloodlust', value: 2 }, { id: 'hypnoticGaze' }];
        if (thralls.includes(p.id)) p.keywords = [...p.keywords, 'Thrall'];
      }
      g.ball = ball ? { kind: 'ground', pos: { x: ball[0], y: ball[1] } } : { kind: 'ground', pos: { x: 1, y: 1 } };
      g.turn.active = 'A';
      g.turn.activation = null;
      g.turn.used = { blitz: false, pass: false, handoff: false, foul: false, ttm: false, secure: false };
      g.teams.A.rerolls = 0;
      g.teams.A.turn = 3;
      g.teams.B.turn = 2;
      // a seed whose first D6 is a 1 (Bloodlust fails)
      if (seedFor) {
        for (let sd = 1; sd < 5000; sd++) {
          const t = E.cloneState(g);
          t.rng = { seed: sd * 7919, counter: 0 };
          const r = E.execute(t, seedFor);
          const hungry = (r.state.turn.activation?.bloodlust === 'hungry') || (r.state.pending?.request?.type === 'bloodlust') || r.events.some((e) => /overcome by Bloodlust/.test(e.text));
          if (hungry) {
            g.rng = { seed: sd * 7919, counter: 0 };
            break;
          }
        }
      }
      app.openBoard(g, { kind: 'practice', name: 'Bloodlust check', start: E.cloneState(g) }, { docName: 'Bloodlust check' });
      app.st.pauseDice = false;
      app.emit();
      return g.rng;
    },
    { spec, vampires, thralls, ball, seedFor },
  );
}
const snap = () =>
  st(() => {
    const app = window.bloodboard;
    const g = app.game;
    return {
      active: g.turn.active,
      activation: g.turn.activation ? { id: g.turn.activation.playerId, action: g.turn.activation.action, bl: g.turn.activation.bloodlust, over: g.turn.activation.over, ma: g.turn.activation.maUsed } : null,
      pending: g.pending ? { type: g.pending.request.type, prompt: g.pending.request.prompt, opts: g.pending.request.options.map((o) => o.id + ':' + o.label) } : null,
      tray: document.querySelector('.trayctl')?.textContent ?? '',
      draft: app.st.draft ? { p: app.st.draft.playerId, a: app.st.draft.action, path: app.st.draft.path.length } : null,
      plan: app.st.plan ? { ok: app.st.plan.ok, error: app.st.plan.error, turnover: app.st.plan.pTurnover } : null,
      last: g.log.at(-1)?.events.map((e) => e.text).join(' | ').slice(-400),
    };
  });


const moveA1 = { kind: 'playerAction', playerId: 'A1', action: 'move', path: [{ to: { x: 11, y: 7 }, kind: 'step' }] };

// ------------------------------------------------------------------ A / B
await position({ A1: [10, 7], A2: [4, 3], A3: [5, 10], B1: [20, 7] }, { vampires: ['A1'], thralls: ['A2'], seedFor: moveA1 });
await clickSq(page, 10, 7);
await clickSq(page, 11, 7);
await waitPlan(page);
await page.click('#tray-confirm');
await sleep(200);
await drainTray(page);
let s = await snap();
check('A: a failed Bloodlust roll with a Thrall in reach is not an immediate Turnover (the activation stays open)', s.active === 'A' && s.activation?.bl === 'hungry', JSON.stringify(s.activation));
check('A: the tray says what is left and that ending now is a Turnover', /must still bite a Thrall — move next to one/.test(s.tray) && /End activation \(Turnover\)/.test(s.tray), s.tray);
await clickSq(page, 5, 10);
await clickSq(page, 6, 10);
await waitPlan(page);
s = await snap();
const confirmDisabled = await st(() => document.querySelector('#tray-confirm')?.disabled);
const hb = await st(() => document.querySelector('#tray-end-hungry')?.textContent ?? null);
check('B: another player’s Action is not offered for confirmation (it would not be taken)', s.plan && !s.plan.ok && confirmDisabled, JSON.stringify(s.plan));
check('B: instead one button ends the hungry activation', /End .* activation \(Bloodlust Turnover\)/.test(hb ?? ''), hb);
const logBefore = await st(() => window.bloodboard.game.log.length);
await page.click('#tray-end-hungry');
await sleep(200);
await drainTray(page);
s = await snap();
const logAfter = await st(() => window.bloodboard.game.log.length);
check('B: one click — Turnover resolved and the Turn has passed to the opponent', s.active === 'B' && !s.activation && logAfter === logBefore + 1 && /did not bite a Thrall/.test(s.last), s.last);
check('B: the other player did not move', await st(() => { const p = window.bloodboard.game.players.find((q) => q.id === 'A3'); return p.pos.x === 5 && p.pos.y === 10 && !p.activated; }));

// ------------------------------------------------------------------ C
await position({ A1: [10, 7], A2: [24, 13], A3: [5, 10], B1: [20, 2] }, { vampires: ['A1'], thralls: ['A2'], seedFor: moveA1 });
await st(() => { const g = window.bloodboard.game; g.players.find((q) => q.id === 'A1').ma = 4; window.bloodboard.emit(); });
await clickSq(page, 10, 7);
await clickSq(page, 11, 7);
await waitPlan(page);
await page.click('#tray-confirm');
await sleep(200);
await drainTray(page);
s = await snap();
check('C: no Thrall in reach — the move is made, the Turnover resolved and the Turn passes with no further step', s.active === 'B' && !s.activation && /moves K8 → L8\. \| Turnover: .* did not bite a Thrall/.test(s.last), s.last);

// ------------------------------------------------------------------ D
await position({ A1: [10, 7], A2: [12, 8], A3: [5, 10], B1: [20, 2] }, { vampires: ['A1'], thralls: ['A2'], seedFor: moveA1 });
await clickSq(page, 10, 7);
await clickSq(page, 11, 7);
await waitPlan(page);
await page.click('#tray-confirm');
await sleep(200);
await drainTray(page);
s = await snap();
check('D: next to a Thrall with movement left — the activation stays open (the player may still move)', s.active === 'A' && s.activation?.bl === 'hungry' && /End activation \(bite\?\)/.test(s.tray), s.tray);
await page.click('#tray-end-activation');
await sleep(200);
await drainTray(page);
s = await snap();
check('D: ending the activation asks the bite, with “No bite (Turnover)” as the alternative', s.pending?.type === 'bloodlust' && s.pending.opts.some((o) => /^A2:Bite /.test(o)) && s.pending.opts.includes('none:No bite (Turnover)'), JSON.stringify(s.pending));
await st(() => { const app = window.bloodboard; app.decide(app.game.pending.request, 'A2'); });
await sleep(200);
await drainTray(page);
s = await snap();
check('D: biting the Thrall — no Turnover, the Turn goes on', s.active === 'A' && !s.activation && !s.pending && /bites/.test(s.last), s.last);

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed; page errors: ${errors.length}`);
if (errors.length) console.log(errors.join('\n'));
await browser.close();
process.exit(results.every((r) => r.ok) && !errors.length ? 0 : 1);
