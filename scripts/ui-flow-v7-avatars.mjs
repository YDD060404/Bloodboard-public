// V7-04 — coach avatars in the real UI (Chromium): a watched computer-v-computer match. Moods must follow the real runtime state
// (thinking only while the coach is computing, reactions after real events), customization persists, avatars/bubbles can be switched off.
//   node scripts/build.mjs && PLAYWRIGHT_MODULE=… node scripts/ui-flow-v7-avatars.mjs
import { open } from './ui-helpers.mjs';
const results = [];
const check = (n, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ` — ${d}` : ''}`); };
const { browser, page, errors } = await open({ home: true });
const sleep = (ms) => page.waitForTimeout(ms);
await page.click('#exhibition-setup'); await sleep(300);
await page.click('#setup-format-sevens').catch(() => {}); await sleep(100);
await page.click('#p1-controller-computer'); await page.click('#p2-controller-computer'); await sleep(100);
await page.click('#p1-source-ready'); await page.click('#p2-source-ready'); await sleep(100);
await page.selectOption('#p1-ai', 'bloodboard-offensive'); await page.selectOption('#p2-ai', 'bloodboard-defensive'); await sleep(100);
await page.click('#start-match'); await sleep(500);
await page.evaluate(() => { const a = window.bloodboard; a.st.computer.speed = 'normal'; a.st.pauseDice = false; a.emit(); });
const cardAvatars = await page.evaluate(() => [...document.querySelectorAll('#computer-card .avatar')].map((e) => ({ team: e.dataset.team, ai: e.dataset.ai, svg: !!e.querySelector('svg rect') })));
check('each computer coach has its own avatar on the Computer card', cardAvatars.length === 2 && cardAvatars.every((a) => a.svg) && cardAvatars[0].ai !== cardAvatars[1].ai, JSON.stringify(cardAvatars));

// poll the real state against the drawn mood for a while
const seen = { thinking: 0, acting: 0, idle: 0, reaction: 0, violations: [] };
const t0 = Date.now(); let sawBubble = null;
while (Date.now() - t0 < 60000) {
  const s = await page.evaluate(() => {
    const a = window.bloodboard, w = window.bloodboardComputer.waitingFor();
    return { thinking: a.st.computer.thinking, w, playback: a.playbackActive(), faces: [...document.querySelectorAll('#computer-card .avatar')].map((e) => ({ team: e.dataset.team, mood: e.dataset.mood })), bubble: [...document.querySelectorAll('.avatar-bubble')].map((e) => ({ team: e.dataset.team, text: e.textContent })) };
  });
  for (const f of s.faces) {
    if (f.mood === 'thinking') { seen.thinking++; if (!(s.thinking && s.w === f.team)) seen.violations.push(`thinking drawn for ${f.team} while thinking=${s.thinking} waitingFor=${s.w}`); }
    else if (f.mood === 'acting') { seen.acting++; if (!(s.playback && s.w === f.team)) seen.violations.push(`acting drawn for ${f.team}`); }
    else if (f.mood === 'idle') seen.idle++;
    else seen.reaction++;
  }
  if (s.bubble.length && !sawBubble) sawBubble = s.bubble[0];
  if (seen.thinking > 3 && seen.reaction > 0 && sawBubble && Date.now() - t0 > 20000) break;
  await sleep(120);
}
check('a coach shows "thinking" only while it is really computing on its own turn', seen.thinking > 0 && !seen.violations.some((v) => v.startsWith('thinking')), `thinking frames ${seen.thinking}; ${seen.violations.slice(0, 2).join(' | ')}`);
check('"acting" is drawn only while that coach\'s dice are being shown', !seen.violations.some((v) => v.startsWith('acting')), `acting frames ${seen.acting}`);
check('the faces react to real events (cheer / dismay / hurt) and a short bubble appears', seen.reaction > 0 && !!sawBubble, JSON.stringify({ reaction: seen.reaction, bubble: sawBubble }));

// customization window
await page.click('#avatars-open'); await sleep(250);
const before = await page.evaluate(() => document.querySelector('.avatar-edit .avatar-preview svg').outerHTML);
const ai = await page.evaluate(() => document.querySelector('.avatar-edit').dataset.ai);
await page.selectOption(`select[data-ai="${ai}"][data-key="headgear"]`, 'crown'); await sleep(200);
await page.selectOption(`select[data-ai="${ai}"][data-key="skin"]`, '5'); await sleep(200);
const after = await page.evaluate(() => document.querySelector('.avatar-edit .avatar-preview svg').outerHTML);
check('changing headgear/skin redraws the preview', before !== after);
await page.fill(`input[data-ai="${ai}"][data-key="label"]`, '<b>Ref</b>'); await page.dispatchEvent(`input[data-ai="${ai}"][data-key="label"]`, 'change'); await sleep(200);
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('bloodboard.avatars.v1') || '{}'));
const spec = Object.values(saved.specs ?? {}).find(Boolean);
check('the look is saved per AI file (headgear, skin, sanitized name tag)', spec?.headgear === 'crown' && spec.skin === 5 && !/[<>]/.test(spec.label), JSON.stringify(spec));
check('markup in the name tag never reaches the page', await page.evaluate(() => !document.body.innerHTML.includes('<b>Ref') && !document.querySelector('.avatar-edit input[data-key="label"]').value.includes('<')));
// switches (in the running match)
await page.uncheck('#avatars-bubbles'); await sleep(200);
await page.click('.modal-back .btn.ghost.small >> text=Close'); await sleep(300);
const noBubble = await page.evaluate(() => ({ avatars: document.querySelectorAll('#computer-card .avatar').length, bubbles: document.querySelectorAll('.avatar-bubble').length }));
check('with bubbles switched off the faces stay and no bubble is drawn', noBubble.avatars === 2 && noBubble.bubbles === 0, JSON.stringify(noBubble));
await page.click('#avatars-open'); await sleep(200); await page.uncheck('#avatars-enabled'); await sleep(200);
await page.click('.modal-back .btn.ghost.small >> text=Close'); await sleep(300);
check('with avatars switched off no avatar is drawn and the Computer card is still there', await page.evaluate(() => document.querySelectorAll('.avatar').length === 0 && !!document.querySelector('#computer-card')));
// persists across a reload
await page.reload(); await sleep(500);
const reloaded = await page.evaluate(() => JSON.parse(localStorage.getItem('bloodboard.avatars.v1') || '{}'));
check('the saved look and the switches survive a reload', Object.values(reloaded.specs ?? {}).some((x) => x.headgear === 'crown') && reloaded.enabled === false && reloaded.bubbles === false);
const real = errors.filter((e) => !/Failed to load resource/.test(e));
check('no unexpected browser errors', real.length === 0, real.slice(0, 3).join(' | ').slice(0, 300));
await browser.close();
const ok = results.filter(Boolean).length; console.log(`\n${ok}/${results.length} passed`); process.exit(ok === results.length ? 0 : 1);
