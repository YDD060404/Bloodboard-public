/**
 * V6 architecture acceptance: ONE mechanic goes through the whole API-v2 path with no mechanic-specific host code —
 * legal discovery → validation → controlled simulation (fork) → execution → receipt → Replay — in a real match
 * (createMatch → engine-driven play). The driver below only reads the registry-described parameters; it never names a mechanic.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Engine from '../src/engine/index';
import { bindEngine, nextMove, waitingFor } from '../src/ai/index';
import { Session, callService } from '../src/platform/index';
import { receipt } from '../src/platform/v2obs';
import { MECHANICS } from '../src/platform/choices';

bindEngine(Engine);

function playPosition() {
  const a = Engine.builtinTeam('human', { format: 'sevens', play: 'exhibition', id: 'a', name: 'A' })!;
  const b = Engine.builtinTeam('orc', { format: 'sevens', play: 'exhibition', id: 'b', name: 'B' })!;
  const r = Engine.createMatch('tournament', a, b, { rules: 'full', play: 'exhibition' }, 4242);
  let s = r.state!;
  s = Engine.execute(s, { kind: 'pregame' }).state;
  for (let i = 0; i < 40 && s.phase !== 'play'; i++) {
    const w = waitingFor(s);
    if (!w) { s = Engine.execute(s, { kind: 'nextDrive' }).state; continue; }
    const mv = nextMove(s, w, 'balanced')!;
    s = (mv.type === 'decision' ? Engine.decide(s, { requestId: mv.requestId, optionId: mv.optionId }) : Engine.execute(s, mv.input)).state;
  }
  assert.equal(s.phase, 'play');
  return s;
}

type Any = Record<string, any>;

test('acceptance: discovery → validate → fork → execute → receipt → Replay, driven only by the choice registry', () => {
  const s0 = playPosition();
  const team = s0.turn.active;
  const ses = new Session(s0, team, 31, 30000);
  const call = (n: string, ...a: unknown[]) => callService(ses, n, a) as Any;
  const lc = call('legalChoices');
  assert.equal(lc.node, 'action');
  const registered = new Set(MECHANICS.map((m) => m.id));
  // every mechanic the engine offers is in the registry (no hidden ones)
  assert.deepEqual(lc.coverage.notes.filter((n: string) => /Unregistered/.test(n)), []);
  let chosen: { input: Engine.ActionInput; type: string } | null = null;
  const proven: string[] = [];
  for (const ch of lc.choices.filter((c: Any) => c.enabled && registered.has(c.type))) {
    const actor = ch.actors.find((a: Any) => a.enabled).playerId;
    const input: Any = { ...ch.skeleton, playerId: actor };
    let ok = true;
    for (const p of ch.params.filter((x: Any) => x.required)) {
      const t = call('legalTargets', { choice: ch.type, param: p.name, actor, partial: input, limit: 5 });
      if (!t.ok || !t.values.length) { ok = false; break; }
      input[p.name] = t.values[0].value;
    }
    if (!ok) continue;
    if (ch.path?.allowed && ch.params.some((x: Any) => x.kind === 'path')) {
      const reach = call('legalTargets', { choice: ch.type, param: 'path', actor, partial: input, limit: 3 });
      const step = reach.values?.find((v: Any) => v.reason?.startsWith('1 step'));
      if (step && ch.type === 'move') input.path = [{ to: step.value, kind: 'step' }];
    }
    const v = call('validate', input);
    if (!v.legal) continue;
    const f = call('fork.open', { input });
    if (!f.ok) continue;
    let n = f;
    let guard = 0;
    while (n.node !== 'terminal' && guard++ < 60) n = call('fork.step', { fork: f.fork, branch: n.node === 'decision' ? n.defaultBranch : 0 });
    if (n.node !== 'terminal') continue;
    proven.push(ch.type);
    if (!chosen) chosen = { input: input as Engine.ActionInput, type: ch.type };
  }
  assert.ok(chosen, 'at least one mechanic completed the path');
  assert.ok(proven.length >= 1);
  // execute with the real dice, then the receipt, then Replay of the resulting match
  let res = Engine.execute(s0, chosen!.input);
  assert.notEqual(res.status, 'illegal', res.error);
  let s1 = res.state;
  while (s1.pending) s1 = Engine.decide(s1, { requestId: s1.pending.request.id, optionId: s1.pending.request.options[0].id }).state;
  const rc = receipt(s0, s1, { requestId: 31, input: chosen!.input, coach: 'acceptance', via: chosen!.type, fellBack: false, reason: null });
  assert.equal(rc.schema, 'bloodboard-receipt/1');
  assert.equal(rc.accepted, true);
  assert.ok(rc.entries.length >= 1 && rc.historyTo === s1.log.length);
  assert.ok(rc.entries[0].events.length >= 1);
  assert.ok(!/"rng"|"seed"|"counter"/.test(JSON.stringify(rc)), 'no dice internals in a receipt');
  const save = Engine.toSaveFile(s1, 'acceptance', '', {});
  const parsed = Engine.parseSaveFile(JSON.stringify(save));
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  const a = Engine.assessReplay(parsed.save.state);
  assert.match(a.assessment.grade, /^replayable/, `${a.assessment.grade}: ${a.assessment.reason}`);
});
