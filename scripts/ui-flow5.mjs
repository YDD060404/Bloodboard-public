// UI flow 5: examples, save / open / delete (browser storage), setup mode
// edits, End Turn modal, export and import. Prints PASS/FAIL lines.
import { readFileSync, mkdirSync } from 'node:fs';
/** V3: New / Open / Save / Save As / Export / Import live in the File menu. */
async function fileMenu(page, name) {
  await page.click('#file-menu-btn');
  await page.getByRole('menuitem', { name, exact: true }).click();
}
import { open, clickSq, gameJSON } from './ui-helpers.mjs';

mkdirSync('build/shots', { recursive: true });
const { browser, page, errors } = await open();
let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};
const game = async () => JSON.parse(await gameJSON(page));
const st = (k) => page.evaluate((key) => window.bloodboard.st[key], k);

// 1) load an example from the Examples dialog
await page.getByRole('button', { name: 'Scenarios' }).click();
await page.locator('.libitem', { hasText: 'Short pass into the End Zone' }).getByRole('button', { name: 'Load' }).click();
await page.waitForTimeout(150);
check('example loaded', (await st('docName')) === 'Short pass into the End Zone');
const g0 = await game();
check('example is in play with Team A to act', g0.phase === 'play' && g0.turn.active === 'A');

// 2) Save As
await fileMenu(page, 'Save As…');
await page.locator('.modal input[type=text]').fill('Flow5 position');
await page.locator('.modal textarea').fill('saved by ui-flow5');
await page.locator('.modal').getByRole('button', { name: 'Save' }).click();
await page.waitForTimeout(200);
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('bloodboard.positions.v1') || '{}'));
check('saved to browser storage', !!stored['Flow5 position']);
const savedState = JSON.parse(stored['Flow5 position'].json).state;
check('saved file carries the notes', JSON.parse(stored['Flow5 position'].json).notes === 'saved by ui-flow5');
check('document is clean after saving', (await st('dirty')) === false);

// 3) change the game: forego a player's activation (no dice)
const moverId = g0.players.find((p) => p.team === 'A' && p.location === 'pitch' && !p.activated).id;
await page.evaluate((id) => window.bloodboard.runSimple({ kind: 'forgo', playerId: id }), moverId);
await page.waitForTimeout(100);
check('changing the game marks it dirty', (await st('dirty')) === true);
const changed = await game();
check('forego changed the state', JSON.stringify(changed) !== JSON.stringify(savedState));

// 4) reopen the saved position from the library
await fileMenu(page, 'Open…');
await page.waitForTimeout(150);
const item = page.locator('.libitem', { hasText: 'Flow5 position' });
check('library lists the saved position', (await item.count()) === 1);
await item.getByRole('button', { name: 'Open' }).click();
await page.waitForTimeout(200);
const reopened = await game();
const strip = (s) => JSON.stringify({ ...s, notes: undefined });
check('reopening restores exactly the saved state', strip(reopened) === strip(savedState));

// 5) Setup mode: move a player and change Team Re-rolls, then back to Play
await page.getByRole('button', { name: 'Edit position', exact: true }).click();
await page.waitForTimeout(150);
check('setup mode', (await st('view')) === 'setup');
const someone = reopened.players.find((p) => p.team === 'B' && p.location === 'pitch');
await page.getByRole('button', { name: 'Select / move' }).click();
await clickSq(page, someone.pos.x, someone.pos.y);
// an empty square two rows away that is empty
const occupied = new Set(reopened.players.filter((p) => p.location === 'pitch').map((p) => `${p.pos.x},${p.pos.y}`));
let dest = null;
for (const [dx, dy] of [[0, 2], [0, -2], [2, 0], [-2, 0], [1, 3], [-1, 3]]) {
  const x = someone.pos.x + dx;
  const y = someone.pos.y + dy;
  if (x >= 0 && x < 26 && y >= 0 && y < 15 && !occupied.has(`${x},${y}`) && !(reopened.ball.kind === 'ground' && reopened.ball.pos.x === x && reopened.ball.pos.y === y)) {
    dest = { x, y };
    break;
  }
}
await clickSq(page, dest.x, dest.y);
let gs = await game();
const moved = gs.players.find((p) => p.id === someone.id);
check('setup: player moved by clicking', moved.pos.x === dest.x && moved.pos.y === dest.y, JSON.stringify(moved.pos));
const rrInput = page.locator('.card.teamed').first().locator('label.field', { hasText: 'Team Re-rolls left' }).locator('input');
await rrInput.fill('3');
await rrInput.dispatchEvent('change');
await page.waitForTimeout(100);
gs = await game();
check('setup: Team Re-rolls edited', gs.teams.A.rerolls === 3, String(gs.teams.A.rerolls));
await page.screenshot({ path: 'build/shots/20-setup.png' });
await page.getByRole('button', { name: 'Play', exact: true }).click();
await page.waitForTimeout(150);
gs = await game();
check('back to play keeps the edits', (await st('view')) === 'play' && gs.teams.A.rerolls === 3 && gs.phase === 'play');

// 6) End Turn: immediate (V3: no confirmation dialog)
const turnBefore = gs.teams.B.turn;
await page.getByRole('button', { name: /^End .* Turn \d/ }).click();
await page.waitForTimeout(150);
check('End Turn asks no confirmation', (await st('modal')) === null);
gs = await game();
check('End Turn passes the turn to Team B', gs.turn.active === 'B' && gs.teams.B.turn === turnBefore + 1, `${gs.turn.active} ${gs.teams.B.turn}`);
check('End Turn is logged', gs.log.length > 0 && /End Turn/.test(gs.log[gs.log.length - 1].title));

// 7) Export (download) and Import (file chooser) round trip
const [download] = await Promise.all([page.waitForEvent('download'), fileMenu(page, 'Export…')]);
const exportPath = 'build/shots/exported-position.json';
await download.saveAs(exportPath);
const exported = JSON.parse(readFileSync(exportPath, 'utf8'));
check('export writes a bloodboard-position file', exported.format === 'bloodboard-position' && (exported.version === 1 || exported.version === 2));
check('export contains the current state', JSON.stringify(exported.state) === JSON.stringify(gs));
await fileMenu(page, 'New');
await page.waitForTimeout(150);
check('New gives a blank setup', (await st('view')) === 'setup' && (await game()).players.length === 0);
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), fileMenu(page, 'Import…')]);
await chooser.setFiles(exportPath);
await page.waitForTimeout(300);
check('import restores the exported state', JSON.stringify(await game()) === JSON.stringify(gs));

// 8) Delete from the library needs a second click
await fileMenu(page, 'Open…');
await page.waitForTimeout(150);
const del = page.locator('.libitem', { hasText: 'Flow5 position' }).getByRole('button', { name: /Delete|Click again/ });
await del.click();
await page.waitForTimeout(100);
let still = await page.evaluate(() => !!JSON.parse(localStorage.getItem('bloodboard.positions.v1') || '{}')['Flow5 position']);
check('first Delete click only asks for confirmation', still === true);
await page.locator('.libitem', { hasText: 'Flow5 position' }).getByRole('button', { name: /Delete|Click again/ }).click();
await page.waitForTimeout(200);
still = await page.evaluate(() => !!JSON.parse(localStorage.getItem('bloodboard.positions.v1') || '{}')['Flow5 position']);
check('second click deletes', still === false);

check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
