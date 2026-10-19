// V7-03 reproduction probe: after a few real actions, scan the live page at several window sizes for clipped / overflowing text in the dice tray, log,
// side panels and top bar. Prints every offender so a fix can be targeted; exit 1 if any remain.
import { open } from './ui-helpers.mjs';
const widths = [[1000, 700], [1180, 760], [1470, 920]];
let bad = 0;
for (const [w, hgt] of widths) {
  const { browser, page, errors } = await open({ home: true, width: w, height: hgt });
  await page.click('#exhibition-setup'); await page.waitForTimeout(300);
  await page.click('#p1-controller-computer'); await page.click('#p2-controller-computer'); await page.waitForTimeout(100);
  await page.click('#p1-source-ready'); await page.click('#p2-source-ready'); await page.selectOption('#p1-ai', 'bloodboard-offensive'); await page.selectOption('#p2-ai', 'bloodboard-defensive');
  await page.click('#start-match'); await page.waitForTimeout(600);
  await page.evaluate(() => { const a = window.bloodboard; a.st.computer.speed = 'normal'; a.st.pauseDice = false; a.st.logOpen = true; a.emit(); });
  await page.waitForTimeout(25000);
  const off = await page.evaluate(() => {
    const out = [];
    const sel = '.traygroup, .traytext, .traydice, .trayhead, .evtxt, .logentry, .log, .side .card, .topbar button, .sb-team, .scoreboard *';
    for (const el of document.querySelectorAll(sel)) {
      const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
      const clippedX = el.scrollWidth > el.clientWidth + 1 && /hidden|clip/.test(cs.overflowX) && el.clientWidth > 0;
      const outside = r.right > window.innerWidth + 1;
      if (clippedX || outside) out.push(`${el.className || el.tagName}: ${clippedX ? `clipped ${el.scrollWidth}>${el.clientWidth}` : `right edge ${Math.round(r.right)}>${window.innerWidth}`} "${(el.textContent || '').trim().slice(0, 40)}"`);
    }
    // a team name itself (its own text) must not be split over two lines
    for (const el of document.querySelectorAll('.sb-name')) {
      const tn = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
      if (!tn) continue; const rg = document.createRange(); rg.selectNodeContents(tn);
      const tops = new Set([...rg.getClientRects()].filter((r) => r.width > 2).map((r) => Math.round(r.top / 4)));
      if (tops.size > 1) out.push(`team name "${tn.textContent.trim()}" wraps onto ${tops.size} lines`);
    }
    const doc = document.documentElement; if (doc.scrollWidth > doc.clientWidth + 1) out.push(`page scrolls horizontally ${doc.scrollWidth}>${doc.clientWidth}`);
    return [...new Set(out)];
  });
  console.log(`${off.length ? 'FAIL' : 'PASS'} layout at ${w}x${hgt}${off.length ? `:\n  ${off.slice(0, 12).join('\n  ')}` : ''}`);
  if (off.length) bad++;
  await page.screenshot({ path: `/tmp/layout-${w}.png` });
  await browser.close();
}
process.exit(bad ? 1 : 0);
