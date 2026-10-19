/**
 * V6 lifecycle with API v2 coaches through the real host (worker transport): capability negotiation, roster choice
 * (blind/sequential), team building validated by the engine with a bounded correction loop, free fielding with the engine's
 * set-up check, kick placement, controlled simulation from a module, and the minimal coach through legal-choice discovery.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as Engine from '../src/engine/index';
import { bindEngine, type CoachEntry } from '../src/ai/index';
import { moduleMeta, platformDecide } from '../src/platform/host';
import { negotiate } from '../src/platform/capabilities';
import { buildTeamFor, chooseRoster } from '../src/platform/lifecycle';
import { nodeSpawn } from '../src/platform/research/nodehost';
import { c, Pos } from './helpers';

bindEngine(Engine);

const load = async (file: string): Promise<CoachEntry> => {
  const code = readFileSync(file, 'utf8');
  const m = await moduleMeta(nodeSpawn, code);
  assert.ok(m.meta, m.error);
  const neg = negotiate({ apiVersion: m.meta!.apiVersion, hooks: m.meta!.hooks, declaredCapabilities: m.meta!.declaredCapabilities, requiresCapabilities: m.meta!.requiresCapabilities, contextSchema: m.meta!.contextSchema });
  assert.deepEqual(neg.errors, [], neg.errors.join());
  return { id: m.meta!.id, name: m.meta!.name, kind: 'strategy', implementation: `strategy:${m.meta!.id}`, version: m.meta!.version ?? '?', description: '', code, timeLimitMs: m.meta!.timeLimitMs, apiMinor: m.meta!.apiMinor, apiGeneration: m.meta!.apiVersion, contextSchema: m.meta!.contextSchema, capabilities: neg.capabilities };
};
const deps = { spawn: nodeSpawn };

test('negotiation: hooks found, undeclared opt-outs honoured, a declared-but-missing capability is an error, legacy modules get no v2 hooks', () => {
  const hooks = { action: true, decision: true, setup: false };
  assert.equal(negotiate({ apiVersion: 2, hooks }).capabilities.playTurn, true);
  assert.equal(negotiate({ apiVersion: 2, hooks, declaredCapabilities: { playTurn: false } }).capabilities.playTurn, false);
  assert.match(negotiate({ apiVersion: 2, hooks, declaredCapabilities: { chooseRoster: true } }).errors[0], /declares the capability "chooseRoster"/);
  assert.match(negotiate({ apiVersion: 2, hooks, requiresCapabilities: ['nothing'] }).errors[0], /does not know/);
  const legacy = negotiate({ apiVersion: 1, hooks: { action: true, decision: true, setup: true, roster: true } }).capabilities;
  assert.equal(legacy.chooseRoster, false);
  assert.equal(legacy.chooseSetup, true);
});

test('roster choice: built-in baseline is deterministic and draftable; a coach answer is validated; sequential passes the opponent', async () => {
  const a = await chooseRoster(deps, { format: 'sevens', play: 'exhibition', mode: 'blind', deterministic: true });
  const b = await chooseRoster(deps, { format: 'sevens', play: 'exhibition', mode: 'blind', deterministic: true });
  assert.equal(a.choice.rosterId, b.choice.rosterId);
  assert.equal(a.report.via, 'builtin');
  const coach = await load('examples/ai/api-v2/team-builder-example.js');
  const r = await chooseRoster(deps, { format: 'sevens', play: 'exhibition', mode: 'sequential', opponentRoster: 'lizardmen', entry: coach });
  assert.equal(r.report.via, 'coach');
  assert.notEqual(r.choice.rosterId, 'lizardmen');
});

test('team build: the engine rejects the coach\'s over-budget team with structured violations; the corrected one is accepted (2 attempts)', async () => {
  const coach = await load('examples/ai/api-v2/team-builder-example.js');
  const r = await buildTeamFor(deps, { rosterId: 'human', format: 'sevens', play: 'exhibition', id: 'ai-1', entry: coach });
  assert.equal(r.report.via, 'coach', JSON.stringify(r.report));
  assert.ok(r.report.attempts >= 1 && r.report.attempts <= 2);
  assert.equal(Engine.validateBuild(r.team).ok, true);
  if (r.report.attempts === 2) assert.ok(r.report.rejected[0].length > 0 && r.report.rejected[0][0].code);
});

test('team build: a coach that never gets legal falls back to the BUILT-IN builder (never a saved team), and says so', async () => {
  const bad = `bloodboard.register({ id:'bad-builder', name:'Bad', apiVersion:2, version:'1', timeLimitMs:3000, capabilities:{buildTeam:true}, buildTeam(o, r) { const t = JSON.parse(JSON.stringify(r.builtinTeam)); t.rerolls = 99; return { team: t }; } });`;
  const m = await moduleMeta(nodeSpawn, bad);
  const entry: CoachEntry = { id: 'bad-builder', name: 'Bad', kind: 'strategy', implementation: 'strategy:bad-builder', version: '1', description: '', code: bad, timeLimitMs: 3000, apiGeneration: 2, capabilities: negotiate({ apiVersion: 2, hooks: m.meta!.hooks, declaredCapabilities: m.meta!.declaredCapabilities }).capabilities };
  const notes: string[] = [];
  const r = await buildTeamFor({ ...deps, note: (w) => notes.push(w) }, { rosterId: 'human', format: 'sevens', play: 'exhibition', id: 'ai-2', entry });
  assert.equal(r.report.via, 'builtin');
  assert.equal(r.report.fellBack, true);
  assert.equal(r.report.attempts, 3);
  assert.equal(r.report.rejected.length, 3);
  assert.ok(r.report.rejected[0].some((v) => v.level === 'error'));
  assert.equal(Engine.validateBuild(r.team).ok, true);
  assert.ok(notes.length === 1);
});

test('team build: a coach without the hook, or a legacy module, gets the built-in builder with no fallback noise', async () => {
  const r = await buildTeamFor(deps, { rosterId: 'orc', format: 'standard', play: 'exhibition', id: 'ai-3', entry: null });
  assert.equal(r.report.via, 'builtin');
  assert.equal(r.report.fellBack, false);
  assert.equal(Engine.validateBuild(r.team).ok, true);
});

function drivePosition() {
  const a = Engine.buildTeam('human', { format: 'sevens', play: 'exhibition', id: 'ta', name: 'Humans' })!;
  const b = Engine.buildTeam('orc', { format: 'sevens', play: 'exhibition', id: 'tb', name: 'Orcs' })!;
  const res = Engine.createMatch('tournament', a, b, { rules: 'full', play: 'exhibition' }, 77);
  assert.ok(res.ok && res.state, res.errors.join());
  let s = res.state!;
  s = Engine.execute(s, { kind: 'pregame' }).state;
  if (s.pending) s = Engine.decide(s, { requestId: s.pending.request.id, optionId: 'kick' }).state;
  return s;
}

test('free fielding: an API v2 coach chooses WHICH players take the pitch; the engine checks the formation; legacy fixed-roster set-up unchanged', async () => {
  const coach = await load('examples/ai/api-v2/team-builder-example.js');
  const s = drivePosition();
  assert.equal(s.phase, 'driveSetup');
  const team = s.match!.kicking as 'A' | 'B';
  const r = await platformDecide(s, team, coach, { spawn: nodeSpawn });
  assert.equal(r.meta.fellBack, false, JSON.stringify(r.meta.setup) + r.meta.reason);
  assert.equal(r.meta.setup?.accepted, true);
  assert.equal(r.move?.type, 'step');
  const placed = Object.entries((r.move as { input: { positions: Record<string, unknown> } }).input.positions).filter(([, v]) => v);
  const cands = Engine.setupCandidates(s, team).sort((x, y) => x.number - y.number).slice(0, placed.length).map((p) => p.id);
  assert.deepEqual(placed.map(([id]) => id).sort(), cands.slice().sort());
});

test('kick placement: the coach\'s kicker and target are validated by the engine; an illegal kick falls back to the built-in placement', async () => {
  const coach = await load('examples/ai/api-v2/team-builder-example.js');
  let s = drivePosition();
  for (const t of [s.match!.kicking as 'A' | 'B', (s.match!.kicking === 'A' ? 'B' : 'A') as 'A' | 'B']) {
    const mv = await platformDecide(s, t, coach, { spawn: nodeSpawn });
    s = Engine.execute(s, (mv.move as unknown as { input: Engine.ActionInput }).input).state;
  }
  assert.equal(s.phase, 'kickoff');
  const kicker = s.match!.kicking as 'A' | 'B';
  const r = await platformDecide(s, kicker, coach, { spawn: nodeSpawn });
  assert.equal(r.meta.kind, 'kick');
  assert.equal(r.meta.via, 'kick', r.meta.reason ?? '');
  assert.equal((r.move as { input: { kind: string } }).input.kind, 'kickoff');
  assert.equal(Engine.matchInputReason(s, (r.move as unknown as { input: Engine.MatchInput }).input), null);
});

test('minimal v2 coach: plays a Turn through legal-choice discovery only (no candidates), with persistent context and receipts-ready observation v2', async () => {
  const coach = await load('examples/ai/api-v2/minimal-coach-v2.js');
  const b = new Pos({ rerollsA: 1 });
  b.add('A', 'human', 'blitzer', c(9, 4), { id: 'bl' });
  b.add('B', 'orc', 'lineman', c(10, 5), { id: 'b3' });
  b.ball(c(2, 2));
  const s = b.start();
  const r = await platformDecide(s, 'A', coach, { spawn: nodeSpawn });
  assert.equal(r.meta.fellBack, false, r.meta.reason ?? '');
  assert.equal(r.move?.type, 'action');
  const inp = (r.move as { input: { action: string; blockTarget: string } }).input;
  assert.equal(inp.action, 'block');
  assert.equal(inp.blockTarget, 'b3');
});

test('controlled simulation example: explores a Block with fork handles and decides from its own risk estimate', async () => {
  const coach = await load('examples/ai/api-v2/controlled-simulation-example.js');
  const b = new Pos({ rerollsA: 1 });
  b.add('A', 'human', 'blitzer', c(9, 4), { id: 'bl' });
  b.add('B', 'orc', 'lineman', c(10, 5), { id: 'b3' });
  b.ball(c(2, 2));
  const s = b.start();
  const r = await platformDecide(s, 'A', coach, { spawn: nodeSpawn });
  assert.equal(r.meta.fellBack, false, r.meta.reason ?? '');
  assert.ok(r.meta.why && /Block|risky|Block/.test(r.meta.why), r.meta.why ?? '');
});
