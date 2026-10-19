import { open, clickSq, waitPlan } from './ui-helpers.mjs';
const { browser, page, errors } = await open();
// load example 2 (blitz)
await page.getByRole('button', { name: 'Scenarios' }).click();
await page.locator('.libitem', { hasText: 'Blitz the ball carrier' }).getByRole('button', { name: 'Load' }).click();
await page.waitForTimeout(200);
// TK blitzer #6 at (12,7)
await clickSq(page, 12, 7);
await page.getByRole('button', { name: 'Blitz', exact: true }).click();
await clickSq(page, 8, 7);    // target knight catcher
await clickSq(page, 11, 7);
await clickSq(page, 10, 7);
await clickSq(page, 9, 7);
await waitPlan(page);
await page.getByRole('button', { name: /Review probabilities/ }).click();
await page.waitForTimeout(100);
await page.screenshot({ path: 'build/shots/08-blitz-review.png' });
await page.evaluate(() => { document.querySelector('.side').scrollTop = 700; });
await page.screenshot({ path: 'build/shots/09-blitz-review-2.png' });
await page.getByRole('button', { name: 'Confirm & roll dice' }).click();
await page.waitForTimeout(200);
await page.screenshot({ path: 'build/shots/10-blitz-decision.png' });
const st = await page.evaluate(() => ({ pending: window.bloodboard.game.pending?.request, log: window.bloodboard.game.log.length }));
console.log(JSON.stringify(st, null, 1).slice(0, 1500));
console.log(JSON.stringify(errors));
await browser.close();
