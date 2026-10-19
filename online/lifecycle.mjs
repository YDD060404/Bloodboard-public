// Bridge process lifecycle (V7 COACH-03): single instance per state directory, machine-readable startup line, and
// automatic shutdown when the launching application goes away. Node-only; the native Mac app drives it as a child process.
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export const INSTANCE_FILE = 'bridge.json';
export const STARTUP_PREFIX = 'BLOODBOARD_BRIDGE_READY ';

export const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

/** Refuse a second live bridge on the same state directory; replace a stale record (dead pid). Never stores the pairing code or capability. */
export async function acquireInstance(dir, info, { replace = false } = {}) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, INSTANCE_FILE);
  let existing = null;
  try { existing = JSON.parse(await readFile(file, 'utf8')); } catch { /* none or unreadable: treat as stale */ }
  if (existing && Number.isInteger(existing.pid) && existing.pid !== process.pid && pidAlive(existing.pid)) {
    if (!replace) { const e = new Error(`A Bloodboard bridge is already running for this folder (pid ${existing.pid}, port ${existing.port}). Stop it first or start with --replace.`); e.code = 'ALREADY_RUNNING'; e.existing = existing; throw e; }
    try { process.kill(existing.pid, 'SIGTERM'); } catch { /* gone */ }
    for (let i = 0; i < 40 && pidAlive(existing.pid); i++) await new Promise((r) => setTimeout(r, 50));
  }
  await writeFile(file, JSON.stringify({ pid: process.pid, port: info.port, version: info.version, startedAt: new Date().toISOString() }), { mode: 0o600 });
  return async () => { try { const cur = JSON.parse(await readFile(file, 'utf8')); if (cur.pid === process.pid) await rm(file, { force: true }); } catch { /* already gone */ } };
}

/** Call `onGone` when the given parent pid disappears. Returns a stop function. */
export function watchParent(pid, onGone, intervalMs = 1000) {
  const t = setInterval(() => { if (!pidAlive(pid)) { clearInterval(t); onGone('parent-exited'); } }, intervalMs);
  t.unref?.();
  return () => clearInterval(t);
}

/** Call `onGone` when stdin closes (the launching app's pipe is gone, even after a crash). */
export function watchStdin(stream, onGone) {
  stream.on('end', () => onGone('stdin-closed'));
  stream.on('close', () => onGone('stdin-closed'));
  stream.resume();
}
