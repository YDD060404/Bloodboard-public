import { open, clickSq, waitPlan } from './ui-helpers.mjs';
const { browser, page, errors } = await open();
await page.getByRole('button', { name: 'Scenarios' }).click();
await page.locator('.libitem', { hasText: 'Short pass into the End Zone' }).getByRole('button', { name: 'Load' }).click();
await page.waitForTimeout(200);
await clickSq(page, 20, 7); // thrower
await page.getByRole('button', { name: 'Pass', exact: true }).click();
await clickSq(page, 25, 5); // catcher in EZ
await waitPlan(page);
await page.screenshot({ path: 'build/shots/11-pass-plan.png' });
await page.getByRole('button', { name: /Review probabilities/ }).click();
await page.waitForTimeout(100);
await page.evaluate(() => { document.querySelector('.side').scrollTop = 500; });
await page.screenshot({ path: 'build/shots/12-pass-review.png' });
await page.getByRole('button', { name: 'Confirm & roll dice' }).click();
await page.waitForTimeout(200);
let guard = 0;
while (guard++ < 10) {
  const req = await page.evaluate(() => window.bloodboard.game.pending?.request);
  if (!req) break;
  console.log('decision:', req.type, req.prompt, req.options.map(o => o.id).join('|'));
  await page.screenshot({ path: `build/shots/13-pass-decision-${guard}.png` });
  await page.locator('.options button').first().click();
  await page.waitForTimeout(200);
}
await page.screenshot({ path: 'build/shots/14-pass-result.png' });
const lg = await page.evaluate(() => window.bloodboard.game.log.map(e => e.events.map(x => x.text).join('\n')).join('\n---\n'));
console.log(lg);
console.log(JSON.stringify(errors));
await browser.close();
