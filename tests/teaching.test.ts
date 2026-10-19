/**
 * Block School (workbook exercises) checked against the rules engine, and the
 * teaching helpers (block breakdowns, what-if questions).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXERCISES, EXERCISE_BY_ID, LEVELS } from '../src/courses/blockSchool';
import { blockBreakdown, buildWorkbookState, checkExercise, lessonLabel, parseLessonLabel, parseWorkbookAnswer, solveExercise, whatIfMove } from '../src/engine/index';

test('the course has all 80 workbook exercises, Levels 1-7, with page references', () => {
  assert.equal(EXERCISES.length, 80);
  assert.deepEqual(LEVELS.map((l) => l.level), [1, 2, 3, 4, 5, 6, 7]);
  const per = [5, 10, 10, 10, 15, 15, 15];
  for (let l = 1; l <= 7; l++) assert.equal(EXERCISES.filter((e) => e.level === l).length, per[l - 1]);
  for (const e of EXERCISES) {
    assert.ok(e.page >= 2 && e.page <= 28, `${e.id} page ${e.page}`);
    assert.ok(e.answerPage >= 29 && e.answerPage <= 49, `${e.id} answer page ${e.answerPage}`);
    assert.ok(e.hints.length >= 2, e.id);
  }
});

test('workbook labels map to pitch squares and back', () => {
  for (const t of ['A1', 'C4', 'G5', 'D2']) assert.equal(lessonLabel(parseLessonLabel(t)!), t);
  const s = buildWorkbookState(EXERCISE_BY_ID.L7E2);
  assert.equal(lessonLabel(s.players.find((p) => p.id === 'X1')!.pos!), 'C4');
  assert.equal(lessonLabel(s.players.find((p) => p.id === 'Y1')!.pos!), 'C3');
});

test('Levels 1-6: the engine agrees with all 65 workbook answers', () => {
  const count = EXERCISES.filter((e) => e.kind === 'count');
  assert.equal(count.length, 65);
  for (const e of count) {
    const sol = solveExercise(e);
    assert.equal(sol.code, e.workbookAnswer, `${e.id}: engine ${sol.code}, workbook ${e.workbookAnswer}\n${sol.lines.join('\n')}`);
    const r = checkExercise(e, parseWorkbookAnswer(e, e.workbookAnswer)!);
    assert.ok(r.correct);
    const wrong = (['1D', '2D', '3D', '-2D', '-3D'] as const).find((c) => c !== e.workbookAnswer)!;
    assert.equal(checkExercise(e, { kind: 'count', code: wrong }).correct, false);
  }
});

test('Level 7: every workbook answer is accepted by the engine', () => {
  for (const e of EXERCISES.filter((x) => x.level === 7)) {
    const r = checkExercise(e, parseWorkbookAnswer(e, e.workbookAnswer)!);
    assert.ok(r.correct, `${e.id} ${e.workbookAnswer}: ${r.summary}`);
    assert.ok(solveExercise(e).answers.includes(r.answerText), `${e.id}: ${r.answerText} missing from the solution list`);
  }
});

test('Level 7: the documented discrepancies are what the engine computes', () => {
  const initial = (id: string) => blockBreakdown(buildWorkbookState(EXERCISE_BY_ID[id]), 'X1', 'Y1');
  // already 2D before any preparation
  for (const id of ['L7E1', 'L7E4', 'L7E5', 'L7E6', 'L7E8', 'L7E9']) assert.equal(initial(id).code, '2D', id);
  assert.deepEqual([initial('L7E1').attST, initial('L7E1').defST], [5, 3]);
  assert.deepEqual([initial('L7E4').attST, initial('L7E4').defST], [4, 3]);
  // the rest start at 1D
  for (const id of ['L7E2', 'L7E3', 'L7E7', 'L7E10', 'L7E11', 'L7E12', 'L7E13', 'L7E14', 'L7E15']) assert.equal(initial(id).code, '1D', id);
  // extra correct answers
  assert.deepEqual(solveExercise(EXERCISE_BY_ID.L7E7).answers.sort(), ['D4', 'E4']);
  assert.deepEqual(solveExercise(EXERCISE_BY_ID.L7E8).answers.sort(), ['D2', 'E3']);
  assert.deepEqual(solveExercise(EXERCISE_BY_ID.L7E15).answers.sort(), ['D1', 'D2']);
  assert.deepEqual(solveExercise(EXERCISE_BY_ID.L7E3).answers.sort(), ['Y2', 'Y3']);
  assert.deepEqual(solveExercise(EXERCISE_BY_ID.L7E13).answers.sort(), ['Y2', 'Y3']);
  // E10: without the follow-up 5 v 4, with a follow-up into C2 4 v 3
  const e10 = EXERCISE_BY_ID.L7E10;
  const s10 = buildWorkbookState(e10);
  const pushed = whatIfMove(s10, 'Y2', parseLessonLabel('D2')!, 'X1', 'Y1');
  assert.deepEqual([pushed.breakdown.attST, pushed.breakdown.defST], [5, 4]);
  const follow = whatIfMove(pushed.state, 'X2', parseLessonLabel('C2')!, 'X1', 'Y1');
  assert.deepEqual([follow.breakdown.attST, follow.breakdown.defST], [4, 3]);
  // E11: X4 (B4) is not next to Y3 (D3)
  const s11 = buildWorkbookState(EXERCISE_BY_ID.L7E11);
  assert.equal(lessonLabel(s11.players.find((p) => p.id === 'X4')!.pos!), 'B4');
  assert.equal(lessonLabel(s11.players.find((p) => p.id === 'Y3')!.pos!), 'D3');
});

test('a move exercise rejects illegal moves and explains the result of legal ones', () => {
  const e = EXERCISE_BY_ID.L7E7;
  const far = checkExercise(e, { kind: 'move', mover: 'X2', to: parseLessonLabel('A1')! });
  assert.equal(far.correct, false);
  assert.match(far.summary, /one square/);
  const good = checkExercise(e, { kind: 'move', mover: 'X2', to: parseLessonLabel('D4')! });
  assert.ok(good.correct);
  assert.equal(good.breakdown?.code, '2D');
  const bad = checkExercise(e, { kind: 'move', mover: 'X2', to: parseLessonLabel('D5')! });
  assert.equal(bad.correct, false);
});

test('block breakdowns name every helper and why they do or do not assist', () => {
  const b = blockBreakdown(buildWorkbookState(EXERCISE_BY_ID.L7E14), 'X1', 'Y1');
  const x3 = b.offensive.find((x) => x.id === 'X3')!;
  assert.equal(x3.assists, false);
  assert.match(x3.reason, /Marked by Y2/);
  const y3 = b.defensive.find((x) => x.id === 'Y3')!;
  assert.equal(y3.assists, false);
  assert.match(y3.reason, /Marked by X4/);
  assert.ok(b.lines.some((l) => /Equal Strength/.test(l)));
});

test('Guard lets a Marked player assist (Level 5)', () => {
  const e = EXERCISES.find((x) => x.level === 5 && x.guard.length)!;
  const b = blockBreakdown(buildWorkbookState(e), e.attacker, e.defender);
  const guarded = [...b.offensive, ...b.defensive].filter((x) => x.guard && x.assists);
  for (const g of guarded) assert.match(g.reason, /assists/);
});
