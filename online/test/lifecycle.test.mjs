import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { STARTUP_PREFIX, pidAlive } from '../lifecycle.mjs';

const BRIDGE = new URL('../bridge.mjs', import.meta.url).pathname;
function start(dir, extra = [], opts = {}) {
  const child = spawn(process.execPath, [BRIDGE, 'serve', '--dir', dir, '--json', ...extra], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, BLOODBOARD_DEEPSEEK_API_KEY: '', ...opts.env } });
  let out = '', err = '';
  child.stderr.on('data', (d) => { err += d; });
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { out += d; const line = out.split('\n').find((l) => l.startsWith(STARTUP_PREFIX)); if (line) resolve(JSON.parse(line.slice(STARTUP_PREFIX.length))); });
    child.on('exit', (code) => reject(Object.assign(new Error('exited ' + code + ': ' + err), { code, err })));
  });
  const exited = new Promise((r) => child.on('exit', (code, sig) => r({ code, sig, err })));
  return { child, ready, exited };
}
const ping = async (port) => (await fetch(`http://127.0.0.1:${port}/ping`)).json();

test('startup prints one machine-readable line; bridge answers; SIGTERM stops it and frees the instance record', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bb-life-'));
  const b = start(dir, ['--port', '0']);
  const info = await b.ready;
  assert.match(info.pairingCode, /^\d{8}$/);
  assert.ok(info.port > 0 && pidAlive(info.pid));
  assert.ok((await ping(info.port)).ok !== false);
  const rec = JSON.parse(await readFile(join(dir, 'bridge.json'), 'utf8'));
  assert.equal(rec.pid, info.pid);
  assert.ok(!JSON.stringify(rec).includes(info.pairingCode), 'the instance record never holds the pairing code');
  b.child.kill('SIGTERM');
  const r = await b.exited;
  assert.equal(r.code, 0);
  await assert.rejects(() => ping(info.port));
  await assert.rejects(() => readFile(join(dir, 'bridge.json'), 'utf8'), 'record removed');
});

test('a second bridge on the same folder is refused (exit 3) and the first keeps serving; a stale record is replaced', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bb-life-'));
  const a = start(dir, ['--port', '0']);
  const ai = await a.ready;
  const b = start(dir, ['--port', '0']);
  await assert.rejects(b.ready, (e) => e.code === 3 && /already running/i.test(e.err));
  assert.ok((await ping(ai.port)).ok !== false, 'first bridge unaffected');
  a.child.kill('SIGTERM'); await a.exited;
  await writeFile(join(dir, 'bridge.json'), JSON.stringify({ pid: 2 ** 22 + 12345, port: 1 }));
  const c = start(dir, ['--port', '0']);
  const ci = await c.ready;
  assert.ok(ci.port > 1);
  c.child.kill('SIGTERM'); await c.exited;
});

test('--replace stops the running bridge and takes over', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bb-life-'));
  const a = start(dir, ['--port', '0']);
  await a.ready;
  const b = start(dir, ['--port', '0', '--replace']);
  const bi = await b.ready;
  assert.equal((await a.exited).code, 0, 'old bridge exited cleanly');
  assert.ok((await ping(bi.port)).ok !== false);
  b.child.kill('SIGTERM'); await b.exited;
});

test('closing stdin (the launching app crashed or quit) shuts the bridge down', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bb-life-'));
  const b = start(dir, ['--port', '0', '--exit-on-stdin-close']);
  const info = await b.ready;
  b.child.stdin.end();
  const r = await b.exited;
  assert.equal(r.code, 0);
  assert.match(r.err, /stdin-closed/);
  await assert.rejects(() => ping(info.port));
});

test('--parent-pid: the bridge exits when that process is gone', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bb-life-'));
  const parent = spawn(process.execPath, ['-e', 'setTimeout(()=>{},1500)'], { stdio: 'ignore' });
  const b = start(dir, ['--port', '0', '--parent-pid', String(parent.pid)]);
  await b.ready;
  const r = await b.exited;
  assert.equal(r.code, 0);
  assert.match(r.err, /parent-exited/);
});

test('busy default port: manual start fails loudly; --auto-port picks a free one and reports it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bb-life-'));
  const blocker = net.createServer().listen(0, '127.0.0.1');
  await new Promise((r) => blocker.once('listening', r));
  const busy = blocker.address().port;
  const manual = start(dir, ['--port', String(busy)]);
  await assert.rejects(manual.ready, (e) => e.code === 1 && /EADDRINUSE|in use/i.test(e.err));
  const auto = start(dir, ['--port', String(busy), '--auto-port']);
  const info = await auto.ready;
  assert.notEqual(info.port, busy);
  assert.equal(info.requestedPort, busy);
  auto.child.kill('SIGTERM'); await auto.exited;
  blocker.close();
});
