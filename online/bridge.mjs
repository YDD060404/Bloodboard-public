// Bloodboard online-coach bridge: ONE local HTTP service for every online provider (DeepSeek API, ChatGPT Luna subscription route).
// It is the only process that holds provider credentials. The game (web or native) and Match Lab coaches talk to it over loopback
// with a local pairing capability; they never see a provider key or token. Multiplayer peers never reach it.
//
//   node bridge.mjs serve [--port 60557] [--dir <state dir>]
//   node bridge.mjs install-coach --provider deepseek|luna --model <id> [--to <folder>]   (default: the shared AI folder, see aidir.mjs)
//   node bridge.mjs pair            (prints the one-time pairing code of a running/last bridge)
import http from 'node:http';
import { randomBytes, randomInt, timingSafeEqual, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, appendFile, chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parseCommand, ProtocolError, PROTOCOL_VERSION } from './protocol.mjs';
import { ProviderError, asProviderError } from './providers/errors.mjs';

export const BRIDGE_VERSION = '7.0.2';
export const DEFAULT_PORT = 60557;
const MAX_BODY = 2_000_000;
const MAX_BUDGET_MS = 120_000;

const safeEqual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
const loopbackOrigin = (o) => !o || o === 'null' || /^(http|https):\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(o) || /^file:\/\//.test(o);

/**
 * @param {object} o
 * @param {Array} o.providers      provider objects (see providers/*.mjs)
 * @param {string} o.instructions  stable system instructions shared by all providers
 * @param {string} o.capability    local pairing capability (64 hex)
 * @param {string} [o.pairingCode] one-time code the UI exchanges for the capability
 * @param {number} [o.port]
 * @param {(entry:object)=>void} [o.audit]  receives content-free call records
 */
export function createBridge({ providers, instructions, capability, pairingCode, port = DEFAULT_PORT, audit = () => {}, maxBudgetMs = MAX_BUDGET_MS, aiDirs = [], stateDir = null }) {
  const byId = new Map(providers.map((p) => [p.id, p]));
  const active = new Map();          // requestId -> {ctl, provider}
  const finished = [];               // recent request ids (duplicate-command rejection)
  const pairing = { code: pairingCode ?? null, failures: 0, lockedUntil: 0, issuedAt: Date.now() };
  const instructionsSha256 = createHash('sha256').update(instructions).digest('hex');
  const activeCount = (id) => [...active.values()].filter((a) => a.provider === id).length;
  const abortProvider = (id, why) => { for (const [rid, a] of active) if (a.provider === id) { a.why = why; a.ctl.abort(); } };
  let boundPort = port;

  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, body) => { if (!res.destroyed && !res.headersSent) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); } };
    const host = req.headers.host ?? '';
    if (!(host === `127.0.0.1:${boundPort}` || host === `localhost:${boundPort}`) || !loopbackOrigin(req.headers.origin)) return send(403, { error: 'local_bridge_only' });
    if (req.headers.origin) { res.setHeader('Access-Control-Allow-Origin', req.headers.origin); res.setHeader('Vary', 'Origin'); }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE');
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
      res.writeHead(204); return res.end();
    }
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname;

    // Unauthenticated: discovery and pairing only. Neither reveals account data.
    if (req.method === 'GET' && path === '/ping') return send(200, { bloodboardBridge: true, version: BRIDGE_VERSION, protocol: PROTOCOL_VERSION, pairingRequired: true });
    let body = null;
    if (req.method === 'POST' || req.method === 'DELETE') {
      let size = 0; const chunks = [];
      try { for await (const c of req) { size += c.length; if (size > MAX_BODY) return send(413, { error: 'body_too_large' }); chunks.push(c); } }
      catch { return send(400, { error: 'bad_body' }); }
      if (size) {
        if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return send(415, { error: 'json_required' });
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, { error: 'invalid_json' }); }
      }
    }
    if (req.method === 'POST' && path === '/pair') {
      if (Date.now() < pairing.lockedUntil) return send(429, { error: 'pairing_locked' });
      if (!pairing.code || typeof body?.code !== 'string' || !safeEqual(body.code, pairing.code)) {
        if (++pairing.failures >= 5) { pairing.lockedUntil = Date.now() + 60_000; pairing.failures = 0; }
        return send(403, { error: 'bad_pairing_code' });
      }
      pairing.failures = 0;
      return send(200, { capability });
    }
    const auth = req.headers.authorization ?? '';
    if (!safeEqual(auth, `Bearer ${capability}`)) return send(403, { error: 'bridge_pairing_required' });

    try {
      if (req.method === 'GET' && path === '/health') return send(200, { version: BRIDGE_VERSION, protocol: PROTOCOL_VERSION, providers: [...byId.keys()], active: active.size, instructionsSha256 });
      if (req.method === 'GET' && path === '/status') return send(200, { version: BRIDGE_VERSION, providers: await Promise.all([...byId.values()].map((p) => p.status())) });

      let m;
      if ((m = /^\/providers\/([a-z0-9-]+)\/(models|check|key|signin|cancel-signin|signout)$/.exec(path))) {
        const p = byId.get(m[1]);
        if (!p) return send(404, { error: 'unknown_provider' });
        const action = m[2];
        const ctl = new AbortController();
        res.on('close', () => { if (!res.writableEnded) ctl.abort(); });
        const signal = AbortSignal.any([ctl.signal, AbortSignal.timeout(30000)]);
        if (req.method === 'GET' && action === 'models') return send(200, { provider: p.id, models: await p.listModels({ signal }) });
        if (req.method === 'POST' && action === 'check') return send(200, await p.check({ signal }));
        if (action === 'key') {
          if (p.id !== 'deepseek') return send(404, { error: 'not_supported' });
          abortProvider(p.id, 'key_changed');
          if (req.method === 'POST') { const r = await p.setKey(body?.key); return send(200, { stored: true, persisted: !!r.persisted }); }
          if (req.method === 'DELETE') { await p.clearKey(); return send(200, { removed: true }); }
        }
        if (p.id === 'luna' && req.method === 'POST') {
          if (action === 'signin') { abortProvider('luna', 'sign_in'); return send(200, await p.startSignIn({ newProfile: !!body?.newProfile, reconsent: !!body?.reconsent })); }
          if (action === 'cancel-signin') { await p.cancelSignIn(); return send(200, { cancelled: true }); }
          if (action === 'signout') { abortProvider('luna', 'sign_out'); await p.signOut(); return send(200, { signedOut: true }); }
        }
        return send(404, { error: 'not_found' });
      }

      if (path === '/coaches' && req.method === 'GET') {
        const { readdir, readFile: rf } = await import('node:fs/promises');
        const out = [];
        for (const d of aiDirs) {
          let names = []; try { names = (await readdir(d)).filter((n) => /^Online-.*\.js$/.test(n)); } catch { /* folder missing */ }
          for (const n of names) out.push({ dir: d, name: n, sha256: createHash('sha256').update(await rf(join(d, n))).digest('hex') });
        }
        return send(200, { targets: aiDirs, coaches: out });
      }
      if (path === '/coaches/file' && req.method === 'GET') {
        const name = url.searchParams.get('name') ?? '';
        if (!/^Online-[\w.-]+\.js$/.test(name) || !aiDirs.length) return send(404, { error: 'not_found' });
        const { readFile: rf } = await import('node:fs/promises');
        try { return send(200, { name, text: await rf(join(aiDirs[0], name), 'utf8') }); } catch { return send(404, { error: 'not_found' }); }
      }
      if (path === '/coaches/install' && req.method === 'POST') {
        // Install targets are fixed by how the bridge was started; a caller can never choose where files are written.
        if (!aiDirs.length || !stateDir) return send(409, { error: { code: 'no_install_targets', message: 'The bridge was started without AI folders.' } });
        const provider = String(body?.provider ?? ''), model = String(body?.model ?? '');
        if (!byId.has(provider) || !model || model.length > 200) return send(400, { error: { code: 'invalid_request', message: 'Choose a provider and a model.' } });
        const { buildCoach } = await import('./build-coach.mjs');
        const r = await buildCoach({ provider, model, stateDir, port: boundPort, targets: aiDirs, budgetMs: Number(body?.budgetMs) > 0 ? Math.min(maxBudgetMs, Number(body.budgetMs)) : undefined });
        return send(200, r);
      }

      if (req.method === 'POST' && path === '/cancel') {
        const a = active.get(String(body?.requestId ?? ''));
        if (a) { a.why = 'cancelled'; a.ctl.abort(); }
        return send(200, { cancelled: !!a });
      }

      if (req.method === 'POST' && path === '/decision') return await decision(body, req, res, send);
      return send(404, { error: 'not_found' });
    } catch (e) {
      const t = asProviderError(e);
      return send(t.code === 'cancelled' ? 409 : 502, { error: t.toJSON() });
    }
  });

  async function decision(body, req, res, send) {
    const p = byId.get(body?.provider);
    if (!p) return send(400, { error: { code: 'unknown_provider', message: 'Choose a provider.' } });
    const msgs = body?.messages;
    if (typeof body?.model !== 'string' || !body.model.trim() || body.model.length > 200) return send(400, { error: { code: 'model_required', message: 'Choose a model.' } });
    if (!Array.isArray(msgs) || !msgs.length || msgs.length > 16 || msgs.some((x) => !['user', 'assistant'].includes(x?.role) || typeof x.content !== 'string' || x.content.length > 900_000)) return send(400, { error: { code: 'invalid_messages', message: 'Invalid messages.' } });
    if (body.requestId !== undefined && !(typeof body.requestId === 'string' && /^[\w.:-]{1,80}$/.test(body.requestId))) return send(400, { error: { code: 'invalid_request_id', message: 'Invalid request id.' } });
    const requestId = body.requestId ?? randomBytes(8).toString('hex');
    if (active.has(requestId) || finished.includes(requestId)) return send(409, { error: { code: 'duplicate_request', message: 'This request id was already used.' } });
    if (activeCount(p.id) >= (p.concurrency ?? 2)) return send(429, { error: { code: 'bridge_busy', message: 'Too many outstanding requests for this provider.', retryable: true } });
    const ctl = new AbortController();
    const entry = { ctl, provider: p.id, why: null };
    active.set(requestId, entry);
    res.on('close', () => { if (!res.writableEnded) { entry.why = entry.why ?? 'client_disconnected'; ctl.abort(); } });
    const budget = Math.max(1000, Math.min(maxBudgetMs, Number(body.maxMs) || maxBudgetMs));
    const signal = AbortSignal.any([ctl.signal, AbortSignal.timeout(budget)]);
    const started = Date.now();
    const record = { at: new Date().toISOString(), requestId, provider: p.id, model: body.model };
    try {
      const r = await p.complete({ model: body.model, system: instructions, messages: msgs, signal, options: body.options && typeof body.options === 'object' ? body.options : {} });
      if (ctl.signal.aborted) throw new ProviderError('cancelled', 'The request was cancelled.');
      const meta = { provider: p.id, model: body.model, elapsedMs: Date.now() - started, ...(r.meta ?? {}), requestId, instructionsSha256 };
      try {
        const command = parseCommand(r.text);
        audit({ ...record, outcome: 'command', kind: command.type, normalization: command.protocolNormalization ?? null, meta });
        return send(200, { command, meta });
      } catch (e) {
        const code = e instanceof ProtocolError ? e.code : 'invalid-json';
        audit({ ...record, outcome: 'protocol-error', code, meta });
        return send(200, { protocolError: { code, message: e instanceof ProtocolError ? e.message : 'Unreadable response.' }, raw: String(r.text ?? '').slice(0, 8000), meta });
      }
    } catch (e) {
      let t = asProviderError(e);
      if (entry.why && entry.why !== 'client_disconnected') t = new ProviderError('cancelled', `The request was cancelled (${entry.why}).`);
      else if (signal.aborted && !ctl.signal.aborted) t = new ProviderError('timeout', 'The decision budget ran out before the provider answered.', { retryable: true });
      audit({ ...record, outcome: 'error', error: t.code, elapsedMs: Date.now() - started });
      return send(t.code === 'cancelled' ? 409 : 502, { error: t.toJSON() });
    } finally {
      active.delete(requestId);
      finished.push(requestId); if (finished.length > 1000) finished.shift();
    }
  }

  return {
    server,
    get port() { return boundPort; },
    async listen(host = '127.0.0.1', portOverride) {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(portOverride ?? port, host, resolve); });
      boundPort = server.address().port;
      return boundPort;
    },
    async close() { for (const a of active.values()) a.ctl.abort(); await new Promise((r) => server.close(r)); },
    pairing,
    activeCount: () => active.size,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────
export const defaultStateDir = () => join(homedir(), 'Library', 'Application Support', 'Bloodboard Online');

export async function loadOrCreateCapability(dir) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, 'bridge-capability');
  try { const k = (await readFile(file, 'utf8')).trim(); if (/^[a-f0-9]{64}$/.test(k)) return k; } catch { /* create */ }
  const k = randomBytes(32).toString('hex');
  await writeFile(file, k, { mode: 0o600 });
  await chmod(file, 0o600).catch(() => {});
  return k;
}

async function main(argv) {
  const [cmd = 'serve', ...rest] = argv;
  const opt = (name, d) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : d; };
  const dir = opt('dir', process.env.BLOODBOARD_ONLINE_DIR || defaultStateDir());
  const here = new URL('./', import.meta.url);
  if (cmd === 'serve') {
    const { createSecretStore, keychainEncryption } = await import('./store.mjs');
    const { createDeepSeekProvider } = await import('./providers/deepseek.mjs');
    const { createLunaProvider } = await import('./providers/luna.mjs');
    const secrets = createSecretStore({ dir: join(dir, 'private') });
    const encryption = keychainEncryption();
    const providers = [
      createDeepSeekProvider({ secrets }),
      createLunaProvider({
        loadRuntime: () => import('./vendor/siwc-local/runtime.mjs'), encryption, storageDir: join(dir, 'private'),
        openBrowser: async (u) => { if (process.platform === 'darwin') { const { spawn } = await import('node:child_process'); spawn('open', [u], { stdio: 'ignore', detached: true }).unref(); } },
      }),
    ];
    const instructions = await readFile(new URL('instructions.txt', here), 'utf8');
    const capability = await loadOrCreateCapability(join(dir, 'private'));
    const pairingCode = String(randomInt(0, 100_000_000)).padStart(8, '0');
    await mkdir(join(dir, 'logs'), { recursive: true });
    // ONE shared AI folder (online/aidir.mjs): ~/Library/Application Support/Bloodboard/AI. --ai-dir overrides it for tests only.
    const { ensureAIDir, pendingLegacyFiles } = await import('./aidir.mjs');
    const aiDirs = []; for (let i = 0; i < rest.length; i++) if (rest[i] === '--ai-dir') aiDirs.push(rest[i + 1]);
    if (!aiDirs.length) {
      const r = ensureAIDir();
      aiDirs.push(r.dir);
      const pend = pendingLegacyFiles();
      if (pend.count) console.warn(`WARNING: ${pend.count} coach files in older version-specific AI folders are not in ${r.dir} yet. Run: node ${fileURLToPath(new URL('./aidir.mjs', import.meta.url))} migrate --apply`);
    }
    const bridge = createBridge({
      providers, instructions, capability, pairingCode, port: Number(opt('port', DEFAULT_PORT)), aiDirs, stateDir: dir,
      audit: (e) => { appendFile(join(dir, 'logs', 'bridge-calls.jsonl'), JSON.stringify(e) + '\n').catch(() => {}); },
    });
    const requested = Number(opt('port', DEFAULT_PORT));
    let port;
    try { port = await bridge.listen(); }
    catch (e) {
      // Busy default port: an app-launched bridge falls back to a free port (the app is told the real one); a manual start fails loudly.
      if (e?.code === 'EADDRINUSE' && rest.includes('--auto-port')) port = await bridge.listen('127.0.0.1', 0);
      else throw e;
    }
    const life = await import('./lifecycle.mjs');
    let release;
    try { release = await life.acquireInstance(dir, { port, version: BRIDGE_VERSION }, { replace: rest.includes('--replace') }); }
    catch (e) { await bridge.close(); console.error(e.message); process.exit(e.code === 'ALREADY_RUNNING' ? 3 : 1); }
    let stopping = false;
    const stop = async (why) => { if (stopping) return; stopping = true; await bridge.close().catch(() => {}); await release().catch(() => {}); console.error(`bridge stopped (${why})`); process.exit(0); };
    if (rest.includes('--json')) console.log(life.STARTUP_PREFIX + JSON.stringify({ version: BRIDGE_VERSION, port, pid: process.pid, pairingCode, requestedPort: requested }));
    else {
      console.log(`Bloodboard online-coach bridge ${BRIDGE_VERSION} on http://127.0.0.1:${port}`);
      console.log(`Pairing code (enter it in the game, valid until this bridge stops): ${pairingCode}`);
    }
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => stop(sig));
    const ppid = Number(opt('parent-pid', 0));
    if (ppid) life.watchParent(ppid, stop);
    if (rest.includes('--exit-on-stdin-close')) life.watchStdin(process.stdin, stop);
    return;
  }
  if (cmd === 'install-coach') {
    const { buildCoach } = await import('./build-coach.mjs');
    const provider = opt('provider'); const model = opt('model');
    const dirs = []; for (let i = 0; i < rest.length; i++) if (rest[i] === '--to') dirs.push(rest[i + 1]);
    if (!dirs.length) { const { ensureAIDir } = await import('./aidir.mjs'); dirs.push(ensureAIDir().dir); }
    const out = await buildCoach({ provider, model, stateDir: dir, port: Number(opt('port', DEFAULT_PORT)), targets: dirs });
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  console.error('Usage: bridge.mjs serve|install-coach');
  process.exit(2);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch((e) => { console.error(e?.message ?? e); process.exit(1); });
