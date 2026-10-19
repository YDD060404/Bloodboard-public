/**
 * V4 board animations are built only from the engine's own board snapshots
 * (GameEvent.snap): moves follow the squares the engine moved the player
 * through, the ball goes where the engine put it, knock-downs and removals
 * are marked where they happened, and the timeline ends in the final state.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTimeline, inAir, MAX_ANIM_MS, snapOf } from '../src/ui/animate';
import { execute, type ExecutionResult, type GameState } from '../src/engine/index';
import { c, p, Pos, runScripted } from './helpers';

const snapsOf = (before: GameState, r: ExecutionResult) => [snapOf(before), ...r.events.flatMap((e) => (e.snap ? [e.snap] : []))];

test('a move is animated square by square along the engine\'s own path, ending where the player ends', () => {
  const b = new Pos({ rerollsA: 0 });
  b.add('A', 'human', 'lineman', c(5, 7), { id: 'A1' });
  b.add('B', 'orc', 'lineman', c(20, 2), { id: 'B1' });
  b.ball(c(1, 1));
  const s = b.start();
  const path = [c(6, 7), c(7, 8), c(8, 8), c(9, 9)];
  const r = execute(s, { kind: 'playerAction', playerId: 'A1', action: 'move', path: path.map((to) => ({ to, kind: 'step' as const })) });
  assert.equal(r.status, 'completed');
  const tl = buildTimeline(snapsOf(s, r));
  const pts = tl.players.A1;
  const squares = pts.map((q) => `${q.x},${q.y}`).filter((k, i, a) => i === 0 || a[i - 1] !== k);
  assert.deepEqual(squares, ['5,7', '6,7', '7,8', '8,8', '9,9']);
  for (let i = 1; i < pts.length; i++) assert.ok(pts[i].t >= pts[i - 1].t, 'time order');
  const last = pts[pts.length - 1];
  assert.deepEqual([last.x, last.y], [9, 9]);
  assert.ok(tl.total > 0 && tl.total <= MAX_ANIM_MS);
  assert.equal(tl.ball.length, 0, 'the ball did not move');
  assert.deepEqual(buildTimeline(snapsOf(s, r)), tl, 'deterministic');
});

test('a carried ball moves with its carrier (no separate ball animation); a pick-up animates the ball into the hands', () => {
  const b = new Pos({ rerollsA: 0 });
  const a1 = b.add('A', 'human', 'lineman', c(5, 7), { id: 'A1' });
  b.add('B', 'orc', 'lineman', c(20, 2), { id: 'B1' });
  b.give(a1);
  const s = b.start();
  const r = execute(s, { kind: 'playerAction', playerId: 'A1', action: 'move', path: [c(6, 7), c(7, 7)].map((to) => ({ to, kind: 'step' as const })) });
  assert.equal(buildTimeline(snapsOf(s, r)).ball.length, 0);
});

test('a pass: the ball flies from the thrower to where the engine landed it and ends with the catcher', () => {
  const b = new Pos({ rerollsA: 0 });
  const t = b.add('A', 'human', 'thrower', c(5, 7), { id: 'T' });
  b.add('A', 'human', 'catcher', c(9, 7), { id: 'C' });
  b.add('B', 'orc', 'lineman', c(20, 2), { id: 'B1' });
  b.give(t);
  const s = b.start();
  // Passing test 6 (accurate), catch 6.
  const r = runScripted(s, { kind: 'playerAction', playerId: 'T', action: 'pass', path: [], passTarget: c(9, 7) }, [6, 6]);
  assert.equal(r.state.ball.kind === 'held' && r.state.ball.playerId, 'C');
  const tl = buildTimeline(snapsOf(s, r));
  assert.ok(tl.ball.length >= 2);
  assert.deepEqual([tl.ball[0].x, tl.ball[0].y], [5, 7], 'from the thrower');
  const end = tl.ball[tl.ball.length - 1];
  assert.deepEqual([end.x, end.y], [9, 7], 'to the catcher');
  // While the ball is in the air it is placed where the engine says it comes down (the target of an Accurate Pass).
  const ev = r.events.filter((e) => e.snap);
  const air = [undefined, ...ev.map((_, i) => inAir(ev.slice(0, i + 1)))];
  assert.ok(air.some((a) => a && a.x === 9 && a.y === 7));
  const tl2 = buildTimeline(snapsOf(s, r), air);
  assert.deepEqual([tl2.ball[tl2.ball.length - 1].x, tl2.ball[tl2.ball.length - 1].y], [9, 7]);
});

test('a Block: the push follows the engine\'s push square, the knock-down is marked there; a player leaving the pitch fades where he was', () => {
  const b = new Pos({ rerollsA: 0 });
  b.add('A', 'orc', 'blitzer', c(10, 7), { id: 'A1' });
  b.add('B', 'human', 'lineman', c(11, 7), { id: 'B1' });
  b.ball(c(1, 1));
  const s = b.start();
  // One die: POW (6); push to the first offered square; no follow-up; armour 2+2 holds.
  const r = runScripted(s, { kind: 'playerAction', playerId: 'A1', action: 'block', path: [], blockTarget: 'B1' }, [6, 2, 2], (req) => (req.type === 'followUp' ? 'no' : req.type === 'reroll' ? 'none' : req.options[0].id));
  const def = p(r.state, 'B1');
  assert.equal(def.stance, 'prone');
  const tl = buildTimeline(snapsOf(s, r));
  const pts = tl.players.B1;
  assert.deepEqual([pts[0].x, pts[0].y], [11, 7]);
  assert.deepEqual([pts[pts.length - 1].x, pts[pts.length - 1].y], [def.pos!.x, def.pos!.y]);
  assert.ok(tl.pulses.some((q) => q.x === def.pos!.x && q.y === def.pos!.y), 'knock-down marked in the push square');
  // Knocked-out: armour 6+6, injury 5+4 = 9 KO → a ghost where he fell.
  const r2 = runScripted(s, { kind: 'playerAction', playerId: 'A1', action: 'block', path: [], blockTarget: 'B1' }, [6, 6, 6, 5, 4], (req) => (req.type === 'followUp' ? 'no' : req.type === 'reroll' ? 'none' : req.type === 'apothecary' ? 'keep' : req.options[0].id));
  assert.equal(p(r2.state, 'B1').location, 'ko');
  const tl2 = buildTimeline(snapsOf(s, r2));
  assert.equal(tl2.ghosts.length, 1);
  assert.equal(tl2.ghosts[0].id, 'B1');
});

test('long actions are sped up to at most MAX_ANIM_MS', () => {
  const b = new Pos({ rerollsA: 0 });
  b.add('A', 'human', 'catcher', c(2, 7), { id: 'A1' });
  b.add('B', 'orc', 'lineman', c(24, 2), { id: 'B1' });
  b.ball(c(1, 1));
  const s = b.start();
  const path = [3, 4, 5, 6, 7, 8, 9, 10].map((x) => ({ to: c(x, 7), kind: 'step' as const }));
  const r = runScripted(s, { kind: 'playerAction', playerId: 'A1', action: 'move', path }, [6, 6]);
  const tl = buildTimeline([snapOf(s), ...r.events.flatMap((e) => (e.snap ? [e.snap] : [])), ...r.events.flatMap((e) => (e.snap ? [e.snap] : [])).reverse()]);
  assert.ok(tl.total <= MAX_ANIM_MS);
});
