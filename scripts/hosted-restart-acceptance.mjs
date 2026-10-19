// V7-14 acceptance: a complete Blood Bowl Sevens match on the REAL hosted server process (`node lan/server.mjs --hosted`), whose process is
// hard-killed (SIGKILL, like a free host spinning down or crashing) several times mid-match and restarted with an empty disk. The recovery store
// is a FAKE Upstash REST server on loopback (lan/test/fake-upstash.mjs): this proves the protocol, the sealed journal and the cold-start replay.
// It is NOT a Render test and NOT an Upstash test: no real account or network is involved.
//   node scripts/hosted-restart-acceptance.mjs [--seed 31] [--kills 4] [--leg 30] [--max-commands 3000]
// Checks: after every restart the public state of both seats is byte-identical to the one before the kill; the same tokens keep working; the last
// command, re-sent with its old id, is acknowledged as a duplicate and not applied twice; a restart while the store is DOWN does not come up with an
// empty room (the process exits instead); nothing in the store is readable text; the finished match exports a verified history.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
const E = await import(new URL('../lan/engine.mjs', import.meta.url).href);
const { fakeUpstash } = await import(new URL('../lan/test/fake-upstash.mjs', import.meta.url).href);
const { makeMatch, aiIntent, cid, CLIENT } = await import(new URL('../lan/test/helpers.mjs', import.meta.url).href);
const flag = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const SEED = Number(flag('seed', '31')), KILLS = Number(flag('kills', '4')), MAX = Number(flag('max-commands', '3000'));
const CODE = 'RESTART7A';
const results = [];
const check = (n, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ` — ${d}` : ''}`); };
const fu = await fakeUpstash();
const empty = mkdtempSync(join(tmpdir(), 'bb-hosted-')); // cwd of every process: a fresh, empty "ephemeral disk"
const serverJs = new URL('../lan/server.mjs', import.meta.url).pathname;
const env = () => ({ PATH: process.env.PATH, NO_PROXY: '127.0.0.1', BLOODBOARD_HOSTED: '1', BLOODBOARD_ROOM_CODE: CODE, BLOODBOARD_RATE_PER_MINUTE: '1000000', BLOODBOARD_JOINS_PER_MINUTE: '1000000', UPSTASH_REDIS_REST_URL: fu.url, UPSTASH_REDIS_REST_TOKEN: 'tok-test' });

function launch() {
  const p = spawn(process.execPath, [serverJs, '--hosted', '--port', '0', '--host', '127.0.0.1'], { cwd: empty, env: env(), stdio: ['ignore', 'pipe', 'pipe'] });
  let err = ''; p.stderr.on('data', (d) => { err += d; });
  const ready = new Promise((ok) => {
    const rl = createInterface({ input: p.stdout });
    rl.on('line', (l) => { if (l.startsWith('BLOODBOARD_LAN_READY ')) ok(JSON.parse(l.slice(21))); });
    p.on('exit', (code) => ok({ exited: code, err }));
  });
  return { p, ready, err: () => err };
}
const api = (port) => ({
  get: async (path) => { const r = await fetch(`http://127.0.0.1:${port}${path}`); return { status: r.status, json: await r.json() }; },
  post: async (path, body) => { const r = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json() }; },
});
const kill = (h) => new Promise((ok) => { h.p.once('exit', ok); h.p.kill('SIGKILL'); });

let h = launch(); let info = await h.ready;
check('boot 1: hosted server starts empty with the fake durable store', info.port && info.store === 'upstash' && info.hosted && info.resumed === false, JSON.stringify({ store: info.store, resumed: info.resumed }));
let c = api(info.port);
const A = (await c.post('/api/join', { code: CODE, seat: 'A', name: 'Ann', client: CLIENT })).json;
const B = (await c.post('/api/join', { code: CODE, seat: 'B', name: 'Bob', client: CLIENT })).json;
check('both coaches seated', A.ok && B.ok);
const st = await c.post('/api/start', { token: A.token, state: makeMatch(SEED) });
check('match started (the server owns the dice)', st.status === 200, JSON.stringify(st.json).slice(0, 80));
const tok = { A: A.token, B: B.token };
const view = async (seat) => (await c.get(`/api/state?token=${tok[seat]}`)).json;
let last = null, commands = 0, over = false;
const step = async () => {
  const sa = await view('A'); if (!sa.state) throw new Error('no state: ' + JSON.stringify(sa).slice(0, 200)); if (sa.over || sa.state.phase === 'fullTime') { over = true; return; }
  const w = E.waitingFor(sa.state); const seat = w === 'B' ? 'B' : 'A';
  const sv = seat === 'A' ? sa : await view('B');
  const it = aiIntent(sv.state, seat) ?? aiIntent(sa.state, 'A'); if (!it) { over = true; return; }
  const body = { token: tok[seat], commandId: cid('r'), baseRev: sv.rev, kind: it.kind, input: it.input, choice: it.choice };
  const r = await c.post('/api/command', body);
  if (r.status !== 200) throw new Error(`command refused: ${r.status} ${JSON.stringify(r.json)}`);
  last = { body, rev: r.json.rev }; commands++;
};
const perLeg = Number(flag('leg', '30')); // commands played between kills (a Sevens match is roughly 180 commands)
let revBefore = 0, dupOk = true, identical = true, tokensOk = true, restarts = 0;
for (let k = 0; k <= KILLS && !over; k++) {
  for (let i = 0; (k === KILLS || i < perLeg) && !over && commands < MAX; i++) await step(); // the last leg runs to full time
  if (over || k === KILLS) break;
  const before = { A: JSON.stringify(await view('A')), B: JSON.stringify(await view('B')) }; revBefore = (await view('A')).rev;
  await kill(h);
  // restart while the store is DOWN: the process must refuse to start rather than open an empty room
  if (k === 0) {
    fu.st.down = true; const dead = launch(); const o = await dead.ready; fu.st.down = false;
    check('restart with the store DOWN: the process exits (does not open an empty room)', o.exited !== undefined && o.exited !== 0 && /recovery store unavailable/.test(o.err), `exit ${o.exited}`);
  }
  h = launch(); info = await h.ready; c = api(info.port); restarts++;
  const after = { A: JSON.stringify(await view('A')), B: JSON.stringify(await view('B')) };
  if (!(info.resumed === true && info.revision === revBefore)) tokensOk = false;
  if (before.A !== after.A || before.B !== after.B) identical = false;
  if (last) { const d = await c.post('/api/command', last.body); if (!(d.status === 200 && d.json.duplicate === true)) dupOk = false; }
  if ((await view('A')).rev !== revBefore) dupOk = false; // the duplicate must not have advanced the match
}
check(`${restarts} hard kills mid-match: every restart resumed at the same revision with the same tokens`, restarts > 0 && tokensOk, `restarts ${restarts}`);
check('after each restart both seats see a byte-identical public state', restarts > 0 && identical);
check('the last command re-sent after each restart is a duplicate and is not applied twice', restarts > 0 && dupOk);
check('the match was played to full time through those restarts', over, `${commands} commands`);
const hist = await c.get(`/api/history?token=${tok.A}`);
const imp = hist.status === 200 ? E.importHistories(JSON.stringify(hist.json).length && (await (await fetch(`http://127.0.0.1:${info.port}/api/history?token=${tok.A}`)).text())) : null;
check('the finished match exports a verified multiplayer history', imp && imp.ok && imp.verified.length === 1 && imp.verified[0].source === 'multiplayer');
const stored = JSON.stringify([...fu.db.values()]);
check('nothing readable in the store: no room code, dice seed, team names or token text', !/RESTART7A|"seed"|Human|Orc|"tokenHash"|Ann|Bob/.test(stored) && [...fu.db.values()].flat().every((l) => l.startsWith('e1.')), `${[...fu.db.values()].flat().length} sealed records, ${fu.st.calls} store calls`);
await kill(h); await fu.close();
const fails = results.filter((x) => !x).length;
console.log(`\n${results.length - fails}/${results.length} checks passed (evidence class: real server process + fake Upstash on loopback; not Render, not Upstash).`);
process.exit(fails ? 1 : 0);
