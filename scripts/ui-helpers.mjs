// Playwright is a developer-only dependency (npm install --save-dev playwright).
// PLAYWRIGHT_MODULE can point at another installation.
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = pw.default ?? pw;
export const SQ = 34, MARGIN = 22, W = 26, H = 15;
export async function open(opts = {}) {
  const url = 'file://' + process.cwd() + '/dist/web/index.html';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: opts.width ?? 1470, height: opts.height ?? 920 }, deviceScaleFactor: opts.dpr ?? 1 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(url);
  await page.waitForTimeout(300);
  // v1 flows start on the practice board with dice shown at once; v2 flows pass { home: true }.
  if (!opts.home) {
    // V5: the Home screen has no Practice card any more; the practice board is opened directly.
    await page.evaluate(() => window.bloodboardOpenPractice(0));
    await page.evaluate(() => { window.bloodboard.st.pauseDice = false; window.bloodboard.emit(); });
    await page.waitForTimeout(150);
  }
  return { browser, page, errors };
}
export async function sqPoint(page, x, y) {
  // The board is re-rendered often; retry if it was replaced between the two reads.
  let box = null;
  let vbAttr = null;
  for (let i = 0; i < 20 && (!box || !vbAttr); i++) {
    box = await page.locator('.pitchhost svg').boundingBox().catch(() => null);
    vbAttr = await page.locator('.pitchhost svg').getAttribute('viewBox').catch(() => null);
    if (!box || !vbAttr) await page.waitForTimeout(50);
  }
  const vb = vbAttr.split(/\s+/).map(Number);
  const [vx, vy, vbW, vbH] = vb;
  const scale = Math.min(box.width / vbW, box.height / vbH);
  const offX = box.x + (box.width - vbW * scale) / 2;
  const offY = box.y + (box.height - vbH * scale) / 2;
  return { x: offX + (MARGIN + x * SQ + SQ / 2 - vx) * scale, y: offY + (MARGIN + y * SQ + SQ / 2 - vy) * scale };
}
/** Open a practice scenario (V5: no Practice card on the Home screen any more — opened directly). */
export async function toPractice(page, index = 0) {
  await page.evaluate((i) => window.bloodboardOpenPractice(i), index);
  await page.waitForTimeout(200);
}
/** Press Continue in the dice tray until the playback is finished. */
export async function drainTray(page) {
  for (let i = 0; i < 60; i++) {
    const active = await page.evaluate(() => window.bloodboard.playbackActive());
    if (!active) return;
    // While the computer thinks in the background the tray is redrawn often; on a busy machine the button can be
    // replaced before Playwright sees it stable. Try a real click briefly, then press the current button directly.
    const ok = await page.click('#tray-continue', { timeout: 2000 }).then(() => true, () => false);
    if (!ok) await page.evaluate(() => document.querySelector('#tray-continue')?.click());
    await page.waitForTimeout(60);
  }
}
export async function clickSq(page, x, y) {
  const p = await sqPoint(page, x, y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(120);
}
export async function waitPlan(page) {
  for (let i = 0; i < 100; i++) {
    const busy = await page.evaluate(() => window.bloodboard?.st.planBusy);
    if (!busy) return;
    await page.waitForTimeout(50);
  }
}
export async function gameJSON(page) {
  return page.evaluate(() => JSON.stringify(window.bloodboard.game));
}
/**
 * V5.5: start a hot-seat match from the match set-up screen with two saved teams, chosen by (part of) their names.
 * `mode` = 'exhibition' | 'tournament' | 'league'; `format` = 'standard' | 'sevens'.
 */
export async function startSavedMatch(page, { mode = 'exhibition', format = 'standard', p1, p2, p1Controller = 'human', p2Controller = 'human' }) {
  await page.click('.brand');
  await page.waitForTimeout(200);
  await page.click(`#${mode}-setup`);
  await page.waitForTimeout(300);
  if (mode !== 'league') {
    await page.click(`#setup-format-${format}`);
    await page.waitForTimeout(150);
  }
  await page.click(`#p1-controller-${p1Controller}`);
  await page.click(`#p2-controller-${p2Controller}`);
  await page.waitForTimeout(100);
  for (const [key, name] of [['p1', p1], ['p2', p2]]) {
    if (mode !== 'league') {
      await page.click(`#${key}-source-saved`);
      await page.waitForTimeout(150);
    }
    const id = await page.evaluate(({ key, name }) => [...document.querySelectorAll(`#${key}-team option`)].find((o) => o.textContent.includes(name))?.value, { key, name });
    if (!id) throw new Error(`no saved team "${name}" for ${key}`);
    await page.selectOption(`#${key}-team`, id);
    await page.waitForTimeout(150);
  }
  await page.click('#start-match');
  await page.waitForTimeout(300);
}
/** V5.5: start a match from the match set-up screen with ready-made teams of the given rosters. */
export async function startReadyMatch(page, { mode = 'exhibition', format = 'standard', p1 = 'human', p2 = 'orc', p1Controller = 'human', p2Controller = 'computer', ai = 'bloodboard-balanced' }) {
  await page.click('.brand');
  await page.waitForTimeout(200);
  await page.click(`#${mode}-setup`);
  await page.waitForTimeout(300);
  await page.click(`#setup-format-${format}`);
  await page.waitForTimeout(120);
  await page.click(`#p1-controller-${p1Controller}`);
  await page.click(`#p2-controller-${p2Controller}`);
  await page.waitForTimeout(80);
  await page.click('#p1-source-ready');
  await page.click('#p2-source-ready');
  await page.waitForTimeout(120);
  await page.selectOption('#p1-roster', p1);
  await page.selectOption('#p2-roster', p2);
  await page.waitForTimeout(120);
  for (const [k, c] of [['p1', p1Controller], ['p2', p2Controller]]) if (c === 'computer' && (await page.locator(`#${k}-ai`).count())) await page.selectOption(`#${k}-ai`, ai);
  await page.waitForTimeout(80);
  await page.click('#start-match');
  await page.waitForTimeout(300);
}
