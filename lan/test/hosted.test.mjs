// Hosted deployment (free host, ephemeral disk): durable store, write-ahead commits, cold-start recovery, reset, hosted CLI guards.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { E, CLIENT, makeMatch, aiIntent, cid, here } from './helpers.mjs';
import { createServer } from '../server.mjs';
import { fakeUpstash } from './fake-upstash.mjs';
import { upstashStore, sealedStore, deriveKey, memoryStore, openLine } from '../store.mjs';

const CODE = 'HOSTED22';
const mkStore = (fu) => sealedStore(upstashStore({ url: fu.url, token: 'tok-test', retries: 0, timeoutMs: 2000 }), deriveKey(CODE));
async function boot(fu, extra = {}) {
  const srv = await createServer({ engine: E, code: CODE, store: mkStore(fu), mode: 'internet', trustProxy: true, seed: () => 4242, ratePerMinute: 100000, joinsPerMinute: 100000, ...extra });
  const port = await srv.listen(0, '127.0.0.1'); const base = `http://127.0.0.1:${port}`;
  const post = async (path, body) => { const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json() }; };
  const get = async (path) => { const r = await fetch(base + path); return { status: r.status, json: await r.json() }; };
  return { srv, base, post, get };
}
async function seat(s, which, name) { const r = await s.post('/api/join', { code: CODE, seat: which, name, client: CLIENT }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json.token; }
/** Play one move for whoever is to act, through HTTP, from a client-side view of the public state. */
async function playOne(s, ta, tb, commandId = cid()) {
  const snapA = (await s.get(`/api/state?token=${ta}`)).json; const w = snapA.waitingFor ?? 'A';
  const tok = w === 'B' ? tb : ta; const snap = w === 'B' ? (await s.get(`/api/state?token=${tb}`)).json : snapA;
  const it = aiIntent(snap.state, w === 'B' ? 'B' : 'A') ?? aiIntent(snap.state, 'A');
  const r = await s.post('/api/command', { token: tok, commandId, baseRev: snap.rev, ...it });
  return { r, rev: snap.rev, commandId, tok, it };
}
async function started(fu) {
  const s = await boot(fu); const ta = await seat(s, 'A', 'Ann'); const tb = await seat(s, 'B', 'Bob');
  const st = await s.post('/api/start', { token: ta, state: makeMatch(5) }); assert.equal(st.status, 200, JSON.stringify(st.json));
  return { s, ta, tb };
}

test('store: journal lines are sealed (no room code, seed, team or token text at rest) and open with the right key only', async () => {
  const fu = await fakeUpstash();
  try {
    const { s, ta } = await started(fu);
    for (let i = 0; i < 3; i++) await playOne(s, ta, ta);
    const lines = fu.db.get('bloodboard:room:current');
    assert.ok(lines.length >= 5);
    const all = lines.join('\n');
    assert.ok(lines.every((l) => l.startsWith('e1.')) && !all.includes(CODE) && !all.includes('"seed"') && !all.includes('Ann'), 'nothing readable at rest');
    assert.ok(openLine(deriveKey(CODE), lines[0]).includes('codeHash'));
    assert.throws(() => openLine(deriveKey('WRONGCODE'), lines[0]));
    await s.srv.close();
  } finally { await fu.close(); }
});

test('cold start: a new server process (empty disk) replays the store to the identical state; tokens and idempotency survive; play continues', async () => {
  const fu = await fakeUpstash();
  try {
    const { s, ta, tb } = await started(fu);
    let last;
    for (let i = 0; i < 30; i++) last = await playOne(s, ta, tb);
    assert.equal(last.r.status, 200);
    const before = (await s.get(`/api/state?token=${ta}`)).json;
    await s.srv.close(); // the free host goes to sleep: process and disk are gone
    const s2 = await boot(fu);
    const ping = (await s2.get('/api/ping')).json;
    assert.equal(ping.started, true); assert.equal(ping.rev, before.rev); assert.equal(ping.resumedFrom, true); assert.equal(ping.store.durable, true);
    const after = (await s2.get(`/api/state?token=${ta}`)).json;
    assert.equal(JSON.stringify(after.state), JSON.stringify(before.state), 'identical authoritative state (dice, pending decision, revision)');
    assert.equal((await s2.get(`/api/state?token=${tb}`)).status, 200, 'the other seat token still works');
    const dup = await s2.post('/api/command', { token: last.tok, commandId: last.commandId, baseRev: last.rev, ...last.it });
    assert.equal(dup.status, 200); assert.equal(dup.json.duplicate, true, 'a retry of the command whose answer was lost is acknowledged once, not applied twice');
    assert.equal((await s2.get('/api/ping')).json.rev, before.rev);
    const next = await playOne(s2, ta, tb); assert.equal(next.r.status, 200, JSON.stringify(next.r.json));
    assert.equal((await s2.get('/api/ping')).json.rev, before.rev + 1);
    await s2.srv.close();
  } finally { await fu.close(); }
});

test('outage: a command is refused with a retryable 503, nothing changes, nobody is told; the retry after recovery applies exactly once', async () => {
  const fu = await fakeUpstash();
  try {
    const { s, ta, tb } = await started(fu);
    await playOne(s, ta, tb);
    const events = []; const ctl = new AbortController();
    const rdr = fetch(`${s.base}/api/events?token=${tb}`, { signal: ctl.signal }).then(async (r) => { const dec = new TextDecoder(); for await (const c of r.body) for (const l of dec.decode(c).split('\n')) if (l.startsWith('data: ')) events.push(JSON.parse(l.slice(6))); }).catch(() => {});
    await new Promise((ok) => setTimeout(ok, 300));
    const rev0 = (await s.get('/api/ping')).json.rev; const n0 = events.length;
    fu.st.down = true;
    const bad = await playOne(s, ta, tb);
    assert.equal(bad.r.status, 503); assert.equal(bad.r.json.code, 'store_unavailable'); assert.equal(bad.r.json.retryable, true);
    assert.equal((await s.get('/api/ping')).json.rev, rev0, 'the move was rolled back');
    await new Promise((ok) => setTimeout(ok, 200));
    assert.equal(events.slice(n0).filter((e) => e.type === 'update').length, 0, 'the other player was not told about a move that was not saved');
    fu.st.down = false;
    const again = await s.post('/api/command', { token: bad.tok, commandId: bad.commandId, baseRev: bad.rev, ...bad.it });
    assert.equal(again.status, 200, JSON.stringify(again.json));
    assert.equal((await s.get('/api/ping')).json.rev, rev0 + 1);
    const again2 = await s.post('/api/command', { token: bad.tok, commandId: bad.commandId, baseRev: bad.rev, ...bad.it });
    assert.equal(again2.json.duplicate, true); assert.equal((await s.get('/api/ping')).json.rev, rev0 + 1, 'exactly once');
    await new Promise((ok) => setTimeout(ok, 200));
    assert.equal(events.slice(n0).filter((e) => e.type === 'update').length, 1, 'one update after the durable write');
    ctl.abort(); await rdr; await s.srv.close();
  } finally { await fu.close(); }
});

test('a wrong room code at boot refuses to open the stored match; a start/join during an outage changes nothing', async () => {
  const fu = await fakeUpstash();
  try {
    const { s } = await started(fu); await s.srv.close();
    await assert.rejects(() => createServer({ engine: E, code: 'ANOTHER22', store: sealedStore(upstashStore({ url: fu.url, token: 'tok-test', retries: 0 }), deriveKey('ANOTHER22')), mode: 'internet' }), /./);
    const fu2 = await fakeUpstash();
    try {
      const s3 = await boot(fu2);
      fu2.st.down = true;
      const j = await s3.post('/api/join', { code: CODE, seat: 'A', name: 'Eve', client: CLIENT });
      assert.equal(j.status, 503); assert.equal(j.json.retryable, true);
      fu2.st.down = false;
      assert.equal((await s3.get('/api/ping')).json.seats.A, null, 'the failed join left no seat behind');
      await seat(s3, 'A', 'Eve'); // retry succeeds and the header is persisted first
      assert.ok(fu2.db.get('bloodboard:room:current').length >= 2);
      await s3.srv.close();
    } finally { await fu2.close(); }
  } finally { await fu.close(); }
});

test('reset: only the host, not mid-match without abandon; the old match is archived (not deleted); old clients are told; a new room starts empty', async () => {
  const fu = await fakeUpstash();
  try {
    const { s, ta, tb } = await started(fu);
    await playOne(s, ta, tb);
    assert.equal((await s.post('/api/reset', { token: tb, abandon: true })).status, 403);
    assert.equal((await s.post('/api/reset', { token: ta })).status, 409);
    const events = []; const ctl = new AbortController();
    const rdr = fetch(`${s.base}/api/events?token=${tb}`, { signal: ctl.signal }).then(async (r) => { const dec = new TextDecoder(); for await (const c of r.body) for (const l of dec.decode(c).split('\n')) if (l.startsWith('data: ')) events.push(JSON.parse(l.slice(6))); }).catch(() => {});
    await new Promise((ok) => setTimeout(ok, 300));
    const r = await s.post('/api/reset', { token: ta, abandon: true }); assert.equal(r.status, 200, JSON.stringify(r.json));
    await new Promise((ok) => setTimeout(ok, 200));
    assert.ok(events.some((e) => e.type === 'error' && e.code === 'room_reset'));
    const arch = [...fu.db.keys()].filter((k) => k.includes(':archive:')); assert.equal(arch.length, 1); assert.ok(fu.db.get(arch[0]).length >= 5, 'the old match is kept in the archive');
    const ping = (await s.get('/api/ping')).json; assert.equal(ping.started, false); assert.equal(ping.seats.A, null);
    assert.equal((await s.get(`/api/state?token=${ta}`)).status, 401, 'old tokens no longer work; players join again with the code');
    ctl.abort(); await rdr; await s.srv.close();
  } finally { await fu.close(); }
});

test('hosted CLI refuses to run without a room code or a durable store (a host that loses its disk must not silently lose matches)', () => {
  const run = (env) => spawnSync(process.execPath, [join(here, '..', 'server.mjs'), '--hosted'], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8', timeout: 20000 });
  const noCode = run({}); assert.equal(noCode.status, 2); assert.match(noCode.stderr, /BLOODBOARD_ROOM_CODE/);
  const noStore = run({ BLOODBOARD_ROOM_CODE: 'ABCD2345' }); assert.equal(noStore.status, 2); assert.match(noStore.stderr, /durable recovery store/);
  const badCode = run({ BLOODBOARD_ROOM_CODE: 'short' }); assert.equal(badCode.status, 2);
});

test('trusted proxy: rate limiting uses the address the nearest proxy added, not a forged first entry', async () => {
  const fu = await fakeUpstash();
  try {
    const s = await boot(fu, { ratePerMinute: 5, trustProxy: true });
    const hit = async (xff) => (await fetch(`${s.base}/api/state?token=x`, { headers: { 'X-Forwarded-For': xff } })).status;
    for (let i = 0; i < 5; i++) await hit(`6.6.6.${i}, 203.0.113.9`); // forged first entry varies, the proxy-added last entry is constant
    assert.equal(await hit('7.7.7.7, 203.0.113.9'), 429, 'forging the first entry does not escape the limit');
    assert.notEqual(await hit('7.7.7.7, 203.0.113.10'), 429, 'another real client is unaffected');
    await s.srv.close();
  } finally { await fu.close(); }
});

test('memory store: tx rolls back a failed write and keeps serving the last durable state', async () => {
  const { Room } = await import('../room.mjs');
  const st = memoryStore(); const r = new Room({ engine: E, code: CODE, store: st, seed: () => 7 }); r.open(); await r.tx(() => undefined);
  const a = await r.tx(() => r.join({ code: CODE, seat: 'A', name: 'A', client: CLIENT })); assert.ok(a.ok);
  st.failNext = 1;
  const b = await r.tx(() => r.join({ code: CODE, seat: 'B', name: 'B', client: CLIENT })); assert.equal(b.code, 'store_unavailable');
  assert.equal(r.seats.B, null); assert.equal(st.lines.length, 2);
  const b2 = await r.tx(() => r.join({ code: CODE, seat: 'B', name: 'B', client: CLIENT })); assert.ok(b2.ok); assert.equal(st.lines.length, 3);
});
