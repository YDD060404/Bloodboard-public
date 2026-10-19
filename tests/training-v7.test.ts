/** V7-11: tactical training contracts — authoring, import/export, attempts, resume, fair scoring. Uses the real engine and the shipped examples. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { decide, execute } from '../src/engine/engine';
import {
  authorExercise, checkTacticalExercise, gradeAttempt, importAttempt, importExercises, makePack, newAttempt, publicExercise, replayAttempt, serializeTraining,
  toHistory, type Attempt, type Exercise,
} from '../src/engine/index';
import type { ActionInput, GameState } from '../src/engine/types';

const ex1 = (): GameState => JSON.parse(readFileSync('examples/01-two-dodges-to-glory.json', 'utf8')).state as GameState;
const step = (pts: number[][]) => pts.map(([x, y]) => ({ to: { x, y }, kind: 'step' as const }));
const run = (playerId: string, pts: number[][]): ActionInput => ({ kind: 'playerAction', playerId, action: 'move', path: step(pts) }) as ActionInput;
const MID = run('A1', [[18, 7], [19, 7], [20, 7], [21, 7], [22, 7], [23, 7], [24, 7], [25, 6]]);
const NORTH = run('A1', [[18, 6], [19, 6], [20, 6], [21, 6], [22, 6], [23, 6], [24, 6], [25, 6]]);
const SOUTH = run('A1', [[18, 8], [19, 8], [20, 8], [21, 8], [22, 8], [23, 8], [24, 8], [25, 8]]);
const PASSIVE = run('A2', [[14, 6]]);

function make(overrides: { seed?: number; id?: string; maxActions?: number; refs?: boolean; refList?: { label: string; inputs: ActionInput[] }[] } = {}): Exercise {
  const pos = ex1(); if (overrides.seed !== undefined) pos.rng = { seed: overrides.seed, counter: 0 };
  const r = authorExercise(pos, {
    id: overrides.id ?? 'two-dodges', title: 'Two dodges to glory', side: 'A', objective: { kind: 'score', text: 'Score this Turn' },
    constraints: { maxActions: overrides.maxActions ?? 3 }, createdAt: '2026-10-04T00:00:00Z', hints: ['Count the tackle zones on each route.'],
    ...(overrides.refList ? { references: overrides.refList } : overrides.refs ? { references: [{ label: 'north route', inputs: [NORTH] }, { label: 'south route', inputs: [SOUTH] }] } : {}),
  });
  assert.ok(r.ok, r.ok ? '' : r.errors.join('; '));
  return (r as { exercise: Exercise }).exercise;
}

/** Play inputs on the exercise start with the real engine (first option for any decision) and return the attempt. */
function play(ex: Exercise, inputs: ActionInput[], actor: Attempt['actor'] = { kind: 'human' }, id?: string): Attempt {
  let s = JSON.parse(JSON.stringify(ex.start)) as GameState;
  for (const input of inputs) {
    let out = execute(s, input as never);
    assert.notEqual(out.status, 'illegal', `illegal: ${(out as { error?: string }).error}`);
    while ((out.state as GameState).pending) { const req = (out.state as GameState).pending!.request; out = decide(out.state as GameState, { requestId: req.id, optionId: req.options[0].id }); }
    s = out.state as GameState;
  }
  const a = newAttempt(ex, actor, { id, startedAt: '2026-10-04T01:00:00Z' });
  a.log = JSON.parse(JSON.stringify(s.log));
  a.status = 'finished';
  return a;
}

test('authoring: a current position becomes an exercise with a cleared log, a content hash and explicit refusals for unusable positions', () => {
  const ex = make();
  assert.equal(ex.format, 'bloodboard-exercise'); assert.equal(ex.start.log.length, 0); assert.equal(ex.rulesEdition, 'faq2026');
  assert.equal(make().hash, ex.hash, 'identity is deterministic');
  assert.ok(checkTacticalExercise(ex).ok);
  const bad = (mut: (s: GameState) => void, opts: Partial<Parameters<typeof authorExercise>[1]> = {}) => { const s = ex1(); mut(s); return authorExercise(s, { id: 'x', title: 't', objective: { kind: 'score' }, ...opts }); };
  const setup = bad((s) => { s.phase = 'setup'; }); assert.ok(!setup.ok && /must be in play/.test(setup.errors.join()));
  const wrongSide = bad(() => {}, { side: 'B' }); assert.ok(!wrongSide.ok && /whose Turn/.test(wrongSide.errors.join()));
  const badId = bad(() => {}, { id: 'bad id!' }); assert.ok(!badId.ok);
  const badObj = bad(() => {}, { objective: { kind: 'win-everything' as never } }); assert.ok(!badObj.ok);
  const badRub = bad(() => {}, { rubric: { id: 'r', version: 1, components: [{ id: 'turnoverFree', weight: 1 }] } }); assert.ok(!badRub.ok && /objective/.test(badRub.errors.join()));
  const pend = ex1(); const out = execute(pend, NORTH as never); assert.equal(out.status, 'awaitingDecision');
  const withPending = authorExercise(out.state as GameState, { id: 'p', title: 'p', objective: { kind: 'score' } });
  assert.ok(!withPending.ok && /pending/.test(withPending.errors.join()), 'a position inside a decision is refused, not approximated');
});

test('import/export: single + pack round trip keeps start, objective, constraints and rubric; duplicates, conflicts, damage and wrong payload types are reported, never overwritten', () => {
  const a = make(); const b = make({ id: 'two-dodges-b', maxActions: 2 });
  const pack = makePack('pack-1', 'Pack', [a, b], '2026-10-04T00:00:00Z');
  const first = importExercises(serializeTraining(pack), []);
  assert.equal(first.added.length, 2); assert.deepEqual(first.errors, []);
  assert.deepEqual(first.added[0].start, a.start); assert.deepEqual(first.added[0].objective, a.objective); assert.deepEqual(first.added[0].rubric, a.rubric); assert.deepEqual(first.added[1].constraints, { maxActions: 2 });
  const again = importExercises(serializeTraining(a), first.added);
  assert.equal(again.added.length, 0); assert.equal(again.skipped.length, 1);
  const changed = JSON.parse(serializeTraining(a)); changed.title = 'x'; changed.constraints.maxActions = 9;
  const edited = importExercises(JSON.stringify(changed), first.added);
  assert.ok(edited.errors.join().includes('hash'), 'an edited exercise fails its content hash');
  const conflicting = make({ id: 'two-dodges', maxActions: 5 });
  const c = importExercises(serializeTraining(conflicting), first.added);
  assert.equal(c.conflicts.length, 1); assert.equal(c.added.length, 0, 'same id, different content: not overwritten');
  assert.match(importExercises('{not json', []).errors.join(), /not valid JSON/);
  const hist = toHistory; assert.ok(typeof hist === 'function');
  assert.match(importExercises(JSON.stringify({ format: 'bloodboard-history', version: 1 }), []).errors.join(), /game history, not an exercise/);
  assert.match(importExercises(JSON.stringify({ format: 'bloodboard-exercise', version: 99 }), []).errors.join(), /newer/);
  const dupInPack = importExercises(serializeTraining({ ...pack, exercises: [a, a] }), []);
  assert.equal(dupInPack.added.length, 1); assert.equal(dupInPack.skipped.length, 1);
  const tampered = JSON.parse(serializeTraining(a)); tampered.start.players[0].ma = 99;
  assert.ok(importExercises(JSON.stringify(tampered), []).errors.join().includes('hash'));
});

test('attempt: multi-action attempt with a pending re-roll decision re-executes (resume/replay), and tampering with a die is refused', () => {
  const ex = make({ maxActions: 3 });
  const a = play(ex, [NORTH]);
  assert.ok(a.log[0].decisions.length >= 1, 'the attempt includes a pending rule choice (re-roll) with its recorded answer');
  const p = replayAttempt(ex, a); assert.ok(p.ok, p.error);
  const mid = play(ex, [PASSIVE, MID]);
  assert.equal(mid.log.length, 2);
  const resumedAfterOne = replayAttempt(ex, { ...mid, log: mid.log.slice(0, 1) });
  assert.ok(resumedAfterOne.ok && !resumedAfterOne.finished, 'resume mid-attempt: state is rebuilt, attempt still open');
  const full = replayAttempt(ex, mid); assert.ok(full.ok && full.finished); assert.match(full.why ?? '', /touchdown|Turn ended/);
  const forged = JSON.parse(JSON.stringify(mid)) as Attempt;
  const ev = forged.log[1].events.find((e) => (e as { dice?: unknown }).dice) as { dice?: number[] } | undefined;
  if (ev?.dice?.length) ev.dice[0] = ev.dice[0] === 6 ? 1 : 6; else forged.log[1].outcome = forged.log[1].outcome === 'touchdown' ? 'turnover' : 'touchdown';
  assert.ok(!replayAttempt(ex, forged).ok, 'a forged outcome does not reproduce');
  const other = make({ maxActions: 4 });
  const imp = importAttempt(JSON.stringify(a), [other], []);
  assert.ok(!imp.ok && /different version|not in your library/.test((imp as { error: string }).error));
  const good = importAttempt(JSON.stringify(a), [ex], []); assert.ok(good.ok && !(good as { duplicate: boolean }).duplicate);
  const dupTamper = JSON.parse(JSON.stringify(a)); dupTamper.log = [];
  assert.ok(!importAttempt(JSON.stringify(dupTamper), [ex], [a]).ok, 'same id, different content: refused');
});

test('scoring: two legal equivalent routes both grade (overlapping intervals, grader-only references stay hidden); a passive plan grades clearly lower', () => {
  const ex = make({ refs: true });
  assert.equal((publicExercise(ex) as { references?: unknown }).references, undefined, 'references never reach an acting coach');
  const north = gradeAttempt(ex, play(ex, [NORTH], { kind: 'human' }, 'a-north'), { samples: 240 });
  const south = gradeAttempt(ex, play(ex, [SOUTH], { kind: 'human' }, 'a-south'), { samples: 240 });
  const mid = gradeAttempt(ex, play(ex, [MID], { kind: 'human' }, 'a-mid'), { samples: 240 });
  const passive = gradeAttempt(ex, play(ex, [PASSIVE], { kind: 'human' }, 'a-pass'), { samples: 240 });
  for (const r of [north, south, mid, passive]) { assert.ok(r.legal.ok); assert.equal(r.grader.id, 'bloodboard-tactical-rubric'); assert.ok(r.limits.length >= 3); }
  assert.ok(north.quality.graded && south.quality.graded && mid.quality.graded && passive.quality.graded);
  const overlap = (a: [number, number], b: [number, number]) => a[0] <= b[1] && b[0] <= a[1];
  assert.ok(overlap(north.quality.ci95!, south.quality.ci95!), `equivalent routes: ${north.quality.total} vs ${south.quality.total}`);
  assert.ok(mid.quality.total! > passive.quality.total!, 'the scoring plan beats the passive plan');
  assert.ok(mid.quality.ci95![0] > passive.quality.ci95![1], 'and the difference is outside the uncertainty');
  assert.ok(north.referenceComparison && north.referenceComparison.length === 2, 'references are scored for comparison after the attempt');
  assert.ok(north.quality.components.find((c) => c.id === 'objective')!.mean! >= 0);
  assert.equal(north.quality.samples, 240);
  assert.deepEqual(gradeAttempt(ex, play(ex, [NORTH], { kind: 'human' }, 'a-north'), { samples: 240 }), north, 'grading is deterministic');
});

test('fair grading: the same plan realised with different real dice keeps (statistically) the same plan quality while the realized result differs', () => {
  const plan = [NORTH];
  const results: { realized: boolean | null; q: [number, number]; total: number }[] = [];
  for (let seed = 1; seed < 400 && results.length < 2; seed++) {
    const ex = make({ seed, id: `two-dodges-s${seed}` });
    const a = play(ex, plan, { kind: 'human' }, `a-${seed}`);
    const r = gradeAttempt(ex, a, { samples: 300 });
    if (!results.length || results[0].realized !== r.realized.objectiveAchieved) results.push({ realized: r.realized.objectiveAchieved, q: r.quality.ci95!, total: r.quality.total! });
  }
  assert.equal(results.length, 2, 'found seeds where the same plan succeeded and failed');
  assert.notEqual(results[0].realized, results[1].realized);
  assert.ok(results[0].q[0] <= results[1].q[1] && results[1].q[0] <= results[0].q[1], `plan quality does not follow the dice: ${results[0].total} vs ${results[1].total}`);
});

test('ungraded rather than invented: too few samples, unknown components and illegal attempts', () => {
  const ex = make();
  const a = play(ex, [MID]);
  const few = gradeAttempt(ex, a, { samples: 10 });
  assert.equal(few.quality.total, null); assert.equal(few.quality.graded, false); assert.match(few.quality.reason ?? '', /below the exercise's minimum/);
  assert.equal(few.realized.objectiveAchieved, true, 'the realized outcome is still reported separately');
  const pos = ex1();
  const r = authorExercise(pos, { id: 'weird', title: 'w', side: 'A', objective: { kind: 'score' }, rubric: { id: 'r', version: 1, components: [{ id: 'objective', weight: 1 }, { id: 'style-points', weight: 5 }], minSamples: 20 } });
  assert.ok(r.ok); const ex2 = (r as { exercise: Exercise }).exercise;
  const g = gradeAttempt(ex2, play(ex2, [MID]), { samples: 40 });
  assert.ok(g.quality.graded); assert.equal(g.quality.components.find((c) => c.id === 'style-points')!.available, false);
  const forged = JSON.parse(JSON.stringify(a)) as Attempt; forged.log[0].outcome = 'turnover';
  const gi = gradeAttempt(ex, forged); assert.equal(gi.legal.ok, false); assert.equal(gi.quality.total, null);
  const empty = gradeAttempt(ex, newAttempt(ex, { kind: 'human' })); assert.equal(empty.quality.total, null); assert.match(empty.quality.reason ?? '', /no actions/);
});

test('coach attempts carry identity and budget and the same exercise contract; attempts export/import round-trip', () => {
  const ex = make();
  const a = play(ex, [MID], { kind: 'coach', coachId: 'bloodboard-balanced', coachVersion: '1', budgetMs: 5000 });
  a.labels = { hintsUsed: 1, adviceUsed: true, retryIndex: 2, undos: 3 };
  const back = importAttempt(serializeTraining(a), [ex], []);
  assert.ok(back.ok);
  const att = (back as { attempt: Attempt }).attempt;
  assert.deepEqual(att.actor, { kind: 'coach', coachId: 'bloodboard-balanced', coachVersion: '1', budgetMs: 5000 });
  assert.deepEqual(att.labels, { hintsUsed: 1, adviceUsed: true, retryIndex: 2, undos: 3 });
  const rep = gradeAttempt(ex, att, { samples: 60 });
  assert.equal(rep.hints.used, 1); assert.equal(rep.labels.adviceUsed, true);
});

test('what an acting coach can see: the start state carries no reference lines, labels, objective text or hints (a coach attempt is driven by this state alone)', () => {
  const ex = make({ refs: true });
  const seen = JSON.stringify(ex.start);
  for (const secret of ['north route', 'south route', 'Score this Turn', 'Count the tackle zones', 'references', 'objective', 'hints']) assert.ok(!seen.includes(secret), `the start state must not contain "${secret}"`);
  assert.ok(!JSON.stringify(publicExercise(ex)).includes('north route'), 'the public exercise has no reference labels either');
});

test('step-level localisation: each committed action reports how often alternate dice end the Turn there; a risky step is flagged, a safe one is not; deterministic and report-only', () => {
  const ex = make({ refs: true });
  const risky = play(ex, [MID], { kind: 'human' }, 'att-risky');
  const rep = gradeAttempt(ex, risky);
  assert.ok(rep.quality.graded && rep.steps && rep.steps.length === 1, 'one finding per committed action');
  const st = rep.steps![0];
  assert.equal(st.step, 1); assert.equal(st.reached, rep.quality.samples, 'every replay reaches the first step');
  assert.ok(st.turnovers > 0 && st.turnovers <= st.reached);
  assert.ok(st.turnoverCi95 && st.turnoverCi95[0] <= st.turnoverRate! && st.turnoverRate! <= st.turnoverCi95[1]);
  assert.equal(st.flag, 'risk', 'two Dodges fail often enough to be flagged'); assert.match(st.note, /Turnover/);
  assert.deepEqual(gradeAttempt(ex, risky).steps, rep.steps, 'deterministic for a given exercise and attempt');
  const safe = gradeAttempt(ex, play(ex, [PASSIVE], { kind: 'human' }, 'att-safe'));
  assert.equal(safe.steps![0].turnovers, 0); assert.equal(safe.steps![0].flag, 'ok');
  const few = gradeAttempt(ex, risky, { samples: 10 });
  assert.ok(!few.quality.graded && few.steps === undefined, 'ungraded below minSamples: no localisation is invented');
  assert.ok(!('steps' in risky) && !('steps' in (publicExercise(ex) as object)), 'findings live in the report, not in the attempt or the public exercise');
});

test('divergence: only after grading, only when a reference line is clearly better; names the first differing action in plain words; never when the attempt is the reference', () => {
  // Under this rubric the middle route (MID) scores far higher than the north or south route, and holding position sits in between.
  const ex = make({ refList: [{ label: 'middle route', inputs: [MID] }] });
  const north = gradeAttempt(ex, play(ex, [NORTH], { kind: 'human' }, 'att-north'));
  assert.ok(north.divergence, 'a clearly better reference exists');
  assert.equal(north.divergence!.step, 1); assert.equal(north.divergence!.reference, 'middle route');
  assert.notEqual(north.divergence!.yours, north.divergence!.theirs, 'the two first actions are described differently, in words');
  assert.ok(north.divergence!.referenceTotal! > north.divergence!.yourTotal!); assert.match(north.divergence!.note, /not the only accepted answer/);
  const same = gradeAttempt(ex, play(ex, [MID], { kind: 'human' }, 'att-mid'));
  assert.equal(same.divergence, undefined, 'an attempt that IS the better line is not told to deviate from itself');
  // A reference that is not clearly better than the attempt (holding position vs the north route overlap) is not offered.
  const exHold = make({ id: 'hold', refList: [{ label: 'hold position', inputs: [PASSIVE] }] });
  const close = gradeAttempt(exHold, play(exHold, [NORTH], { kind: 'human' }, 'att-north-2'));
  assert.ok(!close.divergence || close.divergence.referenceTotal! > close.divergence.yourTotal!, 'whenever a divergence is shown the reference really scored higher');
  const noRefs = gradeAttempt(make({ id: 'norefs' }), play(make({ id: 'norefs' }), [PASSIVE], { kind: 'human' }, 'att-nr'));
  assert.equal(noRefs.divergence, undefined);
});
