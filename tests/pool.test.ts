/**
 * V5.7 engine pool: analysis keys, equivalence of pooled and inline results, batch service, cancellation, worker
 * failure fallback, stripped-state (no dice generator) equivalence of the built-in coach and of the planner.
 * The pool tests need the worker bundle (build/engine-worker.js, built by scripts/run-tests.mjs); they are skipped without it.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import * as Engine from '../src/engine/index';
import type { GameState } from '../src/engine/index';
import { bindEngine, nextMove } from '../src/ai/index';
import { Session, callService, callServiceAsync, forWorker, analysisHash, PlanCache, platformDecide } from '../src/platform/index';
import { nodeSpawn } from '../src/platform/research/nodehost';
import type { CoachEntry } from '../src/ai/index';
import { makeNodePool } from '../src/platform/research/nodepool';
import { c, Pos } from './helpers';

bindEngine(Engine);

function scene(): GameState {
  const b = new Pos({ rerollsA: 1, rerollsB: 1, turnA: 3, turnB: 3 });
  const car = b.add('A', 'human', 'thrower', c(12, 7), { id: 'car' });
  [c(11, 6), c(13, 6), c(11, 8), c(13, 8)].forEach((q, i) => b.add('A', 'human', 'lineman', q, { id: `g${i}` }));
  b.add('A', 'human', 'blitzer', c(9, 4), { id: 'bl' });
  b.add('B', 'orc', 'blitzer', c(14, 7), { id: 'b1' });
  b.add('B', 'orc', 'lineman', c(10, 5), { id: 'b3' });
  b.give(car);
  return b.start();
}

const WORKER = ['build/engine-worker.js', 'dist/web/engine-worker.js'].find((f) => existsSync(f));
const skip = WORKER ? false : 'engine worker bundle not built';
/** Pool tests run only when the worker bundle exists. */
const ptest = (name: string, fn: () => Promise<void>) => test(name, skip ? () => undefined : fn);
let seq = 500;
const mk = (s = scene()) => new Session(s, 'A', ++seq, 20000);
/** Comparable form: rounded numbers, without the request-specific candidate ids and timings. */
const digest = (x: unknown) => JSON.stringify(x, (k, v) => (k === 'elapsedMs' || k === 'id' || k === 'ms' || k === 'millis' ? undefined : typeof v === 'number' ? Math.round(v * 1e9) / 1e9 : v));

test('analysis hash ignores dice generator and log, reacts to rules / resources', () => {
  const a = scene();
  const h = analysisHash(a);
  const b = JSON.parse(JSON.stringify(a)) as GameState;
  (b as any).rng = { seed: 99, counter: 7 };
  (b as any).log = [{ kind: 'x' }];
  assert.equal(analysisHash(b), h);
  const r = JSON.parse(JSON.stringify(a)) as GameState;
  r.teams.A.rerolls += 1;
  assert.notEqual(analysisHash(r), h, 're-rolls change the key');
  const w = JSON.parse(JSON.stringify(a)) as GameState;
  (w as any).variant = 'sevens';
  assert.notEqual(analysisHash(w), h, 'rules change the key');
});

test('forWorker removes the dice generator and the log', () => {
  const s = scene();
  const f = forWorker(s);
  assert.deepEqual((f as any).rng, { seed: 0, counter: 0 });
  assert.equal((f as any).log.length, 0);
  assert.equal(JSON.stringify(f).includes(String((s as any).rng.seed) + ','), false);
});

test('plan cache: an inexact entry answers a smaller cap only, different policy or threshold does not', () => {
  const pc = new PlanCache<any>();
  const input = { kind: 'move' };
  pc.set('h', input, { maxLeaves: 5000, followUp: true, threshold: 0 } as any, { ok: true, withTeamRerolls: { unresolved: 0.1 }, withoutTeamRerolls: null });
  assert.ok(pc.get('h', input, { maxLeaves: 1000, followUp: true, threshold: 0 } as any));
  assert.equal(pc.get('h', input, { maxLeaves: 9000, followUp: true, threshold: 0 } as any), null);
  assert.equal(pc.get('h', input, { maxLeaves: 1000, followUp: false, threshold: 0 } as any), null);
  assert.equal(pc.get('other', input, { maxLeaves: 1000, followUp: true, threshold: 0 } as any), null);
});

test('built-in coach decides the same on a stripped state (no dice generator needed)', () => {
  const s = scene();
  const a = nextMove(s, 'A', 'balanced', {}, {});
  const b = nextMove(forWorker(s), 'A', 'balanced', {}, {});
  assert.equal(digest(a), digest(b));
});

ptest('pooled candidates / threats equal the inline results (exact, no cut-off)', async () => {
  const pool = makeNodePool({ size: 2, workerFile: WORKER });
  try {
    for (const [name, arg] of [
      ['candidates', { team: 'A', precision: 'exact', sort: 'pSuccess', limit: 12, maxMs: 15000, builtIn: false }],
      ['threats.blitz', { team: 'A', maxMs: 15000 }],
      ['threats.reach', { maxMs: 15000 }],
    ] as Array<[string, any]>) {
      const inline = callService(mk(), name, [arg]) as any;
      const pooled = (await callServiceAsync(mk(), name, [arg], { pool })) as any;
      assert.equal(pooled.ok, true, name);
      const pick = (r: any) => digest(r.candidates ?? r.blitzes ?? r.reach ?? r.players ?? r);
      assert.equal(pick(pooled).length > 10, true);
      assert.equal(pick(pooled), pick(inline), `${name}: pooled == inline`);
    }
    assert.ok(pool.stats().jobs > 0);
  } finally {
    pool.close();
  }
});

ptest('batch runs independent calls in parallel and returns them in order', async () => {
  const pool = makeNodePool({ size: 2, workerFile: WORKER });
  try {
    const ses = mk();
    const items = [
      { service: 'threats.tackleZones', args: [{}] },
      { service: 'threats.reach', args: [{ maxMs: 15000 }] },
      { service: 'candidates', args: [{ team: 'A', precision: 'exact', limit: 5, maxMs: 15000, builtIn: false }] },
    ];
    const r = (await callServiceAsync(ses, 'batch', [items], { pool })) as any;
    assert.equal(r.ok, true);
    assert.equal(r.results.length, 3);
    assert.equal(r.results.every((x: any) => x.ok === true), true);
    const direct = callService(mk(), 'threats.tackleZones', [{}]) as any;
    assert.equal(digest(r.results[0]), digest(direct));
  } finally {
    pool.close();
  }
});

ptest('a second identical call is answered from the cache without new worker jobs', async () => {
  const pool = makeNodePool({ size: 2, workerFile: WORKER });
  try {
    const arg = { maxMs: 15000 };
    await callServiceAsync(mk(), 'threats.reach', [arg], { pool });
    const before = pool.stats().jobs;
    const again = (await callServiceAsync(mk(), 'threats.reach', [arg], { pool })) as any;
    assert.equal(again.ok, true);
    assert.equal(pool.stats().jobs, before, 'no new jobs');
  } finally {
    pool.close();
  }
});

ptest('cancelling a request frees the workers and the pool keeps working', async () => {
  const pool = makeNodePool({ size: 1, workerFile: WORKER });
  try {
    const ses = mk();
    const p = callServiceAsync(ses, 'candidates', [{ team: 'A', precision: 'exact', limit: 40, maxMs: 15000, builtIn: false }], { pool });
    await new Promise((r) => setTimeout(r, 30));
    pool.cancelRequest((await import('../src/platform/index')).poolKey(ses));
    await p.catch(() => undefined);
    const ok = (await callServiceAsync(mk(), 'threats.tackleZones', [{}], { pool })) as any;
    assert.equal(ok.ok, true);
  } finally {
    pool.close();
  }
});

const entry = (code: string): CoachEntry => ({ id: 'm', name: 'M', kind: 'strategy', implementation: 'strategy:m', version: '1', description: '', code, apiMinor: 2 } as unknown as CoachEntry);

test('a decision with one legal option is answered at once, without starting the coach', async () => {
  const s = scene() as any;
  s.pending = { request: { id: 'r1', type: 'test', team: 'A', options: [{ id: 'only', label: 'The only option' }] } };
  const t0 = Date.now();
  const r = await platformDecide(s, 'A', entry(`bloodboard.register({ id:'m', name:'M', apiVersion:1, version:'1', decide(){ throw new Error('must not be asked'); } });`), { spawn: nodeSpawn });
  assert.equal(r.meta.fellBack, false);
  assert.equal(r.meta.via, 'forced');
  assert.equal((r.move as any).optionId, 'only');
  assert.ok(Date.now() - t0 < 1500);
});

ptest('a strategy coach decides the same with and without the engine pool (the built-in option analysis runs in a worker)', async () => {
  const pool = makeNodePool({ size: 2, workerFile: WORKER });
  try {
    const code = `bloodboard.register({ id:'m', name:'M', apiVersion:1, version:'1', chooseAction(o, c){ return { candidateId: 0, why: 'first offered' }; } });`;
    const plain = await platformDecide(scene(), 'A', entry(code), { spawn: nodeSpawn });
    const pooled = await platformDecide(scene(), 'A', entry(code), { spawn: nodeSpawn, pool });
    assert.equal(pooled.meta.usage.pooled, true);
    assert.equal(pooled.meta.offered, plain.meta.offered);
    assert.equal(digest((pooled.move as any).input), digest((plain.move as any).input));
    assert.ok(pool.stats().jobs >= 1, 'the worker did the built-in analysis');
  } finally {
    pool.close();
  }
});

ptest('pool statistics: a single worker kept busy reports about one busy worker, and its busy time adds up', async () => {
  const pool = makeNodePool({ size: 1, workerFile: WORKER });
  try {
    await callServiceAsync(mk(), 'threats.reach', [{ maxMs: 15000 }], { pool });
    await callServiceAsync(mk(), 'threats.tackleZones', [{}], { pool });
    const st = pool.stats();
    assert.ok(st.jobs >= 2);
    assert.ok(st.avgBusy > 0.7 && st.avgBusy <= 1.0001, `avgBusy ${st.avgBusy}`);
    assert.ok(st.workerBusyMs[0] > 0 && st.workerBusyMs[0] <= st.activeMs + 50);
  } finally {
    pool.close();
  }
});
