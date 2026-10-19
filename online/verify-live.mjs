#!/usr/bin/env node
// LIVE provider verification — run this on YOUR Mac against a running bridge. It makes REAL authenticated provider calls.
// It is deliberately separate from the mock/outage tests (online/test, scripts/lab-online-smoke.mjs), which prove nothing about a real provider.
//   node bridge.mjs serve                       (note port + pairing code)
//   node verify-live.mjs --provider deepseek --model <id> --code 12345678 [--port 60557]
//   node verify-live.mjs --provider luna --model <id from the list> --code 12345678
// Writes verification-reports/<provider>-<model>-<time>.json. The report holds no keys, tokens or pairing material.
import { writeFile, mkdir } from 'node:fs/promises';
import { checkCommand, parseCommand } from './protocol.mjs';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };
const provider = arg('provider'), model = arg('model'), code = arg('code', process.env.BRIDGE_PAIRING_CODE), port = Number(arg('port', 60557));
if (!provider || !code) { console.error('usage: verify-live.mjs --provider deepseek|luna [--model id] --code <pairing code> [--port N]'); process.exit(2); }
const base = `http://127.0.0.1:${port}`;
const steps = []; let capability, route = null;
const j = async (path, opt = {}) => {
  const r = await fetch(base + path, { method: opt.body ? 'POST' : (opt.method ?? 'GET'), headers: { 'Content-Type': 'application/json', ...(capability ? { Authorization: 'Bearer ' + capability } : {}) }, body: opt.body ? JSON.stringify(opt.body) : undefined, signal: opt.signal });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const record = (name, ok, detail) => { steps.push({ name, ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + JSON.stringify(detail).slice(0, 200) : '')); return ok; };

const observation = { revision: 'live-1', note: 'Synthetic verification position, not a real match.', ball: 'carried by own ball carrier, 6 squares from the end zone' };
const offeredCandidates = [{ id: 0, label: 'Advance the ball carrier 3 squares toward the end zone', riskNote: 'no dodges' }, { id: 1, label: 'End turn', riskNote: 'none' }, { id: 2, label: 'Blitz the nearest opponent', riskNote: 'moderate' }];
const messages = (id) => [{ role: 'user', content: JSON.stringify({ observation, offeredCandidates, request: null, persistentPlan: null, instruction: 'Choose one offered candidate. Return exactly one JSON command.', id }) }];

try {
  const pair = await j('/pair', { body: { code: String(code) } });
  if (!record('pair with bridge', pair.status === 200 && !!pair.body.capability, { status: pair.status })) process.exit(1);
  capability = pair.body.capability;
  const st = await j('/status'); const ps = (st.body.providers ?? []).find((p) => p.id === provider);
  route = ps?.route ?? null;
  if (route === 'mock') console.log('WARNING: this bridge is using a MOCK provider; this run is a script self-test, not live verification.');
  record('provider known and configured/signed in', !!ps && (ps.configured !== false) && (ps.signedIn !== false), ps && { route: ps.route, configured: ps.configured, signedIn: ps.signedIn, keyStorage: ps.keyStorage });
  const chk = await j(`/providers/${provider}/check`, { body: {} });
  record('connection health (real authenticated call)', chk.status === 200 && chk.body.ok !== false, chk.body);
  const ml = await j(`/providers/${provider}/models`);
  const ids = (ml.body.models ?? []).map((m) => m.id ?? m);
  record('model discovery returns account models', ml.status === 200 && ids.length > 0, { count: ids.length, sample: ids.slice(0, 6) });
  const chosen = model ?? ids[0];
  record('chosen model is in the discovered list', ids.includes(chosen), { chosen });

  const t0 = Date.now(); const requestId = 'live-' + Date.now().toString(36);
  const d = await j('/decision', { body: { provider, model: chosen, messages: messages(1), maxMs: 60000, requestId } });
  const elapsed = Date.now() - t0;
  let verdict = null;
  if (d.body.command) verdict = checkCommand(d.body.command, { revision: observation.revision, request: null, offeredIds: new Set([0, 1, 2]) });
  record('real decision returns a protocol-valid command', d.status === 200 && (d.body.command ? verdict.ok : false), { status: d.status, elapsedMs: elapsed, command: d.body.command && { type: d.body.command.type, candidateId: d.body.command.candidateId }, verdict, error: d.body.error, protocolError: d.body.protocolError && (d.body.protocolError.message ?? d.body.protocolError), meta: d.body.meta });
  const dup = await j('/decision', { body: { provider, model: chosen, messages: messages(1), maxMs: 60000, requestId } });
  record('duplicate requestId rejected (409)', dup.status === 409, { status: dup.status });

  // cancellation reaches the provider: start a decision, cancel after 400 ms, expect an aborted/cancelled outcome.
  const cid = 'live-cancel-' + Date.now().toString(36);
  const pending = j('/decision', { body: { provider, model: chosen, messages: messages(2), maxMs: 60000, requestId: cid } });
  await new Promise((r) => setTimeout(r, 400));
  const c = await j('/cancel', { body: { requestId: cid } });
  const done = await pending;
  record('cancellation aborts the in-flight provider call', c.status === 200 && (done.status !== 200 || !!done.body.error || !!done.body.cancelled), { cancelStatus: c.status, decisionStatus: done.status, error: done.body.error });
} catch (e) { record('verification aborted', false, String(e?.message ?? e)); }

const report = { kind: 'LIVE provider verification', provider, model: model ?? null, bridge: base, at: new Date().toISOString(), allPassed: steps.every((s) => s.ok), live: route !== null && route !== 'mock', route, steps, note: 'Transport/protocol validation only. This is NOT a playing-strength claim. A full small match is verified separately (docs/LOCAL_VERIFICATION.md).' };
await mkdir('verification-reports', { recursive: true });
const file = `verification-reports/${provider}-${String(model ?? 'default').replace(/[^\w.-]/g, '_')}-${Date.now()}.json`;
await writeFile(file, JSON.stringify(report, null, 2));
console.log(report.allPassed ? '\nALL PASSED' : '\nSOME STEPS FAILED', '— report:', file);
process.exit(report.allPassed ? 0 : 1);
