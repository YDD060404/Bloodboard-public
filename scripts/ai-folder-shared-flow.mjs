// V7.0.2 — the game and the Match Lab resolve ONE AI folder and load identical coaches (docs/AI_FOLDER.md).
//
// EVIDENCE CLASS: simulated Mac layout (a temporary HOME with Library/Application Support) + browser with a stand-in for the Swift bridge.
// The stand-in implements listFiles/loadFile on top of online/aidir.mjs; it is NOT the compiled native app. Real Mac verification is
// install_bloodboard.sh + the manual checklist in docs/LOCAL_INSTALL.md.
//
//   LAB_DIR=<match-lab folder> PLAYWRIGHT_MODULE=… node scripts/ai-folder-shared-flow.mjs
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveAIDir, migrateAIFolders } from '../online/aidir.mjs';

const results = [];
const check = (n, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ` — ${d}` : ''}`); };
const sha = (s) => createHash('sha256').update(s).digest('hex');
const SRC = process.env.LAB_DIR; if (!SRC) throw new Error('LAB_DIR is required');
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright'); const { chromium } = pw.default ?? pw;

// ── a fake Mac: HOME/Library/Application Support with the legacy layouts ─────────────────────────────────────────────
const HOME = mkdtempSync(join(tmpdir(), 'bb-home-'));
const AS = join(HOME, 'Library', 'Application Support');
const put = (rel, text) => { const f = join(AS, rel); mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, text); return f; };
const coachJson = (id, name, extra = {}) => JSON.stringify({ format: 'bloodboard-ai', formatVersion: 1, apiVersion: 1, id, name, version: '1.0', description: 'test coach', implementation: 'bloodboard', parameters: {}, ...extra }, null, 1);
const A = coachJson('shared-a', 'Coach A');
const B = coachJson('shared-b', 'Coach B');
const B2 = coachJson('shared-b', 'Coach B edited', { version: '1.1' });          // same file name, different bytes → conflict
const C = coachJson('only-v6', 'Coach only in V6');
const D = coachJson('only-ew', 'Coach only in Endgame Workshop');
put('Bloodboard V6/AI/a.json', A);            put('Bloodboard Endgame Workshop/AI/a.json', A);       // identical → deduped
put('Bloodboard V6/AI/b.json', B);            put('Bloodboard Endgame Workshop/AI/b.json', B2);      // conflict
put('Bloodboard V6/AI/c.json', C);            put('Bloodboard Endgame Workshop/AI/d.json', D);       // unique each
put('Bloodboard V6/AI/models/weights.bin', 'MODELDATA');                                              // companion file
put('Bloodboard Online/credentials.json', '{"secret":"must-stay-here"}');                             // credential state folder
put('Bloodboard V6/AI/api-key.json', '{"apiKey":"sk-fake"}');                                         // credential-like: never copied
const env = { ...process.env, HOME, BLOODBOARD_APPSUPPORT: AS, BLOODBOARD_AI_DIR: '' };
delete env.BLOODBOARD_AI_DIR;

const r = resolveAIDir({ env, home: HOME });
check('the canonical folder is ~/Library/Application Support/Bloodboard/AI', r.dir === join(AS, 'Bloodboard', 'AI') && r.source === 'canonical', r.dir);

// dry-run changes nothing
const dry = migrateAIFolders({ apply: false, env, home: HOME });
check('dry run copies nothing', !existsSync(r.dir) || readdirSync(r.dir).filter((n) => !n.startsWith('.')).length === 0, `${dry.copied?.length ?? '?'} would copy`);
const rep = migrateAIFolders({ apply: true, env, home: HOME });
const files = readdirSync(r.dir).filter((n) => !n.startsWith('.') && !n.startsWith('_'));
check('migration kept every unique coach once', ['a.json', 'b.json', 'c.json', 'd.json'].every((n) => files.includes(n)), files.join(','));
check('identical files were stored once', rep.duplicates.some((d) => d.rel === 'a.json'));
check('the conflicting file was preserved and reported', rep.conflicts.length === 1 && existsSync(join(r.dir, '_migration-conflicts')), JSON.stringify(rep.conflicts.map((c) => c.rel)));
check('companion/model files were migrated', existsSync(join(r.dir, 'models', 'weights.bin')));
check('credential-like files were not copied', !existsSync(join(r.dir, 'api-key.json')) && rep.skippedCredentialLike.length === 1);
check('the credential/state folder was not touched or merged', readFileSync(join(AS, 'Bloodboard Online', 'credentials.json'), 'utf8').includes('must-stay-here') && !existsSync(join(r.dir, 'credentials.json')));
check('legacy folders are untouched (copy-only)', existsSync(join(AS, 'Bloodboard V6/AI/a.json')) && existsSync(join(AS, 'Bloodboard Endgame Workshop/AI/d.json')));
const treeBefore = readdirSync(r.dir, { recursive: true }).filter((n) => !String(n).startsWith('.migration')).sort().join('|');
const rep2 = migrateAIFolders({ apply: true, env, home: HOME });
const tree = () => readdirSync(r.dir, { recursive: true }).filter((n) => !String(n).startsWith('.migration')).sort().join('|');
check('a second migration run copies nothing and changes no file (idempotent); the conflict is still reported, already preserved', (rep2.copied?.length ?? 0) === 0 && rep2.conflicts.length === 1 && rep2.conflicts[0].alreadyPreserved === true && tree() === treeBefore, `copied ${rep2.copied?.length}`);

// ── the Match Lab ───────────────────────────────────────────────────────────────────────────────────────────────────
const LAB = join(mkdtempSync(join(tmpdir(), 'lab-shared-')), 'match-lab');
cpSync(SRC, LAB, { recursive: true, filter: (p) => !/\/(runs|exports)(\/|$)/.test(p) });
const labEnv = { ...env };
const labWhere = () => { const o = spawnSync(process.execPath, ['lab.mjs', 'ai-where'], { cwd: LAB, env: labEnv, encoding: 'utf8' }); if (o.status !== 0) throw new Error(o.stderr || o.stdout); return JSON.parse(o.stdout.trim().split('\n').pop()); };
let lab = labWhere();
check('the Match Lab resolves the same folder', lab.dir === r.dir && lab.source === 'canonical', lab.dir);

// ── the game with a stand-in native bridge backed by the same resolver ───────────────────────────────────────────────
async function gameCoaches() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.exposeFunction('__bridge', async (msg) => {
    try {
      const dir = resolveAIDir({ env, home: HOME }).dir;
      if (msg.cmd === 'listFiles') return { ok: true, payload: readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && /\.(js|json)$/i.test(e.name) && !e.name.startsWith('.')).map((e) => ({ name: e.name, savedAt: '' })) };
      if (msg.cmd === 'loadFile') return { ok: true, payload: readFileSync(join(dir, msg.name), 'utf8') };
      if (msg.cmd === 'legacyAI') return { ok: true, payload: [] };
      if (msg.cmd === 'list') return { ok: true, payload: [] };
      return { ok: false, payload: `stand-in does not implement ${msg.cmd}` };
    } catch (e) { return { ok: false, payload: e.message }; }
  });
  await page.addInitScript(() => {
    window.webkit = { messageHandlers: { bloodboard: { postMessage: (m) => { window.__bridge(m).then((x) => window.__bloodboardNativeReply(m.id, x.ok, x.payload)); } } } };
  });
  await page.goto('file://' + process.cwd() + '/dist/web/index.html');
  await page.waitForFunction(() => window.bloodboard, null, { timeout: 15000 });
  await page.waitForTimeout(1200);
  const list = await page.evaluate(async () => {
    const m = await import('./app.js').catch(() => null); void m;
    return null;
  }).catch(() => null);
  void list;
  const got = await page.evaluate(() => (window.bloodboardCoaches ? window.bloodboardCoaches() : null));
  await browser.close();
  return { got, errors };
}
const g = await gameCoaches();
check('the game started with the native-bridge stand-in and no page errors', g.errors.length === 0, g.errors.join('; '));
check('the game exposes its loaded coaches for verification', Array.isArray(g.got), String(g.got));
const gameFiles = (g.got ?? []).filter((c) => !c.errors?.length).map((c) => ({ id: c.id, file: c.file, sha: c.sha })).sort((a, b) => a.id.localeCompare(b.id));
const labFiles = lab.coaches.filter((c) => c.valid).map((c) => ({ id: c.id, file: c.file, sha: c.sha })).sort((a, b) => a.id.localeCompare(b.id));
const onDisk = new Map(['a.json', 'b.json', 'c.json', 'd.json'].map((n) => [n, sha(readFileSync(join(r.dir, n), 'utf8'))]));
check('the folder holds valid coaches in both loaders (not an empty comparison)', gameFiles.length === 4 && labFiles.length === 4, `${gameFiles.length} / ${labFiles.length}`);
check('the game and the Lab list the same coach files', JSON.stringify(gameFiles.map((x) => x.file)) === JSON.stringify(labFiles.map((x) => x.file)), `${gameFiles.map((x) => x.file)} | ${labFiles.map((x) => x.file)}`);
check('the game and the Lab report identical SHA-256 per coach, equal to the file on disk', gameFiles.length === labFiles.length && gameFiles.every((x, i) => x.sha === labFiles[i].sha && x.sha === onDisk.get(x.file)));

// update one file, both see it
writeFileSync(join(r.dir, 'a.json'), coachJson('shared-a', 'Coach A updated', { version: '2.0' }));
const g2 = await gameCoaches(); lab = labWhere();
const ga = (g2.got ?? []).find((c) => c.id === 'shared-a'); const la = lab.coaches.find((c) => c.id === 'shared-a');
check('updating one file updates both (new name and version)', ga?.name === 'Coach A updated' && la?.name === 'Coach A updated' && ga?.version === '2.0' && la?.version === '2.0');
check('both see the same new SHA-256', ga?.sha && ga.sha === la?.sha && ga.sha === sha(readFileSync(join(r.dir, 'a.json'), 'utf8')));
// restart persistence: a fresh browser and a fresh Lab process read the same files again
const g3 = await gameCoaches(); const lab3 = labWhere();
check('after a restart (new game page, new Lab process) both still load the same coaches', (g3.got ?? []).length === g2.got.length && lab3.coaches.length === lab.coaches.length && lab3.dir === r.dir);
// a user-chosen folder is honoured by both (supported selection flow), never a silent second folder
const chosen = join(HOME, 'Elsewhere', 'AI'); mkdirSync(chosen, { recursive: true }); writeFileSync(join(chosen, 'z.json'), coachJson('z-chosen', 'Chosen folder coach'));
writeFileSync(join(AS, 'Bloodboard', 'ai-location.json'), JSON.stringify({ path: chosen }));
const g4 = await gameCoaches(); const lab4 = labWhere();
check('a chosen folder (ai-location.json) is used by both, and only that folder', lab4.dir === chosen && lab4.source === 'choice' && (g4.got ?? []).map((c) => c.id).join() === 'z-chosen' && lab4.coaches.map((c) => c.id).join() === 'z-chosen');
// credential overlap is refused, not worked around
writeFileSync(join(AS, 'Bloodboard', 'ai-location.json'), JSON.stringify({ path: join(AS, 'Bloodboard Online') }));
const bad = spawnSync(process.execPath, ['lab.mjs', 'ai-where'], { cwd: LAB, env: labEnv, encoding: 'utf8' });
check('a folder overlapping the credential/state folder is refused with an explicit error', bad.status !== 0 && /credential/i.test(bad.stderr + bad.stdout), (bad.stderr || bad.stdout).slice(0, 100));
console.log(`${results.filter(Boolean).length}/${results.length} passed (simulated Mac layout + browser stand-in; not native)`);
process.exit(results.every(Boolean) ? 0 : 1);
