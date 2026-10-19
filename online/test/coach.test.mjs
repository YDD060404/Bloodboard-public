import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { coachSource, buildCoach } from '../build-coach.mjs';
import { createBridge } from '../bridge.mjs';
import { createMockProvider } from '../providers/mock.mjs';

const CAP = 'b'.repeat(64);
async function load(provider = 'deepseek', model = 'ds-model') {
  const { text, config } = await coachSource({ provider, model, capability: CAP, port: 1234 });
  return { text, config };
}
function instantiate(text, fetchImpl) {
  let reg;
  vm.runInNewContext(text, { bloodboard: { register: (c) => { reg = c; } }, fetch: fetchImpl, AbortSignal, Set, Date, JSON, String, Number, Math, Error, Array, Object, Promise }, { timeout: 5000 });
  return reg;
}
const scripted = (cmds, seen = []) => { let i = 0; return async (url, init) => { const body = JSON.parse(init.body); seen.push(body); const c = cmds[i++]; return c instanceof Error ? Promise.reject(c) : { ok: !c?.__status, status: c?.__status ?? 200, json: async () => c?.__status ? { error: { code: c.code } } : (c?.protocolError ? c : { command: c, meta: { cacheHitTokens: 5, promptTokens: 50 } }) }; }; };
const services = (extra = {}) => { const prog = []; return { prog, progress: async (m) => prog.push(m), validate: async () => ({ legal: true }), candidates: async () => ({ ok: true }), ...extra }; };
const OBS = { revision: 'r1', timeLimitMs: 60000 };

test('generated coach: registers as a gen-2 module with context schema, fixed provider/model, and no provider secret', async () => {
  const { text, config } = await load();
  assert.ok(text.includes(CAP), 'carries the local pairing capability only');
  assert.ok(!/sk-|api[_-]?key|Bearer sk/i.test(text.replace(/"route":"api-key"/, '')), 'no provider key');
  let reg; vm.runInNewContext(text, { bloodboard: { register: (c) => { reg = c; } } });
  assert.equal(reg.apiVersion, 2); assert.equal(reg.contextSchema, 'online-coach/1'); assert.equal(reg.id, 'online-deepseek-ds-model'); assert.equal(config.provider, 'deepseek');
  assert.deepEqual(JSON.parse(JSON.stringify(reg.capabilities)), { playTurn: true, ruleDecisions: true, persistentContext: true, controlledSimulation: true });
});

test('coach: engine query then numeric candidate; context and trace carry provider/model/latency; one TOTAL budget', async () => {
  const { text } = await load(); const seen = [];
  const c = instantiate(text, scripted([{ type: 'query', service: 'candidates', args: [{ limit: 999 }] }, { type: 'act', revision: 'r1', candidateId: 3, why: 'advance', plan: 'screen' }], seen));
  let q; const s = services({ candidates: async (o) => { q = o; return { ok: true, candidates: [{ id: 3 }] }; } });
  const a = await c.chooseAction(OBS, [{ id: 3 }], s);
  assert.equal(q.limit, 32); assert.equal(a.candidateId, 3);
  assert.equal(a.coachContext.provider, 'deepseek'); assert.equal(a.coachContext.model, 'ds-model'); assert.equal(a.coachContext.plan, 'screen');
  assert.equal(a.trace.queries, 1); assert.equal(a.trace.modelCalls, 2); assert.equal(a.trace.cacheHitTokens, 10);
  assert.ok(seen.every((b) => b.provider === 'deepseek' && b.model === 'ds-model' && b.maxMs <= 57500), 'budget below the host limit minus a margin');
  assert.notEqual(seen[0].requestId, seen[1].requestId, 'every round has its own request id');
});

test('REGRESSION candidateId:null is rejected and corrected, never executed as End Turn', async () => {
  const { text } = await load(); const seen = [];
  const c = instantiate(text, scripted([{ type: 'act', revision: 'r1', candidateId: null, why: 'x' }, { type: 'act', revision: 'r1', candidateId: 1, why: 'ok' }], seen));
  const a = await c.chooseAction(OBS, [{ id: 0 }, { id: 1 }], services());
  assert.equal(a.candidateId, 1); assert.equal(a.trace.corrections, 1);
  assert.match(seen[1].messages.at(-1).content, /never End Turn|missing or null/);
});

test('repeated invalid answers exhaust the bounded correction budget and FAIL (the host then reports a fallback; the model is not credited)', async () => {
  const { text } = await load();
  const bad = { type: 'act', revision: 'r1', candidateId: null };
  const c = instantiate(text, scripted([bad, bad, bad, bad, bad, bad]));
  await assert.rejects(c.chooseAction(OBS, [{ id: 0 }], services()), /correction budget exhausted/);
});

test('End Turn only by explicit valid input; the engine validation result decides', async () => {
  const { text } = await load();
  const ok = instantiate(text, scripted([{ type: 'act', revision: 'r1', input: { kind: 'endTurn' }, why: 'nothing safe left' }]));
  const a = await ok.chooseAction(OBS, [{ id: 0 }], services());
  assert.deepEqual(JSON.parse(JSON.stringify(a.input)), { kind: 'endTurn' });
  const rej = instantiate(text, scripted([{ type: 'act', revision: 'r1', input: { kind: 'move', playerId: 'X' } }, { type: 'act', revision: 'r1', candidateId: 0 }]));
  const b = await rej.chooseAction(OBS, [{ id: 0 }], services({ validate: async (i) => ({ legal: i.kind !== 'move' }) }));
  assert.equal(b.candidateId, 0); assert.equal(b.trace.corrections, 1);
});

test('wrong revision and unoffered candidate are corrected, not executed', async () => {
  const { text } = await load();
  const c = instantiate(text, scripted([{ type: 'act', revision: 'old', candidateId: 0 }, { type: 'act', revision: 'r1', candidateId: 77 }, { type: 'act', revision: 'r1', candidateId: 0 }]));
  assert.equal((await c.chooseAction(OBS, [{ id: 0 }], services())).candidateId, 0);
});

test('rule decisions return an object answer with the public reason; only offered options pass; a normal action is refused', async () => {
  const { text } = await load();
  const c = instantiate(text, scripted([{ type: 'act', revision: 'r1', candidateId: 0 }, { type: 'rule', revision: 'r1', optionId: 'nope' }, { type: 'rule', revision: 'r1', optionId: 'use-reroll', why: 'Protect possession' }]));
  const s = services();
  const a = await c.chooseDecision(OBS, { options: [{ id: 'use-reroll' }, { id: 'decline' }] }, s);
  assert.equal(a.optionId, 'use-reroll'); assert.equal(a.why, 'Protect possession'); assert.equal(a.trace.corrections, 2);
  assert.ok(s.prog.some((m) => m.headline === 'Protect possession'));
});

test('context from another provider/model is never reused (switch invalidates context)', async () => {
  const { text } = await load(); const seen = [];
  const c = instantiate(text, scripted([{ type: 'act', revision: 'r1', candidateId: 0 }, { type: 'act', revision: 'r1', candidateId: 0 }], seen));
  await c.chooseAction({ ...OBS, coachContext: { schema: 'online-coach/1', provider: 'luna', model: 'luna-x', plan: 'OLD LUNA PLAN' } }, [{ id: 0 }], services());
  assert.ok(!seen[0].messages[0].content.includes('OLD LUNA PLAN'));
  await c.chooseAction({ ...OBS, coachContext: { schema: 'online-coach/1', provider: 'deepseek', model: 'ds-model', plan: 'MY PLAN' } }, [{ id: 0 }], services());
  assert.ok(seen[1].messages[0].content.includes('MY PLAN'));
});

test('bridge failures throw (no silent impersonation): unreachable, provider error code, timeout', async () => {
  const { text } = await load();
  await assert.rejects(instantiate(text, scripted([new TypeError('x')])).chooseAction(OBS, [], services()), /bridge unreachable/);
  await assert.rejects(instantiate(text, scripted([{ __status: 502, code: 'insufficient_balance' }])).chooseAction(OBS, [], services()), /insufficient_balance/);
});

test('protocol errors from the bridge are retried within the correction budget', async () => {
  const { text } = await load();
  const c = instantiate(text, scripted([{ protocolError: { code: 'invalid-json', message: 'bad' }, raw: 'prose' }, { type: 'act', revision: 'r1', candidateId: 0 }]));
  assert.equal((await c.chooseAction(OBS, [{ id: 0 }], services())).trace.corrections, 1);
});

test('END TO END through the real bridge: coach -> HTTP -> bridge -> provider -> command -> coach, for both provider ids', async () => {
  for (const id of ['deepseek', 'luna']) {
    const p = createMockProvider({ id, models: [{ id: 'm1' }], responses: [{ type: 'query', service: 'candidates', args: [{}] }, { type: 'act', revision: 'r1', candidateId: 0, why: 'e2e ' + id }] });
    const bridge = createBridge({ providers: [p], instructions: 'JSON', capability: CAP, port: 0 });
    const port = await bridge.listen();
    try {
      const { text } = await coachSource({ provider: id, model: 'm1', capability: CAP, port });
      const c = instantiate(text, (url, init) => fetch(url, init));
      const a = await c.chooseAction(OBS, [{ id: 0 }], services());
      assert.equal(a.candidateId, 0); assert.equal(a.why, 'e2e ' + id); assert.equal(a.trace.provider, id);
      assert.equal(p.calls[0].system, 'JSON'); assert.equal(p.calls[0].model, 'm1');
    } finally { await bridge.close(); }
  }
});

test('install: the SAME bytes are written to every target; SHA-256 matches; provider key is not in the file', async () => {
  const state = await mkdtemp(join(tmpdir(), 'bb-state-')); const a = await mkdtemp(join(tmpdir(), 'bb-ai1-')); const b = await mkdtemp(join(tmpdir(), 'bb-ai2-'));
  const r = await buildCoach({ provider: 'luna', model: 'luna-x', stateDir: state, targets: [a, b] });
  const [x, y] = await Promise.all(r.written.map((f) => readFile(f)));
  assert.ok(x.equals(y)); assert.equal(createHash('sha256').update(x).digest('hex'), r.sha256); assert.equal(r.written.length, 2);
  assert.match(r.fileName, /^Online-ChatGPT-Luna-luna-x-/);
});

test('bridge install endpoint writes byte-identical coaches into the configured folders only, and lists them with SHA-256', async () => {
  const state = await mkdtemp(join(tmpdir(), 'bb-st-')); const a = await mkdtemp(join(tmpdir(), 'bb-a-')); const b = await mkdtemp(join(tmpdir(), 'bb-b-'));
  const { loadOrCreateCapability } = await import('../bridge.mjs');
  const cap = await loadOrCreateCapability(join(state, 'private'));
  const bridge = createBridge({ providers: [createMockProvider({ id: 'deepseek' })], instructions: 'J', capability: cap, port: 0, aiDirs: [a, b], stateDir: state });
  const port = await bridge.listen();
  try {
    const call = (path, method = 'GET', body) => fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { Authorization: `Bearer ${cap}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
    const r = await call('/coaches/install', 'POST', { provider: 'deepseek', model: 'ds-model', targets: ['/etc'] });
    assert.equal(r.written.length, 2); assert.ok(r.written.every((p) => p.startsWith(a) || p.startsWith(b)), 'a caller-supplied target is ignored');
    const [x, y] = await Promise.all(r.written.map((p) => readFile(p))); assert.ok(x.equals(y));
    const list = await call('/coaches'); assert.equal(list.coaches.length, 2); assert.ok(list.coaches.every((c) => c.sha256 === r.sha256));
    assert.equal((await call('/coaches/install', 'POST', { provider: 'nope', model: 'x' })).error.code, 'invalid_request');
  } finally { await bridge.close(); }
});
