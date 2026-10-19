import assert from 'node:assert/strict';
import { test } from 'node:test';
import { board } from '../src/engine/index';
import { c } from './helpers';

test('Passing Range Chart (p.71) spot checks and symmetry', () => {
  const o = c(0, 0);
  const cases: Array<[number, number, string | null]> = [
    [1, 0, 'quick'], [3, 0, 'quick'], [3, 1, 'quick'], [2, 2, 'quick'], [3, 2, 'short'], [4, 0, 'short'], [6, 3, 'short'], [5, 4, 'short'],
    [7, 0, 'long'], [5, 5, 'long'], [6, 4, 'long'], [10, 2, 'long'], [9, 4, 'long'], [8, 5, 'long'], [8, 6, 'long'], [7, 7, 'long'],
    [11, 0, 'bomb'], [10, 3, 'bomb'], [9, 5, 'bomb'], [13, 2, 'bomb'], [12, 4, 'bomb'], [11, 6, 'bomb'], [10, 8, 'bomb'], [9, 9, 'bomb'],
    [14, 0, null], [13, 3, null], [12, 5, null], [11, 7, null], [10, 9, null], [10, 10, null],
  ];
  for (const [x, y, r] of cases) {
    assert.equal(board.passRange(o, c(x, y)), r, `(${x},${y})`);
    assert.equal(board.passRange(o, c(y, x)), r, `(${y},${x}) symmetric`);
    assert.equal(board.passRange(c(20, 10), c(20 - x, 10 - y)), r, `(${x},${y}) mirrored`);
  }
});

test('Range Ruler model: the rulebook examples (p.72)', () => {
  const W = 1.8;
  // Horizontal short pass: a player in the adjacent row is under the ruler.
  assert.ok(board.rulerOverlaps(c(10, 7), c(14, 7), c(12, 8), W));
  assert.ok(board.rulerOverlaps(c(10, 7), c(14, 7), c(11, 6), W));
  assert.ok(!board.rulerOverlaps(c(10, 7), c(14, 7), c(12, 9), W), 'two rows away is not under the ruler');
  assert.ok(!board.rulerOverlaps(c(10, 7), c(14, 7), c(8, 7), W), 'behind the thrower');
  assert.ok(!board.rulerOverlaps(c(10, 7), c(14, 7), c(16, 7), W), 'beyond the landing square');
  assert.ok(board.rulerOverlaps(c(10, 7), c(14, 7), c(14, 7), W), 'the landing square itself');
  // Diagonal pass: squares far off the line are not covered.
  assert.ok(board.rulerOverlaps(c(5, 5), c(11, 11), c(8, 8), W));
  assert.ok(board.rulerOverlaps(c(5, 5), c(11, 11), c(9, 7), W));
  assert.ok(!board.rulerOverlaps(c(5, 5), c(11, 11), c(10, 6), W));
});

test('Push-back squares (p.62)', () => {
  assert.deepEqual(board.pushSquares(c(10, 7), c(11, 7)), [c(12, 7), c(12, 6), c(12, 8)]);
  assert.deepEqual(board.pushSquares(c(10, 7), c(11, 8)), [c(12, 9), c(12, 8), c(11, 9)]);
  assert.deepEqual(board.pushSquares(c(10, 7), c(10, 6)), [c(10, 5), c(9, 5), c(11, 5)]);
});

test('Throw-in templates (p.73)', () => {
  const top = board.throwInDirections(c(10, 0), c(10, -1));
  assert.equal(top.corner, false);
  assert.ok(top.dirs.every((d) => d.y === 1), 'thrown back into the pitch from the top sideline');
  const bottom = board.throwInDirections(c(10, 14), c(11, 15));
  assert.ok(bottom.dirs.every((d) => d.y === -1));
  const left = board.throwInDirections(c(0, 7), c(-1, 7));
  assert.ok(left.dirs.every((d) => d.x === 1));
  const corner = board.throwInDirections(c(25, 14), c(26, 15));
  assert.equal(corner.corner, true);
  assert.deepEqual(corner.dirs, [c(-1, 0), c(-1, -1), c(0, -1)]);
});

test('Random Direction Template (p.25)', () => {
  assert.deepEqual(board.D8_DIRS[2], c(0, -1));
  assert.deepEqual(board.D8_DIRS[7], c(0, 1));
  assert.deepEqual(board.D8_DIRS[4], c(-1, 0));
  assert.deepEqual(board.D8_DIRS[8], c(1, 1));
});
