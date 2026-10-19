import http from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridge } from '../bridge.mjs';
import { createMockProvider } from '../providers/mock.mjs';
import { ProviderError } from '../providers/errors.mjs';

const CAP = 'a'.repeat(64);
async function start(providers, extra = {}) {
  const audit = [];
  const b = createBridge({ providers, instructions: 'Return JSON.', capability: CAP, pairingCode: '12345678', port: 0, audit: (e) => audit.push(e), ...extra });
  const port = await b.listen();
  const call = (path, { method = 'GET', body, headers = {}, auth = true } = {}) => fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers: { ...(auth ? { Authorization: `Bearer ${CAP}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { b, port, call, audit };
}
const msg = [{ role: 'user', content: '{}' }];

test('security: no pairing, foreign origin, foreign host and wrong content-type are refused before any provider is used', async () => {
  const p = createMockProvider({ responses: ['{"type":"act","revision":"r","candidateId":0}'] });
  const { b, call, port } = await start([p]);
  try {
    assert.equal((await call('/health', { auth: false })).status, 403);
    assert.equal((await call('/health', { headers: { Origin: 'https://example.test' } })).status, 403);
    const raw = await new Promise((res) => { const rq = http.request({ host: '127.0.0.1', port, path: '/health', headers: { Host: 'evil.test', Authorization: `Bearer ${CAP}` } }, (r) => { r.resume(); res(r.statusCode); }); rq.end(); });
    assert.equal(raw, 403, 'DNS-rebinding style Host header');
    assert.equal((await call('/decision', { method: 'POST', body: { provider: 'mock', model: 'm', messages: msg }, auth: false })).status, 403);
    const r = await fetch(`http://127.0.0.1:${port}/decision`, { method: 'POST', headers: { Authorization: `Bearer ${CAP}`, 'Content-Type': 'text/plain' }, body: '{}' });
    assert.equal(r.status, 415);
    assert.equal(p.calls.length, 0, 'the provider was never called');
    assert.equal((await call('/health')).status, 200);
    const pre = await call('/decision', { method: 'OPTIONS', auth: false, headers: { Origin: 'null' } });
    assert.equal(pre.status, 204);
  } finally { await b.close(); }
});

test('pairing: correct code returns the capability, wrong codes lock out after five attempts; /ping reveals nothing private', async () => {
  const { b, call } = await start([createMockProvider()]);
  try {
    const ping = await (await call('/ping', { auth: false })).json();
    assert.deepEqual(Object.keys(ping).sort(), ['bloodboardBridge', 'pairingRequired', 'protocol', 'version']);
    for (let i = 0; i < 5; i++) assert.equal((await call('/pair', { method: 'POST', body: { code: '00000000' }, auth: false })).status, 403);
    assert.equal((await call('/pair', { method: 'POST', body: { code: '12345678' }, auth: false })).status, 429, 'locked even for the right code');
  } finally { await b.close(); }
  const s2 = await start([createMockProvider()]);
  try {
    const r = await s2.call('/pair', { method: 'POST', body: { code: '12345678' }, auth: false });
    assert.equal(r.status, 200); assert.equal((await r.json()).capability, CAP);
  } finally { await s2.b.close(); }
});

test('decision: returns a parsed command with provider/model meta and a content-free audit record', async () => {
  const p = createMockProvider({ responses: ['{"type":"act","revision":"r","candidateId":0,"why":"go"}'] });
  const { b, call, audit } = await start([p]);
  try {
    const r = await call('/decision', { method: 'POST', body: { provider: 'mock', model: 'mock-1', messages: msg, requestId: 'req-1' } });
    const j = await r.json();
    assert.equal(r.status, 200); assert.equal(j.command.candidateId, 0); assert.equal(j.meta.provider, 'mock'); assert.equal(j.meta.model, 'mock-1');
    assert.equal(audit.length, 1); assert.equal(audit[0].outcome, 'command');
    assert.ok(!JSON.stringify(audit).includes('"why"'), 'the audit log holds no decision content');
    assert.equal(p.calls[0].system, 'Return JSON.');
  } finally { await b.close(); }
});

test('decision: unparseable text is a protocol error (HTTP 200) with the raw text, never an invented command', async () => {
  const p = createMockProvider({ responses: ['I think we should blitz!'] });
  const { b, call } = await start([p]);
  try {
    const j = await (await call('/decision', { method: 'POST', body: { provider: 'mock', model: 'm', messages: msg } })).json();
    assert.ok(j.protocolError); assert.equal(j.command, undefined); assert.match(j.raw, /blitz/);
  } finally { await b.close(); }
});

test('decision: duplicate request ids are rejected (replayed or doubled commands)', async () => {
  const p = createMockProvider({ responses: ['{"type":"query","service":"a","args":[]}', '{"type":"query","service":"a","args":[]}'] });
  const { b, call } = await start([p]);
  try {
    const body = { provider: 'mock', model: 'm', messages: msg, requestId: 'same-id' };
    assert.equal((await call('/decision', { method: 'POST', body })).status, 200);
    assert.equal((await call('/decision', { method: 'POST', body })).status, 409);
    assert.equal(p.calls.length, 1);
  } finally { await b.close(); }
});

test('decision: bad inputs are rejected before the provider is called', async () => {
  const p = createMockProvider();
  const { b, call } = await start([p]);
  try {
    for (const body of [{ provider: 'nope', model: 'm', messages: msg }, { provider: 'mock', messages: msg }, { provider: 'mock', model: 'm', messages: [] },
      { provider: 'mock', model: 'm', messages: [{ role: 'system', content: 'x' }] }, { provider: 'mock', model: 'm', messages: msg, requestId: 'bad id!' }]) {
      const r = await call('/decision', { method: 'POST', body });
      assert.ok(r.status === 400, JSON.stringify(body) + ' -> ' + r.status);
    }
    assert.equal(p.calls.length, 0);
  } finally { await b.close(); }
});

test('cancel: /cancel aborts the in-flight provider call and a client disconnect does too', async () => {
  const p = createMockProvider({ delayMs: 5000, responses: ['{"type":"query","service":"a","args":[]}', '{"type":"query","service":"a","args":[]}'] });
  const { b, call, port } = await start([p]);
  try {
    const pending = call('/decision', { method: 'POST', body: { provider: 'mock', model: 'm', messages: msg, requestId: 'slow-1' } });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(b.activeCount(), 1);
    assert.equal((await (await call('/cancel', { method: 'POST', body: { requestId: 'slow-1' } })).json()).cancelled, true);
    const r = await pending;
    assert.equal(r.status, 409); assert.equal((await r.json()).error.code, 'cancelled');
    assert.equal(b.activeCount(), 0);
    // disconnect (as happens when the host terminates the coach worker)
    const ctl = new AbortController();
    const dropped = fetch(`http://127.0.0.1:${port}/decision`, { method: 'POST', signal: ctl.signal, headers: { Authorization: `Bearer ${CAP}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'mock', model: 'm', messages: msg, requestId: 'slow-2' }) }).catch(() => 'aborted');
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(b.activeCount(), 1);
    ctl.abort(); await dropped;
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(b.activeCount(), 0, 'the provider request was aborted when the caller vanished');
  } finally { await b.close(); }
});

test('budget: the total request budget is enforced and reported as a timeout, not as a model answer', async () => {
  const p = createMockProvider({ delayMs: 5000 });
  const { b, call } = await start([p]);
  try {
    const t0 = Date.now();
    const r = await call('/decision', { method: 'POST', body: { provider: 'mock', model: 'm', messages: msg, maxMs: 1000 } });
    assert.equal(r.status, 502); assert.equal((await r.json()).error.code, 'timeout');
    assert.ok(Date.now() - t0 < 3000);
  } finally { await b.close(); }
});

test('concurrency: a provider limit returns 429 (retryable) instead of queueing without bound; providers are independent', async () => {
  const slow = createMockProvider({ id: 'slow', delayMs: 800, concurrency: 1, responses: ['{"type":"query","service":"a","args":[]}'] });
  const other = createMockProvider({ id: 'other', responses: ['{"type":"query","service":"a","args":[]}'] });
  const { b, call } = await start([slow, other]);
  try {
    const first = call('/decision', { method: 'POST', body: { provider: 'slow', model: 'm', messages: msg } });
    await new Promise((r) => setTimeout(r, 100));
    const second = await call('/decision', { method: 'POST', body: { provider: 'slow', model: 'm', messages: msg } });
    assert.equal(second.status, 429);
    const third = await call('/decision', { method: 'POST', body: { provider: 'other', model: 'm', messages: msg } });
    assert.equal(third.status, 200, 'another provider is unaffected');
    await first;
  } finally { await b.close(); }
});

test('provider errors map to 502 with a stable code and never carry raw provider output', async () => {
  const p = createMockProvider({ responses: [new ProviderError('rate_limited', 'slow down', { retryable: true, status: 429 })] });
  const { b, call } = await start([p]);
  try {
    const r = await call('/decision', { method: 'POST', body: { provider: 'mock', model: 'm', messages: msg } });
    const j = await r.json();
    assert.equal(r.status, 502); assert.deepEqual(j.error, { code: 'rate_limited', message: 'slow down', retryable: true, status: 429 });
  } finally { await b.close(); }
});
