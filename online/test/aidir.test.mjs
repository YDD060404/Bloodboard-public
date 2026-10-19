// The shared AI folder policy and the idempotent, copy-only migration (simulated Application Support in a temp dir).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, utimesSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { resolveAIDir, ensureAIDir, chooseAIDir, migrateAIFolders, legacyAIFolders, coachIdOf, pendingLegacyFiles } from '../aidir.mjs';

const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const mk = () => {
  const home = mkdtempSync(join(tmpdir(), 'aidir-'));
  const as = join(home, 'Library', 'Application Support');
  const put = (folder, rel, text, age = 0) => { const p = join(as, folder, 'AI', rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, text); const t = (Date.now() - age) / 1000; utimesSync(p, t, t); return p; };
  return { home, as, put, env: {} };
};
const coach = (id, body = '') => `bloodboard.register({ id: '${id}', name: 'C', apiVersion: 2, version: '1', timeLimitMs: 3000, choose() { ${body} } });`;

test('one resolution policy: canonical by default, env override, saved choice; never a silent second folder', () => {
  const t = mk();
  const base = { home: t.home, env: {} };
  assert.equal(resolveAIDir(base).dir, join(t.as, 'Bloodboard', 'AI')); assert.equal(resolveAIDir(base).source, 'canonical');
  assert.equal(resolveAIDir({ ...base, env: { BLOODBOARD_AI_DIR: '/tmp/x-ai' } }).source, 'env');
  assert.throws(() => resolveAIDir({ ...base, env: { BLOODBOARD_AI_DIR: 'relative/dir' } }), /absolute/);
  const chosen = join(t.home, 'Elsewhere', 'AI');
  chooseAIDir(chosen, base);
  assert.deepEqual([resolveAIDir(base).dir, resolveAIDir(base).source], [chosen, 'choice']);
  // an unwritable choice fails explicitly instead of falling back
  const blocker = join(t.home, 'blocker'); writeFileSync(blocker, 'file');
  assert.throws(() => ensureAIDir({ ...base, env: { BLOODBOARD_AI_DIR: join(blocker, 'AI') } }), /cannot be created or written.*Nothing was written elsewhere/s);
});

test('credentials stay outside: the AI folder may not overlap the bridge state folder', () => {
  const t = mk();
  assert.throws(() => resolveAIDir({ home: t.home, env: { BLOODBOARD_AI_DIR: join(t.as, 'Bloodboard Online', 'private') } }), /may not overlap the credential/);
  assert.throws(() => resolveAIDir({ home: t.home, env: { BLOODBOARD_AI_DIR: t.as } }), /may not overlap the credential/);
});

test('migration: unique files copied, identical bytes stored once, conflicts preserved, credential-like files left behind', () => {
  const t = mk();
  const a = t.put('Bloodboard V6', 'alpha.js', coach('alpha'));
  t.put('Bloodboard Endgame Workshop', 'alpha.js', coach('alpha'));                      // identical (same path, same bytes)
  t.put('Bloodboard Endgame Workshop', 'alpha-copy.js', coach('alpha'));                  // identical bytes, other name
  t.put('Bloodboard V6', 'only-v6.js', coach('onlyv6'));
  t.put('Bloodboard Endgame Workshop', 'only-ew.json', JSON.stringify({ id: 'profile-ew', name: 'P' }));
  t.put('Bloodboard V6', 'models/weights.bin', 'WEIGHTS-1');                              // companion/model asset in a subfolder
  t.put('Bloodboard V6', 'shared.js', coach('shared', 'return 1;'), 60000);               // older
  const newer = t.put('Bloodboard Endgame Workshop', 'shared.js', coach('shared', 'return 2;'), 0); // newer, conflicting
  t.put('Bloodboard V6', 'leaky.js', "const k = 'sk-abcdefghijklmnopqrstuvwxyz012345';");
  const before = ['Bloodboard V6', 'Bloodboard Endgame Workshop'].map((f) => readdirSync(join(t.as, f, 'AI'), { recursive: true }).sort().join('|'));
  const opts = { home: t.home, env: {} };
  const dry = migrateAIFolders({ ...opts, apply: false });
  assert.equal(existsSync(join(t.as, 'Bloodboard', 'AI')), false, 'a dry run changes nothing');
  assert.equal(dry.copied.length > 0, true);
  const r = migrateAIFolders({ ...opts, apply: true });
  const ai = join(t.as, 'Bloodboard', 'AI');
  // unique files are all there
  for (const rel of ['alpha.js', 'only-v6.js', 'only-ew.json', 'models/weights.bin', 'shared.js']) assert.ok(existsSync(join(ai, rel)), rel);
  assert.equal(readFileSync(join(ai, 'models/weights.bin'), 'utf8'), 'WEIGHTS-1');
  // identical bytes stored once (the copy under another name is an alias, not a second file)
  assert.equal(existsSync(join(ai, 'alpha-copy.js')), false);
  assert.ok(r.duplicates.some((d) => d.rel === 'alpha-copy.js' && d.aliasOf === 'alpha.js'));
  // the newest conflicting version keeps the name; the other is preserved separately and reported
  assert.equal(sha(join(ai, 'shared.js')), sha(newer));
  assert.equal(r.conflicts.length, 1);
  assert.ok(existsSync(join(ai, r.conflicts[0].preservedAs)));
  assert.notEqual(sha(join(ai, r.conflicts[0].preservedAs)), sha(join(ai, 'shared.js')));
  assert.deepEqual(r.collisions.map((c) => c.coachId), ['shared']);
  // credential-like file not copied, still in its legacy folder
  assert.equal(existsSync(join(ai, 'leaky.js')), false); assert.equal(r.skippedCredentialLike.length, 1);
  assert.ok(existsSync(join(t.as, 'Bloodboard V6', 'AI', 'leaky.js')));
  // legacy folders untouched; verified backup exists
  const after = ['Bloodboard V6', 'Bloodboard Endgame Workshop'].map((f) => readdirSync(join(t.as, f, 'AI'), { recursive: true }).sort().join('|'));
  assert.deepEqual(after, before);
  assert.ok(r.backup && existsSync(join(r.backup, 'MANIFEST.json')));
  assert.equal(sha(join(r.backup, 'Bloodboard_V6-AI', 'alpha.js')), sha(a));
  // coach ids survive the move
  assert.equal(coachIdOf(join(ai, 'alpha.js')), 'alpha'); assert.equal(coachIdOf(join(ai, 'only-ew.json')), 'profile-ew');
});

test('migration is idempotent: a second run changes nothing and does not repeat the backup', () => {
  const t = mk();
  t.put('Bloodboard V6', 'a.js', coach('a')); t.put('Bloodboard Endgame Workshop', 'b.js', coach('b'));
  const opts = { home: t.home, env: {} };
  const r1 = migrateAIFolders({ ...opts, apply: true });
  const ai = join(t.as, 'Bloodboard', 'AI');
  const listing = () => readdirSync(ai, { recursive: true }).filter((n) => !String(n).startsWith('.migration')).sort().join('|');
  const l1 = listing(); const backups1 = readdirSync(join(t.as, 'Bloodboard', 'AI-migration-backups')).length;
  const r2 = migrateAIFolders({ ...opts, apply: true });
  assert.equal(listing(), l1); assert.equal(r2.copied.length, 0); assert.equal(r2.conflicts.length, 0);
  assert.equal(readdirSync(join(t.as, 'Bloodboard', 'AI-migration-backups')).length, backups1, 'no second backup of unchanged sources');
  assert.match(String(r2.backup), /unchanged/);
  assert.equal(r1.copied.length, 2);
  // a file added to a legacy folder later is picked up (and backed up again)
  t.put('Bloodboard V6', 'late.js', coach('late'));
  const r3 = migrateAIFolders({ ...opts, apply: true });
  assert.deepEqual(r3.copied.map((c) => c.rel), ['late.js']);
  assert.equal(pendingLegacyFiles(opts).count, 0);
});

test('other version-specific AI folders are discovered and migrated too', () => {
  const t = mk();
  t.put('Bloodboard V7 Preview', 'x.js', coach('x'));
  mkdirSync(join(t.as, 'Bloodboard Online', 'private'), { recursive: true });
  const f = legacyAIFolders({ home: t.home, env: {} });
  assert.ok(f.some((d) => d.includes('Bloodboard V7 Preview')), 'discovered');
  assert.ok(!f.some((d) => d.includes('Bloodboard Online')), 'the credential/state folder is never treated as an AI folder');
  migrateAIFolders({ home: t.home, env: {}, apply: true });
  assert.ok(existsSync(join(t.as, 'Bloodboard', 'AI', 'x.js')));
});
