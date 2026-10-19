import { open, clickSq, waitPlan, gameJSON } from './ui-helpers.mjs';
const { browser, page, errors } = await open();
// select catcher #7 at (17,7)
await clickSq(page, 17, 7);
await page.screenshot({ path: 'build/shots/02-selected.png' });
await page.getByRole('button', { name: 'Move', exact: true }).click();
await page.waitForTimeout(100);
const before = await gameJSON(page);
// path: (18,7) dodge away from orc at (16,6)? (16,6) adjacent to (17,7) yes -> dodge
await clickSq(page, 18, 7);
await clickSq(page, 19, 7);
await clickSq(page, 20, 7);
await clickSq(page, 21, 7);
await clickSq(page, 22, 7);
await clickSq(page, 23, 7);
await clickSq(page, 24, 7);
await clickSq(page, 25, 7);
await waitPlan(page);
await page.screenshot({ path: 'build/shots/03-plan.png' });
await page.getByRole('button', { name: /Review probabilities/ }).click();
await page.waitForTimeout(150);
await page.screenshot({ path: 'build/shots/04-review.png', fullPage: false });
// cancel -> state unchanged
await page.getByRole('button', { name: 'Cancel plan' }).click();
await page.waitForTimeout(100);
const after = await gameJSON(page);
console.log('cancel leaves state identical:', before === after);
console.log(JSON.stringify(errors));
await browser.close();
