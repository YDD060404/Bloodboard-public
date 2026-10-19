// Self-test of the verify-live.mjs SCRIPT against a MOCK provider. This proves the script works; it is NOT live provider verification
// (the report it writes says live:false).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridge } from '../bridge.mjs';
import { createMockProvider } from '../providers/mock.mjs';

test('verify-live.mjs against a mock provider: passes every step, writes a report marked live:false with no secrets', async () => {
  const mock = createMockProvider({ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'm-1' }], delayMs: 1500, responses: [{ type: 'act', revision: 'live-1', candidateId: 0, why: 'advance', plan: 'score' }, { type: 'act', revision: 'live-1', candidateId: 1, why: 'x' }] });
  const CAP = 'c'.repeat(64);
  const b = createBridge({ providers: [mock], instructions: 'Return JSON.', capability: CAP, pairingCode: '87654321', port: 0 });
  const port = await b.listen();
  const cwd = await mkdtemp(join(tmpdir(), 'bb-vl-'));
  const child = spawn(process.execPath, [new URL('../verify-live.mjs', import.meta.url).pathname, '--provider', 'deepseek', '--model', 'm-1', '--code', '87654321', '--port', String(port)], { cwd });
  let out = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
  const code = await new Promise((r) => child.on('exit', r));
  await b.close();
  assert.equal(code, 0, out);
  const [file] = await readdir(join(cwd, 'verification-reports'));
  const text = await readFile(join(cwd, 'verification-reports', file), 'utf8');
  const report = JSON.parse(text);
  assert.equal(report.live, false);
  assert.equal(report.route, 'mock');
  assert.ok(report.allPassed);
  assert.ok(!text.includes(CAP) && !text.includes('87654321'), 'no capability or pairing code in the report');
  assert.match(out, /MOCK provider/);
});
