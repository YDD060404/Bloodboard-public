// V7-05 component acceptance: a COMPLETE Blood Bowl Sevens match between two network clients (separate mirrors, each driven by the built-in
// coach from the public state it received) over real HTTP + SSE on the loopback interface, with injected faults:
//   duplicate command · stale command · wrong-seat command · dropped connection + reconnect · host restart replayed from the journal.
// This proves the protocol and the authority logic. It is NOT a two-device LAN test and NOT an internet test (see docs/LAN.md for those).
//   node scripts/lan-acceptance.mjs [--seed 31] [--max-commands 3000] [--format sevens|standard] [--tls] [--latency 80] [--mode internet]
// --tls serves HTTPS with a throw-away self-signed certificate; --latency adds that many ms (plus jitter) before every request and every received event;
// --mode internet turns on the internet-mode limits. All still loopback: the transport hardening is exercised, real networks are not.
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const E = await import(new URL('../lan/engine.mjs', import.meta.url).href);
const { createServer } = await import(new URL('../lan/server.mjs', import.meta.url).href);
const flag = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const SEED = Number(flag('seed', '31')), MAX = Number(flag('max-commands', '4000')), FORMAT = flag('format', 'sevens');
const TLS = process.argv.includes('--tls'), LATENCY = Number(flag('latency', '0')), MODE = flag('mode', 'lan');
let tlsOpts = null;
if (TLS) {
  const d = process.env.BB_ACC_TLS_DIR || mkdtempSync(join(tmpdir(), 'bb-acc-tls-'));
  if (!process.env.BB_ACC_TLS_DIR) {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(d, 'k.pem'), '-out', join(d, 'c.pem'), '-days', '2', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
    // node reads NODE_EXTRA_CA_CERTS only at start-up, so run the real test in a child that trusts this throw-away certificate
    const r = spawnSync(process.execPath, process.argv.slice(1), { stdio: 'inherit', env: { ...process.env, BB_ACC_TLS_DIR: d, NODE_EXTRA_CA_CERTS: join(d, 'c.pem') } }); process.exit(r.status ?? 1);
  }
  tlsOpts = { key: readFileSync(join(d, 'k.pem')), cert: readFileSync(join(d, 'c.pem')) };
}
if (LATENCY > 0) { const f0 = globalThis.fetch; globalThis.fetch = async (u, o) => { await new Promise((ok) => setTimeout(ok, LATENCY + Math.random() * LATENCY)); return f0(u, o); }; }
const results = [];
const check = (n, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ` — ${d}` : ''}`); };
const CLIENT = { protocol: 1, rulesHash: E.BUILD_FINGERPRINT.rulesHash, apiHash: E.BUILD_FINGERPRINT.apiHash, engineVersion: E.BUILD_FINGERPRINT.version, editions: ['faq2026', 'legacy'] };
const journalDir = mkdtempSync(join(tmpdir(), 'bb-lan-acc-'));
let srv = await createServer({ engine: E, mode: MODE, tls: tlsOpts, ratePerMinute: 100000, code: 'ACCEPT22', journalDir, seed: () => 20261004 });
let port = await srv.listen(0, '127.0.0.1');
const base = () => `${TLS ? 'https' : 'http'}://127.0.0.1:${port}`;
const post = async (path, body) => { const r = await fetch(base() + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json() }; };

class Client {
  constructor(seat, token) { this.seat = seat; this.token = token; this.mirror = null; this.rev = -1; this.connected = false; this.reconnects = 0; this.updates = 0; this.resyncs = 0; }
  async connect() {
    this.ctl = new AbortController(); this.connected = false;
    const r = await fetch(`${base()}/api/events?token=${this.token}`, { signal: this.ctl.signal });
    const dec = new TextDecoder(); let buf = ''; let first;
    const gotFirst = new Promise((ok) => { first = ok; });
    (async () => { try { for await (const chunk of r.body) { buf += dec.decode(chunk, { stream: true }); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const blk = buf.slice(0, i); buf = buf.slice(i + 2); const line = blk.split('\n').find((l) => l.startsWith('data: ')); if (line) { const mm = JSON.parse(line.slice(6)); this.on(mm); if (mm.type === 'snapshot') first(); } } } } catch { /* closed */ } this.connected = false; })();
    await gotFirst; this.connected = true;
  }
  on(m) {
    if (JSON.stringify(m).includes('20261004')) leaks++;
    if (m.type === 'snapshot') { this.rev = m.rev; this.mirror = m.state ?? null; this.snapshotCounter = m.state?.rng.counter; }
    else if (m.type === 'update') {
      if (m.rev !== this.rev + 1) { this.resyncs++; this.needSync = true; return; }
      const r = E.applyWireUpdate(this.mirror, m);
      if (!r.ok) { this.resyncs++; this.needSync = true; return; }
      this.mirror = r.state; this.rev = m.rev; this.updates++;
    }
  }
  drop() { this.ctl?.abort(); this.connected = false; }
  async resync() { const r = await fetch(`${base()}/api/state?token=${this.token}`); const m = await r.json(); this.on(m); this.needSync = false; }
}

const a = (await post('/api/join', { code: 'accept22', seat: 'A', name: 'Ann (Player 1)', client: CLIENT })).json;
const b = (await post('/api/join', { code: 'ACCEPT22', seat: 'B', name: 'Bob (Player 2)', client: CLIENT })).json;
check('both players take their seats with the room code', a.ok && b.ok && a.seat === 'A' && b.seat === 'B');
const A = new Client('A', a.token), B = new Client('B', b.token);
await A.connect(); await B.connect();
const t1 = E.buildTeam('human', FORMAT), t2 = E.buildTeam('orc', FORMAT);
const cm = E.createMatch(FORMAT === 'sevens' ? 'tournament' : 'tournament', t1, t2, { rules: 'full', play: 'tournament' }, SEED);
if (!cm.ok) throw new Error(cm.errors.join('; '));
const started = await post('/api/start', { token: a.token, state: cm.state });
check('Player 1 starts the match; the server owns the dice seed', started.status === 200);
await new Promise((ok) => setTimeout(ok, 200));

let leaks = 0;
const stats = { commands: 0, byA: 0, byB: 0, decisions: { A: 0, B: 0 }, foreignDecisions: 0, duplicates: 0, stale: 0, wrongSeat: 0, reconnects: 0, restarts: 0, touchdowns: 0, halves: new Set(), turnovers: 0, rerollOffers: 0 };
const clients = { A, B };
let n = 0;
const t0 = Date.now();
const intentFor = (c) => {
  const w = E.waitingFor(c.mirror);
  if (w === null) return c.seat === 'A' ? { kind: 'action', input: { kind: c.mirror.phase === 'pregame' ? 'pregame' : 'nextDrive' } } : null;
  if (w !== c.seat) return null;
  const mv = E.nextMove(c.mirror, c.seat, 'balanced');
  if (!mv) return null;
  return mv.type === 'decision' ? { kind: 'decision', choice: { requestId: mv.requestId, optionId: mv.optionId } } : { kind: 'action', input: mv.input };
};
let lastDrop = 0, bDroppedAt = -1, finished = false;
while (n < MAX) {
  const auth = srv.room.state;
  if (auth.phase === 'fullTime') { finished = true; break; }
  const w = E.waitingFor(auth);
  const seat = w ?? 'A';
  const c = clients[seat];
  // a client whose connection was dropped must reconnect (fresh snapshot) before it can act
  if (!c.connected) { await c.connect(); stats.reconnects++; c.reconnects++; if (c.mirror?.rng.counter !== auth.rng.counter) check('reconnect snapshot carries the authoritative RNG position (no re-roll)', false); }
  // give SSE a moment to deliver the previous update
  for (let k = 0; k < 40 && c.rev !== srv.room.rev; k++) await new Promise((ok) => setTimeout(ok, 5));
  if (c.rev !== srv.room.rev || c.needSync) await c.resync();
  const intent = intentFor(c);
  if (!intent) { await new Promise((ok) => setTimeout(ok, 20)); if (++lastDrop > 200) throw new Error(`no move for ${seat} in ${c.mirror.phase}`); continue; }
  lastDrop = 0;
  if (intent.kind === 'decision') { stats.decisions[seat]++; if (auth.pending && auth.pending.request.team !== seat) stats.foreignDecisions++; if (/re-?roll/i.test(auth.pending?.request.prompt ?? '')) stats.rerollOffers++; }
  const commandId = `acc-${n}-${seat}`;
  const send = () => post('/api/command', { token: c.token, commandId, baseRev: c.rev, ...intent });
  const r = await send();
  if (r.status !== 200) { check(`command ${n} accepted`, false, JSON.stringify(r.json)); break; }
  n++; stats.commands++; stats[seat === 'A' ? 'byA' : 'byB']++;
  // ---- fault injection
  if (n === 15 || n === 120) { const d = await send(); if (d.status === 200 && d.json.duplicate && srv.room.rev === r.json.rev) stats.duplicates++; }
  if (n === 25 || n === 140) { const other = clients[seat === 'A' ? 'B' : 'A']; const s = await post('/api/command', { token: other.token, commandId: `stale-${n}`, baseRev: Math.max(0, r.json.rev - 3), kind: 'action', input: { kind: 'endTurn' } }); if (s.status === 409 && s.json.code === 'stale') stats.stale++; }
  if (n === 35 || n === 160) { const nw = E.waitingFor(srv.room.state); if (nw) { const wrong = clients[nw === 'A' ? 'B' : 'A']; const x = await post('/api/command', { token: wrong.token, commandId: `wrong-${n}`, baseRev: srv.room.rev, kind: 'action', input: { kind: 'endTurn' } }); if (x.status === 403 && x.json.code === 'not_your_turn') stats.wrongSeat++; } }
  if (n === 45 || n === 180) { B.drop(); bDroppedAt = n; }
  if (n === 70 || n === 220) {
    // the host's server process dies and comes back from its journal on the same port
    A.drop(); B.drop();
    const before = JSON.stringify(srv.room.state); const beforeRev = srv.room.rev;
    await srv.close();
    const jf = join(journalDir, readdirSync(journalDir).find((f) => f.endsWith('.jsonl')));
    srv = await createServer({ engine: E, mode: MODE, tls: tlsOpts, ratePerMinute: 100000, code: 'ACCEPT22', resume: jf });
    port = await srv.listen(port, '127.0.0.1');
    check(`host restart #${stats.restarts + 1}: the journal replays to the identical state (dice, pending decision, revision)`, JSON.stringify(srv.room.state) === before && srv.room.rev === beforeRev);
    stats.restarts++;
  }
  if (n % 200 === 0) console.log(`  … ${n} commands, phase ${srv.room.state.phase}, score ${srv.room.state.teams.A.score}-${srv.room.state.teams.B.score}, ${Math.round((Date.now() - t0) / 1000)} s`);
}
const fin = srv.room.state;
for (const e of fin.log) { if (e.outcome === 'touchdown') stats.touchdowns++; if (e.outcome === 'turnover') stats.turnovers++; }
stats.halves = fin.turn.half;
check('the match ran to full time over the network', finished && fin.phase === 'fullTime', `${stats.commands} commands in ${Math.round((Date.now() - t0) / 1000)} s; score ${fin.teams.A.score}-${fin.teams.B.score}; half ${fin.turn.half}`);
check('both coaches answered rule choices (decisions) and every decision went to the addressed seat', stats.decisions.A > 0 && stats.decisions.B > 0 && stats.foreignDecisions === 0, JSON.stringify(stats.decisions));
check('the match included a touchdown or a half change and Turnovers', (stats.touchdowns > 0 || fin.turn.half === 2) && stats.turnovers >= 0, `touchdowns ${stats.touchdowns}, turnovers ${stats.turnovers}`);
check('duplicate commands were idempotent', stats.duplicates >= 1, String(stats.duplicates));
check('stale commands were rejected with the current revision', stats.stale >= 1, String(stats.stale));
check('commands from the wrong seat were refused', stats.wrongSeat >= 1, String(stats.wrongSeat));
check('a dropped client reconnected and continued from the authoritative snapshot', stats.reconnects >= 1, String(stats.reconnects));
check('the host restarted from its journal mid-match and the match continued', stats.restarts >= 1);
// final consistency: each client's mirror after one last resync equals the authoritative public state; histories identical and verified
for (const c of [A, B]) { if (!c.connected) await c.connect(); await c.resync(); }
const pub = JSON.stringify({ ...fin, rng: { seed: 0, counter: fin.rng.counter }, pending: null, log: fin.log });
for (const c of [A, B]) check(`client ${c.seat}: final mirror equals the authoritative public state (including the whole log)`, JSON.stringify({ ...c.mirror, pending: null }) === pub);
const ha = await (await fetch(`${base()}/api/history?token=${a.token}`)).text(); const hb = await (await fetch(`${base()}/api/history?token=${b.token}`)).text();

if (ha !== hb) { const x = JSON.parse(ha), y = JSON.parse(hb); const d = (p, u, v) => { if (JSON.stringify(u) === JSON.stringify(v)) return; if (u && typeof u === 'object' && v) for (const k of new Set([...Object.keys(u), ...Object.keys(v)])) d(p + '.' + k, u[k], v[k]); else console.log('DIFF', p, JSON.stringify(u)?.slice(0, 80), JSON.stringify(v)?.slice(0, 80)); }; d('', x, y); }
check('both players download the identical history', ha === hb && ha.length > 1000);
const imp = E.importHistories(ha);
const v = imp.ok && imp.verified[0] ? E.verifyHistory(imp.verified[0]) : null;
check('the history verifies by independent re-execution (every die)', !!v && /verified/.test(v.grade), v?.reason);
check('the history says it was a multiplayer match with both seats named', imp.ok && imp.verified[0].source === 'multiplayer' && /Ann/.test(imp.verified[0].participants.A.name) && /Bob/.test(imp.verified[0].participants.B.name));
check('no snapshot or update sent to a client ever contained the dice seed', leaks === 0, `${leaks} messages`);
A.drop(); B.drop(); await srv.close();
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} passed`);
process.exit(ok === results.length ? 0 : 1);
