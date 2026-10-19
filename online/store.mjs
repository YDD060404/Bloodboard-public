// Credential protection for the local bridge. Secrets are never written in plain text and never appear in status, logs or exports.
//  - macOS: AES-GCM with a key that lives only in the Keychain (native/keychain-helper, built from native/keychain.swift).
//    The Keychain service name is kept identical to the earlier ChatGPT probe so an existing ChatGPT connection stays readable.
//  - Elsewhere (tests, Linux): no persistent secret storage. A secret can be held in memory for the session, or supplied through an
//    environment variable by the caller. Nothing is silently stored with weak protection.
import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const HELPER = fileURLToPath(new URL('./native/keychain-helper', import.meta.url));

function runHelper(operation, input, helper = HELPER) {
  return new Promise((resolve, reject) => {
    const child = spawn(helper, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = []; let size = 0;
    const timer = setTimeout(() => { child.kill(); reject(new Error('Credential protection timed out.')); }, 30000);
    child.stdout.on('data', (b) => { size += b.length; if (size > 8 * 1024 * 1024) { child.kill(); reject(new Error('Credential protection output too large.')); } else out.push(b); });
    child.stderr.resume();
    child.once('error', () => { clearTimeout(timer); reject(new Error('Credential protection helper unavailable.')); });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error('macOS Keychain credential protection failed.'));
      try { const v = JSON.parse(Buffer.concat(out).toString('utf8')); if (typeof v.output !== 'string') throw 0; resolve(v.output); }
      catch { reject(new Error('Invalid credential protection response.')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ operation, input }));
  });
}

/** The CredentialEncryption object the ChatGPT runtime expects. */
export function keychainEncryption(helper = HELPER) {
  return {
    id: 'bloodboard-macos-keychain-aes-gcm-v1',
    isAvailable: () => access(helper).then(() => true, () => false),
    encrypt: async (text) => Buffer.from(await runHelper('encrypt', text, helper), 'base64'),
    decrypt: (bytes) => runHelper('decrypt', Buffer.from(bytes).toString('base64'), helper),
  };
}

/**
 * Named secret store. persistent=false means the secret lives in memory only (cleared when the bridge stops).
 * `encryption` is injectable so tests can use a fake with the same interface.
 */
export function createSecretStore({ dir, encryption = keychainEncryption() }) {
  const memory = new Map();
  const file = (name) => join(dir, `${name.replace(/[^a-z0-9._-]/gi, '_')}.enc`);
  return {
    async persistent() { return !!(await encryption.isAvailable()); },
    async set(name, value) {
      if (typeof value !== 'string' || !value.trim() || value.length > 4096 || /[\u0000-\u001f]/.test(value)) throw new Error('Invalid secret.');
      memory.set(name, value);
      if (!(await encryption.isAvailable())) return { persisted: false };
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const bytes = await encryption.encrypt(value);
      await writeFile(file(name), Buffer.from(bytes).toString('base64'), { mode: 0o600 });
      await chmod(file(name), 0o600).catch(() => {});
      return { persisted: true };
    },
    async get(name) {
      if (memory.has(name)) return memory.get(name);
      try {
        const bytes = Buffer.from((await readFile(file(name), 'utf8')).trim(), 'base64');
        const value = await encryption.decrypt(bytes);
        memory.set(name, value);
        return value;
      } catch (e) { if (e && e.code === 'ENOENT') return null; return null; }
    },
    async has(name) { return (await this.get(name)) !== null; },
    async remove(name) { memory.delete(name); await rm(file(name), { force: true }); },
  };
}
