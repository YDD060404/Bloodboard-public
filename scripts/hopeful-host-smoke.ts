// Smoke check (not a benchmark): the UNCHANGED Hopeful 1.5.0-GPT file through the shared host — set-up hook in 11-a-side and
// Sevens, coach-context round trip, then one real action request with its own declared 60 s allowance.
//   node build/hopeful-host-smoke.mjs /path/to/hopeful-1-5-0-gpt.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as Engine from '../src/engine/index';
import type { GameState } from '../src/engine/index';
import { bindEngine, type CoachEntry } from '../src/ai/index';
import { platformDecide, moduleMeta } from '../src/platform/host';
import { CoachContextStore, buildSetupRequest } from '../src/platform/hostext';
import { nodeSpawn } from '../src/platform/research/nodehost';
import { ROSTERS } from '../src/platform/research/teams';
bindEngine(Engine);
declare const process: any;
const file = process.argv[2];
const code = readFileSync(file, 'utf8');
console.log('hopeful sha256', createHash('sha256').update(code).digest('hex'));
const m = await moduleMeta(nodeSpawn, code);
assert.ok(m.meta, m.error);
console.log('meta', JSON.stringify({ id: m.meta!.id, version: m.meta!.version, timeLimitMs: m.meta!.timeLimitMs, apiMinor: m.meta!.apiMinor, hooks: m.meta!.hooks }));
const entry = { id: m.meta!.id, name: m.meta!.name, kind: 'strategy', implementation: 'strategy:' + m.meta!.id, version: m.meta!.version, description: '', code, timeLimitMs: m.meta!.timeLimitMs, apiMinor: m.meta!.apiMinor } as unknown as CoachEntry;
function setupState(format: 'standard' | 'sevens'): GameState {
  const cm = Engine.createMatch('tournament', ROSTERS.human[format](), ROSTERS.orc[format](), { rules: 'introductory' }, 5);
  assert.ok(cm.ok); const s = cm.state as GameState; s.phase = 'driveSetup'; s.match!.kicking = 'A'; s.match!.setupDone = { A: false, B: false }; return s;
}
for (const fmt of ['standard', 'sevens'] as const) {
  const s = setupState(fmt);
  const st = new CoachContextStore();
  const t0 = Date.now();
  const r = await platformDecide(s, 'A', entry, { spawn: nodeSpawn, context: st.ticket('A', entry.id) });
  const req = buildSetupRequest(s, 'A');
  const input = (r.move as any)?.input;
  const moved = Object.keys(req.defaultPositions).filter((id) => JSON.stringify(req.defaultPositions[id]) !== JSON.stringify(input?.positions?.[id]));
  console.log(`${fmt}: via=${r.meta.via} setup=${JSON.stringify(r.meta.setup)} fellBack=${r.meta.fellBack} reason=${r.meta.reason} moved=${moved.length} context=${JSON.stringify(r.meta.context)} ${Date.now() - t0} ms`);
  assert.equal(Engine.matchInputReason(s, input), null, 'the formation Hopeful gave (or the default) is legal');
  console.log('   stored context keys:', Object.keys((st.peek('A', entry.id) as object) ?? {}));
  console.log('   why:', String(r.meta.why ?? '').slice(0, 160));
}
// one real action request, in a play-phase position reached with the built-in coach (both sides)
import { nextMove, waitingFor } from '../src/ai/index';
const cm = Engine.createMatch('tournament', ROSTERS.human.sevens(), ROSTERS.orc.sevens(), { rules: 'introductory' }, 9);
assert.ok(cm.ok);
let cur = cm.state as GameState;
for (let i = 0; i < 200 && !(cur.phase === 'play' && !cur.pending && cur.turn.activation === null && cur.teams[cur.turn.active].turn >= 1 && !cur.match?.pendingPhase); i++) {
  const who = waitingFor(cur);
  let out: Engine.ExecutionResult;
  if (!who) out = Engine.execute(cur, cur.phase === 'pregame' ? { kind: 'pregame' } : { kind: 'nextDrive' });
  else { const mv = nextMove(cur, who, 'balanced', {})!; out = mv.type === 'decision' ? Engine.decide(cur, { requestId: mv.requestId, optionId: mv.optionId }) : Engine.execute(cur, mv.input as never); }
  assert.notEqual(out.status, 'illegal'); cur = out.state as GameState;
}
console.log('reached phase', cur.phase, 'active', cur.turn.active);
const t0 = Date.now();
const st = new CoachContextStore();
const r = await platformDecide(cur, cur.turn.active, entry, { spawn: nodeSpawn, context: st.ticket(cur.turn.active, entry.id) });
console.log(`action: via=${r.meta.via} fellBack=${r.meta.fellBack} reason=${r.meta.reason} elapsed=${Date.now() - t0} ms allowance=${r.meta.allowanceMs} context=${JSON.stringify(r.meta.context)} diagnostics=${r.meta.diagnostics.filter((d) => d.code === 'timeout' || d.code === 'module-error').length} timeouts/errors`);
console.log('   chosen:', (r.move as any)?.type, String((r.move as any)?.why ?? '').slice(0, 140));
assert.ok(r.move);
console.log('SMOKE OK');
