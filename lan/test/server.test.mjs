import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { E, CLIENT, makeMatch, aiIntent, cid } from './helpers.mjs';
import { createServer } from '../server.mjs';

async function boot(extra = {}) {
  const web = mkdtempSync(join(tmpdir(), 'bb-web-'));
  writeFileSync(join(web, 'index.html'), '<!doctype html><title>bb</title>');
  mkdirSync(join(web, 'sub')); writeFileSync(join(web, 'sub', 'a.js'), 'x');
  const srv = await createServer({ engine: E, code: 'NETROOM2', webDir: web, seed: () => 99, ...extra });
  const port = await srv.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${port}`;
  const post = async (path, body, headers = {}) => { const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json() }; };
  const get = async (path, headers = {}) => { const r = await fetch(base + path, { headers }); return { status: r.status, text: await r.text(), headers: r.headers }; };
  return { srv, base, port, post, get, web };
}

/** An SSE reader: collects messages, can wait for one matching a predicate. */
function sse(base, token) {
  const msgs = []; const waiters = []; const ctl = new AbortController();
  const done = (async () => {
    const r = await fetch(`${base}/api/events?token=${token}`, { signal: ctl.signal }).catch(() => null);
    if (!r || !r.body) return;
    const dec = new TextDecoder(); let buf = '';
    try { for await (const chunk of r.body) { buf += dec.decode(chunk, { stream: true }); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const block = buf.slice(0, i); buf = buf.slice(i + 2); const line = block.split('\n').find((l) => l.startsWith('data: ')); if (line) { const m = JSON.parse(line.slice(6)); msgs.push(m); waiters.splice(0).forEach((w) => w()); } } } } catch { /* aborted */ }
  })();
  const waitFor = async (pred, ms = 8000) => { const t0 = Date.now(); for (;;) { const m = msgs.find(pred); if (m) return m; if (Date.now() - t0 > ms) throw new Error('timeout waiting for SSE message'); await new Promise((ok) => { waiters.push(ok); setTimeout(ok, 100); }); } };
  return { msgs, waitFor, close: () => { ctl.abort(); return done; } };
}

test('http: ping, join, origin and size limits, static files without traversal', async () => {
  const s = await boot();
  try {
    const ping = await s.get('/api/ping'); const pj = JSON.parse(ping.text);
    assert.equal(pj.bloodboardLan, true); assert.equal(pj.protocol, 1); assert.ok(!('code' in pj) && !JSON.stringify(pj).includes('NETROOM2'));
    assert.equal((await s.post('/api/join', { code: 'nope', seat: 'A', name: 'x', client: CLIENT })).status, 403);
    const a = await s.post('/api/join', { code: 'netroom2', seat: 'A', name: 'Ann', client: CLIENT });
    assert.equal(a.status, 200); assert.equal(a.json.seat, 'A');
    assert.equal((await s.post('/api/join', { code: 'NETROOM2', seat: 'B', name: 'Bob', client: { ...CLIENT, rulesHash: 'other' } })).status, 409, 'incompatible client is refused with 409');
    const evil = await s.post('/api/join', { code: 'NETROOM2', seat: 'B', name: 'Bob', client: CLIENT }, { Origin: 'http://evil.example' });
    assert.equal(evil.status, 403, 'another website cannot drive the server from a visitor\'s browser');
    const big = await fetch(`${s.base}/api/command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pad: 'x'.repeat(70_000) }) });
    assert.equal(big.status, 413);
    assert.equal((await s.get('/')).status, 200);
    assert.equal((await s.get('/sub/a.js')).text, 'x');
    const trav = await new Promise((ok) => { const rq = http.request({ host: '127.0.0.1', port: s.port, path: '/%2e%2e/%2e%2e/etc/passwd' }, (r) => { r.resume(); ok(r.statusCode); }); rq.end(); });
    assert.ok([403, 404].includes(trav), `traversal refused (${trav})`);
    assert.equal((await s.get('/api/unknown')).status, 404);
  } finally { await s.srv.close(); }
});

test('http: two clients over SSE play commands; the opponent receives the same update; duplicates, stale and wrong-seat commands are refused; no seed on the wire', async () => {
  const s = await boot();
  try {
    const A = (await s.post('/api/join', { code: 'NETROOM2', seat: 'A', name: 'Ann', client: CLIENT })).json;
    const B = (await s.post('/api/join', { code: 'NETROOM2', seat: 'B', name: 'Bob', client: CLIENT })).json;
    const ea = sse(s.base, A.token), eb = sse(s.base, B.token);
    await ea.waitFor((m) => m.type === 'snapshot'); await eb.waitFor((m) => m.type === 'snapshot');
    assert.equal((await s.post('/api/start', { token: B.token, state: makeMatch(7) })).status, 403);
    const st = await s.post('/api/start', { token: A.token, state: makeMatch(7) });
    assert.equal(st.status, 200);
    const sa = await ea.waitFor((m) => m.type === 'snapshot' && m.started); await eb.waitFor((m) => m.type === 'snapshot' && m.started);
    assert.equal(sa.state.rng.seed, 0);
    const id = cid();
    const c1 = await s.post('/api/command', { token: B.token, commandId: id, baseRev: 0, kind: 'action', input: { kind: 'pregame' } });
    assert.equal(c1.status, 200);
    const ua = await ea.waitFor((m) => m.type === 'update' && m.rev === 1); const ub = await eb.waitFor((m) => m.type === 'update' && m.rev === 1);
    assert.equal(JSON.stringify(ua), JSON.stringify(ub), 'both coaches receive the identical update');
    assert.equal(ua.by, 'B'); assert.ok(Array.isArray(ua.events) && Array.isArray(ua.logEntries) && ua.logFrom === 0);
    const dup = await s.post('/api/command', { token: B.token, commandId: id, baseRev: 0, kind: 'action', input: { kind: 'pregame' } });
    assert.equal(dup.status, 200); assert.equal(dup.json.duplicate, true);
    const stale = await s.post('/api/command', { token: A.token, commandId: cid(), baseRev: 0, kind: 'action', input: { kind: 'nextDrive' } });
    assert.equal(stale.status, 409); assert.equal(stale.json.code, 'stale'); assert.equal(stale.json.rev, 1);
    const snap = await s.get(`/api/state?token=${A.token}`); assert.equal(JSON.parse(snap.text).rev, 1);
    assert.equal((await s.get('/api/state?token=bad')).status, 401);
    assert.ok(!JSON.stringify([...ea.msgs, ...eb.msgs]).includes('"seed":99'), 'the server\'s seed never appears on the wire');
    // a client whose connection dropped reconnects and receives the current snapshot
    await eb.close();
    const eb2 = sse(s.base, B.token);
    const re = await eb2.waitFor((m) => m.type === 'snapshot');
    assert.equal(re.rev, 1); assert.equal(re.seat, 'B');
    const pres = await ea.waitFor((m) => m.type === 'presence' && m.seats.B?.connected === true && ea.msgs.filter((x) => x.type === 'presence').length >= 2);
    assert.ok(pres);
    const hist = await s.get(`/api/history?token=${A.token}`);
    assert.equal(hist.status, 409, 'no history before the match has real content');
    await ea.close(); await eb2.close();
  } finally { await s.srv.close(); }
});

test('http: a client that applies updates keeps a faithful mirror through a long exchange and the exported history verifies', async () => {
  const s = await boot();
  try {
    const A = (await s.post('/api/join', { code: 'NETROOM2', seat: 'A', name: 'Ann', client: CLIENT })).json;
    const B = (await s.post('/api/join', { code: 'NETROOM2', seat: 'B', name: 'Bob', client: CLIENT })).json;
    const tokens = { A: A.token, B: B.token };
    const mirror = { A: null, B: null };
    const feeds = ['A', 'B'].map((seat) => { const c = sse(s.base, tokens[seat]); return { seat, c }; });
    await s.post('/api/start', { token: A.token, state: makeMatch(21) });
    // each seat applies what it receives (snapshots and wire updates), exactly as the game client does
    const pump = () => { for (const { seat, c } of feeds) for (const m of c.msgs.splice(0)) { if (m.type === 'snapshot' && m.state) mirror[seat] = m.state; else if (m.type === 'update') { const r = E.applyWireUpdate(mirror[seat], m); assert.ok(r.ok, r.reason); mirror[seat] = r.state; } } };
    let rev = 0;
    for (let i = 0; i < 70; i++) {
      await new Promise((ok) => setTimeout(ok, 25)); pump();
      const w = E.waitingFor(mirror.A); const seat = w ?? 'A';
      const intent = aiIntent(mirror[seat], seat); assert.ok(intent);
      const r = await s.post('/api/command', { token: tokens[seat], commandId: cid(), baseRev: rev, kind: intent.kind, input: intent.input, choice: intent.choice });
      assert.equal(r.status, 200, JSON.stringify(r.json)); rev = r.json.rev;
    }
    await new Promise((ok) => setTimeout(ok, 200)); pump();
    for (const seat of ['A', 'B']) { assert.equal(mirror[seat].log.length, s.srv.room.state.log.length); assert.equal(mirror[seat].rng.seed, 0); }
    const early = await s.get(`/api/history?token=${B.token}`);
    assert.equal(early.status, 409); assert.equal(JSON.parse(early.text).code, 'not_finished');
    const imp = E.importHistories(s.srv.room.history({ partial: true }).text); assert.ok(imp.ok && imp.verified.length === 1);
    assert.equal(imp.verified[0].source, 'multiplayer');
    for (const f of feeds) await f.c.close();
  } finally { await s.srv.close(); }
});
