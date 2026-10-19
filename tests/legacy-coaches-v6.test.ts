/** V6 regression: the repository's legacy strategy coaches (apiVersion 1) still decide through the shared host — one set-up and one action each. Not a strength benchmark. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as Engine from '../src/engine/index';
import type { GameState } from '../src/engine/index';
import { bindEngine, nextMove, waitingFor, type CoachEntry } from '../src/ai/index';
import { platformDecide, moduleMeta } from '../src/platform/host';
import { CoachContextStore } from '../src/platform/hostext';
import { nodeSpawn } from '../src/platform/research/nodehost';
import { ROSTERS } from '../src/platform/research/teams';
bindEngine(Engine);

const FILES = ['ai-models/hopeful/hopeful-0-2.js', 'ai-models/vanguard/vanguard-2-0.js'];

function playPosition(): GameState {
  const cm = Engine.createMatch('tournament', ROSTERS.human.sevens(), ROSTERS.orc.sevens(), { rules: 'introductory' }, 9);
  assert.ok(cm.ok);
  let cur = cm.state as GameState;
  for (let i = 0; i < 200 && !(cur.phase === 'play' && !cur.pending && cur.turn.activation === null && cur.teams[cur.turn.active].turn >= 1 && !cur.match?.pendingPhase); i++) {
    const who = waitingFor(cur);
    let out: Engine.ExecutionResult;
    if (!who) out = Engine.execute(cur, cur.phase === 'pregame' ? { kind: 'pregame' } : { kind: 'nextDrive' });
    else { const mv = nextMove(cur, who, 'balanced', {})!; out = mv.type === 'decision' ? Engine.decide(cur, { requestId: mv.requestId, optionId: mv.optionId }) : Engine.execute(cur, mv.input as never); }
    assert.notEqual(out.status, 'illegal');
    cur = out.state as GameState;
  }
  return cur;
}

for (const f of FILES) {
  test(`legacy coach ${f}: loads as a v1 module and answers a legal action through the V6 host`, async () => {
    const code = readFileSync(f, 'utf8');
    const m = await moduleMeta(nodeSpawn, code);
    assert.ok(m.meta, m.error);
    assert.ok((m.meta!.apiVersion ?? 1) === 1, 'unchanged apiVersion 1 module');
    const entry = { id: m.meta!.id, name: m.meta!.name, kind: 'strategy', implementation: 'strategy:' + m.meta!.id, version: m.meta!.version, description: '', code, timeLimitMs: m.meta!.timeLimitMs, apiMinor: m.meta!.apiMinor } as unknown as CoachEntry;
    const cur = playPosition();
    const team = cur.turn.active;
    const store = new CoachContextStore();
    const r = await platformDecide(cur, team, entry, { spawn: nodeSpawn, context: store.ticket(team, entry.id) });
    assert.ok(r.move, 'a move');
    assert.ok(!r.meta.fellBack, `no fallback (${r.meta.reason})`);
    const mv = r.move as { type?: string; input?: Engine.ActionInput; optionId?: string };
    if (mv.input) assert.deepEqual(Engine.validateInput(cur, mv.input), [], 'legal per the engine');
  });
}
