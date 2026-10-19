import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDeepSeekProvider } from '../providers/deepseek.mjs';
import { createLunaProvider } from '../providers/luna.mjs';
import { createSecretStore } from '../store.mjs';

const fakeEnc = { id: 'fake', isAvailable: () => true, encrypt: (t) => Buffer.from('ENC:' + Buffer.from(t).toString('base64')), decrypt: (b) => Buffer.from(Buffer.from(b).toString().slice(4), 'base64').toString() };
const KEY = 'sk-test-SECRET-0123456789';
async function ds(handler, opts = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'bb-ds-'));
  const secrets = createSecretStore({ dir, encryption: opts.encryption ?? fakeEnc });
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url, init }); return handler(url, init); };
  const p = createDeepSeekProvider({ secrets, fetchImpl, env: opts.env ?? {} });
  return { p, seen, dir, secrets };
}
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

test('DeepSeek: key is stored encrypted, never in plain text on disk, and status never reveals it', async () => {
  const { p, dir } = await ds(() => json(200, {}));
  await p.setKey(KEY);
  const files = await readdir(dir);
  assert.equal(files.length, 1);
  const stored = await readFile(join(dir, files[0]), 'utf8');
  assert.ok(!stored.includes(KEY) && !Buffer.from(stored, 'base64').toString().includes(KEY), 'ciphertext only');
  const st = await p.status();
  assert.equal(st.configured, true); assert.equal(st.keyStorage, 'keychain');
  assert.ok(!JSON.stringify(st).includes('SECRET'));
  await p.clearKey();
  assert.equal((await readdir(dir)).length, 0); assert.equal((await p.status()).configured, false);
});

test('DeepSeek: without secure storage the key is held in memory only (nothing is written) and says so', async () => {
  const { p, dir } = await ds(() => json(200, {}), { encryption: { id: 'x', isAvailable: () => false } });
  const r = await p.setKey(KEY);
  assert.equal(r.persisted, false); assert.deepEqual(await readdir(dir).catch(() => []), []);
  assert.equal((await p.status()).keyStorage, 'session-memory');
});

test('DeepSeek: model discovery calls GET /models with Bearer auth on the documented base URL and maps the metadata', async () => {
  const { p, seen } = await ds(() => json(200, { object: 'list', data: [{ id: 'm-a', object: 'model', name: 'Model A', context_window: 1000, max_output_tokens: 100, effort: { levels: ['low'] } }, { id: 'm-b' }, null] }));
  await p.setKey(KEY);
  const models = await p.listModels();
  assert.equal(seen[0].url, 'https://api.deepseek.com/models'); assert.equal(seen[0].init.method, 'GET');
  assert.equal(seen[0].init.headers.Authorization, `Bearer ${KEY}`);
  assert.deepEqual(models.map((m) => m.id), ['m-a', 'm-b']); assert.equal(models[0].contextWindow, 1000);
});

test('DeepSeek: a completion sends JSON mode, the stable system block first, no stream, and reports cache and token usage', async () => {
  const { p, seen } = await ds(() => json(200, { model: 'm-a', choices: [{ finish_reason: 'stop', message: { content: '{"type":"act"}' } }], usage: { prompt_tokens: 900, completion_tokens: 20, prompt_tokens_details: { prompt_cache_hit_tokens: 700, prompt_cache_miss_tokens: 200 } } }));
  await p.setKey(KEY);
  const r = await p.complete({ model: 'm-a', system: 'SYS JSON', messages: [{ role: 'user', content: 'ctx' }] });
  const body = JSON.parse(seen[0].init.body);
  assert.equal(seen[0].url, 'https://api.deepseek.com/chat/completions');
  assert.deepEqual(body.response_format, { type: 'json_object' }); assert.equal(body.stream, false);
  assert.deepEqual(body.messages[0], { role: 'system', content: 'SYS JSON' }); assert.equal(body.messages[1].content, 'ctx');
  assert.equal(body.thinking, undefined, 'thinking mode is only sent when configured');
  assert.equal(r.text, '{"type":"act"}'); assert.equal(r.meta.cacheHitTokens, 700); assert.equal(r.meta.promptTokens, 900);
  assert.ok(!seen[0].init.body.includes('SECRET'), 'the key is not in the body');
});

test('DeepSeek: HTTP errors map to stable codes (401/402/422/429/500/503) and carry no provider text', async () => {
  const expect = { 400: 'invalid_parameters', 401: 'invalid_api_key', 402: 'insufficient_balance', 422: 'invalid_parameters', 429: 'rate_limited', 500: 'provider_error', 503: 'provider_overloaded' };
  for (const [status, code] of Object.entries(expect)) {
    const { p } = await ds(() => ({ ok: false, status: Number(status), text: async () => 'RAW PROVIDER TEXT key=' + KEY }));
    await p.setKey(KEY);
    await assert.rejects(p.complete({ model: 'm', system: 's', messages: [{ role: 'user', content: 'x' }] }), (e) => { assert.equal(e.code, code); assert.ok(!e.message.includes('RAW') && !e.message.includes('SECRET')); return true; });
  }
  const { p: noKey } = await ds(() => json(200, {}));
  await assert.rejects(noKey.listModels(), { code: 'api_key_required' });
  const { p: net } = await ds(() => { throw new TypeError('fetch failed'); }); await net.setKey(KEY);
  await assert.rejects(net.listModels(), { code: 'network_error' });
});

test('DeepSeek: truncated output (finish_reason length) and empty content are failures, not decisions', async () => {
  const { p } = await ds(() => json(200, { choices: [{ finish_reason: 'length', message: { content: '{"type":"ac' } }] })); await p.setKey(KEY);
  await assert.rejects(p.complete({ model: 'm', system: 's', messages: [{ role: 'user', content: 'x' }] }), { code: 'truncated_response' });
  const { p: q } = await ds(() => json(200, { choices: [{ finish_reason: 'stop', message: {} }] })); await q.setKey(KEY);
  await assert.rejects(q.complete({ model: 'm', system: 's', messages: [{ role: 'user', content: 'x' }] }), { code: 'invalid_response' });
});

test('DeepSeek: abort cancels the HTTP request', async () => {
  const { p } = await ds((url, init) => new Promise((_, rej) => {
    const abort = () => rej(Object.assign(new Error('x'), { name: 'AbortError' }));
    if (init.signal.aborted) return abort();
    init.signal.addEventListener('abort', abort, { once: true });
  }));
  await p.setKey(KEY);
  const ctl = new AbortController(); const pr = p.complete({ model: 'm', system: 's', messages: [{ role: 'user', content: 'x' }], signal: ctl.signal });
  ctl.abort(); await assert.rejects(pr, { code: 'cancelled' });
});

test('DeepSeek: the environment variable is honoured when nothing is stored, and is reported as such', async () => {
  const { p } = await ds(() => json(200, { data: [] }), { env: { BLOODBOARD_DEEPSEEK_API_KEY: KEY } });
  assert.equal((await p.status()).keyStorage, 'environment'); await p.listModels();
});

// ── Luna (component level: the sign-in runtime is replaced by a fake with the same interface) ──
function fakeChatGPT(state = {}) {
  const calls = [];
  const sess = { status: 'connected', sharing: true, profileLabel: 'Connection 1', identity: { email: 'x@example.test' }, ...state };
  return { calls, make: (config) => ({
    getSession: async () => sess,
    listModels: async () => [{ slug: 'luna-x', displayName: 'Luna X' }],
    streamResponse: async (o) => { calls.push(o); return { text: '{"type":"act","revision":"r","candidateId":0}' }; },
    signIn: async () => { await config.openBrowser('https://auth.example.test/authorize?x=1'); return sess; },
    cancelSignIn: () => {}, disconnect: async () => { sess.status = 'disconnected'; sess.sharing = false; },
  }) };
}
const lunaWith = (f, enc = fakeEnc) => createLunaProvider({ createChatGPT: f.make, encryption: enc, storageDir: '/tmp/x' });

test('Luna: status reports the subscription route with no API key or paid fallback; models come from the account', async () => {
  const f = fakeChatGPT(); const p = lunaWith(f);
  const st = await p.status();
  assert.equal(st.connected, true); assert.equal(st.apiKeyUsed, false); assert.equal(st.paidApiFallback, false); assert.equal(st.route, 'official-chatgpt-plan-oauth');
  assert.deepEqual((await p.listModels()).map((m) => m.id), ['luna-x']);
});

test('Luna: a model that the account does not list is refused before any request; a listed one goes through the subscription runtime', async () => {
  const f = fakeChatGPT(); const p = lunaWith(f);
  await assert.rejects(p.complete({ model: 'not-listed', system: 's', messages: [{ role: 'user', content: 'x' }] }), { code: 'model_not_available_on_account' });
  assert.equal(f.calls.length, 0);
  const r = await p.complete({ model: 'luna-x', system: 'SYS', messages: [{ role: 'user', content: 'x' }] });
  assert.equal(f.calls[0].instructions, 'SYS'); assert.equal(f.calls[0].model, 'luna-x'); assert.match(r.text, /candidateId/);
});

test('Luna: sign-in is non-blocking and exposes the authorization URL to the paired UI; disconnected state blocks requests', async () => {
  const f = fakeChatGPT({ status: 'disconnected', sharing: false }); const p = lunaWith(f);
  const s = await p.startSignIn();
  assert.match(s.authUrl, /^https:\/\/auth\.example\.test\//);
  const st = await p.status(); assert.equal(st.connected, false);
});

test('Luna: no secure credential storage means the route is reported unavailable (nothing is stored in plain text)', async () => {
  const f = fakeChatGPT(); const p = lunaWith(f, { id: 'x', isAvailable: () => false });
  const st = await p.status();
  assert.equal(st.connected, false); assert.equal(st.unavailable.code, 'credential_protection_unavailable');
});

test('Luna: a missing sign-in runtime is reported plainly instead of failing the bridge', async () => {
  const p = createLunaProvider({ loadRuntime: async () => { throw new Error('missing'); }, encryption: fakeEnc, storageDir: '/tmp/x' });
  const st = await p.status(); assert.equal(st.unavailable.code, 'runtime_unavailable');
});

test('Luna: runtime errors are mapped to stable codes without leaking messages', async () => {
  const f = fakeChatGPT(); const mk = f.make;
  f.make = (c) => ({ ...mk(c), streamResponse: async () => { throw Object.assign(new Error('token=SECRETTOKEN'), { code: 'sign_in_required' }); } });
  const p = createLunaProvider({ createChatGPT: f.make, encryption: fakeEnc, storageDir: '/tmp/x' });
  await assert.rejects(p.complete({ model: 'luna-x', system: 's', messages: [{ role: 'user', content: 'x' }] }), (e) => e.code === 'sign_in_required');
});
