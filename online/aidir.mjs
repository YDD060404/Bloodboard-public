// The ONE AI coach folder policy for Bloodboard (game), the online-coach tools and the Match Lab.
//
//   Canonical folder:  ~/Library/Application Support/Bloodboard/AI/
//
// Resolution order (identical in every component; the native app implements the same table in Swift, see docs/AI_FOLDER.md):
//   1. BLOODBOARD_AI_DIR              explicit absolute path (tests, unusual setups). Reported as source "env".
//   2. <Application Support>/Bloodboard/ai-location.json  {"path": "/abs/dir"}   written by a supported folder-selection flow. Source "choice".
//   3. <Application Support>/Bloodboard/AI                                        Source "canonical".
// There is no further fallback: when the resolved folder cannot be created or written, resolution FAILS with an explicit error and the
// supported remedy; nothing silently falls back to a second writable folder.
//
// Credentials never live here: the AI folder may not be, contain or sit inside a credential/state folder.
//
// This file is shipped unchanged inside the game package (online/), the Match Lab (lab/aidir.mjs) and the native app resources.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, copyFileSync, accessSync, constants, lstatSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep, isAbsolute } from 'node:path';

export const CANONICAL_NAME = 'Bloodboard';
export const POLICY_VERSION = 1;
/** Folder names that hold credentials or bridge state; the AI folder must never overlap them. */
export const CREDENTIAL_FOLDER_NAMES = ['Bloodboard Online'];

export const appSupport = (home = homedir()) => join(home, 'Library', 'Application Support');

/** Resolve the shared AI folder. Returns { dir, source, appSupport, root }. Never creates anything. */
export function resolveAIDir({ env = process.env, home = homedir(), support } = {}) {
  const as = support ?? env.BLOODBOARD_APPSUPPORT ?? appSupport(home);
  const root = join(as, CANONICAL_NAME);
  if (env.BLOODBOARD_AI_DIR) {
    if (!isAbsolute(env.BLOODBOARD_AI_DIR)) throw new Error(`BLOODBOARD_AI_DIR must be an absolute path (got "${env.BLOODBOARD_AI_DIR}").`);
    return check({ dir: resolve(env.BLOODBOARD_AI_DIR), source: 'env', appSupport: as, root });
  }
  const choiceFile = join(root, 'ai-location.json');
  if (existsSync(choiceFile)) {
    let p;
    try { p = JSON.parse(readFileSync(choiceFile, 'utf8')).path; } catch { throw new Error(`${choiceFile} is not valid JSON. Fix or remove it (the default is ${join(root, 'AI')}).`); }
    if (typeof p !== 'string' || !isAbsolute(p)) throw new Error(`${choiceFile} must contain {"path": "<absolute folder>"}.`);
    return check({ dir: resolve(p), source: 'choice', appSupport: as, root });
  }
  return check({ dir: join(root, 'AI'), source: 'canonical', appSupport: as, root });
}

function check(r) {
  for (const n of CREDENTIAL_FOLDER_NAMES) {
    const cred = join(r.appSupport, n);
    const rel = relative(cred, r.dir);
    const inside = rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
    const contains = !relative(r.dir, cred).startsWith('..') && !isAbsolute(relative(r.dir, cred));
    if (inside || contains) throw new Error(`The AI folder (${r.dir}) may not overlap the credential/state folder (${cred}). Credentials stay outside the shared AI folder.`);
  }
  return r;
}

/** Create (if needed) and verify the resolved folder is writable. Throws an explicit error with the supported remedy; never falls back. */
export function ensureAIDir(opts) {
  const r = resolveAIDir(opts);
  try {
    mkdirSync(r.dir, { recursive: true });
    accessSync(r.dir, constants.R_OK | constants.W_OK);
  } catch (e) {
    throw new Error(`The AI folder ${r.dir} (${r.source}) cannot be created or written: ${e.code ?? e.message}. Supported remedies: grant the app access to that folder (System Settings → Privacy & Security → Files and Folders / Full Disk Access), or choose another folder with "node online/aidir.mjs choose <absolute folder>" (or Choose AI Folder… in the app). Nothing was written elsewhere.`);
  }
  return r;
}

/** Record a user-chosen AI folder (the supported selection flow). The choice is read by the game, the Lab and the online tools alike. */
export function chooseAIDir(dir, opts = {}) {
  if (!isAbsolute(dir)) throw new Error('The folder must be an absolute path.');
  const probe = resolveAIDirFor(dir, opts);
  mkdirSync(probe.dir, { recursive: true }); accessSync(probe.dir, constants.R_OK | constants.W_OK);
  mkdirSync(probe.root, { recursive: true });
  writeFileSync(join(probe.root, 'ai-location.json'), JSON.stringify({ path: resolve(dir), chosenAt: new Date().toISOString(), policy: POLICY_VERSION }, null, 2) + '\n');
  return resolveAIDir({ ...opts, env: { ...(opts.env ?? process.env), BLOODBOARD_AI_DIR: '' } });
}
function resolveAIDirFor(dir, opts) {
  const { env = process.env, home = homedir(), support } = opts;
  const as = support ?? env.BLOODBOARD_APPSUPPORT ?? appSupport(home);
  return check({ dir: resolve(dir), source: 'choice', appSupport: as, root: join(as, CANONICAL_NAME) });
}

// ───────────────────────────────────────────────────────────── migration
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const SKIP_NAMES = new Set(['.DS_Store', '.bloodboard-v5.5-seeded']);
const CREDENTIAL_NAME = /(^|\/)(private|bridge-capability|.*\.(token|key|pem|p12)|.*secret.*|.*credential.*|.*api[-_ ]?key.*|.*passw(or)?d.*|\.env|auth\.json)$/i;
const SECRET_TEXT = /(sk-[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9._-]{20,}|api[_-]?key["' ]*[:=]["' ]*[A-Za-z0-9._-]{20,})/;

function walk(dir, base = dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_NAMES.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else if (e.isFile()) out.push({ abs: p, rel: relative(base, p).split(sep).join('/') });
  }
  return out;
}

/** Best-effort stable coach id of a coach file (register({ id: '…' }) or a profile's "id"). Null when it cannot be read safely. */
export function coachIdOf(file) {
  try {
    if (/\.json$/i.test(file)) { const j = JSON.parse(readFileSync(file, 'utf8')); return typeof j.id === 'string' ? j.id : null; }
    if (/\.js$/i.test(file)) { const m = /register\s*\(\s*\{[^}]*?\bid\s*:\s*['"]([^'"]+)['"]/s.exec(readFileSync(file, 'utf8').slice(0, 200000)); return m ? m[1] : null; }
  } catch { /* unreadable: no id */ }
  return null;
}

/** Version-specific AI folders that are NOT the canonical one: the two known ones plus any other Bloodboard-prefixed folder under Application Support that holds an AI subfolder. */
export function legacyAIFolders({ env = process.env, home = homedir(), support } = {}) {
  const as = support ?? env.BLOODBOARD_APPSUPPORT ?? appSupport(home);
  const known = ['Bloodboard V6', 'Bloodboard Endgame Workshop'];
  const found = new Set(known.map((n) => join(as, n, 'AI')));
  try {
    for (const e of readdirSync(as, { withFileTypes: true })) {
      if (!e.isDirectory() || !/^Bloodboard/i.test(e.name) || e.name === CANONICAL_NAME || CREDENTIAL_FOLDER_NAMES.includes(e.name)) continue;
      const ai = join(as, e.name, 'AI');
      if (existsSync(ai)) found.add(ai);
    }
  } catch { /* no Application Support listing */ }
  return [...found].filter((d) => existsSync(d));
}

/**
 * Migrate every legacy AI folder into the canonical one. Idempotent, copy-only: nothing in a legacy folder is changed or removed.
 *  - the legacy folders are backed up first (full copy + manifest) under <Bloodboard>/AI-migration-backups/<stamp>/ (skipped when unchanged since the last backup);
 *  - every unique file (coach, companion file, model asset) is copied with its relative path; identical bytes (same SHA-256) are stored once;
 *  - a different file at an occupied path is a CONFLICT: the newest version keeps the name, the other is preserved under
 *    <AI>/_migration-conflicts/<source>/<path> and reported; nothing is overwritten;
 *  - files that look like credentials are NOT copied (reported; they stay in their legacy folder and the backup).
 * Returns the report object (also written to <AI>/.migration/last-report.json and appended to .migration/history.jsonl).
 */
export function migrateAIFolders({ apply = false, sources, env = process.env, home = homedir(), support, now = () => new Date() } = {}) {
  const target = resolveAIDir({ env, home, support });
  const srcs = (sources ?? legacyAIFolders({ env, home, support })).filter((d) => resolve(d) !== resolve(target.dir));
  const stamp = now().toISOString().replace(/[:.]/g, '-');
  const report = { schema: 'bloodboard-ai-migration/1', apply, at: now().toISOString(), canonical: target.dir, canonicalSource: target.source, sources: [], copied: [], duplicates: [], conflicts: [], skippedCredentialLike: [], collisions: [], backup: null, errors: [] };
  const mig = join(target.dir, '.migration');
  const label = (d) => basename(dirname(d)).replace(/[^A-Za-z0-9._-]+/g, '_');

  // index of what the canonical folder already holds
  const hashes = new Map(); // sha -> rel path in canonical
  if (existsSync(target.dir)) for (const f of walk(target.dir)) { if (f.rel.startsWith('.migration/') || f.rel.startsWith('_migration-conflicts/')) continue; hashes.set(sha256(f.abs), f.rel); }

  // 1. backup (only when the source set changed since the last backup)
  const fileLists = srcs.map((d) => ({ dir: d, files: walk(d) }));
  const treeHash = createHash('sha256').update(JSON.stringify(fileLists.map((s) => [s.dir, s.files.map((f) => [f.rel, sha256(f.abs)]).sort()]))).digest('hex');
  let lastTree = null; try { lastTree = JSON.parse(readFileSync(join(mig, 'state.json'), 'utf8')).lastBackupTree; } catch { /* first run */ }
  if (apply && srcs.length && treeHash !== lastTree) {
    const bdir = join(target.root, 'AI-migration-backups', stamp);
    for (const s of fileLists) {
      const dest = join(bdir, label(s.dir) + '-AI');
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(s.dir, dest, { recursive: true, errorOnExist: true, force: false });
      // verify the backup byte for byte
      for (const f of s.files) if (sha256(join(dest, f.rel)) !== sha256(f.abs)) throw new Error(`Backup verification failed for ${f.abs}; migration stopped before copying anything.`);
    }
    writeFileSync(join(bdir, 'MANIFEST.json'), JSON.stringify({ at: report.at, sources: fileLists.map((s) => ({ dir: s.dir, files: s.files.map((f) => ({ rel: f.rel, sha256: sha256(f.abs) })) })) }, null, 2));
    report.backup = bdir;
  } else if (srcs.length && treeHash === lastTree) report.backup = 'unchanged since the last backup (not repeated)';

  // 2. merge, newest first so the newest version of a conflicting path keeps the name
  const entries = [];
  for (const s of fileLists) {
    report.sources.push({ dir: s.dir, files: s.files.length });
    for (const f of s.files) entries.push({ src: s.dir, label: label(s.dir), abs: f.abs, rel: f.rel, sha: sha256(f.abs), mtime: statSync(f.abs).mtimeMs });
  }
  // Plain names are placed before "copy"-style names (so identical bytes keep the original name); for the same path the newest version goes first.
  const copyish = /(copy|copie|副本|\(\d+\)| \d+)\.[A-Za-z0-9]+$/i;
  entries.sort((a, b) => (copyish.test(a.rel) ? 1 : 0) - (copyish.test(b.rel) ? 1 : 0) || a.rel.length - b.rel.length || b.mtime - a.mtime || (a.src < b.src ? -1 : 1));
  if (apply) mkdirSync(target.dir, { recursive: true });
  const at = new Map(); // rel -> sha placed in canonical this run or already there
  if (existsSync(target.dir)) for (const f of walk(target.dir)) if (!f.rel.startsWith('.migration/') && !f.rel.startsWith('_migration-conflicts/')) at.set(f.rel, sha256(f.abs));
  for (const e of entries) {
    if (CREDENTIAL_NAME.test(e.rel) || (/\.(js|json|txt)$/i.test(e.rel) && SECRET_TEXT.test(readFileSync(e.abs, 'utf8').slice(0, 400000)))) { report.skippedCredentialLike.push({ from: e.abs, sha256: e.sha }); continue; }
    const have = at.get(e.rel);
    if (have === e.sha) { report.duplicates.push({ rel: e.rel, sha256: e.sha, from: e.abs, reason: 'same path and bytes' }); continue; }
    if (hashes.has(e.sha) && hashes.get(e.sha) !== e.rel) { report.duplicates.push({ rel: e.rel, sha256: e.sha, from: e.abs, reason: `same bytes already stored as ${hashes.get(e.sha)}`, aliasOf: hashes.get(e.sha) }); continue; }
    if (have !== undefined) {
      const dest = join(target.dir, '_migration-conflicts', e.label, e.rel);
      report.conflicts.push({ rel: e.rel, keptAs: e.rel, keptSha256: have, preservedAs: relative(target.dir, dest), preservedSha256: e.sha, from: e.abs, coachId: coachIdOf(e.abs) });
      report.conflicts[report.conflicts.length - 1].alreadyPreserved = existsSync(dest) && sha256(dest) === e.sha;
      if (apply && !existsSync(dest)) { mkdirSync(dirname(dest), { recursive: true }); copyFileSync(e.abs, dest); if (sha256(dest) !== e.sha) throw new Error(`Copy verification failed for ${dest}`); }
      continue;
    }
    const dest = join(target.dir, e.rel);
    if (apply) { mkdirSync(dirname(dest), { recursive: true }); copyFileSync(e.abs, dest); if (sha256(dest) !== e.sha) throw new Error(`Copy verification failed for ${dest}`); }
    at.set(e.rel, e.sha); hashes.set(e.sha, e.rel);
    report.copied.push({ rel: e.rel, sha256: e.sha, from: e.abs, coachId: coachIdOf(e.abs) });
  }
  // 3. same coach id under different files (informational: selections are by id, so the one stored under the id wins)
  const byId = new Map();
  for (const c of [...report.copied, ...report.conflicts.map((x) => ({ rel: x.preservedAs, coachId: x.coachId }))]) if (c.coachId) byId.set(c.coachId, [...(byId.get(c.coachId) ?? []), c.rel]);
  report.collisions = [...byId].filter(([, v]) => v.length > 1).map(([id, files]) => ({ coachId: id, files }));
  if (apply) {
    mkdirSync(mig, { recursive: true });
    writeFileSync(join(mig, 'last-report.json'), JSON.stringify(report, null, 2));
    writeFileSync(join(mig, 'history.jsonl'), '', { flag: 'a' });
    writeFileSync(join(mig, 'history.jsonl'), JSON.stringify({ at: report.at, copied: report.copied.length, duplicates: report.duplicates.length, conflicts: report.conflicts.length }) + '\n', { flag: 'a' });
    writeFileSync(join(mig, 'state.json'), JSON.stringify({ lastBackupTree: treeHash, policy: POLICY_VERSION, updated: report.at }, null, 2));
  }
  return report;
}

/** Legacy folders still holding files the canonical folder lacks (used by the Lab and the game to WARN, never to read from a second folder). */
export function pendingLegacyFiles(opts = {}) {
  try { const r = migrateAIFolders({ ...opts, apply: false }); return { count: r.copied.length + r.conflicts.length, folders: r.sources.map((s) => s.dir), report: r }; } catch (e) { return { count: 0, folders: [], error: e.message }; }
}

// ───────────────────────────────────────────────────────────── CLI
function printReport(r) {
  console.log(`${r.apply ? 'MIGRATION APPLIED' : 'DRY RUN (nothing changed)'}: canonical folder ${r.canonical} (${r.canonicalSource})`);
  for (const s of r.sources) console.log(`  source ${s.dir}: ${s.files} files`);
  console.log(`  backup: ${r.backup ?? 'none (no legacy folders)'}`);
  console.log(`  copied ${r.copied.length}, duplicates skipped ${r.duplicates.length}, conflicts preserved ${r.conflicts.length}, credential-like files left behind ${r.skippedCredentialLike.length}`);
  for (const c of r.copied) console.log(`    copy      ${c.rel}  ${c.sha256.slice(0, 12)}${c.coachId ? `  id=${c.coachId}` : ''}`);
  for (const c of r.duplicates) console.log(`    duplicate ${c.rel}  (${c.reason})`);
  for (const c of r.conflicts) console.log(`    CONFLICT  ${c.rel}: kept ${c.keptSha256.slice(0, 12)}, preserved the other (${c.preservedSha256.slice(0, 12)}) as ${c.preservedAs}`);
  for (const c of r.skippedCredentialLike) console.log(`    NOT COPIED (looks like a credential): ${c.from}`);
  for (const c of r.collisions) console.log(`    SAME COACH ID in several files: ${c.coachId}: ${c.files.join(', ')}`);
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const [cmd = 'where', arg] = process.argv.slice(2);
  try {
    if (cmd === 'where') { const r = resolveAIDir(); console.log(`${r.dir}  (${r.source})`); }
    else if (cmd === 'ensure') { const r = ensureAIDir(); console.log(`${r.dir}  (${r.source}) is ready`); }
    else if (cmd === 'choose') { const r = chooseAIDir(arg); console.log(`AI folder choice saved: ${r.dir}`); }
    else if (cmd === 'migrate') { printReport(migrateAIFolders({ apply: process.argv.includes('--apply') })); }
    else if (cmd === 'pending') { const p = pendingLegacyFiles(); console.log(`${p.count} legacy files not yet in the canonical folder`); }
    else { console.error('usage: node aidir.mjs where | ensure | choose <absolute folder> | migrate [--apply] | pending'); process.exit(2); }
  } catch (e) { console.error(e.message); process.exit(1); }
}
