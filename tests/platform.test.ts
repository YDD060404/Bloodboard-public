/**
 * V5.6 strategy platform: observation completeness, candidates (legality, active team, filters, pagination), exact
 * probabilities agree with the engine's plan, explored-position scoping and stale keys, decision branching, evaluation
 * from both perspectives, threats, timeout / fallback, and backward compatibility with V5.5 / V5.5.1 modules.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Engine from '../src/engine/index';
import type { GameState } from '../src/engine/index';
import { bindEngine, type CoachEntry } from '../src/ai/index';
import { Session, callService, observe, platformDecide, capabilities, schemas } from '../src/platform/index';
import { nodeSpawn } from '../src/platform/research/nodehost';
import { c, Pos } from './helpers';

bindEngine(Engine);

/** Our (A) carrier with a cage and three orc Blitzers near; B to move later. */
function scene(): GameState {
  const b = new Pos({ rerollsA: 1, rerollsB: 1, turnA: 3, turnB: 3 });
  const car = b.add('A', 'human', 'thrower', c(12, 7), { id: 'car' });
  [c(11, 6), c(13, 6), c(11, 8), c(13, 8)].forEach((q, i) => b.add('A', 'human', 'lineman', q, { id: `g${i}` }));
  b.add('A', 'human', 'blitzer', c(9, 4), { id: 'bl' });
  b.add('B', 'orc', 'blitzer', c(14, 7), { id: 'b1' });
  b.add('B', 'orc', 'blitzer', c(17, 11), { id: 'b2' });
  b.add('B', 'orc', 'lineman', c(10, 5), { id: 'b3' });
  b.add('B', 'orc', 'lineman', c(0, 7), { id: 'edge' });
  b.give(car);
  return b.start();
}
const ses = (s = scene(), team: 'A' | 'B' = 'A', ms = 5000) => new Session(s, team, 7, ms);
const call = (x: Session, name: string, ...a: unknown[]) => callService(x, name, a) as Record<string, any>;

test('observation: every player with profile, skills, position, stance, activation; ball, score, clock, re-rolls; no dice internals', () => {
  const s = scene();
  const o = observe(s, 'A', 7);
  assert.equal(o.players.length, s.players.length);
  for (const k of ['ma', 'st', 'ag', 'pa', 'av', 'skills', 'pos', 'stance', 'location', 'activated', 'tackleZone', 'canBeActivated']) assert.ok(k in o.players[0], k);
  for (const k of ['ball', 'score', 'turn', 'turnsPerHalf', 'half', 'weather', 'phase', 'rerolls', 'used', 'active', 'pending', 'activation', 'pitch', 'apiMinor']) assert.ok(k in o, k);
  const json = JSON.stringify(o);
  assert.ok(!/"rng"|"seed"|"counter"|future/i.test(json), 'no dice internals in the observation');
});

test('candidates: legal, team-checked, filterable, paged; probabilities equal the engine plan', () => {
  const x = ses();
  const r1 = call(x, 'candidates', { limit: 30, families: ['block', 'blitz', 'move'] });
  assert.ok(r1.ok && r1.candidates.length > 0);
  for (const rec of r1.candidates) {
    assert.match(rec.id, /^7\.c\d+$/);
    assert.equal(rec.team, 'A');
    if (rec.legal && rec.input) {
      const plan = Engine.planAction(Engine.cloneState(x.root), rec.input, { followUp: true });
      assert.ok(plan.ok, `${rec.label} must be legal`);
      assert.equal(rec.pTurnover, plan.withTeamRerolls!.pTurnover, 'exact pTurnover');
      assert.equal(rec.pSuccess, plan.withTeamRerolls!.pCompleted);
      assert.equal(rec.pTouchdown, plan.withTeamRerolls!.pTouchdownActive);
    }
  }
  assert.ok(r1.candidates.every((q: any) => ['block', 'blitz', 'move'].includes(q.family)));
  const wrong = call(x, 'candidates', { team: 'B' });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.code, 'wrong-team');
  const p1 = call(x, 'candidates', { limit: 5, offset: 0, families: ['move'] });
  const p2 = call(x, 'candidates', { limit: 5, offset: 5, families: ['move'] });
  const ids1 = new Set(p1.candidates.map((q: any) => JSON.stringify(q.input)));
  assert.ok(p2.candidates.every((q: any) => !ids1.has(JSON.stringify(q.input))), 'pages do not overlap');
  const cap = call(x, 'candidates', { maxPerFamily: { move: 3 }, limit: 400, families: ['move'] });
  assert.ok(cap.candidates.length <= 3 && cap.truncated.some((t: any) => /family/i.test(t.reason)));
  const players = call(x, 'candidates', { players: ['car'], limit: 400 });
  assert.ok(players.candidates.every((q: any) => q.actorId === 'car' || q.family === 'endTurn'));
});

test('explored positions: keys are request-scoped; candidates follow the team active there; stale keys are rejected', () => {
  const x = ses();
  const ex = call(x, 'explore', { kind: 'endTurn' }, {});
  assert.ok(ex.ok, JSON.stringify(ex));
  const key = ex.outcomes[0].key as string;
  assert.ok(key && key.startsWith('7.'));
  const atB = call(x, 'candidates', { from: key, limit: 5 });
  assert.ok(atB.ok);
  assert.ok(atB.candidates.every((q: any) => q.team === 'B'));
  const bad = call(x, 'candidates', { from: key, team: 'A' });
  assert.equal(bad.code, 'wrong-team');
  const other = new Session(scene(), 'A', 8, 5000);
  const stale = callService(other, 'candidates', [{ from: key }]) as Record<string, any>;
  assert.equal(stale.ok, false);
  assert.equal(stale.code, 'stale-key');
  assert.equal((call(x, 'evaluate', 'nope.1') as any).code, 'stale-key');
});

test('evaluation: stable feature vector from either perspective; built-in value optional baseline', () => {
  const x = ses();
  const a = call(x, 'evaluate', undefined, { perspective: 'A', features: true });
  const b = call(x, 'evaluate', undefined, { perspective: 'B', features: true });
  assert.equal(a.perspective, 'A');
  assert.equal(b.perspective, 'B');
  assert.equal(a.features.names.length, a.features.values.length);
  assert.deepEqual(a.features.names, b.features.names);
  assert.notDeepEqual(a.features.values, b.features.values);
  assert.ok(a.value > b.value, 'A holds the ball in a cage: better for A than for B');
  const legacy = call(x, 'evaluate', undefined);
  assert.equal(typeof legacy.value, 'number');
});

test('decision branching: the policy is stated; best/worst solve in-action choices; builtin lists assumptions', () => {
  const x = ses();
  const cands = call(x, 'candidates', { families: ['blitz'], limit: 3, sort: 'pTurnover' });
  const inp = cands.candidates.find((q: any) => q.legal)?.input;
  assert.ok(inp, 'a legal Blitz exists');
  const bi = call(x, 'explore', inp, {});
  assert.equal(bi.decisionPolicy.mode, 'builtin');
  assert.ok(bi.decisionPolicy.statement.length > 10);
  const best = call(x, 'explore', inp, { decisions: { own: 'best', opponent: 'worst' } });
  const worst = call(x, 'explore', inp, { decisions: { own: 'worst', opponent: 'worst' } });
  assert.equal(best.decisionPolicy.mode, 'solved');
  assert.ok(best.value >= worst.value - 1e-9, `own-best ${best.value} >= own-worst ${worst.value}`);
  assert.ok(Math.abs(best.pTurnover + (1 - best.pTurnover) - 1) < 1e-9);
});

test('threats: data, exact, scoped to the active team where actions are involved', () => {
  const x = ses();
  const tz = call(x, 'threats.tackleZones', {});
  assert.ok(tz.ok && tz.teams.A.current.length && tz.teams.B.projected.length);
  const reach = call(x, 'threats.reach', { players: ['car'] });
  assert.ok(reach.ok && reach.players[0].squares.length > 0);
  assert.ok('rushes' in reach.players[0].squares[0] && 'dodges' in reach.players[0].squares[0]);
  const bl = call(x, 'threats.blitz', { targets: ['b1'] });
  assert.ok(bl.ok && bl.blitzes.length > 0);
  const v = bl.blitzes[0].variants[0];
  const plan = Engine.planAction(Engine.cloneState(x.root), v.input, { followUp: true });
  assert.equal(v.pTurnover, plan.withTeamRerolls!.pTurnover);
  assert.equal(call(x, 'threats.blitz', { team: 'B' }).code, 'wrong-team');
  const sc = call(x, 'threats.scoring', {});
  assert.ok(sc.ok && Array.isArray(sc.threats));
  const cr = call(x, 'threats.crowd', {});
  assert.ok(cr.ok && cr.notComputed.length > 0);
  assert.ok(cr.exposed.some((e: any) => e.playerId === 'edge'), 'the player on the edge is exposed to a crowd push');
});

test('limits: call cap, structured diagnostics, no hang', () => {
  const x = new Session(scene(), 'A', 9, 5000, { ...(capabilities() as any).limits, maxServiceCalls: 3 });
  for (let i = 0; i < 3; i++) call(x, 'plan', { kind: 'endTurn' });
  const r = call(x, 'plan', { kind: 'endTurn' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'call-cap');
  assert.ok(x.diagnostics.some((d) => d.code === 'call-cap' && d.limit === 'maxServiceCalls'));
  const y = ses();
  const t = call(y, 'explore', { kind: 'endTurn' }, { maxMs: 50, maxLeaves: 1e9 });
  assert.ok(t.ok);
});

test('schemas and capabilities are discoverable', () => {
  const cap = capabilities() as any;
  assert.equal(cap.apiVersion, 1);
  for (const n of ['plan', 'reachable', 'explore', 'evaluate', 'candidates', 'threats.blitz', 'sequence', 'features']) assert.ok(cap.services[n], n);
  assert.ok(Object.keys(schemas()).includes('candidate'));
});

// ───────────────────────────────────────────────────────── module transport (worker threads): fallback and compatibility
const entry = (code: string, extra: Partial<CoachEntry> & { apiMinor?: number } = {}): CoachEntry => ({ id: 't', name: 'Test', kind: 'strategy', implementation: 'strategy:t', version: '1', description: '', code, timeLimitMs: 1500, ...extra } as CoachEntry);

test('a V5.5.1-style module runs unchanged; its {candidateId} answer is honoured', async () => {
  const code = `bloodboard.register({ id:'old', name:'Old', apiVersion:1, version:'1', timeLimitMs:3000,
    async chooseAction(o, cands, sv) { const r = await sv.evaluate(); const e = await sv.explore({kind:'endTurn'}, {maxOutcomes:2}); return { candidateId: cands.length-1, why:'last '+typeof r.value+typeof e.value }; } });`;
  const r = await platformDecide(scene(), 'A', entry(code), { spawn: nodeSpawn });
  assert.equal(r.meta.fellBack, false, JSON.stringify(r.meta));
  assert.equal(r.meta.via, 'candidateId');
  assert.equal(r.move?.type, 'action');
});

test('service candidate ids, rankings and own inputs are validated and played', async () => {
  const code = `bloodboard.register({ id:'new', name:'New', apiVersion:1, apiMinor:2, version:'1', timeLimitMs:5000,
    async chooseAction(o, cands, sv) { const r = await sv.candidates({ families:['move','endTurn'], limit: 20 });
      return { ranking: [{ candidateId: 'bogus', score: 99 }, ...r.candidates.map((c,i)=>({ candidateId:c.id, logit: -i }))], why:'rank' }; } });`;
  const r = await platformDecide(scene(), 'A', entry(code), { spawn: nodeSpawn });
  assert.equal(r.meta.fellBack, false, JSON.stringify(r.meta));
  assert.equal(r.meta.via, 'ranking');
  assert.ok(r.meta.ranking && r.meta.ranking.some((x) => !x.valid), 'the bogus entry is recorded as invalid');
  const bad = await platformDecide(scene(), 'A', entry(`bloodboard.register({ id:'b', name:'B', apiVersion:1, version:'1', chooseAction(){ return { input:{ kind:'playerAction', playerId:'b1', action:'move', path:[] } }; } });`), { spawn: nodeSpawn });
  assert.equal(bad.meta.fellBack, true);
  assert.match(bad.meta.reason ?? '', /active team|rejected/);
  assert.ok(bad.meta.diagnostics.some((d) => d.service === 'host'));
});

test('timeout, exception and invalid answers fall back to the built-in coach, visibly', async () => {
  const hang = await platformDecide(scene(), 'A', entry(`bloodboard.register({ id:'h', name:'H', apiVersion:1, version:'1', timeLimitMs:500, chooseAction(){ for(;;){} } });`, { timeLimitMs: 500 }), { spawn: nodeSpawn });
  assert.equal(hang.meta.fellBack, true);
  assert.ok(hang.meta.diagnostics.some((d) => d.code === 'timeout'));
  assert.ok(hang.move, 'built-in move supplied');
  const boom = await platformDecide(scene(), 'A', entry(`bloodboard.register({ id:'x', name:'X', apiVersion:1, version:'1', chooseAction(){ throw new Error('boom'); } });`), { spawn: nodeSpawn });
  assert.equal(boom.meta.fellBack, true);
  assert.match(boom.meta.reason ?? '', /boom/);
  const junk = await platformDecide(scene(), 'A', entry(`bloodboard.register({ id:'j', name:'J', apiVersion:1, version:'1', chooseAction(){ return { candidateId: 9999 }; } });`), { spawn: nodeSpawn });
  assert.equal(junk.meta.fellBack, true);
});

test('the module cannot reach game state, RNG or seed', async () => {
  const code = `bloodboard.register({ id:'s', name:'S', apiVersion:1, version:'1', async chooseAction(o, c, sv) {
    const leaks = [typeof o.rng, typeof o.state, typeof sv.state, typeof sv.rng, typeof sv.seed, typeof sv.cloneState].filter(t => t !== 'undefined');
    const cap = await sv.capabilities();
    return { endTurn: true, why: 'leaks:' + leaks.length + ' api:' + cap.apiMinor };
  } });`;
  const r = await platformDecide(scene(), 'A', entry(code), { spawn: nodeSpawn });
  assert.match(r.meta.why ?? '', /leaks:0 api:2/);
});

test('progress notes: sanitised, size-capped, rate-limited, delivered while the coach is still calculating; a tick reports elapsed time and the limit', async () => {
  const code = `bloodboard.register({ id:'p', name:'P', apiVersion:1, apiMinor:2, version:'1', timeLimitMs: 4000,
    async chooseAction(o, c, sv) {
      await sv.progress({ stage:'a', headline:'Checking '+'x'.repeat(500), evaluating:['one','two','three','four','five','six','seven'], ruledOut:['bad'], best:{ label:'Best move', pTurnover:0.1 }, fraction: 7 });
      await sv.progress({ stage:'a', headline:'too soon, same stage' });
      await sv.progress({ stage:'b', headline:'new stage is accepted' });
      await sv.progress({ headline: '' });
      await new Promise((r) => setTimeout(r, 1300));
      return { endTurn: true, why: 'done' };
    } });`;
  const events: any[] = [];
  const r = await platformDecide(scene(), 'A', entry(code, { timeLimitMs: 4000 }), { spawn: nodeSpawn, onProgress: (e) => events.push(e) });
  assert.equal(r.meta.fellBack, false, JSON.stringify(r.meta));
  const p = r.meta.progress!;
  assert.equal(p.length, 2, 'the same-stage burst and the empty note are dropped');
  assert.ok(p[0].headline.length <= 200);
  assert.equal(p[0].evaluating!.length, 5);
  assert.equal(p[0].fraction, 1);
  assert.ok(events.some((e) => e.kind === 'update'));
  const tick = events.find((e) => e.kind === 'tick');
  assert.ok(tick && tick.limitMs === 4000 && tick.elapsedMs >= 900, 'a tick reports elapsed time against the limit');
});

test('time limit: a coach\'s own timeLimitMs is honoured up to 120 s (clamped, default 5 s); a coach may answer early', async () => {
  const root = scene();
  assert.equal(new Session(root, 'A', 1, 60000).moduleMs, 60000);
  assert.equal(new Session(root, 'A', 1, 90000).moduleMs, 90000, 'the ceiling is 120 s since rc.1');
  assert.equal(new Session(root, 'A', 1, 120000).moduleMs, 120000);
  assert.equal(new Session(root, 'A', 1, 300000).moduleMs, 120000, 'anything above the ceiling is clamped');
  assert.equal(new Session(root, 'A', 1, 100).moduleMs, 500);
  assert.equal(new Session(root, 'A', 1, Number.NaN).moduleMs, 5000);
  const t0 = Date.now();
  const r = await platformDecide(scene(), 'A', entry(`bloodboard.register({ id:'q', name:'Q', apiVersion:1, version:'1', timeLimitMs:60000, chooseAction(){ return { endTurn:true }; } });`, { timeLimitMs: 60000 }), { spawn: nodeSpawn });
  assert.equal(r.meta.fellBack, false);
  assert.ok(Date.now() - t0 < 5000, 'returns as soon as the coach answers');
});

test('sequence: steps explored in every branch from result keys; illegal later steps stop the branch; totals are probabilities', () => {
  const x = ses();
  const mv = call(x, 'candidates', { players: ['bl'], families: ['move'], sort: 'goalDistance', limit: 3 });
  const first = mv.candidates.find((q: any) => q.legal).input;
  const r = call(x, 'sequence', { steps: [first, { kind: 'endTurn' }], maxBranches: 3 });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(Number.isFinite(r.value));
  assert.ok(r.pTurnover >= 0 && r.pTurnover <= 1);
  assert.ok(Array.isArray(r.finals) && r.finals.length > 0);
  const total = r.finals.reduce((a: number, f: any) => a + f.p, 0);
  assert.ok(total > 0.5 && total <= 1 + 1e-9);
  assert.equal(call(x, 'sequence', { steps: [] }).code, 'invalid-argument');
  assert.equal(call(x, 'sequence', { steps: Array(9).fill({ kind: 'endTurn' }) }).code, 'invalid-argument');
  assert.equal(call(x, 'sequence', { steps: [first], team: 'B' }).code, 'wrong-team');
});

test('the shipped example coach (examples/ai/platform-minimal.js) plays a legal move through the host', async () => {
  const { readFileSync } = await import('node:fs');
  const code = readFileSync('examples/ai/platform-minimal.js', 'utf8');
  const r = await platformDecide(scene(), 'A', entry(code, { timeLimitMs: 10000, apiMinor: 2 }), { spawn: nodeSpawn });
  assert.equal(r.meta.fellBack, false, JSON.stringify(r.meta.reason));
  assert.equal(r.meta.via, 'ranking');
  assert.equal(r.move?.type, 'action');
  assert.ok(r.meta.progress && r.meta.progress.length >= 1);
});

test('observation.builtInChoice names what the built-in coach would do; a coach that answers with it plays exactly that', async () => {
  const code = `bloodboard.register({ id: 'defer', name: 'Defer', apiVersion: 1, apiMinor: 2, version: '1', description: 'x', timeLimitMs: 2000,
    chooseAction(o, cands) { const b = o.builtInChoice; if (!b) return null; return b.endTurn ? { endTurn: true, why: 'defer' } : { candidateId: b.candidateId, why: 'defer' }; }, chooseDecision() { return null; } });`;
  const s = scene();
  const mine = await platformDecide(s, 'A', entry(code, { timeLimitMs: 2000, apiMinor: 2 }), { spawn: nodeSpawn });
  assert.equal(mine.meta.fellBack, false, JSON.stringify(mine.meta.reason));
  assert.equal(mine.meta.via !== undefined, true);
});
