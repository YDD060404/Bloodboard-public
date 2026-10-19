// V5.5 visual check of the dice tray (feedback/2026-09-27-sevens-*-tray-text-overlap.png): a Sevens Exhibition match,
// Lizardmen (you) v High Elf (computer), "Pause after each roll" on —
//  1. the set-up right after the pre-game rolls (the tray shows the last roll, the events after it and the set-up controls);
//  2. an active Turn after a roll (a Rush), with another player selected (the tray shows his Actions and End Turn).
// Screenshots at several ordinary Mac window sizes go to build/shots/tray-*.png; the script also measures the layout
// (text column widths, tray height, pitch size) and fails when the text collapses or the pitch is squeezed.
// Run after `node scripts/build.mjs`:  node scripts/ui-shot-tray.mjs
import { mkdirSync } from 'node:fs';
import { open, drainTray, startReadyMatch } from './ui-helpers.mjs';

mkdirSync('build/shots', { recursive: true });
const SIZES = (process.env.SIZES || '1280x800,1440x900,1100x720,1680x1050').split(',').map((s) => s.split('x').map(Number));
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const tag = process.env.TAG || 'after';

async function measure(page) {
  return page.evaluate(() => {
    const r = (el) => (el ? el.getBoundingClientRect() : null);
    const tray = document.querySelector('.tray');
    const texts = [...document.querySelectorAll('.tray .traytext, .tray .trayafter li, .tray .trayq')].map((el) => ({ w: Math.round(r(el).width), h: Math.round(r(el).height), t: el.textContent.slice(0, 40) }));
    const pitch = r(document.querySelector('.pitchhost svg'));
    const svg = document.querySelector('.pitchhost svg');
    const vb = svg?.getAttribute('viewBox')?.split(/\s+/).map(Number);
    const scale = pitch && vb ? Math.min(pitch.width / vb[2], pitch.height / vb[3]) : 0;
    // Overlaps between the tray's text blocks, dice and controls.
    const boxes = [...document.querySelectorAll('.tray .traytext, .tray .trayafter, .tray .traydice, .tray .trayctl button, .tray .trayidle button, .tray .trayq')].map((el) => ({ el: el.className || el.tagName, b: r(el) })).filter((x) => x.b.width > 0 && x.b.height > 0);
    let overlaps = 0;
    const pairs = [];
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i].b;
        const c = boxes[j].b;
        const ix = Math.min(a.right, c.right) - Math.max(a.left, c.left);
        const iy = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
        const contains = (a.left <= c.left && a.right >= c.right && a.top <= c.top && a.bottom >= c.bottom) || (c.left <= a.left && c.right >= a.right && c.top <= a.top && c.bottom >= a.bottom);
        if (ix > 2 && iy > 2 && !contains) {
          overlaps++;
          pairs.push(`${boxes[i].el} × ${boxes[j].el}`);
        }
      }
    return { trayH: Math.round(r(tray)?.height ?? 0), trayW: Math.round(r(tray)?.width ?? 0), texts, minTextW: texts.length ? Math.min(...texts.map((t) => t.w)) : null, scale: Math.round(scale * 100) / 100, pitchH: Math.round(pitch?.height ?? 0), overlaps, pairs: pairs.slice(0, 4), vh: window.innerHeight };
  });
}

for (const [width, height] of SIZES) {
  // Squares of at least 0.9 × 34 px on ordinary Mac windows; small windows (below 1200 × 780) keep at least 0.75.
  const minScale = width >= 1200 && height >= 780 ? 0.9 : 0.75;
  const { browser, page, errors } = await open({ home: true, width, height, dpr: 1 });
  await page.evaluate(() => {
    const app = window.bloodboard;
    app.st.pauseDice = true;
  });
  await startReadyMatch(page, { format: 'sevens', p1: 'lizardmen', p2: 'highElf' });
  await page.evaluate(() => { window.bloodboard.st.pauseDice = true; window.bloodboard.emit(); });
  // Pre-game: roll, answer the kick/receive question with "kick" so that you set up first right after the rolls.
  let setupShot = false;
  let playShot = false;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline && !(setupShot && playShot)) {
    const s = await page.evaluate(() => {
      const g = window.bloodboard.game;
      return { phase: g.phase, pending: g.pending ? { team: g.pending.request.team, type: g.pending.request.type, options: g.pending.request.options.map((o) => o.id) } : null, pp: g.match?.pendingPhase?.type ?? null, playback: window.bloodboard.playbackActive(), waiting: window.bloodboardComputer.waitingFor(), active: g.turn.active, sel: window.bloodboard.st.selected };
    });
    if (s.phase === 'pregame' && !s.pending && !s.playback) {
      await page.click('#pregame-btn');
      await page.waitForTimeout(150);
      continue;
    }
    if (s.pending && s.pending.team === 'A' && !s.playback) {
      const id = s.pending.options.includes('kick') ? 'kick' : s.pending.options[0];
      await page.evaluate((opt) => { const app = window.bloodboard; app.decide(app.game.pending.request, opt); }, id);
      await page.waitForTimeout(120);
      continue;
    }
    if (s.phase === 'driveSetup' && s.waiting === 'A' && !setupShot) {
      await drainTray(page);
      await page.waitForTimeout(200);
      const m = await measure(page);
      await page.screenshot({ path: `build/shots/tray-${tag}-setup-${width}x${height}.png` });
      check(`${width}×${height} set-up: tray text keeps a readable width (≥ 160 px)`, m.minTextW === null || m.minTextW >= 160, JSON.stringify({ minTextW: m.minTextW, texts: m.texts.map((t) => `${t.w}×${t.h}`) }));
      check(`${width}×${height} set-up: tray height ≤ 24% of the window, pitch scale ≥ ${minScale}`, m.trayH <= 0.24 * m.vh && m.scale >= minScale, JSON.stringify({ trayH: m.trayH, vh: m.vh, scale: m.scale, pitchH: m.pitchH }));
      check(`${width}×${height} set-up: no overlapping text / dice / buttons in the tray`, m.overlaps === 0, m.pairs.join(' | '));
      // More ▾ shows every roll and event of the action; Less ▴ goes back to the short version.
      if (await page.locator('#tray-more').count()) {
        await page.click('#tray-more');
        await page.waitForTimeout(150);
        const x = await page.evaluate(() => ({ items: document.querySelectorAll('#tray-all li').length, h: Math.round(document.querySelector('.tray').getBoundingClientRect().height), btn: document.querySelector('#tray-more')?.textContent }));
        await page.screenshot({ path: `build/shots/tray-${tag}-setup-more-${width}x${height}.png` });
        await page.click('#tray-more');
        await page.waitForTimeout(150);
        const y = await page.evaluate(() => ({ items: document.querySelectorAll('#tray-all li').length, btn: document.querySelector('#tray-more')?.textContent }));
        check(`${width}×${height} set-up: More ▾ lists every event of the action in full (scrollable, ≤ 45% of the window); Less ▴ goes back`, x.items >= 4 && x.h <= 0.45 * height + 40 && /Less/.test(x.btn) && y.items === 0 && /More/.test(y.btn), JSON.stringify({ x, y }));
      } else check(`${width}×${height} set-up: More ▾ offered for the long roll-off texts`, false);
      setupShot = true;
      await page.evaluate(() => { const app = window.bloodboard; app.st.pauseDice = false; });
      await page.getByRole('complementary').getByRole('button', { name: 'Default formation' }).click();
      await page.click('#confirm-setup');
      await page.waitForTimeout(150);
      await page.evaluate(() => { window.bloodboard.st.pauseDice = true; });
      continue;
    }
    if (s.playback) { await drainTray(page); continue; }
    if (s.phase === 'driveSetup' && s.waiting === 'A') {
      await page.getByRole('complementary').getByRole('button', { name: 'Default formation' }).click();
      await page.click('#confirm-setup');
      await page.waitForTimeout(150);
      continue;
    }
    if (s.phase === 'kickoff' && s.waiting === 'A' && !s.pp) {
      await page.evaluate(() => {
        const app = window.bloodboard;
        const g = app.game;
        const E = window.BloodboardEngine;
        const k = E.kickerCandidates(g, 'A')[0];
        app.runSimple({ kind: 'kickoff', kicker: k.id, target: { x: 16, y: 5 } });
      });
      await page.waitForTimeout(200);
      continue;
    }
    if (s.phase === 'kickoff' && s.waiting === 'A' && s.pp) {
      if (await page.locator('#confirm-event').count()) await page.click('#confirm-event');
      else if (await page.locator('#confirm-swarming').count()) await page.click('#confirm-swarming');
      await page.waitForTimeout(150);
      continue;
    }
    if (s.phase === 'play' && s.active === 'A' && s.waiting === 'A' && !s.pending) {
      // A Rush with a standing player who has open squares ahead: the tray then shows the roll and the moves after it.
      const ok = await page.evaluate(() => {
        const app = window.bloodboard;
        const g = app.game;
        const E = window.BloodboardEngine;
        const mine = g.players.filter((p) => p.team === 'A' && p.location === 'pitch' && p.stance === 'standing' && !p.activated);
        for (const p of mine) {
          if (E.markersOf ? E.markersOf(g, p).length : false) continue;
          for (const dy of [0, 1, -1]) {
            const path = [];
            let c = { ...p.pos };
            let okp = true;
            for (let i = 0; i < p.ma + 1; i++) {
              c = { x: c.x + 1, y: Math.max(0, Math.min(10, c.y + (i === 0 ? dy : 0))) };
              if (c.x > 18 || E.playerAt(g, c) || g.players.some((q) => q.team === 'B' && q.location === 'pitch' && q.pos && Math.abs(q.pos.x - c.x) <= 1 && Math.abs(q.pos.y - c.y) <= 1)) { okp = false; break; }
              path.push({ to: { ...c }, kind: 'step' });
            }
            if (!okp) continue;
            app.select(p.id);
            app.runSimple({ kind: 'playerAction', playerId: p.id, action: 'move', path });
            return p.id;
          }
        }
        return null;
      });
      if (!ok) {
        await page.evaluate(() => window.bloodboard.runSimple({ kind: 'endTurn' }));
        await page.waitForTimeout(150);
        continue;
      }
      await page.waitForTimeout(250);
      // Reveal all rolls, then select another player: the tray shows the last roll, the moves after it and his Actions.
      await drainTray(page);
      if (await page.evaluate(() => !!window.bloodboard.game.pending)) continue;
      await page.evaluate((moved) => {
        const app = window.bloodboard;
        const g = app.game;
        const other = g.players.find((p) => p.team === 'A' && p.location === 'pitch' && p.id !== moved && !p.activated);
        if (other) app.select(other.id);
      }, ok);
      await page.waitForTimeout(300);
      if (await page.evaluate(() => window.bloodboard.playbackActive())) await drainTray(page);
      const m = await measure(page);
      await page.screenshot({ path: `build/shots/tray-${tag}-play-${width}x${height}.png` });
      check(`${width}×${height} active Turn: tray text keeps a readable width (≥ 160 px)`, m.minTextW === null || m.minTextW >= 160, JSON.stringify({ minTextW: m.minTextW, texts: m.texts.map((t) => `${t.w}×${t.h}`) }));
      check(`${width}×${height} active Turn: tray height ≤ 24% of the window, pitch scale ≥ ${minScale}`, m.trayH <= 0.24 * m.vh && m.scale >= minScale, JSON.stringify({ trayH: m.trayH, vh: m.vh, scale: m.scale, pitchH: m.pitchH }));
      check(`${width}×${height} active Turn: no overlapping text / dice / buttons in the tray`, m.overlaps === 0, m.pairs.join(' | '));
      playShot = true;
      continue;
    }
    await page.waitForTimeout(150);
  }
  check(`${width}×${height}: both situations reached`, setupShot && playShot);
  check(`${width}×${height}: no console errors`, errors.length === 0, errors.slice(0, 2).join(' | '));
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} tray layout checks passed`);
process.exit(failed.length ? 1 : 0);
