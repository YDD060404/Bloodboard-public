// V5.5 interface flow — League pre-match Inducements and Star Players (p.94; request item 3):
//  A. the League set-up shows both teams' Current Team Value, Petty Cash and usable Treasury;
//  B. the lower-CTV team hires a Star Player for this match and buys an Inducement; the money left is shown;
//  C. the match starts with the Star Player (temporary) on that team and the Inducement; the saved team never gets the
//     Star Player; the Treasury gold spent beyond the Petty Cash is taken off the saved team.
// Run after `node scripts/build.mjs`:  node scripts/ui-flow-v55-league-prematch.mjs
import { open } from './ui-helpers.mjs';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const { browser, page, errors } = await open({ home: true, width: 1470, height: 920 });
const st = (fn, arg) => page.evaluate(fn, arg);
const sleep = (ms) => page.waitForTimeout(ms);
const t0 = Date.now();

// Two League teams: a rich Human team (higher CTV) and a poorer Human team with 80,000 gp in its Treasury.
await st(async () => {
  const E = window.BloodboardEngine;
  const app = window.bloodboard;
  const mk = (id, name, comp, treasury) => {
    const t = E.newTeamDef('league', 'human', name, id);
    let n = 1;
    for (const [pos, k] of comp) for (let i = 0; i < k; i++) t.players.push(E.playerFromRoster(E.ROSTER_BY_ID.human, pos, n, `${id}-${n++}`));
    t.rerolls = 2;
    t.treasury = treasury;
    return t;
  };
  const rich = mk('lg-rich', 'Rich Humans', [['blitzer', 4], ['catcher', 2], ['thrower', 2], ['lineman', 4]], 0);
  const poor = mk('lg-poor', 'Poor Humans', [['lineman', 11]], 80000);
  await app.teamStore.save(rich.id, JSON.stringify(rich, null, 1));
  await app.teamStore.save(poor.id, JSON.stringify(poor, null, 1));
});
await page.reload();
await sleep(500);
const saved = (id) => st(async (id) => JSON.parse(await window.bloodboard.teamStore.load(id)), id);

await page.click('#league-setup');
await sleep(300);
await page.click('#p1-controller-human');
await page.click('#p2-controller-human');
await sleep(100);
await page.selectOption('#p1-team', 'lg-rich');
await sleep(150);
await page.selectOption('#p2-team', 'lg-poor');
await sleep(250);
const ctv = await st(() => document.querySelector('#league-ctv')?.textContent ?? '');
const boxB = () => st(() => document.querySelector('#league-buy-B')?.textContent ?? '');
check('A: the pre-match panel shows both Current Team Values and who has the higher CTV', /Current Team Value: Rich Humans [\d,]+ gp, Poor Humans [\d,]+ gp/.test(ctv) && /Rich Humans has the higher CTV/.test(ctv), ctv.slice(0, 160));
const b0 = await boxB();
const petty = Number((b0.match(/Petty Cash ([\d,]+) gp/) ?? [])[1]?.replace(/,/g, '') ?? 0);
check('A: the lower team gets Petty Cash (the difference) and may add up to 50,000 gp of Treasury', petty > 0 && /Treasury usable 50,000 gp \(Treasury 80,000 gp\)/.test(b0), b0.slice(0, 160));

// B. hire the most expensive affordable Star Player (not a pair) and one Bribe.
const pick = await st(() => {
  const opts = [...document.querySelectorAll('#league-star-B option')].filter((o) => o.value && !o.disabled && !/pair with/.test(o.textContent));
  const cost = (o) => Number((o.textContent.match(/— (\d+)k/) ?? [])[1] ?? 0);
  opts.sort((a, b) => cost(b) - cost(a));
  return opts[0] ? { id: opts[0].value, cost: cost(opts[0]) * 1000, text: opts[0].textContent } : null;
});
check('B: Star Players who play for the team and fit the money are offered', !!pick, JSON.stringify(pick));
await page.selectOption('#league-star-B', pick.id);
await sleep(200);
const bribeBtn = page.locator('#league-buy-B [data-league-ind="bribe"] button', { hasText: '+' });
const canBribe = (await bribeBtn.count()) === 1 && !(await bribeBtn.isDisabled());
if (canBribe) {
  await bribeBtn.click();
  await sleep(200);
}
const b1 = await boxB();
const spent = Number((b1.match(/Spent ([\d,]+) gp/) ?? [])[1]?.replace(/,/g, '') ?? 0);
check('B: the spending is shown (Star Player + Inducement)', spent === pick.cost + (canBribe ? 100000 : 0), `${spent} = ${pick.cost}${canBribe ? ' + 100000' : ''}`);
await page.click('#start-match');
await sleep(400);
const m = await st((sid) => {
  const g = window.bloodboard.game;
  const star = g.players.find((p) => p.team === 'B' && p.star === sid);
  return { screen: window.bloodboard.st.screen, star: !!star, pre: g.match?.preMatch?.B ?? null, ind: g.match?.inducements?.B ?? null, bribes: g.match?.bribes?.B ?? 0 };
}, pick.id);
check('C: the match starts with the hired Star Player on the poorer team', m.screen === 'board' && m.star, JSON.stringify(m));
check('C: the pre-match record (Petty Cash) and the Inducement are in the match', m.pre && m.pre.pettyCash === petty && (!canBribe || m.bribes === 1), JSON.stringify(m.pre));
await sleep(400);
const poorAfter = await saved('lg-poor');
const expect = Math.max(0, spent - petty);
check('C: the saved team never gets the Star Player', !poorAfter.players.some((p) => p.star));
check('C: the Treasury gold spent beyond the Petty Cash is taken off the saved team', poorAfter.treasury === 80000 - expect, `${poorAfter.treasury} (spent ${spent}, Petty Cash ${petty})`);
const richAfter = await saved('lg-rich');
check('C: the other team\'s Treasury is unchanged', richAfter.treasury === 0);

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} League pre-match checks passed (${Math.round((Date.now() - t0) / 1000)} s); page errors: ${errors.length}`);
if (errors.length) console.log(errors.join('\n'));
await browser.close();
process.exit(results.every((r) => r.ok) && !errors.length ? 0 : 1);
