/** The v2 schemas are the contract: real payloads from the host/engine must validate against them (no drift). */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Engine from '../src/engine/index';
import { bindEngine, nextMove, waitingFor } from '../src/ai/index';
import { Session, callService } from '../src/platform/index';
import { validate } from '../src/platform/jsonschema';
import { V2_SCHEMAS, V2_SCHEMA_NAMES } from '../src/platform/schemas-v2';
import { observeV2, receipt } from '../src/platform/v2obs';
import { buildSetupRequest, buildKickRequest } from '../src/platform/hostext';

bindEngine(Engine);
type Any = Record<string, any>;
const ok = (name: string, v: unknown) => { const e = validate(V2_SCHEMAS[name], v); assert.deepEqual(e.slice(0, 5), [], `${name}: ${e.slice(0, 5).join(' | ')}`); };

function position(stopAt: 'play' | 'driveSetup' | 'kickoff') {
  const a = Engine.builtinTeam('human', { format: 'sevens', play: 'exhibition', id: 'a', name: 'A' })!;
  const b = Engine.builtinTeam('orc', { format: 'sevens', play: 'exhibition', id: 'b', name: 'B' })!;
  let s = Engine.createMatch('tournament', a, b, { rules: 'full', play: 'exhibition' }, 777).state!;
  s = Engine.execute(s, { kind: 'pregame' }).state;
  for (let i = 0; i < 60 && s.phase !== stopAt; i++) {
    const w = waitingFor(s);
    if (!w) { s = Engine.execute(s, { kind: 'nextDrive' }).state; continue; }
    const mv = nextMove(s, w, 'balanced')!;
    s = (mv.type === 'decision' ? Engine.decide(s, { requestId: mv.requestId, optionId: mv.optionId }) : Engine.execute(s, mv.input)).state;
  }
  return s;
}

test('schema names are published', () => {
  for (const n of ['observationV2', 'legalChoices', 'legalTargets', 'forkNode', 'receipt', 'rosterRequest', 'buildRequest', 'setupRequestV2', 'kickRequest']) assert.ok(V2_SCHEMA_NAMES.includes(n), n);
});

test('observation, legalChoices, legalTargets, fork nodes and receipt validate against real runtime payloads', () => {
  const s0 = position('play');
  assert.equal(s0.phase, 'play');
  const team = s0.turn.active;
  ok('observationV2', observeV2(s0, team, 5, { sinceLog: 0 }));
  const ses = new Session(s0, team, 5, 30000);
  const call = (n: string, ...a: unknown[]) => callService(ses, n, a) as Any;
  const lc = call('legalChoices');
  ok('legalChoices', lc);
  let input: Any | null = null;
  let targets = 0;
  for (const ch of lc.choices.filter((c: Any) => c.enabled)) {
    const actor = ch.actors.find((a: Any) => a.enabled)?.playerId;
    const cand: Any = { ...ch.skeleton, playerId: actor };
    let good = true;
    for (const p of ch.params.filter((x: Any) => x.required && x.kind !== 'path')) {
      const t = call('legalTargets', { choice: ch.type, param: p.name, actor, partial: cand, limit: 5 });
      ok('legalTargets', t); targets++;
      if (!t.values.length) { good = false; break; }
      cand[p.name] = t.values[0].value;
    }
    if (good && call('validate', cand).legal) { input = cand; break; }
  }
  assert.ok(targets >= 0);
  assert.ok(input, 'a legal input exists');
  const f = call('fork.open', { input });
  ok('forkNode', f);
  let n = f; const kinds = new Set<string>([f.node]);
  for (let g = 0; n.node !== 'terminal' && g < 60; g++) { n = call('fork.step', { fork: f.fork, branch: n.node === 'decision' ? n.defaultBranch : 0 }); ok('forkNode', n); kinds.add(n.node); }
  assert.ok(kinds.has('terminal'));
  let s1 = Engine.execute(s0, input as Engine.ActionInput).state;
  while (s1.pending) s1 = Engine.decide(s1, { requestId: s1.pending.request.id, optionId: s1.pending.request.options[0].id }).state;
  ok('receipt', receipt(s0, s1, { requestId: 5, input: input as Engine.ActionInput, coach: 'x', via: 'candidate', fellBack: false, reason: null }));
  ok('observationV2', observeV2(s1, team, 6, { sinceLog: s0.log.length }));
});

test('set-up (fixed and free), kick and roster / build requests validate', () => {
  const sd = position('driveSetup');
  assert.equal(sd.phase, 'driveSetup', 'reached set-up');
  const st = (sd.match?.kicking === 'A' ? 'B' : 'A') as 'A' | 'B';
  for (const t of ['A', 'B'] as const) { ok('setupRequestV2', buildSetupRequest(sd, t, { free: true })); ok('setupRequestV2', buildSetupRequest(sd, t, {})); }
  void st;
  const rosters = Engine.rosterInfos('sevens', 'exhibition');
  ok('rosterRequest', { format: 'sevens', play: 'exhibition', mode: 'blind', rosters });
  const info = rosters.find((r: Any) => r.draftable)!;
  const ref = Engine.builtinTeam(info.id, { format: 'sevens', play: 'exhibition', id: 'a', name: 'A' });
  ok('buildRequest', { rosterId: info.id, format: 'sevens', play: 'exhibition', budget: Engine.teamBudget(ref!), roster: info, template: Engine.SEVENS_DRAFT, builtinTeam: ref });
  const sk = position('kickoff');
  assert.equal(sk.phase, 'kickoff', 'reached kick-off');
  ok('kickRequest', buildKickRequest(sk, sk.match!.kicking as 'A' | 'B'));
});
