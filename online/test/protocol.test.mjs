import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, checkCommand, ProtocolError } from '../protocol.mjs';

test('parses a bare JSON command, a fenced one, and one exact duplicate read-only query', () => {
  assert.equal(parseCommand('{"type":"query","service":"candidates","args":[{}]}').service, 'candidates');
  assert.equal(parseCommand('```json\n{"type":"rule","revision":"r","optionId":"x"}\n```').optionId, 'x');
  const q = '{"type":"query","service":"reachable","args":["B3"]}';
  assert.equal(parseCommand(q + q).protocolNormalization, 'duplicate-read-only-query');
});
test('a repeated ACTION or two different queries are not tolerated', () => {
  const a = '{"type":"act","revision":"r","candidateId":0}';
  assert.throws(() => parseCommand(a + a), ProtocolError);
  assert.throws(() => parseCommand('{"type":"query","service":"a","args":[]}{"type":"query","service":"b","args":[]}'), ProtocolError);
});
test('object-style query args are wrapped for single-object services; non-array args are rejected otherwise', () => {
  assert.deepEqual(parseCommand('{"type":"query","service":"candidates","args":{"limit":3}}').args, [{ limit: 3 }]);
  assert.throws(() => parseCommand('{"type":"query","service":"reachable","args":{"a":1}}'), /ARRAY/);
});
test('act/rule need a string revision; unknown types and oversize text are rejected', () => {
  assert.throws(() => parseCommand('{"type":"act","candidateId":1}'), /revision/);
  assert.throws(() => parseCommand('{"type":"hack"}'), /type must be/);
  assert.throws(() => parseCommand('x'.repeat(40000)), /too large/);
  assert.throws(() => parseCommand('   '), /no text/);
});
const base = { revision: 'r', request: null, offeredIds: new Set([0, 1, 2]) };
test('candidateId null / missing / string is NEVER End Turn: it is rejected with an explanation', () => {
  for (const bad of [{ type: 'act', revision: 'r', candidateId: null }, { type: 'act', revision: 'r' }, { type: 'act', revision: 'r', candidateId: '1' }, { type: 'act', revision: 'r', candidateId: NaN }]) {
    const v = checkCommand(bad, base); assert.equal(v.ok, false, JSON.stringify(bad));
  }
  assert.match(checkCommand({ type: 'act', revision: 'r', candidateId: null }, base).error, /never End Turn/);
});
test('End Turn is accepted only as an explicit input, and is reported as explicit', () => {
  const v = checkCommand({ type: 'act', revision: 'r', input: { kind: 'endTurn' } }, base);
  assert.deepEqual(v, { ok: true, kind: 'input', explicitEndTurn: true });
  assert.equal(checkCommand({ type: 'act', revision: 'r', input: { kind: 'endActivation' } }, base).explicitEndTurn, false);
  assert.equal(checkCommand({ type: 'act', revision: 'r', input: { nokind: 1 } }, base).ok, false);
});
test('candidate must be offered; revision must match; rule decisions only accept offered options', () => {
  assert.equal(checkCommand({ type: 'act', revision: 'r', candidateId: 2 }, base).ok, true);
  assert.equal(checkCommand({ type: 'act', revision: 'r', candidateId: 9 }, base).ok, false);
  assert.equal(checkCommand({ type: 'act', revision: 'old', candidateId: 1 }, base).ok, false);
  const req = { options: [{ id: 'use' }, { id: 'no' }] };
  assert.equal(checkCommand({ type: 'rule', revision: 'r', optionId: 'use' }, { ...base, request: req }).ok, true);
  assert.equal(checkCommand({ type: 'rule', revision: 'r', optionId: 'zzz' }, { ...base, request: req }).ok, false);
  assert.equal(checkCommand({ type: 'act', revision: 'r', candidateId: 1 }, { ...base, request: req }).ok, false, 'normal action during a rule decision');
  assert.equal(checkCommand({ type: 'rule', revision: 'r', optionId: 'use' }, base).ok, false, 'rule answer when no decision is pending');
});
