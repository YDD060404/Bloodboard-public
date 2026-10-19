/**
 * V6 coach-context lifecycle: identity (coach, version, schema), saving with the match, restoring only when all three match,
 * Undo to a checkpoint (never a context from a position that did not happen), structured reset reasons.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CoachContextStore } from '../src/platform/hostext';

const commit = (st: CoachContextStore, team: 'A' | 'B', coach: string, v: unknown, log: number, meta: { version?: string; schema?: string } = { version: '1', schema: 's/1' }) => {
  const t = st.ticket(team, coach, { ...meta, logLength: log });
  return t.commit(v);
};

test('context: committed per side and coach, persisted with its identity and position', () => {
  const st = new CoachContextStore();
  assert.equal(commit(st, 'A', 'x', { plan: 1 }, 5).committed, true);
  assert.equal(commit(st, 'B', 'x', { plan: 2 }, 6).committed, true);
  const p = st.persistable()!;
  assert.deepEqual(p.A, { coachId: 'x', coachVersion: '1', schemaVersion: 's/1', stateRevision: 5, payload: { plan: 1 } });
  assert.equal(p.B!.payload && (p.B!.payload as { plan: number }).plan, 2);
});

test('context restore: same coach, version and schema → restored; otherwise a structured reason and no context', () => {
  const a = new CoachContextStore();
  commit(a, 'A', 'x', { k: 1 }, 5);
  const saved = a.persistable()!;
  const same = new CoachContextStore();
  assert.equal(same.restore(saved, { A: { coachId: 'x', coachVersion: '1', schema: 's/1' } }, 5).A, 'restored');
  assert.deepEqual(same.ticket('A', 'x', { version: '1', schema: 's/1' }).value, { k: 1 });
  for (const [id, code] of [[{ coachId: 'y', coachVersion: '1', schema: 's/1' }, 'coach-changed'], [{ coachId: 'x', coachVersion: '2', schema: 's/1' }, 'coach-version-changed'], [{ coachId: 'x', coachVersion: '1', schema: 's/2' }, 'schema-changed']] as const) {
    const st = new CoachContextStore();
    const r = st.restore(saved, { A: id }, 5).A as { code: string };
    assert.equal(r.code, code);
    assert.equal(st.ticket('A', id.coachId, { version: id.coachVersion, schema: id.schema }).value, undefined);
    assert.equal(st.resetReasonOf('A')?.code, code);
  }
  const late = new CoachContextStore();
  assert.equal((late.restore({ A: { ...saved.A!, stateRevision: 99 } }, { A: { coachId: 'x', coachVersion: '1', schema: 's/1' } }, 5).A as { code: string }).code, 'save-incompatible');
  assert.equal((new CoachContextStore().restore(undefined, {}, 0).A as { code: string }).code, 'not-saved');
});

test('context: switching coach or changing version/schema drops the old context with a reason', () => {
  const st = new CoachContextStore();
  commit(st, 'A', 'x', { k: 1 }, 3);
  assert.equal(st.ticket('A', 'z', { version: '1', schema: 's/1' }).value, undefined);
  assert.equal(st.resetReasonOf('A')?.code, 'coach-changed');
  commit(st, 'A', 'z', { k: 2 }, 4);
  const t = st.ticket('A', 'z', { version: '2', schema: 's/1' });
  assert.equal(t.value, undefined);
  assert.equal(t.resetReason?.code, 'coach-version-changed');
});

test('context: Undo restores the newest checkpoint at or before the restored position, else resets', () => {
  const st = new CoachContextStore();
  commit(st, 'A', 'x', { n: 1 }, 3);
  commit(st, 'A', 'x', { n: 2 }, 7);
  commit(st, 'A', 'x', { n: 3 }, 11);
  st.rewind(8);
  assert.deepEqual(st.ticket('A', 'x', { version: '1', schema: 's/1', logLength: 9 }).value, { n: 2 });
  st.rewind(2);
  const t = st.ticket('A', 'x', { version: '1', schema: 's/1' });
  assert.equal(t.value, undefined);
  assert.equal(t.resetReason?.code, 'undo');
});

test('context: a request superseded by Undo/replace never commits (late answers are harmless)', () => {
  const st = new CoachContextStore();
  const t = st.ticket('A', 'x', { version: '1', schema: 's/1', logLength: 4 });
  st.rewind(0);
  assert.equal(t.current(), false);
  assert.equal(t.commit({ late: true }).committed, false);
  const t2 = st.ticket('B', 'x', { version: '1', schema: 's/1', logLength: 4 });
  st.invalidate({ code: 'load' });
  assert.equal(t2.commit({ late: true }).committed, false);
  assert.equal(st.ticket('B', 'x', { version: '1', schema: 's/1' }).resetReason?.code, 'load');
});

test('context: both sides running the same coach never see each other\'s data (mirror / same coach)', () => {
  const st = new CoachContextStore();
  commit(st, 'A', 'x', { side: 'A' }, 2);
  commit(st, 'B', 'x', { side: 'B' }, 2);
  assert.deepEqual(st.peek('A', 'x'), { side: 'A' });
  assert.deepEqual(st.peek('B', 'x'), { side: 'B' });
});

test('context: oversized and non-JSON values are rejected without affecting the answer; the history cursor tracks what was shown', () => {
  const st = new CoachContextStore();
  const big = st.ticket('A', 'x', { version: '1', schema: 's/1', logLength: 1 }).commit('x'.repeat(9000));
  assert.equal(big.committed, false);
  assert.match(big.ignored ?? '', /over 8192/);
  const t = st.ticket('A', 'x', { version: '1', schema: 's/1', logLength: 1 });
  assert.equal(t.sinceLog, undefined);
  t.markSeen(10);
  assert.equal(st.ticket('A', 'x', { version: '1', schema: 's/1' }).sinceLog, 10);
  st.rewind(6);
  assert.equal(st.ticket('A', 'x', { version: '1', schema: 's/1' }).sinceLog, 6);
});
