/** V7-09: the sampling estimator — exact arithmetic on settled positions, honest labelling, reproducibility, no change to the source game, no leak to the coach. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { decide, execute } from '../src/engine/engine';
import * as Engine from '../src/engine/index';
import { assessReplay, parseSaveFile, ReplaySession } from '../src/engine/index';
import { bindEngine } from '../src/ai/index';
import { cloneState } from '../src/engine/state';
import { ESTIMATE_SCHEMA, MIN_RELIABLE_SAMPLES, WinEstimator, estimateWin, type EngineLike } from '../src/platform/win-estimate';
import type { GameState } from '../src/engine/types';

bindEngine(Engine);
const E: EngineLike = { execute: execute as never, decide: decide as never, cloneState };
const fixture = (): GameState => { const p = parseSaveFile(readFileSync('tests/fixtures/real-matches/gamehistory/Norse 1 v Lizaer.json', 'utf8')); assert.ok(p.ok); return (p as { save: { state: GameState } }).save.state; };

test('a settled position (full time) is estimated exactly: counts, shares, Wilson interval, margin and the reliability flag', () => {
  const s = fixture(); assert.equal(s.phase, 'fullTime');
  const r = estimateWin(E, s, { samples: 30, seedBase: 3 });
  const a = s.teams.A.score, b = s.teams.B.score;
  assert.equal(r.schema, ESTIMATE_SCHEMA); assert.equal(r.completed, 30); assert.equal(r.incomplete, 0);
  const win = a > b ? r.outcome.A : a < b ? r.outcome.B : r.outcome.draw;
  assert.equal(win.count, 30); assert.equal(win.share, 1); assert.ok(win.ci95[0] > 0.88 && win.ci95[1] === 1, `Wilson interval of 30/30 (${win.ci95})`);
  assert.equal(r.margin!.mean, a - b); assert.equal(r.margin!.se, 0);
  assert.ok(r.reliable && /30 complete continuations/.test(r.method) && r.limits.length >= 3 && /not a prediction/.test(r.limits[0]));
  const few = estimateWin(E, s, { samples: MIN_RELIABLE_SAMPLES - 1 }); assert.equal(few.reliable, false, 'too few samples are flagged, the numbers are still shown with their interval');
});

test('a late position: complete continuations on alternate seeds, reproducible, shares add up, the source game and the live seed are untouched', () => {
  const m = assessReplay(fixture()); const ses = new ReplaySession(m);
  const late = ses.stateAt(ses.count - 6);
  assert.notEqual(late.phase, 'fullTime');
  const before = JSON.stringify(late);
  const r1 = estimateWin(E, late, { samples: 3, seedBase: 11 });
  const r2 = estimateWin(E, late, { samples: 3, seedBase: 11 });
  assert.equal(JSON.stringify(late), before, 'the position handed in is never modified');
  assert.deepEqual(r1, r2, 'same position + seed base + samples = the same report');
  assert.equal(r1.completed + r1.incomplete, 3); assert.ok(r1.completed >= 1, `at least one rollout reached full time (${r1.completed} of 3)`);
  const sum = r1.outcome.A.count + r1.outcome.draw.count + r1.outcome.B.count; assert.equal(sum, r1.completed);
  assert.equal(r1.reliable, false, '3 samples are not reliable and the report says so');
  assert.equal(r1.from.score.A, late.teams.A.score); assert.equal(r1.from.score.B, late.teams.B.score);
  for (const k of ['A', 'draw', 'B'] as const) assert.ok(r1.outcome[k].ci95[0] <= r1.outcome[k].share && r1.outcome[k].share <= r1.outcome[k].ci95[1]);
});

test('incremental use: advance() plays only a few moves at a time, progress is visible, result() can be read part-way and the final report equals the synchronous one', () => {
  const ses = new ReplaySession(assessReplay(fixture())); const late = ses.stateAt(ses.count - 4);
  const est = new WinEstimator(E, late, { samples: 2, seedBase: 5 });
  assert.equal(est.progress.done, 0); let ticks = 0;
  while (!est.advance(4)) { ticks++; assert.ok(ticks < 5000); }
  assert.ok(ticks > 1, 'work was spread over several small steps'); assert.equal(est.progress.done, 2);
  assert.deepEqual(est.result(), estimateWin(E, late, { samples: 2, seedBase: 5 }));
  const cold = new WinEstimator(E, late, { samples: 2 }); assert.equal(cold.result().completed, 0); assert.equal(cold.result().margin, null);
});
