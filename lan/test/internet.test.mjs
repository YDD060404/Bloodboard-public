import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import { E, CLIENT } from './helpers.mjs';
import { createServer } from '../server.mjs';

const serverFile = fileURLToPath(new URL('../server.mjs', import.meta.url));
function selfSigned() {
  const d = mkdtempSync(join(tmpdir(), 'bb-tls-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(d, 'k.pem'), '-out', join(d, 'c.pem'), '-days', '2', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
  return { key: readFileSync(join(d, 'k.pem')), cert: readFileSync(join(d, 'c.pem')) };
}
const web = () => { const w = mkdtempSync(join(tmpdir(), 'bb-web-')); writeFileSync(join(w, 'index.html'), '<title>x</title>'); return w; };
const j = (base, path, { method = 'GET', body, headers = {} } = {}) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null), headers: r.headers }));

test('internet: HTTPS serving, HSTS, and the mode/secure flags in the ping', async () => {
  const tls = selfSigned();
  const srv = await createServer({ engine: E, code: 'INETROOM', webDir: web(), mode: 'internet', tls, seed: () => 5 });
  const port = await srv.listen(0, '127.0.0.1');
  try {
    const out = await new Promise((ok, no) => https.get({ host: '127.0.0.1', port, path: '/api/ping', ca: tls.cert, servername: 'localhost' }, (r) => { let t = ''; r.on('data', (c) => (t += c)); r.on('end', () => ok({ headers: r.headers, body: JSON.parse(t) })); }).on('error', no));
    assert.equal(out.body.mode, 'internet'); assert.equal(out.body.secure, true);
    assert.match(out.headers['strict-transport-security'], /max-age/);
    assert.equal(out.headers['x-frame-options'], 'DENY');
    assert.ok(!JSON.stringify(out.body).includes('INETROOM'));
    // plain HTTP against the TLS port does not yield a working API
    await assert.rejects(fetch(`http://127.0.0.1:${port}/api/ping`));
  } finally { await srv.close(); }
});

test('internet: per-address rate limits (join and general), independent per client address only behind a trusted proxy', async () => {
  const srv = await createServer({ engine: E, code: 'INETROOM', webDir: web(), mode: 'internet', ratePerMinute: 6, joinsPerMinute: 3, seed: () => 5 });
  const port = await srv.listen(0, '127.0.0.1'); const base = `http://127.0.0.1:${port}`;
  try {
    const join = (h = {}) => j(base, '/api/join', { method: 'POST', body: { code: 'wrong', seat: 'B', name: 'x', client: CLIENT }, headers: h });
    const codes = []; for (let i = 0; i < 5; i++) codes.push((await join()).status);
    assert.deepEqual(codes.slice(0, 3), [403, 403, 403]); assert.equal(codes[3], 429, 'the 4th join attempt in a minute is limited');
    // X-Forwarded-For is ignored without --trust-proxy, so a spoofed address does not reset the limiter
    assert.equal((await join({ 'X-Forwarded-For': '9.9.9.9' })).status, 429);
    const ping = await j(base, '/api/ping'); assert.equal(ping.status, 200, 'ping is never rate limited (a client must be able to tell the host is up)');
    let last; for (let i = 0; i < 8; i++) last = (await j(base, '/api/state?token=bad')).status; assert.equal(last, 429);
  } finally { await srv.close(); }
  const srv2 = await createServer({ engine: E, code: 'INETROOM', webDir: web(), mode: 'internet', trustProxy: true, joinsPerMinute: 2, seed: () => 5 });
  const p2 = await srv2.listen(0, '127.0.0.1'); const b2 = `http://127.0.0.1:${p2}`;
  try {
    const join = (ip) => j(b2, '/api/join', { method: 'POST', body: { code: 'wrong', seat: 'B', name: 'x', client: CLIENT }, headers: { 'X-Forwarded-For': ip } });
    for (let i = 0; i < 3; i++) await join('1.1.1.1');
    assert.equal((await join('1.1.1.1')).status, 429); assert.equal((await join('2.2.2.2')).status, 403, 'another client address behind the proxy has its own allowance');
    const sec = await j(b2, '/api/ping', { headers: { 'X-Forwarded-Proto': 'https' } }); assert.equal(sec.json.secure, true);
  } finally { await srv2.close(); }
});

test('internet: open event streams per address are capped; an idle room expires but can still be pinged', async () => {
  const srv = await createServer({ engine: E, code: 'INETROOM', webDir: web(), mode: 'internet', maxStreamsPerIp: 2, seed: () => 5 });
  const port = await srv.listen(0, '127.0.0.1'); const base = `http://127.0.0.1:${port}`;
  const ctls = [];
  try {
    const a = (await j(base, '/api/join', { method: 'POST', body: { code: 'INETROOM', seat: 'A', name: 'Ann', client: CLIENT } })).json;
    const open = async () => { const c = new AbortController(); ctls.push(c); const r = await fetch(`${base}/api/events?token=${a.token}`, { signal: c.signal }); return r.status; };
    assert.equal(await open(), 200); assert.equal(await open(), 200); assert.equal(await open(), 429);
    for (const c of ctls) c.abort();
    srv.expireNow();
    const ping = await j(base, '/api/ping'); assert.equal(ping.json.expired, true);
    const st = await j(base, '/api/state?token=' + a.token); assert.equal(st.status, 410); assert.equal(st.json.code, 'expired');
  } finally { await srv.close(); }
});

test('internet: the command line refuses plain HTTP on a public address, and offers TLS or a loopback tunnel', () => {
  const r = spawnSync(process.execPath, [serverFile, '--mode', 'internet', '--host', '0.0.0.0', '--port', '0'], { encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 2); assert.match(r.stderr, /plain HTTP/);
  const bad = spawnSync(process.execPath, [serverFile, '--mode', 'nonsense'], { encoding: 'utf8', timeout: 20000 });
  assert.equal(bad.status, 2);
});
